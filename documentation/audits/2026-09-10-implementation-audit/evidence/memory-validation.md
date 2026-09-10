# Memory-specific validation evidence

**Date:** 2026-09-10  
**Baseline:** `f7dc195300c4039aae5b9a7a8fb1691327864ea1`  
**Working directory:** `C:\Users\prabi\.copilot\repos\copilot-worktrees\watai\prabinpebam-cautious-telegram`

This records the memory auditor's commands and observed output. The commands originally wrote to the tool console, **not a redirected log file**. This document is the retained transcription; no original machine-generated output path is implied. The separate [baseline validation](validation.md) was performed by another auditor.

No application files were changed. No `.env`, credentials, production stores or production endpoints were accessed by these commands. Existing worktree-local dependencies were used. These tests corroborate, but are **not additive to**, the baseline suite's coverage.

## 1. Focused existing unit tests

Exact PowerShell command:

```powershell
npm --prefix api test -- src/application/memoryService.test.ts src/application/memoryContextService.test.ts src/application/memoryExtractionService.test.ts src/adapters/cosmos/memoryStore.test.ts src/domain/memoryProfile.render.test.ts src/domain/memoryProfile.test.ts src/ai/memoryExtractor.test.ts src/adapters/memory/inProcessRetriever.test.ts src/ai/azureEmbedder.test.ts src/http/memoryController.test.ts src/domain/memory.test.ts src/domain/memoryExtraction.test.ts src/domain/memoryRouting.test.ts
```

Observed runner: Vitest 2.1.9. Exit code: **0**.

```text
Test Files  13 passed (13)
     Tests  87 passed (87)
  Start at  08:52:56
  Duration  23.90s
```

| File under `api\src` | Passed tests |
| --- | ---: |
| `application\memoryService.test.ts` | 6 |
| `application\memoryContextService.test.ts` | 12 |
| `application\memoryExtractionService.test.ts` | 10 |
| `adapters\cosmos\memoryStore.test.ts` | 3 |
| `domain\memoryProfile.render.test.ts` | 4 |
| `domain\memoryProfile.test.ts` | 7 |
| `ai\memoryExtractor.test.ts` | 9 |
| `adapters\memory\inProcessRetriever.test.ts` | 4 |
| `ai\azureEmbedder.test.ts` | 3 |
| `http\memoryController.test.ts` | 4 |
| `domain\memory.test.ts` | 17 |
| `domain\memoryExtraction.test.ts` | 4 |
| `domain\memoryRouting.test.ts` | 4 |

The intentionally failing stub embedder emitted `[memory] query embed failed boom` during its passing fallback test. Successful retrieval tests emitted diagnostic counts. These are test-generated diagnostics, not provider incidents.

The broader baseline's **14 files / 94 memory-related tests** includes seven `memoryModelService` tests omitted from this focused command. Do not sum 87 and 94 or describe them as independent semantic/model benchmarks.

## 2. Synthetic lifecycle observations

This diagnostic uses the installed esbuild dependency to bundle existing TypeScript modules **in memory** (`write:false`). It creates synthetic in-memory stores, a fixed clock, placeholder credentials that no network function receives, and stub embeddings. It invokes public services and, for consolidation failure paths, their compiled private methods. It is an observational probe, **not eleven newly added regression tests**. No script file or generated bundle was written.

Exact executed PowerShell command:

```powershell
@'
const path = require('node:path');
const {buildSync}=require(require.resolve('esbuild',{paths:[path.join(process.cwd(),'api')]}));
const source=`
import {InMemoryMemoryStore} from './api/src/adapters/memory/memoryStore';
import {InProcessRetriever} from './api/src/adapters/memory/inProcessRetriever';
import {MemoryService} from './api/src/application/memoryService';
import {MemoryContextService} from './api/src/application/memoryContextService';
import {MemoryExtractionService} from './api/src/application/memoryExtractionService';
import {buildMemoryProfile} from './api/src/domain/memoryProfile';
import {DEFAULT_SETTINGS} from './api/src/domain/settings';
import {parseMemoryRecord,parseMemoryImport,isRetrievableMemory} from './api/src/domain/memory';
const now='2026-09-10T00:00:00Z';let id=0;const clock={now:()=>now,newId:()=>String(++id)};
const make=(over:any={})=>parseMemoryRecord({id:'m',userId:'u',text:'User likes tea.',kind:'fact',status:'active',confidence:.9,salience:.7,pinned:false,sensitive:false,visibility:'normal',sourceRefs:[{type:'manual',createdAt:now}],embedding:[1,0],embeddingModel:'old-model',createdAt:now,updatedAt:now,useCount:0,...over});
const input={userId:'u',threadId:'t',latestUserText:'tea?',now,creds:{baseUrl:'not-used',key:'stub'}};
async function main(){
const store=new InMemoryMemoryStore();await store.put(make());
const paused={...DEFAULT_SETTINGS,personalization:{...DEFAULT_SETTINGS.personalization,memory:{...DEFAULT_SETTINGS.personalization.memory!,paused:true}}};
const pauseBlock=await new MemoryContextService(store,{get:async()=>paused},{profile:true}).buildForRun(input);
console.log('pauseSuppressesRead',pauseBlock.retrievalMode);
const failureBlock=await new MemoryContextService(store,{get:async()=>{throw Error('settings down')}},{profile:true}).buildForRun(input);
console.log('settingsFailureInjectsProfile',!!failureBlock.profile);
const svc=new MemoryService(store,clock);
await svc.patch('u','m',{status:'invalidated'});const restored=await svc.patch('u','m',{status:'active'});
console.log('restoredStillUnretrievable',!isRetrievableMemory(restored,now));
await svc.delete('u','m');const deleted=await store.get('u','m');console.log('deleteRetainsPayloadVector',!!deleted?.text,!!deleted?.embedding?.length);
const profile=buildMemoryProfile('u',now,[make({text:'User name is Maya.',route:{layer:'long_term_profile',profilePath:'user.details.name',entity:{type:'user',name:'Maya'}}})]);
console.log('routedNameMissingFromStructuredProfile',Object.keys(profile.profile.user.details).length===0);
const s2=new InMemoryMemoryStore();await s2.put(make({id:'pinned',pinned:true,embedding:[0,1]}));for(let i=0;i<3;i++)await s2.put(make({id:'rel'+i}));
const embedder={model:'new-model',embed:async()=>[1,0]};
const pinnedBlock=await new MemoryContextService(s2,{get:async()=>DEFAULT_SETTINGS},{embedder,retriever:new InProcessRetriever(s2)}).buildForRun(input);
console.log('pinExcludedByPreTruncation',!pinnedBlock.memories.some(m=>m.id==='pinned'));
console.log('oldModelEmbeddingsUsed',pinnedBlock.memories.length);
const s3=new InMemoryMemoryStore();const manualSvc=new MemoryService(s3,clock);await manualSvc.createManual('u',{text:'I like tea.'});
const b3=await new MemoryContextService(s3,{get:async()=>DEFAULT_SETTINGS},{embedder,retriever:new InProcessRetriever(s3),profile:true}).buildForRun(input);
console.log('manualMemoryNotPromptVisibleWithHealthyEmbedding',b3.retrievalMode);
let exportRejected=false;try{parseMemoryImport({...await manualSvc.export('u'),mode:'preview'})}catch{exportRejected=true}
console.log('exportCannotDirectlyImport',exportRejected);
const extraction=new MemoryExtractionService({memoryStore:s3,clock} as any);
const messages=[{id:'u1',role:'user',content:'I like tea.',createdAt:now}];
const output={operations:[{op:'add',kind:'fact',text:'User prefers tea.',confidence:.95,salience:.8,sourceMessageIds:['u1'],reason:'test'},{op:'add',kind:'fact',text:'User prefers tea.',confidence:.95,salience:.8,sourceMessageIds:['u1'],reason:'test'}]};
await (extraction as any).applyOperations('u','t','turn',messages,[],output);
console.log('duplicateOperationsCreateDistinctRecords',(await s3.list('u')).memories.filter(m=>m.text==='User prefers tea.').length);
const changed=make({id:'changed',text:'Old tea preference.'});await s3.put(changed);
await (extraction as any).mergeMemory(changed,[],.9,.8,'New coffee preference.',undefined,undefined,undefined,{model:'new-model',embed:async()=>{throw Error('offline')}});
const merged=await s3.get('u','changed');console.log('mergeFailureRetainsOldEmbedding',merged?.text,merged?.embeddingModel,JSON.stringify(merged?.embedding));
}
main().catch(e=>{console.error(e);process.exitCode=1});
`;
const result=buildSync({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
eval(result.outputFiles[0].text);
'@ | node
```

Observed combined stdout/stderr; exit code **0**:

```text
pauseSuppressesRead empty
settingsFailureInjectsProfile true
restoredStillUnretrievable true
deleteRetainsPayloadVector true true
routedNameMissingFromStructuredProfile true
[memory] retrieval candidates=3 cleared=3 selected=3 top=1.000 floor=0.25
pinExcludedByPreTruncation true
oldModelEmbeddingsUsed 3
[memory] retrieval candidates=0 cleared=0 selected=0 top=0.000 floor=0.25
manualMemoryNotPromptVisibleWithHealthyEmbedding empty
exportCannotDirectlyImport true
duplicateOperationsCreateDistinctRecords 2
[memory] write embed failed after retry offline
mergeFailureRetainsOldEmbedding New coffee preference. old-model [1,0]
```

| Observation | Interpretation / finding |
| --- | --- |
| Pause → empty | Contradicts “Pause learning” copy retaining saved-memory availability; MEM-01. |
| Failed settings read → profile | Unknown policy does not fail closed; MEM-01. |
| Restored active record still invalid | `invalidAt` remains after restore; MEM-08. |
| Deleted record retains text/vector | Soft deletion, not payload erasure; MEM-02. |
| Routed user name absent from details | Declared route not populated in structured profile; MEM-08. |
| Pin absent after top-three truncation | Demonstrates the preselection path, but does not alone prove a pin must win final selection; see the refined ranking control below, MEM-06. |
| Three old-model vectors returned | Read path ignores embedding-model identity; MEM-06. |
| Manual save → empty context | No immediate embedding; healthy query embedding closes profile gate; MEM-06. |
| Export envelope rejected by import | No direct portable round-trip; MEM-11. |
| Duplicate operations → two records | Candidate snapshot not updated within operation batch; MEM-04. |
| Changed text retains old vector on failure | Stale vector/text association survives failed merge embedding; MEM-04. |

These observations establish specific deterministic behaviors, not their production incidence, user dissatisfaction, provider quality, or a security exploit. Queue concurrency, real Cosmos transactions, cross-device overwrite, Raw JSON interaction, deletion replay, and temporary-route behavior were **not runtime-tested by this probe**; their report conclusions are labeled static/inferred or attributed to the relevant cross-scope auditor.

## 3. Static Settings detector

Exact command:

```powershell
node "C:\Users\prabi\AppData\Roaming\com.github.githubapp\app-skills\impeccable\scripts\detect.mjs" --json src\features\settings\Settings.tsx
```

Output: `[]`; exit code **0**. No live browser inspection was performed in the memory workstream. Zero detector findings do not validate semantics, privacy controls, or usability.

## 4. Portable, audit-only rerunner

The retained [memory-probe.cjs](memory-probe.cjs) packages the diagnostic without fixed absolute paths. It locates the repository relative to its own file and resolves the existing `api` esbuild dependency. It needs Node and the repository's installed API dependencies; it needs **no environment configuration, credentials, network, browser, provider or database**. Bundles and records remain in process memory. The script is audit evidence, not application code or part of a test suite.

From the repository root:

```powershell
$probe = 'documentation\audits\2026-09-10-implementation-audit\evidence\memory-probe.cjs'
node $probe
node $probe --finding MEM-01
node $probe --help
```

**Executed full command:** `node documentation\audits\2026-09-10-implementation-audit\evidence\memory-probe.cjs`  
**Result:** exit 0; `observationCount: 11`, `unmetContracts: 11`. All actual values below were observed on the baseline.

**Executed portability/selector command:**

```powershell
Set-Location api; node ..\documentation\audits\2026-09-10-implementation-audit\evidence\memory-probe.cjs --finding MEM-01
```

**Result:** exit 0; selected `MEM-01`; two observations/two unmet contracts. This confirms the script does not depend on starting in a particular absolute worktree path.

The JSON output includes `finding`, `caseId`, `actual`, `expected`, and `contractMet`. **Exit 0 means the diagnostic completed**, not that the contracts passed. `expected` describes the recommended or user-facing contract; it is intentionally not a claim about current implemented behavior. A future asynchronous-erasure design should adapt the deletion probe to its documented completion status rather than impose synchronous physical deletion.

| Finding / command | Synthetic setup and operation | Observed actual | Expected contract |
| --- | --- | --- | --- |
| MEM-01 — `node $probe --finding MEM-01` | One active fact; profile enabled; readSaved true; paused true; build context. | Profile present: `false`. | Profile present: `true`; pausing learning preserves permitted reads. |
| MEM-01 — same command | One active fact; settings getter throws; build context. | Profile present: `true`. | `false`; unknown policy disallows personalization. |
| MEM-02 — `node $probe --finding MEM-02` | One active fact with vector; delete; inspect stored record. | `{textRetained:true, vectorRetained:true}`. | Both false at the completion boundary implied by “permanently deleted,” or an honest documented pending-erasure state. |
| MEM-04 — `node $probe --finding MEM-04` | Empty candidate snapshot; two identical add operations in one extraction output. | Matching records: `2`. | `1`; duplicate operations do not duplicate the assertion. |
| MEM-04 — same command | Existing old-model vector; merge changed text; embedding stub throws twice. | Old-model vector retained: `true`. | `false`; stale vectors are removed or made unusable. |
| MEM-06 — `node $probe --finding MEM-06` | Three cosine-1 ordinary records; a fourth cosine-0.95 pinned/top-of-mind record with salience/confidence 1, all same-model. Compare current candidate limit with an injected four-candidate control. | Current selection: `false`; broader-candidate control: `true`. | Both true: the candidate that wins the existing composite ranking must be allowed to compete before final top-k. Pin alone does not guarantee selection. |
| MEM-06 — same command | One cosine-1 record from a different embedding model; query with current-model stub. | Vector results: `1`. | `0` until a compatible vector is available. |
| MEM-06 — same command | Manual save; learning/history extraction off; saved-memory reads/profile on; healthy query embedding. | Memory available in profile/vector context: `false`. | `true`; explicit save availability cannot require later automatic learning. |
| MEM-08 — `node $probe --finding MEM-08` | Invalidate fact, restore active, then check retrieval eligibility at fixed time. | Retrievable: `false`. | `true` for a restored current assertion. |
| MEM-08 — same command | Fact with declared `user.details.name` route for synthetic “Maya”; build structured profile. | Details populated: `false`. | `true`; supported route is discoverable. |
| MEM-11 — `node $probe --finding MEM-11` | Save one manual fact; export; pass export plus `mode:"preview"` to import parser. | Accepted: `false`. | `true` for a portable exported interchange format, or explicit versioned conversion semantics. |

The portable version isolates ranking/model-version cases and explicitly disables learning in the manual-save case; therefore its single wrong-model result differs from the original inline probe's three wrong-model results. Both inputs and outcomes are preserved, not conflated.

**Synthesis correction:** the original orthogonal pinned record did not establish
that widening candidates would make it win. Pinning bypasses a relevance floor;
it does not mandate a final slot. The retained rerunner now uses a near-relevant,
high-importance candidate whose existing composite score is 1.0, versus 0.94 for
the three ordinary candidates. A four-candidate injected retriever is the
positive control. This isolates the early-truncation defect without inventing
a universal pin-selection contract. The original inline command/output above
remains historical evidence rather than being silently rewritten.

Packaging initially hit a lexical-name collision in the audit wrapper's direct `eval`; the wrapper was corrected to invoke the compiled bundle in an isolated function scope, then both commands above succeeded. This was an audit-script packaging failure, not an application finding.

## 5. Final synthesis rerun

After refining the ranking case, the coordinator executed `node --check` on
`memory-probe.cjs` and then ran the complete retained script from the repository
root. Both exited 0. Output again contained **11 observations / 11 unmet
contracts**. The ranking result was:

```json
{
  "caseId": "composite-best-candidate-survives-preselection",
  "actual": {
    "currentSelection": false,
    "broaderCandidateControl": true
  },
  "expected": {
    "currentSelection": true,
    "broaderCandidateControl": true
  },
  "contractMet": false
}
```

This final run's stdout was also captured as `memory-probe-final.log` under the
session scratch directory identified in [baseline validation](validation.md).
The expected synthetic embedding-failure warning appeared on stderr. This is
separate from the original inline console transcription in section 2.
The result remains an audit diagnosis of current code, not a claim that the
application's defects were fixed or that a new regression suite was added.
