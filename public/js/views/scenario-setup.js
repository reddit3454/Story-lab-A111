import { state } from '../state.js';
import { escapeHtml, imageSrc } from '../utils.js';
import { showToast, showConfirm, setLoading, statusDotsHtml } from '../ui.js';
import {
  HAIR_COLOR_OPTS, HAIR_STYLE_OPTS, BODY_TYPE_OPTS, BREAST_SIZE_OPTS,
  BUTT_SIZE_OPTS, PENIS_STATE_OPTS, HEIGHT_OPTS, EYE_COLOR_OPTS, SKIN_TONE_OPTS,
  AGE_RANGE_OPTS, EYE_SHAPE_OPTS, NOSE_SHAPE_OPTS, LIP_SHAPE_OPTS, FACE_SHAPE_OPTS,
  OUTFIT_STYLE_OPTS, GENDER_OPTS
} from '../constants.js';

export function defaultWizardData() {
  return {
    title: '', setting: '', tone: 'Dramatic', premise: '',
    default_start: '',
    user_character_id: null,
    active_location_id: null,
    reply_length: 'medium', lust_level: 3,
    explicitness_level: 'moderate', pacing: 'normal',
    narrative_pov: 'third', violence_level: 'mild',
    tone_modifier: '',
    nsfw_enabled: 1,
    narrator_presence_enabled: 0,
    narrator_presence_mode: 'all',
    narrator_presence_config: null,
  };
}

export function initScenarioSetup(editId) {
  state.editingScenarioId = editId ? Number(editId) : null;
  state.wizardStep = 1;
  state.wizardCast = [];
  state.wizardData = defaultWizardData();

  var el = document.getElementById('view-scenario-setup');
  el.innerHTML =
    '<div class="wizard-container">' +
      '<div class="wizard-header">' +
        '<div class="wizard-header-left">' +
          '<a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a>' +
          statusDotsHtml() +
        '</div>' +
        '<h1 class="wizard-title story-font">' + (editId ? 'Edit Scenario' : 'New Scenario') + '</h1>' +
        '<div class="wizard-steps" id="wizard-steps">' +
          '<div class="wizard-step active" data-step="1">1. Story</div>' +
          '<div class="wizard-step-sep">&rsaquo;</div>' +
          '<div class="wizard-step" data-step="2">2. Cast</div>' +
          '<div class="wizard-step-sep">&rsaquo;</div>' +
          '<div class="wizard-step" data-step="3">3. Style</div>' +
        '</div>' +
      '</div>' +
      '<div id="wizard-body" class="wizard-body"><div class="loading-state">Loading...</div></div>' +
      '<div class="wizard-footer">' +
        '<button class="btn btn-secondary" id="btn-wizard-back">Back</button>' +
        '<button class="btn btn-primary" id="btn-wizard-next">Next &rarr;</button>' +
      '</div>' +
    '</div>';

  document.getElementById('btn-wizard-back').onclick = wizardBack;
  document.getElementById('btn-wizard-next').onclick = wizardNext;

  var loadPromises = [
    API.getCharacters().catch(function () { return []; }),
    API.getA1111Loras().catch(function () { return { loras: [] }; }),
    editId ? API.getLocations(editId).catch(function () { return { locations: [] }; })
           : Promise.resolve({ locations: [] }),
  ];
  if (editId) {
    loadPromises.push(API.getScenario(editId));
    loadPromises.push(API.getScenarioCharacters(editId).catch(function () { return []; }));
  }

  Promise.all(loadPromises).then(function (results) {
    state.allCharacters = Array.isArray(results[0]) ? results[0] : [];
    state.availableLoRAs = (results[1].loras || []);
    state.allLocations   = (results[2].locations || []);
    if (editId && results[3]) {
      var s = results[3];
      Object.assign(state.wizardData, {
        id: s.id,
        title: s.title || '',
        setting: s.setting || '',
        tone: s.tone || 'Dramatic',
        premise: s.premise || '',
        default_start: s.default_start || '',
        user_character_id: s.user_character_id || null,
        active_location_id: s.active_location_id || null,
        reply_length: s.reply_length || 'medium',
        lust_level: s.lust_level != null ? s.lust_level : 3,
        explicitness_level: s.explicitness_level || 'moderate',
        pacing: s.pacing || 'normal',
        narrative_pov: s.narrative_pov || 'third',
        violence_level: s.violence_level || 'mild',
        tone_modifier: s.tone_modifier || '',
        nsfw_enabled: s.nsfw_enabled != null ? s.nsfw_enabled : 1,
        narrator_presence_enabled: s.narrator_presence_enabled != null ? s.narrator_presence_enabled : 0,
        narrator_presence_mode: s.narrator_presence_mode || 'all',
        narrator_presence_config: s.narrator_presence_config || null,
      });
    }
    if (editId && results[4]) {
      state.wizardCast = Array.isArray(results[4]) ? results[4].slice() : [];
    }
    renderWizardStep();
  }).catch(function (e) {
    showToast('Failed to load data: ' + e.message, 'error');
    renderWizardStep();
  });
}

function renderWizardStep() {
  var body = document.getElementById('wizard-body');
  if (!body) return;

  document.querySelectorAll('.wizard-step[data-step]').forEach(function (s) {
    var n = Number(s.dataset.step);
    s.classList.toggle('active', n === state.wizardStep);
    s.classList.toggle('done',   n < state.wizardStep);
  });

  var backBtn = document.getElementById('btn-wizard-back');
  var nextBtn = document.getElementById('btn-wizard-next');
  if (backBtn) backBtn.style.visibility = state.wizardStep === 1 ? 'hidden' : 'visible';
  if (nextBtn) {
    var isLast = state.wizardStep === 3;
    nextBtn.innerHTML = isLast
      ? (state.editingScenarioId ? 'Save Changes' : 'Create Scenario')
      : 'Next &rarr;';
  }

  if      (state.wizardStep === 1) renderStep1(body);
  else if (state.wizardStep === 2) renderStep2(body);
  else                             renderStep3(body);
}

function wizardBack() {
  if (state.wizardStep === 1) { location.hash = '#dashboard'; return; }
  state.wizardStep--;
  renderWizardStep();
}

function wizardNext() {
  if (state.wizardStep === 1) {
    collectStep1();
    if (!state.wizardData.title) { showToast('Title is required.', 'error'); return; }
    state.wizardStep = 2;
    renderWizardStep();
  } else if (state.wizardStep === 2) {
    state.wizardStep = 3;
    renderWizardStep();
  } else {
    collectStep3();
    submitWizard();
  }
}

/* --- Step 1 --- */
function renderStep1(container) {
  var d = state.wizardData;
  var tones = ['Romantic','Sensual','Flirtatious','Seductive','Intimate','Dark','Dramatic','Comedic','Thriller','Fantasy','Sci-Fi','Slice of Life','Mystery','Horror','Adventure','Custom'];
  container.innerHTML =
    '<div class="wizard-step-content">' +
      '<div class="form-group">' +
        '<label class="form-label">Title <span class="required">*</span></label>' +
        '<input type="text" class="form-input" id="w-title" value="' + escapeHtml(d.title) + '" placeholder="My Epic Story">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Location <span class="required">*</span></label>' +
        '<select class="form-select" id="w-location-id">' +
          '<option value="">-- Select a location --</option>' +
          state.allLocations.map(function (loc) {
            return '<option value="' + loc.id + '"' + (d.active_location_id == loc.id ? ' selected' : '') + '>' + escapeHtml(loc.name) + '</option>';
          }).join('') +
          '<option value="other"' + (!d.active_location_id && d.setting ? ' selected' : '') + '>Other...</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group" id="w-setting-group" style="' + (!d.active_location_id && d.setting ? '' : 'display:none') + '">' +
        '<label class="form-label">Setting Description</label>' +
        '<textarea class="form-input" id="w-setting" rows="3" placeholder="Describe the world, time period, location...">' + escapeHtml(d.setting) + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Tone</label>' +
        '<select class="form-select" id="w-tone">' +
          tones.map(function (t) { return '<option value="' + t + '"' + (d.tone === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Premise</label>' +
        '<textarea class="form-input" id="w-premise" rows="5" placeholder="What is this story about?">' + escapeHtml(d.premise) + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<div class="form-label-row">' +
          '<label class="form-label" for="w-default-start">Default Opening</label>' +
          '<button type="button" class="btn btn-ghost btn-xs" id="w-default-start-clear">Clear</button>' +
        '</div>' +
        '<textarea class="form-input" id="w-default-start" rows="3" placeholder="Optional: pre-fill the chat input when starting a fresh session (e.g. your character\'s first line or action)...">' + escapeHtml(d.default_start) + '</textarea>' +
        '<p class="form-hint">Pre-loaded into the input box when the story has no turns yet. You can edit it before sending.</p>' +
      '</div>' +
    '</div>';

  var locSelect = container.querySelector('#w-location-id');
  if (locSelect) {
    locSelect.onchange = function () {
      var grp = document.getElementById('w-setting-group');
      if (grp) grp.style.display = (this.value === 'other') ? '' : 'none';
    };
  }

  var clearBtn = container.querySelector('#w-default-start-clear');
  if (clearBtn) {
    clearBtn.onclick = function () {
      var ta = document.getElementById('w-default-start');
      if (ta) ta.value = '';
    };
  }
}

function collectStep1() {
  state.wizardData.title         = (document.getElementById('w-title')         || {value:''}).value.trim();
  state.wizardData.tone          = (document.getElementById('w-tone')          || {value:'Dramatic'}).value;
  state.wizardData.premise       = (document.getElementById('w-premise')       || {value:''}).value.trim();
  state.wizardData.default_start = (document.getElementById('w-default-start') || {value:''}).value.trim();
  var locVal = (document.getElementById('w-location-id') || {value:''}).value;
  if (locVal && locVal !== 'other') {
    state.wizardData.active_location_id = Number(locVal);
    state.wizardData.setting = '';
  } else {
    state.wizardData.active_location_id = null;
    state.wizardData.setting = (document.getElementById('w-setting') || {value:''}).value.trim();
  }
}

/* --- Step 2 --- */
function renderStep2(container) {
  var sid = state.editingScenarioId;

  if (!sid) {
    container.innerHTML =
      '<div style="padding:48px 24px;text-align:center">' +
        '<p style="font-size:15px;margin-bottom:8px">Save the scenario first to add characters.</p>' +
        '<p class="form-hint">Complete the Story step and create the scenario, then return here to build your cast.</p>' +
      '</div>';
    return;
  }

  container.innerHTML = '<div class="loading-state small">Loading cast...</div>';

  Promise.all([
    API.getScenarioCharacters(sid),
    API.getCharacters()
  ]).then(function (results) {
    var roster    = Array.isArray(results[0]) ? results[0] : [];
    var allChars  = Array.isArray(results[1]) ? results[1] : [];
    var rosterIds = roster.map(function (c) { return c.id; });
    var available = allChars.filter(function (c) { return rosterIds.indexOf(c.id) < 0; });

    // Keep module-level state in sync for narrator presence section
    state.wizardCast = roster.slice();

    var filterText = '';

    function refresh() { renderStep2(container); }

    function renderView() {
      var filtered = filterText
        ? available.filter(function (c) { return c.name.toLowerCase().indexOf(filterText) !== -1; })
        : available;

      container.innerHTML =
        '<div class="cast-selector">' +
          '<div class="cast-column">' +
            '<h3 class="column-title">In This Story</h3>' +
            '<div class="cast-list" id="cast-roster">' +
              (roster.length
                ? roster.map(function (c) {
                    var sub = [c.gender, c.age_range].filter(Boolean).join(', ');
                    return '<div class="cast-item" data-id="' + c.id + '">' +
                      '<div class="char-avatar small">' + escapeHtml(c.name[0].toUpperCase()) + '</div>' +
                      '<div style="flex:1;min-width:0">' +
                        '<div style="font-weight:500">' + escapeHtml(c.name) + '</div>' +
                        (sub ? '<div style="font-size:11px;color:var(--text-muted)">' + escapeHtml(sub) + '</div>' : '') +
                      '</div>' +
                      '<button class="btn btn-ghost btn-xs remove-cast-btn" data-id="' + c.id + '" data-name="' + escapeHtml(c.name) + '" style="flex-shrink:0">Remove</button>' +
                    '</div>';
                  }).join('')
                : '<div class="empty-state small">No characters in this story yet.</div>'
              ) +
            '</div>' +
          '</div>' +
          '<div class="cast-divider">&rsaquo;&rsaquo;</div>' +
          '<div class="cast-column">' +
            '<h3 class="column-title">Available Characters</h3>' +
            '<input type="text" class="form-input" id="cast-filter" placeholder="Filter..." value="' + escapeHtml(filterText) + '" style="margin-bottom:6px;font-size:13px">' +
            '<div class="cast-list" id="cast-available">' +
              (filtered.length
                ? filtered.map(function (c) {
                    var sub = [c.gender, c.age_range].filter(Boolean).join(', ');
                    return '<div class="cast-item" data-id="' + c.id + '">' +
                      '<div class="char-avatar small">' + escapeHtml(c.name[0].toUpperCase()) + '</div>' +
                      '<div style="flex:1;min-width:0">' +
                        '<div style="font-weight:500">' + escapeHtml(c.name) + '</div>' +
                        (sub ? '<div style="font-size:11px;color:var(--text-muted)">' + escapeHtml(sub) + '</div>' : '') +
                      '</div>' +
                      '<button class="btn btn-primary btn-xs add-cast-btn" data-id="' + c.id + '" style="flex-shrink:0">+ Add</button>' +
                    '</div>';
                  }).join('')
                : '<div class="empty-state small">' + (filterText ? 'No matching characters.' : 'All characters are in this story.') + '</div>'
              ) +
            '</div>' +
            '<a href="#characters" class="btn btn-ghost btn-sm" style="display:block;margin-top:8px">Manage Characters &rarr;</a>' +
          '</div>' +
        '</div>';

      var filterInput = container.querySelector('#cast-filter');
      if (filterInput) {
        filterInput.oninput = function () {
          filterText = filterInput.value.toLowerCase().trim();
          renderView();
        };
      }

      container.querySelectorAll('.remove-cast-btn').forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var charId   = Number(btn.dataset.id);
          var charName = btn.dataset.name || 'this character';
          if (!confirm('Remove ' + charName + ' from this story?')) return;
          btn.disabled = true;
          API.removeCharacterFromScenario(sid, charId)
            .then(refresh)
            .catch(function (err) { btn.disabled = false; showToast('Failed: ' + err.message, 'error'); });
        };
      });

      container.querySelectorAll('.add-cast-btn').forEach(function (btn) {
        btn.onclick = function () {
          var charId = Number(btn.dataset.id);
          btn.disabled = true;
          API.addCharacterToScenario(sid, charId)
            .then(refresh)
            .catch(function (err) { btn.disabled = false; showToast('Failed: ' + err.message, 'error'); });
        };
      });
    }

    renderView();
  }).catch(function (err) {
    container.innerHTML = '<div class="error-state">Failed to load cast: ' + escapeHtml(err.message) + '</div>';
  });
}

/* --- Step 3 --- */
function renderStep3(container) {
  var d = state.wizardData;
  container.innerHTML =
    '<div class="wizard-step-content">' +

      /* Writing Style */
      '<div class="collapsible-section" id="section-writing">' +
        '<button class="collapsible-header" type="button" onclick="window._toggleSection(\'section-writing\')">' +
          'Writing Style <span class="chevron">+</span>' +
        '</button>' +
        '<div class="collapsible-body hidden">' +
          '<div class="form-group">' +
            '<label class="form-label">Reply Length</label>' +
            renderSegmented('w-reply-length', [
              {label:'Short',value:'short'},{label:'Medium',value:'medium'},
              {label:'Long',value:'long'},{label:'Verbose',value:'verbose'}
            ], d.reply_length) +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Character Receptivity &nbsp;<span class="receptivity-label" id="receptivity-label">' + receptivityLabel(d.lust_level) + '</span></label>' +
            '<input type="range" class="range-input" id="w-lust-level" min="1" max="5" value="' + d.lust_level + '">' +
            '<div class="range-labels"><span>Hard to Get</span><span>Insatiable</span></div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Scene Detail</label>' +
            renderSegmented('w-explicitness', [
              {label:'Fade to Black',value:'fade-to-black'},{label:'Suggestive',value:'suggestive'},
              {label:'Moderate',value:'moderate'},{label:'Explicit',value:'explicit'}
            ], d.explicitness_level) +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Pacing</label>' +
            renderSegmented('w-pacing', [
              {label:'Slow Burn',value:'slow'},{label:'Normal',value:'normal'},{label:'Fast',value:'fast'}
            ], d.pacing) +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Narrative POV</label>' +
            renderSegmented('w-pov', [
              {label:'3rd Person',value:'third'},{label:'2nd Person',value:'second'}
            ], d.narrative_pov) +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Violence Level</label>' +
            renderSegmented('w-violence', [
              {label:'None',value:'none'},{label:'Mild',value:'mild'},
              {label:'Moderate',value:'moderate'},{label:'Graphic',value:'graphic'}
            ], d.violence_level) +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Tone Modifier</label>' +
            '<input type="text" class="form-input" id="w-tone-modifier" value="' + escapeHtml(d.tone_modifier) + '" placeholder="e.g. melancholic, tense, playful">' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* NSFW toggle (scenario-level, not style-level) */
      '<div class="form-group" style="margin-bottom:12px">' +
        '<label class="toggle-label">' +
          '<span class="nsfw-label">Safe Mode (disable NSFW)</span>' +
          '<div class="toggle' + (!d.nsfw_enabled ? ' active' : '') + '" id="w-nsfw"></div>' +
        '</label>' +
      '</div>' +

      /* Link to styles page (if editing) */
      (d.id ? '<div class="form-group"><a class="btn btn-ghost btn-sm" href="#styles?scenario=' + d.id + '">Manage Image Styles for this Scenario</a></div>' : '') +

      /* Narrator Character Control */
      renderNarratorPresenceSection(d) +

    '</div>';

  setupSegmentedBtns();
  setupStep3Toggles();

  var rangeInput= document.getElementById('w-lust-level');
  if (rangeInput) {
    rangeInput.oninput = function () {
      var lbl = document.getElementById('receptivity-label');
      if (lbl) lbl.textContent = receptivityLabel(Number(rangeInput.value));
    };
  }

  // LoRA strength sliders
  ['1','2'].forEach(function(n) {
    var slider = document.getElementById('w-lora' + n + '-strength');
    var label  = document.getElementById('w-lora' + n + '-strength-label');
    if (slider && label) {
      slider.oninput = function() { label.textContent = Number(slider.value).toFixed(2); };
    }
  });

  // Theme preset apply button
  var applyThemeBtn = document.getElementById('btn-apply-theme');
  if (applyThemeBtn && typeof THEME_PRESETS !== 'undefined') {
    applyThemeBtn.onclick = function() {
      var sel = document.getElementById('w-theme-preset');
      var prefix = document.getElementById('w-image-prefix');
      if (!sel || !prefix) return;
      var themeId = sel.value;
      if (!themeId) { prefix.value = ''; return; }
      var theme = THEME_PRESETS.find(function(t) { return t.id === themeId; });
      if (theme) prefix.value = theme.tags.join(', ');
    };
  }
}

function receptivityLabel(val) {
  var m = {1:'Hard to Get', 2:'Cautious', 3:'Receptive', 4:'Eager', 5:'Insatiable'};
  return m[val] || '';
}

function buildLoraOptions(selected) {
  var loras = state.availableLoRAs || [];
  var opts = '<option value=""' + (!selected ? ' selected' : '') + '>-- None --</option>';
  opts += loras.map(function (l) {
    var f = typeof l === 'string' ? l : (l.filename || l.name || '');
    var label = typeof l === 'string' ? l : (l.label || l.display_name || f);
    return '<option value="' + escapeHtml(f) + '"' + (f === selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
  }).join('');
  return opts;
}


function renderSegmented(id, options, selected) {
  return '<div class="segmented-btn" id="' + id + '">' +
    options.map(function (o) {
      return '<button type="button" class="seg-btn' + (o.value === selected ? ' active' : '') + '" data-value="' + o.value + '">' + escapeHtml(o.label) + '</button>';
    }).join('') +
  '</div>';
}

function setupSegmentedBtns() {
  document.querySelectorAll('.segmented-btn').forEach(function (group) {
    group.querySelectorAll('.seg-btn').forEach(function (btn) {
      btn.onclick = function () {
        group.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      };
    });
  });
}

function renderNarratorPresenceSection(d) {
  var presenceCfg = null;
  try { presenceCfg = d.narrator_presence_config ? JSON.parse(d.narrator_presence_config) : null; } catch (_) {}
  var allowed  = Array.isArray(presenceCfg && presenceCfg.allowed)  ? presenceCfg.allowed  : [];
  var blocked  = Array.isArray(presenceCfg && presenceCfg.blocked)  ? presenceCfg.blocked  : [];
  var mode     = d.narrator_presence_mode || 'all';
  var enabled  = !!d.narrator_presence_enabled;

  var charListHtml = '';
  if (state.allCharacters && state.allCharacters.length) {
    charListHtml = state.allCharacters.map(function (c) {
      var isInCast = state.wizardCast && state.wizardCast.some(function (wc) { return wc.id === c.id; });
      if (isInCast) return ''; // skip cast members
      var isAllowed  = allowed.indexOf(c.id) !== -1;
      var isBlocked  = blocked.indexOf(c.id) !== -1;
      return '<label class="npc-check-label" style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer">' +
        '<input type="checkbox" class="npc-presence-check" data-char-id="' + c.id + '" ' + (mode === 'allowlist' ? (isAllowed ? 'checked' : '') : (mode === 'blocklist' ? (isBlocked ? 'checked' : '') : '')) + '>' +
        escapeHtml(c.name) +
      '</label>';
    }).join('');
  }

  var charPickerHtml = '<div id="narrator-presence-picker" style="' + (mode === 'all' ? 'display:none' : '') + '">' +
    '<p class="form-hint" id="presence-picker-hint">' + (mode === 'allowlist' ? 'Check characters the narrator may add:' : 'Check characters to block:') + '</p>' +
    (charListHtml || '<p class="form-hint">No non-cast characters available.</p>') +
  '</div>';

  return '<div class="collapsible-section" id="section-presence">' +
    '<button class="collapsible-header" type="button" onclick="window._toggleSection(\'section-presence\')">' +
      'Narrator Character Control <span class="chevron">+</span>' +
    '</button>' +
    '<div class="collapsible-body hidden">' +
      '<div class="form-group">' +
        '<label class="toggle-label">' +
          '<span>Allow narrator to add/remove supporting characters</span>' +
          '<div class="toggle' + (enabled ? ' active' : '') + '" id="w-narrator-presence"></div>' +
        '</label>' +
        '<p class="form-hint">When enabled, the narrator can bring characters into or out of the scene using [ENTER: Name] and [EXIT: Name] markers. User-selected cast members are always protected.</p>' +
      '</div>' +
      '<div id="presence-options" style="' + (enabled ? '' : 'display:none') + '">' +
        '<div class="form-group">' +
          '<label class="form-label">Character Access Mode</label>' +
          renderSegmented('w-presence-mode', [
            {label:'All Characters', value:'all'},
            {label:'Selected Only',  value:'allowlist'},
            {label:'Block Certain',  value:'blocklist'}
          ], mode) +
        '</div>' +
        charPickerHtml +
      '</div>' +
    '</div>' +
  '</div>';
}

function setupStep3Toggles() {
  var nsfw = document.getElementById('w-nsfw');
  if (nsfw) {
    nsfw.onclick = function () { nsfw.classList.toggle('active'); };
  }

  var presenceToggle = document.getElementById('w-narrator-presence');
  if (presenceToggle) {
    presenceToggle.onclick = function () {
      presenceToggle.classList.toggle('active');
      var opts = document.getElementById('presence-options');
      if (opts) opts.style.display = presenceToggle.classList.contains('active') ? '' : 'none';
    };
  }

  var presenceModeGroup = document.getElementById('w-presence-mode');
  if (presenceModeGroup) {
    function onPresenceModeChange() {
      var activeModeBtn = presenceModeGroup.querySelector('.seg-btn.active');
      var currentMode = activeModeBtn ? activeModeBtn.dataset.value : 'all';
      var picker = document.getElementById('narrator-presence-picker');
      var hint   = document.getElementById('presence-picker-hint');
      if (picker) picker.style.display = currentMode === 'all' ? 'none' : '';
      if (hint) hint.textContent = currentMode === 'allowlist' ? 'Check characters the narrator may add:' : 'Check characters to block:';
    }
    presenceModeGroup.querySelectorAll('.seg-btn').forEach(function (btn) {
      var orig = btn.onclick;
      btn.onclick = function () { if (orig) orig.call(btn); onPresenceModeChange(); };
    });
    onPresenceModeChange();
  }
}

window._toggleSection = function (id) {
  var section = document.getElementById(id);
  if (!section) return;
  var body    = section.querySelector('.collapsible-body');
  var chevron = section.querySelector('.chevron');
  var open    = !body.classList.contains('hidden');
  body.classList.toggle('hidden', open);
  if (chevron) chevron.textContent = open ? '+' : '-';
};

function collectStep3() {
  function segVal(id) {
    var a = document.querySelector('#' + id + ' .seg-btn.active');
    return a ? a.dataset.value : null;
  }
  var d = state.wizardData;

  // Segmented buttons already return null when missing — || preserves existing value
  d.reply_length       = segVal('w-reply-length')  || d.reply_length;
  d.explicitness_level = segVal('w-explicitness')  || d.explicitness_level;
  d.pacing             = segVal('w-pacing')        || d.pacing;
  d.narrative_pov      = segVal('w-pov')           || d.narrative_pov;
  d.violence_level     = segVal('w-violence')      || d.violence_level;

  // For plain inputs and toggles: only write if the element is present in the DOM
  var lustEl = document.getElementById('w-lust-level');
  if (lustEl) d.lust_level = Number(lustEl.value);

  var toneModEl = document.getElementById('w-tone-modifier');
  if (toneModEl) d.tone_modifier = toneModEl.value.trim();

  var nsfwEl = document.getElementById('w-nsfw');
  if (nsfwEl) d.nsfw_enabled = nsfwEl.classList.contains('active') ? 0 : 1;

  var presenceEl = document.getElementById('w-narrator-presence');
  if (presenceEl) d.narrator_presence_enabled = presenceEl.classList.contains('active') ? 1 : 0;

  // Only rebuild presence mode and config when the section is rendered
  var presenceModeActive = document.querySelector('#w-presence-mode .seg-btn.active');
  if (presenceModeActive) {
    d.narrator_presence_mode = presenceModeActive.dataset.value;
    var checkedIds = [];
    document.querySelectorAll('.npc-presence-check:checked').forEach(function (chk) {
      var cid = Number(chk.dataset.charId);
      if (cid) checkedIds.push(cid);
    });
    if (d.narrator_presence_mode === 'allowlist') {
      d.narrator_presence_config = JSON.stringify({ allowed: checkedIds });
    } else if (d.narrator_presence_mode === 'blocklist') {
      d.narrator_presence_config = JSON.stringify({ blocked: checkedIds });
    } else {
      d.narrator_presence_config = null;
    }
  }
}

function submitWizard() {
  var btn = document.getElementById('btn-wizard-next');
  setLoading(btn, true, 'Saving...');
  var data = Object.assign({}, state.wizardData);
  if (!data.title) { showToast('Title is required.', 'error'); setLoading(btn, false); return; }

  var promise;
  if (state.editingScenarioId) {
    promise = API.updateScenario(state.editingScenarioId, data).then(function () {
      return state.editingScenarioId;
    });
  } else {
    promise = API.createScenario(data).then(function (created) {
      return created.id;
    });
  }

  promise.then(function (sid) {
    showToast(state.editingScenarioId ? 'Scenario updated!' : 'Scenario created!', 'success');
    location.hash = '#play?scenario=' + sid;
  }).catch(function (e) {
    showToast('Failed to save: ' + e.message, 'error');
    var b = document.getElementById('btn-wizard-next');
    if (b) setLoading(b, false);
  });
}
