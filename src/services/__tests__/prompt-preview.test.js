import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-cf3-'));
const DIRS = { data: path.join(ROOT, 'data'), images: path.join(ROOT, 'images') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images,
    BACKGROUNDS_DIR: path.join(ROOT, 'backgrounds'), AUDIO_DIR: path.join(ROOT, 'audio'),
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const { default: db } = await import('../../db.js');
const { buildPromptPreview } = await import('../prompt-preview.js');
const { getScenarioClothing } = await import('../clothing.js');
const { applyResolvedClothing } = await import('../prompt-resolution.js');

function seed({ withBrief = false } = {}) {
  db.prepare(`INSERT OR REPLACE INTO global_config (key, value) VALUES ('narrator_model', 'fake-model')`).run();
  db.prepare(`INSERT OR REPLACE INTO global_config (key, value) VALUES ('prompt_extractor_model', 'fake-model')`).run();

  const scenarioId = db.prepare(`INSERT INTO scenarios (title) VALUES ('Preview Test')`).run().lastInsertRowid;
  const characterId = db.prepare(
    `INSERT INTO characters (name, role, gender, current_clothing, appearance_prompt) VALUES ('Riley', 'character', 'female', 'stale card outfit', 'auburn hair, green eyes')`
  ).run().lastInsertRowid;
  db.prepare(`INSERT INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)`).run(scenarioId, characterId);
  db.prepare(
    `INSERT INTO scenario_character_state (scenario_id, character_id, current_clothing) VALUES (?, ?, 'correct scenario outfit')`
  ).run(scenarioId, characterId);

  const card = withBrief ? {
    visual_brief: {
      main_subject: 'Riley',
      moment_summary: 'Riley walks into the room',
      setting_brief: 'foyer',
      shot_hint: 'medium',
      character_briefs: [
        { character_name: 'Riley', character_id: Number(characterId), role: 'main', visible: true, brief: 'walking through doorway, hand on frame' },
      ],
    },
  } : {};

  const turnId = db.prepare(
    `INSERT INTO turns (scenario_id, turn_number, role, content_text, scene_card_json) VALUES (?, 1, 'narrator', 'Riley walked into the room.', ?)`
  ).run(scenarioId, JSON.stringify(card)).lastInsertRowid;

  return { scenarioId, characterId, turnId };
}

function installFetchGuard(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    throw new Error(`unexpected fetch in preview test: ${url}`);
  });
  return calls;
}

test('CF-3: Prompt Preview includes scenario-resolved clothing without calling Ollama when composing from brief/generic', async (t) => {
  const calls = installFetchGuard(t);
  const { scenarioId, characterId, turnId } = seed({ withBrief: true });

  const result = await buildPromptPreview(db, { scenarioId, turnId, target: 'character', characterId });

  assert.equal(result.target, 'character');
  assert.equal(result.brief_source, 'visual_brief');
  assert.equal(calls.length, 0, 'must not call Ollama when a stored visual_brief exists');
  // Plain English Summary = character_brief (not clothing / not whole-scene summary)
  assert.match(String(result.summary_plain || ''), /walking through doorway/);
  assert.ok(!String(result.summary_plain || '').includes('correct scenario outfit'),
    'plain field must not dump clothing; clothing belongs in tags');
  assert.ok(!String(result.summary_plain || '').includes('Riley walks into the room'),
    'plain must not use whole-scene moment_summary');
  // Image Prompt Tags = description + clothing + brief + setting/shot
  const tags = String(result.summary_tags || '');
  assert.match(tags, /correct scenario outfit/);
  assert.match(tags, /auburn hair/);
  assert.match(tags, /walking through doorway/);
  assert.match(tags, /foyer|medium/i);
  assert.ok(!tags.includes('stale card outfit'));
});

test('CF-3: Prompt Preview and image-pipeline resolve clothing via the identical helper output', async (t) => {
  const { scenarioId, characterId } = seed();
  const resolved = getScenarioClothing(scenarioId, characterId);
  const forPreview = applyResolvedClothing({ id: characterId, current_clothing: 'stale card outfit' }, resolved);
  const forGeneration = applyResolvedClothing({ id: characterId, current_clothing: 'stale card outfit' }, resolved);
  assert.equal(forPreview.current_clothing, forGeneration.current_clothing);
  assert.equal(forPreview.current_clothing, 'correct scenario outfit');
});

test('CF-3: Prompt Preview returns 404-shaped error for an unknown character, without network', async (t) => {
  const calls = installFetchGuard(t);
  const { scenarioId, turnId } = seed();

  const result = await buildPromptPreview(db, { scenarioId, turnId, target: 'character', characterId: 999999 });

  assert.equal(result.status, 404);
  assert.equal(calls.length, 0);
});

test('character preview uses generic composition without requiring an extractor model', async (t) => {
  const calls = installFetchGuard(t);
  const { scenarioId, characterId, turnId } = seed({ withBrief: false });
  db.prepare(`DELETE FROM global_config WHERE key IN ('narrator_model', 'prompt_extractor_model', 'picker_model')`).run();

  const result = await buildPromptPreview(db, { scenarioId, turnId, target: 'character', characterId });

  assert.equal(result.brief_source, 'generic');
  assert.equal(calls.length, 0);
  // Generic plain = simple pose (not clothing dump, not scene summary)
  assert.match(String(result.summary_plain || ''), /full body|standing|candid|pose/i);
  assert.ok(!String(result.summary_plain || '').includes('Riley walked into the room'));
  // Tags still carry clothing + appearance
  assert.match(String(result.summary_tags || ''), /correct scenario outfit/);
  assert.match(String(result.summary_tags || ''), /auburn hair/);
  assert.ok(!result.status || result.status < 400);
});

test('scene preview prefers visual_brief.moment_summary over legacy image_prompt', async (t) => {
  installFetchGuard(t);
  const { scenarioId, turnId } = seed({ withBrief: true });
  db.prepare(`UPDATE turns SET scene_card_json = ? WHERE id = ?`).run(JSON.stringify({
    image_prompt: 'LEGACY_SHOULD_NOT_LEAD',
    visual_brief: {
      main_subject: 'Riley',
      moment_summary: 'Riley walks into the room',
      setting_brief: 'foyer with coat rack',
      shot_hint: 'medium',
      character_briefs: [
        { character_name: 'Riley', role: 'main', visible: true, brief: 'at the doorway' },
      ],
    },
  }), turnId);

  const result = await buildPromptPreview(db, { scenarioId, turnId, target: 'scene' });
  assert.match(String(result.summary_plain || ''), /Riley walks into the room/);
  assert.ok(!String(result.summary_plain || '').includes('LEGACY_SHOULD_NOT_LEAD'));
  assert.equal(result.main_subject, 'Riley');
});


test('character preview uses prior-turn brief when current turn has no entry for that character', async (t) => {
  const calls = installFetchGuard(t);
  const { scenarioId, characterId } = seed({ withBrief: false });
  const priorCard = {
    visual_brief: {
      main_subject: 'Riley',
      moment_summary: 'earlier beat',
      setting_brief: 'kitchen',
      shot_hint: 'wide',
      character_briefs: [
        { character_name: 'Riley', character_id: Number(characterId), role: 'main', visible: true, brief: 'leaning on the counter, smiling' },
      ],
    },
  };
  db.prepare(
    `INSERT INTO turns (scenario_id, turn_number, role, content_text, scene_card_json) VALUES (?, 1, 'narrator', 'Earlier.', ?)`
  ).run(scenarioId, JSON.stringify(priorCard));
  // Current turn mentions someone else / no briefs
  const turnId = db.prepare(
    `INSERT INTO turns (scenario_id, turn_number, role, content_text, scene_card_json) VALUES (?, 2, 'narrator', 'A door slammed.', ?)`
  ).run(scenarioId, JSON.stringify({
    visual_brief: {
      main_subject: 'door',
      moment_summary: 'A door slammed',
      setting_brief: 'hallway',
      shot_hint: null,
      character_briefs: [],
    },
  })).lastInsertRowid;

  const result = await buildPromptPreview(db, { scenarioId, turnId, target: 'character', characterId });
  assert.equal(result.brief_source, 'visual_brief');
  assert.equal(calls.length, 0);
  assert.match(String(result.summary_plain || ''), /leaning on the counter/);
  assert.match(String(result.summary_tags || ''), /correct scenario outfit/);
  assert.match(String(result.summary_tags || ''), /kitchen|wide/i);
});
