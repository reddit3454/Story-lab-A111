import { test } from 'node:test';
import assert from 'node:assert/strict';

test('buildSystemPrompt scene card gates NSFW field instructions', async () => {
  const { buildSystemPrompt } = await import('../narrator.js');
  const base = {
    scenario: { system_prompt: 'Be concise.', premise: '', nsfw_enabled: false, tone_modifier: '' },
    characters: [],
    location: null,
    rules: [],
    worldEntries: [],
    memories: [],
    relationships: [],
    lastArousal: 1,
    characterStates: {},
  };
  const sfw = buildSystemPrompt({
    ...base,
    config: { nsfw_enabled: false, explicit_mode: false },
  });
  assert.ok(sfw.includes('---SCENE---'));
  assert.ok(sfw.includes('nsfw_elements must be false'));
  assert.ok(!sfw.includes('named sex act'));

  const nsfwScenario = {
    ...base,
    scenario: { ...base.scenario, nsfw_enabled: true },
  };
  const nsfw = buildSystemPrompt({
    ...nsfwScenario,
    config: { nsfw_enabled: true, explicit_mode: false },
  });
  assert.ok(nsfw.includes('explicit_act'));
  assert.ok(nsfw.includes('null unless clearly visible now'));
  assert.ok(!nsfw.includes('nsfw_elements must be false'));
});
