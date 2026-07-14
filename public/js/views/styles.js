import { state } from '../state.js';
import { escapeHtml, imageSrc } from '../utils.js';
import { showToast, setLoading } from '../ui.js';
import { IMAGE_MODELS } from '../constants.js';

function buildImageModelOptions(selectedModel) {
  return IMAGE_MODELS.map(function (m) {
    return '<option value="' + escapeHtml(m.value) + '"' + (m.value === (selectedModel || '') ? ' selected' : '') + '>' + escapeHtml(m.label) + '</option>';
  }).join('');
}

const SUPPORTED_SAMPLERS = [
  'euler', 'euler_ancestral', 'heun', 'heunpp2', 'dpm_2', 'dpm_2_ancestral',
  'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde',
  'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu',
  'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddpm', 'lcm', 'ipndm', 'ipndm_v',
  'deis', 'ddim', 'uni_pc', 'uni_pc_bh2', 'exp_heun_2_x0', 'ssa',
  'res_multistep', 'res_multistep_ancestral'
];
const SUPPORTED_SCHEDULERS = [
  'normal', 'karras', 'exponential', 'sgm_uniform', 'simple',
  'ddim_uniform', 'beta', 'linear_quadratic', 'kl_optimal'
];

export function initStyles(scenarioIdStr) {
  var scenarioId = Number(scenarioIdStr);
  var el = document.getElementById('view-styles');
  var loraList = [];
  // Styles CRUD backend is not implemented (use Settings > Image Profiles instead)
  el.innerHTML = '<div class="page-header"><h1 class="page-title story-font">Image Styles</h1>' +
    '<div class="header-actions"><a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a></div></div>' +
    '<div class="empty-state"><div class="empty-state-icon">S</div>' +
    '<p class="empty-state-text">The Styles library backend is not available in this build.</p>' +
    '<p class="empty-state-text" style="margin-top:8px">Use <strong>Settings &rarr; Image Profiles</strong> for prompt prefixes, suffixes, and LoRAs.</p>' +
    '<div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
    '<a href="#settings" class="btn btn-primary">Open Settings</a>' +
    (scenarioId ? '<a href="#play?scenario=' + scenarioId + '" class="btn btn-ghost">Back to Story</a>' : '<a href="#dashboard" class="btn btn-ghost">Dashboard</a>') +
    '</div></div>';
  return;
  if (!scenarioId) {
    el.innerHTML = '<div class="page-header"><h1 class="page-title story-font">Image Styles</h1>' +
      '<div class="header-actions"><a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a></div></div>' +
      '<div class="empty-state"><div class="empty-state-icon">S</div>' +
      '<p class="empty-state-text">Select a scenario from the dashboard to manage its styles.</p>' +
      '<a href="#dashboard" class="btn btn-primary">Go to Dashboard</a></div>';
    return;
  }

  function render(styles, activeStyleId, scenarioTitle) {
    el.innerHTML =
      '<div class="page-header">' +
        '<div class="header-left">' +
          '<a href="#play?scenario=' + scenarioId + '" class="btn btn-ghost btn-sm">&larr; Back to Story</a>' +
        '</div>' +
        '<h1 class="page-title story-font">Image Styles</h1>' +
        '<div class="header-actions">' +
          '<span style="font-size:13px;color:var(--text-muted);margin-right:8px">' + escapeHtml(scenarioTitle || '') + '</span>' +
          '<button class="btn btn-primary btn-sm" id="btn-new-style">+ New Style</button>' +
        '</div>' +
      '</div>' +
      '<div class="characters-layout">' +
        '<div class="characters-sidebar">' +
          '<div class="char-list-header">' +
            '<h2 class="panel-title">Styles</h2>' +
          '</div>' +
          '<div id="style-list" class="char-list">' +
            (styles.length === 0
              ? '<div class="empty-state small">No styles yet. Create one.</div>'
              : styles.map(function (s) {
                  var isActive = s.id === activeStyleId;
                  return '<div class="char-list-item' + (isActive ? ' active' : '') + '" data-id="' + s.id + '">' +
                    '<div class="char-avatar" style="font-size:11px;background:var(--accent-muted)">' + (isActive ? 'ON' : '') + '</div>' +
                    '<div class="char-info">' +
                      '<span class="char-name">' + escapeHtml(s.name) + '</span>' +
                      '<span class="badge badge-muted">' + escapeHtml(s.model ? s.model.replace('.safetensors','') : '-') + '</span>' +
                    '</div>' +
                  '</div>';
                }).join('')) +
          '</div>' +
        '</div>' +
        '<div class="characters-detail" id="style-detail-panel">' +
          '<div class="empty-state"><p class="empty-state-text">Select a style to edit, or create a new one.</p></div>' +
        '</div>' +
      '</div>';

    document.getElementById('btn-new-style').onclick = function () {
      renderStyleForm(null, scenarioId, styles, activeStyleId);
    };

    var listEl = document.getElementById('style-list');
    if (listEl) {
      listEl.querySelectorAll('.char-list-item').forEach(function (item) {
        item.onclick = function () {
          var sid = Number(item.dataset.id);
          var style = styles.find(function (s) { return s.id === sid; });
          listEl.querySelectorAll('.char-list-item').forEach(function (i) { i.classList.remove('active'); });
          item.classList.add('active');
          renderStyleForm(style, scenarioId, styles, activeStyleId);
        };
      });
    }
  }

  function reload() {
    Promise.all([
      API.listStyles(),
      API.getScenarioActiveStyle(scenarioId),
      API.getLoRAs().catch(function () { return { loras: [] }; })
    ]).then(function (results) {
      var styles = (results[0] && results[0].styles) || [];
      var activeId = (results[1] && results[1].active_style_id) || null;
      var rawLoras = (results[2] && results[2].loras) || [];
      if (Array.isArray(rawLoras) && rawLoras.length && typeof rawLoras[0] === 'object') {
        loraList = rawLoras.map(function (l) { return l.filename || l.name || String(l); });
      } else {
        loraList = Array.isArray(rawLoras) ? rawLoras : [];
      }
      var title = (state.currentScenario && state.currentScenario.id === scenarioId)
        ? state.currentScenario.title
        : '';
      if (!title) {
        API.getScenario(scenarioId).then(function (sc) {
          render(styles, activeId, sc.title || '');
        }).catch(function () { render(styles, activeId, ''); });
      } else {
        render(styles, activeId, title);
      }
    }).catch(function (e) {
      showToast('Failed to load styles: ' + e.message, 'error');
    });
  }

  function renderStyleForm(style, scId, allStyles, activeId) {
    var panel = document.getElementById('style-detail-panel');
    if (!panel) return;
    var isNew = !style;
    var s = style || {};

    function buildLoraOpts(selected) {
      var opts = '<option value=""' + (!selected ? ' selected' : '') + '>(none)</option>';
      opts += loraList.map(function (f) {
        return '<option value="' + escapeHtml(f) + '"' + (f === selected ? ' selected' : '') + '>' + escapeHtml(f) + '</option>';
      }).join('');
      return opts;
    }
    function buildSamplerOpts(selected) {
      return SUPPORTED_SAMPLERS.map(function (v) {
        return '<option value="' + v + '"' + (v === selected ? ' selected' : '') + '>' + v + '</option>';
      }).join('');
    }
    function buildSchedulerOpts(selected) {
      return SUPPORTED_SCHEDULERS.map(function (v) {
        return '<option value="' + v + '"' + (v === selected ? ' selected' : '') + '>' + v + '</option>';
      }).join('');
    }

    panel.innerHTML =
      '<div class="char-detail-form">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
          '<h3 style="margin:0">' + (isNew ? 'New Style' : 'Edit Style') + '</h3>' +
          (!isNew ? '<button class="btn btn-danger btn-sm" id="btn-style-delete">Delete</button>' : '') +
        '</div>' +

        (!isNew && s.id !== activeId
          ? '<div class="form-group"><button class="btn btn-ghost btn-sm" id="btn-style-activate">Set as Active Style</button></div>'
          : (!isNew ? '<div class="form-group"><span class="badge" style="background:var(--accent);color:#fff;padding:3px 8px">Active Style</span></div>' : '')) +

        '<div class="form-group">' +
          '<label class="form-label">Name</label>' +
          '<input class="form-input" id="st-name" type="text" value="' + escapeHtml(s.name || '') + '" placeholder="Untitled Style">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Model</label>' +
          '<select class="form-select" id="st-model">' + buildImageModelOptions(s.model, s.workflow) + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Workflow</label>' +
          '<select class="form-select" id="st-workflow">' +
            '<option value="story-sdxl-create"'      + ((s.workflow || 'story-sdxl-create') === 'story-sdxl-create'      ? ' selected' : '') + '>story-sdxl-create</option>' +
            '<option value="story-sdxl-consistency"' + ((s.workflow || '') === 'story-sdxl-consistency' ? ' selected' : '') + '>story-sdxl-consistency</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Sampler</label>' +
          '<select class="form-select" id="st-sampler">' + buildSamplerOpts(s.sampler || 'exp_heun_2_x0') + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Scheduler</label>' +
          '<select class="form-select" id="st-scheduler">' + buildSchedulerOpts(s.scheduler || 'kl_optimal') + '</select>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div class="form-group">' +
            '<label class="form-label">CFG</label>' +
            '<input class="form-input" id="st-cfg" type="number" min="1" max="20" step="0.5" value="' + (s.cfg != null ? s.cfg : 7.5) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Steps</label>' +
            '<input class="form-input" id="st-steps" type="number" min="10" max="80" step="1" value="' + (s.steps != null ? s.steps : 30) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Width</label>' +
            '<input class="form-input" id="st-width" type="number" min="512" max="2048" step="64" value="' + (s.width != null ? s.width : 832) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Height</label>' +
            '<input class="form-input" id="st-height" type="number" min="512" max="2048" step="64" value="' + (s.height != null ? s.height : 1216) + '">' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">LoRA 1 File</label>' +
          '<select class="form-select" id="st-lora1-file">' + buildLoraOpts(s.lora1_file) + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">LoRA 1 Strength (<span id="st-lora1-strength-label">' + Number(s.lora1_strength != null ? s.lora1_strength : 0.75).toFixed(2) + '</span>)</label>' +
          '<input type="range" class="range-input" id="st-lora1-strength" min="0" max="2" step="0.05" value="' + (s.lora1_strength != null ? s.lora1_strength : 0.75) + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">LoRA 2 File</label>' +
          '<select class="form-select" id="st-lora2-file">' + buildLoraOpts(s.lora2_file) + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">LoRA 2 Strength (<span id="st-lora2-strength-label">' + Number(s.lora2_strength != null ? s.lora2_strength : 0.75).toFixed(2) + '</span>)</label>' +
          '<input type="range" class="range-input" id="st-lora2-strength" min="0" max="2" step="0.05" value="' + (s.lora2_strength != null ? s.lora2_strength : 0.75) + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">LoRA 3 (Optional)</label>' +
          '<select class="form-select" id="st-lora3-file">' + buildLoraOpts(s.lora3_file) + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">LoRA 3 Strength (<span id="st-lora3-strength-label">' + Number(s.lora3_strength != null ? s.lora3_strength : 0.75).toFixed(2) + '</span>)</label>' +
          '<input type="range" class="range-input" id="st-lora3-strength" min="0" max="2" step="0.05" value="' + (s.lora3_strength != null ? s.lora3_strength : 0.75) + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Prompt Prefix (prepended to every image prompt)</label>' +
          '<textarea class="form-input" id="st-prompt-prefix" rows="2">' + escapeHtml(s.prompt_prefix || '') + '</textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Prompt Suffix (appended to every image prompt)</label>' +
          '<textarea class="form-input" id="st-prompt-suffix" rows="2">' + escapeHtml(s.prompt_suffix || '') + '</textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Negative Prompt</label>' +
          '<textarea class="form-input" id="st-negative-prompt" rows="2">' + escapeHtml(s.negative_prompt || '') + '</textarea>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<button class="btn btn-primary" id="btn-style-save">' + (isNew ? 'Create Style' : 'Save Changes') + '</button>' +
          '<button class="btn btn-ghost" id="btn-style-cancel">Cancel</button>' +
        '</div>' +

        '<div style="margin-top:28px;border-top:1px solid var(--border);padding-top:20px">' +
          '<h4 style="margin:0 0 4px;font-size:14px;font-weight:600">Test Shot</h4>' +
          '<p style="margin:0 0 12px;font-size:12px;color:var(--text-muted)">Uses the current form values (unsaved). Adjust settings, fire, compare, repeat.</p>' +
          '<div class="form-group">' +
            '<label class="form-label">Test Prompt</label>' +
            '<textarea class="form-input" id="st-test-prompt" rows="2" placeholder="beautiful woman, portrait, close-up, looking at camera">beautiful woman, portrait, close-up, looking at camera</textarea>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">' +
            '<button class="btn btn-secondary" id="btn-test-fire">Fire Test Image</button>' +
            '<span id="test-fire-status" style="font-size:13px;color:var(--text-muted)"></span>' +
          '</div>' +
          '<div id="test-fire-results" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px"></div>' +
        '</div>' +
      '</div>';

    var l1r = panel.querySelector('#st-lora1-strength');
    var l1l = panel.querySelector('#st-lora1-strength-label');
    if (l1r && l1l) l1r.oninput = function () { l1l.textContent = Number(l1r.value).toFixed(2); };
    var l2r = panel.querySelector('#st-lora2-strength');
    var l2l = panel.querySelector('#st-lora2-strength-label');
    if (l2r && l2l) l2r.oninput = function () { l2l.textContent = Number(l2r.value).toFixed(2); };
    var l3r = panel.querySelector('#st-lora3-strength');
    var l3l = panel.querySelector('#st-lora3-strength-label');
    if (l3r && l3l) l3r.oninput = function () { l3l.textContent = Number(l3r.value).toFixed(2); };

    var modelSel    = panel.querySelector('#st-model');
    var workflowSel = panel.querySelector('#st-workflow');
    if (modelSel && workflowSel) {
      modelSel.onchange = function () {
        if (modelSel.value.endsWith('|faceid')) {
          workflowSel.value = 'story-sdxl-consistency';
        }
      };
    }

    var cancelBtn = panel.querySelector('#btn-style-cancel');
    if (cancelBtn) cancelBtn.onclick = function () {
      panel.innerHTML = '<div class="empty-state"><p class="empty-state-text">Select a style to edit, or create a new one.</p></div>';
    };

    var activateBtn = panel.querySelector('#btn-style-activate');
    if (activateBtn) activateBtn.onclick = function () {
      API.setScenarioActiveStyle(scId, s.id)
        .then(function () { showToast('Style activated.', 'success'); reload(); })
        .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
    };

    var deleteBtn = panel.querySelector('#btn-style-delete');
    if (deleteBtn) deleteBtn.onclick = function () {
      if (!confirm('Delete style "' + (s.name || 'Untitled') + '"?')) return;
      API.deleteStyle(s.id)
        .then(function () { showToast('Style deleted.', 'success'); reload(); })
        .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
    };

    var saveBtn = panel.querySelector('#btn-style-save');
    if (saveBtn) saveBtn.onclick = function () {
      var rawModelVal = (panel.querySelector('#st-model').value || '').trim();
      var isFaceid    = rawModelVal.endsWith('|faceid');
      var resolvedModel    = isFaceid ? rawModelVal.slice(0, -'|faceid'.length) : rawModelVal;
      var resolvedWorkflow = isFaceid ? 'story-sdxl-consistency' : panel.querySelector('#st-workflow').value;
      var data = {
        name:            (panel.querySelector('#st-name').value || 'Untitled Style').trim(),
        model:           resolvedModel || null,
        workflow:        resolvedWorkflow,
        sampler:         (panel.querySelector('#st-sampler').value || '').trim(),
        scheduler:       (panel.querySelector('#st-scheduler').value || '').trim(),
        cfg:             Number(panel.querySelector('#st-cfg').value) || 7.5,
        steps:           Number(panel.querySelector('#st-steps').value) || 30,
        width:           Number(panel.querySelector('#st-width').value) || 832,
        height:          Number(panel.querySelector('#st-height').value) || 1216,
        lora1_file:      (panel.querySelector('#st-lora1-file').value || '').trim() || null,
        lora1_strength:  Number(panel.querySelector('#st-lora1-strength').value),
        lora2_file:      (panel.querySelector('#st-lora2-file').value || '').trim() || null,
        lora2_strength:  Number(panel.querySelector('#st-lora2-strength').value),
        lora3_file:      (panel.querySelector('#st-lora3-file').value || '').trim() || null,
        lora3_strength:  Number(panel.querySelector('#st-lora3-strength').value),
        prompt_prefix:   (panel.querySelector('#st-prompt-prefix').value || '').trim() || null,
        prompt_suffix:   (panel.querySelector('#st-prompt-suffix').value || '').trim() || null,
        negative_prompt: (panel.querySelector('#st-negative-prompt').value || '').trim() || null
      };
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      var promise = isNew
        ? API.createStyle(data)
        : API.updateStyle(s.id, data);
      promise
        .then(function () { showToast('Style saved.', 'success'); reload(); })
        .catch(function (e) {
          showToast('Save failed: ' + e.message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = isNew ? 'Create Style' : 'Save Changes';
        });
    };

    // ---- Test Shot panel ----
    var testFireBtn     = panel.querySelector('#btn-test-fire');
    var testFireStatus  = panel.querySelector('#test-fire-status');
    var testFireResults = panel.querySelector('#test-fire-results');

    // Persist shots in localStorage so they survive navigation and page reload.
    // Key is per-style so each style keeps its own history.
    var storageKey = 'test-shots-' + (s && s.id ? s.id : 'new');

    function loadShots() {
      try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); }
      catch (e) { return []; }
    }
    function saveShots(shots) {
      try { localStorage.setItem(storageKey, JSON.stringify(shots)); }
      catch (e) { /* storage full — ignore */ }
    }

    function renderTestShots() {
      if (!testFireResults) return;
      var shots = loadShots();
      if (!shots.length) { testFireResults.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">No test shots yet. Shots are kept until you discard them.</span>'; return; }
      testFireResults.innerHTML = shots.map(function (shot, i) {
        return '<div style="position:relative;text-align:center;margin-bottom:4px">' +
          '<img src="/story-images/' + escapeHtml(shot.filename) + '" ' +
            'style="width:190px;height:auto;border-radius:6px;border:2px solid ' + (i === 0 ? 'var(--accent)' : 'var(--border)') + ';cursor:zoom-in;display:block" ' +
            'title="' + escapeHtml(shot.label) + '" ' +
            'onclick="(function(src){var lb=document.getElementById(\'story-lightbox\');if(lb){lb.querySelector(\'img\').src=src;lb.style.display=\'flex\';}})(this.src)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px">' +
            '<span style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px" title="' + escapeHtml(shot.label) + '">' + escapeHtml(shot.label) + '</span>' +
            '<button data-discard="' + i + '" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:13px;padding:0 2px;line-height:1" title="Discard this shot">x</button>' +
          '</div>' +
        '</div>';
      }).join('');

      // Discard buttons
      testFireResults.querySelectorAll('[data-discard]').forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var idx = parseInt(btn.getAttribute('data-discard'), 10);
          var shots = loadShots();
          shots.splice(idx, 1);
          saveShots(shots);
          renderTestShots();
        };
      });
    }

    // Render any previously stored shots immediately
    renderTestShots();

    if (testFireBtn) {
      testFireBtn.onclick = function () {
        var rawModel   = (panel.querySelector('#st-model').value || '').trim();
        var isFaceid   = rawModel.endsWith('|faceid');
        var testPayload = {
          prompt:          (panel.querySelector('#st-test-prompt').value   || '').trim() || 'beautiful woman, portrait, close-up, looking at camera',
          negative_prompt: (panel.querySelector('#st-negative-prompt').value || '').trim() || null,
          model:           isFaceid ? rawModel.slice(0, -'|faceid'.length) : (rawModel || null),
          workflow:        isFaceid ? 'story-sdxl-consistency' : (panel.querySelector('#st-workflow').value || 'story-sdxl-create'),
          sampler:         (panel.querySelector('#st-sampler').value   || '').trim(),
          scheduler:       (panel.querySelector('#st-scheduler').value || '').trim(),
          cfg:             Number(panel.querySelector('#st-cfg').value)   || 7.5,
          steps:           Number(panel.querySelector('#st-steps').value) || 30,
          width:           Number(panel.querySelector('#st-width').value) || 832,
          height:          Number(panel.querySelector('#st-height').value) || 1216,
          lora1_file:      (panel.querySelector('#st-lora1-file').value || '').trim() || null,
          lora1_strength:  Number(panel.querySelector('#st-lora1-strength').value),
          lora2_file:      (panel.querySelector('#st-lora2-file').value || '').trim() || null,
          lora2_strength:  Number(panel.querySelector('#st-lora2-strength').value),
          lora3_file:      (panel.querySelector('#st-lora3-file').value || '').trim() || null,
          lora3_strength:  Number(panel.querySelector('#st-lora3-strength').value)
        };

        testFireBtn.disabled = true;
        testFireBtn.textContent = 'Generating...';
        if (testFireStatus) testFireStatus.textContent = 'Waiting for ImageCore...';

        API.testFireStyle(testPayload)
          .then(function (result) {
            testFireBtn.disabled = false;
            testFireBtn.textContent = 'Fire Test Image';
            if (testFireStatus) { testFireStatus.textContent = 'Done!'; setTimeout(function () { testFireStatus.textContent = ''; }, 3000); }
            var lora1Label = testPayload.lora1_file
              ? testPayload.lora1_file.replace('.safetensors', '') + ' x' + Number(testPayload.lora1_strength).toFixed(2)
              : 'no lora1';
            var shots = loadShots();
            shots.unshift({ filename: result.filename, label: lora1Label, ts: Date.now() });
            if (shots.length > 12) shots = shots.slice(0, 12);
            saveShots(shots);
            renderTestShots();
          })
          .catch(function (err) {
            testFireBtn.disabled = false;
            testFireBtn.textContent = 'Fire Test Image';
            if (testFireStatus) testFireStatus.textContent = 'Error: ' + err.message;
            showToast('Test image failed: ' + err.message, 'error');
          });
      };
    }
  }

  reload();
}
