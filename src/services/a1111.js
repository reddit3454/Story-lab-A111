import fs from 'fs';
import path from 'path';
import { log, logError } from '../logger.js';

const HEALTH_TIMEOUT_MS = 4000;
const CATALOG_TIMEOUT_MS = 8000;
// ControlNet catalog endpoints are slower than the plain SD catalog and are
// usually hit right after a render, when A1111's single-threaded API is still
// catching up — give them more room before the pipeline calls it "unreachable".
const CONTROLNET_PROBE_TIMEOUT_MS = 15000;
export const GENERATE_TIMEOUT_MS = 360000; // Six minutes for SDXL plus multi-ControlNet generation
// A warm-up carries the real ControlNet units at 64x64/1 step; the wall time is
// almost entirely first-time model loading from disk, so it needs its own budget.
const WARMUP_TIMEOUT_MS = 180000;

const VERIFIED_FACEID_PROFILES = [
  {
    modelPrefix: 'ip-adapter-faceid-plusv2_sdxl',
    module: 'ip-adapter_face_id_plus',
    label: 'FaceID Plus v2 (SDXL)',
  },
  {
    modelPrefix: 'ip-adapter-faceid_sdxl',
    module: 'ip-adapter_face_id',
    label: 'FaceID (SDXL)',
  },
];

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
    // A1111 can continue rendering after the client-side HTTP request fails.
    // Always ask it to stop before reporting the failure, so its single worker
    // is not left occupied by a result Story Lab can no longer collect.
    await interrupt(baseUrl);
    const recoveryError = new Error(`A1111 generation connection failed; an interrupt was sent: ${err.message}`);
    recoveryError.cause = err;
    logError('a1111', 'generate_failed', recoveryError);
    throw recoveryError;
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

/**
 * Non-throwing progress probe. Returns { busy, progress (0..1), eta_seconds }.
 * `busy` means A1111 is mid-render — the raw API is single-threaded, so a new
 * generation (and every catalog probe around it) would block behind it.
 */
export async function getProgressSafe(baseUrl) {
  try {
    const d = await _fetchJson(`${baseUrl}/sdapi/v1/progress?skip_current_image=true`, {}, HEALTH_TIMEOUT_MS);
    const jobCount = Number(d?.state?.job_count) || 0;
    const progress = Number(d?.progress) || 0;
    return { busy: jobCount > 0 || progress > 0.01, progress, eta_seconds: Math.max(0, Number(d?.eta_relative) || 0) };
  } catch (_) {
    return { busy: false, progress: 0, eta_seconds: 0 };
  }
}

export async function interrupt(baseUrl) {
  try {
    await fetch(`${baseUrl}/sdapi/v1/interrupt`, { method: 'POST', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
  } catch (_) { /* best effort — interrupt is only an optimisation */ }
}

/**
 * Fires a throwaway 64x64 / 1-step generation carrying the given ControlNet
 * units so A1111 loads the checkpoint + ControlNet models into VRAM before the
 * user's real Generate. Never saves, never returns image data. Mirrors the
 * ImageCore "model prewarm" pattern (hub CLAUDE.md rule 16).
 */
export async function warmupTxt2img(baseUrl, payload) {
  const res = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, save_images: false, send_images: false }),
    signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
  });
  if (!res.ok) {
    let t = ''; try { t = await res.text(); } catch (_) {}
    throw new Error(`warmup HTTP ${res.status}${t ? ' — ' + t.slice(0, 200) : ''}`);
  }
  try { await res.json(); } catch (_) {}
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
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    // The health probe already hits /options — hand the parsed body back so
    // callers (the image pipeline) don't have to fetch it a second time.
    let options = null;
    try { options = await res.json(); } catch (_) { options = null; }
    return { ok: true, options };
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
    const data = await _fetchJson(`${baseUrl}/controlnet/model_list`, {}, CONTROLNET_PROBE_TIMEOUT_MS);
    const models = data?.model_list || [];
    return { available: true, models };
  } catch (err) {
    log('a1111', 'controlnet_unavailable', { error: err.message });
    return { available: false, models: [] };
  }
}

export async function getControlNetUnitCapacity(baseUrl) {
  const data = await _fetchJson(`${baseUrl}/controlnet/settings`, {}, CONTROLNET_PROBE_TIMEOUT_MS);
  const capacity = Number(data?.control_net_unit_count);
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error('A1111 ControlNet did not report a usable control_net_unit_count.');
  }
  return capacity;
}

/**
 * Returns only FaceID model/module combinations that are both installed in
 * the active A1111 ControlNet extension and explicitly compatible. Keeping
 * the pair together prevents the plain SDXL CLIP preprocessor from being
 * accidentally used with an IP-Adapter FaceID model.
 */
export async function getVerifiedFaceIdOptions(baseUrl) {
  const [modelData, moduleData] = await Promise.all([
    _fetchJson(`${baseUrl}/controlnet/model_list`, {}, CATALOG_TIMEOUT_MS),
    _fetchJson(`${baseUrl}/controlnet/module_list`, {}, CATALOG_TIMEOUT_MS),
  ]);
  const models = Array.isArray(modelData?.model_list) ? modelData.model_list : [];
  const modules = new Set(Array.isArray(moduleData?.module_list) ? moduleData.module_list : []);

  return VERIFIED_FACEID_PROFILES.flatMap(function (profile) {
    if (!modules.has(profile.module)) return [];
    const model = models.find(function (name) {
      return typeof name === 'string' && name.startsWith(`${profile.modelPrefix} [`);
    });
    return model ? [{ model, module: profile.module, label: profile.label }] : [];
  });
}

/**
 * Returns installed SDXL OpenPose models that can consume a prepared skeleton
 * directly. `none` is verified against the live module catalog rather than
 * assumed, because it is the only safe preprocessor for control.png assets.
 */
export async function getVerifiedPoseOptions(baseUrl) {
  const [modelData, moduleData] = await Promise.all([
    _fetchJson(`${baseUrl}/controlnet/model_list`, {}, CATALOG_TIMEOUT_MS),
    _fetchJson(`${baseUrl}/controlnet/module_list`, {}, CATALOG_TIMEOUT_MS),
  ]);
  const models = Array.isArray(modelData?.model_list) ? modelData.model_list : [];
  const modules = new Set(Array.isArray(moduleData?.module_list) ? moduleData.module_list : []);
  if (!modules.has('none')) return [];

  return models.filter(function (model) {
    return typeof model === 'string' && /openpose/i.test(model) && /(sdxl|xl)/i.test(model);
  }).map(function (model) {
    const name = model.replace(/\s*\[[^\]]+\]\s*$/, '');
    return { model, module: 'none', label: `${name} (prepared skeleton)` };
  });
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
          control_mode: 'Balanced',
          pixel_perfect: true,
        }],
      },
    },
  };
}

/**
 * Builds one ControlNet unit for a skeleton that was already prepared as an
 * OpenPose control image. The `none` module deliberately skips preprocessing:
 * sending the skeleton through OpenPose a second time would discard the pose
 * data it was selected for.
 */
export function buildOpenPoseControlNetUnit(base64Image, { model, module = 'none', weight = 0.75 } = {}) {
  if (!base64Image || !model) return null;
  return {
    enabled: true,
    module,
    model,
    weight,
    image: base64Image,
    resize_mode: 'Scale to Fit (Inner Fit)',
    guidance_start: 0,
    guidance_end: 1,
    control_mode: 'Balanced',
    pixel_perfect: true,
  };
}

/**
 * Combines legacy FaceID payload fragments and raw ControlNet units into the
 * single list the A1111 ControlNet API requires for multi-control requests.
 */
export function buildControlNetPayload(entries = []) {
  const args = entries.flatMap(function (entry) {
    if (!entry) return [];
    const nested = entry?.alwayson_scripts?.controlnet?.args;
    return Array.isArray(nested) ? nested : [entry];
  });
  if (!args.length) return {};
  return { alwayson_scripts: { controlnet: { args } } };
}
