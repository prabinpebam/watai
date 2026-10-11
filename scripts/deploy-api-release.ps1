param(
    [ValidateSet('Verify', 'Deploy', 'Rollback')]
    [string]$Mode = 'Verify',
    [string]$CandidatePackage,
    [string]$CandidateSha256,
    [string]$CandidateMarker,
    [Parameter(Mandatory = $true)][string]$BaselinePackage,
    [Parameter(Mandatory = $true)][string]$BaselineSha256,
    [Parameter(Mandatory = $true)][string]$BaselineMarker,
    [string]$EvidencePath,
    [ValidateRange(60, 900)][int]$ActivationTimeoutSeconds = 300
)

# Code-only API release for the Flex Consumption app. Packages are identified by SHA-256
# and the health release marker; activation uses OneDeploy and is accepted only when
# /api/health reports the expected marker, the latest deployment is status 4 and active,
# and app settings are unchanged. Data, consent, deletion and privacy ledgers are never
# touched. Verify mode is read-only.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$AppName = 'func-watai-cbroocyg3omrk'
$ResourceGroup = 'rg-watai-dev'
$StorageAccount = 'stwataicbroocyg3omrk'
$Container = 'deployments'
$HealthUrl = "https://$AppName.azurewebsites.net/api/health"
$evidence = [ordered]@{ mode = $Mode; app = $AppName; startedAt = (Get-Date).ToUniversalTime().ToString('o'); steps = @() }

function Add-Step([string]$Name, [hashtable]$Data = @{}) {
    $entry = [ordered]@{ name = $Name; at = (Get-Date).ToUniversalTime().ToString('o') }
    foreach ($key in $Data.Keys) { $entry[$key] = $Data[$key] }
    $script:evidence.steps += [pscustomobject]$entry
    Write-Host ($entry | ConvertTo-Json -Compress -Depth 4)
    if ($EvidencePath) { $script:evidence | ConvertTo-Json -Depth 6 | Set-Content -Path $EvidencePath -Encoding utf8 }
}

function Invoke-Az([string[]]$Arguments) {
    $output = & az @Arguments --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw "az $($Arguments[0..2] -join ' ') failed with exit code $LASTEXITCODE." }
    return ($output -join "`n")
}

function Assert-Package([string]$Path, [string]$ExpectedSha256, [string]$Label) {
    if (-not $Path -or -not (Test-Path $Path -PathType Leaf)) { throw "$Label package not found: $Path" }
    if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "$Label SHA-256 must be 64 hexadecimal characters." }
    $actual = (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedSha256.ToLowerInvariant()) { throw "$Label SHA-256 mismatch. Expected $ExpectedSha256, got $actual." }
    $archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Path))
    try {
        $names = @($archive.Entries | ForEach-Object { $_.FullName })
        if (@($names | Where-Object { $_ -match '(^|/)(\.env($|\.)|local\.settings\.json$)' }).Count) {
            throw "$Label contains local environment files. Never activate packages that may embed credentials."
        }
        foreach ($required in 'dist/index.cjs', 'host.json', 'package.json') {
            if ($names -notcontains $required) { throw "$Label is missing $required." }
        }
    } finally { $archive.Dispose() }
    return $actual
}

function Get-HealthRelease {
    try {
        $body = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 15 -Headers @{ 'Cache-Control' = 'no-cache' }
        if ($body.ok -ne $true) { return $null }
        return [string]$body.release
    } catch { return $null }
}

function Wait-HealthRelease([string]$Expected) {
    $deadline = (Get-Date).AddSeconds($ActivationTimeoutSeconds)
    do {
        $release = Get-HealthRelease
        if ($release -eq $Expected) { return $true }
        Start-Sleep -Seconds 10
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Get-LatestDeployment {
    $raw = Invoke-Az @('rest', '--method', 'get', '--url', "https://$AppName.scm.azurewebsites.net/api/deployments/latest",
        '--resource', 'https://management.azure.com/', '-o', 'json')
    $value = $raw | ConvertFrom-Json
    return @{ id = [string]$value.id; status = [int]$value.status; active = [bool]$value.active; complete = [bool]$value.complete }
}

function Get-ConfigFingerprint {
    # Hashes names and values without printing them; ordinal ordering keeps the digest stable.
    $settings = Invoke-Az @('functionapp', 'config', 'appsettings', 'list', '-g', $ResourceGroup, '-n', $AppName, '-o', 'json') | ConvertFrom-Json
    [string[]]$lines = @($settings | ForEach-Object { '{0}={1}' -f $_.name, $_.value })
    [Array]::Sort($lines, [StringComparer]::Ordinal)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($lines -join "`n"))).Replace('-', '').ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function Publish-Package([string]$Path) {
    Invoke-Az @('functionapp', 'deployment', 'source', 'config-zip', '-g', $ResourceGroup, '-n', $AppName,
        '--src', (Resolve-Path $Path).Path, '--build-remote', 'false', '-o', 'none') | Out-Null
}

function Confirm-Activation([string]$Marker, [string]$ConfigBefore) {
    $healthy = Wait-HealthRelease $Marker
    $latest = Get-LatestDeployment
    $config = Get-ConfigFingerprint
    $ok = $healthy -and $latest.status -eq 4 -and $latest.active -and $config -eq $ConfigBefore
    Add-Step 'activation' @{ marker = $Marker; healthy = $healthy; deploymentId = $latest.id; deploymentStatus = $latest.status;
        active = $latest.active; configUnchanged = ($config -eq $ConfigBefore); ok = $ok }
    return $ok
}

$baselineHash = Assert-Package $BaselinePackage $BaselineSha256 'Baseline'
$evidence.baselineSha256 = $baselineHash
$evidence.baselineMarker = $BaselineMarker
if ($Mode -ne 'Rollback') {
    if (-not $CandidateMarker) { throw 'CandidateMarker is required for Verify and Deploy.' }
    $evidence.candidateSha256 = Assert-Package $CandidatePackage $CandidateSha256 'Candidate'
    $evidence.candidateMarker = $CandidateMarker
}

$current = Get-HealthRelease
$configBefore = Get-ConfigFingerprint
$latestBefore = Get-LatestDeployment
Add-Step 'preflight' @{ currentRelease = $current; configSha256 = $configBefore; deploymentId = $latestBefore.id;
    deploymentStatus = $latestBefore.status; active = $latestBefore.active }

if ($Mode -eq 'Verify') {
    $state = if ($current -eq $CandidateMarker) { 'CANDIDATE_ACTIVE' } elseif ($current -eq $BaselineMarker) { 'BASELINE_ACTIVE' } else { 'UNEXPECTED_RELEASE' }
    $evidence.result = $state
    Add-Step 'verify' @{ result = $state }
    if ($state -eq 'UNEXPECTED_RELEASE') { exit 2 }
    exit 0
}

if ($Mode -eq 'Rollback') {
    Write-Warning "Activating retained baseline $baselineHash ($BaselineMarker)."
    Publish-Package $BaselinePackage
    if (-not (Confirm-Activation $BaselineMarker $configBefore)) { $evidence.result = 'ROLLBACK_UNVERIFIED'; Add-Step 'result'; throw 'Rollback activation was not verified.' }
    $evidence.result = 'ROLLED_BACK'
    Add-Step 'result'
    exit 0
}

if ($current -ne $BaselineMarker) {
    throw "Production reports '$current', not the baseline '$BaselineMarker'. The rollback target would not be the active predecessor."
}
$rollbackBlob = "rollback/pre-$CandidateMarker-$baselineHash.zip"
$exists = (Invoke-Az @('storage', 'blob', 'exists', '--account-name', $StorageAccount, '--container-name', $Container,
    '--name', $rollbackBlob, '--auth-mode', 'login', '--query', 'exists', '-o', 'tsv')).Trim()
if ($exists -ne 'true') {
    Invoke-Az @('storage', 'blob', 'upload', '--account-name', $StorageAccount, '--container-name', $Container, '--name', $rollbackBlob,
        '--file', (Resolve-Path $BaselinePackage).Path, '--auth-mode', 'login', '--overwrite', 'false', '-o', 'none') | Out-Null
}
Add-Step 'rollback-copy' @{ blob = $rollbackBlob; existed = ($exists -eq 'true') }

try {
    Publish-Package $CandidatePackage
    if (-not (Confirm-Activation $CandidateMarker $configBefore)) { throw 'Candidate activation was not verified.' }
    $evidence.result = 'DEPLOYED'
    Add-Step 'result'
} catch {
    Write-Warning "API release failed: $($_.Exception.Message) Restoring the baseline."
    Add-Step 'deploy-failed' @{ message = $_.Exception.Message }
    Publish-Package $BaselinePackage
    $restored = Confirm-Activation $BaselineMarker $configBefore
    $evidence.result = if ($restored) { 'ROLLED_BACK' } else { 'ROLLBACK_UNVERIFIED' }
    Add-Step 'result'
    throw
}
