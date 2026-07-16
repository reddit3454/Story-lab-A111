import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSdxlPrompt } from '../story-enhancer.js';

// ollama.js's chat() calls the global fetch() — mocking globalThis.fetch (not the ollama.js
// module) is the reliable way to control its response per-test; see scene-picker.test.js for
// why mock.module() on ollama.js itself would not work here (ESM binding caching).
function mockOllamaChatResponse(t, content) {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ message: { content } }),
  }));
}

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

// Regression for the multi-character prose leak: the local LLM echoed the raw
// visual-brief character_briefs[] back verbatim (comma-heavy narrative, "Name: sentence"
// attributions for every cast member) instead of condensing to SD tags. The old
// isStoryOutput() only rejected output with FEWER than 3 commas, so this comma-heavy
// prose sailed through validation and went to A1111 as-is.
test('buildSdxlPrompt rejects a multi-character narrative echo and falls back to the deterministic prompt', async (t) => {
  const proseLeak =
    'Ma is actively servicing Jib, licking his cock while pumping her hand between her legs ' +
    'to rub at her clit. Jib cumulates in her mouth as she continues to service him. The other ' +
    'girls are also experiencing their own orgasms, with Lorey coming undone on Piper\'s tongue ' +
    'and Sarah and Riley reaching their shared peak moments later, fingers and mouths working in ' +
    'tandem to bring each other to the ultimate heights of ecstasy., Ma: Ma is lying on Jib\'s ' +
    'body, licking his cock with her tongue swirling around the head and pumping her hand between ' +
    'her legs to rub at her clit while he cumulates in her mouth., Jib: Jib is lying on his back, ' +
    'his body tensing as he climaxes with his cock pulsating and shooting thick ropes of cum ' +
    'directly down Ma\'s eager throat.; Lorey: Lorey is lying on Piper, her body arched as she ' +
    'comes undone with a gush of release.; Sarah: Sarah is lying next to Riley, their bodies close ' +
    'together as they reach their shared peak moments later.';
  mockOllamaChatResponse(t, `${proseLeak}\n\nNegative prompt: worst quality, blurry`);

  const result = await buildSdxlPrompt({
    char: { name: 'Jib', gender: 'male' },
    scene: 'group scene in a bedroom',
    model: 'fake-model',
  });

  assert.ok(!result.positive.includes('Ma is actively servicing Jib'),
    `expected the prose leak to be rejected and fall back to the deterministic prompt, got: ${result.positive}`);
  assert.ok(!/\bLorey:\s+Lorey/.test(result.positive),
    `expected no per-character "Name: sentence" attributions to leak through, got: ${result.positive}`);
  assert.ok(result.positive.includes('group scene in a bedroom'),
    `expected the deterministic fallback (built from the scene param) to be used, got: ${result.positive}`);
});

test('buildSdxlPrompt accepts a normal comma-heavy but valid tag-style output', async (t) => {
  const validTags =
    'masterpiece, best quality, highly detailed, medium shot, standing near window, ' +
    'warm afternoon light, soft shadows, casual pose, looking away, cinematic composition';
  mockOllamaChatResponse(t, `${validTags}\n\nNegative prompt: worst quality, blurry`);

  const result = await buildSdxlPrompt({
    char: { name: 'Riley', gender: 'female' },
    scene: 'standing near a window',
    model: 'fake-model',
  });

  assert.ok(result.positive.includes('standing near window'),
    `expected the valid tag-style enhancer output to be accepted, got: ${result.positive}`);
});

test('buildSdxlPrompt rejects positive output far past the ~100 word contract even with plenty of commas', async (t) => {
  const longTagSoup = Array.from({ length: 150 }, (_, i) => `tag${i}`).join(', ');
  mockOllamaChatResponse(t, `${longTagSoup}\n\nNegative prompt: worst quality`);

  const result = await buildSdxlPrompt({
    char: { name: 'Riley', gender: 'female' },
    scene: 'a long scene description used as the fallback marker',
    model: 'fake-model',
  });

  assert.ok(result.positive.includes('a long scene description used as the fallback marker'),
    `expected word-count overrun to reject and fall back to the deterministic prompt, got: ${result.positive}`);
});
