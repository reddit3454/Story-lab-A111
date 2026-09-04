// Image model warm-up ("prewarm").
//
// The first generation of a session that uses a ControlNet unit pays for loading
// the checkpoint + each ControlNet model from disk into VRAM — and with A1111's
// ControlNet "model cache size" at its default of 1, FaceID + pose reload every
// time. That cold load is what makes pose generations time out.
//
// This module fires a throwaway 64x64 / 1-step generation carrying the SAME
// ControlNet units the real Generate will use, so the models are already resident
// by the time the user clicks Generate (they usually spend 10-30s editing the
// description first). It never writes a file, never touches the DB, never
// broadcasts — same contract as the ImageCore prewarm (hub CLAUDE.md rule 16).

import db from '../db.js';
import { resolveEffectiveConfig, resolveMasterConfig } from './config-resolver.js';
import { readFaceRefBase64 } from './character-appearance.js';
import { readPoseControlBase64 } from './pose-library.js';
import * as a1111 from './a1111.js';
import { log } from '../logger.js';

const _getCast = db.prepare(`
  SELECT c.* FROM characters c
  JOIN scenario_characters sc ON c.id = sc.character_id
  WHERE sc.scenario_id = ? ORDER BY c.name
`);
const _getMasterCn = db.prepare(
  "SELECT key, value FROM global_config WHERE key IN ('a1111_faceid_model','a1111_faceid_module','a1111_pose_model','a1111_pose_module')"
);

let _inFlight = null; // { key, promise }

function _key(o) {
  return JSON.stringify([o.scenarioId || null, (o.characterIds || []).map(Number).sort(), o.poseId || null]);
}

/**
 * Kick off (or reuse) a warm-up for this shot. Fire-and-forget: callers do not
 * await it. Failures are swallowed — a warm-up is only ever an optimisation.
 * A new distinct request supersedes the previous one so warm-ups never pile up
 * on A1111's serial queue.
 */
export function warmup(opts = {}) {
  // The former automatic 64px ControlNet render repeatedly fails on this
  // A1111 build. Leave preloading opt-in until a real generation-shaped probe
  // is verified against the running server.
  if (resolveMasterConfig(db).image_warmup_enabled !== true) return Promise.resolve();
  const key = _key(opts);
  if (_inFlight && _inFlight.key === key) return _inFlight.promise;
  const prev = _inFlight;
  _inFlight = null;
  const promise = (async () => {
    if (prev) {
      try { await a1111.interrupt(resolveEffectiveConfig(db).a1111_url); } catch (_) {}
      try { await prev.promise; } catch (_) {}
    }
    return _run(opts);
  })().catch((err) => {
    log('image-warmup', 'failed', { error: err.message });
  });
  _inFlight = { key, promise };
  promise.finally(() => { if (_inFlight && _inFlight.promise === promise) _inFlight = null; });
  return promise;
}

/**
 * Stop any in-flight warm-up and wait for it to actually settle, so the real
 * pipeline does not (a) queue behind it or (b) see it as "A1111 is busy".
 * Called by image-pipeline.generate() before it does anything else.
 */
export async function cancelWarmup(baseUrl) {
  if (!_inFlight) return;
  const pending = _inFlight.promise;
  _inFlight = null;
  await a1111.interrupt(baseUrl);
  try { await pending; } catch (_) { /* already logged */ }
}

async function _run({ scenarioId, characterIds = null, poseId = null }) {
  if (!scenarioId) return;
  const config = resolveEffectiveConfig(db);

  const health = await a1111.checkHealth(config.a1111_url);
  if (!health.ok) return;
  const progress = await a1111.getProgressSafe(config.a1111_url);
  if (progress.busy) return; // a real job is running — do not pile on

  const cast = _getCast.all(scenarioId);
  const byId = new Map(cast.map((c) => [Number(c.id), c]));
  const rows = (Array.isArray(characterIds) && characterIds.length)
    ? characterIds.map((id) => byId.get(Number(id))).filter(Boolean)
    : cast;

  const m = Object.fromEntries(_getMasterCn.all().map((r) => [r.key, r.value]));
  const units = [];

  const faceChar = rows.find((c) => c.reference_image_path);
  if (faceChar && m.a1111_faceid_model && m.a1111_faceid_module) {
    const b64 = readFaceRefBase64(faceChar);
    if (b64) {
      units.push({
        enabled: true, module: m.a1111_faceid_module, model: m.a1111_faceid_model,
        weight: 0.6, image: b64, control_mode: 'Balanced', pixel_perfect: false,
        guidance_start: 0, guidance_end: 1,
      });
    }
  }

  const wantPose = typeof poseId === 'string' ? poseId.trim() : '';
  if (wantPose && m.a1111_pose_model && m.a1111_pose_module) {
    try {
      const b64 = readPoseControlBase64(wantPose);
      units.push({
        enabled: true, module: m.a1111_pose_module, model: m.a1111_pose_model,
        weight: 0.75, image: b64, control_mode: 'Balanced', pixel_perfect: false,
        guidance_start: 0, guidance_end: 1,
      });
    } catch (_) { /* unknown pose id — nothing to warm */ }
  }

  if (!units.length && !config.checkpoint) return; // nothing worth warming

  const payload = {
    prompt: 'warmup', negative_prompt: '',
    steps: 1, cfg_scale: 1, width: 64, height: 64,
    n_iter: 1, batch_size: 1, seed: 0,
    sampler_name: config.sampler,
  };
  if (config.checkpoint) {
    payload.override_settings = { sd_model_checkpoint: config.checkpoint };
    payload.override_settings_restore_afterwards = false;
  }
  if (units.length) payload.alwayson_scripts = { controlnet: { args: units } };

  await a1111.warmupTxt2img(config.a1111_url, payload);
  log('image-warmup', 'done', { units: units.length, checkpoint: !!config.checkpoint });
}
