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
  ['nsfw_enabled',       'false'],
  ['master_negative',    'bad anatomy, bad hands, missing fingers, extra fingers, deformed, ugly, blurry, watermark'],
  ['narrator_model',          ''],
  ['narrator_context_turns',  '20'],
  ['narrator_max_tokens',     '1200'],
  ['prompt_extractor_model',  ''],
  ['explicit_mode',           'false'],
];

for (const [key, value] of _defaults) {
  _insertDefault.run(key, value);
}

/* ── Additive migrations ─────────────────────────────────────────── */

// Populate scenario_characters from legacy characters.scenario_id (one-time migration)
try {
  db.exec("INSERT OR IGNORE INTO scenario_characters (scenario_id, character_id) SELECT scenario_id, id FROM characters WHERE scenario_id IS NOT NULL");
} catch (_) {}

// character image path on character record
try { db.exec("ALTER TABLE characters ADD COLUMN reference_image_path TEXT DEFAULT NULL"); } catch (_) {}

// locations background folder
try { db.exec("ALTER TABLE locations ADD COLUMN background_folder TEXT DEFAULT ''"); } catch (_) {}

// scene_images quality columns
try { db.exec('ALTER TABLE scene_images ADD COLUMN accepted   INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE scene_images ADD COLUMN user_rating INTEGER DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE scene_images ADD COLUMN model_hash  TEXT DEFAULT \'\''); } catch (_) {}
try { db.exec('ALTER TABLE scene_images ADD COLUMN loras_json  TEXT DEFAULT \'[]\''); } catch (_) {}
try { db.exec('ALTER TABLE scene_images ADD COLUMN scene_card_json TEXT DEFAULT NULL'); } catch (_) {}

// audit_events context columns
try { db.exec('ALTER TABLE audit_events ADD COLUMN scenario_id INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE audit_events ADD COLUMN turn_id     INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE audit_events ADD COLUMN duration_ms INTEGER'); } catch (_) {}

// turns table missing columns
try { db.exec("ALTER TABLE turns ADD COLUMN scene_card_json TEXT DEFAULT '{}'"); } catch (_) {}
try { db.exec("ALTER TABLE turns ADD COLUMN token_estimate INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE turns ADD COLUMN location_id INTEGER REFERENCES locations(id)"); } catch (_) {}

// scenario extended wizard fields
try { db.exec("ALTER TABLE scenarios ADD COLUMN tone                        TEXT    DEFAULT 'Dramatic'"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN premise                     TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN setting                     TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN default_start               TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN reply_length                TEXT    DEFAULT 'medium'"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN lust_level                  INTEGER DEFAULT 3"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN explicitness_level          TEXT    DEFAULT 'moderate'"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN pacing                      TEXT    DEFAULT 'normal'"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN narrative_pov               TEXT    DEFAULT 'third'"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN violence_level              TEXT    DEFAULT 'mild'"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN tone_modifier               TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN narrator_presence_enabled   INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN narrator_presence_mode      TEXT    DEFAULT 'all'"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN narrator_presence_config    TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN active_location_id          INTEGER DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN user_character_id           INTEGER DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN ended_at                    TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE scenarios ADD COLUMN generation_config           TEXT    DEFAULT NULL"); } catch (_) {}

// character relationships table
try {
  db.exec(`
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
} catch (_) {}

// character extended profile columns
try { db.exec("ALTER TABLE characters ADD COLUMN description          TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN image_description    TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN appearance_notes     TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN gender               TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN age_range            TEXT    DEFAULT 'adult'"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN height               TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN body_type            TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN breast_size          TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN butt_size            TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN penis_state          TEXT    DEFAULT 'soft'"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN skin_tone            TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN skin_extras          TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN eye_color            TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN eye_shape            TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN nose_shape           TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN lip_shape            TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN face_shape           TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN hair_color           TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN hair_style           TEXT    DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN hair_extras          TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN default_outfit       TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN outfit_style         TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN outfit_sets          TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN default_outfit_name  TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN is_user_character    INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN moodbaseline         INTEGER DEFAULT 3"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN arousalthreshold     TEXT    DEFAULT 'medium'"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN arousallockeduntil   INTEGER DEFAULT 2"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN arousalmax           INTEGER DEFAULT 5"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN moodtriggerspos      TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN moodtriggersneg      TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN arousaltriggers      TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN image_prompt_override TEXT   DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN faceid_ref_count     INTEGER DEFAULT 5"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN faceid_ref_order     TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE characters ADD COLUMN unique_trait         TEXT    DEFAULT NULL"); } catch (_) {}
try { db.exec('ALTER TABLE character_fullbodies ADD COLUMN is_default INTEGER DEFAULT 0'); } catch (_) {}

// Global locations: add background_folder column to existing scenario-scoped table
try { db.exec("ALTER TABLE locations ADD COLUMN background_folder TEXT DEFAULT ''"); } catch (_) {}

// scenario_locations join table (mirrors scenario_characters pattern)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenario_locations (
      scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      added_at    TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (scenario_id, location_id)
    )
  `);
} catch (_) {}

// Populate scenario_locations from legacy locations.scenario_id (one-time migration)
try {
  db.exec("INSERT OR IGNORE INTO scenario_locations (scenario_id, location_id) SELECT scenario_id, id FROM locations WHERE scenario_id IS NOT NULL");
} catch (_) {}

// DB-driven location backgrounds table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS location_backgrounds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      is_default  INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, filename)
    )
  `);
} catch (_) {}

// Unique index on locations.name so INSERT OR IGNORE can seed by name idempotently
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_name ON locations(name)"); } catch (_) {}

// Seed 8 known locations (INSERT OR IGNORE skips existing by name)
try {
  db.exec(`
    INSERT OR IGNORE INTO locations (name, background_folder) VALUES
      ('Campsite',           'Campsite'),
      ('Car',                'Car'),
      ('Sarah''s Apartment', 'Jib_Sarah_Apartment'),
      ('Motel',              'Motel'),
      ('Park at Night',      'Park_night'),
      ('Sarah''s Room',      'Sarahs_room'),
      ('Bathroom',           'Bathroom'),
      ('Beach',              'Beach')
  `);
} catch (_) {}

// Backfill background_folder on any pre-existing location rows that matched by name but have empty folder
try {
  db.exec(`
    UPDATE locations SET background_folder = 'Campsite'            WHERE name = 'Campsite'           AND (background_folder IS NULL OR background_folder = '');
    UPDATE locations SET background_folder = 'Car'                 WHERE name = 'Car'                AND (background_folder IS NULL OR background_folder = '');
    UPDATE locations SET background_folder = 'Jib_Sarah_Apartment' WHERE name = 'Sarah''s Apartment' AND (background_folder IS NULL OR background_folder = '');
    UPDATE locations SET background_folder = 'Motel'               WHERE name = 'Motel'              AND (background_folder IS NULL OR background_folder = '');
    UPDATE locations SET background_folder = 'Park_night'          WHERE name = 'Park at Night'      AND (background_folder IS NULL OR background_folder = '');
    UPDATE locations SET background_folder = 'Sarahs_room'         WHERE name = 'Sarah''s Room'      AND (background_folder IS NULL OR background_folder = '');
    UPDATE locations SET background_folder = 'Bathroom'            WHERE name = 'Bathroom'           AND (background_folder IS NULL OR background_folder = '');
    UPDATE locations SET background_folder = 'Beach'               WHERE name = 'Beach'              AND (background_folder IS NULL OR background_folder = '')
  `);
} catch (_) {}

// Seed location_backgrounds using subquery to look up location id by name
try {
  db.exec(`
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00026_.png', 1 FROM locations WHERE name = 'Campsite';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00028_.png', 0 FROM locations WHERE name = 'Campsite';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00044_.png', 1 FROM locations WHERE name = 'Car';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00045_.png', 0 FROM locations WHERE name = 'Car';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00023_.png', 1 FROM locations WHERE name = 'Sarah''s Apartment';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00025_.png', 0 FROM locations WHERE name = 'Sarah''s Apartment';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00048_.png', 1 FROM locations WHERE name = 'Motel';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00020_.png', 1 FROM locations WHERE name = 'Park at Night';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00021_.png', 0 FROM locations WHERE name = 'Park at Night';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00022_.png', 0 FROM locations WHERE name = 'Park at Night';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00001_.png', 1 FROM locations WHERE name = 'Sarah''s Room';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00003_.png', 0 FROM locations WHERE name = 'Sarah''s Room';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00006_.png', 0 FROM locations WHERE name = 'Sarah''s Room';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00038_.png', 1 FROM locations WHERE name = 'Bathroom';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00039_.png', 0 FROM locations WHERE name = 'Bathroom';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00040_.png', 0 FROM locations WHERE name = 'Bathroom';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00013_.png', 1 FROM locations WHERE name = 'Beach';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00017_.png', 0 FROM locations WHERE name = 'Beach';
    INSERT OR IGNORE INTO location_backgrounds (location_id, filename, is_default) SELECT id, 'ComfyUI_temp_akhfb_00018_.png', 0 FROM locations WHERE name = 'Beach'
  `);
} catch (_) {}

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
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_char_rel_global ON character_relationships(from_character_id, to_character_id)"); } catch (_) {}

// Fix existing scene_images: prepend scenario_id/ to bare basenames (no path separator means old format)
try { db.exec("UPDATE scene_images SET filename = CAST(scenario_id AS TEXT) || '/' || filename WHERE instr(filename, '/') = 0"); } catch (_) {}

export default db;
