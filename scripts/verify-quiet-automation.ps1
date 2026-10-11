$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:WATAI_WORK_DECISION_PATH = Join-Path $root '.harness-state\background-only-decision.json'
$env:WATAI_EXPENSIVE_COMMAND = 'verified-windowless-watchdog-migration'
$node = (Get-Command node -CommandType Application).Source
try {
    if (-not (Test-Path -LiteralPath $env:WATAI_WORK_DECISION_PATH)) {
        & (Join-Path $PSScriptRoot 'run-quiet-check.ps1') -Check BackgroundDecision
    }
    $work = Get-Content -LiteralPath $env:WATAI_WORK_DECISION_PATH -Raw | ConvertFrom-Json
    if ($work.status -ne 'APPROVED' -or [DateTime]::UtcNow -gt ([DateTime]$work.approvedAt).AddMinutes(6)) { throw 'Background setup work ceiling expired.' }
} finally {
    Remove-Item Env:WATAI_WORK_DECISION_PATH
    Remove-Item Env:WATAI_EXPENSIVE_COMMAND
}
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'continuation-watchdog-task.ps1'), [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw 'Scheduled task script syntax failed.' }
& (Join-Path $PSScriptRoot 'run-quiet-check.ps1') -Check WatchdogLaunchTests
& (Join-Path $PSScriptRoot 'continuation-watchdog-task.ps1') -Action RefreshAction

Add-Type -ReferencedAssemblies 'System.Management' -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading;
public sealed class QuietWindowObserver : IDisposable {
    delegate void Callback(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint eventThread, uint eventTime);
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr window; public uint kind; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; public uint extra; }
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, Callback callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint message, UIntPtr first, IntPtr second);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    readonly Thread thread;
    readonly ManualResetEvent ready = new ManualResetEvent(false);
    readonly int owner = Process.GetCurrentProcess().Id;
    readonly string launcher;
    readonly Callback callback;
    uint threadId;
    Exception failure;
    bool disposed;
    public readonly ConcurrentQueue<string> Violations = new ConcurrentQueue<string>();
    public QuietWindowObserver(string launcherPath) {
        launcher = launcherPath; callback = Observe;
        thread = new Thread(Run); thread.IsBackground = true; thread.Start();
        if (!ready.WaitOne(5000)) throw new Exception("Window observation did not initialize.");
        if (failure != null) throw failure;
    }
    bool Owned(uint processId) {
        for (int depth = 0; depth < 8 && processId > 4; depth++) {
            if (processId == owner) return true;
            using (var query = new ManagementObjectSearcher("SELECT ParentProcessId, CommandLine FROM Win32_Process WHERE ProcessId=" + processId))
            using (var results = query.Get()) {
                bool found = false;
                foreach (ManagementObject process in results) {
                    found = true;
                    var command = Convert.ToString(process["CommandLine"]);
                    if (command.IndexOf(launcher, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                    processId = Convert.ToUInt32(process["ParentProcessId"]);
                }
                if (!found) return false;
            }
        }
        return false;
    }
    void Observe(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint eventThread, uint eventTime) {
        if (window == IntPtr.Zero || objectId != 0 || childId != 0) return;
        uint process; GetWindowThreadProcessId(window, out process);
        try { if (Owned(process)) Violations.Enqueue((kind == 3 ? "foreground:" : "window-show:") + process); }
        catch { Violations.Enqueue("observation-unavailable"); }
    }
    void Run() {
        threadId = GetCurrentThreadId();
        IntPtr foreground = SetWinEventHook(3, 3, IntPtr.Zero, callback, 0, 0, 0);
        IntPtr shown = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, callback, 0, 0, 0);
        if (foreground == IntPtr.Zero || shown == IntPtr.Zero) failure = new Exception("Window event hooks unavailable.");
        ready.Set();
        try {
            if (failure == null) { Message message; while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref message); DispatchMessage(ref message); } }
        } finally { if (foreground != IntPtr.Zero) UnhookWinEvent(foreground); if (shown != IntPtr.Zero) UnhookWinEvent(shown); }
    }
    public void Dispose() { if (disposed) return; disposed = true; PostThreadMessage(threadId, 0x0012, UIntPtr.Zero, IntPtr.Zero); if (!thread.Join(5000)) throw new Exception("Window observation did not stop."); ready.Dispose(); }
}
'@

$observer = $null
$watcher = $null
$passed = $false
$before = [QuietWindowObserver]::GetForegroundWindow().ToInt64()
try {
    $observer = New-Object QuietWindowObserver((Join-Path $PSScriptRoot 'continuation-watchdog-hidden.vbs'))
    $watcher = New-Object System.IO.FileSystemWatcher((Join-Path $root '.harness-state'), 'continuation-watchdog-decisions.jsonl')
    $watcher.EnableRaisingEvents = $true
    $started = [DateTime]::UtcNow
    Enable-ScheduledTask -TaskName 'Watai Continuation Watchdog' | Out-Null
    Start-ScheduledTask -TaskName 'Watai Continuation Watchdog'
    $change = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::Changed, 15000)
    if ($change.TimedOut) { throw 'Windowless scheduled canary produced no decision; WSH or task execution may be blocked.' }
    & (Join-Path $PSScriptRoot 'run-quiet-check.ps1') -Check WatchdogLaunchTests
    $decision = Get-Content (Join-Path $root '.harness-state\continuation-watchdog-decisions.jsonl') -Tail 1 | ConvertFrom-Json
    $info = Get-ScheduledTaskInfo -TaskName 'Watai Continuation Watchdog'
    if ([DateTime]$decision.at -lt $started -or $decision.mode -ne 'log-only' -or $decision.dispatched -ne $false -or $info.LastTaskResult -ne 0) {
        throw 'Windowless scheduled execution was not confirmed.'
    }
    $observer.Dispose()
    $violations = @($observer.Violations.ToArray())
    if ($violations.Count) { throw ('Automation window/focus observation failed: ' + ($violations -join ',')) }
    $passed = $true
    [ordered]@{ status = 'PASSED'; mode = $decision.mode; dispatched = $decision.dispatched; taskExitCode = $info.LastTaskResult;
        foregroundBefore = $before; foregroundAfter = [QuietWindowObserver]::GetForegroundWindow().ToInt64();
        automationWindowEvents = $violations; observedAt = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json -Depth 4 | Tee-Object -FilePath (Join-Path $root '.harness-state\background-only-evidence.json')
} finally {
    if ($watcher) { $watcher.Dispose() }
    if (-not $passed) {
        Disable-ScheduledTask -TaskName 'Watai Continuation Watchdog' | Out-Null
        if ($observer) { $observer.Dispose() }
    }
}