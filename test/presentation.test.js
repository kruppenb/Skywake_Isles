import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteInterpolation, displayedSpeed, makeTracerFlight, sampleTracerFlight } from '../client/interpolation.js';
import { shipAt } from '../shared/world.js';
import * as THREE from 'three';
import { makePalette, buildPirate, buildWeapon } from '../client/models.js';
import { WEAPON_ORDER, WEAPONS } from '../shared/weapons.js';
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

// Test the rendered geometry against the coat's softly squared cross-section,
// rather than checking pose constants or permitting the arm solver to stretch.
function coatClearance(point, padding = 0) {
  const rings = [[-.12, .34, .235], [.13, .35, .24], [.48, .425, .28], [.76, .455, .265], [.88, .34, .21]];
  if (point.y < rings[0][0] || point.y > rings.at(-1)[0]) return Infinity;
  const index = rings.findIndex(ring => ring[0] >= point.y), a = rings[Math.max(0, index - 1)], b = rings[index];
  const t = (point.y - a[0]) / (b[0] - a[0] || 1);
  const width = THREE.MathUtils.lerp(a[1], b[1], t) + padding, depth = THREE.MathUtils.lerp(a[2], b[2], t) + padding;
  return (Math.abs(point.x) / width) ** (2 / .78) + (Math.abs(point.z) / depth) ** (2 / .78);
}

function minimumMeshClearance(mesh, relativeTo, measure) {
  const transform = relativeTo.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const vertices = mesh.geometry.attributes.position, point = new THREE.Vector3();
  let minimum = Infinity;
  for (let i = 0; i < vertices.count; i++) minimum = Math.min(minimum, measure(point.fromBufferAttribute(vertices, i).applyMatrix4(transform)));
  return minimum;
}

test('gun grips stay attached with fixed arm lengths and body clearance through combat and glide poses', () => {
  const model = buildPirate(makePalette()), torso = model.group.getObjectByName('pirate-upper-body');
  const head = model.group.getObjectByName('pirate-head');
  const arms = ['left', 'right'].map(side => ({ side,
    upper: model.group.getObjectByName(`${side}-upper-arm`), forearm: model.group.getObjectByName(`${side}-forearm`),
    hand: model.group.getObjectByName(`${side}-hand`), anchor: model.group.getObjectByName(`${side}-weapon-grip`),
    glide: model.group.getObjectByName(`${side}-glider-grip`),
  }));
  for (const weapon of WEAPON_ORDER) for (const aiming of [false, true]) {
    for (const pitch of [-1.2, -1.15, -.6, 0, .6, 1.1, 1.2]) {
      for (const state of ['idle', 'moving', 'reload-start', 'reload', 'reload-end', 'recoil', 'knocked', 'gliding']) {
        const reloading = state.startsWith('reload'), progress = state === 'reload-start' ? .15 : state === 'reload-end' ? .85 : .5;
        const player = { weapon, pitch, mode: state === 'gliding' ? 'gliding' : 'ground', knockedUntil: state === 'knocked' ? 20 : 0,
          reloadUntil: reloading ? 10 + WEAPONS[weapon].reload * (1 - progress) : 0 };
        const context = `${weapon}, ${state}, pitch ${pitch}, aiming ${aiming}`;
        for (let frame = 0; frame < 40; frame++) model.animate(10 + frame / 60, state === 'moving' ? 8 : 0, player, { dt: 1 / 60, elapsed: 10, aiming });
        if (state === 'recoil') { model.fire(weapon); model.animate(11, 0, player, { dt: 0, elapsed: 10, aiming }); }
        model.group.updateMatrixWorld(true);
        for (const arm of arms) {
          near(arm.upper.position.distanceTo(arm.forearm.position), .52, `${context}: ${arm.side} upper arm`);
          near(arm.forearm.position.distanceTo(arm.hand.position), .57, `${context}: ${arm.side} forearm`);
          near(arm.upper.scale.y, 1, `${context}: sleeve never stretches`);
          near(arm.forearm.scale.y, 1, `${context}: wrist never stretches`);
          const socket = state === 'gliding' ? arm.glide : arm.anchor;
          near(arm.hand.getWorldPosition(new THREE.Vector3()).distanceTo(socket.getWorldPosition(new THREE.Vector3())), 0, `${context}: grip contact`);
          for (let sample = 0; sample <= 12; sample++) {
            const point = arm.forearm.position.clone().lerp(arm.hand.position, sample / 12);
            assert.ok(coatClearance(point, .10) >= 1, `${context}: ${arm.side} forearm radius clears coat`);
          }
          assert.ok(minimumMeshClearance(arm.forearm.children[0], torso, coatClearance) >= 1, `${context}: actual ${arm.side} forearm mesh clears coat`);
          if (state === 'gliding') {
            const palm = arm.side === 'left' ? new THREE.Vector3(.045, .039, 0) : new THREE.Vector3(-.004, .016, -.082);
            arm.hand.children[0].localToWorld(palm);
            near(palm.distanceTo(arm.glide.getWorldPosition(new THREE.Vector3())), 0, `${context}: physical palm surrounds glider handle`);
          }
        }
        const gun = model.group.getObjectByName(`${state === 'gliding' ? 'stowed' : 'held'}-${weapon}`).children[0];
        assert.ok(minimumMeshClearance(gun, torso, coatClearance) >= 1, `${context}: actual gun mesh clears coat`);
        const faceClearance = minimumMeshClearance(gun, head, point => point.y > -.17 && point.y < .45
          ? (point.x / .33) ** 2 + ((point.z + .02) / .28) ** 2 : Infinity);
        assert.ok(faceClearance >= 1, `${context}: gun stays outside face and cheek envelope`);
        assert.ok(model.getMuzzle().toArray().every(Number.isFinite), `${context}: muzzle remains finite`);
      }
    }
  }
});

test('distinct support grips touch gun surfaces and firing elbows hang below the shoulder', () => {
  const model = buildPirate(makePalette()), grips = new Set(), triangle = new THREE.Triangle(), nearest = new THREE.Vector3();
  for (const weapon of WEAPON_ORDER) {
    for (let frame = 0; frame < 40; frame++) model.animate(1, 0, { weapon, mode: 'ground', pitch: 0 }, { dt: 1 / 60, aiming: true });
    model.group.updateMatrixWorld(true);
    const gun = model.group.getObjectByName(`held-${weapon}`).children[0], vertices = gun.geometry.attributes.position;
    grips.add(model.group.getObjectByName('left-weapon-grip').position.toArray().join(':'));
    for (const side of ['left', 'right']) {
      const hand = model.group.getObjectByName(`${side}-hand`), palm = side === 'left' ? new THREE.Vector3(.045, .039, 0) : new THREE.Vector3(-.004, .016, -.082);
      gun.worldToLocal(hand.children[0].localToWorld(palm));
      let distance = Infinity;
      for (let i = 0; i < vertices.count; i += 3) {
        triangle.a.fromBufferAttribute(vertices, i); triangle.b.fromBufferAttribute(vertices, i + 1); triangle.c.fromBufferAttribute(vertices, i + 2);
        distance = Math.min(distance, triangle.closestPointToPoint(palm, nearest).distanceTo(palm));
      }
      assert.ok(distance < .07, `${weapon}: ${side} palm actually meets the grip or fore-end, distance ${distance}`);
    }
    for (const side of weapon === 'flintlock' ? ['left', 'right'] : ['right']) {
      const elbow = model.group.getObjectByName(`${side}-forearm`), shoulder = model.group.getObjectByName(`${side}-upper-arm`);
      assert.ok(elbow.position.y < shoulder.position.y - .20, `${weapon}: ${side} elbow is lowered`);
    }
  }
  assert.equal(grips.size, 5, 'pistol wrap and fore-end placements are specific to each weapon');
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
