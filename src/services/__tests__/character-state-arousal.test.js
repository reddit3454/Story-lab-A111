import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  momentumNeededForArousalTick,
  effectiveArousalCeiling,
  effectiveArousalForBehavior,
} from '../arousal-rules.js';
import { buildCastBehaviorBlock } from '../character-state.js';

describe('character-state arousal integration', () => {
  it('buildCastBehaviorBlock with NSFW off never uses band >= 6 text', () => {
    const characters = [
      {
        id: 1,
        name: 'Alex',
        is_user_character: 0,
        arousalmax: 10,
        arousallockeduntil: 2,
        arousaltriggers: '',
        moodtriggersneg: '',
        moodtriggerspos: '',
      },
    ];
    const characterStates = {
      1: { moodcurrent: 5, arousalcurrent: 10 },
    };
    const block = buildCastBehaviorBlock(characters, characterStates, {
      nsfwEnabled: false,
      explicitMode: false,
    });
    assert.ok(block.includes('Alex'));
    assert.ok(!block.includes('MUST initiate sex acts'));
    assert.ok(!block.includes('MUST show arousal in action'));
    assert.ok(!block.includes('MUST initiate physical contact beyond casual'));
    assert.ok(block.includes('Subtle chemistry only') || block.includes('Mostly composed') || block.includes('Behave normally'));
  });

  it('buildCastBehaviorBlock with NSFW on can reach high bands when mood allows', () => {
    const characters = [
      {
        id: 2,
        name: 'Blake',
        is_user_character: 0,
        arousalmax: 10,
        arousallockeduntil: 2,
        arousaltriggers: '',
        moodtriggersneg: '',
        moodtriggerspos: '',
      },
    ];
    const characterStates = {
      2: { moodcurrent: 5, arousalcurrent: 10 },
    };
    const block = buildCastBehaviorBlock(characters, characterStates, {
      nsfwEnabled: true,
      explicitMode: true,
    });
    assert.ok(block.includes('MUST initiate sex acts'));
  });

  it('momentumNeededForArousalTick is exported and used by arousal-rules', () => {
    assert.equal(
      momentumNeededForArousalTick({ arousalthreshold: 'high', arousalcurrent: 1 }),
      3,
    );
    assert.equal(
      momentumNeededForArousalTick({ arousalthreshold: 'medium', arousalcurrent: 6 }),
      4,
    );
  });

  it('effectiveArousalCeiling gates NSFW-off storage ceiling', () => {
    assert.equal(effectiveArousalCeiling({ arousalmax: 10, nsfwEnabled: false }), 3);
    const beh = effectiveArousalForBehavior({
      mood: 2,
      arousal: 8,
      arousallockeduntil: 3,
      ceiling: 10,
    });
    assert.equal(beh.effective, 3);
    assert.equal(beh.gated, true);
  });
});