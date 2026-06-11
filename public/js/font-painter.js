/**
 * font-painter.js
 * Click-to-assign-font mode for Story-Lab.
 *
 * When active:
 *  - Cursor changes to a crosshair.
 *  - Hoverable text elements glow to show they are targets.
 *  - Clicking any text element opens the Font Lobby picker.
 *  - The picked font is applied to that element and persisted in localStorage.
 *
 * Persisted assignments survive page refresh by storing
 * { selector, fontFamily, cssValue } in localStorage under 'font-painter-assignments'.
 *
 * Text targets are resolved by CSS selector so the same element can be
 * re-identified after a re-render.  If the element has no id/class the
 * painter falls back to a structural nth-child path (best-effort).
 */

(function (root) {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────

  var STORAGE_KEY     = 'font-painter-assignments';
  var TOGGLE_BTN_ID   = 'font-painter-toggle';
  var STYLE_TAG_ID    = 'font-painter-styles';
  var ACTIVE_CLASS    = 'font-painter-active';   // on <body>
  var TARGET_CLASS    = 'font-painter-target';   // on hovered elements

  // CSS selectors that are considered paintable text zones.
  // Add more here if new text containers are introduced to the UI.
  var PAINTABLE_SELECTORS = [
    '.turn-text',
    '.turn-speaker',
    '.play-title',
    '.story-font',
    '.sidebar-content h1, .sidebar-content h2, .sidebar-content h3',
    '.char-name',
    '.scenario-title',
    '.dashboard-title',
    '.card-title',
    'h1, h2, h3',
    'p',
    'label',
    '.btn',
    '.tab-label',
    '.stab',
    '.section-title',
    '.settings-label',
    '.form-label'
  ].join(', ');

  // FontLobby server URL (matches fontlobby-client.js default)
  var FL_SERVER = 'http://127.0.0.1:8080';
  var FL_DEST   = 'E:/TheHub/projects/story-lab/public/fonts';

  // ─── State ─────────────────────────────────────────────────────────────────

  var _active          = false;
  var _fl              = null;   // FontLobbyClient instance
  var _pendingTarget   = null;   // DOM element waiting for font pick
  var _clickHandler    = null;
  var _moveHandler     = null;
  var _lastHovered     = null;

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    _injectBaseStyles();
    _createToggleButton();
    _initFontLobby();
    _restoreAssignments();
  }

  // ─── Toggle Button ─────────────────────────────────────────────────────────

  function _createToggleButton() {
    if (document.getElementById(TOGGLE_BTN_ID)) return;

    var btn = document.createElement('button');
    btn.id        = TOGGLE_BTN_ID;
    btn.title     = 'Font Painter — click to toggle. When active, click any text to change its font.';
    btn.innerHTML = '&#9998;'; // pencil icon
    btn.setAttribute('aria-pressed', 'false');

    btn.addEventListener('click', function () {
      _active ? _deactivate() : _activate();
    });

    document.body.appendChild(btn);
  }

  // ─── Activate / Deactivate ─────────────────────────────────────────────────

  function _activate() {
    _active = true;
    document.body.classList.add(ACTIVE_CLASS);
    document.getElementById(TOGGLE_BTN_ID).setAttribute('aria-pressed', 'true');
    document.getElementById(TOGGLE_BTN_ID).classList.add('fp-on');

    _moveHandler = function (e) {
      var el = _closestPaintable(e.target);
      if (el === _lastHovered) return;
      if (_lastHovered) _lastHovered.classList.remove(TARGET_CLASS);
      if (el) {
        el.classList.add(TARGET_CLASS);
        _lastHovered = el;
      } else {
        _lastHovered = null;
      }
    };

    _clickHandler = function (e) {
      var el = _closestPaintable(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      _pendingTarget = el;
      _fl.open({ target: _selectorFor(el) });
    };

    document.addEventListener('mousemove', _moveHandler, true);
    document.addEventListener('click',     _clickHandler, true);
  }

  function _deactivate() {
    _active = false;
    document.body.classList.remove(ACTIVE_CLASS);
    var btn = document.getElementById(TOGGLE_BTN_ID);
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('fp-on');
    }
    if (_lastHovered) {
      _lastHovered.classList.remove(TARGET_CLASS);
      _lastHovered = null;
    }
    if (_moveHandler) document.removeEventListener('mousemove', _moveHandler, true);
    if (_clickHandler) document.removeEventListener('click',    _clickHandler, true);
    _moveHandler  = null;
    _clickHandler = null;
  }

  // ─── FontLobby wiring ──────────────────────────────────────────────────────

  function _initFontLobby() {
    if (typeof FontLobbyClient === 'undefined') {
      console.warn('[font-painter] FontLobbyClient not loaded — font picking disabled.');
      return;
    }
    _fl = new FontLobbyClient({
      serverUrl:    FL_SERVER,
      destDir:      FL_DEST,
      registryKey:  'story-lab-fontlobby',
      autoShutdown: false,   // keep server alive between picks
      onFontPicked: function (font) {
        if (!_pendingTarget) return;
        _applyFont(_pendingTarget, font);
        _saveAssignment(_pendingTarget, font);
        _pendingTarget = null;
      },
      onError: function (msg) {
        console.warn('[font-painter] FontLobby error:', msg);
        _pendingTarget = null;
      }
    });
    _fl.loadFonts();
  }

  // ─── Apply & Persist ───────────────────────────────────────────────────────

  function _applyFont(el, font) {
    el.style.fontFamily = font.cssValue;
    // If the element uses the CSS variable path, also patch the variable
    // so children that inherit via var(--font-story) update too.
    if (el.classList.contains('story-font') || el.closest('.play-thread')) {
      document.documentElement.style.setProperty('--font-story', font.cssValue);
    }
  }

  function _saveAssignment(el, font) {
    var sel  = _selectorFor(el);
    var list = _loadAssignments();
    // Remove any existing entry for this selector
    list = list.filter(function (a) { return a.selector !== sel; });
    list.push({ selector: sel, fontFamily: font.family, cssValue: font.cssValue });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function _loadAssignments() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function _restoreAssignments() {
    // Re-apply on DOM mutations so assignments survive re-renders
    var list = _loadAssignments();
    if (!list.length) return;

    function applyAll() {
      list.forEach(function (a) {
        try {
          document.querySelectorAll(a.selector).forEach(function (el) {
            el.style.fontFamily = a.cssValue;
          });
          // Also restore CSS variable if assignment covers story-font
          if (a.selector.indexOf('story-font') !== -1 || a.selector.indexOf('turn-text') !== -1) {
            document.documentElement.style.setProperty('--font-story', a.cssValue);
          }
        } catch (_) {}
      });
    }

    applyAll();

    // Watch for view changes / re-renders and re-apply
    var observer = new MutationObserver(function () { applyAll(); });
    observer.observe(document.getElementById('app') || document.body, {
      childList: true,
      subtree:   true
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function _closestPaintable(el) {
    if (!el || el === document.body) return null;
    if (el.matches && el.matches(PAINTABLE_SELECTORS)) return el;
    return el.closest ? el.closest(PAINTABLE_SELECTORS) : null;
  }

  /**
   * Build a stable CSS selector for an element so we can persist and restore
   * font assignments across re-renders.  Priority:
   *   1. #id (most stable)
   *   2. .meaningful-class (stable if unique enough)
   *   3. tag + nth-child structural path (fragile but last resort)
   */
  function _selectorFor(el) {
    if (el.id) return '#' + el.id;

    // Use first meaningful class (skip utility/state classes)
    var skipClasses = [TARGET_CLASS, ACTIVE_CLASS, 'active', 'hidden', 'loading', 'btn-sm', 'btn-ghost'];
    var classes = Array.prototype.slice.call(el.classList).filter(function (c) {
      return skipClasses.indexOf(c) === -1;
    });
    if (classes.length) return '.' + classes[0];

    // Structural fallback
    return _structuralPath(el);
  }

  function _structuralPath(el) {
    var parts = [];
    var current = el;
    while (current && current !== document.body) {
      var tag   = current.tagName.toLowerCase();
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.prototype.slice.call(parent.children).filter(function (c) {
          return c.tagName === current.tagName;
        });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(current) + 1;
          tag += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(tag);
      current = parent;
    }
    return parts.join(' > ');
  }

  // ─── Styles ────────────────────────────────────────────────────────────────

  function _injectBaseStyles() {
    if (document.getElementById(STYLE_TAG_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    style.textContent = [

      /* ── Toggle button ── */
      '#' + TOGGLE_BTN_ID + ' {',
      '  position: fixed;',
      '  bottom: 18px;',
      '  right: 18px;',
      '  z-index: 9000;',
      '  width: 36px;',
      '  height: 36px;',
      '  border-radius: 50%;',
      '  border: 1px solid rgba(255,255,255,0.15);',
      '  background: rgba(30,30,40,0.82);',
      '  color: rgba(255,255,255,0.45);',
      '  font-size: 16px;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  backdrop-filter: blur(6px);',
      '  transition: background 0.2s, color 0.2s, box-shadow 0.2s;',
      '  box-shadow: 0 2px 8px rgba(0,0,0,0.4);',
      '}',
      '#' + TOGGLE_BTN_ID + ':hover {',
      '  background: rgba(50,50,70,0.92);',
      '  color: rgba(255,255,255,0.75);',
      '}',
      '#' + TOGGLE_BTN_ID + '.fp-on {',
      '  background: rgba(130,90,255,0.85);',
      '  color: #fff;',
      '  box-shadow: 0 0 0 3px rgba(130,90,255,0.35), 0 2px 10px rgba(0,0,0,0.5);',
      '}',

      /* ── Active mode — crosshair cursor everywhere ── */
      'body.' + ACTIVE_CLASS + ' * { cursor: crosshair !important; }',

      /* ── Hover highlight on paintable targets ── */
      '.' + TARGET_CLASS + ' {',
      '  outline: 2px dashed rgba(130,90,255,0.7) !important;',
      '  outline-offset: 3px;',
      '  border-radius: 3px;',
      '  background-color: rgba(130,90,255,0.08) !important;',
      '  transition: outline 0.1s, background-color 0.1s;',
      '}'

    ].join('\n');
    document.head.appendChild(style);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  root.FontPainter = {
    init:       init,
    activate:   _activate,
    deactivate: _deactivate,
    isActive:   function () { return _active; },
    clearAll:   function () {
      localStorage.removeItem(STORAGE_KEY);
      document.querySelectorAll('[style*="font-family"]').forEach(function (el) {
        el.style.fontFamily = '';
      });
      document.documentElement.style.removeProperty('--font-story');
    }
  };

})(typeof window !== 'undefined' ? window : this);
