import { Router } from 'express';
import * as ollama from '../services/ollama.js';
import * as a1111 from '../services/a1111.js';
import { resolveMasterConfig } from '../services/config-resolver.js';
import db from '../db.js';
import { log } from '../logger.js';

const router = Router();

router.get('/', function (req, res) {
  res.json({ ok: true, ts: Date.now(), version: '0.1.0' });
});

// Manual/automated verification for the WS log panel: broadcasts one 'logline'
// event so a connected browser's debug console can be checked without reload.
router.post('/test-log', function (req, res) {
  log('debug', 'test-log', { note: 'log window smoke test' });
  res.json({ ok: true });
});

router.get('/ollama', async function (req, res) {
  const health = await ollama.checkHealth();
  if (!health.ok) {
    return res.json({ ok: false, error: health.error });
  }
  try {
    const models = await ollama.listModels();
    res.json({ ok: true, models });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/a1111', async function (req, res) {
  const config = resolveMasterConfig(db);
  const baseUrl = config.a1111_url || 'http://127.0.0.1:7860';
  const health = await a1111.checkHealth(baseUrl);
  if (!health.ok) {
    return res.json({ ok: false, error: health.error, url: baseUrl });
  }
  res.json({ ok: true, url: baseUrl });
});

export default router;
