import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { BACKGROUNDS_DIR } from '../paths.js';
import * as pipeline from '../services/image-pipeline.js';

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

/* ── Background routes ────────────────────────────────────────────── */

router.get('/:id/backgrounds', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  const folder = row.background_folder || '';
  if (!folder) return res.json({ ok: false, error: 'No background folder set' });

  const folderPath = path.join(BACKGROUNDS_DIR, folder);
  if (!fs.existsSync(folderPath)) {
    return res.json({ ok: false, error: 'Folder not found: ' + folderPath });
  }

  let files;
  try {
    files = fs.readdirSync(folderPath).filter(f => /\.(png|jpg|jpeg)$/i.test(f)).sort();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read folder: ' + err.message });
  }

  res.json({ ok: true, folder, files, default_background: row.default_background || null });
});

router.post('/:id/generate-background', async function (req, res) {
  const locId = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(locId);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  let result;
  try {
    result = await pipeline.generate({
      mode:       'background',
      scenarioId: parseInt(req.params.scenarioId, 10),
      opts:       { locationId: locId },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Background generation failed: ' + err.message });
  }

  res.json({ ok: true, filename: path.basename(result.savePath) });
});

router.post('/:id/backgrounds/:filename/set-default', function (req, res) {
  const row = db.prepare('SELECT id FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  db.prepare('UPDATE locations SET default_background = ? WHERE id = ?').run(
    req.params.filename, req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id/backgrounds/:filename', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  const folder = row.background_folder || '';
  if (folder) {
    const filePath = path.join(BACKGROUNDS_DIR, folder, req.params.filename);
    try { fs.unlinkSync(filePath); } catch (_) {}
  }

  res.json({ ok: true });
});

export default router;
