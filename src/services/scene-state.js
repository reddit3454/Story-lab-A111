import * as ollama from './ollama.js';
import { log, logError } from '../logger.js';

// Scene-state extraction. The narrator writes prose only; this focused call
// reads that prose plus the cast's current outfits and reports the observable
// state after the beat. One small, fully-required schema - local instruction
// models fill those reliably; they drop deeply-nested optionals (see the
// comfy-agent policy.js finding). Never throws: any failure -> EMPTY, the turn
// still completes.

const MOOD_WORDS = [
  'contemplative', 'tense', 'romantic', 'action',
  'melancholy', 'joyful', 'mysterious', 'neutral',
];

export const SCENE_STATE_SCHEMA = {
  type: 'object',
  properties: {
    scene_mood:    { type: 'string' },
    scene_arousal: { type: 'integer' },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          character_id: { type: 'integer' },
          mood:         { type: 'integer' },
          arousal:      { type: 'integer' },
        },
        required: ['character_id', 'mood', 'arousal'],
        additionalProperties: false,
      },
    },
    clothing_changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          character_name: { type: 'string' },
          new_clothing:   { type: 'string' },
        },
        required: ['character_name', 'new_clothing'],
        additionalProperties: false,
      },
    },
  },
  required: ['scene_mood', 'scene_arousal', 'characters', 'clothing_changes'],
  additionalProperties: false,
};

export const EMPTY_SCENE_STATE = Object.freeze({
  sceneMood: null, sceneArousal: null, characters: [], clothingChanges: [],
});

// Small, fast, instruction-tuned, reliable JSON, modest VRAM. Overridable via
// config.scene_state_model.
const DEFAULT_MODEL = 'qwen2.5:7b-instruct';

const SYSTEM = [
  'You read one beat of an interactive story and report the observable state after it.',
  'Return ONLY JSON matching the schema. No markdown, no commentary.',
  '',
  'scene_mood: one word for the scene now - one of:',
  '  contemplative, tense, romantic, action, melancholy, joyful, mysterious, neutral.',
  '',
  'scene_arousal: integer 1-10, based ONLY on what the text explicitly shows.',
  '  1 = ordinary, no charge.',
  '  2-3 = a blush, a nervous flutter, standing closer, a held glance. Most "chemistry" beats are here.',
  '  4-5 = open flirtation, deliberate light touch (hand, arm), charged banter.',
  '  6-7 = sustained physical contact, someone removing clothing, kissing.',
  '  8-9 = heavy foreplay described on the page.',
  '  10 = explicit sex in progress.',
  '  A feeling of anticipation or attraction with no physical action is 2-3, never higher.',
  '',
  'characters: exactly one entry per listed character.',
  '  mood 1-5 (1 cold/closed, 3 neutral, 5 warm/open). arousal 1-10, same scale as scene_arousal.',
  '',
  'clothing_changes: include a character ONLY if the text explicitly describes them',
  '  putting on, taking off, or changing a garment IN THIS BEAT. If their clothing is',
  '  merely mentioned, or unchanged, or you are unsure - OMIT them. Never output',
  '  "not specified", "unchanged", "same", or a description equal to what they already wear.',
  '  new_clothing = the full outfit AFTER the change, not just the delta.',
  '',
  'Judge only from what the text shows. Do not invent escalation the prose did not state.',
].join('\n');

const SENTINEL_CLOTHING = /^\s*(not?\s+specified|unspecified|unchanged|no\s+change|same(\s+as\s+before)?|n\/?a|none|unknown)\b/i;

function normClothing(s) {
  return String(s || '').toLowerCase().replace(/[\s.,;]+/g, ' ').trim();
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @param {object}   opts
 * @param {string}   opts.narratorText     the narrator's prose for this beat
 * @param {Array}    opts.cast              [{ id, name }, ...] scenario cast
 * @param {object}   opts.clothingByCharId  { [characterId]: 'current outfit text' }
 * @param {object}   opts.config            resolveMasterConfig() output
 * @returns {Promise<{ sceneMood: string|null, sceneArousal: number|null,
 *                     characters: [{characterId,mood,arousal}],
 *                     clothingChanges: [{characterName,newClothing}] }>}
 */
export async function extractSceneState({ narratorText, cast = [], clothingByCharId = {}, config = {} } = {}) {
  if (config.scene_state_enabled === false) return { ...EMPTY_SCENE_STATE };

  const text = String(narratorText || '').trim();
  if (!text || !Array.isArray(cast) || !cast.length) return { ...EMPTY_SCENE_STATE };

  const model = String(config.scene_state_model || config.prompt_extractor_model || DEFAULT_MODEL).trim();
  if (!model) { log('scene-state', 'skipped', { reason: 'no model configured' }); return { ...EMPTY_SCENE_STATE }; }

  const castLines = cast
    .map((c) => `- ${c.name} (character_id: ${c.id}; currently wearing: ${clothingByCharId[c.id] || 'unspecified'})`)
    .join('\n');

  const prompt = [
    'STORY BEAT:', text, '',
    'CHARACTERS IN THIS SCENARIO:', castLines, '',
    'Report the state after this beat as JSON.',
  ].join('\n');

  let parsed;
  try {
    const res = await ollama.generate({
      model,
      system: SYSTEM,
      prompt,
      format: SCENE_STATE_SCHEMA,
      keep_alive: config.scene_state_keep_alive ?? '5m',
      options: { num_predict: 500, temperature: 0.1, top_p: 0.9 },
    });
    const raw = String(res.response || '').trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(raw);
  } catch (err) {
    logError('scene-state', 'extract-failed', err);
    return { ...EMPTY_SCENE_STATE };
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_SCENE_STATE };

  const castIds = new Set(cast.map((c) => c.id));
  const currentByName = new Map(
    cast.map((c) => [c.name.toLowerCase(), normClothing(clothingByCharId[c.id])])
  );

  const moodWord = MOOD_WORDS.includes(String(parsed.scene_mood || '').toLowerCase())
    ? String(parsed.scene_mood).toLowerCase()
    : null;

  const characters = Array.isArray(parsed.characters)
    ? parsed.characters
        .map((c) => ({
          characterId: Number(c.character_id),
          mood:    clampInt(c.mood, 1, 5, 3),
          arousal: clampInt(c.arousal, 1, 10, 1),
        }))
        .filter((c) => castIds.has(c.characterId))
    : [];

  const clothingChanges = Array.isArray(parsed.clothing_changes)
    ? parsed.clothing_changes
        .map((c) => ({
          characterName: String(c.character_name || '').trim(),
          newClothing:   String(c.new_clothing || '').trim(),
        }))
        .filter((c) => {
          if (!c.characterName || !c.newClothing) return false;
          if (SENTINEL_CLOTHING.test(c.newClothing)) return false;          // "not specified", "unchanged", ...
          const cur = currentByName.get(c.characterName.toLowerCase());
          if (cur && normClothing(c.newClothing) === cur) return false;     // model restated the current outfit
          return true;
        })
    : [];

  return {
    sceneMood:    moodWord,
    sceneArousal: clampInt(parsed.scene_arousal, 1, 10, null),
    characters,
    clothingChanges,
  };
}
