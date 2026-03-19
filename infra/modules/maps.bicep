// Azure Maps account (Gen2) — used for reverse geocoding and fuzzy place search.
// Replaces AOAI for deterministic coordinate lookups; no idle cost (pay-per-call).
//
// Note: Azure Maps is not available in all regions. Supported regions include:
// eastus, westus2, westeurope, northeurope, westcentralus.
// Deploy to eastus to co-locate with Azure OpenAI.

param name string
param location string = 'eastus'
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
    // Subscription key auth disabled — managed identity (DefaultAzureCredential) is required.
    // For local development, set AZURE_MAPS_KEY from a separate dev Azure Maps account.
    disableLocalAuth: true
  }
}

// uniqueId is the Maps account's client ID — required as the x-ms-client-id header
// when authenticating with a managed identity bearer token.
output mapsAccountName string = mapsAccount.name
output mapsClientId string = mapsAccount.properties.uniqueId
