// CF-10: scenario-scoped clothing routes require an explicit boolean `runtime`.
// characters PATCH used to default omitted runtime -> runtime write;
// scenario-characters PATCH used to default omitted runtime -> starting write.
// Both now 400 when runtime is missing/non-boolean.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-cf10-'));
const DIRS = {
  data: path.join(ROOT, 'data'),
  images: path.join(ROOT, 'images'),
  backgrounds: path.join(ROOT, 'backgrounds'),
  audio: path.join(ROOT, 'audio'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images,
    BACKGROUNDS_DIR: DIRS.backgrounds, AUDIO_DIR: DIRS.audio,
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const realFetch = globalThis.fetch;
const { default: db } = await import('../../db.js');
const { default: express } = await import('express');
const { default: charactersRouter } = await import('../characters.js');
const { default: scenarioCharactersRouter } = await import('../scenario-characters.js');
const { getScenarioClothing } = await import('../../services/clothing.js');

const app = express();
app.use(express.json());
app.use('/api/characters', charactersRouter);
app.use('/api/scenarios/:scenarioId/characters', scenarioCharactersRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

function seedScenarioCast(charName = 'Riley') {
  const charId = db.prepare(
    `INSERT INTO characters (name, role, gender, outfit_sets, default_outfit_name, default_outfit)
     VALUES (?, 'character', 'female', ?, 'Daywear', 'blue sundress')`
  ).run(charName, JSON.stringify([{ name: 'Daywear', description: 'blue sundress' }])).lastInsertRowid;
  const scenarioId = db.prepare(
    `INSERT INTO scenarios (title, description) VALUES (?, ?)`
  ).run('CF10 Test', 'desc').lastInsertRowid;
  db.prepare(
    `INSERT INTO scenario_characters (scenario_id, character_id, starting_clothing, starting_clothing_set_name)
     VALUES (?, ?, 'blue sundress', 'Daywear')`
  ).run(scenarioId, charId);
  db.prepare(
    `INSERT INTO scenario_character_state (scenario_id, character_id, moodcurrent, arousalcurrent, current_clothing)
     VALUES (?, ?, 3, 1, 'blue sundress')`
  ).run(scenarioId, charId);
  return { scenarioId, charId };
}

async function patchCharacterClothing(charId, body) {
  const res = await realFetch(`${baseUrl}/api/characters/${charId}/clothing`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function patchScenarioClothing(scenarioId, charId, body) {
  const res = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/characters/${charId}/clothing`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test('CF-10: PATCH /api/characters/:id/clothing with scenario_id requires explicit runtime boolean', async () => {
  const { scenarioId, charId } = seedScenarioCast('CF10-A');
  const omitted = await patchCharacterClothing(charId, {
    scenario_id: scenarioId,
    current_clothing: 'red bikini',
  });
  assert.equal(omitted.status, 400);
  assert.match(String(omitted.json.error || ''), /runtime must be an explicit boolean/i);

  const runtimeWrite = await patchCharacterClothing(charId, {
    scenario_id: scenarioId,
    current_clothing: 'red bikini',
    runtime: true,
  });
  assert.equal(runtimeWrite.status, 200);
  assert.equal(getScenarioClothing(scenarioId, charId), 'red bikini');

  const startingWrite = await patchCharacterClothing(charId, {
    scenario_id: scenarioId,
    current_clothing: 'green shorts',
    runtime: false,
  });
  assert.equal(startingWrite.status, 200);
  const starting = db.prepare(
    'SELECT starting_clothing FROM scenario_characters WHERE scenario_id = ? AND character_id = ?'
  ).get(scenarioId, charId);
  assert.equal(starting.starting_clothing, 'green shorts');
});

test('CF-10: PATCH /api/scenarios/:sid/characters/:cid/clothing requires explicit runtime boolean', async () => {
  const { scenarioId, charId } = seedScenarioCast('CF10-B');
  const omitted = await patchScenarioClothing(scenarioId, charId, {
    clothing_set_name: 'Daywear',
  });
  assert.equal(omitted.status, 400);
  assert.match(String(omitted.json.error || ''), /runtime must be an explicit boolean/i);

  const starting = await patchScenarioClothing(scenarioId, charId, {
    clothing_set_name: 'Daywear',
    runtime: false,
  });
  assert.equal(starting.status, 200);
  assert.ok(starting.json.starting_clothing || starting.json.ok);

  const runtime = await patchScenarioClothing(scenarioId, charId, {
    clothing: 'silk robe',
    runtime: true,
  });
  assert.equal(runtime.status, 200);
  assert.equal(runtime.json.current_clothing, 'silk robe');
  assert.equal(getScenarioClothing(scenarioId, charId), 'silk robe');
});

test('CF-10: PATCH /api/characters/:id/clothing without scenario_id still updates the character card field', async () => {
  const charId = db.prepare(
    `INSERT INTO characters (name, role, gender) VALUES ('CF10-Card', 'character', 'female')`
  ).run().lastInsertRowid;
  const res = await patchCharacterClothing(charId, { current_clothing: 'card-only outfit' });
  assert.equal(res.status, 200);
  const row = db.prepare('SELECT current_clothing FROM characters WHERE id = ?').get(charId);
  assert.equal(row.current_clothing, 'card-only outfit');
});