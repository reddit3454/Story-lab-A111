import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-pose-routes-'));
const POSE_LIBRARY_DIR = path.join(ROOT, 'pose-library');
const poseDir = path.join(POSE_LIBRARY_DIR, 'library', 'standing', 'standing-demo-01');
fs.mkdirSync(poseDir, { recursive: true });
fs.writeFileSync(path.join(poseDir, 'preview.png'), 'preview-bytes');
fs.writeFileSync(path.join(poseDir, 'control.png'), 'control-bytes');
fs.writeFileSync(path.join(POSE_LIBRARY_DIR, 'manifest.json'), JSON.stringify({ poses: [{
  id: 'standing-demo-01', label: 'standing demo', category: 'standing', orientation: 'front',
  description: 'A standing pose.', subjects: 1,
  preview_path: 'library/standing/standing-demo-01/preview.png',
  control_path: 'library/standing/standing-demo-01/control.png',
}] }));

mock.module('../../paths.js', { namedExports: { POSE_LIBRARY_DIR } });

const { default: express } = await import('express');
const { default: posesRouter } = await import('../poses.js');
const app = express();
app.use('/api/poses', posesRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test('GET /api/poses exposes safe metadata and serves only a manifest preview', async () => {
  const listResponse = await fetch(`${baseUrl}/api/poses`);
  assert.equal(listResponse.status, 200);
  const json = await listResponse.json();
  assert.deepEqual(json.poses, [{
    id: 'standing-demo-01', label: 'standing demo', category: 'standing', orientation: 'front',
    description: 'A standing pose.', subjects: 1,
    preview_url: '/api/poses/standing-demo-01/preview',
  }]);

  const previewResponse = await fetch(`${baseUrl}/api/poses/standing-demo-01/preview`);
  assert.equal(previewResponse.status, 200);
  assert.equal(await previewResponse.text(), 'preview-bytes');

  const invalidResponse = await fetch(`${baseUrl}/api/poses/not-a-pose/preview`);
  assert.equal(invalidResponse.status, 404);
});
