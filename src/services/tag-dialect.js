/**
 * Shared Stable Diffusion tag dialect for all local-model extractors/regen paths.
 * Keep gaze / count / duration / environment rules identical across entry points.
 */

export const SCENE_TAG_COUNT = { min: 12, max: 28 };
export const CHARACTER_TAG_COUNT = { min: 14, max: 26 };

/** Forbidden gaze / pose tags (lowercase). */
export const FORBIDDEN_GAZE = [
  'looking at viewer',
  'looking at camera',
  'facing camera',
  'posing',
];

export const GAZE_RULE = [
  'Gaze / pose:',
  '- NEVER use: "looking at viewer", "looking at camera", "facing camera", "posing"',
  '- Prefer: averted gaze, looking away, looking off-screen, natural pose, candid',
  '- If unsure of action: "candid moment, natural pose, averted gaze, not looking at camera"',
].join('\n');

export const DURATION_RULE =
  'NEVER include duration tags (seconds, minutes, timed actions) or phrases like "for ten seconds".';

export const ENV_RULE = [
  'Environment:',
  '- REQUIRED: include specific place/setting tags when Location is provided or the story names one',
  '- NEVER use vague placeholders like "indoor setting", "outdoor setting", or "group setting implied" when Location gives specifics',
  '- If Location is missing and the story is ambiguous, use one concrete guess only as a last resort',
].join('\n');

export const NSFW_VISIBILITY_RULE =
  'Include explicit nudity, partial nudity, or sexual acts exactly as they appear - do not soften or omit. Describe only what is VISIBLE.';

export function buildSceneTagSystem() {
  const { min, max } = SCENE_TAG_COUNT;
  return [
    'You are a Stable Diffusion prompt writer. Convert a story paragraph into comma-separated image tags.',
    'Output ONLY a single line of comma-separated tags. No sentences. No explanation. No JSON. No markdown. Just tags.',
    'TAG ORDER (follow exactly):',
    '1. Subject count:',
    '   - Exactly ONE character alone: start with "solo, 1girl" or "solo, 1boy"',
    '   - TWO characters actively interacting: start with "2girls" / "1boy 1girl" etc. - NO solo tag',
    '   - NEVER invent a second character who is not physically present',
    '2. Character appearance - physical traits visible in the scene',
    '3. Clothing or nudity state',
    '4. Action and pose - specific physical action from the story',
    GAZE_RULE,
    '5. Environment and background - mandatory when known',
    ENV_RULE,
    '6. Lighting',
    '7. Atmosphere - e.g. intimate, tense, romantic, casual, explicit',
    'Rules:',
    '- ' + NSFW_VISIBILITY_RULE,
    `- ${min} to ${max} tags total`,
    DURATION_RULE,
  ].join('\n');
}

export function buildCharacterTagSystem() {
  const { min, max } = CHARACTER_TAG_COUNT;
  return [
    'You write Stable Diffusion tags for a SOLO CANDID FULL-BODY action shot. NOT a portrait.',
    'Output ONLY one line of comma-separated tags. No sentences. No explanation.',
    'CRITICAL RULES:',
    '- Start with: solo, 1girl or solo, 1boy, full body, candid, wide shot (or medium wide shot)',
    '- NEVER use: portrait, headshot, close-up, bust, upper body, face focus, mugshot, profile photo, character portrait',
    '- ONE person in frame. Do NOT tag other character names. Do NOT use 2girls, 1boy 1girl, group',
    '- REQUIRED: a specific action/pose tag (sitting, walking, leaning, reaching, etc.)',
    '- Include: appearance, clothing/nudity, full-body pose, expression, environment from location tags',
    '- Include lighting and atmosphere matching time of day and location',
    GAZE_RULE,
    DURATION_RULE,
    ENV_RULE,
    `- REQUIRED: at least 2 environment tags from the Location block when provided`,
    `- ${min} to ${max} tags total`,
    NSFW_VISIBILITY_RULE,
  ].join('\n');
}

export function buildRegenTagSystem({ fewShot = '' } = {}) {
  const { min, max } = SCENE_TAG_COUNT;
  const parts = [
    'Convert plain-language shot descriptions into comma-separated SDXL image tags.',
    'Output ONLY one line of tags. No markdown. No commentary.',
    `${min} to ${max} tags.`,
    GAZE_RULE,
    DURATION_RULE,
    ENV_RULE,
    NSFW_VISIBILITY_RULE,
  ];
  if (fewShot) parts.push('High-quality examples:\n' + fewShot);
  return parts.join('\n');
}
