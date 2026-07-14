import { normalizeSceneCard } from '../input-parser.js';

export function loadSceneCard(json) {
  if (json == null || json === '' || json === '{}') return normalizeSceneCard({});
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    return normalizeSceneCard(parsed && typeof parsed === 'object' ? parsed : {});
  } catch (_) {
    return normalizeSceneCard({});
  }
}

function _ensureMeta(card) {
  const meta = Object.assign({
    plain_source: 'empty',
    tags_source: 'empty',
    plain_original: '',
    tags_original: '',
    locale: 'en',
  }, card._meta && typeof card._meta === 'object' ? card._meta : {});

  if (!meta.plain_original && (card.summary_plain || card.image_prompt)) {
    meta.plain_original = card.summary_plain || card.image_prompt || '';
  }
  if (!meta.tags_original && card.summary_tags) {
    meta.tags_original = card.summary_tags;
  }

  return meta;
}

export function saveSceneSummary(db, { scenarioId, turnId, summary_plain, summary_tags, reset }) {
  const turn = db.prepare('SELECT * FROM turns WHERE id = ? AND scenario_id = ?').get(turnId, scenarioId);
  if (!turn) return { error: 'Turn not found', status: 404 };
  if (turn.role !== 'narrator') {
    return { error: 'Summary editable only on narrator turns', status: 400 };
  }

  const card = loadSceneCard(turn.scene_card_json);
  const meta = _ensureMeta(card);

  const beforePlain = (card.summary_plain || '').trim();
  const beforeTags = (card.summary_tags || '').trim();
  let afterPlain = beforePlain;
  let afterTags = beforeTags;
  let plainSource = meta.plain_source || 'empty';
  let tagsSource = meta.tags_source || 'empty';

  if (reset) {
    afterPlain = (meta.plain_original || '').trim();
    afterTags = (meta.tags_original || '').trim();
    plainSource = afterPlain ? 'narrator' : 'empty';
    tagsSource = afterTags ? 'extractor' : 'empty';
  } else {
    if (typeof summary_plain === 'string') afterPlain = summary_plain.trim();
    if (typeof summary_tags === 'string') afterTags = summary_tags.trim();
    if (afterPlain !== beforePlain) plainSource = 'user';
    if (afterTags !== beforeTags) tagsSource = 'user';
  }

  card.summary_plain = afterPlain;
  card.summary_tags = afterTags;
  card.image_prompt = afterTags || afterPlain || card.image_prompt || '';
  card._meta = Object.assign({}, meta, {
    plain_source: plainSource,
    tags_source: tagsSource,
    plain_original: meta.plain_original || beforePlain || '',
    tags_original: meta.tags_original || beforeTags || '',
    last_edited_at: new Date().toISOString(),
    locale: meta.locale || 'en',
  });

  const events = [];
  if (beforePlain !== afterPlain) {
    events.push({
      field: 'plain',
      source: reset ? 'user' : (plainSource === 'user' ? 'user' : plainSource),
      value_before: beforePlain,
      value_after: afterPlain,
    });
  }
  if (beforeTags !== afterTags) {
    events.push({
      field: 'tags',
      source: reset ? 'user' : (tagsSource === 'user' ? 'user' : tagsSource),
      value_before: beforeTags,
      value_after: afterTags,
    });
  }

  const insertEvent = db.prepare(`
    INSERT INTO summary_edit_events (scenario_id, turn_id, field, source, value_before, value_after)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE turns SET scene_card_json = ? WHERE id = ?').run(JSON.stringify(card), turnId);
    for (const ev of events) {
      insertEvent.run(scenarioId, turnId, ev.field, ev.source, ev.value_before, ev.value_after);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { ok: true, scene_card: card };
}

export function getSummaryHistory(db, scenarioId, turnId) {
  const turn = db.prepare('SELECT id FROM turns WHERE id = ? AND scenario_id = ?').get(turnId, scenarioId);
  if (!turn) return { error: 'Turn not found', status: 404 };

  const events = db.prepare(`
    SELECT id, field, source, value_before, value_after, created_at
    FROM summary_edit_events
    WHERE scenario_id = ? AND turn_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(scenarioId, turnId);

  return { ok: true, events };
}
