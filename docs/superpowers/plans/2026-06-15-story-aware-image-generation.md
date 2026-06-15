# Story-Aware Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a scene-picking LLM pass and an SDXL prompt-writing LLM pass into the image pipeline so generated images reflect the actual story moment instead of a generic pose.

**Architecture:** Two new advisory service modules (scene-picker, story-enhancer) are added to `src/services/`. Both are optional: if the Ollama model is absent or either LLM call fails, the pipeline falls back to the existing deterministic prompt assembly. The narrator's scene card gains an `image_prompt` field that feeds both new modules. Nothing about the A1111 API call changes.

**Tech Stack:** Node.js 22 ESM, `node:test` + `node:assert` for tests (built-in, zero new deps), Ollama via existing `src/services/ollama.js` wrappers.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/services/narrator.js` | Add `image_prompt` to `SCENE_CARD_INSTRUCTION` |
| Create | `src/services/scene-picker.js` | Scene moment picker — `buildMotionPrompt`, `pickBestMoment` |
| Create | `src/services/story-enhancer.js` | SDXL prompt writer — `buildSdxlPrompt` |
| Modify | `src/services/image-pipeline.js` | Import + wire both modules as advisory layers |
| Create | `src/services/__tests__/scene-picker.test.js` | Pure-function tests for scene-picker |
| Create | `src/services/__tests__/story-enhancer.test.js` | Pure-function tests for story-enhancer |

---

## Task 1: Add `image_prompt` to narrator scene card instruction

**Files:**
- Modify: `src/services/narrator.js:7-17`

- [ ] **Step 1.1: Update `SCENE_CARD_INSTRUCTION`**

Replace lines 7–17 in `src/services/narrator.js`. The existing block is:

```js
const SCENE_CARD_INSTRUCTION = `After every story segment, append this block exactly:
---SCENE---
{
  "mood": "<contemplative|tense|romantic|action|melancholy|joyful|mysterious|neutral>",
  "arousal_level": <1-10>,
  "nsfw_elements": <true|false>,
  "clothing_changes": []
}
---END---
clothing_changes format: [{ "character_name": "Name", "new_clothing": "description of what they are now wearing" }]
Only include clothing_changes entries when clothing actually changed in the scene. Leave array empty otherwise.`;
```

Replace it with:

```js
const SCENE_CARD_INSTRUCTION = `After every story segment, append this block exactly:
---SCENE---
{
  "image_prompt": "<one or two sentences: body positions, actions, spatial relationships, specific environmental details. Camera-observable facts only — what a camera would see. No emotions, no internal thoughts, no plot summary. Under 40 words.>",
  "mood": "<contemplative|tense|romantic|action|melancholy|joyful|mysterious|neutral>",
  "arousal_level": <1-10>,
  "nsfw_elements": <true|false>,
  "clothing_changes": []
}
---END---
clothing_changes format: [{ "character_name": "Name", "new_clothing": "description of what they are now wearing" }]
Only include clothing_changes entries when clothing actually changed in the scene. Leave array empty otherwise.`;
```

- [ ] **Step 1.2: Verify the file is syntactically valid**

```bash
node --experimental-sqlite --input-type=module < src/services/narrator.js
```

Expected: exits 0, no output (syntax check only — the module imports will fail but syntax errors would appear before that).

Actually use this instead (it doesn't execute imports):

```bash
node --check src/services/narrator.js
```

Expected: no output, exit code 0.

- [ ] **Step 1.3: Commit**

```bash
git add src/services/narrator.js
git commit -m "feat: add image_prompt field to narrator SCENE_CARD_INSTRUCTION"
```

---

## Task 2: Create `scene-picker.js` — pure function tests first

**Files:**
- Create: `src/services/__tests__/scene-picker.test.js`
- Create: `src/services/scene-picker.js`

- [ ] **Step 2.1: Create test directory**

```bash
mkdir -p src/services/__tests__
```

- [ ] **Step 2.2: Write failing tests for `buildMotionPrompt`**

Create `src/services/__tests__/scene-picker.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMotionPrompt, pickBestMoment } from '../scene-picker.js';

// buildMotionPrompt: null/non-object → returns baseline string
test('buildMotionPrompt returns baseline for null input', () => {
  const result = buildMotionPrompt(null);
  assert.ok(result.includes('breathing'), `expected breathing baseline, got: ${result}`);
  assert.ok(typeof result === 'string');
  assert.ok(result.length > 0);
});

test('buildMotionPrompt returns baseline for non-object input', () => {
  const result = buildMotionPrompt('string input');
  assert.ok(result.includes('breathing'));
});

// buildMotionPrompt: object with visibleAction is included
test('buildMotionPrompt includes visibleAction from picked moment', () => {
  const result = buildMotionPrompt({ visibleAction: 'she reaches for the door' });
  assert.ok(result.includes('she reaches for the door'));
  assert.ok(result.includes('breathing')); // baseline always appended
});

// buildMotionPrompt: result never exceeds 200 chars
test('buildMotionPrompt output is at most 200 characters', () => {
  const long = 'a'.repeat(300);
  const result = buildMotionPrompt({ visibleAction: long });
  assert.ok(result.length <= 200);
});

// buildMotionPrompt: alternate field names (scene card format)
test('buildMotionPrompt uses action field when visibleAction absent', () => {
  const result = buildMotionPrompt({ action: 'he sits down slowly' });
  assert.ok(result.includes('he sits down slowly'));
});

// buildMotionPrompt: empty object returns baseline
test('buildMotionPrompt with empty object returns baseline', () => {
  const result = buildMotionPrompt({});
  assert.ok(result.includes('breathing'));
});

// pickBestMoment: empty turns → null without Ollama call
test('pickBestMoment returns null for empty contextTurns', async () => {
  const result = await pickBestMoment([], [], [], 'some-model', false);
  assert.equal(result, null);
});

// pickBestMoment: falsy model → null without Ollama call
test('pickBestMoment returns null when pickerModel is null', async () => {
  const result = await pickBestMoment(['turn one', 'turn two'], [], [], null, false);
  assert.equal(result, null);
});

test('pickBestMoment returns null when pickerModel is empty string', async () => {
  const result = await pickBestMoment(['turn one'], [], [], '', false);
  assert.equal(result, null);
});
```

- [ ] **Step 2.3: Run tests — expect failure (module not found)**

```bash
node --test src/services/__tests__/scene-picker.test.js
```

Expected output contains: `Error [ERR_MODULE_NOT_FOUND]` — the module doesn't exist yet.

- [ ] **Step 2.4: Create `src/services/scene-picker.js`**

```js
import { generate } from './ollama.js';

// ---------------------------------------------------------------------------
// buildMotionPrompt
// Produces a short motion description for video/animation from a picked moment
// or scene card. Accepts either format; never throws; never returns null.
// ---------------------------------------------------------------------------
export function buildMotionPrompt(sceneCardOrPickedMoment) {
  const src = sceneCardOrPickedMoment;
  if (!src || typeof src !== 'object') {
    return 'subtle natural breathing, soft blink, gentle ambient motion, slight camera drift';
  }

  const parts = [];

  const action = src.visibleAction || src.action || null;
  if (action && action.length < 120) {
    parts.push(action.trim().replace(/\.+$/, ''));
  }

  const setting = src.setting || src.environment || null;
  if (setting && setting.length < 60 && parts.length < 2) {
    parts.push(setting.trim().replace(/\.+$/, ''));
  }

  const mood = src.mood || src.atmosphere || null;
  if (mood && mood.length < 40 && parts.length < 2) {
    parts.push(mood.trim().replace(/\.+$/, ''));
  }

  parts.push('subtle breathing, gentle camera drift');

  return parts.join(', ').slice(0, 200);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildRecentImagesBlock(recentImageCards) {
  if (!recentImageCards || !recentImageCards.length) return null;
  const lines = recentImageCards.map((card, i) => {
    const chars   = (card.characters_present || []).map(c => c.name).filter(Boolean).join(', ');
    const setting = card.setting || card.environment || '';
    const mood    = card.mood   || card.atmosphere   || '';
    return `Image ${i + 1}: ${[chars && `chars: ${chars}`, setting, mood].filter(Boolean).join('; ')}`;
  });
  return lines.join('\n');
}

function buildPickerPrompt(contextTurns, activeCharacters, recentImageCards, nsfwEnabled) {
  const contextText = contextTurns.join('\n---\n');
  const charNames   = activeCharacters.map(c => c.name).filter(Boolean).join(', ');
  const recentBlock = buildRecentImagesBlock(recentImageCards);

  const schema = JSON.stringify({
    summary:           'one sentence describing the visual moment',
    mainSubject:       'primary character(s) or subject',
    visibleAction:     'what is physically happening right now',
    setting:           'specific location and environmental details',
    shotType:          'close-up | medium | wide | establishing',
    imageabilityScore: 'number 1-10',
    penaltyReason:     'string or null',
  }, null, 2);

  const lines = [
    'You are selecting the single most visually compelling moment from a story excerpt for image generation.',
    '',
    'Read the story turns below. Mentally identify 3 to 5 candidate visual moments. Then select the ONE BEST candidate.',
    '',
    'Score higher when:',
    '- Visible physical action is happening right now (movement, gesture, physical contact)',
    '- Characters are interacting with eye contact, touch, or direct engagement',
    '- The setting has concrete specific anchors (named room, furniture, object, weather detail)',
    '- The moment is a reveal, escalation, or emotional peak expressed through physical action',
    '- The moment is visually distinct from recently generated images',
    '',
    'Score lower when:',
    '- Characters are just standing or sitting with no action',
    '- The text is internal monologue, reflection, or narrated exposition',
    '- The visual situation closely resembles recently generated images',
    '',
  ];

  if (nsfwEnabled) {
    lines.push(
      'NSFW SCORING BONUSES — this scenario has adult content enabled. Explicit moments score highest:',
      '+6 if the moment contains active penetration, oral sex, or explicit intercourse',
      '+5 if the moment contains full nudity — genitals, breasts, or buttocks fully exposed',
      '+4 if the moment contains partial nudity — topless, bottomless, or genitals partially exposed',
      '+3 if the moment contains active undressing — clothing being removed or pulled aside',
      '+2 if the moment contains explicit groping, fingering, or direct sexual contact',
      '+1 if the moment contains a kiss, embrace, or buildup to a sexual act',
      'TIEBREAKER: any moment containing nudity, undressing, or an explicit sex act MUST be ranked first regardless of all other scoring.',
      '',
    );
  }

  if (recentBlock) {
    lines.push('Recently generated images (for variety — penalize similar moments):');
    lines.push(recentBlock);
    lines.push('');
  }

  if (charNames) {
    lines.push(`Characters in this story: ${charNames}`);
    lines.push('');
  }

  lines.push(
    'Story turns:',
    '',
    contextText,
    '',
    'Return ONLY a single JSON object for the best visual moment. Use exactly these fields:',
    schema,
    '',
    'Return only the JSON object. No explanation. No markdown. No code block.',
  );

  return lines.join('\n');
}

// Parses the raw model response. Returns null if visibleAction is missing or
// the response cannot be parsed as JSON.
function parseCandidateResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const obj = JSON.parse(cleaned);
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.visibleAction || typeof obj.visibleAction !== 'string' || !obj.visibleAction.trim()) {
      return null;
    }
    if (obj.imageabilityScore != null) {
      const score = Number(obj.imageabilityScore);
      obj.imageabilityScore = isNaN(score) ? null : score;
    }
    return obj;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// pickBestMoment
// Inputs:
//   contextTurns     - array of narrator content_text strings (recent turns)
//   activeCharacters - character rows (NPC-only after player filter)
//   recentImageCards - prior scene card objects for variety penalty
//                      (currently always [] — scene_images has no scene_card_json column)
//   pickerModel      - Ollama model name string
//   nsfwEnabled      - boolean, default false
// Returns: candidate object { visibleAction, setting, shotType, ... } or null
// Never throws.
// ---------------------------------------------------------------------------
export async function pickBestMoment(contextTurns, activeCharacters, recentImageCards, pickerModel, nsfwEnabled = false) {
  if (!contextTurns || !contextTurns.length || !pickerModel) return null;

  const prompt = buildPickerPrompt(
    contextTurns,
    activeCharacters || [],
    recentImageCards || [],
    nsfwEnabled,
  );

  let res;
  try {
    res = await generate({ model: pickerModel, prompt, options: { num_predict: 500 } });
  } catch (_) {
    return null;
  }

  const rawText = (res?.response || '').trim();
  return parseCandidateResponse(rawText);
}
```

- [ ] **Step 2.5: Run tests — expect all to pass**

```bash
node --test src/services/__tests__/scene-picker.test.js
```

Expected: all 9 tests pass. Output shows `✔` for each test name.

- [ ] **Step 2.6: Commit**

```bash
git add src/services/scene-picker.js src/services/__tests__/scene-picker.test.js
git commit -m "feat: add scene-picker service with buildMotionPrompt and pickBestMoment"
```

---

## Task 3: Create `story-enhancer.js` — pure function tests first

**Files:**
- Create: `src/services/__tests__/story-enhancer.test.js`
- Create: `src/services/story-enhancer.js`

- [ ] **Step 3.1: Write failing tests**

Create `src/services/__tests__/story-enhancer.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSdxlPrompt } from '../story-enhancer.js';

// buildSdxlPrompt: absent model → returns fallback { positive, negative } without Ollama call
test('buildSdxlPrompt returns fallback when model is empty string', async () => {
  const result = await buildSdxlPrompt({
    char: null,
    scene: 'a dark forest at night',
    physicalTraits: null,
    nsfw: false,
    model: '',
  });
  assert.ok(result && typeof result === 'object', 'result must be an object');
  assert.ok(typeof result.positive === 'string' && result.positive.length > 0, 'positive must be non-empty string');
  assert.ok(typeof result.negative === 'string' && result.negative.length > 0, 'negative must be non-empty string');
  assert.ok(result.positive.includes('dark forest'), `positive should contain scene text, got: ${result.positive}`);
});

test('buildSdxlPrompt returns fallback when model is null', async () => {
  const result = await buildSdxlPrompt({
    char: null,
    scene: 'beach sunset',
    model: null,
  });
  assert.ok(result.positive.length > 0);
  assert.ok(result.negative.length > 0);
});

// buildSdxlPrompt: absent model + character → fallback includes trait block
test('buildSdxlPrompt fallback includes character traits when model absent', async () => {
  const char = {
    name: 'Alice',
    gender: 'female',
    hair_color: 'red',
    hair_style: 'long',
    eye_color: 'green',
    skin_tone: 'fair',
    body_type: 'slim',
    breast_size: null,
    butt_size: null,
  };
  const result = await buildSdxlPrompt({
    char,
    scene: 'standing in a doorway',
    model: '',
  });
  assert.ok(result.positive.includes('red long hair') || result.positive.includes('red'), `expected hair in positive, got: ${result.positive}`);
  assert.ok(result.positive.includes('green eyes') || result.positive.includes('green'), `expected eyes in positive, got: ${result.positive}`);
});

// buildSdxlPrompt: always returns { positive, negative } shape
test('buildSdxlPrompt always returns positive and negative keys', async () => {
  const result = await buildSdxlPrompt({ char: null, scene: 'empty room', model: '' });
  assert.ok(Object.hasOwn(result, 'positive'));
  assert.ok(Object.hasOwn(result, 'negative'));
});

// buildSdxlPrompt: prefix is included in fallback positive
test('buildSdxlPrompt fallback uses prefix when provided', async () => {
  const result = await buildSdxlPrompt({
    char: null,
    scene: 'a rainy street',
    prefix: 'film noir style',
    model: '',
  });
  assert.ok(result.positive.includes('film noir style'), `expected prefix in positive, got: ${result.positive}`);
});
```

- [ ] **Step 3.2: Run tests — expect failure (module not found)**

```bash
node --test src/services/__tests__/story-enhancer.test.js
```

Expected: `Error [ERR_MODULE_NOT_FOUND]`

- [ ] **Step 3.3: Create `src/services/story-enhancer.js`**

```js
import { chat } from './ollama.js';
import { log, logError } from '../logger.js';

// ---------------------------------------------------------------------------
// SDXL prompt system prompt
// ---------------------------------------------------------------------------
const SDXL_STORY_SYSTEM_PROMPT = `You are an SDXL image prompt writer for an AI story visualization system.

You receive a JSON object describing a story scene and a character. Write an SDXL prompt pair that visualizes this exact moment.

SDXL responds to a blend of quality anchors and rich visual prose. Begin the positive prompt with quality anchors first: masterpiece, best quality, highly detailed, then immediately list any physical trait tags passed in: height, body type, hair, breast size as comma tags. Then write the scene as dense visual prose phrases -- not sentences, not plot summary.

YOU ARE A VISUAL DIRECTOR.
Describe only what a camera sees.
Never summarize story.
Never describe emotions abstractly. Show it physically or omit it.

SUBJECT
- Describe the main character body explicitly and specifically.
- Describe clothing with precision: what it covers, how it fits, what it reveals. Do not use vague labels.
- Bikini example: tiny string bikini, thin fabric triangles barely covering nipples, ties loose at hips.
- Describe pose and body language as physical facts: weight, limb position, gaze direction.
- If skin is visible, describe it: tone, sheen, areas exposed.
- All physical traits passed in must appear early and verbatim.

SUPPORTING CHARACTERS
- Place them physically in the frame with spatial relationships.
- Describe reactions as visible body language only -- no emotional abstractions.
- Excited example: leaning forward, mouth open, arms raised.
- Establish depth: who is close to camera, who is behind.

ATMOSPHERE AND LIGHTING
- Name the light source, its quality, direction, warmth, hardness, how it falls on skin.
- Include one specific environmental detail that grounds the scene spatially.
- Translate mood into physical atmosphere: heat haze, charged air, low ambient glow.

COMPOSITION
- State camera distance: close-up, medium shot, wide shot.
- State camera angle: eye level, low angle, over-shoulder.
- Name the focal point explicitly.

NEVER
- Write plot summary or story context.
- Use abstract emotional words -- describe their physical manifestation.
- Add quality booster tags as prose sentences -- tags only, at the start.
- Describe anything not visible to a camera.
- Write dialogue or character speech.
- Write narrative prose or story continuation.

Keep the positive prompt 80-140 words total.

You MUST append a negative prompt as a NEW LINE at the very end.
The negative line must start EXACTLY with: Negative prompt:
Base negatives: worst quality, low quality, blurry, watermark, signature, jpeg artifacts, ugly, deformed, bad anatomy, extra limbs, missing fingers, fused fingers.
Add 3-5 scene-specific negatives that would undermine the visual.
Also include any terms from negativeTags if provided.

OUTPUT FORMAT -- follow exactly
Line 1: full positive prompt beginning with masterpiece, best quality, highly detailed,
Line 2: blank
Line 3: Negative prompt: followed by all negative terms

Nothing before line 1.
Nothing after line 3.
No JSON.
No explanation.
No dialogue.
No story text.`;

const NSFW_ADDENDUM = `

EXPLICIT CONTENT RULES — NO RESTRICTIONS
This is an adult explicit image. Generate with full anatomical precision. No softening, no euphemisms, no fading to black.

NUDITY:
- Name all exposed body parts by anatomical term: breasts, nipples, penis, vagina, vulva, labia, clitoris, buttocks, anus.
- Include explicit state tags when applicable: erect nipples, erection, aroused, bare, nude, topless, naked.
- Describe skin surface, tone, sheen, and visible physiological responses (flushed, glistening, trembling).
- Clothing state must be precisely described: shirt pulled up exposing midriff, underwear pulled aside, bra unclasped and hanging, pants around ankles.

SEX ACTS:
- If a sex act is present, describe it explicitly by name: penetration, vaginal sex, oral sex, cunnilingus, blowjob, handjob, fingering, anal sex, grinding, thrusting, riding.
- Describe the act as camera-visible physical fact: depth, angle, grip, rhythm, contact points.
- Body positions must be named: bent over, on all fours, missionary, cowgirl, legs spread, on knees, against wall.

AROUSAL:
- Erection, wetness, swollen, throbbing, dripping — describe these as physical tags when present in the scene.
- Describe visible physiological arousal signs on skin and face.

DO NOT: use euphemisms, imply rather than show, cut away, fade to black, or soften explicit content in any way.
The camera sees everything. Describe it in precise physical terms.`;

// ---------------------------------------------------------------------------
// Output validators
// ---------------------------------------------------------------------------

const REFUSAL_PATTERNS = [
  "i can't assist",
  'i cannot assist',
  "i'm sorry, but i can't",
  'i cannot help with this request',
  'cannot comply',
];

function isRefusal(text) {
  const lower = String(text || '').toLowerCase();
  return REFUSAL_PATTERNS.some((p) => lower.includes(p));
}

function isStoryOutput(text) {
  if (!text) return false;
  const t = text.trim();
  if (/^[A-Z][a-zA-Z]+:\s/.test(t)) return true;
  if (/\*[^*]{3,}\*/.test(t)) return true;
  const commaCount = (t.match(/,/g) || []).length;
  if (commaCount < 3 && t.length > 80) return true;
  return false;
}

function validateOutput(raw, originalPrompt) {
  const text = String(raw || '').trim();
  if (/^\s*[-*]\s+/m.test(text) || /^\s*\d+\.\s+/m.test(text)) {
    return { valid: false, output: originalPrompt };
  }
  if (/\b(i changed|i replaced|i added|i removed|made the prompt|what changed|reasoning|for more|for better)\b/i.test(text)) {
    return { valid: false, output: originalPrompt };
  }
  if (text.length < 10) {
    return { valid: false, output: originalPrompt };
  }
  if (isStoryOutput(text)) {
    return { valid: false, output: originalPrompt };
  }
  return { valid: true, output: text };
}

function stripQualityBoilerplate(text) {
  return String(text || '')
    .replace(/^masterpiece,\s*best quality,\s*highly detailed,\s*/i, '')
    .replace(/^\s*anamorphic lens,\s*shallow depth of field,\s*cinematic framing,\s*/i, '')
    .trim();
}

function buildPreviousSceneAnchor(previousPrompt) {
  if (!previousPrompt) return null;
  const cleaned = stripQualityBoilerplate(previousPrompt)
    .replace(/\s+/g, ' ')
    .replace(/^consistent with prior scene[:,]?\s*/i, '')
    .trim();
  if (!cleaned) return null;
  const anchored = cleaned.slice(0, 150).trim();
  if (!anchored) return null;
  return `Consistent with prior scene: ${anchored}`;
}

// ---------------------------------------------------------------------------
// buildTraitsBlock
// Replaces Story-lab's buildPhysicalTraitsBlock + buildLockedIdentityBlock.
// Produces a comma-separated string of stable physical traits from a character
// object. Returns '' when char is null or has no physical fields.
// ---------------------------------------------------------------------------
function buildTraitsBlock(char) {
  if (!char) return '';
  const parts = [];
  if (char.gender)     parts.push(char.gender);
  if (char.body_type)  parts.push(char.body_type + ' build');
  const hair = [char.hair_color, char.hair_style].filter(Boolean);
  if (hair.length)     parts.push(hair.join(' ') + ' hair');
  if (char.eye_color)  parts.push(char.eye_color + ' eyes');
  if (char.skin_tone)  parts.push(char.skin_tone + ' skin');
  const gL = (char.gender || '').toLowerCase();
  if (char.breast_size && (gL === 'female' || gL === 'non-binary'))
    parts.push(char.breast_size + ' breasts');
  if (char.butt_size)  parts.push(char.butt_size + ' butt');
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// callEnhancerOllama
// Calls the Ollama chat endpoint with the SDXL system prompt.
// Returns raw string content, or null if model is absent or call fails.
// A111's chat() wrapper enforces stream: false internally.
// ---------------------------------------------------------------------------
async function callEnhancerOllama(systemPrompt, userPayload, model) {
  if (!model) {
    log('story-enhancer', 'enhancer_no_model', null, 'no model configured, skipping enhancement');
    return null;
  }
  try {
    const raw = await chat({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: JSON.stringify(userPayload) },
      ],
      options: { temperature: 0.4, top_p: 0.9, num_predict: 600 },
    });
    return raw?.message?.content ?? '';
  } catch (err) {
    logError('story-enhancer', 'enhancer_call_error', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildSdxlPrompt
// Exported. Writes an SDXL prompt pair from scene description + character.
// Always returns { positive, negative }. Never throws.
//
// Parameters:
//   char          - character DB row object, or null (uses environmentOnly mode)
//   scene         - string describing the visual situation
//   physicalTraits - string override for trait block; uses buildTraitsBlock if null
//   nsfw          - boolean
//   prefix        - optional string prompt prefix (style anchor)
//   suffix        - optional string prompt suffix
//   previousPrompt - optional prior positive prompt for scene continuity anchor
//   nsfwElements  - array of explicit content tags, or null
//   environmentOnly - boolean; when true omits character block entirely
//   model         - Ollama model name string. Empty/falsy → return fallback immediately
// ---------------------------------------------------------------------------
export async function buildSdxlPrompt({
  char          = null,
  scene         = '',
  physicalTraits = null,
  nsfw          = false,
  prefix        = null,
  suffix        = null,
  previousPrompt = null,
  nsfwElements  = null,
  environmentOnly = false,
  model         = '',
}) {
  const styleAnchor = prefix?.trim() || 'anamorphic lens, shallow depth of field, cinematic framing';
  const traitBlock  = physicalTraits || buildTraitsBlock(char) || '';

  const fallbackPositive = environmentOnly
    ? `masterpiece, best quality, highly detailed, ${styleAnchor}, ${scene}`.replace(/,\s*,+/g, ', ').trim()
    : `masterpiece, best quality, highly detailed, ${styleAnchor}, ${traitBlock}, ${scene}`.replace(/,\s*,+/g, ', ').trim();

  const fallbackNegative = 'worst quality, low quality, blurry, watermark, deformed, bad anatomy, missing fingers, extra fingers, ugly, fused fingers';

  if (!model) {
    log('story-enhancer', 'enhancer_no_model', null, 'no model configured, returning fallback');
    return { positive: fallbackPositive, negative: fallbackNegative };
  }

  try {
    log('story-enhancer', 'enhancer_start', null, `model=${model} scene_len=${scene.length}`);

    const systemPrompt = nsfw ? SDXL_STORY_SYSTEM_PROMPT + NSFW_ADDENDUM : SDXL_STORY_SYSTEM_PROMPT;

    const effectiveScene = environmentOnly
      ? `No characters are present. Generate a cinematic establishing shot of the environment only. Focus on the location. ${scene}`
      : scene;

    const userPayload = environmentOnly
      ? {
          sceneType: 'environment_only',
          scene: effectiveScene,
          nsfw: !!nsfw,
          requirements: { mustIncludeLocation: true, mustIncludeAtmosphere: true, noCharacters: true },
        }
      : {
          characterName:     char?.name || '',
          characterIdentity: char?.appearance_prompt || char?.appearance_notes || '',
          lockedTraits:      traitBlock,
          scene:             effectiveScene,
          clothingSource:    'scene_only',
          nsfw:              !!nsfw,
          requirements: {
            mustIncludeLocation:              true,
            mustIncludeClothing:              true,
            mustIncludeSituation:             true,
            mustUseSceneForClothing:          true,
            ignoreCharacterDescriptionClothing: true,
          },
          negativeTags: Array.isArray(nsfwElements) ? nsfwElements : [],
        };

    const t0  = Date.now();
    const raw = await callEnhancerOllama(systemPrompt, userPayload, model);
    log('story-enhancer', 'enhancer_timing', null, `completed in ${Date.now() - t0}ms`);

    if (raw === null) {
      log('story-enhancer', 'enhancer_fallback', null, 'no_model_or_call_failed');
      return { positive: fallbackPositive, negative: fallbackNegative };
    }

    if (nsfw && isRefusal(raw)) {
      log('story-enhancer', 'enhancer_fallback', null, 'refusal');
      return { positive: fallbackPositive, negative: fallbackNegative };
    }

    const parts             = String(raw || '').split(/\n\s*\n/);
    const positiveCandidate = parts[0] || '';
    const rest              = parts.slice(1).join('\n\n');
    const negLine           = rest.split('\n').find((line) => /^Negative prompt:/i.test(line.trim()));
    const negative          = negLine ? negLine.replace(/^Negative prompt:\s*/i, '').trim() : null;

    const validated = validateOutput(positiveCandidate, fallbackPositive);

    if (
      validated.valid &&
      /\bBREAK\b/i.test(scene || '') &&
      !/\bBREAK\b/i.test(validated.output) &&
      /\bBREAK\b/i.test(fallbackPositive)
    ) {
      log('story-enhancer', 'enhancer_fallback', null, 'break_keyword_dropped');
      return { positive: fallbackPositive, negative: negative || fallbackNegative };
    }

    let finalPositive;

    if (validated.valid) {
      const lockedBlock   = environmentOnly ? null : traitBlock;
      const stripped      = stripQualityBoilerplate(validated.output);
      const prevAnchor    = buildPreviousSceneAnchor(previousPrompt);
      const anchorParts   = [lockedBlock, styleAnchor, prevAnchor].filter(Boolean).join(', ');
      let positiveBase    = `masterpiece, best quality, highly detailed, ${anchorParts}, ${stripped}`;
      if (nsfwElements?.length) positiveBase += `, ${nsfwElements.join(', ')}`;
      if (suffix?.trim())       positiveBase += `, ${suffix.trim()}`;
      finalPositive = positiveBase.replace(/,\s*,+/g, ', ').trim();
      log('story-enhancer', 'enhancer_success', null, `output_len=${finalPositive.length}`);
    } else {
      let positiveBase = validated.output;
      if (nsfwElements?.length) positiveBase += `, ${nsfwElements.join(', ')}`;
      if (suffix?.trim())       positiveBase += `, ${suffix.trim()}`;
      finalPositive = positiveBase.replace(/,\s*,+/g, ', ').trim();
      log('story-enhancer', 'enhancer_fallback', null, 'invalid_output');
    }

    return { positive: finalPositive, negative: negative || fallbackNegative };

  } catch (err) {
    logError('story-enhancer', 'error', err);
    return { positive: fallbackPositive, negative: fallbackNegative };
  }
}
```

- [ ] **Step 3.4: Run tests — expect all to pass**

```bash
node --test src/services/__tests__/story-enhancer.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/services/story-enhancer.js src/services/__tests__/story-enhancer.test.js
git commit -m "feat: add story-enhancer service with buildSdxlPrompt"
```

---

## Task 4: Wire picker + enhancer into `image-pipeline.js`

**Files:**
- Modify: `src/services/image-pipeline.js`

### Step 4.1: Add imports

- [ ] **Step 4.1: Add two import lines after the existing imports block**

Open `src/services/image-pipeline.js`. The current last import line is line 11 (`import * as a1111`). After it, add:

```js
import { pickBestMoment } from './scene-picker.js';
import { buildSdxlPrompt } from './story-enhancer.js';
```

The top of the file should now read:

```js
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { IMAGES_DIR, BACKGROUNDS_DIR } from '../paths.js';
import { log, logError } from '../logger.js';
import broadcast from '../broadcast.js';
import { resolveEffectiveConfig } from './config-resolver.js';
import { buildPrompt, buildCharacterPrompt } from './prompt-builder.js';
import { audit } from './audit.js';
import * as a1111 from './a1111.js';
import { pickBestMoment } from './scene-picker.js';
import { buildSdxlPrompt } from './story-enhancer.js';
```

### Step 4.2: Insert picker block

- [ ] **Step 4.2: Add the picker block after `characters` is fully populated**

Find this line in `image-pipeline.js` (currently around line 135):

```js
    const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
```

Insert the picker block immediately AFTER that line (before the `if (isBackground && location)` line):

```js
    // Stage 2a: scene_picker — advisory only, never mutates sceneCard/location/characters
    let pickedMoment = null;
    if (!isBackground && mode !== 'character') {
      const recentTurns = db.prepare(
        `SELECT content_text FROM turns WHERE scenario_id = ? AND role = 'narrator' ORDER BY turn_number DESC LIMIT 6`
      ).all(scenarioId).map(r => r.content_text).filter(Boolean).reverse();

      // scene_images has no scene_card_json column in current schema — recentImageCards
      // will always be []. The picker degrades gracefully (no variety penalty).
      const recentImageCards = db.prepare(
        `SELECT scene_card_json FROM scene_images WHERE scenario_id = ? ORDER BY id DESC LIMIT 4`
      ).all(scenarioId).map(r => { try { return JSON.parse(r.scene_card_json); } catch (_) { return null; } }).filter(Boolean);

      if (recentTurns.length > 0) {
        pickedMoment = await pickBestMoment(
          recentTurns,
          characters.filter(c => c.role !== 'player'),
          recentImageCards,
          config.picker_model || config.narrator_model,
          config.nsfw_enabled === true,
        );
        log('image-pipeline', 'picker_result', null,
          pickedMoment ? `picked: ${pickedMoment.visibleAction}` : 'picker returned null, using scene card');
      }
    }
```

### Step 4.3: Insert enhancer block

- [ ] **Step 4.3: Add the enhancer block after `buildPrompt` / `buildCharacterPrompt` sets `prompt` and `negative`**

Find this exact block in `image-pipeline.js` (currently around line 160–166):

```js
    } else {
      ({ prompt, negative, parts } = buildPrompt({
        sceneCard, characters, location, scenario, config,
        isImg2img: bgPath != null,
      }));
    }

    // Inject location environment into txt2img prompts (no background image selected)
```

Insert the enhancer block between the closing `}` of the else block and the location environment injection comment:

```js
    } else {
      ({ prompt, negative, parts } = buildPrompt({
        sceneCard, characters, location, scenario, config,
        isImg2img: bgPath != null,
      }));
    }

    // Stage 2b: story_enhancer — advisory only, rewrites prompt if model is configured
    // and output passes validation. Falls back to buildPrompt values silently.
    if (!isBackground && mode !== 'character' && mode !== 'background') {
      const sceneDescription = pickedMoment
        ? [
            pickedMoment.visibleAction,
            pickedMoment.setting,
            pickedMoment.shotType ? pickedMoment.shotType + ' shot' : null,
          ].filter(Boolean).join(', ')
        : (sceneCard?.image_prompt || prompt);

      const mainChar = characters.find(c => c.role !== 'player') || characters[0] || null;
      const nsfwOn   = config.nsfw_enabled === true;
      const enhModel = config.enhancer_model || config.narrator_model || '';

      try {
        const enhanced = await buildSdxlPrompt({
          char:          mainChar,
          scene:         sceneDescription,
          physicalTraits: null,
          nsfw:          nsfwOn,
          prefix:        config.prompt_prefix  || null,
          suffix:        config.prompt_suffix  || null,
          nsfwElements:  [],
          model:         enhModel,
        });
        if (enhanced?.positive && enhanced.positive.length > 20) {
          prompt   = enhanced.positive;
          negative = enhanced.negative || negative;
        }
      } catch (enhErr) {
        log('image-pipeline', 'enhancer_skipped', null, enhErr.message);
      }
    }

    // Inject location environment into txt2img prompts (no background image selected)
```

### Step 4.4: Syntax check and commit

- [ ] **Step 4.4: Syntax check**

```bash
node --check src/services/image-pipeline.js
```

Expected: no output, exit code 0.

- [ ] **Step 4.5: Syntax check all new files together**

```bash
node --check src/services/scene-picker.js && node --check src/services/story-enhancer.js && node --check src/services/narrator.js
```

Expected: no output, exit code 0.

- [ ] **Step 4.6: Commit**

```bash
git add src/services/image-pipeline.js
git commit -m "feat: wire scene-picker and story-enhancer into image-pipeline

Picker selects best visual moment from recent narrator turns.
Enhancer rewrites prompt for SDXL. Both are advisory: any failure
falls back to deterministic buildPrompt output unchanged.
Uses content_text column per A111 schema (not turn_text)."
```

---

## Task 5: Integration smoke test

**Files:** (read-only verification, no edits)

- [ ] **Step 5.1: Run all unit tests together**

```bash
node --test src/services/__tests__/scene-picker.test.js src/services/__tests__/story-enhancer.test.js
```

Expected: all 14 tests pass (9 picker + 5 enhancer).

- [ ] **Step 5.2: Verify the server starts cleanly**

```bash
node --experimental-sqlite src/server.js &
sleep 3
curl -s http://localhost:4090/api/health | head -c 200
kill %1
```

Expected: JSON response from `/api/health` (or equivalent health endpoint), no import errors.

If the server doesn't have a `/api/health` route, instead look for the startup log line:
```
[server] listening on port 4090
```

- [ ] **Step 5.3: Final commit tag**

```bash
git tag story-aware-image-gen-v1
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec requirement | Task covering it |
|------------------|-----------------|
| `image_prompt` in SCENE_CARD_INSTRUCTION | Task 1 |
| `buildMotionPrompt` contract + edge cases | Task 2 tests |
| `pickBestMoment` null for empty turns / no model | Task 2 tests |
| `parseCandidateResponse` rejects missing `visibleAction` | Task 2 implementation |
| `buildSdxlPrompt` fallback when model absent | Task 3 tests |
| `buildTraitsBlock` replaces Story-lab prompts.js | Task 3 implementation |
| `stream: false` — A111 wrappers enforce it | Documented in spec; no code change needed |
| Model fallback rule — log + return fallback | Task 3 implementation (`callEnhancerOllama`) |
| Picker is advisory only (no mutation) | Task 4 — `pickedMoment` is a new local var only |
| Enhancer has bounded precedence | Task 4 — `if (enhanced?.positive && enhanced.positive.length > 20)` |
| `content_text` not `turn_text` | Task 4, Step 4.2 SQL |
| `scene_card_json` absent → no-op | Task 4, Step 4.2 comment + empty filter |
| Error handling: all failures degrade gracefully | Tasks 2, 3 (never throws), Task 4 (try/catch) |
| Observability: log model, timing, fallback reason | Task 3 (`log` calls in story-enhancer) + Task 4 picker log |
| `temperature: 0.4`, `num_predict: 600` for enhancer | Task 3 `callEnhancerOllama` options |
| No new npm dependencies | Verified — only `node:test` + `node:assert` (built-in) |
| No UI changes | Not in plan |
| No A1111 call changes | Not in plan |

**Placeholder scan:** None found.

**Type consistency:** `pickBestMoment` and `buildSdxlPrompt` signatures match between implementation tasks and wiring task. `buildSdxlPrompt` uses `model` parameter consistently throughout Task 3 and Task 4.
