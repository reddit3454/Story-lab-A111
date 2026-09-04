import { state, fontPrefs, textPrefs, chatColors, npcColors, getNpcColor, saveTextPrefs, saveChatColors, saveNpcColors } from '../state.js';
import { escapeHtml } from '../utils.js';
import { showToast, showConfirm, setLoading, statusDotsHtml } from '../ui.js';
import { TEXT_PREF_DEFAULTS, CHAT_COLOR_DEFAULTS } from '../constants.js';
import { buildLookPayload, addLoraRow, removeLoraRow } from '../look-editor-form.js';

var _lookEditorState = null; // { loras: [], testResults: [], scratchFilenames: Set }
var _a1111Catalog = null;    // { models, vaes, loras, samplers, schedulers } — fetched once per editor open

// ---------------------------------------------------------------------------
// Tool-capable Ollama models
// Match by model name prefix so any quant variant of a known-tool model
// gets the tag automatically.  Names are lowercased before comparison.
// ---------------------------------------------------------------------------
var TOOL_CAPABLE_PREFIXES = [
  'phi4-mini',
  'qwen2.5',          // all qwen2.5 variants (instruct, coder, etc.)
  'qwen3',            // qwen3 and qwen3.5 base models (not custom uncensored fine-tunes)
  'hermes3',
  'llama3.1',
  'llama3.2',
  'dolphin3',
  'mistral:instruct',
  'mistral:7b-instruct',
  'deepseek-r1',
  'gemma3',
  'phi4-reasoning',
];

// Exact model names that do NOT support tools even though their prefix matches above.
var TOOL_INCAPABLE_EXACT = [
  'qwen3.5-9b-hauhaucs-aggressive-q4km:latest',
  'qwen3.5-9b-uncen:latest',
  'qwen3.5-9b-q4_k_m:latest',
];

/**
 * Returns true if the Ollama model name supports tool/function calling.
 * @param {string} name - model name as returned by Ollama (e.g. "qwen2.5:7b-instruct")
 */
function modelHasTools(name) {
  if (!name) return false;
  var lower = name.toLowerCase();
  if (TOOL_INCAPABLE_EXACT.indexOf(lower) !== -1) return false;
  for (var i = 0; i < TOOL_CAPABLE_PREFIXES.length; i++) {
    if (lower.startsWith(TOOL_CAPABLE_PREFIXES[i].toLowerCase())) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Model path history (localStorage, per role, most-recently-used first)
// ---------------------------------------------------------------------------
var PATH_HISTORY_KEY = 'story-lab-llamacpp-path-history';

// Paths verified on disk 2026-09-01. Mag-Mell + Violet-Lotus live on J:\ now
// (moved off H:\ in the H->J model migration); the rest are still on H:\.
var KNOWN_LLAMACPP_MODELS = [
  { label: 'MN-Violet-Lotus-12B Q4_K_M',                       path: 'J:\\Models\\violet_lotus\\MN-Violet-Lotus-12B.Q4_K_M.gguf' },
  { label: 'MN-12B-Mag-Mell-R1 Q4_K_M',                       path: 'J:\\Models\\MN-12B-Mag-Mell-R1\\MN-12B-Mag-Mell-R1-Q4_K_M.gguf' },
  { label: 'MN-12B-Mag-Mell-R1 F16',                           path: 'J:\\Models\\MN-12B-Mag-Mell-R1\\MN-12B-Mag-Mell-R1-F16.gguf' },
  { label: 'Qwen3.5-9B-Uncensored HauhauCS Aggressive Q4_K_M', path: 'H:\\Models\\Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M\\Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf' },
  { label: 'dolphin-2.9.3-mistral-nemo-12b Q4_K_M',            path: 'H:\\Models\\dolphin-2.9.3-mistral-nemo-12b\\dolphin-2.9.3-mistral-nemo-12b.Q4_K_M.gguf' },
  { label: 'gemma-4-E4B-it Uncensored Q4_K_M',                 path: 'H:\\Models\\gemma-4-E4B-it-uncensored-Q4_K_M\\gemma-4-E4B-it-uncensored-Q4_K_M.gguf' },
];

function getPathHistory() {
  try { return JSON.parse(localStorage.getItem(PATH_HISTORY_KEY) || '{}'); }
  catch (_) { return {}; }
}
function savePathHistory(history) {
  localStorage.setItem(PATH_HISTORY_KEY, JSON.stringify(history));
}
function pushPathHistory(role, path) {
  if (!path || !path.trim()) return;
  var history = getPathHistory();
  var list = (history[role] || []).filter(function (p) { return p !== path; });
  list.unshift(path);
  history[role] = list.slice(0, 10);
  savePathHistory(history);
}

function renderModelCombobox(role, currentValue, historyList) {
  var knownItems = KNOWN_LLAMACPP_MODELS.map(function (m) {
    return '<div class="model-combobox-item" data-value="' + escapeHtml(m.path) + '">' +
      '<span class="model-combobox-item-badge">known</span>' +
      escapeHtml(m.label) +
    '</div>';
  }).join('');
  var historyItems = historyList.length
    ? historyList.map(function (p, i) {
        return '<div class="model-combobox-item" data-value="' + escapeHtml(p) + '">' +
          (i === 0 ? '<span class="model-combobox-item-badge">recent</span>' : '') +
          escapeHtml(p) +
        '</div>';
      }).join('')
    : '';
  var items = knownItems + (historyItems ? '<div class="model-combobox-divider">Recent</div>' + historyItems : '');
  return '<div class="model-combobox">' +
    '<input type="text" class="form-input llamacpp-model-path" data-role="' + role + '" ' +
      'value="' + escapeHtml(currentValue || '') + '" ' +
      'placeholder="C:\\models\\model.gguf" autocomplete="off">' +
    '<button type="button" class="model-combobox-btn" data-role="' + role + '" title="Recent models">&#9660;</button>' +
    '<div class="model-combobox-dropdown hidden" data-role="' + role + '">' +
      items +
    '</div>' +
  '</div>';
}

function wireComboboxes(container) {
  function closeAll() {
    container.querySelectorAll('.model-combobox-dropdown').forEach(function (d) { d.classList.add('hidden'); });
  }
  container.querySelectorAll('.model-combobox-btn').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      var role = btn.dataset.role;
      var dropdown = container.querySelector('.model-combobox-dropdown[data-role="' + role + '"]');
      if (!dropdown) return;
      var isOpen = !dropdown.classList.contains('hidden');
      closeAll();
      if (!isOpen) dropdown.classList.remove('hidden');
    };
  });
  container.querySelectorAll('.model-combobox-item').forEach(function (item) {
    item.onclick = function (e) {
      e.stopPropagation();
      var dropdown = item.closest('.model-combobox-dropdown');
      var role = dropdown ? dropdown.dataset.role : null;
      if (!role) return;
      var input = container.querySelector('.llamacpp-model-path[data-role="' + role + '"]');
      if (input) input.value = item.dataset.value;
      closeAll();
    };
  });
  document.addEventListener('click', function (e) {
    if (!container.contains(e.target)) closeAll();
  });
}

// ---------------------------------------------------------------------------
// TAB DEFINITIONS
// To add a new tab: push an entry to TABS with { id, label } and add a case
// in buildTabContent() returning the HTML string for that tab's panel.
// ---------------------------------------------------------------------------
var TABS = [
  { id: 'general',         label: 'General' },
  { id: 'textfonts',       label: 'Text & Fonts' },
  { id: 'colors',          label: 'Colors' },
  { id: 'models',          label: 'Models' },
  { id: 'imagegen',        label: 'Image Generation' },
  { id: 'storydynamics',   label: 'Story Dynamics' },
  { id: 'about',           label: 'About' }
];

function buildTabContent(tabId) {
  switch (tabId) {

    // -----------------------------------------------------------------------
    case 'general':
      return '' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Service Health</h2>' +
          '<div id="health-cards" class="health-cards"><div class="loading-state">Checking services...</div></div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Global Rules</h2>' +
          '<div id="global-rules-section"><div class="loading-state">Loading...</div></div>' +
        '</div>';

    // -----------------------------------------------------------------------
    case 'textfonts':
      return '' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Fonts</h2>' +
          '<div class="font-pref-rows">' +
            '<div class="font-pref-row">' +
              '<div class="font-pref-info">' +
                '<span class="font-pref-label">Story Font</span>' +
                '<span class="font-pref-preview story-font" id="story-font-preview">' +
                  (fontPrefs.story ? escapeHtml(fontPrefs.story.family) : 'Crimson Pro (default)') +
                '</span>' +
              '</div>' +
              '<div class="font-pref-actions">' +
                '<button class="btn btn-sm btn-secondary" id="btn-pick-story-font">Change</button>' +
                (fontPrefs.story ? '<button class="btn btn-sm btn-ghost" id="btn-reset-story-font">Reset</button>' : '') +
              '</div>' +
            '</div>' +
            '<div class="font-pref-row">' +
              '<div class="font-pref-info">' +
                '<span class="font-pref-label">UI Font</span>' +
                '<span class="font-pref-preview" id="ui-font-preview" style="font-family:var(--font-ui)">' +
                  (fontPrefs.ui ? escapeHtml(fontPrefs.ui.family) : 'Inter (default)') +
                '</span>' +
              '</div>' +
              '<div class="font-pref-actions">' +
                '<button class="btn btn-sm btn-secondary" id="btn-pick-ui-font">Change</button>' +
                (fontPrefs.ui ? '<button class="btn btn-sm btn-ghost" id="btn-reset-ui-font">Reset</button>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="fontlobby-status" class="font-status-msg"></div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Text</h2>' +
          '<div class="text-setting-rows">' +
            '<div class="text-setting-row">' +
              '<div class="text-setting-header"><span class="text-setting-label">Font Size</span><span class="text-setting-value" id="ts-fontsize-val">' + textPrefs.fontSize + 'px</span></div>' +
              '<input type="range" class="text-setting-slider" id="ts-fontsize" min="14" max="28" step="1" value="' + textPrefs.fontSize + '">' +
              '<div class="text-setting-footer"><span>14px</span><button class="text-setting-reset" id="ts-fontsize-reset">Reset</button><span>28px</span></div>' +
            '</div>' +
            '<div class="text-setting-row">' +
              '<div class="text-setting-header"><span class="text-setting-label">Line Height</span><span class="text-setting-value" id="ts-lineheight-val">' + textPrefs.lineHeight.toFixed(2) + '</span></div>' +
              '<input type="range" class="text-setting-slider" id="ts-lineheight" min="1.3" max="2.2" step="0.05" value="' + textPrefs.lineHeight + '">' +
              '<div class="text-setting-footer"><span>1.30</span><button class="text-setting-reset" id="ts-lineheight-reset">Reset</button><span>2.20</span></div>' +
            '</div>' +
            '<div class="text-setting-row">' +
              '<div class="text-setting-header"><span class="text-setting-label">Letter Spacing</span><span class="text-setting-value" id="ts-letterspacing-val">' + textPrefs.letterSpacing.toFixed(2) + 'em</span></div>' +
              '<input type="range" class="text-setting-slider" id="ts-letterspacing" min="-0.02" max="0.10" step="0.01" value="' + textPrefs.letterSpacing + '">' +
              '<div class="text-setting-footer"><span>-0.02em</span><button class="text-setting-reset" id="ts-letterspacing-reset">Reset</button><span>0.10em</span></div>' +
            '</div>' +
            '<div class="text-setting-row">' +
              '<div class="text-setting-header"><span class="text-setting-label">Paragraph Spacing</span><span class="text-setting-value" id="ts-paraspace-val">' + textPrefs.paragraphSpace.toFixed(1) + 'em</span></div>' +
              '<input type="range" class="text-setting-slider" id="ts-paraspace" min="0" max="2.0" step="0.1" value="' + textPrefs.paragraphSpace + '">' +
              '<div class="text-setting-footer"><span>0em</span><button class="text-setting-reset" id="ts-paraspace-reset">Reset</button><span>2.0em</span></div>' +
            '</div>' +
            '<div class="text-setting-row">' +
              '<div class="text-setting-header"><span class="text-setting-label">Text Column Width</span><span class="text-setting-value" id="ts-maxwidth-val">' + textPrefs.maxWidth + 'px</span></div>' +
              '<input type="range" class="text-setting-slider" id="ts-maxwidth" min="480" max="960" step="20" value="' + textPrefs.maxWidth + '">' +
              '<div class="text-setting-footer"><span>480px</span><button class="text-setting-reset" id="ts-maxwidth-reset">Reset</button><span>960px</span></div>' +
            '</div>' +
          '</div>' +
        '</div>';

    // -----------------------------------------------------------------------
    case 'colors':
      return '' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Chat Text Colors</h2>' +
          '<div class="color-pref-rows">' +
            '<div class="color-pref-row">' +
              '<div class="color-pref-info">' +
                '<span class="color-pref-label">Your Text</span>' +
                '<span class="color-pref-preview" id="cc-user-preview" style="color:' + chatColors.userText + '">Sample text preview</span>' +
              '</div>' +
              '<div class="color-pref-actions">' +
                '<input type="color" id="cc-user-picker" value="' + chatColors.userText + '" class="color-picker-input">' +
                '<button class="btn btn-sm btn-ghost" id="cc-user-reset">Reset</button>' +
              '</div>' +
            '</div>' +
            '<div class="color-pref-row">' +
              '<div class="color-pref-info">' +
                '<span class="color-pref-label">Narrator Text</span>' +
                '<span class="color-pref-preview" id="cc-narrator-preview" style="color:' + chatColors.narratorText + '">Sample text preview</span>' +
              '</div>' +
              '<div class="color-pref-actions">' +
                '<input type="color" id="cc-narrator-picker" value="' + chatColors.narratorText + '" class="color-picker-input">' +
                '<button class="btn btn-sm btn-ghost" id="cc-narrator-reset">Reset</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h2 class="section-title">NPC Text Colors</h2>' +
          (function () {
            var sc = state.currentScenario;
            if (!sc) return '<p class="text-muted">Load a scenario to configure NPC colors.</p>';
            var chars = sc.characters || [];
            var ucId  = sc.user_character_id;
            var npcs  = chars.filter(function (c) { return c.id !== ucId; });
            if (!npcs.length) return '<p class="text-muted">No NPC characters in this scenario.</p>';
            return '<div class="color-pref-rows">' +
              npcs.map(function (c, i) {
                var color = getNpcColor(c.id, i);
                var cid   = 'cc-npc-' + c.id;
                return '<div class="color-pref-row">' +
                  '<div class="color-pref-info">' +
                    '<span class="color-pref-label">' + escapeHtml(c.name) + '</span>' +
                    '<span class="color-pref-preview" id="' + cid + '-preview" style="color:' + color + '">Sample text preview</span>' +
                  '</div>' +
                  '<div class="color-pref-actions">' +
                    '<input type="color" id="' + cid + '-picker" value="' + color + '" class="color-picker-input">' +
                    '<button class="btn btn-sm btn-ghost" id="' + cid + '-reset">Reset</button>' +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>';
          }()) +
        '</div>';

    // -----------------------------------------------------------------------
    case 'models':
      return '' +
        '<div class="settings-section" id="llamacpp-settings-section">' +
          '<h2 class="section-title">Model Backends</h2>' +
          '<p class="text-muted" style="margin-bottom:12px;">Narration uses the backend selected here. Scene-state extraction is configured separately under Story Dynamics so its actual runtime model is visible.</p>' +
          '<div class="settings-callout"><strong>Secondary reasoning provider</strong><span>Local Ollama is active. Codex is not yet a runnable provider; this is intentionally not a fake toggle.</span></div>' +
          '<div id="llamacpp-config-form"><div class="loading-state">Loading...</div></div>' +
        '</div>';

    // -----------------------------------------------------------------------
    case 'imagegen':
      return '' +
        '<div class="settings-section">' +
          '<h2 class="section-title">A1111 Connection</h2>' +
          '<div id="imagegen-a1111-status"><div class="loading-state">Checking...</div></div>' +
          '<div id="imagegen-connection-form"><div class="loading-state">Loading...</div></div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Performance</h2>' +
          '<p class="text-muted" style="margin-bottom:10px">Keep A1111 cold by default. Enable preloading only if a faster first image is worth its idle VRAM cost.</p>' +
          '<div id="imagegen-performance-form"><div class="loading-state">Loading...</div></div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Looks</h2>' +
          '<p class="text-muted" style="margin-bottom:10px">Exactly one Look is active at a time. A Look is the ONLY source of style (prefix, LoRAs, suffix, style negatives) — action, location, and clothing text never contribute style, only content.</p>' +
          '<div id="looks-list"><div class="loading-state">Loading...</div></div>' +
          '<button class="btn btn-primary btn-sm" id="btn-new-look" style="margin-top:10px">+ New Look</button>' +
          '<div id="look-editor" style="margin-top:16px;display:none"></div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h2 class="section-title">FaceID</h2>' +
          '<p class="text-muted" style="margin-bottom:10px">Requires the sd-webui-controlnet extension installed in A1111. Leave the model blank to disable FaceID — it is never sent with a guessed model name.</p>' +
          '<div id="faceid-config-form"><div class="loading-state">Loading...</div></div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Pose Control</h2>' +
          '<p class="text-muted" style="margin-bottom:10px">Uses prepared skeletons from the StoryLab pose library. Select only a live verified OpenPose option; leave it disabled to keep pose selection unavailable.</p>' +
          '<div id="pose-control-config-form"><div class="loading-state">Loading...</div></div>' +
        '</div>';

    // -----------------------------------------------------------------------
    case 'storydynamics':
      return '' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Story Dynamics</h2>' +
          '<p class="text-muted" style="margin-bottom:12px">Mood, arousal, relationship deltas, and Play UI affordances.</p>' +
          '<div id="story-dynamics-settings"><div class="loading-state">Loading...</div></div>' +
        '</div>';

    // -----------------------------------------------------------------------
    case 'about':
      return '' +
        '<div class="settings-section">' +
          '<h2 class="section-title">About</h2>' +
          '<p class="text-muted">Story Lab v1.0.0</p>' +
          '<p class="text-muted" style="margin-top:4px">Port 4090</p>' +
        '</div>';

    default:
      return '<div class="settings-section"><p class="text-muted">No content for this tab.</p></div>';
  }
}

// ---------------------------------------------------------------------------
// Tab switching helper — call this after each render to wire the tab bar
// ---------------------------------------------------------------------------
function wireSettingsTabs(el, activeTabId) {
  var tabBtns  = el.querySelectorAll('.settings-tab-btn');
  var tabPanels = el.querySelectorAll('.settings-tab-panel');
  tabBtns.forEach(function (btn) {
    btn.onclick = function () {
      var tid = btn.dataset.tab;
      tabBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
      tabPanels.forEach(function (p) { p.style.display = p.dataset.tabPanel === tid ? '' : 'none'; });
      // Lazy-load per-tab data when switching
      if (tid === 'general')         { loadHealthCards(); loadGlobalRules(); }
      if (tid === 'models')          { loadLlamacppConfig(); }
      if (tid === 'imagegen')        { wireImageGenSettings(); }
      if (tid === 'storydynamics')   { wireStoryDynamicsSettings(); }
    };
  });
}

// ---------------------------------------------------------------------------
// Main init
// ---------------------------------------------------------------------------
export function initSettings() {
  var el = document.getElementById('view-settings');

  // Build tab bar HTML
  var tabBarHtml = '<div class="settings-tab-bar">' +
    TABS.map(function (t, i) {
      return '<button class="settings-tab-btn' + (i === 0 ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
    }).join('') +
  '</div>';

  // Build all tab panels (hidden except first)
  var panelsHtml = TABS.map(function (t, i) {
    return '<div class="settings-tab-panel" data-tab-panel="' + t.id + '" style="' + (i === 0 ? '' : 'display:none') + '">' +
      buildTabContent(t.id) +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div class="settings-page">' +
      '<div class="page-header">' +
        '<div class="header-left">' + statusDotsHtml() + '</div>' +
        '<h1 class="page-title">Settings</h1>' +
        '<a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a>' +
      '</div>' +
      '<div class="settings-tab-wrap">' +
        tabBarHtml +
        '<div class="settings-tab-content">' +
          panelsHtml +
        '</div>' +
      '</div>' +
    '</div>';

  wireSettingsTabs(el, TABS[0].id);

  // Wire font buttons
  var storyBtn      = document.getElementById('btn-pick-story-font');
  var uiBtn         = document.getElementById('btn-pick-ui-font');
  var resetStoryBtn = document.getElementById('btn-reset-story-font');
  var resetUiBtn    = document.getElementById('btn-reset-ui-font');

  if (storyBtn) storyBtn.onclick = function () { pickFont('story', '--font-story', 'story-lab-story-font'); };
  if (uiBtn)    uiBtn.onclick    = function () { pickFont('ui',    '--font-ui',    'story-lab-ui-font'); };
  if (resetStoryBtn) resetStoryBtn.onclick = function () {
    fontPrefs.story = null;
    localStorage.removeItem('story-lab-story-font');
    document.documentElement.style.removeProperty('--font-story');
    initSettings();
  };
  if (resetUiBtn) resetUiBtn.onclick = function () {
    fontPrefs.ui = null;
    localStorage.removeItem('story-lab-ui-font');
    document.documentElement.style.removeProperty('--font-ui');
    initSettings();
  };

  // Wire text sliders
  var sliderConfigs = [
    { id: 'ts-fontsize',      key: 'fontSize',       valId: 'ts-fontsize-val',      fmt: function (v) { return v + 'px'; },                     parse: parseFloat, def: TEXT_PREF_DEFAULTS.fontSize },
    { id: 'ts-lineheight',    key: 'lineHeight',     valId: 'ts-lineheight-val',    fmt: function (v) { return parseFloat(v).toFixed(2); },       parse: parseFloat, def: TEXT_PREF_DEFAULTS.lineHeight },
    { id: 'ts-letterspacing', key: 'letterSpacing',  valId: 'ts-letterspacing-val', fmt: function (v) { return parseFloat(v).toFixed(2) + 'em'; }, parse: parseFloat, def: TEXT_PREF_DEFAULTS.letterSpacing },
    { id: 'ts-paraspace',     key: 'paragraphSpace', valId: 'ts-paraspace-val',     fmt: function (v) { return parseFloat(v).toFixed(1) + 'em'; }, parse: parseFloat, def: TEXT_PREF_DEFAULTS.paragraphSpace },
    { id: 'ts-maxwidth',      key: 'maxWidth',       valId: 'ts-maxwidth-val',      fmt: function (v) { return v + 'px'; },                     parse: parseFloat, def: TEXT_PREF_DEFAULTS.maxWidth }
  ];
  sliderConfigs.forEach(function (cfg) {
    var slider   = document.getElementById(cfg.id);
    var valLabel = document.getElementById(cfg.valId);
    var resetBtn = document.getElementById(cfg.id + '-reset');
    if (slider) {
      slider.oninput = function () {
        textPrefs[cfg.key] = cfg.parse(slider.value);
        if (valLabel) valLabel.textContent = cfg.fmt(slider.value);
        saveTextPrefs();
      };
    }
    if (resetBtn) {
      resetBtn.onclick = function () {
        textPrefs[cfg.key] = cfg.def;
        if (slider)   slider.value        = cfg.def;
        if (valLabel) valLabel.textContent = cfg.fmt(cfg.def);
        saveTextPrefs();
      };
    }
  });

  // Wire NPC color pickers
  if (state.currentScenario) {
    var scChars = state.currentScenario.characters || [];
    var scUcId  = state.currentScenario.user_character_id;
    var scNpcs  = scChars.filter(function (c) { return c.id !== scUcId; });
    scNpcs.forEach(function (c, i) {
      var cid      = 'cc-npc-' + c.id;
      var picker   = document.getElementById(cid + '-picker');
      var preview  = document.getElementById(cid + '-preview');
      var resetBtn = document.getElementById(cid + '-reset');
      if (picker) {
        picker.oninput = function () {
          npcColors[String(c.id)] = picker.value;
          if (preview) preview.style.color = picker.value;
          saveNpcColors();
        };
      }
      if (resetBtn) {
        resetBtn.onclick = function () {
          delete npcColors[String(c.id)];
          var def = getNpcColor(c.id, i);
          if (picker)  picker.value        = def;
          if (preview) preview.style.color = def;
          saveNpcColors();
        };
      }
    });
  }

  // Wire chat color pickers
  var colorConfigs = [
    { pickerId: 'cc-user-picker',     previewId: 'cc-user-preview',     resetId: 'cc-user-reset',     key: 'userText',     def: CHAT_COLOR_DEFAULTS.userText },
    { pickerId: 'cc-narrator-picker', previewId: 'cc-narrator-preview', resetId: 'cc-narrator-reset', key: 'narratorText', def: CHAT_COLOR_DEFAULTS.narratorText }
  ];
  colorConfigs.forEach(function (cfg) {
    var picker   = document.getElementById(cfg.pickerId);
    var preview  = document.getElementById(cfg.previewId);
    var resetBtn = document.getElementById(cfg.resetId);
    if (picker) {
      picker.oninput = function () {
        chatColors[cfg.key] = picker.value;
        if (preview) preview.style.color = picker.value;
        saveChatColors();
      };
    }
    if (resetBtn) {
      resetBtn.onclick = function () {
        chatColors[cfg.key] = cfg.def;
        if (picker)  picker.value        = cfg.def;
        if (preview) preview.style.color = cfg.def;
        saveChatColors();
      };
    }
  });

  // Load data for the default (first) tab
  loadHealthCards();
  loadGlobalRules();
}

// ---------------------------------------------------------------------------
// Image Generation — A1111 status, Looks CRUD/activate, FaceID config
// ---------------------------------------------------------------------------
var _looksCache = [];

function wireImageGenSettings() {
  loadA1111Status();
  loadImageConnectionConfig();
  loadImagePerformanceConfig();
  loadLooksList();
  loadFaceidConfig();
  loadPoseControlConfig();

  var newLookBtn = document.getElementById('btn-new-look');
  if (newLookBtn) {
    newLookBtn.onclick = function () { showLookEditor(null); };
  }
}

function loadImageConnectionConfig() {
  var el = document.getElementById('imagegen-connection-form');
  if (!el) return;
  API.getConfig().then(function (cfg) {
    el.innerHTML =
      '<div class="settings-subsection"><h3>Connection and safety baseline</h3>' +
      '<div class="form-group"><label class="form-label">A1111 URL</label><input class="form-input" id="ig-a1111-url" value="' + escapeHtml(cfg.a1111_url || 'http://127.0.0.1:7860') + '"><div class="form-hint">The direct A1111 service used for every image request.</div></div>' +
      '<div class="form-group"><label class="form-label">Master negative prompt</label><textarea class="form-input" rows="3" id="ig-master-negative">' + escapeHtml(cfg.master_negative || '') + '</textarea><div class="form-hint">Anatomy and safety baseline only. Look-specific style negatives stay with the active Look.</div></div>' +
      '<button type="button" class="btn btn-primary btn-sm" id="ig-save-connection">Save Connection</button></div>';
    document.getElementById('ig-save-connection').onclick = function () {
      var btn = document.getElementById('ig-save-connection');
      setLoading(btn, true, 'Saving...');
      API.setConfigs({
        a1111_url: document.getElementById('ig-a1111-url').value.trim(),
        master_negative: document.getElementById('ig-master-negative').value.trim(),
      }).then(function () { showToast('Image connection saved.', 'success'); setLoading(btn, false); loadA1111Status(); })
        .catch(function (e) { showToast('Save failed: ' + e.message, 'error'); setLoading(btn, false); });
    };
  }).catch(function (e) {
    el.innerHTML = '<p class="text-muted">Could not load image connection settings: ' + escapeHtml(e.message) + '</p>';
  });
}

function loadImagePerformanceConfig() {
  var el = document.getElementById('imagegen-performance-form');
  if (!el) return;
  API.getConfig().then(function (cfg) {
    var enabled = cfg.image_warmup_enabled === true || cfg.image_warmup_enabled === 'true' || cfg.image_warmup_enabled === 1 || cfg.image_warmup_enabled === '1';
    el.innerHTML =
      '<label class="settings-toggle-row"><span><strong>Preload A1111</strong><small>Warm the image service after Story Lab starts.</small></span>' +
      '<input type="checkbox" id="ig-warmup-enabled"' + (enabled ? ' checked' : '') + '></label>' +
      '<p class="form-hint">Current default is off. Changing this applies on the next Story Lab restart.</p>' +
      '<button type="button" class="btn btn-primary btn-sm" id="ig-save-performance">Save Performance</button>';
    document.getElementById('ig-save-performance').onclick = function () {
      var btn = document.getElementById('ig-save-performance');
      setLoading(btn, true, 'Saving...');
      API.setConfig('image_warmup_enabled', document.getElementById('ig-warmup-enabled').checked ? 'true' : 'false')
        .then(function () { showToast('Image performance saved. Restart Story Lab to apply preload changes.', 'success'); setLoading(btn, false); })
        .catch(function (e) { showToast('Save failed: ' + e.message, 'error'); setLoading(btn, false); });
    };
  }).catch(function (e) {
    el.innerHTML = '<p class="text-muted">Could not load image performance settings: ' + escapeHtml(e.message) + '</p>';
  });
}

function loadA1111Status() {
  var el = document.getElementById('imagegen-a1111-status');
  if (!el) return;
  API.getHealthA1111().then(function (res) {
    if (res.ok) {
      el.innerHTML =
        '<div class="health-card">' +
          '<div class="health-card-left">' +
            '<div class="health-dot ok"></div>' +
            '<div><div class="health-card-name">A1111</div>' +
              '<div class="health-card-info">Connected — ' + escapeHtml(res.url || '') + '</div></div>' +
          '</div>' +
        '</div>';
    } else {
      el.innerHTML =
        '<div class="health-card">' +
          '<div class="health-card-left">' +
            '<div class="health-dot error"></div>' +
            '<div><div class="health-card-name">A1111</div>' +
              '<div class="health-card-info">Not reachable' + (res.error ? ' — ' + escapeHtml(res.error) : '') + '</div></div>' +
          '</div>' +
        '</div>';
    }
  }).catch(function (e) {
    el.innerHTML = '<p class="text-muted">Could not check A1111: ' + escapeHtml(e.message) + '</p>';
  });
}

function loadLooksList() {
  var el = document.getElementById('looks-list');
  if (!el) return;
  API.getLooks().then(function (looks) {
    _looksCache = Array.isArray(looks) ? looks : [];
    renderLooksList();
  }).catch(function (e) {
    el.innerHTML = '<p class="text-muted">Failed to load Looks: ' + escapeHtml(e.message) + '</p>';
  });
}

function renderLooksList() {
  var el = document.getElementById('looks-list');
  if (!el) return;
  if (!_looksCache.length) {
    el.innerHTML = '<p class="text-muted">No Looks yet. Create one below.</p>';
    return;
  }
  el.innerHTML = _looksCache.map(function (look) {
    return '<div class="loc-tab-item" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;margin-bottom:6px;background:' +
      (look.is_active ? 'var(--accent-muted,rgba(100,180,255,.15))' : 'var(--bg-card,#1e1e2e)') + ';border:1px solid ' +
      (look.is_active ? 'var(--accent,#64b4ff)' : 'var(--border,#333)') + '">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:' + (look.is_active ? '600' : '400') + '">' +
          escapeHtml(look.name) +
          (look.is_active ? ' <span style="font-size:11px;color:var(--accent,#64b4ff)">(active)</span>' : '') +
        '</div>' +
        (look.description ? '<div style="font-size:11px;color:var(--text-muted)">' + escapeHtml(look.description) + '</div>' : '') +
      '</div>' +
      (look.is_active
        ? ''
        : '<button class="btn btn-xs btn-secondary look-activate-btn" data-id="' + look.id + '">Activate</button>') +
      '<button class="btn btn-ghost btn-xs look-edit-btn" data-id="' + look.id + '">Edit</button>' +
      '<button class="btn btn-danger-ghost btn-xs look-delete-btn" data-id="' + look.id + '">Delete</button>' +
    '</div>';
  }).join('');

  el.querySelectorAll('.look-activate-btn').forEach(function (btn) {
    btn.onclick = function () {
      btn.disabled = true;
      API.activateLook(Number(btn.dataset.id))
        .then(function () { showToast('Look activated.', 'success'); loadLooksList(); })
        .catch(function (e) { showToast('Failed: ' + e.message, 'error'); btn.disabled = false; });
    };
  });
  el.querySelectorAll('.look-edit-btn').forEach(function (btn) {
    btn.onclick = function () {
      var look = _looksCache.find(function (l) { return l.id === Number(btn.dataset.id); });
      if (look) showLookEditor(look);
    };
  });
  el.querySelectorAll('.look-delete-btn').forEach(function (btn) {
    btn.onclick = function () {
      var look = _looksCache.find(function (l) { return l.id === Number(btn.dataset.id); });
      showConfirm('Delete Look', 'Delete "' + (look ? look.name : 'this Look') + '"? Images already generated with it keep their saved snapshot.', function () {
        API.deleteLook(Number(btn.dataset.id))
          .then(function () { showToast('Look deleted.', 'success'); loadLooksList(); })
          .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
      });
    };
  });
}

var SCHEDULER_FALLBACK = ['Automatic', 'Karras', 'Exponential', 'Normal', 'Simple', 'SGM Uniform'];
var RESOLUTION_PRESETS = [
  { label: '832×1216 Portrait', width: 832, height: 1216 },
  { label: '1024×1024 Square', width: 1024, height: 1024 },
  { label: '1216×832 Landscape', width: 1216, height: 832 },
];

function _cleanupLookEditorScratch() {
  if (_lookEditorState && _lookEditorState.scratchFilenames.size) {
    API.cleanupTestLookImages(Array.from(_lookEditorState.scratchFilenames)).catch(function () {});
  }
  _lookEditorState = null;
}

function showLookEditor(look) {
  var editorEl = document.getElementById('look-editor');
  if (!editorEl) return;
  var isNew = !look;
  var l = look || {};

  _lookEditorState = {
    loras: (function () {
      try { return JSON.parse(l.loras_json || '[]'); } catch (_) { return []; }
    })(),
    testResults: [],
    scratchFilenames: new Set(),
  };

  editorEl.style.display = '';
  editorEl.innerHTML = '<div class="loading-state">Loading A1111 catalog...</div>';

  Promise.all([
    API.getA1111Models().catch(function () { return { ok: false, models: [] }; }),
    API.getA1111Vaes().catch(function () { return { ok: false, vaes: [] }; }),
    API.getA1111Loras().catch(function () { return { ok: false, loras: [] }; }),
    API.getA1111Samplers().catch(function () { return { ok: false, samplers: [] }; }),
    API.getA1111Schedulers().catch(function () { return { ok: false, schedulers: [] }; }),
  ]).then(function (results) {
    _a1111Catalog = {
      models: results[0].models || [],
      vaes: results[1].vaes || [],
      loras: results[2].loras || [],
      samplers: results[3].samplers || [],
      schedulers: (results[4].schedulers && results[4].schedulers.length) ? results[4].schedulers : SCHEDULER_FALLBACK,
    };
    _renderLookEditor(editorEl, look, isNew);
  });
}

function _optionsHtml(values, current, blankLabel) {
  var html = '';
  if (blankLabel) html += '<option value=""' + (!current ? ' selected' : '') + '>' + blankLabel + '</option>';
  html += values.map(function (v) {
    var value = typeof v === 'string' ? v : (v.title || v.model_name || v.name);
    var label = typeof v === 'string' ? v : (v.title || v.model_name || v.name);
    return '<option value="' + escapeHtml(value) + '"' + (current === value ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
  }).join('');
  return html;
}

function _renderLoraRows() {
  return _lookEditorState.loras.map(function (lora, i) {
    return '<div class="lora-row" data-idx="' + i + '" style="display:grid;grid-template-columns:1fr 90px 32px;gap:8px;margin-bottom:6px">' +
      '<select class="form-input le-lora-file" data-idx="' + i + '">' +
        _optionsHtml(_a1111Catalog.loras.map(function (x) { return x.name; }), lora.file, '-- select LoRA --') +
      '</select>' +
      '<input type="number" step="0.05" min="0" max="2" class="form-input le-lora-strength" data-idx="' + i + '" value="' + (lora.strength != null ? lora.strength : 1.0) + '">' +
      '<button type="button" class="btn btn-ghost btn-xs le-lora-remove" data-idx="' + i + '" title="Remove">✕</button>' +
    '</div>';
  }).join('');
}

function _renderTestResults() {
  if (!_lookEditorState.testResults.length) return '<p class="text-muted" style="font-size:12px">No test images generated yet this session.</p>';
  return _lookEditorState.testResults.map(function (r, i) {
    return '<div class="test-result-card" data-idx="' + i + '" style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:10px">' +
      '<img src="' + r.url + '" style="width:100%;display:block">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:11px;color:var(--text-muted)">' +
        '<span>seed ' + r.seed + ' • ' + Math.round(r.generation_time_ms / 100) / 10 + 's</span>' +
        (r.saved ? '<span style="margin-left:auto">Saved</span>' :
          '<button type="button" class="btn btn-xs btn-secondary le-test-save" data-idx="' + i + '" style="margin-left:auto">Save</button>' +
          '<button type="button" class="btn btn-danger-ghost btn-xs le-test-delete" data-idx="' + i + '">Delete</button>') +
      '</div>' +
    '</div>';
  }).join('');
}

function _renderLookEditor(editorEl, look, isNew) {
  var l = look || {};
  var cat = _a1111Catalog;

  editorEl.innerHTML =
    '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:14px">' +
      '<h3 style="margin:0 0 12px;font-size:14px">' + (isNew ? 'New Look' : 'Edit: ' + escapeHtml(l.name || '')) + '</h3>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Model &amp; Rendering</h4>' +
      '<div class="form-group"><label class="form-label">Checkpoint</label>' +
        '<select class="form-input" id="le-checkpoint">' + _optionsHtml(cat.models, l.checkpoint || '', '-- use currently loaded --') + '</select></div>' +
      '<div class="form-group"><label class="form-label">VAE</label>' +
        '<select class="form-input" id="le-vae">' + _optionsHtml(cat.vaes.map(function (v) { return v.name; }), l.vae || '', '-- use A1111 default --') + '</select></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
        '<div class="form-group"><label class="form-label">Clip Skip <span class="form-hint">(1-12, blank = default)</span></label>' +
          '<input type="number" min="1" max="12" class="form-input" id="le-clip-skip" value="' + (l.clip_skip != null ? l.clip_skip : '') + '"></div>' +
        '<div class="form-group"><label class="form-label">Restore Faces</label>' +
          '<label style="display:flex;align-items:center;gap:6px;height:34px"><input type="checkbox" id="le-restore-faces" ' + (l.restore_faces ? 'checked' : '') + '> On</label></div>' +
        '<div class="form-group"><label class="form-label">Tiling</label>' +
          '<label style="display:flex;align-items:center;gap:6px;height:34px"><input type="checkbox" id="le-tiling" ' + (l.tiling ? 'checked' : '') + '> On</label></div>' +
      '</div>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">LoRAs</h4>' +
      '<div id="le-lora-rows">' + _renderLoraRows() + '</div>' +
      '<button type="button" class="btn btn-ghost btn-xs" id="le-lora-add">+ Add LoRA</button>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Sampling</h4>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div class="form-group"><label class="form-label">Sampler</label>' +
          '<select class="form-input" id="le-sampler">' + _optionsHtml(cat.samplers, l.sampler || 'DPM++ 2M SDE') + '</select></div>' +
        '<div class="form-group"><label class="form-label">Scheduler</label>' +
          '<select class="form-input" id="le-scheduler">' + _optionsHtml(cat.schedulers, l.scheduler || 'Karras') + '</select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div class="form-group"><label class="form-label">Steps</label>' +
          '<input type="number" class="form-input" id="le-steps" value="' + (l.steps != null ? l.steps : 30) + '"></div>' +
        '<div class="form-group"><label class="form-label">CFG</label>' +
          '<input type="number" step="0.5" class="form-input" id="le-cfg" value="' + (l.cfg != null ? l.cfg : 7) + '"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div class="form-group"><label class="form-label">Width</label>' +
          '<input type="number" class="form-input" id="le-width" value="' + (l.width != null ? l.width : 832) + '"></div>' +
        '<div class="form-group"><label class="form-label">Height</label>' +
          '<input type="number" class="form-input" id="le-height" value="' + (l.height != null ? l.height : 1216) + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:10px">' +
        RESOLUTION_PRESETS.map(function (p, i) {
          return '<button type="button" class="btn btn-ghost btn-xs le-res-preset" data-w="' + p.width + '" data-h="' + p.height + '">' + p.label + '</button>';
        }).join('') +
      '</div>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Prompt</h4>' +
      '<div class="form-group"><label class="form-label">Prompt Prefix <span class="form-hint">(style — goes first)</span></label>' +
        '<textarea class="form-input" id="le-prefix" rows="2">' + escapeHtml(l.prompt_prefix || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">Prompt Suffix <span class="form-hint">(style — goes last)</span></label>' +
        '<textarea class="form-input" id="le-suffix" rows="2">' + escapeHtml(l.prompt_suffix || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">Negative <span class="form-hint">(style only — anatomy/safety negatives are handled separately and always applied)</span></label>' +
        '<textarea class="form-input" id="le-negative" rows="2">' + escapeHtml(l.negative || '') + '</textarea></div>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Test Generation</h4>' +
      '<div class="form-group"><label class="form-label">Test Subject</label>' +
        '<input type="text" class="form-input" id="le-test-subject" value="a woman standing in a park, full body"></div>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="le-test-generate" style="margin-bottom:10px">Generate Test Image</button>' +
      '<div id="le-test-results">' + _renderTestResults() + '</div>' +

      '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-muted)">Save as Look</h4>' +
      '<div class="form-group"><label class="form-label">Name</label>' +
        '<input type="text" class="form-input" id="le-name" value="' + escapeHtml(l.name || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">Description</label>' +
        '<input type="text" class="form-input" id="le-description" value="' + escapeHtml(l.description || '') + '"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="btn btn-primary btn-sm" id="le-save">' + (isNew ? 'Create Look' : 'Save Changes') + '</button>' +
        '<button class="btn btn-ghost btn-sm" id="le-cancel">Cancel</button>' +
      '</div>' +
    '</div>';

  _wireLookEditorEvents(editorEl, look, isNew);
}

function _collectDraftFields() {
  return {
    name: document.getElementById('le-name').value,
    description: document.getElementById('le-description').value.trim(),
    checkpoint: document.getElementById('le-checkpoint').value,
    vae: document.getElementById('le-vae').value,
    clip_skip: document.getElementById('le-clip-skip').value,
    restore_faces: document.getElementById('le-restore-faces').checked,
    tiling: document.getElementById('le-tiling').checked,
    loras: _lookEditorState.loras,
    prompt_prefix: document.getElementById('le-prefix').value.trim(),
    prompt_suffix: document.getElementById('le-suffix').value.trim(),
    negative: document.getElementById('le-negative').value.trim(),
    sampler: document.getElementById('le-sampler').value,
    scheduler: document.getElementById('le-scheduler').value,
    steps: document.getElementById('le-steps').value,
    cfg: document.getElementById('le-cfg').value,
    width: document.getElementById('le-width').value,
    height: document.getElementById('le-height').value,
  };
}

function _wireLookEditorEvents(editorEl, look, isNew) {
  editorEl.querySelectorAll('.le-lora-file').forEach(function (sel) {
    sel.onchange = function () { _lookEditorState.loras[Number(sel.dataset.idx)].file = sel.value; };
  });
  editorEl.querySelectorAll('.le-lora-strength').forEach(function (inp) {
    inp.onchange = function () { _lookEditorState.loras[Number(inp.dataset.idx)].strength = Number(inp.value) || 1.0; };
  });
  editorEl.querySelectorAll('.le-lora-remove').forEach(function (btn) {
    btn.onclick = function () {
      _lookEditorState.loras = removeLoraRow(_lookEditorState.loras, Number(btn.dataset.idx));
      document.getElementById('le-lora-rows').innerHTML = _renderLoraRows();
      _wireLookEditorEvents(editorEl, look, isNew);
    };
  });
  document.getElementById('le-lora-add').onclick = function () {
    _lookEditorState.loras = addLoraRow(_lookEditorState.loras);
    document.getElementById('le-lora-rows').innerHTML = _renderLoraRows();
    _wireLookEditorEvents(editorEl, look, isNew);
  };

  editorEl.querySelectorAll('.le-res-preset').forEach(function (btn) {
    btn.onclick = function () {
      document.getElementById('le-width').value = btn.dataset.w;
      document.getElementById('le-height').value = btn.dataset.h;
    };
  });

  document.getElementById('le-test-generate').onclick = function () {
    var btn = document.getElementById('le-test-generate');
    var draft = _collectDraftFields();
    draft.test_subject = document.getElementById('le-test-subject').value.trim();
    setLoading(btn, true, 'Generating...');
    API.testGenerateLook(draft).then(function (result) {
      setLoading(btn, false);
      if (!result.ok) { showToast('Test generation failed: ' + (result.error || 'unknown error'), 'error'); return; }
      _lookEditorState.scratchFilenames.add(result.filename);
      _lookEditorState.testResults.unshift({ url: result.url, filename: result.filename, seed: result.seed, generation_time_ms: result.generation_time_ms, saved: false });
      if (_lookEditorState.testResults.length > 12) _lookEditorState.testResults.length = 12;
      document.getElementById('le-test-results').innerHTML = _renderTestResults();
      _wireTestResultButtons(editorEl);
    }).catch(function (e) {
      setLoading(btn, false);
      showToast('Test generation failed: ' + e.message, 'error');
    });
  };
  _wireTestResultButtons(editorEl);

  document.getElementById('le-cancel').onclick = function () {
    _cleanupLookEditorScratch();
    editorEl.style.display = 'none';
    editorEl.innerHTML = '';
  };

  document.getElementById('le-save').onclick = function () {
    var saveBtn = document.getElementById('le-save');
    var payload = buildLookPayload(_collectDraftFields());
    if (!payload.ok) { showToast(payload.error, 'error'); return; }
    delete payload.ok;

    setLoading(saveBtn, true, 'Saving...');
    var promise = isNew ? API.createLook(payload) : API.updateLook(look.id, payload);
    promise.then(function () {
      showToast(isNew ? 'Look created.' : 'Look saved.', 'success');
      _lookEditorState.scratchFilenames.clear(); // saved images (if any) were kept via Save; the rest is abandoned scratch
      _cleanupLookEditorScratch();
      editorEl.style.display = 'none';
      editorEl.innerHTML = '';
      loadLooksList();
    }).catch(function (e) {
      showToast('Save failed: ' + e.message, 'error');
      setLoading(saveBtn, false);
    });
  };
}

function _wireTestResultButtons(editorEl) {
  editorEl.querySelectorAll('.le-test-save').forEach(function (btn) {
    btn.onclick = function () {
      var idx = Number(btn.dataset.idx);
      var result = _lookEditorState.testResults[idx];
      if (!result || result.saved) return;
      btn.disabled = true;
      API.saveTestLookImage(result.filename).then(function () {
        result.saved = true;
        _lookEditorState.scratchFilenames.delete(result.filename);
        btn.textContent = 'Saved';
        showToast('Image saved.', 'success');
      }).catch(function (e) {
        btn.disabled = false;
        showToast('Save failed: ' + e.message, 'error');
      });
    };
  });
  editorEl.querySelectorAll('.le-test-delete').forEach(function (btn) {
    btn.onclick = function () {
      var idx = Number(btn.dataset.idx);
      var result = _lookEditorState.testResults[idx];
      if (!result || result.saved || !_lookEditorState.scratchFilenames.has(result.filename)) return;
      btn.disabled = true;
      API.cleanupTestLookImages([result.filename]).then(function () {
        _lookEditorState.scratchFilenames.delete(result.filename);
        _lookEditorState.testResults.splice(idx, 1);
        document.getElementById('le-test-results').innerHTML = _renderTestResults();
        _wireTestResultButtons(editorEl);
        showToast('Test image deleted.', 'info');
      }).catch(function (e) {
        btn.disabled = false;
        showToast('Delete failed: ' + e.message, 'error');
      });
    };
  });
}

// ControlNet weight guard, mirrors the clamp the image pipeline applies
// server-side (0-2, the range the A1111 ControlNet UI allows). Blank or
// non-numeric input falls back to the supplied default.
function _clampCnWeight(raw, fallback) {
  var n = Number(raw);
  if (!isFinite(n)) return fallback;
  return Math.min(2, Math.max(0, Math.round(n * 100) / 100));
}

function loadFaceidConfig() {
  var el = document.getElementById('faceid-config-form');
  if (!el) return;
  Promise.all([API.getConfig(), API.getA1111FaceIdOptions()]).then(function (results) {
    var cfg = results[0];
    var options = results[1].options || [];
    var savedModel = cfg.a1111_faceid_model || '';
    var savedModule = cfg.a1111_faceid_module || '';
    var savedWeight = _clampCnWeight(cfg.a1111_faceid_weight, 0.6);
    var savedOption = options.find(function (option) {
      return option.model === savedModel && option.module === savedModule;
    });
    var modelOptions = '<option value="">Disabled (do not attach FaceID)</option>' + options.map(function (option) {
      return '<option value="' + escapeHtml(option.model) + '"' + (savedOption && savedOption.model === option.model ? ' selected' : '') + '>' +
        escapeHtml(option.label + ' - ' + option.model) + '</option>';
    }).join('');
    var warning = '';
    if (savedModel && !savedOption) {
      warning = '<p class="form-hint" style="color:var(--warning,#d9a441)">The saved FaceID pair is not in the active A1111 verified catalog. It has not been changed; choose a listed pair and save to replace it.</p>';
    }
    if (!options.length) {
      warning = '<p class="form-hint" style="color:var(--warning,#d9a441)">A1111 reported no installed verified SDXL FaceID pairs. FaceID can remain disabled until one is available.</p>';
    }
    el.innerHTML =
      '<div class="form-group"><label class="form-label">ControlNet FaceID model <span class="form-hint">(verified from the running A1111 ControlNet catalog)</span></label>' +
        '<select class="form-input" id="fc-model">' + modelOptions + '</select></div>' +
      '<div class="form-group"><label class="form-label">Preprocessor module <span class="form-hint">(locked to the selected compatible model)</span></label>' +
        '<select class="form-input" id="fc-module" disabled></select></div>' +
      '<div class="form-group"><label class="form-label">FaceID weight <span class="form-hint">(0-2, default 0.6 — higher locks identity harder, lower blends more with the prompt)</span></label>' +
        '<input class="form-input" id="fc-weight" type="number" min="0" max="2" step="0.05" value="' + escapeHtml(String(savedWeight)) + '"></div>' +
      warning +
      '<button type="button" class="btn btn-primary btn-sm" id="fc-save">Save FaceID Config</button>';

    var modelEl = document.getElementById('fc-model');
    var moduleEl = document.getElementById('fc-module');
    function syncModule() {
      var selected = options.find(function (option) { return option.model === modelEl.value; });
      var module = selected ? selected.module : '';
      moduleEl.innerHTML = '<option value="' + escapeHtml(module) + '">' + escapeHtml(module || 'No module (FaceID disabled)') + '</option>';
    }
    modelEl.onchange = syncModule;
    syncModule();

    document.getElementById('fc-save').onclick = function () {
      var btn = document.getElementById('fc-save');
      var weightEl = document.getElementById('fc-weight');
      setLoading(btn, true, 'Saving...');
      Promise.all([
        API.setA1111FaceIdConfig({ model: modelEl.value, module: moduleEl.value }),
        API.setConfig('a1111_faceid_weight', _clampCnWeight(weightEl.value, 0.6)),
      ]).then(function () {
        showToast('FaceID config saved.', 'success');
        setLoading(btn, false);
        loadFaceidConfig();
      }).catch(function (e) {
        showToast('Save failed: ' + e.message, 'error');
        setLoading(btn, false);
      });
    };
  }).catch(function (e) {
    el.innerHTML = '<p class="text-muted">Could not load the verified A1111 FaceID catalog. Existing config was not changed: ' + escapeHtml(e.message) + '</p>';
  });
}

function loadPoseControlConfig() {
  var el = document.getElementById('pose-control-config-form');
  if (!el) return;
  Promise.all([API.getConfig(), API.getA1111PoseOptions()]).then(function (results) {
    var cfg = results[0];
    var options = results[1].options || [];
    var savedModel = cfg.a1111_pose_model || '';
    var savedModule = cfg.a1111_pose_module || '';
    var savedWeight = _clampCnWeight(cfg.a1111_pose_weight, 0.75);
    var savedOption = options.find(function (option) {
      return option.model === savedModel && option.module === savedModule;
    });
    var modelOptions = '<option value="">Disabled (do not attach pose control)</option>' + options.map(function (option) {
      return '<option value="' + escapeHtml(option.model) + '"' + (savedOption && savedOption.model === option.model ? ' selected' : '') + '>' +
        escapeHtml(option.label + ' - ' + option.model) + '</option>';
    }).join('');
    var warning = '';
    if (savedModel && !savedOption) {
      warning = '<p class="form-hint" style="color:var(--warning,#d9a441)">The saved pose pair is not in the active A1111 verified catalog. It has not been changed; choose a listed option and save to replace it.</p>';
    }
    if (!options.length) {
      warning = '<p class="form-hint" style="color:var(--warning,#d9a441)">A1111 reported no installed verified SDXL OpenPose model with the prepared-skeleton module.</p>';
    }
    el.innerHTML =
      '<div class="form-group"><label class="form-label">ControlNet pose model <span class="form-hint">(verified from the running A1111 ControlNet catalog)</span></label>' +
        '<select class="form-input" id="pc-model">' + modelOptions + '</select></div>' +
      '<div class="form-group"><label class="form-label">Preprocessor module <span class="form-hint">(prepared skeletons skip preprocessing)</span></label>' +
        '<select class="form-input" id="pc-module" disabled></select></div>' +
      '<div class="form-group"><label class="form-label">Pose weight <span class="form-hint">(0-2, default 0.75 — higher forces the skeleton harder, lower lets the prompt breathe)</span></label>' +
        '<input class="form-input" id="pc-weight" type="number" min="0" max="2" step="0.05" value="' + escapeHtml(String(savedWeight)) + '"></div>' +
      warning +
      '<button type="button" class="btn btn-primary btn-sm" id="pc-save">Save Pose Control Config</button>';

    var modelEl = document.getElementById('pc-model');
    var moduleEl = document.getElementById('pc-module');
    function syncModule() {
      var selected = options.find(function (option) { return option.model === modelEl.value; });
      var module = selected ? selected.module : '';
      moduleEl.innerHTML = '<option value="' + escapeHtml(module) + '">' + escapeHtml(module || 'No module (pose control disabled)') + '</option>';
    }
    modelEl.onchange = syncModule;
    syncModule();

    document.getElementById('pc-save').onclick = function () {
      var btn = document.getElementById('pc-save');
      var weightEl = document.getElementById('pc-weight');
      setLoading(btn, true, 'Saving...');
      Promise.all([
        API.setA1111PoseConfig({ model: modelEl.value, module: moduleEl.value }),
        API.setConfig('a1111_pose_weight', _clampCnWeight(weightEl.value, 0.75)),
      ]).then(function () {
        showToast('Pose Control config saved.', 'success');
        setLoading(btn, false);
        loadPoseControlConfig();
      }).catch(function (e) {
        showToast('Save failed: ' + e.message, 'error');
        setLoading(btn, false);
      });
    };
  }).catch(function (e) {
    el.innerHTML = '<p class="text-muted">Could not load the verified A1111 pose catalog. Existing config was not changed: ' + escapeHtml(e.message) + '</p>';
  });
}

function wireStoryDynamicsSettings() {
  var el = document.getElementById('story-dynamics-settings');
  if (!el) return;

  Promise.all([API.getConfig(), fetch('http://localhost:11434/api/tags').then(function (r) { return r.json(); }).catch(function () { return null; })]).then(function (results) {
    var cfg = results[0];
    var ollama = results[1];
    var models = ollama ? (ollama.models || []).map(function (m) { return m.name; }) : [];
    function boolChecked(key, def) {
      var v = cfg[key];
      if (v == null) return def !== false;
      return v === true || v === 'true' || v === 1 || v === '1';
    }
    var savedSceneModel = cfg.scene_state_model || '';
    var sceneOptions = '<option value="">Use built-in default (qwen2.5:7b-instruct)</option>';
    if (savedSceneModel && models.indexOf(savedSceneModel) === -1) {
      sceneOptions += '<option value="' + escapeHtml(savedSceneModel) + '" selected>Saved model unavailable: ' + escapeHtml(savedSceneModel) + '</option>';
    }
    sceneOptions += models.map(function (model) {
      return '<option value="' + escapeHtml(model) + '"' + (model === savedSceneModel ? ' selected' : '') + '>' + escapeHtml(model) + '</option>';
    }).join('');
    var modelHint = ollama
      ? 'Choose from the running Ollama catalog. The saved value is preserved if it is not currently installed.'
      : 'Ollama is offline; the saved value is preserved and cannot be replaced until its catalog is available.';
    el.innerHTML =
      '<div class="settings-subsection"><h3>Scene State</h3><p class="text-muted">After a narrator turn, a secondary model extracts structured mood, arousal, clothing, and scene changes. This work is queued so it does not hold up the reply.</p>' +
      '<label class="settings-toggle-row"><span><strong>Enable scene-state extraction</strong><small>Turn it off to skip secondary extraction calls.</small></span><input type="checkbox" id="sd-scene-state-enabled"' + (boolChecked('scene_state_enabled', true) ? ' checked' : '') + '></label>' +
      '<div class="form-group"><label class="form-label">Scene-state model</label><select class="form-input" id="sd-scene-state-model"' + (ollama ? '' : ' disabled') + '>' + sceneOptions + '</select><div class="form-hint">' + modelHint + '</div></div>' +
      '<div class="form-group"><label class="form-label">Model residency</label><select class="form-input" id="sd-scene-state-keep-alive"><option value="0"' + (cfg.scene_state_keep_alive === '0' ? ' selected' : '') + '>Unload after each extraction (lowest VRAM)</option><option value="5m"' + (cfg.scene_state_keep_alive !== '0' ? ' selected' : '') + '>Keep loaded for 5 minutes (faster follow-up)</option></select></div></div>' +
      '<div class="settings-subsection"><h3>Story behavior</h3>' +
      '<div class="form-group"><label class="toggle-label"><span>NSFW enabled</span><input type="checkbox" id="sd-nsfw-enabled"' + (boolChecked('nsfw_enabled', false) ? ' checked' : '') + '></label></div>' +
      '<div class="form-group"><label class="toggle-label"><span>Explicit mode</span><input type="checkbox" id="sd-explicit-mode"' + (boolChecked('explicit_mode', false) ? ' checked' : '') + '></label></div>' +
      '<div class="form-group"><label class="toggle-label"><span>Arousal decay enabled</span><input type="checkbox" id="sd-arousal-decay"' + (boolChecked('arousal_decay_enabled', true) ? ' checked' : '') + '></label></div>' +
      '<div class="form-group"><label class="toggle-label"><span>Emotion tracking enabled</span><input type="checkbox" id="sd-emotion-tracking"' + (boolChecked('emotion_tracking_enabled', true) ? ' checked' : '') + '></label></div>' +
      '<div class="form-group"><label class="toggle-label"><span>Relationship deltas enabled</span><input type="checkbox" id="sd-rel-deltas"' + (boolChecked('relationship_deltas_enabled', true) ? ' checked' : '') + '></label></div>' +
      '<div class="form-group"><label class="toggle-label"><span>Mood gate toasts</span><input type="checkbox" id="sd-mood-gate-toasts"' + (boolChecked('mood_gate_toasts_enabled', true) ? ' checked' : '') + '></label></div>' +
      '<div class="form-group"><label class="toggle-label"><span>Regen state snapshot</span><input type="checkbox" id="sd-regen-snapshot"' + (boolChecked('regen_state_snapshot_enabled', true) ? ' checked' : '') + '></label></div>' +
      '<div class="form-group"><label class="toggle-label"><span>Cast trigger chips in Play</span><input type="checkbox" id="sd-cast-chips"' + (boolChecked('cast_trigger_chips_enabled', true) ? ' checked' : '') + '></label></div>' +
      '<div class="form-group"><label class="toggle-label"><span>Scene heat readout in Play</span><input type="checkbox" id="sd-scene-heat"' + (boolChecked('scene_heat_readout_enabled', true) ? ' checked' : '') + '></label></div>' +
      '<div class="form-group"><label class="form-label">SFW arousal ceiling (1-5)</label><input type="number" min="1" max="5" class="form-input" id="sd-sfw-ceiling" value="' + (cfg.sfw_arousal_ceiling != null ? cfg.sfw_arousal_ceiling : 3) + '"></div></div>' +
      '<button type="button" class="btn btn-primary btn-sm" id="sd-save-all">Save Story Dynamics</button>';

    var saveAll = document.getElementById('sd-save-all');
    if (saveAll) saveAll.onclick = function () {
      API.setConfigs({
        nsfw_enabled: document.getElementById('sd-nsfw-enabled').checked ? 'true' : 'false',
        explicit_mode: document.getElementById('sd-explicit-mode').checked ? 'true' : 'false',
        arousal_decay_enabled: document.getElementById('sd-arousal-decay').checked ? 'true' : 'false',
        emotion_tracking_enabled: document.getElementById('sd-emotion-tracking').checked ? 'true' : 'false',
        relationship_deltas_enabled: document.getElementById('sd-rel-deltas').checked ? 'true' : 'false',
        mood_gate_toasts_enabled: document.getElementById('sd-mood-gate-toasts').checked ? 'true' : 'false',
        regen_state_snapshot_enabled: document.getElementById('sd-regen-snapshot').checked ? 'true' : 'false',
        cast_trigger_chips_enabled: document.getElementById('sd-cast-chips').checked ? 'true' : 'false',
        scene_heat_readout_enabled: document.getElementById('sd-scene-heat').checked ? 'true' : 'false',
        sfw_arousal_ceiling: String(document.getElementById('sd-sfw-ceiling').value || 3),
        scene_state_enabled: document.getElementById('sd-scene-state-enabled').checked ? 'true' : 'false',
        scene_state_model: document.getElementById('sd-scene-state-model').value,
        scene_state_keep_alive: document.getElementById('sd-scene-state-keep-alive').value,
      }).then(function () { showToast('Story Dynamics saved', 'success'); }).catch(function (e) { showToast(e.message, 'error'); });
    };
  }).catch(function (e) {
    el.innerHTML = '<p class="text-muted">Could not load settings: ' + escapeHtml(e.message) + '</p>';
  });
}

// ---------------------------------------------------------------------------
// Health Cards
// ---------------------------------------------------------------------------
function loadHealthCards() {
  var container = document.getElementById('health-cards');
  if (!container) return;

  var checks = [
    { name: 'Story Lab', promise: API.getHealth(), url: (typeof location !== 'undefined' ? location.origin : 'http://localhost:4090') },
  ];

  var cards = checks.map(function (c) {
    return '<div class="health-card" id="health-' + c.name.replace(/\s/g,'') + '">' +
      '<div class="health-card-left">' +
        '<div class="health-dot loading" id="dot-' + c.name.replace(/\s/g,'') + '"></div>' +
        '<div>' +
          '<div class="health-card-name">' + escapeHtml(c.name) + '</div>' +
          '<div class="health-card-info" id="info-' + c.name.replace(/\s/g,'') + '">Checking...</div>' +
        '</div>' +
      '</div>' +
      '<a href="' + c.url + '" target="_blank" class="btn btn-ghost btn-xs">Open</a>' +
    '</div>';
  }).join('');

  var ollamaCard =
    '<div class="health-card">' +
      '<div class="health-card-left">' +
        '<div class="health-dot loading" id="dot-Ollama"></div>' +
        '<div>' +
          '<div class="health-card-name">Ollama</div>' +
          '<div class="health-card-info" id="info-Ollama">Checking...</div>' +
        '</div>' +
      '</div>' +
      '<a href="http://localhost:11434" target="_blank" class="btn btn-ghost btn-xs">Open</a>' +
    '</div>';

  container.innerHTML = cards + ollamaCard;

  checks.forEach(function (c) {
    var dot  = document.getElementById('dot-'  + c.name.replace(/\s/g,''));
    var info = document.getElementById('info-' + c.name.replace(/\s/g,''));
    c.promise
      .then(function (data) {
        if (dot)  { dot.classList.remove('loading'); dot.classList.add('ok'); }
        if (info) info.textContent = data.status || 'OK';
      })
      .catch(function () {
        if (dot)  { dot.classList.remove('loading'); dot.classList.add('error'); }
        if (info) info.textContent = 'Offline';
      });
  });

  // Ollama check
  fetch('http://localhost:11434/api/tags')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var dot  = document.getElementById('dot-Ollama');
      var info = document.getElementById('info-Ollama');
      var count = (data.models || []).length;
      if (dot)  { dot.classList.remove('loading'); dot.classList.add('ok'); }
      if (info) info.textContent = count + ' model' + (count !== 1 ? 's' : '') + ' loaded';
    })
    .catch(function () {
      var dot  = document.getElementById('dot-Ollama');
      var info = document.getElementById('info-Ollama');
      if (dot)  { dot.classList.remove('loading'); dot.classList.add('error'); }
      if (info) info.textContent = 'Offline';
    });
}

// ---------------------------------------------------------------------------
// Global Rules
// ---------------------------------------------------------------------------
function loadGlobalRules() {
  var container = document.getElementById('global-rules-section');
  if (!container) return;
  // Rules are scenario-scoped in this version — manage them from within each story
  container.innerHTML =
    '<p class="text-muted" style="font-size:13px">Rules are managed per-scenario. Open a scenario and use the Rules tab in the sidebar.</p>';
}
// ---------------------------------------------------------------------------
// llama.cpp config form
// ---------------------------------------------------------------------------
function loadLlamacppConfig() {
  var container = document.getElementById('llamacpp-config-form');
  if (!container) return;

  Promise.all([API.getLlamacppConfig(), API.getConfig()])
    .then(function (results) {
      var data = results[0];
      var globalConfig = results[1];
      var cfg = data || {};
      var roles = [
        { key: 'narrator',   label: 'Narrator' },
        { key: 'summarizer', label: 'Summarizer' },
        { key: 'picker',     label: 'Picker' },
        { key: 'tools',      label: 'Tools', ollamaOnly: true },
      ];

      var rows = roles.map(function (r) {
        var rc          = cfg[r.key] || {};
        var backend     = rc.backend     || 'ollama';
        var ollamaModel = rc.ollama_model || '';
        var port        = rc.port        || 8080;
        var modelPath   = rc.model_path  || '';
        var history     = getPathHistory()[r.key] || [];

        var baseStyle = 'margin-bottom:20px;padding:16px;background:var(--surface-2,var(--surface));border-radius:8px;border:1px solid var(--border)';

        if (r.ollamaOnly) {
          return '<div class="llamacpp-role-row" style="' + baseStyle + '">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
              '<strong style="font-size:14px">' + r.label + '</strong>' +
              '<div style="display:flex;gap:6px;align-items:center">' +
                '<span style="font-size:11px;color:var(--text-muted);padding:2px 8px;background:var(--bg-secondary,var(--surface));border-radius:4px;border:1px solid var(--border)">Ollama only</span>' +
                '<span style="font-size:11px;color:#fff;padding:2px 8px;background:var(--primary,#6366f1);border-radius:4px">tool-capable models only</span>' +
              '</div>' +
            '</div>' +
            '<p style="font-size:12px;color:var(--text-muted);margin:0 0 10px">Only models that support tool/function calling are shown. Models are tagged <strong>[tools]</strong> in the list.</p>' +
            '<label class="form-label">Ollama Model</label>' +
            '<div style="display:flex;gap:8px">' +
              '<select class="form-input ollama-model-select" data-role="' + r.key + '" style="flex:1">' +
                '<option value="">Loading...</option>' +
              '</select>' +
              '<input type="text" class="form-input ollama-model-custom" data-role="' + r.key + '" ' +
                'value="' + escapeHtml(ollamaModel) + '" placeholder="or type model name" style="flex:1">' +
            '</div>' +
          '</div>';
        }

        return '<div class="llamacpp-role-row" style="' + baseStyle + '">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
            '<strong style="font-size:14px">' + r.label + '</strong>' +
            '<div style="display:flex;gap:8px">' +
              '<label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer">' +
                '<input type="radio" name="backend-' + r.key + '" value="ollama" ' + (backend === 'ollama' ? 'checked' : '') + '> Ollama' +
              '</label>' +
              '<label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer">' +
                '<input type="radio" name="backend-' + r.key + '" value="llamacpp" ' + (backend === 'llamacpp' ? 'checked' : '') + '> llama.cpp' +
              '</label>' +
            '</div>' +
          '</div>' +
          '<div class="backend-panel backend-ollama-' + r.key + '" style="' + (backend !== 'ollama' ? 'display:none' : '') + '">' +
            '<label class="form-label">Ollama Model</label>' +
            '<div style="display:flex;gap:8px">' +
              '<select class="form-input ollama-model-select" data-role="' + r.key + '" style="flex:1">' +
                '<option value="">Loading...</option>' +
              '</select>' +
              '<input type="text" class="form-input ollama-model-custom" data-role="' + r.key + '" ' +
                'value="' + escapeHtml(ollamaModel) + '" placeholder="or type model name" style="flex:1">' +
            '</div>' +
          '</div>' +
          '<div class="backend-panel backend-llamacpp-' + r.key + '" style="' + (backend !== 'llamacpp' ? 'display:none' : '') + '">' +
            '<div style="display:grid;grid-template-columns:120px 1fr;gap:10px">' +
              '<div class="form-group" style="margin:0">' +
                '<label class="form-label">Port</label>' +
                '<input type="number" class="form-input llamacpp-port" data-role="' + r.key + '" value="' + port + '" min="1" max="65535">' +
              '</div>' +
              '<div class="form-group" style="margin:0">' +
                '<label class="form-label">Model Path (.gguf)</label>' +
                renderModelCombobox(r.key, modelPath, history) +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      var legacyExtractor = cfg.extractor
        ? '<div class="settings-callout settings-callout-warning"><strong>Legacy extractor setting preserved</strong><span>This saved llama.cpp role is not connected to scene-state extraction. It remains untouched; configure the actual scene-state model in Story Dynamics.</span></div>'
        : '';
      var narratorLimits =
        '<div class="settings-subsection"><h3>Narrator limits</h3>' +
        '<p class="text-muted">These apply regardless of whether narration uses Ollama or llama.cpp.</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="form-group"><label class="form-label">Output tokens</label><input type="number" min="64" class="form-input" id="model-narrator-max-tokens" value="' + escapeHtml(globalConfig.narrator_max_tokens || '1200') + '"></div>' +
        '<div class="form-group"><label class="form-label">Input context tokens</label><input type="number" min="1024" class="form-input" id="model-narrator-context-tokens" value="' + escapeHtml(globalConfig.narrator_context_tokens || '8192') + '"></div></div></div>';
      container.innerHTML = legacyExtractor + narratorLimits + rows +
        '<div style="display:flex;gap:8px;margin-top:4px">' +
          '<button class="btn btn-primary btn-sm" id="btn-save-llamacpp">Save</button>' +
          '<span id="llamacpp-save-status" style="font-size:12px;color:var(--text-muted);align-self:center"></span>' +
        '</div>';

      wireComboboxes(container);

      // Populate Ollama model dropdowns
      fetch('http://localhost:11434/api/tags')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var models = (data.models || []).map(function (m) { return m.name; });
          container.querySelectorAll('.ollama-model-select').forEach(function (sel) {
            var role = sel.dataset.role;
            var rc2  = cfg[role] || {};
            var cur  = rc2.ollama_model || '';
            var isToolsRole = role === 'tools';

            // For the tools role, only show tool-capable models.
            // For all other roles, show everything but badge tool-capable models.
            var listToShow = isToolsRole
              ? models.filter(function (m) { return modelHasTools(m); })
              : models;

            // If the currently-saved model isn't in the filtered list, include it
            // anyway so we don't silently drop existing config.
            if (cur && listToShow.indexOf(cur) === -1) {
              listToShow = [cur].concat(listToShow);
            }

            sel.innerHTML = '<option value="">' + (isToolsRole ? '-- select tool-capable model --' : '-- select --') + '</option>' +
              listToShow.map(function (m) {
                var hasTools = modelHasTools(m);
                var label = hasTools ? '[tools] ' + m : m;
                return '<option value="' + escapeHtml(m) + '"' + (m === cur ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
              }).join('');
          });
          container.querySelectorAll('.ollama-model-custom').forEach(function (inp) {
            var role = inp.dataset.role;
            var rc2  = cfg[role] || {};
            if (rc2.ollama_model && !models.includes(rc2.ollama_model)) {
              inp.value = rc2.ollama_model;
            }
          });
        })
        .catch(function () {
          container.querySelectorAll('.ollama-model-select').forEach(function (sel) {
            sel.innerHTML = '<option value="">Ollama offline</option>';
          });
        });

      // Wire backend radio toggles (skip ollamaOnly roles)
      roles.forEach(function (r) {
        if (r.ollamaOnly) return;
        var radios = container.querySelectorAll('input[name="backend-' + r.key + '"]');
        radios.forEach(function (radio) {
          radio.onchange = function () {
            var val = radio.value;
            var ollamaPanel  = container.querySelector('.backend-ollama-'  + r.key);
            var llamacppPanel = container.querySelector('.backend-llamacpp-' + r.key);
            if (ollamaPanel)   ollamaPanel.style.display  = val === 'ollama'   ? '' : 'none';
            if (llamacppPanel) llamacppPanel.style.display = val === 'llamacpp' ? '' : 'none';
          };
        });
      });

      // Save button
      var saveBtn  = document.getElementById('btn-save-llamacpp');
      var statusEl = document.getElementById('llamacpp-save-status');
      if (saveBtn) {
        saveBtn.onclick = function () {
          // Preserve unexposed legacy roles. Removing their controls must not
          // silently erase a user's saved configuration.
          var newCfg = { ...cfg };
          roles.forEach(function (r) {
            var ollamaSel    = container.querySelector('.ollama-model-select[data-role="' + r.key + '"]');
            var ollamaCustom = container.querySelector('.ollama-model-custom[data-role="' + r.key + '"]');
            var ollamaModel  = (ollamaSel && ollamaSel.value) ? ollamaSel.value : ((ollamaCustom && ollamaCustom.value) ? ollamaCustom.value.trim() : '');
            if (r.ollamaOnly) {
              newCfg[r.key] = { backend: 'ollama', ollama_model: ollamaModel };
              return;
            }
            var backendRadio = container.querySelector('input[name="backend-' + r.key + '"]:checked');
            var backend   = backendRadio ? backendRadio.value : 'ollama';
            var port      = parseInt((container.querySelector('.llamacpp-port[data-role="' + r.key + '"]') || {}).value || '8080', 10);
            var modelPath = ((container.querySelector('.llamacpp-model-path[data-role="' + r.key + '"]') || {}).value || '').trim();
            if (modelPath) pushPathHistory(r.key, modelPath);
            newCfg[r.key] = { backend: backend, port: port, model_path: modelPath, ollama_model: ollamaModel };
          });
          saveBtn.disabled = true;
          Promise.all([
            API.saveLlamacppConfig(newCfg),
            API.setConfigs({
              narrator_max_tokens: String(document.getElementById('model-narrator-max-tokens').value || 1200),
              narrator_context_tokens: String(document.getElementById('model-narrator-context-tokens').value || 8192),
            }),
          ])
            .then(function () {
              if (statusEl) { statusEl.textContent = 'Saved!'; setTimeout(function () { statusEl.textContent = ''; }, 2000); }
            })
            .catch(function (e) { if (statusEl) statusEl.textContent = 'Error: ' + e.message; })
            .finally(function () { saveBtn.disabled = false; });
        };
      }
    })
    .catch(function (e) {
      container.innerHTML = '<p class="text-muted">Failed to load config: ' + escapeHtml(e.message) + '</p>';
    });
}

// ---------------------------------------------------------------------------
// Font picker (uses FontLobby)
// ---------------------------------------------------------------------------
function pickFont(role, cssVar, storageKey) {
  import('../fontlobby.js').then(function (m) {
    m.openFontLobby(function (font) {
      if (!font) return;
      if (role === 'story') fontPrefs.story = font;
      else                  fontPrefs.ui    = font;
      document.documentElement.style.setProperty(cssVar, font.family + ', serif');
      try { localStorage.setItem(storageKey, JSON.stringify(font)); } catch (_) {}
      initSettings();
    });
  });
}
