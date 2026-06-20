import { state, fontPrefs, textPrefs, chatColors, npcColors, getNpcColor, saveTextPrefs, saveChatColors, saveNpcColors } from '../state.js';
import { escapeHtml } from '../utils.js';
import { showToast, showConfirm, setLoading, statusDotsHtml } from '../ui.js';
import { TEXT_PREF_DEFAULTS, CHAT_COLOR_DEFAULTS, IMAGE_MODELS } from '../constants.js';

var ITZ_SAMPLERS = [
  'exp_heun_2_x0','exp_heun_2_x0_cfg_pp','euler','euler_cfg_pp','euler_ancestral',
  'dpmpp_2m','dpmpp_2m_sde','dpmpp_3m_sde','dpmpp_sde','ddim','lcm','heun'
];
var ITZ_SCHEDULERS = [
  'kl_optimal','karras','exponential','sgm_uniform','simple','ddim_uniform','beta','normal'
];

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

var KNOWN_LLAMACPP_MODELS = [
  { label: 'MN-Violet-Lotus-12B Q4_K_M',                       path: 'H:\\Models\\violet_lotus\\MN-Violet-Lotus-12B.Q4_K_M.gguf' },
  { label: 'MN-12B-Mag-Mell-R1 Q4_K_M',                       path: 'H:\\Models\\MN-12B-Mag-Mell-R1\\MN-12B-Mag-Mell-R1-Q4_K_M.gguf' },
  { label: 'MN-12B-Mag-Mell-R1 F16',                           path: 'H:\\Models\\MN-12B-Mag-Mell-R1\\MN-12B-Mag-Mell-R1-F16.gguf' },
  { label: 'Qwen3.5-9B-Uncensored HauhauCS Aggressive Q4_K_M', path: 'H:\\Models\\Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M\\Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf' },
  { label: 'dolphin-2.9.3-mistral-nemo-12b Q4_K_M',            path: 'H:\\Models\\dolphin-2.9.3-mistral-nemo-12b\\dolphin-2.9.3-mistral-nemo-12b.Q4_K_M.gguf' },
  { label: 'dolphin-2.9.1-llama3-8b Q4_K_M',                  path: 'H:\\Models\\Dolphin2.9.1-llama3-8b-gguf\\dolphin-2.9.1-llama-3-8b-Q4_K_M.gguf' },
  { label: 'UC-gemma-4-E4B Uncensored Q4_K_M',                 path: 'H:\\Models\\UC-gemma-4-E4B-uncensored\\gemma-4-E4B-it-uncensored-Q4_K_M.gguf' },
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
  { id: 'imagetools',      label: 'Image Tools' },
  { id: 'imagegeneration', label: 'Image Generation' },
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
        '</div>' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Workflow &amp; Styles</h2>' +
          '<p class="text-muted" style="margin-bottom:12px">Styles control the visual look, model, and LoRA configuration used for scene images.</p>' +
          '<a href="#styles" class="btn btn-secondary btn-sm">Open Styles Editor</a>' +
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
          '<p class="text-muted" style="margin-bottom:12px;">Choose Ollama or llama.cpp independently for each role. Ollama: pick from installed models. llama.cpp: enter a port number and the .gguf path for the model loaded on that port.</p>' +
          '<div id="llamacpp-config-form"><div class="loading-state">Loading...</div></div>' +
        '</div>';

    // -----------------------------------------------------------------------
    case 'imagetools':
      return '' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Image Tools</h2>' +
          // Inner tab bar for Image Tools sub-tabs
          '<div class="itab-bar" style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:20px">' +
            '<button class="itab active" data-itab="test" style="padding:8px 16px;font-size:13px;font-weight:500;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;color:var(--text-muted)">Test Zone</button>' +
            '<button class="itab" data-itab="promptlab" style="padding:8px 16px;font-size:13px;font-weight:500;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;color:var(--text-muted)">Prompt Lab</button>' +
          '</div>' +

          // ---- Image Test panel ----
          '<div id="itab-panel-test">' +
          '<p class="text-muted" style="margin-bottom:16px">Fire test images with custom settings. Results are kept until you discard them.</p>' +
          '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">' +
            '<div class="form-group" style="margin:0"><label class="form-label">Model</label><select class="form-input" id="itz-model">' + IMAGE_MODELS.map(function(m){return '<option value="'+escapeHtml(m.value)+'">'+escapeHtml(m.label)+'</option>';}).join('') + '</select></div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">Sampler</label><select class="form-input" id="itz-sampler">' + ITZ_SAMPLERS.map(function(s){return '<option value="'+s+'"'+(s==='exp_heun_2_x0'?' selected':'')+'>'+s+'</option>';}).join('') + '</select></div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">Scheduler</label><select class="form-input" id="itz-scheduler">' + ITZ_SCHEDULERS.map(function(s){return '<option value="'+s+'"'+(s==='kl_optimal'?' selected':'')+'>'+s+'</option>';}).join('') + '</select></div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">CFG / Steps</label><div style="display:flex;gap:6px"><input class="form-input" id="itz-cfg" type="number" step="0.5" value="7.5" style="width:60px"><input class="form-input" id="itz-steps" type="number" value="30" style="width:60px"></div></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">' +
            '<div class="form-group" style="margin:0"><label class="form-label">LoRA 1</label><div style="display:flex;gap:6px"><select class="form-input itz-lora-sel" id="itz-lora1" style="flex:1"><option value="">-- none --</option></select><input class="form-input" id="itz-lora1s" type="number" step="0.05" value="1.2" style="width:60px"></div></div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">LoRA 2</label><div style="display:flex;gap:6px"><select class="form-input itz-lora-sel" id="itz-lora2" style="flex:1"><option value="">-- none --</option></select><input class="form-input" id="itz-lora2s" type="number" step="0.05" value="0.8" style="width:60px"></div></div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">LoRA 3</label><div style="display:flex;gap:6px"><select class="form-input itz-lora-sel" id="itz-lora3" style="flex:1"><option value="">-- none --</option></select><input class="form-input" id="itz-lora3s" type="number" step="0.05" value="0.65" style="width:60px"></div></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">' +
            '<div>' +
              '<h3 style="margin:0 0 10px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)">Portrait</h3>' +
              '<div class="form-group" style="margin-bottom:8px"><label class="form-label">Prompt</label><textarea class="form-input" id="itz-prompt" rows="2">beautiful woman, portrait, close-up, looking at camera</textarea></div>' +
              '<div class="form-group" style="margin-bottom:12px"><label class="form-label">Negative</label><textarea class="form-input" id="itz-negative" rows="2" placeholder="blurry, low quality..."></textarea></div>' +
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">' +
                '<button class="btn btn-primary btn-sm" id="btn-itz-fire">Fire Portrait</button>' +
                '<button class="btn btn-secondary btn-sm" id="btn-itz-save-settings">Save Settings</button>' +
                '<span id="itz-status" style="font-size:12px;color:var(--text-muted)"></span>' +
              '</div>' +
              '<div id="itz-results" style="display:flex;flex-wrap:wrap;gap:10px"></div>' +
            '</div>' +
            '<div>' +
              '<h3 style="margin:0 0 10px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)">Full Body</h3>' +
              '<div class="form-group" style="margin-bottom:8px"><label class="form-label">Prompt</label><textarea class="form-input" id="itz-fb-prompt" rows="2">beautiful woman, full body shot, standing, looking at camera</textarea></div>' +
              '<div class="form-group" style="margin-bottom:12px"><label class="form-label">Negative</label><textarea class="form-input" id="itz-fb-negative" rows="2" placeholder="blurry, low quality..."></textarea></div>' +
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">' +
                '<button class="btn btn-primary btn-sm" id="btn-itz-fb-fire">Fire Full Body</button>' +
                '<span id="itz-fb-status" style="font-size:12px;color:var(--text-muted)"></span>' +
              '</div>' +
              '<div id="itz-fb-results" style="display:flex;flex-wrap:wrap;gap:10px"></div>' +
            '</div>' +
          '</div>' +
          '<style>' +
            '.itz-shot{position:relative;display:inline-block}' +
            '.itz-shot .itz-overlay{position:absolute;top:0;left:50%;transform:translateX(-50%);display:flex;gap:6px;padding:6px;opacity:0;transition:opacity .15s;pointer-events:none}' +
            '.itz-shot:hover .itz-overlay{opacity:1;pointer-events:auto}' +
            '.itz-overlay a,.itz-overlay button{font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.65);color:#fff;cursor:pointer;text-decoration:none;white-space:nowrap;line-height:1.4}' +
            '.itab.active{color:var(--accent)!important;border-bottom-color:var(--accent)!important}' +
            '.settings-tab-bar{display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:0}' +
            '.settings-tab-btn{padding:10px 22px;font-size:13px;font-weight:500;background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;cursor:pointer;color:var(--text-muted);transition:color .15s,border-color .15s}' +
            '.settings-tab-btn:hover{color:var(--text)}' +
            '.settings-tab-btn.active{color:var(--accent);border-bottom-color:var(--accent)}' +
          '</style>' +
          '</div>' +

          // ---- Prompt Lab panel ----
          '<div id="itab-panel-promptlab" style="display:none">' +
            '<div style="margin-bottom:14px">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
                '<label class="form-label" style="margin:0">Raw Prompt</label>' +
                '<button class="btn btn-ghost btn-sm" id="pl-load-last" style="font-size:11px">Load Last Story Prompt</button>' +
              '</div>' +
              '<textarea class="form-input" id="pl-raw-prompt" rows="4" spellcheck="false" placeholder="Type or paste a raw prompt..."></textarea>' +
            '</div>' +
            '<div class="form-group" style="margin-bottom:12px">' +
              '<label class="form-label">Style Profile</label>' +
              '<select class="form-input" id="pl-style-select"><option value="">-- None --</option></select>' +
              '<p class="text-muted" style="font-size:10px;margin-top:3px">If selected, the style prefix / suffix wrap the enhanced result when sending to ComfyUI.</p>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
              '<button class="btn btn-primary btn-sm" id="pl-enhance-btn">Enhance</button>' +
              '<span id="pl-enhance-status" style="font-size:12px;color:var(--text-muted)"></span>' +
            '</div>' +
            '<div class="form-group" style="margin-bottom:12px">' +
              '<label class="form-label">Enhanced Prompt</label>' +
              '<textarea class="form-input" id="pl-enhanced" rows="6" readonly spellcheck="false" style="opacity:0.85;resize:vertical" placeholder="Enhanced result appears here..."></textarea>' +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
              '<button class="btn btn-primary btn-sm" id="pl-send-btn">Send to ComfyUI</button>' +
              '<button class="btn btn-ghost btn-sm" id="pl-save-btn">Save as Style Prefix</button>' +
            '</div>' +
            '<div id="pl-result"></div>' +
          '</div>' +
        '</div>';

    // -----------------------------------------------------------------------
    case 'imagegeneration':
      return '' +
        '<div class="settings-section">' +
          '<h2 class="section-title">Master Settings</h2>' +
          '<p class="text-muted" style="margin-bottom:20px">' +
            'Structural settings that apply to all image generation. ' +
            'These cannot be overridden by profiles. Saved immediately on change.' +
          '</p>' +
          '<div id="imggen-master"><div class="loading-state">Loading...</div></div>' +
        '</div>' +
        '<div class="settings-section" style="margin-top:24px">' +
          '<h2 class="section-title">Image Profiles</h2>' +
          '<p class="text-muted" style="margin-bottom:16px">' +
            'Profiles define optional prompt fragments and LoRA overrides. ' +
            'Activate one to apply it to all generation. Only one profile can be active at a time.' +
          '</p>' +
          '<div id="imggen-profiles"><div class="loading-state">Loading...</div></div>' +
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
      if (tid === 'imagetools')      { wireImageTools(); wirePromptLab(); }
      if (tid === 'imagegeneration') { wireMasterSettings(); wireProfiles(); }
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
// Image Tools wiring (called lazily when Image Tools tab is activated,
// and also on initial render since imagetools is not the default tab)
// ---------------------------------------------------------------------------
var _imageToolsWired = false;
function wireImageTools() {
  if (_imageToolsWired) return;
  _imageToolsWired = true;

  function g(id) { return document.getElementById(id); }

  function getSharedPayload() {
    return {
      model:          (g('itz-model').value     || '').trim() || null,
      sampler:        (g('itz-sampler').value   || '').trim(),
      scheduler:      (g('itz-scheduler').value || '').trim(),
      cfg:            Number(g('itz-cfg').value)    || 7.5,
      steps:          Number(g('itz-steps').value)  || 30,
      lora1_file:     (g('itz-lora1').value  || '').trim() || null,
      lora1_strength: Number(g('itz-lora1s').value),
      lora2_file:     (g('itz-lora2').value  || '').trim() || null,
      lora2_strength: Number(g('itz-lora2s').value),
      lora3_file:     (g('itz-lora3').value  || '').trim() || null,
      lora3_strength: Number(g('itz-lora3s').value)
    };
  }

  function shotsKey(ns) { return 'itz-shots-' + ns; }
  function loadShots(ns) { try { return JSON.parse(localStorage.getItem(shotsKey(ns)) || '[]'); } catch(e) { return []; } }
  function saveShots(ns, shots) { try { localStorage.setItem(shotsKey(ns), JSON.stringify(shots)); } catch(e) {} }

  function shotHtml(s, i, imgW) {
    return '<div class="itz-shot" style="position:relative;display:inline-block">' +
      '<img src="/story-images/' + escapeHtml(s.filename) + '" ' +
        'style="width:' + imgW + 'px;height:auto;border-radius:6px;border:2px solid ' + (i === 0 ? 'var(--accent)' : 'var(--border)') + ';cursor:zoom-in;display:block" ' +
        'title="' + escapeHtml(s.label) + '" ' +
        'onclick="(function(src){var lb=document.getElementById(\'story-lightbox\');if(lb){lb.querySelector(\'img\').src=src;lb.style.display=\'flex\';}})(this.src)">' +
      '<div class="itz-overlay">' +
        '<a href="/story-images/' + escapeHtml(s.filename) + '" download="' + escapeHtml(s.filename) + '">Save</a>' +
        '<button data-di="' + i + '" data-ns="' + s.ns + '">X</button>' +
      '</div>' +
    '</div>';
  }

  function renderShots(ns, resultsEl, imgW) {
    if (!resultsEl) return;
    var shots = loadShots(ns);
    if (!shots.length) { resultsEl.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">No shots yet.</span>'; return; }
    resultsEl.innerHTML = shots.map(function(s, i) { return shotHtml(s, i, imgW); }).join('');
    resultsEl.querySelectorAll('[data-di]').forEach(function(btn) {
      btn.onclick = function() {
        var shots = loadShots(ns);
        shots.splice(parseInt(btn.getAttribute('data-di'), 10), 1);
        saveShots(ns, shots);
        renderShots(ns, resultsEl, imgW);
      };
    });
  }

  function wirePanel(cfg) {
    var fireBtn   = g(cfg.fireId);
    var statusEl  = g(cfg.statusId);
    var resultsEl = g(cfg.resultsId);
    renderShots(cfg.ns, resultsEl, cfg.imgW);
    if (!fireBtn) return;
    fireBtn.onclick = function() {
      var payload = Object.assign(getSharedPayload(), {
        prompt:          (g(cfg.promptId).value   || '').trim() || cfg.defaultPrompt,
        negative_prompt: (g(cfg.negativeId).value || '').trim() || null,
        width:  cfg.width,
        height: cfg.height
      });
      fireBtn.disabled = true;
      fireBtn.textContent = 'Generating...';
      if (statusEl) statusEl.textContent = 'Not available in this version.';
      fireBtn.disabled = false;
      fireBtn.textContent = cfg.fireLabel;
    };
  }

  wirePanel({ ns:'portrait', fireId:'btn-itz-fire',    statusId:'itz-status',    resultsId:'itz-results',
    promptId:'itz-prompt',    negativeId:'itz-negative',    width:832,  height:1216, imgW:200,
    fireLabel:'Fire Portrait', defaultPrompt:'beautiful woman, portrait, close-up, looking at camera' });
  wirePanel({ ns:'fullbody', fireId:'btn-itz-fb-fire', statusId:'itz-fb-status', resultsId:'itz-fb-results',
    promptId:'itz-fb-prompt', negativeId:'itz-fb-negative', width:832, height:1216, imgW:400,
    fireLabel:'Fire Full Body', defaultPrompt:'beautiful woman, full body shot, standing, looking at camera' });

  // Populate LoRA dropdowns from A1111
  API.getA1111Loras().then(function(data) {
    var loras = Array.isArray(data) ? data : (data.loras || []);
    var opts = '<option value="">-- none --</option>' +
      loras.map(function(l){
        var f = typeof l === 'string' ? l : (l.name || l.filename || '');
        return '<option value="'+escapeHtml(f)+'">'+escapeHtml(f)+'</option>';
      }).join('');
    ['itz-lora1','itz-lora2','itz-lora3'].forEach(function(id){ var s=g(id); if(s) s.innerHTML=opts; });
  }).catch(function(){});

  // Save Settings button
  var saveSettingsBtn = g('btn-itz-save-settings');
  var itzStatusEl = g('itz-status');
  if (saveSettingsBtn) {
    saveSettingsBtn.onclick = function() {
      var name = prompt('Name for this style preset:');
      if (!name || !name.trim()) return;
      var data = {
        name: name.trim(),
        base_model:      (g('itz-model').value    || '').trim() || null,
        sampler:         (g('itz-sampler').value  || '').trim() || null,
        scheduler:       (g('itz-scheduler').value|| '').trim() || null,
        cfg_scale:       Number(g('itz-cfg').value)  || 7.5,
        steps:           Number(g('itz-steps').value) || 30,
        lora1_file:      (g('itz-lora1').value  || '').trim() || null,
        lora1_strength:  Number(g('itz-lora1s').value),
        lora2_file:      (g('itz-lora2').value  || '').trim() || null,
        lora2_strength:  Number(g('itz-lora2s').value),
        lora3_file:      (g('itz-lora3').value  || '').trim() || null,
        lora3_strength:  Number(g('itz-lora3s').value),
        prompt_prefix:   (g('itz-prompt').value   || '').trim() || null,
        negative_prompt: (g('itz-negative').value || '').trim() || null
      };
      if(itzStatusEl){ itzStatusEl.textContent='Style saving not available in this version.'; setTimeout(function(){ itzStatusEl.textContent=''; },3000); }
    };
  }

  // Wire inner itab bar
  var itabBar = document.querySelector('#view-settings .itab-bar');
  if (itabBar) {
    itabBar.querySelectorAll('.itab').forEach(function (btn) {
      btn.onclick = function () {
        itabBar.querySelectorAll('.itab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var tab = btn.dataset.itab;
        var panelTest = document.getElementById('itab-panel-test');
        var panelPL   = document.getElementById('itab-panel-promptlab');
        if (panelTest) panelTest.style.display = tab === 'test'      ? '' : 'none';
        if (panelPL)   panelPL.style.display   = tab === 'promptlab' ? '' : 'none';
        if (tab === 'promptlab') _plLoadStyles();
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Prompt Lab wiring (lazy, called with wireImageTools)
// ---------------------------------------------------------------------------
var _promptLabWired = false;
var _plStyles = [];

function _plGetStyle() {
  var sel = document.getElementById('pl-style-select');
  var styleId = sel ? parseInt(sel.value || '0', 10) || 0 : 0;
  return styleId ? _plStyles.find(function (s) { return s.id === styleId; }) : null;
}

function _plRenderPreview() {
  var ta = document.getElementById('pl-enhanced');
  if (!ta) return;
  var base = (ta.dataset.baseEnhanced || '').trim();
  if (!base) { ta.value = ''; return; }
  var style = _plGetStyle();
  if (!style) { ta.value = base; return; }
  var parts = [];
  if (style.prompt_prefix) parts.push(style.prompt_prefix.trim());
  parts.push(base);
  if (style.prompt_suffix) parts.push(style.prompt_suffix.trim());
  ta.value = parts.filter(Boolean).join(', ');
}

function _plLoadStyles() {
  // Styles endpoint not available in A1111 version
}

function wirePromptLab() {
  if (_promptLabWired) return;
  _promptLabWired = true;

  function g(id) { return document.getElementById(id); }

  var loadLastBtn = g('pl-load-last');
  if (loadLastBtn) {
    loadLastBtn.onclick = function () {
      var sc = state.currentScenario;
      if (!sc) { showToast('No active scenario. Open a story first.'); return; }
      showToast('Load last prompt not available in this version.');
    };
  }

  var enhanceBtn = g('pl-enhance-btn');
  if (enhanceBtn) {
    enhanceBtn.onclick = function () {
      var raw = (g('pl-raw-prompt').value || '').trim();
      if (!raw) { showToast('Enter a prompt first.'); return; }
      var statusEl = g('pl-enhance-status');
      if (statusEl) statusEl.innerHTML = 'Enhancing ' + statusDotsHtml();
      enhanceBtn.disabled = true;
      // Prompt enhancement not available in A1111 version — pass through as-is
      var ta = g('pl-enhanced');
      if (ta) { ta.dataset.baseEnhanced = raw; _plRenderPreview(); }
      if (statusEl) statusEl.innerHTML = '';
      enhanceBtn.disabled = false;
    };
  }

  var sendBtn = g('pl-send-btn');
  if (sendBtn) {
    sendBtn.onclick = function () {
      var ta = g('pl-enhanced');
      var enhanced = ta ? (ta.dataset.baseEnhanced || '').trim() : '';
      if (!enhanced) { showToast('Enhance a prompt first.'); return; }
      var style = _plGetStyle();
      var finalPrompt = ta ? (ta.value || '').trim() : enhanced;
      showToast('Send to A1111 not available from Prompt Lab in this version.');
    };
  }

  var saveBtn = g('pl-save-btn');
  if (saveBtn) {
    saveBtn.onclick = function () {
      var enhanced = (g('pl-enhanced').dataset.baseEnhanced || '').trim();
      if (!enhanced) { showToast('Nothing to save. Enhance a prompt first.'); return; }
      var name = prompt('Name for this style:');
      if (!name || !name.trim()) return;
      Promise.resolve().then(function () {
        showToast('Style saving not available in this version.');
      })
        .catch(function (e) { showToast('Save failed: ' + e.message); });
    };
  }
}

// ---------------------------------------------------------------------------
// A1111 Master Settings (replaces old Image Generation wiring)
// Loads from GET /api/config, saves via PUT /api/config/bulk
// ---------------------------------------------------------------------------
var _masterSettingsWired = false;

var A1111_SAMPLERS = [
  'Euler', 'Euler a', 'Heun', 'Heun pp2',
  'DPM2', 'DPM2 a', 'DPM++ 2S a', 'DPM++ 2M', 'DPM++ SDE', 'DPM++ 2M SDE',
  'DPM++ 2M SDE Heun', 'DPM++ 3M SDE', 'DPM fast', 'DPM adaptive',
  'LMS', 'DDIM', 'DDIM CFG++', 'PLMS', 'UniPC', 'LCM', 'DDPM', 'DEIS', 'Restart',
];
var A1111_SCHEDULERS = [
  'Automatic', 'Uniform', 'Karras', 'Exponential', 'Polyexponential',
  'SGM Uniform', 'KL Optimal', 'Align Your Steps', 'Simple', 'Normal', 'DDIM', 'Beta',
];

function wireMasterSettings() {
  if (_masterSettingsWired) return;
  _masterSettingsWired = true;

  var container = document.getElementById('imggen-master');
  if (!container) return;

  function g(id) { return document.getElementById(id); }
  function tv(id) { var el = g(id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; }

  function buildMasterForm(cfg, samplerList, schedulerList, loraList) {
    cfg = cfg || {};
    function v(key, def) { return cfg[key] != null ? cfg[key] : def; }
    function boolCfg(key, def) { var val = v(key, def); return val === true || val === 'true' || val === 1 || val === '1'; }
    function buildLoraOpts(selected) {
      return '<option value="">-- none --</option>' +
        (loraList || []).map(function (l) {
          var nm = typeof l === 'string' ? l : (l.name || l.alias || '');
          return '<option value="' + escapeHtml(nm) + '"' + (nm === (selected || '') ? ' selected' : '') + '>' + escapeHtml(nm) + '</option>';
        }).join('');
    }

    var samplerOpts = (samplerList || A1111_SAMPLERS).map(function (s) {
      return '<option value="' + escapeHtml(s) + '"' + (v('a1111_sampler','DPM++ 2M SDE') === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
    }).join('');
    var schedulerOpts = (schedulerList || A1111_SCHEDULERS).map(function (s) {
      return '<option value="' + escapeHtml(s) + '"' + (v('a1111_scheduler','Karras') === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
    }).join('');

    container.innerHTML =
      // ---- A1111 Connection ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">Connection</h3>' +
        '<div style="display:flex;gap:10px;align-items:flex-end">' +
          '<div class="form-group" style="flex:1;margin:0">' +
            '<label class="form-label">A1111 URL</label>' +
            '<input class="form-input" id="ms-url" type="text" value="' + escapeHtml(v('a1111_url','http://127.0.0.1:7860')) + '">' +
          '</div>' +
          '<button class="btn btn-secondary btn-sm" id="ms-test-conn" style="margin-bottom:0;height:36px">Test Connection</button>' +
          '<span id="ms-conn-status" style="font-size:12px;color:var(--text-muted);align-self:center"></span>' +
        '</div>' +
      '</div>' +

      // ---- Active Model ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">Model</h3>' +
        '<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">' +
          '<div style="flex:1">' +
            '<div class="form-label" style="margin-bottom:4px">Active Checkpoint</div>' +
            '<div id="ms-model-display" style="font-size:14px;font-weight:500;color:var(--text)">' + escapeHtml(v('a1111_model','(none)')) + '</div>' +
          '</div>' +
          '<button class="btn btn-secondary btn-sm" id="ms-change-model">Change Model</button>' +
        '</div>' +
        '<div id="ms-model-picker-wrap" style="display:none;margin-top:6px">' +
          '<select class="form-input" id="ms-model-select" style="width:100%;margin-bottom:8px"><option>Loading...</option></select>' +
          '<div style="display:flex;gap:8px">' +
            '<button class="btn btn-primary btn-sm" id="ms-model-set-btn">Set Model</button>' +
            '<button class="btn btn-ghost btn-sm" id="ms-model-cancel-btn">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ---- Core Params ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">Core Parameters</h3>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div class="form-group" style="margin:0">' +
            '<label class="form-label">Sampler</label>' +
            '<select class="form-input" id="ms-sampler">' + samplerOpts + '</select>' +
          '</div>' +
          '<div class="form-group" style="margin:0">' +
            '<label class="form-label">Scheduler</label>' +
            '<select class="form-input" id="ms-scheduler">' + schedulerOpts + '</select>' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">' +
          '<div class="form-group" style="margin:0"><label class="form-label">Steps</label><input class="form-input" id="ms-steps" type="number" min="1" max="150" step="1" value="' + v('a1111_steps',30) + '"></div>' +
          '<div class="form-group" style="margin:0"><label class="form-label">CFG Scale</label><input class="form-input" id="ms-cfg" type="number" min="1" max="30" step="0.5" value="' + v('a1111_cfg',7.0) + '"></div>' +
          '<div class="form-group" style="margin:0"><label class="form-label">Width</label><input class="form-input" id="ms-width" type="number" min="64" max="4096" step="8" value="' + v('a1111_width',832) + '"></div>' +
          '<div class="form-group" style="margin:0"><label class="form-label">Height</label><input class="form-input" id="ms-height" type="number" min="64" max="4096" step="8" value="' + v('a1111_height',1216) + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px">' +
          '<div class="form-group" style="margin:0"><label class="form-label">CLIP Skip</label><input class="form-input" id="ms-clip-skip" type="number" min="1" max="4" step="1" value="' + v('clip_skip',2) + '"></div>' +
          '<div class="form-group" style="margin:0"><label class="form-label">Img2Img Denoising Strength</label><input class="form-input" id="ms-img2img-denoising" type="number" min="0.1" max="1.0" step="0.05" value="' + v('img2img_denoising', 0.45) + '"><p class="form-hint" style="margin-top:4px;font-size:12px;color:var(--text-muted)">How much the image changes during img2img. Lower = subtle changes, higher = dramatic.</p></div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Global Negative Prompt</label>' +
          '<textarea class="form-input" id="ms-negative" rows="2" placeholder="lowres, bad anatomy, bad hands, blurry...">' + escapeHtml(v('a1111_negative_prompt','')) + '</textarea>' +
        '</div>' +
      '</div>' +

      // ---- Hires.fix ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">Hires.fix</h3>' +
        '<div style="margin-bottom:10px">' +
          '<label class="toggle-label">' +
            '<span>Enable Hires.fix</span>' +
            '<div class="toggle' + (boolCfg('hr_enabled', false) ? ' active' : '') + '" id="ms-hr-enabled"></div>' +
          '</label>' +
        '</div>' +
        '<div id="ms-hr-params" style="' + (boolCfg('hr_enabled', false) ? '' : 'display:none') + '">' +
          '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">' +
            '<div class="form-group" style="margin:0"><label class="form-label">Scale</label><input class="form-input" id="ms-hr-scale" type="number" min="1" max="4" step="0.1" value="' + v('hr_scale',1.5) + '"></div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">Steps</label><input class="form-input" id="ms-hr-steps" type="number" min="1" max="60" step="1" value="' + v('hr_steps',20) + '"></div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">Denoising</label><input class="form-input" id="ms-hr-denoising" type="number" min="0" max="1" step="0.05" value="' + v('hr_denoising',0.4) + '"></div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">Upscaler</label><input class="form-input" id="ms-hr-upscaler" type="text" value="' + escapeHtml(v('hr_upscaler','4x-UltraSharp')) + '"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ---- ADetailer ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">ADetailer (face fix)</h3>' +
        '<div style="margin-bottom:10px">' +
          '<label class="toggle-label">' +
            '<span>Enable ADetailer</span>' +
            '<div class="toggle' + (boolCfg('ad_enabled', true) ? ' active' : '') + '" id="ms-ad-enabled"></div>' +
          '</label>' +
        '</div>' +
        '<div id="ms-ad-params" style="' + (boolCfg('ad_enabled', true) ? '' : 'display:none') + '">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="form-group" style="margin:0"><label class="form-label">Model</label><input class="form-input" id="ms-ad-model" type="text" value="' + escapeHtml(v('ad_model','face_yolov8n.pt')) + '"></div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">Strength</label><input class="form-input" id="ms-ad-strength" type="number" min="0" max="1" step="0.05" value="' + v('ad_strength',0.4) + '"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ---- IP-Adapter ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">IP-Adapter (Face Consistency)</h3>' +
        '<div style="margin-bottom:10px">' +
          '<label class="toggle-label">' +
            '<span>Enable IP-Adapter face consistency</span>' +
            '<div class="toggle' + (boolCfg('ipadapter_enabled', false) ? ' active' : '') + '" id="ms-ipa-enabled"></div>' +
          '</label>' +
        '</div>' +
        '<div id="ms-ipa-params" style="' + (boolCfg('ipadapter_enabled', false) ? '' : 'display:none') + '">' +
          '<div class="form-group" style="margin:0 0 12px">' +
            '<label class="form-label">ControlNet model name</label>' +
            '<input class="form-input" id="ms-ipa-model" type="text" value="' + escapeHtml(v('ipadapter_model','ip-adapter-plus-face_sdxl_vit-h [andrewnuness]')) + '">' +
            '<p class="form-hint" style="margin-top:4px;font-size:12px;color:var(--color-warning,#f59e0b);font-weight:500">Must match your ControlNet model name exactly as shown in A1111\'s model list.</p>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="form-group" style="margin:0">' +
              '<label class="form-label">Influence weight <span class="form-hint">(0.35 rec.)</span></label>' +
              '<input class="form-input" id="ms-ipa-weight" type="number" min="0.1" max="0.8" step="0.05" value="' + v('ipadapter_weight', 0.35) + '">' +
            '</div>' +
            '<div class="form-group" style="margin:0">' +
              '<label class="form-label">Stop at step % <span class="form-hint">(0.6 rec.)</span></label>' +
              '<input class="form-input" id="ms-ipa-end" type="number" min="0.3" max="1.0" step="0.05" value="' + v('ipadapter_end', 0.6) + '">' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ---- Global LoRAs ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">Global LoRAs</h3>' +
        '<p style="font-size:12px;color:var(--text-muted);margin:0 0 10px">Applied on every generation unless overridden by an active profile. LoRA filenames must match exactly as listed in A1111.</p>' +
        '<div style="margin-bottom:10px">' +
          '<label class="toggle-label">' +
            '<span>Enable LoRAs in generation</span>' +
            '<div class="toggle' + (boolCfg('lora_enabled', true) ? ' active' : '') + '" id="ms-lora-enabled"></div>' +
          '</label>' +
        '</div>' +
        '<div id="ms-lora-params" style="' + (boolCfg('lora_enabled', true) ? '' : 'display:none') + '">' +
          '<div style="display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:8px">' +
            '<div class="form-group" style="margin:0"><label class="form-label">LoRA 1</label>' +
              '<select class="form-input" id="ms-lora1">' + buildLoraOpts(v('lora1_file', '')) + '</select>' +
            '</div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">Strength</label>' +
              '<input class="form-input" id="ms-lora1s" type="number" min="0" max="3" step="0.05" value="' + v('lora1_strength', 1.0) + '">' +
            '</div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 90px;gap:8px">' +
            '<div class="form-group" style="margin:0"><label class="form-label">LoRA 2</label>' +
              '<select class="form-input" id="ms-lora2">' + buildLoraOpts(v('lora2_file', '')) + '</select>' +
            '</div>' +
            '<div class="form-group" style="margin:0"><label class="form-label">Strength</label>' +
              '<input class="form-input" id="ms-lora2s" type="number" min="0" max="3" step="0.05" value="' + v('lora2_strength', 1.0) + '">' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ---- Location Background Mode ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">Location Backgrounds</h3>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label">Background mode</label>' +
          '<select class="form-input" id="ms-location-bg-mode">' +
            '<option value="image"' + (v('location_bg_mode', 'image') === 'image' ? ' selected' : '') + '>Background images (img2img)</option>' +
            '<option value="description"' + (v('location_bg_mode', 'image') === 'description' ? ' selected' : '') + '>Location description (text tags, txt2img)</option>' +
          '</select>' +
          '<p class="form-hint" style="margin-top:4px;font-size:12px;color:var(--text-muted)"><b>Background images</b>: uses pre-rendered location images as an img2img reference. <b>Location description</b>: injects the location\'s image tags into the prompt instead (txt2img).</p>' +
        '</div>' +
      '</div>' +

      // ---- Prompt Extractor ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">Prompt Extractor</h3>' +
        '<div class="form-group">' +
          '<label class="form-label">Prompt Extractor Model</label>' +
          '<input class="form-input" id="ms-extractor-model" type="text" value="' + escapeHtml(v('prompt_extractor_model', '')) + '" placeholder="e.g. llama3 — falls back to narrator model if blank">' +
          '<p class="form-hint" style="margin-top:4px;font-size:12px;color:var(--text-muted)">Reads each story paragraph and writes the Stable Diffusion image prompt. Use a small fast uncensored model (e.g. llama3, mistral, qwen2). Must be pulled in Ollama.</p>' +
        '</div>' +
      '</div>' +

      // ---- Scene Picker ----
      '<div style="margin-bottom:24px">' +
        '<h3 class="imggen-section-head">Scene Picker</h3>' +
        '<div class="form-group">' +
          '<label class="form-label">Scene Picker Model</label>' +
          '<input class="form-input" id="ms-picker-model" type="text" value="' + escapeHtml(v('picker_model', '')) + '" placeholder="e.g. llama3 — falls back to narrator model if blank">' +
          '<p class="form-hint" style="margin-top:4px;font-size:12px;color:var(--text-muted)">Model used to select the best visual moment per turn. Can be a smaller/faster model than the narrator. Leave blank to use the narrator model.</p>' +
        '</div>' +
      '</div>' +

      // ---- Save bar ----
      '<div style="display:flex;align-items:center;gap:12px;padding-top:8px;border-top:1px solid var(--border)">' +
        '<button class="btn btn-primary" id="ms-save-btn">Save Settings</button>' +
        '<button class="btn btn-ghost btn-sm" id="ms-reload-btn">Reload</button>' +
        '<span id="ms-status" style="font-size:12px;color:var(--text-muted)"></span>' +
      '</div>' +

      '<style>' +
        '.imggen-section-head{margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);border-bottom:1px solid var(--border);padding-bottom:8px}' +
      '</style>';

    // Hires toggle
    var hrToggle = g('ms-hr-enabled');
    var hrParams = g('ms-hr-params');
    if (hrToggle && hrParams) {
      hrToggle.onclick = function () {
        hrToggle.classList.toggle('active');
        hrParams.style.display = hrToggle.classList.contains('active') ? '' : 'none';
      };
    }
    // ADetailer toggle
    var adToggle = g('ms-ad-enabled');
    var adParams = g('ms-ad-params');
    if (adToggle && adParams) {
      adToggle.onclick = function () {
        adToggle.classList.toggle('active');
        adParams.style.display = adToggle.classList.contains('active') ? '' : 'none';
      };
    }
    // IP-Adapter toggle
    var ipaToggle = g('ms-ipa-enabled');
    var ipaParams = g('ms-ipa-params');
    if (ipaToggle && ipaParams) {
      ipaToggle.onclick = function () {
        ipaToggle.classList.toggle('active');
        ipaParams.style.display = ipaToggle.classList.contains('active') ? '' : 'none';
      };
    }
    // LoRA toggle
    var loraToggle = g('ms-lora-enabled');
    var loraParams = g('ms-lora-params');
    if (loraToggle && loraParams) {
      loraToggle.onclick = function () {
        loraToggle.classList.toggle('active');
        loraParams.style.display = loraToggle.classList.contains('active') ? '' : 'none';
      };
    }
    // Test connection
    var testBtn    = g('ms-test-conn');
    var connStatus = g('ms-conn-status');
    if (testBtn) {
      testBtn.onclick = function () {
        if (connStatus) connStatus.textContent = 'Testing...';
        API.getA1111Status()
          .then(function () { if (connStatus) connStatus.textContent = 'Connected'; })
          .catch(function () { if (connStatus) connStatus.textContent = 'Offline'; });
      };
    }
    // Change Model — inline dropdown picker
    var changeModelBtn   = g('ms-change-model');
    var modelPickerWrap  = g('ms-model-picker-wrap');
    var modelSelect      = g('ms-model-select');
    var modelSetBtn      = g('ms-model-set-btn');
    var modelCancelBtn   = g('ms-model-cancel-btn');

    function _closeModelPicker() {
      if (modelPickerWrap) modelPickerWrap.style.display = 'none';
      if (changeModelBtn)  changeModelBtn.textContent = 'Change Model';
    }

    if (changeModelBtn && modelPickerWrap) {
      changeModelBtn.onclick = function () {
        if (modelPickerWrap.style.display !== 'none') { _closeModelPicker(); return; }
        if (modelSelect) modelSelect.innerHTML = '<option>Loading...</option>';
        modelPickerWrap.style.display = '';
        changeModelBtn.textContent = 'Cancel';
        API.getA1111Models()
          .then(function (data) {
            var raw    = Array.isArray(data) ? data : (data.models || []);
            var models = raw.map(function (m) { return m.title || m.model_name || m; });
            if (!models.length) {
              showToast('No models returned from A1111. Is it running?', 'error');
              _closeModelPicker();
              return;
            }
            if (modelSelect) {
              modelSelect.innerHTML = models.map(function (m) {
                return '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>';
              }).join('');
              var cur = (g('ms-model-display') || {}).textContent || '';
              if (cur) modelSelect.value = cur;
            }
          })
          .catch(function (e) { showToast('Failed to load models: ' + e.message, 'error'); _closeModelPicker(); });
      };
    }

    if (modelSetBtn) {
      modelSetBtn.onclick = function () {
        var sel = g('ms-model-select');
        var selected = sel ? sel.value.trim() : '';
        if (!selected || selected === 'Loading...') return;
        modelSetBtn.disabled = true;
        modelSetBtn.textContent = 'Switching...';
        API.setA1111Model(selected)
          .then(function () {
            var display = g('ms-model-display');
            if (display) display.textContent = selected;
            showToast('Model changed to ' + selected, 'success');
            _closeModelPicker();
          })
          .catch(function (err) { showToast('Failed: ' + err.message, 'error'); })
          .finally(function () {
            var b = g('ms-model-set-btn');
            if (b) { b.disabled = false; b.textContent = 'Set Model'; }
          });
      };
    }

    if (modelCancelBtn) {
      modelCancelBtn.onclick = _closeModelPicker;
    }
    // Save
    var saveBtn  = g('ms-save-btn');
    var statusEl = g('ms-status');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var hrOn   = g('ms-hr-enabled')   && g('ms-hr-enabled').classList.contains('active')   ? 1 : 0;
        var adOn   = g('ms-ad-enabled')   && g('ms-ad-enabled').classList.contains('active')   ? 1 : 0;
        var ipaOn  = g('ms-ipa-enabled')  && g('ms-ipa-enabled').classList.contains('active')  ? 1 : 0;
        var loraOn = g('ms-lora-enabled') && g('ms-lora-enabled').classList.contains('active') ? 1 : 0;
        var map = {
          a1111_url:           (tv('ms-url') || '').trim() || 'http://127.0.0.1:7860',
          a1111_sampler:       tv('ms-sampler') || 'DPM++ 2M SDE',
          a1111_scheduler:     tv('ms-scheduler') || 'Karras',
          a1111_steps:         tv('ms-steps') || '30',
          a1111_cfg:           tv('ms-cfg') || '7.0',
          a1111_width:         tv('ms-width') || '832',
          a1111_height:        tv('ms-height') || '1216',
          clip_skip:           tv('ms-clip-skip') || '2',
          a1111_negative_prompt: (tv('ms-negative') || '').trim(),
          hr_enabled:          hrOn ? 'true' : 'false',
          hr_scale:            tv('ms-hr-scale') || '1.5',
          hr_steps:            tv('ms-hr-steps') || '20',
          hr_denoising:        tv('ms-hr-denoising') || '0.4',
          hr_upscaler:         (tv('ms-hr-upscaler') || '').trim() || '4x-UltraSharp',
          ad_enabled:             adOn ? 'true' : 'false',
          ad_model:               (tv('ms-ad-model') || '').trim() || 'face_yolov8n.pt',
          ad_strength:            tv('ms-ad-strength') || '0.4',
          ipadapter_enabled:      ipaOn ? 'true' : 'false',
          ipadapter_model:        (tv('ms-ipa-model') || '').trim() || 'ip-adapter-plus-face_sdxl_vit-h [andrewnuness]',
          ipadapter_weight:       tv('ms-ipa-weight') || '0.35',
          ipadapter_end:          tv('ms-ipa-end') || '0.6',
          prompt_extractor_model: (tv('ms-extractor-model') || '').trim(),
          picker_model:           (tv('ms-picker-model') || '').trim(),
          location_bg_mode:       tv('ms-location-bg-mode') || 'image',
          img2img_denoising:      tv('ms-img2img-denoising') || '0.45',
          lora_enabled:           loraOn ? 'true' : 'false',
          lora1_file:             (tv('ms-lora1') || '').trim(),
          lora1_strength:         tv('ms-lora1s') || '1.0',
          lora2_file:             (tv('ms-lora2') || '').trim(),
          lora2_strength:         tv('ms-lora2s') || '1.0',
        };
        saveBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Saving...';
        API.setConfigs(map)
          .then(function () {
            if (statusEl) { statusEl.textContent = 'Saved!'; setTimeout(function () { statusEl.textContent = ''; }, 2500); }
          })
          .catch(function (err) { if (statusEl) statusEl.textContent = 'Error: ' + err.message; })
          .finally(function () { saveBtn.disabled = false; });
      };
    }
    // Reload
    var reloadBtn = g('ms-reload-btn');
    if (reloadBtn) {
      reloadBtn.onclick = function () {
        container.innerHTML = '<div class="loading-state">Loading...</div>';
        _masterSettingsWired = false;
        wireMasterSettings();
      };
    }
  }

  Promise.all([
    API.getConfig(),
    API.getA1111Samplers().catch(function () { return []; }),
    API.getA1111Schedulers().catch(function () { return []; }),
    API.getA1111Loras().catch(function () { return []; }),
  ]).then(function (results) {
    var cfg        = results[0].config || results[0] || {};
    var samplers   = Array.isArray(results[1]) && results[1].length ? results[1] : null;
    var schedulers = Array.isArray(results[2]) && results[2].length ? results[2] : null;
    var loraList   = Array.isArray(results[3]) ? results[3] : [];
    buildMasterForm(cfg, samplers, schedulers, loraList);
  }).catch(function (err) {
    container.innerHTML = '<p style="color:var(--danger);font-size:13px">Failed to load config: ' + escapeHtml(err.message) + '</p>' +
      '<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="(function(){var c=document.getElementById(\'imggen-master\');if(c){c.innerHTML=\'<div class=loading-state>Loading...</div>\';_masterSettingsWired=false;wireMasterSettings();}})()">Retry</button>';
  });
}

// ---------------------------------------------------------------------------
// Image Profiles (create / activate / delete)
// ---------------------------------------------------------------------------
var _profilesWired = false;

function wireProfiles() {
  if (_profilesWired) return;
  _profilesWired = true;

  var container = document.getElementById('imggen-profiles');
  if (!container) return;

  var profiles = [];
  var editingId = null;

  function renderProfiles() {
    var active = profiles.find(function (p) { return p.is_active; });
    var listHtml = profiles.length
      ? profiles.map(function (p) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;border:1px solid var(--border);margin-bottom:8px;background:' + (p.is_active ? 'var(--accent-muted,rgba(99,102,241,.1))' : 'var(--surface)') + '">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:' + (p.is_active ? '600' : '400') + ';font-size:14px">' + escapeHtml(p.name) + (p.is_active ? ' <span style="font-size:11px;color:var(--accent)">(active)</span>' : '') + '</div>' +
              (p.description ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + escapeHtml(p.description) + '</div>' : '') +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-shrink:0">' +
              (!p.is_active ? '<button class="btn btn-secondary btn-xs profile-activate" data-id="' + p.id + '">Activate</button>' : '<button class="btn btn-ghost btn-xs profile-deactivate">Deactivate</button>') +
              '<button class="btn btn-ghost btn-xs profile-edit" data-id="' + p.id + '">Edit</button>' +
              '<button class="btn btn-ghost btn-xs profile-delete" data-id="' + p.id + '" style="color:var(--danger)">Del</button>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<p style="color:var(--text-muted);font-size:13px">No profiles yet. Create one below.</p>';

    container.innerHTML =
      '<div id="profiles-list">' + listHtml + '</div>' +
      '<button class="btn btn-secondary btn-sm" id="btn-new-profile" style="margin-top:8px">+ New Profile</button>' +
      '<div id="profile-editor" style="margin-top:16px;display:none"></div>';

    wireProfileEvents();
  }

  function wireProfileEvents() {
    var listEl = document.getElementById('profiles-list');
    if (listEl) {
      listEl.querySelectorAll('.profile-activate').forEach(function (btn) {
        btn.onclick = function () {
          API.activateProfile(Number(btn.dataset.id))
            .then(loadAndRender)
            .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
        };
      });
      var deactBtn = listEl.querySelector('.profile-deactivate');
      if (deactBtn) {
        deactBtn.onclick = function () {
          API.clearActiveProfile()
            .then(loadAndRender)
            .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
        };
      }
      listEl.querySelectorAll('.profile-edit').forEach(function (btn) {
        btn.onclick = function () {
          var p = profiles.find(function (x) { return x.id === Number(btn.dataset.id); });
          if (p) showProfileEditor(p);
        };
      });
      listEl.querySelectorAll('.profile-delete').forEach(function (btn) {
        btn.onclick = function () {
          var p = profiles.find(function (x) { return x.id === Number(btn.dataset.id); });
          if (!p || !confirm('Delete profile "' + (p.name || 'this profile') + '"?')) return;
          API.deleteProfile(p.id)
            .then(loadAndRender)
            .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
        };
      });
    }
    var newBtn = document.getElementById('btn-new-profile');
    if (newBtn) newBtn.onclick = function () { showProfileEditor(null); };
  }

  function showProfileEditor(profile) {
    var editorEl = document.getElementById('profile-editor');
    if (!editorEl) return;
    editorEl.style.display = '';
    var p = profile || {};
    editorEl.innerHTML =
      '<hr style="border:none;border-top:1px solid var(--border);margin-bottom:16px">' +
      '<h4 style="margin:0 0 14px">' + (profile ? 'Edit Profile' : 'New Profile') + '</h4>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="form-group"><label class="form-label">Name</label><input class="form-input" id="pe-name" type="text" value="' + escapeHtml(p.name || '') + '" placeholder="e.g. Cinematic"></div>' +
        '<div class="form-group"><label class="form-label">Description</label><input class="form-input" id="pe-desc" type="text" value="' + escapeHtml(p.description || '') + '"></div>' +
      '</div>' +
      '<div class="form-group"><label class="form-label">Prompt Prefix</label><textarea class="form-input" id="pe-prefix" rows="2" placeholder="masterpiece, best quality...">' + escapeHtml(p.prompt_prefix || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">Prompt Suffix</label><textarea class="form-input" id="pe-suffix" rows="2" placeholder="cinematic lighting, 8k...">' + escapeHtml(p.prompt_suffix || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">Negative Additions</label><textarea class="form-input" id="pe-negative" rows="2" placeholder="extra terms added to global negative...">' + escapeHtml(p.negative_additions || '') + '</textarea></div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:8px">' +
        '<div class="form-group" style="margin:0"><label class="form-label">LoRA 1</label><select class="form-input" id="pe-lora1"><option value="">Loading...</option></select></div>' +
        '<div class="form-group" style="margin:0;min-width:90px"><label class="form-label">Strength</label><input class="form-input" id="pe-lora1s" type="number" min="0" max="3" step="0.05" value="' + (p.lora1_strength != null ? p.lora1_strength : 0.75) + '"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:12px">' +
        '<div class="form-group" style="margin:0"><label class="form-label">LoRA 2</label><select class="form-input" id="pe-lora2"><option value="">Loading...</option></select></div>' +
        '<div class="form-group" style="margin:0;min-width:90px"><label class="form-label">Strength</label><input class="form-input" id="pe-lora2s" type="number" min="0" max="3" step="0.05" value="' + (p.lora2_strength != null ? p.lora2_strength : 0.75) + '"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
        '<div class="form-group" style="margin:0"><label class="form-label">Steps Override <span style="font-size:11px;color:var(--text-muted)">(blank = use master)</span></label><input class="form-input" id="pe-steps" type="number" min="1" max="150" step="1" value="' + (p.steps_override || '') + '" placeholder=""></div>' +
        '<div class="form-group" style="margin:0"><label class="form-label">CFG Override</label><input class="form-input" id="pe-cfg" type="number" min="1" max="30" step="0.5" value="' + (p.cfg_override || '') + '" placeholder=""></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-primary btn-sm" id="pe-save">' + (profile ? 'Save Changes' : 'Create Profile') + '</button>' +
        '<button class="btn btn-ghost btn-sm" id="pe-cancel">Cancel</button>' +
        '<span id="pe-status" style="font-size:12px;color:var(--text-muted);align-self:center"></span>' +
      '</div>';

    // Populate LoRA selects from A1111
    var _peLora1Cur = p.lora1_file || '';
    var _peLora2Cur = p.lora2_file || '';
    API.getA1111Loras().then(function (data) {
      var loras = Array.isArray(data) ? data : [];
      function makeOpts(cur) {
        return '<option value="">-- none --</option>' +
          loras.map(function (l) {
            var nm = typeof l === 'string' ? l : (l.name || l.alias || '');
            return '<option value="' + escapeHtml(nm) + '"' + (nm === cur ? ' selected' : '') + '>' + escapeHtml(nm) + '</option>';
          }).join('');
      }
      var s1 = document.getElementById('pe-lora1');
      var s2 = document.getElementById('pe-lora2');
      if (s1) s1.innerHTML = makeOpts(_peLora1Cur);
      if (s2) s2.innerHTML = makeOpts(_peLora2Cur);
    }).catch(function () {
      function offlineOpts(cur) {
        return '<option value="">-- none --</option>' +
          (cur ? '<option value="' + escapeHtml(cur) + '" selected>' + escapeHtml(cur) + '</option>' : '');
      }
      var s1 = document.getElementById('pe-lora1');
      var s2 = document.getElementById('pe-lora2');
      if (s1) s1.innerHTML = offlineOpts(_peLora1Cur);
      if (s2) s2.innerHTML = offlineOpts(_peLora2Cur);
    });

    function gv(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
    var saveBtn  = document.getElementById('pe-save');
    var statusEl = document.getElementById('pe-status');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var data = {
          name:               gv('pe-name') || 'Untitled Profile',
          description:        gv('pe-desc') || null,
          prompt_prefix:      gv('pe-prefix') || null,
          prompt_suffix:      gv('pe-suffix') || null,
          negative_additions: gv('pe-negative') || null,
          lora1_file:         gv('pe-lora1') || null,
          lora1_strength:     parseFloat(gv('pe-lora1s')) || 0.75,
          lora2_file:         gv('pe-lora2') || null,
          lora2_strength:     parseFloat(gv('pe-lora2s')) || 0.75,
          steps_override:     gv('pe-steps') ? Number(gv('pe-steps')) : null,
          cfg_override:       gv('pe-cfg')   ? parseFloat(gv('pe-cfg')) : null,
        };
        saveBtn.disabled = true;
        var promise = profile ? API.updateProfile(profile.id, data) : API.createProfile(data);
        promise
          .then(function () { editorEl.style.display = 'none'; loadAndRender(); })
          .catch(function (e) { if (statusEl) statusEl.textContent = 'Error: ' + e.message; })
          .finally(function () { saveBtn.disabled = false; });
      };
    }
    var cancelBtn = document.getElementById('pe-cancel');
    if (cancelBtn) cancelBtn.onclick = function () { editorEl.style.display = 'none'; };
  }

  function loadAndRender() {
    API.getProfiles()
      .then(function (data) {
        profiles = data.profiles || [];
        renderProfiles();
      })
      .catch(function (err) {
        container.innerHTML = '<p style="color:var(--danger);font-size:13px">Failed to load profiles: ' + escapeHtml(err.message) + '</p>';
      });
  }

  loadAndRender();
}

// ---------------------------------------------------------------------------
// Health Cards
// ---------------------------------------------------------------------------
function loadHealthCards() {
  var container = document.getElementById('health-cards');
  if (!container) return;

  var checks = [
    { name: 'Story Lab', promise: API.getHealth(), url: 'http://localhost:4090' },
    { name: 'A1111',     promise: fetch('http://127.0.0.1:7860/sdapi/v1/options').then(function (r) { if (!r.ok) throw new Error('offline'); return { status: 'OK' }; }), url: 'http://127.0.0.1:7860' },
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

  API.getLlamacppConfig()
    .then(function (data) {
      var cfg = data || {};
      var roles = [
        { key: 'narrator',   label: 'Narrator' },
        { key: 'extractor',  label: 'Extractor' },
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

      container.innerHTML = rows +
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
          var newCfg = {};
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
          API.saveLlamacppConfig(newCfg)
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
