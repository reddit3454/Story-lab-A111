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

  // ---------------------------------------------------------------
  // Location form HTML
  // ---------------------------------------------------------------
  function locationFormHtml(loc) {
    var isNew = !loc;
    var l = loc || {};
    var tod = l.day_night_mode || 'day';
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
            '<textarea class="form-input" id="lf-full_desc" rows="4" placeholder="Fallback narrator description.">' + esc(l.full_desc || '') + '</textarea>' +
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
            return '<option value="' + esc(t === '(none)' ? '' : t) + '"' + ((l.time_of_day || '') === (t === '(none)' ? '' : t) ? ' selected' : '') + '>' + esc(t) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      '<div class="form-group">' +
        '<label class="form-label">Tags / Keywords <span class="form-hint">(comma-separated, helps narrator recall)</span></label>' +
        '<input type="text" class="form-input" id="lf-tags" value="' + esc(l.tags || '') + '" placeholder="e.g. indoor, private, familiar, home">' +
      '</div>' +

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
      full_desc:        document.getElementById('lf-full_desc').value.trim() || null,
      image_tags:       document.getElementById('lf-image_tags').value.trim() || null,
      time_of_day:      document.getElementById('lf-time_of_day').value || null,
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

    API.listLocations().then(function (data) {
      renderLocationList(data.locations || []);
    }).catch(function (e) {
      showToast('Failed to load locations: ' + e.message, 'error');
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
          '<span class="char-role" style="font-size:11px;color:var(--text-muted)">' + esc(l.short_desc || '') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.location-list-item').forEach(function (item) {
      item.onclick = function () {
        list.querySelectorAll('.location-list-item').forEach(function (i) { i.classList.remove('active'); });
        item.classList.add('active');
        var lid = Number(item.dataset.id);
        API.listLocations().then(function (data) {
          var l = (data.locations || []).find(function (x) { return x.id === lid; });
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

    document.getElementById('lf-save').onclick = function () {
      var data = collectLocationForm();
      if (!data.name) { showToast('Location name is required.', 'error'); return; }
      var btn = document.getElementById('lf-save');
      setLoading(btn, true, 'Saving...');
      var promise = loc ? API.updateLocation(loc.id, data) : API.createLocation(data);
      promise.then(function (result) {
        showToast(loc ? 'Location saved!' : 'Location created!', 'success');
        return API.listLocations().then(function (d) {
          renderLocationList(d.locations || []);
          renderLocationForm(result);
          var list = document.getElementById('location-list');
          if (list) {
            var target = list.querySelector('[data-id="' + result.id + '"]');
            if (target) {
              list.querySelectorAll('.location-list-item').forEach(function (i) { i.classList.remove('active'); });
              target.classList.add('active');
            }
          }
        });
      }).catch(function (err) {
        showToast('Save failed: ' + err.message, 'error');
        var b = document.getElementById('lf-save');
        if (b) setLoading(b, false);
      });
    };

    if (loc) {
      var delBtn = document.getElementById('lf-delete');
      if (delBtn) {
        delBtn.onclick = function () {
          showConfirm('Delete Location', 'Delete "' + loc.name + '"? Scenarios using it will lose their active location.', function () {
            API.deleteLocation(loc.id).then(function () {
              showToast('Location deleted.', 'success');
              var panel2 = document.getElementById('location-detail-panel');
              if (panel2) panel2.innerHTML = '<div class="empty-state"><p class="empty-state-text">Deleted. Select or create another.</p></div>';
              return API.listLocations().then(function (d) { renderLocationList(d.locations || []); });
            }).catch(function (err) { showToast('Delete failed: ' + err.message, 'error'); });
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
    // Insert AFTER the style picker if present, else before form-actions
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
            '<option value="__other__">✏️  Other (type a place...)</option>' +
          '</select>' +
        '</div>' +
        '<div id="scenario-location-other-wrap" style="display:none;margin-top:8px">' +
          '<input type="text" class="form-input" id="scenario-location-other-input" placeholder="e.g. park, coffee shop, rooftop...">' +
        '</div>' +
        '<div id="scenario-location-preview" style="margin-top:8px;font-size:12px;color:var(--text-muted)"></div>' +
      '</div>';

    // Insert before anchor if it's a style section, otherwise use beforebegin on form-actions
    var styleSection = document.getElementById('scenario-style-picker-section');
    if (styleSection) {
      styleSection.insertAdjacentHTML('afterend', pickerHtml);
    } else {
      anchor.insertAdjacentHTML('beforebegin', pickerHtml);
    }

    Promise.all([
      API.listLocations(),
      scenarioId
        ? API.getScenarioActiveLocation(Number(scenarioId)).catch(function () { return { active_location_id: null }; })
        : Promise.resolve({ active_location_id: null })
    ]).then(function (results) {
      var locations = results[0].locations || [];
      var current   = results[1].active_location_id;
      var sel       = document.getElementById('scenario-active-location-select');
      if (!sel) return;

      // Insert location options before the "Other" option
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
          // Clear active location on server
          if (scenarioId) API.clearScenarioActiveLocation(Number(scenarioId)).catch(function(){});
          return;
        }

        if (otherWrap) otherWrap.style.display = 'none';
        var chosen = val ? Number(val) : null;
        updateLocationPreview(locations, chosen);

        if (!scenarioId) {
          window._pendingLocationId = chosen;
          return;
        }

        var fn = chosen
          ? API.setScenarioActiveLocation(Number(scenarioId), chosen)
          : API.clearScenarioActiveLocation(Number(scenarioId));
        fn.then(function () {
          var matchLoc = locations.find(function (l) { return l.id === chosen; });
          showToast(chosen ? 'Location set: ' + (matchLoc ? matchLoc.name : '') : 'Location cleared.', 'success');
        }).catch(function (err) {
          showToast('Failed to update location: ' + err.message, 'error');
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
