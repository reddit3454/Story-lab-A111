import { Router } from 'express';
import db from '../db.js';
import { ensureScenarioCharacterState, deleteScenarioCharacterState } from '../services/character-state.js';
import {
  parseClothingSets,
  findClothingSet,
  setScenarioStartingOutfit,
  setScenarioRuntimeClothing,
  getScenarioClothing,
} from '../services/clothing.js';

const router = Router({ mergeParams: true });

function _resolveStartingFromBody(char, body = {}) {
  const sets = parseClothingSets(char.outfit_sets);
  let setName = body.clothing_set_name != null ? String(body.clothing_set_name).trim() : '';
  let description = body.initial_clothing != null ? String(body.initial_clothing).trim() : '';
  if (body.clothing != null && !description) description = String(body.clothing).trim();

  if (setName) {
    const found = findClothingSet(sets, setName);
    if (!found) {
      return { error: `Clothing set "${setName}" not found on character` };
    }
    return { setName: found.name, description: found.description };
  }

  if (description) {
    const byDesc = sets.find((s) => s.description.toLowerCase() === description.toLowerCase());
    return { setName: byDesc ? byDesc.name : null, description };
  }

  if (char.default_outfit_name) {
    const found = findClothingSet(sets, char.default_outfit_name);
    if (found) return { setName: found.name, description: found.description };
  }
  if ((char.default_outfit || '').trim()) {
    return { setName: char.default_outfit_name || null, description: String(char.default_outfit).trim() };
  }
  if (sets.length) {
    return { setName: sets[0].name, description: sets[0].description };
  }
  return { setName: null, description: (char.base_clothing || '').trim() };
}

router.get('/', function (req, res) {
  const scenarioId = parseInt(req.params.scenarioId, 10);
  const rows = db.prepare(`
    SELECT c.*,
           sc.starting_clothing,
           sc.starting_clothing_set_name,
           scs.current_clothing AS runtime_clothing
    FROM characters c
    JOIN scenario_characters sc ON c.id = sc.character_id
    LEFT JOIN scenario_character_state scs
      ON scs.scenario_id = sc.scenario_id AND scs.character_id = sc.character_id
    WHERE sc.scenario_id = ?
    ORDER BY c.name
  `).all(scenarioId);

  const out = rows.map((r) => {
    const current = (r.runtime_clothing || '').trim() || (r.starting_clothing || '').trim();
    return {
      ...r,
      outfit_sets_parsed: parseClothingSets(r.outfit_sets),
      scenario_clothing: current,
      current_clothing: current,
      base_clothing: (r.starting_clothing || '').trim(),
    };
  });
  res.json(out);
});

router.post('/:charId', function (req, res) {
  const scenarioId = parseInt(req.params.scenarioId, 10);
  const charId = parseInt(req.params.charId, 10);
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const resolved = _resolveStartingFromBody(char, req.body || {});
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  db.prepare('INSERT OR IGNORE INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)')
    .run(scenarioId, charId);

  const outfit = setScenarioStartingOutfit(scenarioId, charId, {
    setName: resolved.setName,
    description: resolved.description,
  });
  ensureScenarioCharacterState(scenarioId, charId);
  setScenarioRuntimeClothing(scenarioId, charId, outfit.current_clothing);

  res.json({
    ok: true,
    character: {
      ...char,
      starting_clothing_set_name: outfit.starting_clothing_set_name,
      starting_clothing: outfit.starting_clothing,
      current_clothing: outfit.current_clothing,
      scenario_clothing: outfit.current_clothing,
      outfit_sets_parsed: parseClothingSets(char.outfit_sets),
    },
  });
});

router.patch('/:charId/clothing', function (req, res) {
  const scenarioId = parseInt(req.params.scenarioId, 10);
  const charId = parseInt(req.params.charId, 10);
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const link = db.prepare(
    'SELECT 1 AS ok FROM scenario_characters WHERE scenario_id = ? AND character_id = ?'
  ).get(scenarioId, charId);
  if (!link) return res.status(404).json({ error: 'Character not in this scenario' });

  const body = req.body || {};
  // CF-10: runtime must be an explicit boolean. true = runtime clothing only;
  // false (or starting-outfit fields with runtime:false) = starting outfit write.
  if (!Object.prototype.hasOwnProperty.call(body, 'runtime') || typeof body.runtime !== 'boolean') {
    return res.status(400).json({
      error: 'runtime must be an explicit boolean (true=runtime clothing, false=starting outfit)',
    });
  }

  if (body.runtime === true) {
    const clothing = String(body.clothing ?? body.current_clothing ?? '').trim();
    setScenarioRuntimeClothing(scenarioId, charId, clothing);
    return res.json({
      ok: true,
      current_clothing: clothing,
      starting_clothing: db.prepare(
        'SELECT starting_clothing FROM scenario_characters WHERE scenario_id = ? AND character_id = ?'
      ).get(scenarioId, charId)?.starting_clothing || '',
    });
  }

  const resolved = _resolveStartingFromBody(char, body);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const desc = resolved.description || String(body.clothing || '').trim();
  const outfit = setScenarioStartingOutfit(scenarioId, charId, {
    setName: resolved.setName,
    description: desc,
  });
  res.json({ ok: true, ...outfit });
});

router.delete('/:charId', function (req, res) {
  const scenarioId = parseInt(req.params.scenarioId, 10);
  const charId = parseInt(req.params.charId, 10);
  db.prepare('DELETE FROM scenario_characters WHERE scenario_id = ? AND character_id = ?')
    .run(scenarioId, charId);
  deleteScenarioCharacterState(scenarioId, charId);
  res.json({ ok: true });
});

export default router;
