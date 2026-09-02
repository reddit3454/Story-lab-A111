const SCENE_START = '---SCENE---';
const SCENE_END   = '---END---';

export function normalizeSceneCard(card) {
  const base = defaultSceneCard();
  return Object.assign({}, base, card && typeof card === 'object' ? card : {});
}

function defaultSceneCard() {
  return {
    mood:                      'neutral',
    arousal_level:             1,
    clothing_changes:          [],
  };
}

export function parseNarratorResponse(rawResponse) {
  const delimIdx = rawResponse.indexOf(SCENE_START);

  if (delimIdx === -1) {
    return { story_text: rawResponse.trim(), scene_card: normalizeSceneCard(defaultSceneCard()) };
  }

  const story_text = rawResponse.slice(0, delimIdx).trim();
  const rest       = rawResponse.slice(delimIdx + SCENE_START.length);
  const endIdx     = rest.indexOf(SCENE_END);
  const jsonStr    = (endIdx !== -1 ? rest.slice(0, endIdx) : rest).trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (parseErr) {
    console.warn('[input-parser] scene card JSON parse failed:', parseErr.message, '| raw snippet:', jsonStr.slice(0, 120));
    return { story_text, scene_card: normalizeSceneCard(defaultSceneCard()) };
  }

  const card = defaultSceneCard();
  if (typeof parsed.mood === 'string')
    card.mood = parsed.mood;
  if (typeof parsed.arousal_level === 'number')
    card.arousal_level = Math.max(1, Math.min(10, Math.round(parsed.arousal_level)));
  if (Array.isArray(parsed.clothing_changes))
    card.clothing_changes = parsed.clothing_changes;
  if (typeof parsed.summary_plain === 'string')
    card.summary_plain = parsed.summary_plain;
  if (typeof parsed.summaryPlain === 'string')
    card.summaryPlain = parsed.summaryPlain;
  if (typeof parsed.visual_brief === 'string')
    card.visual_brief = parsed.visual_brief;
  if (typeof parsed.visualBrief === 'string')
    card.visualBrief = parsed.visualBrief;
  if (typeof parsed.image_prompt === 'string')
    card.image_prompt = parsed.image_prompt;
  if (typeof parsed.imagePrompt === 'string')
    card.imagePrompt = parsed.imagePrompt;

  return { story_text, scene_card: normalizeSceneCard(card) };
}
