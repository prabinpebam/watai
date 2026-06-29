using './main.bicep'

param location = 'eastus2'
param namePrefix = 'watai'
param env = 'dev'
// Function App uses Flex Consumption (FC1) — bypasses the consumption (Y1) VM-quota
// wall that blocked this subscription in every region tested.
param deployFunctionApp = true
// Admin account object-id (oid claim). Only the local email/password account
// (d7755720) can sign into the app via the user flow, so it is the sole app admin.
// The federated guest (cbc85566) is the CIAM tenant administrator, not an app
// user, so it is deliberately NOT listed here.
param adminOids = 'd7755720-6b73-4ece-af70-a95b22a7e547'
// Entra External ID (CIAM) token validation. Without these the API fails closed
// with 401 on every authenticated request. Values come from the CIAM tenant's
// OIDC metadata (issuer, jwks_uri) and the API app (client) id (audience).
param authIssuer = 'https://f009d35a-019c-4374-8987-2509caf7f66f.ciamlogin.com/f009d35a-019c-4374-8987-2509caf7f66f/v2.0'
param authAudience = 'd26b2bca-8003-4f2a-a3ec-1d36ca706c45'
param authJwksUri = 'https://wataiexternal.ciamlogin.com/f009d35a-019c-4374-8987-2509caf7f66f/discovery/v2.0/keys'

// Memory model tiers: routine extraction runs on the mini model (benchmarked reliable for the
// strict-JSON extraction payload); heavier merges / conflict resolution / rebuilds stay on the
// full model. See documentation/memory-system/pipeline-probe-report.md.
param memoryModel = 'gpt-5.4-mini'
param memoryDeepModel = 'gpt-5.4'
