// CF-8: Images page must stay a quarantine stub - no dead gallery/slot code that
// calls nonexistent API surfaces (getGallerySlotConfig, etc.).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../views/images.js', import.meta.url), 'utf8');

test('images.js is a quarantine stub that tells the user gallery is unavailable', () => {
  assert.match(source, /Character gallery is not available in this build/);
  assert.match(source, /export function initImages/);
});

test('images.js no longer contains dead gallery/slot API surface (CF-8)', () => {
  assert.ok(!/getGallerySlotConfig/.test(source), 'dead getGallerySlotConfig must not return');
  assert.ok(!/saveGallerySlotConfig/.test(source), 'dead saveGallerySlotConfig must not return');
  assert.ok(!/getCharacterGallery/.test(source), 'dead getCharacterGallery must not return');
  assert.ok(!/getFaceIdConfig/.test(source), 'dead getFaceIdConfig must not return');
  assert.ok(!/gallery_slot_config/.test(source), 'ComfyUI-era slot config must not return');
  assert.ok(!/\/gallery-images\//.test(source), 'unimplemented gallery image URLs must not return');
});

test('images.js has no unreachable code after an early return (CF-8)', () => {
  // Quarantine stub should not use the old pattern of return + hundreds of dead lines
  const lines = source.split(/\r?\n/).length;
  assert.ok(lines < 80, `images.js should stay a small stub, got ${lines} lines`);
});