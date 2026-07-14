import { Router } from 'express';
import db from '../db.js';
import * as narrator from '../services/narrator.js';
import * as memory from '../services/memory.js';
import broadcast from '../broadcast.js';
import { applyNarratorSummaryOnly } from '../services/scene-prompt-enricher.js';
import { resolveMasterConfig } from '../services/config-resolver.js';
import { applyClothingChanges, resolveScenarioClothingMap } from '../services/clothing.js';
import { extractVisualBrief } from '../services/visual-brief.js';
import { processEmotionalUpdateAfterTurn } from '../services/character-state.js';
import { saveSceneSummary, getSummaryHistory } from '../services/scene-summary.js';
import { regenerateTagsFromPlain } from '../services/regenerate-tags.js';

function _resolveLocationForTags(db, turn, scenarioId) {
  const scenario = db.prepare('SELECT active_location_id FROM scenarios WHERE id = ?').get(scenarioId);
  const locId = turn?.location_id || scenario?.active_location_id || null;
  if (!locId) return null;
  return db.prepare('SELECT * FROM locations WHERE id = ?').get(locId) || null;
}

const router = Router({ mergeParams: true });
const _activeTurns = new Map();
const TURN_LOCK_STALE_MS = 130000; // slightly above Ollama timeout

function _lockKey(scenarioId) {
  return String(scenarioId);
}

function _acquireTurnLock(scenarioId) {
  const key = _lockKey(scenarioId);
  const existing = _activeTurns.get(key);
  if (existing && (Date.now() - existing) < TURN_LOCK_STALE_MS) {
    return false;
  }
  if (existing) _activeTurns.delete(key);
  _activeTurns.set(key, Date.now());
  return true;
}

function _releaseTurnLock(scenarioId) {
  _activeTurns.delete(_lockKey(scenarioId));
}

router.get('/', function (req, res) {
  const { scenarioId } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;

  let rows;
  if (limit) {
    rows = db.prepare(`
      SELECT * FROM (
        SELECT * FROM turns WHERE scenario_id = ? ORDER BY turn_number DESC LIMIT ?
      ) ORDER BY turn_number ASC
    `).all(scenarioId, limit);
  } else {
    rows = db.prepare('SELECT * FROM turns WHERE scenario_id = ? ORDER BY turn_number ASC').all(scenarioId);
  }

  const getLatestImage = db.prepare(`
    SELECT id, filename, prompt_used, user_rating, accepted
    FROM scene_images WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1
  `);

  rows = rows.map(function (turn) {
    const img = getLatestImage.get(turn.id);
    if (img) {
      return Object.assign({}, turn, {
        image_id:            img.id,
        image_filename:      img.filename,
        image_visual_prompt: img.prompt_used,
        user_rating:         img.user_rating,
        image_accepted:      img.accepted,
      });
    }
    return turn;
  });

  res.json(rows);
});

router.post('/', async function (req, res) {
  const { scenarioId } = req.params;
  const { role, content_text, location_id } = req.body;

  if (!role || !content_text) {
    return res.status(400).json({ error: 'role and content_text are required' });
  }

  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  if (role === 'user') {
    if (!_acquireTurnLock(scenarioId)) {
      return res.status(409).json({ error: 'Turn already in progress for this scenario' });
    }
    try {
      // (a) Next turn number
      const maxRow = db.prepare('SELECT MAX(turn_number) as m FROM turns WHERE scenario_id = ?').get(scenarioId);
      const nextTurn = (maxRow?.m || 0) + 1;

      // Load recent turns for context window (user turn not yet in DB)
      const contextLimit = (scenario.context_turns || 20) + 1;
      const recentRows = db.prepare(`
        SELECT * FROM turns WHERE scenario_id = ? ORDER BY turn_number DESC LIMIT ?
      `).all(scenarioId, contextLimit);

      // Build Ollama messages: history (oldest first) then current user message
      const history = recentRows.reverse();

      const messages = history.map(function (t) {
        return { role: t.role === 'user' ? 'user' : 'assistant', content: t.content_text };
      });
      messages.push({ role: 'user', content: content_text });

      // (b) Call narrator async
      let result;
      try {
        result = await narrator.runNarratorTurn({ db, scenario, messages, turnNumber: nextTurn + 1 });
      } catch (err) {
        return res.status(500).json({ error: 'Narrator failed: ' + err.message });
      }

      const narratorTurnNum = nextTurn + 1;

      // (c) Atomic: insert user turn + narrator turn
      let userIns, narratorIns;
      db.exec('BEGIN');
      try {
        userIns = db.prepare(`
          INSERT INTO turns (scenario_id, turn_number, role, content_text, location_id)
          VALUES (?, ?, 'user', ?, ?)
        `).run(scenarioId, nextTurn, content_text, location_id ?? null);

        narratorIns = db.prepare(`
          INSERT INTO turns (scenario_id, turn_number, role, content_text, scene_card_json, token_estimate, location_id)
          VALUES (?, ?, 'narrator', ?, ?, ?, ?)
        `).run(
          scenarioId,
          narratorTurnNum,
          result.story_text,
          JSON.stringify(result.scene_card),
          result.token_estimate,
          scenario.active_location_id ?? null,
        );
        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }

      const userTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(userIns.lastInsertRowid);
      const narratorTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(narratorIns.lastInsertRowid);

      // Apply clothing changes declared in scene card
      const clothingUpdates = applyClothingChanges(db, scenarioId, result.scene_card?.clothing_changes);
      if (clothingUpdates.length) {
        broadcast.send('clothingupdate', { scenarioId: parseInt(scenarioId, 10), characters: clothingUpdates });
      }

      // Fire memory generation async if threshold reached.
      // Use exchange count (floor(narratorTurnNum/2)) so the interval fires every 20
      // exchanges regardless of any pre-existing turns that create an odd offset.
      const exchangeCount = Math.floor(narratorTurnNum / 2);
      if (memory.shouldGenerateMemory(exchangeCount)) {
        const allTurns = db.prepare('SELECT * FROM turns WHERE scenario_id = ? ORDER BY turn_number ASC').all(scenarioId);
        memory.generateMemory({ db, scenarioId, turns: allTurns, config: resolveMasterConfig(db) }).catch(function (err) {
          console.error('[memory] auto-generate failed:', err.message);
        });
      }

      const enrichedCard = applyNarratorSummaryOnly({ sceneCard: result.scene_card });

      // Visual brief extraction (job change: structured visual state, not prose summary).
      // Runs after clothing application so clothingMap reflects this turn's resolved outfits.
      // Stored on turns.scene_card_json.visual_brief — primary SoT for image generation.
      // image_prompt remains legacy fallback only. Failures must not fail the turn.
      try {
        const config = resolveMasterConfig(db);
        const extractModel = (config.picker_model || config.prompt_extractor_model || config.narrator_model || '').trim();
        if (extractModel && result.story_text) {
          const castForBrief = db.prepare(`
            SELECT c.id, c.name, c.role FROM characters c
            JOIN scenario_characters sc ON c.id = sc.character_id
            WHERE sc.scenario_id = ?
            ORDER BY c.name
          `).all(scenarioId);
          const clothingMap = resolveScenarioClothingMap(scenarioId, castForBrief);
          const locId = scenario.active_location_id ?? null;
          const locationRow = locId
            ? db.prepare('SELECT * FROM locations WHERE id = ?').get(locId)
            : null;
          const visualBrief = await extractVisualBrief({
            storyText: result.story_text,
            cast: castForBrief,
            clothingMap,
            location: locationRow,
            model: extractModel,
            nsfwEnabled: config.nsfw_enabled === true,
          });
          if (visualBrief) enrichedCard.visual_brief = visualBrief;
        }
      } catch (vbErr) {
        console.error('[turns] visual brief extract failed:', vbErr.message);
      }

      db.prepare('UPDATE turns SET scene_card_json = ? WHERE id = ?')
        .run(JSON.stringify(enrichedCard), narratorIns.lastInsertRowid);

      const finalNarratorTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(narratorIns.lastInsertRowid);
      broadcast.send('turn_complete', { scenarioId: parseInt(scenarioId, 10), turn: finalNarratorTurn, clothing_updates: clothingUpdates });

      const castChars = db.prepare('SELECT c.* FROM characters c JOIN scenario_characters sc ON c.id = sc.character_id WHERE sc.scenario_id = ?').all(scenarioId);
      processEmotionalUpdateAfterTurn({
        scenarioId: parseInt(scenarioId, 10),
        narratorTurn: finalNarratorTurn,
        characters: castChars,
        config: resolveMasterConfig(db),
      }).then(function (moodUpdates) {
        if (moodUpdates.length) {
          broadcast.send('moodupdate', { scenarioId: parseInt(scenarioId, 10), characters: moodUpdates });
        }
      }).catch(function (err) {
        console.error('[turns] emotional update failed:', err.message);
      });

      return res.json({ user_turn: userTurn, narrator_turn: finalNarratorTurn, clothing_updates: clothingUpdates });
    } finally {
      _releaseTurnLock(scenarioId);
    }
  }

  // Manual turn injection (any other role)
  const maxRow = db.prepare('SELECT MAX(turn_number) as m FROM turns WHERE scenario_id = ?').get(scenarioId);
  const nextTurn = (maxRow?.m || 0) + 1;

  const ins = db.prepare(`
    INSERT INTO turns (scenario_id, turn_number, role, content_text, location_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(scenarioId, nextTurn, role, content_text, location_id ?? null);
  const turn = db.prepare('SELECT * FROM turns WHERE id = ?').get(ins.lastInsertRowid);

  res.status(201).json({ turn });
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM turns WHERE id = ? AND scenario_id = ?').run(req.params.id, req.params.scenarioId);
  res.json({ ok: true });
});


router.patch('/:turnId/scene-summary', function (req, res) {
  const { scenarioId, turnId } = req.params;
  const { summary_plain, summary_tags, reset } = req.body || {};

  try {
    const result = saveSceneSummary(db, {
      scenarioId: parseInt(scenarioId, 10),
      turnId:     parseInt(turnId, 10),
      summary_plain,
      summary_tags,
      reset:      reset === true,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, scene_card: result.scene_card });
  } catch (err) {
    console.error('[turns] scene-summary save failed:', err.message);
    res.status(500).json({ error: 'Failed to save summary: ' + err.message });
  }
});

router.post('/:turnId/regenerate-tags', async function (req, res) {
  const { scenarioId, turnId } = req.params;
  const { summary_plain } = req.body || {};
  try {
    const turn = db.prepare('SELECT * FROM turns WHERE id = ? AND scenario_id = ?').get(parseInt(turnId, 10), scenarioId);
    if (!turn) return res.status(404).json({ error: 'Turn not found' });
    if (turn.role !== 'narrator') return res.status(400).json({ error: 'Tags can only be regenerated on narrator turns' });
    let plain = (summary_plain || '').trim();
    if (!plain) {
      try {
        const card = JSON.parse(turn.scene_card_json || '{}');
        plain = (card.summary_plain || card.image_prompt || '').trim();
      } catch (_) {}
    }
    const chars = db.prepare('SELECT c.* FROM characters c JOIN scenario_characters sc ON c.id = sc.character_id WHERE sc.scenario_id = ?').all(scenarioId);
    const location = _resolveLocationForTags(db, turn, scenarioId);
    const result = await regenerateTagsFromPlain(db, { plainText: plain, characters: chars, location });
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    res.json({ ok: true, tags: result.tags, turn_id: parseInt(turnId, 10) });
  } catch (err) {
    console.error('[turns] regenerate-tags failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:turnId/summary-history', function (req, res) {
  const { scenarioId, turnId } = req.params;
  try {
    const result = getSummaryHistory(db, parseInt(scenarioId, 10), parseInt(turnId, 10));
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json({ events: result.events });
  } catch (err) {
    console.error('[turns] summary-history failed:', err.message);
    res.status(500).json({ error: 'Failed to load summary history: ' + err.message });
  }
});

export default router;
