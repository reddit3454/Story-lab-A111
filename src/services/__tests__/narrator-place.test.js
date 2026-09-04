// The narrator's "Current Location" block must render from a resolved place —
// either a location card or the scenario's free-text place — via
// resolveScenarioPlace(). This guards the shape contract between that helper
// and buildSystemPrompt().
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-narr-place-'));
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
const { resolveScenarioPlace } = await import('../scenario-place.js');

test('free-text place renders a Current Location block in the narrator prompt', () => {
  const place = resolveScenarioPlace({
    scenario: { active_location_id: null, active_place_text: 'a fog-bound fishing pier at night' },
    location: null,
  });
  const prompt = buildSystemPrompt({
    scenario: { premise: 'x', nsfw_enabled: 1 },
    characters: [], location: place, rules: [], worldEntries: [], memories: [],
    relationships: [], lastArousal: 1, characterStates: {}, config: { nsfw_enabled: true },
  });
  assert.match(prompt, /Current Location: a fog-bound fishing pier at night/);
});

test('no place resolves to null and produces no Current Location block', () => {
  const place = resolveScenarioPlace({ scenario: { active_place_text: '' }, location: null });
  const prompt = buildSystemPrompt({
    scenario: { premise: 'x', nsfw_enabled: 1 },
    characters: [], location: place, rules: [], worldEntries: [], memories: [],
    relationships: [], lastArousal: 1, characterStates: {}, config: { nsfw_enabled: true },
  });
  assert.doesNotMatch(prompt, /Current Location:/);
});
