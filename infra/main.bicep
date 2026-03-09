// MunchHat Map — main Bicep entrypoint
// Provisions all Azure resources needed for the bot, API, map frontend, and secrets.
//
// Deploy with:
//   az deployment group create \
//     --resource-group rg-munchhatmap-prod \
//     --template-file infra/main.bicep \
//     --parameters repositoryUrl=https://github.com/OWNER/munchhatmap

targetScope = 'resourceGroup'

@description('Environment name (used in resource naming)')
param env string = 'prod'

@description('Azure region for all resources')
param location string = 'centralus'

@description('Azure region for Azure OpenAI (requires eastus/eastus2/swedencentral for gpt-4o-mini)')
param openAiLocation string = 'eastus'

@description('GitHub repository URL (e.g. https://github.com/OWNER/munchhatmap)')
param repositoryUrl string

@description('Git branch to deploy from')
param repositoryBranch string = 'main'

@description('Custom domain for the Static Web App (e.g. munchhatmap.dotheneedful.dev) — leave empty to skip')
param staticWebAppCustomDomain string = 'munchhatmap.dotheneedful.dev'

var prefix = 'munchhatmap'
var tags = {
  project: 'munchhatmap'
  environment: env
}

// ─── Step 1: Managed Identities ─────────────────────────────────────────────
// Created first so their principal IDs can be granted Key Vault access.

module identities 'modules/identities.bicep' = {
  name: 'identities'
  params: {
    botIdentityName: '${prefix}-bot-${env}-identity'
    functionIdentityName: '${prefix}-api-${env}-identity'
    location: location
    tags: tags
  }
}

// ─── Step 2: Log Analytics ───────────────────────────────────────────────────

module logAnalytics 'modules/loganalytics.bicep' = {
  name: 'logAnalytics'
  params: {
    name: '${prefix}-logs-${env}'
    location: location
    tags: tags
  }
}

// ─── Step 3: Cosmos DB ───────────────────────────────────────────────────────

module cosmosDb 'modules/cosmosdb.bicep' = {
  name: 'cosmosDb'
  params: {
    name: '${prefix}-cosmos-${env}'
    location: location
    tags: tags
  }
}

// ─── Step 4: Key Vault ───────────────────────────────────────────────────────
// Grants Key Vault Secrets User role to both managed identities.

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyVault'
  params: {
    name: '${prefix}-kv-${env}'
    location: location
    tags: tags
    readerPrincipalIds: [
      identities.outputs.botIdentityPrincipalId
      identities.outputs.functionIdentityPrincipalId
    ]
  }
}

// ─── Step 5: Azure Functions (API) ──────────────────────────────────────────

module functions 'modules/functions.bicep' = {
  name: 'functions'
  params: {
    name: '${prefix}-api-${env}'
    location: location
    tags: tags
    keyVaultUri: keyVault.outputs.keyVaultUri
    functionIdentityId: identities.outputs.functionIdentityId
    functionClientId: identities.outputs.functionClientId
    cosmosEndpoint: cosmosDb.outputs.cosmosEndpoint
    allowedOrigin: 'https://${staticWebAppCustomDomain}'
  }
}

// ─── Step 5.5: Azure OpenAI ─────────────────────────────────────────────────
// Deployed to eastus for gpt-4o-mini availability. Pay-per-token, no idle cost.

module openAi 'modules/openai.bicep' = {
  name: 'openAi'
  params: {
    name: '${prefix}-aoai-${env}'
    location: openAiLocation
    tags: tags
  }
}

// ─── Step 6: Container App (Discord Bot) ────────────────────────────────────

module containerApp 'modules/containerapp.bicep' = {
  name: 'containerApp'
  params: {
    name: '${prefix}-bot-${env}'
    location: location
    tags: tags
    logAnalyticsWorkspaceCustomerId: logAnalytics.outputs.customerId
    logAnalyticsWorkspaceKey: logAnalytics.outputs.primarySharedKey
    keyVaultUri: keyVault.outputs.keyVaultUri
    botIdentityId: identities.outputs.botIdentityId
    storageAccountName: functions.outputs.storageAccountName
    botClientId: identities.outputs.botClientId
    cosmosEndpoint: cosmosDb.outputs.cosmosEndpoint
    openAiEndpoint: openAi.outputs.endpoint
  }
}

// ─── Role Assignments: Cosmos DB ─────────────────────────────────────────────
// Built-in data plane RBAC roles (not Azure ARM roles):
//   00000000-0000-0000-0000-000000000001 = Cosmos DB Built-in Data Reader
//   00000000-0000-0000-0000-000000000002 = Cosmos DB Built-in Data Contributor

var cosmosContributorRoleId = '00000000-0000-0000-0000-000000000002'
var cosmosReaderRoleId      = '00000000-0000-0000-0000-000000000001'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosDb.outputs.cosmosAccountName
}

resource botCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmosAccount.id, identities.outputs.botIdentityPrincipalId, cosmosContributorRoleId)
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosContributorRoleId}'
    principalId: identities.outputs.botIdentityPrincipalId
    scope: cosmosAccount.id
  }
}

resource apiCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmosAccount.id, identities.outputs.functionIdentityPrincipalId, cosmosReaderRoleId)
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosReaderRoleId}'
    principalId: identities.outputs.functionIdentityPrincipalId
    scope: cosmosAccount.id
  }
}

// ─── Role Assignments: Azure OpenAI ──────────────────────────────────────────
// "Cognitive Services OpenAI User" — allows calling the OpenAI inference API

var cognitiveServicesOpenAiUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')

resource openAiAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = {
  name: openAi.outputs.accountName
  scope: resourceGroup()
}

resource botOpenAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openAiAccount.id, identities.outputs.botIdentityPrincipalId, cognitiveServicesOpenAiUserRole)
  scope: openAiAccount
  properties: {
    roleDefinitionId: cognitiveServicesOpenAiUserRole
    principalId: identities.outputs.botIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}
// Bot identity → Storage Blob Data Contributor (upload pin images)
// API identity → Storage Blob Delegator + Storage Blob Data Reader (generate SAS + read)

var storageBlobDataContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var storageBlobDataReaderRole      = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')
var storageBlobDelegatorRole       = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a')

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: functions.outputs.storageAccountName
}

resource botBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, identities.outputs.botIdentityPrincipalId, storageBlobDataContributorRole)
  scope: storageAccount
  properties: {
    roleDefinitionId: storageBlobDataContributorRole
    principalId: identities.outputs.botIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiBlobReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, identities.outputs.functionIdentityPrincipalId, storageBlobDataReaderRole)
  scope: storageAccount
  properties: {
    roleDefinitionId: storageBlobDataReaderRole
    principalId: identities.outputs.functionIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiBlobDelegator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, identities.outputs.functionIdentityPrincipalId, storageBlobDelegatorRole)
  scope: storageAccount
  properties: {
    roleDefinitionId: storageBlobDelegatorRole
    principalId: identities.outputs.functionIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ─── Step 7: Static Web App (Frontend) ──────────────────────────────────────

module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'staticWebApp'
  params: {
    name: '${prefix}-web-${env}'
    tags: tags
    repositoryUrl: repositoryUrl
    repositoryBranch: repositoryBranch
    customDomain: staticWebAppCustomDomain
  }
}

// ─── Outputs ─────────────────────────────────────────────────────────────────

output staticWebAppHostname string = staticWebApp.outputs.staticWebAppHostname
output functionAppHostname string = functions.outputs.functionAppHostname
output keyVaultName string = keyVault.outputs.keyVaultName
output cosmosEndpoint string = cosmosDb.outputs.cosmosEndpoint
output openAiEndpoint string = openAi.outputs.endpoint

@description('Add this token to GitHub Actions secret: AZURE_STATIC_WEB_APPS_API_TOKEN')
output staticWebAppDeploymentToken string = staticWebApp.outputs.deploymentToken
