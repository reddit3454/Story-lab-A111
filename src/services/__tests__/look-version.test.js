import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { seedLookBaselines } from '../look-version.js';

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE image_looks (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      checkpoint TEXT DEFAULT '',
      vae TEXT DEFAULT '',
      clip_skip INTEGER DEFAULT NULL,
      restore_faces INTEGER DEFAULT 0,
      tiling INTEGER DEFAULT 0,
      loras_json TEXT DEFAULT '[]',
      prompt_prefix TEXT DEFAULT '',
      prompt_suffix TEXT DEFAULT '',
      negative TEXT DEFAULT '',
      sampler TEXT DEFAULT 'DPM++ 2M SDE',
      scheduler TEXT DEFAULT 'Karras',
      steps INTEGER DEFAULT 30,
      cfg REAL DEFAULT 7,
      width INTEGER DEFAULT 832,
      height INTEGER DEFAULT 1216,
      is_active INTEGER DEFAULT 0
    );
    CREATE TABLE image_look_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      look_id INTEGER,
      status TEXT NOT NULL,
      source_version_id INTEGER,
      snapshot_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      activated_at TEXT DEFAULT NULL
    );
  `);
  return db;
}

test('baseline migration snapshots every existing Look exactly once', () => {
  const db = createDb();
  db.prepare(`INSERT INTO image_looks (
    id, name, checkpoint, loras_json, prompt_prefix, prompt_suffix, negative,
    sampler, scheduler, steps, cfg, width, height
  ) VALUES (1, 'Protected Look', 'realcartoonXL_v7.safetensors', ?, 'prefix', 'suffix', 'look negative', 'Euler a', 'Karras', 30, 7, 832, 1216)`).run(
    JSON.stringify([
      { file: 'style.safetensors', strength: 0.7 },
      { file: 'detail.safetensors', strength: 1 },
    ])
  );

  seedLookBaselines(db);
  seedLookBaselines(db);

  const versions = db.prepare("SELECT * FROM image_look_versions WHERE status = 'baseline'").all();
  assert.equal(versions.length, 1);
  const snapshot = JSON.parse(versions[0].snapshot_json);
  assert.equal(snapshot.prompt_prefix, 'prefix');
  assert.equal(snapshot.prompt_suffix, 'suffix');
  assert.equal(snapshot.negative, 'look negative');
  assert.equal(snapshot.checkpoint, 'realcartoonXL_v7.safetensors');
  assert.deepEqual(snapshot.loras, [
    { file: 'style.safetensors', strength: 0.7 },
    { file: 'detail.safetensors', strength: 1 },
  ]);
});
