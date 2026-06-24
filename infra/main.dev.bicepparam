using './main.bicep'

param location = 'eastus2'
param namePrefix = 'watai'
param env = 'dev'
// Function App uses Flex Consumption (FC1) — bypasses the consumption (Y1) VM-quota
// wall that blocked this subscription in every region tested.
param deployFunctionApp = true
// Admin account object-ids (oid claim) — both of the admin's CIAM identities
// (local email account + federated). oid is in every token, so admin is recognized
// even when the email claim is absent (e.g. federated account with empty `mail`).
param adminOids = 'd7755720-6b73-4ece-af70-a95b22a7e547,cbc85566-d323-4a82-bfed-404ac0d770a3'
