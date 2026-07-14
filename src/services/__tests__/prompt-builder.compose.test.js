import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeEnhancedScenePrompt,
  buildPrompt,
  buildCharacterPrompt,
  splitTags,
  classifyTag,
  dedupeCandidates,
  filterContradictions,
  applyCaps,
  selectPromptTags,
  MODE_CAPS,
  flattenSelected,
} from '../prompt-builder.js';

// --- existing composeEnhancedScenePrompt regression (clothing preservation) ---
test('composeEnhancedScenePrompt includes clothing block between body and suffix', () => {
  const result = composeEnhancedScenePrompt({
    prefix: 'masterpiece, best quality',
    body: 'a woman standing in a doorway',
    clothingBlock: 'red sundress',
    suffix: '8k, detailed',
    loraTags: '',
  });
  assert.ok(result.includes('red sundress'), `expected clothing block in result, got: ${result}`);
  const bodyIdx = result.indexOf('a woman standing in a doorway');
  const clothingIdx = result.indexOf('red sundress');
  const suffixIdx = result.indexOf('8k, detailed');
  assert.ok(bodyIdx < clothingIdx, 'clothing must come after body');
  assert.ok(clothingIdx < suffixIdx, 'clothing must come before suffix');
});

test('composeEnhancedScenePrompt omits empty segments without stray commas', () => {
  const result = composeEnhancedScenePrompt({
    prefix: '',
    body: 'a scene',
    clothingBlock: '',
    suffix: '',
    loraTags: '',
  });
  assert.equal(result, 'a scene');
});

test('composeEnhancedScenePrompt preserves lora tags at the end', () => {
  const result = composeEnhancedScenePrompt({
    prefix: 'best quality',
    body: 'a scene',
    clothingBlock: 'jeans',
    suffix: 'sharp focus',
    loraTags: '<lora:style:1.0>',
  });
  assert.ok(result.endsWith('<lora:style:1.0>'), `expected lora tags at end, got: ${result}`);
});

test('composeEnhancedScenePrompt handles undefined clothingBlock gracefully', () => {
  const result = composeEnhancedScenePrompt({
    prefix: 'best quality',
    body: 'a scene',
    clothingBlock: undefined,
    suffix: '',
    loraTags: '',
  });
  assert.equal(result, 'best quality, a scene');
});

// --- bucketization / split / classify ---
test('splitTags splits comma lists and keeps prose as one token', () => {
  assert.deepEqual(splitTags('solo, 1girl, red dress'), ['solo', '1girl', 'red dress']);
  assert.deepEqual(splitTags('Riley runs toward the door and grabs her keys'), [
    'Riley runs toward the door and grabs her keys',
  ]);
});

test('classifyTag maps quality/action/setting/subject heuristics', () => {
  assert.equal(classifyTag('masterpiece'), 'quality');
  assert.equal(classifyTag('standing'), 'action');
  assert.equal(classifyTag('indoors'), 'setting');
  assert.equal(classifyTag('solo'), 'subject');
  assert.equal(classifyTag('blonde hair'), 'appearance');
  assert.equal(classifyTag('red bikini'), 'clothing');
});

// --- dedupe ---
test('dedupeCandidates keeps highest score and records drop', () => {
  const { list, drops } = dedupeCandidates([
    { tag: 'solo', score: 20, source: 'a' },
    { tag: 'Solo', score: 80, source: 'b' },
    { tag: 'standing', score: 50, source: 'c' },
  ]);
  assert.equal(list.length, 2);
  const solo = list.find((x) => x.tag.toLowerCase() === 'solo');
  assert.equal(solo.score, 80);
  assert.ok(drops.some((d) => d.reason === 'duplicate_lower_score' || d.reason === 'duplicate'));
});

// --- contradictions ---
test('filterContradictions drops the lower-scoring opposing tag', () => {
  const { list, drops } = filterContradictions([
    { tag: 'indoors', score: 90, source: 'scene' },
    { tag: 'outdoors', score: 40, source: 'location' },
    { tag: 'solo', score: 70, source: 'character' },
    { tag: '2girls', score: 30, source: 'scene' },
  ]);
  const tags = list.map((x) => x.tag.toLowerCase());
  assert.ok(tags.includes('indoors'));
  assert.ok(!tags.includes('outdoors'));
  assert.ok(tags.includes('solo'));
  assert.ok(!tags.includes('2girls'));
  assert.ok(drops.every((d) => d.reason === 'contradiction'));
});

// --- caps ---
test('applyCaps enforces per-bucket and coreMax limits', () => {
  const buckets = {
    quality: [
      { tag: 'q1', score: 20 }, { tag: 'q2', score: 19 }, { tag: 'q3', score: 18 },
      { tag: 'q4', score: 17 }, { tag: 'q5', score: 16 },
    ],
    subject: [{ tag: 'solo', score: 80 }, { tag: '1girl', score: 80 }, { tag: 'extra', score: 10 }],
    appearance: [], clothing: [], action: [], setting: [], mood: [], camera: [],
  };
  const { selected, drops } = applyCaps(buckets, MODE_CAPS.scene);
  assert.ok(selected.quality.length <= MODE_CAPS.scene.quality);
  assert.ok(selected.subject.length <= MODE_CAPS.scene.subject);
  assert.ok(flattenSelected(selected).length <= MODE_CAPS.scene.coreMax);
  assert.ok(drops.some((d) => d.reason === 'bucket_cap'));
});

// --- stable ordering ---
test('selectPromptTags emits stable order quality→subject→appearance→clothing→action→setting→mood→camera', () => {
  const buckets = {
    quality: [{ tag: 'masterpiece', score: 20, source: 'profile' }],
    subject: [{ tag: 'solo', score: 70, source: 'character' }],
    appearance: [{ tag: 'blonde hair', score: 80, source: 'character' }],
    clothing: [{ tag: 'red dress', score: 75, source: 'clothing' }],
    action: [{ tag: 'standing', score: 100, source: 'scene' }],
    setting: [{ tag: 'bedroom', score: 50, source: 'location' }],
    mood: [{ tag: 'soft lighting', score: 40, source: 'mood' }],
    camera: [{ tag: 'full body', score: 70, source: 'framing' }],
  };
  const { selectedTags } = selectPromptTags('scene', buckets);
  assert.deepEqual(selectedTags, [
    'masterpiece', 'solo', 'blonde hair', 'red dress', 'standing', 'bedroom', 'soft lighting', 'full body',
  ]);
});

// --- scene vs character mode ---
test('buildPrompt (scene) keeps clothing_block for composeEnhanced and exposes selection audit fields', () => {
  const char = {
    id: 1, name: 'Riley', role: 'character', gender: 'female',
    hair_color: 'blonde', hair_style: 'long', eye_color: 'blue', skin_tone: 'fair',
    body_type: 'athletic', breast_size: 'medium', butt_size: 'round',
    current_clothing: '',
  };
  const { prompt, parts } = buildPrompt({
    sceneCard: {
      image_prompt: 'standing in doorway, reaching for the handle, indoors',
      mood: 'tense',
      arousal_level: 1,
    },
    characters: [char],
    location: { name: 'Foyer', image_tags: 'hardwood floor, foyer, indoors, outdoors, park, beach, city street, neon lights' },
    scenario: {},
    config: {
      master_positive: 'masterpiece, best quality, ultra detailed, highly detailed, 8k, absurdres, highres',
      prompt_prefix: '',
      prompt_suffix: 'sharp focus',
      master_negative: 'bad',
      nsfw_enabled: false,
      lora_enabled: false,
    },
    isImg2img: false,
    resolvedClothingMap: { 1: 'blue sundress' },
  });
  assert.equal(parts.clothing_block, 'blue sundress');
  assert.ok(Array.isArray(parts.selectedTags));
  assert.ok(parts.candidateTags);
  assert.ok(Array.isArray(parts.dropReasons));
  // Scene prompt should not dump every location tag — core budget + contradictions
  assert.ok(parts.selectedTags.length <= MODE_CAPS.scene.coreMax, `too many tags: ${parts.selectedTags.length}`);
  assert.ok(prompt.includes('blue sundress') || parts.clothing_block === 'blue sundress');
  // outdoors should lose to indoors from scene seed when both present
  const low = parts.selectedTags.map((t) => t.toLowerCase());
  if (low.includes('indoors') || low.some((t) => t.includes('indoors'))) {
    assert.ok(!low.includes('outdoors'), `contradiction not filtered: ${parts.selectedTags.join(' | ')}`);
  }
});

test('buildCharacterPrompt prioritizes framing/appearance/clothing and stays within character caps', () => {
  const character = {
    id: 2, name: 'Riley', gender: 'female',
    hair_color: 'blonde', hair_style: 'wavy', eye_color: 'green', skin_tone: 'tan',
    body_type: 'slim', breast_size: 'small', butt_size: 'athletic',
    current_clothing: 'white tee and jeans',
  };
  const { prompt, parts } = buildCharacterPrompt({
    character,
    actionContext: 'leaning on the railing, looking at the horizon',
    location: { image_tags: 'beach, ocean, sunset, palm trees, crowded boardwalk, neon signs, cafe, parking lot' },
    config: {
      master_positive: 'masterpiece, best quality',
      master_negative: 'bad',
      lora_enabled: false,
    },
  });
  assert.ok(parts.selectedTags.includes('solo') || prompt.includes('solo'));
  assert.ok(parts.selectedTags.length <= MODE_CAPS.character.coreMax);
  assert.ok(parts.clothing_block === 'white tee and jeans');
  assert.ok(Array.isArray(parts.dropReasons));
  // Setting should be capped lightly — not the full location dump
  const settingFromLoc = parts.selectedTags.filter((t) =>
    /beach|ocean|sunset|palm|boardwalk|neon|cafe|parking/i.test(t));
  assert.ok(settingFromLoc.length <= MODE_CAPS.character.setting,
    `setting dump leaked: ${settingFromLoc.join(', ')}`);
});

test('buildPrompt does not include empty clothing candidates when unresolved', () => {
  const { parts } = buildPrompt({
    sceneCard: { image_prompt: 'she waves hello', mood: 'joyful', arousal_level: 1 },
    characters: [{ id: 9, name: 'X', role: 'character', gender: 'female', hair_color: 'black' }],
    location: null,
    scenario: {},
    config: { master_positive: 'best quality', nsfw_enabled: false, lora_enabled: false },
    resolvedClothingMap: {},
  });
  assert.equal(parts.clothing_block, '');
  assert.ok(!(parts.selectedTags || []).some((t) => /undefined|null/i.test(t)));
});