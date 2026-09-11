import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makePalette, buildGalleon, buildPirate } from '../client/models.js';
import { createAirshipPresentation, gunCameraPose, updateDeckCannons } from '../client/airship.js';
import { SHIP_SCALE, SHIP_GUNS, SHIP_JUMP_POINTS, SHIP_JUMP_APPROACHES, AIRSHIP_RETURNS, gunAim, gunMuzzle, gunOperator, jumpLaunchPose } from '../shared/airship.js';
import { SHIP_DURATION, shipAt, heightAt } from '../shared/world.js';
import { shipClearFraction, SHIP_CAMERA_BOX } from '../client/camera.js';

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

test('both jump gates carry a standing sign, painted chevrons and an approach lane on solid planks', () => {
  const ship = buildGalleon(makePalette());
  ship.group.updateMatrixWorld(true);
  const hull = ship.group.getObjectByName('airship-hull-and-deck');
  const down = new THREE.Vector3(0, -1, 0), vertex = new THREE.Vector3();
  assert.equal(ship.gates.size, SHIP_JUMP_POINTS.length);
  const painted = [...SHIP_JUMP_POINTS.map((point) => point.id), 'jump-gate-approach-lanes'];
  for (const name of painted) {
    const node = ship.group.getObjectByName(name);
    assert.ok(node, `${name} is built into the ship, so it rides the moving deck`);
    assert.equal(node.parent, ship.group, `${name} is outside the twice-scaled hull`);
    node.updateWorldMatrix(true, true);
    node.traverse((object) => {
      if (!object.isMesh) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        if (vertex.y > .35) continue;
        const hits = new THREE.Raycaster(new THREE.Vector3(vertex.x, .8, vertex.z), down, 0, 1.4).intersectObject(hull);
        assert.ok(hits.some((hit) => hit.point.y >= -.02 && hit.point.y <= .15), `${name} paint rests on deck planks at ${vertex.x.toFixed(2)}, ${vertex.z.toFixed(2)}`);
        assert.ok(!hits.some((hit) => hit.point.y > .15 && hit.point.y < .8), `${name} paint stays inboard of the gunwale at ${vertex.x.toFixed(2)}, ${vertex.z.toFixed(2)}`);
      }
    });
  }
  for (const point of SHIP_JUMP_POINTS) {
    const gate = ship.group.getObjectByName(point.id);
    assert.ok(gate.getObjectByName('jump-gate-sign'), `${point.id} has a standing sign`);
    assert.ok(gate.getObjectByName('jump-gate-arrow'), `${point.id} has an outward arrow marker`);
    const bounds = new THREE.Box3().setFromObject(gate);
    assert.ok(bounds.max.y > 2.4, `${point.id} reads above the rail rather than as a floor decal`);
    // Nothing of the ship stands in the gateway between the posts, where a pirate
    // walks up to the sign and where the sign and its arrow hang.
    const sin = Math.sin(point.yaw || 0), cos = Math.cos(point.yaw || 0);
    for (const mesh of [hull, ship.group.getObjectByName('airship-cabin'), ship.group.getObjectByName('airship-sails')]) {
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        if (vertex.y < .4 || vertex.y > 3.3) continue;
        const dx = vertex.x - point.x, dz = vertex.z - point.z;
        const across = dx * cos - dz * sin, along = dx * sin + dz * cos;
        assert.ok(Math.abs(across) > 1.05 || along < -.9 || along > 1.35, `${point.id} gateway is clear of ${mesh.name}`);
      }
    }
    assert.ok(SHIP_JUMP_APPROACHES[point.id]?.length, `${point.id} has a painted approach lane`);
    // A gate on the centreline is the one the fore-mast can stand in front of.
    // Its word must live on side panels, clear of the band the mast hides, while
    // a rail gate keeps one centred board.
    const sign = gate.getObjectByName('jump-gate-sign');
    sign.updateWorldMatrix(true, false);
    const positions = sign.geometry.attributes.position;
    let centred = false;
    for (let i = 0; i < positions.count && !centred; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(sign.matrixWorld);
      if (vertex.y < 1.7) continue;
      const dx = vertex.x - point.x, dz = vertex.z - point.z;
      if (Math.abs(dx * cos - dz * sin) < .62) centred = true;
    }
    assert.equal(centred, Math.abs(point.x) >= 1, `${point.id} sign placement suits the mast in front of it`);
  }
});

test('each authored launch offset clears the rendered hull, rail and bowsprit before the glide', () => {
  const ship = buildGalleon(makePalette());
  ship.group.updateMatrixWorld(true);
  const meshes = [];
  const gateIds = new Set(SHIP_JUMP_POINTS.map((point) => point.id));
  ship.group.traverse((object) => {
    if (!object.isMesh) return;
    for (let node = object; node; node = node.parent) if (gateIds.has(node.name) || node.name === 'jump-gate-approach-lanes') return;
    meshes.push(object);
  });
  for (const point of SHIP_JUMP_POINTS) {
    const origin = new THREE.Vector3(point.launch.x, point.launch.y, point.launch.z);
    for (const [direction, far, label] of [[[1, 0, 0], 2.5, 'starboard'], [[-1, 0, 0], 2.5, 'port'], [[0, 0, 1], 2.5, 'aft'],
      [[0, 0, -1], 2.5, 'forward'], [[0, -1, 0], 90, 'the whole descent'], [[0, 1, 0], 1.9, 'head room']]) {
      const hits = new THREE.Raycaster(origin, new THREE.Vector3(...direction).normalize(), .01, far).intersectObjects(meshes, false);
      assert.equal(hits.length, 0, `${point.id} launch is clear ${label} (${hits[0]?.object.name} at ${hits[0]?.distance.toFixed(2)}m)`);
    }
    assert.ok(point.launch.y <= 0, `${point.id} steps off the deck rather than up over the rail`);
  }
});

test('the departure chase camera never sits inside the ship it just left', () => {
  // Reproduce the actual gliding chase placement: 10.2m back along the view, a
  // shoulder step right, and the anchor 2.7m above a departing pirate.
  const BACK = 10.2;
  const place = (launch, yaw, pitch = -.16) => {
    const direction = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    const anchor = { x: launch.x, y: launch.y + 2.7, z: launch.z };
    return { anchor, camera: { x: anchor.x - direction.x * BACK + right.x * .92,
      y: anchor.y - direction.y * BACK, z: anchor.z - direction.z * BACK + right.z * .92 } };
  };
  const insideShip = (point, ship) => point.x > ship.x - SHIP_CAMERA_BOX.x && point.x < ship.x + SHIP_CAMERA_BOX.x
    && point.z > ship.z + SHIP_CAMERA_BOX.minZ && point.z < ship.z + SHIP_CAMERA_BOX.maxZ
    && point.y > ship.y + SHIP_CAMERA_BOX.minY && point.y < ship.y + SHIP_CAMERA_BOX.maxY;
  let clamped = 0;
  for (const gate of SHIP_JUMP_POINTS) for (const elapsed of [0, 9, 18, SHIP_DURATION, SHIP_DURATION + 120]) {
    const ship = shipAt(elapsed), launch = jumpLaunchPose(gate, ship);
    assert.equal(insideShip({ ...launch, y: launch.y + 2.7 }, ship), false, `${gate.id} launches outside the ship`);
    for (let step = 0; step < 24; step++) {
      const yaw = step / 24 * Math.PI * 2;
      const { anchor, camera } = place(launch, yaw);
      const fraction = shipClearFraction(anchor, camera, ship);
      const kept = { x: anchor.x + (camera.x - anchor.x) * fraction,
        y: anchor.y + (camera.y - anchor.y) * fraction, z: anchor.z + (camera.z - anchor.z) * fraction };
      assert.equal(insideShip(kept, ship), false, `${gate.id} at ${elapsed}s, looking ${yaw.toFixed(2)}`);
      if (fraction < 1) {
        clamped++;
        // The endpoint may be clear while the view crosses a corner or exits
        // above the deck; test the whole segment with Three's independent ray.
        const from = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
        const to = new THREE.Vector3(camera.x, camera.y, camera.z);
        const box = new THREE.Box3(new THREE.Vector3(ship.x - SHIP_CAMERA_BOX.x, ship.y + SHIP_CAMERA_BOX.minY, ship.z + SHIP_CAMERA_BOX.minZ),
          new THREE.Vector3(ship.x + SHIP_CAMERA_BOX.x, ship.y + SHIP_CAMERA_BOX.maxY, ship.z + SHIP_CAMERA_BOX.maxZ));
        const hit = new THREE.Ray(from, to.clone().sub(from).normalize()).intersectBox(box, new THREE.Vector3());
        assert.ok(hit && hit.distanceTo(from) <= to.distanceTo(from), 'only a blocked view is ever pulled in');
      }
      assert.ok(fraction >= 0 && fraction <= 1);
    }
  }
  assert.ok(clamped > 0, 'the obstruction this fixes really happens at these gates');
  // Ordinary gliding away from the ship keeps the full chase distance.
  const ship = shipAt(SHIP_DURATION);
  for (const away of [{ x: 0, y: 30, z: 90 }, { x: 60, y: 20, z: -20 }, { x: 0, y: ship.y, z: ship.z + 60 }]) {
    const { anchor, camera } = place(away, 0);
    assert.equal(shipClearFraction(anchor, camera, ship), 1, JSON.stringify(away));
  }
  // A pirate somehow inside the box keeps a usable camera rather than NaN.
  assert.equal(shipClearFraction({ x: ship.x, y: ship.y, z: ship.z }, { x: ship.x, y: ship.y, z: ship.z + 1 }, ship), 0);
  assert.equal(shipClearFraction(null, { x: 0, y: 0, z: 0 }, ship), 1);
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
