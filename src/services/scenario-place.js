// Pure resolver for a scenario's active "place" — either a linked location
// card (scenarios.active_location_id) or a free-text place the user typed
// (scenarios.active_place_text). The card always wins when both are present;
// the two are kept mutually exclusive by the scenarios PUT route.
//
// Consumers: narrator.js (narrator context block) and image-pipeline.js
// (txt2img location text + optional img2img background). No DB or network here.

/**
 * @param {object}      opts
 * @param {object}      opts.scenario  scenario row (needs active_location_id, active_place_text)
 * @param {object|null} opts.location  the resolved locations row, or null
 * @returns {{name:string, description:string, full_desc:string,
 *            background_image_path:string|null, source:'card'|'text'} | null}
 */
export function resolveScenarioPlace({ scenario, location } = {}) {
  if (location) {
    return {
      name: location.name || '',
      description: location.description || location.short_desc || '',
      full_desc: location.full_desc || '',
      background_image_path: location.background_image_path || null,
      source: 'card',
    };
  }

  const text = String(scenario?.active_place_text || '').trim();
  if (text) {
    return {
      name: text,
      description: text,
      full_desc: '',
      background_image_path: null,
      source: 'text',
    };
  }

  return null;
}
