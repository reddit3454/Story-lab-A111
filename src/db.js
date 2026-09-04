import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './paths.js';
import { seedAndMigrateDefaultLooks } from './default-look.js';
import { migrateImageLooksSchema, migrateImageLooksData } from './image-looks-migration.js';

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS global_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  system_prompt   TEXT DEFAULT '',
  nsfw_enabled    INTEGER DEFAULT 0,
  narrator_model  TEXT DEFAULT '',
  context_turns   INTEGER DEFAULT 20,
  status          TEXT DEFAULT 'active',
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS characters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id      INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  role             TEXT DEFAULT 'character',
  appearance_prompt TEXT DEFAULT '',
  base_clothing    TEXT DEFAULT '',
  current_clothing TEXT DEFAULT '',
  personality      TEXT DEFAULT '',
  is_user          INTEGER DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id           INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT DEFAULT '',
  time_of_day           TEXT DEFAULT 'any',
  created_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS turns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id    INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  turn_number    INTEGER NOT NULL,
  role           TEXT NOT NULL,
  content_text   TEXT NOT NULL,
  scene_card_json TEXT DEFAULT '{}',
  location_id    INTEGER REFERENCES locations(id),
  token_estimate INTEGER DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  memory_type TEXT DEFAULT 'auto',
  turn_number INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS world_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT DEFAULT 'general',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  priority    INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenario_characters (
  scenario_id  INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  added_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (scenario_id, character_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_id TEXT DEFAULT '',
  service         TEXT NOT NULL,
  event           TEXT NOT NULL,
  data_json       TEXT DEFAULT '{}',
  detail_json     TEXT DEFAULT '{}',
  level           TEXT DEFAULT 'info',
  created_at      TEXT DEFAULT (datetime('now'))
);

`);

const _insertDefault = db.prepare(
  'INSERT OR IGNORE INTO global_config (key, value) VALUES (?, ?)'
);

const _defaults = [
  ['nsfw_enabled',       'true'],
  ['narrator_model',          ''],
  ['narrator_context_turns',  '20'],
  ['narrator_max_tokens',     '1200'],
  ['narrator_context_tokens', '8192'],
  ['explicit_mode',           'true'],
  ['arousal_decay_enabled',           'true'],
  ['emotion_tracking_enabled',        'true'],
  ['relationship_deltas_enabled',     'true'],
  ['mood_gate_toasts_enabled',          'true'],
  ['regen_state_snapshot_enabled',      'true'],
  ['cast_trigger_chips_enabled',        'true'],
  ['scene_heat_readout_enabled',        'true'],
  ['sfw_arousal_ceiling',             '3'],
  // Scene-state extraction (mood / arousal / clothing from the finished prose)
  ['scene_state_enabled',             'true'],
  ['scene_state_model',               ''],      // '' -> qwen2.5:7b-instruct default
  ['scene_state_keep_alive',          '5m'],    // '0' unloads after each turn for VRAM headroom
  // Off by default: only warm A1111 when the user explicitly trades idle VRAM
  // for a faster first image request.
  ['image_warmup_enabled',            'false'],
];

for (const [key, value] of _defaults) {
  _insertDefault.run(key, value);
}

/* ── Additive migrations ─────────────────────────────────────────── */

function migrate(sql) {
  try {
    db.exec(sql);
  } catch (err) {
    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
      console.warn('[db migration]', err.message);
    }
  }
}

// Populate scenario_characters from legacy characters.scenario_id (one-time migration)
try {
  db.exec("INSERT OR IGNORE INTO scenario_characters (scenario_id, character_id) SELECT scenario_id, id FROM characters WHERE scenario_id IS NOT NULL");
} catch (_) {}

// audit_events context columns
migrate('ALTER TABLE audit_events ADD COLUMN scenario_id INTEGER');
migrate('ALTER TABLE audit_events ADD COLUMN turn_id     INTEGER');
migrate('ALTER TABLE audit_events ADD COLUMN duration_ms INTEGER');

// turns table missing columns
migrate("ALTER TABLE turns ADD COLUMN scene_card_json TEXT DEFAULT '{}'");
migrate("ALTER TABLE turns ADD COLUMN token_estimate INTEGER DEFAULT 0");
migrate("ALTER TABLE turns ADD COLUMN location_id INTEGER REFERENCES locations(id)");
migrate("ALTER TABLE turns ADD COLUMN image_action_draft TEXT DEFAULT NULL");
migrate("ALTER TABLE turns ADD COLUMN image_direction_json TEXT DEFAULT ''");

// scenario extended wizard fields
migrate("ALTER TABLE scenarios ADD COLUMN tone                        TEXT    DEFAULT 'Dramatic'");
migrate("ALTER TABLE scenarios ADD COLUMN premise                     TEXT    DEFAULT ''");
migrate("ALTER TABLE scenarios ADD COLUMN setting                     TEXT    DEFAULT ''");
migrate("ALTER TABLE scenarios ADD COLUMN default_start               TEXT    DEFAULT ''");
migrate("ALTER TABLE scenarios ADD COLUMN reply_length                TEXT    DEFAULT 'medium'");
migrate("ALTER TABLE scenarios ADD COLUMN lust_level                  INTEGER DEFAULT 3");
migrate("ALTER TABLE scenarios ADD COLUMN explicitness_level          TEXT    DEFAULT 'moderate'");
migrate("ALTER TABLE scenarios ADD COLUMN pacing                      TEXT    DEFAULT 'normal'");
migrate("ALTER TABLE scenarios ADD COLUMN narrative_pov               TEXT    DEFAULT 'third'");
migrate("ALTER TABLE scenarios ADD COLUMN violence_level              TEXT    DEFAULT 'mild'");
migrate("ALTER TABLE scenarios ADD COLUMN tone_modifier               TEXT    DEFAULT ''");
migrate("ALTER TABLE scenarios ADD COLUMN narrator_presence_enabled   INTEGER DEFAULT 0");
migrate("ALTER TABLE scenarios ADD COLUMN narrator_presence_mode      TEXT    DEFAULT 'all'");
migrate("ALTER TABLE scenarios ADD COLUMN narrator_presence_config    TEXT    DEFAULT NULL");
migrate("ALTER TABLE scenarios ADD COLUMN active_location_id          INTEGER DEFAULT NULL");
// Free-text active place — an ad-hoc location the user typed instead of picking
// a location card. Mutually exclusive with active_location_id (enforced by the
// scenarios PUT route). Consumed by narrator.js and image-pipeline.js via
// resolveScenarioPlace().
migrate("ALTER TABLE scenarios ADD COLUMN active_place_text           TEXT    DEFAULT ''");
migrate("ALTER TABLE scenarios ADD COLUMN user_character_id           INTEGER DEFAULT NULL");
migrate("ALTER TABLE scenarios ADD COLUMN ended_at                    TEXT    DEFAULT NULL");
migrate("ALTER TABLE scenarios ADD COLUMN generation_config           TEXT    DEFAULT NULL");

// character relationships table
migrate(`
  CREATE TABLE IF NOT EXISTS character_relationships (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id       INTEGER NOT NULL,
    from_character_id INTEGER NOT NULL,
    to_character_id   INTEGER NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'friend',
    description       TEXT DEFAULT '',
    strength          INTEGER DEFAULT 3,
    created_at        TEXT DEFAULT (datetime('now')),
    UNIQUE(scenario_id, from_character_id, to_character_id)
  )
`);

// character extended profile columns
migrate("ALTER TABLE characters ADD COLUMN description          TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN appearance_notes     TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN gender               TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN age_range            TEXT    DEFAULT 'adult'");
migrate("ALTER TABLE characters ADD COLUMN height               TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN body_type            TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN breast_size          TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN butt_size            TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN penis_state          TEXT    DEFAULT 'soft'");
migrate("ALTER TABLE characters ADD COLUMN skin_tone            TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN skin_extras          TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN eye_color            TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN eye_shape            TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN nose_shape           TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN lip_shape            TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN face_shape           TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN hair_color           TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN hair_style           TEXT    DEFAULT ''");
migrate("ALTER TABLE characters ADD COLUMN hair_extras          TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN default_outfit       TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN outfit_style         TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN outfit_sets          TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN default_outfit_name  TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN is_user_character    INTEGER DEFAULT 0");
migrate("ALTER TABLE characters ADD COLUMN moodbaseline         INTEGER DEFAULT 3");
migrate("ALTER TABLE characters ADD COLUMN arousalthreshold     TEXT    DEFAULT 'medium'");
migrate("ALTER TABLE characters ADD COLUMN arousallockeduntil   INTEGER DEFAULT 2");
migrate("ALTER TABLE characters ADD COLUMN arousalmax           INTEGER DEFAULT 5");
migrate("ALTER TABLE characters ADD COLUMN moodtriggerspos      TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN moodtriggersneg      TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN arousaltriggers      TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN unique_trait         TEXT    DEFAULT NULL");

// scenario_locations join table (mirrors scenario_characters pattern)
migrate(`
  CREATE TABLE IF NOT EXISTS scenario_locations (
    scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    added_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (scenario_id, location_id)
  )
`);

// Populate scenario_locations from legacy locations.scenario_id (one-time migration)
try {
  db.exec("INSERT OR IGNORE INTO scenario_locations (scenario_id, location_id) SELECT scenario_id, id FROM locations WHERE scenario_id IS NOT NULL");
} catch (_) {}


// Location card fields (story-lab parity)
migrate("ALTER TABLE locations ADD COLUMN short_desc TEXT DEFAULT ''");
migrate("ALTER TABLE locations ADD COLUMN full_desc TEXT DEFAULT ''");
migrate("ALTER TABLE locations ADD COLUMN tags TEXT DEFAULT ''");

// Unique index on locations.name so INSERT OR IGNORE can seed by name idempotently
migrate("CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_name ON locations(name)");

// Removed: scenario-specific seed data

// Globalize character_relationships: deduplicate same char pair across scenarios (keep latest),
// set scenario_id = 0 as global sentinel, add global unique index on (from, to).
try {
  db.exec(`
    DELETE FROM character_relationships
    WHERE id NOT IN (
      SELECT MAX(id) FROM character_relationships GROUP BY from_character_id, to_character_id
    )
  `);
} catch (_) {}
try { db.exec("UPDATE character_relationships SET scenario_id = 0"); } catch (_) {}

migrate(`CREATE TABLE IF NOT EXISTS scenario_character_state (
  scenario_id       INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  character_id      INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  moodcurrent       INTEGER NOT NULL DEFAULT 3,
  arousalcurrent    INTEGER NOT NULL DEFAULT 1,
  mood_momentum     INTEGER NOT NULL DEFAULT 0,
  arousal_momentum  INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (scenario_id, character_id)
)`);


migrate("ALTER TABLE scenario_characters ADD COLUMN starting_clothing_set_name TEXT DEFAULT NULL");
migrate("ALTER TABLE scenario_characters ADD COLUMN starting_clothing TEXT DEFAULT ''");
migrate("ALTER TABLE scenario_character_state ADD COLUMN current_clothing TEXT DEFAULT ''");

// One-time: seed scenario clothing from legacy characters.current_clothing / base / default_outfit
try {
  db.exec(`
    UPDATE scenario_character_state
    SET current_clothing = (
      SELECT TRIM(COALESCE(NULLIF(c.current_clothing,''), NULLIF(c.default_outfit,''), NULLIF(c.base_clothing,''), ''))
      FROM characters c WHERE c.id = scenario_character_state.character_id
    )
    WHERE TRIM(COALESCE(current_clothing,'')) = ''
  `);
  db.exec(`
    UPDATE scenario_characters
    SET starting_clothing = (
      SELECT TRIM(COALESCE(NULLIF(c.default_outfit,''), NULLIF(c.current_clothing,''), NULLIF(c.base_clothing,''), ''))
      FROM characters c WHERE c.id = scenario_characters.character_id
    )
    WHERE TRIM(COALESCE(starting_clothing,'')) = ''
  `);
} catch (_) {}


try { db.exec("DROP INDEX IF EXISTS idx_char_rel_global"); } catch (_) {}
migrate("ALTER TABLE character_relationships ADD COLUMN tags_json TEXT DEFAULT '[]'");
try {
  db.exec(`UPDATE characters SET arousalmax = CASE arousalmax WHEN 2 THEN 4 WHEN 3 THEN 6 WHEN 4 THEN 8 WHEN 5 THEN 10 ELSE arousalmax END WHERE arousalmax IS NOT NULL AND arousalmax <= 5`);
  db.exec(`UPDATE characters SET arousalmax = 10 WHERE arousalmax IS NULL OR arousalmax < 1 OR arousalmax > 10`);
} catch (_) {}

/* ── Image generation (rebuild) ──────────────────────────────────────── */

// A1111 connection — structural master config. Every generation-affecting
// setting (steps/cfg/sampler/scheduler/checkpoint/etc.) now lives entirely
// on the active Look (see image_looks table) — Looks may never override
// the connection URL itself.
const _imageDefaults = [
  ['a1111_url',       'http://127.0.0.1:7860'],
  // FaceID/IP-Adapter — a connection-level concern (which ControlNet model this
  // A1111 instance has installed), not a style concern, so it lives here rather
  // than on a Look. Empty by default: FaceID is skipped, never sent with a
  // guessed model name, until the user sets this to a real model filename from
  // their A1111's ControlNet model list.
  ['a1111_faceid_model',  ''],
  ['a1111_faceid_module', 'ip-adapter_clip_sdxl'],
  // Pose ControlNet consumes library-provided skeletons. Both fields stay
  // empty until the user selects a live verified A1111 option in Settings.
  ['a1111_pose_model',    ''],
  ['a1111_pose_module',   ''],
  // Anatomy/safety only — no style words belong in the master negative. Style
  // negatives live on the active Look.
  ['master_negative', 'lowres, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, too many fingers, extra limbs, missing limbs, malformed limbs, mutated hands, poorly drawn hands, poorly drawn face, cross-eyed, deformed, disfigured, watermark, signature, text, logo, jpeg artifacts'],
];
for (const [key, value] of _imageDefaults) {
  _insertDefault.run(key, value);
}

// Looks — the single, exclusive style source. Exactly one row has is_active = 1.
migrate(`
  CREATE TABLE IF NOT EXISTS image_looks (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    description       TEXT DEFAULT '',
    checkpoint        TEXT DEFAULT '',
    lora1_file        TEXT DEFAULT '',
    lora1_strength    REAL DEFAULT 1.0,
    lora2_file        TEXT DEFAULT '',
    lora2_strength    REAL DEFAULT 1.0,
    prompt_prefix     TEXT DEFAULT '',
    prompt_suffix     TEXT DEFAULT '',
    negative          TEXT DEFAULT '',
    steps_override    INTEGER DEFAULT NULL,
    cfg_override      REAL    DEFAULT NULL,
    sampler_override  TEXT    DEFAULT NULL,
    is_active         INTEGER DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now'))
  )
`);
migrate('CREATE UNIQUE INDEX IF NOT EXISTS idx_image_looks_name ON image_looks(name)');

migrateImageLooksSchema(db);
migrateImageLooksData(db);

// Default Look seed + safe migration (fresh DB + legacy Photoreal/Cinematic installs).
seedAndMigrateDefaultLooks(db);

// Character FaceID reference image (relative path under IMAGES_DIR).
migrate("ALTER TABLE characters ADD COLUMN reference_image_path TEXT DEFAULT NULL");

// Optional per-location background image for img2img mode (absolute or
// IMAGES_DIR-relative path). Text tags for txt2img mode already exist on
// locations (description / short_desc / full_desc).
migrate("ALTER TABLE locations ADD COLUMN background_image_path TEXT DEFAULT NULL");

// Generated images — one pipeline, one row per accepted generation, full snapshot.
migrate(`
  CREATE TABLE IF NOT EXISTS scene_images (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id         INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
    turn_id             INTEGER REFERENCES turns(id) ON DELETE SET NULL,
    filename            TEXT NOT NULL,
    mode                TEXT NOT NULL DEFAULT 'scene',
    generation_method   TEXT NOT NULL DEFAULT 'txt2img',
    prompt_used         TEXT DEFAULT '',
    negative_used       TEXT DEFAULT '',
    look_id             INTEGER,
    seed                INTEGER DEFAULT -1,
    steps               INTEGER,
    cfg                 REAL,
    width                INTEGER,
    height              INTEGER,
    model_name          TEXT DEFAULT '',
    model_hash          TEXT DEFAULT '',
    generation_time_ms  INTEGER DEFAULT 0,
    face_ref_json       TEXT DEFAULT '[]',
    prompt_parts_json   TEXT DEFAULT '{}',
    character_ids_json  TEXT DEFAULT '[]',
    pipeline_run_id     TEXT DEFAULT '',
    accepted            INTEGER DEFAULT 0,
    user_rating         INTEGER DEFAULT 0,
    created_at          TEXT DEFAULT (datetime('now'))
  )
`);

// A `scene_images` table already existed on real installs from before the
// image-pipeline purge (with an older, different column set) — the CREATE
// TABLE above is a no-op against it, so the new columns this rebuild needs
// must also be added additively, exactly like every other migration in this
// file. Harmless/no-op on a genuinely fresh DB where CREATE TABLE already
// included them.
migrate("ALTER TABLE scene_images ADD COLUMN look_id            INTEGER");
migrate("ALTER TABLE scene_images ADD COLUMN face_ref_json      TEXT DEFAULT '[]'");
migrate("ALTER TABLE scene_images ADD COLUMN prompt_parts_json  TEXT DEFAULT '{}'");
migrate("ALTER TABLE scene_images ADD COLUMN character_ids_json TEXT DEFAULT '[]'");
migrate("ALTER TABLE scene_images ADD COLUMN pipeline_run_id    TEXT DEFAULT ''");

migrate('CREATE INDEX IF NOT EXISTS idx_scene_images_scenario ON scene_images(scenario_id, created_at DESC)');
migrate('CREATE INDEX IF NOT EXISTS idx_scene_images_turn ON scene_images(turn_id)');

export default db;
