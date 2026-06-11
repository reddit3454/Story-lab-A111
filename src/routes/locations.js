import { Router } from 'express';
import db from '../db.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM locations WHERE scenario_id = ?').all(req.params.scenarioId));
});

router.post('/', function (req, res) {
  const { name, description, image_tags, time_of_day } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(`
    INSERT INTO locations (scenario_id, name, description, image_tags, time_of_day)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.params.scenarioId, name,
    description ?? '',
    image_tags  ?? '',
    time_of_day ?? 'any',
  );

  res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:id', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Location not found' });
  res.json(row);
});

router.put('/:id', function (req, res) {
  const { name, description, image_tags, time_of_day } = req.body;

  db.prepare(`
    UPDATE locations SET
      name        = COALESCE(?, name),
      description = COALESCE(?, description),
      image_tags  = COALESCE(?, image_tags),
      time_of_day = COALESCE(?, time_of_day)
    WHERE id = ? AND scenario_id = ?
  `).run(
    name        ?? null,
    description ?? null,
    image_tags  ?? null,
    time_of_day ?? null,
    req.params.id, req.params.scenarioId,
  );

  const row = db.prepare('SELECT * FROM locations WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Location not found' });
  res.json(row);
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM locations WHERE id = ? AND scenario_id = ?').run(req.params.id, req.params.scenarioId);
  res.json({ ok: true });
});

export default router;
