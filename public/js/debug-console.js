/**
 * story-lab - Debug Console
 *
 * Injects a live log viewer panel into the page. Receives logline WS events
 * from play.js and renders them colour-coded by category.
 *
 * API: window._debugConsole = { push(data), toggle(), clear() }
 * Shortcut: Ctrl+` (backtick)
 */
(function () {
  'use strict';

  var BUFFER_MAX = 500;
  var _buf = [];
  var _panel = null;
  var _body = null;
  var _filter = null;
  var _atBottom = true;

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  var CSS = [
    '#dc-panel {',
    '  position:fixed; bottom:0; left:0; right:0; height:220px;',
    '  background:rgba(10,10,15,0.93); backdrop-filter:blur(4px);',
    '  z-index:9999; display:none; flex-direction:column;',
    '  font-family:monospace; font-size:12px; color:#d1d5db;',
    '  border-top:1px solid #333; box-sizing:border-box;',
    '}',
    '#dc-resizer {',
    '  position:absolute; top:0; left:0; right:0; height:5px;',
    '  cursor:ns-resize; z-index:1;',
    '}',
    '#dc-header {',
    '  display:flex; align-items:center; gap:6px; padding:3px 8px;',
    '  background:rgba(20,20,28,0.98); border-bottom:1px solid #333;',
    '  flex-shrink:0; user-select:none;',
    '}',
    '#dc-header span.dc-title { font-weight:bold; color:#9ca3af; margin-right:4px; }',
    '#dc-filter {',
    '  flex:1; background:#1a1a2a; border:1px solid #444; color:#d1d5db;',
    '  padding:2px 6px; font-family:monospace; font-size:11px; border-radius:3px;',
    '}',
    '#dc-body {',
    '  flex:1; overflow-y:auto; padding:4px 8px;',
    '}',
    '.dc-btn {',
    '  background:#222; border:1px solid #555; color:#aaa;',
    '  padding:2px 7px; cursor:pointer; font-size:11px; border-radius:3px;',
    '}',
    '.dc-btn:hover { background:#333; }',
    '.dcl { white-space:pre-wrap; line-height:1.5; padding:0; margin:0; }',
    '.dc-ts  { color:#555; margin-right:6px; }',
    '.dc-cat { margin-right:6px; font-weight:bold; }',
    '.dcl-ERROR .dc-cat  { color:#ff6b6b; }',
    '.dcl-VIDEO .dc-cat  { color:#c084fc; }',
    '.dcl-IMAGE .dc-cat  { color:#60a5fa; }',
    '.dcl-SERVER .dc-cat { color:#4ade80; }',
    '.dcl-WS .dc-cat     { color:#2dd4bf; }',
    '.dcl-DB .dc-cat     { color:#fb923c; }',
    '.dcl-CHAT .dc-cat   { color:#9ca3af; }',
    '.dcl-MODEL .dc-cat  { color:#9ca3af; }',
    '#dc-toggle-btn {',
    '  position:fixed; bottom:12px; right:12px; z-index:10000;',
    '  background:#1a1a2a; border:1px solid #555; color:#9ca3af;',
    '  padding:5px 10px; cursor:pointer; font-family:monospace; font-size:12px;',
    '  border-radius:4px;',
    '}',
    '#dc-toggle-btn:hover { background:#222; }'
  ].join('\n');

  function _injectStyles() {
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------------
  // Panel DOM
  // ---------------------------------------------------------------------------

  function _buildPanel() {
    _panel = document.createElement('div');
    _panel.id = 'dc-panel';

    var resizer = document.createElement('div');
    resizer.id = 'dc-resizer';
    _panel.appendChild(resizer);

    var header = document.createElement('div');
    header.id = 'dc-header';

    var title = document.createElement('span');
    title.className = 'dc-title';
    title.textContent = 'Debug Console';

    _filter = document.createElement('input');
    _filter.id = 'dc-filter';
    _filter.type = 'text';
    _filter.placeholder = 'filter...';
    _filter.addEventListener('input', _applyFilter);

    var clearBtn = document.createElement('button');
    clearBtn.className = 'dc-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', function () { window._debugConsole.clear(); });

    var copyBtn = document.createElement('button');
    copyBtn.className = 'dc-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', _copyVisible);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'dc-btn';
    closeBtn.textContent = 'x';
    closeBtn.addEventListener('click', function () { window._debugConsole.toggle(); });

    header.appendChild(title);
    header.appendChild(_filter);
    header.appendChild(clearBtn);
    header.appendChild(copyBtn);
    header.appendChild(closeBtn);
    _panel.appendChild(header);

    _body = document.createElement('div');
    _body.id = 'dc-body';
    _body.addEventListener('scroll', function () {
      _atBottom = (_body.scrollTop + _body.clientHeight) >= (_body.scrollHeight - 10);
    });
    _panel.appendChild(_body);

    document.body.appendChild(_panel);

    _wireResizer(resizer);
  }

  function _buildToggleBtn() {
    var btn = document.createElement('button');
    btn.id = 'dc-toggle-btn';
    btn.textContent = 'LOG';
    btn.addEventListener('click', function () { window._debugConsole.toggle(); });
    document.body.appendChild(btn);
  }

  // ---------------------------------------------------------------------------
  // Resize by dragging top edge
  // ---------------------------------------------------------------------------

  function _wireResizer(resizer) {
    var startY, startH;
    resizer.addEventListener('mousedown', function (e) {
      startY = e.clientY;
      startH = _panel.offsetHeight;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });
    function onMouseMove(e) {
      var delta = startY - e.clientY;
      var newH = Math.max(80, Math.min(window.innerHeight * 0.8, startH + delta));
      _panel.style.height = newH + 'px';
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function _makeLine(entry) {
    var div = document.createElement('div');
    var cat = (entry.cat || '').toUpperCase();
    div.className = 'dcl dcl-' + cat;

    var ts = document.createElement('span');
    ts.className = 'dc-ts';
    ts.textContent = entry.ts || '';

    var catSpan = document.createElement('span');
    catSpan.className = 'dc-cat';
    catSpan.textContent = '[' + cat + ']';

    var msg = document.createElement('span');
    msg.className = 'dc-msg';
    msg.textContent = entry.msg || '';

    div.appendChild(ts);
    div.appendChild(catSpan);
    div.appendChild(msg);
    return div;
  }

  function _matchesFilter(entry) {
    var q = (_filter && _filter.value || '').trim().toLowerCase();
    if (!q) return true;
    return (entry.cat || '').toLowerCase().includes(q) || (entry.msg || '').toLowerCase().includes(q);
  }

  function _applyFilter() {
    if (!_body) return;
    var children = _body.children;
    var q = (_filter.value || '').trim().toLowerCase();
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      if (!q) {
        el.style.display = '';
      } else {
        var catEl  = el.querySelector('.dc-cat');
        var msgEl  = el.querySelector('.dc-msg');
        var catTxt = (catEl  ? catEl.textContent  : '').toLowerCase();
        var msgTxt = (msgEl  ? msgEl.textContent  : '').toLowerCase();
        el.style.display = (catTxt.includes(q) || msgTxt.includes(q)) ? '' : 'none';
      }
    }
    if (_atBottom) _scrollToBottom();
  }

  function _scrollToBottom() {
    if (_body) _body.scrollTop = _body.scrollHeight;
  }

  // ---------------------------------------------------------------------------
  // Copy visible lines
  // ---------------------------------------------------------------------------

  function _copyVisible() {
    var lines = [];
    if (_body) {
      var children = _body.children;
      for (var i = 0; i < children.length; i++) {
        if (children[i].style.display !== 'none') {
          lines.push(children[i].textContent);
        }
      }
    }
    var text = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcut
  // ---------------------------------------------------------------------------

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key === '`') {
      window._debugConsole.toggle();
      e.preventDefault();
    }
  });

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  window._debugConsole = {
    push: function (data) {
      if (_buf.length >= BUFFER_MAX) _buf.shift();
      _buf.push(data);
      if (_panel && _panel.style.display !== 'none') {
        if (_matchesFilter(data)) {
          _body.appendChild(_makeLine(data));
          if (_atBottom) _scrollToBottom();
        }
      }
    },
    toggle: function () {
      if (!_panel) return;
      if (_panel.style.display === 'none' || _panel.style.display === '') {
        _panel.style.display = 'flex';
        // Re-render buffer on open
        _body.innerHTML = '';
        for (var i = 0; i < _buf.length; i++) {
          if (_matchesFilter(_buf[i])) {
            _body.appendChild(_makeLine(_buf[i]));
          }
        }
        _scrollToBottom();
        _atBottom = true;
      } else {
        _panel.style.display = 'none';
      }
    },
    clear: function () {
      _buf = [];
      if (_body) _body.innerHTML = '';
    }
  };

  // ---------------------------------------------------------------------------
  // Init on DOMContentLoaded
  // ---------------------------------------------------------------------------

  function _init() {
    _injectStyles();
    _buildPanel();
    _buildToggleBtn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
