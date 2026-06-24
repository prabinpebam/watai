// Watai — dev persistence skeleton (Phase 0 infra).
// Two-plane architecture: this provisions ONLY the persistence plane. The user's Azure
// OpenAI key never touches any of these resources.
targetScope = 'resourceGroup'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short name used in resource names.')
param namePrefix string = 'watai'

@description('Environment short name.')
param env string = 'dev'

@description('Browser origin(s) allowed to call the Function App (the GitHub Pages site).')
param allowedOrigins array = [
  'https://prabinpebam.github.io'
  'http://localhost:5173'
]

@description('Deploy the Function App. Requires consumption-plan VM quota in the region.')
param deployFunctionApp bool = true

@description('Email of the admin who can manage invites and is always allowed access.')
param adminEmail string = 'prabinpebam@gmail.com'

var suffix = uniqueString(resourceGroup().id)
var tags = {
  app: 'watai'
  env: env
}

// Cosmos containers mirror documentation/04-data-model.md §2.2.
var cosmosContainers = [
  { name: 'users', pk: '/id' }
  { name: 'settings', pk: '/userId' }
  { name: 'threads', pk: '/userId' }
  { name: 'messages', pk: '/threadId' }
  { name: 'assets', pk: '/userId' }
  { name: 'memory', pk: '/userId' }
  { name: 'usage', pk: '/userId' }
  { name: 'invites', pk: '/pk' }
]

// Built-in role definition ids.
var roleStorageBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var roleKeyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var cosmosBuiltInDataContributor = '00000000-0000-0000-0000-000000000002'

// ---------------------------------------------------------------- Monitoring
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${namePrefix}-${env}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${namePrefix}-${env}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
  }
}

// ---------------------------------------------------------------- Cosmos (serverless)
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: 'cosmos-${namePrefix}-${suffix}'
  location: location
  kind: 'GlobalDocumentDB'
  tags: tags
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [
      { locationName: location, failoverPriority: 0, isZoneRedundant: false }
    ]
    capabilities: [ { name: 'EnableServerless' } ]
    disableLocalAuth: true
    minimalTlsVersion: 'Tls12'
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: 'watai'
  properties: {
    resource: { id: 'watai' }
  }
}

resource containers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = [
  for c in cosmosContainers: {
    parent: cosmosDb
    name: c.name
    properties: {
      resource: {
        id: c.name
        partitionKey: { paths: [ c.pk ], kind: 'Hash' }
        indexingPolicy: { indexingMode: 'consistent', automatic: true }
      }
    }
  }
]

// ---------------------------------------------------------------- Storage (media + functions runtime)
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${namePrefix}${suffix}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  tags: tags
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowSharedKeyAccess: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource mediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'media'
  properties: { publicAccess: 'None' }
}

// Flex Consumption stores its deployment package here.
resource deploymentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'deployments'
  properties: { publicAccess: 'None' }
}

// ---------------------------------------------------------------- Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${namePrefix}-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

// ---------------------------------------------------------------- Function App (Flex Consumption, Node 20)
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = if (deployFunctionApp) {
  name: 'plan-${namePrefix}-${env}'
  location: location
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  kind: 'functionapp'
  properties: { reserved: true }
  tags: tags
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = if (deployFunctionApp) {
  name: 'func-${namePrefix}-${suffix}'
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  tags: tags
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}deployments'
          authentication: {
            type: 'StorageAccountConnectionString'
            storageAccountConnectionStringName: 'DEPLOYMENT_STORAGE_CONNECTION_STRING'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '20'
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: {
        allowedOrigins: allowedOrigins
        supportCredentials: false
      }
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'DEPLOYMENT_STORAGE_CONNECTION_STRING', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        { name: 'COSMOS_DATABASE', value: 'watai' }
        { name: 'STORAGE_ACCOUNT', value: storage.name }
        { name: 'MEDIA_CONTAINER', value: 'media' }
        { name: 'KEY_VAULT_URI', value: keyVault.properties.vaultUri }
        { name: 'ADMIN_EMAIL', value: adminEmail }
      ]
    }
  }
}

// ---------------------------------------------------------------- Role assignments (managed identity, least privilege)
resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployFunctionApp) {
  name: guid(storage.id, 'func', roleStorageBlobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageBlobDataContributor)
    #disable-next-line BCP318
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployFunctionApp) {
  name: guid(keyVault.id, 'func', roleKeyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser)
    #disable-next-line BCP318
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource cosmosDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = if (deployFunctionApp) {
  parent: cosmos
  name: guid(cosmos.id, 'func', cosmosBuiltInDataContributor)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosBuiltInDataContributor}'
    #disable-next-line BCP318
    principalId: functionApp.identity.principalId
    scope: cosmos.id
  }
}

// ---------------------------------------------------------------- Outputs
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output cosmosDatabase string = 'watai'
output storageAccount string = storage.name
output mediaContainer string = 'media'
output keyVaultUri string = keyVault.properties.vaultUri
#disable-next-line BCP318
output functionAppName string = deployFunctionApp ? functionApp.name : ''
#disable-next-line BCP318
output functionAppHostname string = deployFunctionApp ? functionApp.properties.defaultHostName : ''
