import { state, chatColors, getNpcColor } from '../state.js';
import { escapeHtml, formatStoryContent, avatarHtml, imageSrc } from '../utils.js';
import { showToast, showConfirm, setLoading, openLightbox, setImgStatus, statusDotsHtml } from '../ui.js';

var _ws = null;
var _wsRetryDelay = 2000;
var _reloadPortraitPanel = null;
var _updateScenePresent   = null;

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
        '<button class="btn btn-ghost btn-sm" id="btn-img-settings" title="Manage Image Styles">&#9881; Styles</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-reset-models" title="Unload narrator and extractor models from VRAM">Reset Models</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-scene-info">Scene Info</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-reset-scene">Reset Scene</button>' +
        '<button class="btn btn-danger btn-sm" id="btn-end-story">End Story</button>' +
      '</div>' +
    '</div>' +

    '<div class="play-container layout-' + state.playLayout + '" id="play-container">' +

      /* Sidebar */
      '<div class="play-sidebar' + (state.sidebarOpen ? '' : ' collapsed') + '" id="play-sidebar">' +
        '<div class="sidebar-tabs" id="sidebar-tabs">' +
          ['memory','lore','rules','cast','rel'].map(function (t) {
            var label = t === 'rel' ? 'Rels' : t[0].toUpperCase() + t.slice(1);
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
        '<div id="img-animate-section"></div>' +
        '<div id="scene-image-history" class="scene-image-history"></div>' +
        '<div class="play-input-area">' +
          '<div class="guidance-bar" id="guidance-bar">' +
            '<div class="guidance-row">' +
              '<div class="guidance-input-wrap">' +
                '<textarea class="guidance-input" id="guidance-input" placeholder="Guidance (optional) — steer what happens next..." rows="2" autocomplete="off"></textarea>' +
                '<button class="btn btn-ghost btn-sm guidance-enhance-btn" id="btn-enhance-guidance" title="Enhance guidance with AI">Enhance</button>' +
              '</div>' +
              '<div class="filter-rules-wrap">' +
                '<label class="filter-rules-label" for="filter-rules-input">Filter Rules</label>' +
                '<textarea class="filter-rules-input" id="filter-rules-input" placeholder="e.g. Keep to 2 paragraphs. Stop before next character responds." rows="2" autocomplete="off"></textarea>' +
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

      '<div class="play-portrait-panel' + (state.portraitPanelOpen ? '' : ' collapsed') + '" id="play-portrait-panel">' +
        '<button class="portrait-toggle-btn" id="portrait-toggle">' + (state.portraitPanelOpen ? '&raquo;' : '&laquo;') + '</button>' +
        '<div class="portrait-panel-inner" id="portrait-panel-inner">' +
          '<div class="portrait-panel-header">' +
            '<button class="cast-mgr-btn" id="btn-cast-add" title="Add a character to this scenario">+ Add</button>' +
            '<button class="cast-mgr-btn" id="btn-cast-remove" title="Remove a character from this scenario">- Remove</button>' +
          '</div>' +
          '<div class="cast-picker-bar" id="cast-picker-bar" style="display:none"></div>' +
          '<div class="portrait-guidance-wrap">' +
            '<textarea id="portrait-guidance" class="portrait-guidance-input" rows="2" placeholder="Optional direction for next image..."></textarea>' +
          '</div>' +
          '<div class="portrait-list" id="portrait-list"><div class="loading-state" style="font-size:11px;padding:8px;grid-column:span 2">Loading...</div></div>' +
          '<div class="portrait-status-bar">' +
            '<button class="portrait-status-btn" id="btn-portrait-status" title="Toggle scene presence edit mode — click portraits to mark who is in the scene">Status</button>' +
            '<button class="portrait-status-all" id="btn-portrait-all" title="Mark all characters as present in scene">All In</button>' +
          '</div>' +
        '</div>' +
        '<div class="portrait-resize-handle" id="portrait-resize-handle"></div>' +
      '</div>' +

    '</div>';

  /* Load data */
  Promise.all([API.getScenario(scenarioId), API.getTurns(scenarioId)])
    .then(function (results) {
      var scenResp = results[0];
      state.currentScenario = Object.assign(
        { characters: scenResp.characters || [] },
        scenResp.scenario || scenResp
      );
      state.allLocations = scenResp.locations || [];
      var rawTurns = Array.isArray(results[1]) ? results[1] : (results[1].turns || []);
      state.turns = rawTurns.map(function(t) { return Object.assign({ speaker: t.role }, t); });

      document.getElementById('play-scenario-title').textContent = state.currentScenario.title || 'Untitled Story';

      // Populate filter rules textarea from loaded scenario
      var _frInput = document.getElementById('filter-rules-input');
      if (_frInput) {
        try {
          var _frc = state.currentScenario.generation_config;
          var _frCfg = _frc ? (typeof _frc === 'string' ? JSON.parse(_frc) : _frc) : null;
          if (_frCfg && _frCfg.filterInstructions) _frInput.value = _frCfg.filterInstructions;
        } catch (_) {}
      }

      renderAllTurns();
      _populateSceneImageHistory();
      renderCharacterFocusButtons(scenarioId);
      loadSidebarTab(state.currentSidebarTab, scenarioId);
      // Pre-load emotional states so cast sidebar bars are ready on first render
      _loadCharacterStates(scenarioId);

      // Auto-submit default_start on fresh scenarios (no turns yet)
      var _defStart = state.turns.length === 0 && state.currentScenario && state.currentScenario.default_start;
      if (_defStart) {
        addTypingIndicator();
        API.postTurn(scenarioId, _defStart)
          .then(function (response) {
            removeTypingIndicator();
            var turns = [];
            if (response && response.user_turn) turns.push(Object.assign({ speaker: 'user' }, response.user_turn));
            if (response && response.narrator_turn) turns.push(Object.assign({ speaker: 'narrator' }, response.narrator_turn));
            state.turns = turns;
            renderAllTurns();
            scrollThreadToBottom();
          })
          .catch(function () { removeTypingIndicator(); });
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

// ---------------------------------------------------------------------------
// Thread image card helpers
// ---------------------------------------------------------------------------

// Build HTML string for a thread image card.
// meta: { filename, imageId, visualPrompt, videostatus, videoclipfilename }
function buildTurnImageHtml(meta) {
  var fn       = meta.filename          || '';
  var id       = meta.imageId           || '';
  var vp       = meta.visualPrompt      || '';
  var vs       = meta.videostatus       || '';
  var vcf      = meta.videoclipfilename || '';

  // Default motion variant from scenario generation_config
  var _gc = null;
  try {
    var _gcRaw = state.currentScenario && state.currentScenario.generation_config;
    if (_gcRaw) _gc = typeof _gcRaw === 'string' ? JSON.parse(_gcRaw) : _gcRaw;
  } catch (_) {}
  var defVariant = (_gc && _gc.videoMotionStyle) || 'lownoise';

  // Video element — always rendered, hidden until ready
  var videoHtml = '<video class="turn-img-video" autoplay loop muted playsinline ' +
    (vs === 'ready' && vcf
      ? 'style="width:100%;display:block;" src="' + escapeHtml(imageSrc(vcf)) + '"'
      : 'style="width:100%;display:none;"') +
    '></video>';

  // Animate overlay button — always rendered; hidden by CSS until hover; hidden while generating/ready
  var animBtnHide = (vs === 'generating' || vs === 'ready') ? ' style="display:none;"' : '';
  var animBtnHtml = '<button class="turn-img-animate-btn"' + animBtnHide + ' title="Animate this scene">&#9654; Clip</button>';

  // Status line text and class
  var statusText = '';
  var statusExtra = ' hidden';
  if (vs === 'generating') { statusText = 'Generating clip...'; statusExtra = ' turn-img-video-status-generating'; }
  else if (vs === 'ready') { statusText = 'Clip ready';          statusExtra = ' turn-img-video-status-ready'; }
  else if (vs === 'error') { statusText = 'Clip failed - retry'; statusExtra = ' turn-img-video-status-error'; }

  // Animate panel (variant + submit) — always rendered
  var animPanelHtml = '<div class="turn-img-animate-panel hidden">' +
      '<select class="turn-img-animate-variant">' +
        '<option value="lownoise"'  + (defVariant === 'lownoise'  ? ' selected' : '') + '>Low Motion</option>' +
        '<option value="highnoise"' + (defVariant === 'highnoise' ? ' selected' : '') + '>High Motion</option>' +
      '</select>' +
      '<button class="turn-img-animate-cancel-btn">Cancel</button>' +
      '<button class="turn-img-animate-submit-btn">Generate Clip</button>' +
    '</div>';

  return '<div class="turn-image"' +
    ' data-image-prompt="'    + escapeHtml(vp)        + '"' +
    ' data-image-filename="'  + escapeHtml(fn)        + '"' +
    (id  ? ' data-image-id="'           + escapeHtml(String(id))  + '"' : '') +
    ' data-video-status="'    + escapeHtml(vs)        + '"' +
    (vcf ? ' data-videoclipfilename="'  + escapeHtml(vcf)         + '"' : '') +
    '>' +
      '<div class="turn-image-wrap" style="max-width:520px;width:100%;overflow:hidden;margin:0 auto;position:relative;border-radius:10px;">' +
        videoHtml +
        '<img src="' + escapeHtml(imageSrc(fn)) + '" alt="Scene image" ' +
          'style="width:100%;display:block;cursor:zoom-in;" ' +
          'data-lightbox-src="' + escapeHtml(imageSrc(fn)) + '" />' +
        '<button class="turn-img-save-btn"    title="Download image">&#8595; Save</button>' +
        '<button class="turn-img-edit-btn"    title="Edit prompt and regenerate">&#9998; Edit</button>' +
        '<button class="turn-img-delete-btn"  title="Delete image">&#10005;</button>' +
        animBtnHtml +
      '</div>' +
      '<div class="turn-img-video-status' + statusExtra + '">' + escapeHtml(statusText) + '</div>' +
      animPanelHtml +
    '</div>';
}

// Update an existing thread image card's video UI in-place (no full re-render).
// videoState: { videostatus, videoclipfilename }
function _updateThreadImageVideoUi(cardEl, videoState) {
  if (!cardEl) return;
  var vs  = videoState.videostatus       || null;
  var vcf = videoState.videoclipfilename || null;

  var wrap      = cardEl.querySelector('.turn-image-wrap');
  var videoEl   = wrap  && wrap.querySelector('.turn-img-video');
  var statusEl  = cardEl.querySelector('.turn-img-video-status');
  var animBtn   = wrap  && wrap.querySelector('.turn-img-animate-btn');
  var animPanel = cardEl.querySelector('.turn-img-animate-panel');

  cardEl.dataset.videoStatus = vs || '';
  if (vcf) cardEl.dataset.videoclipfilename = vcf;

  if (vs === 'ready' && vcf) {
    if (videoEl) { videoEl.src = imageSrc(vcf); videoEl.style.display = 'block'; }
    if (statusEl) { statusEl.textContent = 'Clip ready'; statusEl.className = 'turn-img-video-status turn-img-video-status-ready'; }
    if (animBtn)  animBtn.style.display  = 'none';
    if (animPanel) animPanel.classList.add('hidden');
  } else if (vs === 'generating') {
    if (videoEl)  videoEl.style.display  = 'none';
    if (statusEl) { statusEl.textContent = 'Generating clip...'; statusEl.className = 'turn-img-video-status turn-img-video-status-generating'; }
    if (animBtn)  animBtn.style.display  = 'none';
    if (animPanel) animPanel.classList.add('hidden');
  } else if (vs === 'error') {
    if (videoEl)  videoEl.style.display  = 'none';
    if (statusEl) { statusEl.textContent = 'Clip failed - retry'; statusEl.className = 'turn-img-video-status turn-img-video-status-error'; }
    if (animBtn)  animBtn.style.display  = '';
  } else {
    if (videoEl)  videoEl.style.display  = 'none';
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'turn-img-video-status hidden'; }
    if (animBtn)  animBtn.style.display  = '';
  }
}

function createTurnElement(turn) {
  var isUser  = turn.speaker === 'user';
  var content = turn.content_text || turn.content || '';
  var div = document.createElement('div');
  div.className = 'turn ' + (isUser ? 'turn-user' : 'turn-narrator');
  div.dataset.turnId     = turn.id;
  div.dataset.turnNumber = turn.turn_number || '';

  var numHtml = '<div class="turn-meta-num">' + (turn.turn_number || '') + '</div>';

  if (isUser) {
    // Guidance-first: user turns are directives, not character speech
    div.innerHTML = numHtml +
      '<div class="turn-inner guidance-turn">' +
        '<div class="turn-header">' +
          '<div class="guidance-turn-icon">&#9654;</div>' +
          '<div class="turn-speaker guidance-label">Guidance</div>' +
        '</div>' +
        '<div class="turn-text story-font guidance-text">' + escapeHtml(content) + '</div>' +
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
    var speakerHtml = speakerName
      ? '<div class="turn-header">' +
          avatarHtml(speakerChar, 'turn-avatar') +
          '<div class="turn-speaker turn-speaker-npc">' + escapeHtml(speakerName) + '</div>' +
        '</div>'
      : '<div class="narrator-label">~ Narrator ~</div>';
    var npcTextStyle = '';
    if (speakerChar) {
      var speakerIdx = 0;
      npcChars.forEach(function (c, i) { if (c.id === speakerChar.id) speakerIdx = i; });
      npcTextStyle = ' style="color:' + getNpcColor(speakerChar.id, speakerIdx) + '"';
    }
    var ratingUp   = turn.user_rating ===  1 ? ' active-up'   : '';
    var ratingDown = turn.user_rating === -1 ? ' active-down'  : '';
    var imageHtml  = turn.image_filename
      ? buildTurnImageHtml({
          filename:          turn.image_filename,
          imageId:           turn.image_id           || null,
          visualPrompt:      turn.image_visual_prompt || '',
          videostatus:       turn.image_videostatus   || '',
          videoclipfilename: turn.image_videoclipfilename || '',
          accepted:          turn.image_accepted      || 0
        })
      : '';
    div.innerHTML = numHtml +
      '<div class="turn-inner">' +
        speakerHtml +
        '<div class="turn-text story-font"' + npcTextStyle + '>' + formatStoryContent(content) + '</div>' +
        '<div class="turn-footer">' +
          '<button class="turn-rate-btn' + ratingUp   + '" data-turn-id="' + turn.id + '" data-rating="1"  title="Good">+</button>' +
          '<button class="turn-rate-btn' + ratingDown + '" data-turn-id="' + turn.id + '" data-rating="-1" title="Bad">-</button>' +
          '<button class="turn-regen-btn" data-turn-id="' + turn.id + '" title="Regenerate this beat">&#8635;</button>' +
          '<button class="turn-gen-img-btn" data-turn-id="' + turn.id + '" title="Generate image for this turn">Img</button>' +
          '<button class="turn-delete-btn btn btn-xs btn-danger-ghost" data-turn-id="' + turn.id + '" title="Delete turn">&#x2715;</button>' +
        '</div>' +
      '</div>' +
      '<div class="turn-image-slot">' + imageHtml + '</div>' +
      '<div class="turn-regen-panel hidden">' +
        '<textarea class="regen-instruction" placeholder="Optional: give guidance for the rewrite..." rows="2"></textarea>' +
        '<div class="regen-actions">' +
          '<button class="regen-cancel-btn">Cancel</button>' +
          '<button class="regen-submit-btn">Regenerate</button>' +
        '</div>' +
      '</div>' +
      '<div class="turn-img-edit-panel hidden">' +
        '<textarea class="img-edit-prompt" rows="3" placeholder="Edit the image prompt..."></textarea>' +
        '<div class="regen-actions">' +
          '<button class="img-edit-cancel-btn">Cancel</button>' +
          '<button class="img-edit-submit-btn">Regenerate Image</button>' +
        '</div>' +
      '</div>';
  }
  return div;
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

  /* Portrait panel toggle */
  var portraitToggleBtn = document.getElementById('portrait-toggle');
  if (portraitToggleBtn) {
    portraitToggleBtn.addEventListener('click', function () {
      state.portraitPanelOpen = !state.portraitPanelOpen;
      localStorage.setItem('story-lab-portraits', state.portraitPanelOpen);
      var pp = document.getElementById('play-portrait-panel');
      if (pp) {
        pp.classList.toggle('collapsed', !state.portraitPanelOpen);
        if (!state.portraitPanelOpen) {
          pp.style.width = '';
        } else {
          var savedPp = localStorage.getItem('story-lab-portrait-width');
          if (savedPp) pp.style.width = savedPp + 'px';
        }
      }
      portraitToggleBtn.innerHTML = state.portraitPanelOpen ? '&raquo;' : '&laquo;';
    });
  }

  /* Reset Models button -- not implemented in A1111 backend */
  var resetModelsBtn = document.getElementById('btn-reset-models');
  if (resetModelsBtn) {
    resetModelsBtn.addEventListener('click', function () {
      showToast('Reset Models is not available in this version.', 'info');
    });
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

  /* Load character portraits */
  _reloadPortraitPanel = function () { loadPortraitPanel(); };
  _updateScenePresent = function (added, removed) {
    if (!_scenePresent) return;
    (added || []).forEach(function (c) { _scenePresent.add(c.name.toLowerCase()); });
    (removed || []).forEach(function (c) { _scenePresent.delete(c.name.toLowerCase()); });
    _saveScenePresent();
  };
  function loadPortraitPanel() {
    var list = document.getElementById('portrait-list');
    if (!list) return;

    var sceneCardHtml =
      '<div class="portrait-card portrait-scene-card" id="portrait-scene-card" title="Generate a scene image from the latest story turn (no character focus)">' +
        '<div class="portrait-initial portrait-scene-initial">Scene</div>' +
        '<div class="portrait-name">Scene</div>' +
      '</div>';

    Promise.all([
      API.getScenarioCharacters(scenarioId),
      Promise.resolve({ states: [] }),
      Promise.resolve({ clothing: [] })
    ]).then(function (results) {
      var chars    = Array.isArray(results[0]) ? results[0] : [];
      var states   = results[1].states || [];
      var clothing = results[2].clothing || [];
      // Seed clothing from character rows (current_clothing lives on the character record)
      chars.forEach(function (c) {
        if (!state.characterStates[c.id]) state.characterStates[c.id] = {};
        if (c.current_clothing) state.characterStates[c.id].current_clothing = c.current_clothing;
      });
      states.forEach(function (s) {
        if (!state.characterStates[s.characterId]) state.characterStates[s.characterId] = {};
        state.characterStates[s.characterId].moodcurrent    = s.moodcurrent;
        state.characterStates[s.characterId].arousalcurrent = s.arousalcurrent;
      });
      clothing.forEach(function (c) {
        if (!state.characterStates[c.characterId]) state.characterStates[c.characterId] = {};
        state.characterStates[c.characterId].current_clothing = c.current_clothing || null;
      });
      var charsHtml = chars.map(function (c) {
        var imgSrc = c.reference_image_path ? imageSrc(c.reference_image_path) : '';
        var initial = escapeHtml((c.name || '?')[0].toUpperCase());
        var isNpc = !c.is_user_character;
        return '<div class="portrait-card" data-char-name="' + escapeHtml(c.name) + '" data-char-id="' + c.id + '" title="Generate image of ' + escapeHtml(c.name) + '">' +
          (imgSrc
            ? '<img class="portrait-img" src="' + escapeHtml(imgSrc) + '" alt="' + escapeHtml(c.name) + '" loading="lazy" ' +
              'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
              '<div class="portrait-initial" style="display:none">' + initial + '</div>'
            : '<div class="portrait-initial">' + initial + '</div>') +
          '<div class="portrait-name">' + escapeHtml(c.name) + '</div>' +
          (isNpc ? _buildMoodBarsHtml(c.id) + _buildClothingHtml(c.id) : '') +
        '</div>';
      }).join('');
      list.innerHTML = charsHtml + sceneCardHtml;

      // Keep currentScenario.characters in sync so focus buttons stay populated
      if (state.currentScenario) state.currentScenario.characters = chars;
      renderCharacterFocusButtons(scenarioId);

      // Initialize scene presence tracking
      _loadScenePresent(chars.map(function(c){ return c.name; }));
      _refreshPortraitPresence();

      // Status toggle button
      var statusBtn = document.getElementById('btn-portrait-status');
      if (statusBtn) {
        statusBtn.onclick = function() {
          _statusMode = !_statusMode;
          _refreshPortraitPresence();
        };
      }
      // "All In" button — puts everyone back in the scene
      var allInBtn = document.getElementById('btn-portrait-all');
      if (allInBtn) {
        allInBtn.onclick = function() {
          chars.forEach(function(c){ _scenePresent.add(c.name.toLowerCase()); });
          _saveScenePresent();
          _refreshPortraitPresence();
        };
      }

      // Delegated click: mood +/- buttons inside portrait cards
      list.addEventListener('click', function (ev) {
        var moodBtn = ev.target.closest ? ev.target.closest('.mood-adj-btn') : null;
        if (moodBtn && !moodBtn.disabled) {
          ev.stopPropagation();
          var charId  = Number(moodBtn.dataset.charId);
          var field   = moodBtn.dataset.field;
          var dir     = Number(moodBtn.dataset.dir);
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
          // Mood state is session-local only (no backend endpoint in A1111 version)
          return;
        }
      });

      // Delegated click: character card or scene card
      list.addEventListener('click', function (ev) {
        var card = ev.target.closest('.portrait-card');
        if (!card) return;
        var pScenId = state.currentScenario && state.currentScenario.id;
        if (!pScenId) return;

        if (card.classList.contains('portrait-scene-card')) {
          if (_statusMode) return; // ignore scene card in status mode
          generateSceneImage(pScenId);
          return;
        }

        var charName = card.dataset.charName;
        if (!charName) return;

        // Status mode: toggle this character's presence
        if (_statusMode) {
          var key = charName.toLowerCase();
          if (_scenePresent.has(key)) _scenePresent.delete(key);
          else _scenePresent.add(key);
          _saveScenePresent();
          _refreshPortraitPresence();
          return;
        }

        var narratorTurns = (state.turns || []).filter(function (t) { return t.speaker === 'narrator'; });
        var latestTurn = narratorTurns.length ? narratorTurns[narratorTurns.length - 1] : null;
        generateSceneImage(pScenId, latestTurn ? latestTurn.id : null);
      });
    }).catch(function () {
      var list2 = document.getElementById('portrait-list');
      if (list2) list2.innerHTML = sceneCardHtml;
    });
  }

  loadPortraitPanel();

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
              loadPortraitPanel();
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
              loadPortraitPanel();
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
      if (cmd === '[image]') { generateSceneImage(scenarioId); return; }
      API.postTurn(scenarioId, cmd)
        .then(function (response) {
          if (response && response.narrator_turn) {
            var nt = response.narrator_turn;
            var narTurn = { id: nt.id, speaker: 'narrator', content_text: nt.content_text, turn_number: nt.turn_number, user_rating: 0 };
            appendTurnToThread(narTurn);
            if (response.user_turn) state.turns.push(Object.assign({ speaker: 'user' }, response.user_turn));
            state.turns.push(narTurn);
            sortTurns();
          }
        })
        .catch(function (e) { showToast('Command failed: ' + e.message, 'error'); });
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
      showConfirm('Reset Scene', 'Reset scene? All story progress will be lost.', function () {
        var pScenId = state.currentScenario && state.currentScenario.id;
        var turnIds = (state.turns || []).map(function (t) { return t.id; });
        var chain = Promise.resolve();
        turnIds.forEach(function (tid) {
          chain = chain.then(function () { return API.deleteTurn(pScenId, tid); });
        });
        chain.then(function () {
          state.turns = [];
          renderAllTurns();
          showToast('Scene reset.', 'info');
          var content = document.querySelector('.sidebar-content');
          if (content && state.currentSidebarTab === 'memory') {
            renderMemoryTab(content, scenarioId);
          }
        }).catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
      }, 'btn-danger');
    };
  }

  /* End Story */
  var endBtn = document.getElementById('btn-end-story');
  if (endBtn) {
    endBtn.onclick = function () {
      showConfirm('End Story', 'This will wrap up the narrative and mark the story as ended.', function () {
        API.postTurn(scenarioId, '[end]')
          .then(function (response) {
            if (response && response.narrator_turn) {
              var nt = response.narrator_turn;
              appendTurnToThread({
                id: nt.id, speaker: 'narrator',
                content_text: nt.content_text, turn_number: nt.turn_number, user_rating: 0
              });
            }
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

  /* Filter rules — local only (no backend endpoint for per-scenario image config in A1111 version) */
  var filterRulesInput = document.getElementById('filter-rules-input');
  if (filterRulesInput) {
    filterRulesInput.oninput = function () {
      // Kept as local state only; not persisted
    };
  }

  /* Image Profiles button — styles removed, use Settings > Profiles */
  var imgSettingsBtn = document.getElementById('btn-img-settings');
  if (imgSettingsBtn) {
    imgSettingsBtn.onclick = function () {
      showToast('Use Settings > Profiles to manage image generation profiles.', 'info');
    };
  }

  initResizablePanels();
}

// -------------------------------------------------------------------------
// initResizablePanels — drag-to-resize sidebar and portrait panel
// -------------------------------------------------------------------------
function initResizablePanels() {
  var SB_MIN = 140, SB_MAX = 500;
  var PP_MIN = 52,  PP_MAX = 600;

  var sbHandle = document.getElementById('sidebar-resize-handle');
  var ppHandle = document.getElementById('portrait-resize-handle');
  var sidebar  = document.getElementById('play-sidebar');
  var portrait = document.getElementById('play-portrait-panel');

  // Restore saved widths on load (only when expanded)
  var savedSbWidth = localStorage.getItem('story-lab-sidebar-width');
  var savedPpWidth = localStorage.getItem('story-lab-portrait-width');
  if (state.sidebarOpen && savedSbWidth && sidebar) {
    sidebar.style.width = parseInt(savedSbWidth, 10) + 'px';
  }
  if (state.portraitPanelOpen && savedPpWidth && portrait) {
    portrait.style.width = parseInt(savedPpWidth, 10) + 'px';
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
  // Portrait: handle on left edge, drag left = grow
  setupDrag(ppHandle, portrait, true, PP_MIN, PP_MAX, 'story-lab-portrait-width');
}

// -------------------------------------------------------------------------
// Styles page — per-scenario image style CRUD (replaces openImageSettingsPanel)
// -------------------------------------------------------------------------

function setupTurnFooterListeners() {
  var thread = document.getElementById('play-thread');
  if (!thread) return;

  // Turn rate buttons are local-only (no turn rating endpoint in A1111 backend)
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
      // Generate image for this turn
      var genImgBtn = e.target.closest('.turn-gen-img-btn');
      if (genImgBtn) {
        var genTurnId = Number(genImgBtn.dataset.turnId);
        var genScenId = state.currentScenario && state.currentScenario.id;
        if (genScenId) generateSceneImage(genScenId, genTurnId);
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
        // Turn editing is not yet implemented in A1111 backend
        showToast('Turn editing is not yet implemented.', 'info');
        if (ueSavePanel) ueSavePanel.classList.add('hidden');
        return;
      }
      // Save image — trigger browser download
      var saveImgBtn = e.target.closest('.turn-img-save-btn');        if (saveImgBtn) {
        var saveWrap  = saveImgBtn.closest('.turn-image-wrap');
        var saveImgEl = saveWrap && saveWrap.querySelector('img');
        if (!saveImgEl) return;
        var saveUrl  = saveImgEl.src;
        var saveName = saveUrl.split('/').pop().split('?')[0] || 'story-image.png';
        var a = document.createElement('a');
        a.href = saveUrl;
        a.download = saveName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
      // Delete image — remove from DB then from DOM
      var deleteImgBtn = e.target.closest('.turn-img-delete-btn');
      if (deleteImgBtn) {
        var delTurnEl = deleteImgBtn.closest('.turn');
        if (!delTurnEl) return;
        var delTurnId = Number(delTurnEl.dataset.turnId);
        var delImgScenId = state.currentScenario && state.currentScenario.id;
        var imgDiv    = delTurnEl.querySelector('.turn-image');
        if (!imgDiv) return;
        API.getImages(delImgScenId, delTurnId).then(function (data) {
          var images = Array.isArray(data) ? data : (data && data.images) || [];
          var removeFromDom = function () {
            if (imgDiv.parentNode) imgDiv.parentNode.removeChild(imgDiv);
            state.turns = state.turns.map(function (t) {
              return t.id === delTurnId ? Object.assign({}, t, { image_filename: null }) : t;
            });
          };
          if (!images.length) { removeFromDom(); return; }
          var latest = images[images.length - 1];
          API.deleteImage(delImgScenId, latest.id)
            .then(function () { removeFromDom(); showToast('Image deleted.', 'success'); })
            .catch(function (err) { showToast('Delete failed: ' + err.message, 'error'); });
        }).catch(function (err) { showToast('Delete failed: ' + err.message, 'error'); });
        return;
      }
      // Image edit button — populate textarea from stored prompt, toggle panel
      var imgEditBtn = e.target.closest('.turn-img-edit-btn');
      if (imgEditBtn) {
        var imgEditTurnEl = imgEditBtn.closest('.turn');
        var imgEditPanel  = imgEditTurnEl && imgEditTurnEl.querySelector('.turn-img-edit-panel');
        var imgEditDiv    = imgEditTurnEl && imgEditTurnEl.querySelector('.turn-image');
        if (imgEditPanel) {
          var imgEditTa = imgEditPanel.querySelector('.img-edit-prompt');
          if (imgEditTa) imgEditTa.value = (imgEditDiv && imgEditDiv.dataset.imagePrompt) || '';
          imgEditPanel.classList.toggle('hidden');
        }
        return;
      }
      // Image edit cancel
      var imgCancelBtn = e.target.closest('.img-edit-cancel-btn');
      if (imgCancelBtn) {
        var imgClosePanel = imgCancelBtn.closest('.turn-img-edit-panel');
        if (imgClosePanel) imgClosePanel.classList.add('hidden');
        return;
      }
      // Image edit submit — regenerate image with edited prompt
      var imgSubmitBtn = e.target.closest('.img-edit-submit-btn');
      if (imgSubmitBtn) {
        var imgPanel  = imgSubmitBtn.closest('.turn-img-edit-panel');
        var imgTurnEl = imgPanel && imgPanel.closest('.turn');
        if (!imgPanel || !imgTurnEl) return;
        var imgTurnId = Number(imgTurnEl.dataset.turnId);
        var imgScenId = state.currentScenario && state.currentScenario.id;
        var imgTaEl   = imgPanel.querySelector('.img-edit-prompt');
        var promptVal = imgTaEl ? imgTaEl.value.trim() : '';
        if (!promptVal) { showToast('Prompt cannot be empty.', 'error'); return; }
        // Image prompt editing not yet implemented in A1111 backend — trigger fresh generation instead
        imgPanel.classList.add('hidden');
        generateSceneImage(imgScenId, imgTurnId);
        return;
      }
      // Character-focused image button
      // Submit text regenerate
      var submitBtn = e.target.closest('.regen-submit-btn');
      if (!submitBtn) return;
      var regenPanel  = submitBtn.closest('.turn-regen-panel');
      var regenTurnEl = regenPanel && regenPanel.closest('.turn');
      if (!regenPanel || !regenTurnEl) return;
      var turnId      = Number(regenTurnEl.dataset.turnId);
      var scenarioId  = state.currentScenario && state.currentScenario.id;
      var instrEl     = regenPanel.querySelector('.regen-instruction');
      var instrVal    = instrEl ? instrEl.value : '';

      // Turn regeneration is not yet implemented in A1111 backend
      showToast('Turn regeneration is not yet implemented.', 'info');
      regenPanel.classList.add('hidden');
    });
  }

  // Animate delegation for thread image cards
  if (!thread._animateDelegateAttached) {
    thread._animateDelegateAttached = true;
    thread.addEventListener('click', function (e) {
      // Animate overlay button — toggle the animate panel
      var animBtn = e.target.closest('.turn-img-animate-btn');
      if (animBtn) {
        var imgCard = animBtn.closest('.turn-image');
        var panel   = imgCard && imgCard.querySelector('.turn-img-animate-panel');
        if (panel) panel.classList.toggle('hidden');
        return;
      }
      // Cancel animate
      var animCancel = e.target.closest('.turn-img-animate-cancel-btn');
      if (animCancel) {
        var panel = animCancel.closest('.turn-img-animate-panel');
        if (panel) panel.classList.add('hidden');
        return;
      }
      // Submit animate — fire the animation job
      var animSubmit = e.target.closest('.turn-img-animate-submit-btn');
      if (animSubmit) {
        showToast('Video animation is not available in this version.', 'info');
        return;
      }
    });
  }
}

// ---------------------------------------------------------------------------
// submitGuidanceTurn — unified submit for all guidance-first buttons
// focusTarget: character name | 'narrator' | 'continue'
// ---------------------------------------------------------------------------
function submitGuidanceTurn(scenarioId, focusTarget) {
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
    contentText = 'Continue, focusing on ' + focusTarget + '.';
  } else {
    contentText = 'Continue the story.';
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

  API.postTurn(scenarioId, contentText)
    .then(function (response) {
      removeTypingIndicator();
      if (response && response.narrator_turn) {
        var nt = response.narrator_turn;
        var narTurn = { id: nt.id, speaker: 'narrator', content_text: nt.content_text, turn_number: nt.turn_number, user_rating: 0 };
        appendTurnToThread(narTurn);
        state.turns.push(Object.assign({ speaker: 'user' }, response.user_turn || optimTurn));
        state.turns.push(narTurn);
        sortTurns();
      }
    })
    .catch(function (e) {
      removeTypingIndicator();
      var thread = document.getElementById('play-thread');
      if (thread) {
        var opt = thread.querySelector('[data-turn-id="' + optimId + '"]');
        if (opt && opt.parentNode) opt.parentNode.removeChild(opt);
      }
      if (guidanceInput && guidanceText) guidanceInput.value = guidanceText;
      showToast('Submit failed: ' + e.message, 'error');
    })
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
    btn.title = 'Focus next beat on ' + char.name;

    var initial = char.name ? char.name[0].toUpperCase() : '?';

    // Avatar
    if (char.reference_image_path) {
      var img = document.createElement('img');
      img.src = imageSrc(char.reference_image_path);
      img.alt = initial;
      img.className = 'focus-btn-avatar';
      img.onerror = function () {
        var fallback = document.createElement('span');
        fallback.className = 'focus-btn-initial';
        fallback.textContent = initial;
        btn.replaceChild(fallback, img);
      };
      btn.appendChild(img);
    } else {
      var initEl = document.createElement('span');
      initEl.className = 'focus-btn-initial';
      initEl.textContent = initial;
      btn.appendChild(initEl);
    }

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

function generateSceneImage(scenarioId, turnId) {
  // Show the floating status pill immediately — WS events will update it as the pipeline runs.
  setImgStatus('Preparing image...');

  // Show a pending indicator on the target turn card footer.
  var turnEl    = turnId ? document.querySelector('[data-turn-id="' + turnId + '"]') : null;
  var footer    = turnEl && turnEl.querySelector('.turn-footer');
  var pendingEl = null;
  if (footer && !footer.querySelector('.turn-img-pending')) {
    pendingEl = document.createElement('span');
    pendingEl.className = 'turn-img-pending';
    pendingEl.textContent = 'Generating image...';
    footer.appendChild(pendingEl);
  }

  // Image is always injected into the thread via the WS image_ready event handler.
  // This call only fires the job; no synchronous DOM injection happens here.
  return API.generateSceneImage(scenarioId, turnId || null)
    .then(function () {
      // Job accepted — WS image_ready will call buildTurnImageHtml and insert
      // the card into the correct turn's .turn-image-slot.
    })
    .catch(function (e) {
      if (pendingEl) {
        pendingEl.className = 'turn-img-error';
        pendingEl.textContent = 'Image failed: ' + escapeHtml(e.message);
      } else {
        showToast('Image failed: ' + e.message, 'error');
      }
    })
    .finally(function () {
      var b = document.getElementById('btn-gen-scene-img');
      if (b) setLoading(b, false);
    });
}


function _populateSceneImageHistory() {
  if (!state._sceneImageCache) state._sceneImageCache = {};
  var imageTurns = state.turns.filter(function (t) { return t.image_filename; });
  // Build the in-memory cache only — images are already shown inline in the thread.
  // Calling displayImage here would also render them in #scene-image-history (below the
  // thread in the layout), which takes up flex space and leaves only a sliver of story visible.
  imageTurns.forEach(function (t) {
    if (!t.image_id) return;
    state._sceneImageCache[t.image_id] = {
      id:                 t.image_id,
      filename:           t.image_filename,
      visual_prompt_sent: t.image_visual_prompt     || '',
      videostatus:        t.image_videostatus       || null,
      videoclipfilename:  t.image_videoclipfilename || null,
      turn_number:        t.turn_number,
      turn_id:            t.id,
    };
  });
}

function displayImage(img) {
  if (!img) return;
  if (img.id) {
    state.currentImageData = img;
    if (!state._sceneImageCache) state._sceneImageCache = {};
    state._sceneImageCache[img.id] = img;
  }

  var container = document.getElementById('scene-image-history');
  if (!container) return;

  var src = imageSrc(img.filename);
  var videoHtml = '';
  if (img.videostatus === 'ready' && img.videoclipfilename) {
    var vsrc = imageSrc(img.videoclipfilename);
    videoHtml = '<video class="scene-image-video" autoplay loop muted playsinline controls ' +
                'style="width:100%;display:block;border-radius:4px;margin-bottom:4px;" ' +
                'src="' + escapeHtml(vsrc) + '"></video>';
  }

  var turnNum = img.turn_number || null;
  if (!turnNum && (img.turn_id || img.turnId)) {
    var _tid = img.turn_id || img.turnId;
    var _t = Array.isArray(state.turns) && state.turns.find(function (t) { return t.id === Number(_tid) || t.id === _tid; });
    if (_t) turnNum = _t.turn_number;
  }
  var label = turnNum ? 'Turn ' + turnNum : '';

  var innerHtml =
    videoHtml +
    '<img class="scene-image-item" src="' + escapeHtml(src) + '" alt="Scene image" ' +
      'data-lightbox-src="' + escapeHtml(src) + '" ' +
      'onerror="this.parentElement.innerHTML=\'<div class=\\\"image-error\\\">Image not found</div>\'">' +
    (label ? '<div class="scene-image-label">' + escapeHtml(label) + '</div>' : '');

  // Update existing entry in place (e.g. after video becomes ready)
  if (img.id) {
    var existing = container.querySelector('[data-image-id="' + img.id + '"]');
    if (existing) {
      existing.innerHTML = innerHtml;
      var imgEl2 = existing.querySelector('.scene-image-item');
      if (imgEl2) imgEl2.onclick = function () { openLightbox(imgEl2.dataset.lightboxSrc); };
      refreshAnimatePanel();
      return;
    }
  }

  var entry = document.createElement('div');
  entry.className = 'scene-image-entry';
  if (img.id)                         entry.dataset.imageId = String(img.id);
  if (img.turn_id || img.turnId)      entry.dataset.turnId  = String(img.turn_id || img.turnId);
  entry.innerHTML = innerHtml;

  var imgEl = entry.querySelector('.scene-image-item');
  if (imgEl) imgEl.onclick = function () { openLightbox(imgEl.dataset.lightboxSrc); };

  container.insertBefore(entry, container.firstChild);
  refreshAnimatePanel();
}

function addImageToHistory(img) {
  // Unified into displayImage; kept for WS-patch compatibility
  displayImage(img);
}

window._displayImage         = displayImage;
window._addImageToHistory    = addImageToHistory;
window._refreshAnimatePanel  = refreshAnimatePanel;
window._renderAllTurns       = renderAllTurns;
window._setupTurnFooterListeners = setupTurnFooterListeners;

// Render the animate/video controls below the image rating area.
// Called whenever the displayed image changes or a WS video event arrives.
function refreshAnimatePanel() {
  var section = document.getElementById('img-animate-section');
  if (!section) return;
  var img = state.currentImageData;
  if (!img) { section.innerHTML = ''; return; }

  var vs = img.videostatus       || null;
  var vf = img.videoclipfilename || null;

  // Video is ready — clip is already visible above the still; just show a note.
  if (vs === 'ready' && vf) {
    section.innerHTML = '<div style="font-size:11px;color:#888;margin-top:4px;padding:0 2px;">Clip ready</div>';
    return;
  }

  // Generation in progress.
  if (vs === 'generating') {
    section.innerHTML =
      '<div style="font-size:12px;color:#aaa;margin-top:6px;display:flex;align-items:center;gap:6px;">' +
        '<span class="spinner-inline"></span>Generating clip...' +
      '</div>';
    return;
  }

  // Show Animate for any image that has a DB id and a filename.
  if (!img.id || !img.filename) { section.innerHTML = ''; return; }

  // Error or null state — show Animate button (with optional error note).
  var errorNote = (vs === 'error')
    ? '<div style="font-size:11px;color:#c06060;margin-bottom:4px;">Clip failed. Retry:</div>'
    : '';

  // Derive per-panel defaults from scenario generation_config
  var _animGenConfig = null;
  try {
    var _gc = state.currentScenario && state.currentScenario.generation_config;
    if (_gc) _animGenConfig = typeof _gc === 'string' ? JSON.parse(_gc) : _gc;
  } catch (_) {}
  var _defaultVariant     = (_animGenConfig && _animGenConfig.videoMotionStyle) || 'lownoise';
  var _defaultNsfwEnhance = !!(_animGenConfig && _animGenConfig.videoNsfwEnhance);

  section.innerHTML =
    errorNote +
    '<button class="btn btn-ghost btn-sm" id="btn-animate-img" style="margin-top:2px;">Animate</button>' +
    '<div id="animate-controls" style="display:none;margin-top:8px;">' +
      '<textarea id="animate-prompt" rows="2" ' +
        'placeholder="Motion prompt (optional - leave blank for auto)" ' +
        'style="width:100%;font-size:12px;resize:vertical;padding:4px;' +
               'box-sizing:border-box;background:var(--bg-input,#1e1e2e);' +
               'color:var(--text-primary,#eee);border:1px solid #444;border-radius:4px;">' +
      '</textarea>' +
      '<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<label style="font-size:12px;color:#aaa;">Motion:</label>' +
        '<select id="animate-variant" ' +
          'style="font-size:12px;background:var(--bg-input,#1e1e2e);' +
                 'color:var(--text-primary,#eee);border:1px solid #444;' +
                 'border-radius:4px;padding:2px 6px;">' +
          '<option value="lownoise"'  + (_defaultVariant === 'lownoise'  ? ' selected' : '') + '>Low Motion</option>' +
          '<option value="highnoise"' + (_defaultVariant === 'highnoise' ? ' selected' : '') + '>High Motion</option>' +
        '</select>' +
        '<label style="font-size:12px;color:#aaa;display:flex;align-items:center;gap:4px;cursor:pointer;">' +
          '<input type="checkbox" id="animate-nsfw-enhance"' + (_defaultNsfwEnhance ? ' checked' : '') + ' style="cursor:pointer;">' +
          'Adult Enhance' +
        '</label>' +
        '<button class="btn btn-ghost btn-sm" id="btn-animate-cancel" style="margin-left:auto;">Cancel</button>' +
        '<button class="btn btn-primary btn-sm" id="btn-animate-submit">Generate Clip</button>' +
      '</div>' +
    '</div>';

  var animateBtn = document.getElementById('btn-animate-img');
  var controls   = document.getElementById('animate-controls');
  var cancelBtn  = document.getElementById('btn-animate-cancel');
  var submitBtn  = document.getElementById('btn-animate-submit');

  if (animateBtn) {
    animateBtn.onclick = function () {
      animateBtn.style.display = 'none';
      if (controls) controls.style.display = '';
    };
  }
  if (cancelBtn) {
    cancelBtn.onclick = function () {
      if (controls) controls.style.display = 'none';
      if (animateBtn) animateBtn.style.display = '';
    };
  }
  if (submitBtn) {
    submitBtn.onclick = function () {
      showToast('Video animation is not available in this version.', 'info');
    };
  }
}

function showSetAsReferenceModal() {
  if (!state.currentImageId || !state.currentScenario) return;
  var chars = state.currentScenario.characters || [];
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML =
    '<div class="modal">' +
      '<h3 class="modal-title">Set as Character Reference</h3>' +
      '<p class="modal-message">Select which character this image represents:</p>' +
      '<div class="modal-char-list">' +
        (chars.length
          ? chars.map(function (c) {
              return '<button class="char-select-btn" data-char-id="' + c.id + '">' +
                '<div class="char-avatar">' + escapeHtml(c.name[0].toUpperCase()) + '</div>' +
                '<span>' + escapeHtml(c.name) + '</span>' +
                '</button>';
            }).join('')
          : '<p class="text-muted" style="padding:12px">No characters in this story.</p>'
        ) +
      '</div>' +
      '<div class="modal-footer"><button class="btn btn-secondary" id="modal-cancel-ref">Cancel</button></div>' +
    '</div>';
  overlay.classList.remove('hidden');
  overlay.querySelectorAll('.char-select-btn').forEach(function (btn) {
    btn.onclick = function () {
      var charId = Number(btn.dataset.charId);
      var refScenId = state.currentScenario && state.currentScenario.id;
      API.acceptImage(refScenId, state.currentImageId, { set_as_character_reference: true, character_id: charId })
        .then(function (updated) {
          overlay.classList.add('hidden');
          showToast('Set as character reference!', 'success');
          if (updated && updated.id) {
            state._sceneImageCache[updated.id] = updated;
            if (state.currentImageId === updated.id) {
              state.currentImageData = updated;
              refreshAnimatePanel();
            }
          }
        })
        .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
    };
  });
  document.getElementById('modal-cancel-ref').onclick = function () { overlay.classList.add('hidden'); };
  overlay.onclick = function (e) { if (e.target === overlay) overlay.classList.add('hidden'); };
}

// ---------------------------------------------------------------------------
// Style preset data removed — styles are now per-scenario DB records (image_styles table)
// ---------------------------------------------------------------------------

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

  var lastImgPrompt = '';
  var allImgDivs = document.querySelectorAll('#play-thread .turn-image[data-image-prompt]');
  if (allImgDivs.length) {
    lastImgPrompt = allImgDivs[allImgDivs.length - 1].dataset.imagePrompt || '';
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
      : '') +
    (lastImgPrompt
      ? '<div class="setting-row" style="align-items:flex-start">' +
          '<span style="font-weight:600;color:var(--text-muted);min-width:140px">Last Image Prompt</span>' +
          '<pre style="margin:0;font-size:10px;white-space:pre-wrap;word-break:break-word;' +
            'color:var(--text-muted);flex:1;max-height:110px;overflow-y:auto;' +
            'background:var(--bg-secondary,#1a1a2e);padding:6px 8px;border-radius:4px;border:1px solid var(--border)">' +
            escapeHtml(lastImgPrompt) + '</pre>' +
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
          '<div class="setting-row">' +
            '<span style="font-weight:600;color:var(--text-muted);min-width:140px">Image Style</span>' +
            '<span style="color:var(--text)" id="scene-info-img-model">' + escapeHtml(scenario.image_model || 'Default') + '</span>' +
          '</div>' +
          infoRow('Reply Length', scenario.reply_length || 'medium') +
          infoRow('Tone', scenario.tone || '-') +
          infoRow('NSFW', scenario.nsfw_enabled ? 'Yes' : 'No') +
          snapshotRows +
        '</div>' +
      '</div>' +

      '<div class="modal-footer">' +
        '<button class="btn btn-ghost" id="close-scene-info">Close</button>' +
      '</div>' +
    '</div>';

  overlay.classList.remove('hidden');

  document.getElementById('close-scene-info').onclick = function () { overlay.classList.add('hidden'); };
  overlay.onclick = function (e) { if (e.target === overlay) overlay.classList.add('hidden'); };
}

function _loadSiPromptTab(scenarioId) {
  var container = document.getElementById('si-prompt-content');
  if (!container || container.dataset.loaded === '1') return;
  container.dataset.loaded = '1';

  var SI_WORKFLOWS  = ['story-sdxl-create', 'story-sdxl-consistency', 'story-sdxl-refiner', 'story-sdxl-faceid', 'story-sdxl-faceid-batch', 'story-sdxl-faceid-batch-control2'];
  var SI_SAMPLERS   = [
    'euler', 'euler_ancestral', 'heun', 'heunpp2', 'dpm_2', 'dpm_2_ancestral',
    'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde',
    'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu',
    'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddpm', 'lcm', 'ipndm', 'ipndm_v',
    'deis', 'ddim', 'uni_pc', 'uni_pc_bh2', 'exp_heun_2_x0', 'ssa',
    'res_multistep', 'res_multistep_ancestral'
  ];
  var SI_SCHEDULERS = [
    'normal', 'karras', 'exponential', 'sgm_uniform', 'simple',
    'ddim_uniform', 'beta', 'linear_quadratic', 'kl_optimal'
  ];

  function _siSelectOpts(list, cur, emptyLabel) {
    var h = '<option value="">' + escapeHtml(emptyLabel) + '</option>';
    list.forEach(function (v) {
      h += '<option value="' + escapeHtml(v) + '"' + (v === cur ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
    });
    return h;
  }

  API.getScenarioPromptConstruction(scenarioId).then(function (data) {
    var gc  = data.scenarioConfig  || {};
    var gl  = data.globalConfig    || {};
    var eff = data.effectiveConfig || {};

    var prefixPlaceholder = gl.promptPrefix || 'Masterpiece, hyper-realistic, Hyper-realism, ultra-detailed, vibrant colors, rich contrast';
    var suffixPlaceholder = gl.promptSuffix || 'perfect anatomy, perfect face, perfect hands, perfect body, sharp focus, 8k resolution';
    var negPlaceholder    = gl.negativePrompt || '(from global default)';

    var prefixMode  = gc.qualityPrefixMode  || 'override';
    var suffixMode  = gc.qualitySuffixMode  || 'override';
    var negMode     = gc.negativeMode       || 'override';

    function _modeToggle(id, current) {
      return '<div style="display:flex;gap:6px;margin-bottom:4px">' +
        '<label style="display:flex;align-items:center;gap:3px;font-size:10px;cursor:pointer;color:var(--text-muted)">' +
          '<input type="radio" name="' + id + '-mode" id="' + id + '-mode-override" value="override"' +
            (current === 'override' ? ' checked' : '') + ' style="margin:0"> Override' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:3px;font-size:10px;cursor:pointer;color:var(--text-muted)">' +
          '<input type="radio" name="' + id + '-mode" id="' + id + '-mode-append" value="append"' +
            (current === 'append' ? ' checked' : '') + ' style="margin:0"> Append' +
        '</label>' +
      '</div>';
    }

    container.innerHTML =
      '<div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">' +
        'Override or append to prompt construction for this scenario. Leave blank to use the global default set in Settings.' +
      '</div>' +

      '<div class="pc-field" style="margin-bottom:14px">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
          '<input type="checkbox" id="si-pc-skip-enhance"' + (data.skip_enhance ? ' checked' : '') + '>' +
          '<span style="font-weight:600;font-size:12px">Skip Scene Extraction</span>' +
        '</label>' +
        '<p class="text-muted" style="font-size:10px;margin:4px 0 0 22px">Uses character appearance directly instead of AI-analyzing the story text.</p>' +
      '</div>' +

      '<div class="pc-field">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">' +
          '<label class="pc-label" style="margin-bottom:0">Quality Prefix</label>' +
          _modeToggle('si-pc-prefix', prefixMode) +
        '</div>' +
        '<textarea class="form-input pc-textarea" id="si-pc-prefix" rows="2" spellcheck="false" ' +
          'placeholder="' + escapeHtml(prefixPlaceholder) + '">' +
          escapeHtml(gc.qualityPrefix || '') +
        '</textarea>' +
      '</div>' +

      '<div class="pc-field">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">' +
          '<label class="pc-label" style="margin-bottom:0">Quality Suffix</label>' +
          _modeToggle('si-pc-suffix', suffixMode) +
        '</div>' +
        '<textarea class="form-input pc-textarea" id="si-pc-suffix" rows="2" spellcheck="false" ' +
          'placeholder="' + escapeHtml(suffixPlaceholder) + '">' +
          escapeHtml(gc.qualitySuffix || '') +
        '</textarea>' +
      '</div>' +

      '<div class="pc-field">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">' +
          '<label class="pc-label" style="margin-bottom:0">Negative Prompt</label>' +
          _modeToggle('si-pc-negative', negMode) +
        '</div>' +
        '<textarea class="form-input pc-textarea" id="si-pc-negative" rows="3" spellcheck="false" ' +
          'placeholder="' + escapeHtml(negPlaceholder.slice(0, 80)) + '...">' +
          escapeHtml(gc.negativeOverride || '') +
        '</textarea>' +
      '</div>' +

      '<hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--text)">Generation Parameters</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">' +
        'Override workflow/steps/sampler for this scenario. Effective values (when no override) shown in placeholders.' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div class="form-group" style="margin:0">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
            '<label class="form-label" style="margin:0">Workflow</label>' +
            '<button type="button" class="btn btn-ghost btn-xs" id="si-pc-workflow-make-default" title="Set this workflow as the global default for all new scenarios" style="font-size:10px;padding:2px 7px">Make Default</button>' +
          '</div>' +
          '<select class="form-input" id="si-pc-workflow">' + _siSelectOpts(SI_WORKFLOWS, gc.workflow || '', 'Auto (effective: ' + escapeHtml(eff.workflow || 'story-sdxl-create') + ')') + '</select>' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label">Sampler</label>' +
          '<select class="form-input" id="si-pc-sampler">' + _siSelectOpts(SI_SAMPLERS, gc.sampler || '', 'Auto (effective: ' + escapeHtml(eff.sampler || 'exp_heun_2_x0') + ')') + '</select>' +
        '</div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label">Scheduler</label>' +
          '<select class="form-input" id="si-pc-scheduler" style="min-width:0;font-size:11px">' + _siSelectOpts(SI_SCHEDULERS, gc.scheduler || '', 'Auto (' + escapeHtml(eff.scheduler || 'kl_optimal') + ')') + '</select>' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label">Steps</label>' +
          '<input class="form-input" id="si-pc-steps" type="number" min="1" max="150" ' +
            'placeholder="' + escapeHtml(String(eff.steps || 30)) + '" ' +
            'value="' + escapeHtml(gc.steps != null ? String(gc.steps) : '') + '">' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label">CFG</label>' +
          '<input class="form-input" id="si-pc-cfg" type="number" min="0" max="30" step="0.5" ' +
            'placeholder="' + escapeHtml(String(eff.cfg || 7.5)) + '" ' +
            'value="' + escapeHtml(gc.cfg != null ? String(gc.cfg) : '') + '">' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label">W x H</label>' +
          '<div style="display:flex;gap:4px">' +
            '<input class="form-input" id="si-pc-width" type="number" min="256" max="2048" step="8" ' +
              'placeholder="' + escapeHtml(String(eff.width || 1024)) + '" ' +
              'value="' + escapeHtml(gc.width != null ? String(gc.width) : '') + '" style="min-width:0">' +
            '<input class="form-input" id="si-pc-height" type="number" min="256" max="2048" step="8" ' +
              'placeholder="' + escapeHtml(String(eff.height || 1024)) + '" ' +
              'value="' + escapeHtml(gc.height != null ? String(gc.height) : '') + '" style="min-width:0">' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" title="Fraction of total steps used by the base model (0.5–1.0). Remainder goes to the SDXL refiner. e.g. 0.8 = 80% base, 20% refiner. Only applies to workflows that use SeargeSDXLSamplerV3 (story-sdxl-faceid-batch-control2).">Refiner Base Ratio <span style="color:var(--text-faint);font-size:10px;font-weight:400">(0.0–1.0)</span></label>' +
          '<input class="form-input" id="si-pc-refiner-ratio" type="number" min="0.1" max="1.0" step="0.05" ' +
            'placeholder="' + escapeHtml(String(eff.refiner_base_ratio != null ? eff.refiner_base_ratio : 0.8)) + '" ' +
            'value="' + escapeHtml(gc.refiner_base_ratio != null ? String(gc.refiner_base_ratio) : '') + '" ' +
            'style="font-size:13px">' +
          '<p class="form-hint" style="font-size:10px;margin:3px 0 0">Base pass share — higher = more base denoising, less refiner polish. Default 0.8.</p>' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" title="Extra prep steps run by the refiner before the main refiner pass. Default 4. Only applies to SeargeSDXLSamplerV3 workflows.">Refiner Prep Steps</label>' +
          '<input class="form-input" id="si-pc-refiner-prep" type="number" min="0" max="20" step="1" ' +
            'placeholder="' + escapeHtml(String(eff.refiner_prep_steps != null ? eff.refiner_prep_steps : 4)) + '" ' +
            'value="' + escapeHtml(gc.refiner_prep_steps != null ? String(gc.refiner_prep_steps) : '') + '" ' +
            'style="font-size:13px">' +
          '<p class="form-hint" style="font-size:10px;margin:3px 0 0">Warm-up steps before refiner pass. Default 4.</p>' +
        '</div>' +
      '</div>' +

      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="btn btn-primary" id="si-pc-save-btn">Save Overrides</button>' +
        '<button class="btn btn-ghost" id="si-pc-clear-btn">Clear All (use global)</button>' +
      '</div>' +

      '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0 10px">' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--text)">Character Consistency (FaceID)</div>' +
      '<div class="pc-field" style="margin-bottom:10px">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
          '<input type="checkbox" id="si-pc-consistency-enabled"' + (gc.image_consistency_enabled ? ' checked' : '') + '>' +
          '<span style="font-weight:600;font-size:12px">Enable Character Consistency</span>' +
        '</label>' +
        '<p class="text-muted" style="font-size:10px;margin:4px 0 0 22px">Uses the primary character\'s reference image. Generate one on the Characters page first.</p>' +
      '</div>' +
      '<div id="si-pc-consistency-row"' + (!gc.image_consistency_enabled ? ' style="display:none"' : '') + '>' +
        '<div class="pc-field" style="margin-bottom:8px">' +
          '<label class="pc-label" style="display:flex;justify-content:space-between">' +
            '<span>Consistency Strength</span>' +
            '<span id="si-pc-strength-val">' + (gc.consistency_strength != null ? Number(gc.consistency_strength).toFixed(2) : '0.50') + '</span>' +
          '</label>' +
          '<input type="range" id="si-pc-consistency-strength" min="0" max="0.8" step="0.05" ' +
            'value="' + (gc.consistency_strength != null ? gc.consistency_strength : 0.5) + '" ' +
            'style="width:100%;accent-color:var(--accent)">' +
        '</div>' +
      '</div>' +

      (data.lastPrompt
        ? '<div class="pc-field" style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
              '<label class="pc-label" style="margin-bottom:0">Last Generated Prompt</label>' +
              '<button class="btn btn-ghost btn-sm" id="si-pc-copy-prompt" style="font-size:11px;padding:2px 8px">Copy</button>' +
            '</div>' +
            '<p class="text-muted" style="font-size:10px;margin-bottom:6px">Read-only. Exact prompt sent for the most recent image in this scenario.</p>' +
            '<textarea class="form-input pc-textarea" id="si-pc-last-prompt" rows="5" readonly style="opacity:0.7;resize:vertical">' + escapeHtml(data.lastPrompt) + '</textarea>' +
          '</div>'
        : '<div style="margin-top:12px;color:var(--text-muted);font-size:11px">No images generated yet in this scenario.</div>');

    function _getMode(name) {
      var el = document.querySelector('input[name="' + name + '-mode"]:checked');
      return el ? el.value : 'override';
    }

    function _collectOverrides() {
      var stepsRaw        = (document.getElementById('si-pc-steps').value         || '').trim();
      var cfgRaw          = (document.getElementById('si-pc-cfg').value           || '').trim();
      var widthRaw        = (document.getElementById('si-pc-width').value         || '').trim();
      var heightRaw       = (document.getElementById('si-pc-height').value        || '').trim();
      var refRatioRaw     = (document.getElementById('si-pc-refiner-ratio').value || '').trim();
      var refPrepRaw      = (document.getElementById('si-pc-refiner-prep').value  || '').trim();
      var skipEnhance     = document.getElementById('si-pc-skip-enhance').checked;
      var conEnabled      = document.getElementById('si-pc-consistency-enabled').checked;
      var conStrength     = parseFloat(document.getElementById('si-pc-consistency-strength').value);
      var refRatioParsed  = refRatioRaw  ? Math.max(0.1, Math.min(1.0, Number(refRatioRaw)))  : null;
      var refPrepParsed   = refPrepRaw   ? Math.max(0,   Math.min(20,  Math.round(Number(refPrepRaw)))) : null;
      return {
        skip_enhance:      skipEnhance,
        qualityPrefix:     (document.getElementById('si-pc-prefix').value   || '').trim() || null,
        qualityPrefixMode: _getMode('si-pc-prefix'),
        qualitySuffix:     (document.getElementById('si-pc-suffix').value   || '').trim() || null,
        qualitySuffixMode: _getMode('si-pc-suffix'),
        negative_override: (document.getElementById('si-pc-negative').value || '').trim() || null,
        negativeMode:      _getMode('si-pc-negative'),
        workflow:  (document.getElementById('si-pc-workflow').value  || '') || null,
        sampler:   (document.getElementById('si-pc-sampler').value   || '') || null,
        scheduler: (document.getElementById('si-pc-scheduler').value || '') || null,
        steps:     stepsRaw  ? Number(stepsRaw)  : null,
        cfg:       cfgRaw    ? Number(cfgRaw)    : null,
        width:     widthRaw  ? Number(widthRaw)  : null,
        height:    heightRaw ? Number(heightRaw) : null,
        refiner_base_ratio:  refRatioParsed,
        refiner_prep_steps:  refPrepParsed,
        image_consistency_enabled: conEnabled,
        consistency_strength: Number.isFinite(conStrength) ? conStrength : 0.5,
      };
    }

    var conCheck   = document.getElementById('si-pc-consistency-enabled');
    var conRow     = document.getElementById('si-pc-consistency-row');
    var conSlider  = document.getElementById('si-pc-consistency-strength');
    var conValSpan = document.getElementById('si-pc-strength-val');
    if (conCheck && conRow) {
      conCheck.onchange = function () {
        conRow.style.display = conCheck.checked ? '' : 'none';
      };
    }
    if (conSlider && conValSpan) {
      conSlider.oninput = function () {
        conValSpan.textContent = parseFloat(conSlider.value).toFixed(2);
      };
    }

    var makeDefaultBtn = document.getElementById('si-pc-workflow-make-default');
    if (makeDefaultBtn) {
      makeDefaultBtn.onclick = function () {
        var selectedWorkflow = (document.getElementById('si-pc-workflow').value || '').trim();
        if (!selectedWorkflow) {
          showToast('Select a workflow first, then click Make Default.', 'error');
          return;
        }
        makeDefaultBtn.disabled = true;
        makeDefaultBtn.textContent = 'Saving...';
        API.savePromptConstruction({ defaultWorkflow: selectedWorkflow })
          .then(function () {
            showToast('\u201c' + selectedWorkflow + '\u201d is now the global default workflow.', 'success');
          })
          .catch(function (e) { showToast('Failed to set default: ' + e.message, 'error'); })
          .finally(function () {
            makeDefaultBtn.disabled = false;
            makeDefaultBtn.textContent = 'Make Default';
          });
      };
    }

    document.getElementById('si-pc-save-btn').onclick = function () {
      var btn = document.getElementById('si-pc-save-btn');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      API.updateScenarioImageConfig(scenarioId, _collectOverrides())
        .then(function () { showToast('Prompt overrides saved.', 'success'); })
        .catch(function (e) { showToast('Save failed: ' + e.message, 'error'); })
        .finally(function () { btn.disabled = false; btn.textContent = 'Save Overrides'; });
    };

    var copyBtn = document.getElementById('si-pc-copy-prompt');
    if (copyBtn) {
      copyBtn.onclick = function () {
        var ta = document.getElementById('si-pc-last-prompt');
        if (!ta) return;
        navigator.clipboard.writeText(ta.value)
          .then(function () { showToast('Prompt copied.', 'success'); })
          .catch(function () {
            ta.select();
            document.execCommand('copy');
            showToast('Prompt copied.', 'success');
          });
      };
    }
    document.getElementById('si-pc-clear-btn').onclick = function () {
      document.getElementById('si-pc-prefix').value    = '';
      document.getElementById('si-pc-suffix').value    = '';
      document.getElementById('si-pc-negative').value  = '';
      document.getElementById('si-pc-workflow').value       = '';
      document.getElementById('si-pc-sampler').value        = '';
      document.getElementById('si-pc-scheduler').value      = '';
      document.getElementById('si-pc-steps').value          = '';
      document.getElementById('si-pc-cfg').value            = '';
      document.getElementById('si-pc-width').value          = '';
      document.getElementById('si-pc-height').value         = '';
      document.getElementById('si-pc-refiner-ratio').value  = '';
      document.getElementById('si-pc-refiner-prep').value   = '';
      document.getElementById('si-pc-skip-enhance').checked = false;
      var conCheckEl = document.getElementById('si-pc-consistency-enabled');
      var conRowEl   = document.getElementById('si-pc-consistency-row');
      if (conCheckEl) conCheckEl.checked = false;
      if (conRowEl)   conRowEl.style.display = 'none';
      var btn = document.getElementById('si-pc-save-btn');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      API.updateScenarioImageConfig(scenarioId, {
        skip_enhance: false,
        qualityPrefix: null, qualityPrefixMode: 'override',
        qualitySuffix: null, qualitySuffixMode: 'override',
        negative_override: null, negativeMode: 'override',
        workflow: null, sampler: null, scheduler: null,
        steps: null, cfg: null, width: null, height: null,
        refiner_base_ratio: null, refiner_prep_steps: null,
        image_consistency_enabled: false, consistency_strength: null
      }).then(function () {
        showToast('Overrides cleared.', 'success');
      }).catch(function (e) {
        showToast('Clear failed: ' + e.message, 'error');
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = 'Save Overrides';
      });
    };

  }).catch(function (e) {
    container.innerHTML = '<p class="text-muted">Failed to load: ' + escapeHtml(e.message) + '</p>';
  });
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
    var summary    = null; // auto-summary field not in A1111 backend turns

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
  API.getScenarioCharacters(scenarioId).then(function (data) {
    var chars = Array.isArray(data) ? data : [];
    chars.forEach(function (c) {
      if (!state.characterStates[c.id]) state.characterStates[c.id] = {};
      if (c.current_clothing) state.characterStates[c.id].current_clothing = c.current_clothing;
    });

    var rosterIds = chars.map(function (c) { return c.id; });

    container.innerHTML =
      '<div class="sidebar-tab-content">' +
        '<div class="tab-header" style="display:flex;align-items:center;justify-content:space-between">' +
          '<h4>Cast</h4>' +
          '<button class="btn btn-ghost btn-xs" id="cast-tab-add-btn" title="Add a character to this story">+ Add</button>' +
        '</div>' +
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
              if (_reloadPortraitPanel) _reloadPortraitPanel();
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
                if (_reloadPortraitPanel) _reloadPortraitPanel();
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

  Promise.all([
    API.getRelationships(),
    API.getScenarioCharacters(scenarioId),
  ]).then(function (results) {
    var allRels = Array.isArray(results[0]) ? results[0] : [];
    var chars   = Array.isArray(results[1]) ? results[1] : [];
    var charIds = new Set(chars.map(function (c) { return c.id; }));
    // Filter to relationships where BOTH characters are in this scenario's cast
    var rels = allRels.filter(function (r) {
      return charIds.has(r.from_character_id) && charIds.has(r.to_character_id);
    });

    var charOpts = chars.map(function (c) {
      return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
    }).join('');

    var typeOpts = REL_TYPES.map(function (t) {
      return '<option value="' + t + '">' + t[0].toUpperCase() + t.slice(1) + '</option>';
    }).join('');

    container.innerHTML =
      '<div class="sidebar-tab-content">' +
        '<div class="tab-header" style="display:flex;align-items:center;justify-content:space-between">' +
          '<h4>Relationships</h4>' +
          '<button class="btn btn-ghost btn-xs" id="btn-add-rel">+ Add</button>' +
        '</div>' +

        '<div id="rel-add-form" style="display:none;padding:6px 0 8px;border-bottom:1px solid var(--border);margin-bottom:8px">' +
          '<select class="form-input" id="rel-from" style="font-size:12px;margin-bottom:4px">' +
            '<option value="">From...</option>' + charOpts +
          '</select>' +
          '<select class="form-input" id="rel-to" style="font-size:12px;margin-bottom:4px">' +
            '<option value="">To...</option>' + charOpts +
          '</select>' +
          '<select class="form-input" id="rel-type" style="font-size:12px;margin-bottom:4px">' + typeOpts + '</select>' +
          '<input type="text" class="form-input" id="rel-desc" placeholder="Description (optional)" style="font-size:12px;margin-bottom:6px">' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn btn-ghost btn-xs" id="rel-form-cancel">Cancel</button>' +
            '<button class="btn btn-primary btn-xs" id="rel-form-save">Save</button>' +
          '</div>' +
        '</div>' +

        '<div class="rel-list">' +
          (rels.length
            ? rels.map(function (r) {
                return '<div class="rel-entry" data-rel-id="' + r.id + '" ' +
                  'style="display:flex;flex-direction:column;padding:6px 0;border-bottom:1px solid var(--border)">' +
                  '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
                    '<strong style="font-size:12px">' + escapeHtml(r.from_name) + '</strong>' +
                    '<span style="font-size:10px;padding:1px 5px;border-radius:8px;background:var(--bg-secondary);color:var(--text-muted)">' + escapeHtml(r.relationship_type) + '</span>' +
                    '<strong style="font-size:12px">' + escapeHtml(r.to_name) + '</strong>' +
                    '<button class="btn-rel-delete" data-rel-id="' + r.id + '" ' +
                      'style="margin-left:auto;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;line-height:1;padding:0 2px" title="Delete">&#215;</button>' +
                  '</div>' +
                  (r.description ? '<span style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escapeHtml(r.description) + '</span>' : '') +
                '</div>';
              }).join('')
            : '<div class="empty-state small">No relationships defined yet.</div>'
          ) +
        '</div>' +
      '</div>';

    var addBtn  = container.querySelector('#btn-add-rel');
    var addForm = container.querySelector('#rel-add-form');
    if (addBtn && addForm) {
      addBtn.onclick = function () {
        var open = addForm.style.display !== 'none';
        addForm.style.display = open ? 'none' : '';
      };
    }

    var cancelBtn = container.querySelector('#rel-form-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = function () { if (addForm) addForm.style.display = 'none'; };
    }

    var saveBtn = container.querySelector('#rel-form-save');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var fromEl = container.querySelector('#rel-from');
        var toEl   = container.querySelector('#rel-to');
        var typeEl = container.querySelector('#rel-type');
        var descEl = container.querySelector('#rel-desc');
        var from   = fromEl ? fromEl.value : '';
        var to     = toEl   ? toEl.value   : '';
        if (!from || !to)  { showToast('Select both characters.', 'error'); return; }
        if (from === to)   { showToast('A character cannot have a relationship with themselves.', 'error'); return; }
        saveBtn.disabled = true;
        API.createRelationship({
          from_character_id: Number(from),
          to_character_id:   Number(to),
          relationship_type: typeEl ? typeEl.value : 'friend',
          description:       descEl ? descEl.value.trim() : '',
        }).then(function () {
          showToast('Relationship added!', 'success');
          renderRelationshipsTab(container, scenarioId);
        }).catch(function (err) {
          saveBtn.disabled = false;
          showToast('Failed: ' + err.message, 'error');
        });
      };
    }

    container.querySelectorAll('.btn-rel-delete').forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm('Delete this relationship?')) return;
        btn.disabled = true;
        API.deleteRelationship(Number(btn.dataset.relId))
          .then(function () {
            var entry = btn.closest('.rel-entry');
            if (entry) entry.parentNode.removeChild(entry);
            showToast('Relationship removed.', 'info');
            var list = container.querySelector('.rel-list');
            if (list && !list.querySelectorAll('.rel-entry').length) {
              list.innerHTML = '<div class="empty-state small">No relationships defined yet.</div>';
            }
          })
          .catch(function (err) { btn.disabled = false; showToast('Failed: ' + err.message, 'error'); });
      };
    });

  }).catch(function (e) {
    container.innerHTML = '<div class="error-state">Failed: ' + escapeHtml(e.message) + '</div>';
  });
}


/* ============================================================
   MOOD / AROUSAL HELPERS
   ============================================================ */

// Fetches current character states for a scenario and caches them in state.characterStates
function _loadCharacterStates() {
  return Promise.resolve(); // no character-states endpoint in this version
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

// Builds a compact clothing line with an inline edit button per NPC card.
// Returns empty string when no clothing is stored — hidden gracefully.
function _buildClothingHtml(charId) {
  var cs       = state.characterStates && state.characterStates[charId];
  var clothing = cs && cs.current_clothing ? String(cs.current_clothing).trim() : '';
  return '<div class="clothing-state-wrap" data-char-id="' + charId + '"' +
    (clothing ? '' : ' style="display:none"') + '>' +
    '<span class="clothing-state-text" title="' + (clothing ? 'Current clothing: ' + escapeHtml(clothing) : '') + '">' +
    escapeHtml(clothing) + '</span>' +
    '<button class="clothing-edit-btn" title="Override clothing" type="button">&#9998;</button>' +
    '</div>';
}

// Handles clothingupdate WS event — updates in-memory state and patches .clothing-state-wrap nodes.
function handleClothingUpdate(data) {
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
}

// ---- inline clothing edit helpers ----

function _startClothingEdit(wrap) {
  var span     = wrap.querySelector('.clothing-state-text');
  var charId   = parseInt(wrap.getAttribute('data-char-id'), 10);
  var current  = span ? span.textContent.trim() : '';
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
  API.updateCharacterClothing(scenId, charId, { current_clothing: newVal })
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
  wrap.innerHTML =
    '<span class="clothing-state-text" title="' + (clothing ? 'Current clothing: ' + escapeHtml(clothing) : '') + '">' +
    escapeHtml(clothing) + '</span>' +
    '<button class="clothing-edit-btn" title="Override clothing" type="button">&#9998;</button>';
  wrap.style.display = clothing ? '' : 'none';
}

// Handles moodupdate WS event — updates in-memory state and refreshes bars in DOM
function handleMoodUpdate(data) {
  if (!data || !Array.isArray(data.characters)) return;
  if (!state.currentScenario || state.currentScenario.id !== data.scenarioId) return;
  data.characters.forEach(function (c) {
    if (!state.characterStates[c.characterId]) state.characterStates[c.characterId] = {};
    state.characterStates[c.characterId].moodcurrent    = c.moodcurrent;
    state.characterStates[c.characterId].arousalcurrent = c.arousalcurrent;
    // Update existing mood bars in DOM without full re-render
    var containers = document.querySelectorAll('.mood-bars[data-char-id="' + c.characterId + '"]');
    containers.forEach(function (el) {
      el.outerHTML = _buildMoodBarsHtml(c.characterId);
    });
  });
}

/* ============================================================
   WEBSOCKET — live push from server (image_ready events etc.)
   ============================================================ */

function handleImageReady(data) {
  var turnId        = data.turnId;
  var scenarioId    = data.scenarioId;
  var imageFilename = data.filename || data.imageFilename;
  var imageId       = data.imageId || null;
  if (!imageFilename) return;

  if (!state.currentScenario || state.currentScenario.id !== scenarioId) return;

  if (!turnId) {
    setImgStatus(null);
    showToast('Image generated.', 'success');
    return;
  }

  var turn = state.turns.find(function (t) { return t.id === turnId; });
  if (!turn) { console.warn('handleImageReady: turn not found in state', turnId); return; }
  turn.image_filename      = imageFilename;
  turn.image_visual_prompt = data.visualPrompt || '';
  if (imageId) turn.image_id = imageId;

  var el   = document.querySelector('[data-turn-id="' + turnId + '"]');
  var slot = el ? el.querySelector('.turn-image-slot') : null;
  if (slot) {
    // Clear pending indicator from turn footer if present
    var pending = el.querySelector('.turn-img-pending');
    if (pending) pending.parentNode.removeChild(pending);
    // Prepend the new image card — never replace existing images.
    // Each generation adds a new card; the delete button on old cards lets users clean up.
    var newCard = document.createElement('div');
    newCard.innerHTML = buildTurnImageHtml({
      filename:          turn.image_filename,
      imageId:           turn.image_id           || null,
      visualPrompt:      turn.image_visual_prompt || '',
      videostatus:       turn.image_videostatus   || '',
      videoclipfilename: turn.image_videoclipfilename || ''
    });
    slot.insertBefore(newCard.firstChild, slot.firstChild);
  } else {
    renderAllTurns();
  }

  setImgStatus(null);
  scrollThreadToBottom();
}

function handleSceneImageReady(data) {
  var turnId       = data.turnId;
  var filename     = data.filename;
  var imageId      = data.imageId      || null;
  var visualPrompt = data.visualPrompt || '';
  if (!turnId || !filename) return;

  if (!state.currentScenario) return;

  var turn = state.turns.find(function (t) { return t.id === turnId; });
  if (!turn) { console.warn('handleSceneImageReady: turn not found in state', turnId); return; }
  turn.image_filename      = filename;
  turn.image_id            = imageId;
  turn.image_visual_prompt = visualPrompt;

  var el   = document.querySelector('[data-turn-id="' + turnId + '"]');
  var slot = el ? el.querySelector('.turn-image-slot') : null;
  if (slot) {
    // Clear pending indicator from turn footer if present
    var pending = el.querySelector('.turn-img-pending');
    if (pending) pending.parentNode.removeChild(pending);
    // Prepend the new image card
    var newCard = document.createElement('div');
    newCard.innerHTML = buildTurnImageHtml({
      filename:          turn.image_filename,
      imageId:           turn.image_id           || null,
      visualPrompt:      turn.image_visual_prompt || '',
      videostatus:       '',
      videoclipfilename: ''
    });
    slot.insertBefore(newCard.firstChild, slot.firstChild);
  } else {
    renderAllTurns();
  }

  setImgStatus(null);
}

function handleVideoStatus(data) {
  var imgId = data.imageId;
  if (!imgId) return;
  // Right-side panel
  var cached = state._sceneImageCache[imgId];
  if (cached) {
    cached.videostatus = data.status;
    state._sceneImageCache[imgId] = cached;
    if (state.currentImageId === imgId) {
      state.currentImageData = cached;
      refreshAnimatePanel();
    }
  }
  // Thread card
  var threadCard = document.querySelector('.turn-image[data-image-id="' + imgId + '"]');
  _updateThreadImageVideoUi(threadCard, { videostatus: data.status });
}

function handleVideoReady(data) {
  var imgId = data.imageId;
  if (!imgId) return;
  // Right-side panel
  var cached = Object.assign({}, state._sceneImageCache[imgId] || {});
  cached.videostatus       = 'ready';
  cached.videoclipfilename = data.videoFilename;
  cached.videomodel        = data.videomodel;
  state._sceneImageCache[imgId] = cached;
  if (state.currentImageId === imgId) {
    state.currentImageData = cached;
    displayImage(cached);
  }
  // Thread card
  var threadCard = document.querySelector('.turn-image[data-image-id="' + imgId + '"]');
  _updateThreadImageVideoUi(threadCard, { videostatus: 'ready', videoclipfilename: data.videoFilename });
  showToast('Clip ready!', 'success');
}

function handleVideoError(data) {
  var imgId = data.imageId;
  if (!imgId) return;
  // Right-side panel
  var cached = Object.assign({}, state._sceneImageCache[imgId] || {});
  cached.videostatus = 'error';
  state._sceneImageCache[imgId] = cached;
  if (state.currentImageId === imgId) {
    state.currentImageData = cached;
    refreshAnimatePanel();
  }
  // Thread card
  var threadCard = document.querySelector('.turn-image[data-image-id="' + imgId + '"]');
  _updateThreadImageVideoUi(threadCard, { videostatus: 'error' });
  showToast('Clip generation failed.', 'error');
}

function handleImageError(data) {
  setImgStatus(null);
  var message = data.message || 'unknown error';

  // Show inline error on the latest narrator turn card.
  var allNarrTurns = document.querySelectorAll('.turn-narrator[data-turn-id]');
  var target = allNarrTurns.length ? allNarrTurns[allNarrTurns.length - 1] : null;
  if (target) {
    var pending = target.querySelector('.turn-img-pending');
    if (pending) {
      pending.className = 'turn-img-error';
      pending.textContent = 'Image failed: ' + message;
    } else {
      var errFooter = target.querySelector('.turn-footer');
      if (errFooter) {
        var errEl = document.createElement('span');
        errEl.className = 'turn-img-error';
        errEl.textContent = 'Image failed: ' + message;
        errFooter.appendChild(errEl);
      }
    }
  }

  showToast('Image generation failed: ' + message, 'error');
}
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

      case 'image_status':
        setImgStatus((data.payload && data.payload.message) || data.message || null);
        break;

      case 'image_ready':
        // broadcast wraps the payload as data.payload; support both shapes
        handleImageReady(data.payload ? Object.assign({}, data.payload, data) : data);
        break;

      case 'turn_complete': {
        if (data.turn && state.currentScenario && data.scenarioId === state.currentScenario.id) {
          var tcTurn = data.turn;
          var tcEl = document.querySelector('[data-turn-id="' + tcTurn.id + '"]');
          if (!tcEl) {
            var narTurnObj = Object.assign({ speaker: tcTurn.role }, tcTurn);
            appendTurnToThread(narTurnObj);
            if (!state.turns.find(function(t) { return t.id === tcTurn.id; })) {
              state.turns.push(narTurnObj);
              sortTurns();
            }
          }
        }
        break;
      }

      // Alternate event shape from some backend paths
      case 'sceneimage':
        handleImageReady({
          turnId:        data.turnId,
          imageFilename: data.filename || data.imageFilename,
          imageId:       data.imageId,
          visualPrompt:  data.visualPrompt
        });
        break;

      case 'image_error': {
        var errMsg = (data.payload && data.payload.error) || data.message || 'Image generation failed';
        setImgStatus(null);
        showToast(errMsg, 'error');
        document.querySelectorAll('.turn-img-pending').forEach(function (el) {
          el.className = 'turn-img-error';
          el.textContent = 'Image failed: ' + errMsg;
        });
        break;
      }

      case 'moodupdate':
        if (!Array.isArray(data.characters)) break;
        data.characters.forEach(function (c) {
          if (!state.characterStates) state.characterStates = {};
          state.characterStates[c.characterId] = {
            moodcurrent:    c.moodcurrent,
            arousalcurrent: c.arousalcurrent
          };
          document.querySelectorAll('.mood-bars[data-char-id="' + c.characterId + '"]').forEach(function (el) {
            if (window._buildMoodBarsHtml) el.outerHTML = window._buildMoodBarsHtml(c.characterId);
          });
        });
        break;

      case 'videostatus': {
        var vsId = data.imageId;
        if (!vsId) break;
        var vsCard = document.querySelector('.turn-image[data-image-id="' + vsId + '"]');
        if (vsCard) _updateThreadImageVideoUi(vsCard, { videostatus: data.status });
        if (state._sceneImageCache && state._sceneImageCache[vsId]) state._sceneImageCache[vsId].videostatus = data.status;
        if (state.currentImageData && state.currentImageData.id === vsId) {
          state.currentImageData.videostatus = data.status;
          if (window._refreshAnimatePanel) window._refreshAnimatePanel();
        }
        break;
      }

      case 'videoready': {
        var vrId = data.imageId;
        var vrFn = data.videoFilename || data.videoclipfilename || '';
        if (!vrId) break;
        var vrCard = document.querySelector('.turn-image[data-image-id="' + vrId + '"]');
        if (vrCard) _updateThreadImageVideoUi(vrCard, { videostatus: 'ready', videoclipfilename: vrFn });
        if (state._sceneImageCache && state._sceneImageCache[vrId]) {
          state._sceneImageCache[vrId].videostatus = 'ready';
          state._sceneImageCache[vrId].videoclipfilename = vrFn;
        }
        if (state.currentImageData && state.currentImageData.id === vrId) {
          state.currentImageData.videostatus = 'ready';
          state.currentImageData.videoclipfilename = vrFn;
          if (window._refreshAnimatePanel) window._refreshAnimatePanel();
        }
        break;
      }

      case 'videoerror': {
        var veId = data.imageId;
        if (!veId) break;
        var veCard = document.querySelector('.turn-image[data-image-id="' + veId + '"]');
        if (veCard) _updateThreadImageVideoUi(veCard, { videostatus: 'error' });
        if (state._sceneImageCache && state._sceneImageCache[veId]) state._sceneImageCache[veId].videostatus = 'error';
        if (state.currentImageData && state.currentImageData.id === veId) {
          state.currentImageData.videostatus = 'error';
          if (window._refreshAnimatePanel) window._refreshAnimatePanel();
        }
        break;
      }

      case 'clothingupdate':
        if (state.currentScenario && data.scenarioId === state.currentScenario.id) {
          handleClothingUpdate(data);
          if (state.currentSidebarTab === 'clothing') {
            loadSidebarTab('clothing', data.scenarioId);
          }
        }
        break;

      case 'presencechange':
        if (state.currentScenario && data.scenarioId === state.currentScenario.id) {
          if (_updateScenePresent) _updateScenePresent(data.added, data.removed);
          if (_reloadPortraitPanel) _reloadPortraitPanel();
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
        if (window._debugConsole && typeof window._debugConsole.push === 'function') window._debugConsole.push(data);
        break;

      case 'image_prompt':
        if (state.currentScenario && data.scenarioId === state.currentScenario.id) {
          _showImagePromptToast(data.scenarioId, data.turnId, data.reason);
        }
        break;


      default:
        break;
    }
  };
}

function _showImagePromptToast(scenarioId, turnId, reason) {
  var existing = document.getElementById('image-prompt-toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.id = 'image-prompt-toast';
  toast.className = 'image-prompt-toast';

  var reasonSpan = document.createElement('span');
  reasonSpan.className = 'ipt-reason';
  reasonSpan.textContent = 'Memorable moment: ' + (reason || '');
  toast.appendChild(reasonSpan);

  var yesBtn = document.createElement('button');
  yesBtn.className = 'btn btn-primary btn-sm ipt-yes';
  yesBtn.textContent = 'Generate Image';
  toast.appendChild(yesBtn);

  var noBtn = document.createElement('button');
  noBtn.className = 'btn btn-secondary btn-sm ipt-no';
  noBtn.textContent = 'X';
  toast.appendChild(noBtn);

  document.body.appendChild(toast);

  var timer = setTimeout(function () { toast.remove(); }, 30000);

  yesBtn.addEventListener('click', function () {
    clearTimeout(timer);
    toast.remove();
    API.generateSceneImage(scenarioId, turnId).catch(function (e) {
      showToast('Image generation failed: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    });
  });

  noBtn.addEventListener('click', function () {
    clearTimeout(timer);
    toast.remove();
  });
}
