import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteInterpolation, displayedSpeed, makeTracerFlight, sampleTracerFlight } from '../client/interpolation.js';
import { shipAt } from '../shared/world.js';
import * as THREE from 'three';
import { makePalette, buildPirate, buildWeapon } from '../client/models.js';
import { WEAPON_ORDER } from '../shared/weapons.js';
import { findInteractable } from '../client/ui.js';
import { BUILDINGS, buildingWorldPoint } from '../shared/exploration.js';
import { heightAt } from '../shared/world.js';
import { cameraTravel } from '../client/camera.js';

const pirate = (overrides = {}) => ({ id: 'crew', online: true, x: 0, y: 5, z: 0, deckX: 0, deckZ: 0, yaw: 0, pitch: 0, mode: 'ground', knockedUntil: 0, ...overrides });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} vs ${expected}`);
function receive(buffer, at, player, options = {}) {
  buffer.push([player], { receivedAt: at, snapshotTime: at / 1000, round: 1, phase: 'voyage', ...options });
}

test('remote 20 Hz walking presents a constant velocity at 30, 60 and 144 Hz', () => {
  for (const fps of [30, 60, 144]) {
    const buffer = createRemoteInterpolation();
    let nextPacket = 0, previous = null;
    for (let frame = 0; frame <= fps * 2; frame++) {
      const now = frame * 1000 / fps;
      while (nextPacket <= now + 1e-8) {
        receive(buffer, nextPacket, pirate({ x: nextPacket / 1000 * 8 })); nextPacket += 50;
      }
      const result = buffer.sample('crew', now);
      near(result.player.x, Math.max(0, now - 100) / 1000 * 8, `position at ${fps} fps`);
      if (previous && now > 100 + 1000 / fps) near(displayedSpeed(previous, result.player, 1 / fps), 8, 'gait follows displayed movement');
      previous = result.player;
    }
    assert.ok(buffer.count('crew') <= 12, 'history stays bounded');
  }
});

test('remote crew stand on the currently rendered ship without walking from its transport', () => {
  const buffer = createRemoteInterpolation();
  receive(buffer, 1000, pirate({ mode: 'aboard', deckX: 1.2, deckZ: -3.2, ...shipAt(1) }));
  receive(buffer, 1050, pirate({ mode: 'aboard', deckX: 1.2, deckZ: -3.2, ...shipAt(1.05) }));
  let previous = null;
  for (let i = 0; i < 120; i++) {
    const elapsed = 1.1 + i / 60, ship = shipAt(elapsed);
    const { player } = buffer.sample('crew', elapsed * 1000, ship);
    near(player.x - ship.x, 1.2, 'deck X is preserved');
    near(player.z - ship.z, -3.2, 'delayed snapshots never delay ship translation');
    near(player.y, ship.y, 'feet follow the same ship bob');
    near(displayedSpeed(previous, player, 1 / 60), 0, 'transport does not advance gait'); previous = player;
  }
  const ship = shipAt(3.1), walking = { ...previous, x: ship.x + 1.4, y: ship.y, z: ship.z - 3.2, deckX: 1.4 };
  near(displayedSpeed(previous, walking, .025), 8, 'deck-relative walking still animates');
});

test('remote turns interpolate shortest yaw and stops never extrapolate past the endpoint', () => {
  const buffer = createRemoteInterpolation();
  receive(buffer, 0, pirate({ x: 0, yaw: Math.PI - .1, pitch: -.4 }));
  receive(buffer, 50, pirate({ x: .4, yaw: -Math.PI + .1, pitch: .4 }));
  const middle = buffer.sample('crew', 125).player;
  near(middle.x, .2, 'middle of movement sample'); near(middle.yaw, Math.PI, 'short yaw path'); near(middle.pitch, 0, 'pitch interpolation');
  receive(buffer, 100, pirate({ x: .4, yaw: -Math.PI + .1, pitch: .4 }));
  for (const now of [175, 200, 250, 10000]) near(buffer.sample('crew', now).player.x, .4, 'stationary or stalled sample holds without overshoot');
});

test('snapshots reset on teleport, mode changes, rescue, a long stall, new round and rejoin', () => {
  const buffer = createRemoteInterpolation();
  receive(buffer, 0, pirate());
  let generation = buffer.sample('crew', 0).generation;
  for (const [at, player, options] of [
    [50, pirate({ x: 80 })],
    [100, pirate({ x: 80, mode: 'gliding' })],
    [150, pirate({ x: 80, mode: 'gliding', knockedUntil: 9 })],
    [200, pirate({ x: 80, mode: 'gliding' })],
    [1000, pirate({ x: 82, mode: 'gliding' })],
    [1050, pirate({ x: 2 }), { round: 2 }],
  ]) {
    receive(buffer, at, player, options);
    const result = buffer.sample('crew', at);
    assert.notEqual(result.generation, generation); assert.equal(buffer.count('crew'), 1);
    near(result.player.x, player.x, 'fresh history presents the new pose'); generation = result.generation;
  }
  receive(buffer, 1100, pirate({ online: false }), { round: 2 });
  assert.equal(buffer.sample('crew', 1100), null);
  receive(buffer, 1150, pirate({ x: 3 }), { round: 2 });
  assert.notEqual(buffer.sample('crew', 1150).generation, generation);
});

test('re-rendered snapshots are not re-buffered and the source-identity fallback is stable', () => {
  const buffer = createRemoteInterpolation();
  const source = pirate({ x: 2 });
  receive(buffer, 100, source);
  receive(buffer, 100, pirate({ x: 900 }));
  assert.equal(buffer.count('crew'), 1); near(buffer.sample('crew', 200).player.x, 2, 'same receipt is ignored');
  source.x = 70; near(buffer.sample('crew', 200).player.x, 2, 'buffer keeps immutable copies');
  buffer.clear();
  const sources = [pirate({ x: 4 })];
  buffer.push(sources, { now: 100 }); buffer.push(sources, { now: 116 }); buffer.push(sources, { now: 132 });
  assert.equal(buffer.count('crew'), 1);
  buffer.push([pirate({ x: 4.4 })], { now: 150 }); assert.equal(buffer.count('crew'), 2);
});

test('gait is zero on first appearance, snap, stale frame, knock and glide', () => {
  const previous = pirate(), current = pirate({ x: .4 });
  assert.equal(displayedSpeed(null, current, .05), 0);
  assert.equal(displayedSpeed(previous, current, .05, true), 0);
  assert.equal(displayedSpeed(previous, current, .5), 0);
  assert.equal(displayedSpeed(previous, { ...current, knockedUntil: 4 }, .05), 0);
  assert.equal(displayedSpeed({ ...previous, mode: 'gliding' }, { ...current, mode: 'gliding' }, .05), 0);
  assert.equal(displayedSpeed(previous, pirate({ x: 50 }), .05), 0);
});

test('tracer heads travel visibly, trail behind, reach the authoritative endpoint and fade', () => {
  for (const weapon of WEAPON_ORDER) {
    const from = { x: 3, y: 7, z: 2 }, to = { x: 3, y: 7, z: -28 }, flight = makeTracerFlight(from, to, weapon);
    assert.ok(flight.duration >= .18 && flight.duration <= .3);
    const initial = sampleTracerFlight(flight, 0), half = sampleTracerFlight(flight, flight.duration / 2);
    assert.equal(initial.head, 0); assert.equal(initial.tail, 0);
    near(half.head, 15, 'head moves toward endpoint'); assert.ok(half.tail > 0 && half.tail < half.head);
    assert.equal(half.arrived, false); assert.equal(half.opacity, 1);
    const arrival = sampleTracerFlight(flight, flight.duration);
    near(arrival.head, 30, 'authoritative distance'); assert.equal(arrival.arrived, true);
    const expired = sampleTracerFlight(flight, flight.duration + flight.fade + .001);
    assert.equal(expired.opacity, 0); near(expired.tail, 30, 'trail contracts at endpoint');
  }
  assert.equal(makeTracerFlight({ x: NaN, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }), null);
  assert.equal(makeTracerFlight({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), null);
  assert.equal(makeTracerFlight({ x: -1e308, y: 0, z: 0 }, { x: 1e308, y: 0, z: 0 }), null);
  assert.equal(makeTracerFlight({ x: 0, y: 0, z: 0 }, { x: 500, y: 0, z: 0 }).duration, .45);
});

test('all five gun models expose distinct silhouettes and live muzzle sockets across poses', () => {
  const palette = makePalette(), model = buildPirate(palette), signatures = new Set();
  for (const weapon of WEAPON_ORDER) {
    const gun = buildWeapon(palette, weapon);
    const bounds = new THREE.Box3().setFromObject(gun.group).getSize(new THREE.Vector3());
    signatures.add([bounds.x, bounds.y, bounds.z].map(value => value.toFixed(3)).join(':'));
    for (const mode of ['ground', 'gliding']) {
      model.animate(1, 4, { mode, weapon, pitch: -.2, rarity: 'epic' }, { dt: .05, elapsed: 1, aiming: true });
      model.fire(weapon); model.animate(1.05, 0, { mode, weapon, pitch: -.2 }, { dt: .05, elapsed: 1.05 });
      const socket = model.group.getObjectByName(`${mode === 'gliding' ? 'stowed-muzzle' : 'muzzle'}-${weapon}`);
      assert.ok(socket && socket.parent.visible, `${weapon} is equipped ${mode}`);
      const muzzle = model.getMuzzle();
      assert.ok(muzzle.distanceTo(socket.getWorldPosition(new THREE.Vector3())) < 1e-8);
      assert.ok([muzzle.x, muzzle.y, muzzle.z].every(Number.isFinite));
    }
  }
  assert.equal(signatures.size, 5, 'each gun has a different physical envelope');
});

test('loot prompts include rarity, favor reachable pickups, and never pass through building walls', () => {
  const building = BUILDINGS.find(entry => entry.enterable);
  const at = (x, z) => { const point = buildingWorldPoint(building, x, z); return { ...point, y: heightAt(point.x, point.z) }; };
  const player = { ...pirate(), ...at(0, building.depth / 2 + 1), inventory: {}, mode: 'ground' };
  const drop = { ...at(0, building.depth / 2 - 1), id: 'test-loot', weapon: 'longshot', rarity: 'legendary' };
  const state = { elapsed: 0, phase: 'voyage', shards: 0, players: [player], chests: [], shrines: [], drops: [drop] };
  const prompt = findInteractable(state, player);
  assert.equal(prompt?.id, drop.id); assert.match(prompt.label, /Pick up Legendary Longshot/);
  Object.assign(player, at(building.width / 2 + 1, 0)); Object.assign(drop, at(building.width / 2 - 1, 0));
  assert.notEqual(findInteractable(state, player)?.id, drop.id);
});

test('camera carries the rendered travel delta exactly and has no catch-up after release', () => {
  for (const fps of [30, 60, 144]) {
    let previous = null, cameraZ = 7.45;
    for (let frame = 0; frame < fps * 2; frame++) {
      const player = pirate({ z: -Math.min(1, frame / fps) * 8 });
      const travel = cameraTravel(previous, player, { round: 2 }); previous = travel.anchor;
      if (travel.delta) cameraZ += travel.delta.z;
      near(cameraZ - player.z, 7.45, 'camera offset never trails movement');
      if (frame > fps) near(travel.delta.z, 0, 'stationary camera stays stationary');
    }
    for (const options of [{ menu: true, round: 2 }, { round: 3 }]) assert.equal(cameraTravel(previous, pirate({ z: -8 }), options).delta, null);
    for (const player of [pirate({ id: 'new', z: -8 }), pirate({ mode: 'gliding', z: -8 }), pirate({ z: 60 })]) {
      const travel = cameraTravel(previous, player, { round: 2 }); assert.equal(travel.delta, null); assert.equal(travel.reset, true);
    }
  }
});
