import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { COLORS, SPAWN, SHRINES, CHESTS, BEACON, heightAt } from '../shared/world.js';
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

test('finite launch populations scale 24–36 with mixed guards at every destination and clear spawns', () => {
  assert.deepEqual(new Set(ENCOUNTER_GROUPS.map(g => g.id)), new Set(POINTS_OF_INTEREST.map(p => p.id)));
  for (let count = 1; count <= 5; count++) {
    const { game } = setup(count), spawns = encounterSpawns(count);
    assert.equal(game.enemies.size, 24 + (count - 1) * 3);
    assert.deepEqual(encounterSpawns(count), spawns, 'repeatable encounter placement');
    for (const group of ENCOUNTER_GROUPS) {
      const guards = [...game.enemies.values()].filter(e => e._camp === group.id);
      assert.ok(guards.length >= 3 && guards.length <= 5, group.id);
      assert.equal(guards.filter(e => e.type === 'spitter').length, 1, `${group.id} has one ranged guard`);
      assert.ok(guards.every(e => Math.hypot(e.x - group.x, e.z - group.z) < 12), group.id);
    }
    for (const enemy of game.enemies.values()) {
      assert.ok(!inSafeLanding(enemy)); assert.ok(Math.hypot(enemy.x - SPAWN.x, enemy.z - SPAWN.z) >= SAFE_LANDING_RADIUS);
      assert.ok([BEACON, ...CHESTS, ...SHRINES].every(p => Math.hypot(enemy.x - p.x, enemy.z - p.z) >= 3.6), `${enemy.id} loot/objective clearance`);
      const resolved = resolveWorldCollision({ x: enemy.x, y: enemy.y, z: enemy.z }, enemy.radius * .7);
      assert.ok(Math.hypot(resolved.x - enemy.x, resolved.z - enemy.z) < .000001, `${enemy.id} starts clear of solid walls/props`);
      assert.equal(enemy.y, heightAt(enemy.x, enemy.z));
    }
  }
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

test('solo and five-player shrine fights remain independently finite after clearing patrols', () => {
  for (const count of [1, 5]) {
    const { game, p } = setup(count);
    for (const enemy of [...game.enemies.values()]) game.damageEnemy(enemy, enemy.hp, p.id);
    locate(p, SHRINES[0]); p.invulnerableUntil = 1000;
    assert.equal(game.action(p.id, 'interact', SHRINES[0].id).ok, true);
    const expected = count === 1 ? 3 : 5;
    assert.equal(game.enemies.size, expected); assert.equal(game.shrines[0].remaining, expected);
    ticks(game, 30); assert.equal(game.enemies.size, expected);
    assert.equal(game.action(p.id, 'interact', SHRINES[0].id).ok, false);
    for (const enemy of [...game.enemies.values()]) game.damageEnemy(enemy, enemy.hp, p.id);
    ticks(game, 5.1); assert.equal(game.shrines[0].status, 'cleared'); assert.equal(game.shards, 1);
    ticks(game, 15); assert.equal(game.enemies.size, 0); assert.equal(game.shrines[0].status, 'cleared');
  }
});
