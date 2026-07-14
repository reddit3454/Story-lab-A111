import { Router } from 'express';
import * as ollama from '../services/ollama.js';
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


router.post('/free-vram', async function (_req, res) {
  const results = { a1111: null, ollama: [], comfyui: null };

  try {
    const urlRow = db.prepare('SELECT value FROM global_config WHERE key = ?').get('a1111_url');
    const a1111Url = (urlRow?.value || 'http://127.0.0.1:7860').replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(`${a1111Url}/sdapi/v1/unload-checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      results.a1111 = r.ok ? 'freed' : `http ${r.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    results.a1111 = `error: ${err.message}`;
  }

  // Story-Lab-A1111 itself never generates via ComfyUI (dropped entirely — see
  // "Files NOT Carried Over from story-lab" in the master knowledge doc). This call
  // targets the hub-wide shared ComfyUI headless server on port 8002 (used by other hub
  // projects — imagecore, video-ltx23, etc.) that may be running on the same GPU/machine
  // as this project's A1111 instance. Kept intentionally: on a single-user, single-GPU
  // dev box, "free VRAM" is reasonably expected to free the whole GPU, not just
  // whichever service this particular project happens to own. Failing silently (caught
  // below) is correct if that server isn't running.
  try {
    const r = await fetch('http://127.0.0.1:8002/free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(8000),
    });
    results.comfyui = r.ok ? 'freed' : `http ${r.status}`;
  } catch (err) {
    results.comfyui = `error: ${err.message}`;
  }

  try {
    const psRes = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(4000) });
    if (psRes.ok) {
      const ps = await psRes.json();
      const running = (ps.models || []).map(m => m.name || m.model).filter(Boolean);
      for (const modelName of running) {
        try {
          await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName, keep_alive: 0 }),
            signal: AbortSignal.timeout(6000),
          });
          results.ollama.push({ model: modelName, status: 'unloaded' });
        } catch (err) {
          results.ollama.push({ model: modelName, status: `error: ${err.message}` });
        }
      }
      if (!running.length) results.ollama.push({ model: 'none', status: 'nothing loaded' });
    } else {
      results.ollama.push({ model: 'all', status: `ps returned http ${psRes.status}` });
    }
  } catch (err) {
    results.ollama.push({ model: 'all', status: `error: ${err.message}` });
  }

  res.json({ ok: true, freed: results });
});

export default router;
