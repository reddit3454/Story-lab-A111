import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_LOOK,
  DEFAULT_LOOK_NAME,
  DEFAULT_LOOK_CHECKPOINT,
  LEGACY_SEED_FINGERPRINTS,
  seedAndMigrateDefaultLooks,
  isUntouchedLegacySeedLook,
} from '../default-look.js';
import { buildPrompt, stripStyleWords } from '../services/prompt-builder.js';
import { resolveEffectiveConfig } from '../services/config-resolver.js';

function createLooksDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE image_looks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      checkpoint TEXT DEFAULT '',
      lora1_file TEXT DEFAULT '',
      lora1_strength REAL DEFAULT 1.0,
      lora2_file TEXT DEFAULT '',
      lora2_strength REAL DEFAULT 1.0,
      prompt_prefix TEXT DEFAULT '',
      prompt_suffix TEXT DEFAULT '',
      negative TEXT DEFAULT '',
      steps_override INTEGER DEFAULT NULL,
      cfg_override REAL DEFAULT NULL,
      sampler_override TEXT DEFAULT NULL,
      vae TEXT DEFAULT '',
      clip_skip INTEGER DEFAULT NULL,
      restore_faces INTEGER DEFAULT 0,
      tiling INTEGER DEFAULT 0,
      loras_json TEXT DEFAULT '[]',
      sampler TEXT DEFAULT 'DPM++ 2M SDE',
      scheduler TEXT DEFAULT 'Karras',
      steps INTEGER DEFAULT 30,
      cfg REAL DEFAULT 7,
      width INTEGER DEFAULT 832,
      height INTEGER DEFAULT 1216,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_image_looks_name ON image_looks(name);
    CREATE TABLE global_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    INSERT INTO global_config (key, value) VALUES
      ('a1111_url', 'http://127.0.0.1:7860'),
      ('master_negative', 'lowres, bad anatomy, bad hands');
  `);
  return db;
}

function insertLegacyLook(db, name) {
  const fp = LEGACY_SEED_FINGERPRINTS[name];
  db.prepare(`
    INSERT INTO image_looks (name, description, prompt_prefix, prompt_suffix, negative, is_active)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(name, fp.description, fp.prompt_prefix, fp.prompt_suffix, fp.negative);
}

test('fresh DB seeds Stylized 3D Cinematic as the only default active Look', () => {
  const db = createLooksDb();
  seedAndMigrateDefaultLooks(db);
  const active = db.prepare('SELECT * FROM image_looks WHERE is_active = 1').all();
  assert.equal(active.length, 1);
  assert.equal(active[0].name, DEFAULT_LOOK_NAME);
  assert.equal(active[0].checkpoint, DEFAULT_LOOK_CHECKPOINT);
  assert.match(active[0].prompt_prefix, /stylized 3D character render/i);
  assert.match(active[0].negative, /photorealistic photograph/i);
});

test('migration switches active from untouched legacy Cinematic to default', () => {
  const db = createLooksDb();
  insertLegacyLook(db, 'Photoreal');
  insertLegacyLook(db, 'Cinematic');
  const cinematic = db.prepare("SELECT id FROM image_looks WHERE name = 'Cinematic'").get();
  db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(cinematic.id);
  seedAndMigrateDefaultLooks(db);
  const active = db.prepare('SELECT name FROM image_looks WHERE is_active = 1').get();
  assert.equal(active.name, DEFAULT_LOOK_NAME);
  const legacyCount = db.prepare('SELECT COUNT(*) AS c FROM image_looks').get().c;
  assert.equal(legacyCount, 3, 'legacy Looks remain available');
});

test('migration does not steal activation from a user-customized active Look', () => {
  const db = createLooksDb();
  db.prepare(`
    INSERT INTO image_looks (name, description, prompt_prefix, prompt_suffix, negative, is_active)
    VALUES ('My Custom Look', 'user', 'my custom prefix', '', 'my neg', 1)
  `).run();
  seedAndMigrateDefaultLooks(db);
  const active = db.prepare('SELECT name FROM image_looks WHERE is_active = 1').get();
  assert.equal(active.name, 'My Custom Look');
  const defaultRow = db.prepare('SELECT id FROM image_looks WHERE name = ?').get(DEFAULT_LOOK_NAME);
  assert.ok(defaultRow, 'default Look was added without overwriting user selection');
});

test('migration is idempotent on restart', () => {
  const db = createLooksDb();
  seedAndMigrateDefaultLooks(db);
  seedAndMigrateDefaultLooks(db);
  const rows = db.prepare('SELECT name, is_active FROM image_looks ORDER BY id').all();
  assert.equal(rows.filter((r) => r.name === DEFAULT_LOOK_NAME).length, 1);
  assert.equal(rows.filter((r) => r.is_active === 1).length, 1);
});

test('untouched legacy fingerprint helper recognizes original Cinematic seed', () => {
  const db = createLooksDb();
  insertLegacyLook(db, 'Cinematic');
  const row = db.prepare("SELECT * FROM image_looks WHERE name = 'Cinematic'").get();
  assert.equal(isUntouchedLegacySeedLook(row), true);
  db.prepare("UPDATE image_looks SET prompt_prefix = 'user edited' WHERE name = 'Cinematic'").run();
  const edited = db.prepare("SELECT * FROM image_looks WHERE name = 'Cinematic'").get();
  assert.equal(isUntouchedLegacySeedLook(edited), false);
});

test('default Look style block is first in prompt assembly; content strip still works', () => {
  const lookRow = { ...DEFAULT_LOOK, id: 1 };
  const { prompt, negative, parts } = buildPrompt({
    look: lookRow,
    characters: ['adult woman, green eyes'],
    actionText: 'masterpiece, cinematic, standing by a window',
    clothingText: 'casual outfit',
    locationTags: 'cozy apartment interior',
    masterNegative: 'lowres, bad anatomy, bad hands',
  });
  assert.ok(prompt.indexOf('stylized 3D character render') < prompt.indexOf('adult woman'));
  assert.ok(prompt.indexOf('adult woman') < prompt.indexOf('standing by a window'));
  assert.match(negative, /photorealistic photograph/);
  assert.match(negative, /bad anatomy/);
  assert.equal(parts.action, 'standing by a window');
  assert.equal(stripStyleWords('masterpiece, cinematic, photoreal'), '');
});

test('resolveEffectiveConfig exposes default checkpoint and untouched master negative', () => {
  const db = createLooksDb();
  seedAndMigrateDefaultLooks(db);
  const effective = resolveEffectiveConfig(db);
  assert.equal(effective.look.name, DEFAULT_LOOK_NAME);
  assert.equal(effective.checkpoint, DEFAULT_LOOK_CHECKPOINT);
  assert.match(effective.master_negative, /bad anatomy/);
});

test('fresh DB seeds the default Look with concrete sampling settings, not null overrides', () => {
  const db = createLooksDb();
  seedAndMigrateDefaultLooks(db);
  const row = db.prepare('SELECT * FROM image_looks WHERE is_active = 1').get();
  assert.equal(row.sampler, 'DPM++ 2M SDE');
  assert.equal(row.scheduler, 'Karras');
  assert.equal(row.steps, 30);
  assert.equal(row.cfg, 7);
  assert.equal(row.width, 832);
  assert.equal(row.height, 1216);
  assert.equal(row.loras_json, '[]');
});

test('editing only a new-style field on the default Look is treated as user customization and survives re-seeding', () => {
  const db = createLooksDb();
  seedAndMigrateDefaultLooks(db);
  db.prepare(`UPDATE image_looks SET scheduler = 'Exponential' WHERE name = ?`).run(DEFAULT_LOOK_NAME);

  seedAndMigrateDefaultLooks(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = ?`).get(DEFAULT_LOOK_NAME);
  assert.equal(row.scheduler, 'Exponential', 'user edit to a new-style field must not be silently reset');
});
