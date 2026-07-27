// Pure, DOM-free Look-editor form logic. Kept separate from views/settings.js
// so it's unit-testable with node:test even though it's served to the browser.

export function addLoraRow(loras) {
  return [...(loras || []), { file: '', strength: 1.0 }];
}

export function removeLoraRow(loras, index) {
  return (loras || []).filter((_, i) => i !== index);
}

function _numOrDefault(v, def) {
  if (v === '' || v == null) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function _intOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds the request body for POST/PUT /api/looks (and the equivalent draft
 * shape for POST /api/looks/test-generate, which accepts the same field
 * names) from a plain object of raw form values. Returns { ok: false } if
 * required fields are missing — never throws.
 */
export function buildLookPayload(fields) {
  const name = String(fields.name || '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  return {
    ok: true,
    name,
    description: fields.description || '',
    checkpoint: fields.checkpoint || '',
    vae: fields.vae || '',
    clip_skip: _intOrNull(fields.clip_skip),
    restore_faces: !!fields.restore_faces,
    tiling: !!fields.tiling,
    loras: (fields.loras || [])
      .filter((l) => l && l.file)
      .map((l) => ({ file: l.file, strength: _numOrDefault(l.strength, 1.0) })),
    prompt_prefix: fields.prompt_prefix || '',
    prompt_suffix: fields.prompt_suffix || '',
    negative: fields.negative || '',
    sampler: fields.sampler || 'DPM++ 2M SDE',
    scheduler: fields.scheduler || 'Karras',
    steps: _numOrDefault(fields.steps, 30),
    cfg: _numOrDefault(fields.cfg, 7),
    width: _numOrDefault(fields.width, 832),
    height: _numOrDefault(fields.height, 1216),
  };
}
