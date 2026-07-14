// Route-level regression tests for CF-4: Character Editor reference/fullbody generation
// must go through the same buildA1111Payload/callA1111 helpers as the main image
// pipeline, not a separate/drifted payload builder. Spins up the real Express router on
// an ephemeral local port and drives it with built-in fetch (no Supertest). Uses a real
// in-memory SQLite DB (redirected off story-lab.db) and a mocked global fetch for the
// outbound A1111 call — no real server involved anywhere.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-cf4route-'));
const DIRS = { data: path.join(ROOT, 'data'), images: path.join(ROOT, 'images') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images,
    BACKGROUNDS_DIR: path.join(ROOT, 'backgrounds'), AUDIO_DIR: path.join(ROOT, 'audio'),
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

// Captured before any test mocks globalThis.fetch — used by the tests themselves to
// reach the local Express server. The mocked globalThis.fetch (installed per-test below)
// only needs to intercept the *internal* outbound call routes/characters.js makes to
// A1111 via a1111.js's unqualified `fetch(...)` reference.
const realFetch = globalThis.fetch;

const { default: db } = await import('../../db.js');
const { default: express } = await import('express');
const { default: charactersRouter } = await import('../characters.js');

const app = express();
app.use(express.json());
app.use('/api/characters', charactersRouter);
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise(resolve => server.close(resolve)));

const FAKE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function seedCharacter(name = 'Riley') {
  return db.prepare(
    `INSERT INTO characters (name, role, gender) VALUES (?, 'character', 'female')`
  ).run(name).lastInsertRowid;
}

function installA1111Capture(t, { failFirst = false } = {}) {
  const calls = [];
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const urlStr = String(url);
    if (!urlStr.includes('/sdapi/v1/txt2img')) {
      throw new Error(`unexpected fetch call in CF-4 route test: ${urlStr}`);
    }
    count++;
    calls.push(JSON.parse(init.body));
    if (failFirst && count === 1) {
      return { ok: false, status: 500, text: async () => 'AutoencoderKL state_dict mismatch' };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ images: [FAKE_PNG_BASE64], info: JSON.stringify({ seed: 7, sd_model_name: 'm', sd_model_hash: 'h' }) }),
    };
  });
  return calls;
}

test('CF-4: POST /:id/references/generate uses the shared payload builder (sd_vae present)', async (t) => {
  db.prepare(`INSERT OR REPLACE INTO global_config (key, value) VALUES ('a1111_vae', 'sharedVae.safetensors')`).run();
  const calls = installA1111Capture(t);
  const charId = seedCharacter();

  const res = await realFetch(`${baseUrl}/api/characters/${charId}/references/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  const body = await res.json();

  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].override_settings.sd_vae, 'sharedVae.safetensors',
    'route payload must carry the sd_vae override from the shared buildA1111Payload — proves it is not a duplicate builder');
});

test('CF-4: POST /:id/fullbody/generate uses the shared payload builder (sd_vae present)', async (t) => {
  db.prepare(`INSERT OR REPLACE INTO global_config (key, value) VALUES ('a1111_vae', 'sharedVae.safetensors')`).run();
  const calls = installA1111Capture(t);
  const charId = seedCharacter('Sarah');

  const res = await realFetch(`${baseUrl}/api/characters/${charId}/fullbody/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  const body = await res.json();

  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].override_settings.sd_vae, 'sharedVae.safetensors');
});

test('CF-4: reference generation never submits a self-referencing FaceID/controlnet image', async (t) => {
  db.prepare(`INSERT OR REPLACE INTO global_config (key, value) VALUES ('ipadapter_enabled', 'true')`).run();
  const calls = installA1111Capture(t);
  const charId = seedCharacter('NoSelfRef');

  const res = await realFetch(`${baseUrl}/api/characters/${charId}/references/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });

  assert.equal(res.status, 201);
  assert.equal(calls[0].alwayson_scripts?.controlnet, undefined,
    'a character cannot IP-Adapter-reference itself; the shared builder must receive null and omit controlnet '
    + '(alwayson_scripts itself may still be present for unrelated ADetailer config)');
});

test('CF-4: reference generation retries and succeeds after a transient AutoencoderKL failure (shared callA1111 retry path)', async (t) => {
  const calls = installA1111Capture(t, { failFirst: true });
  const charId = seedCharacter('RetryCase');

  const res = await realFetch(`${baseUrl}/api/characters/${charId}/references/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  const body = await res.json();

  assert.equal(res.status, 201, `expected the route to succeed after retry, got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(calls.length, 2, 'expected the shared callA1111 retry to have fired exactly once');
});

test('CF-4: no local duplicate payload builder remains in routes/characters.js', async () => {
  const source = fs.readFileSync(new URL('../characters.js', import.meta.url), 'utf8');
  assert.ok(!/_buildPayload\s*\(/.test(source), 'a local _buildPayload duplicate must not be reintroduced');
  assert.ok(/buildA1111Payload/.test(source) && /callA1111/.test(source),
    'routes/characters.js must import and call the shared buildA1111Payload/callA1111 helpers');
  assert.ok(!/a1111\.txt2img\(/.test(source),
    'routes/characters.js must not call a1111.txt2img directly — it must go through the shared callA1111 wrapper');
});
