import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { join } from 'path';
import db from './db.js';
import { PUBLIC_DIR } from './paths.js';
import broadcast from './broadcast.js';
import { log } from './logger.js';
import healthRouter   from './routes/health.js';
import configRouter   from './routes/config.js';
import profilesRouter from './routes/profiles.js';

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

/* ── API routes ──────────────────────────────────────────────────────── */

app.use('/api/health',   healthRouter);
app.use('/api/config',   configRouter);
app.use('/api/profiles', profilesRouter);

/* ── Remaining stubs (replaced in Phase 4) ──────────────────────────── */

app.get('/api/scenarios', function (req, res) { res.json([]); });

/* ── SPA fallback ────────────────────────────────────────────────────── */

app.get('*', function (req, res) {
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

/* ── Start ───────────────────────────────────────────────────────────── */

server.listen(PORT, function () {
  log('server', 'started', { port: Number(PORT) });
});
