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

function _characterBlock(characters) {
  if (!characters || !characters.length) return '';
  return characters.map(c => {
    const parts = [];
    if (c.gender)     parts.push(c.gender);
    if (c.body_type)  parts.push(c.body_type + ' build');
    const hair = [c.hair_color, c.hair_style].filter(Boolean);
    if (hair.length)  parts.push(hair.join(' ') + ' hair');
    if (c.eye_color)  parts.push(c.eye_color + ' eyes');
    if (c.skin_tone)  parts.push(c.skin_tone + ' skin');
    const gL = (c.gender || '').toLowerCase();
    if (c.breast_size && (gL === 'female' || gL === 'non-binary')) parts.push(c.breast_size + ' breasts');
    if (c.butt_size)  parts.push(c.butt_size + ' butt');
    if (parts.length) return parts.join(', ');
    return c.appearance_prompt || c.name;
  }).filter(Boolean).join(', ');
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
  const scene_image_prompt = sceneCard?.image_prompt ?? '';
  const location_tags = (isImg2img || !scene_image_prompt)
    ? (location?.image_tags || '')
    : '';
  const parts = {
    mode:               isImg2img ? 'img2img' : 'txt2img',
    prefix:             config.prompt_prefix     ?? '',
    scene_image_prompt,
    location_tags,
    atmosphere_tags:    _moodTags(sceneCard?.mood),
    character_block:    _characterBlock(characters),
    clothing_block:     _clothingBlock(characters),
    suffix:             config.prompt_suffix ?? '',
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
    parts.suffix,
    parts.lora_tags,
  );

  return { prompt, negative: parts.negative, parts };
}

export function buildCharacterPrompt({ character, actionContext = '', config }) {
  if (!character) return { prompt: '', negative: '', parts: {} };
  const appearance = [];
  if (character.gender)    appearance.push(character.gender);
  if (character.body_type) appearance.push(character.body_type + ' build');
  const hair = [character.hair_color, character.hair_style].filter(Boolean);
  if (hair.length)         appearance.push(hair.join(' ') + ' hair');
  if (character.eye_color) appearance.push(character.eye_color + ' eyes');
  if (character.skin_tone) appearance.push(character.skin_tone + ' skin');
  const gL = (character.gender || '').toLowerCase();
  if (character.breast_size && (gL === 'female' || gL === 'non-binary'))
    appearance.push(character.breast_size + ' breasts');
  if (character.butt_size) appearance.push(character.butt_size + ' butt');
  if (!appearance.length && character.appearance_prompt)
    appearance.push(character.appearance_prompt);
  const clothing = character.current_clothing || character.base_clothing || '';
  const action   = actionContext || 'standing, natural pose, candid';
  const prompt = _join(
    config.prompt_prefix ?? '',
    appearance.join(', '),
    clothing,
    action,
    'solo, single person, not looking at camera',
    config.prompt_suffix ?? '',
    _loraTags(config),
  );
  const negative = _join(
    config.master_negative ?? '',
    config.negative_additions ?? '',
    'multiple people, group, looking at viewer, facing camera, eye contact',
  );
  return { prompt, negative, parts: { appearance, clothing, action } };
}
