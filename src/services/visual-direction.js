import { normalizeShotAction } from './image-shot-action.js';

export const SCENE_FRAMINGS = new Set(['auto', 'close', 'medium', 'wide']);
export const FULLBODY_FRAMINGS = new Set(['auto', 'medium', 'wide']);

function castIds(cast) {
  return new Set((cast || []).map((character) => Number(character.id)));
}

function validCastId(value, ids) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && ids.has(id) ? id : null;
}

export function normalizeVisualDirection(input = {}, scenarioCast = [], mode = 'scene', characterId = null) {
  const errors = [];
  const ids = castIds(scenarioCast);
  const text = normalizeShotAction(input.text != null ? input.text : input.action_text);
  const framing = String(input.framing || 'auto').trim().toLowerCase() || 'auto';
  if (mode === 'fullbody') {
    if (!validCastId(characterId, ids)) errors.push('fullbody character must belong to the scenario cast');
    if (input.subjectIds != null || input.subject_ids != null) errors.push('fullbody direction cannot contain scene subjects');
    if (!FULLBODY_FRAMINGS.has(framing)) errors.push('fullbody framing must be auto, medium, or wide');
    return { direction: { action_text: text, framing }, errors };
  }
  if (mode !== 'scene') return { direction: null, errors: ['mode must be scene or fullbody'] };
  const sourceIds = input.subjectIds != null ? input.subjectIds : (input.subject_ids || []);
  const subjectIds = Array.isArray(sourceIds) ? sourceIds.map(Number) : [];
  if (!SCENE_FRAMINGS.has(framing)) errors.push('scene framing must be auto, close, medium, or wide');
  if (subjectIds.some((id) => !Number.isInteger(id) || id <= 0)) errors.push('scene subjects must be positive integer ids');
  if (new Set(subjectIds).size !== subjectIds.length) errors.push('scene subjects must be unique');
  if (subjectIds.length > 2) errors.push('scene mode allows at most two subjects');
  if (subjectIds.some((id) => !ids.has(id))) errors.push('every scene subject must belong to the scenario cast');
  // The returned direction only ever carries ids that are still in the cast. The
  // count/uniqueness/membership errors above are still raised for the PUT path
  // (which rejects on any error), but the read path (parseVisualDirections) then
  // never hands back a stale id for a character that has since left the scenario.
  const liveSubjectIds = subjectIds.filter((id) => ids.has(id));
  return { direction: { action_text: text, subject_ids: liveSubjectIds, framing }, errors };
}

export function parseVisualDirections(raw, scenarioCast = []) {
  let parsed = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
  const scene = normalizeVisualDirection(parsed.scene || {}, scenarioCast, 'scene').direction;
  const fullbodyByCharacter = {};
  const ids = castIds(scenarioCast);
  const entries = parsed && typeof parsed.fullbody_by_character === 'object' ? parsed.fullbody_by_character : {};
  Object.entries(entries || {}).forEach(([key, value]) => {
    const id = validCastId(key, ids);
    if (!id) return;
    const normalized = normalizeVisualDirection(value || {}, scenarioCast, 'fullbody', id);
    if (!normalized.errors.length) fullbodyByCharacter[String(id)] = normalized.direction;
  });
  return { version: 1, scene, fullbody_by_character: fullbodyByCharacter };
}

export function visualDirectionPromptText(direction, mode = 'scene') {
  if (!direction?.action_text) return '';
  const framing = direction.framing && direction.framing !== 'auto' ? `${direction.framing} shot` : '';
  const fullbody = mode === 'fullbody' ? 'full-body composition, entire figure in frame' : '';
  return [fullbody, framing, direction.action_text].filter(Boolean).join(', ');
}
