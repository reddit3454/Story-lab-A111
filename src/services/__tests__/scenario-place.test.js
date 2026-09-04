import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScenarioPlace } from '../scenario-place.js';

test('prefers a linked location card over free-text place', () => {
  const place = resolveScenarioPlace({
    scenario: { active_location_id: 4, active_place_text: 'ignored rooftop' },
    location: { name: 'Maya Apartment', description: 'cramped studio, string lights', full_desc: 'top floor walkup', background_image_path: 'bg/maya.png' },
  });
  assert.equal(place.source, 'card');
  assert.equal(place.name, 'Maya Apartment');
  assert.equal(place.description, 'cramped studio, string lights');
  assert.equal(place.full_desc, 'top floor walkup');
  assert.equal(place.background_image_path, 'bg/maya.png');
});

test('falls back to short_desc when a card has no description', () => {
  const place = resolveScenarioPlace({
    scenario: { active_location_id: 4 },
    location: { name: 'Pier', description: '', short_desc: 'weathered boardwalk' },
  });
  assert.equal(place.description, 'weathered boardwalk');
});

test('uses trimmed free-text place when no location card is active', () => {
  const place = resolveScenarioPlace({
    scenario: { active_location_id: null, active_place_text: '  abandoned lighthouse  ' },
    location: null,
  });
  assert.equal(place.source, 'text');
  assert.equal(place.name, 'abandoned lighthouse');
  assert.equal(place.description, 'abandoned lighthouse');
  assert.equal(place.full_desc, '');
  assert.equal(place.background_image_path, null);
});

test('returns null when neither a card nor non-empty text is set', () => {
  assert.equal(resolveScenarioPlace({ scenario: { active_place_text: '   ' }, location: null }), null);
  assert.equal(resolveScenarioPlace({ scenario: {}, location: null }), null);
});
