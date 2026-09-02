import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-faceref-'));
const DIRS = { data: path.join(ROOT, 'data'), images: path.join(ROOT, 'images'), audio: path.join(ROOT, 'audio') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images, AUDIO_DIR: DIRS.audio,
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const realFetch = globalThis.fetch;
const { default: db } = await import('../../db.js');
const { default: express } = await import('express');
const { default: charactersRouter } = await import('../characters.js');
const { readFaceRefBase64 } = await import('../../services/character-appearance.js');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/api/characters', charactersRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

// 1x1 transparent PNG, base64-encoded — a tiny real PNG so file writes are realistic.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('POST /api/characters/:id/face-ref saves the file and sets reference_image_path', async () => {
  const charId = db.prepare(`INSERT INTO characters (name, role) VALUES ('FaceRef Test', 'character')`).run().lastInsertRowid;

  const res = await realFetch(`${baseUrl}/api/characters/${charId}/face-ref`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_base64: TINY_PNG_B64, mime: 'image/png' }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.reference_image_path, 'reference_image_path should be set');
  assert.match(json.reference_image_path, /characters\/.*\/reference\.png/);

  const absPath = path.join(DIRS.images, json.reference_image_path.split('/').join(path.sep));
  assert.ok(fs.existsSync(absPath), 'the reference file should exist on disk');

  const b64 = readFaceRefBase64(json);
  assert.ok(b64 && b64.length > 0, 'readFaceRefBase64 should read the saved file back');
});

test('POST /api/characters/:id/face-ref accepts a data: URL prefix', async () => {
  const charId = db.prepare(`INSERT INTO characters (name, role) VALUES ('FaceRef DataUrl', 'character')`).run().lastInsertRowid;
  const res = await realFetch(`${baseUrl}/api/characters/${charId}/face-ref`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_base64: 'data:image/png;base64,' + TINY_PNG_B64, mime: 'image/png' }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.reference_image_path);
});

test('POST /api/characters/:id/face-ref 400s on missing image_base64, 404s on missing character', async () => {
  const charId = db.prepare(`INSERT INTO characters (name, role) VALUES ('FaceRef Missing', 'character')`).run().lastInsertRowid;
  const missingBody = await realFetch(`${baseUrl}/api/characters/${charId}/face-ref`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(missingBody.status, 400);

  const missingChar = await realFetch(`${baseUrl}/api/characters/999999/face-ref`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_base64: TINY_PNG_B64 }),
  });
  assert.equal(missingChar.status, 404);
});

test('DELETE /api/characters/:id/face-ref clears the DB path but leaves the file on disk', async () => {
  const charId = db.prepare(`INSERT INTO characters (name, role) VALUES ('FaceRef Delete', 'character')`).run().lastInsertRowid;
  await realFetch(`${baseUrl}/api/characters/${charId}/face-ref`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_base64: TINY_PNG_B64, mime: 'image/png' }),
  });
  const before = db.prepare('SELECT reference_image_path FROM characters WHERE id = ?').get(charId);
  const absPath = path.join(DIRS.images, before.reference_image_path.split('/').join(path.sep));
  assert.ok(fs.existsSync(absPath));

  const del = await realFetch(`${baseUrl}/api/characters/${charId}/face-ref`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const after = db.prepare('SELECT reference_image_path FROM characters WHERE id = ?').get(charId);
  assert.equal(after.reference_image_path, null);
  assert.ok(fs.existsSync(absPath), 'file must not be deleted from disk');
});
