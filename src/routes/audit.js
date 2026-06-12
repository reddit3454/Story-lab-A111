import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', function (req, res) {
  const { scenario_id, service, level, limit = 100 } = req.query;

  let sql = 'SELECT * FROM audit_events WHERE 1=1';
  const params = [];

  if (scenario_id) {
    sql += ' AND scenario_id = ?';
    params.push(scenario_id);
  }
  if (service) {
    sql += ' AND service = ?';
    params.push(service);
  }
  if (level) {
    sql += ' AND level = ?';
    params.push(level);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.min(parseInt(limit, 10) || 100, 500));

  res.json(db.prepare(sql).all(...params));
});

router.get('/:runId', function (req, res) {
  const rows = db.prepare(
    'SELECT * FROM audit_events WHERE pipeline_run_id = ? ORDER BY id ASC'
  ).all(req.params.runId);
  res.json(rows);
});

export default router;
