import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { weaponPresentation, SCOPE_FOV, SCOPE_SENSITIVITY } from '../client/weapon-presentation.js';
import { scopeCameraPose } from '../client/camera.js';
import { WEAPONS, RARITIES } from '../shared/weapons.js';

const state = { phase: 'voyage', elapsed: 20 };
const pirate = (overrides = {}) => ({ id: 'pirate', x: 4, y: 6, z: -9, mode: 'ground', hp: 100, online: true,
  weapon: 'longshot', rarity: 'common', reloadUntil: 0, knockedUntil: 0, ...overrides });
const controls = { connected: true, controlsActive: true, aiming: true };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);

test('each weapon reload ring follows authoritative time continuously between snapshots', () => {
  for (const weapon of Object.values(WEAPONS)) for (const rarity of Object.keys(RARITIES)) {
    const player = pirate({ weapon: weapon.id, rarity, reloadUntil: state.elapsed + weapon.reload });
    for (const fraction of [0, .016, .033, .137, .5, .743, .998]) {
      const result = weaponPresentation(state, player, { ...controls, elapsed: state.elapsed + weapon.reload * fraction });
      assert.equal(result.reloading, true); assert.equal(result.scoped, false); near(result.reloadProgress, fraction);
    }
    for (const elapsed of [player.reloadUntil, player.reloadUntil + 1]) {
      const result = weaponPresentation(state, player, { ...controls, elapsed });
      assert.equal(result.reloading, false); assert.equal(result.reloadProgress, 0);
    }
    assert.equal(weaponPresentation(state, { ...player, reloadUntil: 0 }, controls).reloadProgress, 0, 'cancellation clears progress');
    assert.equal(weaponPresentation(state, player, { ...controls, elapsed: 0 }).reloadProgress, 0, 'future start clamps at zero');
  }
});

test('scope and reload presentation require active connected ground gameplay', () => {
  for (const [nextState, player, nextControls] of [
    [{ ...state, phase: 'lobby' }, pirate(), controls],
    [{ ...state, phase: 'victory' }, pirate(), controls],
    [state, null, controls],
    [state, pirate({ mode: 'gliding' }), controls],
    [state, pirate({ mode: 'aboard' }), controls],
    [state, pirate({ knockedUntil: 25 }), controls],
    [state, pirate({ hp: 0 }), controls],
    [state, pirate({ online: false }), controls],
    [state, pirate(), { ...controls, connected: false }],
    [state, pirate(), { ...controls, controlsActive: false }],
    [state, pirate(), { ...controls, menuOpen: true }],
  ]) {
    for (const reloadUntil of [0, 21]) {
      const result = weaponPresentation(nextState, player && { ...player, reloadUntil }, nextControls);
      assert.deepEqual(result, { active: false, scoped: false, reloading: false, reloadProgress: 0, sensitivity: 1 });
    }
  }
});

test('Longshot scope exits for release, reload and swap; held RMB can resume after reload', () => {
  assert.equal(weaponPresentation(state, pirate(), controls).scoped, true);
  near(weaponPresentation(state, pirate(), controls).sensitivity, SCOPE_SENSITIVITY);
  for (const weapon of Object.keys(WEAPONS).filter(id => id !== 'longshot')) {
    const result = weaponPresentation(state, pirate({ weapon }), controls);
    assert.equal(result.scoped, false); assert.equal(result.sensitivity, 1);
  }
  assert.equal(weaponPresentation(state, pirate(), { ...controls, aiming: false }).scoped, false);
  for (const pendingAction of ['reload', 'swap']) {
    assert.equal(weaponPresentation(state, pirate(), { ...controls, pendingAction }).scoped, false);
  }
  const player = pirate({ reloadUntil: 22.1 });
  assert.equal(weaponPresentation(state, player, controls).reloading, true);
  assert.equal(weaponPresentation(state, player, { ...controls, pendingAction: 'swap' }).reloading, false);
  const complete = weaponPresentation(state, player, { ...controls, elapsed: 22.1 });
  assert.equal(complete.scoped, true); assert.equal(complete.reloading, false);
});

test('scoped camera stays at eye height and center ray equals the mouse view at all pitches', () => {
  const camera = new THREE.PerspectiveCamera(SCOPE_FOV, 16 / 9, .12, 1100);
  const raycaster = new THREE.Raycaster();
  for (const yaw of [-Math.PI, -1.2, 0, .7, Math.PI]) for (const pitch of [-1.15, -.16, 0, .6, 1.1]) {
    const player = pirate();
    const pose = scopeCameraPose(player, yaw, pitch);
    near(pose.origin.x, player.x); near(pose.origin.y, player.y + 1.65); near(pose.origin.z, player.z);
    camera.position.set(pose.origin.x, pose.origin.y, pose.origin.z);
    camera.lookAt(new THREE.Vector3(pose.origin.x + pose.direction.x, pose.origin.y + pose.direction.y, pose.origin.z + pose.direction.z));
    camera.updateMatrixWorld();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    near(raycaster.ray.direction.x, -Math.sin(yaw) * Math.cos(pitch));
    near(raycaster.ray.direction.y, Math.sin(pitch)); near(raycaster.ray.direction.z, -Math.cos(yaw) * Math.cos(pitch));
  }
  assert.ok(Math.tan(50 * Math.PI / 360) / Math.tan(camera.fov * Math.PI / 360) > 2.9, 'scope actually magnifies the scene');
});
