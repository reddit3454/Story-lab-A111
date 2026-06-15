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
//   char           - character DB row object, or null (uses environmentOnly mode)
//   scene          - string describing the visual situation
//   physicalTraits - string override for trait block; uses buildTraitsBlock if null
//   nsfw           - boolean
//   prefix         - optional string prompt prefix (style anchor)
//   suffix         - optional string prompt suffix
//   previousPrompt - optional prior positive prompt for scene continuity anchor
//   nsfwElements   - array of explicit content tags, or null
//   environmentOnly - boolean; when true omits character block entirely
//   model          - Ollama model name string. Empty/falsy → return fallback immediately
// ---------------------------------------------------------------------------
export async function buildSdxlPrompt({
  char           = null,
  scene          = '',
  physicalTraits  = null,
  nsfw           = false,
  prefix         = null,
  suffix         = null,
  previousPrompt  = null,
  nsfwElements   = null,
  environmentOnly = false,
  model          = '',
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
            mustIncludeLocation:               true,
            mustIncludeClothing:               true,
            mustIncludeSituation:              true,
            mustUseSceneForClothing:           true,
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
      const lockedBlock = environmentOnly ? null : traitBlock;
      const stripped    = stripQualityBoilerplate(validated.output);
      const prevAnchor  = buildPreviousSceneAnchor(previousPrompt);
      const anchorParts = [lockedBlock, styleAnchor, prevAnchor].filter(Boolean).join(', ');
      let positiveBase  = `masterpiece, best quality, highly detailed, ${anchorParts}, ${stripped}`;
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
