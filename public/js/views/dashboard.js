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
        '<button class="btn btn-ghost btn-sm" id="btn-new-location">Location +</button>' +
        '<button class="btn btn-ghost btn-sm" id="btn-browse-media">Browse Media</button>' +
        '<a href="#characters" class="btn btn-ghost">Characters</a>' +
        '<a href="#images" class="btn btn-ghost">Images</a>' +
        '<a href="#settings" class="btn btn-ghost">Settings</a>' +
        '<button id="btn-new-scenario" class="btn btn-primary">New Scenario</button>' +
      '</div>'+
    '</div>' +
    '<div id="scenario-grid" class="scenario-grid">' +
      '<div class="loading-state">Loading stories...</div>' +
    '</div>' +
    '<div id="locations-section" style="margin-top:32px">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
        '<h2 style="margin:0;font-size:16px;font-weight:600;color:var(--text-secondary)">Locations</h2>' +
      '</div>' +
      '<div id="location-cards" class="location-grid"><div class="loading-state">Loading...</div></div>' +
    '</div>';

  document.getElementById('btn-new-scenario').onclick = function () {
    location.hash = '#scenario-setup';
  };

  document.getElementById('btn-browse-media').onclick = function () {
    window.open('http://localhost:4060/?path=' + encodeURIComponent('H:\\MEDIA\\Story_Lab'), '_blank', 'width=1400,height=900');
  };

  document.getElementById('btn-new-location').onclick = function () {
    openLocationModal(null, function () {
      API.listLocations().then(function (d) { renderLocationCards(d.locations || []); });
    });
  };

  API.getScenarios().then(function (data) {
    renderScenarioGrid(data.scenarios || []);
  }).catch(function (e) {
    showToast('Failed to load scenarios: ' + e.message, 'error');
    document.getElementById('scenario-grid').innerHTML =
      '<div class="error-state">Could not load scenarios. Is Story Lab running?</div>';
  });

  API.listLocations().then(function (data) {
    renderLocationCards(data.locations || []);
  }).catch(function (e) {
    showToast('Failed to load locations: ' + e.message, 'error');
    var lc = document.getElementById('location-cards');
    if (lc) lc.innerHTML = '';
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

function renderLocationCards(locations) {
  var container = document.getElementById('location-cards');
  if (!container) return;
  if (!locations.length) {
    container.innerHTML = '<div class="empty-state small"><p class="empty-state-text">No locations yet. Use "Location +" to create one.</p></div>';
    return;
  }
  container.innerHTML = locations.map(function (loc) {
    var tagsHtml = '';
    if (loc.tags) {
      var tagList = loc.tags.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      tagsHtml = tagList.map(function (t) {
        return '<span class="location-tag">' + escapeHtml(t) + '</span>';
      }).join('');
    }
    return '<div class="location-card" data-id="' + loc.id + '">' +
      '<div class="location-card-body">' +
        '<div class="location-card-title">' + escapeHtml(loc.name) + '</div>' +
        (loc.short_desc ? '<div class="location-card-desc">' + escapeHtml(loc.short_desc) + '</div>' : '') +
        (tagsHtml ? '<div class="location-card-tags">' + tagsHtml + '</div>' : '') +
      '</div>' +
      '<div class="location-card-actions">' +
        '<button class="btn btn-ghost btn-xs location-edit-btn" data-id="' + loc.id + '">Edit</button>' +
        '<button class="btn btn-danger btn-xs location-delete-btn" data-id="' + loc.id + '">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');

  container.querySelectorAll('.location-edit-btn').forEach(function (btn) {
    btn.onclick = function () {
      var id = Number(btn.dataset.id);
      var loc = locations.find(function (l) { return l.id === id; });
      if (!loc) return;
      openLocationModal(loc, function () {
        API.listLocations().then(function (d) { renderLocationCards(d.locations || []); });
      });
    };
  });

  container.querySelectorAll('.location-delete-btn').forEach(function (btn) {
    btn.onclick = function () {
      var id = Number(btn.dataset.id);
      var loc = locations.find(function (l) { return l.id === id; });
      if (!confirm('Delete location "' + escapeHtml(loc ? loc.name : '') + '"?')) return;
      API.deleteLocation(id)
        .then(function () {
          showToast('Location deleted.', 'success');
          API.listLocations().then(function (d) { renderLocationCards(d.locations || []); });
        })
        .catch(function (e) { showToast('Delete failed: ' + e.message, 'error'); });
    };
  });
}

function openLocationModal(loc, onSaved) {
  var overlay = document.getElementById('modal-overlay');
  var isNew = !loc;
  var l = loc || {};
  overlay.innerHTML =
    '<div class="modal modal-wide">' +
      '<h3 class="modal-title">' + (isNew ? 'New Location' : 'Edit Location') + '</h3>' +
      '<div class="form-group">' +
        '<label class="form-label">Name</label>' +
        '<input class="form-input" id="loc-name" type="text" value="' + escapeHtml(l.name || '') + '" placeholder="The Dark Forest">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Short Description</label>' +
        '<input class="form-input" id="loc-short-desc" type="text" value="' + escapeHtml(l.short_desc || '') + '" placeholder="One-line summary">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Full Description</label>' +
        '<textarea class="form-input" id="loc-full-desc" rows="4" placeholder="Layout, atmosphere, details...">' + escapeHtml(l.full_desc || '') + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Image Tags (injected into scene image prompts)</label>' +
        '<input class="form-input" id="loc-image-tags" type="text" value="' + escapeHtml(l.image_tags || '') + '" placeholder="stone castle interior, candlelit, cold stone walls">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Time of Day</label>' +
        '<input class="form-input" id="loc-time-of-day" type="text" value="' + escapeHtml(l.time_of_day || '') + '" placeholder="Night">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Tags</label>' +
        '<input class="form-input" id="loc-tags" type="text" value="' + escapeHtml(l.tags || '') + '" placeholder="indoor, dungeon, medieval">' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-primary" id="loc-save-btn">' + (isNew ? 'Save' : 'Save Changes') + '</button>' +
        '<button class="btn btn-ghost" id="loc-cancel-btn">Cancel</button>' +
      '</div>' +
    '</div>';

  overlay.classList.remove('hidden');

  overlay.onclick = function (e) {
    if (e.target === overlay) overlay.classList.add('hidden');
  };

  document.getElementById('loc-cancel-btn').onclick = function () {
    overlay.classList.add('hidden');
  };

  document.getElementById('loc-save-btn').onclick = function () {
    var name = (document.getElementById('loc-name').value || '').trim();
    if (!name) { showToast('Name is required.', 'error'); return; }
    var data = {
      name:        name,
      short_desc:  (document.getElementById('loc-short-desc').value || '').trim() || null,
      full_desc:   (document.getElementById('loc-full-desc').value || '').trim() || null,
      image_tags:  (document.getElementById('loc-image-tags').value || '').trim() || null,
      time_of_day: (document.getElementById('loc-time-of-day').value || '').trim() || null,
      tags:        (document.getElementById('loc-tags').value || '').trim() || null
    };
    var saveBtn = document.getElementById('loc-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    var promise = isNew ? API.createLocation(data) : API.updateLocation(l.id, data);
    promise
      .then(function () {
        overlay.classList.add('hidden');
        showToast(isNew ? 'Location created.' : 'Location updated.', 'success');
        if (onSaved) onSaved();
      })
      .catch(function (e) {
        showToast('Save failed: ' + e.message, 'error');
        var b = document.getElementById('loc-save-btn');
        if (b) { b.disabled = false; b.textContent = isNew ? 'Save' : 'Save Changes'; }
      });
  };
}
