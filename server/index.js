import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { Game } from './game.js';
import { createStatsStore } from './storage.js';
import { MAX_PLAYERS } from '../shared/world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = '1.0.0';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

export async function createGameServer({ port = Number(process.env.PORT || 3400), host = '0.0.0.0', dataDir = process.env.DATA_DIR || path.join(ROOT, 'data') } = {}) {
  const store = createStatsStore(path.resolve(dataDir));
  const sessions = new Map();
  const sockets = new Set();
  let closing = false;
  let timer = null;
  let heartbeat = null;
  let game;
  const send = (socket, message) => { if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256 * 1024) socket.send(JSON.stringify(message)); };
  const broadcast = message => { for (const socket of sockets) if (socket.playerId) send(socket, message); };
  game = new Game({ stats: await store.read(), onEvent: event => broadcast({ type: 'event', event }), onStats: stats => store.write(stats).catch(error => console.error('Statistics save failed:', error.message)) });

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return json(res, 405, { error: 'Method not allowed' }); }
    let pathname;
    try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); } catch { return json(res, 400, { error: 'Malformed URL' }); }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..' || part === '.') || pathname.includes('%')) return json(res, 400, { error: 'Invalid path' });
    if (pathname === '/health') return json(res, 200, { ok: true, game: 'Skywake Isles', players: game.onlineCount, phase: game.phase, version: VERSION });
    let file;
    if (pathname === '/vendor/three.module.js' || pathname === '/vendor/three.core.js') file = path.join(ROOT, 'node_modules/three/build', path.basename(pathname));
    else if (pathname.startsWith('/vendor/')) return json(res, 404, { error: 'Not found' });
    else if (pathname.startsWith('/shared/')) file = path.join(ROOT, 'shared', pathname.slice(8));
    else if (pathname === '/favicon.svg') file = path.join(ROOT, 'client', 'favicon.svg');
    else file = path.join(ROOT, 'client', pathname === '/' ? 'index.html' : pathname.slice(1));
    // Only web assets are exposed; server files, saves, package metadata stay private.
    const type = MIME[path.extname(file)];
    if (!type || pathname.split('/').some(part => part.startsWith('.'))) return json(res, 404, { error: 'Not found' });
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) { json(res, error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500, { error: 'Asset not available' }); }
  });

  const wss = new WebSocketServer({ server, maxPayload: 2048, perMessageDeflate: false });
  wss.on('connection', socket => {
    if (closing) return socket.close(1012, 'Server restarting');
    sockets.add(socket);
    socket.playerId = null; socket.alive = true; socket.joinDeadline = Date.now() + 15000;
    socket.rate = { start: Date.now(), packets: 0, actions: 0 };
    send(socket, { type: 'hello', game: 'Skywake Isles', version: VERSION, maxPlayers: MAX_PLAYERS });
    const error = (message, code = 'BAD_REQUEST') => send(socket, { type: 'error', message, code });
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (raw, binary) => {
      if (binary) return error('Send text messages only.');
      const now = Date.now();
      if (now - socket.rate.start >= 1000) socket.rate = { start: now, packets: 0, actions: 0 };
      if (++socket.rate.packets > 140) { error('Too many messages. Please reconnect.', 'RATE_LIMIT'); return socket.close(1008, 'Rate limit'); }
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return error('Message is not valid JSON.'); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return error('Invalid message.');
      if (msg.type === 'join') {
        if (socket.playerId) return error('Already aboard.', 'ALREADY_JOINED');
        const token = typeof msg.token === 'string' && msg.token.length <= 96 ? msg.token : null;
        let session = token ? sessions.get(token) : null;
        if (session && !game.players.has(session.id)) { sessions.delete(token); session = null; }
        if (game.onlineCount >= MAX_PLAYERS && !session?.socket?.playerId) { error('This crew already has five pirates. Try again when a place opens.', 'CREW_FULL'); return socket.close(4003, 'Crew is full'); }
        let player;
        if (session) {
          player = game.reconnect(session.id);
          if (!player) { error('This crew already has five pirates.', 'CREW_FULL'); return socket.close(4003, 'Crew is full'); }
          const old = session.socket;
          if (old && old !== socket) { old.playerId = null; old.close(4001, 'Reconnected in another connection'); }
          session.socket = socket;
        } else {
          const id = randomUUID();
          player = game.addPlayer(id, msg.name, msg.color);
          if (!player) { error('This crew already has five pirates.', 'CREW_FULL'); return socket.close(4003, 'Crew is full'); }
          session = { id, token: randomBytes(24).toString('hex'), socket };
          sessions.set(session.token, session);
        }
        socket.playerId = player.id; socket.sessionToken = session.token;
        send(socket, { type: 'welcome', id: player.id, token: session.token, state: game.snapshot() });
        broadcast({ type: 'snapshot', state: game.snapshot() });
        return;
      }
      if (!socket.playerId) return error('Join the crew first.', 'NOT_JOINED');
      if (msg.type === 'leave') {
        game.disconnect(socket.playerId, true); sessions.delete(socket.sessionToken);
        socket.playerId = null; socket.close(1000, 'Left the crew'); return;
      }
      let result;
      if (msg.type === 'input') result = game.setInput(socket.playerId, msg);
      else if (msg.type === 'action') {
        if (++socket.rate.actions > 35) return error('Give that action a moment.', 'RATE_LIMIT');
        result = game.action(socket.playerId, msg.action, msg.target);
      } else return error('Unknown message type.');
      if (!result.ok) error(result.message, result.code);
    });
    socket.on('close', () => {
      sockets.delete(socket);
      if (socket.playerId) {
        const session = sessions.get(socket.sessionToken);
        if (session?.socket === socket) { session.socket = null; game.disconnect(socket.playerId); }
      }
    });
  });

  let last = performance.now(), accumulator = 0;
  timer = setInterval(() => {
    const now = performance.now(); accumulator += Math.min(0.25, (now - last) / 1000); last = now;
    let stepped = false;
    while (accumulator >= 0.05) { game.tick(0.05); accumulator -= 0.05; stepped = true; }
    if (stepped) broadcast({ type: 'snapshot', state: game.snapshot() });
  }, 25);
  heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!socket.alive || (!socket.playerId && Date.now() > socket.joinDeadline)) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
    for (const [token, session] of sessions) if (!game.players.has(session.id)) sessions.delete(token);
  }, 15000);

  const close = async () => {
    if (closing) return;
    closing = true; clearInterval(timer); clearInterval(heartbeat);
    for (const socket of sockets) socket.close(1001, 'The island is restarting. Rejoin soon!');
    const forced = setTimeout(() => { for (const socket of sockets) socket.terminate(); }, 250);
    await new Promise(resolve => wss.close(resolve)); clearTimeout(forced);
    await new Promise(resolve => server.close(resolve));
    await store.write(game.stats); await store.flush();
  };

  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
  } catch (error) { clearInterval(timer); clearInterval(heartbeat); wss.close(); throw error; }
  return { server, wss, game, close, port: server.address().port, address: server.address() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = await createGameServer();
  console.log(`Skywake Isles ${VERSION} sailing at http://0.0.0.0:${instance.port}`);
  const shutdown = async () => { await instance.close(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
