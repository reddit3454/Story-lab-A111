import { log } from '../logger.js';

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

export async function resetClothing(db, characterId) {
  db.prepare('UPDATE characters SET current_clothing = base_clothing WHERE id = ?').run(characterId);
  const updated = db.prepare('SELECT current_clothing FROM characters WHERE id = ?').get(characterId);
  log('clothing', 'clothing_reset', null, `character ${characterId} reset to base clothing`);
  return updated?.current_clothing || '';
}
