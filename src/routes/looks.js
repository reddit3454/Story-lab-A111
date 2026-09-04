import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import broadcast from '../broadcast.js';
import { IMAGES_DIR } from '../paths.js';
import { resolveMasterConfig } from '../services/config-resolver.js';
import { buildPrompt } from '../services/prompt-builder.js';
import { LOOK_SNAPSHOT_FIELDS, parseLookSnapshot, snapshotLook } from '../services/look-version.js';
import * as a1111 from '../services/a1111.js';

const router = Router();

function _clean(row) {
  if (!row) return row;
  return { ...row, is_active: !!row.is_active, restore_faces: !!row.restore_faces, tiling: !!row.tiling };
}

function _draftResponse(row) {
  if (!row) return row;
  const snapshot = parseLookSnapshot(row.snapshot_json);
  return {
    id: row.id,
    look_id: row.look_id,
    status: row.status,
    source_version_id: row.source_version_id,
    created_at: row.created_at,
    activated_at: row.activated_at,
    ...snapshot,
    is_draft: true,
  };
}

function _emptyLookSnapshot() {
  return {
    name: '',
    description: '',
    checkpoint: '',
    vae: '',
    clip_skip: null,
    restore_faces: 0,
    tiling: 0,
    loras_json: '[]',
    loras: [],
    prompt_prefix: '',
    prompt_suffix: '',
    negative: '',
    sampler: 'DPM++ 2M SDE',
    scheduler: 'Karras',
    steps: 30,
    cfg: 7,
    width: 832,
    height: 1216,
    is_active: 0,
  };
}

function _updatedDraftSnapshot(snapshot, body) {
  const next = { ...snapshot };
  for (const field of LOOK_SNAPSHOT_FIELDS) {
    if (field === 'loras_json' || field === 'is_active') continue;
    if (body[field] !== undefined) next[field] = body[field];
  }
  if (body.loras !== undefined) {
    next.loras = Array.isArray(body.loras) ? body.loras : [];
    next.loras_json = JSON.stringify(next.loras);
  } else if (!Array.isArray(next.loras)) {
    next.loras = JSON.parse(next.loras_json || '[]');
  }
  return next;
}

function _lookValues(snapshot) {
  return [
    String(snapshot.name).trim(), snapshot.description ?? '', snapshot.checkpoint ?? '', snapshot.vae ?? '',
    snapshot.clip_skip === '' || snapshot.clip_skip == null ? null : parseInt(snapshot.clip_skip, 10),
    snapshot.restore_faces ? 1 : 0, snapshot.tiling ? 1 : 0,
    snapshot.loras_json ?? JSON.stringify(Array.isArray(snapshot.loras) ? snapshot.loras : []),
    snapshot.prompt_prefix ?? '', snapshot.prompt_suffix ?? '', snapshot.negative ?? '',
    snapshot.sampler || 'DPM++ 2M SDE', snapshot.scheduler || 'Karras',
    snapshot.steps === '' || snapshot.steps == null ? 30 : parseInt(snapshot.steps, 10),
    snapshot.cfg === '' || snapshot.cfg == null ? 7 : Number(snapshot.cfg),
    snapshot.width === '' || snapshot.width == null ? 832 : parseInt(snapshot.width, 10),
    snapshot.height === '' || snapshot.height == null ? 1216 : parseInt(snapshot.height, 10),
  ];
}

const LOOK_UPDATE_SQL = `
  UPDATE image_looks SET
    name = ?, description = ?, checkpoint = ?, vae = ?, clip_skip = ?,
    restore_faces = ?, tiling = ?, loras_json = ?, prompt_prefix = ?,
    prompt_suffix = ?, negative = ?, sampler = ?, scheduler = ?, steps = ?,
    cfg = ?, width = ?, height = ?
  WHERE id = ?
`;

router.get('/', function (req, res) {
  const rows = db.prepare('SELECT * FROM image_looks ORDER BY name ASC').all();
  res.json(rows.map(_clean));
});

router.get('/active', function (req, res) {
  const row = db.prepare('SELECT * FROM image_looks WHERE is_active = 1 LIMIT 1').get();
  res.json(_clean(row) || null);
});

router.post('/drafts', function (req, res) {
  const result = db.prepare(`
    INSERT INTO image_look_versions (look_id, status, snapshot_json)
    VALUES (NULL, 'draft', ?)
  `).run(JSON.stringify(_emptyLookSnapshot()));
  const row = db.prepare('SELECT * FROM image_look_versions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(_draftResponse(row));
});

router.post('/:id/drafts', function (req, res) {
  const look = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(req.params.id);
  if (!look) return res.status(404).json({ error: 'Look not found' });

  const source = db.prepare(`
    SELECT id FROM image_look_versions
    WHERE look_id = ? AND status IN ('baseline', 'activated')
    ORDER BY id DESC LIMIT 1
  `).get(look.id);
  const result = db.prepare(`
    INSERT INTO image_look_versions (look_id, status, source_version_id, snapshot_json)
    VALUES (?, 'draft', ?, ?)
  `).run(look.id, source?.id ?? null, JSON.stringify(snapshotLook(look)));
  const row = db.prepare('SELECT * FROM image_look_versions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(_draftResponse(row));
});

router.get('/drafts/:versionId', function (req, res) {
  const row = db.prepare("SELECT * FROM image_look_versions WHERE id = ? AND status = 'draft'").get(req.params.versionId);
  if (!row) return res.status(404).json({ error: 'Draft not found' });
  res.json(_draftResponse(row));
});

router.put('/drafts/:versionId', function (req, res) {
  const row = db.prepare("SELECT * FROM image_look_versions WHERE id = ? AND status = 'draft'").get(req.params.versionId);
  if (!row) return res.status(404).json({ error: 'Draft not found' });
  const body = req.body || {};
  if (body.name !== undefined && !String(body.name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const snapshot = _updatedDraftSnapshot(parseLookSnapshot(row.snapshot_json), body);
  if (snapshot.name != null) snapshot.name = String(snapshot.name).trim();
  db.prepare('UPDATE image_look_versions SET snapshot_json = ? WHERE id = ?').run(JSON.stringify(snapshot), row.id);
  const updated = db.prepare('SELECT * FROM image_look_versions WHERE id = ?').get(row.id);
  res.json(_draftResponse(updated));
});

router.delete('/drafts/:versionId', function (req, res) {
  const result = db.prepare("DELETE FROM image_look_versions WHERE id = ? AND status = 'draft'").run(req.params.versionId);
  if (!result.changes) return res.status(404).json({ error: 'Draft not found' });
  res.json({ ok: true });
});

router.post('/drafts/:versionId/activate', function (req, res) {
  const draft = db.prepare("SELECT * FROM image_look_versions WHERE id = ? AND status = 'draft'").get(req.params.versionId);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  const snapshot = parseLookSnapshot(draft.snapshot_json);
  if (!snapshot.name || !String(snapshot.name).trim()) {
    return res.status(400).json({ error: 'name is required before activation' });
  }

  let lookId = draft.look_id;
  try {
    db.exec('BEGIN IMMEDIATE');
    if (lookId) {
      const live = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(lookId);
      if (!live) throw new Error('source Look not found');
      db.prepare(`
        INSERT INTO image_look_versions (look_id, status, source_version_id, snapshot_json)
        VALUES (?, 'superseded', ?, ?)
      `).run(lookId, draft.id, JSON.stringify(snapshotLook(live)));
      db.prepare(LOOK_UPDATE_SQL).run(..._lookValues(snapshot), lookId);
    } else {
      const result = db.prepare(`
        INSERT INTO image_looks (
          name, description, checkpoint, vae, clip_skip, restore_faces, tiling, loras_json,
          prompt_prefix, prompt_suffix, negative, sampler, scheduler, steps, cfg, width, height
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(..._lookValues(snapshot));
      lookId = Number(result.lastInsertRowid);
      db.prepare('UPDATE image_look_versions SET look_id = ? WHERE id = ?').run(lookId, draft.id);
    }

    db.prepare('UPDATE image_looks SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('UPDATE image_looks SET is_active = 1 WHERE id = ?').run(lookId);
    db.prepare("UPDATE image_look_versions SET status = 'activated', activated_at = datetime('now') WHERE id = ?").run(draft.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (String(err.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'a Look with that name already exists' });
    }
    return res.status(400).json({ error: err.message });
  }

  const look = db.prepare('SELECT * FROM image_looks WHERE id = ?').get(lookId);
  broadcast.send('lookactivated', { lookId: look.id, name: look.name });
  res.json(_clean(look));
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

async function _generateDraftTest(snapshot, testSubject) {
  const master = resolveMasterConfig(db);
  const assembled = buildPrompt({
    look: snapshot,
    actionText: testSubject || '',
    masterNegative: master.master_negative || '',
    mode: 'scene',
  });
  const payload = {
    prompt: assembled.prompt,
    negative_prompt: assembled.negative,
    steps: snapshot.steps != null && snapshot.steps !== '' ? parseInt(snapshot.steps, 10) : 30,
    cfg_scale: snapshot.cfg != null && snapshot.cfg !== '' ? Number(snapshot.cfg) : 7,
    width: snapshot.width != null && snapshot.width !== '' ? parseInt(snapshot.width, 10) : 832,
    height: snapshot.height != null && snapshot.height !== '' ? parseInt(snapshot.height, 10) : 1216,
    sampler_name: snapshot.sampler || 'DPM++ 2M SDE',
    scheduler: snapshot.scheduler || 'Karras',
    restore_faces: !!snapshot.restore_faces,
    tiling: !!snapshot.tiling,
    seed: -1,
    n_iter: 1,
    batch_size: 1,
  };
  if (snapshot.checkpoint || snapshot.vae || (snapshot.clip_skip != null && snapshot.clip_skip !== '')) {
    payload.override_settings = {};
    if (snapshot.checkpoint) payload.override_settings.sd_model_checkpoint = snapshot.checkpoint;
    if (snapshot.vae) payload.override_settings.sd_vae = snapshot.vae;
    if (snapshot.clip_skip != null && snapshot.clip_skip !== '') {
      payload.override_settings.CLIP_stop_at_last_layers = parseInt(snapshot.clip_skip, 10);
    }
    payload.override_settings_restore_afterwards = true;
  }

  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  const result = await a1111.txt2img(_a1111BaseUrl(), payload, path.join(SCRATCH_DIR, filename));
  return {
    ok: true,
    filename: result.filename,
    url: `/story-images/_look-test-scratch/${result.filename}`,
    seed: result.seed,
    generation_time_ms: result.generation_time_ms,
  };
}

router.post('/drafts/:versionId/test-generate', async function (req, res) {
  const draft = db.prepare("SELECT * FROM image_look_versions WHERE id = ? AND status = 'draft'").get(req.params.versionId);
  if (!draft) return res.status(404).json({ ok: false, error: 'Draft not found' });
  try {
    res.json(await _generateDraftTest(parseLookSnapshot(draft.snapshot_json), req.body?.test_subject));
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/test-generate', async function (req, res) {
  const b = req.body || {};
  try {
    const snapshot = _updatedDraftSnapshot(_emptyLookSnapshot(), b);
    res.json(await _generateDraftTest(snapshot, b.test_subject));
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
