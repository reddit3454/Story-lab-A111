import { escapeHtml } from '../utils.js';
import { showToast } from '../ui.js';
import { state } from '../state.js';

let _panelDefaultExpanded = true;

export function setImageSummaryPanelDefault(configValue) {
  _panelDefaultExpanded = (configValue || 'visible') !== 'minimized';
}

export function isTagLike(text) {
  if (!text || typeof text !== 'string') return false;
  var t = text.trim();
  if (!t) return false;
  var chunks = t.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (chunks.length < 6) return false;
  var avgLen = chunks.reduce(function (a, c) { return a + c.length; }, 0) / chunks.length;
  if (avgLen > 32) return false;
  if (/\b(the|their|she|he|with|while|as they|in the|on the)\b/i.test(t) && t.length > 60) return false;
  return true;
}

export function normalizeSceneCard(card) {
  var base = {
    summary_plain: '',
    summary_tags: '',
    image_prompt: '',
    mood: 'neutral',
    arousal_level: 1,
    nsfw_elements: false,
    explicit_act: null,
    nudity_state: null,
    body_positions: null,
    clothing_changes: [],
  };
  var out = Object.assign({}, base, card && typeof card === 'object' ? card : {});

  if (out.image_prompt && !out.summary_plain && !out.summary_tags) {
    if (isTagLike(out.image_prompt)) {
      out.summary_tags = out.image_prompt;
    } else {
      out.summary_plain = out.image_prompt;
    }
  } else {
    if (!out.summary_plain && out.image_prompt && !isTagLike(out.image_prompt)) {
      out.summary_plain = out.image_prompt;
    }
    if (!out.summary_tags && out.image_prompt && isTagLike(out.image_prompt) && out.image_prompt !== out.summary_plain) {
      out.summary_tags = out.image_prompt;
    }
  }

  if (!out._meta || typeof out._meta !== 'object') {
    out._meta = {
      plain_source: out.summary_plain ? 'narrator' : 'empty',
      tags_source: out.summary_tags ? 'extractor' : 'empty',
      locale: 'en',
    };
  }

  return out;
}

export function parseSceneCardFromTurn(turn) {
  if (!turn || turn.scene_card_json == null || turn.scene_card_json === '') {
    return { status: 'empty', card: null };
  }
  try {
    var raw = turn.scene_card_json;
    var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') {
      return { status: 'unavailable', card: null };
    }
    return { status: 'ok', card: normalizeSceneCard(parsed) };
  } catch (_) {
    return { status: 'unavailable', card: null };
  }
}

export function isNarratorTurn(turn) {
  return !!(turn && (turn.role === 'narrator' || turn.speaker === 'narrator'));
}

function _previewLine(text) {
  var t = (text || '').trim();
  if (!t) return 'No summary yet';
  return t.length > 80 ? t.slice(0, 80) + '...' : t;
}

function _updateTurnInState(turnId, sceneCard) {
  if (!state.turns || !turnId) return;
  state.turns.forEach(function (t) {
    if (String(t.id) === String(turnId)) {
      t.scene_card_json = JSON.stringify(sceneCard);
    }
  });
}

function _setPanelPreview(panel, plain, tags) {
  var preview = panel.querySelector('.image-summary-preview');
  if (preview) preview.textContent = _previewLine(plain || tags || 'No summary yet');
}

function _openHistoryModal(scenarioId, turnId) {
  var overlay = document.getElementById('modal-overlay');
  if (!overlay) return;
  overlay.innerHTML = '<div class="modal image-summary-history-modal"><h3 class="modal-title">Summary History</h3><p class="text-muted">Loading...</p></div>';
  overlay.classList.remove('hidden');
  overlay.onclick = function (e) {
    if (e.target === overlay) overlay.classList.add('hidden');
  };

  API.getSummaryHistory(scenarioId, turnId)
    .then(function (data) {
      var events = (data && data.events) || [];
      var body = '';
      if (!events.length) {
        body = '<p class="text-muted">No edit history yet.</p>';
      } else {
        body = '<ul class="image-summary-history-list">';
        events.forEach(function (ev) {
          var before = (ev.value_before || '').trim();
          var after = (ev.value_after || '').trim();
          var beforeShort = before.length > 60 ? before.slice(0, 60) + '...' : before;
          var afterShort = after.length > 60 ? after.slice(0, 60) + '...' : after;
          body += '<li class="image-summary-history-item">' +
            '<div class="image-summary-history-meta">' +
              escapeHtml(ev.created_at || '') + ' · ' + escapeHtml(ev.field || '') + ' · ' + escapeHtml(ev.source || '') +
            '</div>' +
            '<div class="image-summary-history-diff">' +
              escapeHtml(beforeShort || '(empty)') + ' → ' + escapeHtml(afterShort || '(empty)') +
            '</div></li>';
        });
        body += '</ul>';
      }
      overlay.innerHTML =
        '<div class="modal image-summary-history-modal">' +
          '<h3 class="modal-title">Summary History</h3>' +
          body +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="image-summary-history-close">Close</button>' +
          '</div>' +
        '</div>';
      var closeBtn = document.getElementById('image-summary-history-close');
      if (closeBtn) closeBtn.onclick = function () { overlay.classList.add('hidden'); };
    })
    .catch(function (err) {
      overlay.innerHTML =
        '<div class="modal image-summary-history-modal">' +
          '<h3 class="modal-title">Summary History</h3>' +
          '<p class="text-muted">' + escapeHtml(err.message || 'Failed to load history') + '</p>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="image-summary-history-close">Close</button>' +
          '</div>' +
        '</div>';
      var closeBtn = document.getElementById('image-summary-history-close');
      if (closeBtn) closeBtn.onclick = function () { overlay.classList.add('hidden'); };
    });
}

export function renderImageSummaryHtml(turn, expandedOverride) {
  if (!isNarratorTurn(turn)) return '';

  var expanded = expandedOverride != null ? expandedOverride : _panelDefaultExpanded;
  var sc = parseSceneCardFromTurn(turn);
  var plain = sc.card ? (sc.card.summary_plain || '').trim() : '';
  var tags = sc.card ? (sc.card.summary_tags || '').trim() : '';
  if (plain && tags === plain) tags = '';
  var statusMsg = '';

  if (sc.status === 'unavailable') {
    statusMsg = 'Summary unavailable';
  } else if (sc.status === 'empty' || (!plain && !tags)) {
    statusMsg = 'No summary yet';
  }

  var collapsedClass = expanded ? '' : ' is-collapsed';
  var preview = _previewLine(plain || tags || statusMsg);

  return (
    '<div class="image-summary-panel' + collapsedClass + '" data-turn-id="' + escapeHtml(String(turn.id || '')) + '">' +
      '<div class="image-summary-header">' +
        '<button type="button" class="image-summary-toggle" title="Expand or collapse">' +
          '<span class="image-summary-chevron">' + (expanded ? '&#9660;' : '&#9654;') + '</span>' +
          '<span class="image-summary-title">Image Summary</span>' +
        '</button>' +
        '<span class="image-summary-preview">' + escapeHtml(preview) + '</span>' +
      '</div>' +
      '<div class="image-summary-body">' +
        (statusMsg && !plain && !tags
          ? '<p class="image-summary-status text-muted">' + escapeHtml(statusMsg) + '</p>'
          : '') +
        '<label class="image-summary-label">Summary (plain language)</label>' +
        '<textarea class="image-summary-plain form-input" rows="3" placeholder="Plain language shot description">' +
          escapeHtml(plain) +
        '</textarea>' +
        '<label class="image-summary-label">Tags (SDXL)</label>' +
        '<textarea class="image-summary-tags form-input" rows="2" placeholder="Comma-separated tags">' +
          escapeHtml(tags) +
        '</textarea>' +
        '<div class="image-summary-actions">' +
          '<button type="button" class="btn btn-primary btn-sm image-summary-save">Save</button>' +
          '<button type="button" class="btn btn-ghost btn-sm image-summary-reset">Reset</button>' +
          '<button type="button" class="btn btn-ghost btn-sm image-summary-history">History</button>' +
        '</div>' +
        '<p class="image-summary-hint text-muted">Tag regeneration arrives in the next phase.</p>' +
      '</div>' +
    '</div>'
  );
}

function _savePanel(panel, scenarioId) {
  var turnId = panel.getAttribute('data-turn-id');
  if (!turnId || !scenarioId) return;
  var plainEl = panel.querySelector('.image-summary-plain');
  var tagsEl = panel.querySelector('.image-summary-tags');
  var saveBtn = panel.querySelector('.image-summary-save');
  if (saveBtn) saveBtn.disabled = true;

  API.patchSceneSummary(scenarioId, turnId, {
    summary_plain: plainEl ? plainEl.value : '',
    summary_tags: tagsEl ? tagsEl.value : '',
    reset: false,
  })
    .then(function (resp) {
      if (resp && resp.scene_card) {
        _updateTurnInState(turnId, resp.scene_card);
        var p = (resp.scene_card.summary_plain || '').trim();
        var tg = (resp.scene_card.summary_tags || '').trim();
        if (p && tg === p) tg = '';
        if (plainEl) plainEl.value = p;
        if (tagsEl) tagsEl.value = tg;
        _setPanelPreview(panel, p, tg);
      }
      showToast('Summary saved.', 'success');
    })
    .catch(function (err) {
      showToast('Save failed: ' + err.message, 'error');
    })
    .finally(function () {
      if (saveBtn) saveBtn.disabled = false;
    });
}

function _resetPanel(panel, scenarioId) {
  var turnId = panel.getAttribute('data-turn-id');
  if (!turnId || !scenarioId) return;
  var plainEl = panel.querySelector('.image-summary-plain');
  var tagsEl = panel.querySelector('.image-summary-tags');

  API.patchSceneSummary(scenarioId, turnId, { reset: true })
    .then(function (resp) {
      if (resp && resp.scene_card) {
        _updateTurnInState(turnId, resp.scene_card);
        var p = (resp.scene_card.summary_plain || '').trim();
        var tg = (resp.scene_card.summary_tags || '').trim();
        if (p && tg === p) tg = '';
        if (plainEl) plainEl.value = p;
        if (tagsEl) tagsEl.value = tg;
        _setPanelPreview(panel, p, tg);
      }
      showToast('Summary reset to originals.', 'success');
    })
    .catch(function (err) {
      showToast('Reset failed: ' + err.message, 'error');
    });
}

export function wireImageSummaryPanel(turnEl, scenarioId) {
  var panel = turnEl.querySelector('.image-summary-panel');
  if (!panel) return;

  var toggle = panel.querySelector('.image-summary-toggle');
  if (toggle && toggle.dataset.wired !== '1') {
    toggle.dataset.wired = '1';
    toggle.onclick = function () {
      var collapsed = panel.classList.toggle('is-collapsed');
      var chev = panel.querySelector('.image-summary-chevron');
      if (chev) chev.innerHTML = collapsed ? '&#9654;' : '&#9660;';
    };
  }

  var saveBtn = panel.querySelector('.image-summary-save');
  if (saveBtn && saveBtn.dataset.wired !== '1') {
    saveBtn.dataset.wired = '1';
    saveBtn.onclick = function () { _savePanel(panel, scenarioId); };
  }

  var resetBtn = panel.querySelector('.image-summary-reset');
  if (resetBtn && resetBtn.dataset.wired !== '1') {
    resetBtn.dataset.wired = '1';
    resetBtn.onclick = function () { _resetPanel(panel, scenarioId); };
  }

  var histBtn = panel.querySelector('.image-summary-history');
  if (histBtn && histBtn.dataset.wired !== '1') {
    histBtn.dataset.wired = '1';
    histBtn.onclick = function () {
      _openHistoryModal(scenarioId, panel.getAttribute('data-turn-id'));
    };
  }
}

export function initImageSummaryPanels(rootEl, scenarioId) {
  var root = rootEl || document.getElementById('play-thread');
  if (!root) return;
  var sid = scenarioId || (state.currentScenario && state.currentScenario.id);
  if (!sid) return;
  root.querySelectorAll('.turn').forEach(function (turnEl) {
    if (turnEl.querySelector('.image-summary-panel')) wireImageSummaryPanel(turnEl, sid);
  });
}

export function wireImageSummaryPanelsInThread(rootEl) {
  initImageSummaryPanels(rootEl, state.currentScenario && state.currentScenario.id);
}
