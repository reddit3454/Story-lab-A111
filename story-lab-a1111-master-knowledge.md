# Story-Lab-A1111 Master Knowledge Document

> **Purpose:** Complete authoritative reference for the story-lab-a1111 codebase.
> Hand this document to any coding model with codebase access to establish full
> project context before any task.
>
> **Status:** Phases 1–5 complete (as of 2026-06-14). Full stale-API audit done (2026-06-14);
> all ImageCore/ComfyUI references removed. llamacpp narrator support added.
> Characters decoupled from scenarios (2026-06-14): global `/api/characters` CRUD +
> `scenario_characters` join table + live cast management UI in wizard and play view.
> Server runs at port 4090.
> The source code is the ground truth for what is built. The Implementation Status
> section at the bottom tracks completed phases with exact API surface and notes.
> The "Known Stubs and Unimplemented Features" section lists everything that is absent
> or not yet functional — consult it before answering "is X implemented?"
> The design spec remains useful for intent and future phases.
>
> **Design spec:** `docs/superpowers/specs/2026-06-10-story-lab-a1111-design.md`
> **Original reference:** `E:\TheHub\projects\story-lab\` (do not modify)

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
- Narrator-driven scene data — narrator outputs story text AND a structured JSON scene block (`---SCENE---` ... `---END---`) in one response; no separate extractor LLM call needed
- Template-driven prompt assembly — image prompts assembled deterministically from narrator-supplied scene data + profile prefix/suffix; no LLM enhancer call in the image pipeline
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
      clothing.js                [PLANNED] clothing state resolution per character
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
| `public/js/views/styles.js` | View file; not routed to; styles backend not yet implemented |

---

## Database Schema

All tables use WAL, foreign keys ON, tuned PRAGMAs. Migrations use ALTER TABLE in try/catch.
The DB file lives at `H:\MEDIA\Story_Lab\data\story-lab.db` (see `src/paths.js` DB_PATH).

Tables are created in a single `db.exec(...)` block in `src/db.js`. Additive migrations
use individual `try { db.exec('ALTER TABLE ...') } catch (_) {}` calls after the main block.

### scenarios

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

### Tables NOT yet created (planned)

- `character_states` — per-scenario clothing/emotion state; clothing currently stored on `characters.current_clothing`
- `character_relationships` — relationship labels between character pairs

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

- **"Why was that image bad?"** — open `scene_images` row, read `prompt_parts_json`
- **"Did the enhancer run?"** — check `enhance_skipped` and `enhance_output`
- **"Which model was used?"** — check `a1111_model_hash` (catches silent model switches)
- **"What seed was that?"** — `a1111_seed` — actual A1111 seed, always reproducible
- **"Where did it fail?"** — filter `audit_log WHERE pipeline_run_id = 'x' AND status = 'failed'`
- **"Were the LoRAs applied?"** — `scene_images.loras_json`
- **"What was her clothing state?"** — `scene_images.character_states_json`
- **Replay any image** — `a1111_request_json` is the complete payload; POST it directly to A1111

---

## Service Layer

### src/services/ollama.js

Ollama HTTP client. All calls log via audit.

```js
chat(model, messages, options)    // → { content, duration_ms, token_estimate }
generate(model, prompt, options)  // → { content, duration_ms }
toolCall(model, messages, tools)  // → { result, raw, duration_ms }
listModels()                      // → string[] — cached 60s
```

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
buildSystemPrompt({ scenario, characters, rules, worldEntries, memories, config })
// → system prompt string
// 7 blocks: scenario system_prompt, characters (with clothing), rules, world entries,
//   memories, NSFW gate, ---SCENE--- instruction

resolveNarratorBackend(db)
// → { backend: 'ollama'|'llamacpp', port?, model }
// Reads 'llamacpp_config' JSON from global_config; checks narrator role's 'backend' field.
// Falls back to resolveNarratorModel(db) (Ollama) if not set.

llamacppChat({ port, messages, maxTokens })
// → string — response content
// POSTs to http://127.0.0.1:{port}/v1/chat/completions (OpenAI-compatible endpoint).

runNarratorTurn({ db, scenario, messages, turnNumber })
// → { story_text, scene_card, model_used, token_estimate }
// Loads characters/rules/world/memories from DB, builds system prompt.
// Calls resolveNarratorBackend(); routes to llamacppChat() or ollama.chat() accordingly.
// model_used = backend.model || `llamacpp:${backend.port}` (llamacpp) or ollama model name.
// Parses ---SCENE--- block. Never throws on parse failure — returns defaultSceneCard().
```

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
```

Clothing comes from `characters[].current_clothing` (flat string on the character row).
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

### src/services/extractor.js — NOT YET IMPLEMENTED

Planned: separate LLM call to extract structured scene card. Currently the narrator
writes the `---SCENE---` block inline; `input-parser.parseNarratorResponse()` parses it.

### src/services/enhancer.js — NOT YET IMPLEMENTED

Planned: Ollama-based SDXL prompt enhancement. Currently prompts are assembled
deterministically by prompt-builder with no LLM rewriting.

### src/services/clothing.js — NOT YET IMPLEMENTED

Planned: layered clothing state resolution. Currently `characters.current_clothing`
(flat string) is used directly by prompt-builder.

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
| `health.js` | /api/health | GET /, /ollama, /a1111 |
| `config.js` | /api/config | GET /, POST /, POST /batch |
| `profiles.js` | /api/profiles | GET /, POST /, PUT /:id, DELETE /:id, POST /:id/activate, DELETE /active |
| `scenarios.js` | /api/scenarios | GET /, POST /, GET /:id, PUT /:id, DELETE /:id |
| `turns.js` | /api/scenarios/:id/turns | GET /, POST /, DELETE /:id |
| `characters.js` | /api/characters | GET /, POST /, GET /:id, PUT /:id, DELETE /:id, PATCH /:id/clothing, GET /:id/references, DELETE /:id/references/faceid, DELETE /:id/references/:refId, POST /:id/references/generate, POST /:id/references/upload, POST /:id/references/:ref/accept, PATCH /:id/faceid-config, GET /:id/fullbody, POST /:id/fullbody/generate, DELETE /:id/fullbody/:fbId, POST /:id/fullbody/:fbId/set-default, POST /:id/fullbody/:fbId/use-as-ref |
| `scenario-characters.js` | /api/scenarios/:scenarioId/characters | GET / (roster list), POST /:charId (add), DELETE /:charId (remove) |
| `locations.js` | /api/scenarios/:id/locations | GET /, POST /, GET /:id, PUT /:id, DELETE /:id, GET /:id/backgrounds, POST /:id/generate-background, POST /:id/backgrounds/:f/set-default, DELETE /:id/backgrounds/:f |
| `memories.js` | /api/scenarios/:id/memories | GET /, POST /, DELETE /:id |
| `world.js` | /api/scenarios/:id/world | GET /, POST /, PUT /:id, DELETE /:id |
| `rules.js` | /api/scenarios/:id/rules | GET /, POST /, PUT /:id, DELETE /:id |
| `images.js` | /api/scenarios/:id/images | GET /, POST /generate, PUT /:id/accept, PUT /:id/rate, DELETE /:id |
| `a1111.js` | /api/a1111 | GET /models, GET /loras, GET /status, GET /samplers, GET /schedulers, POST /model |
| `audit.js` | /api/audit | GET / (filters: scenario_id, service, level, limit), GET /:runId |

Static routes: `/story-images` → `H:\MEDIA\Story_Lab\images`, `/story-backgrounds` → `H:\MEDIA\Story_Lab\backgrounds`

Routes NOT yet implemented: `/api/styles`, character portrait generation, scenario relationships.

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

## Image Generation Architecture

### Core Rule: One Pipeline for All Image Types

ALL image generation in story-lab-a1111 passes through the same pipeline regardless of image type. Character portraits, scene/story images, full-body images, and any future image type all use:

- the same `image-pipeline.js` entry point
- the same `config-resolver.js` config resolution chain
- the same `a1111.js` HTTP client
- the same `prompt-builder.js` assembly logic

The only difference between image types is the **mode** passed into the pipeline, which controls which prompt-building path is used (e.g. portrait vs. scene). The core infrastructure is shared.

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
| `clothing_changes` | array | `[{ character, change_description }]` applied to character_states |

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

### Parts breakdown (stored in scene_images.prompt_parts_json)

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

On connect: `{ type: "queue_state", data: { active: null, queued: 0 } }`

Server → client events:

| Event | Payload |
|---|---|
| `image_status` | `{ message, scenarioId }` — progress update |
| `image_ready` | `{ filename, turnId, scenarioId, imageId }` |
| `image_error` | `{ error, scenarioId }` |
| `command_response` | `{ message, success }` |
| `memory_saved` | `{ scenarioId, text }` |

No client → server WS messages.

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
API.saveFaceIdConfig(charId, data)        // PATCH /faceid-config — saves slot count + order
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

## Known Stubs and Unimplemented Features

**Rule:** Stubs are last resort. Any code that exists but does not perform its stated job
must be marked in source with `// STUB: <description> — NOT FUNCTIONAL` and listed here.
When asked "is X implemented?" — stub present or file absent = NOT IMPLEMENTED, say so.
Never report a stub or an absent file as implemented.

### Services — absent from disk (no file, no code, no stub)

| Service | Why absent | What handles it instead |
| --- | --- | --- |
| `src/services/extractor.js` | Eliminated from design | Narrator writes `---SCENE---` block inline; `input-parser.parseNarratorResponse()` parses it |
| `src/services/enhancer.js` | Eliminated from design | Prompts assembled deterministically by `prompt-builder.js` — no LLM rewrite |
| `src/services/clothing.js` | Not yet built | `characters.current_clothing` flat string used directly by `prompt-builder.js` |

### Routes — absent from disk (no file)

| Route file | Feature | Status |
| --- | --- | --- |
| `src/routes/styles.js` | Style preset CRUD + `/api/scenarios/:id/active-style` | NOT STARTED |

### API endpoints — not yet implemented

| Endpoint | Feature | Status |
| --- | --- | --- |
| Character portrait generation | POST /api/scenarios/:id/characters/:id/portrait | NOT STARTED |
| Scenario relationships | GET/POST/DELETE /api/scenarios/:id/relationships | NOT STARTED |
| Styles CRUD | GET/POST/PUT/DELETE /api/styles | NOT STARTED — `styles` table exists in DB, route file absent |

### Frontend features — confirmed stubs (present in UI, not functional)

| Feature | Location | Stub behavior |
| --- | --- | --- |
| Relationships panel | play.js `renderRelationshipsTab`, characters.js `renderRelationshipsPanel` | Renders "not yet implemented" empty state |
| Styles / style creator | settings.js, play.js | Toast: "not available in this version" |
| Full-body image management | characters.js `loadFullbodies` | Renders "not available in this version" empty state |
| enhancePromptLab | settings.js | Pass-through only — copies raw prompt to enhanced textarea, no LLM call |
| Prompt Lab → Send to A1111 | settings.js `pl-send-btn` | Toast: "not available from Prompt Lab in this version" |
| Global rules | settings.js `loadGlobalRules` | Guidance message: "Rules are managed per-scenario" |
| Scenario wizard Step 3 fields | scenario-setup.js `submitWizard` | Fields collected but backend silently discards `tone`, `premise`, `reply_length`, `lust_level`, `pacing`, etc. |

### Phases

| Phase | Status |
| --- | --- |
| Phase 1 — Foundation | **COMPLETE** |
| Phase 2 — LLM Clients and Config | **COMPLETE** |
| Phase 3 — Story Engine | **COMPLETE** |
| Phase 4 — Image Pipeline | **COMPLETE** |
| Phase 5 — Frontend wiring | **COMPLETE** — api.js rewritten + full stale-API audit (2026-06-14); 22 issues fixed, -718 lines, all ImageCore/ComfyUI refs removed; llamacpp narrator added |

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
- **`scenarios` schema** — only stores: `title, description, system_prompt, nsfw_enabled, narrator_model, context_turns`. Wizard fields (`tone`, `premise`, `reply_length`, `lust_level`, `pacing`, etc.) are silently discarded by the backend.
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
4. Implement character portrait generation endpoint
5. Implement relationships (backend route + frontend panels)
6. Implement scenario wizard → backend field persistence (backend schema change required)

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
