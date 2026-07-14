# Story-Lab-A1111 Master Knowledge Document

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

**What changed in `public/` (Phase 5 targeted modifications):**
- api.js: fully rewritten — all methods now scenario-scoped and A1111-compatible
- play.js: stale API calls fixed, Cast tab wired, image field names corrected
- state.js / ui.js: status dots changed to A1111 + Ollama only
- dashboard.js: Locations section removed
- scenario-setup.js: wizard no longer requires location; character sync removed
- characters.js: global list replaced with guidance; relationships panel stubbed
- settings.js: stale LoRA/style/rules calls stubbed or corrected
- index.html: styles-init.js, locations-init.js, and inline hash routing removed

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
| Image gen | A1111 at `http://127.0.0.1:7860` |
| Dependencies | cors, express, ws — nothing else |

Start command: `node --experimental-sqlite --max-old-space-size=4096 src/server.js`

---

## A1111 Setup Requirements

### Extensions

`sd-webui-adetailer` is **installed**. No further action needed for ADetailer.

The remaining extensions still required:

| Extension | Purpose | Required for |
|---|---|---|
| `sd-webui-controlnet` | Pose/composition control | Pose control |
| `sd-webui-faceid` | Reference-image character consistency | Character consistency |

### Models to install

| Model | Where | Purpose |
|---|---|---|
| `4x-UltraSharp` | `models/ESRGAN/` | Hires.fix upscaler |
| OpenPose models | via ControlNet downloader | ControlNet pose detection |
| IP-Adapter models | via FaceID extension instructions | FaceID consistency |

### Model path configuration (webui-user.bat)

A1111 should point directly at the existing ComfyUI model directories.
Add these flags to `K:\stable-diffusion-webui\webui-user.bat`:

```bat
set COMMANDLINE_ARGS=--ckpt-dir E:/ComfyUI/models/checkpoints --lora-dir E:/ComfyUI/models/loras --esrgan-models-path E:/ComfyUI/models/upscale_models --api --listen
```

`--api` enables the REST API. `--listen` allows connections from localhost.

### Available SDXL checkpoints (at E:\ComfyUI\models\checkpoints)

- `realcartoonXL_v7.safetensors` — default, recommended first
- `Illustrious-XL-v2.0.safetensors`
- `dreamshaperXL_lightningDPMSDE.safetensors`
- `juggernautXL_ragnarokBy.safetensors`
- `Juggernaut-XI-v11.safetensors`
- `sd_xl_refiner_1.0.safetensors` (refiner — not used in txt2img)

### Available SDXL LoRAs (at E:\ComfyUI\models\loras\SDXL)

Key ones for story content:
- `SDXL-TouchofRealismV2-0506.safetensors`
- `SDXL-WildcardX--Detail-Enhancer.safetensors`
- `SDXL-XDetaillight.safetensors`
- `SDXL-riley-v1.safetensors`
- `SDXL-undressing_Pony_v1.safetensors`
- `ip-adapter-faceid-plusv2_sdxl_lora.safetensors` (for FaceID)

---

## Ports and Services

| Port | Service |
|---|---|
| 4090 | story-lab-a1111 (this project) |
| 7860 | A1111 (http://127.0.0.1:7860) |
| 11434 | Ollama |
| 8080 | llama-server (optional alternative narrator — see start-llamacpp.bat) |

Port 4060 (asset-library) has been removed from status monitoring. The status bar now shows
A1111 and Ollama only.

---

## Directory Structure (as of Phase 4)

Files marked [PLANNED] do not exist yet.

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

### Dead files (on disk, no longer executed)

These files exist on disk but are not loaded by `index.html` and are not imported anywhere in active code. Do not delete without confirming — they may be referenced by the design spec.

| File | Why dead |
|---|---|
| `public/js/styles-init.js` | Removed from index.html; called stale `/api/styles` |
| `public/js/locations-init.js` | Removed from index.html; called stale global `/api/locations` |
| `public/js/style-picker-patch.js` | Not loaded; patched a UI that no longer exists |
| `public/js/style-creator.js` | Import removed from play.js; called `/api/styles` which has no backend route |
| `public/js/views/styles.js` | Routed (`#styles`) but UI quarantined 2026-07-13: no styles backend; use Settings Image Profiles |

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
generation_config         TEXT    DEFAULT NULL       -- JSON blob for per-scenario image overrides
```

`GET /api/scenarios` (list) now returns two computed columns alongside the row:
- `character_count` — count of linked characters via `scenario_characters`
- `last_turn_at` — `MAX(turns.created_at)` for the scenario
- `characters[]` — embedded array of character rows (id, name, reference_image_path) per scenario

`PUT /api/scenarios/:id` uses a dynamic SET clause — only updates fields present in `req.body`.
Boolean fields (`nsfw_enabled`, `narrator_presence_enabled`) are cast to 0/1 integers on write.

Image config is NOT stored per-scenario. All image settings come from `global_config`
(master) and the active `image_profiles` row (optional overrides).

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
reference_image_path TEXT             -- active FaceID ref; set via accept or fullbody use-as-ref
description TEXT DEFAULT ''
image_description TEXT                -- freeform image gen override
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
image_prompt_override TEXT            -- if set, overrides all assembled prompts
faceid_ref_count INTEGER DEFAULT 5
faceid_ref_order TEXT                 -- JSON array of fullbody IDs for slot ordering
unique_trait TEXT DEFAULT NULL        -- one-line distinctive trait injected into narrator prompt
```

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

Character image files live at `H:\MEDIA\Story_Lab\images\characters\{charId}\references\`
and `characters\{charId}\fullbody\`. The old `{scenarioId}/characters/{charId}/...` path
is deprecated but not migrated (existing files stay in place).

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

```
id INTEGER PK
scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE
name TEXT NOT NULL
description TEXT DEFAULT ''
image_tags TEXT DEFAULT ''            -- SDXL tags appended in txt2img mode
background_images_json TEXT DEFAULT '[]'  -- legacy; not used by pipeline (kept for compatibility)
background_folder TEXT DEFAULT ''     -- folder name under BACKGROUNDS_DIR (e.g. 'Sarahs_room')
default_background TEXT DEFAULT ''    -- specific filename to pin; random pick if empty
time_of_day TEXT DEFAULT 'any'
created_at TEXT DEFAULT datetime('now')
```

Background files live at `H:\MEDIA\Story_Lab\backgrounds\{background_folder}\{filename}`.
`background_folder` is the literal folder name (not derived from location name).

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

### scene_images

```
id INTEGER PK
scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE
turn_id INTEGER REFERENCES turns(id)
filename TEXT NOT NULL                -- basename only; file in IMAGES_DIR/{scenarioId}/
mode TEXT NOT NULL                    -- 'scene' | 'portrait' | 'fullbody' | 'background'
generation_method TEXT DEFAULT 'txt2img'  -- 'txt2img' | 'img2img'
background_used TEXT DEFAULT ''       -- background filename used as init image (if img2img)
prompt_used TEXT DEFAULT ''           -- final prompt sent to A1111
negative_used TEXT DEFAULT ''
profile_id INTEGER REFERENCES image_profiles(id)
seed INTEGER DEFAULT -1               -- actual seed from A1111 response
steps INTEGER DEFAULT 30
cfg REAL DEFAULT 7
width INTEGER DEFAULT 832
height INTEGER DEFAULT 1216
model_name TEXT DEFAULT ''
generation_time_ms INTEGER DEFAULT 0
created_at TEXT DEFAULT datetime('now')

-- Added via migration (Phase 4):
accepted INTEGER DEFAULT 0
user_rating INTEGER DEFAULT 0
model_hash TEXT DEFAULT ''            -- from A1111 info JSON (catches silent model switches)
loras_json TEXT DEFAULT '[]'          -- reserved; not yet populated
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

### styles

```
id INTEGER PK
name TEXT NOT NULL
description TEXT DEFAULT ''
prompt_prefix TEXT DEFAULT ''
prompt_suffix TEXT DEFAULT ''
negative TEXT DEFAULT ''
created_at TEXT DEFAULT datetime('now')
```

### image_profiles

```
id INTEGER PK
name TEXT NOT NULL
description TEXT DEFAULT ''
prompt_prefix TEXT DEFAULT ''
prompt_suffix TEXT DEFAULT ''
negative_additions TEXT DEFAULT ''
lora1_file TEXT DEFAULT ''
lora1_strength REAL DEFAULT 1.0
lora2_file TEXT DEFAULT ''
lora2_strength REAL DEFAULT 1.0
steps_override INTEGER              -- nullable; overrides master steps when set
cfg_override REAL                   -- nullable; overrides master CFG when set
is_active INTEGER DEFAULT 0         -- only one row may have is_active=1 at a time
created_at TEXT DEFAULT datetime('now')
```

### audit_events

```
id INTEGER PK
pipeline_run_id TEXT DEFAULT ''     -- UUID linking all events in one generation attempt
service TEXT NOT NULL               -- 'image-pipeline' | 'a1111' | 'prompt-builder' | 'narrator' | ...
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

Key/value store seeded with defaults in `src/db.js`.

| Key | Default | Notes |
|---|---|---|
| `a1111_url` | `http://127.0.0.1:7860` | |
| `a1111_model` | `''` | Updated by POST /api/a1111/model |
| `a1111_steps` | `30` | |
| `a1111_cfg` | `7` | |
| `a1111_sampler` | `DPM++ 2M SDE` | |
| `a1111_scheduler` | `Karras` | |
| `a1111_width` | `832` | |
| `a1111_height` | `1216` | |
| `a1111_clip_skip` | `2` | |
| `hr_enabled` | `false` | Boolean stored as string |
| `hr_scale` | `1.5` | |
| `hr_steps` | `15` | |
| `hr_denoising` | `0.4` | |
| `hr_upscaler` | `R-ESRGAN 4x+` | |
| `ad_enabled` | `true` | |
| `ad_model` | `face_yolov8n.pt` | |
| `ad_strength` | `0.4` | |
| `lora_enabled` | `true` | Global gate; profiles cannot override |
| `nsfw_enabled` | `false` | |
| `master_negative` | `bad anatomy, bad hands...` | |
| `narrator_model` | `''` | Empty = auto-select first Ollama model |
| `narrator_context_turns` | `20` | |
| `narrator_max_tokens` | `1200` | |
| `llamacpp_config` | `'{}'` | JSON blob for per-role backend config; see narrator routing below |

`llamacpp_config` JSON schema (stored as a string, parsed at runtime):
```json
{
  "narrator":  { "backend": "llamacpp", "port": 8080, "model_path": "H:\\Models\\..." },
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
strength          INTEGER DEFAULT 3                -- 1–5 intensity
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

The `pipeline_run_id` (UUID) links every event in one generation attempt.
Filter `WHERE pipeline_run_id = 'x'` to see the complete trace for any image.

### What gets logged

| Service | Logged inputs | Logged outputs |
|---|---|---|
| narrator | model, token estimate, system block count, turn count, memory count | full response text + parsed scene_card JSON (or parse failure), duration |
| prompt-builder | scene_card (from narrator), character states, effective config, background_path | full parts breakdown JSON, img2img vs txt2img mode selected |
| a1111 | complete request payload (txt2img or img2img) | seed, model_hash, generation_time_ms |
| clothing | character, current state, scene_card | resolved clothing string, resolution path taken |
| memory | trigger reason, turn range | summary text, model used, promotion events |
| model-resolver | scenario nsfw_enabled, overrides | resolved models, fallbacks used |
| image-pipeline | pipeline_run_id, scenarioId, turnId, mode | final filename, stages completed, or which stage failed |

### Using the audit log

- **"Why was that image bad?"** — filter `audit_log` / `logs/audit.jsonl` for that `pipeline_run_id` (prompt parts are audit/in-memory data, not a `scene_images` column)
- **"Did the enhancer run?"** — check `enhance_skipped` and `enhance_output`
- **"Which model was used?"** — check `a1111_model_hash` (catches silent model switches)
- **"What seed was that?"** — `a1111_seed` — actual A1111 seed, always reproducible
- **"Where did it fail?"** — filter `audit_log WHERE pipeline_run_id = 'x' AND status = 'failed'`
- **"Were the LoRAs applied?"** — `scene_images.loras_json`
- **"What was her clothing state?"** — `scenario_character_state.current_clothing` for the scenario, and/or clothing fields on the matching audit events (there is no `scene_images.character_states_json` column)
- **Replay any image** — `a1111_request_json` is the complete payload; POST it directly to A1111

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

### src/services/a1111.js

A1111 HTTP client. All functions take `baseUrl` as first argument (read from
`resolveEffectiveConfig(db).a1111_url` by callers). Saves decoded base64 images to disk.

```js
txt2img(baseUrl, payload, savePath)
// → { filename, seed, model_name, model_hash, generation_time_ms, info }

img2img(baseUrl, payload, savePath)
// → { filename, seed, model_name, model_hash, generation_time_ms, info }

getModels(baseUrl)    // → [{ title, model_name, hash }]
getLoras(baseUrl)     // → [{ name, path, alias }]
getSamplers(baseUrl)  // → string[] — sampler names from /sdapi/v1/samplers
getSchedulers(baseUrl)// → string[] — scheduler names from /sdapi/v1/schedulers
getProgress(baseUrl)  // → { active, progress, eta }
setModel(baseUrl, modelName)  // → void — POST /sdapi/v1/options
getOptions(baseUrl)   // → current A1111 options object
checkHealth(baseUrl)  // → { ok } or { ok: false, error } — 3 s timeout
```

LoRAs are injected into the prompt string as `<lora:filename:strength>` tags by prompt-builder.
CLIP skip 2 is always set via `override_settings.CLIP_stop_at_last_layers`.

### src/services/config-resolver.js

```js
resolveMasterConfig(db)
// → flat config object; NUMERIC_KEYS cast to float, BOOLEAN_KEYS cast to bool

resolveActiveProfile(db)
// → active image_profiles row or null

resolveEffectiveConfig(db)
// → merged config: master + profile overrides (prompt_prefix/suffix, negative_additions,
//   lora1/2, steps_override, cfg_override). Returns { ...merged, active_profile_id }
// Profiles CANNOT override: a1111_url, a1111_model, hr_enabled, ad_enabled,
//   lora_enabled, nsfw_enabled
```

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
// Parses ---SCENE--- block. Never throws on parse failure — returns defaultSceneCard().
```


**Scene card instruction (2026-07-13g):** `buildSceneCardInstruction(effectiveNsfw)` replaces the old always-on NSFW-heavy `SCENE_CARD_INSTRUCTION`. Machine fields stay minimal (`image_prompt`, `mood`, `arousal_level`, `nsfw_elements`, NSFW triad, `clothing_changes`). When master+scenario NSFW is off, explicit/nudity/body fields are instructed as `null` and `nsfw_elements` must be false. When NSFW is on, those fields may be filled only from what is clearly visible now.

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

### src/services/prompt-builder.js

Pure — no DB calls, no LLM calls.

```js
buildPrompt({ sceneCard, characters, location, scenario, config, isImg2img=false })
// → { prompt, negative, parts }
// parts: { mode, prefix, scene_image_prompt, location_tags, atmosphere_tags,
//           character_block, clothing_block, suffix, nsfw_tier, nsfw_tags,
//           lora_tags, negative }

composeEnhancedScenePrompt({ prefix, body, clothingBlock, suffix, loraTags })
// → string — joins segments in order, skipping empty ones. Used by image-pipeline.js
// to re-assemble the scene-image prompt after story-enhancer's advisory rewrite so the
// resolved scenario clothing block always survives (see "Post-audit fixes 2026-07-13d").
```

Clothing comes from scenario read order via `getScenarioClothing` (runtime -> starting -> character default).
Mood → atmosphere lookup table lives in prompt-builder.js (8 entries + aliases).
Arousal gating: levels 1–3 always SFW; 4–5 add suggestive tags if nsfw_enabled;
6–7 add explicit tags; 8–10 add explicit+hardcore. All gated behind `config.nsfw_enabled`.

### src/services/image-pipeline.js

Single entry point for all image generation. Called fire-and-forget from routes with `.catch()`.

```js
generate({ mode, scenarioId, turnId=null, characterId=null, opts={} })
// mode: 'scene' | 'portrait' | 'fullbody' | 'background'
// opts: { directPrompt?, rawPrompt?, locationId?, contextTurns? }
// → { ok, imageId, filename, savePath }
// Throws on failure (callers use .catch()); broadcasts image_error on failure
```

Pipeline stages (each writes an audit event with the same `pipeline_run_id`):

1. `resolve_config` — resolveEffectiveConfig(db)
2. `build_prompt` — prompt-builder.buildPrompt() using scene_card_json from turn row
3. `resolve_background` — read location's background_folder; pick default_background or random file; base64-encode
4. `a1111_call` — img2img (denoising 0.45) if background found, txt2img otherwise
5. `file_verify` — fs.existsSync(savePath)
6. `persist` — INSERT scene_images row (skipped for 'background' mode)
7. `broadcast` — image_ready WS event (skipped for 'background' mode)

Background mode saves to `BACKGROUNDS_DIR/{locationSlug}/{timestamp}.png`. The calling
route saves the generated file into `BACKGROUNDS_DIR/{background_folder}/`.

`buildA1111Payload(config, prompt, negative, referenceImageBase64=null)` and
`callA1111(baseUrl, mode, payload, savePath)` (retry-on-VAE-failure wrapper) are exported
from this module and reused by `routes/characters.js` for Character Editor reference-image
and full-body generation, so those paths get the same VAE override and retry behavior as
scene/character generation instead of a separately-maintained payload builder (see
"Post-audit fixes 2026-07-13d").

### src/services/prompt-preview.js - LIVE

```js
buildPromptPreview(db, { scenarioId, turnId, target, characterId })
// target: 'scene' | 'character'
// → { summary_plain, summary_tags, turn_id, target, character_id? }
```
Backs `POST /api/scenarios/:id/images/prompt-preview`, called from the Play view's Prompt
Panel (`public/js/play/prompt-panel.js`) when a character chip is selected. For
`target: 'character'`, the character row is passed through
`applyResolvedClothing(rawChar, getScenarioClothing(scenarioId, rawChar.id))`
(`src/services/prompt-resolution.js`) before extraction, so the preview text reflects the
same scenario-scoped clothing the actual generation pipeline uses rather than the legacy
`characters.current_clothing` card field (see "Post-audit fixes 2026-07-13d").

Regression-tested (CF-3, 2026-07-13e): `src/services/__tests__/prompt-preview.test.js`
captures the actual text sent to the extractor's Ollama call and asserts it contains the
scenario-resolved clothing, not the legacy card field; also asserts `prompt-preview.js`
and `image-pipeline.js` produce identical output from `applyResolvedClothing`/
`getScenarioClothing` for the same scenario+character (one clothing source, not two).


### src/services/visual-brief.js - LIVE (2026-07-13h)

**Job change (not storage-only):** Extracts structured camera-visible state after every narrator turn (after clothing apply). Stored at `turns.scene_card_json.visual_brief` — exact column name `scene_card_json`.

**Replaces scene summarization for image generation.** `image_prompt` / prose `summary_plain` as image fodder are **legacy fallback only**.

Schema fields: `main_subject`, `moment_summary`, `setting_brief`, `shot_hint`, `character_briefs[]` (sparse; include only visible/involved/relevant characters; `character_id` attached when name resolves).

Extractor input includes resolved current clothing via `resolveScenarioClothingMap`.

Consumers:
- `turns.js` — extract + persist post-clothing
- `image-pipeline.js` — scene: prefer brief (`main_subject` = FaceID/focus priority); character: current-turn brief → prior brief → generic (description + clothing + location + simple pose). No live picker when brief present.
- `prompt-preview.js` — scene/character panels read stored brief; no whole-scene LLM summary when brief exists

**Play Character Image UI (`prompt-panel.js`):** Plain English Summary = selected `character_brief` (current → prior → generic pose). Image Prompt Tags = locked description + resolved clothing + brief + setting/shot. No whole-scene re-summarization when a stored brief exists.

### src/services/scene-picker.js - LIVE (Phase 9 Stage 2a)

Advisory visual-moment selector for scene images. `pickBestMoment()` calls Ollama `chat()` with:
- stronger system contract (`PICKER_SYSTEM`)
- `format: buildPickerJsonSchema(nsfwEnabled)` (JSON Schema structured output)
- `options.temperature: 0.1`

Returns a candidate object or `null` (never throws). `resolvePickerContextTurns()` prefers the clicked `[Img]` turn text over flooding recent turns.

### src/services/tag-dialect.js - LIVE (2026-07-13g)

Shared SD tag dialect helpers used by `prompt-extractor` and `regenerate-tags` (`buildSceneTagSystem`, `buildCharacterTagSystem`, `buildRegenTagSystem`, forbidden-gaze list, count bounds).

### src/services/character-state.js - emotional updates (2026-07-13g)

`processEmotionalUpdateAfterTurn` calls Ollama `generate()` with a separate `system` prompt, `format: EMOTION_JSON_SCHEMA` (`{ updates: [{ characterId, moodDelta, arousalDelta }] }`), and `temperature: 0.1`. Parser accepts the wrapped `{ updates: [...] }` shape (and still tolerates a bare array if the model returns one).

### src/services/prompt-extractor.js - LIVE

Ollama `generate()` image prompt / tag extraction (character preview, regenerate-tags, advisory fallbacks).
Narrator still writes the ---SCENE--- block inline; `input-parser.parseNarratorResponse()` parses it.
Legacy filename `extractor.js` was never created.

**Tag dialect (2026-07-13g):** scene + character tag system prompts are built from `src/services/tag-dialect.js` (`buildSceneTagSystem`, `buildCharacterTagSystem`) so gaze bans (`looking at viewer` / `looking at camera` / `facing camera` / `posing`), tag-count bounds, duration bans, and environment rules stay identical across entry points. Prefer averted / off-screen gaze; do not allow viewer-gaze as a character exception.

### src/services/story-enhancer.js - LIVE (Phase 9 Stage 2b)

Advisory SDXL prompt rewrite after deterministic prompt-builder assembly.
On success, image-pipeline re-wraps with master/profile prefix, suffix, LoRA tags, and master_negative.
On failure / no model: falls back to the deterministic prompt.

**System prompt contract (2026-07-13g):** `SDXL_STORY_SYSTEM_PROMPT` is a short rigid 3-line output contract (positive / blank / `Negative prompt:`) with one `BREAK`, <=100 words, <=3 weights - not a tutorial-style encoder essay. `NSFW_ADDENDUM` remains a short explicitness addendum when NSFW is active. Existing output validators still apply.

**Clothing preservation (2026-07-13d):** `story-enhancer` only ever receives clothing as
loose scene-description context (`pickedMoment.clothingState`, often absent) — it is
advisory prose, not authoritative. The re-wrap step in `image-pipeline.js` always appends
the scenario-resolved `parts.clothing_block` (captured from `buildPrompt()` before this
stage runs) via `composeEnhancedScenePrompt()`, regardless of what the enhancer wrote.
This guarantees `getScenarioClothing`'s read order (below) actually reaches the final
A1111 prompt for scene-image generation, not just the pre-enhancer draft. The `build_prompt`
audit event now also logs `enhancer_applied` plus pre/post prompt snippets so this is
verifiable from the audit trail instead of only inspecting `parts`.
Legacy filename nhancer.js was never created.


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

**Read order** (`getScenarioClothing` / narrator / scene + character image prompts):
1. `scenario_character_state.current_clothing` (runtime)
2. `scenario_characters.starting_clothing` (setup selection)
3. Character default (`default_outfit` / matching set in `outfit_sets`)

This read order is guaranteed to reach the final A1111 prompt as of 2026-07-13d — see
"Clothing preservation" under `story-enhancer.js` above. Before that fix, scene-image
generation (the default/auto path) could silently lose this resolved clothing when the
advisory story-enhancer stage rewrote the prompt; character-focused generation was
never affected (it bypasses story-enhancer entirely).

Regression-tested (CF-1, 2026-07-13e): `src/services/__tests__/image-pipeline.integration.test.js`
calls the real `generate()` end-to-end (mocked A1111/Ollama, real in-memory DB) and asserts
the final prompt/`scene_images.prompt_used` still contains the authoritative clothing after
Stage 2b, that character mode never calls the picker/enhancer at all, and that the
`build_prompt` audit event's `enhancer_applied`/snippet fields are accurate. See "Testing" above.

Exports: `parseClothingSets`, `findClothingSet`, `getScenarioClothing`, `setScenarioRuntimeClothing`, `setScenarioStartingOutfit`, `resolveScenarioClothingMap`, `applyClothingChanges`.

`src/services/prompt-resolution.js` (new, 2026-07-13d) holds pure helpers shared between
`image-pipeline.js` and `prompt-preview.js` that consume `getScenarioClothing`'s output:
`applyResolvedClothing(character, clothing)` — returns a copy of `character` with
`current_clothing`/`base_clothing` set to the resolved value — and
`resolvePrimaryCharacterForReference(...)` (see FaceID section below).


### src/services/audit.js

```js
audit({ pipeline_run_id, service, stage, status, message,
        input, output, error, duration_ms, token_estimate,
        scenario_id, turn_id, scene_image_id })
// → void — writes to audit_events DB + AUDIT_LOG_PATH jsonl; never throws
```

---

## Route Layer (as implemented)

All nested routers use `mergeParams: true` so `:scenarioId` is accessible inside them.

| Route file | Mount point | Endpoints |
| --- | --- | --- |
| `health.js` | /api/health | GET /, /ollama, /a1111, POST /test-log (broadcasts one `logline` event — manual/automated verification for the WS log panel) |
| `config.js` | /api/config | GET /, POST /, POST /batch |
| `profiles.js` | /api/profiles | GET /, POST /, PUT /:id, DELETE /:id, POST /:id/activate, DELETE /active |
| `scenarios.js` | /api/scenarios | GET / (enriched: character_count, last_turn_at, characters[]), POST /, GET /:id, PUT /:id (dynamic SET), DELETE /:id, GET /:id/scene-card (debug), POST /:id/reset-scene (clear latest scene_card_json) |
| `turns.js` | /api/scenarios/:id/turns | GET /, POST /, DELETE /:id |
| `characters.js` | /api/characters | GET /, POST /, GET /:id, PUT /:id, DELETE /:id, PATCH /:id/clothing, GET /:id/references, DELETE /:id/references/faceid, DELETE /:id/references/:refId, POST /:id/references/generate, POST /:id/references/upload, POST /:id/references/:ref/accept, PATCH /:id/faceid-config, GET /:id/fullbody, POST /:id/fullbody/generate, DELETE /:id/fullbody/:fbId, POST /:id/fullbody/:fbId/set-default, POST /:id/fullbody/:fbId/use-as-ref |
| `scenario-characters.js` | /api/scenarios/:scenarioId/characters | GET / (roster + starting/runtime clothing), POST /:charId (add + `clothing_set_name`), PATCH /:charId/clothing, DELETE /:charId |
| `locations.js` | /api/scenarios/:id/locations | GET /, POST /, GET /:id, PUT /:id, DELETE /:id, GET /:id/backgrounds, POST /:id/generate-background, POST /:id/backgrounds/:f/set-default, DELETE /:id/backgrounds/:f |
| `memories.js` | /api/scenarios/:id/memories | GET /, POST /, DELETE /:id |
| `world.js` | /api/scenarios/:id/world | GET /, POST /, PUT /:id, DELETE /:id |
| `rules.js` | /api/scenarios/:id/rules | GET /, POST /, PUT /:id, DELETE /:id |
| `images.js` | /api/scenarios/:id/images | GET /, POST /generate, PUT /:id/accept, PUT /:id/rate, DELETE /:id |
| `a1111.js` | /api/a1111 | GET /models, GET /loras, GET /status, GET /samplers, GET /schedulers, POST /model |
| `audit.js` | /api/audit | GET / (filters: scenario_id, service, level, limit), GET /:runId |
| `character-relationships.js` | /api/scenarios/:scenarioId/relationships | GET /, POST /, PUT /:id, DELETE /:id |

Static routes: `/story-images` → `H:\MEDIA\Story_Lab\images`, `/story-backgrounds` → `H:\MEDIA\Story_Lab\backgrounds`

Routes NOT implemented: /api/styles (Styles UI quarantined — use Image Profiles). Character portrait/fullbody generation EXISTS via /api/characters/... but uses a simpler direct A1111 path (not the full scene pipeline).

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

Images are NOT auto-generated on turn advance. Trigger via POST /api/scenarios/:id/images/generate.
| `world-entries.js` | CRUD /world-entries |
| `rules.js` | CRUD /rules |
| `styles.js` | CRUD /styles, GET/POST /scenarios/:id/active-style |
| `locations.js` | CRUD /locations, POST /locations/:id/backgrounds (upload background image), DELETE /locations/:id/backgrounds/:file, POST /locations/:id/backgrounds/:file/set-default |
| `config.js` | GET /config, PUT /config (global_config key/value) |
| `audit.js` | GET /audit (filterable), GET /audit/:runId (full pipeline trace) |
| `profiles.js` | GET /profiles, POST /profiles, PUT /profiles/:id, DELETE /profiles/:id, POST /profiles/:id/activate, DELETE /profiles/active |

---

## Testing

**Run the suite:** `npm test` (runs `node --experimental-sqlite --experimental-test-module-mocks --test` with no path arguments — Node's built-in test runner recursively discovers every `*.test.js` file under the repo on its own; no glob patterns are passed, so this works identically in cmd.exe/PowerShell/bash). As of the clothing/FaceID audit wrap-up the suite is 98 tests across 14 files, all green, zero real external dependencies (no A1111, no Ollama, no writes to the real `story-lab.db`).

**Stack:** `node:test` + `node:assert/strict` only — no Vitest, no Jest, no Supertest, no jsdom. This is a deliberate project rule (`CLAUDE.md`: "No new npm dependencies. Core stack: express, ws, cors only"), not an oversight. Route tests use Node's built-in `http.createServer` + global `fetch` instead of Supertest.

**Two required experimental flags** (already baked into `npm test`, but needed if you invoke `node --test` directly):

- `--experimental-sqlite` — required by `db.js` (`node:sqlite`'s `DatabaseSync`), same as `npm start`.
- `--experimental-test-module-mocks` — required for `node:test`'s `mock.module()`, used to redirect `src/paths.js`'s `DB_PATH` to `':memory:'` in DB-touching tests (see below). Without this flag `mock.module` doesn't exist on the mock tracker and those test files throw `TypeError: mock.module is not a function` immediately.

**Test file layout:**

- `src/services/__tests__/*.test.js` — service-layer unit and integration tests.
- `src/routes/__tests__/*.test.js` — Express route tests (real router, real HTTP, mocked A1111/Ollama).
- `public/js/__tests__/*.test.js` — pure browser-view logic extracted into DOM-free modules (e.g. `outfit-sets-validation.js`) so it's testable the same way as backend code; these files are also imported directly by the browser view, unmodified.

**The "redirect the real DB to `:memory:`" pattern** (used by any test that needs `characters`/`scenarios`/`turns`/etc. rows) — this is the one non-obvious piece of infrastructure in the suite, worth understanding before adding a new DB-touching test:

```js
import { test, mock } from 'node:test';
// ... build a temp dir + DIRS object (images/backgrounds/audio/data) ...
mock.module('../../paths.js', {   // path relative to THIS test file — resolves to the
  namedExports: {                  // same canonical src/paths.js regardless of which
    DB_PATH: ':memory:',           // module (db.js, image-pipeline.js, ...) imports it
    IMAGES_DIR: dirs.images, /* ...all other paths.js exports... */
  },
});
const { default: db } = await import('../../db.js');       // NOW import — see below
const { generate } = await import('../image-pipeline.js');  // dynamically, after mocking
```

`db.js` does `new DatabaseSync(DB_PATH)` and runs its full real `CREATE TABLE` schema at
module-import time. Pointing `DB_PATH` at `:memory:` before that first import gives every
test file a completely real, always-in-sync (zero schema drift) but fully isolated
database — nothing is hand-faked or duplicated.

**Two ordering rules that matter — get either wrong and tests silently do the wrong thing without failing loudly:**

1. **`mock.module()` must run, and the target module must be dynamically `import()`-ed, before any other code in the file imports it.** Static `import db from '../../db.js'` at the top of a test file executes during module linking, *before* any of the file's own top-level statements (including a `mock.module()` call) run — so a static import would load the real production DB regardless of a mock declared below it. Every DB-touching test file in this suite uses `await import(...)` (dynamic, after the mock) instead of a static `import` for `db.js` and anything that transitively imports it.
2. **`mock.module()` only takes effect once per resolved module URL, at first import, for the life of the process/test file.** Node caches ES modules by URL; calling `mock.module()` again later in the *same file* does not retroactively change an already-loaded module's already-resolved bindings. Concretely: mock `paths.js`/`db.js`/`ollama.js` **once**, at the top of the file (module scope, not inside individual `test()` callbacks), and have every `test()` in that file share the one resulting DB/module instance, scoping each test's own assertions by the specific scenario/character IDs it just seeded (never assume "the only row"). An earlier draft of `scene-picker.test.js` got this wrong — it called `t.mock.module('../ollama.js', ...)` *inside* each `test()` body; the first test's import of `scene-picker.js` cached its `chat` binding permanently, so every later test's "fresh" mock was silently ignored and those tests were actually hitting the real (unreachable) Ollama endpoint at `127.0.0.1:11434` and passing only because a 404/connection failure happened to also produce the `null` return value the test expected. Fixed by mocking `globalThis.fetch` per-test instead (see next point) — the bug is called out in a comment in that file as a warning against reintroducing the pattern.

**Mocking the actual network boundary (A1111 / Ollama):** both `src/services/a1111.js` and `src/services/ollama.js` call the **global** `fetch()` directly (not a wrapped/injectable client). This is what makes per-test mocking reliable: `t.mock.method(globalThis, 'fetch', async (url, init) => {...})` replaces a plain global property lookup, which every caller re-reads at call time — unlike `mock.module()`, this correctly resets between tests via `t`'s own auto-restore, so each `test(async (t) => {...})` in a file can install its own distinct fetch behavior. Route-level tests capture the local Express server's *own* real, pre-mock `fetch` reference (`const realFetch = globalThis.fetch` at file top, before any mocking) to call the server under test, since the mocked global `fetch` is reserved for intercepting the route's *internal* outbound A1111 call.

**What is and isn't covered:**

- CF-1 (story-enhancer clothing preservation), CF-2 (FaceID reference character selection), CF-3 (Prompt Preview clothing source), and CF-4 (shared A1111 payload/call helpers) each have dedicated regression tests — pure-function tests where sufficient, real `generate()`/route-level integration tests where the guarantee is about orchestration/wiring, not just an isolated helper. See "Post-audit fixes" sections below for exactly which files.
- CF-5 (Character Editor's raw outfit-sets JSON silently discarding invalid input) is fixed and tested — see `public/js/outfit-sets-validation.js`.
- CF-A1 through CF-A6 (the A1111-native FaceID/IP-Adapter rewrite: explicit module resolution, no fabricated model default, fail-open ControlNet retry, honest single-reference-only, per-mode weight/timing, TTL-bound preflight validation) are fixed and tested — see `src/services/ipadapter-resolution.js`, `src/services/__tests__/ipadapter-resolution.test.js`, `src/services/__tests__/a1111-payload.test.js`, `src/services/__tests__/a1111-call.test.js`, `src/services/__tests__/image-pipeline.integration.test.js`, and `public/js/__tests__/faceid-ui-honesty.test.js`. See the "FaceID / IP-Adapter" section under Image Generation Architecture for the full behavior.
- CF-8 (dead Images-page gallery code) and CF-10 (opposite clothing-route `runtime` defaults) are **fixed + tested** in the wrap-up pass — see `images-quarantine.test.js` and `clothing-runtime.routes.test.js`. CF-6/CF-9 closed in the earlier docs alignment. CF-7 resolved in 2026-07-13f (UI removal). CF-11 fixed+tested in 2026-07-13f. **Remaining intentional tech debt: CF-12** (misc unused helpers / reset-scene clothing scope) — documented below under "Current Status / How to test" and in the audit status overlay.
- No browser/E2E testing exists or is planned here; UI wiring beyond the extracted pure `outfit-sets-validation.js`/`faceid-ui-honesty.test.js`-guarded logic (e.g. Character Editor DOM behavior, Play UI rendering of `controlnetFallback`, Settings module/model dropdowns) is unverified by this suite and still requires manual testing per this project's one-function-workflow discipline. In particular: nobody has run a real generation against a live A1111 + ControlNet instance since the `ip-adapter-auto` → explicit-module change — see the completion notes in "Post-audit fixes (2026-07-13f)" below for what should be manually verified first. For the final done/optional split, see **Handoff / Current Status** at the end of this doc.

---

## Image Generation Architecture


**FaceID / IP-Adapter (corrected 2026-07-13, A1111-native rewrite 2026-07-13f):** Accepting a character reference stores the relative path on `characters.reference_image_path` (and syncs `reference_image`). `image-pipeline` loads `reference_image_path || reference_image` from under `IMAGES_DIR` when `ipadapter_enabled` is on. Missing files are logged and skipped (generate continues without FaceID).

**A1111 ControlNet unit shape (2026-07-13f — this is the real submitted payload, read this before touching any FaceID code):**

```js
payload.alwayson_scripts.controlnet = {
  args: [{
    enabled:        true,
    module,          // resolveIpAdapterModule() — see below. Never 'ip-adapter-auto'.
    model:           config.ipadapter_model,   // verbatim; never a fabricated default
    weight,          // ipAdapterTuningForMode() — differs by mode, see below
    image:           referenceImageBase64,
    guidance_start,  // ipAdapterTuningForMode()
    guidance_end,    // ipAdapterTuningForMode()
    control_mode:    0,   // "Balanced"
    pixel_perfect:   true,
  }],
};
```

- **module** — `src/services/ipadapter-resolution.js`'s `resolveIpAdapterModule({ configModule, checkpointModel })`. Config override (`config.ipadapter_module`, Settings dropdown fed live from `/controlnet/module_list`) always wins; otherwise falls back to `ip-adapter_clip_sdxl` or `ip-adapter_clip_sd15` based on whether `config.a1111_model`'s filename implies SDXL (`/xl/i` heuristic). **Never `'ip-adapter-auto'`** — that WebUI-only preprocessor alias is not reliably usable through the raw `/sdapi/v1/txt2img` API endpoint (confirmed against the sd-webui-controlnet extension's own API reference and real working API payload examples, which use explicit CLIP-vision module names — see `docs/audits/` for the research trail). If you're tempted to reintroduce it because it "works in the WebUI," that's exactly the trap: the WebUI's own JS resolves "auto" client-side before submission; the raw HTTP API does not.
- **model** — `config.ipadapter_model` verbatim, straight from Settings (`GET /controlnet-models`, live A1111 catalog). No fabricated default exists anywhere in this codebase anymore — an empty value means FaceID is treated as fully unconfigured (see preflight below), never submitted as a guessed model name.
- **weight / guidance_start / guidance_end** — `ipAdapterTuningForMode(mode, { weight, guidanceEnd })`. `mode === 'character'` (portrait/full-body, face fills more of the frame) uses the configured weight/`guidance_end` as-is. Any other mode (scene — wider, often multi-subject shots) multiplies weight by 0.7 and caps `guidance_end` at 0.5, so the reference can't overpower the whole composition. This is deliberately simple (one multiplier, one cap) — not per-shot-type-tuned beyond the character/scene split.
- **control_mode** — always `0` ("Balanced"). Not currently configurable.

**Preflight validation (2026-07-13f):** `getControlNetCatalog(baseUrl, { now, forceRefresh })` in `image-pipeline.js` fetches both `/controlnet/model_list` and `/controlnet/module_list` (via `a1111.js`'s `getControlNetModels`/`getControlNetModules`) and TTL-caches the result for 5 minutes (`CONTROLNET_CACHE_TTL_MS`) — a bad/offline first result does **not** stick forever (this replaces the old permanent-cache bug). `validateIpAdapterAgainstCatalog({ model, module }, catalog)` in `ipadapter-resolution.js` confirms both the configured model AND the resolved module actually exist in that catalog. `generate()` sets `config._controlnet_ready` from this check before calling `buildA1111Payload` — the controlnet block is only ever added when `_controlnet_ready === true`. If `config.ipadapter_model` is empty, the catalog fetch is skipped entirely (cheap early-out — there's nothing to validate). If validation fails for any other reason, FaceID is skipped for that image and the reason is logged (`ipadapter_skipped`) — never sent as a best-guess unit.

**Fail-open on payload rejection (2026-07-13f):** preflight validation catches most misconfiguration, but not everything (A1111 restarted mid-session, a stale cache within the 5-minute window, a ControlNet-extension-internal error). `callA1111()` in `image-pipeline.js` now classifies failures: if the payload included a controlnet unit AND the error message matches `/controlnet|ip.?adapter|preprocessor|script.*not found/i`, it retries **once** with only the `alwayson_scripts.controlnet` key stripped (preserving ADetailer/Hires/refiner — narrower than the pre-existing VAE-failure strip-everything retry) and returns `{ ..., controlnetFallback: true, controlnetFallbackReason }`. The image still generates, just without a face reference for that one call. This flag propagates to: `generate()`'s return value (`{ ok, imageId, filename, savePath, controlnetFallback }`), the `build_prompt`... `a1111_call` audit event (`controlnet_fallback`/`controlnet_fallback_reason`), and the `image_ready` WebSocket broadcast payload (`controlnetFallback`) — so the Play UI has what it needs to show "generated without FaceID" if it chooses to. Before this fix, any ControlNet-unit-level rejection killed the entire image generation (no distinction from a VAE/checkpoint failure).

**Reference character selection (2026-07-13d, corrected 2026-07-13e):** which character's
reference image is submitted is decided by `resolvePrimaryCharacterForReference({ mode,
resolvedChar, characters, mainSubject })` in `src/services/prompt-resolution.js`:

- `mode === 'character'` — always the character actually being generated (the same `char`
  object the prompt builder used, via `resolvedChar`), never a scene-based guess. Unaffected
  by `mainSubject` entirely — it's not even read on this branch.
- otherwise (scene mode) — matches a cast member's name against `mainSubject`, a **real**
  field: `scene-picker.js`'s `pickBestMoment()` always requests `mainSubject: 'primary
  character(s) or subject'` from the picker LLM (`baseSchema`, not nsfw-gated) and returns
  whatever the model produces. `image-pipeline.js` computes this in Stage 2a
  (`pickedMoment`) for every non-character, non-background generation where the picker
  actually runs, and passes `pickedMoment?.mainSubject` into the resolver at the FaceID
  reference-resolution call site. Matching is case-insensitive substring search over cast
  names, tried in cast (alphabetical) order — so if `mainSubject` names two cast members,
  whichever sorts first by name wins, not whichever appears first in the text.
- Falls back to the first non-player cast member (by name) when `pickedMoment` is null
  (picker skipped via `skipAdvisory`, no recent narrator turns, no picker model configured,
  or the Ollama call failed) or when `mainSubject` doesn't name any cast member.

**Corrected 2026-07-13e:** the 2026-07-13d fix originally read `sceneCard.characters_present`
instead of `mainSubject`. That field is never written by any code path — `narrator.js`'s
`SCENE_CARD_INSTRUCTION` schema and `scene-picker.js`'s schema both omit it — so every real
scene-mode generation silently took the fallback branch, reproducing the exact
alphabetical-first-NPC bug this fix was meant to close. Verified against 108 real
`scene_card_json` rows in the live DB: 0 contained `characters_present`. The resolver no
longer reads that field at all (there is a regression test guarding this:
`prompt-resolution.test.js` — "ignores a legacy/unused characters_present field").

Before either fix, FaceID always used `characters.find(c => c.role !== 'player') ||
characters[0]` — i.e. the alphabetically-first NPC — regardless of which character was
being generated or was actually in the scene. This is still a **single-reference**
system: only one IP-Adapter image slot exists, so multi-character scenes always submit
one character's face.

**Known limitation:** when the picker is skipped/unconfigured/fails, or when `mainSubject`
doesn't name a cast member in a way the substring match catches (e.g. a nickname, a
pronoun-only description, or multiple unnamed subjects), scene-mode generation still falls
back to the same first non-player cast member (by name) for every image — i.e. per-scene,
per-character FaceID accuracy for multi-NPC scenes depends entirely on the picker actually
running and naming someone in `mainSubject`. This is a real, disclosed limitation, not a
hidden one — do not describe this as "always picks the correct scene subject."

Regression-tested (CF-2, 2026-07-13e): `src/services/__tests__/image-pipeline.integration.test.js`
seeds a 2-NPC scenario where the alphabetically-first NPC is deliberately NOT the intended
subject, and asserts (via the base64 image bytes actually submitted in the ControlNet
payload) that character mode always matches the target character, that scene mode matches
the `mainSubject`-named character over the alphabetical one, that a legacy
`sceneCard.characters_present` value is ignored even when present, and that the documented
fallback (first non-player cast member) fires when no picker signal exists.

**Single-reference only, decided honestly (2026-07-13f):** `characters.faceid_ref_count` /
`faceid_ref_order` were saved by a "FaceID Slot Config" UI in the Character Editor
(slot-count dropdown + drag-to-reorder list) but were **never read anywhere** in
`image-pipeline.js` — only a single reference image (`reference_image_path`) was ever
submitted. That UI has been **removed**, not implemented, after tracing its actual origin:
its copy literally read *"How many reference images ComfyUI uses (matches
IPAAdapterFaceIDBatch inputcount)"* and *"will be sent to ComfyUI"* — unmodified
ComfyUI-era text referencing a ComfyUI custom node, left over from before this project
became A1111-only (see "Files NOT Carried Over from story-lab" — ComfyUI was dropped
entirely). Implementing real multi-reference support would require first resolving which
field is authoritative (`reference_image_path` vs. `faceid_ref_order`) and how per-unit
weight should be distributed across multiple simultaneous ControlNet units — a real
design decision, not a mechanical fix, so it was deliberately not attempted in this pass.
`characters.faceid_ref_count`/`faceid_ref_order` columns and the `PATCH
/:id/faceid-config` route remain in the schema/backend (harmless, unread) so no stray
caller 404s; do not build new features on them without implementing real multi-reference
ControlNet support end-to-end first. Regression-tested:
`public/js/__tests__/faceid-ui-honesty.test.js` fails loudly if the UI, the ComfyUI
copy, or the "InstantID" naming (a different, never-implemented face-consistency
technique that had also leaked into the UI copy) are reintroduced.

### Core Rule: One Pipeline for All Image Types — narrowed 2026-07-13f, read this carefully

**What is actually shared** (this part of the claim is true and regression-tested):
`image-pipeline.js`'s `buildA1111Payload()` and `callA1111()` are the single implementation
of "construct an A1111 request and call it, with retry-on-failure" — used by `generate()`
for scene/character-mode images AND by `routes/characters.js`'s reference/full-body
generation. There is exactly one place that knows how to build an A1111 payload
(`sd_vae` override, Hires.fix, ADetailer, refiner, ControlNet/IP-Adapter gating) and
exactly one place that knows how to call A1111 with VAE- and ControlNet-failure retry
logic. `config-resolver.js`'s config resolution chain is also shared by both callers.

**What is NOT shared** (the old wording implied more than this — corrected 2026-07-13f):
prompt construction, FaceID reference-character resolution, and persistence are **not**
unified. `routes/characters.js`'s reference/full-body routes build their prompt via a
separate `_assembleCharacterPrompt(char)` function (never `buildCharacterPrompt`/
`buildPrompt` from `prompt-builder.js`), never call `resolvePrimaryCharacterForReference`
(deliberately — always pass `referenceImageBase64 = null`, since a character can't
IP-Adapter-reference itself), and persist to `character_references`/`character_fullbodies`
(never `scene_images`). There is no `mode: 'fullbody'` or `mode: 'portrait'` value ever
passed into `generate()` — "full-body generation" is not a mode of the main pipeline at
all, it is a fully parallel code path that, as of 2026-07-13d/f, happens to share the
outbound-A1111-call layer with `generate()`. When `buildA1111Payload` is called from
these routes, `mode` defaults to `'scene'` (its 5th parameter) — harmless here since
`referenceImageBase64` is always `null` for these calls, so the mode-based IP-Adapter
weight/timing split (see FaceID section above) never actually applies to them.

**Character Editor reference/full-body generation (2026-07-13d, extended 2026-07-13f):**
`routes/characters.js`'s `POST /:id/references/generate` and `POST /:id/fullbody/generate`
previously built their own separate A1111 payload and called `a1111.txt2img()` directly,
missing the `sd_vae` override and VAE-failure retry logic that `image-pipeline.js` has.
They now import and call the same `buildA1111Payload()` / `callA1111()` exported from
`image-pipeline.js` (with `referenceImageBase64 = null`), closing that gap. This is the
one place outside `generate()` itself that touches A1111 payload construction, and it is
now backed by the same code, not a duplicate — see "What is NOT shared" above for the
parts of the pipeline this does *not* extend to.

Regression-tested (CF-4, 2026-07-13e/f): `src/services/__tests__/a1111-payload.test.js`
(pure `buildA1111Payload` behavior — sd_vae/Hires.fix/ADetailer/refiner/controlnet
gating, module resolution, per-mode tuning, `getControlNetCatalog` TTL caching),
`src/services/__tests__/a1111-call.test.js` (`callA1111`'s retry-on-VAE-failure path AND
retry-on-ControlNet-failure path, mocked fetch), and
`src/routes/__tests__/characters.routes.test.js` (both routes driven over real HTTP,
asserting the outbound A1111 payload actually carries the shared builder's `sd_vae`
override, that no self-referencing FaceID image is ever submitted, that a transient
ControlNet failure retries and succeeds, and that no local `_buildPayload` duplicate
exists in the route file's source).

### Config Resolution Chain

Effective config for any image generation request resolves in this order (later overrides earlier):

1. **Master settings** (`global_config` table) — structural constraints that apply to all generation. These cannot be overridden by profiles or scenarios:
   - A1111 URL
   - Active model / checkpoint
   - Generation method (txt2img — the only supported method for now)
   - Whether LoRAs are globally enabled or disabled
   - Hires.fix enabled/disabled
   - ADetailer enabled/disabled
   - Core sampler, scheduler, steps, CFG, dimensions

2. **Active profile** (`image_profiles` table, optional) — stylistic/behavioral overrides. A profile CAN override:
   - Prompt prefix fragment (hardcoded opening appended to all prompts when this profile is active)
   - Prompt suffix fragment
   - Specific LoRA files and strengths (only if LoRAs are globally enabled)
   - Number of generation steps (within master limits)
   - CFG scale
   - Negative prompt additions

   A profile CANNOT override:
   - Model/checkpoint
   - Generation method
   - Whether LoRAs are enabled globally
   - Hires.fix or ADetailer enabled state
   - A1111 URL

3. **Request context** — per-request assembled prompt content (characters, clothing, scene card, location). This is not a user-editable config layer — it is assembled by prompt-builder.js at generation time.

### Settings UI Rule

There is exactly ONE area in the Settings UI for image generation settings. It is labeled "Image Generation" and contains:
- All master settings (structural)
- Profile management (create, edit, delete, activate named profiles)

There is no image config scattered across scenario setup or other views. Scenarios do not have their own image config overrides — they use whichever profile is active (or no profile, falling back to master settings).

### Key Design Decisions

- **No extractor** — scene data comes from the narrator's `---SCENE---` block directly. Eliminates one LLM round-trip per turn.
- **No enhancer** — prompts are assembled deterministically from scene data + profile fragments. Image quality is controlled by profile configuration, not LLM rewriting.
- **img2img for backgrounds** — when a location has pre-generated backgrounds, pipeline passes the background as init image at denoising 0.45. Environment is set by the background; the generation only adds characters and action.
- **Mood lookup table** — `mood` from the scene card maps to static SDXL atmosphere tags via a plain object in `prompt-builder.js`. No probabilistic mapping, fully traceable.
- **arousal_level tiers** — narrator outputs `arousal_level` 1–10. Tiers 1–3 are always SFW. Tiers 4–7 require `nsfw_enabled = 1`. Tiers 8–10 require both `nsfw_enabled = 1` and `explicit_mode = 1` in `global_config`. Out-of-range values are clamped.

---

## Narrator Response Format

The narrator model outputs story text and structured scene data in a single response. No separate extractor LLM call is made.

### Response structure

The narrator is prompted to append a scene block at the end of every turn response:

```
[Story prose here...]

---SCENE---
{
  "image_prompt": "two women in a library, one sitting at a table reading, one standing by a shelf",
  "negative_prompt_additions": "blur, dark",
  "mood": "contemplative",
  "arousal_level": 1,
  "nsfw_elements": false,
  "clothing_changes": []
}
---END---
```

The prose and the `---SCENE---` block are separated by the delimiter. The narrator text stored in `turns.content_text` has the scene block stripped. The JSON is parsed and written to `turns.scene_card_json`.

### Scene card JSON schema

| Field | Type | Description |
| --- | --- | --- |
| `image_prompt` | string | Core scene description in SDXL tag-style prose |
| `negative_prompt_additions` | string | Scene-specific negative terms (appended to master negative) |
| `mood` | string | Scene mood word — mapped to atmosphere tags by prompt-builder.js |
| `arousal_level` | 1–10 | Explicit content intensity. Gated by master NSFW settings. |
| `nsfw_elements` | boolean | True if the scene contains NSFW elements |
| `clothing_changes` | array | `[{ character_name, new_clothing }]` applied to `scenario_character_state.current_clothing` via `applyClothingChanges` (also accepts `character_id`) |

### arousal_level tiers

| Level | Content tier | Master NSFW required |
| --- | --- | --- |
| 1–3 | SFW — no explicit content | none |
| 4–5 | Mild — suggestive, partially clothed | nsfw_enabled optional |
| 6–7 | Moderate — explicit but tasteful | nsfw_enabled = 1 |
| 8–10 | Explicit | nsfw_enabled = 1 + explicit_mode = 1 |

Prompt-builder.js reads `arousal_level` from scene_card and clamps it against master settings before injecting content-tier tags.

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
| Scene picker | Receives `config.nsfw_enabled === true` (not hardcoded) |
| Prompt-builder arousal tags | L1-3 empty; L4-7 need NSFW; L8-10 need NSFW+explicit; missing arousal defaults to **1** (not 8) |
| Settings UI | Scenario Safe Mode is in the wizard. Global `nsfw_enabled` / `explicit_mode` are in `global_config` (seeded true) and persist across restart, but there is **no** dedicated Image Generation toggle for them — change via `POST /api/config` or DB until a Settings control is added |

Boot no longer force-updates these keys to true.

## Prompt Assembly

`prompt-builder.js` assembles all image prompts deterministically. No LLM calls are made inside the assembly step.

### Assembly formula

**img2img mode** (location background available):

```
{profile.prompt_prefix}, {scene.image_prompt}, {atmosphere_tags}, {character_block}, {clothing_block}, {profile.prompt_suffix}
```

**txt2img mode** (no background — location image_tags appended):

```
{profile.prompt_prefix}, {scene.image_prompt}, {location.image_tags}, {atmosphere_tags}, {character_block}, {clothing_block}, {profile.prompt_suffix}
```

### Mood → atmosphere lookup table

| Mood | Atmosphere tags |
|---|---|
| `contemplative` | soft lighting, muted tones, quiet atmosphere |
| `tense` | dramatic lighting, high contrast, sharp shadows |
| `romantic` | warm golden light, soft bokeh, intimate framing |
| `action` | dynamic lighting, motion blur, energetic composition |
| `melancholy` | cool desaturated tones, overcast, diffuse light |
| `joyful` | bright warm light, vivid colors, open composition |
| `mysterious` | low key lighting, deep shadows, fog |
| `neutral` | natural lighting, balanced exposure |

Unrecognized mood strings fall through to `neutral`. The table lives as a plain object in `prompt-builder.js`.

### Negative prompt assembly

```
{master_negative}, {profile.negative_additions}, {scene.negative_prompt_additions}
```

### Parts breakdown (audit / in-memory only — not a `scene_images` column)

`parts` is attached to the in-memory `audit()` call and related audit-log events. It is **not** persisted as `scene_images.prompt_parts_json` (that column does not exist). `mode` is `"txt2img"` or `"img2img"` depending on whether a location background was resolved for the shot.

```json
{
  "mode": "img2img",
  "prefix": "...",
  "scene_image_prompt": "...",
  "location_tags": "...",
  "atmosphere_tags": "...",
  "character_block": "...",
  "clothing_block": "...",
  "suffix": "...",
  "nsfw_tier": 3,
  "lora_tags": "<lora:...>",
  "negative": "..."
}
```

---

## Location Background Images

Locations can store 1–5 pre-generated background images. When a background is available, the image pipeline switches from txt2img to img2img, passing the background as the init image. This improves environment consistency without needing to describe the location in full detail each time.


**Pipeline resolve (corrected 2026-07-13):** `_resolveBackground` reads `location_backgrounds` for the location (prefer `is_default`). If the table is empty but `locations.default_background` is set and the file exists on disk, that file is used and back-filled into the table. Missing files are skipped (`existsSync`). Scenario routes `generate-background` / set-default / delete maintain both the filesystem and `location_backgrounds`.

### Storage path

```
H:\MEDIA\Story_Lab\backgrounds\{background_folder}\
  Sarahs_room\bg_morning.png
  Beach\beach_sunset.png
  Campsite\campfire_night.png
```

`background_folder` is set directly on the location record — it is the literal folder name
under `BACKGROUNDS_DIR`, not derived from the location name.

### Pipeline behavior

When `resolve_background` stage runs (in `image-pipeline.js`):

1. Read `location.background_folder` from the location row
2. If `background_folder` is empty → `txt2img` (no background)
3. If `location.default_background` is set and the file exists at
   `BACKGROUNDS_DIR/{background_folder}/{default_background}` → use that specific file
4. Otherwise list all `.png`/`.jpg` files in `BACKGROUNDS_DIR/{background_folder}` and pick one at random
5. If folder does not exist or is empty → `txt2img`
6. Selected file is base64-encoded and passed to `a1111.img2img()` with `denoising_strength: 0.45`

Audit log message at this stage reports the selected filename, folder, and whether img2img or txt2img is used.

### A1111 img2img payload additions

```json
{
  "init_images": ["data:image/png;base64,..."],
  "denoising_strength": 0.45,
  "resize_mode": 1
}
```

All other fields (steps, cfg, sampler, dimensions, ADetailer) are identical to txt2img.

### GET /:id/backgrounds response

```json
{ "ok": true, "folder": "Sarahs_room", "files": ["bg1.png", "bg2.png"], "default_background": null }
```

Returns `{ ok: false, error: "No background folder set" }` if `background_folder` is empty.
Returns `{ ok: false, error: "Folder not found: ..." }` if folder does not exist on disk.

### Generated backgrounds

`POST /api/scenarios/:id/locations/:lid/generate-background` fires `image-pipeline.generate({ mode: 'background' })`.
Generated files are saved to `BACKGROUNDS_DIR/{background_folder}/` (falls back to location name slug if folder not set).

---

## Image Generation Flow

```
turns.js (advance/nudge)
  → image-pipeline.generateSceneImage()         [fire and forget, .catch → audit]
      → config-resolver.resolveEffectiveConfig() [audit: resolve_config]
      → prompt-builder.buildPrompt()             [audit: build_prompt]
        (scene_card_json already on turn row, set by narrator)
      → resolve background image                 [audit: resolve_background]
      → a1111.img2img() or a1111.txt2img()       [audit: a1111_call]
      → file verify                              [audit: file_verify]
      → db INSERT scene_images                   [audit: persist]
      → broadcast image_ready                    [audit: complete]
```

A1111 payload shape (txt2img):
```json
{
  "prompt": "...",
  "negative_prompt": "...",
  "steps": 30,
  "cfg_scale": 7.0,
  "width": 832,
  "height": 1216,
  "sampler_name": "DPM++ 2M SDE",
  "scheduler": "Karras",
  "seed": -1,
  "enable_hr": true,
  "hr_scale": 1.5,
  "hr_second_pass_steps": 20,
  "denoising_strength": 0.4,
  "hr_upscaler": "4x-UltraSharp",
  "override_settings": { "CLIP_stop_at_last_layers": 2 },
  "alwayson_scripts": {
    "ADetailer": {
      "args": [{ "ad_model": "face_yolov8n.pt", "ad_denoising_strength": 0.4 }]
    }
  }
}
```

LoRAs are injected into the prompt string: `<lora:SDXL-TouchofRealismV2-0506:0.65>`

---

## WebSocket Events

Connect: `ws://localhost:4090`

On connect: log only — no `queue_state` payload (corrected 2026-07-13).

Server → client events:

| Event | Payload |
|---|---|
| `image_status` | `{ message, scenarioId }` — progress update |
| `image_ready` | `{ filename, turnId, scenarioId, imageId }` |
| `image_error` | `{ error, scenarioId }` |
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

### settings.js — Image Generation panel (master settings + profiles)

Single unified panel. Two sub-sections:

**Master Settings (structural):**
- A1111 URL input + Test Connection button (GET /api/health/a1111)
- Active Model display + Change button (modal, queries /api/a1111/models)
- Generation method display (txt2img — read only for now)
- LoRAs globally enabled toggle
- Steps, CFG, Width, Height, Sampler, Scheduler
- Hires.fix collapsible: enable toggle, scale, steps, denoising, upscaler select
- ADetailer collapsible: enable toggle, model select, strength
- CLIP skip

**Profiles:**
- List of saved profiles with active indicator
- Create / Edit / Delete profile buttons
- Profile editor fields: name, description, prompt prefix, prompt suffix, negative additions, LoRA slots (2), steps override, CFG override
- "Set as Active" button per profile
- "Clear Active Profile" button

### style-creator.js

- Remove: workflow field (gone)
- Keep: all other fields unchanged (maps directly to A1111)

### scenario-setup.js

- Remove: workflow selector
- Add: optional per-scenario A1111 param overrides

### New: audit.js view (public/js/views/audit.js)

Accessible from Settings > Debug tab.
- Filter by scenario, status, service
- Grouped by pipeline_run_id
- Stage timeline with duration + JSON detail
- Replay Prompt button (copies visual_prompt_sent + params to clipboard)

### api.js — complete method list (as of 2026-06-14)

All methods return Promises. Frontend uses classic IIFE/globals via `window.API`.

**Health:**
```js
API.getHealth()
API.getHealthA1111()    // → { ok } — used by status dot polling (every 15s)
API.getHealthOllama()   // → { ok } — used by status dot polling (every 30s)
```

**Config:**
```js
API.getConfig()
API.setConfig(key, value)
API.setConfigs(kvArray)         // batch upsert
API.getLlamacppConfig()         // reads 'llamacpp_config' key from /api/config, JSON-parses it
API.saveLlamacppConfig(newCfg)  // POSTs { key: 'llamacpp_config', value: JSON.stringify(newCfg) }
```

**Scenarios:**
```js
API.listScenarios()
API.getScenario(id)
API.createScenario(data)
API.updateScenario(id, data)
API.deleteScenario(id)
```

**Characters (global — no scenarioId):**
```js
API.getCharacters()                          // GET /api/characters — all characters
API.getCharacter(id)                         // GET /api/characters/:id
API.createCharacter(data)                    // POST /api/characters
API.updateCharacter(id, data)               // PUT /api/characters/:id
API.deleteCharacter(id)                     // DELETE /api/characters/:id (global delete)
API.updateCharacterClothing(charId, data)   // PATCH /api/characters/:id/clothing
```

**Scenario roster (scenario-scoped — add/remove characters from a story's cast):**
```js
API.getScenarioCharacters(scenarioId)              // GET /api/scenarios/:id/characters
API.addCharacterToScenario(scenarioId, charId)     // POST /api/scenarios/:id/characters/:charId
API.removeCharacterFromScenario(scenarioId, charId) // DELETE /api/scenarios/:id/characters/:charId
```

**Character references and full-body images (global — charId only):**
```js
API.getReferences(charId)
API.generateReference(charId, body)
API.uploadReference(charId, file)         // multipart POST via upload() helper
API.acceptReference(charId, ref)          // ref = numeric character_references.id or filename
API.deleteReference(charId, refId)
API.clearFaceId(charId)                   // DELETE /references/faceid (route ordered before /:refId)
API.saveFaceIdConfig(charId, data)        // DEPRECATED/orphaned: PATCH /faceid-config still writes faceid_ref_* columns, but no UI calls this and generation never reads those fields (single-reference only; see FaceID section)
API.getFullbodies(charId)
API.generateFullbody(charId, body)
API.deleteFullbody(charId, fbId)
API.setDefaultFullbody(charId, fbId)
API.useFullbodyAsRef(charId, fbId)        // POST /fullbody/:fbId/use-as-ref — sets reference_image_path
```

**Turns:**
```js
API.getTurns(scenarioId)
API.postTurn(scenarioId, contentText)   // → { user_turn, narrator_turn }
API.deleteTurn(scenarioId, turnId)
```

**Images:**
```js
API.getImages(scenarioId, turnId?)
API.generateSceneImage(scenarioId, turnId)
API.acceptImage(scenarioId, imageId, data)
API.rateImage(scenarioId, imageId, rating)
API.deleteImage(scenarioId, imageId)
```

**Memories / World / Rules:**
```js
API.getMemories(scenarioId)
API.createManualMemory(scenarioId, content)   // posts { memory_type: 'manual', content }
API.deleteMemory(scenarioId, memId)
API.getWorldEntries(scenarioId)
API.createWorldEntry(scenarioId, data)
API.updateWorldEntry(scenarioId, entryId, data)
API.deleteWorldEntry(scenarioId, entryId)
API.getRules(scenarioId)
API.createRule(scenarioId, data)
API.updateRule(scenarioId, ruleId, data)
API.deleteRule(scenarioId, ruleId)
```

**Character relationships (scenario-scoped):**
```js
API.getRelationships(scenarioId)                      // GET /api/scenarios/:id/relationships
API.createRelationship(scenarioId, data)              // POST — data: { from_character_id, to_character_id, relationship_type, description, strength }
API.updateRelationship(scenarioId, relId, data)       // PUT /:id
API.deleteRelationship(scenarioId, relId)             // DELETE /:id
```

**Locations (scenario-scoped):**
```js
API.getLocations(scenarioId)
API.createLocation(scenarioId, data)
API.updateLocation(scenarioId, locId, data)
API.deleteLocation(scenarioId, locId)
API.getLocationBackgrounds(scenarioId, locId)
API.generateLocationBackground(scenarioId, locId)
API.setDefaultBackground(scenarioId, locId, filename)
API.deleteBackground(scenarioId, locId, filename)
```

**A1111:**
```js
API.getA1111Status()
API.getA1111Models()
API.getA1111Loras()
API.getA1111Samplers()    // → string[] — live from A1111 with fallback to hardcoded list
API.getA1111Schedulers()  // → string[] — live from A1111 with fallback to hardcoded list
API.setA1111Model(name)   // POSTs { model_name: name } to /api/a1111/model
```

**Profiles:**
```js
API.getProfiles()
API.createProfile(data)
API.updateProfile(id, data)
API.deleteProfile(id)
API.activateProfile(id)
API.clearActiveProfile()
```

**Audit:**
```js
API.getAuditLog(filters)
API.getAuditRun(runId)
```

---


## Image Summary Learning (actual as of 2026-07-13)

On successful scene image persist, `image-pipeline` freezes:
- `summary_plain_snapshot`, `summary_tags_snapshot`, `style_context_snapshot`

`PATCH .../images/:id/ratings` selects those columns (plus `turn_id`). If snapshots are empty (older images), it falls back to the turn's `scene_card_json`. `promoteExemplarsFromRating` respects boolean `summary_learning_enabled`. Exemplars feed later tag regeneration when learning is enabled.

## Known Stubs and Unimplemented Features

**Rule:** Stubs are last resort. Any code that exists but does not perform its stated job
must be marked in source with `// STUB: <description> — NOT FUNCTIONAL` and listed here.
When asked "is X implemented?" — stub present or file absent = NOT IMPLEMENTED, say so.
Never report a stub or an absent file as implemented.

### Services — absent from disk (no file, no code, no stub)

| Service | Why absent | What handles it instead |
| --- | --- | --- |
| `src/services/extractor.js` | Eliminated from design | Narrator writes `---SCENE---` block inline; `input-parser.parseNarratorResponse()` parses it |
| `src/services/clothing.js` | LIVE (scenario-scoped) | See clothing.js section; prompts use `getScenarioClothing` | FIXED note was: `prompt-builder.js` |

### Code stubs present (marked `// STUB` in source — not functional)

| Stub | Location | Notes |
| --- | --- | --- |
| `resolveClothing()` | `src/services/clothing.js` | Marked `// STUB: layered resolve unused...`. Unused; scenario runtime uses `applyClothingChanges` + `getScenarioClothing`. Do not delete in docs-only passes. |

### Routes — absent from disk (no file)

| Route file | Feature | Status |
| --- | --- | --- |
| `src/routes/styles.js` | Style preset CRUD + `/api/scenarios/:id/active-style` | NOT STARTED |

### API endpoints — not yet implemented

| Endpoint | Feature | Status |
| --- | --- | --- |
| Character portrait generation | POST /api/scenarios/:id/characters/:id/portrait | NOT STARTED |
| Styles CRUD | GET/POST/PUT/DELETE /api/styles | NOT STARTED — `styles` table exists in DB, route file absent |

### Frontend features — confirmed stubs (present in UI, not functional)

**Quarantined 2026-07-13:** #styles and #images show honest unavailable UI (no crash). Use Settings Image Profiles; scene images in Play. Face refs and fullbody management on the Characters page are **live** (not a stub) — generate/grid/accept/use-as-ref paths work via `/api/characters/...`.


| Feature | Location | Stub behavior |
| --- | --- | --- |
| Styles / style creator | settings.js, play.js | Toast: "not available in this version" |
| enhancePromptLab | settings.js | Pass-through only — copies raw prompt to enhanced textarea, no LLM call |
| Prompt Lab → Send to A1111 | settings.js `pl-send-btn` | Toast: "not available from Prompt Lab in this version" |
| Global rules | settings.js `loadGlobalRules` | Guidance message: "Rules are managed per-scenario" |

### Phases

| Phase | Status |
| --- | --- |
| Phase 1 — Foundation | **COMPLETE** |
| Phase 2 — LLM Clients and Config | **COMPLETE** |
| Phase 3 — Story Engine | **COMPLETE** |
| Phase 4 — Image Pipeline | **COMPLETE** |
| Phase 5 — Frontend wiring | **COMPLETE** — api.js rewritten + full stale-API audit (2026-06-14); 22 issues fixed, -718 lines, all ImageCore/ComfyUI refs removed; llamacpp narrator added |
| Phase 8 — Persistence audit + relationships | **COMPLETE** |
| Phase 9 — Story-aware image generation | **COMPLETE** (2026-06-15) |

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
| Images page dead code (CF-8) | Quarantine stub only; tested |
| Clothing `runtime` contract (CF-10) | Explicit boolean required; callers + route tests |
| ControlNet catalog TTL (CF-11) | 5-minute TTL; tested |
| FaceID/IP-Adapter rewrite (CF-A1…A6) | Explicit module, no fabricated model, fail-open retry, tested |

### Tests

- **Command:** `npm test`
- **Current count:** **128/128** after Character Image UI visual-brief field wiring. No A1111/Ollama/real DB.

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
4. Images page: quarantine empty-state only.
5. Characters: accept face ref + generate fullbody.

### Optional later (not required to resume play)

- Delete unused helpers (`getOptions`, etc.) in a dedicated cleanup.
- Product decision: should `reset-scene` also reset runtime clothing?
- Browser/E2E suite (never planned for this audit).

### Pointers

- Living behavior: `## Testing`, FaceID / IP-Adapter, Core Rule (this file).
- Historical FAIL snapshot + status overlay: `docs/audits/clothing-faceid-image-pipeline-audit-2026-07-13.md`.
