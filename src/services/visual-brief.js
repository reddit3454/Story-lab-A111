/**
 * Per-turn visual state extractor for image generation.
 * Job change: NOT a prose summarizer. Produces structured visual_brief JSON
 * stored on turns.scene_card_json.visual_brief — primary SoT for scene/character images.
 * narrator image_prompt remains legacy fallback only.
 */
import { chat } from './ollama.js';
import { log, logError } from '../logger.js';

export const VISUAL_BRIEF_SYSTEM = [
  'You extract structured camera-visible state for image generation.',
  'Do NOT write story summaries or narrative prose paragraphs.',
  'Return ONLY JSON matching the schema.',
  'Identify one main_subject (prefer a named cast character).',
  'Include character_briefs ONLY for characters who are visible, directly involved, or contextually relevant — do NOT force every cast member in.',
  'Each brief must be short and practical (pose + action + attention), e.g. "sitting on the couch, surprised, looking at Jake".',
  'Use only camera-visible facts from the turn text and provided clothing/location context.',
].join(' ');

export function buildVisualBriefJsonSchema() {
  return {
    type: 'object',
    properties: {
      main_subject: { type: 'string' },
      moment_summary: { type: 'string' },
      setting_brief: { type: 'string' },
      shot_hint: { type: ['string', 'null'] },
      character_briefs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            character_name: { type: 'string' },
            character_id: { type: ['number', 'null'] },
            role: { type: 'string' },
            visible: { type: 'boolean' },
            brief: { type: 'string' },
            expression: { type: ['string', 'null'] },
            attention: { type: ['string', 'null'] },
          },
          required: ['character_name', 'role', 'visible', 'brief'],
          additionalProperties: false,
        },
      },
    },
    required: ['main_subject', 'moment_summary', 'setting_brief', 'character_briefs'],
    additionalProperties: false,
  };
}

function _cleanStr(v) {
  return String(v || '').trim();
}

export function attachCharacterIds(brief, cast = []) {
  if (!brief || typeof brief !== 'object') return brief;
  const byName = new Map();
  for (const c of cast || []) {
    const name = _cleanStr(c.name).toLowerCase();
    if (name) byName.set(name, Number(c.id));
  }
  const briefs = Array.isArray(brief.character_briefs) ? brief.character_briefs : [];
  brief.character_briefs = briefs.map((b) => {
    const name = _cleanStr(b.character_name);
    let id = b.character_id != null && Number.isFinite(Number(b.character_id))
      ? Number(b.character_id)
      : null;
    if (id == null && name) {
      const resolved = byName.get(name.toLowerCase());
      if (resolved != null) id = resolved;
    }
    return { ...b, character_name: name, character_id: id };
  });
  return brief;
}

export function normalizeVisualBrief(raw, cast = []) {
  if (!raw || typeof raw !== 'object') return null;
  const main_subject = _cleanStr(raw.main_subject);
  const moment_summary = _cleanStr(raw.moment_summary);
  const setting_brief = _cleanStr(raw.setting_brief);
  if (!main_subject || !moment_summary || !setting_brief) return null;

  const shot_hint = raw.shot_hint == null || raw.shot_hint === ''
    ? null
    : _cleanStr(raw.shot_hint);

  let character_briefs = Array.isArray(raw.character_briefs) ? raw.character_briefs : [];
  character_briefs = character_briefs
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      const character_name = _cleanStr(b.character_name);
      const brief = _cleanStr(b.brief);
      if (!character_name || !brief) return null;
      return {
        character_name,
        character_id: b.character_id != null && Number.isFinite(Number(b.character_id))
          ? Number(b.character_id)
          : null,
        role: _cleanStr(b.role) || 'support',
        visible: b.visible !== false,
        brief,
        expression: b.expression == null || b.expression === '' ? null : _cleanStr(b.expression),
        attention: b.attention == null || b.attention === '' ? null : _cleanStr(b.attention),
      };
    })
    .filter(Boolean);

  return attachCharacterIds({
    main_subject,
    moment_summary,
    setting_brief,
    shot_hint,
    character_briefs,
  }, cast);
}

export function parseVisualBriefResponse(rawText, cast = []) {
  if (!rawText || typeof rawText !== 'string') return null;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return normalizeVisualBrief(JSON.parse(cleaned), cast);
  } catch (_) {
    return null;
  }
}

export function loadVisualBriefFromCard(sceneCard) {
  if (!sceneCard || typeof sceneCard !== 'object') return null;
  return normalizeVisualBrief(sceneCard.visual_brief, []);
}

/**
 * Compatibility shape for older enhancer/pipeline fields.
 * Not a second SoT — derived from visual_brief.
 */
export function visualBriefToLegacyMoment(brief) {
  if (!brief) return null;
  const mainBrief = (brief.character_briefs || []).find(
    (b) => _cleanStr(b.character_name).toLowerCase() === _cleanStr(brief.main_subject).toLowerCase()
      || b.role === 'main',
  );
  return {
    mainSubject: brief.main_subject,
    visibleAction: (mainBrief && mainBrief.brief) || brief.moment_summary,
    setting: brief.setting_brief,
    shotType: brief.shot_hint || null,
    summary: brief.moment_summary,
    imageabilityScore: 8,
    penaltyReason: null,
    // NSFW fields left null — narrator scene card remains authoritative for those
    bodyPosition: null,
    explicitAct: null,
    nudityState: null,
    clothingState: null,
    visual_brief: brief,
  };
}

export function composeSceneDescriptionFromBrief(brief, { legacyImagePrompt = null } = {}) {
  if (!brief) return '';
  const support = (brief.character_briefs || [])
    .filter((b) => _cleanStr(b.character_name).toLowerCase() !== _cleanStr(brief.main_subject).toLowerCase())
    .map((b) => `${b.character_name}: ${b.brief}`)
    .join('; ');
  const mainEntry = (brief.character_briefs || []).find(
    (b) => _cleanStr(b.character_name).toLowerCase() === _cleanStr(brief.main_subject).toLowerCase(),
  );
  const parts = [
    brief.moment_summary,
    mainEntry ? `${brief.main_subject}: ${mainEntry.brief}` : null,
    support || null,
    brief.setting_brief,
    brief.shot_hint ? `${brief.shot_hint} shot` : null,
  ];
  // Do not prefer legacy image_prompt when brief exists
  void legacyImagePrompt;
  return parts.filter(Boolean).join(', ');
}

/**
 * Resolve selected character brief: current-turn -> prior turns -> null (caller does generic).
 * turnsNewestFirst: array of { scene_card_json or scene_card / visual_brief already parsed }
 */
export function resolveCharacterBriefFromTurns({ characterId, characterName, turnsNewestFirst = [] }) {
  const id = characterId != null ? Number(characterId) : null;
  const name = _cleanStr(characterName).toLowerCase();

  for (const turn of turnsNewestFirst) {
    let card = turn?.scene_card || null;
    if (!card && turn?.scene_card_json) {
      try { card = typeof turn.scene_card_json === 'string' ? JSON.parse(turn.scene_card_json) : turn.scene_card_json; }
      catch (_) { card = null; }
    }
    const brief = loadVisualBriefFromCard(card) || normalizeVisualBrief(card?.visual_brief, []);
    if (!brief) continue;
    const entries = brief.character_briefs || [];
    const hit = entries.find((b) => {
      if (id != null && b.character_id != null && Number(b.character_id) === id) return true;
      if (name && _cleanStr(b.character_name).toLowerCase() === name) return true;
      return false;
    });
    if (hit) {
      return { entry: hit, brief, turn };
    }
  }
  return null;
}

export function composeCharacterActionFromBrief(entry, { settingBrief = '', shotHint = null } = {}) {
  if (!entry) return '';
  const bits = [
    entry.brief,
    entry.expression ? `expression: ${entry.expression}` : null,
    entry.attention ? `looking ${entry.attention}` : null,
    settingBrief || null,
    shotHint ? `${shotHint} shot` : null,
  ];
  return bits.filter(Boolean).join(', ');
}

export function composeGenericCharacterAction({ location = null } = {}) {
  const locTags = location?.image_tags || '';
  const locName = (location?.name || '').toLowerCase();
  let poseFallback = 'full body, standing, candid mid-action, natural pose';
  if (locName.includes('bed') || locName.includes('room')) poseFallback = 'full body, lying on bed, candid relaxed pose';
  else if (locName.includes('bath')) poseFallback = 'full body, standing in bathroom, candid natural pose';
  else if (locName.includes('car')) poseFallback = 'full body, sitting in car seat, candid, looking out window';
  else if (locName.includes('beach')) poseFallback = 'full body, standing on beach, candid, looking at horizon';
  else if (locName.includes('park') || locName.includes('outdoor')) poseFallback = 'full body, sitting on park bench, candid, natural pose';
  return [poseFallback, locTags].filter(Boolean).join(', ');
}

function _buildUserPrompt({ storyText, cast, clothingMap, location, nsfwEnabled }) {
  const lines = [
    'Extract a visual_brief for THIS turn only.',
    '',
    'Cast (only include a character if visible/involved/relevant):',
  ];
  for (const c of cast || []) {
    const clothing = clothingMap && clothingMap[c.id] != null
      ? clothingMap[c.id]
      : (c.current_clothing || c._scenario_clothing || '');
    lines.push(`- ${c.name} (id:${c.id})${clothing ? ` wearing: ${clothing}` : ''}`);
  }
  if (location) {
    lines.push('');
    lines.push(`Location: ${location.name || ''}`);
    const tags = location.image_tags_day || location.image_tags || location.image_tags_night || '';
    if (tags) lines.push(`Location tags: ${tags}`);
    const desc = location.description || location.short_desc || '';
    if (desc) lines.push(`Location visual: ${desc}`);
  }
  lines.push('');
  lines.push('Turn text:');
  lines.push(String(storyText || '').trim());
  lines.push('');
  if (nsfwEnabled) {
    lines.push('Adult content may be present; describe visible nudity/acts factually in briefs when shown.');
  }
  lines.push('Return the visual_brief JSON object now.');
  return lines.join('\n');
}

/**
 * Extract structured visual brief via Ollama chat + format schema.
 * Never throws — returns null on failure.
 */
export async function extractVisualBrief({
  storyText,
  cast = [],
  clothingMap = {},
  location = null,
  model,
  nsfwEnabled = false,
} = {}) {
  const modelName = _cleanStr(model);
  if (!modelName || !_cleanStr(storyText)) return null;

  try {
    const res = await chat({
      model: modelName,
      messages: [
        { role: 'system', content: VISUAL_BRIEF_SYSTEM },
        { role: 'user', content: _buildUserPrompt({ storyText, cast, clothingMap, location, nsfwEnabled }) },
      ],
      format: buildVisualBriefJsonSchema(),
      options: { temperature: 0.1, top_p: 0.9, num_predict: 700 },
    });
    const raw = (res?.message?.content || '').trim();
    const brief = parseVisualBriefResponse(raw, cast);
    if (brief) log('visual-brief', 'extracted', { main_subject: brief.main_subject, n: brief.character_briefs.length });
    else log('visual-brief', 'parse_null', { raw_len: raw.length });
    return brief;
  } catch (err) {
    logError('visual-brief', 'extract_failed', err);
    return null;
  }
}
