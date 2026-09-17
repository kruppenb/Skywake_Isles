import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createReefResources } from '../client/underwater-materials.js';
import { createSunkenManor } from '../client/sunken-manor.js';
import { reefCameraFraction } from '../client/camera.js';
import { REEF_SOLIDS, REEF_EXIT, reefLineOfSight, resolveReefSwimmerCollision } from '../shared/underwater.js';
import { REEF_CACHES, REEF_DISCOVERIES, reefRegionAt } from '../shared/underwater-content.js';
import { SUNKEN_MANOR, SUNKEN_MANOR_SOLIDS, SUNKEN_MANOR_WAYPOINTS } from '../shared/sunken-manor.js';
import { REEF_WAYFINDING_ROUTES } from '../client/underwater-wayfinding.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function clearPath(points, label) {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], steps = Math.ceil(distance(a, b) / .25);
    for (let step = 0; step <= steps; step++) {
      const t = step / steps, point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, resolved = { ...point };
      resolveReefSwimmerCollision(resolved);
      assert.ok(distance(point, resolved) < 1e-5, `${label} segment ${index} step ${step} is fully swimmer-clear`);
    }
  }
}

test('three furnished flooded levels and all exterior openings have authoritative clear swim routes', () => {
  assert.equal(SUNKEN_MANOR.levels.length, 3);
  assert.ok(SUNKEN_MANOR_SOLIDS.length > 70 && SUNKEN_MANOR_SOLIDS.every(solid => REEF_SOLIDS.includes(solid)));
  const approach = REEF_WAYFINDING_ROUTES.find(route => route.id === 'exit-to-manor');
  assert.deepEqual(approach.nodes[0], { x: REEF_EXIT.x, y: REEF_EXIT.y, z: REEF_EXIT.z });
  clearPath(approach.nodes, 'return-to-manor');
  clearPath(SUNKEN_MANOR_WAYPOINTS.slice(1), 'vertical atrium and roof hole');
  const mid = { x: 42, y: 8.5, z: -44 }, top = { x: 42, y: 14.9, z: -44 };
  for (const [name, route] of [
    ['ground dining west window', [{ x: 42, y: 2.1, z: -44 }, { x: 42, y: 2.1, z: -46 }, { x: 30, y: 2.1, z: -46 }, { x: 30, y: 2.1, z: -44 }, { x: 26, y: 2.1, z: -44 }]],
    ['middle bedroom east window', [mid, { x: 51, y: 8.5, z: -44 }, { x: 58, y: 8.5, z: -44 }]],
    ['middle north window', [mid, { x: 42, y: 8.5, z: -52 }, { x: 42, y: 8.5, z: -58 }]],
    ['upper west window', [top, { x: 33, y: 14.9, z: -44 }, { x: 26, y: 14.9, z: -44 }]],
    ['upper south window', [top, { x: 42, y: 14.9, z: -35 }, { x: 42, y: 14.9, z: -29 }]],
  ]) clearPath(route, name);
  const gallery = REEF_WAYFINDING_ROUTES.find(route => route.id === 'manor-atrium-gallery');
  clearPath(gallery.nodes, 'gallery cache');
  assert.equal(reefRegionAt(42, -44).id, 'sunken-manor');
  assert.ok(REEF_DISCOVERIES.some(item => item.id === 'manor-chandelier'));
  assert.ok(REEF_CACHES.some(item => item.id === 'manor-gallery-cache'));
});

test('walls and floors stop swimmer bypass, shot rays, and chase camera while open breaches transmit them', () => {
  const blocked = [{ x: 30, y: 2.1, z: -50 }, { x: 26, y: 2.1, z: -50 }];
  assert.equal(reefLineOfSight(...blocked), false);
  assert.ok(reefCameraFraction(...blocked) < 1);
  assert.equal(reefLineOfSight({ x: 50, y: 8.5, z: -38 }, { x: 50, y: 15, z: -38 }), false, 'solid second floor stops vertical fire');
  assert.ok(reefCameraFraction({ x: 50, y: 8.5, z: -38 }, { x: 50, y: 15, z: -38 }) < 1, 'camera cannot cross the second floor');
  assert.equal(reefLineOfSight({ x: 42, y: 8.5, z: -44 }, { x: 42, y: 15, z: -44 }), true, 'atrium stays open vertically');
  assert.equal(reefLineOfSight({ x: 42, y: 15, z: -44 }, { x: 42, y: 23, z: -44 }), true, 'roof breach stays open');
  for (const point of [{ x: 28, y: 2.1, z: -50 }, { x: 50, y: 6.4, z: -38 }, { x: 42, y: 19.05, z: -53 }]) {
    const resolved = { ...point }; resolveReefSwimmerCollision(resolved);
    assert.ok(distance(point, resolved) > .1, 'occupied masonry displaces the whole swimmer');
  }
});

test('the manor model renders its collision shell and domestic detail in bounded shared batches', () => {
  const resources = createReefResources(), manor = createSunkenManor(resources), stats = manor.getStats();
  assert.equal(stats.flooded, true); assert.equal(stats.solids, SUNKEN_MANOR_SOLIDS.length);
  assert.ok(stats.drawCalls <= 12); assert.ok(stats.triangles >= 40000 && stats.triangles < 80000, `manor uses ${stats.triangles} triangles`);
  for (const material of ['stone', 'timber', 'bronze', 'basalt', 'coral']) {
    const mesh = manor.group.getObjectByName(`sunken-manor-${material}-batch`);
    assert.ok(mesh.geometry.attributes.position.count > 0, `${material} has modelled geometry`);
    assert.ok(mesh.material.map && mesh.material.normalMap && mesh.material.roughnessMap);
  }
  const shell = manor.group.getObjectByName('sunken-manor-exterior-stone-batch').geometry.boundingBox;
  assert.ok(shell.min.x < SUNKEN_MANOR.x - 14.4 && shell.max.x > SUNKEN_MANOR.x + 14.4, 'exterior stone projects beyond both x wall faces');
  assert.ok(shell.min.z < SUNKEN_MANOR.z - 12.4 && shell.max.z > SUNKEN_MANOR.z + 12.4, 'exterior stone projects beyond both z wall faces');
  const roof = manor.group.getObjectByName('sunken-manor-exterior-basalt-batch').geometry.boundingBox;
  assert.ok(roof.max.y > 20.2, 'broken roof fragments rise above the flat shell silhouette');
  const coral = manor.group.getObjectByName('sunken-manor-exterior-coral-batch').geometry.boundingBox;
  assert.ok(coral.max.x > SUNKEN_MANOR.x + 14.4, 'window growth is visible outside the shell');
  const parent = new THREE.Group(); parent.add(manor.group);
  let disposals = 0; const first = manor.group.children[0].geometry, originalDispose = first.dispose.bind(first);
  first.dispose = () => { disposals++; originalDispose(); };
  manor.dispose(); manor.dispose(); assert.equal(disposals, 1, 'the manor releases its merged geometry exactly once');
  assert.equal(parent.children.length, 0, 'disposed manor is detached before the world traverses the scene');
  resources.dispose();
});
