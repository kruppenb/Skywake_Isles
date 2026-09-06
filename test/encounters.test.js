import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { MAX_PLAYERS, COLORS, SPAWN, SHRINES, CHESTS, BEACON, heightAt } from '../shared/world.js';
import { POINTS_OF_INTEREST } from '../shared/exploration.js';
import { resolveWorldCollision } from '../shared/collision.js';
import { ENCOUNTER_GROUPS, encounterSpawns, inSafeLanding, SAFE_LANDING_RADIUS } from '../shared/encounters.js';

function setup(count = 1) {
  const game = new Game();
  for (let i = 0; i < count; i++) game.addPlayer(`p${i}`, `Crew ${i}`, COLORS[i]);
  game.action('p0', 'launch'); return { game, p: game.players.get('p0') };
}
function ticks(game, seconds) { for (let i = 0; i < Math.ceil(seconds / .05); i++) game.tick(.05); }
function locate(p, point) { Object.assign(p, { x: point.x, z: point.z, y: heightAt(point.x, point.z), mode: 'ground', grounded: true, vy: 0 }); }

test('finite launch populations scale 24–56 with one extra melee crab per pirate at every destination and clear spawns', () => {
  assert.deepEqual(new Set(ENCOUNTER_GROUPS.map(g => g.id)), new Set(POINTS_OF_INTEREST.map(p => p.id)));
  const expectedTotals = [24, 32, 40, 48, 56];
  for (let count = 1; count <= MAX_PLAYERS; count++) {
    const { game } = setup(count), spawns = encounterSpawns(count);
    assert.equal(game.enemies.size, expectedTotals[count - 1]);
    assert.equal(spawns.length, expectedTotals[count - 1]);
    assert.deepEqual(encounterSpawns(count), spawns, 'repeatable encounter placement');
    for (const group of ENCOUNTER_GROUPS) {
      const guards = [...game.enemies.values()].filter(e => e._camp === group.id);
      assert.equal(guards.length, count + 2, `${group.id} camp size for ${count} pirates`);
      assert.equal(guards.filter(e => e.type === 'crab').length, count + 1, `${group.id} melee guards`);
      assert.equal(guards.filter(e => e.type === 'spitter').length, 1, `${group.id} has one ranged guard`);
      assert.ok(guards.every(e => Math.hypot(e.x - group.x, e.z - group.z) < 12), group.id);
    }
    for (const enemy of game.enemies.values()) {
      assert.ok(!inSafeLanding(enemy)); assert.ok(Math.hypot(enemy.x - SPAWN.x, enemy.z - SPAWN.z) >= SAFE_LANDING_RADIUS);
      assert.ok([BEACON, ...CHESTS, ...SHRINES].every(p => Math.hypot(enemy.x - p.x, enemy.z - p.z) >= 3.6), `${enemy.id} loot/objective clearance`);
      const resolved = resolveWorldCollision({ x: enemy.x, y: enemy.y, z: enemy.z }, enemy.radius);
      assert.ok(Math.hypot(resolved.x - enemy.x, resolved.z - enemy.z) < .000001, `${enemy.id} starts clear of solid walls/props`);
      assert.ok([...game.enemies.values()].every(other => other.id === enemy.id || Math.hypot(enemy.x - other.x, enemy.z - other.z) >= 2.8), `${enemy.id} has room between guards`);
      assert.equal(enemy.y, heightAt(enemy.x, enemy.z));
      assert.ok(enemy.y >= 1, `${enemy.id} starts on land`);
    }
  }
});

test('patrol crew counts stay within the supported finite roster', () => {
  for (const count of [-2, 0, NaN, Infinity, -Infinity]) assert.deepEqual(encounterSpawns(count), encounterSpawns(1));
  assert.deepEqual(encounterSpawns(2.9), encounterSpawns(2));
  assert.deepEqual(encounterSpawns(MAX_PLAYERS + 100), encounterSpawns(MAX_PLAYERS));
});

test('idle camp guards visibly patrol local routes and snapshots conceal AI internals', () => {
  const { game } = setup(), starts = new Map([...game.enemies.values()].map(e => [e.id, { x: e.x, z: e.z }]));
  ticks(game, 2.4);
  for (const enemy of game.enemies.values()) {
    const start = starts.get(enemy.id);
    assert.ok(Math.hypot(enemy.x - start.x, enemy.z - start.z) > .25, `${enemy.id} patrols`);
    assert.ok(Math.hypot(enemy.x - enemy._home.x, enemy.z - enemy._home.z) < 6, `${enemy.id} remains local`);
  }
  const snapshot = game.snapshot();
  for (const enemy of snapshot.enemies) assert.ok(Object.keys(enemy).every(key => !key.startsWith('_')));
  snapshot.enemies[0].x = 999;
  assert.notEqual([...game.enemies.values()][0].x, 999);
});

test('landing stays safe after nearby aggro and camp guards return home without respawning', () => {
  const { game, p } = setup(); locate(p, { x: -20, z: 74 }); p.invulnerableUntil = 10;
  ticks(game, 2);
  assert.ok([...game.enemies.values()].some(e => e.state === 'chase' || e.state === 'windup'), 'inland player attracts nearby camp');
  locate(p, { x: -10, z: 85 }); p.invulnerableUntil = 0; p.hp = 100;
  for (let i = 0; i < 240; i++) {
    game.tick(.05);
    assert.equal(p.hp, 100, 'safe beach rejects camp splash damage');
    assert.ok([...game.enemies.values()].every(e => !inSafeLanding(e)), 'camp pursuit never enters safe beach');
  }
  assert.ok([...game.enemies.values()].every(e => Math.hypot(e.x - e._home.x, e.z - e._home.z) < 6), 'guards leash home');
  for (const enemy of [...game.enemies.values()]) game.damageEnemy(enemy, enemy.hp, p.id);
  assert.equal(game.enemies.size, 0); ticks(game, 30); assert.equal(game.enemies.size, 0);
  assert.equal(p.kills, 24);
});

test('all three shrines scale 3–11 for one through five pirates and remain finite after clearing patrols', () => {
  const expectedTotals = [3, 5, 7, 9, 11];
  for (let count = 1; count <= MAX_PLAYERS; count++) {
    const { game, p } = setup(count);
    for (const enemy of [...game.enemies.values()]) game.damageEnemy(enemy, enemy.hp, p.id);
    p.invulnerableUntil = 1000;
    for (const [index, shrine] of SHRINES.entries()) {
      locate(p, shrine);
      assert.equal(game.action(p.id, 'interact', shrine.id).ok, true);
      const expected = expectedTotals[count - 1], guards = [...game.enemies.values()];
      assert.equal(guards.length, expected); assert.equal(game.shrines[index].remaining, expected);
      assert.ok(guards.every(enemy => enemy._shrine === shrine.id), 'only the active shrine has guards');
      assert.equal(guards.filter(enemy => enemy.type === 'spitter').length, count === 1 ? 0 : 1);
      assert.equal(guards.filter(enemy => enemy.type === 'crab').length, expected - (count === 1 ? 0 : 1));
      ticks(game, 30); assert.equal(game.enemies.size, expected);
      assert.equal(game.action(p.id, 'interact', shrine.id).ok, false);
      for (const enemy of guards) game.damageEnemy(enemy, enemy.hp, p.id);
      ticks(game, 5.1); assert.equal(game.shrines[index].status, 'cleared'); assert.equal(game.shards, index + 1);
      ticks(game, 15); assert.equal(game.enemies.size, 0);
      assert.ok(game.shrines.slice(0, index + 1).every(s => s.status === 'cleared' && s.remaining === 0));
    }
  }
});

test('offline reservations do not inflate encounters and late arrivals affect only future shrine starts', () => {
  const game = new Game();
  for (let i = 0; i < MAX_PLAYERS; i++) game.addPlayer(`p${i}`, `Crew ${i}`, COLORS[i]);
  for (let i = 1; i < MAX_PLAYERS; i++) game.disconnect(`p${i}`);
  const p = game.players.get('p0');
  assert.equal(game.players.size, MAX_PLAYERS); assert.equal(game.onlineCount, 1);
  assert.equal(game.action(p.id, 'launch').ok, true); assert.equal(game.enemies.size, 24);
  for (const enemy of [...game.enemies.values()]) game.damageEnemy(enemy, enemy.hp, p.id);
  assert.ok(game.reconnect('p1')); assert.equal(game.enemies.size, 0, 'reconnect does not replenish patrols');
  p.invulnerableUntil = 1000;
  const expectedTotals = [5, 9, 7];
  for (const [index, shrine] of SHRINES.entries()) {
    locate(p, shrine);
    assert.equal(game.action(p.id, 'interact', shrine.id).ok, true);
    assert.equal(game.enemies.size, expectedTotals[index]);
    assert.equal(game.shrines[index].remaining, expectedTotals[index]);
    if (index === 0) {
      const guardIds = [...game.enemies.keys()];
      assert.ok(game.addPlayer('late1', 'Late pirate', COLORS[2]));
      assert.deepEqual([...game.enemies.keys()], guardIds, 'joining does not enlarge an active shrine');
    }
    for (const enemy of [...game.enemies.values()]) game.damageEnemy(enemy, enemy.hp, p.id);
    ticks(game, 5.1); assert.equal(game.shrines[index].status, 'cleared');
    if (index === 0) assert.ok(game.addPlayer('late2', 'Later pirate', COLORS[3]));
    if (index === 1) game.disconnect('late2');
    assert.equal(game.enemies.size, 0, 'crew changes do not replenish cleared encounters');
  }
  ticks(game, 30); assert.equal(game.enemies.size, 0); assert.equal(game.shards, 3);
  assert.ok(game.shrines.every(shrine => shrine.status === 'cleared' && shrine.remaining === 0));
});
