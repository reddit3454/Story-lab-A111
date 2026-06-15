(function () {
  'use strict';

  /* =================================================================
     GLOBAL LOCATIONS MANAGER
     Mirrors the Styles pattern exactly.
     Loaded after app.js so window.initLocations shadows any stub.
     ================================================================= */

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Safe wrappers — use app.js globals if available, else fallback
  function toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    if (type === 'error') alert(msg); else console.log('[' + (type || 'info') + '] ' + msg);
  }
  function confirm2(title, msg, onOk) {
    if (typeof window.showConfirm === 'function') { window.showConfirm(title, msg, onOk); return; }
    if (window.confirm(title + '\n' + msg)) onOk();
  }
  function setLoading2(btn, loading, text) {
    if (typeof window.setLoading === 'function') { window.setLoading(btn, loading, text); return; }
    if (btn) { btn.disabled = loading; if (text && loading) btn.textContent = text; }
  }

  // ---------------------------------------------------------------
  // Backgrounds panel (injected async after form render)
  // ---------------------------------------------------------------
  function renderLocationBackgrounds(loc) {
    var panel = document.getElementById('lf-bg-panel');
    if (!panel) return;

    function reload() {
      var listEl = document.getElementById('lf-bg-list');
      if (!listEl) return;
      API.getLocationBackgrounds(loc.id).then(function (rows) {
        if (!rows.length) {
          listEl.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:6px 0">No backgrounds yet. Click "+ Add Image" to add one.</div>';
          return;
        }
        listEl.innerHTML = rows.map(function (row) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">' +
            '<span style="flex:1;font-size:12px;font-family:monospace;word-break:break-all">' + esc(row.filename) + '</span>' +
            (row.is_default
              ? '<span style="font-size:11px;background:var(--color-primary,#6366f1);color:#fff;padding:2px 7px;border-radius:4px;flex-shrink:0">Default</span>'
              : '<button class="btn btn-ghost btn-sm" data-bgid="' + row.id + '" data-action="set-default">Set Default</button>'
            ) +
            '<button class="btn btn-ghost btn-sm" style="color:var(--color-danger,#ef4444);flex-shrink:0" data-bgid="' + row.id + '" data-action="remove" title="Remove">&#x2715;</button>' +
          '</div>';
        }).join('');

        listEl.querySelectorAll('[data-action]').forEach(function (btn) {
          btn.onclick = function () {
            var bgId = Number(btn.dataset.bgid);
            if (btn.dataset.action === 'set-default') {
              API.setDefaultLocationBackground(loc.id, bgId)
                .then(reload)
                .catch(function (err) { toast('Failed: ' + err.message, 'error'); });
            } else if (btn.dataset.action === 'remove') {
              API.deleteLocationBackground(loc.id, bgId)
                .then(function () { toast('Background removed.', 'success'); reload(); })
                .catch(function (err) { toast('Failed: ' + err.message, 'error'); });
            }
          };
        });
      }).catch(function () {
        var el = document.getElementById('lf-bg-list');
        if (el) el.innerHTML = '<div style="font-size:13px;color:var(--color-danger,#ef4444)">Failed to load backgrounds.</div>';
      });
    }

    reload();

    var addBtn     = document.getElementById('lf-add-bg-btn');
    var addRow     = document.getElementById('lf-add-bg-row');
    var addInput   = document.getElementById('lf-add-bg-filename');
    var confirmBtn = document.getElementById('lf-add-bg-confirm');
    var cancelBtn  = document.getElementById('lf-add-bg-cancel');

    if (addBtn) {
      addBtn.onclick = function () {
        if (addRow) { addRow.style.display = 'flex'; }
        addBtn.style.display = 'none';
        if (addInput) { addInput.value = ''; addInput.focus(); }
      };
    }
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        if (addRow) addRow.style.display = 'none';
        if (addBtn) addBtn.style.display = '';
      };
    }
    if (confirmBtn && addInput) {
      confirmBtn.onclick = function () {
        var filename = (addInput.value || '').trim();
        if (!filename) { toast('Enter a filename.', 'error'); return; }
        API.addLocationBackground(loc.id, filename)
          .then(function () {
            toast('Background added.', 'success');
            if (addRow) addRow.style.display = 'none';
            if (addBtn) addBtn.style.display = '';
            reload();
          })
          .catch(function (err) { toast('Failed: ' + err.message, 'error'); });
      };
      addInput.onkeydown = function (e) { if (e.key === 'Enter') confirmBtn.click(); };
    }
  }

  // ---------------------------------------------------------------
  // Location form HTML
  // ---------------------------------------------------------------
  function locationFormHtml(loc) {
    var isNew = !loc;
    var l = loc || {};
    var tod = l.time_of_day || '';
    return '<div class="style-form">' +
      '<div class="form-group">' +
        '<label class="form-label">Location Name <span class="required">*</span></label>' +
        '<input type="text" class="form-input" id="lf-name" value="' + esc(l.name || '') + '" placeholder="e.g. Maya\'s Apartment, Rooftop Bar, City Street">' +
      '</div>' +

      '<div class="form-group">' +
        '<label class="form-label">Short Description <span class="form-hint">(used in image prompts)</span></label>' +
        '<input type="text" class="form-input" id="lf-short_desc" value="' + esc(l.short_desc || '') + '" placeholder="e.g. modern apartment, warm lighting, city view">' +
      '</div>' +

      // Day/Night toggle
      '<div class="form-group" style="border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--bg-inset,rgba(0,0,0,0.1))">' +
        '<label class="form-label" style="margin-bottom:8px">Day / Night Variants</label>' +
        '<div style="display:flex;gap:8px;margin-bottom:12px">' +
          '<button type="button" class="btn btn-sm" id="lf-tab-day" style="flex:1">Day</button>' +
          '<button type="button" class="btn btn-sm" id="lf-tab-night" style="flex:1">Night</button>' +
        '</div>' +
        '<div id="lf-day-panel">' +
          '<div class="form-group">' +
            '<label class="form-label">Narrator Description — Day</label>' +
            '<textarea class="form-input" id="lf-description_day" rows="4" placeholder="Daytime description injected into narrator context.">' + esc(l.description_day || '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Image Tags — Day</label>' +
            '<input type="text" class="form-input" id="lf-image_tags_day" value="' + esc(l.image_tags_day || '') + '" placeholder="e.g. bright sunlight, daytime, warm tones">' +
          '</div>' +
        '</div>' +
        '<div id="lf-night-panel" style="display:none">' +
          '<div class="form-group">' +
            '<label class="form-label">Narrator Description — Night</label>' +
            '<textarea class="form-input" id="lf-description_night" rows="4" placeholder="Nighttime description injected into narrator context.">' + esc(l.description_night || '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Image Tags — Night</label>' +
            '<input type="text" class="form-input" id="lf-image_tags_night" value="' + esc(l.image_tags_night || '') + '" placeholder="e.g. city lights, night scene, neon glow">' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Legacy fallback (collapsed)
      '<details style="margin-top:8px">' +
        '<summary style="font-size:12px;color:var(--text-muted);cursor:pointer;padding:4px 0">Legacy / Fallback fields (used when day/night variants are empty)</summary>' +
        '<div style="margin-top:8px">' +
          '<div class="form-group">' +
            '<label class="form-label">Full Layout / Atmosphere <span class="form-hint">(legacy fallback)</span></label>' +
            '<textarea class="form-input" id="lf-full_desc" rows="4" placeholder="Fallback narrator description.">' + esc(l.full_desc || l.description || '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Image Prompt Tags <span class="form-hint">(legacy fallback)</span></label>' +
            '<input type="text" class="form-input" id="lf-image_tags" value="' + esc(l.image_tags || '') + '" placeholder="e.g. apartment interior, city lights background, night scene">' +
          '</div>' +
        '</div>' +
      '</details>' +

      '<div class="form-group">' +
        '<label class="form-label">Default Time of Day</label>' +
        '<select class="form-input" id="lf-time_of_day">' +
          ['(none)','morning','afternoon','evening','night','late night'].map(function(t) {
            return '<option value="' + esc(t === '(none)' ? '' : t) + '"' + (tod === (t === '(none)' ? '' : t) ? ' selected' : '') + '>' + esc(t) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      '<div class="form-group">' +
        '<label class="form-label">Background Folder <span class="form-hint">(subfolder name inside backgrounds dir)</span></label>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<input type="text" class="form-input" id="lf-background_folder" value="' + esc(l.background_folder || '') + '" placeholder="e.g. Campsite" style="flex:1">' +
          (!isNew ? '<button type="button" class="btn btn-secondary btn-sm" id="lf-scan-btn" style="white-space:nowrap">Scan Folder</button>' : '') +
        '</div>' +
        '<div id="lf-scan-result" style="font-size:12px;margin-top:4px;color:var(--text-muted)"></div>' +
      '</div>' +

      '<div class="form-group">' +
        '<label class="form-label">Tags / Keywords <span class="form-hint">(comma-separated, helps narrator recall)</span></label>' +
        '<input type="text" class="form-input" id="lf-tags" value="' + esc(l.tags || '') + '" placeholder="e.g. indoor, private, familiar, home">' +
      '</div>' +

      // Backgrounds section (edit mode only)
      (!isNew
        ? '<div class="form-group" style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
              '<span class="form-label" style="margin:0;flex:1">Background Images</span>' +
              '<button type="button" class="btn btn-ghost btn-sm" id="lf-add-bg-btn">+ Add Image</button>' +
            '</div>' +
            '<div id="lf-add-bg-row" style="display:none;margin-bottom:10px;gap:8px;align-items:center">' +
              '<input type="text" class="form-input" id="lf-add-bg-filename" placeholder="e.g. ComfyUI_temp_akhfb_00026_.png" style="flex:1;min-width:0">' +
              '<button type="button" class="btn btn-sm btn-primary" id="lf-add-bg-confirm">Add</button>' +
              '<button type="button" class="btn btn-sm btn-ghost" id="lf-add-bg-cancel">Cancel</button>' +
            '</div>' +
            '<div id="lf-bg-panel"><div id="lf-bg-list" style="min-height:32px"><div style="font-size:13px;color:var(--text-muted)">Loading...</div></div></div>' +
          '</div>'
        : ''
      ) +

      '<div class="form-actions">' +
        '<button type="button" class="btn btn-primary" id="lf-save">' + (isNew ? 'Create Location' : 'Save Changes') + '</button>' +
        (!isNew ? '<button type="button" class="btn btn-danger" id="lf-delete">Delete Location</button>' : '') +
      '</div>' +
    '</div>';
  }

  function _wireLocationDayNightTabs() {
    var dayBtn   = document.getElementById('lf-tab-day');
    var nightBtn = document.getElementById('lf-tab-night');
    var dayPanel   = document.getElementById('lf-day-panel');
    var nightPanel = document.getElementById('lf-night-panel');
    if (!dayBtn || !nightBtn) return;

    function setTab(tab) {
      var isDay = tab === 'day';
      dayPanel.style.display   = isDay ? '' : 'none';
      nightPanel.style.display = isDay ? 'none' : '';
      dayBtn.classList.toggle('btn-primary', isDay);
      dayBtn.classList.toggle('btn-ghost', !isDay);
      nightBtn.classList.toggle('btn-primary', !isDay);
      nightBtn.classList.toggle('btn-ghost', isDay);
    }
    setTab('day');
    dayBtn.onclick   = function () { setTab('day'); };
    nightBtn.onclick = function () { setTab('night'); };
  }

  function collectLocationForm() {
    return {
      name:             document.getElementById('lf-name').value.trim(),
      short_desc:       document.getElementById('lf-short_desc').value.trim() || null,
      description:      document.getElementById('lf-full_desc').value.trim() || null,
      image_tags:       document.getElementById('lf-image_tags').value.trim() || null,
      time_of_day:      document.getElementById('lf-time_of_day').value || null,
      background_folder:document.getElementById('lf-background_folder').value.trim() || null,
      tags:             document.getElementById('lf-tags').value.trim() || null,
      image_tags_day:   document.getElementById('lf-image_tags_day').value.trim() || null,
      image_tags_night: document.getElementById('lf-image_tags_night').value.trim() || null,
      description_day:  document.getElementById('lf-description_day').value.trim() || null,
      description_night:document.getElementById('lf-description_night').value.trim() || null,
    };
  }

  // ---------------------------------------------------------------
  // MAIN: initLocations
  // ---------------------------------------------------------------
  window.initLocations = function initLocations() {
    var el = document.getElementById('view-locations');
    if (!el) return;
    el.innerHTML =
      '<div class="page-header">' +
        '<div class="header-left"><a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a></div>' +
        '<h1 class="page-title story-font">Locations</h1>' +
        '<div class="header-actions"></div>' +
      '</div>' +
      '<div class="characters-layout">' +
        '<div class="characters-sidebar">' +
          '<div class="char-list-header">' +
            '<h2 class="panel-title">All Locations</h2>' +
            '<button class="btn btn-primary btn-sm" id="btn-new-location">+ New</button>' +
          '</div>' +
          '<div id="location-list" class="char-list"><div class="loading-state small">Loading...</div></div>' +
        '</div>' +
        '<div class="characters-detail" id="location-detail-panel">' +
          '<div class="empty-state"><p class="empty-state-text">Select a location to edit, or create a new one.</p></div>' +
        '</div>' +
      '</div>';

    document.getElementById('btn-new-location').onclick = function () {
      document.querySelectorAll('.location-list-item').forEach(function (i) { i.classList.remove('active'); });
      renderLocationForm(null);
    };

    API.getLocations().then(function (data) {
      renderLocationList(Array.isArray(data) ? data : []);
    }).catch(function (e) {
      toast('Failed to load locations: ' + e.message, 'error');
    });
  };

  function renderLocationList(locations) {
    var list = document.getElementById('location-list');
    if (!list) return;
    if (!locations.length) {
      list.innerHTML = '<div class="empty-state small">No locations yet.</div>';
      return;
    }
    list.innerHTML = locations.map(function (l) {
      return '<div class="location-list-item char-list-item" data-id="' + l.id + '">' +
        '<div class="char-avatar" style="background:var(--color-warning);color:#fff;font-size:11px;font-weight:700">LC</div>' +
        '<div class="char-info">' +
          '<span class="char-name">' + esc(l.name) + '</span>' +
          '<span class="char-role" style="font-size:11px;color:var(--text-muted)">' + esc(l.short_desc || l.description || '') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.location-list-item').forEach(function (item) {
      item.onclick = function () {
        list.querySelectorAll('.location-list-item').forEach(function (i) { i.classList.remove('active'); });
        item.classList.add('active');
        var lid = Number(item.dataset.id);
        API.getLocations().then(function (data) {
          var locs = Array.isArray(data) ? data : [];
          var l = locs.find(function (x) { return x.id === lid; });
          if (l) renderLocationForm(l);
        });
      };
    });
  }

  function renderLocationForm(loc) {
    var panel = document.getElementById('location-detail-panel');
    if (!panel) return;
    panel.innerHTML =
      '<div class="char-editor">' +
        '<div class="char-editor-header">' +
          '<h2 class="panel-title">' + (loc ? 'Edit: ' + esc(loc.name) : 'New Location') + '</h2>' +
        '</div>' +
        locationFormHtml(loc) +
      '</div>';

    _wireLocationDayNightTabs();
    if (loc) renderLocationBackgrounds(loc);

    var scanBtn = document.getElementById('lf-scan-btn');
    var scanResult = document.getElementById('lf-scan-result');
    if (scanBtn && loc) {
      scanBtn.onclick = function () {
        var folderVal = (document.getElementById('lf-background_folder').value || '').trim();
        if (!folderVal) { if (scanResult) { scanResult.style.color = 'var(--color-danger,#ef4444)'; scanResult.textContent = 'Set a folder name first.'; } return; }
        setLoading2(scanBtn, true, 'Scanning...');
        if (scanResult) { scanResult.style.color = 'var(--text-muted)'; scanResult.textContent = ''; }
        fetch('/api/locations/' + loc.id + '/scan-backgrounds', { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            setLoading2(scanBtn, false, 'Scan Folder');
            if (data.error) {
              if (scanResult) { scanResult.style.color = 'var(--color-danger,#ef4444)'; scanResult.textContent = data.error; }
              return;
            }
            if (scanResult) { scanResult.style.color = 'var(--color-success,#22c55e)'; scanResult.textContent = 'Found ' + data.scanned + ' image' + (data.scanned !== 1 ? 's' : '') + '.'; }
            renderLocationBackgrounds(loc);
          })
          .catch(function (err) {
            setLoading2(scanBtn, false, 'Scan Folder');
            if (scanResult) { scanResult.style.color = 'var(--color-danger,#ef4444)'; scanResult.textContent = 'Error: ' + err.message; }
          });
      };
    }

    document.getElementById('lf-save').onclick = function () {
      var data = collectLocationForm();
      if (!data.name) { toast('Location name is required.', 'error'); return; }
      var btn = document.getElementById('lf-save');
      setLoading2(btn, true, 'Saving...');
      var promise = loc ? API.updateLocation(loc.id, data) : API.createLocation(data);
      promise.then(function (result) {
        toast(loc ? 'Location saved!' : 'Location created!', 'success');
        return API.getLocations().then(function (d) {
          var locs = Array.isArray(d) ? d : [];
          renderLocationList(locs);
          renderLocationForm(result);
          var listEl = document.getElementById('location-list');
          if (listEl) {
            var target = listEl.querySelector('[data-id="' + result.id + '"]');
            if (target) {
              listEl.querySelectorAll('.location-list-item').forEach(function (i) { i.classList.remove('active'); });
              target.classList.add('active');
            }
          }
        });
      }).catch(function (err) {
        toast('Save failed: ' + err.message, 'error');
        var b = document.getElementById('lf-save');
        if (b) setLoading2(b, false);
      });
    };

    if (loc) {
      var delBtn = document.getElementById('lf-delete');
      if (delBtn) {
        delBtn.onclick = function () {
          confirm2('Delete Location', 'Delete "' + loc.name + '"? Scenarios using it will lose their active location.', function () {
            API.deleteLocation(loc.id).then(function () {
              toast('Location deleted.', 'success');
              var panel2 = document.getElementById('location-detail-panel');
              if (panel2) panel2.innerHTML = '<div class="empty-state"><p class="empty-state-text">Deleted. Select or create another.</p></div>';
              return API.getLocations().then(function (d) { renderLocationList(Array.isArray(d) ? d : []); });
            }).catch(function (err) { toast('Delete failed: ' + err.message, 'error'); });
          });
        };
      }
    }
  }

  /* =================================================================
     SCENARIO SETUP — Active Location Picker
     Same MutationObserver pattern as styles-init.js
     ================================================================= */

  function injectLocationPicker(scenarioId) {
    if (document.getElementById('scenario-location-picker-section')) return;
    var anchor = document.getElementById('scenario-style-picker-section') ||
                 document.querySelector('#view-scenario-setup .form-actions');
    if (!anchor) return;

    var pickerHtml =
      '<div id="scenario-location-picker-section" class="form-section" style="border-top:1px solid var(--border);padding-top:16px;margin-top:4px">' +
        '<h3 class="section-title" style="margin-bottom:10px">Default Location</h3>' +
        '<p style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Choose the primary location for this scenario. The narrator will use its full description as context. You can change location mid-story from the play view.</p>' +
        '<div class="form-group">' +
          '<label class="form-label">Active Location</label>' +
          '<select class="form-input" id="scenario-active-location-select">' +
            '<option value="">— None —</option>' +
            '<option value="__other__">&#x270F;&#xFE0F;  Other (type a place...)</option>' +
          '</select>' +
        '</div>' +
        '<div id="scenario-location-other-wrap" style="display:none;margin-top:8px">' +
          '<input type="text" class="form-input" id="scenario-location-other-input" placeholder="e.g. park, coffee shop, rooftop...">' +
        '</div>' +
        '<div id="scenario-location-preview" style="margin-top:8px;font-size:12px;color:var(--text-muted)"></div>' +
      '</div>';

    var styleSection = document.getElementById('scenario-style-picker-section');
    if (styleSection) {
      styleSection.insertAdjacentHTML('afterend', pickerHtml);
    } else {
      anchor.insertAdjacentHTML('beforebegin', pickerHtml);
    }

    Promise.all([
      API.getLocations(),
      scenarioId
        ? (API.getScenarioActiveLocation
            ? API.getScenarioActiveLocation(Number(scenarioId)).catch(function () { return { active_location_id: null }; })
            : Promise.resolve({ active_location_id: null }))
        : Promise.resolve({ active_location_id: null })
    ]).then(function (results) {
      var locations = Array.isArray(results[0]) ? results[0] : [];
      var current   = results[1].active_location_id;
      var sel       = document.getElementById('scenario-active-location-select');
      if (!sel) return;

      var otherOpt = sel.querySelector('[value="__other__"]');
      locations.forEach(function (l) {
        var opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = l.name + (l.short_desc ? '  — ' + l.short_desc : '');
        if (l.id === current) opt.selected = true;
        sel.insertBefore(opt, otherOpt);
      });

      updateLocationPreview(locations, current);

      sel.onchange = function () {
        var val = sel.value;
        var otherWrap = document.getElementById('scenario-location-other-wrap');

        if (val === '__other__') {
          if (otherWrap) otherWrap.style.display = 'block';
          updateLocationPreview(locations, null);
          if (scenarioId && API.clearScenarioActiveLocation) API.clearScenarioActiveLocation(Number(scenarioId)).catch(function(){});
          return;
        }

        if (otherWrap) otherWrap.style.display = 'none';
        var chosen = val ? Number(val) : null;
        updateLocationPreview(locations, chosen);

        if (!scenarioId) {
          window._pendingLocationId = chosen;
          return;
        }

        var fn = (chosen && API.setScenarioActiveLocation)
          ? API.setScenarioActiveLocation(Number(scenarioId), chosen)
          : (API.clearScenarioActiveLocation ? API.clearScenarioActiveLocation(Number(scenarioId)) : Promise.resolve());
        fn.then(function () {
          var matchLoc = locations.find(function (l) { return l.id === chosen; });
          toast(chosen ? 'Location set: ' + (matchLoc ? matchLoc.name : '') : 'Location cleared.', 'success');
        }).catch(function (err) {
          toast('Failed to update location: ' + err.message, 'error');
        });
      };
    }).catch(function (err) {
      console.warn('Location picker failed to load:', err.message);
    });
  }

  function updateLocationPreview(locations, activeId) {
    var preview = document.getElementById('scenario-location-preview');
    if (!preview) return;
    var l = locations.find(function (x) { return x.id === activeId; });
    if (!l) { preview.textContent = ''; return; }
    var parts = [];
    if (l.time_of_day)  parts.push('Time: ' + l.time_of_day);
    if (l.image_tags)   parts.push('Tags: ' + l.image_tags);
    if (l.tags)         parts.push('Keywords: ' + l.tags);
    preview.innerHTML = '<strong>Location Preview:</strong> ' + parts.map(esc).join(' &middot; ');
  }

  // MutationObserver — same pattern as styles-init.js
  var _locObserver = null;
  function watchForScenarioSetup() {
    if (_locObserver) _locObserver.disconnect();
    _locObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          var view = document.getElementById('view-scenario-setup');
          if (view && view.classList.contains('active') && view.contains(node)) {
            setTimeout(function () {
              var hash   = location.hash.replace('#', '') || '';
              var params = new URLSearchParams((hash.split('?')[1] || ''));
              injectLocationPicker(params.get('id'));
            }, 150);
          }
        });
      });
    });
    var app = document.getElementById('app');
    if (app) _locObserver.observe(app, { childList: true, subtree: true });
  }

  window.addEventListener('hashchange', function () {
    var hash = location.hash.replace('#', '') || '';
    if (hash.startsWith('scenario-setup')) {
      setTimeout(function () {
        var params = new URLSearchParams((hash.split('?')[1] || ''));
        injectLocationPicker(params.get('id'));
      }, 250);
    }
  });

  watchForScenarioSetup();

})();
