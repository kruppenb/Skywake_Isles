import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { DIVE_ENTRANCE } from '../shared/underwater.js';
import { heightAt } from '../shared/world.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const value = predicate(); if (value) return value; await pause(25); }
  assert.fail(`Timed out waiting for ${label}`);
}
class Client {
  constructor(url, name) {
    this.socket = new WebSocket(url); this.id = null; this.state = null; this.seq = 0;
    this.socket.on('open', () => this.send({ type: 'join', name, color: '#79c' }));
    this.socket.on('message', raw => { const message = JSON.parse(raw); if (message.type === 'welcome') { this.id = message.id; this.state = message.state; } if (message.type === 'snapshot') this.state = message.state; });
  }
  send(message) { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  action(target) { this.send({ type: 'action', action: 'interact', target }); }
  input(values = {}) { this.send({ type: 'input', seq: this.seq++, forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, dive: false, sprint: false, ...values }); }
  player() { return this.state?.players.find(player => player.id === this.id); }
  close() { this.socket.close(); }
}

test('two network swimmers share the flooded manor and a late join sees its cache and discovery state', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'skywake-manor-'));
  let server; const clients = [];
  try {
    server = await createGameServer({ port: 0, host: '127.0.0.1', dataDir });
    const url = `ws://127.0.0.1:${server.port}`;
    const a = new Client(url, 'A'), b = new Client(url, 'B'); clients.push(a, b);
    await until(() => a.id && b.id, 'two joins');
    server.game.phase = 'voyage';
    for (const client of [a, b]) Object.assign(server.game.players.get(client.id), { x: DIVE_ENTRANCE.x, y: heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z), z: DIVE_ENTRANCE.z, realm: 'island', mode: 'ground', grounded: true });
    a.action(DIVE_ENTRANCE.id); b.action(DIVE_ENTRANCE.id);
    await until(() => a.player()?.realm === 'reef' && b.player()?.realm === 'reef', 'both swimmers dive');
    Object.assign(server.game.players.get(a.id), { x: 42, y: 2.1, z: -44 });
    Object.assign(server.game.players.get(b.id), { x: 42, y: 8.5, z: -44 });
    a.input({ jump: true }); b.input({ jump: true });
    await until(() => a.player()?.y > 2.2 && b.player()?.y > 8.6, 'both clients swim up the same atrium');
    assert.equal(a.player().mode, 'swimming'); assert.equal(b.player().mode, 'swimming');
    Object.assign(server.game.players.get(a.id), { x: 42, y: 14.9, z: -44 });
    await until(() => a.state?.underwater?.discoveries?.includes('manor-chandelier'), 'shared chandelier discovery');
    Object.assign(server.game.players.get(a.id), { x: 50, y: 14.9, z: -37 });
    a.input(); a.action('manor-gallery-cache');
    await until(() => a.state?.underwater?.caches?.some(cache => cache.id === 'manor-gallery-cache' && cache.opened), 'gallery cache opens authoritatively');
    const late = new Client(url, 'Late'); clients.push(late);
    await until(() => late.id && late.state?.underwater?.caches?.some(cache => cache.id === 'manor-gallery-cache' && cache.opened), 'late join receives shared manor cache');
    assert.ok(late.state.underwater.discoveries.includes('manor-chandelier'));
    assert.ok(late.state.players.some(player => player.id === b.id && player.realm === 'reef'));
  } finally {
    for (const client of clients) client.close();
    if (server) await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
