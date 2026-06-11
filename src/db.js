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
  ['narrator_model',     ''],
  ['narrator_context_turns', '20'],
  ['narrator_max_tokens',    '1200'],
];

for (const [key, value] of _defaults) {
  _insertDefault.run(key, value);
}

export default db;
