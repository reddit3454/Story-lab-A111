import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM scenarios ORDER BY updated_at DESC').all());
});

router.post('/', function (req, res) {
  const { title, description, system_prompt, nsfw_enabled, narrator_model, context_turns } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const result = db.prepare(`
    INSERT INTO scenarios (title, description, system_prompt, nsfw_enabled, narrator_model, context_turns)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    title,
    description    ?? '',
    system_prompt  ?? '',
    nsfw_enabled   ? 1 : 0,
    narrator_model ?? '',
    context_turns  ?? 20,
  );

  res.status(201).json(db.prepare('SELECT * FROM scenarios WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:id', function (req, res) {
  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  const characters   = db.prepare('SELECT * FROM characters WHERE scenario_id = ?').all(req.params.id);
  const locations    = db.prepare('SELECT * FROM locations WHERE scenario_id = ?').all(req.params.id);
  const rules        = db.prepare('SELECT * FROM rules WHERE scenario_id = ? ORDER BY priority DESC').all(req.params.id);
  const world_entries = db.prepare('SELECT * FROM world_entries WHERE scenario_id = ?').all(req.params.id);

  res.json({ scenario, characters, locations, rules, world_entries });
});

router.put('/:id', function (req, res) {
  const { title, description, system_prompt, nsfw_enabled, narrator_model, context_turns, status } = req.body;

  db.prepare(`
    UPDATE scenarios SET
      title          = COALESCE(?, title),
      description    = COALESCE(?, description),
      system_prompt  = COALESCE(?, system_prompt),
      nsfw_enabled   = COALESCE(?, nsfw_enabled),
      narrator_model = COALESCE(?, narrator_model),
      context_turns  = COALESCE(?, context_turns),
      status         = COALESCE(?, status),
      updated_at     = datetime('now')
    WHERE id = ?
  `).run(
    title          ?? null,
    description    ?? null,
    system_prompt  ?? null,
    nsfw_enabled   != null ? (nsfw_enabled ? 1 : 0) : null,
    narrator_model ?? null,
    context_turns  ?? null,
    status         ?? null,
    req.params.id,
  );

  const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Scenario not found' });
  res.json(row);
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM scenarios WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
