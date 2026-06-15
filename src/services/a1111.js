import fs from 'fs';
import path from 'path';
import { logError } from '../logger.js';

const DEFAULT_TIMEOUT_MS = 60000;
const HEALTH_TIMEOUT_MS  = 3000;
const INFO_TIMEOUT_MS    = 10000;

async function _fetch(baseUrl, endpoint, opts = {}) {
  const timeoutMs = opts._timeout ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { _timeout: _, ...fetchOpts } = opts;
  try {
    const res = await fetch(`${baseUrl}${endpoint}`, { ...fetchOpts, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`A1111 ${endpoint} returned ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function _parseInfo(infoStr) {
  if (!infoStr) return {};
  try { return JSON.parse(infoStr); } catch (_) { return {}; }
}

function _saveImage(b64, savePath) {
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, Buffer.from(b64, 'base64'));
}

export async function txt2img(baseUrl, payload, savePath) {
  const t0 = Date.now();
  const data = await _fetch(baseUrl, '/sdapi/v1/txt2img', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const b64 = data.images?.[0];
  if (!b64) throw new Error('A1111 txt2img returned no image');
  _saveImage(b64, savePath);
  const info = _parseInfo(data.info);
  return {
    filename:          savePath,
    seed:              info.seed       ?? -1,
    model_name:        info.sd_model_name ?? '',
    model_hash:        info.sd_model_hash ?? '',
    generation_time_ms: Date.now() - t0,
    info,
  };
}

export async function img2img(baseUrl, payload, savePath) {
  const t0 = Date.now();
  const data = await _fetch(baseUrl, '/sdapi/v1/img2img', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const b64 = data.images?.[0];
  if (!b64) throw new Error('A1111 img2img returned no image');
  _saveImage(b64, savePath);
  const info = _parseInfo(data.info);
  return {
    filename:          savePath,
    seed:              info.seed       ?? -1,
    model_name:        info.sd_model_name ?? '',
    model_hash:        info.sd_model_hash ?? '',
    generation_time_ms: Date.now() - t0,
    info,
  };
}

export async function getModels(baseUrl) {
  const data = await _fetch(baseUrl, '/sdapi/v1/sd-models', { _timeout: INFO_TIMEOUT_MS });
  return Array.isArray(data)
    ? data.map(m => ({ title: m.title, model_name: m.model_name, hash: m.hash ?? '' }))
    : [];
}

export async function getLoras(baseUrl) {
  const data = await _fetch(baseUrl, '/sdapi/v1/loras', { _timeout: INFO_TIMEOUT_MS });
  return Array.isArray(data)
    ? data.map(l => ({ name: l.name, path: l.path ?? '', alias: l.alias ?? l.name }))
    : [];
}

export async function getProgress(baseUrl) {
  const data = await _fetch(baseUrl, '/sdapi/v1/progress', { _timeout: 5000 });
  return {
    active:   (data.state?.job_count ?? 0) > 0,
    progress: data.progress      ?? 0,
    eta:      data.eta_relative  ?? 0,
  };
}

export async function setModel(baseUrl, modelName) {
  await _fetch(baseUrl, '/sdapi/v1/options', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sd_model_checkpoint: modelName }),
    _timeout: 120000,
  });
}

export async function getSamplers(baseUrl) {
  const data = await _fetch(baseUrl, '/sdapi/v1/samplers', { _timeout: INFO_TIMEOUT_MS });
  return Array.isArray(data) ? data.map(s => s.name).filter(Boolean) : [];
}

export async function getSchedulers(baseUrl) {
  const data = await _fetch(baseUrl, '/sdapi/v1/schedulers', { _timeout: INFO_TIMEOUT_MS });
  return Array.isArray(data) ? data.map(s => s.name || s.label).filter(Boolean) : [];
}

export async function getOptions(baseUrl) {
  return _fetch(baseUrl, '/sdapi/v1/options', { _timeout: INFO_TIMEOUT_MS });
}

export async function checkHealth(baseUrl) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/sdapi/v1/sd-models`, { signal: controller.signal });
      return { ok: res.ok };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
