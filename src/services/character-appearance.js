import fs from 'fs';
import path from 'path';
import { IMAGES_DIR } from '../paths.js';
import { logError } from '../logger.js';

/**
 * Builds a comma-separated appearance description for a single character from
 * its structured trait columns, falling back to freeform appearance_prompt /
 * appearance_notes when a trait is blank. Pure — no DB, no fs, no network.
 * This is the "Character appearance" block of the image prompt (stage 2 of
 * the assembly order); it never includes style words.
 */
export function buildCharacterAppearance(character) {
  if (!character) return '';
  const c = character;
  const parts = [];

  const gLower = (c.gender || '').toLowerCase();

  if (c.gender) parts.push(c.gender);
  if (c.age_range && c.age_range !== 'adult') parts.push(c.age_range);
  if (c.height) parts.push(c.height);
  if (c.body_type) parts.push(`${c.body_type} build`);

  const hairBits = [c.hair_color, c.hair_style, c.hair_extras].filter(Boolean);
  if (hairBits.length) parts.push(`${hairBits.join(' ')} hair`);

  const eyeBits = [c.eye_color, c.eye_shape].filter(Boolean);
  if (eyeBits.length) parts.push(`${eyeBits.join(' ')} eyes`);

  if (c.skin_tone && c.skin_extras) parts.push(`${c.skin_tone} skin with ${c.skin_extras}`);
  else if (c.skin_tone) parts.push(`${c.skin_tone} skin`);
  else if (c.skin_extras) parts.push(c.skin_extras);

  if (c.face_shape) parts.push(`${c.face_shape} face`);
  if (c.nose_shape) parts.push(`${c.nose_shape} nose`);
  if (c.lip_shape) parts.push(`${c.lip_shape} lips`);

  if (c.breast_size && (gLower === 'female' || gLower === 'non-binary')) parts.push(`${c.breast_size} breasts`);
  if (c.butt_size) parts.push(`${c.butt_size} butt`);

  if (c.unique_trait) parts.push(c.unique_trait);

  let built = parts.filter(Boolean).join(', ');

  // Freeform fallback / supplement — clip to keep the appearance block from
  // dominating the prompt the way a full paragraph bio would.
  const freeform = (c.appearance_prompt || c.appearance_notes || '').trim();
  if (freeform) {
    const clipped = freeform.split(/\.\s+[A-Z]/)[0].slice(0, 160).trim().replace(/[,\s]+$/, '');
    if (clipped) built = built ? `${built}, ${clipped}` : clipped;
  }

  return built;
}

/**
 * Resolves a character's stored FaceID reference image to an absolute path
 * under IMAGES_DIR. Returns null if the character has no reference set —
 * never throws.
 */
export function resolveFaceRefAbsolutePath(character) {
  if (!character || !character.reference_image_path) return null;
  return path.join(IMAGES_DIR, character.reference_image_path);
}

/**
 * Reads a character's FaceID reference image off disk and returns it as a
 * base64 string (no data: prefix — A1111 expects raw base64). Returns null
 * if there is no reference configured, or if the file is missing/unreadable
 * — logs the failure but never throws, so a missing reference degrades the
 * pipeline to "generate without FaceID" rather than crashing it.
 */
export function readFaceRefBase64(character) {
  const absPath = resolveFaceRefAbsolutePath(character);
  if (!absPath) return null;
  try {
    if (!fs.existsSync(absPath)) {
      logError('character-appearance', 'face_ref_missing', new Error(`reference file not found: ${absPath}`));
      return null;
    }
    return fs.readFileSync(absPath).toString('base64');
  } catch (err) {
    logError('character-appearance', 'face_ref_read_failed', err);
    return null;
  }
}
