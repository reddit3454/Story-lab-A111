from pathlib import Path

ROOT = Path(r"E:/TheHub/projects/Story-lab-A111")

# db.js migration
dbp = ROOT / "src/db.js"
db = dbp.read_text(encoding="utf-8")
migration = """
migrate(`CREATE TABLE IF NOT EXISTS scenario_character_state (
  scenario_id       INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  character_id      INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  moodcurrent       INTEGER NOT NULL DEFAULT 3,
  arousalcurrent    INTEGER NOT NULL DEFAULT 1,
  mood_momentum     INTEGER NOT NULL DEFAULT 0,
  arousal_momentum  INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (scenario_id, character_id)
)`);
"""
if "scenario_character_state" not in db:
    db = db.replace(
        'migrate("CREATE UNIQUE INDEX IF NOT EXISTS idx_char_rel_global',
        migration + '\nmigrate("CREATE UNIQUE INDEX IF NOT EXISTS idx_char_rel_global',
    )
    dbp.write_text(db, encoding="utf-8")
    print("db.js ok")

# server.js
sp = ROOT / "src/server.js"
s = sp.read_text(encoding="utf-8")
if "character-states" not in s:
    s = s.replace(
        "import relationshipsRouter    from './routes/character-relationships.js';",
        "import relationshipsRouter    from './routes/character-relationships.js';\nimport characterStatesRouter    from './routes/character-states.js';",
    )
    s = s.replace(
        "app.use('/api/scenarios/:scenarioId/relationships', relationshipsRouter);",
        "app.use('/api/scenarios/:scenarioId/relationships', relationshipsRouter);\napp.use('/api/scenarios/:scenarioId/character-states', characterStatesRouter);",
    )
    sp.write_text(s, encoding="utf-8")
    print("server.js ok")

# scenario-characters.js
scp = ROOT / "src/routes/scenario-characters.js"
sc = scp.read_text(encoding="utf-8")
if "ensureScenarioCharacterState" not in sc:
    sc = sc.replace(
        "import db from '../db.js';",
        "import db from '../db.js';\nimport { ensureScenarioCharacterState, deleteScenarioCharacterState } from '../services/character-state.js';",
    )
    sc = sc.replace(
        "  db.prepare('INSERT OR IGNORE INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)')\n    .run(req.params.scenarioId, req.params.charId);\n  res.json({ ok: true });",
        "  db.prepare('INSERT OR IGNORE INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)')\n    .run(req.params.scenarioId, req.params.charId);\n  ensureScenarioCharacterState(parseInt(req.params.scenarioId, 10), parseInt(req.params.charId, 10));\n  res.json({ ok: true });",
    )
    sc = sc.replace(
        "  db.prepare('DELETE FROM scenario_characters WHERE scenario_id = ? AND character_id = ?')\n    .run(req.params.scenarioId, req.params.charId);\n  res.json({ ok: true });",
        "  const scenarioId = parseInt(req.params.scenarioId, 10);\n  const charId = parseInt(req.params.charId, 10);\n  db.prepare('DELETE FROM scenario_characters WHERE scenario_id = ? AND character_id = ?')\n    .run(scenarioId, charId);\n  deleteScenarioCharacterState(scenarioId, charId);\n  res.json({ ok: true });",
    )
    scp.write_text(sc, encoding="utf-8")
    print("scenario-characters.js ok")

# narrator.js
np = ROOT / "src/services/narrator.js"
n = np.read_text(encoding="utf-8")
if "buildEmotionalDirective" not in n:
    n = n.replace(
        "import { log, logError } from '../logger.js';",
        "import { log, logError } from '../logger.js';\nimport { ensureScenarioCharacterState, buildEmotionalDirective } from './character-state.js';",
    )
    n = n.replace(
        "export function buildSystemPrompt({ scenario, characters, location, rules, worldEntries, memories, relationships = [], lastArousal = 1 }) {",
        "export function buildSystemPrompt({ scenario, characters, location, rules, worldEntries, memories, relationships = [], lastArousal = 1, characterStates = {} }) {",
    )
    n = n.replace(
        "      const outfit = (c.current_clothing || c.base_clothing || '').trim();\n      if (outfit) s += `\\nCurrently wearing: ${outfit}`;\n      return s;",
        "      const outfit = (c.current_clothing || c.base_clothing || '').trim();\n      if (outfit) s += `\\nCurrently wearing: ${outfit}`;\n      const st = characterStates[c.id];\n      if (st) s += `\\n${buildEmotionalDirective(st.moodcurrent, st.arousalcurrent)}`;\n      return s;",
    )
    n = n.replace(
        "  const config       = resolveMasterConfig(db);\n  const backend      = await resolveNarratorBackend(db);\n  const systemPrompt = buildSystemPrompt({ scenario, characters, location, rules, worldEntries, memories, relationships, lastArousal });",
        "  const characterStates = {};\n  for (const c of characters) {\n    characterStates[c.id] = ensureScenarioCharacterState(scenario.id, c.id);\n  }\n\n  const config       = resolveMasterConfig(db);\n  const backend      = await resolveNarratorBackend(db);\n  const systemPrompt = buildSystemPrompt({ scenario, characters, location, rules, worldEntries, memories, relationships, lastArousal, characterStates });",
    )
    np.write_text(n, encoding="utf-8")
    print("narrator.js ok")

# turns.js
tp = ROOT / "src/routes/turns.js"
t = tp.read_text(encoding="utf-8")
if "processEmotionalUpdateAfterTurn" not in t:
    t = t.replace(
        "import { applyClothingChanges } from '../services/clothing.js';",
        "import { applyClothingChanges } from '../services/clothing.js';\nimport { processEmotionalUpdateAfterTurn } from '../services/character-state.js';",
    )
    t = t.replace(
        "      broadcast.send('turn_complete', { scenarioId: parseInt(scenarioId, 10), turn: finalNarratorTurn, clothing_updates: clothingUpdates });\n      return res.json({ user_turn: userTurn, narrator_turn: finalNarratorTurn, clothing_updates: clothingUpdates });",
        "      broadcast.send('turn_complete', { scenarioId: parseInt(scenarioId, 10), turn: finalNarratorTurn, clothing_updates: clothingUpdates });\n\n      const castChars = db.prepare('SELECT c.* FROM characters c JOIN scenario_characters sc ON c.id = sc.character_id WHERE sc.scenario_id = ?').all(scenarioId);\n      processEmotionalUpdateAfterTurn({\n        scenarioId: parseInt(scenarioId, 10),\n        narratorTurn: finalNarratorTurn,\n        characters: castChars,\n        config: resolveMasterConfig(db),\n      }).then(function (moodUpdates) {\n        if (moodUpdates.length) {\n          broadcast.send('moodupdate', { scenarioId: parseInt(scenarioId, 10), characters: moodUpdates });\n        }\n      }).catch(function (err) {\n        console.error('[turns] emotional update failed:', err.message);\n      });\n\n      return res.json({ user_turn: userTurn, narrator_turn: finalNarratorTurn, clothing_updates: clothingUpdates });",
    )
    tp.write_text(t, encoding="utf-8")
    print("turns.js ok")

# api.js
ap = ROOT / "public/js/api.js"
a = ap.read_text(encoding="utf-8")
if "getScenarioCharacterStates" not in a:
    a = a.replace(
        "    removeCharacterFromScenario: function (sid, charId) { return request('DELETE', '/api/scenarios/' + sid + '/characters/' + charId); },",
        "    removeCharacterFromScenario: function (sid, charId) { return request('DELETE', '/api/scenarios/' + sid + '/characters/' + charId); },\n\n    getScenarioCharacterStates:   function (sid) { return request('GET', '/api/scenarios/' + sid + '/character-states'); },\n    updateScenarioCharacterState: function (sid, charId, d) { return request('PUT', '/api/scenarios/' + sid + '/character-states/' + charId, d); },",
    )
    ap.write_text(a, encoding="utf-8")
    print("api.js ok")

print("backend patches done")
