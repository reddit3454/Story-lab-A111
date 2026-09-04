import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-turn-async-state-'));
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'), DATA_DIR,
    IMAGES_DIR: path.join(ROOT, 'images'), AUDIO_DIR: path.join(ROOT, 'audio'),
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DATA_DIR, 'audit.jsonl'),
  },
});

let finishExtraction;
mock.module('../../services/narrator.js', {
  namedExports: {
    runNarratorTurn: async () => ({ story_text: 'Ada removes her jacket.', token_estimate: 12 }),
  },
});
mock.module('../../services/scene-state.js', {
  namedExports: {
    extractSceneState: async () => new Promise((resolve) => { finishExtraction = resolve; }),
  },
});

const realFetch = globalThis.fetch;
const { default: db } = await import('../../db.js');
const { default: express } = await import('express');
const { default: turnsRouter } = await import('../turns.js');
const app = express();
app.use(express.json());
app.use('/api/scenarios/:scenarioId/turns', turnsRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test('POST narrator turn returns before scene-state extraction and persists it afterward', async () => {
  const scenarioId = db.prepare("INSERT INTO scenarios (title) VALUES ('Async scene state')").run().lastInsertRowid;
  const charId = db.prepare("INSERT INTO characters (name, role) VALUES ('Ada', 'character')").run().lastInsertRowid;
  db.prepare('INSERT INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)').run(scenarioId, charId);
  db.prepare('INSERT INTO scenario_character_state (scenario_id, character_id, current_clothing) VALUES (?, ?, ?)').run(scenarioId, charId, 'jacket and jeans');

  const response = await realFetch(`${baseUrl}/api/scenarios/${scenarioId}/turns`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', content_text: 'Continue.' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const pendingCard = JSON.parse(body.narrator_turn.scene_card_json);
  assert.equal(pendingCard.scene_state_status, 'pending');

  finishExtraction({
    sceneMood: 'romantic', sceneArousal: 4,
    characters: [{ characterId: Number(charId), mood: 4, arousal: 4 }],
    clothingChanges: [{ characterName: 'Ada', newClothing: 'jeans and shirt' }],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const stored = db.prepare('SELECT scene_card_json FROM turns WHERE id = ?').get(body.narrator_turn.id);
  const finalCard = JSON.parse(stored.scene_card_json);
  assert.equal(finalCard.scene_state_status, 'complete');
  assert.equal(finalCard.mood, 'romantic');
});
