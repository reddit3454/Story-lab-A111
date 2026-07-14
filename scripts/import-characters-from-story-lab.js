/**
 * Import characters from story-lab into Story-lab-A111.
 * Usage: node scripts/import-characters-from-story-lab.js [--dry-run]
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

const SL_DB = 'E:/TheHub/projects/story-lab/database/story-lab.db';
const A111_DB = 'H:/MEDIA/Story_Lab/data/story-lab.db';
const A111_IMAGES = 'H:/MEDIA/Story_Lab/images';

const SEARCH_DIRS = [
  'H:/MEDIA/Story_Lab/References',
  'H:/MEDIA/Story_Lab',
  'H:/MEDIA/ComfyUI/Imagecore',
  'H:/MEDIA/NSFW',
  'C:/Users/Chris/Documents/ComfyUI/output',
  'E:/TheHub/projects/story-lab/public/uploads/seed-images',
];

const SHARED_COLS = [
  'name', 'description', 'appearance_notes', 'image_description',
  'gender', 'age_range', 'height', 'body_type', 'breast_size', 'butt_size', 'penis_state',
  'skin_tone', 'skin_extras', 'eye_color', 'eye_shape', 'nose_shape', 'lip_shape', 'face_shape',
  'hair_color', 'hair_style', 'hair_extras',
  'default_outfit', 'outfit_style', 'outfit_sets', 'default_outfit_name',
  'moodbaseline', 'arousalthreshold', 'moodtriggerspos', 'moodtriggersneg', 'arousaltriggers',
  'arousallockeduntil', 'arousalmax', 'image_prompt_override', 'faceid_ref_count', 'faceid_ref_order',
  'unique_trait', 'created_at',
];

function resolveSourceFile(filename) {
  if (!filename) return null;
  const base = path.basename(filename);
  for (const dir of SEARCH_DIRS) {
    const full = path.join(dir, base);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function ensureDir(p) {
  if (!DRY_RUN) fs.mkdirSync(p, { recursive: true });
}

function copyToCharFolder(src, charId, subfolder, preferredName) {
  if (!src || !fs.existsSync(src)) return null;
  const ext = path.extname(src) || '.png';
  const base = preferredName || `${Date.now()}${ext}`;
  const destDir = path.join(A111_IMAGES, 'characters', String(charId), subfolder);
  ensureDir(destDir);
  const dest = path.join(destDir, base);
  if (!DRY_RUN) fs.copyFileSync(src, dest);
  return `characters/${charId}/${subfolder}/${base}`;
}

function buildPersonality(slRow) {
  const extras = [];
  if (slRow.prompt_shortcode) extras.push(`Shortcode: ${slRow.prompt_shortcode}`);
  if (slRow.prompt_snippet) extras.push(`Snippet: ${slRow.prompt_snippet}`);
  if (slRow.lora_trigger) extras.push(`LoRA trigger: ${slRow.lora_trigger}`);
  if (slRow.lock_appearance) extras.push('Appearance locked in story-lab.');
  return extras.join('\n');
}

function buildAppearancePrompt(slRow) {
  if (slRow.image_prompt_override?.trim()) return slRow.image_prompt_override.trim();
  if (slRow.image_description?.trim()) return slRow.image_description.trim();
  if (slRow.appearance_notes?.trim()) return slRow.appearance_notes.trim().slice(0, 500);
  return '';
}

function coerceInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const sl = new DatabaseSync(SL_DB, { readonly: true });
const a111 = new DatabaseSync(A111_DB);

const slChars = sl.prepare('SELECT * FROM characters ORDER BY id').all();
const a111ByName = new Map(
  a111.prepare('SELECT * FROM characters').all().map(c => [c.name.trim().toLowerCase(), c])
);

const scenarioTitleToA111 = new Map(
  a111.prepare('SELECT id, title FROM scenarios').all().map(s => [s.title.trim().toLowerCase(), s.id])
);
const slScenarioTitle = new Map(
  sl.prepare('SELECT id, title FROM scenarios').all().map(s => [s.id, s.title.trim().toLowerCase()])
);

const idMap = {}; // oldSlId -> newA111Id
const stats = { inserted: 0, updated: 0, refs: 0, fullbodies: 0, scenarioLinks: 0, relationships: 0, bonds: 0, filesCopied: 0, missingFiles: 0 };

console.log(DRY_RUN ? 'DRY RUN' : 'LIVE IMPORT');
console.log(`Source: ${SL_DB} (${slChars.length} characters)`);

a111.exec('BEGIN');
try {
  for (const slRow of slChars) {
    const nameKey = slRow.name.trim().toLowerCase();
    const existing = a111ByName.get(nameKey);
    let charId;

    const currentClothingRow = sl.prepare(`
      SELECT current_clothing FROM scenariocharacterstate
      WHERE characterid = ? AND current_clothing IS NOT NULL AND trim(current_clothing) != ''
      ORDER BY updatedat DESC LIMIT 1
    `).get(slRow.id);
    const currentClothing = currentClothingRow?.current_clothing || slRow.default_outfit || '';

    const personality = buildPersonality(slRow);
    const appearancePrompt = buildAppearancePrompt(slRow);
    const isUser = slRow.is_user_character ? 1 : 0;

    if (existing) {
      charId = existing.id;
      const sets = [];
      const vals = [];
      for (const col of SHARED_COLS) {
        if (col === 'name') continue;
        sets.push(`${col} = ?`);
        vals.push(slRow[col] ?? null);
      }
      sets.push('role = ?', 'appearance_prompt = ?', 'base_clothing = ?', 'current_clothing = ?',
        'personality = ?', 'is_user = ?', 'is_user_character = ?', 'scenario_id = NULL');
      vals.push('character', appearancePrompt, slRow.default_outfit || '', currentClothing, personality, isUser, isUser, charId);

      if (!DRY_RUN) {
        a111.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
      stats.updated++;
      console.log(`  UPDATE ${slRow.name} (id ${charId})`);
    } else {
      const cols = ['name', ...SHARED_COLS.filter(c => c !== 'name'), 'role', 'appearance_prompt', 'base_clothing', 'current_clothing', 'personality', 'is_user', 'is_user_character'];
      const placeholders = cols.map(() => '?').join(',');
      const vals = [
        slRow.name,
        ...SHARED_COLS.filter(c => c !== 'name').map(c => slRow[c] ?? null),
        'character', appearancePrompt, slRow.default_outfit || '', currentClothing, personality, isUser, isUser,
      ];
      if (!DRY_RUN) {
        const ins = a111.prepare(`INSERT INTO characters (${cols.join(',')}) VALUES (${placeholders})`).run(...vals);
        charId = ins.lastInsertRowid;
      } else {
        charId = 9000 + slRow.id;
      }
      stats.inserted++;
      console.log(`  INSERT ${slRow.name} -> id ${charId}`);
    }

    idMap[slRow.id] = charId;

    // Primary reference_image_path
    let primaryRefRel = null;
    if (slRow.reference_image_path) {
      const src = resolveSourceFile(slRow.reference_image_path);
      if (src) {
        primaryRefRel = copyToCharFolder(src, charId, 'references', path.basename(slRow.reference_image_path));
        if (primaryRefRel) stats.filesCopied++;
      } else {
        stats.missingFiles++;
        console.log(`    MISSING primary ref: ${slRow.reference_image_path}`);
      }
    }

    // Seed image as extra ref if present
    let ipAdapterRel = null;
    if (slRow.seedimage) {
      const src = resolveSourceFile(slRow.seedimage);
      if (src) {
        ipAdapterRel = copyToCharFolder(src, charId, 'references', `seed_${path.basename(slRow.seedimage)}`);
        if (ipAdapterRel) stats.filesCopied++;
      }
    }

    // Legacy fullbody columns on character row
    for (const fbCol of ['fullbody_image_filename', 'fullbody_image_filename_2']) {
      if (slRow[fbCol]) {
        const src = resolveSourceFile(slRow[fbCol]);
        if (src) {
          const rel = copyToCharFolder(src, charId, 'fullbody', path.basename(slRow[fbCol]));
          if (rel && !DRY_RUN) {
            a111.prepare(`INSERT INTO character_fullbodies (scenario_id, character_id, filename, prompt_used, is_default) VALUES (NULL, ?, ?, '', 0)`).run(charId, rel);
            stats.fullbodies++;
          }
        }
      }
    }

    if (!DRY_RUN && (primaryRefRel || ipAdapterRel)) {
      a111.prepare('UPDATE characters SET reference_image_path = ?, reference_image = COALESCE(?, reference_image) WHERE id = ?')
        .run(primaryRefRel || existing?.reference_image_path || '', ipAdapterRel, charId);
    }

    // character_references gallery
    const refs = sl.prepare('SELECT * FROM character_references WHERE character_id = ?').all(slRow.id);
    for (const ref of refs) {
      const src = resolveSourceFile(ref.imagecore_filename);
      if (!src) { stats.missingFiles++; continue; }
      const rel = copyToCharFolder(src, charId, 'references', path.basename(ref.imagecore_filename));
      if (!rel) continue;
      if (!DRY_RUN) {
        const dup = a111.prepare('SELECT id FROM character_references WHERE character_id = ? AND filename = ?').get(charId, rel);
        if (!dup) {
          a111.prepare(`INSERT INTO character_references (scenario_id, character_id, filename, prompt_used, accepted) VALUES (NULL, ?, ?, ?, ?)`)
            .run(charId, rel, ref.prompt_used || '', ref.accepted || 0);
          stats.refs++;
        }
        if (ref.is_primary_face && !primaryRefRel) {
          a111.prepare('UPDATE characters SET reference_image_path = ? WHERE id = ?').run(rel, charId);
        }
      } else stats.refs++;
    }

    // character_fullbodies table
    const fbs = sl.prepare('SELECT * FROM character_fullbodies WHERE character_id = ?').all(slRow.id);
    for (const fb of fbs) {
      const src = resolveSourceFile(fb.filename);
      if (!src) { stats.missingFiles++; continue; }
      const rel = copyToCharFolder(src, charId, 'fullbody', path.basename(fb.filename));
      if (!rel) continue;
      if (!DRY_RUN) {
        const dup = a111.prepare('SELECT id FROM character_fullbodies WHERE character_id = ? AND filename = ?').get(charId, rel);
        if (!dup) {
          a111.prepare(`INSERT INTO character_fullbodies (scenario_id, character_id, filename, prompt_used, is_default) VALUES (NULL, ?, ?, ?, 0)`)
            .run(charId, rel, fb.prompt_used || '');
          stats.fullbodies++;
        }
      } else stats.fullbodies++;
    }
  }

  // scenario_characters - link where scenario title matches
  const scRows = sl.prepare('SELECT scenario_id, character_id FROM scenario_characters').all();
  for (const sc of scRows) {
    const titleKey = slScenarioTitle.get(sc.scenario_id);
    const a111ScenId = titleKey ? scenarioTitleToA111.get(titleKey) : null;
    const newCharId = idMap[sc.character_id];
    if (!a111ScenId || !newCharId) continue;
    if (!DRY_RUN) {
      a111.prepare('INSERT OR IGNORE INTO scenario_characters (scenario_id, character_id) VALUES (?, ?)').run(a111ScenId, newCharId);
    }
    stats.scenarioLinks++;
  }

  // character_relationships
  const rels = sl.prepare('SELECT * FROM character_relationships').all();
  for (const r of rels) {
    const fromId = idMap[r.character_id];
    const toId = idMap[r.related_character_id];
    if (!fromId || !toId) continue;
    const desc = [r.relationshipnotes, r.relationshipbond, r.relationshipdynamic].filter(Boolean).join('; ');
    const relType = (r.relationship_label || r.relationshiptype || 'friend').toLowerCase().slice(0, 64);
    if (!DRY_RUN) {
      a111.prepare(`
        INSERT INTO character_relationships (scenario_id, from_character_id, to_character_id, relationship_type, description, strength)
        VALUES (0, ?, ?, ?, ?, 3)
        ON CONFLICT(from_character_id, to_character_id) DO UPDATE SET
          relationship_type = excluded.relationship_type,
          description = excluded.description
      `).run(fromId, toId, relType, desc);
    }
    stats.relationships++;
  }

  // character_bonds -> global relationships
  const bonds = sl.prepare('SELECT * FROM character_bonds').all();
  for (const b of bonds) {
    const fromId = idMap[b.character_id];
    const toId = idMap[b.related_character_id];
    if (!fromId || !toId) continue;
    if (!DRY_RUN) {
      a111.prepare(`
        INSERT INTO character_relationships (scenario_id, from_character_id, to_character_id, relationship_type, description, strength)
        VALUES (0, ?, ?, 'bond', ?, 3)
        ON CONFLICT(from_character_id, to_character_id) DO UPDATE SET description = excluded.description
      `).run(fromId, toId, b.description || '');
    }
    stats.bonds++;
  }

  if (DRY_RUN) a111.exec('ROLLBACK'); else a111.exec('COMMIT');
} catch (err) {
  a111.exec('ROLLBACK');
  throw err;
}

console.log('\nDone:', stats);
if (DRY_RUN) console.log('No changes written (dry run).');
