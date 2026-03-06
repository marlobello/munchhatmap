// Azure Container Apps — hosts the persistent Discord Gateway bot process.
// Consumption plan: pay only for actual usage (vCPU-seconds + GiB-seconds).

param name string
param location string
param tags object = {}
param logAnalyticsWorkspaceCustomerId string
param logAnalyticsWorkspaceKey string

// Container image — pushed to GitHub Container Registry by CI/CD
// Placeholder image used at initial provisioning — the deploy-bot.yml workflow
// will update this to ghcr.io/marlobello/munchhatmap-bot:latest on first push.
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

// Secret names in Key Vault — passed as environment variables via secretRef
param keyVaultUri string

// Pre-created managed identity (from identities module)
param botIdentityId string

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspaceCustomerId
        sharedKey: logAnalyticsWorkspaceKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${botIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      secrets: [
        {
          name: 'discord-bot-token'
          keyVaultUrl: '${keyVaultUri}secrets/discord-bot-token'
          identity: botIdentityId
        }
        {
          name: 'cosmos-db-endpoint'
          keyVaultUrl: '${keyVaultUri}secrets/cosmos-db-endpoint'
          identity: botIdentityId
        }
        {
          name: 'cosmos-db-key'
          keyVaultUrl: '${keyVaultUri}secrets/cosmos-db-key'
          identity: botIdentityId
        }
      ]
      registries: [] // Public ghcr.io image — no registry credentials needed for public images
    }
    template: {
      containers: [
        {
          name: 'bot'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'DISCORD_BOT_TOKEN'
              secretRef: 'discord-bot-token'
            }
            {
              name: 'COSMOS_DB_ENDPOINT'
              secretRef: 'cosmos-db-endpoint'
            }
            {
              name: 'COSMOS_DB_KEY'
              secretRef: 'cosmos-db-key'
            }
            {
              name: 'MAP_TRIGGER_TAGS'
              value: '#munchhat,#munchhatchronicles'
            }
            // Set MAP_URL after Static Web App is provisioned
            {
              name: 'MAP_URL'
              value: ''
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1 // Must be 1 — bot needs a persistent Gateway connection
        maxReplicas: 1
      }
    }
  }
}

output containerAppName string = containerApp.name
