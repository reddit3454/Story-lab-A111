import fs from 'fs';
import path from 'path';
import { log, logError } from '../logger.js';

const HEALTH_TIMEOUT_MS = 4000;
const CATALOG_TIMEOUT_MS = 8000;
const GENERATE_TIMEOUT_MS = 180000; // A1111 generations can take a while on CPU/slow GPU

async function _fetchJson(url, opts, timeoutMs) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    let bodyText = '';
    try { bodyText = await res.text(); } catch (_) {}
    throw new Error(`A1111 HTTP ${res.status} ${url}${bodyText ? ' — ' + bodyText.slice(0, 300) : ''}`);
  }
  return res.json();
}

/**
 * Runs a txt2img or img2img generation and writes the first returned image to
 * savePath. Returns { filename, seed, model_name, model_hash, generation_time_ms, info }.
 */
async function _runGeneration(baseUrl, endpoint, payload, savePath) {
  const t0 = Date.now();
  log('a1111', 'request', { endpoint, baseUrl });
  let data;
  try {
    data = await _fetchJson(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, GENERATE_TIMEOUT_MS);
  } catch (err) {
    logError('a1111', 'generate_failed', err);
    throw err;
  }

  const images = data.images || [];
  if (!images.length) {
    const err = new Error('A1111 returned no images');
    logError('a1111', 'generate_failed', err);
    throw err;
  }

  const b64 = images[0].includes(',') ? images[0].split(',').pop() : images[0];
  const buffer = Buffer.from(b64, 'base64');
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, buffer);

  let info = {};
  try {
    info = typeof data.info === 'string' ? JSON.parse(data.info) : (data.info || {});
  } catch (_) { info = {}; }

  const generation_time_ms = Date.now() - t0;
  log('a1111', 'response', { endpoint, duration_ms: generation_time_ms, filename: path.basename(savePath) });

  return {
    filename: path.basename(savePath),
    seed: info.seed ?? payload.seed ?? -1,
    model_name: info.sd_model_name || info.sd_checkpoint_name || '',
    model_hash: info.sd_model_hash || info.sd_checkpoint_hash || '',
    generation_time_ms,
    info,
  };
}

export async function txt2img(baseUrl, payload, savePath) {
  return _runGeneration(baseUrl, '/sdapi/v1/txt2img', payload, savePath);
}

export async function img2img(baseUrl, payload, savePath) {
  return _runGeneration(baseUrl, '/sdapi/v1/img2img', payload, savePath);
}

export async function getModels(baseUrl) {
  const data = await _fetchJson(`${baseUrl}/sdapi/v1/sd-models`, {}, CATALOG_TIMEOUT_MS);
  return (data || []).map(function (m) {
    return { title: m.title, model_name: m.model_name, hash: m.hash };
  });
}

export async function getLoras(baseUrl) {
  const data = await _fetchJson(`${baseUrl}/sdapi/v1/loras`, {}, CATALOG_TIMEOUT_MS);
  return (data || []).map(function (l) {
    return { name: l.name, alias: l.alias || l.name, path: l.path || '' };
  });
}

export async function getVaes(baseUrl) {
  const data = await _fetchJson(`${baseUrl}/sdapi/v1/sd-vae`, {}, CATALOG_TIMEOUT_MS);
  return (data || []).map(function (v) { return { name: v.model_name || v.name }; });
}

export async function getSamplers(baseUrl) {
  const data = await _fetchJson(`${baseUrl}/sdapi/v1/samplers`, {}, CATALOG_TIMEOUT_MS);
  return (data || []).map(function (s) { return s.name; });
}

export async function getSchedulers(baseUrl) {
  try {
    const data = await _fetchJson(`${baseUrl}/sdapi/v1/schedulers`, {}, CATALOG_TIMEOUT_MS);
    return (data || []).map(function (s) { return s.name || s.label; }).filter(Boolean);
  } catch (_) {
    // Older A1111 builds fold the scheduler into the sampler name and have no
    // separate /schedulers endpoint — degrade to an empty list, never crash.
    return [];
  }
}

export async function getProgress(baseUrl) {
  return _fetchJson(`${baseUrl}/sdapi/v1/progress?skip_current_image=true`, {}, HEALTH_TIMEOUT_MS);
}

export async function setModel(baseUrl, modelName) {
  await fetch(`${baseUrl}/sdapi/v1/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sd_model_checkpoint: modelName }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS), // model swaps can take a while to load from disk
  }).then(function (res) {
    if (!res.ok) throw new Error(`A1111 setModel failed: HTTP ${res.status}`);
  });
  log('a1111', 'set_model', { modelName });
}

export async function getOptions(baseUrl) {
  return _fetchJson(`${baseUrl}/sdapi/v1/options`, {}, CATALOG_TIMEOUT_MS);
}

export async function checkHealth(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/sdapi/v1/options`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Checks whether the sd-webui-controlnet extension (required for FaceID /
 * IP-Adapter) is installed and reachable. Never throws — a missing extension
 * (or an A1111 instance that's simply offline) is a normal, expected state
 * that the image pipeline must degrade around, not crash on.
 */
export async function checkControlNetAvailable(baseUrl) {
  try {
    const data = await _fetchJson(`${baseUrl}/controlnet/model_list`, {}, CATALOG_TIMEOUT_MS);
    const models = data?.model_list || [];
    return { available: true, models };
  } catch (err) {
    log('a1111', 'controlnet_unavailable', { error: err.message });
    return { available: false, models: [] };
  }
}

/**
 * Builds the alwayson_scripts.controlnet payload fragment for a single
 * IP-Adapter FaceID reference image, in the shape sd-webui-controlnet expects
 * from the raw /sdapi/v1/txt2img|img2img API (not the WebUI's own JS-side
 * "auto" preprocessor alias, which only resolves client-side in the browser
 * and is not reliable over the plain HTTP API).
 */
export function buildFaceIdControlNetUnit(base64Image, { model, module = 'ip-adapter_clip_sdxl', weight = 0.6 } = {}) {
  if (!base64Image || !model) return null;
  return {
    alwayson_scripts: {
      controlnet: {
        args: [{
          enabled: true,
          module,
          model,
          weight,
          image: base64Image,
          guidance_start: 0,
          guidance_end: 1,
          control_mode: 0, // "Balanced"
          pixel_perfect: true,
        }],
      },
    },
  };
}
