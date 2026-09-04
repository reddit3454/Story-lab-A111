import { escapeHtml } from './utils.js';

export function getPosePreviewOption(poses, id) {
  return Array.isArray(poses) ? poses.find(function (pose) { return pose.id === id; }) || null : null;
}

export function renderPosePickerHtml(poses, selectedId, subjectCount) {
  const want = Number(subjectCount) || null;
  const groups = new Map();
  (Array.isArray(poses) ? poses : []).forEach(function (pose) {
    const category = pose.category || 'other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(pose);
  });
  const groupsHtml = Array.from(groups.entries()).map(function ([category, group]) {
    return '<section class="pose-picker-group"><h3>' + escapeHtml(category) + '</h3><div class="pose-preview-grid" role="list">' +
      group.map(function (pose) {
        const selected = pose.id === selectedId;
        const subjects = Number(pose.subjects) || 1;
        const mismatch = want != null && subjects !== want;
        const orientation = pose.orientation && pose.orientation !== 'unspecified' ? ' · ' + pose.orientation : '';
        const people = ' · ' + subjects + (subjects === 1 ? ' person' : ' people');
        return '<button type="button" class="pose-preview-card' + (selected ? ' is-selected' : '') + (mismatch ? ' is-mismatch' : '') + '"' +
          ' role="listitem" data-pose-preview-id="' + escapeHtml(pose.id) + '" aria-pressed="' + String(selected) + '"' +
          (mismatch ? ' disabled title="This pose is drawn for ' + subjects + ' — the current image has ' + want + '."' : '') + '>' +
          '<img class="pose-preview-image" src="' + escapeHtml(pose.preview_url) + '" alt="" loading="lazy">' +
          '<span class="pose-preview-label">' + escapeHtml(pose.label + orientation + people) + '</span>' +
        '</button>';
      }).join('') +
    '</div></section>';
  }).join('');

  return '<div class="pose-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="pose-picker-title">' +
    '<div class="pose-picker-header">' +
      '<div><h2 id="pose-picker-title">Choose a pose</h2><p>Guides body position for this image only' +
        (want != null ? '. Poses greyed out are drawn for a different number of people.' : '.') + '</p></div>' +
      '<button type="button" class="pose-picker-close" data-pose-picker-close aria-label="Close pose picker">&times;</button>' +
    '</div>' +
    '<div class="pose-preview-grid" role="list" style="margin-top:14px">' +
      '<button type="button" class="pose-preview-card pose-preview-card-none' + (selectedId ? '' : ' is-selected') + '" role="listitem" data-pose-preview-id="" aria-pressed="' + String(!selectedId) + '">' +
        '<span class="pose-preview-label">No pose — let the prompt decide</span>' +
      '</button>' +
    '</div>' +
    (groupsHtml || '<p class="text-muted">No prepared poses are available.</p>') +
  '</div>';
}
