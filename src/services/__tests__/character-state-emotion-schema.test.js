import { test } from 'node:test';
import assert from 'node:assert/strict';

test('EMOTION_JSON_SCHEMA requires wrapped updates array', async () => {
  const { EMOTION_JSON_SCHEMA } = await import('../character-state.js');
  assert.equal(EMOTION_JSON_SCHEMA.type, 'object');
  assert.deepEqual(EMOTION_JSON_SCHEMA.required, ['updates']);
  assert.equal(EMOTION_JSON_SCHEMA.properties.updates.type, 'array');
  assert.ok(EMOTION_JSON_SCHEMA.properties.updates.items.required.includes('characterId'));
});
