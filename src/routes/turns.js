import { Router } from 'express';
import db from '../db.js';
import * as narrator from '../services/narrator.js';
import * as memory from '../services/memory.js';
import broadcast from '../broadcast.js';
import { extractImagePrompt } from '../services/prompt-extractor.js';
import { resolveMasterConfig } from '../services/config-resolver.js';
import { applyClothingChanges } from '../services/clothing.js';

const router = Router({ mergeParams: true });
const _activeTurns = new Map();

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
    if (_activeTurns.has(scenarioId)) {
      return res.status(409).json({ error: 'Turn already in progress for this scenario' });
    }
    _activeTurns.set(scenarioId, true);
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

      // Extract image prompt via dedicated model
      try {
        const characters = db.prepare(`
          SELECT c.* FROM characters c
          JOIN scenario_characters sc ON c.id = sc.character_id
          WHERE sc.scenario_id = ?
        `).all(scenarioId);
        const config = resolveMasterConfig(db);
        const extractedPrompt = await extractImagePrompt({
          storyText: result.story_text,
          characters,
          config,
        });
        if (extractedPrompt) {
          const updatedCard = Object.assign({}, result.scene_card, { image_prompt: extractedPrompt });
          db.prepare('UPDATE turns SET scene_card_json = ? WHERE id = ?')
            .run(JSON.stringify(updatedCard), narratorIns.lastInsertRowid);
          result.scene_card.image_prompt = extractedPrompt;
        }
      } catch (err) {
        console.error('[prompt-extractor] non-fatal:', err.message);
      }

      // Apply clothing changes declared in scene card
      applyClothingChanges(db, scenarioId, result.scene_card?.clothing_changes);

      // Fire memory generation async if threshold reached
      if (memory.shouldGenerateMemory(narratorTurnNum)) {
        const allTurns = db.prepare('SELECT * FROM turns WHERE scenario_id = ? ORDER BY turn_number ASC').all(scenarioId);
        memory.generateMemory({ db, scenarioId, turns: allTurns, config: resolveMasterConfig(db) }).catch(function (err) {
          console.error('[memory] auto-generate failed:', err.message);
        });
      }

      const finalNarratorTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(narratorIns.lastInsertRowid);
      broadcast.send('turn_complete', { scenarioId: parseInt(scenarioId, 10), turn: finalNarratorTurn });
      return res.json({ user_turn: userTurn, narrator_turn: finalNarratorTurn });
    } finally {
      _activeTurns.delete(scenarioId);
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

export default router;
