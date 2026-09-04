import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addLoraRow, removeLoraRow, buildLookPayload } from '../look-editor-form.js';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const settings = fs.readFileSync(path.join(root, 'public', 'js', 'views', 'settings.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'public', 'js', 'api.js'), 'utf8');

test('addLoraRow appends a blank row without mutating the input array', () => {
  const before = [{ file: 'a', strength: 1 }];
  const after = addLoraRow(before);
  assert.equal(before.length, 1, 'input array must not be mutated');
  assert.equal(after.length, 2);
  assert.deepEqual(after[1], { file: '', strength: 1.0 });
});

test('removeLoraRow removes exactly the row at the given index', () => {
  const before = [{ file: 'a', strength: 1 }, { file: 'b', strength: 0.5 }, { file: 'c', strength: 0.8 }];
  const after = removeLoraRow(before, 1);
  assert.deepEqual(after, [{ file: 'a', strength: 1 }, { file: 'c', strength: 0.8 }]);
});

test('buildLookPayload trims name, filters blank LoRA rows, and coerces numeric fields', () => {
  const payload = buildLookPayload({
    name: '  My Look  ', description: 'desc', checkpoint: 'model.safetensors',
    vae: '', clip_skip: '', restore_faces: true, tiling: false,
    loras: [{ file: 'realLora', strength: '0.7' }, { file: '', strength: 1 }],
    prompt_prefix: 'p', prompt_suffix: 's', negative: 'n',
    sampler: 'Euler a', scheduler: 'Karras', steps: '25', cfg: '6.5', width: '768', height: '1024',
  });
  assert.equal(payload.name, 'My Look');
  assert.equal(payload.clip_skip, null);
  assert.equal(payload.restore_faces, true);
  assert.deepEqual(payload.loras, [{ file: 'realLora', strength: 0.7 }]);
  assert.equal(payload.steps, 25);
  assert.equal(payload.cfg, 6.5);
  assert.equal(payload.width, 768);
  assert.equal(payload.height, 1024);
});

test('buildLookPayload returns ok:false when name is blank', () => {
  const payload = buildLookPayload({ name: '   ' });
  assert.equal(payload.ok, false);
});

test('Look editor saves, tests, activates, and discards through draft endpoints', () => {
  assert.match(api, /createLookDraft/);
  assert.match(api, /saveLookDraft/);
  assert.match(api, /testGenerateLookDraft/);
  assert.match(api, /activateLookDraft/);
  assert.match(api, /discardLookDraft/);
  assert.match(settings, /Save Draft/);
  assert.match(settings, /Activate Draft/);
  assert.match(settings, /Discard Draft/);
});
