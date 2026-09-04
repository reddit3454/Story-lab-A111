import { Router } from 'express';
import { getPoseLibrary, getPosePreviewPath } from '../services/pose-library.js';

const router = Router();

router.get('/', function (req, res) {
  try {
    res.json({ ok: true, poses: getPoseLibrary() });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.get('/:poseId/preview', function (req, res) {
  try {
    res.sendFile(getPosePreviewPath(req.params.poseId));
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

export default router;
