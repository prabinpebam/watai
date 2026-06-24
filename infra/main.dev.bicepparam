using './main.bicep'

param location = 'eastus2'
param namePrefix = 'watai'
param env = 'dev'
// Function App needs consumption-plan VM quota (request it, or use a region/Flex plan).
// Deploy the data plane first; flip to true once quota is sorted.
param deployFunctionApp = false
