// Role assignments for all managed identities.
// Defined in a module so that existing resource lookups use string parameters
// (compile-time knowable), avoiding BCP120 errors in main.bicep.
//
// Resource names (GUIDs) are hardcoded to match the existing assignments in Azure.
// These were created before IaC managed them; using their existing GUIDs ensures
// Bicep does an idempotent update rather than failing with RoleAssignmentExists.

param cosmosAccountName string
param openAiAccountName string
param storageAccountName string
param keyVaultName string

param botPrincipalId string
param functionPrincipalId string

// ── Cosmos DB data-plane RBAC ────────────────────────────────────────────────
var cosmosContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource botCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: 'd1dd7070-84e6-522b-b3c9-585e94391c85'
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosContributorRoleId}'
    principalId: botPrincipalId
    scope: cosmosAccount.id
  }
}

resource apiCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: '2d3f9807-10d9-5fc3-a312-b051122688a3'
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosContributorRoleId}'
    principalId: functionPrincipalId
    scope: cosmosAccount.id
  }
}

// ── Azure OpenAI ─────────────────────────────────────────────────────────────
// "Cognitive Services OpenAI User" — allows calling the OpenAI inference API

var cognitiveServicesOpenAiUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')

resource openAiAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = {
  name: openAiAccountName
}

resource botOpenAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: 'eb0e3d15-c7a3-4266-8976-ddcfa5354d55'
  scope: openAiAccount
  properties: {
    roleDefinitionId: cognitiveServicesOpenAiUserRole
    principalId: botPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiOpenAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: 'a2f14c3e-8b62-4d9e-a7f0-5c3e1b8d9a24'
  scope: openAiAccount
  properties: {
    roleDefinitionId: cognitiveServicesOpenAiUserRole
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────
// Bot → Storage Blob Data Contributor (upload pin images)
// API → Storage Blob Delegator + Storage Blob Data Reader (generate SAS + read)

var storageBlobDataContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var storageBlobDataReaderRole      = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')
var storageBlobDelegatorRole       = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a')

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource botBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: '8e9a50eb-3e04-436b-94d5-d36688fdc608'
  scope: storageAccount
  properties: {
    roleDefinitionId: storageBlobDataContributorRole
    principalId: botPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiBlobReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: '3640f75e-6999-4eeb-99f0-b50c7de04097'
  scope: storageAccount
  properties: {
    roleDefinitionId: storageBlobDataReaderRole
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiBlobDelegator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: '6db372dd-c26e-4ff3-a29d-474bf2e29001'
  scope: storageAccount
  properties: {
    roleDefinitionId: storageBlobDelegatorRole
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ── Key Vault ─────────────────────────────────────────────────────────────────
// "Key Vault Secrets User" — allows reading secrets (needed for KV references in Functions app settings)

var keyVaultSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource botKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: 'd981bb39-5e78-5169-b0fc-6c324bec3897'
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRole
    principalId: botPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: 'e58ad255-b34e-5259-874b-849df91bbc71'
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRole
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

