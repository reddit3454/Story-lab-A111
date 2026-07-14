import fs from 'fs';
import { AUDIT_LOG_PATH } from './paths.js';
import broadcast from './broadcast.js';

const _CAT = {
  'image-pipeline': 'IMAGE', 'a1111': 'IMAGE', 'prompt-builder': 'IMAGE',
  'narrator': 'CHAT', 'ollama': 'CHAT', 'llamacpp': 'CHAT', 'memory': 'CHAT',
  'model-resolver': 'MODEL', 'config-resolver': 'MODEL',
  'audit': 'DB',
  'server': 'SERVER', 'health': 'SERVER',
};

function _toMsg(event, data) {
  if (!data) return event;
  if (typeof data === 'string') return event + ' ' + data;
  try {
    const s = JSON.stringify(data);
    return event + ' ' + (s.length > 4000 ? s.slice(0, 4000) + '…' : s);
  } catch (_) { return event; }
}

export function log(service, event, data, detail) {
  const ts = new Date().toISOString();
  const entry = { ts, service, event, data: data ?? null, detail: detail ?? null };
  console.log(`[${ts}] [${service}] ${event}`, data ?? '');
  try { fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n'); } catch (_) {}
  broadcast.send('logline', {
    cat: _CAT[service] || 'SERVER',
    msg: `[${service}] ${_toMsg(event, data)}` + (detail ? `\n${detail}` : ''),
    ts:  ts.slice(11, 19),
  });
}

export function logError(service, event, err) {
  const ts = new Date().toISOString();
  const detail = {
    message: err?.message,
    name: err?.name || null,
    code: err?.code || err?.cause?.code || null,
    stack: err?.stack,
    cause: err?.cause
      ? { message: err.cause.message, name: err.cause.name, code: err.cause.code }
      : (err?.__serialized || null),
    serialized: err?.__serialized || null,
  };
  const entry = { ts, level: 'error', service, event, detail };
  console.error(`[${ts}] [${service}] ERROR ${event}`, detail.message, detail.cause || detail.serialized || '');
  try { fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n'); } catch (_) {}
  broadcast.send('logline', {
    cat: 'ERROR',
    msg: `[${service}] ${event}: ${detail.message || ''}` +
      (detail.cause?.message ? ` | cause: ${detail.cause.message}${detail.cause.code ? ' (' + detail.cause.code + ')' : ''}` : ''),
    ts:  ts.slice(11, 19),
  });
}
