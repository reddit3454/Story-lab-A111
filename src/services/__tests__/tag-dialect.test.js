import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSceneTagSystem,
  buildCharacterTagSystem,
  buildRegenTagSystem,
  FORBIDDEN_GAZE,
  SCENE_TAG_COUNT,
} from '../tag-dialect.js';

test('scene, character, and regen systems share forbidden gaze dialect', () => {
  const scene = buildSceneTagSystem();
  const character = buildCharacterTagSystem();
  const regen = buildRegenTagSystem();
  for (const tag of FORBIDDEN_GAZE) {
    assert.ok(scene.includes(tag), `scene missing ${tag}`);
    assert.ok(character.includes(tag), `character missing ${tag}`);
    assert.ok(regen.includes(tag), `regen missing ${tag}`);
  }
  assert.ok(scene.includes(`${SCENE_TAG_COUNT.min} to ${SCENE_TAG_COUNT.max}`));
  assert.ok(!character.toLowerCase().includes('looking at viewer or looking off-screen are both allowed'));
});

test('regen few-shot appends without changing dialect rules', () => {
  const withShot = buildRegenTagSystem({ fewShot: 'Example 1:\nPlain: x\nTags: y' });
  assert.ok(withShot.includes('Example 1:'));
  assert.ok(withShot.includes('looking at viewer'));
});
