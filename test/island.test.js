import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBSTACLES, heightAt, regionAt, seededRandom, SEED } from '../shared/world.js';
import { COAST_REGIONS, COAST_PALM_TRUNK_REACH, COAST_ROCK_NOMINALS, ISLAND_COAST_PALM_OBSTACLES, ISLAND_COAST_ROCK_OBSTACLES,
  isCoastRegion, coastPalmScale, coastRockDressing, ISLAND_LANDMARK_COUNTS, ISLAND_LANDMARK_TOTAL, MOON_GATE_APERTURE_RADIUS } from '../shared/island.js';
import { ISLAND_PREFABS, ISLAND_LANDMARK_PREFABS, ISLAND_MATERIAL_BINDINGS, buildIslandKit, createIsland } from '../client/island.js';
import { createEnvironmentAssets, disposeOwnedResources, ENVIRONMENT_ASSET_REGISTRY } from '../client/environment-assets.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const sharedURL = '/assets/old-watch/kit.glb', islandURL = '/assets/island/kit.glb';
const PALM_IDS = ['prop-2', 'prop-3', 'prop-4', 'prop-5', 'prop-15'], ROCK_IDS = ['prop-1', 'prop-6', 'prop-18', 'prop-19'];
const PALM_CELL = 64, LANDMARK_CELL = 64, SEVENTH = 1 / 7;
// Authored budgets and envelopes from the slice-1 and slice-2 palette cards; the
// shipped kit may measure tighter but never wider.
const PREFAB_LIMITS = {
  coast_palm_a: { maxRadius: 4.6, minY: -.40, maxY: 8.6, triangles: 4200 },
  coast_palm_b: { maxRadius: 4.6, minY: -.40, maxY: 7.8, triangles: 4000 },
  coast_rock_a: { maxRadius: 2.50, minY: -.40, maxY: 5.00, triangles: 1400 },
  coast_rock_b: { maxRadius: 2.00, minY: -.40, maxY: 3.00, triangles: 1200 },
  fishing_skiff_a: { maxRadius: 2.4, minY: -.40, maxY: 3.7, triangles: 3200 },
  fishing_skiff_b: { maxRadius: 2.4, minY: -.40, maxY: 3.7, triangles: 3200 },
  palm_gate_pillar: { maxRadius: 1.92, minY: -.45, maxY: 6.12, triangles: 2200 },
  palm_gate_lintel: { maxRadius: 5.84, minY: -.55, maxY: .55, triangles: 2200 },
  moon_gate_ring: { maxRadius: 4.32, minY: -4.29, maxY: 4.29, triangles: 2800 },
  moon_gate_orb: { maxRadius: .75, minY: -.75, maxY: .75, triangles: 650 },
  shrine_mushroom: { maxRadius: 1.80, minY: -.25, maxY: 3.40, triangles: 1700 },
  shrine_moon_crystal: { maxRadius: 1.00, minY: -.30, maxY: 3.05, triangles: 650 },
  caldera_ridge_a: { maxRadius: 4.70, minY: -2.60, maxY: 11.25, triangles: 1500 },
  caldera_ridge_b: { maxRadius: 4.70, minY: -2.60, maxY: 11.25, triangles: 1500 },
  caldera_amber_crystal: { maxRadius: 1.00, minY: -.30, maxY: 3.05, triangles: 650 },
  ember_core: { maxRadius: 5.00, minY: -.20, maxY: .80, triangles: 1200 },
  ember_core_rock: { maxRadius: 1.80, minY: -1.70, maxY: 1.70, triangles: 700 },
};
// Each authored root leans on the slots its palette card names, so every binding
// - trunk, both frond kinds, coconut, stone, planking, both paints, canvas, rope
// and iron - has a real target in the fake kit.
// The eleven shrine roots use the slots the shipped manifest records for them:
// both gate stones, all four lunar slots and all three caldera slots, so the
// glow bindings and the basalt/weathered pair each have a real target.
const PREFAB_SLOTS = {
  coast_palm_a: ['palm_trunk', 'coast_frond', 'coconut'],
  coast_palm_b: ['palm_trunk', 'coast_frond', 'dead_frond'],
  coast_rock_a: ['coast_stone'],
  coast_rock_b: ['coast_stone'],
  fishing_skiff_a: ['skiff_plank', 'skiff_teal', 'skiff_canvas', 'forged_iron'],
  fishing_skiff_b: ['skiff_plank', 'skiff_coral', 'hemp_rope'],
  palm_gate_pillar: ['jungle_gate_stone', 'jungle_gate_edge'],
  palm_gate_lintel: ['jungle_gate_stone', 'jungle_gate_edge'],
  moon_gate_ring: ['lunar_stone', 'lunar_glow'],
  moon_gate_orb: ['lunar_stone', 'lunar_glow'],
  shrine_mushroom: ['lunar_cap', 'lunar_stem', 'lunar_glow'],
  shrine_moon_crystal: ['lunar_glow'],
  caldera_ridge_a: ['caldera_basalt', 'caldera_weathered', 'caldera_glow'],
  caldera_ridge_b: ['caldera_basalt', 'caldera_weathered', 'caldera_glow'],
  caldera_amber_crystal: ['caldera_glow'],
  ember_core: ['caldera_basalt', 'caldera_weathered', 'caldera_glow'],
  ember_core_rock: ['caldera_basalt', 'caldera_weathered', 'caldera_glow'],
};
const LANDMARK_PREFAB_SET = new Set(ISLAND_LANDMARK_PREFABS);
function fixtures() {
  const shared = { scene: new THREE.Group() }, kit = { scene: new THREE.Group() };
  const geometry = new THREE.BoxGeometry(.2, .5, .2), materials = new Map();
  for (const name of new Set(Object.values(ISLAND_MATERIAL_BINDINGS).map(binding => binding.source))) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const carrier = new THREE.Mesh(geometry, material); carrier.name = 'material-' + name; shared.scene.add(carrier);
  }
  const used = new Set(Object.values(PREFAB_SLOTS).flat());
  const spare = Object.keys(ISLAND_MATERIAL_BINDINGS).filter(slot => !used.has(slot));
  for (const name of ISLAND_PREFABS) {
    const root = new THREE.Group(); root.name = name;
    // The tall rock parks any otherwise unused slot: it is cloned, never
    // instanced, so a spare slot cannot disturb the palm instance counts.
    for (const [index, slot] of [...PREFAB_SLOTS[name], ...(name === 'coast_rock_a' ? spare : [])].entries()) {
      const material = new THREE.MeshStandardMaterial(); material.name = slot;
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name + '-' + slot;
      // Every authored shrine primitive is offset, turned and squashed inside
      // its root, so an installed landmark has to carry the source child matrix
      // through the site transform rather than only the site's own placement.
      if (LANDMARK_PREFAB_SET.has(name)) {
        mesh.position.set(.13 * (index + 1), .27 * (index + 1), -.09 * (index + 1));
        mesh.rotation.set(.11, .23 * (index + 1), -.07);
        mesh.scale.set(1 + .1 * index, .85, 1.2);
      }
      root.add(mesh);
    }
    kit.scene.add(root);
  }
  return { shared, kit, geometry, materials };
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
async function scenery() {
  const { buildScenery } = await import('../client/world.js');
  const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  const palette = makePalette();
  return { palette, random, ...buildScenery(palette, random) };
}
function releaseScenery({ group, palette }) {
  disposeOwnedResources(group);
  for (const geometry of Object.values(palette.geometry)) geometry.dispose();
}
// The recorded coast and shrine sites are plain data, so one buildScenery pass
// feeds every runtime test without keeping its original batches alive.
let cachedSites = null;
async function coastSites() {
  if (!cachedSites) {
    const built = await scenery();
    cachedSites = { palmSites: built.coastPalmSites, rockSites: built.coastRockSites, landmarkSites: built.landmarkSites };
    releaseScenery(built);
  }
  return cachedSites;
}
async function harness(load, assets) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette());
  const legacyScenery = new THREE.Group(); legacyScenery.name = 'island-coast-original-scenery';
  const landmarkFallback = new THREE.Group(); landmarkFallback.name = 'island-shrines-original-scenery';
  scene.add(settlements.group, legacyScenery, landmarkFallback);
  const { palmSites, rockSites, landmarkSites } = await coastSites();
  return { scene, settlements, legacyScenery, landmarkFallback, palmSites, rockSites, landmarkSites,
    island: createIsland({ scene, settlements, legacyScenery, landmarkFallback, load, assets, palmSites, rockSites, landmarkSites }) };
}
// A decomposed instance matrix yields a yaw in (-pi, pi]; the recorded sites
// carry a yaw in [0, 2pi), so every comparison wraps first.
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const expectedPalms = palmSites => palmSites.map((site, index) => ({ ...site, prefab: site.id ? 'coast_palm_a' : index % 2 ? 'coast_palm_b' : 'coast_palm_a' }));
function cellsOf(sites, size = PALM_CELL) {
  const cells = new Map();
  for (const site of sites) {
    const key = Math.floor(site.x / size) + ':' + Math.floor(site.z / size);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(site);
  }
  return cells;
}
const boatsOf = live => live.settlements.group.userData.skiffs;
// Every repeated shrine root becomes one InstancedMesh per source primitive per
// 64 m cell; the four one-offs are clones named after their descriptor.
function landmarkMeshesOf(scene) {
  const meshes = [];
  scene.traverse(object => { if (object.isInstancedMesh && object.userData.landmarkPrefab) meshes.push(object); });
  return meshes;
}
// A Euler decomposition can return an equivalent branch, so instance transforms
// are compared as whole matrices. instanceMatrix is a Float32Array, so a 90 m
// coordinate carries about 1e-5 m of rounding: the tolerance scales with the
// element it checks.
function assertMatrix(actual, expected, label) {
  for (let i = 0; i < 16; i++) {
    const tolerance = 1e-5 * Math.max(1, Math.abs(expected.elements[i]));
    assert.ok(Math.abs(actual.elements[i] - expected.elements[i]) <= tolerance,
      label + ' element ' + i + ': ' + actual.elements[i] + ' vs ' + expected.elements[i]);
  }
}
// The transform buildScenery recorded, composed independently of the runtime.
function siteMatrix(site) {
  return new THREE.Matrix4().compose(new THREE.Vector3(site.x, site.y, site.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(site.rotation[0], site.rotation[1], site.rotation[2])),
    new THREE.Vector3(site.scale[0], site.scale[1], site.scale[2]));
}

test('the coast layout keeps every original palm, surf rock and collider it dresses', () => {
  assert.deepEqual(COAST_REGIONS, ['beach', 'haven']);
  assert.ok(Object.isFrozen(COAST_REGIONS) && Object.isFrozen(ISLAND_COAST_PALM_OBSTACLES) && Object.isFrozen(ISLAND_COAST_ROCK_OBSTACLES));
  for (const region of COAST_REGIONS) assert.equal(isCoastRegion(region), true, region);
  for (const region of ['jungle', 'moon', 'volcano', 'plains', undefined, null]) assert.equal(isCoastRegion(region), false, String(region));
  assert.equal(COAST_PALM_TRUNK_REACH, 1.6);
  assert.deepEqual(ISLAND_COAST_PALM_OBSTACLES.map(obstacle => obstacle.id), PALM_IDS, 'only the recorded coast palms are authored');
  assert.deepEqual(ISLAND_COAST_ROCK_OBSTACLES.map(obstacle => obstacle.id), ROCK_IDS, 'only the recorded coast rocks are authored');
  for (const obstacle of ISLAND_COAST_PALM_OBSTACLES) { assert.equal(obstacle.type, 'tree', obstacle.id); assert.ok(isCoastRegion(regionAt(obstacle.x, obstacle.z)?.id), obstacle.id); }
  for (const obstacle of ISLAND_COAST_ROCK_OBSTACLES) { assert.equal(obstacle.type, 'rock', obstacle.id); assert.ok(isCoastRegion(regionAt(obstacle.x, obstacle.z)?.id), obstacle.id); }
  // The forge and observatory rocks keep the kits that already ship them.
  for (const id of ['prop-33', 'prop-28', 'prop-29']) assert.ok(![...ISLAND_COAST_PALM_OBSTACLES, ...ISLAND_COAST_ROCK_OBSTACLES].some(obstacle => obstacle.id === id), id + ' belongs to another kit');
  assert.deepEqual(COAST_ROCK_NOMINALS, { coast_rock_a: { radius: 2.5, height: 5 }, coast_rock_b: { radius: 2.0, height: 3 } });
  const dressings = Object.fromEntries(ISLAND_COAST_ROCK_OBSTACLES.map(obstacle => [obstacle.id, coastRockDressing(obstacle)]));
  assert.deepEqual(dressings['prop-1'], { prefab: 'coast_rock_a', scale: [1, 1, 1] });
  assert.deepEqual(dressings['prop-6'], { prefab: 'coast_rock_b', scale: [1, 1, 1] });
  assert.deepEqual(dressings['prop-18'], { prefab: 'coast_rock_b', scale: [1.3, 4 / 3, 1.3] });
  assert.deepEqual(dressings['prop-19'], { prefab: 'coast_rock_a', scale: [1.2, 1.2, 1.2] });
  // Every dressing restores the collider it hides: radius and height come back
  // out of the nominal boulder times its scale.
  for (const obstacle of ISLAND_COAST_ROCK_OBSTACLES) {
    const { prefab, scale } = dressings[obstacle.id], nominal = COAST_ROCK_NOMINALS[prefab];
    assert.ok(Math.abs(nominal.radius * scale[0] - obstacle.radius) < 1e-9, obstacle.id + ' radius');
    assert.ok(Math.abs(nominal.height * scale[1] - obstacle.height) < 1e-9, obstacle.id + ' height');
    assert.equal(scale[0], scale[2], obstacle.id + ' stays round in plan');
  }
  // coastPalmScale mirrors buildScenery's clamp((height || 7) / 7, .7, 1.5).
  assert.deepEqual(ISLAND_COAST_PALM_OBSTACLES.map(coastPalmScale), [1, 8 * SEVENTH, 1, 1, 8 * SEVENTH]);
  for (const height of [0, 2, 4.9, 5, 7, 8, 10, 10.5, 12, 40]) {
    const expected = Math.max(.7, Math.min(1.5, (height || 7) / 7));
    assert.equal(coastPalmScale({ height }), expected, 'height ' + height);
  }
  assert.equal(coastPalmScale(undefined), 1); assert.equal(coastPalmScale({}), 1);
  for (const obstacle of OBSTACLES) if (obstacle.type === 'tree' && isCoastRegion(regionAt(obstacle.x, obstacle.z)?.id)) {
    assert.ok(ISLAND_COAST_PALM_OBSTACLES.includes(obstacle), obstacle.id + ' is not left behind');
  }
});

test('scenery routes the coast palms, surf rocks and their sites into one restorable batch', async () => {
  const built = await scenery(), { coastPalmSites: palms, coastRockSites: rocks } = built;
  assert.equal(palms.length, 38, 'every original coast palm is recorded');
  assert.deepEqual(palms.slice(0, 5).map(site => site.id), PALM_IDS, 'the collidable palms come first, in OBSTACLES order');
  assert.deepEqual(palms.slice(0, 5).map(site => site.size), [1, 8 * SEVENTH, 1, 1, 8 * SEVENTH]);
  assert.deepEqual(palms.slice(0, 5).map(site => site.size), ISLAND_COAST_PALM_OBSTACLES.map(coastPalmScale), 'the shared scale matches the drawn one');
  for (const [index, obstacle] of ISLAND_COAST_PALM_OBSTACLES.entries()) {
    assert.deepEqual([palms[index].x, palms[index].z], [obstacle.x, obstacle.z], obstacle.id + ' keeps its position');
    assert.deepEqual([palms[index].radius, palms[index].height], [obstacle.radius, obstacle.height], obstacle.id + ' keeps its collider');
  }
  assert.ok(palms.slice(5).every(site => site.id === undefined), 'the decorative palms stay anonymous');
  assert.equal(palms.slice(5).length, 33);
  for (const site of palms) {
    assert.ok(site.size >= .58 && site.size <= 1.5, 'palm size ' + site.size);
    assert.ok(Number.isFinite(site.yaw) && site.yaw >= 0 && site.yaw < Math.PI * 2, 'palm yaw ' + site.yaw);
    assert.ok(Number.isFinite(site.x) && Number.isFinite(site.z));
    assert.ok(isCoastRegion(regionAt(site.x, site.z)?.id), 'every recorded palm stands on the coast');
  }
  assert.deepEqual(rocks.map(site => site.id), ROCK_IDS);
  for (const [index, obstacle] of ISLAND_COAST_ROCK_OBSTACLES.entries()) {
    assert.deepEqual([rocks[index].x, rocks[index].z, rocks[index].radius, rocks[index].height],
      [obstacle.x, obstacle.z, obstacle.radius, obstacle.height], obstacle.id + ' keeps its collider');
    assert.ok(Number.isFinite(rocks[index].yaw) && rocks[index].yaw >= 0 && rocks[index].yaw < Math.PI * 2);
  }
  const legacy = built.coastLegacyScenery;
  assert.ok(legacy); assert.equal(legacy.visible, true);
  assert.equal(built.group.getObjectByName('island-coast-original-scenery'), legacy);
  const positions = legacy.geometry.attributes.position; assert.ok(positions.count > 0, 'the original batch still carries geometry');
  // Every authored site has original geometry standing over it, and the batch
  // carries nothing else: a palm crown reaches under 5 m, so a stray hut, dune
  // or jungle palm would show up as a vertex further out than that.
  const near = new Map([...palms, ...rocks].map(site => [site, 0]));
  let strays = 0;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    let distance = Infinity;
    for (const site of near.keys()) {
      distance = Math.min(distance, Math.hypot(x - site.x, z - site.z));
      if (Math.hypot(x - site.x, z - site.z) < 4 && y > heightAt(site.x, site.z) + .5) near.set(site, near.get(site) + 1);
    }
    if (distance > 5) strays++;
  }
  for (const [site, hits] of near) assert.ok(hits > 0, (site.id ?? site.x + ',' + site.z) + ' has original scenery in the coast batch');
  assert.equal(strays, 0, 'nothing but the recorded palms and surf rocks is routed into the island batch');
  assert.equal(built.group.userData.coastPalmSites, palms); assert.equal(built.group.userData.coastRockSites, rocks);
  // The routing only changes batch boundaries: the island's RNG stream is
  // untouched, so the next draw is still the recorded pre-milestone value.
  assert.equal(built.random(), .017430383479222655);
  releaseScenery(built);
});

test('the coast kit installs atomically with instanced palms, dressed surf rocks and authored skiffs', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture), loads = [];
  const bindings = JSON.stringify(ISLAND_MATERIAL_BINDINGS);
  const live = await harness(async url => { loads.push(url); return url === sharedURL ? fixture.shared : fixture.kit; });
  assert.equal(live.legacyScenery.visible, true); assert.equal(live.landmarkFallback.visible, true);
  for (const boat of boatsOf(live)) assert.equal(boat.original.visible, true, 'the original hulls carry the harbour until the kit lands');
  assert.equal(await live.island.ready, true); assert.deepEqual(loads, [sharedURL, islandURL]);
  assert.equal(live.island.isReady(), true); assert.equal(live.legacyScenery.visible, false);
  assert.equal(live.landmarkFallback.visible, false, 'the shrine originals only step aside once the whole kit is installed');
  const group = live.scene.getObjectByName('island-coast-environment'); assert.ok(group, 'the authored coast group is installed');
  let lights = 0; live.scene.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'the coast adds no scene light, so every island shader keeps its light count');
  // Each boat group keeps its original hidden underneath the authored skiff, so
  // the existing bobbing animation still drives it.
  boatsOf(live).forEach((boat, index) => {
    assert.equal(boat.group.name, 'saltwind-fishing-skiff-' + index);
    assert.equal(boat.original.visible, false, 'the original hull is hidden');
    const authored = boat.group.children.filter(child => child !== boat.original);
    assert.equal(authored.length, 1, 'exactly one authored skiff per boat');
    assert.equal(authored[0].name, 'island-skiff-' + index);
    assert.ok(authored[0].getObjectByName((index ? 'fishing_skiff_b' : 'fishing_skiff_a') + '-' + (index ? 'skiff_coral' : 'skiff_teal')), 'the paints alternate');
    assert.ok(authored[0].position.length() < 1e-9 && authored[0].rotation.y === 0, 'the authored hull sits at local identity');
    authored[0].traverse(object => { if (object.isMesh) assert.equal(object.castShadow, true); });
  });
  const palmMeshes = [];
  live.scene.traverse(object => { if (object.isInstancedMesh && object.userData.detailKind === 'palm') palmMeshes.push(object); });
  assert.ok(palmMeshes.length > 0, 'the palms are instanced');
  const perSlot = new Map();
  for (const mesh of palmMeshes) {
    assert.ok(/^island-palm-coast_palm_[ab]--?\d+:-?\d+$/.test(mesh.name), mesh.name);
    perSlot.set(mesh.material.name, (perSlot.get(mesh.material.name) ?? 0) + mesh.count);
  }
  // One InstancedMesh per source primitive per cell, so the count is asserted per
  // primitive: both palms carry a trunk and a green frond, and the a/b split of
  // the coconut and dead-frond primitives has to add back up to 38.
  assert.equal(perSlot.get('palm_trunk'), 38, 'every recorded palm site gets an authored trunk');
  assert.equal(perSlot.get('coast_frond'), 38, 'every recorded palm site gets an authored crown');
  assert.equal(perSlot.get('coconut') + perSlot.get('dead_frond'), 38, 'the a/b split covers every site exactly once');
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  let decomposed = 0;
  for (const prefab of ['coast_palm_a', 'coast_palm_b']) {
    const cells = cellsOf(expectedPalms(live.palmSites).filter(site => site.prefab === prefab));
    assert.ok(cells.size > 1, prefab + ' spans several 64 m cells');
    for (const [key, sites] of cells) {
      const mesh = palmMeshes.find(candidate => candidate.name === 'island-palm-' + prefab + '-' + key && candidate.material.name === 'palm_trunk');
      assert.ok(mesh, prefab + ' cell ' + key); assert.equal(mesh.count, sites.length, prefab + ' cell ' + key + ' count');
      sites.forEach((site, index) => {
        // instanceMatrix is a Float32Array, so a 100 m coordinate carries about
        // 1e-5 m of rounding; the tolerances are tight but above that floor.
        mesh.getMatrixAt(index, matrix); matrix.decompose(position, quaternion, scale); decomposed++;
        assert.ok(Math.hypot(position.x - site.x, position.z - site.z) < 1e-3, 'the instance stands on its recorded site');
        assert.ok(Math.abs(position.y - renderedHeightAt(site.x, site.z) - .015) < 1e-3, 'the instance sits on the rendered terrain');
        for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(scale[axis] - site.size) < 1e-5, 'the instance keeps its recorded size');
        const yaw = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ').y;
        assert.ok(Math.abs(wrap(yaw - site.yaw)) < 1e-5, 'the instance keeps its recorded lean: ' + yaw + ' vs ' + site.yaw);
      });
    }
  }
  assert.equal(decomposed, 38, 'every palm instance matrix is checked');
  for (const site of live.rockSites) {
    const root = live.scene.getObjectByName('island-coast-rock-' + site.id); assert.ok(root, site.id);
    const { prefab, scale: dressing } = coastRockDressing(site);
    assert.ok(root.getObjectByName(prefab + '-coast_stone'), site.id + ' takes the ' + prefab + ' boulder');
    assert.deepEqual(root.scale.toArray(), dressing, site.id + ' scale');
    assert.deepEqual([root.position.x, root.position.y, root.position.z], [site.x, heightAt(site.x, site.z), site.z], site.id + ' position');
    assert.equal(root.rotation.y, site.yaw, site.id + ' yaw');
  }
  const stats = live.island.getStats();
  assert.deepEqual(Object.keys(stats), ['status', 'ready', 'loading', 'fallback', 'error', 'windValue',
    'prefabs', 'palms', 'collidablePalms', 'rocks', 'skiffs', 'canopyMeshes', 'cellSize',
    'landmarks', 'landmarkMeshes', 'landmarkCounts', 'landmarkCellSize', 'visibleDetailMeshes']);
  assert.equal(stats.status, 'ready'); assert.equal(stats.ready, true); assert.equal(stats.loading, false); assert.equal(stats.fallback, false);
  assert.equal(stats.error, null); assert.equal(stats.prefabs, ISLAND_PREFABS.length); assert.equal(ISLAND_PREFABS.length, 17);
  assert.equal(ISLAND_LANDMARK_PREFABS.length, 11, 'the shrine slice adds eleven roots to the six coast ones');
  assert.equal(stats.palms, 38); assert.equal(stats.collidablePalms, 5); assert.equal(stats.rocks, 4); assert.equal(stats.skiffs, 2);
  assert.equal(stats.canopyMeshes, palmMeshes.length); assert.equal(stats.cellSize, PALM_CELL); assert.equal(stats.visibleDetailMeshes, 0);
  assert.equal(stats.landmarks, ISLAND_LANDMARK_TOTAL); assert.equal(stats.landmarks, 50);
  assert.deepEqual(stats.landmarkCounts, ISLAND_LANDMARK_COUNTS); assert.equal(stats.landmarkCellSize, LANDMARK_CELL);
  live.island.animate(10, {}); assert.equal(live.island.getStats().windValue, 8);
  live.island.animate(20, {}); assert.equal(live.island.getStats().windValue, 16, 'the fronds sway while animated');
  for (const slot of ['coast_frond', 'dead_frond']) {
    const frond = palmMeshes.find(mesh => mesh.material.name === slot); assert.ok(frond, slot);
    assert.equal(frond.material.side, THREE.DoubleSide, slot + ' is double sided');
    const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; frond.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.islandWind.value, 16, slot + ' reads the shared wind uniform');
    assert.ok(shader.vertexShader.includes('islandWind'), slot + ' hook');
    assert.ok(shader.vertexShader.includes('max(position.y - 3.0, 0.0)'), 'only the crown above head height sways');
  }
  for (const slot of ['palm_trunk', 'coconut']) {
    const rigid = palmMeshes.find(mesh => mesh.material.name === slot); assert.ok(rigid, slot);
    const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; rigid.material.onBeforeCompile(shader);
    assert.deepEqual(shader.uniforms, {}, slot + ' stays rigid');
  }
  assert.equal(JSON.stringify(ISLAND_MATERIAL_BINDINGS), bindings, 'binding the kit never rewrites the dictionary');
  // The strand skyline is read from every approach, so the palms cast shadows and
  // are never thinned or distance-hidden.
  live.island.animate(30, { player: { x: -420, z: -420 }, lowQuality: true, reducedMotion: true });
  assert.equal(live.island.getStats().windValue, 0, 'reduced motion parks the wind');
  for (const mesh of palmMeshes) {
    assert.equal(mesh.castShadow, true, mesh.name + ' casts a shadow');
    assert.equal(mesh.visible, true, mesh.name + ' is never distance-hidden');
    assert.equal(mesh.count, mesh.userData.fullCount, mesh.name + ' is never thinned');
  }
  live.island.dispose(); live.island.dispose();
  assert.equal(live.legacyScenery.visible, true); assert.equal(live.landmarkFallback.visible, true, 'disposal brings the shrine originals back');
  assert.equal(live.scene.getObjectByName('island-coast-environment'), undefined);
  for (const boat of boatsOf(live)) { assert.equal(boat.original.visible, true); assert.deepEqual(boat.group.children, [boat.original]); }
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('the authored shrines install on every recorded transform, batched per cell and rigid', async () => {
  const fixture = fixtures();
  const live = await harness(async url => url === sharedURL ? fixture.shared : fixture.kit);
  assert.equal(await live.island.ready, true);
  const sites = live.landmarkSites;
  assert.equal(sites.length, ISLAND_LANDMARK_TOTAL);
  const group = live.scene.getObjectByName('island-coast-environment');
  const instanced = landmarkMeshesOf(live.scene);
  const matrix = new THREE.Matrix4(), expected = new THREE.Matrix4(), checked = new Set();
  let installed = 0;
  for (const prefab of ISLAND_LANDMARK_PREFABS) {
    const own = sites.filter(site => site.prefab === prefab);
    assert.ok(own.length, prefab + ' has recorded sites');
    const shadow = !['shrine_moon_crystal', 'caldera_amber_crystal', 'ember_core'].includes(prefab);
    const primitives = PREFAB_SLOTS[prefab].length;
    if (own.length > 1) {
      const cells = cellsOf(own, LANDMARK_CELL);
      const mine = instanced.filter(mesh => mesh.userData.landmarkPrefab === prefab);
      assert.equal(mine.length, primitives * cells.size, prefab + ' batches one mesh per primitive per cell');
      installed += mine.length;
      for (const [key, cellSites] of cells) {
        for (const slot of PREFAB_SLOTS[prefab]) {
          const mesh = mine.find(candidate => candidate.name === 'island-landmark-' + prefab + '-' + key && candidate.material.name === slot);
          assert.ok(mesh, prefab + ' ' + slot + ' cell ' + key);
          assert.equal(mesh.count, cellSites.length, prefab + ' cell ' + key + ' count');
          assert.equal(mesh.userData.fullCount, cellSites.length);
          assert.equal(mesh.castShadow, shadow, prefab + ' shadow policy'); assert.equal(mesh.receiveShadow, true);
          const source = fixture.kit.scene.getObjectByName(prefab).getObjectByName(prefab + '-' + slot);
          source.updateMatrixWorld(true);
          cellSites.forEach((site, index) => {
            mesh.getMatrixAt(index, matrix);
            expected.multiplyMatrices(siteMatrix(site), source.matrix);
            assertMatrix(matrix, expected, site.id + ' ' + slot); checked.add(site.id);
          });
        }
      }
    } else {
      const [site] = own, root = group.getObjectByName('island-landmark-' + site.id);
      assert.ok(root, site.id + ' is a shared-material clone, not a batch');
      assert.equal(instanced.some(mesh => mesh.userData.landmarkPrefab === prefab), false, prefab + ' is a one-off');
      root.updateMatrixWorld(true);
      assertMatrix(root.matrix, siteMatrix(site), site.id + ' root'); checked.add(site.id);
      let meshes = 0;
      root.traverse(object => {
        if (!object.isMesh) return;
        meshes++; installed++;
        assert.equal(object.castShadow, shadow, site.id + ' shadow policy'); assert.equal(object.receiveShadow, true);
        const source = fixture.kit.scene.getObjectByName(prefab).getObjectByName(object.name);
        source.updateMatrixWorld(true);
        assertMatrix(object.matrixWorld, expected.multiplyMatrices(siteMatrix(site), source.matrix), site.id + ' ' + object.name);
      });
      assert.equal(meshes, primitives, site.id + ' keeps every authored primitive');
    }
  }
  assert.deepEqual([...checked].sort(), sites.map(site => site.id).sort(), 'every recorded landmark transform is compared as a whole matrix');
  assert.equal(live.island.getStats().landmarkMeshes, installed, 'the stats count the meshes actually installed');
  // Derived from the fixture's primitives and the recorded cell spread, never a
  // fixed number: eighteen towers split over two caldera cells, the grove over
  // two moon cells and the gateway over two jungle ones.
  assert.equal(installed, ISLAND_LANDMARK_PREFABS.reduce((sum, prefab) => {
    const own = sites.filter(site => site.prefab === prefab);
    return sum + PREFAB_SLOTS[prefab].length * (own.length > 1 ? cellsOf(own, LANDMARK_CELL).size : own.length);
  }, 0));
  // Every landmark of one slot shares the single bound material, and the glow
  // slots carry the emissive the palette card names without touching the shared
  // source material they were cloned from.
  const bySlot = new Map(), landmarkMeshes = [...instanced];
  for (const child of group.children) {
    if (child.isInstancedMesh || !child.name.startsWith('island-landmark-')) continue;
    child.traverse(object => { if (object.isMesh) landmarkMeshes.push(object); });
  }
  assert.equal(landmarkMeshes.length, installed);
  for (const mesh of landmarkMeshes) {
    const slot = mesh.material.name;
    if (!bySlot.has(slot)) bySlot.set(slot, new Set());
    bySlot.get(slot).add(mesh.material);
  }
  for (const [slot, materials] of bySlot) assert.equal(materials.size, 1, slot + ' is bound once and shared by every repeat');
  for (const [slot, emissive] of [['lunar_glow', [.16, .40, .44]], ['caldera_glow', [.55, .16, .025]]]) {
    const [material] = [...bySlot.get(slot)];
    assert.deepEqual(material.emissive.toArray().map(value => Number(value.toFixed(6))), emissive, slot + ' emissive');
    assert.equal(material.emissiveIntensity, 1, slot + ' emissive intensity');
  }
  for (const source of fixture.materials.values()) {
    assert.equal(source.emissive.getHex(), 0x000000, source.name + ' keeps its unlit source emissive');
    assert.equal(source.color.getHex(), 0xffffff, source.name + ' keeps its source albedo');
    assert.equal(source.normalScale.x, 1, source.name + ' keeps its source normal scale');
    assert.equal(source.side, THREE.FrontSide, source.name + ' keeps its source sidedness');
  }
  // No shrine sways and none is ever thinned or distance-hidden, so a caldera
  // tower never disappears from the skyline at low quality or long range.
  for (const [slot, materials] of bySlot) {
    const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' };
    [...materials][0].onBeforeCompile(shader);
    assert.deepEqual(shader.uniforms, {}, slot + ' stays rigid');
  }
  const before = instanced.map(mesh => { const copy = new THREE.Matrix4(); mesh.getMatrixAt(0, copy); return copy; });
  live.island.animate(30, { player: { x: -420, z: -420 }, lowQuality: true, reducedMotion: true });
  assert.equal(live.island.getStats().windValue, 0);
  instanced.forEach((mesh, index) => {
    assert.equal(mesh.visible, true, mesh.name + ' is never distance-hidden');
    assert.equal(mesh.count, mesh.userData.fullCount, mesh.name + ' is never thinned');
    const now = new THREE.Matrix4(); mesh.getMatrixAt(0, now);
    assert.deepEqual([...now.elements], [...before[index].elements], mesh.name + ' is static');
  });
  assert.equal(live.island.getStats().visibleDetailMeshes, 0, 'this slice adds no thinned ground detail');
  live.island.dispose();
  assert.equal(live.landmarkFallback.visible, true);
  assert.equal(landmarkMeshesOf(live.scene).length, 0);
});

test('missing prefabs and unbound slots fail before any authored coast or shrine geometry is installed', async () => {
  const { palmSites, rockSites, landmarkSites } = await coastSites();
  const missing = fixtures();
  missing.kit.scene.remove(missing.kit.scene.getObjectByName('fishing_skiff_b'));
  assert.throws(() => buildIslandKit(missing.kit, missing.shared, { palmSites, rockSites, landmarkSites }), /fishing_skiff_b/);
  const empty = fixtures();
  empty.kit.scene.getObjectByName('coast_rock_b').clear();
  assert.throws(() => buildIslandKit(empty.kit, empty.shared, { palmSites, rockSites, landmarkSites }), /coast_rock_b/);
  const invalid = fixtures();
  invalid.kit.scene.getObjectByName('coast_palm_a').children[0].material.name = 'external_texture';
  assert.throws(() => buildIslandKit(invalid.kit, invalid.shared, { palmSites, rockSites, landmarkSites }), /binding is missing: external_texture/);
  const unshared = fixtures();
  unshared.shared.scene.remove(unshared.shared.scene.getObjectByName('material-pine_bark'));
  assert.throws(() => buildIslandKit(unshared.kit, unshared.shared, { palmSites, rockSites, landmarkSites }), /binding is missing: palm_trunk/);
  // The eleven shrine roots and their nine new slots are required the same way:
  // a kit without them installs nothing rather than a half-dressed caldera.
  const noRing = fixtures();
  noRing.kit.scene.remove(noRing.kit.scene.getObjectByName('moon_gate_ring'));
  assert.throws(() => buildIslandKit(noRing.kit, noRing.shared, { palmSites, rockSites, landmarkSites }), /missing or empty: moon_gate_ring/);
  const hollowRidge = fixtures();
  hollowRidge.kit.scene.getObjectByName('caldera_ridge_b').clear();
  assert.throws(() => buildIslandKit(hollowRidge.kit, hollowRidge.shared, { palmSites, rockSites, landmarkSites }), /missing or empty: caldera_ridge_b/);
  const noLantern = fixtures();
  noLantern.shared.scene.remove(noLantern.shared.scene.getObjectByName('material-lantern_amber'));
  assert.throws(() => buildIslandKit(noLantern.kit, noLantern.shared, { palmSites, rockSites, landmarkSites }), /binding is missing: lunar_glow/);
  const stray = fixtures();
  const strayLandmark = { id: 'stray', kind: 'ridges', prefab: 'caldera_ridge_c', x: 0, y: 0, z: 0, rotation: [0, 0, 0], scale: [1, 1, 1] };
  assert.throws(() => buildIslandKit(stray.kit, stray.shared, { palmSites, rockSites, landmarkSites: [...landmarkSites, strayLandmark] }),
    /landmark prefab is missing: caldera_ridge_c/);
  // A partially staged kit disposes every binding it cloned and leaves the shared
  // sources alone.
  const staged = fixtures(), counts = disposalProbe(staged);
  let cloned = 0, released = 0;
  for (const material of staged.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); cloned++; copy.addEventListener('dispose', () => released++); return copy; };
  }
  staged.kit.scene.getObjectByName('fishing_skiff_a').clone = () => { throw new Error('staging interrupted'); };
  assert.throws(() => buildIslandKit(staged.kit, staged.shared, { palmSites, rockSites, landmarkSites }), /staging interrupted/);
  assert.ok(cloned > 0); assert.equal(released, cloned);
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  disposeOwnedResources([staged.kit.scene, staged.shared.scene]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  // The caldera core throws after the coast palms, rocks and skiffs are already
  // staged, so the failure lands before any build result exists.
  const stagedCore = fixtures(), coreCounts = disposalProbe(stagedCore);
  let coreCloned = 0, coreReleased = 0;
  for (const material of stagedCore.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); coreCloned++; copy.addEventListener('dispose', () => coreReleased++); return copy; };
  }
  stagedCore.kit.scene.getObjectByName('ember_core').clone = () => { throw new Error('shrine staging interrupted'); };
  assert.throws(() => buildIslandKit(stagedCore.kit, stagedCore.shared, { palmSites, rockSites, landmarkSites }), /shrine staging interrupted/);
  assert.ok(coreCloned > 0); assert.equal(coreReleased, coreCloned, 'the interrupted shrine staging releases every bound material');
  assert.deepEqual(coreCounts, { geometry: 0, material: 0, texture: 0, bitmap: 0 }, 'the borrowed sources are left alone');
  disposeOwnedResources([stagedCore.kit.scene, stagedCore.shared.scene]);
  assert.deepEqual(coreCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('failed, late and rollback-failing island loads retain the original palms, surf rocks, shrines and skiffs', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const cache = createEnvironmentAssets({ load: url => url === sharedURL ? pending : Promise.reject(new Error('coast kit offline')) });
  const failed = await harness(undefined, cache);
  assert.equal(await failed.island.ready, false);
  const stats = failed.island.getStats();
  assert.equal(stats.status, 'fallback'); assert.equal(stats.ready, false); assert.equal(stats.fallback, true);
  assert.match(stats.error, /coast kit offline/); assert.equal(stats.windValue, 0);
  assert.equal(failed.legacyScenery.visible, true, 'the original coast batch stays lit');
  assert.equal(failed.landmarkFallback.visible, true, 'the original shrine solid and glow draws stay lit');
  assert.equal(failed.scene.getObjectByName('island-coast-environment'), undefined);
  for (const boat of boatsOf(failed)) { assert.equal(boat.original.visible, true); assert.deepEqual(boat.group.children, [boat.original]); }
  assert.equal(cache.getStats().leases, 0, 'a failed install releases both leases');
  failed.island.dispose(); deliver(fixture.shared); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 }, 'the late shared kit is retired');
  cache.dispose();
  // A failing shared library has to release the coast kit that arrives after it.
  const sharedFixture = fixtures(); let deliverKit, disposedKit = 0;
  sharedFixture.kit.scene.children[0].children[0].material.addEventListener('dispose', () => disposedKit++);
  const kitPending = new Promise(resolve => { deliverKit = resolve; });
  const offline = await harness(url => url === islandURL ? kitPending : Promise.reject(new Error('shared offline')));
  assert.equal(await offline.island.ready, false); assert.match(offline.island.getStats().error, /shared offline/);
  assert.equal(offline.legacyScenery.visible, true); assert.equal(offline.landmarkFallback.visible, true);
  for (const boat of boatsOf(offline)) { assert.equal(boat.original.visible, true); assert.deepEqual(boat.group.children, [boat.original]); }
  deliverKit(sharedFixture.kit); await kitPending; await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposedKit, 1, 'the separately arriving coast kit is released');
  offline.island.dispose(); assert.equal(disposedKit, 1);
  // Disposing before the load lands still cleans the late arrival up.
  const lateFixture = fixtures(), lateCounts = disposalProbe(lateFixture); let lateDeliver;
  const latePending = new Promise(resolve => { lateDeliver = resolve; });
  const late = await harness(url => url === sharedURL ? latePending : lateFixture.kit);
  late.island.dispose(); lateDeliver(lateFixture.shared); assert.equal(await late.island.ready, false);
  assert.equal(late.scene.getObjectByName('island-coast-environment'), undefined);
  assert.equal(late.legacyScenery.visible, true); assert.equal(late.landmarkFallback.visible, true);
  assert.equal(landmarkMeshesOf(late.scene).length, 0, 'a disposed island installs no shrine batch when the kit lands late');
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  // A settlement hook that throws on install and again on rollback still leaves
  // the original hulls and scenery standing.
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = await harness(async url => url === sharedURL ? rollbackFixture.shared : rollbackFixture.kit);
  const install = rollback.settlements.setIslandKit;
  rollback.settlements.setIslandKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.island.ready, false);
  assert.match(rollback.island.getStats().error, /install failed; Fallback restore: rollback failed/);
  assert.equal(rollback.legacyScenery.visible, true); assert.equal(rollback.landmarkFallback.visible, true);
  assert.equal(rollback.scene.getObjectByName('island-coast-environment'), undefined);
  assert.equal(landmarkMeshesOf(rollback.scene).length, 0);
  for (const boat of boatsOf(rollback)) { assert.equal(boat.original.visible, true); assert.deepEqual(boat.group.children, [boat.original]); }
  rollback.island.dispose(); assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('shipping island kit is geometry-only, within budget, and keeps every envelope, trunk and vertex tint', async () => {
  const bytes = await readFile(new URL('../client/assets/island/kit.glb', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../client/assets/island/manifest.json', import.meta.url), 'utf8'));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(bytes.readUInt32LE(8), bytes.length); assert.equal(manifest.bytes, bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  // The shrine slice raises the whole-island guard from the coast-only 2.5 MiB
  // and 24k triangles; both are still maxima, not targets.
  assert.ok(bytes.length <= 3.5 * 1024 * 1024, 'kit bytes: ' + bytes.length);
  assert.equal((gltf.images ?? []).length, 0, 'the kit embeds no image');
  assert.equal((gltf.textures ?? []).length, 0, 'the kit embeds no texture');
  assert.deepEqual(manifest.textures, []); assert.equal(manifest.embeddedImageCount, 0); assert.equal(manifest.decodedTextureBytes, 0);
  assert.deepEqual(manifest.buildingContracts, {}, 'this slice ships no building');
  // Tints are still being judged in engine, so only the shape of the contract is
  // pinned here: the shipped kit and the runtime dictionary are one source.
  assert.deepEqual(manifest.materialBindings, ISLAND_MATERIAL_BINDINGS);
  const slots = new Set(gltf.materials.map(material => material.name));
  for (const name of slots) assert.ok(ISLAND_MATERIAL_BINDINGS[name], name + ' is a declared binding');
  for (const name of ISLAND_PREFABS) assert.ok(gltf.nodes.some(node => node.name === name), name);
  let triangles = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) assert.ok(primitive.attributes[attribute] >= 0, attribute);
    assert.ok(ISLAND_MATERIAL_BINDINGS[gltf.materials[primitive.material].name]);
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  assert.equal(triangles, manifest.totalTriangles);
  assert.ok(triangles <= 40000, 'source triangles: ' + triangles);
  assert.equal(gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0), manifest.totalPrimitives);
  const kit = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (const name of ISLAND_PREFABS) {
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
  assert.deepEqual(Object.keys(manifest.propEnvelopes).sort(), [...ISLAND_PREFABS].sort(), 'every root records an envelope');
  for (const [name, envelope] of Object.entries(manifest.propEnvelopes)) {
    const limit = PREFAB_LIMITS[name];
    assert.ok(envelope.maxRadius <= limit.maxRadius + 1e-9, name + ' records a radius within the authored ' + limit.maxRadius + ': ' + envelope.maxRadius);
    assert.ok(envelope.minY >= limit.minY - 1e-9, name + ' records a floor within the authored ' + limit.minY + ': ' + envelope.minY);
    assert.ok(envelope.maxY <= limit.maxY + 1e-9, name + ' records a ceiling within the authored ' + limit.maxY + ': ' + envelope.maxY);
    assert.ok(manifest.prefabs[name].triangles <= limit.triangles, name + ' triangles: ' + manifest.prefabs[name].triangles);
    let sampled = 0;
    sample(name, point => {
      assert.ok(Math.hypot(point.x, point.z) <= envelope.maxRadius + 1e-4, name + ' stays inside its recorded radius');
      assert.ok(point.y >= envelope.minY - 1e-4 && point.y <= envelope.maxY + 1e-4, name + ' stays inside its recorded height'); sampled++;
    });
    assert.ok(sampled > 100, name + ' is actually modelled: ' + sampled);
  }
  // Both collidable palms scale up to 1.14 inside a 2.0 m collider, so the whole
  // authored trunk has to stay inside the recorded reach.
  assert.deepEqual(Object.keys(manifest.trunkRadii).sort(), ['coast_palm_a', 'coast_palm_b']);
  for (const name of ['coast_palm_a', 'coast_palm_b']) {
    const limit = manifest.propEnvelopes[name].trunkRadius;
    assert.ok(limit <= COAST_PALM_TRUNK_REACH + 1e-9, name + ' records a trunk reach within ' + COAST_PALM_TRUNK_REACH + ': ' + limit);
    let sampled = 0, widest = 0;
    kit.scene.getObjectByName(name).traverse(object => {
      if (!object.isMesh || object.material.name !== 'palm_trunk') return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        widest = Math.max(widest, Math.hypot(vertex.x, vertex.z));
        assert.ok(Math.hypot(vertex.x, vertex.z) <= limit + 1e-4, name + ' trunk stays inside ' + limit + ' m'); sampled++;
      }
    });
    assert.ok(sampled > 0, name + ' has an authored trunk');
    assert.ok(manifest.trunkRadii[name] <= limit + 1e-9 && manifest.trunkRadii[name] >= widest - 1e-4, name + ' records its measured trunk: ' + manifest.trunkRadii[name]);
  }
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
  assert.deepEqual([...slots].sort(), Object.keys(ISLAND_MATERIAL_BINDINGS).sort(), 'the kit uses every binding it declares');
  for (const [name, tint] of tints) assert.ok(tint.sum / tint.count >= .70, name + ' averages ' + (tint.sum / tint.count).toFixed(3) + ' vertex colour');
  // Every landmark contract the manifest publishes is the one the runtime and
  // the tests read, and the gate aperture is measured, not merely declared.
  assert.deepEqual(Object.keys(manifest.landmarkContracts).sort(), [...ISLAND_LANDMARK_PREFABS].sort(), 'every shrine root records a contract');
  assert.equal(manifest.landmarkContracts.moon_gate_ring.apertureRadius, MOON_GATE_APERTURE_RADIUS);
  assert.equal(MOON_GATE_APERTURE_RADIUS, 3.48);
  assert.ok(manifest.landmarkContracts.moon_gate_ring.measuredApertureRadius >= MOON_GATE_APERTURE_RADIUS,
    'the generator records an aperture at or beyond the contract: ' + manifest.landmarkContracts.moon_gate_ring.measuredApertureRadius);
  const fixture = fixtures(), { palmSites, rockSites, landmarkSites } = await coastSites();
  const built = buildIslandKit(kit, fixture.shared, { palmSites, rockSites, landmarkSites, skiffs: [{}, {}] });
  assert.equal(built.counts.prefabs, ISLAND_PREFABS.length); assert.equal(built.counts.palms, 38);
  assert.equal(built.counts.collidablePalms, 5); assert.equal(built.counts.rocks, 4); assert.equal(built.counts.skiffs, 2);
  assert.equal(built.counts.landmarks, ISLAND_LANDMARK_TOTAL); assert.deepEqual(built.counts.landmarkCounts, ISLAND_LANDMARK_COUNTS);
  assert.ok(built.counts.landmarkMeshes > 0, 'the shipped shrine roots install real meshes');
  disposeOwnedResources(built.ownedRoots, [kit.scene, fixture.shared.scene]); disposeOwnedResources([kit.scene, fixture.shared.scene]);
  // The payload budget the loader charges the frame for is the shipped one.
  assert.equal(ENVIRONMENT_ASSET_REGISTRY[islandURL].decodedTextureBytes, 0);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY[islandURL].bytes, manifest.bytes, 'the payload registry carries the shipped byte count');
  assert.equal(ENVIRONMENT_ASSET_REGISTRY[islandURL].triangles, manifest.totalTriangles, 'the payload registry carries the shipped triangle count');
});
