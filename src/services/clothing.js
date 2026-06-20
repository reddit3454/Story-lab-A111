import { log } from '../logger.js';
import db from '../db.js';

const _updateClothing = db.prepare('UPDATE characters SET current_clothing = ? WHERE id = ?');

export async function resolveClothing(db, character, sceneCard) {
  const changes = sceneCard?.clothing_changes;

  if (!Array.isArray(changes) || changes.length === 0) {
    return { clothingString: character.current_clothing || '', changed: false, newState: character.current_clothing || '' };
  }

  const match = changes.find(function (ch) {
    return (ch.character_name || '').toLowerCase() === (character.name || '').toLowerCase();
  });

  if (!match || !match.new_clothing) {
    return { clothingString: character.current_clothing || '', changed: false, newState: character.current_clothing || '' };
  }

  const newState = match.new_clothing.trim();
  db.prepare('UPDATE characters SET current_clothing = ? WHERE id = ?').run(newState, character.id);
  log('clothing', 'clothing_changed', null, `${character.name}: "${character.current_clothing || ''}" → "${newState}"`);

  return { clothingString: newState, changed: true, newState };
}

// ORPHAN: not imported anywhere — safe to delete if unneeded
export async function resetClothing(db, characterId) {
  db.prepare('UPDATE characters SET current_clothing = base_clothing WHERE id = ?').run(characterId);
  const updated = db.prepare('SELECT current_clothing FROM characters WHERE id = ?').get(characterId);
  log('clothing', 'clothing_reset', null, `character ${characterId} reset to base clothing`);
  return updated?.current_clothing || '';
}

export function applyClothingChanges(db, scenarioId, clothingChanges) {
  if (!Array.isArray(clothingChanges) || !clothingChanges.length) return;
  const castRows = db.prepare(`
    SELECT c.id, c.name FROM characters c
    JOIN scenario_characters sc ON c.id = sc.character_id
    WHERE sc.scenario_id = ?
  `).all(scenarioId);
  const nameToId = {};
  for (const c of castRows) nameToId[c.name.toLowerCase()] = c.id;
  for (const change of clothingChanges) {
    const charId = change.character_id
      ?? nameToId[(change.character_name || '').toLowerCase()];
    if (charId && change.new_clothing) {
      _updateClothing.run(change.new_clothing, charId);
    }
  }
}
