from pathlib import Path

p = Path(r"E:/TheHub/projects/Story-lab-A111/public/js/views/play.js")
t = p.read_text(encoding="utf-8")

# _loadCharacterStates
t = t.replace(
    "function _loadCharacterStates() {\n  return Promise.resolve(); // no character-states endpoint in this version\n}",
    "function _loadCharacterStates(scenarioId) {\n  if (!scenarioId) return Promise.resolve();\n  return API.getScenarioCharacterStates(scenarioId).then(function (data) {\n    var states = (data && data.states) || [];\n    states.forEach(function (s) {\n      if (!state.characterStates[s.characterId]) state.characterStates[s.characterId] = {};\n      state.characterStates[s.characterId].moodcurrent = s.moodcurrent;\n      state.characterStates[s.characterId].arousalcurrent = s.arousalcurrent;\n    });\n  }).catch(function (err) {\n    console.warn('[play] character states load failed', err);\n  });\n}",
)

# renderCastTab - load states before rendering
t = t.replace(
    "function renderCastTab(container, scenarioId) {\n  API.getScenarioCharacters(scenarioId).then(function (data) {",
    "function renderCastTab(container, scenarioId) {\n  _loadCharacterStates(scenarioId).then(function () {\n    return API.getScenarioCharacters(scenarioId);\n  }).then(function (data) {",
)

# init characterStates in cast loop
t = t.replace(
    "    chars.forEach(function (c) {\n      if (!state.characterStates[c.id]) state.characterStates[c.id] = {};\n      state.characterStates[c.id].current_clothing = String(c.current_clothing || c.base_clothing || '').trim();\n      state.characterStates[c.id].base_clothing = c.base_clothing || '';\n    });",
    "    chars.forEach(function (c) {\n      if (!state.characterStates[c.id]) state.characterStates[c.id] = {};\n      state.characterStates[c.id].current_clothing = String(c.current_clothing || c.base_clothing || '').trim();\n      state.characterStates[c.id].base_clothing = c.base_clothing || '';\n      if (state.characterStates[c.id].moodcurrent == null) state.characterStates[c.id].moodcurrent = c.moodbaseline != null ? c.moodbaseline : 3;\n      if (state.characterStates[c.id].arousalcurrent == null) state.characterStates[c.id].arousalcurrent = 1;\n    });",
)

# mood +/- save to API
old_mood = """      var updated = { moodcurrent: cs.moodcurrent, arousalcurrent: cs.arousalcurrent };
      updated[field === 'mood' ? 'moodcurrent' : 'arousalcurrent'] = newVal;
      state.characterStates[charId] = updated;
      document.querySelectorAll('.mood-bars[data-char-id=\"' + charId + '\"]').forEach(function (el) {
        el.outerHTML = _buildMoodBarsHtml(charId);
      });
    });"""

new_mood = """      var updated = { moodcurrent: cs.moodcurrent, arousalcurrent: cs.arousalcurrent };
      updated[field === 'mood' ? 'moodcurrent' : 'arousalcurrent'] = newVal;
      state.characterStates[charId] = updated;
      document.querySelectorAll('.mood-bars[data-char-id=\"' + charId + '\"]').forEach(function (el) {
        el.outerHTML = _buildMoodBarsHtml(charId);
      });
      API.updateScenarioCharacterState(scenarioId, charId, {
        moodcurrent: updated.moodcurrent,
        arousalcurrent: updated.arousalcurrent
      }).catch(function (err) {
        state.characterStates[charId][field === 'mood' ? 'moodcurrent' : 'arousalcurrent'] = current;
        document.querySelectorAll('.mood-bars[data-char-id=\"' + charId + '\"]').forEach(function (el) {
          el.outerHTML = _buildMoodBarsHtml(charId);
        });
        showToast('Failed to update mood: ' + err.message, 'error');
      });
    });"""

if old_mood in t:
    t = t.replace(old_mood, new_mood)

# handleMoodUpdate scenarioId compare
t = t.replace(
    "  if (!state.currentScenario || state.currentScenario.id !== data.scenarioId) return;",
    "  if (!state.currentScenario || Number(state.currentScenario.id) !== Number(data.scenarioId)) return;",
)

# WS moodupdate handler - use handleMoodUpdate with payload
old_ws = """      case 'moodupdate':
        if (!Array.isArray(data.characters)) break;
        data.characters.forEach(function (c) {
          if (!state.characterStates) state.characterStates = {};
          state.characterStates[c.characterId] = {
            moodcurrent:    c.moodcurrent,
            arousalcurrent: c.arousalcurrent
          };
          document.querySelectorAll('.mood-bars[data-char-id=\"' + c.characterId + '\"]').forEach(function (el) {
            if (window._buildMoodBarsHtml) el.outerHTML = window._buildMoodBarsHtml(c.characterId);
          });
        });
        break;"""

new_ws = """      case 'moodupdate': {
        var muPayload = data.payload || data;
        if (state.currentScenario && Number(muPayload.scenarioId) === Number(state.currentScenario.id)) {
          handleMoodUpdate(muPayload);
        }
        break;
      }"""

if old_ws in t:
    t = t.replace(old_ws, new_ws)

p.write_text(t, encoding="utf-8")
print("play.js ok")
