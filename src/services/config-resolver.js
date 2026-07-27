const NUMERIC_KEYS = new Set([
  'narrator_context_tokens', 'narrator_max_tokens',
  'sfw_arousal_ceiling',
]);

const BOOLEAN_KEYS = new Set(['nsfw_enabled', 'explicit_mode', 'summary_learning_enabled', 'arousal_decay_enabled', 'emotion_tracking_enabled', 'relationship_deltas_enabled', 'mood_gate_toasts_enabled', 'regen_state_snapshot_enabled', 'cast_trigger_chips_enabled', 'scene_heat_readout_enabled']);

export function resolveMasterConfig(db) {
  const rows = db.prepare('SELECT key, value FROM global_config').all();
  const config = {};
  for (const { key, value } of rows) {
    if (NUMERIC_KEYS.has(key)) {
      config[key] = parseFloat(value) || 0;
    } else if (BOOLEAN_KEYS.has(key)) {
      config[key] = value === 'true';
    } else {
      config[key] = value ?? '';
    }
  }
  return config;
}

// The single active Look, or null if none is active (image generation should
// still proceed with hardcoded fallback settings in that case — a Look is a
// style overlay, not a hard requirement).
export function resolveActiveLook(db) {
  return db.prepare('SELECT * FROM image_looks WHERE is_active = 1 LIMIT 1').get() || null;
}

// Used only when there is no active Look at all. Every real Look carries its
// own concrete value for each of these (see image-looks-migration.js).
const NO_LOOK_FALLBACK = {
  checkpoint: '',
  vae: '',
  clip_skip: null,
  restore_faces: false,
  tiling: false,
  sampler: 'DPM++ 2M SDE',
  scheduler: 'Karras',
  steps: 30,
  cfg: 7,
  width: 832,
  height: 1216,
};

/**
 * Resolves the complete, concrete generation config. Full ownership: the
 * active Look supplies every generation-affecting field directly — there is
 * no more "blank on the Look falls back to a master default" indirection.
 * a1111_url and master_negative always come from global_config only; a Look
 * may never override either (safety/anatomy negatives, connection URL).
 */
export function resolveEffectiveConfig(db) {
  const master = resolveMasterConfig(db);
  const look = resolveActiveLook(db);
  const src = look || NO_LOOK_FALLBACK;

  return {
    a1111_url: master.a1111_url || 'http://127.0.0.1:7860',
    checkpoint: src.checkpoint || '',
    vae: src.vae || '',
    clip_skip: src.clip_skip ?? null,
    restore_faces: !!src.restore_faces,
    tiling: !!src.tiling,
    sampler: src.sampler || NO_LOOK_FALLBACK.sampler,
    scheduler: src.scheduler || NO_LOOK_FALLBACK.scheduler,
    steps: Math.round(src.steps || NO_LOOK_FALLBACK.steps),
    cfg: Number(src.cfg || NO_LOOK_FALLBACK.cfg),
    width: Math.round(src.width || NO_LOOK_FALLBACK.width),
    height: Math.round(src.height || NO_LOOK_FALLBACK.height),
    master_negative: master.master_negative || '',
    look,
  };
}
