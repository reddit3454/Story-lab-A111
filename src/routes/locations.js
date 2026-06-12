import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { BACKGROUNDS_DIR } from '../paths.js';
import * as pipeline from '../services/image-pipeline.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM locations WHERE scenario_id = ?').all(req.params.scenarioId));
});

router.post('/', function (req, res) {
  const { name, description, image_tags, time_of_day, background_folder, default_background } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(`
    INSERT INTO locations (scenario_id, name, description, image_tags, time_of_day, background_folder, default_background)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.scenarioId, name,
    description        ?? '',
    image_tags         ?? '',
    time_of_day        ?? 'any',
    background_folder  ?? '',
    default_background ?? '',
  );

  res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:id', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Location not found' });
  res.json(row);
});

router.put('/:id', function (req, res) {
  const { name, description, image_tags, time_of_day, background_folder, default_background } = req.body;

  db.prepare(`
    UPDATE locations SET
      name               = COALESCE(?, name),
      description        = COALESCE(?, description),
      image_tags         = COALESCE(?, image_tags),
      time_of_day        = COALESCE(?, time_of_day),
      background_folder  = COALESCE(?, background_folder),
      default_background = COALESCE(?, default_background)
    WHERE id = ? AND scenario_id = ?
  `).run(
    name               ?? null,
    description        ?? null,
    image_tags         ?? null,
    time_of_day        ?? null,
    background_folder  ?? null,
    default_background ?? null,
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

/* ── Background routes ──────────────────────────────────────────────── */

router.get('/:id/backgrounds', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
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
  const { scenarioId } = req.params;
  const locId = parseInt(req.params.id, 10);

  const row = db.prepare('SELECT * FROM locations WHERE id = ? AND scenario_id = ?').get(locId, scenarioId);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  let result;
  try {
    result = await pipeline.generate({
      mode:       'background',
      scenarioId: parseInt(scenarioId, 10),
      opts:       { locationId: locId },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Background generation failed: ' + err.message });
  }

  res.json({ ok: true, filename: path.basename(result.savePath) });
});

router.post('/:id/backgrounds/:filename/set-default', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  db.prepare('UPDATE locations SET default_background = ? WHERE id = ?').run(
    req.params.filename, req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id/backgrounds/:filename', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  const folder = row.background_folder || '';
  if (folder) {
    const filePath = path.join(BACKGROUNDS_DIR, folder, req.params.filename);
    try { fs.unlinkSync(filePath); } catch (_) {}
  }

  res.json({ ok: true });
});

export default router;
