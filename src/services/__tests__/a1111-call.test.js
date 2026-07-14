// Regression tests for callA1111's retry-on-VAE-failure behavior (CF-4). Uses a mocked
// global fetch (no real A1111) and a real scratch temp file for savePath — no DB needed.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-a1111call-'));
mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'), DATA_DIR: ROOT,
    IMAGES_DIR: path.join(ROOT, 'images'), BACKGROUNDS_DIR: path.join(ROOT, 'backgrounds'),
    AUDIO_DIR: path.join(ROOT, 'audio'), DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(ROOT, 'audit.jsonl'),
  },
});

const { callA1111 } = await import('../image-pipeline.js');

const FAKE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function okResponse() {
  return {
    ok: true, status: 200,
    json: async () => ({ images: [FAKE_PNG_BASE64], info: JSON.stringify({ seed: 42, sd_model_name: 'm', sd_model_hash: 'h' }) }),
  };
}

function vaeFailureResponse() {
  return { ok: false, status: 500, text: async () => 'AutoencoderKL state_dict mismatch' };
}

function controlNetErrorResponse() {
  return { ok: false, status: 500, text: async () => "ControlNet unit 0 failed: module 'ip-adapter-auto' not found" };
}

test('callA1111 happy path returns generation metadata, writes the image file, and reports no fallback', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => okResponse());
  const savePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'save-')), 'out.png');

  const result = await callA1111('http://127.0.0.1:7860', 'txt2img', { prompt: 'p' }, savePath);

  assert.equal(result.seed, 42);
  assert.equal(result.model_name, 'm');
  assert.equal(result.controlnetFallback, false);
  assert.ok(fs.existsSync(savePath), 'image file must be written');
});

// CF-A2: a ControlNet/IP-Adapter-specific rejection must fail open, not kill the image.
test('callA1111 retries once WITHOUT the controlnet unit after a ControlNet-specific rejection, preserving ADetailer', async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    callCount++;
    if (callCount === 1) return controlNetErrorResponse();
    const sentPayload = JSON.parse(init.body);
    assert.equal(sentPayload.alwayson_scripts.controlnet, undefined, 'retry must drop only the controlnet unit');
    assert.ok(sentPayload.alwayson_scripts.ADetailer, 'retry must PRESERVE unrelated always-on scripts like ADetailer');
    return okResponse();
  });
  const savePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'save-')), 'out.png');

  const payloadWithFaceId = {
    prompt: 'p',
    alwayson_scripts: {
      ADetailer: { args: [{ ad_model: 'face_yolov8n.pt' }] },
      controlnet: { args: [{ enabled: true, module: 'ip-adapter-auto', model: 'm [hash]', image: 'base64...' }] },
    },
  };

  const result = await callA1111('http://127.0.0.1:7860', 'txt2img', payloadWithFaceId, savePath);

  assert.equal(callCount, 2, 'must have retried exactly once');
  assert.equal(result.seed, 42, 'the image must still be generated, just without FaceID');
  assert.equal(result.controlnetFallback, true, 'fallback must be reported to the caller — CF-A2');
  assert.match(result.controlnetFallbackReason, /ControlNet unit 0 failed/);
});

test('callA1111 does not attempt a controlnet-specific retry when the payload had no controlnet unit to begin with', async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return controlNetErrorResponse();
  });
  const savePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'save-')), 'out.png');

  await assert.rejects(
    () => callA1111('http://127.0.0.1:7860', 'txt2img', { prompt: 'p' }, savePath),
    /ControlNet unit 0 failed/,
  );
  assert.equal(callCount, 1, 'nothing to strip — must not loop retrying the same payload');
});

test('callA1111 retries with a stripped payload after an AutoencoderKL failure when the payload had heavy options', async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    callCount++;
    if (callCount === 1) return vaeFailureResponse();
    // Retry must have stripped refiner/hires/adetailer/controlnet and forced sd_vae: Automatic.
    const sentPayload = JSON.parse(init.body);
    assert.equal(sentPayload.refiner_checkpoint, undefined, 'retry payload must not include refiner_checkpoint');
    assert.equal(sentPayload.enable_hr, undefined, 'retry payload must not include enable_hr');
    assert.equal(sentPayload.alwayson_scripts, undefined, 'retry payload must not include alwayson_scripts');
    assert.equal(sentPayload.override_settings.sd_vae, 'Automatic', 'retry payload must force sd_vae to Automatic');
    return okResponse();
  });
  const savePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'save-')), 'out.png');

  const heavyPayload = {
    prompt: 'p',
    refiner_checkpoint: 'refinerXL.safetensors',
    enable_hr: true,
    alwayson_scripts: { ADetailer: { args: [{}] } },
    override_settings: { sd_vae: 'someVae.safetensors' },
  };

  const result = await callA1111('http://127.0.0.1:7860', 'txt2img', heavyPayload, savePath);

  assert.equal(callCount, 2, 'must have retried exactly once after the first failure');
  assert.equal(result.seed, 42, 'retry must ultimately succeed');
  assert.equal(result.controlnetFallback, false, 'no controlnet unit was present, so this is not a FaceID fallback');
});

test('callA1111 does not retry a non-VAE error — it just throws', async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return { ok: false, status: 500, text: async () => 'totally unrelated server error' };
  });
  const savePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'save-')), 'out.png');

  await assert.rejects(
    () => callA1111('http://127.0.0.1:7860', 'txt2img', { prompt: 'p', enable_hr: true }, savePath),
    /totally unrelated server error/,
  );
  assert.equal(callCount, 1, 'must not retry for a non-retryable error');
});

test('callA1111 throws a friendly VAE error when there is nothing to strip and retry (plain payload)', async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return vaeFailureResponse();
  });
  const savePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'save-')), 'out.png');

  // No refiner/hires/adetailer/controlnet to strip -> hasExtras is false -> no retry,
  // but the error message must still be the friendly, actionable one.
  await assert.rejects(
    () => callA1111('http://127.0.0.1:7860', 'txt2img', { prompt: 'p' }, savePath),
    /A1111 VAE\/model load failed/,
  );
  assert.equal(callCount, 1);
});
