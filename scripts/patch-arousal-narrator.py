from pathlib import Path

p = Path(r"E:/TheHub/projects/Story-lab-A111/src/services/narrator.js")
t = p.read_text(encoding="utf-8")

t = t.replace(
    "import { ensureScenarioCharacterState, buildEmotionalDirective } from './character-state.js';",
    "import { ensureScenarioCharacterState, buildEmotionalDirective, buildCastBehaviorBlock } from './character-state.js';",
)

if "buildCastBehaviorBlock(characters" not in t:
    t = t.replace(
        "    parts.push(`Characters:\\n${block}`);\n  }\n\n  // 4. Active location",
        "    parts.push(`Characters:\\n${block}`);\n  }\n\n  const behaviorBlock = buildCastBehaviorBlock(characters, characterStates);\n  if (behaviorBlock) parts.push(behaviorBlock);\n\n  // 4. Active location",
    )

t = t.replace(
    "  // 12. Arousal continuity\n  parts.push(`Current arousal level: ${lastArousal}/10. Maintain narrative continuity from this baseline.`);\n",
    "  // 12. Scene arousal is secondary to per-character arousal in CHARACTER AROUSAL AND ACTION\n  if (lastArousal > 1) {\n    parts.push(`Scene intensity baseline: ${lastArousal}/10. Per-character arousal rules above take priority for NPC actions.`);\n  }\n",
)

# Strengthen scene card instruction for arousal in image_prompt
old_sc = '"arousal_level": <1-10>,'
new_sc = '"arousal_level": <1-10 - match the highest present NPC arousal or the scene heat>,'
if old_sc in t:
    t = t.replace(old_sc, new_sc)

if "NPC physical actions must reflect" not in t:
    t = t.replace(
        "SCENE CARD RULES:",
        "SCENE CARD RULES:\n- NPC physical actions in image_prompt must reflect their current arousal (touching, nudity, poses, proximity).",
    )

p.write_text(t, encoding="utf-8")
print("narrator.js ok")
