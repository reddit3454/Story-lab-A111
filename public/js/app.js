import { state } from './state.js';
import { startStatusPolling, showToast, showConfirm, setLoading } from './ui.js';
import { initDashboard } from './views/dashboard.js';
import { initCharacters } from './views/characters.js';
import { initScenarioSetup } from './views/scenario-setup.js';
import { initPlay } from './views/play.js';
import { connectWs } from './views/play.js';
import { initSettings } from './views/settings.js';
import { initLocations } from './views/locations.js';

// Expose UI helpers so non-module scripts (locations-init.js) can use them
window.showToast   = showToast;
window.showConfirm = showConfirm;
window.setLoading  = setLoading;

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
  else if (view === 'locations')      { activate('view-locations');      initLocations(params.get('scenario')); }
  else    { location.hash = '#dashboard'; }
}

export function activate(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('active');
}

/* ============================================================
   BOOT
   ============================================================ */

startStatusPolling();

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
