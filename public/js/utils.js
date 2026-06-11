// Extracted from app.js Phase 7 — pure utility functions with no state dependencies.

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatStoryContent(text) {
  if (!text) return '';
  var escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  var paras = escaped.split(/\n\n+/);
  return paras
    .filter(function (p) { return p.trim(); })
    .map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; })
    .join('');
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

export function imageSrc(filename) {
  if (!filename) return '';
  return 'http://localhost:4090/story-images/' + filename;
}

// Returns HTML for a circular character avatar.
// Shows reference image if available; falls back to initial circle on error or absence.
// extraClass is appended to 'char-avatar' — e.g. 'turn-avatar' for 40px size.
export function avatarHtml(char, extraClass) {
  var cls = 'char-avatar' + (extraClass ? ' ' + extraClass : '');
  var initial = (char && char.name) ? escapeHtml(char.name[0].toUpperCase()) : '?';
  if (char && char.reference_image_path) {
    return '<div class="' + cls + ' char-avatar-img" data-initial="' + initial + '">' +
      '<img src="' + escapeHtml(imageSrc(char.reference_image_path)) + '" ' +
      'alt="' + initial + '" ' +
      'onerror="var p=this.parentNode;p.classList.remove(\'char-avatar-img\');p.innerHTML=p.dataset.initial">' +
      '</div>';
  }
  return '<div class="' + cls + '">' + initial + '</div>';
}

export function traitSelect(id, current, opts) {
  var inner = '<option value=""></option>' +
    opts.map(function(o) {
      return '<option value="' + escapeHtml(o[0]) + '"' + (current === o[0] ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>';
    }).join('');
  return '<select class="form-input trait-select" id="' + escapeHtml(id) + '">' + inner + '</select>';
}
