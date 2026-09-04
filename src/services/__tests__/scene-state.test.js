import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-scene-state-'));
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'), DATA_DIR,
    IMAGES_DIR: path.join(ROOT, 'images'), AUDIO_DIR: path.join(ROOT, 'audio'),
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DATA_DIR, 'audit.jsonl'),
  },
});

const { extractSceneState, EMPTY_SCENE_STATE, SCENE_STATE_SCHEMA } = await import('../scene-state.js');

const CAST = [{ id: 11, name: 'Carol' }, { id: 2, name: 'Jib' }];

function mockGenerate(t, responseObj) {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(String(url), /\/api\/generate$/);
    return {
      ok: true,
      json: async () => ({ response: JSON.stringify(responseObj) }),
    };
  });
}

test('schema is flat and fully-required', () => {
  assert.deepEqual(SCENE_STATE_SCHEMA.required,
    ['scene_mood', 'scene_arousal', 'characters', 'clothing_changes']);
  assert.deepEqual(SCENE_STATE_SCHEMA.properties.characters.items.required,
    ['character_id', 'mood', 'arousal']);
});

test('parses a valid model response and clamps values', async (t) => {
  mockGenerate(t, {
    scene_mood: 'Romantic',
    scene_arousal: 14,
    characters: [
      { character_id: 11, mood: 9, arousal: 7 },
      { character_id: 2, mood: 4, arousal: 3 },
      { character_id: 999, mood: 3, arousal: 1 },
    ],
    clothing_changes: [{ character_name: 'Carol', new_clothing: 'thin tank top and jeans' }],
  });

  const r = await extractSceneState({
    narratorText: 'Carol pulls off her sweater and steps closer, flushed.',
    cast: CAST,
    clothingByCharId: { 11: 'sweater and jeans', 2: 'shorts' },
    config: {},
  });

  assert.equal(r.sceneMood, 'romantic');
  assert.equal(r.sceneArousal, 10);                 // clamped 14 -> 10
  assert.equal(r.characters.length, 2);             // id 999 dropped (not in cast)
  assert.deepEqual(r.characters[0], { characterId: 11, mood: 5, arousal: 7 }); // mood 9 -> 5
  assert.deepEqual(r.clothingChanges, [{ characterName: 'Carol', newClothing: 'thin tank top and jeans' }]);
});

test('drops sentinel and no-op clothing entries', async (t) => {
  mockGenerate(t, {
    scene_mood: 'neutral', scene_arousal: 2, characters: [],
    clothing_changes: [
      { character_name: 'Carol', new_clothing: 'not specified in the text' },
      { character_name: 'Jib', new_clothing: 'shorts and a tank top' },        // == current, drop
      { character_name: 'Carol', new_clothing: 'a red silk robe' },            // real change, keep
    ],
  });
  const r = await extractSceneState({
    narratorText: 'Carol slips into a red silk robe.',
    cast: CAST,
    clothingByCharId: { 11: 'jeans and a sweater', 2: 'shorts and a tank top' },
    config: {},
  });
  assert.deepEqual(r.clothingChanges, [{ characterName: 'Carol', newClothing: 'a red silk robe' }]);
});

test('unknown mood word becomes null; empty arrays stay empty', async (t) => {
  mockGenerate(t, { scene_mood: 'sultry', scene_arousal: 5, characters: [], clothing_changes: [] });
  const r = await extractSceneState({ narratorText: 'They talk quietly.', cast: CAST, config: {} });
  assert.equal(r.sceneMood, null);
  assert.equal(r.sceneArousal, 5);
  assert.deepEqual(r.characters, []);
  assert.deepEqual(r.clothingChanges, []);
});

test('scene_state_enabled=false short-circuits without calling the model', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('should not be called'); });
  const r = await extractSceneState({ narratorText: 'x', cast: CAST, config: { scene_state_enabled: false } });
  assert.deepEqual(r, EMPTY_SCENE_STATE);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('no cast or no text returns empty', async () => {
  assert.deepEqual(await extractSceneState({ narratorText: '', cast: CAST, config: {} }), EMPTY_SCENE_STATE);
  assert.deepEqual(await extractSceneState({ narratorText: 'x', cast: [], config: {} }), EMPTY_SCENE_STATE);
});

test('model error returns empty, never throws', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
  const r = await extractSceneState({ narratorText: 'a beat happened', cast: CAST, config: {} });
  assert.deepEqual(r, EMPTY_SCENE_STATE);
});

test('malformed JSON from model returns empty', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ response: 'not json {' }) }));
  const r = await extractSceneState({ narratorText: 'a beat happened', cast: CAST, config: {} });
  assert.deepEqual(r, EMPTY_SCENE_STATE);
});
