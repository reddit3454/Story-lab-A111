/**
 * fontlobby-client.js - Drop-in integration library for any project.
 *
 * Handles: server auto-start (via fontlobby:// protocol), health polling,
 * font picker popup, postMessage protocol, font registry persistence,
 * @font-face injection, and graceful server shutdown.
 *
 * USAGE (minimal):
 *
 *   var fl = new FontLobbyClient({
 *     destDir: 'C:\\myproject\\fonts',
 *     onFontPicked: function(font) {
 *       // font = { family, category, filename, format, cssValue }
 *       document.querySelector('h1').style.fontFamily = font.cssValue;
 *     }
 *   });
 *
 *   // Open the picker (auto-starts server if needed):
 *   document.getElementById('pick-font-btn').onclick = function() {
 *     fl.open({ target: 'heading' });
 *   };
 *
 * USAGE (full options):
 *
 *   var fl = new FontLobbyClient({
 *     serverUrl:    'http://127.0.0.1:8383',  // default
 *     destDir:      'C:\\myproject\\fonts',     // where font files get copied
 *     registryKey:  'myproject-fontlobby',      // localStorage key (default: 'fontlobby-fonts')
 *     onFontPicked: function(font) { ... },     // called after a font is picked + applied
 *     onError:      function(msg) { ... },      // called on errors
 *     onStatus:     function(msg) { ... },      // called with status updates like 'Starting server...'
 *     autoShutdown: true                        // shut down server when done (default: true)
 *   });
 *
 *   // Load previously imported fonts (call on page load):
 *   fl.loadFonts();
 *
 *   // Open picker:
 *   fl.open({ target: 'body-font', existingFonts: ['Arial', 'Roboto'] });
 *
 *   // Manually shut down server:
 *   fl.shutdown();
 *
 *   // Get all imported fonts:
 *   var fonts = fl.getRegistry();  // returns array of font objects
 */

(function(root) {
  'use strict';

  var DEFAULTS = {
    serverUrl: 'http://127.0.0.1:8383',
    destDir: '',
    registryKey: 'fontlobby-fonts',
    onFontPicked: function() {},
    onError: function() {},
    onStatus: function() {},
    autoShutdown: true,
    pollInterval: 500,
    pollTimeout: 15000,
    shutdownDelay: 1500
  };

  function FontLobbyClient(opts) {
    opts = opts || {};
    for (var key in DEFAULTS) {
      this[key] = (opts[key] !== undefined) ? opts[key] : DEFAULTS[key];
    }
    this._popup = null;
    this._popupCheck = null;
    this._messageHandler = null;
  }

  // --- Public API ---

  /**
   * Load previously imported fonts from localStorage + shared registry file.
   * Injects @font-face rules so they render immediately.
   * Returns the array of font objects found.
   */
  FontLobbyClient.prototype.loadFonts = function() {
    var local = this._readLocalRegistry();

    // Inject all local fonts immediately
    for (var i = 0; i < local.length; i++) {
      this._injectFontFace(local[i].family, local[i].filename, local[i].format);
    }

    // Also try the shared on-disk registry (works from file:// for same-dir)
    this._loadSharedRegistry(local);

    return local;
  };

  /**
   * Open the FontLobby picker popup. Auto-starts the server if it isn't running.
   *
   * opts.target        - label string passed to FontLobby (e.g. 'title')
   * opts.existingFonts - array of family names already available in the project
   */
  FontLobbyClient.prototype.open = function(opts) {
    opts = opts || {};
    var self = this;
    var target = opts.target || 'default';
    var existingFonts = opts.existingFonts || this._registryFamilies();

    // Attach message listener
    this._attachMessageListener(target, existingFonts);

    this.onStatus('Checking...');

    this._checkHealth(function(ok) {
      if (ok) {
        self.onStatus('');
        self._launchPopup(target, existingFonts);
      } else {
        self.onStatus('Starting server...');
        self._triggerStart();
        self._pollUntilReady(function(success) {
          if (success) {
            self.onStatus('');
            self._launchPopup(target, existingFonts);
          } else {
            self.onStatus('');
            self.onError('FontLobby server failed to start. Make sure the fontlobby:// protocol handler is installed.');
          }
        });
      }
    });
  };

  /**
   * Shut down the FontLobby server gracefully.
   */
  FontLobbyClient.prototype.shutdown = function() {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', this.serverUrl + '/api/shutdown', true);
    xhr.timeout = 3000;
    xhr.onerror = function() {};
    xhr.ontimeout = function() {};
    try { xhr.send(); } catch (e) {}
  };

  /**
   * Get all fonts in the local registry.
   */
  FontLobbyClient.prototype.getRegistry = function() {
    return this._readLocalRegistry();
  };

  /**
   * Manually register a font into the local registry and inject its @font-face.
   */
  FontLobbyClient.prototype.registerFont = function(family, category, filename, format) {
    var fallback = (category === 'serif') ? 'serif' : 'sans-serif';
    var cssValue = "'" + family + "', " + fallback;
    this._injectFontFace(family, filename, format);
    this._saveToRegistry({ family: family, category: category, filename: filename, format: format, cssValue: cssValue });
    return cssValue;
  };

  // --- Private: Server lifecycle ---

  FontLobbyClient.prototype._checkHealth = function(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', this.serverUrl + '/api/health', true);
    xhr.timeout = 2000;
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      callback(xhr.status === 200);
    };
    xhr.onerror = function() { callback(false); };
    xhr.ontimeout = function() { callback(false); };
    try { xhr.send(); } catch (e) { callback(false); }
  };

  FontLobbyClient.prototype._triggerStart = function() {
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = 'fontlobby://start';
    document.body.appendChild(iframe);
    setTimeout(function() {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 3000);
  };

  FontLobbyClient.prototype._pollUntilReady = function(callback) {
    var self = this;
    var maxAttempts = Math.ceil(this.pollTimeout / this.pollInterval);
    var attempts = 0;

    // Wait a beat before first poll to give server time to boot
    setTimeout(function poll() {
      attempts++;
      self._checkHealth(function(ok) {
        if (ok) {
          callback(true);
        } else if (attempts >= maxAttempts) {
          callback(false);
        } else {
          setTimeout(poll, self.pollInterval);
        }
      });
    }, 1000);
  };

  // --- Private: Popup management ---

  FontLobbyClient.prototype._launchPopup = function(target, existingFonts) {
    var self = this;
    var url = this.serverUrl + '/src/ui/index.html?pick=true&target=' + encodeURIComponent(target);
    this._popup = window.open(url, 'fontlobby-picker', 'width=1100,height=750,scrollbars=yes,resizable=yes');

    // Watch for popup closing without a pick
    if (this._popupCheck) clearInterval(this._popupCheck);
    this._popupCheck = setInterval(function() {
      if (self._popup && self._popup.closed) {
        // Closed without picking (pick handler nulls _popup first)
        clearInterval(self._popupCheck);
        self._popupCheck = null;
        self._popup = null;
        self._detachMessageListener();
        if (self.autoShutdown) setTimeout(function() { self.shutdown(); }, 500);
      } else if (!self._popup) {
        // Pick was received - stop watching (shutdown already scheduled by pick handler)
        clearInterval(self._popupCheck);
        self._popupCheck = null;
      }
    }, 500);
  };

  // --- Private: postMessage protocol ---

  FontLobbyClient.prototype._attachMessageListener = function(target, existingFonts) {
    var self = this;
    this._detachMessageListener();

    this._messageHandler = function(e) {
      if (!e.data || !e.data.type) return;

      if (e.data.type === 'fontlobby-ready') {
        if (self._popup) {
          self._popup.postMessage({
            type: 'fontlobby-init',
            existingFonts: existingFonts,
            destDir: self.destDir
          }, '*');
        }
        return;
      }

      if (e.data.type === 'fontlobby-pick') {
        var font = e.data.font;
        var copied = e.data.copied || {};
        if (!font || !font.family) return;

        var category = font.category || 'sans-serif';
        var fallback = (category === 'serif') ? 'serif' : 'sans-serif';
        var cssValue = "'" + font.family + "', " + fallback;

        var result = {
          family: font.family,
          category: category,
          filename: copied.filename || '',
          format: '',
          cssValue: cssValue,
          copySuccess: !!(copied.success)
        };

        if (copied.filename) {
          result.format = self._getFormat(copied.filename);
        }

        // Inject @font-face and save to registry if copy succeeded
        if (copied.filename && copied.success) {
          self._injectFontFace(font.family, copied.filename, result.format);
          self._saveToRegistry({
            family: font.family,
            category: category,
            filename: copied.filename,
            format: result.format,
            cssValue: cssValue
          });
        }

        // Null popup BEFORE callback so popup watcher knows pick happened
        self._popup = null;
        self._detachMessageListener();

        // Notify consumer
        self.onFontPicked(result);

        // Schedule shutdown
        if (self.autoShutdown) {
          setTimeout(function() { self.shutdown(); }, self.shutdownDelay);
        }
      }
    };

    window.addEventListener('message', this._messageHandler);
  };

  FontLobbyClient.prototype._detachMessageListener = function() {
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }
  };

  // --- Private: Font registry & injection ---

  FontLobbyClient.prototype._injectFontFace = function(family, filename, format) {
    var styleEl = document.getElementById('fontlobby-client-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'fontlobby-client-styles';
      document.head.appendChild(styleEl);
    }
    // Avoid duplicates
    if (styleEl.textContent.indexOf("font-family: '" + family + "'") !== -1) return;
    var rule = "@font-face {\n" +
      "  font-family: '" + family + "';\n" +
      "  src: url('./fonts/" + filename + "') format('" + format + "');\n" +
      "  font-display: swap;\n" +
      "}\n";
    styleEl.textContent += rule;
  };

  FontLobbyClient.prototype._readLocalRegistry = function() {
    var raw = localStorage.getItem(this.registryKey);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  };

  FontLobbyClient.prototype._saveToRegistry = function(entry) {
    var fonts = this._readLocalRegistry();
    for (var i = 0; i < fonts.length; i++) {
      if (fonts[i].family === entry.family) return; // already exists
    }
    fonts.push(entry);
    localStorage.setItem(this.registryKey, JSON.stringify(fonts));
  };

  FontLobbyClient.prototype._registryFamilies = function() {
    var fonts = this._readLocalRegistry();
    var families = [];
    for (var i = 0; i < fonts.length; i++) {
      families.push(fonts[i].family);
    }
    return families;
  };

  FontLobbyClient.prototype._loadSharedRegistry = function(localFonts) {
    var self = this;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', './fonts/fontlobby-registry.json', true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      if (xhr.status !== 200 && xhr.status !== 0) return;
      var text = xhr.responseText;
      if (!text) return;
      try {
        var shared = JSON.parse(text);
        if (!Array.isArray(shared)) return;
        var localMap = {};
        for (var i = 0; i < localFonts.length; i++) {
          localMap[localFonts[i].family] = true;
        }
        var added = [];
        for (var j = 0; j < shared.length; j++) {
          if (!localMap[shared[j].family]) {
            self._injectFontFace(shared[j].family, shared[j].filename, shared[j].format);
            added.push(shared[j]);
          }
        }
        if (added.length > 0) {
          var merged = localFonts.concat(added);
          localStorage.setItem(self.registryKey, JSON.stringify(merged));
        }
      } catch (e) {}
    };
    try { xhr.send(); } catch (e) {}
  };

  FontLobbyClient.prototype._getFormat = function(filename) {
    var ext = filename.split('.').pop().toLowerCase();
    var formats = { 'ttf': 'truetype', 'otf': 'opentype', 'woff': 'woff', 'woff2': 'woff2' };
    return formats[ext] || 'truetype';
  };

  // --- Export ---
  root.FontLobbyClient = FontLobbyClient;

})(typeof window !== 'undefined' ? window : this);
