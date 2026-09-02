# Story-Lab-A1111 — Broad Repo Health Audit

Date: 2026-09-01
Auditor: Claude (Sonnet 5)
Method: static analysis + full test-suite run (no live server / A1111 / Ollama)
Tree audited: working tree at HEAD `adc6638` + 83 uncommitted files

---

## 1. Verdict

**The application code is healthy. The repository state is not.**

- Backend services and routes are real, substantial code — not stubs. Exactly **one**
  `// STUB` marker exists in the entire `src/` tree and it is the documented, intentional
  `resolveClothing()` in `clothing.js`.
- All 18 route files on disk are wired into `src/server.js`. No orphaned or unregistered routes.
- Clothing-set and FaceID features are wired end-to-end at the data-flow level (traced below).
- Test suite: **127 assertions / 23 files, passing** on isolated runs — but non-deterministic
  under concurrent DB access (see H-2).

The problems are all in **repository hygiene, git state, and documentation drift** —
serious ones, headed by 24 unpushed commits plus 83 uncommitted files sitting for 5 weeks.

---

## 2. Findings by severity

### H-1 — CRITICAL: 5 weeks of uncommitted + unpushed work

- `git status`: **83 files changed**, ~28,400 insertions / ~21,700 deletions, uncommitted.
- `git branch -vv`: `main` is **ahead of `origin/main` by 24 commits**.
- HEAD (`adc6638`) is dated **2026-07-27 — 5 weeks ago**.

The uncommitted delta is not small edits — it is a whole architectural change: deletion of
the legacy prompt/scene/enhancer/style layer (`story-enhancer.js`, `scene-picker.js`,
`prompt-extractor.js`, `prompt-preview.js`, `prompt-resolution.js`, `regenerate-tags.js`,
`scene-prompt-enricher.js`, `scene-summary.js`, `tag-dialect.js`, `visual-brief.js`,
`exemplar-promotion.js`, `ipadapter-resolution.js`, `routes/learning.js`, `routes/profiles.js`
and their 14 test files), plus new services (`arousal-rules.js`, `character-appearance.js`,
`image-shot-action.js`, `relationship-resolve.js`, `turn-regenerate.js`), plus a
1,186-line rewrite of the master knowledge doc.

**Why it matters:** total work-loss exposure on one disk; impossible to review or bisect;
`git` is useless as a safety net in this state; any "what changed" question is unanswerable.

**Fix:** commit the delta in themed chunks (purge / new-services / doc-rewrite / frontend),
then `git push`. Do this before any further work.

### H-2 — MEDIUM: test suite runs against the live production database

`src/db.js:6` — `const db = new DatabaseSync(DB_PATH)` — opens
`H:\MEDIA\Story_Lab\data\story-lab.db` unconditionally. There is no test/fixture DB and no
env override. Every test process that imports anything from `src/` opens, migrates, and can
write the real database.

Observed: `character-state-emotion-schema.test.js` failed once with
`error: 'database is locked' / code: 'ERR_SQLITE_ERROR'` at `src/db.js:8`. A forced
full-discovery run produced 6 such failures. Three consecutive clean `npm test` runs then
gave 127/127. It is **flaky, not broken** — but it will fail whenever the :4090 server (or a
second test run, or a WAL checkpoint) touches the DB concurrently, and successful runs
mutate live story/character data.

**Fix:** `DB_PATH` should honour an env var (e.g. `STORY_LAB_DB`) and the test runner should
point it at a temp file (`mkdtemp` + copy of a seed DB, or `:memory:` where schema-only).

### H-3 — MEDIUM: `public/js/views/audit.js` is dead code, still documented as a feature

- 177 lines. Not imported by `app.js` (which imports dashboard / characters / scenario-setup /
  play / settings / locations only). No `#view-audit` container in `index.html`. No nav entry.
  Last real change 3 months ago ("copy and adapt public frontend from story-lab").
- The master knowledge doc still has a section **"### New: audit.js view
  (public/js/views/audit.js)"** presenting it as live.

Note: the audit **backend** (`/api/audit` route + `src/services/audit.js` + `audit_events`
table + `audit.jsonl`) is wired and real — only the frontend view is orphaned. The audit log
is currently only reachable via raw API.

**Fix:** either wire the view (import + nav + container) or delete it; correct the doc either way.

### M-1 — Documentation drift in `story-lab-a1111-master-knowledge.md` (1,768 lines)

The doc contains a "rewritten 2026-07-19 after the image-generation purge" section **and**
un-reconciled pre-purge sections that contradict it:

| Location | Says | Reality |
|---|---|---|
| "Current Project State" table | "Phase 4 image pipeline COMPLETE — a1111.js, prompt-builder.js, image-pipeline.js, images + audit routes" as if original | pipeline was purged 2026-07-19 and rebuilt; table never updated |
| "### Next steps" #5 | "Implement styles CRUD backend (`src/routes/styles.js` — table exists, route file absent)" | `CLAUDE.md`/`AGENTS.md` forbid reintroducing styles; this is a stale instruction |
| "### Phase 9 — Story-aware image generation: COMPLETE" | "Files added: `scene-picker.js`, `story-enhancer.js` + their tests" | all four files **deleted** in the current tree |
| "### New: audit.js view" | live feature | orphaned (H-3) |
| Test-count references (VERIFY.md, IMAGE_PIPELINE_REBUILD_HANDOFF.md) | "87/87" | 127 assertions now; never updated |

**Fix:** delete the pre-purge Phase 4 / Phase 9 / "Next steps #5" content outright (the
purge notice already says to), refresh test counts, reconcile the audit.js entry.

### M-2 — Overlapping clothing columns (schema sprawl)

`characters` carries **six** clothing-related columns: `base_clothing`, `current_clothing`
(original) plus `default_outfit`, `outfit_style`, `outfit_sets`, `default_outfit_name`
(migrated in). Plus `scenario_characters.starting_clothing_set_name` / `.starting_clothing`
and `scenario_character_state.current_clothing`.

The intended model (`clothing_functionality.md`) needs `outfit_sets` (JSON array) +
`default_outfit_name` + the scenario-scoped columns. `narrator.js:75` still falls through
`current_clothing || base_clothing || default_outfit` as legacy fallback. `outfit_style` and
`base_clothing` appear to be dead columns kept alive only by that fallback chain.

Not a bug — read order is correct (scenario runtime first, verified below) — but it is a
maintenance hazard and makes "which column is authoritative" non-obvious.

**Fix:** document the authoritative column per concept in the master doc; consider a one-time
migration to drop `outfit_style` and collapse `base_clothing`/`default_outfit` once confirmed unused.

### L-1 — Committed junk files

Tracked in git, no purpose:
- `Model` — 25 bytes, contents `" In Settings  Backends:"` (botched shell redirect)
- `naked couples.txt` — 16 KB of prompt scratch text
- `public/js/_style_patches.json` — `{"patches":10,"status":"see app.js"}`, referenced nowhere (style-purge leftover)
- `public/standing_15.png` — stray test image in repo root of `public/`

Untracked but present in the working dir: `None` (empty), `_fixtest.py`, `_inspect_settings.py`,
`scripts/_regen_route.py`.

### L-2 — `scripts/` is a one-off patch graveyard

19 files, ~13 are `patch-*.py` / `patch-*.cjs` single-use migration scripts already applied
(arousal, clothing-fix, mood-arousal-backend/frontend/extras, narrator-outfit, summary-tag,
move-rating-to-thread, …). `patch-summary-tag-quality.cjs` still imports the deleted
`scene-summary`/`tag-dialect` modules — harmless (never run) but a broken reference.
`npm run audit` maps to `scripts/audit.js`, which is only a `node --check` syntax pass —
fine, but don't mistake it for a real audit.

**Fix:** move applied one-off scripts to `scripts/archive/` or delete; keep only
`audit.js`, `import-characters-from-story-lab.js`, `seed-locations.js`.

### L-3 — git-ignore gaps

- `graphify-out/` — **54 untracked files** (AST cache under `graphify-out/cache/ast/v0.8.41/`)
  polluting `git status`; yet `graphify-out/.graphify_*` and `graph.json` **are** tracked.
  Inconsistent. Add `graphify-out/cache/` (or all of `graphify-out/`) to `.gitignore`.
- `.claude/settings.local.json` is tracked — this is a per-machine file; add `.claude/` to `.gitignore`.
- `.serena/` is already correctly ignored.

### L-4 — `npm audit`: 1 low-severity advisory

`body-parser <1.20.6` DoS via invalid limit value (transitive through express). `npm audit
fix` resolves it in place. Installed direct deps are current (`express 4.22.2`, `ws 8.21.0`).

### L-5 — External CDN dependency in `index.html`

`<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js">` — unpinned
version, loaded from unpkg at runtime. Used by the (orphaned) audit view and/or relationship
graph. If the graph UI is kept, vendor a pinned copy into `public/js/`; if not, remove with H-3.

---

## 3. Data-flow verification (clothing + FaceID)

Traced to confirm the core features are genuinely wired (not the deep per-branch audit in
`audit_this.md` — a wiring-level pass per the "broad health" scope).

**Clothing read order — CORRECT (scenario-runtime first):**
- Narrator: `narrator.js:292` sets `c._scenario_clothing = getScenarioClothing(scenario.id, c.id)`;
  `narrator.js:75` reads `_scenario_clothing || current_clothing || base_clothing || default_outfit`.
- Scene image: `image-pipeline.js:122` — `castRows.map(c => getScenarioClothing(scenarioId, c.id))`.
- Writes: `turns.js` → `applyClothingChanges(db, scenarioId, clothingChanges)` writes
  `scenario_character_state.current_clothing` only — base `outfit_sets` JSON is not touched at runtime.
- Storage: character sets in `characters.outfit_sets`; default in `characters.default_outfit_name`;
  scenario start in `scenario_characters.starting_clothing_set_name` / `.starting_clothing`;
  runtime in `scenario_character_state.current_clothing`.

**FaceID — wired with correct soft-fail:**
- Upload/clear: `POST|DELETE /api/characters/:id/face-ref` → `characters.reference_image_path`.
- Generation: `image-pipeline.js:130` picks the first cast member with `reference_image_path`;
  `:143` skips FaceID cleanly when `a1111_faceid_model` is unset; `:148` skips when the
  controlnet extension isn't detected; otherwise builds a ControlNet unit and records
  `face_ref_json`. No crash path.

Prompt assembly order in `prompt-builder.js` matches the documented contract
(Style → Character+FaceID → Action → Location+clothing, content stages style-word-stripped).

---

## 4. Test suite

| | |
|---|---|
| Command | `npm test` (`node --experimental-sqlite --experimental-test-module-mocks --test`) |
| Files | 23 (`src/**/__tests__`, `src/__tests__`, `public/js/__tests__`) |
| Assertions | 127 |
| Result (3 isolated runs) | 127 / 127 pass |
| Result (concurrent DB access) | intermittent `database is locked` failures — see H-2 |
| Deleted-with-purge test files | 14, consistent with the services they covered |

Frontend tests in `public/js/__tests__/` (look-editor form, outfit-sets validation, logline
panel wiring, narrator line/turn numbering) **do** run in the default suite and pass.

---

## 5. Recommended fix order

1. **H-1** — commit the 83-file delta in themed chunks and `git push`. Nothing else is safe until this is done.
2. **L-3** — add `graphify-out/cache/` and `.claude/` to `.gitignore` before that commit so the cache noise stays out.
3. **L-1 / L-2** — delete `Model`, `naked couples.txt`, `_style_patches.json`, stray `public/standing_15.png`, `None`, `_fixtest.py`, `_inspect_settings.py`; archive applied `scripts/patch-*`.
4. **H-2** — env-override `DB_PATH`; point tests at a temp DB.
5. **M-1** — reconcile the master knowledge doc (delete pre-purge Phase 4/9 + Next-steps #5, refresh test counts).
6. **H-3** — decide audit.js view: wire it or delete it; fix the doc entry; resolve L-5 with it.
7. **L-4** — `npm audit fix`.
8. **M-2** — document authoritative clothing columns; plan a migration to drop dead ones.

---

## 6. Completion check

| Question | Answer | Proof |
|---|---|---|
| Backend routes all wired? | YES | 18 route files, 18 `app.use` in `server.js` |
| Any undocumented stubs? | NO | 1 `// STUB` in `src/`, matches doc |
| Clothing feature wired end-to-end? | YES | `getScenarioClothing` in narrator + image-pipeline; runtime writes scoped to `scenario_character_state` |
| FaceID wired with soft-fail? | YES | `image-pipeline.js:130-151` |
| Test suite green? | YES (flaky) | 127/127 isolated; `database is locked` under concurrency |
| Git state healthy? | NO | 24 commits unpushed + 83 files uncommitted, 5 weeks stale |
| Master knowledge doc accurate? | NO | pre-purge Phase 4/9 sections, stale "Next steps #5", audit.js drift, 87 vs 127 test count |
| Dead frontend code present? | YES | `public/js/views/audit.js` (177 lines, orphaned), empty `public/js/play/` |
