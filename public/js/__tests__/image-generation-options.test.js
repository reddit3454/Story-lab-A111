import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImageGenerationOptions } from '../utils.js';

test('buildImageGenerationOptions keeps scene description and optional character action separate', () => {
  assert.deepEqual(buildImageGenerationOptions({
    turnId: 42,
    mode: 'portrait',
    sceneText: 'A quiet apartment at dusk',
    characterAction: 'fastening one earring',
    characterId: 7,
  }), {
    turnId: 42,
    mode: 'portrait',
    actionText: 'A quiet apartment at dusk',
    characterAction: 'fastening one earring',
    characterIds: [7],
  });
});

test('buildImageGenerationOptions omits blank optional character action', () => {
  assert.deepEqual(buildImageGenerationOptions({
    turnId: 42,
    mode: 'scene',
    sceneText: 'A quiet apartment at dusk',
    characterAction: '   ',
  }), {
    turnId: 42,
    mode: 'scene',
    actionText: 'A quiet apartment at dusk',
  });
});

test('buildImageGenerationOptions forwards one selected pose id without changing prompt fields', () => {
  assert.deepEqual(buildImageGenerationOptions({
    turnId: 17,
    sceneText: 'sitting in an armchair',
    poseId: 'sitting-demo-01',
  }), {
    turnId: 17,
    mode: 'scene',
    actionText: 'sitting in an armchair',
    poseId: 'sitting-demo-01',
  });
});
