// Pure prompt assembly. No DB calls, no network calls, no LLM rewriting.
//
// Non-negotiable assembly order (content — the action/clothing/location text
// the narrator or the user typed — can NEVER inject style words; style comes
// from exactly one place: the active Look):
//   1) Style   — Look prompt_prefix + LoRA tags  (front)
//   2) Character — appearance description(s) + FaceID note
//   3) Action  — user-editable scene/action text (style-word-stripped)
//   4) Location + clothing (style-word-stripped)
//   5) Style   — Look prompt_suffix (back, bookending the content)
// Negative prompt: Look negative (style) + master anatomy/safety negative.

// Words/phrases that describe rendering STYLE rather than scene CONTENT.
// Stripped from every content-side input (action, clothing, location tags)
// so a narrator or user cannot smuggle a second style system into the prompt.
const STYLE_WORDS = [
  'masterpiece', 'best quality', 'high quality', 'ultra quality', 'absurdres',
  'highres', 'high res', '8k', '4k', 'uhd', 'hdr', 'hyperrealistic', 'photoreal',
  'photorealistic', 'photo realistic', 'cinematic', 'cinematic lighting',
  'cinematic still', 'film grain', 'anime', 'manga', 'illustration', 'painting',
  'digital art', 'concept art', 'artstation', 'trending on artstation',
  'octane render', 'unreal engine', 'unreal engine 5', 'render', '3d render',
  'cgi', 'vray', 'ray tracing', 'studio lighting', 'dramatic lighting',
  'volumetric lighting', 'sharp focus', 'depth of field', 'bokeh',
  'award winning', 'award-winning', 'detailed', 'intricate detail',
  'intricately detailed', 'hyper detailed', 'ultra detailed',
];

const _styleWordPattern = new RegExp(
  '\\b(' + STYLE_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'gi',
);

/**
 * Strips known style vocabulary out of a content-side string (action text,
 * clothing description, location tags). Leaves scene/content words alone.
 */
export function stripStyleWords(text) {
  if (!text) return '';
  return String(text)
    .replace(_styleWordPattern, '')
    // collapse the comma/whitespace debris left behind by a removed phrase
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
}

export function loraTags(look) {
  if (!look?.loras_json) return [];
  let list;
  try {
    list = JSON.parse(look.loras_json);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((l) => l && l.file)
    .map((l) => `<lora:${l.file}:${l.strength != null ? l.strength : 1.0}>`);
}

/**
 * buildPrompt — pure. Returns { prompt, negative, parts, loras }.
 *
 * @param {object}   look         active Look row (or null — generation still
 *                                works with master defaults and no style lock)
 * @param {string[]} characters   pre-built character appearance strings
 *                                (see character-appearance.js#buildCharacterAppearance)
 * @param {string}   actionText   user-editable action/scene text (content)
 * @param {string}   clothingText clothing state description (content)
 * @param {string}   locationTags location description/tags (content)
 * @param {string}   masterNegative structural anatomy/safety negative — never
 *                                style words
 * @param {string}   mode         'scene' | 'portrait' | 'fullbody'
 * @param {boolean}  hasFaceRef   whether a FaceID reference is attached
 *                                out-of-band (affects only the character part
 *                                text, not the prompt itself — the actual
 *                                image reference is a ControlNet unit, not text)
 */
export function buildPrompt({
  look = null,
  characters = [],
  actionText = '',
  clothingText = '',
  locationTags = '',
  masterNegative = '',
  mode = 'scene',
  hasFaceRef = false,
} = {}) {
  const loras = loraTags(look);

  const stylePrefix = [look?.prompt_prefix || '', ...loras].filter(Boolean).join(', ');
  const styleSuffix = look?.prompt_suffix || '';

  const characterPart = (characters || []).filter(Boolean).join(', ');
  const actionPart = stripStyleWords(actionText);
  const locationPart = stripStyleWords(locationTags);
  const clothingPart = stripStyleWords(clothingText);
  const locationAndClothing = [locationPart, clothingPart].filter(Boolean).join(', ');

  const promptSections = [stylePrefix, characterPart, actionPart, locationAndClothing, styleSuffix]
    .filter(Boolean);
  const prompt = promptSections.join(', ');

  const negative = [look?.negative || '', masterNegative || ''].filter(Boolean).join(', ');

  return {
    prompt,
    negative,
    parts: {
      mode,
      style_prefix: stylePrefix,
      style_suffix: styleSuffix,
      character: characterPart,
      action: actionPart,
      location: locationPart,
      clothing: clothingPart,
      look_id: look?.id ?? null,
      look_name: look?.name ?? null,
      has_face_ref: !!hasFaceRef,
    },
    loras,
  };
}
