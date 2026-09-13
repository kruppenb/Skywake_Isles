import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlayerCharacter } from '../client/player-character.js';
import { makePalette } from '../client/models.js';
import { navigatorAsset } from './helpers/navigator.js';

const asset = await navigatorAsset(), palette = makePalette();
const player = { mode: 'ground', weapon: 'flintlock', pitch: 0 };
async function character() {
  const model = buildPlayerCharacter(palette, '#eb785d', { asset });
  await Promise.resolve();
  assert.equal(model.kind, 'navigator');
  return model;
}
function advance(model, speed, seconds, { fps = 60, state = player, aiming = false } = {}) {
  for (let frame = 0; frame < seconds * fps; frame++) {
    model.animate(frame / fps, speed, state, { dt: 1 / fps, aiming });
  }
}
const position = (model, name) => model.group.getObjectByName(name).getWorldPosition(new THREE.Vector3());
function clipPhase(action) {
  const clip = action.getClip(), start = Math.min(...clip.tracks.map(track => track.times[0]));
  return (action.time - start) / (clip.duration - start);
}

test('normal run and sprint have a readable cadence on the real navigator at different frame rates', async () => {
  for (const fps of [30, 60, 120]) for (const speed of [8, 11, 18]) {
    const model = await character();
    advance(model, speed, 2, { fps });
    let previous = clipPhase(model.debug.actions.run), cycles = 0;
    for (let frame = 0; frame < fps * 2; frame++) {
      model.animate(frame / fps, speed, player, { dt: 1 / fps });
      const phase = clipPhase(model.debug.actions.run);
      cycles += (phase - previous + 1) % 1; previous = phase;
    }
    // Two feet per cycle over two seconds: cycles equals footfalls/second.
    assert.ok(speed === 8 ? cycles > 2.8 && cycles < 3.3 : cycles > 3.8 && cycles < 4.3,
      `${speed} m/s at ${fps} fps produces ${cycles} footfalls/s`);
    model.dispose();
  }
});

test('walk/run sample only the keyed loop, keep their phase together, and alternate recovering feet', async () => {
  const model = await character();
  advance(model, 8, 2);
  let leftUp = false, rightUp = false, wrapped = false, previous = 0;
  for (let frame = 0; frame < 180; frame++) {
    model.animate(frame / 120, 8, player, { dt: 1 / 120 });
    const phases = ['walk', 'run'].map(name => clipPhase(model.debug.actions[name]));
    assert.ok(phases.every(phase => phase >= 0 && phase < 1), 'never dwell before the first authored key');
    assert.ok(Math.abs(phases[0] - phases[1]) < 1e-6, 'walk/run cross-fade keeps the same stepping leg');
    if (phases[1] < previous) wrapped = true;
    previous = phases[1];
    const left = position(model, 'LeftFoot'), right = position(model, 'RightFoot');
    leftUp ||= left.y > right.y + .35 && right.y < .3;
    rightUp ||= right.y > left.y + .35 && left.y < .3;
  }
  assert.ok(wrapped && leftUp && rightUp, 'both legs recover above the opposite planted foot over a full run');
  // Sampling must not rewrite the shared asset or change studio prototype playback.
  for (const clip of asset.animations) for (const track of clip.tracks) assert.ok(track.times[0] > .03);
  model.dispose();
});

test('walking reaches a full stride and stopping or mounting settles back to idle', async () => {
  const model = await character();
  advance(model, 3.5, 2);
  assert.ok(model.debug.actions.walk.getEffectiveWeight() > .94, 'walking is not diluted by a standing pose');
  for (const state of [player, { ...player, mode: 'aboard', gunId: 'port' }, { ...player, mode: 'gliding' }, { ...player, knockedUntil: 10 }]) {
    advance(model, 11, 1);
    advance(model, state === player ? 0 : 11, 2, { state });
    assert.equal(model.debug.actions.run.getEffectiveWeight(), 0);
    assert.equal(model.debug.actions.walk.getEffectiveWeight(), 0);
    assert.ok(Math.abs(model.debug.actions.idle.getEffectiveWeight() + model.debug.actions.hold.getEffectiveWeight() - 1) < 1e-9);
    const phase = clipPhase(model.debug.actions.run);
    advance(model, state === player ? 0 : 11, 1, { state });
    assert.equal(clipPhase(model.debug.actions.run), phase, 'feet do not keep cycling at rest or off foot');
  }
  model.dispose();
});

test('running carries the held weapon with the hips and aim steadies it', async () => {
  const model = await character();
  advance(model, 8, 2);
  const heights = [], hips = [];
  for (let frame = 0; frame < 90; frame++) {
    model.animate(frame / 60, 8, player, { dt: 1 / 60 });
    heights.push(model.debug.torso.position.y); hips.push(position(model, 'Hips').y);
  }
  const range = values => Math.max(...values) - Math.min(...values);
  assert.ok(range(heights) > .04 && range(heights) < .10, 'gun follows a few centimetres of body rise/fall');
  for (let i = 1; i < heights.length; i++) assert.ok((heights[i] - heights[i - 1]) * (hips[i] - hips[i - 1]) >= -1e-8);
  advance(model, 8, 2, { aiming: true });
  const aimed = [];
  for (let frame = 0; frame < 60; frame++) {
    model.animate(frame / 60, 8, player, { dt: 1 / 60, aiming: true });
    aimed.push(model.debug.torso.position.y);
  }
  assert.ok(range(aimed) < .001, 'aim removes the carry bob');
  model.dispose();
});
