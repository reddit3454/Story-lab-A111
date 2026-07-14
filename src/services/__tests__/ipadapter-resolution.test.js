import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveIpAdapterModule,
  ipAdapterTuningForMode,
  validateIpAdapterAgainstCatalog,
} from '../ipadapter-resolution.js';

// resolveIpAdapterModule: explicit config override always wins
test('resolveIpAdapterModule uses the configured module when set, ignoring checkpoint family', () => {
  const result = resolveIpAdapterModule({ configModule: 'ip-adapter_face_id_plus', checkpointModel: 'sd_xl_base_1.0.safetensors' });
  assert.equal(result, 'ip-adapter_face_id_plus');
});

test('resolveIpAdapterModule trims whitespace from the configured override', () => {
  const result = resolveIpAdapterModule({ configModule: '  ip-adapter_clip_sd15  ', checkpointModel: '' });
  assert.equal(result, 'ip-adapter_clip_sd15');
});

test('resolveIpAdapterModule falls back to the SDXL CLIP module when checkpoint name implies SDXL', () => {
  const result = resolveIpAdapterModule({ configModule: '', checkpointModel: 'juggernautXL_v9.safetensors' });
  assert.equal(result, 'ip-adapter_clip_sdxl');
});

test('resolveIpAdapterModule falls back to the SD1.5 CLIP module when checkpoint name does not imply SDXL', () => {
  const result = resolveIpAdapterModule({ configModule: '', checkpointModel: 'realisticVision_v6.safetensors' });
  assert.equal(result, 'ip-adapter_clip_sd15');
});

test('resolveIpAdapterModule falls back to SD1.5 when checkpoint model is empty/unset', () => {
  const result = resolveIpAdapterModule({ configModule: '', checkpointModel: '' });
  assert.equal(result, 'ip-adapter_clip_sd15');
});

test('resolveIpAdapterModule never returns the old "ip-adapter-auto" value', () => {
  const explicit = resolveIpAdapterModule({ configModule: '', checkpointModel: 'anythingXL.safetensors' });
  const fallback = resolveIpAdapterModule({ configModule: '', checkpointModel: '' });
  assert.notEqual(explicit, 'ip-adapter-auto');
  assert.notEqual(fallback, 'ip-adapter-auto');
});

// ipAdapterTuningForMode: character mode keeps configured strength; scene mode backs off
test('ipAdapterTuningForMode keeps the configured weight/guidance_end for character mode', () => {
  const tuning = ipAdapterTuningForMode('character', { weight: 0.5, guidanceEnd: 0.7 });
  assert.equal(tuning.weight, 0.5);
  assert.equal(tuning.guidance_start, 0.0);
  assert.equal(tuning.guidance_end, 0.7);
});

test('ipAdapterTuningForMode reduces weight and tightens guidance_end for scene mode', () => {
  const tuning = ipAdapterTuningForMode('scene', { weight: 0.5, guidanceEnd: 0.7 });
  assert.ok(tuning.weight < 0.5, `expected reduced weight for scene mode, got ${tuning.weight}`);
  assert.ok(tuning.guidance_end <= 0.5, `expected tightened guidance_end for scene mode, got ${tuning.guidance_end}`);
});

test('ipAdapterTuningForMode never widens guidance_end beyond the configured value for scene mode', () => {
  const tuning = ipAdapterTuningForMode('scene', { weight: 0.5, guidanceEnd: 0.3 });
  assert.ok(tuning.guidance_end <= 0.3, `must not widen a tighter-than-cap configured value, got ${tuning.guidance_end}`);
});

test('ipAdapterTuningForMode applies sane defaults when weight/guidanceEnd are not finite numbers', () => {
  const tuning = ipAdapterTuningForMode('character', { weight: NaN, guidanceEnd: undefined });
  assert.equal(tuning.weight, 0.35);
  assert.equal(tuning.guidance_end, 0.6);
});

test('ipAdapterTuningForMode treats any non-character mode the same as scene (background never reaches here, but be defensive)', () => {
  const tuning = ipAdapterTuningForMode('something-else', { weight: 0.5, guidanceEnd: 0.7 });
  assert.ok(tuning.weight < 0.5);
});

// validateIpAdapterAgainstCatalog: preflight gate
test('validateIpAdapterAgainstCatalog fails when the catalog itself is unavailable', () => {
  const result = validateIpAdapterAgainstCatalog({ model: 'm [hash]', module: 'ip-adapter_clip_sdxl' }, { available: false, models: [], modules: [] });
  assert.equal(result.ok, false);
});

test('validateIpAdapterAgainstCatalog fails when no model is configured', () => {
  const catalog = { available: true, models: ['m [hash]'], modules: ['ip-adapter_clip_sdxl'] };
  const result = validateIpAdapterAgainstCatalog({ model: '', module: 'ip-adapter_clip_sdxl' }, catalog);
  assert.equal(result.ok, false);
  assert.match(result.reason, /model/i);
});

test('validateIpAdapterAgainstCatalog fails when the configured model is not in the catalog', () => {
  const catalog = { available: true, models: ['other [hash]'], modules: ['ip-adapter_clip_sdxl'] };
  const result = validateIpAdapterAgainstCatalog({ model: 'missing [hash]', module: 'ip-adapter_clip_sdxl' }, catalog);
  assert.equal(result.ok, false);
  assert.match(result.reason, /model/i);
});

test('validateIpAdapterAgainstCatalog fails when the resolved module is not in the catalog', () => {
  const catalog = { available: true, models: ['m [hash]'], modules: ['some_other_module'] };
  const result = validateIpAdapterAgainstCatalog({ model: 'm [hash]', module: 'ip-adapter_clip_sdxl' }, catalog);
  assert.equal(result.ok, false);
  assert.match(result.reason, /module/i);
});

test('validateIpAdapterAgainstCatalog succeeds when both model and module are present', () => {
  const catalog = { available: true, models: ['m [hash]'], modules: ['ip-adapter_clip_sdxl'] };
  const result = validateIpAdapterAgainstCatalog({ model: 'm [hash]', module: 'ip-adapter_clip_sdxl' }, catalog);
  assert.equal(result.ok, true);
});
