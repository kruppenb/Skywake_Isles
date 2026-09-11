import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { COLORS, SPAWN, BEACON, SHRINES, CHESTS } from '../shared/world.js';
import { SHIP_JUMP_POINTS, SHIP_JUMP_APPROACHES, SHIP_GUNS, AIRSHIP_RETURNS, RETURN_RANGE, GUN_PIVOT_HEIGHT, gunOperator } from '../shared/airship.js';
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
    for (const route of ['/shared/world.js', '/shared/movement.js', '/shared/collision.js', '/shared/weapons.js', '/shared/encounters.js', '/shared/shrines.js', '/vendor/three.module.js', '/vendor/three.core.js', '/vendor/addons/loaders/GLTFLoader.js', '/vendor/addons/utils/BufferGeometryUtils.js']) {
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

    let destination = SPAWN, formationRadius = 1.3, combat = false, tick = 0, recalling = null;
    const details = () => JSON.stringify(crew.map(b => ({ id: b.id, p: b.player && { x: +b.player.x.toFixed(1), y: +b.player.y.toFixed(1), z: +b.player.z.toFixed(1), deck: [+b.player.deckX?.toFixed(1), +b.player.deckZ?.toFixed(1)], mode: b.player.mode, gun: b.player.gunId, hp: b.player.hp, down: b.player.knockedUntil }, errors: b.errors.slice(-2) })));
    // Aboard pirates walk the painted approach lane to a marked gate and leave
    // with the same public E action a player presses. The lanes exist because
    // the fore-mast stands between the opening spawn and the bow gate.
    const gateFor = index => SHIP_JUMP_POINTS[index % SHIP_JUMP_POINTS.length];
    const laneFor = index => {
      const lanes = SHIP_JUMP_APPROACHES[gateFor(index).id];
      return [...lanes[index % lanes.length], gateFor(index)];
    };
    const laneStep = crew.map(() => 0);
    // Pirates the test drives by hand (a recalled pirate, the sky gun crew) and
    // ground routes that must be walked before the shared destination. The gun
    // crew is excluded here so the generic aboard branch cannot walk them
    // straight back off the ship the moment they ride the lift up.
    const manual = new Set();
    const routes = new Map();
    controller = setInterval(() => {
      tick++;
      for (let i = 0; i < crew.length; i++) {
        const b = crew[i], p = b.player, state = b.state;
        if (!p || !state || b.closed || b === recalling || manual.has(b) || state.phase === 'lobby' || state.phase === 'victory') continue;
        if (p.mode === 'aboard') {
          const gate = gateFor(i), lane = laneFor(i);
          const waypoint = lane[Math.min(laneStep[i], lane.length - 1)];
          const dx = waypoint.x - p.deckX, dz = waypoint.z - p.deckZ, d = Math.hypot(dx, dz);
          if (d < .45 && laneStep[i] < lane.length - 1) laneStep[i]++;
          b.input({ yaw: 0, pitch: 0, right: d > .12 ? dx / d : 0, forward: d > .12 ? -dz / d : 0 });
          if (Math.hypot(p.deckX - gate.x, p.deckZ - gate.z) <= 1.1 && tick % 4 === 0) b.action('interact', gate.id);
          continue;
        }
        laneStep[i] = 0;
        const route = routes.get(b.id) ?? [];
        while (route.length && Math.hypot(p.x - route[0].x, p.z - route[0].z) < 3.4) route.shift();
        const angle = i / 5 * Math.PI * 2;
        const goal = route.length ? route[0]
          : { x: destination.x + Math.cos(angle) * formationRadius, z: destination.z + Math.sin(angle) * formationRadius };
        const dx = goal.x - p.x, dz = goal.z - p.z, d = Math.hypot(dx, dz);
        const enemies = combat ? state.enemies.filter(e => Math.hypot(e.x - p.x, e.z - p.z) < 45 && hasWorldLineOfSight({ x: p.x, y: p.y + 1.25, z: p.z }, { x: e.x, y: e.y + e.radius * .8, z: e.z })) : [];
        enemies.sort((a, b) => (a.id === state.bossId ? -1000 : Math.hypot(a.x - p.x, a.z - p.z)) - (b.id === state.bossId ? -1000 : Math.hypot(b.x - p.x, b.z - p.z)));
        const enemy = enemies[0];
        const yaw = enemy ? Math.atan2(-(enemy.x - p.x), -(enemy.z - p.z)) : d > 0.2 ? Math.atan2(-dx, -dz) : p.yaw;
        const pitch = enemy ? Math.atan2(enemy.y + enemy.radius * 0.8 - p.y - 1.25, Math.hypot(enemy.x - p.x, enemy.z - p.z)) : 0;
        const mx = d > 0.8 ? dx / d : 0, mz = d > 0.8 ? dz / d : 0;
        b.input({ yaw, pitch, forward: -Math.sin(yaw) * mx - Math.cos(yaw) * mz, right: Math.cos(yaw) * mx - Math.sin(yaw) * mz });
        if (enemy && tick % 2 === 0) b.action('fire');
        if (p.hp < 75 && !p.knockedUntil && tick % 20 === 0) b.action('heal');
        const friend = state.players.find(a => a.id !== p.id && a.knockedUntil && Math.hypot(a.x - p.x, a.z - p.z) < 3.4);
        if (friend && tick % 8 === 0) b.action('interact', friend.id);
      }
    }, 50);
    const landed = () => crew.every(b => b.player?.mode === 'ground');
    const gathered = point => landed() && crew.every(b => Math.hypot(b.player.x - point.x, b.player.z - point.z) < 3.2);
    await until(landed, 26000, 'five deck walks to a jump gate, E departures and glide landings', details);
    assert.ok(crew.every(b => b.events.some(e => e.kind === 'phase' && e.phase === 'voyage')));
    assert.ok(crew.every((b, i) => b.events.some(e => e.kind === 'airship-jump' && e.playerId === b.id && e.id === gateFor(i).id)),
      'each pirate left through the gate it walked to');
    assert.ok(new Set(crew.map((b, i) => gateFor(i).id)).size === SHIP_JUMP_POINTS.length, 'both gates carried crew');
    t.diagnostic('Five pirates walked the deck to a marked jump gate and left with E, then glided down using ordinary movement inputs.');
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
      await until(() => crew.every(b => b.state.shrines.find(s => s.id === shrine.id).status === 'cleared'), 22000, `defeat ${shrine.id} guards and capture automatically`, details);
      t.diagnostic(`${shrine.name} captured automatically after aimed weapon fire cleared its defenders.`);
    }
    assert.ok(crew.every(b => b.state.shards === 3));
    assert.ok(crew.every(b => b.events.some(e => e.kind === 'shot' && e.hitId)));
    await until(() => !crew[0].player.knockedUntil && crew[0].player.grounded &&
      Math.hypot(crew[0].player.x - SHRINES.at(-1).x, crew[0].player.z - SHRINES.at(-1).z) < 3.2, 10000, 'living pirate reaches captured shrine', details);
    recalling = crew[0]; recalling.input();
    const carriedWeapon = recalling.player.weapon, carriedRarity = recalling.player.rarity;
    recalling.action('interact', SHRINES.at(-1).id);
    await until(() => crew.every(b => b.state.players.find(p => p.id === recalling.id)?.mode === 'aboard'), 4000, 'shrine return synchronized to five clients', details);
    assert.equal(recalling.player.shipReturned, true);
    assert.equal(recalling.player.weapon, carriedWeapon); assert.equal(recalling.player.rarity, carriedRarity);
    assert.ok(crew.every(b => b.events.some(e => e.kind === 'airship-return' && e.playerId === recalling.id && e.id === SHRINES.at(-1).id)));
    // Space keeps a returned pirate safely aboard; only a gate sends them back down.
    recalling.input({ jump: true }); await pause(250);
    assert.equal(recalling.player.mode, 'aboard');
    recalling.input({ jump: false }); await pause(120);
    const returnGate = SHIP_JUMP_POINTS[1];
    for (const waypoint of [...SHIP_JUMP_APPROACHES[returnGate.id][0], returnGate]) {
      await until(() => {
        const p = recalling.player;
        const dx = waypoint.x - p.deckX, dz = waypoint.z - p.deckZ, d = Math.hypot(dx, dz);
        recalling.input({ yaw: 0, pitch: 0, right: d > .12 ? dx / d : 0, forward: d > .12 ? -dz / d : 0 });
        return d < .3;
      }, 9000, `returned pirate walks the deck to ${returnGate.id}`, details);
    }
    recalling.input();
    recalling.action('interact', returnGate.id);
    await until(() => recalling.player.mode === 'gliding', 4000, 'returned pirate walks to a gate and glides back down', details);
    await until(() => recalling.player.mode === 'ground', 14000, 'returned pirate lands safely from the parked ship', details);
    recalling = null;
    t.diagnostic('Captured shrine returned a pirate to the boat on all five clients, then they walked to a jump gate and glided back into the adventure.');
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
    // --- Stage four: the skycrab siege ------------------------------------
    // Two pirates ride the haven lift, walk the deck and fight the flying
    // bosses from the broadside guns while the rest hold the lighthouse.
    await until(() => crew.every(b => b.state.finale?.stage === FINALE_STAGES.length), 120000,
      'the Tempest falls and the skycrab siege opens', details);
    const skyOf = b => b.state.finale.sky;
    assert.ok(crew.every(b => skyOf(b)?.status === 'boarding'), 'the siege waits for a gunner on every client');
    assert.ok(crew.every(b => skyOf(b).bosses.length === 0 && skyOf(b).wave === 0 && skyOf(b).waves === 3));
    assert.ok(crew.every(b => b.state.flyingTargets.length === 0), 'practice flyers leave the real fight');
    assert.ok(crew.every(b => b.state.bossId === null && b.state.finale.remaining > 0));
    assert.equal(crew[0].state.phase, 'finale');
    const haven = AIRSHIP_RETURNS.find(point => point.id === 'airship-return-haven');
    const gunCrew = [
      { bot: crew[1], gunId: 'gun-port-aft', side: 'port', step: 0 },
      { bot: crew[2], gunId: 'gun-starboard-aft', side: 'starboard', step: 0 },
    ];
    for (const seat of gunCrew) manual.add(seat.bot);
    const walkGroundTo = (b, point) => {
      const p = b.player, dx = point.x - p.x, dz = point.z - p.z, d = Math.hypot(dx, dz);
      const yaw = d > .2 ? Math.atan2(-dx, -dz) : p.yaw;
      const mx = d > .8 ? dx / d : 0, mz = d > .8 ? dz / d : 0;
      b.input({ yaw, pitch: 0, forward: -Math.sin(yaw) * mx - Math.cos(yaw) * mz, right: Math.cos(yaw) * mx - Math.sin(yaw) * mz });
      return d;
    };
    const walkDeckTo = (b, point) => {
      const p = b.player, dx = point.x - p.deckX, dz = point.z - p.deckZ, d = Math.hypot(dx, dz);
      b.input({ yaw: 0, pitch: 0, right: d > .12 ? dx / d : 0, forward: d > .12 ? -dz / d : 0 });
      return d;
    };
    // E is a toggle at a station, so a pirate waits for the acknowledgement its
    // own snapshot carries before pressing again; hammering it would mount and
    // dismount the same gun forever. A real player presses once and looks.
    const press = (seat, target) => {
      if (tick - (seat.pressedAt ?? -99) < 12) return;
      seat.pressedAt = tick; seat.bot.action('interact', target);
    };
    // Walk to the lighthouse lift, press E to ride up, cross the deck to the
    // gun's actual stance and press E again to man it. No teleports.
    const takeSeat = seat => {
      const p = seat.bot.player;
      if (!p) return false;
      if (p.gunId === seat.gunId) return true;
      if (p.mode === 'gliding' || p.knockedUntil) { seat.bot.input(); return false; }
      if (p.mode === 'ground') {
        const d = walkGroundTo(seat.bot, haven);
        if (d <= RETURN_RANGE - .8) press(seat, haven.id);
        return false;
      }
      const stance = gunOperator(SHIP_GUNS.find(gun => gun.id === seat.gunId));
      const d = walkDeckTo(seat.bot, stance);
      if (d < .7) press(seat, seat.gunId);
      return false;
    };
    // Aim with ordinary input packets at the published boss sphere CENTRE. The
    // pivot comes from the pirate's own replicated stance plus shared geometry.
    const trackBoss = seat => {
      const p = seat.bot.player, sky = skyOf(seat.bot);
      if (!p || p.gunId !== seat.gunId || !sky?.bosses.length) return;
      const ordered = sky.bosses.filter(boss => boss.state !== 'down').sort((a, c) => a.x - c.x);
      const boss = seat.side === 'port' ? ordered[0] : ordered.at(-1);
      if (!boss) return;
      const gun = SHIP_GUNS.find(item => item.id === seat.gunId), operator = gunOperator(gun);
      const pivot = { x: p.x + (gun.x - operator.x), y: p.y + GUN_PIVOT_HEIGHT, z: p.z + (gun.z - operator.z) };
      const dx = boss.x - pivot.x, dy = boss.y - pivot.y, dz = boss.z - pivot.z;
      seat.bot.input({ yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
      if (tick % 3 === 0) seat.bot.action('fire');
    };
    // E releases the gun, then the same painted lane and gate every pirate uses,
    // and the glide steers to the haven lift: the lighthouse tower stands on the
    // straight line from a gate launch to the beacon, so returning gliders come
    // down at the lift/landing beside it and walk in from there.
    const bringDown = seat => {
      const p = seat.bot.player;
      if (!p) return false;
      if (p.mode === 'ground') return true;
      if (p.mode === 'gliding') { walkGroundTo(seat.bot, haven); return false; }
      if (p.gunId === seat.gunId) { seat.bot.input(); press(seat, seat.gunId); return false; }
      const gate = SHIP_JUMP_POINTS[1], lane = [...SHIP_JUMP_APPROACHES[gate.id][0], gate];
      const d = walkDeckTo(seat.bot, lane[Math.min(seat.step, lane.length - 1)]);
      if (d < .45 && seat.step < lane.length - 1) seat.step++;
      if (Math.hypot(p.deckX - gate.x, p.deckZ - gate.z) <= 1.1) press(seat, gate.id);
      return false;
    };
    await until(() => gunCrew.map(takeSeat).every(Boolean), 60000,
      'two pirates ride the haven lift and man a gun on each broadside', details);
    assert.ok(crew.every(b => b.state.players.filter(p => p.gunId).length === 2));
    assert.deepEqual(gunCrew.map(seat => seat.bot.player.gunId).sort(), ['gun-port-aft', 'gun-starboard-aft']);
    assert.ok(gunCrew.every(seat => seat.bot.events.some(e => e.kind === 'airship-return' && e.playerId === seat.bot.id && e.id === haven.id)));
    await until(() => ['countdown', 'active'].includes(skyOf(crew[0])?.status), 6000, 'a mounted gunner opens the shared countdown', details);
    t.diagnostic('Two pirates took the haven lift, crossed the deck and manned the port and starboard guns; the shared countdown began.');
    const dove = await until(() => {
      const sky = skyOf(crew[0]);
      return sky?.status === 'active' && sky.bosses.length === 2 ? sky : null;
    }, 20000, 'both skycrabs dive into their lanes', details);
    const bossIds = dove.bosses.map(boss => boss.id).sort();
    assert.deepEqual(bossIds, ['skycrab-port', 'skycrab-starboard']);
    assert.ok(dove.bosses.every(boss => boss.hp === boss.maxHp && boss.radius > 3 && boss.state === 'flying'));
    await until(() => crew.every(b => skyOf(b)?.wave >= 1), 20000, 'and the finite ground waves start with them', details);
    const skycrabKills = b => b.events.filter(e => e.kind === 'defeated' && e.type === 'skycrab');
    await until(() => {
      for (const seat of gunCrew) trackBoss(seat);
      return skycrabKills(crew[0]).length === bossIds.length;
    }, 180000, 'both skycrabs shot down with the deck guns', details);
    for (const b of crew) {
      assert.deepEqual(skycrabKills(b).map(e => e.id).sort(), bossIds, 'every client saw both skycrabs fall, once each');
    }
    for (const seat of gunCrew) {
      const cannon = seat.bot.events.filter(e => e.kind === 'shot' && e.weapon === 'cannon' && e.playerId === seat.bot.id);
      const landed = cannon.filter(e => bossIds.includes(e.hitId));
      assert.ok(landed.length >= 12, `${seat.gunId} landed ${landed.length} aimed cannon shots on a skycrab`);
      assert.ok(landed.every(e => e.damage > 0 && e.gunId === seat.gunId && e.from && e.to));
      assert.ok(seat.bot.events.some(e => e.kind === 'hit' && bossIds.includes(e.targetId) && e.sourceId === seat.bot.id));
      assert.ok(seat.bot.player.kills >= 1, 'the gunner is credited for what it shot down');
    }
    const stillFighting = skyOf(crew[0]);
    if (stillFighting) {
      assert.equal(crew[0].state.phase, 'finale', 'a cleared sky alone never wins the island');
      assert.ok(stillFighting.groundActive + stillFighting.groundPending + stillFighting.groundFuture > 0);
    }
    t.diagnostic('Both skycrabs were shot out of their lanes with ordinary mounted cannon fire from the two broadsides.');
    // One loop from gun to ground: release, walk the lane, E at the gate, then
    // glide to the haven landing. It picks up wherever each pirate actually is.
    // The defenders may finish the last wave while the gun crew is still on the
    // way down, which secures the island and freezes the victory tableau, so
    // either ending resolves this leg.
    const descent = await until(() => crew[0].state.phase === 'victory' ? 'secured'
      : (gunCrew.map(bringDown).every(Boolean) ? 'landed' : null), 90000,
      'gun crew leaves the guns and glides down to the haven landing', details);
    assert.ok(gunCrew.every(seat => seat.bot.player.gunId === null), 'both stations are free again');
    assert.ok(gunCrew.every(seat => seat.bot.events.some(e => e.kind === 'airship-jump' && e.playerId === seat.bot.id)),
      'each gunner released its station and left through a real jump gate');
    for (const seat of gunCrew) {
      routes.set(seat.bot.id, [{ x: haven.x, z: haven.z }]);
      manual.delete(seat.bot);
    }
    t.diagnostic(descent === 'landed'
      ? 'With the sky clear the gun crew released their stations, walked to a gate and glided to the haven landing to help.'
      : 'The defenders cleared the last wave while the gun crew was still gliding home from the guns.');
    // Three finite waves, then the island is secured: one victory, once.
    await until(() => crew.every(b => b.state.phase === 'victory'), 240000,
      'the crew clears the last finite ground wave and secures the island', details);
    clearInterval(controller); controller = null;
    assert.ok(crew.every(b => b.state.finale.sky === undefined), 'the sky block leaves with the fight');
    assert.ok(crew.every(b => b.state.flyingTargets.length === 0 && b.state.enemies.length === 0));
    assert.ok(crew.every(b => b.events.filter(e => e.kind === 'victory').length === 1));
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
