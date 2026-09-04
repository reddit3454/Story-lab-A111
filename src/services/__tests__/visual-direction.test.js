import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVisualDirection, parseVisualDirections, visualDirectionPromptText } from '../visual-direction.js';

const CAST = [{ id: 7, name: 'Riley' }, { id: 9, name: 'Morgan' }, { id: 11, name: 'Avery' }];

test('normalizes a two-subject scene direction', () => {
  const result = normalizeVisualDirection({ text: 'Riley hands Morgan a book.', subjectIds: [7, 9], framing: 'medium' }, CAST, 'scene');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.direction, { action_text: 'Riley hands Morgan a book.', subject_ids: [7, 9], framing: 'medium' });
});

test('rejects a third scene subject and a cross-scenario subject', () => {
  const result = normalizeVisualDirection({ text: 'Action.', subjectIds: [7, 9, 404] }, CAST, 'scene');
  assert.ok(result.errors.some((error) => /at most two/.test(error)));
  assert.ok(result.errors.some((error) => /scenario cast/.test(error)));
});

test('fullbody direction requires the selected cast character and excludes close framing', () => {
  const result = normalizeVisualDirection({ text: 'Riley kneels to tie a boot.', framing: 'close' }, CAST, 'fullbody', 7);
  assert.ok(result.errors.some((error) => /auto, medium, or wide/.test(error)));
  assert.match(visualDirectionPromptText({ action_text: 'Riley kneels to tie a boot.', framing: 'auto' }, 'fullbody'), /full-body composition, entire figure in frame/);
});

test('malformed stored direction returns an empty versioned record', () => {
  const result = parseVisualDirections('{bad json', CAST);
  assert.deepEqual(result.scene.subject_ids, []);
  assert.deepEqual(result.fullbody_by_character, {});
});

test('parseVisualDirections drops a stored scene subject whose character has left the cast', () => {
  const stored = JSON.stringify({ scene: { action_text: 'the two of them talk', subject_ids: [7, 9], framing: 'auto' } });
  // Morgan (9) is no longer in the scenario.
  const result = parseVisualDirections(stored, [{ id: 7, name: 'Riley' }]);
  assert.deepEqual(result.scene.subject_ids, [7]);
});
