import { state } from './state.js';
import { escapeHtml } from './utils.js';

/* ============================================================
   SERVICE STATUS DOTS
   ============================================================ */
export function statusDotsHtml() {
  var olCls = state.ollamaOk === true ? ' ok' : state.ollamaOk === false ? ' down' : '';
  var a1Cls = state.a1111Ok === true ? ' ok' : state.a1111Ok === false ? ' down' : '';
  return '<span class="service-status">' +
    '<span class="status-dot' + olCls + '" data-svc="ollama"></span>' +
    '<span class="status-lbl">Ollama</span>' +
    '<span class="status-dot' + a1Cls + '" data-svc="a1111" style="margin-left:8px"></span>' +
    '<span class="status-lbl">A1111</span>' +
  '</span>';
}

export function updateStatusDots(svc, ok) {
  if (svc === 'ollama') state.ollamaOk = ok;
  if (svc === 'a1111')  state.a1111Ok = ok;
  document.querySelectorAll('.status-dot[data-svc="' + svc + '"]').forEach(function (d) {
    d.classList.toggle('ok',   ok === true);
    d.classList.toggle('down', ok === false);
  });
}

export function startStatusPolling() {
  function checkOllama() {
    API.getHealthOllama()
      .then(function (d) { updateStatusDots('ollama', !!d.ok); })
      .catch(function ()  { updateStatusDots('ollama', false); });
  }
  function checkA1111() {
    API.getHealthA1111()
      .then(function (d) { updateStatusDots('a1111', !!d.ok); })
      .catch(function ()  { updateStatusDots('a1111', false); });
  }
  checkOllama();
  checkA1111();
  setInterval(checkOllama, 30000);
  setInterval(checkA1111, 30000);
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
