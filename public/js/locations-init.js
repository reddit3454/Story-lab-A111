(function () {
  'use strict';

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    if (type === 'error') alert(msg); else console.log('[' + (type || 'info') + '] ' + msg);
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
          if (scenarioId && API.clearScenarioActiveLocation) API.clearScenarioActiveLocation(Number(scenarioId)).catch(function () {});
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
    if (l.time_of_day) parts.push('Time: ' + l.time_of_day);
    if (l.image_tags)  parts.push('Tags: ' + l.image_tags);
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
