// Pure-function tests for buildA1111Payload — no network, no filesystem.
// Protects CF-4: this is the single shared payload builder used by both the main
// scene/character generation path and the Character Editor reference/fullbody routes.
//
// buildA1111Payload is exported from image-pipeline.js, which imports db.js at module
// scope (unavoidable — ESM has no way to import one export without running the whole
// module's top-level code). paths.js is mocked to ':memory:' purely so this file never
// opens the real story-lab.db just to reach a function that itself does no DB work.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-a1111payload-'));
mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'), DATA_DIR: ROOT,
    IMAGES_DIR: path.join(ROOT, 'images'), BACKGROUNDS_DIR: path.join(ROOT, 'backgrounds'),
    AUDIO_DIR: path.join(ROOT, 'audio'), DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(ROOT, 'audit.jsonl'),
  },
});

const { buildA1111Payload, getControlNetCatalog } = await import('../image-pipeline.js');

const BASE_CONFIG = {
  a1111_steps: 30, a1111_cfg: 7, a1111_width: 832, a1111_height: 1216,
  a1111_sampler: 'DPM++ 2M SDE', a1111_scheduler: 'Karras', a1111_clip_skip: 2,
};

test('buildA1111Payload always sets an sd_vae override (Automatic when unset)', () => {
  const payload = buildA1111Payload(BASE_CONFIG, 'a prompt', 'a negative', null);
  assert.equal(payload.override_settings.sd_vae, 'Automatic');
});

test('buildA1111Payload uses the configured VAE filename when set', () => {
  const payload = buildA1111Payload({ ...BASE_CONFIG, a1111_vae: 'myVae.safetensors' }, 'p', 'n', null);
  assert.equal(payload.override_settings.sd_vae, 'myVae.safetensors');
});

test('buildA1111Payload omits Hires.fix fields when hr_enabled is falsy', () => {
  const payload = buildA1111Payload(BASE_CONFIG, 'p', 'n', null);
  assert.equal(payload.enable_hr, undefined);
});

test('buildA1111Payload includes Hires.fix fields when hr_enabled is true', () => {
  const payload = buildA1111Payload({ ...BASE_CONFIG, hr_enabled: true, hr_scale: 2, hr_steps: 15 }, 'p', 'n', null);
  assert.equal(payload.enable_hr, true);
  assert.equal(payload.hr_scale, 2);
  assert.equal(payload.hr_second_pass_steps, 15);
});

test('buildA1111Payload includes ADetailer alwayson_scripts entry when ad_enabled is true', () => {
  const payload = buildA1111Payload({ ...BASE_CONFIG, ad_enabled: true, ad_model: 'face_yolov8n.pt' }, 'p', 'n', null);
  assert.ok(payload.alwayson_scripts?.ADetailer, 'expected ADetailer block');
  assert.equal(payload.alwayson_scripts.ADetailer.args[0].ad_model, 'face_yolov8n.pt');
});

test('buildA1111Payload includes refiner_checkpoint only when refiner_enabled and a checkpoint are set', () => {
  const withRefiner = buildA1111Payload({ ...BASE_CONFIG, refiner_enabled: true, refiner_checkpoint: 'refinerXL.safetensors' }, 'p', 'n', null);
  assert.equal(withRefiner.refiner_checkpoint, 'refinerXL.safetensors');

  const withoutCheckpoint = buildA1111Payload({ ...BASE_CONFIG, refiner_enabled: true }, 'p', 'n', null);
  assert.equal(withoutCheckpoint.refiner_checkpoint, undefined,
    'refiner_enabled alone (no checkpoint configured) must not add a refiner block');
});

test('buildA1111Payload omits the controlnet block when no reference image is provided (self-portrait case)', () => {
  const payload = buildA1111Payload({ ...BASE_CONFIG, ipadapter_enabled: true, ipadapter_model: 'm [hash]', _controlnet_ready: true }, 'p', 'n', null);
  assert.equal(payload.alwayson_scripts, undefined,
    'Character Editor reference/fullbody generation passes null and must never submit a self-referencing FaceID image');
});

test('buildA1111Payload includes the controlnet block only when a reference image AND ipadapter_enabled AND _controlnet_ready all hold', () => {
  const base64Image = Buffer.from('fake-image-bytes').toString('base64');
  const ready = { ...BASE_CONFIG, ipadapter_enabled: true, ipadapter_model: 'm [hash]', _controlnet_ready: true };

  const enabled = buildA1111Payload(ready, 'p', 'n', base64Image);
  assert.ok(enabled.alwayson_scripts?.controlnet, 'expected controlnet block when all gates pass');
  assert.equal(enabled.alwayson_scripts.controlnet.args[0].image, base64Image);

  const disabledFlag = buildA1111Payload({ ...ready, ipadapter_enabled: false }, 'p', 'n', base64Image);
  assert.equal(disabledFlag.alwayson_scripts, undefined, 'ipadapter_enabled=false must omit controlnet even with an image');

  const notReady = buildA1111Payload({ ...ready, _controlnet_ready: false }, 'p', 'n', base64Image);
  assert.equal(notReady.alwayson_scripts, undefined,
    '_controlnet_ready=false (unset by generate()\'s preflight) must omit the block even with ipadapter_enabled — CF-A1/CF-A3');
});

// CF-A1: explicit module resolution actually reaches the payload
test('buildA1111Payload uses the configured ipadapter_module verbatim, never the old ip-adapter-auto value', () => {
  const base64Image = Buffer.from('x').toString('base64');
  const payload = buildA1111Payload(
    { ...BASE_CONFIG, ipadapter_enabled: true, ipadapter_model: 'm [hash]', ipadapter_module: 'ip-adapter_face_id_plus', _controlnet_ready: true },
    'p', 'n', base64Image,
  );
  assert.equal(payload.alwayson_scripts.controlnet.args[0].module, 'ip-adapter_face_id_plus');
});

test('buildA1111Payload falls back to a family-resolved module (not ip-adapter-auto) when ipadapter_module is unset', () => {
  const base64Image = Buffer.from('x').toString('base64');
  const payload = buildA1111Payload(
    { ...BASE_CONFIG, ipadapter_enabled: true, ipadapter_model: 'm [hash]', a1111_model: 'sd_xl_base.safetensors', _controlnet_ready: true },
    'p', 'n', base64Image,
  );
  assert.equal(payload.alwayson_scripts.controlnet.args[0].module, 'ip-adapter_clip_sdxl');
  assert.notEqual(payload.alwayson_scripts.controlnet.args[0].module, 'ip-adapter-auto');
});

// CF-A3: no fabricated model — the payload always carries exactly what's configured
test('buildA1111Payload never invents a model name — it submits config.ipadapter_model as-is', () => {
  const base64Image = Buffer.from('x').toString('base64');
  const payload = buildA1111Payload(
    { ...BASE_CONFIG, ipadapter_enabled: true, ipadapter_model: 'real-model [deadbeef]', _controlnet_ready: true },
    'p', 'n', base64Image,
  );
  assert.equal(payload.alwayson_scripts.controlnet.args[0].model, 'real-model [deadbeef]');
});

// CF-A5: shot-type-aware tuning actually reaches the payload
test('buildA1111Payload applies different IP-Adapter weight for scene mode vs character mode', () => {
  const base64Image = Buffer.from('x').toString('base64');
  const ready = { ...BASE_CONFIG, ipadapter_enabled: true, ipadapter_model: 'm [hash]', ipadapter_weight: 0.5, ipadapter_end: 0.7, _controlnet_ready: true };

  const scenePayload = buildA1111Payload(ready, 'p', 'n', base64Image, 'scene');
  const charPayload = buildA1111Payload(ready, 'p', 'n', base64Image, 'character');

  const sceneArgs = scenePayload.alwayson_scripts.controlnet.args[0];
  const charArgs = charPayload.alwayson_scripts.controlnet.args[0];
  assert.ok(sceneArgs.weight < charArgs.weight, `expected scene weight (${sceneArgs.weight}) < character weight (${charArgs.weight})`);
  assert.equal(charArgs.weight, 0.5, 'character mode keeps the configured weight as-is');
});

// CF-A6/CF-11: preflight cache must be TTL-bound, not permanent — a bad/offline first
// result must not stick forever. getControlNetCatalog accepts an injectable `now` so
// this is testable without real waiting.
test('getControlNetCatalog caches a result and reuses it within the TTL window', async (t) => {
  let fetchCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++;
    return { ok: true, status: 200, json: async () => ({ model_list: ['m [hash]'] }) };
  });

  const fakeNow = () => 1_000_000;
  const first = await getControlNetCatalog('http://127.0.0.1:7860', { now: fakeNow });
  const second = await getControlNetCatalog('http://127.0.0.1:7860', { now: fakeNow });

  assert.equal(first.available, true);
  assert.deepEqual(second, first, 'second call within the TTL window must reuse the cached result');
  assert.equal(fetchCount, 2, 'one catalog check = 2 requests (model_list + module_list); the second call must not re-fetch');
});

test('getControlNetCatalog refreshes after the TTL window has elapsed — a bad first result does not stick forever', async (t) => {
  let available = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!available) throw new Error('A1111 offline');
    return { ok: true, status: 200, json: async () => ({ model_list: ['m [hash]'], module_list: ['ip-adapter_clip_sd15'] }) };
  });

  const t0 = 2_000_000;
  const first = await getControlNetCatalog('http://127.0.0.1:7860', { now: () => t0, forceRefresh: true });
  assert.equal(first.available, false, 'first check while A1111 is offline must report unavailable');

  available = true; // A1111 comes back online
  const stillCached = await getControlNetCatalog('http://127.0.0.1:7860', { now: () => t0 + 1000 });
  assert.equal(stillCached.available, false, 'within the TTL window, the bad result is still served (expected — not a bug)');

  const afterTtl = await getControlNetCatalog('http://127.0.0.1:7860', { now: () => t0 + 6 * 60 * 1000 });
  assert.equal(afterTtl.available, true, 'after the TTL window elapses, a stale unavailable result must not persist forever — CF-11');
});

test('getControlNetCatalog forceRefresh bypasses the cache immediately', async (t) => {
  let available = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!available) throw new Error('A1111 offline');
    return { ok: true, status: 200, json: async () => ({ model_list: [], module_list: [] }) };
  });
  const fakeNow = () => 3_000_000;

  await getControlNetCatalog('http://127.0.0.1:7860', { now: fakeNow, forceRefresh: true });
  available = true;
  const refreshed = await getControlNetCatalog('http://127.0.0.1:7860', { now: fakeNow, forceRefresh: true });
  assert.equal(refreshed.available, true, 'forceRefresh must ignore the TTL and re-check immediately');
});
