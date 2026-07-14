const SCENE_START = '---SCENE---';
const SCENE_END   = '---END---';

export function isTagLike(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  const chunks = t.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (chunks.length < 6) return false;
  const avgLen = chunks.reduce(function (a, c) { return a + c.length; }, 0) / chunks.length;
  if (avgLen > 32) return false;
  if (/\b(the|their|she|he|with|while|as they|in the|on the)\b/i.test(t) && t.length > 60) return false;
  return true;
}

export function normalizeSceneCard(card) {
  const base = defaultSceneCard();
  const out = Object.assign({}, base, card && typeof card === 'object' ? card : {});

  if (out.image_prompt && !out.summary_plain && !out.summary_tags) {
    if (isTagLike(out.image_prompt)) {
      out.summary_tags = out.image_prompt;
    } else {
      out.summary_plain = out.image_prompt;
    }
  } else {
    if (!out.summary_plain && out.image_prompt && !isTagLike(out.image_prompt)) {
      out.summary_plain = out.image_prompt;
    }
    if (!out.summary_tags && out.image_prompt && isTagLike(out.image_prompt) && out.image_prompt !== out.summary_plain) {
      out.summary_tags = out.image_prompt;
    }
  }

  if (!out._meta || typeof out._meta !== 'object') {
    out._meta = {
      plain_source: out.summary_plain ? 'narrator' : 'empty',
      tags_source: out.summary_tags ? 'extractor' : 'empty',
      plain_original: out.summary_plain || '',
      tags_original: out.summary_tags || '',
      locale: 'en',
    };
  }

  return out;
}

function defaultSceneCard() {
  return {
    summary_plain:             '',
    summary_tags:                '',
    image_prompt:              '',
    negative_prompt_additions: '',
    mood:                      'neutral',
    arousal_level:             1,
    nsfw_elements:             false,
    explicit_act:              null,
    nudity_state:              null,
    body_positions:            null,
    clothing_changes:          [],
    _meta:                     null,
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
  if (typeof parsed.image_prompt === 'string')
    card.image_prompt = parsed.image_prompt;
  if (typeof parsed.summary_plain === 'string')
    card.summary_plain = parsed.summary_plain;
  if (typeof parsed.summary_tags === 'string')
    card.summary_tags = parsed.summary_tags;
  if (typeof parsed.negative_prompt_additions === 'string')
    card.negative_prompt_additions = parsed.negative_prompt_additions;
  if (typeof parsed.mood === 'string')
    card.mood = parsed.mood;
  if (typeof parsed.arousal_level === 'number')
    card.arousal_level = Math.max(1, Math.min(10, Math.round(parsed.arousal_level)));
  if (typeof parsed.nsfw_elements === 'boolean') {
    card.nsfw_elements = parsed.nsfw_elements;
  } else if (parsed.nsfw_elements === 'true' || parsed.nsfw_elements === 1) {
    card.nsfw_elements = true;
  } else if (parsed.nsfw_elements === 'false' || parsed.nsfw_elements === 0) {
    card.nsfw_elements = false;
  }
  if (Array.isArray(parsed.clothing_changes))
    card.clothing_changes = parsed.clothing_changes;
  if (typeof parsed.explicit_act === 'string' && parsed.explicit_act.trim())
    card.explicit_act = parsed.explicit_act.trim();
  if (typeof parsed.nudity_state === 'string' && parsed.nudity_state.trim())
    card.nudity_state = parsed.nudity_state.trim();
  if (typeof parsed.body_positions === 'string' && parsed.body_positions.trim())
    card.body_positions = parsed.body_positions.trim();

  card._meta = {
    plain_source: card.summary_plain || card.image_prompt ? 'narrator' : 'empty',
    tags_source: card.summary_tags ? 'extractor' : 'empty',
    plain_original: card.summary_plain || card.image_prompt || '',
    tags_original: card.summary_tags || '',
    locale: 'en',
  };

  return { story_text, scene_card: normalizeSceneCard(card) };
}
