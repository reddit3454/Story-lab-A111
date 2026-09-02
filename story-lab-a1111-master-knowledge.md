# Story-Lab-A1111 Master Knowledge Document

> **REBUILD NOTICE (2026-07-20):** Image generation was purged on 2026-07-19, then rebuilt from a
> clean slate. Current live path is A1111-direct (not ComfyUI / ImageCore). Style comes only from
> exactly one active Look (`image_looks`). Orchestrator: `src/services/image-pipeline.js`
> (scene / portrait / fullbody). Prompt order: Style (Look) -> Character + FaceID -> Action ->
> Location + clothing; content stages strip style words. Generation is on-command only (never
> auto on narrator turns). Soft-fail if A1111 or FaceID/ControlNet is down. See CLAUDE.md,
> IMAGE_PIPELINE_REBUILD_HANDOFF.md, and VERIFY.md. Older sections below that describe ComfyUI,
> ImageCore, dual styles/image_profiles, pose-catalog, or the pre-purge pipeline are HISTORICAL
> RECORD ONLY — trust CLAUDE.md + the live `src/` tree over those passages.

> **Purpose:** Complete authoritative reference for the story-lab-a1111 codebase.
> Hand this document to any coding model with codebase access to establish full
> project context before any task.
>
> **Status:** Phases 1–9 complete (as of 2026-06-15). Full stale-API audit done (2026-06-14);
> all ImageCore/ComfyUI references removed. llamacpp narrator support added.
> Characters decoupled from scenarios (2026-06-14): global `/api/characters` CRUD +
> `scenario_characters` join table + live cast management UI in wizard and play view.
> Phase 8 (2026-06-14): full persistence audit — all scenario wizard fields now persist (18 new
> DB columns), `character_relationships` table + full CRUD + narrator wiring + play sidebar UI,
> dashboard data bug fixed, scenario-edit field-load bug fixed, play.js `allLocations` populated,
> `unique_trait` on characters, `is_default` migration on `character_fullbodies`.
> Phase 9 (2026-06-15): story-aware image generation — `image_prompt` field added to narrator
> scene card; `src/services/scene-picker.js` (advisory moment selector) and
> `src/services/story-enhancer.js` (SDXL prompt writer) added; both wired into
> `image-pipeline.js` as optional advisory layers with full fallback to deterministic assembly.
> Server runs at port 4090.
> The source code is the ground truth for what is built. The Implementation Status
> section at the bottom tracks completed phases with exact API surface and notes.
> The "Known Stubs and Unimplemented Features" section lists everything that is absent
> or not yet functional — consult it before answering "is X implemented?"
> The design spec remains useful for intent and future phases.
>
> **Design spec:** `docs/superpowers/specs/2026-06-10-story-lab-a1111-design.md`
> **Original reference:** `E:\TheHub\projects\story-lab\` (do not modify)


> **Visual brief 2026-07-13h:** Per-turn `scene_card_json.visual_brief` replaces image-oriented scene summarization. `main_subject` drives scene focus/FaceID. Character images use stored brief chain (current→prior→generic). `image_prompt` is legacy fallback only.
>
> **Local-model prompts 2026-07-13g:** Ollama `format` transport; schema JSON for scene-picker + emotion tracker; shared `tag-dialect`; NSFW-gated slim narrator scene card; short story-enhancer 3-line contract.
>
> **Audit fixes 2026-07-13 (top-8):** NSFW arousal gating enforced in `prompt-builder`; boot no longer force-sets nsfw/explicit/learning true; FaceID reads `reference_image_path`; scenario backgrounds register into `location_backgrounds`; learning snapshots written + ratings SELECT fixed; enhancer re-applies LoRAs/master negative; narrator+picker honor NSFW flags; Styles/Images UI quarantined (use Settings Image Profiles). Plan: `docs/superpowers/plans/2026-07-13-top8-audit-fixes.md`. Owner plain-English walkthrough: docs/OWNER-APP-BEHAVIOR-WALKTHROUGH.md.


---

## What This Project Is

**2026-07-20 update:** image generation is LIVE again via the Looks + A1111 rebuild. Passages below that still describe ComfyUI/ImageCore/dual styles/pose-catalog are historical; see CLAUDE.md and IMAGE_PIPELINE_REBUILD_HANDOFF.md for current behavior.
history — image generation (A1111 included) was itself fully removed on 2026-07-19. Story Lab
is now a text-only narrator/roleplay companion: LLM narration, character/scenario/relationship
state, mood/arousal tracking, memory, lore, rules. No image generation of any kind remains.

story-lab-a1111 is a ground-up rebuild of story-lab — a local AI collaborative fiction
tool (Node.js/Express, port 4090) — with AUTOMATIC1111 (A1111) replacing the broken
ComfyUI/ImageCore image generation pipeline.

The original story-lab's LLM/narration/story side (Ollama narration, character system,
clothing state, memory, lore, rules) worked well. The image pipeline never did — images
were unpredictable, the ComfyUI workflow routing was complex and fragile, and the
ImageCore middleware added a layer that repeatedly broke. This project takes what worked,
redesigns the backend cleanly knowing all features at once, and wires image generation
directly to A1111's simple REST API.

**What's new vs. the original:**
- Direct A1111 REST calls instead of ComfyUI workflows
- Full observability: every process stage logged to `audit_log` table + `audit.jsonl`
- A1111 quality features: Hires.fix (native), ADetailer (extension), ControlNet, FaceID
- Clean DB schema designed for all features at once — no incremental legacy columns
- Service boundaries are explicit — each service has one job and one interface
- Dropped: ImageCore, ComfyUI, Batch FaceID, Wan2.2 video, pose library
- Unified image generation pipeline — ALL image types (scene images, character portraits, full-body images, and any future image type) pass through the same single pipeline and config system. There is no separate pipeline per image type.
- Saved image generation profiles — users can save named profiles that pre-define prompt fragments, specific LoRAs, and turn-count behavior. Profiles sit below master settings in the resolution chain and cannot override structural master constraints.
- Narrator-driven scene data — narrator outputs story text AND a structured JSON scene block (`---SCENE---` ... `---END---`) in one response; no separate extractor LLM call needed. Scene card includes `image_prompt` field (camera-observable facts, under 40 words) used by the image pipeline.
- Template-driven prompt assembly — image prompts assembled deterministically from narrator-supplied scene data + profile prefix/suffix. An optional advisory LLM layer (`scene-picker` + `story-enhancer`) can rewrite the prompt for SDXL quality; both layers degrade gracefully to the deterministic result if the model is absent or the call fails.
- Location background images — pre-generated backgrounds enable img2img mode (denoising 0.45), improving environment consistency and reducing prompt complexity

**What's unchanged from the original:**
- `public/` overall structure — same HTML skeleton, CSS, view routing
- API surface compatibility — same endpoint paths and response shapes where features overlap
- Ollama for narration, extraction, summarization, enhancement
- Port 4090

**What changed in `public/` (Phase 5 targeted modifications, historical — since superseded by
the 2026-07-19 image-purge, which is the current state):**
- api.js: fully rewritten — all methods now scenario-scoped
- play.js: stale API calls fixed, Cast tab wired
- state.js / ui.js: status dots changed to Ollama only (post-purge)
- dashboard.js: Locations section removed
- scenario-setup.js: wizard no longer requires location; character sync removed
- characters.js: global list replaced with guidance; relationships/bonds editor live (strength/tags/edit/reverse)
- settings.js: stale LoRA/style/rules calls stubbed or corrected (Image Generation/Image Tools
  tabs removed entirely in the 2026-07-19 purge)
- index.html: inline hash routing removed; `locations-init.js` remains live and loaded

---

## Runtime Stack

| Item | Details |
|---|---|
| Runtime | Node.js 22.5+ (required for node:sqlite built-in) |
| Module system | ESM only — `"type": "module"` in package.json |
| Database | `node:sqlite` DatabaseSync (built-in, NOT better-sqlite3) |
| HTTP | Express 4.x |
| WebSocket | `ws` 8.x (singleton broadcaster) |
| LLM (primary) | Ollama at `http://localhost:11434` via `/api/chat` |
| LLM (alt) | llama.cpp / llama-server at `http://127.0.0.1:8080` via `/v1/chat/completions` (OpenAI-compatible) — optional narrator backend, configured via Settings > Model Backends |
| Dependencies | cors, express, ws — nothing else |

Start command: `node --experimental-sqlite --max-old-space-size=4096 src/server.js`

---

## Ports and Services

| Port | Service |
|---|---|
| 4090 | story-lab-a1111 (this project) |
| 11434 | Ollama |
| 8080 | llama-server (optional alternative narrator — see start-llamacpp.bat) |

Port 4060 (asset-library) has been removed from status monitoring. The status bar shows
Ollama only (post-purge).

---

## Directory Structure (as of Phase 4)

Files marked [PLANNED] do not exist yet. This tree is a Phase-4-era historical snapshot and
predates several routes/services added later (character-relationships.js, character-states.js,
global-locations.js, global-relationships.js) as well as the 2026-07-19 image-pipeline purge —
see "Service Layer" and "Route Layer" above for the current, accurate list.

```
story-lab-a1111/
  src/
    server.js                    Entry point, Express + WS, route mounting
    db.js                        SQLite schema, migrations, all CRUD helpers
    broadcast.js                 WS singleton broadcaster
    logger.js                    log() / logError() to console + audit.jsonl
    paths.js                     All filesystem path constants + ensureDirectories()
    input-parser.js              parseNarratorResponse() — splits ---SCENE--- block
    services/
      audit.js                   audit() — writes to audit_events DB + audit.jsonl; never throws
      ollama.js                  chat(), generate(), listModels(), checkHealth()
      a1111.js                   txt2img(), img2img(), getModels(), getLoras(),
                                 getProgress(), setModel(), getOptions(), checkHealth()
      model-resolver.js          resolveNarratorModel(db), resolveModels(db)
      config-resolver.js         resolveMasterConfig(db), resolveActiveProfile(db),
                                 resolveEffectiveConfig(db)
      narrator.js                buildSystemPrompt(), runNarratorTurn()
      prompt-builder.js          buildPrompt() — pure, no DB/LLM calls
      image-pipeline.js          generate() — 7-stage orchestrator
      memory.js                  shouldGenerateMemory(), generateMemory(), getRecentMemories()
      extractor.js               [PLANNED] separate scene card extractor (narrator does it inline now)
      enhancer.js                [PLANNED] SDXL prompt enhancer via Ollama
      clothing.js                [LIVE] scenario-scoped clothing; character outfit_sets library
      character.js               [PLANNED] character appearance block builder
    routes/
      health.js                  /health, /health/a1111, /health/ollama
      scenarios.js               Scenario CRUD
      characters.js              Global character CRUD + references + fullbody (no scenario_id)
      scenario-characters.js     Roster: GET/POST/:charId/DELETE/:charId at /api/scenarios/:id/characters
      turns.js                   GET + POST (role=user triggers narrator pipeline) + DELETE /:id
      images.js                  GET, POST /generate, PUT /:id/accept, PUT /:id/rate, DELETE /:id
      memories.js                GET + POST (manual) + DELETE /:id
      world.js                   World entries CRUD (mounted at /world)
      rules.js                   Rules CRUD
      locations.js               Location CRUD + background image routes
      config.js                  GET + POST + POST /batch (global_config key/value)
      profiles.js                Image profile CRUD + POST /:id/activate + DELETE /active
      a1111.js                   GET /models, GET /loras, GET /status, POST /model
      audit.js                   GET / (filterable), GET /:runId
      styles.js                  [PLANNED] Style preset CRUD
  public/                        Copied from story-lab; not yet adapted for A1111
  H:\MEDIA\Story_Lab\
    data\
      story-lab.db               SQLite database (path from paths.js DB_PATH)
      audit.jsonl                Pipeline audit events (JSON lines)
    images\{scenarioId}\         Generated scene/portrait/fullbody images
    backgrounds\{locationSlug}\  Location background images
  docs/
    superpowers/
      specs/
        2026-06-10-story-lab-a1111-design.md    Full design spec
  start-llamacpp.bat               Launches llama-server (port 8080, ctx 32768, MN-12B-Mag-Mell-R1 Q4)
  package.json
  module.json
```

### Dead files — STALE, corrected 2026-07-19

The table that used to live here (listing `styles-init.js`, `locations-init.js`,
`style-picker-patch.js`, `style-creator.js`, `views/styles.js` as "dead") was wrong even
before the image-generation purge: `public/js/locations-init.js` is actively loaded from
`index.html` and is live. The other four files named in that old table were image/style-UI
files and have since been deleted outright as part of the 2026-07-19 purge, along with the
rest of the image pipeline. Don't trust a "dead file" claim in this doc — grep the actual
`index.html`/import graph instead.

---

## Database Schema

All tables use WAL, foreign keys ON, tuned PRAGMAs. Migrations use ALTER TABLE in try/catch.
The DB file lives at `H:\MEDIA\Story_Lab\data\story-lab.db` (see `src/paths.js` DB_PATH).

Tables are created in a single `db.exec(...)` block in `src/db.js`. Additive migrations
use individual `try { db.exec('ALTER TABLE ...') } catch (_) {}` calls after the main block.

### scenarios

Original columns (in main CREATE TABLE block):
```
id INTEGER PK
title TEXT NOT NULL
description TEXT DEFAULT ''
system_prompt TEXT DEFAULT ''         -- full narrator system prompt; populated by UI
nsfw_enabled INTEGER DEFAULT 0
narrator_model TEXT DEFAULT ''        -- overrides global narrator_model when set
context_turns INTEGER DEFAULT 20      -- how many recent turns to include in context
status TEXT DEFAULT 'active'
created_at TEXT DEFAULT datetime('now')
updated_at TEXT DEFAULT datetime('now')
```

Extended columns added via additive migrations in `src/db.js` (Phase 8):
```
tone                      TEXT    DEFAULT 'Dramatic'
premise                   TEXT    DEFAULT ''
setting                   TEXT    DEFAULT ''
default_start             TEXT    DEFAULT ''         -- opening message for new play sessions
reply_length              TEXT    DEFAULT 'medium'
lust_level                INTEGER DEFAULT 3
explicitness_level        TEXT    DEFAULT 'moderate'
pacing                    TEXT    DEFAULT 'normal'
narrative_pov             TEXT    DEFAULT 'third'
violence_level            TEXT    DEFAULT 'mild'
tone_modifier             TEXT    DEFAULT ''
narrator_presence_enabled INTEGER DEFAULT 0
narrator_presence_mode    TEXT    DEFAULT 'all'
narrator_presence_config  TEXT    DEFAULT NULL       -- JSON blob for per-character config
active_location_id        INTEGER DEFAULT NULL
user_character_id         INTEGER DEFAULT NULL
ended_at                  TEXT    DEFAULT NULL
generation_config         TEXT    DEFAULT NULL       -- generic freeform JSON blob; unused since the image-purge removed its only consumers
```

`GET /api/scenarios` (list) now returns two computed columns alongside the row:
- `character_count` — count of linked characters via `scenario_characters`
- `last_turn_at` — `MAX(turns.created_at)` for the scenario
- `characters[]` — embedded array of character rows (id, name) per scenario

`PUT /api/scenarios/:id` uses a dynamic SET clause — only updates fields present in `req.body`.
Boolean fields (`nsfw_enabled`, `narrator_presence_enabled`) are cast to 0/1 integers on write.

### characters

Characters are **global** — not scenario-scoped. They belong to no particular scenario.
Scenarios pull characters via the `scenario_characters` join table.

Original columns (in main CREATE TABLE block):
```
id INTEGER PK
name TEXT NOT NULL
role TEXT DEFAULT 'character'
appearance_prompt TEXT DEFAULT ''
base_clothing TEXT DEFAULT ''
current_clothing TEXT DEFAULT ''
personality TEXT DEFAULT ''           -- stored as labeled block (see Personality Format below)
is_user INTEGER DEFAULT 0
created_at TEXT DEFAULT datetime('now')
```

Extended columns added via additive migrations in `src/db.js`:
```
description TEXT DEFAULT ''
appearance_notes TEXT DEFAULT ''
gender TEXT DEFAULT ''
age_range TEXT DEFAULT 'adult'
height TEXT DEFAULT ''
body_type TEXT DEFAULT ''
breast_size TEXT DEFAULT ''           -- 10 options: Flat/Petite/Small/Small-Medium/Medium/Medium-Large/Large/Extra Large/Very Large/Massive
butt_size TEXT
penis_state TEXT DEFAULT 'soft'
skin_tone TEXT DEFAULT ''
skin_extras TEXT
eye_color TEXT DEFAULT ''
eye_shape TEXT                        -- 6 options including Large Round Cartoon
nose_shape TEXT
lip_shape TEXT
face_shape TEXT
hair_color TEXT DEFAULT ''
hair_style TEXT DEFAULT ''
hair_extras TEXT
default_outfit TEXT
outfit_style TEXT
outfit_sets TEXT                      -- JSON array of { name, description, underwear }
default_outfit_name TEXT
is_user_character INTEGER DEFAULT 0   -- kept in sync with is_user on every write
moodbaseline INTEGER DEFAULT 3
arousalthreshold TEXT DEFAULT 'medium'
arousallockeduntil INTEGER DEFAULT 2
arousalmax INTEGER DEFAULT 5
moodtriggerspos TEXT
moodtriggersneg TEXT
arousaltriggers TEXT
unique_trait TEXT DEFAULT NULL        -- one-line distinctive trait injected into narrator prompt
```

`reference_image_path`, `image_description`, `image_prompt_override`, `faceid_ref_count`,
`faceid_ref_order` were image-pipeline-only columns and were dropped from the schema-definition
code in the 2026-07-19 purge (existing DB rows with those columns, if any, are untouched — see
the purge notice at the top of this doc).

### Personality Format

`characters.personality` is a multi-line labeled block:
```
PERSONALITY: ...
MOTIVATIONS: ...
FEARS: ...
SOCIAL_STYLE: ...
BOUNDARIES: ...
```
Parsed by `_parsePersonality(str)` in `characters.js`. Legacy plain-text values (no labels)
are treated as `PERSONALITY` field only. `buildSystemPrompt` in `narrator.js` injects these
as a CHARACTER PERSONALITIES block (section 6) in the narrator system prompt.

### scenario_characters

Join table linking scenarios to their cast. Created in the main schema block.

```
scenario_id  INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE
character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE
added_at     TEXT DEFAULT (datetime('now'))
PRIMARY KEY (scenario_id, character_id)
```

Migration populates it from existing `characters.scenario_id` values on first startup.

### locations

STALE beyond the image-purge scope: this section predates the global-locations refactor.
Locations are now global (like characters), linked to scenarios via a `scenario_locations`
join table (mirrors `scenario_characters`) rather than the `scenario_id` column shown below.
See `src/db.js` and `src/routes/global-locations.js`/`src/routes/locations.js` for ground truth.

```
id INTEGER PK
scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE   -- legacy column, superseded by scenario_locations
name TEXT NOT NULL
description TEXT DEFAULT ''
short_desc TEXT DEFAULT ''
full_desc TEXT DEFAULT ''
tags TEXT DEFAULT ''
time_of_day TEXT DEFAULT 'any'
created_at TEXT DEFAULT datetime('now')
```

`image_tags`, `background_images_json`, `background_folder`, and `default_background` were
image-pipeline-only columns and were dropped from the schema-definition code in the
2026-07-19 purge.

### turns

```
id INTEGER PK
scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE
turn_number INTEGER NOT NULL
role TEXT NOT NULL                    -- 'user' | 'narrator' | character name
content_text TEXT NOT NULL
scene_card_json TEXT DEFAULT '{}'     -- parsed from narrator ---SCENE--- block
location_id INTEGER REFERENCES locations(id)
token_estimate INTEGER DEFAULT 0      -- rough estimate of context tokens used
created_at TEXT DEFAULT datetime('now')
```

### memories

```
id INTEGER PK
scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE
content TEXT NOT NULL                 -- summary text (auto) or user-entered text (manual)
memory_type TEXT DEFAULT 'auto'       -- 'auto' | 'manual'
turn_number INTEGER DEFAULT 0         -- turn that triggered auto-summary
created_at TEXT DEFAULT datetime('now')
```

No memory tier promotion is implemented yet. All memories are returned newest-first up to limit.

### world_entries

```
id INTEGER PK
scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE
title TEXT NOT NULL
content TEXT NOT NULL
category TEXT DEFAULT 'general'
created_at TEXT DEFAULT datetime('now')
```

### rules

```
id INTEGER PK
scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE
content TEXT NOT NULL
priority INTEGER DEFAULT 0
created_at TEXT DEFAULT datetime('now')
```

The `styles`, `image_profiles`, `scene_images`, `character_references`, `character_fullbodies`,
`location_backgrounds`, `summary_edit_events`, `summary_exemplars`, and `style_exemplars` tables
were all image-pipeline-only and their CREATE/ALTER schema-definition code was removed from
`src/db.js` in the 2026-07-19 purge (existing rows, if any, are untouched in the live .db file —
only the schema-definition code was removed, which is safe/idempotent for already-existing DB
objects).

### audit_events

```
id INTEGER PK
pipeline_run_id TEXT DEFAULT ''     -- UUID linking all events in one generation attempt
service TEXT NOT NULL               -- 'narrator' | 'clothing' | 'memory' | 'model-resolver' | ...
event TEXT NOT NULL                 -- stage name (e.g. 'resolve_config', 'a1111_call')
data_json TEXT DEFAULT '{}'         -- input to the stage (JSON string)
detail_json TEXT DEFAULT '{}'       -- output + error + token_estimate (JSON string)
level TEXT DEFAULT 'info'           -- 'info' | 'error'
created_at TEXT DEFAULT datetime('now')

-- Added via migration (Phase 4):
scenario_id INTEGER
turn_id INTEGER
duration_ms INTEGER
```

### global_config

Key/value store seeded with defaults in `src/db.js` (`_defaults` array). Current, accurate
(post-image-purge) default set:

| Key | Default | Notes |
|---|---|---|
| `nsfw_enabled` | `true` | |
| `narrator_model` | `''` | Empty = auto-select first Ollama model |
| `narrator_context_turns` | `20` | |
| `narrator_max_tokens` | `1200` | |
| `narrator_context_tokens` | `8192` | Input context budget, separate from output max_tokens |
| `explicit_mode` | `true` | |
| `arousal_decay_enabled` | `true` | |
| `emotion_tracking_enabled` | `true` | |
| `relationship_deltas_enabled` | `true` | |
| `mood_gate_toasts_enabled` | `true` | |
| `regen_state_snapshot_enabled` | `true` | |
| `cast_trigger_chips_enabled` | `true` | |
| `scene_heat_readout_enabled` | `true` | |
| `sfw_arousal_ceiling` | `3` | |
| `llamacpp_config` | `'{}'` | JSON blob for per-role backend config; see narrator routing below (not in `_defaults`, but read the same way) |

All A1111/image-generation config keys (`a1111_*`, `hr_*`, `ad_*`, `lora_enabled`,
`master_negative`, `master_positive`, `ipadapter_*`, `refiner_*`, `pose_control_*`,
`location_bg_mode`, `image_summary_panel_default`, `summary_*`) were removed from
`_defaults` in the 2026-07-19 purge.

`llamacpp_config` JSON schema (stored as a string, parsed at runtime):
```json
{
  "narrator":  { "backend": "llamacpp", "port": 8080, "model_path": "J:\\Models\\MN-12B-Mag-Mell-R1\\MN-12B-Mag-Mell-R1-Q4_K_M.gguf" },
  "extractor": { "backend": "ollama",   "ollama_model": "..." }
}
```
Backend can be `"llamacpp"` or `"ollama"`. If unset or `{}`, narrator defaults to Ollama.

`resolveMasterConfig(db)` casts keys in NUMERIC_KEYS to float and BOOLEAN_KEYS to bool.
All other values are returned as strings.

### character_relationships

Created via `CREATE TABLE IF NOT EXISTS` in an additive migration in `src/db.js` (Phase 8).

```
id                INTEGER PK
scenario_id       INTEGER NOT NULL
from_character_id INTEGER NOT NULL
to_character_id   INTEGER NOT NULL
relationship_type TEXT NOT NULL DEFAULT 'friend'   -- friend/romantic/enemy/sibling/parent/rival/colleague/mentor/nemesis/other
description       TEXT DEFAULT ''
strength          INTEGER DEFAULT 3
  tags_json         TEXT DEFAULT '[]'   -- JSON array: attraction|trust|tension|history|taboo                -- 1–5 intensity
created_at        TEXT DEFAULT (datetime('now'))
UNIQUE(scenario_id, from_character_id, to_character_id)
```

Routes at `/api/scenarios/:scenarioId/relationships` (see `src/routes/character-relationships.js`).
GET and POST responses include `from_name` and `to_name` via JOIN to `characters`.
POST returns HTTP 409 on duplicate pair (UNIQUE constraint violation).
The narrator reads these via `runNarratorTurn` and injects them as a "Character Relationships"
block in the system prompt (section 3, between Characters and Rules).

### Scenario clothing state (created)

- `scenario_character_state` — per-scenario runtime clothing (and related state). Authoritative for play; see `getScenarioClothing` / clothing.js. This replaced the earlier planned `character_states` table. Do **not** treat `characters.current_clothing` as scenario runtime clothing.

Indexed on: `pipeline_run_id`, `(scenario_id, created_at DESC)`, `status WHERE failed`.

---

## Observability System

Every process stage writes to two outputs simultaneously:
1. `audit_log` DB table — queryable, filterable, joinable to turns/images
2. `logs/audit.jsonl` — JSON lines file, one entry per event, survives DB corruption

The `pipeline_run_id` (UUID) links every event in one logical operation (e.g. a narrator turn).

### What gets logged

| Service | Logged inputs | Logged outputs |
|---|---|---|
| narrator | model, token estimate, system block count, turn count, memory count | full response text + parsed scene_card JSON (or parse failure), duration |
| clothing | character, current state, scene_card | resolved clothing string, resolution path taken |
| memory | trigger reason, turn range | summary text, model used, promotion events |
| model-resolver | scenario nsfw_enabled, overrides | resolved models, fallbacks used |

### Using the audit log

- **"Did the narrator scene card parse?"** — filter `audit_log` / `logs/audit.jsonl` for that `pipeline_run_id`, check the narrator event's output
- **"Where did it fail?"** — filter `audit_log WHERE pipeline_run_id = 'x' AND status = 'failed'`
- **"What was her clothing state?"** — `scenario_character_state.current_clothing` for the scenario, and/or clothing fields on the matching audit events

Rows about A1111 requests, LoRAs, seeds, ADetailer, and image-pipeline stage tracing were
removed along with the image pipeline (2026-07-19 purge).

---

## Service Layer

### src/services/ollama.js

Ollama HTTP client (`http://127.0.0.1:11434`). All calls log duration via `logger`.

```js
chat({ model, messages, options = {}, format, keep_alive })
// POST /api/chat with stream:false. `options` are Ollama sampler options (temperature, top_p, num_predict, stop, ...).
// `format` is forwarded natively when provided: `'json'` or a JSON Schema object (structured outputs).
// `keep_alive` forwarded when provided.

generate({ model, prompt, system, options = {}, format, keep_alive })
// POST /api/generate with stream:false. Same `format` / `options` / `keep_alive` contract as chat().

listModels()   // GET /api/tags
checkHealth()  // GET /
unloadAllModels()
```

**Structured JSON roles (2026-07-13g):** `scene-picker` and `character-state` emotional updates pass JSON Schema via `format` plus low `temperature` (0.1) so malformed JSON / silent generic fallbacks are less likely. Prompt-only JSON instructions are not the primary enforcement mechanism for those roles.

### src/services/config-resolver.js

```js
resolveMasterConfig(db)
// → flat config object; NUMERIC_KEYS cast to float, BOOLEAN_KEYS cast to bool
// NUMERIC_KEYS: narrator_context_tokens, narrator_max_tokens, sfw_arousal_ceiling
// BOOLEAN_KEYS: nsfw_enabled, explicit_mode, summary_learning_enabled,
//   arousal_decay_enabled, emotion_tracking_enabled, relationship_deltas_enabled,
//   mood_gate_toasts_enabled, regen_state_snapshot_enabled, cast_trigger_chips_enabled,
//   scene_heat_readout_enabled
```

`resolveActiveProfile`/`resolveEffectiveConfig` (image-profile config merging) were removed
along with the image pipeline. `resolveMasterConfig` is now the only export.

### src/services/model-resolver.js

```js
resolveNarratorModel(db)
// → model name string
// Reads 'narrator_model' from global_config; falls back to first available Ollama model

resolveModels(db)
// → { narrator }
// Currently only resolves narrator. Extractor/summarizer roles not yet differentiated.
```

### src/services/narrator.js

```js
buildSystemPrompt({ scenario, characters, rules, worldEntries, memories, relationships = [], config })
// → system prompt string
// 9 blocks: 1) scenario system_prompt, 2) characters (with clothing),
//   3) character relationships (if any), 4) rules, 5) world entries,
//   6) memories, 7) CHARACTER PERSONALITIES, 8) NSFW gate, 9) ---SCENE--- instruction
// relationships: array of { from_name, to_name, relationship_type, description, strength }
// Relationship block format: "A → B: type (description) [intensity N/5]" — one per line

resolveNarratorBackend(db)
// → { backend: 'ollama'|'llamacpp', port?, model }
// Reads 'llamacpp_config' JSON from global_config; checks narrator role's 'backend' field.
// Falls back to resolveNarratorModel(db) (Ollama) if not set.

llamacppChat({ port, messages, maxTokens })
// → string — response content
// POSTs to http://127.0.0.1:{port}/v1/chat/completions (OpenAI-compatible endpoint).

runNarratorTurn({ db, scenario, messages, turnNumber })
// → { story_text, scene_card, model_used, token_estimate }
// Loads characters/rules/world/memories/relationships from DB, builds system prompt.
// Also queries character_relationships for the scenario and passes them to buildSystemPrompt.
// Calls resolveNarratorBackend(); routes to llamacppChat() or ollama.chat() accordingly.
// model_used = backend.model || `llamacpp:${backend.port}` (llamacpp) or ollama model name.
// The narrator writes PROSE ONLY. `scene_card` in the return is a placeholder default
// (parseNarratorResponse still runs but the model is no longer asked for a block).
```


**Scene state extraction (2026-09-01) — replaces the narrator's self-reported scene card.**
Verified: the RP-tuned narrator (MN-12B-Mag-Mell-R1) reliably STOPS emitting an appended
`---SCENE---` JSON block once the real system prompt + history fill the context — every turn
was silently falling back to `defaultSceneCard()` (`mood:neutral, arousal_level:1`). So:

- `buildSceneCardInstruction()` is GONE. The narrator system prompt no longer mentions a
  scene block, `mood`, `arousal_level`, or `clothing_changes`.
- `src/services/scene-state.js` `extractSceneState({ narratorText, cast, clothingByCharId, config })`
  makes ONE focused Ollama `generate()` call over the finished prose. Flat, fully-required
  schema `SCENE_STATE_SCHEMA` = `{ scene_mood, scene_arousal, characters:[{character_id,mood,arousal}],
  clothing_changes:[{character_name,new_clothing}] }`. Model: `config.scene_state_model`
  (default `qwen2.5:7b-instruct` — text instruction model, NOT the RP model, NOT a vision model).
  `keep_alive` = `config.scene_state_keep_alive` (default `5m`; set `0` for VRAM headroom).
  Never throws — any failure returns `EMPTY_SCENE_STATE` and the turn still completes.
- `src/routes/turns.js` `_buildSceneCardFromProse()` calls it after both the turn and
  regenerate paths, builds `scene_card_json` from the result, and caps scene `arousal_level`
  movement to ±3 per turn (carried from the previous card).
- Clothing entries are filtered: sentinel strings ("not specified", "unchanged", ...) and
  entries whose `new_clothing` equals the character's current outfit are dropped.
- Config: `scene_state_enabled` (default true), `scene_state_model`, `scene_state_keep_alive`
  in `global_config`; `scene_state_enabled` is in `config-resolver.js` BOOLEAN_KEYS.

**Context sizing (2026-07-13i):** 
arrator_max_tokens is OUTPUT-only (max_tokens / 
um_predict). Input is truncated via 
arrator-context.js to 
arrator_context_tokens (default 8192) minus output minus margin — optionally overridden by llamacpp_config.narrator.n_ctx. The old log comparing ~5000 input tokens to max 1200 was a category error. llamacppChat uses a 5-minute AbortSignal and logs fetch cause/code/abort detail.

### src/services/memory.js

```js
shouldGenerateMemory(turnNumber, interval=20)
// → boolean — true when turnNumber > 0 && turnNumber % interval === 0

generateMemory({ db, scenarioId, turns, config })
// → inserted memory row
// Summarizes last 20 turns via Ollama generate(); inserts as memory_type='auto'

getRecentMemories(db, scenarioId, limit=10)
// → memory rows ordered by created_at DESC
```

No memory tier promotion is implemented. All memories are a flat list; newest-first.

### src/services/character-state.js - emotional updates

**2026-09-01:** `processEmotionalUpdateAfterTurn` + `EMOTION_JSON_SCHEMA` (the separate
delta call with nested `updates[]`) are REMOVED. `turns.js` now calls
`applySceneStateToCharacters(scenarioId, sceneState.characters, config)` with the ABSOLUTE
per-character `{ mood (1-5), arousal (1-10) }` from `extractSceneState`. It clamps by the
NSFW/SFW ceiling (`arousal-rules.js`) AND caps movement to ±2 mood / ±3 arousal per turn so
a single over-read can't spike the state; momentum columns are reset to 0 (no accumulation -
the extractor already read the whole beat). Gated by `emotion_tracking_enabled`.
`buildCastBehaviorBlock` / `buildEmotionalDirective` (the narrator-facing bands) are
unchanged and now read reliably-populated state. Relationship deltas
(`relationship_deltas_enabled`, `relationshipUpdates`) are no longer produced - dormant.

### src/services/clothing.js - LIVE (scenario-scoped)

**Character clothing-set JSON** (`characters.outfit_sets`):
```json
[
  { "name": "Bathing suit", "description": "skimpy blue and white striped 2 piece bikini" },
  { "name": "Towel", "description": "a white towel wrapped around their chest with nothing underneath" }
]
```
Optional `underwear` boolean may be present. Managed on the Character editor (add / edit / delete / reorder / set default). Also stored: `default_outfit_name`, `default_outfit` (description of the default set).

**Raw JSON save validation (CF-5, fixed 2026-07-13e):** the Character Editor's advanced
raw-JSON textarea (`#char-outfit-sets-json`) is validated on save via
`resolveOutfitSetsForSave(rawText, fallbackOutfitSets)` in
`public/js/outfit-sets-validation.js` (pure, DOM-free — imported by
`public/js/views/characters.js`'s submit handler). Empty/whitespace textarea uses the
structured editor's in-memory `_outfitSets` state; non-empty text that fails to parse, or
parses to something other than a JSON array, now **aborts the save with an error toast**
(`showToast(result.error, 'error')`) instead of the pre-fix behavior of silently discarding
the invalid input and falling back to `_outfitSets` while still showing "Character saved!".
Regression-tested in `public/js/__tests__/outfit-sets-validation.test.js`.

**Scenario starting outfit** (`scenario_characters`):
- `starting_clothing_set_name` - name of the chosen set
- `starting_clothing` - description copy at selection time
Chosen in Scenario setup UI (dropdown of that character's saved sets). `POST /api/scenarios/:sid/characters/:cid` accepts `clothing_set_name`. `PATCH .../clothing` with `clothing_set_name` resets starting + runtime to that set.

**Scenario runtime clothing** (`scenario_character_state.current_clothing`):
Narrator `clothing_changes` and Play manual edits write here via `applyClothingChanges` / `setScenarioRuntimeClothing`. They do **not** mutate `characters.outfit_sets` or other character-card wardrobe fields.

**Read order** (`getScenarioClothing` / narrator context):
1. `scenario_character_state.current_clothing` (runtime)
2. `scenario_characters.starting_clothing` (setup selection)
3. Character default (`default_outfit` / matching set in `outfit_sets`)

Exports: `parseClothingSets`, `findClothingSet`, `getScenarioClothing`, `setScenarioRuntimeClothing`, `setScenarioStartingOutfit`, `resolveScenarioClothingMap`, `applyClothingChanges`.

`src/services/prompt-resolution.js` (the `applyResolvedClothing`/`resolvePrimaryCharacterForReference`
helpers shared by the image pipeline) was removed along with the image pipeline itself.

### src/services/audit.js

```js
audit({ pipeline_run_id, service, stage, status, message,
        input, output, error, duration_ms, token_estimate,
        scenario_id, turn_id })
// → void — writes to audit_events DB + AUDIT_LOG_PATH jsonl; never throws
```

---

## Route Layer (as implemented)

All nested routers use `mergeParams: true` so `:scenarioId` is accessible inside them.

| Route file | Mount point | Endpoints |
| --- | --- | --- |
| `health.js` | /api/health | GET /, GET /ollama, POST /test-log (broadcasts one `logline` event) |
| `config.js` | /api/config | GET /, POST /, POST /batch |
| `scenarios.js` | /api/scenarios | GET / (enriched: character_count, last_turn_at, characters[]), POST /, GET /:id, PUT /:id (dynamic SET), DELETE /:id, GET /:id/scene-card (debug), POST /:id/reset-scene (clear latest scene_card_json) |
| `turns.js` | /api/scenarios/:scenarioId/turns | GET /, POST /, DELETE /:id, POST /:turnId/regenerate |
| `characters.js` | /api/characters | GET /, POST /, GET /:id, PUT /:id, DELETE /:id, PATCH /:id/clothing, GET /:id/relationships |
| `scenario-characters.js` | /api/scenarios/:scenarioId/characters | GET / (roster + starting/runtime clothing), POST /:charId (add + `clothing_set_name`), PATCH /:charId/clothing, DELETE /:charId |
| `locations.js` | /api/scenarios/:scenarioId/locations | GET / (scenario-linked), POST /:locationId/add, DELETE /:locationId/remove, GET /:id |
| `global-locations.js` | /api/locations | GET / (CRUD: name/description/short_desc/full_desc/tags/time_of_day), POST /, PUT /:id, DELETE /:id |
| `global-relationships.js` | /api/relationships | global (scenario_id=0) character relationship CRUD |
| `character-relationships.js` | /api/scenarios/:scenarioId/relationships | GET /, POST /, PUT /:id, DELETE /:id |
| `character-states.js` | /api/scenarios/:scenarioId/character-states | GET /, PUT /:characterId |
| `memories.js` | /api/scenarios/:scenarioId/memories | GET /, POST /, DELETE /:id |
| `world.js` | /api/scenarios/:scenarioId/world | GET /, POST /, PUT /:id, DELETE /:id |
| `rules.js` | /api/scenarios/:scenarioId/rules | GET /, POST /, PUT /:id, DELETE /:id |
| `audit.js` | /api/audit | GET / (filters: scenario_id, service, level, limit), GET /:runId |

Image generation routes (`images.js`, `a1111.js`, `pose-catalog.js`, `learning.js`, `profiles.js`)
and the static `/story-images`, `/story-backgrounds`, `/pose-assets` file mounts were removed
along with the image pipeline (2026-07-19 purge). Do not reference them.

### turns POST detail

POST /api/scenarios/:id/turns with `role=user`:

1. Insert user turn
2. Load recent turns for context window (scenario.context_turns + 1, default 21)
3. Build Ollama messages from history + current user message
4. Call `narrator.runNarratorTurn()` → `{ story_text, scene_card, model_used, token_estimate }`
5. Insert narrator turn with `scene_card_json = JSON.stringify(scene_card)`
6. If `memory.shouldGenerateMemory(narratorTurnNum)`: fire `generateMemory()` async with `.catch()`
7. Broadcast `turn_complete` WS event
8. Return `{ user_turn, narrator_turn }`

---

## Testing

**Run the suite:** `npm test` (runs `node --experimental-sqlite --experimental-test-module-mocks --test` with no path arguments — Node's built-in test runner recursively discovers every `*.test.js` file under the repo on its own; no glob patterns are passed, so this works identically in cmd.exe/PowerShell/bash). As of the 2026-07-19 image-generation purge (which deleted every A1111/FaceID/pose/image-pipeline test file) the suite is 53 tests across 4 top-level files, all green, zero real external dependencies (no Ollama, no writes to the real `story-lab.db`).

**Stack:** `node:test` + `node:assert/strict` only — no Vitest, no Jest, no Supertest, no jsdom. This is a deliberate project rule (`CLAUDE.md`: "No new npm dependencies. Core stack: express, ws, cors only"), not an oversight. Route tests use Node's built-in `http.createServer` + global `fetch` instead of Supertest.

**Two required experimental flags** (already baked into `npm test`, but needed if you invoke `node --test` directly):

- `--experimental-sqlite` — required by `db.js` (`node:sqlite`'s `DatabaseSync`), same as `npm start`.
- `--experimental-test-module-mocks` — required for `node:test`'s `mock.module()`, used to redirect `src/paths.js`'s `DB_PATH` to `':memory:'` in DB-touching tests (see below). Without this flag `mock.module` doesn't exist on the mock tracker and those test files throw `TypeError: mock.module is not a function` immediately.

**Test file layout:**

- `src/services/__tests__/*.test.js` — service-layer unit and integration tests.
- `src/routes/__tests__/*.test.js` — Express route tests (real router, real HTTP, mocked Ollama).
- `public/js/__tests__/*.test.js` — pure browser-view logic extracted into DOM-free modules (e.g. `outfit-sets-validation.js`) so it's testable the same way as backend code; these files are also imported directly by the browser view, unmodified.

**The "redirect the real DB to `:memory:`" pattern** (used by any test that needs `characters`/`scenarios`/`turns`/etc. rows) — this is the one non-obvious piece of infrastructure in the suite, worth understanding before adding a new DB-touching test:

```js
import { test, mock } from 'node:test';
// ... build a temp dir + DIRS object (images/backgrounds/audio/data) ...
mock.module('../../paths.js', {   // path relative to THIS test file — resolves to the
  namedExports: {                  // same canonical src/paths.js regardless of which
    DB_PATH: ':memory:',           // module (db.js, narrator.js, ...) imports it
    DATA_DIR: dirs.data, /* ...all other paths.js exports... */
  },
});
const { default: db } = await import('../../db.js');       // NOW import — see below
const { runNarratorTurn } = await import('../narrator.js'); // dynamically, after mocking
```

`db.js` does `new DatabaseSync(DB_PATH)` and runs its full real `CREATE TABLE` schema at
module-import time. Pointing `DB_PATH` at `:memory:` before that first import gives every
test file a completely real, always-in-sync (zero schema drift) but fully isolated
database — nothing is hand-faked or duplicated.

**Two ordering rules that matter — get either wrong and tests silently do the wrong thing without failing loudly:**

1. **`mock.module()` must run, and the target module must be dynamically `import()`-ed, before any other code in the file imports it.** Static `import db from '../../db.js'` at the top of a test file executes during module linking, *before* any of the file's own top-level statements (including a `mock.module()` call) run — so a static import would load the real production DB regardless of a mock declared below it. Every DB-touching test file in this suite uses `await import(...)` (dynamic, after the mock) instead of a static `import` for `db.js` and anything that transitively imports it.
2. **`mock.module()` only takes effect once per resolved module URL, at first import, for the life of the process/test file.** Node caches ES modules by URL; calling `mock.module()` again later in the *same file* does not retroactively change an already-loaded module's already-resolved bindings. Concretely: mock `paths.js`/`db.js`/`ollama.js` **once**, at the top of the file (module scope, not inside individual `test()` callbacks), and have every `test()` in that file share the one resulting DB/module instance, scoping each test's own assertions by the specific scenario/character IDs it just seeded (never assume "the only row"). An earlier draft of `scene-picker.test.js` got this wrong — it called `t.mock.module('../ollama.js', ...)` *inside* each `test()` body; the first test's import of `scene-picker.js` cached its `chat` binding permanently, so every later test's "fresh" mock was silently ignored and those tests were actually hitting the real (unreachable) Ollama endpoint at `127.0.0.1:11434` and passing only because a 404/connection failure happened to also produce the `null` return value the test expected. Fixed by mocking `globalThis.fetch` per-test instead (see next point) — the bug is called out in a comment in that file as a warning against reintroducing the pattern.

**Mocking the actual network boundary (Ollama):** `src/services/ollama.js` calls the **global** `fetch()` directly (not a wrapped/injectable client). This is what makes per-test mocking reliable: `t.mock.method(globalThis, 'fetch', async (url, init) => {...})` replaces a plain global property lookup, which every caller re-reads at call time — unlike `mock.module()`, this correctly resets between tests via `t`'s own auto-restore, so each `test(async (t) => {...})` in a file can install its own distinct fetch behavior. Route-level tests capture the local Express server's *own* real, pre-mock `fetch` reference (`const realFetch = globalThis.fetch` at file top, before any mocking) to call the server under test.

**What is and isn't covered (current, post-image-purge):**

- All CF-* regression tests that guarded image-pipeline/A1111/FaceID/ControlNet/pose behavior
  (CF-1 through CF-4, CF-A1 through CF-A6, CF-8, CF-10, and the files `a1111-payload.test.js`,
  `a1111-call.test.js`, `image-pipeline.integration.test.js`, `ipadapter-resolution.test.js`,
  `faceid-ui-honesty.test.js`, `images-quarantine.test.js`) were deleted along with the code
  they tested in the 2026-07-19 purge. Do not look for them.
- CF-5 (Character Editor's raw outfit-sets JSON silently discarding invalid input) is still
  fixed and tested — see `public/js/outfit-sets-validation.js`.
- No browser/E2E testing exists or is planned here; UI wiring is largely unverified by this
  suite and still requires manual testing per this project's one-function-workflow discipline.

---

## Narrator Response Format

The narrator model outputs story text and structured scene data in a single response. No separate extractor LLM call is made.

### Response structure

The narrator is prompted to append a scene block at the end of every turn response:

```
[Story prose here...]

---SCENE---
{
  "mood": "contemplative",
  "arousal_level": 1,
  "clothing_changes": []
}
---END---
```

The prose and the `---SCENE---` block are separated by the delimiter. The narrator text stored in `turns.content_text` has the scene block stripped. The JSON is parsed (`src/input-parser.js`) and written to `turns.scene_card_json`.

### Scene card JSON schema (current, post-image-purge)

| Field | Type | Description |
| --- | --- | --- |
| `mood` | string | Scene mood word |
| `arousal_level` | 1–10 | Explicit content intensity. Gated by master NSFW settings. Clamped in `input-parser.js`. |
| `clothing_changes` | array | `[{ character_name, new_clothing }]` applied to `scenario_character_state.current_clothing` via `applyClothingChanges` (also accepts `character_id`) |

`image_prompt`, `negative_prompt_additions`, and `nsfw_elements` were part of the removed image
pipeline's scene card contract and are no longer requested from or parsed out of the narrator's
output — see `buildSceneCardInstruction()` in `src/services/narrator.js` and `defaultSceneCard()`
in `src/input-parser.js` for the live, authoritative shape.

### arousal_level tiers

| Level | Content tier | Master NSFW required |
| --- | --- | --- |
| 1–3 | SFW | none |
| 4–5 | Mild | nsfw_enabled optional |
| 6–7 | Moderate | nsfw_enabled = 1 |
| 8–10 | Explicit | nsfw_enabled = 1 + explicit_mode = 1 |

### Fallback behavior

If the narrator response has no `---SCENE---` block, or the JSON fails to parse:

- `turns.scene_card_json` is set to `null`
- The pipeline uses a minimal scene card derived from the visible narrative text
- A `warn` audit event is written noting the fallback
- Generation continues — no hard failure

---


## NSFW and Explicit Gating (actual as of 2026-07-13)

**Precedence:** Master `global_config.nsfw_enabled` is the hard ceiling. Scenario `nsfw_enabled=0` (Safe Mode in wizard) further restricts even when master is on. Effective NSFW = master ON **and** scenario ON. Effective explicit = effective NSFW **and** master `explicit_mode`.

| Layer | Behavior |
|---|---|
| Narrator system prompt | Explicit / adult / SFW copy branched; cast arousal ACTION block only when effective NSFW |
| Settings UI | Scenario Safe Mode is in the wizard. Global `nsfw_enabled` / `explicit_mode` toggles live in Settings > Story Dynamics, backed by `global_config` |

Boot no longer force-updates these keys to true.

## WebSocket Events

Connect: `ws://localhost:4090`

On connect: log only — no `queue_state` payload (corrected 2026-07-13).

Server → client events:

| Event | Payload |
|---|---|
| `turn_complete` | `{ scenarioId, turn, clothing_updates }` |
| `clothingupdate` | `{ scenarioId, characters }` |
| `moodupdate` | `{ scenarioId, characters }` |
| `logline` | logger payloads (`{ cat, msg, ts }`) |

No client → server WS messages.

**Fixed 2026-07-13:** `play.js`'s `case 'logline':` was pushing the raw broadcast envelope
(`{ type, payload, ts }`) straight to `_debugConsole.push()` instead of unwrapping
`data.payload` first — every other case in that switch does `data.payload || data`, but
this one didn't. Result: `debug-console.js`'s `_makeLine()` read `entry.cat`/`entry.msg`
off the envelope instead of the payload, both `undefined`, so the log window (Ctrl+`)
rendered blank lines instead of the actual log text. Fixed by unwrapping the same way as
every other case. Regression tests: `src/__tests__/logline-ws.test.js` (server→client
shape contract), `public/js/__tests__/logline-panel-wiring.test.js` (source-pattern check
on the unwrap). Manual verification path: `POST /api/health/test-log` broadcasts one
`logline` event on demand — open the log window and hit that endpoint to confirm it
renders live without a reload.

---

## Frontend Changes vs. story-lab

All `public/` is copied from story-lab and preserved. Targeted modifications:

### New: audit.js view (public/js/views/audit.js)

Accessible from Settings > Debug tab.
- Filter by scenario, status, service
- Grouped by pipeline_run_id
- Stage timeline with duration + JSON detail

### api.js — method surface

Stale duplicated method lists rot fast. Read `public/js/api.js` directly for the current,
authoritative `window.API` method surface — do not rely on any list in this doc.

---

## Mood, Arousal & Relationships (2026-07-15)

- **Arousal scale:** 1-10 everywhere. Legacy `arousalmax` values 2/3/4/5 migrate to 4/6/8/10 on boot.
- **`arousalthreshold`:** `low|medium|high|veryhigh` -> momentum needed 1/2/3/4 (+2 when arousal already >=5).
- **NSFW off:** effective arousal ceiling = `sfw_arousal_ceiling` (default 3). ACTION bands >=6 are never emitted.
- **Mood gate:** `arousallockeduntil` caps *behavior* arousal until mood warms; gates broadcast on `moodupdate.gates`.
- **Relationships:** `scenario_id=0` = global defaults; scenario rows overlay. Resolver: `resolveRelationshipsForScenario`. Strength deltas clone-on-write. Tags whitelist: attraction, trust, tension, history, taboo.
- **Broadcasts:** `moodupdate` `{characters,gates}`, `relationshipupdate` `{relationships}`.
- **Settings:** Story Dynamics tab (`nsfw_enabled`, `explicit_mode`, decay/tracking/delta/toast/snapshot/chip/heat toggles, `sfw_arousal_ceiling`).
- **Regenerate:** when `regen_state_snapshot_enabled`, appends mood + bond snapshot into regen guidance server-side.

## Known Stubs and Unimplemented Features

**Rule:** Stubs are last resort. Any code that exists but does not perform its stated job
must be marked in source with `// STUB: <description> — NOT FUNCTIONAL` and listed here.
When asked "is X implemented?" — stub present or file absent = NOT IMPLEMENTED, say so.
Never report a stub or an absent file as implemented.

**This section was rewritten 2026-07-19 to match the current CLAUDE.md after the full image-generation purge — see the top of this document. All entries below that referenced the image pipeline (styles/profiles routes, image endpoints, image-related frontend stubs) have been removed as no longer applicable; the code they described no longer exists at all (not even as a stub).**

### Services — absent from disk (no file, no code, no stub)

| Service | Why absent | What handles it instead |
| --- | --- | --- |
| `src/services/extractor.js` | Eliminated from design | Narrator writes `---SCENE---` block inline; `input-parser.parseNarratorResponse()` parses it |
| `src/services/enhancer.js` | Legacy name, never created | Live path is `story-enhancer.js` — REMOVED in the 2026-07-19 purge; this filename never existed either way |

### Routes — absent from disk (no file)

| Route file | Status |
| --- | --- |
| `src/routes/styles.js` | NOT PRESENT |

### Code stubs present (marked `// STUB` in source — not functional)

| Stub | Location | Notes |
| --- | --- | --- |
| `resolveClothing()` | `src/services/clothing.js` | Marked `// STUB: layered resolve unused...`. Unused; scenario runtime uses `applyClothingChanges` + `getScenarioClothing`. Do not delete in docs-only passes. |

Planned features that are ABSENT from disk entirely are not stubs. "File does not exist" is
not the same as "stub exists." See CLAUDE.md for the authoritative, up-to-date version of
this rule and list.

### Phases

| Phase | Status |
| --- | --- |
| Phase 1 — Foundation | **COMPLETE** |
| Phase 2 — LLM Clients and Config | **COMPLETE** |
| Phase 3 — Story Engine | **COMPLETE** |
| Phase 4 — Image Pipeline | **COMPLETE, then REMOVED 2026-07-19** (see purge notice at top) |
| Phase 5 — Frontend wiring | **COMPLETE** — api.js rewritten + full stale-API audit (2026-06-14); 22 issues fixed, -718 lines, all ImageCore/ComfyUI refs removed; llamacpp narrator added |
| Phase 8 — Persistence audit + relationships | **COMPLETE** |
| Phase 9 — Story-aware image generation | **COMPLETE (2026-06-15), then REMOVED 2026-07-19** |

---

## Implementation Status

### Phase 1 — Foundation: COMPLETE (2026-06-11)

Files: `package.json`, `src/paths.js`, `src/logger.js`, `src/db.js`, `src/broadcast.js`, `src/server.js`

DB schema: all tables created, global_config defaults seeded.
Server verified: `node --experimental-sqlite src/server.js` starts and logs `[server] started { port: 4090 }`.

Key implementation notes:

- Module system: ESM (`"type": "module"`) per project rules — user spec's `"commonjs"` was corrected
- Database: `node:sqlite` DatabaseSync (built-in) — user spec's `better-sqlite3` was corrected
- DB location: `H:\MEDIA\Story_Lab\data\story-lab.db` (created at startup via `ensureDirectories()`)
- Audit log: `H:\MEDIA\Story_Lab\data\audit.jsonl`
- Stub routes active: GET /api/health, /api/health/a1111, /api/config, /api/scenarios, /api/profiles
- Real routes implemented: POST /api/config, POST /api/config/batch (upsert into global_config)

### Phase 2 — LLM Clients & Config: COMPLETE (2026-06-11)

Files: `src/services/ollama.js`, `src/services/model-resolver.js`, `src/services/config-resolver.js`,
`src/routes/health.js`, `src/routes/config.js`, `src/routes/profiles.js`

Live routes:

- GET /api/health → `{ ok, ts, version }`
- GET /api/health/ollama → calls Ollama `/api/tags`, returns model list
- GET /api/health/a1111 → checks A1111 `/sdapi/v1/sd-models` with 3 s timeout, reads URL from global_config
- GET /api/config → all global_config rows as `{ key: value }`
- POST /api/config → upsert single key/value
- POST /api/config/batch → upsert array, wrapped in BEGIN/COMMIT
- GET /api/profiles → all image_profiles rows
- POST /api/profiles → create profile, returns created row
- PUT /api/profiles/:id → update profile
- DELETE /api/profiles/:id → delete profile
- POST /api/profiles/:id/activate → exclusive activate (BEGIN/COMMIT)
- DELETE /api/profiles/active → deactivate all

Note: `src/services/a1111.js` and `src/services/audit.js` are Phase 3 (image pipeline).

### Phase 3 — Story Engine: COMPLETE (2026-06-11)

Files: `src/input-parser.js`, `src/services/narrator.js`, `src/services/memory.js`,
`src/routes/scenarios.js`, `src/routes/turns.js`, `src/routes/characters.js`,
`src/routes/locations.js`, `src/routes/memories.js`, `src/routes/world.js`, `src/routes/rules.js`

Live route groups:

- `GET|POST /api/scenarios`, `GET|PUT|DELETE /api/scenarios/:id` — scenario CRUD
- `GET|POST /api/scenarios/:id/turns`, `DELETE /api/scenarios/:id/turns/:tid` — turns; POST role=user triggers full narrator pipeline
- `GET|POST|GET|PUT|DELETE /api/scenarios/:id/characters`, `PATCH /api/scenarios/:id/characters/:cid/clothing`
- `GET|POST|GET|PUT|DELETE /api/scenarios/:id/locations`
- `GET|POST|DELETE /api/scenarios/:id/memories`
- `GET|POST|PUT|DELETE /api/scenarios/:id/world` — world entries
- `GET|POST|PUT|DELETE /api/scenarios/:id/rules`

Key behaviors:

- All nested routers use `mergeParams: true` — `:scenarioId` accessible in all sub-routers
- `turns POST` with `role=user`: inserts user turn, calls narrator (Ollama), inserts narrator turn with `scene_card_json`, fires auto-memory async if `turnNumber % 20 === 0`, broadcasts `turn_complete` WS event
- `parseNarratorResponse` splits on `---SCENE---`/`---END---`, returns `{ story_text, scene_card }` with defaults on parse failure — never throws
- `narrator.buildSystemPrompt` assembles 7 blocks: base prompt, characters (with clothing), rules, world, memories, NSFW gate, scene card instruction
- `memory.generateMemory` summarizes last 20 turns into 2-3 key facts via Ollama, INSERTs into memories table as type='auto'

### Phase 4 — Image Pipeline: COMPLETE (2026-06-12)

Files: `src/services/audit.js`, `src/services/a1111.js`, `src/services/prompt-builder.js`,
`src/services/image-pipeline.js`, `src/routes/images.js`, `src/routes/a1111.js`,
`src/routes/audit.js`; updated `src/routes/locations.js`, `src/server.js`, `src/db.js`

Live route groups:

- GET /api/a1111/models — list A1111 checkpoints
- GET /api/a1111/loras — list A1111 LoRAs
- GET /api/a1111/status — generation progress
- POST /api/a1111/model — switch active checkpoint (persists to global_config)
- GET /api/scenarios/:id/images — list scene images (optional ?turn_id= filter)
- POST /api/scenarios/:id/images/generate — fire-and-forget image gen for a turn
- PUT /api/scenarios/:id/images/:id/accept — mark image accepted
- PUT /api/scenarios/:id/images/:id/rate — rate image
- DELETE /api/scenarios/:id/images/:id — delete image record
- GET /api/scenarios/:id/locations/:lid/backgrounds — list background filenames
- POST /api/scenarios/:id/locations/:lid/generate-background — blocking bg gen, updates location row
- POST /api/scenarios/:id/locations/:lid/backgrounds/:file/set-default — set preferred background
- DELETE /api/scenarios/:id/locations/:lid/backgrounds/:file — delete background file + update JSON
- GET /api/audit — audit events (filters: scenario_id, service, level, limit)
- GET /api/audit/:runId — full pipeline trace by run ID

DB migrations added (additive, each in try/catch):
- scene_images: accepted, user_rating, model_hash, loras_json
- audit_events: scenario_id, turn_id, duration_ms

Static serving:
- /story-images → H:\MEDIA\Story_Lab\images
- /story-backgrounds → H:\MEDIA\Story_Lab\backgrounds

Key behaviors:

- `audit.js` service writes every pipeline event to audit_events DB + logs/audit.jsonl simultaneously; never throws
- `a1111.js` saves decoded base64 image to disk and returns `{ filename, seed, model_name, model_hash, generation_time_ms }`
- `prompt-builder.js` is pure (no DB/LLM calls): mood→atmosphere lookup table, arousal tiers gated by nsfw_enabled, LoRA `<lora:file:strength>` injection
- `image-pipeline.js` orchestrates 7 stages (resolve_config → build_prompt → resolve_background → a1111_call → file_verify → persist → broadcast), each audited with same `pipeline_run_id`; background mode saves to BACKGROUNDS_DIR and skips scene_images insert
- `pipeline.generate` is always called fire-and-forget from routes with `.catch()`; background generation from locations route is blocking (awaited) to allow the route to update the location row immediately

### Phase 6 — Characters decoupled from scenarios: COMPLETE (2026-06-14)

**Architecture change:** Characters are now global entities. Scenarios pull characters
from the global pool via a `scenario_characters` join table.

**Backend changes:**
- `src/db.js`: Added `scenario_characters` join table to main schema block. Migration populates it
  from existing `characters.scenario_id` associations (`INSERT OR IGNORE INTO scenario_characters ... SELECT`).
- `src/routes/characters.js`: Full rewrite — no `scenario_id` on character rows; all routes at `/api/characters`; image paths at `characters/{charId}/...`
- `src/routes/scenario-characters.js`: New file — GET / (roster), POST /:charId (add), DELETE /:charId (remove)
- `src/server.js`: Added `app.use('/api/characters', charactersRouter)` and new `app.use('/api/scenarios/:scenarioId/characters', scenarioCharactersRouter)`
- `src/services/image-pipeline.js` + `src/services/narrator.js`: Character query updated from `WHERE scenario_id = ?` to JOIN via `scenario_characters`

**Frontend changes:**
- `public/js/api.js`: Characters block rewritten — no `scenarioId` args; new roster block (`getScenarioCharacters`, `addCharacterToScenario`, `removeCharacterFromScenario`); references/fullbody block all charId-only with `/api/characters/:id/...` URLs; `upload()` helper added for multipart
- `public/js/views/characters.js`: All character CRUD, delete, FaceID, references, fullbody calls updated to global API (no scenario scoping); bond dropdown uses global `API.getCharacters()`
- `public/js/views/scenario-setup.js`: Step 2 (Cast) fully rewritten — disabled for new scenarios ("save first"), live add/remove via `API.addCharacterToScenario`/`API.removeCharacterFromScenario` when editing, searchable available-chars panel
- `public/js/views/play.js`:
  - `loadPortraitPanel`: `API.getCharacters(sid)` → `API.getScenarioCharacters(sid)`; updates `state.currentScenario.characters` and calls `renderCharacterFocusButtons` on load
  - `addBtn.onclick`: replaced "Add via Setup" toast with real picker — loads all chars minus roster, shows picker, calls `addCharacterToScenario`
  - `removeBtn.onclick`: replaced `deleteCharacter` (permanent global delete — was a critical bug) with `removeCharacterFromScenario`; guards against removing last character
  - `renderCastTab`: uses `getScenarioCharacters`; adds "× Remove" button per card (with `showConfirm` + last-character guard); adds inline "+ Add" panel with searchable character list

### Phase 7 — Bug fixes, UI polish, and character system completion: COMPLETE (2026-06-14)

Files: `public/js/constants.js`, `public/js/api.js`, `public/js/views/characters.js`,
`public/js/views/settings.js`, `src/services/a1111.js`, `src/routes/a1111.js`,
`src/routes/characters.js`, `src/db.js`, `src/services/narrator.js`,
`start.bat`, `start-llamacpp.bat`

**Boolean config serialization fix (settings.js)**
- `hr_enabled` and `ad_enabled` were saving as `'1'`/`'0'` but the resolver expected `'true'`/`'false'`.
  Fixed: save path uses `hrOn ? 'true' : 'false'`. Added `boolCfg(key, def)` helper in `buildMasterForm`
  that handles all four truthy forms (`true`, `'true'`, `1`, `'1'`).

**start.bat — auto-launch A1111**
- Added curl health-check for A1111 at `http://127.0.0.1:7860`. If not running, launches
  `K:\stable-diffusion-webui\webui-user.bat` in a new window via `start /D ...`.

**start-llamacpp.bat — fixes**
- `--flash-attn` (no value) caused a crash because the next flag was consumed as its argument.
  Fixed to `--flash-attn on`.
- Context window: `-c 32768` (was mistakenly set to 16384, restored).

**A1111 sampler/scheduler live fetch (settings.js + a1111.js + routes/a1111.js + api.js)**
- Settings page now fetches live sampler and scheduler lists from A1111 via
  `GET /api/a1111/samplers` and `GET /api/a1111/schedulers`, falling back to comprehensive
  hardcoded lists (23 samplers, 12 schedulers) when A1111 is offline.
- `Promise.all` with `.catch(() => [])` used so Settings loads whether or not A1111 is running.

**Model selection — inline dropdown (settings.js)**
- Changed from `prompt()` dialog to an inline dropdown. Clicking "Change Model" fetches the
  model list and renders a `<select>` pre-selected on the current model. "Set Model" button
  calls `API.setA1111Model` and closes the picker.

**Character Personality section (characters.js + narrator.js)**
- Added 5-field personality section (Traits, Motivations, Fears, Social Style, Boundaries)
  to the character editor, placed between Notes and the user-character toggle.
- Stored as a single labeled-line block in `characters.personality`.
- `_parsePersonality(str)` in `characters.js` handles both labeled and legacy plain-text formats.
- `buildSystemPrompt` in `narrator.js` includes a CHARACTER PERSONALITIES block (section 6)
  when any active cast member has a personality set.

**Character DB schema completion (db.js + routes/characters.js)**
- 36 additive `ALTER TABLE ADD COLUMN` migrations cover all UI fields.
- `POST /api/characters` and `PUT /api/characters/:id` now handle all 40 character fields.
- `is_user` and `is_user_character` kept in sync on every write.

**Character image generation — prompt assembly (routes/characters.js)**
- `_assembleCharacterPrompt(char)` builds the best available image prompt from character
  trait columns. Priority: `image_prompt_override` → `image_description` → assembled traits
  → `appearance_prompt` → `char.name`. Used by both reference generate and fullbody generate.

**Delete reference and FaceID buttons (routes/characters.js + api.js)**
- `DELETE /api/characters/:id/references/:refId` route added.
- `PATCH /api/characters/:id/faceid-config` route added.
- `API.deleteReference` and `API.saveFaceIdConfig` added to api.js.
- **Route ordering fix**: `DELETE /:id/references/faceid` moved to BEFORE
  `DELETE /:id/references/:refId` so clearFaceId no longer returns 404.

**Fullbody image buttons wired (characters.js + routes/characters.js + api.js)**
- "Use as Ref" and "Delete" buttons on fullbody images were rendered but had no event handlers.
- Added handlers: Use as Ref calls `POST /:id/fullbody/:fbId/use-as-ref` (sets
  `reference_image_path` on the character, updates FaceID display in UI); Delete calls
  `DELETE /:id/fullbody/:fbId` and reloads the grid.
- Added `API.useFullbodyAsRef(charId, fbId)` to api.js.
- Delete threshold changed from `count > 2` to `count > 1` (allow deletion down to 1 image).

**Eye shape options (constants.js)**
- Added `Large Round Cartoon` to `EYE_SHAPE_OPTS` (now 6 options).

**Breast size options (constants.js)**
- Expanded from 5 to 10 options:
  Flat / Petite / Small / Small-Medium / Medium / Medium-Large / Large / Extra Large / Very Large / Massive

---

### Phase 5 — Frontend wiring: COMPLETE (2026-06-14)

Phase 5 was completed in two stages: initial frontend wiring (early 2026-06-14) and a full stale-API audit (later 2026-06-14, 22 issues fixed, -718 lines net).

---

#### Phase 5a — Initial wiring

**api.js** — fully rewritten to match actual backend routes. All stale, global, and unimplemented routes removed. Key corrections:

- Characters, locations, rules, world entries all moved to scenario-scoped paths (`/api/scenarios/:id/...`)
- `getCharacters(sid)`, `createCharacter(sid, data)` etc. now require `scenarioId` as first arg
- Images moved to scenario-scoped: `getImages(sid, turnId?)`, `acceptImage(sid, imgId, data)`, etc.
- `deleteTurn(sid, turnId)` → `DELETE /api/scenarios/:id/turns/:id` (was global)
- `createManualMemory(sid, content)` → `POST /api/scenarios/:id/memories` with `{ memory_type: 'manual' }`
- `postTurn(scenarioId, contentText)` — correct turn submission
- `setConfig` → POST, `setConfigs` → `POST /api/config/batch`
- Location background routes added
- `setA1111Model(name)`: body key is `{ model_name: name }` (NOT `{ model: name }`) — matches `/api/a1111/model` route

Removed entirely from api.js: global character CRUD, character bonds, character gallery, character references, relationships, styles, `advanceTurn`, `nudgeTurn`, `extractScene`, `regenerateTurn`, `regenerateTurnImage`, `updateTurn`, `resetModels`, `resetScenarioTurns`, `getOllamaModels`, `getHealthLibrary`, `generateTurnImage`, ImageCore upload, all character-state/clothing bulk routes.

Added to api.js: `getLlamacppConfig()`, `saveLlamacppConfig(newCfg)` — used by Settings > Model Backends UI; both use `/api/config` endpoint, storing config as JSON string under key `llamacpp_config`.

**app.js** — targeted removals:
- Removed `window.addEventListener('message', ...)` block for ImageCore events from `localhost:4000`
- Removed `styles` route branch from router (`/api/styles` backend not yet implemented)
- Removed `import { initStyles }` (unreachable after route removal)

**play.js** — initial turn/image wiring:
- Initial load: normalizes `getScenario` wrapper response; normalizes `getTurns` array
- `submitGuidanceTurn` + quick commands + end-story: use `API.postTurn` and handle `{user_turn, narrator_turn}` response
- `handleImageReady`: reads `data.filename` (not `data.imageFilename`)
- `_showImagePromptToast`: uses `API.generateSceneImage` (not stale `API.generateTurnImage`)

---

#### Phase 5b — Full stale-API audit (2026-06-14)

22 issues fixed across 9 files. Critical field name facts confirmed during audit:

- **`scene_images.filename`** — correct field name (NOT `imagecore_filename`)
- **`characters` schema** — no `fullbody_image_filename` or `reference_image_path` columns
- **`POST /api/a1111/model`** — body must be `{ model_name: name }` (NOT `{ model: name }`)
- **`scenarios` schema** — at Phase 5b time, only stored: `title, description, system_prompt, nsfw_enabled, narrator_model, context_turns`. **Fixed in Phase 8**: 18 new columns added; all wizard fields now persist.
- **No global character pool** — `GET /api/scenarios/:id/characters` only; no `/api/characters` global endpoint
- **No global locations endpoint** — `GET /api/scenarios/:id/locations` only
- **No `/api/styles` route** — backend route does not exist; table exists in DB but is unused

**play.js** — additional fixes from audit:
- `renderCastTab`: replaced `Promise.all([getScenarioCharacters, getScenarioCharacterStates, getCharacterClothing])` with single `API.getCharacters(scenarioId)`, clothing seeded from `char.base_clothing`
- `_loadCharacterStates`: replaced `API.getScenarioCharacterStates` with `return Promise.resolve()` (state is session-local only)
- `_commitClothingEdit`: `API.updateCharacterClothingById` → `API.updateCharacterClothing(scenarioId, charId, clothing)`
- Image cache building: `imagecore_filename` → `filename` (3 locations: cache object, `imageSrc()` call, null check)
- `renderRelationshipsTab`: replaced ~130-line implementation with 5-line stub ("not yet implemented")
- `fullbody_image_filename`/`reference_image_path` references → `var imgSrc = ''`
- Removed `import { openStyleCreatorModal } from './style-creator.js'`; replaced button handler with toast

**state.js** — `imagecoreOk: null` → `a1111Ok: null`; removed `libraryOk: null`

**ui.js** — status dots:
- `statusDotsHtml()`: now renders A1111 dot + Ollama dot only (removed ImageCore + Library dots)
- `updateStatusDots(svc, ok)`: handles `'a1111'` and `'ollama'` only
- `startStatusPolling()`: A1111 via `API.getHealthA1111()` every 15s; Ollama via `API.getHealthOllama()` every 30s

**dashboard.js** — removed entire Locations section:
- Removed `<button id="btn-new-location">` from header
- Removed `id="locations-section"` div
- Removed `renderLocationCards()` (~50 lines)
- Removed `openLocationModal()` (~75 lines)
- Removed `btn-new-location` onclick and `API.listLocations()` call

**scenario-setup.js** — wizard fixes:
- Removed `API.listLocations()` from load promises (no global locations endpoint)
- Removed `API.getScenarioCharacters()` calls (replaced with scenario-scoped `API.getCharacters(editId)`)
- Removed `API.getLoRAs()` → replaced with `API.getA1111Loras()`
- Removed "location is required" validation from `wizardNext` (would permanently block new scenario creation since `state.allLocations` is always empty)
- `submitWizard`: removed entire character sync block (`removeScenarioCharacter`/`addScenarioCharacter`) and `setScenarioActiveLocation` call; now just calls `API.createScenario(data)` or `API.updateScenario(editId, data)`

**characters.js** — stub out removed functionality (Phase 5); later updated in Phase 6:
- `initCharacters`: Phase 5: replaced with guidance message. Phase 6: loads global `API.getCharacters()` — fully functional character list
- `loadFullbodies()`: stub empty-state message (fullbody image management removed)
- `listStyles()`: stub (styles endpoint not available)
- `useFullbodyAsRef`/`deleteFullbodyById` button handlers: removed
- `renderRelationshipsPanel()` + `renderRelGraph()` (~270 lines, 1477–1746): replaced with 8-line stub

**settings.js** — stub out removed functionality:
- `testFireStyle` button → stub toast
- `API.getLoRAs()` → `API.getA1111Loras()` with normalization for both `Array.isArray(data)` and `data.loras`
- `createStyle()` → stub toast
- `_plLoadStyles()` → empty no-op
- `getScenarioLastImagePrompt` → stub toast
- `enhancePromptLab` → pass-through (copies raw prompt to enhanced textarea, no LLM call)
- `pl-send-btn` → stub toast ("Send to A1111 not available from Prompt Lab in this version")
- `pl-save-btn` createStyle → stub toast
- `loadGlobalRules()` → replaced with guidance message ("Rules are managed per-scenario")

**index.html** — removed dead script loads:
- Removed `<script src="/js/styles-init.js"></script>`
- Removed `<script src="/js/locations-init.js"></script>`
- Removed inline `<script>` block (~40 lines) that patched `#styles` hash routing via `hashchange` and `load` event listeners

**start-llamacpp.bat** (new file at project root):
- Launches `llama-server.exe` on port 8080 with context 32768 (up from 16384 in original story-lab)
- Model: `H:\Models\MN-12B-Mag-Mell-R1\MN-12B-Mag-Mell-R1-Q4_K_M.gguf`
- Flags: `-ngl 99 --flash-attn --cache-type-k q8_0 --cache-type-v q8_0 --cont-batching --mlock --host 0.0.0.0`
- Includes health check, port-clear, and startup reminder showing Settings > Model Backends config values

---

### Phase 8 — Persistence audit and character relationships: COMPLETE (2026-06-14)

> **Audit rule:** Every UI area that saves data must persist to DB and survive restart.
> No localStorage/sessionStorage hacks. No fake saves. No silently discarded fields.

**src/db.js — 18 new scenario column migrations:**
- Added additive `ALTER TABLE scenarios ADD COLUMN` migrations for: `tone`, `premise`, `setting`,
  `default_start`, `reply_length`, `lust_level`, `explicitness_level`, `pacing`, `narrative_pov`,
  `violence_level`, `tone_modifier`, `narrator_presence_enabled`, `narrator_presence_mode`,
  `narrator_presence_config`, `active_location_id`, `user_character_id`, `ended_at`, `generation_config`
- Added `CREATE TABLE IF NOT EXISTS character_relationships (...)` in try/catch
- Added `ALTER TABLE characters ADD COLUMN unique_trait TEXT DEFAULT NULL`
- Added `ALTER TABLE character_fullbodies ADD COLUMN is_default INTEGER DEFAULT 0`
  (column was already in main CREATE TABLE block but the additive migration was missing, causing
  crash on first run against an existing DB that predates the column)

**src/routes/scenarios.js — full rewrite:**
- `GET /` enriched: `LEFT JOIN scenario_characters` + `LEFT JOIN turns` + `GROUP BY s.id` returns
  `character_count`, `last_turn_at`, and `characters[]` array (id, name, reference_image_path) per scenario
- `GET /:id` uses `scenario_characters` join for characters (not legacy `scenario_id` column)
- `POST /` inserts all 25 fields including all 18 new wizard fields
- `PUT /:id` dynamic SET clause: builds from `SCENARIO_FIELDS` array (25 fields), only updates
  keys present in `req.body`; `BOOL_FIELDS = new Set(['nsfw_enabled', 'narrator_presence_enabled'])`
  cast to 0/1 integers

**src/routes/character-relationships.js — new file:**
- Full CRUD at `/api/scenarios/:scenarioId/relationships`
- All GET/POST responses JOIN characters to include `from_name` and `to_name`
- POST returns HTTP 409 on UNIQUE constraint violation (duplicate pair)
- PUT supports partial update of any subset of `relationship_type`, `description`, `strength`

**src/server.js:**
- Added `import relationshipsRouter from './routes/character-relationships.js'`
- Added `app.use('/api/scenarios/:scenarioId/relationships', relationshipsRouter)`

**src/services/narrator.js:**
- `buildSystemPrompt` accepts new optional param `relationships = []`
- New system prompt section 3 "Character Relationships" inserted between Characters and Rules:
  `"A → B: type (description) [intensity N/5]"` format, one line per relationship
- `runNarratorTurn` now queries `character_relationships` for the scenario and passes
  `relationships` array to `buildSystemPrompt`
- Section numbering updated: Rules→4, World→5, Memory→6, Personalities→7, NSFW→8, Scene→9

**public/js/api.js:**
- 4 new relationship methods added between Locations and Turns sections:
  `getRelationships(sid)`, `createRelationship(sid, data)`, `updateRelationship(sid, id, d)`,
  `deleteRelationship(sid, id)`

**public/js/views/dashboard.js — data bug fixed:**
- `renderScenarioGrid(data.scenarios || [])` → `renderScenarioGrid(Array.isArray(data) ? data : (data.scenarios || []))`
  (API returns flat array; code was always passing `[]` because `data.scenarios` was undefined)
- Card renderer updated to use real DB fields: `s.setting || s.premise`, `s.character_count`,
  `s.last_turn_at`, `s.ended_at`, `s.characters` — all now returned by enriched GET /

**public/js/views/scenario-setup.js — field-load bug fixed:**
- `var s = results[3]` → `var s = results[3].scenario || results[3]`
  (`API.getScenario(id)` returns `{ scenario: {...}, characters: [...], ... }` wrapper;
  old code accessed `s.title` on the wrapper object, producing empty fields in edit mode)

**public/js/views/play.js:**
- `initPlay`: added `state.allLocations = scenResp.locations || []` after scenario load
  (Scene Info modal was showing raw location IDs instead of names)
- `renderRelationshipsTab`: replaced 5-line stub with full implementation:
  - Loads `API.getRelationships(scenarioId)` + `API.getScenarioCharacters(scenarioId)` in parallel
  - Renders list: `from_name → type-badge → to_name`, optional description, delete button
  - Renders add form: from/to selects (populated with cast), type select (10 types),
    description input; submit wired to `API.createRelationship`

**src/routes/characters.js:**
- `POST /`: added `unique_trait` to INSERT column list (41st column) and `.run()` values
- `PUT /:id`: added `unique_trait = ?` to SET clause and `b.unique_trait ?? null` in `.run()` values

---

## Current Project State

| Item | Status |
|---|---|
| Design spec | Complete — `docs/superpowers/specs/2026-06-10-story-lab-a1111-design.md` |
| Phase 1 foundation | **COMPLETE** — server starts, DB schema live, config routes functional |
| Phase 2 LLM clients + config | **COMPLETE** — ollama.js, config-resolver.js, all config + profile routes |
| Phase 3 story engine | **COMPLETE** — narrator pipeline, turns, characters, locations, memories, world, rules |
| Phase 4 image pipeline | **COMPLETE** — a1111.js, prompt-builder.js, image-pipeline.js, images + audit routes |
| Phase 5 frontend wiring | **COMPLETE** — full stale-API audit done (2026-06-14), all ImageCore/ComfyUI refs removed |
| Phase 6 characters decoupled | **COMPLETE** — global characters, `scenario_characters` join table, live cast management UI (2026-06-14) |
| Phase 7 bug fixes + character system | **COMPLETE** — all character fields persisted, fullbody buttons wired, boolean config fixed, eye/breast options expanded, route ordering fixed (2026-06-14) |
| Phase 8 persistence audit + relationships | **COMPLETE** — all scenario wizard fields persist (18 new columns), character_relationships full stack, dashboard/scenario-setup/play.js bugs fixed, unique_trait + is_default migrations (2026-06-14) |
| llamacpp narrator support | **COMPLETE** — start-llamacpp.bat + narrator.js routing + api.js getLlamacppConfig/saveLlamacppConfig |
| A1111 installation | Present at `K:\stable-diffusion-webui`; start.bat auto-launches it if not running |
| SDXL models | Available at `E:\ComfyUI\models\checkpoints` |
| SDXL LoRAs | Available at `E:\ComfyUI\models\loras` |
| ADetailer extension | **Installed** |
| ControlNet extension | Not yet installed |

### Next steps

1. Configure A1111 to point at E:\ComfyUI\models (webui-user.bat — `--ckpt-dir`, `--lora-dir`, `--esrgan-models-path`)
2. Install ControlNet and FaceID extensions in A1111
3. Test full play loop: new scenario → global character → add to cast → turn → image gen → reference gen → fullbody gen
4. Implement character portrait generation endpoint (`POST /api/scenarios/:id/characters/:id/portrait`)
5. Implement styles CRUD backend (`src/routes/styles.js` — table exists in DB, route file absent)

---

---

### Phase 9 — Story-aware image generation: COMPLETE (2026-06-15)

Files added:
- `src/services/scene-picker.js` — scene moment picker (ported from Story-lab, Ollama-only)
- `src/services/story-enhancer.js` — SDXL prompt writer (ported from Story-lab, Ollama-only)
- `src/services/__tests__/scene-picker.test.js` — 9 pure-function tests (node:test, no deps)
- `src/services/__tests__/story-enhancer.test.js` — 5 pure-function tests (node:test, no deps)

Files modified:
- `src/services/narrator.js` — `image_prompt` field added to `SCENE_CARD_INSTRUCTION`
- `src/services/image-pipeline.js` — picker + enhancer wired as advisory layers (Stage 2a + 2b)

**How the image pipeline now works (non-character, non-background modes):**

```
narrator turn → scene card (includes image_prompt)
  ↓
Stage 2a: scene_picker — reads last 6 narrator turns (content_text), calls Ollama to pick
          the most visual moment → pickedMoment { visibleAction, setting, shotType, ... }
          Advisory only: never mutates sceneCard/location/characters.
          Returns null if model absent, turns empty, or Ollama fails.
  ↓
Stage 2b: story_enhancer — builds sceneDescription from pickedMoment (or falls back to
          sceneCard.image_prompt, or base prompt). Calls Ollama to write SDXL prompt pair.
          Advisory only: only replaces prompt/negative if output passes validation (>20 chars,
          no refusal, no story output, no bullet lists).
          Returns fallback if model absent or call fails.
  ↓
buildPrompt() or buildCharacterPrompt() — deterministic fallback, always present
  ↓
A1111 txt2img / img2img (unchanged)
```

**Config keys used (read from global_config):**
- `config.picker_model` — Ollama model for scene picker (falls back to `narrator_model`)
- `config.enhancer_model` — Ollama model for SDXL enhancer (falls back to `narrator_model`)
- If neither is configured, both stages log and skip silently

**Key design decisions:**
- `recentImageCards` for variety penalty always `[]` — `scene_images` has no `scene_card_json` column; degrades gracefully with a comment in code
- `content_text` column used for narrator turns (not `turn_text` as in original Story-lab)
- llama.cpp branch removed from story-enhancer — A111 uses Ollama only
- `buildPhysicalTraitsBlock` + `buildLockedIdentityBlock` from Story-lab inlined as single `buildTraitsBlock()` using same logic as `prompt-builder.js _characterBlock`
- Tests use `node:test` + `node:assert` (built-in Node 22, zero new deps)

---

### Debug fixes (2026-06-15)

**src/logger.js:**
- `_toMsg` truncation limit raised from 2000 → 4000 characters — full LLM prompts now visible in debug console without truncation

**src/routes/scenarios.js — two new endpoints:**
- `GET /api/scenarios/:id/scene-card` — debug endpoint: returns the latest narrator turn that has a non-null `scene_card_json`, parsed to an object. Useful to verify the LLM is producing `image_prompt` content. Returns `{ found: false, message }` when no scene cards exist yet.
- `POST /api/scenarios/:id/reset-scene` — clears `scene_card_json` on the latest narrator turn so the next image generation produces a fresh prompt (does NOT delete turns).

**public/js/views/play.js:**
- Reset Scene button: handler replaced. Previously deleted ALL turns in the scenario. Now calls `POST /api/scenarios/:id/reset-scene` (clears scene card only, turns preserved). Confirmation text updated to "Clear the current scene card? The next image will regenerate fresh."

---

## Files NOT Carried Over from story-lab

| File | Reason |
|---|---|
| `src/imagecore.js` | Replaced by `src/services/a1111.js` |
| `src/services/image-builder.js` | LoRA validation now via A1111 API |
| `src/services/turn-image-service.js` | Replaced by `src/services/image-pipeline.js` |
| `src/video-wan2.js` | Wan2.2 is ComfyUI-only, dropped |
| `src/services/pose-library.js` | Dropped for MVP |
| `src/routes/pose-library.js` | Dropped for MVP |
| `src/routes/prompt-lab.js` | Dropped for MVP |
| All ComfyUI workflow JSON references | Not applicable to A1111 |

### Top-8 audit fixes (2026-07-13) - COMPLETE

Runtime behavior changes (see `docs/superpowers/plans/2026-07-13-top8-audit-fixes.md`):
1. `prompt-builder.getArousalTags` - levels 1-3 empty; missing arousal defaults to 1; gates on `nsfw_enabled` / `explicit_mode`.
2. Removed `db.js` boot force-true for nsfw/explicit/learning. `summary_learning_enabled` is in `BOOLEAN_KEYS`.
3. FaceID/IP-Adapter reads `reference_image_path` (accept syncs both path columns).
4. Scenario location BG generate/set-default/delete maintain `location_backgrounds`; resolver falls back to `default_background` + existsSync.
5. Scene image insert writes learning snapshot columns; ratings SELECT includes them (+ turn card fallback).
6. After story-enhancer success, pipeline re-wraps with master/profile prefix, suffix, LoRAs, master negative.
7. Narrator content policy + cast arousal block gated by master NSFW ceiling and scenario `nsfw_enabled`; picker uses `config.nsfw_enabled`.
8. Styles and Images gallery UIs show unavailable stubs; Settings Image Profiles remain the supported path.

### Desired-functionality gap closure (2026-07-13b)

Aligned to `desired_functionality.md`:

1. **Turn-offs in narration:** `moodtriggersneg` (and positive mood triggers when mood is low) are injected into cast behavior directives alongside `arousaltriggers`. Character UI labels clarify these feed the narrator.
2. **Scenario clothing model (sets + scoped runtime):** Character editor manages named `outfit_sets`. Scenario setup picks a starting set per cast member. Runtime clothing lives on `scenario_character_state`; Play edits / narrator changes are scenario-scoped only.
3. **Location background info:** Locations UI exposes Visual description + Background info (`full_desc`). Narrator location block includes visual, background info, and image tags.
4. **Honest Play UI:** Filter Rules disabled with “not used” label (reply length/NSFW/tone live in Scenario settings). Character / Narrator / Continue empty submissions use clearer respond-as / narrate / continue instructions.
5. **Character image edits drive generate:** Prompt panel sends `directPrompt` + `rawPrompt` from edited tags/plain; character mode prefers that for action context (and rejects missing cast character arrays).

Still intentional gaps vs desire doc: Filter Rules not implemented; Enhance guidance still toasted unavailable; video still stubbed.

### Scenario-scoped clothing model (2026-07-13c) - COMPLETE

Implements `clothing_functionality.md`:

| Layer | Storage | UI |
| --- | --- | --- |
| Character clothing sets | `characters.outfit_sets` JSON array `{name, description}` + `default_outfit_name` / `default_outfit` | Characters page: Clothing Sets manager (add/edit/delete/reorder/default); raw JSON advanced |
| Scenario starting outfit | `scenario_characters.starting_clothing_set_name`, `starting_clothing` | Scenario setup cast: Starting clothing set dropdown + Set; persists when editing scenario |
| Scenario runtime | `scenario_character_state.current_clothing` | Play cast sidebar: live clothing, inline edit, reset to starting; WS `clothingupdate` |
| Narrator / images | `getScenarioClothing` read order | Narrator `Currently wearing`; scene + character image pipelines use `resolveScenarioClothingMap` |

Isolation: changing clothing in scenario A never writes character `outfit_sets` and does not affect scenario B runtime state.

### Post-audit fixes (2026-07-13d) - COMPLETE (top 4 of 16)

Source: `docs/audits/clothing-faceid-image-pipeline-audit-2026-07-13.md` (full findings CF-1
through CF-12). **Historical note (2026-07-13d):** this pass fixed the 4 highest-severity findings only; CF-5 through CF-12 were still open at that moment. Living status: see **Handoff / Current Status** (CF-1—CF-11 closed; CF-12 intentional debt).

New file: `src/services/prompt-resolution.js` — pure helpers (`applyResolvedClothing`,
`resolvePrimaryCharacterForReference`) with no DB/network access, shared between
`image-pipeline.js` and `prompt-preview.js`. Tested in
`src/services/__tests__/prompt-resolution.test.js` (9 tests, node:test, no deps).

New export: `prompt-builder.js` → `composeEnhancedScenePrompt()`. Tested in
`src/services/__tests__/prompt-builder.compose.test.js` (4 tests, node:test, no deps).

1. **CF-1 (Critical) — story-enhancer no longer discards resolved scenario clothing.**
   `image-pipeline.js`'s Stage 2b re-wrap now goes through `composeEnhancedScenePrompt()`,
   which always re-injects `parts.clothing_block` (captured before the enhancer runs).
   Previously the enhancer's LLM output unconditionally replaced `prompt`, and since its
   own fallback text has no clothing field, this fired on effectively every default
   scene-image generation. Character-focused generation was already unaffected (bypasses
   Stage 2b). Audit event `build_prompt` now logs `enhancer_applied` and pre/post prompt
   snippets.
2. **CF-2 (High) — FaceID reference now matches the character being generated.**
   `image-pipeline.js`'s IP-Adapter reference resolution now calls
   `resolvePrimaryCharacterForReference()` instead of always picking
   `characters.find(c => c.role !== 'player') || characters[0]` (alphabetically-first NPC).
   Character mode was fixed correctly in this pass. **Scene mode's fix in this pass was
   broken** — it read `sceneCard.characters_present`, a field nothing ever writes, so scene
   mode still always fell through to the alphabetical-first-NPC fallback. This was caught by
   a follow-up verification audit (2026-07-13, re-audit) and corrected in
   **2026-07-13e** — see that section below and "Reference character selection" under Image
   Generation Architecture above for the real (`mainSubject`-based) resolution order and its
   documented limitation.
3. **CF-3 (High) — Prompt Preview now shows scenario-resolved clothing.**
   `prompt-preview.js`'s `target: 'character'` branch now resolves
   `getScenarioClothing(scenarioId, characterId)` through `applyResolvedClothing()` before
   calling the extractors, instead of reading the legacy `characters.current_clothing`
   card field. Matches what `image-pipeline.js` already did correctly for actual generation.
4. **CF-4 (High) — Character Editor reference/full-body generation no longer drifts from
   the main pipeline.** `routes/characters.js` removed its own `_buildPayload()` +
   `a1111.txt2img()` call and now imports `buildA1111Payload()` / `callA1111()` from
   `image-pipeline.js` (exported for this purpose). Gets the same `sd_vae` override and
   VAE-failure retry as scene/character generation.

Not changed in this pass (still true after these fixes, unlike before): character mode's
`char.current_clothing` assignment in `image-pipeline.js` now goes through
`applyResolvedClothing()` too (returns a copy instead of mutating the row in place) —
behavior-equivalent, no functional change, just reuses the same helper as CF-3.

Verification performed: new pure-function tests (RED confirmed before implementation, all
GREEN after); read-only script against the live `story-lab.db` confirming (a) a real
multi-NPC scenario's `clothing_block` survives a simulated enhancer overwrite, (b) scene-mode
reference resolution picks a hand-constructed `characters_present`-named subject instead of
the alphabetically-first NPC on real cast data, (c) character-mode resolution is unaffected
by scene-card content, (d) `buildA1111Payload()` produces the VAE-override payload Character
Editor generation now uses. Full live A1111/Ollama generation was not exercised (would
create real files and DB rows) — logic was verified deterministically instead.

**Caveat found in re-audit (see 2026-07-13e below):** check (b) above used a
hand-constructed `sceneCard.characters_present` value, not output any real code path
produces — the "real cast data" in that check referred to the character rows, not the
scene-subject signal. This distinction was not disclosed at the time and made the fix look
more verified than it was; scene mode was not actually exercised end-to-end with real
`pickedMoment` data before being marked FIXED.

### Post-audit fixes (2026-07-13e) - COMPLETE

Follow-up correction to CF-2 from 2026-07-13d, found by an independent re-audit (see "CF-2"
above and `docs/audits/clothing-faceid-image-pipeline-audit-2026-07-13.md`).

**Root cause:** `resolvePrimaryCharacterForReference()`'s scene-mode branch read
`sceneCard.characters_present`. Nothing writes that field — confirmed by reading
`narrator.js`'s `SCENE_CARD_INSTRUCTION` and `scene-picker.js`'s response schema (neither
includes it) and by querying the live DB (0 of 108 recent `scene_card_json` rows contain
it). Every real scene-mode generation therefore took the `presentNames.length === 0`
fallback branch — `npcs[0]`, the alphabetically-first NPC — identical output to the
pre-2026-07-13d bug.

**Fix:** `resolvePrimaryCharacterForReference({ mode, resolvedChar, characters,
mainSubject })` — `sceneCard` parameter removed entirely; replaced with `mainSubject`, a
string sourced from `pickedMoment?.mainSubject` in `image-pipeline.js`. `pickedMoment`
comes from `pickBestMoment()` (`scene-picker.js`), which actually requests `mainSubject:
'primary character(s) or subject'` from the picker LLM in its `baseSchema` (unconditional,
not nsfw-gated) and is already computed in Stage 2a for every scene-mode generation where
the picker runs — no new schema field, no new DB write, no new LLM call. Matching is
case-insensitive substring search of cast names against the `mainSubject` text, tried in
cast (name) order. Falls back to the first non-player cast member when `mainSubject` is
absent or names nobody in the cast — same fallback value as before, but now honestly
documented as the limitation it is rather than an unreachable "rare" branch.

Files changed:

- `src/services/prompt-resolution.js` — `resolvePrimaryCharacterForReference()` scene-mode
  logic rewritten; `sceneCard`/`characters_present` reading removed.
- `src/services/image-pipeline.js` — FaceID reference call site now passes
  `mainSubject: pickedMoment?.mainSubject` instead of `sceneCard`.
- `src/services/__tests__/prompt-resolution.test.js` — rewritten scene-mode test cases
  around `mainSubject`; added a regression test asserting `characters_present` is ignored
  even when present on `sceneCard`.

Character-mode logic is untouched — same `resolvedChar` early-return, verified by a test
asserting it ignores `mainSubject` entirely.

Verification performed: TDD (RED confirmed — 3 of 12 existing/updated tests failed against
the pre-fix implementation for the exact behavior being changed — then GREEN, 16/16).
Read-only script against the live `story-lab.db` on a real 4-NPC scenario (cast order Jib,
Lorey, Riley, Sarah) confirming: scene mode with a `mainSubject` naming "Riley" picks Riley,
not alphabetical-first Jib; scene mode with no `mainSubject` falls back to Jib (documented
limitation, not silently "fixed"); character mode with `resolvedChar` = Riley picks Riley
regardless of what `mainSubject` says; scene mode with a legacy `characters_present: Sarah`
value but no `mainSubject` correctly ignores it and falls back to Jib. Confirmed no
circular import by loading `image-pipeline.js` and `routes/characters.js` together.

**Remaining known limitation (disclosed, not fixed):** scene-mode FaceID accuracy for
multi-NPC scenes depends on the picker running and `mainSubject` naming a cast member by
name. When the picker is skipped (`skipAdvisory`), unconfigured, fails, or names someone
ambiguously, scene mode still submits the same first non-player cast member's face for
every image in that scenario. This is a single-reference system; true per-character,
per-scene FaceID for multi-companion scenes is not implemented.

### Lean regression suite (2026-07-13e) - COMPLETE

Built the first automated regression suite for this project (previously 14 pure-function
tests across 2 files, one of which — `scene-picker.test.js` — was silently broken at
import time). Now 61 tests across 9 files, all green, `npm test`. See "Testing" near the
top of this doc for the full runbook (mocking pattern, ordering rules, what is/isn't
covered) — this section is the dated changelog entry; that one is the living reference.

**New/changed test files:**

- `src/services/__tests__/image-pipeline.integration.test.js` (new, 7 tests) — CF-1 and
  CF-2 via real `generate()` calls (mocked A1111/Ollama, in-memory DB).
- `src/services/__tests__/prompt-preview.test.js` (new, 3 tests) — CF-3.
- `src/services/__tests__/a1111-payload.test.js` (new, 8 tests) — `buildA1111Payload`,
  pure.
- `src/services/__tests__/a1111-call.test.js` (new, 4 tests) — `callA1111` retry behavior,
  mocked fetch.
- `src/routes/__tests__/characters.routes.test.js` (new, 5 tests) — CF-4 at the route/HTTP
  level, plus a static "no duplicate payload builder" source check.
- `public/js/__tests__/outfit-sets-validation.test.js` (new, 6 tests) — CF-5.
- `src/services/__tests__/scene-picker.test.js` (rewritten, 7 tests) — see "Stale test
  fixed" below.
- `src/services/__tests__/prompt-resolution.test.js`, `prompt-builder.compose.test.js`,
  `story-enhancer.test.js` — unchanged, still passing (21 tests).

**New non-test files:**

- `public/js/outfit-sets-validation.js` — CF-5 fix (see `clothing.js` section above).

**Stale test fixed:** `scene-picker.test.js` imported `buildMotionPrompt` from
`scene-picker.js`, which has not existed in that module since an earlier rewrite (it only
ever exports `pickBestMoment`). This was a hard `SyntaxError` at import time — the whole
file failed before a single assertion ran, on every `node --test` invocation, for however
long ago that rewrite landed. Removed the dead tests; replaced with real coverage of
`pickBestMoment` (null-return guards, successful parse, malformed/missing-field response,
network failure), all against the actual current export.

**Infrastructure discovered and documented, not just used once:** the "redirect
`paths.js`'s `DB_PATH` to `:memory:` before dynamically importing `db.js`" pattern, and
the two ordering footguns around it (static-vs-dynamic import timing, and `mock.module()`
not being safely re-callable per-test once a module is cached) — see "Testing" above.
These aren't one-off notes; any future test that needs real DB rows should follow the same
pattern rather than re-deriving it.

**Verification performed:** `npm test` — 61/61 passing, clean output (no unmocked-network
errors, no unexpected console noise). Confirmed zero writes to the real `story-lab.db`
(every DB-touching test redirects `DB_PATH` to `:memory:` before first import). Confirmed
no real A1111/Ollama network calls are possible from within the suite — the fetch mock
throws loudly on any unrecognized URL rather than silently passing through, so an
un-mocked call is a visible test failure, not a real request.

**Explicitly not covered by this pass** (historical note for the 2026-07-13e lean suite — 61/61 across 9 files; see "Testing" above for the living 92/12 count, and
`docs/audits/clothing-faceid-image-pipeline-audit-2026-07-13.md` for the full list):
at the time of this 13e pass, CF-6 through CF-12 were still open (master-doc schema contradiction, stale CLAUDE.md stub list, unused
`faceid_ref_count`/`faceid_ref_order`, dead Images-page reference UI, two clothing routes
with opposite `runtime`-omitted defaults, ControlNet-availability cache never invalidating,
misc dead code). **Later (2026-07-13f):** CF-7 was resolved by removing the FaceID slot-config UI (fields remain unread), and CF-11 was fixed+tested via TTL-bound `getControlNetCatalog`. CF-6/CF-9 closed in docs alignment; CF-8/CF-10 closed in the wrap-up pass (quarantine stub + explicit `runtime` boolean). Remaining intentional tech debt: CF-12. No browser/E2E coverage exists or is planned.

### Post-audit fixes (2026-07-13f) - COMPLETE

A1111-native FaceID / IP-Adapter rewrite (CF-A1 through CF-A6), plus cleanup of two related CF items:

- Explicit ControlNet module resolution (never `ip-adapter-auto`); no fabricated IP-Adapter model default; fail-open ControlNet retry; honest single-reference-only; per-mode weight/timing; TTL-bound ControlNet catalog preflight (`getControlNetCatalog`).
- **CF-7:** misleading FaceID Slot Config UI removed (fields/`PATCH .../faceid-config` remain but are unread by generation).
- **CF-11:** ControlNet catalog cache is TTL-bound (5 minutes) + `forceRefresh`; regression tests in `src/services/__tests__/a1111-payload.test.js`.

Living behavior details: "FaceID / IP-Adapter" and "Core Rule: One Pipeline for All Image Types" under Image Generation Architecture. Test inventory: `## Testing` (92/12 as of this pass). Manual still required: a real generation against live A1111 + ControlNet since the module change; Play UI display of `controlnetFallback`; Settings module/model dropdowns.

After 13f + docs alignment + wrap-up: CF-6/CF-7/CF-8/CF-9/CF-10/CF-11 closed. **CF-12 remains as intentional low-risk tech debt** (see "Current Status / How to test").

---

## Handoff / Current Status (clothing / FaceID / image-pipeline audit)

**Safe to pause here.** Automated audit work is complete. Remaining items are either intentional tech debt or human manual smoke checks. Do not reopen CF-1…CF-11 unless a new regression appears.


### Local-model prompt contracts (2026-07-13g)

| Change | Where |
| --- | --- |
| Ollama `format` + `keep_alive` passthrough | `src/services/ollama.js` |
| Schema-enforced picker JSON + temp 0.1 | `src/services/scene-picker.js` |
| Schema-enforced emotion JSON + system split | `src/services/character-state.js` |
| Shared tag dialect (gaze/count/env) | `src/services/tag-dialect.js` -> extractor + regen |
| NSFW-gated slim scene card | `src/services/narrator.js` `buildSceneCardInstruction` |
| Short 3-line SDXL enhancer contract | `src/services/story-enhancer.js` |


### Visual brief SoT (2026-07-13h)

| Rule | Detail |
| --- | --- |
| Storage | `turns.scene_card_json.visual_brief` |
| Job | Structured visual extraction (not prose summarizer) |
| Scene images | `main_subject` + briefs + setting; FaceID priority = `main_subject` |
| Character images | current-turn brief → prior brief → generic |
| Legacy | `image_prompt` fallback only |

### Done in this audit (shippable)

| Area | Outcome |
| --- | --- |
| Clothing on default scene path (CF-1) | Preserved through story-enhancer; tested |
| FaceID character selection (CF-2) | `mainSubject`-based; known multi-NPC fallback documented |
| Prompt Preview clothing (CF-3) | Scenario-resolved; tested |
| Shared A1111 payload path (CF-4) | Character Editor uses `buildA1111Payload` / `callA1111` |
| Outfit JSON save (CF-5) | No silent discard; tested |
| Docs schema / stubs (CF-6, CF-9) | `clothing_changes` + Known Stubs aligned |
| FaceID slot UI honesty (CF-7) | Misleading UI removed; honesty tests |
| Images page (CF-8 then 2026-07-14) | Was quarantine; now character gallery + identity reference picker (`#images`) |
| Clothing `runtime` contract (CF-10) | Explicit boolean required; callers + route tests |
| ControlNet catalog TTL (CF-11) | 5-minute TTL; tested |
| FaceID/IP-Adapter rewrite (CF-A1…A6) | Explicit module, no fabricated model, fail-open retry, tested |

### Tests

- **Command:** `npm test`
- **Current count:** **154/154** (narrator turn regenerate wired). No A1111/Ollama/real DB.

### Intentional tech debt (CF-12) — not release-blocking

| Item | Why safe |
| --- | --- |
| Unused `enrichSceneCardPrompts()` | Live path uses `applyNarratorSummaryOnly` |
| Unused `a1111.getOptions()` | Dead export; harmless |
| Legacy `resolveClothing` / `resetClothing` | Stub/legacy; `resolveClothing` listed in Known Stubs |
| `reset-scene` does not clear runtime clothing | Intentional until a product decision says otherwise |
| Cast-add runtime double-write | Idempotent / cosmetic |

### Manual smoke checks still required

1. Live A1111 + ControlNet: one scene image with FaceID on — confirm identity OR `controlnetFallback`.
2. Play: inline clothing edit + WS update (`runtime: true`).
3. Scenario setup: change starting outfit, reload (`runtime: false`).
4. Images page: select character → upload gallery → Use as reference (FaceID slot).
5. Characters: accept face ref + generate fullbody.

### Optional later (not required to resume play)

- Delete unused helpers (`getOptions`, etc.) in a dedicated cleanup.
- Product decision: should `reset-scene` also reset runtime clothing?
- Browser/E2E suite (never planned for this audit).

### Pointers

- Living behavior: `## Testing`, FaceID / IP-Adapter, Core Rule (this file).
- Historical FAIL snapshot + status overlay: `docs/audits/clothing-faceid-image-pipeline-audit-2026-07-13.md`.
