// applySceneStateToCharacters: writes the scene-state extractor's per-character
// mood/arousal as ABSOLUTE values, clamped by the NSFW/SFW ceiling.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-scene-apply-'));
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT,
    PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DATA,
    AUDIO_DIR: path.join(ROOT, 'audio'),
    IMAGES_DIR: path.join(ROOT, 'images'),
    DB_PATH: ':memory:',
    AUDIT_LOG_PATH: path.join(DATA, 'audit.jsonl'),
  },
});

const { default: db } = await import('../../db.js');
const { applySceneStateToCharacters, getScenarioCharacterState } = await import('../character-state.js');

function seed({ arousalmax = 10 } = {}) {
  const charId = db.prepare(
    `INSERT INTO characters (name, role, gender, arousalmax, moodbaseline) VALUES ('Carol','character','female',?,3)`
  ).run(arousalmax).lastInsertRowid;
  const scenarioId = db.prepare(
    `INSERT INTO scenarios (title, description) VALUES ('Scene Apply Test','')`
  ).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)`
  ).run(scenarioId, charId);
  return { charId, scenarioId };
}

test('writes mood/arousal (within one step) and resets momentum', () => {
  const { charId, scenarioId } = seed();               // seeded: mood 3, arousal 1
  const res = applySceneStateToCharacters(scenarioId, [{ characterId: charId, mood: 5, arousal: 4 }],
    { nsfw_enabled: true, explicit_mode: true });

  assert.equal(res.characters.length, 1);
  const row = getScenarioCharacterState(scenarioId, charId);
  assert.equal(row.moodcurrent, 5);       // 3 -> 5 (+2, at the cap)
  assert.equal(row.arousalcurrent, 4);    // 1 -> 4 (+3, at the cap)
  assert.equal(row.mood_momentum, 0);
  assert.equal(row.arousal_momentum, 0);
});

test('caps per-turn arousal movement (no spike from an over-read)', () => {
  const { charId, scenarioId } = seed();
  // fresh state: arousal 1. Extractor over-reads at 9 -> capped to +3 = 4.
  applySceneStateToCharacters(scenarioId, [{ characterId: charId, mood: 3, arousal: 9 }], { nsfw_enabled: true, explicit_mode: true });
  assert.equal(getScenarioCharacterState(scenarioId, charId).arousalcurrent, 4);
  // next turn still hot -> climbs another 3 to 7, not straight to 9
  applySceneStateToCharacters(scenarioId, [{ characterId: charId, mood: 3, arousal: 9 }], { nsfw_enabled: true, explicit_mode: true });
  assert.equal(getScenarioCharacterState(scenarioId, charId).arousalcurrent, 7);
});

test('NSFW off clamps arousal to the SFW ceiling', () => {
  const { charId, scenarioId } = seed();
  applySceneStateToCharacters(scenarioId, [{ characterId: charId, mood: 3, arousal: 9 }],
    { nsfw_enabled: false, sfw_arousal_ceiling: 3 });

  const row = getScenarioCharacterState(scenarioId, charId);
  assert.ok(row.arousalcurrent <= 3, `expected <= 3, got ${row.arousalcurrent}`);
});

test('ignores character ids not in the scenario cast', () => {
  const { scenarioId } = seed();
  const res = applySceneStateToCharacters(scenarioId, [{ characterId: 999999, mood: 4, arousal: 6 }],
    { nsfw_enabled: true });
  assert.deepEqual(res.characters, []);
});

test('scene_state disabled via emotion_tracking_enabled=false is a no-op', () => {
  const { charId, scenarioId } = seed();
  const res = applySceneStateToCharacters(scenarioId, [{ characterId: charId, mood: 5, arousal: 8 }],
    { emotion_tracking_enabled: false });
  assert.deepEqual(res, { characters: [], gates: [] });
});

test('no change when values already match', () => {
  const { charId, scenarioId } = seed();
  // within one step of the seeded state (mood 3, arousal 1) so it lands exactly
  applySceneStateToCharacters(scenarioId, [{ characterId: charId, mood: 4, arousal: 3 }], { nsfw_enabled: true });
  const first = getScenarioCharacterState(scenarioId, charId);
  assert.equal(first.moodcurrent, 4);
  assert.equal(first.arousalcurrent, 3);
  const res = applySceneStateToCharacters(scenarioId, [{ characterId: charId, mood: 4, arousal: 3 }], { nsfw_enabled: true });
  assert.deepEqual(res.characters, []);
});
