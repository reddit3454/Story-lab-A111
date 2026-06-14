import { state } from './state.js';
import { escapeHtml, imageSrc } from './utils.js';

export function openLightbox(src) {
  var lb = document.getElementById('story-lightbox');
  if (!lb) return;
  lb.querySelector('img').src = src;
  lb.style.display = 'flex';
}

export function closeLightbox() {
  var lb = document.getElementById('story-lightbox');
  if (lb) lb.style.display = 'none';
}

var _IMG_STAGE_PCT = {
  'Preparing image...':           10,
  'Analyzing scene...':           25,
  'Enhancing prompt...':          50,
  'Sending to image generator...': 70
};

export function setImgStatus(msg) {
  var panel = document.getElementById('img-status-panel');
  if (!panel) return;
  var text = document.getElementById('img-status-text');
  var fill = document.getElementById('img-status-bar-fill');
  if (!msg) {
    if (fill) { fill.classList.remove('img-bar-pulse'); fill.style.width = '100%'; }
    setTimeout(function () { panel.style.display = 'none'; }, 350);
    return;
  }
  panel.style.display = 'block';
  if (text) text.textContent = msg;
  if (fill) {
    var pct = _IMG_STAGE_PCT[msg];
    if (!pct) {
      if (msg.indexOf('Building image') !== -1) pct = 50;
      else pct = 20;
    }
    fill.classList.remove('img-bar-pulse');
    if (pct >= 70) {
      fill.classList.add('img-bar-pulse');
      fill.style.width = '';
    } else {
      fill.style.width = pct + '%';
    }
  }
}

/* ============================================================
   SERVICE STATUS DOTS
   ============================================================ */
export function statusDotsHtml() {
  var a1Cls = state.a1111Ok  === true ? ' ok' : state.a1111Ok  === false ? ' down' : '';
  var olCls = state.ollamaOk === true ? ' ok' : state.ollamaOk === false ? ' down' : '';
  return '<span class="service-status">' +
    '<span class="status-dot' + a1Cls + '" data-svc="a1111"></span>' +
    '<span class="status-lbl">A1111</span>' +
    '<span class="status-dot' + olCls + '" data-svc="ollama" style="margin-left:10px"></span>' +
    '<span class="status-lbl">Ollama</span>' +
  '</span>';
}

export function updateStatusDots(svc, ok) {
  if      (svc === 'a1111')  state.a1111Ok  = ok;
  else if (svc === 'ollama') state.ollamaOk = ok;
  document.querySelectorAll('.status-dot[data-svc="' + svc + '"]').forEach(function (d) {
    d.classList.toggle('ok',   ok === true);
    d.classList.toggle('down', ok === false);
  });
}

export function startStatusPolling() {
  function checkA1111() {
    API.getHealthA1111()
      .then(function (d) { updateStatusDots('a1111', !!d.ok); })
      .catch(function ()  { updateStatusDots('a1111', false); });
  }
  function checkOllama() {
    API.getHealthOllama()
      .then(function (d) { updateStatusDots('ollama', !!d.ok); })
      .catch(function ()  { updateStatusDots('ollama', false); });
  }
  checkA1111();
  checkOllama();
  setInterval(checkA1111,  15000);
  setInterval(checkOllama, 30000);
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */
export function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      toast.classList.add('visible');
    });
  });
  function dismiss() {
    toast.classList.remove('visible');
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }
  var timer = setTimeout(dismiss, 4000);
  toast.addEventListener('click', function () { clearTimeout(timer); dismiss(); });
}

/* ============================================================
   CONFIRM MODAL
   ============================================================ */
export function showConfirm(title, message, onConfirm, confirmClass) {
  confirmClass = confirmClass || 'btn-danger';
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML =
    '<div class="modal">' +
      '<h3 class="modal-title">' + escapeHtml(title) + '</h3>' +
      '<p class="modal-message">' + escapeHtml(message) + '</p>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" id="modal-cancel">Cancel</button>' +
        '<button class="btn ' + confirmClass + '" id="modal-confirm">Confirm</button>' +
      '</div>' +
    '</div>';
  overlay.classList.remove('hidden');
  document.getElementById('modal-confirm').onclick = function () {
    overlay.classList.add('hidden');
    onConfirm();
  };
  document.getElementById('modal-cancel').onclick = function () {
    overlay.classList.add('hidden');
  };
  overlay.onclick = function (e) {
    if (e.target === overlay) overlay.classList.add('hidden');
  };
}

/* ============================================================
   LOADING STATE HELPER
   ============================================================ */
export function setLoading(btn, loading, loadingText) {
  if (!btn) return;
  if (loading) {
    btn.dataset.origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-inline"></span>' + (loadingText || 'Loading...');
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.origHtml || btn.textContent;
  }
}
