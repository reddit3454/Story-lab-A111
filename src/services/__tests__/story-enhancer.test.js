import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSdxlPrompt } from '../story-enhancer.js';

// buildSdxlPrompt: absent model → returns fallback { positive, negative } without Ollama call
test('buildSdxlPrompt returns fallback when model is empty string', async () => {
  const result = await buildSdxlPrompt({
    char: null,
    scene: 'a dark forest at night',
    physicalTraits: null,
    nsfw: false,
    model: '',
  });
  assert.ok(result && typeof result === 'object', 'result must be an object');
  assert.ok(typeof result.positive === 'string' && result.positive.length > 0, 'positive must be non-empty string');
  assert.ok(typeof result.negative === 'string' && result.negative.length > 0, 'negative must be non-empty string');
  assert.ok(result.positive.includes('dark forest'), `positive should contain scene text, got: ${result.positive}`);
});

test('buildSdxlPrompt returns fallback when model is null', async () => {
  const result = await buildSdxlPrompt({
    char: null,
    scene: 'beach sunset',
    model: null,
  });
  assert.ok(result.positive.length > 0);
  assert.ok(result.negative.length > 0);
});

// buildSdxlPrompt: absent model + character → fallback includes trait block
test('buildSdxlPrompt fallback includes character traits when model absent', async () => {
  const char = {
    name: 'Alice',
    gender: 'female',
    hair_color: 'red',
    hair_style: 'long',
    eye_color: 'green',
    skin_tone: 'fair',
    body_type: 'slim',
    breast_size: null,
    butt_size: null,
  };
  const result = await buildSdxlPrompt({
    char,
    scene: 'standing in a doorway',
    model: '',
  });
  assert.ok(result.positive.includes('red') || result.positive.includes('red long hair'), `expected hair in positive, got: ${result.positive}`);
  assert.ok(result.positive.includes('green') || result.positive.includes('green eyes'), `expected eyes in positive, got: ${result.positive}`);
});

// buildSdxlPrompt: always returns { positive, negative } shape
test('buildSdxlPrompt always returns positive and negative keys', async () => {
  const result = await buildSdxlPrompt({ char: null, scene: 'empty room', model: '' });
  assert.ok(Object.hasOwn(result, 'positive'));
  assert.ok(Object.hasOwn(result, 'negative'));
});

// buildSdxlPrompt: prefix is included in fallback positive
test('buildSdxlPrompt fallback uses prefix when provided', async () => {
  const result = await buildSdxlPrompt({
    char: null,
    scene: 'a rainy street',
    prefix: 'film noir style',
    model: '',
  });
  assert.ok(result.positive.includes('film noir style'), `expected prefix in positive, got: ${result.positive}`);
});
