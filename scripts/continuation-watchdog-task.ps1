param(
    [ValidateSet('Plan', 'Install', 'RefreshAction', 'Status', 'Remove')]
    [string]$Action = 'Plan',
    [string]$ActivityDirectory
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$taskName = 'Watai Continuation Watchdog'
$taskPath = '\'
$node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$entry = Join-Path $root '.harness-dist\continuationWatchdog.js'
$launcher = Join-Path $root 'scripts\continuation-watchdog-hidden.vbs'
$windowlessHost = Join-Path $env:SystemRoot 'System32\wscript.exe'
$hiddenArguments = '//B //Nologo "{0}" "{1}" "{2}"' -f $launcher, $node, $root
$configPath = Join-Path $root '.harness-state\continuation-watchdog.json'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if ($Action -eq 'Remove') {
    Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction Stop
    Write-Output 'Removed task only; retained pause, decisions, configuration, and harness state.'
    return
}
if ($Action -eq 'Status') {
    Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Select-Object TaskName, State, Actions, Triggers, Principal, Settings
    Get-ScheduledTaskInfo -TaskName $taskName -TaskPath $taskPath
    return
}

if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Build first: npm run build:harness' }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf) -or -not (Test-Path -LiteralPath $windowlessHost -PathType Leaf)) {
    throw 'Windowless launcher unavailable; no foreground fallback is permitted.'
}
if ($Action -eq 'RefreshAction') {
    $existing = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction Stop
    $actions = @($existing.Actions)
    $principalSid = if ($existing.Principal.UserId -match '^S-1-') { $existing.Principal.UserId } else {
        (New-Object System.Security.Principal.NTAccount($existing.Principal.UserId)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    }
    $legacyArguments = '"{0}" check' -f $entry
    $expectedAction = $actions.Count -eq 1 -and $actions[0].WorkingDirectory -eq $root -and (
        ($actions[0].Execute -eq $node -and $actions[0].Arguments -eq $legacyArguments) -or
        ($actions[0].Execute -eq $windowlessHost -and $actions[0].Arguments -eq $hiddenArguments))
    if (-not $expectedAction -or $principalSid -ne [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value -or
        [string]$existing.Principal.RunLevel -ne 'Limited' -or [string]$existing.Principal.LogonType -ne 'Interactive' -or
        [string]$existing.Settings.MultipleInstances -ne 'IgnoreNew' -or $existing.Settings.ExecutionTimeLimit -ne 'PT2M' -or
        @($existing.Triggers).Count -ne 1 -or $existing.Triggers[0].Repetition.Interval -ne 'PT10M') {
        throw 'Existing task identity or limits differ; no task was changed.'
    }
    $backup = Join-Path $root '.harness-state\watchdog-before-hidden.xml'
    if (-not (Test-Path -LiteralPath $backup)) { Export-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Set-Content -LiteralPath $backup }
    Disable-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Out-Null
    if ([string]$existing.State -eq 'Running') { throw 'Existing check is running; task remains disabled without terminating it.' }
    $replacement = New-ScheduledTaskAction -Execute $windowlessHost -Argument $hiddenArguments -WorkingDirectory $root
    Set-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $replacement | Out-Null
    Write-Output 'Windowless check-only action installed. Task remains disabled until its quiet canary passes.'
    return
}
if ($ActivityDirectory -and -not (Test-Path -LiteralPath $ActivityDirectory -PathType Container)) {
    throw 'Activity directory is unavailable; no task was registered.'
}
if (Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue) {
    throw 'Task already exists; inspect it with -Action Status. This script does not overwrite tasks.'
}

$plan = [ordered]@{
    TaskName = $taskName
    TaskPath = $taskPath
    User = $identity
    LogonType = 'Interactive'
    RunLevel = 'Limited'
    Execute = $windowlessHost
    Arguments = $hiddenArguments
    WorkingDirectory = $root
    IntervalMinutes = 10
    StaleMinutes = 20
    MultipleInstances = 'IgnoreNew'
    ExecutionTimeLimitMinutes = 2
    Mode = 'log-only'
    Config = $configPath
}
if ($Action -eq 'Plan') { $plan | ConvertTo-Json -Depth 4; return }

if (-not (Test-Path -LiteralPath $configPath)) {
    New-Item -ItemType Directory -Path (Split-Path $configPath -Parent) -Force | Out-Null
    $config = [ordered]@{ mode = 'log-only'; activityDirectory = $ActivityDirectory }
    $stream = [System.IO.File]::Open($configPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(($config | ConvertTo-Json) + "`n")
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.mode -ne 'log-only') { throw 'Configuration must be log-only. No task registered.' }
if ($ActivityDirectory -and $config.activityDirectory -ne $ActivityDirectory) {
    throw 'Existing activity configuration differs; inspect it manually. No task registered.'
}

$canaryText = & (Join-Path $PSScriptRoot 'run-quiet-check.ps1') -Check WatchdogCheck
$canary = ($canaryText -join "`n") | ConvertFrom-Json
if ($canary.mode -ne 'log-only' -or $canary.dispatched -ne $false -or
    $canary.reasons -contains 'MUTEX_BUSY_OR_ABANDONED' -or $canary.reasons -contains 'OBSERVATION_FAILED') {
    throw 'Canary did not prove an exclusive log-only observation. No task registered.'
}

$scheduledAction = New-ScheduledTaskAction -Execute $plan.Execute -Argument $plan.Arguments -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $scheduledAction -Trigger $trigger -Settings $settings -Principal $principal -ErrorAction Stop | Out-Null
$plan | ConvertTo-Json -Depth 4
$canary | ConvertTo-Json -Depth 4