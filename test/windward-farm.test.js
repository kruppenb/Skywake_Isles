import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BUILDINGS, RESIDENTS, trailDistance, buildingWorldPoint, buildingLocalPoint } from '../shared/exploration.js';
import { CHESTS, heightAt } from '../shared/world.js';
import { resolveWorldCollision } from '../shared/collision.js';
import { WINDWARD_FARM, WINDWARD_FARM_TRAIL, windwardFarmWeight, windwardFarmPaths, windwardFarmFields, windwardFarmCrops, windwardFarmFences, farmSegmentDistance } from '../shared/windward-farm.js';
import { WINDWARD_FARM_PREFABS, WINDWARD_FARM_MATERIAL_BINDINGS, createWindwardFarm, buildWindwardFarmKit, buildWindwardFarmTerrain } from '../client/windward-farm.js';
import { createEnvironmentAssets, disposeOwnedResources } from '../client/environment-assets.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const sharedURL = '/assets/old-watch/kit.glb', farmURL = '/assets/windward-farm/kit.glb';
function fixtures() {
  const shared = { scene: new THREE.Group() }, farm = { scene: new THREE.Group() };
  const geometry = new THREE.BoxGeometry(.2, .5, .2), materials = new Map();
  for (const name of new Set(['ground_earth', ...Object.values(WINDWARD_FARM_MATERIAL_BINDINGS).map(binding => binding.source)])) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const carrier = new THREE.Mesh(geometry, material); carrier.name = 'material-' + name; shared.scene.add(carrier);
  }
  for (const name of ['rock_a', 'rock_b', 'grass_clump', 'fern_clump', 'ground_sample']) {
    const root = new THREE.Group(); root.name = name;
    root.add(new THREE.Mesh(geometry, materials.get(name === 'ground_sample' ? 'ground_earth' : name.includes('clump') ? 'needle_foliage' : 'watch_stone'))); shared.scene.add(root);
  }
  const slots = Object.keys(WINDWARD_FARM_MATERIAL_BINDINGS);
  WINDWARD_FARM_PREFABS.forEach((name, index) => {
    const root = new THREE.Group(); root.name = name;
    const material = new THREE.MeshStandardMaterial(); material.name = slots[index % slots.length];
    root.add(new THREE.Mesh(geometry, material)); farm.scene.add(root);
  });
  return { shared, farm, geometry, materials };
}
function harness(load, assets) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette()), legacyVegetation = new THREE.Group();
  scene.add(settlements.group, legacyVegetation);
  return { scene, settlements, legacyVegetation, farm: createWindwardFarm({ scene, settlements, legacyVegetation, load, assets }) };
}
function disposalProbe(fixture) {
  const counts = { geometry: 0, material: 0, texture: 0, bitmap: 0 };
  fixture.geometry.addEventListener('dispose', () => counts.geometry++);
  const texture = new THREE.Texture({ width: 8, height: 8, close: () => counts.bitmap++ });
  texture.addEventListener('dispose', () => counts.texture++);
  const material = fixture.materials.get('watch_stone'); material.map = material.normalMap = texture;
  material.addEventListener('dispose', () => counts.material++);
  return counts;
}

test('farm dressing preserves every existing site and keeps crops, fences, workers and paired barn approaches clear', () => {
  const settlements = buildSettlements(makePalette()), { propSites, farmFenceSites } = settlements.group.userData;
  assert.equal(createHash('sha256').update(JSON.stringify(propSites)).digest('hex'), '2244674af7f0a70252cba6ebcbb4abcf84620d065de9248e3b4c0b59ae1cdae1');
  const crops = windwardFarmCrops(propSites), fences = windwardFarmFences(propSites, farmFenceSites);
  assert.equal(crops.length, 133); assert.equal(new Set(crops.map(point => point.field)).size, 3);
  assert.ok(crops.some(point => point.crop === 'crop_leafy')); assert.ok(fences.length > farmFenceSites.length);
  const barn = BUILDINGS.find(building => building.id === 'harvest-barn');
  for (const point of [...crops, ...fences]) {
    assert.ok(trailDistance(point.x, point.z) > 2.8);
    for (const chest of CHESTS) assert.ok(Math.hypot(chest.x - point.x, chest.z - point.z) > 2.4);
    for (const person of RESIDENTS) for (let i = 0; i < person.route.length; i++) assert.ok(farmSegmentDistance(point.x, point.z, person.route[i], person.route[(i + 1) % person.route.length]) > 1.25);
    const local = buildingLocalPoint(barn, point.x, point.z);
    assert.ok(Math.abs(local.x) > barn.doorWidth / 2 + .8 || Math.abs(local.z) > barn.depth / 2 + 4);
  }
  const routes = [...windwardFarmPaths(), ...RESIDENTS.filter(person => person.poiId === 'windward-farm').map(person => [...person.route, person.route[0]])];
  for (const end of [-1, 1]) routes.push([buildingWorldPoint(barn, 0, end * (barn.depth / 2 + 4)), buildingWorldPoint(barn, 0, 0)]);
  for (const route of routes) for (let i = 1; i < route.length; i++) for (let step = 0; step <= 40; step++) {
    const t = step / 40, x = route[i - 1].x * (1 - t) + route[i].x * t, z = route[i - 1].z * (1 - t) + route[i].z * t;
    const point = { x, z, y: heightAt(x, z) }; resolveWorldCollision(point);
    assert.ok(Math.hypot(point.x - x, point.z - z) < 1e-6, 'public route remains walkable');
  }
  assert.equal(windwardFarmWeight(WINDWARD_FARM.x, WINDWARD_FARM.z), 1);
  assert.equal(windwardFarmWeight(-66, -76), 0); assert.equal(windwardFarmWeight(NaN, 0), 0);
  assert.equal(windwardFarmWeight(-10, -53), 0); assert.ok(windwardFarmWeight(WINDWARD_FARM_TRAIL[1].x, WINDWARD_FARM_TRAIL[1].z) > .9);
});

test('farm ground triangles lie on both actual terrain diagonals and fade to zero at every boundary', () => {
  const sites = buildSettlements(makePalette()).group.userData.propSites;
  const mesh = buildWindwardFarmTerrain(new THREE.MeshStandardMaterial(), windwardFarmFields(sites));
  const { position, color } = mesh.geometry.attributes, indices = mesh.geometry.index;
  for (let i = 0; i < indices.count; i += 3) {
    const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + offset)));
    for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.6, .1, .3]]) {
      const point = vertices.reduce((sum, vertex, index) => sum.addScaledVector(vertex, weights[index]), new THREE.Vector3());
      assert.ok(Math.abs(point.y - .036 - renderedHeightAt(point.x, point.z)) < 2e-6, 'overlay and terrain have the same plane');
    }
  }
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) === -74 || position.getX(i) === -16 || position.getZ(i) === -82 || position.getZ(i) === -26) assert.equal(color.getW(i), 0);
  }
  assert.ok([...color.array].some((value, index) => index % 4 === 3 && value > 0 && value < .5), 'transition alpha includes a soft edge');
  disposeOwnedResources(mesh);
});

test('farm installs atomically with furnished cutaways, paired doors, animated sails and complete low-quality crop rows', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture), loads = [];
  const live = harness(async url => { loads.push(url); return url === sharedURL ? fixture.shared : fixture.farm; });
  const fallback = live.scene.getObjectByName('windward-farm-original-exterior');
  const furnishings = live.scene.getObjectByName('windward-farm-architecture-and-work-sites');
  const positions = furnishings.geometry.attributes.position.array.slice();
  assert.equal(fallback.visible, true); assert.ok(live.scene.getObjectByName('windward-farm-original-crops-hay-fences'));
  assert.equal(await live.farm.ready, true); assert.deepEqual(loads, [sharedURL, farmURL]); assert.equal(fallback.visible, false); assert.equal(live.legacyVegetation.visible, false);
  assert.deepEqual(furnishings.geometry.attributes.position.array, positions); assert.equal(furnishings.visible, true);
  const barn = BUILDINGS.find(building => building.id === 'harvest-barn');
  const roof = live.scene.getObjectByName('harvest-barn-authored-cutaway-roof'), walls = live.scene.getObjectByName('harvest-barn-authored-cutaway-walls');
  const rotor = live.scene.getObjectByName('windward-mill-authored-rotating-sails');
  const player = { x: barn.x, z: barn.z, y: heightAt(barn.x, barn.z), mode: 'ground' }, camera = buildingWorldPoint(barn, 7, 7);
  for (const end of [-1, 1]) {
    const doorway = buildingWorldPoint(barn, 0, end * (barn.depth / 2 - .1));
    live.settlements.animate(3, { player: { ...player, ...doorway }, camera });
    assert.equal(roof.visible, false); assert.deepEqual(walls.children.map(face => face.visible), [false, true, false, true]);
  }
  live.settlements.animate(10, { player, camera }); const angle = rotor.rotation.z;
  live.settlements.animate(20, { player, camera }); assert.notEqual(rotor.rotation.z, angle);
  live.settlements.animate(25, { player, reducedMotion: true }); assert.equal(rotor.rotation.z, .31);
  live.settlements.animate(35, { player, reducedMotion: true }); assert.equal(rotor.rotation.z, .31);
  live.farm.animate(30, { player, lowQuality: true, reducedMotion: true });
  const detail = []; live.scene.traverse(object => { if (object.isInstancedMesh && object.userData.detailKind) detail.push(object); });
  assert.ok(detail.some(mesh => mesh.userData.detailKind === 'grass' && mesh.count < mesh.userData.fullCount));
  assert.ok(detail.filter(mesh => mesh.userData.detailKind === 'crops').every(mesh => mesh.count === mesh.userData.fullCount));
  const plant = detail.find(mesh => mesh.userData.detailKind === 'grass'), shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' };
  plant.material.onBeforeCompile(shader); assert.equal(shader.uniforms.farmWind.value, 0);
  live.farm.animate(40, { player: { x: 0, z: 120 } }); assert.ok(detail.filter(mesh => mesh.userData.detailKind === 'grass').every(mesh => !mesh.visible));
  assert.equal(roof.parent.visible, true, 'distant architecture remains present');
  live.farm.dispose(); live.farm.dispose(); assert.equal(fallback.visible, true); assert.equal(live.legacyVegetation.visible, true);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('farm release preserves a shared Old Watch lease and never mutates cached material bindings', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture);
  const cache = createEnvironmentAssets({ load: async url => url === sharedURL ? fixture.shared : fixture.farm });
  const watchLease = cache.acquire(sharedURL); await watchLease.ready;
  const before = [...fixture.materials.values()].map(material => ({ material, color: material.color.clone(), name: material.name, map: material.map }));
  const live = harness(undefined, cache); assert.equal(await live.farm.ready, true);
  live.farm.dispose(); assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  for (const entry of before) { assert.ok(entry.material.color.equals(entry.color)); assert.equal(entry.material.name, entry.name); assert.equal(entry.material.map, entry.map); }
  watchLease.release(); cache.dispose(); assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('failed, late and rollback-failing farm loads retain full fallback and close late shared images once', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const failed = harness(url => url === sharedURL ? pending : Promise.reject(new Error('farm offline')));
  assert.equal(await failed.farm.ready, false); assert.equal(failed.farm.getStats().status, 'fallback');
  assert.equal(failed.scene.getObjectByName('windward-farm-original-exterior').visible, true); assert.equal(failed.legacyVegetation.visible, true);
  failed.farm.dispose(); deliver(fixture.shared); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const lateFixture = fixtures(), lateCounts = disposalProbe(lateFixture); let lateDeliver;
  const latePending = new Promise(resolve => { lateDeliver = resolve; });
  const late = harness(url => url === sharedURL ? latePending : lateFixture.farm);
  late.farm.dispose(); lateDeliver(lateFixture.shared); assert.equal(await late.farm.ready, false);
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = harness(async url => url === sharedURL ? rollbackFixture.shared : rollbackFixture.farm);
  const install = rollback.settlements.setWindwardFarmKit;
  rollback.settlements.setWindwardFarmKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.farm.ready, false); assert.match(rollback.farm.getStats().error, /install failed; Fallback restore: rollback failed/);
  assert.equal(rollback.scene.getObjectByName('windward-farm-original-exterior').visible, true); assert.equal(rollback.legacyVegetation.visible, true);
  assert.equal(rollback.scene.getObjectByName('windward-farm-weathered-environment'), undefined);
  rollback.farm.dispose(); assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('missing prefab or material fails before authored installation', () => {
  const fixture = fixtures(), propSites = buildSettlements(makePalette()).group.userData.propSites;
  fixture.farm.scene.remove(fixture.farm.scene.getObjectByName('barn_roof'));
  assert.throws(() => buildWindwardFarmKit(fixture.farm, fixture.shared, { propSites }), /barn_roof/);
  const invalid = fixtures(); invalid.farm.scene.children[0].children[0].material.name = 'external_texture';
  assert.throws(() => buildWindwardFarmKit(invalid.farm, invalid.shared, { propSites }), /binding is missing: external_texture/);
});

test('partial prefab staging disposes every new binding without releasing source textures', () => {
  const fixture = fixtures(), counts = disposalProbe(fixture), propSites = buildSettlements(makePalette()).group.userData.propSites;
  let cloned = 0, released = 0;
  for (const material of fixture.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); cloned++; copy.addEventListener('dispose', () => released++); return copy; };
  }
  fixture.farm.scene.getObjectByName('barn_roof').clone = () => { throw new Error('staging interrupted'); };
  assert.throws(() => buildWindwardFarmKit(fixture.farm, fixture.shared, { propSites }), /staging interrupted/);
  assert.ok(cloned > 0); assert.equal(released, cloned);
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  disposeOwnedResources([fixture.farm.scene, fixture.shared.scene]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('a failed shared-library load releases the separately arriving farm source', async () => {
  const fixture = fixtures(); let deliver, disposed = 0;
  fixture.farm.scene.children[0].children[0].material.addEventListener('dispose', () => disposed++);
  const pending = new Promise(resolve => { deliver = resolve; });
  const live = harness(url => url === farmURL ? pending : Promise.reject(new Error('shared offline')));
  assert.equal(await live.farm.ready, false); assert.match(live.farm.getStats().error, /shared offline/);
  deliver(fixture.farm); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(live.scene.getObjectByName('windward-farm-original-exterior').visible, true);
  live.farm.dispose(); assert.equal(disposed, 1);
});

test('shipping farm is geometry-only, within budget, reproducibly manifested and binds to the shared library', async () => {
  const bytes = await readFile(new URL('../client/assets/windward-farm/kit.glb', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../client/assets/windward-farm/manifest.json', import.meta.url), 'utf8'));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(bytes.readUInt32LE(8), bytes.length); assert.equal(manifest.bytes, bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.ok(bytes.length < 2.5 * 1024 * 1024); assert.equal((gltf.images ?? []).length, 0); assert.equal((gltf.textures ?? []).length, 0);
  assert.deepEqual(manifest.materialBindings, WINDWARD_FARM_MATERIAL_BINDINGS);
  for (const name of WINDWARD_FARM_PREFABS) assert.ok(gltf.nodes.some(node => node.name === name), name);
  let triangles = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) assert.ok(primitive.attributes[attribute] >= 0, attribute);
    assert.ok(WINDWARD_FARM_MATERIAL_BINDINGS[gltf.materials[primitive.material].name]);
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  assert.ok(triangles > 10000 && triangles < 32000);
  const farm = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (const name of WINDWARD_FARM_PREFABS) {
    const root = farm.scene.getObjectByName(name); assert.ok(root.position.length() < 1e-6); assert.ok(root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6); assert.ok(root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6);
  }
  const barn = BUILDINGS.find(building => building.id === 'harvest-barn');
  for (const name of ['barn_base', 'barn_wall_front', 'barn_wall_back']) farm.scene.getObjectByName(name).traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      assert.ok(!(Math.abs(x) < barn.doorWidth / 2 - .002 && y > .03 && y < barn.doorHeight - .002 && Math.abs(z) > barn.depth / 2 - barn.wallThickness && Math.abs(z) < barn.depth / 2 + .1), 'both doorway prisms remain clear');
    }
  });
  const fixture = fixtures(), sites = buildSettlements(makePalette()).group.userData;
  const kit = buildWindwardFarmKit(farm, fixture.shared, { propSites: sites.propSites, fenceSites: sites.farmFenceSites });
  assert.ok(kit.group.children.length > 10); assert.equal(kit.counts.fields, 3);
  kit.group.updateMatrixWorld(true);
  const top = new THREE.Box3().setFromObject(kit.group.getObjectByName('windward-farm-hay-top'));
  for (const side of [-1, 1]) {
    const support = new THREE.Box3().setFromObject(kit.group.getObjectByName('windward-farm-hay-lower-' + side));
    assert.ok(top.min.y <= support.max.y && support.max.y - top.min.y < .05, 'upper bale touches each lower support');
    assert.ok(Math.min(top.max.x, support.max.x) - Math.max(top.min.x, support.min.x) > .3, 'support has useful horizontal contact');
  }
  disposeOwnedResources(kit.ownedRoots, [farm.scene, fixture.shared.scene]); disposeOwnedResources([farm.scene, fixture.shared.scene]);
});
