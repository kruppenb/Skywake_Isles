import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makePalette, buildGalleon, buildPirate } from '../client/models.js';
import { createAirshipPresentation, gunCameraPose, updateDeckCannons } from '../client/airship.js';
import { SHIP_SCALE, SHIP_GUNS, AIRSHIP_RETURNS, gunAim, gunMuzzle, gunOperator } from '../shared/airship.js';
import { shipAt, heightAt } from '../shared/world.js';

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-7, `${label}: ${a} vs ${b}`);
function vectorNear(actual, expected, label) { for (const axis of ['x', 'y', 'z']) near(actual[axis], expected[axis], `${label} ${axis}`); }

test('larger galleon puts every shared gun and operator on solid deck without scaling stations twice', () => {
  const ship = buildGalleon(makePalette());
  vectorNear(ship.base.scale, SHIP_SCALE, 'hull scale');
  vectorNear(ship.group.scale, { x: 1, y: 1, z: 1 }, 'world frame scale');
  assert.equal(ship.guns.size, 4);
  ship.group.updateMatrixWorld(true);
  const hull = ship.group.getObjectByName('airship-hull-and-deck');
  const down = new THREE.Vector3(0, -1, 0);
  for (const gun of SHIP_GUNS) {
    const model = ship.guns.get(gun.id);
    assert.equal(model.group.parent, ship.group);
    vectorNear(model.group.position, { x: gun.x, y: 0, z: gun.z }, 'station');
    for (const point of [gun, gunOperator(gun)]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(point.x, .5, point.z), down, 0, 1);
      const hit = ray.intersectObject(hull)[0];
      assert.ok(hit, `${gun.id} has a deck below (${point.x}, ${point.z})`);
      assert.ok(hit.point.y >= -.01 && hit.point.y <= .1, 'feet meet deck planks');
    }
  }
});

test('articulated cannon sockets and camera ray match authority across all swivel and pitch limits', () => {
  const ship = buildGalleon(makePalette()), pose = shipAt(40);
  ship.group.position.set(pose.x, pose.y, pose.z);
  for (const gun of SHIP_GUNS) for (const yawDelta of [-3, -1.25, 0, 1.25, 3]) for (const pitch of [-2, -.55, 0, .8, 2]) {
    const yaw = gun.yaw + yawDelta, model = ship.guns.get(gun.id);
    model.animate(.016, yaw, pitch, 'crew'); ship.group.updateMatrixWorld(true);
    const authoritative = gunMuzzle(gun, pose, yaw, pitch), camera = gunCameraPose(gun, pose, yaw, pitch);
    vectorNear(model.getMuzzle(), authoritative.from, 'barrel socket');
    vectorNear(camera.direction, authoritative.direction, 'camera direction');
    const separation = new THREE.Vector3(camera.origin.x - authoritative.from.x, camera.origin.y - authoritative.from.y, camera.origin.z - authoritative.from.z);
    near(separation.length(), .2, 'camera clears muzzle');
    vectorNear(separation.normalize(), authoritative.direction, 'camera sits on authoritative shot ray');
    assert.ok(camera.origin.y - pose.y > .3, 'lowest pitch keeps camera above deck and near plane');
  }
});

test('local cannon aim wins over delayed snapshot aim and recoil never moves the firing socket', () => {
  const ship = buildGalleon(makePalette()), gun = SHIP_GUNS[0], model = ship.guns.get(gun.id);
  const state = { shipGuns: [{ id: gun.id, occupantId: 'crew' }], players: [{ id: 'crew', gunId: gun.id, yaw: gun.yaw, pitch: 0 }] };
  const local = { ...state.players[0], yaw: gun.yaw - .1 }, view = { yaw: gun.yaw + .4, pitch: .3 };
  updateDeckCannons(ship, state, local, view, .016);
  const aim = gunAim(gun, view.yaw, view.pitch);
  near(model.swivel.rotation.y, aim.yaw, 'local swivel'); near(model.elevation.rotation.x, aim.pitch, 'local elevation');
  const before = model.getMuzzle(); model.fire();
  assert.ok(model.barrel.position.z > .3, 'barrel recoils visibly');
  vectorNear(model.getMuzzle(), before, 'shared firing origin stays fixed');
  model.animate(.7, view.yaw, view.pitch);
  assert.ok(model.barrel.position.z < .001, 'recoil settles before next shot');
  updateDeckCannons(ship, state, null, {}, .016);
  near(model.swivel.rotation.y, gun.yaw, 'remote station follows its operator');
});

test('legal cannon center rays clear the actual ship deck and rail through the entire traverse', () => {
  const ship = buildGalleon(makePalette()), pose = { x: 0, y: 0, z: 0 };
  ship.group.updateMatrixWorld(true);
  const hull = ship.group.getObjectByName('airship-hull-and-deck');
  for (const gun of SHIP_GUNS) for (let step = 0; step <= 20; step++) for (const pitch of [-.55, 0]) {
    const yaw = gun.yaw - 1.25 + step / 20 * 2.5, camera = gunCameraPose(gun, pose, yaw, pitch);
    const ray = new THREE.Raycaster(new THREE.Vector3(camera.origin.x, camera.origin.y, camera.origin.z), new THREE.Vector3(camera.direction.x, camera.direction.y, camera.direction.z), .01, 30);
    const hits = ray.intersectObject(hull);
    assert.equal(hits.length, 0, `${gun.id} yaw ${yaw - gun.yaw}, pitch ${pitch} clips ship at ${hits[0]?.distance}`);
  }
});

test('mounting hides every carried firearm and dismounting restores the equipped weapon', () => {
  const pirate = buildPirate(makePalette(), '#f4a261');
  const hand = pirate.group.getObjectByName('weapon-aim-recoil-rig').children.filter(child => child.name.startsWith('held-'));
  const back = pirate.group.getObjectByName('weapon-back-stow-rig').children;
  pirate.animate(1, 0, { mode: 'aboard', gunId: SHIP_GUNS[0].id, weapon: 'longshot' });
  assert.ok(hand.every(child => !child.visible), 'hands do not carry a rifle at the cannon');
  assert.ok(back.every(child => !child.visible), 'no duplicate back gun');
  pirate.animate(1.1, 0, { mode: 'aboard', gunId: null, weapon: 'longshot' });
  assert.equal(hand.filter(child => child.visible).length, 1);
});

test('flying targets use authoritative altitude, hide on death, snap on respawn and bound model storage', () => {
  const presentation = createAirshipPresentation({ scene: new THREE.Scene(), palette: makePalette() }), camera = new THREE.PerspectiveCamera();
  const targets = Array.from({ length: 8 }, (_, i) => ({ id: `crab-${i}`, hp: 80, maxHp: 80, x: i * 4, y: 80 + i, z: -6, yaw: .2 }));
  const state = { phase: 'voyage', flyingTargets: targets };
  presentation.update(.016, state, 1, camera);
  assert.deepEqual(presentation.getStats(), { flyingTargets: 8, targetModels: 8, lifts: 2 });
  const model = presentation.targets.get('crab-0');
  vectorNear(model.group.position, targets[0], 'target sphere center');
  assert.ok(model.group.getObjectByName('left-cream-wing'));
  presentation.update(.016, { ...state, flyingTargets: targets.slice(1) }, 2, camera);
  assert.equal(model.group.visible, false);
  const respawn = { ...targets[0], x: 99, y: 104 };
  presentation.update(.016, { ...state, flyingTargets: [respawn, ...targets.slice(1)] }, 3, camera);
  assert.equal(presentation.targets.get('crab-0'), model, 'respawn reuses model');
  vectorNear(model.group.position, respawn, 'respawn snaps rather than flies across sky');
  for (let round = 0; round < 20; round++) {
    presentation.update(.016, { ...state, flyingTargets: targets.map((target, i) => ({ ...target, id: `round-${round}-${i}` })) }, 4 + round, camera);
    assert.equal(presentation.getStats().targetModels, 8); assert.equal(presentation.targets.size, 8);
  }
  presentation.update(.016, { phase: 'victory', flyingTargets: targets }, 30, camera);
  assert.equal(presentation.getStats().flyingTargets, 0);
  presentation.dispose();
});

test('return lift geometry is terrain anchored and disposing practice props releases only owned resources', () => {
  const scene = new THREE.Scene(), palette = makePalette(), presentation = createAirshipPresentation({ scene, palette });
  const camera = new THREE.PerspectiveCamera();
  presentation.update(.016, { phase: 'finale', flyingTargets: [{ id: 'crab', hp: 40, maxHp: 80, x: 3, y: 91, z: 4 }] }, 1, camera);
  for (const lift of AIRSHIP_RETURNS) {
    const model = presentation.group.getObjectByName(lift.id);
    vectorNear(model.position, { x: lift.x, y: heightAt(lift.x, lift.z), z: lift.z }, 'return pad anchor');
    assert.ok(model.getObjectByName('airship-lift-up-arrow').position.y > 3, 'return route has a tall marker');
  }
  let sharedDisposed = 0, geometryDisposed = 0;
  palette.solid.addEventListener('dispose', () => sharedDisposed++);
  const owned = new Set(); presentation.group.traverse(object => { if (object.geometry) owned.add(object.geometry); });
  for (const geometry of owned) geometry.addEventListener('dispose', () => geometryDisposed++);
  presentation.dispose(); presentation.dispose();
  assert.equal(presentation.group.parent, null); assert.equal(presentation.targets.size, 0);
  assert.equal(geometryDisposed, owned.size, 'all owned geometry disposed exactly once');
  assert.equal(sharedDisposed, 0, 'shared island palette remains usable');
});
