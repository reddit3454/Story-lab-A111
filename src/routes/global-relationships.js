import { Router } from 'express';
import db from '../db.js';

const router = Router();

export const RELATIONSHIP_TYPES = [
  'friend', 'romantic partner', 'rival', 'enemy', 'colleague',
  'mentor', 'student', 'cousin', 'mother', 'father', 'brother',
  'sister', 'neighbor',
];

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
  res.json(db.prepare(_withNames + 'ORDER BY cf.name, ct.name').all());
});

router.post('/', function (req, res) {
  const { from_character_id, to_character_id, relationship_type, description, strength } = req.body;
  if (!from_character_id || !to_character_id) {
    return res.status(400).json({ error: 'from_character_id and to_character_id are required' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO character_relationships
        (scenario_id, from_character_id, to_character_id, relationship_type, description, strength)
      VALUES (0, ?, ?, ?, ?, ?)
    `).run(
      from_character_id,
      to_character_id,
      relationship_type ?? 'friend',
      description       ?? '',
      strength          ?? 3,
    );
    const row = db.prepare(_withNames + 'WHERE cr.id = ?').get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A relationship between these characters already exists' });
    }
    throw err;
  }
});

router.put('/:id', function (req, res) {
  const { relationship_type, description, strength } = req.body;
  db.prepare(`
    UPDATE character_relationships
    SET relationship_type = COALESCE(?, relationship_type),
        description       = COALESCE(?, description),
        strength          = COALESCE(?, strength)
    WHERE id = ?
  `).run(
    relationship_type ?? null,
    description       ?? null,
    strength          ?? null,
    req.params.id,
  );
  const row = db.prepare(_withNames + 'WHERE cr.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Relationship not found' });
  res.json(row);
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM character_relationships WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
