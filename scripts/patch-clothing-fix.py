# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"E:/TheHub/projects/Story-lab-A111")

# --- clothing.js ---
clothing_path = ROOT / "src/services/clothing.js"
clothing = clothing_path.read_text(encoding="utf-8")
old_apply = """export function applyClothingChanges(db, scenarioId, clothingChanges) {
  if (!Array.isArray(clothingChanges) || !clothingChanges.length) return;
  const castRows = db.prepare(`"""
if "return updates;" not in clothing:
    clothing = clothing.replace(
        "export function applyClothingChanges(db, scenarioId, clothingChanges) {\n  if (!Array.isArray(clothingChanges) || !clothingChanges.length) return;",
        "export function applyClothingChanges(db, scenarioId, clothingChanges) {\n  if (!Array.isArray(clothingChanges) || !clothingChanges.length) return [];",
    )
    clothing = clothing.replace(
        "  const nameToId = {};\n  for (const c of castRows) nameToId[c.name.toLowerCase()] = c.id;\n  for (const change of clothingChanges) {\n    const charId = change.character_id\n      ?? nameToId[(change.character_name || '').toLowerCase()];\n    if (charId && change.new_clothing) {\n      _updateClothing.run(change.new_clothing, charId);\n    }\n  }\n}",
        "  const nameToId = {};\n  for (const c of castRows) nameToId[c.name.toLowerCase()] = c.id;\n  const updates = [];\n  for (const change of clothingChanges) {\n    const charId = change.character_id\n      ?? nameToId[(change.character_name || '').toLowerCase()];\n    if (charId && change.new_clothing) {\n      const newClothing = String(change.new_clothing).trim();\n      if (!newClothing) continue;\n      _updateClothing.run(newClothing, charId);\n      updates.push({ characterId: charId, current_clothing: newClothing });\n    }\n  }\n  return updates;\n}",
    )
    clothing_path.write_text(clothing, encoding="utf-8")
    print("clothing.js ok")

# --- turns.js ---
turns_path = ROOT / "src/routes/turns.js"
turns = turns_path.read_text(encoding="utf-8")
if "clothing_updates" not in turns:
    turns = turns.replace(
        "      // Apply clothing changes declared in scene card\n      applyClothingChanges(db, scenarioId, result.scene_card?.clothing_changes);",
        "      // Apply clothing changes declared in scene card\n      const clothingUpdates = applyClothingChanges(db, scenarioId, result.scene_card?.clothing_changes);\n      if (clothingUpdates.length) {\n        broadcast.send('clothingupdate', { scenarioId: parseInt(scenarioId, 10), characters: clothingUpdates });\n      }",
    )
    turns = turns.replace(
        "      broadcast.send('turn_complete', { scenarioId: parseInt(scenarioId, 10), turn: finalNarratorTurn });\n      return res.json({ user_turn: userTurn, narrator_turn: finalNarratorTurn });",
        "      broadcast.send('turn_complete', { scenarioId: parseInt(scenarioId, 10), turn: finalNarratorTurn, clothing_updates: clothingUpdates });\n      return res.json({ user_turn: userTurn, narrator_turn: finalNarratorTurn, clothing_updates: clothingUpdates });",
    )
    turns_path.write_text(turns, encoding="utf-8")
    print("turns.js ok")

# --- characters.js PATCH clothing ---
chars_path = ROOT / "src/routes/characters.js"
chars = chars_path.read_text(encoding="utf-8")
if "broadcast.send('clothingupdate'" not in chars:
    if "import broadcast" not in chars:
        chars = chars.replace("import db from '../db.js';", "import db from '../db.js';\nimport broadcast from '../broadcast.js';")
    chars = chars.replace(
        """router.patch('/:id/clothing', function (req, res) {
  const { current_clothing } = req.body;
  db.prepare('UPDATE characters SET current_clothing = ? WHERE id = ?')
    .run(current_clothing ?? '', req.params.id);
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  res.json(row);
});""",
        """router.patch('/:id/clothing', function (req, res) {
  const charId = parseInt(req.params.id, 10);
  const { current_clothing, scenario_id } = req.body || {};
  const clothing = String(current_clothing ?? '').trim();
  db.prepare('UPDATE characters SET current_clothing = ? WHERE id = ?').run(clothing, charId);
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  if (scenario_id) {
    broadcast.send('clothingupdate', {
      scenarioId: parseInt(scenario_id, 10),
      characters: [{ characterId: charId, current_clothing: clothing }],
    });
  }
  res.json(row);
});""",
    )
    chars_path.write_text(chars, encoding="utf-8")
    print("characters.js ok")

# --- play.js ---
play_path = ROOT / "public/js/views/play.js"
play = play_path.read_text(encoding="utf-8")

play = play.replace(
    "      if (c.current_clothing) state.characterStates[c.id].current_clothing = c.current_clothing;\n      state.characterStates[c.id].base_clothing = c.base_clothing || '';",
    "      state.characterStates[c.id].current_clothing = String(c.current_clothing || c.base_clothing || '').trim();\n      state.characterStates[c.id].base_clothing = c.base_clothing || '';",
)

play = play.replace(
    "  API.updateCharacterClothing(scenId, charId, { current_clothing: newVal })",
    "  API.updateCharacterClothing(charId, { current_clothing: newVal, scenario_id: scenId })",
)

play = play.replace(
    "      API.updateCharacterClothing(charId, { current_clothing: baseVal })",
    "      API.updateCharacterClothing(charId, { current_clothing: baseVal, scenario_id: state.currentScenario && state.currentScenario.id })",
)

old_build = """  var clothing = cs && cs.current_clothing ? String(cs.current_clothing).trim() : '';
  var base     = cs && cs.base_clothing   ? String(cs.base_clothing).trim()    : '';
  var canReset = base && clothing && base !== clothing;
  return '<div class="clothing-state-wrap" data-char-id="' + charId + '" data-base-clothing="' + escapeHtml(base) + '"' +
    (clothing ? '' : ' style="display:none"') + '>' +
    '<span class="clothing-state-text" title="' + (clothing ? 'Current clothing: ' + escapeHtml(clothing) : '') + '">' +
    escapeHtml(clothing) + '</span>' +"""

new_build = """  var clothing = cs && cs.current_clothing ? String(cs.current_clothing).trim() : '';
  var base     = cs && cs.base_clothing   ? String(cs.base_clothing).trim()    : '';
  var canReset = base && clothing && base !== clothing;
  var display  = clothing || 'not set';
  return '<div class="clothing-state-wrap" data-char-id="' + charId + '" data-base-clothing="' + escapeHtml(base) + '">' +
    '<span class="clothing-state-text' + (clothing ? '' : ' text-muted') + '" title="' + (clothing ? 'Current clothing: ' + escapeHtml(clothing) : 'No clothing set') + '">' +
    escapeHtml(display) + '</span>' +"""

if old_build in play:
    play = play.replace(old_build, new_build)

old_handle = """function handleClothingUpdate(data) {
  if (!data || !Array.isArray(data.characters)) return;
  if (!state.currentScenario || state.currentScenario.id !== data.scenarioId) return;
  data.characters.forEach(function (c) {
    if (!state.characterStates[c.characterId]) state.characterStates[c.characterId] = {};
    state.characterStates[c.characterId].current_clothing = c.current_clothing || null;
    var clothing = (c.current_clothing || '').trim();
    document.querySelectorAll('.clothing-state-wrap[data-char-id="' + c.characterId + '"]').forEach(function (el) {
      el.style.display = clothing ? '' : 'none';
      var span = el.querySelector('.clothing-state-text');
      if (span) {
        span.textContent = clothing;
        span.title = clothing ? 'Current clothing: ' + clothing : '';
      }
    });
  });
}"""

new_handle = """function handleClothingUpdate(data) {
  if (!data || !Array.isArray(data.characters)) return;
  if (!state.currentScenario || Number(state.currentScenario.id) !== Number(data.scenarioId)) return;
  data.characters.forEach(function (c) {
    var charId = c.characterId;
    if (!charId) return;
    if (!state.characterStates[charId]) state.characterStates[charId] = {};
    var clothing = String(c.current_clothing || '').trim();
    state.characterStates[charId].current_clothing = clothing;
    document.querySelectorAll('.clothing-state-wrap[data-char-id="' + charId + '"]').forEach(function (el) {
      _restoreClothingWrap(el, charId, clothing);
    });
  });
}"""

if old_handle in play:
    play = play.replace(old_handle, new_handle)

play = play.replace(
    "    refreshPromptPreview();\n  } catch (err) {\n    console.error('[play] ingestTurnResponse failed:', err);",
    "    if (response.clothing_updates && response.clothing_updates.length && state.currentScenario) {\n      handleClothingUpdate({ scenarioId: state.currentScenario.id, characters: response.clothing_updates });\n    }\n    refreshPromptPreview();\n  } catch (err) {\n    console.error('[play] ingestTurnResponse failed:', err);",
)

play = play.replace(
    """      case 'turn_complete': {
        var tcPayload = data.payload || data;
        ingestNarratorTurnFromWs(tcPayload.turn, tcPayload.scenarioId);
        break;
      }""",
    """      case 'turn_complete': {
        var tcPayload = data.payload || data;
        if (tcPayload.clothing_updates && tcPayload.clothing_updates.length) {
          handleClothingUpdate({ scenarioId: tcPayload.scenarioId, characters: tcPayload.clothing_updates });
        }
        ingestNarratorTurnFromWs(tcPayload.turn, tcPayload.scenarioId);
        break;
      }""",
)

play = play.replace(
    """      case 'clothingupdate':
        if (state.currentScenario && data.scenarioId === state.currentScenario.id) {
          handleClothingUpdate(data);
          if (state.currentSidebarTab === 'clothing') {
            loadSidebarTab('clothing', data.scenarioId);
          }
        }
        break;""",
    """      case 'clothingupdate': {
        var cuPayload = data.payload || data;
        if (state.currentScenario && Number(cuPayload.scenarioId) === Number(state.currentScenario.id)) {
          handleClothingUpdate(cuPayload);
        }
        break;
      }""",
)

old_restore_end = """  wrap.style.display = clothing ? '' : 'none';
}"""

new_restore_end = """  wrap.style.display = '';
}"""

# only replace in _restoreClothingWrap - be specific
play = play.replace(
    """function _restoreClothingWrap(wrap, charId, clothing) {
  var base     = wrap.getAttribute('data-base-clothing') || '';
  var canReset = base && clothing && base !== clothing;
  wrap.setAttribute('data-base-clothing', base);
  wrap.innerHTML =
    '<span class="clothing-state-text" title="' + (clothing ? 'Current clothing: ' + escapeHtml(clothing) : '') + '">' +
    escapeHtml(clothing) + '</span>' +
    '<button class="clothing-edit-btn" title="Override clothing" type="button">&#9998;</button>' +
    (canReset ? '<button class="clothing-reset-btn" title="Reset to base outfit" type="button">&#8635;</button>' : '');
  wrap.style.display = clothing ? '' : 'none';
}""",
    """function _restoreClothingWrap(wrap, charId, clothing) {
  var base     = wrap.getAttribute('data-base-clothing') || '';
  var canReset = base && clothing && base !== clothing;
  var display  = clothing || 'not set';
  wrap.setAttribute('data-base-clothing', base);
  wrap.innerHTML =
    '<span class="clothing-state-text' + (clothing ? '' : ' text-muted') + '" title="' + (clothing ? 'Current clothing: ' + escapeHtml(clothing) : 'No clothing set') + '">' +
    escapeHtml(display) + '</span>' +
    '<button class="clothing-edit-btn" title="Override clothing" type="button">&#9998;</button>' +
    (canReset ? '<button class="clothing-reset-btn" title="Reset to base outfit" type="button">&#8635;</button>' : '');
  wrap.style.display = '';
}""",
)

play_path.write_text(play, encoding="utf-8")
print("play.js ok")
print("done")
