import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHESTS, heightAt, seededRandom, SEED } from '../shared/world.js';
import { RESIDENTS } from '../shared/exploration.js';
import { ENCOUNTER_GROUPS } from '../shared/encounters.js';
import { resolveWorldCollision } from '../shared/collision.js';
import { PALMHEART_CAMP, PALMHEART_TENT, PALMHEART_TRAIL, PALMHEART_SHRINE, PALMHEART_CANOPY_OBSTACLES,
  palmheartWeight, palmheartCampPaths, palmheartPlantClearance, palmheartWorkSites } from '../shared/palmheart-camp.js';
import { PALMHEART_PREFABS, PALMHEART_MATERIAL_BINDINGS, buildPalmheartTerrain, buildPalmheartKit, createPalmheartCamp } from '../client/palmheart-camp.js';
import { createEnvironmentAssets, disposeOwnedResources } from '../client/environment-assets.js';
import { createEnvironmentLighting, environmentWeights, ENVIRONMENT_PROFILES } from '../client/environment-lighting.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const sharedURL = '/assets/old-watch/kit.glb', campURL = '/assets/palmheart-camp/kit.glb';
// Each authored root leans on one slot; the pennant needs canvas_flap and the
// canopy needs a leaf material so both wind hooks have a real target.
const PREFAB_SLOTS = { trailkeepers_tent: 'palm_thatch', fire_ring: 'watch_stone', gear_rack: 'canvas_flap', camp_lantern: 'lantern_amber',
  jungle_tree_a: 'broad_leaf', jungle_tree_b: 'broad_leaf', jungle_palm: 'palm_frond', elephant_ear_clump: 'elephant_ear' };
function fixtures() {
  const shared = { scene: new THREE.Group() }, camp = { scene: new THREE.Group() };
  const geometry = new THREE.BoxGeometry(.2, .5, .2), materials = new Map();
  for (const name of new Set(['ground_earth', 'needle_foliage', ...Object.values(PALMHEART_MATERIAL_BINDINGS).map(binding => binding.source)])) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const carrier = new THREE.Mesh(geometry, material); carrier.name = 'material-' + name; shared.scene.add(carrier);
  }
  for (const name of ['fern_clump', 'grass_clump']) {
    const library = new THREE.Group(); library.name = name; library.add(new THREE.Mesh(geometry, materials.get('needle_foliage'))); shared.scene.add(library);
  }
  const spare = Object.keys(PALMHEART_MATERIAL_BINDINGS).filter(slot => !Object.values(PREFAB_SLOTS).includes(slot));
  PALMHEART_PREFABS.forEach((name, index) => {
    const root = new THREE.Group(); root.name = name;
    // The tent also parks every otherwise unused slot so all bindings are bound.
    for (const slot of [PREFAB_SLOTS[name], ...(index ? [] : spare)]) {
      const material = new THREE.MeshStandardMaterial(); material.name = slot; root.add(new THREE.Mesh(geometry, material));
    }
    camp.scene.add(root);
  });
  return { shared, camp, geometry, materials };
}
function harness(load, assets) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette()), legacyVegetation = new THREE.Group();
  scene.add(settlements.group, legacyVegetation);
  return { scene, settlements, legacyVegetation, camp: createPalmheartCamp({ scene, settlements, legacyVegetation, load, assets }) };
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

test('the camp weight lights the clearing and the trail, spares the shrine and keeps every walked route clear', () => {
  const sites = palmheartWorkSites(propSites());
  assert.equal(palmheartWeight(PALMHEART_TENT.x, PALMHEART_TENT.z), 1, 'the trailkeepers tent');
  for (const [name, site] of Object.entries(sites)) assert.equal(palmheartWeight(site.x, site.z), 1, name + ' site');
  assert.equal(palmheartWeight(PALMHEART_SHRINE.x, PALMHEART_SHRINE.z), 0, 'the shrine keeps the island baseline');
  for (const [x, z] of [[-66, -76], [-42, -53], [-29, 39], [-15, 96], [30, 96], [76, 32]]) assert.equal(palmheartWeight(x, z), 0, x + ',' + z + ' belongs to another area');
  assert.equal(palmheartWeight(NaN, 0), 0); assert.equal(palmheartWeight(0, NaN), 0);
  assert.ok(PALMHEART_CANOPY_OBSTACLES.length > 0, 'the area covers at least one collidable jungle tree');
  for (const obstacle of PALMHEART_CANOPY_OBSTACLES) { assert.equal(obstacle.type, 'tree', obstacle.id); assert.ok(palmheartWeight(obstacle.x, obstacle.z) > 0, obstacle.id); }
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#85d9ee'); scene.fog = new THREE.Fog('#a2def0', 180, 610);
  const hemisphere = new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2), sun = new THREE.DirectionalLight('#fff0d0', 2.7);
  const lighting = createEnvironmentLighting({ scene, hemisphere, sun });
  const ready = { oldWatchReady: true, farmReady: true, tideglassReady: true, saltwindReady: true, driftwoodReady: true, palmheartReady: true };
  let lastAmbient = null;
  for (let leg = 1; leg < PALMHEART_TRAIL.length; leg++) {
    const from = PALMHEART_TRAIL[leg - 1], to = PALMHEART_TRAIL[leg], steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .1);
    for (let step = leg === 1 ? 0 : 1; step <= steps; step++) {
      const t = step / steps, player = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
      const weights = environmentWeights(player, ready);
      assert.ok(Object.values(weights).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
      assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
      lighting.update(player, ready);
      if (lastAmbient != null) assert.ok(Math.abs(hemisphere.intensity - lastAmbient) < .01, 'shrine to camp is one continuous walk');
      else assert.equal(hemisphere.intensity, 2.2, 'the shrine dais keeps the island baseline');
      lastAmbient = hemisphere.intensity;
    }
  }
  assert.equal(lastAmbient, ENVIRONMENT_PROFILES.palmheartCamp.ambient, 'the clearing reaches the humid canopy profile');
  lighting.update({ x: PALMHEART_CAMP.x, z: PALMHEART_CAMP.z }, ready); assert.equal(hemisphere.intensity, ENVIRONMENT_PROFILES.palmheartCamp.ambient);
  lighting.dispose(); assert.equal(hemisphere.intensity, 2.2);
  const routes = palmheartCampPaths(); assert.equal(routes.length, 3);
  // The tent is not enterable, so only the inner end of the door approach is
  // ever pushed back, and exactly at the recorded obstacle reach.
  for (const [index, route] of routes.entries()) for (let i = 1; i < route.length; i++) for (let step = 0; step <= 40; step++) {
    const t = step / 40, x = route[i - 1].x * (1 - t) + route[i].x * t, z = route[i - 1].z * (1 - t) + route[i].z * t;
    const point = { x, z, y: heightAt(x, z) }; resolveWorldCollision(point);
    const blocked = index === 2 && Math.hypot(x - PALMHEART_TENT.x, z - PALMHEART_TENT.z) < PALMHEART_TENT.radius + .6;
    assert.equal(Math.hypot(point.x - x, point.z - z) > 1e-6, blocked, 'the trail, Bram\'s loop and the tent approach stay walkable');
  }
  assert.deepEqual(Object.keys(sites), ['fire', 'gear', 'lantern']);
  assert.deepEqual([sites.fire.x, sites.fire.z], [-96, 3]); assert.deepEqual([sites.gear.x, sites.gear.z], [-95, 13]);
  assert.ok(Math.hypot(sites.lantern.x + 87.09, sites.lantern.z - 13.10) < .01, 'the lantern keeps its authored post');
  for (const site of Object.values(sites)) assert.equal(site.poiId, 'palmheart-camp');
  assert.throws(() => palmheartWorkSites([]), /missing its original fire site/);
  assert.equal(palmheartPlantClearance(PALMHEART_SHRINE.x, PALMHEART_SHRINE.z, Object.values(sites)), false, 'the shrine ring is never planted');
  const guards = ENCOUNTER_GROUPS.find(group => group.id === 'palmheart-camp'); assert.deepEqual([guards.x, guards.z], [-88, 12]);
  assert.equal(palmheartPlantClearance(guards.x, guards.z, Object.values(sites)), false, 'the guarded approach stays open');
  const chest = CHESTS.find(entry => entry.id === 'chest-23'); assert.deepEqual([chest.x, chest.z], [-94, 9]);
  assert.equal(palmheartPlantClearance(chest.x, chest.z, Object.values(sites)), false, 'chest-23 stays reachable');
  for (const [name, site] of Object.entries(sites)) assert.equal(palmheartPlantClearance(site.x, site.z, Object.values(sites)), false, name + ' site is never planted over');
  for (const point of RESIDENTS.find(person => person.poiId === 'palmheart-camp').route) assert.equal(palmheartPlantClearance(point.x, point.z, Object.values(sites)), false, 'Bram walks his loop unobstructed');
  assert.equal(palmheartPlantClearance(-100, 10, Object.values(sites)), true, 'the open jungle floor still plants');
});

test('the jungle floor lies on the actual terrain diagonals, fades at the grid border and skips the shoreline', () => {
  const floor = buildPalmheartTerrain(new THREE.MeshStandardMaterial());
  assert.equal(floor.name, 'palmheart-jungle-floor');
  assert.equal(floor.material.polygonOffset, false); assert.equal(floor.material.depthWrite, false); assert.equal(floor.renderOrder, 2);
  const { position, color } = floor.geometry.attributes, indices = floor.geometry.index;
  for (let i = 0; i < indices.count; i += 3) {
    const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + offset)));
    for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.6, .1, .3]]) {
      const point = vertices.reduce((sum, vertex, index) => sum.addScaledVector(vertex, weights[index]), new THREE.Vector3());
      assert.ok(Math.abs(point.y - .034 - renderedHeightAt(point.x, point.z)) < 2e-6, 'overlay and terrain have the same plane');
    }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < position.count; i++) {
    minX = Math.min(minX, position.getX(i)); maxX = Math.max(maxX, position.getX(i));
    minZ = Math.min(minZ, position.getZ(i)); maxZ = Math.max(maxZ, position.getZ(i));
  }
  let boundary = 0, covered = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i), alpha = color.getW(i);
    if (x === minX || x === maxX || z === minZ || z === maxZ) { assert.equal(alpha, 0, 'the litter fades out at the grid border'); boundary++; }
    if (heightAt(x, z) < 1.7) assert.equal(alpha, 0, 'the overlay stops above the shoreline');
    if (alpha > .3) covered++;
  }
  assert.ok(boundary > 40); assert.ok(covered >= 60, 'the clearing and the trail are actually covered');
  disposeOwnedResources([floor]);
});

test('the camp installs atomically with an authored tent, three work sites, a planted canopy and a swaying pennant', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture), loads = [];
  const live = harness(async url => { loads.push(url); return url === sharedURL ? fixture.shared : fixture.camp; });
  const fallback = live.scene.getObjectByName('palmheart-camp-original-exterior');
  assert.equal(fallback.visible, true);
  assert.ok(live.scene.getObjectByName('trailkeepers-tent-original')); assert.ok(live.scene.getObjectByName('palmheart-camp-original-work-sites'));
  assert.equal(await live.camp.ready, true); assert.deepEqual(loads, [sharedURL, campURL]);
  assert.equal(fallback.visible, false); assert.equal(live.legacyVegetation.visible, false);
  for (const name of ['palmheart-authored-trailkeepers-tent', 'palmheart-authored-fire-ring', 'palmheart-authored-gear-rack', 'palmheart-authored-camp-lantern']) {
    assert.ok(live.scene.getObjectByName(name), name);
  }
  let lights = 0; live.scene.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'the camp adds no scene light, so every island shader keeps its light count');
  let authoredCanopy = 0; live.scene.traverse(object => { if (object.name.startsWith('palmheart-canopy-prop-')) authoredCanopy++; });
  assert.ok(authoredCanopy > 0, 'every collidable jungle tree gets an authored silhouette');
  const stats = live.camp.getStats();
  assert.equal(stats.workSites, 3); assert.ok(stats.trees >= 24, 'the wilds stay densely planted: trees ' + stats.trees); assert.ok(stats.canopyTrees >= 1);
  assert.ok(stats.elephantEars > 20 && stats.ferns > 20 && stats.grass > 20, 'the jungle floor is actually planted');
  live.camp.animate(10, {}); const angle = live.camp.getStats().windValue;
  live.camp.animate(20, {}); assert.notEqual(live.camp.getStats().windValue, angle, 'the canopy and the pennant sway while animated');
  const canopy = [], detail = [];
  live.scene.traverse(object => { if (object.isInstancedMesh && object.userData.detailKind) (object.userData.detailKind === 'tree' ? canopy : detail).push(object); });
  assert.ok(canopy.length > 0 && detail.length > 0);
  for (const mesh of canopy) assert.equal(mesh.castShadow, true, 'the canopy casts shadows');
  live.camp.animate(30, { player: { x: PALMHEART_CAMP.x, z: PALMHEART_CAMP.z }, lowQuality: true, reducedMotion: true });
  assert.ok(detail.some(mesh => mesh.count < mesh.userData.fullCount), 'low quality thins the ground plants');
  const ground = detail.find(mesh => mesh.userData.detailKind === 'grass'); assert.ok(ground, 'the shared grass clump is planted');
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; ground.material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.palmheartWind.value, 0); assert.ok(shader.vertexShader.includes('palmheartWind'));
  const leaf = canopy.find(mesh => ['broad_leaf', 'palm_frond'].includes(mesh.material.name)); assert.ok(leaf, 'the canopy carries authored leaves');
  const foliage = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; leaf.material.onBeforeCompile(foliage);
  assert.equal(foliage.uniforms.palmheartWind.value, 0); assert.ok(foliage.vertexShader.includes('position.y - 2.0'), 'only the canopy above head height sways');
  let pennant = null; live.scene.getObjectByName('palmheart-authored-gear-rack').traverse(object => { if (object.isMesh && object.material.name === 'canvas_flap') pennant = object; });
  assert.ok(pennant, 'the gear rack carries the trail-keeper pennant'); assert.equal(pennant.material.side, THREE.DoubleSide);
  const cloth = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; pennant.material.onBeforeCompile(cloth);
  assert.equal(cloth.uniforms.palmheartWind.value, 0); assert.ok(cloth.vertexShader.includes('palmheartWind'));
  live.camp.animate(40, { player: { x: 90, z: -60 } });
  assert.ok(detail.every(mesh => !mesh.visible), 'distant ground plants hide');
  for (const mesh of canopy) assert.equal(mesh.visible, true, 'the canopy is never distance-hidden');
  live.camp.dispose(); live.camp.dispose();
  assert.equal(fallback.visible, true); assert.equal(live.legacyVegetation.visible, true);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('camp release preserves a shared Old Watch lease and never mutates cached material bindings', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture);
  const cache = createEnvironmentAssets({ load: async url => url === sharedURL ? fixture.shared : fixture.camp });
  const watchLease = cache.acquire(sharedURL); await watchLease.ready;
  const before = [...fixture.materials.values()].map(material => ({ material, color: material.color.clone(), name: material.name, map: material.map, normalScale: material.normalScale.clone() }));
  const live = harness(undefined, cache); assert.equal(await live.camp.ready, true);
  live.camp.dispose(); assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  for (const entry of before) { assert.ok(entry.material.color.equals(entry.color)); assert.equal(entry.material.name, entry.name); assert.equal(entry.material.map, entry.map); assert.ok(entry.material.normalScale.equals(entry.normalScale)); }
  watchLease.release(); cache.dispose(); assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('failed, late and rollback-failing camp loads retain the original tent, sites and jungle plants', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const failed = harness(url => url === sharedURL ? pending : Promise.reject(new Error('camp offline')));
  assert.equal(await failed.camp.ready, false); assert.equal(failed.camp.getStats().status, 'fallback');
  assert.equal(failed.scene.getObjectByName('palmheart-camp-original-exterior').visible, true); assert.equal(failed.legacyVegetation.visible, true);
  failed.camp.dispose(); deliver(fixture.shared); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const lateFixture = fixtures(), lateCounts = disposalProbe(lateFixture); let lateDeliver;
  const latePending = new Promise(resolve => { lateDeliver = resolve; });
  const late = harness(url => url === sharedURL ? latePending : lateFixture.camp);
  late.camp.dispose(); lateDeliver(lateFixture.shared); assert.equal(await late.camp.ready, false);
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = harness(async url => url === sharedURL ? rollbackFixture.shared : rollbackFixture.camp);
  const install = rollback.settlements.setPalmheartCampKit;
  rollback.settlements.setPalmheartCampKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.camp.ready, false); assert.match(rollback.camp.getStats().error, /install failed; Fallback restore: rollback failed/);
  assert.equal(rollback.scene.getObjectByName('palmheart-camp-original-exterior').visible, true); assert.equal(rollback.legacyVegetation.visible, true);
  assert.equal(rollback.scene.getObjectByName('palmheart-camp-jungle-environment'), undefined);
  rollback.camp.dispose(); assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('missing prefab, material or original work site fails before authored installation', () => {
  const sites = propSites(), fixture = fixtures();
  fixture.camp.scene.remove(fixture.camp.scene.getObjectByName('trailkeepers_tent'));
  assert.throws(() => buildPalmheartKit(fixture.camp, fixture.shared, { propSites: sites }), /trailkeepers_tent/);
  const invalid = fixtures(); invalid.camp.scene.children[0].children[0].material.name = 'external_texture';
  assert.throws(() => buildPalmheartKit(invalid.camp, invalid.shared, { propSites: sites }), /binding is missing: external_texture/);
  const unsited = fixtures();
  assert.throws(() => buildPalmheartKit(unsited.camp, unsited.shared, { propSites: sites.filter(site => site.radius !== .55) }), /lantern site/);
});

test('partial prefab staging disposes every new binding without releasing source textures', () => {
  const sites = propSites(), fixture = fixtures(), counts = disposalProbe(fixture);
  let cloned = 0, released = 0;
  for (const material of fixture.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); cloned++; copy.addEventListener('dispose', () => released++); return copy; };
  }
  fixture.camp.scene.getObjectByName('jungle_tree_b').clone = () => { throw new Error('staging interrupted'); };
  assert.throws(() => buildPalmheartKit(fixture.camp, fixture.shared, { propSites: sites }), /staging interrupted/);
  assert.ok(cloned > 0); assert.equal(released, cloned);
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  disposeOwnedResources([fixture.camp.scene, fixture.shared.scene]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('a failed shared-library load releases the separately arriving camp source', async () => {
  const fixture = fixtures(); let deliver, disposed = 0;
  fixture.camp.scene.children[0].children[0].material.addEventListener('dispose', () => disposed++);
  const pending = new Promise(resolve => { deliver = resolve; });
  const live = harness(url => url === campURL ? pending : Promise.reject(new Error('shared offline')));
  assert.equal(await live.camp.ready, false); assert.match(live.camp.getStats().error, /shared offline/);
  deliver(fixture.camp); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(live.scene.getObjectByName('palmheart-camp-original-exterior').visible, true);
  assert.equal(live.legacyVegetation.visible, true);
  live.camp.dispose(); assert.equal(disposed, 1);
});

test('shipping camp is geometry-only, within budget, reproducibly manifested and keeps every trunk inside its obstacle', async () => {
  const bytes = await readFile(new URL('../client/assets/palmheart-camp/kit.glb', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../client/assets/palmheart-camp/manifest.json', import.meta.url), 'utf8'));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(bytes.readUInt32LE(8), bytes.length); assert.equal(manifest.bytes, bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.ok(bytes.length < 3 * 1024 * 1024); assert.equal((gltf.images ?? []).length, 0); assert.equal((gltf.textures ?? []).length, 0);
  assert.deepEqual(manifest.materialBindings, PALMHEART_MATERIAL_BINDINGS);
  for (const name of PALMHEART_PREFABS) assert.ok(gltf.nodes.some(node => node.name === name), name);
  let triangles = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) assert.ok(primitive.attributes[attribute] >= 0, attribute);
    assert.ok(PALMHEART_MATERIAL_BINDINGS[gltf.materials[primitive.material].name]);
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  assert.ok(triangles > 10000 && triangles < 36000); assert.equal(triangles, manifest.totalTriangles);
  const camp = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (const name of PALMHEART_PREFABS) {
    const root = camp.scene.getObjectByName(name); assert.ok(root, name);
    assert.ok(root.position.length() < 1e-6); assert.ok(root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6); assert.ok(root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6);
  }
  camp.scene.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  // The four recorded jungle trees keep their collision radius, so the authored
  // trunk has to stay inside it for the first metre a player can walk into.
  for (const [name, limit] of [['jungle_tree_a', .40], ['jungle_tree_b', .44], ['jungle_palm', .32]]) {
    let sampled = 0;
    camp.scene.getObjectByName(name).traverse(object => {
      if (!object.isMesh || object.material.name !== 'jungle_bark') return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        if (vertex.y < 0 || vertex.y > 1) continue;
        assert.ok(Math.hypot(vertex.x, vertex.z) <= limit, name + ' trunk stays inside ' + limit + ' m'); sampled++;
      }
    });
    assert.ok(sampled > 0, name + ' has a bark trunk at walking height');
  }
  const tent = camp.scene.getObjectByName('trailkeepers_tent');
  assert.ok(new THREE.Box3().setFromObject(tent).max.y <= 4.1, 'the tent stays under its recorded height');
  tent.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      assert.ok(Math.hypot(vertex.x, vertex.z) <= 2.95, 'the tent stays inside its recorded radius');
    }
  });
  const fixture = fixtures();
  const kit = buildPalmheartKit(camp, fixture.shared, { propSites: propSites() });
  assert.equal(kit.counts.workSites, 3); assert.equal(kit.counts.prefabs, PALMHEART_PREFABS.length);
  disposeOwnedResources(kit.ownedRoots, [camp.scene, fixture.shared.scene]); disposeOwnedResources([camp.scene, fixture.shared.scene]);
});

test('scenery routes the palmheart wilds vegetation into its own restorable batch', async () => {
  const { buildScenery } = await import('../client/world.js');
  const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  const palette = makePalette(), scenery = buildScenery(palette, random);
  const vegetation = scenery.palmheartLegacyVegetation;
  assert.ok(vegetation); assert.equal(vegetation.visible, true);
  const positions = vegetation.geometry.attributes.position; assert.ok(positions.count > 0);
  let routed = 0, strays = 0;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    if (Math.hypot(x + 98, z - 18) < 4 && y > heightAt(-98, 18) + 3) routed++;
    if (x > -50) strays++;
  }
  assert.ok(routed > 0, 'the collidable jungle tree at -98,18 is routed into the camp batch');
  assert.equal(strays, 0, 'nothing east of the wilds is routed into the camp batch');
  assert.equal(scenery.group.getObjectByName('palmheart-wilds-original-vegetation'), vegetation);
  disposeOwnedResources(scenery.group);
  for (const geometry of Object.values(palette.geometry)) geometry.dispose();
});
