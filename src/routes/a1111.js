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
  // checkHealth also returns the raw /options body for the image pipeline's
  // reuse — the status endpoint only needs the reachability flag.
  res.json({ ok: health.ok, error: health.error });
});

// Lightweight render-progress probe for the Play image sidebar's "Generating N%".
router.get('/progress', async function (req, res) {
  res.json(await a1111.getProgressSafe(_baseUrl()));
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

router.get('/controlnet/faceid-options', async function (req, res) {
  try {
    const options = await a1111.getVerifiedFaceIdOptions(_baseUrl());
    res.json({ ok: true, options });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/controlnet/pose-options', async function (req, res) {
  try {
    const options = await a1111.getVerifiedPoseOptions(_baseUrl());
    res.json({ ok: true, options });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.put('/controlnet/pose-config', async function (req, res) {
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const module = typeof req.body?.module === 'string' ? req.body.module.trim() : '';
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  );

  if (!model) {
    db.exec('BEGIN');
    try {
      stmt.run('a1111_pose_model', '');
      stmt.run('a1111_pose_module', '');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return res.json({ ok: true, config: { model: '', module: '' } });
  }

  try {
    const options = await a1111.getVerifiedPoseOptions(_baseUrl());
    const selected = options.find(function (option) {
      return option.model === model && option.module === module;
    });
    if (!selected) {
      return res.status(400).json({
        ok: false,
        error: 'Choose a verified pose option from the current A1111 ControlNet catalog.',
      });
    }
    db.exec('BEGIN');
    try {
      stmt.run('a1111_pose_model', selected.model);
      stmt.run('a1111_pose_module', selected.module);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true, config: { model: selected.model, module: selected.module } });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.put('/controlnet/faceid-config', async function (req, res) {
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const module = typeof req.body?.module === 'string' ? req.body.module.trim() : '';

  if (!model) {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    );
    db.exec('BEGIN');
    try {
      stmt.run('a1111_faceid_model', '');
      stmt.run('a1111_faceid_module', '');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return res.json({ ok: true, config: { model: '', module: '' } });
  }

  try {
    const options = await a1111.getVerifiedFaceIdOptions(_baseUrl());
    const selected = options.find(function (option) {
      return option.model === model && option.module === module;
    });
    if (!selected) {
      return res.status(400).json({
        ok: false,
        error: 'Choose a verified FaceID option from the current A1111 ControlNet catalog.',
      });
    }

    const stmt = db.prepare(
      "INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    );
    db.exec('BEGIN');
    try {
      stmt.run('a1111_faceid_model', selected.model);
      stmt.run('a1111_faceid_module', selected.module);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true, config: { model: selected.model, module: selected.module } });
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
