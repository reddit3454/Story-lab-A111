from pathlib import Path
import re
p = Path(r"E:/TheHub/projects/Story-lab-A111/src/services/character-state.js")
t = p.read_text(encoding="utf-8")
t = re.sub(
    r"return lines\.join\('\s*\r?\n'\);",
    "return lines.join('\\n');",
    t,
)
p.write_text(t, encoding="utf-8")
print("fixed")
