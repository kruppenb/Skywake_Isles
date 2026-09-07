import * as THREE from 'three';
import { heightAt, seededRandom } from '../shared/world.js';
import { PALMHEART_TENT, PALMHEART_CANOPY_OBSTACLES, palmheartWeight, palmheartPathDistance, palmheartPlantClearance, palmheartWorkSites } from '../shared/palmheart-camp.js';
import { createEnvironmentAssets, disposeOwnedResources } from './environment-assets.js';
import { renderedHeightAt, TERRAIN_GRID_STEP, TERRAIN_GRID_HALF } from './environment-geometry.js';

export const PALMHEART_PREFABS = ['trailkeepers_tent', 'fire_ring', 'gear_rack', 'camp_lantern', 'jungle_tree_a', 'jungle_tree_b', 'jungle_palm', 'elephant_ear_clump'];
export const PALMHEART_MATERIAL_BINDINGS = Object.freeze({
  watch_stone: { source: 'watch_stone' }, aged_timber: { source: 'aged_timber' }, forged_iron: { source: 'forged_iron' },
  recess_shadow: { source: 'recess_shadow' }, lantern_amber: { source: 'lantern_amber' }, needle_foliage: { source: 'needle_foliage' },
  jungle_hardwood: { source: 'aged_timber', color: [1.6, 1.15, .85], normalScale: .5 },
  palm_thatch: { source: 'needle_foliage', color: [3.0, 2.3, 1.0], normalScale: .6, doubleSided: true },
  woven_mat: { source: 'ground_earth', color: [4.6, 3.9, 2.4], normalScale: .35 },
  hemp_rope: { source: 'needle_foliage', color: [2.6, 1.7, 1.1] },
  canvas_flap: { source: 'ground_earth', color: [7.5, 7.0, 5.6], doubleSided: true },
  charred_wood: { source: 'aged_timber', color: [.45, .40, .36], normalScale: .3 },
  jungle_bark: { source: 'pine_bark', color: [1.35, 1.2, 1.05], normalScale: .8 },
  broad_leaf: { source: 'needle_foliage', color: [.85, 1.35, .75], normalScale: .5, doubleSided: true },
  palm_frond: { source: 'needle_foliage', color: [1.05, 1.45, .70], normalScale: .5, doubleSided: true },
  elephant_ear: { source: 'needle_foliage', color: [.75, 1.30, .68], normalScale: .5, doubleSided: true },
});
const SHARED_URL = '/assets/old-watch/kit.glb', CAMP_URL = '/assets/palmheart-camp/kit.glb';
const TAU = Math.PI * 2, CELL = 16, clamp = THREE.MathUtils.clamp;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
// One uniform drives both hooks. Only leaves, fronds and thatch move; trunks,
// poles and stone keep a plain clone so the silhouettes stay rigid.
const GROUND_WIND = { key: 'palmheart-ground-wind-v1', hook: 'transformed.x += sin(palmheartWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * pow(max(position.y, 0.0), 2.0) * .045;' };
const CANOPY_WIND = { key: 'palmheart-canopy-wind-v1', hook: 'transformed.x += sin(palmheartWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * max(position.y - 2.0, 0.0) * .012;' };
const CANOPY_MATERIALS = new Set(['broad_leaf', 'palm_frond', 'elephant_ear', 'palm_thatch']);

function prefabRoots(scene, names) {
  return Object.fromEntries(names.map(name => {
    const root = scene.getObjectByName(name); let meshes = 0;
    root?.traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count && object.material) meshes++; });
    if (!meshes) throw new Error('Palmheart Camp kit is missing or empty: ' + name);
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
function footing(prefab, x, z, yaw, radius) {
  let y = renderedHeightAt(x, z);
  for (let index = 0; index < 12; index++) {
    const a = index / 12 * TAU;
    y = Math.max(y, renderedHeightAt(x + Math.sin(a) * radius * .83, z + Math.cos(a) * radius * .83));
  }
  return place(prefab, x, y, z, yaw);
}
// The jungle floor lies on the same alternating terrain triangles as the other
// overlays. Depth bias would pull the litter over the fire ring and the tent.
function overlay(material, name, positions, colors, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const humus = material.clone(); humus.vertexColors = true; humus.transparent = true; humus.depthWrite = false; humus.polygonOffset = false;
  const mesh = new THREE.Mesh(geometry, humus); mesh.name = name; mesh.receiveShadow = true; mesh.renderOrder = 2;
  return mesh;
}

// Dark humus and leaf litter, a trodden red-brown path along the trail and the
// tent approach, and a clearing packed pale around the fire.
export function buildPalmheartTerrain(material, sites = null) {
  const step = TERRAIN_GRID_STEP, origin = -TERRAIN_GRID_HALF;
  const minX = -108, minZ = -14, columns = 25, rows = 24;
  const positions = [], colors = [], uvs = [], indices = [];
  const humus = new THREE.Color('#4a3a2a'), litter = new THREE.Color('#7a5f3a'), track = new THREE.Color('#9c7a52'), packed = new THREE.Color('#a8946a');
  for (let zi = 0; zi <= rows; zi++) for (let xi = 0; xi <= columns; xi++) {
    const x = minX + xi * step, z = minZ + zi * step;
    const weight = palmheartWeight(x, z);
    const path = 1 - smooth((palmheartPathDistance(x, z) - 1.5) / 2.6);
    const clearing = !sites ? 0 : smooth((7 - Math.hypot(x - sites.fire.x, z - sites.fire.z)) / 4);
    const mottling = clamp(.5 + Math.sin(x * .37 + z * .21) * .3 + Math.sin(z * .43 - x * .11) * .2, 0, 1);
    const color = humus.clone().lerp(litter, mottling * .6).lerp(packed, clearing * .7).lerp(track, path * .85).multiplyScalar(1.8 + path * .6 + clearing * .3);
    let alpha = weight * (.45 + path * .35 + clearing * .2);
    if (heightAt(x, z) < 1.7 || xi === 0 || zi === 0 || xi === columns || zi === rows) alpha = 0;
    positions.push(x, renderedHeightAt(x, z) + .034, z); colors.push(color.r, color.g, color.b, alpha); uvs.push(x / 4, z / 4);
    if (xi < columns && zi < rows) {
      const n = zi * (columns + 1) + xi;
      const parity = ((x - origin) / step + (z - origin) / step) % 2;
      if (parity) indices.push(n, n + columns + 1, n + 1, n + 1, n + columns + 1, n + columns + 2);
      else indices.push(n, n + columns + 2, n + 1, n, n + columns + 1, n + columns + 2);
    }
  }
  return overlay(material, 'palmheart-jungle-floor', positions, colors, uvs, indices);
}

function swayPennants(root, wind, owner) {
  root.traverse(object => {
    if (!object.isMesh || object.material.name !== 'canvas_flap') return;
    const cloth = object.material = object.material.clone(); owner.material.push(cloth);
    cloth.onBeforeCompile = shader => {
      shader.uniforms.palmheartWind = wind;
      shader.vertexShader = 'uniform float palmheartWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(palmheartWind + position.x * .55) * max(-position.y, 0.0) * .11;');
    };
    cloth.customProgramCacheKey = () => 'palmheart-pennant-wind-v1';
  });
}

// One InstancedMesh per source primitive per cell. Trees use larger cells and
// cast shadows; ground plants stay shadowless and thin with distance.
function batches(prefab, points, parent, { kind = 'plant', cell = CELL, castShadow = false, wind = null, windKey = GROUND_WIND.key, windHook = GROUND_WIND.hook, windMaterials = null, tint = null } = {}) {
  if (!points.length) return [];
  const cells = new Map(), result = [], transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
  for (const point of points) {
    const key = Math.floor(point.x / cell) + ':' + Math.floor(point.z / cell);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }
  const template = prefab.clone(true); template.updateMatrixWorld(true);
  template.traverse(source => {
    if (!source.isMesh) return;
    const blade = source.material.clone();
    parent.material.push(blade);
    if (tint) blade.color.multiply(tint);
    if (wind && (!windMaterials || windMaterials.has(source.material.name))) {
      blade.side = THREE.DoubleSide;
      blade.onBeforeCompile = shader => {
        shader.uniforms.palmheartWind = wind;
        shader.vertexShader = 'uniform float palmheartWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n' + windHook + '\n#endif');
      };
      blade.customProgramCacheKey = () => windKey;
    }
    for (const [key, cellPoints] of cells) {
      const mesh = new THREE.InstancedMesh(source.geometry, blade, cellPoints.length);
      mesh.name = 'palmheart-camp-' + kind + '-' + prefab.name + '-' + key;
      cellPoints.forEach((point, index) => {
        transform.position.set(point.x, renderedHeightAt(point.x, point.z) + .015, point.z); transform.rotation.set(0, point.yaw ?? 0, 0);
        transform.scale.setScalar(point.scale ?? 1); transform.updateMatrix();
        matrix.multiplyMatrices(transform.matrix, source.matrixWorld); mesh.setMatrixAt(index, matrix);
      });
      mesh.castShadow = castShadow; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      mesh.userData.fullCount = cellPoints.length; mesh.userData.detailKind = kind;
      const [cx, cz] = key.split(':').map(Number); mesh.userData.cellCenter = { x: (cx + .5) * cell, z: (cz + .5) * cell };
      parent.add(mesh); result.push(mesh);
    }
  });
  return result;
}

export function buildPalmheartKit(camp, shared, { propSites = [] } = {}) {
  const prefabs = prefabRoots(camp.scene, PALMHEART_PREFABS), library = prefabRoots(shared.scene, ['fern_clump', 'grass_clump']);
  const materials = sourceMaterials(shared.scene), slots = sourceMaterials(camp.scene);
  for (const name of slots.keys()) {
    const binding = PALMHEART_MATERIAL_BINDINGS[name];
    if (!binding || !materials.has(binding.source)) throw new Error('Palmheart Camp material binding is missing: ' + name);
  }
  if (!materials.has('ground_earth')) throw new Error('Palmheart Camp shared ground_earth is missing');
  const sites = palmheartWorkSites(propSites);
  const group = new THREE.Group(); group.name = 'palmheart-camp-jungle-environment'; group.material = [];
  const boundLibrary = new THREE.Group(), borrowed = [camp.scene, shared.scene]; boundLibrary.material = [];
  try {
    const bindings = new Map();
    for (const name of slots.keys()) {
      const binding = PALMHEART_MATERIAL_BINDINGS[name], material = materials.get(binding.source).clone();
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
    // The tent is not enterable: one authored shell over the original footprint.
    const tent = footing(bound.trailkeepers_tent, PALMHEART_TENT.x, PALMHEART_TENT.z, PALMHEART_TENT.yaw, PALMHEART_TENT.radius);
    tent.name = 'palmheart-authored-trailkeepers-tent'; group.add(tent);
    // Authored work sites take over the exact original positions and radii.
    const work = [['fire_ring', sites.fire, 0], ['gear_rack', sites.gear, .35], ['camp_lantern', sites.lantern, 0]];
    for (const [name, site, yaw] of work) {
      const root = footing(bound[name], site.x, site.z, yaw, site.radius);
      root.name = 'palmheart-authored-' + name.replaceAll('_', '-'); group.add(root);
      if (name === 'gear_rack') swayPennants(root, wind, boundLibrary);
    }
    group.add(buildPalmheartTerrain(materials.get('ground_earth'), sites));
    // Deterministic planting: never on the trail, the shrine ring, Bram's loop,
    // the guarded approach, the chest or an original work site.
    const random = seededRandom(512023), reserved = [...propSites], trees = [];
    let hardwoods = 0;
    for (let index = 0; index < 2600 && trees.length < 34; index++) {
      const x = -112 + random() * 56, z = -18 + random() * 56;
      if (random() > palmheartWeight(x, z) || !palmheartPlantClearance(x, z, reserved, 1.4)) continue;
      if (trees.some(tree => Math.hypot(x - tree.x, z - tree.z) < 4)) continue;
      const palm = random() < .34, prefab = palm ? 'jungle_palm' : hardwoods++ % 2 ? 'jungle_tree_b' : 'jungle_tree_a';
      trees.push({ prefab, x, z, yaw: random() * TAU, scale: .8 + random() * .35 });
    }
    const canopy = ['jungle_tree_a', 'jungle_tree_b', 'jungle_palm'].flatMap(name => batches(bound[name], trees.filter(tree => tree.prefab === name), group,
      { kind: 'tree', cell: 64, castShadow: true, wind, windKey: CANOPY_WIND.key, windHook: CANOPY_WIND.hook, windMaterials: CANOPY_MATERIALS }));
    // The collidable jungle trees keep their recorded radius and height; only
    // the silhouette is authored, so they carry a non-uniform scale.
    const canopyTrees = PALMHEART_CANOPY_OBSTACLES.map(obstacle => {
      const root = place(bound.jungle_tree_b, obstacle.x, heightAt(obstacle.x, obstacle.z), obstacle.z);
      root.scale.set(obstacle.radius / 3.8, obstacle.height / 11, obstacle.radius / 3.8);
      root.name = 'palmheart-canopy-' + obstacle.id; group.add(root); return root;
    });
    const scatter = (target, attempts, base, spread) => {
      const points = [];
      for (let index = 0; index < attempts && points.length < target; index++) {
        const x = -112 + random() * 56, z = -18 + random() * 56;
        if (random() > palmheartWeight(x, z) || !palmheartPlantClearance(x, z, reserved, .15)) continue;
        points.push({ x, z, yaw: random() * TAU, scale: base + random() * spread });
      }
      return points;
    };
    const ears = scatter(90, 900, .8, .45), ferns = scatter(140, 1400, .7, .5), grass = scatter(110, 1100, .55, .5);
    const detail = [
      ...batches(bound.elephant_ear_clump, ears, group, { kind: 'elephant-ear', wind }),
      ...batches(library.fern_clump, ferns, group, { kind: 'fern', wind, tint: new THREE.Color(.9, 1.15, .8) }),
      ...batches(library.grass_clump, grass, group, { kind: 'grass', wind, tint: new THREE.Color(.85, 1.3, .7) }),
    ];
    return { group, wind, detail, canopy, ownedRoots: [group, boundLibrary],
      counts: { prefabs: PALMHEART_PREFABS.length, workSites: work.length, trees: trees.length, canopyTrees: canopyTrees.length,
        elephantEars: ears.length, ferns: ferns.length, grass: grass.length, detailMeshes: detail.length, cellSize: CELL } };
  } catch (error) { disposeOwnedResources([group, boundLibrary], borrowed); throw error; }
}

export function createPalmheartCamp({ scene, settlements, assets = null, legacyVegetation = null, load } = {}) {
  const cache = assets ?? createEnvironmentAssets(load ? { load } : {}), ownsCache = !assets;
  const leases = [cache.acquire(SHARED_URL), cache.acquire(CAMP_URL)];
  let disposed = false, kit = null, sources = [], status = 'loading', error = null;
  const release = () => { for (const lease of leases) lease.release(); if (ownsCache) cache.dispose(); };
  const restoreFallback = () => {
    try { settlements.setPalmheartCampKit(null); }
    catch (failure) { error = [error, 'Fallback restore: ' + String(failure?.message ?? failure)].filter(Boolean).join('; '); }
    if (legacyVegetation) legacyVegetation.visible = true;
  };
  const ready = Promise.all(leases.map(lease => lease.ready)).then(([shared, camp]) => {
    if (disposed) return false;
    sources = [camp.scene, shared.scene];
    kit = buildPalmheartKit(camp, shared, { propSites: settlements.group.userData.propSites });
    scene.add(kit.group); settlements.setPalmheartCampKit(kit);
    if (legacyVegetation) legacyVegetation.visible = false;
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
