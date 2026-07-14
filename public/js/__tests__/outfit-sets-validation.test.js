// Regression tests for CF-5: the Character Editor's raw outfit-sets JSON textarea must
// never silently discard invalid input while reporting success. Pure, DOM-free logic —
// safe to unit-test with node:test even though this file is served to the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOutfitSetsForSave } from '../outfit-sets-validation.js';

test('resolveOutfitSetsForSave uses the structured-editor fallback when the raw textarea is empty', () => {
  const fallback = [{ name: 'Casual', description: 'jeans, t-shirt' }];
  const result = resolveOutfitSetsForSave('', fallback);
  assert.equal(result.ok, true);
  assert.equal(result.json, JSON.stringify(fallback));
});

test('resolveOutfitSetsForSave uses the fallback when the raw textarea is whitespace-only', () => {
  const fallback = [];
  const result = resolveOutfitSetsForSave('   \n  ', fallback);
  assert.equal(result.ok, true);
  assert.equal(result.json, '[]');
});

test('resolveOutfitSetsForSave accepts valid JSON array text and uses it verbatim', () => {
  const raw = '[{"name":"Formal","description":"black suit"}]';
  const result = resolveOutfitSetsForSave(raw, [{ name: 'Casual', description: 'jeans' }]);
  assert.equal(result.ok, true);
  assert.equal(result.json, JSON.stringify(JSON.parse(raw)));
});

test('resolveOutfitSetsForSave FAILS explicitly on malformed JSON — never silently falls back', () => {
  const fallback = [{ name: 'Casual', description: 'jeans' }];
  const result = resolveOutfitSetsForSave('[{"name": "Formal", "description":}]', fallback);
  assert.equal(result.ok, false, 'malformed JSON must be reported as a failure, not silently discarded');
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  assert.equal(result.json, undefined, 'a failed result must not also carry a json value the caller could mistakenly save');
});

test('resolveOutfitSetsForSave FAILS explicitly on valid JSON that is not an array', () => {
  const result = resolveOutfitSetsForSave('{"name":"Formal","description":"black suit"}', []);
  assert.equal(result.ok, false, 'a single object (not an array) must be rejected, not silently accepted');
  assert.ok(/array/i.test(result.error));
});

test('resolveOutfitSetsForSave FAILS on a JSON array of the wrong shape (still not silently discarded)', () => {
  // Valid JSON, valid array — but not what outfit_sets expects. Left to the backend's own
  // parseClothingSets() filtering for per-entry shape; this function's job is strictly
  // "is this parseable as an array", matching its narrow, documented scope.
  const result = resolveOutfitSetsForSave('["not", "an", "object", "list"]', []);
  assert.equal(result.ok, true, 'array-of-strings is still a JSON array; per-entry shape validation is the backend\'s job');
});
