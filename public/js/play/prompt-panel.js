import { escapeHtml, imageSrc } from '../utils.js';
import { showToast } from '../ui.js';
import { state } from '../state.js';
import { setImgStatus } from '../ui.js';

var _scenarioId = null;
var _target = 'scene';
var _characterId = null;
var _turnId = null;
var _loading = false;
var _pendingImageId = null;

function _latestNarratorTurn() {
  var turns = (state.turns || []).filter(function (t) {
    return t.role === 'narrator' || t.speaker === 'narrator';
  });
  if (!turns.length) return null;
  return turns[turns.length - 1];
}

function _plainEl() { return document.getElementById('prompt-plain'); }
function _tagsEl() { return document.getElementById('prompt-tags'); }

function _setLoading(on) {
  _loading = on;
  var list = document.getElementById('prompt-target-list');
  if (list) list.classList.toggle('is-loading', on);
  var gen = document.getElementById('prompt-generate-btn');
  if (gen) gen.disabled = on;
}

function _renderTargets(characters) {
  var list = document.getElementById('prompt-target-list');
  if (!list) return;
  var html = '<button type="button" class="prompt-target-chip' + (_target === 'scene' ? ' active' : '') + '" data-target="scene">Scene</button>';
  (characters || []).forEach(function (c) {
    var active = _target === 'character' && String(_characterId) === String(c.id);
    html += '<button type="button" class="prompt-target-chip' + (active ? ' active' : '') + '" data-target="character" data-char-id="' + c.id + '">' + escapeHtml(c.name || 'Char') + '</button>';
  });
  list.innerHTML = html;
  list.querySelectorAll('.prompt-target-chip').forEach(function (btn) {
    btn.onclick = function () {
      if (btn.dataset.target === 'scene') {
        _target = 'scene';
        _characterId = null;
      } else {
        _target = 'character';
        _characterId = parseInt(btn.dataset.charId, 10);
      }
      _renderTargets(characters);
      refreshPromptPreview();
    };
  });
}

export function refreshPromptPreview() {
  if (!_scenarioId) return;
  var turn = _latestNarratorTurn();
  _turnId = turn ? turn.id : null;
  if (!turn) {
    if (_plainEl()) _plainEl().value = '';
    if (_tagsEl()) _tagsEl().value = '';
    return;
  }
  _setLoading(true);
  if (_plainEl()) {
    _plainEl().value = _target === 'character'
      ? 'Loading character visual brief...'
      : 'Loading scene visual brief...';
  }
  if (_tagsEl()) {
    _tagsEl().value = _target === 'character'
      ? 'Assembling image tags from brief...'
      : 'Loading scene tags...';
  }
  API.postPromptPreview(_scenarioId, {
    turn_id: turn.id,
    target: _target,
    characterId: _target === 'character' ? _characterId : null,
  })
    .then(function (data) {
      _turnId = data.turn_id || turn.id;
      var plain = (data.summary_plain || '').trim();
      var tags = (data.summary_tags || '').trim();
      if (plain && tags === plain) tags = '';
      if (_plainEl()) _plainEl().value = plain;
      if (_tagsEl()) _tagsEl().value = tags;
      var hint = document.getElementById('prompt-empty-hint');
      if (hint) hint.style.display = plain || tags ? 'none' : 'block';
    })
    .catch(function (err) {
      if (_plainEl()) _plainEl().value = '';
      if (_tagsEl()) _tagsEl().value = '';
      showToast('Prompt preview failed: ' + err.message, 'error');
    })
    .finally(function () { _setLoading(false); });
}

function _saveToTurn() {
  if (!_scenarioId || !_turnId) return Promise.reject(new Error('No narrator turn to save to'));
  return API.patchSceneSummary(_scenarioId, _turnId, {
    summary_plain: _plainEl() ? _plainEl().value : '',
    summary_tags: _tagsEl() ? _tagsEl().value : '',
    reset: false,
  }).then(function (resp) {
    if (resp && resp.scene_card) {
      var turns = state.turns || [];
      turns.forEach(function (t) {
        if (String(t.id) === String(_turnId)) t.scene_card_json = JSON.stringify(resp.scene_card);
      });
    }
    return resp;
  });
}

function _generateImage() {
  if (!_scenarioId) return;
  var turn = _turnId ? state.turns.find(function (t) { return String(t.id) === String(_turnId); }) : _latestNarratorTurn();
  if (!turn) {
    showToast('Continue the story first to generate an image.', 'info');
    return;
  }
  _turnId = turn.id;
  setImgStatus('Preparing image...');
  _pendingImageId = null;

  _saveToTurn()
    .then(function () {
      var plain = _plainEl() ? _plainEl().value.trim() : '';
      var tags = _tagsEl() ? _tagsEl().value.trim() : '';
      var edited = tags || plain;
      var body = { turn_id: turn.id, mode: _target === 'character' ? 'character' : 'scene' };
      if (_target === 'character' && _characterId) body.characterId = _characterId;
      if (edited) {
        body.directPrompt = true;
        body.rawPrompt = edited;
      }
      return API.generateImage(_scenarioId, body);
    })
    .then(function () {
      showToast('Image generation started.', 'info');
    })
    .catch(function (err) {
      setImgStatus(null);
      showToast('Image failed: ' + err.message, 'error');
    });
}

function _buildRatingHtml(imageId) {
  return (
    '<div class="prompt-rating-panel" data-image-id="' + escapeHtml(String(imageId)) + '">' +
      '<p class="prompt-rating-title">Rate this image</p>' +
      '<label class="prompt-rating-label">Content match (vs summary)</label>' +
      '<div class="prompt-rating-row" data-field="content">' +
        [1,2,3,4,5].map(function (n) {
          return '<button type="button" class="prompt-rate-btn" data-value="' + n + '">' + n + '</button>';
        }).join('') +
      '</div>' +
      '<label class="prompt-rating-label">Style match (vs look)</label>' +
      '<div class="prompt-rating-row" data-field="style">' +
        [1,2,3,4,5].map(function (n) {
          return '<button type="button" class="prompt-rate-btn" data-value="' + n + '">' + n + '</button>';
        }).join('') +
      '</div>' +
      '<div class="prompt-rating-actions">' +
        '<button type="button" class="btn btn-primary btn-sm prompt-rating-save">Save ratings</button>' +
        '<button type="button" class="btn btn-ghost btn-sm prompt-rating-skip">Skip</button>' +
      '</div>' +
    '</div>'
  );
}

function _wireRating(panel, imageId) {
  var content = null;
  var style = null;
  panel.querySelectorAll('.prompt-rate-btn').forEach(function (btn) {
    btn.onclick = function () {
      var row = btn.closest('.prompt-rating-row');
      var field = row && row.dataset.field;
      row.querySelectorAll('.prompt-rate-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      if (field === 'content') content = parseInt(btn.dataset.value, 10);
      if (field === 'style') style = parseInt(btn.dataset.value, 10);
    };
  });
  var skipBtn = panel.querySelector('.prompt-rating-skip');
  if (skipBtn) {
    skipBtn.onclick = function () {
      API.patchImageRatings(_scenarioId, imageId, { rating_skipped: true })
        .then(function () {
          panel.innerHTML = '<p class="text-muted">Ratings skipped.</p>';
        })
        .catch(function (err) { showToast(err.message, 'error'); });
    };
  }
  var saveBtn = panel.querySelector('.prompt-rating-save');
  if (saveBtn) {
    saveBtn.onclick = function () {
      if (content == null || style == null) {
        showToast('Select both content and style scores.', 'info');
        return;
      }
      API.patchImageRatings(_scenarioId, imageId, { content_rating: content, style_rating: style })
        .then(function () {
          panel.innerHTML = '<p class="text-muted">Ratings saved. Thanks!</p>';
          showToast('Ratings saved.', 'success');
        })
        .catch(function (err) { showToast(err.message, 'error'); });
    };
  }
}

export function onPromptPanelImageReady(data) {
  if (!data || !data.imageId || !data.turnId) return;

  var turnEl = document.querySelector('[data-turn-id="' + data.turnId + '"]');
  if (!turnEl) return;

  var card = turnEl.querySelector('.turn-image[data-image-id="' + data.imageId + '"]');
  if (!card) card = turnEl.querySelector('.turn-image-slot .turn-image');
  if (!card || card.querySelector('.turn-image-rating-slot')) return;

  var ratingHost = document.createElement('div');
  ratingHost.className = 'turn-image-rating-slot';
  ratingHost.innerHTML = _buildRatingHtml(data.imageId);
  card.appendChild(ratingHost);
  _wireRating(ratingHost, data.imageId);
}

export function initPromptPanel(scenarioId) {
  _scenarioId = scenarioId;
  _target = 'scene';
  _characterId = null;

  var chars = (state.currentScenario && state.currentScenario.characters) || [];
  _renderTargets(chars);

  var saveBtn = document.getElementById('prompt-save-btn');
  if (saveBtn && saveBtn.dataset.wired !== '1') {
    saveBtn.dataset.wired = '1';
    saveBtn.onclick = function () {
      _saveToTurn().then(function () { showToast('Prompt saved to turn.', 'success'); })
        .catch(function (err) { showToast('Save failed: ' + err.message, 'error'); });
    };
  }

  var resetBtn = document.getElementById('prompt-reset-btn');
  if (resetBtn && resetBtn.dataset.wired !== '1') {
    resetBtn.dataset.wired = '1';
    resetBtn.onclick = function () {
      if (!_turnId) return;
      API.patchSceneSummary(_scenarioId, _turnId, { reset: true })
        .then(function (resp) {
          if (resp && resp.scene_card) {
            var p = (resp.scene_card.summary_plain || '').trim();
            var tg = (resp.scene_card.summary_tags || '').trim();
            if (p && tg === p) tg = '';
            if (_plainEl()) _plainEl().value = p;
            if (_tagsEl()) _tagsEl().value = tg;
          }
          showToast('Prompt reset.', 'success');
        })
        .catch(function (err) { showToast(err.message, 'error'); });
    };
  }

  var regenBtn = document.getElementById('prompt-regenerate-btn');
  if (regenBtn && regenBtn.dataset.wired !== '1') {
    regenBtn.dataset.wired = '1';
    regenBtn.onclick = function () {
      if (!_scenarioId || !_turnId) { showToast('No turn selected.', 'info'); return; }
      var plain = _plainEl() ? _plainEl().value.trim() : '';
      if (!plain) { showToast('Enter plain summary first.', 'info'); return; }
      _setLoading(true);
      API.postRegenerateTags(_scenarioId, _turnId, { summary_plain: plain })
        .then(function (data) {
          if (_tagsEl() && data.tags) _tagsEl().value = data.tags;
          showToast('Tags regenerated - click Save to persist.', 'success');
        })
        .catch(function (err) { showToast(err.message, 'error'); })
        .finally(function () { _setLoading(false); });
    };
  }

  var histBtn = document.getElementById('prompt-history-btn');
  if (histBtn && histBtn.dataset.wired !== '1') {
    histBtn.dataset.wired = '1';
    histBtn.onclick = function () {
      if (!_scenarioId || !_turnId) return;
      API.getSummaryHistory(_scenarioId, _turnId).then(function (data) {
        var events = (data && data.events) || [];
        var html = events.length
          ? events.map(function (ev) {
              return '<div class="summary-history-row"><span class="text-muted">' + escapeHtml(ev.created_at || '') + '</span> ' +
                escapeHtml(ev.field) + ' (' + escapeHtml(ev.source) + ')<br><small>' +
                escapeHtml((ev.value_before || '').slice(0, 80)) + ' -> ' + escapeHtml((ev.value_after || '').slice(0, 80)) + '</small></div>';
            }).join('')
          : '<p class="text-muted">No edit history yet.</p>';
        var modal = document.getElementById('prompt-history-modal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'prompt-history-modal';
          modal.className = 'modal-overlay';
          modal.innerHTML = '<div class="modal-card"><h3>Summary History</h3><div id="prompt-history-body"></div><button type="button" class="btn btn-ghost btn-sm" id="prompt-history-close">Close</button></div>';
          document.body.appendChild(modal);
          modal.querySelector('#prompt-history-close').onclick = function () { modal.style.display = 'none'; };
          modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
        }
        document.getElementById('prompt-history-body').innerHTML = html;
        modal.style.display = 'flex';
      }).catch(function (err) { showToast(err.message, 'error'); });
    };
  }

  var genBtn = document.getElementById('prompt-generate-btn');
  if (genBtn && genBtn.dataset.wired !== '1') {
    genBtn.dataset.wired = '1';
    genBtn.onclick = _generateImage;
  }

  refreshPromptPreview();
}

export function reloadPromptPanelTargets() {
  if (!_scenarioId) return;
  var chars = (state.currentScenario && state.currentScenario.characters) || [];
  _renderTargets(chars);
}
