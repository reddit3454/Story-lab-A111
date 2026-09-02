import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { IMAGES_DIR } from '../paths.js';
import { generate } from '../services/image-pipeline.js';

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
  const { turnId = null, mode = 'scene', actionText, characterIds = null } = req.body || {};

  try {
    const result = await generate({
      scenarioId: parseInt(scenarioId, 10),
      turnId: turnId ? parseInt(turnId, 10) : null,
      mode,
      actionText,
      characterIds: Array.isArray(characterIds) ? characterIds.map(Number) : null,
    });
    res.json(result);
  } catch (err) {
    // A1111 offline, bad config, ControlNet failure, etc. — clean error, no
    // partial DB row was ever written (image-pipeline only inserts after a
    // verified successful generation).
    res.status(502).json({ ok: false, error: err.message });
  }
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
