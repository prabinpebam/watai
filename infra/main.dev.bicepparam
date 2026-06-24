using './main.bicep'

param location = 'eastus2'
param namePrefix = 'watai'
param env = 'dev'
// Function App uses Flex Consumption (FC1) — bypasses the consumption (Y1) VM-quota
// wall that blocked this subscription in every region tested.
param deployFunctionApp = true
