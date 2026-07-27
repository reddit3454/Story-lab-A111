import { Router } from 'express';
import db from '../db.js';
import broadcast from '../broadcast.js';

const router = Router();

function _clean(row) {
  if (!row) return row;
  return { ...row, is_active: !!row.is_active, restore_faces: !!row.restore_faces, tiling: !!row.tiling };
}

router.get('/', function (req, res) {
  const rows = db.prepare('SELECT * FROM image_looks ORDER BY name ASC').all();
  res.json(rows.map(_clean));
});

router.get('/active', function (req, res) {
  const row = db.prepare('SELECT * FROM image_looks WHERE is_active = 1 LIMIT 1').get();
  res.json(_clean(row) || null);
});

router.get('/:id', function (req, res) {
  const row = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Look not found' });
  res.json(_clean(row));
});

router.post('/', function (req, res) {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const result = db.prepare(`
    INSERT INTO image_looks (
      name, description, checkpoint, vae, clip_skip, restore_faces, tiling, loras_json,
      prompt_prefix, prompt_suffix, negative,
      sampler, scheduler, steps, cfg, width, height
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    String(b.name).trim(),
    b.description ?? '',
    b.checkpoint ?? '',
    b.vae ?? '',
    b.clip_skip != null && b.clip_skip !== '' ? parseInt(b.clip_skip, 10) : null,
    b.restore_faces ? 1 : 0,
    b.tiling ? 1 : 0,
    JSON.stringify(Array.isArray(b.loras) ? b.loras : []),
    b.prompt_prefix ?? '',
    b.prompt_suffix ?? '',
    b.negative ?? '',
    b.sampler || 'DPM++ 2M SDE',
    b.scheduler || 'Karras',
    b.steps != null && b.steps !== '' ? parseInt(b.steps, 10) : 30,
    b.cfg != null && b.cfg !== '' ? Number(b.cfg) : 7,
    b.width != null && b.width !== '' ? parseInt(b.width, 10) : 832,
    b.height != null && b.height !== '' ? parseInt(b.height, 10) : 1216,
  );

  const row = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(_clean(row));
});

router.put('/:id', function (req, res) {
  const existing = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Look not found' });
  const b = req.body || {};

  db.prepare(`
    UPDATE image_looks SET
      name           = ?,
      description    = ?,
      checkpoint     = ?,
      vae            = ?,
      clip_skip      = ?,
      restore_faces  = ?,
      tiling         = ?,
      loras_json     = ?,
      prompt_prefix  = ?,
      prompt_suffix  = ?,
      negative       = ?,
      sampler        = ?,
      scheduler      = ?,
      steps          = ?,
      cfg            = ?,
      width          = ?,
      height         = ?
    WHERE id = ?
  `).run(
    b.name != null && String(b.name).trim() ? String(b.name).trim() : existing.name,
    b.description ?? existing.description,
    b.checkpoint ?? existing.checkpoint,
    b.vae ?? existing.vae,
    b.clip_skip !== undefined ? (b.clip_skip === '' || b.clip_skip === null ? null : parseInt(b.clip_skip, 10)) : existing.clip_skip,
    b.restore_faces !== undefined ? (b.restore_faces ? 1 : 0) : existing.restore_faces,
    b.tiling !== undefined ? (b.tiling ? 1 : 0) : existing.tiling,
    b.loras !== undefined ? JSON.stringify(Array.isArray(b.loras) ? b.loras : []) : existing.loras_json,
    b.prompt_prefix ?? existing.prompt_prefix,
    b.prompt_suffix ?? existing.prompt_suffix,
    b.negative ?? existing.negative,
    b.sampler || existing.sampler,
    b.scheduler || existing.scheduler,
    b.steps != null && b.steps !== '' ? parseInt(b.steps, 10) : existing.steps,
    b.cfg != null && b.cfg !== '' ? Number(b.cfg) : existing.cfg,
    b.width != null && b.width !== '' ? parseInt(b.width, 10) : existing.width,
    b.height != null && b.height !== '' ? parseInt(b.height, 10) : existing.height,
    req.params.id,
  );

  const row = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(req.params.id);
  res.json(_clean(row));
});

router.delete('/:id', function (req, res) {
  const existing = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Look not found' });

  db.prepare('DELETE FROM image_looks WHERE id = ?').run(req.params.id);

  // Exactly one Look must remain active if any Looks remain at all.
  if (existing.is_active) {
    const next = db.prepare('SELECT id FROM image_looks ORDER BY id ASC LIMIT 1').get();
    if (next) db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(next.id);
  }

  res.json({ ok: true });
});

router.post('/:id/activate', function (req, res) {
  const existing = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Look not found' });

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE image_looks SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(req.params.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const row = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(req.params.id);
  broadcast.send('lookactivated', { lookId: row.id, name: row.name });
  res.json(_clean(row));
});

export default router;
