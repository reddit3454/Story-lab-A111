import { Router } from 'express';
import db from '../db.js';

const router = Router({ mergeParams: true });

/* ── Scenario membership ──────────────────────────────────────────── */

router.get('/', function (req, res) {
  const rows = db.prepare(`
    SELECT l.* FROM locations l
    JOIN scenario_locations sl ON l.id = sl.location_id
    WHERE sl.scenario_id = ?
    ORDER BY l.name ASC
  `).all(req.params.scenarioId);
  res.json(rows);
});

router.post('/:locationId/add', function (req, res) {
  const loc = db.prepare('SELECT id FROM locations WHERE id = ?').get(req.params.locationId);
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  db.prepare('INSERT OR IGNORE INTO scenario_locations (scenario_id, location_id) VALUES (?, ?)').run(
    req.params.scenarioId, req.params.locationId
  );
  res.status(201).json({ ok: true });
});

router.delete('/:locationId/remove', function (req, res) {
  db.prepare('DELETE FROM scenario_locations WHERE scenario_id = ? AND location_id = ?').run(
    req.params.scenarioId, req.params.locationId
  );
  res.json({ ok: true });
});

/* ── Single location fetch ────────────────────────────────────────── */

router.get('/:id', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });
  res.json(row);
});

export default router;
