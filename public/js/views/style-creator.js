/**
 * Style Creator Modal
 * Opens a two-panel modal for creating and editing image styles.
 * Call openStyleCreatorModal(scenarioId) to open.
 */

import { escapeHtml } from '../utils.js';
import { showToast } from '../ui.js';

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

function _selectOpts(list, selected) {
  return list.map(function (v) {
    return '<option value="' + escapeHtml(v) + '"' + (v === selected ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
  }).join('');
}
function _loraOpts(loraList, selected) {
  var opts = '<option value=""' + (!selected ? ' selected' : '') + '>(none)</option>';
  opts += (loraList || []).map(function (f) {
    return '<option value="' + escapeHtml(f) + '"' + (f === selected ? ' selected' : '') + '>' + escapeHtml(f) + '</option>';
  }).join('');
  return opts;
}

const DEFAULTS = {
  steps:     30,
  cfg:       7.5,
  sampler:   'DPM++ 2M SDE',
  scheduler: 'Karras',
  width:     832,
  height:    1216,
};

// ─── Modal HTML skeleton ──────────────────────────────────────────────────────

function buildModalHtml(activeBadgeText) {
  return (
    '<div class="modal modal-wide sc-modal" style="width:900px;max-width:95vw;height:80vh;display:flex;flex-direction:column;padding:0;overflow:hidden">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0">' +
        '<h3 class="modal-title" style="margin:0">Image Styles</h3>' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<span id="sc-active-badge" style="font-size:12px;color:var(--text-muted)">' +
            (activeBadgeText
              ? 'Active: <strong>' + escapeHtml(activeBadgeText) + '</strong>'
              : 'No active style') +
          '</span>' +
          '<button class="btn btn-ghost btn-sm" id="sc-close">Close</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex:1;overflow:hidden">' +
        '<div style="width:220px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column">' +
          '<div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">' +
            '<span style="font-size:13px;font-weight:600;color:var(--text-muted)">Styles</span>' +
            '<button class="btn btn-primary btn-sm" id="sc-new-style">+ New</button>' +
          '</div>' +
          '<div id="sc-style-list" style="flex:1;overflow-y:auto;padding:4px 0"></div>' +
        '</div>' +
        '<div id="sc-editor-panel" style="flex:1;overflow-y:auto;padding:20px">' +
          '<div class="empty-state"><p class="empty-state-text">Select a style or create a new one.</p></div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

// ─── Style list item HTML ─────────────────────────────────────────────────────

function buildListItem(style, activeId) {
  var isActive = style.id === activeId;
  return (
    '<div class="sc-list-item" data-id="' + style.id + '" style="' +
      'padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.05));' +
      'display:flex;align-items:center;justify-content:space-between;' +
      (isActive ? 'background:var(--accent-muted,rgba(99,102,241,.15))' : '') +
    '">' +
      '<div style="min-width:0">' +
        '<div style="font-size:13px;font-weight:' + (isActive ? '600' : '400') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
          escapeHtml(style.name || 'Untitled') +
        '</div>' +
        (isActive ? '<div style="font-size:11px;color:var(--accent)">Active</div>' : '') +
      '</div>' +
      '<button class="sc-del-btn" data-id="' + style.id + '" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:16px;padding:0 2px;flex-shrink:0" title="Delete">x</button>' +
    '</div>'
  );
}

// ─── Style editor form HTML ───────────────────────────────────────────────────

function buildEditorHtml(style, isActive, loraList) {
  var s = style || {};
  var isNew = !s.id;

  function val(field, def) {
    var v = s[field];
    return (v != null && v !== '') ? v : (def != null ? def : '');
  }
  function numVal(field, def) {
    var v = s[field];
    return (v != null) ? v : def;
  }
  function ta(id, field, rows, placeholder, def) {
    return (
      '<div class="form-group">' +
        '<label class="form-label">' + id.replace('sc-','').replace(/-/g,' ').replace(/\b\w/g, function(c){return c.toUpperCase();}) + '</label>' +
        '<textarea class="form-input" id="sc-' + field + '" rows="' + rows + '" placeholder="' + escapeHtml(placeholder||'') + '">' +
          escapeHtml(val(field, def)) +
        '</textarea>' +
      '</div>'
    );
  }
  function inp(id, field, type, placeholder, defVal, extra) {
    var v = type === 'number' ? numVal(field, defVal) : val(field, defVal);
    return (
      '<div class="form-group">' +
        '<label class="form-label">' + escapeHtml(id) + '</label>' +
        '<input class="form-input" id="sc-' + field + '" type="' + type + '" value="' + escapeHtml(String(v)) + '" placeholder="' + escapeHtml(placeholder||'') + '"' + (extra||'') + '>' +
      '</div>'
    );
  }

  return (
    '<div style="max-width:640px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
        '<h4 style="margin:0">' + (isNew ? 'New Style' : 'Edit Style') + '</h4>' +
        (!isNew
          ? '<div style="display:flex;gap:8px">' +
              (isActive
                ? '<span class="badge" style="background:var(--accent);color:#fff;padding:3px 10px;border-radius:99px;font-size:12px">Active</span>'
                : '<button class="btn btn-ghost btn-sm" id="sc-set-active">Set as Active</button>') +
              '<button class="btn btn-danger btn-sm" id="sc-delete">Delete</button>' +
            '</div>'
          : '') +
      '</div>' +

      '<div class="form-group">' +
        '<label class="form-label">Name</label>' +
        '<input class="form-input" id="sc-name" type="text" value="' + escapeHtml(val('name','')) + '" placeholder="e.g. Cinematic, Anime, Dark Fantasy">' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">' +
        '<div class="form-group">' +
          '<label class="form-label">CFG Scale</label>' +
          '<input class="form-input" id="sc-cfg" type="number" value="' + numVal('cfg', DEFAULTS.cfg) + '" step="0.5" min="1" max="20">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Steps</label>' +
          '<input class="form-input" id="sc-steps" type="number" value="' + numVal('steps', DEFAULTS.steps) + '" step="1" min="1" max="60">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Width</label>' +
          '<input class="form-input" id="sc-width" type="number" value="' + numVal('width', DEFAULTS.width) + '" step="64" min="256" max="2048">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Height</label>' +
          '<input class="form-input" id="sc-height" type="number" value="' + numVal('height', DEFAULTS.height) + '" step="64" min="256" max="2048">' +
        '</div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div class="form-group">' +
          '<label class="form-label">Sampler Name</label>' +
          '<select class="form-input" id="sc-sampler">' + _selectOpts(SUPPORTED_SAMPLERS, val('sampler', DEFAULTS.sampler)) + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Scheduler</label>' +
          '<select class="form-input" id="sc-scheduler">' + _selectOpts(SUPPORTED_SCHEDULERS, val('scheduler', DEFAULTS.scheduler)) + '</select>' +
        '</div>' +
      '</div>' +

      '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0 12px">' +
      '<h5 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">LoRAs</h5>' +

      '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label">LoRA 1 File</label>' +
          '<select class="form-select" id="sc-lora1_file">' + _loraOpts(loraList, val('lora1_file', '')) + '</select>' +
        '</div>' +
        '<div class="form-group" style="margin:0;min-width:90px">' +
          '<label class="form-label">Strength</label>' +
          '<input class="form-input" id="sc-lora1_strength" type="number" min="0" max="3" step="0.05" value="' + numVal('lora1_strength', 1.2) + '">' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-top:8px">' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label">LoRA 2 File</label>' +
          '<select class="form-select" id="sc-lora2_file">' + _loraOpts(loraList, val('lora2_file', '')) + '</select>' +
        '</div>' +
        '<div class="form-group" style="margin:0;min-width:90px">' +
          '<label class="form-label">Strength</label>' +
          '<input class="form-input" id="sc-lora2_strength" type="number" min="0" max="3" step="0.05" value="' + numVal('lora2_strength', 0.8) + '">' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-top:8px">' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label">LoRA 3 File</label>' +
          '<select class="form-select" id="sc-lora3_file">' + _loraOpts(loraList, val('lora3_file', '')) + '</select>' +
        '</div>' +
        '<div class="form-group" style="margin:0;min-width:90px">' +
          '<label class="form-label">Strength</label>' +
          '<input class="form-input" id="sc-lora3_strength" type="number" min="0" max="3" step="0.05" value="' + numVal('lora3_strength', 0.65) + '">' +
        '</div>' +
      '</div>' +

      '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0 12px">' +
      '<h5 style="margin:0 0 10px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Prompt Modifiers</h5>' +

      '<div class="form-group">' +
        '<label class="form-label">Positive Prompt Prefix</label>' +
        '<textarea class="form-input" id="sc-prompt_prefix" rows="2" placeholder="prepended to every image prompt">' + escapeHtml(val('prompt_prefix','')) + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Positive Prompt Suffix</label>' +
        '<textarea class="form-input" id="sc-prompt_suffix" rows="2" placeholder="appended to every image prompt">' + escapeHtml(val('prompt_suffix','')) + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Negative Prompt</label>' +
        '<textarea class="form-input" id="sc-negative_prompt" rows="2" placeholder="low quality, blurry...">' + escapeHtml(val('negative_prompt','')) + '</textarea>' +
      '</div>' +

      '<div style="display:flex;gap:8px;margin-top:16px">' +
        '<button class="btn btn-primary" id="sc-save">' + (isNew ? 'Create Style' : 'Save Changes') + '</button>' +
        '<button class="btn btn-ghost" id="sc-cancel">Cancel</button>' +
      '</div>' +
    '</div>'
  );
}

// ─── Collect editor values ────────────────────────────────────────────────────

function collectEditor(panel) {
  function g(id) { var el = panel.querySelector('#sc-' + id); return el ? el.value : ''; }
  function trim(v) { return (v || '').trim() || null; }
  return {
    name:            (g('name') || '').trim() || 'Untitled Style',
    cfg:             parseFloat(g('cfg'))      || DEFAULTS.cfg,
    steps:           parseInt(g('steps'), 10)  || DEFAULTS.steps,
    width:           parseInt(g('width'), 10)  || DEFAULTS.width,
    height:          parseInt(g('height'), 10) || DEFAULTS.height,
    sampler:         trim(g('sampler'))        || DEFAULTS.sampler,
    scheduler:       trim(g('scheduler'))      || DEFAULTS.scheduler,
    lora1_file:      trim(g('lora1_file')),
    lora1_strength:  parseFloat(g('lora1_strength')) || 1.2,
    lora2_file:      trim(g('lora2_file')),
    lora2_strength:  parseFloat(g('lora2_strength')) || 0.8,
    lora3_file:      trim(g('lora3_file')),
    lora3_strength:  parseFloat(g('lora3_strength')) || 0.65,
    prompt_prefix:   trim(g('prompt_prefix')),
    prompt_suffix:   trim(g('prompt_suffix')),
    negative_prompt: trim(g('negative_prompt')),
  };
}

// ─── Main open function ───────────────────────────────────────────────────────

export function openStyleCreatorModal(scenarioId) {
  var overlay = document.getElementById('modal-overlay');
  if (!overlay) return;

  var styles    = [];
  var activeId  = null;
  var loraList  = [];

  function renderList() {
    var listEl = overlay.querySelector('#sc-style-list');
    if (!listEl) return;
    if (!styles.length) {
      listEl.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text-muted)">No styles yet.</div>';
      return;
    }
    listEl.innerHTML = styles.map(function (s) { return buildListItem(s, activeId); }).join('');
    listEl.querySelectorAll('.sc-list-item').forEach(function (item) {
      item.onclick = function (e) {
        if (e.target.classList.contains('sc-del-btn')) return;
        var sid = Number(item.dataset.id);
        var style = styles.find(function (s) { return s.id === sid; });
        selectStyle(style);
      };
    });
    listEl.querySelectorAll('.sc-del-btn').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var sid = Number(btn.dataset.id);
        var style = styles.find(function (s) { return s.id === sid; });
        var name = style ? style.name : 'this style';
        if (!confirm('Delete "' + name + '"?')) return;
        API.deleteStyle(sid)
          .then(function () { showToast('Style deleted.', 'success'); reload(); })
          .catch(function (err) { showToast('Delete failed: ' + err.message, 'error'); });
      };
    });
  }

  function renderActiveBadge() {
    var badgeEl = overlay.querySelector('#sc-active-badge');
    if (!badgeEl) return;
    var active = styles.find(function (s) { return s.id === activeId; });
    badgeEl.innerHTML = active
      ? 'Active: <strong>' + escapeHtml(active.name) + '</strong>'
      : 'No active style';
  }

  function selectStyle(style) {
    var panel = overlay.querySelector('#sc-editor-panel');
    if (!panel) return;
    var isActive = style && style.id === activeId;
    panel.innerHTML = buildEditorHtml(style, isActive, loraList);
    wireEditor(panel, style);
  }

  function wireEditor(panel, existingStyle) {
    var isNew = !existingStyle;

    var saveBtn = panel.querySelector('#sc-save');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var data = collectEditor(panel);
        if (!data.name) { showToast('Style name is required.', 'error'); return; }
        saveBtn.disabled   = true;
        saveBtn.textContent = 'Saving...';
        var promise = isNew
          ? API.createStyle(data)
          : API.updateStyle(existingStyle.id, data);
        promise
          .then(function () {
            showToast('Style saved.', 'success');
            reload();
          })
          .catch(function (err) {
            saveBtn.disabled   = false;
            saveBtn.textContent = isNew ? 'Create Style' : 'Save Changes';
            showToast('Save failed: ' + err.message, 'error');
          });
      };
    }

    var cancelBtn = panel.querySelector('#sc-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        panel.innerHTML = '<div class="empty-state"><p class="empty-state-text">Select a style or create a new one.</p></div>';
      };
    }

    var deleteBtn = panel.querySelector('#sc-delete');
    if (deleteBtn) {
      deleteBtn.onclick = function () {
        if (!confirm('Delete "' + (existingStyle.name || 'this style') + '"?')) return;
        API.deleteStyle(existingStyle.id)
          .then(function () { showToast('Style deleted.', 'success'); reload(); })
          .catch(function (err) { showToast('Delete failed: ' + err.message, 'error'); });
      };
    }

    var activateBtn = panel.querySelector('#sc-set-active');
    if (activateBtn && scenarioId) {
      activateBtn.onclick = function () {
        activateBtn.disabled   = true;
        activateBtn.textContent = 'Setting...';
        API.setScenarioActiveStyle(scenarioId, existingStyle.id)
          .then(function () {
            showToast('Style activated.', 'success');
            reload(existingStyle.id);
          })
          .catch(function (err) {
            activateBtn.disabled   = false;
            activateBtn.textContent = 'Set as Active';
            showToast('Failed: ' + err.message, 'error');
          });
      };
    }
  }

  function reload(reSelectId) {
    Promise.all([
      API.listStyles(),
      scenarioId ? API.getScenarioActiveStyle(scenarioId) : Promise.resolve(null),
      API.getLoRAs()
    ]).then(function (results) {
      styles   = (results[0] && results[0].styles) || [];
      activeId = (results[1] && results[1].active_style_id) || null;
      var rawLoras = (results[2] && results[2].loras) || [];
      loraList = rawLoras.map(function (l) { return l.filename || l.name || String(l); });
      renderList();
      renderActiveBadge();
      if (reSelectId) {
        var s = styles.find(function (s) { return s.id === reSelectId; });
        if (s) selectStyle(s);
      }
    }).catch(function (err) {
      showToast('Failed to load styles: ' + err.message, 'error');
    });
  }

  // Build initial modal HTML (badge will be populated after data loads)
  overlay.innerHTML = buildModalHtml(null);
  overlay.classList.remove('hidden');

  // Close handlers
  var closeBtn = overlay.querySelector('#sc-close');
  if (closeBtn) closeBtn.onclick = function () { overlay.classList.add('hidden'); };
  overlay.onclick = function (e) { if (e.target === overlay) overlay.classList.add('hidden'); };

  // New style button
  var newBtn = overlay.querySelector('#sc-new-style');
  if (newBtn) {
    newBtn.onclick = function () {
      var panel = overlay.querySelector('#sc-editor-panel');
      if (panel) {
        panel.innerHTML = buildEditorHtml(null, false, loraList);
        wireEditor(panel, null);
      }
    };
  }

  // Load data
  reload();
}
