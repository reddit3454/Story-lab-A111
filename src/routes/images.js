import { Router } from 'express';
import db from '../db.js';
import * as pipeline from '../services/image-pipeline.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  const { scenarioId } = req.params;
  const { turn_id } = req.query;

  let rows;
  if (turn_id) {
    rows = db.prepare(
      'SELECT * FROM scene_images WHERE scenario_id = ? AND turn_id = ? ORDER BY created_at DESC'
    ).all(scenarioId, turn_id);
  } else {
    rows = db.prepare(
      'SELECT * FROM scene_images WHERE scenario_id = ? ORDER BY created_at DESC'
    ).all(scenarioId);
  }
  res.json(rows);
});

router.post('/generate', async function (req, res) {
  const { scenarioId } = req.params;
  const { turn_id, mode = 'scene', characterId, directPrompt, rawPrompt } = req.body;

  pipeline.generate({
    mode,
    scenarioId:  parseInt(scenarioId, 10),
    turnId:      turn_id     ? parseInt(turn_id, 10)     : null,
    characterId: characterId ? parseInt(characterId, 10) : null,
    opts:        { directPrompt: !!directPrompt, rawPrompt: rawPrompt || '' },
  }).catch(function (err) {
    console.error('[images] generate failed:', err.message);
  });

  res.json({ ok: true, queued: true });
});

router.put('/:id/accept', function (req, res) {
  const row = db.prepare(
    'SELECT id FROM scene_images WHERE id = ? AND scenario_id = ?'
  ).get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Image not found' });

  db.prepare('UPDATE scene_images SET accepted = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/:id/rate', function (req, res) {
  const { rating } = req.body;
  if (rating == null) return res.status(400).json({ error: 'rating is required' });

  db.prepare(
    'UPDATE scene_images SET user_rating = ? WHERE id = ? AND scenario_id = ?'
  ).run(rating, req.params.id, req.params.scenarioId);
  res.json({ ok: true });
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM scene_images WHERE id = ? AND scenario_id = ?').run(
    req.params.id, req.params.scenarioId
  );
  res.json({ ok: true });
});

export default router;
