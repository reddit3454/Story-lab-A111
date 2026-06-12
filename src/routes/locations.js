import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { BACKGROUNDS_DIR } from '../paths.js';
import * as pipeline from '../services/image-pipeline.js';

const router = Router({ mergeParams: true });

function _slug(name) {
  return (name || 'location').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

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

/* ── Background routes ──────────────────────────────────────────────── */

router.get('/:id/backgrounds', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  let images;
  try { images = JSON.parse(row.background_images_json || '[]'); } catch (_) { images = []; }

  res.json({ images, default_background: row.default_background ?? null });
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

  // Update background_images_json with the new file
  let images;
  try { images = JSON.parse(row.background_images_json || '[]'); } catch (_) { images = []; }
  images.push(path.basename(result.savePath));

  db.prepare('UPDATE locations SET background_images_json = ? WHERE id = ?').run(
    JSON.stringify(images), locId
  );

  res.json({ ok: true, filename: path.basename(result.savePath), images });
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

  let images;
  try { images = JSON.parse(row.background_images_json || '[]'); } catch (_) { images = []; }
  images = images.filter(f => f !== req.params.filename);

  db.prepare('UPDATE locations SET background_images_json = ? WHERE id = ?').run(
    JSON.stringify(images), req.params.id
  );

  // Delete file from disk (best-effort)
  const slug     = _slug(row.name);
  const filePath = path.join(BACKGROUNDS_DIR, slug, req.params.filename);
  try { fs.unlinkSync(filePath); } catch (_) {}

  res.json({ ok: true, images });
});

export default router;
