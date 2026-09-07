import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPirate, buildWeapon, makePalette } from '../client/models.js';
import { sampleReloadAnimation } from '../client/reload-animation.js';
import { WEAPONS, WEAPON_ORDER } from '../shared/weapons.js';

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-7, `${label}: ${a} versus ${b}`);
const object = (model, name) => model.group.getObjectByName(name);
const vector = (model, name) => object(model, name).position.clone();
const at = (model, weapon, progress, options = {}) => model.animate(20, 0,
  { mode: 'ground', weapon, pitch: options.pitch || 0, reloadUntil: 20 + WEAPONS[weapon].reload * (1 - progress), ...options.player },
  { dt: 0, elapsed: 20, ...options.pose });
const transform = node => [...node.position.toArray(), ...node.quaternion.toArray()];
function poseSnapshot(model, weapon) {
  return ['weapon-aim-recoil-rig', 'left-hand', 'right-hand', 'left-forearm', 'right-forearm', `reload-action-${weapon}`]
    .flatMap(name => transform(object(model, name)));
}
function equalPose(a, b, label) {
  assert.equal(a.length, b.length);
  a.forEach((value, index) => near(value, b[index], `${label} component ${index}`));
}

test('reload sampler uses each authoritative duration and returns to rest exactly at completion', () => {
  const rest = [-.27, -.18, -.32];
  for (const weapon of WEAPON_ORDER) {
    const deadline = 50 + WEAPONS[weapon].reload;
    for (const progress of [0, .15, .34, .49, .76, .94]) {
      const sample = sampleReloadAnimation(weapon, deadline, 50 + progress * WEAPONS[weapon].reload, rest);
      assert.equal(sample.active, true); near(sample.progress, progress, weapon + ' timeline');
      if (progress === 0) { near(sample.work, 0, 'start at rest'); assert.deepEqual(sample.hand, rest); }
    }
    for (const elapsed of [deadline, deadline + .01, deadline + 100]) {
      const sample = sampleReloadAnimation(weapon, deadline, elapsed, rest);
      assert.equal(sample.active, false); assert.deepEqual(sample.hand, rest);
      assert.equal(sample.work, 0); assert.equal(sample.open, 0);
    }
    for (const deadline of [0, NaN, Infinity, 100]) {
      assert.equal(sampleReloadAnimation(weapon, deadline, 50, rest).active, false);
    }
    assert.equal(sampleReloadAnimation(weapon, 50.1, 50, rest, false).active, false);
  }
});

test('all five weapons release, manipulate and regrip with distinct smooth hand paths', () => {
  const model = buildPirate(makePalette()), signatures = new Set();
  for (const weapon of WEAPON_ORDER) {
    at(model, weapon, 0);
    const rest = vector(model, 'left-weapon-grip'), right = vector(model, 'right-weapon-grip');
    const restRig = object(model, 'weapon-aim-recoil-rig').quaternion.clone();
    const restAction = transform(object(model, `reload-action-${weapon}`));
    let travel = 0, previous = rest.clone();
    const signature = [];
    for (const progress of [.18, .34, .49, .67, .76]) {
      at(model, weapon, progress);
      const hand = vector(model, 'left-weapon-grip');
      travel += hand.distanceTo(previous); previous = hand;
      signature.push(...hand.toArray().map(value => value.toFixed(3)));
      near(vector(model, 'right-weapon-grip').distanceTo(right), 0, weapon + ' right hand stays on grip');
      assert.ok(hand.distanceTo(rest) > .08, weapon + ' leaves fore-end for loading');
      assert.ok(object(model, 'weapon-aim-recoil-rig').quaternion.angleTo(restRig) > .2, weapon + ' cants gun for loading');
      if (progress === .34) assert.ok(transform(object(model, `reload-action-${weapon}`)).some((value, index) => Math.abs(value - restAction[index]) > .1),
        weapon + ' visibly opens its breech, magazine or bolt');
      if (weapon === 'longshot') assert.ok(hand.z > -.3, 'Longshot works at receiver, away from its long muzzle');
    }
    assert.ok(travel > .35, `${weapon} has a visible loading stroke, travel ${travel}`);
    signatures.add(signature.join(':'));
    at(model, weapon, .94);
    near(vector(model, 'left-weapon-grip').distanceTo(rest), 0, weapon + ' regrips before aiming');
    at(model, weapon, 1);
    near(object(model, 'weapon-aim-recoil-rig').quaternion.angleTo(restRig), 0, weapon + ' returns to aim');
    const duration = WEAPONS[weapon].reload;
    for (const progress of [0, .08, .18, .34, .49, .64, .67, .76, .94, 1]) {
      const before = sampleReloadAnimation(weapon, 20 + duration, 20 + Math.max(0, progress - .00001) * duration, rest.toArray());
      const after = sampleReloadAnimation(weapon, 20 + duration, 20 + Math.min(1, progress + .00001) * duration, rest.toArray());
      assert.ok(new THREE.Vector3(...before.hand).distanceTo(new THREE.Vector3(...after.hand)) < .0001, weapon + ' has no hand snap at a phase boundary');
      assert.ok(Math.abs(before.work - after.work) < .0002, weapon + ' has no gun snap at a phase boundary');
    }
  }
  assert.equal(signatures.size, 5, 'each weapon has its own loading path');
});

test('fresh late snapshots, zero delta and 30/60/144 Hz produce the same reload pose', () => {
  const palette = makePalette();
  for (const weapon of WEAPON_ORDER) for (const progress of [.15, .49, .85]) {
    const fresh = buildPirate(palette);
    at(fresh, weapon, progress, { pitch: 1.2 });
    const expected = poseSnapshot(fresh, weapon);
    for (const fps of [30, 60, 144]) {
      const model = buildPirate(palette), duration = WEAPONS[weapon].reload, end = progress * duration;
      for (let elapsed = 0; elapsed < end; elapsed += 1 / fps) model.animate(elapsed, 0,
        { mode: 'ground', weapon, pitch: 1.2, reloadUntil: 20 + duration }, { dt: 1 / fps, elapsed: 20 + elapsed });
      model.animate(end, 0, { mode: 'ground', weapon, pitch: 1.2, reloadUntil: 20 + duration }, { dt: 0, elapsed: 20 + end });
      equalPose(poseSnapshot(model, weapon), expected, `${weapon} ${fps} fps at ${progress}`);
    }
  }
});

test('reload work keeps extreme camera pitch near chest and restores the current aim', () => {
  const model = buildPirate(makePalette());
  for (const weapon of WEAPON_ORDER) {
    const work = [];
    for (const pitch of [-1.2, 0, 1.2]) {
      at(model, weapon, .49, { pitch }); work.push(transform(object(model, 'weapon-aim-recoil-rig')));
      at(model, weapon, 1, { pitch });
      near(object(model, 'weapon-aim-recoil-rig').rotation.x, pitch, weapon + ' restores live pitch');
    }
    equalPose(work[0], work[1], weapon + ' ignores downward pitch during work');
    equalPose(work[1], work[2], weapon + ' ignores upward pitch during work');
  }
});

test('completion, cancellation, mode changes, disconnect and downing reset every articulated part', () => {
  const palette = makePalette();
  for (const weapon of WEAPON_ORDER) {
    const reference = buildPirate(palette); at(reference, weapon, 1);
    const idle = poseSnapshot(reference, weapon);
    for (const player of [{ reloadUntil: 0 }, { reloadUntil: 19 }, { mode: 'aboard' }, { mode: 'gliding' }, { online: false }, { knockedUntil: 30 }, { hp: 0 }]) {
      const model = buildPirate(palette); at(model, weapon, .49);
      at(model, weapon, .49, { player });
      for (const kind of WEAPON_ORDER) equalPose(transform(object(model, `reload-action-${kind}`)),
        transform(object(reference, `reload-action-${kind}`)), `${weapon} reset ${kind} on ${JSON.stringify(player)}`);
      if (player.mode !== 'gliding') equalPose(poseSnapshot(model, weapon), idle, `${weapon} cancels without residual blend`);
      if (player.mode || player.online === false || player.knockedUntil || player.hp === 0) {
        at(model, weapon, .49);
        equalPose(poseSnapshot(model, weapon), idle, weapon + ' stale deadline cannot restart after interruption');
        at(model, weapon, .5);
        assert.notDeepEqual(poseSnapshot(model, weapon), idle, weapon + ' accepts a new authoritative reload');
      }
    }
  }
});

test('swapping cannot transfer a stale reload and hidden/stowed gun parts stay assembled', () => {
  const palette = makePalette(), model = buildPirate(palette), reference = buildPirate(palette);
  for (const [index, weapon] of WEAPON_ORDER.entries()) {
    const next = WEAPON_ORDER[(index + 1) % WEAPON_ORDER.length];
    at(model, weapon, .49);
    const deadline = 20 + WEAPONS[weapon].reload * .51;
    at(model, next, .49, { player: { reloadUntil: deadline } });
    at(reference, next, 1);
    equalPose(poseSnapshot(model, next), poseSnapshot(reference, next), weapon + ' swap resets pose');
    for (const kind of WEAPON_ORDER) {
      equalPose(transform(object(model, `reload-action-${kind}`)), transform(object(reference, `reload-action-${kind}`)), kind + ' hidden part reset');
      equalPose(transform(object(model, `stowed-reload-action-${kind}`)), transform(object(reference, `stowed-reload-action-${kind}`)), kind + ' stowed part never animates');
    }
    at(model, next, .49); assert.notDeepEqual(poseSnapshot(model, next), poseSnapshot(reference, next));
    const drop = buildWeapon(palette, weapon);
    for (const group of [drop.group, drop.stowed]) {
      const meshes = group.children.filter(child => child.isMesh);
      assert.equal(meshes.length, 2, weapon + ' has one fixed batch and one complete action batch');
      assert.ok(meshes.every(mesh => mesh.geometry.attributes.position.count > 0));
    }
    const heldBounds = new THREE.Box3().setFromObject(drop.group), stowedBounds = new THREE.Box3().setFromObject(drop.stowed);
    near(heldBounds.min.distanceTo(stowedBounds.min), 0, weapon + ' stowed minimum matches assembled drop');
    near(heldBounds.max.distanceTo(stowedBounds.max), 0, weapon + ' stowed maximum matches assembled drop');
    near(drop.socket.position.distanceTo(drop.stowedSocket.position), 0, weapon + ' muzzle unchanged on stow');
  }
});
