import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacterAppearance, resolveFaceRefAbsolutePath, readFaceRefBase64 } from '../character-appearance.js';

describe('buildCharacterAppearance', () => {
  it('builds a comma-joined description from structured trait columns', () => {
    const str = buildCharacterAppearance({
      gender: 'Female', age_range: 'adult', height: 'tall', body_type: 'athletic',
      hair_color: 'red', hair_style: 'long', eye_color: 'green', eye_shape: 'almond',
      skin_tone: 'fair', face_shape: 'oval', breast_size: 'medium',
    });
    assert.match(str, /Female/);
    assert.match(str, /athletic build/);
    assert.match(str, /red long hair/);
    assert.match(str, /green almond eyes/);
    assert.match(str, /fair skin/);
    assert.match(str, /medium breasts/);
    // 'adult' is the default age_range and must not appear as noise
    assert.doesNotMatch(str, /\badult\b/);
  });

  it('omits breast_size for a male character', () => {
    const str = buildCharacterAppearance({ gender: 'Male', breast_size: 'large' });
    assert.doesNotMatch(str, /breasts/);
  });

  it('falls back to freeform appearance_prompt when trait columns are empty', () => {
    const str = buildCharacterAppearance({ appearance_prompt: 'a weathered old sailor with a scar' });
    assert.match(str, /weathered old sailor/);
  });

  it('clips an overlong freeform bio rather than dumping the whole paragraph', () => {
    const long = 'A'.repeat(300) + '. Second sentence should be dropped.';
    const str = buildCharacterAppearance({ appearance_prompt: long });
    assert.ok(str.length < 200);
  });

  it('returns empty string for a null/undefined character rather than throwing', () => {
    assert.equal(buildCharacterAppearance(null), '');
    assert.equal(buildCharacterAppearance(undefined), '');
  });

  it('includes unique_trait when present', () => {
    const str = buildCharacterAppearance({ unique_trait: 'a small anchor tattoo on her wrist' });
    assert.match(str, /anchor tattoo/);
  });
});

describe('resolveFaceRefAbsolutePath / readFaceRefBase64', () => {
  it('returns null when the character has no reference_image_path', () => {
    assert.equal(resolveFaceRefAbsolutePath({}), null);
    assert.equal(resolveFaceRefAbsolutePath(null), null);
  });

  it('readFaceRefBase64 returns null (never throws) when the file does not exist on disk', () => {
    const result = readFaceRefBase64({ reference_image_path: 'characters/999999/reference.png' });
    assert.equal(result, null);
  });
});
