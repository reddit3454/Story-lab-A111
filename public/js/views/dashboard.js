import { state } from '../state.js';
import { escapeHtml, relativeTime, imageSrc } from '../utils.js';
import { showToast, showConfirm, setLoading, statusDotsHtml } from '../ui.js';

export function initDashboard() {
  var el = document.getElementById('view-dashboard');
  el.innerHTML =
    '<div class="page-header">' +
      '<div class="header-left">' + statusDotsHtml() + '</div>' +
      '<h1 class="page-title story-font">StoryLab</h1>' +
      '<div class="header-actions">' +
        '<button class="btn btn-ghost btn-sm" id="btn-browse-media">Browse Media</button>' +
        '<a href="#characters" class="btn btn-ghost">Characters</a>' +
        '<a href="#images" class="btn btn-ghost">Images</a>' +
        '<a href="#settings" class="btn btn-ghost">Settings</a>' +
        '<button id="btn-new-scenario" class="btn btn-primary">New Scenario</button>' +
      '</div>'+
    '</div>' +
    '<div id="scenario-grid" class="scenario-grid">' +
      '<div class="loading-state">Loading stories...</div>' +
    '</div>';

  document.getElementById('btn-new-scenario').onclick = function () {
    location.hash = '#scenario-setup';
  };

  document.getElementById('btn-browse-media').onclick = function () {
    window.open('http://localhost:4060/?path=' + encodeURIComponent('H:\\MEDIA\\Story_Lab'), '_blank', 'width=1400,height=900');
  };

  API.getScenarios().then(function (data) {
    renderScenarioGrid(data.scenarios || []);
  }).catch(function (e) {
    showToast('Failed to load scenarios: ' + e.message, 'error');
    document.getElementById('scenario-grid').innerHTML =
      '<div class="error-state">Could not load scenarios. Is Story Lab running?</div>';
  });

}

function renderScenarioGrid(scenarios) {
  var grid = document.getElementById('scenario-grid');
  if (!grid) return;

  if (!scenarios.length) {
    grid.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-state-icon">S</div>' +
        '<p class="empty-state-text">Your stories begin here.</p>' +
        '<button class="btn btn-primary" id="btn-first-scenario">Create First Scenario</button>' +
      '</div>';
    document.getElementById('btn-first-scenario').onclick = function () {
      location.hash = '#scenario-setup';
    };
    return;
  }

  grid.innerHTML = scenarios.map(function (s) {
    var chars = s.characters || [];
    var stripHtml = '';
    if (chars.length) {
      var avatars = chars.map(function (c, i) {
        var z = 'z-index:' + (chars.length - i) + ';';
        if (c.reference_image_path) {
          return '<img class="char-avatar-sm" src="' + imageSrc(c.reference_image_path) + '" ' +
            'alt="' + escapeHtml(c.name) + '" title="' + escapeHtml(c.name) + '" ' +
            'style="' + z + '" loading="lazy">';
        }
        var initials = c.name ? c.name.charAt(0).toUpperCase() : '?';
        return '<div class="char-avatar-sm char-avatar-initials" title="' + escapeHtml(c.name) + '" style="' + z + '">' + initials + '</div>';
      }).join('');
      stripHtml = '<div class="scenario-char-strip">' + avatars + '</div>';
    }
    return '<div class="scenario-card" data-id="' + s.id + '">' +
      '<div class="scenario-card-header">' +
        '<h2 class="scenario-title story-font">' + escapeHtml(s.title) + '</h2>' +
        '<span class="badge ' + (s.ended_at ? 'badge-muted' : 'badge-success') + '">' +
          (s.ended_at ? 'Ended' : 'Active') +
        '</span>' +
      '</div>' +
      '<p class="scenario-setting">' + escapeHtml(s.setting || 'No setting defined.') + '</p>' +
      '<div class="scenario-meta">' +
        '<span class="meta-item">' + (s.character_count || 0) + ' characters</span>' +
        '<span class="meta-sep">&middot;</span>' +
        '<span class="meta-item">Last played ' + relativeTime(s.last_turn_at) + '</span>' +
      '</div>' +
      stripHtml +
      '<div class="scenario-card-actions">' +
        '<button class="btn btn-primary btn-sm play-btn" data-id="' + s.id + '">Continue &rarr;</button>' +
        '<button class="btn btn-secondary btn-sm edit-btn" data-id="' + s.id + '">Edit</button>' +
        '<button class="btn btn-danger-ghost btn-sm del-btn" data-id="' + s.id + '">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');

  grid.querySelectorAll('.play-btn').forEach(function (btn) {
    btn.onclick = function (e) { e.stopPropagation(); location.hash = '#play?scenario=' + btn.dataset.id; };
  });
  grid.querySelectorAll('.edit-btn').forEach(function (btn) {
    btn.onclick = function (e) { e.stopPropagation(); location.hash = '#scenario-setup?id=' + btn.dataset.id; };
  });
  grid.querySelectorAll('.del-btn').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      showConfirm('Delete Scenario', 'This will permanently delete this story and all its turns. Are you sure?', function () {
        API.deleteScenario(btn.dataset.id).then(function () {
          showToast('Scenario deleted.', 'success');
          initDashboard();
        }).catch(function (err) {
          showToast('Delete failed: ' + err.message, 'error');
        });
      });
    };
  });
}

