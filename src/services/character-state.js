import db from '../db.js';
import * as ollama from './ollama.js';
import { log, logError } from '../logger.js';
import { getScenarioClothing, setScenarioRuntimeClothing } from './clothing.js';

export const EMOTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          characterId: { type: 'number' },
          moodDelta: { type: 'integer' },
          arousalDelta: { type: 'integer' },
        },
        required: ['characterId', 'moodDelta', 'arousalDelta'],
        additionalProperties: false,
      },
    },
  },
  required: ['updates'],
  additionalProperties: false,
};

const EMOTION_SYSTEM = [
  'You are an emotional state tracker for a collaborative story system.',
  'Return ONLY JSON matching the schema: { "updates": [ { "characterId", "moodDelta", "arousalDelta" } ] }.',
  'moodDelta and arousalDelta are integers from -2 to 2.',
  'moodDelta: positive = warmer/happier, negative = colder/upset.',
  'arousalDelta: rises when a character flirts, touches, undresses, or escalates sexually.',
  'Use characterId values ONLY from the provided list. Do not invent characters. No markdown.',
].join(' ');


const _getState = db.prepare(
  'SELECT * FROM scenario_character_state WHERE scenario_id = ? AND character_id = ?'
);
const _listStates = db.prepare(
  'SELECT * FROM scenario_character_state WHERE scenario_id = ?'
);
const _getChar = db.prepare(
  'SELECT id, name, moodbaseline, arousalmax, arousaltriggers, moodtriggerspos, moodtriggersneg FROM characters WHERE id = ?'
);
const _getCast = db.prepare(`
  SELECT c.id, c.name, c.moodbaseline, c.arousalmax, c.arousallockeduntil, c.arousaltriggers, c.moodtriggerspos, c.moodtriggersneg, c.is_user_character
  FROM characters c
  JOIN scenario_characters sc ON c.id = sc.character_id
  WHERE sc.scenario_id = ?
  ORDER BY c.name
`);

function _clampMood(v) {
  return Math.min(5, Math.max(1, Math.round(Number(v) || 3)));
}

function _clampArousal(v, max) {
  const ceiling = Math.min(10, Math.max(1, Number(max) || 10));
  return Math.min(ceiling, Math.max(1, Math.round(Number(v) || 1)));
}

function _effectiveArousalForBehavior(char, mood, arousal) {
  const moodVal = _clampMood(mood);
  const raw = _clampArousal(arousal, char?.arousalmax ?? 10);
  const lock = Number(char?.arousallockeduntil) || 2;
  let cap = raw;
  if (lock >= 4 && moodVal < 5) cap = Math.min(cap, 3);
  else if (lock >= 3 && moodVal < 4) cap = Math.min(cap, 3);
  else if (lock >= 2 && moodVal < 3) cap = Math.min(cap, 2);
  return cap;
}

const ACTION_BY_AROUSAL = {
  1: 'Behave normally. No flirtation, no sexual initiative, no lingering physical focus on others.',
  2: 'Mostly composed. At most brief polite warmth - no flirtation or escalation.',
  3: 'Subtle chemistry only: slightly longer eye contact, nervous energy, voice softening. No groping or explicit moves.',
  4: 'Show desire through body language: lean in, track the other person, flushed skin, charged banter. May tease verbally.',
  5: 'Actively flirt and tease. Initiate light touch if the scene allows (hand, arm, waist). Hard to stay neutral.',
  6: 'MUST show arousal in action: gaze dropping to their body, lip bite, self-touch (neck, hair, thigh), restless shifting.',
  7: 'MUST initiate physical contact beyond casual: hold, pull closer, graze skin, sit too close. Dialogue less filtered.',
  8: 'MUST push toward intimacy: deliberate touching, undressing hints, kissing or asking for it when fitting.',
  9: 'MUST drive escalation: foreplay-level actions, demanding contact, thin restraint in words and deeds.',
  10: 'MUST initiate sex acts now - not hints or teasing. Start or demand penetration, oral, manual sex, or equivalent explicit act in the scene. No waiting, no polite deflection, no fade-to-black unless personality explicitly forbids it.',
};

export function buildCastBehaviorBlock(characters, characterStates) {
  const npcs = (characters || []).filter(c => !c.is_user_character);
  if (!npcs.length) return '';

  const lines = [
    'CHARACTER AROUSAL AND ACTION (MANDATORY)',
    'Each NPC arousal score MUST control their physical behavior, initiative, and dialogue subtext THIS TURN.',
    'Show arousal through what they DO - touch, proximity, gaze, undressing, initiating - not thoughts alone.',
    'Higher arousal means more initiating and more explicit action, not just internal desire.',
    '',
  ];

  for (const c of npcs) {
    const st = characterStates[c.id];
    if (!st) continue;
    const mood = st.moodcurrent;
    const raw = st.arousalcurrent;
    const effective = _effectiveArousalForBehavior(c, mood, raw);
    const actionLine = ACTION_BY_AROUSAL[effective] || ACTION_BY_AROUSAL[3];

    let block = `${c.name}: mood ${mood}/5, arousal ${raw}/10`;
    if (effective < raw) {
      block += ` (actions capped at arousal ${effective} until mood warms up)`;
    }
    block += `
Required behavior: ${actionLine}`;
    if (c.arousaltriggers && String(c.arousaltriggers).trim() && effective >= 3) {
      block += `
Escalation triggers (lean into these when fitting): ${String(c.arousaltriggers).trim()}`;
    }
    if (c.moodtriggersneg && String(c.moodtriggersneg).trim()) {
      block += `
Turn-offs / avoid (do NOT push these; they cool or shut the character down): ${String(c.moodtriggersneg).trim()}`;
    }
    if (c.moodtriggerspos && String(c.moodtriggerspos).trim() && mood <= 3) {
      block += `
Warmth triggers (these improve mood when present): ${String(c.moodtriggerspos).trim()}`;
    }
    lines.push(block);
    lines.push('');
  }

  lines.push('Do NOT write high-arousal NPCs as emotionally flat or purely conversational. They must ACT on their arousal level.');
  lines.push('At arousal 10, NPCs MUST initiate explicit sex acts in the narration - not merely desire them.');
  return lines.join('\n');
}

export function buildEmotionalDirective(moodcurrent, arousalcurrent) {
  const mood = _clampMood(moodcurrent);
  const arousal = _clampArousal(arousalcurrent, 10);

  const moodMap = {
    1: 'cold, closed off, minimal warmth',
    2: 'guarded, reserved, reactive not proactive',
    3: 'baseline, natural engagement',
    4: 'warm, receptive, responds with genuine interest',
    5: 'emotionally present, expressive, actively seeking connection',
  };

  const arousalMap = {
    2: 'mild undercurrent of attraction',
    3: 'noticeable tension, awareness of physical closeness',
    4: 'heightened desire, difficulty maintaining composure',
    5: 'intense arousal, actively seeking escalation',
    6: 'gaze lingers on the other person before snapping away; tries to hide it but attention is visible',
    7: 'unconscious self-touching; shifts posture for sensory reasons; body speaking before the mind catches up',
    8: 'reaches to touch the other person more than the situation calls for; not hiding it anymore',
    9: 'attention narrowed to the other person; every response physically charged; restraint thin and effortful',
    10: 'no restraint left; initiates explicit sex acts; every movement and word pushes toward intercourse or equivalent',
  };

  const moodLabel = moodMap[mood] || moodMap[3];
  const arousalLabel = arousalMap[arousal];
  return arousalLabel
    ? `Emotional state: ${moodLabel}. ${arousalLabel}.`
    : `Emotional state: ${moodLabel}.`;
}

export function getScenarioCharacterState(scenarioId, characterId) {
  return _getState.get(scenarioId, characterId) || null;
}

export function ensureScenarioCharacterState(scenarioId, characterId) {
  const existing = getScenarioCharacterState(scenarioId, characterId);
  if (existing) return existing;

  const char = _getChar.get(characterId);
  const mood = _clampMood(char?.moodbaseline ?? 3);
  const startRow = db.prepare(
    'SELECT starting_clothing FROM scenario_characters WHERE scenario_id = ? AND character_id = ?'
  ).get(scenarioId, characterId);
  const startClothing = (startRow?.starting_clothing || '').trim();
  db.prepare(`
    INSERT OR IGNORE INTO scenario_character_state
      (scenario_id, character_id, moodcurrent, arousalcurrent, mood_momentum, arousal_momentum, current_clothing)
    VALUES (?, ?, ?, 1, 0, 0, ?)
  `).run(scenarioId, characterId, mood, startClothing);
  return _getState.get(scenarioId, characterId);
}

export function listScenarioCharacterStates(scenarioId) {
  const cast = _getCast.all(scenarioId);
  return cast.map(function (ch) {
    const row = ensureScenarioCharacterState(scenarioId, ch.id);
    const sc = db.prepare(
      'SELECT starting_clothing, starting_clothing_set_name FROM scenario_characters WHERE scenario_id = ? AND character_id = ?'
    ).get(scenarioId, ch.id);
    return {
      characterId: ch.id,
      name: ch.name,
      moodcurrent: row.moodcurrent,
      arousalcurrent: row.arousalcurrent,
      mood_momentum: row.mood_momentum,
      arousal_momentum: row.arousal_momentum,
      current_clothing: getScenarioClothing(scenarioId, ch.id),
      starting_clothing: (sc?.starting_clothing || '').trim(),
      starting_clothing_set_name: sc?.starting_clothing_set_name || null,
    };
  });
}

export function updateScenarioCharacterStateManual(scenarioId, characterId, { moodcurrent, arousalcurrent }) {
  const char = _getChar.get(characterId);
  ensureScenarioCharacterState(scenarioId, characterId);
  const mood = _clampMood(moodcurrent);
  const arousal = _clampArousal(arousalcurrent, char?.arousalmax ?? 10);
  db.prepare(`
    UPDATE scenario_character_state
    SET moodcurrent = ?, arousalcurrent = ?, mood_momentum = 0, arousal_momentum = 0,
        updated_at = datetime('now')
    WHERE scenario_id = ? AND character_id = ?
  `).run(mood, arousal, scenarioId, characterId);
  return getScenarioCharacterState(scenarioId, characterId);
}

export function deleteScenarioCharacterState(scenarioId, characterId) {
  db.prepare(
    'DELETE FROM scenario_character_state WHERE scenario_id = ? AND character_id = ?'
  ).run(scenarioId, characterId);
}

export async function processEmotionalUpdateAfterTurn({
  scenarioId,
  narratorTurn,
  characters,
  config = {},
}) {
  const cast = characters && characters.length ? characters : _getCast.all(scenarioId);
  if (!cast.length || !narratorTurn?.content_text) return [];

  const states = listScenarioCharacterStates(scenarioId);
  let presentStates = states;
  try {
    const card = narratorTurn.scene_card_json
      ? JSON.parse(narratorTurn.scene_card_json)
      : null;
    if (card && Array.isArray(card.characters_present) && card.characters_present.length) {
      const names = new Set(
        card.characters_present.map(c => String(c.name || '').toLowerCase()).filter(Boolean)
      );
      presentStates = states.filter(s => {
        const ch = cast.find(c => c.id === s.characterId);
        return ch && names.has(String(ch.name || '').toLowerCase());
      });
    }
  } catch (_) {}

  if (!presentStates.length) presentStates = states;

  const model = (config.prompt_extractor_model || config.narrator_model || '').trim();
  if (!model) return [];

  const characterList = presentStates.map(function (s) {
    const ch = cast.find(c => c.id === s.characterId);
    return `- ${ch?.name || s.characterId} (id: ${s.characterId}, currentMood: ${s.moodcurrent}, currentArousal: ${s.arousalcurrent})`;
  }).join('\n');

  const emotionUser = [
    'Read the narrator response and determine how each listed character emotional state changed during this beat.',
    '',
    'Narrator response:',
    narratorTurn.content_text,
    '',
    'Characters present:',
    characterList,
    '',
    'Return JSON: { "updates": [ { "characterId": <id from list>, "moodDelta": <-2..2>, "arousalDelta": <-2..2> } ] }',
    'Use +1 or +2 arousal when the character initiated touch, showed desire, or escalated physically. Use 0 only if unaffected.',
  ].join('\n');

  let updates;
  try {
    const result = await ollama.generate({
      model,
      system: EMOTION_SYSTEM,
      prompt: emotionUser,
      format: EMOTION_JSON_SCHEMA,
      options: { num_predict: 400, temperature: 0.1, top_p: 0.9 },
    });
    const rawText = String(result.response || '').trim();
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      updates = parsed;
    } else if (parsed && Array.isArray(parsed.updates)) {
      updates = parsed.updates;
    } else {
      return [];
    }
  } catch (err) {
    logError('character-state', 'emotional-parse-failed', err);
    return [];
  }

  const updatedCharacters = [];
  for (const update of updates) {
    const charId = Number(update.characterId);
    if (!Number.isFinite(charId)) continue;

    const state = presentStates.find(s => s.characterId === charId);
    if (!state) continue;

    const char = cast.find(c => c.id === charId);
    if (!char) continue;

    const row = getScenarioCharacterState(scenarioId, charId) || ensureScenarioCharacterState(scenarioId, charId);
    const moodDelta = Math.max(-2, Math.min(2, Number(update.moodDelta) || 0));
    const arousalDelta = Math.max(-2, Math.min(2, Number(update.arousalDelta) || 0));

    let newMoodMomentum = (row.mood_momentum || 0) + moodDelta;
    let newArousalMomentum = (row.arousal_momentum || 0) + arousalDelta;
    let newMood = row.moodcurrent;
    let newArousal = row.arousalcurrent;

    if (Math.abs(newMoodMomentum) >= 2) {
      newMood = _clampMood(row.moodcurrent + Math.sign(newMoodMomentum));
      newMoodMomentum = 0;
    }
    const arousalThreshold = row.arousalcurrent >= 5 ? 4 : 2;
    if (Math.abs(newArousalMomentum) >= arousalThreshold) {
      newArousal = _clampArousal(
        row.arousalcurrent + Math.sign(newArousalMomentum),
        char.arousalmax ?? 10
      );
      newArousalMomentum = 0;
    }

    db.prepare(`
      UPDATE scenario_character_state
      SET moodcurrent = ?, arousalcurrent = ?, mood_momentum = ?, arousal_momentum = ?,
          updated_at = datetime('now')
      WHERE scenario_id = ? AND character_id = ?
    `).run(newMood, newArousal, newMoodMomentum, newArousalMomentum, scenarioId, charId);

    if (newMood !== row.moodcurrent || newArousal !== row.arousalcurrent) {
      updatedCharacters.push({
        characterId: charId,
        name: char.name,
        moodcurrent: newMood,
        arousalcurrent: newArousal,
      });
    }
  }

  if (updatedCharacters.length) {
    log('character-state', 'emotional-updated', { scenarioId, count: updatedCharacters.length });
  }
  return updatedCharacters;
}
