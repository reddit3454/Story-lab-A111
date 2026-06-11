import fs from 'fs';
import { AUDIT_LOG_PATH } from './paths.js';

export function log(service, event, data, detail) {
  const entry = {
    ts:      new Date().toISOString(),
    service,
    event,
    data:    data   ?? null,
    detail:  detail ?? null,
  };
  console.log(`[${entry.ts}] [${service}] ${event}`, data ?? '');
  try { fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n'); } catch (_) {}
}

export function logError(service, event, err) {
  const entry = {
    ts:     new Date().toISOString(),
    level:  'error',
    service,
    event,
    detail: { message: err?.message, stack: err?.stack },
  };
  console.error(`[${entry.ts}] [${service}] ERROR ${event}`, err?.message);
  try { fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n'); } catch (_) {}
}
