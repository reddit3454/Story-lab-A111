import { Router } from 'express';
import db from '../db.js';
import { resolveMasterConfig } from '../services/config-resolver.js';
import * as a1111 from '../services/a1111.js';

const router = Router();

function _getUrl() {
  const config = resolveMasterConfig(db);
  return config.a1111_url || 'http://127.0.0.1:7860';
}

router.get('/models', async function (req, res) {
  try {
    const models = await a1111.getModels(_getUrl());
    res.json(models);
  } catch (err) {
    res.status(502).json({ error: 'A1111 unreachable: ' + err.message });
  }
});

router.get('/loras', async function (req, res) {
  try {
    const loras = await a1111.getLoras(_getUrl());
    res.json(loras);
  } catch (err) {
    res.status(502).json({ error: 'A1111 unreachable: ' + err.message });
  }
});

router.get('/samplers', async function (req, res) {
  try {
    const samplers = await a1111.getSamplers(_getUrl());
    res.json(samplers);
  } catch (err) {
    res.status(502).json({ error: 'A1111 unreachable: ' + err.message });
  }
});

router.get('/schedulers', async function (req, res) {
  try {
    const schedulers = await a1111.getSchedulers(_getUrl());
    res.json(schedulers);
  } catch (err) {
    res.status(502).json({ error: 'A1111 unreachable: ' + err.message });
  }
});

router.get('/status', async function (req, res) {
  try {
    const progress = await a1111.getProgress(_getUrl());
    res.json(progress);
  } catch (err) {
    res.status(502).json({ error: 'A1111 unreachable: ' + err.message });
  }
});

router.post('/model', async function (req, res) {
  const { model_name } = req.body;
  if (!model_name) return res.status(400).json({ error: 'model_name is required' });

  try {
    await a1111.setModel(_getUrl(), model_name);
    // Persist the chosen model in global_config
    db.prepare('INSERT OR REPLACE INTO global_config (key, value) VALUES (?, ?)').run(
      'a1111_model', model_name
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: 'A1111 model switch failed: ' + err.message });
  }
});

export default router;
