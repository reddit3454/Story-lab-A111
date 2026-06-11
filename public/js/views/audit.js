/**
 * Audit Log Viewer
 * Shows the generation audit log (audit_log table) grouped by pipeline_run_id.
 * Accessible from Settings > Debug tab, or as its own view.
 */

import { escapeHtml } from '../utils.js';
import { showToast } from '../ui.js';

var _currentFilter = { status: '', service: '', scenario_id: '' };
var _runs = {};

export function initAuditView(el) {
  if (!el) return;
  el.innerHTML =
    '<div class="page-header">' +
      '<h1 class="page-title">Audit Log</h1>' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:16px;align-items:flex-end">' +
      '<div class="form-group" style="margin:0">' +
        '<label class="form-label">Status</label>' +
        '<select class="form-input audit-filter" id="af-status" style="min-width:120px">' +
          '<option value="">All</option>' +
          '<option value="failed">Failed only</option>' +
          '<option value="success">Success only</option>' +
          '<option value="start">Start</option>' +
          '<option value="skipped">Skipped</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group" style="margin:0">' +
        '<label class="form-label">Service</label>' +
        '<select class="form-input audit-filter" id="af-service" style="min-width:140px">' +
          '<option value="">All</option>' +
          '<option value="narrator">narrator</option>' +
          '<option value="prompt-builder">prompt-builder</option>' +
          '<option value="a1111">a1111</option>' +
          '<option value="clothing">clothing</option>' +
          '<option value="memory">memory</option>' +
          '<option value="image-pipeline">image-pipeline</option>' +
          '<option value="system">system</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group" style="margin:0">' +
        '<label class="form-label">Scenario ID</label>' +
        '<input class="form-input" id="af-scenario" type="number" placeholder="any" style="width:90px">' +
      '</div>' +
      '<button class="btn btn-secondary btn-sm" id="af-apply">Apply</button>' +
      '<button class="btn btn-ghost btn-sm" id="af-clear">Clear</button>' +
    '</div>' +
    '<div id="audit-list" style="max-height:70vh;overflow-y:auto">' +
      '<div class="loading-state">Loading...</div>' +
    '</div>';

  function readFilters() {
    return {
      status:      (document.getElementById('af-status').value || '').trim(),
      service:     (document.getElementById('af-service').value || '').trim(),
      scenario_id: (document.getElementById('af-scenario').value || '').trim(),
    };
  }

  document.getElementById('af-apply').onclick = function () {
    _currentFilter = readFilters();
    loadAudit();
  };
  document.getElementById('af-clear').onclick = function () {
    document.getElementById('af-status').value  = '';
    document.getElementById('af-service').value = '';
    document.getElementById('af-scenario').value = '';
    _currentFilter = {};
    loadAudit();
  };

  loadAudit();
}

function loadAudit() {
  var list = document.getElementById('audit-list');
  if (!list) return;
  list.innerHTML = '<div class="loading-state">Loading...</div>';

  var filters = {};
  Object.keys(_currentFilter).forEach(function (k) {
    if (_currentFilter[k]) filters[k] = _currentFilter[k];
  });

  API.getAuditLog(filters)
    .then(function (data) {
      var events = data.events || data || [];
      if (!events.length) {
        list.innerHTML = '<p style="color:var(--text-muted);padding:16px">No audit events found.</p>';
        return;
      }
      renderAuditEvents(list, events);
    })
    .catch(function (err) {
      list.innerHTML = '<p style="color:var(--danger)">Failed to load: ' + escapeHtml(err.message) + '</p>';
    });
}

function renderAuditEvents(container, events) {
  var grouped = {};
  var order = [];
  events.forEach(function (ev) {
    var rid = ev.pipeline_run_id || 'no-run';
    if (!grouped[rid]) { grouped[rid] = []; order.push(rid); }
    grouped[rid].push(ev);
  });

  container.innerHTML = order.map(function (rid) {
    var evs = grouped[rid];
    var first = evs[0];
    var hasFail = evs.some(function (e) { return e.status === 'failed'; });
    var totalMs = evs.reduce(function (sum, e) { return sum + (e.duration_ms || 0); }, 0);

    return '<div class="audit-run" style="border:1px solid var(--border);border-radius:8px;margin-bottom:12px;overflow:hidden">' +
      '<div class="audit-run-header" style="' +
        'display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;' +
        'background:' + (hasFail ? 'rgba(239,68,68,.08)' : 'var(--surface)') + '"' +
        ' onclick="_auditToggleRun(this)">' +
        '<span style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:' + (hasFail ? 'var(--danger)' : 'var(--success,#22c55e)') + '"></span>' +
        '<span style="font-size:12px;font-family:var(--font-mono,monospace);color:var(--text-muted)">' + escapeHtml(rid) + '</span>' +
        '<span style="font-size:12px;color:var(--text-muted)">' + evs.length + ' events &bull; ' + totalMs + 'ms total</span>' +
        '<span style="font-size:12px;color:var(--text-muted);margin-left:auto">' + escapeHtml((first.created_at || '').slice(0,19).replace('T',' ')) + '</span>' +
        '<span style="font-size:11px;color:var(--text-muted)">&#9660;</span>' +
      '</div>' +
      '<div class="audit-run-body" style="display:none">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
          '<thead><tr style="background:var(--surface-2,var(--surface))">' +
            '<th style="padding:6px 10px;text-align:left;font-weight:600;color:var(--text-muted)">Service</th>' +
            '<th style="padding:6px 10px;text-align:left;font-weight:600;color:var(--text-muted)">Stage</th>' +
            '<th style="padding:6px 10px;text-align:left;font-weight:600;color:var(--text-muted)">Status</th>' +
            '<th style="padding:6px 10px;text-align:right;font-weight:600;color:var(--text-muted)">ms</th>' +
            '<th style="padding:6px 10px;text-align:left;font-weight:600;color:var(--text-muted)">Message</th>' +
            '<th style="padding:6px 10px;text-align:left;font-weight:600;color:var(--text-muted)">Detail</th>' +
          '</tr></thead>' +
          '<tbody>' +
          evs.map(function (e) {
            var rowColor = e.status === 'failed' ? 'rgba(239,68,68,.06)' : '';
            var statusColor = e.status === 'failed' ? 'var(--danger)' : e.status === 'success' ? 'var(--success,#22c55e)' : 'var(--text-muted)';
            return '<tr style="border-top:1px solid var(--border-subtle,rgba(255,255,255,.05));background:' + rowColor + '">' +
              '<td style="padding:6px 10px">' + escapeHtml(e.service || '') + '</td>' +
              '<td style="padding:6px 10px;color:var(--text-muted)">' + escapeHtml(e.stage || '') + '</td>' +
              '<td style="padding:6px 10px;font-weight:600;color:' + statusColor + '">' + escapeHtml(e.status || '') + '</td>' +
              '<td style="padding:6px 10px;text-align:right;color:var(--text-muted)">' + (e.duration_ms || '') + '</td>' +
              '<td style="padding:6px 10px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(e.message || '') + '</td>' +
              '<td style="padding:6px 10px">' +
                (e.error_text
                  ? '<span style="color:var(--danger);font-size:11px">' + escapeHtml((e.error_text || '').slice(0,120)) + '</span>'
                  : (e.output_json
                      ? '<button onclick="_auditShowJson(' + escapeHtml("'" + JSON.stringify(e.output_json) + "'") + ')" style="font-size:11px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer;color:var(--text-muted)">output</button>'
                      : '')) +
              '</td>' +
            '</tr>';
          }).join('') +
          '</tbody>' +
        '</table>' +
        '<div style="padding:10px 14px;border-top:1px solid var(--border)">' +
          '<button class="btn btn-ghost btn-xs" onclick="_auditCopyPrompt(' + escapeHtml("'" + rid + "'") + ')">Copy Final Prompt</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

window._auditToggleRun = function (headerEl) {
  var body = headerEl.nextElementSibling;
  var chevron = headerEl.querySelector('span:last-child');
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (chevron) chevron.textContent = open ? '▼' : '▲';
};

window._auditShowJson = function (jsonStr) {
  try {
    var data = JSON.parse(jsonStr);
    alert(JSON.stringify(data, null, 2));
  } catch (_) {
    alert(jsonStr);
  }
};

window._auditCopyPrompt = function (runId) {
  API.getAuditRun(runId)
    .then(function (data) {
      var events = data.events || [];
      var a1111Ev = events.find(function (e) { return e.service === 'a1111'; });
      if (!a1111Ev || !a1111Ev.input_json) {
        showToast('No A1111 event found for this run.', 'error');
        return;
      }
      var payload = typeof a1111Ev.input_json === 'string'
        ? a1111Ev.input_json
        : JSON.stringify(a1111Ev.input_json, null, 2);
      navigator.clipboard.writeText(payload)
        .then(function () { showToast('A1111 payload copied to clipboard.', 'success'); })
        .catch(function () { alert(payload); });
    })
    .catch(function (e) { showToast('Failed: ' + e.message, 'error'); });
};
