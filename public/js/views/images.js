/**
 * images.js - Images page (quarantined)
 *
 * Character gallery / multi-slot FaceID UIs are not implemented in this A1111 build.
 * Scene images live in Play. Face refs and fullbody are managed on the Characters page.
 *
 * CF-8: all prior unreachable gallery/slot code after the early return was removed
 * (it called nonexistent API surfaces). Do not reintroduce without real backend routes.
 */

export function initImages() {
  var el = document.getElementById('view-images');
  if (!el) return;

  el.innerHTML =
    '<div class="page-header">' +
      '<div class="header-left"><a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a></div>' +
      '<h1 class="page-title story-font">Images</h1>' +
      '<div class="header-actions"></div>' +
    '</div>' +
    '<div class="empty-state"><div class="empty-state-icon">I</div>' +
    '<p class="empty-state-text">Character gallery is not available in this build.</p>' +
    '<p class="empty-state-text" style="margin-top:8px">Scene images live in Play. Character face refs / fullbody are managed on the Characters page.</p>' +
    '<a href="#dashboard" class="btn btn-primary" style="margin-top:16px">Dashboard</a></div>';
}