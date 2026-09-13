import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { DIVE_ENTRANCE, REEF_CHEST, REEF_EXIT } from '../shared/underwater.js';
import { heightAt } from '../shared/world.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const value = predicate(); if (value) return value; await pause(25); }
  assert.fail(`Timed out waiting for ${label}`);
}
class Client {
  constructor(url, name, token = null) {
    this.socket = new WebSocket(url); this.id = null; this.token = token; this.seq = 0; this.state = null; this.events = [];
    this.socket.on('open', () => this.send({ type: 'join', name, color: '#f00', ...(token ? { token } : {}) }));
    this.socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'welcome') { this.id = message.id; this.token = message.token; this.state = message.state; }
      if (message.type === 'snapshot') this.state = message.state;
      if (message.type === 'event') this.events.push(message.event);
    });
  }
  send(value) { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }
  action(action, target) { this.send({ type: 'action', action, target }); }
  input(values = {}) { this.send({ type: 'input', seq: this.seq++, forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, dive: false, sprint: false, ...values }); }
  player() { return this.state?.players.find(player => player.id === this.id); }
  close() { this.socket.close(); }
}

test('two sockets split realms, swim, reconnect, and share one reef chest', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'skywake-underwater-'));
  let server; const clients = [];
  try {
    server = await createGameServer({ port: 0, host: '127.0.0.1', dataDir });
    const url = `ws://127.0.0.1:${server.port}`;
    const a = new Client(url, 'A'), b = new Client(url, 'B'); clients.push(a, b);
    await until(() => a.id && b.id, 'two joins');
    server.game.phase = 'voyage';
    for (const client of [a, b]) Object.assign(server.game.players.get(client.id), {
      x: DIVE_ENTRANCE.x, y: heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z), z: DIVE_ENTRANCE.z, realm: 'island', mode: 'ground', grounded: true,
    });
    a.action('interact', DIVE_ENTRANCE.id);
    await until(() => a.player()?.realm === 'reef' && b.player()?.realm === 'island', 'split realms after server-validated E');
    assert.equal(a.state.underwater.remaining, 3);
    a.input({ jump: true, sprint: true });
    const startY = a.player().y;
    await until(() => a.player().y > startY, 'authoritative 3D swim input');
    const beforeLookSwim = { ...a.player() };
    a.input({ forward: 1, yaw: Math.PI / 2, pitch: .6 });
    await until(() => a.player().y > beforeLookSwim.y + .2 && a.player().x < beforeLookSwim.x - .2,
      'forward input swims up along the networked look direction without jump or dive');
    a.input();
    const token = a.token; a.close();
    await until(() => server.game.players.get(a.id)?.online === false, 'reef disconnect');
    const rejoined = new Client(url, 'ignored', token); clients.push(rejoined);
    await until(() => rejoined.id === a.id && rejoined.player()?.realm === 'reef', 'reef reconnect');
    // Put each finite guard in a short deterministic firing lane, then clear
    // it through real input/action packets rather than a server-side kill.
    for (const guard of [...server.game.enemies.values()].filter(enemy => enemy.realm === 'reef')) {
      Object.assign(server.game.players.get(rejoined.id), { x: 0, y: 8, z: 10, yaw: 0, pitch: 0 });
      Object.assign(guard, { x: 0, y: 8, z: 3, hp: 20 });
      rejoined.input({ yaw: 0, pitch: 0 }); rejoined.action('fire');
      await until(() => !server.game.enemies.has(guard.id), `reef guard ${guard.id} defeated by packet fire`);
      await pause(450);
    }
    Object.assign(server.game.players.get(rejoined.id), { x: REEF_CHEST.x, y: REEF_CHEST.y, z: REEF_CHEST.z });
    rejoined.action('interact', REEF_CHEST.id);
    await until(() => rejoined.state?.underwater.chestOpened, 'shared chest action');
    b.action('interact', DIVE_ENTRANCE.id);
    await until(() => b.player()?.realm === 'reef', 'second socket dives');
    Object.assign(server.game.players.get(b.id), { x: REEF_CHEST.x, y: REEF_CHEST.y, z: REEF_CHEST.z });
    b.action('interact', REEF_CHEST.id);
    await pause(100);
    assert.equal(rejoined.state.drops.filter(drop => drop.realm === 'reef').length, 1);
    assert.equal(rejoined.events.filter(event => event.kind === 'chest' && event.id === REEF_CHEST.id).length, 1);
    Object.assign(server.game.players.get(rejoined.id), { x: REEF_EXIT.x, y: REEF_EXIT.y, z: REEF_EXIT.z });
    rejoined.action('interact', REEF_EXIT.id);
    await until(() => rejoined.player()?.realm === 'island' && rejoined.player()?.mode === 'ground', 'server-validated return');
  } finally {
    for (const client of clients) client.close();
    if (server) await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
