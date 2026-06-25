// Application Insights (workspace-based) for the Functions API.
// Links to the existing Log Analytics workspace so all telemetry lands in one place.
//
// Enables automatic request/dependency tracking for the Functions host (via the
// APPLICATIONINSIGHTS_CONNECTION_STRING app setting, wired in functions.bicep) and
// backs the custom events/metrics emitted by the API (see api/src/shared/telemetry.ts).

param name string
param location string
param tags object = {}

@description('Resource ID of the Log Analytics workspace to back this component')
param logAnalyticsWorkspaceId string

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: name
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspaceId
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output id string = appInsights.id
output name string = appInsights.name
output connectionString string = appInsights.properties.ConnectionString
