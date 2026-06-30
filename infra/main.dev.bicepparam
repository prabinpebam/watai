using './main.bicep'

param location = 'eastus2'
param namePrefix = 'watai'
param env = 'dev'
// Function App uses Flex Consumption (FC1) — bypasses the consumption (Y1) VM-quota
// wall that blocked this subscription in every region tested.
param deployFunctionApp = true
// Always-ready instances to kill the first-prompt cold start (see
// documentation/cold-start-fix-plan.md). Option B (worker-only): runWorker=1 removes the
// storage-queue scale-from-zero (~12-42s) for ~$21/mo; http stays at 0 so the front door
// scales to zero (accepts a ~3-5s cold start on the first POST after idle).
// memoryWorker/imageWorker stay cold. Dial runWorker to 0 to disable entirely.
param alwaysReadyHttp = 0
param alwaysReadyRunWorker = 1
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
// Semantic memory retrieval. Embedding deployment name (must exist on the inference endpoint;
// deployed on ai-project-deployments-resource). Empty = vector off; memory then contributes only
// the always-on profile (no retrieval). Fail-open: an embedding error yields an empty block, never
// a blocked reply.
param memoryEmbedModel = 'text-embedding-3-small'
// Always-on identity profile injected into every run (sensitive memories always excluded).
param memoryProfile = 'true'
