import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { IMAGES_DIR } from '../paths.js';
import { parseTags, serializeTags } from '../services/relationship-resolve.js';
import broadcast from '../broadcast.js';
import {
  setScenarioRuntimeClothing,
  setScenarioStartingOutfit,
  getScenarioClothing,
} from '../services/clothing.js';
import { migrateLegacyArousalMax } from '../services/arousal-rules.js';

const router = Router();

const _FACE_REF_EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};
function _normalizeArousalMax(raw) {
  const migrated = migrateLegacyArousalMax(raw == null || raw === '' ? 10 : raw);
  return Math.min(10, Math.max(1, migrated));
}

/* ── Character CRUD ───────────────────────────────────────────────────────── */

router.get('/', function (req, res) {
  res.json(db.prepare('SELECT * FROM characters ORDER BY name').all());
});

router.post('/', function (req, res) {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(`
    INSERT INTO characters (
      name, role, description, appearance_notes,
      gender, age_range, height, body_type,
      breast_size, butt_size, penis_state,
      skin_tone, skin_extras,
      eye_color, eye_shape, nose_shape, lip_shape, face_shape,
      hair_color, hair_style, hair_extras,
      appearance_prompt, base_clothing, current_clothing,
      default_outfit, outfit_style, outfit_sets, default_outfit_name,
      personality, is_user, is_user_character,
      moodbaseline, arousalthreshold, arousallockeduntil, arousalmax,
      moodtriggerspos, moodtriggersneg, arousaltriggers,
      unique_trait
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )
  `).run(
    b.name                ?? '',
    b.role                ?? 'character',
    b.description         ?? '',
    b.appearance_notes    ?? '',
    b.gender              ?? '',
    b.age_range           ?? 'adult',
    b.height              ?? '',
    b.body_type           ?? '',
    b.breast_size         ?? '',
    b.butt_size           ?? null,
    b.penis_state         ?? 'soft',
    b.skin_tone           ?? '',
    b.skin_extras         ?? null,
    b.eye_color           ?? '',
    b.eye_shape           ?? null,
    b.nose_shape          ?? null,
    b.lip_shape           ?? null,
    b.face_shape          ?? null,
    b.hair_color          ?? '',
    b.hair_style          ?? '',
    b.hair_extras         ?? null,
    b.appearance_prompt   ?? '',
    b.base_clothing       ?? '',
    b.current_clothing    ?? '',
    b.default_outfit      ?? null,
    b.outfit_style        ?? null,
    b.outfit_sets         ?? null,
    b.default_outfit_name ?? null,
    b.personality         ?? '',
    (b.is_user_character ?? b.is_user) ? 1 : 0,
    (b.is_user_character ?? b.is_user) ? 1 : 0,
    b.moodbaseline        ?? 3,
    b.arousalthreshold    ?? 'medium',
    b.arousallockeduntil  ?? 2,
    _normalizeArousalMax(b.arousalmax),
    b.moodtriggerspos     ?? null,
    b.moodtriggersneg     ?? null,
    b.arousaltriggers     ?? null,
    b.unique_trait          ?? null,
  );

  res.status(201).json(db.prepare('SELECT * FROM characters WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:id', function (req, res) {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  res.json(row);
});

router.put('/:id', function (req, res) {
  const b = req.body;

  db.prepare(`
    UPDATE characters SET
      name                 = COALESCE(?, name),
      role                 = ?,
      description          = ?,
      appearance_notes     = ?,
      gender               = ?,
      age_range            = ?,
      height               = ?,
      body_type            = ?,
      breast_size          = ?,
      butt_size            = ?,
      penis_state          = ?,
      skin_tone            = ?,
      skin_extras          = ?,
      eye_color            = ?,
      eye_shape            = ?,
      nose_shape           = ?,
      lip_shape            = ?,
      face_shape           = ?,
      hair_color           = ?,
      hair_style           = ?,
      hair_extras          = ?,
      appearance_prompt    = ?,
      base_clothing        = ?,
      current_clothing     = ?,
      default_outfit       = ?,
      outfit_style         = ?,
      outfit_sets          = ?,
      default_outfit_name  = ?,
      personality          = ?,
      is_user              = ?,
      is_user_character    = ?,
      moodbaseline         = ?,
      arousalthreshold     = ?,
      arousallockeduntil   = ?,
      arousalmax           = ?,
      moodtriggerspos      = ?,
      moodtriggersneg      = ?,
      arousaltriggers      = ?,
      unique_trait          = ?
    WHERE id = ?
  `).run(
    b.name                ?? null,
    b.role                ?? 'character',
    b.description         ?? '',
    b.appearance_notes    ?? '',
    b.gender              ?? '',
    b.age_range           ?? 'adult',
    b.height              ?? '',
    b.body_type           ?? '',
    b.breast_size         ?? '',
    b.butt_size           ?? null,
    b.penis_state         ?? 'soft',
    b.skin_tone           ?? '',
    b.skin_extras         ?? null,
    b.eye_color           ?? '',
    b.eye_shape           ?? null,
    b.nose_shape          ?? null,
    b.lip_shape           ?? null,
    b.face_shape          ?? null,
    b.hair_color          ?? '',
    b.hair_style          ?? '',
    b.hair_extras         ?? null,
    b.appearance_prompt   ?? '',
    b.base_clothing       ?? '',
    b.current_clothing    ?? '',
    b.default_outfit      ?? null,
    b.outfit_style        ?? null,
    b.outfit_sets         ?? null,
    b.default_outfit_name ?? null,
    b.personality         ?? '',
    (b.is_user_character ?? b.is_user) ? 1 : 0,
    (b.is_user_character ?? b.is_user) ? 1 : 0,
    b.moodbaseline        ?? 3,
    b.arousalthreshold    ?? 'medium',
    b.arousallockeduntil  ?? 2,
    _normalizeArousalMax(b.arousalmax),
    b.moodtriggerspos     ?? null,
    b.moodtriggersneg     ?? null,
    b.arousaltriggers     ?? null,
    b.unique_trait          ?? null,
    req.params.id,
  );

  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  res.json(row);
});

router.delete('/:id', function (req, res) {
  db.prepare('DELETE FROM characters WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.patch('/:id/clothing', function (req, res) {
  const charId = parseInt(req.params.id, 10);
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const { current_clothing, scenario_id, runtime } = req.body || {};
  const clothing = String(current_clothing ?? '').trim();
  const scenarioId = scenario_id != null ? parseInt(scenario_id, 10) : null;

  // Scenario-scoped: never mutate character wardrobe JSON / card defaults.
  // CF-10: runtime must be an explicit boolean when scenario_id is set.
  // (Omitted used to default to runtime write here, opposite of the scenario-characters route.)
  if (scenarioId) {
    const link = db.prepare(
      'SELECT starting_clothing FROM scenario_characters WHERE scenario_id = ? AND character_id = ?'
    ).get(scenarioId, charId);
    if (!link) return res.status(404).json({ error: 'Character not in this scenario' });

    if (typeof runtime !== 'boolean') {
      return res.status(400).json({
        error: 'runtime must be an explicit boolean when scenario_id is set (true=runtime clothing, false=starting outfit)',
      });
    }

    if (runtime === false) {
      setScenarioStartingOutfit(scenarioId, charId, { description: clothing, setName: null });
    } else {
      setScenarioRuntimeClothing(scenarioId, charId, clothing);
    }
    const live = getScenarioClothing(scenarioId, charId);
    broadcast.send('clothingupdate', {
      scenarioId,
      characters: [{ characterId: charId, current_clothing: live }],
    });
    return res.json({ ok: true, current_clothing: live });
  }

  // Character-card only legacy field (not outfit_sets JSON)
  db.prepare('UPDATE characters SET current_clothing = ? WHERE id = ?').run(clothing, charId);
  broadcast.send('clothingupdate', {
    scenarioId: null,
    characters: [{ characterId: charId, current_clothing: clothing }],
  });
  res.json({ ok: true, character: db.prepare('SELECT * FROM characters WHERE id = ?').get(charId) });
});

// FaceID reference image — uploaded as base64 JSON (no multer / new dependency).
// Frontend reads the picked file via FileReader and posts { image_base64, mime }.
router.post('/:id/face-ref', function (req, res) {
  const charId = parseInt(req.params.id, 10);
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const { image_base64, mime } = req.body || {};
  if (!image_base64) return res.status(400).json({ error: 'image_base64 is required' });

  const cleanB64 = image_base64.includes(',') ? image_base64.split(',').pop() : image_base64;
  const ext = _FACE_REF_EXT_BY_MIME[mime] || '.png';

  let buffer;
  try {
    buffer = Buffer.from(cleanB64, 'base64');
  } catch (err) {
    return res.status(400).json({ error: 'image_base64 could not be decoded: ' + err.message });
  }
  if (!buffer.length) return res.status(400).json({ error: 'decoded image is empty' });

  const relDir = path.join('characters', String(charId));
  const relPath = path.join(relDir, `reference${ext}`);
  const absDir = path.join(IMAGES_DIR, relDir);
  const absPath = path.join(IMAGES_DIR, relPath);

  try {
    fs.mkdirSync(absDir, { recursive: true });
    fs.writeFileSync(absPath, buffer);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save reference image: ' + err.message });
  }

  // relPath uses OS separators internally; normalize to forward slashes for a
  // portable DB value and for building /story-images URLs on the frontend.
  const storedPath = relPath.split(path.sep).join('/');
  db.prepare('UPDATE characters SET reference_image_path = ? WHERE id = ?').run(storedPath, charId);

  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  res.json(row);
});

router.delete('/:id/face-ref', function (req, res) {
  const charId = parseInt(req.params.id, 10);
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(charId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  // Clears the DB reference only — the file itself is left on disk (never
  // silently delete user files as a side effect of an unrelated action).
  db.prepare('UPDATE characters SET reference_image_path = NULL WHERE id = ?').run(charId);
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  res.json(row);
});

router.get('/:id/relationships', function (req, res) {
  const rows = db.prepare(`
    SELECT cr.*,
      cf.name AS from_name,
      ct.name AS to_name
    FROM character_relationships cr
    JOIN characters cf ON cf.id = cr.from_character_id
    JOIN characters ct ON ct.id = cr.to_character_id
    WHERE cr.scenario_id = 0 AND (cr.from_character_id = ? OR cr.to_character_id = ?)
    ORDER BY cf.name, ct.name
  `).all(req.params.id, req.params.id);
  res.json(rows.map(function (row) {
    const tags = parseTags(row.tags_json);
    return { ...row, tags, tags_json: serializeTags(tags) };
  }));
});

export default router;
