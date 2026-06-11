import { Router } from 'express';
import db from '../db.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM rules WHERE scenario_id = ? ORDER BY priority DESC').all(req.params.scenarioId));
});

router.post('/', function (req, res) {
  const { content, priority } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  const result = db.prepare(
    'INSERT INTO rules (scenario_id, content, priority) VALUES (?, ?, ?)'
  ).run(req.params.scenarioId, content, priority ?? 0);

  res.status(201).json(db.prepare('SELECT * FROM rules WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', function (req, res) {
  const { content, priority } = req.body;

  db.prepare(`
    UPDATE rules SET
      content  = COALESCE(?, content),
      priority = COALESCE(?, priority)
    WHERE id = ? AND scenario_id = ?
  `).run(
    content  ?? null,
    priority ?? null,
    req.params.id, req.params.scenarioId,
  );

  const row = db.prepare('SELECT * FROM rules WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Rule not found' });
  res.json(row);
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM rules WHERE id = ? AND scenario_id = ?').run(req.params.id, req.params.scenarioId);
  res.json({ ok: true });
});

export default router;
