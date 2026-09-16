import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createReefResources } from '../client/underwater-materials.js';
import { createReefHabitat, floorY } from '../client/underwater-habitat.js';
import { REEF_CACHES, REEF_DISCOVERIES, REEF_ENCOUNTERS, REEF_EVENTS } from '../shared/underwater-content.js';
import { REEF_CHEST, REEF_EXIT, REEF_SPAWN } from '../shared/underwater.js';

test('reef material batches retain metric UVs, vertex wear, and generated maps without canvas access', () => {
  const resources = createReefResources();
  assert.deepEqual(Object.keys(resources.materials).sort(), ['basalt', 'bronze', 'coral', 'kelp', 'rope', 'sand', 'stone', 'timber']);
  const custom = new THREE.BufferGeometry();
  custom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 4, 0, 0, 0, 0, 3], 3));
  custom.computeVertexNormals();
  const mesh = resources.batch('stone').add(custom, [9, 1, -6], [1, 1, 1], [0, 0, 0], '#71928b').mesh();
  assert.equal(mesh.geometry.attributes.uv.count, mesh.geometry.attributes.position.count);
  assert.ok([...mesh.geometry.attributes.uv.array].every(Number.isFinite));
  assert.ok(Math.max(...mesh.geometry.attributes.uv.array.map(Math.abs)) > 1, 'UVs use world metres instead of a 0..1 merged atlas');
  assert.ok([...mesh.geometry.attributes.color.array].every(value => value > 0 && value <= 1));
  for (const material of Object.values(resources.materials)) {
    assert.ok(material.map?.isDataTexture && material.normalMap?.isDataTexture && material.roughnessMap?.isDataTexture);
    assert.equal(material.roughnessMap.colorSpace, THREE.NoColorSpace);
  }
  assert.equal(resources.materials.timber.map.image.width, 256, 'timber keeps enough texels for long grain and sparse knots at gameplay scale');
  const span = (array, stride, offset) => {
    let min = Infinity, max = -Infinity;
    for (let i = offset; i < array.length; i += stride) { min = Math.min(min, array[i]); max = Math.max(max, array[i]); }
    return max - min;
  };
  const timberBeam = (scale, axis) => {
    const beam = resources.batch('timber').add('box', [0, 0, 0], scale, [0, 0, 0]).mesh();
    const expected = span(beam.geometry.attributes.position.array, 3, axis) / resources.surfaceScale.timber;
    const longitudinal = span(beam.geometry.attributes.uv.array, 2, 1);
    assert.ok(Math.abs(longitudinal - expected) < .001, `timber V follows its longest ${['X', 'Y', 'Z'][axis]} extent`);
    beam.geometry.dispose();
  };
  timberBeam([1, 6, 1], 1); // upright mast
  timberBeam([7, 1, 1], 0); // crossbeam
  timberBeam([1, 1, 7], 2); // deck plank
  for (const [kind, geometry] of [['timber', 'box'], ['rope', 'cylinder']]) {
    const sample = resources.batch(kind).add(geometry, [0, 0, 0], geometry === 'box' ? [6, 1, 1] : [1, 6, 1], [0, 0, 0]).mesh();
    const uv = sample.geometry.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 6) {
      const area = Math.abs((uv[i + 2] - uv[i]) * (uv[i + 5] - uv[i + 1]) - (uv[i + 4] - uv[i]) * (uv[i + 3] - uv[i + 1]));
      assert.ok(area > 1e-8, `${kind} triangle ${i / 6} keeps a nondegenerate UV basis`);
    }
    sample.geometry.dispose();
  }
  custom.dispose(); mesh.geometry.dispose(); resources.dispose();
});

test('six-biome habitat stays finite, muted, clear, and within the draw and triangle budget', () => {
  const resources = createReefResources(), habitat = createReefHabitat(resources);
  for (let x = -145; x <= 145; x += 7) for (let z = -145; z <= 145; z += 7) assert.ok(Number.isFinite(floorY(x, z)) && floorY(x, z) <= .42 && floorY(x, z) >= -.32);
  const bed = habitat.group.getObjectByName('sunken-reach-six-biome-seabed'), compositions = habitat.group.getObjectByName('sunken-reach-biome-compositions');
  assert.ok(bed && compositions, 'the integration contract keeps both named roots');
  const colors = bed.geometry.attributes.color.array;
  assert.ok([...colors].every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'regional ground tint remains LDR rather than accumulating from white');
  assert.ok(Math.max(...colors) - Math.min(...colors) > .1, 'six regional palette blends stay visible across the seabed');
  habitat.group.traverse(node => {
    if (!node.isMesh) return;
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = node.geometry.attributes[name];
      assert.ok(attribute && [...attribute.array].every(Number.isFinite), `${node.name || node.material.name} has finite ${name} geometry`);
    }
    assert.ok(node.geometry.boundingBox?.min.toArray().every(Number.isFinite) && node.geometry.boundingBox?.max.toArray().every(Number.isFinite), 'generated mesh has finite culling bounds');
    assert.ok(Number.isFinite(node.geometry.boundingSphere?.radius), 'generated mesh has a finite culling sphere');
  });
  const stats = habitat.getStats();
  const interactionPoints = [REEF_EXIT, REEF_CHEST, REEF_SPAWN, ...REEF_CACHES, ...REEF_DISCOVERIES, ...REEF_EVENTS, ...REEF_EVENTS.flatMap(event => event.nodes), ...REEF_EVENTS.flatMap(event => event.guards || []), ...REEF_ENCOUNTERS.flatMap(entry => entry.guards)];
  assert.equal(stats.regions, 6); assert.ok(stats.plantSites > 100 && stats.clearancePoints === interactionPoints.length, 'the full shared interaction set feeds the planted-corridor filter');
  for (const site of habitat.group.userData.plantCenters) for (const point of interactionPoints) assert.ok(Math.hypot(site.x - point.x, site.z - point.z) >= site.clearance - 1e-8, 'actual planted footprint leaves its declared interaction approach clear');
  assert.ok(stats.triangles < 150000, `habitat triangles ${stats.triangles}; the authored reef stays under its 150k geometry ceiling`); assert.ok(stats.drawCalls < 70, `habitat draws ${stats.drawCalls}`);
  habitat.group.traverse(node => node.geometry?.dispose());
  resources.dispose();
});

test('low quality hides small detail while reduced motion freezes kelp and disposal remains idempotent', () => {
  const resources = createReefResources(), habitat = createReefHabitat(resources);
  habitat.update(3.5, { lowQuality: true, reducedMotion: true, player: { x: -88, z: -20 } });
  assert.equal(habitat.group.getObjectByName('sunken-reach-biome-small-detail').visible, false);
  assert.equal(resources.materials.kelp.userData.reefSwayUniforms.motion.value, 0);
  assert.equal(habitat.getStats().lowQuality, true);
  habitat.update(4, { lowQuality: false, reducedMotion: false });
  assert.equal(habitat.group.getObjectByName('sunken-reach-biome-small-detail').visible, true);
  assert.equal(resources.materials.kelp.userData.reefSwayUniforms.motion.value, 1);
  let disposed = 0, dispose = resources.materials.stone.map.dispose.bind(resources.materials.stone.map);
  resources.materials.stone.map.dispose = () => { disposed++; dispose(); };
  habitat.group.traverse(node => node.geometry?.dispose());
  resources.dispose(); resources.dispose();
  assert.equal(disposed, 1, 'resource owner releases generated textures once');
});
