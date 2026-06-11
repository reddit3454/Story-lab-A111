/**
 * style-picker-patch.js
 * Patches the scenario editor (Step 3) to show a global Image Style dropdown,
 * and fixes the Styles page to work as a global manager (no scenario required).
 *
 * This runs after app.js and overrides the relevant functions.
 */
(function () {
  'use strict';

  // Wait for API and the app to be ready
  function waitFor(check, cb, interval) {
    interval = interval || 100;
    var t = setInterval(function () {
      if (check()) { clearInterval(t); cb(); }
    }, interval);
  }

  waitFor(function () { return typeof window.API !== 'undefined'; }, function () {

    // ─── 1. PATCH: initStyles — global manager, no scenario required ─────────
    var _origInitStyles = window._initStyles; // may not exist
    // We override via the router by patching window directly after app.js sets up router
    // The router calls initStyles(params.get('scenario')) — we intercept at render time
    // by overriding the function reference stored on the module closure.
    // Since app.js uses var (not window), we patch at router level by hooking hashchange.

    // ─── 2. PATCH: Scenario wizard Step 3 — add Image Style section ──────────
    // We monkey-patch by intercepting DOM mutations on view-scenario-setup

    var _styleDropdownInjected = false;

    function injectStyleDropdown() {
      // Find the AI Models collapsible header — insert before it
      var modelsSection = document.getElementById('section-models');
      if (!modelsSection || document.getElementById('section-image-style')) return;

      var styleSection = document.createElement('div');
      styleSection.className = 'collapsible-section';
      styleSection.id = 'section-image-style';
      styleSection.innerHTML =
        '<button class="collapsible-header" type="button" id="section-image-style-toggle">' +
          'Image Style <span class="chevron" id="chevron-image-style">+</span>' +
        '</button>' +
        '<div class="collapsible-body" id="section-image-style-body">' +
          '<div class="form-group">' +
            '<label class="form-label">Active Image Style</label>' +
            '<div style="display:flex;gap:8px;align-items:center">' +
              '<select class="form-select" id="w-image-style" style="flex:1">' +
                '<option value="">-- None (scenario defaults) --</option>' +
              '</select>' +
              '<a href="#styles" class="btn btn-ghost btn-sm">Manage Styles</a>' +
            '</div>' +
            '<p class="form-hint" style="margin-top:6px">Choose a saved image style to apply to this scenario\'s generated images.</p>' +
          '</div>' +
        '</div>';

      modelsSection.parentNode.insertBefore(styleSection, modelsSection);

      // Toggle logic
      document.getElementById('section-image-style-toggle').onclick = function () {
        var body    = document.getElementById('section-image-style-body');
        var chevron = document.getElementById('chevron-image-style');
        var open    = body.style.display !== 'none' && !body.classList.contains('hidden');
        if (open) {
          body.style.display = 'none';
          if (chevron) chevron.textContent = '+';
        } else {
          body.style.display = 'block';
          if (chevron) chevron.textContent = '-';
        }
      };
      // Start collapsed
      document.getElementById('section-image-style-body').style.display = 'none';

      // Load global styles into dropdown
      var sel = document.getElementById('w-image-style');
      API.listStyles().then(function (data) {
        var styles = data.styles || [];
        sel.innerHTML = '<option value="">-- None (scenario defaults) --</option>' +
          styles.map(function (s) {
            return '<option value="' + s.id + '">' + escapeHtmlLocal(s.name) + '</option>';
          }).join('');

        // If editing, restore saved active style
        var scenarioId = _getEditingScenarioId();
        if (scenarioId) {
          API.getScenarioActiveStyle(scenarioId).then(function (d) {
            if (d && d.active_style_id) {
              sel.value = String(d.active_style_id);
            }
          }).catch(function(){});
        }
      }).catch(function () {});
    }

    function escapeHtmlLocal(str) {
      if (!str) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function _getEditingScenarioId() {
      var hash = location.hash.replace('#','');
      var params = new URLSearchParams(hash.split('?')[1] || '');
      return params.get('id') ? Number(params.get('id')) : null;
    }

    // Hook into wizard Next button on Step 3 to save the active style
    function hookWizardNext() {
      var nextBtn = document.getElementById('btn-wizard-next');
      if (!nextBtn || nextBtn._stylePatchHooked) return;
      nextBtn._stylePatchHooked = true;

      var _origOnClick = nextBtn.onclick;
      nextBtn.onclick = function (e) {
        // Check if we're on step 3 (last step = Save/Create button)
        var isLastStep = (nextBtn.textContent || '').trim().indexOf('Save') === 0 ||
                         (nextBtn.textContent || '').trim().indexOf('Create') === 0;

        if (isLastStep) {
          // Capture the selected style before the wizard submits
          var styleSel = document.getElementById('w-image-style');
          if (styleSel) {
            window._pendingStyleId = styleSel.value ? Number(styleSel.value) : null;
          }
        }

        if (_origOnClick) _origOnClick.call(this, e);
      };
    }

    // After a scenario is saved, the hash changes to #play?scenario=X
    // We intercept that to apply the style
    var _lastAppliedScenarioId = null;

    window.addEventListener('hashchange', function () {
      var hash = location.hash.replace('#','');
      var view = hash.split('?')[0];
      var params = new URLSearchParams(hash.split('?')[1] || '');

      if (view === 'play' && window._pendingStyleId !== undefined) {
        var sid = Number(params.get('scenario'));
        if (sid && sid !== _lastAppliedScenarioId) {
          _lastAppliedScenarioId = sid;
          var styleId = window._pendingStyleId;
          window._pendingStyleId = undefined;
          var p = styleId
            ? API.setScenarioActiveStyle(sid, styleId)
            : API.clearScenarioActiveStyle(sid);
          p.catch(function(){});
        }
      }

      // When entering scenario-setup step 3, watch for DOM updates
      if (view === 'scenario-setup') {
        _styleDropdownInjected = false;
        // Poll for step 3 to render
        var attempts = 0;
        var t = setInterval(function () {
          attempts++;
          injectStyleDropdown();
          hookWizardNext();
          if (document.getElementById('section-image-style') || attempts > 40) clearInterval(t);
        }, 150);
      }
    });

    // Also handle direct navigation to scenario-setup
    if (location.hash.indexOf('scenario-setup') !== -1) {
      var attempts = 0;
      var t = setInterval(function () {
        attempts++;
        injectStyleDropdown();
        hookWizardNext();
        if (document.getElementById('section-image-style') || attempts > 40) clearInterval(t);
      }, 150);
    }

    // ─── 3. PATCH: Fix Styles page to be global manager ──────────────────────
    // Intercept navigation to #styles and rebuild the page correctly
    // We do this by watching for view-styles becoming active

    var _stylesObserver = null;

    function watchForStylesView() {
      var stylesEl = document.getElementById('view-styles');
      if (!stylesEl) return;

      if (_stylesObserver) _stylesObserver.disconnect();

      _stylesObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            var isActive = stylesEl.classList.contains('active');
            if (isActive) {
              setTimeout(fixStylesPage, 50);
            }
          }
        });
      });

      _stylesObserver.observe(stylesEl, { attributes: true });
    }

    function fixStylesPage() {
      var el = document.getElementById('view-styles');
      if (!el || !el.classList.contains('active')) return;

      // Check if the page already has the correct global header (no "Back to Story")
      // If it still has the old "select a scenario" empty state, rebuild it
      var hasOldEmptyState = el.innerHTML.indexOf('Select a scenario from the dashboard') !== -1;
      var hasStyleList = !!el.querySelector('#style-list');

      if (hasOldEmptyState || !hasStyleList) {
        renderGlobalStylesPage(el);
      }
    }

    function renderGlobalStylesPage(el) {
      el.innerHTML =
        '<div class="page-header">' +
          '<div class="header-left">' +
            '<a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a>' +
          '</div>' +
          '<h1 class="page-title story-font">Image Styles</h1>' +
          '<div class="header-actions">' +
            '<button class="btn btn-primary btn-sm" id="btn-new-style-global">+ New Style</button>' +
          '</div>' +
        '</div>' +
        '<div class="characters-layout">' +
          '<div class="characters-sidebar">' +
            '<div class="char-list-header">' +
              '<h2 class="panel-title">All Styles</h2>' +
            '</div>' +
            '<div id="style-list" class="char-list">' +
              '<div class="loading-state small">Loading...</div>' +
            '</div>' +
          '</div>' +
          '<div class="characters-detail" id="style-detail-panel">' +
            '<div class="empty-state"><p class="empty-state-text">Select a style to edit, or create a new one.</p></div>' +
          '</div>' +
        '</div>';

      loadGlobalStyles(el);

      document.getElementById('btn-new-style-global').onclick = function () {
        renderGlobalStyleForm(null, el);
      };
    }

    function loadGlobalStyles(el) {
      API.listStyles().then(function (data) {
        var styles = data.styles || [];
        var listEl = document.getElementById('style-list');
        if (!listEl) return;

        if (!styles.length) {
          listEl.innerHTML = '<div class="empty-state small">No styles yet. Create one.</div>';
          return;
        }

        listEl.innerHTML = styles.map(function (s) {
          return '<div class="char-list-item" data-id="' + s.id + '">' +
            '<div class="char-avatar" style="font-size:18px">&#127912;</div>' +
            '<div class="char-info">' +
              '<span class="char-name">' + escapeHtmlLocal(s.name) + '</span>' +
              '<span class="badge badge-muted">' + escapeHtmlLocal(s.model ? s.model.replace('.safetensors','') : '-') + '</span>' +
            '</div>' +
          '</div>';
        }).join('');

        listEl.querySelectorAll('.char-list-item').forEach(function (item) {
          item.onclick = function () {
            var sid = Number(item.dataset.id);
            var style = styles.find(function (s) { return s.id === sid; });
            listEl.querySelectorAll('.char-list-item').forEach(function (i) { i.classList.remove('active'); });
            item.classList.add('active');
            renderGlobalStyleForm(style, el);
          };
        });
      }).catch(function (e) {
        var listEl = document.getElementById('style-list');
        if (listEl) listEl.innerHTML = '<div class="error-state">Failed to load styles.</div>';
      });
    }

    function renderGlobalStyleForm(style, pageEl) {
      var panel = document.getElementById('style-detail-panel');
      if (!panel) return;
      var isNew = !style;
      var s = style || {};

      panel.innerHTML =
        '<div class="char-detail-form" style="padding:16px;overflow-y:auto;max-height:100%">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
            '<h3 style="margin:0">' + (isNew ? 'New Style' : 'Edit Style') + '</h3>' +
            (!isNew ? '<button class="btn btn-danger btn-sm" id="btn-gstyle-delete">Delete</button>' : '') +
          '</div>' +
          '<p class="form-hint" style="margin-bottom:12px">Styles are global. Assign to a scenario in the scenario editor (Step 3).</p>' +
          '<div class="form-group">' +
            '<label class="form-label">Name <span class="required">*</span></label>' +
            '<input class="form-input" id="gst-name" type="text" value="' + escapeHtmlLocal(s.name || '') + '" placeholder="My Style">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Model (.safetensors filename)</label>' +
            '<input class="form-input" id="gst-model" type="text" value="' + escapeHtmlLocal(s.model || 'realcartoonXL_v7.safetensors') + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Workflow</label>' +
            '<select class="form-select" id="gst-workflow">' +
              ['story-sdxl-create','story-sdxl-img2img','story-flux-create','story-flux-img2img'].map(function(w) {
                return '<option value="' + w + '"' + (s.workflow === w ? ' selected' : '') + '>' + w + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Aspect Ratio</label>' +
            '<select class="form-select" id="gst-aspect">' +
              [['2:3','832x1216'],['3:2','1216x832'],['1:1','1024x1024'],['16:9','1344x768'],['9:16','768x1344']].map(function(o) {
                var w = Number(o[1].split('x')[0]);
                var h = Number(o[1].split('x')[1]);
                var sel = (s.width === w && s.height === h) ? ' selected' : '';
                return '<option value="' + o[1] + '"' + sel + '>' + o[0] + ' (' + o[1] + ')</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Sampler</label>' +
            '<input class="form-input" id="gst-sampler" type="text" value="' + escapeHtmlLocal(s.sampler || 'exp_heun_2_x0') + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Scheduler</label>' +
            '<input class="form-input" id="gst-scheduler" type="text" value="' + escapeHtmlLocal(s.scheduler || 'kl_optimal') + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">CFG Scale</label>' +
            '<input class="form-input" id="gst-cfg" type="number" step="0.5" min="1" max="20" value="' + (s.cfg != null ? s.cfg : 7.5) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Steps</label>' +
            '<input class="form-input" id="gst-steps" type="number" min="10" max="100" value="' + (s.steps != null ? s.steps : 30) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">LoRA 1 filename</label>' +
            '<input class="form-input" id="gst-lora1" type="text" value="' + escapeHtmlLocal(s.lora1_file || '') + '" placeholder="filename.safetensors">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">LoRA 1 Strength</label>' +
            '<input class="form-input" id="gst-lora1-str" type="number" step="0.05" min="0" max="2" value="' + (s.lora1_strength != null ? s.lora1_strength : 0.75) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">LoRA 2 filename</label>' +
            '<input class="form-input" id="gst-lora2" type="text" value="' + escapeHtmlLocal(s.lora2_file || '') + '" placeholder="filename.safetensors">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">LoRA 2 Strength</label>' +
            '<input class="form-input" id="gst-lora2-str" type="number" step="0.05" min="0" max="2" value="' + (s.lora2_strength != null ? s.lora2_strength : 0.75) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Prompt Prefix <span class="form-hint">(prepended to every image prompt)</span></label>' +
            '<textarea class="form-input" id="gst-prefix" rows="2" placeholder="e.g. anime style, masterpiece, best quality">' + escapeHtmlLocal(s.prompt_prefix || '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Prompt Suffix <span class="form-hint">(appended to every image prompt)</span></label>' +
            '<textarea class="form-input" id="gst-suffix" rows="2" placeholder="e.g. dramatic lighting, cinematic">' + escapeHtmlLocal(s.prompt_suffix || '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Negative Prompt</label>' +
            '<textarea class="form-input" id="gst-negative" rows="2" placeholder="e.g. blurry, bad anatomy, nsfw">' + escapeHtmlLocal(s.negative_prompt || '') + '</textarea>' +
          '</div>' +
          '<div class="form-actions" style="margin-top:16px">' +
            '<button class="btn btn-primary" id="btn-gstyle-save">' + (isNew ? 'Create Style' : 'Save Changes') + '</button>' +
          '</div>' +
        '</div>';

      // Save handler
      var saveBtn = document.getElementById('btn-gstyle-save');
      if (saveBtn) {
        saveBtn.onclick = function () {
          var nameVal = (document.getElementById('gst-name') || {value:''}).value.trim();
          if (!nameVal) { showToastGlobal('Name is required.', 'error'); return; }
          var aspectVal = (document.getElementById('gst-aspect') || {value:'832x1216'}).value;
          var wh = aspectVal.split('x');
          var data = {
            name:            nameVal,
            model:           (document.getElementById('gst-model')      || {value:''}).value.trim() || null,
            workflow:        (document.getElementById('gst-workflow')    || {value:'story-sdxl-create'}).value,
            sampler:         (document.getElementById('gst-sampler')     || {value:''}).value.trim() || null,
            scheduler:       (document.getElementById('gst-scheduler')   || {value:''}).value.trim() || null,
            cfg:             Number((document.getElementById('gst-cfg')   || {value:'7.5'}).value) || 7.5,
            steps:           Number((document.getElementById('gst-steps') || {value:'30'}).value) || 30,
            width:           Number(wh[0]) || 832,
            height:          Number(wh[1]) || 1216,
            lora1_file:      (document.getElementById('gst-lora1')       || {value:''}).value.trim() || null,
            lora1_strength:  Number((document.getElementById('gst-lora1-str') || {value:'0.75'}).value) || 0.75,
            lora2_file:      (document.getElementById('gst-lora2')       || {value:''}).value.trim() || null,
            lora2_strength:  Number((document.getElementById('gst-lora2-str') || {value:'0.75'}).value) || 0.75,
            prompt_prefix:   (document.getElementById('gst-prefix')      || {value:''}).value.trim() || null,
            prompt_suffix:   (document.getElementById('gst-suffix')      || {value:''}).value.trim() || null,
            negative_prompt: (document.getElementById('gst-negative')    || {value:''}).value.trim() || null,
          };

          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
          var promise = isNew ? API.createStyle(data) : API.updateStyle(s.id, data);
          promise.then(function () {
            showToastGlobal(isNew ? 'Style created!' : 'Style saved!', 'success');
            loadGlobalStyles(pageEl);
            document.querySelectorAll('.char-list-item').forEach(function(i){i.classList.remove('active');});
            panel.innerHTML = '<div class="empty-state"><p class="empty-state-text">Select a style to edit, or create a new one.</p></div>';
          }).catch(function (err) {
            showToastGlobal('Save failed: ' + (err.message || err), 'error');
          }).finally(function () {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isNew ? 'Create Style' : 'Save Changes'; }
          });
        };
      }

      // Delete handler
      var delBtn = document.getElementById('btn-gstyle-delete');
      if (delBtn) {
        delBtn.onclick = function () {
          if (!confirm('Delete style "' + s.name + '"? This cannot be undone.')) return;
          API.deleteStyle(s.id).then(function () {
            showToastGlobal('Style deleted.', 'success');
            loadGlobalStyles(pageEl);
            panel.innerHTML = '<div class="empty-state"><p class="empty-state-text">Select a style to edit, or create a new one.</p></div>';
          }).catch(function (err) {
            showToastGlobal('Delete failed: ' + (err.message || err), 'error');
          });
        };
      }
    }

    function showToastGlobal(msg, type) {
      var c = document.getElementById('toast-container');
      if (!c) return;
      var t = document.createElement('div');
      t.className = 'toast toast-' + (type || 'info');
      t.textContent = msg;
      c.appendChild(t);
      requestAnimationFrame(function(){requestAnimationFrame(function(){t.classList.add('visible');});});
      setTimeout(function(){t.classList.remove('visible');setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},300);},4000);
    }

    // Start watching the styles view
    waitFor(function () { return !!document.getElementById('view-styles'); }, watchForStylesView);

    // Also watch for future DOM changes (view-styles may not be in DOM yet on first load)
    var _rootObserver = new MutationObserver(function () {
      var s = document.getElementById('view-styles');
      if (s && !_stylesObserver) watchForStylesView();
    });
    _rootObserver.observe(document.body, { childList: true, subtree: false });

    // ─── Watch for Step 3 rendering via MutationObserver on wizard-body ──────
    var _wizardObserver = null;

    window.addEventListener('hashchange', function () {
      if (location.hash.indexOf('scenario-setup') !== -1) {
        waitFor(function () { return !!document.getElementById('wizard-body'); }, function () {
          if (_wizardObserver) _wizardObserver.disconnect();
          _wizardObserver = new MutationObserver(function () {
            if (document.getElementById('section-models') && !document.getElementById('section-image-style')) {
              injectStyleDropdown();
              hookWizardNext();
            }
          });
          var wb = document.getElementById('wizard-body');
          if (wb) _wizardObserver.observe(wb, { childList: true, subtree: true });
        }, 200);
      }
    });

    // Handle if already on scenario-setup
    if (location.hash.indexOf('scenario-setup') !== -1) {
      waitFor(function () { return !!document.getElementById('wizard-body'); }, function () {
        if (_wizardObserver) _wizardObserver.disconnect();
        _wizardObserver = new MutationObserver(function () {
          if (document.getElementById('section-models') && !document.getElementById('section-image-style')) {
            injectStyleDropdown();
            hookWizardNext();
          }
        });
        var wb = document.getElementById('wizard-body');
        if (wb) _wizardObserver.observe(wb, { childList: true, subtree: true });
      }, 200);
    }

  }); // end waitFor API

}());
