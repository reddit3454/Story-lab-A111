import { state } from '../state.js';
import { escapeHtml, avatarHtml, traitSelect, imageSrc } from '../utils.js';
import { showToast, showConfirm, setLoading, openLightbox } from '../ui.js';
import {
  GENDER_OPTS, AGE_RANGE_OPTS, BODY_TYPE_OPTS, HEIGHT_OPTS, BUTT_SIZE_OPTS,
  BREAST_SIZE_OPTS, PENIS_STATE_OPTS, SKIN_TONE_OPTS, EYE_COLOR_OPTS, EYE_SHAPE_OPTS,
  NOSE_SHAPE_OPTS, LIP_SHAPE_OPTS, FACE_SHAPE_OPTS, HAIR_COLOR_OPTS, HAIR_STYLE_OPTS,
  OUTFIT_STYLE_OPTS
} from '../constants.js';

export function initCharacters() {
  var el = document.getElementById('view-characters');
  el.innerHTML =
    '<div class="page-header">' +
      '<div class="header-left">' +
        '<a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a>' +
      '</div>' +
      '<h1 class="page-title story-font">Characters</h1>' +
      '<div class="header-actions"></div>' +
    '</div>' +
    '<div class="characters-layout">' +
      '<div class="characters-sidebar">' +
        '<div class="char-list-header">' +
          '<h2 class="panel-title">All Characters</h2>' +
          '<button class="btn btn-primary btn-sm" id="btn-new-char">+ New</button>' +
        '</div>' +
        '<div id="char-list" class="char-list"><div class="loading-state small">Loading...</div></div>' +
        '<div style="padding:10px;border-top:1px solid var(--border);flex-shrink:0">' +
          '<button class="btn btn-ghost btn-sm" id="btn-show-relationships" style="width:100%">Relationships</button>' +
        '</div>' +
      '</div>' +
      '<div class="characters-detail" id="char-detail-panel">' +
        '<div class="empty-state"><p class="empty-state-text">Select a character to edit</p></div>' +
      '</div>' +
    '</div>';

  document.getElementById('btn-new-char').onclick = function () {
    state.currentCharacter = null;
    document.querySelectorAll('.char-list-item').forEach(function (i) { i.classList.remove('active'); });
    renderCharacterForm(null);
  };

  document.getElementById('btn-show-relationships').onclick = function () {
    document.querySelectorAll('.char-list-item').forEach(function (i) { i.classList.remove('active'); });
    renderRelationshipsPanel();
  };

  API.getCharacters().then(function (data) {
    renderCharacterList(data.characters || []);
  }).catch(function (e) {
    showToast('Failed to load characters: ' + e.message, 'error');
  });
}

function renderCharacterList(characters) {
  var list = document.getElementById('char-list');
  if (!list) return;
  if (!characters.length) {
    list.innerHTML = '<div class="empty-state small">No characters yet.</div>';
    return;
  }
  list.innerHTML = characters.map(function (c) {
    var active = state.currentCharacter && state.currentCharacter.id === c.id ? ' active' : '';
    var initial = escapeHtml((c.name || '?')[0].toUpperCase());
    var charAvatarHtml = c.reference_image_path
      ? '<div class="char-avatar char-avatar-img">' +
          '<img src="' + imageSrc(c.reference_image_path) + '" alt="" loading="lazy" ' +
            'onerror="this.parentElement.classList.remove(\'char-avatar-img\');this.parentElement.textContent=\'' + initial + '\'">' +
        '</div>'
      : '<div class="char-avatar">' + initial + '</div>';
    return '<div class="char-list-item' + active + '" data-id="' + c.id + '">' +
      charAvatarHtml +
      '<div class="char-info">' +
        '<span class="char-name">' + escapeHtml(c.name) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll('.char-list-item').forEach(function (item) {
    item.onclick = function () {
      list.querySelectorAll('.char-list-item').forEach(function (i) { i.classList.remove('active'); });
      item.classList.add('active');
      API.getCharacter(Number(item.dataset.id)).then(function (char) {
        state.currentCharacter = char;
        renderCharacterForm(char);
      }).catch(function (e) {
        showToast('Failed to load character: ' + e.message, 'error');
      });
    };
  });
}

function renderCharacterForm(char) {
  var panel = document.getElementById('char-detail-panel');
  if (!panel) return;
  var isNew = !char;
  var genderVal     = char ? (char.gender      || '')  : '';
  var hairColorVal  = char ? (char.hair_color  || '')  : '';
  var hairStyleVal  = char ? (char.hair_style  || '')  : '';
  var bodyTypeVal   = char ? (char.body_type   || '')  : '';
  var breastSizeVal = char ? (char.breast_size || '')  : '';
  var buttSizeVal   = char ? (char.butt_size    || '')  : '';
  var penisStateVal = char ? (char.penis_state  || 'soft') : 'soft';
  var heightVal= char ? (char.height      || '')  : '';
  var eyeColorVal   = char ? (char.eye_color   || '')  : '';
  var skinToneVal   = char ? (char.skin_tone   || '')  : '';
  var ageRangeVal   = char ? (char.age_range   || '')  : '';
  var eyeShapeVal   = char ? (char.eye_shape   || '')  : '';
  var noseShapeVal  = char ? (char.nose_shape  || '')  : '';
  var lipShapeVal   = char ? (char.lip_shape   || '')  : '';
  var faceShapeVal  = char ? (char.face_shape  || '')  : '';
  var hairExtrasVal = char ? (char.hair_extras || '')  : '';
  var skinExtrasVal = char ? (char.skin_extras || '')  : '';
  var outfitVal     = char ? (char.default_outfit || '') : '';
  var outfitStyleVal= char ? (char.outfit_style || '') : '';
  var imageDescriptionVal = char ? (char.image_description || '') : '';
  // Outfit sets — initialized from persisted character data, saved on form submit
  var _outfitSets = [];
  try {
    if (char && char.outfit_sets) { _outfitSets = JSON.parse(char.outfit_sets); }
    if (!Array.isArray(_outfitSets)) { _outfitSets = []; }
  } catch (_) { _outfitSets = []; }
  var _defaultOutfitName = char ? (char.default_outfit_name || null) : null;
  var _outfitSetsRaw = char ? (char.outfit_sets || '') : '';

  var gvLower = genderVal.toLowerCase();
  var showBreast = (gvLower === 'female' || gvLower === 'non-binary');
  var showPenis  = (gvLower === 'male');

  var faceIdThumb = char && char.reference_image_path
    ? '<img src="' + imageSrc(char.reference_image_path) + '" alt="FaceID reference" class="faceid-thumb" ' +
        'onerror="this.style.display=\'none\'" id="faceid-thumb-img">'
    : '<div class="empty-state small" style="padding:12px 0;text-align:left">No FaceID reference set. Accept a reference image below to activate InstantID for this character.</div>';

  var refsHtml = !isNew ? (
    '<div class="section-divider"></div>' +
    '<div class="faceid-section">' +
      '<div class="references-header">' +
        '<div>' +
          '<h3 class="section-title" style="margin-bottom:2px">FaceID Reference</h3>' +
          '<p class="form-hint" style="margin:0">Active reference used for InstantID face consistency in scene images.</p>' +
        '</div>' +
        '<div class="references-actions">' +
          (char && char.reference_image_path ? '<button class="btn btn-danger btn-sm" id="btn-faceid-remove">Remove</button>' : '') +
          '<button class="btn btn-secondary btn-sm" id="btn-faceid-upload">Upload New</button>' +
          '<input type="file" id="faceid-upload-input" accept=".jpg,.jpeg,.png,.webp" style="display:none">' +
        '</div>' +
      '</div>' +
      '<div id="faceid-display" style="margin-top:10px">' + faceIdThumb + '</div>' +
    '</div>' +
    '<div class="section-divider"></div>' +
    '<div class="references-section">' +
      '<div class="references-header">' +
        '<h3 class="section-title">Reference Images</h3>' +
        (char && char.storymaker_ready ? '<span class="badge badge-success" style="font-size:11px;margin-left:8px">StoryMaker Ready</span>' : '') +
        '<div class="references-actions">' +
          '<button class="btn btn-secondary btn-sm" id="btn-iterate-ref">Edit Prompt</button>' +
          '<button class="btn btn-secondary btn-sm" id="btn-upload-ref">Upload</button>' +
          '<input type="file" id="ref-upload-input" accept=".jpg,.jpeg,.png,.webp" style="display:none">' +
          '<button class="btn btn-primary btn-sm" id="btn-gen-ref">Generate Reference</button>' +
        '</div>' +
      '</div>' +
      '<div id="iterate-form" class="iterate-form hidden">' +
        '<textarea class="form-input" id="iterate-prompt" rows="3" placeholder="Edit generation prompt..."></textarea>' +
        '<div class="form-actions">' +
          '<button class="btn btn-ghost btn-sm" id="btn-iterate-cancel">Cancel</button>' +
          '<button class="btn btn-primary btn-sm" id="btn-iterate-submit">Generate with Prompt</button>' +
        '</div>' +
      '</div>' +
      '<div id="ref-grid" class="ref-grid"><div class="loading-state small">Loading...</div></div>' +
    '</div>' +
    '<div class="section-divider"></div>' +
    '<div class="fullbody-section">' +
      '<div class="fullbody-section-header">' +
        '<h3 class="section-title">Full Body Images</h3>' +
        '<span id="fullbody-counter" class="fullbody-counter" style="font-size:12px;color:var(--text-muted);margin-left:8px">-- / 5</span>' +
      '</div>' +
      '<div id="fullbody-grid" class="ref-grid"><div class="loading-state small">Loading...</div></div>' +
      '<div class="fullbody-generate-form">' +
        '<div class="trait-row" style="margin-bottom:8px">' +
          '<span class="trait-label">Image Style</span>' +
          '<select class="form-input trait-select" id="fullbody-style-select">' +
            '<option value="">-- None (default) --</option>' +
          '</select>' +
        '</div>' +
        '<textarea class="form-input" id="fullbody-prompt" rows="3" placeholder="Describe the character\'s appearance, outfit, style..."></textarea>' +
        '<div class="form-actions">' +
          '<button class="btn btn-primary btn-sm" id="btn-gen-fullbody">Generate Full Body</button>' +
        '</div>' +
      '</div>' +
      /* FaceID slot config: slot count dropdown + drag-to-reorder panel */
      '<div class="faceid-slot-config" style="margin-top:14px;padding:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
          '<span style="font-size:13px;font-weight:600;color:var(--text-primary)">FaceID Slots</span>' +
          '<span style="font-size:12px;color:var(--text-muted)">How many reference images ComfyUI uses (matches IPAAdapterFaceIDBatch inputcount)</span>' +
        '</div>' +
        '<div class="trait-row" style="margin-bottom:10px">' +
          '<span class="trait-label" style="min-width:80px">Slot Count</span>' +
          '<select class="form-input trait-select" id="faceid-slot-count" style="max-width:120px">' +
            '<option value="2">2 slots</option>' +
            '<option value="3">3 slots</option>' +
            '<option value="4">4 slots</option>' +
            '<option value="5" selected>5 slots (all)</option>' +
          '</select>' +
          '<button class="btn btn-secondary btn-sm" id="btn-save-slot-count" style="margin-left:8px">Save</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Drag or use arrows to set slot order. Only the top <em id="slot-count-label">5</em> will be sent to ComfyUI.</div>' +
        '<div id="faceid-slot-order" style="display:flex;flex-direction:column;gap:6px"></div>' +
      '</div>' +
    '</div>'+
    '<div class="section-divider"></div>' +
    '<div class="form-section" id="image-prompt-section">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<h3 class="section-title" style="margin:0">Image Prompt</h3>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="btn-assemble-prompt">Assemble from Traits</button>' +
      '</div>' +
      '<p class="form-hint" style="margin-bottom:8px">Permanent physical description sent to the image generator. Edit freely — this overrides the auto-assembled version.</p>' +
      '<textarea class="form-input" id="char-image-prompt-override" rows="4" placeholder="Leave blank to auto-assemble from traits each time...">' +
        escapeHtml(char ? (char.image_prompt_override || '') : '') +
      '</textarea>' +
    '</div>'
  ) : '';

  panel.innerHTML =
    '<div class="char-editor">' +
      '<div class="char-editor-header">' +
        '<h2 class="panel-title">' + (isNew ? 'New Character' : 'Edit Character') + '</h2>' +
        (!isNew ? '<button class="btn btn-danger btn-sm" id="btn-delete-char">Delete</button>' : '') +
      '</div>' +
      '<form id="char-form" class="form">' +

        // --- Basic Info ---
        '<div class="form-section">' +
          '<h3 class="section-title" style="margin-bottom:10px">Basic Info</h3>' +
          '<div class="form-group">' +
            '<label class="form-label">Name <span class="required">*</span></label>' +
            '<input type="text" class="form-input" id="char-name" value="' + escapeHtml(char ? char.name : '') + '" placeholder="Character name" required>' +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Gender</span>' +
            traitSelect('char-gender', genderVal, GENDER_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Age Range</span>' +
            traitSelect('char-age-range', ageRangeVal, AGE_RANGE_OPTS) +
          '</div>' +
        '</div>' +

        // --- Body ---
        '<div class="section-divider"></div>' +
        '<div class="form-section">' +
          '<h3 class="section-title" style="margin-bottom:10px">Body</h3>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Body Type</span>' +
            traitSelect('char-body-type', bodyTypeVal, BODY_TYPE_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Height</span>' +
            traitSelect('char-height', heightVal, HEIGHT_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Butt Size</span>' +
            traitSelect('char-butt-size', buttSizeVal, BUTT_SIZE_OPTS) +
          '</div>' +
          '<div class="trait-row" id="char-breast-size-row" style="' + (showBreast ? 'display:flex' : '') + '">' +
            '<span class="trait-label">Breast Size</span>' +
            traitSelect('char-breast-size', breastSizeVal, BREAST_SIZE_OPTS) +
          '</div>' +
          '<div class="trait-row" id="char-penis-state-row" style="' + (showPenis ? 'display:flex' : 'display:none') + '">' +
            '<span class="trait-label">Penis State (nude)</span>' +
            traitSelect('char-penis-state', penisStateVal, PENIS_STATE_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Skin Tone</span>' +
            traitSelect('char-skin-tone', skinToneVal, SKIN_TONE_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Skin Extras</span>' +
            '<input type="text" class="form-input trait-select" id="char-skin-extras" value="' + escapeHtml(skinExtrasVal) + '" placeholder="freckles, tattoos, birthmarks, tan lines">' +
          '</div>' +
        '</div>' +

        // --- Face ---
        '<div class="section-divider"></div>' +
        '<div class="form-section">' +
          '<h3 class="section-title" style="margin-bottom:10px">Face</h3>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Eye Color</span>' +
            traitSelect('char-eye-color', eyeColorVal, EYE_COLOR_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Eye Shape</span>' +
            traitSelect('char-eye-shape', eyeShapeVal, EYE_SHAPE_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Nose Shape</span>' +
            traitSelect('char-nose-shape', noseShapeVal, NOSE_SHAPE_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Lip Shape</span>' +
            traitSelect('char-lip-shape', lipShapeVal, LIP_SHAPE_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Face Shape</span>' +
            traitSelect('char-face-shape', faceShapeVal, FACE_SHAPE_OPTS) +
          '</div>' +
        '</div>' +

        // --- Hair ---
        '<div class="section-divider"></div>' +
        '<div class="form-section">' +
          '<h3 class="section-title" style="margin-bottom:10px">Hair</h3>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Hair Color</span>' +
            traitSelect('char-hair-color', hairColorVal, HAIR_COLOR_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Hair Style</span>' +
            traitSelect('char-hair-style', hairStyleVal, HAIR_STYLE_OPTS) +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Hair Extras</span>' +
            '<input type="text" class="form-input trait-select" id="char-hair-extras" value="' + escapeHtml(hairExtrasVal) + '" placeholder="messy, braided, bun on top, curly, wavy">' +
          '</div>' +
        '</div>' +

        // --- Clothing & Style ---
        '<div class="section-divider"></div>' +
        '<div class="form-section" id="outfit-section">' +
          '<h3 class="section-title" style="margin-bottom:4px">Clothing &amp; Outfit</h3>' +
          '<p class="form-hint" style="margin-bottom:12px">Build outfit presets and select which one is active. The active outfit is injected into scene image prompts.</p>' +

          // JSON Import Form
          '<div id="outfit-json-import-panel" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:12px">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
              '<span style="font-size:12px;font-weight:600;color:var(--text-muted)">&#128196; Import Outfits from JSON</span>' +
              '<button type="button" class="btn btn-ghost btn-xs" id="btn-json-import-toggle">Show</button>' +
            '</div>' +
            '<div id="outfit-json-import-body" style="display:none">' +
              '<p class="form-hint" style="margin-bottom:8px">Paste a JSON array of outfit objects. Each object needs at minimum a <code>name</code> and <code>description</code> field. Optional: <code>underwear</code> (boolean).</p>' +
              '<div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:8px;font-size:11px;color:var(--text-faint);font-family:monospace;line-height:1.5">' +
                '[<br>' +
                '&nbsp;&nbsp;{ "name": "Casual", "description": "white t-shirt, jeans", "underwear": false },<br>' +
                '&nbsp;&nbsp;{ "name": "Formal", "description": "black dress, heels", "underwear": false }<br>' +
                ']' +
              '</div>' +
              '<textarea class="form-input" id="outfit-json-import-textarea" rows="5" placeholder=\'Paste JSON array here...\' style="font-family:monospace;font-size:12px;margin-bottom:8px"></textarea>' +
              '<div id="outfit-json-import-error" style="display:none;color:var(--color-error,#c0392b);font-size:12px;margin-bottom:6px"></div>' +
              '<div style="display:flex;gap:6px">' +
                '<button type="button" class="btn btn-primary btn-xs" id="btn-outfit-json-import">Import &amp; Replace</button>' +
                '<button type="button" class="btn btn-secondary btn-xs" id="btn-outfit-json-merge">Import &amp; Merge</button>' +
                '<button type="button" class="btn btn-ghost btn-xs" id="btn-outfit-json-clear-import">Clear</button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Outfit sets builder
          '<div id="outfit-sets-panel"></div>' +

          // Default outfit name (mirrors preset selection; also directly editable)
          '<div class="form-group" style="margin-top:10px">' +
            '<label class="form-label">Default Outfit Name</label>' +
            '<input type="text" class="form-input" id="char-default-outfit-name" value="' + escapeHtml(_defaultOutfitName || '') + '" placeholder="Must match a preset name above">' +
          '</div>' +

          // Outfit sets raw JSON (synced with builder; power-user direct edit)
          '<div class="form-group" style="margin-top:6px">' +
            '<label class="form-label">Outfit Sets (JSON)</label>' +
            '<textarea class="form-input" id="char-outfit-sets-json" rows="3" placeholder="[{&quot;name&quot;:&quot;Casual&quot;,&quot;description&quot;:&quot;jeans, t-shirt&quot;}]">' + escapeHtml(_outfitSetsRaw) + '</textarea>' +
            '<p class="form-hint">JSON array of named outfits. Updated automatically by the preset builder above.</p>' +
          '</div>' +

          // Active outfit description (written to DB)
          '<div class="form-group" style="margin-top:12px">' +
            '<label class="form-label">Active Outfit Description</label>' +
            '<textarea class="form-input" id="char-default-outfit" rows="2" placeholder="spaghetti strap top, pajama shorts">' + escapeHtml(outfitVal) + '</textarea>' +
            '<p class="form-hint">This is what gets sent to the image generator. Select a preset above to fill this, or type freely.</p>' +
          '</div>' +

          // Underwear toggle
          '<div class="trait-row" style="margin-top:4px">' +
            '<span class="trait-label">Underwear Included</span>' +
            '<label class="toggle-label" style="margin:0">' +
              '<div class="toggle" id="char-outfit-underwear-toggle" title="Toggle underwear visible in image"></div>' +
            '</label>' +
          '</div>' +

          // Outfit style
          '<div class="trait-row" style="margin-top:4px">' +
            '<span class="trait-label">Style Category</span>' +
            traitSelect('char-outfit-style', outfitStyleVal, OUTFIT_STYLE_OPTS) +
          '</div>' +
        '</div>' +

        // --- Notes ---
        '<div class="section-divider"></div>' +
        '<div class="form-section">' +
          '<h3 class="section-title" style="margin-bottom:10px">Notes</h3>' +
          '<div class="form-group">' +
            '<label class="form-label">Description</label>' +
            '<textarea class="form-input" id="char-description" rows="3" placeholder="Who is this character?">' + escapeHtml(char ? (char.description || '') : '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Image Description <span class="form-hint">diffusion-facing physical description (preferred for image generation)</span></label>' +
            '<textarea class="form-input" id="char-image-description" rows="3" placeholder="Describe appearance for image generation, e.g. tall woman, long auburn hair, green eyes, athletic build...">' + escapeHtml(imageDescriptionVal) + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Appearance Notes <span class="form-hint">general appearance notes; fallback when Image Description is empty</span></label>' +
            '<textarea class="form-input" id="char-appearance-notes" rows="3" placeholder="Physical appearance details...">' + escapeHtml(char ? (char.appearance_notes || '') : '') + '</textarea>' +
          '</div>' +
        '</div>' +

        // --- "This is my character" toggle ---
        '<div class="form-group">' +
          '<label class="toggle-label">' +
            '<span>This is my character</span>' +
            '<div class="toggle' + (char && char.is_user_character ? ' active' : '') + '" id="char-is-user"></div>' +
          '</label>' +
        '</div>' +

        // --- Response Profile ---
        '<div class="section-divider"></div>' +
        '<div class="form-section">' +
          '<h3 class="section-title" style="margin-bottom:10px">Response Profile <span class="form-hint">(emotional behaviour in stories)</span></h3>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Mood Baseline</span>' +
            '<select class="form-input trait-select" id="char-moodbaseline">' +
              '<option value="1"' + (char && char.moodbaseline === 1 ? ' selected' : '') + '>1 — Cold / Hostile</option>' +
              '<option value="2"' + (char && char.moodbaseline === 2 ? ' selected' : '') + '>2 — Guarded</option>' +
              '<option value="3"' + (!char || char.moodbaseline == null || char.moodbaseline === 3 ? ' selected' : '') + '>3 — Neutral (default)</option>' +
              '<option value="4"' + (char && char.moodbaseline === 4 ? ' selected' : '') + '>4 — Warm</option>' +
              '<option value="5"' + (char && char.moodbaseline === 5 ? ' selected' : '') + '>5 — Very Open</option>' +
            '</select>' +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Arousal Threshold</span>' +
            '<select class="form-input trait-select" id="char-arousalthreshold">' +
              '<option value="low"'      + (char && char.arousalthreshold === 'low'      ? ' selected' : '') + '>Low — escalates quickly</option>' +
              '<option value="medium"'   + (!char || !char.arousalthreshold || char.arousalthreshold === 'medium' ? ' selected' : '') + '>Medium (default)</option>' +
              '<option value="high"'     + (char && char.arousalthreshold === 'high'     ? ' selected' : '') + '>High — needs more investment</option>' +
              '<option value="veryhigh"' + (char && char.arousalthreshold === 'veryhigh' ? ' selected' : '') + '>Very High — very reserved</option>' +
            '</select>' +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Arousal Locked Until Mood</span>' +
            '<select class="form-input trait-select" id="char-arousallockeduntil">' +
              '<option value="1"' + (char && char.arousallockeduntil === 1 ? ' selected' : '') + '>1 — Always available</option>' +
              '<option value="2"' + (!char || char.arousallockeduntil == null || char.arousallockeduntil === 2 ? ' selected' : '') + '>2 (default)</option>' +
              '<option value="3"' + (char && char.arousallockeduntil === 3 ? ' selected' : '') + '>3 — Needs warm mood</option>' +
              '<option value="4"' + (char && char.arousallockeduntil === 4 ? ' selected' : '') + '>4 — Needs receptive mood</option>' +
            '</select>' +
          '</div>' +
          '<div class="trait-row">' +
            '<span class="trait-label">Arousal Max</span>' +
            '<select class="form-input trait-select" id="char-arousalmax">' +
              '<option value="2"' + (char && char.arousalmax === 2 ? ' selected' : '') + '>2 — Low ceiling</option>' +
              '<option value="3"' + (char && char.arousalmax === 3 ? ' selected' : '') + '>3 — Moderate ceiling</option>' +
              '<option value="4"' + (char && char.arousalmax === 4 ? ' selected' : '') + '>4 — High ceiling</option>' +
              '<option value="5"' + (!char || char.arousalmax == null || char.arousalmax === 5 ? ' selected' : '') + '>5 — Full ceiling (default)</option>' +
            '</select>' +
          '</div>' +
          '<div class="form-group" style="margin-top:10px">' +
            '<label class="form-label">Positive Mood Triggers <span class="form-hint">(what improves their mood)</span></label>' +
            '<textarea class="form-input" id="char-moodtriggerspos" rows="2" placeholder="e.g. kindness, good humor, being listened to">' + escapeHtml(char ? (char.moodtriggerspos || '') : '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Negative Mood Triggers <span class="form-hint">(what worsens their mood)</span></label>' +
            '<textarea class="form-input" id="char-moodtriggersneg" rows="2" placeholder="e.g. rudeness, being ignored, disrespect">' + escapeHtml(char ? (char.moodtriggersneg || '') : '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Arousal Triggers <span class="form-hint">(what increases romantic/physical tension)</span></label>' +
            '<textarea class="form-input" id="char-arousaltriggers" rows="2" placeholder="e.g. physical closeness, compliments, flirtatious banter">' + escapeHtml(char ? (char.arousaltriggers || '') : '') + '</textarea>' +
          '</div>' +
        '</div>' +

        '<div class="form-actions">' +
          '<button type="submit" class="btn btn-primary" id="btn-save-char">' + (isNew ? 'Create Character' : 'Save Changes') + '</button>' +
        '</div>' +
      '</form>' +
      refsHtml +
      (!isNew ?
        '<div class="section-divider"></div>' +
        '<div class="form-section" id="char-bonds-section">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
            '<h3 class="section-title" style="margin:0">Relationships</h3>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="btn-bond-add-toggle">+ Add</button>' +
          '</div>' +
          '<p class="form-hint" style="margin-bottom:8px">Describe how this character relates to others. The narrator uses these in every scenario both characters appear in.</p>' +
          '<div id="bond-add-form" style="display:none;margin-bottom:10px">' +
            '<div class="rel-add-row" style="margin-bottom:6px">' +
              '<select class="form-select" id="bond-related-char" style="flex:1"><option value="">Select character...</option></select>' +
            '</div>' +
            '<textarea class="form-input" id="bond-description" rows="3" placeholder="Describe the relationship (e.g. childhood friends, rivals who respect each other, estranged siblings reunited after years apart)..." style="width:100%;margin-bottom:6px"></textarea>' +
            '<div style="display:flex;gap:6px">' +
              '<button type="button" class="btn btn-primary btn-sm" id="btn-bond-save">Save</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" id="btn-bond-cancel">Cancel</button>' +
            '</div>' +
          '</div>' +
          '<div id="bond-list"></div>' +
        '</div>'
      : '') +
    '</div>';

  var toggle = document.getElementById('char-is-user');
  if (toggle) {
    toggle.onclick = function () { toggle.classList.toggle('active'); };
  }

  // Outfit builder — in-memory preset sets persisted via character record on form submit
  (function () {
    var defTa = document.getElementById('char-default-outfit');
    var uwToggle = document.getElementById('char-outfit-underwear-toggle');

    function renderSets() {
      var panel = document.getElementById('outfit-sets-panel');
      if (!panel) return;
      if (!_outfitSets.length) {
        panel.innerHTML =
          '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
            '<button type="button" class="btn btn-ghost btn-xs" id="btn-add-outfit-set">+ Add Preset</button>' +
          '</div>' +
          '<div id="outfit-set-add-form" style="display:none;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px"></div>';
      } else {
        var rows = _outfitSets.map(function (s, i) {
          var isDefault = (s.name === _defaultOutfitName);
          return '<div class="outfit-preset-row" style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
            '<button type="button" class="btn btn-ghost btn-xs outfit-select-btn' + (isDefault ? ' btn-active' : '') + '" data-idx="' + i + '" style="font-weight:600">' + escapeHtml(s.name) + '</button>' +
            '<span style="font-size:11px;color:var(--text-muted);flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + escapeHtml(s.description) + '</span>' +
            (s.underwear ? '<span style="font-size:10px;color:var(--text-faint)">+UW</span>' : '') +
            '<button type="button" class="btn btn-danger-ghost btn-xs outfit-del-btn" data-idx="' + i + '">x</button>' +
          '</div>';
        }).join('');
        panel.innerHTML =
          '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">' +
            '<span style="font-size:12px;font-weight:600;color:var(--text-muted)">Presets</span>' +
            '<button type="button" class="btn btn-ghost btn-xs" id="btn-add-outfit-set">+ Add</button>' +
          '</div>' +
          '<div style="margin-bottom:8px">' + rows + '</div>' +
          '<div id="outfit-set-add-form" style="display:none;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px"></div>';
      }
      // Keep raw JSON textarea in sync with builder state
      var ota = document.getElementById('char-outfit-sets-json');
      if (ota) ota.value = _outfitSets.length ? JSON.stringify(_outfitSets, null, 2) : '';
      wireSetEvents();
    }

    function wireSetEvents() {
      var addBtn = document.getElementById('btn-add-outfit-set');
      var addForm = document.getElementById('outfit-set-add-form');
      if (addBtn && addForm) {
        addBtn.onclick = function () {
          if (addForm.style.display !== 'none') { addForm.style.display = 'none'; return; }
          addForm.style.display = '';
          addForm.innerHTML =
            '<div style="display:flex;flex-direction:column;gap:6px">' +
              '<input type="text" class="form-input form-input-sm" id="new-outfit-name" placeholder="Outfit name (e.g. Casual)">' +
              '<textarea class="form-input form-input-sm" id="new-outfit-desc" rows="2" placeholder="Description (e.g. white t-shirt, jeans)"></textarea>' +
              '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">' +
                '<input type="checkbox" id="new-outfit-uw"> Include underwear in image' +
              '</label>' +
              '<div style="display:flex;gap:6px">' +
                '<button type="button" class="btn btn-primary btn-xs" id="new-outfit-save-btn">Add</button>' +
                '<button type="button" class="btn btn-ghost btn-xs" id="new-outfit-cancel-btn">Cancel</button>' +
              '</div>' +
            '</div>';
          var saveNew = document.getElementById('new-outfit-save-btn');
          var cancelNew = document.getElementById('new-outfit-cancel-btn');
          if (saveNew) {
            saveNew.onclick = function () {
              var name = (document.getElementById('new-outfit-name').value || '').trim();
              var desc = (document.getElementById('new-outfit-desc').value || '').trim();
              var uw   = document.getElementById('new-outfit-uw').checked;
              if (!name || !desc) { return; }
              _outfitSets.push({ name: name, description: desc, underwear: uw });
              addForm.style.display = 'none';
              renderSets();
            };
          }
          if (cancelNew) {
            cancelNew.onclick = function () { addForm.style.display = 'none'; };
          }
        };
      }

      document.querySelectorAll('.outfit-select-btn').forEach(function (btn) {
        btn.onclick = function () {
          var idx = Number(btn.dataset.idx);
          var s = _outfitSets[idx];
          if (!s) return;
          if (defTa) defTa.value = s.description;
          if (uwToggle) {
            if (s.underwear) uwToggle.classList.add('active');
            else uwToggle.classList.remove('active');
          }
          _defaultOutfitName = s.name;
          // Sync the visible default-outfit-name input
          var defNameInput = document.getElementById('char-default-outfit-name');
          if (defNameInput) defNameInput.value = s.name;
          renderSets();
        };
      });

      document.querySelectorAll('.outfit-del-btn').forEach(function (btn) {
        btn.onclick = function () {
          var idx = Number(btn.dataset.idx);
          var removed = _outfitSets.splice(idx, 1);
          if (removed.length && removed[0].name === _defaultOutfitName) {
            _defaultOutfitName = null;
          }
          renderSets();
        };
      });
    }

    renderSets();

    if (uwToggle) {
      uwToggle.onclick = function () { uwToggle.classList.toggle('active'); };
    }

    // ---- JSON Import Panel ----
    var importToggleBtn = document.getElementById('btn-json-import-toggle');
    var importBody      = document.getElementById('outfit-json-import-body');
    var importErrEl     = document.getElementById('outfit-json-import-error');
    var importTa        = document.getElementById('outfit-json-import-textarea');

    function showImportError(msg) {
      if (!importErrEl) return;
      importErrEl.textContent = msg;
      importErrEl.style.display = msg ? 'block' : 'none';
    }

    function parseImportJson() {
      if (!importTa) return null;
      var raw = importTa.value.trim();
      if (!raw) { showImportError('Please paste JSON before importing.'); return null; }
      var parsed;
      try { parsed = JSON.parse(raw); } catch (e) { showImportError('Invalid JSON: ' + e.message); return null; }
      if (!Array.isArray(parsed)) { showImportError('JSON must be an array of outfit objects.'); return null; }
      var valid = [];
      for (var i = 0; i < parsed.length; i++) {
        var item = parsed[i];
        if (!item || typeof item !== 'object') { showImportError('Item ' + i + ' is not an object.'); return null; }
        if (!item.name || typeof item.name !== 'string' || !item.name.trim()) { showImportError('Item ' + i + ' is missing a "name" field.'); return null; }
        if (!item.description || typeof item.description !== 'string' || !item.description.trim()) { showImportError('Item ' + i + ' is missing a "description" field.'); return null; }
        valid.push({ name: item.name.trim(), description: item.description.trim(), underwear: !!item.underwear });
      }
      if (!valid.length) { showImportError('No valid outfit objects found.'); return null; }
      showImportError('');
      return valid;
    }

    if (importToggleBtn && importBody) {
      importToggleBtn.onclick = function () {
        var hidden = importBody.style.display === 'none' || !importBody.style.display;
        importBody.style.display = hidden ? 'block' : 'none';
        importToggleBtn.textContent = hidden ? 'Hide' : 'Show';
        showImportError('');
      };
    }

    var importReplaceBtn = document.getElementById('btn-outfit-json-import');
    if (importReplaceBtn) {
      importReplaceBtn.onclick = function () {
        var valid = parseImportJson();
        if (!valid) return;
        _outfitSets = valid;
        _defaultOutfitName = null;
        renderSets();
        if (importTa) importTa.value = '';
        if (importBody) importBody.style.display = 'none';
        if (importToggleBtn) importToggleBtn.textContent = 'Show';
        showToast('Imported ' + valid.length + ' outfit' + (valid.length !== 1 ? 's' : '') + '.', 'success');
      };
    }

    var importMergeBtn = document.getElementById('btn-outfit-json-merge');
    if (importMergeBtn) {
      importMergeBtn.onclick = function () {
        var valid = parseImportJson();
        if (!valid) return;
        var added = 0;
        valid.forEach(function (incoming) {
          var exists = _outfitSets.some(function (s) { return s.name.toLowerCase() === incoming.name.toLowerCase(); });
          if (!exists) { _outfitSets.push(incoming); added++; }
        });
        renderSets();
        if (importTa) importTa.value = '';
        if (importBody) importBody.style.display = 'none';
        if (importToggleBtn) importToggleBtn.textContent = 'Show';
        showToast('Merged ' + added + ' new outfit' + (added !== 1 ? 's' : '') + ' (skipped duplicates).', 'success');
      };
    }

    var importClearBtn = document.getElementById('btn-outfit-json-clear-import');
    if (importClearBtn) {
      importClearBtn.onclick = function () {
        if (importTa) importTa.value = '';
        showImportError('');
      };
    }
    // ---- End JSON Import Panel ----

  }());

  // Gender select — show/hide breast size row and penis state row
  var genderSel = document.getElementById('char-gender');
  if (genderSel) {
    genderSel.onchange = function () {
      var val = genderSel.value.toLowerCase();
      var breastRow = document.getElementById('char-breast-size-row');
      if (breastRow) breastRow.style.display = (val === 'female' || val === 'non-binary') ? 'flex' : '';
      var penisRow = document.getElementById('char-penis-state-row');
      if (penisRow) penisRow.style.display = (val === 'male') ? 'flex' : 'none';
    };
    // Initialize visibility
    var breastRow = document.getElementById('char-breast-size-row');
    if (breastRow) {
      var gv = genderSel.value.toLowerCase();
      breastRow.style.display = (gv === 'female' || gv === 'non-binary') ? 'flex' : '';
    }
    var penisRow = document.getElementById('char-penis-state-row');
    if (penisRow) {
      var gvp = genderSel.value.toLowerCase();
      penisRow.style.display = (gvp === 'male') ? 'flex' : 'none';
    }
  }

  document.getElementById('char-form').onsubmit = function (e) {
    e.preventDefault();
    var btn = document.getElementById('btn-save-char');
    var data = {
      name:                 document.getElementById('char-name').value.trim(),
      description:          document.getElementById('char-description').value.trim(),
      image_description:    document.getElementById('char-image-description').value.trim() || null,
      appearance_notes:     document.getElementById('char-appearance-notes').value.trim(),
      is_user_character:    document.getElementById('char-is-user').classList.contains('active') ? 1 : 0,
      reference_image_path: char ? (char.reference_image_path || null) : null,
      gender:               document.getElementById('char-gender').value || '',
      age_range:            document.getElementById('char-age-range').value || 'adult',
      hair_color:           document.getElementById('char-hair-color').value  || '',
      hair_style:           document.getElementById('char-hair-style').value  || '',
      hair_extras:          document.getElementById('char-hair-extras').value.trim() || null,
      eye_color:            document.getElementById('char-eye-color').value   || '',
      eye_shape:            document.getElementById('char-eye-shape').value   || null,
      skin_tone:            document.getElementById('char-skin-tone').value   || '',
      skin_extras:          document.getElementById('char-skin-extras').value.trim() || null,
      body_type:            document.getElementById('char-body-type').value   || '',
      breast_size:          document.getElementById('char-breast-size').value || '',
      butt_size:            document.getElementById('char-butt-size').value  || null,
      penis_state:          document.getElementById('char-penis-state').value || null,
      height:document.getElementById('char-height').value      || '',
      nose_shape:           document.getElementById('char-nose-shape').value  || null,
      lip_shape:            document.getElementById('char-lip-shape').value   || null,
      face_shape:           document.getElementById('char-face-shape').value  || null,
      default_outfit:       document.getElementById('char-default-outfit').value.trim() || null,
      outfit_style:         document.getElementById('char-outfit-style').value || null,
      outfit_sets:          (function () {
        var ota = document.getElementById('char-outfit-sets-json');
        if (ota && ota.value.trim()) {
          try { var parsed = JSON.parse(ota.value.trim()); return JSON.stringify(parsed); }
          catch (_) {}
        }
        return JSON.stringify(_outfitSets);
      }()),
      default_outfit_name:  (function () {
        var dni = document.getElementById('char-default-outfit-name');
        return (dni && dni.value.trim()) ? dni.value.trim() : (_defaultOutfitName || null);
      }()),
      // Response Profile — mood/arousal personality fields
      moodbaseline:         Number(document.getElementById('char-moodbaseline').value)       || 3,
      arousalthreshold:     document.getElementById('char-arousalthreshold').value           || 'medium',
      arousallockeduntil:   Number(document.getElementById('char-arousallockeduntil').value) || 2,
      arousalmax:           Number(document.getElementById('char-arousalmax').value)         || 5,
      moodtriggerspos:      document.getElementById('char-moodtriggerspos').value.trim()     || null,
      moodtriggersneg:      document.getElementById('char-moodtriggersneg').value.trim()     || null,
      arousaltriggers:      document.getElementById('char-arousaltriggers').value.trim()     || null,
      image_prompt_override: (function () { var el = document.getElementById('char-image-prompt-override'); return el ? el.value.trim() || null : null; }()),
    };
    if (!data.name) { showToast('Name is required.', 'error'); return; }
    setLoading(btn, true, 'Saving...');

    var promise = isNew ? API.createCharacter(data) : API.updateCharacter(char.id, data);
    promise.then(function (result) {
      if (isNew) {
        showToast('Character created!', 'success');
        state.currentCharacter = result;
        return API.getCharacters().then(function (d) {
          renderCharacterList(d.characters || []);
          renderCharacterForm(result);
        });
      } else {
        showToast('Character saved!', 'success');
        state.currentCharacter = result;
        renderCharacterForm(result);
        return API.getCharacters().then(function (d) {
          renderCharacterList(d.characters || []);
        });
      }
    }).catch(function (err) {
      showToast('Save failed: ' + err.message, 'error');
      var b = document.getElementById('btn-save-char');
      if (b) setLoading(b, false);
    });
  };

  if (!isNew) {
    var delBtn = document.getElementById('btn-delete-char');
    if (delBtn) {
      delBtn.onclick = function () {
        showConfirm('Delete Character', 'Delete "' + char.name + '"? This cannot be undone.', function () {
          API.deleteCharacter(char.id).then(function () {
            showToast('Character deleted.', 'success');
            state.currentCharacter = null;
            panel.innerHTML = '<div class="empty-state"><p class="empty-state-text">Select a character to edit</p></div>';
            return API.getCharacters().then(function (d) { renderCharacterList(d.characters || []); });
          }).catch(function (err) {
            showToast('Delete failed: ' + err.message, 'error');
          });
        });
      };
    }

    var genBtn = document.getElementById('btn-gen-ref');
    if (genBtn) {
      genBtn.onclick = function () {
        setLoading(genBtn, true, 'Generating...');
        API.generateReference(char.id, {}).then(function () {
          showToast('Reference generated!', 'success');
          loadReferences(char.id);
        }).catch(function (err) {
          showToast('Generation failed: ' + err.message, 'error');
        }).finally(function () {
          var b = document.getElementById('btn-gen-ref');
          if (b) setLoading(b, false);
        });
      };
    }

    // --- Load styles into the fullbody style picker ---
    var fullbodyStyleSel = document.getElementById('fullbody-style-select');
    if (fullbodyStyleSel) {
      API.listStyles().then(function (data) {
        var styles = data.styles || [];
        if (styles.length) {
          fullbodyStyleSel.innerHTML =
            '<option value="">-- None (default) --</option>' +
            styles.map(function (s) {
              return '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>';
            }).join('');
        }
      }).catch(function () { /* silently ignore — picker stays with "None" only */ });
    }

    var fullbodyBtn = document.getElementById('btn-gen-fullbody');
    if (fullbodyBtn) {
      fullbodyBtn.onclick = function () {
        var promptInput = document.getElementById('fullbody-prompt');
        var promptVal = promptInput ? promptInput.value.trim() : '';
        var styleSel = document.getElementById('fullbody-style-select');
        var styleId = styleSel && styleSel.value ? Number(styleSel.value) : null;
        var genBody = {};
        if (promptVal) genBody.prompt_override = promptVal;
        if (styleId)   genBody.style_id = styleId;
        setLoading(fullbodyBtn, true, 'Generating...');
        API.generateFullbody(char.id, genBody).then(function (result) {
          showToast('Full body image generated!', 'success');
          renderFullbodyGrid(char.id, result.fullbodies || []);
        }).catch(function (err) {
          showToast('Full body generation failed: ' + err.message, 'error');
        }).finally(function () {
          var b = document.getElementById('btn-gen-fullbody');
          if (b) setLoading(b, false);
        });
      };
    }

    var iterBtn = document.getElementById('btn-iterate-ref');
    if (iterBtn) {
      iterBtn.onclick = function () {
        var form = document.getElementById('iterate-form');
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) {
          API.getReferences(char.id).then(function (data) {
            var refs = data.references || [];
            var accepted = refs.find(function (r) { return r.accepted; });
            var last = refs.slice(-1)[0];
            var p = document.getElementById('iterate-prompt');
            if (p) p.value = (accepted || last || {}).prompt_used || '';
          }).catch(function () {});
        }
      };
    }

    var iterCancel = document.getElementById('btn-iterate-cancel');
    if (iterCancel) {
      iterCancel.onclick = function () {
        document.getElementById('iterate-form').classList.add('hidden');
      };
    }

    var iterSubmit = document.getElementById('btn-iterate-submit');
    if (iterSubmit) {
      iterSubmit.onclick = function () {
        var prompt = document.getElementById('iterate-prompt').value.trim();
        setLoading(iterSubmit, true, 'Generating...');
        API.generateReference(char.id, { prompt_override: prompt }).then(function () {
          showToast('Reference generated!', 'success');
          document.getElementById('iterate-form').classList.add('hidden');
          loadReferences(char.id);
        }).catch(function (err) {
          showToast('Generation failed: ' + err.message, 'error');
        }).finally(function () {
          var b = document.getElementById('btn-iterate-submit');
          if (b) setLoading(b, false);
        });
      };
    }

    var uploadBtn = document.getElementById('btn-upload-ref');
    var uploadInput = document.getElementById('ref-upload-input');
    if (uploadBtn && uploadInput) {
      function doUploadRef(file) {
        setLoading(uploadBtn, true, 'Uploading...');
        API.uploadReference(char.id, file).then(function () {
          showToast('Reference uploaded!', 'success');
          uploadInput.value = '';
          loadReferences(char.id);
        }).catch(function (err) {
          showToast('Upload failed: ' + err.message, 'error');
        }).finally(function () {
          var b = document.getElementById('btn-upload-ref');
          if (b) setLoading(b, false);
          uploadInput.value = '';
        });
      }
      uploadBtn.onclick = function (e) {
        if (e.ctrlKey || !window.AssetLibrary) { uploadInput.click(); return; }
        window.AssetLibrary.openPicker({ type: 'image' }).then(function (result) {
          if (!result || !result.mediaUrl) return;
          return fetch(result.mediaUrl).then(function (r) { return r.blob(); }).then(function (blob) {
            var file = new File([blob], result.basename || 'picked.jpg', { type: blob.type || 'image/jpeg' });
            doUploadRef(file);
          });
        }).catch(function () { uploadInput.click(); });
      };
      uploadInput.onchange = function () {
        var file = uploadInput.files && uploadInput.files[0];
        if (!file) return;
        doUploadRef(file);
      };
    }

    loadReferences(char.id);
    loadFullbodies(char.id);

    // ── FaceID Slot Config wiring ──────────────────────────────────────────
    // Initialise slot-count dropdown from persisted char data.
    (function initFaceIdSlotConfig() {
      var slotCountSel  = document.getElementById('faceid-slot-count');
      var saveSlotBtn   = document.getElementById('btn-save-slot-count');
      var slotLabel     = document.getElementById('slot-count-label');
      var slotOrderDiv  = document.getElementById('faceid-slot-order');
      if (!slotCountSel || !saveSlotBtn || !slotOrderDiv) return;

      // Current persisted values (may be null/undefined for legacy chars).
      var currentCount = parseInt(char.faceid_ref_count, 10) || 5;
      var currentOrder = (function () {
        try { return char.faceid_ref_order ? JSON.parse(char.faceid_ref_order) : null; } catch (e) { return null; }
      })();

      // Set dropdown to saved value.
      slotCountSel.value = String(Math.min(5, Math.max(2, currentCount)));
      if (slotLabel) slotLabel.textContent = slotCountSel.value;

      // Update label when dropdown changes (before save).
      slotCountSel.onchange = function () {
        if (slotLabel) slotLabel.textContent = slotCountSel.value;
        renderSlotOrder(currentOrder); // re-highlight active count
      };

      // Helper: render the drag-to-reorder slot list from the current fullbodies array.
      // fbs = array of { id, filename } (sorted newest-first by default).
      // orderedIds = saved preferred order array or null.
      function renderSlotOrder(orderedIds) {
        slotOrderDiv.innerHTML = '';
        // We need the fullbodies list — grab it from the rendered grid thumbs.
        var thumbs = document.querySelectorAll('#fullbody-grid .ref-thumb[data-fb-id]');
        if (!thumbs.length) {
          slotOrderDiv.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0">Add full body images above to configure slot order.</div>';
          return;
        }
        // Build a map from fb.id → filename using the img src already rendered in the grid.
        var fbMap = {};
        thumbs.forEach(function (thumb) {
          var fbId = parseInt(thumb.dataset.fbId, 10);
          var img  = thumb.querySelector('img');
          fbMap[fbId] = img ? img.src : '';
        });
        var allIds = Object.keys(fbMap).map(Number);

        // Build ordered list: explicit order first, then remaining.
        var ordered = [];
        if (orderedIds && orderedIds.length) {
          orderedIds.forEach(function (id) { if (fbMap[id] !== undefined) ordered.push(id); });
        }
        allIds.forEach(function (id) { if (ordered.indexOf(id) === -1) ordered.push(id); });

        var activeCount = parseInt(slotCountSel.value, 10) || 5;

        ordered.forEach(function (fbId, idx) {
          var slotNum = idx + 1;
          var isActive = slotNum <= activeCount;
          var row = document.createElement('div');
          row.className = 'faceid-slot-row';
          row.dataset.fbId = fbId;
          row.draggable = true;
          row.style.cssText = [
            'display:flex', 'align-items:center', 'gap:8px', 'padding:5px 8px',
            'border-radius:6px', 'cursor:grab', 'user-select:none',
            'background:' + (isActive ? 'var(--surface-3,rgba(99,102,241,0.08))' : 'var(--surface-1)'),
            'border:1px solid ' + (isActive ? 'var(--primary,#6366f1)' : 'var(--border)'),
            'opacity:' + (isActive ? '1' : '0.5')
          ].join(';');

          var badge = '<span style="min-width:22px;height:22px;border-radius:50%;background:' +
            (isActive ? 'var(--primary,#6366f1)' : 'var(--surface-3,#555)') +
            ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">' +
            slotNum + '</span>';

          var thumb = '<img src="' + (fbMap[fbId] || '') + '" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid var(--border)" onerror="this.style.display=\'none\'">';

          var label = '<span style="flex:1;font-size:12px;color:var(--text-' + (isActive ? 'primary' : 'muted') + ')">Slot ' + slotNum +
            (isActive ? '' : ' (inactive)') + '</span>';

          var upBtn   = '<button class="btn btn-ghost btn-xs slot-up"   data-idx="' + idx + '" title="Move up"   style="padding:2px 6px;font-size:11px">&uarr;</button>';
          var downBtn = '<button class="btn btn-ghost btn-xs slot-down" data-idx="' + idx + '" title="Move down" style="padding:2px 6px;font-size:11px">&darr;</button>';

          row.innerHTML = badge + thumb + label + upBtn + downBtn;
          slotOrderDiv.appendChild(row);
        });

        // Drag-and-drop reorder.
        var dragging = null;
        slotOrderDiv.querySelectorAll('.faceid-slot-row').forEach(function (row) {
          row.addEventListener('dragstart', function (e) {
            dragging = row;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(function () { row.style.opacity = '0.3'; }, 0);
          });
          row.addEventListener('dragend', function () {
            row.style.opacity = '';
            dragging = null;
            var newOrder = Array.from(slotOrderDiv.querySelectorAll('.faceid-slot-row')).map(function (r) { return parseInt(r.dataset.fbId, 10); });
            currentOrder = newOrder;
            renderSlotOrder(currentOrder);
          });
          row.addEventListener('dragover', function (e) {
            e.preventDefault();
            if (dragging && dragging !== row) {
              var bounding = row.getBoundingClientRect();
              var offset   = bounding.y + bounding.height / 2;
              if (e.clientY < offset) {
                slotOrderDiv.insertBefore(dragging, row);
              } else {
                slotOrderDiv.insertBefore(dragging, row.nextSibling);
              }
            }
          });
        });

        // Up/down button reorder.
        slotOrderDiv.querySelectorAll('.slot-up').forEach(function (btn) {
          btn.onclick = function (e) {
            e.stopPropagation();
            var row = btn.closest('.faceid-slot-row');
            var prev = row.previousElementSibling;
            if (prev) slotOrderDiv.insertBefore(row, prev);
            var newOrder = Array.from(slotOrderDiv.querySelectorAll('.faceid-slot-row')).map(function (r) { return parseInt(r.dataset.fbId, 10); });
            currentOrder = newOrder;
            renderSlotOrder(currentOrder);
          };
        });
        slotOrderDiv.querySelectorAll('.slot-down').forEach(function (btn) {
          btn.onclick = function (e) {
            e.stopPropagation();
            var row = btn.closest('.faceid-slot-row');
            var next = row.nextElementSibling;
            if (next) slotOrderDiv.insertBefore(next, row);
            var newOrder = Array.from(slotOrderDiv.querySelectorAll('.faceid-slot-row')).map(function (r) { return parseInt(r.dataset.fbId, 10); });
            currentOrder = newOrder;
            renderSlotOrder(currentOrder);
          };
        });
      }

      // Expose so renderFullbodyGrid can trigger a refresh when images change.
      window._refreshFaceIdSlotOrder = function (orderedIds) {
        if (orderedIds !== undefined) currentOrder = orderedIds;
        renderSlotOrder(currentOrder);
      };

      // Render initial slot order list (grid may not be populated yet;
      // renderFullbodyGrid calls _refreshFaceIdSlotOrder after it renders).
      renderSlotOrder(currentOrder);

      // Save button handler.
      saveSlotBtn.onclick = function () {
        var count = parseInt(slotCountSel.value, 10);
        // Build ordered ID list from current DOM order.
        var orderedIds = Array.from(slotOrderDiv.querySelectorAll('.faceid-slot-row'))
          .map(function (r) { return parseInt(r.dataset.fbId, 10); })
          .filter(function (id) { return !isNaN(id); });
        setLoading(saveSlotBtn, true, 'Saving...');
        API.saveFaceIdConfig(char.id, {
          faceid_ref_count: count,
          faceid_ref_order: orderedIds.length ? orderedIds : null
        }).then(function (res) {
          showToast('FaceID slot config saved.', 'success');
          // Update local char object so re-renders pick up new values.
          char.faceid_ref_count = res.faceid_ref_count || count;
          char.faceid_ref_order = orderedIds.length ? JSON.stringify(orderedIds) : null;
          currentOrder = orderedIds.length ? orderedIds : null;
          if (slotLabel) slotLabel.textContent = String(count);
          renderSlotOrder(currentOrder);
        }).catch(function (err) {
          showToast('Save failed: ' + err.message, 'error');
        }).finally(function () {
          setLoading(saveSlotBtn, false);
        });
      };
    })();
    // ── End FaceID Slot Config wiring ──────────────────────────────────────

    var faceIdRemoveBtn = document.getElementById('btn-faceid-remove');
    if (faceIdRemoveBtn) {
      faceIdRemoveBtn.onclick = function () {
        showConfirm('Remove FaceID Reference', 'Clear the active FaceID reference for "' + char.name + '"? InstantID will be disabled for this character until a new reference is set.', function () {
          setLoading(faceIdRemoveBtn, true, 'Removing...');
          API.clearReferenceImage(char.id).then(function (result) {
            showToast('FaceID reference removed.', 'success');
            state.currentCharacter = result.character;
            renderCharacterForm(result.character);
            return API.getCharacters().then(function (d) { renderCharacterList(d.characters || []); });
          }).catch(function (err) {
            showToast('Remove failed: ' + err.message, 'error');
            var b = document.getElementById('btn-faceid-remove');
            if (b) setLoading(b, false);
          });
        });
      };
    }

    var faceIdUploadBtn   = document.getElementById('btn-faceid-upload');
    var faceIdUploadInput = document.getElementById('faceid-upload-input');
    if (faceIdUploadBtn && faceIdUploadInput) {
      function doUploadFaceId(file) {
        setLoading(faceIdUploadBtn, true, 'Uploading...');
        API.uploadReference(char.id, file).then(function (result) {
          showToast('FaceID reference updated!', 'success');
          faceIdUploadInput.value = '';
          var newChar = Object.assign({}, char, { reference_image_path: result.filename });
          state.currentCharacter = newChar;
          renderCharacterForm(newChar);
          return API.getCharacters().then(function (d) { renderCharacterList(d.characters || []); });
        }).catch(function (err) {
          showToast('Upload failed: ' + err.message, 'error');
          var b = document.getElementById('btn-faceid-upload');
          if (b) setLoading(b, false);
          faceIdUploadInput.value = '';
        });
      }
      faceIdUploadBtn.onclick = function (e) {
        if (e.ctrlKey || !window.AssetLibrary) { faceIdUploadInput.click(); return; }
        window.AssetLibrary.openPicker({ type: 'image' }).then(function (result) {
          if (!result || !result.basename) return;
          setLoading(faceIdUploadBtn, true, 'Setting...');
          API.setReferenceImage(char.id, result.basename).then(function (res) {
            showToast('FaceID reference set from library!', 'success');
            var newChar = res && res.character ? res.character : Object.assign({}, char, { reference_image_path: result.basename });
            state.currentCharacter = newChar;
            renderCharacterForm(newChar);
            return API.getCharacters().then(function (d) { renderCharacterList(d.characters || []); });
          }).catch(function (err) {
            showToast('Set failed: ' + err.message, 'error');
          }).finally(function () {
            setLoading(faceIdUploadBtn, false);
          });
        }).catch(function () { /* picker closed without selection */ });
      };
      faceIdUploadInput.onchange = function () {
        var file = faceIdUploadInput.files && faceIdUploadInput.files[0];
        if (!file) return;
        doUploadFaceId(file);
      };
    }

    var assembleBtn = document.getElementById('btn-assemble-prompt');
    if (assembleBtn) {
      assembleBtn.onclick = function () {
        var gender     = (document.getElementById('char-gender')     || {}).value || '';
        var ageRange   = (document.getElementById('char-age-range')  || {}).value || '';        var height     = (document.getElementById('char-height')     || {}).value || '';
        var bodyType   = (document.getElementById('char-body-type')  || {}).value || '';
        var hairColor  = (document.getElementById('char-hair-color') || {}).value || '';
        var hairStyle  = (document.getElementById('char-hair-style') || {}).value || '';
        var hairExtras = (document.getElementById('char-hair-extras')|| {}).value || '';
        var eyeColor   = (document.getElementById('char-eye-color')  || {}).value || '';
        var eyeShape   = (document.getElementById('char-eye-shape')  || {}).value || '';
        var skinTone   = (document.getElementById('char-skin-tone')  || {}).value || '';
        var skinExtras = (document.getElementById('char-skin-extras')|| {}).value || '';
        var breastSize = (document.getElementById('char-breast-size')|| {}).value || '';
        var buttSize   = (document.getElementById('char-butt-size')  || {}).value || '';
        var noseShape  = (document.getElementById('char-nose-shape') || {}).value || '';
        var lipShape   = (document.getElementById('char-lip-shape') || {}).value || '';
        var faceShape  = (document.getElementById('char-face-shape') || {}).value || '';
        var outfit     = (document.getElementById('char-default-outfit') || {}).value || '';
        var appNotes   = (document.getElementById('char-appearance-notes') || {}).value || '';

        var gLower = gender.toLowerCase();
        var parts = [];

        if (gender) parts.push(gender);
        if (ageRange && ageRange !== 'adult') parts.push(ageRange);
        if (height) parts.push(height);
        if (bodyType) parts.push(bodyType + ' build');

        var hairParts = [hairColor, hairStyle, hairExtras].filter(Boolean);
        if (hairParts.length) parts.push(hairParts.join(' ') + ' hair');

        var eyeParts = [eyeColor, eyeShape].filter(Boolean);
        if (eyeParts.length) parts.push(eyeParts.join(' ') + ' eyes');

        if (skinTone && skinExtras) parts.push(skinTone + ' skin with ' + skinExtras);
        else if (skinTone) parts.push(skinTone + ' skin');
        else if (skinExtras) parts.push(skinExtras);

        if (faceShape) parts.push(faceShape);
        if (noseShape) parts.push(noseShape + ' nose');
        if (lipShape) parts.push(lipShape + ' lips');

        if (breastSize && (gLower === 'female' || gLower === 'non-binary')) parts.push(breastSize + ' breasts');
        if (buttSize) parts.push(buttSize + ' butt');
        if (outfit) parts.push(outfit);

        // Clip appearance notes to first phrase (SDXL-safe)
        if (appNotes) {
          var clipped = appNotes.split(/\.\s+[A-Z]/)[0].slice(0, 100).trim().replace(/[,\s]+$/, '');
          if (clipped) parts.push(clipped);
        }

        var assembled = parts.filter(Boolean).join(', ');
        var ta = document.getElementById('char-image-prompt-override');
        if (ta) { ta.value = assembled; ta.focus(); }
      };
    }

    // --- Bonds (relationships) ---
    loadCharacterBonds(char.id);

    // Populate "other character" dropdown for the add form
    API.getCharacters().then(function (d) {
      var sel = document.getElementById('bond-related-char');
      if (!sel) return;
      var others = (d.characters || []).filter(function (c) { return c.id !== char.id; });
      sel.innerHTML = '<option value="">Select character...</option>' +
        others.map(function (c) { return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>'; }).join('');
    }).catch(function () {});

    var bondAddToggle = document.getElementById('btn-bond-add-toggle');
    var bondAddForm   = document.getElementById('bond-add-form');
    var bondCancel    = document.getElementById('btn-bond-cancel');
    var bondSave      = document.getElementById('btn-bond-save');

    if (bondAddToggle && bondAddForm) {
      bondAddToggle.onclick = function () {
        var hidden = bondAddForm.style.display === 'none' || !bondAddForm.style.display;
        bondAddForm.style.display = hidden ? 'block' : 'none';
        if (hidden) {
          var ta2 = document.getElementById('bond-description');
          if (ta2) { ta2.value = ''; ta2.focus(); }
          var sel2 = document.getElementById('bond-related-char');
          if (sel2) sel2.selectedIndex = 0;
        }
      };
    }

    if (bondCancel && bondAddForm) {
      bondCancel.onclick = function () { bondAddForm.style.display = 'none'; };
    }

    if (bondSave) {
      bondSave.onclick = function () {
        var relCharSel  = document.getElementById('bond-related-char');
        var descEl      = document.getElementById('bond-description');
        var relCharId   = relCharSel ? Number(relCharSel.value) : 0;
        var description = descEl ? descEl.value.trim() : '';
        if (!relCharId || !description) {
          showToast('Select a character and add a description.', 'error');
          return;
        }
        setLoading(bondSave, true, 'Saving...');
        API.createCharacterBond(char.id, { related_character_id: relCharId, description: description }).then(function () {
          showToast('Relationship saved.', 'success');
          if (bondAddForm) bondAddForm.style.display = 'none';
          loadCharacterBonds(char.id);
        }).catch(function (err) {
          showToast('Save failed: ' + (err.message || 'Error'), 'error');
        }).finally(function () {
          var b = document.getElementById('btn-bond-save');
          if (b) setLoading(b, false);
        });
      };
    }
  }
}

function loadCharacterBonds(charId) {
  var list = document.getElementById('bond-list');
  if (!list) return;
  list.innerHTML = '<div class="loading-state small">Loading...</div>';
  API.getCharacterBonds(charId).then(function (data) {
    var bonds = data.bonds || [];
    if (!bonds.length) {
      list.innerHTML = '<div class="empty-state small" style="margin-top:6px">No relationships defined yet.</div>';
      return;
    }
    list.innerHTML = bonds.map(function (b) {
      return '<div class="bond-row" data-bond-id="' + b.id + '">' +
        '<div class="bond-row-meta">' +
          '<span class="bond-name">' + escapeHtml(b.related_character_name || 'Unknown') + '</span>' +
        '</div>' +
        '<div class="bond-row-desc">' + escapeHtml(b.description) + '</div>' +
        '<button class="btn btn-danger btn-xs bond-delete-btn" data-bond-id="' + b.id + '">Remove</button>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.bond-delete-btn').forEach(function (btn) {
      btn.onclick = function () {
        var bid = Number(btn.dataset.bondId);
        API.deleteCharacterBond(charId, bid).then(function () {
          showToast('Relationship removed.', 'success');
          loadCharacterBonds(charId);
        }).catch(function (err) {
          showToast('Remove failed: ' + (err.message || 'Error'), 'error');
        });
      };
    });
  }).catch(function (err) {
    list.innerHTML = '<div class="empty-state small">Failed to load relationships.</div>';
  });
}

function loadReferences(charId) {
  var grid = document.getElementById('ref-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-state small">Loading...</div>';
  API.getReferences(charId).then(function (data) {
    var refs = data.references || [];
    if (!refs.length) {
      grid.innerHTML = '<div class="empty-state small">No reference images yet.</div>';
      return;
    }
    grid.innerHTML = refs.map(function (ref) {
      return '<div class="ref-thumb' + (ref.accepted ? ' accepted' : '') + '" data-ref-id="' + ref.id + '">' +
        '<img src="' + imageSrc(ref.imagecore_filename) + '" alt="Ref" loading="lazy" onerror="this.style.display=\'none\'">' +
        (ref.accepted ? '<div class="ref-badge-accepted">Active</div>' : '') +
        '<div class="ref-hover">' +
          (!ref.accepted ? '<button class="btn btn-success btn-xs ref-accept-btn" data-ref-id="' + ref.id + '">Accept</button>' : '') +
          '<button class="btn btn-danger btn-xs ref-delete-btn" data-ref-id="' + ref.id + '">Delete</button>' +
          (ref.prompt_used ? '<div class="ref-prompt">' + escapeHtml(ref.prompt_used) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    grid.querySelectorAll('.ref-accept-btn').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        API.acceptReference(charId, btn.dataset.refId).then(function () {
          showToast('Reference accepted!', 'success');
          loadReferences(charId);
        }).catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
      };
    });

    grid.querySelectorAll('.ref-delete-btn').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        API.deleteReference(charId, btn.dataset.refId).then(function () {
          showToast('Reference deleted.', 'success');
          loadReferences(charId);
        }).catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
      };
    });
  }).catch(function () {
    if (grid) grid.innerHTML = '<div class="error-state">Failed to load references.</div>';
  });
}

// Render the fullbody gallery from an already-fetched array, or fetch from API if not provided.
function renderFullbodyGrid(charId, fbs) {
  var grid    = document.getElementById('fullbody-grid');
  var counter = document.getElementById('fullbody-counter');
  var genBtn  = document.getElementById('btn-gen-fullbody');
  if (!grid) return;
  var count = fbs.length;
  // Batch FaceID (story-sdxl-faceid-batch-control2) works best with 2+ reference images.
  var counterColor = count === 0 ? 'var(--color-error)' : count === 1 ? 'var(--color-warning,#f59e0b)' : 'var(--text-muted)';
  var counterTitle = count === 0 ? 'No reference images — generation will fail'
                   : count === 1 ? 'Add at least one more image for best FaceID results'
                   : '';
  if (counter) {
    counter.textContent = count + ' / 5';
    counter.style.color = counterColor;
    counter.title = counterTitle;
  }
  if (genBtn) {
    genBtn.disabled = count >= 5;
    genBtn.title    = count >= 5 ? 'Delete one to generate another (max 5)' : '';
  }
  if (!fbs.length) {
    grid.innerHTML = '<div class="empty-state small" style="color:var(--color-error,#ef4444)">No full body images — add at least 2 for FaceID generation.</div>';
    if (typeof window._refreshFaceIdSlotOrder === 'function') setTimeout(window._refreshFaceIdSlotOrder, 50);
    return;
  }
  grid.innerHTML = fbs.map(function (fb) {
    // Allow deletion only when 2+ images exist so FaceID always has at least 1 remaining.
    var canDelete = count > 2;
    return '<div class="ref-thumb" data-fb-id="' + fb.id + '">' +
      '<img src="' + imageSrc(fb.filename) + '" alt="Full body" loading="lazy" onerror="this.style.display=\'none\'">' +
      '<div class="ref-hover">' +
        '<button class="btn btn-success btn-xs fb-use-ref-btn" data-fb-id="' + fb.id + '" data-fn="' + escapeHtml(fb.filename) + '">Use as Ref</button>' +
        (canDelete
          ? '<button class="btn btn-danger btn-xs fb-delete-btn" data-fb-id="' + fb.id + '">Delete</button>'
          : '<button class="btn btn-danger btn-xs" disabled style="cursor:not-allowed;opacity:0.5" ' +
              'title="Keep at least 2 images for FaceID consistency">Delete</button>') +
      '</div>' +
    '</div>';
  }).join('');
  grid.querySelectorAll('.fb-use-ref-btn').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      setLoading(btn, true, 'Saving...');
      API.useFullbodyAsRef(charId, btn.dataset.fn).then(function () {
        showToast('Full body set as FaceID reference.', 'success');
      }).catch(function (err) {
        showToast('Failed: ' + err.message, 'error');
      }).finally(function () {
        setLoading(btn, false);
      });
    };
  });
  grid.querySelectorAll('.fb-delete-btn').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      API.deleteFullbodyById(charId, parseInt(btn.dataset.fbId, 10)).then(function (data) {
        showToast('Full body image removed.', 'success');
        renderFullbodyGrid(charId, data.fullbodies || []);
      }).catch(function (err) {
        showToast('Failed: ' + err.message, 'error');
      });
    };
  });

  // Notify slot-order panel that the grid has new thumbnails.
  if (typeof window._refreshFaceIdSlotOrder === 'function') {
    // Small defer so the grid imgs are in the DOM before querySelectorAll runs.
    setTimeout(window._refreshFaceIdSlotOrder, 50);
  }
}

function loadFullbodies(charId) {
  var grid = document.getElementById('fullbody-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-state small">Loading...</div>';
  API.getFullbodies(charId).then(function (data) {
    renderFullbodyGrid(charId, data.fullbodies || []);
  }).catch(function () {
    if (grid) grid.innerHTML = '<div class="error-state">Failed to load full body images.</div>';
  });
}

/* ============================================================
   CHARACTER RELATIONSHIPS PANEL
   Structured model: type / bond / dynamic / notes / lock
   Character dropdowns show scenario cast only.
   Edit mode: click Edit on a row to preload all fields.
   ============================================================ */
function renderRelationshipsPanel() {
  var panel = document.getElementById('char-detail-panel');
  if (!panel) return;

  var TYPE_OPTS = [
    '', 'mother', 'father', 'son', 'daughter', 'sister', 'brother',
    'half-sister', 'half-brother',
    'cousin', 'aunt', 'uncle', 'grandma', 'grandpa',
    'best friend', 'close friend', 'friend', 'acquaintance', 'stranger',
    'roommate', 'housemate', 'neighbor', 'coworker', 'classmate',
    "sister's friend", "brother's friend", "friend's brother", "friend's sister",
    "daughter's friend", "son's friend", "friend's mom", "friend's dad",
    'crush', 'lover', 'rival', 'enemy'
  ];
  var BOND_OPTS = [
    '', 'very close', 'close', 'trusting', 'neutral',
    'growing', 'cautious', 'strained', 'fractured'
  ];
  var DYNAMIC_OPTS = [
    '', 'playful', 'teasing', 'supportive', 'protective', 'gentle',
    'encouraging', 'candid', 'indulgent', 'friendly',
    'shy', 'awkward', 'reserved', 'cautious', 'competitive', 'wary', 'hostile'
  ];

  function buildSelectOpts(opts, selectedVal) {
    return opts.map(function (v) {
      var lbl = v || '-- none --';
      var sel = (v === (selectedVal || '')) ? ' selected' : '';
      return '<option value="' + escapeHtml(v) + '"' + sel + '>' + escapeHtml(lbl) + '</option>';
    }).join('');
  }

  panel.innerHTML =
    '<div class="rel-panel">' +
      '<div class="rel-panel-header">' +
        '<h2 class="panel-title">Character Relationships</h2>' +
        '<button class="btn btn-ghost btn-sm" id="btn-rel-back">&larr; Characters</button>' +
      '</div>' +
      '<div class="form-group" style="padding:0 16px">' +
        '<label class="form-label">Scenario</label>' +
        '<select class="form-select" id="rel-scenario-select"><option value="">Loading...</option></select>' +
      '</div>' +
      '<div id="rel-graph-container" class="rel-graph-container"></div>' +
      '<div id="rel-list" style="padding:0 16px 8px;max-height:150px;overflow-y:auto"></div>' +
      '<div class="rel-add-form">' +
        '<div class="rel-add-form-title" id="rel-form-title">Add Relationship</div>' +
        '<div class="rel-add-row">' +
          '<select class="form-select" id="rel-char-a"><option value="">Character A</option></select>' +
          '<div class="rel-add-arrow">&rarr;</div>' +
          '<select class="form-select" id="rel-char-b"><option value="">Character B</option></select>' +
        '</div>' +
        '<div class="rel-add-row">' +
          '<select class="form-select" id="rel-type"><option value="">-- type --</option>' + buildSelectOpts(TYPE_OPTS.filter(Boolean), '') + '</select>' +
          '<select class="form-select" id="rel-bond"><option value="">-- bond --</option>' + buildSelectOpts(BOND_OPTS.filter(Boolean), '') + '</select>' +
          '<select class="form-select" id="rel-dynamic"><option value="">-- dynamic --</option>' + buildSelectOpts(DYNAMIC_OPTS.filter(Boolean), '') + '</select>' +
        '</div>' +
        '<div class="rel-add-row">' +
          '<input type="text" class="form-input" id="rel-notes" placeholder="Notes (optional)" style="flex:1">' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap">' +
            '<input type="checkbox" id="rel-locked"> Locked' +
          '</label>' +
        '</div>' +
        '<input type="hidden" id="rel-edit-id">' +
        '<div class="rel-add-actions">' +
          '<button class="btn btn-ghost btn-sm" id="btn-rel-reset">Reset</button>' +
          '<button class="btn btn-primary btn-sm" id="btn-rel-save">Add Relationship</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.getElementById('btn-rel-back').onclick = function () {
    renderCharacterForm(state.currentCharacter || null);
  };

  var scenarioSel = document.getElementById('rel-scenario-select');

  function loadScenarioRels(scenarioId) {
    var listEl = document.getElementById('rel-list');
    var graphEl = document.getElementById('rel-graph-container');
    if (!scenarioId) {
      if (listEl) listEl.innerHTML = '';
      if (graphEl) graphEl.innerHTML = '';
      return;
    }
    Promise.all([
      API.getRelationships(scenarioId),
      API.getScenarioCharacters(scenarioId)
    ]).then(function (results) {
      var rels = results[0].relationships || [];
      var chars = results[1].characters || [];

      var charOpts = '<option value="">-- select --</option>' +
        chars.map(function (c) {
          return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
        }).join('');
      var selA = document.getElementById('rel-char-a');
      var selB = document.getElementById('rel-char-b');
      if (selA) selA.innerHTML = charOpts;
      if (selB) selB.innerHTML = charOpts;

      if (graphEl) renderRelGraph(graphEl, chars, rels);

      if (!listEl) return;
      if (!rels.length) {
        listEl.innerHTML = '<div class="empty-state small" style="padding:8px 0">No relationships yet.</div>';
        return;
      }
      listEl.innerHTML = rels.map(function (r) {
        var nameA = escapeHtml((chars.find(function(c){return c.id===r.character_a_id;})||{name:'?'}).name);
        var nameB = escapeHtml((chars.find(function(c){return c.id===r.character_b_id;})||{name:'?'}).name);
        return '<div class="rel-row" data-rel-id="' + r.id + '">' +
          '<span class="rel-names">' + nameA + ' &rarr; ' + nameB + '</span>' +
          '<span class="rel-tags">' +
            (r.type    ? '<span class="badge badge-muted">'   + escapeHtml(r.type)    + '</span>' : '') +
            (r.bond    ? '<span class="badge badge-muted">'   + escapeHtml(r.bond)    + '</span>' : '') +
            (r.dynamic ? '<span class="badge badge-accent">'  + escapeHtml(r.dynamic) + '</span>' : '') +
            (r.locked  ? '<span class="badge badge-warning">locked</span>' : '') +
          '</span>' +
          '<div class="rel-row-actions">' +
            '<button class="btn btn-ghost btn-xs btn-rel-edit" data-rel-id="' + r.id + '">Edit</button>' +
            '<button class="btn btn-danger btn-xs btn-rel-delete" data-rel-id="' + r.id + '">x</button>' +
          '</div>' +
        '</div>';
      }).join('');

      listEl.querySelectorAll('.btn-rel-delete').forEach(function (btn) {
        btn.onclick = function () {
          API.deleteRelationship(scenarioId, btn.dataset.relId).then(function () {
            showToast('Relationship deleted.', 'success');
            loadScenarioRels(scenarioId);
          }).catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
        };
      });

      listEl.querySelectorAll('.btn-rel-edit').forEach(function (btn) {
        btn.onclick = function () {
          var rel = rels.find(function (r) { return String(r.id) === String(btn.dataset.relId); });
          if (!rel) return;
          var editIdEl = document.getElementById('rel-edit-id');
          var selA2 = document.getElementById('rel-char-a');
          var selB2 = document.getElementById('rel-char-b');
          var typeEl = document.getElementById('rel-type');
          var bondEl = document.getElementById('rel-bond');
          var dynEl  = document.getElementById('rel-dynamic');
          var notesEl = document.getElementById('rel-notes');
          var lockedEl = document.getElementById('rel-locked');
          var titleEl = document.getElementById('rel-form-title');
          var saveBtn2 = document.getElementById('btn-rel-save');
          if (editIdEl) editIdEl.value = rel.id;
          if (selA2)   selA2.value   = rel.character_a_id;
          if (selB2)   selB2.value   = rel.character_b_id;
          if (typeEl)  typeEl.value  = rel.type    || '';
          if (bondEl)  bondEl.value  = rel.bond    || '';
          if (dynEl)   dynEl.value   = rel.dynamic || '';
          if (notesEl) notesEl.value = rel.notes   || '';
          if (lockedEl) lockedEl.checked = !!rel.locked;
          if (titleEl) titleEl.textContent = 'Edit Relationship';
          if (saveBtn2) saveBtn2.textContent = 'Save Changes';
        };
      });
    }).catch(function (err) {
      showToast('Failed to load relationships: ' + err.message, 'error');
    });
  }

  document.getElementById('btn-rel-save').onclick = function () {
    var scenarioId = scenarioSel.value;
    if (!scenarioId) { showToast('Select a scenario first.', 'error'); return; }
    var charA = document.getElementById('rel-char-a').value;
    var charB = document.getElementById('rel-char-b').value;
    if (!charA || !charB) { showToast('Select both characters.', 'error'); return; }
    if (charA === charB)  { showToast('Characters must be different.', 'error'); return; }
    var editId = document.getElementById('rel-edit-id').value;
    var data = {
      character_a_id: Number(charA),
      character_b_id: Number(charB),
      type:    document.getElementById('rel-type').value    || null,
      bond:    document.getElementById('rel-bond').value    || null,
      dynamic: document.getElementById('rel-dynamic').value || null,
      notes:   document.getElementById('rel-notes').value.trim() || null,
      locked:  document.getElementById('rel-locked').checked ? 1 : 0,
    };
    var promise = editId
      ? API.updateRelationship(scenarioId, editId, data)
      : API.createRelationship(scenarioId, data);
    promise.then(function () {
      showToast(editId ? 'Relationship updated.' : 'Relationship added.', 'success');
      resetRelForm();
      loadScenarioRels(scenarioId);
    }).catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
  };

  function resetRelForm() {
    var editIdEl = document.getElementById('rel-edit-id');
    var selA = document.getElementById('rel-char-a');
    var selB = document.getElementById('rel-char-b');
    var typeEl = document.getElementById('rel-type');
    var bondEl = document.getElementById('rel-bond');
    var dynEl  = document.getElementById('rel-dynamic');
    var notesEl = document.getElementById('rel-notes');
    var lockedEl = document.getElementById('rel-locked');
    var titleEl = document.getElementById('rel-form-title');
    var saveBtn = document.getElementById('btn-rel-save');
    if (editIdEl) editIdEl.value = '';
    if (selA) selA.selectedIndex = 0;
    if (selB) selB.selectedIndex = 0;
    if (typeEl) typeEl.selectedIndex = 0;
    if (bondEl) bondEl.selectedIndex = 0;
    if (dynEl)  dynEl.selectedIndex  = 0;
    if (notesEl) notesEl.value = '';
    if (lockedEl) lockedEl.checked = false;
    if (titleEl) titleEl.textContent = 'Add Relationship';
    if (saveBtn) saveBtn.textContent = 'Add Relationship';
  }

  document.getElementById('btn-rel-reset').onclick = resetRelForm;

  API.getScenarios().then(function (data) {
    var scenarios = data.scenarios || [];
    if (!scenarios.length) {
      scenarioSel.innerHTML = '<option value="">No scenarios found</option>';
      return;
    }
    scenarioSel.innerHTML = '<option value="">-- Select scenario --</option>' +
      scenarios.map(function (s) {
        return '<option value="' + s.id + '">' + escapeHtml(s.title || s.name || 'Scenario ' + s.id) + '</option>';
      }).join('');
    scenarioSel.onchange = function () { loadScenarioRels(scenarioSel.value); };
  }).catch(function (err) {
    scenarioSel.innerHTML = '<option value="">Failed to load</option>';
  });
}

/* Simple SVG relationship graph */
function renderRelGraph(container, chars, rels) {
  if (!chars.length) { container.innerHTML = ''; return; }
  var W = container.offsetWidth || 400;
  var H = 180;
  var R = 22;
  var cx = W / 2, cy = H / 2;
  var radius = Math.min(W, H) / 2 - R - 10;
  var positions = {};
  chars.forEach(function (c, i) {
    var angle = (2 * Math.PI * i / chars.length) - Math.PI / 2;
    positions[c.id] = {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      name: c.name
    };
  });

  var lines = rels.map(function (r) {
    var a = positions[r.character_a_id];
    var b = positions[r.character_b_id];
    if (!a || !b) return '';
    return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y +
      '" stroke="var(--primary)" stroke-opacity="0.35" stroke-width="1.5"/>';
  }).join('');

  var nodes = chars.map(function (c) {
    var p = positions[c.id];
    var initial = escapeHtml((c.name || '?')[0].toUpperCase());
    var shortName = escapeHtml(c.name.length > 8 ? c.name.slice(0, 7) + '...' : c.name);
    return '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + R + '" fill="var(--surface-2)" stroke="var(--border)" stroke-width="1.5"/>' +
      '<text x="' + p.x + '" y="' + (p.y + 5) + '" text-anchor="middle" font-size="13" fill="var(--text-primary)" font-family="inherit">' + initial + '</text>' +
      '<text x="' + p.x + '" y="' + (p.y + R + 13) + '" text-anchor="middle" font-size="10" fill="var(--text-secondary)" font-family="inherit">' + shortName + '</text>';
  }).join('');

  container.innerHTML = '<svg width="' + W + '" height="' + H + '" style="display:block">' + lines + nodes + '</svg>';
}