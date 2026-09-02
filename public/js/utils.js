// Extracted from app.js Phase 7 — pure utility functions with no state dependencies.

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _formatInline(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function formatStoryContent(text) {
  if (!text) return '';
  var escaped = _formatInline(text);
  var paras = escaped.split(/\n\n+/);
  return paras
    .filter(function (p) { return p.trim(); })
    .map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; })
    .join('');
}

export function groupAcceptedImagesByTurn(images) {
  var grouped = {};
  (images || []).forEach(function (image) {
    if (!image || !image.accepted || image.turn_id == null) return;
    var key = String(image.turn_id);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(image);
  });
  return grouped;
}

export function renderAcceptedStoryImages(scenarioId, images) {
  if (!Array.isArray(images) || !images.length) return '';
  var cards = images.map(function (image) {
    var src = '/story-images/' + encodeURIComponent(scenarioId) + '/' + encodeURIComponent(image.filename || '');
    var mode = String(image.mode || 'story').toLowerCase();
    return '<figure class="turn-accepted-image" data-story-image-id="' + escapeHtml(image.id) + '">' +
      '<img src="' + src + '" alt="Accepted ' + escapeHtml(mode) + ' image" loading="lazy">' +
    '</figure>';
  }).join('');
  return '<div class="turn-accepted-images">' + cards + '</div>';
}

export function buildImageGenerationOptions({
  turnId,
  mode = 'scene',
  sceneText = '',
  characterAction = '',
  characterId = null,
} = {}) {
  var options = {
    turnId: turnId,
    mode: mode,
    actionText: String(sceneText || '').trim(),
  };
  var trimmedAction = String(characterAction || '').trim();
  if (trimmedAction) options.characterAction = trimmedAction;
  if ((mode === 'portrait' || mode === 'fullbody') && characterId) {
    options.characterIds = [Number(characterId)];
  }
  return options;
}

// Response ID for the "A5-11" addressing scheme (see
// docs/superpowers/specs/2026-07-15-narrator-line-numbering-design.md). Counts narrator-role
// turns only, in turn_number order, ignoring interleaved user/other-role turns. Returns null
// for a non-narrator turn.
export function narratorResponseLabel(turns, targetTurn) {
  if (!targetTurn) return null;
  var targetRole = targetTurn.speaker || targetTurn.role;
  if (targetRole !== 'narrator') return null;
  var targetNum = targetTurn.turn_number || 0;
  var count = 0;
  (turns || []).forEach(function (t) {
    var role = t.speaker || t.role;
    if (role === 'narrator' && (t.turn_number || 0) <= targetNum) count += 1;
  });
  return 'A' + count;
}

// Renders a narrator turn's raw content_text as numbered source lines with a faint gutter,
// instead of formatStoryContent's paragraph/<br> rendering. Blank lines (paragraph breaks)
// are spacing only and never consume a line number; consecutive blank lines collapse into a
// single spacer so the gutter never shows duplicate gaps.
export function formatNarratorLinesWithGutter(text) {
  if (!text) return '';
  // Inline formatting (_formatInline) runs per-line, AFTER splitting on '\n' — not on the
  // whole text first. Running it first would let the *em* regex match across a line break
  // (its char class doesn't exclude '\n'), producing an unclosed <em> in one line's span and
  // an orphan </em> in the next once the lines are split into separate DOM elements.
  var rawLines = String(text).split('\n');
  var lineNum = 0;
  var prevWasSpacer = false;
  var rows = [];
  rawLines.forEach(function (line) {
    if (!line.trim()) {
      if (!prevWasSpacer) rows.push('<div class="turn-line-spacer"></div>');
      prevWasSpacer = true;
      return;
    }
    prevWasSpacer = false;
    lineNum += 1;
    rows.push(
      '<div class="turn-line">' +
        '<span class="turn-line-num">' + lineNum + '</span>' +
        '<span class="turn-line-content">' + _formatInline(line) + '</span>' +
      '</div>'
    );
  });
  return '<div class="turn-line-gutter">' + rows.join('') + '</div>';
}

export function relativeTime(dateStr) {
  if (!dateStr) return 'Never';
  var diff = Date.now() - new Date(dateStr).getTime();
  var mins  = Math.floor(diff / 60000);
  var hours = Math.floor(diff / 3600000);
  var days  = Math.floor(diff / 86400000);
  if (mins < 1)    return 'Just now';
  if (mins < 60)   return mins  + 'm ago';
  if (hours < 24)  return hours + 'h ago';
  if (days < 30)   return days  + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

// Returns HTML for a circular character avatar (initial letter).
// extraClass is appended to 'char-avatar' — e.g. 'turn-avatar' for 40px size.
export function avatarHtml(char, extraClass) {
  var cls = 'char-avatar' + (extraClass ? ' ' + extraClass : '');
  var initial = (char && char.name) ? escapeHtml(char.name[0].toUpperCase()) : '?';
  return '<div class="' + cls + '">' + initial + '</div>';
}

export function traitSelect(id, current, opts) {
  var inner = '<option value=""></option>' +
    opts.map(function(o) {
      return '<option value="' + escapeHtml(o[0]) + '"' + (current === o[0] ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>';
    }).join('');
  return '<select class="form-input trait-select" id="' + escapeHtml(id) + '">' + inner + '</select>';
}
