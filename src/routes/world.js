import { Router } from 'express';
import db from '../db.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM world_entries WHERE scenario_id = ?').all(req.params.scenarioId));
});

router.post('/', function (req, res) {
  const { title, content, category } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'title and content are required' });

  const result = db.prepare(`
    INSERT INTO world_entries (scenario_id, title, content, category)
    VALUES (?, ?, ?, ?)
  `).run(req.params.scenarioId, title, content, category ?? 'general');

  res.status(201).json(db.prepare('SELECT * FROM world_entries WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', function (req, res) {
  const { title, content, category } = req.body;

  db.prepare(`
    UPDATE world_entries SET
      title    = COALESCE(?, title),
      content  = COALESCE(?, content),
      category = COALESCE(?, category)
    WHERE id = ? AND scenario_id = ?
  `).run(
    title    ?? null,
    content  ?? null,
    category ?? null,
    req.params.id, req.params.scenarioId,
  );

  const row = db.prepare('SELECT * FROM world_entries WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  res.json(row);
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM world_entries WHERE id = ? AND scenario_id = ?').run(req.params.id, req.params.scenarioId);
  res.json({ ok: true });
});

export default router;
