import { Router } from 'express';
import * as a1111 from '../services/a1111.js';
import { resolveMasterConfig } from '../services/config-resolver.js';
import db from '../db.js';

const router = Router();

function _baseUrl() {
  const config = resolveMasterConfig(db);
  return config.a1111_url || 'http://127.0.0.1:7860';
}

router.get('/status', async function (req, res) {
  const health = await a1111.checkHealth(_baseUrl());
  res.json(health);
});

router.get('/models', async function (req, res) {
  try {
    const models = await a1111.getModels(_baseUrl());
    res.json({ ok: true, models });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/loras', async function (req, res) {
  try {
    const loras = await a1111.getLoras(_baseUrl());
    res.json({ ok: true, loras });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/vaes', async function (req, res) {
  try {
    const vaes = await a1111.getVaes(_baseUrl());
    res.json({ ok: true, vaes });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/samplers', async function (req, res) {
  try {
    const samplers = await a1111.getSamplers(_baseUrl());
    res.json({ ok: true, samplers });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/schedulers', async function (req, res) {
  try {
    const schedulers = await a1111.getSchedulers(_baseUrl());
    res.json({ ok: true, schedulers });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/model', async function (req, res) {
  const { model_name } = req.body || {};
  if (!model_name) return res.status(400).json({ error: 'model_name is required' });
  try {
    await a1111.setModel(_baseUrl(), model_name);
    db.prepare("INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES ('a1111_checkpoint', ?, datetime('now'))")
      .run(model_name);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

export default router;
