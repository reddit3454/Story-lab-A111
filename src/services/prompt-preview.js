import { resolveMasterConfig } from './config-resolver.js';
import { loadSceneCard } from './scene-summary.js';
import { extractCharacterPlainSummary, extractCharacterImagePrompt } from './prompt-extractor.js';
import { getScenarioClothing } from './clothing.js';
import { applyResolvedClothing } from './prompt-resolution.js';
import {
  loadVisualBriefFromCard,
  resolveCharacterBriefFromTurns,
  composeCharacterActionFromBrief,
  composeGenericCharacterAction,
} from './visual-brief.js';

const _getTurn = db => db.prepare('SELECT * FROM turns WHERE id = ? AND scenario_id = ?');
const _getLatestNarrator = db => db.prepare(
  "SELECT * FROM turns WHERE scenario_id = ? AND role = 'narrator' ORDER BY turn_number DESC LIMIT 1"
);
const _getNarratorTurnsNewest = db => db.prepare(
  "SELECT id, content_text, scene_card_json, role, turn_number FROM turns WHERE scenario_id = ? AND role = 'narrator' ORDER BY turn_number DESC LIMIT 40"
);
const _getScenario = db => db.prepare('SELECT * FROM scenarios WHERE id = ?');
const _getLocation = db => db.prepare('SELECT * FROM locations WHERE id = ?');
const _getChars = db => db.prepare(`
  SELECT c.* FROM characters c
  JOIN scenario_characters sc ON c.id = sc.character_id
  WHERE sc.scenario_id = ?
  ORDER BY c.name
`);

function _resolveLocation(db, { turn, scenario }) {
  const locId = turn?.location_id || scenario?.active_location_id || null;
  if (!locId) return null;
  return _getLocation(db).get(locId) || null;
}

function _sceneSummaryFromCard(card) {
  const brief = loadVisualBriefFromCard(card);
  if (brief?.moment_summary) {
    // visual_brief is SoT for image-oriented scene preview
    const support = (brief.character_briefs || [])
      .map((b) => `${b.character_name}: ${b.brief}`)
      .join('; ');
    const plain = [brief.moment_summary, support, brief.setting_brief, brief.shot_hint]
      .filter(Boolean).join('. ');
    return { plain, tags: '' };
  }
  // Legacy fallback only
  let plain = (card.summary_plain || '').trim();
  let tags = (card.summary_tags || '').trim();
  if (!plain && card.image_prompt) plain = String(card.image_prompt).trim();
  if (plain && tags === plain) tags = '';
  return { plain, tags };
}

function _lockedAppearance(char) {
  const bits = [
    char.appearance_prompt,
    char.gender,
    char.body_type,
    [char.hair_color, char.hair_style].filter(Boolean).join(' ') + (char.hair_color || char.hair_style ? ' hair' : ''),
    char.eye_color ? char.eye_color + ' eyes' : '',
    char.skin_tone ? char.skin_tone + ' skin' : '',
  ].map((s) => String(s || '').trim()).filter(Boolean);
  return bits.join(', ');
}

export async function buildPromptPreview(db, { scenarioId, turnId, target, characterId }) {
  let turn = null;
  if (turnId) turn = _getTurn(db).get(turnId, scenarioId);
  if (!turn) turn = _getLatestNarrator(db).get(scenarioId);
  if (!turn) {
    return { summary_plain: '', summary_tags: '', turn_id: null, target: target || 'scene' };
  }

  const card = loadSceneCard(turn.scene_card_json);
  const config = resolveMasterConfig(db);
  const chars = _getChars(db).all(scenarioId);
  const scenario = _getScenario(db).get(scenarioId);
  const location = _resolveLocation(db, { turn, scenario });

  if (!target || target === 'scene') {
    const { plain, tags } = _sceneSummaryFromCard(card);
    return {
      summary_plain: plain,
      summary_tags: tags,
      turn_id: turn.id,
      target: 'scene',
      visual_brief: card.visual_brief || null,
      main_subject: card.visual_brief?.main_subject || null,
    };
  }

  const rawChar = chars.find(c => Number(c.id) === Number(characterId));
  if (!rawChar) return { error: 'Character not found', status: 404 };
  const char = applyResolvedClothing(rawChar, getScenarioClothing(scenarioId, rawChar.id));

  const turnsNewestFirst = _getNarratorTurnsNewest(db).all(scenarioId);
  // Ensure focal turn first
  const ordered = turn.role === 'narrator'
    ? [turn, ...turnsNewestFirst.filter((r) => r.id !== turn.id)]
    : turnsNewestFirst;

  const resolved = resolveCharacterBriefFromTurns({
    characterId: char.id,
    characterName: char.name,
    turnsNewestFirst: ordered,
  });

  const appearance = _lockedAppearance(char);
  const clothing = char.current_clothing || getScenarioClothing(scenarioId, char.id) || '';
  const locBit = location
    ? [location.name, location.image_tags || location.image_tags_day || ''].filter(Boolean).join(', ')
    : '';

  let plain = '';
  let tags = '';
  let source = 'generic';

  if (resolved?.entry) {
    // Plain English Summary = selected character_brief (camera-visible state only).
    // Do NOT dump locked appearance / whole-scene moment_summary into the plain field.
    source = 'visual_brief';
    plain = composeCharacterActionFromBrief(resolved.entry, {
      // keep plain focused on the character's visual/action state; setting/shot go in tags
      settingBrief: '',
      shotHint: null,
    });
    // Image Prompt Tags = image-prompt-ready assembly
    tags = [
      'solo',
      'full body',
      'candid',
      appearance,
      clothing,
      resolved.entry.brief,
      resolved.entry.expression,
      resolved.entry.attention ? `attention ${resolved.entry.attention}` : null,
      resolved.brief?.setting_brief || locBit,
      resolved.brief?.shot_hint ? `${resolved.brief.shot_hint} shot` : null,
    ].filter(Boolean).join(', ');
  } else {
    // generic fallback: never mentioned — simple pose, not a scene re-summary
    source = 'generic';
    const action = composeGenericCharacterAction({ location });
    plain = action;
    tags = ['solo', 'full body', 'candid', appearance, clothing, action, locBit]
      .filter(Boolean).join(', ');

    // Legacy LLM extract only if generic empty and model configured (migration safety)
    if (!plain.trim() && !tags.trim()) {
      const extractorModel = (config.prompt_extractor_model || config.narrator_model || '').trim();
      if (extractorModel) {
        try {
          plain = await extractCharacterPlainSummary({
            storyText: turn.content_text || '',
            character: char,
            location,
            sceneCard: card,
            config,
          });
          tags = await extractCharacterImagePrompt({
            storyText: turn.content_text || '',
            character: char,
            location,
            sceneCard: card,
            config,
          });
          source = 'legacy_extractor';
        } catch (_) {}
      }
    }
  }

  plain = (plain || '').trim();
  tags = (tags || '').trim();
  if (plain && tags === plain) tags = '';

  if (!plain && !tags) {
    return {
      error: 'Character visual brief unavailable and generic composition empty',
      status: 502,
      turn_id: turn.id,
      target: 'character',
      character_id: characterId,
    };
  }

  return {
    summary_plain: plain,
    summary_tags: tags,
    turn_id: turn.id,
    target: 'character',
    character_id: characterId,
    brief_source: source,
    character_brief: resolved?.entry || null,
  };
}
