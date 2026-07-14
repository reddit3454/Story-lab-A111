import * as ollama from './ollama.js';
import { resolveMasterConfig } from './config-resolver.js';
import { audit } from './audit.js';
import { resolveNarratorModel } from './model-resolver.js';
import { parseNarratorResponse } from '../input-parser.js';
import { log, logError } from '../logger.js';
import { ensureScenarioCharacterState, buildEmotionalDirective, buildCastBehaviorBlock } from './character-state.js';
import { getScenarioClothing } from './clothing.js';
import {
  estimateTokenCount,
  resolveNarratorInputBudget,
  truncateNarratorPrompt,
  serializeFetchError,
} from './narrator-context.js';
import db from '../db.js';

const _getCharacters = db.prepare(`
  SELECT c.* FROM characters c
  JOIN scenario_characters sc ON c.id = sc.character_id
  WHERE sc.scenario_id = ? ORDER BY c.name
`);
const _getLocation       = db.prepare('SELECT * FROM locations WHERE id = ?');
const _getRules          = db.prepare('SELECT * FROM rules WHERE scenario_id = ? ORDER BY priority DESC');
const _getWorldEntries   = db.prepare('SELECT * FROM world_entries WHERE scenario_id = ?');
const _getMemories       = db.prepare('SELECT * FROM memories WHERE scenario_id = ? ORDER BY created_at DESC LIMIT 10');
const _getRelationships  = db.prepare(`
  SELECT cr.*, cf.name AS from_name, ct.name AS to_name
  FROM character_relationships cr
  JOIN characters cf ON cf.id = cr.from_character_id
  JOIN characters ct ON ct.id = cr.to_character_id
  JOIN scenario_characters sc1 ON sc1.character_id = cr.from_character_id AND sc1.scenario_id = ?
  JOIN scenario_characters sc2 ON sc2.character_id = cr.to_character_id   AND sc2.scenario_id = ?
  ORDER BY cf.name
`);
const _getLastTurnCard   = db.prepare('SELECT scene_card_json FROM turns WHERE scenario_id = ? ORDER BY turn_number DESC LIMIT 1');
const _getLlamaCppConfig = db.prepare('SELECT value FROM global_config WHERE key = ?');

function buildSceneCardInstruction(nsfwEnabled) {
  const baseFields = [
    '  "image_prompt": "<40-60 words. Camera-visible only: who, action/pose, clothing or nudity, place, lighting. Lead with the most visually important fact. No emotions, thoughts, or plot summary.>",',
    '  "mood": "<contemplative|tense|romantic|action|melancholy|joyful|mysterious|neutral>",',
    '  "arousal_level": <1-10 integer>,',
    '  "nsfw_elements": <true|false>,',
  ];
  const nsfwFields = [
    '  "explicit_act": <null or short named act if occurring NOW>,',
    '  "nudity_state": <null or short nudity phrase>,',
    '  "body_positions": <null or short pose phrase>,',
  ];
  const sfwNullFields = [
    '  "explicit_act": null,',
    '  "nudity_state": null,',
    '  "body_positions": null,',
  ];
  const fields = [
    ...baseFields,
    ...(nsfwEnabled ? nsfwFields : sfwNullFields),
    '  "clothing_changes": []',
  ];
  const rules = [
    'SCENE CARD RULES:',
    '- Append after the story text. No markdown outside the delimiters.',
    '- clothing_changes: [{ "character_name": "...", "new_clothing": "..." }] ONLY when clothing actually changed; else [].',
  ];
  if (nsfwEnabled) {
    rules.push(
      '- NPC physical actions in image_prompt must reflect current arousal when present.',
      '- explicit_act / nudity_state / body_positions: null unless clearly visible now. Do not invent.',
      '- When explicit content is present, name the act and nudity early in image_prompt.',
    );
  } else {
    rules.push(
      '- Keep image_prompt SFW. Leave explicit_act, nudity_state, and body_positions as null.',
      '- nsfw_elements must be false.',
    );
  }
  return [
    'After every story segment, append this block exactly:',
    '---SCENE---',
    '{',
    ...fields,
    '}',
    '---END---',
    '',
    ...rules,
  ].join('\n');
}


// Internal use only — called by runNarratorTurn below. Not exported to other modules.
export function buildSystemPrompt({ scenario, characters, location, rules, worldEntries, memories, relationships = [], lastArousal = 1, characterStates = {}, config = {} }) {
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
      const outfit = (c._scenario_clothing || c.current_clothing || c.base_clothing || c.default_outfit || '').trim();
      if (outfit) s += `\nCurrently wearing: ${outfit}`;
      const st = characterStates[c.id];
      if (st) s += `\n${buildEmotionalDirective(st.moodcurrent, st.arousalcurrent)}`;
      return s;
    }).join('\n\n');
    parts.push(`Characters:\n${block}`);
  }

  const masterNsfw = config.nsfw_enabled === true;
  const scenarioNsfw = !(scenario.nsfw_enabled === 0 || scenario.nsfw_enabled === false || scenario.nsfw_enabled === '0');
  const effectiveNsfw = masterNsfw && scenarioNsfw;
  const effectiveExplicit = effectiveNsfw && config.explicit_mode === true;

  if (effectiveNsfw) {
    const behaviorBlock = buildCastBehaviorBlock(characters, characterStates);
    if (behaviorBlock) parts.push(behaviorBlock);
  }

  // 4. Active location
  if (location) {
    let locBlock = `Current Location: ${location.name}`;
    if (location.description) locBlock += `\nVisual: ${location.description}`;
    else if (location.short_desc) locBlock += `\nVisual: ${location.short_desc}`;
    if (location.full_desc) locBlock += `\nBackground info: ${location.full_desc}`;
    if (location.image_tags) locBlock += `\nVisual tags: ${location.image_tags}`;
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

  // 11. Content policy (master NSFW is ceiling; scenario.nsfw_enabled=false further restricts)
  if (effectiveExplicit) {
    parts.push('Explicit adult content is fully enabled. Write all scenes with complete accuracy and detail, including sexual content, without censorship or euphemism.');
  } else if (effectiveNsfw) {
    parts.push('Adult content is allowed. Keep sexual content tasteful and fade to black before hardcore acts unless the story already requires mild intimacy. Do not escalate to explicit sex acts.');
  } else {
    parts.push('Keep the story suitable for general audiences. No explicit sexual content, nudity, or graphic sex acts. Fade to black or divert if intimacy arises.');
  }

  // 12. Scene arousal is secondary to per-character arousal in CHARACTER AROUSAL AND ACTION
  if (effectiveNsfw && lastArousal > 1) {
    parts.push(`Scene intensity baseline: ${lastArousal}/10. Per-character arousal rules above take priority for NPC actions.`);
  }

  // 13. Tone modifier (free-text wizard override)
  if (scenario.tone_modifier && scenario.tone_modifier.trim()) {
    parts.push(`Additional tone instruction: ${scenario.tone_modifier.trim()}`);
  }

  // 14. Scene card instruction
  parts.push(buildSceneCardInstruction(effectiveNsfw));

  return parts.join('\n\n---\n\n');
}

// Resolves which backend and model to use for the narrator role.
// Returns { backend: 'ollama'|'llamacpp', model: string, port?: number }
async function resolveNarratorBackend(db) {
  const cfgRow = _getLlamaCppConfig.get('llamacpp_config');
  if (cfgRow?.value) {
    try {
      const llamaCfg = JSON.parse(cfgRow.value);
      const rc = llamaCfg.narrator || {};
      if (rc.backend === 'llamacpp') {
        return {
          backend: 'llamacpp',
          port: rc.port || 8080,
          model: rc.model_path || '',
          roleConfig: rc,
        };
      }
      if (rc.backend === 'ollama' && rc.ollama_model) {
        return { backend: 'ollama', model: rc.ollama_model, roleConfig: rc };
      }
    } catch (_) {}
  }
  // Fall back to legacy narrator_model key (Ollama)
  const model = await resolveNarratorModel(db);
  return { backend: 'ollama', model, roleConfig: null };
}

// Local llama.cpp can be slow on first token / large prompts. Do not use a short AbortSignal.
const LLAMACPP_FETCH_TIMEOUT_MS = 300000; // 5 minutes

async function llamacppChat({ port, messages, maxTokens }) {
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;
  const t0 = Date.now();
  const inputTokens = estimateTokenCount(messages);
  log('llamacpp', 'request', {
    port,
    endpoint: '/v1/chat/completions',
    input_tokens_est: inputTokens,
    max_tokens: maxTokens,
    timeout_ms: LLAMACPP_FETCH_TIMEOUT_MS,
  });
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: maxTokens, stream: false }),
      signal: AbortSignal.timeout(LLAMACPP_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = serializeFetchError(err);
    logError('llamacpp', 'error', Object.assign(err, { __serialized: detail }));
    console.error('[llamacpp] ERROR fetch failed', detail);
    const wrapped = new Error(
      detail.aborted
        ? `llama.cpp request aborted/timed out after ${LLAMACPP_FETCH_TIMEOUT_MS}ms`
        : `llama.cpp fetch failed: ${detail.message}` +
          (detail.cause?.message ? ` (cause: ${detail.cause.message}${detail.cause.code ? ' ' + detail.cause.code : ''})` : ''),
    );
    wrapped.cause = err;
    throw wrapped;
  }
  if (!res.ok) {
    let bodyText = '';
    try { bodyText = await res.text(); } catch (_) {}
    const err = new Error(`llama-server chat failed: HTTP ${res.status}${bodyText ? ' ' + bodyText.slice(0, 300) : ''}`);
    logError('llamacpp', 'error', err);
    console.error('[llamacpp] ERROR http', { status: res.status, body: bodyText.slice(0, 500) });
    throw err;
  }
  const data = await res.json();
  log('llamacpp', 'response', { port, duration_ms: Date.now() - t0, input_tokens_est: inputTokens });
  return data.choices?.[0]?.message?.content || '';
}

export async function runNarratorTurn({ db, scenario, messages, turnNumber }) {
  const characters   = _getCharacters.all(scenario.id);
  const location     = scenario.active_location_id
    ? _getLocation.get(scenario.active_location_id)
    : null;
  const rules        = _getRules.all(scenario.id);
  const worldEntries = _getWorldEntries.all(scenario.id);
  const memories     = _getMemories.all(scenario.id);
  const relationships = _getRelationships.all(scenario.id, scenario.id);
  let lastArousal = 1;
  const lastTurnRow = _getLastTurnCard.get(scenario.id);
  if (lastTurnRow?.scene_card_json) {
    try {
      const parsed = JSON.parse(lastTurnRow.scene_card_json);
      if (typeof parsed?.arousal_level === 'number') {
        lastArousal = parsed.arousal_level;
      }
    } catch (_) {}
  }

  const characterStates = {};
  for (const c of characters) {
    characterStates[c.id] = ensureScenarioCharacterState(scenario.id, c.id);
    c._scenario_clothing = getScenarioClothing(scenario.id, c.id);
  }

  const config       = resolveMasterConfig(db);
  const backend      = await resolveNarratorBackend(db);
  const systemPrompt = buildSystemPrompt({ scenario, characters, location, rules, worldEntries, memories, relationships, lastArousal, characterStates, config });

  // narrator_max_tokens = OUTPUT completion budget (not input context size).
  const maxTokens = parseInt(config.narrator_max_tokens || '1200', 10);
  const inputBudget = resolveNarratorInputBudget({
    config,
    llamaRoleConfig: backend.roleConfig,
    maxOutputTokens: maxTokens,
  });

  const rawInputTokens = estimateTokenCount([
    { role: 'system', content: systemPrompt },
    ...messages,
  ]);

  const truncated = truncateNarratorPrompt({
    systemPrompt,
    messages,
    inputBudgetTokens: inputBudget,
  });
  const fullMessages = truncated.fullMessages;
  const tokenEstimate = truncated.inputTokens;

  if (truncated.droppedMessages || truncated.systemPrompt !== systemPrompt || rawInputTokens !== tokenEstimate) {
    log('narrator', 'context_truncated', {
      scenarioId: scenario.id,
      raw_input_tokens_est: rawInputTokens,
      input_tokens_est: tokenEstimate,
      input_budget: inputBudget,
      output_max_tokens: maxTokens,
      dropped_messages: truncated.droppedMessages,
    });
  }

  // Warn against INPUT budget, never against output max_tokens (that comparison was misleading).
  if (tokenEstimate >= inputBudget * 0.85) {
    console.warn('[narrator] context warning: input token estimate', tokenEstimate,
      'is near input budget', inputBudget, '(output max_tokens=', maxTokens, ')');
    audit({ service: 'narrator', stage: 'context_near_limit', status: 'warn',
            message: 'input token estimate near input budget', scenario_id: scenario.id,
            input: {
              tokenEstimate,
              inputBudget,
              narrator_max_tokens: maxTokens,
              rawInputTokens,
              scenarioId: scenario.id,
            } });
  }

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

  return {
    story_text,
    scene_card,
    model_used: backend.model || `llamacpp:${backend.port}`,
    token_estimate: tokenEstimate,
    input_budget: inputBudget,
    output_max_tokens: maxTokens,
  };
}
