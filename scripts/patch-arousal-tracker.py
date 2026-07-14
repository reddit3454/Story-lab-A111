from pathlib import Path
p = Path(r"E:/TheHub/projects/Story-lab-A111/src/services/character-state.js")
t = p.read_text(encoding="utf-8")
old = "'arousalDelta: activation level - NOT limited to sexual content (tension, excitement, flirtation, adrenaline, calm).',"
new = "'arousalDelta: activation level - rises when a character flirts, touches, undresses, or escalates sexually in the narrator text.',"
if old in t:
    t = t.replace(old, new)
    t = t.replace(
        "'Use 0 only if the beat has no discernible impact on that character.',",
        "'Use +1 or +2 when the character initiated touch, showed desire, or escalated physically. Use 0 only if unaffected.',",
    )
    p.write_text(t, encoding="utf-8")
    print("tracker prompt ok")
