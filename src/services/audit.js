import fs from 'fs';
import db from '../db.js';
import { AUDIT_LOG_PATH } from '../paths.js';

export function audit({
  pipeline_run_id = '',
  service,
  stage,
  status = 'info',
  message = '',
  input = null,
  output = null,
  error = null,
  duration_ms = null,
  token_estimate = null,
  scenario_id = null,
  turn_id = null,
  scene_image_id = null,
}) {
  try {
    const data_json  = JSON.stringify(input ?? null);
    const detail_json = JSON.stringify({
      output:         output ?? null,
      error:          error  ?? null,
      token_estimate: token_estimate ?? null,
    });
    const level = status === 'failed' ? 'error' : 'info';

    db.prepare(`
      INSERT INTO audit_events
        (pipeline_run_id, service, event, data_json, detail_json, level,
         scenario_id, turn_id, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pipeline_run_id,
      service,
      stage,
      data_json,
      detail_json,
      level,
      scenario_id ?? null,
      turn_id     ?? null,
      duration_ms ?? null,
    );
  } catch (err) {
    console.error('[audit] db write failed:', err.message);
  }

  try {
    const entry = {
      ts: new Date().toISOString(),
      pipeline_run_id, service, stage, status, message,
      scenario_id, turn_id, duration_ms, token_estimate,
    };
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[audit] jsonl write failed:', err.message);
  }
}
