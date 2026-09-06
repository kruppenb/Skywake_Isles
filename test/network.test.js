import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { COLORS, SPAWN, BEACON, SHRINES, CHESTS } from '../shared/world.js';
import { hasWorldLineOfSight } from '../shared/collision.js';
import { FINALE_STAGES, finaleStageRoster } from '../shared/finale.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 5000, label = 'condition', details = () => '') {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await pause(50);
  }
  assert.fail(`Timed out waiting for ${label}. ${details()}`);
}

class PirateSocket {
  constructor(url, name, color, token) {
    this.socket = new WebSocket(url); this.id = null; this.token = token; this.state = null;
    this.errors = []; this.events = []; this.seq = 0; this.closed = false;
    this.socket.on('open', () => this.send({ type: 'join', name, color, ...(token ? { token } : {}) }));
    this.socket.on('error', error => this.errors.push({ message: error.message, code: 'SOCKET_ERROR' }));
    this.socket.on('close', () => { this.closed = true; });
    this.socket.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'welcome') { this.id = msg.id; this.token = msg.token; this.state = msg.state; }
      else if (msg.type === 'snapshot') this.state = msg.state;
      else if (msg.type === 'event') this.events.push(msg.event);
      else if (msg.type === 'error') this.errors.push(msg);
    });
  }
  send(msg) { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg)); }
  action(action, target) { this.send({ type: 'action', action, ...(target ? { target } : {}) }); }
  input(fields = {}) { this.send({ type: 'input', seq: this.seq++, forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, sprint: true, ...fields }); }
  get player() { return this.state?.players.find(p => p.id === this.id); }
  async joined() { await until(() => this.id || this.errors.length, 5000, 'join'); return this; }
  close() { if (!this.closed) this.socket.close(); }
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: pathname }, res => {
      const parts = []; res.on('data', part => parts.push(part));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString(), headers: res.headers }));
    }).on('error', reject);
  });
}

test('real five-client voyage, reconnect/late join, guarded progression, victory/replay, and restart persistence', { timeout: 480000 }, async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'skywake-e2e-'));
  let server, restarted, controller;
  const allSockets = [], crew = [];
  const open = async (url, name, color, token) => {
    const bot = new PirateSocket(url, name, color, token); allSockets.push(bot); return bot.joined();
  };
  try {
    server = await createGameServer({ port: 0, host: '127.0.0.1', dataDir });
    // Only loot randomness is fixed. Movement, weapon pickups and combat still
    // travel through ordinary WebSocket controls and the real server clock.
    server.game.random = () => .99;
    const url = `ws://127.0.0.1:${server.port}`;
    const health = await request(server.port, '/health');
    assert.equal(health.status, 200); assert.equal(JSON.parse(health.body).game, 'Skywake Isles');
    for (const route of ['/shared/world.js', '/shared/movement.js', '/shared/collision.js', '/shared/weapons.js', '/shared/encounters.js', '/vendor/three.module.js', '/vendor/three.core.js', '/vendor/addons/loaders/GLTFLoader.js', '/vendor/addons/utils/BufferGeometryUtils.js']) {
      const response = await request(server.port, route); assert.equal(response.status, 200, route); assert.equal(response.headers['cache-control'], 'no-cache');
    }
    const kit = await request(server.port, '/assets/old-watch/kit.glb');
    assert.equal(kit.status, 200); assert.equal(kit.headers['content-type'], 'model/gltf-binary'); assert.equal(kit.body.slice(0, 4), 'glTF');
    for (const route of ['/shared/%2e%2e/server/game.js', '/%ZZ', '/shared/..%5cserver/game.js']) assert.equal((await request(server.port, route)).status, 400, route);
    for (const route of ['/server/game.js', '/data/stats.json', '/package.json', '/vendor/private.js', '/vendor/addons/loaders/DRACOLoader.js', '/vendor/addons/../../package.json', '/node_modules/three/package.json', '/assets/old-watch/manifest.json']) assert.equal((await request(server.port, route)).status, route.includes('/../') ? 400 : 404, route);
    for (let i = 0; i < 5; i++) crew.push(await open(url, `Crew ${i + 1}`, COLORS[i]));
    await until(() => crew.every(b => b.state?.players.filter(p => p.online).length === 5), 5000, 'five synchronized crew');
    const sixth = await open(url, 'Sixth pirate', COLORS[0]);
    assert.equal(sixth.id, null); assert.equal(sixth.errors[0].code, 'CREW_FULL');
    const originalCaptain = crew[0], originalId = originalCaptain.id, originalToken = originalCaptain.token;
    originalCaptain.close();
    await until(() => crew[1].state.hostId === crew[1].id, 5000, 'host transfer');
    crew[0] = await open(url, 'Reconnect name ignored', COLORS[4], originalToken);
    assert.equal(crew[0].id, originalId); assert.equal(crew[0].player.name, 'Crew 1');
    assert.equal(crew[0].state.hostId, crew[1].id);
    crew[0].action('launch'); await until(() => crew[0].errors.some(e => e.code === 'HOST_ONLY'), 3000, 'nonhost launch denied');
    crew[1].action('launch');
    await until(() => crew.every(b => b.state?.phase === 'voyage'), 5000, 'voyage launch');
    assert.ok(crew.every(b => b.state.enemies.length === 56));
    assert.ok(crew.every(b => b.player.rarity === 'common' && Object.keys(b.player.inventory).length === 2));

    let destination = SPAWN, formationRadius = 1.3, autoDrop = true, combat = false, tick = 0;
    const details = () => JSON.stringify(crew.map(b => ({ id: b.id, p: b.player && { x: +b.player.x.toFixed(1), z: +b.player.z.toFixed(1), mode: b.player.mode, hp: b.player.hp, down: b.player.knockedUntil }, errors: b.errors.slice(-2) })));
    // Bots observe public snapshots and issue the same controls used by the UI.
    // There is no teleport command, authority-state movement edit, or accelerated clock.
    controller = setInterval(() => {
      tick++;
      for (let i = 0; i < crew.length; i++) {
        const b = crew[i], p = b.player, state = b.state;
        if (!p || !state || b.closed || state.phase === 'lobby' || state.phase === 'victory') continue;
        const angle = i / 5 * Math.PI * 2;
        const goal = { x: destination.x + Math.cos(angle) * formationRadius, z: destination.z + Math.sin(angle) * formationRadius };
        const dx = goal.x - p.x, dz = goal.z - p.z, d = Math.hypot(dx, dz);
        const enemies = combat ? state.enemies.filter(e => Math.hypot(e.x - p.x, e.z - p.z) < 45 && hasWorldLineOfSight({ x: p.x, y: p.y + 1.25, z: p.z }, { x: e.x, y: e.y + e.radius * .8, z: e.z })) : [];
        enemies.sort((a, b) => (a.id === state.bossId ? -1000 : Math.hypot(a.x - p.x, a.z - p.z)) - (b.id === state.bossId ? -1000 : Math.hypot(b.x - p.x, b.z - p.z)));
        const enemy = enemies[0];
        const yaw = enemy ? Math.atan2(-(enemy.x - p.x), -(enemy.z - p.z)) : d > 0.2 ? Math.atan2(-dx, -dz) : p.yaw;
        const pitch = enemy ? Math.atan2(enemy.y + enemy.radius * 0.8 - p.y - 1.25, Math.hypot(enemy.x - p.x, enemy.z - p.z)) : 0;
        const mx = d > 0.8 ? dx / d : 0, mz = d > 0.8 ? dz / d : 0;
        b.input({ yaw, pitch, forward: -Math.sin(yaw) * mx - Math.cos(yaw) * mz, right: Math.cos(yaw) * mx - Math.sin(yaw) * mz, jump: autoDrop && p.mode === 'aboard' });
        if (enemy && tick % 2 === 0) b.action('fire');
        if (p.hp < 75 && !p.knockedUntil && tick % 20 === 0) b.action('heal');
        const friend = state.players.find(a => a.id !== p.id && a.knockedUntil && Math.hypot(a.x - p.x, a.z - p.z) < 3.4);
        if (friend && tick % 8 === 0) b.action('interact', friend.id);
      }
    }, 50);
    const landed = () => crew.every(b => b.player?.mode === 'ground');
    const gathered = point => landed() && crew.every(b => Math.hypot(b.player.x - point.x, b.player.z - point.z) < 3.2);
    await until(landed, 18000, 'five manual ship jumps and glide landings', details);
    assert.ok(crew.every(b => b.events.some(e => e.kind === 'phase' && e.phase === 'voyage')));
    t.diagnostic('Five pirates jumped from the flying ship and landed using ordinary movement inputs.');
    autoDrop = false;
    crew[0].socket.send('{not json');
    crew[0].send({ type: 'input', seq: 999999, forward: null, right: 0, yaw: 0, pitch: 0 });
    crew[0].action('win'); crew[0].action('interact', 'palm'); crew[0].action('interact', BEACON.id);
    await until(() => crew[0].errors.some(e => e.code === 'BAD_INPUT') && crew[0].errors.some(e => e.code === 'BAD_ACTION') && crew[0].errors.some(e => e.code === 'TOO_FAR'), 4000, 'invalid and distant actions denied');
    assert.equal(crew[0].state.shards, 0); assert.equal(crew[0].state.phase, 'voyage');
    const departing = crew[4]; departing.send({ type: 'leave' });
    await until(() => crew[1].state.players.filter(p => p.online).length === 4, 4000, 'explicit leave frees fifth place');
    crew[4] = await open(url, 'Late navigator', COLORS[4]);
    assert.notEqual(crew[4].id, departing.id); assert.equal(crew[4].player.mode, 'gliding');
    await until(landed, 10000, 'late join safely glides into existing voyage', details);
    formationRadius = 0; destination = { x: CHESTS[0].x, z: CHESTS[0].z + 2.7 };
    await until(() => landed() && crew.every(b => {
      const distance = Math.hypot(b.player.x - CHESTS[0].x, b.player.z - CHESTS[0].z);
      return distance > 2 && distance < 3.5;
    }), 10000, 'crew reaches chest interaction range outside automatic pickup range', details);
    crew[0].action('interact', CHESTS[0].id);
    await until(() => crew.every(b => b.state.chests.find(c => c.id === CHESTS[0].id).opened), 4000, 'shared chest synchronization');
    assert.ok(crew.every(b => b.state.pearls >= 12));
    const drop = crew[0].state.drops[0];
    assert.equal(drop.weapon, 'longshot'); assert.equal(drop.rarity, 'legendary');
    assert.ok(crew.every(b => b.state.drops.length === 1));
    assert.ok(crew.every(b => b.player.inventory.longshot === undefined));
    for (const b of crew) assert.deepEqual(b.state.drops[0], drop);
    const denied = crew[2].errors.filter(e => e.code === 'TOO_FAR').length;
    crew[2].action('interact', CHESTS[0].id);
    await until(() => crew[2].errors.filter(e => e.code === 'TOO_FAR').length > denied, 3000, 'opened chest cannot reroll');
    assert.ok(crew.every(b => b.events.filter(e => e.kind === 'chest' && e.id === CHESTS[0].id).length === 1));
    formationRadius = .6; destination = CHESTS[0];
    await until(() => crew.every(b => b.state.drops.length === 1 && b.state.players.every(p => p.inventory.longshot?.rarity === 'legendary')), 4000, 'walking automatically equips the same retained weapon for all five clients');
    assert.ok(crew.every(b => b.player.weapon === 'longshot' && b.player.rarity === 'legendary' && b.player.ammo === 4));
    assert.ok(crew.every(b => b.events.filter(e => e.kind === 'loot' && e.id === drop.id).length === 5));
    for (const b of crew) {
      assert.deepEqual(b.state.drops, [drop]);
      assert.equal(new Set(b.events.filter(e => e.kind === 'loot' && e.id === drop.id).map(e => e.playerId)).size, 5);
    }
    crew[2].action('interact', drop.id);
    await until(() => crew[2].errors.some(e => e.code === 'DUPLICATE_WEAPON'), 3000, 'explicit duplicate pickup cannot refill or re-equip');
    // Keep the existing flintlock voyage probe comparable after proving pickup.
    await pause(950); for (const b of crew) b.action('swap', 'flintlock');
    await until(() => crew.every(b => b.player.weapon === 'flintlock'), 3000, 'owned magazines restored after shared pickup');
    await pause(300);
    assert.ok(crew.every(b => b.player.weapon === 'flintlock' && b.player.ammo === 8 && b.player.inventory.longshot.ammo === 4));
    assert.ok(crew.every(b => b.events.filter(e => e.kind === 'loot' && e.id === drop.id).length === 5));

    const equippedCaptain = crew[0]; equippedCaptain.close();
    await until(() => crew[1].state.players.find(p => p.id === equippedCaptain.id)?.online === false, 4000, 'equipped pirate disconnect');
    crew[0] = await open(url, 'Reconnect after pickup', COLORS[0], equippedCaptain.token);
    assert.equal(crew[0].id, equippedCaptain.id); assert.equal(crew[0].player.inventory.longshot.rarity, 'legendary');
    assert.equal(crew[0].player.inventory.longshot.ammo, 4); assert.deepEqual(crew[0].state.drops, [drop]);
    const equippedNavigator = crew[4]; equippedNavigator.send({ type: 'leave' });
    await until(() => crew[1].state.players.filter(p => p.online).length === 4, 4000, 'pickup remains after pirate leaves');
    crew[4] = await open(url, 'Treasure navigator', COLORS[4]);
    assert.equal(crew[4].player.inventory.longshot, undefined); assert.deepEqual(crew[4].state.drops, [drop]);
    await until(() => crew[4].player.weapon === 'longshot' && crew.every(b => b.state.players.find(p => p.id === crew[4].id)?.inventory.longshot?.rarity === 'legendary'), 10000, 'late arrival walks over retained loot and synchronizes pickup', details);
    assert.ok(crew.every(b => b.state.drops.length === 1));
    assert.ok(crew.every(b => b.events.filter(e => e.kind === 'loot' && e.id === drop.id && e.playerId === crew[4].id).length === 1));
    await pause(950); crew[4].action('swap', 'flintlock');
    await until(() => crew.every(b => b.player.weapon === 'flintlock'), 3000, 'late arrival restores starting gun without repeated pickup');
    formationRadius = 1.3;
    t.diagnostic('Five pirates automatically equipped one persistent weapon; reconnect and a later arrival retained shared access.');

    combat = true;
    for (const shrine of SHRINES) {
      destination = BEACON;
      await until(() => gathered(BEACON), 22000, 'walk to haven route junction', details);
      destination = shrine;
      await until(() => gathered(shrine), 22000, `walk to ${shrine.id} shrine`, details);
      crew[1].action('interact', shrine.id);
      await until(() => crew[1].state.shrines.find(s => s.id === shrine.id).status === 'active', 3000, `activate ${shrine.id}`);
      assert.equal(crew[1].state.shrines.find(s => s.id === shrine.id).remaining, 11);
      await until(() => crew.every(b => b.state.shrines.find(s => s.id === shrine.id).status === 'cleared'), 22000, `defeat ${shrine.id} guards and charge for five seconds`, details);
      t.diagnostic(`${shrine.name} cleared through aimed weapon fire and standing near the shrine.`);
    }
    assert.ok(crew.every(b => b.state.shards === 3));
    assert.ok(crew.every(b => b.events.some(e => e.kind === 'shot' && e.hitId)));
    destination = BEACON;
    await until(() => gathered(BEACON), 22000, 'return to lighthouse', details);
    crew[1].action('interact', BEACON.id);
    await until(() => crew[1].state.phase === 'finale', 4000, 'finale begins');
    // The final battle runs in stages: shrine crabs, Tidebreaker elites, then
    // the boss. Every stage is cleared by the same aimed fire the bots use.
    const bossStage = FINALE_STAGES.findIndex(stage => stage.kind === 'boss') + 1;
    const stageOne = finaleStageRoster(1, 5).groups.reduce((sum, group) => sum + group.crab + group.spitter + group.tidebreaker, 0);
    assert.equal(crew[1].state.finale.stage, 1); assert.equal(crew[1].state.finale.stages, FINALE_STAGES.length);
    assert.equal(crew[1].state.bossId, null); assert.equal(crew[1].state.finale.remaining, stageOne);
    assert.ok(crew[1].events.some(e => e.kind === 'finale' && e.stage === 1 && e.spawns.length === stageOne && e.spawns.every(s => SHRINES.some(shrine => shrine.id === s.from))));
    await until(() => crew.every(b => b.state.finale?.stage === 2), 120000, 'stage one shrine crabs cleared', details);
    t.diagnostic('Stage one: shrine crabs cleared at the lighthouse dais.');
    const bossHp = await until(() => {
      const state = crew[1].state, boss = state.enemies.find(e => e.id === state.bossId);
      return state.finale.stage === bossStage && boss ? boss.maxHp : null;
    }, 120000, 'stage two Tidebreakers cleared and the Tempest Crab arrives', details);
    assert.equal(bossHp, 1370);
    assert.ok(crew[1].events.some(e => e.kind === 'finale' && e.stage === 2 && e.spawns.every(s => s.type === 'tidebreaker')));
    await until(() => crew.every(b => b.state.phase === 'victory'), 120000, 'five-pirate Tempest Crab victory', details);
    clearInterval(controller); controller = null;
    const results = crew[1].state.victory;
    assert.ok(crew.every(b => b.state.finale.stage === FINALE_STAGES.length && b.state.finale.remaining === 0));
    assert.ok(results.kills >= 16 + stageOne); assert.ok(results.pearls >= 192 + stageOne * 3); assert.ok(results.duration > 40);
    assert.ok(crew.every(b => b.state.stats.wins === 1));
    assert.ok(crew.every(b => b.events.some(e => e.kind === 'victory')));
    assert.deepEqual(crew[0].state.victory, crew[4].state.victory);
    t.diagnostic(`Victory: ${results.kills} enemies, ${results.pearls} shared pearls, ${results.duration.toFixed(1)} simulated/real seconds.`);
    crew[0].action('restart'); await until(() => crew[0].errors.some(e => e.code === 'HOST_ONLY'), 3000, 'nonhost restart denied');
    crew[1].action('restart');
    await until(() => crew.every(b => b.state.phase === 'lobby' && b.state.round === 2), 5000, 'all-player replay lobby');
    assert.ok(crew.every(b => b.player.mode === 'aboard' && b.player.hp === 100));
    assert.equal(crew[0].state.shards, 0); assert.equal(crew[0].state.pearls, 0); assert.equal(crew[0].state.stats.wins, 1);
    assert.equal(crew[0].state.finale.stage, 0); assert.equal(crew[0].state.bossId, null);
    assert.ok(crew.every(b => b.state.drops.length === 0 && b.player.inventory.longshot === undefined));
    for (const b of allSockets) b.close();
    await server.close(); server = null;
    restarted = await createGameServer({ port: 0, host: '127.0.0.1', dataDir });
    const returning = await open(`ws://127.0.0.1:${restarted.port}`, 'New session', COLORS[0]);
    assert.deepEqual(returning.state.stats, { wins: 1, voyages: 1, bestPearls: results.pearls });
    assert.equal(returning.state.phase, 'lobby');
    t.diagnostic('New server instance recovered aggregate victory statistics from atomic disk persistence.');
  } finally {
    if (controller) clearInterval(controller);
    for (const b of allSockets) { b.close(); if (b.socket.readyState !== WebSocket.CLOSED) b.socket.terminate(); }
    if (server) await server.close();
    if (restarted) await restarted.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
