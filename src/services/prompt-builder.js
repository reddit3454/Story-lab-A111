const MOOD_TABLE = {
  contemplative: 'soft lighting, muted tones, quiet atmosphere',
  tense:         'dramatic lighting, high contrast, sharp shadows',
  romantic:      'warm golden light, soft bokeh, intimate framing',
  action:        'dynamic lighting, motion blur, energetic composition',
  melancholy:    'cool desaturated tones, overcast, diffuse light',
  joyful:        'bright warm light, vivid colors, open composition',
  mysterious:    'low key lighting, deep shadows, fog',
  neutral:       'natural lighting, balanced exposure',
  // common aliases
  happy:         'bright warm light, vivid colors, open composition',
  sad:           'cool desaturated tones, overcast, diffuse light',
  fearful:       'low key lighting, deep shadows, cold blue tones',
  angry:         'harsh lighting, deep red tones, high contrast',
};

function _moodTags(mood) {
  return MOOD_TABLE[mood?.toLowerCase?.()] ?? MOOD_TABLE.neutral;
}

function _clampArousal(level) {
  const n = parseInt(level, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : 1;
}

function _nsfwTags(arousal, config) {
  if (!config.nsfw_enabled) return '';
  if (arousal <= 3) return '';
  if (arousal <= 5) return 'suggestive, partially clothed, intimate';
  if (arousal <= 7) return 'explicit, nsfw';
  return 'explicit, nsfw, adult content';
}

function _characterBlock(characters) {
  if (!characters || !characters.length) return '';
  return characters
    .map(c => c.appearance_prompt || c.name)
    .filter(Boolean)
    .join(', ');
}

function _clothingBlock(characters) {
  if (!characters || !characters.length) return '';
  return characters
    .map(c => c.current_clothing || c.base_clothing || '')
    .filter(Boolean)
    .join(', ');
}

function _loraTags(config) {
  if (!config.lora_enabled) return '';
  const parts = [];
  if (config.lora1_file) parts.push(`<lora:${config.lora1_file}:${config.lora1_strength ?? 1.0}>`);
  if (config.lora2_file) parts.push(`<lora:${config.lora2_file}:${config.lora2_strength ?? 1.0}>`);
  return parts.join(' ');
}

function _join(...parts) {
  return parts.filter(s => s && s.trim()).join(', ');
}

export function buildPrompt({ sceneCard, characters, location, scenario, config, isImg2img = false }) {
  const arousal = _clampArousal(sceneCard?.arousal_level ?? 1);

  const parts = {
    mode:               isImg2img ? 'img2img' : 'txt2img',
    prefix:             config.prompt_prefix     ?? '',
    scene_image_prompt: sceneCard?.image_prompt  ?? '',
    location_tags:      (!isImg2img && location?.image_tags) ? location.image_tags : '',
    atmosphere_tags:    _moodTags(sceneCard?.mood),
    character_block:    _characterBlock(characters),
    clothing_block:     _clothingBlock(characters),
    suffix:             config.prompt_suffix ?? '',
    nsfw_tier:          arousal,
    nsfw_tags:          _nsfwTags(arousal, config),
    lora_tags:          _loraTags(config),
    negative:           _join(
      config.master_negative                  ?? '',
      config.negative_additions               ?? '',
      sceneCard?.negative_prompt_additions    ?? '',
    ),
  };

  const prompt = _join(
    parts.prefix,
    parts.scene_image_prompt,
    parts.location_tags,
    parts.atmosphere_tags,
    parts.character_block,
    parts.clothing_block,
    parts.nsfw_tags,
    parts.suffix,
    parts.lora_tags,
  );

  return { prompt, negative: parts.negative, parts };
}
