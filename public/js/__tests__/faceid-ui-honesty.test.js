// Regression guard for CF-A4: this app is single-reference FaceID only. The old
// "FaceID Slot Config" UI (slot count + drag-reorder) was leftover ComfyUI-era copy
// that literally referenced a ComfyUI custom node ("IPAAdapterFaceIDBatch") and never
// had any effect on generation (faceid_ref_count/faceid_ref_order were saved but never
// read anywhere in image-pipeline.js). It has been removed rather than wired up, since
// implementing real multi-reference ControlNet support would require resolving which
// field is authoritative (reference_image_path vs faceid_ref_order) — a bigger, riskier
// change than "straightforward." This test fails loudly if that UI is reintroduced
// without also implementing real backend support for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../views/characters.js', import.meta.url), 'utf8');

test('characters.js no longer contains the dead FaceID Slot Config UI', () => {
  assert.ok(!/faceid-slot-count/.test(source), 'slot-count dropdown must not be reintroduced without real backend support');
  assert.ok(!/faceid-slot-order/.test(source), 'drag-reorder slot list must not be reintroduced without real backend support');
  assert.ok(!/_refreshFaceIdSlotOrder/.test(source), 'dead global hook must not be reintroduced');
});

test('characters.js no longer references the ComfyUI-era IPAAdapterFaceIDBatch node', () => {
  assert.ok(!/IPAAdapterFaceIDBatch/i.test(source), 'ComfyUI-specific node name must not appear in an A1111-only codebase');
  assert.ok(!/sent to ComfyUI/i.test(source), 'must not claim data is sent to ComfyUI — this project does not use ComfyUI for generation');
});

test('characters.js no longer calls the removed FaceID slot config API method from the UI', () => {
  assert.ok(!/API\.saveFaceIdConfig/.test(source),
    'the UI must not call saveFaceIdConfig — that route is deprecated/orphaned server-side (see routes/characters.js)');
});

test('characters.js uses "IP-Adapter" wording, not the unrelated "InstantID" technique, for FaceID copy', () => {
  assert.ok(!/InstantID/i.test(source),
    'InstantID is a different face-consistency technique from IP-Adapter and was never actually implemented here — do not reintroduce the name');
});
