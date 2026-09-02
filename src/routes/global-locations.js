import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM locations ORDER BY name ASC').all());
});

router.post('/', function (req, res) {
  const { name, description, short_desc, full_desc, tags, time_of_day } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const fullDesc = full_desc ?? description ?? '';
  const shortDesc = short_desc ?? '';

  const result = db.prepare(`
    INSERT INTO locations (name, description, short_desc, full_desc, tags, time_of_day)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    name,
    fullDesc,
    shortDesc,
    fullDesc,
    tags ?? '',
    time_of_day ?? 'any',
  );

  res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', function (req, res) {
  const row = db.prepare('SELECT id FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  const { name, description, short_desc, full_desc, tags, time_of_day } = req.body;

  const existing = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  const nextFullDesc = full_desc ?? description ?? existing.full_desc ?? existing.description ?? '';
  const nextShortDesc = short_desc ?? existing.short_desc ?? '';

  db.prepare(`
    UPDATE locations SET
      name        = COALESCE(?, name),
      description = COALESCE(?, description),
      short_desc  = COALESCE(?, short_desc),
      full_desc   = COALESCE(?, full_desc),
      tags        = COALESCE(?, tags),
      time_of_day = COALESCE(?, time_of_day)
    WHERE id = ?
  `).run(
    name          ?? null,
    nextFullDesc  || null,
    nextShortDesc || null,
    nextFullDesc  || null,
    tags          ?? null,
    time_of_day   ?? null,
    req.params.id,
  );

  res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id));
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM locations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
