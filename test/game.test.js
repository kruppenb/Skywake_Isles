import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Game, sanitizeName } from '../server/game.js';
import { createStatsStore } from '../server/storage.js';
import { COLORS, SPAWN, BEACON, SHRINES, CHESTS, heightAt } from '../shared/world.js';
import { FINALE_STAGES } from '../shared/finale.js';

function setup(count = 1) {
  const events = [], game = new Game({ onEvent: event => events.push(event) });
  for (let i = 0; i < count; i++) game.addPlayer(`p${i}`, `Pirate ${i}`, COLORS[i]);
  game.action('p0', 'launch');
  return { game, p: game.players.get('p0'), events };
}
function locate(p, point) { Object.assign(p, { x: point.x, z: point.z, y: heightAt(point.x, point.z), mode: 'ground', grounded: true, vy: 0 }); }
function ticks(game, seconds) { for (let i = 0; i < Math.ceil(seconds / 0.05); i++) game.tick(0.05); }
const aimSequences = new WeakMap();
function aim(game, p, target) {
  const dx = target.x - p.x, dz = target.z - p.z;
  const seq = (aimSequences.get(p) ?? -1) + 1;
  aimSequences.set(p, seq);
  game.setInput(p.id, { seq, forward: 0, right: 0, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(target.y + target.radius * 0.8 - p.y - 1.25, Math.hypot(dx, dz)), jump: false, sprint: false });
}

test('names, five-player limit, reserved reconnect, host transfer, expiry, and privacy', () => {
  const g = new Game();
  assert.equal(sanitizeName('\n<A\u0000BC> pirate with a very long name'), 'ABC pirate with ');
  for (let i = 0; i < 5; i++) assert.ok(g.addPlayer(`p${i}`, `Pirate ${i}`, COLORS[i]));
  assert.equal(g.addPlayer('six', 'Too many', COLORS[0]), null);
  g.disconnect('p0'); assert.equal(g.hostId, 'p1'); assert.equal(g.players.get('p0').online, false);
  assert.equal(g.reconnect('p0').id, 'p0'); assert.equal(g.hostId, 'p1');
  assert.equal(g.action('p0', 'launch').code, 'HOST_ONLY');
  const publicPlayer = g.snapshot().players[0];
  assert.ok(!Object.keys(publicPlayer).some(k => k.startsWith('_')));
  assert.ok(!('token' in publicPlayer));
  g.disconnect('p0'); ticks(g, 61); assert.equal(g.players.has('p0'), false);
  g.disconnect('p1', true); assert.equal(g.players.has('p1'), false); assert.equal(g.hostId, 'p2');
});

test('the last explicit leave resets the voyage on the next tick and preserves aggregate saves', () => {
  const events = [], game = new Game({ stats: { wins: 4, voyages: 9, bestPearls: 200 }, onEvent: event => events.push(event) });
  const p = game.addPlayer('p0', 'Captain', COLORS[0]);
  game.addPlayer('p1', 'Crewmate', COLORS[1]);
  game.action(p.id, 'launch');
  locate(p, CHESTS[0]); game.action(p.id, 'interact', CHESTS[0].id);
  locate(p, SHRINES[0]); game.action(p.id, 'interact', SHRINES[0].id);
  for (const enemy of [...game.enemies.values()].filter(e => e._shrine === SHRINES[0].id)) game.damageEnemy(enemy, enemy.hp, p.id);
  game.action(p.id, 'ping');
  assert.equal(game.shards, 1); assert.equal(game.pings.length, 1);
  assert.notDeepEqual(game.checkpoint, SPAWN);
  const round = game.round, stats = { ...game.stats };
  game.disconnect('p0', true); game.tick();
  assert.equal(game.phase, 'voyage'); assert.equal(game.round, round);
  game.disconnect('p1', true); game.tick();
  assert.equal(game.players.size, 0); assert.equal(game.hostId, null);
  assert.equal(game.phase, 'lobby'); assert.equal(game.round, round + 1); assert.equal(game.elapsed, 0);
  assert.equal(game.enemies.size, 0); assert.equal(game.pearls, 0); assert.equal(game.shards, 0);
  assert.equal(game.bossId, null); assert.equal(game.victory, null); assert.deepEqual(game.pings, []);
  assert.deepEqual(game.checkpoint, SPAWN);
  assert.ok(game.shrines.every(s => s.status === 'dormant' && s.charge === 0 && s.remaining === 0));
  assert.ok(game.chests.every(c => !c.opened)); assert.deepEqual(game.stats, stats);
  assert.equal(events.filter(e => e.kind === 'phase' && e.phase === 'lobby').length, 1);
  const newcomer = game.addPlayer('new', 'New captain', COLORS[2]);
  assert.equal(newcomer.mode, 'aboard'); assert.equal(game.hostId, newcomer.id);
});

test('an entirely offline crew keeps its voyage while reconnect reservations remain', () => {
  const { game, p, events } = setup(2);
  locate(p, CHESTS[0]); game.action(p.id, 'interact', CHESTS[0].id);
  locate(p, SHRINES[0]); game.action(p.id, 'interact', SHRINES[0].id);
  const round = game.round, pearls = game.pearls, enemyIds = [...game.enemies.keys()];
  game.disconnect('p0'); game.disconnect('p1');
  assert.equal(game.onlineCount, 0); assert.equal(game.players.size, 2);
  ticks(game, 59.5);
  assert.equal(game.phase, 'voyage'); assert.equal(game.round, round); assert.equal(game.players.size, 2);
  assert.equal(game.pearls, pearls); assert.equal(game.chests[0].opened, true);
  assert.equal(game.shrines[0].status, 'active'); assert.deepEqual([...game.enemies.keys()], enemyIds);
  assert.equal(events.some(e => e.kind === 'phase' && e.phase === 'lobby'), false);
  assert.equal(game.reconnect('p0'), p); assert.equal(game.hostId, p.id);
  assert.equal(game.phase, 'voyage'); assert.equal(game.round, round); assert.equal(game.pearls, pearls);
  assert.equal(game.chests[0].opened, true); assert.equal(game.shrines[0].status, 'active');
});

test('only expiry of the final reconnect reservation resets an abandoned voyage', () => {
  const { game, p, events } = setup(2);
  locate(p, CHESTS[0]); game.action(p.id, 'interact', CHESTS[0].id);
  const round = game.round, stats = { ...game.stats };
  game.disconnect('p0'); ticks(game, 10); game.disconnect('p1');
  ticks(game, 50.05);
  assert.equal(game.players.has('p0'), false); assert.equal(game.players.has('p1'), true);
  assert.equal(game.onlineCount, 0); assert.equal(game.phase, 'voyage'); assert.equal(game.round, round);
  assert.equal(game.chests[0].opened, true);
  ticks(game, 10);
  assert.equal(game.players.size, 0); assert.equal(game.phase, 'lobby'); assert.equal(game.hostId, null);
  assert.equal(game.round, round + 1); assert.equal(game.elapsed, 0); assert.equal(game.enemies.size, 0);
  assert.equal(game.pearls, 0); assert.ok(game.chests.every(c => !c.opened));
  assert.deepEqual(game.stats, stats); assert.equal(game.reconnect('p1'), null);
  assert.equal(events.filter(e => e.kind === 'phase' && e.phase === 'lobby').length, 1);
});

test('empty lobbies do not repeatedly advance rounds, including a join before the reset tick', () => {
  const fresh = new Game(); ticks(fresh, 65);
  assert.equal(fresh.round, 1); assert.equal(fresh.phase, 'lobby');
  const { game, events } = setup();
  game.disconnect('p0', true);
  // The new crew must get the ship even if it connects inside the next 50ms.
  const newcomer = game.addPlayer('new', 'New crew', COLORS[1]);
  assert.equal(game.phase, 'lobby'); assert.equal(game.round, 2); assert.equal(newcomer.mode, 'aboard');
  game.disconnect('new', true); ticks(game, 65);
  assert.equal(game.round, 2); assert.equal(game.phase, 'lobby'); assert.equal(game.hostId, null);
  assert.equal(events.filter(e => e.kind === 'phase' && e.phase === 'lobby').length, 1);
});

test('invalid inputs and unknown/distant interactions cannot move or progress objectives', () => {
  const { game, p } = setup(); locate(p, SPAWN);
  assert.equal(game.setInput(p.id, { seq: 0, forward: NaN, right: 0, yaw: 0, pitch: 0 }).code, 'BAD_INPUT');
  assert.equal(game.setInput(p.id, { seq: 0, forward: 100, right: 0, yaw: 1000, pitch: 100 }).ok, true);
  assert.equal(p._input.forward, 1); assert.equal(p.pitch, 1.35);
  const seq = p.lastInputSeq;
  game.setInput(p.id, { seq: 0, forward: -1, right: 0, yaw: 0, pitch: 0 });
  assert.equal(p.lastInputSeq, seq); assert.equal(p._input.forward, 1);
  assert.equal(game.action(p.id, 'win').code, 'BAD_ACTION');
  assert.equal(game.action(p.id, 'interact', 'palm').code, 'TOO_FAR');
  assert.equal(game.action(p.id, 'interact', BEACON.id).ok, false);
  assert.equal(game.shards, 0); assert.equal(game.phase, 'voyage');
  assert.equal(game.action(p.id, 'interact', { id: 'palm' }).code, 'BAD_TARGET');
});

test('ray hits and modest aim assist respect cooldown, reload, range, props, and no friendly fire', () => {
  const { game, p, events } = setup(2); game.enemies.clear(); locate(p, { x: 0, z: 50 });
  const ally = game.players.get('p1'); locate(ally, { x: 0, z: 40 });
  const enemy = game.spawnEnemy('crab', 0, 30, 'haven');
  aim(game, p, enemy); assert.equal(game.action(p.id, 'fire').ok, true);
  assert.equal(enemy.hp, 28); assert.equal(ally.hp, 100);
  for (let i = 0; i < 100; i++) game.action(p.id, 'fire');
  assert.equal(enemy.hp, 28); assert.equal(p.ammo, 7);
  ticks(game, 0.3); aim(game, p, enemy); game.action(p.id, 'fire'); assert.equal(enemy.hp, 4);
  ticks(game, 0.3); aim(game, p, enemy); game.action(p.id, 'fire'); assert.equal(game.enemies.has(enemy.id), false);
  assert.equal(p.kills, 1); assert.equal(p.ammo, 5);
  game.action(p.id, 'reload'); assert.ok(p.reloadUntil > game.elapsed);
  ticks(game, 1.25); assert.equal(p.ammo, 8); assert.equal(p.reloadUntil, 0);
  assert.ok(events.some(e => e.kind === 'shot' && e.hitId === enemy.id));
  const far = game.spawnEnemy('crab', 0, -15, 'haven'); aim(game, p, far); game.action(p.id, 'fire'); assert.equal(far.hp, far.maxHp);
  // A rock at (-24,101) blocks this otherwise aligned shot.
  game.enemies.clear(); locate(p, { x: -31, z: 101 });
  const hidden = game.spawnEnemy('crab', -17, 101, 'beach');
  ticks(game, 0.35); aim(game, p, hidden); game.action(p.id, 'fire'); assert.equal(hidden.hp, hidden.maxHp);
});

test('scatter, cutlass, and weapon swapping preserve global fire cooldown', () => {
  const { game, p } = setup(); game.enemies.clear(); locate(p, { x: 0, z: 50 });
  const enemy = game.spawnEnemy('tempest', 0, 42, 'haven');
  game.action(p.id, 'swap', 'scatter'); assert.equal(p.ammo, 5);
  aim(game, p, enemy); game.action(p.id, 'fire'); assert.equal(enemy.hp, enemy.maxHp);
  ticks(game, 0.5); aim(game, p, enemy); game.action(p.id, 'fire'); assert.equal(enemy.hp, enemy.maxHp - 50);
  const hp = enemy.hp;
  game.action(p.id, 'swap', 'flintlock'); game.action(p.id, 'fire'); assert.equal(enemy.hp, hp);
  ticks(game, 0.4); game.action(p.id, 'swap', 'flintlock'); assert.equal(p.weapon, 'flintlock');
  game.action(p.id, 'fire'); assert.equal(enemy.hp, hp);
  locate(p, { x: enemy.x, z: enemy.z + 3 }); aim(game, p, enemy);
  game.action(p.id, 'melee'); assert.equal(enemy.hp, hp - 32);
  game.action(p.id, 'melee'); assert.equal(enemy.hp, hp - 32);
});

test('shared loot, heal pulse cooldown, regeneration, manual revive and safe automatic rescue', () => {
  const { game, p, events } = setup(2); game.enemies.clear(); locate(p, CHESTS[0]);
  const ally = game.players.get('p1'); locate(ally, { x: p.x + 2, z: p.z }); p.hp = 30; ally.hp = 30;
  game.action(p.id, 'interact', CHESTS[0].id); assert.equal(game.pearls, 12); assert.equal(ally.hp, 52);
  game.action(p.id, 'interact', CHESTS[0].id); assert.equal(game.pearls, 12);
  game.action(p.id, 'heal'); assert.equal(p.hp, 87); assert.equal(ally.hp, 87);
  p.hp = 20; game.action(p.id, 'heal'); assert.equal(p.hp, 20);
  game.damagePlayer(ally, 100, 'test-crab'); assert.ok(ally.knockedUntil > 0);
  game.action(p.id, 'interact', ally.id); assert.equal(ally.knockedUntil, 0); assert.equal(p.rescues, 1); assert.equal(ally.hp, 65);
  ticks(game, 3.1); game.damagePlayer(ally, 100, 'test-crab'); const knockedX = ally.x;
  game.setInput(ally.id, { seq: 1, forward: 1, right: 0, yaw: 0, pitch: 0 }); ticks(game, 0.2);
  assert.equal(ally.x, knockedX); assert.ok(ally.knockedUntil);
  ticks(game, 8); assert.equal(ally.knockedUntil, 0); assert.ok(Math.hypot(ally.x - SPAWN.x, ally.z - SPAWN.z) < 8);
  assert.ok(ally.invulnerableUntil > game.elapsed); assert.ok(events.some(e => e.kind === 'revive' && !e.by));
  p._damageAt = game.elapsed; p.hp = 20; ticks(game, 7.95); assert.equal(p.hp, 20); ticks(game, 1.05); assert.ok(p.hp > 26);
});

test('three finite shrine quests unlock scaled boss, victory results, and clean replay', () => {
  const { game, p, events } = setup(); game.enemies.clear();
  let seq = 0;
  for (const point of SHRINES) {
    locate(p, point); game.action(p.id, 'interact', point.id);
    assert.equal(game.shrines.find(s => s.id === point.id).remaining, 3);
    const guards = [...game.enemies.values()].filter(e => e._shrine === point.id);
    let steps = 0;
    while (guards.some(e => game.enemies.has(e.id)) && steps++ < 1200) {
      const enemy = guards.find(e => game.enemies.has(e.id));
      aim(game, p, enemy); game.action(p.id, 'fire'); game.tick(0.05);
      if (p.hp < 65) game.action(p.id, 'heal');
    }
    assert.ok(steps < 1200, `guards defeated at ${point.id}`);
    assert.equal(game.shrines.find(s => s.id === point.id).status, 'cleared');
    locate(p, point);
    assert.equal(game.action(p.id, 'interact', point.id).ok, true);
    assert.equal(p.mode, 'aboard');
  }
  assert.equal(game.shards, 3); assert.equal(game.pearls, 102);
  locate(p, BEACON); game.action(p.id, 'interact', BEACON.id);
  // The lighthouse is stormed stage by stage; the boss only arrives with its own.
  assert.equal(game.phase, 'finale'); assert.equal(game.finale.stage, 1); assert.equal(game.bossId, null);
  let ticksTaken = 0, bossMaxHp = 0;
  while (game.phase === 'finale' && ticksTaken++ < 6000) {
    const enemy = [...game.enemies.values()].filter(e => e.hp > 0)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (enemy) { aim(game, p, enemy); game.action(p.id, 'fire'); }
    if (p.hp < 75) game.action(p.id, 'heal');
    if (game.bossId && !bossMaxHp) bossMaxHp = game.enemies.get(game.bossId)?.maxHp ?? 0;
    game.tick(0.05);
  }
  assert.equal(bossMaxHp, 650);
  assert.equal(game.phase, 'victory'); assert.equal(game.stats.wins, 1); assert.equal(game.stats.voyages, 1);
  assert.equal(game.finale.stage, FINALE_STAGES.length); assert.equal(game.finale.remaining, 0);
  assert.ok(game.victory.kills >= 21); assert.ok(game.victory.pearls >= 162);
  assert.ok(events.some(e => e.kind === 'telegraph')); assert.ok(events.some(e => e.kind === 'victory'));
  assert.equal(game.action(p.id, 'restart').ok, true); assert.equal(game.phase, 'lobby'); assert.equal(game.round, 2);
  assert.equal(game.shards, 0); assert.equal(game.enemies.size, 0); assert.equal(game.stats.wins, 1); assert.equal(p.mode, 'aboard');
  assert.equal(game.finale.stage, 0); assert.equal(game.finale.stages, FINALE_STAGES.length);
});

test('aggregate statistics are atomically saved and recovered from a new store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'skywake-stats-'));
  try {
    const store = createStatsStore(directory);
    assert.deepEqual(await store.read(), { wins: 0, voyages: 0, bestPearls: 0 });
    await Promise.all([store.write({ wins: 1, voyages: 2, bestPearls: 180 }), store.write({ wins: 2, voyages: 3, bestPearls: 220 })]);
    await store.flush();
    assert.deepEqual(await createStatsStore(directory).read(), { wins: 2, voyages: 3, bestPearls: 220 });
    assert.equal(JSON.parse(await readFile(path.join(directory, 'stats.json'), 'utf8')).wins, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
