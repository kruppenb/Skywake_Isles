import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlayerCharacter } from '../client/player-character.js';
import { buildMermaid } from '../client/mermaid.js';
import { makePalette } from '../client/models.js';
import { KNOCK_DURATION } from '../shared/encounters.js';
import { navigatorAsset } from './helpers/navigator.js';

// The downed collapse on the shipped navigator rig: kneel, topple onto the side, settle
// propped on the forearm, and the revive that retraces it. Positions are group space (the
// player's position, ground at y = 0, -z forward, +x the pirate's right), in metres.
const asset = await navigatorAsset(), palette = makePalette();
const standing = { mode: 'ground', weapon: 'flintlock', pitch: 0 };
async function character(options = {}) {
  const model = buildPlayerCharacter(palette, '#eb785d', { asset, ...options });
  await Promise.resolve();
  assert.equal(model.kind, 'navigator');
  return model;
}
const world = (model, name) => model.group.getObjectByName(name).getWorldPosition(new THREE.Vector3());
class Clock {
  constructor(model) { this.model = model; this.time = 0; }
  advance(seconds, state, { fps = 60, dt = 1 / fps } = {}) {
    for (let frame = 0; frame < Math.round(seconds * fps); frame++) {
      this.model.animate(this.time, 0, state, { dt, elapsed: this.time });
      this.time += 1 / fps;
    }
    this.model.group.updateMatrixWorld(true);
  }
  knock() { return { ...standing, knockedUntil: this.time + KNOCK_DURATION }; }
}

test('a knock drops the navigator to its knees, then onto its side with both hands on the ground', async () => {
  const model = await character(), clock = new Clock(model);
  clock.advance(.5, standing);
  const arms = ['Left', 'Right'].map(side => ({
    upper: model.group.getObjectByName(side + 'Arm'), fore: model.group.getObjectByName(side + 'ForeArm'), hand: model.group.getObjectByName(side + 'Hand'),
  }));
  for (const arm of arms) { arm.upperLength = world(model, arm.upper.name).distanceTo(world(model, arm.fore.name)); arm.lowerLength = world(model, arm.fore.name).distanceTo(world(model, arm.hand.name)); }
  const knocked = clock.knock();
  clock.advance(.30, knocked);
  const kneelHips = world(model, 'Hips'), kneelHead = world(model, 'Head');
  assert.ok(kneelHips.y > .7 && kneelHips.y < 1.15, `kneeling drops the hips to ${kneelHips.y}`);
  assert.ok(kneelHead.y > 1.5, 'the head is still up while kneeling');
  for (const knee of ['LeftLeg', 'RightLeg']) assert.ok(world(model, knee).y < .35, `${knee} is on the ground while kneeling`);
  clock.advance(1.2, knocked);
  const hips = world(model, 'Hips'), head = world(model, 'Head');
  assert.ok(hips.y < .40, `the hips lie on the ground: ${hips.y}`);
  assert.ok(head.y > .45 && head.y < .95, `the head is propped up, not flat or standing: ${head.y}`);
  assert.ok(head.x > .4 && head.z < -.3, `the body heads forward-right of the facing: ${head.toArray()}`);
  for (const hand of ['LeftHand', 'RightHand']) assert.ok(world(model, hand).y < .2, `${hand} rests on the ground`);
  assert.ok(world(model, 'RightForeArm').y > -.02, 'the propping elbow stays above the ground');
  for (const foot of ['LeftFoot', 'RightFoot']) { const y = world(model, foot).y; assert.ok(y > -.06 && y < .3, `${foot} rests on the ground: ${y}`); }
  for (const arm of arms) {
    assert.ok(Math.abs(world(model, arm.upper.name).distanceTo(world(model, arm.fore.name)) - arm.upperLength) < .001, 'upper arm length is preserved');
    assert.ok(Math.abs(world(model, arm.fore.name).distanceTo(world(model, arm.hand.name)) - arm.lowerLength) < .001, 'forearm length is preserved');
  }
  const weapon = model.debug.weapons.flintlock;
  assert.equal(weapon.group.visible, false, 'the held gun is put away');
  assert.equal(weapon.stowed.visible, true, 'the gun rides on the back');
  const shadow = model.group.getObjectByName('pirate-contact-shadow');
  assert.ok(shadow.scale.x > 1.5 && shadow.scale.y < .85, 'the contact shadow stretches along the fallen body');
  assert.equal(model.debug.actions.walk.getEffectiveWeight(), 0);
  model.dispose();
});

test('a pirate already down when first seen is drawn settled at once', async () => {
  const model = await character(), clock = new Clock(model);
  clock.advance(1 / 60, { ...standing, knockedUntil: 3 });
  assert.ok(world(model, 'Hips').y < .40, 'no replayed collapse for a late joiner');
  assert.ok(world(model, 'Head').y < .95);
  model.dispose();
});

test('a revive retraces the collapse and restores the standing pose and the gun', async () => {
  const model = await character(), clock = new Clock(model);
  clock.advance(.5, standing);
  clock.advance(1.5, clock.knock());
  const figure = model.group.getObjectByName('navigator-figure');
  clock.advance(.15, standing);
  const rising = world(model, 'Hips').y;
  assert.ok(rising > .35 && rising < 1.3, `the hips come up off the ground first: ${rising}`);
  clock.advance(.15, standing);
  assert.ok(world(model, 'Hips').y > .7 && world(model, 'Hips').y < 1.15, 'back on the knees');
  for (const knee of ['LeftLeg', 'RightLeg']) assert.ok(world(model, knee).y < .35, `${knee} is on the ground while kneeling`);
  clock.advance(.45, standing);
  assert.ok(figure.position.length() < 1e-3, 'the figure is back on the feet');
  assert.ok(figure.quaternion.w > .9999, 'the figure is upright');
  assert.ok(world(model, 'Head').y > 2.4, 'the head is back at standing height');
  assert.equal(model.debug.weapons.flintlock.group.visible, true);
  assert.equal(model.debug.weapons.flintlock.stowed.visible, false);
  const shadow = model.group.getObjectByName('pirate-contact-shadow');
  assert.ok(Math.abs(shadow.scale.x - 1) < 1e-6 && Math.abs(shadow.scale.y - 1) < 1e-6);
  model.dispose();
});

test('a paused clock holds the downed pose instead of stacking the additive bends', async () => {
  const model = await character(), clock = new Clock(model);
  clock.advance(.5, standing);
  const knocked = clock.knock();
  clock.advance(1.5, knocked);
  const head = world(model, 'Head'), knee = world(model, 'LeftLeg');
  // The studio drives the renderer at dt 0 while paused; three's mixer leaves unchanged
  // bones alone, so the bends must restart from its last output rather than accumulate.
  clock.advance(2, knocked, { dt: 0 });
  assert.ok(world(model, 'Head').distanceTo(head) < 1e-6, 'the head stays put over 120 paused frames');
  assert.ok(world(model, 'LeftLeg').distanceTo(knee) < 1e-6, 'the knee stays put over 120 paused frames');
  model.dispose();
});

test('a swimming navigator faints about its hips with hanging arms, and the mermaid tail rolls with it', async () => {
  const model = await character({ swimming: true }), clock = new Clock(model);
  clock.advance(.5, standing);
  const hipsRest = world(model, 'Hips');
  clock.advance(1.5, clock.knock());
  const figure = model.group.getObjectByName('navigator-figure');
  assert.ok(figure.quaternion.w < .95, 'the upper body rolls over');
  const hips = world(model, 'Hips');
  assert.ok(Math.abs(hips.x - hipsRest.x) < .08 && Math.abs(hips.z - hipsRest.z) < .08 && hips.y < hipsRest.y - .08 && hips.y > hipsRest.y - .30,
    `the hips stay in place, sinking a little: ${hips.toArray()} from ${hipsRest.toArray()}`);
  for (const hand of ['LeftHand', 'RightHand']) assert.ok(world(model, hand).y > .6, `${hand} hangs in the water rather than planting on a floor`);
  model.dispose();

  const mermaid = buildMermaid(palette, '#55c9ba', { asset });
  await Promise.resolve();
  const tail = mermaid.group.getObjectByName('meridian-articulated-tail'), up = new THREE.Vector3();
  const tailUp = () => { mermaid.group.updateMatrixWorld(true); return up.set(0, 1, 0).applyQuaternion(tail.getWorldQuaternion(new THREE.Quaternion())).y; };
  for (let frame = 0; frame < 30; frame++) mermaid.animate(frame / 60, 0, { mode: 'swimming', weapon: 'flintlock', pitch: 0 }, { dt: 1 / 60, elapsed: frame / 60 });
  assert.ok(tailUp() > .9, 'the tail hangs from an upright torso while swimming');
  for (let frame = 0; frame < 90; frame++) mermaid.animate(frame / 60, 0, { mode: 'swimming', weapon: 'flintlock', pitch: 0, knockedUntil: 100 }, { dt: 1 / 60, elapsed: frame / 60 });
  assert.ok(tailUp() < .8, 'the tail rolls with the fainted torso');
  mermaid.dispose();
});
