import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makePalette, buildGalleon } from '../client/models.js';
import { gunCameraPose } from '../client/airship.js';
import { SHIP_GUNS, SHIP_JUMP_POINTS } from '../shared/airship.js';

function shipFixture() {
  const palette = makePalette(), ship = buildGalleon(palette);
  ship.group.updateMatrixWorld(true);
  return { ship, palette };
}

function allShipMeshes(ship) {
  const meshes = [];
  ship.group.traverse(object => { if (object.isMesh && object.geometry) meshes.push(object); });
  return meshes;
}

function descendantsOf(root, object) {
  for (let node = object; node; node = node.parent) if (node === root) return true;
  return false;
}

test('complete ship geometry stays finite and within the draw budget', () => {
  const { ship } = shipFixture(), meshes = allShipMeshes(ship);
  let triangles = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position;
    assert.ok(position, `${mesh.name || 'unnamed mesh'} has positions`);
    const index = mesh.geometry.index;
    triangles += Math.floor((index ? index.count : position.count) / 3);
    for (const attribute of Object.values(mesh.geometry.attributes)) {
      for (const value of attribute.array) assert.ok(Number.isFinite(value), `${mesh.name || 'unnamed mesh'} has finite attributes`);
    }
    assert.ok([mesh.position, mesh.rotation, mesh.scale].every(vector => [vector.x, vector.y, vector.z].every(Number.isFinite)),
      `${mesh.name || 'unnamed mesh'} has finite transform`);
  }
  assert.ok(meshes.length <= 60, `ship uses ${meshes.length} visible mesh draws (budget 60)`);
  assert.ok(triangles <= 100_000, `ship uses ${triangles} triangles (budget 100000)`);
  assert.ok(triangles > 0);
});

test('cabin and sail fade roots are meshes with one independently owned material', () => {
  const { ship, palette } = shipFixture(), paletteMaterial = palette.solid;
  for (const [label, root] of [['cabin', ship.cabin], ['sails', ship.sails]]) {
    assert.ok(root?.isMesh, `${label} remains a Mesh root`);
    assert.ok(root.geometry?.attributes.position, `${label} keeps its own geometry`);
    assert.ok(root.material && !Array.isArray(root.material), `${label} has one material`);
    assert.equal(root.material.transparent, true, `${label} material supports world fade`);
    assert.equal(root.material.opacity, 1, `${label} starts opaque`);
    assert.equal(root.material.depthWrite, true, `${label} remains depth writing while opaque`);
    assert.notEqual(root.material, paletteMaterial, `${label} owns its fade material`);
    root.traverse(object => {
      if (object.isMesh) assert.equal(object.material, root.material, `${label} detail shares its fade material`);
    });
  }
  assert.notEqual(ship.cabin.material, ship.sails.material, 'cabin and sails do not share fade state');
});

test('full ship legal cannon rays clear every other rendered ship mesh', () => {
  const { ship } = shipFixture();
  for (const gun of SHIP_GUNS) {
    const cannonRoot = ship.guns.get(gun.id).group;
    const obstacles = allShipMeshes(ship).filter(mesh => !descendantsOf(cannonRoot, mesh));
    for (let step = 0; step <= 20; step++) {
      const yaw = gun.yaw - 1.25 + step / 20 * 2.5;
      for (const pitch of [-.55, 0, .8]) {
        const camera = gunCameraPose(gun, { x: 0, y: 0, z: 0 }, yaw, pitch);
        const ray = new THREE.Raycaster(new THREE.Vector3(camera.origin.x, camera.origin.y, camera.origin.z),
          new THREE.Vector3(camera.direction.x, camera.direction.y, camera.direction.z), .01, 30);
        const hits = ray.intersectObjects(obstacles, false);
        assert.equal(hits.length, 0, `${gun.id} yaw ${(yaw - gun.yaw).toFixed(2)} pitch ${pitch} clips ${hits[0]?.object.name || 'ship'}`);
      }
    }
  }
});

test('gate standing corridors remain clear of all non-gate ship geometry', () => {
  const { ship } = shipFixture(), vertex = new THREE.Vector3();
  for (const point of SHIP_JUMP_POINTS) {
    const gate = ship.group.getObjectByName(point.id);
    assert.ok(gate, `${point.id} is present`);
    const meshes = allShipMeshes(ship).filter(mesh => !descendantsOf(gate, mesh));
    const sin = Math.sin(point.yaw || 0), cos = Math.cos(point.yaw || 0);
    for (const mesh of meshes) {
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        if (vertex.y < .4 || vertex.y > 3.3) continue;
        const dx = vertex.x - point.x, dz = vertex.z - point.z;
        const across = dx * cos - dz * sin, along = dx * sin + dz * cos;
        assert.ok(Math.abs(across) > 1.05 || along < -.9 || along > 1.35,
          `${point.id} corridor clips ${mesh.name || 'unnamed mesh'}`);
      }
    }
  }
});

test('exterior hull sides and stern transom present front-facing surfaces', () => {
  const { ship } = shipFixture(), hull = ship.group.getObjectByName('airship-hull-and-deck');
  for (const side of [-1, 1]) for (const z of [-8, 0, 8]) {
    const origin = new THREE.Vector3(side * 20, -2, z), direction = new THREE.Vector3(-side, 0, 0);
    const hit = new THREE.Raycaster(origin, direction, .01, 40).intersectObject(hull, false)[0];
    assert.ok(hit, `hull has a visible side at x=${side}, z=${z}`);
    assert.ok(side * hit.point.x > 2.4, `side ${side} ray reaches the near hull (${hit.point.x.toFixed(2)})`);
  }
  for (const x of [-1.4, 1.4]) {
    const stern = new THREE.Raycaster(new THREE.Vector3(x, -1, 26), new THREE.Vector3(0, 0, -1), .01, 20)
      .intersectObject(hull, false)[0];
    assert.ok(stern, `stern transom closes the hull at x=${x}`);
    assert.ok(stern.point.z > 16, `stern ray reaches the outer transom at x=${x} (${stern.point.z.toFixed(2)})`);
  }
  // The lower stern is deliberately sampled between the old cap's sparse profile
  // vertices, where an edge gap can otherwise be hidden by the centre rudder.
  for (const x of [-2.1, 2.1]) {
    const stern = new THREE.Raycaster(new THREE.Vector3(x, -3, 26), new THREE.Vector3(0, 0, -1), .01, 20)
      .intersectObject(hull, false)[0];
    assert.ok(stern, `lower stern transom closes the hull at x=${x}`);
    assert.ok(stern.point.z > 17.95, `lower stern ray reaches the outer transom at x=${x} (${stern.point.z.toFixed(2)})`);
  }
});
