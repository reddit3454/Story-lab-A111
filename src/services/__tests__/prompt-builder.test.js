import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, stripStyleWords, loraTags } from '../prompt-builder.js';

const LOOK_A = {
  id: 1, name: 'Photoreal',
  prompt_prefix: 'photo, realistic, natural lighting',
  prompt_suffix: '8k uhd, high detail',
  negative: 'cartoon, anime, illustration',
  loras_json: '[]',
};

const LOOK_B = {
  id: 2, name: 'Cinematic',
  prompt_prefix: 'cinematic still, dramatic lighting, film grain',
  prompt_suffix: 'anamorphic lens, color graded',
  negative: 'flat lighting, washed out',
  loras_json: '[{"file":"someLora","strength":0.8}]',
};

const MASTER_NEGATIVE = 'lowres, bad anatomy, bad hands';

describe('buildPrompt — assembly order', () => {
  it('places style prefix first, then character, action, location+clothing, style suffix last', () => {
    const { prompt } = buildPrompt({
      look: LOOK_A,
      characters: ['tall woman, red hair'],
      actionText: 'standing by a window',
      clothingText: 'blue dress',
      locationTags: 'cozy bedroom',
      masterNegative: MASTER_NEGATIVE,
    });
    const prefixIdx = prompt.indexOf('photo, realistic');
    const charIdx = prompt.indexOf('tall woman');
    const actionIdx = prompt.indexOf('standing by a window');
    const locationIdx = prompt.indexOf('cozy bedroom');
    const suffixIdx = prompt.indexOf('8k uhd');

    assert.ok(prefixIdx >= 0 && prefixIdx < charIdx, 'style prefix must come before character');
    assert.ok(charIdx < actionIdx, 'character must come before action');
    assert.ok(actionIdx < locationIdx, 'action must come before location');
    assert.ok(locationIdx < suffixIdx, 'location must come before the trailing style suffix');
  });

  it('negative prompt combines Look negative with master anatomy/safety negative', () => {
    const { negative } = buildPrompt({ look: LOOK_A, masterNegative: MASTER_NEGATIVE });
    assert.match(negative, /cartoon, anime, illustration/);
    assert.match(negative, /bad anatomy/);
  });

  it('formats LoRA tags as <lora:name:strength>', () => {
    const { prompt, loras } = buildPrompt({ look: LOOK_B, actionText: 'walking' });
    assert.deepEqual(loras, ['<lora:someLora:0.8>']);
    assert.match(prompt, /<lora:someLora:0\.8>/);
  });

  it('supports multiple LoRAs and ignores malformed entries', () => {
    const look = {
      ...LOOK_A,
      loras_json: '[{"file":"styleLora","strength":0.6},{"file":"detailLora","strength":1},{"strength":0.5}]',
    };
    const { loras } = buildPrompt({ look, actionText: 'walking' });
    assert.deepEqual(loras, ['<lora:styleLora:0.6>', '<lora:detailLora:1>']);
  });

  it('loraTags returns an empty array for no Look, missing loras_json, or malformed JSON', () => {
    assert.deepEqual(loraTags(null), []);
    assert.deepEqual(loraTags({}), []);
    assert.deepEqual(loraTags({ loras_json: 'not json' }), []);
  });
});

describe('buildPrompt — same content, different Look changes only the style block', () => {
  it('character/action/location parts are identical across Looks; only style parts differ', () => {
    const shared = {
      characters: ['a woman with green eyes'],
      actionText: 'sitting at a desk writing',
      clothingText: 'gray sweater',
      locationTags: 'quiet library',
      masterNegative: MASTER_NEGATIVE,
    };
    const resultA = buildPrompt({ ...shared, look: LOOK_A });
    const resultB = buildPrompt({ ...shared, look: LOOK_B });

    assert.equal(resultA.parts.character, resultB.parts.character);
    assert.equal(resultA.parts.action, resultB.parts.action);
    assert.equal(resultA.parts.location, resultB.parts.location);
    assert.equal(resultA.parts.clothing, resultB.parts.clothing);

    assert.notEqual(resultA.parts.style_prefix, resultB.parts.style_prefix);
    assert.notEqual(resultA.parts.style_suffix, resultB.parts.style_suffix);
    assert.notEqual(resultA.prompt, resultB.prompt);
    assert.notEqual(resultA.negative, resultB.negative);
  });
});

describe('buildPrompt — content cannot smuggle style words', () => {
  it('strips style vocabulary from action text', () => {
    const { parts } = buildPrompt({
      look: LOOK_A,
      actionText: 'masterpiece, best quality, cinematic shot of her running through rain, 8k uhd',
    });
    assert.doesNotMatch(parts.action, /masterpiece/i);
    assert.doesNotMatch(parts.action, /best quality/i);
    assert.doesNotMatch(parts.action, /cinematic/i);
    assert.doesNotMatch(parts.action, /8k/i);
    assert.match(parts.action, /running through rain/);
  });

  it('strips style vocabulary from location tags and clothing text', () => {
    const { parts } = buildPrompt({
      look: LOOK_A,
      locationTags: 'anime style rooftop at sunset, highly detailed',
      clothingText: 'photorealistic leather jacket',
    });
    assert.doesNotMatch(parts.location, /anime/i);
    assert.doesNotMatch(parts.location, /detailed/i);
    assert.match(parts.location, /rooftop at sunset/);
    assert.doesNotMatch(parts.clothing, /photorealistic/i);
    assert.match(parts.clothing, /leather jacket/);
  });

  it('a full style-word injection attempt collapses to nothing without corrupting the prompt', () => {
    const { parts } = buildPrompt({
      look: LOOK_A,
      actionText: 'masterpiece, best quality, cinematic, anime, 8k, uhd',
    });
    assert.equal(parts.action, '');
  });
});

describe('stripStyleWords', () => {
  it('is case-insensitive and whole-word', () => {
    assert.equal(stripStyleWords('MASTERPIECE quality art'), 'quality art');
    // "masterpieces" (plural) is a different word — \b must not match a partial prefix
    assert.equal(stripStyleWords('a room full of masterpieces'), 'a room full of masterpieces');
  });

  it('returns empty string for falsy input', () => {
    assert.equal(stripStyleWords(''), '');
    assert.equal(stripStyleWords(null), '');
    assert.equal(stripStyleWords(undefined), '');
  });
});

describe('buildPrompt — no Look active', () => {
  it('still produces a usable prompt from content alone, with only the master negative', () => {
    const { prompt, negative, parts } = buildPrompt({
      look: null,
      characters: ['a man in a suit'],
      actionText: 'standing in an office',
      masterNegative: MASTER_NEGATIVE,
    });
    assert.match(prompt, /a man in a suit/);
    assert.match(prompt, /standing in an office/);
    assert.equal(negative, MASTER_NEGATIVE);
    assert.equal(parts.look_id, null);
  });
});

describe('buildPrompt — multiple characters', () => {
  it('joins multiple character appearance strings', () => {
    const { parts } = buildPrompt({
      look: LOOK_A,
      characters: ['tall man, dark hair', 'short woman, blonde hair'],
    });
    assert.match(parts.character, /tall man, dark hair/);
    assert.match(parts.character, /short woman, blonde hair/);
  });
});
