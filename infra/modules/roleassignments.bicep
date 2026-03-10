// Role assignments for all managed identities.
// Defined in a module so that existing resource lookups use string parameters
// (compile-time knowable), avoiding BCP120 errors in main.bicep.

param cosmosAccountName string
param openAiAccountName string
param storageAccountName string

param botPrincipalId string
param functionPrincipalId string

// ── Cosmos DB data-plane RBAC ────────────────────────────────────────────────
var cosmosContributorRoleId = '00000000-0000-0000-0000-000000000002'
var cosmosReaderRoleId      = '00000000-0000-0000-0000-000000000001'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource botCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmosAccount.id, botPrincipalId, cosmosContributorRoleId)
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosContributorRoleId}'
    principalId: botPrincipalId
    scope: cosmosAccount.id
  }
}

resource apiCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmosAccount.id, functionPrincipalId, cosmosReaderRoleId)
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosReaderRoleId}'
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
  name: guid(openAiAccount.id, botPrincipalId, cognitiveServicesOpenAiUserRole)
  scope: openAiAccount
  properties: {
    roleDefinitionId: cognitiveServicesOpenAiUserRole
    principalId: botPrincipalId
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
  name: guid(storageAccount.id, botPrincipalId, storageBlobDataContributorRole)
  scope: storageAccount
  properties: {
    roleDefinitionId: storageBlobDataContributorRole
    principalId: botPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiBlobReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionPrincipalId, storageBlobDataReaderRole)
  scope: storageAccount
  properties: {
    roleDefinitionId: storageBlobDataReaderRole
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiBlobDelegator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionPrincipalId, storageBlobDelegatorRole)
  scope: storageAccount
  properties: {
    roleDefinitionId: storageBlobDelegatorRole
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}
