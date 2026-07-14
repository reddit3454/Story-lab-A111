from pathlib import Path
p = Path(r"E:/TheHub/projects/Story-lab-A111/src/services/character-state.js")
t = p.read_text(encoding="utf-8")

t = t.replace(
    "  9: 'MUST drive escalation: foreplay-level actions, demanding contact, thin restraint in words and deeds.',\n  10: 'MUST act on impulse: explicit sexual initiative matching the scene. No polite deflection unless personality forbids it.',",
    "  9: 'MUST drive escalation: foreplay-level actions, demanding contact, thin restraint in words and deeds.',\n  10: 'MUST initiate sex acts now - not hints or teasing. Start or demand penetration, oral, manual sex, or equivalent explicit act in the scene. No waiting, no polite deflection, no fade-to-black unless personality explicitly forbids it.',",
)

t = t.replace(
    "  lines.push('Do NOT write high-arousal NPCs as emotionally flat or purely conversational. They must ACT on their arousal level.');",
    "  lines.push('Do NOT write high-arousal NPCs as emotionally flat or purely conversational. They must ACT on their arousal level.');\n  lines.push('At arousal 10, NPCs MUST initiate explicit sex acts in the narration - not merely desire them.');",
)

t = t.replace(
    "    10: 'no restraint left; acts on impulse; every movement and word flows from arousal alone',",
    "    10: 'no restraint left; initiates explicit sex acts; every movement and word pushes toward intercourse or equivalent',",
)

p.write_text(t, encoding="utf-8")
print("ok")
