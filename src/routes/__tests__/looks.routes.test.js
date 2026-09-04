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
async function put(p, body) {
  const res = await realFetch(`${baseUrl}${p}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function del(p) {
  const res = await realFetch(`${baseUrl}${p}`, { method: 'DELETE' });
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

test('saving a draft never changes its source live Look', async () => {
  const created = await post('/api/looks', {
    name: 'Draft Isolation Look',
    prompt_prefix: 'original prefix',
    loras: [{ file: 'original.safetensors', strength: 0.8 }],
  });
  const draft = await post(`/api/looks/${created.json.id}/drafts`);
  assert.equal(draft.status, 201);
  const saved = await put(`/api/looks/drafts/${draft.json.id}`, {
    prompt_prefix: 'draft-only prefix',
    loras: [{ file: 'draft.safetensors', strength: 0.55 }],
  });
  assert.equal(saved.status, 200);

  const live = await get(`/api/looks/${created.json.id}`);
  assert.equal(live.json.prompt_prefix, 'original prefix');
  assert.deepEqual(JSON.parse(live.json.loras_json), [{ file: 'original.safetensors', strength: 0.8 }]);
});

test('discard deletes only the draft', async () => {
  const created = await post('/api/looks', { name: 'Draft Discard Look', prompt_prefix: 'original' });
  const draft = await post(`/api/looks/${created.json.id}/drafts`);
  assert.equal((await del(`/api/looks/drafts/${draft.json.id}`)).status, 200);
  assert.equal((await get(`/api/looks/${created.json.id}`)).status, 200);
  assert.equal((await get(`/api/looks/drafts/${draft.json.id}`)).status, 404);
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

test('POST /api/looks persists every full-ownership field', async () => {
  const body = {
    name: 'Full Field Look',
    description: 'covers every setting',
    checkpoint: 'someModel.safetensors',
    vae: 'someVae.safetensors',
    clip_skip: 2,
    restore_faces: true,
    tiling: true,
    loras: [{ file: 'styleLora', strength: 0.6 }, { file: 'detailLora', strength: 1 }],
    prompt_prefix: 'prefix', prompt_suffix: 'suffix', negative: 'neg',
    sampler: 'Euler a', scheduler: 'Exponential', steps: 25, cfg: 6.5, width: 768, height: 1024,
  };
  const created = await post('/api/looks', body);
  assert.equal(created.status, 201);
  assert.equal(created.json.vae, 'someVae.safetensors');
  assert.equal(created.json.clip_skip, 2);
  assert.equal(created.json.restore_faces, true);
  assert.equal(created.json.tiling, true);
  assert.deepEqual(JSON.parse(created.json.loras_json), body.loras);
  assert.equal(created.json.sampler, 'Euler a');
  assert.equal(created.json.scheduler, 'Exponential');
  assert.equal(created.json.steps, 25);
  assert.equal(created.json.cfg, 6.5);
  assert.equal(created.json.width, 768);
  assert.equal(created.json.height, 1024);

  const updated = await realFetch(`${baseUrl}/api/looks/${created.json.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, scheduler: 'Karras', loras: [] }),
  });
  const updatedJson = await updated.json();
  assert.equal(updatedJson.scheduler, 'Karras');
  assert.deepEqual(JSON.parse(updatedJson.loras_json), []);
});

test('POST /api/looks defaults new fields sanely when omitted', async () => {
  const created = await post('/api/looks', { name: 'Minimal Look' });
  assert.equal(created.status, 201);
  assert.equal(created.json.vae, '');
  assert.equal(created.json.clip_skip, null);
  assert.equal(created.json.restore_faces, false);
  assert.equal(created.json.tiling, false);
  assert.equal(created.json.loras_json, '[]');
  assert.equal(created.json.sampler, 'DPM++ 2M SDE');
  assert.equal(created.json.scheduler, 'Karras');
  assert.equal(created.json.steps, 30);
  assert.equal(created.json.cfg, 7);
  assert.equal(created.json.width, 832);
  assert.equal(created.json.height, 1216);
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

test('POST /api/looks/test-generate runs one txt2img with the draft settings and writes to the scratch folder', async (t) => {
  let capturedPayload = null;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/txt2img')) {
      capturedPayload = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
          info: JSON.stringify({ seed: 99, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }),
        }),
      };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });

  const res = await post('/api/looks/test-generate', {
    prompt_prefix: 'draft prefix', prompt_suffix: 'draft suffix', negative: 'draft neg',
    loras: [{ file: 'draftLora', strength: 0.9 }],
    sampler: 'Euler a', scheduler: 'Karras', steps: 20, cfg: 6, width: 512, height: 512,
    test_subject: 'a woman standing in a park, full body',
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.seed, 99);
  assert.ok(res.json.filename);
  assert.equal(res.json.url, '/story-images/_look-test-scratch/' + res.json.filename);
  assert.ok(fs.existsSync(path.join(DIRS.images, '_look-test-scratch', res.json.filename)));

  assert.match(capturedPayload.prompt, /<lora:draftLora:0\.9>/);
  assert.match(capturedPayload.prompt, /draft prefix/);
  assert.match(capturedPayload.prompt, /a woman standing in a park, full body/);
  assert.match(capturedPayload.prompt, /draft suffix/);
  assert.match(capturedPayload.negative_prompt, /draft neg/);
  assert.match(capturedPayload.negative_prompt, /bad anatomy/, 'server must always append master_negative itself');
  assert.equal(capturedPayload.width, 512);
  assert.equal(capturedPayload.n_iter, 1);
  assert.equal(capturedPayload.batch_size, 1);
});

test('POST /api/looks/test-generate/save moves the file into the permanent saves folder', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (String(url).includes('/sdapi/v1/txt2img')) {
      return {
        ok: true,
        json: async () => ({
          images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
          info: JSON.stringify({ seed: 1 }),
        }),
      };
    }
    throw new Error('unexpected fetch in test: ' + String(url));
  });

  const gen = await post('/api/looks/test-generate', { test_subject: 'test subject' });
  const scratchPath = path.join(DIRS.images, '_look-test-scratch', gen.json.filename);
  assert.ok(fs.existsSync(scratchPath));

  const saved = await post('/api/looks/test-generate/save', { filename: gen.json.filename });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.ok, true);
  assert.equal(saved.json.url, '/story-images/look-test-saves/' + gen.json.filename);

  assert.ok(!fs.existsSync(scratchPath), 'file must be moved out of scratch, not copied');
  assert.ok(fs.existsSync(path.join(DIRS.images, 'look-test-saves', gen.json.filename)));
});

test('POST /api/looks/test-generate/cleanup deletes only the listed scratch files', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (String(url).includes('/sdapi/v1/txt2img')) {
      return {
        ok: true,
        json: async () => ({
          images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
          info: JSON.stringify({ seed: 1 }),
        }),
      };
    }
    throw new Error('unexpected fetch in test: ' + String(url));
  });

  const genA = await post('/api/looks/test-generate', { test_subject: 'a' });
  const genB = await post('/api/looks/test-generate', { test_subject: 'b' });

  const cleanup = await post('/api/looks/test-generate/cleanup', { filenames: [genA.json.filename, 'nonexistent-file.png'] });
  assert.equal(cleanup.status, 200);
  assert.equal(cleanup.json.ok, true);

  assert.ok(!fs.existsSync(path.join(DIRS.images, '_look-test-scratch', genA.json.filename)), 'listed file must be deleted');
  assert.ok(fs.existsSync(path.join(DIRS.images, '_look-test-scratch', genB.json.filename)), 'unlisted file must survive');
});
