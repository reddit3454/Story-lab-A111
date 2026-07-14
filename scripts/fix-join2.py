from pathlib import Path
p = Path(r"E:/TheHub/projects/Story-lab-A111/src/services/character-state.js")
lines = p.read_text(encoding="utf-8").splitlines()
out = []
i = 0
while i < len(lines):
    if lines[i].strip() == "return lines.join('" and i + 1 < len(lines) and lines[i+1].strip() == "');":
        out.append("  return lines.join('\\n');")
        i += 2
        continue
    out.append(lines[i])
    i += 1
p.write_text("\n".join(out) + "\n", encoding="utf-8")
print("fixed")
