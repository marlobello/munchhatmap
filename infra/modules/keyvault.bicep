// Azure Key Vault — stores bot and API secrets.
// Access granted via managed identity (Key Vault Secrets User role).

param name string
param location string
param tags object = {}

// Object IDs of the managed identities that need secret read access.
param readerPrincipalIds array = []

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    softDeleteRetentionInDays: 7
    enableSoftDelete: true
    publicNetworkAccess: 'Enabled'
  }
}

// Key Vault Secrets User role — least privilege for reading secrets
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource readerRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for (principalId, i) in readerPrincipalIds: {
    name: guid(keyVault.id, principalId, kvSecretsUserRoleId)
    scope: keyVault
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]

output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
