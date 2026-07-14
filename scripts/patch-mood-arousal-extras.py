from pathlib import Path

# Broadcast on manual mood PUT
cp = Path(r"E:/TheHub/projects/Story-lab-A111/src/routes/character-states.js")
c = cp.read_text(encoding="utf-8")
if "broadcast.send('moodupdate'" not in c:
    c = c.replace("import db from '../db.js';", "import db from '../db.js';\nimport broadcast from '../broadcast.js';")
    c = c.replace(
        "    res.json({\n      characterId,\n      name: char?.name || '',\n      moodcurrent: row.moodcurrent,\n      arousalcurrent: row.arousalcurrent,\n    });",
        "    const payload = {\n      characterId,\n      name: char?.name || '',\n      moodcurrent: row.moodcurrent,\n      arousalcurrent: row.arousalcurrent,\n    };\n    broadcast.send('moodupdate', { scenarioId, characters: [payload] });\n    res.json(payload);",
    )
    cp.write_text(c, encoding="utf-8")
    print("character-states broadcast ok")

# image-pipeline: use per-character arousal for character mode
ip = Path(r"E:/TheHub/projects/Story-lab-A111/src/services/image-pipeline.js")
ipt = ip.read_text(encoding="utf-8")
if "getScenarioCharacterState" not in ipt:
    ipt = ipt.replace(
        "import broadcast from '../broadcast.js';",
        "import broadcast from '../broadcast.js';\nimport { getScenarioCharacterState } from './character-state.js';",
    )
    ipt = ipt.replace(
        "      const arousalLevel  = sceneCard?.arousal_level ?? 1;",
        "      const charState = (mode === 'character' && characterId) ? getScenarioCharacterState(scenarioId, characterId) : null;\n      const arousalLevel  = charState?.arousalcurrent ?? sceneCard?.arousal_level ?? 1;",
    )
    ip.write_text(ipt, encoding="utf-8")
    print("image-pipeline ok")
