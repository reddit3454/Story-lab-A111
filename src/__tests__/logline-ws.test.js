// Regression test for the log window WS contract. play.js's WS handler must unwrap
// `data.payload || data` before handing the entry to debug-console.js's push() --
// the previous bug pushed the raw { type, payload, ts } envelope, leaving
// entry.cat / entry.msg undefined and rendering blank lines in the panel.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'story-lab-logline-ws-'));
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

mock.module('../paths.js', {
  namedExports: {
    ROOT_DIR: ROOT, PUBLIC_DIR: path.join(ROOT, 'public'),
    DATA_DIR, IMAGES_DIR: path.join(ROOT, 'images'),
    BACKGROUNDS_DIR: path.join(ROOT, 'backgrounds'), AUDIO_DIR: path.join(ROOT, 'audio'),
    DB_PATH: ':memory:', AUDIT_LOG_PATH: path.join(DATA_DIR, 'audit.jsonl'),
  },
});

const { WebSocketServer, WebSocket } = await import('ws');
const { default: broadcast } = await import('../broadcast.js');
const { log } = await import('../logger.js');

const server = http.createServer();
const wss = new WebSocketServer({ server, path: '/ws' });
broadcast.init(wss);
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

test.after(() => new Promise((resolve) => { wss.close(); server.close(resolve); }));

test('logger.log() broadcasts a logline event shaped for the client debug console', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for logline event')), 2000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'logline') { clearTimeout(timer); resolve(msg); }
    });
  });

  log('debug', 'test-log', { note: 'smoke test' });

  const msg = await received;
  ws.close();

  assert.equal(msg.type, 'logline');
  // cat/msg/ts live under payload -- this is what play.js must unwrap via
  // `data.payload || data` before calling _debugConsole.push().
  assert.equal(typeof msg.payload, 'object');
  assert.equal(typeof msg.payload.cat, 'string');
  assert.match(msg.payload.msg, /test-log/);
  assert.equal(typeof msg.payload.ts, 'string');
});
