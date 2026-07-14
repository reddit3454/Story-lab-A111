import { log } from '../logger.js';
import db from '../db.js';

const _getCastMember = db.prepare(`
  SELECT sc.starting_clothing, sc.starting_clothing_set_name,
         c.id, c.name, c.outfit_sets, c.default_outfit, c.default_outfit_name, c.base_clothing, c.current_clothing
  FROM scenario_characters sc
  JOIN characters c ON c.id = sc.character_id
  WHERE sc.scenario_id = ? AND sc.character_id = ?
`);

const _getStateClothing = db.prepare(`
  SELECT current_clothing FROM scenario_character_state
  WHERE scenario_id = ? AND character_id = ?
`);

const _upsertStateClothing = db.prepare(`
  INSERT INTO scenario_character_state
    (scenario_id, character_id, moodcurrent, arousalcurrent, mood_momentum, arousal_momentum, current_clothing)
  VALUES (?, ?, 3, 1, 0, 0, ?)
  ON CONFLICT(scenario_id, character_id) DO UPDATE SET
    current_clothing = excluded.current_clothing,
    updated_at = datetime('now')
`);

const _updateScStarting = db.prepare(`
  UPDATE scenario_characters
  SET starting_clothing = ?, starting_clothing_set_name = ?
  WHERE scenario_id = ? AND character_id = ?
`);

/** Parse character outfit_sets JSON into [{name, description}, ...] */
export function parseClothingSets(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === 'object' && String(x.name || '').trim() && String(x.description || '').trim())
      .map((x) => ({
        name: String(x.name).trim(),
        description: String(x.description).trim(),
        underwear: !!x.underwear,
      }));
  } catch (_) {
    return [];
  }
}

export function findClothingSet(sets, setName) {
  if (!setName) return null;
  const want = String(setName).trim().toLowerCase();
  return (sets || []).find((s) => s.name.toLowerCase() === want) || null;
}

/**
 * Read order for scenario clothing (prompts + Play):
 * 1) scenario_character_state.current_clothing (runtime changes)
 * 2) scenario_characters.starting_clothing (chosen at scenario setup)
 * 3) character default outfit (default_outfit / default set description)
 * Character outfit_sets JSON is never treated as live wardrobe.
 */
export function getScenarioClothing(scenarioId, characterId) {
  const st = _getStateClothing.get(scenarioId, characterId);
  const live = (st?.current_clothing || '').trim();
  if (live) return live;
  const row = _getCastMember.get(scenarioId, characterId);
  if (!row) return '';
  const starting = (row.starting_clothing || '').trim();
  if (starting) return starting;
  if (row.default_outfit_name) {
    const found = findClothingSet(parseClothingSets(row.outfit_sets), row.default_outfit_name);
    if (found) return found.description;
  }
  return (row.default_outfit || row.base_clothing || '').trim();
}

export function setScenarioRuntimeClothing(scenarioId, characterId, clothing) {
  const value = String(clothing || '').trim();
  _upsertStateClothing.run(scenarioId, characterId, value);
  return value;
}

export function setScenarioStartingOutfit(scenarioId, characterId, { setName = null, description = '' } = {}) {
  const desc = String(description || '').trim();
  const name = setName != null ? String(setName).trim() : null;
  _updateScStarting.run(desc, name || null, scenarioId, characterId);
  // Also seed/reset runtime clothing to starting outfit
  setScenarioRuntimeClothing(scenarioId, characterId, desc);
  return { starting_clothing_set_name: name || null, starting_clothing: desc, current_clothing: desc };
}

/** Resolve clothing map for all cast members in a scenario (for prompts). */
export function resolveScenarioClothingMap(scenarioId, characters) {
  const map = {};
  for (const c of characters || []) {
    map[c.id] = getScenarioClothing(scenarioId, c.id);
  }
  return map;
}

/**
 * Apply narrator clothing_changes to scenario-scoped runtime state only.
 * Does NOT mutate characters.outfit_sets / default_outfit / current_clothing.
 */
export function applyClothingChanges(dbHandle, scenarioId, clothingChanges) {
  if (!Array.isArray(clothingChanges) || !clothingChanges.length) return [];
  const castRows = dbHandle.prepare(`
    SELECT c.id, c.name FROM characters c
    JOIN scenario_characters sc ON c.id = sc.character_id
    WHERE sc.scenario_id = ?
  `).all(scenarioId);
  const nameToId = {};
  for (const c of castRows) nameToId[c.name.toLowerCase()] = c.id;
  const updates = [];
  for (const change of clothingChanges) {
    const charId = change.character_id
      ?? nameToId[(change.character_name || '').toLowerCase()];
    if (!charId || !change.new_clothing) continue;
    const newClothing = String(change.new_clothing).trim();
    if (!newClothing) continue;
    setScenarioRuntimeClothing(scenarioId, charId, newClothing);
    log('clothing', 'scenario_clothing_changed', null,
      `scenario ${scenarioId} char ${charId} -> "${newClothing}"`);
    updates.push({ characterId: charId, current_clothing: newClothing });
  }
  return updates;
}

// Legacy helpers kept for character-card wardrobe management only
export async function resolveClothing(dbHandle, character, sceneCard) {
  // STUB: layered resolve unused — scenario runtime uses applyClothingChanges + getScenarioClothing
  return {
    clothingString: character.current_clothing || '',
    changed: false,
    newState: character.current_clothing || '',
  };
}

export async function resetClothing(dbHandle, characterId) {
  // Character-card only: restore default_outfit into legacy current_clothing field
  dbHandle.prepare(
    `UPDATE characters SET current_clothing = COALESCE(NULLIF(default_outfit,''), base_clothing, '') WHERE id = ?`
  ).run(characterId);
  const updated = dbHandle.prepare('SELECT current_clothing FROM characters WHERE id = ?').get(characterId);
  log('clothing', 'character_card_clothing_reset', null, `character ${characterId}`);
  return updated?.current_clothing || '';
}
