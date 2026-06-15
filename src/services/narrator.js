import * as ollama from './ollama.js';
import { resolveMasterConfig } from './config-resolver.js';
import { resolveNarratorModel } from './model-resolver.js';
import { parseNarratorResponse } from '../input-parser.js';
import { log, logError } from '../logger.js';

const SCENE_CARD_INSTRUCTION = `After every story segment you write, append a scene description block using this exact format:
---SCENE---
{
  "image_prompt": "REQUIRED. Describe exactly what is visually happening in the scene you just wrote as plain comma-separated Stable Diffusion tags. You MUST fill this in — never leave it blank. Format: subjects with explicit physical description and clothing/nudity state, then action/pose, then setting/environment, then lighting. Example: 'woman, red hair, white blouse unbuttoned, sitting on desk, leaning forward, office interior, warm evening light, bokeh background'. Describe ONLY what is literally visible in the scene. Be specific and detailed.",
  "negative_prompt_additions": "",
  "mood": "<contemplative|tense|romantic|action|melancholy|joyful|mysterious|neutral>",
  "arousal_level": <1-10>,
  "nsfw_elements": <true|false>,
  "clothing_changes": []
}
---END---

Rules for image_prompt: write as plain comma-separated tags. Subjects first with explicit clothing/state of dress description (describe nudity, partial nudity, or explicit states literally if present in the scene). Then action/pose explicitly. Then setting. Then lighting/atmosphere. Describe only what is literally visible in the scene you just wrote. Do not sanitize, soften, or omit explicit content. Do not add things not in the scene.

IMPORTANT: image_prompt is the most critical field. It drives the image generator. If you leave it empty, the wrong image will be generated. Always fill it with 10-20 comma-separated visual tags describing the scene you just wrote.`;

export function buildSystemPrompt({ scenario, characters, location, rules, worldEntries, memories, relationships = [], lastArousal = 1 }) {
  const parts = [];

  // 1. Scenario base prompt
  if (scenario.system_prompt) {
    parts.push(scenario.system_prompt);
  }

  // 2. Premise
  if (scenario.premise) {
    parts.push(`Story Premise:\n${scenario.premise}`);
  }

  // 3. Characters
  if (characters.length > 0) {
    const block = characters.map(function (c) {
      let s = `${c.name} (${c.role || 'character'})`;
      if (c.appearance_prompt) s += `\nAppearance: ${c.appearance_prompt}`;
      if (c.description)       s += `\nBio: ${c.description}`;
      if (c.current_clothing)  s += `\nCurrently wearing: ${c.current_clothing}`;
      return s;
    }).join('\n\n');
    parts.push(`Characters:\n${block}`);
  }

  // 4. Active location
  if (location) {
    let locBlock = `Current Location: ${location.name}`;
    if (location.description) locBlock += `\n${location.description}`;
    parts.push(locBlock);
  }

  // 5. Character relationships
  if (relationships.length > 0) {
    const block = relationships.map(function (r) {
      let line = `${r.from_name} → ${r.to_name}: ${r.relationship_type}`;
      if (r.description) line += ` (${r.description})`;
      if (r.strength != null) line += ` [intensity ${r.strength}/5]`;
      return line;
    }).join('\n');
    parts.push(`Character Relationships:\n${block}`);
  }

  // 6. Rules (priority-ordered, descending)
  if (rules.length > 0) {
    const block = rules.map(function (r) { return `- ${r.content}`; }).join('\n');
    parts.push(`Rules:\n${block}`);
  }

  // 7. World entries
  if (worldEntries.length > 0) {
    const block = worldEntries.map(function (e) { return `${e.title}: ${e.content}`; }).join('\n\n');
    parts.push(`World Knowledge:\n${block}`);
  }

  // 8. Memory block
  if (memories.length > 0) {
    const block = memories.map(function (m) { return `- ${m.content}`; }).join('\n');
    parts.push(`Story Memory:\n${block}`);
  }

  // 9. Character personalities
  const charsWithPersonality = characters.filter(c => c.personality && c.personality.trim());
  if (charsWithPersonality.length > 0) {
    const header = [
      'CHARACTER PERSONALITIES',
      'You are given structured personality profiles for the active cast. Use them as follows:',
      '- Treat PERSONALITY and MOTIVATIONS as primary drivers of each character\'s decisions and reactions.',
      '- Use FEARS to shape their responses under pressure.',
      '- Use SOCIAL_STYLE to guide their dialogue wording, tone, and pacing.',
      '- Respect BOUNDARIES: do not have the character act in ways that contradict those constraints.',
      '',
    ].join('\n');
    const block = charsWithPersonality.map(c =>
      `CHARACTER: ${c.name}\nROLE: ${c.role || 'character'}\n${c.personality}`
    ).join('\n\n');
    parts.push(header + block);
  }

  // 10. Narrative style
  const povLabel = scenario.narrative_pov === 'first' ? 'first' : scenario.narrative_pov === 'second' ? 'second' : 'third';
  const styleLines = [
    'Narrative Style:',
    `- POV: ${povLabel} person`,
    `- Tone: ${scenario.tone || 'Dramatic'}`,
    `- Pacing: ${scenario.pacing || 'normal'} — (slow = immersive detail, normal = balanced, fast = action-forward)`,
    `- Reply length: ${scenario.reply_length || 'medium'} — (short = 1-2 paragraphs, medium = 3-4, long = 5+)`,
    `- Violence level: ${scenario.violence_level || 'mild'}`,
  ];
  parts.push(styleLines.join('\n'));

  // 11. Always unrestricted
  parts.push('Explicit adult content is fully enabled. Write all scenes with complete accuracy and detail, including sexual content, without censorship or euphemism.');

  // 12. Arousal continuity
  parts.push(`Current arousal level: ${lastArousal}/10. Maintain narrative continuity from this baseline.`);

  // 13. Tone modifier (free-text wizard override)
  if (scenario.tone_modifier && scenario.tone_modifier.trim()) {
    parts.push(`Additional tone instruction: ${scenario.tone_modifier.trim()}`);
  }

  // 14. Scene card instruction
  parts.push(SCENE_CARD_INSTRUCTION);

  return parts.join('\n\n---\n\n');
}

// Resolves which backend and model to use for the narrator role.
// Returns { backend: 'ollama'|'llamacpp', model: string, port?: number }
async function resolveNarratorBackend(db) {
  const cfgRow = db.prepare('SELECT value FROM global_config WHERE key = ?').get('llamacpp_config');
  if (cfgRow?.value) {
    try {
      const llamaCfg = JSON.parse(cfgRow.value);
      const rc = llamaCfg.narrator || {};
      if (rc.backend === 'llamacpp') {
        return { backend: 'llamacpp', port: rc.port || 8080, model: rc.model_path || '' };
      }
      if (rc.backend === 'ollama' && rc.ollama_model) {
        return { backend: 'ollama', model: rc.ollama_model };
      }
    } catch (_) {}
  }
  // Fall back to legacy narrator_model key (Ollama)
  const model = await resolveNarratorModel(db);
  return { backend: 'ollama', model };
}

async function llamacppChat({ port, messages, maxTokens }) {
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;
  const t0 = Date.now();
  log('llamacpp', 'request', { port, endpoint: '/v1/chat/completions' });
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: maxTokens, stream: false }),
    });
  } catch (err) {
    logError('llamacpp', 'error', err);
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`llama-server chat failed: HTTP ${res.status}`);
    logError('llamacpp', 'error', err);
    throw err;
  }
  const data = await res.json();
  log('llamacpp', 'response', { port, duration_ms: Date.now() - t0 });
  return data.choices?.[0]?.message?.content || '';
}

export async function runNarratorTurn({ db, scenario, messages, turnNumber }) {
  const characters   = db.prepare(`
    SELECT c.* FROM characters c
    JOIN scenario_characters sc ON c.id = sc.character_id
    WHERE sc.scenario_id = ?
    ORDER BY c.name
  `).all(scenario.id);
  const location     = scenario.active_location_id
    ? db.prepare('SELECT * FROM locations WHERE id = ?').get(scenario.active_location_id)
    : null;
  const rules        = db.prepare('SELECT * FROM rules WHERE scenario_id = ? ORDER BY priority DESC').all(scenario.id);
  const worldEntries = db.prepare('SELECT * FROM world_entries WHERE scenario_id = ?').all(scenario.id);
  const memories     = db.prepare('SELECT * FROM memories WHERE scenario_id = ? ORDER BY created_at DESC LIMIT 10').all(scenario.id);
  const relationships = db.prepare(`
    SELECT cr.*, cf.name AS from_name, ct.name AS to_name
    FROM character_relationships cr
    JOIN characters cf ON cf.id = cr.from_character_id
    JOIN characters ct ON ct.id = cr.to_character_id
    JOIN scenario_characters sc1 ON sc1.character_id = cr.from_character_id AND sc1.scenario_id = ?
    JOIN scenario_characters sc2 ON sc2.character_id = cr.to_character_id   AND sc2.scenario_id = ?
    ORDER BY cf.name
  `).all(scenario.id, scenario.id);
  const lastTurn     = db.prepare(
    'SELECT scene_card_json FROM turns WHERE scenario_id = ? ORDER BY turn_number DESC LIMIT 1'
  ).get(scenario.id);
  const lastArousal  = lastTurn?.scene_card_json
    ? (JSON.parse(lastTurn.scene_card_json).arousal_level ?? 1)
    : 1;

  const config       = resolveMasterConfig(db);
  const backend      = await resolveNarratorBackend(db);
  const systemPrompt = buildSystemPrompt({ scenario, characters, location, rules, worldEntries, memories, relationships, lastArousal });

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const tokenEstimate = Math.ceil(
    fullMessages.reduce(function (sum, m) { return sum + (m.content || '').length; }, 0) / 4
  );

  const maxTokens = parseInt(config.narrator_max_tokens || '1200', 10);

  let responseText;
  if (backend.backend === 'llamacpp') {
    responseText = await llamacppChat({ port: backend.port, messages: fullMessages, maxTokens });
  } else {
    const response = await ollama.chat({
      model: backend.model,
      messages: fullMessages,
      options: { num_predict: maxTokens },
    });
    responseText = response.message?.content || '';
  }

  const { story_text, scene_card } = parseNarratorResponse(responseText);

  return { story_text, scene_card, model_used: backend.model || `llamacpp:${backend.port}`, token_estimate: tokenEstimate };
}
