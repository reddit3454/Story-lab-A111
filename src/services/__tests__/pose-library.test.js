import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-pose-library-'));
const POSE_LIBRARY_DIR = path.join(ROOT, 'pose-library');
const poseDir = path.join(POSE_LIBRARY_DIR, 'library', 'sitting', 'sitting-demo-01');
fs.mkdirSync(poseDir, { recursive: true });
fs.writeFileSync(path.join(poseDir, 'preview.png'), 'preview-bytes');
fs.writeFileSync(path.join(poseDir, 'control.png'), 'control-bytes');
fs.writeFileSync(path.join(POSE_LIBRARY_DIR, 'manifest.json'), JSON.stringify({ poses: [{
  id: 'sitting-demo-01',
  label: 'sitting demo',
  category: 'sitting',
  orientation: 'left',
  description: 'A seated pose.',
  subjects: 1,
  preview_path: 'library/sitting/sitting-demo-01/preview.png',
  control_path: 'library/sitting/sitting-demo-01/control.png',
}] }));

mock.module('../../paths.js', {
  namedExports: { POSE_LIBRARY_DIR },
});

const { getPoseLibrary, readPoseControlBase64 } = await import('../pose-library.js');

test('getPoseLibrary returns browser-safe pose records without filesystem control paths', () => {
  const poses = getPoseLibrary();

  assert.deepEqual(poses, [{
    id: 'sitting-demo-01',
    label: 'sitting demo',
    category: 'sitting',
    orientation: 'left',
    description: 'A seated pose.',
    subjects: 1,
    preview_url: '/api/poses/sitting-demo-01/preview',
  }]);
});

test('readPoseControlBase64 resolves only a manifest pose id', () => {
  assert.equal(readPoseControlBase64('sitting-demo-01'), Buffer.from('control-bytes').toString('base64'));
  assert.throws(function () { readPoseControlBase64('../outside'); }, /not found/i);
});
