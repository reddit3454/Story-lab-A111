import { Router } from 'express';
import db from '../db.js';

const router = Router({ mergeParams: true });

const _withNames = `
  SELECT cr.*,
    cf.name AS from_name,
    ct.name AS to_name
  FROM character_relationships cr
  JOIN characters cf ON cf.id = cr.from_character_id
  JOIN characters ct ON ct.id = cr.to_character_id
`;

router.get('/', function (req, res) {
  const rows = db.prepare(_withNames + 'WHERE cr.scenario_id = ? ORDER BY cf.name, ct.name')
    .all(req.params.scenarioId);
  res.json(rows);
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
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.params.scenarioId,
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
      return res.status(409).json({ error: 'A relationship between these characters already exists in this scenario' });
    }
    throw err;
  }
});

router.put('/:relId', function (req, res) {
  const { relationship_type, description, strength } = req.body;
  db.prepare(`
    UPDATE character_relationships
    SET relationship_type = COALESCE(?, relationship_type),
        description       = COALESCE(?, description),
        strength          = COALESCE(?, strength)
    WHERE id = ? AND scenario_id = ?
  `).run(
    relationship_type ?? null,
    description       ?? null,
    strength          ?? null,
    req.params.relId,
    req.params.scenarioId,
  );
  const row = db.prepare(_withNames + 'WHERE cr.id = ?').get(req.params.relId);
  if (!row) return res.status(404).json({ error: 'Relationship not found' });
  res.json(row);
});

router.delete('/:relId', function (req, res) {
  db.prepare('DELETE FROM character_relationships WHERE id = ? AND scenario_id = ?')
    .run(req.params.relId, req.params.scenarioId);
  res.json({ ok: true });
});

export default router;
