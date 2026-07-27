/**
 * Default active Look seeding and idempotent migration.
 * Looks are the sole style source — this module never touches content prompts.
 */

export const DEFAULT_LOOK_NAME = 'Stylized 3D Cinematic';

/** Verified present in local A1111 /sdapi/v1/sd-models (2026-07-20). */
export const DEFAULT_LOOK_CHECKPOINT = 'realcartoonXL_v7.safetensors';

export const DEFAULT_LOOK = {
  name: DEFAULT_LOOK_NAME,
  description:
    'Premium stylized 3D character render — hyper-realistic cartoon / animated-film aesthetic. Default for new generations.',
  checkpoint: DEFAULT_LOOK_CHECKPOINT,
  vae: '',
  clip_skip: null,
  restore_faces: 0,
  tiling: 0,
  loras_json: '[]',
  prompt_prefix:
    'high-end stylized 3D character render, hyper-realistic cartoon aesthetic, polished animated-film character design, expressive detailed eyes, smooth realistic skin shading, detailed hair, clean materials, cinematic soft lighting, high quality 3D render',
  prompt_suffix: 'soft cinematic depth of field, polished character render quality',
  negative:
    'photorealistic photograph, realistic photo, live action, flat anime, cel shading, painterly, sketch, watercolor, low poly, crude 3D, plastic skin, grainy, blurry, low detail',
  sampler: 'DPM++ 2M SDE',
  scheduler: 'Karras',
  steps: 30,
  cfg: 7,
  width: 832,
  height: 1216,
};

/** Original system-seeded Looks (pre-2026-07-20) — used to detect untouched legacy rows. */
export const LEGACY_SEED_FINGERPRINTS = {
  Photoreal: {
    description: 'Clean photographic look - default general-purpose Look.',
    checkpoint: '',
    prompt_prefix: 'photo, realistic, detailed skin texture, natural lighting, sharp focus',
    prompt_suffix: '8k uhd, high detail',
    negative: 'cartoon, anime, illustration, painting, drawing, 3d render, cgi',
  },
  Cinematic: {
    description: 'Moody cinematic color grade with dramatic lighting.',
    checkpoint: '',
    prompt_prefix: 'cinematic still, dramatic lighting, film grain, moody atmosphere',
    prompt_suffix: 'anamorphic lens, color graded, high production value',
    negative: 'flat lighting, overexposed, washed out, cartoon, anime',
  },
};

function _rowsMatchFingerprint(row, fp) {
  if (!row || !fp) return false;
  return (
    (row.description || '') === fp.description &&
    (row.checkpoint || '') === fp.checkpoint &&
    (row.prompt_prefix || '') === fp.prompt_prefix &&
    (row.prompt_suffix || '') === fp.prompt_suffix &&
    (row.negative || '') === fp.negative &&
    !(row.lora1_file || '') &&
    !(row.lora2_file || '') &&
    row.steps_override == null &&
    row.cfg_override == null &&
    !(row.sampler_override || '')
  );
}

export function isUntouchedLegacySeedLook(row) {
  if (!row?.name) return false;
  const fp = LEGACY_SEED_FINGERPRINTS[row.name];
  if (!fp) return false;
  return _rowsMatchFingerprint(row, fp);
}

// Stricter than the legacy check above — also verifies every new-style field
// still matches what DEFAULT_LOOK ships, so a user editing e.g. only the
// scheduler on the default Look is correctly detected as "customized."
function _defaultLookRowMatchesShipped(row) {
  if (!row) return false;
  return (
    _rowsMatchFingerprint(row, DEFAULT_LOOK) &&
    (row.vae || '') === DEFAULT_LOOK.vae &&
    (row.clip_skip ?? null) === DEFAULT_LOOK.clip_skip &&
    Number(row.restore_faces || 0) === DEFAULT_LOOK.restore_faces &&
    Number(row.tiling || 0) === DEFAULT_LOOK.tiling &&
    (row.loras_json || '[]') === DEFAULT_LOOK.loras_json &&
    (row.sampler || '') === DEFAULT_LOOK.sampler &&
    (row.scheduler || '') === DEFAULT_LOOK.scheduler &&
    Number(row.steps) === DEFAULT_LOOK.steps &&
    Number(row.cfg) === DEFAULT_LOOK.cfg &&
    Number(row.width) === DEFAULT_LOOK.width &&
    Number(row.height) === DEFAULT_LOOK.height
  );
}

export function isUntouchedDefaultLook(row) {
  if (!row || row.name !== DEFAULT_LOOK_NAME) return false;
  return _defaultLookRowMatchesShipped(row);
}

export function isUserCustomizedLook(row) {
  if (!row?.name) return false;
  if (row.name === DEFAULT_LOOK_NAME) return !isUntouchedDefaultLook(row);
  if (LEGACY_SEED_FINGERPRINTS[row.name]) return !isUntouchedLegacySeedLook(row);
  return true;
}

function _getLookByName(db, name) {
  return db.prepare('SELECT * FROM image_looks WHERE name = ?').get(name);
}

function _activateLookById(db, id) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE image_looks SET is_active = 0').run();
    db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function _insertDefaultLookIfMissing(db) {
  db.prepare(`
    INSERT OR IGNORE INTO image_looks (
      name, description, checkpoint, vae, clip_skip, restore_faces, tiling, loras_json,
      prompt_prefix, prompt_suffix, negative,
      sampler, scheduler, steps, cfg, width, height,
      is_active
    ) VALUES (
      @name, @description, @checkpoint, @vae, @clip_skip, @restore_faces, @tiling, @loras_json,
      @prompt_prefix, @prompt_suffix, @negative,
      @sampler, @scheduler, @steps, @cfg, @width, @height,
      0
    )
  `).run(DEFAULT_LOOK);
}

// Only fires when the existing row is verified (in JS, via the same
// fingerprint check isUntouchedDefaultLook uses) to still exactly match
// what DEFAULT_LOOK ships — a single source of truth for "untouched",
// instead of duplicating that comparison a second time inside a SQL WHERE.
function _refreshUntouchedDefaultLook(db) {
  const existing = _getLookByName(db, DEFAULT_LOOK_NAME);
  if (!existing || !isUntouchedDefaultLook(existing)) return;

  db.prepare(`
    UPDATE image_looks SET
      description   = @description,
      checkpoint    = @checkpoint,
      vae           = @vae,
      clip_skip     = @clip_skip,
      restore_faces = @restore_faces,
      tiling        = @tiling,
      loras_json    = @loras_json,
      prompt_prefix = @prompt_prefix,
      prompt_suffix = @prompt_suffix,
      negative      = @negative,
      sampler       = @sampler,
      scheduler     = @scheduler,
      steps         = @steps,
      cfg           = @cfg,
      width         = @width,
      height        = @height
    WHERE name = @name
  `).run(DEFAULT_LOOK);
}

export function seedAndMigrateDefaultLooks(db) {
  _insertDefaultLookIfMissing(db);
  _refreshUntouchedDefaultLook(db);

  const defaultRow = _getLookByName(db, DEFAULT_LOOK_NAME);
  if (!defaultRow) return;

  const activeRow = db.prepare('SELECT * FROM image_looks WHERE is_active = 1 LIMIT 1').get();

  if (!activeRow) {
    _activateLookById(db, defaultRow.id);
    return;
  }

  if (activeRow.name === DEFAULT_LOOK_NAME) {
    return;
  }

  if (isUntouchedLegacySeedLook(activeRow)) {
    _activateLookById(db, defaultRow.id);
    return;
  }

  if (isUserCustomizedLook(activeRow)) {
    return;
  }
}
