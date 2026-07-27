import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateImageLooksSchema, migrateImageLooksData } from '../image-looks-migration.js';

function createOldSchemaDb() {
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
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test('migrateImageLooksSchema adds all new columns with correct defaults', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`INSERT INTO image_looks (name) VALUES ('Fresh Look')`).run();
  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'Fresh Look'`).get();
  assert.equal(row.vae, '');
  assert.equal(row.clip_skip, null);
  assert.equal(row.restore_faces, 0);
  assert.equal(row.tiling, 0);
  assert.equal(row.loras_json, '[]');
  assert.equal(row.sampler, 'DPM++ 2M SDE');
  assert.equal(row.scheduler, 'Karras');
  assert.equal(row.steps, 30);
  assert.equal(row.cfg, 7);
  assert.equal(row.width, 832);
  assert.equal(row.height, 1216);
});

test('migrateImageLooksSchema is safe to run twice (idempotent, no duplicate-column crash)', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  assert.doesNotThrow(() => migrateImageLooksSchema(db));
});

test('migrateImageLooksData copies steps/cfg/sampler overrides into the new columns', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`
    INSERT INTO image_looks (name, steps_override, cfg_override, sampler_override)
    VALUES ('Old Style Look', 40, 9.5, 'Euler a')
  `).run();

  migrateImageLooksData(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'Old Style Look'`).get();
  assert.equal(row.steps, 40);
  assert.equal(row.cfg, 9.5);
  assert.equal(row.sampler, 'Euler a');
});

test('migrateImageLooksData merges lora1/lora2 into loras_json', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`
    INSERT INTO image_looks (name, lora1_file, lora1_strength, lora2_file, lora2_strength)
    VALUES ('LoRA Look', 'styleLora', 0.75, 'detailLora', 0.5)
  `).run();

  migrateImageLooksData(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'LoRA Look'`).get();
  const loras = JSON.parse(row.loras_json);
  assert.deepEqual(loras, [
    { file: 'styleLora', strength: 0.75 },
    { file: 'detailLora', strength: 0.5 },
  ]);
});

test('migrateImageLooksData leaves rows with no old-style data at their fresh defaults', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`INSERT INTO image_looks (name) VALUES ('Bare Look')`).run();

  migrateImageLooksData(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'Bare Look'`).get();
  assert.equal(row.steps, 30);
  assert.equal(row.cfg, 7);
  assert.equal(row.sampler, 'DPM++ 2M SDE');
  assert.equal(row.loras_json, '[]');
});

test('migrateImageLooksData is idempotent — running twice does not double-append or corrupt data', () => {
  const db = createOldSchemaDb();
  migrateImageLooksSchema(db);
  db.prepare(`
    INSERT INTO image_looks (name, steps_override, lora1_file)
    VALUES ('Repeat Look', 50, 'someLora')
  `).run();

  migrateImageLooksData(db);
  migrateImageLooksData(db);

  const row = db.prepare(`SELECT * FROM image_looks WHERE name = 'Repeat Look'`).get();
  assert.equal(row.steps, 50);
  assert.deepEqual(JSON.parse(row.loras_json), [{ file: 'someLora', strength: 1.0 }]);
});
