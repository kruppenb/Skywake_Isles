import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { REGIONS, OBSTACLES, SHRINES, SPAWN, BEACON, CHESTS, heightAt, regionAt, seededRandom, SEED } from '../shared/world.js';
import { POINTS_OF_INTEREST, BUILDINGS, RESIDENTS, buildingLocalPoint, trailDistance } from '../shared/exploration.js';
import { ENCOUNTER_GROUPS } from '../shared/encounters.js';
import { CAPTAINS_HOUSE } from '../shared/captains-house.js';
import { AIRSHIP_RETURNS, RETURN_RANGE } from '../shared/airship.js';
import { DIVE_ENTRANCE } from '../shared/underwater.js';
import { oldWatchWeight } from '../shared/old-watch.js';
import { windwardFarmWeight } from '../shared/windward-farm.js';
import { tideglassWeight } from '../shared/tideglass-market.js';
import { saltwindHarborWeight } from '../shared/saltwind-harbor.js';
import { driftwoodWeight } from '../shared/driftwood-yard.js';
import { palmheartWeight } from '../shared/palmheart-camp.js';
import { cinderworksWeight } from '../shared/cinderworks.js';
import { moonwatchWeight } from '../shared/moonwatch.js';
import { ISLAND_LANDMARK_NOMINALS, ISLAND_GROUND_NOMINALS } from '../shared/island.js';
import { ISLAND_UNDERSTORY_SEED, ISLAND_UNDERSTORY_TARGETS, ISLAND_UNDERSTORY_COUNTS, ISLAND_UNDERSTORY_TOTAL,
  islandUnderstorySites, islandUnderstoryClearance, islandAreaWeight, islandLandmarkClearance } from '../shared/island-understory.js';
import { ISLAND_PREFABS, ISLAND_MATERIAL_BINDINGS, ISLAND_GROUND_SOURCES, ISLAND_GROUND_BINDINGS, ISLAND_CANOPY_SOURCES,
  ISLAND_CANOPY_KIT_URLS, buildIslandKit, createIsland } from '../client/island.js';
import { MOONWATCH_MATERIAL_BINDINGS } from '../client/moonwatch.js';
import { CINDERWORKS_MATERIAL_BINDINGS } from '../client/cinderworks.js';
import { PALMHEART_MATERIAL_BINDINGS } from '../client/palmheart-camp.js';
import { createEnvironmentAssets } from '../client/environment-assets.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const SHARED_URL = '/assets/old-watch/kit.glb', ISLAND_URL = '/assets/island/kit.glb';
const JUNGLE_URL = '/assets/palmheart-camp/kit.glb', MOON_URL = '/assets/moonwatch/kit.glb', VOLCANO_URL = '/assets/cinderworks/kit.glb';
const KIT_URLS = [SHARED_URL, ISLAND_URL, JUNGLE_URL, MOON_URL, VOLCANO_URL];
const PALM_CELL = 64, GROUND_CELL = 16;
const CANOPY_KINDS = ['jungleTrees', 'junglePalms', 'moonTrees', 'moonMushrooms', 'volcanoPebbles', 'volcanoCrystals'];
const PALM_KINDS = ['havenPalms', 'beachPalms'];
const TRUNK_KINDS = ['jungleTrees', 'junglePalms', 'moonTrees', ...PALM_KINDS];
// The species each region's card may plant, read straight off the palette.
const REGION_PREFABS = {
  haven: ['coast_palm_a', 'coast_palm_b', 'haven_grass', 'haven_fern'],
  beach: ['coast_palm_a', 'coast_palm_b', 'beach_grass'],
  jungle: ['jungle_tree_a', 'jungle_tree_b', 'jungle_palm', 'jungle_fern', 'jungle_grass'],
  moon: ['silver_tree_a', 'silver_tree_b', 'moon_mushroom', 'moon_bell', 'moon_fern', 'moon_grass'],
  volcano: ['basalt_boulder_a', 'basalt_boulder_b', 'ember_crystal', 'volcano_cinder', 'volcano_grass'],
};

// --------------------------------------------------------------------------
// The recorded original scenery the world hands the pass: the wild canopy and
// the coast palms it keeps its trunks clear of, and the landmark sites its
// analytic clearance has to agree with.
let cachedScenery = null;
async function recorded() {
  if (!cachedScenery) {
    const { buildScenery } = await import('../client/world.js');
    const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random();
    const built = buildScenery(makePalette(), random);
    cachedScenery = { built, avoid: [...built.canopySites, ...built.coastPalmSites],
      sites: islandUnderstorySites({ avoid: [...built.canopySites, ...built.coastPalmSites] }) };
  }
  return cachedScenery;
}
const distance = (site, point) => Math.hypot(site.x - point.x, site.z - point.z);
function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}
const counted = sites => {
  const counts = {};
  for (const site of sites) counts[site.kind] = (counts[site.kind] ?? 0) + 1;
  return counts;
};

// --------------------------------------------------------------------------
// The same synthetic kits the ground and canopy tests stage: every island root
// with the slot it is authored in, the resident roots the understory borrows
// and the two shared clumps.
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
function childMesh(name, slot, index, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.2, .5, .2), material); mesh.name = name + '-' + slot;
  mesh.position.set(.13 * (index + 1), .27 * (index + 1), -.09 * (index + 1));
  mesh.rotation.set(.11, .23 * (index + 1), -.07); mesh.scale.set(1 + .1 * index, .85, 1.2);
  return mesh;
}
function kitScene(roots) {
  const scene = new THREE.Group();
  for (const [name, slots] of Object.entries(roots)) {
    const root = new THREE.Group(); root.name = name;
    slots.forEach((slot, index) => { const material = new THREE.MeshStandardMaterial(); material.name = slot; root.add(childMesh(name, slot, index, material)); });
    scene.add(root);
  }
  return { scene };
}
function fixtures() {
  const materials = new Map(), shared = { scene: new THREE.Group() };
  const dictionaries = [ISLAND_MATERIAL_BINDINGS, PALMHEART_MATERIAL_BINDINGS, MOONWATCH_MATERIAL_BINDINGS, CINDERWORKS_MATERIAL_BINDINGS, ISLAND_GROUND_BINDINGS];
  for (const name of new Set(dictionaries.flatMap(entry => Object.values(entry).map(binding => binding.source)))) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.2, .5, .2), material); mesh.name = 'material-' + name; shared.scene.add(mesh);
  }
  for (const [name, slot] of Object.entries(SHARED_ROOT_SLOTS)) {
    const root = new THREE.Group(); root.name = name; root.add(childMesh(name, slot, 0, materials.get(slot))); shared.scene.add(root);
  }
  const kit = kitScene(ISLAND_ROOT_SLOTS);
  const canopyKits = Object.fromEntries(Object.entries(RESIDENT_ROOT_SLOTS).map(([key, roots]) => [key, kitScene(roots)]));
  const byURL = { [SHARED_URL]: shared, [ISLAND_URL]: kit, [JUNGLE_URL]: canopyKits.jungle, [MOON_URL]: canopyKits.moon, [VOLCANO_URL]: canopyKits.volcano };
  return { shared, kit, canopyKits, byURL };
}
const fallbackGroup = name => { const group = new THREE.Group(); group.name = name; return group; };
async function harness(load, { understory, canopy = true, ground = true } = {}) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette());
  const legacyScenery = fallbackGroup('island-coast-original-scenery'), landmarkFallback = fallbackGroup('island-shrines-original-scenery');
  const canopyFallback = fallbackGroup('island-canopy-original-scenery'), groundFallback = fallbackGroup('island-ground-original-scenery');
  scene.add(settlements.group, legacyScenery, landmarkFallback, canopyFallback, groundFallback);
  const { built, sites } = await recorded();
  const options = { scene, settlements, legacyScenery, landmarkFallback, canopyFallback, groundFallback, load,
    palmSites: built.coastPalmSites, rockSites: built.coastRockSites, landmarkSites: built.landmarkSites,
    canopySites: canopy ? built.canopySites : [], groundSites: ground ? built.groundSites : [], understorySites: understory ?? sites };
  return { ...options, island: createIsland(options) };
}
const instancedOf = (scene, predicate) => {
  const meshes = [];
  scene.traverse(object => { if (object.isInstancedMesh && predicate(object)) meshes.push(object); });
  return meshes;
};
// A root with several source primitives batches one InstancedMesh per primitive
// per cell under one name, so the placement count is read once per name.
const instances = meshes => {
  const perCell = new Map();
  for (const mesh of meshes) perCell.set(mesh.name, mesh.userData.fullCount);
  return [...perCell.values()].reduce((sum, count) => sum + count, 0);
};

// --------------------------------------------------------------------------
test('the understory inventory is deterministic, matches its card and names only its region\'s own species', async () => {
  const { sites, avoid } = await recorded();
  for (const frozen of [ISLAND_UNDERSTORY_TARGETS, ISLAND_UNDERSTORY_COUNTS, ...Object.values(ISLAND_UNDERSTORY_TARGETS)]) assert.ok(Object.isFrozen(frozen));
  assert.deepEqual(counted(sites), ISLAND_UNDERSTORY_COUNTS, 'the pass plants exactly the shipped inventory');
  assert.equal(sites.length, ISLAND_UNDERSTORY_TOTAL);
  assert.deepEqual(islandUnderstorySites({ avoid }), sites, 'the same seed and the same recorded canopy replay the same pass');
  assert.notDeepEqual(islandUnderstorySites({ avoid, seed: ISLAND_UNDERSTORY_SEED + 1 }), sites, 'the pass is the seed\'s');
  const ids = new Set(sites.map(site => site.id));
  assert.equal(ids.size, sites.length, 'every site carries a unique id');
  assert.ok([...ids].every(id => id.startsWith('understory-')), 'understory ids never collide with the recorded island ids');
  // Every target is met: the island has room for the whole card.
  for (const [region, card] of Object.entries(ISLAND_UNDERSTORY_TARGETS)) {
    const own = sites.filter(site => site.region === region);
    const planted = Object.values(card).reduce((sum, count) => sum + count, 0);
    assert.equal(own.length, planted, region + ' plants its whole card');
    for (const site of own) {
      assert.ok(REGION_PREFABS[region].includes(site.prefab), site.id + ' names a ' + region + ' species: ' + site.prefab);
      assert.equal(regionAt(site.x, site.z)?.id, region, site.id + ' stands in its own region');
    }
  }
  for (const site of sites) {
    assert.ok(Number.isFinite(site.x) && Number.isFinite(site.z) && Number.isFinite(site.yaw ?? site.rotation?.[1]), site.id);
    if (PALM_KINDS.includes(site.kind)) {
      assert.ok(site.size > 0 && site.size <= 1.1 && site.size >= .7, site.id + ' palm size');
      assert.ok(site.prefab === 'coast_palm_a' || site.prefab === 'coast_palm_b');
      continue;
    }
    assert.equal(site.y, heightAt(site.x, site.z), site.id + ' carries the analytic ground');
    assert.deepEqual(site.rotation.slice(0, 1).concat(site.rotation.slice(2)), [0, 0], site.id + ' only yaws');
    assert.ok(site.scale.every(value => value > 0 && value === site.scale[0]), site.id + ' installs uniformly');
    const family = CANOPY_KINDS.includes(site.kind) ? ISLAND_CANOPY_SOURCES : ISLAND_GROUND_SOURCES;
    assert.ok(family[site.prefab], site.id + ' names a root the island kit installs');
  }
  // Ground clumps install in the bands the area kits use, so nothing reads as a
  // giant blade beside a camp's own.
  for (const site of sites.filter(site => ISLAND_GROUND_SOURCES[site.prefab])) {
    assert.ok(site.scale[0] >= .5 && site.scale[0] <= 1.2, site.id + ' clump scale ' + site.scale[0]);
    assert.ok(ISLAND_GROUND_NOMINALS[site.prefab], site.id + ' has a nominal');
  }
});

test('every understory site clears gameplay, the finished areas, the recorded landmarks and every collider', async () => {
  const { sites, built } = await recorded();
  const weights = [oldWatchWeight, windwardFarmWeight, tideglassWeight, saltwindHarborWeight, driftwoodWeight, palmheartWeight, cinderworksWeight, moonwatchWeight];
  const routes = [SPAWN, ...SHRINES].map(point => [BEACON, point]);
  const landmarks = built.landmarkSites.map(site => ({ x: site.x, z: site.z,
    radius: ISLAND_LANDMARK_NOMINALS[site.prefab].radius * Math.max(site.scale[0], site.scale[2]) }));
  const beaconStones = built.groundSites.filter(site => site.kind === 'beaconStones');
  for (const site of sites) {
    const trunk = TRUNK_KINDS.includes(site.kind), tag = site.id;
    assert.ok(Math.hypot(site.x, site.z) <= 124, tag + ' stays on the island');
    assert.ok(heightAt(site.x, site.z) >= (trunk ? 2.4 : 2), tag + ' stands above the wet sand');
    for (const weight of weights) assert.equal(weight(site.x, site.z), 0, tag + ' leaves every finished area its own ground');
    assert.equal(islandAreaWeight(site.x, site.z), 0);
    for (const [a, b] of routes) assert.ok(segmentDistance(site.x, site.z, a, b) >= 6, tag + ' clears the primary routes');
    assert.ok(trailDistance(site.x, site.z) >= 3, tag + ' clears every exploration trail, the captain\'s spur included');
    for (const point of [SPAWN, BEACON, ...SHRINES]) assert.ok(distance(site, point) >= 11, tag + ' clears the landings and shrines');
    for (const place of POINTS_OF_INTEREST) assert.ok(distance(site, place) >= place.radius, tag + ' clears ' + place.id);
    for (const chest of CHESTS) assert.ok(distance(site, chest) >= 3.2, tag + ' clears ' + chest.id);
    for (const group of ENCOUNTER_GROUPS) assert.ok(distance(site, group) >= 8, tag + ' clears the guards at ' + group.id);
    for (const lift of AIRSHIP_RETURNS) assert.ok(distance(site, lift) >= RETURN_RANGE + 2.5, tag + ' clears ' + lift.id);
    assert.ok(distance(site, DIVE_ENTRANCE) >= DIVE_ENTRANCE.range + 2, tag + ' clears the dive');
    assert.ok(Math.abs(site.x - CAPTAINS_HOUSE.x) >= CAPTAINS_HOUSE.width / 2 + 3 || Math.abs(site.z - CAPTAINS_HOUSE.z) >= CAPTAINS_HOUSE.depth / 2 + 5, tag + ' clears the captain\'s house');
    for (const building of BUILDINGS) {
      if (!building.enterable) { assert.ok(distance(site, building) >= building.radius + 2, tag + ' clears ' + building.id); continue; }
      const local = buildingLocalPoint(building, site.x, site.z);
      assert.ok(Math.abs(local.x) >= building.width / 2 + .7 || Math.abs(local.z) >= building.depth / 2 + .7, tag + ' clears ' + building.id);
      assert.ok(Math.abs(local.x) >= building.doorWidth / 2 + .85 || Math.abs(local.z) >= building.depth / 2 + 4, tag + ' clears both doors of ' + building.id);
    }
    for (const person of RESIDENTS) for (let index = 0; index < person.route.length; index++) {
      assert.ok(segmentDistance(site.x, site.z, person.route[index], person.route[(index + 1) % person.route.length]) >= 1.25, tag + ' clears ' + person.id);
    }
    for (const obstacle of OBSTACLES) assert.ok(distance(site, obstacle) >= obstacle.radius + (trunk ? 3 : .3), tag + ' clears collider ' + obstacle.id);
    // The analytic landmark clearance has to agree with the sites the world
    // actually records for the shrines: no clump inside a pillar, a ridge, a
    // grove cap, a ring crystal or the ember core's rock ring.
    for (const landmark of landmarks) assert.ok(distance(site, landmark) >= landmark.radius, tag + ' clears a recorded landmark');
    for (const stone of beaconStones) assert.ok(distance(site, stone) >= .55, tag + ' clears a beacon stone');
    assert.equal(islandLandmarkClearance(site.x, site.z), true);
    assert.equal(islandUnderstoryClearance(site.x, site.z, 0, { canopy: trunk }), true, tag + ' passes its own clearance');
  }
  // The clearance itself rejects what it should.
  assert.equal(islandUnderstoryClearance(NaN, 0), false); assert.equal(islandUnderstoryClearance(0, Infinity), false);
  assert.equal(islandUnderstoryClearance(BEACON.x + 5, BEACON.z), false, 'the beacon dais is never planted');
  assert.equal(islandUnderstoryClearance(SPAWN.x, SPAWN.z + 2), false, 'the landing is never planted');
  assert.equal(islandUnderstoryClearance(-90, 6), false, 'a finished area is never planted twice');
  assert.equal(islandUnderstoryClearance(0, 130), false, 'the sea is never planted');
  assert.equal(islandAreaWeight(-90, 6), palmheartWeight(-90, 6));
  assert.equal(islandLandmarkClearance(SHRINES[0].x, SHRINES[0].z - 11), false, 'the palm gate is cleared');
  assert.equal(islandLandmarkClearance(SHRINES[2].x + 2, SHRINES[2].z - 13), false, 'the moon gate is cleared');
  assert.equal(islandLandmarkClearance(SHRINES[1].x, SHRINES[1].z - 22), false, 'the ember core is cleared');
});

test('new trunks keep their spacing from one another, from the recorded canopy and from every collider', async () => {
  const { sites, avoid } = await recorded();
  const trunks = sites.filter(site => TRUNK_KINDS.includes(site.kind)), caps = sites.filter(site => site.kind === 'moonMushrooms');
  assert.equal(trunks.length, 68); assert.equal(caps.length, 18);
  for (let i = 0; i < trunks.length; i++) for (let j = i + 1; j < trunks.length; j++) {
    assert.ok(distance(trunks[i], trunks[j]) >= 4.5, trunks[i].id + ' and ' + trunks[j].id + ' keep their spacing');
  }
  for (const trunk of trunks) for (const point of avoid) assert.ok(distance(trunk, point) >= 4.5, trunk.id + ' never grows through a recorded tree or palm');
  for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) assert.ok(distance(caps[i], caps[j]) >= 3.5);
    for (const trunk of trunks) assert.ok(distance(caps[i], trunk) >= 2.5, caps[i].id + ' keeps off a trunk');
  }
  const shards = sites.filter(site => site.kind === 'volcanoPebbles' || site.kind === 'volcanoCrystals');
  for (let i = 0; i < shards.length; i++) for (let j = i + 1; j < shards.length; j++) assert.ok(distance(shards[i], shards[j]) >= 3);
  // The jungle keeps the original two-thirds hardwood mix and both crowns.
  const hardwoods = sites.filter(site => site.kind === 'jungleTrees');
  assert.deepEqual([...new Set(hardwoods.map(site => site.prefab))].sort(), ['jungle_tree_a', 'jungle_tree_b']);
  assert.deepEqual([...new Set(sites.filter(site => site.kind === 'moonTrees').map(site => site.prefab))].sort(), ['silver_tree_a', 'silver_tree_b']);
  assert.deepEqual([...new Set(sites.filter(site => PALM_KINDS.includes(site.kind)).map(site => site.prefab))].sort(), ['coast_palm_a', 'coast_palm_b']);
});

test('the runtime installs the understory on the recorded families\' own cells, clones and thinning policy', async () => {
  const fixture = fixtures(), loads = [];
  const live = await harness(async url => { loads.push(url); return fixture.byURL[url]; });
  assert.equal(await live.island.ready, true);
  assert.deepEqual(loads, KIT_URLS, 'the understory adds no lease beyond the five the canopy and ground already hold');
  const stats = live.island.getStats(), { sites, built } = await recorded();
  assert.deepEqual(Object.keys(stats).slice(-6), ['understoryPlacements', 'understoryCounts', 'understoryPalms', 'understoryCanopy', 'understoryGround', 'visibleDetailMeshes']);
  assert.equal(stats.understoryPlacements, ISLAND_UNDERSTORY_TOTAL);
  assert.deepEqual(stats.understoryCounts, ISLAND_UNDERSTORY_COUNTS);
  assert.equal(stats.understoryPalms, 18); assert.equal(stats.understoryCanopy, 94); assert.equal(stats.understoryGround, 1880);
  // The recorded counts are untouched: the understory is reported beside them,
  // never folded into the coast, canopy or ground cards.
  assert.equal(stats.palms, 38); assert.equal(stats.canopyPlacements, built.canopySites.length); assert.equal(stats.groundPlacements, built.groundSites.length);
  // Coast palms: 38 recorded plus 18 understory palms across the two crowns.
  const palms = instancedOf(live.scene, mesh => mesh.userData.detailKind === 'palm');
  assert.equal(instances(palms), 38 + 18);
  for (const mesh of palms) assert.ok(mesh.name.startsWith('island-palm-coast_palm_'));
  // Canopy: every understory tree, mushroom, pebble and crystal joins the wild
  // canopy's own per-prefab cells and never thins or hides.
  const canopy = instancedOf(live.scene, mesh => mesh.userData.canopyPrefab);
  assert.equal(instances(canopy), built.canopySites.length + 94);
  for (const site of sites.filter(site => CANOPY_KINDS.includes(site.kind))) {
    const cell = ISLAND_CANOPY_SOURCES[site.prefab].cell, key = Math.floor(site.x / cell) + ':' + Math.floor(site.z / cell);
    assert.ok(canopy.some(mesh => mesh.name === 'island-canopy-' + site.prefab + '-' + key), site.id + ' lands in its prefab\'s own cell');
  }
  // Ground: every understory clump joins its alias's 16 m cell, with the two
  // understory-only aliases staged on their own clones of the shared source.
  const ground = instancedOf(live.scene, mesh => mesh.userData.groundPrefab);
  assert.equal(instances(ground), built.groundSites.length + 1880);
  for (const alias of ['haven_fern', 'volcano_grass']) {
    const mine = ground.filter(mesh => mesh.userData.groundPrefab === alias);
    assert.ok(mine.length > 0, alias + ' is staged');
    assert.equal(instances(mine), sites.filter(site => site.prefab === alias).length);
    assert.equal(mine[0].material.name, alias); assert.equal(mine[0].userData.detailKind, 'ground');
  }
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (const mesh of ground) {
    const cell = mesh.userData.cellCenter;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
      assert.ok(Math.abs(position.x - cell.x) <= GROUND_CELL / 2 + .5 && Math.abs(position.z - cell.z) <= GROUND_CELL / 2 + .5, mesh.name + ' instance stays in its 16 m cell');
    }
  }
  for (const mesh of palms) {
    const cell = mesh.userData.cellCenter;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
      assert.ok(Math.abs(position.x - cell.x) <= PALM_CELL / 2 + .5 && Math.abs(position.z - cell.z) <= PALM_CELL / 2 + .5, mesh.name + ' palm stays in its 64 m cell');
    }
  }
  // Thinning: the ground detail hides beyond 105 m and thins at low quality; the
  // palms and the canopy never do.
  live.island.animate(10, { player: { x: 0, z: -30 }, lowQuality: true });
  assert.ok(ground.some(mesh => mesh.count < mesh.userData.fullCount), 'low quality thins the understory clumps with the rest');
  assert.ok(ground.some(mesh => !mesh.visible), 'distant understory cells hide');
  for (const mesh of [...palms, ...canopy]) { assert.equal(mesh.visible, true); assert.equal(mesh.count, mesh.userData.fullCount); }
  let lights = 0; live.scene.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'the understory adds no scene light');
  live.island.dispose();
  assert.equal(live.groundFallback.visible, true); assert.equal(live.canopyFallback.visible, true);
});

test('a malformed understory descriptor fails the whole build, leaving every original batch standing', async () => {
  const fixture = fixtures(), { sites } = await recorded();
  for (const [label, bad] of [
    ['an unknown prefab', { ...sites[0], id: 'understory-probe', prefab: 'ghost_fern' }],
    ['a palm without a seat', { id: 'understory-probe', kind: 'havenPalms', region: 'haven', prefab: 'coast_palm_a', x: 0, z: 0, yaw: 0, size: NaN }],
    ['a palm scaled to nothing', { id: 'understory-probe', kind: 'havenPalms', region: 'haven', prefab: 'coast_palm_a', x: 0, z: 0, yaw: 0, size: 0 }],
    ['a canopy site missing its rotation', { ...sites.find(site => site.kind === 'jungleTrees'), id: 'understory-probe', rotation: [0, 0] }],
    ['a ground site scaled to nothing', { ...sites.find(site => site.kind === 'havenGrass'), id: 'understory-probe', scale: [0, 0, 0] }],
  ]) {
    const live = await harness(async url => fixture.byURL[url], { understory: [bad] });
    assert.equal(await live.island.ready, false, label + ' fails the install');
    assert.equal(live.island.getStats().status, 'fallback');
    assert.match(live.island.getStats().error, /understory|malformed/i);
    for (const parent of [live.legacyScenery, live.landmarkFallback, live.canopyFallback, live.groundFallback]) assert.equal(parent.visible, true, label + ' keeps ' + parent.name);
    assert.equal(live.scene.getObjectByName('island-coast-environment'), undefined, label + ' installs nothing');
    live.island.dispose();
  }
  assert.throws(() => buildIslandKit(fixture.kit, fixture.shared, { understorySites: [{ id: 'x', kind: 'havenGrass', prefab: 'nowhere' }] }), /understory prefab is missing/);
});

test('the understory leases only the resident kits its descriptors actually need', async () => {
  const fixture = fixtures(), { sites } = await recorded();
  const shared = sites.filter(site => ['haven_grass', 'haven_fern', 'beach_grass'].includes(site.prefab) || PALM_KINDS.includes(site.kind));
  const lawnLoads = [], lawn = await harness(async url => { lawnLoads.push(url); return fixture.byURL[url]; }, { understory: shared, canopy: false, ground: false });
  assert.equal(await lawn.island.ready, true);
  assert.deepEqual(lawnLoads, [SHARED_URL, ISLAND_URL], 'shared clumps and coast palms lease no resident kit');
  const stats = lawn.island.getStats();
  assert.equal(stats.canopyPlacements, undefined, 'no canopy family means no canopy card');
  assert.equal(stats.groundPlacements, 0, 'the ground card reports the recorded sites, none here, beside the understory clumps');
  assert.equal(stats.understoryPlacements, shared.length);
  lawn.island.dispose();
  const grove = sites.filter(site => site.kind === 'moonBells');
  const groveLoads = [], moon = await harness(async url => { groveLoads.push(url); return fixture.byURL[url]; }, { understory: grove, canopy: false, ground: false });
  assert.equal(await moon.island.ready, true);
  assert.deepEqual(groveLoads, [SHARED_URL, ISLAND_URL, MOON_URL], 'lunar bells lease the observatory kit alone');
  moon.island.dispose();
  const trees = sites.filter(site => site.kind === 'jungleTrees');
  const treeLoads = [], jungle = await harness(async url => { treeLoads.push(url); return fixture.byURL[url]; }, { understory: trees, canopy: false, ground: false });
  assert.equal(await jungle.island.ready, true);
  assert.deepEqual(treeLoads, KIT_URLS, 'a canopy family leases the three resident kits the way the wild canopy does');
  assert.equal(jungle.island.getStats().canopyPlacements, 0); assert.equal(jungle.island.getStats().understoryCanopy, trees.length);
  jungle.island.dispose();
  assert.deepEqual(Object.keys(ISLAND_CANOPY_KIT_URLS), ['jungle', 'moon', 'volcano']);
});
