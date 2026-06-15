import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMotionPrompt, pickBestMoment } from '../scene-picker.js';

// buildMotionPrompt: null/non-object → returns baseline string
test('buildMotionPrompt returns baseline for null input', () => {
  const result = buildMotionPrompt(null);
  assert.ok(result.includes('breathing'), `expected breathing baseline, got: ${result}`);
  assert.ok(typeof result === 'string');
  assert.ok(result.length > 0);
});

test('buildMotionPrompt returns baseline for non-object input', () => {
  const result = buildMotionPrompt('string input');
  assert.ok(result.includes('breathing'));
});

// buildMotionPrompt: object with visibleAction is included
test('buildMotionPrompt includes visibleAction from picked moment', () => {
  const result = buildMotionPrompt({ visibleAction: 'she reaches for the door' });
  assert.ok(result.includes('she reaches for the door'));
  assert.ok(result.includes('breathing')); // baseline always appended
});

// buildMotionPrompt: result never exceeds 200 chars
test('buildMotionPrompt output is at most 200 characters', () => {
  const long = 'a'.repeat(300);
  const result = buildMotionPrompt({ visibleAction: long });
  assert.ok(result.length <= 200);
});

// buildMotionPrompt: alternate field names (scene card format)
test('buildMotionPrompt uses action field when visibleAction absent', () => {
  const result = buildMotionPrompt({ action: 'he sits down slowly' });
  assert.ok(result.includes('he sits down slowly'));
});

// buildMotionPrompt: empty object returns baseline
test('buildMotionPrompt with empty object returns baseline', () => {
  const result = buildMotionPrompt({});
  assert.ok(result.includes('breathing'));
});

// pickBestMoment: empty turns → null without Ollama call
test('pickBestMoment returns null for empty contextTurns', async () => {
  const result = await pickBestMoment([], [], [], 'some-model', false);
  assert.equal(result, null);
});

// pickBestMoment: falsy model → null without Ollama call
test('pickBestMoment returns null when pickerModel is null', async () => {
  const result = await pickBestMoment(['turn one', 'turn two'], [], [], null, false);
  assert.equal(result, null);
});

test('pickBestMoment returns null when pickerModel is empty string', async () => {
  const result = await pickBestMoment(['turn one'], [], [], '', false);
  assert.equal(result, null);
});
