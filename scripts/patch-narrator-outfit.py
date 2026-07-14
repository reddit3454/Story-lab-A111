from pathlib import Path
p = Path(r"E:/TheHub/projects/Story-lab-A111/src/services/narrator.js")
t = p.read_text(encoding="utf-8")
old = "      if (c.current_clothing)  s += `\\nCurrently wearing: ${c.current_clothing}`;"
new = "      const outfit = (c.current_clothing || c.base_clothing || '').trim();\n      if (outfit) s += `\\nCurrently wearing: ${outfit}`;"
if old in t:
    t = t.replace(old, new)
    p.write_text(t, encoding="utf-8")
    print("narrator.js ok")
