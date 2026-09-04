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

test('GET /api/a1111/controlnet/faceid-options returns only installed verified FaceID pairs', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const target = String(url);
    if (target.endsWith('/controlnet/model_list')) {
      return {
        ok: true,
        json: async () => ({ model_list: [
          'ip-adapter-faceid-plusv2_sdxl [187cb962]',
          'ip-adapter-faceid_sdxl [59ee31a3]',
          'ip-adapter-faceid-portrait_sdxl [8c9efc20]',
          'ip-adapter-faceid-plusv2_sdxl_lora [e462a57c]',
        ] }),
      };
    }
    if (target.endsWith('/controlnet/module_list')) {
      return {
        ok: true,
        json: async () => ({ module_list: ['ip-adapter_face_id', 'ip-adapter_face_id_plus', 'ip-adapter_clip_sdxl'] }),
      };
    }
    throw new Error(`Unexpected request: ${target}`);
  });

  const res = await realFetch(`${baseUrl}/api/a1111/controlnet/faceid-options`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.deepEqual(json.options, [
    {
      model: 'ip-adapter-faceid-plusv2_sdxl [187cb962]',
      module: 'ip-adapter_face_id_plus',
      label: 'FaceID Plus v2 (SDXL)',
    },
    {
      model: 'ip-adapter-faceid_sdxl [59ee31a3]',
      module: 'ip-adapter_face_id',
      label: 'FaceID (SDXL)',
    },
  ]);
});

test('GET /api/a1111/controlnet/pose-options returns an installed SDXL OpenPose model with the prepared-skeleton module', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const target = String(url);
    if (target.endsWith('/controlnet/model_list')) {
      return { ok: true, json: async () => ({ model_list: ['OpenPoseXL2 [f4251cb4]', 'control_v11p_sd15_openpose [cab727d4]'] }) };
    }
    if (target.endsWith('/controlnet/module_list')) {
      return { ok: true, json: async () => ({ module_list: ['none', 'openpose_full'] }) };
    }
    throw new Error(`Unexpected request: ${target}`);
  });

  const res = await realFetch(`${baseUrl}/api/a1111/controlnet/pose-options`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.deepEqual(json.options, [{
    model: 'OpenPoseXL2 [f4251cb4]',
    module: 'none',
    label: 'OpenPoseXL2 (prepared skeleton)',
  }]);
});

test('PUT /api/a1111/controlnet/pose-config persists only a live verified pose option', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const target = String(url);
    if (target.endsWith('/controlnet/model_list')) {
      return { ok: true, json: async () => ({ model_list: ['OpenPoseXL2 [f4251cb4]'] }) };
    }
    if (target.endsWith('/controlnet/module_list')) {
      return { ok: true, json: async () => ({ module_list: ['none'] }) };
    }
    throw new Error(`Unexpected request: ${target}`);
  });

  const res = await realFetch(`${baseUrl}/api/a1111/controlnet/pose-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'OpenPoseXL2 [f4251cb4]', module: 'none' }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.config, { model: 'OpenPoseXL2 [f4251cb4]', module: 'none' });
});

test('PUT /api/a1111/controlnet/faceid-config rejects an unverified model-module pair', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const target = String(url);
    if (target.endsWith('/controlnet/model_list')) {
      return { ok: true, json: async () => ({ model_list: ['ip-adapter-faceid-plusv2_sdxl [187cb962]'] }) };
    }
    if (target.endsWith('/controlnet/module_list')) {
      return { ok: true, json: async () => ({ module_list: ['ip-adapter_face_id_plus', 'ip-adapter_face_id'] }) };
    }
    throw new Error(`Unexpected request: ${target}`);
  });

  const res = await realFetch(`${baseUrl}/api/a1111/controlnet/faceid-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'ip-adapter-faceid-plusv2_sdxl [187cb962]',
      module: 'ip-adapter_face_id',
    }),
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /verified FaceID option/);
});
