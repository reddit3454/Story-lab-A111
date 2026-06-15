const NUMERIC_KEYS = new Set([
  'a1111_steps', 'a1111_cfg', 'a1111_width', 'a1111_height', 'a1111_clip_skip',
  'hr_steps', 'hr_scale', 'hr_denoising', 'ad_strength',
]);

const BOOLEAN_KEYS = new Set(['hr_enabled', 'ad_enabled', 'lora_enabled', 'nsfw_enabled', 'explicit_mode']);

// Profile cannot override these master constraints
const STRUCTURAL_KEYS = new Set([
  'a1111_url', 'a1111_model', 'hr_enabled', 'ad_enabled', 'lora_enabled', 'nsfw_enabled',
]);

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

export function resolveActiveProfile(db) {
  return db.prepare('SELECT * FROM image_profiles WHERE is_active = 1 LIMIT 1').get() || null;
}

export function resolveEffectiveConfig(db) {
  const master  = resolveMasterConfig(db);
  const profile = resolveActiveProfile(db);

  if (!profile) {
    return { ...master, active_profile_id: null };
  }

  const merged = { ...master, active_profile_id: profile.id };

  if (profile.prompt_prefix)      merged.prompt_prefix      = profile.prompt_prefix;
  if (profile.prompt_suffix)      merged.prompt_suffix      = profile.prompt_suffix;
  if (profile.negative_additions) merged.negative_additions = profile.negative_additions;
  if (profile.lora1_file)         merged.lora1_file         = profile.lora1_file;
  if (profile.lora2_file)         merged.lora2_file         = profile.lora2_file;
  merged.lora1_strength = profile.lora1_strength ?? master.lora1_strength ?? 1.0;
  merged.lora2_strength = profile.lora2_strength ?? master.lora2_strength ?? 1.0;
  if (profile.steps_override != null) merged.a1111_steps = profile.steps_override;
  if (profile.cfg_override   != null) merged.a1111_cfg   = profile.cfg_override;

  return merged;
}
