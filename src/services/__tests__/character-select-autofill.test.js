import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-char-select-'));
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

/**
 * Regression: selecting a character chip must populate BOTH fields without
 * depending on a live Ollama "re-summarize the scene" call when a brief exists
 * (and still populate via generic when it does not).
 */
test('character select path populates plain + tags from visual_brief (no Ollama)', async (t) => {
  const fetches = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetches.push(String(url));
    throw new Error('Ollama must not be required for character select auto-fill');
  });

  db.prepare(`INSERT OR REPLACE INTO global_config (key, value) VALUES ('narrator_model', 'fake-model')`).run();
  const scenarioId = db.prepare(`INSERT INTO scenarios (title) VALUES ('Select Test')`).run().lastInsertRowid;
  const characterId = db.prepare(
    `INSERT INTO characters (name, role, gender, appearance_prompt, current_clothing)
     VALUES ('Riley', 'character', 'female', 'auburn hair, green eyes', 'stale')`
  ).run().lastInsertRowid;
  db.prepare(`INSERT INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)`).run(scenarioId, characterId);
  db.prepare(
    `INSERT INTO scenario_character_state (scenario_id, character_id, current_clothing) VALUES (?, ?, 'blue dress')`
  ).run(scenarioId, characterId);

  const card = {
    visual_brief: {
      main_subject: 'Riley',
      moment_summary: 'Riley opens the door',
      setting_brief: 'hallway',
      shot_hint: 'medium',
      character_briefs: [{
        character_name: 'Riley',
        character_id: Number(characterId),
        role: 'main',
        visible: true,
        brief: 'opening the door, looking inside',
        expression: 'curious',
        attention: 'into the room',
      }],
    },
  };
  const turnId = db.prepare(
    `INSERT INTO turns (scenario_id, turn_number, role, content_text, scene_card_json) VALUES (?, 1, 'narrator', 'Riley opened the door.', ?)`
  ).run(scenarioId, JSON.stringify(card)).lastInsertRowid;

  // Same payload the chip click sends via API.postPromptPreview
  const result = await buildPromptPreview(db, {
    scenarioId,
    turnId,
    target: 'character',
    characterId,
  });

  assert.equal(fetches.length, 0, 'character select must not call Ollama when brief exists');
  assert.ok(result.summary_plain && result.summary_plain.trim(), 'Plain English Summary must auto-fill');
  assert.ok(result.summary_tags && result.summary_tags.trim(), 'Image Prompt Tags must auto-fill');
  assert.match(result.summary_plain, /opening the door/);
  assert.match(result.summary_tags, /blue dress/);
  assert.match(result.summary_tags, /auburn hair/);
  assert.match(result.summary_tags, /opening the door/);
});

test('character select still auto-fills via generic when no brief exists (no Ollama)', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('generic path must not need Ollama');
  });
  const scenarioId = db.prepare(`INSERT INTO scenarios (title) VALUES ('Generic Select')`).run().lastInsertRowid;
  const characterId = db.prepare(
    `INSERT INTO characters (name, role, appearance_prompt) VALUES ('Sam', 'character', 'short black hair')`
  ).run().lastInsertRowid;
  db.prepare(`INSERT INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)`).run(scenarioId, characterId);
  db.prepare(
    `INSERT INTO scenario_character_state (scenario_id, character_id, current_clothing) VALUES (?, ?, 'red jacket')`
  ).run(scenarioId, characterId);
  const turnId = db.prepare(
    `INSERT INTO turns (scenario_id, turn_number, role, content_text, scene_card_json) VALUES (?, 1, 'narrator', 'Silence.', '{}')`
  ).run(scenarioId).lastInsertRowid;

  const result = await buildPromptPreview(db, {
    scenarioId, turnId, target: 'character', characterId,
  });
  assert.equal(result.brief_source, 'generic');
  assert.ok(result.summary_plain.trim(), 'plain must fill');
  assert.ok(result.summary_tags.trim(), 'tags must fill');
  assert.match(result.summary_tags, /red jacket/);
  assert.match(result.summary_tags, /short black hair/);
});
