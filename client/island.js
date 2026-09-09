import * as THREE from 'three';
import { heightAt } from '../shared/world.js';
import { coastRockDressing } from '../shared/island.js';
import { createEnvironmentAssets, disposeOwnedResources } from './environment-assets.js';
import { renderedHeightAt } from './environment-geometry.js';

export const ISLAND_PREFABS = ['coast_palm_a', 'coast_palm_b', 'coast_rock_a', 'coast_rock_b', 'fishing_skiff_a', 'fishing_skiff_b'];
export const ISLAND_MATERIAL_BINDINGS = Object.freeze({
  palm_trunk:  { source: 'pine_bark',      color: [2.70, 2.60, 2.60], normalScale: .80 },
  coast_frond: { source: 'needle_foliage', color: [3.20, 3.30, 2.00], normalScale: .50, doubleSided: true },
  dead_frond:  { source: 'aged_timber',    color: [2.40, 1.90, 1.20], normalScale: .40, doubleSided: true },
  coconut:     { source: 'ground_earth',   color: [1.60, 1.50, .90],  normalScale: .60 },
  // The shared stone carries green moss mottling; a first pass at 4.0/3.6/3.0
  // rendered the surf rocks grey-green, so red leads and blue trails.
  coast_stone: { source: 'watch_stone',    color: [5.20, 4.20, 3.40], normalScale: .80 },
  skiff_plank: { source: 'aged_timber',    color: [4.20, 3.90, 3.40], normalScale: .40 },
  skiff_teal:  { source: 'aged_timber',    color: [.45, 3.40, 4.80],  normalScale: .40 },
  skiff_coral: { source: 'aged_timber',    color: [6.60, 2.20, 2.20], normalScale: .40 },
  skiff_canvas:{ source: 'ground_earth',   color: [8.50, 8.00, 6.80], normalScale: .18, doubleSided: true },
  hemp_rope:   { source: 'needle_foliage', color: [2.60, 1.70, 1.10] },
  forged_iron: { source: 'forged_iron' },
});
const SHARED_URL = '/assets/old-watch/kit.glb', ISLAND_URL = '/assets/island/kit.glb';
const PALM_CELL = 64;
// One uniform drives the canopy hook. Only the green and dead fronds move; the
// trunks, coconuts, rocks and moored skiffs keep a rigid silhouette.
const CANOPY_WIND = { key: 'island-canopy-wind-v1', hook: 'transformed.x += sin(islandWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * max(position.y - 3.0, 0.0) * .010;' };
const CANOPY_MATERIALS = new Set(['coast_frond', 'dead_frond']);

function prefabRoots(scene, names) {
  return Object.fromEntries(names.map(name => {
    const root = scene.getObjectByName(name); let meshes = 0;
    root?.traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count && object.material) meshes++; });
    if (!meshes) throw new Error('Island kit is missing or empty: ' + name);
    return [name, root];
  }));
}
function sourceMaterials(scene) {
  const result = new Map();
  scene.traverse(object => { for (const material of !object.material ? [] : Array.isArray(object.material) ? object.material : [object.material]) result.set(material.name, material); });
  return result;
}
function place(prefab, x, y, z, yaw = 0) {
  const root = prefab.clone(true); root.position.set(x, y, z); root.rotation.y = yaw;
  root.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
  return root;
}

// One InstancedMesh per source primitive per 64 m cell. The coast palms carry
// the skyline from every approach, so they cast shadows and are never thinned
// or distance-hidden.
function batches(prefab, points, parent, wind) {
  if (!points.length) return [];
  const cells = new Map(), result = [], transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
  for (const point of points) {
    const key = Math.floor(point.x / PALM_CELL) + ':' + Math.floor(point.z / PALM_CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }
  const template = prefab.clone(true); template.updateMatrixWorld(true);
  template.traverse(source => {
    if (!source.isMesh) return;
    const frond = source.material.clone();
    parent.material.push(frond);
    if (CANOPY_MATERIALS.has(source.material.name)) {
      frond.side = THREE.DoubleSide;
      frond.onBeforeCompile = shader => {
        shader.uniforms.islandWind = wind;
        shader.vertexShader = 'uniform float islandWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n' + CANOPY_WIND.hook + '\n#endif');
      };
      frond.customProgramCacheKey = () => CANOPY_WIND.key;
    }
    for (const [key, cellPoints] of cells) {
      const mesh = new THREE.InstancedMesh(source.geometry, frond, cellPoints.length);
      mesh.name = 'island-palm-' + prefab.name + '-' + key;
      cellPoints.forEach((point, index) => {
        transform.position.set(point.x, renderedHeightAt(point.x, point.z) + .015, point.z); transform.rotation.set(0, point.yaw ?? 0, 0);
        transform.scale.setScalar(point.size ?? 1); transform.updateMatrix();
        matrix.multiplyMatrices(transform.matrix, source.matrixWorld); mesh.setMatrixAt(index, matrix);
      });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      mesh.userData.fullCount = cellPoints.length; mesh.userData.detailKind = 'palm';
      const [cx, cz] = key.split(':').map(Number); mesh.userData.cellCenter = { x: (cx + .5) * PALM_CELL, z: (cz + .5) * PALM_CELL };
      parent.add(mesh); result.push(mesh);
    }
  });
  return result;
}

export function buildIslandKit(kit, shared, { palmSites = [], rockSites = [], skiffs = [] } = {}) {
  const prefabs = prefabRoots(kit.scene, ISLAND_PREFABS);
  const materials = sourceMaterials(shared.scene), slots = sourceMaterials(kit.scene);
  for (const name of slots.keys()) {
    const binding = ISLAND_MATERIAL_BINDINGS[name];
    if (!binding || !materials.has(binding.source)) throw new Error('Island material binding is missing: ' + name);
  }
  const group = new THREE.Group(); group.name = 'island-coast-environment'; group.material = [];
  const boundLibrary = new THREE.Group(), borrowed = [kit.scene, shared.scene]; boundLibrary.material = [];
  try {
    const bindings = new Map();
    for (const name of slots.keys()) {
      const binding = ISLAND_MATERIAL_BINDINGS[name], material = materials.get(binding.source).clone();
      boundLibrary.material.push(material); material.name = name; material.vertexColors = true;
      if (binding.color) material.color.multiply(new THREE.Color(...binding.color));
      if (binding.normalScale != null) material.normalScale.setScalar(binding.normalScale);
      if (binding.doubleSided) material.side = THREE.DoubleSide;
      bindings.set(name, material);
    }
    const bound = Object.fromEntries(Object.entries(prefabs).map(([name, prefab]) => {
      const copy = prefab.clone(true);
      copy.traverse(object => { if (object.isMesh) object.material = Array.isArray(object.material) ? object.material.map(material => bindings.get(material.name)) : bindings.get(object.material.name); });
      boundLibrary.add(copy); return [name, copy];
    }));
    const wind = { value: 0 };
    // The five collidable palms take the fuller crown; the decorative ones
    // alternate so the strand never reads as one repeated silhouette.
    const palms = palmSites.map((site, index) => ({ ...site, prefab: site.id ? 'coast_palm_a' : index % 2 ? 'coast_palm_b' : 'coast_palm_a' }));
    const canopy = ['coast_palm_a', 'coast_palm_b'].flatMap(name => batches(bound[name], palms.filter(palm => palm.prefab === name), group, wind));
    // Each surf rock keeps its recorded radius and height, so its dressing
    // carries a non-uniform scale onto the nominal boulder.
    const rocks = rockSites.map(site => {
      const { prefab, scale } = coastRockDressing(site);
      const root = place(bound[prefab], site.x, heightAt(site.x, site.z), site.z, site.yaw);
      root.scale.set(...scale); root.name = 'island-coast-rock-' + site.id; group.add(root); return root;
    });
    // The skiffs are parented by the settlement so the existing bobbing moves
    // the authored hull; the kit only owns them.
    const authored = skiffs.map((boat, index) => {
      const root = place(bound[index % 2 ? 'fishing_skiff_b' : 'fishing_skiff_a'], 0, 0, 0, 0);
      root.name = 'island-skiff-' + index; return root;
    });
    return { group, wind, detail: [], canopy, skiffs: authored, ownedRoots: [group, boundLibrary, ...authored],
      counts: { prefabs: ISLAND_PREFABS.length, palms: palmSites.length, collidablePalms: palmSites.filter(site => site.id).length,
        rocks: rocks.length, skiffs: authored.length, canopyMeshes: canopy.length, cellSize: PALM_CELL } };
  } catch (error) { disposeOwnedResources([group, boundLibrary], borrowed); throw error; }
}

export function createIsland({ scene, settlements, assets = null, legacyScenery = null, palmSites = [], rockSites = [], load } = {}) {
  const cache = assets ?? createEnvironmentAssets(load ? { load } : {}), ownsCache = !assets;
  const leases = [cache.acquire(SHARED_URL), cache.acquire(ISLAND_URL)];
  let disposed = false, kit = null, sources = [], status = 'loading', error = null;
  const release = () => { for (const lease of leases) lease.release(); if (ownsCache) cache.dispose(); };
  const restoreFallback = () => {
    try { settlements.setIslandKit(null); }
    catch (failure) { error = [error, 'Fallback restore: ' + String(failure?.message ?? failure)].filter(Boolean).join('; '); }
    if (legacyScenery) legacyScenery.visible = true;
  };
  const ready = Promise.all(leases.map(lease => lease.ready)).then(([shared, island]) => {
    if (disposed) return false;
    sources = [island.scene, shared.scene];
    kit = buildIslandKit(island, shared, { palmSites, rockSites, skiffs: settlements.group.userData.skiffs ?? [] });
    scene.add(kit.group); settlements.setIslandKit(kit);
    if (legacyScenery) legacyScenery.visible = false;
    status = 'ready'; return true;
  }).catch(failure => {
    error = String(failure?.message ?? failure);
    if (!disposed) restoreFallback();
    if (kit) { kit.group.removeFromParent(); disposeOwnedResources(kit.ownedRoots, sources); }
    kit = null; sources = []; release();
    if (!disposed) status = 'fallback';
    return false;
  });
  return { ready, isReady: () => status === 'ready', animate(time, { player = null, lowQuality = false, reducedMotion = false } = {}) {
    if (!kit || disposed) return;
    kit.wind.value = reducedMotion ? 0 : time * .8;
    // No ground cover in this slice; the thinning loop stays for later ones.
    for (const mesh of kit.detail) {
      const { cellCenter: cell, fullCount } = mesh.userData;
      const distance = player ? Math.hypot(player.x - cell.x, player.z - cell.z) : Infinity;
      mesh.visible = distance < (lowQuality ? 65 : 105);
      mesh.count = Math.max(1, Math.floor(fullCount * (lowQuality ? .42 : distance > 65 ? .65 : 1)));
    }
  }, getStats: () => ({ status, ready: status === 'ready', loading: status === 'loading', fallback: status !== 'ready', error, windValue: kit?.wind.value ?? 0, ...(kit?.counts ?? {}), visibleDetailMeshes: kit?.detail.filter(mesh => mesh.visible).length ?? 0 }), dispose() {
    if (disposed) return;
    disposed = true; status = 'disposed'; restoreFallback();
    if (kit) { kit.group.removeFromParent(); disposeOwnedResources(kit.ownedRoots, sources); }
    kit = null; sources = []; release();
  } };
}
