// Creates the user-assigned managed identities for the bot and API function.
// These are created first so their principal IDs can be granted Key Vault access
// before the apps are deployed.

param botIdentityName string
param functionIdentityName string
param location string
param tags object = {}

resource botIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: botIdentityName
  location: location
  tags: tags
}

resource functionIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: functionIdentityName
  location: location
  tags: tags
}

output botIdentityId string = botIdentity.id
output botIdentityPrincipalId string = botIdentity.properties.principalId
output botClientId string = botIdentity.properties.clientId
output functionIdentityId string = functionIdentity.id
output functionIdentityPrincipalId string = functionIdentity.properties.principalId
output functionClientId string = functionIdentity.properties.clientId
