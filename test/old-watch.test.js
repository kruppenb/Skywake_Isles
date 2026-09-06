import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { OLD_WATCH, OLD_WATCH_PROPS, oldWatchWeight } from '../shared/old-watch.js';
import { BUILDINGS, RESIDENTS, EXPLORATION_TRAILS, buildingWorldPoint, trailDistance } from '../shared/exploration.js';
import { heightAt, CHESTS, OBSTACLES } from '../shared/world.js';
import { hasWorldLineOfSight, resolveWorldCollision } from '../shared/collision.js';
import { OLD_WATCH_PREFABS, buildOldWatchKit, createOldWatch, renderedHeightAt } from '../client/old-watch.js';
import { buildSettlements } from '../client/settlement.js';
import { makePalette } from '../client/models.js';
import { createEnvironmentAssets } from '../client/environment-assets.js';

function fixtureAsset() {
  const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(.2, .5, .2), material = new THREE.MeshStandardMaterial();
  for (const name of OLD_WATCH_PREFABS) {
    const root = new THREE.Group(); root.name = name;
    const ownMaterial = name === 'ground_sample' ? material.clone() : material;
    if (name === 'ground_sample') ownMaterial.name = 'ground_earth';
    root.add(new THREE.Mesh(geometry, ownMaterial)); scene.add(root);
  }
  return { scene };
}

test('Old Watch colliders append stable IDs and keep public routes, props and doors clear', () => {
  assert.deepEqual(OBSTACLES.slice(-OLD_WATCH_PROPS.length), OLD_WATCH_PROPS);
  assert.equal(OLD_WATCH_PROPS.filter(p => p.type === 'tree').length, 8);
  const sites = buildSettlements(makePalette()).group.userData.propSites;
  for (const p of OLD_WATCH_PROPS) {
    assert.ok(Math.hypot(p.x - OLD_WATCH.x, p.z - OLD_WATCH.z) < OLD_WATCH.radius);
    assert.ok(heightAt(p.x, p.z) > .3, p.id + ' remains on land');
    assert.ok(trailDistance(p.x, p.z) > p.radius + 3.1, p.id + ' clears the trail');
    for (const c of CHESTS) assert.ok(Math.hypot(p.x - c.x, p.z - c.z) > p.radius + 2.3, p.id + ' clears ' + c.id);
    for (const site of sites) assert.ok(Math.hypot(p.x - site.x, p.z - site.z) > p.radius + site.radius + .3, p.id + ' clears a work site');
    for (const b of BUILDINGS.filter(b => b.enterable)) for (const end of [-1, 1]) {
      const door = buildingWorldPoint(b, 0, end * (b.depth / 2 + 2));
      assert.ok(Math.hypot(p.x - door.x, p.z - door.z) > p.radius + 2, p.id + ' clears ' + b.id + ' door');
    }
    const y = heightAt(p.x, p.z) + .5;
    assert.equal(hasWorldLineOfSight({ x: p.x - p.radius - 1, y, z: p.z }, { x: p.x + p.radius + 1, y, z: p.z }), false);
    const player = { x: p.x + .01, y, z: p.z }; resolveWorldCollision(player);
    assert.ok(Math.hypot(player.x - p.x, player.z - p.z) >= p.radius + .5999);
  }
  // Sample each public walking route against the authority collision function.
  const routes = [...EXPLORATION_TRAILS.filter(t => t.id === 'old-watch' || t.id === 'windward-farm').map(t => t.points), ...RESIDENTS.filter(r => r.poiId === 'old-watch').map(r => [...r.route, r.route[0]])];
  for (const route of routes) for (let i = 1; i < route.length; i++) for (let step = 0; step <= 100; step++) {
    const t = step / 100, x = route[i - 1].x * (1 - t) + route[i].x * t, z = route[i - 1].z * (1 - t) + route[i].z * t;
    const p = { x, z, y: heightAt(x, z) }; resolveWorldCollision(p); assert.ok(Math.hypot(p.x - x, p.z - z) < 1e-6);
  }
});

test('terrain interpolation lies on both diagonals of the actual rendered terrain grid', () => {
  for (const [x, z] of [[-80, -86], [-78, -86], [-64, -72], [-64, -70]]) {
    assert.equal(renderedHeightAt(x, z), heightAt(x, z));
    const opposite = ((x + 150) / 2 + (z + 150) / 2) % 2;
    const expected = opposite ? (heightAt(x + 2, z) + heightAt(x, z + 2)) / 2 : (heightAt(x, z) + heightAt(x + 2, z + 2)) / 2;
    assert.ok(Math.abs(renderedHeightAt(x + 1, z + 1) - expected) < 1e-9);
  }
  assert.equal(oldWatchWeight(-66, -76), 1); assert.equal(oldWatchWeight(-42, -53), 0); assert.equal(oldWatchWeight(NaN, 0), 0);
  assert.equal(oldWatchWeight(-54, -60), 0, 'the farm keeps its original atmosphere and planting');
  assert.ok(oldWatchWeight(-66 + 26.99, -76) < .00001);
});

test('atomic installation preserves furnished cutaways and quality density without owning global lighting', async () => {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#85d9ee'); scene.fog = new THREE.Fog('#a2def0', 180, 610);
  const hemisphere = new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2), sun = new THREE.DirectionalLight('#fff0d0', 2.7);
  const settlements = buildSettlements(makePalette()); scene.add(settlements.group);
  const legacyVegetation = new THREE.Group(); scene.add(legacyVegetation);
  let loads = 0;
  const pilot = createOldWatch({ scene, settlements, legacyVegetation, hemisphere, sun, load: async () => { loads++; return fixtureAsset(); } });
  assert.equal(pilot.getStats().status, 'loading'); assert.equal(scene.getObjectByName('old-watch-original-exterior').visible, true);
  assert.equal(await pilot.ready, true); assert.equal(loads, 1); assert.equal(legacyVegetation.visible, false);
  const counts = pilot.getStats();
  assert.deepEqual([counts.grass, counts.ferns, counts.flagstones], [559, 54, 12], 'approved pilot planting density and original prop-site exclusions');
  assert.equal(scene.getObjectByName('old-watch-original-exterior').visible, false);
  const b = BUILDINGS.find(p => p.id === 'watch-barracks'), player = { x: b.x, z: b.z, y: heightAt(b.x, b.z), mode: 'ground' };
  const roof = scene.getObjectByName('watch-barracks-authored-cutaway-roof'), walls = scene.getObjectByName('watch-barracks-authored-cutaway-walls');
  const camera = buildingWorldPoint(b, 7, 7);
  settlements.animate(1, { player, camera }); assert.equal(roof.visible, false); assert.deepEqual(walls.children.map(p => p.visible), [false, true, false, true]);
  settlements.animate(2, { player: { ...player, mode: 'gliding', y: player.y + 4 }, camera }); assert.equal(roof.visible, false);
  settlements.animate(3, { player: { ...player, x: 0, z: 0 }, camera }); assert.equal(roof.visible, true); assert.ok(walls.children.every(p => p.visible));
  pilot.animate(2, { player }); assert.equal(hemisphere.intensity, 2.2);
  const plants = []; scene.traverse(p => { if (p.isInstancedMesh && p.name.startsWith('old-watch-instanced')) plants.push(p); });
  assert.ok(plants.length >= 2); assert.ok(plants.reduce((n, p) => n + p.count, 0) > 100);
  pilot.animate(20, { player, lowQuality: true, reducedMotion: true }); assert.ok(plants.every(p => p.count < p.userData.fullCount));
  pilot.animate(21, { player: { x: 0, z: 94 } }); assert.equal(hemisphere.intensity, 2.2); assert.equal(sun.intensity, 2.7); assert.equal(scene.fog.near, 180); assert.equal(scene.background.getHexString(), '85d9ee');
  pilot.dispose(); pilot.dispose(); assert.equal(pilot.getStats().status, 'disposed'); assert.equal(legacyVegetation.visible, true); assert.equal(scene.getObjectByName('old-watch-original-exterior').visible, true);
});

test('failed and late loads keep visible solids and dispose shared asset resources once', async () => {
  const make = load => { const scene = new THREE.Scene(), settlements = buildSettlements(makePalette()); scene.add(settlements.group); return { scene, pilot: createOldWatch({ scene, settlements, load }) }; };
  const failed = make(async () => { throw new Error('offline'); }); assert.equal(await failed.pilot.ready, false); assert.equal(failed.pilot.getStats().status, 'fallback');
  assert.equal(failed.scene.getObjectByName('old-watch-original-exterior').visible, true); assert.equal(failed.scene.getObjectByName('old-watch-solid-prop-fallback').children.length, 16); failed.pilot.dispose();
  let deliver; const pending = new Promise(resolve => { deliver = resolve; }); const late = make(() => pending);
  const asset = fixtureAsset(), geometry = asset.scene.children[0].children[0].geometry, material = asset.scene.children[0].children[0].material;
  let geometries = 0, materials = 0, textures = 0, bitmaps = 0;
  const texture = new THREE.Texture({ close: () => bitmaps++ }); material.map = material.normalMap = texture; texture.addEventListener('dispose', () => textures++);
  geometry.addEventListener('dispose', () => geometries++); material.addEventListener('dispose', () => materials++);
  late.pilot.dispose(); deliver(asset); assert.equal(await late.pilot.ready, false); assert.equal(geometries, 1); assert.equal(materials, 1); assert.equal(textures, 1); assert.equal(bitmaps, 1);
  const incomplete = fixtureAsset(); incomplete.scene.remove(incomplete.scene.getObjectByName('barracks_roof'));
  assert.throws(() => buildOldWatchKit(incomplete), /missing barracks_roof/);
});

test('late installation failure rolls back staging while another area retains the source lease', async () => {
  const asset = fixtureAsset(), source = asset.scene.children[0].children[0].geometry;
  let sourceDisposed = 0, patchDisposed = 0, foliageDisposed = 0;
  source.addEventListener('dispose', () => sourceDisposed++);
  const assets = createEnvironmentAssets({ load: async () => asset }), survivor = assets.acquire('/assets/old-watch/kit.glb');
  const scene = new THREE.Scene(), settlements = buildSettlements(makePalette()), legacyVegetation = new THREE.Group(); scene.add(settlements.group, legacyVegetation);
  const install = settlements.setOldWatchKit;
  settlements.setOldWatchKit = kit => {
    install(kit);
    if (kit) {
      kit.group.getObjectByName('old-watch-earth-and-gravel').geometry.addEventListener('dispose', () => patchDisposed++);
      kit.foliage[0].material.addEventListener('dispose', () => foliageDisposed++);
      throw new Error('installation rejected after staging');
    }
  };
  const pilot = createOldWatch({ scene, settlements, assets, legacyVegetation });
  assert.equal(await pilot.ready, false); assert.match(pilot.getStats().error, /installation rejected/);
  assert.equal(scene.getObjectByName('old-watch-weathered-pilot'), undefined);
  assert.equal(scene.getObjectByName('old-watch-original-exterior').visible, true); assert.equal(legacyVegetation.visible, true);
  assert.equal(patchDisposed, 1); assert.equal(foliageDisposed, 1); assert.equal(sourceDisposed, 0);
  pilot.dispose(); pilot.dispose(); assert.equal(patchDisposed, 1); assert.equal(assets.getStats().leases, 1);
  survivor.release(); assets.dispose(); assert.equal(sourceDisposed, 1);
});

test('partial kit construction releases staged surfaces without touching borrowed sources', () => {
  const asset = fixtureAsset(), tower = asset.scene.getObjectByName('watch_tower'), cloneTower = tower.clone;
  let patchDisposed = 0, staged = null, sourceDisposed = 0;
  asset.scene.children[0].children[0].geometry.addEventListener('dispose', () => sourceDisposed++);
  tower.clone = function (...args) {
    const result = cloneTower.apply(this, args);
    result.addEventListener('added', () => {
      staged = result.parent;
      staged.addEventListener('childadded', event => {
        if (event.child.name === 'old-watch-earth-and-gravel') event.child.geometry.addEventListener('dispose', () => patchDisposed++);
      });
    });
    return result;
  };
  asset.scene.getObjectByName('rock_a').updateMatrixWorld = () => { throw new Error('invalid path source transform'); };
  assert.throws(() => buildOldWatchKit(asset), /invalid path source transform/);
  assert.ok(staged?.getObjectByName('old-watch-earth-and-gravel')); assert.equal(patchDisposed, 1); assert.equal(sourceDisposed, 0);
});

test('shipping GLB contains self-contained textured prefabs with the declared material and triangle budget', async () => {
  const bytes = await readFile(new URL('../client/assets/old-watch/kit.glb', import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length); assert.ok(bytes.length < 8 * 1024 * 1024);
  const jsonSize = bytes.readUInt32LE(12); assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonSize));
  for (const sampler of gltf.samplers) {
    assert.equal(sampler.wrapS ?? 10497, 10497); assert.equal(sampler.wrapT ?? 10497, 10497);
  }
  for (const name of OLD_WATCH_PREFABS) assert.ok(gltf.nodes.some(n => n.name === name), name);
  assert.ok(gltf.materials.some(m => m.name === 'ground_earth' && m.pbrMetallicRoughness.baseColorTexture));
  assert.ok(gltf.images.length >= 3); assert.ok(gltf.images.every(i => Number.isInteger(i.bufferView) && !i.uri)); assert.ok(gltf.buffers.every(b => !b.uri));
  let triangles = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    assert.ok(primitive.attributes.TEXCOORD_0 >= 0, 'textured UVs'); assert.ok(primitive.attributes.NORMAL >= 0, 'authored normals'); assert.ok(primitive.attributes.COLOR_0 >= 0, 'vertex weathering');
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  assert.ok(triangles > 10000 && triangles <= 120000, 'kit triangle budget: ' + triangles);
  const binOffset = 20 + jsonSize; assert.equal(bytes.readUInt32LE(binOffset + 4), 0x004e4942);
  for (const view of gltf.bufferViews) assert.ok((view.byteOffset || 0) + view.byteLength <= bytes.readUInt32LE(binOffset));
  const component = { 5121: ['readUInt8', 1], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4] };
  function values(accessorIndex, index, dimensions) {
    const accessor = gltf.accessors[accessorIndex], view = gltf.bufferViews[accessor.bufferView], [read, size] = component[accessor.componentType];
    const offset = binOffset + 8 + (view.byteOffset || 0) + (accessor.byteOffset || 0) + index * (view.byteStride || dimensions * size);
    return Array.from({ length: dimensions }, (_, i) => bytes[read](offset + i * size));
  }
  function signedVolume(node) {
    let volume = 0;
    for (const primitive of node.mesh == null ? [] : gltf.meshes[node.mesh].primitives) {
      const count = gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count;
      for (let i = 0; i < count; i += 3) {
        const vertices = [i, i + 1, i + 2].map(index => new THREE.Vector3(...values(primitive.attributes.POSITION, primitive.indices == null ? index : values(primitive.indices, index, 1)[0], 3)));
        volume += vertices[0].dot(vertices[1].cross(vertices[2])) / 6;
      }
    }
    return volume + (node.children || []).reduce((sum, index) => sum + signedVolume(gltf.nodes[index]), 0);
  }
  for (const name of ['rock_a', 'rock_b']) assert.ok(signedVolume(gltf.nodes.find(node => node.name === name)) > .1, name + ' closed stone faces point outward, including flattened path stones');
});
