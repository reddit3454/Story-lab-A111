import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-looks-'));
const DIRS = { data: path.join(ROOT, 'data'), images: path.join(ROOT, 'images'), audio: path.join(ROOT, 'audio') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images, AUDIO_DIR: DIRS.audio,
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const realFetch = globalThis.fetch;
const { default: db } = await import('../../db.js');
const { default: express } = await import('express');
const { default: looksRouter } = await import('../looks.js');
const { resolveEffectiveConfig, resolveActiveLook } = await import('../../services/config-resolver.js');

const app = express();
app.use(express.json());
app.use('/api/looks', looksRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

async function get(p) {
  const res = await realFetch(`${baseUrl}${p}`);
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function post(p, body) {
  const res = await realFetch(`${baseUrl}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

test('db seeds exactly one active Look on boot', () => {
  const activeRows = db.prepare('SELECT id, name FROM image_looks WHERE is_active = 1').all();
  assert.equal(activeRows.length, 1);
  assert.equal(activeRows[0].name, 'Stylized 3D Cinematic');
  const defaultLook = db.prepare("SELECT id FROM image_looks WHERE name = 'Stylized 3D Cinematic'").get();
  assert.ok(defaultLook, 'expected the default Look row');
});

test('GET /api/looks lists Looks with boolean is_active', async () => {
  const { status, json } = await get('/api/looks');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json));
  assert.ok(json.length >= 1, 'expected at least the default Look');
  assert.equal(typeof json[0].is_active, 'boolean');
});

test('activating a Look deactivates every other Look — exactly one active at a time', async () => {
  const created = await post('/api/looks', {
    name: 'Test Look A',
    prompt_prefix: 'style A prefix',
    negative: 'style A negative',
  });
  assert.equal(created.status, 201);
  const lookAId = created.json.id;

  const createdB = await post('/api/looks', {
    name: 'Test Look B',
    prompt_prefix: 'style B prefix',
    negative: 'style B negative',
  });
  const lookBId = createdB.json.id;

  const activateA = await post(`/api/looks/${lookAId}/activate`);
  assert.equal(activateA.status, 200);
  assert.equal(activateA.json.is_active, true);

  let activeRows = db.prepare('SELECT id FROM image_looks WHERE is_active = 1').all();
  assert.equal(activeRows.length, 1);
  assert.equal(activeRows[0].id, lookAId);

  const activateB = await post(`/api/looks/${lookBId}/activate`);
  assert.equal(activateB.status, 200);

  activeRows = db.prepare('SELECT id FROM image_looks WHERE is_active = 1').all();
  assert.equal(activeRows.length, 1, 'exactly one Look must be active after switching');
  assert.equal(activeRows[0].id, lookBId);

  const lookARow = db.prepare('SELECT is_active FROM image_looks WHERE id = ?').get(lookAId);
  assert.equal(lookARow.is_active, 0);
});

test('resolveEffectiveConfig merges the active Look over the no-Look fallback, never overriding a1111_url', () => {
  const created = db.prepare(`
    INSERT INTO image_looks (name, prompt_prefix, prompt_suffix, negative, steps, cfg, sampler, checkpoint)
    VALUES ('Effective Test Look', 'prefix-x', 'suffix-x', 'neg-x', 40, 9.5, 'Euler a', 'someCheckpoint.safetensors')
  `).run();
  db.prepare('UPDATE image_looks SET is_active = 0').run();
  db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(created.lastInsertRowid);

  const effective = resolveEffectiveConfig(db);
  assert.equal(effective.look.id, created.lastInsertRowid);
  assert.equal(effective.steps, 40);
  assert.equal(effective.cfg, 9.5);
  assert.equal(effective.sampler, 'Euler a');
  assert.equal(effective.checkpoint, 'someCheckpoint.safetensors');
  assert.equal(effective.a1111_url, 'http://127.0.0.1:7860', 'Look must never override the connection URL');
  assert.match(effective.master_negative, /bad anatomy/, 'master negative must always be present and untouched by the Look');

  const active = resolveActiveLook(db);
  assert.equal(active.id, created.lastInsertRowid);
});

test("resolveEffectiveConfig reads a Look's own columns even when they are at fresh-install defaults", () => {
  const created = db.prepare(`INSERT INTO image_looks (name) VALUES ('Bare Look')`).run();
  db.prepare('UPDATE image_looks SET is_active = 0').run();
  db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(created.lastInsertRowid);

  const effective = resolveEffectiveConfig(db);
  assert.equal(effective.steps, 30);
  assert.equal(effective.cfg, 7);
  assert.equal(effective.sampler, 'DPM++ 2M SDE');
});

test('resolveEffectiveConfig falls back to hardcoded defaults when no Look is active at all', () => {
  db.prepare('UPDATE image_looks SET is_active = 0').run();

  const effective = resolveEffectiveConfig(db);
  assert.equal(effective.look, null);
  assert.equal(effective.steps, 30);
  assert.equal(effective.cfg, 7);
  assert.equal(effective.sampler, 'DPM++ 2M SDE');
  assert.equal(effective.width, 832);
  assert.equal(effective.height, 1216);
});

test('resolveEffectiveConfig exposes vae/clip_skip/restore_faces/tiling from the active Look', () => {
  const created = db.prepare(`
    INSERT INTO image_looks (name, vae, clip_skip, restore_faces, tiling)
    VALUES ('Rendering Test Look', 'someVae.safetensors', 2, 1, 1)
  `).run();
  db.prepare('UPDATE image_looks SET is_active = 0').run();
  db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(created.lastInsertRowid);

  const effective = resolveEffectiveConfig(db);
  assert.equal(effective.vae, 'someVae.safetensors');
  assert.equal(effective.clip_skip, 2);
  assert.equal(effective.restore_faces, true);
  assert.equal(effective.tiling, true);
});

test('DELETE /api/looks/:id keeps exactly one Look active when the active Look is deleted', async () => {
  const a = await post('/api/looks', { name: 'Delete Me Active' });
  const b = await post('/api/looks', { name: 'Delete Me Survivor' });
  await post(`/api/looks/${a.json.id}/activate`);

  const res = await realFetch(`${baseUrl}/api/looks/${a.json.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);

  const activeRows = db.prepare('SELECT id FROM image_looks WHERE is_active = 1').all();
  assert.equal(activeRows.length, 1, 'a Look must still be active after the active one is deleted');
});
