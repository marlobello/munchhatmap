// Azure Cosmos DB — free tier (1000 RU/s, 25 GB).
// NOTE: Only ONE free-tier Cosmos DB account is allowed per Azure subscription.

param name string
param location string
param tags object = {}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true // Only one free-tier account per subscription allowed
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: []
    backupPolicy: {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 1440
        backupRetentionIntervalInHours: 168 // 7 days
        backupStorageRedundancy: 'Local'
      }
    }
    publicNetworkAccess: 'Enabled'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: 'munchhatmap'
  properties: {
    resource: {
      id: 'munchhatmap'
    }
    options: {
      throughput: 400 // Minimum shared throughput — within free tier
    }
  }
}

resource pinsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'pins'
  properties: {
    resource: {
      id: 'pins'
      partitionKey: {
        paths: ['/guildId']
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/_etag/?' }]
      }
    }
  }
}

output cosmosAccountName string = cosmosAccount.name
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
// cosmosPrimaryKey intentionally not exposed — all apps authenticate via managed identity.
