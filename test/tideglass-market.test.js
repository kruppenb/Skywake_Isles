import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BUILDINGS, RESIDENTS, EXPLORATION_TRAILS, buildingWorldPoint, buildingLocalPoint, trailDistance } from '../shared/exploration.js';
import { BEACON, SPAWN, SHRINES, CHESTS, OBSTACLES, heightAt } from '../shared/world.js';
import { resolveWorldCollision } from '../shared/collision.js';
import { tideglassWeight, tideglassPaths, tideglassPathDistance, tideglassPlantClearance } from '../shared/tideglass-market.js';
import { TIDEGLASS_MARKET_PREFABS, TIDEGLASS_MATERIAL_BINDINGS, buildTideglassMarketKit, buildTideglassTerrain, createTideglassMarket } from '../client/tideglass-market.js';
import { OLD_WATCH_PREFABS, createOldWatch } from '../client/old-watch.js';
import { WINDWARD_FARM_PREFABS, WINDWARD_FARM_MATERIAL_BINDINGS, createWindwardFarm } from '../client/windward-farm.js';
import { createEnvironmentAssets, disposeOwnedResources } from '../client/environment-assets.js';
import { renderedHeightAt } from '../client/environment-geometry.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';

const sharedURL = '/assets/old-watch/kit.glb', farmURL = '/assets/windward-farm/kit.glb', marketURL = '/assets/tideglass-market/kit.glb';
const cottage = BUILDINGS.find(building => building.id === 'market-cottage');
const prefabNames = ['cottage_base', 'cottage_wall_east', 'cottage_wall_west', 'cottage_wall_front', 'cottage_wall_back', 'cottage_roof', 'fruit_stall', 'sailcloth_stall', 'haven_hut', 'paving_slab', 'coastal_shrub'];
const hash = value => createHash('sha256').update(value).digest('hex');
const nextTick = () => new Promise(resolve => setImmediate(resolve));
function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
}
function sampleRoute(route, visit, steps = 40) {
  for (let i = 1; i < route.length; i++) for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    visit({ x: route[i - 1].x * (1 - t) + route[i].x * t, z: route[i - 1].z * (1 - t) + route[i].z * t });
  }
}
function settlementsFixture(t) {
  const palette = makePalette(), settlements = buildSettlements(palette);
  t.after(() => { disposeOwnedResources(settlements.group); for (const geometry of Object.values(palette.geometry)) geometry.dispose(); });
  return settlements;
}

// Separate extension geometries/materials reproduce real GLB ownership. Shared
// map identity is intentional: every area borrows the same decoded images.
function fixtures() {
  const shared = { scene: new THREE.Group() }, farm = { scene: new THREE.Group() }, market = { scene: new THREE.Group() };
  const materials = new Map(), geometries = [new THREE.BoxGeometry(.2, .5, .2), new THREE.BoxGeometry(.3, .6, .3), new THREE.BoxGeometry(.4, .7, .4)];
  const textures = [new THREE.Texture({ width: 16, height: 16, close() {} }), new THREE.Texture({ width: 8, height: 8, close() {} })];
  const sources = new Set(['ground_earth', ...Object.values(WINDWARD_FARM_MATERIAL_BINDINGS).map(binding => binding.source), ...Object.values(TIDEGLASS_MATERIAL_BINDINGS).map(binding => binding.source)]);
  for (const name of sources) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, color: new THREE.Color(.45, .6, .7), map: textures[0], normalMap: textures[1] });
    material.name = name; material.normalScale.set(.4, .6); materials.set(name, material);
    const carrier = new THREE.Mesh(geometries[0], material); carrier.name = 'material-' + name; shared.scene.add(carrier);
  }
  for (const name of OLD_WATCH_PREFABS) {
    const root = new THREE.Group(); root.name = name;
    root.add(new THREE.Mesh(geometries[0], materials.get(name === 'ground_sample' ? 'ground_earth' : name.includes('clump') || name.includes('pine') ? 'needle_foliage' : 'watch_stone')));
    shared.scene.add(root);
  }
  for (const [asset, names, bindings, geometry] of [[farm, WINDWARD_FARM_PREFABS, WINDWARD_FARM_MATERIAL_BINDINGS, geometries[1]], [market, TIDEGLASS_MARKET_PREFABS, TIDEGLASS_MATERIAL_BINDINGS, geometries[2]]]) {
    const slots = Object.keys(bindings);
    names.forEach((name, index) => {
      const root = new THREE.Group(); root.name = name;
      for (const slot of [slots[index % slots.length], slots[(index + 3) % slots.length]]) {
        const material = new THREE.MeshStandardMaterial(); material.name = slot; root.add(new THREE.Mesh(geometry, material));
      }
      asset.scene.add(root);
    });
  }
  return { shared, farm, market, materials, geometries, textures, load: async url => ({ [sharedURL]: shared, [farmURL]: farm, [marketURL]: market })[url] };
}
function resourceProbe(...roots) {
  const counts = new Map();
  const observe = resource => {
    if (!resource || counts.has(resource)) return;
    counts.set(resource, 0);
    if (resource.addEventListener) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
    else { const close = resource.close; resource.close = () => { counts.set(resource, counts.get(resource) + 1); close.call(resource); }; }
  };
  for (const root of roots) root.traverse(object => {
    if (object.isInstancedMesh) observe(object);
    observe(object.geometry);
    for (const material of !object.material ? [] : Array.isArray(object.material) ? object.material : [object.material]) {
      observe(material);
      for (const texture of Object.values(material).filter(value => value?.isTexture)) { observe(texture); if (texture.source?.data?.close) observe(texture.source.data); }
    }
  });
  return { counts, assert(value) { assert.ok(counts.size > 0); for (const [resource, count] of counts) assert.equal(count, value, (resource.name || resource.type || 'image') + ' disposal count'); } };
}
function graphSnapshot(root) {
  const result = [];
  root.traverse(object => result.push({ object, parent: object.parent, position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), matrix: object.matrix.toArray(), matrixWorld: object.matrixWorld.toArray(), geometry: object.geometry, material: object.material }));
  return result;
}
function harness(t, options = {}) {
  const scene = options.scene ?? new THREE.Scene(), settlements = options.settlements ?? settlementsFixture(t), legacyVegetation = new THREE.Group(), hutFallback = new THREE.Group();
  const hutSites = OBSTACLES.filter(obstacle => obstacle.type === 'hut').map((site, index) => ({ ...site, yaw: .1 + index * .15 }));
  scene.add(settlements.group, legacyVegetation, hutFallback);
  const market = createTideglassMarket({ scene, settlements, legacyVegetation, hutFallback, hutSites, ...options });
  t.after(() => market.dispose());
  return { scene, settlements, legacyVegetation, hutFallback, hutSites, market };
}
let shippingPromise;
function shipping() {
  return shippingPromise ??= (async () => {
    const bytes = await readFile(new URL('../client/assets/tideglass-market/kit.glb', import.meta.url));
    const manifest = JSON.parse(await readFile(new URL('../client/assets/tideglass-market/manifest.json', import.meta.url), 'utf8'));
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    return { bytes, manifest, gltf, asset };
  })();
}
function triangles(root, visit) {
  root.traverse(object => {
    if (!object.isMesh) return;
    const { position } = object.geometry.attributes, index = object.geometry.index;
    for (let offset = 0; offset < (index?.count ?? position.count); offset += 3) {
      const vertices = [0, 1, 2].map(i => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(offset + i) : offset + i));
      visit(new THREE.Triangle(...vertices), object);
    }
  });
}

test('shipping Tideglass contains only original geometry and its actual payload matches its shared-library manifest', async () => {
  const { bytes, manifest, gltf, asset } = await shipping();
  assert.deepEqual(TIDEGLASS_MARKET_PREFABS, prefabNames);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(manifest.bytes, bytes.length); assert.equal(manifest.sha256, hash(bytes)); assert.ok(bytes.length <= 2.3 * 1024 * 1024);
  assert.equal(manifest.generator, 'tools/build-tideglass-market.py'); assert.ok(Number.isInteger(manifest.seed));
  assert.equal(manifest.coordinateSystem, 'Y-up, meters, +Z front'); assert.match(manifest.sourceLicense, /Original Skywake Isles/);
  assert.deepEqual(manifest.materialBindings, TIDEGLASS_MATERIAL_BINDINGS);
  assert.deepEqual(manifest.textures, []); assert.equal((gltf.images ?? []).length, 0); assert.equal((gltf.textures ?? []).length, 0);
  assert.equal(manifest.embeddedImageCount, 0); assert.equal(manifest.decodedTextureBytes, 0);
  assert.ok(gltf.buffers.every(buffer => !buffer.uri), 'no external buffer or image fetches');
  const sharedManifest = JSON.parse(await readFile(new URL('../client/assets/old-watch/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies.length, 1); assert.equal(manifest.dependencies[0].url, sharedURL); assert.equal(manifest.dependencies[0].sha256, sharedManifest.sha256);
  assert.deepEqual(Object.keys(manifest.prefabs).sort(), [...prefabNames].sort());
  assert.deepEqual(gltf.scenes[gltf.scene ?? 0].nodes.map(index => gltf.nodes[index].name).sort(), [...prefabNames].sort());
  let totalTriangles = 0, totalPrimitives = 0;
  for (const name of prefabNames) {
    const root = asset.scene.getObjectByName(name), recorded = manifest.prefabs[name]; let count = 0, primitives = 0, radius = 0;
    const bounds = new THREE.Box3();
    root.traverse(object => {
      assert.ok(object.position.length() < 1e-6); assert.ok(object.quaternion.angleTo(new THREE.Quaternion()) < 1e-6); assert.ok(object.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6);
      if (!object.isMesh) return;
      primitives++;
      const attributes = object.geometry.attributes, material = object.material;
      assert.ok(TIDEGLASS_MATERIAL_BINDINGS[material.name], 'declared material ' + material.name); assert.equal(material.transparent, false);
      for (const key of ['position', 'normal', 'uv', 'color']) {
        assert.ok(attributes[key], name + ' ' + key); assert.equal(attributes[key].count, attributes.position.count);
        assert.ok([...attributes[key].array].every(Number.isFinite), name + ' finite ' + key);
      }
      for (let i = 0; i < attributes.position.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(attributes.position, i); bounds.expandByPoint(point); radius = Math.max(radius, Math.hypot(point.x, point.z));
        assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(attributes.normal, i).length() - 1) < .002, name + ' unit normals');
      }
      count += (object.geometry.index?.count ?? attributes.position.count) / 3;
    });
    assert.equal(count, recorded.triangles); assert.equal(primitives, recorded.primitives);
    for (const side of ['min', 'max']) bounds[side].toArray().forEach((value, index) => assert.ok(Math.abs(value - recorded.bounds[side][index]) < 2e-5, name + ' recorded bounds'));
    assert.ok(Math.abs(radius - recorded.horizontalRadius) < 2e-5, name + ' recorded radius');
    totalTriangles += count; totalPrimitives += primitives;
  }
  assert.ok(totalTriangles > 4000 && totalTriangles <= 24000); assert.equal(manifest.totalTriangles, totalTriangles);
  assert.equal(manifest.totalPrimitives, totalPrimitives);
  assert.equal(gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0), totalPrimitives);
});

test('actual cottage triangles preserve both full door prisms, cutaway heights and shared collision envelopes', async () => {
  const { asset } = await shipping(), epsilon = .002;
  for (const name of prefabNames.filter(name => name.startsWith('cottage_'))) {
    const root = asset.scene.getObjectByName(name), bounds = new THREE.Box3().setFromObject(root);
    const roof = name === 'cottage_roof';
    assert.ok(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) <= cottage.width / 2 + (roof ? .16 : epsilon), name + ' width');
    assert.ok(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)) <= cottage.depth / 2 + (roof ? .16 : epsilon), name + ' depth');
    assert.ok(bounds.max.y <= (roof ? cottage.height : name === 'cottage_base' ? .48 : cottage.wallHeight) + epsilon, name + ' height');
    if (name.startsWith('cottage_wall_')) assert.ok(bounds.min.y >= .48 - epsilon, 'upper cutaway starts above retained footing');
    for (const end of [-1, 1]) {
      const center = end * (cottage.depth / 2 - cottage.wallThickness / 2);
      const door = new THREE.Box3(new THREE.Vector3(-cottage.doorWidth / 2 + epsilon, .03, center - cottage.wallThickness / 2 - .02), new THREE.Vector3(cottage.doorWidth / 2 - epsilon, cottage.doorHeight - epsilon, center + cottage.wallThickness / 2 + .02));
      triangles(root, triangle => assert.equal(door.intersectsTriangle(triangle), false, name + ' triangle crosses ' + end + ' doorway'));
    }
  }
  const roof = new THREE.Box3().setFromObject(asset.scene.getObjectByName('cottage_roof'));
  assert.ok(roof.min.y <= cottage.wallHeight + .002, 'roof meets the upper wall');
  assert.ok(roof.max.y > cottage.wallHeight + 1, 'complete gabled silhouette');
  for (const x of [-1.8, -.9, 0, .9, 1.8]) for (const z of [-1.5, 0, 1.5]) {
    const ray = new THREE.Ray(new THREE.Vector3(x, cottage.wallHeight - .01, z), new THREE.Vector3(0, 1, 0)); let hits = 0;
    triangles(asset.scene.getObjectByName('cottage_roof'), triangle => { if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, true, new THREE.Vector3())) hits++; });
    assert.ok(hits > 0, 'roof has a visible sealed underside above ' + x + ',' + z);
  }
});

test('stalls, closed Haven hut, modeled shrub and cheap outward paving remain within their published envelopes', async () => {
  const { asset } = await shipping();
  for (const [name, radius, height, floor] of [['fruit_stall', 2.5, 4, -.51], ['sailcloth_stall', 2.4, 4, -.51], ['haven_hut', 3.2, 5, -.51], ['coastal_shrub', .5, .8, -.05], ['paving_slab', .55, .035, -.03]]) {
    const root = asset.scene.getObjectByName(name), bounds = new THREE.Box3().setFromObject(root); let count = 0, primitives = 0;
    root.traverse(object => {
      if (!object.isMesh) return; primitives++;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) assert.ok(Math.hypot(positions.getX(i), positions.getZ(i)) <= radius + 1e-5, name + ' radius');
    });
    assert.ok(bounds.min.y >= floor - 1e-5 && bounds.max.y <= height + 1e-5, name + ' height');
    triangles(root, () => count++);
    if (name === 'coastal_shrub') { assert.equal(primitives, 1); assert.ok(count >= 250 && count <= 650); }
    if (name === 'paving_slab') {
      assert.ok(count <= 32, 'paving does not instance a high-poly shared rock');
      const center = bounds.getCenter(new THREE.Vector3()); let volume = 0;
      triangles(root, triangle => {
        const normal = triangle.getNormal(new THREE.Vector3()), centroid = triangle.getMidpoint(new THREE.Vector3());
        assert.ok(normal.dot(centroid.sub(center)) > 1e-8, 'every paving face points away from its solid center');
        volume += triangle.a.dot(new THREE.Vector3().crossVectors(triangle.b, triangle.c)) / 6;
      });
      assert.ok(volume > .001, 'closed stone has positive signed volume');
    }
  }
});

test('shipping cottage stays at unit scale while both stalls and Haven huts sit in their terrain and gameplay envelopes', async t => {
  const { asset } = await shipping(), fixture = fixtures(), { propSites } = settlementsFixture(t).group.userData;
  const hutSites = OBSTACLES.filter(site => site.type === 'hut').map((site, index) => ({ ...site, yaw: [.19684114179108292, .014833393855951726][index] }));
  const kit = buildTideglassMarketKit(asset, fixture.shared, { propSites, hutSites });
  t.after(() => { disposeOwnedResources(kit.ownedRoots, [asset.scene, fixture.shared.scene]); disposeOwnedResources(fixture.shared.scene); });
  kit.group.updateMatrixWorld(true);
  const base = kit.group.getObjectByName('cottage_base'); assert.deepEqual(base.scale.toArray(), [1, 1, 1]); assert.equal(base.position.y, heightAt(cottage.x, cottage.z));
  for (const site of [...BUILDINGS.filter(building => ['fruit-stall', 'sailcloth-stall'].includes(building.id)), ...hutSites]) {
    const root = kit.group.getObjectByName(site.id + (site.type === 'hut' ? '-authored-haven-hut' : '-authored'));
    const bounds = new THREE.Box3().setFromObject(root);
    assert.ok(bounds.max.y <= heightAt(site.x, site.z) + site.height + .002, site.id + ' shared height');
    assert.ok(root.position.y >= renderedHeightAt(site.x, site.z) - .002, site.id + ' footing starts on terrain');
    assert.equal(root.scale.x, 1); assert.equal(root.scale.z, 1);
    for (let index = 0; index < 12; index++) {
      const angle = index / 12 * Math.PI * 2, x = site.x + Math.cos(angle) * site.radius * .7, z = site.z + Math.sin(angle) * site.radius * .7;
      assert.ok(bounds.min.y <= renderedHeightAt(x, z) + .03, site.id + ' foundation reaches below surrounding terrain');
    }
  }
});

test('Tideglass layout protects routes, loot, resident loops, paired approaches and later regions', t => {
  const { propSites } = settlementsFixture(t).group.userData;
  assert.equal(hash(JSON.stringify(propSites)), '2244674af7f0a70252cba6ebcbb4abcf84620d065de9248e3b4c0b59ae1cdae1');
  assert.equal(tideglassWeight(-29, 39), 1); assert.equal(tideglassWeight(0, 16), 1);
  for (const point of [{ x: NaN, z: 0 }, { x: 0, z: Infinity }, { x: -66, z: -76 }, { x: -42, z: -53 }, { x: -68, z: 12 }, { x: -15, z: 96 }, { x: 30, z: 96 }, { x: 76, z: 32 }]) assert.equal(tideglassWeight(point.x, point.z), 0);
  const paths = tideglassPaths(); assert.ok(paths.length >= 5);
  for (const route of paths) sampleRoute(route, point => {
    const moved = { ...point, y: heightAt(point.x, point.z) }; resolveWorldCollision(moved);
    assert.ok(Math.hypot(point.x - moved.x, point.z - moved.z) < 1e-6, 'authored public path remains walkable');
  });
  const originalTrail = EXPLORATION_TRAILS.find(trail => trail.id === 'tideglass-market').points;
  for (const point of originalTrail) assert.ok(tideglassPathDistance(point.x, point.z) < 1e-9, 'original market trail retained');
  for (const point of [...CHESTS, ...propSites, ...OBSTACLES]) assert.equal(tideglassPlantClearance(point.x, point.z, propSites), false, 'occupied site remains unplanted');
  for (const end of [-1, 1]) {
    const approach = buildingWorldPoint(cottage, 0, end * (cottage.depth / 2 + 4));
    sampleRoute([approach, buildingWorldPoint(cottage, 0, 0)], point => {
      assert.equal(tideglassPlantClearance(point.x, point.z, propSites), false, 'full cottage approach');
      const moved = { ...point, y: heightAt(point.x, point.z) }; resolveWorldCollision(moved);
      assert.ok(Math.hypot(point.x - moved.x, point.z - moved.z) < 1e-6, 'paired door traversable by authority');
    });
  }
  const publicRoutes = [originalTrail, ...[SPAWN, ...SHRINES].map(destination => [BEACON, destination]), ...RESIDENTS.map(person => [...person.route, person.route[0]])];
  for (const route of publicRoutes) sampleRoute(route, point => assert.equal(tideglassPlantClearance(point.x, point.z, propSites), false, 'primary/exploration/resident route'));
  let accepted = 0;
  for (let x = -54; x < 34; x += 1.13) for (let z = -18; z < 64; z += 1.17) {
    if (tideglassWeight(x, z) <= 0 || !tideglassPlantClearance(x, z, propSites)) continue; accepted++;
    const point = { x, z }; assert.ok(tideglassWeight(x, z) > 0); assert.ok(trailDistance(x, z) >= 2.8);
    for (const chest of CHESTS) assert.ok(Math.hypot(chest.x - x, chest.z - z) >= 2.4);
    for (const person of RESIDENTS) for (let i = 0; i < person.route.length; i++) assert.ok(segmentDistance(point, person.route[i], person.route[(i + 1) % person.route.length]) >= 1.2);
    for (const destination of [SPAWN, ...SHRINES]) assert.ok(segmentDistance(point, BEACON, destination) >= 3, 'primary route clearance');
  }
  assert.ok(accepted > 100, 'clearance retains useful planting space');
});

test('market earth follows both rendered terrain diagonals, fades at bounds and omits the cottage and dais', t => {
  const source = new THREE.MeshStandardMaterial(), surface = buildTideglassTerrain(source); t.after(() => { disposeOwnedResources(surface); source.dispose(); });
  const { position, color } = surface.geometry.attributes, indices = surface.geometry.index;
  assert.equal(color.itemSize, 4); assert.equal(surface.material.transparent, true); assert.equal(surface.material.depthWrite, false);
  assert.notEqual(source, surface.material); assert.equal(source.vertexColors, false);
  const bounds = new THREE.Box3().setFromBufferAttribute(position), offset = position.getY(0) - renderedHeightAt(position.getX(0), position.getZ(0));
  assert.ok(offset > 0 && offset <= .05);
  let partial = 0, visible = 0, excluded = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i), alpha = color.getW(i), local = buildingLocalPoint(cottage, x, z);
    assert.ok(alpha >= 0 && alpha <= 1); if (alpha > 0 && alpha < .5) partial++; if (alpha > 0) visible++;
    if (x === bounds.min.x || x === bounds.max.x || z === bounds.min.z || z === bounds.max.z || tideglassWeight(x, z) === 0) assert.equal(alpha, 0, 'bounded fade');
    if ((Math.abs(local.x) < cottage.width / 2 && Math.abs(local.z) < cottage.depth / 2) || Math.hypot(x - BEACON.x, z - BEACON.z) < 3) { assert.equal(alpha, 0, 'floor/dais exclusion'); excluded++; }
  }
  assert.ok(partial > 20 && visible > 100 && excluded > 5);
  for (let i = 0; i < indices.count; i += 3) {
    const vertices = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + j)));
    for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.17, .32, .51]]) {
      const point = vertices.reduce((sum, vertex, j) => sum.addScaledVector(vertex, weights[j]), new THREE.Vector3());
      assert.ok(Math.abs(point.y - offset - renderedHeightAt(point.x, point.z)) < 2e-6, 'overlay lies on actual grid triangle');
    }
  }
});

test('market installation retains furniture and both cottage cutaways, restores every fallback and disposes exactly once', async t => {
  const fixture = fixtures(), sourceProbe = resourceProbe(fixture.shared.scene, fixture.market.scene), loads = [];
  const live = harness(t, { load: async url => { loads.push(url); return fixture.load(url); } });
  const fallback = live.scene.getObjectByName('tideglass-market-original-exterior');
  const furniture = live.scene.getObjectByName('tideglass-market-architecture-and-work-sites');
  const positions = furniture.geometry.attributes.position.array.slice(), originalRoof = live.scene.getObjectByName('market-cottage-cutaway-roof');
  assert.equal(fallback.visible, true); assert.equal(live.hutFallback.visible, true);
  assert.equal(await live.market.ready, true); assert.deepEqual(loads, [sharedURL, marketURL]);
  assert.equal(fallback.visible, false); assert.equal(live.hutFallback.visible, false); assert.equal(live.legacyVegetation.visible, false);
  assert.equal(furniture.visible, true); assert.deepEqual(furniture.geometry.attributes.position.array, positions);
  assert.equal(live.scene.getObjectByName('old-watch-original-exterior').visible, true); assert.equal(live.scene.getObjectByName('windward-farm-original-exterior').visible, true);
  const group = live.scene.getObjectByName('tideglass-market-weathered-environment'), ownedProbe = resourceProbe(group);
  const roof = live.scene.getObjectByName('market-cottage-authored-cutaway-roof'), walls = live.scene.getObjectByName('market-cottage-authored-cutaway-walls');
  const player = { x: cottage.x, z: cottage.z, y: heightAt(cottage.x, cottage.z), mode: 'ground' }, camera = buildingWorldPoint(cottage, 7, 7);
  for (const end of [-1, 1]) {
    const doorway = buildingWorldPoint(cottage, 0, end * (cottage.depth / 2 - .1));
    live.settlements.animate(3, { player: { ...player, ...doorway }, camera });
    assert.equal(roof.visible, false); assert.deepEqual(walls.children.map(face => face.visible), [false, true, false, true]);
    live.settlements.animate(4, { player: { ...player, ...buildingWorldPoint(cottage, 0, end * (cottage.depth / 2 + 4)) }, camera });
    assert.equal(roof.visible, true); assert.ok(walls.children.every(face => face.visible));
  }
  live.settlements.animate(5, { player: { ...player, mode: 'gliding', y: player.y + 4 }, camera }); assert.equal(roof.visible, false);
  for (const site of live.hutSites) {
    const hut = live.scene.getObjectByName(site.id + '-authored-haven-hut'); assert.ok(hut); assert.equal(hut.position.x, site.x); assert.equal(hut.position.z, site.z); assert.equal(hut.rotation.y, site.yaw);
  }
  live.market.dispose(); live.market.dispose(); sourceProbe.assert(1); ownedProbe.assert(1);
  assert.equal(fallback.visible, true); assert.equal(live.hutFallback.visible, true); assert.equal(live.legacyVegetation.visible, true); assert.equal(group.parent, null);
  live.settlements.animate(6, { player, camera }); assert.equal(originalRoof.visible, false);
  live.settlements.animate(7, { player: { ...player, x: 0, z: 60 }, camera }); assert.equal(originalRoof.visible, true);
  assert.deepEqual(furniture.geometry.attributes.position.array, positions);
});

test('Tideglass batches stay bounded, planting clears gameplay and low/distant detail keeps aerial architecture', async t => {
  const fixture = fixtures(), live = harness(t, { load: fixture.load }); assert.equal(await live.market.ready, true);
  const group = live.scene.getObjectByName('tideglass-market-weathered-environment'), detail = [];
  group.traverse(object => { if (object.isInstancedMesh) detail.push(object); });
  const stats = live.market.getStats(); assert.equal(stats.huts, 2); assert.equal(stats.stalls, 2); assert.equal(stats.cellSize, 16);
  assert.ok(stats.grass > 20 && stats.grass <= 190); assert.ok(stats.shrubs > 0 && stats.shrubs <= 52); assert.ok(stats.flagstones > 20 && stats.flagstones <= 160);
  assert.equal(stats.detailMeshes, detail.length); assert.ok(detail.length < 100, 'spatial batches avoid an object per blade or paver');
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (const mesh of detail) {
    const cell = mesh.userData.cellCenter; assert.ok(cell); assert.equal(mesh.count, mesh.userData.fullCount);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
      assert.ok(Math.abs(position.x - cell.x) <= 8.00001 && Math.abs(position.z - cell.z) <= 8.00001, 'instance stays in 16m cell');
      assert.ok(tideglassWeight(position.x, position.z) > 0, 'decoration remains in the milestone area');
      if (mesh.userData.detailKind !== 'stones') assert.equal(tideglassPlantClearance(position.x, position.z, live.settlements.group.userData.propSites, .14, live.hutSites), true, 'rendered plant clears routes and interactions');
    }
  }
  const player = { x: -15, z: 30 }, plants = detail.filter(mesh => mesh.userData.detailKind !== 'stones');
  live.market.animate(10, { player }); assert.ok(plants.every(mesh => mesh.count === mesh.userData.fullCount));
  const plant = plants[0], shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; plant.material.onBeforeCompile(shader);
  assert.ok(shader.uniforms.tideglassWind.value > 0);
  live.market.animate(20, { player, reducedMotion: true, lowQuality: true });
  assert.equal(shader.uniforms.tideglassWind.value, 0); assert.ok(plants.some(mesh => mesh.count < mesh.userData.fullCount));
  assert.ok(detail.filter(mesh => mesh.userData.detailKind === 'stones').every(mesh => mesh.count === mesh.userData.fullCount));
  live.market.animate(40, { player, reducedMotion: true }); assert.equal(shader.uniforms.tideglassWind.value, 0);
  live.market.animate(50, { player: { x: 0, z: 180 } }); assert.ok(detail.every(mesh => !mesh.visible));
  for (const name of ['market-cottage-authored-cutaway-roof', 'fruit-stall-authored', 'sailcloth-stall-authored', ...live.hutSites.map(site => site.id + '-authored-haven-hut')]) assert.equal(group.getObjectByName(name).visible, true, 'architecture remains visible from distance');
});

test('simultaneous Old Watch, Farm and Market use five leases over three URLs without mutating cached graphs or materials', async t => {
  const fixture = fixtures(), sharedProbe = resourceProbe(fixture.shared.scene), farmProbe = resourceProbe(fixture.farm.scene), marketProbe = resourceProbe(fixture.market.scene), loads = [];
  const cache = createEnvironmentAssets({ load: async url => { loads.push(url); return fixture.load(url); } });
  const scene = new THREE.Scene(), settlements = settlementsFixture(t); scene.add(settlements.group);
  const watch = createOldWatch({ scene, settlements, assets: cache }), farm = createWindwardFarm({ scene, settlements, assets: cache });
  t.after(() => { watch.dispose(); farm.dispose(); cache.dispose(); });
  assert.deepEqual(await Promise.all([watch.ready, farm.ready]), [true, true]);
  const beforeGraph = graphSnapshot(fixture.shared.scene), beforeMarket = graphSnapshot(fixture.market.scene);
  const beforeMaterials = [...fixture.materials.values()].map(material => ({ material, color: material.color.toArray(), normalScale: material.normalScale.toArray(), name: material.name, map: material.map, normalMap: material.normalMap, roughness: material.roughness }));
  const live = harness(t, { scene, settlements, assets: cache }); assert.equal(await live.market.ready, true);
  assert.deepEqual(loads, [sharedURL, farmURL, marketURL]); assert.equal(cache.getStats().leases, 5); assert.equal(cache.getStats().loadedURLs.length, 3);
  assert.equal(cache.getStats().textureCount, 2); assert.equal(cache.getStats().decodedImages, 2); assert.equal(cache.getStats().decodedTextureBytes, 1704);
  assert.deepEqual(graphSnapshot(fixture.shared.scene), beforeGraph); assert.deepEqual(graphSnapshot(fixture.market.scene), beforeMarket);
  for (const entry of beforeMaterials) {
    assert.deepEqual(entry.material.color.toArray(), entry.color); assert.deepEqual(entry.material.normalScale.toArray(), entry.normalScale);
    assert.equal(entry.material.name, entry.name); assert.equal(entry.material.map, entry.map); assert.equal(entry.material.normalMap, entry.normalMap); assert.equal(entry.material.roughness, entry.roughness);
  }
  const bindings = new Map(); live.scene.getObjectByName('tideglass-market-weathered-environment').traverse(object => {
    if (object.isMesh && !object.isInstancedMesh && TIDEGLASS_MATERIAL_BINDINGS[object.material?.name]) bindings.set(object.material.name, object.material);
  });
  for (const [name, material] of bindings) {
    const binding = TIDEGLASS_MATERIAL_BINDINGS[name], source = fixture.materials.get(binding.source);
    assert.notEqual(material, source); assert.equal(material.map, source.map); assert.equal(material.normalMap, source.normalMap);
    const expected = source.color.clone(); if (binding.color) expected.multiply(new THREE.Color(...binding.color)); assert.ok(material.color.equals(expected));
    if (binding.normalScale != null) assert.deepEqual(material.normalScale.toArray(), [binding.normalScale, binding.normalScale]);
  }
  live.market.dispose(); live.market.dispose(); marketProbe.assert(1); sharedProbe.assert(0); farmProbe.assert(0); assert.equal(cache.getStats().leases, 3);
  assert.equal(watch.isReady(), true); assert.equal(farm.isReady(), true); assert.equal(scene.getObjectByName('windward-farm-original-exterior').visible, false);
  farm.dispose(); farmProbe.assert(1); sharedProbe.assert(0); assert.equal(cache.getStats().leases, 1);
  cache.dispose(); sharedProbe.assert(0); watch.dispose(); sharedProbe.assert(1); assert.deepEqual(cache.getStats().loadedURLs, []);
});

test('market-only load failure preserves other authored areas and completes late shared-resource cleanup once', async t => {
  const fixture = fixtures(), cache = createEnvironmentAssets({ load: async url => { if (url === marketURL) throw new Error('market offline'); return fixture.load(url); } });
  const sharedProbe = resourceProbe(fixture.shared.scene), scene = new THREE.Scene(), settlements = settlementsFixture(t); scene.add(settlements.group);
  const watch = createOldWatch({ scene, settlements, assets: cache }), farm = createWindwardFarm({ scene, settlements, assets: cache });
  t.after(() => { watch.dispose(); farm.dispose(); cache.dispose(); });
  assert.deepEqual(await Promise.all([watch.ready, farm.ready]), [true, true]);
  const live = harness(t, { scene, settlements, assets: cache }); assert.equal(await live.market.ready, false); assert.match(live.market.getStats().error, /market offline/);
  assert.equal(live.market.getStats().status, 'fallback'); assert.equal(live.scene.getObjectByName('tideglass-market-original-exterior').visible, true); assert.equal(live.hutFallback.visible, true); assert.equal(live.legacyVegetation.visible, true);
  assert.equal(watch.isReady(), true); assert.equal(farm.isReady(), true); assert.equal(cache.getStats().leases, 3); sharedProbe.assert(0);
  live.market.dispose(); farm.dispose(); sharedProbe.assert(0); watch.dispose(); sharedProbe.assert(1); cache.dispose();
});

test('a shared-library outage preserves all three procedural areas and cleans independently arriving extensions', async t => {
  const fixture = fixtures(), farmProbe = resourceProbe(fixture.farm.scene), marketProbe = resourceProbe(fixture.market.scene), deliver = {};
  const cache = createEnvironmentAssets({ load: url => url === sharedURL ? Promise.reject(new Error('shared unavailable')) : new Promise(resolve => { deliver[url] = resolve; }) });
  const scene = new THREE.Scene(), settlements = settlementsFixture(t); scene.add(settlements.group);
  const watch = createOldWatch({ scene, settlements, assets: cache }), farm = createWindwardFarm({ scene, settlements, assets: cache }), live = harness(t, { scene, settlements, assets: cache });
  t.after(() => { watch.dispose(); farm.dispose(); cache.dispose(); });
  assert.deepEqual(await Promise.all([watch.ready, farm.ready, live.market.ready]), [false, false, false]);
  for (const name of ['old-watch-original-exterior', 'windward-farm-original-exterior', 'tideglass-market-original-exterior']) assert.equal(scene.getObjectByName(name).visible, true);
  assert.equal(cache.getStats().leases, 0); assert.equal(live.hutFallback.visible, true); farmProbe.assert(0); marketProbe.assert(0);
  deliver[marketURL](fixture.market); deliver[farmURL](fixture.farm); await nextTick(); farmProbe.assert(1); marketProbe.assert(1);
  assert.equal(cache.getStats().loading, 0); assert.deepEqual(cache.getStats().loadedURLs, []);
  live.market.dispose(); farm.dispose(); watch.dispose(); cache.dispose(); farmProbe.assert(1); marketProbe.assert(1);
});

test('dispose before either pending asset arrives cannot install scenery and frees both late source graphs once', async t => {
  const fixture = fixtures(), sharedProbe = resourceProbe(fixture.shared.scene), marketProbe = resourceProbe(fixture.market.scene), deliver = {};
  const live = harness(t, { load: url => new Promise(resolve => { deliver[url] = resolve; }) });
  await Promise.resolve(); live.market.dispose(); live.market.dispose();
  deliver[marketURL](fixture.market); await nextTick(); marketProbe.assert(1); sharedProbe.assert(0);
  deliver[sharedURL](fixture.shared); assert.equal(await live.market.ready, false); await nextTick(); sharedProbe.assert(1); marketProbe.assert(1);
  assert.equal(live.market.getStats().status, 'disposed'); assert.equal(live.scene.getObjectByName('tideglass-market-weathered-environment'), undefined);
  assert.equal(live.scene.getObjectByName('tideglass-market-original-exterior').visible, true); assert.equal(live.hutFallback.visible, true); assert.equal(live.legacyVegetation.visible, true);
});

test('either failed dependency releases the independently arriving source and retains the full playable fallback', async t => {
  for (const failedURL of [sharedURL, marketURL]) {
    const fixture = fixtures(), lateAsset = failedURL === sharedURL ? fixture.market : fixture.shared, probe = resourceProbe(lateAsset.scene); let deliver;
    const live = harness(t, { load: url => url === failedURL ? Promise.reject(new Error('dependency offline')) : new Promise(resolve => { deliver = resolve; }) });
    assert.equal(await live.market.ready, false); probe.assert(0);
    assert.equal(live.scene.getObjectByName('tideglass-market-original-exterior').visible, true); assert.equal(live.hutFallback.visible, true); assert.equal(live.legacyVegetation.visible, true);
    deliver(lateAsset); await nextTick(); probe.assert(1); live.market.dispose(); probe.assert(1);
    assert.equal(live.scene.getObjectByName('tideglass-market-weathered-environment'), undefined);
  }
});

test('missing mesh/material contracts and partial prefab staging fail before installation without releasing borrowed maps', t => {
  const { propSites } = settlementsFixture(t).group.userData;
  for (const name of ['cottage_roof', 'haven_hut', 'paving_slab']) {
    const fixture = fixtures(), root = fixture.market.scene.getObjectByName(name); fixture.market.scene.remove(root);
    assert.throws(() => buildTideglassMarketKit(fixture.market, fixture.shared, { propSites }), new RegExp(name));
    disposeOwnedResources([fixture.market.scene, fixture.shared.scene, root]);
  }
  const invalid = fixtures(); invalid.market.scene.children[0].children[0].material.name = 'unavailable_material';
  assert.throws(() => buildTideglassMarketKit(invalid.market, invalid.shared, { propSites }), /binding is missing: unavailable_material/);
  disposeOwnedResources([invalid.market.scene, invalid.shared.scene]);
  const fixture = fixtures(), probe = resourceProbe(fixture.shared.scene, fixture.market.scene); let cloned = 0, disposed = 0;
  for (const material of fixture.materials.values()) {
    const original = material.clone.bind(material);
    material.clone = () => { const copy = original(); cloned++; copy.addEventListener('dispose', () => disposed++); return copy; };
  }
  fixture.market.scene.getObjectByName('cottage_roof').clone = () => { throw new Error('staging interrupted'); };
  assert.throws(() => buildTideglassMarketKit(fixture.market, fixture.shared, { propSites }), /staging interrupted/);
  assert.ok(cloned > 5); assert.equal(disposed, cloned); probe.assert(0);
  disposeOwnedResources([fixture.shared.scene, fixture.market.scene]); probe.assert(1);
});

test('partial settlement installation restores original cutaways even when rollback reports a secondary failure', async t => {
  const fixture = fixtures(), probe = resourceProbe(fixture.shared.scene, fixture.market.scene), live = harness(t, { load: fixture.load });
  const install = live.settlements.setTideglassMarketKit; let stagedProbe;
  live.settlements.setTideglassMarketKit = kit => {
    if (kit) stagedProbe = resourceProbe(...kit.ownedRoots);
    install(kit); throw new Error(kit ? 'install interrupted' : 'rollback diagnostic');
  };
  assert.equal(await live.market.ready, false); assert.match(live.market.getStats().error, /install interrupted; Fallback restore: rollback diagnostic/);
  assert.equal(live.scene.getObjectByName('tideglass-market-weathered-environment'), undefined); assert.equal(live.scene.getObjectByName('tideglass-market-original-exterior').visible, true);
  assert.equal(live.hutFallback.visible, true); assert.equal(live.legacyVegetation.visible, true); probe.assert(1); stagedProbe.assert(1);
  live.settlements.animate(2, { player: { x: cottage.x, z: cottage.z, y: heightAt(cottage.x, cottage.z), mode: 'ground' } });
  assert.equal(live.scene.getObjectByName('market-cottage-cutaway-roof').visible, false);
  live.market.dispose(); live.market.dispose(); probe.assert(1); stagedProbe.assert(1);
});
