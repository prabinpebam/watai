# Local validation evidence — 2026-09-10

## Scope and safeguards

- Baseline: `f7dc195300c4039aae5b9a7a8fb1691327864ea1`.
- Worktree: `C:\Users\prabi\.copilot\repos\copilot-worktrees\watai\prabinpebam-cautious-telegram`.
- Scratch/evidence root (`$scratch` below): `C:\Users\prabi\.copilot\session-state\0a7e9fca-0e2d-4488-82e0-cc1824a45e7e\files`.
- Windows; Node `v22.19.0`; npm `10.9.3`; frontend/API Vitest `2.1.9`; Vite `5.4.21`; Playwright `1.61.1`.
- Audit-only execution: no application, test, configuration, manifest, lockfile, or tracked deployment asset changes; no commits. Other audit documents are being authored concurrently.
- Root and API `node_modules` were initially absent. Dependencies were restored separately in this worktree only, **after** each selected test command failed because Vitest was missing. No main-checkout dependencies were reused.
- `.env*` presence checks, excluding `.env.example`, returned zero files at the root and API root. No secret file contents, environment variable values, Azure credentials, or authenticated browser profiles were read.
- Live-test gates were inspected before execution. Every test-run child environment had `COSMOS_ENDPOINT` and `STORAGE_ACCOUNT` explicitly removed, without printing their values. No integration flag was enabled.
- Browser runs used the existing config-managed Vite `webServer` on `http://127.0.0.1:4173`, with `reuseExistingServer: false`. `VITE_WATAI_API_BASE` was explicitly set to `http://127.0.0.1:4173/api` so any API-base-dependent browser request remained local. Existing E2E tests use signed-out pages, local IndexedDB/development fixtures, and an intercepted synthetic upload URL; no cloud sign-in or production operation was requested.
- Package/browser downloads were tooling setup only. No `npm audit`, live Azure test, model request, production call, cloud benchmark, or standalone persistent server was run.
- Raw console output, JSON reports, screenshots, traces, HTML reports, package caches, downloaded browsers, and the frontend build were directed to scratch. Repository-generated dependencies, API bundle, Vite cache, and TypeScript build artifacts are ignored.

## Results at a glance

| Validation | Final recorded result | Exit |
| --- | --- | --- |
| Frontend `npm test` | **32 files, 231 tests passed**; no failed or skipped tests | 0 |
| API `npm test` | **76 files, 557 tests passed**; **5 integration files, 11 tests skipped**; 81 files / 568 tests discovered | 0 |
| API `npm run typecheck` | Passed, no TypeScript diagnostics | 0 |
| API `npm run build` | Passed; `api\dist\index.cjs` emitted, reported 359.8 kB | 0 |
| Frontend `npm run build -- --outDir <absolute scratch frontend-build>` | Passed design-system check, `tsc -b`, and Vite; 795 modules transformed | 0 |
| Playwright complete matrix after browser setup | **36 passed, 16 skipped, 8 failed**, 60 project/test cases, 6 workers | 1 |
| Playwright single targeted serial follow-up | **9 passed, 1 skipped, 0 failed**, 10 selected project/test cases, 1 worker | 0 |

The full browser matrix **was not green**. The targeted follow-up passed all eight previously failing cases, plus one already-passing case; it does not replace the full-matrix result. No code was changed between these runs.

## Commands, setup failures, and evidence

`$repo` denotes the worktree above. Unit tests/builds were invoked as `npm --prefix "$repo" ...` or `npm --prefix "$repo\api" ...`; npm executes the existing script in the corresponding package root. Their output was captured with `Tee-Object`, and `$LASTEXITCODE` was captured immediately after the command pipeline and appended to the log. Playwright commands ran from the worktree root.

| Step | Command / package root | Status and counts | Scratch evidence |
| --- | --- | --- | --- |
| 1 | Frontend `npm test` | Exit 1: `'vitest' is not recognized`; no tests executed | `validation-frontend-test-initial.log` |
| 2 | API `npm test` | Exit 1: same missing Vitest executable; no tests executed | `validation-api-test-initial.log` |
| 3 | Frontend `npm ci --no-audit --no-fund --cache <scratch>\validation-npm-cache` | Exit 0; 322 packages added in 33 s | `validation-frontend-npm-ci.log` |
| 4 | API `npm ci --no-audit --no-fund --cache <scratch>\validation-api-npm-cache` | Exit 0; 117 packages added in 37 s | `validation-api-npm-ci.log` |
| 5 | Frontend `npm test` | Exit 0; 32/32 files and 231/231 tests passed; Vitest duration 45.78 s | `validation-frontend-test.log` |
| 6 | API `npm test` | Exit 0; 76 files / 557 tests passed; 5 files / 11 tests skipped; duration 29.11 s | `validation-api-test.log` |
| 7 | API `npm run typecheck` | Exit 0; `tsc --noEmit`, no diagnostics | `validation-api-typecheck.log` |
| 8 | API `npm run build` | Exit 0; existing esbuild command emitted the bundle; esbuild reported 38 ms | `validation-api-build.log` |
| 9 | Frontend `npm run build -- --outDir "$scratch\frontend-build"` | Exit 0; design-system/TypeScript/Vite passed; Vite reported 19.88 s | `validation-frontend-build.log`; `frontend-build\index.html` and assets |
| 10 | `npx --no-install playwright test --output "$scratch\validation-playwright-initial-results" --reporter=list,json,html` | Exit 1; all 60 cases failed before test bodies because required browser executables were absent; 19.94 s | `validation-playwright-initial.log`; `validation-playwright-initial.json`; `validation-playwright-initial-results\` |
| 11 | `npx --no-install playwright install chromium webkit` | Exit 0; installed browser revisions required by the existing Playwright dependency, not a new package version | `validation-playwright-browser-install.log`; `validation-playwright-browsers\` |
| 12 | `npx --no-install playwright test --output "$scratch\validation-playwright-results" --reporter=list,json,html` | Exit 1; 36 passed / 16 skipped / 8 failed; 142.80 s | `validation-playwright.log`; `validation-playwright.json`; `validation-playwright-results\`; `validation-playwright-report\` |
| 13 | Targeted serial command below | Exit 0; 9 passed / 1 skipped; 17.62 s | `validation-playwright-targeted.log`; `validation-playwright-targeted.json`; `validation-playwright-targeted-results\`; `validation-playwright-targeted-report\` |

The initial Vitest/browser failures were **environment/tooling failures**, not implementation failures. Chromium headless shell revision `1228` and WebKit revision `2311` were missing. The existing installer fetched Chromium/Chrome Headless Shell `149.0.7827.55`, WebKit `26.5`, and Playwright's associated FFmpeg/Winldd components. For installation and subsequent browser runs, `PLAYWRIGHT_BROWSERS_PATH` was `$scratch\validation-playwright-browsers`; `TEMP` and `TMP` were redirected to scratch.

For each browser run, `PLAYWRIGHT_JSON_OUTPUT_NAME` selected the corresponding JSON file and `PLAYWRIGHT_HTML_OUTPUT_DIR` selected the scratch HTML report directory. Screenshots and traces used the command's `--output` override. The initial HTML report was superseded by the complete post-install report; its initial JSON/log/results were retained.

The one targeted follow-up selected the five failing source locations across both affected projects. This includes the already-passing desktop empty/error case and the intentionally skipped mobile upload case:

```powershell
npx --no-install playwright test `
  library-experience.spec.ts:155 library-experience.spec.ts:243 `
  viewport-frame.spec.ts:58 viewport-frame.spec.ts:98 viewport-frame.spec.ts:202 `
  --project desktop --project mobile --workers=1 `
  --output "$scratch\validation-playwright-targeted-results" `
  --reporter=list,json,html
```

All runs retained configured `retries: 0`; the follow-up was a separate invocation, not a hidden retry. Playwright reports `flaky: 0` within each invocation because there were no configured retries. That counter does **not** negate the cross-run instability observed here.

### Run timestamps

- Unit suites both started at local `08:48:02` on 2026-09-10.
- Initial browser/tooling run: `2026-09-10T03:19:08.008Z`.
- Complete post-install browser run: `2026-09-10T03:21:28.007Z`.
- Targeted serial follow-up: `2026-09-10T03:24:31.240Z`.

Durations are runner-reported observations on a shared machine, not performance benchmarks. Independent unit/build commands ran concurrently; Playwright invocations did not overlap.

## API integration gating and skipped coverage

The five integration files use `describe.runIf(RUN)`, where `RUN` is the truthiness of an environment setting:

| File under `api\src\adapters` | Gate | Skipped tests |
| --- | --- | ---: |
| `cosmos\threadStore.integration.test.ts` | `COSMOS_ENDPOINT` | 3 |
| `cosmos\messageStore.integration.test.ts` | `COSMOS_ENDPOINT` | 3 |
| `cosmos\inviteStore.integration.test.ts` | `COSMOS_ENDPOINT` | 1 |
| `cosmos\settingsStore.integration.test.ts` | `COSMOS_ENDPOINT` | 2 |
| `azure\sasMinter.integration.test.ts` | `STORAGE_ACCOUNT` | 2 |
| **Total** | | **11** |

The cloud clients/operations are inside gated hooks/tests. The SAS integration would upload/read/delete a real blob if enabled; Cosmos integrations would mutate/delete real records. They were not enabled. The observed skip counts confirm that these test bodies were not exercised.

Relevant source evidence: `api\src\adapters\cosmos\threadStore.integration.test.ts:6-7,25-39`, `messageStore.integration.test.ts:6-7,23-38`, `inviteStore.integration.test.ts:5-8,12-21`, `settingsStore.integration.test.ts:6-9,13-18`, and `api\src\adapters\azure\sasMinter.integration.test.ts:6-11,16-43`.

### Memory and personalization slice of the same API run

These are subsets of the 557 passing API tests above, extracted from `validation-api-test.log`; no additional suites were run:

| Test file under `api\src` | Passed tests |
| --- | ---: |
| `domain\memory.test.ts` | 17 |
| `application\memoryExtractionService.test.ts` | 10 |
| `application\memoryContextService.test.ts` | 12 |
| `ai\memoryExtractor.test.ts` | 9 |
| `domain\memoryProfile.test.ts` | 7 |
| `application\memoryService.test.ts` | 6 |
| `application\memoryModelService.test.ts` | 7 |
| `domain\memoryExtraction.test.ts` | 4 |
| `http\memoryController.test.ts` | 4 |
| `domain\memoryProfile.render.test.ts` | 4 |
| `domain\memoryRouting.test.ts` | 4 |
| `adapters\cosmos\memoryStore.test.ts` | 3 |
| `adapters\memory\inProcessRetriever.test.ts` | 4 |
| `ai\azureEmbedder.test.ts` | 3 |
| **Memory/retrieval/embedding subtotal: 14 files** | **94** |
| `domain\settings.test.ts` | 7 |
| `http\settingsController.test.ts` | 5 |
| `application\settingsService.test.ts` | 3 |
| **Settings subtotal: 3 files** | **15** |
| **Combined offline subset: 17 files** | **109** |

`adapters\cosmos\settingsStore.integration.test.ts` additionally contributed two intentionally skipped tests, already included in the 11 integration skips. The frontend full-suite output contains no dedicated Settings/personalization-named test file; these API counts must not be presented as frontend Settings UI coverage. No memory smoke/evaluation script or script loading `.env` was executed.

## Browser matrix and failures

The existing config discovers three files and defines `desktop` (Chromium), `mobile` (Chromium with touch/window-size settings), and `mobile-webkit` (iPhone 13 device emulation). Each file was attempted in every project; the test bodies intentionally skip inapplicable project combinations.

### Mocked API and fixture boundaries

| Browser scenario | Boundary actually exercised | Not validated by a pass |
| --- | --- | --- |
| Signed-out auth/iframe cases | Fresh browser contexts, onboarding, synthetic failed-authentication hash fragments, and a locally created silent-response iframe (`tests\e2e\auth-iframe.spec.ts:3-44`) | Successful Entra sign-in/token renewal, switching between real accounts, tenant authorization, or account isolation |
| Library browse/detail/error recovery | `LibraryRuntimeProvider` injects `libraryFixtureApi`; listing, filtering, errors, storage summaries, and lineage are computed from an in-memory fixture catalog. Preview assets use `data:` URLs (`src\features\library\LibraryExperienceFixture.tsx:7-100,108-130,154-158`) | Real list/detail HTTP handlers, Cosmos partitions, cloud quotas, permissions, SAS expiry, or fetching persisted user assets |
| Library upload | Fixture reservation/completion mutate in-memory maps/catalog entries; the test intercepts `https://fixture.blob/**` and returns a synthetic HTTP 201 (`LibraryExperienceFixture.tsx:133-150`; `tests\e2e\library-experience.spec.ts:243-259`) | A real Blob PUT/read roundtrip, actual SAS rights/CORS/expiry, backend validation, durable finalization, or cleanup after service failure |
| Composer picker and “Use in new chat” | A real Composer runs under the same injected fixture API. Its `onSend` only saves selected references into React state and renders a `submitted-items` output (`src\features\library\LibraryPickerExperienceFixture.tsx:11-25`) | Sending a cloud chat, lazy-thread persistence on the server, queue execution, model generation, or cross-device synchronization |
| Chat viewport/history | Development gallery/ChatView components; tests seed synthetic records directly through `LocalRepository` and notify the UI store. Most keyboard tests replace `visualViewport` with an event-driven test object (`src\mocks\ChatGallery.tsx:221-249`; `tests\e2e\viewport-frame.spec.ts:34-55,119-180`) | Real account-scoped local storage, cloud outbox concurrency/retry ordering, cloud reconciliation, or physical-device keyboard behavior |

There is **no browser E2E proof of account isolation, outbox correctness, or real asset roundtrips** in this matrix. Passing local UI routes and API unit tests must not be substituted for those unexecuted integrations. The upload and picker tests exercise frontend orchestration against substitutes, even when their names describe a complete user transaction.

### Complete post-install matrix

| File | Project | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: |
| `auth-iframe.spec.ts` | desktop | 3 | 0 | 0 |
| `auth-iframe.spec.ts` | mobile | 3 | 0 | 0 |
| `auth-iframe.spec.ts` | mobile-webkit | 3 | 0 | 0 |
| `library-experience.spec.ts` | desktop | 7 | 1 | 1 |
| `library-experience.spec.ts` | mobile | 2 | 1 | 6 |
| `library-experience.spec.ts` | mobile-webkit | 2 | 0 | 7 |
| `viewport-frame.spec.ts` | desktop | 4 | 3 | 1 |
| `viewport-frame.spec.ts` | mobile | 5 | 3 | 0 |
| `viewport-frame.spec.ts` | mobile-webkit | 7 | 0 | 1 |
| **Total** | | **36** | **8** | **16** |

### Failure classification

| Source test / failed assertion | Affected full-matrix cases | Evidence and interpretation | Serial follow-up |
| --- | --- | --- | --- |
| `library-experience.spec.ts:243`; click at line 254 | Desktop direct-upload transaction | `getByRole('button', { name: 'Upload' })` matched **four buttons**: the Upload action plus three catalog rows with “Uploaded” in their accessible names. Strict-mode locator failure occurred before the file chooser/upload assertions. **Timing-dependent test-selector ambiguity**, not evidence that a real upload failed. Before rows load the same broad selector can match only the intended action. | Passed |
| `library-experience.spec.ts:155`; assertion at line 157 | Mobile empty/recoverable-error experience | Empty heading absent at the 5 s assertion deadline; captured DOM contained only `status "Loading"` and `button "Developer menu"`. Readiness/startup failure preceded empty/error-state behavior assertions. | Passed |
| `viewport-frame.spec.ts:58`; assertion at line 60 | Desktop and mobile keyboard panning/typing | `.chat--empty` absent at the initial 5 s deadline. Loading-screen snapshot; viewport assertions never reached. | Both passed |
| `viewport-frame.spec.ts:98`; assertion at line 100 | Desktop and mobile zoom/touch behavior | Same initial `.chat--empty` readiness timeout, before zoom/touch assertions. | Both passed |
| `viewport-frame.spec.ts:202`; assertion at line 204 | Desktop and mobile iOS zoom-safe editor size | Same initial `.chat--empty` readiness timeout, before the font-size assertion. | Both passed |

Seven of eight failures were fixture/page-readiness timeouts; all eight disappeared in the single-worker targeted follow-up. This supports **test/development-server startup sensitivity** but does not establish a unique root cause: worker count, warmed development-server cache, and run timing changed together. Do not report a proven product viewport regression or a fully passing E2E baseline from these results.

Full-run screenshots, DOM error contexts, and retained traces are in `validation-playwright-results\`. For example:

- Upload ambiguity: `library-experience-Library-123c9-izes-and-appears-in-Library-desktop\error-context.md`.
- Mobile loading state: `library-experience-Library-cb37b-states-expose-clear-actions-mobile\error-context.md`.
- Desktop viewport loading state: `viewport-frame-Visual-view-df287-keyboard-panning-and-typing-desktop\error-context.md`.

All nine auth-iframe cases passed in the complete matrix. All applicable WebKit cases passed. The 16 skips represent authored project restrictions, not remaining missing-browser failures.

## Non-failing warnings

- Frontend install: `whatwg-encoding@3.1.1` deprecation warning.
- Frontend tests: React Router v7 future-flag notices and three React `act(...)` warnings in the Composer dictation test. All assertions passed.
- Frontend/API tests emitted synthetic error-path diagnostic output (for example sync validation and semantic-router fallback cases); these messages are not failed-test counts.
- Frontend build: two Rollup notices about misplaced `/*#__PURE__*/` annotations in `@microsoft/signalr`'s `Utils.js` (lines 190 and 208); annotations were removed by the bundler.
- Frontend build: large-chunk warning. The largest reported JavaScript chunk was `Markdown-DY9SBXsa.js`, **614.32 kB minified / 186.30 kB gzip**, exceeding Vite's 500 kB advisory threshold. Build still succeeded.

## Preservation checks and limits

After validation:

- `git diff --name-only` returned no tracked changes.
- `git diff --exit-code -- docs package.json package-lock.json api\package.json api\package-lock.json` returned no differences.
- `git status --short` showed only the shared untracked `documentation\audits\` tree before this evidence document was added.
- Both `$scratch\frontend-build\index.html` and `api\dist\index.cjs` existed.
- `git check-ignore` confirmed local dependency directories, API bundle, TypeScript build-info files, and emitted Vite config files are ignored.
- `Get-NetTCPConnection -State Listen -LocalPort 4173` found **zero listeners** after the managed browser runs. No standalone server required termination.

The frontend command explicitly forwarded the absolute scratch `--outDir` through the existing npm build script; the resulting Vite command was observed in the log. The existing `emptyOutDir: true` applied only to that scratch build destination, so no extra `--emptyOutDir` override was needed and tracked `docs` deployment assets were preserved.

### What these results do not prove

- No live Cosmos, Storage/SAS, Key Vault, queue-trigger, SignalR, Entra sign-in, Azure OpenAI, external search, or paid-service integration was validated.
- The API bundle is produced by esbuild with external packages; a successful bundle and typecheck do not establish Azure Functions deployment/startup health.
- Browser tests ran against development-mode fixture routes, not the built production assets. Successful frontend compilation is not a production-host smoke test.
- Browser-device emulation is not physical iOS/Android verification. Firefox and unconfigured browsers were not added.
- No full serial E2E matrix was run after the targeted follow-up. The default complete matrix retains eight observed failures.
- No coverage instrumentation, new test tooling, dependency vulnerability scan, performance benchmark, production-data inspection, or broad manual UI exploration was added.
- Local machine absolute scratch paths and raw artifacts are session evidence, not automatically published audit attachments. This document preserves the portable findings and exact filenames.
