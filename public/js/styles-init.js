(function () {
  'use strict';

  /* =================================================================
     GLOBAL STYLES MANAGER
     ================================================================= */

  // Safe wrappers — use app.js globals if available, else fallback
  function toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    console.log('[' + (type || 'info') + '] ' + msg);
    if (type === 'error') alert(msg);
  }
  function confirm2(title, msg, onOk) {
    if (typeof window.showConfirm === 'function') { window.showConfirm(title, msg, onOk); return; }
    if (window.confirm(title + '\n' + msg)) onOk();
  }

  var SAMPLER_OPTS = [
    'exp_heun_2_x0','dpmpp_2m','dpmpp_3m_sde','euler','euler_cfg_pp',
    'dpm_adaptive','lcm','deis','ddim','uni_pc'
  ];
  var SCHEDULER_OPTS = [
    'kl_optimal','karras','exponential','sgm_uniform','simple','ddim_uniform','beta'
  ];
  var WORKFLOW_OPTS = [
    ['SDXL+Refiner.json','SDXL + Refiner (default)'],
    ['story-sdxl-create','SDXL Create'],
    ['story-sdxl-img2img','SDXL img2img'],
    ['story-sdxl-inpaint','SDXL Inpaint']
  ];
  var ASPECT_MAP = {
    '2:3':  { width: 832,  height: 1216 },
    '3:2':  { width: 1216, height: 832  },
    '1:1':  { width: 1024, height: 1024 },
    '4:3':  { width: 1152, height: 896  },
    '3:4':  { width: 896,  height: 1152 },
    '16:9': { width: 1344, height: 768  },
    '9:16': { width: 768,  height: 1344 }
  };

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function sel(id, val, opts) {
    return '<select class="form-input" id="' + id + '">' +
      opts.map(function(o) {
        var v = Array.isArray(o) ? o[0] : o;
        var l = Array.isArray(o) ? o[1] : o;
        return '<option value="' + esc(v) + '"' + (val === v ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') + '</select>';
  }

  function btnBusy(btn, busy, label) {
    if (!btn) return;
    btn.disabled = busy;
    if (label) btn.textContent = label;
  }

  // ---------------------------------------------------------------
  // Style form HTML
  // ---------------------------------------------------------------
  function styleFormHtml(style, loraList) {
    var s      = style || {};
    var aspect = '2:3';
    if (s.width && s.height) {
      Object.keys(ASPECT_MAP).forEach(function(k) {
        if (ASPECT_MAP[k].width === s.width && ASPECT_MAP[k].height === s.height) aspect = k;
      });
    }

    function loraOpts(current) {
      var inner = '<option value=""></option>';
      loraList.forEach(function(l) {
        inner += '<option value="' + esc(l) + '"' + (current === l ? ' selected' : '') + '>' + esc(l) + '</option>';
      });
      return inner;
    }

    var isNew = !style;
    return '<div class="style-form">' +
      '<div class="form-group">' +
        '<label class="form-label">Style Name <span class="required">*</span></label>' +
        '<input type="text" class="form-input" id="sf-name" value="' + esc(s.name || '') + '" placeholder="e.g. Cinematic, Anime, Dark Fantasy">' +
      '</div>' +

      '<div class="section-divider"></div>' +
      '<h3 class="section-title" style="margin-bottom:10px">Generation Settings</h3>' +

      '<div class="trait-row">' +
        '<span class="trait-label">Model File</span>' +
        '<input type="text" class="form-input trait-select" id="sf-model" value="' + esc(s.model || 'realcartoonXL_v7.safetensors') + '" placeholder="model.safetensors">' +
      '</div>' +
      '<div class="trait-row"><span class="trait-label">Workflow</span>' + sel('sf-workflow', s.workflow || 'SDXL+Refiner.json', WORKFLOW_OPTS) + '</div>' +
      '<div class="trait-row"><span class="trait-label">Aspect Ratio</span>' + sel('sf-aspect', aspect, Object.keys(ASPECT_MAP)) + '</div>' +
      '<div class="trait-row"><span class="trait-label">Sampler</span>' + sel('sf-sampler', s.sampler || 'exp_heun_2_x0', SAMPLER_OPTS) + '</div>' +
      '<div class="trait-row"><span class="trait-label">Scheduler</span>' + sel('sf-scheduler', s.scheduler || 'kl_optimal', SCHEDULER_OPTS) + '</div>' +
      '<div class="trait-row"><span class="trait-label">CFG</span>' +
        '<input type="number" class="form-input trait-select" id="sf-cfg" value="' + (s.cfg != null ? s.cfg : 7.5) + '" step="0.5" min="1" max="20">' +
      '</div>' +
      '<div class="trait-row"><span class="trait-label">Steps</span>' +
        '<input type="number" class="form-input trait-select" id="sf-steps" value="' + (s.steps || 30) + '" step="1" min="10" max="100">' +
      '</div>' +

      '<div class="section-divider"></div>' +
      '<h3 class="section-title" style="margin-bottom:10px">LoRA Adjustments</h3>' +

      '<div class="trait-row"><span class="trait-label">LoRA 1</span><select class="form-input trait-select" id="sf-lora1">' + loraOpts(s.lora1_file) + '</select></div>' +
      '<div class="trait-row"><span class="trait-label">LoRA 1 Strength</span>' +
        '<input type="number" class="form-input trait-select" id="sf-lora1-strength" value="' + (s.lora1_strength != null ? s.lora1_strength : 0.75) + '" step="0.05" min="0" max="2">' +
      '</div>' +
      '<div class="trait-row"><span class="trait-label">LoRA 2</span><select class="form-input trait-select" id="sf-lora2">' + loraOpts(s.lora2_file) + '</select></div>' +
      '<div class="trait-row"><span class="trait-label">LoRA 2 Strength</span>' +
        '<input type="number" class="form-input trait-select" id="sf-lora2-strength" value="' + (s.lora2_strength != null ? s.lora2_strength : 0.75) + '" step="0.05" min="0" max="2">' +
      '</div>' +
      '<div class="trait-row"><span class="trait-label">LoRA 3</span><select class="form-input trait-select" id="sf-lora3">' + loraOpts(s.lora3_file) + '</select></div>' +
      '<div class="trait-row"><span class="trait-label">LoRA 3 Strength</span>' +
        '<input type="number" class="form-input trait-select" id="sf-lora3-strength" value="' + (s.lora3_strength != null ? s.lora3_strength : 0.75) + '" step="0.05" min="0" max="2">' +
      '</div>' +

      '<div class="section-divider">'+
      '<h3 class="section-title" style="margin-bottom:10px">Prompt Modifiers</h3>' +

      '<div class="form-group">' +
        '<label class="form-label">Prompt Prefix <span class="form-hint">(prepended to every image prompt)</span></label>' +
        '<textarea class="form-input" id="sf-prefix" rows="2" placeholder="e.g. cinematic lighting, film grain, 35mm">' + esc(s.prompt_prefix || '') + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Prompt Suffix <span class="form-hint">(appended to every image prompt)</span></label>' +
        '<textarea class="form-input" id="sf-suffix" rows="2" placeholder="e.g. masterpiece, best quality">' + esc(s.prompt_suffix || '') + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Negative Prompt</label>' +
        '<textarea class="form-input" id="sf-negative" rows="2" placeholder="e.g. blurry, low quality, watermark">' + esc(s.negative_prompt || '') + '</textarea>' +
      '</div>' +

      '<div class="form-actions">' +
        '<button type="button" class="btn btn-primary" id="sf-save">' + (isNew ? 'Create Style' : 'Save Changes') + '</button>' +
        (!isNew ? '<button type="button" class="btn btn-danger" id="sf-delete">Delete Style</button>' : '') +
      '</div>' +
    '</div>';
  }

  // ---------------------------------------------------------------
  // Collect form values
  // ---------------------------------------------------------------
  function collectStyleForm() {
    var aspect = document.getElementById('sf-aspect').value;
    var dims   = ASPECT_MAP[aspect] || { width: 832, height: 1216 };
    return {
      name:            document.getElementById('sf-name').value.trim(),
      model:           document.getElementById('sf-model').value.trim(),
      workflow:        document.getElementById('sf-workflow').value,
      sampler:         document.getElementById('sf-sampler').value,
      scheduler:       document.getElementById('sf-scheduler').value,
      cfg:             parseFloat(document.getElementById('sf-cfg').value) || 7.5,
      steps:           parseInt(document.getElementById('sf-steps').value, 10) || 30,
      width:           dims.width,
      height:          dims.height,
      lora1_file:      document.getElementById('sf-lora1').value || null,
      lora1_strength:  parseFloat(document.getElementById('sf-lora1-strength').value) || 0.75,
      lora2_file:      document.getElementById('sf-lora2').value || null,
      lora2_strength:  parseFloat(document.getElementById('sf-lora2-strength').value) || 0.75,
      lora3_file:      document.getElementById('sf-lora3').value || null,
      lora3_strength:  parseFloat(document.getElementById('sf-lora3-strength').value) || 0.75,
      prompt_prefix:document.getElementById('sf-prefix').value.trim() || null,
      prompt_suffix:   document.getElementById('sf-suffix').value.trim() || null,
      negative_prompt: document.getElementById('sf-negative').value.trim() || null
    };
  }

  // ---------------------------------------------------------------
  // MAIN: initStyles
  // ---------------------------------------------------------------
  window.initStyles = function initStyles() {
    var el = document.getElementById('view-styles');
    el.innerHTML =
      '<div class="page-header">' +
        '<div class="header-left"><a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a></div>' +
        '<h1 class="page-title story-font">Image Styles</h1>' +
        '<div class="header-actions"></div>' +
      '</div>' +
      '<div class="characters-layout">' +
        '<div class="characters-sidebar">' +
          '<div class="char-list-header">' +
            '<h2 class="panel-title">All Styles</h2>' +
            '<button class="btn btn-primary btn-sm" id="btn-new-style">+ New</button>' +
          '</div>' +
          '<div id="style-list" class="char-list"><div class="loading-state small">Loading...</div></div>' +
        '</div>' +
        '<div class="characters-detail" id="style-detail-panel">' +
          '<div class="empty-state"><p class="empty-state-text">Select a style to edit, or create a new one.</p></div>' +
        '</div>' +
      '</div>';

    document.getElementById('btn-new-style').onclick = function () {
      document.querySelectorAll('.style-list-item').forEach(function (i) { i.classList.remove('active'); });
      renderStyleForm(null, window._styleLoRAs || []);
    };

    Promise.all([
      API.listStyles(),
      API.getLoRAs().catch(function () { return { loras: [] }; })
    ]).then(function (results) {
      var styles = results[0].styles || [];
      var loras  = results[1].loras || results[1] || [];
      if (Array.isArray(loras) && loras.length && typeof loras[0] === 'object') {
        loras = loras.map(function (l) { return l.filename || l.name || String(l); });
      }
      window._styleLoRAs = loras;
      renderStyleList(styles);
    }).catch(function (e) {
      toast('Failed to load styles: ' + e.message, 'error');
    });
  };

  // ---------------------------------------------------------------
  // Render style list
  // ---------------------------------------------------------------
  function renderStyleList(styles) {
    var list = document.getElementById('style-list');
    if (!list) return;
    if (!styles.length) {
      list.innerHTML = '<div class="empty-state small">No styles yet. Create one to get started.</div>';
      return;
    }
    list.innerHTML = styles.map(function (s) {
      return '<div class="style-list-item char-list-item" data-id="' + s.id + '">' +
        '<div class="char-avatar" style="background:var(--color-primary);color:#fff;font-size:11px;font-weight:700">ST</div>' +
        '<div class="char-info">' +
          '<span class="char-name">' + esc(s.name) + '</span>' +
          '<span class="char-role" style="font-size:11px;color:var(--text-muted)">' + esc(s.model || '') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.style-list-item').forEach(function (item) {
      item.onclick = function () {
        list.querySelectorAll('.style-list-item').forEach(function (i) { i.classList.remove('active'); });
        item.classList.add('active');
        var sid = Number(item.dataset.id);
        API.listStyles().then(function (data) {
          var s = (data.styles || []).find(function (x) { return x.id === sid; });
          if (s) renderStyleForm(s, window._styleLoRAs || []);
        });
      };
    });
  }

  // ---------------------------------------------------------------
  // Render style editor
  // ---------------------------------------------------------------
  function renderStyleForm(style, loraList) {
    var panel = document.getElementById('style-detail-panel');
    if (!panel) return;
    panel.innerHTML =
      '<div class="char-editor">' +
        '<div class="char-editor-header">' +
          '<h2 class="panel-title">' + (style ? 'Edit Style: ' + esc(style.name) : 'New Style') + '</h2>' +
        '</div>' +
        styleFormHtml(style, loraList) +
      '</div>';

    document.getElementById('sf-save').onclick = function () {
      var data = collectStyleForm();
      if (!data.name) { toast('Style name is required.', 'error'); return; }
      var btn = document.getElementById('sf-save');
      var origLabel = btn.textContent;
      btnBusy(btn, true, 'Saving...');
      var promise = style ? API.updateStyle(style.id, data) : API.createStyle(data);
      promise.then(function (result) {
        toast(style ? 'Style saved!' : 'Style created!', 'success');
        return API.listStyles().then(function (d) {
          renderStyleList(d.styles || []);
          renderStyleForm(result, window._styleLoRAs || []);
          var list = document.getElementById('style-list');
          if (list) {
            var target = list.querySelector('[data-id="' + result.id + '"]');
            if (target) {
              list.querySelectorAll('.style-list-item').forEach(function (i) { i.classList.remove('active'); });
              target.classList.add('active');
            }
          }
          refreshWizardStylePicker();
        });
      }).catch(function (err) {
        toast('Save failed: ' + err.message, 'error');
        var b = document.getElementById('sf-save');
        if (b) btnBusy(b, false, origLabel);
      });
    };

    if (style) {
      var delBtn = document.getElementById('sf-delete');
      if (delBtn) {
        delBtn.onclick = function () {
          confirm2('Delete Style', 'Delete "' + style.name + '"? Scenarios using it will lose their active style.', function () {
            API.deleteStyle(style.id).then(function () {
              toast('Style deleted.', 'success');
              var panel2 = document.getElementById('style-detail-panel');
              if (panel2) panel2.innerHTML = '<div class="empty-state"><p class="empty-state-text">Style deleted.</p></div>';
              return API.listStyles().then(function (d) {
                renderStyleList(d.styles || []);
                refreshWizardStylePicker();
              });
            }).catch(function (err) { toast('Delete failed: ' + err.message, 'error'); });
          });
        };
      }
    }
  }

  /* =================================================================
     SCENARIO WIZARD — Image Style Picker (Step 3)
     ================================================================= */

  var _wizardStylePickerInjected = false;

  function injectWizardStylePicker() {
    var body = document.getElementById('wizard-body');
    if (!body) return;
    if (document.getElementById('wizard-image-style-section')) return;
    var firstSection = body.querySelector('.collapsible-section, .wizard-step-content');
    if (!firstSection) return;

    var pickerHtml =
      '<div id="wizard-image-style-section" style="background:var(--color-surface,#1c1b19);border:1px solid var(--border,#393836);border-radius:8px;padding:16px;margin-bottom:16px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
          '<h3 style="margin:0;font-size:15px;font-weight:600">Image Style</h3>' +
          '<a href="#styles" class="btn btn-ghost btn-sm" target="_self" style="font-size:12px">Manage Styles &rarr;</a>' +
        '</div>' +
        '<p style="font-size:13px;color:var(--text-muted,#797876);margin-bottom:12px">Choose a global image style for this scenario.</p>' +
        '<div class="form-group" style="margin-bottom:8px">' +
          '<label class="form-label">Active Image Style</label>' +
          '<select class="form-input" id="wizard-style-select" style="width:100%"><option value="">Loading styles...</option></select>' +
        '</div>' +
        '<div id="wizard-style-preview" style="font-size:12px;color:var(--text-muted,#797876);min-height:18px"></div>' +
      '</div>';

    var stepContent = body.querySelector('.wizard-step-content');
    if (stepContent) stepContent.insertAdjacentHTML('afterbegin', pickerHtml);
    else body.insertAdjacentHTML('afterbegin', pickerHtml);

    loadWizardStylePicker();
  }

  function loadWizardStylePicker() {
    var selectEl = document.getElementById('wizard-style-select');
    if (!selectEl) return;

    var hash   = location.hash.replace('#', '') || '';
    var params = new URLSearchParams((hash.split('?')[1] || ''));
    var sid    = params.get('id') ? Number(params.get('id')) : null;

    Promise.all([
      API.listStyles(),
      sid ? API.getScenarioActiveStyle(sid).catch(function () { return { active_style_id: null }; })
          : Promise.resolve({ active_style_id: null })
    ]).then(function (results) {
      var styles  = results[0].styles || [];
      var current = results[1] && (results[1].active_style_id || results[1].activeStyleId || null);
      window._wizardStyles = styles;
      window._wizardActiveStyleId = current;

      selectEl.innerHTML =
        '<option value="">— None (use defaults) —</option>' +
        styles.map(function (s) {
          return '<option value="' + s.id + '"' + (s.id === current ? ' selected' : '') + '>' +
            esc(s.name) + (s.model ? '  (' + esc(s.model.replace('.safetensors','')) + ')' : '') +
          '</option>';
        }).join('');

      updateWizardStylePreview(styles, current);

      selectEl.onchange = function () {
        var chosen = selectEl.value ? Number(selectEl.value) : null;
        window._wizardActiveStyleId = chosen;
        updateWizardStylePreview(styles, chosen);
        if (sid) {
          var fn = chosen ? API.setScenarioActiveStyle(sid, chosen) : API.clearScenarioActiveStyle(sid);
          fn.then(function () {
            var matchStyle = styles.find(function (s) { return s.id === chosen; });
            toast(chosen ? 'Image style set: ' + (matchStyle ? matchStyle.name : '') : 'Image style cleared.', 'success');
          }).catch(function (err) { toast('Failed to update style: ' + err.message, 'error'); });
        }
      };
    }).catch(function (err) {
      console.warn('[StylePicker] Failed to load styles:', err.message);
      selectEl.innerHTML = '<option value="">— Could not load styles —</option>';
    });
  }

  function updateWizardStylePreview(styles, activeId) {
    var preview = document.getElementById('wizard-style-preview');
    if (!preview) return;
    var s = styles && styles.find(function (x) { return x.id === activeId; });
    if (!s) { preview.textContent = ''; return; }
    var parts = [];
    if (s.workflow)      parts.push('Workflow: ' + s.workflow);
    if (s.model)         parts.push('Model: ' + s.model.replace('.safetensors',''));
    if (s.sampler)       parts.push('Sampler: ' + s.sampler);
    if (s.cfg)           parts.push('CFG: ' + s.cfg);
    if (s.steps)         parts.push('Steps: ' + s.steps);
    if (s.prompt_prefix) parts.push('Prefix: "' + s.prompt_prefix + '"');
    preview.innerHTML = parts.map(esc).join(' &middot; ');
  }

  function refreshWizardStylePicker() {
    if (document.getElementById('wizard-style-select')) loadWizardStylePicker();
  }

  var _origCreateScenario = API.createScenario;
  var _origUpdateScenario = API.updateScenario;

  API.createScenario = function (data) {
    return _origCreateScenario.call(API, data).then(function (created) {
      var styleId = window._wizardActiveStyleId;
      if (styleId && created && created.id) {
        return API.setScenarioActiveStyle(created.id, styleId).catch(function () {}).then(function () { return created; });
      }
      return created;
    });
  };

  API.updateScenario = function (id, data) {
    return _origUpdateScenario.call(API, id, data).then(function (result) {
      var styleId = window._wizardActiveStyleId;
      if (styleId !== undefined) {
        var fn = styleId ? API.setScenarioActiveStyle(id, styleId) : API.clearScenarioActiveStyle(id);
        return fn.catch(function () {}).then(function () { return result; });
      }
      return result;
    });
  };

  var _observer = null;

  function watchWizardBody() {
    if (_observer) _observer.disconnect();
    _observer = new MutationObserver(function () {
      var view = document.getElementById('view-scenario-setup');
      if (!view || !view.classList.contains('active')) return;
      var step3Active = document.querySelector('.wizard-step[data-step="3"].active');
      if (!step3Active) return;
      setTimeout(function () {
        if (!document.getElementById('wizard-image-style-section')) {
          _wizardStylePickerInjected = false;
          injectWizardStylePicker();
        }
      }, 50);
    });
    var app = document.getElementById('app');
    if (app) _observer.observe(app, { childList: true, subtree: true });
  }

  window.addEventListener('hashchange', function () {
    var hash = location.hash.replace('#', '') || '';
    if (!hash.startsWith('scenario-setup')) {
      window._wizardActiveStyleId = undefined;
      window._wizardStyles = null;
    }
  });

  watchWizardBody();

})();
