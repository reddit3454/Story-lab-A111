# story-lab-a1111 — Design Spec
Date: 2026-06-10
Status: Approved

---

## Context

story-lab is a local AI collaborative fiction tool (Node/Express, Ollama, port 4090).
The original version wired image generation through ImageCore → ComfyUI and was never
stable — images were unpredictable, the pipeline had never worked reliably end-to-end.

This project rebuilds the backend from scratch with AUTOMATIC1111 (A1111) as the image
backend. The LLM/narration/story side of the original works well and informs this design,
but is not copy-pasted — it is redesigned with the full feature picture known upfront.

## Goals

- Replace the broken ComfyUI/ImageCore image pipeline with direct A1111 REST API calls
- Redesign backend systems cleanly, knowing all features at once — no incremental debt
- Full observability: every process stage logged and stored with complete metadata
- Take advantage of A1111's native quality features (Hires.fix, ADetailer, ControlNet, FaceID)
- Keep the working frontend UI unchanged; maintain API surface compatibility
- Port: 4090 (same as original)

## What Changes vs. Original

Preserved:
- All public/ frontend (HTML, CSS, JS views) — UI is fine as-is
- API endpoint paths and response shapes (frontend compatibility)
- Ollama for narration, extraction, summarization
- Clothing system logic, character appearance, memory tiering, lore, rules

Rebuilt from scratch (informed by but not copied from original):
- All src/ backend — clean files, correct service boundaries
- DB schema — designed for all features at once, no legacy columns
- Image pipeline — A1111 only, one linear path, no workflow routing

Dropped entirely:
- imagecore.js, image-builder.js (ComfyUI middleware)
- video-wan2.js (Wan2.2 is ComfyUI-only)
- pose-library.js / pose-library route
- All ComfyUI workflow JSON references
- Batch FaceID multi-slot workflow routing
- generation_config JSON blob pattern

## Runtime Stack

- Node.js 22.5+ / ESM ("type": "module")
- node:sqlite DatabaseSync (built-in, no better-sqlite3)
- Express + ws
- Ollama at http://localhost:11434
- A1111 at http://127.0.0.1:7860
- No new npm dependencies beyond what story-lab already uses (cors, express, ws)

## A1111 Extensions / Models to Install

The design targets these quality features. Install before first use:

| Item | What it does | Where to get it |
|---|---|---|
| sd-webui-adetailer | Auto face-fix pass after generation — solves face quality entirely | A1111 Extensions tab |
| sd-webui-controlnet | Pose control for consistent composition | A1111 Extensions tab |
| sd-webui-faceid | Reference-image character consistency | A1111 Extensions tab |
| 4x-UltraSharp | Best upscaler for Hires.fix on SDXL | models/ESRGAN/ |
| OpenPose models | ControlNet pose detection | via ControlNet model downloader |
| IP-Adapter models | Required by FaceID extension | via FaceID extension instructions |

SDXL checkpoints and LoRAs: already at E:\ComfyUI\models\.
Point A1111 at them via webui-user.bat flags:
  --ckpt-dir E:/ComfyUI/models/checkpoints
  --lora-dir E:/ComfyUI/models/loras
  --esrgan-models-path E:/ComfyUI/models/upscale_models

---

## Section 1 — Architecture

```
User browser
    │
    ▼
public/ (Express static)
    │
    ▼
src/server.js  ──────────────────────────────────────────
    │                                                    │
    ├── src/routes/          (thin — validate + delegate)│
    │                                                    │
    ▼                                                    ▼
src/services/               src/broadcast.js (WS singleton)
    ├── audit.js             → ws://localhost:4090
    ├── ollama.js
    ├── a1111.js
    ├── model-resolver.js
    ├── narrator.js
    ├── extractor.js
    ├── enhancer.js
    ├── prompt-builder.js
    ├── image-pipeline.js
    ├── clothing.js
    ├── character.js
    └── memory.js
    │
    ▼
src/db.js (node:sqlite)
database/story-lab.db
```

Routes contain no business logic. They validate input, call one service method, return the result.

---

## Section 2 — Database Schema

All tables use DatabaseSync with WAL, foreign keys ON. Migrations are additive ALTER TABLE
in db.js — each in its own try/catch.

### scenarios
```sql
CREATE TABLE scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  setting TEXT,
  tone TEXT,
  premise TEXT,
  nsfw_enabled INTEGER DEFAULT 0,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Cast
  user_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,

  -- Pacing / style
  reply_length TEXT DEFAULT 'medium',
  pacing TEXT DEFAULT 'moderate',
  narrative_pov TEXT DEFAULT 'third',
  lust_level INTEGER DEFAULT 0,
  violence_level INTEGER DEFAULT 0,
  explicitness_level INTEGER DEFAULT 0,
  tone_modifier TEXT,

  -- LLM overrides (null = use global default)
  llm_narrator_model TEXT,
  llm_extract_model TEXT,

  -- Opening text
  default_start TEXT,

  -- Image config
  image_model TEXT,
  image_prefix TEXT,
  image_suffix TEXT,
  image_negative TEXT,
  aspect_ratio TEXT DEFAULT '2:3',
  skip_enhance INTEGER DEFAULT 0,
  style_id INTEGER REFERENCES styles(id) ON DELETE SET NULL,

  -- A1111 generation params (null = use global config)
  a1111_steps INTEGER,
  a1111_cfg REAL,
  a1111_sampler TEXT,
  a1111_scheduler TEXT,
  a1111_width INTEGER,
  a1111_height INTEGER,

  -- Hires.fix (null = use global config)
  hr_enabled INTEGER,
  hr_scale REAL,
  hr_steps INTEGER,
  hr_denoising REAL,
  hr_upscaler TEXT,

  -- ADetailer (null = use global config)
  ad_enabled INTEGER,
  ad_model TEXT,
  ad_strength REAL,

  -- LoRAs
  lora1_file TEXT,
  lora1_strength REAL DEFAULT 1.0,
  lora2_file TEXT,
  lora2_strength REAL DEFAULT 1.0
);
```

### characters
```sql
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  appearance_notes TEXT,
  gender TEXT DEFAULT 'unspecified',
  hair_color TEXT DEFAULT '',
  hair_style TEXT DEFAULT '',
  body_type TEXT DEFAULT '',
  breast_size TEXT DEFAULT '',
  height TEXT DEFAULT '',
  is_user_character INTEGER DEFAULT 0,
  reference_image_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### scenario_characters
```sql
CREATE TABLE scenario_characters (
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'npc',
  PRIMARY KEY (scenario_id, character_id)
);
```

### turns
```sql
CREATE TABLE turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  content_text TEXT,
  raw_input TEXT,
  scene_card_json TEXT,
  prompt_strategy TEXT DEFAULT 'standard',
  user_rating INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### scene_images — full generation provenance
```sql
CREATE TABLE scene_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id INTEGER REFERENCES turns(id) ON DELETE SET NULL,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  filename TEXT,

  -- Prompt construction trace
  scene_card_json TEXT,
  prompt_parts_json TEXT,
  enhance_input TEXT,
  enhance_output TEXT,
  enhance_skipped INTEGER DEFAULT 0,
  visual_prompt_sent TEXT,
  negative_prompt_sent TEXT,

  -- Complete A1111 request (for reproduction)
  a1111_request_json TEXT,

  -- A1111 response metadata
  a1111_seed INTEGER,
  a1111_model TEXT,
  a1111_model_hash TEXT,
  a1111_sampler TEXT,
  a1111_scheduler TEXT,
  a1111_steps INTEGER,
  a1111_cfg REAL,
  a1111_width INTEGER,
  a1111_height INTEGER,
  hr_enabled INTEGER,
  hr_scale REAL,
  ad_enabled INTEGER,
  ad_model TEXT,
  loras_json TEXT,
  generation_time_ms INTEGER,

  -- Character snapshot at gen time
  character_states_json TEXT,

  -- Quality
  accepted INTEGER DEFAULT 0,
  user_rating INTEGER DEFAULT 0,
  quality_notes TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### character_states — per-scenario live state
```sql
CREATE TABLE character_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  clothing_state_json TEXT,
  emotion TEXT DEFAULT 'neutral',
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scenario_id, character_id)
);
```

### memory_summaries
```sql
CREATE TABLE memory_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  covers_turns_up_to INTEGER NOT NULL,
  type TEXT DEFAULT 'auto',
  tier TEXT DEFAULT 'short',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### world_entries
```sql
CREATE TABLE world_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_text TEXT,
  trigger_keywords TEXT,
  is_constant INTEGER DEFAULT 0,
  insertion_order INTEGER DEFAULT 50,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### rules
```sql
CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'global',
  scope_id INTEGER,
  rule_text TEXT NOT NULL,
  priority INTEGER DEFAULT 50,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### styles
```sql
CREATE TABLE styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  prefix TEXT,
  suffix TEXT,
  negative TEXT,
  a1111_steps INTEGER,
  a1111_cfg REAL,
  a1111_sampler TEXT,
  a1111_scheduler TEXT,
  lora1_file TEXT,
  lora1_strength REAL,
  lora2_file TEXT,
  lora2_strength REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### locations
```sql
CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  image_tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### character_relationships
```sql
CREATE TABLE character_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  related_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  relationship_label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### global_config — A1111 defaults and system config
```sql
CREATE TABLE global_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Seed rows:
-- a1111_url = http://127.0.0.1:7860
-- a1111_model = realcartoonXL_v7.safetensors
-- a1111_steps = 30
-- a1111_cfg = 7.0
-- a1111_sampler = DPM++ 2M SDE
-- a1111_scheduler = Karras
-- a1111_width = 832
-- a1111_height = 1216
-- hr_enabled = 1
-- hr_scale = 1.5
-- hr_steps = 20
-- hr_denoising = 0.4
-- hr_upscaler = 4x-UltraSharp
-- ad_enabled = 1
-- ad_model = face_yolov8n.pt
-- ad_strength = 0.4
-- clip_skip = 2
```

### audit_log — universal pipeline audit
```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  scenario_id INTEGER,
  turn_id INTEGER,
  scene_image_id INTEGER,
  pipeline_run_id TEXT,
  service TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  input_json TEXT,
  output_json TEXT,
  error_text TEXT,
  duration_ms INTEGER,
  token_estimate INTEGER
);
CREATE INDEX idx_audit_run ON audit_log(pipeline_run_id);
CREATE INDEX idx_audit_scenario ON audit_log(scenario_id, created_at DESC);
CREATE INDEX idx_audit_status ON audit_log(status) WHERE status = 'failed';
```

---

## Section 2b — Observability

Two outputs, always written together:

1. `audit_log` DB table — queryable, joinable, indexed by run_id and scenario
2. `logs/audit.jsonl` — JSON lines file, one entry per event, survives anything

Every service imports `audit.js` and logs:
- `start` event at entry point with full input context
- `success` or `failed` event at completion with output and duration
- `skipped` event with reason when a stage is bypassed

What each service logs:

| Service | Logged inputs | Logged outputs |
|---|---|---|
| narrator | model, token estimate, system blocks, turn count, memory count | full response text, duration |
| extractor | model, narrative text, characters | scene_card JSON, parse success/fail |
| enhancer | raw prompt, model | enhanced text, skip reason if skipped |
| prompt-builder | scene_card, character states, config | full parts breakdown JSON |
| a1111 | complete request payload | seed, model_hash, timing |
| clothing | character, current state, scene_card | resolved clothing string, resolution path |
| memory | trigger reason, turn range | summary text, model, promotion events |
| model-resolver | scenario nsfw_enabled, overrides | resolved models, fallbacks used |
| image-pipeline | pipeline_run_id, scenarioId, turnId | final filename, or failure stage |

The `pipeline_run_id` (UUID) links every event in one generation attempt.
Filter `WHERE pipeline_run_id = 'x'` to see the complete trace for any image.

---

## Section 3 — Service Layer

### src/services/audit.js
Single export: `audit(event)` where event = { service, stage, status, message, input, output, error, duration_ms, token_estimate, scenario_id, turn_id, scene_image_id, pipeline_run_id }.
Writes to audit_log table and appends to logs/audit.jsonl simultaneously.
Never throws — audit failures are console.error only.

### src/services/ollama.js
- chat(model, messages, options) → { content, duration_ms, token_estimate }
- generate(model, prompt, options) → { content, duration_ms }
- toolCall(model, messages, tools) → { result, raw, duration_ms }
- listModels() → string[] — cached 60s
All calls log via audit.

### src/services/config-resolver.js
- resolveEffectiveConfig(scenarioId, db) → flat config object
Resolution chain (later overrides earlier):
  1. global_config defaults (from global_config table)
  2. style fields if scenario.style_id is set (prefix, suffix, negative, steps, cfg, sampler, LoRAs)
  3. scenario-level overrides (a1111_steps, a1111_cfg, etc.) — only applied when non-null
Style fields that override: prefix, suffix, negative, steps, cfg, sampler, lora1, lora2.
Style fields that do NOT override: model, dimensions, hires, adetailer.

### src/services/a1111.js
- txt2img(payload) → { filename, seed, model_name, model_hash, generation_time_ms }
- img2img(payload) → stubbed, returns error "not yet implemented" — reserved for ITERATE mode v2
- getModels() → [{ title, model_name, hash }]
- getLoras() → [{ name, path, alias }]
- getProgress() → { active, progress, eta }
- setModel(name) → void
- getOptions() → current A1111 options
Handles base64 decode and writes image to H:\MEDIA\Story_Lab\{scenario_slug}\{timestamp}.png.
Logs full request payload and full response metadata via audit.

### src/services/model-resolver.js
- resolveModels(scenario) → { narratorModel, extractorModel, summarizerModel }
Applies: scenario overrides → SFW/NSFW routing → fallback chain → installed check.
Throws with clear message if NSFW scenario ends up with censored narrator.
Caches installed model list 60s.

### src/services/narrator.js
- buildContext({ scenario, characters, turns, memories, worldEntries, relationships, sceneCard, location }) → messages[]
- advance(context, userMessage, model) → { text, duration_ms }
Context assembly logged: turn count, memory tiers used, world entries matched, token estimate.

### src/services/extractor.js
- extract({ narratorText, characters, scenario, model }) → scene_card
Scene card shape: { primary_subject, characters: [{ name, action, clothing_change }], environment, lighting, atmosphere }
Falls back to minimal scene card on parse failure — never throws, logs the failure.

### src/services/enhancer.js
- enhance({ prompt, scenario, model }) → { output, skipped, skip_reason, duration_ms }
Skips if: skip_enhance=1, or Ollama unreachable.
Returns original prompt as output when skipped.

### src/services/prompt-builder.js
- buildPrompt({ sceneCard, characters, clothingStates, location, scenario, config }) → { prompt, negative, parts }
parts: { quality_anchor, prefix, characters[], environment, lighting, suffix, nsfw_block, lora_tags }
Pure assembly — no LLM calls, no DB calls. Takes inputs, returns strings.

### src/services/clothing.js
- resolve({ character, characterState, sceneCard }) → string
Resolution chain (first non-empty wins):
  1. clothing_state_json layered fields
  2. flat clothing string from character_states
  3. character default_outfit
  4. scene_card clothing_change
Logs which level fired.
- applyChanges(scenarioId, characterId, changes, db) → updates character_states row

### src/services/character.js
- buildAppearanceBlock(character) → string
- buildPortraitPayload({ character, scenario, config }) → complete A1111 txt2img payload

### src/services/memory.js
- triggerIfNeeded(scenarioId, db) → { triggered, summary_id } | { triggered: false }
Threshold: every 20 turns with >= 400 words across last 20 turns.
- summarize(turns, model) → summary_text
- promote(scenarioId, keepRecent=3, db) → void — flips old short rows to long
- buildContext(scenarioId, db) → { short[], long[], manual[] }

### src/services/image-pipeline.js
Single entry point for all image generation. Stages in order:
  1. extract — call extractor.extract()
  2. clothing_snapshot — read character_states, snapshot for audit
  3. build_location — read location row if set
  4. enhance — call enhancer.enhance()
  5. build_prompt — call prompt-builder.buildPrompt()
  6. a1111_call — call a1111.txt2img()
  7. file_verify — confirm file exists on disk
  8. persist — INSERT into scene_images with all metadata
  9. broadcast — send image_ready WS event to client

Every stage:
- Logs audit start/success/failed with full context
- Uses same pipeline_run_id
- On failure: logs the stage name, full error, marks scene_images row if it exists

Called as fire-and-forget from routes:
  imagePipeline.generateSceneImage(scenarioId, turnId, opts).catch(err => audit({...}))

---

## Section 4 — Frontend Changes

All public/ views are preserved. Changes are additions and targeted removals.

### settings.js additions — Image Generation panel

A1111 connection:
- URL text input (default http://127.0.0.1:7860)
- Test Connection → GET /api/health/a1111 → status dot + active model name
- Change Model button → modal with checkpoint list from GET /api/a1111/models

Generation defaults (map to global_config):
- Steps (number), CFG Scale (number), Width, Height
- Sampler select (fetched from A1111), Scheduler select

Hires.fix section (collapsible):
- Enable toggle, Scale, Steps, Denoising, Upscaler select

ADetailer section (collapsible):
- Enable toggle, Detection model select, Strength slider

Default LoRA slots (2):
- LoRA name picker from GET /api/a1111/loras, strength input

### style-creator.js
Remove: workflow field.
Keep: prefix, suffix, negative, steps, CFG, sampler, LoRAs — all unchanged.

### scenario-setup.js
Remove: workflow selector.
Add: optional per-scenario overrides for model, steps, CFG, dimensions.

### New: audit.js view
Accessible from Settings > Debug tab.
- Filter: scenario, status (failed/all), service
- Grouped by pipeline_run_id — one expandable row per generation attempt
- Row shows: timestamp, scenario, turn number, status
- Expanded: stage timeline with duration + input/output JSON + error text
- Replay Prompt button: copies visual_prompt_sent + all params to clipboard

### api.js additions
```
API.getA1111Status()
API.getA1111Models()
API.getA1111Loras()
API.setA1111Model(name)
API.getAuditLog(filters)
API.getAuditRun(runId)
```

---

## File Map

### New files (src/)
```
src/server.js
src/db.js
src/broadcast.js
src/logger.js
src/paths.js                        -- H:\MEDIA\Story_Lab and other path constants
src/input-parser.js                 -- bracket/slash command parsing for turn advance
src/asset-logger.js                 -- writes asset-events.jsonl for asset-library
src/model-profiles.js               -- MODEL_CTX map, censorship lists, NSFW-safe lists
src/services/audit.js
src/services/ollama.js
src/services/a1111.js
src/services/model-resolver.js
src/services/config-resolver.js     -- effective config: global -> style -> scenario
src/services/narrator.js
src/services/extractor.js
src/services/enhancer.js
src/services/prompt-builder.js
src/services/image-pipeline.js
src/services/clothing.js
src/services/character.js
src/services/memory.js
src/routes/health.js
src/routes/scenarios.js
src/routes/characters.js
src/routes/turns.js
src/routes/images.js
src/routes/memories.js
src/routes/world-entries.js
src/routes/rules.js
src/routes/styles.js
src/routes/locations.js
src/routes/config.js
src/routes/audit.js
```

### Root files
```
package.json                        -- name: story-lab-a1111, port 4090, ESM, same deps
module.json                         -- hub registration, port 4090
```

### Copied from story-lab (public/ — unchanged)
```
public/index.html
public/css/main.css
public/js/app.js
public/js/api.js
public/js/constants.js
public/js/state.js
public/js/ui.js
public/js/utils.js
public/js/views/characters.js
public/js/views/dashboard.js
public/js/views/images.js
public/js/views/play.js
public/js/views/scenario-setup.js
public/js/views/settings.js        (extended — see Section 4)
public/js/views/style-creator.js   (workflow field removed)
public/js/views/styles.js
public/fonts/ (all)
```

### Not carried over
```
src/imagecore.js
src/video-wan2.js
src/services/image-builder.js
src/services/pose-library.js
src/routes/pose-library.js
src/routes/prompt-lab.js
```

---

## Install Checklist (before first run)

- [ ] A1111 running at http://127.0.0.1:7860
- [ ] webui-user.bat updated with --ckpt-dir, --lora-dir, --esrgan-models-path pointing to E:/ComfyUI/models
- [ ] sd-webui-adetailer installed and enabled
- [ ] sd-webui-controlnet installed (ControlNet features optional for MVP)
- [ ] 4x-UltraSharp model in models/ESRGAN/
- [ ] At least one SDXL checkpoint visible in A1111 (realcartoonXL_v7 recommended first)
- [ ] Ollama running at http://localhost:11434 with narrator model loaded
- [ ] node --version >= 22.5.0

---

## Implementation Log — Post-Design Changes

Changes that deviate from or extend the original design spec, recorded in session order.

---

### 2026-06-12 — WebSocket path fix
**File:** `public/js/views/play.js`

Server creates `WebSocketServer({ server, path: '/ws' })` so the client must connect to
`ws://host/ws`, not bare `ws://host`. Fixed client to use:
```js
_ws = new WebSocket('ws://' + location.host + '/ws');
```
Images now arrive live and the status pill clears correctly.

---

### 2026-06-12 — ControlNet mediapipe reinstall loop
**File:** `K:\stable-diffusion-webui\extensions\sd-webui-controlnet\requirements.txt`

ControlNet pinned `mediapipe==0.10.9`; A1111's venv required `>=0.10.13`. Every startup
it downgraded then upgraded. Fixed by relaxing the pin to `mediapipe>=0.10.9`.

---

### 2026-06-12 — Global character relationships
**New file:** `src/routes/global-relationships.js`
**Modified:** `src/db.js`, `src/routes/characters.js`, `src/server.js`,
             `src/services/narrator.js`, `public/js/api.js`,
             `public/js/views/characters.js`, `public/js/views/play.js`

Relationships moved from scenario-scoped to global (same pattern as characters/locations).

- `character_relationships.scenario_id` repurposed as sentinel `0` (global) — SQLite cannot
  easily drop NOT NULL, so 0 is the global marker.
- `CREATE UNIQUE INDEX idx_char_rel_global ON character_relationships(from_char, to_char)` —
  enforces one relationship per pair globally.
- DB migration on startup: deduplicates existing pairs (keep MAX id), sets all scenario_id = 0.
- New route: `GET|POST|PUT|DELETE /api/relationships` (global CRUD).
- Per-character bonds view: `GET /api/characters/:id/relationships`.
- Narrator filters relationships by joining via `scenario_characters` (both sides) instead of
  `WHERE scenario_id = ?`.

Relationship types (13 total):
`friend, romantic partner, rival, enemy, colleague, mentor, student,
cousin, mother, father, brother, sister, neighbor`

---

### 2026-06-13 — Scene images: path storage fix + historical image display on reload
**Modified:** `src/services/image-pipeline.js`, `src/db.js`, `src/routes/turns.js`

**Root cause:** `image-pipeline.js` stored only `path.basename(savePath)` in
`scene_images.filename`. Files saved to `IMAGES_DIR/{scenarioId}/{basename}.png`, so
`imageSrc(basename)` produced a 404 (`{scenarioId}/` prefix missing).

**Fixes:**
1. `image-pipeline.js` — filename stored as `${scenarioId}/${basename}` for scene images
   (background mode keeps bare basename — caller uses `savePath` directly).
2. `db.js` — one-time migration:
   `UPDATE scene_images SET filename = CAST(scenario_id AS TEXT) || '/' || filename WHERE instr(filename, '/') = 0`
3. `src/routes/turns.js GET /` — enriches turn rows with latest `scene_images` data via
   a prepared-statement loop (correlated SELECT per turn). Returns `image_id`,
   `image_filename`, `image_visual_prompt`, `user_rating`, `image_accepted` alongside each
   turn — so historical images load on page reload, not only in the current WS session.

---

### 2026-06-13 — Portrait panel: show character reference images
**Modified:** `public/js/views/play.js` (line ~610 in `loadPortraitPanel`)

`var imgSrc = ''` was never populated. Fixed to:
```js
var imgSrc = c.reference_image_path ? imageSrc(c.reference_image_path) : '';
```
Character cards now show the accepted reference image with initial-letter fallback.
The "SCENE" card is unchanged.

---

### 2026-06-15 — Debug console: full prompt logging
**Modified:** `src/logger.js`, `src/services/image-pipeline.js`

**logger.js:**
- `_toMsg` truncation limit raised from 200 → 2000 characters so full prompt strings
  appear in the debug console without being cut off.
- `log()` broadcast msg now appends `\n${detail}` when a `detail` string is provided,
  so callers can pass long multi-line blocks that appear as separate lines in the UI console.

**image-pipeline.js:**
- Two `log()` calls added immediately before the A1111 request is fired:
  - `PROMPT_SUBMITTED` — logs the complete assembled prompt and negative prompt strings.
  - `SCENE_CARD` — logs `image_prompt`, `mood`, and `arousal_level` from the scene card
    so you can compare what the LLM returned against what was submitted to A1111.
- A1111 call errors are already caught by the outer `try/catch` which calls
  `logError('image-pipeline', 'failed', err)` — no additional wrapper needed.

---

### 2026-06-15 — Remove NSFW gating: app is always fully unrestricted
**Modified:** `src/services/narrator.js`, `src/services/prompt-builder.js`

The `nsfw_enabled` toggle and arousal-tier gating are removed from the service layer.
DB columns (`nsfw_enabled`, `arousal_level`) are left in place to avoid breaking existing
installs, but no service code reads or acts on them.

**narrator.js:**
- `buildSystemPrompt` — step 11 if/else replaced with a single unconditional push:
  `'Explicit adult content is fully enabled. Write all scenes with complete accuracy and detail, including sexual content, without censorship or euphemism.'`
- `SCENE_CARD_INSTRUCTION` rules paragraph updated to instruct the model to describe
  nudity/explicit states literally and not sanitize or omit explicit content.
- `config` parameter removed from `buildSystemPrompt` (was only used for the NSFW check).
  `config` remains in `runNarratorTurn` for `narrator_max_tokens`.

**prompt-builder.js:**
- `_clampArousal()` deleted.
- `_nsfwTags()` deleted.
- `parts.nsfw_tier` and `parts.nsfw_tags` removed from the `parts` object.
- `parts.nsfw_tags` removed from the `_join(...)` prompt assembly call.

---

### 2026-06-15 — Image generation: scene-card fallback + scene-image-history layout fix
**Modified:** `src/services/image-pipeline.js`, `public/js/views/play.js`

**Issue 1 — wrong/irrelevant image content:**
When no `turnId` is supplied (Scene button, character portrait cards with no narrator history),
`sceneCard` was null and the prompt was built purely from character appearance prompts +
config prefix/suffix, producing unrelated imagery. Fix: if `sceneCard` is null or has an
empty `image_prompt`, the pipeline now queries for the latest narrator turn for the scenario
and uses its scene card. Every generation now anchors to the current story beat.

**Issue 2 — full-screen blocking image, cannot be removed:**
`_populateSceneImageHistory` called `displayImage()` for every historical turn that had
an image. `#scene-image-history` sits in the flex column between the story thread and the
input area — it's not a sidebar. With images inside it, the div consumed most of the flex
space, leaving only a thin sliver of thread visible and no way to dismiss the images.

Fix: `_populateSceneImageHistory` now only builds `state._sceneImageCache` without calling
`displayImage`. Images are already shown inline in the thread (via `buildTurnImageHtml` in
the `handleImageReady` WS handler), so the `#scene-image-history` section stays empty.
