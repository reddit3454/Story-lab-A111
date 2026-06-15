import * as ollama from './ollama.js';
import { log, logError } from '../logger.js';

const SYSTEM = `You are a Stable Diffusion prompt writer. Convert a story paragraph into comma-separated image tags.
Output ONLY a single line of comma-separated tags. No sentences. No explanation. No JSON. No markdown. Just tags.
TAG ORDER (follow exactly):
1. Subject count — CRITICAL RULE:
   - If exactly ONE character is present OR the scene focuses on one character alone: start with "solo, 1girl" or "solo, 1boy" as appropriate
   - If TWO characters are actively interacting (touching, kissing, sex, sitting on lap, embracing): start with "2girls", "1boy 1girl", etc. — NO solo tag
   - NEVER add a second character who is not physically interacting in the scene
2. Character appearance — physical traits of the character(s) visible in the scene
3. Clothing or nudity state — describe exactly what they are wearing or not wearing
4. Action and pose — what are they physically DOING right now in the story? Derive this from the story text.
   - Use specific actions: "lying on bed", "sitting at desk", "kissing", "reaching for door handle", "looking out window"
   - NEVER use: "looking at viewer", "looking at camera", "facing camera", "posing"
   - If unsure of action, use: "candid moment, natural pose, averted gaze, not looking at camera"
5. Environment and background — ALWAYS include where this scene takes place:
   - Derive from the story text and location name
   - Use specific tags: "dimly lit motel room", "sandy beach at sunset", "car interior at night", "messy bedroom"
   - NEVER leave the environment empty — if unsure, use "indoor setting" or "outdoor setting"
6. Lighting — "warm lamp light", "moonlight through window", "harsh fluorescent light", "golden hour sunlight"
7. Atmosphere — "intimate", "tense", "romantic", "casual", "explicit"
Rules:
- Include explicit nudity, partial nudity, or sexual acts exactly as they appear — do not soften or omit
- Describe only what is VISIBLE — not thoughts or emotions
- 12 to 28 tags total
- Background/environment tags are MANDATORY — every prompt must have them
Example for a scene where a woman is alone in a motel room:
solo, 1girl, long auburn hair, naked, lying on bed face-down, motel room, cheap furniture, dim lamp on nightstand, rumpled sheets, warm dim lighting, intimate, photorealistic
Example for two characters kissing outdoors:
1boy 1girl, blonde woman, dark haired man, kissing, standing embrace, beach at night, moonlight, waves in background, romantic, photorealistic`;

export async function extractImagePrompt({ storyText, characters = [], config = {} }) {
  const model = config.prompt_extractor_model || config.narrator_model || '';
  if (!model) {
    logError('prompt-extractor', 'no model configured — set prompt_extractor_model in settings');
    return '';
  }

  const charLines = characters
    .filter(c => c.appearance_prompt || c.name)
    .map(c => {
      const parts = [];
      if (c.name) parts.push(c.name);
      const traits = [];
      if (c.gender)     traits.push(c.gender);
      if (c.body_type)  traits.push(c.body_type + ' build');
      const hair = [c.hair_color, c.hair_style].filter(Boolean);
      if (hair.length)  traits.push(hair.join(' ') + ' hair');
      if (c.eye_color)  traits.push(c.eye_color + ' eyes');
      if (c.skin_tone)  traits.push(c.skin_tone + ' skin');
      const gL = (c.gender || '').toLowerCase();
      if (c.breast_size && (gL === 'female' || gL === 'non-binary')) traits.push(c.breast_size + ' breasts');
      if (c.butt_size)  traits.push(c.butt_size + ' butt');
      if (traits.length) parts.push('(' + traits.join(', ') + ')');
      else if (c.appearance_prompt) parts.push('(' + c.appearance_prompt + ')');
      const clothing = c.current_clothing || c.base_clothing;
      if (clothing) parts.push('wearing: ' + clothing);
      return parts.join(' ');
    });

  const userMsg = [
    charLines.length ? 'Characters present:\n' + charLines.join('\n') : '',
    'Story text:\n' + storyText,
    '\nWrite the image prompt tags now. Output ONLY the comma-separated tags, nothing else:',
  ].filter(Boolean).join('\n\n');

  try {
    log('prompt-extractor', 'request', { model });
    const result = await ollama.generate({
      model,
      system: SYSTEM,
      prompt: userMsg,
      options: {
        num_predict: 350,
        temperature: 0.2,
        top_p: 0.9,
        stop: ['\n\n', '---'],
      },
    });
    const raw = (result.response || '').trim();
    const cleaned = raw
      .replace(/^(here are the (image )?tags[:\s]*|image prompt[:\s]*|tags[:\s]*|prompt[:\s]*)/i, '')
      .trim();
    log('prompt-extractor', 'result', { tags: cleaned });
    return cleaned || raw;
  } catch (err) {
    logError('prompt-extractor', 'failed', err);
    return '';
  }
}
