import { state } from './state.js';
import { openLightbox, closeLightbox, startStatusPolling } from './ui.js';
import { initDashboard } from './views/dashboard.js';
import { initCharacters } from './views/characters.js';
import { initScenarioSetup } from './views/scenario-setup.js';
import { initStyles } from './views/styles.js';
import { initPlay } from './views/play.js';
import { connectWs } from './views/play.js';
import { initSettings } from './views/settings.js';

export function router() {
  state.cleanupFns.forEach(function (fn) { try { fn(); } catch (e) {} });
  state.cleanupFns = [];

  var hash = location.hash.replace('#', '') || 'dashboard';
  var parts = hash.split('?');
  var view  = parts[0];
  var params = new URLSearchParams(parts[1] || '');

  document.querySelectorAll('.view').forEach(function (v) {
    v.classList.remove('active');
    v.innerHTML = '';
  });

  if      (view === 'dashboard')      { activate('view-dashboard');      initDashboard(); }
  else if (view === 'characters')     { activate('view-characters');     initCharacters(); }
  else if (view === 'scenario-setup') { activate('view-scenario-setup'); initScenarioSetup(params.get('id')); }
  else if (view === 'play')           { activate('view-play');           initPlay(params.get('scenario')); }
  else if (view === 'settings')       { activate('view-settings');       initSettings(); }
  else if (view === 'styles')         { activate('view-styles');         initStyles(params.get('scenario')); }
  else    { location.hash = '#dashboard'; }
}

export function activate(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('active');
}

/* ============================================================
   BOOT
   ============================================================ */

// Lightbox overlay
(function () {
  var lb = document.createElement('div');
  lb.id = 'story-lightbox';
  lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;align-items:center;justify-content:center;cursor:zoom-out;';
  var lbImg = document.createElement('img');
  lbImg.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:8px;object-fit:contain;';
  lb.appendChild(lbImg);
  lb.onclick = closeLightbox;
  document.body.appendChild(lb);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(); });
}());

// Image status panel with progress bar
(function () {
  var panel = document.createElement('div');
  panel.id = 'img-status-panel';

  var text = document.createElement('div');
  text.id = 'img-status-text';

  var track = document.createElement('div');
  track.id = 'img-status-bar-track';

  var fill = document.createElement('div');
  fill.id = 'img-status-bar-fill';

  track.appendChild(fill);
  panel.appendChild(text);
  panel.appendChild(track);
  document.body.appendChild(panel);
}());

// Global click delegation for lightbox on data-lightbox-src images
document.addEventListener('click', function (e) {
  var el = e.target;
  if (el.tagName === 'IMG' && el.dataset.lightboxSrc) {
    e.preventDefault();
    openLightbox(el.dataset.lightboxSrc);
  }
});

startStatusPolling();

// Listen for ImageCore embed generate-done events
window.addEventListener('message', function (evt) {
  if (evt.origin !== 'http://localhost:4000') return;
  if (!evt.data || evt.data.type !== 'imagecore-generate-done') return;
  var genId    = evt.data.genId    || null;
  var filename = evt.data.filename || null;
  console.log('[story-lab] ImageCore generate done - genId:', genId, 'filename:', filename);
  // Future: auto-insert generated image into active scene or chat
});

connectWs();
window.addEventListener('hashchange', router);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    if (!location.hash || location.hash === '#') location.hash = '#dashboard';
    router();
    if (typeof FontPainter !== 'undefined') FontPainter.init();
  });
} else {
  if (!location.hash || location.hash === '#') location.hash = '#dashboard';
  router();
  if (typeof FontPainter !== 'undefined') FontPainter.init();
}
