import { chat } from './ollama.js';

export function buildPickerJsonSchema(nsfwEnabled = false) {
  const properties = {
    summary: { type: 'string' },
    mainSubject: { type: 'string' },
    visibleAction: { type: 'string' },
    setting: { type: 'string' },
    shotType: { type: 'string' },
    imageabilityScore: { type: 'number' },
    penaltyReason: { type: ['string', 'null'] },
  };
  const required = ['summary', 'mainSubject', 'visibleAction', 'setting', 'shotType', 'imageabilityScore', 'penaltyReason'];
  if (nsfwEnabled) {
    properties.bodyPosition = { type: ['string', 'null'] };
    properties.explicitAct = { type: ['string', 'null'] };
    properties.nudityState = { type: ['string', 'null'] };
    properties.clothingState = { type: ['string', 'null'] };
    required.push('bodyPosition', 'explicitAct', 'nudityState', 'clothingState');
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

const PICKER_SYSTEM = [
  'You select ONE camera shot from the provided story excerpt for image generation.',
  'Return ONLY a single JSON object matching the requested schema (no markdown, no prose).',
  'mainSubject MUST be a character name from the Characters list when any match; else a short subject phrase.',
  'visibleAction MUST be a concrete physical verb phrase (not "standing there" or empty).',
  'If unsure, still return valid JSON with a lower imageabilityScore and a penaltyReason.',
].join(' ');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildRecentImagesBlock(recentImageCards) {
  if (!recentImageCards || !recentImageCards.length) return null;
  const lines = recentImageCards.map((card, i) => {
    const chars   = (card.characters_present || []).map(c => c.name).filter(Boolean).join(', ');
    const setting = card.setting || card.environment || '';
    const mood    = card.mood   || card.atmosphere   || '';
    return `Image ${i + 1}: ${[chars && `chars: ${chars}`, setting, mood].filter(Boolean).join('; ')}`;
  });
  return lines.join('\n');
}

function buildPickerPrompt(contextTurns, activeCharacters, recentImageCards, nsfwEnabled) {
  const contextText = contextTurns.join('\n---\n');
  const charNames   = activeCharacters.map(c => c.name).filter(Boolean).join(', ');
  const recentBlock = buildRecentImagesBlock(recentImageCards);

  const baseSchema = {
    summary:           'one sentence describing the visual moment',
    mainSubject:       'primary character(s) or subject',
    visibleAction:     'what is physically happening right now',
    setting:           'specific location and environmental details',
    shotType:          'close-up | medium | wide | establishing',
    imageabilityScore: 'number 1-10',
    penaltyReason:     'string or null',
  };
  const nsfwSchema = nsfwEnabled ? {
    bodyPosition:  'exact body position — e.g. bent over, missionary, cowgirl, on knees, standing, lying on back — or null',
    explicitAct:   'named sex act if actively occurring — e.g. vaginal sex, blowjob, cunnilingus, fingering, anal sex — or null',
    nudityState:   'precise nudity description — e.g. fully nude, topless, breasts exposed, bottomless, genitals visible — or null if clothed',
    clothingState: 'precise clothing state — e.g. dress hiked up, shirt removed, panties around ankles, fully clothed, bra unclasped',
  } : {};
  const schema = JSON.stringify({ ...baseSchema, ...nsfwSchema }, null, 2);

  const lines = [
    'You are selecting the single most visually compelling moment from a story excerpt for image generation.',
    '',
    'Read the story turns below. Mentally identify 3 to 5 candidate visual moments. Then select the ONE BEST candidate.',
    '',
    'Score higher when:',
    '- Visible physical action is happening right now (movement, gesture, physical contact)',
    '- Characters are interacting with eye contact, touch, or direct engagement',
    '- The setting has concrete specific anchors (named room, furniture, object, weather detail)',
    '- The moment is a reveal, escalation, or emotional peak expressed through physical action',
    '- The moment is visually distinct from recently generated images',
    '',
    'Score lower when:',
    '- Characters are just standing or sitting with no action',
    '- The text is internal monologue, reflection, or narrated exposition',
    '- The visual situation closely resembles recently generated images',
    '',
  ];

  if (nsfwEnabled) {
    lines.push(
      'NSFW FIELD EXTRACTION — for the selected moment, extract these precisely from the story text:',
      '- bodyPosition: the exact named physical position of the primary subject(s). Use standard terms: bent over, missionary, cowgirl, reverse cowgirl, on knees, lying on back, standing, against wall, legs spread, doggy style, riding.',
      '- explicitAct: the named sex act only if it is actively occurring right now in the text. Use: vaginal sex, blowjob, cunnilingus, fingering, anal sex, handjob, grinding, riding, penetration. null if no act is happening.',
      '- nudityState: describe nudity only if present. Use: fully nude, topless, breasts exposed, bottomless, genitals visible, naked, bare. null if clothed.',
      '- clothingState: describe the clothing precisely as it appears. Include partial removal: dress hiked up, shirt removed, bra unclasped and hanging, panties around ankles, fully clothed.',
      'Extract ONLY what is explicitly stated in the text. Do not invent or imply.',
      '',
      'NSFW SCORING BONUSES — this scenario has adult content enabled. Explicit moments score highest:',
      '+6 if the moment contains active penetration, oral sex, or explicit intercourse',
      '+5 if the moment contains full nudity — genitals, breasts, or buttocks fully exposed',
      '+4 if the moment contains partial nudity — topless, bottomless, or genitals partially exposed',
      '+3 if the moment contains active undressing — clothing being removed or pulled aside',
      '+2 if the moment contains explicit groping, fingering, or direct sexual contact',
      '+1 if the moment contains a kiss, embrace, or buildup to a sexual act',
      'TIEBREAKER: any moment containing nudity, undressing, or an explicit sex act MUST be ranked first regardless of all other scoring.',
      '',
    );
  }

  if (recentBlock) {
    lines.push('Recently generated images (for variety — penalize similar moments):');
    lines.push(recentBlock);
    lines.push('');
  }

  if (charNames) {
    lines.push(`Characters in this story: ${charNames}`);
    lines.push('');
  }

  lines.push(
    'Story turns:',
    '',
    contextText,
    '',
    'Return ONLY a single JSON object for the best visual moment. Use exactly these fields:',
    schema,
    '',
    'Return only the JSON object. No explanation. No markdown. No code block.',
  );

  return lines.join('\n');
}

// Parses the raw model response. Returns null if visibleAction is missing or
// the response cannot be parsed as JSON.
function parseCandidateResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const obj = JSON.parse(cleaned);
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.visibleAction || typeof obj.visibleAction !== 'string' || !obj.visibleAction.trim()) {
      return null;
    }
    if (obj.imageabilityScore != null) {
      const score = Number(obj.imageabilityScore);
      obj.imageabilityScore = isNaN(score) ? null : score;
    }
    return obj;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// pickBestMoment
// Inputs:
//   contextTurns     - array of narrator content_text strings (recent turns)
//   activeCharacters - character rows (NPC-only after player filter)
//   recentImageCards - prior scene card objects for variety penalty
//                      (currently always [] — scene_images has no scene_card_json column)
//   pickerModel      - Ollama model name string
//   nsfwEnabled      - boolean, default false
// Returns: candidate object { visibleAction, setting, shotType, ... } or null
// Never throws.
// ---------------------------------------------------------------------------

/**
 * Build the story-turn list passed to pickBestMoment.
 * When the user clicks [Img] on a specific narrator turn, that turn's text is the
 * focal source - do NOT flood the picker with other recent turns or it may select
 * a generic standing/sitting moment from elsewhere in the thread.
 */
export function resolvePickerContextTurns({ focalTurnText = null, recentTurnsChronological = [] } = {}) {
  const focal = String(focalTurnText || '').trim();
  if (focal) return [focal];
  return (recentTurnsChronological || []).map((s) => String(s || '').trim()).filter(Boolean);
}

export async function pickBestMoment(contextTurns, activeCharacters, recentImageCards, pickerModel, nsfwEnabled = false) {
  if (!contextTurns || !contextTurns.length || !pickerModel) return null;

  const prompt = buildPickerPrompt(
    contextTurns,
    activeCharacters || [],
    recentImageCards || [],
    nsfwEnabled,
  );

  let res;
  try {
    res = await chat({
      model: pickerModel,
      messages: [
        { role: 'system', content: PICKER_SYSTEM },
        { role: 'user', content: prompt },
      ],
      format: buildPickerJsonSchema(!!nsfwEnabled),
      options: { temperature: 0.1, top_p: 0.9, num_predict: 500 },
    });
  } catch (_) {
    return null;
  }

  const rawText = (res?.message?.content || '').trim();
  return parseCandidateResponse(rawText);
}
