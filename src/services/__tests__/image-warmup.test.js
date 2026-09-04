// image-warmup: fires a throwaway 64x64 generation carrying the real ControlNet
// units so A1111 loads the models before the user's real Generate.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-warmup-'));
const DIRS = { data: path.join(ROOT, 'data'), images: path.join(ROOT, 'images'), poses: path.join(ROOT, 'poses') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images, AUDIO_DIR: path.join(ROOT, 'audio'),
    POSE_LIBRARY_DIR: DIRS.poses,
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const { default: db } = await import('../../db.js');
const { warmup } = await import('../image-warmup.js');

function seed({ faceRef = false, warmupEnabled = false } = {}) {
  const scenarioId = db.prepare("INSERT INTO scenarios (title) VALUES ('W')").run().lastInsertRowid;
  const charId = db.prepare("INSERT INTO characters (name, role) VALUES ('Ada', 'character')").run().lastInsertRowid;
  db.prepare('INSERT INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)').run(scenarioId, charId);
  if (faceRef) {
    const dir = path.join(DIRS.images, 'characters', String(charId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'face.png'), 'face-bytes');
    db.prepare('UPDATE characters SET reference_image_path = ? WHERE id = ?').run(`characters/${charId}/face.png`, charId);
  }
  const cfg = db.prepare("INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))");
  cfg.run('a1111_faceid_model', 'ip-adapter-faceid-plusv2_sdxl [187cb962]');
  cfg.run('a1111_faceid_module', 'ip-adapter_face_id_plus');
  if (warmupEnabled) cfg.run('image_warmup_enabled', 'true');
  return { scenarioId, charId };
}

function mockFetch(t, { busy = false, offline = false, onGenerate } = {}) {
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (offline) throw new Error('ECONNREFUSED');
    if (u.includes('/sdapi/v1/options')) return { ok: true, json: async () => ({ sd_model_checkpoint: 'x' }) };
    if (u.includes('/sdapi/v1/progress')) {
      return { ok: true, json: async () => (busy ? { progress: 0.3, state: { job_count: 1 } } : { progress: 0, state: { job_count: 0 } }) };
    }
    if (u.includes('/sdapi/v1/txt2img')) {
      if (onGenerate) onGenerate(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ images: [], info: '{}' }) };
    }
    if (u.includes('/interrupt')) return { ok: true, json: async () => ({}) };
    throw new Error('unexpected fetch: ' + u);
  });
}

test('automatic warm-up is disabled unless explicitly enabled', async (t) => {
  let called = false;
  mockFetch(t, { onGenerate: () => { called = true; } });
  const { scenarioId, charId } = seed({ faceRef: true });

  await warmup({ scenarioId, characterIds: [charId], poseId: null });
  assert.equal(called, false);
});

test('enabled warm-up sends a 64x64 single-step txt2img with the FaceID ControlNet unit', async (t) => {
  let payload = null;
  mockFetch(t, { onGenerate: (p) => { payload = p; } });
  const { scenarioId, charId } = seed({ faceRef: true, warmupEnabled: true });

  await warmup({ scenarioId, characterIds: [charId], poseId: null });

  assert.ok(payload, 'a warm-up generation was submitted');
  assert.equal(payload.width, 64);
  assert.equal(payload.height, 64);
  assert.equal(payload.steps, 1);
  assert.equal(payload.save_images, false);
  const units = payload.alwayson_scripts.controlnet.args;
  assert.equal(units.length, 1);
  assert.equal(units[0].model, 'ip-adapter-faceid-plusv2_sdxl [187cb962]');
});

test('warm-up does nothing while A1111 is mid-render', async (t) => {
  let called = false;
  mockFetch(t, { busy: true, onGenerate: () => { called = true; } });
  const { scenarioId, charId } = seed({ faceRef: true, warmupEnabled: true });

  await warmup({ scenarioId, characterIds: [charId], poseId: null });
  assert.equal(called, false);
});

test('warm-up swallows an offline A1111', async (t) => {
  mockFetch(t, { offline: true });
  const { scenarioId, charId } = seed({ faceRef: true, warmupEnabled: true });
  await warmup({ scenarioId, characterIds: [charId], poseId: null }); // must not throw
});
