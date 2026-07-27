import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-a1111-'));
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
await import('../../db.js');
const { default: express } = await import('express');
const { default: a1111Router } = await import('../a1111.js');

const app = express();
app.use(express.json());
app.use('/api/a1111', a1111Router);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test("GET /api/a1111/vaes proxies A1111's VAE catalog", async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(String(url), /\/sdapi\/v1\/sd-vae$/);
    return {
      ok: true,
      json: async () => ([{ model_name: 'vae-ft-mse-840000-ema-pruned.safetensors' }, { model_name: 'Automatic' }]),
    };
  });

  const res = await realFetch(`${baseUrl}/api/a1111/vaes`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.deepEqual(json.vaes.map((v) => v.name), ['vae-ft-mse-840000-ema-pruned.safetensors', 'Automatic']);
});

test('GET /api/a1111/vaes returns 502 with the upstream error when A1111 is unreachable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:7860'); });

  const res = await realFetch(`${baseUrl}/api/a1111/vaes`);
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /ECONNREFUSED/);
});
