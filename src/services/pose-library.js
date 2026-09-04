import fs from 'node:fs';
import path from 'node:path';
import { POSE_LIBRARY_DIR } from '../paths.js';

const MANIFEST_NAME = 'manifest.json';

function _readManifest() {
  const manifestPath = path.join(POSE_LIBRARY_DIR, MANIFEST_NAME);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`Pose library is unavailable: ${err.message}`);
  }
  if (!Array.isArray(parsed?.poses)) {
    throw new Error('Pose library manifest is invalid.');
  }
  return parsed.poses;
}

function _getPose(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    throw new Error('Pose not found.');
  }
  const pose = _readManifest().find(function (entry) { return entry?.id === id; });
  if (!pose) throw new Error('Pose not found.');
  return pose;
}

function _resolveManifestFile(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    throw new Error('Pose asset is unavailable.');
  }
  const root = path.resolve(POSE_LIBRARY_DIR);
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('Pose asset is unavailable.');
  }
  return absolute;
}

export function getPoseLibrary() {
  return _readManifest().filter(function (pose) {
    return typeof pose?.id === 'string' && typeof pose?.preview_path === 'string' && typeof pose?.control_path === 'string';
  }).map(function (pose) {
    return {
      id: pose.id,
      label: pose.label || pose.id,
      category: pose.category || 'other',
      orientation: pose.orientation || 'unspecified',
      description: pose.description || '',
      subjects: Number(pose.subjects) || 1,
      preview_url: `/api/poses/${encodeURIComponent(pose.id)}/preview`,
    };
  });
}

/**
 * Returns the non-asset metadata for one pose (subject count, description,
 * orientation, label). Used by the image pipeline to sanity-check a chosen
 * pose against the cast and to feed a text hint into the prompt. Throws the
 * same "Pose not found." as the asset readers for an unknown id.
 */
export function getPoseMeta(id) {
  const pose = _getPose(id);
  return {
    id: pose.id,
    label: pose.label || pose.id,
    subjects: Number(pose.subjects) || 1,
    description: typeof pose.description === 'string' ? pose.description : '',
    orientation: pose.orientation || 'unspecified',
  };
}

// path -> { mtimeMs, size, b64 }. The prepared skeleton PNG is otherwise
// re-read and re-base64'd on every generation that uses this pose.
const _controlBase64Cache = new Map();

export function readPoseControlBase64(id) {
  const pose = _getPose(id);
  const assetPath = _resolveManifestFile(pose.control_path);
  try {
    const stat = fs.statSync(assetPath);
    const cached = _controlBase64Cache.get(assetPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.b64;
    const b64 = fs.readFileSync(assetPath).toString('base64');
    _controlBase64Cache.set(assetPath, { mtimeMs: stat.mtimeMs, size: stat.size, b64 });
    return b64;
  } catch (err) {
    _controlBase64Cache.delete(assetPath);
    throw new Error(`Pose control image is unavailable: ${err.message}`);
  }
}

export function getPosePreviewPath(id) {
  const pose = _getPose(id);
  const assetPath = _resolveManifestFile(pose.preview_path);
  if (!fs.existsSync(assetPath)) throw new Error('Pose preview is unavailable.');
  return assetPath;
}
