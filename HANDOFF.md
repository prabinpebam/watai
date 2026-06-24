# Watai — Agent Handoff

> **Purpose:** Let an agent on another machine pick up this project seamlessly.
> Everything needed to resume is in this file. Read **§0 START HERE** first.
>
> - **Last commit at handoff:** `b2c57c1` on branch `master` (working tree clean, all pushed).
> - **Handoff written:** 2026-06-24
> - **Repo:** https://github.com/prabinpebam/watai (public)
> - **Live frontend:** https://prabinpebam.github.io/watai/ (GitHub Pages, served from `master` `/docs`)
> - **Live API:** https://func-watai-cbroocyg3omrk.azurewebsites.net/api/health

---

## 0. START HERE (first actions on the new device)

1. **Clone + install**
   ```powershell
   git clone https://github.com/prabinpebam/watai.git
   cd watai
   npm install              # frontend deps (repo root)
   cd api; npm install; cd ..   # backend deps
   ```
2. **Tooling needed:** Node.js (a 20.x or 22.x is best — see gotcha about Node 24 in §10), Azure CLI (`az`), Azure Functions Core Tools v4 (`func`), GitHub CLI optional.
3. **Sign in to Azure as the PERSONAL account** (not the work account):
   ```powershell
   az login --tenant a4190f7e-d2ed-4eba-a23b-f436c5195d42 --use-device-code
   az account set --subscription 0675b2b4-5a9e-41bc-8f24-7d6d09a0ce48
   az ad signed-in-user show --query "{oid:id, upn:userPrincipalName}" -o json
   # Expect upn: admin@prabinpebamgmailcom.onmicrosoft.com (oid c8781b4d-2288-44b0-ae34-d2e0e1a4a5c8)
   ```
   The data-plane role grants for integration tests are bound to that **oid**, so you must be that user.
4. **Verify everything still works:**
   ```powershell
   cd api; npm test; cd ..        # expect 90 passed, 10 skipped
   curl https://func-watai-cbroocyg3omrk.azurewebsites.net/api/health   # expect 200 {"ok":true,...}
   ```
5. **Resume work.** §8 Entra External ID provisioning is **fully DONE** (auth live + proven). §9 (cloud Repository + sync engine) is **code-complete**: the cloud API client, local-first `SyncRepository`, MSAL auth, and the Settings UI (sync toggle + sign-in) and a background sync scheduler are all built, tested, and pushed; the backend supports client-supplied idempotent thread ids (deployed + verified). What remains is the **frontend production build/deploy** (`npm run build` → commit `docs/`) plus a real-browser sanity check. See §9.

---

## 1. What is Watai

A ChatGPT-iOS-style PWA powered by the user's **own Azure OpenAI endpoint (bring-your-own key)**.
Local-first (IndexedDB) with **optional cloud sync** through a custom persistence API.

**Two-plane architecture (critical security invariant):**
- **AI plane:** the browser calls the user's Azure OpenAI endpoint **directly** with the user's BYO key. The key lives only in the browser (IndexedDB `secureStore`). It **never** touches our backend or any secret store.
- **Persistence plane:** our Azure Functions API stores threads/messages/settings/assets per authenticated user. It **never** sees the OpenAI key.

---

## 2. Current status snapshot

| Area | Status |
|---|---|
| Frontend (React PWA) | Complete, deployed to GitHub Pages. Local-only (IndexedDB). |
| Backend domain/application/ports | Complete, TDD. |
| In-memory adapters (test doubles) | Complete. |
| Cosmos adapters (threads/messages/settings) | Complete + integration-tested vs real Cosmos. |
| Azure Blob SAS minter (user-delegation) | Complete + integration-tested vs real Storage. |
| Auth: Entra JWT verifier + bearer helper | Complete (offline tests, real RS256). |
| Data endpoints wired behind JWT | Complete + **deployed**. **Auth ON** (AUTH_* set): valid CIAM token → 200, no token → 401 (proven 2026-06-24). |
| Azure infra (Cosmos/Storage/KV/Insights/Function App) | Provisioned (Bicep) in `rg-watai-dev` (East US 2). |
| **Entra External ID (CIAM) tenant** | **DONE** — tenant + SPA app + API scope + user flow created; auth proven. See §8. |
| **Frontend cloud Repository + sync engine** | **Code-complete** (engine + MSAL + UI wired; backend deployed). Not yet built into `docs/` / deployed to Pages. See §9. |

**Tests:** Backend = **90 offline + 13 integration** (10 Cosmos/Storage + 3 separate). Frontend = ~26 (ids, sse, error taxonomy).

---

## 3. Repo layout

```
watai/
  index.html, src/, public/, vite.config.ts   # FRONTEND (React 18 + Vite 5, TS strict)
  docs/                                        # built frontend (GitHub Pages serves this)
  vitest.config.ts                             # frontend test harness (jsdom)
  api/                                         # BACKEND (Azure Functions v4, separate package)
    src/
      domain/        # entities + zod validators + errors (pure)
      application/   # services (ThreadService, MessageService, SettingsService, AssetService)
      ports/         # interfaces (ThreadStore, MessageStore, SettingsStore, SasMinter, TokenVerifier)
      adapters/
        memory/      # in-memory test doubles
        cosmos/      # Cosmos DB adapters (+ *.integration.test.ts)
        azure/       # AzureSasMinter (+ integration test)
        auth/        # EntraTokenVerifier (jose)
      http/          # controllers + respond + authenticate + azureFunctions (runRoute)
      functions/     # health.ts, api.ts (app.http registrations)
      composition.ts # composition root (lazy wiring of real adapters)
      index.ts       # Functions entry: imports ./functions/health + ./functions/api
    host.json, .funcignore, package.json, vitest.config.ts, tsconfig.json
  infra/
    main.bicep, main.dev.bicepparam            # all Azure IaC
  spike/cors-streaming.html                    # ADR-003 CORS+SSE probe
  documentation/seed-spec.md                   # original product/architecture spec
  HANDOFF.md                                   # this file
```

---

## 4. Build / test / run commands

### Frontend (repo root)
```powershell
npm test                 # vitest run
npm run build            # tsc -b && vite build  -> outputs to docs/
npm run dev              # vite dev server (DO NOT auto-launch; user controls this — see §11)
```

### Backend (`api/`)
```powershell
cd api
npm test                 # 90 offline pass, 10 integration skipped (no env vars)
npm run typecheck        # tsc --noEmit
npm run build            # esbuild -> dist/index.cjs
```

### Backend integration tests (need real Azure + be logged in as the granted oid)
```powershell
cd api
# Cosmos:
$env:COSMOS_ENDPOINT="https://cosmos-watai-cbroocyg3omrk.documents.azure.com:443/"; $env:COSMOS_DATABASE="watai"
npx vitest run src/adapters/cosmos
Remove-Item Env:COSMOS_ENDPOINT, Env:COSMOS_DATABASE
# Storage SAS:
$env:STORAGE_ACCOUNT="stwataicbroocyg3omrk"; $env:MEDIA_CONTAINER="media"
npx vitest run src/adapters/azure
Remove-Item Env:STORAGE_ACCOUNT, Env:MEDIA_CONTAINER
```

### Deploy the Functions host (MUST use remote build — see §10)
```powershell
cd api
func azure functionapp publish func-watai-cbroocyg3omrk --build remote
# then smoke test:
curl https://func-watai-cbroocyg3omrk.azurewebsites.net/api/health
```

### Deploy/refresh infra (Bicep)
```powershell
az deployment group create -g rg-watai-dev --parameters infra/main.dev.bicepparam
```

---

## 5. Azure account & subscription (PERSONAL — do not use the work account)

- **Account:** prabinpebam@gmail.com → directory admin user `admin@prabinpebamgmailcom.onmicrosoft.com` (oid `c8781b4d-2288-44b0-ae34-d2e0e1a4a5c8`), Global Administrator of the personal tenant.
- **Home tenant:** `a4190f7e-d2ed-4eba-a23b-f436c5195d42` ("Personal").
- **Subscription:** "Visual Studio Enterprise Subscription" = `0675b2b4-5a9e-41bc-8f24-7d6d09a0ce48`.
- **NOT** the work account `prpebam@microsoft.com` (tenant `72f988bf-...`).
- **Re-auth (token expires):** `az login --tenant a4190f7e-d2ed-4eba-a23b-f436c5195d42 --use-device-code` (device code is reliable; browser-redirect flow has hung before).

---

## 6. Deployed Azure infrastructure (`rg-watai-dev`, East US 2)

Resource-name suffix is `cbroocyg3omrk` (from `uniqueString(rg.id)`).

| Resource | Name | Notes |
|---|---|---|
| Cosmos DB (serverless) | `cosmos-watai-cbroocyg3omrk` | `disableLocalAuth=true` (AAD only). DB `watai`. Containers: users, settings, threads, messages, assets, memory, usage. PKs: threads `/userId`, messages `/threadId`, settings `/userId`. |
| Storage | `stwataicbroocyg3omrk` | Private containers `media` (assets) + `deployments` (Flex package). |
| Key Vault | `kv-watai-cbroocyg3omrk` | RBAC auth, soft-delete on. |
| App Insights / Log Analytics | `appi-watai-dev` / `log-watai-dev` | |
| Function App (Flex Consumption FC1) | `func-watai-cbroocyg3omrk` | Node 20, system-assigned MI. https://func-watai-cbroocyg3omrk.azurewebsites.net |

**Role grants already in place** (bound to oid `c8781b4d…` = the signed-in dev user, and to the Function App MI):
- Function App MI: Storage Blob Data Contributor, Key Vault Secrets User, Cosmos Built-in Data Contributor.
- Dev user oid: Cosmos Built-in Data Contributor (for integration tests) + Storage Blob Data Contributor on the storage account (for SAS tests + `generateUserDelegationKey`).

### Deployed API surface (all routes `authLevel: anonymous` — our JWT middleware does auth, not Functions keys)
```
GET    /api/health                              (open)
GET/POST              /api/threads
GET/PATCH/DELETE      /api/threads/{id}
GET/POST              /api/threads/{threadId}/messages
GET/PATCH             /api/settings
POST                  /api/assets/sas
```
**Auth gate:** `composition.ts buildVerifier()` returns a **deny-all** verifier unless the app settings `AUTH_ISSUER` + `AUTH_AUDIENCE` + `AUTH_JWKS_URI` are all set. They are now **set** (§8), so the real `EntraTokenVerifier` is active: a **valid CIAM token → 200**, **no/invalid token → 401**. Verified live 2026-06-24. To revert to fail-closed, remove any of the 3 settings.

---

## 7. Backend architecture (clean / hexagonal) — what's done

- **domain/**: `errors.ts` (AppError + code→HTTP map + safe envelope, no leakage), `validate.ts` (zod `parseOrThrow`), `thread.ts`/`message.ts`/`settings.ts`/`asset.ts` (zod validators, strict).
- **auth/identity.ts**: `identityFromClaims` — userId from token `oid` then `sub` (never from body → prevents IDOR).
- **ports/**: `ThreadStore`, `MessageStore`, `SettingsStore`, `SasMinter`, `TokenVerifier`.
- **adapters/cosmos/**: `CosmosThreadStore`, `CosmosMessageStore`, `CosmosSettingsStore` (+ integration tests). `cosmosClient.ts` uses `DefaultAzureCredential`.
- **adapters/azure/sasMinter.ts**: `AzureSasMinter` — user-delegation SAS (AAD-signed, no account key), least-privilege (write=create+write, read=read), cached 1h delegation key.
- **adapters/auth/entraTokenVerifier.ts**: `EntraTokenVerifier` (jose, RS256, JWKS, iss/aud/exp). `entraVerifierFromEnv()` reads `AUTH_ISSUER`/`AUTH_AUDIENCE`/`AUTH_JWKS_URI`.
- **application/**: `ThreadService` (rejects temporary; ownership; `listChanges` delta-pull with tombstones), `MessageService` (ownership via parent thread; idempotent append; thread bump), `SettingsService` (DEFAULT_SETTINGS + section merge), `AssetService` (SAS rooted at `{userId}/{threadId}/{assetId}.{ext}`).
- **http/**: `respond` (error→envelope), `authenticate` (bearer extraction), `azureFunctions.ts` (`runRoute`: authenticate→ApiRequest→controller→response), 4 controllers (threads/messages/settings/assets).
- **functions/**: `health.ts` (anonymous), `api.ts` (method-dispatch route registrations). `composition.ts` lazily wires the real adapters; `index.ts` imports both function modules.

---

## 8. DONE — Entra External ID (CIAM) provisioning + auth turned ON (2026-06-24)

**Why:** to turn on real auth so the deployed API accepts tokens. **Auth is now live and proven.**
The CIAM tenant, SPA app registration, and API scope were created **entirely via Azure CLI + Microsoft
Graph REST** (the old "ARM quickstart retired / must use portal" note was wrong — `Microsoft.AzureActiveDirectory/ciamDirectories` ARM works).

### Provisioned values (live)
| Thing | Value |
|---|---|
| External tenant ID | `f009d35a-019c-4374-8987-2509caf7f66f` |
| Primary domain | `wataiexternal.onmicrosoft.com` (authority host `wataiexternal.ciamlogin.com`) |
| CIAM ARM resource | `Microsoft.AzureActiveDirectory/ciamDirectories/wataiexternal.onmicrosoft.com` in `rg-watai-dev` |
| SPA app (client) ID | `d26b2bca-8003-4f2a-a3ec-1d36ca706c45` (displayName "Watai PWA", objectId `ad7e16b4-c5a2-4efc-99d3-a1e383a4f3ce`) |
| App ID URI | `api://d26b2bca-8003-4f2a-a3ec-1d36ca706c45` |
| Exposed scope | `access_as_user` (id `6a14b573-7641-437b-ba54-9c7059ad25a7`), `requestedAccessTokenVersion=2`, SPA pre-authorized |
| MSAL scope string (for §9) | `api://d26b2bca-8003-4f2a-a3ec-1d36ca706c45/access_as_user` |
| SPA redirect URIs | `https://prabinpebam.github.io/watai/`, `http://localhost:5173` (also `isFallbackPublicClient=true` for device/ROPC) |

### The 3 app settings now LIVE on `func-watai-cbroocyg3omrk` (turned auth on)
```
AUTH_ISSUER   = https://f009d35a-019c-4374-8987-2509caf7f66f.ciamlogin.com/f009d35a-019c-4374-8987-2509caf7f66f/v2.0
AUTH_AUDIENCE = d26b2bca-8003-4f2a-a3ec-1d36ca706c45
AUTH_JWKS_URI = https://wataiexternal.ciamlogin.com/f009d35a-019c-4374-8987-2509caf7f66f/discovery/v2.0/keys
```
(Issuer/JWKS read verbatim from `https://wataiexternal.ciamlogin.com/<tid>/v2.0/.well-known/openid-configuration`.
Note the **issuer uses the tenant-GUID subdomain**, while the JWKS uses the `wataiexternal` subdomain — both verbatim from metadata.)

### Proven end-to-end (2026-06-24)
- No token → `GET /api/threads` **401** (fail closed). ✓
- Valid CIAM token → `GET /api/threads` **200** `{"threads":[]}`; `POST` **201** (userId from token `oid`, IDOR-safe); persisted in Cosmos; `DELETE` **204**. ✓
- Token claims confirmed: `aud=d26b2bca-…`, `iss=https://f009d35a-…/v2.0`, `ver=2.0`, `scp=access_as_user` — all match the 3 settings.

### How a dev token was minted (reuse for §9 testing)
A throwaway **test user** exists in the CIAM tenant: `watai-tester@wataiexternal.onmicrosoft.com`
(oid `fa7c0a65-ea73-42a9-9226-1d7f3cf00cb3`). Its password was set via Graph and **not** persisted
anywhere (reset it via Graph `PATCH /users/{id}` `passwordProfile` when needed). Token via **ROPC**
(works because `isFallbackPublicClient=true`):
```powershell
$b = @{ grant_type="password"; client_id="d26b2bca-8003-4f2a-a3ec-1d36ca706c45";
  scope="api://d26b2bca-8003-4f2a-a3ec-1d36ca706c45/access_as_user openid profile offline_access";
  username="watai-tester@wataiexternal.onmicrosoft.com"; password="<reset-it>" }
$at = (Invoke-RestMethod -Method Post -ContentType "application/x-www-form-urlencoded" `
  -Uri "https://wataiexternal.ciamlogin.com/f009d35a-019c-4374-8987-2509caf7f66f/oauth2/v2.0/token" -Body $b).access_token
```
**Managing the CIAM tenant from CLI:** `az account get-access-token --tenant f009d35a-019c-4374-8987-2509caf7f66f --resource-type ms-graph`
returns a Graph token non-interactively (the creator admin has access). Use it with `Invoke-RestMethod`
against `graph.microsoft.com`. **Caveat:** the az CLI client token can manage `applications`/`users`
but **lacks** `IdentityProvider`/`EventListener` permissions → cannot create user flows (see leftover).

### Sign-up/sign-in user flow — DONE (2026-06-24, via Azure CLI Graph token)
The az CLI Graph token **does** have `EventListener.ReadWrite.All` (only IdentityProvider *read* was missing), so no interactive `Connect-MgGraph` was needed.
- User flow **"Watai Sign up and sign in"** (id `df122f68-3241-464d-b04a-c84f689ff5de`), type `externalUsersSelfServiceSignUpEventsFlow`, `isSignUpAllowed=true`, identity provider `EmailPassword-OAUTH` (email+password local accounts), collects `email`+`displayName`.
- Linked to the SPA app `d26b2bca-…`.
- **Gotcha:** app registrations created via Graph have **no service principal**; linking an app to a user flow fails with "application id … is invalid" until you `POST /servicePrincipals { "appId": "…" }` (SP id `68ef937d-…`). Then `POST /beta/identity/authenticationEventsFlows/{id}/conditions/applications/includeApplications { "appId": "…" }`.

Self-service customer sign-up/sign-in now works for the PWA. **§8 is fully complete.**

> Note: `EntraTokenVerifier` accepts **RS256** only and enforces iss/aud/exp. `AUTH_AUDIENCE` must
> equal the token's `aud`. If you see 401 with a real token, decode it (jwt.ms) and reconcile
> `iss`/`aud` against the 3 settings.

---

## 9. IN PROGRESS — Frontend cloud Repository + sync engine

### DONE so far (2026-06-24) — engine built, tested, wired; backend deployed
- **`src/data/cloud/`** — `env.ts` (`apiBaseUrl()` from `VITE_WATAI_API_BASE`, default = deployed Function App), `types.ts` (wire `ThreadRecord`/`MessageRecord` + boundary mappers; strips `userId`/`deletedAt`, drops UI-ephemeral message fields), `apiClient.ts` (`WataiApiClient` + `CloudApi` interface; injectable token provider + `fetchImpl`; `CloudError` with `retryable`). **14 tests.**
- **`src/data/sync/`** — `kvStore.ts` (`KvStore` port; `idbKvStore()` over the IDB `kv` store + `memoryKvStore()` for tests), `syncRepository.ts` (`SyncRepository implements Repository`: local-first reads/writes, op queue, `push()` drain with retry/drop, `pull()` thread+message deltas with last-write-wins by `updatedAt`, cursors in `kv`, gated on `Settings.data.sync`, temporary threads never pushed, `backfill()` + `sync()`). **13 tests.**
- **`src/auth/cloudAuth.ts`** — MSAL (`@azure/msal-browser`, lazy dynamic import). Silent `getCloudToken()` (null when signed out), `signIn()`/`signOut()` (popup), using the §8 SPA app `d26b2bca-…`, authority `https://wataiexternal.ciamlogin.com/<tid>`, scope `api://d26b2bca-…/access_as_user`. Config overridable via `VITE_WATAI_CLIENT_ID`/`_AUTHORITY`/`_API_SCOPE` (`src/vite-env.d.ts`).
- **Seam wired** — `src/data/index.ts` now exports `repo = new SyncRepository(new LocalRepository(), new WataiApiClient({ getToken: getCloudToken }), idbKvStore())` plus `syncNow()` and `backfillSync()`. With sync **off** (default) it is a transparent local passthrough, so existing behaviour is unchanged.
- **Backend change (deployed)** — `POST /api/threads` now accepts an optional client `id` and is **idempotent** (mirrors message append), so local ULIDs stay consistent with the cloud. `api/src/domain/thread.ts` + `threadService.ts` + tests (backend now **94** tests). Deployed via `func azure functionapp publish func-watai-cbroocyg3omrk --build remote`. Verified live: `POST {id,title}` twice → `201` same id, original title kept; `DELETE` → `204`.
  - **Deploy gotcha:** a fresh clone has no `api/local.settings.json` (gitignored + funcignored), so `func publish` errors with "Worker runtime cannot be 'None'". Recreate it with `{ "IsEncrypted": false, "Values": { "FUNCTIONS_WORKER_RUNTIME": "node", "AzureWebJobsStorage": "" } }`.

### UI wiring — DONE (2026-06-24)
- **Settings → Data controls → "Sync to cloud" card** (`CloudSyncCard` in `src/features/settings/Settings.tsx`): Entra sign-in/out + a toggle. Enabling signs in (silent if possible, else popup), flips `Settings.data.sync`, then runs `backfillSync()` + `syncNow()`. Shows the signed-in account; sign-out pauses sync.
- **Background sync scheduler** (`src/app/App.tsx`): `syncNow()` on mount, on `window` focus, and every 30s — all no-ops while sync is off or signed out (MSAL only loads when sync is actually used).

### REMAINING for §9
- **Frontend deploy:** the UI sync feature is in source + pushed but **not yet built into `docs/`**, so it isn't live on GitHub Pages. Run `npm run build` and commit `docs/` to publish — plus a real-browser sanity check of the MSAL popup + a sync round-trip.
- **Known gaps to revisit:** the deployed `GET /threads` excludes tombstones (no `includeDeleted` over HTTP), so cross-device **deletes don't propagate on pull** yet (push-side delete works) — expose `listChanges`/`includeDeleted` to fix. Asset (blob) upload via SAS, and message edit/delete sync, are deferred (no server endpoints) and stay local-only for now.

### Reference — original design notes
The frontend was **local-only** (IndexedDB). Goal: a cloud-backed `Repository` + a sync
engine so data syncs to the deployed API for the signed-in user. This depends on §8 (need auth to
call the API), but the **sync logic itself is auth-independent and can be built/tested now** with a
mockable token provider.

### The swap seam (single injection point)
`src/data/index.ts` line ~5: `export const repo: Repository = new LocalRepository();`
Swapping/wrapping this is the **only** change the UI needs — every feature imports `repo` from here.

### Repository interface — `src/data/repository.ts` (implement this for cloud)
```typescript
export interface Repository {
  listThreads(opts?: { includeArchived?: boolean }): Promise<Thread[]>;
  getThread(id: Id): Promise<Thread | null>;
  createThread(init?: Partial<Thread>): Promise<Thread>;
  updateThread(id: Id, patch: Partial<Thread>): Promise<Thread>;
  deleteThread(id: Id): Promise<void>;
  listMessages(threadId: Id): Promise<Message[]>;
  appendMessage(m: Message): Promise<Message>;
  updateMessage(id: Id, patch: Partial<Message>): Promise<Message>;
  deleteMessage(id: Id): Promise<void>;
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlobUrl(key: string): Promise<string>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  listMemory(): Promise<MemoryItem[]>;
  addMemory(m: MemoryItem): Promise<void>;
  removeMemory(id: Id): Promise<void>;
  search(query: string): Promise<SearchHit[]>;
  exportAll(): Promise<Blob>;
  deleteAll(): Promise<void>;
}
```
- Local impl: `src/data/local/localRepository.ts` (170 lines). IDB wrapper `src/data/db.ts` (stores: `threads`, `messages` [index `byThread`], `blobs`, `kv`). IDs = ULID via `src/lib/ids.ts` `newId()`; timestamps ISO via `nowIso()`.
- Frontend domain types: `src/lib/types.ts` (`Thread` L6–17, `Message` L24–40, `Settings` L70–80, `MemoryItem` L83–87).
- Zustand store `src/state/store.ts` (`useUi`) holds UI state only — **no** thread/message/settings data (features read `repo` directly). There is a `threadsVersion` counter used to trigger re-renders after repo writes.
- **No sync code exists yet:** no op-log, no dirty flags, no `since` cursors. `Settings.data.sync: boolean` exists but is unwired (always false).

### Backend API contract (already deployed — map to these)
```
GET    /api/threads?includeArchived=true&since=<ISO>      -> { threads: ThreadRecord[] }
POST   /api/threads { title, temporary }                  -> 201 ThreadRecord
GET    /api/threads/{id}                                   -> ThreadRecord
PATCH  /api/threads/{id} { title?, pinned?, archived? }    -> ThreadRecord
DELETE /api/threads/{id}                                   -> 204 (soft delete)
GET    /api/threads/{threadId}/messages?since=&limit=      -> { messages: MessageRecord[] }
POST   /api/threads/{threadId}/messages { role, content, model?, parentId? } -> 201 MessageRecord
GET    /api/settings                                       -> Settings
PATCH  /api/settings { <section partial> }                 -> Settings
POST   /api/assets/sas { threadId, assetId, op, contentType } -> { blobPath, url, expiresAt }
```
All require `Authorization: Bearer <token>`. The server derives `userId` from the token.

### Model mismatches to translate in the cloud adapter
- Backend records carry `userId`; frontend types don't → strip/add at the boundary.
- `Thread.deletedAt` optional (frontend) vs required `string|null` (backend).
- `Message`: frontend has `status` values `sending|streaming` and `attachments/images/usage/error` (UI-ephemeral, **not** persisted server-side); backend `status` is terminal only (`complete|interrupted|error`) and has `deletedAt` (frontend messages have neither `updatedAt` nor `deletedAt`).
- `temporary` threads: backend **rejects** them — keep temporary threads local-only, never push.
- `Settings`: shapes are identical.

### Recommended approach
- Add `src/data/cloud/cloudRepository.ts` implementing `Repository` against the API, with an
  **injectable token provider** (`() => Promise<string>`) and base URL
  `https://func-watai-cbroocyg3omrk.azurewebsites.net/api` (make it a Vite env var, e.g.
  `import.meta.env.VITE_WATAI_API_BASE` — note the frontend currently uses **no** env vars; add the
  convention). Reuse SSE/fetch patterns from `src/ai/http.ts`.
- Layer a **sync engine** (e.g. `SyncRepository` wrapping local + cloud): op queue + `updatedAt`
  delta pull (`listChanges`) + last-write-wins + tombstone drops; persist the cursor/pending queue
  in the IDB `kv` store. Gate on `Settings.data.sync`.
- **Auth:** add MSAL (`@azure/msal-browser`) for the SPA using the Entra External ID app from §8;
  the token provider returns the acquired access token. Build the sync engine first with a fake
  token provider so it's unit-testable without MSAL.
- Frontend tests: vitest + jsdom (`src/**/*.{test,spec}.{ts,tsx}`, setup `src/test/setup.ts`).
  There are currently **no** tests for the repository layer — add them for the cloud adapter + sync.

---

## 10. Critical gotchas (will bite you if ignored)

- **Functions deploy MUST use `--build remote`.** Default `func ... publish` does a LOCAL build
  (`remotebuild=false`) and `.funcignore` excludes `node_modules`+`dist`, so the package ships with
  no deps → host can't load `@azure/functions` → **empty function list → /api/health 404**.
  `--build remote` makes Oryx run `npm install` + `npm run build` in the cloud.
- **Local `func start` failed on the old device (Node v24).** Functions runtime max is Node 20/22
  ("Incompatible Node.js version"). Use Node 20/22 locally, or skip local host runs and test the
  deployed endpoint. (esbuild bundling itself works on any Node.)
- **Host packaging:** `api` is `"type":"module"`; esbuild bundles `src/index.ts` → `dist/index.cjs`
  (`--format=cjs --packages=external` so `@azure/functions` stays external/shared with the host).
  `package.json` has `"main": "dist/index.cjs"`.
- **Flex Consumption specifics** (in `infra/main.bicep`): needs a `deployments` blob container;
  `functionAppConfig.deployment.storage.authentication.type = 'StorageAccountConnectionString'`
  (NOT `…Secret`); runtime in `functionAppConfig.runtime` (`node`/`20`), NOT `linuxFxVersion`.
  Y1/consumption was unusable (VM quota 0 on this sub) → Flex FC1 chosen.
- **Cosmos `disableLocalAuth=true`** → integration tests need the dev oid to hold a Cosmos
  data-plane role (already granted). Cosmos cold-start can exceed 5s → vitest timeouts raised to 30s.
- **Key Vault soft-delete:** to redeploy a same-named KV after deleting the RG, first
  `az keyvault purge -n <name> --location <region>`.
- **Frontend on GitHub Pages:** Pages serves `master` `/docs`. The build outputs to `docs/`
  (`vite.config.ts` `outDir: 'docs'`, `base: './'`). Commit `docs/` when deploying the frontend.

---

## 11. Conventions & user preferences (respect these)

- **No emoji** in any UI text/labels/status. Use Fluent system icons (mock app) or plain text (tools).
- **Do not auto-launch dev servers** (`npm run dev`, `npm run electron`, `func start`) for visual
  inspection unless the user explicitly asks — the user launches/controls those terminals.
- **Strict TDD** for backend: write the test, then the code. Keep changes minimal and on-scope; don't
  add speculative features/abstractions.
- **Never delete sections** a user marks "DO NOT EDIT OR DELETE".
- **Don't manufacture new problems** after work is verified done against its success criteria.
- Commit style in this repo: Conventional Commits (`feat(api): …`, etc.), multi-line bodies.

---

## 12. Suggested resume prompt for the new agent

> "Read HANDOFF.md. We're mid-way through provisioning Entra External ID (§8) to turn on auth for
> the deployed Watai API, then we build the frontend cloud Repository + sync engine (§9). Here are
> my Entra values: tenant ID = …, primary domain = …, SPA client ID = …, API audience = …. Set the
> AUTH_* app settings, prove `/api/threads` works with a token, then start the cloud Repository."

If the user does **not** yet have Entra values, continue building §9's sync engine against a fake
token provider (auth-independent) and finish Entra wiring when the values arrive.
