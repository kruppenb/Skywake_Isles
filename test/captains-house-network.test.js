import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { CAPTAINS_HOUSE } from '../shared/captains-house.js';
import { heightAt } from '../shared/world.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return; await pause(30); }
  assert.fail(`timed out waiting for ${label}`);
}
async function connect(url, name, token) {
  const socket = new WebSocket(url), client = { socket, id: null, token: null, state: null, seq: 0, errors: [] };
  socket.on('open', () => socket.send(JSON.stringify({ type: 'join', name, color: '#f4a261', ...(token ? { token } : {}) })));
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'welcome') { client.id = message.id; client.token = message.token; client.state = message.state; }
    if (message.type === 'snapshot') client.state = message.state;
    if (message.type === 'error') client.errors.push(message);
  });
  await until(() => client.id || client.errors.length, `${name} join`);
  assert.equal(client.errors.length, 0);
  return client;
}
const pose = (client, id = client.id) => client.state?.players.find(p => p.id === id);
function input(client, fields) {
  if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify({
    type: 'input', seq: client.seq++, forward: 0, right: 0, yaw: 0, pitch: 0,
    sprint: true, jump: false, ...fields,
  }));
}
async function walk(client, x, z) {
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    const p = pose(client);
    if (p && Math.hypot(x - p.x, z - p.z) < .4) { input(client, {}); return; }
    if (p) input(client, { forward: 1, yaw: Math.atan2(-(x - p.x), -(z - p.z)) });
    await pause(50);
  }
  assert.fail(`socket route to ${x},${z}: ${JSON.stringify(pose(client))}`);
}

test('two socket clients see a real stair ascent; late join and reconnect retain upper position', { timeout: 35000 }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'skywake-house-'));
  let server; const clients = [];
  try {
    server = await createGameServer({ host: '127.0.0.1', port: 0, dataDir });
    const url = `ws://127.0.0.1:${server.port}`;
    const captain = await connect(url, 'Captain'); clients.push(captain);
    const observer = await connect(url, 'Observer'); clients.push(observer);
    const live = server.game.players.get(captain.id);
    Object.assign(live, { x: -69, z: 77, y: heightAt(-69, 77), mode: 'ground', realm: 'island',
      grounded: true, vy: 0, jumpHeld: false, launchVx: 0, launchVz: 0 });
    await until(() => pose(captain)?.z > 76, 'captain house starting position');
    for (const [x, z] of [[-69, 72], [-63, 71], [-63, 59], [-63, 57.7], [-69, 57.7]]) await walk(captain, x, z);
    const upper = heightAt(CAPTAINS_HOUSE.x, CAPTAINS_HOUSE.z) + 4.6;
    await until(() => Math.abs(pose(observer, captain.id)?.y - upper) < .08, 'observer upstairs snapshot');
    assert.ok(Math.abs(pose(captain).y - upper) < .08);
    const late = await connect(url, 'Late crew'); clients.push(late);
    assert.ok(Math.abs(pose(late, captain.id).y - upper) < .08, 'late join gets upper floor');
    const token = captain.token, id = captain.id;
    captain.socket.close();
    await until(() => pose(observer, id)?.online === false, 'disconnect broadcast');
    const returned = await connect(url, 'Captain reconnect', token); clients.push(returned);
    assert.equal(returned.id, id);
    assert.ok(Math.abs(pose(returned).y - upper) < .08, 'reconnect keeps supported upper pose');
    assert.equal(returned.errors.length, 0);
  } finally {
    for (const client of clients) client.socket.terminate();
    if (server) await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
