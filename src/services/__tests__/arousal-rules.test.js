import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampMood,
  clampArousal,
  migrateLegacyArousalMax,
  momentumNeededForArousalTick,
  effectiveArousalCeiling,
  effectiveArousalForBehavior,
  applyArousalDecayMomentum,
  deriveSceneHeat,
} from '../arousal-rules.js';

describe('arousal-rules', () => {
  it('clampMood stays 1-5', () => {
    assert.equal(clampMood(0), 1);
    assert.equal(clampMood(9), 5);
    assert.equal(clampMood(3.6), 4);
  });

  it('clampArousal respects max', () => {
    assert.equal(clampArousal(99, 6), 6);
    assert.equal(clampArousal(0, 10), 1);
  });

  it('migrateLegacyArousalMax maps 2-5 to 4-10', () => {
    assert.equal(migrateLegacyArousalMax(2), 4);
    assert.equal(migrateLegacyArousalMax(3), 6);
    assert.equal(migrateLegacyArousalMax(4), 8);
    assert.equal(migrateLegacyArousalMax(5), 10);
    assert.equal(migrateLegacyArousalMax(null), 10);
    assert.equal(migrateLegacyArousalMax(7), 7);
  });

  it('momentumNeededForArousalTick uses threshold table and hot boost', () => {
    assert.equal(momentumNeededForArousalTick({ arousalthreshold: 'low', arousalcurrent: 1 }), 1);
    assert.equal(momentumNeededForArousalTick({ arousalthreshold: 'medium', arousalcurrent: 1 }), 2);
    assert.equal(momentumNeededForArousalTick({ arousalthreshold: 'high', arousalcurrent: 1 }), 3);
    assert.equal(momentumNeededForArousalTick({ arousalthreshold: 'veryhigh', arousalcurrent: 1 }), 4);
    assert.equal(momentumNeededForArousalTick({ arousalthreshold: 'medium', arousalcurrent: 5 }), 4);
    assert.equal(momentumNeededForArousalTick({ arousalthreshold: 'low', arousalcurrent: 8 }), 3);
  });

  it('NSFW off ceilings arousal at 3', () => {
    assert.equal(effectiveArousalCeiling({ arousalmax: 10, nsfwEnabled: false }), 3);
    assert.equal(effectiveArousalCeiling({ arousalmax: 10, nsfwEnabled: false, sfwArousalCeiling: 2 }), 2);
    assert.equal(effectiveArousalCeiling({ arousalmax: 10, nsfwEnabled: true }), 10);
    assert.equal(effectiveArousalCeiling({ arousalmax: 4, nsfwEnabled: true }), 8); // legacy 4->8
  });

  it('mood gate caps effective arousal', () => {
    const cold = effectiveArousalForBehavior({
      mood: 2, arousal: 8, arousallockeduntil: 3, ceiling: 10,
    });
    assert.equal(cold.effective, 3);
    assert.equal(cold.gated, true);
    assert.ok(cold.reason);

    const warm = effectiveArousalForBehavior({
      mood: 5, arousal: 8, arousallockeduntil: 3, ceiling: 10,
    });
    assert.equal(warm.effective, 8);
    assert.equal(warm.gated, false);
  });

  it('decay reduces momentum when delta is 0 and arousal elevated', () => {
    assert.equal(applyArousalDecayMomentum(2, 0, 4), 1);
    assert.equal(applyArousalDecayMomentum(2, 1, 4), 2);
    assert.equal(applyArousalDecayMomentum(0, 0, 1), 0);
  });

  it('deriveSceneHeat labels max arousal', () => {
    assert.deepEqual(deriveSceneHeat([{ arousalcurrent: 2 }, { arousalcurrent: 6 }]), {
      level: 6, label: 'Desire',
    });
  });
});
