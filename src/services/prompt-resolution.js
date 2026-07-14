// Pure prompt-resolution helpers shared between image-pipeline.js and prompt-preview.js.
// No DB or network access — callers pass in already-resolved data.

/**
 * Returns a copy of `character` with current_clothing/base_clothing set to the
 * resolved scenario clothing string. Does not mutate the input.
 */
export function applyResolvedClothing(character, clothing) {
  const resolved = String(clothing || '').trim();
  return { ...character, current_clothing: resolved, base_clothing: resolved };
}

/**
 * Picks which character's reference image should be used for FaceID/IP-Adapter.
 * - character mode: always the character actually being generated (matches the prompt builder).
 * - scene mode: matches a cast member's name against `mainSubject` — scene-picker's real
 *   `pickBestMoment()` output field (`scene-picker.js`'s `baseSchema.mainSubject`, actually
 *   requested from and returned by the picker LLM call in image-pipeline.js Stage 2a).
 *   Falls back to the first non-player cast member (by name) when `mainSubject` is absent
 *   (picker skipped/failed/no recent turns) or names no cast member — a documented,
 *   deterministic limitation for multi-NPC scenes with no picker match; see
 *   master-knowledge doc. Does NOT read `sceneCard.characters_present` — nothing in the
 *   codebase ever writes that field (narrator and scene-picker schemas both omit it), so
 *   relying on it always silently reproduced the alphabetical-first-NPC bug.
 */
export function resolvePrimaryCharacterForReference({ mode, resolvedChar, characters, mainSubject }) {
  if (mode === 'character' && resolvedChar) return resolvedChar;

  const npcs = (characters || []).filter(c => c.role !== 'player');

  const subjectText = String(mainSubject || '').trim().toLowerCase();
  if (subjectText) {
    const match = npcs.find(c => {
      const name = String(c.name || '').trim().toLowerCase();
      return name && subjectText.includes(name);
    });
    if (match) return match;
  }

  return npcs[0] || (characters && characters[0]) || null;
}
