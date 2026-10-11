param([ValidateSet('Launch', 'Verify')][string]$Action = 'Launch')

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path (Split-Path $PSScriptRoot -Parent) '.harness-state\deployed-eval'
$receiptPath = Join-Path $stateRoot 'fresh-edge-launch.json'

function Assert-PlainPath([string]$Path) {
    $current = [System.IO.Path]::GetFullPath($Path)
    while ($current) {
        if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw 'Reparse points are not permitted in the private automation path.'
        }
        $parent = Split-Path $current -Parent
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

if ($Action -eq 'Launch') {
    $permitPath = Join-Path $stateRoot 'fresh-edge-decision.json'
    $permit = [System.IO.File]::ReadAllText($permitPath) | ConvertFrom-Json
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $commandHash = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes('fresh-edge-manual-login'))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
    if ($permit.status -ne 'APPROVED' -or $permit.oneShot -ne $true -or $permit.commandSha256 -ne $commandHash -or
        [DateTime]::Parse($permit.expiresAt).ToUniversalTime() -le [DateTime]::UtcNow) { throw 'Fresh launch decision required.' }
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 9222 })
    if ($listeners.Count) { throw 'Port9222 is already occupied; no existing process was changed.' }
    $candidates = @(
        (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Microsoft\Edge\Application\msedge.exe')
    )
    $edge = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $edge) { throw 'Installed Microsoft Edge is required.' }
    $profile = Join-Path $env:LOCALAPPDATA ('WataiEval\AutomationProfiles\' + [Guid]::NewGuid().ToString())
    Assert-PlainPath $profile
    if (Test-Path -LiteralPath $profile) { throw 'Automation profile must be new and empty.' }
    $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($owner)
    foreach ($sid in @($owner, $system)) {
        $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    [System.IO.Directory]::CreateDirectory($profile, $security) | Out-Null
    $actual = Get-Acl -LiteralPath $profile
    $unsafe = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object {
        $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($owner.Value, $system.Value)
    })
    if (-not $actual.AreAccessRulesProtected -or $unsafe.Count) { throw 'Private profile ACL verification failed.' }
    Move-Item -LiteralPath $permitPath -Destination (Join-Path $stateRoot ('fresh-edge-decision-used-' + [Guid]::NewGuid().ToString() + '.json'))
    $arguments = '--user-data-dir="' + $profile + '" --profile-directory=Default --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check --disable-extensions --disable-sync --disable-background-mode --new-window https://prabinpebam.github.io/watai/'
    $browser = Start-Process -FilePath $edge -ArgumentList $arguments -PassThru
    $receipt = [ordered]@{ status = 'LAUNCHED_FOR_MANUAL_LOGIN'; processId = $browser.Id; processStartedAt = $browser.StartTime.ToUniversalTime().ToString('o');
        userDataDirectory = $profile; profileDirectory = 'Default'; endpoint = 'http://127.0.0.1:9222'; endpointVerified = $false;
        cloning = $false; originalProfileChanged = $false; loginVerified = $false }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    $receipt | ConvertTo-Json
    return
}

$receipt = [System.IO.File]::ReadAllText($receiptPath) | ConvertFrom-Json
$browser = Get-Process -Id $receipt.processId -ErrorAction Stop
if ($browser.ProcessName -ne 'msedge' -or $browser.StartTime.ToUniversalTime().ToString('o') -ne $receipt.processStartedAt) { throw 'Automation process identity changed.' }
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 9222 })
if (-not $listeners.Count) { throw 'The fresh Edge process did not expose the debugging endpoint.' }
foreach ($listener in $listeners) {
    if ($listener.OwningProcess -ne $browser.Id) { throw 'Port ownership does not match the new Edge instance.' }
    if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) {
        Stop-Process -Id $browser.Id -Force
        throw 'Unsafe debugging exposure; only the newly launched Edge instance was stopped.'
    }
}
$response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9222/json/version' -TimeoutSec 3 -MaximumRedirection 0
$version = $response.Content | ConvertFrom-Json
if ($version.webSocketDebuggerUrl -notmatch '^ws://(127\.0\.0\.1|localhost|\[::1\]):9222/devtools/browser/') { throw 'Unexpected debugging endpoint response.' }
$receipt.endpointVerified = $true
$receipt.status = 'AUTOMATION_ENDPOINT_VERIFIED_MANUAL_LOGIN_PENDING'
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
[ordered]@{ status = $receipt.status; processId = $browser.Id; edgeVersion = $version.Browser; endpoint = $receipt.endpoint;
    endpointVerified = $true; loginVerified = $false; cloning = $false; originalProfileChanged = $false } | ConvertTo-Json