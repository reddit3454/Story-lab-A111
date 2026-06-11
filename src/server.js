import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { join } from 'path';
import db from './db.js';
import { PUBLIC_DIR } from './paths.js';
import broadcast from './broadcast.js';
import { log } from './logger.js';
import healthRouter     from './routes/health.js';
import configRouter     from './routes/config.js';
import profilesRouter   from './routes/profiles.js';
import scenariosRouter  from './routes/scenarios.js';
import turnsRouter      from './routes/turns.js';
import charactersRouter from './routes/characters.js';
import locationsRouter  from './routes/locations.js';
import memoriesRouter   from './routes/memories.js';
import worldRouter      from './routes/world.js';
import rulesRouter      from './routes/rules.js';

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

/* ── Phase 2 routes ──────────────────────────────────────────────────── */

app.use('/api/health',   healthRouter);
app.use('/api/config',   configRouter);
app.use('/api/profiles', profilesRouter);

/* ── Phase 3 scenario routes ─────────────────────────────────────────── */

// Top-level scenarios CRUD — must be registered before nested sub-routers
app.use('/api/scenarios', scenariosRouter);

// Nested sub-routers (mergeParams: true on each so :scenarioId is accessible)
app.use('/api/scenarios/:scenarioId/turns',      turnsRouter);
app.use('/api/scenarios/:scenarioId/characters', charactersRouter);
app.use('/api/scenarios/:scenarioId/locations',  locationsRouter);
app.use('/api/scenarios/:scenarioId/memories',   memoriesRouter);
app.use('/api/scenarios/:scenarioId/world',      worldRouter);
app.use('/api/scenarios/:scenarioId/rules',      rulesRouter);

/* ── SPA fallback ────────────────────────────────────────────────────── */

app.get('*', function (req, res) {
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

/* ── Start ───────────────────────────────────────────────────────────── */

server.listen(PORT, function () {
  log('server', 'started', { port: Number(PORT) });
});
