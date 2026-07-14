import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './paths.js';

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS global_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS image_profiles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  description       TEXT DEFAULT '',
  prompt_prefix     TEXT DEFAULT '',
  prompt_suffix     TEXT DEFAULT '',
  negative_additions TEXT DEFAULT '',
  lora1_file        TEXT DEFAULT '',
  lora1_strength    REAL DEFAULT 1.0,
  lora2_file        TEXT DEFAULT '',
  lora2_strength    REAL DEFAULT 1.0,
  steps_override    INTEGER,
  cfg_override      REAL,
  is_active         INTEGER DEFAULT 0,
  created_at        TEXT DEFAULT (datetime('now'))
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
  image_tags            TEXT DEFAULT '',
  background_images_json TEXT DEFAULT '[]',
  default_background    TEXT DEFAULT '',
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

CREATE TABLE IF NOT EXISTS scene_images (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id        INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  turn_id            INTEGER REFERENCES turns(id),
  filename           TEXT NOT NULL,
  mode               TEXT NOT NULL,
  generation_method  TEXT DEFAULT 'txt2img',
  background_used    TEXT DEFAULT '',
  prompt_used        TEXT DEFAULT '',
  negative_used      TEXT DEFAULT '',
  profile_id         INTEGER REFERENCES image_profiles(id),
  seed               INTEGER DEFAULT -1,
  steps              INTEGER DEFAULT 30,
  cfg                REAL DEFAULT 7,
  width              INTEGER DEFAULT 832,
  height             INTEGER DEFAULT 1216,
  model_name         TEXT DEFAULT '',
  generation_time_ms INTEGER DEFAULT 0,
  created_at         TEXT DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS styles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  prompt_prefix TEXT DEFAULT '',
  prompt_suffix TEXT DEFAULT '',
  negative    TEXT DEFAULT '',
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

CREATE TABLE IF NOT EXISTS character_references (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id  INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  prompt_used  TEXT DEFAULT '',
  accepted     INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS character_fullbodies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id  INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  prompt_used  TEXT DEFAULT '',
  is_default   INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);
`);

const _insertDefault = db.prepare(
  'INSERT OR IGNORE INTO global_config (key, value) VALUES (?, ?)'
);

const _defaults = [
  ['a1111_url',          'http://127.0.0.1:7860'],
  ['a1111_model',        ''],
  ['a1111_steps',        '30'],
  ['a1111_cfg',          '7'],
  ['a1111_sampler',      'DPM++ 2M SDE'],
  ['a1111_scheduler',    'Karras'],
  ['a1111_width',        '832'],
  ['a1111_height',       '1216'],
  ['a1111_clip_skip',    '2'],
  ['hr_enabled',         'false'],
  ['hr_scale',           '1.5'],
  ['hr_steps',           '15'],
  ['hr_denoising',       '0.4'],
  ['hr_upscaler',        'R-ESRGAN 4x+'],
  ['ad_enabled',         'true'],
  ['ad_model',           'face_yolov8n.pt'],
  ['ad_strength',        '0.4'],
  ['lora_enabled',       'true'],
  ['nsfw_enabled',       'true'],
  ['master_positive',    ''],
  ['master_negative',    'bad anatomy, bad hands, missing fingers, extra fingers, deformed, ugly, blurry, watermark'],
  ['refiner_enabled',    'false'],
  ['refiner_checkpoint', ''],
  ['refiner_switch_at',  '0.8'],
  ['narrator_model',          ''],
  ['narrator_context_turns',  '20'],
  ['narrator_max_tokens',     '1200'],
  ['narrator_context_tokens', '8192'],
  ['prompt_extractor_model',  ''],
  ['picker_model',            ''],
  ['explicit_mode',           'true'],
  ['ipadapter_enabled',       'false'],
  // No fabricated default model — an empty value means "unconfigured," and FaceID is
  // skipped entirely rather than submitting a guessed model name that won't exist in
  // any real A1111 install. Pick a real model from the Settings dropdown (populated
  // live from /controlnet/model_list) to actually use FaceID.
  ['ipadapter_model',         ''],
  // Empty means "auto-resolve by checkpoint family" — see resolveIpAdapterModule().
  ['ipadapter_module',        ''],
  ['ipadapter_weight',        '0.35'],
  ['ipadapter_end',           '0.6'],
  ['img2img_denoising',       '0.45'],
  ['image_summary_panel_default',     'visible'],
  ['summary_rating_prompt_enabled',   'true'],
  ['summary_content_min_for_learning','4'],
  ['summary_style_min_for_learning',  '4'],
  ['summary_exemplar_max',            '50'],
  ['summary_exemplar_max_per_scenario','10'],
  ['summary_learning_enabled',        'true'],
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

// character image path on character record
migrate("ALTER TABLE characters ADD COLUMN reference_image_path TEXT DEFAULT NULL");

// IP-Adapter reference image (relative path under IMAGES_DIR)
migrate("ALTER TABLE characters ADD COLUMN reference_image TEXT DEFAULT ''");

// locations background folder
migrate("ALTER TABLE locations ADD COLUMN background_folder TEXT DEFAULT ''");

// scene_images quality columns
migrate('ALTER TABLE scene_images ADD COLUMN accepted   INTEGER DEFAULT 0');
migrate('ALTER TABLE scene_images ADD COLUMN user_rating INTEGER DEFAULT 0');
migrate("ALTER TABLE scene_images ADD COLUMN model_hash  TEXT DEFAULT ''");
migrate("ALTER TABLE scene_images ADD COLUMN loras_json  TEXT DEFAULT '[]'");
migrate('ALTER TABLE scene_images ADD COLUMN scene_card_json TEXT DEFAULT NULL');

// audit_events context columns
migrate('ALTER TABLE audit_events ADD COLUMN scenario_id INTEGER');
migrate('ALTER TABLE audit_events ADD COLUMN turn_id     INTEGER');
migrate('ALTER TABLE audit_events ADD COLUMN duration_ms INTEGER');

// turns table missing columns
migrate("ALTER TABLE turns ADD COLUMN scene_card_json TEXT DEFAULT '{}'");
migrate("ALTER TABLE turns ADD COLUMN token_estimate INTEGER DEFAULT 0");
migrate("ALTER TABLE turns ADD COLUMN location_id INTEGER REFERENCES locations(id)");

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
migrate("ALTER TABLE characters ADD COLUMN image_description    TEXT    DEFAULT NULL");
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
migrate("ALTER TABLE characters ADD COLUMN image_prompt_override TEXT   DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN faceid_ref_count     INTEGER DEFAULT 5");
migrate("ALTER TABLE characters ADD COLUMN faceid_ref_order     TEXT    DEFAULT NULL");
migrate("ALTER TABLE characters ADD COLUMN unique_trait         TEXT    DEFAULT NULL");
migrate('ALTER TABLE character_fullbodies ADD COLUMN is_default INTEGER DEFAULT 0');

// Global locations: add background_folder column to existing scenario-scoped table
migrate("ALTER TABLE locations ADD COLUMN background_folder TEXT DEFAULT ''");

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
migrate("ALTER TABLE locations ADD COLUMN image_tags_day TEXT DEFAULT NULL");
migrate("ALTER TABLE locations ADD COLUMN image_tags_night TEXT DEFAULT NULL");
// DB-driven location backgrounds table
migrate(`
  CREATE TABLE IF NOT EXISTS location_backgrounds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    is_default  INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(location_id, filename)
  )
`);



migrate('ALTER TABLE scene_images ADD COLUMN content_rating INTEGER DEFAULT NULL');
migrate('ALTER TABLE scene_images ADD COLUMN style_rating INTEGER DEFAULT NULL');
migrate('ALTER TABLE scene_images ADD COLUMN rating_skipped INTEGER DEFAULT 0');

// Image summary edit history (Phase B)
migrate(`
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
  )
`);

migrate(`
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
  )
`);

migrate(`
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
  )
`);

migrate('ALTER TABLE scene_images ADD COLUMN summary_plain_snapshot TEXT DEFAULT \'\'');
migrate('ALTER TABLE scene_images ADD COLUMN summary_tags_snapshot TEXT DEFAULT \'\'');
migrate('ALTER TABLE scene_images ADD COLUMN style_context_snapshot TEXT DEFAULT \'\'');
migrate('ALTER TABLE scene_images ADD COLUMN summary_rated_at TEXT DEFAULT NULL');


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


migrate("CREATE UNIQUE INDEX IF NOT EXISTS idx_char_rel_global ON character_relationships(from_character_id, to_character_id)");

// Fix existing scene_images: prepend scenario_id/ to bare basenames (no path separator means old format)
try { db.exec("UPDATE scene_images SET filename = CAST(scenario_id AS TEXT) || '/' || filename WHERE instr(filename, '/') = 0"); } catch (_) {}

export default db;
