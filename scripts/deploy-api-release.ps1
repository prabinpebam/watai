param(
    [ValidateSet('Deploy', 'Rollback')]
    [string]$Mode = 'Deploy',
    [string]$BaselinePackage = '.release-artifacts/v0.2.0/baseline-released-package.zip',
    [string]$ExpectedBaselineSha256 = '7519a39a0c191d2a6cee8d12cccd7cb8f9bfdef345881080be4b59e76bb65e42',
    [string]$RollbackBlob = 'rollback/pre-v0.2.0-7519a39a.zip'
)

$ErrorActionPreference = 'Stop'
$AppName = 'func-watai-cbroocyg3omrk'
$ResourceGroup = 'rg-watai-dev'
$StorageAccount = 'stwataicbroocyg3omrk'
$Container = 'deployments'
$HealthUrl = "https://$AppName.azurewebsites.net/api/health"

function Assert-LastExitCode([string]$Operation) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE."
    }
}

function Test-ProductionHealth {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing
    if ($response.StatusCode -ne 200) {
        throw "Production health returned HTTP $($response.StatusCode)."
    }
    Write-Host "Production health passed: HTTP $($response.StatusCode)."
}

function Restore-Baseline {
    Write-Warning 'Restoring the verified baseline backend package.'
    az storage blob upload --account-name $StorageAccount --container-name $Container --name released-package.zip --file $BaselinePackage --auth-mode login --overwrite true --only-show-errors --output none
    Assert-LastExitCode 'Baseline package upload'
    az functionapp restart --name $AppName --resource-group $ResourceGroup --only-show-errors
    Assert-LastExitCode 'Function App restart'
    Test-ProductionHealth
}

if (-not (Test-Path $BaselinePackage -PathType Leaf)) {
    throw "Baseline package not found: $BaselinePackage"
}
$actualHash = (Get-FileHash $BaselinePackage -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $ExpectedBaselineSha256.ToLowerInvariant()) {
    throw "Baseline SHA-256 mismatch. Expected $ExpectedBaselineSha256, got $actualHash."
}

if ($Mode -eq 'Rollback') {
    Restore-Baseline
    exit 0
}

$rollbackExists = az storage blob exists --account-name $StorageAccount --container-name $Container --name $RollbackBlob --auth-mode login --query exists -o tsv
Assert-LastExitCode 'Rollback blob existence check'
if ($rollbackExists.Trim().ToLowerInvariant() -ne 'true') {
    az storage blob upload --account-name $StorageAccount --container-name $Container --name $RollbackBlob --file $BaselinePackage --auth-mode login --overwrite false --only-show-errors --output none
    Assert-LastExitCode 'Immutable rollback package upload'
}

try {
    Push-Location api
    try {
        func azure functionapp publish $AppName --build remote
        Assert-LastExitCode 'Function App publish'
    } finally {
        Pop-Location
    }
    Test-ProductionHealth
} catch {
    Write-Warning "API release failed: $($_.Exception.Message)"
    Restore-Baseline
    throw
}