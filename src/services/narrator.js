import * as ollama from './ollama.js';
import { resolveMasterConfig } from './config-resolver.js';
import { resolveNarratorModel } from './model-resolver.js';
import { parseNarratorResponse } from '../input-parser.js';

const SCENE_CARD_INSTRUCTION = `After every story segment you write, append a scene description block using this exact format:
---SCENE---
{
  "image_prompt": "<plain descriptive tags: subjects with clothing, action, setting, lighting>",
  "negative_prompt_additions": "",
  "mood": "<tense|romantic|happy|sad|fearful|angry|neutral>",
  "arousal_level": <1-10>,
  "nsfw_elements": <true|false>,
  "clothing_changes": []
}
---END---

Rules for image_prompt: write as plain comma-separated tags. Subjects first with explicit clothing description. Then action/pose. Then setting. Then lighting/atmosphere. Describe only what is literally visible in the scene you just wrote. Do not add things not in the scene.`;

export function buildSystemPrompt({ scenario, characters, rules, worldEntries, memories, config }) {
  const parts = [];

  // 1. Scenario base prompt
  if (scenario.system_prompt) {
    parts.push(scenario.system_prompt);
  }

  // 2. Characters
  if (characters.length > 0) {
    const block = characters.map(function (c) {
      let s = `${c.name} (${c.role || 'character'})`;
      if (c.appearance_prompt) s += `\nAppearance: ${c.appearance_prompt}`;
      if (c.current_clothing)  s += `\nCurrently wearing: ${c.current_clothing}`;
      return s;
    }).join('\n\n');
    parts.push(`Characters:\n${block}`);
  }

  // 3. Rules (priority-ordered, descending)
  if (rules.length > 0) {
    const block = rules.map(function (r) { return `- ${r.content}`; }).join('\n');
    parts.push(`Rules:\n${block}`);
  }

  // 4. World entries
  if (worldEntries.length > 0) {
    const block = worldEntries.map(function (e) { return `${e.title}: ${e.content}`; }).join('\n\n');
    parts.push(`World Knowledge:\n${block}`);
  }

  // 5. Memory block
  if (memories.length > 0) {
    const block = memories.map(function (m) { return `- ${m.content}`; }).join('\n');
    parts.push(`Story Memory:\n${block}`);
  }

  // 6. NSFW instruction
  if (scenario.nsfw_enabled && config.nsfw_enabled) {
    parts.push('Explicit adult content is permitted in this story. Write without censorship when the narrative calls for it.');
  } else {
    parts.push('Keep content tasteful. Avoid explicit sexual content.');
  }

  // 7. Scene card instruction
  parts.push(SCENE_CARD_INSTRUCTION);

  return parts.join('\n\n---\n\n');
}

export async function runNarratorTurn({ db, scenario, messages, turnNumber }) {
  const characters  = db.prepare('SELECT * FROM characters WHERE scenario_id = ?').all(scenario.id);
  const rules       = db.prepare('SELECT * FROM rules WHERE scenario_id = ? ORDER BY priority DESC').all(scenario.id);
  const worldEntries = db.prepare('SELECT * FROM world_entries WHERE scenario_id = ?').all(scenario.id);
  const memories    = db.prepare('SELECT * FROM memories WHERE scenario_id = ? ORDER BY created_at DESC LIMIT 10').all(scenario.id);

  const config      = resolveMasterConfig(db);
  const model       = await resolveNarratorModel(db);
  const systemPrompt = buildSystemPrompt({ scenario, characters, rules, worldEntries, memories, config });

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const tokenEstimate = Math.ceil(
    fullMessages.reduce(function (sum, m) { return sum + (m.content || '').length; }, 0) / 4
  );

  const maxTokens = parseInt(config.narrator_max_tokens || '1200', 10);

  const response = await ollama.chat({
    model,
    messages: fullMessages,
    options: { num_predict: maxTokens },
  });

  const responseText = response.message?.content || '';
  const { story_text, scene_card } = parseNarratorResponse(responseText);

  return { story_text, scene_card, model_used: model, token_estimate: tokenEstimate };
}
