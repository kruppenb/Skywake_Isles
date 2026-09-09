import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildingLocalPoint, buildingWorldPoint } from '../shared/exploration.js';
import { heightAt, seededRandom, SEED, SPAWN } from '../shared/world.js';
import { resolveWorldCollision } from '../shared/collision.js';
import { saltwindHarborWeight } from '../shared/saltwind-harbor.js';
import { DRIFTWOOD_BUILDINGS, SUNWAKE_LANDING_CRATES, SUNWAKE_LANDING_CRATE_CANDIDATES, driftwoodYardWeight, sunwakeStrandWeight,
  driftwoodYardPaths, sunwakeStrandPaths, driftwoodWorkSites, driftwoodPlantClearance } from '../shared/driftwood-yard.js';
import { DRIFTWOOD_YARD_PREFABS, DRIFTWOOD_MATERIAL_BINDINGS, DRIFTWOOD_BUILDING_PREFIXES, createDriftwoodYard, buildDriftwoodYardKit,
  buildDriftwoodYardTerrain, buildSunwakeStrandTerrain } from '../client/driftwood-yard.js';
import { createEnvironmentAssets, disposeOwnedResources } from '../client/environment-assets.js';
import { createEnvironmentLighting, environmentWeights } from '../client/environment-lighting.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const sharedURL = '/assets/old-watch/kit.glb', yardURL = '/assets/driftwood-yard/kit.glb';
function fixtures() {
  const shared = { scene: new THREE.Group() }, yard = { scene: new THREE.Group() };
  const geometry = new THREE.BoxGeometry(.2, .5, .2), materials = new Map();
  for (const name of new Set(['ground_earth', 'needle_foliage', ...Object.values(DRIFTWOOD_MATERIAL_BINDINGS).map(binding => binding.source)])) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true }); material.name = name; materials.set(name, material);
    const carrier = new THREE.Mesh(geometry, material); carrier.name = 'material-' + name; shared.scene.add(carrier);
  }
  const library = new THREE.Group(); library.name = 'grass_clump'; library.add(new THREE.Mesh(geometry, materials.get('needle_foliage'))); shared.scene.add(library);
  const slots = Object.keys(DRIFTWOOD_MATERIAL_BINDINGS);
  DRIFTWOOD_YARD_PREFABS.forEach((name, index) => {
    const root = new THREE.Group(); root.name = name;
    // The pennant line always carries sail_canvas so the wind hook has a target.
    const material = new THREE.MeshStandardMaterial(); material.name = name === 'banner_line' ? 'sail_canvas' : slots[index % slots.length];
    root.add(new THREE.Mesh(geometry, material)); yard.scene.add(root);
  });
  return { shared, yard, geometry, materials };
}
function harness(load, assets) {
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette());
  const legacyVegetation = new THREE.Group(), landingFallback = new THREE.Group();
  scene.add(settlements.group, legacyVegetation, landingFallback);
  return { scene, settlements, legacyVegetation, landingFallback, yard: createDriftwoodYard({ scene, settlements, legacyVegetation, landingFallback, load, assets }) };
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

test('yard and strand weights split the coast, crossfade with the harbor and keep every approach walkable', () => {
  for (const building of DRIFTWOOD_BUILDINGS) assert.equal(driftwoodYardWeight(building.x, building.z), 1, building.id);
  const sites = driftwoodWorkSites(propSites());
  for (const [name, site] of Object.entries(sites)) assert.equal(driftwoodYardWeight(site.x, site.z), 1, name + ' site');
  assert.equal(sunwakeStrandWeight(SPAWN.x, SPAWN.z), 1, 'the landing keeps its own light');
  assert.ok(sunwakeStrandWeight(-15, 96) < 1e-9, 'the harbor square stays the harbor');
  assert.equal(sunwakeStrandWeight(-20, 130), 0, 'open water keeps the baseline');
  assert.equal(driftwoodYardWeight(NaN, 0), 0); assert.equal(sunwakeStrandWeight(0, NaN), 0);
  assert.equal(driftwoodYardWeight(SPAWN.x, SPAWN.z), 0, 'the yard never reaches the drop point');
  assert.equal(sunwakeStrandWeight(36, 102), 0, 'no strand tint on the timber shed');
  assert.ok(saltwindHarborWeight(-6.5, 96) > 0 && sunwakeStrandWeight(-6.5, 96) > 0, 'harbor and strand overlap in the crossfade band');
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#85d9ee'); scene.fog = new THREE.Fog('#a2def0', 180, 610);
  const hemisphere = new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2), sun = new THREE.DirectionalLight('#fff0d0', 2.7);
  const lighting = createEnvironmentLighting({ scene, hemisphere, sun });
  const ready = { oldWatchReady: true, farmReady: true, tideglassReady: true, saltwindReady: true, driftwoodReady: true };
  let lastAmbient;
  for (let step = 0; step <= 700; step++) {
    const player = { x: -25 + step * .1, z: 96 }, weights = environmentWeights(player, ready);
    assert.ok(Object.values(weights).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    lighting.update(player, ready);
    if (lastAmbient != null) assert.ok(Math.abs(hemisphere.intensity - lastAmbient) < .01, 'harbor to strand to yard is one continuous walk');
    lastAmbient = hemisphere.intensity;
  }
  lighting.dispose();
  const yardPaths = driftwoodYardPaths(), strandPaths = sunwakeStrandPaths();
  assert.equal(yardPaths.length, 1 + DRIFTWOOD_BUILDINGS.length * 2); assert.equal(strandPaths.length, 4);
  for (const route of [...yardPaths, ...strandPaths]) for (let i = 1; i < route.length; i++) for (let step = 0; step <= 40; step++) {
    const t = step / 40, x = route[i - 1].x * (1 - t) + route[i].x * t, z = route[i - 1].z * (1 - t) + route[i].z * t;
    const point = { x, z, y: heightAt(x, z) }; resolveWorldCollision(point);
    assert.ok(Math.hypot(point.x - x, point.z - z) < 1e-6, 'public route remains walkable');
  }
  assert.deepEqual(Object.keys(sites), ['hull', 'timber', 'lantern']);
  for (const site of Object.values(sites)) assert.equal(site.poiId, 'driftwood-yard');
  assert.throws(() => driftwoodWorkSites([]), /missing its original hull site/);
  for (const site of Object.values(sites)) assert.equal(driftwoodPlantClearance(site.x, site.z, Object.values(sites)), false, 'work sites are never planted over');
  assert.equal(SUNWAKE_LANDING_CRATE_CANDIDATES.length, 3);
  assert.deepEqual(SUNWAKE_LANDING_CRATES.map(crate => ({ ...crate })), [{ x: 13, z: 101, scale: 1 }, { x: -10, z: 113, scale: .7 }]);
});

test('both ground overlays lie on the actual terrain diagonals, fade at every boundary and skip the floors and the water', () => {
  const yard = buildDriftwoodYardTerrain(new THREE.MeshStandardMaterial()), strand = buildSunwakeStrandTerrain(new THREE.MeshStandardMaterial());
  assert.equal(yard.name, 'driftwood-yard-sawdust-and-worked-sand'); assert.equal(strand.name, 'sunwake-strand-open-sand');
  for (const mesh of [yard, strand]) {
    assert.equal(mesh.material.polygonOffset, false); assert.equal(mesh.material.depthWrite, false); assert.equal(mesh.renderOrder, 2);
    const { position } = mesh.geometry.attributes, indices = mesh.geometry.index;
    for (let i = 0; i < indices.count; i += 3) {
      const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + offset)));
      for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.6, .1, .3]]) {
        const point = vertices.reduce((sum, vertex, index) => sum.addScaledVector(vertex, weights[index]), new THREE.Vector3());
        assert.ok(Math.abs(point.y - .034 - renderedHeightAt(point.x, point.z)) < 2e-6, mesh.name + ': overlay and terrain have the same plane');
      }
    }
  }
  let boundary = 0, covered = 0, floors = 0;
  const yardAttributes = yard.geometry.attributes;
  for (let i = 0; i < yardAttributes.position.count; i++) {
    const x = yardAttributes.position.getX(i), z = yardAttributes.position.getZ(i), alpha = yardAttributes.color.getW(i);
    if (x === 10 || x === 54 || z === 72 || z === 118) { assert.equal(alpha, 0); boundary++; }
    for (const building of DRIFTWOOD_BUILDINGS) {
      const local = buildingLocalPoint(building, x, z);
      if (Math.abs(local.x) < building.width / 2 + .3 && Math.abs(local.z) < building.depth / 2 + .3) { assert.equal(alpha, 0, building.id + ' floor stays clean'); floors++; }
    }
    if (alpha > .3) covered++;
  }
  assert.ok(boundary > 40 && covered > 60); assert.ok(floors >= DRIFTWOOD_BUILDINGS.length * 2, 'both floors are sampled by the grid');
  let strandBoundary = 0, strandCovered = 0, water = 0;
  const strandAttributes = strand.geometry.attributes;
  for (let i = 0; i < strandAttributes.position.count; i++) {
    const x = strandAttributes.position.getX(i), z = strandAttributes.position.getZ(i), alpha = strandAttributes.color.getW(i);
    if (x === -12 || x === 20 || z === 78 || z === 126) { assert.equal(alpha, 0); strandBoundary++; }
    if (heightAt(x, z) < .25) { assert.equal(alpha, 0, 'the overlay stops at the waterline'); water++; }
    if (alpha > .3) strandCovered++;
  }
  assert.ok(strandBoundary > 40 && strandCovered > 60 && water > 0);
  disposeOwnedResources([yard, strand]);
});

test('the yard installs atomically with two furnished cutaways, authored work sites, a ramped pier and swaying pennants', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture), loads = [];
  const live = harness(async url => { loads.push(url); return url === sharedURL ? fixture.shared : fixture.yard; });
  const fallback = live.scene.getObjectByName('driftwood-yard-original-exterior');
  assert.equal(fallback.visible, true); assert.ok(live.scene.getObjectByName('driftwood-yard-original-work-sites'));
  assert.equal(await live.yard.ready, true); assert.deepEqual(loads, [sharedURL, yardURL]);
  assert.equal(fallback.visible, false); assert.equal(live.legacyVegetation.visible, false); assert.equal(live.landingFallback.visible, false);
  const camera = buildingWorldPoint(DRIFTWOOD_BUILDINGS[0], 7, 7);
  for (const building of DRIFTWOOD_BUILDINGS) {
    const roof = live.scene.getObjectByName(building.id + '-authored-cutaway-roof'), walls = live.scene.getObjectByName(building.id + '-authored-cutaway-walls');
    assert.equal(walls.children.length, 4, building.id);
    for (const end of [-1, 1]) {
      const doorway = buildingWorldPoint(building, 0, end * (building.depth / 2 - .1));
      live.settlements.animate(3, { player: { x: doorway.x, z: doorway.z, y: heightAt(doorway.x, doorway.z), mode: 'ground' }, camera: buildingWorldPoint(building, 7, 7) });
      assert.equal(roof.visible, false, building.id + ' roof cutaway triggers from both door approaches');
    }
    live.settlements.animate(4, { player: { x: camera.x, z: camera.z, y: heightAt(camera.x, camera.z), mode: 'ground' }, camera });
  }
  for (const name of ['hull-frame', 'timber-stack', 'yard-lantern']) assert.ok(live.scene.getObjectByName('driftwood-yard-authored-' + name), name);
  let previousY = Infinity, tilted = 0;
  for (let index = 0; index < 5; index++) {
    const section = live.scene.getObjectByName('sunwake-pier-section-' + index);
    assert.ok(section, 'pier section ' + index);
    assert.ok(section.position.y <= previousY + 1e-9, 'the pier only ever ramps down to the water'); previousY = section.position.y;
    assert.ok(section.rotation.x >= 0, 'no section tilts back up the beach'); if (section.rotation.x > 0) tilted++;
  }
  assert.ok(tilted > 0, 'the pier follows the slope instead of stepping');
  assert.ok(Math.abs(previousY - .85) < 1e-9, 'the seaward section bottoms out on the .85 m clamp, just clear of the swell: ' + previousY);
  for (const name of ['sunwake-banner-pole-0', 'sunwake-banner-pole-1', 'sunwake-banner-line', 'sunwake-landing-crates-0', 'sunwake-landing-crates-1']) assert.ok(live.scene.getObjectByName(name), name);
  const stats = live.yard.getStats();
  assert.equal(stats.buildings, 2); assert.equal(stats.workSites, 3); assert.equal(stats.pierSections, 5);
  assert.equal(stats.bannerPoles, 2); assert.equal(stats.crates, 2); assert.ok(stats.logs >= 1 && stats.grass > 20);
  live.yard.animate(10, {}); const angle = live.yard.getStats().windValue;
  live.yard.animate(20, {}); assert.notEqual(live.yard.getStats().windValue, angle, 'sea oats and pennants sway while animated');
  live.yard.animate(30, { player: { x: 0, z: 100 }, lowQuality: true, reducedMotion: true });
  const detail = []; live.scene.traverse(object => { if (object.isInstancedMesh && object.userData.detailKind === 'grass') detail.push(object); });
  assert.ok(detail.length > 0 && detail.some(mesh => mesh.count < mesh.userData.fullCount), 'low quality thins the sea-oat cells');
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; detail[0].material.onBeforeCompile(shader); assert.equal(shader.uniforms.driftwoodWind.value, 0);
  let pennant = null; live.scene.getObjectByName('sunwake-banner-line').traverse(object => { if (object.isMesh && object.material.name === 'sail_canvas') pennant = object; });
  assert.ok(pennant, 'the banner line carries sailcloth pennants'); assert.equal(pennant.material.side, THREE.DoubleSide);
  const cloth = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; pennant.material.onBeforeCompile(cloth);
  assert.equal(cloth.uniforms.driftwoodWind.value, 0); assert.ok(cloth.vertexShader.includes('driftwoodWind'));
  live.yard.animate(40, { player: { x: 90, z: -60 } }); assert.ok(detail.every(mesh => !mesh.visible), 'distant sea-oat cells hide');
  assert.equal(live.scene.getObjectByName('timber-shed-authored-cutaway-roof').parent.visible, true, 'distant architecture remains present');
  live.yard.dispose(); live.yard.dispose();
  assert.equal(fallback.visible, true); assert.equal(live.legacyVegetation.visible, true); assert.equal(live.landingFallback.visible, true);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('yard release preserves a shared Old Watch lease and never mutates cached material bindings', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture);
  const cache = createEnvironmentAssets({ load: async url => url === sharedURL ? fixture.shared : fixture.yard });
  const watchLease = cache.acquire(sharedURL); await watchLease.ready;
  const before = [...fixture.materials.values()].map(material => ({ material, color: material.color.clone(), name: material.name, map: material.map, normalScale: material.normalScale.clone() }));
  const live = harness(undefined, cache); assert.equal(await live.yard.ready, true);
  live.yard.dispose(); assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  for (const entry of before) { assert.ok(entry.material.color.equals(entry.color)); assert.equal(entry.material.name, entry.name); assert.equal(entry.material.map, entry.map); assert.ok(entry.material.normalScale.equals(entry.normalScale)); }
  watchLease.release(); cache.dispose(); assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('failed, late and rollback-failing yard loads retain the dock, the plants and the original exterior', async () => {
  const fixture = fixtures(), counts = disposalProbe(fixture); let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const failed = harness(url => url === sharedURL ? pending : Promise.reject(new Error('yard offline')));
  assert.equal(await failed.yard.ready, false); assert.equal(failed.yard.getStats().status, 'fallback');
  assert.equal(failed.scene.getObjectByName('driftwood-yard-original-exterior').visible, true);
  assert.equal(failed.legacyVegetation.visible, true); assert.equal(failed.landingFallback.visible, true);
  failed.yard.dispose(); deliver(fixture.shared); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const lateFixture = fixtures(), lateCounts = disposalProbe(lateFixture); let lateDeliver;
  const latePending = new Promise(resolve => { lateDeliver = resolve; });
  const late = harness(url => url === sharedURL ? latePending : lateFixture.yard);
  late.yard.dispose(); lateDeliver(lateFixture.shared); assert.equal(await late.yard.ready, false);
  assert.deepEqual(lateCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
  const rollbackFixture = fixtures(), rollbackCounts = disposalProbe(rollbackFixture);
  const rollback = harness(async url => url === sharedURL ? rollbackFixture.shared : rollbackFixture.yard);
  const install = rollback.settlements.setDriftwoodYardKit;
  rollback.settlements.setDriftwoodYardKit = kit => { install(kit); throw new Error(kit ? 'install failed' : 'rollback failed'); };
  assert.equal(await rollback.yard.ready, false); assert.match(rollback.yard.getStats().error, /install failed; Fallback restore: rollback failed/);
  assert.equal(rollback.scene.getObjectByName('driftwood-yard-original-exterior').visible, true);
  assert.equal(rollback.landingFallback.visible, true); assert.equal(rollback.legacyVegetation.visible, true);
  assert.equal(rollback.scene.getObjectByName('driftwood-yard-weathered-environment'), undefined);
  rollback.yard.dispose(); assert.deepEqual(rollbackCounts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('missing prefab, material or original work site fails before authored installation', () => {
  const sites = propSites(), fixture = fixtures();
  fixture.yard.scene.remove(fixture.yard.scene.getObjectByName('timber_shed_roof'));
  assert.throws(() => buildDriftwoodYardKit(fixture.yard, fixture.shared, { propSites: sites }), /timber_shed_roof/);
  const invalid = fixtures(); invalid.yard.scene.children[0].children[0].material.name = 'external_texture';
  assert.throws(() => buildDriftwoodYardKit(invalid.yard, invalid.shared, { propSites: sites }), /binding is missing: external_texture/);
  const unsited = fixtures();
  assert.throws(() => buildDriftwoodYardKit(unsited.yard, unsited.shared, { propSites: sites.filter(site => site.radius !== 2) }), /timber stack site/);
});

test('partial prefab staging disposes every new binding without releasing source textures', () => {
  const sites = propSites(), fixture = fixtures(), counts = disposalProbe(fixture);
  let cloned = 0, released = 0;
  for (const material of fixture.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); cloned++; copy.addEventListener('dispose', () => released++); return copy; };
  }
  fixture.yard.scene.getObjectByName('shipwright_cottage_roof').clone = () => { throw new Error('staging interrupted'); };
  assert.throws(() => buildDriftwoodYardKit(fixture.yard, fixture.shared, { propSites: sites }), /staging interrupted/);
  assert.ok(cloned > 0); assert.equal(released, cloned);
  assert.deepEqual(counts, { geometry: 0, material: 0, texture: 0, bitmap: 0 });
  disposeOwnedResources([fixture.yard.scene, fixture.shared.scene]);
  assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, bitmap: 1 });
});

test('a failed shared-library load releases the separately arriving yard source', async () => {
  const fixture = fixtures(); let deliver, disposed = 0;
  fixture.yard.scene.children[0].children[0].material.addEventListener('dispose', () => disposed++);
  const pending = new Promise(resolve => { deliver = resolve; });
  const live = harness(url => url === yardURL ? pending : Promise.reject(new Error('shared offline')));
  assert.equal(await live.yard.ready, false); assert.match(live.yard.getStats().error, /shared offline/);
  deliver(fixture.yard); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(live.scene.getObjectByName('driftwood-yard-original-exterior').visible, true);
  assert.equal(live.landingFallback.visible, true);
  live.yard.dispose(); assert.equal(disposed, 1);
});

test('shipping yard is geometry-only, within budget, reproducibly manifested and keeps all four doorways clear', async () => {
  const bytes = await readFile(new URL('../client/assets/driftwood-yard/kit.glb', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../client/assets/driftwood-yard/manifest.json', import.meta.url), 'utf8'));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(bytes.readUInt32LE(8), bytes.length); assert.equal(manifest.bytes, bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.ok(bytes.length < 3.5 * 1024 * 1024); assert.equal((gltf.images ?? []).length, 0); assert.equal((gltf.textures ?? []).length, 0);
  assert.deepEqual(manifest.materialBindings, DRIFTWOOD_MATERIAL_BINDINGS);
  for (const name of DRIFTWOOD_YARD_PREFABS) assert.ok(gltf.nodes.some(node => node.name === name), name);
  let triangles = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) assert.ok(primitive.attributes[attribute] >= 0, attribute);
    assert.ok(DRIFTWOOD_MATERIAL_BINDINGS[gltf.materials[primitive.material].name]);
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  assert.ok(triangles > 15000 && triangles < 40000); assert.equal(triangles, manifest.totalTriangles);
  const yard = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (const name of DRIFTWOOD_YARD_PREFABS) {
    const root = yard.scene.getObjectByName(name); assert.ok(root.position.length() < 1e-6); assert.ok(root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6); assert.ok(root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6);
  }
  for (const building of DRIFTWOOD_BUILDINGS) {
    const prefix = DRIFTWOOD_BUILDING_PREFIXES[building.id];
    assert.deepEqual([manifest.buildingContracts[prefix].width, manifest.buildingContracts[prefix].depth, manifest.buildingContracts[prefix].wallHeight], [building.width, building.depth, building.wallHeight], prefix);
    for (const part of ['base', 'wall_front', 'wall_back']) yard.scene.getObjectByName(prefix + '_' + part).traverse(object => {
      if (!object.isMesh) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        assert.ok(!(Math.abs(x) < building.doorWidth / 2 - .002 && y > .03 && y < building.doorHeight - .002 && Math.abs(z) > building.depth / 2 - building.wallThickness && Math.abs(z) < building.depth / 2 + .1), prefix + ': both doorway prisms remain clear');
      }
    });
    const roof = new THREE.Box3().setFromObject(yard.scene.getObjectByName(prefix + '_roof'));
    assert.ok(roof.max.y <= building.height + 1e-4 && roof.min.y >= building.wallHeight - .002, prefix + ' roof stays inside the shared height envelope');
  }
  const fixture = fixtures();
  const kit = buildDriftwoodYardKit(yard, fixture.shared, { propSites: propSites() });
  assert.deepEqual(Object.keys(kit.buildings), DRIFTWOOD_BUILDINGS.map(building => building.id));
  assert.equal(kit.counts.buildings, 2); assert.equal(kit.counts.workSites, 3);
  disposeOwnedResources(kit.ownedRoots, [yard.scene, fixture.shared.scene]); disposeOwnedResources([yard.scene, fixture.shared.scene]);
});

test('scenery routes the landing and the yard plants into their own restorable batches', async () => {
  const { buildScenery } = await import('../client/world.js');
  const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  const palette = makePalette(), scenery = buildScenery(palette, random);
  assert.ok(scenery.driftwoodLegacyVegetation && scenery.sunwakeLandingFallback);
  assert.equal(scenery.driftwoodLegacyVegetation.visible, true); assert.equal(scenery.sunwakeLandingFallback.visible, true);
  assert.ok(scenery.driftwoodLegacyVegetation.geometry.attributes.position.count > 0);
  const landing = scenery.sunwakeLandingFallback.geometry.attributes.position;
  assert.ok(landing.count > 0);
  let dock = 0, poles = 0, strays = 0;
  for (let index = 0; index < landing.count; index++) {
    const x = landing.getX(index), z = landing.getZ(index);
    if (Math.abs(x) < 3 && z > 114) dock++;
    if (Math.abs(Math.abs(x) - 7) < 1 && Math.abs(z - 101) < 1) poles++;
    if (x > 20) strays++;
  }
  assert.ok(dock > 0, 'the original dock planks stay in the landing batch');
  assert.ok(poles > 0, 'both pennant poles stay in the landing batch');
  assert.equal(strays, 0, 'nothing from the yard is routed into the landing fallback');
  disposeOwnedResources(scenery.group);
  for (const geometry of Object.values(palette.geometry)) geometry.dispose();
});
