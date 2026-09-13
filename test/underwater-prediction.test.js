import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPrediction } from '../client/prediction.js';
import { createRemoteInterpolation, displayedSpeed, poseDiscontinuity } from '../client/interpolation.js';
import { REEF_SPAWN } from '../shared/underwater.js';
import { heightAt } from '../shared/world.js';

const input = (overrides = {}) => ({ forward: 1, right: 0, sprint: false, jump: false, dive: false, yaw: 0, pitch: 0, ...overrides });
const island = (overrides = {}) => ({ id: 'local', realm: 'island', mode: 'ground', x: 14, y: heightAt(14, 106), z: 106,
  yaw: 0, pitch: 0, vy: 0, grounded: true, jumpHeld: false, gunId: null, shipReturned: false, knockedUntil: 0, lastInputSeq: 0, ...overrides });
const reef = (overrides = {}) => ({ ...island(), realm: 'reef', mode: 'swimming', ...REEF_SPAWN, grounded: false, ...overrides });

test('a land-to-reef authority snapshot discards land input history instead of replaying it underwater', () => {
  const prediction = new LocalPrediction(); prediction.reset(island(), { simulationTime: 4 });
  prediction.step(1, input(), 4.05, 'voyage'); prediction.step(2, input({ sprint: true }), 4.1, 'voyage');
  assert.equal(prediction.pending.length, 2);
  const arrived = reef({ lastInputSeq: 0 });
  prediction.reconcile(arrived, { phase: 'voyage', elapsed: 4.1, simulationTime: 4.1, renderElapsed: 4.1, alpha: .5 });
  assert.equal(prediction.current.realm, 'reef'); assert.equal(prediction.current.mode, 'swimming');
  assert.deepEqual(prediction.pending, []); assert.deepEqual(prediction.history, []);
  assert.deepEqual({ x: prediction.current.x, y: prediction.current.y, z: prediction.current.z }, REEF_SPAWN);
});

test('a reef-to-island return drops held dive and swim history at the travel boundary', () => {
  const prediction = new LocalPrediction(); prediction.reset(reef(), { simulationTime: 8 });
  prediction.step(1, input({ forward: 0, dive: true }), 8.05, 'voyage');
  assert.ok(prediction.current.y < REEF_SPAWN.y);
  const shore = island({ x: 14, z: 106, lastInputSeq: 0 });
  prediction.reconcile(shore, { phase: 'voyage', elapsed: 8.05, simulationTime: 8.05, renderElapsed: 8.05, alpha: 0 });
  assert.equal(prediction.current.realm, 'island'); assert.equal(prediction.current.mode, 'ground');
  assert.equal(prediction.current.y, shore.y); assert.deepEqual(prediction.pending, []);
});

test('remote interpolation starts a fresh track when a crewmate changes realms at the same coordinates', () => {
  const buffer = createRemoteInterpolation({ delay: 0 });
  const first = island({ x: 0, y: 5, z: 0 });
  buffer.push([first], { receivedAt: 0, snapshotTime: 1, round: 1, phase: 'voyage' });
  const generation = buffer.sample(first.id, 0).generation;
  const traveled = reef({ x: 0, y: 5, z: 0 });
  assert.equal(poseDiscontinuity(first, traveled), true);
  buffer.push([traveled], { receivedAt: 50, snapshotTime: 1.05, round: 1, phase: 'voyage' });
  const sample = buffer.sample(first.id, 50);
  assert.notEqual(sample.generation, generation); assert.equal(buffer.count(first.id), 1);
  assert.equal(displayedSpeed(first, sample.player, .05), 0);
});
