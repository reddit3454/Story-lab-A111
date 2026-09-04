import { Router } from 'express';
import db from '../db.js';
import * as narrator from '../services/narrator.js';
import * as memory from '../services/memory.js';
import broadcast from '../broadcast.js';
import { resolveMasterConfig } from '../services/config-resolver.js';
import { applyClothingChanges, getScenarioClothing } from '../services/clothing.js';
import { applySceneStateToCharacters, listScenarioCharacterStates } from '../services/character-state.js';
import { extractSceneState } from '../services/scene-state.js';
import { buildRegenerateMessages, appendStateSnapshotToGuidance } from '../services/turn-regenerate.js';
import { resolveRelationshipsForScenario } from '../services/relationship-resolve.js';
import {
  resolveShotActionSync,
  suggestShotActionViaLlm,
  cacheShotSummaryInSceneCard,
  normalizeShotAction,
  SHOT_ACTION_PLACEHOLDER,
} from '../services/image-shot-action.js';
import { normalizeVisualDirection, parseVisualDirections } from '../services/visual-direction.js';

const router = Router({ mergeParams: true });
const _activeTurns = new Map();
const _sceneStateQueues = new Map();
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

// Extract scene state from the finished narrator prose and build the scene card.
// The narrator writes prose only; mood / arousal / clothing come from here.
// Never throws - on any failure the card falls back to neutral + carried arousal.
async function _buildSceneCardFromProse(scenarioId, storyText, config) {
  const cast = db.prepare(`
    SELECT c.id, c.name FROM characters c
    JOIN scenario_characters sc ON c.id = sc.character_id
    WHERE sc.scenario_id = ?
  `).all(scenarioId);

  const clothingByCharId = {};
  for (const c of cast) clothingByCharId[c.id] = getScenarioClothing(scenarioId, c.id);

  let carryArousal = 1;
  const priorCards = db.prepare(`
    SELECT scene_card_json FROM turns
    WHERE scenario_id = ? AND role = 'narrator'
    ORDER BY turn_number DESC
  `).all(scenarioId);
  for (const prevCard of priorCards) {
    if (!prevCard?.scene_card_json) continue;
    try {
      const p = JSON.parse(prevCard.scene_card_json);
      if (p?.scene_state_status === 'pending') continue;
      if (typeof p?.arousal_level === 'number') carryArousal = p.arousal_level;
      break;
    } catch (_) {}
  }

  let sceneState;
  try {
    sceneState = await extractSceneState({ narratorText: storyText, cast, clothingByCharId, config });
  } catch (err) {
    console.error('[turns] scene-state extract failed:', err.message);
    sceneState = { sceneMood: null, sceneArousal: null, characters: [], clothingChanges: [] };
  }

  // Cap scene arousal movement per turn so a single over-read can't spike it.
  let arousalLevel = sceneState.sceneArousal ?? carryArousal ?? 1;
  if (typeof sceneState.sceneArousal === 'number') {
    arousalLevel = Math.max(carryArousal - 3, Math.min(carryArousal + 3, sceneState.sceneArousal));
  }

  const sceneCard = {
    mood: sceneState.sceneMood || 'neutral',
    arousal_level: arousalLevel,
    clothing_changes: sceneState.clothingChanges.map((c) => ({
      character_name: c.characterName,
      new_clothing: c.newClothing,
    })),
  };
  return { sceneCard, sceneState };
}

function _pendingSceneCard(scenarioId) {
  let carryArousal = 1;
  const priorCards = db.prepare(`
    SELECT scene_card_json FROM turns
    WHERE scenario_id = ? AND role = 'narrator'
    ORDER BY turn_number DESC
  `).all(scenarioId);
  for (const row of priorCards) {
    try {
      const card = JSON.parse(row.scene_card_json || '{}');
      if (card.scene_state_status === 'pending') continue;
      if (typeof card.arousal_level === 'number') carryArousal = card.arousal_level;
      break;
    } catch (_) {}
  }
  return {
    mood: 'neutral',
    arousal_level: carryArousal,
    clothing_changes: [],
    scene_state_status: 'pending',
  };
}

// State extraction is deliberately serialized per scenario. A later narrator
// turn must not let an older extraction overwrite its clothing or mood state.
function _enqueueSceneState(scenarioId, turnId, storyText, config) {
  const key = _lockKey(scenarioId);
  const prior = _sceneStateQueues.get(key) || Promise.resolve();
  const job = prior.catch(() => {}).then(async () => {
    const { sceneCard, sceneState } = await _buildSceneCardFromProse(scenarioId, storyText, config);
    const turn = db.prepare('SELECT id FROM turns WHERE id = ? AND scenario_id = ?').get(turnId, scenarioId);
    if (!turn) return;

    sceneCard.scene_state_status = 'complete';
    db.prepare('UPDATE turns SET scene_card_json = ? WHERE id = ? AND scenario_id = ?')
      .run(JSON.stringify(sceneCard), turnId, scenarioId);

    const clothingUpdates = applyClothingChanges(db, scenarioId, sceneCard.clothing_changes);
    if (clothingUpdates.length) {
      broadcast.send('clothingupdate', { scenarioId: parseInt(scenarioId, 10), characters: clothingUpdates });
    }
    _applySceneStateAndBroadcast(scenarioId, sceneState, config);
    const finalTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(turnId);
    broadcast.send('scene_state_complete', {
      scenarioId: parseInt(scenarioId, 10), turn: finalTurn, clothing_updates: clothingUpdates,
    });
  });
  _sceneStateQueues.set(key, job);
  job.catch((err) => console.error('[turns] deferred scene-state failed:', err.message))
    .finally(() => { if (_sceneStateQueues.get(key) === job) _sceneStateQueues.delete(key); });
}

// Apply the extracted per-character mood/arousal and broadcast the change.
function _applySceneStateAndBroadcast(scenarioId, sceneState, config) {
  try {
    const res = applySceneStateToCharacters(scenarioId, sceneState.characters, config);
    if (res.characters.length || res.gates.length) {
      broadcast.send('moodupdate', {
        scenarioId: parseInt(scenarioId, 10),
        characters: res.characters,
        gates: res.gates,
      });
    }
  } catch (err) {
    console.error('[turns] applySceneStateToCharacters failed:', err.message);
  }
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

      // (b) Call narrator (prose only)
      let result;
      try {
        result = await narrator.runNarratorTurn({ db, scenario, messages, turnNumber: nextTurn + 1 });
      } catch (err) {
        return res.status(500).json({ error: 'Narrator failed: ' + err.message });
      }

      const narratorTurnNum = nextTurn + 1;

      // The narrator response is user-visible. Persist a pending card now and
      // perform the secondary state call after the response has been returned.
      const turnConfig = resolveMasterConfig(db);
      const sceneCard = _pendingSceneCard(scenarioId);

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
          JSON.stringify(sceneCard),
          result.token_estimate,
          scenario.active_location_id ?? null,
        );
        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }

      const userTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(userIns.lastInsertRowid);
      const finalNarratorTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(narratorIns.lastInsertRowid);

      const clothingUpdates = [];

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

      broadcast.send('turn_complete', { scenarioId: parseInt(scenarioId, 10), turn: finalNarratorTurn, clothing_updates: clothingUpdates });

      _enqueueSceneState(scenarioId, finalNarratorTurn.id, result.story_text, turnConfig);

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

router.post('/:turnId/regenerate', async function (req, res) {
  const { scenarioId, turnId } = req.params;
  const guidance = (req.body && (req.body.guidance || req.body.instruction || req.body.content_text)) || '';

  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  const turn = db.prepare('SELECT * FROM turns WHERE id = ? AND scenario_id = ?').get(turnId, scenarioId);
  if (!turn) return res.status(404).json({ error: 'Turn not found' });
  if (turn.role !== 'narrator') {
    return res.status(400).json({ error: 'Only narrator turns can be regenerated' });
  }

  if (!_acquireTurnLock(scenarioId)) {
    return res.status(409).json({ error: 'Turn already in progress for this scenario' });
  }

  try {
    const priorTurns = db.prepare(`
      SELECT * FROM turns
      WHERE scenario_id = ? AND turn_number < ?
      ORDER BY turn_number ASC
    `).all(scenarioId, turn.turn_number);

    let guidanceForRegen = guidance;
    const masterCfg = resolveMasterConfig(db);
    if (masterCfg.regen_state_snapshot_enabled !== false) {
      const moods = listScenarioCharacterStates(scenarioId);
      const relationships = resolveRelationshipsForScenario(db, Number(scenarioId));
      guidanceForRegen = appendStateSnapshotToGuidance(guidance, { moods, relationships });
    }

    const messages = buildRegenerateMessages(priorTurns, turn.content_text, guidanceForRegen);

    let result;
    try {
      result = await narrator.runNarratorTurn({
        db,
        scenario,
        messages,
        turnNumber: turn.turn_number,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Narrator failed: ' + err.message });
    }

    const sceneCard = _pendingSceneCard(scenarioId);

    db.prepare(`
      UPDATE turns
      SET content_text = ?, scene_card_json = ?, token_estimate = ?
      WHERE id = ? AND scenario_id = ?
    `).run(
      result.story_text,
      JSON.stringify(sceneCard),
      result.token_estimate ?? null,
      turnId,
      scenarioId,
    );

    const clothingUpdates = [];

    const finalTurn = db.prepare('SELECT * FROM turns WHERE id = ?').get(turnId);

    broadcast.send('turn_regenerated', {
      scenarioId: parseInt(scenarioId, 10),
      turn: finalTurn,
      clothing_updates: clothingUpdates,
    });

    _enqueueSceneState(scenarioId, turnId, result.story_text, masterCfg);

    return res.json({ turn: finalTurn, clothing_updates: clothingUpdates });
  } finally {
    _releaseTurnLock(scenarioId);
  }
});


router.get('/:turnId/shot-action', function (req, res) {
  const { scenarioId, turnId } = req.params;
  const turn = db.prepare('SELECT * FROM turns WHERE id = ? AND scenario_id = ?').get(turnId, scenarioId);
  if (!turn) return res.status(404).json({ error: 'Turn not found' });
  const mode = req.query.mode || 'scene';
  const characterId = Number(req.query.characterId);
  const cast = db.prepare('SELECT c.id, c.name FROM characters c JOIN scenario_characters sc ON sc.character_id = c.id WHERE sc.scenario_id = ?').all(scenarioId);
  const directions = parseVisualDirections(turn.image_direction_json, cast);
  const saved = mode === 'fullbody' ? directions.fullbody_by_character[String(characterId)] : directions.scene;
  if (mode === 'fullbody' && !saved) {
    return res.json({ text: '', source: 'empty', needs_suggest: false, placeholder: 'Describe the selected character doing something visible.', subject_ids: [], framing: 'auto' });
  }
  const resolved = saved?.action_text ? { text: saved.action_text, source: 'user_draft', needs_suggest: false } : resolveShotActionSync(turn);
  res.json({
    text: resolved.text,
    source: resolved.source,
    needs_suggest: resolved.needs_suggest,
    placeholder: SHOT_ACTION_PLACEHOLDER,
    subject_ids: mode === 'scene' ? (saved?.subject_ids || []) : [],
    framing: saved?.framing || 'auto',
  });
});

router.put('/:turnId/shot-action', function (req, res) {
  const { scenarioId, turnId } = req.params;
  const { text, mode = 'scene', subjectIds, framing, characterId } = req.body || {};
  const turn = db.prepare('SELECT * FROM turns WHERE id = ? AND scenario_id = ?').get(turnId, scenarioId);
  if (!turn) return res.status(404).json({ error: 'Turn not found' });
  if (mode !== 'scene' && mode !== 'fullbody') return res.status(400).json({ error: 'invalid mode' });
  const cast = db.prepare('SELECT c.id, c.name FROM characters c JOIN scenario_characters sc ON sc.character_id = c.id WHERE sc.scenario_id = ?').all(scenarioId);
  const normalizedDirection = normalizeVisualDirection({ text, subjectIds, framing }, cast, mode, characterId);
  if (normalizedDirection.errors.length) return res.status(400).json({ error: normalizedDirection.errors.join('; ') });
  const directions = parseVisualDirections(turn.image_direction_json, cast);
  if (mode === 'fullbody') directions.fullbody_by_character[String(Number(characterId))] = normalizedDirection.direction;
  else directions.scene = normalizedDirection.direction;
  const normalized = text != null && String(text).trim()
    ? normalizeShotAction(String(text))
    : null;
  db.prepare('UPDATE turns SET image_action_draft = ?, image_direction_json = ? WHERE id = ? AND scenario_id = ?').run(
    mode === 'scene' ? normalized : turn.image_action_draft,
    JSON.stringify(directions),
    turnId,
    scenarioId,
  );
  res.json({ text: normalizedDirection.direction.action_text, source: 'user_draft', subject_ids: normalizedDirection.direction.subject_ids || [], framing: normalizedDirection.direction.framing });
});

router.post('/:turnId/shot-action/suggest', async function (req, res) {
  const { scenarioId, turnId } = req.params;
  const turn = db.prepare('SELECT * FROM turns WHERE id = ? AND scenario_id = ?').get(turnId, scenarioId);
  if (!turn) return res.status(404).json({ error: 'Turn not found' });

  const mode = req.body?.mode === 'fullbody' ? 'fullbody' : 'scene';
  const characterId = Number(req.body?.characterId) || null;
  const focusCharacter = mode === 'fullbody' && characterId
    ? db.prepare('SELECT c.name FROM characters c JOIN scenario_characters sc ON sc.character_id = c.id WHERE sc.scenario_id = ? AND c.id = ?').get(scenarioId, characterId)?.name || null
    : null;

  // Only the scene mode can reuse a whole-turn draft/summary. Fullbody wants a
  // fresh single-character description and must not adopt the scene text.
  if (mode === 'scene') {
    const existing = resolveShotActionSync(turn);
    if (existing.text && (existing.source === 'user_draft' || existing.source === 'scene_card' || existing.source === 'cached')) {
      return res.json({ text: existing.text, source: existing.source, ok: true });
    }
  }

  const result = await suggestShotActionViaLlm({ contentText: turn.content_text, db, mode, focusCharacter });
  if (result.ok && result.text) {
    // The cached summary is a scene-level field shared by every mode — never
    // overwrite it with a single-character fullbody description.
    if (mode === 'scene') cacheShotSummaryInSceneCard(db, turnId, scenarioId, result.text);
    return res.json({ text: result.text, source: 'llm', ok: true });
  }

  const heuristic = resolveShotActionSync(turn).text || '';
  return res.json({
    text: heuristic,
    source: heuristic ? 'heuristic' : 'empty',
    ok: false,
    error: result.error || 'Could not generate scene summary',
  });
});

export default router;
