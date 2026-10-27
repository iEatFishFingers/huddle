// Dev-only host for testing in a browser/desktop. On phones the host role will
// run this same protocol from inside the app (see README).
// Usage: npm run host -- [folder-with-audio]   (default ./music)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_PEERS = 4;
const dir = path.resolve(process.argv[2] ?? 'music');
fs.mkdirSync(dir, { recursive: true });

const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
const listTracks = (host) =>
  fs
    .readdirSync(dir)
    .filter((f) => MIME[path.extname(f).toLowerCase()])
    .map((f) => ({ id: f, title: path.basename(f, path.extname(f)), url: `http://${host}/audio/${encodeURIComponent(f)}` }));

let state = { trackId: null, playing: false, positionMs: 0, updatedAt: Date.now() };

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/audio/')) {
    res.writeHead(404).end();
    return;
  }
  const file = path.join(dir, path.basename(decodeURIComponent(url.pathname.slice(7))));
  if (!fs.existsSync(file)) return void res.writeHead(404).end();
  const { size } = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    fs.createReadStream(file).pipe(res);
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
const readyFor = new Map(); // ws -> trackId it has fully downloaded
const send = (c, msg) => c.readyState === 1 && c.send(JSON.stringify(msg));
const broadcast = (msg) => wss.clients.forEach((c) => send(c, msg));
const readyCount = () => [...wss.clients].filter((c) => state.trackId && readyFor.get(c) === state.trackId).length;
const broadcastReadiness = () => broadcast({ type: 'readiness', trackId: state.trackId, ready: readyCount(), total: wss.clients.size });

wss.on('connection', (ws, req) => {
  if (wss.clients.size > MAX_PEERS) return ws.close(1013, 'session full');
  const host = req.headers.host;
  send(ws, { type: 'welcome', peers: wss.clients.size, tracks: listTracks(host), state, ready: readyCount() });
  broadcast({ type: 'peers', peers: wss.clients.size });
  broadcastReadiness();

  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    const now = Date.now();
    if (m.type === 'ping') return send(ws, { type: 'pong', t0: m.t0, t1: now });
    if (m.type === 'ready') {
      if (m.trackId === state.trackId) readyFor.set(ws, m.trackId);
      return broadcastReadiness();
    }
    if (m.type !== 'control') return;
    const pos = state.playing ? state.positionMs + (now - state.updatedAt) : state.positionMs;
    if (m.action === 'play') {
      if (!state.trackId || readyCount() < wss.clients.size) return;
      state = { ...state, playing: true, positionMs: pos, updatedAt: now };
    }
    if (m.action === 'pause') state = { ...state, playing: false, positionMs: pos, updatedAt: now };
    if (m.action === 'seek') state = { ...state, positionMs: m.positionMs, updatedAt: now };
    if (m.action === 'select') {
      readyFor.clear();
      state = { trackId: m.trackId, playing: false, positionMs: 0, updatedAt: now };
    }
    broadcast({ type: 'state', state });
    if (m.action === 'select') broadcastReadiness();
  });
  ws.on('close', () => {
    readyFor.delete(ws);
    broadcast({ type: 'peers', peers: wss.clients.size });
    broadcastReadiness();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Serving ${dir}\nJoin with: ${ips.join(' or ')} (port ${PORT})`);
});
