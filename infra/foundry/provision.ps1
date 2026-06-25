<#
.SYNOPSIS
  Provision the Azure AI Foundry side for Watai's agentic tools (code interpreter, file search,
  web search, image generation). Idempotent — safe to re-run.

.DESCRIPTION
  Creates: a resource group, an Azure AI Foundry (Microsoft.CognitiveServices, kind AIServices)
  account, model deployments (chat, mini, image), and — when -EnableWebSearch — a Grounding with
  Bing resource. Adding the Bing *connection* to the project is done in the Foundry portal (the
  reliable path) and is printed at the end.

  The AI plane is YOURS: this deploys into your subscription. Watai never runs this for you.
  Full runbook: documentation/agentic/09-provisioning-and-enablement.md

.NOTES
  Web search (Grounding with Bing) requires a PAY-AS-YOU-GO subscription. It is blocked on
  free/credit subscriptions (e.g. Visual Studio Enterprise). Set -EnableWebSearch:$false there.
  Preview surface: re-verify model names/versions/regions and the Bing resource type at run time.
#>
[CmdletBinding()]
param(
  [string]$SubscriptionId,
  [string]$Location = 'eastus2',
  [string]$ResourceGroup = 'watai-ai-rg',
  [string]$AccountName = 'watai-foundry',
  [string]$ProjectName = 'watai',
  [string]$ChatModel = 'gpt-4.1',
  [string]$ChatModelVersion = '2025-04-14',
  [string]$MiniModel = 'gpt-4.1-mini',
  [string]$MiniModelVersion = '2025-04-14',
  [string]$ImageModel = 'gpt-image-1',
  [string]$ImageModelVersion = '2025-04-15',
  [int]$ChatCapacity = 50,
  [int]$ImageCapacity = 1,
  [string]$BingName = 'watai-bing',
  # Default OFF: Grounding with Bing (web search) is PAYG-only and blocked on Visual Studio
  # Enterprise / credit subscriptions. Code interpreter, file search, and image work without it.
  [bool]$EnableWebSearch = $false
)

$ErrorActionPreference = 'Stop'
function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "    $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!!  $m" -ForegroundColor Yellow }

# --- 0. Preconditions -------------------------------------------------------
Info 'Checking Azure CLI sign-in'
$acct = az account show -o json 2>$null | ConvertFrom-Json
if (-not $acct) { throw 'Not signed in. Run: az login' }
if ($SubscriptionId) { az account set --subscription $SubscriptionId | Out-Null; $acct = az account show -o json | ConvertFrom-Json }
Ok "Subscription: $($acct.name) ($($acct.id))"
if ($EnableWebSearch -and ($acct.name -match 'Visual Studio|MSDN|Free|Credit')) {
  Warn "This looks like a credit/Visual-Studio subscription. Grounding with Bing (web search) is PAYG-only and will likely fail."
  Warn "Re-run with -EnableWebSearch:`$false to skip it, or switch to a PAYG subscription."
}

az extension add --name cognitiveservices --upgrade --only-show-errors 2>$null | Out-Null

# --- 1. Resource group ------------------------------------------------------
Info "Resource group: $ResourceGroup ($Location)"
az group create -n $ResourceGroup -l $Location --only-show-errors | Out-Null
Ok 'Resource group ready'

# --- 2. AI Foundry (AIServices) account -------------------------------------
Info "AI Foundry account: $AccountName"
$exists = az cognitiveservices account show -n $AccountName -g $ResourceGroup -o json 2>$null
if (-not $exists) {
  az cognitiveservices account create `
    -n $AccountName -g $ResourceGroup -l $Location `
    --kind AIServices --sku S0 --custom-domain $AccountName --yes --only-show-errors | Out-Null
  Ok 'Account created'
} else { Ok 'Account already exists' }

# --- 3. Model deployments ---------------------------------------------------
function Deploy-Model($dep, $model, $ver, $cap) {
  Info "Deployment: $dep (${model}:$ver)"
  $d = az cognitiveservices account deployment show -g $ResourceGroup -n $AccountName --deployment-name $dep -o json 2>$null
  if ($d) { Ok 'Already deployed'; return }
  az cognitiveservices account deployment create -g $ResourceGroup -n $AccountName `
    --deployment-name $dep --model-name $model --model-version $ver `
    --model-format OpenAI --sku-name GlobalStandard --sku-capacity $cap --only-show-errors | Out-Null
  Ok 'Deployed'
}
Deploy-Model $ChatModel  $ChatModel  $ChatModelVersion  $ChatCapacity
if ($MiniModel) { Deploy-Model $MiniModel $MiniModel $MiniModelVersion $ChatCapacity }
Deploy-Model $ImageModel $ImageModel $ImageModelVersion $ImageCapacity

# --- 4. Grounding with Bing (web search) ------------------------------------
if ($EnableWebSearch) {
  Info "Grounding with Bing resource: $BingName"
  $b = az resource show -g $ResourceGroup -n $BingName --resource-type 'Microsoft.Bing/accounts' -o json 2>$null
  if (-not $b) {
    # NOTE: preview resource type/SKU — verify against current docs if this errors.
    az resource create -g $ResourceGroup -n $BingName --is-full-object `
      --resource-type 'Microsoft.Bing/accounts' `
      --properties '{ "location": "global", "sku": { "name": "G1" }, "kind": "Bing.Grounding", "properties": {} }' `
      --only-show-errors | Out-Null
    Ok 'Bing grounding resource created'
  } else { Ok 'Bing grounding resource already exists' }
  Warn 'Add the Bing *connection* to the project in the Foundry portal:'
  Warn '  https://ai.azure.com  ->  your project  ->  Management center  ->  Connected resources'
  Warn "  -> + New connection -> Grounding with Bing Search -> select '$BingName' -> Add"
  Warn "  (CLI: az ml connection create --file infra/foundry/bing-connection.yml  — see that file)"
} else {
  Info 'Skipping web search (Grounding with Bing) — disabled or non-PAYG subscription.'
}

# --- 5. Output: endpoint + key + next steps ---------------------------------
$endpoint = az cognitiveservices account show -n $AccountName -g $ResourceGroup --query properties.endpoint -o tsv
$key = az cognitiveservices account keys list -n $AccountName -g $ResourceGroup --query key1 -o tsv

Write-Host ''
Info 'Done. Configure Watai → Settings → Models & keys:'
Ok "Base URL : $($endpoint.TrimEnd('/'))"
Ok "API key  : $key"
Ok "Chat     : $ChatModel"
Ok "Image    : $ImageModel"
Write-Host ''
Info 'Then Settings → Tools → Detect capabilities. Code interpreter + file search go On.'
if ($EnableWebSearch) { Info 'Web search goes On after you add the Bing connection (above) + accept consent.' }
Warn 'Treat the API key as a secret — it grants access to your AI plane.'
