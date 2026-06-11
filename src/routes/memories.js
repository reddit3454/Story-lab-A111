import { Router } from 'express';
import db from '../db.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM memories WHERE scenario_id = ? ORDER BY created_at DESC').all(req.params.scenarioId));
});

router.post('/', function (req, res) {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  const result = db.prepare(
    "INSERT INTO memories (scenario_id, content, memory_type) VALUES (?, ?, 'manual')"
  ).run(req.params.scenarioId, content);

  res.status(201).json(db.prepare('SELECT * FROM memories WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM memories WHERE id = ? AND scenario_id = ?').run(req.params.id, req.params.scenarioId);
  res.json({ ok: true });
});

export default router;
