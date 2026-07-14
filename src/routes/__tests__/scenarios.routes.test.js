// Route-level regression test: append_start/append_middle/append_end must be
// persisted through the generic SCENARIO_FIELDS whitelist in routes/scenarios.js,
// and must default to '' on creation (see src/db.js migration).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-scenroute-'));
const DIRS = { data: path.join(ROOT, 'data'), images: path.join(ROOT, 'images') };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

mock.module('../../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR: DIRS.data, IMAGES_DIR: DIRS.images,
    BACKGROUNDS_DIR: path.join(ROOT, 'backgrounds'), AUDIO_DIR: path.join(ROOT, 'audio'),
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DIRS.data, 'audit.jsonl'),
  },
});

const { default: db } = await import('../../db.js');
const { default: express } = await import('express');
const { default: scenariosRouter } = await import('../scenarios.js');

const app = express();
app.use(express.json());
app.use('/api/scenarios', scenariosRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test('scenario defaults append fields to empty string on creation', async () => {
  const res = await fetch(`${baseUrl}/api/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Fresh Scenario' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.append_start, '');
  assert.equal(body.append_middle, '');
  assert.equal(body.append_end, '');
});

test('PUT /api/scenarios/:id persists append_start/append_middle/append_end', async () => {
  const scenarioId = db.prepare(`INSERT INTO scenarios (title) VALUES ('Append Route Test')`).run().lastInsertRowid;

  const res = await fetch(`${baseUrl}/api/scenarios/${scenarioId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      append_start: 'sepia tone',
      append_middle: 'freckles',
      append_end: 'polaroid border',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.append_start, 'sepia tone');
  assert.equal(body.append_middle, 'freckles');
  assert.equal(body.append_end, 'polaroid border');

  const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  assert.equal(row.append_start, 'sepia tone');
  assert.equal(row.append_middle, 'freckles');
  assert.equal(row.append_end, 'polaroid border');
});
