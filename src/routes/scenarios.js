import { Router } from 'express';
import db from '../db.js';

const router = Router();

const SCENARIO_FIELDS = [
  'title', 'description', 'system_prompt', 'nsfw_enabled',
  'narrator_model', 'context_turns', 'status',
  'tone', 'premise', 'setting', 'default_start',
  'reply_length', 'lust_level', 'explicitness_level',
  'pacing', 'narrative_pov', 'violence_level', 'tone_modifier',
  'narrator_presence_enabled', 'narrator_presence_mode', 'narrator_presence_config',
  'active_location_id', 'user_character_id', 'ended_at', 'generation_config',
];

const BOOL_FIELDS = new Set(['nsfw_enabled', 'narrator_presence_enabled']);

const _getChars = db.prepare(`
  SELECT c.id, c.name, c.reference_image_path FROM characters c
  JOIN scenario_characters sc ON c.id = sc.character_id
  WHERE sc.scenario_id = ?
  ORDER BY c.name
`);

router.get('/', function (req, res) {
  const scenarios = db.prepare(`
    SELECT s.*,
      COUNT(DISTINCT sc.character_id) AS character_count,
      MAX(t.created_at) AS last_turn_at
    FROM scenarios s
    LEFT JOIN scenario_characters sc ON sc.scenario_id = s.id
    LEFT JOIN turns t ON t.scenario_id = s.id
    GROUP BY s.id
    ORDER BY s.updated_at DESC
  `).all();

  const enriched = scenarios.map(function (s) {
    return Object.assign({}, s, { characters: _getChars.all(s.id) });
  });

  res.json(enriched);
});

router.post('/', function (req, res) {
  const b = req.body;
  if (!b.title) return res.status(400).json({ error: 'title is required' });

  const result = db.prepare(`
    INSERT INTO scenarios (
      title, description, system_prompt, nsfw_enabled, narrator_model, context_turns,
      tone, premise, setting, default_start,
      reply_length, lust_level, explicitness_level, pacing, narrative_pov,
      violence_level, tone_modifier,
      narrator_presence_enabled, narrator_presence_mode, narrator_presence_config,
      active_location_id, user_character_id, generation_config
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?
    )
  `).run(
    b.title,
    b.description            ?? '',
    b.system_prompt          ?? '',
    b.nsfw_enabled           ? 1 : 0,
    b.narrator_model         ?? '',
    b.context_turns          ?? 20,
    b.tone                   ?? 'Dramatic',
    b.premise                ?? '',
    b.setting                ?? '',
    b.default_start          ?? '',
    b.reply_length           ?? 'medium',
    b.lust_level             ?? 3,
    b.explicitness_level     ?? 'moderate',
    b.pacing                 ?? 'normal',
    b.narrative_pov          ?? 'third',
    b.violence_level         ?? 'mild',
    b.tone_modifier          ?? '',
    b.narrator_presence_enabled ? 1 : 0,
    b.narrator_presence_mode   ?? 'all',
    b.narrator_presence_config ?? null,
    b.active_location_id       ?? null,
    b.user_character_id        ?? null,
    b.generation_config        ?? null,
  );

  res.status(201).json(db.prepare('SELECT * FROM scenarios WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:id', function (req, res) {
  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  const characters = db.prepare(`
    SELECT c.* FROM characters c
    JOIN scenario_characters sc ON c.id = sc.character_id
    WHERE sc.scenario_id = ?
    ORDER BY c.name
  `).all(req.params.id);
  const locations    = db.prepare(`
    SELECT l.* FROM locations l
    JOIN scenario_locations sl ON l.id = sl.location_id
    WHERE sl.scenario_id = ?
    ORDER BY l.name ASC
  `).all(req.params.id);
  const rules        = db.prepare('SELECT * FROM rules WHERE scenario_id = ? ORDER BY priority DESC').all(req.params.id);
  const world_entries = db.prepare('SELECT * FROM world_entries WHERE scenario_id = ?').all(req.params.id);

  res.json({ scenario, characters, locations, rules, world_entries });
});

router.put('/:id', function (req, res) {
  const b = req.body;

  const sets = [];
  const vals = [];

  for (const field of SCENARIO_FIELDS) {
    if (!(field in b)) continue;
    sets.push(`${field} = ?`);
    vals.push(BOOL_FIELDS.has(field) ? (b[field] ? 1 : 0) : (b[field] ?? null));
  }

  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    vals.push(req.params.id);
    db.prepare(`UPDATE scenarios SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Scenario not found' });
  res.json(row);
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM scenarios WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/:id/scene-card', function (req, res) {
  const turn = db.prepare(
    `SELECT id, turn_number, scene_card_json FROM turns
     WHERE scenario_id = ? AND role = 'narrator' AND scene_card_json IS NOT NULL
     ORDER BY turn_number DESC LIMIT 1`
  ).get(req.params.id);
  if (!turn) return res.json({ found: false, message: 'No narrator turns with scene cards yet' });
  let parsed = null;
  try { parsed = JSON.parse(turn.scene_card_json); } catch (e) { parsed = { parse_error: e.message, raw: turn.scene_card_json }; }
  res.json({ found: true, turn_id: turn.id, turn_number: turn.turn_number, scene_card: parsed });
});

router.post('/:id/reset-scene', function (req, res) {
  db.prepare('DELETE FROM scene_images WHERE scenario_id = ?').run(req.params.id);
  db.prepare('DELETE FROM turns WHERE scenario_id = ?').run(req.params.id);
  db.prepare("UPDATE scenarios SET active_location_id = NULL, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
