targetScope = 'resourceGroup'

@description('Azure region for stage-owned resources.')
param location string = resourceGroup().location

@description('Existing shared Cosmos account name.')
param cosmosAccountName string

@description('Existing shared Storage account name.')
param storageAccountName string

@description('Existing shared Key Vault name.')
param keyVaultName string

@description('Isolated stage Function App name.')
param functionAppName string

param planName string = 'plan-watai-stage'
param logWorkspaceName string = 'log-watai-stage'
param appInsightsName string = 'appi-watai-stage'
param cosmosDatabaseName string = 'watai-harness-stage'
param deploymentContainerName string = 'harness-deployments-stage'
param mediaContainerName string = 'harness-media-stage'
param runQueueName string = 'harness-run-jobs'
param imageQueueName string = 'harness-image-jobs'
param memoryQueueName string = 'harness-memory-jobs'
param allowedOrigins array = [ 'https://prabinpebam.github.io' ]
param adminEmail string = 'prabinpebam@gmail.com'
param adminOids string = ''
param authIssuer string
param authAudience string
param authJwksUri string

var stageContainers = [
  { name: 'users', pk: '/id' }
  { name: 'settings', pk: '/userId' }
  { name: 'invites', pk: '/pk' }
  { name: 'credentials', pk: '/userId' }
  { name: 'threads', pk: '/userId' }
  { name: 'messages', pk: '/threadId' }
  { name: 'runs', pk: '/userId' }
  { name: 'assets', pk: '/userId' }
  { name: 'images', pk: '/userId' }
  { name: 'memory', pk: '/userId' }
  { name: 'memoryJobs', pk: '/userId' }
  { name: 'skills', pk: '/userId' }
  { name: 'usage', pk: '/userId' }
]
var tags = { app: 'watai', env: 'stage' }
var roleStorageBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var roleKeyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var roleKeyVaultCryptoUser = '12338af0-0e69-4776-bea7-57ae8d297424'
var cosmosBuiltInDataContributor = '00000000-0000-0000-0000-000000000002'

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = {
  name: cosmosAccountName
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}
resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logWorkspaceName
  location: location
  tags: tags
  properties: { retentionInDays: 30, features: { enableLogAccessUsingOnlyResourcePermissions: true } }
  #disable-next-line BCP187
  sku: { name: 'PerGB2018' }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: tags
  properties: { Application_Type: 'web', WorkspaceResourceId: law.id }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: { resource: { id: cosmosDatabaseName } }
}

resource containers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = [for container in stageContainers: {
  parent: cosmosDb
  name: container.name
  properties: {
    resource: {
      id: container.name
      partitionKey: { paths: [ container.pk ], kind: 'Hash' }
      indexingPolicy: { indexingMode: 'consistent', automatic: true }
    }
  }
}]

resource libraryContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: 'library'
  properties: {
    resource: {
      id: 'library'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      uniqueKeyPolicy: { uniqueKeys: [ { paths: [ '/ingestionKey' ] } ] }
      indexingPolicy: { indexingMode: 'consistent', automatic: true }
    }
  }
}

resource mediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: mediaContainerName
  properties: { publicAccess: 'None' }
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainerName
  properties: { publicAccess: 'None' }
}

resource stageQueues 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = [for queueName in [runQueueName, imageQueueName, memoryQueueName]: {
  parent: queueService
  name: queueName
  properties: {}
}]

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  kind: 'functionapp'
  properties: { reserved: true }
  tags: tags
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
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
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'StorageAccountConnectionString'
            storageAccountConnectionStringName: 'DEPLOYMENT_STORAGE_CONNECTION_STRING'
          }
        }
      }
      scaleAndConcurrency: { maximumInstanceCount: 2, instanceMemoryMB: 2048, alwaysReady: [] }
      runtime: { name: 'node', version: '24' }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: { allowedOrigins: allowedOrigins, supportCredentials: false }
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'DEPLOYMENT_STORAGE_CONNECTION_STRING', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        { name: 'COSMOS_DATABASE', value: cosmosDatabaseName }
        { name: 'STORAGE_ACCOUNT', value: storage.name }
        { name: 'MEDIA_CONTAINER', value: mediaContainerName }
        { name: 'RUN_QUEUE', value: runQueueName }
        { name: 'IMAGE_QUEUE', value: imageQueueName }
        { name: 'MEMORY_QUEUE', value: memoryQueueName }
        { name: 'KEY_VAULT_URI', value: keyVault.properties.vaultUri }
        { name: 'CRED_KEK_NAME', value: 'watai-cred-kek' }
        { name: 'ADMIN_EMAIL', value: adminEmail }
        { name: 'ADMIN_OID', value: adminOids }
        { name: 'AUTH_ISSUER', value: authIssuer }
        { name: 'AUTH_AUDIENCE', value: authAudience }
        { name: 'AUTH_JWKS_URI', value: authJwksUri }
        { name: 'MEMORY_MODEL', value: '' }
        { name: 'MEMORY_DEEP_MODEL', value: '' }
        { name: 'MEMORY_EMBED_MODEL', value: '' }
        { name: 'MEMORY_PROFILE', value: 'false' }
        { name: 'MEMORY_CONTAINED', value: 'true' }
      ]
    }
  }
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionAppName, roleStorageBlobDataContributor)
  scope: storage
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageBlobDataContributor), principalId: functionApp.identity.principalId, principalType: 'ServicePrincipal' }
}
resource kvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionAppName, roleKeyVaultSecretsUser)
  scope: keyVault
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser), principalId: functionApp.identity.principalId, principalType: 'ServicePrincipal' }
}
resource kvCryptoRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionAppName, roleKeyVaultCryptoUser)
  scope: keyVault
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultCryptoUser), principalId: functionApp.identity.principalId, principalType: 'ServicePrincipal' }
}
resource cosmosDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  name: guid(cosmos.id, functionAppName, cosmosBuiltInDataContributor)
  properties: { roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosBuiltInDataContributor}', principalId: functionApp.identity.principalId, scope: cosmos.id }
}

output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output cosmosDatabase string = cosmosDatabaseName
output mediaContainer string = mediaContainerName
output deploymentContainer string = deploymentContainerName