import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { BEACON, heightAt } from '../shared/world.js';
import { DIVE_ENTRANCE, REEF_CHEST, REEF_EXIT, REEF_SPAWN } from '../shared/underwater.js';

const placeAtDive = p => Object.assign(p, { x: DIVE_ENTRANCE.x, y: heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z), z: DIVE_ENTRANCE.z, realm: 'island', mode: 'ground', grounded: true });

test('dive is server-gated, creates one finite reef encounter, and grants its chest once', () => {
  const game = new Game({ random: () => .5 });
  const a = game.addPlayer('a', 'A', '#f00'), b = game.addPlayer('b', 'B', '#0f0');
  game.phase = 'voyage';
  assert.equal(game.action(a.id, 'interact', DIVE_ENTRANCE.id).ok, false, 'remote portal request is denied');
  placeAtDive(a); placeAtDive(b);
  assert.equal(game.action(a.id, 'interact', DIVE_ENTRANCE.id).ok, true);
  assert.equal(game.snapshot().underwater.remaining, 3);
  assert.equal(game.snapshot().enemies.filter(e => e.realm === 'reef').length, 3);
  game.tick(.05);
  assert.ok([...game.enemies.values()].filter(e => e.realm === 'reef').every(e => e.state === 'idle'), 'entry current does not draw guard aggro');
  game.action(b.id, 'interact', DIVE_ENTRANCE.id);
  assert.equal(game.snapshot().enemies.filter(e => e.realm === 'reef').length, 3, 'later divers cannot duplicate guards');
  for (const guard of [...game.enemies.values()].filter(e => e.realm === 'reef')) game.damageEnemy(guard, guard.hp, a.id);
  Object.assign(a, { x: REEF_CHEST.x, y: REEF_CHEST.y, z: REEF_CHEST.z });
  assert.equal(game.action(a.id, 'interact', REEF_CHEST.id).ok, true);
  assert.equal(game.snapshot().underwater.chestOpened, true);
  assert.equal(game.snapshot().drops.filter(drop => drop.realm === 'reef').length, 1);
  assert.equal(game.action(a.id, 'interact', REEF_CHEST.id).ok, false, 'the chest cannot pay twice');
  Object.assign(a, { x: REEF_EXIT.x, y: REEF_EXIT.y, z: REEF_EXIT.z });
  assert.equal(game.action(a.id, 'interact', REEF_EXIT.id).ok, true);
  assert.deepEqual({ realm: a.realm, mode: a.mode, dive: a._input.dive }, { realm: 'island', mode: 'ground', dive: false });
});

test('reef rescue and finale keep realms separated and return reserved crew', () => {
  const game = new Game();
  const a = game.addPlayer('a', 'A', '#f00'), b = game.addPlayer('b', 'B', '#0f0');
  game.phase = 'voyage'; placeAtDive(a); placeAtDive(b); game.action(a.id, 'interact', DIVE_ENTRANCE.id); game.action(b.id, 'interact', DIVE_ENTRANCE.id);
  a.hp = 0; a.knockedUntil = game.elapsed + .01; game.tick(.05);
  assert.deepEqual({ x: a.x, y: a.y, z: a.z, realm: a.realm }, { ...REEF_SPAWN, realm: 'reef' }, 'reef auto-rescue uses the reef spawn');
  b.online = false; b._expiresAt = game.clock + 60;
  game.shards = 3; Object.assign(a, { x: BEACON.x, y: heightAt(BEACON.x, BEACON.z), z: BEACON.z, realm: 'island', mode: 'ground', grounded: true });
  assert.equal(game.action(a.id, 'interact', BEACON.id).ok, true);
  assert.equal(game.phase, 'finale');
  assert.equal(b.realm, 'island', 'disconnected reserved crew returns too');
  assert.equal(game.snapshot().enemies.some(e => e.realm === 'reef'), false);
});

test('reef combat is height-aware, occluded by the wreck, and cannot affect an overlapping island realm', () => {
  const game = new Game();
  const a = game.addPlayer('a', 'A', '#f00'), b = game.addPlayer('b', 'B', '#0f0');
  game.phase = 'voyage';
  Object.assign(a, { realm: 'reef', mode: 'swimming', x: 0, y: 8, z: 10, yaw: 0, pitch: 0, grounded: false });
  Object.assign(b, { realm: 'island', mode: 'ground', x: 0, y: 8, z: 10, hp: 40, grounded: true, knockedUntil: 0 });
  const guard = game.spawnReefEnemy({ x: 0, y: 8, z: 3 }), hp = guard.hp;
  assert.equal(game.action(a.id, 'fire').ok, true);
  assert.ok(guard.hp < hp, 'an aimed shot can hit a hovering guard at matching height');
  const blocked = game.spawnReefEnemy({ x: 22, y: 4, z: -10 });
  assert.equal(game.raycast({ x: 18, y: 4, z: -10 }, { x: 1, y: 0, z: 0 }, 10, 'reef'), null, 'wreck wall clips a reef shot');
  const land = game.spawnEnemy('crab', 0, 10, 'haven'), landHp = land.hp;
  game.action(a.id, 'melee'); game.action(a.id, 'heal');
  assert.equal(land.hp, landHp, 'reef melee cannot strike an island enemy at matching map coordinates');
  assert.equal(b.hp, 40, 'reef heal cannot cross realms');
  b.knockedUntil = game.elapsed + 5;
  assert.equal(game.action(a.id, 'interact', b.id).ok, false, 'reef revive rejects an island player even when coordinates overlap');
  // This position is outside the entry pocket; the real guard must telegraph
  // and land a slow bubble after its windup, while the pocket itself remained
  // safe in the earlier test.
  for (let tick = 0; tick < 70; tick++) game.tick(.05);
  assert.ok(a.hp < 100, 'reef guard bubble damages a swimmer only after a telegraph/windup');
  assert.ok(game.snapshot().enemies.some(enemy => enemy.id === blocked.id && enemy.realm === 'reef'));
});
