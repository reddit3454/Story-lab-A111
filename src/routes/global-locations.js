import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM locations ORDER BY name ASC').all());
});

router.post('/', function (req, res) {
  const { name, description, image_tags, time_of_day, background_folder, default_background } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(`
    INSERT INTO locations (name, description, image_tags, time_of_day, background_folder, default_background)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    name,
    description        ?? '',
    image_tags         ?? '',
    time_of_day        ?? 'any',
    background_folder  ?? '',
    default_background ?? '',
  );

  res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', function (req, res) {
  const row = db.prepare('SELECT id FROM locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Location not found' });

  const { name, description, image_tags, time_of_day, background_folder, default_background } = req.body;

  db.prepare(`
    UPDATE locations SET
      name               = COALESCE(?, name),
      description        = COALESCE(?, description),
      image_tags         = COALESCE(?, image_tags),
      time_of_day        = COALESCE(?, time_of_day),
      background_folder  = COALESCE(?, background_folder),
      default_background = COALESCE(?, default_background)
    WHERE id = ?
  `).run(
    name               ?? null,
    description        ?? null,
    image_tags         ?? null,
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

export default router;
