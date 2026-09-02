import db from '../db.js';
import { log } from '../logger.js';
import { getScenarioClothing } from './clothing.js';
import {
  clampMood,
  clampArousal,
  migrateLegacyArousalMax,
  effectiveArousalCeiling,
  effectiveArousalForBehavior,
} from './arousal-rules.js';

const _getState = db.prepare(
  'SELECT * FROM scenario_character_state WHERE scenario_id = ? AND character_id = ?'
);
const _listStates = db.prepare(
  'SELECT * FROM scenario_character_state WHERE scenario_id = ?'
);
const _getChar = db.prepare(
  'SELECT id, name, moodbaseline, arousalmax, arousalthreshold, arousallockeduntil, arousaltriggers, moodtriggerspos, moodtriggersneg FROM characters WHERE id = ?'
);
const _getCast = db.prepare(`
  SELECT c.id, c.name, c.moodbaseline, c.arousalmax, c.arousalthreshold, c.arousallockeduntil, c.arousaltriggers, c.moodtriggerspos, c.moodtriggersneg, c.is_user_character
  FROM characters c
  JOIN scenario_characters sc ON c.id = sc.character_id
  WHERE sc.scenario_id = ?
  ORDER BY c.name
`);

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

export function buildCastBehaviorBlock(characters, characterStates, options = {}) {
  const nsfwEnabled = options.nsfwEnabled !== false;
  const explicitMode = options.explicitMode !== false;
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
    const ceiling = effectiveArousalCeiling({
      arousalmax: c.arousalmax,
      nsfwEnabled,
      explicitMode,
      sfwArousalCeiling: options.sfwArousalCeiling,
    });
    const beh = effectiveArousalForBehavior({
      mood,
      arousal: raw,
      arousallockeduntil: c.arousallockeduntil,
      ceiling,
    });
    let effective = beh.effective;
    if (!nsfwEnabled) {
      effective = Math.min(effective, 3);
    }
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
  if (explicitMode && nsfwEnabled) {
    lines.push('At arousal 10, NPCs MUST initiate explicit sex acts in the narration - not merely desire them.');
  }
  return lines.join('\n');
}

export function buildEmotionalDirective(moodcurrent, arousalcurrent) {
  const mood = clampMood(moodcurrent);
  const arousal = clampArousal(arousalcurrent, 10);

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
  const mood = clampMood(char?.moodbaseline ?? 3);
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

export function updateScenarioCharacterStateManual(scenarioId, characterId, { moodcurrent, arousalcurrent, config } = {}) {
  const char = _getChar.get(characterId);
  ensureScenarioCharacterState(scenarioId, characterId);
  const mood = clampMood(moodcurrent);
  const ceiling = effectiveArousalCeiling({
    arousalmax: migrateLegacyArousalMax(char?.arousalmax),
    nsfwEnabled: config?.nsfw_enabled !== false,
    explicitMode: config?.explicit_mode !== false,
    sfwArousalCeiling: config?.sfw_arousal_ceiling,
  });
  const arousal = clampArousal(arousalcurrent, ceiling);
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

/**
 * Write the scene-state extractor's per-character mood/arousal to
 * scenario_character_state as ABSOLUTE values (not deltas). The extractor reads
 * the whole beat and reports where each character sits now, so there is no
 * momentum to accumulate - momentum columns are reset to 0. NSFW/SFW ceilings
 * and the mood-gate still apply (via arousal-rules) so the behavior bands the
 * narrator sees stay bounded.
 *
 * @param scenarioId
 * @param characterUpdates  [{ characterId, mood (1-5), arousal (1-10) }] from extractSceneState
 * @param config            resolveMasterConfig() output
 * @returns { characters: [{characterId,name,moodcurrent,arousalcurrent}], gates: [...] }
 */
export function applySceneStateToCharacters(scenarioId, characterUpdates, config = {}) {
  if (config.emotion_tracking_enabled === false) return { characters: [], gates: [] };
  if (!Array.isArray(characterUpdates) || !characterUpdates.length) return { characters: [], gates: [] };

  const castById = new Map(_getCast.all(scenarioId).map((c) => [c.id, c]));
  const changed = [];
  const gates = [];

  for (const u of characterUpdates) {
    const charId = Number(u.characterId);
    const char = castById.get(charId);
    if (!char) continue;

    const row = getScenarioCharacterState(scenarioId, charId) || ensureScenarioCharacterState(scenarioId, charId);

    const ceiling = effectiveArousalCeiling({
      arousalmax: migrateLegacyArousalMax(char.arousalmax),
      nsfwEnabled: config.nsfw_enabled !== false,
      explicitMode: config.explicit_mode !== false,
      sfwArousalCeiling: config.sfw_arousal_ceiling,
    });

    // The extractor reports an absolute read of the whole beat. Cap how far it
    // can move in one turn so a single over-read (a "flutter" scored as 8)
    // can't spike the state - it settles over a few turns instead.
    const AROUSAL_STEP = 3;
    const MOOD_STEP = 2;
    const wantMood = clampMood(u.mood);
    const wantArousal = clampArousal(u.arousal, ceiling);
    const newMood = Math.max(row.moodcurrent - MOOD_STEP, Math.min(row.moodcurrent + MOOD_STEP, wantMood));
    const newArousal = Math.max(row.arousalcurrent - AROUSAL_STEP, Math.min(row.arousalcurrent + AROUSAL_STEP, wantArousal));

    if (newMood === row.moodcurrent && newArousal === row.arousalcurrent) continue;

    db.prepare(`
      UPDATE scenario_character_state
      SET moodcurrent = ?, arousalcurrent = ?, mood_momentum = 0, arousal_momentum = 0,
          updated_at = datetime('now')
      WHERE scenario_id = ? AND character_id = ?
    `).run(newMood, newArousal, scenarioId, charId);

    const beh = effectiveArousalForBehavior({
      mood: newMood,
      arousal: newArousal,
      arousallockeduntil: char.arousallockeduntil,
      ceiling,
    });
    if (beh.gated) {
      gates.push({
        characterId: charId, name: char.name,
        moodcurrent: newMood, arousalcurrent: newArousal,
        effectiveArousal: beh.effective, reason: beh.reason,
      });
    }
    changed.push({ characterId: charId, name: char.name, moodcurrent: newMood, arousalcurrent: newArousal });
  }

  if (changed.length) {
    log('character-state', 'scene-state-applied', { scenarioId, count: changed.length });
  }
  return { characters: changed, gates };
}
