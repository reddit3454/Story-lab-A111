// Pure IP-Adapter/ControlNet resolution helpers — no DB, no network access.
// Centralizes module/weight/timing decisions that used to be scattered magic strings
// directly in image-pipeline.js's buildA1111Payload.

// sd-webui-controlnet's raw HTTP API does not reliably accept the WebUI-only
// "ip-adapter-auto" preprocessor alias (confirmed against the extension's own API
// reference and real working API payload examples, which use an explicit CLIP-vision
// module name). These are the explicit fallbacks used when no module override is
// configured.
const FAMILY_MODULE_FALLBACK = {
  sdxl: 'ip-adapter_clip_sdxl',
  sd15: 'ip-adapter_clip_sd15',
};

/**
 * Resolves which ControlNet preprocessor module to use for IP-Adapter.
 * Config override always wins; otherwise falls back to a family-appropriate default
 * inferred from the base checkpoint filename (SDXL vs SD1.5 heuristic — checkpoint
 * filenames conventionally include "xl" for SDXL models).
 */
export function resolveIpAdapterModule({ configModule, checkpointModel } = {}) {
  const explicit = String(configModule || '').trim();
  if (explicit) return explicit;
  const isXL = /xl/i.test(String(checkpointModel || ''));
  return isXL ? FAMILY_MODULE_FALLBACK.sdxl : FAMILY_MODULE_FALLBACK.sd15;
}

const DEFAULT_WEIGHT = 0.35;
const DEFAULT_GUIDANCE_END = 0.6;
const SCENE_WEIGHT_MULTIPLIER = 0.7;
const SCENE_GUIDANCE_END_CAP = 0.5;

/**
 * Returns { weight, guidance_start, guidance_end, control_mode } tuned for the given
 * generation mode.
 * - character mode (solo portrait/full-body, face fills more of the frame): uses the
 *   configured weight/timing as-is — a strong lock is appropriate.
 * - any other mode (scene — wider, often multi-subject shots): reduces weight and caps
 *   guidance_end so the reference image can't overpower the whole composition.
 */
export function ipAdapterTuningForMode(mode, { weight, guidanceEnd } = {}) {
  const baseWeight = Number.isFinite(weight) ? weight : DEFAULT_WEIGHT;
  const baseEnd = Number.isFinite(guidanceEnd) ? guidanceEnd : DEFAULT_GUIDANCE_END;

  if (mode === 'character') {
    return { weight: baseWeight, guidance_start: 0.0, guidance_end: baseEnd, control_mode: 0 };
  }

  return {
    weight: Math.round(baseWeight * SCENE_WEIGHT_MULTIPLIER * 100) / 100,
    guidance_start: 0.0,
    guidance_end: Math.min(baseEnd, SCENE_GUIDANCE_END_CAP),
    control_mode: 0,
  };
}

/**
 * Preflight gate: validates a resolved {model, module} pair against a ControlNet
 * catalog ({ available, models: string[], modules: string[] }) fetched from A1111's
 * /controlnet/model_list and /controlnet/module_list. Returns { ok: true } or
 * { ok: false, reason }. Callers must skip FaceID entirely (not submit a best-guess
 * unit) when ok is false.
 */
export function validateIpAdapterAgainstCatalog({ model, module }, catalog) {
  if (!catalog?.available) {
    return { ok: false, reason: 'ControlNet extension unavailable in A1111' };
  }
  const trimmedModel = String(model || '').trim();
  if (!trimmedModel) {
    return { ok: false, reason: 'No IP-Adapter model configured' };
  }
  if (!catalog.models?.includes(trimmedModel)) {
    return { ok: false, reason: `Configured IP-Adapter model not found in A1111: ${trimmedModel}` };
  }
  if (!catalog.modules?.includes(module)) {
    return { ok: false, reason: `Resolved IP-Adapter module not found in A1111: ${module}` };
  }
  return { ok: true };
}
