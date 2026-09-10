import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { OBSTACLES, SHRINES, SPAWN, BEACON, CHESTS, heightAt, regionAt, seededRandom, SEED } from '../shared/world.js';
import { POINTS_OF_INTEREST, BUILDINGS, trailDistance } from '../shared/exploration.js';
import { oldWatchWeight } from '../shared/old-watch.js';
import { windwardFarmWeight } from '../shared/windward-farm.js';
import { palmheartWeight } from '../shared/palmheart-camp.js';
import { cinderworksWeight } from '../shared/cinderworks.js';
import { moonwatchWeight } from '../shared/moonwatch.js';
import { tideglassWeight } from '../shared/tideglass-market.js';
import { saltwindHarborWeight } from '../shared/saltwind-harbor.js';
import { driftwoodWeight } from '../shared/driftwood-yard.js';
import { ISLAND_GROUND_NOMINALS, ISLAND_GROUND_COUNTS, ISLAND_GROUND_TOTAL, GROUND_PEBBLE_TOP, GROUND_CLUMP_TOP,
  GROUND_BUD_BASE, GROUND_BUD_RISE, SHORE_FLOWER_REACH, BEACON_STONE_ENVELOPE, COAST_ROCK_NOMINALS,
  groundPlantDressing, shoreFlowerDressing, beaconStoneDressing, ISLAND_CANOPY_TOTAL, ISLAND_LANDMARK_TOTAL } from '../shared/island.js';
import { ISLAND_PREFABS, ISLAND_MATERIAL_BINDINGS, ISLAND_GROUND_SOURCES, ISLAND_GROUND_PREFABS, ISLAND_GROUND_BINDINGS,
  ISLAND_CANOPY_SOURCES, ISLAND_CANOPY_PREFABS, ISLAND_CANOPY_KIT_URLS, islandGroundKits, buildIslandKit, createIsland } from '../client/island.js';
import { MOONWATCH_MATERIAL_BINDINGS } from '../client/moonwatch.js';
import { CINDERWORKS_MATERIAL_BINDINGS } from '../client/cinderworks.js';
import { PALMHEART_MATERIAL_BINDINGS } from '../client/palmheart-camp.js';
import { createEnvironmentAssets, disposeOwnedResources } from '../client/environment-assets.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const TAU = Math.PI * 2, GROUND_CELL = 16;
const SHARED_URL = '/assets/old-watch/kit.glb', ISLAND_URL = '/assets/island/kit.glb';
const JUNGLE_URL = '/assets/palmheart-camp/kit.glb', MOON_URL = '/assets/moonwatch/kit.glb', VOLCANO_URL = '/assets/cinderworks/kit.glb';
const KIT_URLS = [SHARED_URL, ISLAND_URL, JUNGLE_URL, MOON_URL, VOLCANO_URL];
const KIT_FILES = { shared: 'old-watch', island: 'island', jungle: 'palmheart-camp', moon: 'moonwatch', volcano: 'cinderworks' };
// The nine ground aliases that bend in the wind and the two that never do.
const SWAYING = ['haven_grass', 'beach_grass', 'jungle_fern', 'jungle_grass', 'moon_fern', 'moon_grass', 'moon_bell', 'shore_coral', 'shore_lilac'];
const RIGID = ['volcano_cinder', 'beacon_stone'];

// --------------------------------------------------------------------------
// An independent re-derivation of every ground draw. It reads the shared world
// data and the original loop structure only - never shared/island.js's dressing
// helpers, never the captured descriptors - so a capture that drifts, moves a
// random call or repeats a decision cannot agree with it.
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
// The four conservative silhouettes, restated here from the shipped GLB bounds
// rather than imported, so the runtime card is compared against an independent
// copy. The measurements themselves are re-read off the kits further down.
const NOMINALS = { fern: [.58, .69], grass: [.37, .56], cinder: [.47, .26], moonbell: [.43, .49], boulder: [2.0, 3] };
const PLANT_ID = { havenPlants: 'ground-haven-plant-', beachPlants: 'ground-beach-plant-', junglePlants: 'ground-jungle-plant-',
  volcanoPlants: 'ground-volcano-plant-', moonPlants: 'ground-moon-plant-' };
// The species mapping is the palette card read straight off the region and the
// original loop index, with the lunar bell standing where the original bud
// cluster opened.
function plantSpecies(region, index) {
  if (region === 'volcano') return ['volcanoPlants', 'volcano_cinder', NOMINALS.cinder];
  if (region === 'moon') return ['moonPlants', index % 4 === 0 ? 'moon_bell' : index % 2 === 0 ? 'moon_fern' : 'moon_grass',
    index % 4 === 0 ? NOMINALS.moonbell : index % 2 === 0 ? NOMINALS.fern : NOMINALS.grass];
  if (region === 'jungle') return ['junglePlants', index % 2 === 0 ? 'jungle_fern' : 'jungle_grass', index % 2 === 0 ? NOMINALS.fern : NOMINALS.grass];
  if (region === 'beach') return ['beachPlants', 'beach_grass', NOMINALS.grass];
  return ['havenPlants', 'haven_grass', NOMINALS.grass];
}
function derivedGroundSites() {
  const sites = [], random = seededRandom(SEED);
  for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  // Every scenery obstacle draws exactly one yaw, whatever batch it lands in.
  for (const obstacle of OBSTACLES) {
    if (obstacle.type === 'landmark' || obstacle.type === 'building' || obstacle.pilot === 'old-watch') continue;
    random();
  }
  // The 245 decorative silhouettes: two draws to place, a third only if admitted.
  for (let i = 0; i < 245; i++) {
    const a = random() * TAU, radius = Math.sqrt(random()) * 124;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius, y = heightAt(x, z);
    if (y < 1.7 || reserved(x, z, 1.2) || OBSTACLES.some(o => o.pilot !== 'old-watch' && Math.hypot(x - o.x, z - o.z) < o.radius + 3)) continue;
    random();
  }
  // The 720 small plants. A plant is the island's only after every finished area
  // has passed on it, which is decided after the original rejection and the size
  // draw; the yaw is drawn either way.
  let admitted = 0;
  for (let i = 0; i < 720; i++) {
    const x = (random() - .5) * 254, z = (random() - .5) * 254, y = heightAt(x, z);
    if (y < 2 || reserved(x, z, .2)) continue;
    const region = regionAt(x, z)?.id, size = .30 + random() * .5, yaw = random() * TAU;
    admitted++;
    const claimed = oldWatchWeight(x, z) > 0 || windwardFarmWeight(x, z) > 0 || palmheartWeight(x, z) > 0 || cinderworksWeight(x, z) > 0
      || moonwatchWeight(x, z) > 0 || tideglassWeight(x, z) > .08 || saltwindHarborWeight(x, z) > .08 || driftwoodWeight(x, z) > .08;
    if (claimed) continue;
    const [kind, prefab, nominal] = plantSpecies(region, i);
    const top = region === 'volcano' ? .63 * size
      : i % 4 === 0 ? Math.max(.96 * size, .58 * size + .12) : .96 * size;
    const fit = Math.min(size / nominal[0], top / nominal[1]);
    sites.push({ id: PLANT_ID[kind] + i, kind, region, prefab, x, y, z, rotation: [0, yaw, 0], scale: [fit, fit, fit],
      index: i, size, buds: region === 'volcano' ? false : i % 4 === 0 });
  }
  assert.equal(admitted, 385, 'the original small loop admits the shipped candidate count');
  for (let i = 0; i < 18; i++) { random(); random(); random(); } // caldera ridge placement and height
  const moon = SHRINES.find(entry => entry.id === 'moon') || { x: 76, z: 32 };
  for (const [dx, dz, s] of [[-14, -12, 2.1], [15, -9, 2.6], [18, 11, 1.8], [-9, 16, 1.6]]) {
    if (POINTS_OF_INTEREST.some(p => Math.hypot(moon.x + dx - p.x, moon.z + dz - p.z) < p.radius + s * 1.65)) continue;
    random(); // the admitted grove cap's yaw
  }
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * TAU, x = moon.x + Math.sin(a) * 13.7, z = moon.z + Math.cos(a) * 13.7;
    if (routeDistance(x, z) > 6) random(); // the admitted ring crystal's size
  }
  // The beacon perimeter: twenty candidates, both original filters, no random.
  const stoneSpread = .55 / NOMINALS.boulder[0];
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU, x = BEACON.x + Math.sin(a) * 12, z = BEACON.z + Math.cos(a) * 12;
    if (routeDistance(x, z) > 4.8 && z > BEACON.z - 4) {
      sites.push({ id: 'ground-beacon-stone-' + i, kind: 'beaconStones', region: regionAt(x, z)?.id, prefab: 'beacon_stone',
        x, y: heightAt(x, z), z, rotation: [0, 0, 0], scale: [stoneSpread, .64 / NOMINALS.boulder[1], stoneSpread], index: i });
    }
  }
  // The shore flower clumps: two draws to place, three stem heights if admitted.
  const shoreSpread = .45 / NOMINALS.moonbell[0];
  for (let i = 0; i < 35; i++) {
    const a = random() * TAU, r = 112 + random() * 10, x = Math.sin(a) * r, z = Math.cos(a) * r, y = heightAt(x, z);
    if (y < .2 || y > 3 || reserved(x, z, 1)) continue;
    const heights = [];
    for (let k = 0; k < 3; k++) heights.push(.4 + random() * .9);
    sites.push({ id: 'ground-shore-flower-' + i, kind: 'shoreFlowers', region: regionAt(x, z)?.id,
      prefab: i % 2 ? 'shore_coral' : 'shore_lilac', x, y, z, rotation: [0, 0, 0],
      scale: [shoreSpread, Math.max(...heights) / NOMINALS.moonbell[1], shoreSpread], index: i, heights });
  }
  return { sites, next: random() };
}

// --------------------------------------------------------------------------
// The shipped kits, read straight out of the GLB container. The shared library
// embeds its textures, so the loader's browser-only image path is skipped and
// the actual POSITION accessors and node transforms are decoded here instead.
const COMPONENTS = { 5121: ['getUint8', 1], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4] };
const DIMENSIONS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const containers = new Map();
async function container(key) {
  if (!containers.has(key)) {
    const bytes = await readFile(new URL('../client/assets/' + KIT_FILES[key] + '/kit.glb', import.meta.url));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', key + ' ships a binary glTF container');
    const jsonLength = view.getUint32(12, true), gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
    const binary = 20 + jsonLength + 8;
    const accessor = index => {
      const entry = gltf.accessors[index], dimensions = DIMENSIONS[entry.type], [read, size] = COMPONENTS[entry.componentType];
      const bufferView = gltf.bufferViews[entry.bufferView], stride = bufferView.byteStride || dimensions * size;
      const base = binary + (bufferView.byteOffset || 0) + (entry.byteOffset || 0), rows = [];
      for (let i = 0; i < entry.count; i++) {
        const row = [];
        for (let d = 0; d < dimensions; d++) row.push(view[read](base + i * stride + d * size, true));
        rows.push(row);
      }
      return rows;
    };
    containers.set(key, { gltf, accessor });
  }
  return containers.get(key);
}
function nodeMatrix(node) {
  if (node.matrix) return new THREE.Matrix4().fromArray(node.matrix);
  return new THREE.Matrix4().compose(new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(node.scale ?? [1, 1, 1])));
}
const rootCache = new Map();
// Every authored vertex of one shipped root, in the root's own frame, with the
// slot and triangle count of each primitive it is exported with.
async function shippedRoot(key, name) {
  const cacheKey = key + '|' + name;
  if (!rootCache.has(cacheKey)) {
    const { gltf, accessor } = await container(key);
    const index = gltf.nodes.findIndex(node => node.name === name);
    assert.ok(index >= 0, name + ' is exported by the ' + key + ' kit');
    const points = [], primitives = [];
    const walk = (nodeIndex, parent) => {
      const node = gltf.nodes[nodeIndex], world = parent.clone().multiply(nodeMatrix(node));
      for (const primitive of node.mesh == null ? [] : gltf.meshes[node.mesh].primitives) {
        for (const position of accessor(primitive.attributes.POSITION)) points.push(new THREE.Vector3(...position).applyMatrix4(world));
        primitives.push({ slot: gltf.materials[primitive.material].name,
          triangles: gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3 });
      }
      for (const child of node.children ?? []) walk(child, world);
    };
    walk(index, new THREE.Matrix4());
    rootCache.set(cacheKey, { points, primitives,
      reach: Math.max(...points.map(point => Math.hypot(point.x, point.z))),
      top: Math.max(...points.map(point => point.y)), bottom: Math.min(...points.map(point => point.y)) });
  }
  return rootCache.get(cacheKey);
}
const groundRoot = alias => shippedRoot(ISLAND_GROUND_SOURCES[alias].kit, ISLAND_GROUND_SOURCES[alias].source);

// --------------------------------------------------------------------------
let cachedScenery = null;
async function recorded() {
  if (!cachedScenery) {
    const { buildScenery } = await import('../client/world.js');
    const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random(); // preceding ocean construction
    const palette = makePalette(), built = buildScenery(palette, random);
    cachedScenery = { palette, built, sites: built.groundSites, fallback: built.groundFallback, group: built.group, next: random() };
  }
  return cachedScenery;
}

// The island roots and the slot each is authored with, enough for the kit's own
// validation; the resident roots the canopy and the ground borrow; and the two
// shared clumps the small foliage leans on.
const ISLAND_ROOT_SLOTS = {
  coast_palm_a: ['palm_trunk', 'coast_frond'], coast_palm_b: ['palm_trunk', 'dead_frond'],
  coast_rock_a: ['coast_stone'], coast_rock_b: ['coast_stone'],
  fishing_skiff_a: ['skiff_plank', 'skiff_teal'], fishing_skiff_b: ['skiff_plank', 'skiff_coral'],
  palm_gate_pillar: ['jungle_gate_stone'], palm_gate_lintel: ['jungle_gate_edge'],
  moon_gate_ring: ['lunar_stone', 'lunar_glow'], moon_gate_orb: ['lunar_stone'],
  shrine_mushroom: ['lunar_cap', 'lunar_stem'], shrine_moon_crystal: ['lunar_glow'],
  caldera_ridge_a: ['caldera_basalt', 'caldera_weathered'], caldera_ridge_b: ['caldera_basalt'],
  caldera_amber_crystal: ['caldera_glow'], ember_core: ['caldera_basalt'], ember_core_rock: ['caldera_basalt'],
};
const RESIDENT_ROOT_SLOTS = {
  jungle: { jungle_tree_a: ['broad_leaf', 'jungle_bark'], jungle_tree_b: ['broad_leaf', 'jungle_bark'], jungle_palm: ['jungle_bark', 'palm_frond'] },
  moon: { silver_tree_a: ['lavender_leaf', 'silver_bark'], silver_tree_b: ['lavender_leaf', 'silver_bark'],
    moon_mushroom: ['mushroom_cap', 'mushroom_stem'], moonbell_clump: ['moonbell'] },
  volcano: { basalt_outcrop: ['basalt_block'], basalt_boulder_a: ['basalt_block'], basalt_boulder_b: ['basalt_block'],
    ember_crystal: ['ember_crystal'], cinder_clump: ['scoria'] },
};
const SHARED_ROOT_SLOTS = { fern_clump: 'needle_foliage', grass_clump: 'needle_foliage' };
// Each source primitive is offset, turned and squashed inside its root, so an
// installed instance has to carry the source child matrix through the captured
// transform rather than only the descriptor's own placement.
function childMesh(name, slot, index, material, geometries) {
  const geometry = new THREE.BoxGeometry(.2, .5, .2); geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name + '-' + slot;
  mesh.position.set(.13 * (index + 1), .27 * (index + 1), -.09 * (index + 1));
  mesh.rotation.set(.11, .23 * (index + 1), -.07);
  mesh.scale.set(1 + .1 * index, .85, 1.2);
  return mesh;
}
function kitScene(roots, tag, slotMaterials, geometries) {
  const scene = new THREE.Group();
  for (const [name, slots] of Object.entries(roots)) {
    const root = new THREE.Group(); root.name = name;
    slots.forEach((slot, index) => {
      const material = new THREE.MeshStandardMaterial(); material.name = slot;
      slotMaterials.set(tag + '|' + name + '|' + slot, material);
      root.add(childMesh(name, slot, index, material, geometries));
    });
    scene.add(root);
  }
  return { scene };
}
function fixtures() {
  const carrier = new THREE.BoxGeometry(.2, .5, .2), materials = new Map(), slotMaterials = new Map(), geometries = [];
  const shared = { scene: new THREE.Group() };
  const dictionaries = [ISLAND_MATERIAL_BINDINGS, PALMHEART_MATERIAL_BINDINGS, MOONWATCH_MATERIAL_BINDINGS,
    CINDERWORKS_MATERIAL_BINDINGS, ISLAND_GROUND_BINDINGS];
  for (const name of new Set(dictionaries.flatMap(entry => Object.values(entry).map(binding => binding.source)))) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const mesh = new THREE.Mesh(carrier, material); mesh.name = 'material-' + name; shared.scene.add(mesh);
  }
  // The shipped clumps carry the library's own needle_foliage slot, so the shared
  // roots share that source material rather than declaring a second one.
  for (const [name, slot] of Object.entries(SHARED_ROOT_SLOTS)) {
    const root = new THREE.Group(); root.name = name;
    root.add(childMesh(name, slot, 0, materials.get(slot), geometries)); shared.scene.add(root);
  }
  const kit = kitScene(ISLAND_ROOT_SLOTS, 'island', slotMaterials, geometries);
  const canopyKits = Object.fromEntries(Object.entries(RESIDENT_ROOT_SLOTS)
    .map(([key, roots]) => [key, kitScene(roots, key, slotMaterials, geometries)]));
  const byURL = { [SHARED_URL]: shared, [ISLAND_URL]: kit, [JUNGLE_URL]: canopyKits.jungle, [MOON_URL]: canopyKits.moon, [VOLCANO_URL]: canopyKits.volcano };
  return { shared, kit, canopyKits, byURL, carrier, geometries, materials, slotMaterials };
}
function disposalProbe(fixture) {
  const counts = { geometry: 0, material: 0, texture: 0, bitmap: 0 };
  fixture.carrier.addEventListener('dispose', () => counts.geometry++);
  const texture = new THREE.Texture({ width: 8, height: 8, close: () => counts.bitmap++ });
  texture.addEventListener('dispose', () => counts.texture++);
  const material = fixture.materials.get('watch_stone'); material.map = material.normalMap = texture;
  material.addEventListener('dispose', () => counts.material++);
  return counts;
}
function cloneProbe(fixture) {
  const tally = { cloned: 0, released: 0 };
  for (const material of fixture.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); tally.cloned++; copy.addEventListener('dispose', () => tally.released++); return copy; };
  }
  return tally;
}
const fallbackGroup = name => { const group = new THREE.Group(); group.name = name; return group; };
async function harness(load, assets, { canopy = true } = {}) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette());
  const legacyScenery = fallbackGroup('island-coast-original-scenery');
  const landmarkFallback = fallbackGroup('island-shrines-original-scenery');
  const canopyFallback = fallbackGroup('island-canopy-original-scenery');
  const groundFallback = fallbackGroup('island-ground-original-scenery');
  scene.add(settlements.group, legacyScenery, landmarkFallback, canopyFallback, groundFallback);
  const built = await recorded();
  const options = { scene, settlements, legacyScenery, landmarkFallback, canopyFallback, groundFallback, load, assets,
    palmSites: built.built.coastPalmSites, rockSites: built.built.coastRockSites, landmarkSites: built.built.landmarkSites,
    canopySites: canopy ? built.built.canopySites : [], groundSites: built.sites };
  return { ...options, groundSites: built.sites, island: createIsland(options) };
}
const groundMeshesOf = scene => {
  const meshes = [];
  scene.traverse(object => { if (object.isInstancedMesh && object.userData.groundPrefab) meshes.push(object); });
  return meshes;
};
// The 16 m cells, grouped from the descriptors themselves rather than read back
// off the runtime's own batching.
function cellsOf(sites) {
  const cells = new Map();
  for (const site of sites) {
    const key = Math.floor(site.x / GROUND_CELL) + ':' + Math.floor(site.z / GROUND_CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(site);
  }
  return cells;
}
function siteMatrix(site, seat) {
  return new THREE.Matrix4().compose(new THREE.Vector3(site.x, seat, site.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(site.rotation[0], site.rotation[1], site.rotation[2])),
    new THREE.Vector3(site.scale[0], site.scale[1], site.scale[2]));
}
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

// --------------------------------------------------------------------------
test('buildScenery records one ground descriptor per island clump, shore spray and beacon stone', async () => {
  const built = await recorded(), derived = derivedGroundSites();
  // The independent replay agrees on every id, kind, region, prefab, position,
  // rotation, scale and piece of original metadata, for all of them at once.
  assert.equal(derived.sites.length, 316, 'the independent replay finds the shipped inventory');
  assert.deepEqual(built.sites, derived.sites, 'every captured descriptor matches the independently replayed draw');
  assert.equal(built.sites.length, ISLAND_GROUND_TOTAL); assert.equal(ISLAND_GROUND_TOTAL, 316);
  assert.equal(316, 301 + 11 + 4, 'the inventory is 301 small clumps, 11 shore sprays and 4 beacon stones');
  assert.equal(new Set(built.sites.map(site => site.id)).size, 316, 'every descriptor has its own stable id');
  const counts = {};
  for (const site of built.sites) counts[site.kind] = (counts[site.kind] ?? 0) + 1;
  assert.deepEqual(counts, ISLAND_GROUND_COUNTS);
  assert.deepEqual({ ...ISLAND_GROUND_COUNTS }, { havenPlants: 34, beachPlants: 25, junglePlants: 73, volcanoPlants: 113,
    moonPlants: 56, shoreFlowers: 11, beaconStones: 4 });
  assert.equal(counts.havenPlants + counts.beachPlants + counts.junglePlants + counts.volcanoPlants + counts.moonPlants, 301);
  // Routing only moves draws between batches: the RNG stream is untouched, and
  // the replay consumes exactly the same draws to reach the same next value.
  assert.equal(built.next, .017430383479222655); assert.equal(derived.next, built.next);
  // Region counts are the loop's own, not the dressing's: every small plant
  // stands in the region its descriptor names.
  const byRegion = {};
  for (const site of built.sites) if (site.kind.endsWith('Plants')) byRegion[site.region] = (byRegion[site.region] ?? 0) + 1;
  assert.deepEqual(byRegion, { haven: 34, beach: 25, jungle: 73, volcano: 113, moon: 56 });
  for (const site of built.sites) {
    assert.ok(ISLAND_GROUND_PREFABS.includes(site.prefab), site.id + ' names a ground alias');
    assert.equal(regionAt(site.x, site.z)?.id, site.region, site.id + ' stands in the region it records');
    assert.equal(site.y, heightAt(site.x, site.z), site.id + ' carries the original analytical ground as metadata');
    assert.equal(site.rotation.length, 3); assert.equal(site.scale.length, 3);
    for (const value of [site.x, site.y, site.z, ...site.rotation, ...site.scale]) assert.ok(Number.isFinite(value), site.id);
    for (const value of site.scale) assert.ok(value > 0, site.id + ' scale is positive');
    assert.deepEqual([site.rotation[0], site.rotation[2]], [0, 0], site.id + ' turns on its yaw only');
    assert.ok(Number.isInteger(site.index) && site.index >= 0, site.id + ' is keyed by its original candidate index');
  }
  // The small plants keep the original loop's own index, size and bud flag. The
  // volcanic slope never grew a bud cluster, so its metadata says so even on the
  // indices the other regions used for one.
  const small = built.sites.filter(site => site.kind.endsWith('Plants'));
  assert.equal(small.length, 301);
  for (const site of small) {
    assert.ok(site.index < 720, site.id + ' comes from the 720-candidate loop');
    assert.ok(site.size >= .30 && site.size < .80, site.id + ' keeps the original draw size');
    assert.equal(site.id, PLANT_ID[site.kind] + site.index);
    assert.equal(site.buds, site.region !== 'volcano' && site.index % 4 === 0, site.id + ' bud metadata');
    assert.equal(site.heights, undefined, site.id + ' is not a shore clump');
  }
  const volcanicBudIndices = small.filter(site => site.region === 'volcano' && site.index % 4 === 0);
  assert.ok(volcanicBudIndices.length > 0, 'the volcanic slope does hit the bud parity');
  for (const site of volcanicBudIndices) assert.equal(site.buds, false, site.id + ' never grew the bud cluster the inventory probe flagged');
  // The eleven shore clumps: one descriptor per clump, never one per stem, with
  // all three original stem heights and the loop's own colour parity.
  const shore = built.sites.filter(site => site.kind === 'shoreFlowers');
  assert.deepEqual(shore.map(site => site.index), [0, 3, 5, 8, 11, 12, 18, 30, 31, 32, 33]);
  assert.equal(shore.filter(site => site.prefab === 'shore_coral').length, 5);
  assert.equal(shore.filter(site => site.prefab === 'shore_lilac').length, 6);
  for (const site of shore) {
    assert.equal(site.prefab, site.index % 2 ? 'shore_coral' : 'shore_lilac', site.id + ' follows the original stalk parity');
    assert.equal(site.heights.length, 3, site.id + ' records all three original stems');
    for (const height of site.heights) assert.ok(height >= .4 && height < 1.3, site.id + ' stem height ' + height);
    assert.deepEqual(site.rotation, [0, 0, 0], site.id + ' keeps the original clump yaw');
    assert.ok(site.y >= .2 && site.y <= 3, site.id + ' stands on the admitted shore band');
  }
  // Four of the beacon's twenty candidates pass both original filters; the other
  // sixteen were never drawn and are not invented here.
  const stones = built.sites.filter(site => site.kind === 'beaconStones');
  assert.deepEqual(stones.map(site => site.index), [2, 6, 17, 18]);
  for (const site of stones) {
    assert.equal(site.prefab, 'beacon_stone'); assert.deepEqual(site.rotation, [0, 0, 0]);
    assert.ok(routeDistance(site.x, site.z) > 4.8 && site.z > BEACON.z - 4, site.id + ' passes both original filters');
    near(Math.hypot(site.x - BEACON.x, site.z - BEACON.z), 12, 1e-9, site.id + ' stands on the original perimeter ring');
  }
  // One fallback mesh, one parent, still lit and shadowing until the kit lands.
  assert.equal(built.fallback.name, 'island-ground-original-scenery');
  assert.equal(built.fallback.isMesh, true, 'the ground cover comes back as one restorable batch');
  assert.equal(built.fallback.parent, built.group); assert.equal(built.fallback.visible, true);
  assert.equal(built.fallback.castShadow, true); assert.equal(built.fallback.receiveShadow, true);
  assert.ok(built.fallback.geometry.attributes.position.count > 0);
  assert.equal(built.group.userData.groundSites, built.sites);
  assert.equal(built.group.userData.groundFallback, built.fallback);
  let parents = 0, lights = 0;
  built.group.traverse(object => { if (object === built.fallback) parents++; if (object.isLight) lights++; });
  assert.equal(parents, 1, 'the ground batch is never drawn twice');
  assert.equal(lights, 0, 'the ground slice adds no scene light');
  // The finished slices are untouched: their descriptors and fallbacks are what
  // they shipped.
  assert.equal(built.built.coastPalmSites.length, 38); assert.equal(built.built.coastRockSites.length, 4);
  assert.equal(built.built.landmarkSites.length, ISLAND_LANDMARK_TOTAL); assert.equal(built.built.canopySites.length, ISLAND_CANOPY_TOTAL);
  for (const mesh of [built.built.coastLegacyScenery, built.built.landmarkFallback, built.built.canopyFallback]) assert.equal(mesh.visible, true);
  // Every recorded site has original geometry standing over it, and the batch
  // carries nothing else: a small clump reached its own draw size horizontally,
  // a shore stem .32 along and .18 across, and a perimeter cylinder .55.
  const reachOf = site => site.kind === 'shoreFlowers' ? 1.1 : site.kind === 'beaconStones' ? .6 : site.size * 1.35 + .3;
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
  assert.equal(strays, 0, 'nothing but the recorded ground draws is routed into the ground fallback');
});

test('the ground palette and every fit are measured on the shipping clump vertices', async () => {
  for (const frozen of [ISLAND_GROUND_NOMINALS, ISLAND_GROUND_COUNTS, ISLAND_GROUND_SOURCES, ISLAND_GROUND_BINDINGS,
    ISLAND_GROUND_PREFABS, BEACON_STONE_ENVELOPE]) assert.ok(Object.isFrozen(frozen));
  assert.deepEqual([...ISLAND_GROUND_PREFABS], ['haven_grass', 'beach_grass', 'jungle_fern', 'jungle_grass',
    'moon_fern', 'moon_grass', 'moon_bell', 'volcano_cinder', 'shore_coral', 'shore_lilac', 'beacon_stone']);
  assert.deepEqual([...SWAYING, ...RIGID].sort(), [...ISLAND_GROUND_PREFABS].sort(), 'every alias is either swaying foliage or rigid');
  assert.deepEqual(Object.keys(ISLAND_GROUND_NOMINALS).sort(), [...ISLAND_GROUND_PREFABS].sort(), 'every alias records a nominal');
  // Every alias declares its geometry, the slot that root is authored with and
  // the dictionary entry it is dressed in as separate fields, so nothing is
  // inferred from the geometry's own kit.
  for (const alias of ISLAND_GROUND_PREFABS) {
    const source = ISLAND_GROUND_SOURCES[alias];
    assert.ok(Object.isFrozen(source), alias);
    assert.deepEqual(Object.keys(source).slice(0, 5), ['kit', 'source', 'slot', 'palette', 'binding'], alias + ' declares a complete recipe');
    const root = await shippedRoot(source.kit, source.source);
    assert.equal(root.primitives.length, 1, alias + ' borrows a single-primitive root');
    assert.deepEqual([...new Set(root.primitives.map(primitive => primitive.slot))], [source.slot],
      alias + ' declares the slot the shipped root is actually authored with');
    const dictionary = { ground: ISLAND_GROUND_BINDINGS, island: ISLAND_MATERIAL_BINDINGS, moon: MOONWATCH_MATERIAL_BINDINGS,
      volcano: CINDERWORKS_MATERIAL_BINDINGS, jungle: PALMHEART_MATERIAL_BINDINGS }[source.palette];
    assert.ok(dictionary?.[source.binding], alias + ' names a published binding');
    assert.ok(['needle_foliage', 'watch_stone'].includes(dictionary[source.binding].source), alias + ' borrows a shared library source');
  }
  // Runtime-only slice: the ground borrows the shared library's own clumps for
  // the first time, so that kit and the island kit must still be the committed
  // byte stream, and each borrowed root the manifest it was published with.
  for (const [key, sha, bytes] of [['shared', '3fce2c1f50178bf0a681fdec6aafba86b98140cc108ce6ae522b45e6370f152b', 7584620],
    ['island', 'a1672bb7cf1b6077af6cae0229f3436993e4fe6b3c454709882f3a8123758df6', 1484528]]) {
    const file = await readFile(new URL('../client/assets/' + KIT_FILES[key] + '/kit.glb', import.meta.url));
    const card = JSON.parse(await readFile(new URL('../client/assets/' + KIT_FILES[key] + '/manifest.json', import.meta.url), 'utf8'));
    assert.equal(createHash('sha256').update(file).digest('hex'), sha, KIT_FILES[key] + ' kit is unchanged by the ground slice');
    assert.equal(file.length, bytes); assert.equal(card.bytes, bytes); assert.equal(card.sha256, sha);
  }
  for (const alias of ISLAND_GROUND_PREFABS) {
    const { kit, source } = ISLAND_GROUND_SOURCES[alias];
    const card = JSON.parse(await readFile(new URL('../client/assets/' + KIT_FILES[kit] + '/manifest.json', import.meta.url), 'utf8'));
    const entry = card.prefabs[source], root = await groundRoot(alias);
    assert.deepEqual(entry.materials, [ISLAND_GROUND_SOURCES[alias].slot], alias + ' manifest slot');
    assert.equal(entry.primitives, 1, alias + ' manifest primitive count');
    assert.equal(entry.triangles, root.primitives[0].triangles, alias + ' manifest triangle count matches the shipped mesh');
    near(entry.horizontalRadius, root.reach, 1e-4, alias + ' manifest radius matches the shipped vertices');
    near(entry.bounds.max[1], root.top, 1e-4, alias + ' manifest top matches the shipped vertices');
  }
  // The eight runtime-only recipes stay out of the shipped island dictionary, and
  // that dictionary still deep-equals the committed manifest.
  const manifest = JSON.parse(await readFile(new URL('../client/assets/island/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.materialBindings, ISLAND_MATERIAL_BINDINGS, 'the ground slice adds no island binding');
  for (const name of Object.keys(ISLAND_GROUND_BINDINGS)) assert.equal(ISLAND_MATERIAL_BINDINGS[name], undefined, name + ' stays runtime-only');
  assert.equal(ISLAND_PREFABS.length, 17, 'the ground authors no new island root');
  assert.equal(ISLAND_CANOPY_PREFABS.length, 11, 'the canopy mapping is untouched');
  for (const alias of ISLAND_GROUND_PREFABS) assert.equal(ISLAND_CANOPY_SOURCES[alias], undefined, alias + ' is not smuggled into the canopy mapping');
  // The published bindings the borrowed slots reuse are the areas' own, unedited.
  assert.deepEqual(ISLAND_GROUND_SOURCES.moon_bell.palette, 'moon');
  assert.deepEqual(MOONWATCH_MATERIAL_BINDINGS.moonbell, { source: 'watch_stone', color: [5.60, 4.60, 8.00], normalScale: .40, doubleSided: true });
  assert.deepEqual(CINDERWORKS_MATERIAL_BINDINGS.scoria, { source: 'watch_stone', color: [1.05, .70, .62], normalScale: 1.0 });
  assert.equal(ISLAND_GROUND_SOURCES.beacon_stone.bound, true, 'the beacon stone installs an already-bound clone');
  assert.equal(ISLAND_GROUND_SOURCES.beacon_stone.binding, 'coast_stone');
  // Each nominal rounds the actual shipped extent up, so a body dressed by it
  // never overshoots the silhouette it replaces. Aliases that borrow one root
  // share one frozen card.
  const measured = {};
  for (const alias of ISLAND_GROUND_PREFABS) {
    const nominal = ISLAND_GROUND_NOMINALS[alias], root = await groundRoot(alias);
    measured[alias] = root;
    assert.ok(nominal.radius >= root.reach - 1e-9, alias + ' nominal radius ' + nominal.radius + ' covers ' + root.reach.toFixed(5));
    assert.ok(nominal.height >= root.top - 1e-9, alias + ' nominal height ' + nominal.height + ' covers ' + root.top.toFixed(5));
    // The four clump cards are rounded-up measurements, not slack. The beacon
    // stone deliberately divides by the coast collider card instead, so its
    // envelope - not this nominal - is what the fit below has to prove.
    if (alias !== 'beacon_stone') assert.ok(nominal.radius - root.reach < .015 && nominal.height - root.top < .015,
      alias + ' nominal is the measurement rounded up, not a slack guess');
  }
  near(measured.jungle_fern.reach, .57076, 1e-5, 'fern reach'); near(measured.jungle_fern.top, .68270, 1e-5, 'fern top');
  near(measured.haven_grass.reach, .36994, 1e-5, 'grass reach'); near(measured.haven_grass.top, .55495, 1e-5, 'grass top');
  near(measured.volcano_cinder.reach, .46869, 1e-5, 'cinder reach'); near(measured.volcano_cinder.top, .25188, 1e-5, 'cinder top');
  near(measured.moon_bell.reach, .42671, 1e-5, 'moonbell reach'); near(measured.moon_bell.top, .48813, 1e-5, 'moonbell top');
  near(measured.beacon_stone.reach, 1.83080, 1e-5, 'coast boulder reach'); near(measured.beacon_stone.top, 2.80948, 1e-5, 'coast boulder top');
  assert.equal(ISLAND_GROUND_NOMINALS.haven_grass, ISLAND_GROUND_NOMINALS.beach_grass, 'aliases on one root share one card');
  assert.equal(ISLAND_GROUND_NOMINALS.jungle_fern, ISLAND_GROUND_NOMINALS.moon_fern);
  assert.equal(ISLAND_GROUND_NOMINALS.shore_coral, ISLAND_GROUND_NOMINALS.shore_lilac);
  assert.equal(ISLAND_GROUND_NOMINALS.beacon_stone, COAST_ROCK_NOMINALS.coast_rock_b, 'the stone divides by the coast boulder card');
  assert.equal(GROUND_PEBBLE_TOP, .63); assert.equal(GROUND_CLUMP_TOP, .96);
  assert.equal(GROUND_BUD_BASE, .58); assert.equal(GROUND_BUD_RISE, .12);
  assert.equal(SHORE_FLOWER_REACH, .45); assert.deepEqual({ ...BEACON_STONE_ENVELOPE }, { radius: .55, height: .64 });
  // Every shipped site, checked against the actual scaled vertices of the root it
  // installs: the whole authored body stays inside the footprint of the original
  // draw and never rises above the silhouette it replaces.
  const sites = (await recorded()).sites;
  let checked = 0, worstReach = 0, worstTop = 0, triangles = 0;
  for (const site of sites) {
    const root = await groundRoot(site.prefab), [sx, sy, sz] = site.scale;
    const reach = root.reach * Math.max(sx, sz), top = root.top * sy;
    if (site.kind === 'shoreFlowers') {
      const dressing = shoreFlowerDressing(site.index, site.heights);
      assert.equal(dressing.id, site.id); assert.equal(dressing.prefab, site.prefab);
      assert.deepEqual(dressing.scale, site.scale, site.id + ' is reproducible from index and stem heights');
      assert.equal(sx, sz, site.id + ' stays round in plan'); assert.notEqual(sx, sy, site.id + ' is deliberately non-uniform');
      assert.ok(reach <= SHORE_FLOWER_REACH + 1e-9, site.id + ' spreads ' + reach.toFixed(4) + ' inside the inherited .45 m footprint');
      // The bells rise to the tallest original stem without ever overshooting it:
      // the fit divides by the rounded-up nominal, so the shipped root lands just
      // under the stem it replaces.
      const tallest = Math.max(...site.heights);
      assert.ok(top <= tallest + 1e-9, site.id + ' stands ' + top.toFixed(4) + ' under its tallest ' + tallest.toFixed(4) + ' m stem');
      assert.ok(top >= tallest * .99, site.id + ' still reaches the stem it replaces');
      worstTop = Math.max(worstTop, top / tallest);
    } else if (site.kind === 'beaconStones') {
      const dressing = beaconStoneDressing(site.index);
      assert.equal(dressing.id, site.id); assert.deepEqual(dressing.scale, site.scale);
      assert.equal(sx, sz, site.id + ' stays round in plan');
      assert.ok(reach <= BEACON_STONE_ENVELOPE.radius + 1e-9, site.id + ' reaches ' + reach.toFixed(4) + ' inside the .55 m envelope');
      assert.ok(top <= BEACON_STONE_ENVELOPE.height + 1e-9, site.id + ' stands ' + top.toFixed(4) + ' under the .64 m top');
      assert.ok(root.bottom * sy < 0, site.id + ' keeps a buried footing rather than floating');
    } else {
      const dressing = groundPlantDressing(site.region, site.index, site.size);
      assert.equal(dressing.id, site.id); assert.equal(dressing.kind, site.kind); assert.equal(dressing.prefab, site.prefab);
      assert.deepEqual(dressing.scale, site.scale, site.id + ' is reproducible from region, index and draw size');
      assert.ok(sx === sy && sy === sz, site.id + ' dresses uniformly');
      const target = site.region === 'volcano' ? GROUND_PEBBLE_TOP * site.size
        : site.index % 4 === 0 ? Math.max(GROUND_CLUMP_TOP * site.size, GROUND_BUD_BASE * site.size + GROUND_BUD_RISE) : GROUND_CLUMP_TOP * site.size;
      assert.ok(reach <= site.size + 1e-9, site.id + ' reaches ' + reach.toFixed(4) + ' inside its original ' + site.size.toFixed(3) + ' m footprint');
      assert.ok(top <= target + 1e-9, site.id + ' stands ' + top.toFixed(4) + ' under the original ' + target.toFixed(3) + ' m silhouette');
      worstReach = Math.max(worstReach, reach / site.size); worstTop = Math.max(worstTop, top / target);
    }
    triangles += root.primitives.reduce((sum, primitive) => sum + primitive.triangles, 0);
    checked++;
  }
  assert.equal(checked, 316, 'every shipped descriptor is fitted against real vertices');
  assert.ok(worstReach > .9 && worstTop > .9, 'the fits are tight, not merely safe: ' + worstReach.toFixed(3) + ' / ' + worstTop.toFixed(3));
  // The shore fit is the one that has to stretch: a seven-bell root reaching the
  // tallest original stem while keeping the inherited footprint.
  const shore = sites.filter(site => site.kind === 'shoreFlowers');
  near(Math.max(...shore.map(site => site.scale[1])), 2.5710, 1e-3, 'the tallest shore clump y-scale');
  assert.ok(shore.every(site => site.scale[1] > site.scale[0]), 'every shore clump rises above its own spread');
  // The actual full-density triangle cost of the shipping roots, so the lead
  // measures against the real geometry rather than the WP-1 probe's fixture cost.
  assert.equal(triangles, 120432, 'full-density ground triangle cost over the shipped clumps');
});

test('the ground installs on 16 m cells with the composed source child transform and its own palette clones', async () => {
  const fixture = fixtures();
  const live = await harness(async url => fixture.byURL[url]);
  assert.equal(live.groundFallback.visible, true, 'the original ground carries the island until the whole kit lands');
  assert.equal(await live.island.ready, true);
  for (const parent of [live.legacyScenery, live.landmarkFallback, live.canopyFallback, live.groundFallback]) {
    assert.equal(parent.visible, false, parent.name + ' only steps aside once every batch is installed');
  }
  let lights = 0; live.scene.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'the ground adds no scene light');
  const meshes = groundMeshesOf(live.scene);
  const matrix = new THREE.Matrix4(), expected = new THREE.Matrix4(), seen = new Set();
  let detailMeshes = 0, stoneMeshes = 0;
  for (const alias of ISLAND_GROUND_PREFABS) {
    const own = live.groundSites.filter(site => site.prefab === alias);
    assert.ok(own.length, alias + ' has recorded sites');
    const cells = cellsOf(own), mine = meshes.filter(mesh => mesh.userData.groundPrefab === alias);
    // One InstancedMesh per source primitive per cell; every shipped clump root
    // is a single primitive, so the mesh count is the independently derived cell
    // count and nothing else.
    assert.equal(mine.length, cells.size, alias + ' batches one mesh per source primitive per 16 m cell');
    const stone = alias === 'beacon_stone', source = ISLAND_GROUND_SOURCES[alias];
    if (stone) stoneMeshes += mine.length; else detailMeshes += mine.length;
    // The stone installs the island's own bound boulder, whose clone shares the
    // kit root's geometry and child transform; every other alias borrows the
    // shared library or the resident kit that authored the clump.
    const kitScene = source.kit === 'shared' ? fixture.shared.scene
      : source.kit === 'island' ? fixture.kit.scene : fixture.canopyKits[source.kit].scene;
    const sourceMesh = kitScene.getObjectByName(source.source).children[0];
    sourceMesh.updateMatrixWorld(true);
    for (const [key, cellSites] of cells) {
      const mesh = mine.find(candidate => candidate.name === 'island-ground-' + alias + '-' + key);
      assert.ok(mesh, alias + ' cell ' + key);
      assert.equal(mesh.count, cellSites.length); assert.equal(mesh.userData.fullCount, cellSites.length);
      assert.equal(mesh.userData.detailKind, stone ? undefined : 'ground', alias + ' detail policy membership');
      assert.equal(mesh.castShadow, stone, alias + ' shadow casting'); assert.equal(mesh.receiveShadow, true);
      assert.ok(mesh.boundingSphere && mesh.boundingSphere.radius > 0, mesh.name + ' computes its bounds');
      const [cx, cz] = key.split(':').map(Number);
      assert.deepEqual(mesh.userData.cellCenter, { x: (cx + .5) * GROUND_CELL, z: (cz + .5) * GROUND_CELL }, mesh.name + ' cell centre');
      for (const site of cellSites) {
        assert.ok(Math.abs(site.x - mesh.userData.cellCenter.x) <= GROUND_CELL / 2 + 1e-9, site.id + ' lies inside its own cell');
        assert.ok(Math.abs(site.z - mesh.userData.cellCenter.z) <= GROUND_CELL / 2 + 1e-9, site.id);
      }
      // Geometry is borrowed by identity from the kit that authored it, never
      // rebuilt or substituted.
      assert.equal(mesh.geometry, sourceMesh.geometry, alias + ' borrows the source geometry');
      cellSites.forEach((site, index) => {
        mesh.getMatrixAt(index, matrix);
        // Only the seat is resampled: a shallow plant sits on the rendered
        // triangle it stands on, a stone on the ground itself.
        const seat = renderedHeightAt(site.x, site.z) + (stone ? 0 : .015);
        expected.multiplyMatrices(siteMatrix(site, seat), sourceMesh.matrix);
        assertMatrix(matrix, expected, site.id); seen.add(site.id);
      });
    }
  }
  assert.deepEqual([...seen].sort(), live.groundSites.map(site => site.id).sort(), 'every recorded transform is compared as a whole matrix');
  assert.equal(seen.size, 316);
  assert.equal(detailMeshes, 172, 'the independently grouped 16 m cells produce the shipped detail batch count');
  assert.equal(stoneMeshes, 2);
  for (const mesh of meshes) assert.match(mesh.name, /^island-ground-[a-z_]+--?\d+:-?\d+$/);
  // The seat matters: the analytical ground the descriptor carries and the
  // rendered triangle the clump stands on differ by up to .16 m.
  for (const [index, delta] of [[306, .1585], [163, .1012], [40, -.0984]]) {
    const site = live.groundSites.find(entry => entry.index === index && entry.kind.endsWith('Plants'));
    assert.ok(site, 'ground index ' + index);
    near(site.y - renderedHeightAt(site.x, site.z), delta, 5e-4, 'analytical minus rendered ground at ' + index);
  }
  // One clone per alias, shared by every cell: four aliases borrow the shared
  // grass blade and three the grove's bell, each with an independent tint.
  const byAlias = new Map();
  for (const mesh of meshes) {
    if (!byAlias.has(mesh.userData.groundPrefab)) byAlias.set(mesh.userData.groundPrefab, new Set());
    byAlias.get(mesh.userData.groundPrefab).add(mesh.material);
  }
  for (const [alias, materials] of byAlias) assert.equal(materials.size, 1, alias + ' is bound once and shared by every cell');
  const materialOf = alias => [...byAlias.get(alias)][0];
  const owned = new Set(ISLAND_GROUND_PREFABS.filter(alias => alias !== 'beacon_stone').map(materialOf));
  assert.equal(owned.size, 10, 'every dressed alias owns its own clone, never a shared one');
  const kitOriginals = new Set(fixture.slotMaterials.values()), sharedOriginals = new Set(fixture.materials.values());
  for (const alias of ISLAND_GROUND_PREFABS) {
    const material = materialOf(alias), source = ISLAND_GROUND_SOURCES[alias];
    assert.equal(kitOriginals.has(material), false, alias + ' is not a kit original');
    assert.equal(sharedOriginals.has(material), false, alias + ' is not the shared source itself');
    const binding = { ground: ISLAND_GROUND_BINDINGS, island: ISLAND_MATERIAL_BINDINGS, moon: MOONWATCH_MATERIAL_BINDINGS,
      volcano: CINDERWORKS_MATERIAL_BINDINGS }[source.palette][source.binding];
    assert.equal(material.name, source.binding, alias + ' carries its binding name');
    assert.deepEqual(rgb(material.color), binding.color.map(value => Number(value.toFixed(6))), alias + ' tint');
    assert.equal(material.normalScale.x, binding.normalScale ?? 1, alias + ' normal scale');
    assert.equal(material.side, binding.doubleSided || SWAYING.includes(alias) ? THREE.DoubleSide : THREE.FrontSide, alias + ' sidedness');
    assert.equal(material.vertexColors, true, alias + ' keeps the vertex weathering');
    assert.equal(material.emissive.getHex(), 0x000000, alias + ' adds no emissive glow');
  }
  // The lilac shore bell and the grove's own bell are tinted alike by contract,
  // so identity - not colour - proves the aliases own independent clones.
  assert.deepEqual(ISLAND_GROUND_BINDINGS.shore_lilac.color, MOONWATCH_MATERIAL_BINDINGS.moonbell.color);
  assert.notEqual(materialOf('shore_lilac'), materialOf('moon_bell'), 'the shore lilac owns a clone of its own');
  assert.notEqual(materialOf('shore_lilac'), materialOf('shore_coral'));
  for (const pair of [['haven_grass', 'beach_grass'], ['jungle_grass', 'moon_grass'], ['jungle_fern', 'moon_fern']]) {
    assert.notEqual(materialOf(pair[0]), materialOf(pair[1]), pair.join(' vs ') + ' are independent clones of one source');
    assert.notDeepEqual(rgb(materialOf(pair[0]).color), rgb(materialOf(pair[1]).color), pair.join(' vs ') + ' are tinted apart');
  }
  // The beacon stones install the island's own bound surf boulder rather than a
  // second clone, so nothing tints an already-tinted clone twice.
  const coastRock = live.scene.getObjectByName('island-coast-rock-' + live.rockSites[0].id);
  let coastStone = null; coastRock.traverse(object => { if (object.isMesh) coastStone = object.material; });
  assert.equal(materialOf('beacon_stone'), coastStone, 'the beacon stone reuses the coast limestone clone, never a retint');
  assert.deepEqual(rgb(materialOf('beacon_stone').color), ISLAND_MATERIAL_BINDINGS.coast_stone.color.map(value => Number(value.toFixed(6))));
  // Nothing borrowed is mutated by any of it.
  for (const material of kitOriginals) assert.equal(material.color.getHex(), 0xffffff, material.name + ' kit original keeps its albedo');
  for (const material of sharedOriginals) {
    assert.equal(material.color.getHex(), 0xffffff, material.name + ' shared source keeps its albedo');
    assert.equal(material.normalScale.x, 1, material.name + ' shared source keeps its normal scale');
    assert.equal(material.side, THREE.FrontSide, material.name + ' shared source keeps its sidedness');
  }
  // Stats: the shipped keys are preserved and the ground adds exactly five.
  const stats = live.island.getStats();
  assert.deepEqual(Object.keys(stats), ['status', 'ready', 'loading', 'fallback', 'error', 'windValue',
    'prefabs', 'palms', 'collidablePalms', 'rocks', 'skiffs', 'canopyMeshes', 'cellSize',
    'landmarks', 'landmarkMeshes', 'landmarkCounts', 'landmarkCellSize',
    'canopyPlacements', 'canopyCounts', 'wildCanopyMeshes', 'canopyCellSize', 'rockDetailCellSize',
    'groundPlacements', 'groundCounts', 'groundDetailMeshes', 'groundStoneMeshes', 'groundCellSize', 'visibleDetailMeshes']);
  assert.equal(stats.groundPlacements, 316); assert.equal(stats.groundPlacements, live.groundSites.length);
  assert.deepEqual(stats.groundCounts, ISLAND_GROUND_COUNTS);
  assert.equal(stats.groundDetailMeshes, detailMeshes); assert.equal(stats.groundStoneMeshes, stoneMeshes);
  assert.equal(stats.groundCellSize, GROUND_CELL);
  assert.equal(stats.palms, 38); assert.equal(stats.rocks, 4); assert.equal(stats.landmarks, ISLAND_LANDMARK_TOTAL);
  assert.equal(stats.canopyPlacements, ISLAND_CANOPY_TOTAL);
  live.island.dispose();
  assert.equal(live.groundFallback.visible, true, 'disposal brings the ground cover back');
  assert.equal(groundMeshesOf(live.scene).length, 0);
});

test('a ground descriptor installs its whole XYZ rotation, not the yaw the shipped sites happen to carry', () => {
  // Every recorded ground site turns on its yaw alone, so a runtime that quietly
  // dropped the pitch and roll would still reproduce all 316 shipped transforms.
  // This synthetic descriptor leans on all three axes and scales non-uniformly:
  // only the complete Euler, the non-uniform scale and the source child's own
  // matrix together can produce the instance it installs.
  const fixture = fixtures();
  const rotation = [.37, 1.21, -.58], scale = [1.4, .55, .9];
  const site = { id: 'ground-tilt-probe', kind: 'havenPlants', region: 'haven', prefab: 'haven_grass',
    x: 21.5, y: 4.25, z: -37.25, rotation, scale, index: 0, size: .5, buds: false };
  const kit = buildIslandKit(fixture.kit, fixture.shared, { groundSites: [site] });
  try {
    const meshes = [];
    kit.group.traverse(object => { if (object.isInstancedMesh && object.userData.groundPrefab === 'haven_grass') meshes.push(object); });
    assert.equal(meshes.length, 1, 'the probe stages one batch');
    const mesh = meshes[0];
    assert.equal(mesh.name, 'island-ground-haven_grass-1:-3', 'the probe lands in its own 16 m cell');
    assert.deepEqual(kit.counts.groundCounts, { havenPlants: 1 });
    assert.equal(kit.counts.groundPlacements, 1);
    assert.equal(kit.counts.groundDetailMeshes, 1); assert.equal(kit.counts.groundStoneMeshes, 0);
    const child = fixture.shared.scene.getObjectByName('grass_clump').children[0];
    child.updateMatrixWorld(true);
    assert.equal(child.matrix.equals(new THREE.Matrix4()), false, 'the source child is offset, turned and squashed inside its root');
    // The expected instance, composed independently: the descriptor's own
    // position on the resampled seat, the full Euler and the non-uniform scale,
    // with the source child matrix composed in on the right.
    const seat = renderedHeightAt(site.x, site.z) + .015;
    const expected = new THREE.Matrix4().multiplyMatrices(siteMatrix(site, seat), child.matrix);
    const actual = new THREE.Matrix4(); mesh.getMatrixAt(0, actual);
    assertMatrix(actual, expected, site.id);
    // Each way of losing part of that transform produces a visibly different
    // instance, so the comparison above cannot be satisfied by a runtime that
    // keeps only the yaw, only a uniform scale, or only the descriptor itself.
    const variants = [
      ['yaw-only', new THREE.Matrix4().multiplyMatrices(siteMatrix({ ...site, rotation: [0, rotation[1], 0] }, seat), child.matrix)],
      ['pitch-and-roll-swapped', new THREE.Matrix4().multiplyMatrices(siteMatrix({ ...site, rotation: [rotation[2], rotation[1], rotation[0]] }, seat), child.matrix)],
      ['uniform-scale', new THREE.Matrix4().multiplyMatrices(siteMatrix({ ...site, scale: [scale[0], scale[0], scale[0]] }, seat), child.matrix)],
      ['child-less', siteMatrix(site, seat)],
    ];
    for (const [label, other] of variants) {
      const drift = Math.max(...expected.elements.map((value, index) => Math.abs(value - other.elements[index])));
      assert.ok(drift > .05, label + ' would be a visibly different instance: ' + drift.toFixed(4));
      assert.throws(() => assertMatrix(actual, other, label), /element/, 'the installed matrix is not the ' + label + ' composition');
    }
    // The whole lean survives the round trip: decomposing the instance against
    // the source child's own matrix returns the descriptor's three rotations and
    // its three separate scale factors.
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), decomposed = new THREE.Vector3();
    new THREE.Matrix4().multiplyMatrices(actual, child.matrix.clone().invert()).decompose(position, quaternion, decomposed);
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    for (const [axis, index] of [['x', 0], ['y', 1], ['z', 2]]) {
      near(euler[axis], rotation[index], 1e-5, site.id + ' keeps its ' + axis + ' rotation');
      near(decomposed[axis], scale[index], 1e-5, site.id + ' keeps its ' + axis + ' scale');
    }
    near(position.y, seat, 1e-4, site.id + ' sits on the resampled seat');
  } finally {
    disposeOwnedResources(kit.ownedRoots, [fixture.kit.scene, fixture.shared.scene]);
  }
});

test('the ground counts what it actually staged and sways from the soil, thinning only its own detail', async () => {
  // Counts derive from the descriptors staged, not from the shipped card: a
  // partial build reports the partial inventory.
  const partialFixture = fixtures(), built = await recorded();
  const slice = built.sites.filter(site => site.kind === 'havenPlants' || site.kind === 'beaconStones');
  const partial = buildIslandKit(partialFixture.kit, partialFixture.shared, { groundSites: slice, canopyKits: partialFixture.canopyKits });
  assert.deepEqual(partial.counts.groundCounts, { havenPlants: 34, beaconStones: 4 });
  assert.equal(partial.counts.groundPlacements, 38);
  assert.equal(partial.counts.groundDetailMeshes, cellsOf(slice.filter(site => site.kind === 'havenPlants')).size);
  assert.equal(partial.counts.groundStoneMeshes, cellsOf(slice.filter(site => site.kind === 'beaconStones')).size);
  disposeOwnedResources(partial.ownedRoots, [partialFixture.kit.scene, partialFixture.shared.scene]);

  const fixture = fixtures();
  const live = await harness(async url => fixture.byURL[url]);
  assert.equal(await live.island.ready, true);
  const meshes = groundMeshesOf(live.scene);
  const detail = meshes.filter(mesh => mesh.userData.detailKind === 'ground');
  const stones = meshes.filter(mesh => mesh.userData.groundPrefab === 'beacon_stone');
  const skyline = [];
  live.scene.traverse(object => { if (object.isInstancedMesh && (object.userData.canopyPrefab || object.userData.landmarkPrefab || object.userData.detailKind === 'palm')) skyline.push(object); });
  assert.ok(skyline.length > 0 && stones.length === 2 && detail.length === 172);
  live.island.animate(20, {});
  assert.equal(live.island.getStats().windValue, 16);
  // Only the nine foliage aliases move, on the island's single wind uniform, and
  // they bend from the soil rather than from the canopy's three-metre crown line.
  const shaders = new Map();
  for (const mesh of meshes) {
    if (shaders.has(mesh.material)) continue;
    const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' };
    mesh.material.onBeforeCompile?.(shader); shaders.set(mesh.material, shader);
  }
  const swaying = new Set(), rigid = new Set();
  for (const mesh of meshes) (shaders.get(mesh.material).uniforms.islandWind ? swaying : rigid).add(mesh.userData.groundPrefab);
  assert.deepEqual([...swaying].sort(), [...SWAYING].sort(), 'exactly the nine foliage aliases sway');
  assert.deepEqual([...rigid].sort(), [...RIGID].sort(), 'scorched cinder and the beacon stones stay rigid');
  for (const alias of SWAYING) {
    const mesh = meshes.find(candidate => candidate.userData.groundPrefab === alias);
    const shader = shaders.get(mesh.material);
    assert.equal(shader.uniforms.islandWind.value, 16, alias + ' reads the shared island wind');
    assert.ok(shader.vertexShader.includes('pow(max(position.y, 0.0), 2.0) * .035'), alias + ' bends from its own base');
    assert.equal(shader.vertexShader.includes('max(position.y - 3.0, 0.0)'), false, alias + ' does not use the canopy crown hook');
    assert.equal(mesh.material.customProgramCacheKey(), 'island-ground-wind-v1', alias + ' keeps its own stable program key');
  }
  // One island wind uniform drives the coast fronds and the ground together.
  let coastFrond = null;
  live.scene.traverse(object => { if (object.isInstancedMesh && object.userData.detailKind === 'palm' && object.material.name === 'coast_frond') coastFrond = object.material; });
  const coastShader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; coastFrond.onBeforeCompile(coastShader);
  const groundShader = shaders.get(detail.find(mesh => mesh.userData.groundPrefab === 'haven_grass').material);
  assert.equal(coastShader.uniforms.islandWind, groundShader.uniforms.islandWind, 'one island wind uniform, not one per slice');
  assert.notEqual(coastFrond.customProgramCacheKey(), 'island-ground-wind-v1', 'the crown hook keeps its own program key');
  // The detail policy, on its exact boundaries: a cell draws within 105 m of the
  // player (65 m at low quality) and thins to 65 % beyond 65 m, 42 % at low.
  const probe = detail.find(mesh => mesh.userData.fullCount > 3) ?? detail[0];
  const centre = probe.userData.cellCenter, full = probe.userData.fullCount;
  const at = (distance, options = {}) => { live.island.animate(1, { player: { x: centre.x + distance, z: centre.z }, ...options }); };
  at(0); assert.equal(probe.visible, true); assert.equal(probe.count, full, 'a cell under the player draws every clump');
  at(65); assert.equal(probe.visible, true); assert.equal(probe.count, full, '65 m is inside the near band, not beyond it');
  at(65.0001); assert.equal(probe.count, Math.max(1, Math.floor(full * .65)), 'beyond 65 m a cell thins to 65 %');
  at(104.9999); assert.equal(probe.visible, true, 'a cell draws right up to 105 m');
  at(105); assert.equal(probe.visible, false, '105 m is the strict hiding boundary');
  at(64.9999, { lowQuality: true }); assert.equal(probe.visible, true);
  assert.equal(probe.count, Math.max(1, Math.floor(full * .42)), 'low quality keeps 42 % of each cell');
  at(65, { lowQuality: true }); assert.equal(probe.visible, false, '65 m is the strict low-quality hiding boundary');
  for (const mesh of detail) assert.equal(mesh.count >= 1, true, mesh.name + ' never thins a singleton away');
  // With no player the ground parks hidden, and coming near restores every cell.
  live.island.animate(2, {});
  for (const mesh of detail) assert.equal(mesh.visible, false, mesh.name + ' is hidden while no player is placed');
  assert.equal(live.island.getStats().visibleDetailMeshes, 0);
  let restored = 0;
  for (const mesh of detail) {
    live.island.animate(3, { player: { x: mesh.userData.cellCenter.x, z: mesh.userData.cellCenter.z } });
    assert.equal(mesh.visible, true, mesh.name + ' comes back when the player walks up');
    assert.equal(mesh.count, mesh.userData.fullCount, mesh.name + ' restores its full density');
    restored++;
  }
  assert.equal(restored, 172);
  live.island.animate(4, { player: { x: detail[0].userData.cellCenter.x, z: detail[0].userData.cellCenter.z } });
  assert.equal(live.island.getStats().visibleDetailMeshes, detail.filter(mesh => mesh.visible).length);
  assert.ok(live.island.getStats().visibleDetailMeshes >= 1);
  // The stones are skyline inside the finale arena, and the canopy, shrines and
  // palms never enter the thinning loop at all.
  live.island.animate(30, { player: { x: -420, z: -420 }, lowQuality: true, reducedMotion: true });
  assert.equal(live.island.getStats().windValue, 0, 'reduced motion parks the wind');
  for (const mesh of [...stones, ...skyline]) {
    assert.equal(mesh.visible, true, mesh.name + ' is never distance-hidden');
    assert.equal(mesh.count, mesh.userData.fullCount, mesh.name + ' is never thinned');
  }
  for (const mesh of stones) assert.equal(mesh.castShadow, true, mesh.name + ' still casts its arena shadow');
  live.island.dispose();
});

test('a ground build leases only the resident kits its own aliases name', async () => {
  const built = await recorded();
  assert.deepEqual(islandGroundKits([]), []);
  assert.deepEqual(islandGroundKits(built.sites), ['moon', 'volcano'], 'the shipped ground needs the grove and the forge only');
  assert.deepEqual(islandGroundKits([{ prefab: 'haven_grass' }, { prefab: 'beacon_stone' }]), [], 'shared and island roots need no resident lease');
  assert.deepEqual(islandGroundKits([{ prefab: 'volcano_cinder' }, { prefab: 'moon_bell' }]), ['moon', 'volcano'], 'the canopy order is kept');
  assert.deepEqual(islandGroundKits([{ prefab: 'nonesuch' }]), [], 'an unknown alias leases nothing');
  const leaseShape = async (options) => {
    const fixture = fixtures(), loads = [];
    const scene = new THREE.Scene(), settlements = buildSettlements(makePalette());
    const island = createIsland({ scene, settlements, palmSites: built.built.coastPalmSites, rockSites: built.built.coastRockSites,
      landmarkSites: built.built.landmarkSites, load: async url => { loads.push(url); return fixture.byURL[url]; }, ...options });
    assert.equal(await island.ready, true);
    const stats = island.getStats(); island.dispose();
    return { loads, stats };
  };
  // The shipped island: five leases, the shared library and the island kit first.
  const whole = await leaseShape({ canopySites: built.built.canopySites, groundSites: built.sites });
  assert.deepEqual(whole.loads, KIT_URLS, 'the whole island still leases exactly the five shipped kits, in order');
  // Ground without canopy derives its dependencies from the aliases alone.
  const groundOnly = await leaseShape({ groundSites: built.sites });
  assert.deepEqual(groundOnly.loads, [SHARED_URL, ISLAND_URL, MOON_URL, VOLCANO_URL], 'a ground-only build skips the camp kit');
  assert.equal(groundOnly.stats.groundPlacements, 316);
  assert.equal(groundOnly.stats.canopyPlacements, undefined, 'a ground-only build reports no canopy stats');
  // A haven-and-beacon build touches no resident kit at all.
  const shallow = await leaseShape({ groundSites: built.sites.filter(site => site.kind === 'havenPlants' || site.kind === 'beaconStones') });
  assert.deepEqual(shallow.loads, [SHARED_URL, ISLAND_URL], 'shared grass and the island boulder need no resident payload');
  assert.equal(shallow.stats.groundPlacements, 38);
  // A caller with neither canopy nor ground keeps the exact shipped stat set.
  const legacy = await leaseShape({});
  assert.deepEqual(legacy.loads, [SHARED_URL, ISLAND_URL]);
  assert.deepEqual(Object.keys(legacy.stats), ['status', 'ready', 'loading', 'fallback', 'error', 'windValue',
    'prefabs', 'palms', 'collidablePalms', 'rocks', 'skiffs', 'canopyMeshes', 'cellSize',
    'landmarks', 'landmarkMeshes', 'landmarkCounts', 'landmarkCellSize', 'visibleDetailMeshes'],
    'the pre-ground stats shape is unchanged for focused callers');
  const canopyOnly = await leaseShape({ canopySites: built.built.canopySites });
  for (const key of ['groundPlacements', 'groundCounts', 'groundDetailMeshes', 'groundStoneMeshes', 'groundCellSize']) {
    assert.equal(canopyOnly.stats[key], undefined, key + ' is absent without ground sites');
    assert.equal(legacy.stats[key], undefined, key + ' is absent for pre-ground callers');
  }
});

test('a malformed ground source, slot or descriptor fails before anything is installed and releases every clone', async () => {
  const built = await recorded();
  const base = { palmSites: built.built.coastPalmSites, rockSites: built.built.coastRockSites,
    landmarkSites: built.built.landmarkSites, canopySites: built.built.canopySites, groundSites: built.sites };
  const build = (fixture, options = {}) => buildIslandKit(fixture.kit, fixture.shared, { ...base, canopyKits: fixture.canopyKits, ...options });
  const bad = (patch, pattern) => {
    const fixture = fixtures();
    assert.throws(() => build(fixture, { groundSites: [...built.sites, { ...built.sites[0], ...patch }] }), pattern);
  };
  bad({ id: 'stray', prefab: 'meadow_moss' }, /Island ground prefab is missing: meadow_moss/);
  bad({ id: 'bent', rotation: [0, Number.NaN, 0] }, /Island ground site is malformed: bent/);
  bad({ id: 'flat', scale: [1, 1] }, /Island ground site is malformed: flat/);
  bad({ id: 'short', rotation: [0, 0] }, /Island ground site is malformed: short/);
  bad({ id: 'nowhere', x: Number.POSITIVE_INFINITY }, /Island ground site is malformed: nowhere/);
  bad({ id: 'collapsed', scale: [1, 0, 1] }, /Island ground site is malformed: collapsed/);
  bad({ id: 'inverted', scale: [1, -1, 1] }, /Island ground site is malformed: inverted/);
  // Each resident kit a staged alias names is required whole.
  for (const key of ['moon', 'volcano']) {
    const absent = fixtures();
    assert.throws(() => build(absent, { canopySites: [], canopyKits: { ...absent.canopyKits, [key]: undefined } }),
      new RegExp('Island (ground|canopy) kit is missing: ' + key));
  }
  // A root that is gone, emptied, renamed or regrown fails the build rather than
  // being repainted in a recipe that was never written for it.
  const hollowShared = fixtures();
  hollowShared.shared.scene.getObjectByName('grass_clump').clear();
  assert.throws(() => build(hollowShared), /Island ground kit is missing or empty: (haven|beach|jungle|moon)_grass/);
  const noFern = fixtures();
  noFern.shared.scene.remove(noFern.shared.scene.getObjectByName('fern_clump'));
  assert.throws(() => build(noFern), /Island ground kit is missing or empty: (jungle|moon)_fern/);
  const hollowResident = fixtures();
  hollowResident.canopyKits.volcano.scene.getObjectByName('cinder_clump').clear();
  assert.throws(() => build(hollowResident), /Island ground kit is missing or empty: volcano_cinder/);
  const renamed = fixtures();
  renamed.canopyKits.volcano.scene.getObjectByName('cinder_clump').children[0].material.name = 'external_ash';
  assert.throws(() => build(renamed), /Island ground source slot is unexpected: volcano_cinder carries external_ash instead of scoria/);
  const regrown = fixtures();
  const bell = regrown.canopyKits.moon.scene.getObjectByName('moonbell_clump');
  const extra = new THREE.MeshStandardMaterial(); extra.name = 'moon_glass';
  bell.add(new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), extra));
  assert.throws(() => build(regrown), /Island ground source slot is unexpected: (moon_bell|shore_coral|shore_lilac) carries moon_glass instead of moonbell/);
  // Every shared source the ground leans on - the foliage blade and the mottled
  // stone - is one an island slot already needs, so a half-loaded library is
  // caught by the island's own validation before anything ground-side is staged.
  for (const [source, slot] of [['needle_foliage', 'coast_frond'], ['watch_stone', 'coast_stone']]) {
    assert.ok(Object.values(ISLAND_GROUND_BINDINGS).some(binding => binding.source === source), source + ' dresses a ground alias');
    assert.equal(ISLAND_MATERIAL_BINDINGS[slot].source, source, slot + ' already needs it');
    const unbound = fixtures();
    unbound.shared.scene.remove(unbound.shared.scene.getObjectByName('material-' + source));
    for (const root of Object.keys(SHARED_ROOT_SLOTS)) unbound.shared.scene.remove(unbound.shared.scene.getObjectByName(root));
    assert.throws(() => build(unbound), new RegExp('Island material binding is missing: ' + slot));
  }
  // A failure part-way through staging releases every material it had cloned and
  // leaves the borrowed kits and shared sources untouched.
  const staged = fixtures(), counts = disposalProbe(staged), tally = cloneProbe(staged);
  staged.canopyKits.moon.scene.getObjectByName('moonbell_clump').clone = () => { throw new Error('ground staging interrupted'); };
  assert.throws(() => build(staged), /ground staging interrupted/);
  assert.ok(tally.cloned > 0); assert.equal(tally.released, tally.cloned, 'every clone made before the failure is released');
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 }, 'the borrowed sources are left alone');
  disposeOwnedResources([staged.kit.scene, staged.shared.scene, ...Object.values(staged.canopyKits).map(kit => kit.scene)]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('every ground failure and disposal path restores all four fallbacks and the original skiffs', async () => {
  // Any of the five kit URLs failing leaves every original batch standing.
  for (const failing of KIT_URLS) {
    const fixture = fixtures();
    const cache = createEnvironmentAssets({ load: async url => { if (url === failing) throw new Error('kit offline: ' + url); return fixture.byURL[url]; } });
    const live = await harness(undefined, cache);
    assert.equal(await live.island.ready, false, failing + ' fails the install');
    const stats = live.island.getStats();
    assert.equal(stats.status, 'fallback'); assert.equal(stats.groundPlacements, undefined);
    assert.match(stats.error, new RegExp('kit offline: ' + failing));
    for (const parent of [live.legacyScenery, live.landmarkFallback, live.canopyFallback, live.groundFallback]) {
      assert.equal(parent.visible, true, failing + ' keeps ' + parent.name + ' lit');
    }
    assert.equal(live.scene.getObjectByName('island-coast-environment'), undefined);
    assert.equal(groundMeshesOf(live.scene).length, 0);
    for (const boat of live.settlements.group.userData.skiffs) {
      assert.equal(boat.original.visible, true); assert.deepEqual(boat.group.children, [boat.original]);
    }
    assert.equal(cache.getStats().leases, 0, failing + ' releases every lease');
    live.island.dispose(); cache.dispose();
  }
  // A ground root that only goes missing after the kits have loaded is a staging
  // failure, and it restores exactly the same four batches.
  const missing = fixtures();
  missing.canopyKits.moon.scene.getObjectByName('moonbell_clump').clear();
  const postLoad = await harness(async url => missing.byURL[url], undefined, { canopy: false });
  assert.equal(await postLoad.island.ready, false);
  assert.match(postLoad.island.getStats().error, /Island ground kit is missing or empty: (moon_bell|shore_coral|shore_lilac)/);
  for (const parent of [postLoad.legacyScenery, postLoad.landmarkFallback, postLoad.canopyFallback, postLoad.groundFallback]) {
    assert.equal(parent.visible, true, parent.name + ' survives a post-load ground failure');
  }
  assert.equal(groundMeshesOf(postLoad.scene).length, 0);
  postLoad.island.dispose();
  // The same for a slot that is renamed only in the delivered kit.
  const slotless = fixtures();
  slotless.canopyKits.volcano.scene.getObjectByName('cinder_clump').children[0].material.name = 'ash_drift';
  const renamed = await harness(async url => slotless.byURL[url], undefined, { canopy: false });
  assert.equal(await renamed.island.ready, false);
  assert.match(renamed.island.getStats().error, /Island ground source slot is unexpected: volcano_cinder carries ash_drift instead of scoria/);
  assert.equal(renamed.groundFallback.visible, true); renamed.island.dispose();
  // A scene that refuses the group, and a settlement hook that throws on install
  // and again on rollback, both leave all four originals and the hulls standing.
  const refusing = fixtures();
  const blocked = await harness(async url => refusing.byURL[url]);
  const add = blocked.scene.add.bind(blocked.scene);
  blocked.scene.add = object => { if (object.name === 'island-coast-environment') throw new Error('scene refused the island'); return add(object); };
  assert.equal(await blocked.island.ready, false);
  assert.match(blocked.island.getStats().error, /scene refused the island/);
  for (const parent of [blocked.legacyScenery, blocked.landmarkFallback, blocked.canopyFallback, blocked.groundFallback]) assert.equal(parent.visible, true);
  assert.equal(groundMeshesOf(blocked.scene).length, 0); blocked.island.dispose();
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = await harness(async url => rollbackFixture.byURL[url]);
  const install = rollback.settlements.setIslandKit;
  rollback.settlements.setIslandKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.island.ready, false);
  assert.match(rollback.island.getStats().error, /install failed; Fallback restore: rollback failed/);
  for (const parent of [rollback.legacyScenery, rollback.landmarkFallback, rollback.canopyFallback, rollback.groundFallback]) assert.equal(parent.visible, true);
  assert.equal(groundMeshesOf(rollback.scene).length, 0);
  rollback.island.dispose();
  assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  // Disposing before the load lands installs nothing and still retires the kits.
  const lateFixture = fixtures(), lateCounts = disposalProbe(lateFixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const late = await harness(url => url === MOON_URL ? pending : lateFixture.byURL[url]);
  late.island.dispose(); late.island.dispose(); deliver(lateFixture.canopyKits.moon);
  assert.equal(await late.island.ready, false);
  assert.equal(late.scene.getObjectByName('island-coast-environment'), undefined);
  assert.equal(late.groundFallback.visible, true, 'a disposed island leaves the ground cover lit');
  assert.equal(groundMeshesOf(late.scene).length, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 }, 'the late kit is retired');
  // Another holder of the same kits keeps every lease alive, so disposing the
  // island touches only what it owns: every clone exactly once, nothing borrowed.
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
  assert.equal(cache.getStats().leases, 5, 'a disposed island releases only its own five leases, once');
  assert.equal(tally.released, tally.cloned, 'every owned clone is disposed exactly once');
  assert.deepEqual(ownedCounts, { geometry: 0, material: 0, texture: 0, bitmap: 0 }, 'the borrowed kits are never disposed');
  assert.equal(releasedGeometry, 0, 'not one borrowed clump geometry is disposed with the island');
  for (const material of ownedFixture.slotMaterials.values()) assert.equal(material.color.getHex(), 0xffffff, material.name + ' survives unmutated');
  for (const lease of residents) lease.release();
  assert.deepEqual(ownedCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 }, 'the last release retires the kits');
  assert.equal(releasedGeometry, ownedFixture.geometries.length, 'the last release retires every source geometry');
  cache.dispose();
});

after(() => {
  if (!cachedScenery) return;
  disposeOwnedResources(cachedScenery.built.group);
  for (const geometry of Object.values(cachedScenery.palette.geometry)) geometry.dispose();
});
