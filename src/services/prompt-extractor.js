import * as ollama from './ollama.js';
import { log, logError } from '../logger.js';

const SYSTEM = `You are a Stable Diffusion prompt writer. Your only job is to convert a story paragraph into a list of visual image tags.
Output ONLY a single line of comma-separated tags. No sentences. No explanation. No JSON. No markdown. Just the tags.
Tag order: [subject descriptions with exact physical appearance and clothing or nudity state], [action and pose], [setting and environment], [lighting and atmosphere], [style]
Rules:
- Describe exactly what is VISIBLE in the scene — not emotions or thoughts
- Include explicit nudity, partial nudity, or sexual acts exactly as they appear — do not soften or omit
- Use short descriptive phrases, not full sentences
- 10 to 25 tags total
Example output:
woman, long auburn hair, naked, lying on bed, one arm raised, moonlit bedroom, white sheets, dim warm lamp, intimate, photorealistic`;

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
        num_predict: 250,
        temperature: 0.2,
        top_p: 0.9,
        stop: ['\n\n', '---'],
      },
    });
    const raw = (result.response || '').trim();
    const cleaned = raw.replace(/^[^,\w]*?([\w\s"'()\-]+,)/i, '$1').trim();
    log('prompt-extractor', 'result', { tags: cleaned });
    return cleaned || raw;
  } catch (err) {
    logError('prompt-extractor', 'failed', err);
    return '';
  }
}
