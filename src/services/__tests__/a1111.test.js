import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-a1111-service-'));
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'), DATA_DIR,
    IMAGES_DIR: path.join(ROOT, 'images'), AUDIO_DIR: path.join(ROOT, 'audio'),
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DATA_DIR, 'audit.jsonl'),
  },
});

const { GENERATE_TIMEOUT_MS, txt2img, buildFaceIdControlNetUnit, buildOpenPoseControlNetUnit, buildControlNetPayload } = await import('../a1111.js');

test('A1111 generation timeout is six minutes', () => {
  assert.equal(GENERATE_TIMEOUT_MS, 360000);
});

test('a failed generation request interrupts A1111 so the render is not orphaned', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    if (String(url).includes('/txt2img')) {
      const err = new Error('Headers Timeout Error');
      err.code = 'UND_ERR_HEADERS_TIMEOUT';
      throw err;
    }
    if (String(url).includes('/interrupt')) return { ok: true, json: async () => ({}) };
    throw new Error('unexpected request');
  });

  await assert.rejects(
    () => txt2img('http://127.0.0.1:7860', { prompt: 'test' }, 'unused.png'),
    /A1111 generation connection failed/,
  );
  assert.ok(calls.some((url) => url.includes('/interrupt')));
});

test('buildFaceIdControlNetUnit uses the named Balanced control mode required by current ControlNet', () => {
  const unit = buildFaceIdControlNetUnit('reference-base64', {
    model: 'ip-adapter-faceid-plusv2_sdxl [187cb962]',
    module: 'ip-adapter_face_id_plus',
  });

  assert.equal(unit.alwayson_scripts.controlnet.args[0].control_mode, 'Balanced');
});

test('buildControlNetPayload preserves FaceID before a prepared OpenPose skeleton', () => {
  const faceUnit = buildFaceIdControlNetUnit('face-reference-base64', {
    model: 'ip-adapter-faceid-plusv2_sdxl [187cb962]',
    module: 'ip-adapter_face_id_plus',
  });
  const poseUnit = buildOpenPoseControlNetUnit('pose-skeleton-base64', {
    model: 'OpenPoseXL2 [f4251cb4]',
    module: 'none',
  });

  const payload = buildControlNetPayload([faceUnit, poseUnit]);
  const units = payload.alwayson_scripts.controlnet.args;

  assert.equal(units.length, 2);
  assert.equal(units[0].image, 'face-reference-base64');
  assert.equal(units[0].model, 'ip-adapter-faceid-plusv2_sdxl [187cb962]');
  assert.equal(units[1].image, 'pose-skeleton-base64');
  assert.equal(units[1].model, 'OpenPoseXL2 [f4251cb4]');
  assert.equal(units[1].module, 'none');
  assert.equal(units[1].control_mode, 'Balanced');
});
