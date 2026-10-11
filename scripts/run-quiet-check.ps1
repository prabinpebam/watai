param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('BackgroundDecision', 'WorkDecision', 'WatchdogCheck', 'WatchdogTests', 'WatchdogLaunchTests', 'WatchdogSetup', 'MemoryTests', 'MemoryIndexTests', 'WorkerTests', 'ImageTests', 'LibraryTests', 'MessageTests', 'SyncTests', 'SettingsTests', 'BootstrapTests', 'MemoryArchiveCanary', 'TokenizerInfo', 'TokenizerInstall', 'TokenizerVerify', 'LocalPersistence', 'ApiTests', 'ApiTypes', 'ApiBuild', 'HarnessBuild', 'ChatTests', 'RootTypes', 'Chronology', 'DeployedEvalTests', 'DeployedEvalCalibration', 'DeployedEvalCalibrationStatic', 'DeployedEvalPreflight', 'DeployedEvalPublic', 'DeployedEvalChat', 'DeployedEvalReport', 'DeployedEvalReplay', 'DeployedEvalSyntax', 'DeployedEvalBindAuth', 'DeployedEvalBindChat', 'DeployedEvalPilotPrepare', 'DeployedEvalPilotCalibrationStatic', 'DeployedEvalPilotCalibration', 'DeployedEvalVerifyLogin', 'DeployedEvalReviewCapacity', 'DeployedEvalSdkAuth', 'DeployedEvalSemanticCanary')]
    [string]$Check,
    [string]$WorkRequest,
    [string]$WorkDecision,
    [string]$WorkCommand
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
function Get-ApiSourceFingerprint {
    $files = @(Get-ChildItem (Join-Path $root 'api\src') -File -Recurse)
    foreach ($relative in @('api\package.json', 'api\package-lock.json', 'api\tsconfig.json', 'api\vitest.config.ts')) {
        $path = Join-Path $root $relative
        if (Test-Path $path) { $files += Get-Item $path }
    }
    $entries = @($files | Sort-Object FullName | ForEach-Object {
        '{0}:{1}' -f $_.FullName.Substring($root.Length + 1).Replace('\', '/'), (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    })
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = [BitConverter]::ToString($hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($entries -join "`n"))).Replace('-', '').ToLowerInvariant()
        return '{0} files={1}' -f $digest, $entries.Count
    } finally { $hasher.Dispose() }
}

if ($Check -eq 'WorkDecision') {
    if (-not $WorkRequest -or -not $WorkDecision -or -not $WorkCommand.Trim()) { throw 'Work-decision metadata is required.' }
    $stateRoot = [System.IO.Path]::GetFullPath((Join-Path $root '.harness-state')) + [System.IO.Path]::DirectorySeparatorChar
    $WorkRequest = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $WorkRequest))
    $WorkDecision = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $WorkDecision))
    foreach ($path in @($WorkRequest, $WorkDecision)) {
        if (-not $path.StartsWith($stateRoot, [System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetExtension($path) -ne '.json') {
            throw 'Work-decision metadata must stay inside the workspace state directory.'
        }
    }
}
$arguments = switch ($Check) {
    'DeployedEvalTests' { @('--test', 'tests/e2e/deployed/core.test.mjs', 'tests/e2e/deployed/preparation.test.mjs') }
    'DeployedEvalCalibration' { @('tests/e2e/deployed/calibrate.mjs') }
    'DeployedEvalCalibrationStatic' { @('tests/e2e/deployed/calibrate.mjs', '--check') }
    'DeployedEvalPreflight' { @('tests/e2e/deployed/run.mjs', 'preflight') }
    'DeployedEvalPublic' { @('tests/e2e/deployed/run.mjs', 'public') }
    'DeployedEvalChat' { @('tests/e2e/deployed/run.mjs', 'chat') }
    'DeployedEvalReport' { @('tests/e2e/deployed/run.mjs', 'evaluate') }
    'DeployedEvalReplay' { @('tests/e2e/deployed/run.mjs', 'replay', '0') }
    'DeployedEvalSyntax' { @('--check', 'tests/e2e/deployed/run.mjs') }
    'DeployedEvalBindAuth' { @('tests/e2e/deployed/run.mjs', 'bind-auth-preparation') }
    'DeployedEvalBindChat' { @('tests/e2e/deployed/run.mjs', 'bind-chat-preparation') }
    'DeployedEvalPilotPrepare' { @('tests/e2e/deployed/run.mjs', 'prepare-five-flow-pilot') }
    'DeployedEvalPilotCalibrationStatic' { @('tests/e2e/deployed/pilot-driver-calibration.mjs', '--check') }
    'DeployedEvalPilotCalibration' { @('tests/e2e/deployed/pilot-driver-calibration.mjs') }
    'DeployedEvalVerifyLogin' { @('scripts/verify-pilot-login.mjs') }
    'DeployedEvalReviewCapacity' { @('tests/e2e/deployed/review-codec.mjs') }
    'DeployedEvalSdkAuth' { @('scripts/check-semantic-auth.mjs') }
    'DeployedEvalSemanticCanary' { @('scripts/run-semantic-canary.mjs') }
    'TokenizerVerify' {
        $code = @'
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
const registry='https://packagefeedproxy.microsoft.io/npm/';
const npm=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const run=args=>execFileSync(process.execPath,[npm,...args,'--registry='+registry,'--fetch-retries=0','--fetch-timeout=30000','--update-notifier=false'],{encoding:'utf8',windowsHide:true,timeout:45000,stdio:['ignore','pipe','pipe']});
const config=JSON.parse(run(['config','list','--json']));
const omit=config['omit-lockfile-registry-resolved'];
console.log(JSON.stringify({registry:config.registry,strictSSL:config['strict-ssl'],replaceRegistryHost:config['replace-registry-host'],omitResolved:omit}));
if(config.registry!==registry || config['strict-ssl']!==true || config['replace-registry-host']!=='never' || omit!==true) throw new Error('Effective source settings do not explain the installed lock record.');
const metadata=JSON.parse(run(['view','gpt-tokenizer@4.0.0','version','dist.tarball','dist.shasum','dist.integrity','--json']));
const expected='https://ms-feed-25.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/gpt-tokenizer/-/gpt-tokenizer-4.0.0.tgz';
const locked=JSON.parse(readFileSync('package-lock.json','utf8')).packages['node_modules/gpt-tokenizer'];
const installed=JSON.parse(readFileSync('node_modules/gpt-tokenizer/package.json','utf8'));
const integrity='sha1-'+Buffer.from(metadata['dist.shasum'],'hex').toString('base64');
if(metadata.version!=='4.0.0' || metadata['dist.tarball']!==expected || locked.version!=='4.0.0' || installed.version!=='4.0.0' || locked.integrity!==integrity) throw new Error('Pinned tokenizer metadata does not match the installed declaration.');
const cl100k=await import('gpt-tokenizer/encoding/cl100k_base');
const o200k=await import('gpt-tokenizer/encoding/o200k_base');
const examples=['Concise saved preference.','\u6771\u4eac\u3067\u4f1a\u8b70'];
const counts=examples.map(text=>{const first=cl100k.encode(text),second=o200k.encode(text);if(cl100k.decode(first)!==text || o200k.decode(second)!==text) throw new Error('Encoder round trip failed.');return {cl100k:first.length,o200k:second.length};});
console.log(JSON.stringify({version:installed.version,metadataRequests:1,artifactOrigin:new URL(expected).origin,integrity,encoderCounts:counts,roundTrip:true}));
'@
        @('--input-type=module', '--eval', $code)
    }
    'TokenizerInstall' {
        $code = @'
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
const registry='https://packagefeedproxy.microsoft.io/npm/';
const npm=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const options={encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']};
const config=JSON.parse(execFileSync(process.execPath,[npm,'config','list','--json','--registry='+registry],options));
if(config.registry!==registry || config['strict-ssl']!==true || config['replace-registry-host']!=='never') throw new Error('Tokenizer package routing is not verified.');
const before=JSON.parse(readFileSync('package-lock.json','utf8'));
const child=spawn(process.execPath,[npm,'install','gpt-tokenizer@4.0.0','--save-exact','--ignore-scripts','--no-audit','--no-fund','--registry='+registry,'--fetch-retries=0','--fetch-timeout=30000','--maxsockets=1','--update-notifier=false','--loglevel=http'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let requests=0, pending='',stopped=false;
const timer=setTimeout(()=>{stopped=true;child.kill();},90000);
child.stdout.resume();
child.stderr.on('data',data=>{pending+=data.toString(); const lines=pending.split('\n');pending=lines.pop();for(const line of lines){if(/http fetch/.test(line)){requests++;if(requests>=19){stopped=true;child.kill();}}}});
const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
clearTimeout(timer);
console.log(JSON.stringify({registry,requests,exit,stopped}));
if(exit!==0 || stopped) throw new Error('Pinned tokenizer installation did not complete within its limits.');
const after=JSON.parse(readFileSync('package-lock.json','utf8'));
const added=after.packages['node_modules/gpt-tokenizer'];
const artifact=new URL(added.resolved);
if(added.version!=='4.0.0' || artifact.protocol!=='https:' || !artifact.hostname.endsWith('.pkgs.visualstudio.com') || !added.integrity?.startsWith('sha512-')) throw new Error('Installed tokenizer artifact provenance failed.');
const clean=lock=>{const result=structuredClone(lock);delete result.packages['node_modules/gpt-tokenizer'];delete result.packages[''].dependencies['gpt-tokenizer'];return result;};
if(!isDeepStrictEqual(clean(before),clean(after))) throw new Error('Unrelated package-lock changes detected.');
const cl100k=await import('gpt-tokenizer/encoding/cl100k_base');
const o200k=await import('gpt-tokenizer/encoding/o200k_base');
const examples=['Concise saved preference.','\u6771\u4eac\u3067\u4f1a\u8b70'];
console.log(JSON.stringify({version:added.version,artifactOrigin:artifact.origin,integrity:added.integrity,encoderCounts:examples.map(text=>({cl100k:cl100k.encode(text).length,o200k:o200k.encode(text).length}))}));
'@
        @('--input-type=module', '--eval', $code)
    }
    'TokenizerInfo' {
        $code = @'
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
const registry='https://packagefeedproxy.microsoft.io/npm/';
const npm=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const run=args=>execFileSync(process.execPath,[npm,...args,'--registry='+registry,'--fetch-retries=0','--fetch-timeout=30000'],{encoding:'utf8',windowsHide:true,timeout:45000,stdio:['ignore','pipe','pipe'],maxBuffer:2097152});
try {
 const config=JSON.parse(run(['config','list','--json']));
 if(config.registry!==registry || config['strict-ssl']===false) throw new Error('Effective package source or TLS policy does not match.');
 const scopes=Object.entries(config).filter(([key])=>key.endsWith(':registry')).map(([key,value])=>({scope:key,origin:new URL(value).origin}));
 console.log(JSON.stringify({registry:config.registry,strictSSL:config['strict-ssl'],replaceRegistryHost:config['replace-registry-host'],scopes}));
 const metadata=JSON.parse(run(['view','gpt-tokenizer','version','dist.tarball','license','dependencies','--json']));
 const artifact=new URL(metadata['dist.tarball']);
 if(artifact.protocol!=='https:' || !['packagefeedproxy.microsoft.io','pkgs.dev.azure.com'].includes(artifact.hostname) && !artifact.hostname.endsWith('.pkgs.visualstudio.com')) throw new Error('Package metadata returned an unapproved artifact host: '+artifact.hostname);
 console.log(JSON.stringify({version:metadata.version,artifactOrigin:artifact.origin,artifactPath:artifact.pathname,license:metadata.license,dependencies:metadata.dependencies??{}}));
} catch(error) { console.error(error.status===undefined ? error.message : 'Tokenizer metadata command failed; exit='+error.status); process.exitCode=1; }
'@
        @('--input-type=module', '--eval', $code)
    }
    'BackgroundDecision' { @((Join-Path (Split-Path $node -Parent) 'node_modules\npm\bin\npm-cli.js'), 'run', 'harness:work-decision', '--', '.harness-state/background-only-request.json') }
    'WorkDecision' { @((Join-Path (Split-Path $node -Parent) 'node_modules\npm\bin\npm-cli.js'), 'run', 'harness:work-decision', '--', $WorkRequest) }
    'WatchdogCheck' { @('.harness-dist/continuationWatchdog.js', 'check') }
    'WatchdogTests' { @('node_modules/vitest/vitest.mjs', 'run', 'harness/src/watchdog.test.ts', '--reporter=dot') }
    'WatchdogLaunchTests' { @('node_modules/vitest/vitest.mjs', 'run', 'harness/src/watchdog.test.ts', '-t', 'windowless', '--reporter=dot') }
    'WatchdogSetup' { @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'verify-quiet-automation.ps1')) }
    'MemoryTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/application/memoryService.test.ts', 'src/adapters/cosmos/memoryStore.test.ts', 'src/application/memoryExtractionService.test.ts') }
    'MemoryIndexTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/application/memoryIndexService.test.ts', 'src/application/memoryService.test.ts', 'src/adapters/cosmos/memoryStore.test.ts', 'src/adapters/cosmos/settingsStore.test.ts', 'src/application/memoryExtractionService.test.ts', 'src/domain/settings.test.ts', 'src/application/settingsService.test.ts', 'src/application/memoryContextService.test.ts', 'src/domain/memoryProfile.test.ts', 'src/http/settingsController.test.ts', 'src/domain/memory.test.ts', '--reporter=dot') }
    'ApiTests' { @('node_modules/vitest/vitest.mjs', 'run', '--reporter=dot', '--bail=1') }
    'BootstrapTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/app/Protected.test.tsx', '--reporter=dot') }
    'MemoryArchiveCanary' { @('tests/e2e/memory-archive.mjs') }
    'ImageTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/ai/image.test.ts', 'src/ai/http.test.ts', 'src/application/imageWorker.test.ts', '--reporter=dot') }
    'LibraryTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/application/libraryService.test.ts', 'src/adapters/cosmos/libraryStore.test.ts', '--reporter=dot') }
    'MessageTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/application/messageService.test.ts', 'src/application/runService.test.ts', 'src/http/messagesController.test.ts', 'src/http/runsController.test.ts', 'src/adapters/cosmos/ownerScopedChildStores.test.ts', 'src/adapters/cosmos/threadStore.test.ts', '--reporter=dot') }
    'SyncTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/data/sync/syncRepository.test.ts', 'src/data/accountIsolation.test.ts', '--reporter=dot') }
    'SettingsTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/features/settings/MemoryManager.test.tsx', 'src/features/settings/ModelsBody.test.tsx', 'src/features/settings/DataRetentionStatus.test.tsx', 'src/features/settings/useSettings.test.tsx', '--reporter=dot') }
    'WorkerTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/application/runWorker.test.ts', 'src/application/runService.test.ts', 'src/application/runDispatchService.test.ts', 'src/adapters/cosmos/ownerScopedChildStores.test.ts', 'src/ai/containerFiles.test.ts', 'src/ai/http.test.ts', 'src/ai/responses.test.ts', 'src/adapters/cosmos/libraryStore.test.ts', 'src/application/libraryService.test.ts', 'src/ai/azureEmbedder.test.ts', 'src/application/memoryContextService.test.ts', '--reporter=dot') }
    'ApiTypes' { @('node_modules/typescript/bin/tsc', '--noEmit') }
    'ApiBuild' { @('--input-type=module', '--eval', "import { build } from 'esbuild'; await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', packages: 'external', outfile: 'dist/index.cjs', logLevel: 'info' });") }
    'HarnessBuild' { @('node_modules/typescript/bin/tsc', '-p', 'tsconfig.harness.build.json') }
    'ChatTests' { @('node_modules/vitest/vitest.mjs', 'run', 'src/features/chat/useChat.test.tsx', 'src/features/chat/ordering.test.ts', 'src/features/chat/serverRun.test.ts', '--reporter=dot') }
    'RootTypes' { @('node_modules/typescript/bin/tsc', '--noEmit') }
    'Chronology' { @('tests/e2e/chronology/browser.mjs') }
    'LocalPersistence' { @('tests/e2e/local-persistence.mjs') }
}
$workingDirectory = if ($Check -in @('MemoryTests', 'MemoryIndexTests', 'WorkerTests', 'ImageTests', 'LibraryTests', 'MessageTests', 'ApiTests', 'ApiTypes', 'ApiBuild', 'TokenizerInfo', 'TokenizerInstall', 'TokenizerVerify')) { Join-Path $root 'api' } else { $root }
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = if ($Check -eq 'WatchdogSetup') { Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' } else { $node }
$start.Arguments = ($arguments | ForEach-Object { '"{0}"' -f $_ }) -join ' '
$start.WorkingDirectory = $workingDirectory
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.RedirectStandardInput = $true
if ($Check -eq 'WorkDecision') {
    $start.EnvironmentVariables['WATAI_WORK_DECISION_PATH'] = $WorkDecision
    $start.EnvironmentVariables['WATAI_EXPENSIVE_COMMAND'] = $WorkCommand
}
$start.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$start.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $start
try {
    $before = if ($Check -eq 'ApiTests') { Get-ApiSourceFingerprint } else { $null }
    if ($before) { Write-Output "API source before: $before" }
    if (-not $process.Start()) { throw 'Hidden check did not start.' }
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $boundedCheck = $Check -eq 'ApiTests' -or $Check -like 'DeployedEval*'
    $checkLimit = if ($Check -eq 'DeployedEvalSdkAuth') { 20000 } else { 120000 }
    if ($boundedCheck -and -not $process.WaitForExit($checkLimit)) {
        $stopInfo = New-Object System.Diagnostics.ProcessStartInfo
        $stopInfo.FileName = Join-Path $env:SystemRoot 'System32\taskkill.exe'
        $stopInfo.Arguments = "/PID $($process.Id) /T /F"
        $stopInfo.UseShellExecute = $false
        $stopInfo.CreateNoWindow = $true
        $stopInfo.RedirectStandardOutput = $true
        $stopInfo.RedirectStandardError = $true
        $stopInfo.RedirectStandardInput = $true
        $stopper = New-Object System.Diagnostics.Process
        $stopper.StartInfo = $stopInfo
        try {
            if (-not $process.HasExited -and $stopper.Start()) {
                $stopper.StandardInput.Close()
                $stopOutput = $stopper.StandardOutput.ReadToEndAsync()
                $stopError = $stopper.StandardError.ReadToEndAsync()
                if (-not $stopper.WaitForExit(5000)) { $stopper.Kill() }
                if ($stopOutput.IsCompleted) { Write-Output $stopOutput.GetAwaiter().GetResult() }
                if ($stopError.IsCompleted) { Write-Output $stopError.GetAwaiter().GetResult() }
            }
        } finally { $stopper.Dispose() }
        if ($stdout.IsCompleted) { Write-Output $stdout.GetAwaiter().GetResult() }
        if ($stderr.IsCompleted) { Write-Output $stderr.GetAwaiter().GetResult() }
        throw "Hidden check exceeded its $checkLimit-millisecond process ceiling; no retry was started."
    }
    if (-not $boundedCheck) { $process.WaitForExit() }
    if ($boundedCheck) {
        if (-not $stdout.Wait(5000) -or -not $stderr.Wait(5000)) { throw 'Output capture exceeded its bounded grace period.' }
    }
    Write-Output $stdout.GetAwaiter().GetResult()
    $errorText = $stderr.GetAwaiter().GetResult()
    if ($Check -eq 'WatchdogCheck') {
        if ($errorText.Trim()) { Write-Warning $errorText }
    } else { Write-Output $errorText }
    if ($before) {
        $after = Get-ApiSourceFingerprint
        Write-Output "API source after: $after"
        if ($before -ne $after) { throw 'API sources changed during the unit gate; evidence is not candidate-bound.' }
    }
    if ($process.ExitCode -ne 0) { throw "Hidden check failed with exit code $($process.ExitCode)." }
} finally { $process.Dispose() }