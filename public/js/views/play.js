import { state, chatColors, getNpcColor } from '../state.js';
import { escapeHtml, formatStoryContent, formatNarratorLinesWithGutter, narratorResponseLabel, avatarHtml, groupAcceptedImagesByTurn, renderAcceptedStoryImages, buildImageGenerationOptions } from '../utils.js';
import { showToast, showConfirm, setLoading, statusDotsHtml } from '../ui.js';

var _ws = null;
var _turnInFlight = false;
var _turnPollTimer = null;
var _lastIngestedNarratorId = null;
var _wsRetryDelay = 2000;
var _updateScenePresent   = null;
var _cachedRelationships = [];
var _playConfig = {};

function deriveSceneHeat(states) {
  var maxA = 1, label = 'Calm';
  (states || []).forEach(function (s) {
    var a = +s.arousalcurrent || 1;
    if (a > maxA) maxA = a;
  });
  if (maxA >= 9) label = 'Explicit';
  else if (maxA >= 7) label = 'Intense';
  else if (maxA >= 5) label = 'Desire';
  else if (maxA >= 3) label = 'Warm';
  return { level: maxA, label: label };
}

function _playConfigEnabled(key, defaultOn) {
  if (!_playConfig || _playConfig[key] == null) return defaultOn !== false;
  var v = _playConfig[key];
  return v === true || v === 'true' || v === 1 || v === '1';
}

function formatRelationshipFocusLine(r) {
  if (!r) return '';
  var tags = r.tags || [];
  var tagPart = tags.length ? ' (' + tags.join(', ') + ')' : '';
  var strength = Math.min(5, Math.max(1, Math.round(Number(r.strength) || 3)));
  var line = (r.from_name || '?') + ' -> ' + (r.to_name || '?') + ': ' + (r.relationship_type || 'friend') + tagPart + ' [intensity ' + strength + '/5]';
  if (r.description && String(r.description).trim()) line += ' (' + String(r.description).trim() + ')';
  return line;
}

function _mergeScenarioRelationships(globals, scenarioRels, charIds) {
  var map = {};
  (globals || []).forEach(function (r) {
    if (!charIds.has(r.from_character_id) || !charIds.has(r.to_character_id)) return;
    map[r.from_character_id + '->' + r.to_character_id] = Object.assign({}, r, { _source: 'global' });
  });
  (scenarioRels || []).forEach(function (r) {
    if (!charIds.has(r.from_character_id) || !charIds.has(r.to_character_id)) return;
    map[r.from_character_id + '->' + r.to_character_id] = Object.assign({}, r, { _source: 'scenario' });
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

function _findRelationshipBetween(rels, fromId, toId) {
  return (rels || []).find(function (r) {
    return Number(r.from_character_id) === Number(fromId) && Number(r.to_character_id) === Number(toId);
  }) || (rels || []).find(function (r) {
    return Number(r.from_character_id) === Number(toId) && Number(r.to_character_id) === Number(fromId);
  }) || null;
}

function refreshSceneHeatReadout() {
  if (!_playConfigEnabled('scene_heat_readout_enabled', true)) return;
  var heatEl = document.getElementById('cast-scene-heat');
  if (!heatEl) return;
  var states = Object.keys(state.characterStates || {}).map(function (id) { return state.characterStates[id]; });
  var heat = deriveSceneHeat(states);
  heatEl.textContent = 'Scene heat: ' + heat.label + ' (' + heat.level + '/10)';
}

function _buildTriggerChipsHtml(c) {
  if (!_playConfigEnabled('cast_trigger_chips_enabled', true)) return '';
  var chips = [];
  function addList(text, cls) {
    if (!text) return;
    String(text).split(/[,;\n]+/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var display = part.length > 40 ? part.slice(0, 40) + '...' : part;
      chips.push('<span class="cast-trigger-chip ' + cls + '" style="font-size:10px;padding:1px 5px;border-radius:8px;background:var(--bg-secondary);color:var(--text-muted)" title="' + escapeHtml(part) + '">' + escapeHtml(display) + '</span>');
    });
  }
  addList(c.moodtriggerspos, 'chip-pos');
  addList(c.moodtriggersneg, 'chip-neg');
  addList(c.arousaltriggers, 'chip-arousal');
  return chips.length ? '<div class="cast-trigger-chips" style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">' + chips.join('') + '</div>' : '';
}

function _buildBondFocusHtml(charId, chars, rels) {
  var parts = [];
  (chars || []).forEach(function (other) {
    if (Number(other.id) === Number(charId)) return;
    var rel = _findRelationshipBetween(rels, charId, other.id);
    if (!rel) return;
    var focusText = formatRelationshipFocusLine(rel);
    parts.push('<button type="button" class="btn btn-ghost btn-xs bond-focus-btn" data-focus-text="' + escapeHtml(focusText) + '" title="Set guidance from bond">Focus ' + escapeHtml(other.name) + '</button>');
  });
  return parts.length ? '<div class="cast-bond-focus" style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">' + parts.join('') + '</div>' : '';
}



export function initPlay(scenarioId) {
  if (!scenarioId) { location.hash = '#dashboard'; return; }
  if (state.currentSidebarTab === 'clothing') state.currentSidebarTab = 'memory';

  var el = document.getElementById('view-play');
  el.innerHTML =
    '<div class="play-topbar">' +
      '<div class="topbar-left">' +
        '<a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Stories</a>' +
        statusDotsHtml() +
      '</div>' +
      '<span class="play-title story-font" id="play-scenario-title">Loading...</span>' +
      '<div class="topbar-right">' +
        '<button class="btn btn-ghost btn-sm" id="btn-scene-info">Scene Info</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-reset-scene">Reset Scene</button>' +
        '<button class="btn btn-danger btn-sm" id="btn-end-story">End Story</button>' +
      '</div>' +
    '</div>' +

    '<div class="play-container layout-' + state.playLayout + '" id="play-container">' +

      /* Sidebar */
      '<div class="play-sidebar' + (state.sidebarOpen ? '' : ' collapsed') + '" id="play-sidebar">' +
        '<div class="sidebar-tabs" id="sidebar-tabs">' +
          ['memory','lore','rules','cast','rel','loc'].map(function (t) {
            var label = t === 'rel' ? 'Rels' : t === 'loc' ? 'Place' : t[0].toUpperCase() + t.slice(1);
            return '<button class="stab' + (state.currentSidebarTab===t?' active':'') + '" data-tab="' + t + '">' + label + '</button>';
          }).join('') +
        '</div>' +
        '<button class="sidebar-toggle-btn" id="sidebar-toggle">' + (state.sidebarOpen ? '&laquo;' : '&raquo;') + '</button>' +
        '<div id="sidebar-content" class="sidebar-content"></div>' +
        '<div class="sidebar-resize-handle" id="sidebar-resize-handle"></div>' +
      '</div>' +

      /* Thread */
      '<div class="play-thread-wrap">' +
        '<div class="play-thread" id="play-thread"><div class="loading-state">Loading story...</div></div>' +
        '<div class="play-input-area">' +
          '<div class="guidance-bar" id="guidance-bar">' +
            '<div class="guidance-row">' +
              '<div class="guidance-input-wrap">' +
                '<textarea class="guidance-input" id="guidance-input" placeholder="Guidance (optional) — steer what happens next..." rows="2" autocomplete="off"></textarea>' +
                '<button class="btn btn-ghost btn-sm guidance-enhance-btn" id="btn-enhance-guidance" title="Enhance guidance with AI">Enhance</button>' +
              '</div>' +
              '<button class="lock-toggle" id="lock-toggle" title="Lock: guidance becomes the literal submission" aria-pressed="false">' +
                '<span class="lock-icon">&#128275;</span>' +
              '</button>' +
            '</div>' +
            '<div class="focus-action-row" id="focus-action-row">' +
              '<div id="char-focus-btns" class="char-focus-btns"></div>' +
              '<div class="focus-fixed-btns">' +
                '<button class="focus-btn focus-btn-narrator" id="btn-narrator" title="Write a pure narration beat">Narrator</button>' +
                '<button class="focus-btn focus-btn-continue" id="btn-continue" title="AI picks who responds next">Continue →</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* Image generator — page-level right sidebar (not inside turn cards) */
      '<aside class="play-image-sidebar" id="play-image-sidebar" aria-hidden="true">' +
        '<div class="play-image-sidebar-header">' +
          '<div class="play-image-sidebar-heading">' +
            '<span class="play-image-sidebar-title">Image</span>' +
            '<span class="play-image-sidebar-turn" id="img-sidebar-turn-label"></span>' +
          '</div>' +
          '<button type="button" class="play-image-sidebar-close" id="img-sidebar-close" title="Close image panel">&times;</button>' +
        '</div>' +
        '<div class="play-image-sidebar-body">' +
          '<label class="play-image-sidebar-label" for="img-sidebar-action">Scene description (editable)</label>' +
          '<p class="play-image-sidebar-hint" id="img-sidebar-action-hint">Describe only what should be visible. Style comes from the selected Look.</p>' +
          '<div id="img-sidebar-shot-loading" class="play-image-shot-loading hidden" aria-live="polite">Loading scene description...</div>' +
          '<textarea id="img-sidebar-action" class="turn-image-action" rows="4" placeholder="Describe what should be visible in this shot..."></textarea>' +
          '<div id="img-sidebar-scene-subjects" class="hidden"><label class="play-image-sidebar-label">Subjects in this image</label><div id="img-sidebar-subject-chips"></div><p class="play-image-sidebar-hint">Choose up to two people for a clearer action scene.</p></div>' +
          '<div id="img-sidebar-framing-wrap"><label class="play-image-sidebar-label" for="img-sidebar-framing">Framing</label><select id="img-sidebar-framing" class="turn-image-mode-select"><option value="auto">Auto</option><option value="close">Close</option><option value="medium">Medium</option><option value="wide">Wide</option></select></div>' +
          '<div class="turn-image-controls">' +
            '<select id="img-sidebar-mode" class="turn-image-mode-select" title="Image type">' +
              '<option value="scene">Scene</option>' +
              '<option value="portrait">Portrait</option>' +
              '<option value="fullbody">Full body</option>' +
            '</select>' +
            '<select id="img-sidebar-char" class="turn-image-char-select hidden" title="Character for portrait/fullbody">' +
              '<option value="">Character...</option>' +
            '</select>' +
          '</div>' +
          '<label class="play-image-sidebar-label" for="img-sidebar-character-action">Character action (optional)</label>' +
          '<input id="img-sidebar-character-action" class="turn-image-character-action" type="text" placeholder="e.g. fastening one earring">' +
          '<label class="play-image-sidebar-label" for="img-sidebar-look">Image workflow</label>' +
          '<select id="img-sidebar-look" class="turn-image-look-select"><option value="">Loading Looks...</option></select>' +
          '<button type="button" class="turn-image-generate-btn" id="img-sidebar-generate">Generate</button>' +
          '<div id="img-sidebar-status" class="turn-image-status"></div>' +
          '<div id="img-sidebar-result" class="turn-image-result"></div>' +
        '</div>' +
      '</aside>' +

    '</div>';

  // Fresh Play mount — image sidebar starts closed
  if (state.imageGen) {
    state.imageGen.open = false;
    state.imageGen.turnId = null;
  }

  /* Load data */
  Promise.all([
    API.getScenario(scenarioId),
    API.getTurns(scenarioId),
    API.getConfig().catch(function () { return {}; }),
    API.getImages(scenarioId).catch(function () { return []; }),
  ])
    .then(function (results) {
      var scenResp = results[0];
      _playConfig = results[2] || {};
      state.currentScenario = Object.assign(
        { characters: scenResp.characters || [] },
        scenResp.scenario || scenResp
      );
      state.allLocations = scenResp.locations || [];
      var rawTurns = Array.isArray(results[1]) ? results[1] : (results[1].turns || []);
      state.turns = rawTurns.map(function(t) { return Object.assign({ speaker: t.role }, t); });
      state.acceptedImagesByTurn = groupAcceptedImagesByTurn(results[3]);

      document.getElementById('play-scenario-title').textContent = state.currentScenario.title || 'Untitled Story';

      renderAllTurns();
      renderCharacterFocusButtons(scenarioId);
      loadSidebarTab(state.currentSidebarTab, scenarioId);
      // Pre-load emotional states so cast sidebar bars are ready on first render
      _loadCharacterStates(scenarioId);

      // Auto-submit default_start on fresh scenarios (no turns yet)
      var _defStart = state.turns.length === 0 && state.currentScenario && state.currentScenario.default_start;
      if (_defStart) {
        if (!_beginTurnSubmit()) return;
        addTypingIndicator();
        var prevCount = state.turns.length;
        API.postTurn(scenarioId, _defStart)
          .then(function (response) { ingestTurnResponse(response); })
          .catch(function (e) {
            var msg = e && e.message ? e.message : '';
            if (msg.indexOf('already in progress') >= 0) {
              _pollForTurnCompletion(scenarioId, null, prevCount);
              return;
            }
            _finishTurnSubmit();
            removeTypingIndicator();
          });
      }
    })
    .catch(function (e) {
      showToast('Failed to load story: ' + e.message, 'error');
      document.getElementById('play-thread').innerHTML = '<div class="error-state">Could not load story.</div>';
    });

  setupPlayInteractions(scenarioId);
}

function sortTurns() {
  state.turns.sort(function (a, b) { return (a.turn_number || 0) - (b.turn_number || 0); });
}

function renderAllTurns() {
  var thread = document.getElementById('play-thread');
  if (!thread) return;
  thread.innerHTML = '';

  if (!state.turns.length) {
    thread.innerHTML =
      '<div class="thread-empty">' +
        '<p>The story begins...</p>' +
        '<p class="text-muted">Type your first action or dialogue below.</p>' +
      '</div>';
  } else {
    var sortedTurns = state.turns.slice().sort(function (a, b) { return (a.turn_number || 0) - (b.turn_number || 0); });
    sortedTurns.forEach(function (turn) {
      thread.appendChild(createTurnElement(turn));
    });
  }

  if (state.currentScenario && state.currentScenario.ended_at) {
    var banner = document.createElement('div');
    banner.className = 'story-ended-banner';
    banner.textContent = '~ Story Ended ~';
    thread.appendChild(banner);
  }

  scrollThreadToBottom();
  setupTurnFooterListeners();
}

function createTurnElement(turn) {
  var isUser  = turn.speaker === 'user';
  var content = turn.content_text || turn.content || '';
  var div = document.createElement('div');
  div.className = 'turn ' + (isUser ? 'turn-user' : 'turn-narrator');
  div.dataset.turnId     = turn.id;
  div.dataset.turnNumber = turn.turn_number || '';

  var numHtml = '<div class="turn-meta-num">' + (turn.turn_number || '') + '</div>';
  var acceptedImagesHtml = renderAcceptedStoryImages(
    state.currentScenario && state.currentScenario.id,
    state.acceptedImagesByTurn[String(turn.id)] || []
  );

  if (isUser) {
    // Guidance-first: user turns are directives, not character speech
    div.innerHTML = numHtml +
      '<div class="turn-inner guidance-turn">' +
        '<div class="turn-header">' +
          '<div class="guidance-turn-icon">&#9654;</div>' +
          '<div class="turn-speaker guidance-label">Guidance</div>' +
        '</div>' +
        '<div class="turn-text story-font guidance-text">' + escapeHtml(content) + '</div>' +
        acceptedImagesHtml +
        '<div class="turn-footer">' +
          '<button class="turn-user-edit-btn" data-turn-id="' + turn.id + '" title="Edit">&#9998;</button>' +
          '<button class="turn-delete-btn btn btn-xs btn-danger-ghost" data-turn-id="' + turn.id + '" title="Delete turn">&#x2715;</button>' +
        '</div>' +
      '</div>' +
      '<div class="turn-user-edit-panel hidden">' +
        '<textarea class="user-edit-content" rows="3">' + escapeHtml(content) + '</textarea>' +
        '<div class="regen-actions">' +
          '<button class="user-edit-cancel-btn">Cancel</button>' +
          '<button class="user-edit-save-btn">Save</button>' +
        '</div>' +
      '</div>';
  } else {
    // All characters are equal — no user/NPC distinction in speaker detection
    var npcChars = (state.currentScenario && state.currentScenario.characters) || [];
    var contentTrimmed = content.replace(/^\s+/, '');
    var speakerName = null;
    if (turn.speaker !== 'narrator' && turn.speaker !== 'user' && turn.speaker) {
      speakerName = turn.speaker;
    } else {
      npcChars.forEach(function (c) {
        if (!speakerName && c.name) {
          var n = c.name;
          if (contentTrimmed.indexOf(n + ' ') === 0 ||
              contentTrimmed.indexOf(n + ',') === 0 ||
              contentTrimmed.indexOf(n + ':') === 0) {
            speakerName = n;
          }
        }
      });
    }
    var speakerChar = speakerName
      ? npcChars.find(function (c) { return c.name === speakerName; }) || null
      : null;
    if (speakerName) div.classList.add('turn-npc');
    var responseLabel = turn.speaker === 'narrator' ? narratorResponseLabel(state.turns, turn) : null;
    var responseIdHtml = responseLabel ? '<span class="turn-response-id">' + escapeHtml(responseLabel) + '</span>' : '';
    var speakerHtml = speakerName
      ? '<div class="turn-header">' +
          avatarHtml(speakerChar, 'turn-avatar') +
          '<div class="turn-speaker turn-speaker-npc">' + escapeHtml(speakerName) + '</div>' +
          responseIdHtml +
        '</div>'
      : '<div class="narrator-label">~ Narrator ~' + (responseIdHtml ? ' ' + responseIdHtml : '') + '</div>';
    var npcTextStyle = '';
    if (speakerChar) {
      var speakerIdx = 0;
      npcChars.forEach(function (c, i) { if (c.id === speakerChar.id) speakerIdx = i; });
      npcTextStyle = ' style="color:' + getNpcColor(speakerChar.id, speakerIdx) + '"';
    }
    var ratingUp   = turn.user_rating ===  1 ? ' active-up'   : '';
    var ratingDown = turn.user_rating === -1 ? ' active-down'  : '';
    var bodyHtml = turn.speaker === 'narrator'
      ? formatNarratorLinesWithGutter(content)
      : formatStoryContent(content);
    div.innerHTML = numHtml +
      '<div class="turn-inner">' +
        speakerHtml +
        '<div class="turn-text story-font"' + npcTextStyle + '>' + bodyHtml + '</div>' +
        acceptedImagesHtml +
        '<div class="turn-footer">' +
          '<button class="turn-rate-btn' + ratingUp   + '" data-turn-id="' + turn.id + '" data-rating="1"  title="Good">+</button>' +
          '<button class="turn-rate-btn' + ratingDown + '" data-turn-id="' + turn.id + '" data-rating="-1" title="Bad">-</button>' +
          '<button class="turn-regen-btn" data-turn-id="' + turn.id + '" title="Regenerate this beat">&#8635;</button>' +
          '<button class="turn-image-btn" data-turn-id="' + turn.id + '" title="Generate an image for this beat">&#128444;</button>' +
          '<button class="turn-delete-btn btn btn-xs btn-danger-ghost" data-turn-id="' + turn.id + '" title="Delete turn">&#x2715;</button>' +
        '</div>' +
      '</div>' +
      '<div class="turn-regen-panel hidden">' +
        '<textarea class="regen-instruction" placeholder="Optional: give guidance for the rewrite..." rows="2"></textarea>' +
        '<div class="regen-actions">' +
          '<button class="regen-cancel-btn">Cancel</button>' +
          '<button class="regen-submit-btn">Regenerate</button>' +
        '</div>' +
      '</div>';
  }
  return div;
}




function _handlePostTurnError(scenarioId, optimId, prevCount, guidanceInput, guidanceText, e) {
  var msg = e && e.message ? e.message : String(e);
  if (msg.indexOf('already in progress') >= 0) {
    _pollForTurnCompletion(scenarioId, optimId, prevCount);
    return;
  }
  _finishTurnSubmit();
  removeTypingIndicator();
  _removeOptimisticTurn(optimId);
  if (guidanceInput && guidanceText) guidanceInput.value = guidanceText;
  showToast('Submit failed: ' + msg, 'error');
}

function _submitPostTurn(scenarioId, contentText, optimId, prevCount, guidanceInput, guidanceText) {
  return API.postTurn(scenarioId, contentText)
    .then(function (response) { ingestTurnResponse(response, optimId); })
    .catch(function (e) { _handlePostTurnError(scenarioId, optimId, prevCount, guidanceInput, guidanceText, e); });
}

function _mapTurnsFromApi(rawTurns) {
  var raw = Array.isArray(rawTurns) ? rawTurns : (rawTurns && rawTurns.turns) || [];
  return raw.map(function (t) { return Object.assign({ speaker: t.role }, t); });
}

function _syncTurnsFromServer(scenarioId, optimId) {
  return API.getTurns(scenarioId).then(function (rawTurns) {
    _removeOptimisticTurn(optimId);
    state.turns = _mapTurnsFromApi(rawTurns);
    sortTurns();
    renderAllTurns();
    scrollThreadToBottom();
  });
}

function _pollForTurnCompletion(scenarioId, optimId, prevCount) {
  if (_turnPollTimer) clearTimeout(_turnPollTimer);
  var attempts = 0;
  var maxAttempts = 60;
  function tick() {
    attempts += 1;
    API.getTurns(scenarioId).then(function (rawTurns) {
      var mapped = _mapTurnsFromApi(rawTurns);
      if (mapped.length > prevCount || attempts >= maxAttempts) {
        _turnInFlight = false;
        removeTypingIndicator();
        _removeOptimisticTurn(optimId);
        state.turns = mapped;
        sortTurns();
        renderAllTurns();
        scrollThreadToBottom();
        _turnPollTimer = null;
        if (mapped.length > prevCount) {
          showToast('Story updated.', 'info');
        }
        return;
      }
      _turnPollTimer = setTimeout(tick, 2000);
    }).catch(function () {
      if (attempts < maxAttempts) {
        _turnPollTimer = setTimeout(tick, 2000);
      } else {
        _turnInFlight = false;
        removeTypingIndicator();
        _turnPollTimer = null;
      }
    });
  }
  showToast('Still generating... waiting for the story to finish.', 'info');
  _turnPollTimer = setTimeout(tick, 2000);
}

function _beginTurnSubmit() {
  if (_turnInFlight) return false;
  _turnInFlight = true;
  if (_turnPollTimer) { clearTimeout(_turnPollTimer); _turnPollTimer = null; }
  return true;
}

function _finishTurnSubmit() {
  _turnInFlight = false;
}

function _upsertTurnInState(turn) {
  if (!turn || turn.id == null) return;
  var idx = state.turns.findIndex(function (t) { return String(t.id) === String(turn.id); });
  if (idx >= 0) state.turns[idx] = turn; else state.turns.push(turn);
}

function _removeOptimisticTurn(optimId) {
  if (!optimId) return;
  var optEl = document.querySelector('[data-turn-id="' + optimId + '"]');
  if (optEl && optEl.parentNode) optEl.parentNode.removeChild(optEl);
}

function _normalizeTurn(turn, fallbackSpeaker) {
  if (!turn) return null;
  return Object.assign({}, turn, { speaker: turn.speaker || turn.role || fallbackSpeaker });
}

function ingestTurnResponse(response, optimId) {
  removeTypingIndicator();
  _finishTurnSubmit();
  if (!response) return;
  try {
    _removeOptimisticTurn(optimId);
    if (response.user_turn) {
      _upsertTurnInState(_normalizeTurn(response.user_turn, 'user'));
    }
    if (response.narrator_turn) {
      _upsertTurnInState(_normalizeTurn(response.narrator_turn, 'narrator'));
      _lastIngestedNarratorId = response.narrator_turn.id;
    }
    sortTurns();
    renderAllTurns();
    scrollThreadToBottom();
    if (response.clothing_updates && response.clothing_updates.length && state.currentScenario) {
      handleClothingUpdate({ scenarioId: state.currentScenario.id, characters: response.clothing_updates });
    }
  } catch (err) {
    console.error('[play] ingestTurnResponse failed:', err);
    showToast('Turn display failed: ' + err.message, 'error');
  }
}

function ingestNarratorTurnFromWs(turn, scenarioId) {
  if (!turn || !state.currentScenario) return;
  if (Number(scenarioId) !== Number(state.currentScenario.id)) return;
  if (_lastIngestedNarratorId != null && String(_lastIngestedNarratorId) === String(turn.id)) return;
  removeTypingIndicator();
  _finishTurnSubmit();
  _syncTurnsFromServer(scenarioId).catch(function (err) {
    console.error('[play] ingestNarratorTurnFromWs sync failed:', err);
    try {
      var narTurn = Object.assign({ speaker: turn.role || 'narrator' }, turn);
      _upsertTurnInState(narTurn);
      _lastIngestedNarratorId = turn.id;
      sortTurns();
      renderAllTurns();
      scrollThreadToBottom();
    } catch (innerErr) {
      console.error('[play] ingestNarratorTurnFromWs fallback failed:', innerErr);
    }
  });
}

function appendTurnToThread(turn) {
  var thread = document.getElementById('play-thread');
  if (!thread) return;
  var empty = thread.querySelector('.thread-empty');
  if (empty) empty.parentNode.removeChild(empty);
  var el = createTurnElement(turn);
  el.classList.add('turn-new');
  thread.appendChild(el);
  scrollThreadToBottom();
  setupTurnFooterListeners();
}

// Replace the existing DOM element for a turn, or append if absent.
// state.turns must already reflect the latest data before calling this.
// Returns the inserted element, or null if #play-thread is missing.
function replaceOrAppendTurnElement(turn) {
  var el = createTurnElement(turn);
  var existing = document.querySelector('[data-turn-id="' + turn.id + '"]');
  if (existing) {
    existing.parentNode.replaceChild(el, existing);
  } else {
    var thread = document.getElementById('play-thread');
    if (!thread) return null;
    var empty = thread.querySelector('.thread-empty');
    if (empty) empty.parentNode.removeChild(empty);
    thread.appendChild(el);
  }
  setupTurnFooterListeners();
  return el;
}

function scrollThreadToBottom() {
  var thread = document.getElementById('play-thread');
  if (thread) setTimeout(function () { thread.scrollTop = thread.scrollHeight; }, 60);
}

function addTypingIndicator() {
  var thread = document.getElementById('play-thread');
  if (!thread || document.getElementById('typing-indicator')) return;
  var ind = document.createElement('div');
  ind.className = 'typing-indicator';
  ind.id = 'typing-indicator';
  ind.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  thread.appendChild(ind);
  scrollThreadToBottom();
}

function removeTypingIndicator() {
  var ind = document.getElementById('typing-indicator');
  if (ind && ind.parentNode) ind.parentNode.removeChild(ind);
}

function setupPlayInteractions(scenarioId) {
  /* Clothing inline-edit delegation — covers dynamically re-rendered cast cards */
  document.addEventListener('click', function (e) {
    var editBtn = e.target.closest && e.target.closest('.clothing-edit-btn');
    if (editBtn) {
      var wrap = editBtn.closest('.clothing-state-wrap');
      if (wrap) { _startClothingEdit(wrap); e.stopPropagation(); }
      return;
    }
    var saveBtn = e.target.closest && e.target.closest('.clothing-save-btn');
    if (saveBtn) {
      var wrap = saveBtn.closest('.clothing-state-wrap');
      if (wrap) { _commitClothingEdit(wrap); e.stopPropagation(); }
      return;
    }
    var cancelBtn = e.target.closest && e.target.closest('.clothing-cancel-btn');
    if (cancelBtn) {
      var wrap = cancelBtn.closest('.clothing-state-wrap');
      if (wrap) { _cancelClothingEdit(wrap); e.stopPropagation(); }
      return;
    }
    var resetBtn = e.target.closest && e.target.closest('.clothing-reset-btn');
    if (resetBtn) {
      var wrap = resetBtn.closest('.clothing-state-wrap');
      if (!wrap) return;
      var charId  = parseInt(wrap.getAttribute('data-char-id'), 10);
      var baseVal = (wrap.getAttribute('data-base-clothing') || '').trim();
      if (!charId || !baseVal) return;
      e.stopPropagation();
      resetBtn.disabled = true;
      API.updateCharacterClothing(charId, { current_clothing: baseVal, scenario_id: state.currentScenario && state.currentScenario.id, runtime: true })
        .then(function () {
          if (!state.characterStates[charId]) state.characterStates[charId] = {};
          state.characterStates[charId].current_clothing = baseVal;
          _restoreClothingWrap(wrap, charId, baseVal);
        })
        .catch(function (err) {
          resetBtn.disabled = false;
          console.error('clothing reset failed', err);
        });
    }
  });

  /* Sidebar toggle */
  var sbToggleBtn = document.getElementById('sidebar-toggle');
  if (sbToggleBtn) {
    sbToggleBtn.onclick = function () {
      state.sidebarOpen = !state.sidebarOpen;
      localStorage.setItem('story-lab-sidebar', state.sidebarOpen);
      var sb = document.getElementById('play-sidebar');
      if (sb) {
        sb.classList.toggle('collapsed', !state.sidebarOpen);
        if (!state.sidebarOpen) {
          sb.style.width = '';
        } else {
          var savedSb = localStorage.getItem('story-lab-sidebar-width');
          if (savedSb) sb.style.width = savedSb + 'px';
        }
      }
      sbToggleBtn.innerHTML = state.sidebarOpen ? '&laquo;' : '&raquo;';
    };
  }

  /* Scene presence tracking — which characters are currently in the scene */
  var _scenePresent = null;   // Set of lowercased char names in the current scene
  var _statusMode   = false;  // Whether we're in status-edit mode

  function _presenceKey() { return 'scene-present-' + scenarioId; }

  function _loadScenePresent(allCharNames) {
    // Restore from localStorage if available
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(_presenceKey())); } catch (_) {}
    if (Array.isArray(saved)) {
      _scenePresent = new Set(saved.map(function(n){ return n.toLowerCase(); }));
      // Any character not in the saved set is new -- default them to present
      allCharNames.forEach(function(n) {
        var key = n.toLowerCase();
        if (!_scenePresent.has(key)) { _scenePresent.add(key); }
      });
      _saveScenePresent();
      return;
    }
    // First visit: default everyone to present (user uses Status button to adjust)
    _scenePresent = new Set(allCharNames.map(function(n){ return n.toLowerCase(); }));
    _saveScenePresent();
  }

  function _saveScenePresent() {
    if (!_scenePresent) return;
    try { localStorage.setItem(_presenceKey(), JSON.stringify(Array.from(_scenePresent))); } catch(_) {}
  }

  function _refreshPortraitPresence() {
    var list = document.getElementById('portrait-list');
    if (!list || !_scenePresent) return;
    list.querySelectorAll('.portrait-card:not(.portrait-scene-card)').forEach(function(card) {
      var name = (card.dataset.charName || '').toLowerCase();
      card.classList.toggle('offscene', !_scenePresent.has(name));
    });
    list.classList.toggle('status-mode', _statusMode);
    var statusBtn = document.getElementById('btn-portrait-status');
    if (statusBtn) statusBtn.classList.toggle('active', _statusMode);
  }

  _updateScenePresent = function (added, removed) {
    if (!_scenePresent) return;
    (added || []).forEach(function (c) { _scenePresent.add(c.name.toLowerCase()); });
    (removed || []).forEach(function (c) { _scenePresent.delete(c.name.toLowerCase()); });
    _saveScenePresent();
  };


  /* Cast Add / Remove buttons */
  (function () {
    var pickerBar = document.getElementById('cast-picker-bar');
    var addBtn    = document.getElementById('btn-cast-add');
    var removeBtn = document.getElementById('btn-cast-remove');
    if (!pickerBar || !addBtn || !removeBtn) return;

    function closePicker() {
      pickerBar.style.display = 'none';
      pickerBar.innerHTML = '';
    }

    function showPicker(options, onSelect) {
      pickerBar.innerHTML = '';
      if (!options.length) {
        pickerBar.innerHTML = '<span class="cast-picker-empty">None available</span>';
        pickerBar.style.display = 'block';
        setTimeout(closePicker, 1800);
        return;
      }
      var sel = document.createElement('select');
      sel.className = 'cast-picker-select';
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '-- pick --';
      sel.appendChild(placeholder);
      options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name;
        sel.appendChild(opt);
      });
      var okBtn = document.createElement('button');
      okBtn.className = 'cast-picker-ok';
      okBtn.textContent = 'OK';
      okBtn.onclick = function () {
        var val = sel.value;
        if (!val) return;
        closePicker();
        onSelect(val, options.find(function (o) { return String(o.id) === String(val); }));
      };
      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'cast-picker-cancel';
      cancelBtn.textContent = 'X';
      cancelBtn.onclick = closePicker;
      pickerBar.appendChild(sel);
      pickerBar.appendChild(okBtn);
      pickerBar.appendChild(cancelBtn);
      pickerBar.style.display = 'flex';
      sel.focus();
    }

    addBtn.onclick = function () {
      if (pickerBar.style.display !== 'none') { closePicker(); return; }
      Promise.all([
        API.getCharacters(),
        API.getScenarioCharacters(scenarioId)
      ]).then(function (results) {
        var allChars  = Array.isArray(results[0]) ? results[0] : [];
        var inRoster  = Array.isArray(results[1]) ? results[1] : [];
        var rosterIds = inRoster.map(function (c) { return c.id; });
        var available = allChars.filter(function (c) { return rosterIds.indexOf(c.id) < 0; });
        showPicker(available, function (id, char) {
          API.addCharacterToScenario(scenarioId, id)
            .then(function () {
              showToast((char ? char.name : 'Character') + ' added to story.', 'success');
            })
            .catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
        });
      }).catch(function (err) { showToast('Could not load characters: ' + err.message, 'error'); });
    };

    removeBtn.onclick = function () {
      if (pickerBar.style.display !== 'none') { closePicker(); return; }
      API.getScenarioCharacters(scenarioId).then(function (data) {
        var current = Array.isArray(data) ? data : [];
        if (current.length <= 1) {
          showToast('A scenario needs at least one character.', 'info');
          return;
        }
        showPicker(current, function (id, char) {
          if (!confirm('Remove ' + (char ? char.name : 'this character') + ' from the story?')) return;
          API.removeCharacterFromScenario(scenarioId, id)
            .then(function () {
              showToast((char ? char.name : 'Character') + ' removed.', 'info');
            })
            .catch(function (err) { showToast('Failed to remove: ' + err.message, 'error'); });
        });
      }).catch(function (err) { showToast('Could not load characters: ' + err.message, 'error'); });
    };
  }());

  /* Sidebar tabs */
  var tabsEl = document.getElementById('sidebar-tabs');
  if (tabsEl) {
    tabsEl.onclick = function (e) {
      var btn = e.target.closest('.stab');
      if (!btn) return;
      state.currentSidebarTab = btn.dataset.tab;
      document.querySelectorAll('.stab').forEach(function (b) {
        b.classList.toggle('active', b.dataset.tab === state.currentSidebarTab);
      });
      loadSidebarTab(state.currentSidebarTab, scenarioId);
    };
  }

  /* Quick commands — send control tokens directly via advanceTurn */
  var quickCmds = document.getElementById('quick-cmds');
  if (quickCmds) {
    quickCmds.onclick = function (e) {
      var btn = e.target.closest('.qcmd-btn');
      if (!btn) return;
      var cmd = btn.dataset.cmd;
      if (!_beginTurnSubmit()) { showToast('Already generating a turn. Please wait...', 'info'); return; }
      addTypingIndicator();
      var prevCount = state.turns.length;
      API.postTurn(scenarioId, cmd)
        .then(function (response) { ingestTurnResponse(response); })
        .catch(function (e) {
          var msg = e && e.message ? e.message : String(e);
          if (msg.indexOf('already in progress') >= 0) {
            _pollForTurnCompletion(scenarioId, null, prevCount);
            return;
          }
          _finishTurnSubmit();
          removeTypingIndicator();
          showToast('Command failed: ' + msg, 'error');
        });
    };
  }

  /* Guidance-first controls */
  var guidanceInput = document.getElementById('guidance-input');
  var lockToggle    = document.getElementById('lock-toggle');
  var continueBtn   = document.getElementById('btn-continue');
  var narratorBtn   = document.getElementById('btn-narrator');

  /* Lock toggle */
  if (lockToggle) {
    lockToggle.onclick = function () {
      var locked = lockToggle.getAttribute('aria-pressed') === 'true';
      locked = !locked;
      lockToggle.setAttribute('aria-pressed', String(locked));
      lockToggle.querySelector('.lock-icon').innerHTML = locked ? '&#128274;' : '&#128275;';
      lockToggle.classList.toggle('lock-active', locked);
      if (guidanceInput) guidanceInput.classList.toggle('guidance-locked', locked);
    };
  }

  /* Enhance guidance button */
  var enhanceGuidanceBtn = document.getElementById('btn-enhance-guidance');
  if (enhanceGuidanceBtn) {
    enhanceGuidanceBtn.onclick = function () {
      showToast('Guidance enhancement is not yet available.', 'info');
    };
  }

  /* Narrator button */
  if (narratorBtn) {
    narratorBtn.onclick = function () { submitGuidanceTurn(scenarioId, 'narrator'); };
  }

  /* Continue button */
  if (continueBtn) {
    continueBtn.onclick = function () { submitGuidanceTurn(scenarioId, 'continue'); };
  }

  /* Enter on guidance input = Continue */
  if (guidanceInput) {
    guidanceInput.onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitGuidanceTurn(scenarioId, 'continue'); }
    };
  }

  /* Scene Info */
  var sceneInfoBtn = document.getElementById('btn-scene-info');
  if (sceneInfoBtn) sceneInfoBtn.onclick = showSceneInfo;

  /* Reset Scene */
  var resetSceneBtn = document.getElementById('btn-reset-scene');
  if (resetSceneBtn) {
    resetSceneBtn.onclick = function () {
      showConfirm('Reset Scene', 'Delete all turns and restart the story from the beginning?', function () {
        fetch('/api/scenarios/' + scenarioId + '/reset-scene', { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function () {
            showToast('Scene reset.', 'info');
            location.reload();
          })
          .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
      }, 'btn-danger');
    };
  }

  /* End Story */
  var endBtn = document.getElementById('btn-end-story');
  if (endBtn) {
    endBtn.onclick = function () {
      showConfirm('End Story', 'This will wrap up the narrative and mark the story as ended.', function () {
        if (!_beginTurnSubmit()) { showToast('Already generating a turn. Please wait...', 'info'); return; }
        addTypingIndicator();
        API.postTurn(scenarioId, '[end]')
          .then(function (response) {
            ingestTurnResponse(response);
            showToast('Story ended.', 'info');
            return API.getScenario(scenarioId);
          })
          .then(function (s) {
            var sr = s;
            state.currentScenario = Object.assign({ characters: sr.characters || [] }, sr.scenario || sr);
            var banner = document.querySelector('.story-ended-banner');
            if (!banner) {
              var thread = document.getElementById('play-thread');
              if (thread) {
                var b = document.createElement('div');
                b.className = 'story-ended-banner';
                b.textContent = '~ Story Ended ~';
                thread.appendChild(b);
                scrollThreadToBottom();
              }
            }
          })
          .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
      });
    };
  }

  initResizablePanels();
}

// -------------------------------------------------------------------------
// initResizablePanels — drag-to-resize sidebar
// -------------------------------------------------------------------------
function initResizablePanels() {
  var SB_MIN = 140, SB_MAX = 500;

  var sbHandle = document.getElementById('sidebar-resize-handle');
  var sidebar  = document.getElementById('play-sidebar');

  // Restore saved width on load (only when expanded)
  var savedSbWidth = localStorage.getItem('story-lab-sidebar-width');
  if (state.sidebarOpen && savedSbWidth && sidebar) {
    sidebar.style.width = parseInt(savedSbWidth, 10) + 'px';
  }

  function setupDrag(handle, panel, growLeft, min, max, storageKey) {
    if (!handle || !panel) return;
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      handle.classList.add('dragging');
      var startX = e.clientX;
      var startW = panel.offsetWidth;
      panel.style.transition = 'none';

      function onMove(me) {
        var dx = growLeft ? (startX - me.clientX) : (me.clientX - startX);
        var newW = Math.min(max, Math.max(min, startW + dx));
        panel.style.width = newW + 'px';
      }

      function onUp() {
        handle.classList.remove('dragging');
        panel.style.transition = '';
        localStorage.setItem(storageKey, panel.offsetWidth);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Sidebar: handle on right edge, drag right = grow
  setupDrag(sbHandle, sidebar, false, SB_MIN, SB_MAX, 'story-lab-sidebar-width');
}

function setupTurnFooterListeners() {
  var thread = document.getElementById('play-thread');
  if (!thread) return;

  // Turn rate buttons are local-only (no turn rating endpoint)
  thread.querySelectorAll('.turn-rate-btn').forEach(function (btn) {
    btn.onclick = function () {
      var rating = Number(btn.dataset.rating);
      var footer = btn.closest('.turn-footer');
      if (!footer) return;
      footer.querySelectorAll('.turn-rate-btn').forEach(function (b) {
        b.classList.remove('active-up', 'active-down');
      });
      if (rating ===  1) btn.classList.add('active-up');
      if (rating === -1) btn.classList.add('active-down');
    };
  });


  if (!thread._regenDelegateAttached) {
    thread._regenDelegateAttached = true;
    thread.addEventListener('click', function (e) {
      // Delete turn
      var deleteBtn = e.target.closest('.turn-delete-btn');
      if (deleteBtn) {
        if (!confirm('Delete this turn?')) return;
        var delTurnId = Number(deleteBtn.dataset.turnId);
        var delScenId = state.currentScenario && state.currentScenario.id;
        API.deleteTurn(delScenId, delTurnId)
          .then(function (r) {
            if (r && r.ok) {
              var turnEl = deleteBtn.closest('.turn');
              if (turnEl && turnEl.parentNode) turnEl.parentNode.removeChild(turnEl);
              state.turns = state.turns.filter(function (t) { return t.id !== delTurnId; });
              showToast('Turn deleted', 'success');
            } else {
              showToast('Could not delete turn', 'error');
            }
          })
          .catch(function () { showToast('Could not delete turn', 'error'); });
        return;
      }
      // Toggle panel open/close
      var regenBtn = e.target.closest('.turn-regen-btn');
      if (regenBtn) {
        var turnEl = regenBtn.closest('.turn');
        var panel  = turnEl && turnEl.querySelector('.turn-regen-panel');
        if (panel) panel.classList.toggle('hidden');
        return;
      }
      // Cancel
      var cancelBtn = e.target.closest('.regen-cancel-btn');
      if (cancelBtn) {
        var closePanel = cancelBtn.closest('.turn-regen-panel');
        if (closePanel) closePanel.classList.add('hidden');
        return;
      }
      // Image button — open page-level right sidebar for this turn (never nest in the card)
      var imageBtn = e.target.closest('.turn-image-btn');
      if (imageBtn) {
        var imgTurnEl = imageBtn.closest('.turn');
        if (!imgTurnEl) return;
        var openTurnId = Number(imgTurnEl.dataset.turnId);
        var openSid = state.currentScenario && state.currentScenario.id;
        if (!openSid || !openTurnId) return;
        openImageSidebar({
          scenarioId: openSid,
          turnId: openTurnId,
        });
        _loadShotActionForSidebar(openSid, openTurnId);
        return;
      }
      // User turn edit — toggle panel
      var userEditBtn = e.target.closest('.turn-user-edit-btn');
      if (userEditBtn) {
        var ueTurnEl = userEditBtn.closest('.turn');
        var uePanel  = ueTurnEl && ueTurnEl.querySelector('.turn-user-edit-panel');
        if (uePanel) {
          uePanel.classList.toggle('hidden');
          if (!uePanel.classList.contains('hidden')) {
            var ueTa = uePanel.querySelector('.user-edit-content');
            if (ueTa) { ueTa.focus(); ueTa.setSelectionRange(ueTa.value.length, ueTa.value.length); }
          }
        }
        return;
      }
      // User turn edit — cancel
      var userEditCancelBtn = e.target.closest('.user-edit-cancel-btn');
      if (userEditCancelBtn) {
        var ueCancelPanel = userEditCancelBtn.closest('.turn-user-edit-panel');
        if (ueCancelPanel) ueCancelPanel.classList.add('hidden');
        return;
      }
      // User turn edit — save
      var userEditSaveBtn = e.target.closest('.user-edit-save-btn');
      if (userEditSaveBtn) {
        var ueSaveTurnEl = userEditSaveBtn.closest('.turn');
        if (!ueSaveTurnEl) return;
        var ueSaveTurnId = Number(ueSaveTurnEl.dataset.turnId);
        var ueSavePanel  = ueSaveTurnEl.querySelector('.turn-user-edit-panel');
        var ueSaveTa     = ueSavePanel && ueSavePanel.querySelector('.user-edit-content');
        var ueNewContent = ueSaveTa ? ueSaveTa.value.trim() : '';
        if (!ueNewContent) { showToast('Cannot save empty content.', 'error'); return; }
        // Turn editing is not yet implemented
        showToast('Turn editing is not yet implemented.', 'info');
        if (ueSavePanel) ueSavePanel.classList.add('hidden');
        return;
      }
      // Submit text regenerate
      var submitBtn = e.target.closest('.regen-submit-btn');
      if (!submitBtn) return;
      var regenPanel  = submitBtn.closest('.turn-regen-panel');
      var regenTurnEl = regenPanel && regenPanel.closest('.turn');
      if (!regenPanel || !regenTurnEl) return;
      var turnId      = Number(regenTurnEl.dataset.turnId);
      var scenarioId  = state.currentScenario && state.currentScenario.id;
      var instrEl     = regenPanel.querySelector('.regen-instruction');
      var instrVal    = instrEl ? instrEl.value.trim() : '';
      if (!scenarioId || !turnId) return;

      submitBtn.disabled = true;
      var prevLabel = submitBtn.textContent;
      submitBtn.textContent = 'Regenerating...';
      regenPanel.classList.add('hidden');
      addTypingIndicator();
      showToast('Regenerating response...', 'info');

      API.regenerateTurn(scenarioId, turnId, { guidance: instrVal })
        .then(function (res) {
          var turn = res && (res.turn || res.narrator_turn);
          if (!turn) throw new Error('No regenerated turn returned');
          if (res.clothing_updates && res.clothing_updates.length) {
            handleClothingUpdate({ scenarioId: scenarioId, characters: res.clothing_updates });
          }
          var mapped = Object.assign({ speaker: turn.role || 'narrator' }, turn);
          _upsertTurnInState(mapped);
          replaceOrAppendTurnElement(mapped);
          _lastIngestedNarratorId = turn.id;
          showToast('Response regenerated.', 'success');
        })
        .catch(function (err) {
          showToast('Regenerate failed: ' + (err.message || err), 'error');
          regenPanel.classList.remove('hidden');
        })
        .finally(function () {
          removeTypingIndicator();
          submitBtn.disabled = false;
          submitBtn.textContent = prevLabel;
        });
    });
  }

  // Picking a different Look in a turn's image panel activates it globally —
  // there is exactly one active Look at a time (the dropdown always reflects
  // and controls global state, never a per-generation override).
}


// Populates a Look <select> from the API, marking the currently active Look
// selected. Safe to call every time the image panel is opened.
// ---------------------------------------------------------------------------
// Image generator — page-level right sidebar (not nested in turn cards)
// ---------------------------------------------------------------------------

function _getImageSidebarEls() {
  return {
    root: document.getElementById('play-image-sidebar'),
    action: document.getElementById('img-sidebar-action'),
    characterAction: document.getElementById('img-sidebar-character-action'),
    subjects: document.getElementById('img-sidebar-scene-subjects'),
    chips: document.getElementById('img-sidebar-subject-chips'),
    framing: document.getElementById('img-sidebar-framing'),
    mode: document.getElementById('img-sidebar-mode'),
    char: document.getElementById('img-sidebar-char'),
    look: document.getElementById('img-sidebar-look'),
    generate: document.getElementById('img-sidebar-generate'),
    status: document.getElementById('img-sidebar-status'),
    result: document.getElementById('img-sidebar-result'),
    turnLabel: document.getElementById('img-sidebar-turn-label'),
    hint: document.getElementById('img-sidebar-action-hint'),
    shotLoading: document.getElementById('img-sidebar-shot-loading'),
    close: document.getElementById('img-sidebar-close'),
    container: document.getElementById('play-container'),
  };
}

function _syncImageModeControls() {
  var els = _getImageSidebarEls();
  if (!els.mode || !els.char) return;
  var mode = els.mode.value;
  if (mode === 'portrait' || mode === 'fullbody') {
    els.char.classList.remove('hidden');
  } else {
    els.char.classList.add('hidden');
  }
}

function _populateImageCharSelect(selectEl) {
  if (!selectEl) return;
  var sid = state.currentScenario && state.currentScenario.id;
  if (!sid) {
    selectEl.innerHTML = '<option value="">No scenario</option>';
    return;
  }
  selectEl.innerHTML = '<option value="">Loading cast...</option>';
  API.getScenarioCharacters(sid).then(function (chars) {
    if (!Array.isArray(chars) || !chars.length) {
      selectEl.innerHTML = '<option value="">No characters in cast</option>';
      return;
    }
    var selected = state.imageGen && state.imageGen.characterId ? String(state.imageGen.characterId) : '';
    selectEl.innerHTML = '<option value="">Select character...</option>' + chars.map(function (c) {
      return '<option value="' + c.id + '"' + (String(c.id) === selected ? ' selected' : '') + '>' +
        escapeHtml(c.name || ('Character ' + c.id)) + '</option>';
    }).join('');
  }).catch(function () {
    selectEl.innerHTML = '<option value="">Failed to load cast</option>';
  });
}

function _populateLookSelect(selectEl) {
  if (!selectEl) return;
  API.getLooks().then(function (looks) {
    if (!Array.isArray(looks) || !looks.length) {
      selectEl.innerHTML = '<option value="">No Looks configured</option>';
      return;
    }
    var preferred = state.imageGen && state.imageGen.lookId ? String(state.imageGen.lookId) : '';
    selectEl.innerHTML = looks.map(function (l) {
      var sel = preferred ? String(l.id) === preferred : !!l.is_active;
      return '<option value="' + l.id + '"' + (sel ? ' selected' : '') + '>' +
        escapeHtml(l.name) + (l.is_active ? ' (active)' : '') + '</option>';
    }).join('');
  }).catch(function () {
    selectEl.innerHTML = '<option value="">Failed to load Looks</option>';
  });
}

function _loadTurnImages(resultEl, scenarioId, turnId) {
  if (!resultEl || !scenarioId || !turnId) return;
  API.getImages(scenarioId, turnId).then(function (rows) {
    if (!Array.isArray(rows) || !rows.length) {
      resultEl.innerHTML = '';
      return;
    }
    resultEl.innerHTML = rows.map(function (image) {
      return _buildTurnImageCardHtml(scenarioId, image);
    }).join('');
  }).catch(function () {
    // Soft-fail: leave whatever is already shown rather than wiping the panel.
  });
}

function _buildTurnImageCardHtml(scenarioId, image) {
  var src = '/story-images/' + scenarioId + '/' + encodeURIComponent(image.filename);
  var meta = (image.mode || 'scene') + ' &middot; ' + (image.generation_method || 'txt2img') +
    (image.model_name ? ' &middot; ' + escapeHtml(image.model_name) : '');
  if (image.accepted) meta += ' &middot; accepted';
  var rating = Number(image.user_rating || 0);
  var upActive = rating === 1 ? ' is-active' : '';
  var downActive = rating === -1 ? ' is-active' : '';
  var acceptActive = image.accepted ? ' is-active' : '';
  return '<div class="turn-image-card" data-image-id="' + image.id + '" data-scenario-id="' + scenarioId + '">' +
    '<img src="' + src + '" alt="Generated image" loading="lazy">' +
    '<div class="turn-image-card-meta">' + meta + '</div>' +
    '<div class="turn-image-card-actions">' +
      '<button type="button" class="turn-image-accept-btn' + acceptActive + '" title="Accept this image">Accept</button>' +
      '<button type="button" class="turn-image-rate-btn' + upActive + '" data-rating="1" title="Rate good">+</button>' +
      '<button type="button" class="turn-image-rate-btn' + downActive + '" data-rating="-1" title="Rate bad">-</button>' +
      '<button type="button" class="turn-image-delete-btn" title="Delete this image">Delete</button>' +
    '</div>' +
  '</div>';
}

function _populateSceneSubjectChips() {
  var els = _getImageSidebarEls();
  var sid = state.currentScenario && state.currentScenario.id;
  if (!els.chips || !sid) return;
  API.getScenarioCharacters(sid).then(function (chars) {
    if (state.imageGen) state.imageGen.sceneCast = Array.isArray(chars) ? chars : [];
    if (state.imageGen && state.imageGen.mode === 'scene' && state.imageGen.actionText) _selectPrimarySceneSubject(state.imageGen.actionText);
    var selected = state.imageGen.sceneCharacterIds || [];
    els.chips.innerHTML = (chars || []).map(function (character) {
      var active = selected.includes(Number(character.id));
      return '<button type="button" class="btn btn-ghost btn-xs img-scene-subject" data-id="' + character.id + '" aria-pressed="' + active + '">' + escapeHtml(character.name) + '</button>';
    }).join(' ');
  });
}

function _selectPrimarySceneSubject(actionText) {
  if (!state.imageGen || (state.imageGen.sceneCharacterIds || []).length) return;
  var cast = state.imageGen.sceneCast || [];
  if (!cast.length) return;
  var text = String(actionText || '');
  var primary = cast.find(function (character) {
    return character.name && new RegExp('\\b' + String(character.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text);
  }) || cast[0];
  state.imageGen.sceneCharacterIds = [Number(primary.id)];
  _populateSceneSubjectChips();
}

function _refreshAcceptedImagesForTurn(turnId) {
  var turn = state.turns.find(function (item) { return Number(item.id) === Number(turnId); });
  if (!turn) return;
  replaceOrAppendTurnElement(turn);
}

function _storeAcceptedImage(image) {
  if (!image || image.turn_id == null) return;
  var key = String(image.turn_id);
  var current = state.acceptedImagesByTurn[key] || [];
  state.acceptedImagesByTurn[key] = current.filter(function (item) {
    return Number(item.id) !== Number(image.id);
  });
  if (image.accepted) state.acceptedImagesByTurn[key].push(image);
  _refreshAcceptedImagesForTurn(image.turn_id);
}

function _removeAcceptedImage(imageId) {
  Object.keys(state.acceptedImagesByTurn).some(function (turnId) {
    var current = state.acceptedImagesByTurn[turnId] || [];
    var next = current.filter(function (image) { return Number(image.id) !== Number(imageId); });
    if (next.length === current.length) return false;
    state.acceptedImagesByTurn[turnId] = next;
    _refreshAcceptedImagesForTurn(turnId);
    return true;
  });
}

function _markSelectedImageTurn(turnId) {
  document.querySelectorAll('.turn.is-image-selected').forEach(function (el) {
    el.classList.remove('is-image-selected');
  });
  if (!turnId) return;
  var el = document.querySelector('.turn[data-turn-id="' + turnId + '"]');
  if (el) el.classList.add('is-image-selected');
}


var _shotActionDraftTimer = null;
var _shotActionDraftPending = null;
var _shotActionLoadToken = 0;

function _shotActionSourceHint(source) {
  var map = {
    user_draft: 'Saved draft for this turn.',
    scene_card: 'Loaded from scene card.',
    cached: 'Loaded from cached scene summary.',
    llm: 'Suggested from this turn (editable).',
    heuristic: 'Suggested from this turn (editable).',
    empty: 'Describe only what should be visible. Style comes from the selected Look.',
  };
  return map[source] || map.empty;
}

function _applyShotActionToSidebar(text, source) {
  var els = _getImageSidebarEls();
  var value = text != null ? String(text) : '';
  if (els.action) {
    els.action.value = value;
    els.action.placeholder = 'Describe what should be visible in this shot...';
  }
  var actionLabel = document.querySelector('label[for="img-sidebar-action"]');
  var characterLabel = document.querySelector('label[for="img-sidebar-character-action"]');
  if (actionLabel) actionLabel.textContent = mode === 'fullbody' ? 'Fullbody action (editable)' : 'Scene description (editable)';
  if (characterLabel) characterLabel.classList.toggle('hidden', mode === 'fullbody');
  if (els.characterAction) els.characterAction.classList.toggle('hidden', mode === 'fullbody');
  if (els.subjects) els.subjects.classList.toggle('hidden', mode !== 'scene');
  if (els.framing) {
    els.framing.value = state.imageGen.framing || 'auto';
    els.framing.querySelector('option[value="close"]').disabled = mode === 'fullbody';
    if (mode === 'fullbody' && els.framing.value === 'close') els.framing.value = 'auto';
  }
  if (els.hint) els.hint.textContent = _shotActionSourceHint(source);
  if (els.shotLoading) els.shotLoading.classList.add('hidden');
  if (state.imageGen) state.imageGen.actionText = value;
}

function _setShotActionLoading(isLoading) {
  var els = _getImageSidebarEls();
  if (els.shotLoading) els.shotLoading.classList.toggle('hidden', !isLoading);
  if (els.action) els.action.disabled = !!isLoading;
}

function _loadShotActionForSidebar(sid, turnId) {
  var loadSid = Number(sid);
  var loadTurnId = Number(turnId);
  if (!loadSid || !loadTurnId) return;

  var token = ++_shotActionLoadToken;
  _setShotActionLoading(true);

  var mode = state.imageGen && state.imageGen.mode === 'fullbody' ? 'fullbody' : 'scene';
  var characterId = state.imageGen && state.imageGen.characterId;
  API.getShotAction(loadSid, loadTurnId, { mode: mode, characterId: characterId })
    .then(function (res) {
      if (token !== _shotActionLoadToken) return null;
      if (!state.imageGen || Number(state.imageGen.turnId) !== loadTurnId) return null;

      var text = (res && res.text) ? String(res.text).trim() : '';
      var source = (res && res.source) || 'empty';
      var needsSuggest = !!(res && res.needs_suggest) || !text;
      if (mode === 'scene' && res) {
        state.imageGen.sceneCharacterIds = Array.isArray(res.subject_ids) ? res.subject_ids.map(Number).filter(Boolean).slice(0, 2) : [];
        state.imageGen.framing = res.framing || 'auto';
        _populateSceneSubjectChips();
        _syncImageModeControls();
      }
      if (mode === 'scene' && text) _selectPrimarySceneSubject(text);
      if (mode === 'fullbody' && res) {
        state.imageGen.framing = res.framing || 'auto';
        _syncImageModeControls();
      }

      if (!needsSuggest) {
        _applyShotActionToSidebar(text, source);
        _setShotActionLoading(false);
        return null;
      }

      return API.suggestShotAction(loadSid, loadTurnId, { mode: mode, characterId: characterId }).then(function (sug) {
        if (token !== _shotActionLoadToken) return;
        if (!state.imageGen || Number(state.imageGen.turnId) !== loadTurnId) return;
        var sugText = (sug && sug.text) ? String(sug.text).trim() : text;
        var sugSource = (sug && sug.source) || (sugText ? 'heuristic' : 'empty');
        _applyShotActionToSidebar(sugText, sugSource);
        if (mode === 'scene' && sugText) _selectPrimarySceneSubject(sugText);
        _setShotActionLoading(false);
      }).catch(function (err) {
        if (token !== _shotActionLoadToken) return;
        if (!state.imageGen || Number(state.imageGen.turnId) !== loadTurnId) return;
        _applyShotActionToSidebar(text, text ? source : 'empty');
        _setShotActionLoading(false);
        console.error('shot-action suggest failed', err);
      });
    })
    .catch(function (err) {
      if (token !== _shotActionLoadToken) return;
      _setShotActionLoading(false);
      var els = _getImageSidebarEls();
      if (els.action) els.action.placeholder = 'Describe what should be visible in this shot...';
      if (els.hint) {
        els.hint.textContent = 'Could not auto-load scene description. Type one manually.';
      }
      console.error('shot-action load failed', err);
    });
}

function _scheduleSaveShotActionDraft(sid, turnId, text) {
  _shotActionDraftPending = {
    sid: Number(sid),
    turnId: Number(turnId),
    text: text != null ? String(text) : '',
  };
  if (_shotActionDraftTimer) clearTimeout(_shotActionDraftTimer);
  _shotActionDraftTimer = setTimeout(function () {
    _shotActionDraftTimer = null;
    _flushShotActionDraftSave();
  }, 600);
}

function _flushShotActionDraftSave() {
  if (_shotActionDraftTimer) {
    clearTimeout(_shotActionDraftTimer);
    _shotActionDraftTimer = null;
  }
  var pending = _shotActionDraftPending;
  _shotActionDraftPending = null;
  if (!pending || !pending.sid || !pending.turnId) return;
  var mode = state.imageGen && state.imageGen.mode === 'fullbody' ? 'fullbody' : 'scene';
  var body = { mode: mode, text: pending.text, characterId: state.imageGen && state.imageGen.characterId, framing: state.imageGen && state.imageGen.framing };
  if (mode === 'scene') body.subjectIds = state.imageGen && state.imageGen.sceneCharacterIds;
  API.saveShotActionDraft(pending.sid, pending.turnId, body).catch(function (err) {
    console.error('shot-action draft save failed', err);
  });
}

function closeImageSidebar() {
  _flushShotActionDraftSave();
  _shotActionLoadToken++;
  _setShotActionLoading(false);
  var els = _getImageSidebarEls();
  if (els.root) {
    els.root.classList.remove('is-open');
    els.root.setAttribute('aria-hidden', 'true');
  }
  if (els.container) els.container.classList.remove('image-sidebar-open');
  _markSelectedImageTurn(null);
  if (state.imageGen) {
    state.imageGen.open = false;
    state.imageGen.turnId = null;
  }
}

function openImageSidebar(opts) {
  opts = opts || {};
  if (!state.imageGen) {
    state.imageGen = { open: false, turnId: null, scenarioId: null, mode: 'scene', lookId: null, characterId: null, actionText: '', characterAction: '' };
  }
  state.imageGen.open = true;
  state.imageGen.scenarioId = opts.scenarioId || (state.currentScenario && state.currentScenario.id) || null;
  state.imageGen.turnId = opts.turnId || null;
  if (opts.mode) state.imageGen.mode = opts.mode;

  var els = _getImageSidebarEls();
  if (!els.root) return;

  els.root.classList.add('is-open');
  els.root.setAttribute('aria-hidden', 'false');
  if (els.container) els.container.classList.add('image-sidebar-open');

  if (els.turnLabel) {
    els.turnLabel.textContent = state.imageGen.turnId ? ('Turn #' + state.imageGen.turnId) : '';
  }
  if (els.action) {
    els.action.value = '';
    els.action.placeholder = 'Loading scene description...';
  }
  if (els.characterAction) {
    els.characterAction.value = '';
    state.imageGen.characterAction = '';
  }
  if (els.mode) els.mode.value = state.imageGen.mode || 'scene';
  if (els.status) {
    els.status.textContent = '';
    els.status.classList.remove('is-error');
  }

  _markSelectedImageTurn(state.imageGen.turnId);
  _populateLookSelect(els.look);
  _populateImageCharSelect(els.char);
  _populateSceneSubjectChips();
  _syncImageModeControls();
  if (state.imageGen.scenarioId && state.imageGen.turnId) {
    _loadTurnImages(els.result, state.imageGen.scenarioId, state.imageGen.turnId);
  } else if (els.result) {
    els.result.innerHTML = '';
  }

  wireImageSidebarOnce();
  if (els.action) {
    try { els.action.focus(); } catch (e) {}
  }
}

function _readImageSidebarIntoState() {
  var els = _getImageSidebarEls();
  if (!state.imageGen) return;
  if (els.action) state.imageGen.actionText = els.action.value;
  if (els.characterAction) state.imageGen.characterAction = els.characterAction.value;
  if (els.mode) state.imageGen.mode = els.mode.value;
  if (els.look && els.look.value) state.imageGen.lookId = Number(els.look.value);
  if (els.char && els.char.value) state.imageGen.characterId = Number(els.char.value);
  else state.imageGen.characterId = null;
  if (els.framing) state.imageGen.framing = els.framing.value || 'auto';
}

function wireImageSidebarOnce() {
  var els = _getImageSidebarEls();
  if (!els.root || els.root._imageSidebarWired) return;
  els.root._imageSidebarWired = true;

  if (els.close) {
    els.close.onclick = function () { closeImageSidebar(); };
  }

  els.root.addEventListener('change', function (e) {
    if (e.target.id === 'img-sidebar-mode') {
      _readImageSidebarIntoState();
      _syncImageModeControls();
      _loadShotActionForSidebar(state.imageGen.scenarioId, state.imageGen.turnId);
      return;
    }
    if (e.target.id === 'img-sidebar-look' && e.target.value) {
      state.imageGen.lookId = Number(e.target.value);
      API.activateLook(Number(e.target.value)).catch(function (err) {
        showToast('Failed to activate Look: ' + err.message, 'error');
      });
      return;
    }
    if (e.target.id === 'img-sidebar-char') {
      state.imageGen.characterId = e.target.value ? Number(e.target.value) : null;
      if (state.imageGen.mode === 'fullbody') _loadShotActionForSidebar(state.imageGen.scenarioId, state.imageGen.turnId);
    }
    if (e.target.id === 'img-sidebar-framing') state.imageGen.framing = e.target.value || 'auto';
  });

  els.root.addEventListener('click', function (e) {
    var chip = e.target.closest('.img-scene-subject');
    if (!chip || !state.imageGen || state.imageGen.mode !== 'scene') return;
    var id = Number(chip.dataset.id);
    var current = state.imageGen.sceneCharacterIds || [];
    if (current.includes(id)) state.imageGen.sceneCharacterIds = current.filter(function (value) { return value !== id; });
    else if (current.length < 2) state.imageGen.sceneCharacterIds = current.concat(id);
    else { showToast('Choose at most two scene subjects.', 'error'); return; }
    _populateSceneSubjectChips();
  });

  if (els.action) {
    els.action.addEventListener('input', function () {
      state.imageGen.actionText = els.action.value;
      if (state.imageGen.scenarioId && state.imageGen.turnId) {
        _scheduleSaveShotActionDraft(state.imageGen.scenarioId, state.imageGen.turnId, els.action.value);
      }
    });
  }

  if (els.characterAction) {
    els.characterAction.addEventListener('input', function () {
      state.imageGen.characterAction = els.characterAction.value;
    });
  }

  if (els.generate) {
    els.generate.onclick = function () {
      _readImageSidebarIntoState();
      var sid = state.imageGen.scenarioId;
      var tid = state.imageGen.turnId;
      if (!sid || !tid) {
        if (els.status) {
          els.status.textContent = 'No turn selected.';
          els.status.classList.add('is-error');
        }
        return;
      }
      var genMode = state.imageGen.mode || 'scene';
      if (genMode !== 'scene' && genMode !== 'portrait' && genMode !== 'fullbody') genMode = 'scene';
      var genOpts = buildImageGenerationOptions({
        turnId: tid,
        mode: genMode,
        sceneText: state.imageGen.actionText,
        characterAction: state.imageGen.characterAction,
        characterId: state.imageGen.characterId,
        sceneCharacterIds: state.imageGen.sceneCharacterIds,
        framing: state.imageGen.framing,
      });
      if (genMode === 'portrait' || genMode === 'fullbody') {
        var charId = state.imageGen.characterId ? Number(state.imageGen.characterId) : 0;
        if (!charId) {
          els.status.textContent = 'Pick a character for ' + genMode + ' mode.';
          els.status.classList.add('is-error');
          return;
        }
      }

      els.generate.disabled = true;
      els.status.textContent = 'Generating...';
      els.status.classList.remove('is-error');

      var lookPromise = Promise.resolve();
      if (els.look && els.look.value) {
        lookPromise = API.activateLook(Number(els.look.value));
      }

      lookPromise.then(function () {
        return API.generateImage(sid, genOpts);
      }).then(function (result) {
        els.status.textContent = '';
        if (result && result.image && els.result) {
          if (!els.result.querySelector('[data-image-id="' + result.image.id + '"]')) {
            els.result.insertAdjacentHTML('afterbegin', _buildTurnImageCardHtml(sid, result.image));
          }
        }
      }).catch(function (err) {
        els.status.textContent = 'Failed: ' + (err.message || 'unknown error');
        els.status.classList.add('is-error');
      }).finally(function () {
        els.generate.disabled = false;
      });
    };
  }

  // Accept / rate / delete on cards inside the sidebar
  els.root.addEventListener('click', function (e) {
    var imageAcceptBtn = e.target.closest('.turn-image-accept-btn');
    if (imageAcceptBtn) {
      var acceptCard = imageAcceptBtn.closest('.turn-image-card');
      if (!acceptCard) return;
      var acceptSid = Number(acceptCard.dataset.scenarioId);
      var acceptId = Number(acceptCard.dataset.imageId);
      if (!acceptSid || !acceptId) return;
      imageAcceptBtn.disabled = true;
      API.acceptImage(acceptSid, acceptId).then(function (updated) {
        acceptCard.outerHTML = _buildTurnImageCardHtml(acceptSid, updated);
        _storeAcceptedImage(updated);
        showToast('Image accepted.', 'success');
      }).catch(function (err) {
        showToast('Accept failed: ' + (err.message || 'unknown error'), 'error');
        imageAcceptBtn.disabled = false;
      });
      return;
    }

    var imageRateBtn = e.target.closest('.turn-image-rate-btn');
    if (imageRateBtn) {
      var rateCard = imageRateBtn.closest('.turn-image-card');
      if (!rateCard) return;
      var rateSid = Number(rateCard.dataset.scenarioId);
      var rateId = Number(rateCard.dataset.imageId);
      if (!rateSid || !rateId) return;
      var nextRating = Number(imageRateBtn.dataset.rating);
      if (imageRateBtn.classList.contains('is-active')) nextRating = 0;
      imageRateBtn.disabled = true;
      API.rateImage(rateSid, rateId, nextRating).then(function (updated) {
        rateCard.outerHTML = _buildTurnImageCardHtml(rateSid, updated);
      }).catch(function (err) {
        showToast('Rate failed: ' + (err.message || 'unknown error'), 'error');
        imageRateBtn.disabled = false;
      });
      return;
    }

    var imageDeleteBtn = e.target.closest('.turn-image-delete-btn');
    if (imageDeleteBtn) {
      var delCard = imageDeleteBtn.closest('.turn-image-card');
      if (!delCard) return;
      var delSid = Number(delCard.dataset.scenarioId);
      var delId = Number(delCard.dataset.imageId);
      if (!delSid || !delId) return;
      showConfirm('Delete Image', 'Remove this generated image from the story? The file will be deleted.', function () {
        API.deleteImage(delSid, delId).then(function () {
          delCard.remove();
          _removeAcceptedImage(delId);
          showToast('Image deleted.', 'info');
        }).catch(function (err) {
          showToast('Delete failed: ' + (err.message || 'unknown error'), 'error');
        });
      });
    }
  });
}

// ---------------------------------------------------------------------------
// submitGuidanceTurn — unified submit for all guidance-first buttons
// focusTarget: character name | 'narrator' | 'continue'
// ---------------------------------------------------------------------------
function submitGuidanceTurn(scenarioId, focusTarget) {
  if (!_beginTurnSubmit()) {
    showToast('Already generating a turn. Please wait...', 'info');
    return;
  }
  var guidanceInput = document.getElementById('guidance-input');
  var lockToggle    = document.getElementById('lock-toggle');
  var guidanceText  = guidanceInput ? guidanceInput.value.trim() : '';
  var isLocked      = lockToggle ? lockToggle.getAttribute('aria-pressed') === 'true' : false;

  // Lock with no guidance — treat same as unlocked
  if (isLocked && !guidanceText) isLocked = false;

  // Disable all focus buttons during generation
  var allFocusBtns = document.querySelectorAll('.focus-btn, .char-focus-btn');
  allFocusBtns.forEach(function (b) { b.disabled = true; });
  if (guidanceInput) guidanceInput.disabled = true;
  addTypingIndicator();

  var isCharacter = focusTarget !== 'continue' && focusTarget !== 'narrator';
  var contentText;
  if (isLocked && guidanceText && isCharacter) {
    contentText = focusTarget + ' says: "' + guidanceText + '"';
  } else if (guidanceText) {
    contentText = isCharacter ? '[' + focusTarget + '] ' + guidanceText : guidanceText;
  } else if (isCharacter) {
    contentText = 'Respond as ' + focusTarget + '. Write their dialogue, actions, and reactions for this beat.';
  } else if (focusTarget === 'narrator') {
    contentText = 'Continue as pure narration (no character dialogue unless brief).';
  } else {
    contentText = 'Continue the story coherently in whatever manner fits best.';
  }

  // Optimistic user turn label
  var displayText = guidanceText
    ? (focusTarget !== 'continue' ? '[' + focusTarget + '] ' : '') + guidanceText
    : '[' + focusTarget + ']';
  var prevTurns = state.turns;
  var lastNum   = prevTurns.length ? Math.max.apply(null, prevTurns.map(function (t) { return t.turn_number || 0; })) : 0;
  var optimId   = 'opt-' + Date.now();
  var optimTurn = { id: optimId, speaker: 'user', content_text: displayText, turn_number: lastNum + 1 };
  appendTurnToThread(optimTurn);

  if (guidanceInput) guidanceInput.value = '';

  var prevTurnCount = state.turns.length;
  _submitPostTurn(scenarioId, contentText, optimId, prevTurnCount, guidanceInput, guidanceText)
    .finally(function () {
      allFocusBtns.forEach(function (b) { b.disabled = false; });
      if (guidanceInput) guidanceInput.disabled = false;
      document.querySelectorAll('.char-focus-btn').forEach(function (b) { b.style.outline = ''; b.title = 'Focus next beat on ' + (b.dataset.charName || ''); });
    });
}

// ---------------------------------------------------------------------------
// renderCharacterFocusButtons — builds one button per character in the scenario.
// All characters are equal — no user/NPC distinction.
// ---------------------------------------------------------------------------
function renderCharacterFocusButtons(scenarioId) {
  var btnsEl = document.getElementById('char-focus-btns');
  if (!btnsEl) return;

  var chars = (state.currentScenario && state.currentScenario.characters) || [];
  btnsEl.innerHTML = '';

  chars.forEach(function (char) {
    var btn = document.createElement('button');
    btn.className = 'focus-btn char-focus-btn';
    btn.dataset.charId = char.id;
    btn.dataset.charName = char.name;
    btn.title = 'Have the narrator respond as ' + char.name;

    var initial = char.name ? char.name[0].toUpperCase() : '?';

    // Avatar
    var initEl = document.createElement('span');
    initEl.className = 'focus-btn-initial';
    initEl.textContent = initial;
    btn.appendChild(initEl);

    var label = document.createElement('span');
    label.className = 'focus-btn-label';
    label.textContent = char.name;
    btn.appendChild(label);

    btn.onclick = function () {
      document.querySelectorAll('.char-focus-btn').forEach(function (b) { b.style.outline = ''; });
      btn.style.outline = '2px solid var(--accent, #7c6af0)';
      btn.title = 'FOCUSED: next beat will feature ' + char.name;
      submitGuidanceTurn(scenarioId, char.name);
    };
    btnsEl.appendChild(btn);
  });
}

window._renderAllTurns       = renderAllTurns;
window._setupTurnFooterListeners = setupTurnFooterListeners;

function showSceneInfo() {
  var scenario = state.currentScenario;
  if (!scenario) return;

  var locationName = 'None';
  if (scenario.active_location_id) {
    var loc = state.allLocations.find(function (l) { return l.id === scenario.active_location_id; });
    locationName = loc ? loc.name : String(scenario.active_location_id);
  }

  function infoRow(label, value) {
    return '<div class="setting-row">' +
      '<span style="font-weight:600;color:var(--text-muted);min-width:140px">' + escapeHtml(label) + '</span>' +
      '<span style="color:var(--text)">' + escapeHtml(String(value || '')) + '</span>' +
      '</div>';
  }

  // ---------------------------------------------------------------------------
  // Live snapshot data (no API calls — DOM + state only)
  // ---------------------------------------------------------------------------

  function moodLabel(v) {
    var n = Number(v) || 0;
    if (n <= 2) return 'Sad';
    if (n === 3) return 'Neutral';
    return 'Happy';
  }
  function arousalLabel(v) {
    var n = Number(v) || 0;
    if (n <= 3) return 'Calm';
    if (n <= 7) return 'Aroused';
    return 'Intense';
  }

  var presentCards = Array.from(
    document.querySelectorAll('#portrait-list .portrait-card:not(.portrait-scene-card):not(.offscene)')
  );

  var presentNamesHtml = presentCards.length
    ? presentCards.map(function (card) { return escapeHtml(card.dataset.charName || '?'); }).join(', ')
    : '<span style="color:var(--text-muted)">None</span>';

  var charStatesHtml = '';
  if (presentCards.length) {
    charStatesHtml = presentCards.map(function (card) {
      var charId   = card.dataset.charId;
      var charName = card.dataset.charName || '?';
      var cs       = (charId && state.characterStates && state.characterStates[charId]) || {};
      var mood     = cs.moodcurrent    != null ? moodLabel(cs.moodcurrent)    : 'Unknown';
      var arousal  = cs.arousalcurrent != null ? arousalLabel(cs.arousalcurrent) : 'Unknown';
      var clothing = String(cs.current_clothing || '').trim();
      return '<div style="margin-bottom:4px">' +
        '<span style="font-weight:500;color:var(--text)">' + escapeHtml(charName) + '</span>' +
        '<span style="color:var(--text-muted);font-size:11px"> &mdash; Mood: ' + escapeHtml(mood) +
          ' | Arousal: ' + escapeHtml(arousal) +
          (clothing ? ' | ' + escapeHtml(clothing) : '') +
        '</span>' +
      '</div>';
    }).join('');
  }

  var snapshotRows =
    '<hr style="border:none;border-top:1px solid var(--border);margin:10px 0 6px">' +
    infoRow('Scene Setting', scenario.setting || '-') +
    infoRow('Turn Count', String(state.turns.length)) +
    '<div class="setting-row">' +
      '<span style="font-weight:600;color:var(--text-muted);min-width:140px">In Scene</span>' +
      '<span style="color:var(--text)">' + presentNamesHtml + '</span>' +
    '</div>' +
    (charStatesHtml
      ? '<div class="setting-row" style="align-items:flex-start">' +
          '<span style="font-weight:600;color:var(--text-muted);min-width:140px">Char States</span>' +
          '<div style="flex:1">' + charStatesHtml + '</div>' +
        '</div>'
      : '');

  // ---------------------------------------------------------------------------

  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML =
    '<div class="modal modal-wide">' +
      '<h3 class="modal-title">Scene Info</h3>' +
      '<div class="si-panel" id="si-panel-info">' +
        '<div class="settings-grid" style="padding:8px 0">' +
          infoRow('Title', scenario.title || '-') +
          (scenario.premise
            ? '<div class="setting-row" style="align-items:flex-start">' +
                '<span style="font-weight:600;color:var(--text-muted);min-width:140px">Premise</span>' +
                '<p style="font-size:13px;color:var(--text-muted);margin:0;line-height:1.5;white-space:pre-wrap;flex:1">' + escapeHtml(scenario.premise) + '</p>' +
              '</div>'
            : '') +
          infoRow('Location', locationName) +
          infoRow('Reply Length', scenario.reply_length || 'medium') +
          infoRow('Tone', scenario.tone || '-') +
          infoRow('NSFW', scenario.nsfw_enabled ? 'Yes' : 'No') +
          snapshotRows +
        '</div>' +
      '</div>' +

      '<div class="modal-footer">' +
        '<button class="btn btn-primary" id="close-scene-info">Close</button>' +
      '</div>' +
    '</div>';

  overlay.classList.remove('hidden');

  document.getElementById('close-scene-info').onclick = function () { overlay.classList.add('hidden'); };
  overlay.onclick = function (e) { if (e.target === overlay) overlay.classList.add('hidden'); };
}

function showRecapPanel(recap) {
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML =
    '<div class="modal modal-wide">' +
      '<h3 class="modal-title">Story Recap</h3>' +
      '<div class="recap-content">' +
        (recap.memory_summary
          ? '<div class="recap-section"><h4>Memory Summary</h4><p>' + escapeHtml(recap.memory_summary) + '</p></div>'
          : '') +
        (recap.scene_card
          ? '<div class="recap-section"><h4>Scene Card</h4><pre class="code-block">' + escapeHtml(JSON.stringify(recap.scene_card, null, 2)) + '</pre></div>'
          : '') +
      '</div>' +
      '<div class="modal-footer"><button class="btn btn-primary" id="close-recap">Close</button></div>' +
    '</div>';
  overlay.classList.remove('hidden');
  document.getElementById('close-recap').onclick = function () { overlay.classList.add('hidden'); };
  overlay.onclick = function (e) { if (e.target === overlay) overlay.classList.add('hidden'); };
}

/* ============================================================
   SIDEBAR TABS
   ============================================================ */
function loadSidebarTab(tab, scenarioId) {
  var content = document.getElementById('sidebar-content');
  if (!content) return;
  content.innerHTML = '<div class="loading-state small">Loading...</div>';
  if      (tab === 'memory')   renderMemoryTab(content, scenarioId);
  else if (tab === 'lore')     renderLoreTab(content, scenarioId);
  else if (tab === 'rules')    renderRulesTab(content, scenarioId);
  else if (tab === 'cast')     renderCastTab(content, scenarioId);
  else if (tab === 'rel')      renderRelationshipsTab(content, scenarioId);
  else if (tab === 'loc')      renderLocationTab(content, scenarioId);
}

function renderMemoryTab(container, scenarioId) {
  Promise.all([
    API.getTurns(scenarioId),
    API.getMemories(scenarioId)
  ]).then(function (results) {
    var allTurns   = Array.isArray(results[0]) ? results[0] : (results[0].turns || []);
    var memData    = results[1];
    var memories   = Array.isArray(memData) ? memData : (memData.memories || []);
    var manualMems = memories.filter(function (m) { return m.memory_type === 'manual'; });
    var summary    = null; // auto-summary field not present on turns

    container.innerHTML =
      '<div class="sidebar-tab-content">' +
        '<div class="tab-header">' +
          '<h4>Memory</h4>' +
          '<button class="btn btn-ghost btn-xs" id="btn-add-memory">+ Add Memory</button>' +
        '</div>' +

        '<div id="memory-add-form" class="inline-form hidden">' +
          '<textarea class="form-input form-input-sm" id="memory-content" rows="3" placeholder="Always-true fact to pin..."></textarea>' +
          '<div class="inline-form-actions">' +
            '<button class="btn btn-ghost btn-xs" id="memory-form-cancel">Cancel</button>' +
            '<button class="btn btn-primary btn-xs" id="memory-form-save">Save</button>' +
          '</div>' +
        '</div>' +

        (manualMems.length > 0
          ? '<div class="memory-pinned-section">' +
              '<div class="memory-section-label">&#128204; Pinned</div>' +
              manualMems.map(function (m) {
                return '<div class="memory-pinned-entry" data-id="' + m.id + '">' +
                  '<p class="memory-pinned-text">' + escapeHtml(m.content) + '</p>' +
                  '<button class="btn-mem-delete" data-id="' + m.id + '" title="Remove">&#215;</button>' +
                '</div>';
              }).join('') +
            '</div>'
          : ''
        ) +

        '<div class="memory-auto-section">' +
          '<div class="tab-subheader">' +
            '<span class="tab-subheader-label">Auto Summary</span>' +
            '<button class="btn btn-ghost btn-xs" id="btn-force-summary">Force</button>' +
          '</div>' +
          (summary
            ? '<div class="memory-text story-font">' + formatStoryContent(summary) + '</div>'
            : '<div class="empty-state small">No memory summaries yet.</div>'
          ) +
        '</div>' +
      '</div>';

    container.querySelector('#btn-add-memory').onclick = function () {
      container.querySelector('#memory-add-form').classList.toggle('hidden');
    };
    container.querySelector('#memory-form-cancel').onclick = function () {
      container.querySelector('#memory-add-form').classList.add('hidden');
    };
    container.querySelector('#memory-form-save').onclick = function () {
      var content = container.querySelector('#memory-content').value.trim();
      if (!content) { showToast('Memory content required.', 'error'); return; }
      API.createManualMemory(scenarioId, content)
        .then(function () {
          showToast('Memory pinned!', 'success');
          renderMemoryTab(container, scenarioId);
        })
        .catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
    };

    var forceBtn = container.querySelector('#btn-force-summary');
    if (forceBtn) {
      forceBtn.onclick = function () {
        showToast('Force summary is not yet implemented.', 'info');
      };
    }

    container.querySelectorAll('.btn-mem-delete').forEach(function (btn) {
      btn.onclick = function () {
        API.deleteMemory(scenarioId, btn.dataset.id)
          .then(function () {
            var entry = container.querySelector('.memory-pinned-entry[data-id="' + btn.dataset.id + '"]');
            if (entry) entry.parentNode.removeChild(entry);
            showToast('Memory removed.', 'info');
            if (!container.querySelectorAll('.memory-pinned-entry').length) {
              renderMemoryTab(container, scenarioId);
            }
          })
          .catch(function (e) { showToast('Delete failed: ' + e.message, 'error'); });
      };
    });

  }).catch(function (e) {
    container.innerHTML = '<div class="error-state">Failed: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderLoreTab(container, scenarioId) {
  API.getWorldEntries(scenarioId).then(function (data) {
    var entries = Array.isArray(data) ? data : (data.entries || data.worldEntries || []);
    container.innerHTML =
      '<div class="sidebar-tab-content">' +
        '<div class="tab-header">' +
          '<h4>World Lore</h4>' +
          '<button class="btn btn-ghost btn-xs" id="btn-add-lore">+ Add</button>' +
        '</div>' +
        '<div id="lore-add-form" class="inline-form hidden">' +
          '<input type="text" class="form-input form-input-sm" id="lore-title" placeholder="Title">' +
          '<textarea class="form-input form-input-sm" id="lore-content" rows="3" placeholder="Content..."></textarea>' +
          '<div class="inline-form-actions">' +
            '<button class="btn btn-ghost btn-xs" id="lore-form-cancel">Cancel</button>' +
            '<button class="btn btn-primary btn-xs" id="lore-form-save">Save</button>' +
          '</div>' +
        '</div>' +
        '<div class="lore-list">' +
          (entries.length
            ? entries.map(function (e) {
                return '<div class="lore-entry">' +
                  '<div class="lore-header">' +
                    '<strong>' + escapeHtml(e.title) + '</strong>' +
                    '<label class="toggle-sm">' +
                      '<input type="checkbox" class="lore-toggle-input" data-id="' + e.id + '"' + (e.enabled !== false ? ' checked' : '') + '>' +
                      '<span class="toggle-sm-track"></span>' +
                    '</label>' +
                  '</div>' +
                  '<p class="lore-excerpt">' + escapeHtml((e.content || '').slice(0, 120)) + ((e.content || '').length > 120 ? '...' : '') + '</p>' +
                '</div>';
              }).join('')
            : '<div class="empty-state small">No lore entries yet.</div>'
          ) +
        '</div>' +
      '</div>';

    container.querySelector('#btn-add-lore').onclick = function () {
      container.querySelector('#lore-add-form').classList.toggle('hidden');
    };
    container.querySelector('#lore-form-cancel').onclick = function () {
      container.querySelector('#lore-add-form').classList.add('hidden');
    };
    container.querySelector('#lore-form-save').onclick = function () {
      var t = container.querySelector('#lore-title').value.trim();
      var c = container.querySelector('#lore-content').value.trim();
      if (!t || !c) { showToast('Title and content required.', 'error'); return; }
      API.createWorldEntry(scenarioId, { title: t, content: c })
        .then(function () { showToast('Lore added!', 'success'); renderLoreTab(container, scenarioId); })
        .catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
    };
    container.querySelectorAll('.lore-toggle-input').forEach(function (inp) {
      inp.onchange = function () {
        API.updateWorldEntry(scenarioId, inp.dataset.id, { enabled: inp.checked }).catch(function (e) {
          showToast('Toggle failed: ' + e.message, 'error');
        });
      };
    });
  }).catch(function (e) {
    container.innerHTML = '<div class="error-state">Failed: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderRulesTab(container, scenarioId) {
  API.getRules(scenarioId).then(function (data) {
    var rules = Array.isArray(data) ? data : (data.rules || []);
    container.innerHTML =
      '<div class="sidebar-tab-content">' +
        '<div class="tab-header">' +
          '<h4>Rules</h4>' +
          '<button class="btn btn-ghost btn-xs" id="btn-add-rule">+ Add</button>' +
        '</div>' +
        '<div id="rule-add-form" class="inline-form hidden">' +
          '<textarea class="form-input form-input-sm" id="rule-text" rows="2" placeholder="Rule text..."></textarea>' +
          '<div class="inline-form-actions">' +
            '<button class="btn btn-ghost btn-xs" id="rule-form-cancel">Cancel</button>' +
            '<button class="btn btn-primary btn-xs" id="rule-form-save">Save</button>' +
          '</div>' +
        '</div>' +
        '<div class="rules-list">' +
          (rules.length
            ? rules.map(function (r) {
                return '<div class="rule-entry" data-rule-id="' + r.id + '">' +
                  '<p class="rule-text">' + escapeHtml(r.content) + '</p>' +
                  '<div class="rule-controls">' +
                    '<label class="toggle-sm">' +
                      '<input type="checkbox" class="rule-toggle-input" data-id="' + r.id + '"' + (r.enabled !== false ? ' checked' : '') + '>' +
                      '<span class="toggle-sm-track"></span>' +
                    '</label>' +
                    '<button class="btn-rule-delete" data-id="' + r.id + '" title="Delete rule">&#215;</button>' +
                  '</div>' +
                  '<div class="rule-del-confirm hidden">' +
                    '<span class="rule-del-msg">Delete this rule?</span>' +
                    '<button class="rule-del-yes btn btn-danger btn-xs" data-id="' + r.id + '">Delete</button>' +
                    '<button class="rule-del-no btn btn-ghost btn-xs">Cancel</button>' +
                  '</div>' +
                '</div>';
              }).join('')
            : '<div class="empty-state small">No rules yet.</div>'
          ) +
        '</div>' +
      '</div>';

    container.querySelector('#btn-add-rule').onclick = function () {
      container.querySelector('#rule-add-form').classList.toggle('hidden');
    };
    container.querySelector('#rule-form-cancel').onclick = function () {
      container.querySelector('#rule-add-form').classList.add('hidden');
    };
    container.querySelector('#rule-form-save').onclick = function () {
      var t = container.querySelector('#rule-text').value.trim();
      if (!t) { showToast('Rule text required.', 'error'); return; }
      API.createRule(scenarioId, { content: t })
        .then(function () { showToast('Rule added!', 'success'); renderRulesTab(container, scenarioId); })
        .catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
    };
    container.querySelectorAll('.rule-toggle-input').forEach(function (inp) {
      inp.onchange = function () {
        API.updateRule(scenarioId, inp.dataset.id, { enabled: inp.checked }).catch(function (e) {
          showToast('Toggle failed: ' + e.message, 'error');
        });
      };
    });

    container.querySelectorAll('.btn-rule-delete').forEach(function (btn) {
      btn.onclick = function () {
        var entry = btn.closest('.rule-entry');
        if (entry) entry.querySelector('.rule-del-confirm').classList.toggle('hidden');
      };
    });
    container.querySelectorAll('.rule-del-no').forEach(function (btn) {
      btn.onclick = function () {
        btn.closest('.rule-del-confirm').classList.add('hidden');
      };
    });
    container.querySelectorAll('.rule-del-yes').forEach(function (btn) {
      btn.onclick = function () {
        API.deleteRule(scenarioId, btn.dataset.id)
          .then(function () {
            var entry = btn.closest('.rule-entry');
            if (entry) entry.parentNode.removeChild(entry);
            showToast('Rule deleted.', 'info');
          })
          .catch(function (e) { showToast('Delete failed: ' + e.message, 'error'); });
      };
    });
  }).catch(function (e) {
    container.innerHTML = '<div class="error-state">Failed: ' + escapeHtml(e.message) + '</div>';
  });
}

function renderCastTab(container, scenarioId) {
  _loadCharacterStates(scenarioId).then(function () {
    return Promise.all([
      API.getScenarioCharacters(scenarioId),
      API.getRelationships(),
      API.getScenarioRelationships(scenarioId),
    ]);
  }).then(function (results) {
    var data = results[0];
    var chars = Array.isArray(data) ? data : [];
    var charIds = new Set(chars.map(function (c) { return c.id; }));
    _cachedRelationships = _mergeScenarioRelationships(results[1] || [], results[2] || [], charIds);
    chars.forEach(function (c) {
      if (!state.characterStates[c.id]) state.characterStates[c.id] = {};
      state.characterStates[c.id].current_clothing = String(c.scenario_clothing || c.current_clothing || c.starting_clothing || '').trim();
      state.characterStates[c.id].base_clothing = String(c.starting_clothing || c.base_clothing || '').trim();
      state.characterStates[c.id].starting_clothing = String(c.starting_clothing || '').trim();
      state.characterStates[c.id].starting_clothing_set_name = c.starting_clothing_set_name || null;
      if (state.characterStates[c.id].moodcurrent == null) state.characterStates[c.id].moodcurrent = c.moodbaseline != null ? c.moodbaseline : 3;
      if (state.characterStates[c.id].arousalcurrent == null) state.characterStates[c.id].arousalcurrent = 1;
    });

    var rosterIds = chars.map(function (c) { return c.id; });

    container.innerHTML =
      '<div class="sidebar-tab-content">' +
        '<div class="tab-header" style="display:flex;align-items:center;justify-content:space-between">' +
          '<h4>Cast</h4>' +
          '<button class="btn btn-ghost btn-xs" id="cast-tab-add-btn" title="Add a character to this story">+ Add</button>' +
        '</div>' +
        (_playConfigEnabled('scene_heat_readout_enabled', true) ? '<div id="cast-scene-heat" style="font-size:11px;color:var(--text-muted);margin-bottom:6px"></div>' : '') +
        '<div id="cast-tab-add-panel" style="display:none;padding:6px 0 8px">' +
          '<input type="text" class="form-input" id="cast-tab-search" placeholder="Search characters..." style="font-size:12px;margin-bottom:4px">' +
          '<div id="cast-tab-avail-list" style="max-height:160px;overflow-y:auto"></div>' +
          '<button class="btn btn-ghost btn-xs" id="cast-tab-add-close" style="margin-top:4px">Close</button>' +
        '</div>' +
        '<div class="cast-cards">' +
          (chars.length
            ? chars.map(function (c) {
                var isNpc = !c.is_user_character;
                return '<div class="cast-card" data-char-id="' + c.id + '" style="align-items:flex-start">' +
                  avatarHtml(c) +
                  '<div class="cast-card-info" style="flex:1;min-width:0">' +
                    '<div class="cast-card-name">' + escapeHtml(c.name) +
                      '<span class="badge ' + (c.is_user_character ? 'badge-accent' : 'badge-muted') + ' badge-xs">' +
                        (c.is_user_character ? 'You' : 'NPC') +
                      '</span>' +
                    '</div>' +
                    (c.appearance_notes
                      ? '<div class="cast-card-notes">' + escapeHtml(c.appearance_notes.slice(0, 80)) + (c.appearance_notes.length > 80 ? '…' : '') + '</div>'
                      : '') +
                    (isNpc ? _buildMoodBarsHtml(c.id) + _buildClothingHtml(c.id) : '') +
                    _buildTriggerChipsHtml(c) +
                    _buildBondFocusHtml(c.id, chars, _cachedRelationships) +
                  '</div>' +
                  '<button class="btn btn-ghost btn-xs cast-tab-remove-btn" ' +
                    'data-char-id="' + c.id + '" data-char-name="' + escapeHtml(c.name) + '" ' +
                    'style="flex-shrink:0;color:var(--text-muted)" title="Remove from story">&times;</button>' +
                '</div>';
              }).join('')
            : '<div class="empty-state small">No characters in this story.</div>'
          ) +
        '</div>' +
      '</div>';

    // Delegated mood +/- handler
    container.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.mood-adj-btn') : null;
      if (!btn || btn.disabled) return;
      var charId  = Number(btn.dataset.charId);
      var field   = btn.dataset.field;
      var dir     = Number(btn.dataset.dir);
      var cs      = state.characterStates[charId];
      if (!cs) return;
      var current = field === 'mood' ? Number(cs.moodcurrent) : Number(cs.arousalcurrent);
      var ceiling = field === 'arousal' ? 10 : 5;
      var newVal  = Math.min(ceiling, Math.max(1, current + dir));
      if (newVal === current) return;
      var updated = { moodcurrent: cs.moodcurrent, arousalcurrent: cs.arousalcurrent };
      updated[field === 'mood' ? 'moodcurrent' : 'arousalcurrent'] = newVal;
      state.characterStates[charId] = updated;
      document.querySelectorAll('.mood-bars[data-char-id="' + charId + '"]').forEach(function (el) {
        el.outerHTML = _buildMoodBarsHtml(charId);
      });
      API.updateScenarioCharacterState(scenarioId, charId, {
        moodcurrent: updated.moodcurrent,
        arousalcurrent: updated.arousalcurrent
      }).catch(function (err) {
        state.characterStates[charId][field === 'mood' ? 'moodcurrent' : 'arousalcurrent'] = current;
        document.querySelectorAll('.mood-bars[data-char-id="' + charId + '"]').forEach(function (el) {
          el.outerHTML = _buildMoodBarsHtml(charId);
        });
        showToast('Failed to update mood: ' + err.message, 'error');
      });
    });

    // Remove buttons
    container.querySelectorAll('.cast-tab-remove-btn').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        if (chars.length <= 1) {
          showToast('A scenario needs at least one character.', 'info');
          return;
        }
        var charId   = Number(btn.dataset.charId);
        var charName = btn.dataset.charName || 'this character';
        showConfirm('Remove from Story', 'Remove ' + charName + ' from this story?', function () {
          API.removeCharacterFromScenario(scenarioId, charId)
            .then(function () {
              showToast(charName + ' removed.', 'info');
              renderCastTab(container, scenarioId);
            })
            .catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
        });
      };
    });

    // Add character inline panel
    var addBtn   = container.querySelector('#cast-tab-add-btn');
    var addPanel = container.querySelector('#cast-tab-add-panel');
    var searchEl = container.querySelector('#cast-tab-search');
    var availEl  = container.querySelector('#cast-tab-avail-list');
    var closeBtn = container.querySelector('#cast-tab-add-close');

    function renderAvailList(filter) {
      if (!availEl) return;
      var f = (filter || '').toLowerCase().trim();
      API.getCharacters().then(function (allData) {
        var all = Array.isArray(allData) ? allData : [];
        var filtered = all.filter(function (c) {
          return rosterIds.indexOf(c.id) < 0 && (!f || c.name.toLowerCase().indexOf(f) !== -1);
        });
        if (!filtered.length) {
          availEl.innerHTML = '<div class="empty-state small">' + (f ? 'No match.' : 'All characters in story.') + '</div>';
          return;
        }
        availEl.innerHTML = filtered.map(function (c) {
          return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border)">' +
            '<span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(c.name) + '</span>' +
            '<button class="btn btn-primary btn-xs cast-avail-add-btn" data-char-id="' + c.id + '" data-char-name="' + escapeHtml(c.name) + '">+</button>' +
          '</div>';
        }).join('');
        availEl.querySelectorAll('.cast-avail-add-btn').forEach(function (b) {
          b.onclick = function () {
            b.disabled = true;
            API.addCharacterToScenario(scenarioId, Number(b.dataset.charId))
              .then(function () {
                showToast(b.dataset.charName + ' added!', 'success');
                renderCastTab(container, scenarioId);
                if (_reloadPortraitPanel) reloadPromptPanelTargets(); refreshPromptPreview();
              })
              .catch(function (err) { b.disabled = false; showToast('Failed: ' + err.message, 'error'); });
          };
        });
      }).catch(function () {
        if (availEl) availEl.innerHTML = '<div class="error-state">Failed to load.</div>';
      });
    }

    if (addBtn && addPanel) {
      addBtn.onclick = function () {
        var isOpen = addPanel.style.display !== 'none';
        addPanel.style.display = isOpen ? 'none' : '';
        if (!isOpen) {
          renderAvailList('');
          if (searchEl) searchEl.focus();
        }
      };
    }
    if (searchEl) {
      searchEl.oninput = function () { renderAvailList(searchEl.value); };
    }
    if (closeBtn) {
      closeBtn.onclick = function () { if (addPanel) addPanel.style.display = 'none'; };
    }

    container.querySelectorAll('.bond-focus-btn').forEach(function (btn) {
      btn.onclick = function () {
        var gi = document.getElementById('guidance-input');
        if (gi) {
          gi.value = btn.getAttribute('data-focus-text') || '';
          gi.focus();
        }
      };
    });
    refreshSceneHeatReadout();

  }).catch(function (e) {
    container.innerHTML = '<div class="error-state">Failed: ' + escapeHtml(e.message) + '</div>';
  });
}

/* ============================================================
   RELATIONSHIPS SIDEBAR TAB
   ============================================================ */
function renderRelationshipsTab(container, scenarioId) {
  var REL_TYPES = [
    'friend', 'romantic partner', 'rival', 'enemy', 'colleague',
    'mentor', 'student', 'cousin', 'mother', 'father', 'brother',
    'sister', 'neighbor',
  ];
  var REL_TAGS = ['attraction', 'trust', 'tension', 'history', 'taboo'];

  Promise.all([
    API.getRelationships(),
    API.getScenarioRelationships(scenarioId),
    API.getScenarioCharacters(scenarioId),
  ]).then(function (results) {
    var globals = Array.isArray(results[0]) ? results[0] : [];
    var scenarioRels = Array.isArray(results[1]) ? results[1] : [];
    var chars = Array.isArray(results[2]) ? results[2] : [];
    var charIds = new Set(chars.map(function (c) { return c.id; }));
    var rels = _mergeScenarioRelationships(globals, scenarioRels, charIds);
    _cachedRelationships = rels.slice();

    var charOpts = chars.map(function (c) {
      return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
    }).join('');
    var typeOpts = REL_TYPES.map(function (t) {
      return '<option value="' + t + '">' + t[0].toUpperCase() + t.slice(1) + '</option>';
    }).join('');
    var tagChecks = REL_TAGS.map(function (t) {
      return '<label style="font-size:11px;cursor:pointer"><input type="checkbox" class="rel-tag-cb" value="' + t + '"> ' + t + '</label>';
    }).join(' ');
    var strengthOpts = [1, 2, 3, 4, 5].map(function (s) {
      return '<option value="' + s + '"' + (s === 3 ? ' selected' : '') + '>' + s + '</option>';
    }).join('');

    container.innerHTML =
      '<div class="sidebar-tab-content">' +
        '<div class="tab-header" style="display:flex;align-items:center;justify-content:space-between">' +
          '<h4>Relationships</h4>' +
          '<button class="btn btn-ghost btn-xs" id="btn-add-rel">+ Add</button>' +
        '</div>' +
        '<div id="rel-add-form" style="display:none;padding:6px 0 8px;border-bottom:1px solid var(--border);margin-bottom:8px">' +
          '<input type="hidden" id="rel-edit-id" value="">' +
          '<input type="hidden" id="rel-edit-source" value="">' +
          '<select class="form-input" id="rel-from" style="font-size:12px;margin-bottom:4px"><option value="">From...</option>' + charOpts + '</select>' +
          '<select class="form-input" id="rel-to" style="font-size:12px;margin-bottom:4px"><option value="">To...</option>' + charOpts + '</select>' +
          '<select class="form-input" id="rel-type" style="font-size:12px;margin-bottom:4px">' + typeOpts + '</select>' +
          '<select class="form-input" id="rel-strength" style="font-size:12px;margin-bottom:4px;width:80px" title="Intensity 1-5">' + strengthOpts + '</select>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px">' + tagChecks + '</div>' +
          '<input type="text" class="form-input" id="rel-desc" placeholder="Description (optional)" style="font-size:12px;margin-bottom:4px">' +
          '<label style="font-size:11px;display:block;margin-bottom:6px;cursor:pointer"><input type="checkbox" id="rel-scenario-override"> Save as scenario override</label>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn btn-ghost btn-xs" id="rel-form-cancel">Cancel</button>' +
            '<button class="btn btn-primary btn-xs" id="rel-form-save">Save</button>' +
          '</div>' +
        '</div>' +
        '<div class="rel-list">' +
          (rels.length
            ? rels.map(function (r) {
                var tagStr = (r.tags && r.tags.length) ? r.tags.join(', ') : '';
                var badge = r._source === 'scenario' ? 'scenario' : 'global';
                return '<div class="rel-entry" data-rel-id="' + r.id + '" data-rel-source="' + badge + '" ' +
                  'style="display:flex;flex-direction:column;padding:6px 0;border-bottom:1px solid var(--border)">' +
                  '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
                    '<strong style="font-size:12px">' + escapeHtml(r.from_name) + '</strong>' +
                    '<span style="font-size:10px;padding:1px 5px;border-radius:8px;background:var(--bg-secondary);color:var(--text-muted)">' + escapeHtml(r.relationship_type) + '</span>' +
                    '<strong style="font-size:12px">' + escapeHtml(r.to_name) + '</strong>' +
                    '<span class="badge badge-xs ' + (badge === 'scenario' ? 'badge-accent' : 'badge-muted') + '">' + badge + '</span>' +
                    '<span style="font-size:10px;color:var(--text-muted)">[' + (r.strength || 3) + '/5]</span>' +
                    (tagStr ? '<span style="font-size:10px;color:var(--text-muted)">(' + escapeHtml(tagStr) + ')</span>' : '') +
                    '<button class="btn-rel-edit" data-rel-id="' + r.id + '" data-rel-source="' + badge + '" style="margin-left:auto;background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px">Edit</button>' +
                    '<button class="btn-rel-delete" data-rel-id="' + r.id + '" data-rel-source="' + badge + '" ' +
                      'style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;line-height:1;padding:0 2px" title="Delete">&#215;</button>' +
                  '</div>' +
                  (r.description ? '<span style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escapeHtml(r.description) + '</span>' : '') +
                '</div>';
              }).join('')
            : '<div class="empty-state small">No relationships defined yet.</div>'
          ) +
        '</div>' +
      '</div>';

    function _getRelTags() {
      var tags = [];
      container.querySelectorAll('.rel-tag-cb:checked').forEach(function (cb) { tags.push(cb.value); });
      return tags;
    }
    function _setRelTags(tags) {
      var set = {};
      (tags || []).forEach(function (t) { set[String(t).toLowerCase()] = true; });
      container.querySelectorAll('.rel-tag-cb').forEach(function (cb) { cb.checked = !!set[cb.value]; });
    }
    function _clearRelForm() {
      var editId = container.querySelector('#rel-edit-id');
      var editSrc = container.querySelector('#rel-edit-source');
      if (editId) editId.value = '';
      if (editSrc) editSrc.value = '';
      var saveBtn = container.querySelector('#rel-form-save');
      if (saveBtn) saveBtn.textContent = 'Save';
    }

    var addBtn = container.querySelector('#btn-add-rel');
    var addForm = container.querySelector('#rel-add-form');
    if (addBtn && addForm) {
      addBtn.onclick = function () {
        var open = addForm.style.display !== 'none';
        if (open) { addForm.style.display = 'none'; _clearRelForm(); }
        else { addForm.style.display = ''; _clearRelForm(); _setRelTags([]); }
      };
    }
    var cancelBtn = container.querySelector('#rel-form-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = function () { if (addForm) addForm.style.display = 'none'; _clearRelForm(); };
    }

    var saveBtn = container.querySelector('#rel-form-save');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var fromEl = container.querySelector('#rel-from');
        var toEl = container.querySelector('#rel-to');
        var typeEl = container.querySelector('#rel-type');
        var strEl = container.querySelector('#rel-strength');
        var descEl = container.querySelector('#rel-desc');
        var overrideEl = container.querySelector('#rel-scenario-override');
        var editIdEl = container.querySelector('#rel-edit-id');
        var editSrcEl = container.querySelector('#rel-edit-source');
        var from = fromEl ? Number(fromEl.value) : 0;
        var to = toEl ? Number(toEl.value) : 0;
        if (!from || !to) { showToast('Select both characters.', 'error'); return; }
        if (from === to) { showToast('A character cannot have a relationship with themselves.', 'error'); return; }
        var payload = {
          from_character_id: from,
          to_character_id: to,
          relationship_type: typeEl ? typeEl.value : 'friend',
          description: descEl ? descEl.value.trim() : '',
          strength: strEl ? Number(strEl.value) : 3,
          tags: _getRelTags(),
        };
        var editId = editIdEl ? Number(editIdEl.value) : 0;
        var editSource = editSrcEl ? editSrcEl.value : '';
        var asScenario = overrideEl && overrideEl.checked;
        var useScenarioApi = asScenario || editSource === 'scenario';
        saveBtn.disabled = true;
        var req;
        if (editId) {
          req = useScenarioApi
            ? API.updateScenarioRelationship(scenarioId, editId, payload)
            : API.updateRelationship(editId, payload);
        } else {
          req = useScenarioApi
            ? API.createScenarioRelationship(scenarioId, payload)
            : API.createRelationship(payload);
        }
        req.then(function () {
          showToast(editId ? 'Relationship updated.' : 'Relationship added!', 'success');
          renderRelationshipsTab(container, scenarioId);
        }).catch(function (err) {
          saveBtn.disabled = false;
          showToast('Failed: ' + err.message, 'error');
        });
      };
    }

    container.querySelectorAll('.btn-rel-edit').forEach(function (btn) {
      btn.onclick = function () {
        var rid = Number(btn.dataset.relId);
        var rel = rels.find(function (r) { return Number(r.id) === rid; });
        if (!rel || !addForm) return;
        addForm.style.display = '';
        var editId = container.querySelector('#rel-edit-id');
        var editSrc = container.querySelector('#rel-edit-source');
        if (editId) editId.value = String(rid);
        if (editSrc) editSrc.value = rel._source || 'global';
        var fromEl = container.querySelector('#rel-from');
        var toEl = container.querySelector('#rel-to');
        if (fromEl) fromEl.value = String(rel.from_character_id);
        if (toEl) toEl.value = String(rel.to_character_id);
        var typeEl = container.querySelector('#rel-type');
        if (typeEl) typeEl.value = rel.relationship_type || 'friend';
        var strEl = container.querySelector('#rel-strength');
        if (strEl) strEl.value = String(rel.strength || 3);
        _setRelTags(rel.tags || []);
        var descEl = container.querySelector('#rel-desc');
        if (descEl) descEl.value = rel.description || '';
        var overrideEl = container.querySelector('#rel-scenario-override');
        if (overrideEl) overrideEl.checked = rel._source === 'scenario';
        var saveBtn2 = container.querySelector('#rel-form-save');
        if (saveBtn2) saveBtn2.textContent = 'Update';
      };
    });

    container.querySelectorAll('.btn-rel-delete').forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm('Delete this relationship?')) return;
        btn.disabled = true;
        var rid = Number(btn.dataset.relId);
        var src = btn.dataset.relSource;
        var delReq = src === 'scenario'
          ? API.deleteScenarioRelationship(scenarioId, rid)
          : API.deleteRelationship(rid);
        delReq.then(function () {
          showToast('Relationship removed.', 'info');
          renderRelationshipsTab(container, scenarioId);
        }).catch(function (err) { btn.disabled = false; showToast('Failed: ' + err.message, 'error'); });
      };
    });

  }).catch(function (e) {
    container.innerHTML = '<div class="error-state">Failed: ' + escapeHtml(e.message) + '</div>';
  });
}

/* ============================================================
   LOCATION SIDEBAR TAB
   ============================================================ */
function renderLocationTab(container, scenarioId) {
  var locs    = state.allLocations || [];
  var sc      = state.currentScenario;
  var activeId = sc ? sc.active_location_id : null;

  function buildItems() {
    if (!locs.length) {
      return '<p style="font-size:13px;color:var(--text-muted);padding:8px 0">' +
        'No locations linked to this scenario.' +
        '</p>';
    }
    return '<div class="loc-tab-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px">' +
      locs.map(function (l) {
        var isActive = l.id === activeId;
        return '<div class="loc-tab-item" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;background:' +
          (isActive ? 'var(--accent-muted,rgba(100,180,255,.15))' : 'var(--bg-card,#1e1e2e)') + ';border:1px solid ' +
          (isActive ? 'var(--accent,#64b4ff)' : 'var(--border,#333)') + '">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:' + (isActive ? '600' : '400') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
              escapeHtml(l.name) +
              (isActive ? ' <span style="font-size:11px;color:var(--accent,#64b4ff)">(active)</span>' : '') +
            '</div>' +
            (l.time_of_day && l.time_of_day !== 'any'
              ? '<div style="font-size:11px;color:var(--text-muted)">' + escapeHtml(l.time_of_day) + '</div>'
              : '') +
          '</div>' +
          (isActive
            ? '<button class="btn btn-ghost btn-xs loc-tab-clear" style="white-space:nowrap">Clear</button>'
            : '<button class="btn btn-xs btn-secondary loc-tab-set" data-locid="' + l.id + '" style="white-space:nowrap">Set</button>') +
        '</div>';
      }).join('') +
    '</div>';
  }

  container.innerHTML =
    '<div style="padding:4px 0">' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">' +
        'Set the active location for narrator context.' +
      '</div>' +
      buildItems() +
    '</div>';

  container.querySelectorAll('.loc-tab-set').forEach(function (btn) {
    btn.onclick = function () {
      var locId = Number(btn.dataset.locid);
      btn.disabled = true;
      API.setScenarioActiveLocation(scenarioId, locId)
        .then(function () {
          if (sc) sc.active_location_id = locId;
          renderLocationTab(container, scenarioId);
          var loc = locs.find(function (l) { return l.id === locId; });
          showToast('Location set: ' + escapeHtml(loc ? loc.name : String(locId)), 'success');
        })
        .catch(function (err) { btn.disabled = false; showToast('Failed: ' + err.message, 'error'); });
    };
  });

  container.querySelectorAll('.loc-tab-clear').forEach(function (btn) {
    btn.onclick = function () {
      btn.disabled = true;
      API.clearScenarioActiveLocation(scenarioId)
        .then(function () {
          if (sc) sc.active_location_id = null;
          renderLocationTab(container, scenarioId);
          showToast('Active location cleared.', 'info');
        })
        .catch(function (err) { btn.disabled = false; showToast('Failed: ' + err.message, 'error'); });
    };
  });
}

/* ============================================================
   MOOD / AROUSAL HELPERS
   ============================================================ */

// Fetches current character states for a scenario and caches them in state.characterStates
function _loadCharacterStates(scenarioId) {
  if (!scenarioId) return Promise.resolve();
  return API.getScenarioCharacterStates(scenarioId).then(function (data) {
    var states = (data && data.states) || [];
    states.forEach(function (s) {
      if (!state.characterStates[s.characterId]) state.characterStates[s.characterId] = {};
      state.characterStates[s.characterId].moodcurrent = s.moodcurrent;
      state.characterStates[s.characterId].arousalcurrent = s.arousalcurrent;
      if (s.current_clothing != null) {
        state.characterStates[s.characterId].current_clothing = String(s.current_clothing || '').trim();
      }
      if (s.starting_clothing != null) {
        state.characterStates[s.characterId].base_clothing = String(s.starting_clothing || '').trim();
        state.characterStates[s.characterId].starting_clothing = String(s.starting_clothing || '').trim();
      }
      if (s.starting_clothing_set_name != null) {
        state.characterStates[s.characterId].starting_clothing_set_name = s.starting_clothing_set_name;
      }
    });
  }).catch(function (err) {
    console.warn('[play] character states load failed', err);
  });
}

// Returns compact mood + arousal bar HTML with manual +/- override buttons
function _buildMoodBarsHtml(charId) {
  var cs = state.characterStates[charId];
  if (!cs) return '';
  var mood    = Math.min(5,  Math.max(1,  Number(cs.moodcurrent)    || 3));
  var arousal = Math.min(10, Math.max(1,  Number(cs.arousalcurrent) || 1));
  var moodPct    = ((mood    - 1) / 4 * 100).toFixed(0);
  var arousalPct = ((arousal - 1) / 9 * 100).toFixed(0);
  var moodColor    = mood >= 4 ? '#5cb85c' : mood <= 2 ? '#d9534f' : '#8a8aac';
  var arousalColor = arousal >= 8 ? '#e8a838' : arousal <= 2 ? '#444466' : '#8b6cf7';
  var moodLabels    = {1:'Hostile', 2:'Cold', 3:'Neutral', 4:'Warm', 5:'Open'};
  var arousalLabels = {1:'None', 2:'Hint', 3:'Aware', 4:'Tension', 5:'Desire', 6:'Staring', 7:'Touching', 8:'Reaching', 9:'Consumed', 10:'Peak'};
  var adjBtnStyle = 'display:inline-flex;align-items:center;justify-content:center;' +
    'width:16px;height:16px;font-size:11px;line-height:1;border:1px solid rgba(255,255,255,0.15);' +
    'border-radius:3px;background:rgba(255,255,255,0.07);color:var(--text-muted);' +
    'cursor:pointer;flex-shrink:0;padding:0;';
  var valStyle = 'font-size:10px;color:var(--text-muted);min-width:16px;text-align:right;flex-shrink:0;';
  return '<div class="mood-bars" data-char-id="' + charId + '" style="margin-top:4px">' +
    '<div class="mood-bar-row" style="display:flex;align-items:center;gap:4px;margin-bottom:2px">' +
      '<span class="mood-bar-label" style="font-size:10px;color:var(--text-muted);width:42px;flex-shrink:0"' +
        ' title="' + (moodLabels[mood]||'') + '">Mood</span>' +
      '<button class="mood-adj-btn" data-char-id="' + charId + '" data-field="mood" data-dir="-1"' +
        ' style="' + adjBtnStyle + '"' + (mood <= 1 ? ' disabled' : '') + ' title="Lower mood">-</button>' +
      '<div class="mood-bar-track" style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden">' +
        '<div style="width:' + moodPct + '%;height:100%;background:' + moodColor + ';border-radius:2px;transition:width 0.3s"></div>' +
      '</div>' +
      '<button class="mood-adj-btn" data-char-id="' + charId + '" data-field="mood" data-dir="1"' +
        ' style="' + adjBtnStyle + '"' + (mood >= 5 ? ' disabled' : '') + ' title="Raise mood">+</button>' +
      '<span style="' + valStyle + '" title="' + (moodLabels[mood]||'') + '">' + mood + '</span>' +
    '</div>' +
    '<div class="mood-bar-row" style="display:flex;align-items:center;gap:4px">' +
      '<span class="mood-bar-label" style="font-size:10px;color:var(--text-muted);width:42px;flex-shrink:0"' +
        ' title="' + (arousalLabels[arousal]||'') + '">Arousal</span>' +
      '<button class="mood-adj-btn" data-char-id="' + charId + '" data-field="arousal" data-dir="-1"' +
        ' style="' + adjBtnStyle + '"' + (arousal <= 1 ? ' disabled' : '') + ' title="Lower arousal">-</button>' +
      '<div class="mood-bar-track" style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden">' +
        '<div style="width:' + arousalPct + '%;height:100%;background:' + arousalColor + ';border-radius:2px;transition:width 0.3s"></div>' +
      '</div>' +
      '<button class="mood-adj-btn" data-char-id="' + charId + '" data-field="arousal" data-dir="1"' +
        ' style="' + adjBtnStyle + '"' + (arousal >= 10 ? ' disabled' : '') + ' title="Raise arousal">+</button>' +
      '<span style="' + valStyle + '" title="' + (arousalLabels[arousal]||'') + '">' + arousal + '</span>' +
    '</div>' +
  '</div>';
}

// Builds a compact clothing line with inline edit and reset buttons per NPC card.
// Returns empty string when no clothing is stored — hidden gracefully.
function _buildClothingHtml(charId) {
  var cs       = state.characterStates && state.characterStates[charId];
  var clothing = cs && cs.current_clothing ? String(cs.current_clothing).trim() : '';
  var base     = cs && cs.base_clothing   ? String(cs.base_clothing).trim()    : '';
  var canReset = base && clothing && base !== clothing;
  var display  = clothing || 'not set';
  return '<div class="clothing-state-wrap" data-char-id="' + charId + '" data-base-clothing="' + escapeHtml(base) + '">' +
    '<span class="clothing-state-text' + (clothing ? '' : ' text-muted') + '" title="' + (clothing ? 'Current clothing: ' + escapeHtml(clothing) : 'No clothing set') + '">' +
    escapeHtml(display) + '</span>' +
    '<button class="clothing-edit-btn" title="Override clothing" type="button">&#9998;</button>' +
    (canReset ? '<button class="clothing-reset-btn" title="Reset to starting outfit" type="button">&#8635;</button>' : '') +
    '</div>';
}

// Handles clothingupdate WS event — updates in-memory state and patches .clothing-state-wrap nodes.
function handleClothingUpdate(data) {
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
}

// ---- inline clothing edit helpers ----

function _startClothingEdit(wrap) {
  var span     = wrap.querySelector('.clothing-state-text');
  var charId   = parseInt(wrap.getAttribute('data-char-id'), 10);
  var current  = span ? span.textContent.trim() : '';
  if (current === 'not set') current = '';
  wrap.innerHTML =
    '<input class="clothing-edit-input" value="' + escapeHtml(current) + '" />' +
    '<button class="clothing-save-btn" title="Save" type="button">&#10003;</button>' +
    '<button class="clothing-cancel-btn" title="Cancel" type="button">&#10005;</button>';
  var input = wrap.querySelector('.clothing-edit-input');
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter')  { e.preventDefault(); _commitClothingEdit(wrap); }
      if (e.key === 'Escape') { e.preventDefault(); _cancelClothingEdit(wrap); }
    });
  }
}

function _commitClothingEdit(wrap) {
  var charId  = parseInt(wrap.getAttribute('data-char-id'), 10);
  var input   = wrap.querySelector('.clothing-edit-input');
  var scenId  = state.currentScenario && state.currentScenario.id;
  if (!input || !charId || !scenId) { _cancelClothingEdit(wrap); return; }
  var newVal  = input.value.trim();
  API.updateCharacterClothing(charId, { current_clothing: newVal, scenario_id: scenId, runtime: true })
    .then(function () {
      if (!state.characterStates[charId]) state.characterStates[charId] = {};
      state.characterStates[charId].current_clothing = newVal;
      _restoreClothingWrap(wrap, charId, newVal);
    })
    .catch(function (err) {
      console.error('clothing save failed', err);
      _cancelClothingEdit(wrap);
    });
}

function _cancelClothingEdit(wrap) {
  var charId   = parseInt(wrap.getAttribute('data-char-id'), 10);
  var cs       = state.characterStates && state.characterStates[charId];
  var clothing = cs && cs.current_clothing ? String(cs.current_clothing).trim() : '';
  _restoreClothingWrap(wrap, charId, clothing);
}

function _restoreClothingWrap(wrap, charId, clothing) {
  var base     = wrap.getAttribute('data-base-clothing') || '';
  var canReset = base && clothing && base !== clothing;
  var display  = clothing || 'not set';
  wrap.setAttribute('data-base-clothing', base);
  wrap.innerHTML =
    '<span class="clothing-state-text' + (clothing ? '' : ' text-muted') + '" title="' + (clothing ? 'Current clothing: ' + escapeHtml(clothing) : 'No clothing set') + '">' +
    escapeHtml(display) + '</span>' +
    '<button class="clothing-edit-btn" title="Override clothing" type="button">&#9998;</button>' +
    (canReset ? '<button class="clothing-reset-btn" title="Reset to starting outfit" type="button">&#8635;</button>' : '');
  wrap.style.display = '';
}

// Handles moodupdate WS event — updates in-memory state and refreshes bars in DOM
function handleMoodUpdate(data) {
  if (!data || !Array.isArray(data.characters)) return;
  if (!state.currentScenario || Number(state.currentScenario.id) !== Number(data.scenarioId)) return;
  data.characters.forEach(function (c) {
    if (!state.characterStates[c.characterId]) state.characterStates[c.characterId] = {};
    state.characterStates[c.characterId].moodcurrent    = c.moodcurrent;
    state.characterStates[c.characterId].arousalcurrent = c.arousalcurrent;
    var containers = document.querySelectorAll('.mood-bars[data-char-id="' + c.characterId + '"]');
    containers.forEach(function (el) {
      el.outerHTML = _buildMoodBarsHtml(c.characterId);
    });
  });
  if (data.gates && _playConfigEnabled('mood_gate_toasts_enabled', true)) {
    var gates = Array.isArray(data.gates) ? data.gates : [data.gates];
    gates.forEach(function (g) {
      var msg = typeof g === 'string' ? g : (g && (g.message || g.text || g.reason));
      if (msg) showToast(String(msg), 'info');
    });
  }
  refreshSceneHeatReadout();
}

/* ============================================================
   WEBSOCKET — live push from server
   ============================================================ */

// === WS CONNECTION (merged from play-ws-patch.js -- May 12 2026) ===

// ---------------------------------------------------------------------------
// connectWs -- exported. Called once at boot from app.js.
// ---------------------------------------------------------------------------
export function connectWs() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

  try {
    _ws = new WebSocket('ws://' + location.host + '/ws');
  } catch (e) {
    setTimeout(connectWs, _wsRetryDelay);
    return;
  }

  _ws.onopen = function () {
    _wsRetryDelay = 2000;
    if (window._updateStatusDots) window._updateStatusDots('ws', true);
  };

  _ws.onclose = function () {
    _ws = null;
    if (window._updateStatusDots) window._updateStatusDots('ws', false);
    setTimeout(connectWs, _wsRetryDelay);
    _wsRetryDelay = Math.min(_wsRetryDelay * 1.5, 30000);
  };

  _ws.onerror = function () {
    // onclose fires after onerror -- retry handled there
  };

  _ws.onmessage = function (evt) {
    var data;
    try { data = JSON.parse(evt.data); } catch (_) { return; }
    if (!data || !data.type) return;

    switch (data.type) {

      case 'turn_complete': {
        var tcPayload = data.payload || data;
        if (tcPayload.clothing_updates && tcPayload.clothing_updates.length) {
          handleClothingUpdate({ scenarioId: tcPayload.scenarioId, characters: tcPayload.clothing_updates });
        }
        ingestNarratorTurnFromWs(tcPayload.turn, tcPayload.scenarioId);
        break;
      }

      case 'turn_regenerated': {
        var trPayload = data.payload || data;
        if (!trPayload.turn || !state.currentScenario) break;
        if (Number(trPayload.scenarioId) !== Number(state.currentScenario.id)) break;
        if (trPayload.clothing_updates && trPayload.clothing_updates.length) {
          handleClothingUpdate({ scenarioId: trPayload.scenarioId, characters: trPayload.clothing_updates });
        }
        var trMapped = Object.assign({ speaker: trPayload.turn.role || 'narrator' }, trPayload.turn);
        _upsertTurnInState(trMapped);
        replaceOrAppendTurnElement(trMapped);
        _lastIngestedNarratorId = trPayload.turn.id;
        removeTypingIndicator();
        break;
      }

      case 'moodupdate': {
        var muPayload = data.payload || data;
        if (state.currentScenario && Number(muPayload.scenarioId) === Number(state.currentScenario.id)) {
          handleMoodUpdate(muPayload);
        }
        break;
      }

      case 'relationshipupdate': {
        var ruPayload = data.payload || data;
        if (state.currentScenario && Number(ruPayload.scenarioId) === Number(state.currentScenario.id)) {
          if (state.currentSidebarTab === 'rel' || state.currentSidebarTab === 'cast') {
            var sidebar = document.getElementById('sidebar-content');
            if (sidebar) loadSidebarTab(state.currentSidebarTab, state.currentScenario.id);
          }
        }
        break;
      }

      case 'clothingupdate': {
        var cuPayload = data.payload || data;
        if (state.currentScenario && Number(cuPayload.scenarioId) === Number(state.currentScenario.id)) {
          handleClothingUpdate(cuPayload);
        }
        break;
      }

      // Image generation always completes over WS, even if the requesting
      // browser tab moved on — insert into the originating turn's panel if
      // it's still on screen (harmless no-op otherwise).
      case 'imageready': {
        var irPayload = data.payload || data;
        if (state.currentScenario && Number(irPayload.scenarioId) === Number(state.currentScenario.id) && irPayload.image) {
          var irTurnId = irPayload.turnId;
          // Prefer the page-level image sidebar when it is open on this turn
          var irResultEl = null;
          if (state.imageGen && state.imageGen.open && Number(state.imageGen.turnId) === Number(irTurnId)) {
            irResultEl = document.getElementById('img-sidebar-result');
          }
          if (irResultEl && !irResultEl.querySelector('[data-image-id="' + irPayload.image.id + '"]')) {
            irResultEl.insertAdjacentHTML('afterbegin', _buildTurnImageCardHtml(irPayload.scenarioId, irPayload.image));
          }
        }
        break;
      }

      case 'presencechange':
        if (state.currentScenario && data.scenarioId === state.currentScenario.id) {
          if (_updateScenePresent) _updateScenePresent(data.added, data.removed);
          renderCharacterFocusButtons();
          if (data.added && data.added.length) {
            data.added.forEach(function (c) { showToast(c.name + ' has entered the scene.', 'info'); });
          }
          if (data.removed && data.removed.length) {
            data.removed.forEach(function (c) { showToast(c.name + ' has left the scene.', 'info'); });
          }
        }
        break;

      case 'timing_warn':
        showToast(data.message, 'warning');
        break;

      case 'command_response': {
        var crThread = document.getElementById('play-thread');
        if (crThread) {
          var crPill = document.createElement('div');
          crPill.className = 'system-command-msg' + (data.success ? '' : ' system-command-msg--error');
          crPill.textContent = data.message || '';
          crThread.appendChild(crPill);
          scrollThreadToBottom();
        } else {
          showToast(data.message || 'Command processed.', data.success ? 'info' : 'error');
        }
        break;
      }

      case 'logline':
        if (window._debugConsole && typeof window._debugConsole.push === 'function') window._debugConsole.push(data.payload || data);
        break;

      default:
        break;
    }
  };
}
