// Azure Maps account (Gen2) — used for reverse geocoding and fuzzy place search.
// Replaces AOAI for deterministic coordinate lookups; no idle cost (pay-per-call).

param name string
param location string
param tags object = {}

resource mapsAccount 'Microsoft.Maps/accounts@2023-06-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'G2'
  }
  kind: 'Gen2'
  properties: {
    // Keep local auth (subscription key) available for local development.
    // Managed identity (DefaultAzureCredential) is used in production.
    disableLocalAuth: false
  }
}

// uniqueId is the Maps account's client ID — required as the x-ms-client-id header
// when authenticating with a managed identity bearer token.
output mapsAccountName string = mapsAccount.name
output mapsClientId string = mapsAccount.properties.uniqueId
