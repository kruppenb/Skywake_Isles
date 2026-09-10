import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBSTACLES, SHRINES, SPAWN, BEACON, CHESTS, heightAt, regionAt, seededRandom, SEED } from '../shared/world.js';
import { POINTS_OF_INTEREST, BUILDINGS, trailDistance } from '../shared/exploration.js';
import { palmheartWeight } from '../shared/palmheart-camp.js';
import { moonwatchWeight } from '../shared/moonwatch.js';
import { cinderworksWeight } from '../shared/cinderworks.js';
import { oldWatchWeight } from '../shared/old-watch.js';
import { windwardFarmWeight } from '../shared/windward-farm.js';
import { isCanopyRegion, ISLAND_CANOPY_REGIONS, ISLAND_CANOPY_OBSTACLES, ISLAND_JUNGLE_TREE_OBSTACLES,
  ISLAND_JUNGLE_ROCK_OBSTACLES, ISLAND_MOON_TREE_OBSTACLES, ISLAND_VOLCANO_ROCK_OBSTACLES, ISLAND_CANOPY_NOMINALS,
  ISLAND_CANOPY_COUNTS, ISLAND_CANOPY_TOTAL, CANOPY_PEBBLE_REACH, CANOPY_CRYSTAL_HEIGHT,
  canopyTreeDressing, canopyRockDressing, canopyPlantDressing, ISLAND_LANDMARK_TOTAL } from '../shared/island.js';
import { ISLAND_PREFABS, ISLAND_CANOPY_PREFABS, ISLAND_CANOPY_SOURCES, ISLAND_CANOPY_KIT_URLS,
  ISLAND_MATERIAL_BINDINGS, buildIslandKit, createIsland } from '../client/island.js';
import { PALMHEART_MATERIAL_BINDINGS } from '../client/palmheart-camp.js';
import { MOONWATCH_MATERIAL_BINDINGS } from '../client/moonwatch.js';
import { CINDERWORKS_MATERIAL_BINDINGS } from '../client/cinderworks.js';
import { createEnvironmentAssets, disposeOwnedResources, ENVIRONMENT_ASSET_REGISTRY } from '../client/environment-assets.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const TAU = Math.PI * 2;
const SHARED_URL = '/assets/old-watch/kit.glb', ISLAND_URL = '/assets/island/kit.glb';
const JUNGLE_URL = '/assets/palmheart-camp/kit.glb', MOON_URL = '/assets/moonwatch/kit.glb', VOLCANO_URL = '/assets/cinderworks/kit.glb';
const KIT_URLS = [SHARED_URL, ISLAND_URL, JUNGLE_URL, MOON_URL, VOLCANO_URL];
const TREE_CELL = 64, ROCK_DETAIL_CELL = 32;
// The material slots each borrowed root actually carries in its shipped kit, and
// the file every root is exported from. Recorded here so the fixtures mirror the
// real kits and so a root that quietly gains or loses a primitive is caught.
const SOURCE_SLOTS = {
  jungle_tree_a: ['broad_leaf', 'jungle_bark', 'jungle_hardwood'],
  jungle_tree_b: ['broad_leaf', 'jungle_bark', 'jungle_hardwood'],
  jungle_palm: ['jungle_bark', 'palm_frond'],
  silver_tree_a: ['lavender_leaf', 'moon_glass', 'silver_bark'],
  silver_tree_b: ['lavender_leaf', 'moon_glass', 'silver_bark'],
  moon_mushroom: ['moon_glass', 'mushroom_cap', 'mushroom_stem'],
  basalt_outcrop: ['basalt_block', 'scoria'],
  basalt_boulder_a: ['basalt_block', 'scoria'],
  basalt_boulder_b: ['basalt_block', 'scoria'],
  ember_crystal: ['ember_crystal'],
  coast_rock_b: ['coast_stone'],
};
const KIT_FILES = { jungle: 'palmheart-camp', moon: 'moonwatch', volcano: 'cinderworks', island: 'island' };
const KIT_BINDINGS = { jungle: PALMHEART_MATERIAL_BINDINGS, moon: MOONWATCH_MATERIAL_BINDINGS, volcano: CINDERWORKS_MATERIAL_BINDINGS, island: ISLAND_MATERIAL_BINDINGS };
// The eleven measured source extents the nominals are fitted to: the widest
// horizontal reach and the top above the root's own origin, over actual vertices.
const MEASURED_EXTENTS = {
  jungle_tree_a: [3.3024, 7.9111], jungle_tree_b: [3.4670, 10.3180], jungle_palm: [3.0515, 9.2741],
  jungle_rock: [1.8308, 2.8095], silver_tree_a: [3.3285, 8.5743], silver_tree_b: [3.7800, 10.6549],
  moon_mushroom: [1.7552, 3.2859], basalt_outcrop: [2.7087, 7.9743], basalt_boulder_a: [.8158, 1.0400],
  basalt_boulder_b: [.9857, 1.3500], ember_crystal: [.3197, .9200],
};
// The 17 authored island roots, each with a slot the shipped dictionary declares:
// enough for buildIslandKit's own validation, with coast_rock_b carrying the
// geometry the jungle_rock alias borrows.
const ISLAND_FIXTURE_SLOTS = {
  coast_palm_a: ['palm_trunk', 'coast_frond'], coast_palm_b: ['palm_trunk', 'dead_frond'],
  coast_rock_a: ['coast_stone'], coast_rock_b: ['coast_stone'],
  fishing_skiff_a: ['skiff_plank', 'skiff_teal'], fishing_skiff_b: ['skiff_plank', 'skiff_coral'],
  palm_gate_pillar: ['jungle_gate_stone'], palm_gate_lintel: ['jungle_gate_stone'],
  moon_gate_ring: ['lunar_stone', 'lunar_glow'], moon_gate_orb: ['lunar_stone'],
  shrine_mushroom: ['lunar_cap', 'lunar_stem'], shrine_moon_crystal: ['lunar_glow'],
  caldera_ridge_a: ['caldera_basalt', 'caldera_weathered'], caldera_ridge_b: ['caldera_basalt'],
  caldera_amber_crystal: ['caldera_glow'], ember_core: ['caldera_basalt'], ember_core_rock: ['caldera_basalt'],
};

// --------------------------------------------------------------------------
// An independent re-derivation of every wild canopy draw. It reads only the
// shared world data and the original loop structure - never shared/island.js's
// helpers or the captured descriptors - so a capture that drifts, resamples the
// terrain or repeats an RNG decision cannot agree with it.
const WAYPOINTS = [SPAWN, ...SHRINES];
function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}
const routeDistance = (x, z) => Math.min(trailDistance(x, z), ...WAYPOINTS.map(point => segmentDistance(x, z, BEACON, point)));
function reserved(x, z, padding = 0) {
  if (routeDistance(x, z) < 6 + padding) return true;
  if (POINTS_OF_INTEREST.some(place => Math.hypot(x - place.x, z - place.z) < place.radius + padding)) return true;
  if (BUILDINGS.some(building => Math.hypot(x - building.x, z - building.z) < building.radius + 2 + padding)) return true;
  if ([SPAWN, BEACON, ...SHRINES].some(place => Math.hypot(x - place.x, z - place.z) < 11 + padding)) return true;
  return CHESTS.some(chest => Math.hypot(x - chest.x, z - chest.z) < 3.2 + padding);
}
const uniform = scale => [scale, scale, scale];
function derivedCanopySites() {
  const sites = [], random = seededRandom(SEED);
  for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  // Every scenery obstacle draws exactly one yaw, whatever batch it lands in;
  // none of the model helpers touches the stream.
  for (const obstacle of OBSTACLES) {
    if (obstacle.type === 'landmark' || obstacle.type === 'building' || obstacle.pilot === 'old-watch') continue;
    const { x, z } = obstacle, y = heightAt(x, z), region = regionAt(x, z)?.id;
    if (obstacle.type === 'hut') { random(); continue; }
    const yaw = random() * TAU;
    if (obstacle.type === 'tree') {
      const wild = region === 'moon' ? moonwatchWeight(x, z) <= 0 : region === 'jungle' ? palmheartWeight(x, z) <= 0 : false;
      if (!wild) continue;
      const prefab = region === 'moon' ? 'silver_tree_b' : 'jungle_tree_b';
      // Both camps already divide their own collidable trees by 3.8 and 11.
      sites.push({ id: obstacle.id, kind: region === 'moon' ? 'moonTrees' : 'jungleTrees', region, prefab, x, y, z,
        rotation: [0, yaw, 0], scale: [obstacle.radius / 3.8, obstacle.height / 11, obstacle.radius / 3.8],
        collidable: true, radius: obstacle.radius, height: obstacle.height });
    } else {
      const radius = obstacle.radius || 1.6, height = obstacle.height || 2;
      if (cinderworksWeight(x, z) > 0 || moonwatchWeight(x, z) > 0 || !isCanopyRegion(region)) continue;
      const volcano = region === 'volcano';
      // Cinderworks' basalt column divides by 3 and 8; the jungle alias takes
      // coast_rock_b's own nominal 2 by 3.
      sites.push({ id: obstacle.id, kind: volcano ? 'volcanoRocks' : 'jungleRocks', region,
        prefab: volcano ? 'basalt_outcrop' : 'jungle_rock', x, y, z, rotation: [0, yaw, 0],
        scale: volcano ? [radius / 3, height / 8, radius / 3] : [radius / 2.0, height / 3, radius / 2.0],
        collidable: true, radius, height });
    }
  }
  for (let i = 0; i < 245; i++) {
    const a = random() * TAU, radius = Math.sqrt(random()) * 124;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius, y = heightAt(x, z);
    if (y < 1.7 || reserved(x, z, 1.2) || OBSTACLES.some(o => o.pilot !== 'old-watch' && Math.hypot(x - o.x, z - o.z) < o.radius + 3)) continue;
    const region = regionAt(x, z)?.id, size = .58 + random() * .40;
    const claimed = oldWatchWeight(x, z) > 0 || windwardFarmWeight(x, z) > 0 || palmheartWeight(x, z) > 0
      || cinderworksWeight(x, z) > 0 || moonwatchWeight(x, z) > 0;
    if (claimed || !isCanopyRegion(region)) continue;
    const site = (id, kind, prefab, scale, rotation, plant) =>
      sites.push({ id: id + i, kind, region, prefab, x, y, z, rotation, scale, collidable: false, size: plant });
    if (region === 'moon') {
      if (i % 3 === 0) site('canopy-moon-tree-', 'moonTrees', i % 2 ? 'silver_tree_b' : 'silver_tree_a', uniform(size), [0, a, 0], size);
      else { const cap = size * (i % 4 === 0 ? 1.55 : 1); site('canopy-moon-mushroom-', 'moonMushrooms', 'moon_mushroom', uniform(cap), [0, a, 0], cap); }
    } else if (region === 'volcano') {
      // A shard is fitted to the original cluster's tallest spike, a lump to the
      // mean of the original dodecahedron's x and z half-extents.
      if (i % 3 === 0) site('canopy-volcano-crystal-', 'volcanoCrystals', 'ember_crystal', uniform(3 * size / .95), [0, a, 0], size);
      else {
        const prefab = i % 2 ? 'basalt_boulder_b' : 'basalt_boulder_a';
        site('canopy-volcano-pebble-', 'volcanoPebbles', prefab, uniform(1.15 * size / (i % 2 ? 1.0 : .85)), [.3, a, .1], size);
      }
    } else if (i % 3 !== 0) site('canopy-jungle-tree-', 'jungleTrees', i % 2 ? 'jungle_tree_b' : 'jungle_tree_a', uniform(size), [0, a, 0], size);
    else site('canopy-jungle-palm-', 'junglePalms', 'jungle_palm', uniform(size), [0, a, 0], size);
  }
  return sites;
}

// --------------------------------------------------------------------------
async function scenery() {
  const { buildScenery } = await import('../client/world.js');
  const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  const palette = makePalette();
  return { palette, random, ...buildScenery(palette, random) };
}
// buildScenery is the expensive part of this file, so one pass feeds every test.
let cachedScenery = null;
async function recorded() {
  if (!cachedScenery) {
    const built = await scenery();
    cachedScenery = { built, sites: built.canopySites, fallback: built.canopyFallback, group: built.group, next: built.random() };
  }
  return cachedScenery;
}
let cachedKits = null;
async function kits() {
  if (!cachedKits) {
    cachedKits = {};
    for (const [key, file] of Object.entries(KIT_FILES)) {
      const bytes = await readFile(new URL('../client/assets/' + file + '/kit.glb', import.meta.url));
      const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
      gltf.scene.updateMatrixWorld(true);
      cachedKits[key] = gltf.scene;
    }
  }
  return cachedKits;
}
// Actual authored vertices of one root, in its own local frame.
const localCache = new Map();
async function localVertices(kitKey, name) {
  const key = kitKey + '|' + name;
  if (!localCache.has(key)) {
    const points = [], root = (await kits())[kitKey].getObjectByName(name);
    assert.ok(root, name + ' is exported by the ' + kitKey + ' kit');
    root.traverse(object => {
      if (!object.isMesh) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld));
    });
    localCache.set(key, points);
  }
  return localCache.get(key);
}
const sourceOf = prefab => ISLAND_CANOPY_SOURCES[prefab];
const slotsOf = prefab => SOURCE_SLOTS[sourceOf(prefab).source];

function kitScene(roots, slotMaterials, geometries, tag) {
  const scene = new THREE.Group();
  for (const [name, slots] of Object.entries(roots)) {
    const root = new THREE.Group(); root.name = name;
    slots.forEach((slot, index) => {
      const material = new THREE.MeshStandardMaterial(); material.name = slot;
      slotMaterials.set(tag + '|' + name + '|' + slot, material);
      // Each source primitive owns its geometry, so an installed batch that
      // rebuilt or substituted geometry instead of borrowing the resident one
      // fails the identity check below.
      const geometry = new THREE.BoxGeometry(.2, .5, .2); geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name + '-' + slot;
      // Every source primitive is offset, turned and squashed inside its root, so
      // an installed instance has to carry the source child matrix through the
      // descriptor transform rather than only the descriptor's own placement.
      mesh.position.set(.13 * (index + 1), .27 * (index + 1), -.09 * (index + 1));
      mesh.rotation.set(.11, .23 * (index + 1), -.07);
      mesh.scale.set(1 + .1 * index, .85, 1.2);
      root.add(mesh);
    });
    scene.add(root);
  }
  return { scene };
}
function fixtures() {
  const geometry = new THREE.BoxGeometry(.2, .5, .2), materials = new Map(), slotMaterials = new Map(), geometries = [];
  const shared = { scene: new THREE.Group() };
  const sources = new Set(Object.values(KIT_BINDINGS).flatMap(dictionary => Object.values(dictionary).map(binding => binding.source)));
  for (const name of sources) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const carrier = new THREE.Mesh(geometry, material); carrier.name = 'material-' + name; shared.scene.add(carrier);
  }
  const kit = kitScene(ISLAND_FIXTURE_SLOTS, slotMaterials, geometries, 'island');
  const canopyRoots = { jungle: {}, moon: {}, volcano: {} };
  for (const prefab of ISLAND_CANOPY_PREFABS) {
    const { kit: key, source } = sourceOf(prefab);
    if (key !== 'island') canopyRoots[key][source] = SOURCE_SLOTS[source];
  }
  const canopyKits = Object.fromEntries(Object.entries(canopyRoots).map(([key, roots]) => [key, kitScene(roots, slotMaterials, geometries, key)]));
  const byURL = { [SHARED_URL]: shared, [ISLAND_URL]: kit, [JUNGLE_URL]: canopyKits.jungle, [MOON_URL]: canopyKits.moon, [VOLCANO_URL]: canopyKits.volcano };
  return { shared, kit, canopyKits, byURL, geometry, geometries, materials, slotMaterials };
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
// Counts every material the kit clones out of a shared source, and every one of
// those clones that is later released.
function cloneProbe(fixture) {
  const tally = { cloned: 0, released: 0 };
  for (const material of fixture.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); tally.cloned++; copy.addEventListener('dispose', () => tally.released++); return copy; };
  }
  return tally;
}
function fallbackGroup(name) { const group = new THREE.Group(); group.name = name; return group; }
async function harness(load, assets) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette());
  const legacyScenery = fallbackGroup('island-coast-original-scenery');
  const landmarkFallback = fallbackGroup('island-shrines-original-scenery');
  const canopyFallback = fallbackGroup('island-canopy-original-scenery');
  scene.add(settlements.group, legacyScenery, landmarkFallback, canopyFallback);
  const built = await recorded();
  const palmSites = built.built.coastPalmSites, rockSites = built.built.coastRockSites;
  const landmarkSites = built.built.landmarkSites, canopySites = built.sites;
  return { scene, settlements, legacyScenery, landmarkFallback, canopyFallback, palmSites, rockSites, landmarkSites, canopySites,
    island: createIsland({ scene, settlements, legacyScenery, landmarkFallback, canopyFallback, load, assets, palmSites, rockSites, landmarkSites, canopySites }) };
}
function canopyMeshesOf(scene) {
  const meshes = [];
  scene.traverse(object => { if (object.isInstancedMesh && object.userData.canopyPrefab) meshes.push(object); });
  return meshes;
}
function cellsOf(sites, size) {
  const cells = new Map();
  for (const site of sites) {
    const key = Math.floor(site.x / size) + ':' + Math.floor(site.z / size);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(site);
  }
  return cells;
}
// The transform buildScenery recorded, composed independently of the runtime.
function siteMatrix(site) {
  return new THREE.Matrix4().compose(new THREE.Vector3(site.x, site.y, site.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(site.rotation[0], site.rotation[1], site.rotation[2])),
    new THREE.Vector3(site.scale[0], site.scale[1], site.scale[2]));
}
// instanceMatrix is a Float32Array, so a 120 m coordinate carries about 1e-5 m
// of rounding: the tolerance scales with the element it checks.
function assertMatrix(actual, expected, label) {
  for (let i = 0; i < 16; i++) {
    const tolerance = 1e-5 * Math.max(1, Math.abs(expected.elements[i]));
    assert.ok(Math.abs(actual.elements[i] - expected.elements[i]) <= tolerance,
      label + ' element ' + i + ': ' + actual.elements[i] + ' vs ' + expected.elements[i]);
  }
}
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
const rgb = color => color.toArray().map(value => Number(value.toFixed(6)));

test('buildScenery records one canopy descriptor per wild jungle, moon and volcanic draw', async () => {
  const built = await recorded(), derived = derivedCanopySites();
  // The independent replay agrees on every id, kind, region, prefab, position,
  // rotation, scale and source dimension, for all of them at once.
  assert.equal(derived.length, 118, 'the independent replay finds the shipped inventory');
  assert.deepEqual(built.sites, derived, 'every captured descriptor matches the independently replayed draw');
  assert.equal(built.sites.length, ISLAND_CANOPY_TOTAL); assert.equal(ISLAND_CANOPY_TOTAL, 118);
  assert.equal(new Set(built.sites.map(site => site.id)).size, 118, 'every descriptor has its own stable id');
  const counts = {};
  for (const site of built.sites) counts[site.kind] = (counts[site.kind] ?? 0) + 1;
  assert.deepEqual(counts, ISLAND_CANOPY_COUNTS);
  assert.deepEqual(ISLAND_CANOPY_COUNTS, { jungleTrees: 23, junglePalms: 11, jungleRocks: 1, moonTrees: 11,
    moonMushrooms: 21, volcanoRocks: 6, volcanoPebbles: 34, volcanoCrystals: 11 });
  assert.equal(built.sites.filter(site => site.collidable).length, 18, 'eighteen of them replace a shared collider');
  // The routing only moves draws between batches: the RNG stream is untouched.
  assert.equal(built.next, .017430383479222655);
  for (const site of built.sites) {
    assert.ok(ISLAND_CANOPY_PREFABS.includes(site.prefab), site.id + ' names a canopy root');
    assert.ok(ISLAND_CANOPY_REGIONS.includes(site.region), site.id + ' names a canopy region');
    assert.equal(isCanopyRegion(site.region), true, site.id);
    assert.equal(regionAt(site.x, site.z)?.id, site.region, site.id + ' stands in the region it records');
    assert.equal(site.rotation.length, 3); assert.equal(site.scale.length, 3);
    for (const value of [site.x, site.y, site.z, ...site.rotation, ...site.scale]) assert.ok(Number.isFinite(value), site.id);
    for (const value of site.scale) assert.ok(value > 0, site.id + ' scale');
    // Complete transforms only: the descriptor carries the ground the original
    // draw used, never a runtime resample of a different terrain function.
    assert.equal(site.y, heightAt(site.x, site.z), site.id + ' keeps the captured ground height');
    assert.equal(site.collidable, ISLAND_CANOPY_OBSTACLES.some(obstacle => obstacle.id === site.id), site.id + ' collidable flag');
  }
  // One fallback mesh, one parent, still lit and shadowing until the kit lands.
  assert.equal(built.fallback.name, 'island-canopy-original-scenery');
  assert.equal(built.fallback.isMesh, true, 'the wild canopy comes back as one restorable batch');
  assert.equal(built.fallback.parent, built.group); assert.equal(built.fallback.visible, true);
  assert.equal(built.fallback.castShadow, true); assert.equal(built.fallback.receiveShadow, true);
  assert.ok(built.fallback.geometry.attributes.position.count > 0);
  assert.equal(built.group.getObjectByName('island-canopy-original-scenery'), built.fallback);
  assert.equal(built.group.userData.canopySites, built.sites);
  assert.equal(built.group.userData.canopyFallback, built.fallback);
  let parents = 0, lights = 0;
  built.group.traverse(object => {
    if (object === built.fallback) parents++;
    if (object.isLight) lights++;
  });
  assert.equal(parents, 1, 'the wild canopy batch is never drawn twice');
  assert.equal(lights, 0, 'the canopy slice adds no scene light');
  // The coast and shrine slices are untouched: their batches, sites and counts
  // are exactly what they shipped.
  assert.equal(built.built.coastPalmSites.length, 38); assert.equal(built.built.coastRockSites.length, 4);
  assert.equal(built.built.landmarkSites.length, ISLAND_LANDMARK_TOTAL); assert.equal(built.built.landmarkSites.length, 50);
  assert.equal(built.built.coastLegacyScenery.name, 'island-coast-original-scenery');
  assert.equal(built.built.landmarkFallback.name, 'island-shrines-original-scenery');
  assert.equal(built.built.coastLegacyScenery.visible, true); assert.equal(built.built.landmarkFallback.visible, true);
  // Every recorded site has original geometry standing over it, and the batch
  // carries nothing else. The bound is each original draw's own horizontal
  // reach, read off the model helpers: a broad tree spans a 1.8 branch offset
  // plus a 2.8 crown, a palm its 3.76 fronds on a 1.25 lean, a mushroom its 1.65
  // cap on a .15 offset, a lump its 1.3 half-extent, a shard its tilted spike
  // and a collidable rock its own radius. Measured worst case is .99 of these.
  const drawSize = site => site.collidable ? Math.max(.7, Math.min(1.5, (site.height || 7) / 7)) : site.size;
  const reachOf = site => {
    if (site.kind === 'jungleTrees' || site.kind === 'moonTrees') return 4.6 * drawSize(site);
    if (site.kind === 'junglePalms') return 5.05 * site.size;
    if (site.kind === 'moonMushrooms') return 1.85 * site.size;
    if (site.kind === 'volcanoPebbles') return 1.35 * site.size;
    if (site.kind === 'volcanoCrystals') return 1.15 * site.size;
    return site.radius * 1.02;
  };
  const reach = built.sites.map(site => ({ site, radius: reachOf(site) }));
  const positions = built.fallback.geometry.attributes.position;
  const hits = new Map(built.sites.map(site => [site.id, 0]));
  let strays = 0;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), z = positions.getZ(index);
    let covered = false;
    for (const { site, radius } of reach) {
      if (Math.hypot(x - site.x, z - site.z) > radius) continue;
      covered = true; hits.set(site.id, hits.get(site.id) + 1);
    }
    if (!covered) strays++;
  }
  for (const [id, count] of hits) assert.ok(count > 0, id + ' has original geometry standing on it');
  assert.equal(strays, 0, 'nothing but the recorded wild draws is routed into the canopy fallback');
});

test('the canopy membership and dressings restore the colliders they hide, measured on the resident vertices', async () => {
  assert.deepEqual(ISLAND_CANOPY_REGIONS, ['jungle', 'moon', 'volcano']);
  for (const region of ISLAND_CANOPY_REGIONS) assert.equal(isCanopyRegion(region), true, region);
  for (const region of ['beach', 'haven', 'plains', undefined, null]) assert.equal(isCanopyRegion(region), false, String(region));
  for (const list of [ISLAND_CANOPY_REGIONS, ISLAND_CANOPY_OBSTACLES, ISLAND_JUNGLE_TREE_OBSTACLES, ISLAND_JUNGLE_ROCK_OBSTACLES,
    ISLAND_MOON_TREE_OBSTACLES, ISLAND_VOLCANO_ROCK_OBSTACLES, ISLAND_CANOPY_NOMINALS, ISLAND_CANOPY_COUNTS]) assert.ok(Object.isFrozen(list));
  // Membership is the original routing read backwards; the four area-owned props
  // stay with the kits that already dress them.
  assert.deepEqual(ISLAND_JUNGLE_TREE_OBSTACLES.map(obstacle => obstacle.id), ['prop-7', 'prop-8', 'prop-10', 'prop-11', 'prop-13', 'prop-14']);
  assert.deepEqual(ISLAND_JUNGLE_ROCK_OBSTACLES.map(obstacle => obstacle.id), ['prop-12']);
  assert.deepEqual(ISLAND_MOON_TREE_OBSTACLES.map(obstacle => obstacle.id), ['prop-27', 'prop-29', 'prop-30', 'prop-31', 'prop-32']);
  assert.deepEqual(ISLAND_VOLCANO_ROCK_OBSTACLES.map(obstacle => obstacle.id), ['prop-20', 'prop-21', 'prop-22', 'prop-24', 'prop-25', 'prop-26']);
  assert.equal(ISLAND_CANOPY_OBSTACLES.length, 18);
  for (const id of ['prop-9', 'prop-28', 'prop-33', 'prop-23']) {
    assert.equal(ISLAND_CANOPY_OBSTACLES.some(obstacle => obstacle.id === id), false, id + ' belongs to a finished area');
  }
  for (const obstacle of OBSTACLES) {
    // buildScenery skips the beacon, every footprint and the Old Watch pilot
    // props before it draws anything, so they are never the canopy's either.
    if (obstacle.type === 'landmark' || obstacle.type === 'building' || obstacle.pilot === 'old-watch') {
      assert.equal(ISLAND_CANOPY_OBSTACLES.includes(obstacle), false, obstacle.id + ' is never drawn by the scenery pass');
      continue;
    }
    if (obstacle.type !== 'tree' || !isCanopyRegion(regionAt(obstacle.x, obstacle.z)?.id)) continue;
    const owned = regionAt(obstacle.x, obstacle.z).id === 'moon' ? moonwatchWeight(obstacle.x, obstacle.z) > 0 : palmheartWeight(obstacle.x, obstacle.z) > 0;
    assert.equal(ISLAND_CANOPY_OBSTACLES.includes(obstacle), !owned, obstacle.id + ' is not left behind');
  }
  // Every nominal rounds the actual measured extent up, so a body dressed by it
  // never overshoots the collider it stands in.
  assert.deepEqual(Object.keys(ISLAND_CANOPY_NOMINALS).sort(), [...ISLAND_CANOPY_PREFABS].sort(), 'every canopy root records a nominal');
  for (const prefab of ISLAND_CANOPY_PREFABS) {
    const nominal = ISLAND_CANOPY_NOMINALS[prefab], [reach, top] = MEASURED_EXTENTS[prefab];
    const points = await localVertices(sourceOf(prefab).kit, sourceOf(prefab).source);
    const measuredReach = Math.max(...points.map(point => Math.hypot(point.x, point.z)));
    const measuredTop = Math.max(...points.map(point => point.y));
    near(measuredReach, reach, .001, prefab + ' measured reach'); near(measuredTop, top, .001, prefab + ' measured top');
    assert.ok(nominal.radius >= measuredReach - 1e-9, prefab + ' nominal radius ' + nominal.radius + ' covers ' + measuredReach);
    assert.ok(nominal.height >= measuredTop - 1e-9, prefab + ' nominal height ' + nominal.height + ' covers ' + measuredTop);
  }
  // The three collider divisors are the ones Palmheart, Moonwatch and
  // Cinderworks already publish for their own collidable trees and columns, so a
  // wild tree and a camp tree of the same size install at the same scale; the
  // alias divides by coast_rock_b's own nominal.
  assert.deepEqual({ ...ISLAND_CANOPY_NOMINALS.jungle_tree_b }, { radius: 3.8, height: 11 });
  assert.deepEqual({ ...ISLAND_CANOPY_NOMINALS.silver_tree_b }, { radius: 3.8, height: 11 });
  assert.deepEqual({ ...ISLAND_CANOPY_NOMINALS.basalt_outcrop }, { radius: 3, height: 8 });
  assert.deepEqual({ ...ISLAND_CANOPY_NOMINALS.jungle_rock }, { radius: 2, height: 3 });
  assert.equal(CANOPY_PEBBLE_REACH, 1.15); assert.equal(CANOPY_CRYSTAL_HEIGHT, 3);
  // Each collidable dressing, checked against the actual scaled vertices of the
  // root it installs: the whole authored body stays inside the shared collider
  // radius and never rises above the recorded height.
  const byId = new Map((await recorded()).sites.map(site => [site.id, site]));
  for (const obstacle of ISLAND_CANOPY_OBSTACLES) {
    const site = byId.get(obstacle.id); assert.ok(site, obstacle.id + ' is captured');
    const region = regionAt(obstacle.x, obstacle.z).id;
    const dressing = obstacle.type === 'tree' ? canopyTreeDressing(obstacle, region) : canopyRockDressing(obstacle, region);
    assert.equal(dressing.id, obstacle.id); assert.equal(dressing.prefab, site.prefab); assert.deepEqual(dressing.scale, site.scale);
    assert.equal(site.radius, obstacle.radius, obstacle.id + ' keeps its collider radius');
    assert.equal(site.height, obstacle.height, obstacle.id + ' keeps its collider height');
    const nominal = ISLAND_CANOPY_NOMINALS[site.prefab];
    near(nominal.radius * site.scale[0], obstacle.radius, 1e-9, obstacle.id + ' radius restores from the nominal');
    near(nominal.height * site.scale[1], obstacle.height, 1e-9, obstacle.id + ' height restores from the nominal');
    assert.equal(site.scale[0], site.scale[2], obstacle.id + ' stays round in plan');
    assert.deepEqual([site.rotation[0], site.rotation[2]], [0, 0], obstacle.id + ' stands upright on its recorded ground');
    const points = await localVertices(sourceOf(site.prefab).kit, sourceOf(site.prefab).source);
    let reach = 0, top = -Infinity;
    for (const point of points) {
      reach = Math.max(reach, Math.hypot(point.x * site.scale[0], point.z * site.scale[2]));
      top = Math.max(top, point.y * site.scale[1]);
    }
    assert.ok(reach <= obstacle.radius + 1e-6, obstacle.id + ' body reaches ' + reach.toFixed(4) + ' inside its ' + obstacle.radius + ' m collider');
    assert.ok(top <= obstacle.height + 1e-6, obstacle.id + ' stands ' + top.toFixed(4) + ' under its ' + obstacle.height + ' m collider');
  }
  // The collidables never alternate: one silhouette per kind, as the camps use.
  assert.deepEqual([...new Set(ISLAND_JUNGLE_TREE_OBSTACLES.map(o => byId.get(o.id).prefab))], ['jungle_tree_b']);
  assert.deepEqual([...new Set(ISLAND_MOON_TREE_OBSTACLES.map(o => byId.get(o.id).prefab))], ['silver_tree_b']);
  assert.deepEqual([...new Set(ISLAND_VOLCANO_ROCK_OBSTACLES.map(o => byId.get(o.id).prefab))], ['basalt_outcrop']);
  assert.equal(byId.get('prop-12').prefab, 'jungle_rock');
  assert.deepEqual(byId.get('prop-12').scale, [1.5, 4 / 3, 1.5], 'the jungle boulder keeps the contract dressing');
  // Every decorative dressing is index arithmetic over the original draw size:
  // a lump fitted to the original mean reach, a shard to the original spike, and
  // a plain uniform size everywhere else. Nothing here consumes a random.
  for (const site of byId.values()) {
    if (site.collidable) continue;
    const index = Number(site.id.slice(site.id.lastIndexOf('-') + 1));
    assert.ok(Number.isInteger(index) && index >= 0 && index < 245, site.id + ' is keyed by its original loop index');
    const dressing = canopyPlantDressing(site.region, index, site.size);
    assert.equal(dressing.id, site.id); assert.equal(dressing.kind, site.kind); assert.equal(dressing.prefab, site.prefab);
    assert.deepEqual(dressing.scale, site.scale, site.id + ' dressing is reproducible from region, index and size');
    assert.equal(site.scale[0], site.scale[1]); assert.equal(site.scale[1], site.scale[2], site.id + ' dresses uniformly');
    const nominal = ISLAND_CANOPY_NOMINALS[site.prefab];
    if (site.kind === 'volcanoPebbles') {
      near(nominal.radius * site.scale[0], CANOPY_PEBBLE_REACH * site.size, 1e-12, site.id + ' matches the original lump reach');
      assert.equal(site.prefab, index % 2 ? 'basalt_boulder_b' : 'basalt_boulder_a', site.id + ' follows the original two-tone split');
      assert.deepEqual([site.rotation[0], site.rotation[2]], [.3, .1], site.id + ' keeps the original lump lean');
    } else if (site.kind === 'volcanoCrystals') {
      near(nominal.height * site.scale[1], CANOPY_CRYSTAL_HEIGHT * site.size, 1e-12, site.id + ' matches the original tallest shard');
      assert.deepEqual([site.rotation[0], site.rotation[2]], [0, 0], site.id + ' only ever turned on its yaw');
    } else {
      assert.deepEqual(site.scale, [site.size, site.size, site.size], site.id + ' takes the original draw size');
      assert.deepEqual([site.rotation[0], site.rotation[2]], [0, 0], site.id);
    }
    assert.ok(site.rotation[1] >= 0 && site.rotation[1] < TAU, site.id + ' yaw ' + site.rotation[1]);
    assert.ok(site.size > 0, site.id + ' size');
  }
  // Both alternating decorative kinds actually alternate in the shipped capture,
  // so the a/b split is exercised rather than merely coded.
  for (const [kind, variants] of [['jungleTrees', ['jungle_tree_a', 'jungle_tree_b']], ['moonTrees', ['silver_tree_a', 'silver_tree_b']],
    ['volcanoPebbles', ['basalt_boulder_a', 'basalt_boulder_b']]]) {
    const used = new Set([...byId.values()].filter(site => site.kind === kind && !site.collidable).map(site => site.prefab));
    assert.deepEqual([...used].sort(), variants, kind + ' uses both authored variants');
  }
});

test('the canopy borrows the published area roots and their palette bindings, and stays distinct from the coast', async () => {
  assert.deepEqual(ISLAND_CANOPY_KIT_URLS, { jungle: JUNGLE_URL, moon: MOON_URL, volcano: VOLCANO_URL });
  assert.deepEqual([...ISLAND_CANOPY_PREFABS], ['jungle_tree_a', 'jungle_tree_b', 'jungle_palm', 'jungle_rock',
    'silver_tree_a', 'silver_tree_b', 'moon_mushroom', 'basalt_outcrop', 'basalt_boulder_a', 'basalt_boulder_b', 'ember_crystal']);
  assert.deepEqual(Object.keys(ISLAND_CANOPY_SOURCES).sort(), [...ISLAND_CANOPY_PREFABS].sort());
  assert.equal(ISLAND_PREFABS.length, 17, 'the canopy authors no new island root');
  assert.equal(ISLAND_CANOPY_PREFABS.includes('cinder_clump'), false, 'no cinder clump in this slice');
  const loaded = await kits();
  for (const prefab of ISLAND_CANOPY_PREFABS) {
    const { kit: key, source, cell } = sourceOf(prefab);
    assert.ok(KIT_FILES[key], prefab + ' names a resident kit');
    const root = loaded[key].getObjectByName(source);
    assert.ok(root, prefab + ' borrows ' + source + ' from the ' + key + ' kit');
    const slots = [];
    root.traverse(object => { if (object.isMesh) slots.push(object.material.name); });
    assert.deepEqual(slots.sort(), [...SOURCE_SLOTS[source]].sort(), prefab + ' keeps its shipped primitives');
    // Only 64 m tree cells and the 32 m detail cell the contract allows.
    const detail = ['basalt_boulder_a', 'basalt_boulder_b', 'ember_crystal'].includes(prefab);
    assert.equal(cell, detail ? ROCK_DETAIL_CELL : TREE_CELL, prefab + ' cell size');
    // Every slot the borrowed root uses is bound by its own kit's published
    // dictionary, so nothing here invents a binding.
    for (const slot of SOURCE_SLOTS[source]) {
      const remapped = sourceOf(prefab).slots?.[slot] ?? slot;
      const binding = KIT_BINDINGS[remapped === slot ? key : 'island'][remapped];
      assert.ok(binding, prefab + ' slot ' + slot + ' resolves to a published binding');
    }
  }
  // The palette card, read off the published dictionaries the canopy reuses.
  for (const slot of ['jungle_bark', 'jungle_hardwood', 'broad_leaf', 'palm_frond']) assert.ok(PALMHEART_MATERIAL_BINDINGS[slot], slot);
  for (const slot of ['silver_bark', 'lavender_leaf', 'mushroom_stem', 'mushroom_cap', 'moon_glass']) assert.ok(MOONWATCH_MATERIAL_BINDINGS[slot], slot);
  for (const slot of ['basalt_block', 'scoria', 'ember_crystal']) assert.ok(CINDERWORKS_MATERIAL_BINDINGS[slot], slot);
  // A dark leafy jungle canopy must stay clearly darker than the bright coast
  // frond it stands behind, on every channel.
  const leaf = PALMHEART_MATERIAL_BINDINGS.broad_leaf.color, frond = ISLAND_MATERIAL_BINDINGS.coast_frond.color;
  for (const channel of [0, 1, 2]) assert.ok(leaf[channel] < frond[channel] * .5, 'the jungle leaf tint stays well under the coast frond on channel ' + channel);
  // prop-12 is dressed in the island's own olive-jade gateway stone, never pale
  // surf limestone and never a lunar or volcanic slot.
  assert.deepEqual(sourceOf('jungle_rock'), { kit: 'island', source: 'coast_rock_b', cell: TREE_CELL, slots: { coast_stone: 'jungle_gate_stone' } });
  assert.notDeepEqual(ISLAND_MATERIAL_BINDINGS.jungle_gate_stone.color, ISLAND_MATERIAL_BINDINGS.coast_stone.color);
  // The shipped island dictionary is untouched by the alias.
  const manifest = JSON.parse(await readFile(new URL('../client/assets/island/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.materialBindings, ISLAND_MATERIAL_BINDINGS, 'the canopy adds no island binding');
});

test('the canopy installs on every recorded transform, batched per cell, sharing one clone per slot', async () => {
  const fixture = fixtures();
  const live = await harness(async url => fixture.byURL[url]);
  assert.equal(live.canopyFallback.visible, true, 'the wild canopy carries the island until the whole kit lands');
  assert.equal(await live.island.ready, true);
  assert.equal(live.legacyScenery.visible, false); assert.equal(live.landmarkFallback.visible, false);
  assert.equal(live.canopyFallback.visible, false, 'the originals only step aside once every kit is installed');
  const group = live.scene.getObjectByName('island-coast-environment'); assert.ok(group);
  let lights = 0; live.scene.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'the canopy adds no scene light');
  const meshes = canopyMeshesOf(live.scene);
  const matrix = new THREE.Matrix4(), expected = new THREE.Matrix4(), checked = new Set();
  let installed = 0;
  for (const prefab of ISLAND_CANOPY_PREFABS) {
    const own = live.canopySites.filter(site => site.prefab === prefab);
    assert.ok(own.length, prefab + ' has recorded sites');
    const { kit: key, source, cell } = sourceOf(prefab), slots = slotsOf(prefab);
    const cells = cellsOf(own, cell), mine = meshes.filter(mesh => mesh.userData.canopyPrefab === prefab);
    assert.equal(mine.length, slots.length * cells.size, prefab + ' batches one mesh per source primitive per cell');
    installed += mine.length;
    const kitScene = key === 'island' ? fixture.kit.scene : fixture.canopyKits[key].scene;
    for (const [cellKey, cellSites] of cells) {
      for (const slot of slots) {
        const remapped = sourceOf(prefab).slots?.[slot] ?? slot;
        const mesh = mine.find(candidate => candidate.name === 'island-canopy-' + prefab + '-' + cellKey && candidate.material.name === remapped);
        assert.ok(mesh, prefab + ' ' + slot + ' cell ' + cellKey);
        assert.equal(mesh.count, cellSites.length, prefab + ' cell ' + cellKey + ' count');
        assert.equal(mesh.userData.fullCount, cellSites.length);
        assert.equal(mesh.userData.canopyCellSize, cell); assert.ok(mesh.userData.cellCenter);
        assert.equal(mesh.castShadow, true, prefab + ' casts a shadow'); assert.equal(mesh.receiveShadow, true);
        assert.ok(mesh.boundingSphere && mesh.boundingSphere.radius > 0, mesh.name + ' computes its bounds');
        // The bound geometry is the resident kit's own, borrowed by identity.
        const sourceMesh = kitScene.getObjectByName(source).getObjectByName(source + '-' + slot);
        sourceMesh.updateMatrixWorld(true);
        assert.equal(mesh.geometry, sourceMesh.geometry, prefab + ' ' + slot + ' borrows the resident geometry');
        cellSites.forEach((site, index) => {
          mesh.getMatrixAt(index, matrix);
          expected.multiplyMatrices(siteMatrix(site), sourceMesh.matrix);
          assertMatrix(matrix, expected, site.id + ' ' + slot); checked.add(site.id);
        });
      }
    }
  }
  assert.deepEqual([...checked].sort(), live.canopySites.map(site => site.id).sort(), 'every recorded transform is compared as a whole matrix');
  assert.equal(checked.size, 118);
  for (const mesh of meshes) assert.match(mesh.name, /^island-canopy-[a-z_]+--?\d+:-?\d+$/);
  // Each slot of each kit is cloned once and shared by every root and cell that
  // uses it; nothing borrows an area's own bound clone or edits a kit original.
  const bySlot = new Map();
  for (const mesh of meshes) {
    const key = sourceOf(mesh.userData.canopyPrefab).kit + '|' + mesh.material.name;
    if (!bySlot.has(key)) bySlot.set(key, new Set());
    bySlot.get(key).add(mesh.material);
  }
  for (const [key, materials] of bySlot) assert.equal(materials.size, 1, key + ' is bound once and shared by every repeat');
  const kitOriginals = new Set(fixture.slotMaterials.values()), sharedOriginals = new Set(fixture.materials.values());
  for (const [key, materials] of bySlot) {
    const [material] = [...materials];
    assert.equal(kitOriginals.has(material), false, key + ' is not the kit original');
    assert.equal(sharedOriginals.has(material), false, key + ' is not the shared source itself');
    const [kitKey, slot] = key.split('|');
    const binding = KIT_BINDINGS[slot === 'jungle_gate_stone' ? 'island' : kitKey][slot];
    assert.ok(binding, key + ' has a published binding');
    // A white shared source times the published tint is the published tint.
    if (binding.color) assert.deepEqual(rgb(material.color), binding.color.map(value => Number(value.toFixed(6))), key + ' tint');
    if (binding.normalScale != null) assert.equal(material.normalScale.x, binding.normalScale, key + ' normal scale');
    if (binding.emissive) assert.deepEqual(rgb(material.emissive), binding.emissive.map(value => Number(value.toFixed(6))), key + ' emissive');
    assert.equal(material.side, binding.doubleSided ? THREE.DoubleSide : THREE.FrontSide, key + ' sidedness');
    assert.equal(material.vertexColors, true, key + ' keeps the vertex tint');
  }
  for (const material of kitOriginals) {
    assert.equal(material.color.getHex(), 0xffffff, material.name + ' kit original keeps its albedo');
    assert.equal(material.emissive.getHex(), 0x000000, material.name + ' kit original keeps its emissive');
    assert.equal(material.side, THREE.FrontSide, material.name + ' kit original keeps its sidedness');
  }
  for (const material of sharedOriginals) {
    assert.equal(material.color.getHex(), 0xffffff, material.name + ' shared source keeps its albedo');
    assert.equal(material.normalScale.x, 1, material.name + ' shared source keeps its normal scale');
  }
  // The alias dresses coast_rock_b's geometry in its own jungle stone: a clone
  // distinct from both the coast rocks' and the gateway landmarks' bindings.
  const rock = meshes.find(mesh => mesh.userData.canopyPrefab === 'jungle_rock');
  assert.ok(rock); assert.equal(rock.material.name, 'jungle_gate_stone');
  const coastRock = live.scene.getObjectByName('island-coast-rock-prop-1');
  let coastStone = null; coastRock.traverse(object => { if (object.isMesh) coastStone = object.material; });
  assert.notEqual(rock.material, coastStone, 'the alias never shares the surf limestone clone');
  assert.equal(coastStone.name, 'coast_stone');
  let gateStone = null;
  group.traverse(object => { if (object.isMesh && object.material.name === 'jungle_gate_stone' && object !== rock) gateStone = object.material; });
  assert.ok(gateStone, 'the gateway landmarks bind the same slot name');
  assert.notEqual(rock.material, gateStone, 'the alias owns its own clone rather than the gateway landmark binding');
  // Stats: the existing keys are preserved and the canopy adds its own.
  const stats = live.island.getStats();
  assert.deepEqual(Object.keys(stats), ['status', 'ready', 'loading', 'fallback', 'error', 'windValue',
    'prefabs', 'palms', 'collidablePalms', 'rocks', 'skiffs', 'canopyMeshes', 'cellSize',
    'landmarks', 'landmarkMeshes', 'landmarkCounts', 'landmarkCellSize',
    'canopyPlacements', 'canopyCounts', 'wildCanopyMeshes', 'canopyCellSize', 'rockDetailCellSize', 'visibleDetailMeshes']);
  assert.equal(stats.status, 'ready'); assert.equal(stats.canopyPlacements, 118);
  assert.equal(stats.canopyPlacements, live.canopySites.length);
  assert.deepEqual(stats.canopyCounts, ISLAND_CANOPY_COUNTS);
  assert.equal(stats.wildCanopyMeshes, installed, 'the stats count the canopy meshes actually installed');
  assert.equal(stats.canopyCellSize, TREE_CELL); assert.equal(stats.rockDetailCellSize, ROCK_DETAIL_CELL);
  assert.equal(stats.palms, 38); assert.equal(stats.rocks, 4); assert.equal(stats.skiffs, 2);
  assert.equal(stats.landmarks, ISLAND_LANDMARK_TOTAL); assert.equal(stats.visibleDetailMeshes, 0);
  assert.equal(stats.prefabs, ISLAND_PREFABS.length);
  live.island.dispose();
  assert.equal(live.canopyFallback.visible, true, 'disposal brings the wild canopy back');
  assert.equal(canopyMeshesOf(live.scene).length, 0);
});

test('a focused island build without canopy sites keeps the shipped two-lease shape', async () => {
  const fixture = fixtures(), loads = [];
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette());
  const built = await recorded();
  const island = createIsland({ scene, settlements, palmSites: built.built.coastPalmSites, rockSites: built.built.coastRockSites,
    landmarkSites: built.built.landmarkSites, load: async url => { loads.push(url); return fixture.byURL[url]; } });
  assert.equal(await island.ready, true);
  assert.deepEqual(loads, [SHARED_URL, ISLAND_URL], 'no canopy sites means no canopy lease');
  const stats = island.getStats();
  assert.deepEqual(Object.keys(stats), ['status', 'ready', 'loading', 'fallback', 'error', 'windValue',
    'prefabs', 'palms', 'collidablePalms', 'rocks', 'skiffs', 'canopyMeshes', 'cellSize',
    'landmarks', 'landmarkMeshes', 'landmarkCounts', 'landmarkCellSize', 'visibleDetailMeshes'],
    'the pre-canopy stats shape is unchanged for focused callers');
  assert.equal(canopyMeshesOf(scene).length, 0);
  island.dispose();
});

test('the wild canopy never thins, hides or sways its rigid slots at low quality or long range', async () => {
  const fixture = fixtures();
  const live = await harness(async url => fixture.byURL[url]);
  assert.equal(await live.island.ready, true);
  const meshes = canopyMeshesOf(live.scene);
  assert.ok(meshes.length > 0);
  const before = meshes.map(mesh => { const copy = new THREE.Matrix4(); mesh.getMatrixAt(0, copy); return copy; });
  live.island.animate(20, {});
  assert.equal(live.island.getStats().windValue, 16, 'the leaves sway while animated');
  // Only the three leaf slots the contract names move, on the island's single
  // wind uniform; bark, stone and crystal keep a rigid silhouette.
  const uniforms = new Map();
  for (const mesh of meshes) {
    if (uniforms.has(mesh.material)) continue;
    const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' };
    mesh.material.onBeforeCompile?.(shader);
    uniforms.set(mesh.material, shader);
  }
  const swaying = new Set(), rigid = new Set();
  for (const [material, shader] of uniforms) (shader.uniforms.islandWind ? swaying : rigid).add(material.name);
  assert.deepEqual([...swaying].sort(), ['broad_leaf', 'lavender_leaf', 'palm_frond'], 'only leaf slots sway');
  for (const slot of ['jungle_bark', 'jungle_hardwood', 'silver_bark', 'mushroom_stem', 'mushroom_cap', 'basalt_block', 'scoria', 'ember_crystal', 'jungle_gate_stone']) {
    assert.ok(rigid.has(slot), slot + ' stays rigid');
  }
  for (const [material, shader] of uniforms) {
    if (!shader.uniforms.islandWind) continue;
    assert.equal(shader.uniforms.islandWind.value, 16, material.name + ' reads the shared island wind');
    assert.ok(shader.vertexShader.includes('islandWind'), material.name + ' hook');
  }
  // The same single uniform drives the coast fronds, so the island sways as one.
  let coastFrond = null;
  live.scene.traverse(object => { if (object.isInstancedMesh && object.userData.detailKind === 'palm' && object.material.name === 'coast_frond') coastFrond = object.material; });
  assert.ok(coastFrond);
  const coastShader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; coastFrond.onBeforeCompile(coastShader);
  const [leafShader] = [...uniforms.values()].filter(shader => shader.uniforms.islandWind);
  assert.equal(coastShader.uniforms.islandWind, leafShader.uniforms.islandWind, 'one island wind uniform, not one per kit');
  // The wild skyline is read from every approach and from the air, so nothing is
  // thinned, distance-hidden or moved at low quality or reduced motion.
  live.island.animate(30, { player: { x: -420, z: -420 }, lowQuality: true, reducedMotion: true });
  assert.equal(live.island.getStats().windValue, 0, 'reduced motion parks the wind');
  meshes.forEach((mesh, index) => {
    assert.equal(mesh.visible, true, mesh.name + ' is never distance-hidden');
    assert.equal(mesh.count, mesh.userData.fullCount, mesh.name + ' is never thinned');
    const now = new THREE.Matrix4(); mesh.getMatrixAt(0, now);
    assert.deepEqual([...now.elements], [...before[index].elements], mesh.name + ' is static');
  });
  assert.equal(live.island.getStats().visibleDetailMeshes, 0, 'this slice adds no thinned ground detail');
  live.island.dispose();
});

test('a malformed canopy kit, site or binding fails before anything is installed and releases every clone', async () => {
  const built = await recorded();
  const base = { palmSites: built.built.coastPalmSites, rockSites: built.built.coastRockSites,
    landmarkSites: built.built.landmarkSites, canopySites: built.sites };
  const build = (fixture, options = {}) => buildIslandKit(fixture.kit, fixture.shared,
    { ...base, canopyKits: fixture.canopyKits, ...options });
  // A descriptor naming a root outside the mapping, and one with a broken
  // transform, are both refused rather than installed half-dressed.
  const stray = fixtures();
  assert.throws(() => build(stray, { canopySites: [...built.sites, { ...built.sites[0], id: 'stray', prefab: 'jungle_tree_c' }] }),
    /Island canopy prefab is missing: jungle_tree_c/);
  const broken = fixtures();
  assert.throws(() => build(broken, { canopySites: [...built.sites, { ...built.sites[0], id: 'bent', rotation: [0, Number.NaN, 0] }] }),
    /Island canopy site is malformed: bent/);
  const short = fixtures();
  assert.throws(() => build(short, { canopySites: [...built.sites, { ...built.sites[0], id: 'flat', scale: [1, 1] }] }),
    /Island canopy site is malformed: flat/);
  // Each of the three borrowed kits is required whole.
  for (const key of ['jungle', 'moon', 'volcano']) {
    const absent = fixtures();
    assert.throws(() => build(absent, { canopyKits: { ...absent.canopyKits, [key]: undefined } }),
      new RegExp('Island canopy kit is missing: ' + key));
  }
  const hollow = fixtures();
  hollow.canopyKits.moon.scene.getObjectByName('silver_tree_a').clear();
  assert.throws(() => build(hollow), /Island canopy kit is missing or empty: silver_tree_a/);
  const noRock = fixtures();
  noRock.kit.scene.getObjectByName('coast_rock_b').clear();
  // The alias reports the canopy name it installs, not the borrowed root.
  assert.throws(() => build(noRock), /missing or empty: (jungle_rock|coast_rock_b)/);
  // Every shared source the canopy leans on is one an island slot already needs,
  // so a missing library material is caught by the island's own validation first
  // and nothing canopy-side is ever staged against a half-loaded library.
  const unbound = fixtures();
  unbound.shared.scene.remove(unbound.shared.scene.getObjectByName('material-needle_foliage'));
  assert.throws(() => build(unbound), /Island material binding is missing: coast_frond/);
  const strangeSlot = fixtures();
  strangeSlot.canopyKits.volcano.scene.getObjectByName('ember_crystal').children[0].material.name = 'external_texture';
  assert.throws(() => build(strangeSlot), /Island canopy material binding is missing: external_texture/);
  // A failure part-way through staging releases every material it had cloned and
  // leaves the borrowed kit and shared sources untouched.
  const staged = fixtures(), counts = disposalProbe(staged), tally = cloneProbe(staged);
  staged.canopyKits.volcano.scene.getObjectByName('basalt_outcrop').clone = () => { throw new Error('canopy staging interrupted'); };
  assert.throws(() => build(staged), /canopy staging interrupted/);
  assert.ok(tally.cloned > 0); assert.equal(tally.released, tally.cloned, 'every clone made before the failure is released');
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 }, 'the borrowed sources are left alone');
  disposeOwnedResources([staged.kit.scene, staged.shared.scene, ...Object.values(staged.canopyKits).map(kit => kit.scene)]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('any of the five kit URLs failing leaves the coast, shrine and canopy originals standing', async () => {
  for (const failing of KIT_URLS) {
    const fixture = fixtures();
    const cache = createEnvironmentAssets({ load: async url => { if (url === failing) throw new Error('kit offline: ' + url); return fixture.byURL[url]; } });
    const live = await harness(undefined, cache);
    assert.equal(await live.island.ready, false, failing + ' fails the install');
    const stats = live.island.getStats();
    assert.equal(stats.status, 'fallback'); assert.equal(stats.ready, false); assert.equal(stats.fallback, true);
    assert.match(stats.error, new RegExp('kit offline: ' + failing));
    assert.equal(stats.windValue, 0);
    assert.equal(live.legacyScenery.visible, true, failing + ' keeps the coast batch lit');
    assert.equal(live.landmarkFallback.visible, true, failing + ' keeps the shrine batches lit');
    assert.equal(live.canopyFallback.visible, true, failing + ' keeps the wild canopy lit');
    assert.equal(live.scene.getObjectByName('island-coast-environment'), undefined);
    assert.equal(canopyMeshesOf(live.scene).length, 0);
    for (const boat of live.settlements.group.userData.skiffs) {
      assert.equal(boat.original.visible, true); assert.deepEqual(boat.group.children, [boat.original]);
    }
    assert.equal(cache.getStats().leases, 0, failing + ' releases every lease');
    live.island.dispose(); cache.dispose();
  }
  // The successful path takes all five leases from one cache, in order.
  const fixture = fixtures(), loads = [];
  const cache = createEnvironmentAssets({ load: async url => { loads.push(url); return fixture.byURL[url]; } });
  const live = await harness(undefined, cache);
  assert.equal(await live.island.ready, true);
  assert.deepEqual(loads, KIT_URLS, 'the canopy leases the three resident area kits alongside the shared and island ones');
  assert.equal(cache.getStats().leases, 5);
  assert.deepEqual(cache.getStats().loadedURLs.sort(), [...KIT_URLS].sort());
  live.island.dispose();
  assert.equal(cache.getStats().leases, 0, 'disposal releases all five');
  live.island.dispose(); assert.equal(cache.getStats().leases, 0, 'releasing is idempotent');
  cache.dispose();
});

test('a late arrival, a disposed island and a throwing settlement hook all restore the three fallbacks', async () => {
  // Disposing before the load lands installs nothing and still retires the kits.
  const lateFixture = fixtures(), lateCounts = disposalProbe(lateFixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const late = await harness(url => url === SHARED_URL ? pending : lateFixture.byURL[url]);
  late.island.dispose(); deliver(lateFixture.shared);
  assert.equal(await late.island.ready, false);
  assert.equal(late.scene.getObjectByName('island-coast-environment'), undefined);
  assert.equal(late.legacyScenery.visible, true); assert.equal(late.landmarkFallback.visible, true);
  assert.equal(late.canopyFallback.visible, true, 'a disposed island leaves the wild canopy lit');
  assert.equal(canopyMeshesOf(late.scene).length, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 }, 'the late shared kit is retired');
  // A settlement hook that throws on install and again on rollback still leaves
  // all three original batches and the original hulls standing.
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = await harness(async url => rollbackFixture.byURL[url]);
  const install = rollback.settlements.setIslandKit;
  rollback.settlements.setIslandKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.island.ready, false);
  assert.match(rollback.island.getStats().error, /install failed; Fallback restore: rollback failed/);
  assert.equal(rollback.legacyScenery.visible, true); assert.equal(rollback.landmarkFallback.visible, true);
  assert.equal(rollback.canopyFallback.visible, true);
  assert.equal(rollback.scene.getObjectByName('island-coast-environment'), undefined);
  assert.equal(canopyMeshesOf(rollback.scene).length, 0);
  rollback.island.dispose();
  assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  // Another holder of the same kits - the resident areas do exactly this - keeps
  // every lease alive, so disposing the island may touch only what it owns:
  // every material clone exactly once, and nothing borrowed at all.
  const ownedFixture = fixtures(), ownedCounts = disposalProbe(ownedFixture), tally = cloneProbe(ownedFixture);
  let releasedGeometry = 0;
  for (const geometry of ownedFixture.geometries) geometry.addEventListener('dispose', () => releasedGeometry++);
  const cache = createEnvironmentAssets({ load: async url => ownedFixture.byURL[url] });
  const residents = KIT_URLS.map(url => cache.acquire(url));
  const owned = await harness(undefined, cache);
  assert.equal(await owned.island.ready, true);
  assert.equal(cache.getStats().leases, 10, 'the island leases alongside the residents');
  assert.ok(tally.cloned > 0); assert.equal(tally.released, 0, 'a live island holds its clones');
  owned.island.dispose(); owned.island.dispose();
  assert.equal(cache.getStats().leases, 5, 'a disposed island releases only its own leases, once');
  assert.equal(tally.released, tally.cloned, 'every owned clone is disposed exactly once');
  assert.deepEqual(ownedCounts, { geometry: 0, material: 0, texture: 0, bitmap: 0 }, 'the resident kits are borrowed, never disposed');
  assert.equal(releasedGeometry, 0, 'not one borrowed source geometry is disposed with the island');
  for (const material of ownedFixture.slotMaterials.values()) {
    assert.equal(material.color.getHex(), 0xffffff, material.name + ' kit original survives the island unmutated');
  }
  for (const lease of residents) lease.release();
  assert.deepEqual(ownedCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 }, 'the last release retires the kits');
  assert.equal(releasedGeometry, ownedFixture.geometries.length, 'the last release retires every source geometry');
  cache.dispose();
});

test('the canopy slice ships no kit change: island and the three resident kits are byte-identical', async () => {
  // Runtime-only slice: the canopy reuses resident geometry, so every kit the
  // island now leases must still be the committed byte stream.
  const SHIPPED = {
    island: 'a1672bb7cf1b6077af6cae0229f3436993e4fe6b3c454709882f3a8123758df6',
    'palmheart-camp': 'b11cb2b701f88e323cc9304f0f5abe79f4c0937a6e15b308c59efc8b042c42d5',
    moonwatch: '3453b31b0abba0d57e91ff45b29382278b1b722afbafe4e14ab90a03bc8d78f7',
    cinderworks: '543754ecf825f2896b2b0ce70f98fc92a75e568164883fca7ecafe54e801abea',
  };
  for (const [name, expected] of Object.entries(SHIPPED)) {
    const bytes = await readFile(new URL('../client/assets/' + name + '/kit.glb', import.meta.url));
    const manifest = JSON.parse(await readFile(new URL('../client/assets/' + name + '/manifest.json', import.meta.url), 'utf8'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, name + ' kit is unchanged by the canopy slice');
    assert.equal(manifest.sha256, expected); assert.equal(manifest.bytes, bytes.length);
    const url = '/assets/' + name + '/kit.glb';
    assert.equal(ENVIRONMENT_ASSET_REGISTRY[url].bytes, bytes.length, url + ' registry bytes are unchanged');
    assert.equal(ENVIRONMENT_ASSET_REGISTRY[url].triangles, manifest.totalTriangles, url + ' registry triangles are unchanged');
    assert.equal(ENVIRONMENT_ASSET_REGISTRY[url].decodedTextureBytes, 0);
  }
  assert.equal(ENVIRONMENT_ASSET_REGISTRY[ISLAND_URL].bytes, 1484528);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY[ISLAND_URL].triangles, 16912);
});

after(() => {
  if (!cachedScenery) return;
  disposeOwnedResources(cachedScenery.built.group);
  for (const geometry of Object.values(cachedScenery.built.palette.geometry)) geometry.dispose();
});
