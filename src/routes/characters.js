import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import db from '../db.js';
import broadcast from '../broadcast.js';
import { IMAGES_DIR } from '../paths.js';
import {
  setScenarioRuntimeClothing,
  setScenarioStartingOutfit,
  getScenarioClothing,
} from '../services/clothing.js';
import { resolveEffectiveConfig } from '../services/config-resolver.js';
import { buildA1111Payload, callA1111 } from '../services/image-pipeline.js';

const router = Router();

/* ── helpers ──────────────────────────────────────────────────────────────── */

function _charDir(charId) {
  return path.join(IMAGES_DIR, 'characters', String(charId));
}

// Filename stored in DB is the path relative to IMAGES_DIR so imageSrc() works:
//   e.g.  "characters/7/references/1234567890.png"
function _relPath(charId, subfolder, basename) {
  return `characters/${charId}/${subfolder}/${basename}`;
}

// Minimal multipart/form-data parser — no dependencies, handles a single file field.
// Returns { buffer: Buffer, originalName: string }
async function _readMultipart(req) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
    if (!bm) return reject(new Error('multipart/form-data boundary not found in Content-Type'));
    const boundary = bm[1] || bm[2];
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const body     = Buffer.concat(chunks);
        const headerSep = Buffer.from('\r\n\r\n');
        const hStart   = ('--' + boundary + '\r\n').length;

        let hEnd = -1;
        for (let i = hStart; i <= body.length - headerSep.length; i++) {
          if (body.subarray(i, i + headerSep.length).equals(headerSep)) { hEnd = i; break; }
        }
        if (hEnd === -1) return reject(new Error('Malformed multipart: no header separator'));

        const headerStr = body.subarray(hStart, hEnd).toString('utf8');
        const fnMatch   = headerStr.match(/filename="([^"]+)"/i);
        const originalName = fnMatch ? fnMatch[1] : 'upload';

        const dataStart = hEnd + 4;

        const closing = Buffer.from('\r\n--' + boundary);
        let dataEnd = -1;
        for (let i = dataStart; i <= body.length - closing.length; i++) {
          if (body.subarray(i, i + closing.length).equals(closing)) { dataEnd = i; break; }
        }
        if (dataEnd === -1) return reject(new Error('Malformed multipart: no closing boundary'));

        resolve({ buffer: body.subarray(dataStart, dataEnd), originalName });
      } catch (e) { reject(e); }
    });
  });
}

// Assemble the best available image prompt from a character row.
// Priority: image_prompt_override → image_description → trait columns → appearance_prompt → name
function _assembleCharacterPrompt(char) {
  if (char.image_prompt_override?.trim()) return char.image_prompt_override.trim();
  if (char.image_description?.trim())     return char.image_description.trim();
  const parts = [];
  if (char.gender)    parts.push(char.gender);
  if (char.age_range && char.age_range !== 'adult') parts.push(char.age_range);
  if (char.height)    parts.push(char.height);
  if (char.body_type) parts.push(char.body_type + ' build');
  const hair = [char.hair_color, char.hair_style, char.hair_extras].filter(Boolean);
  if (hair.length)    parts.push(hair.join(' ') + ' hair');
  const eyes = [char.eye_color, char.eye_shape].filter(Boolean);
  if (eyes.length)    parts.push(eyes.join(' ') + ' eyes');
  if (char.skin_tone) parts.push(char.skin_tone + ' skin');
  if (char.face_shape) parts.push(char.face_shape + ' face shape');
  if (char.nose_shape) parts.push(char.nose_shape + ' nose');
  if (char.lip_shape)  parts.push(char.lip_shape + ' lips');
  const gL = (char.gender || '').toLowerCase();
  if (char.breast_size && (gL === 'female' || gL === 'non-binary')) parts.push(char.breast_size + ' breasts');
  if (char.butt_size)  parts.push(char.butt_size + ' butt');
  const outfit = char.current_clothing || char.base_clothing || char.default_outfit;
  if (outfit) parts.push(outfit);
  if (char.appearance_notes) {
    const clipped = char.appearance_notes.split(/\.\s+[A-Z]/)[0].slice(0, 120).trim().replace(/[,\s]+$/, '');
    if (clipped) parts.push(clipped);
  }
  if (parts.length) return parts.join(', ');
  return (char.appearance_prompt?.trim()) || char.name;
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
      name, role, description, image_description, appearance_notes,
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
      image_prompt_override, unique_trait
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )
  `).run(
    b.name                ?? '',
    b.role                ?? 'character',
    b.description         ?? '',
    b.image_description   ?? null,
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
    b.arousalmax          ?? 5,
    b.moodtriggerspos     ?? null,
    b.moodtriggersneg     ?? null,
    b.arousaltriggers     ?? null,
    b.image_prompt_override ?? null,
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
      image_description    = ?,
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
      image_prompt_override = ?,
      unique_trait          = ?,
      reference_image       = ?
    WHERE id = ?
  `).run(
    b.name                ?? null,
    b.role                ?? 'character',
    b.description         ?? '',
    b.image_description   ?? null,
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
    b.arousalmax          ?? 5,
    b.moodtriggerspos     ?? null,
    b.moodtriggersneg     ?? null,
    b.arousaltriggers     ?? null,
    b.image_prompt_override ?? null,
    b.unique_trait          ?? null,
    b.reference_image       ?? '',
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

/* ── Character References ─────────────────────────────────────────────────── */

router.get('/:id/references', function (req, res) {
  const refs = db.prepare(
    'SELECT * FROM character_references WHERE character_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json({ references: refs });
});

// Specific literal routes MUST be before dynamic /:refId or Express swallows them
router.delete('/:id/references/faceid', function (req, res) {
  db.prepare('UPDATE characters SET reference_image_path = NULL, reference_image = NULL WHERE id = ?').run(req.params.id);
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  res.json({ ok: true, character: char });
});

router.delete('/:id/references/:refId', function (req, res) {
  const ref = db.prepare('SELECT * FROM character_references WHERE id = ? AND character_id = ?')
    .get(req.params.refId, req.params.id);
  if (!ref) return res.status(404).json({ error: 'Reference not found' });

  try {
    const diskPath = path.join(IMAGES_DIR, ref.filename);
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  } catch (_) {}

  db.prepare('DELETE FROM character_references WHERE id = ?').run(req.params.refId);
  res.json({ ok: true });
});

router.post('/:id/references/generate', async function (req, res) {
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  try {
    const config  = resolveEffectiveConfig(db);
    const baseUrl = config.a1111_url || 'http://127.0.0.1:7860';
    const prompt  = (req.body && req.body.prompt_override) || _assembleCharacterPrompt(char);
    const negative = config.master_negative || '';

    const refDir   = path.join(_charDir(req.params.id), 'references');
    const basename = `${Date.now()}.png`;
    const savePath = path.join(refDir, basename);
    fs.mkdirSync(refDir, { recursive: true });

    // Shared with image-pipeline.js's main generation path (VAE override + retry-on-failure) — see CF-4.
    const payload = buildA1111Payload(config, prompt, negative, null);
    await callA1111(baseUrl, 'txt2img', payload, savePath);

    const relPath = _relPath(req.params.id, 'references', basename);
    const ins = db.prepare(
      'INSERT INTO character_references (character_id, filename, prompt_used) VALUES (?, ?, ?)'
    ).run(req.params.id, relPath, prompt);

    res.status(201).json({
      ok: true,
      reference: db.prepare('SELECT * FROM character_references WHERE id = ?').get(ins.lastInsertRowid),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/references/upload', async function (req, res) {
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  try {
    const { buffer, originalName } = await _readMultipart(req);
    const ext      = path.extname(originalName).toLowerCase() || '.jpg';
    const basename = `${Date.now()}${ext}`;
    const refDir   = path.join(_charDir(req.params.id), 'references');
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, basename), buffer);

    const relPath = _relPath(req.params.id, 'references', basename);
    const ins = db.prepare(
      'INSERT INTO character_references (character_id, filename) VALUES (?, ?)'
    ).run(req.params.id, relPath);

    res.status(201).json({
      ok: true,
      filename: relPath,
      reference: db.prepare('SELECT * FROM character_references WHERE id = ?').get(ins.lastInsertRowid),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// :ref may be a numeric character_references.id or a filename basename
router.post('/:id/references/:ref/accept', function (req, res) {
  const { id: charId, ref } = req.params;

  let row;
  if (/^\d+$/.test(ref)) {
    row = db.prepare('SELECT * FROM character_references WHERE id = ? AND character_id = ?').get(ref, charId);
  } else {
    row = db.prepare("SELECT * FROM character_references WHERE filename LIKE ? AND character_id = ?")
      .get('%/' + ref, charId);
    if (!row) {
      row = db.prepare('SELECT * FROM character_references WHERE filename = ? AND character_id = ?').get(ref, charId);
    }
  }
  if (!row) return res.status(404).json({ error: 'Reference not found' });

  db.prepare('UPDATE characters SET reference_image_path = ?, reference_image = ? WHERE id = ?')
    .run(row.filename, row.filename, charId);

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
  res.json({ ok: true, character: char });
});

/* ── Character Full-Body Images ───────────────────────────────────────────── */

router.get('/:id/fullbody', function (req, res) {
  const fbs = db.prepare(
    'SELECT * FROM character_fullbodies WHERE character_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json({ fullbodies: fbs });
});

// DEPRECATED: faceid_ref_count/faceid_ref_order have no runtime consumer — the app is
// single-reference only (see resolvePrimaryCharacterForReference / buildA1111Payload,
// which read characters.reference_image_path). The UI that called this route has been
// removed (it was leftover ComfyUI-era copy referencing a node — IPAAdapterFaceIDBatch —
// that doesn't exist in this A1111-only architecture). Route kept only so any stray
// caller doesn't 404; do not build new features on these columns without first
// implementing real multi-reference ControlNet unit support end-to-end.
router.patch('/:id/faceid-config', function (req, res) {
  const { faceid_ref_count, faceid_ref_order } = req.body;
  db.prepare(`UPDATE characters SET faceid_ref_count = ?, faceid_ref_order = ? WHERE id = ?`).run(
    faceid_ref_count ?? 5,
    faceid_ref_order ? JSON.stringify(faceid_ref_order) : null,
    req.params.id,
  );
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  res.json(row);
});

router.post('/:id/fullbody/generate', async function (req, res) {
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  try {
    const config  = resolveEffectiveConfig(db);
    const baseUrl = config.a1111_url || 'http://127.0.0.1:7860';
    const prompt  = (req.body && req.body.prompt_override) || _assembleCharacterPrompt(char);
    const negative = config.master_negative || '';

    const fbDir    = path.join(_charDir(req.params.id), 'fullbody');
    const basename = `${Date.now()}.png`;
    const savePath = path.join(fbDir, basename);
    fs.mkdirSync(fbDir, { recursive: true });

    // Shared with image-pipeline.js's main generation path (VAE override + retry-on-failure) — see CF-4.
    const payload = buildA1111Payload(config, prompt, negative, null);
    await callA1111(baseUrl, 'txt2img', payload, savePath);

    const relPath = _relPath(req.params.id, 'fullbody', basename);
    const ins = db.prepare(
      'INSERT INTO character_fullbodies (character_id, filename, prompt_used) VALUES (?, ?, ?)'
    ).run(req.params.id, relPath, prompt);

    const row = db.prepare('SELECT * FROM character_fullbodies WHERE id = ?').get(ins.lastInsertRowid);
    const all = db.prepare(
      'SELECT * FROM character_fullbodies WHERE character_id = ? ORDER BY created_at DESC'
    ).all(req.params.id);

    res.status(201).json({ ok: true, fullbody: row, fullbodies: all });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/fullbody/:fbId', function (req, res) {
  const row = db.prepare('SELECT * FROM character_fullbodies WHERE id = ? AND character_id = ?')
    .get(req.params.fbId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Full-body image not found' });

  try {
    const diskPath = path.join(IMAGES_DIR, row.filename);
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  } catch (_) {}

  db.prepare('DELETE FROM character_fullbodies WHERE id = ?').run(req.params.fbId);
  res.json({ ok: true });
});

router.post('/:id/fullbody/:fbId/set-default', function (req, res) {
  const row = db.prepare('SELECT * FROM character_fullbodies WHERE id = ? AND character_id = ?')
    .get(req.params.fbId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Full-body image not found' });

  db.prepare('UPDATE character_fullbodies SET is_default = 0 WHERE character_id = ?').run(req.params.id);
  db.prepare('UPDATE character_fullbodies SET is_default = 1 WHERE id = ?').run(req.params.fbId);

  res.json({ ok: true, fullbody: db.prepare('SELECT * FROM character_fullbodies WHERE id = ?').get(req.params.fbId) });
});

router.post('/:id/fullbody/:fbId/use-as-ref', function (req, res) {
  const row = db.prepare('SELECT * FROM character_fullbodies WHERE id = ? AND character_id = ?')
    .get(req.params.fbId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Full-body image not found' });

  db.prepare('UPDATE characters SET reference_image_path = ?, reference_image = ? WHERE id = ?')
    .run(row.filename, row.filename, req.params.id);

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  res.json({ ok: true, character: char });
});

router.get('/:id/relationships', function (req, res) {
  const rows = db.prepare(`
    SELECT cr.*,
      cf.name AS from_name,
      ct.name AS to_name
    FROM character_relationships cr
    JOIN characters cf ON cf.id = cr.from_character_id
    JOIN characters ct ON ct.id = cr.to_character_id
    WHERE cr.from_character_id = ? OR cr.to_character_id = ?
    ORDER BY cf.name, ct.name
  `).all(req.params.id, req.params.id);
  res.json(rows);
});

export default router;
