from pathlib import Path
p = Path(r"E:/TheHub/projects/Story-lab-A111/public/js/views/play.js")
t = p.read_text(encoding="utf-8")
old = "  var current  = span ? span.textContent.trim() : '';"
new = old + "\n  if (current === 'not set') current = '';"
if "if (current === 'not set')" not in t:
    t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")
    print("ok")
