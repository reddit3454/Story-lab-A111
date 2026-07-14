from pathlib import Path

p = Path(r"E:/TheHub/projects/Story-lab-A111/src/services/character-state.js")
t = p.read_text(encoding="utf-8")

if "buildCastBehaviorBlock" in t:
    print("already patched")
    raise SystemExit(0)

insert_after_clamp = """function _clampArousal(v, max) {
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
  10: 'MUST act on impulse: explicit sexual initiative matching the scene. No polite deflection unless personality forbids it.',
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
    block += `\\nRequired behavior: ${actionLine}`;
    if (c.arousaltriggers && String(c.arousaltriggers).trim() && effective >= 3) {
      block += `\\nEscalation triggers: ${String(c.arousaltriggers).trim()}`;
    }
    lines.push(block);
    lines.push('');
  }

  lines.push('Do NOT write high-arousal NPCs as emotionally flat or purely conversational. They must ACT on their arousal level.');
  return lines.join('\\n');
}
"""

t = t.replace(
    """function _clampArousal(v, max) {
  const ceiling = Math.min(10, Math.max(1, Number(max) || 10));
  return Math.min(ceiling, Math.max(1, Math.round(Number(v) || 1)));
}

export function buildEmotionalDirective""",
    insert_after_clamp + "\nexport function buildEmotionalDirective",
)

# Fix escaped newlines in buildCastBehaviorBlock - I used \\n in the string wrong for Python
t = t.replace("block += `\\nRequired behavior:", "block += `\nRequired behavior:")
t = t.replace("block += `\\nEscalation triggers:", "block += `\nEscalation triggers:")
t = t.replace("return lines.join('\\n');", "return lines.join('\n');")

# Expand _getCast to include arousal profile fields
t = t.replace(
    """  SELECT c.id, c.name, c.moodbaseline, c.arousalmax
  FROM characters c""",
    """  SELECT c.id, c.name, c.moodbaseline, c.arousalmax, c.arousallockeduntil, c.arousaltriggers, c.is_user_character
  FROM characters c""",
)

p.write_text(t, encoding="utf-8")
print("character-state.js ok")
