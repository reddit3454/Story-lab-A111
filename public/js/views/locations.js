import { escapeHtml } from '../utils.js';
import { showToast, showConfirm, setLoading } from '../ui.js';

var _s = {
  locations: [],
  selected: null,
  scenarioId: null,
  scenarioLocationIds: new Set(),
};

export function initLocations(scenarioId) {
  _s.locations = [];
  _s.selected = null;
  _s.scenarioId = scenarioId ? Number(scenarioId) : null;
  _s.scenarioLocationIds = new Set();

  var el = document.getElementById('view-locations');
  if (!el) return;

  el.innerHTML =
    '<div class="page-header">' +
      '<div class="header-left">' +
        '<a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a>' +
      '</div>' +
      '<h1 class="page-title story-font">Locations</h1>' +
      '<div class="header-actions"></div>' +
    '</div>' +
    '<div class="characters-layout">' +
      '<div class="characters-sidebar">' +
        '<div class="char-list-header">' +
          '<h2 class="panel-title">All Locations</h2>' +
          '<button class="btn btn-primary btn-sm" id="btn-new-loc">+ New</button>' +
        '</div>' +
        '<div id="loc-list" class="char-list"><div class="loading-state small">Loading...</div></div>' +
      '</div>' +
      '<div class="characters-detail" id="loc-detail">' +
        '<div class="empty-state"><p class="empty-state-text">Select a location to edit</p></div>' +
      '</div>' +
    '</div>';

  document.getElementById('btn-new-loc').onclick = function () {
    _s.selected = null;
    document.querySelectorAll('.loc-list-item').forEach(function (i) { i.classList.remove('active'); });
    renderDetail(null);
  };

  var loads = [API.getLocations()];
  if (_s.scenarioId && typeof API.getScenarioLocations === 'function') {
    loads.push(API.getScenarioLocations(_s.scenarioId).catch(function () { return []; }));
  }

  Promise.all(loads).then(function (results) {
    _s.locations = Array.isArray(results[0]) ? results[0] : [];
    if (_s.scenarioId && results[1]) {
      var sLocs = Array.isArray(results[1]) ? results[1] : [];
      _s.scenarioLocationIds = new Set(sLocs.map(function (l) {
        return typeof l === 'object' ? l.id : Number(l);
      }));
    }
    renderList();
  }).catch(function (err) {
    showToast('Failed to load locations: ' + err.message, 'error');
    var list = document.getElementById('loc-list');
    if (list) list.innerHTML = '<div class="empty-state small">Load failed.</div>';
  });
}

function renderList() {
  var list = document.getElementById('loc-list');
  if (!list) return;
  if (!_s.locations.length) {
    list.innerHTML = '<div class="empty-state small">No locations yet.</div>';
    return;
  }
  list.innerHTML = _s.locations.map(function (l) {
    var active = _s.selected && _s.selected.id === l.id ? ' active' : '';
    var inScenario = _s.scenarioId && _s.scenarioLocationIds.has(l.id);
    var badge = inScenario
      ? '<span style="font-size:10px;background:var(--color-primary,#6366f1);color:#fff;padding:1px 5px;border-radius:3px;flex-shrink:0">&#x2714;</span>'
      : '';
    return '<div class="loc-list-item char-list-item' + active + '" data-id="' + l.id + '">' +
      '<div class="char-avatar" style="background:var(--color-warning,#f59e0b);color:#fff;font-size:11px;font-weight:700">LC</div>' +
      '<div class="char-info" style="min-width:0">' +
        '<span class="char-name">' + escapeHtml(l.name) + '</span>' +
        (l.time_of_day
          ? '<span class="char-role" style="font-size:11px;color:var(--text-muted)">' + escapeHtml(l.time_of_day) + '</span>'
          : '') +
      '</div>' +
      badge +
    '</div>';
  }).join('');

  list.querySelectorAll('.loc-list-item').forEach(function (item) {
    item.onclick = function () {
      list.querySelectorAll('.loc-list-item').forEach(function (i) { i.classList.remove('active'); });
      item.classList.add('active');
      var lid = Number(item.dataset.id);
      var loc = _s.locations.find(function (l) { return l.id === lid; });
      if (loc) { _s.selected = loc; renderDetail(loc); }
    };
  });
}

function renderDetail(loc) {
  var panel = document.getElementById('loc-detail');
  if (!panel) return;

  if (!loc) {
    panel.innerHTML =
      '<div class="char-editor">' +
        '<div class="char-editor-header">' +
          '<h2 class="panel-title">New Location</h2>' +
        '</div>' +
        _formHtml(null) +
      '</div>';
    _wireForm(null);
    return;
  }

  panel.innerHTML =
    '<div class="char-editor">' +
      '<div class="char-editor-header">' +
        '<h2 class="panel-title">Edit: ' + escapeHtml(loc.name) + '</h2>' +
      '</div>' +
      _formHtml(loc) +
      '<div id="loc-bg-section"></div>' +
      '<div id="loc-scenario-section"></div>' +
    '</div>';

  _wireForm(loc);
  if (loc.background_folder) _loadBackgrounds(loc);
  if (_s.scenarioId) _renderScenarioSection(loc);
}

function _formHtml(loc) {
  var l = loc || {};
  var tod = l.time_of_day || '';
  var TOD_OPTS   = ['', 'morning', 'afternoon', 'evening', 'night'];
  var TOD_LABELS = ['Any time', 'Morning', 'Afternoon', 'Evening', 'Night'];

  return '<div class="style-form">' +
    '<div class="form-group">' +
      '<label class="form-label">Name <span style="color:var(--color-danger,#ef4444)">*</span></label>' +
      '<input type="text" class="form-input" id="lf-name" value="' + escapeHtml(l.name || '') + '" placeholder="e.g. Maya\'s Apartment, Rooftop Bar">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Visual description</label>' +
      '<textarea class="form-input" id="lf-description" rows="3" placeholder="What it looks like for the narrator and images.">' +
        escapeHtml(l.description || l.short_desc || '') +
      '</textarea>' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Background info</label>' +
      '<textarea class="form-input" id="lf-full_desc" rows="3" placeholder="e.g. the local park in the center of town, open 24 hours">' +
        escapeHtml(l.full_desc || '') +
      '</textarea>' +
      '<div class="form-hint" style="font-size:11px;color:var(--text-muted);margin-top:4px">Story context for the narrator (not required for image tags).</div>' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Location tags (for AI images)</label>' +
      '<textarea class="form-input" id="lf-image_tags" rows="2" placeholder="e.g. apartment interior, city lights, warm lighting">' +
        escapeHtml(l.image_tags || '') +
      '</textarea>' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Time of Day</label>' +
      '<select class="form-input" id="lf-time_of_day">' +
        TOD_OPTS.map(function (v, i) {
          return '<option value="' + escapeHtml(v) + '"' + (tod === v ? ' selected' : '') + '>' + TOD_LABELS[i] + '</option>';
        }).join('') +
      '</select>' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Background folder name <span class="form-hint">(subfolder of backgrounds/)</span></label>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        '<input type="text" class="form-input" id="lf-background_folder" value="' + escapeHtml(l.background_folder || '') + '" placeholder="e.g. Campsite" style="flex:1">' +
        (loc ? '<button type="button" class="btn btn-secondary btn-sm" id="lf-scan-btn">Scan Folder</button>' : '') +
      '</div>' +
      '<div id="lf-scan-result" style="font-size:12px;margin-top:4px;color:var(--text-muted)"></div>' +
    '</div>' +
    '<div class="form-actions" style="margin-top:16px">' +
      '<button type="button" class="btn btn-primary" id="lf-save">' + (loc ? 'Save Changes' : 'Create Location') + '</button>' +
      (loc ? '<button type="button" class="btn btn-danger" id="lf-delete">Delete</button>' : '') +
    '</div>' +
  '</div>';
}

function _wireForm(loc) {
  var saveBtn = document.getElementById('lf-save');
  if (!saveBtn) return;

  saveBtn.onclick = function () {
    var data = {
      name:              (document.getElementById('lf-name').value || '').trim(),
      description:       (document.getElementById('lf-description').value || '').trim() || null,
      full_desc:         (document.getElementById('lf-full_desc').value || '').trim() || null,
      image_tags:        (document.getElementById('lf-image_tags').value || '').trim() || null,
      time_of_day:       document.getElementById('lf-time_of_day').value || null,
      background_folder: (document.getElementById('lf-background_folder').value || '').trim() || null,
    };
    if (!data.name) { showToast('Name is required.', 'error'); return; }
    setLoading(saveBtn, true, 'Saving...');
    var p = loc ? API.updateLocation(loc.id, data) : API.createLocation(data);
    p.then(function (result) {
      showToast(loc ? 'Saved!' : 'Location created!', 'success');
      return API.getLocations().then(function (d) {
        _s.locations = Array.isArray(d) ? d : [];
        var fresh = result || loc;
        var idx = _s.locations.findIndex(function (l) { return l.id === fresh.id; });
        if (idx >= 0) _s.locations[idx] = fresh;
        _s.selected = fresh;
        renderList();
        renderDetail(fresh);
        var listEl = document.getElementById('loc-list');
        if (listEl) {
          var target = listEl.querySelector('.loc-list-item[data-id="' + fresh.id + '"]');
          if (target) {
            listEl.querySelectorAll('.loc-list-item').forEach(function (i) { i.classList.remove('active'); });
            target.classList.add('active');
          }
        }
      });
    }).catch(function (err) {
      showToast('Save failed: ' + err.message, 'error');
      setLoading(saveBtn, false);
    });
  };

  if (loc) {
    var delBtn = document.getElementById('lf-delete');
    if (delBtn) {
      delBtn.onclick = function () {
        showConfirm('Delete Location', 'Delete "' + loc.name + '"?', function () {
          API.deleteLocation(loc.id).then(function () {
            showToast('Location deleted.', 'success');
            _s.locations = _s.locations.filter(function (l) { return l.id !== loc.id; });
            _s.selected = null;
            renderList();
            var panel = document.getElementById('loc-detail');
            if (panel) panel.innerHTML = '<div class="empty-state"><p class="empty-state-text">Location deleted.</p></div>';
          }).catch(function (err) { showToast('Delete failed: ' + err.message, 'error'); });
        });
      };
    }

    var scanBtn    = document.getElementById('lf-scan-btn');
    var scanResult = document.getElementById('lf-scan-result');
    if (scanBtn) {
      scanBtn.onclick = function () {
        var folder = (document.getElementById('lf-background_folder').value || '').trim();
        if (!folder) {
          if (scanResult) { scanResult.style.color = 'var(--color-danger,#ef4444)'; scanResult.textContent = 'Set a folder name first.'; }
          return;
        }
        setLoading(scanBtn, true, 'Scanning...');
        if (scanResult) { scanResult.style.color = 'var(--text-muted)'; scanResult.textContent = ''; }
        fetch('/api/locations/' + loc.id + '/scan-backgrounds', { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            setLoading(scanBtn, false, 'Scan Folder');
            if (data.error) {
              if (scanResult) { scanResult.style.color = 'var(--color-danger,#ef4444)'; scanResult.textContent = data.error; }
              return;
            }
            if (scanResult) {
              scanResult.style.color = 'var(--color-success,#22c55e)';
              scanResult.textContent = 'Found ' + data.scanned + ' image' + (data.scanned !== 1 ? 's' : '') + '.';
            }
            _renderBackgroundGrid(loc, Array.isArray(data.backgrounds) ? data.backgrounds : []);
          })
          .catch(function (err) {
            setLoading(scanBtn, false, 'Scan Folder');
            if (scanResult) { scanResult.style.color = 'var(--color-danger,#ef4444)'; scanResult.textContent = 'Error: ' + err.message; }
          });
      };
    }
  }
}

function _loadBackgrounds(loc) {
  var section = document.getElementById('loc-bg-section');
  if (!section) return;
  section.innerHTML =
    '<div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px">' +
      '<div style="font-size:13px;color:var(--text-muted)">Loading backgrounds...</div>' +
    '</div>';
  API.getLocationBackgrounds(loc.id).then(function (rows) {
    _renderBackgroundGrid(loc, Array.isArray(rows) ? rows : []);
  }).catch(function () {
    var s = document.getElementById('loc-bg-section');
    if (s) s.innerHTML = '';
  });
}

function _renderBackgroundGrid(loc, rows) {
  var section = document.getElementById('loc-bg-section');
  if (!section) return;
  var folder = loc.background_folder || '';

  if (!rows.length) {
    section.innerHTML =
      '<div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px">' +
        '<div class="form-label" style="margin-bottom:6px">Backgrounds</div>' +
        '<div style="font-size:13px;color:var(--text-muted)">No backgrounds found. Use "Scan Folder" above to import images.</div>' +
      '</div>';
    return;
  }

  section.innerHTML =
    '<div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px">' +
      '<div class="form-label" style="margin-bottom:10px">Backgrounds (' + rows.length + ')</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">' +
        rows.map(function (row) {
          var thumb = '/story-backgrounds/' + encodeURIComponent(folder) + '/' + encodeURIComponent(row.filename);
          var isDefault = row.is_default;
          return '<div class="loc-bg-card" style="position:relative;border-radius:6px;overflow:hidden;' +
              'border:2px solid ' + (isDefault ? 'var(--color-primary,#6366f1)' : 'var(--border)') + '">' +
            '<img src="' + thumb + '" alt="" loading="lazy" ' +
              'style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block" ' +
              'onerror="this.style.display=\'none\'">' +
            '<div style="padding:4px 6px;font-size:10px;color:var(--text-muted);word-break:break-all;line-height:1.3">' +
              escapeHtml(row.filename) +
            '</div>' +
            (isDefault
              ? '<div style="position:absolute;top:4px;right:4px;background:var(--color-primary,#6366f1);' +
                  'color:#fff;font-size:10px;padding:2px 6px;border-radius:3px;font-weight:600">Default</div>'
              : '<button class="loc-bg-set-default btn btn-ghost btn-sm" data-bgid="' + row.id + '" ' +
                  'style="position:absolute;top:4px;right:4px;font-size:10px;padding:2px 6px;' +
                  'background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:3px;cursor:pointer">' +
                  'Set Default' +
                '</button>'
            ) +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';

  section.querySelectorAll('.loc-bg-set-default').forEach(function (btn) {
    btn.onclick = function () {
      var bgId = Number(btn.dataset.bgid);
      setLoading(btn, true);
      API.setDefaultLocationBackground(loc.id, bgId).then(function () {
        showToast('Default set.', 'success');
        var updated = rows.map(function (r) {
          return Object.assign({}, r, { is_default: r.id === bgId ? 1 : 0 });
        });
        _renderBackgroundGrid(loc, updated);
      }).catch(function (err) {
        showToast('Failed: ' + err.message, 'error');
        setLoading(btn, false);
      });
    };
  });
}

function _renderScenarioSection(loc) {
  var section = document.getElementById('loc-scenario-section');
  if (!section || !_s.scenarioId) return;
  var inScenario = _s.scenarioLocationIds.has(loc.id);

  section.innerHTML =
    '<div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px">' +
      '<div class="form-label" style="margin-bottom:8px">Scenario Assignment</div>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        (inScenario
          ? '<span style="font-size:13px;color:var(--color-success,#22c55e)">&#x2714; Assigned to current scenario</span>' +
            '<button class="btn btn-ghost btn-sm" id="loc-remove-btn">Remove</button>'
          : '<span style="font-size:13px;color:var(--text-muted)">Not in current scenario</span>' +
            '<button class="btn btn-secondary btn-sm" id="loc-add-btn">Add to Scenario</button>'
        ) +
      '</div>' +
    '</div>';

  if (inScenario) {
    var removeBtn = document.getElementById('loc-remove-btn');
    if (removeBtn) {
      removeBtn.onclick = function () {
        setLoading(removeBtn, true, 'Removing...');
        API.removeLocationFromScenario(_s.scenarioId, loc.id).then(function () {
          _s.scenarioLocationIds.delete(loc.id);
          showToast('Removed from scenario.', 'success');
          renderList();
          _renderScenarioSection(loc);
        }).catch(function (err) {
          showToast('Failed: ' + err.message, 'error');
          setLoading(removeBtn, false);
        });
      };
    }
  } else {
    var addBtn = document.getElementById('loc-add-btn');
    if (addBtn) {
      addBtn.onclick = function () {
        setLoading(addBtn, true, 'Adding...');
        API.addLocationToScenario(_s.scenarioId, loc.id).then(function () {
          _s.scenarioLocationIds.add(loc.id);
          showToast('Added to scenario.', 'success');
          renderList();
          _renderScenarioSection(loc);
        }).catch(function (err) {
          showToast('Failed: ' + err.message, 'error');
          setLoading(addBtn, false);
        });
      };
    }
  }
}
