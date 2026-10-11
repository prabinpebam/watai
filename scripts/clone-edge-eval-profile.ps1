param(
    [ValidateSet('Plan', 'Clone')]
    [string]$Action = 'Plan',
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$')]
    [string]$ProfileDirectory
)

$ErrorActionPreference = 'Stop'
$started = [DateTime]::UtcNow
$root = Split-Path $PSScriptRoot -Parent
$stateRoot = Join-Path $root '.harness-state\deployed-eval'
$receiptPath = Join-Path $stateRoot ('edge-session-clone-result-' + [Guid]::NewGuid().ToString() + '.json')
$handles = New-Object 'System.Collections.Generic.List[System.IO.FileStream]'
$destination = $null
$store = 'profile-selection'
$copied = 0
$byteCount = 0L

function Fail-Clone([string]$Code) { throw [System.InvalidOperationException]::new($Code) }

function Read-Switch([string]$CommandLine, [string]$Name) {
    $pattern = '(?:^|\s)--' + [regex]::Escape($Name) + '(?:=|\s+)(?:"([^"]+)"|([^\s"]+))'
    $matches = [regex]::Matches($CommandLine, $pattern)
    if ($matches.Count -gt 1) { Fail-Clone 'AMBIGUOUS_EDGE_ARGUMENT' }
    if (-not $matches.Count) { return $null }
    if ($matches[0].Groups[1].Success) { return $matches[0].Groups[1].Value }
    return $matches[0].Groups[2].Value
}

function Assert-PlainPath([string]$Path) {
    $current = [System.IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                Fail-Clone 'REPARSE_POINT_NOT_ALLOWED'
            }
        }
        $parent = Split-Path $current -Parent
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Protect-Directory([string]$Path) {
    Assert-PlainPath $Path
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
    $security.SetOwner($owner)
    foreach ($sid in @($owner, $system)) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $security.AddAccessRule($rule)
    }
    [System.IO.Directory]::CreateDirectory($Path, $security) | Out-Null
    $actual = Get-Acl -LiteralPath $Path
    $rules = $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    if (-not $actual.AreAccessRulesProtected -or @($rules | Where-Object {
        $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($owner.Value, $system.Value)
    }).Count) { Fail-Clone 'DESTINATION_ACL_UNSAFE' }
}

function Inventory([string]$Base, [object[]]$Units) {
    $files = New-Object 'System.Collections.Generic.List[object]'
    foreach ($unit in $Units) {
        $path = Join-Path $Base $unit.Relative
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $pending = New-Object 'System.Collections.Generic.Stack[string]'
        $pending.Push($path)
        while ($pending.Count) {
            if (([DateTime]::UtcNow - $started).TotalSeconds -gt 90) { Fail-Clone 'CLONE_TIME_LIMIT' }
            $entry = Get-Item -LiteralPath $pending.Pop() -Force
            if ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { Fail-Clone 'REPARSE_POINT_NOT_ALLOWED' }
            if ($entry.PSIsContainer) {
                foreach ($child in Get-ChildItem -LiteralPath $entry.FullName -Force) { $pending.Push($child.FullName) }
            } elseif ($entry.Name -ne 'LOCK') {
                $files.Add([pscustomobject]@{
                    Path = $entry.FullName
                    Relative = $entry.FullName.Substring($Base.Length + 1)
                    Store = $unit.Name
                    Length = $entry.Length
                    Ticks = $entry.LastWriteTimeUtc.Ticks
                })
                if ($files.Count -gt 5000) { Fail-Clone 'CLONE_FILE_LIMIT' }
            }
        }
    }
    return @($files | Sort-Object Relative -Unique)
}

function Inventory-Key([object[]]$Files) {
    return (@($Files | ForEach-Object { '{0}:{1}:{2}' -f $_.Relative, $_.Length, $_.Ticks }) -join "`n")
}

try {
    $browsers = @(Get-CimInstance Win32_Process -Filter 'Name = ''msedge.exe''' -OperationTimeoutSec 10 |
        Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' })
    if ($browsers.Count -gt 1) { Fail-Clone 'AMBIGUOUS_EDGE_BROWSER' }
    $browser = if ($browsers.Count -eq 1) { $browsers[0] } else { $null }
    $profile = if ($browser) { Read-Switch $browser.CommandLine 'profile-directory' } else { $ProfileDirectory }
    if ($browser -and $ProfileDirectory -and $profile -cne $ProfileDirectory) { Fail-Clone 'AUTHORIZED_PROFILE_MISMATCH' }
    if (-not $profile -or $profile -match '[\\/]' -or $profile -in @('.', '..')) { Fail-Clone 'EXPLICIT_SAFE_PROFILE_REQUIRED' }
    $approvedBase = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data')).TrimEnd('\')
    $override = if ($browser) { Read-Switch $browser.CommandLine 'user-data-dir' } else { $null }
    $source = if ($override) { [System.IO.Path]::GetFullPath($override).TrimEnd('\') } else { $approvedBase }
    if (-not $source.Equals($approvedBase, [System.StringComparison]::OrdinalIgnoreCase)) { Fail-Clone 'NONSTANDARD_EDGE_DATA_REQUIRES_EXPLICIT_BINDING' }
    Assert-PlainPath (Join-Path $source $profile)
    $units = @(
        [pscustomobject]@{ Name = 'Local State'; Relative = 'Local State' },
        [pscustomobject]@{ Name = 'Preferences'; Relative = "$profile\Preferences" },
        [pscustomobject]@{ Name = 'Secure Preferences'; Relative = "$profile\Secure Preferences" },
        [pscustomobject]@{ Name = 'Local Storage'; Relative = "$profile\Local Storage" },
        [pscustomobject]@{ Name = 'Session Storage'; Relative = "$profile\Session Storage" }
    )
    $cookies = if (Test-Path -LiteralPath (Join-Path $source "$profile\Network\Cookies")) { "$profile\Network\Cookies" } else { "$profile\Cookies" }
    $units += [pscustomobject]@{ Name = 'Cookies'; Relative = $cookies }
    foreach ($suffix in @('-wal', '-shm', '-journal')) { $units += [pscustomobject]@{ Name = 'Cookies sidecar'; Relative = "$cookies$suffix" } }
    foreach ($required in @('Local State', "$profile\Preferences", "$profile\Local Storage", $cookies)) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $required))) { Fail-Clone 'REQUIRED_SESSION_STORE_MISSING' }
    }
    $files = @(Inventory $source $units)
    $byteCount = [long](($files | Measure-Object Length -Sum).Sum)
    if ($Action -eq 'Plan') {
        [ordered]@{ status = $(if ($byteCount -le 268435456) { 'PLAN_READY' } else { 'PLAN_OVER_BYTE_LIMIT' }); processId = $browser.ProcessId; profileDirectory = $profile;
            files = $files.Count; bytes = $byteCount; stores = @($files | Group-Object Store | ForEach-Object {
                [ordered]@{ name = $_.Name; files = $_.Count; bytes = ($_.Group | Measure-Object Length -Sum).Sum }
            });
            omittedStores = @('IndexedDB app data', 'History', 'Saved passwords', 'Cache');
            networkRequests = 0; sourceChanged = $false; authenticationVerified = $false } | ConvertTo-Json -Depth 4
        return
    }
    if ($byteCount -gt 268435456) { Fail-Clone 'CLONE_BYTE_LIMIT' }
    $permitPath = Join-Path $stateRoot 'edge-session-clone-decision.json'
    $permit = [System.IO.File]::ReadAllText($permitPath) | ConvertFrom-Json
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try { $commandHash = [BitConverter]::ToString($hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes('authorized-edge-session-clone-local'))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
    if ($permit.status -ne 'APPROVED' -or $permit.oneShot -ne $true -or
        $permit.commandSha256 -ne $commandHash -or
        [DateTime]::Parse($permit.approvedAt).ToUniversalTime() -gt [DateTime]::UtcNow -or
        [DateTime]::Parse($permit.expiresAt).ToUniversalTime() -le [DateTime]::UtcNow) { Fail-Clone 'FRESH_CLONE_PERMIT_REQUIRED' }
    Move-Item -LiteralPath $permitPath -Destination (Join-Path $stateRoot ('edge-session-clone-decision-used-' + [Guid]::NewGuid().ToString() + '.json'))
    $destination = Join-Path $env:LOCALAPPDATA ('WataiEval\EdgeProfiles\' + [Guid]::NewGuid().ToString())
    Protect-Directory $destination
    foreach ($file in $files) {
        $store = $file.Store
        $handle = [System.IO.File]::Open($file.Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        $handles.Add($handle)
    }
    if ((Inventory-Key $files) -cne (Inventory-Key @(Inventory $source $units))) { Fail-Clone 'SESSION_STORE_CHANGED' }
    $manifest = New-Object 'System.Collections.Generic.List[object]'
    for ($index = 0; $index -lt $files.Count; $index++) {
        if (([DateTime]::UtcNow - $started).TotalSeconds -gt 90) { Fail-Clone 'CLONE_TIME_LIMIT' }
        $file = $files[$index]
        $store = $file.Store
        $handle = $handles[$index]
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hash = [BitConverter]::ToString($hasher.ComputeHash($handle)).Replace('-', '').ToLowerInvariant()
            $handle.Position = 0
            $target = Join-Path $destination $file.Relative
            [System.IO.Directory]::CreateDirectory((Split-Path $target -Parent)) | Out-Null
            $output = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            try { $handle.CopyTo($output); $output.Flush($true) } finally { $output.Dispose() }
            $handle.Position = 0
            $after = [BitConverter]::ToString($hasher.ComputeHash($handle)).Replace('-', '').ToLowerInvariant()
            if ($after -ne $hash -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { Fail-Clone 'SESSION_BYTES_CHANGED' }
            $manifest.Add([ordered]@{ path = $file.Relative; bytes = $file.Length; sha256 = $hash })
            $copied++
        } finally { $hasher.Dispose() }
    }
    if ((Inventory-Key $files) -cne (Inventory-Key @(Inventory $source $units))) { Fail-Clone 'SESSION_STORE_CHANGED' }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'clone-manifest.json') -Encoding UTF8
    $result = [ordered]@{ status = 'CLONED_NOT_AUTHENTICATED'; destination = $destination; profileDirectory = $profile;
        files = $copied; bytes = $byteCount; omittedStores = @('IndexedDB app data', 'History', 'Saved passwords', 'Cache');
        sourceChanged = $false; authenticationVerified = $false; networkRequests = 0 }
} catch {
    $code = $_.Exception.Message
    if ($code -notmatch '^[A-Z][A-Z0-9_]+$') { $code = 'SESSION_STORE_LOCKED_OR_UNREADABLE' }
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    $result = [ordered]@{ status = 'BLOCKED'; blocker = $code; store = $store; filesCopied = $copied;
        windowsErrorCode = ($cause.HResult -band 65535); sourceChanged = $false;
        authenticationVerified = $false; networkRequests = 0; protectedQuarantine = $destination }
} finally {
    foreach ($handle in $handles) { $handle.Dispose() }
}
if ($result) {
    $result['observedAt'] = [DateTime]::UtcNow.ToString('o')
    $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    $result | ConvertTo-Json -Depth 4
}