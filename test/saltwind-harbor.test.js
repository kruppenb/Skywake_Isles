import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildingWorldPoint } from '../shared/exploration.js';
import { heightAt, SPAWN } from '../shared/world.js';
import { resolveWorldCollision } from '../shared/collision.js';
import { SALTWIND_BUILDINGS, saltwindHarborWeight, saltwindHarborPaths, saltwindWorkSites, saltwindPlantClearance } from '../shared/saltwind-harbor.js';
import { SALTWIND_HARBOR_PREFABS, SALTWIND_MATERIAL_BINDINGS, SALTWIND_BUILDING_PREFIXES, createSaltwindHarbor, buildSaltwindHarborKit, buildSaltwindHarborTerrain } from '../client/saltwind-harbor.js';
import { createEnvironmentAssets, disposeOwnedResources } from '../client/environment-assets.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const sharedURL = '/assets/old-watch/kit.glb', harborURL = '/assets/saltwind-harbor/kit.glb';
function fixtures() {
  const shared = { scene: new THREE.Group() }, harbor = { scene: new THREE.Group() };
  const geometry = new THREE.BoxGeometry(.2, .5, .2), materials = new Map();
  for (const name of new Set(['ground_earth', 'needle_foliage', ...Object.values(SALTWIND_MATERIAL_BINDINGS).map(binding => binding.source)])) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const carrier = new THREE.Mesh(geometry, material); carrier.name = 'material-' + name; shared.scene.add(carrier);
  }
  const library = new THREE.Group(); library.name = 'grass_clump'; library.add(new THREE.Mesh(geometry, materials.get('needle_foliage'))); shared.scene.add(library);
  const slots = Object.keys(SALTWIND_MATERIAL_BINDINGS);
  SALTWIND_HARBOR_PREFABS.forEach((name, index) => {
    const root = new THREE.Group(); root.name = name;
    const material = new THREE.MeshStandardMaterial(); material.name = slots[index % slots.length];
    root.add(new THREE.Mesh(geometry, material)); harbor.scene.add(root);
  });
  return { shared, harbor, geometry, materials };
}
function harness(load, assets) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette()), legacyVegetation = new THREE.Group();
  scene.add(settlements.group, legacyVegetation);
  return { scene, settlements, legacyVegetation, harbor: createSaltwindHarbor({ scene, settlements, legacyVegetation, load, assets }) };
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
const propSites = () => buildSettlements(makePalette()).group.userData.propSites;

test('harbor weight covers all three buildings, spares the landing beach, and keeps every approach walkable', () => {
  for (const building of SALTWIND_BUILDINGS) assert.equal(saltwindHarborWeight(building.x, building.z), 1, building.id);
  assert.equal(saltwindHarborWeight(-15, 96), 1, 'harbor square');
  assert.equal(saltwindHarborWeight(SPAWN.x, SPAWN.z), 0, 'Sunwake Strand landing keeps the baseline');
  assert.equal(saltwindHarborWeight(-69, -84), 0, 'Old Watch stays clear'); assert.equal(saltwindHarborWeight(NaN, 0), 0);
  assert.equal(saltwindHarborWeight(-20, 130), 0, 'open water keeps the baseline');
  const paths = saltwindHarborPaths(); assert.equal(paths.length, 1 + SALTWIND_BUILDINGS.length * 2);
  for (const route of paths) for (let i = 1; i < route.length; i++) for (let step = 0; step <= 40; step++) {
    const t = step / 40, x = route[i - 1].x * (1 - t) + route[i].x * t, z = route[i - 1].z * (1 - t) + route[i].z * t;
    const point = { x, z, y: heightAt(x, z) }; resolveWorldCollision(point);
    assert.ok(Math.hypot(point.x - x, point.z - z) < 1e-6, 'public route remains walkable');
  }
  const sites = saltwindWorkSites(propSites());
  assert.deepEqual(Object.keys(sites), ['mending', 'crates', 'net', 'lantern']);
  for (const site of Object.values(sites)) assert.equal(site.poiId, 'saltwind-harbor');
  assert.throws(() => saltwindWorkSites([]), /missing its original mending table site/);
  for (const site of Object.values(sites)) assert.equal(saltwindPlantClearance(site.x, site.z, Object.values(sites)), false, 'work sites are never planted over');
});

test('harbor ground triangles lie on both actual terrain diagonals, fade at every boundary and skip all three floors', () => {
  const mesh = buildSaltwindHarborTerrain(new THREE.MeshStandardMaterial());
  const { position, color } = mesh.geometry.attributes, indices = mesh.geometry.index;
  for (let i = 0; i < indices.count; i += 3) {
    const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + offset)));
    for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.6, .1, .3]]) {
      const point = vertices.reduce((sum, vertex, index) => sum.addScaledVector(vertex, weights[index]), new THREE.Vector3());
      assert.ok(Math.abs(point.y - .034 - renderedHeightAt(point.x, point.z)) < 2e-6, 'overlay and terrain have the same plane');
    }
  }
  let boundary = 0, covered = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    if (x === -44 || x === -2 || z === 76 || z === 122) { assert.equal(color.getW(i), 0); boundary++; }
    for (const building of SALTWIND_BUILDINGS) if (Math.hypot(x - building.x, z - building.z) < 1.2) assert.equal(color.getW(i), 0, 'floors stay clean');
    if (color.getW(i) > .3) covered++;
  }
  assert.ok(boundary > 40 && covered > 60);
  disposeOwnedResources(mesh);
});

test('harbor installs atomically with three furnished cutaways, all six doors, authored work sites and swaying nets', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture), loads = [];
  const live = harness(async url => { loads.push(url); return url === sharedURL ? fixture.shared : fixture.harbor; });
  const fallback = live.scene.getObjectByName('saltwind-harbor-original-exterior');
  assert.equal(fallback.visible, true); assert.ok(live.scene.getObjectByName('saltwind-harbor-original-work-sites'));
  assert.equal(await live.harbor.ready, true); assert.deepEqual(loads, [sharedURL, harborURL]);
  assert.equal(fallback.visible, false); assert.equal(live.legacyVegetation.visible, false);
  const camera = buildingWorldPoint(SALTWIND_BUILDINGS[0], 7, 7);
  for (const building of SALTWIND_BUILDINGS) {
    const roof = live.scene.getObjectByName(building.id + '-authored-cutaway-roof'), walls = live.scene.getObjectByName(building.id + '-authored-cutaway-walls');
    assert.equal(walls.children.length, 4, building.id);
    for (const end of [-1, 1]) {
      const doorway = buildingWorldPoint(building, 0, end * (building.depth / 2 - .1));
      live.settlements.animate(3, { player: { x: doorway.x, z: doorway.z, y: heightAt(doorway.x, doorway.z), mode: 'ground' }, camera: buildingWorldPoint(building, 7, 7) });
      assert.equal(roof.visible, false, building.id + ' roof cutaway triggers from both door approaches');
    }
    live.settlements.animate(4, { player: { x: camera.x, z: camera.z, y: heightAt(camera.x, camera.z), mode: 'ground' }, camera });
  }
  for (const name of ['mending-table', 'fish-crates', 'drying-net', 'harbor-lantern']) assert.ok(live.scene.getObjectByName('saltwind-harbor-authored-' + name), name);
  const stats = live.harbor.getStats();
  assert.equal(stats.buildings, 3); assert.equal(stats.workSites, 4); assert.equal(stats.dockPosts, 4); assert.ok(stats.lobsterPots >= 1 && stats.grass > 20);
  live.harbor.animate(10, {}); const angle = live.harbor.getStats().windValue;
  live.harbor.animate(20, {}); assert.notEqual(live.harbor.getStats().windValue, angle, 'nets sway while animated');
  live.harbor.animate(30, { player: { x: -20, z: 97 }, lowQuality: true, reducedMotion: true });
  const detail = []; live.scene.traverse(object => { if (object.isInstancedMesh && object.userData.detailKind === 'grass') detail.push(object); });
  assert.ok(detail.length > 0 && detail.some(mesh => mesh.count < mesh.userData.fullCount), 'low quality thins dune grass');
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; detail[0].material.onBeforeCompile(shader); assert.equal(shader.uniforms.saltwindWind.value, 0);
  live.harbor.animate(40, { player: { x: 90, z: 40 } }); assert.ok(detail.every(mesh => !mesh.visible), 'distant grass cells hide');
  assert.equal(live.scene.getObjectByName('saltwind-tavern-authored-cutaway-roof').parent.visible, true, 'distant architecture remains present');
  live.harbor.dispose(); live.harbor.dispose();
  assert.equal(fallback.visible, true); assert.equal(live.legacyVegetation.visible, true);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('harbor release preserves a shared Old Watch lease and never mutates cached material bindings', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture);
  const cache = createEnvironmentAssets({ load: async url => url === sharedURL ? fixture.shared : fixture.harbor });
  const watchLease = cache.acquire(sharedURL); await watchLease.ready;
  const before = [...fixture.materials.values()].map(material => ({ material, color: material.color.clone(), name: material.name, map: material.map, normalScale: material.normalScale.clone() }));
  const live = harness(undefined, cache); assert.equal(await live.harbor.ready, true);
  live.harbor.dispose(); assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  for (const entry of before) { assert.ok(entry.material.color.equals(entry.color)); assert.equal(entry.material.name, entry.name); assert.equal(entry.material.map, entry.map); assert.ok(entry.material.normalScale.equals(entry.normalScale)); }
  watchLease.release(); cache.dispose(); assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('failed, late and rollback-failing harbor loads retain full fallback and close late shared images once', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const failed = harness(url => url === sharedURL ? pending : Promise.reject(new Error('harbor offline')));
  assert.equal(await failed.harbor.ready, false); assert.equal(failed.harbor.getStats().status, 'fallback');
  assert.equal(failed.scene.getObjectByName('saltwind-harbor-original-exterior').visible, true); assert.equal(failed.legacyVegetation.visible, true);
  failed.harbor.dispose(); deliver(fixture.shared); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const lateFixture = fixtures(), lateCounts = disposalProbe(lateFixture); let lateDeliver;
  const latePending = new Promise(resolve => { lateDeliver = resolve; });
  const late = harness(url => url === sharedURL ? latePending : lateFixture.harbor);
  late.harbor.dispose(); lateDeliver(lateFixture.shared); assert.equal(await late.harbor.ready, false);
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = harness(async url => url === sharedURL ? rollbackFixture.shared : rollbackFixture.harbor);
  const install = rollback.settlements.setSaltwindHarborKit;
  rollback.settlements.setSaltwindHarborKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.harbor.ready, false); assert.match(rollback.harbor.getStats().error, /install failed; Fallback restore: rollback failed/);
  assert.equal(rollback.scene.getObjectByName('saltwind-harbor-original-exterior').visible, true);
  assert.equal(rollback.scene.getObjectByName('saltwind-harbor-weathered-environment'), undefined);
  rollback.harbor.dispose(); assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('missing prefab, material or original work site fails before authored installation', () => {
  const sites = propSites(), fixture = fixtures();
  fixture.harbor.scene.remove(fixture.harbor.scene.getObjectByName('tavern_roof'));
  assert.throws(() => buildSaltwindHarborKit(fixture.harbor, fixture.shared, { propSites: sites }), /tavern_roof/);
  const invalid = fixtures(); invalid.harbor.scene.children[0].children[0].material.name = 'external_texture';
  assert.throws(() => buildSaltwindHarborKit(invalid.harbor, invalid.shared, { propSites: sites }), /binding is missing: external_texture/);
  const unsited = fixtures();
  assert.throws(() => buildSaltwindHarborKit(unsited.harbor, unsited.shared, { propSites: sites.filter(site => site.radius !== 1.7) }), /net frame site/);
});

test('partial prefab staging disposes every new binding without releasing source textures', () => {
  const sites = propSites(), fixture = fixtures(), counts = disposalProbe(fixture);
  let cloned = 0, released = 0;
  for (const material of fixture.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); cloned++; copy.addEventListener('dispose', () => released++); return copy; };
  }
  fixture.harbor.scene.getObjectByName('fisher_cottage_roof').clone = () => { throw new Error('staging interrupted'); };
  assert.throws(() => buildSaltwindHarborKit(fixture.harbor, fixture.shared, { propSites: sites }), /staging interrupted/);
  assert.ok(cloned > 0); assert.equal(released, cloned);
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  disposeOwnedResources([fixture.harbor.scene, fixture.shared.scene]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('a failed shared-library load releases the separately arriving harbor source', async () => {
  const fixture = fixtures(); let deliver, disposed = 0;
  fixture.harbor.scene.children[0].children[0].material.addEventListener('dispose', () => disposed++);
  const pending = new Promise(resolve => { deliver = resolve; });
  const live = harness(url => url === harborURL ? pending : Promise.reject(new Error('shared offline')));
  assert.equal(await live.harbor.ready, false); assert.match(live.harbor.getStats().error, /shared offline/);
  deliver(fixture.harbor); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(live.scene.getObjectByName('saltwind-harbor-original-exterior').visible, true);
  live.harbor.dispose(); assert.equal(disposed, 1);
});

test('shipping harbor is geometry-only, within budget, reproducibly manifested, keeps six doorways clear and seats the tavern chimney on the smoke emitter', async () => {
  const bytes = await readFile(new URL('../client/assets/saltwind-harbor/kit.glb', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../client/assets/saltwind-harbor/manifest.json', import.meta.url), 'utf8'));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(bytes.readUInt32LE(8), bytes.length); assert.equal(manifest.bytes, bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.ok(bytes.length < 3.5 * 1024 * 1024); assert.equal((gltf.images ?? []).length, 0); assert.equal((gltf.textures ?? []).length, 0);
  assert.deepEqual(manifest.materialBindings, SALTWIND_MATERIAL_BINDINGS);
  for (const name of SALTWIND_HARBOR_PREFABS) assert.ok(gltf.nodes.some(node => node.name === name), name);
  let triangles = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) assert.ok(primitive.attributes[attribute] >= 0, attribute);
    assert.ok(SALTWIND_MATERIAL_BINDINGS[gltf.materials[primitive.material].name]);
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  assert.ok(triangles > 20000 && triangles < 42000);
  const harbor = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (const name of SALTWIND_HARBOR_PREFABS) {
    const root = harbor.scene.getObjectByName(name); assert.ok(root.position.length() < 1e-6); assert.ok(root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6); assert.ok(root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6);
  }
  for (const building of SALTWIND_BUILDINGS) {
    const prefix = SALTWIND_BUILDING_PREFIXES[building.id];
    assert.deepEqual([manifest.buildingContracts[prefix].width, manifest.buildingContracts[prefix].depth, manifest.buildingContracts[prefix].wallHeight], [building.width, building.depth, building.wallHeight], prefix);
    for (const part of ['base', 'wall_front', 'wall_back']) harbor.scene.getObjectByName(prefix + '_' + part).traverse(object => {
      if (!object.isMesh) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        assert.ok(!(Math.abs(x) < building.doorWidth / 2 - .002 && y > .03 && y < building.doorHeight - .002 && Math.abs(z) > building.depth / 2 - building.wallThickness && Math.abs(z) < building.depth / 2 + .1), prefix + ': both doorway prisms remain clear');
      }
    });
    const roof = new THREE.Box3().setFromObject(harbor.scene.getObjectByName(prefix + '_roof'));
    assert.ok(roof.max.y <= building.height + 1e-4 && roof.min.y >= building.wallHeight - .002, prefix + ' roof stays inside the shared height envelope');
  }
  const tavern = SALTWIND_BUILDINGS[1], chimney = manifest.buildingContracts.tavern.chimney;
  assert.ok(Math.abs(chimney[0] + tavern.width * .29) < 1e-6 && Math.abs(chimney[2] + tavern.depth * .22) < 1e-6, 'chimney contract matches the retained smoke emitter');
  let stack = 0; harbor.scene.getObjectByName('tavern_roof').traverse(object => {
    if (!object.isMesh) return; const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) if (positions.getY(i) > tavern.height - .3 && Math.hypot(positions.getX(i) - chimney[0], positions.getZ(i) - chimney[2]) < .5) stack++;
  });
  assert.ok(stack > 8, 'the stone stack reaches the emitter height directly under the plume');
  const fixture = fixtures();
  const kit = buildSaltwindHarborKit(harbor, fixture.shared, { propSites: propSites() });
  assert.deepEqual(Object.keys(kit.buildings), SALTWIND_BUILDINGS.map(building => building.id)); assert.equal(kit.counts.workSites, 4);
  disposeOwnedResources(kit.ownedRoots, [harbor.scene, fixture.shared.scene]); disposeOwnedResources([harbor.scene, fixture.shared.scene]);
});
