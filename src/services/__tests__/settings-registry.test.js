import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSettingsRegistry, getVisibleSettings } from '../settings-registry.js';

test('every active setting declares one visible owner or an internal classification', () => {
  const active = getSettingsRegistry().filter((setting) => setting.status === 'active');
  assert.ok(active.length > 0);
  for (const setting of active) {
    assert.ok(setting.uiOwner || setting.classification === 'internal', setting.key + ' has no declared owner');
  }
});

test('scene-state and preload settings are visible runtime controls', () => {
  const visible = new Map(getVisibleSettings().map((setting) => [setting.key, setting]));
  assert.equal(visible.get('scene_state_enabled').uiOwner, 'story-dynamics');
  assert.equal(visible.get('scene_state_model').uiOwner, 'story-dynamics');
  assert.equal(visible.get('scene_state_keep_alive').uiOwner, 'story-dynamics');
  assert.equal(visible.get('image_warmup_enabled').uiOwner, 'image-generation');
});

test('the stale llama.cpp extractor route is explicitly legacy', () => {
  const stale = getSettingsRegistry().find((setting) => setting.key === 'llamacpp_config.extractor');
  assert.equal(stale.status, 'legacy');
  assert.match(stale.reason, /scene-state/i);
});
