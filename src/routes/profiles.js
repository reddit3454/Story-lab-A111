import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM image_profiles ORDER BY name').all());
});

router.post('/', function (req, res) {
  const {
    name, description, prompt_prefix, prompt_suffix, negative_additions,
    lora1_file, lora1_strength, lora2_file, lora2_strength, steps_override, cfg_override,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(`
    INSERT INTO image_profiles
      (name, description, prompt_prefix, prompt_suffix, negative_additions,
       lora1_file, lora1_strength, lora2_file, lora2_strength, steps_override, cfg_override)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    description        ?? '',
    prompt_prefix      ?? '',
    prompt_suffix      ?? '',
    negative_additions ?? '',
    lora1_file         ?? '',
    lora1_strength     ?? 1.0,
    lora2_file         ?? '',
    lora2_strength     ?? 1.0,
    steps_override     ?? null,
    cfg_override       ?? null,
  );

  const row = db.prepare('SELECT * FROM image_profiles WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.put('/:id', function (req, res) {
  const existing = db.prepare('SELECT * FROM image_profiles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Profile not found' });

  const b = req.body;
  const steps = 'steps_override' in b ? b.steps_override : existing.steps_override;
  const cfg   = 'cfg_override'   in b ? b.cfg_override   : existing.cfg_override;

  db.prepare(`
    UPDATE image_profiles SET
      description        = COALESCE(?, description),
      prompt_prefix      = COALESCE(?, prompt_prefix),
      prompt_suffix      = COALESCE(?, prompt_suffix),
      negative_additions = COALESCE(?, negative_additions),
      lora1_file         = COALESCE(?, lora1_file),
      lora1_strength     = COALESCE(?, lora1_strength),
      lora2_file         = COALESCE(?, lora2_file),
      lora2_strength     = COALESCE(?, lora2_strength),
      steps_override     = ?,
      cfg_override       = ?
    WHERE id = ?
  `).run(
    b.description        ?? null,
    b.prompt_prefix      ?? null,
    b.prompt_suffix      ?? null,
    b.negative_additions ?? null,
    b.lora1_file         ?? null,
    b.lora1_strength     ?? null,
    b.lora2_file         ?? null,
    b.lora2_strength     ?? null,
    steps,
    cfg,
    req.params.id,
  );

  res.json(db.prepare('SELECT * FROM image_profiles WHERE id = ?').get(req.params.id));
});

// /active must precede /:id so Express doesn't capture "active" as an id param
router.delete('/active', function (req, res) {
  db.prepare('UPDATE image_profiles SET is_active = 0').run();
  res.json({ ok: true });
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM image_profiles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/activate', function (req, res) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE image_profiles SET is_active = 0').run();
    db.prepare('UPDATE image_profiles SET is_active = 1 WHERE id = ?').run(req.params.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const row = db.prepare('SELECT * FROM image_profiles WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Profile not found' });
  res.json(row);
});

export default router;
