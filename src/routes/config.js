import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', function (req, res) {
  const rows = db.prepare('SELECT key, value FROM global_config').all();
  const config = {};
  for (const r of rows) config[r.key] = r.value;
  res.json(config);
});

router.post('/', function (req, res) {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value are required' });
  }
  db.prepare(
    "INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  ).run(key, String(value));
  res.json({ ok: true });
});

router.post('/batch', function (req, res) {
  const { configs } = req.body;
  if (!Array.isArray(configs) || configs.length === 0) {
    return res.status(400).json({ error: 'configs must be a non-empty array' });
  }
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  );
  db.exec('BEGIN');
  try {
    for (const c of configs) stmt.run(c.key, String(c.value ?? ''));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true, count: configs.length });
});

export default router;
