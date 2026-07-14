import { Router } from 'express';
import db from '../db.js';
import * as pipeline from '../services/image-pipeline.js';
import { buildPromptPreview } from '../services/prompt-preview.js';
import { promoteExemplarsFromRating } from '../services/exemplar-promotion.js';

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


router.post('/prompt-preview', async function (req, res) {
  const { scenarioId } = req.params;
  const { turn_id, target, characterId } = req.body || {};
  try {
    const result = await buildPromptPreview(db, {
      scenarioId: parseInt(scenarioId, 10),
      turnId: turn_id ? parseInt(turn_id, 10) : null,
      target: target || 'scene',
      characterId: characterId ? parseInt(characterId, 10) : null,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[images] prompt-preview failed:', err.message);
    res.status(500).json({ error: err.message });
  }
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
    'SELECT * FROM scene_images WHERE id = ? AND scenario_id = ?'
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


router.patch('/:id/ratings', function (req, res) {
  const { rating_skipped, content_rating, style_rating } = req.body || {};
  const row = db.prepare(
    `SELECT id, turn_id, summary_plain_snapshot, summary_tags_snapshot, style_context_snapshot
     FROM scene_images WHERE id = ? AND scenario_id = ?`
  ).get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Image not found' });

  if (rating_skipped) {
    db.prepare(
      'UPDATE scene_images SET rating_skipped = 1, content_rating = NULL, style_rating = NULL WHERE id = ?'
    ).run(req.params.id);
    return res.json({ ok: true, skipped: true });
  }

  const c = content_rating != null ? parseInt(content_rating, 10) : null;
  const s = style_rating != null ? parseInt(style_rating, 10) : null;
  if (c != null && (c < 1 || c > 5)) return res.status(400).json({ error: 'content_rating must be 1-5' });
  if (s != null && (s < 1 || s > 5)) return res.status(400).json({ error: 'style_rating must be 1-5' });

  db.prepare(
    "UPDATE scene_images SET content_rating = ?, style_rating = ?, rating_skipped = 0, user_rating = ?, summary_rated_at = datetime('now') WHERE id = ?"
  ).run(c, s, c, req.params.id);

  let plain = row.summary_plain_snapshot || '';
  let tags = row.summary_tags_snapshot || '';
  let styleCtx = row.style_context_snapshot || '';
  // Fallback for pre-fix images: derive from turn scene card
  if ((!plain || !tags) && row.turn_id) {
    const turn = db.prepare('SELECT scene_card_json FROM turns WHERE id = ?').get(row.turn_id);
    if (turn?.scene_card_json) {
      try {
        const card = JSON.parse(turn.scene_card_json);
        if (!plain) plain = (card.summary_plain || card.image_prompt || '').trim();
        if (!tags) tags = (card.summary_tags || plain || '').trim();
      } catch (_) {}
    }
  }

  const promotion = promoteExemplarsFromRating(db, {
    scenarioId: parseInt(req.params.scenarioId, 10),
    turnId: row.turn_id ?? null,
    imageId: parseInt(req.params.id, 10),
    contentRating: c,
    styleRating: s,
    summaryPlainSnapshot: plain,
    summaryTagsSnapshot: tags,
    styleContextSnapshot: styleCtx,
  });
  res.json({ ok: true, promotion });
});

export default router;
