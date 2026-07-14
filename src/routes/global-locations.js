import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import db from '../db.js';
import { BACKGROUNDS_DIR } from '../paths.js';

const router = Router();

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM locations ORDER BY name ASC').all());
});

router.post('/', function (req, res) {
  const {
    name, description, short_desc, full_desc, tags,
    image_tags, image_tags_day, image_tags_night,
    time_of_day, background_folder, default_background,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const dayTags = image_tags_day ?? image_tags ?? '';
  const fullDesc = full_desc ?? description ?? '';
  const shortDesc = short_desc ?? '';

  const result = db.prepare(`
    INSERT INTO locations (
      name, description, short_desc, full_desc, tags,
      image_tags, image_tags_day, image_tags_night,
      time_of_day, background_folder, default_background
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    fullDesc,
    shortDesc,
    fullDesc,
    tags ?? '',
    dayTags,
    image_tags_day ?? dayTags ?? null,
    image_tags_night ?? null,
    time_of_day        ?? 'any',
    background_folder  ?? '',
    default_background ?? '',
  );

  res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', function (req, res) {
  const row = db.prepare('SELECT id FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  const {
    name, description, short_desc, full_desc, tags,
    image_tags, image_tags_day, image_tags_night,
    time_of_day, background_folder, default_background,
  } = req.body;

  const existing = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  const nextFullDesc = full_desc ?? description ?? existing.full_desc ?? existing.description ?? '';
  const nextShortDesc = short_desc ?? existing.short_desc ?? '';
  const nextDayTags = image_tags_day ?? image_tags ?? existing.image_tags_day ?? existing.image_tags ?? '';

  db.prepare(`
    UPDATE locations SET
      name               = COALESCE(?, name),
      description        = COALESCE(?, description),
      short_desc         = COALESCE(?, short_desc),
      full_desc          = COALESCE(?, full_desc),
      tags               = COALESCE(?, tags),
      image_tags         = COALESCE(?, image_tags),
      image_tags_day     = COALESCE(?, image_tags_day),
      image_tags_night   = COALESCE(?, image_tags_night),
      time_of_day        = COALESCE(?, time_of_day),
      background_folder  = COALESCE(?, background_folder),
      default_background = COALESCE(?, default_background)
    WHERE id = ?
  `).run(
    name               ?? null,
    nextFullDesc       || null,
    nextShortDesc      || null,
    nextFullDesc       || null,
    tags               ?? null,
    nextDayTags        || null,
    image_tags_day     ?? null,
    image_tags_night   ?? null,
    time_of_day        ?? null,
    background_folder  ?? null,
    default_background ?? null,
    req.params.id,
  );

  res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id));
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM locations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ── Location backgrounds (DB-driven) ────────────────────────────── */

router.get('/:id/backgrounds', function (req, res) {
  const row = db.prepare('SELECT id FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });
  const rows = db.prepare(
    'SELECT * FROM location_backgrounds WHERE location_id = ? ORDER BY is_default DESC, id ASC'
  ).all(req.params.id);
  res.json(rows);
});

router.post('/:id/backgrounds', function (req, res) {
  const row = db.prepare('SELECT id FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename is required' });
  db.prepare('INSERT OR IGNORE INTO location_backgrounds (location_id, filename) VALUES (?, ?)').run(req.params.id, filename);
  const newRow = db.prepare('SELECT * FROM location_backgrounds WHERE location_id = ? AND filename = ?').get(req.params.id, filename);
  res.status(201).json(newRow);
});

router.post('/:id/backgrounds/:bgId/set-default', function (req, res) {
  const row = db.prepare('SELECT id FROM location_backgrounds WHERE id = ? AND location_id = ?').get(req.params.bgId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Background not found' });
  db.prepare('UPDATE location_backgrounds SET is_default = 0 WHERE location_id = ?').run(req.params.id);
  db.prepare('UPDATE location_backgrounds SET is_default = 1 WHERE id = ?').run(req.params.bgId);
  res.json({ ok: true });
});

router.delete('/:id/backgrounds/:bgId', function (req, res) {
  db.prepare('DELETE FROM location_backgrounds WHERE id = ? AND location_id = ?').run(req.params.bgId, req.params.id);
  res.json({ ok: true });
});

router.post('/:id/scan-backgrounds', function (req, res) {
  const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });
  const folder = row.background_folder || '';
  if (!folder) return res.status(400).json({ error: 'No background_folder set on this location' });
  const folderPath = path.join(BACKGROUNDS_DIR, folder);
  if (!fs.existsSync(folderPath)) {
    return res.status(404).json({ error: `Folder not found: ${folderPath}` });
  }
  let files;
  try {
    files = fs.readdirSync(folderPath).filter(f => /\.(png|jpg|jpeg)$/i.test(f)).sort();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read folder: ' + err.message });
  }
  const insert = db.prepare(
    'INSERT OR IGNORE INTO location_backgrounds (location_id, filename) VALUES (?, ?)'
  );
  for (const filename of files) {
    insert.run(row.id, filename);
  }
  const hasDefault = db.prepare(
    'SELECT id FROM location_backgrounds WHERE location_id = ? AND is_default = 1'
  ).get(row.id);
  if (!hasDefault && files.length) {
    db.prepare(
      'UPDATE location_backgrounds SET is_default = 1 WHERE location_id = ? AND filename = ?'
    ).run(row.id, files[0]);
  }
  const allRows = db.prepare(
    'SELECT * FROM location_backgrounds WHERE location_id = ? ORDER BY is_default DESC, id ASC'
  ).all(row.id);
  res.json({ ok: true, scanned: files.length, backgrounds: allRows });
});

export default router;
