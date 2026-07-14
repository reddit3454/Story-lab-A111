// Pure validation for the Character Editor's raw outfit-sets JSON textarea.
// No DOM access — importable from the browser view and unit-testable with node:test.

/**
 * Resolves what to save for `outfit_sets` from the raw JSON textarea plus the
 * structured-editor's in-memory state.
 * - empty/whitespace-only rawText: the structured editor is authoritative when the raw
 *   box hasn't been touched -> uses fallbackOutfitSets.
 * - non-empty rawText that fails to parse, or does not parse to an array: FAILS
 *   explicitly. Never silently falls back to fallbackOutfitSets — see CF-5.
 * - non-empty rawText that parses to an array: that array is authoritative.
 *
 * @param {string} rawText
 * @param {Array} fallbackOutfitSets
 * @returns {{ok: true, json: string} | {ok: false, error: string}}
 */
export function resolveOutfitSetsForSave(rawText, fallbackOutfitSets) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    return { ok: true, json: JSON.stringify(fallbackOutfitSets || []) };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, error: 'Outfit Sets JSON is invalid: ' + err.message };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Outfit Sets JSON must be an array of {name, description} objects.' };
  }

  return { ok: true, json: JSON.stringify(parsed) };
}
