import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlayerPosition, movePlayer } from '../shared/movement.js';
import { SPAWN, BEACON, SHRINES, OBSTACLES, WORLD_RADIUS, SHIP_DURATION, heightAt, regionAt, shipAt, seededRandom } from '../shared/world.js';
import { SHIP_DECK } from '../shared/airship.js';

function ground(x = SPAWN.x, z = SPAWN.z) {
  return { ...makePlayerPosition(), x, z, y: heightAt(x, z), mode: 'ground', grounded: true };
}

test('shared terrain is finite, continuous, and includes five themed regions', () => {
  for (const point of [SPAWN, BEACON, ...SHRINES]) {
    assert.ok(heightAt(point.x, point.z) >= 2);
    assert.equal(typeof regionAt(point.x, point.z).name, 'string');
  }
  for (let x = -140; x <= 140; x += 2) for (let z = -140; z <= 140; z += 2) {
    assert.ok(Number.isFinite(heightAt(x, z)));
    assert.ok(Math.abs(heightAt(x + 0.01, z) - heightAt(x, z)) < 0.04);
  }
  assert.ok(heightAt(150, 0) < 0);
  assert.equal(regionAt(-68, 12).id, 'jungle');
  assert.equal(regionAt(48, -65).id, 'volcano');
  assert.equal(regionAt(76, 32).id, 'moon');
});

test('broad direct routes from haven reach every shrine and the landing beach', () => {
  for (const endpoint of [SPAWN, ...SHRINES]) {
    const p = ground(BEACON.x, BEACON.z);
    let steps = 0;
    while (Math.hypot(p.x - endpoint.x, p.z - endpoint.z) > 0.7 && steps++ < 500) {
      const yaw = Math.atan2(-(endpoint.x - p.x), -(endpoint.z - p.z));
      movePlayer(p, { forward: 1, yaw, sprint: true }, 0.05, steps * 0.05);
    }
    assert.ok(steps < 500, `Walkable route to ${endpoint.id ?? 'spawn'}`);
    assert.ok(Math.abs(p.y - heightAt(p.x, p.z)) < 0.001);
  }
});

test('movement normalization and yaw use the documented third-person basis', () => {
  const p = ground();
  movePlayer(p, { forward: 1, right: 1, yaw: 0 }, 0.05, 1);
  assert.ok(Math.abs(Math.hypot(p.x, p.z - SPAWN.z) - 0.4) < 1e-8);
  assert.ok(p.x > 0 && p.z < SPAWN.z);
  const q = ground();
  movePlayer(q, { forward: 1, yaw: Math.PI / 2, sprint: true }, 0.05, 1);
  assert.ok(Math.abs(q.x + 0.55) < 1e-8);
  assert.ok(Math.abs(q.z - SPAWN.z) < 1e-8);
});

test('lobby deck, voluntary drop, glide landing, and automatic drop are safe', () => {
  const p = makePlayerPosition();
  // Follow the clear aisle past the mast and fore gun before testing the bow rail.
  for (let i = 0; i < 8; i++) movePlayer(p, { right: 1, yaw: 0 }, 0.05, 0);
  for (let i = 0; i < 100; i++) movePlayer(p, { forward: 1, yaw: 0 }, 0.05, 0);
  for (let i = 0; i < 20; i++) movePlayer(p, { right: 1, yaw: 0 }, 0.05, 0);
  assert.equal(p.deckX, SHIP_DECK.maxX); assert.equal(p.deckZ, SHIP_DECK.minZ);
  assert.equal(p.y, shipAt(0).y);
  movePlayer(p, { jump: true, yaw: 0 }, 0.05, 1);
  assert.equal(p.mode, 'gliding');
  for (let i = 0; i < 250; i++) movePlayer(p, { yaw: 0 }, 0.05, 1 + i * 0.05);
  assert.equal(p.mode, 'ground'); assert.equal(p.y, heightAt(p.x, p.z));
  const q = makePlayerPosition();
  movePlayer(q, {}, 0.05, SHIP_DURATION);
  assert.equal(q.mode, 'gliding'); assert.equal(q.x, SPAWN.x); assert.equal(q.z, SPAWN.z);
});

test('jump is edge triggered, obstacles collide, and water returns pirates safely', () => {
  const p = ground();
  for (let i = 0; i < 50; i++) movePlayer(p, { jump: true }, 0.05, i * 0.05);
  assert.equal(p.grounded, true); assert.equal(p.vy, 0);
  movePlayer(p, { jump: false }, 0.05, 3);
  movePlayer(p, { jump: true }, 0.05, 3.05);
  assert.equal(p.grounded, false); assert.ok(p.vy > 0);
  const obstacle = OBSTACLES[0], q = ground(obstacle.x + obstacle.radius + 1, obstacle.z);
  for (let i = 0; i < 100; i++) movePlayer(q, { right: -1 }, 0.05, i * 0.05);
  assert.ok(Math.hypot(q.x - obstacle.x, q.z - obstacle.z) >= obstacle.radius + 0.599);
  const r = ground(WORLD_RADIUS + 1, 0);
  movePlayer(r, {}, 0.05, 1);
  assert.equal(r.x, SPAWN.x); assert.equal(r.z, SPAWN.z); assert.equal(r.mode, 'ground');
});

test('aboard movement respects both masts and the cabin while keeping the deck usable', () => {
  const p = makePlayerPosition(); p.deckX = -1.2; p.deckZ = -7.2;
  for (let i = 0; i < 20; i++) movePlayer(p, { right: 1 }, 0.05, 0);
  assert.ok(Math.hypot(p.deckX, p.deckZ + 7.2) >= 0.8999);
  const q = makePlayerPosition(); q.deckX = 1.5; q.deckZ = 8.3;
  for (let i = 0; i < 20; i++) movePlayer(q, { forward: -1 }, 0.05, 0);
  assert.ok(q.deckZ <= 9.0751, 'cannot walk through the aft cabin wall');
  for (let i = 0; i < 20; i++) movePlayer(q, { right: 1 }, 0.05, 0);
  assert.equal(q.deckX, SHIP_DECK.maxX, 'side deck remains reachable');
});

test('prediction is deterministic and invalid numeric input cannot corrupt position', () => {
  const a = ground(), b = ground(), random = seededRandom(42);
  for (let i = 0; i < 1000; i++) {
    const input = { forward: random() * 2 - 1, right: random() * 2 - 1, yaw: random() * 6, jump: i % 30 === 0, sprint: i % 3 === 0 };
    movePlayer(a, input, 0.05, i * 0.05); movePlayer(b, input, 0.05, i * 0.05);
  }
  assert.deepEqual(a, b);
  const before = { ...a };
  movePlayer(a, { forward: NaN, right: Infinity, yaw: NaN, pitch: NaN }, Infinity, 1);
  assert.equal(a.x, before.x); assert.equal(a.z, before.z);
  assert.ok(Number.isFinite(a.yaw));
  const r1 = seededRandom(5), r2 = seededRandom(5);
  assert.deepEqual(Array.from({ length: 8 }, r1), Array.from({ length: 8 }, r2));
});
