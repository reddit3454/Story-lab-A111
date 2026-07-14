import { Router } from 'express';
import db from '../db.js';
const router = Router();
router.get('/exemplars/summary', function (_req, res) {
  res.json({ exemplars: db.prepare('SELECT id, summary_plain, summary_tags, content_rating, source_scenario_id, source_turn_id, source_image_id, created_at FROM summary_exemplars ORDER BY content_rating DESC, created_at DESC LIMIT 100').all() });
});
router.get('/exemplars/style', function (_req, res) {
  res.json({ exemplars: db.prepare('SELECT id, style_context_snapshot, content_tags_snapshot, style_rating, content_rating, source_scenario_id, source_image_id, created_at FROM style_exemplars ORDER BY style_rating DESC, created_at DESC LIMIT 100').all() });
});
export default router;
