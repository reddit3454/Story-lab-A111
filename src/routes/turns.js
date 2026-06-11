import { Router } from 'express';
import db from '../db.js';
import * as narrator from '../services/narrator.js';
import * as memory from '../services/memory.js';
import broadcast from '../broadcast.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  const { scenarioId } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;

  let rows;
  if (limit) {
    // Fetch last N turns, then sort ASC for chronological order
    rows = db.prepare(`
      SELECT * FROM (
        SELECT * FROM turns WHERE scenario_id = ? ORDER BY turn_number DESC LIMIT ?
      ) ORDER BY turn_number ASC
    `).all(scenarioId, limit);
  } else {
    rows = db.prepare('SELECT * FROM turns WHERE scenario_id = ? ORDER BY turn_number ASC').all(scenarioId);
  }
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
    // Next turn number
    const maxRow = db.prepare('SELECT MAX(turn_number) as m FROM turns WHERE scenario_id = ?').get(scenarioId);
    const nextTurn = (maxRow?.m || 0) + 1;

    // Insert user turn
    const userIns = db.prepare(`
      INSERT INTO turns (scenario_id, turn_number, role, content_text, location_id)
      VALUES (?, ?, 'user', ?, ?)
    `).run(scenarioId, nextTurn, content_text, location_id ?? null);
    const userTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(userIns.lastInsertRowid);

    // Load recent turns for context window (include user turn so we filter it out below)
    const contextLimit = (scenario.context_turns || 20) + 1;
    const recentRows = db.prepare(`
      SELECT * FROM turns WHERE scenario_id = ? ORDER BY turn_number DESC LIMIT ?
    `).all(scenarioId, contextLimit);

    // Build Ollama messages: history (oldest first) then current user message
    const history = recentRows
      .filter(function (t) { return t.id !== userTurn.id; })
      .reverse();

    const messages = history.map(function (t) {
      return { role: t.role === 'user' ? 'user' : 'assistant', content: t.content_text };
    });
    messages.push({ role: 'user', content: content_text });

    // Call narrator
    let result;
    try {
      result = await narrator.runNarratorTurn({ db, scenario, messages, turnNumber: nextTurn + 1 });
    } catch (err) {
      return res.status(500).json({ error: 'Narrator failed: ' + err.message });
    }

    const narratorTurnNum = nextTurn + 1;
    const narratorIns = db.prepare(`
      INSERT INTO turns (scenario_id, turn_number, role, content_text, scene_card_json, token_estimate)
      VALUES (?, ?, 'narrator', ?, ?, ?)
    `).run(
      scenarioId,
      narratorTurnNum,
      result.story_text,
      JSON.stringify(result.scene_card),
      result.token_estimate,
    );
    const narratorTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(narratorIns.lastInsertRowid);

    // Fire memory generation async if threshold reached
    if (memory.shouldGenerateMemory(narratorTurnNum)) {
      const allTurns = db.prepare('SELECT * FROM turns WHERE scenario_id = ? ORDER BY turn_number ASC').all(scenarioId);
      memory.generateMemory({ db, scenarioId, turns: allTurns, config: {} }).catch(function (err) {
        console.error('[memory] auto-generate failed:', err.message);
      });
    }

    broadcast.send('turn_complete', { scenarioId: parseInt(scenarioId, 10), turn: narratorTurn });
    return res.json({ user_turn: userTurn, narrator_turn: narratorTurn });
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
