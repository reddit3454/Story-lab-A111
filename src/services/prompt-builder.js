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

// Arousal tier tag injection - ALL gated behind config.nsfw_enabled
const AROUSAL_TAGS = {
  '1-3': [],
  '4-5': ['partially clothed', 'suggestive pose', 'intimate scene'],
  '6-7': ['revealing clothing', 'explicit scene', 'nude', 'topless'],
  '8-10': ['fully nude', 'explicit sexual content', 'hardcore'],
};

/** Source strength — higher wins when capping / resolving contradictions. */
export const SOURCE_SCORE = {
  scene: 100,      // scene_card.image_prompt / explicit scene fields
  character: 80,   // selected / cast member appearance
  clothing: 75,    // resolved scenario clothing
  location: 50,    // location.image_tags / name
  mood: 40,        // mood table mapping
  arousal: 30,     // gated arousal tier tags
  profile: 20,     // master_positive / prompt_prefix / prompt_suffix
  framing: 70,     // portrait framing defaults (solo, full body, candid)
};

/**
 * Per-mode category caps. Scene keeps appearance light; character keeps setting light.
 * Hard core-tag budget (excluding LoRA) is applied after per-bucket caps.
 */
export const MODE_CAPS = {
  scene: {
    subject: 3,
    appearance: 2,
    clothing: 3,
    action: 2,
    setting: 4,
    camera: 2,
    mood: 2,
    quality: 4,
    coreMax: 24,
  },
  character: {
    subject: 2,
    appearance: 4,
    clothing: 3,
    action: 2,
    setting: 2,
    camera: 2,
    mood: 1,
    quality: 4,
    coreMax: 22,
  },
};

/** Emit order (stable, booru-style priority). */
export const BUCKET_ORDER = [
  'quality', 'subject', 'appearance', 'clothing', 'action', 'setting', 'mood', 'camera',
];

/**
 * Contradiction pairs — deterministic rule: keep the higher-scoring tag; if tied,
 * keep the first-seen. Matching is on normalized lowercase equality OR membership
 * in multi-word group lists (e.g. solo vs any multi-person subject count).
 */
export const CONTRADICTION_PAIRS = [
  ['indoors', 'outdoors'],
  ['indoor', 'outdoor'],
  ['smiling', 'crying'],
  ['standing', 'sitting'],
  ['standing', 'lying'],
  ['sitting', 'lying'],
  ['daytime', 'night'],
  ['day', 'night'],
  ['close-up', 'wide shot'],
  ['closeup', 'wide'],
  ['fully clothed', 'fully nude'],
  ['fully clothed', 'nude'],
  ['clothed', 'nude'],
];

const MULTI_PERSON = new Set([
  '2girls', '2boys', '3girls', '3boys', '1boy 1girl', '1girl 1boy',
  'multiple people', 'group', 'couple', '2people', 'two people',
]);
const SOLO_SUBJECT = new Set(['solo', '1girl', '1boy', '1woman', '1man']);

const QUALITY_HINTS = /\b(masterpiece|best quality|high quality|8k|4k|ultra detailed|highly detailed|detailed|sharp focus|absurdres|highres)\b/i;
const CAMERA_HINTS = /\b(close-?up|wide shot|medium shot|establishing|candid|full body|upper body|portrait|from above|from below|looking at viewer|eye level)\b/i;
const SETTING_HINTS = /\b(indoors?|outdoors?|bedroom|bathroom|kitchen|office|beach|park|street|city|forest|room|car|night|daytime|sunset|interior|exterior)\b/i;
const ACTION_HINTS = /\b(standing|sitting|lying|walking|running|kissing|holding|reaching|leaning|kneeling|posing|dancing|mid-action|bent over)\b/i;
const MOOD_HINTS = /\b(soft lighting|dramatic lighting|warm|cool|golden|shadows|bokeh|atmosphere|intimate|muted|overcast|fog)\b/i;
const SUBJECT_HINTS = /\b(solo|1girl|1boy|2girls|2boys|1boy 1girl|multiple people|group)\b/i;

function getArousalTags(level, config = {}) {
  const l = Math.max(1, Math.min(10, Number(level) || 1));
  const nsfw = config.nsfw_enabled === true;
  const explicit = config.explicit_mode === true;
  if (!nsfw) return AROUSAL_TAGS['1-3'];
  if (l <= 3) return AROUSAL_TAGS['1-3'];
  if (l <= 5) return AROUSAL_TAGS['4-5'];
  if (l <= 7) return AROUSAL_TAGS['6-7'];
  if (!explicit) return AROUSAL_TAGS['4-5'];
  return AROUSAL_TAGS['8-10'];
}

function _moodTags(mood) {
  return MOOD_TABLE[mood?.toLowerCase?.()] ?? MOOD_TABLE.neutral;
}

function _normalizeTag(raw) {
  return String(raw || '')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function _normKey(tag) {
  return _normalizeTag(tag).toLowerCase();
}

/** Split a freeform / comma dump into individual tag candidates. */
export function splitTags(text) {
  if (!text) return [];
  const s = String(text).trim();
  if (!s) return [];
  // Prefer comma splits; if no commas, keep as a single phrase (prose seed).
  if (s.includes(',')) {
    return s.split(',').map(_normalizeTag).filter(Boolean);
  }
  return [_normalizeTag(s)].filter(Boolean);
}

/**
 * Classify a raw token into a bucket. Deterministic heuristics; unknown short
 * tokens default to appearance, longer prose defaults to action.
 */
export function classifyTag(tag) {
  const t = _normalizeTag(tag);
  const low = t.toLowerCase();
  if (!t) return null;
  if (/^<lora:/i.test(t)) return 'lora';
  if (QUALITY_HINTS.test(low)) return 'quality';
  if (SUBJECT_HINTS.test(low)) return 'subject';
  if (CAMERA_HINTS.test(low)) return 'camera';
  if (SETTING_HINTS.test(low)) return 'setting';
  if (ACTION_HINTS.test(low)) return 'action';
  if (MOOD_HINTS.test(low)) return 'mood';
  // clothing keywords
  if (/\b(dress|shirt|jeans|bikini|skirt|bra|panties|coat|jacket|sweater|hoodie|uniform|lingerie|nude|topless|bottomless|wearing|outfit|clothes|clothing)\b/i.test(low)) {
    return 'clothing';
  }
  if (/\b(hair|eyes|skin|breasts|butt|build|tall|short|blonde|brunette|redhead)\b/i.test(low)) {
    return 'appearance';
  }
  // Long prose seed from narrator → action/setting mix; keep as action.
  if (t.split(/\s+/).length >= 6) return 'action';
  return 'appearance';
}

function _pushCandidate(buckets, { tag, bucket, score, source }) {
  const cleaned = _normalizeTag(tag);
  if (!cleaned) return;
  const b = bucket || classifyTag(cleaned);
  if (!b || b === 'lora') return;
  if (!buckets[b]) buckets[b] = [];
  buckets[b].push({ tag: cleaned, score, source, bucket: b });
}

function _addSplit(buckets, text, score, source, forceBucket = null) {
  for (const tok of splitTags(text)) {
    _pushCandidate(buckets, {
      tag: tok,
      bucket: forceBucket || classifyTag(tok),
      score,
      source,
    });
  }
}

function _charAppearanceTags(character) {
  if (!character) return [];
  const parts = [];
  if (character.gender) parts.push(character.gender);
  if (character.body_type) parts.push(character.body_type + ' build');
  const hair = [character.hair_color, character.hair_style].filter(Boolean);
  if (hair.length) parts.push(hair.join(' ') + ' hair');
  if (character.eye_color) parts.push(character.eye_color + ' eyes');
  if (character.skin_tone) parts.push(character.skin_tone + ' skin');
  const gL = (character.gender || '').toLowerCase();
  if (character.breast_size && (gL === 'female' || gL === 'non-binary')) {
    parts.push(character.breast_size + ' breasts');
  }
  if (character.butt_size) parts.push(character.butt_size + ' butt');
  if (!parts.length && character.appearance_prompt) parts.push(character.appearance_prompt);
  if (!parts.length && character.image_description) parts.push(character.image_description);
  if (!parts.length && character.appearance_notes) parts.push(character.appearance_notes);
  return parts.map(_normalizeTag).filter(Boolean);
}

function _emptyBuckets() {
  return {
    quality: [], subject: [], appearance: [], clothing: [],
    action: [], setting: [], mood: [], camera: [],
  };
}

/**
 * Dedupe by normalized key — keep highest score; on tie, keep first.
 * Returns { list, drops }.
 */
export function dedupeCandidates(list) {
  const best = new Map();
  const drops = [];
  for (const item of list) {
    const key = _normKey(item.tag);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, item);
      continue;
    }
    if (item.score > prev.score) {
      drops.push({ tag: prev.tag, reason: 'duplicate_lower_score', kept: item.tag });
      best.set(key, item);
    } else {
      drops.push({ tag: item.tag, reason: 'duplicate', kept: prev.tag });
    }
  }
  return { list: [...best.values()], drops };
}

function _pairConflict(a, b) {
  const ka = _normKey(a);
  const kb = _normKey(b);
  for (const [x, y] of CONTRADICTION_PAIRS) {
    if ((ka === x && kb === y) || (ka === y && kb === x)) return true;
  }
  // solo vs multi-person subject tags
  const aSolo = SOLO_SUBJECT.has(ka);
  const bSolo = SOLO_SUBJECT.has(kb);
  const aMulti = MULTI_PERSON.has(ka) || /\b\d+girls?\b|\b\d+boys?\b/.test(ka);
  const bMulti = MULTI_PERSON.has(kb) || /\b\d+girls?\b|\b\d+boys?\b/.test(kb);
  if ((aSolo && bMulti) || (bSolo && aMulti)) return true;
  return false;
}

/**
 * Remove contradiction pairs — keep higher score; tie → keep earlier (stable).
 */
export function filterContradictions(list) {
  const kept = [];
  const drops = [];
  const sorted = [...list].sort((a, b) => b.score - a.score || 0);
  for (const item of sorted) {
    const clash = kept.find((k) => _pairConflict(k.tag, item.tag));
    if (clash) {
      drops.push({ tag: item.tag, reason: 'contradiction', kept: clash.tag });
      continue;
    }
    kept.push(item);
  }
  return { list: kept, drops };
}

/**
 * Cap each bucket then enforce coreMax across ordered buckets.
 */
export function applyCaps(buckets, caps) {
  const drops = [];
  const selected = _emptyBuckets();
  for (const name of BUCKET_ORDER) {
    const items = [...(buckets[name] || [])].sort((a, b) => b.score - a.score);
    const limit = caps[name] ?? 0;
    selected[name] = items.slice(0, limit);
    for (const d of items.slice(limit)) {
      drops.push({ tag: d.tag, reason: 'bucket_cap', bucket: name });
    }
  }
  // Hard core budget across ordered buckets
  let used = 0;
  const coreMax = caps.coreMax ?? 24;
  for (const name of BUCKET_ORDER) {
    const kept = [];
    for (const item of selected[name]) {
      if (used >= coreMax) {
        drops.push({ tag: item.tag, reason: 'core_cap', bucket: name });
      } else {
        kept.push(item);
        used += 1;
      }
    }
    selected[name] = kept;
  }
  return { selected, drops };
}

export function flattenSelected(selected) {
  const out = [];
  for (const name of BUCKET_ORDER) {
    for (const item of selected[name] || []) out.push(item.tag);
  }
  return out;
}

/**
 * Core selector — pure, dependency-free.
 * @param {'scene'|'character'} mode
 * @param {object} buckets map of bucket -> candidate arrays
 */
export function selectPromptTags(mode, buckets) {
  const caps = MODE_CAPS[mode] || MODE_CAPS.scene;
  const flat = [];
  for (const name of BUCKET_ORDER) {
    for (const item of buckets[name] || []) flat.push({ ...item, bucket: name });
  }
  const d1 = dedupeCandidates(flat);
  const d2 = filterContradictions(d1.list);
  // re-bucket after filtering
  const rebuilt = _emptyBuckets();
  for (const item of d2.list) {
    const b = item.bucket || classifyTag(item.tag) || 'appearance';
    if (!rebuilt[b]) continue;
    rebuilt[b].push(item);
  }
  const capped = applyCaps(rebuilt, caps);
  const selectedTags = flattenSelected(capped.selected);
  const dropReasons = [...d1.drops, ...d2.drops, ...capped.drops];
  return {
    candidateTags: buckets,
    selected: capped.selected,
    selectedTags,
    dropReasons,
  };
}

function _join(...parts) {
  return parts.filter((s) => s && String(s).trim()).join(', ');
}

export function loraTagsFromConfig(config) {
  return _loraTags(config);
}

function _loraTags(config) {
  if (!config?.lora_enabled) return '';
  const parts = [];
  if (config.lora1_file) parts.push(`<lora:${config.lora1_file}:${config.lora1_strength ?? 1.0}>`);
  if (config.lora2_file) parts.push(`<lora:${config.lora2_file}:${config.lora2_strength ?? 1.0}>`);
  return parts.join(' ');
}

function _collectSceneCandidates({ sceneCard, characters, location, config, isImg2img, resolvedClothingMap }) {
  const buckets = _emptyBuckets();

  // Quality / profile (low)
  _addSplit(buckets, config?.master_positive, SOURCE_SCORE.profile, 'profile', 'quality');
  _addSplit(buckets, config?.prompt_prefix, SOURCE_SCORE.profile, 'profile', 'quality');
  _addSplit(buckets, config?.prompt_suffix, SOURCE_SCORE.profile, 'profile', 'quality');

  // Scene image prompt = action/setting seed (highest) — still bucketized (option A)
  _addSplit(buckets, sceneCard?.image_prompt, SOURCE_SCORE.scene, 'scene');

  // Location (medium) — skip when scene already supplied a strong prompt and not img2img
  const scenePrompt = (sceneCard?.image_prompt || '').trim();
  if (isImg2img || !scenePrompt) {
    _addSplit(buckets, location?.image_tags, SOURCE_SCORE.location, 'location', 'setting');
    if (location?.name) {
      _pushCandidate(buckets, {
        tag: location.name,
        bucket: 'setting',
        score: SOURCE_SCORE.location,
        source: 'location',
      });
    }
  }

  // Mood (medium-low)
  _addSplit(buckets, _moodTags(sceneCard?.mood), SOURCE_SCORE.mood, 'mood', 'mood');

  // Characters — scene mode: light appearance only (first non-player / main cast slice)
  const cast = (characters || []).filter(Boolean);
  const primary = cast.find((c) => c.role !== 'player') || cast[0] || null;
  if (primary) {
    const traits = _charAppearanceTags(primary).slice(0, 4); // candidates; caps trim further
    for (const t of traits) {
      _pushCandidate(buckets, {
        tag: t,
        bucket: 'appearance',
        score: SOURCE_SCORE.character,
        source: 'character',
      });
    }
    // Subject count from cast size (weak default; scene prompt can override via contradiction filter)
    if (cast.filter((c) => c.role !== 'player').length <= 1) {
      const g = (primary.gender || '').toLowerCase();
      const sub = g === 'male' || g === 'man' || g === 'boy' ? '1boy' : '1girl';
      _pushCandidate(buckets, { tag: 'solo', bucket: 'subject', score: SOURCE_SCORE.character - 5, source: 'character' });
      _pushCandidate(buckets, { tag: sub, bucket: 'subject', score: SOURCE_SCORE.character - 5, source: 'character' });
    }
  }

  // Clothing — only resolved / non-empty
  const clothingBits = [];
  for (const c of cast) {
    const cloth = (resolvedClothingMap && resolvedClothingMap[c.id]) || c.current_clothing || '';
    if (cloth && String(cloth).trim()) clothingBits.push(String(cloth).trim());
  }
  if (clothingBits.length) {
    _addSplit(buckets, clothingBits.join(', '), SOURCE_SCORE.clothing, 'clothing', 'clothing');
  }

  // Arousal (low, gated)
  if (cast.length) {
    for (const t of getArousalTags(sceneCard?.arousal_level ?? 1, config || {})) {
      _pushCandidate(buckets, {
        tag: t,
        bucket: classifyTag(t) === 'clothing' ? 'clothing' : 'action',
        score: SOURCE_SCORE.arousal,
        source: 'arousal',
      });
    }
  }

  return { buckets, clothingBlock: clothingBits.join(', ') };
}

function _collectCharacterCandidates({ character, actionContext, location, config }) {
  const buckets = _emptyBuckets();

  _addSplit(buckets, config?.master_positive, SOURCE_SCORE.profile, 'profile', 'quality');
  _addSplit(buckets, config?.prompt_prefix, SOURCE_SCORE.profile, 'profile', 'quality');
  _addSplit(buckets, config?.prompt_suffix, SOURCE_SCORE.profile, 'profile', 'quality');

  // Framing defaults (high for character mode)
  for (const t of ['solo', 'full body', 'candid shot']) {
    _pushCandidate(buckets, {
      tag: t,
      bucket: t === 'solo' ? 'subject' : 'camera',
      score: SOURCE_SCORE.framing,
      source: 'framing',
    });
  }
  const g = (character?.gender || '').toLowerCase();
  const sub = g === 'male' || g === 'man' || g === 'boy' ? '1boy' : '1girl';
  _pushCandidate(buckets, {
    tag: sub,
    bucket: 'subject',
    score: SOURCE_SCORE.framing,
    source: 'framing',
  });

  for (const t of _charAppearanceTags(character)) {
    _pushCandidate(buckets, {
      tag: t,
      bucket: 'appearance',
      score: SOURCE_SCORE.character,
      source: 'character',
    });
  }

  const clothing = character?.current_clothing || character?.base_clothing || '';
  if (clothing && String(clothing).trim()) {
    _addSplit(buckets, clothing, SOURCE_SCORE.clothing, 'clothing', 'clothing');
  }

  // Action / pose — treat actionContext as seed (bucketize)
  const action = actionContext || 'candid, mid-action, natural pose';
  _addSplit(buckets, action, SOURCE_SCORE.scene, 'action');

  // Setting light
  if (location?.image_tags) {
    _addSplit(buckets, location.image_tags, SOURCE_SCORE.location, 'location', 'setting');
  }

  return { buckets, clothingBlock: String(clothing || '').trim() };
}

export function buildPrompt({
  sceneCard, characters, location, scenario, config, isImg2img = false, resolvedClothingMap = {},
}) {
  const { buckets, clothingBlock } = _collectSceneCandidates({
    sceneCard, characters, location, config, isImg2img, resolvedClothingMap,
  });
  const selection = selectPromptTags('scene', buckets);
  const lora = _loraTags(config);
  const prompt = _join(...selection.selectedTags, lora);

  const parts = {
    mode: isImg2img ? 'img2img' : 'txt2img',
    prefix: _join(config?.master_positive ?? '', config?.prompt_prefix ?? ''),
    scene_image_prompt: sceneCard?.image_prompt ?? '',
    location_tags: (isImg2img || !(sceneCard?.image_prompt || '').trim())
      ? (location?.image_tags || '')
      : '',
    atmosphere_tags: _moodTags(sceneCard?.mood),
    character_block: (characters || []).map((c) => _charAppearanceTags(c).join(', ')).filter(Boolean).join(', '),
    clothing_block: clothingBlock, // authoritative for composeEnhancedScenePrompt
    arousal_tags: getArousalTags(sceneCard?.arousal_level ?? 1, config || {}).join(', '),
    suffix: config?.prompt_suffix ?? '',
    lora_tags: lora,
    negative: _join(
      config?.master_negative ?? '',
      config?.negative_additions ?? '',
      sceneCard?.negative_prompt_additions ?? '',
    ),
    candidateTags: selection.candidateTags,
    selectedTags: selection.selectedTags,
    dropReasons: selection.dropReasons,
  };

  return { prompt, negative: parts.negative, parts };
}

/**
 * Composes the final scene-image prompt after an advisory rewrite (story_enhancer),
 * guaranteeing the resolved scenario clothing block survives regardless of what the
 * rewrite produced.
 */
export function composeEnhancedScenePrompt({ prefix = '', body = '', clothingBlock = '', suffix = '', loraTags = '' }) {
  return _join(prefix, body, clothingBlock, suffix, loraTags);
}

export function buildCharacterPrompt({ character, actionContext = '', location = null, config }) {
  if (!character) return { prompt: '', negative: '', parts: {} };
  const { buckets, clothingBlock } = _collectCharacterCandidates({
    character, actionContext, location, config,
  });
  const selection = selectPromptTags('character', buckets);
  const lora = _loraTags(config);
  const prompt = _join(...selection.selectedTags, lora);
  const negative = _join(
    config?.master_negative ?? '',
    config?.negative_additions ?? '',
    'portrait, headshot, close-up, bust, upper body, face focus, mugshot, multiple people, group',
  );
  return {
    prompt,
    negative,
    parts: {
      appearance: _charAppearanceTags(character),
      clothing: clothingBlock,
      action: actionContext,
      clothing_block: clothingBlock,
      candidateTags: selection.candidateTags,
      selectedTags: selection.selectedTags,
      dropReasons: selection.dropReasons,
    },
  };
}
