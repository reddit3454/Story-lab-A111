// The narrator writes prose only. Scene state (mood/arousal/clothing) is
// extracted from the finished prose by scene-state.js, so the system prompt
// must NOT ask the model to append a ---SCENE--- JSON block.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-narr-'));
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'), DATA_DIR: DATA,
    AUDIO_DIR: path.join(ROOT, 'audio'), IMAGES_DIR: path.join(ROOT, 'images'),
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DATA, 'audit.jsonl'),
  },
});

const { buildSystemPrompt } = await import('../narrator.js');

test('system prompt contains no scene-card instruction', () => {
  const prompt = buildSystemPrompt({
    scenario: { premise: 'A quiet evening', tone: 'Dramatic', nsfw_enabled: 1 },
    characters: [{ id: 1, name: 'Carol', role: 'character' }],
    location: null, rules: [], worldEntries: [], memories: [],
    relationships: [], lastArousal: 4, characterStates: {}, config: { nsfw_enabled: true },
  });
  assert.ok(!prompt.includes('---SCENE---'), 'prompt still has ---SCENE--- block');
  assert.ok(!/SCENE CARD/i.test(prompt), 'prompt still has SCENE CARD rules');
  assert.ok(!/clothing_changes/.test(prompt), 'prompt still mentions clothing_changes');
});

test('scene intensity baseline still passes through (cohesion signal)', () => {
  const prompt = buildSystemPrompt({
    scenario: { premise: 'x', nsfw_enabled: 1 },
    characters: [], location: null, rules: [], worldEntries: [], memories: [],
    relationships: [], lastArousal: 6, characterStates: {}, config: { nsfw_enabled: true },
  });
  assert.match(prompt, /Scene intensity baseline: 6\/10/);
});
