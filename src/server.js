import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { join } from 'path';
import db from './db.js';
import { PUBLIC_DIR } from './paths.js';
import broadcast from './broadcast.js';
import { log } from './logger.js';

const PORT = process.env.PORT || 4090;

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

broadcast.init(wss);

wss.on('connection', function (ws, req) {
  log('server', 'ws_connected', { ip: req.socket.remoteAddress });
  ws.on('close', function () {
    log('server', 'ws_disconnected', { ip: req.socket.remoteAddress });
  });
});

/* ── Health ─────────────────────────────────────────────────────────── */

app.get('/api/health', function (req, res) {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/health/a1111', function (req, res) {
  res.json({ ok: false, message: 'not implemented' });
});

/* ── Global config ───────────────────────────────────────────────────── */

app.get('/api/config', function (req, res) {
  const rows = db.prepare('SELECT key, value FROM global_config').all();
  const config = {};
  for (const r of rows) config[r.key] = r.value;
  res.json(config);
});

app.post('/api/config', function (req, res) {
  const { key, value } = req.body;
  db.prepare(
    "INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  ).run(key, String(value ?? ''));
  res.json({ ok: true });
});

app.post('/api/config/batch', function (req, res) {
  const { configs } = req.body;
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO global_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  );
  for (const c of (configs || [])) stmt.run(c.key, String(c.value ?? ''));
  res.json({ ok: true });
});

/* ── Stub list routes ────────────────────────────────────────────────── */

app.get('/api/scenarios', function (req, res) { res.json([]); });
app.get('/api/profiles',  function (req, res) { res.json([]); });

/* ── SPA fallback ────────────────────────────────────────────────────── */

app.get('*', function (req, res) {
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

/* ── Start ───────────────────────────────────────────────────────────── */

server.listen(PORT, function () {
  log('server', 'started', { port: Number(PORT) });
});
