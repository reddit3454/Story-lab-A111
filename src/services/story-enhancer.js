import { chat } from './ollama.js';
import { log, logError } from '../logger.js';

// ---------------------------------------------------------------------------
// SDXL prompt system prompt  (optimized)
// Key changes vs prior version:
//  - Output order: shot-type → subject traits → action → environment → lighting
//  - Explicit guidance on (term:1.2) weighting syntax for priority elements
//  - BREAK keyword allowed and instructed for subject/environment separation
//  - Negative prompt trimmed to a focused minimal set (SDXL degrades on long lists)
//  - Dual-encoder awareness: concise discriminative tags early, scene prose after BREAK
//  - Strict 60-100 word positive (tighter = stronger signal per token budget)
// ---------------------------------------------------------------------------
const SDXL_STORY_SYSTEM_PROMPT = `Write one SDXL prompt pair for the given scene JSON.
Output exactly three lines:
1) positive starting with: masterpiece, best quality, highly detailed,
2) blank
3) Negative prompt: <8-12 terms>

Positive structure: quality -> shot type -> subject traits -> clothing BREAK action/pose -> environment -> lighting.
Rules:
- Camera-visible facts only from the supplied JSON. Do not invent cast or wardrobe.
- <=100 words on the positive line. Exactly one BREAK. At most three (term:1.2) weights.
- No story, dialogue, markdown, or commentary. No refusal preamble.`;

const NSFW_ADDENDUM = `

EXPLICIT CONTENT ACTIVE:
- Name nudity and sex acts with precise anatomical/act terms in the subject or post-BREAK action block.
- Include position and clothing-state facts when present (e.g. topless, panties aside, cowgirl).
- Do not euphemize, soften, or fade to black.`;

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
  // Dialogue format (Character: "...") is story output
  if (/^[A-Z][a-zA-Z]+:\s"/.test(t)) return true;
  // Italicized action text (*does something*) is story output
  if (/\*[^*]{3,}\*/.test(t)) return true;
  // Very few commas in a long string = prose, not tags
  const commaCount = (t.match(/,/g) || []).length;
  if (commaCount < 3 && t.length > 100) return true;
  return false;
}

function validateOutput(raw, originalPrompt) {
  const text = String(raw || '').trim();
  // Bullet or numbered lists = meta-commentary
  if (/^\s*[-*]\s+/m.test(text) || /^\s*\d+\.\s+/m.test(text)) {
    return { valid: false, output: originalPrompt };
  }
  // Explanation language = the model broke format
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
      options: { temperature: 0.35, top_p: 0.9, num_predict: 500 },
    });
    return raw?.message?.content ?? '';
  } catch (err) {
    logError('story-enhancer', 'enhancer_call_error', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildSdxlPrompt
// Exported. Always returns { positive, negative }. Never throws.
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
  // Style anchor: prefer profile prefix; fall back to a tight cinematic default
  const styleAnchor = prefix?.trim() || 'cinematic photography, shallow depth of field';
  const traitBlock  = physicalTraits || buildTraitsBlock(char) || '';

  // Fallback prompt used when model is absent or output fails validation
  const fallbackPositive = environmentOnly
    ? `masterpiece, best quality, highly detailed, ${styleAnchor}, ${scene}`.replace(/,\s*,+/g, ', ').trim()
    : `masterpiece, best quality, highly detailed, ${styleAnchor}, ${traitBlock} BREAK ${scene}`.replace(/,\s*,+/g, ', ').trim();

  const fallbackNegative = 'worst quality, low quality, blurry, watermark, deformed, bad anatomy, extra fingers, missing fingers';

  if (!model) {
    log('story-enhancer', 'enhancer_no_model', null, 'no model configured, returning fallback');
    return { positive: fallbackPositive, negative: fallbackNegative };
  }

  try {
    log('story-enhancer', 'enhancer_start', null, `model=${model} scene_len=${scene.length}`);

    const systemPrompt = nsfw ? SDXL_STORY_SYSTEM_PROMPT + NSFW_ADDENDUM : SDXL_STORY_SYSTEM_PROMPT;

    const effectiveScene = environmentOnly
      ? `No characters present. Generate a cinematic establishing shot of the environment only. Scene: ${scene}`
      : scene;

    const userPayload = environmentOnly
      ? {
          sceneType:    'environment_only',
          scene:        effectiveScene,
          nsfw:         !!nsfw,
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

    // Parse: positive = everything before first blank line; negative = "Negative prompt:" line
    const parts             = String(raw || '').split(/\n\s*\n/);
    const positiveCandidate = parts[0] || '';
    const rest              = parts.slice(1).join('\n\n');
    const negLine           = rest.split('\n').find((line) => /^Negative prompt:/i.test(line.trim()));
    const negative          = negLine ? negLine.replace(/^Negative prompt:\s*/i, '').trim() : null;

    const validated = validateOutput(positiveCandidate, fallbackPositive);

    let finalPositive;

    if (validated.valid) {
      const lockedBlock = environmentOnly ? null : traitBlock;
      const stripped    = stripQualityBoilerplate(validated.output);
      const prevAnchor  = buildPreviousSceneAnchor(previousPrompt);

      // Re-assemble: quality anchors + locked traits (if any) + LLM output + optional anchors
      // Note: if LLM correctly used BREAK, it survives through stripped output and is preserved.
      const anchorParts = [lockedBlock, styleAnchor, prevAnchor].filter(Boolean).join(', ');
      let positiveBase  = `masterpiece, best quality, highly detailed, ${anchorParts}, ${stripped}`;
      if (nsfwElements?.length) positiveBase += `, ${nsfwElements.join(', ')}`;
      if (suffix?.trim())       positiveBase += `, ${suffix.trim()}`;
      finalPositive = positiveBase.replace(/,\s*,+/g, ', ').replace(/,\s+BREAK\s+,/g, ' BREAK ').trim();
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
