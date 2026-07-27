import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import broadcast from '../broadcast.js';
import { IMAGES_DIR } from '../paths.js';
import { resolveMasterConfig } from '../services/config-resolver.js';
import { loraTags } from '../services/prompt-builder.js';
import * as a1111 from '../services/a1111.js';

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

const SCRATCH_DIR = path.join(IMAGES_DIR, '_look-test-scratch');
const SAVES_DIR = path.join(IMAGES_DIR, 'look-test-saves');

function _a1111BaseUrl() {
  const config = resolveMasterConfig(db);
  return config.a1111_url || 'http://127.0.0.1:7860';
}

router.post('/test-generate', async function (req, res) {
  const b = req.body || {};
  try {
    const master = resolveMasterConfig(db);
    const loras = loraTags({ loras_json: JSON.stringify(Array.isArray(b.loras) ? b.loras : []) });
    const promptParts = [...loras, b.prompt_prefix || '', b.test_subject || '', b.prompt_suffix || ''].filter(Boolean);
    const prompt = promptParts.join(', ');
    const negative = [b.negative || '', master.master_negative || ''].filter(Boolean).join(', ');

    const payload = {
      prompt,
      negative_prompt: negative,
      steps: b.steps != null && b.steps !== '' ? parseInt(b.steps, 10) : 30,
      cfg_scale: b.cfg != null && b.cfg !== '' ? Number(b.cfg) : 7,
      width: b.width != null && b.width !== '' ? parseInt(b.width, 10) : 832,
      height: b.height != null && b.height !== '' ? parseInt(b.height, 10) : 1216,
      sampler_name: b.sampler || 'DPM++ 2M SDE',
      scheduler: b.scheduler || 'Karras',
      restore_faces: !!b.restore_faces,
      tiling: !!b.tiling,
      seed: -1,
      n_iter: 1,
      batch_size: 1,
    };
    if (b.vae || (b.clip_skip != null && b.clip_skip !== '')) {
      payload.override_settings = {};
      if (b.vae) payload.override_settings.sd_vae = b.vae;
      if (b.clip_skip != null && b.clip_skip !== '') payload.override_settings.CLIP_stop_at_last_layers = parseInt(b.clip_skip, 10);
      payload.override_settings_restore_afterwards = true;
    }

    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const savePath = path.join(SCRATCH_DIR, filename);

    const result = await a1111.txt2img(_a1111BaseUrl(), payload, savePath);
    res.json({
      ok: true,
      filename: result.filename,
      url: `/story-images/_look-test-scratch/${result.filename}`,
      seed: result.seed,
      generation_time_ms: result.generation_time_ms,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/test-generate/save', function (req, res) {
  const { filename } = req.body || {};
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).json({ ok: false, error: 'valid filename is required' });
  }
  const from = path.join(SCRATCH_DIR, filename);
  if (!fs.existsSync(from)) return res.status(404).json({ ok: false, error: 'scratch file not found' });

  fs.mkdirSync(SAVES_DIR, { recursive: true });
  const to = path.join(SAVES_DIR, filename);
  fs.renameSync(from, to);
  res.json({ ok: true, url: `/story-images/look-test-saves/${filename}` });
});

router.post('/test-generate/cleanup', function (req, res) {
  const { filenames } = req.body || {};
  let deleted = 0;
  for (const filename of Array.isArray(filenames) ? filenames : []) {
    if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) continue;
    const p = path.join(SCRATCH_DIR, filename);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      deleted++;
    }
  }
  res.json({ ok: true, deleted });
});

export default router;
