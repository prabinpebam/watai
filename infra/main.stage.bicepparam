using './main.bicep'

param location = 'eastus2'
param namePrefix = 'watai'
param env = 'stage'
param deployFunctionApp = true
param functionAppName = 'func-watai-stage-cbroocyg3omrk'
param cosmosDatabaseName = 'watai-harness-stage'
param mediaContainerName = 'harness-media-stage'
param runQueueName = 'harness-run-jobs'
param imageQueueName = 'harness-image-jobs'
param memoryQueueName = 'harness-memory-jobs'
param alwaysReadyHttp = 0
param alwaysReadyRunWorker = 0
param memoryContained = true

// Stage uses the same token-validation authority but a separate app/data/queue namespace.
param authIssuer = 'https://f009d35a-019c-4374-8987-2509caf7f66f.ciamlogin.com/f009d35a-019c-4374-8987-2509caf7f66f/v2.0'
param authAudience = 'd26b2bca-8003-4f2a-a3ec-1d36ca706c45'
param authJwksUri = 'https://wataiexternal.ciamlogin.com/f009d35a-019c-4374-8987-2509caf7f66f/discovery/v2.0/keys'
param adminOids = 'd7755720-6b73-4ece-af70-a95b22a7e547'

// No provider-facing memory model capability is enabled in the contained stage.
param memoryModel = ''
param memoryDeepModel = ''
param memoryEmbedModel = ''
param memoryProfile = 'false'