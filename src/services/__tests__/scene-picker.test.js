// scene-picker.js's only exported function is pickBestMoment(). A prior version of this
// test file imported a buildMotionPrompt() export that no longer exists anywhere in the
// module (removed in an earlier rewrite without updating the test) — that always failed
// at import time with a SyntaxError, before any assertion ever ran. Replaced with tests
// against the real current export.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// pickBestMoment: empty turns / no model -> null without ever calling Ollama
test('pickBestMoment returns null for empty contextTurns', async () => {
  const { pickBestMoment } = await import('../scene-picker.js');
  const result = await pickBestMoment([], [], [], 'some-model', false);
  assert.equal(result, null);
});

test('pickBestMoment returns null when pickerModel is null', async () => {
  const { pickBestMoment } = await import('../scene-picker.js');
  const result = await pickBestMoment(['turn one', 'turn two'], [], [], null, false);
  assert.equal(result, null);
});

test('pickBestMoment returns null when pickerModel is empty string', async () => {
  const { pickBestMoment } = await import('../scene-picker.js');
  const result = await pickBestMoment(['turn one'], [], [], '', false);
  assert.equal(result, null);
});

// pickBestMoment: real chat() call path. ollama.js's chat() itself calls the global
// fetch() — mocking globalThis.fetch (not the ollama.js module) is the reliable way to
// control its response per-test: ES module bindings are cached by resolved URL, so
// re-running mock.module('../ollama.js', ...) inside each test would NOT actually
// re-intercept scene-picker.js's already-resolved import of chat() after the first test
// loads it — every subsequent test would silently keep hitting the real network instead
// (confirmed: an earlier version of this file appeared to pass by using unmocked-network
// failures to coincidentally produce the same `null` result the mocked case expected).
test('pickBestMoment parses and returns a valid candidate from chat()', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ message: { content: JSON.stringify({
      summary: 'a moment', mainSubject: 'Riley', visibleAction: 'she turns to face the door',
      setting: 'a hallway', shotType: 'medium', imageabilityScore: 6, penaltyReason: null,
    }) } }),
  }));
  const { pickBestMoment } = await import('../scene-picker.js');
  const result = await pickBestMoment(['she stood up.'], [{ name: 'Riley' }], [], 'some-model', false);
  assert.ok(result, 'expected a parsed candidate object');
  assert.equal(result.mainSubject, 'Riley');
  assert.equal(result.visibleAction, 'she turns to face the door');
});

test('pickBestMoment returns null when chat() response has no visibleAction', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ message: { content: JSON.stringify({ summary: 'a moment' }) } }),
  }));
  const { pickBestMoment } = await import('../scene-picker.js');
  const result = await pickBestMoment(['she stood up.'], [], [], 'some-model', false);
  assert.equal(result, null);
});

test('pickBestMoment returns null when chat() response is not valid JSON', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ message: { content: 'not json at all' } }),
  }));
  const { pickBestMoment } = await import('../scene-picker.js');
  const result = await pickBestMoment(['she stood up.'], [], [], 'some-model', false);
  assert.equal(result, null);
});

test('pickBestMoment returns null (never throws) when the Ollama call fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('ollama down'); });
  const { pickBestMoment } = await import('../scene-picker.js');
  const result = await pickBestMoment(['she stood up.'], [], [], 'some-model', false);
  assert.equal(result, null);
});


test('resolvePickerContextTurns focuses on the clicked turn text when present', async () => {
  const { resolvePickerContextTurns } = await import('../scene-picker.js');
  const turns = resolvePickerContextTurns({
    focalTurnText: 'Riley grabs the keys and runs to the door.',
    recentTurnsChronological: [
      'Earlier Sarah sat on the couch.',
      'Someone else walked by.',
      'Riley grabs the keys and runs to the door.',
    ],
  });
  assert.deepEqual(turns, ['Riley grabs the keys and runs to the door.']);
});

test('resolvePickerContextTurns falls back to chronological recent turns when no focal turn', async () => {
  const { resolvePickerContextTurns } = await import('../scene-picker.js');
  const turns = resolvePickerContextTurns({
    focalTurnText: null,
    recentTurnsChronological: ['First beat.', 'Second beat.'],
  });
  assert.deepEqual(turns, ['First beat.', 'Second beat.']);
});

test('resolvePickerContextTurns ignores blank focal text', async () => {
  const { resolvePickerContextTurns } = await import('../scene-picker.js');
  const turns = resolvePickerContextTurns({
    focalTurnText: '   ',
    recentTurnsChronological: ['Only recent.'],
  });
  assert.deepEqual(turns, ['Only recent.']);
});


test('buildPickerJsonSchema includes NSFW fields only when enabled', async () => {
  const { buildPickerJsonSchema } = await import('../scene-picker.js');
  const sfw = buildPickerJsonSchema(false);
  assert.equal(sfw.type, 'object');
  assert.ok(sfw.required.includes('visibleAction'));
  assert.equal('bodyPosition' in sfw.properties, false);

  const nsfw = buildPickerJsonSchema(true);
  assert.ok(nsfw.required.includes('explicitAct'));
  assert.ok('nudityState' in nsfw.properties);
});

test('pickBestMoment sends format schema and low temperature', async (t) => {
  let captured = null;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    captured = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            summary: 'a moment',
            mainSubject: 'Riley',
            visibleAction: 'she turns to face the door',
            setting: 'a hallway',
            shotType: 'medium',
            imageabilityScore: 6,
            penaltyReason: null,
          }),
        },
      }),
    };
  });
  const { pickBestMoment } = await import('../scene-picker.js');
  const result = await pickBestMoment(['she stood up.'], [{ name: 'Riley' }], [], 'some-model', false);
  assert.ok(result);
  assert.ok(captured.format);
  assert.equal(captured.format.type, 'object');
  assert.equal(captured.options.temperature, 0.1);
  assert.ok(String(captured.messages[0].content).includes('ONE camera shot'));
});
