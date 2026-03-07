// Azure Static Web Apps — free tier (F1).
// GitHub Actions CI/CD is configured automatically by the resource; the deployment token
// is passed to the GitHub Actions workflow as a secret.

param name string
param location string = 'centralus'
param tags object = {}
param repositoryUrl string
param repositoryBranch string = 'main'
param customDomain string = ''  // e.g. 'munchhatmap.dotheneedful.dev' — leave empty to skip

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

// Preserve the custom domain configured via CNAME delegation.
// Incremental deployments are idempotent — re-running will not remove or break the domain.
resource customDomainResource 'Microsoft.Web/staticSites/customDomains@2023-12-01' = if (!empty(customDomain)) {
  parent: staticWebApp
  name: !empty(customDomain) ? customDomain : 'placeholder'
  properties: {
    validationMethod: 'cname-delegation'
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppHostname string = staticWebApp.properties.defaultHostname
output deploymentToken string = staticWebApp.listSecrets().properties.apiKey
