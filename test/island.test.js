import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBSTACLES, heightAt, regionAt, seededRandom, SEED } from '../shared/world.js';
import { COAST_REGIONS, COAST_PALM_TRUNK_REACH, COAST_ROCK_NOMINALS, ISLAND_COAST_PALM_OBSTACLES, ISLAND_COAST_ROCK_OBSTACLES,
  isCoastRegion, coastPalmScale, coastRockDressing } from '../shared/island.js';
import { ISLAND_PREFABS, ISLAND_MATERIAL_BINDINGS, buildIslandKit, createIsland } from '../client/island.js';
import { createEnvironmentAssets, disposeOwnedResources, ENVIRONMENT_ASSET_REGISTRY } from '../client/environment-assets.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const sharedURL = '/assets/old-watch/kit.glb', islandURL = '/assets/island/kit.glb';
const PALM_IDS = ['prop-2', 'prop-3', 'prop-4', 'prop-5', 'prop-15'], ROCK_IDS = ['prop-1', 'prop-6', 'prop-18', 'prop-19'];
const PALM_CELL = 64, SEVENTH = 1 / 7;
// Authored budgets and envelopes from the slice-1 palette card; the shipped kit
// may measure tighter but never wider.
const PREFAB_LIMITS = {
  coast_palm_a: { maxRadius: 4.6, minY: -.40, maxY: 8.6, triangles: 4200 },
  coast_palm_b: { maxRadius: 4.6, minY: -.40, maxY: 7.8, triangles: 4000 },
  coast_rock_a: { maxRadius: 2.50, minY: -.40, maxY: 5.00, triangles: 1400 },
  coast_rock_b: { maxRadius: 2.00, minY: -.40, maxY: 3.00, triangles: 1200 },
  fishing_skiff_a: { maxRadius: 2.4, minY: -.40, maxY: 3.7, triangles: 3200 },
  fishing_skiff_b: { maxRadius: 2.4, minY: -.40, maxY: 3.7, triangles: 3200 },
};
// Each authored root leans on the slots its palette card names, so every binding
// - trunk, both frond kinds, coconut, stone, planking, both paints, canvas, rope
// and iron - has a real target in the fake kit.
const PREFAB_SLOTS = {
  coast_palm_a: ['palm_trunk', 'coast_frond', 'coconut'],
  coast_palm_b: ['palm_trunk', 'coast_frond', 'dead_frond'],
  coast_rock_a: ['coast_stone'],
  coast_rock_b: ['coast_stone'],
  fishing_skiff_a: ['skiff_plank', 'skiff_teal', 'skiff_canvas', 'forged_iron'],
  fishing_skiff_b: ['skiff_plank', 'skiff_coral', 'hemp_rope'],
};
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
    for (const slot of [...PREFAB_SLOTS[name], ...(name === 'coast_rock_a' ? spare : [])]) {
      const material = new THREE.MeshStandardMaterial(); material.name = slot;
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name + '-' + slot;
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
// The recorded coast sites are plain data, so one buildScenery pass feeds every
// runtime test without keeping its original batches alive.
let cachedSites = null;
async function coastSites() {
  if (!cachedSites) {
    const built = await scenery();
    cachedSites = { palmSites: built.coastPalmSites, rockSites: built.coastRockSites };
    releaseScenery(built);
  }
  return cachedSites;
}
async function harness(load, assets) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette());
  const legacyScenery = new THREE.Group(); legacyScenery.name = 'island-coast-original-scenery';
  scene.add(settlements.group, legacyScenery);
  const { palmSites, rockSites } = await coastSites();
  return { scene, settlements, legacyScenery, palmSites, rockSites,
    island: createIsland({ scene, settlements, legacyScenery, load, assets, palmSites, rockSites }) };
}
// A decomposed instance matrix yields a yaw in (-pi, pi]; the recorded sites
// carry a yaw in [0, 2pi), so every comparison wraps first.
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const expectedPalms = palmSites => palmSites.map((site, index) => ({ ...site, prefab: site.id ? 'coast_palm_a' : index % 2 ? 'coast_palm_b' : 'coast_palm_a' }));
function cellsOf(sites) {
  const cells = new Map();
  for (const site of sites) {
    const key = Math.floor(site.x / PALM_CELL) + ':' + Math.floor(site.z / PALM_CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(site);
  }
  return cells;
}
const boatsOf = live => live.settlements.group.userData.skiffs;

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
  assert.equal(live.legacyScenery.visible, true);
  for (const boat of boatsOf(live)) assert.equal(boat.original.visible, true, 'the original hulls carry the harbour until the kit lands');
  assert.equal(await live.island.ready, true); assert.deepEqual(loads, [sharedURL, islandURL]);
  assert.equal(live.island.isReady(), true); assert.equal(live.legacyScenery.visible, false);
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
    'prefabs', 'palms', 'collidablePalms', 'rocks', 'skiffs', 'canopyMeshes', 'cellSize', 'visibleDetailMeshes']);
  assert.equal(stats.status, 'ready'); assert.equal(stats.ready, true); assert.equal(stats.loading, false); assert.equal(stats.fallback, false);
  assert.equal(stats.error, null); assert.equal(stats.prefabs, ISLAND_PREFABS.length); assert.equal(ISLAND_PREFABS.length, 6);
  assert.equal(stats.palms, 38); assert.equal(stats.collidablePalms, 5); assert.equal(stats.rocks, 4); assert.equal(stats.skiffs, 2);
  assert.equal(stats.canopyMeshes, palmMeshes.length); assert.equal(stats.cellSize, PALM_CELL); assert.equal(stats.visibleDetailMeshes, 0);
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
  assert.equal(live.legacyScenery.visible, true); assert.equal(live.scene.getObjectByName('island-coast-environment'), undefined);
  for (const boat of boatsOf(live)) { assert.equal(boat.original.visible, true); assert.deepEqual(boat.group.children, [boat.original]); }
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('missing prefabs and unbound slots fail before any authored coast geometry is installed', async () => {
  const { palmSites, rockSites } = await coastSites();
  const missing = fixtures();
  missing.kit.scene.remove(missing.kit.scene.getObjectByName('fishing_skiff_b'));
  assert.throws(() => buildIslandKit(missing.kit, missing.shared, { palmSites, rockSites }), /fishing_skiff_b/);
  const empty = fixtures();
  empty.kit.scene.getObjectByName('coast_rock_b').clear();
  assert.throws(() => buildIslandKit(empty.kit, empty.shared, { palmSites, rockSites }), /coast_rock_b/);
  const invalid = fixtures();
  invalid.kit.scene.getObjectByName('coast_palm_a').children[0].material.name = 'external_texture';
  assert.throws(() => buildIslandKit(invalid.kit, invalid.shared, { palmSites, rockSites }), /binding is missing: external_texture/);
  const unshared = fixtures();
  unshared.shared.scene.remove(unshared.shared.scene.getObjectByName('material-pine_bark'));
  assert.throws(() => buildIslandKit(unshared.kit, unshared.shared, { palmSites, rockSites }), /binding is missing: palm_trunk/);
  // A partially staged kit disposes every binding it cloned and leaves the shared
  // sources alone.
  const staged = fixtures(), counts = disposalProbe(staged);
  let cloned = 0, released = 0;
  for (const material of staged.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); cloned++; copy.addEventListener('dispose', () => released++); return copy; };
  }
  staged.kit.scene.getObjectByName('fishing_skiff_a').clone = () => { throw new Error('staging interrupted'); };
  assert.throws(() => buildIslandKit(staged.kit, staged.shared, { palmSites, rockSites }), /staging interrupted/);
  assert.ok(cloned > 0); assert.equal(released, cloned);
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  disposeOwnedResources([staged.kit.scene, staged.shared.scene]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('failed, late and rollback-failing coast loads retain the original palms, surf rocks and skiffs', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const cache = createEnvironmentAssets({ load: url => url === sharedURL ? pending : Promise.reject(new Error('coast kit offline')) });
  const failed = await harness(undefined, cache);
  assert.equal(await failed.island.ready, false);
  const stats = failed.island.getStats();
  assert.equal(stats.status, 'fallback'); assert.equal(stats.ready, false); assert.equal(stats.fallback, true);
  assert.match(stats.error, /coast kit offline/); assert.equal(stats.windValue, 0);
  assert.equal(failed.legacyScenery.visible, true, 'the original coast batch stays lit');
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
  assert.equal(offline.legacyScenery.visible, true);
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
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  // A settlement hook that throws on install and again on rollback still leaves
  // the original hulls and scenery standing.
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = await harness(async url => url === sharedURL ? rollbackFixture.shared : rollbackFixture.kit);
  const install = rollback.settlements.setIslandKit;
  rollback.settlements.setIslandKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.island.ready, false);
  assert.match(rollback.island.getStats().error, /install failed; Fallback restore: rollback failed/);
  assert.equal(rollback.legacyScenery.visible, true);
  assert.equal(rollback.scene.getObjectByName('island-coast-environment'), undefined);
  for (const boat of boatsOf(rollback)) { assert.equal(boat.original.visible, true); assert.deepEqual(boat.group.children, [boat.original]); }
  rollback.island.dispose(); assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('shipping island kit is geometry-only, within budget, and keeps every envelope, trunk and vertex tint', async () => {
  const bytes = await readFile(new URL('../client/assets/island/kit.glb', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../client/assets/island/manifest.json', import.meta.url), 'utf8'));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(bytes.readUInt32LE(8), bytes.length); assert.equal(manifest.bytes, bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.ok(bytes.length <= 2.5 * 1024 * 1024, 'kit bytes: ' + bytes.length);
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
  assert.ok(triangles <= 24000, 'source triangles: ' + triangles);
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
  const fixture = fixtures(), { palmSites, rockSites } = await coastSites();
  const built = buildIslandKit(kit, fixture.shared, { palmSites, rockSites, skiffs: [{}, {}] });
  assert.equal(built.counts.prefabs, ISLAND_PREFABS.length); assert.equal(built.counts.palms, 38);
  assert.equal(built.counts.collidablePalms, 5); assert.equal(built.counts.rocks, 4); assert.equal(built.counts.skiffs, 2);
  disposeOwnedResources(built.ownedRoots, [kit.scene, fixture.shared.scene]); disposeOwnedResources([kit.scene, fixture.shared.scene]);
  // The payload budget the loader charges the frame for is the shipped one.
  assert.equal(ENVIRONMENT_ASSET_REGISTRY[islandURL].decodedTextureBytes, 0);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY[islandURL].bytes, manifest.bytes, 'the payload registry carries the shipped byte count');
  assert.equal(ENVIRONMENT_ASSET_REGISTRY[islandURL].triangles, manifest.totalTriangles, 'the payload registry carries the shipped triangle count');
});
