import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHESTS, heightAt, seededRandom, SEED } from '../shared/world.js';
import { RESIDENTS, buildingLocalPoint, buildingWorldPoint } from '../shared/exploration.js';
import { ENCOUNTER_GROUPS } from '../shared/encounters.js';
import { resolveWorldCollision } from '../shared/collision.js';
import { CINDERWORKS, CINDER_FORGE, CINDERWORKS_TRAIL, EMBERPEAK_SHRINE, CINDERWORKS_ROCK_OBSTACLES,
  cinderworksWeight, cinderworksPaths, cinderworksPlantClearance, cinderworksWorkSites } from '../shared/cinderworks.js';
import { CINDERWORKS_PREFABS, CINDERWORKS_MATERIAL_BINDINGS, buildCinderworksTerrain, buildCinderworksKit, createCinderworks } from '../client/cinderworks.js';
import { createEnvironmentAssets, disposeOwnedResources } from '../client/environment-assets.js';
import { createEnvironmentLighting, environmentWeights, ENVIRONMENT_PROFILES } from '../client/environment-lighting.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const sharedURL = '/assets/old-watch/kit.glb', forgeURL = '/assets/cinderworks/kit.glb';
// Each authored root leans on one slot; the sign needs sign_plate and the shard
// needs ember_crystal so both authored materials have a real target.
const PREFAB_SLOTS = {
  cinder_forge_base: 'basalt_block', cinder_forge_wall_east: 'basalt_block', cinder_forge_wall_west: 'basalt_block',
  cinder_forge_wall_front: 'charred_board', cinder_forge_wall_back: 'charred_board', cinder_forge_roof: 'rust_sheet',
  forge_sign: 'sign_plate', forge_anvil: 'forged_iron', ore_pile: 'ore_rock', forge_lantern: 'lantern_amber',
  coal_bin: 'coal', slag_heap: 'scoria', basalt_outcrop: 'basalt_block', basalt_boulder_a: 'basalt_block',
  basalt_boulder_b: 'scoria', cinder_clump: 'scoria', ember_crystal: 'ember_crystal',
};
function fixtures() {
  const shared = { scene: new THREE.Group() }, forge = { scene: new THREE.Group() };
  const geometry = new THREE.BoxGeometry(.2, .5, .2), materials = new Map();
  for (const name of new Set(['ground_earth', 'needle_foliage', ...Object.values(CINDERWORKS_MATERIAL_BINDINGS).map(binding => binding.source)])) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const carrier = new THREE.Mesh(geometry, material); carrier.name = 'material-' + name; shared.scene.add(carrier);
  }
  for (const name of ['fern_clump', 'grass_clump']) {
    const library = new THREE.Group(); library.name = name; library.add(new THREE.Mesh(geometry, materials.get('needle_foliage'))); shared.scene.add(library);
  }
  const spare = Object.keys(CINDERWORKS_MATERIAL_BINDINGS).filter(slot => !Object.values(PREFAB_SLOTS).includes(slot));
  CINDERWORKS_PREFABS.forEach((name, index) => {
    const root = new THREE.Group(); root.name = name;
    // The base also parks every otherwise unused slot so all bindings are bound.
    for (const slot of [PREFAB_SLOTS[name], ...(index ? [] : spare)]) {
      const material = new THREE.MeshStandardMaterial(); material.name = slot; root.add(new THREE.Mesh(geometry, material));
    }
    forge.scene.add(root);
  });
  return { shared, forge, geometry, materials };
}
function harness(load, assets) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette()), legacyScenery = new THREE.Group();
  scene.add(settlements.group, legacyScenery);
  return { scene, settlements, legacyScenery, cinderworks: createCinderworks({ scene, settlements, legacyScenery, load, assets }) };
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

test('the forge weight lights the yard and the trail, spares the ember shrine and keeps every walked route clear', () => {
  const sites = cinderworksWorkSites(propSites());
  assert.equal(cinderworksWeight(CINDER_FORGE.x, CINDER_FORGE.z), 1, 'the cinder forge');
  assert.equal(cinderworksWeight(CINDERWORKS.x, CINDERWORKS.z), 1, 'the forge yard');
  for (const [name, site] of Object.entries(sites)) assert.equal(cinderworksWeight(site.x, site.z), 1, name + ' site');
  assert.equal(cinderworksWeight(EMBERPEAK_SHRINE.x, EMBERPEAK_SHRINE.z), 0, 'the ember shrine keeps the island baseline');
  for (const [x, z] of [[-90, 6], [-64, -76], [30, 96], [76, 32], [96, 42], [89, -64]]) assert.equal(cinderworksWeight(x, z), 0, x + ',' + z + ' belongs to another area');
  assert.equal(cinderworksWeight(NaN, 0), 0); assert.equal(cinderworksWeight(0, NaN), 0);
  assert.deepEqual(CINDERWORKS_ROCK_OBSTACLES.map(obstacle => obstacle.id), ['prop-23'], 'only the recorded Emberpeak rock is authored');
  for (const obstacle of CINDERWORKS_ROCK_OBSTACLES) { assert.equal(obstacle.type, 'rock', obstacle.id); assert.ok(cinderworksWeight(obstacle.x, obstacle.z) > 0, obstacle.id); }
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#85d9ee'); scene.fog = new THREE.Fog('#a2def0', 180, 610);
  const hemisphere = new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2), sun = new THREE.DirectionalLight('#fff0d0', 2.7);
  const lighting = createEnvironmentLighting({ scene, hemisphere, sun });
  const ready = { oldWatchReady: true, farmReady: true, tideglassReady: true, saltwindReady: true, driftwoodReady: true, palmheartReady: true, cinderworksReady: true };
  let lastAmbient = null;
  for (let leg = 1; leg < CINDERWORKS_TRAIL.length; leg++) {
    const from = CINDERWORKS_TRAIL[leg - 1], to = CINDERWORKS_TRAIL[leg], steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .1);
    for (let step = leg === 1 ? 0 : 1; step <= steps; step++) {
      const t = step / steps, player = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
      const weights = environmentWeights(player, ready);
      assert.ok(Object.values(weights).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
      assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
      lighting.update(player, ready);
      if (lastAmbient != null) assert.ok(Math.abs(hemisphere.intensity - lastAmbient) < .01, 'the whole trail is one continuous walk');
      else assert.equal(hemisphere.intensity, 2.2, 'the western trail head keeps the island baseline');
      lastAmbient = hemisphere.intensity;
    }
  }
  assert.equal(lastAmbient, ENVIRONMENT_PROFILES.cinderworks.ambient, 'the yard reaches the ash-hazy profile');
  lighting.update({ x: CINDER_FORGE.x, z: CINDER_FORGE.z }, ready); assert.equal(hemisphere.intensity, ENVIRONMENT_PROFILES.cinderworks.ambient);
  lighting.dispose(); assert.equal(hemisphere.intensity, 2.2);
  const routes = cinderworksPaths(); assert.equal(routes.length, 4);
  // The forge is enterable, so both door approaches walk straight through the
  // doorway: nothing on any of the four routes is ever pushed back.
  for (const route of routes) for (let i = 1; i < route.length; i++) for (let step = 0; step <= 40; step++) {
    const t = step / 40, x = route[i - 1].x * (1 - t) + route[i].x * t, z = route[i - 1].z * (1 - t) + route[i].z * t;
    const point = { x, z, y: heightAt(x, z) }; resolveWorldCollision(point);
    assert.ok(Math.hypot(point.x - x, point.z - z) < 1e-6, 'the trail, Sula\'s loop and both forge doors stay walkable');
  }
  assert.deepEqual(Object.keys(sites), ['anvil', 'ore', 'lantern']);
  assert.ok(Math.hypot(sites.anvil.x - 71.2094, sites.anvil.z + 41.0295) < .01, 'the anvil keeps its authored stand');
  assert.deepEqual([sites.ore.x, sites.ore.z], [84, -44]);
  assert.ok(Math.hypot(sites.lantern.x - 82.1194, sites.lantern.z + 40.8837) < .01, 'the lantern keeps its authored post');
  for (const site of Object.values(sites)) assert.equal(site.poiId, 'cinderworks');
  assert.throws(() => cinderworksWorkSites([]), /missing its original anvil site/);
  assert.equal(cinderworksPlantClearance(EMBERPEAK_SHRINE.x, EMBERPEAK_SHRINE.z, Object.values(sites)), false, 'the shrine ring is never planted');
  const guards = ENCOUNTER_GROUPS.find(group => group.id === 'cinderworks'); assert.deepEqual([guards.x, guards.z], [80, -55]);
  assert.equal(cinderworksPlantClearance(guards.x, guards.z, Object.values(sites)), false, 'the guarded approach stays open');
  for (const id of ['chest-24', 'chest-14']) {
    const chest = CHESTS.find(entry => entry.id === id);
    assert.equal(cinderworksPlantClearance(chest.x, chest.z, Object.values(sites)), false, id + ' stays reachable');
  }
  for (const [name, site] of Object.entries(sites)) assert.equal(cinderworksPlantClearance(site.x, site.z, Object.values(sites)), false, name + ' site is never planted over');
  for (const point of RESIDENTS.find(person => person.poiId === 'cinderworks').route) assert.equal(cinderworksPlantClearance(point.x, point.z, Object.values(sites)), false, 'Sula walks her loop unobstructed');
  assert.equal(cinderworksPlantClearance(90, -40, Object.values(sites)), true, 'the open scoria field still scatters');
});

test('the ash overlay lies on the actual terrain diagonals, fades at the grid border and skips the forge floor', () => {
  const floor = buildCinderworksTerrain(new THREE.MeshStandardMaterial(), cinderworksWorkSites(propSites()));
  assert.equal(floor.name, 'cinderworks-ash-and-cinder');
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
  let boundary = 0, covered = 0, floors = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i), alpha = color.getW(i);
    if (x === minX || x === maxX || z === minZ || z === maxZ) { assert.equal(alpha, 0, 'the ash fades out at the grid border'); boundary++; }
    if (heightAt(x, z) < 1.7) assert.equal(alpha, 0, 'the overlay stops above the shoreline');
    const local = buildingLocalPoint(CINDER_FORGE, x, z);
    if (Math.abs(local.x) < CINDER_FORGE.width / 2 + .3 && Math.abs(local.z) < CINDER_FORGE.depth / 2 + .3) { assert.equal(alpha, 0, 'the flagstone floor stays clean'); floors++; }
    if (alpha > .3) covered++;
  }
  assert.ok(boundary > 40); assert.ok(floors > 0, 'the grid actually samples the forge footprint');
  assert.ok(covered >= 60, 'the yard and the tracks are actually covered');
  disposeOwnedResources([floor]);
});

test('the Cinderworks installs atomically with an authored forge, three work sites, a scorched yard and a swinging sign', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture), loads = [];
  const live = harness(async url => { loads.push(url); return url === sharedURL ? fixture.shared : fixture.forge; });
  const fallback = live.scene.getObjectByName('cinderworks-original-exterior');
  assert.equal(fallback.visible, true);
  for (const name of ['cinder-forge-original-base', 'cinder-forge-cutaway-walls', 'cinderworks-original-work-sites']) assert.ok(fallback.getObjectByName(name), name);
  assert.equal(await live.cinderworks.ready, true); assert.deepEqual(loads, [sharedURL, forgeURL]);
  assert.equal(fallback.visible, false); assert.equal(live.legacyScenery.visible, false);
  for (const name of ['cinder-forge-authored-cutaway-walls', 'cinder-forge-authored-cutaway-roof', 'cinder-forge-sign',
    'cinderworks-authored-forge-anvil', 'cinderworks-authored-ore-pile', 'cinderworks-authored-forge-lantern', 'cinderworks-outcrop-prop-23']) {
    assert.ok(live.scene.getObjectByName(name), name);
  }
  let lights = 0; live.scene.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'the forge adds no scene light, so every island shader keeps its light count');
  const stats = live.cinderworks.getStats();
  assert.equal(stats.workSites, 3); assert.equal(stats.outcrops, 1);
  assert.ok(stats.boulders >= 8, 'the scoria field carries boulders: ' + stats.boulders);
  assert.ok(stats.cinderClumps > 40 && stats.crystals > 8 && stats.grass > 30, 'the scorched ground is actually dressed');
  live.cinderworks.animate(10, {}); const angle = live.cinderworks.getStats().windValue;
  live.cinderworks.animate(20, {}); assert.notEqual(live.cinderworks.getStats().windValue, angle, 'the sign and the scorched grass sway while animated');
  const boulders = [], detail = [];
  live.scene.traverse(object => { if (object.isInstancedMesh && object.userData.detailKind) (object.userData.detailKind === 'boulder' ? boulders : detail).push(object); });
  assert.ok(boulders.length > 0 && detail.length > 0);
  for (const mesh of boulders) assert.equal(mesh.castShadow, true, 'the boulders cast shadows');
  live.cinderworks.animate(30, { player: { x: CINDER_FORGE.x, z: CINDER_FORGE.z }, lowQuality: true, reducedMotion: true });
  assert.ok(detail.some(mesh => mesh.count < mesh.userData.fullCount), 'low quality thins the ground detail');
  const ground = detail.find(mesh => mesh.userData.detailKind === 'grass'); assert.ok(ground, 'the shared grass clump is planted');
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; ground.material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.cinderworksWind.value, 0); assert.ok(shader.vertexShader.includes('cinderworksWind'));
  let plate = null; live.scene.getObjectByName('cinder-forge-sign').traverse(object => { if (object.isMesh && object.material.name === 'sign_plate') plate = object; });
  assert.ok(plate, 'the hanging sign carries the iron plate');
  const swing = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; plate.material.onBeforeCompile(swing);
  assert.equal(swing.uniforms.cinderworksWind.value, 0);
  assert.ok(swing.vertexShader.includes('cinderworksWind') && swing.vertexShader.includes('max(-position.y, 0.0)'), 'only the plate below the hinge swings');
  // Standing at the anvil inside the forge opens the roof and the two faces the
  // camera looks through, and leaves the far wall as a backdrop.
  const camera = buildingWorldPoint(CINDER_FORGE, 7, 7);
  const roof = live.scene.getObjectByName('cinder-forge-authored-cutaway-roof'), walls = live.scene.getObjectByName('cinder-forge-authored-cutaway-walls');
  assert.equal(walls.children.length, 4);
  const floorY = heightAt(CINDER_FORGE.x, CINDER_FORGE.z);
  live.settlements.animate(3, { player: { x: CINDER_FORGE.x, z: CINDER_FORGE.z, y: floorY, mode: 'ground' }, camera });
  assert.equal(roof.visible, false, 'the authored roof lifts inside the forge');
  assert.ok(walls.children.some(face => !face.visible), 'the camera-facing authored walls open');
  assert.ok(walls.children.some(face => face.visible), 'the far authored walls stay as a backdrop');
  live.settlements.animate(4, { player: { x: camera.x, z: camera.z, y: heightAt(camera.x, camera.z), mode: 'ground' }, camera });
  assert.equal(roof.visible, true); assert.ok(walls.children.every(face => face.visible), 'the forge closes again outside');
  live.cinderworks.animate(40, { player: { x: -90, z: 60 } });
  assert.ok(detail.every(mesh => !mesh.visible), 'distant ground detail hides');
  for (const mesh of boulders) assert.equal(mesh.visible, true, 'the boulders are never distance-hidden');
  live.cinderworks.dispose(); live.cinderworks.dispose();
  assert.equal(fallback.visible, true); assert.equal(live.legacyScenery.visible, true);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('forge release preserves a shared Old Watch lease and never mutates cached material bindings', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture);
  const cache = createEnvironmentAssets({ load: async url => url === sharedURL ? fixture.shared : fixture.forge });
  const watchLease = cache.acquire(sharedURL); await watchLease.ready;
  const before = [...fixture.materials.values()].map(material => ({ material, color: material.color.clone(), name: material.name, map: material.map, normalScale: material.normalScale.clone() }));
  const live = harness(undefined, cache); assert.equal(await live.cinderworks.ready, true);
  live.cinderworks.dispose(); assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  for (const entry of before) { assert.ok(entry.material.color.equals(entry.color)); assert.equal(entry.material.name, entry.name); assert.equal(entry.material.map, entry.map); assert.ok(entry.material.normalScale.equals(entry.normalScale)); }
  watchLease.release(); cache.dispose(); assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('failed, late and rollback-failing forge loads retain the original forge, sites and Emberpeak scenery', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const failed = harness(url => url === sharedURL ? pending : Promise.reject(new Error('forge offline')));
  assert.equal(await failed.cinderworks.ready, false); assert.equal(failed.cinderworks.getStats().status, 'fallback');
  assert.equal(failed.scene.getObjectByName('cinderworks-original-exterior').visible, true); assert.equal(failed.legacyScenery.visible, true);
  failed.cinderworks.dispose(); deliver(fixture.shared); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const lateFixture = fixtures(), lateCounts = disposalProbe(lateFixture); let lateDeliver;
  const latePending = new Promise(resolve => { lateDeliver = resolve; });
  const late = harness(url => url === sharedURL ? latePending : lateFixture.forge);
  late.cinderworks.dispose(); lateDeliver(lateFixture.shared); assert.equal(await late.cinderworks.ready, false);
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = harness(async url => url === sharedURL ? rollbackFixture.shared : rollbackFixture.forge);
  const install = rollback.settlements.setCinderworksKit;
  rollback.settlements.setCinderworksKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.cinderworks.ready, false); assert.match(rollback.cinderworks.getStats().error, /install failed; Fallback restore: rollback failed/);
  assert.equal(rollback.scene.getObjectByName('cinderworks-original-exterior').visible, true); assert.equal(rollback.legacyScenery.visible, true);
  assert.equal(rollback.scene.getObjectByName('cinderworks-scorched-environment'), undefined);
  rollback.cinderworks.dispose(); assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('missing prefab, material or original work site fails before authored installation', () => {
  const sites = propSites(), fixture = fixtures();
  fixture.forge.scene.remove(fixture.forge.scene.getObjectByName('cinder_forge_roof'));
  assert.throws(() => buildCinderworksKit(fixture.forge, fixture.shared, { propSites: sites }), /cinder_forge_roof/);
  const invalid = fixtures(); invalid.forge.scene.children[0].children[0].material.name = 'external_texture';
  assert.throws(() => buildCinderworksKit(invalid.forge, invalid.shared, { propSites: sites }), /binding is missing: external_texture/);
  const unsited = fixtures();
  assert.throws(() => buildCinderworksKit(unsited.forge, unsited.shared, { propSites: sites.filter(site => site.radius !== .55) }), /lantern site/);
});

test('partial prefab staging disposes every new binding without releasing source textures', () => {
  const sites = propSites(), fixture = fixtures(), counts = disposalProbe(fixture);
  let cloned = 0, released = 0;
  for (const material of fixture.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); cloned++; copy.addEventListener('dispose', () => released++); return copy; };
  }
  fixture.forge.scene.getObjectByName('basalt_boulder_b').clone = () => { throw new Error('staging interrupted'); };
  assert.throws(() => buildCinderworksKit(fixture.forge, fixture.shared, { propSites: sites }), /staging interrupted/);
  assert.ok(cloned > 0); assert.equal(released, cloned);
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  disposeOwnedResources([fixture.forge.scene, fixture.shared.scene]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('a failed shared-library load releases the separately arriving forge source', async () => {
  const fixture = fixtures(); let deliver, disposed = 0;
  fixture.forge.scene.children[0].children[0].material.addEventListener('dispose', () => disposed++);
  const pending = new Promise(resolve => { deliver = resolve; });
  const live = harness(url => url === forgeURL ? pending : Promise.reject(new Error('shared offline')));
  assert.equal(await live.cinderworks.ready, false); assert.match(live.cinderworks.getStats().error, /shared offline/);
  deliver(fixture.forge); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(live.scene.getObjectByName('cinderworks-original-exterior').visible, true);
  assert.equal(live.legacyScenery.visible, true);
  live.cinderworks.dispose(); assert.equal(disposed, 1);
});

test('shipping Cinderworks kit is geometry-only, within budget, keeps both doorways clear and seats the chimney on the smoke emitter', async () => {
  const bytes = await readFile(new URL('../client/assets/cinderworks/kit.glb', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../client/assets/cinderworks/manifest.json', import.meta.url), 'utf8'));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(bytes.readUInt32LE(8), bytes.length); assert.equal(manifest.bytes, bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.ok(bytes.length < 3.5 * 1024 * 1024); assert.equal((gltf.images ?? []).length, 0); assert.equal((gltf.textures ?? []).length, 0);
  // Tints are still being judged in engine, so only the shape of the contract is
  // pinned here: the shipped kit and the runtime dictionary are one source.
  assert.deepEqual(manifest.materialBindings, CINDERWORKS_MATERIAL_BINDINGS);
  const slots = new Set(gltf.materials.map(material => material.name));
  for (const name of slots) assert.ok(CINDERWORKS_MATERIAL_BINDINGS[name], name + ' is a declared binding');
  for (const slot of ['sign_plate', 'ember_crystal']) assert.ok(slots.has(slot), slot + ' is used by the kit');
  for (const name of CINDERWORKS_PREFABS) assert.ok(gltf.nodes.some(node => node.name === name), name);
  let triangles = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) assert.ok(primitive.attributes[attribute] >= 0, attribute);
    assert.ok(CINDERWORKS_MATERIAL_BINDINGS[gltf.materials[primitive.material].name]);
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  assert.ok(triangles > 10000 && triangles < 40000); assert.equal(triangles, manifest.totalTriangles);
  const forge = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (const name of CINDERWORKS_PREFABS) {
    const root = forge.scene.getObjectByName(name); assert.ok(root, name);
    assert.ok(root.position.length() < 1e-6); assert.ok(root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6); assert.ok(root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6);
  }
  forge.scene.updateMatrixWorld(true);
  const building = CINDER_FORGE, vertex = new THREE.Vector3();
  const sample = (name, visit) => forge.scene.getObjectByName(name).traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) visit(vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld));
  });
  for (const part of ['base', 'wall_front', 'wall_back']) sample('cinder_forge_' + part, point => {
    assert.ok(!(Math.abs(point.x) < building.doorWidth / 2 - .002 && point.y > .03 && point.y < building.doorHeight - .002
      && Math.abs(point.z) > building.depth / 2 - building.wallThickness && Math.abs(point.z) < building.depth / 2 + .1), 'both doorway prisms remain clear');
  });
  sample('cinder_forge_base', point => {
    assert.ok(Math.abs(point.x) <= building.width / 2 + 1e-4 && Math.abs(point.z) <= building.depth / 2 + 1e-4, 'the base keeps the shared footprint');
    assert.ok(point.y <= .4801, 'the flagstone floor stays under the wall skirt');
  });
  for (const face of ['east', 'west', 'front', 'back']) sample('cinder_forge_wall_' + face, point => {
    assert.ok(Math.abs(point.x) <= building.width / 2 + 1e-4, face + ' wall stays inside the shared width');
    assert.ok(Math.abs(point.z) <= building.depth / 2 + .16 + 1e-4, face + ' wall keeps hung detail within .16 m');
    assert.ok(point.y >= .4799 && point.y <= building.wallHeight + 1e-4, face + ' wall stays between the base and the eave');
  });
  const chimney = manifest.buildingContracts.cinder_forge.chimney;
  assert.deepEqual(chimney.map(value => Math.round(value * 1e6) / 1e6),
    [-building.width * .29, building.height - .10, -building.depth * .22].map(value => Math.round(value * 1e6) / 1e6), 'chimney contract matches the retained smoke emitter');
  let stack = 0;
  sample('cinder_forge_roof', point => {
    assert.ok(Math.abs(point.x) <= (building.width + .35) / 2 + 1e-4 && Math.abs(point.z) <= (building.depth + .35) / 2 + 1e-4, 'the roof keeps its eave overhang');
    assert.ok(point.y >= building.wallHeight - .001 && point.y <= building.height + 1e-4, 'the roof stays inside the shared height envelope');
    if (point.y > 6.6 && Math.hypot(point.x - chimney[0], point.z - chimney[2]) < .5) stack++;
  });
  assert.ok(stack >= 20, 'the basalt stack reaches the emitter height directly under the plume: ' + stack);
  sample('forge_sign', point => {
    assert.ok(point.z >= -.06 && point.z <= .07, 'the hanging plate stays thin enough for the front face');
    assert.ok(Math.hypot(point.x, point.z) <= .45 && point.y >= -.85 && point.y <= .05, 'the sign hangs inside its envelope');
  });
  sample('basalt_outcrop', point => {
    assert.ok(Math.hypot(point.x, point.z) <= 3.0, 'the outcrop stays inside the recorded rock radius');
    assert.ok(point.y >= -.5 && point.y <= 8.0, 'the outcrop stays inside the recorded rock height');
  });
  for (const [name, envelope] of Object.entries(manifest.propEnvelopes)) sample(name, point => {
    assert.ok(Math.hypot(point.x, point.z) <= envelope.maxRadius + 1e-4, name + ' stays inside its recorded radius');
    assert.ok(point.y >= envelope.minY - 1e-4 && point.y <= envelope.maxY + 1e-4, name + ' stays inside its recorded height');
  });
  const fixture = fixtures();
  const kit = buildCinderworksKit(forge, fixture.shared, { propSites: propSites() });
  assert.deepEqual(Object.keys(kit.buildings), ['cinder-forge']);
  assert.equal(kit.counts.workSites, 3); assert.equal(kit.counts.prefabs, CINDERWORKS_PREFABS.length);
  disposeOwnedResources(kit.ownedRoots, [forge.scene, fixture.shared.scene]); disposeOwnedResources([forge.scene, fixture.shared.scene]);
});

test('scenery routes the Emberpeak rock and yard plants into their own restorable batch', async () => {
  const { buildScenery } = await import('../client/world.js');
  const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  const palette = makePalette(), scenery = buildScenery(palette, random);
  const legacy = scenery.cinderworksLegacyScenery;
  assert.ok(legacy); assert.equal(legacy.visible, true);
  const positions = legacy.geometry.attributes.position; assert.ok(positions.count > 0);
  let routed = 0, strays = 0;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    if (Math.hypot(x - 69, z + 34) < 4 && y > heightAt(69, -34) + 1) routed++;
    if (x < 50 || z > -15) strays++;
  }
  assert.ok(routed > 0, 'the collidable rock at 69,-34 is routed into the Cinderworks batch');
  assert.equal(strays, 0, 'nothing outside Emberpeak is routed into the Cinderworks batch');
  assert.equal(scenery.group.getObjectByName('cinderworks-original-scenery'), legacy);
  disposeOwnedResources(scenery.group);
  for (const geometry of Object.values(palette.geometry)) geometry.dispose();
});
