# Top-8 Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Do not implement in this planning pass.** This document is the handoff for a separate implementation session.

**Goal:** Fix the eight highest-impact audit failures so NSFW controls, FaceID refs, backgrounds, learning, enhancer LoRAs, narrator/picker flags, and Styles/Images routing behave as the product intends.

**Architecture:** Keep current service boundaries (`prompt-builder`, `image-pipeline`, `narrator`, `config-resolver`, routes). Prefer the smallest runtime-correct change per issue; no feature expansion, no Styles backend rewrite.

**Tech Stack:** Node.js ESM, Express, `node:sqlite`, vanilla frontend (`public/js`), A1111 REST, Ollama/llama.cpp.

**Authoritative doc filename:** `story-lab-a1111-master-knowledge.md` (repo root). User shorthand "story-lab-master-knowledge.md" maps to this file.

## Global Constraints

- One-function / one-issue at a time; verify before starting the next.
- Prefer code as ground truth; update master knowledge in the same task that changes behavior.
- ASCII-only comments/docs. No drive-by refactors.
- NSFW policy after this plan: low arousal stays SFW-tagged; tiers 4-5 require `nsfw_enabled`; tiers 8-10 require `nsfw_enabled && explicit_mode`; narrator and picker must honor the same flags.

## Execution Order (recommended)

| Order | Issue | Depends on | Risk |
|------:|-------|------------|------|
| 1 | F1 NSFW gating (prompt-builder) | — | Low |
| 2 | F2 Boot config overwrite + learning boolean | — | Low |
| 3 | F7 Narrator/picker NSFW flags | F1, F2 | Medium |
| 4 | F3 FaceID accepted refs | — | Low-Medium |
| 5 | F4 Background source of truth | — | Medium |
| 6 | F5 Learning snapshots/ratings | — | Medium |
| 7 | F6 Enhancer LoRA/master-neg preserve | — | Medium |
| 8 | F8 Styles/Images routes | — | Low |

## File Map

| File | Issues |
|------|--------|
| `src/services/prompt-builder.js` | F1 |
| `src/db.js` | F2 |
| `src/services/config-resolver.js` | F2 |
| `src/routes/characters.js` | F3 |
| `src/services/image-pipeline.js` | F3, F4, F5, F6, F7 |
| `src/routes/locations.js` | F4 |
| `src/routes/global-locations.js` | F4 (verify/align) |
| `src/routes/images.js` | F5 |
| `src/services/exemplar-promotion.js` | F5 (verify after F2) |
| `src/services/story-enhancer.js` | F6 |
| `src/services/narrator.js` | F7 |
| `public/js/app.js` | F8 |
| `public/js/views/styles.js` | F8 |
| `public/js/views/style-creator.js` | F8 |
| `public/js/views/images.js` | F8 |
| `public/js/views/dashboard.js` | F8 |
| `story-lab-a1111-master-knowledge.md` | all |

---

# F1 — NSFW / arousal gating in prompt assembly

**Audit IDs:** CB-1, CB-2, CB-3

### Exact files to change
- `src/services/prompt-builder.js`
- `story-lab-a1111-master-knowledge.md`

### What to change
1. `getArousalTags(level, config)`:
   - `l <= 3` -> `AROUSAL_TAGS['1-3']` (empty), NOT `'4-5'`.
   - If `!config?.nsfw_enabled` -> return empty.
   - If `l >= 8` and `!(config?.nsfw_enabled && config?.explicit_mode)` -> no hardcore tier (empty if NSFW off; at most 4-5 if NSFW on / explicit off).
   - If `4 <= l <= 7` and `!nsfw_enabled` -> empty.
2. `buildPrompt(...)`: change `sceneCard?.arousal_level ?? 8` -> `?? 1`.
3. Thread resolved `config` into `getArousalTags` from `buildPrompt` / `buildCharacterPrompt`.

### Risk level
**Low** — pure prompt-assembly logic; no schema.

### How to verify
1. Level 2 + nsfw on -> no suggestive tags.
2. Missing arousal + cast -> no hardcore tags (`?? 1`).
3. nsfw false + level 9 -> no arousal tags.
4. nsfw true, explicit false, level 9 -> not hardcore tier.
5. nsfw + explicit true, level 9 -> hardcore tags present.
6. UI generate with calm scene card; prompt panel has no suggestive arousal tags.

### Master knowledge sections to update
- Prompt Assembly (arousal tiers + gating)
- Image Generation Architecture — Key Design Decisions
- Narrator Response Format — arousal_level tiers (image vs story alignment)

---

# F2 — Boot config overwrite + learning boolean coercion

**Audit IDs:** CB-6, BW-7

### Exact files to change
- `src/db.js`
- `src/services/config-resolver.js`
- `story-lab-a1111-master-knowledge.md`

### What to change
1. Delete load-time force update in `db.js`:
   `UPDATE global_config SET value='true' WHERE key IN ('nsfw_enabled','explicit_mode','summary_learning_enabled')`
2. Keep first-insert seeds only (`INSERT OR IGNORE` / `_defaults`).
3. Add `summary_learning_enabled` to `BOOLEAN_KEYS` in `config-resolver.js`.
4. Grep for any other boot force-UPDATEs of these keys; remove if present.

### Risk level
**Low** — existing DB may already be forced true; flip settings then restart to prove persistence.

### How to verify
1. Set nsfw/explicit/learning to false via Settings or `POST /api/config`.
2. Restart server.
3. Config still false after reload.
4. Learning false + rate image -> no exemplar promotion (`learning_disabled`).
5. `resolveMasterConfig` returns boolean `false` for `summary_learning_enabled`.

### Master knowledge sections to update
- Database Schema — global_config (defaults + learning keys)
- Service Layer — config-resolver.js (BOOLEAN_KEYS)
- Settings UI / Frontend Changes — settings.js (what survives restart)

---

# F3 — FaceID accepted refs (column read/write alignment)

**Audit IDs:** CB-4

### Exact files to change
- `src/services/image-pipeline.js`
- `src/routes/characters.js`
- Optional migrate in `src/db.js` (backfill alias column)
- `story-lab-a1111-master-knowledge.md`

### What to change
1. Canonical column: `reference_image_path` (accept/clear already write it).
2. Pipeline IP-Adapter resolve: read `reference_image_path || reference_image`.
3. Confirm join uses the same directory as accept-save.
4. On set/clear, keep alias column in sync OR migrate readers/writers to path only.
5. Missing file: log + skip IP-Adapter (no crash).

### Risk level
**Low-Medium** — wrong base path still silently skips; verify with real accepted asset.

### How to verify
1. Accept a face ref; DB canonical column non-null.
2. IP-Adapter on + scene generate -> audit/log shows ref loaded.
3. Clear ref -> next generate has no IP-Adapter image.
4. Missing file does not hard-fail generate.

### Master knowledge sections to update
- Database Schema — characters (canonical FaceID column)
- Image Generation Architecture — FaceID/IP-Adapter resolve
- Key Design Decisions (if FaceID described)

---

# F4 — Background source of truth

**Audit IDs:** CB-7, DOC-9

### Exact files to change
- `src/routes/locations.js`
- `src/services/image-pipeline.js` (optional FS fallback / backfill)
- `src/routes/global-locations.js` (verify already table-backed)
- `story-lab-a1111-master-knowledge.md`

### What to change (table = source of truth)
1. Scenario generate-background: after file write, `INSERT OR IGNORE INTO location_backgrounds`.
2. set-default: update `location_backgrounds.is_default` and keep `locations.default_background` for UI.
3. delete: FS + table row; repair default if needed.
4. Optional: if table empty but `default_background` exists on disk, use it and backfill table.
5. Do not leave scenario UI writing only FS while pipeline reads only table.

### Risk level
**Medium** — FS/DB desync if any mutate path only updates one side.

### How to verify
1. Generate BG from scenario locations UI -> `location_backgrounds` row exists.
2. Scene generate at that location -> img2img (not txt2img); `background_used` set.
3. set-default changes which file is preferred.
4. delete removes row; no `readFileSync` crash on next generate.
5. Global scan-backgrounds still works.

### Master knowledge sections to update
- Location Background Images (full subsection)
- Database Schema — locations + document `location_backgrounds`
- Image Generation Flow — img2img branch

---

# F5 — Learning snapshots + ratings promotion

**Audit IDs:** CB-5, SM snapshots

### Exact files to change
- `src/services/image-pipeline.js`
- `src/routes/images.js`
- `src/services/exemplar-promotion.js` (verify only after F2)
- `story-lab-a1111-master-knowledge.md`
- Cross-check: `docs/superpowers/specs/2026-06-28-image-summary-learning-design.md`

### What to change
1. On generate persist: write `summary_plain_snapshot`, `summary_tags_snapshot`, `style_context_snapshot` using existing helpers.
2. Ratings SELECT: `id, turn_id, summary_plain_snapshot, summary_tags_snapshot, style_context_snapshot` (not `id` only).
3. Optional fallback for old rows: derive from turn `scene_card_json`.
4. No new learning product — make the wired path functional.

### Risk level
**Medium** — bad snapshots can poison exemplars; freeze-at-generate must match design.

### How to verify
1. Generate image with plain+tags -> snapshot columns non-empty.
2. Rate above thresholds with learning on -> exemplars created; learning API returns them.
3. Learning off -> no new exemplars.
4. Document behavior for pre-fix images without snapshots.

### Master knowledge sections to update
- Database Schema — scene_images (+ learning tables)
- Service Layer — image-pipeline / exemplar-promotion
- API Routes — ratings PATCH + learning GETs
- Known Stubs — learning no longer "dead"

---

# F6 — Enhancer must not drop LoRAs / master negatives

**Audit IDs:** BW-01 / enhancer overwrite

### Exact files to change
- `src/services/image-pipeline.js`
- `src/services/story-enhancer.js` (accept or drop dead kwargs)
- Optional small helper in `src/services/prompt-builder.js`
- `story-lab-a1111-master-knowledge.md`

### What to change
1. Recommended: enhancer rewrites scene body; pipeline owns prefix/suffix/LoRA/master_negative wrap.
2. After enhance success: re-append `_loraTags(config)` if missing; merge `master_negative` + profile negatives into final negative.
3. Fix dead kwargs: wire into scene string or extend `buildSdxlPrompt` signature — no silent unused args.
4. Keep fallback to deterministic prompt on enhancer failure.

### Risk level
**Medium** — duplication / length if naive concat; check no double LoRA tags.

### How to verify
1. Profile LoRA + master_negative set; enhancer success path.
2. Final A1111 payload contains `<lora:...>` and master negative phrases.
3. Enhancer failure path still has LoRAs + master neg from deterministic build.
4. Negatives not empty when master_negative set.

### Master knowledge sections to update
- Service Layer — image-pipeline Phase 9 enhancer
- Prompt Assembly — ownership: body vs wrap layers
- Replace enhancer.js "NOT YET IMPLEMENTED" with `story-enhancer.js` truth
- Image Generation Flow — stage 2b merge rules

---

# F7 — Narrator + picker respect NSFW flags

**Audit IDs:** CB-8, picker hardcoded true

### Exact files to change
- `src/services/narrator.js`
- `src/services/image-pipeline.js`
- Optionally `src/routes/turns.js` if scenario flag must be passed through
- `story-lab-a1111-master-knowledge.md`

### What to change
1. Precedence (document): master `nsfw_enabled` is hard ceiling; `scenarios.nsfw_enabled=false` further restricts.
2. Branch narrator system copy:
   - off -> SFW / fade-to-black
   - nsfw on / explicit off -> adult but not hardcore
   - both on -> current explicit instruction
3. Gate cast "arousal 10 MUST initiate sex" directives when NSFW off.
4. `pickBestMoment(..., effectiveNsfw === true)` — stop hardcoded `true`.

### Risk level
**Medium** — changes story behavior; needs play-turn smoke.

### How to verify
1. Master NSFW off + new turn -> no "fully enabled" unrestricted clause.
2. SFW turns produce low-arousal / non-explicit scene cards.
3. Image generate with NSFW off -> picker nsfw arg false.
4. Master on + scenario off -> restricted (chosen precedence).
5. Both on -> prior explicit behavior restored.

### Master knowledge sections to update
- Service Layer — narrator.js
- Narrator Response Format / arousal_level tiers
- Config Resolution Chain — scenario vs master NSFW
- scenario-setup Safe Mode / Settings
- Known Stubs — remove ungated-narrator claims

---

# F8 — Styles / Images routes (quarantine)

**Audit IDs:** BW-1, BW-2

### Exact files to change
- `public/js/app.js`
- `public/js/views/styles.js`
- `public/js/views/style-creator.js`
- `public/js/views/images.js`
- `public/js/views/dashboard.js`
- Optionally `public/index.html`
- `story-lab-a1111-master-knowledge.md`

### What to change (quarantine — no Styles backend in this pass)
1. Styles: guard `initStyles` with honest "use Image Profiles in Settings" panel; do not call `API.listStyles`. Or unroute `#styles` and redirect.
2. Images: retarget/remove dashboard `#images` link; stub or unroute so gallery APIs are never called.
3. Keep Settings Image Profiles (`/api/profiles`) as the supported path.

### Risk level
**Low** — frontend-only.

### How to verify
1. `#styles` -> no TypeError; honest message or redirect.
2. Dashboard Images link -> intentional destination, no missing-API crash.
3. Settings Profiles still load/save.
4. Play styles shortcut (if any) does not crash.

### Master knowledge sections to update
- Frontend / Directory Structure — styles routed-but-stubbed
- Known Stubs — Styles/Images status
- Routes absent — still no `/api/styles` if quarantined
- api.js method list — remove phantom style/gallery claims
- styles table vs image_profiles clarity

---

## Cross-cutting verification (after all 8)

- [ ] NSFW/explicit/learning survive restart (F2)
- [ ] Prompt tags respect arousal + gates (F1)
- [ ] Narrator + picker share effective NSFW (F7)
- [ ] Face accept -> IP-Adapter loads (F3)
- [ ] Scenario BG generate -> img2img (F4)
- [ ] Rate image -> exemplars only when learning on + snapshots present (F5)
- [ ] Enhancer success keeps LoRA + master_negative (F6)
- [ ] Styles/Images no longer throw (F8)
- [ ] Master knowledge Known Stubs no longer contradicts disk

## Out of scope (deferred)

- Progressive A1111 strip / degraded UI
- Portrait/fullbody one-pipeline unification
- Filter Rules persistence
- llama.cpp non-narrator roles
- Full Styles CRUD / character gallery backend
- Arousalmax 5 vs 10 scale redesign

## Suggested commits (implementation session)

1. `fix: gate arousal tags and default missing arousal to 1`
2. `fix: stop forcing NSFW/learning config true on boot; coerce learning boolean`
3. `fix: honor NSFW flags in narrator and scene picker`
4. `fix: load FaceID refs from reference_image_path`
5. `fix: register location backgrounds for img2img resolve`
6. `fix: persist learning snapshots and fix ratings promotion SELECT`
7. `fix: re-apply LoRAs and master negative after story enhancer`
8. `fix: quarantine Styles/Images UI missing API calls`
9. `docs: sync master knowledge for top-8 audit fixes`

## Implementation checkboxes

- [ ] F1 NSFW gating
- [ ] F2 Boot overwrite + BOOLEAN_KEYS
- [ ] F7 Narrator/picker NSFW (after F1/F2)
- [ ] F3 FaceID column alignment
- [ ] F4 Background registry
- [ ] F5 Learning snapshots/ratings
- [ ] F6 Enhancer LoRA/neg merge
- [ ] F8 Styles/Images quarantine
- [ ] Master knowledge updates per issue
- [ ] Cross-cutting verification
