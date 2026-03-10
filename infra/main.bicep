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

@description('Discord OAuth2 application Client ID (from Discord Developer Portal → OAuth2)')
param discordClientId string = '1479611204929585162'

@description('Discord guild ID for membership verification')
param discordGuildId string = '734095597342294107'

@description('Discord role ID that grants elevated (MOD) permissions on the map')
param discordModRoleId string = '946552913600331856'

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
    openAiEndpoint: openAi.outputs.endpoint
    allowedOrigin: 'https://${staticWebAppCustomDomain}'
    discordClientId: discordClientId
    discordGuildId: discordGuildId
    discordModRoleId: discordModRoleId
    discordRedirectUri: 'https://${prefix}-api-${env}.azurewebsites.net/api/auth/callback'
  }
}

// ─── Step 5.5: Azure OpenAI ─────────────────────────────────────────────────
// Deployed to eastus for model availability. Pay-per-token, no idle cost.

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

// ─── Role Assignments ────────────────────────────────────────────────────────
// Moved into a module so existing-resource lookups use string params (compile-time
// knowable), avoiding BCP120 errors when referencing module output IDs directly.

module roleAssignments 'modules/roleassignments.bicep' = {
  name: 'roleAssignments'
  params: {
    cosmosAccountName:  cosmosDb.outputs.cosmosAccountName
    openAiAccountName:  openAi.outputs.accountName
    storageAccountName: functions.outputs.storageAccountName
    botPrincipalId:      identities.outputs.botIdentityPrincipalId
    functionPrincipalId: identities.outputs.functionIdentityPrincipalId
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
