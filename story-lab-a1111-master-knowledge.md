# Story-Lab-A1111 Master Knowledge Document

> **Purpose:** Complete authoritative reference for the story-lab-a1111 codebase.
> Hand this document to any coding model with codebase access to establish full
> project context before any task.
>
> **Status:** Design complete — implementation not yet started (as of 2026-06-10).
> No source code exists yet. The design spec is the ground truth for what to build.
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

**What's unchanged from the original:**
- All `public/` frontend (HTML, CSS, JS views) — UI preserved as-is
- API surface compatibility — same endpoint paths and response shapes
- Ollama for narration, extraction, summarization, enhancement
- Port 4090

---

## Runtime Stack

| Item | Details |
|---|---|
| Runtime | Node.js 22.5+ (required for node:sqlite built-in) |
| Module system | ESM only — `"type": "module"` in package.json |
| Database | `node:sqlite` DatabaseSync (built-in, NOT better-sqlite3) |
| HTTP | Express 4.x |
| WebSocket | `ws` 8.x (singleton broadcaster) |
| LLM | Ollama at `http://localhost:11434` |
| Image gen | A1111 at `http://127.0.0.1:7860` |
| Dependencies | cors, express, ws — nothing else |

Start command: `node --experimental-sqlite --max-old-space-size=4096 src/server.js`

---

## A1111 Setup Requirements

### Extensions to install (via A1111 Extensions tab)

| Extension | Purpose | Required for |
|---|---|---|
| `sd-webui-adetailer` | Auto face-fix inpaint pass after generation | Face quality — install first |
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
| 4060 | asset-library (optional — status dot in top bar) |

---

## Directory Structure (Planned)

```
story-lab-a1111/
  src/
    server.js                    Entry point, Express + WS, route mounting
    db.js                        SQLite schema, migrations, all CRUD
    broadcast.js                 WS singleton broadcaster
    logger.js                    File logger with rotation (logs/story-lab-a1111.log)
    paths.js                     All filesystem path constants
    input-parser.js              Bracket/slash command parsing
    asset-logger.js              Writes asset-events.jsonl for asset-library
    model-profiles.js            MODEL_CTX map, censorship lists, NSFW-safe lists
    services/
      audit.js                   Central audit logger → audit_log + audit.jsonl
      ollama.js                  Ollama HTTP client (chat, generate, toolCall, listModels)
      a1111.js                   A1111 HTTP client (txt2img, models, loras, status)
      model-resolver.js          Picks narrator/extractor/summarizer models
      config-resolver.js         Resolves effective config: master → active profile → request
      narrator.js                Builds narrator context + calls Ollama
      extractor.js               Extracts structured scene card from narrator text
      enhancer.js                SDXL prompt enhancer via Ollama
      prompt-builder.js          Pure prompt assembly (returns { prompt, negative, parts })
      image-pipeline.js          Orchestrates full image generation flow
      clothing.js                Clothing state resolution per character
      character.js               Character appearance for prompt building
      memory.js                  Rolling summary, promotion, context assembly
    routes/
      health.js                  /health, /health/a1111, /health/ollama, /a1111/*
      scenarios.js               Scenario CRUD, image config, characters, relationships
      characters.js              Character CRUD, portrait generation
      turns.js                   advance, nudge, regenerate, extract-scene
      images.js                  accept, rate, delete, list
      memories.js                Manual memory CRUD
      world-entries.js           Lore CRUD
      rules.js                   Rules CRUD
      styles.js                  Style preset CRUD
      locations.js               Location CRUD
      config.js                  Global config (A1111 URL, default params)
      profiles.js                Image generation profile CRUD + activate/clear
      audit.js                   Query audit log
  public/                        Copied from story-lab, frontend unchanged
    index.html
    css/main.css
    js/
      app.js, api.js, constants.js, state.js, ui.js, utils.js
      views/
        characters.js, dashboard.js, images.js, play.js
        scenario-setup.js, settings.js, style-creator.js, styles.js
        audit.js                 New — debug viewer for generation audit log
  database/
    story-lab-a1111.db           SQLite database
  logs/
    story-lab-a1111.log          Server log (ASCII, 2MB rotation)
    audit.jsonl                  Generation audit log (JSON lines, one entry per event)
  asset-logs/
    asset-events.jsonl           Asset events for asset-library ingestion
  docs/
    superpowers/
      specs/
        2026-06-10-story-lab-a1111-design.md    Full design spec
      plans/
        (implementation plan — to be written)
  tests/
    services/                    node:test unit tests for pure services
    routes/                      Integration tests
  package.json
  module.json
```

---

## Database Schema

All tables use WAL, foreign keys ON, tuned PRAGMAs. Migrations use ALTER TABLE in try/catch.
The DB file is `database/story-lab-a1111.db`.

### Key design decisions vs. original story-lab

- No `generation_config` JSON blob — all A1111 params are real typed columns in `global_config`
- `scene_images` stores the complete A1111 request + response metadata (seed, model hash, all params)
- `character_states` is its own table — not entangled in scenario/turn columns
- `global_config` is a key/value table for A1111 defaults and system settings
- `audit_log` table captures every pipeline event (see Observability section)
- No video columns anywhere
- No workflow columns anywhere
- `image_profiles` table replaces scenario-level image config overrides — profiles are global named presets, not per-scenario. Scenarios do not store image config.
- Structural image settings (model, method, hires, adetailer) live only in `global_config` and cannot be overridden at any lower level.

### scenarios

```
id, title, setting, tone, premise
nsfw_enabled, ended_at, created_at
user_character_id → characters.id
reply_length, pacing, narrative_pov
lust_level, violence_level, explicitness_level, tone_modifier
llm_narrator_model, llm_extract_model   -- nullable, override global defaults
default_start
```

Image generation config is NOT stored per-scenario. All image settings come from
`global_config` (master) and the active `image_profiles` row (optional overrides).

### characters

```
id, name, description, appearance_notes
gender, hair_color, hair_style, body_type, breast_size, height
is_user_character DEFAULT 0
reference_image_path          -- for FaceID
created_at
```

### scenario_characters

```
scenario_id, character_id (composite PK, cascade deletes)
role DEFAULT 'npc'            -- 'user' | 'npc'
```

### turns

```
id, scenario_id, turn_number
speaker                       -- 'user' | 'narrator' | character name
content_text, raw_input
scene_card_json               -- extracted scene state (JSON)
prompt_strategy DEFAULT 'standard'
user_rating DEFAULT 0
created_at
```

### scene_images — full generation provenance

Every generated image gets a complete forensic record:

```
id, turn_id, scenario_id, filename

-- Prompt construction trace (every layer logged)
scene_card_json               -- raw extractor output
prompt_parts_json             -- { quality_anchor, prefix, characters[], clothing[],
                              --   actions[], environment, suffix, nsfw_block, lora_tags }
enhance_input                 -- exact string sent to Ollama enhancer
enhance_output                -- exact string returned (null if skipped)
enhance_skipped DEFAULT 0     -- 1 if skip_enhance or enhancer offline
visual_prompt_sent            -- final prompt A1111 actually received
negative_prompt_sent          -- final negative prompt

-- Complete A1111 request (reproduce any image exactly)
a1111_request_json            -- full payload: every param, every extension arg

-- A1111 response metadata
a1111_seed                    -- actual seed returned (never -1)
a1111_model                   -- checkpoint name
a1111_model_hash              -- model hash (catches silent model changes)
a1111_sampler, a1111_scheduler
a1111_steps, a1111_cfg
a1111_width, a1111_height
hr_enabled, hr_scale, hr_steps, hr_denoising
ad_enabled, ad_model, ad_strength
loras_json                    -- [{ file, strength }] actually injected
generation_time_ms

-- Character snapshot at generation time
character_states_json         -- clothing/emotion state for all characters

-- Quality
accepted DEFAULT 0
user_rating DEFAULT 0
quality_notes                 -- user annotations
created_at
```

### character_states — per-scenario live state

```
id, scenario_id, character_id (UNIQUE pair)
clothing_state_json           -- layered clothing state object
emotion DEFAULT 'neutral'
last_updated
```

### memory_summaries

```
id, scenario_id
summary_text, covers_turns_up_to
type DEFAULT 'auto'           -- 'auto' | 'manual'
tier DEFAULT 'short'          -- 'short' | 'long'
created_at
```

Memory tiering: after each auto summary, `promote()` in memory.js keeps 3 newest
short-tier rows and promotes older ones to long-tier.

### world_entries

```
id, scenario_id (nullable = global)
title, content_text, trigger_keywords
is_constant DEFAULT 0
insertion_order DEFAULT 50
enabled DEFAULT 1
created_at
```

### rules

```
id, scope DEFAULT 'global'    -- 'global' | 'scenario' | 'character'
scope_id (nullable)
rule_text, priority DEFAULT 50
enabled DEFAULT 1
created_at
```

### styles

```
id, name, description
prefix, suffix, negative
a1111_steps, a1111_cfg, a1111_sampler, a1111_scheduler
lora1_file, lora1_strength, lora2_file, lora2_strength
created_at
```

### locations

```
id, name, description, image_tags
created_at
```

### image_profiles — named generation profiles

```
id, name, description
prompt_prefix               -- text fragment prepended to all prompts when active
prompt_suffix               -- text fragment appended to all prompts when active
negative_additions          -- extra negative prompt terms
lora1_file, lora1_strength
lora2_file, lora2_strength
steps_override              -- nullable, overrides master steps if set
cfg_override                -- nullable, overrides master CFG if set
is_active DEFAULT 0         -- only one profile can be active at a time
created_at
```

Only one profile may have `is_active = 1` at a time. When no profile is active,
generation uses master settings only. Profiles CANNOT override: model/checkpoint,
generation method, whether LoRAs are globally enabled, hires/adetailer enabled state,
A1111 URL.

### character_relationships

```
id, scenario_id, character_id, related_character_id
relationship_label
created_at
```

### global_config — A1111 defaults

Key/value store. Seed rows:

| Key | Default |
|---|---|
| `a1111_url` | `http://127.0.0.1:7860` |
| `a1111_model` | `realcartoonXL_v7.safetensors` |
| `a1111_steps` | `30` |
| `a1111_cfg` | `7.0` |
| `a1111_sampler` | `DPM++ 2M SDE` |
| `a1111_scheduler` | `Karras` |
| `a1111_width` | `832` |
| `a1111_height` | `1216` |
| `hr_enabled` | `1` |
| `hr_scale` | `1.5` |
| `hr_steps` | `20` |
| `hr_denoising` | `0.4` |
| `hr_upscaler` | `4x-UltraSharp` |
| `ad_enabled` | `1` |
| `ad_model` | `face_yolov8n.pt` |
| `ad_strength` | `0.4` |
| `clip_skip` | `2` |

### audit_log — universal pipeline audit

```
id, created_at
scenario_id, turn_id, scene_image_id (nullable context)
pipeline_run_id               -- UUID linking all events in one operation
service                       -- 'narrator'|'extractor'|'enhancer'|'prompt-builder'
                              -- |'a1111'|'clothing'|'memory'|'image-pipeline'|'system'
stage                         -- service-specific stage name
status                        -- 'start'|'success'|'skipped'|'failed'
message                       -- human one-liner
input_json                    -- what went in
output_json                   -- what came out
error_text                    -- stack trace if failed
duration_ms
token_estimate                -- for LLM calls
```

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
| narrator | model, token estimate, system block count, turn count, memory count | full response, duration |
| extractor | model, narrative text, characters | scene_card JSON, parse success/fail |
| enhancer | raw prompt, model | enhanced text, or skip reason |
| prompt-builder | scene_card, character states, effective config | full parts breakdown JSON |
| a1111 | complete request payload | seed, model_hash, generation_time_ms |
| clothing | character, current state, scene_card | resolved clothing string, resolution path taken |
| memory | trigger reason, turn range | summary text, model used, promotion events |
| model-resolver | scenario nsfw_enabled, overrides | resolved models, fallbacks used |
| image-pipeline | pipeline_run_id, scenarioId, turnId | final filename, or which stage failed |

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

### src/services/audit.js

Central audit logger. All services import this. Never throws — audit failures are console.error only.

```js
audit({ service, stage, status, message, input, output, error,
        duration_ms, token_estimate,
        scenario_id, turn_id, scene_image_id, pipeline_run_id })
```

Writes to `audit_log` table and appends to `logs/audit.jsonl` simultaneously.

### src/services/ollama.js

Ollama HTTP client. All calls log via audit.

```js
chat(model, messages, options)    // → { content, duration_ms, token_estimate }
generate(model, prompt, options)  // → { content, duration_ms }
toolCall(model, messages, tools)  // → { result, raw, duration_ms }
listModels()                      // → string[] — cached 60s
```

### src/services/a1111.js

A1111 HTTP client. Logs full request + response via audit.

```js
txt2img(payload)       // → { filename, seed, model_name, model_hash, generation_time_ms }
img2img(payload)       // → stubbed — reserved for ITERATE mode v2
getModels()            // → [{ title, model_name, hash }]
getLoras()             // → [{ name, path, alias }]
getProgress()          // → { active, progress, eta }
setModel(name)         // → void — switches active checkpoint via /sdapi/v1/options
getOptions()           // → current A1111 options object
```

Images are written to `H:\MEDIA\Story_Lab\{scenario_slug}\{timestamp}.png`.
LoRAs are injected into the prompt string as `<lora:filename:strength>` tags.
CLIP skip 2 is always set for SDXL.

### src/services/config-resolver.js

Resolves effective image config for any generation request. Resolution chain (later overrides earlier):
1. `global_config` master settings (structural — model, method, hires, adetailer, lora_enabled flag)
2. Active `image_profiles` row if one has `is_active = 1` (prompt fragments, specific LoRAs, steps/cfg overrides)
3. Request context assembled by prompt-builder.js (not a config layer — prompt content only)

Profiles cannot override structural master constraints (model, generation method, lora_enabled global flag, hires/adetailer enabled state).

```js
resolveMasterConfig(db)
// → flat master config object from global_config

resolveActiveProfile(db)
// → active image_profiles row or null

resolveEffectiveConfig(db)
// → merged config: master + profile overrides applied where permitted
```

### src/services/model-resolver.js

Picks LLM models for a scenario. Caches installed model list 60s.

```js
resolveModels(scenario)
// → { narratorModel, extractorModel, summarizerModel }
```

Resolution: scenario overrides → SFW/NSFW routing → fallback chain → installed check.
Throws clearly if NSFW scenario ends up with censored narrator.

SFW narrator: `gemma3:12b-it-q4_K_M` → fallback `hermes3:8b-llama3.1-q6K`
NSFW narrator: `l3-moe-champion` → fallback `dolphin3:latest`
Extractor: `dolphin3-tools:latest` → fallback `dolphin3:latest`
Summarizer: `hermes3:8b-llama3.1-q6K` → fallback `dolphin3:latest`

### src/services/narrator.js

```js
buildContext({ scenario, characters, turns, memories, worldEntries, relationships, sceneCard, location })
// → messages[] for Ollama chat

advance(context, userMessage, model)
// → { text, duration_ms }
```

Context assembly logged: turn count included, memory tiers used, world entries matched, token estimate.

### src/services/extractor.js

```js
extract({ narratorText, characters, scenario, model })
// → scene_card: { primary_subject, characters: [{ name, action, clothing_change }],
//                 environment, lighting, atmosphere }
```

Uses Ollama tool call for structured output. Falls back to minimal scene card on parse failure — never throws.

### src/services/enhancer.js

```js
enhance({ prompt, scenario, model })
// → { output, skipped, skip_reason, duration_ms }
```

Skips if: `skip_enhance=1` on scenario, or Ollama unreachable. Returns original prompt as output when skipped.

### src/services/prompt-builder.js

Pure prompt assembly — no LLM calls, no DB calls.

```js
buildPrompt({ sceneCard, characters, clothingStates, location, scenario, config })
// → { prompt, negative, parts }
// parts: { quality_anchor, prefix, characters[], environment, lighting,
//          suffix, nsfw_block, lora_tags }
```

The `parts` object is the full labeled breakdown stored in `scene_images.prompt_parts_json`.

### src/services/clothing.js

```js
resolve({ character, characterState, sceneCard })
// → string — resolved clothing prompt with SDXL weighting

applyChanges(scenarioId, characterId, changes, db)
// → updates character_states row
```

Resolution chain (first non-empty wins):
1. `clothing_state_json` layered fields on the character_states row
2. `current_clothing` flat string on the same row
3. Character `default_outfit` fallback

Logs which resolution level fired.

### src/services/character.js

```js
buildAppearanceBlock(character)
// → string — physical traits for SDXL prompt

buildPortraitPayload({ character, scenario, config })
// → complete A1111 txt2img payload object
```

### src/services/memory.js

```js
triggerIfNeeded(scenarioId, db)
// → { triggered, summary_id } | { triggered: false }
// Threshold: every 20 turns with >= 400 words across last 20 turns

summarize(turns, model)
// → summary_text

promote(scenarioId, keepRecent=3, db)
// → void — flips old short-tier rows to long-tier

buildContext(scenarioId, db)
// → { short[], long[], manual[] }
```

### src/services/image-pipeline.js

Single entry point for all image generation. Called as fire-and-forget from routes.

```js
generate({ mode, scenarioId, turnId, characterId, opts })
// mode: 'scene' | 'portrait' | 'fullbody'
// All modes pass through the same pipeline stages.
// Mode controls which prompt-building path prompt-builder.js uses.
// opts: { directPrompt?, rawPrompt?, contextTurns? }
```

Stages in order (all logged with same pipeline_run_id):
1. `extract` — extractor.extract()
2. `clothing_snapshot` — read character_states, snapshot for audit
3. `build_location` — read location row if set
4. `enhance` — enhancer.enhance()
5. `build_prompt` — prompt-builder.buildPrompt()
6. `a1111_call` — a1111.txt2img()
7. `file_verify` — confirm file exists on disk
8. `persist` — INSERT scene_images with all metadata
9. `broadcast` — send `image_ready` WS event

---

## Route Layer

Routes contain no business logic — validate input, call one service method, return result.

| Route file | Endpoints |
|---|---|
| `health.js` | GET /health, /health/a1111, /health/ollama; GET /a1111/models, /a1111/loras, /a1111/status; POST /a1111/model |
| `scenarios.js` | CRUD /scenarios, /scenarios/:id/characters, /scenarios/:id/image-config, /scenarios/:id/relationships |
| `characters.js` | CRUD /characters, POST /characters/:id/generate-reference, /characters/:id/generate-fullbody |
| `turns.js` | POST /turns/advance, /turns/nudge, /turns/extract-scene, /turns/generate-image; PATCH /scenarios/:id/turns/:id; POST /scenarios/:id/turns/:id/regenerate |
| `images.js` | GET /images, PUT /images/:id/accept, PUT /images/:id/rate, DELETE /images/:id |
| `memories.js` | GET /scenarios/:id/memories, POST /scenarios/:id/memories/manual, DELETE /scenarios/:id/memories/:id |
| `world-entries.js` | CRUD /world-entries |
| `rules.js` | CRUD /rules |
| `styles.js` | CRUD /styles, GET/POST /scenarios/:id/active-style |
| `locations.js` | CRUD /locations |
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

---

## Image Generation Flow

```
turns.js (advance/nudge)
  → image-pipeline.generateSceneImage()   [fire and forget, .catch → audit]
      → extractor.extract()               [audit: extraction]
      → clothing snapshot                 [audit: clothing_snapshot]
      → enhancer.enhance()               [audit: enhancement]
      → prompt-builder.buildPrompt()     [audit: prompt_assembly]
      → a1111.txt2img()                  [audit: a1111_call]
      → file verify                      [audit: file_verify]
      → db INSERT scene_images           [audit: persist]
      → broadcast image_ready            [audit: complete]
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

### api.js additions

```js
API.getA1111Status()
API.getA1111Models()
API.getA1111Loras()
API.setA1111Model(name)
API.getAuditLog(filters)
API.getAuditRun(runId)
API.getProfiles()
API.createProfile(data)
API.updateProfile(id, data)
API.deleteProfile(id)
API.activateProfile(id)
API.clearActiveProfile()
```

---

## Current Project State

| Item | Status |
|---|---|
| Design spec | Complete — `docs/superpowers/specs/2026-06-10-story-lab-a1111-design.md` |
| Implementation plan | Not yet written |
| Source code | Not yet written |
| A1111 installation | Present at `K:\stable-diffusion-webui` (fresh install, needs model path config) |
| SDXL models | Available at `E:\ComfyUI\models\checkpoints` |
| SDXL LoRAs | Available at `E:\ComfyUI\models\loras` |
| ADetailer extension | Not yet installed |
| ControlNet extension | Not yet installed |

### Next steps

1. Write implementation plan (`docs/superpowers/plans/`)
2. Configure A1111 to point at E:\ComfyUI\models (webui-user.bat)
3. Install ADetailer extension in A1111
4. Implement: Phase 1 (foundation) → Phase 2 (clients) → Phase 3 (services) → Phase 4 (routes) → Phase 5 (frontend)

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
