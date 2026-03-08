// Azure Functions (Consumption plan) — hosts the /api/getPins and auth stub endpoints.
// Storage account is required by the Functions runtime.

param name string
param location string
param tags object = {}
param keyVaultUri string
param allowedOrigin string = 'https://munchhatmap.dotheneedful.dev'

// Pre-created managed identity (from identities module)
param functionIdentityId string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${replace(name, '-', '')}sa'
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS' // Cheapest redundancy option
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  kind: 'functionapp'
  properties: {}
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${functionIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      nodeVersion: '~20'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(name)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        // Secrets resolved from Key Vault via managed identity
        {
          name: 'COSMOS_DB_ENDPOINT'
          value: '@Microsoft.KeyVault(VaultName=${split(keyVaultUri, '/')[2]};SecretName=cosmos-db-endpoint)'
        }
        {
          name: 'COSMOS_DB_KEY'
          value: '@Microsoft.KeyVault(VaultName=${split(keyVaultUri, '/')[2]};SecretName=cosmos-db-key)'
        }
        {
          name: 'ALLOWED_ORIGIN'
          value: allowedOrigin
        }
      ]
      cors: {
        allowedOrigins: [
          allowedOrigin
        ]
      }
    }
  }
}

output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
