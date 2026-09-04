import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { IMAGES_DIR } from '../paths.js';
import { generate } from '../services/image-pipeline.js';
import { warmup } from '../services/image-warmup.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  const { scenarioId } = req.params;
  const { turnId } = req.query;
  let rows;
  if (turnId) {
    rows = db.prepare('SELECT * FROM scene_images WHERE scenario_id = ? AND turn_id = ? ORDER BY created_at DESC')
      .all(scenarioId, turnId);
  } else {
    rows = db.prepare('SELECT * FROM scene_images WHERE scenario_id = ? ORDER BY created_at DESC').all(scenarioId);
  }
  res.json(rows);
});

router.post('/generate', async function (req, res) {
  const { scenarioId } = req.params;
  const { turnId = null, mode = 'scene', actionText, characterAction = '', characterIds = null, framing = 'auto', poseId = null } = req.body || {};

  try {
    const result = await generate({
      scenarioId: parseInt(scenarioId, 10),
      turnId: turnId ? parseInt(turnId, 10) : null,
      mode,
      actionText,
      characterAction,
      characterIds: Array.isArray(characterIds) ? characterIds.map(Number) : null,
      framing,
      poseId,
    });
    res.json(result);
  } catch (err) {
    // No partial DB row is ever written (image-pipeline only inserts after a
    // verified successful generation). err.status carries the intended code:
    // 400 = bad request (unknown ids, wrong pose subject count), 409 = A1111 is
    // busy with another render; anything else is an upstream failure → 502.
    const status = err.status === 400 || err.status === 409 ? err.status : 502;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// Fire-and-forget model warm-up — loads the checkpoint + ControlNet models into
// VRAM while the user is still editing, so the real Generate is not a cold load.
// Never produces a stored image (see src/services/image-warmup.js).
router.post('/warmup', function (req, res) {
  const { scenarioId } = req.params;
  const { characterIds = null, poseId = null } = req.body || {};
  warmup({
    scenarioId: parseInt(scenarioId, 10),
    characterIds: Array.isArray(characterIds) ? characterIds.map(Number) : null,
    poseId: typeof poseId === 'string' ? poseId : null,
  });
  res.json({ ok: true, started: true });
});

router.put('/:id/accept', function (req, res) {
  const { scenarioId, id } = req.params;
  const row = db.prepare('SELECT * FROM scene_images WHERE id = ? AND scenario_id = ?').get(id, scenarioId);
  if (!row) return res.status(404).json({ error: 'Image not found' });
  db.prepare('UPDATE scene_images SET accepted = 1 WHERE id = ?').run(id);
  res.json(db.prepare('SELECT * FROM scene_images WHERE id = ?').get(id));
});

router.put('/:id/rate', function (req, res) {
  const { scenarioId, id } = req.params;
  const { rating } = req.body || {};
  const n = Number(rating);
  if (!Number.isInteger(n) || n < -1 || n > 1) {
    return res.status(400).json({ error: 'rating must be -1, 0, or 1' });
  }
  const row = db.prepare('SELECT * FROM scene_images WHERE id = ? AND scenario_id = ?').get(id, scenarioId);
  if (!row) return res.status(404).json({ error: 'Image not found' });
  db.prepare('UPDATE scene_images SET user_rating = ? WHERE id = ?').run(n, id);
  res.json(db.prepare('SELECT * FROM scene_images WHERE id = ?').get(id));
});

router.delete('/:id', function (req, res) {
  const { scenarioId, id } = req.params;
  const row = db.prepare('SELECT * FROM scene_images WHERE id = ? AND scenario_id = ?').get(id, scenarioId);
  if (!row) return res.status(404).json({ error: 'Image not found' });

  db.prepare('DELETE FROM scene_images WHERE id = ?').run(id);

  const absPath = path.join(IMAGES_DIR, String(scenarioId), row.filename);
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch (err) {
    // DB row is already gone; a failed file delete shouldn't fail the request.
    console.error('[images] failed to delete file', absPath, err.message);
  }

  res.json({ ok: true });
});

export default router;
