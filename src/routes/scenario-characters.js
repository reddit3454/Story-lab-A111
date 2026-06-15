import { Router } from 'express';
import db from '../db.js';

const router = Router({ mergeParams: true });

// GET — list characters linked to this scenario
router.get('/', function (req, res) {
  const rows = db.prepare(`
    SELECT c.* FROM characters c
    JOIN scenario_characters sc ON c.id = sc.character_id
    WHERE sc.scenario_id = ?
    ORDER BY c.name
  `).all(req.params.scenarioId);
  res.json(rows);
});

// POST /:charId — add a character to this scenario
router.post('/:charId', function (req, res) {
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(req.params.charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  db.prepare('INSERT OR IGNORE INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)')
    .run(req.params.scenarioId, req.params.charId);
  res.json({ ok: true });
});

// DELETE /:charId — remove a character from this scenario
router.delete('/:charId', function (req, res) {
  db.prepare('DELETE FROM scenario_characters WHERE scenario_id = ? AND character_id = ?')
    .run(req.params.scenarioId, req.params.charId);
  res.json({ ok: true });
});

export default router;
