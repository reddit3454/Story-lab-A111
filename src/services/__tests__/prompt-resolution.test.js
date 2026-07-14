import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyResolvedClothing, resolvePrimaryCharacterForReference } from '../prompt-resolution.js';

// applyResolvedClothing: sets both current_clothing and base_clothing from resolved value
test('applyResolvedClothing sets current_clothing and base_clothing from resolved value', () => {
  const char = { id: 1, name: 'Alice', current_clothing: 'old dress', base_clothing: 'old dress' };
  const result = applyResolvedClothing(char, 'blue sundress');
  assert.equal(result.current_clothing, 'blue sundress');
  assert.equal(result.base_clothing, 'blue sundress');
  assert.equal(result.name, 'Alice', 'other fields must be preserved');
});

test('applyResolvedClothing trims whitespace', () => {
  const result = applyResolvedClothing({ id: 1 }, '  red jacket  ');
  assert.equal(result.current_clothing, 'red jacket');
});

test('applyResolvedClothing treats null/undefined clothing as empty string', () => {
  const result = applyResolvedClothing({ id: 1 }, null);
  assert.equal(result.current_clothing, '');
  assert.equal(result.base_clothing, '');
});

test('applyResolvedClothing does not mutate the input object', () => {
  const char = { id: 1, current_clothing: 'old' };
  applyResolvedClothing(char, 'new outfit');
  assert.equal(char.current_clothing, 'old', 'input object must not be mutated');
});

// resolvePrimaryCharacterForReference: character mode always uses the character being generated
test('resolvePrimaryCharacterForReference returns resolvedChar directly in character mode', () => {
  const resolvedChar = { id: 5, name: 'Bob', role: 'character' };
  const characters = [
    { id: 1, name: 'Alice', role: 'character' },
    resolvedChar,
  ];
  const result = resolvePrimaryCharacterForReference({
    mode: 'character',
    resolvedChar,
    characters,
    mainSubject: 'Alice',
  });
  assert.equal(result.id, 5, 'character mode must ignore mainSubject and use the target character');
});

// resolvePrimaryCharacterForReference: scene mode matches the actual scene subject via the
// scene-picker's real mainSubject field, not alphabetical order
test('resolvePrimaryCharacterForReference scene mode matches cast member named in mainSubject', () => {
  const characters = [
    { id: 1, name: 'Alice', role: 'character' },
    { id: 2, name: 'Bob', role: 'character' },
  ];
  const result = resolvePrimaryCharacterForReference({
    mode: 'scene',
    resolvedChar: null,
    characters,
    mainSubject: 'Bob, leaning against the doorway',
  });
  assert.equal(result.id, 2, 'must pick Bob (scene subject), not Alice (alphabetically first)');
});

test('resolvePrimaryCharacterForReference scene mode name match is case-insensitive', () => {
  const characters = [
    { id: 1, name: 'Alice', role: 'character' },
    { id: 2, name: 'Bob', role: 'character' },
  ];
  const result = resolvePrimaryCharacterForReference({
    mode: 'scene',
    resolvedChar: null,
    characters,
    mainSubject: 'BOB and the room',
  });
  assert.equal(result.id, 2);
});

test('resolvePrimaryCharacterForReference scene mode picks the first cast-order NPC named in mainSubject when multiple are mentioned', () => {
  const characters = [
    { id: 1, name: 'Alice', role: 'character' },
    { id: 2, name: 'Bob', role: 'character' },
  ];
  const result = resolvePrimaryCharacterForReference({
    mode: 'scene',
    resolvedChar: null,
    characters,
    mainSubject: 'Bob and Alice',
  });
  assert.equal(result.id, 1, 'matches in cast order (Alice before Bob), not text order');
});

test('resolvePrimaryCharacterForReference scene mode falls back to first non-player cast member when mainSubject is absent', () => {
  const characters = [
    { id: 1, name: 'Player', role: 'player' },
    { id: 2, name: 'Alice', role: 'character' },
    { id: 3, name: 'Bob', role: 'character' },
  ];
  const result = resolvePrimaryCharacterForReference({
    mode: 'scene',
    resolvedChar: null,
    characters,
    mainSubject: null,
  });
  assert.equal(result.id, 2, 'must fall back to first non-player cast member');
});

test('resolvePrimaryCharacterForReference scene mode falls back when mainSubject names no cast member', () => {
  const characters = [
    { id: 1, name: 'Alice', role: 'character' },
    { id: 2, name: 'Bob', role: 'character' },
  ];
  const result = resolvePrimaryCharacterForReference({
    mode: 'scene',
    resolvedChar: null,
    characters,
    mainSubject: 'the mysterious stranger',
  });
  assert.equal(result.id, 1, 'falls back to first non-player cast member when no name matches');
});

test('resolvePrimaryCharacterForReference scene mode ignores a legacy/unused characters_present field on sceneCard', () => {
  // Regression guard: the old (broken) signal must not be read anymore, even if present.
  const characters = [
    { id: 1, name: 'Alice', role: 'character' },
    { id: 2, name: 'Bob', role: 'character' },
  ];
  const result = resolvePrimaryCharacterForReference({
    mode: 'scene',
    resolvedChar: null,
    characters,
    mainSubject: null,
    sceneCard: { characters_present: [{ name: 'Bob' }] },
  });
  assert.equal(result.id, 1, 'characters_present must be ignored; falls back to first non-player cast member');
});

test('resolvePrimaryCharacterForReference returns null for empty cast', () => {
  const result = resolvePrimaryCharacterForReference({
    mode: 'scene',
    resolvedChar: null,
    characters: [],
    mainSubject: null,
  });
  assert.equal(result, null);
});
