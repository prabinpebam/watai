param([switch]$CloseAll)

$ErrorActionPreference = 'Stop'
$processes = @(Get-Process -Name msedge -ErrorAction SilentlyContinue)
if ($CloseAll -and $processes.Count) {
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    $windows = @($processes | Where-Object { $_.MainWindowHandle -ne 0 })
    foreach ($window in $windows) { $null = $window.CloseMainWindow() }
    foreach ($window in $windows) {
        $remaining = [Math]::Max(0, [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        if (-not $window.HasExited -and $remaining -gt 0) { $null = $window.WaitForExit($remaining) }
    }
    foreach ($remaining in @(Get-Process -Name msedge -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $remaining.Id -Force -ErrorAction SilentlyContinue
        $null = $remaining.WaitForExit(2000)
    }
    $processes = @(Get-Process -Name msedge -ErrorAction SilentlyContinue)
}
if ($processes.Count) {
    [ordered]@{ status = 'WAITING_FOR_EDGE_EXIT'; edgeProcesses = $processes.Count; browserLaunched = $false } | ConvertTo-Json
    return
}

$root = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
$state = [System.IO.File]::ReadAllText((Join-Path $root 'Local State')) | ConvertFrom-Json
$profiles = @($state.profile.info_cache.PSObject.Properties | Where-Object { $_.Value.user_name -ieq 'latentvision128@gmail.com' })
if ($profiles.Count -ne 1) { throw 'Exactly one Edge profile for the authorized account is required.' }
$profile = $profiles[0].Name
if ($profile -ne 'Profile 5' -or -not (Test-Path -LiteralPath (Join-Path $root $profile))) {
    throw 'The authorized account no longer maps to the verified Profile 5.'
}
$candidates = @(
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Microsoft\Edge\Application\msedge.exe')
)
$edge = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) { throw 'Installed Microsoft Edge was not found.' }
$occupied = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 9222 })
if ($occupied.Count) { throw 'Port 9222 is already in use; its process was not changed.' }
if (@(Get-Process -Name msedge -ErrorAction SilentlyContinue).Count) {
    [ordered]@{ status = 'EDGE_REOPENED_BEFORE_LAUNCH'; browserLaunched = $false } | ConvertTo-Json
    return
}
$arguments = '--profile-directory="Profile 5" --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check --new-window https://prabinpebam.github.io/watai/'
$process = Start-Process -FilePath $edge -ArgumentList $arguments -PassThru
[ordered]@{
    status = 'LAUNCHED_AWAITING_ENDPOINT_VERIFICATION'
    processId = $process.Id
    profile = $profile
    endpoint = 'http://127.0.0.1:9222'
    cloning = $false
    endpointVerified = $false
    loginVerified = $false
} | ConvertTo-Json