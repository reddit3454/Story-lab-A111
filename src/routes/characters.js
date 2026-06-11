import { Router } from 'express';
import db from '../db.js';

const router = Router({ mergeParams: true });

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM characters WHERE scenario_id = ?').all(req.params.scenarioId));
});

router.post('/', function (req, res) {
  const { name, role, appearance_prompt, base_clothing, current_clothing, personality, is_user } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(`
    INSERT INTO characters
      (scenario_id, name, role, appearance_prompt, base_clothing, current_clothing, personality, is_user)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.scenarioId, name,
    role              ?? 'character',
    appearance_prompt ?? '',
    base_clothing     ?? '',
    current_clothing  ?? '',
    personality       ?? '',
    is_user           ? 1 : 0,
  );

  res.status(201).json(db.prepare('SELECT * FROM characters WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:id', function (req, res) {
  const row = db.prepare('SELECT * FROM characters WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  res.json(row);
});

router.put('/:id', function (req, res) {
  const { name, role, appearance_prompt, base_clothing, current_clothing, personality } = req.body;

  db.prepare(`
    UPDATE characters SET
      name              = COALESCE(?, name),
      role              = COALESCE(?, role),
      appearance_prompt = COALESCE(?, appearance_prompt),
      base_clothing     = COALESCE(?, base_clothing),
      current_clothing  = COALESCE(?, current_clothing),
      personality       = COALESCE(?, personality)
    WHERE id = ? AND scenario_id = ?
  `).run(
    name              ?? null,
    role              ?? null,
    appearance_prompt ?? null,
    base_clothing     ?? null,
    current_clothing  ?? null,
    personality       ?? null,
    req.params.id, req.params.scenarioId,
  );

  const row = db.prepare('SELECT * FROM characters WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  res.json(row);
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM characters WHERE id = ? AND scenario_id = ?').run(req.params.id, req.params.scenarioId);
  res.json({ ok: true });
});

router.patch('/:id/clothing', function (req, res) {
  const { current_clothing } = req.body;
  db.prepare('UPDATE characters SET current_clothing = ? WHERE id = ? AND scenario_id = ?')
    .run(current_clothing ?? '', req.params.id, req.params.scenarioId);
  const row = db.prepare('SELECT * FROM characters WHERE id = ? AND scenario_id = ?').get(req.params.id, req.params.scenarioId);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  res.json(row);
});

export default router;
