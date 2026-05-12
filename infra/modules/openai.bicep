// Azure AI Services (Foundry) — used for intelligent geocoding from message text and image vision.
// Upgraded from Azure OpenAI (kind: OpenAI) to Azure AI Services (kind: AIServices) via Foundry migration.
// Deployed to eastus for broadest model availability.
// Cost: pay-per-token (GlobalStandard/Standard), no reserved capacity — minimises idle cost.

param name string
param location string = 'eastus'
param tags object = {}

resource openAiAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: name
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    customSubDomainName: name
  }
}

resource gpt41Deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: openAiAccount
  name: 'gpt-4.1'
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4.1'
      version: '2025-04-14'
    }
  }
}

resource gpt4oMiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: openAiAccount
  name: 'gpt-4o-mini'
  dependsOn: [gpt41Deployment]
  sku: {
    name: 'Standard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4.1-mini'
      version: '2025-04-14'
    }
  }
}

resource gpt5MiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: openAiAccount
  name: 'gpt-5-mini'
  dependsOn: [gpt4oMiniDeployment]
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-5-mini'
      version: '2025-08-07'
    }
  }
}

output endpoint string = openAiAccount.properties.endpoint
output accountName string = openAiAccount.name
