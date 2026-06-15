const SCENE_START = '---SCENE---';
const SCENE_END   = '---END---';

function defaultSceneCard() {
  return {
    image_prompt:              '',
    negative_prompt_additions: '',
    mood:                      'neutral',
    arousal_level:             1,
    nsfw_elements:             false,
    explicit_act:              null,
    nudity_state:              null,
    body_positions:            null,
    clothing_changes:          [],
  };
}

export function parseNarratorResponse(rawResponse) {
  const delimIdx = rawResponse.indexOf(SCENE_START);

  if (delimIdx === -1) {
    return { story_text: rawResponse.trim(), scene_card: defaultSceneCard() };
  }

  const story_text = rawResponse.slice(0, delimIdx).trim();
  const rest       = rawResponse.slice(delimIdx + SCENE_START.length);
  const endIdx     = rest.indexOf(SCENE_END);
  const jsonStr    = (endIdx !== -1 ? rest.slice(0, endIdx) : rest).trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (_) {
    return { story_text, scene_card: defaultSceneCard() };
  }

  const card = defaultSceneCard();
  if (typeof parsed.image_prompt === 'string')
    card.image_prompt = parsed.image_prompt;
  if (typeof parsed.negative_prompt_additions === 'string')
    card.negative_prompt_additions = parsed.negative_prompt_additions;
  if (typeof parsed.mood === 'string')
    card.mood = parsed.mood;
  if (typeof parsed.arousal_level === 'number')
    card.arousal_level = Math.max(1, Math.min(10, Math.round(parsed.arousal_level)));
  if (typeof parsed.nsfw_elements === 'boolean')
    card.nsfw_elements = parsed.nsfw_elements;
  if (Array.isArray(parsed.clothing_changes))
    card.clothing_changes = parsed.clothing_changes;
  if (typeof parsed.explicit_act === 'string' && parsed.explicit_act.trim())
    card.explicit_act = parsed.explicit_act.trim();
  if (typeof parsed.nudity_state === 'string' && parsed.nudity_state.trim())
    card.nudity_state = parsed.nudity_state.trim();
  if (typeof parsed.body_positions === 'string' && parsed.body_positions.trim())
    card.body_positions = parsed.body_positions.trim();

  return { story_text, scene_card: card };
}
