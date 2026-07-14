# Image Summary Panel and Alignment Learning - Design Spec

Date: 2026-06-28
Status: Approved (pending implementation)
Project: story-lab-a1111 (port 4090)
Related: 2026-06-15-story-aware-image-generation-design.md, Phase 9 pipeline

---

## Context

Users experience inconsistent image quality and fragile prompt behavior because image
intent is computed across multiple backend layers but is not visible or editable until
after generation. The narrator already produces a scene card (---SCENE--- block) with
image_prompt, and prompt-extractor.js can produce SDXL tags, but these are not
surfaced per turn in the play UI. Additional advisory layers (scene-picker,
story-enhancer) may rewrite prompts at generate time without user visibility.

This spec defines:

1. A per-turn Image Summary panel (plain language + tags), separate from narration
2. User editing and tag regeneration from plain text
3. Dual post-generation ratings: content match vs style/look match
4. A quality-gated learning system that promotes exemplars only on high alignment scores

Goals align with incremental improvement of the existing stack. No rewrite of A1111,
narrator, or unified image pipeline.

---

## Goals

- Surface image intent on every narrator turn before GPU work
- Split content (what is in the scene) from style (how it looks)
- Let users refine plain language, regenerate tags, and manually adjust tags
- Persist all edits and generation snapshots for audit and learning
- Learn from alignment quality, not generation volume
- Preserve working play flow; add panel and ratings without breaking turns or WS delivery

---

## V1 Scope Boundaries

### V1 must include

These ship together as one releasable slice. Nothing below is optional for v1.

- **Panel CRUD** - display plain + tags on narrator turns; expand/collapse per Settings default; Save, Reset, editable textareas
- **Settings keys** - image_summary_panel_default, summary_rating_prompt_enabled, learning toggles/thresholds (see Settings table)
- **Scene card fields** - summary_plain, summary_tags, _meta on turns.scene_card_json; read-time migration shim from image_prompt
- **summary_edit_events table** - log all plain/tags changes with before/after
- **PATCH scene-summary** - persist user edits
- **POST regenerate-tags** - minimal regenerateTagsFromPlain (Ollama, exemplar few-shot when pool non-empty)
- **Generate snapshots** - summary_plain_snapshot, summary_tags_snapshot, style_context_snapshot on scene_images at generate time
- **Advisory-skip logic** - skip scene-picker and story-enhancer when user owns tags (see Tag Ownership Rules)
- **Dual rating flow** - content + style prompts after scene image_ready; PATCH ratings; Skip behavior defined
- **Exemplar tables** - summary_exemplars and style_exemplars with promotion on rating Save
- **History UI (minimal)** - read-only modal via History link in panel; backed by GET summary-history
- **Frontend extraction** - play.js delegates to public/js/play/image-summary-panel.js and image-rating-prompt.js (no new logic bloating play.js)
- **DB migrations** - forward-only additive ALTER/CREATE; no backfill beyond read-time shim (see Implementation Notes)

### Not in V1 but planned

Do not block v1 on these. Explicitly deferred:

- **Learned looks** read-only list in Settings (style exemplar browser)
- **Style exemplar UI** beyond storage and promotion (no apply-profile-from-exemplar button)
- **Audit views** - dedicated audit UI for summary pipeline (audit.jsonl logging in v1 is enough)
- **GET /api/learning/exemplars/** UI consumers (endpoints may exist for debug; no Settings browser)
- **Summary-history advanced UI** - diff view, filters, export (v1 is simple list modal only)
- **Per-scenario learning profiles** - separate exemplar pools per scenario (v1 uses global pool with per-scenario cap)
- **Style exemplar injection** - advisory style-hint layer from style_exemplars
- **Rating prompt** for character/fullbody/portrait modes (scene mode only in v1)
- **Auto-save on blur** - explicit Save only in v1
- **Locale/language filtering** on exemplars (see Exemplar rules; English-only assumption documented)
- **Removing image_prompt** from all code paths (dual-write in v1; removal after adoption)

---

## User-Facing Behavior

### Image Summary panel (per narrator turn)

Each narrator turn card includes a collapsible Image Summary block below story text.
It is never embedded inside narration prose.

Fields:

| Field | Label in UI | Purpose |
| --- | --- | --- |
| Plain language | Summary | Human-readable shot description - primary intent |
| Tags | Tags | Comma-separated SDXL tags - primary A1111 content input |

Actions:

| Button | Behavior |
| --- | --- |
| Save | Persist both fields to turns.scene_card_json; log edit events |
| Update tags from plain | Call backend to regenerate tags from current plain text + exemplars |
| Reset | Restore narrator/extractor originals from _meta snapshot on scene card |
| History | Opens read-only modal: timestamp, field, source, before to after (see History UI) |

Collapsed (minimized) view: One-line preview (first ~80 chars of plain) + expand chevron.

Empty state: "No summary yet" if scene card missing. Parse failure: "Summary unavailable" - not silent blank.

Per-turn chevron toggles expand/collapse for the session. Global default comes from Settings.

**V1 History UI:** Simple read-only list in a modal (timestamp, field, source, before to after) accessible via History link in the panel. Prevents GET summary-history from being dead code and aids debugging when prompts misbehave.

### Settings

Stored in global_config (DB persistence - no localStorage).

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| image_summary_panel_default | string | visible | visible or minimized - default expand state for new turns |
| summary_rating_prompt_enabled | boolean | true | Show post-generation rating UI |
| summary_content_min_for_learning | integer | 4 | Min content alignment score (1-5) for summary exemplar promotion |
| summary_style_min_for_learning | integer | 4 | Min style alignment score (1-5) for style exemplar promotion |
| summary_exemplar_max | integer | 50 | Global max rows per exemplar table |
| summary_exemplar_max_per_scenario | integer | 10 | Max exemplars contributed from a single scenario_id |
| summary_learning_enabled | boolean | true | Master switch for exemplar injection on tag regen |

Settings UI location: Settings > Master Settings, subsection "Image Summary and Learning".

### Post-generation dual ratings

After image_ready for a **scene-mode** image, show a rating panel (modal or inline under image).

Question 1 - Content: How well did this image match the summary?
Display quoted summary_plain_snapshot. Scale 1-5.

Question 2 - Style: How well did this image match the intended look?
Display style context line from style_context_snapshot. Scale 1-5.

Optional feedback chips (multi-select):

| Chip | Dimension |
| --- | --- |
| Wrong pose / action | Content |
| Wrong clothing / nudity | Content |
| Wrong location / background | Content |
| Wrong character count | Content |
| Wrong lighting / mood | Style |
| Wrong realism / art style | Style |
| Wrong color / grade | Style |
| Too soft / too sharp | Style |

**Skip:** Dismisses permanently for that scene_image_id. Ratings stay NULL. No exemplars. No automatic re-prompt.

**Save:** Persists ratings; runs exemplar promotion. Idempotent re-promotion if ratings upgraded (see Rating persistence).

**Rate match (later edit):** User may open ratings again from image context menu. PATCH overwrites prior scores. Exemplar promotion runs again; can upgrade rating on existing exemplar row or insert if newly eligible. Does not duplicate if same source_image_id already promoted (update content_rating/style_rating in place).

**Browser close / navigate away before Save:** Ratings remain NULL on scene_images row. No re-prompt on return for that image unless user chooses Rate match. No exemplar promotion.

Do not auto re-prompt on page reload. One voluntary prompt per image at most unless user opens Rate match.

### User workflow (happy path)

1. Narrator turn arrives — summary_plain seeded from scene card; summary_tags from extractor if enabled, else empty
2. User edits plain — Save
3. User clicks Update tags from plain — backend regenerates tags; user tweaks tags — Save
4. User clicks Generate — snapshots frozen on scene_images; A1111 uses canonical_tags
5. image_ready — dual rating prompt — Save
6. content/style >= thresholds — exemplars promoted per pool cap rules

---

## Failure and Edge Behavior

Explicit behavior for non-happy paths. Implement exactly; do not leave ambiguous.

### regenerateTagsFromPlain failure

| Condition | Backend | UI |
| --- | --- | --- |
| Ollama offline / timeout / HTTP error | Return 502/503 with error message; no DB write | Toast error; **keep existing tags unchanged**; plain unchanged |
| Empty model configured | Return 400; log prompt-extractor no model | Toast: configure model in Settings |
| Response too short (< 20 chars) or validation fail (bullets, refusal phrases) | Return 422; log validation fail | Toast: invalid tag output; **keep existing tags** |
| Success | Return { tags }; log summary_edit_events regenerate_tags | Replace tags textarea; user must Save to persist (or optional auto-fill textarea only, persist on Save) |

Never overwrite tags with empty string on failure.

### Extractor disabled or failed at turn time

If prompt_extractor_model and post-turn extractImagePrompt are disabled, absent, or fail:

- summary_tags remains **empty** until user clicks Update tags from plain or types tags manually
- Turn still completes; narration unaffected
- **Generation is still allowed:** pipeline uses canonical_tags = summary_tags || summary_plain || image_prompt (plain falls through to legacy path when tags empty)
- buildPrompt treats plain-only input as scene_image_prompt when tags empty (existing prompt-builder behavior)

Non-fatal extractor errors at turn time: console + log; do not fail the turn POST.

### Missing or malformed scene_card JSON

| Condition | Behavior |
| --- | --- |
| No ---SCENE--- block | defaultSceneCard(); summary_plain empty; log input-parser no scene block; panel shows empty state |
| JSON parse error | story_text preserved; defaultSceneCard(); log warn with snippet; panel shows Summary unavailable |
| Partial JSON | Merge known fields; defaults for rest; log if image_prompt missing |

Never throw from turn insert due to scene card parse failure.

### PATCH scene-summary failure

Toast error; client retains unsaved textarea content; no partial server state.

### Rating PATCH failure

Toast error; modal stays open; ratings not saved; no exemplar promotion.

---

## Tag Ownership Rules

Precedence and conflict resolution for who controls tags on a turn.

### User ownership definition

A turn has **user-owned tags** when ANY of:

1. scene_card._meta.tags_source === 'user'
2. Latest summary_edit_events row for this turn with field='tags' and source IN ('user', 'regenerate_tags') exists after any narrator/extractor write

Note: regenerate_tags counts as user-initiated pipeline (skip advisory) even before explicit Save, once user clicks Update tags from plain and succeeds.

### Conflict resolution

| Situation | Rule |
| --- | --- |
| User edited tags; later narrator turn on same turn row | **Impossible** - turns are immutable; new turn gets new scene card |
| User edited tags on turn N; new narrator turn N+1 arrives | Turn N tags frozen. Turn N+1 gets fresh narrator/extractor seed; no cross-turn overwrite |
| User edited plain but not tags | tags_source unchanged; advisory may still run unless user also owns tags |
| User hits Reset | Restore _meta.plain_original and tags_original; set sources back to narrator/extractor; **advisory re-enabled** for that turn |
| User Save after manual tag edit | tags_source = user; dual-write summary_tags and image_prompt |
| regenerate_tags success then Save | tags_source = user (if user saves without further edit) or regenerate_tags until user manually edits tags field |

### Advisory skip (when user owns tags)

Skip pickBestMoment and buildSdxlPrompt. Log audit advisory_skipped reason user_edited_tags.

### Narrator re-write on same turn

Narrator does not re-run on existing turn rows. If a future regen-narrator feature exists, it must **not** overwrite summary_plain or summary_tags when user ownership is true unless user confirms Reset.

---

## Data Model

### Scene card JSON extension (turns.scene_card_json)

```json
{
  "summary_plain": "...",
  "summary_tags": "...",
  "image_prompt": "legacy - keep in sync with summary_tags on Save",
  "mood": "intimate",
  "arousal_level": 6,
  "explicit_act": null,
  "nudity_state": null,
  "body_positions": null,
  "clothing_changes": [],
  "_meta": {
    "plain_source": "narrator | user | empty",
    "tags_source": "extractor | regenerate_tags | user | empty",
    "plain_original": "...",
    "tags_original": "...",
    "last_edited_at": "ISO8601",
    "locale": "en"
  }
}
```

Population on new narrator turn:

1. parseNarratorResponse() maps image_prompt to summary_plain
2. extractImagePrompt if configured - else summary_tags stays empty
3. Store originals in _meta; set locale en (v1 English-only assumption)

**Read-time migration shim (only backfill):** On load, if summary_plain absent copy from image_prompt. If summary_tags absent and image_prompt is comma-heavy, copy to summary_tags; else leave tags empty. No bulk DB backfill job.

### scene_images new columns

```sql
ALTER TABLE scene_images ADD COLUMN summary_plain_snapshot TEXT DEFAULT '';
ALTER TABLE scene_images ADD COLUMN summary_tags_snapshot TEXT DEFAULT '';
ALTER TABLE scene_images ADD COLUMN style_context_snapshot TEXT DEFAULT '';
ALTER TABLE scene_images ADD COLUMN content_alignment_rating INTEGER DEFAULT NULL;
ALTER TABLE scene_images ADD COLUMN style_alignment_rating INTEGER DEFAULT NULL;
ALTER TABLE scene_images ADD COLUMN content_feedback TEXT DEFAULT NULL;
ALTER TABLE scene_images ADD COLUMN style_feedback TEXT DEFAULT NULL;
ALTER TABLE scene_images ADD COLUMN summary_rated_at TEXT DEFAULT NULL;
ALTER TABLE scene_images ADD COLUMN rating_skipped INTEGER DEFAULT 0;
```

rating_skipped = 1 when user clicks Skip (distinguish NULL not yet prompted vs skipped).

style_context_snapshot JSON at generate time:

```json
{
  "profile_id": 2,
  "profile_name": "Cinematic Realism",
  "model_name": "realcartoonXL_v7.safetensors",
  "lora1_file": "SDXL-TouchofRealismV2-0506.safetensors",
  "lora1_strength": 0.8,
  "master_positive_snippet": "masterpiece, cinematic lighting...",
  "profile_prefix_snippet": "film still, shallow depth of field...",
  "hr_enabled": true,
  "ad_enabled": true,
  "refiner_enabled": false
}
```

### summary_edit_events

```sql
CREATE TABLE IF NOT EXISTS summary_edit_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id    INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  turn_id        INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  field          TEXT NOT NULL,
  source         TEXT NOT NULL,
  value_before   TEXT DEFAULT '',
  value_after    TEXT DEFAULT '',
  scene_image_id INTEGER REFERENCES scene_images(id) ON DELETE SET NULL,
  created_at     TEXT DEFAULT (datetime('now'))
);
```

field: plain | tags  
source: narrator | extractor | user | regenerate_tags

### summary_exemplars

```sql
CREATE TABLE IF NOT EXISTS summary_exemplars (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  summary_plain   TEXT NOT NULL,
  summary_tags    TEXT NOT NULL,
  content_rating  INTEGER NOT NULL,
  source_scenario_id INTEGER REFERENCES scenarios(id) ON DELETE SET NULL,
  source_turn_id  INTEGER REFERENCES turns(id) ON DELETE SET NULL,
  source_image_id INTEGER REFERENCES scene_images(id) ON DELETE SET NULL,
  locale          TEXT DEFAULT 'en',
  created_at      TEXT DEFAULT (datetime('now'))
);
```

### style_exemplars

```sql
CREATE TABLE IF NOT EXISTS style_exemplars (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  style_context_snapshot TEXT NOT NULL,
  content_tags_snapshot  TEXT DEFAULT '',
  style_rating           INTEGER NOT NULL,
  content_rating         INTEGER DEFAULT NULL,
  source_scenario_id     INTEGER REFERENCES scenarios(id) ON DELETE SET NULL,
  source_image_id        INTEGER REFERENCES scene_images(id) ON DELETE SET NULL,
  locale                 TEXT DEFAULT 'en',
  created_at             TEXT DEFAULT (datetime('now'))
);
```

---

## Exemplar Promotion Rules (quality over quantity)

### Pool scope

- **Global pool** - summary_exemplars and style_exemplars are global tables, not per-scenario isolated
- **Per-scenario cap** - no single scenario_id may contribute more than summary_exemplar_max_per_scenario rows in each table; when promoting, if scenario at cap, evict lowest-rated exemplar from that scenario before insert
- **Global cap** - when total rows > summary_exemplar_max, prune globally: delete oldest rows with lowest rating first (tie-break: oldest created_at)

### Language / locale

V1 assumes **English** play and prompts. Exemplars store locale='en'. regenerateTagsFromPlain injects only exemplars matching locale en (future: filter by scenario language setting). Non-English play is unsupported in v1; do not mix locales in the pool.

### Summary exemplar promotion

When ALL true: learning enabled; content_rating >= threshold; snapshots non-empty; not Skip; dedupe by normalized plain text unless new rating higher on same source_image_id (update in place).

### Style exemplar promotion

When ALL true: learning enabled; style_rating >= threshold; style snapshot non-empty; same cap and dedupe rules by source_image_id.

### Cross-signals (informational)

| Content | Style | Action |
| --- | --- | --- |
| 5 | 5 | Gold row — highest weight in both pools |
| 5 | 2 | Summary exemplar yes; style exemplar no |
| 2 | 5 | Style exemplar yes; summary exemplar no |
| 2 | 2 | Log only; suggest edit summary or profile |

### Exemplar use in v1

Update tags from plain injects up to 8 summary_exemplars (locale en, ordered by content_rating DESC, created_at DESC). Style exemplars stored only; no injection in v1.

---

## Pipeline Rules

### At turn completion

1. Narrator to summary_plain
2. Optional extractor to summary_tags (may stay empty)
3. applyClothingChanges unchanged

### regenerateTagsFromPlain

See Failure and Edge Behavior. On success return tags; log edit event on Save not on preview unless auto-log preview regen.

### At image generation (scene mode)

```
canonical_plain = summary_plain || image_prompt
canonical_tags  = summary_tags || summary_plain || image_prompt
```

User-owned tags: skip advisory layers.

Snapshots on INSERT scene_images:

- summary_plain_snapshot = canonical_plain
- summary_tags_snapshot = canonical_tags (user-owned value, pre-advisory)
- style_context_snapshot = JSON from resolveEffectiveConfig at generate time

### Narrator instruction change

- SCENE_CARD instructs **prose-only** observable description in image_prompt JSON key (mapped to summary_plain)
- If narrator slips comma-tags into prose, extractor/regenerate may still work; **do not depend on it**
- Regression test (manual or automated): flag scene cards where summary_plain matches tag-like heuristic (comma count > 8, no sentence punctuation)
- **Legacy:** dual-write image_prompt from summary_tags on Save in v1
- **After adoption stable:** remove image_prompt dependency from new code paths; image_prompt column in JSON deprecated

---

## API Surface

| Method | Path | Notes |
| --- | --- | --- |
| PATCH | /api/scenarios/:scenarioId/turns/:turnId/scene-summary | V1 required |
| POST | /api/scenarios/:scenarioId/turns/:turnId/regenerate-tags | V1 required |
| PATCH | /api/scenarios/:scenarioId/images/:imageId/ratings | V1 required |
| GET | /api/scenarios/:scenarioId/turns/:turnId/summary-history | V1 required (powers History modal) |
| GET | /api/learning/exemplars/summary | Debug only; no v1 UI |
| GET | /api/learning/exemplars/style | Debug only; no v1 UI |

---

## Implementation Notes (Stack)

### play.js delegation

**play.js must not grow.** All Image Summary panel logic lives in public/js/play/image-summary-panel.js:

- renderPanel(turn, scenarioId, defaultCollapsed)
- wireSave, wireReset, wireRegenerateTags, wireHistory
- collapse state per turn element

All dual-rating logic lives in public/js/play/image-rating-prompt.js:

- queueRatingPrompt(imageRow, snapshots)
- wireSkip, wireSaveRatings

play.js only: import/init hooks, pass turn data, call on image_ready.

### DB migrations

Forward-only additive migrations in db.js using try/catch ALTER TABLE and CREATE TABLE IF NOT EXISTS pattern already used in project.

- **No bulk backfill** of summary_plain/summary_tags on existing turns
- **Read-time shim** in input-parser or route layer when loading turns for display
- New columns default NULL or empty string; existing rows valid without migration job

### New backend files

- src/services/regenerate-tags.js (or extend prompt-extractor.js with regenerateTagsFromPlain export)
- src/routes/ turn summary routes may live in turns.js or new turn-summary.js mounted under turns

---

## Frontend Modules

```
public/js/play/
  image-summary-panel.js
  image-rating-prompt.js
```

Modified: play.js (hooks only), api.js, settings.js, input-parser.js, db.js, turns.js, images.js, image-pipeline.js.

---

## Audit and Observability

V1: audit.jsonl stages per generation (no dedicated audit UI in v1):

| Stage | Logged output |
| --- | --- |
| resolve_config | profile_id, model |
| resolve_summary | canonical_plain, canonical_tags, user_edited flag |
| advisory_skipped | reason if applicable |
| build_prompt | final prompt parts |
| a1111_call | txt2img or img2img |
| persist | scene_image_id, snapshot field lengths |

Rating save: log summary_rating_saved with image id, both scores, promoted flags.

---

## Implementation Phases (aligned to V1 must include)

| Phase | Delivers |
| --- | --- |
| A | Panel display + settings default + read shim |
| B | Save/Reset + edit events + PATCH |
| C | regenerate-tags + failure behavior |
| D | Snapshots + advisory-skip + generate precedence |
| E | Dual ratings + exemplar tables + promotion + History modal |
| F | Doc sync only (Learned looks etc. explicitly post-v1) |

---

## Function Specs and Test Checklists

### Function 1: Image Summary Panel (display + collapse)

UI: Collapsible panel on narrator turns; plain + tags textareas; History link.

Guard: Not on user turns. Default expand per image_summary_panel_default.

Errors: Empty state; parse failure shows Summary unavailable; log parse warn server-side.

Tests:

1. Narrator turn with scene card — panel shows summary_plain
2. Settings minimized — new turns collapsed with preview line
3. Settings visible — new turns expanded
4. User turn — no panel
5. Chevron toggle preserves textarea content
6. History opens modal with edit events list

---

### Function 2: Save summary edits

UI: Save, Reset buttons.

Backend: PATCH scene-summary; log summary_edit_events per changed field.

Errors: Toast on failure; retain unsaved client text.

Tests:

1. Edit plain — Save — reload — persisted
2. Edit tags — tags_source = user; dual-write image_prompt
3. Reset restores originals; advisory re-enabled
4. New turn N+1 does not overwrite turn N user tags

---

### Function 3: Update tags from plain

UI: Button + loading state.

Backend: POST regenerate-tags; see Failure table.

Tests:

1. Success — tags textarea updated; Save persists
2. Ollama offline — toast; tags unchanged
3. Invalid/empty output — toast; tags unchanged
4. No model configured — toast; no request
5. With exemplars — output reflects few-shot (manual QA)

---

### Function 4: Generate snapshots and advisory skip

Backend only.

Tests:

1. scene_images snapshots match turn at generate time
2. Post-generate turn edit does not alter snapshots
3. user-owned tags — audit advisory_skipped
4. Empty tags — generate uses plain via canonical_tags fallback
5. Extractor disabled — generate still succeeds with plain only

---

### Function 5: Dual post-generation ratings

UI: Content + style 1-5; chips; Skip; Save; Rate match menu.

Tests:

1. Prompt shows plain snapshot quote and style line
2. Skip — rating_skipped=1; NULL ratings; no exemplars; no auto re-prompt
3. Navigate away — NULL ratings; no exemplars
4. Content 5 / style 2 — summary exemplar only
5. Rate match with upgraded score — exemplar rating updated in place
6. Per-scenario cap — 11th exemplar from same scenario evicts lowest from that scenario
7. Global cap — prune lowest rating oldest first

---

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Scope creep | V1 must include / Not in v1 lists |
| Tag loss on regen fail | Never overwrite with empty |
| One scenario dominates pool | per-scenario cap |
| play.js bloat | mandatory module extraction |
| image_prompt legacy confusion | dual-write v1; removal planned |

---

## Success Criteria (V1)

- All items under V1 must include shipped and testable
- None of Not in v1 but planned required for release
- Failure behaviors match tables above
- History modal shows edit trail for debugging

---

## Document Sync

Update story-lab-a1111-master-knowledge.md and CLAUDE.md on v1 completion.

---

## Open Questions

1. Auto-save on blur - deferred; explicit Save in v1
2. Non-English locale - deferred; en only in v1
3. Style exemplar advisory layer - post-v1