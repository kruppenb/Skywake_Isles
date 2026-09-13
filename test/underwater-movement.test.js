import test from 'node:test';
import assert from 'node:assert/strict';
import { movePlayer } from '../shared/movement.js';
import { REEF_BOUNDS, REEF_SOLIDS, REEF_SWIMMER_BODY, reefLineOfSight, resolveReefCollision, resolveReefSwimmerCollision } from '../shared/underwater.js';

test('Sunken Reach swimming stays finite, bounded, and truly three dimensional', () => {
  const swimmer = { realm: 'reef', mode: 'swimming', x: -18, y: 6, z: 20, yaw: 0, pitch: 0 };
  movePlayer(swimmer, { forward: 1, right: 1, jump: true, dive: false, sprint: true, yaw: 0, pitch: 0 }, .05);
  assert.ok(swimmer.y > 6 && swimmer.x > -18 && swimmer.z < 20);
  const before = { ...swimmer };
  movePlayer(swimmer, { forward: 0, right: 0, jump: true, dive: true, yaw: 0, pitch: 0 }, .05);
  assert.deepEqual({ x: swimmer.x, y: swimmer.y, z: swimmer.z }, { x: before.x, y: before.y, z: before.z });
  Object.assign(swimmer, { x: Infinity, y: -99, z: NaN });
  movePlayer(swimmer, {}, 10);
  assert.ok(Number.isFinite(swimmer.x) && Number.isFinite(swimmer.y) && Number.isFinite(swimmer.z));
  assert.ok(swimmer.x >= REEF_BOUNDS.minX && swimmer.x <= REEF_BOUNDS.maxX);
  const low = { realm: 'reef', mode: 'swimming', x: -18, y: -99, z: 20, yaw: 0, pitch: 0 };
  const high = { realm: 'reef', mode: 'swimming', x: -18, y: 99, z: 20, yaw: 0, pitch: 0 };
  movePlayer(low, {}, .05); movePlayer(high, {}, .05);
  assert.equal(low.y, REEF_BOUNDS.minY - REEF_SWIMMER_BODY.minOffsetY, 'model bottom stays inside reef bounds');
  assert.equal(high.y, REEF_BOUNDS.maxY - REEF_SWIMMER_BODY.maxOffsetY, 'model head stays inside reef bounds');
});

test('canonical wreck solids block at their height while preserving vertical routes', () => {
  const rib = REEF_SOLIDS.find(box => box.id === 'wreck-rib-a');
  const inside = { x: rib.x, y: rib.y, z: rib.z };
  resolveReefCollision(inside, .6);
  assert.notDeepEqual(inside, { x: rib.x, y: rib.y, z: rib.z });
  assert.equal(reefLineOfSight({ x: rib.x, y: 4, z: rib.z - 7 }, { x: rib.x, y: 4, z: rib.z + 7 }), true, 'route below rib stays clear');
  assert.equal(reefLineOfSight({ x: rib.x, y: rib.y, z: rib.z - 7 }, { x: rib.x, y: rib.y, z: rib.z + 7 }), false, 'rib blocks at its own height');
  assert.equal(reefLineOfSight({ x: 8, y: 8, z: 4 }, { x: 8, y: 8, z: -15 }), true, 'open roof permits an overhead route');
});

test('upright swimmer capsule clears its head under a rib while preserving the route beneath it', () => {
  const rib = REEF_SOLIDS.find(box => box.id === 'wreck-rib-a');
  const headFirst = { x: rib.x, y: 3.3, z: rib.z };
  resolveReefSwimmerCollision(headFirst);
  const ribBottom = rib.y - rib.height / 2;
  assert.ok(headFirst.y + REEF_SWIMMER_BODY.maxOffsetY <= ribBottom + 1e-8,
    'collision lowers the avatar origin until its rendered head has clearance');
  const swimmer = { realm: 'reef', mode: 'swimming', x: rib.x, y: 2.9, z: -2, yaw: 0, pitch: 0 };
  for (let step = 0; step < 3; step++) movePlayer(swimmer, { forward: 1, right: 0, yaw: 0, pitch: 0 }, .05);
  assert.ok(swimmer.z < -2.5 && Math.abs(swimmer.x - rib.x) < .001, 'the low route passes beneath the suspended rib');
  assert.ok(swimmer.y + REEF_SWIMMER_BODY.maxOffsetY <= ribBottom + 1e-8);
});
