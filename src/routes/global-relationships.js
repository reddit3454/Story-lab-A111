import { Router } from 'express';
import db from '../db.js';
import { parseTags, serializeTags } from '../services/relationship-resolve.js';

const router = Router();

// ORPHAN: not imported anywhere — safe to delete if unneeded
export const RELATIONSHIP_TYPES = [
  'friend', 'romantic partner', 'rival', 'enemy', 'colleague',
  'mentor', 'student', 'cousin', 'mother', 'father', 'brother',
  'sister', 'neighbor',
];

function mapRow(row) {
  if (!row) return row;
  const tags = parseTags(row.tags_json);
  return { ...row, tags, tags_json: serializeTags(tags) };
}

const _withNames = `
  SELECT cr.*,
    cf.name AS from_name,
    ct.name AS to_name
  FROM character_relationships cr
  JOIN characters cf ON cf.id = cr.from_character_id
  JOIN characters ct ON ct.id = cr.to_character_id
`;

router.get('/types', function (req, res) {
  res.json(RELATIONSHIP_TYPES);
});

router.get('/', function (req, res) {
  const rows = db.prepare(_withNames + ' WHERE cr.scenario_id = 0 ORDER BY cf.name, ct.name').all();
  res.json(rows.map(mapRow));
});

router.post('/', function (req, res) {
  const { from_character_id, to_character_id, relationship_type, description, strength, tags, tags_json } = req.body;
  if (!from_character_id || !to_character_id) {
    return res.status(400).json({ error: 'from_character_id and to_character_id are required' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO character_relationships
        (scenario_id, from_character_id, to_character_id, relationship_type, description, strength, tags_json)
      VALUES (0, ?, ?, ?, ?, ?, ?)
    `).run(
      from_character_id,
      to_character_id,
      relationship_type ?? 'friend',
      description       ?? '',
      strength          ?? 3,
      serializeTags(tags ?? tags_json),
    );
    const row = db.prepare(_withNames + 'WHERE cr.id = ?').get(result.lastInsertRowid);
    res.status(201).json(mapRow(row));
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A relationship between these characters already exists' });
    }
    throw err;
  }
});

router.put('/:id', function (req, res) {
  const { relationship_type, description, strength, tags, tags_json } = req.body;
  db.prepare(`
    UPDATE character_relationships
    SET relationship_type = COALESCE(?, relationship_type),
        description       = COALESCE(?, description),
        strength          = COALESCE(?, strength),
        tags_json         = COALESCE(?, tags_json)
    WHERE id = ?
  `).run(
    relationship_type ?? null,
    description       ?? null,
    strength          ?? null,
    (tags !== undefined || tags_json !== undefined) ? serializeTags(tags ?? tags_json) : null,
    req.params.id,
  );
  const row = db.prepare(_withNames + 'WHERE cr.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Relationship not found' });
  res.json(mapRow(row));
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM character_relationships WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
