// Azure OpenAI — used for intelligent geocoding from message text and image vision.
// Deployed to eastus for broadest model availability.
// Cost: pay-per-token (GlobalStandard), no reserved capacity — minimises idle cost.

param name string
param location string = 'eastus'
param tags object = {}

resource openAiAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0' // Only SKU available for Azure OpenAI (pay-as-you-go)
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    customSubDomainName: name
  }
}

resource gpt5MiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAiAccount
  name: 'gpt-5-mini'
  sku: {
    name: 'GlobalStandard' // Pay-per-token, no reserved TPM — cheapest option
    capacity: 10           // 10K TPM minimum — enough for low-volume geocoding
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-5-mini'
      version: '2025-01-31'
    }
  }
}

output endpoint string = openAiAccount.properties.endpoint
output accountName string = openAiAccount.name
