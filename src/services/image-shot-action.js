/**
 * Resolve concise, image-ready Shot/action content from a turn.
 * Content only — style comes from the active Look (stripStyleWords).
 */

import { stripStyleWords } from './prompt-builder.js';
import * as ollama from './ollama.js';
import { resolveNarratorModel } from './model-resolver.js';

export const SHOT_ACTION_MAX_LEN = 320;
export const SHOT_ACTION_PLACEHOLDER =
  'Describe what should be visible in this shot (characters, pose, setting, lighting).';

const SCENE_CARD_KEYS = [
  'image_prompt',
  'imagePrompt',
  'visual_brief',
  'visualBrief',
  'summary_plain',
  'summaryPlain',
];

const LLM_SYSTEM = `You write a single short image scene description for an image generator.
Output ONLY the description text — no labels, no quotes, no bullet lists, no JSON.

Rules:
- Camera-observable details only: who is visible, pose/action, framing if useful, setting, visible lighting/mood.
- No dialogue, no internal thoughts, no literary prose, no backstory.
- No style words: no cinematic, photoreal, anime, 3D render, masterpiece, best quality, hyper-realistic, etc.
- Adult characters when the scene implies adults; keep wording tasteful but accurate.
- Maximum 300 characters.`;

/**
 * Normalize whitespace, strip style vocabulary, enforce max length.
 */
export function normalizeShotAction(text, maxLen = SHOT_ACTION_MAX_LEN) {
  if (!text) return '';
  let s = String(text).replace(/\s+/g, ' ').trim();
  s = stripStyleWords(s);
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) {
    s = s.slice(0, maxLen).replace(/\s+\S*$/, '').trim();
  }
  return s;
}

/**
 * True when text looks like a short visual description, not a tag soup or full story.
 */
export function isImageReadySummary(text) {
  if (!text) return false;
  const len = text.length;
  if (len < 15 || len > SHOT_ACTION_MAX_LEN) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  const commas = (text.match(/,/g) || []).length;
  // Legacy summary_tags-style comma lists
  if (commas >= 6 && commas >= words.length * 0.45) return false;
  return true;
}

export function extractFromSceneCard(sceneCard) {
  if (!sceneCard || typeof sceneCard !== 'object') return null;
  for (const key of SCENE_CARD_KEYS) {
    const raw = sceneCard[key];
    if (!raw || typeof raw !== 'string') continue;
    const normalized = normalizeShotAction(raw);
    if (isImageReadySummary(normalized)) return normalized;
  }
  return null;
}

/**
 * Conservative heuristic — never returns the full narration.
 */
export function heuristicFromNarration(contentText, maxLen = SHOT_ACTION_MAX_LEN) {
  if (!contentText) return '';
  const cleaned = String(contentText).replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const sentenceRe = /[^.!?…]+[.!?…]+|[^.!?…]+$/g;
  const sentences = cleaned.match(sentenceRe) || [cleaned];

  for (const raw of sentences) {
    const s = raw.trim();
    if (s.length < 25) continue;
    if (/^["'“‘]/.test(s)) continue;
    if (/^(he|she|they|it)\s+(thought|wondered|felt|remembered)\b/i.test(s)) continue;
    const normalized = normalizeShotAction(s, maxLen);
    if (isImageReadySummary(normalized)) return normalized;
    if (normalized.length >= 25 && normalized.length <= maxLen) return normalized;
  }

  // Last resort: clipped opening clause — still never the full story.
  const clipped = normalizeShotAction(cleaned, Math.min(180, maxLen));
  if (clipped.length >= 25 && clipped.length < cleaned.length * 0.45) {
    return clipped;
  }
  return '';
}

export function parseSceneCardJson(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Synchronous resolution (no LLM). Returns { text, source, needs_suggest }.
 */
export function resolveShotActionSync(turn) {
  if (!turn) {
    return { text: '', source: 'empty', needs_suggest: false };
  }

  const draft = (turn.image_action_draft || '').trim();
  if (draft) {
    return {
      text: normalizeShotAction(draft),
      source: 'user_draft',
      needs_suggest: false,
    };
  }

  const sceneCard = parseSceneCardJson(turn.scene_card_json);
  const fromCard = extractFromSceneCard(sceneCard);
  if (fromCard) {
    return { text: fromCard, source: 'scene_card', needs_suggest: false };
  }

  const cached = sceneCard.image_shot_summary;
  if (typeof cached === 'string' && cached.trim()) {
    const normalized = normalizeShotAction(cached);
    if (isImageReadySummary(normalized)) {
      return { text: normalized, source: 'cached', needs_suggest: false };
    }
  }

  const content = turn.content_text || '';
  const isLongNarrator = turn.role === 'narrator' && content.length > 200;

  if (isLongNarrator) {
    return { text: '', source: 'empty', needs_suggest: true };
  }

  const heuristic = heuristicFromNarration(content);
  if (heuristic) {
    return { text: heuristic, source: 'heuristic', needs_suggest: false };
  }

  return {
    text: '',
    source: 'empty',
    needs_suggest: content.length > 80,
  };
}

export async function suggestShotActionViaLlm({ contentText, db, mode = 'scene', focusCharacter = null }) {
  const excerpt = String(contentText || '').replace(/\s+/g, ' ').trim().slice(0, 2500);
  if (!excerpt) return { text: '', ok: false, error: 'No turn content to summarize' };

  const model = await resolveNarratorModel(db);
  const prompt = mode === 'fullbody' && focusCharacter
    ? `From this story beat, describe ONLY ${focusCharacter} as a full-body shot: their pose, action, and what they are wearing. One short sentence. Do not describe other characters or the wider setting.\n\n${excerpt}`
    : `Story beat to summarize visually:\n\n${excerpt}`;

  try {
    const data = await ollama.generate({
      model,
      system: LLM_SYSTEM,
      prompt,
      options: { temperature: 0.35, num_predict: 120 },
    });
    const raw = (data.response || '').trim();
    const normalized = normalizeShotAction(raw);
    if (!normalized) {
      return { text: '', ok: false, error: 'Model returned empty summary' };
    }
    return { text: normalized, ok: true };
  } catch (err) {
    return { text: '', ok: false, error: err.message || 'LLM unavailable' };
  }
}

export function cacheShotSummaryInSceneCard(db, turnId, scenarioId, summary) {
  const turn = db.prepare('SELECT scene_card_json FROM turns WHERE id = ? AND scenario_id = ?').get(turnId, scenarioId);
  if (!turn) return false;
  const card = parseSceneCardJson(turn.scene_card_json);
  card.image_shot_summary = summary;
  db.prepare('UPDATE turns SET scene_card_json = ? WHERE id = ? AND scenario_id = ?').run(
    JSON.stringify(card),
    turnId,
    scenarioId,
  );
  return true;
}
