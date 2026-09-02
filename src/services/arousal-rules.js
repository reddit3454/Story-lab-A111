/**
 * Pure arousal/mood helpers shared by character-state, narrator, and UI.
 * Scale: mood 1-5, arousal 1-10 (character.arousalmax is a per-character ceiling).
 */

export function clampMood(v) {
  const n = Number(v);
  const base = Number.isFinite(n) ? n : 3;
  return Math.min(5, Math.max(1, Math.round(base)));
}

export function clampArousal(v, max) {
  const maxN = Number(max);
  const ceiling = Math.min(10, Math.max(1, Number.isFinite(maxN) ? maxN : 10));
  const n = Number(v);
  const base = Number.isFinite(n) ? n : 1;
  return Math.min(ceiling, Math.max(1, Math.round(base)));
}

/** Map legacy 2-5 UI ceilings onto the 1-10 runtime scale. */
export function migrateLegacyArousalMax(v) {
  if (v == null || v === '') return 10;
  const n = Number(v);
  if (!Number.isFinite(n)) return 10;
  if (n === 2) return 4;
  if (n === 3) return 6;
  if (n === 4) return 8;
  if (n === 5) return 10;
  if (n < 1) return 10;
  if (n > 10) return 10;
  return Math.round(n);
}

const THRESHOLD_BASE = { low: 1, medium: 2, high: 3, veryhigh: 4 };

/**
 * Momentum magnitude needed before arousal ticks by 1.
 * When already hot (>=5), require +2 extra momentum (same idea as legacy hardcode).
 */
export function momentumNeededForArousalTick({ arousalthreshold, arousalcurrent } = {}) {
  const key = String(arousalthreshold || 'medium').toLowerCase().replace(/[\s_-]/g, '');
  let base = THRESHOLD_BASE[key];
  if (base == null) base = 2;
  const current = Number(arousalcurrent) || 1;
  if (current >= 5) base += 2;
  return base;
}

/**
 * Hard ceiling for stored/behavior arousal.
 * NSFW off -> max 3. Explicit off with NSFW on still allows desire but narrator
 * clamps ACTION bands separately via buildCastBehaviorBlock.
 */
export function effectiveArousalCeiling({ arousalmax, nsfwEnabled, explicitMode, sfwArousalCeiling } = {}) {
  let ceiling = migrateLegacyArousalMax(arousalmax == null ? 10 : arousalmax);
  const sfwCapN = Number(sfwArousalCeiling);
  const sfwCap = Number.isFinite(sfwCapN) ? Math.min(5, Math.max(1, Math.round(sfwCapN))) : 3;
  if (nsfwEnabled === false) {
    ceiling = Math.min(ceiling, sfwCap);
  } else if (explicitMode === false && nsfwEnabled !== false) {
    // Soft desire allowed; keep character max but action bands still gated by caller.
    ceiling = Math.min(ceiling, 10);
  }
  return Math.min(10, Math.max(1, ceiling));
}

/**
 * Mood-gate: high lock blocks high arousal *actions* until mood warms.
 * Returns { effective, gated, reason }.
 */
export function effectiveArousalForBehavior({
  mood,
  arousal,
  arousallockeduntil,
  ceiling,
} = {}) {
  const moodVal = clampMood(mood);
  const raw = clampArousal(arousal, ceiling == null ? 10 : ceiling);
  const lock = Number(arousallockeduntil);
  const lockN = Number.isFinite(lock) ? lock : 2;
  let cap = raw;
  let gated = false;
  let reason;
  if (lockN >= 4 && moodVal < 5) {
    cap = Math.min(cap, 3);
    if (cap < raw) { gated = true; reason = 'Mood too cold for unlocked desire (needs warm mood).'; }
  } else if (lockN >= 3 && moodVal < 4) {
    cap = Math.min(cap, 3);
    if (cap < raw) { gated = true; reason = 'Mood must warm before higher desire actions unlock.'; }
  } else if (lockN >= 2 && moodVal < 3) {
    cap = Math.min(cap, 2);
    if (cap < raw) { gated = true; reason = 'Guarded mood caps desire actions until comfort rises.'; }
  }
  return { effective: cap, gated, reason };
}

/** Soft decay when a beat left arousal unchanged but character is still elevated. */
export function applyArousalDecayMomentum(arousalMomentum, arousalDelta, arousalcurrent) {
  let m = Number(arousalMomentum) || 0;
  const delta = Number(arousalDelta) || 0;
  const a = Number(arousalcurrent) || 1;
  if (delta === 0 && a > 1) {
    m -= 1;
  }
  return m;
}

/** Label for scene-level heat readout (max cast arousal). */
export function deriveSceneHeat(states) {
  const list = Array.isArray(states) ? states : [];
  let maxA = 1;
  for (const s of list) {
    const a = Number(s.arousalcurrent ?? s.arousal ?? 1) || 1;
    if (a > maxA) maxA = a;
  }
  let label = 'Calm';
  if (maxA >= 9) label = 'Explicit';
  else if (maxA >= 7) label = 'Intense';
  else if (maxA >= 5) label = 'Desire';
  else if (maxA >= 3) label = 'Warm';
  return { level: maxA, label };
}
