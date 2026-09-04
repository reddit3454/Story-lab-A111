import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-images-'));
const DIRS = { data: path.join(ROOT, 'data'), images: path.join(ROOT, 'images'), audio: path.join(ROOT, 'audio'), poses: path.join(ROOT, 'poses') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images, AUDIO_DIR: DIRS.audio, POSE_LIBRARY_DIR: DIRS.poses,
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const realFetch = globalThis.fetch;
const { default: db } = await import('../../db.js');
const { default: express } = await import('express');
const { default: imagesRouter } = await import('../images.js');
const { default: looksRouter } = await import('../looks.js');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/api/scenarios/:scenarioId/images', imagesRouter);
app.use('/api/looks', looksRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

// 1x1 transparent PNG, base64-encoded.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function mockA1111Fetch(t, { generateOk = true, busy = false } = {}) {
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/progress')) {
      return { ok: true, json: async () => (busy
        ? { progress: 0.5, eta_relative: 20, state: { job_count: 1 } }
        : { progress: 0, eta_relative: 0, state: { job_count: 0 } }) };
    }
    if (u.includes('/sdapi/v1/options')) {
      return { ok: true, json: async () => ({ sd_model_checkpoint: 'baseModel.safetensors [abcd1234]' }) };
    }
    if (u.includes('/sdapi/v1/txt2img') || u.includes('/sdapi/v1/img2img')) {
      if (!generateOk) {
        return { ok: false, status: 500, text: async () => 'internal a1111 error' };
      }
      return {
        ok: true,
        json: async () => ({
          images: [TINY_PNG_B64],
          info: JSON.stringify({ seed: 42, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }),
        }),
      };
    }
    if (u.includes('/controlnet/model_list')) {
      return { ok: true, json: async () => ({ model_list: [] }) };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });
}

function seedScenario() {
  const scenarioId = db.prepare(`INSERT INTO scenarios (title) VALUES ('Image Pipeline Test')`).run().lastInsertRowid;
  const charId = db.prepare(`
    INSERT INTO characters (name, role, gender, hair_color, eye_color)
    VALUES ('Riley', 'character', 'female', 'red', 'green')
  `).run().lastInsertRowid;
  db.prepare('INSERT INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)').run(scenarioId, charId);
  return { scenarioId, charId };
}

function seedPoseLibrary() {
  const poseDir = path.join(DIRS.poses, 'library', 'sitting', 'sitting-demo-01');
  fs.mkdirSync(poseDir, { recursive: true });
  fs.writeFileSync(path.join(poseDir, 'control.png'), 'pose-skeleton-bytes');
  fs.writeFileSync(path.join(DIRS.poses, 'manifest.json'), JSON.stringify({ poses: [
    {
      id: 'sitting-demo-01', label: 'sitting demo', category: 'sitting', orientation: 'left', subjects: 1,
      description: 'seated with hands folded',
      preview_path: 'library/sitting/sitting-demo-01/preview.png',
      control_path: 'library/sitting/sitting-demo-01/control.png',
    },
    {
      id: 'couple-demo-01', label: 'couple demo', category: 'couple', orientation: 'facing', subjects: 2,
      description: 'two people embracing',
      preview_path: 'library/sitting/sitting-demo-01/preview.png',
      control_path: 'library/sitting/sitting-demo-01/control.png',
    },
  ] }));
}

test('POST /generate happy path: writes a file, inserts a scene_images row with a full snapshot, and audits the run', async (t) => {
  mockA1111Fetch(t);
  const { scenarioId } = seedScenario();

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'standing quietly by the window' }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(json.image.id);
  assert.ok(json.pipeline_run_id);

  const row = db.prepare('SELECT * FROM scene_images WHERE id = ?').get(json.image.id);
  assert.equal(row.scenario_id, scenarioId);
  assert.equal(row.generation_method, 'txt2img');
  assert.match(row.prompt_used, /standing quietly by the window/);
  assert.ok(row.look_id, 'the active Look id must be snapshotted onto the row');
  assert.equal(row.model_name, 'baseModel');
  assert.equal(row.model_hash, 'abcd1234');
  assert.equal(row.seed, 42);
  assert.equal(row.pipeline_run_id, json.pipeline_run_id);

  const absPath = path.join(DIRS.images, String(scenarioId), row.filename);
  assert.ok(fs.existsSync(absPath), 'generated file must exist on disk');

  const parts = JSON.parse(row.prompt_parts_json);
  assert.ok(parts.style_prefix, 'prompt_parts must record the style block separately from content');
  assert.match(parts.action, /standing quietly by the window/);

  const auditRows = db.prepare('SELECT * FROM audit_events WHERE pipeline_run_id = ? ORDER BY id ASC').all(json.pipeline_run_id);
  assert.ok(auditRows.length >= 5, 'expected multiple stage audit events for this run');
  const stages = auditRows.map((r) => r.event);
  assert.ok(stages.includes('start'));
  assert.ok(stages.includes('build_prompt'));
  assert.ok(stages.includes('persist'));
  assert.ok(stages.includes('complete'));
});

test('POST /generate injects optional characterAction separately before scene description', async (t) => {
  mockA1111Fetch(t);
  const { scenarioId, charId } = seedScenario();

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'portrait',
      characterIds: [charId],
      actionText: 'beside a rain-streaked window',
      characterAction: 'Riley fastening one earring',
    }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  const row = db.prepare('SELECT * FROM scene_images WHERE id = ?').get(json.image.id);
  const parts = JSON.parse(row.prompt_parts_json);

  assert.equal(parts.character_action, 'Riley fastening one earring');
  assert.equal(parts.action, 'beside a rain-streaked window');
  assert.ok(row.prompt_used.indexOf(parts.character) < row.prompt_used.indexOf(parts.character_action));
  assert.ok(row.prompt_used.indexOf(parts.character_action) < row.prompt_used.indexOf(parts.action));
});

test('POST /generate appends the selected prepared pose after FaceID in the A1111 ControlNet payload', async (t) => {
  let capturedPayload = null;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/options')) {
      return { ok: true, json: async () => ({ sd_model_checkpoint: 'baseModel.safetensors [abcd1234]' }) };
    }
    if (u.includes('/controlnet/model_list')) {
      return { ok: true, json: async () => ({ model_list: ['ip-adapter-faceid-plusv2_sdxl [187cb962]', 'OpenPoseXL2 [f4251cb4]'] }) };
    }
    if (u.includes('/controlnet/settings')) {
      return { ok: true, json: async () => ({ control_net_unit_count: 3 }) };
    }
    if (u.includes('/sdapi/v1/txt2img')) {
      capturedPayload = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ images: [TINY_PNG_B64], info: JSON.stringify({ seed: 42, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }) }),
      };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });

  seedPoseLibrary();
  const { scenarioId, charId } = seedScenario();
  const faceDir = path.join(DIRS.images, 'characters', String(charId));
  fs.mkdirSync(faceDir, { recursive: true });
  fs.writeFileSync(path.join(faceDir, 'face.png'), 'face-reference-bytes');
  db.prepare('UPDATE characters SET reference_image_path = ? WHERE id = ?').run(`characters/${charId}/face.png`, charId);
  const configStmt = db.prepare("INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))");
  configStmt.run('a1111_faceid_model', 'ip-adapter-faceid-plusv2_sdxl [187cb962]');
  configStmt.run('a1111_faceid_module', 'ip-adapter_face_id_plus');
  configStmt.run('a1111_pose_model', 'OpenPoseXL2 [f4251cb4]');
  configStmt.run('a1111_pose_module', 'none');

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'sitting in an armchair', poseId: 'sitting-demo-01' }),
  });
  assert.equal(res.status, 200);
  const units = capturedPayload.alwayson_scripts.controlnet.args;
  assert.equal(units.length, 2);
  assert.equal(units[0].model, 'ip-adapter-faceid-plusv2_sdxl [187cb962]');
  assert.equal(units[1].model, 'OpenPoseXL2 [f4251cb4]');
  assert.equal(units[1].module, 'none');
  assert.equal(units[1].image, Buffer.from('pose-skeleton-bytes').toString('base64'));
  // The pose's own description is folded into the prompt as a style-stripped hint.
  assert.match(capturedPayload.prompt, /seated with hands folded/);
  // A FaceID unit is attached, so GFPGAN face restoration must be forced off.
  assert.equal(capturedPayload.restore_faces, false);
});

test('POST /generate returns 409 (not 502) when A1111 is mid-render', async (t) => {
  mockA1111Fetch(t, { busy: true });
  const { scenarioId } = seedScenario();

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'anything' }),
  });
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.match(json.error, /still finishing another image/i);
  // and no row was written
  assert.equal(db.prepare('SELECT COUNT(*) c FROM scene_images WHERE scenario_id = ?').get(scenarioId).c, 0);
});

test('POST /images/warmup returns immediately and never writes a scene_images row', async (t) => {
  mockA1111Fetch(t);
  const { scenarioId } = seedScenario();

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/warmup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterIds: [], poseId: null }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, started: true });
  await new Promise((r) => setTimeout(r, 60)); // let the fire-and-forget settle
  assert.equal(db.prepare('SELECT COUNT(*) c FROM scene_images WHERE scenario_id = ?').get(scenarioId).c, 0);
});

test('POST /generate fullbody always carries the full-figure cue even with no action text', async (t) => {
  let capturedPayload = null;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/options')) return { ok: true, json: async () => ({ sd_model_checkpoint: 'baseModel.safetensors [abcd1234]' }) };
    if (u.includes('/controlnet/model_list')) return { ok: true, json: async () => ({ model_list: [] }) };
    if (u.includes('/sdapi/v1/txt2img')) {
      capturedPayload = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ images: [TINY_PNG_B64], info: JSON.stringify({ seed: 42, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }) }) };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });
  const { scenarioId, charId } = seedScenario();

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'fullbody', characterIds: [charId] }),
  });
  assert.equal(res.status, 200);
  assert.match(capturedPayload.prompt, /full-body composition, entire figure in frame/);
});

test('POST /generate scene framing reaches the prompt (and garbage framing is ignored)', async (t) => {
  let prompts = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/options')) return { ok: true, json: async () => ({ sd_model_checkpoint: 'baseModel.safetensors [abcd1234]' }) };
    if (u.includes('/controlnet/model_list')) return { ok: true, json: async () => ({ model_list: [] }) };
    if (u.includes('/sdapi/v1/txt2img')) {
      prompts.push(JSON.parse(opts.body).prompt);
      return { ok: true, json: async () => ({ images: [TINY_PNG_B64], info: JSON.stringify({ seed: 42, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }) }) };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });
  const { scenarioId } = seedScenario();

  await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'two people at a table', framing: 'wide' }),
  });
  await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'two people at a table', framing: 'cinematic-junk' }),
  });
  assert.match(prompts[0], /wide shot, two people at a table/);
  assert.doesNotMatch(prompts[1], /shot/);
});

test('POST /generate applies configured FaceID / pose ControlNet weight overrides (clamped)', async (t) => {
  let capturedPayload = null;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/options')) return { ok: true, json: async () => ({ sd_model_checkpoint: 'baseModel.safetensors [abcd1234]' }) };
    if (u.includes('/controlnet/model_list')) return { ok: true, json: async () => ({ model_list: ['ip-adapter-faceid-plusv2_sdxl [187cb962]', 'OpenPoseXL2 [f4251cb4]'] }) };
    if (u.includes('/controlnet/settings')) return { ok: true, json: async () => ({ control_net_unit_count: 3 }) };
    if (u.includes('/sdapi/v1/txt2img')) {
      capturedPayload = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ images: [TINY_PNG_B64], info: JSON.stringify({ seed: 42, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }) }) };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });

  seedPoseLibrary();
  const { scenarioId, charId } = seedScenario();
  const faceDir = path.join(DIRS.images, 'characters', String(charId));
  fs.mkdirSync(faceDir, { recursive: true });
  fs.writeFileSync(path.join(faceDir, 'face.png'), 'face-reference-bytes');
  db.prepare('UPDATE characters SET reference_image_path = ? WHERE id = ?').run(`characters/${charId}/face.png`, charId);
  const configStmt = db.prepare("INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))");
  configStmt.run('a1111_faceid_model', 'ip-adapter-faceid-plusv2_sdxl [187cb962]');
  configStmt.run('a1111_faceid_module', 'ip-adapter_face_id_plus');
  configStmt.run('a1111_pose_model', 'OpenPoseXL2 [f4251cb4]');
  configStmt.run('a1111_pose_module', 'none');
  configStmt.run('a1111_faceid_weight', '0.85');
  configStmt.run('a1111_pose_weight', '9'); // out of range — must clamp to 2

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'sitting in an armchair', poseId: 'sitting-demo-01' }),
  });
  assert.equal(res.status, 200);
  const units = capturedPayload.alwayson_scripts.controlnet.args;
  assert.equal(units[0].weight, 0.85);
  assert.equal(units[1].weight, 2);
});

test('POST /generate rejects a pose whose subject count does not match the cast', async (t) => {
  mockA1111Fetch(t);
  seedPoseLibrary();
  const { scenarioId } = seedScenario(); // one character
  const configStmt = db.prepare("INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))");
  configStmt.run('a1111_pose_model', 'OpenPoseXL2 [f4251cb4]');
  configStmt.run('a1111_pose_module', 'none');

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'in the study', poseId: 'couple-demo-01' }),
  });
  assert.equal(res.status, 400); // a selection the user must fix, not an upstream failure
  const json = await res.json();
  assert.match(json.error, /drawn for 2 people, but this image has 1/);
});

test('POST /generate soft-fails a pose when ControlNet is unreachable and still returns an image', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/options')) return { ok: true, json: async () => ({ sd_model_checkpoint: 'baseModel.safetensors [abcd1234]' }) };
    if (u.includes('/controlnet/model_list')) return { ok: false, status: 404, text: async () => 'not found' };
    if (u.includes('/sdapi/v1/txt2img')) {
      return { ok: true, json: async () => ({ images: [TINY_PNG_B64], info: JSON.stringify({ seed: 42, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }) }) };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });
  seedPoseLibrary();
  const { scenarioId } = seedScenario();
  const configStmt = db.prepare("INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))");
  configStmt.run('a1111_pose_model', 'OpenPoseXL2 [f4251cb4]');
  configStmt.run('a1111_pose_module', 'none');

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'reading a book', poseId: 'sitting-demo-01' }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.match(json.pose_skipped, /not reachable/);
});

test('POST /generate skips FaceID when the configured model has no stored module', async (t) => {
  let capturedPayload = null;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/options')) return { ok: true, json: async () => ({ sd_model_checkpoint: 'baseModel.safetensors [abcd1234]' }) };
    if (u.includes('/controlnet/model_list')) return { ok: true, json: async () => ({ model_list: ['ip-adapter-faceid-plusv2_sdxl [187cb962]'] }) };
    if (u.includes('/sdapi/v1/txt2img')) {
      capturedPayload = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ images: [TINY_PNG_B64], info: JSON.stringify({ seed: 42, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }) }) };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });

  const { scenarioId, charId } = seedScenario();
  const faceDir = path.join(DIRS.images, 'characters', String(charId));
  fs.mkdirSync(faceDir, { recursive: true });
  fs.writeFileSync(path.join(faceDir, 'face.png'), 'face-reference-bytes');
  db.prepare('UPDATE characters SET reference_image_path = ? WHERE id = ?').run(`characters/${charId}/face.png`, charId);
  const configStmt = db.prepare("INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))");
  configStmt.run('a1111_faceid_model', 'ip-adapter-faceid-plusv2_sdxl [187cb962]');
  configStmt.run('a1111_faceid_module', ''); // half-configured pair

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'portrait', characterIds: [charId], actionText: 'by the window' }),
  });
  assert.equal(res.status, 200);
  assert.equal(capturedPayload.alwayson_scripts, undefined, 'no ControlNet payload when the FaceID pair is incomplete');
});

test('switching the active Look changes the style block on the next generation', async (t) => {
  mockA1111Fetch(t);
  const { scenarioId } = seedScenario();

  // Ensure two distinct Looks exist (fresh DB may only have the default Look).
  const alt = await (await realFetch(`${baseUrl}/api/looks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Switch Test Alt Look',
      prompt_prefix: 'alternate stylized render prefix for test',
      negative: 'photorealistic photograph, flat anime',
    }),
  })).json();
  const looksBefore = await (await realFetch(`${baseUrl}/api/looks`)).json();
  const lookA = looksBefore.find((l) => l.name === 'Stylized 3D Cinematic') || looksBefore[0];
  const lookB = looksBefore.find((l) => l.id === alt.id) || looksBefore[1];
  assert.ok(lookA && lookB && lookA.id !== lookB.id, 'need two distinct Looks for this test');
  await realFetch(`${baseUrl}/api/looks/${lookA.id}/activate`, { method: 'POST' });

  const genA = await (await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionText: 'reading a book' }),
  })).json();

  await realFetch(`${baseUrl}/api/looks/${lookB.id}/activate`, { method: 'POST' });

  const genB = await (await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionText: 'reading a book' }),
  })).json();

  const rowA = db.prepare('SELECT * FROM scene_images WHERE id = ?').get(genA.image.id);
  const rowB = db.prepare('SELECT * FROM scene_images WHERE id = ?').get(genB.image.id);

  assert.notEqual(rowA.look_id, rowB.look_id);
  assert.notEqual(rowA.prompt_used, rowB.prompt_used);

  const partsA = JSON.parse(rowA.prompt_parts_json);
  const partsB = JSON.parse(rowB.prompt_parts_json);
  assert.equal(partsA.action, partsB.action, 'action text must be identical across Looks');
  assert.notEqual(partsA.style_prefix, partsB.style_prefix, 'style prefix must change with the Look');
});

test("active Look's vae/clip_skip/restore_faces/tiling and LoRAs reach the actual A1111 payload", async (t) => {
  let capturedPayload = null;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.includes('/sdapi/v1/options')) {
      return { ok: true, json: async () => ({ sd_model_checkpoint: 'baseModel.safetensors [abcd1234]' }) };
    }
    if (u.includes('/sdapi/v1/txt2img')) {
      capturedPayload = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          images: [TINY_PNG_B64],
          info: JSON.stringify({ seed: 42, sd_model_name: 'baseModel', sd_model_hash: 'abcd1234' }),
        }),
      };
    }
    if (u.includes('/controlnet/model_list')) {
      return { ok: true, json: async () => ({ model_list: [] }) };
    }
    throw new Error('unexpected fetch in test: ' + u);
  });

  const { scenarioId } = seedScenario();
  const created = db.prepare(`
    INSERT INTO image_looks (name, prompt_prefix, negative, vae, clip_skip, restore_faces, tiling, loras_json)
    VALUES ('Rendering Test Look', 'test prefix', 'test neg', 'someVae.safetensors', 2, 1, 1, '[{"file":"testLora","strength":0.7}]')
  `).run();
  db.prepare('UPDATE image_looks SET is_active = 0').run();
  db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(created.lastInsertRowid);

  await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionText: 'testing' }),
  });

  assert.equal(capturedPayload.restore_faces, true);
  assert.equal(capturedPayload.tiling, true);
  assert.equal(capturedPayload.override_settings.sd_vae, 'someVae.safetensors');
  assert.equal(capturedPayload.override_settings.CLIP_stop_at_last_layers, 2);
  assert.equal(capturedPayload.override_settings_restore_afterwards, true);
  assert.match(capturedPayload.prompt, /<lora:testLora:0\.7>/);
});

test('A1111 offline: generate fails cleanly with a 502 and writes zero DB rows', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:7860');
  });
  const { scenarioId } = seedScenario();
  const before = db.prepare('SELECT COUNT(*) as n FROM scene_images').get().n;

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionText: 'anything' }),
  });
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /not reachable/i);

  const after = db.prepare('SELECT COUNT(*) as n FROM scene_images').get().n;
  assert.equal(after, before, 'no partial row should be written on failure');
});

test('portrait mode requires exactly one character id', async (t) => {
  mockA1111Fetch(t);
  const { scenarioId, charId } = seedScenario();
  const other = db.prepare(`INSERT INTO characters (name, role) VALUES ('Second', 'character')`).run().lastInsertRowid;
  db.prepare('INSERT INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)').run(scenarioId, other);

  // No characterIds -> portrait/fullbody reject immediately (no cast fallback)
  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'portrait' }),
  });
  assert.equal(res.status, 400); // client-side selection error, not an upstream failure
  const json = await res.json();
  assert.match(json.error, /requires exactly one character/i);

  // Exactly one -> succeeds
  const res2 = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'portrait', characterIds: [charId], actionText: 'portrait shot' }),
  });
  assert.equal(res2.status, 200);
});

test('GET list / PUT accept / PUT rate / DELETE', async (t) => {
  mockA1111Fetch(t);
  const { scenarioId } = seedScenario();
  const gen = await (await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionText: 'test' }),
  })).json();
  const imageId = gen.image.id;

  const list = await (await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images`)).json();
  assert.ok(list.some((i) => i.id === imageId));

  const accept = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/${imageId}/accept`, { method: 'PUT' });
  assert.equal(accept.status, 200);
  assert.equal((await accept.json()).accepted, 1);

  const rate = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/${imageId}/rate`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 1 }),
  });
  assert.equal(rate.status, 200);
  assert.equal((await rate.json()).user_rating, 1);

  const badRate = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/${imageId}/rate`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 5 }),
  });
  assert.equal(badRate.status, 400);

  const row = db.prepare('SELECT filename FROM scene_images WHERE id = ?').get(imageId);
  const absPath = path.join(DIRS.images, String(scenarioId), row.filename);
  assert.ok(fs.existsSync(absPath));

  const del = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/${imageId}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(db.prepare('SELECT * FROM scene_images WHERE id = ?').get(imageId), undefined);
  assert.ok(!fs.existsSync(absPath), 'file should be removed on delete');
});

test('POST /generate uses the scenario free-text place when no location card is active', async (t) => {
  mockA1111Fetch(t);
  const { scenarioId } = seedScenario();
  db.prepare('UPDATE scenarios SET active_place_text = ? WHERE id = ?').run('abandoned lighthouse, storm outside', scenarioId);

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'sheltering by the lamp' }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  const row = db.prepare('SELECT * FROM scene_images WHERE id = ?').get(json.image.id);
  const parts = JSON.parse(row.prompt_parts_json);
  assert.match(parts.location, /abandoned lighthouse, storm outside/);
  assert.match(row.prompt_used, /abandoned lighthouse, storm outside/);
});

test('POST /generate prefers the active location card over the free-text place', async (t) => {
  mockA1111Fetch(t);
  const { scenarioId } = seedScenario();
  const locId = db.prepare("INSERT INTO locations (name, description) VALUES ('Rooftop Bar', 'neon-lit rooftop terrace, city skyline')").run().lastInsertRowid;
  db.prepare('UPDATE scenarios SET active_place_text = ?, active_location_id = ? WHERE id = ?').run('ignored text place', locId, scenarioId);

  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/images/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scene', actionText: 'leaning on the railing' }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  const row = db.prepare('SELECT * FROM scene_images WHERE id = ?').get(json.image.id);
  const parts = JSON.parse(row.prompt_parts_json);
  assert.match(parts.location, /neon-lit rooftop terrace/);
  assert.doesNotMatch(row.prompt_used, /ignored text place/);
});
