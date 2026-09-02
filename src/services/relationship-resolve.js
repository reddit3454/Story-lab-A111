/**
 * Resolve global (scenario_id=0) + scenario relationship overlays.
 * Clone-on-write when applying strength deltas so globals stay pristine.
 */

export const RELATIONSHIP_TAG_WHITELIST = Object.freeze([
  'attraction', 'trust', 'tension', 'history', 'taboo',
]);

export function parseTags(tagsJson) {
  if (Array.isArray(tagsJson)) {
    return tagsJson
      .map((t) => String(t || '').toLowerCase().trim())
      .filter((t) => RELATIONSHIP_TAG_WHITELIST.includes(t));
  }
  if (tagsJson == null || tagsJson === '') return [];
  try {
    const parsed = typeof tagsJson === 'string' ? JSON.parse(tagsJson) : tagsJson;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((t) => String(t || '').toLowerCase().trim())
      .filter((t) => RELATIONSHIP_TAG_WHITELIST.includes(t));
  } catch {
    return [];
  }
}

export function serializeTags(tags) {
  return JSON.stringify(parseTags(tags));
}

function pairKey(fromId, toId) {
  return `${Number(fromId)}->${Number(toId)}`;
}

function rowWithTags(row) {
  if (!row) return null;
  const tags = parseTags(row.tags_json);
  return { ...row, tags, tags_json: serializeTags(tags) };
}

export function resolveRelationshipsForScenario(db, scenarioId) {
  const sid = Number(scenarioId);
  if (!Number.isFinite(sid) || sid < 1) return [];

  const cast = db.prepare(
    'SELECT character_id AS id FROM scenario_characters WHERE scenario_id = ?'
  ).all(sid);
  const castIds = new Set(cast.map((c) => Number(c.id)));
  if (!castIds.size) return [];

  const withNames = `
    SELECT cr.*,
      cf.name AS from_name,
      ct.name AS to_name
    FROM character_relationships cr
    JOIN characters cf ON cf.id = cr.from_character_id
    JOIN characters ct ON ct.id = cr.to_character_id
  `;

  const globals = db.prepare(
    withNames + ' WHERE cr.scenario_id = 0 ORDER BY cf.name, ct.name'
  ).all().filter((r) => castIds.has(Number(r.from_character_id)) && castIds.has(Number(r.to_character_id)));

  const scenarioRows = db.prepare(
    withNames + ' WHERE cr.scenario_id = ? ORDER BY cf.name, ct.name'
  ).all(sid);

  const map = new Map();
  for (const g of globals) {
    map.set(pairKey(g.from_character_id, g.to_character_id), rowWithTags({ ...g, _source: 'global' }));
  }
  for (const s of scenarioRows) {
    if (!castIds.has(Number(s.from_character_id)) || !castIds.has(Number(s.to_character_id))) continue;
    map.set(pairKey(s.from_character_id, s.to_character_id), rowWithTags({ ...s, _source: 'scenario' }));
  }
  return Array.from(map.values());
}

function formatStrength(s) {
  const n = Math.min(5, Math.max(1, Math.round(Number(s) || 3)));
  return n;
}

export function formatRelationshipLine(r) {
  const tags = r.tags || parseTags(r.tags_json);
  const tagPart = tags.length ? ` (${tags.join(', ')})` : '';
  const strength = formatStrength(r.strength);
  let line = `${r.from_name} -> ${r.to_name}: ${r.relationship_type}${tagPart} [intensity ${strength}/5]`;
  if (r.description && String(r.description).trim()) {
    line += ` (${String(r.description).trim()})`;
  }
  return line;
}

export function applyStrengthDelta(db, { scenarioId, fromId, toId, delta }) {
  const sid = Number(scenarioId);
  const from = Number(fromId);
  const to = Number(toId);
  const d = Math.max(-1, Math.min(1, Math.round(Number(delta) || 0)));
  if (!Number.isFinite(sid) || !Number.isFinite(from) || !Number.isFinite(to) || d === 0) return null;

  const select = db.prepare(`
    SELECT cr.*, cf.name AS from_name, ct.name AS to_name
    FROM character_relationships cr
    JOIN characters cf ON cf.id = cr.from_character_id
    JOIN characters ct ON ct.id = cr.to_character_id
    WHERE cr.scenario_id = ? AND cr.from_character_id = ? AND cr.to_character_id = ?
  `);

  let row = select.get(sid, from, to);
  if (!row) {
    const global = select.get(0, from, to);
    if (!global) return null;
    db.prepare(`
      INSERT INTO character_relationships
        (scenario_id, from_character_id, to_character_id, relationship_type, description, strength, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sid,
      from,
      to,
      global.relationship_type,
      global.description ?? '',
      global.strength ?? 3,
      serializeTags(global.tags_json),
    );
    row = select.get(sid, from, to);
  }
  if (!row) return null;

  const next = Math.min(5, Math.max(1, formatStrength(row.strength) + d));
  db.prepare(`
    UPDATE character_relationships SET strength = ? WHERE id = ?
  `).run(next, row.id);

  return rowWithTags({ ...row, strength: next, _source: 'scenario' });
}
