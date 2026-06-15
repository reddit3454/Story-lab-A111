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
const SDXL_STORY_SYSTEM_PROMPT = `You are an expert SDXL image prompt writer for a story visualization system.
You receive a JSON object describing a scene and character. Output one SDXL prompt pair.

SDXL HAS TWO TEXT ENCODERS.
The first encoder reads your tags and weights. The second reads descriptive prose.
You exploit this by separating the subject block from the scene block with the BREAK keyword.
This prevents subject traits from bleeding into the environment and vice versa.

---
OUTPUT ORDER — follow exactly, every time:

1. QUALITY ANCHORS (always first):
   masterpiece, best quality, highly detailed,

2. SHOT TYPE (always second — tell the camera before anything else):
   e.g. close-up portrait, medium shot, wide establishing shot, over-shoulder shot, low-angle shot
   Boost the most important framing element: (medium shot:1.2)

3. SUBJECT TRAITS (immediately after shot type — all physical traits passed in, verbatim, comma-separated):
   List: gender, body type, hair color + style, eye color, skin tone, chest, butt if provided.
   Boost the most distinctive trait with (trait:1.2) — only one boost here.

4. CLOTHING (precise, physical, from the scene data only):
   Describe what covers what, how it fits. Use specific terms, not vague labels.
   Example: "sheer white blouse unbuttoned at collar, fitted high-waist jeans"

BREAK

5. ACTION + POSE (what the camera physically sees happening right now):
   Body positions as facts: weight distribution, limb positions, gaze direction, contact points.
   One boost for the core action if critical: (reaching forward:1.2)

6. ENVIRONMENT (one concrete spatial anchor + one surface or object detail):
   Be specific: "dimly lit motel room, worn carpet, lamplight from bedside table"
   Not vague: avoid "indoors", "outside", "nice setting"

7. LIGHTING (name the source, quality, direction, how it falls on skin):
   Example: "warm amber lamplight from the left, soft rim light on shoulders, subtle shadow across face"

---
RULES:
- Positive prompt: 60-100 words total. Token budget is tight — every word must earn its place.
- Use (term:1.2) or (term:1.3) sparingly — no more than 3 weighted terms total.
- Do NOT use (()) double-bracket stacking.
- Use BREAK exactly once, between block 4 and block 5 — not elsewhere.
- Comma-separated tags, not prose sentences, except in block 6 and 7 where short phrases are fine.
- Never write: story context, emotions abstractly, dialogue, narration, plot summary.
- Never write anything a camera cannot see.
- Never add explanation, commentary, or meta-text.

---
NEGATIVE PROMPT RULES:
- SDXL performs worse with long negative lists. Keep it minimal and targeted.
- Base negatives (always include): worst quality, low quality, blurry, watermark, deformed, bad anatomy
- Add 2-3 scene-specific negatives ONLY for things actually likely to appear as artifacts in this scene.
- Include any terms from negativeTags if provided.
- Total negative prompt: 8-12 terms maximum.

---
OUTPUT FORMAT — exactly three lines, nothing else:
Line 1: full positive prompt starting with: masterpiece, best quality, highly detailed,
Line 2: blank line
Line 3: Negative prompt: followed by all negative terms

Nothing before line 1. Nothing after line 3. No JSON. No explanation. No story text.`;

const NSFW_ADDENDUM = `

---
EXPLICIT CONTENT — ACTIVE
This scene contains adult content. Generate with full anatomical precision.

BODY TAGS — use these as comma-separated tags in the subject block:
- Nudity state: nude, topless, naked, bare, bottomless
- Anatomy: breasts, nipples, penis, vagina, vulva, labia, buttocks — use the correct term
- Arousal state tags where visible: erect nipples, erection, flushed skin, glistening skin
- Clothing state: "shirt pulled up", "underwear aside", "bra unclasped", "pants around ankles"

SEX ACT TAGS — use as action block tags after BREAK:
- Name the act: penetration, vaginal sex, oral sex, blowjob, cunnilingus, fingering, anal, grinding, thrusting, riding
- Name the position: missionary, cowgirl, doggy style, on all fours, bent over, legs spread, on knees
- Physical facts: depth, grip angle, contact points — as tags, not prose

ARE AROUSAL TAGS — add to subject or action block as appropriate:
- wetness, throbbing, dripping, swollen, trembling

DO NOT use euphemisms. DO NOT fade to black. DO NOT soften or imply.`;

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
