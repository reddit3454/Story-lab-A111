import { resolveMasterConfig } from './config-resolver.js';
import { log } from '../logger.js';

function _normPlain(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function _pruneGlobal(db, table, maxRows, ratingCol) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  if (count <= maxRows) return;
  const excess = count - maxRows;
  db.prepare(`
    DELETE FROM ${table}
    WHERE id IN (
      SELECT id FROM ${table}
      ORDER BY ${ratingCol} ASC, created_at ASC
      LIMIT ?
    )
  `).run(excess);
}

function _pruneScenarioCap(db, table, scenarioId, maxPerScenario, ratingCol) {
  const count = db.prepare(
    `SELECT COUNT(*) AS c FROM ${table} WHERE source_scenario_id = ?`
  ).get(scenarioId).c;
  if (count <= maxPerScenario) return;
  const excess = count - maxPerScenario;
  db.prepare(`
    DELETE FROM ${table}
    WHERE id IN (
      SELECT id FROM ${table} WHERE source_scenario_id = ?
      ORDER BY ${ratingCol} ASC, created_at ASC
      LIMIT ?
    )
  `).run(scenarioId, excess);
}

export function getSummaryExemplarsForRegen(db, limit = 8) {
  const cfg = resolveMasterConfig(db);
  if (!cfg.summary_learning_enabled) return [];
  return db.prepare(`
    SELECT summary_plain, summary_tags, content_rating
    FROM summary_exemplars
    WHERE locale = 'en'
    ORDER BY content_rating DESC, created_at DESC
    LIMIT ?
  `).all(limit);
}

export function promoteExemplarsFromRating(db, {
  scenarioId, turnId, imageId, contentRating, styleRating,
  summaryPlainSnapshot = '', summaryTagsSnapshot = '', styleContextSnapshot = '',
}) {
  const cfg = resolveMasterConfig(db);
  if (!cfg.summary_learning_enabled) return { summary: false, style: false, reason: 'learning_disabled' };

  const contentMin = cfg.summary_content_min_for_learning ?? 4;
  const styleMin = cfg.summary_style_min_for_learning ?? 4;
  const globalMax = cfg.summary_exemplar_max ?? 50;
  const perScenarioMax = cfg.summary_exemplar_max_per_scenario ?? 10;

  let summaryPromoted = false;
  let stylePromoted = false;
  const plain = (summaryPlainSnapshot || '').trim();
  const tags = (summaryTagsSnapshot || '').trim();

  if (contentRating >= contentMin && plain && tags) {
    const existing = db.prepare('SELECT id, content_rating FROM summary_exemplars WHERE source_image_id = ?').get(imageId);
    if (existing) {
      if (contentRating >= existing.content_rating) {
        db.prepare(`UPDATE summary_exemplars SET summary_plain=?, summary_tags=?, content_rating=?, source_scenario_id=?, source_turn_id=?, created_at=datetime('now') WHERE id=?`)
          .run(plain, tags, contentRating, scenarioId, turnId, existing.id);
        summaryPromoted = true;
      }
    } else {
      const dup = db.prepare('SELECT id, content_rating FROM summary_exemplars WHERE lower(trim(summary_plain)) = ?').get(_normPlain(plain));
      if (!dup || contentRating > dup.content_rating) {
        if (dup) db.prepare('DELETE FROM summary_exemplars WHERE id = ?').run(dup.id);
        _pruneScenarioCap(db, 'summary_exemplars', scenarioId, perScenarioMax, 'content_rating');
        db.prepare(`INSERT INTO summary_exemplars (summary_plain, summary_tags, content_rating, source_scenario_id, source_turn_id, source_image_id, locale) VALUES (?,?,?,?,?,?,'en')`)
          .run(plain, tags, contentRating, scenarioId, turnId, imageId);
        _pruneGlobal(db, 'summary_exemplars', globalMax, 'content_rating');
        summaryPromoted = true;
      }
    }
  }

  if (styleRating >= styleMin && styleContextSnapshot) {
    const existing = db.prepare('SELECT id, style_rating FROM style_exemplars WHERE source_image_id = ?').get(imageId);
    if (existing) {
      if (styleRating >= existing.style_rating) {
        db.prepare(`UPDATE style_exemplars SET style_context_snapshot=?, content_tags_snapshot=?, style_rating=?, content_rating=?, source_scenario_id=?, created_at=datetime('now') WHERE id=?`)
          .run(styleContextSnapshot, tags, styleRating, contentRating, scenarioId, existing.id);
        stylePromoted = true;
      }
    } else {
      _pruneScenarioCap(db, 'style_exemplars', scenarioId, perScenarioMax, 'style_rating');
      db.prepare(`INSERT INTO style_exemplars (style_context_snapshot, content_tags_snapshot, style_rating, content_rating, source_scenario_id, source_image_id, locale) VALUES (?,?,?,?,?,?,'en')`)
        .run(styleContextSnapshot, tags, styleRating, contentRating, scenarioId, imageId);
      _pruneGlobal(db, 'style_exemplars', globalMax, 'style_rating');
      stylePromoted = true;
    }
  }

  return { summary: summaryPromoted, style: stylePromoted };
}

export function userOwnsTags(db, turnId) {
  const turn = db.prepare('SELECT scene_card_json FROM turns WHERE id = ?').get(turnId);
  if (!turn) return false;
  let card = {};
  try { card = JSON.parse(turn.scene_card_json || '{}'); } catch (_) {}
  const meta = card._meta || {};
  if (meta.tags_source === 'user' || meta.tags_source === 'regenerate_tags') return true;
  const ev = db.prepare(`SELECT id FROM summary_edit_events WHERE turn_id = ? AND field = 'tags' AND source IN ('user','regenerate_tags') LIMIT 1`).get(turnId);
  return !!ev;
}
