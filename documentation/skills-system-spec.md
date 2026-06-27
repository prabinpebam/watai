# Skills System — Research, Spec & Plan

Status: DRAFT for review. Author: agent. Goal: make Watai's agent + code
interpreter accept **Agent Skills in the canonical open‑standard format** (a
`SKILL.md` folder with reference docs, scripts, and assets), use them effectively,
and let users **manage their own skills** (upload, enable/disable, replace,
delete) alongside service **default skills** they can turn off — demoed with a PDF
skill. Skills are **global / account‑scoped**, never thread‑scoped.

---

## 1. The question, answered

> Does our code interpreter and agent have the option to set this skill up and
> use it for generating PDFs?

**Yes**, and more generally: we can support the whole Agent Skills standard. The
Azure OpenAI *Responses* `code_interpreter` tool accepts `container.file_ids`;
Files API uploads (`purpose=assistants`) are mounted into the sandbox at
`/mnt/data/<filename>`. We already use this to mount thread documents and to
capture generated artifacts. By mounting a skill's files and pointing the model
at them in the system prompt, we reproduce the standard's "agent reads files from
a filesystem" model on top of Azure's sandbox.

Two constraints shape the build:

1. **Licensing.** The Anthropic repo is explicit: the *document* skills
   (`pdf`, `docx`, `pptx`, `xlsx`) are **source‑available, NOT open source** —
   `pdf/LICENSE.txt` is proprietary and forbids extracting/copying/redistributing
   the files or making derivative works outside Anthropic's own services. So we
   **do not** bundle Anthropic's PDF skill. We author an **original,
   license‑clean** PDF skill in the same canonical format (the example skills in
   that repo are Apache‑2.0 and could be used directly; the document ones cannot).
2. **A faithful packaging layer.** Azure mounts files *flat*; a skill is a
   *folder*. We bridge that (zip + extract, §4.1) so any spec‑compliant skill
   works unmodified, including binary assets.

---

## 2. What a "skill" is — the Agent Skills standard

Source: `agentskills.io/specification` (the format Anthropic released as an open
standard on 2025‑12‑18; now also supported by VS Code, GitHub Copilot, OpenAI
Codex, Gemini CLI, Cursor, and many others).

### 2.1 A skill is a folder

```
skill-name/                 (folder name MUST equal frontmatter `name`)
├── SKILL.md                Required: YAML frontmatter + Markdown instructions
├── references/             Optional: on-demand docs (REFERENCE.md, FORMS.md, …)
├── scripts/                Optional: executable helpers (run, don't read — deterministic)
├── assets/                 Optional: templates, fonts, images, schemas (often BINARY)
└── …                       Any additional files/dirs
```

### 2.2 `SKILL.md` frontmatter (the parser + upload‑validation contract)

| Field           | Req | Constraints |
| --------------- | --- | ----------- |
| `name`          | yes | 1–64 chars; `[a-z0-9-]`; no leading/trailing or consecutive `-`; equals folder name |
| `description`   | yes | 1–1024 chars; says *what* it does and *when* to use it; keyword‑rich (drives discovery) |
| `license`       | no  | license name or bundled file reference |
| `compatibility` | no  | ≤500 chars; environment needs (product, packages, network) |
| `metadata`      | no  | string→string map (e.g. `author`, `version`) |
| `allowed-tools` | no  | space‑separated pre‑approved tools (experimental) |

Body: Markdown, no format rules; loaded *entirely* on activation, so keep it
< ~500 lines / 5k tokens and push detail into `references/`.

### 2.3 Progressive disclosure (3 levels) — the core idea

1. **Discovery** (~100 tokens): `name`+`description` of *every installed skill*
   loaded at startup, so the agent knows when each applies.
2. **Activation** (<5k tokens): the full `SKILL.md` body is read **only when** a
   task matches.
3. **Execution / resources** (as needed): `references/`, `scripts/`, `assets/`
   are read/run **only when** the task calls for them. Scripts are *executed* (not
   read into context) for deterministic, repeatable, cheap results — the whole
   reason scripts beat "ask the model to regenerate the code each time."

### 2.4 The enabling Azure mechanism (already in our codebase)

- `assembleTools()` builds `{ type:'code_interpreter', container:{ type:'auto',
  file_ids:[…] } }`.
- `aoaiFiles.uploadFile()` → `POST /files` (`purpose=assistants`).
- `listContainerFiles()` confirms mounted files live at `/mnt/data/<basename>`.

---

## 3. How we map the standard onto Azure code interpreter

| Std level | Native agent (filesystem) | Watai on Azure code interpreter |
| --------- | ------------------------- | ------------------------------- |
| 1 Discovery | name+desc in system prompt | name+desc of every **enabled** skill injected into the run's system prompt |
| 2 Activation | agent `cat`s `SKILL.md` | model opens `/mnt/data/skills/<name>/SKILL.md` |
| 3 Execution | reads refs / runs scripts | model reads `references/…`, runs `scripts/…`, uses `assets/…` from the same folder |

This is faithful: the model still *discovers by description, activates by reading
SKILL.md, and pulls resources on demand* — only the filesystem is the Azure
sandbox instead of a local disk.

---

## 4. Runtime architecture — global, account‑scoped, canonical‑faithful

The runtime is **identical for default and user skills** (parse → package →
provision → mount → discover). The only difference is where the package comes
from (§5).

### 4.1 Packaging & mounting (preserves the folder + binary assets)

Azure mounts `container.file_ids` flat at `/mnt/data/<basename>`, which loses a
skill's directory tree and breaks its relative references. So each skill folder is
packaged as **one zip**, `watai-skill.<name>.v<ver>.zip`, and mounted. A tiny,
app‑provided bootstrap is mounted alongside: `watai-skills-setup.py`. The run's
system prompt instructs the model to run it once —
`python /mnt/data/watai-skills-setup.py` — which extracts every
`watai-skill.*.zip` into `/mnt/data/skills/<name>/` (idempotent). The skill then
exists as its **authored folder**: relative refs (`references/REFERENCE.md`,
`scripts/extract.py`) resolve and binary assets are intact. Result: **any**
spec‑compliant skill works unmodified.

> Reliability note: the one bootstrap step depends on the model running it. We
> make the directive forceful and the script idempotent + self‑announcing (prints
> the skills it extracted). Hardening options (a fallback re‑instruction if
> `/mnt/data/skills` is missing) are listed in §9.

### 4.2 Global, account‑scoped provisioning (NOT thread files)

Credentials are per user, so files live in each user's Azure resource. A
`SkillProvisioner.ensure(creds, skills)` makes sure, **per endpoint**, that each
**enabled** skill's zip + the setup script exist (Files API, matched by the
`watai-skill.<name>.v<ver>.zip` filename); missing ones are uploaded **once** and
reused across **all** threads. Memoized per worker instance. The user's Azure
Files API *is* the file registry — no thread‑file coupling. This satisfies "skills
are global, not thread‑specific." (A small per‑user **catalog** in Cosmos, §6,
records which skills are enabled and stores user‑uploaded zips; it does not change
where skill *files* live at run time.)

### 4.3 Run flow

`code_interpreter` on → resolve the user's **effective skill set** (§5) →
`provisioner.ensure(creds, skills)` → `assembleTools` merges the skill zips +
setup‑script `file_ids` into `container.file_ids` → `codeInterpreterSection`
emits the **level‑1 discovery block** (every enabled skill's name + description,
the bootstrap line, and the `/mnt/data/skills/<name>/` location). Thread documents
stay a *separate*, thread‑scoped source also merged into `container.file_ids`.

### 4.4 Runtime module map

- `api/src/domain/skill.ts` — `SkillPackage { name, description, license?,
  compatibility?, metadata?, version, files: SkillFile[] }`;
  `SkillFile { path; text?; base64? }`; `parseSkillFrontmatter(md)` +
  `validateSkillName/Description()` enforcing §2.2 (shared by bundled build‑time
  checks **and** upload validation, §6.3).
- `api/src/skills/pdf/` — original, license‑clean `pdf` default skill: `SKILL.md`,
  `references/REFERENCE.md`, `references/FORMS.md`, `scripts/*.py` (create with
  reportlab, extract with pdfplumber/pypdf, merge/split/rotate with pypdf, fill
  forms with pypdf). Pure‑Python, sandbox‑verified libs only.
- `api/src/skills/index.ts` — registry of **default** `SkillPackage`s + the
  embedded `watai-skills-setup.py`.
- `api/src/application/skillPackager.ts` — `zipSkill(pkg): Uint8Array` (fflate);
  also `unzipToPackage(bytes): SkillPackage` for upload validation (§6.3).
- `api/src/ai/files.ts` — add `listFiles()` (`GET /files`) for cache lookup.
- `api/src/application/skillProvisioner.ts` — `ensure(creds, skills):
  MountedSkill[]` (list → upload missing → memoize → return `{ name, description,
  fileIds, path }`). `skills` is the user's **effective set** (§5.3), resolved via
  `skillCatalogService`; a default skill's zip is built in‑memory (§4.1), a user
  skill's normalized zip is fetched from Blob — both end up as the same
  `watai-skill.<name>.v<ver>.zip` upload, so caching/mounting is uniform.
- `api/src/application/skillService.ts` — `codeInterpreterSection(mounts)` emits
  the discovery block + bootstrap instruction.
- `api/src/application/runWorker.ts` + `assembleTools(…, skillFileIds)` — thread
  provisioned file_ids into `container.file_ids`; optional dep ⇒ no‑op in tests.
- `api/src/composition.ts` — wire `skillProvisioner` + the catalog service (§6).

### 4.5 Relationship to the existing inline playbooks

Today's 7 keyword‑injected playbooks are a *different* mechanism (prompt text, no
files). They stay as a lightweight built‑in for docx/xlsx/pptx/charts/tabular for
now. The **canonical skill subsystem** is the new, standard‑compliant, extensible
path; the `pdf` demo moves to it (the old text‑only `professional-pdf`/
`pdf-extract` are retired to avoid duplicate PDF guidance). Converting the
remaining playbooks to canonical skills is a later, additive step.

---

## 5. Default vs. user‑managed skills

Two sources, one runtime contract. A per‑user **catalog** (§6) ties them together.

### 5.1 Default skills (service‑provided, toggle‑off)

- Shipped by us, bundled in the app as canonical `SkillPackage`s (e.g. `pdf`).
- **ON by default** for every user; each can be **turned off** per user.
- Not editable or deletable by users (they're app assets) — a user only
  enables/disables them. We update them via app releases (version bump ⇒
  re‑provision on next run).
- We persist only the **off** decisions (absence ⇒ on), so new defaults we add
  later are automatically available without touching existing users.

### 5.2 User skills (self‑service, full CRUD)

- A user uploads a **zip** in the canonical format (§2.1). We validate it
  (§6.3), store it per user, mark it **enabled** by default, and the user manages
  it fully (enable/disable, replace, download, delete).
- Scoped to that user only (never shared/visible to others).
- A user skill with the same `name` as a default **shadows** the default for that
  user (their version wins), so users can override a built‑in if they want.

### 5.3 The effective skill set (what a run sees)

```
effective(user) = (default skills where not disabled(user))
                ⊎ (user skills where enabled AND status = ready)
                (user skill wins on name collision)
```

Only this set is provisioned + described at run time (§4.3). Disabling or deleting
removes a skill from the set immediately (next run); its mounted file is simply no
longer referenced (and swept later, §9).

---

## 6. Skill management — data model, storage & API (CRUD)

### 6.1 Storage

- **Cosmos container `skills`** (NEW), partition key `/userId`, one doc per record:
  - **user skill**: `{ id, userId, kind:'user', name, description, version,
    enabled, status:'ready'|'invalid', error?, blobPath, bytes, fileCount,
    createdAt, updatedAt }`. `name` is unique per user (re‑upload of the same
    `name` = a new version / replace).
  - **default toggle**: `{ id:'default:<skillId>', userId, kind:'default-off',
    skillId, updatedAt }` — present **only** when the user disabled that default
    (absence ⇒ enabled).
- **Blob Storage** holds each user skill's **normalized** zip at
  `skills/{userId}/{name}.zip` (same SAS‑mint pattern as artifacts/attachments).

> Infra note: this adds one Cosmos container. Per the repo's infra‑drift caution,
> create it **surgically**
> (`az cosmosdb sql container create … --partition-key-path /userId`), never via a
> full bicep redeploy (which can disturb live settings like the SignalR
> connection string).

### 6.2 API — `/api/skills` (user‑scoped via existing auth)

| Method & path | Purpose |
| --- | --- |
| `GET /skills` | Catalog: default skills (each with effective `enabled`) + the user's uploaded skills (name, description, version, status, bytes, enabled). |
| `GET /skills/{id}` | Detail: parsed frontmatter, file tree, `SKILL.md` body for preview. |
| `GET /skills/{id}/download` | Download a user skill's zip (short‑lived SAS). |
| `POST /skills` | Upload a zip (base64/multipart). Validates (§6.3); stores Blob + record; `201` with the record or `422` with errors. |
| `PATCH /skills/{id}` | Toggle `enabled` (works for a default toggle and a user skill). |
| `PUT /skills/{id}` | Replace a user skill's zip → re‑validate, bump version. |
| `DELETE /skills/{id}` | Delete a user skill (Blob + record). Defaults can't be deleted → `409` (disable instead). |

Any create/replace/toggle bumps a per‑user **catalog revision** so the
provisioner re‑evaluates the effective set on the next run (and uploads changed
zips to the AI endpoint). Service: `api/src/application/skillCatalogService.ts`;
controller `api/src/http/skillsController.ts`; store
`api/src/ports/skillStore.ts` + a Cosmos adapter.

### 6.3 Upload validation — the "correct format and structure" gate

Server‑side, authoritative, on `POST`/`PUT`:

1. **Envelope:** content‑type `application/zip`; size ≤ cap (e.g. **5 MB**); entry
   count ≤ cap (e.g. **100**); per‑file size ≤ cap. Reject otherwise.
2. **Locate `SKILL.md`:** at the zip root **or** under a single top‑level folder.
   Reject if missing or ambiguous (multiple candidate roots).
3. **Frontmatter:** parse + validate against §2.2 (`name` regex/length,
   `description` length, optional fields well‑formed). Enforce `name` == the
   wrapper folder (normalize a single wrapper).
4. **Structure & security:** reject path traversal (`..`, absolute paths),
   symlinks, and files outside the skill root; allow `references/`, `scripts/`,
   `assets/`, and other nested files within caps. (User code runs only in the
   ephemeral code‑interpreter sandbox — no secrets, no access to our vault — but
   we still refuse malformed/oversized archives.)
5. **Result:** success ⇒ `status:'ready'`, store the **normalized** zip (root =
   the skill folder). Failure ⇒ `422` with a precise, field‑referenced error list
   the UI renders. Never partially install.

Backed by the same `parseSkillFrontmatter` + `unzipToPackage` from §4.4.

---

## 7. Skill management UI — exhaustive spec (simple, minimal UX)

### 7.0 UX principles

- **One home, no new chrome.** Skills live as a **Settings section** ("Skills",
  Assistant group, right after *Tools*) — not a new top‑level view or route. This
  reuses the exact CRUD‑list pattern the **Invites** section already uses
  (`settings-card` + rows), so there is nothing new to learn and zero added
  navigation. (Rationale + alternative weighed in §9.)
- **Toggle‑first.** The on/off `Switch` is the only control on a calm row;
  everything rarer (View, Replace, Download, Delete) hides in a per‑row overflow
  menu.
- **List first, detail on demand.** A flat list; a preview opens in a modal only
  when asked. No nested pages.
- **Honest, one‑line states.** loading / empty / ready / invalid / disabled /
  busy each get exactly one clear sentence. No emoji; Fluent system icons; the
  existing tokens, `settings-card`, `setting-row`, `Switch`, `InlineAlert`,
  `ConfirmDialog`, `Menu`, toasts. No new design primitives.

### 7.1 Entry point & information architecture

- Register a `skills` entry in `Settings.tsx` `SECTIONS` (Assistant `GROUP`, after
  `tools`): `icon: 'puzzle'` (fallback `code`), `label: 'Skills'`,
  `sub: 'Reusable, file‑based abilities the assistant loads on demand'`.
- Rail/hub **summary** (`summaryFor`): enabled count, e.g. `2 on · 1 custom`, or
  `Off` when none enabled.
- `SectionBody` renders `<SkillsBody>`; desktop detail pane + mobile section page
  come for free from the existing `Section` shell.

### 7.2 Code‑interpreter gating (a real dependency, surfaced)

Skills only execute inside Code Interpreter. If the endpoint lacks it **or**
*Tools → Code interpreter* is off, show a single `InlineAlert tone="info"` at the
top of the body: *"Skills run with Code Interpreter. Turn it on in Tools to let
the assistant use them."* with a text button → opens the *Tools* section.
Management (upload/toggle/delete) still works while it's off, so users can set up
ahead of time.

### 7.3 `SkillsBody` layout (top → bottom)

1. Muted intro line: *"Skills are folders of instructions and scripts the
   assistant loads automatically when a task matches — like creating or filling
   PDFs."*
2. (conditional) the gating `InlineAlert` (§7.2).
3. **Default skills** — `settings-group__label` "Default skills" + a
   `settings-card` of `SkillRow`s (one per bundled skill).
4. **Your skills** — label "Your skills" with a trailing **Upload skill** button;
   then either the user `SkillRow`s or the empty panel (§7.9); the card is also a
   drag‑and‑drop target for a `.zip`.
5. Muted footer quota: *"Using 1 of 10 custom skills · 0.3 MB"* (from §6 caps).

### 7.4 `SkillRow` (shared by both groups)

- **Leading:** `Avatar variant="assistant"` with `Icon name="puzzle"`.
- **Body:** title = `name`; sub = one‑line `description` (CSS‑truncated, full text
  via `title`). For an **invalid** user skill, sub = the first validation error in
  danger text.
- **Trailing (in order):** a small status **chip** only when not plainly
  ready+enabled (`Invalid` danger / `Disabled` muted); the `Switch`; an overflow
  `IconButton name="more"` opening a `Menu`.
- **Click target:** the leading+body area is a button → opens the detail modal
  (§7.6). The switch and menu stop propagation.
- **Visuals:** disabled → dimmed body + switch off; invalid → switch **disabled**
  (a broken skill can't be enabled) + `Invalid` chip; busy → switch shows the
  inline `Spinner size="sm"`, row `aria-busy`.
- **Overflow menu** (`Menu` items): default → `View details`. User →
  `View details`, `Replace…`, `Download`, separator, `Delete` (danger).

### 7.5 Upload flow (one button, server‑authoritative)

- **Trigger:** the **Upload skill** button (`Icon name="upload"`) and a drop zone
  over the *Your skills* card (drag‑over highlight). A hidden
  `<input type="file" accept=".zip,application/zip">`.
- **Pre‑check (client, cheap):** extension `.zip` and size ≤ 5 MB; otherwise toast
  the limit and stop. One file at a time (reject a multi‑select with *"Upload one
  skill at a time."*).
- **Optimistic row:** insert a pending `SkillRow` (`Uploading <filename>…`,
  Spinner) → `POST /skills` (base64).
  - **201 Ready:** swap to the real row (enabled), toast *"Added <name>"*.
  - **422 Invalid:** remove the pending row, open the **validation‑errors modal**
    (§7.7), toast *"Couldn't add that skill"*.
  - **409 Name exists** (same `name` as an existing *user* skill): `ConfirmDialog`
    *"Replace <name>? This updates it to the uploaded version."* → on confirm
    `PUT /skills/{id}`.
- Button shows busy state for the duration; no concurrent uploads.

### 7.6 Detail modal (read‑only preview)

A centered modal (existing overlay) — title = `name` + a source chip
(`Default`/`Uploaded`):

- **Meta block:** `description`; `license` (if present); `version`; status.
- **Files:** a compact, read‑only tree grouped `SKILL.md`, `references/`,
  `scripts/`, `assets/` — each `path` + human size.
- **SKILL.md preview:** the Markdown body rendered read‑only in a scroll area
  (height‑capped).
- **Footer:** user skill → `Replace…` · `Download` · `Delete`; default → `Close`
  only. The header carries the same `Switch` so enable/disable is reachable here
  too. **No in‑app editing** — authoring happens in the zip; "edit" = Replace.

### 7.7 Validation‑errors modal (maps §6.3 → human copy)

- Title: *"This skill couldn't be added"*; subtitle: *"Fix these and upload
  again — nothing was installed."*
- Ordered list, each item = the rule + what was found:
  - *Missing `SKILL.md` — a skill must contain a `SKILL.md` at its root (or one
    top‑level folder).*
  - *Invalid name "PDF Tools" — use 1–64 lowercase letters, numbers, and hyphens;
    no leading/trailing or double hyphens.*
  - *Description is required* / *Description too long (1,200 / 1,024).*
  - *Unsafe path "../secrets" — files must stay inside the skill folder.*
  - *Too large (7.2 MB) — the limit is 5 MB.* / *Too many files (143 / 100).*
- Footer: **Download template** (a valid starter `.zip`) · **Close**.

### 7.8 Delete & disable

- **Delete** (user only): `ConfirmDialog` *"Delete <name>? The assistant will stop
  using it and the uploaded files are removed."* → `DELETE` → toast
  *"Removed <name>"*. Defaults have no Delete (overflow omits it).
- **Disable** (any): `Switch` off → `PATCH` **optimistically** (revert + toast on
  failure). Reversible ⇒ no confirm. A disabled default persists a toggle;
  re‑enabling deletes the toggle.

### 7.9 States & exact copy

- **Loading:** centered `Spinner` + *"Loading skills…"* (or 3 row skeletons).
- **Your‑skills empty:** a calm in‑card panel — *"No custom skills yet. Upload a
  `.zip` in the Agent Skills format to add your own."* with **Upload skill** +
  **Download template** + a "What's a skill?" link. (Default group is never
  empty.)
- **List load error:** `InlineAlert tone="danger"` *"Couldn't load skills."* +
  **Retry**.
- **Toasts:** *Added/Removed/Updated <name>*, *"<name> on/off"*, *"Couldn't …"*.
- **Quota reached:** disable Upload + tooltip *"You've reached 10 custom skills —
  delete one to add another."*

### 7.10 Accessibility & keyboard

- `Switch` keeps `role="switch"` + `aria-label="Enable <name>"`.
- Row click area is a real button (Enter/Space → details); overflow uses the
  existing keyboard‑navigable `Menu`; modals trap focus, `Esc` closes, focus
  returns to the row.
- Status is always conveyed by **text + chip**, never color alone; `aria-busy`
  during async row work; the upload `<input>` is focusable with a visible button.

### 7.11 Chat‑side provenance (the only change outside Settings)

When a reply used a skill, reuse the existing tool‑call chip under the message:
*"Used skill: <name>"*, clicking opens the §7.6 detail modal. No new surface, no
new layout — just one more chip kind.

### 7.12 Client modules (small, contained)

- `src/features/skills/SkillsBody.tsx` (the section), `SkillRow.tsx`,
  `SkillDetailDialog.tsx`, `SkillErrorsDialog.tsx`.
- `useSkills` store slice (list + optimistic toggle/upload/delete) and `skillsApi`
  on the cloud client; types (`SkillSummary`, `SkillDetail`, `SkillValidationError`)
  in `src/lib/types.ts`.
- Register `skills` in `Settings.tsx` `SECTIONS`/`GROUPS`/`SectionBody`/`summaryFor`.
- CSS: reuse `settings-card`/`setting-row`; add only a couple of `.skill-row__*`
  rules. No route, no sidebar entry, no new view shell.

---

## 8. Plan (phased, TDD)

### Phase A — Default‑skill runtime (ships the PDF demo)

1. **Domain + parser.** `SkillPackage`/`SkillFile`; `parseSkillFrontmatter` +
   name/description validators. Tests: valid/invalid names (leading/trailing/
   double hyphen, length, case), description length, missing frontmatter, optional
   fields, body extraction.
2. **Author the `pdf` skill** (canonical files) + default registry +
   `watai-skills-setup.py`. Tests: parses + validates; folder/`name` match; setup
   script content shape + target paths.
3. **Packager.** `zipSkill` / `unzipToPackage` (fflate). Tests: round‑trips text +
   a base64 asset at correct relative paths; deterministic; reject malformed.
4. **Files API `listFiles`.** Mocked‑fetch test for the `GET /files` shape.
5. **Provisioner.** Tests: uploads zip + setup once; reuses by filename; version
   bump re‑uploads; memoizes (one list/instance); concurrency guard; tolerates a
   failed upload; returns names/descriptions/file_ids/paths.
6. **Discovery block.** `codeInterpreterSection(mounts)` tests: name+description,
   bootstrap line, `/mnt/data/skills/<name>/`; back‑compat with no mounts.
7. **runWorker + assembleTools wiring** + **composition** + full `tsc`/test/build.

### Phase B — Management (default toggles + user CRUD + UI)

8. **Skill store + catalog service.** `skillStore` (Cosmos `skills`, partition
   `/userId`) + `skillCatalogService` (effective‑set resolution: defaults−off ⊎
   enabled user skills). Tests: toggle persists off only; effective set; name
   shadow; invalid excluded.
9. **Upload validation** (`unzipToPackage` + §6.3 caps/security). Tests: valid
   zip ⇒ ready; missing/ambiguous `SKILL.md`; bad frontmatter; traversal/oversize
   ⇒ 422 with errors; normalization of a single wrapper folder.
10. **CRUD endpoints** (`skillsController`) wired to Blob (zip) + store. Tests per
    route incl. authz, defaults‑can't‑delete (409), replace bumps version.
11. **Provisioner reads the catalog.** Run flow resolves effective set per user
    (default + user zips from Blob). Tests: disabled default omitted; user skill
    uploaded to the AI endpoint; shadow precedence.
12. **Client Skills UI** — the `skills` **Settings section** (`SkillsBody`,
    `SkillRow`, `SkillDetailDialog`, `SkillErrorsDialog`, `useSkills`, `skillsApi`;
    registered in `Settings.tsx`, no route/sidebar). Tests: list groups, gating
    notice, optimistic toggle, upload happy/422/409, delete, replace.
13. **Surgical infra**: create the `skills` Cosmos container in dev/prod (az CLI).
    **Manual** (needs live account).

### License gate (throughout)

No Anthropic‑licensed bytes enter the repo, the bundle, or any upload. All default
skill content is original. (A CI grep for known proprietary markers is a cheap
guard.)

---

## 9. Self‑critique & improvements

- **Bootstrap dependency.** Activation needs the model to run the setup script.
  Mitigations: forceful directive; idempotent + self‑announcing script; exact
  command in the discovery block. Hardening (later): detect missing
  `/mnt/data/skills` and re‑instruct, or inject a first code step server‑side.
- **User‑skill security (the standard's own warning).** Uploaded skills carry
  instructions **and code**. They run only in the ephemeral code‑interpreter
  container (no secrets, no vault, no inbound to our services), but we still:
  validate structure (§6.3), cap size/count, reject traversal/symlinks, scope to
  the owner, and surface `license`/contents in the UI so the user sees what they
  enabled. A future "review before enable" / org‑allowlist is additive.
- **Name collisions & shadowing.** User `name` == default ⇒ user wins (explicit in
  the UI as "Overrides a default"). Two user uploads with the same `name` ⇒
  replace/version, not duplicate.
- **Quotas.** Per‑user caps (e.g. ≤ N skills, total bytes) prevent abuse; enforced
  in the catalog service, shown in the UI.
- **Orphaned versions/files.** Version bump or delete leaves old `…v{n}…` files on
  the endpoint and old Blob zips; add a sweep (`listFiles`/Blob GC of
  `watai-skill.*` not in the effective set) — tracked, not blocking.
- **Binary assets.** Handled by zip end‑to‑end (upload → Blob → provision → mount
  → extract). Demo `pdf` is text‑only but the path supports fonts/templates.
- **Discovery cost at scale.** Injecting every enabled skill's metadata is fine for
  a handful; at dozens, pre‑filter which to mount/describe (keyword/embedding).
  Per‑user enable/disable already bounds this.
- **`GET /files` cost.** One list per worker instance, memoized. Fine.
- **Endpoint change / catalog change.** Re‑provisions automatically (files absent
  on the new resource; catalog revision bump forces re‑evaluation).
- **Default‑skill updates.** A version bump ships new files; users keep their
  on/off choice; their overriding user skill (if any) still wins.
- **Entry point (decided).** Skills are a Settings *section*, not a new top‑level
  view/route: they're occasional config, and the Invites section already proves
  CRUD‑in‑Settings works. A dedicated view was rejected as chrome that fights the
  "simple, minimal" goal.
- **Code‑interpreter gating.** Skills only run in the sandbox; the UI says so and
  links to *Tools*, but management still works while it's off so setup isn't
  blocked.
- **Optimistic toggles.** Enable/disable flips the row immediately and reverts on
  error — the common action is never spinner‑gated.
- **Template.** Every "Download template" yields a real, valid starter `.zip`
  (from the standard's template) so a first‑time author begins from something that
  already passes §6.3.
- **Shared sandbox.** A skill's scripts run in the same ephemeral container as
  that user's *own* thread docs/artifacts — their data only (per‑user,
  per‑endpoint), no secrets/vault access. Acceptable and documented.

---

## 10. Manual validation checklist (needs a live, configured account)

Runtime (Phase A):

1. `code_interpreter` on, "Create a 2‑page PDF report on X" → the model runs
   `watai-skills-setup.py`, reads `/mnt/data/skills/pdf/SKILL.md`, produces a real
   PDF; logs show `watai-skill.pdf.v1.zip` uploaded once.
2. Second prompt in a **different thread** → same skill, **no** re‑upload.
3. "Extract text/tables from this PDF" (attached) → model reads a `references/`
   doc and/or runs a `scripts/` helper against the mounted file.
4. "Fill this PDF form" (fillable PDF attached) → uses the form‑fill script.
5. Change the Azure endpoint → next run re‑provisions on the new resource.
6. `/mnt/data/skills/pdf/` mirrors the authored folder (refs + scripts).

Management (Phase B):

7. Disable the default `pdf` skill in the Skills UI → next run no longer offers it
   (no PDF discovery block); re‑enable restores it.
8. Upload a valid custom skill .zip → appears under *Your skills* as ready; a
   matching prompt triggers it (setup extracts it; SKILL.md read).
9. Upload an invalid .zip (no `SKILL.md`, bad `name`, traversal) → `422` with
   clear errors; nothing installed.
10. Replace a user skill (new version) → version bumps; next run uses the new
    files. Delete it → gone from catalog and from the next run.
11. A user skill named `pdf` overrides the default for that user (their files
    mount, not ours); the row shows "Overrides a default".
12. Code‑interpreter **off** → the Skills section shows the gating notice and a
    chat run offers no skill discovery block; turning it on enables use.
13. Re‑upload a `.zip` whose `name` matches an existing custom skill → "Replace?"
    confirm (not a duplicate); version bumps.
14. "Download template" yields a `.zip` that uploads cleanly (round‑trips §6.3).
15. No Anthropic‑licensed bytes anywhere in repo/bundle/uploads.
