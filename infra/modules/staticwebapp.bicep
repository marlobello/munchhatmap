// Azure Static Web Apps — free tier (F1).
// GitHub Actions CI/CD is configured automatically by the resource; the deployment token
// is passed to the GitHub Actions workflow as a secret.

param name string
param location string = 'centralus'
param tags object = {}
param repositoryUrl string
param repositoryBranch string = 'main'

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    repositoryUrl: repositoryUrl
    branch: repositoryBranch
    buildProperties: {
      appLocation: '/frontend'
      outputLocation: '' // No build step — static HTML/JS served directly
      skipGithubActionWorkflowGeneration: true // We manage our own workflow
    }
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppHostname string = staticWebApp.properties.defaultHostname
output deploymentToken string = staticWebApp.listSecrets().properties.apiKey
