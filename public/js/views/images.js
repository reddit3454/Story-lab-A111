/**
 * images.js — Images page
 *
 * Left panel: character list + gallery (user-uploaded images per character)
 *   - Upload / Remove buttons above gallery
 *   - Click an image to select it; expand button appears for lightbox
 *   - While selected: [Face] [Body] [Style] buttons assign to reference slots
 *
 * Right panel: Reference slots (3 categories × 5 slots each)
 *   - Face: live — feeds faceid_ref_count / gallery_slot_config.face
 *   - Body / Style: stored in gallery_slot_config, UI-only for now
 *   - Drag-to-reorder within each category
 *   - Hover X to remove a slot
 *   - faceid_ref_count spinner (2-5) controls how many Face slots are active
 */

import { escapeHtml, imageSrc } from '../utils.js';
import { showToast, openLightbox } from '../ui.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var _state = {
  characters:    [],
  activeCharId:  null,
  gallery:        [],       // { id, character_id, filename, created_at }
  slotConfig:     {},       // { face: { '1': {galleryId, filename}, ... }, body: {}, style: {} }
  faceIdCount:   5,         // 2-5
  selectedGalleryId: null,  // currently highlighted gallery image id
  dragSrcCategory: null,
  dragSrcSlot:     null,
};

var BASE = 'http://localhost:4090';

// ---------------------------------------------------------------------------
// API helpers (gallery-specific — not in global API object yet)
// ---------------------------------------------------------------------------
function _req(method, path, body) {
  var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(BASE + path, opts).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || r.statusText); });
    if (r.status === 204) return null;
    return r.json();
  });
}

function _uploadGallery(charId, file) {
  return fetch(BASE + '/api/characters/' + charId + '/gallery', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'image/png' },
    body: file
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || r.statusText); });
    return r.json();
  });
}

function _galleryImageSrc(charId, filename) {
  return BASE + '/gallery-images/' + charId + '/' + encodeURIComponent(filename);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initImages() {
  var el = document.getElementById('view-images');
  if (!el) return;

  el.innerHTML =
    '<div class="page-header">' +
      '<div class="header-left"><a href="#dashboard" class="btn btn-ghost btn-sm">&larr; Back</a></div>' +
      '<h1 class="page-title story-font">Images</h1>' +
      '<div class="header-actions"></div>' +
    '</div>' +
    '<div class="images-layout">' +
      '<div class="images-left-panel">' +
        '<div class="char-list-header">' +
          '<h2 class="panel-title">Characters</h2>' +
        '</div>' +
        '<div id="img-char-list" class="char-list"><div class="loading-state small">Loading...</div></div>' +
        '<div id="img-gallery-section" class="img-gallery-section" style="display:none">' +
          '<div class="img-gallery-toolbar">' +
            '<span id="img-gallery-char-name" class="img-gallery-char-name"></span>' +
            '<div class="img-gallery-toolbar-actions">' +
              '<button class="btn btn-primary btn-sm" id="btn-gallery-upload">Upload</button>' +
              '<button class="btn btn-danger btn-sm" id="btn-gallery-remove" disabled>Remove</button>' +
            '</div>' +
          '</div>' +
          '<div id="img-assign-bar" class="img-assign-bar" style="display:none">' +
            '<span class="img-assign-label">Assign to:</span>' +
            '<button class="btn btn-sm btn-secondary img-assign-btn" data-cat="face">Face</button>' +
            '<button class="btn btn-sm btn-secondary img-assign-btn" data-cat="body">Body</button>' +
            '<button class="btn btn-sm btn-secondary img-assign-btn" data-cat="style">Style</button>' +
          '</div>' +
          '<input type="file" id="gallery-file-input" accept="image/*" style="display:none" multiple>' +
          '<div id="img-gallery-grid" class="img-gallery-grid"><div class="empty-state small"><p class="empty-state-text">No images yet. Click Upload to add some.</p></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="images-right-panel">' +
        '<div class="ref-slots-header">' +
          '<h2 class="panel-title">Reference Slots</h2>' +
          '<div class="faceid-count-control" id="faceid-count-wrap" style="display:none">' +
            '<span class="form-label" style="margin:0">Active Face Refs</span>' +
            '<div class="faceid-count-stepper">' +
              '<button class="btn btn-ghost btn-xs" id="btn-faceid-dec">&#8722;</button>' +
              '<span id="faceid-count-val">5</span>' +
              '<button class="btn btn-ghost btn-xs" id="btn-faceid-inc">+</button>' +
            '</div>' +
            '<span class="form-hint" style="margin:0">2 – 5 &nbsp; (slots beyond count are inactive)</span>' +
          '</div>' +
        '</div>' +
        '<div id="ref-slots-container" class="ref-slots-container">' +
          '<div class="empty-state small"><p class="empty-state-text">Select a character to manage reference slots.</p></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  _injectStyles();

  API.getCharacters().then(function (d) {
    _state.characters = d.characters || [];
    _renderCharList();
  }).catch(function (e) {
    showToast('Failed to load characters: ' + e.message, 'error');
  });

  document.getElementById('btn-gallery-upload').onclick = function () {
    document.getElementById('gallery-file-input').click();
  };

  document.getElementById('gallery-file-input').onchange = function (e) {
    var files = Array.from(e.target.files || []);
    if (!files.length || !_state.activeCharId) return;
    _uploadFiles(files);
    e.target.value = '';
  };

  document.getElementById('btn-gallery-remove').onclick = function () {
    if (!_state.selectedGalleryId || !_state.activeCharId) return;
    _removeGalleryImage(_state.selectedGalleryId);
  };

  document.querySelectorAll('.img-assign-btn').forEach(function (btn) {
    btn.onclick = function () {
      _assignSelected(btn.dataset.cat);
    };
  });

  document.getElementById('btn-faceid-dec').onclick = function () {
    _setFaceIdCount(_state.faceIdCount - 1);
  };
  document.getElementById('btn-faceid-inc').onclick = function () {
    _setFaceIdCount(_state.faceIdCount + 1);
  };
}

// ---------------------------------------------------------------------------
// Character list
// ---------------------------------------------------------------------------
function _renderCharList() {
  var list = document.getElementById('img-char-list');
  if (!list) return;
  if (!_state.characters.length) {
    list.innerHTML = '<div class="empty-state small"><p class="empty-state-text">No characters found.</p></div>';
    return;
  }
  list.innerHTML = _state.characters.map(function (c) {
    var active = _state.activeCharId === c.id ? ' active' : '';
    return '<div class="char-list-item' + active + '" data-id="' + c.id + '">' +
      '<span>' + escapeHtml(c.name) + '</span>' +
    '</div>';
  }).join('');
  list.querySelectorAll('.char-list-item').forEach(function (item) {
    item.onclick = function () {
      _selectCharacter(Number(item.dataset.id));
    };
  });
}

function _selectCharacter(charId) {
  _state.activeCharId    = charId;
  _state.selectedGalleryId = null;
  document.querySelectorAll('.char-list-item').forEach(function (i) {
    i.classList.toggle('active', Number(i.dataset.id) === charId);
  });
  var char = _state.characters.find(function (c) { return c.id === charId; });
  var nameEl = document.getElementById('img-gallery-char-name');
  if (nameEl && char) nameEl.textContent = char.name;

  document.getElementById('img-gallery-section').style.display = 'flex';
  document.getElementById('faceid-count-wrap').style.display   = 'flex';
  document.getElementById('img-assign-bar').style.display      = 'none';
  document.getElementById('btn-gallery-remove').disabled       = true;

  _loadGallery(charId);
  _loadSlotConfig(charId);
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
function _loadGallery(charId) {
  var grid = document.getElementById('img-gallery-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-state small">Loading...</div>';
  API.getCharacterGallery(charId).then(function (d) {
    _state.gallery = d.gallery || [];
    _renderGallery();
  }).catch(function (e) {
    showToast('Gallery load failed: ' + e.message, 'error');
    _state.gallery = [];
    _renderGallery();
  });
}

function _renderGallery() {
  var grid = document.getElementById('img-gallery-grid');
  if (!grid) return;
  if (!_state.gallery.length) {
    grid.innerHTML = '<div class="empty-state small"><p class="empty-state-text">No images yet. Click Upload to add some.</p></div>';
    return;
  }
  grid.innerHTML = _state.gallery.map(function (img) {
    var sel = _state.selectedGalleryId === img.id ? ' selected' : '';
    return '<div class="gallery-thumb' + sel + '" data-id="' + img.id + '" data-fn="' + escapeHtml(img.filename) + '">' +
      '<img src="' + escapeHtml(_galleryImageSrc(_state.activeCharId, img.filename)) + '" loading="lazy" draggable="false">' +
      '<button class="gallery-expand-btn" title="View full size">&#x26F6;</button>' +
    '</div>';
  }).join('');

  grid.querySelectorAll('.gallery-thumb').forEach(function (thumb) {
    thumb.onclick = function (e) {
      if (e.target.classList.contains('gallery-expand-btn')) return;
      _selectGalleryImage(Number(thumb.dataset.id));
    };
    thumb.querySelector('.gallery-expand-btn').onclick = function (e) {
      e.stopPropagation();
      var src = _galleryImageSrc(_state.activeCharId, thumb.dataset.fn);
      openLightbox(src);
    };
  });
}

function _selectGalleryImage(id) {
  _state.selectedGalleryId = (_state.selectedGalleryId === id) ? null : id;
  document.querySelectorAll('.gallery-thumb').forEach(function (t) {
    t.classList.toggle('selected', Number(t.dataset.id) === _state.selectedGalleryId);
  });
  var hasSelection = !!_state.selectedGalleryId;
  document.getElementById('img-assign-bar').style.display = hasSelection ? 'flex' : 'none';
  document.getElementById('btn-gallery-remove').disabled  = !hasSelection;
}

function _uploadFiles(files) {
  var charId = _state.activeCharId;
  var grid = document.getElementById('img-gallery-grid');
  if (grid) grid.innerHTML = '<div class="loading-state small">Uploading...</div>';

  var promises = files.map(function (file) {
    return API.uploadCharacterGalleryImage(charId, file);
  });

  Promise.all(promises).then(function () {
    showToast('Uploaded ' + files.length + ' image' + (files.length > 1 ? 's' : ''), 'success');
    _loadGallery(charId);
  }).catch(function (e) {
    showToast('Upload failed: ' + e.message, 'error');
    _loadGallery(charId);
  });
}

function _removeGalleryImage(galleryId) {
  var charId = _state.activeCharId;
  API.deleteCharacterGalleryImage(charId, galleryId).then(function () {
    _state.selectedGalleryId = null;
    document.getElementById('btn-gallery-remove').disabled = true;
    document.getElementById('img-assign-bar').style.display = 'none';
    showToast('Image removed', 'success');
    _loadGallery(charId);
  }).catch(function (e) {
    showToast('Remove failed: ' + e.message, 'error');
  });
}

// ---------------------------------------------------------------------------
// Slot config
// ---------------------------------------------------------------------------
function _loadSlotConfig(charId) {
  // Load faceIdCount
  API.getFaceIdConfig(charId).then(function (d) {
    _state.faceIdCount = d.faceid_ref_count != null ? d.faceid_ref_count : 5;
    _updateFaceIdCountUI();
  }).catch(function () {
    _state.faceIdCount = 5;
    _updateFaceIdCountUI();
  });

  // Load gallery slot config (face, body, style slots)
  API.getGallerySlotConfig(charId).then(function (d) {
    _state.slotConfig = d.gallery_slot_config || {};
    _renderRefSlots();
  }).catch(function () {
    _state.slotConfig = {};
    _renderRefSlots();
  });
}

function _updateFaceIdCountUI() {
  var el = document.getElementById('faceid-count-val');
  if (el) el.textContent = _state.faceIdCount;
  // Dim slots beyond faceIdCount in the face category
  _updateFaceSlotActiveStates();
}

function _updateFaceSlotActiveStates() {
  document.querySelectorAll('.ref-slot[data-cat="face"]').forEach(function (slot) {
    var slotNum = Number(slot.dataset.slot);
    slot.classList.toggle('slot-inactive', slotNum > _state.faceIdCount);
  });
}

function _setFaceIdCount(n) {
  n = Math.max(2, Math.min(5, n));
  if (n === _state.faceIdCount) return;
  _state.faceIdCount = n;
  _updateFaceIdCountUI();
  // Persist
  API.saveFaceIdConfig(_state.activeCharId, { faceid_ref_count: n }).catch(function (e) {
    showToast('Failed to save face ref count: ' + e.message, 'error');
  });
}

// ---------------------------------------------------------------------------
// Reference slot rendering
// ---------------------------------------------------------------------------
var CATEGORIES = ['face', 'body', 'style'];
var CAT_LABELS  = { face: 'Face', body: 'Body', style: 'Style' };

function _renderRefSlots() {
  var container = document.getElementById('ref-slots-container');
  if (!container) return;

  container.innerHTML = CATEGORIES.map(function (cat) {
    return '<div class="ref-category">' +
      '<div class="ref-category-header">' +
        '<span class="ref-category-label">' + CAT_LABELS[cat] + '</span>' +
        (cat === 'face' ? '<span class="ref-category-hint">Feeds FaceID batch workflow</span>' : '<span class="ref-category-hint">UI reference only</span>') +
      '</div>' +
      '<div class="ref-slots-row" id="ref-slots-' + cat + '" data-cat="' + cat + '">' +
        _renderSlots(cat) +
      '</div>' +
    '</div>';
  }).join('');

  _bindSlotDragEvents();
  _updateFaceSlotActiveStates();
}

function _renderSlots(cat) {
  var catSlots = (_state.slotConfig[cat]) || {};
  return [1, 2, 3, 4, 5].map(function (i) {
    var entry = catSlots[String(i)] || null;
    var filled = !!entry;
    var slotCls = 'ref-slot' + (filled ? ' ref-slot-filled' : ' ref-slot-empty');
    var content = filled
      ? '<img src="' + escapeHtml(_galleryImageSrc(_state.activeCharId, entry.filename)) + '" draggable="false" loading="lazy">' +
        '<button class="ref-slot-remove" data-cat="' + cat + '" data-slot="' + i + '" title="Remove">&times;</button>' +
        '<span class="ref-slot-num">' + i + '</span>'
      : '<span class="ref-slot-num">' + i + '</span><span class="ref-slot-empty-label">empty</span>';
    return '<div class="' + slotCls + '" data-cat="' + cat + '" data-slot="' + i + '" ' +
      'draggable="' + (filled ? 'true' : 'false') + '">' +
      content +
    '</div>';
  }).join('');
}

function _bindSlotDragEvents() {
  document.querySelectorAll('.ref-slot-remove').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      _removeSlot(btn.dataset.cat, Number(btn.dataset.slot));
    };
  });

  document.querySelectorAll('.ref-slots-row').forEach(function (row) {
    var cat = row.dataset.cat;
    row.querySelectorAll('.ref-slot.ref-slot-filled').forEach(function (slot) {
      slot.addEventListener('dragstart', function (e) {
        _state.dragSrcCategory = cat;
        _state.dragSrcSlot     = Number(slot.dataset.slot);
        e.dataTransfer.effectAllowed = 'move';
        slot.classList.add('dragging');
      });
      slot.addEventListener('dragend', function () {
        slot.classList.remove('dragging');
        document.querySelectorAll('.ref-slot').forEach(function (s) { s.classList.remove('drag-over'); });
      });
    });

    row.querySelectorAll('.ref-slot').forEach(function (slot) {
      slot.addEventListener('dragover', function (e) {
        if (_state.dragSrcCategory !== cat) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.ref-slot[data-cat="' + cat + '"]').forEach(function (s) { s.classList.remove('drag-over'); });
        slot.classList.add('drag-over');
      });
      slot.addEventListener('dragleave', function () {
        slot.classList.remove('drag-over');
      });
      slot.addEventListener('drop', function (e) {
        e.preventDefault();
        slot.classList.remove('drag-over');
        var destSlot = Number(slot.dataset.slot);
        if (_state.dragSrcCategory !== cat || _state.dragSrcSlot === destSlot) return;
        _swapSlots(cat, _state.dragSrcSlot, destSlot);
      });
    });
  });
}

function _swapSlots(cat, slotA, slotB) {
  var catCfg = Object.assign({}, (_state.slotConfig[cat] || {}));
  var entryA = catCfg[String(slotA)] || null;
  var entryB = catCfg[String(slotB)] || null;
  if (entryA) catCfg[String(slotB)] = entryA; else delete catCfg[String(slotB)];
  if (entryB) catCfg[String(slotA)] = entryB; else delete catCfg[String(slotA)];
  _state.slotConfig = Object.assign({}, _state.slotConfig);
  _state.slotConfig[cat] = catCfg;
  _renderRefSlots();
  _persistSlotConfig();
}

function _removeSlot(cat, slotNum) {
  var catCfg = Object.assign({}, (_state.slotConfig[cat] || {}));
  var entry  = catCfg[String(slotNum)];
  var galleryId = entry ? entry.galleryId : null;
  delete catCfg[String(slotNum)];
  _state.slotConfig = Object.assign({}, _state.slotConfig);
  _state.slotConfig[cat] = catCfg;
  _renderRefSlots();

  if (galleryId) {
    API.unassignGalleryImage(_state.activeCharId, galleryId, { category: cat, slot: slotNum })
      .catch(function (e) {
        showToast('Failed to unassign slot: ' + e.message, 'error');
        _loadSlotConfig(_state.activeCharId);
      });
  } else {
    _persistSlotConfig();
  }
}

function _persistSlotConfig() {
  API.saveGallerySlotConfig(_state.activeCharId, _state.slotConfig).catch(function (e) {
    showToast('Failed to save slot order: ' + e.message, 'error');
  });
}

// ---------------------------------------------------------------------------
// Assign selected gallery image to a category slot
// ---------------------------------------------------------------------------
function _assignSelected(cat) {
  if (!_state.selectedGalleryId) return;
  // Find the first empty slot for this category (left to right)
  var catCfg  = _state.slotConfig[cat] || {};
  var slot    = null;
  for (var i = 1; i <= 5; i++) {
    if (!catCfg[String(i)]) { slot = i; break; }
  }
  if (!slot) {
    showToast('All ' + CAT_LABELS[cat] + ' slots are filled. Remove one first.', 'error');
    return;
  }

  var charId    = _state.activeCharId;
  var galleryId = _state.selectedGalleryId;
  var galleryRow = _state.gallery.find(function (g) { return g.id === galleryId; });
  if (!galleryRow) return;

  API.assignGalleryImage(charId, galleryId, { category: cat, slot: slot }
  ).then(function (d) {
    // Update local state immediately
    _state.slotConfig[cat] = _state.slotConfig[cat] || {};
    _state.slotConfig[cat][String(slot)] = { galleryId: galleryId, filename: d.refFilename };
    _renderRefSlots();
    showToast(CAT_LABELS[cat] + ' slot ' + slot + ' assigned', 'success');
  }).catch(function (e) {
    showToast('Assign failed: ' + e.message, 'error');
  });
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
function _injectStyles() {
  if (document.getElementById('images-view-styles')) return;
  var s = document.createElement('style');
  s.id = 'images-view-styles';
  s.textContent = [
    '.images-layout { display:flex; gap:0; flex:1; overflow:hidden; }',

    /* Left panel */
    '.images-left-panel { display:flex; flex-direction:column; width:360px; min-width:280px; max-width:420px; border-right:1px solid var(--border); overflow:hidden; flex-shrink:0; }',
    '#img-char-list { flex-shrink:0; max-height:220px; overflow-y:auto; }',
    '.img-gallery-section { display:flex; flex-direction:column; flex:1; overflow:hidden; border-top:1px solid var(--border); }',
    '.img-gallery-toolbar { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; gap:8px; flex-shrink:0; border-bottom:1px solid var(--border); }',
    '.img-gallery-char-name { font-weight:600; font-size:14px; color:var(--text-primary); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.img-gallery-toolbar-actions { display:flex; gap:6px; flex-shrink:0; }',
    '.img-assign-bar { align-items:center; gap:8px; padding:8px 14px; background:var(--accent-dim); border-bottom:1px solid rgba(124,133,245,0.25); flex-shrink:0; flex-wrap:wrap; }',
    '.img-assign-label { font-size:12px; font-weight:600; color:var(--accent); text-transform:uppercase; letter-spacing:0.05em; }',
    '.img-assign-btn { border-color:var(--accent) !important; color:var(--accent) !important; }',
    '.img-assign-btn:hover { background:var(--accent) !important; color:#fff !important; }',
    '.img-gallery-grid { flex:1; overflow-y:auto; padding:10px; display:flex; flex-wrap:wrap; gap:8px; align-content:flex-start; }',

    /* Gallery thumbnails */
    '.gallery-thumb { position:relative; width:100px; height:100px; border-radius:var(--radius-md); overflow:hidden; cursor:pointer; border:2px solid transparent; background:var(--bg-raised); flex-shrink:0; transition:border-color 0.15s; }',
    '.gallery-thumb img { width:100%; height:100%; object-fit:cover; display:block; }',
    '.gallery-thumb.selected { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-dim); }',
    '.gallery-thumb:hover { border-color:var(--border-hover); }',
    '.gallery-expand-btn { position:absolute; top:4px; right:4px; width:22px; height:22px; border-radius:50%; background:rgba(0,0,0,0.7); border:none; color:#fff; font-size:14px; cursor:pointer; display:none; align-items:center; justify-content:center; line-height:1; padding:0; }',
    '.gallery-thumb.selected .gallery-expand-btn { display:flex; }',
    '.gallery-thumb:hover .gallery-expand-btn { display:flex; }',

    /* Right panel */
    '.images-right-panel { display:flex; flex-direction:column; flex:1; overflow-y:auto; padding:0; }',
    '.ref-slots-header { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-bottom:1px solid var(--border); flex-shrink:0; flex-wrap:wrap; gap:10px; }',
    '.ref-slots-container { flex:1; overflow-y:auto; padding:16px 20px; display:flex; flex-direction:column; gap:24px; }',

    /* FaceID count control */
    '.faceid-count-control { display:flex; align-items:center; gap:10px; }',
    '.faceid-count-stepper { display:flex; align-items:center; gap:6px; background:var(--bg-raised); border:1px solid var(--border); border-radius:var(--radius-md); padding:2px 6px; }',
    '#faceid-count-val { font-size:16px; font-weight:700; color:var(--accent); min-width:18px; text-align:center; }',

    /* Reference categories */
    '.ref-category { display:flex; flex-direction:column; gap:10px; }',
    '.ref-category-header { display:flex; align-items:baseline; gap:10px; }',
    '.ref-category-label { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:var(--text-muted); }',
    '.ref-category-hint { font-size:11px; color:var(--text-faint); }',
    '.ref-slots-row { display:flex; gap:10px; flex-wrap:nowrap; }',

    /* Individual slots */
    '.ref-slot { position:relative; width:110px; height:130px; border-radius:var(--radius-md); border:2px dashed var(--border); background:var(--bg-raised); display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden; transition:border-color 0.15s, opacity 0.2s; cursor:default; flex-shrink:0; }',
    '.ref-slot.ref-slot-filled { border-style:solid; border-color:var(--border-hover); cursor:grab; }',
    '.ref-slot.ref-slot-filled:active { cursor:grabbing; }',
    '.ref-slot.ref-slot-filled img { width:100%; height:100%; object-fit:cover; display:block; }',
    '.ref-slot.slot-inactive { opacity:0.35; }',
    '.ref-slot.dragging { opacity:0.4; border-color:var(--accent); }',
    '.ref-slot.drag-over { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-dim); }',
    '.ref-slot-num { position:absolute; bottom:3px; left:5px; font-size:10px; font-weight:700; color:rgba(255,255,255,0.6); background:rgba(0,0,0,0.4); border-radius:3px; padding:1px 4px; pointer-events:none; }',
    '.ref-slot-empty-label { font-size:10px; color:var(--text-faint); margin-top:4px; }',
    '.ref-slot-remove { position:absolute; top:3px; right:3px; width:20px; height:20px; border-radius:50%; background:rgba(0,0,0,0.75); border:none; color:#fff; font-size:14px; cursor:pointer; display:none; align-items:center; justify-content:center; line-height:1; padding:0; }',
    '.ref-slot.ref-slot-filled:hover .ref-slot-remove { display:flex; }',
  ].join('\n');
  document.head.appendChild(s);
}
