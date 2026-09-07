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
import { MOONWATCH, MOONWATCH_DOME, MOONWATCH_TRAIL, MOONBLOOM_SHRINE, MOONWATCH_CANOPY_OBSTACLES, MOONWATCH_ROCK_OBSTACLES,
  moonwatchWeight, moonwatchPaths, moonwatchPlantClearance, moonwatchWorkSites } from '../shared/moonwatch.js';
import { MOONWATCH_PREFABS, MOONWATCH_MATERIAL_BINDINGS, buildMoonwatchTerrain, buildMoonwatchKit, createMoonwatch } from '../client/moonwatch.js';
import { createEnvironmentAssets, disposeOwnedResources } from '../client/environment-assets.js';
import { createEnvironmentLighting, environmentWeights, ENVIRONMENT_PROFILES } from '../client/environment-lighting.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const sharedURL = '/assets/old-watch/kit.glb', moonwatchURL = '/assets/moonwatch/kit.glb';
// Each authored root leans on one slot; the lantern and the crystals need
// moon_glass and the trees need lavender_leaf so the emissive binding and the
// canopy wind hook both have a real target.
const PREFAB_SLOTS = {
  moonwatch_observatory: 'silver_stave', star_telescope: 'bright_brass', star_table: 'moon_ashlar', chart_crate: 'pale_frame',
  moon_lantern: 'moon_glass', armillary_sphere: 'verdigris_bronze', scholar_bench: 'pale_frame', silver_tree_a: 'lavender_leaf',
  silver_tree_b: 'lavender_leaf', moon_mushroom: 'mushroom_cap', moon_crystal: 'moon_glass', moon_boulder: 'moon_ashlar', moonbell_clump: 'moonbell',
};
function fixtures() {
  const shared = { scene: new THREE.Group() }, kit = { scene: new THREE.Group() };
  const geometry = new THREE.BoxGeometry(.2, .5, .2), materials = new Map();
  for (const name of new Set(['ground_earth', 'needle_foliage', ...Object.values(MOONWATCH_MATERIAL_BINDINGS).map(binding => binding.source)])) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const carrier = new THREE.Mesh(geometry, material); carrier.name = 'material-' + name; shared.scene.add(carrier);
  }
  for (const name of ['fern_clump', 'grass_clump']) {
    const library = new THREE.Group(); library.name = name; library.add(new THREE.Mesh(geometry, materials.get('needle_foliage'))); shared.scene.add(library);
  }
  const spare = Object.keys(MOONWATCH_MATERIAL_BINDINGS).filter(slot => !Object.values(PREFAB_SLOTS).includes(slot));
  MOONWATCH_PREFABS.forEach((name, index) => {
    const root = new THREE.Group(); root.name = name;
    // The observatory also parks every otherwise unused slot so all bindings are bound.
    for (const slot of [PREFAB_SLOTS[name], ...(index ? [] : spare)]) {
      const material = new THREE.MeshStandardMaterial(); material.name = slot; root.add(new THREE.Mesh(geometry, material));
    }
    kit.scene.add(root);
  });
  return { shared, kit, geometry, materials };
}
function harness(load, assets) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette()), legacyScenery = new THREE.Group();
  scene.add(settlements.group, legacyScenery);
  return { scene, settlements, legacyScenery, moonwatch: createMoonwatch({ scene, settlements, legacyScenery, load, assets }) };
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

test('the observatory weight lights the grounds, spares the moon shrine and keeps every walked route clear', () => {
  const sites = moonwatchWorkSites(propSites());
  assert.equal(moonwatchWeight(MOONWATCH_DOME.x, MOONWATCH_DOME.z), 1, 'the dome');
  assert.ok(moonwatchWeight(MOONWATCH.x, MOONWATCH.z) > .95, 'the observatory grounds');
  for (const name of ['table', 'lantern']) assert.equal(moonwatchWeight(sites[name].x, sites[name].z), 1, name + ' site');
  // The telescope and the chart crate stand 17.5 m from the shrine, inside its
  // 9 m cut-back, so they carry a partial weight by design.
  for (const name of ['telescope', 'crate']) assert.ok(moonwatchWeight(sites[name].x, sites[name].z) > .3, name + ' site: ' + moonwatchWeight(sites[name].x, sites[name].z));
  assert.equal(moonwatchWeight(MOONBLOOM_SHRINE.x, MOONBLOOM_SHRINE.z), 0, 'the moon shrine keeps the island baseline');
  assert.ok(moonwatchWeight(89, 36) < .05, 'the mid-trail junction still reads as the baseline island');
  for (const [x, z] of [[-90, 6], [-64, -76], [-42, -53], [-29, 39], [-15, 96], [30, 96], [80, -45]]) assert.equal(moonwatchWeight(x, z), 0, x + ',' + z + ' belongs to another area');
  assert.equal(moonwatchWeight(NaN, 0), 0); assert.equal(moonwatchWeight(0, NaN), 0);
  assert.deepEqual(MOONWATCH_CANOPY_OBSTACLES.map(obstacle => obstacle.id), ['prop-28'], 'only the recorded silver tree is authored');
  assert.deepEqual(MOONWATCH_ROCK_OBSTACLES.map(obstacle => obstacle.id), ['prop-33'], 'only the recorded moon boulder is authored');
  for (const obstacle of MOONWATCH_CANOPY_OBSTACLES) { assert.equal(obstacle.type, 'tree', obstacle.id); assert.ok(moonwatchWeight(obstacle.x, obstacle.z) > 0, obstacle.id); }
  for (const obstacle of MOONWATCH_ROCK_OBSTACLES) { assert.equal(obstacle.type, 'rock', obstacle.id); assert.ok(moonwatchWeight(obstacle.x, obstacle.z) > 0, obstacle.id); }
  assert.ok(![...MOONWATCH_CANOPY_OBSTACLES, ...MOONWATCH_ROCK_OBSTACLES].some(obstacle => obstacle.id === 'prop-29'), 'the tree beyond the grove stays original');
  const routes = moonwatchPaths(); assert.equal(routes.length, 3);
  // The dome is not enterable, so only the inner end of the door approach is ever
  // pushed back, and exactly at the recorded collider reach.
  for (const [index, route] of routes.entries()) for (let i = 1; i < route.length; i++) for (let step = 0; step <= 40; step++) {
    const t = step / 40, x = route[i - 1].x * (1 - t) + route[i].x * t, z = route[i - 1].z * (1 - t) + route[i].z * t;
    const point = { x, z, y: heightAt(x, z) }; resolveWorldCollision(point);
    const blocked = index === 2 && Math.hypot(x - MOONWATCH_DOME.x, z - MOONWATCH_DOME.z) < MOONWATCH_DOME.radius + .6;
    assert.equal(Math.hypot(point.x - x, point.z - z) > 1e-6, blocked, 'the trail, Lio\'s loop and the door approach stay walkable');
  }
  assert.deepEqual(Object.keys(sites), ['telescope', 'table', 'crate', 'lantern']);
  assert.ok(Math.hypot(sites.telescope.x - 93.4728, sites.telescope.z - 33.4838) < .01, 'the telescope keeps its authored stand');
  assert.ok(Math.hypot(sites.table.x - 97.8754, sites.table.z - 48.3050) < .01, 'the star table keeps its authored pad');
  assert.deepEqual([sites.crate.x, sites.crate.z], [88, 45]);
  assert.ok(Math.hypot(sites.lantern.x - 98.5966, sites.lantern.z - 44.9941) < .01, 'the lantern keeps its authored post');
  for (const site of Object.values(sites)) assert.equal(site.poiId, 'moonwatch');
  assert.throws(() => moonwatchWorkSites([]), /missing its original telescope site/);
  assert.equal(moonwatchPlantClearance(MOONBLOOM_SHRINE.x, MOONBLOOM_SHRINE.z, Object.values(sites)), false, 'the shrine ring is never planted');
  const guards = ENCOUNTER_GROUPS.find(group => group.id === 'moonwatch'); assert.deepEqual([guards.x, guards.z], [97, 31]);
  assert.equal(moonwatchPlantClearance(guards.x, guards.z, Object.values(sites)), false, 'the guarded approach stays open');
  for (const id of ['chest-25', 'chest-17']) {
    const chest = CHESTS.find(entry => entry.id === id);
    assert.equal(moonwatchPlantClearance(chest.x, chest.z, Object.values(sites)), false, id + ' stays reachable');
  }
  for (const [name, site] of Object.entries(sites)) assert.equal(moonwatchPlantClearance(site.x, site.z, Object.values(sites)), false, name + ' site is never planted over');
  for (const point of RESIDENTS.find(person => person.poiId === 'moonwatch').route) assert.equal(moonwatchPlantClearance(point.x, point.z, Object.values(sites)), false, 'Lio walks his loop unobstructed');
  assert.equal(moonwatchPlantClearance(80, 50, Object.values(sites)), true, 'the open grove still plants');
});

test('the moonwatch profile reaches the grounds over one continuous walk and never steps on the .1 m grid', () => {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#85d9ee'); scene.fog = new THREE.Fog('#a2def0', 180, 610);
  const hemisphere = new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2), sun = new THREE.DirectionalLight('#fff0d0', 2.7);
  const lighting = createEnvironmentLighting({ scene, hemisphere, sun });
  const ready = { oldWatchReady: true, farmReady: true, tideglassReady: true, saltwindReady: true, driftwoodReady: true, palmheartReady: true, cinderworksReady: true, moonwatchReady: true };
  assert.ok(ENVIRONMENT_PROFILES.moonwatch, 'the kit ships its own lighting profile');
  assert.ok('moonwatch' in environmentWeights({ x: MOONWATCH.x, z: MOONWATCH.z }, ready), 'the weight set carries a moonwatch key');
  assert.equal(environmentWeights({ x: MOONWATCH.x, z: MOONWATCH.z }, { ...ready, moonwatchReady: false }).moonwatch, 0, 'a failed kit keeps the island baseline');
  let lastAmbient = null;
  for (let leg = 1; leg < MOONWATCH_TRAIL.length; leg++) {
    const from = MOONWATCH_TRAIL[leg - 1], to = MOONWATCH_TRAIL[leg], steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .1);
    for (let step = leg === 1 ? 0 : 1; step <= steps; step++) {
      const t = step / steps, player = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
      lighting.update(player, ready);
      if (lastAmbient != null) assert.ok(Math.abs(hemisphere.intensity - lastAmbient) < .01, 'shrine to observatory is one continuous walk');
      else assert.equal(hemisphere.intensity, 2.2, 'the shrine keeps the island baseline');
      lastAmbient = hemisphere.intensity;
    }
  }
  assert.ok(Math.abs(lastAmbient - ENVIRONMENT_PROFILES.moonwatch.ambient) < .01, 'the grounds reach the cool lunar profile');
  lighting.update({ x: MOONWATCH_DOME.x, z: MOONWATCH_DOME.z }, ready);
  assert.equal(hemisphere.intensity, ENVIRONMENT_PROFILES.moonwatch.ambient); assert.equal(sun.intensity, ENVIRONMENT_PROFILES.moonwatch.sunIntensity);
  assert.equal(scene.fog.near, ENVIRONMENT_PROFILES.moonwatch.near); assert.equal(scene.fog.far, ENVIRONMENT_PROFILES.moonwatch.far);
  // Every approach to the dome, not only the trail: a .1 m grid over the whole
  // area, scanned along both axes with every other kit ready as well.
  const ambients = { baseline: 2.2, ...Object.fromEntries(Object.entries(ENVIRONMENT_PROFILES).map(([key, profile]) => [key, profile.ambient])) };
  const previousRow = []; let maxStep = 0, maxDrift = 0;
  for (let zi = 0; zi <= 580; zi++) {
    const z = 14 + zi * .1; let west = null;
    for (let xi = 0; xi <= 580; xi++) {
      const weights = environmentWeights({ x: 68 + xi * .1, z }, ready);
      let ambient = 0, total = 0;
      for (const key in weights) { ambient += weights[key] * ambients[key]; total += weights[key]; }
      maxDrift = Math.max(maxDrift, Math.abs(total - 1));
      if (west != null) maxStep = Math.max(maxStep, Math.abs(ambient - west));
      if (previousRow[xi] != null) maxStep = Math.max(maxStep, Math.abs(ambient - previousRow[xi]));
      west = previousRow[xi] = ambient;
    }
  }
  assert.ok(maxDrift < 1e-12, 'every sampled weight set still normalizes');
  assert.ok(maxStep < .01, 'the ambient never steps more than .01 per .1 m: ' + maxStep);
  lighting.dispose(); assert.equal(hemisphere.intensity, 2.2); assert.equal(scene.background.getHexString(), '85d9ee');
});

test('the moss overlay lies on the actual terrain diagonals, fades at the grid border and skips the dome footprint', () => {
  const sites = moonwatchWorkSites(propSites());
  const floor = buildMoonwatchTerrain(new THREE.MeshStandardMaterial(), sites);
  assert.equal(floor.name, 'moonwatch-moss-and-gravel');
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
  let boundary = 0, covered = 0, footprint = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i), alpha = color.getW(i);
    if (x === minX || x === maxX || z === minZ || z === maxZ) { assert.equal(alpha, 0, 'the moss fades out at the grid border'); boundary++; }
    if (heightAt(x, z) < 1.7) assert.equal(alpha, 0, 'the overlay stops above the shoreline');
    if (Math.hypot(x - MOONWATCH_DOME.x, z - MOONWATCH_DOME.z) < MOONWATCH_DOME.radius + .3) { assert.equal(alpha, 0, 'the ashlar plinth stays clean'); footprint++; }
    if (alpha > .3) covered++;
  }
  assert.ok(boundary > 40); assert.ok(footprint > 0, 'the grid actually samples the dome footprint');
  assert.ok(covered >= 60, 'the grounds and the trodden path are actually covered');
  disposeOwnedResources([floor]);
});

test('the observatory installs atomically with an authored dome, four work sites, a dressed boulder and a planted grove', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture), loads = [];
  const bindings = JSON.stringify(MOONWATCH_MATERIAL_BINDINGS);
  const live = harness(async url => { loads.push(url); return url === sharedURL ? fixture.shared : fixture.kit; });
  const fallback = live.scene.getObjectByName('moonwatch-original-exterior');
  assert.equal(fallback.visible, true);
  for (const name of ['moonwatch-dome-original', 'moonwatch-original-work-sites']) assert.ok(fallback.getObjectByName(name), name);
  assert.equal(await live.moonwatch.ready, true); assert.deepEqual(loads, [sharedURL, moonwatchURL]);
  assert.equal(fallback.visible, false); assert.equal(live.legacyScenery.visible, false);
  for (const name of ['moonwatch-silvered-environment', 'moonwatch-authored-observatory', 'moonwatch-authored-star-telescope', 'moonwatch-authored-star-table',
    'moonwatch-authored-chart-crate', 'moonwatch-authored-moon-lantern', 'moonwatch-moss-and-gravel', 'moonwatch-boulder-prop-33', 'moonwatch-canopy-prop-28']) {
    assert.ok(live.scene.getObjectByName(name), name);
  }
  let lights = 0; live.scene.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'the observatory adds no scene light, so every island shader keeps its light count');
  const stats = live.moonwatch.getStats();
  assert.equal(stats.prefabs, MOONWATCH_PREFABS.length); assert.equal(stats.workSites, 4);
  assert.equal(stats.canopyTrees, 1); assert.equal(stats.boulders, 1);
  assert.ok(stats.extraProps >= 1, 'the loose instruments find a clearance: ' + stats.extraProps);
  assert.ok(stats.trees >= 18, 'the grove stays planted: trees ' + stats.trees);
  assert.ok(stats.mushrooms >= 18, 'the grove keeps its moon mushrooms: ' + stats.mushrooms);
  assert.ok(stats.crystals > 20 && stats.moonbells > 90 && stats.ferns > 60 && stats.grass > 60, 'the lilac ground is actually dressed');
  // The kit's only glow is the emissive binding, and the cached dictionary is
  // never touched while the runtime binds it.
  let glass = null; live.scene.getObjectByName('moonwatch-authored-moon-lantern').traverse(object => { if (object.isMesh && object.material.name === 'moon_glass') glass = object; });
  assert.ok(glass, 'the lantern carries a moon-glass block');
  assert.deepEqual(glass.material.emissive.toArray(), MOONWATCH_MATERIAL_BINDINGS.moon_glass.emissive);
  assert.equal(glass.material.emissiveIntensity, MOONWATCH_MATERIAL_BINDINGS.moon_glass.emissiveIntensity);
  assert.equal(glass.material.side, THREE.DoubleSide);
  assert.equal(JSON.stringify(MOONWATCH_MATERIAL_BINDINGS), bindings, 'binding the kit never rewrites the dictionary');
  live.moonwatch.animate(10, {}); const angle = live.moonwatch.getStats().windValue;
  live.moonwatch.animate(20, {}); assert.notEqual(live.moonwatch.getStats().windValue, angle, 'the leaves and the moonbells sway while animated');
  const canopy = [], detail = [];
  live.scene.traverse(object => { if (object.isInstancedMesh && object.userData.detailKind) (['tree', 'mushroom'].includes(object.userData.detailKind) ? canopy : detail).push(object); });
  assert.ok(canopy.length > 0 && detail.length > 0);
  for (const mesh of canopy) assert.equal(mesh.castShadow, true, 'the silver trees and the mushrooms cast shadows');
  live.moonwatch.animate(30, { player: { x: MOONWATCH.x, z: MOONWATCH.z }, lowQuality: true, reducedMotion: true });
  assert.equal(live.moonwatch.getStats().windValue, 0, 'reduced motion parks the wind');
  assert.ok(detail.some(mesh => mesh.count < mesh.userData.fullCount), 'low quality thins the ground detail');
  const ground = detail.find(mesh => mesh.userData.detailKind === 'grass'); assert.ok(ground, 'the shared grass clump is planted');
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; ground.material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.moonwatchWind.value, 0); assert.ok(shader.vertexShader.includes('moonwatchWind'));
  const leaf = canopy.find(mesh => mesh.material.name === 'lavender_leaf'); assert.ok(leaf, 'the silver trees carry authored leaves');
  const foliage = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; leaf.material.onBeforeCompile(foliage);
  assert.equal(foliage.uniforms.moonwatchWind.value, 0); assert.ok(foliage.vertexShader.includes('position.y - 2.0'), 'only the canopy above head height sways');
  const cap = canopy.find(mesh => mesh.userData.detailKind === 'mushroom'); assert.ok(cap, 'the moon mushrooms are planted');
  const rigid = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; cap.material.onBeforeCompile(rigid);
  assert.deepEqual(rigid.uniforms, {}, 'the mushroom caps stay rigid');
  live.moonwatch.animate(40, { player: { x: -90, z: 60 } });
  assert.ok(detail.every(mesh => !mesh.visible), 'distant ground detail hides');
  for (const mesh of canopy) assert.equal(mesh.visible, true, 'the grove canopy is never distance-hidden');
  live.moonwatch.dispose(); live.moonwatch.dispose();
  assert.equal(fallback.visible, true); assert.equal(live.legacyScenery.visible, true);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('observatory release preserves a shared Old Watch lease and never mutates cached material bindings', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture);
  assert.ok(Object.isFrozen(MOONWATCH_MATERIAL_BINDINGS), 'the binding dictionary is frozen');
  const cache = createEnvironmentAssets({ load: async url => url === sharedURL ? fixture.shared : fixture.kit });
  const watchLease = cache.acquire(sharedURL); await watchLease.ready;
  const before = [...fixture.materials.values()].map(material => ({ material, color: material.color.clone(), name: material.name, map: material.map,
    normalScale: material.normalScale.clone(), emissive: material.emissive.clone(), emissiveIntensity: material.emissiveIntensity, side: material.side }));
  const live = harness(undefined, cache); assert.equal(await live.moonwatch.ready, true);
  live.moonwatch.dispose(); assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  for (const entry of before) {
    assert.ok(entry.material.color.equals(entry.color)); assert.equal(entry.material.name, entry.name); assert.equal(entry.material.map, entry.map);
    assert.ok(entry.material.normalScale.equals(entry.normalScale)); assert.ok(entry.material.emissive.equals(entry.emissive));
    assert.equal(entry.material.emissiveIntensity, entry.emissiveIntensity); assert.equal(entry.material.side, entry.side);
  }
  watchLease.release(); cache.dispose(); assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('failed, late and rollback-failing observatory loads retain the original dome, sites and Moonbloom scenery', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const failed = harness(url => url === sharedURL ? pending : Promise.reject(new Error('observatory offline')));
  assert.equal(await failed.moonwatch.ready, false); assert.equal(failed.moonwatch.getStats().status, 'fallback');
  assert.equal(failed.scene.getObjectByName('moonwatch-original-exterior').visible, true); assert.equal(failed.legacyScenery.visible, true);
  failed.moonwatch.dispose(); deliver(fixture.shared); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const lateFixture = fixtures(), lateCounts = disposalProbe(lateFixture); let lateDeliver;
  const latePending = new Promise(resolve => { lateDeliver = resolve; });
  const late = harness(url => url === sharedURL ? latePending : lateFixture.kit);
  late.moonwatch.dispose(); lateDeliver(lateFixture.shared); assert.equal(await late.moonwatch.ready, false);
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = harness(async url => url === sharedURL ? rollbackFixture.shared : rollbackFixture.kit);
  const install = rollback.settlements.setMoonwatchKit;
  rollback.settlements.setMoonwatchKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.moonwatch.ready, false); assert.match(rollback.moonwatch.getStats().error, /install failed; Fallback restore: rollback failed/);
  assert.equal(rollback.scene.getObjectByName('moonwatch-original-exterior').visible, true); assert.equal(rollback.legacyScenery.visible, true);
  assert.equal(rollback.scene.getObjectByName('moonwatch-silvered-environment'), undefined);
  rollback.moonwatch.dispose(); assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('missing prefab, material or original work site fails before authored installation', () => {
  const sites = propSites(), fixture = fixtures();
  fixture.kit.scene.remove(fixture.kit.scene.getObjectByName('moon_mushroom'));
  assert.throws(() => buildMoonwatchKit(fixture.kit, fixture.shared, { propSites: sites }), /moon_mushroom/);
  const invalid = fixtures(); invalid.kit.scene.children[0].children[0].material.name = 'external_texture';
  assert.throws(() => buildMoonwatchKit(invalid.kit, invalid.shared, { propSites: sites }), /binding is missing: external_texture/);
  const unsited = fixtures();
  assert.throws(() => buildMoonwatchKit(unsited.kit, unsited.shared, { propSites: sites.filter(site => site.radius !== .55) }), /lantern site/);
});

test('partial prefab staging disposes every new binding without releasing source textures', () => {
  const sites = propSites(), fixture = fixtures(), counts = disposalProbe(fixture);
  let cloned = 0, released = 0;
  for (const material of fixture.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); cloned++; copy.addEventListener('dispose', () => released++); return copy; };
  }
  fixture.kit.scene.getObjectByName('moon_boulder').clone = () => { throw new Error('staging interrupted'); };
  assert.throws(() => buildMoonwatchKit(fixture.kit, fixture.shared, { propSites: sites }), /staging interrupted/);
  assert.ok(cloned > 0); assert.equal(released, cloned);
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  disposeOwnedResources([fixture.kit.scene, fixture.shared.scene]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('a failed shared-library load releases the separately arriving observatory source', async () => {
  const fixture = fixtures(); let deliver, disposed = 0;
  fixture.kit.scene.children[0].children[0].material.addEventListener('dispose', () => disposed++);
  const pending = new Promise(resolve => { deliver = resolve; });
  const live = harness(url => url === moonwatchURL ? pending : Promise.reject(new Error('shared offline')));
  assert.equal(await live.moonwatch.ready, false); assert.match(live.moonwatch.getStats().error, /shared offline/);
  deliver(fixture.kit); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(live.scene.getObjectByName('moonwatch-original-exterior').visible, true);
  assert.equal(live.legacyScenery.visible, true);
  live.moonwatch.dispose(); assert.equal(disposed, 1);
});

test('shipping Moonwatch kit is geometry-only, within budget, and keeps every envelope, trunk and vertex tint', async () => {
  const bytes = await readFile(new URL('../client/assets/moonwatch/kit.glb', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../client/assets/moonwatch/manifest.json', import.meta.url), 'utf8'));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(bytes.readUInt32LE(8), bytes.length); assert.equal(manifest.bytes, bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.ok(bytes.length < 3.5 * 1024 * 1024); assert.equal((gltf.images ?? []).length, 0); assert.equal((gltf.textures ?? []).length, 0);
  // Tints are still being judged in engine, so only the shape of the contract is
  // pinned here: the shipped kit and the runtime dictionary are one source.
  assert.deepEqual(manifest.materialBindings, MOONWATCH_MATERIAL_BINDINGS);
  const slots = new Set(gltf.materials.map(material => material.name));
  for (const name of slots) assert.ok(MOONWATCH_MATERIAL_BINDINGS[name], name + ' is a declared binding');
  for (const slot of ['moon_glass', 'lavender_leaf', 'verdigris_bronze', 'silver_stave']) assert.ok(slots.has(slot), slot + ' is used by the kit');
  for (const name of MOONWATCH_PREFABS) assert.ok(gltf.nodes.some(node => node.name === name), name);
  let triangles = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) assert.ok(primitive.attributes[attribute] >= 0, attribute);
    assert.ok(MOONWATCH_MATERIAL_BINDINGS[gltf.materials[primitive.material].name]);
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  assert.ok(triangles > 15000 && triangles < 40000, 'triangles: ' + triangles); assert.equal(triangles, manifest.totalTriangles);
  const kit = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (const name of MOONWATCH_PREFABS) {
    const root = kit.scene.getObjectByName(name); assert.ok(root, name);
    assert.ok(root.position.length() < 1e-6); assert.ok(root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6); assert.ok(root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6);
  }
  kit.scene.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  const sample = (name, visit) => kit.scene.getObjectByName(name).traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) visit(vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld), object);
  });
  // The dome is not enterable, so the only contract is the collider it dresses.
  const contract = manifest.buildingContracts.moonwatch_observatory;
  assert.equal(contract.radius, 3.60); assert.equal(contract.minY, -.80); assert.equal(contract.maxY, 8.85);
  assert.equal(contract.colliderRadius, MOONWATCH_DOME.radius); assert.equal(contract.height, MOONWATCH_DOME.height); assert.equal(contract.enterable, false);
  let observatory = 0;
  sample('moonwatch_observatory', point => {
    assert.ok(Math.hypot(point.x, point.z) <= 3.60 + 1e-4, 'the observatory stays inside the authored radius');
    assert.ok(point.y >= -.80 - 1e-4 && point.y <= 8.85 + 1e-4, 'the observatory stays inside the authored height'); observatory++;
  });
  assert.ok(observatory > 1000, 'the observatory is actually modelled: ' + observatory);
  for (const [name, envelope] of Object.entries(manifest.propEnvelopes)) sample(name, point => {
    assert.ok(Math.hypot(point.x, point.z) <= envelope.maxRadius + 1e-4, name + ' stays inside its recorded radius');
    assert.ok(point.y >= envelope.minY - 1e-4 && point.y <= envelope.maxY + 1e-4, name + ' stays inside its recorded height');
  });
  // Both silver trees dress collider prop-28 at scale 1 or below, so the authored
  // trunk has to stay inside it for the first metre a player can walk into.
  assert.deepEqual(Object.keys(manifest.trunkRadii).sort(), ['silver_tree_a', 'silver_tree_b']);
  for (const [name, limit] of [['silver_tree_a', .40], ['silver_tree_b', .44]]) {
    let sampled = 0, widest = 0;
    kit.scene.getObjectByName(name).traverse(object => {
      if (!object.isMesh || object.material.name !== 'silver_bark') return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        if (vertex.y < 0 || vertex.y >= 1) continue;
        widest = Math.max(widest, Math.hypot(vertex.x, vertex.z));
        assert.ok(Math.hypot(vertex.x, vertex.z) <= limit + 1e-4, name + ' trunk stays inside ' + limit + ' m'); sampled++;
      }
    });
    assert.ok(sampled > 0, name + ' has a bark trunk at walking height');
    assert.ok(manifest.trunkRadii[name] <= limit + 1e-9 && manifest.trunkRadii[name] >= widest - 1e-4, name + ' records its measured trunk: ' + manifest.trunkRadii[name]);
  }
  const primitives = name => { let count = 0; kit.scene.getObjectByName(name).traverse(object => { if (object.isMesh) count++; }); return count; };
  assert.equal(primitives('moonbell_clump'), 1, 'the moonbell clump merges into one primitive');
  assert.ok(primitives('moon_crystal') <= 2, 'the moon crystal stays within two primitives');
  assert.equal(manifest.prefabs.moonbell_clump.primitives, 1); assert.ok(manifest.prefabs.moon_crystal.primitives <= 2);
  // The Cinderworks basalt lesson: a slot whose vertex colours average below .70
  // reads as a black silhouette once the shared texture multiplies through.
  const tints = new Map();
  kit.scene.traverse(object => {
    if (!object.isMesh) return;
    const colors = object.geometry.attributes.color; assert.ok(colors, object.material.name + ' carries COLOR_0');
    const tint = tints.get(object.material.name) ?? { sum: 0, count: 0 }; tints.set(object.material.name, tint);
    // getX/getY/getZ already denormalize the packed COLOR_0 shorts.
    for (let i = 0; i < colors.count; i++) for (const axis of ['getX', 'getY', 'getZ']) { tint.sum += colors[axis](i); tint.count++; }
  });
  assert.deepEqual([...tints.keys()].sort(), [...slots].sort(), 'every declared slot is actually used');
  for (const [name, tint] of tints) assert.ok(tint.sum / tint.count >= .70, name + ' averages ' + (tint.sum / tint.count).toFixed(3) + ' vertex colour');
  const fixture = fixtures();
  const built = buildMoonwatchKit(kit, fixture.shared, { propSites: propSites() });
  assert.equal(built.counts.workSites, 4); assert.equal(built.counts.prefabs, MOONWATCH_PREFABS.length);
  disposeOwnedResources(built.ownedRoots, [kit.scene, fixture.shared.scene]); disposeOwnedResources([kit.scene, fixture.shared.scene]);
});

test('scenery routes the Moonbloom grove decoration into its own restorable batch', async () => {
  const { buildScenery } = await import('../client/world.js');
  const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  const palette = makePalette(), scenery = buildScenery(palette, random);
  const legacy = scenery.moonwatchLegacyScenery;
  assert.ok(legacy); assert.equal(legacy.visible, true);
  const positions = legacy.geometry.attributes.position; assert.ok(positions.count > 0);
  let routed = 0, strays = 0, spared = 0;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    if (Math.hypot(x - 109, z - 35) < 4 && y > heightAt(109, 35) + 1) routed++;
    if (Math.hypot(x - 89, z - 65) < 4 && y > heightAt(89, 65) + 1) spared++;
    if (x < 68 || x > 130 || z < 10 || z > 76) strays++;
  }
  assert.ok(routed > 0, 'the collidable silver tree at 109,35 is routed into the Moonwatch batch');
  assert.equal(spared, 0, 'the tree beyond the grove keeps the island batch');
  assert.equal(strays, 0, 'nothing outside the observatory grounds is routed into the Moonwatch batch');
  assert.equal(scenery.group.getObjectByName('moonwatch-original-scenery'), legacy);
  // The routing only changes batch boundaries: the island's RNG stream is
  // untouched, so the next draw is still the recorded pre-milestone value.
  assert.equal(random(), .017430383479222655);
  disposeOwnedResources(scenery.group);
  for (const geometry of Object.values(palette.geometry)) geometry.dispose();
});
