import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createEnvironmentAssets, disposeOwnedResources, ENVIRONMENT_ASSET_REGISTRY, textureMemoryBytes } from '../client/environment-assets.js';
import { createEnvironmentLighting, environmentWeights } from '../client/environment-lighting.js';
import { renderedHeightAt, TERRAIN_GRID_STEP, TERRAIN_GRID_COUNT, TERRAIN_ORIGIN } from '../client/environment-geometry.js';
import { oldWatchWeight, oldWatchRadialWeight } from '../shared/old-watch.js';
import { heightAt, seededRandom, SEED } from '../shared/world.js';
import { makePalette } from '../client/models.js';

const watchURL = '/assets/old-watch/kit.glb', farmURL = '/assets/windward-farm/kit.glb', marketURL = '/assets/tideglass-market/kit.glb', harborURL = '/assets/saltwind-harbor/kit.glb', yardURL = '/assets/driftwood-yard/kit.glb', campURL = '/assets/palmheart-camp/kit.glb', forgeURL = '/assets/cinderworks/kit.glb', moonwatchURL = '/assets/moonwatch/kit.glb', islandURL = '/assets/island/kit.glb';
function fixture() {
  const counts = { geometry: 0, material: 0, texture: 0, image: 0 };
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const texture = new THREE.Texture({ width: 8, height: 4, close() { counts.image++; } });
  geometry.addEventListener('dispose', () => counts.geometry++);
  material.addEventListener('dispose', () => counts.material++);
  texture.addEventListener('dispose', () => counts.texture++);
  material.map = material.normalMap = texture;
  const scene = new THREE.Group(); scene.add(new THREE.Mesh(geometry, material));
  return { scene, geometry, material, texture, counts };
}

test('asset leases share one load and borrowed instance materials do not release source maps', async () => {
  const asset = fixture(); let loads = 0;
  const cache = createEnvironmentAssets({ load: async () => { loads++; return asset; } });
  const first = cache.acquire(watchURL), second = cache.acquire(watchURL);
  assert.equal(await first.ready, await second.ready); assert.equal(loads, 1);
  const group = new THREE.Group(), material = asset.material.clone();
  const instance = new THREE.InstancedMesh(asset.geometry, material, 1); group.add(instance);
  let materials = 0, instances = 0;
  material.addEventListener('dispose', () => materials++); instance.addEventListener('dispose', () => instances++);
  disposeOwnedResources([group], [asset.scene]); disposeOwnedResources([group], [asset.scene]);
  assert.equal(materials, 1); assert.equal(instances, 1);
  assert.deepEqual(asset.counts, { geometry: 0, material: 0, texture: 0, image: 0 });
  first.release(); first.release();
  assert.equal(cache.getStats().leases, 1); assert.equal(cache.getStats().downloadedBytes, 7584620);
  cache.dispose(); cache.dispose(); assert.throws(() => cache.acquire(farmURL), /disposed/);
  assert.equal(asset.counts.texture, 0, 'terminal cache waits for existing users');
  second.release(); assert.deepEqual(asset.counts, { geometry: 1, material: 1, texture: 1, image: 1 });
  assert.deepEqual(cache.getStats().loadedURLs, []); assert.equal(cache.getStats().decodedTextureBytes, 0);
});

test('cross-kit roots retain shared resources and decoded image accounting counts source identity once', async () => {
  const source = fixture(), otherScene = new THREE.Group(), clone = source.material.clone(), textureClone = source.texture.clone();
  clone.map = clone.normalMap = textureClone; otherScene.add(new THREE.Mesh(source.geometry, clone));
  let clonedTextures = 0; textureClone.addEventListener('dispose', () => clonedTextures++);
  const cache = createEnvironmentAssets({ load: async url => url === watchURL ? source : { scene: otherScene } });
  const first = cache.acquire(watchURL), second = cache.acquire(farmURL); await Promise.all([first.ready, second.ready]);
  assert.equal(cache.getStats().textureCount, 2); assert.equal(cache.getStats().decodedImages, 1);
  assert.equal(cache.getStats().decodedTextureBytes, (32 + 8 + 2 + 1) * 4);
  first.release(); assert.equal(source.counts.geometry, 0); assert.equal(source.counts.image, 0);
  assert.equal(source.counts.material, 1); assert.equal(source.counts.texture, 1);
  second.release(); cache.dispose();
  assert.deepEqual(source.counts, { geometry: 1, material: 1, texture: 1, image: 1 }); assert.equal(clonedTextures, 1);
});

test('released pending and failed leases clean late completion, and failed URLs can retry', async () => {
  const asset = fixture(); let resolve, attempts = 0;
  const cache = createEnvironmentAssets({ load: () => new Promise(done => { resolve = done; }) });
  const lease = cache.acquire(watchURL); await Promise.resolve(); lease.release(); cache.dispose(); resolve(asset);
  assert.equal(await lease.ready, asset); lease.release(); cache.dispose();
  assert.deepEqual(asset.counts, { geometry: 1, material: 1, texture: 1, image: 1 });
  assert.equal(cache.getStats().loading, 0); assert.equal(cache.getStats().loadedURLs.length, 0);
  const retry = createEnvironmentAssets({ load: async () => { if (++attempts === 1) throw new Error('offline'); return fixture(); } });
  assert.throws(() => retry.acquire('https://example.com/kit.glb'), /local kit URL/);
  const failed = retry.acquire(watchURL); await assert.rejects(failed.ready, /offline/); failed.release();
  const next = retry.acquire(watchURL); await next.ready; assert.equal(attempts, 2); next.release(); retry.dispose();
});

test('invalid default scenes still release resources in additional imported scenes', async () => {
  const asset = fixture(), cache = createEnvironmentAssets({ load: async () => ({ scenes: [asset.scene] }) });
  const lease = cache.acquire(watchURL); await assert.rejects(lease.ready, /no scene/); lease.release(); cache.dispose();
  assert.deepEqual(asset.counts, { geometry: 1, material: 1, texture: 1, image: 1 });
});

test('one lighting owner preserves the approved core and restores its immutable baseline', () => {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#85d9ee'); scene.fog = new THREE.Fog('#a2def0', 180, 610);
  const hemisphere = new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2), sun = new THREE.DirectionalLight('#fff0d0', 2.7);
  const lighting = createEnvironmentLighting({ scene, hemisphere, sun });
  const ready = { oldWatchReady: true, farmReady: true, tideglassReady: true };
  lighting.update({ x: -66, z: -76, mode: 'ground' }, ready);
  assert.equal(hemisphere.intensity, 1.5); assert.equal(sun.intensity, 2.25); assert.equal(scene.fog.near, 72); assert.equal(scene.fog.far, 340);
  const expectedSky = new THREE.Color('#85d9ee').lerp(new THREE.Color('#abc6cc'), .8);
  assert.ok(scene.background.equals(expectedSky));
  const core = scene.background.toArray();
  for (let i = 0; i < 50; i++) { lighting.update({ x: -42, z: -53 }, ready); lighting.update({ x: -66, z: -76 }, ready); }
  assert.deepEqual(scene.background.toArray(), core, 'frame history cannot accumulate color drift');
  lighting.update({ x: -42, z: -53 }, ready); assert.equal(hemisphere.intensity, 1.7); assert.equal(sun.intensity, 2.4);
  lighting.update({ x: -66, z: -76, mode: 'aboard' }, ready);
  assert.equal(hemisphere.intensity, 2.2); assert.equal(scene.background.getHexString(), '85d9ee');
  lighting.update({ x: -66, z: -76 }, ready); lighting.dispose(); lighting.dispose();
  assert.equal(scene.background.getHexString(), '85d9ee'); assert.equal(scene.fog.near, 180); assert.equal(scene.fog.far, 610);
  assert.equal(hemisphere.intensity, 2.2); assert.equal(sun.intensity, 2.7);
  lighting.update({ x: -66, z: -76 }, ready); assert.equal(hemisphere.intensity, 2.2);
});

test('lighting normalizes overlaps and retains the farm exclusion only when the farm fails', () => {
  const player = { x: -54, z: -60, mode: 'ground' }, failed = environmentWeights(player, { oldWatchReady: true, farmReady: false });
  assert.equal(failed.oldWatch, oldWatchWeight(player.x, player.z)); assert.equal(failed.oldWatch, 0); assert.equal(failed.baseline, 1);
  assert.ok(oldWatchRadialWeight(player.x, player.z) > 0);
  const ready = environmentWeights(player, { oldWatchReady: true, farmReady: true });
  assert.ok(ready.oldWatch > 0 && ready.windwardFarm > 0); assert.equal(ready.baseline, 0);
  assert.ok(Math.abs(ready.oldWatch + ready.windwardFarm - 1) < 1e-12);
  assert.deepEqual(environmentWeights({ x: NaN, z: 0 }, { oldWatchReady: true, farmReady: true }), { baseline: 1, oldWatch: 0, windwardFarm: 0, tideglassMarket: 0, saltwindHarbor: 0, driftwoodYard: 0, sunwakeStrand: 0, palmheartCamp: 0, cinderworks: 0, moonwatch: 0 });
  let last;
  for (let i = 0; i <= 330; i++) {
    const t = i / 330, weights = environmentWeights({ x: -66 + 24 * t, z: -76 + 23 * t }, { oldWatchReady: true, farmReady: true });
    const ambient = weights.baseline * 2.2 + weights.oldWatch * 1.5 + weights.windwardFarm * 1.7;
    if (last != null) assert.ok(Math.abs(ambient - last) < .01, 'continuous walking transition');
    last = ambient;
  }
});

test('coastal lighting depends on market readiness and restores the baseline aboard and beyond the bounded area', () => {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#85d9ee'); scene.fog = new THREE.Fog('#a2def0', 180, 610);
  const hemisphere = new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2), sun = new THREE.DirectionalLight('#fff0d0', 2.7);
  const lighting = createEnvironmentLighting({ scene, hemisphere, sun }), ready = { oldWatchReady: true, farmReady: true, tideglassReady: true };
  const player = { x: -29, z: 39, mode: 'ground' }, baseline = { baseline: 1, oldWatch: 0, windwardFarm: 0, tideglassMarket: 0, saltwindHarbor: 0, driftwoodYard: 0, sunwakeStrand: 0, palmheartCamp: 0, cinderworks: 0, moonwatch: 0 };
  assert.deepEqual(environmentWeights(player, { ...ready, tideglassReady: false }), baseline);
  assert.deepEqual(environmentWeights(player, ready), { ...baseline, baseline: 0, tideglassMarket: 1 });
  lighting.update(player, ready); assert.equal(hemisphere.intensity, 1.85); assert.equal(sun.intensity, 2.5); assert.equal(scene.fog.near, 95); assert.equal(scene.fog.far, 405);
  const sky = scene.background.toArray(); let lastAmbient;
  for (let step = 0; step <= 1000; step++) {
    const weights = environmentWeights({ x: -29 + step * .1, z: 39 }, ready);
    assert.ok(Object.values(weights).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    lighting.update({ x: -29 + step * .1, z: 39 }, ready);
    if (lastAmbient != null) assert.ok(Math.abs(hemisphere.intensity - lastAmbient) < .01, 'coastal walk has continuous lighting');
    lastAmbient = hemisphere.intensity;
  }
  lighting.update(player, ready); assert.deepEqual(scene.background.toArray(), sky, 'returning does not accumulate color drift');
  for (const outside of [{ ...player, mode: 'aboard' }, { x: -68, z: 12 }, { x: -15, z: 96 }, { x: 30, z: 96 }, { x: 76, z: 32 }]) {
    assert.deepEqual(environmentWeights(outside, ready), baseline); lighting.update(outside, ready);
    assert.equal(scene.background.getHexString(), '85d9ee'); assert.equal(hemisphere.intensity, 2.2); assert.equal(sun.intensity, 2.7);
  }
  lighting.update(player, ready); lighting.dispose(); lighting.dispose(); assert.equal(scene.background.getHexString(), '85d9ee'); assert.equal(scene.fog.near, 180);
});

test('terrain helper follows the actual grid, including off-diagonal barycentric samples', () => {
  assert.equal(TERRAIN_GRID_STEP, 2); assert.equal(TERRAIN_ORIGIN + TERRAIN_GRID_STEP * TERRAIN_GRID_COUNT, -TERRAIN_ORIGIN);
  for (const ix of [33, 34, 55, 56]) for (const iz of [36, 37, 48, 49]) {
    const x = TERRAIN_ORIGIN + ix * 2, z = TERRAIN_ORIGIN + iz * 2;
    const vertices = [[x, z], [x + 2, z], [x, z + 2], [x + 2, z + 2]];
    const triangles = (ix + iz) % 2 ? [[0, 2, 1], [1, 2, 3]] : [[0, 3, 1], [0, 2, 3]];
    for (const triangle of triangles) {
      const weights = [.17, .32, .51]; let px = 0, pz = 0, expected = 0;
      triangle.forEach((index, i) => { const [vx, vz] = vertices[index]; px += vx * weights[i]; pz += vz * weights[i]; expected += heightAt(vx, vz) * weights[i]; });
      assert.ok(Math.abs(renderedHeightAt(px, pz) - expected) < 1e-10);
    }
  }
});

test('registered island payload and texture costs match the committed kit manifests', async () => {
  assert.deepEqual(Object.keys(ENVIRONMENT_ASSET_REGISTRY), [watchURL, farmURL, marketURL, harborURL, yardURL, campURL, forgeURL, moonwatchURL, islandURL]);
  for (const [url, cost] of Object.entries(ENVIRONMENT_ASSET_REGISTRY)) {
    const manifest = JSON.parse(await readFile(new URL('../client' + url.replace('/kit.glb', '/manifest.json'), import.meta.url)));
    const bytes = await readFile(new URL('../client' + url, import.meta.url));
    assert.equal(cost.bytes, bytes.length); assert.equal(cost.bytes, manifest.bytes); assert.equal(cost.triangles, manifest.totalTriangles);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
    const decoded = manifest.textures.reduce((sum, image) => sum + textureMemoryBytes({ source: { data: image }, generateMipmaps: true }), 0);
    assert.equal(cost.decodedTextureBytes, decoded);
  }
});

test('routing scenery into area batches preserves all original geometry and the procedural RNG stream', async () => {
  const { buildScenery } = await import('../client/world.js');
  const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  const palette = makePalette(), scenery = buildScenery(palette, random), triangles = [];
  scenery.group.traverse(mesh => {
    if (!mesh.isMesh) return;
    const attributes = ['position', 'normal', 'color'].map(key => mesh.geometry.attributes[key].array);
    for (let i = 0; i < attributes[0].length; i += 9) {
      const hash = createHash('sha256');
      for (const array of attributes) hash.update(Buffer.from(array.buffer, array.byteOffset + i * 4, 36));
      triangles.push(hash.digest('hex'));
    }
  });
  // Recorded from approved 2c2d3fe. Multiset ignores the new batch boundaries.
  assert.equal(triangles.length, 141650);
  assert.equal(createHash('sha256').update(triangles.sort().join('')).digest('hex'), 'e736a67408d0084a776ac3764d157715b251f4f7be410279181fefa9c562080c');
  assert.equal(random(), .017430383479222655);
  assert.deepEqual(scenery.tideglassHutSites.map(({ id, x, z, radius, height, yaw }) => ({ id, x, z, radius, height, yaw })), [
    { id: 'prop-16', x: -20, z: 15, radius: 3.2, height: 5, yaw: .19684114179108292 },
    { id: 'prop-17', x: 18, z: 27, radius: 3.2, height: 5, yaw: .014833393855951726 },
  ], 'replacement huts retain the original layout and random yaws');
  assert.equal(scenery.group.userData.tideglassHutSites, scenery.tideglassHutSites);
  assert.equal(scenery.tideglassHutFallback.visible, true); assert.equal(scenery.tideglassLegacyVegetation.visible, true);
  assert.ok(scenery.tideglassHutFallback.geometry.attributes.position.count > 0);
  const plants = scenery.tideglassLegacyVegetation.geometry.attributes.position;
  for (let index = 0; index < plants.count; index++) assert.ok(plants.getY(index) < heightAt(plants.getX(index), plants.getZ(index)) + 1.2, 'coastal replacement only hides small ground vegetation, retaining palms');
  disposeOwnedResources(scenery.group);
  for (const geometry of Object.values(palette.geometry)) geometry.dispose();
});
