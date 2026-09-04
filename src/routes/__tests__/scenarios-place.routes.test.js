import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-place-'));
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
const { default: scenariosRouter } = await import('../scenarios.js');

const app = express();
app.use(express.json());
app.use('/api/scenarios', scenariosRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((resolve) => server.close(resolve)));

async function put(p, body) {
  const res = await realFetch(`${baseUrl}${p}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function freshScenario() {
  const r = db.prepare("INSERT INTO scenarios (title, system_prompt) VALUES ('T', 'sys')").run();
  return r.lastInsertRowid;
}

test('setting active_place_text clears active_location_id', async () => {
  const id = freshScenario();
  const loc = db.prepare("INSERT INTO locations (name, description) VALUES ('Bar', 'a bar')").run().lastInsertRowid;
  await put(`/api/scenarios/${id}`, { active_location_id: loc });

  const { status, json } = await put(`/api/scenarios/${id}`, { active_place_text: 'rooftop at dusk' });
  assert.equal(status, 200);
  assert.equal(json.active_place_text, 'rooftop at dusk');
  assert.equal(json.active_location_id, null);
});

test('setting active_location_id clears active_place_text', async () => {
  const id = freshScenario();
  const loc = db.prepare("INSERT INTO locations (name, description) VALUES ('Dock', 'a dock')").run().lastInsertRowid;
  await put(`/api/scenarios/${id}`, { active_place_text: 'somewhere else' });

  const { json } = await put(`/api/scenarios/${id}`, { active_location_id: loc });
  assert.equal(json.active_location_id, loc);
  assert.equal(json.active_place_text, '');
});

test('whitespace-only active_place_text is stored as empty', async () => {
  const id = freshScenario();
  const { json } = await put(`/api/scenarios/${id}`, { active_place_text: '   ' });
  assert.equal(json.active_place_text, '');
});

test('reset-scene clears a lingering active_place_text', async () => {
  const id = freshScenario();
  await put(`/api/scenarios/${id}`, { active_place_text: 'abandoned lighthouse, storm outside' });

  const res = await realFetch(`${baseUrl}/api/scenarios/${id}/reset-scene`, { method: 'POST' });
  assert.equal(res.status, 200);

  const row = db.prepare('SELECT active_location_id, active_place_text FROM scenarios WHERE id = ?').get(id);
  assert.equal(row.active_location_id, null);
  assert.equal(row.active_place_text, '');
});

test('reset-scene keeps accepted images, discards the rest, and always answers JSON', async () => {
  const id = freshScenario();
  const t1 = db.prepare("INSERT INTO turns (scenario_id, turn_number, role, content_text) VALUES (?, 1, 'user', 'hi')").run(id).lastInsertRowid;
  const t2 = db.prepare("INSERT INTO turns (scenario_id, turn_number, role, content_text) VALUES (?, 2, 'narrator', 'there')").run(id).lastInsertRowid;

  // one kept image, one throwaway image — both with a file on disk
  const keptFile = 'kept.png';
  const dropFile = 'drop.png';
  fs.mkdirSync(path.join(DIRS.images, String(id)), { recursive: true });
  fs.writeFileSync(path.join(DIRS.images, String(id), keptFile), 'x');
  fs.writeFileSync(path.join(DIRS.images, String(id), dropFile), 'x');
  db.prepare("INSERT INTO scene_images (scenario_id, turn_id, filename, mode, accepted) VALUES (?, ?, ?, 'scene', 1)").run(id, t1, keptFile);
  db.prepare("INSERT INTO scene_images (scenario_id, turn_id, filename, mode, accepted) VALUES (?, ?, ?, 'scene', 0)").run(id, t2, dropFile);

  const res = await realFetch(`${baseUrl}/api/scenarios/${id}/reset-scene`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type')?.includes('application/json'), true);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.kept, 1);
  assert.equal(body.discarded, 1);

  // turns are gone
  assert.equal(db.prepare('SELECT COUNT(*) c FROM turns WHERE scenario_id = ?').get(id).c, 0);
  // kept image survives, detached from its (now deleted) turn; its file stays
  const kept = db.prepare('SELECT * FROM scene_images WHERE scenario_id = ?').all(id);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].filename, keptFile);
  assert.equal(kept[0].turn_id, null);
  assert.equal(fs.existsSync(path.join(DIRS.images, String(id), keptFile)), true);
  // throwaway image row and file are both gone
  assert.equal(fs.existsSync(path.join(DIRS.images, String(id), dropFile)), false);
});

test('clearing both at once leaves the scenario with no place', async () => {
  const id = freshScenario();
  const loc = db.prepare("INSERT INTO locations (name) VALUES ('Park')").run().lastInsertRowid;
  await put(`/api/scenarios/${id}`, { active_location_id: loc });

  const { json } = await put(`/api/scenarios/${id}`, { active_location_id: null, active_place_text: '' });
  assert.equal(json.active_location_id, null);
  assert.equal(json.active_place_text, '');
});
