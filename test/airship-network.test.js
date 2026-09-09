import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { shipAt, SHIP_DURATION } from '../shared/world.js';
import { SHIP_GUNS, AIRSHIP_RETURNS, GUN_PIVOT_HEIGHT, gunAim, gunOperator } from '../shared/airship.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = predicate(); if (result) return result;
    await pause(40);
  }
  assert.fail(`Timed out: ${label}`);
}
class CrewSocket {
  constructor(url, name, token) {
    this.socket = new WebSocket(url); this.events = []; this.errors = []; this.seq = 0;
    this.socket.on('open', () => this.send({ type: 'join', name, ...(token ? { token } : {}) }));
    this.socket.on('error', error => this.errors.push({ code: 'SOCKET_ERROR', message: error.message }));
    this.socket.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'welcome') { this.id = msg.id; this.token = msg.token; this.state = msg.state; }
      else if (msg.type === 'snapshot') this.state = msg.state;
      else if (msg.type === 'event') this.events.push(msg.event);
      else if (msg.type === 'error') this.errors.push(msg);
    });
  }
  send(message) { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  action(action, target) { this.send({ type: 'action', action, ...(target ? { target } : {}) }); }
  input(fields = {}) { this.send({ type: 'input', seq: this.seq++, forward: 0, right: 0, yaw: this.player?.yaw ?? 0, pitch: this.player?.pitch ?? 0, jump: false, sprint: true, ...fields }); }
  get player() { return this.state?.players.find(player => player.id === this.id); }
  close() { this.socket.close(); }
}

async function walk(bot, point, aboard = true, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = bot.player, dx = point.x - (aboard ? p.deckX : p.x), dz = point.z - (aboard ? p.deckZ : p.z), d = Math.hypot(dx, dz);
    if (d < 0.3 && (aboard || p.mode === 'ground')) { bot.input(); return; }
    bot.input({ yaw: 0, pitch: 0, right: d > 0.15 ? dx / d * Math.min(d / 0.7, 1) : 0,
      forward: d > 0.15 ? -dz / d * Math.min(d / 0.7, 1) : 0 });
    await pause(50);
  }
  assert.fail(`Walk failed: ${JSON.stringify({ point, player: bot.player, errors: bot.errors })}`);
}
function firingSolution(bot, preferredId) {
  const gun = SHIP_GUNS.find(gun => gun.id === bot.player.gunId), ship = shipAt(bot.state.elapsed);
  const targets = [...bot.state.flyingTargets].sort((a, b) => (a.id === preferredId ? -1 : 0) - (b.id === preferredId ? -1 : 0));
  for (const target of targets) {
    const dx = target.x - ship.x - gun.x, dz = target.z - ship.z - gun.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(target.y - ship.y - GUN_PIVOT_HEIGHT, Math.hypot(dx, dz)), aim = gunAim(gun, yaw, pitch);
    if (Math.abs(Math.atan2(Math.sin(aim.yaw - yaw), Math.cos(aim.yaw - yaw))) < 0.1 && Math.abs(aim.pitch - pitch) < 0.01) return { target, yaw, pitch };
  }
  assert.fail('No visible target inside gun arc');
}

test('two public WebSocket crew share guns and flying target combat, dismount, reconnect and ride the beach lift', { timeout: 65000 }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'skywake-airship-'));
  const sockets = []; let server;
  const open = async (url, name, token) => {
    const bot = new CrewSocket(url, name, token); sockets.push(bot);
    await until(() => bot.id, 'crew join'); return bot;
  };
  try {
    server = await createGameServer({ port: 0, host: '127.0.0.1', dataDir });
    const url = `ws://127.0.0.1:${server.port}`;
    const captain = await open(url, 'Gunner'), other = await open(url, 'Wing spotter');
    captain.action('launch'); await until(() => captain.state.phase === 'voyage' && other.state.phase === 'voyage', 'launch');
    const port = SHIP_GUNS[2], starboard = SHIP_GUNS[3];
    await Promise.all([walk(captain, gunOperator(port)), walk(other, gunOperator(port))]);
    captain.action('interact', port.id); await until(() => captain.player.gunId === port.id, 'port gun mounted');
    other.action('interact', port.id); await until(() => other.errors.some(error => error.code === 'GUN_OCCUPIED'), 'exclusive gun occupancy');
    await walk(other, gunOperator(starboard)); other.action('interact', starboard.id);
    await until(() => other.player.gunId === starboard.id && captain.state.shipGuns.filter(gun => gun.occupantId).length === 2, 'two different guns mounted');
    assert.equal(captain.state.flyingTargets.length, 8); assert.equal(other.state.flyingTargets.length, 8);
    const initialAmmo = [captain.player.ammo, other.player.ammo];
    const solutions = [captain, other].map(bot => firingSolution(bot));
    for (const [index, bot] of [captain, other].entries()) {
      const { yaw, pitch } = solutions[index]; bot.input({ yaw, pitch }); bot.action('fire');
    }
    await until(() => [captain, other].every(bot => bot.events.filter(event => event.kind === 'shot' && event.weapon === 'cannon' && event.hitId).length === 2), 'both cannon hits synchronized');
    const hitShots = captain.events.filter(event => event.kind === 'shot' && event.weapon === 'cannon');
    assert.deepEqual(other.events.filter(event => event.kind === 'shot' && event.weapon === 'cannon'), hitShots);
    assert.equal(new Set(hitShots.map(shot => shot.playerId)).size, 2);
    await until(() => [captain, other].every(bot => solutions.every(solution => bot.state.flyingTargets.find(target => target.id === solution.target.id)?.hp === 40)), 'target HP synchronized');
    assert.deepEqual([captain.player.ammo, other.player.ammo], initialAmmo);
    assert.equal(captain.state.pearls, 0); assert.ok(captain.state.players.every(player => player.kills === 0));
    // A repeat packet immediately after firing cannot consume a second shot.
    captain.action('fire'); await pause(120);
    assert.equal(captain.events.filter(event => event.kind === 'shot' && event.playerId === captain.id).length, 1);
    await until(() => captain.state.elapsed >= captain.state.shipGuns.find(gun => gun.id === port.id).readyAt, 'cannon cooldown');
    const solution = firingSolution(captain, solutions[0].target.id);
    captain.input({ yaw: solution.yaw, pitch: solution.pitch }); captain.action('fire');
    await until(() => [captain, other].every(bot => bot.events.some(event => event.kind === 'target-down' && event.id === solution.target.id)), 'target defeat synchronized');
    await until(() => !captain.state.flyingTargets.some(target => target.id === solution.target.id), 'defeated crab hidden');

    const occupiedAtDisconnect = other.player.gunId; other.close();
    await until(() => captain.state.shipGuns.find(gun => gun.id === occupiedAtDisconnect).occupantId === null, 'disconnect releases gun');
    const rejoined = await open(url, 'Ignored reconnect name', other.token);
    assert.equal(rejoined.id, other.id); assert.equal(rejoined.player.gunId, null); assert.equal(rejoined.player.shipReturned, true);
    rejoined.action('interact', starboard.id); await until(() => rejoined.player.gunId === starboard.id, 'reconnected crew remounts');

    captain.input({ jump: true }); await until(() => captain.player.gunId === null && captain.player.mode === 'aboard', 'Space dismount');
    assert.equal(captain.state.shipGuns.find(gun => gun.id === port.id).occupantId, null);
    captain.input({ jump: false }); await pause(90); captain.input({ jump: true });
    await until(() => captain.player.mode === 'gliding', 'second Space glides');
    captain.action('interact', AIRSHIP_RETURNS[0].id);
    await until(() => captain.errors.some(error => error.code === 'TOO_FAR'), 'airborne return denied');
    await walk(captain, AIRSHIP_RETURNS[0], false, 16000);
    captain.action('interact', AIRSHIP_RETURNS[0].id);
    await until(() => captain.player.mode === 'aboard' && captain.player.shipReturned && captain.player.deckX === 0 && captain.player.deckZ === 0, 'beach lift returns pirate');
    await until(() => captain.state.elapsed > SHIP_DURATION + 0.5, 'ship parks after opening flight', 32000);
    assert.equal(captain.player.mode, 'aboard'); assert.equal(rejoined.player.gunId, starboard.id);
    await until(() => captain.state.flyingTargets.some(target => target.id === solution.target.id && target.hp === 80), 'target respawns');
    rejoined.action('interact', starboard.id); await until(() => !rejoined.player.gunId, 'E dismount after flight');
    await pause(150); assert.equal(rejoined.player.mode, 'aboard');
    assert.ok(!sockets.some(bot => bot.errors.some(error => error.code === 'RATE_LIMIT' || error.code === 'SOCKET_ERROR')));
  } finally {
    for (const bot of sockets) bot.close();
    if (server) await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
