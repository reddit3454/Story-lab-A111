import { Router } from 'express';
import * as ollama from '../services/ollama.js';
import db from '../db.js';

const router = Router();

router.get('/', function (req, res) {
  res.json({ ok: true, ts: Date.now(), version: '0.1.0' });
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
  try {
    const urlRow = db.prepare('SELECT value FROM global_config WHERE key = ?').get('a1111_url');
    const a1111Url = (urlRow?.value || 'http://127.0.0.1:7860').replace(/\/$/, '');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      const r = await fetch(`${a1111Url}/sdapi/v1/sd-models`, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) {
        const models = await r.json();
        return res.json({ ok: true, model_count: Array.isArray(models) ? models.length : 0 });
      }
      res.json({ ok: false, error: `HTTP ${r.status}` });
    } catch (fetchErr) {
      clearTimeout(timer);
      res.json({ ok: false, error: fetchErr.message });
    }
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

export default router;
