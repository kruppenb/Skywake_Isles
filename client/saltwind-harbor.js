import * as THREE from 'three';
import { heightAt, seededRandom } from '../shared/world.js';
import { buildingLocalPoint, buildingWorldPoint } from '../shared/exploration.js';
import { SALTWIND_BUILDINGS, saltwindHarborWeight, saltwindHarborPathDistance, saltwindPlantClearance, saltwindWorkSites } from '../shared/saltwind-harbor.js';
import { createEnvironmentAssets, disposeOwnedResources } from './environment-assets.js';
import { renderedHeightAt, TERRAIN_GRID_STEP, TERRAIN_GRID_HALF } from './environment-geometry.js';

export const SALTWIND_BUILDING_PREFIXES = Object.freeze({ 'net-house': 'net_house', 'saltwind-tavern': 'tavern', 'fishers-cottage': 'fisher_cottage' });
const BUILDING_PARTS = ['base', 'wall_east', 'wall_west', 'wall_front', 'wall_back', 'roof'];
export const SALTWIND_HARBOR_PREFABS = [
  ...Object.values(SALTWIND_BUILDING_PREFIXES).flatMap(prefix => BUILDING_PARTS.map(part => prefix + '_' + part)),
  'drying_net', 'dock_post', 'mending_table', 'fish_crates', 'lobster_pot', 'harbor_lantern',
];
export const SALTWIND_MATERIAL_BINDINGS = Object.freeze({
  watch_stone: { source: 'watch_stone' }, aged_timber: { source: 'aged_timber' },
  forged_iron: { source: 'forged_iron' }, recess_shadow: { source: 'recess_shadow' }, lantern_amber: { source: 'lantern_amber' },
  tar_timber: { source: 'aged_timber', color: [1.0, .95, .90], normalScale: .5 },
  salt_plank: { source: 'aged_timber', color: [5.0, 5.7, 6.5], normalScale: .30 },
  shake_roof: { source: 'dark_slate', color: [4.2, 4.8, 4.0], normalScale: .40 },
  oak_frame: { source: 'aged_timber', color: [1.9, 1.6, 1.25], normalScale: .6 },
  tavern_wash: { source: 'aged_timber', color: [6.4, 5.7, 4.3], normalScale: .30 },
  harbor_tile: { source: 'dark_slate', color: [9.5, 2.2, 1.2], normalScale: .45 },
  cottage_wash: { source: 'aged_timber', color: [6.2, 6.3, 5.9], normalScale: .28 },
  sea_blue: { source: 'aged_timber', color: [1.5, 3.4, 4.6], normalScale: .45 },
  faded_tile: { source: 'dark_slate', color: [10.0, 4.2, 3.0], normalScale: .45 },
  net_cord: { source: 'needle_foliage', color: [2.4, 1.0, 1.35] },
  float_cream: { source: 'ground_earth', color: [9.6, 9.1, 7.7] },
  float_coral: { source: 'ground_earth', color: [9.0, 3.3, 2.2] },
});
const SHARED_URL = '/assets/old-watch/kit.glb', HARBOR_URL = '/assets/saltwind-harbor/kit.glb';
const TAU = Math.PI * 2, CELL = 16, clamp = THREE.MathUtils.clamp;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function prefabRoots(scene, names) {
  return Object.fromEntries(names.map(name => {
    const root = scene.getObjectByName(name); let meshes = 0;
    root?.traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count && object.material) meshes++; });
    if (!meshes) throw new Error('Saltwind Harbor kit is missing or empty: ' + name);
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
function insideAnyBuilding(x, z, margin) {
  return SALTWIND_BUILDINGS.some(building => {
    const local = buildingLocalPoint(building, x, z);
    return Math.abs(local.x) < building.width / 2 + margin && Math.abs(local.z) < building.depth / 2 + margin;
  });
}

export function buildSaltwindHarborTerrain(material) {
  const step = TERRAIN_GRID_STEP, origin = -TERRAIN_GRID_HALF;
  const minX = -44, minZ = 76, columns = 21, rows = 23;
  const positions = [], colors = [], uvs = [], indices = [];
  // Pale dry sand with shell-grit routes; damp, darker sand only where the
  // harbor ground has been worked and trodden between the buildings.
  const sand = new THREE.Color('#d3c9a6'), grit = new THREE.Color('#e9e3cb'), trodden = new THREE.Color('#b9ad8a');
  for (let zi = 0; zi <= rows; zi++) for (let xi = 0; xi <= columns; xi++) {
    const x = minX + xi * step, z = minZ + zi * step;
    const weight = saltwindHarborWeight(x, z);
    const path = 1 - smooth((saltwindHarborPathDistance(x, z) - 1.6) / 2.4);
    const mottling = clamp(.5 + Math.sin(x * .37 + z * .21) * .3 + Math.sin(z * .43 - x * .11) * .2, 0, 1);
    const color = sand.clone().lerp(trodden, mottling * .45 * (1 - path)).lerp(grit, path * .85).multiplyScalar(2.05 + path * .55);
    let alpha = weight * (.34 + path * .46);
    if (insideAnyBuilding(x, z, .3) || xi === 0 || zi === 0 || xi === columns || zi === rows) alpha = 0;
    positions.push(x, renderedHeightAt(x, z) + .034, z); colors.push(color.r, color.g, color.b, alpha); uvs.push(x / 4, z / 4);
    if (xi < columns && zi < rows) {
      const n = zi * (columns + 1) + xi;
      const parity = ((x - origin) / step + (z - origin) / step) % 2;
      if (parity) indices.push(n, n + columns + 1, n + 1, n + 1, n + columns + 1, n + columns + 2);
      else indices.push(n, n + columns + 2, n + 1, n, n + columns + 1, n + columns + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const surface = material.clone(); surface.vertexColors = true; surface.transparent = true; surface.depthWrite = false; surface.polygonOffset = false;
  const mesh = new THREE.Mesh(geometry, surface); mesh.name = 'saltwind-harbor-sand-and-shell-paths'; mesh.receiveShadow = true; mesh.renderOrder = 2;
  return mesh;
}

function swayNets(root, wind, owner) {
  root.traverse(object => {
    if (!object.isMesh || object.material.name !== 'net_cord') return;
    const surface = object.material = object.material.clone(); owner.material.push(surface);
    surface.onBeforeCompile = shader => {
      shader.uniforms.saltwindWind = wind;
      shader.vertexShader = 'uniform float saltwindWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(saltwindWind + position.z * .6 + position.x * .4) * pow(max(1.0 - position.y * .35, 0.0), 2.0) * .045;');
    };
    surface.customProgramCacheKey = () => 'saltwind-harbor-net-wind-v1';
  });
}

function batches(prefab, points, parent, { kind = 'grass', wind = null, tint = null } = {}) {
  if (!points.length) return [];
  const cells = new Map(), result = [], transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
  for (const point of points) {
    const key = Math.floor(point.x / CELL) + ':' + Math.floor(point.z / CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }
  const template = prefab.clone(true); template.updateMatrixWorld(true);
  template.traverse(source => {
    if (!source.isMesh) return;
    const surface = source.material.clone();
    parent.material.push(surface);
    if (tint) surface.color.multiply(tint);
    if (wind) {
      surface.side = THREE.DoubleSide;
      surface.onBeforeCompile = shader => {
        shader.uniforms.saltwindWind = wind;
        shader.vertexShader = 'uniform float saltwindWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x += sin(saltwindWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * pow(max(position.y, 0.0), 2.0) * .045;\n#endif');
      };
      surface.customProgramCacheKey = () => 'saltwind-harbor-grass-wind-v1';
    }
    for (const [key, cellPoints] of cells) {
      const mesh = new THREE.InstancedMesh(source.geometry, surface, cellPoints.length);
      mesh.name = 'saltwind-harbor-' + kind + '-' + prefab.name + '-' + key;
      cellPoints.forEach((point, index) => {
        transform.position.set(point.x, renderedHeightAt(point.x, point.z) + .015, point.z); transform.rotation.set(0, point.yaw ?? 0, 0);
        transform.scale.setScalar(point.scale ?? 1); transform.updateMatrix();
        matrix.multiplyMatrices(transform.matrix, source.matrixWorld); mesh.setMatrixAt(index, matrix);
      });
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      mesh.userData.fullCount = cellPoints.length; mesh.userData.detailKind = kind;
      const [cx, cz] = key.split(':').map(Number); mesh.userData.cellCenter = { x: (cx + .5) * CELL, z: (cz + .5) * CELL };
      parent.add(mesh); result.push(mesh);
    }
  });
  return result;
}

export function buildSaltwindHarborKit(harbor, shared, { propSites = [] } = {}) {
  const prefabs = prefabRoots(harbor.scene, SALTWIND_HARBOR_PREFABS), library = prefabRoots(shared.scene, ['grass_clump']);
  const materials = sourceMaterials(shared.scene), slots = sourceMaterials(harbor.scene);
  for (const name of slots.keys()) {
    const binding = SALTWIND_MATERIAL_BINDINGS[name];
    if (!binding || !materials.has(binding.source)) throw new Error('Saltwind Harbor material binding is missing: ' + name);
  }
  if (!materials.has('ground_earth')) throw new Error('Saltwind Harbor shared ground_earth is missing');
  const sites = saltwindWorkSites(propSites);
  const group = new THREE.Group(); group.name = 'saltwind-harbor-weathered-environment'; group.material = [];
  const boundLibrary = new THREE.Group(), borrowed = [harbor.scene, shared.scene]; boundLibrary.material = [];
  try {
    const bindings = new Map();
    for (const name of slots.keys()) {
      const binding = SALTWIND_MATERIAL_BINDINGS[name], material = materials.get(binding.source).clone();
      boundLibrary.material.push(material); material.name = name; material.vertexColors = true;
      if (binding.color) material.color.multiply(new THREE.Color(...binding.color));
      if (binding.normalScale != null) material.normalScale.setScalar(binding.normalScale);
      bindings.set(name, material);
    }
    const bound = Object.fromEntries(Object.entries(prefabs).map(([name, prefab]) => {
      const copy = prefab.clone(true);
      copy.traverse(object => { if (object.isMesh) object.material = Array.isArray(object.material) ? object.material.map(material => bindings.get(material.name)) : bindings.get(object.material.name); });
      boundLibrary.add(copy); return [name, copy];
    }));
    const normals = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    const buildings = {};
    for (const building of SALTWIND_BUILDINGS) {
      const prefix = SALTWIND_BUILDING_PREFIXES[building.id], floor = heightAt(building.x, building.z);
      group.add(place(bound[prefix + '_base'], building.x, floor, building.z, building.yaw));
      const walls = new THREE.Group(); walls.name = building.id + '-authored-cutaway-walls';
      ['east', 'west', 'front', 'back'].forEach((face, index) => {
        const wall = place(bound[prefix + '_wall_' + face], building.x, floor, building.z, building.yaw); wall.userData.normal = normals[index]; walls.add(wall);
      });
      const roof = place(bound[prefix + '_roof'], building.x, floor, building.z, building.yaw); roof.name = building.id + '-authored-cutaway-roof';
      group.add(walls, roof); buildings[building.id] = { walls, roof };
    }
    const wind = { value: 0 };
    // Authored work sites take over the exact original positions and radii.
    const work = [['mending_table', sites.mending, .25], ['fish_crates', sites.crates, 0], ['drying_net', sites.net, 0], ['harbor_lantern', sites.lantern, 0]];
    for (const [name, site, yaw] of work) {
      const root = footing(bound[name], site.x, site.z, yaw, site.radius); root.name = 'saltwind-harbor-authored-' + name.replaceAll('_', '-');
      swayNets(root, wind, boundLibrary); group.add(root);
    }
    const netHouse = SALTWIND_BUILDINGS[0];
    const postSites = [-2.6, -.9, .9, 2.6].map(offset => buildingWorldPoint(netHouse, netHouse.width / 2 + 2.7, offset));
    const posts = postSites.map((site, index) => { const post = footing(bound.dock_post, site.x, site.z, index * .7, .3); post.name = 'net-house-dock-post-' + index; group.add(post); return post; });
    const pots = [[2.6, 1.9, .4], [3.5, .6, 2.3], [-3.2, -1.2, 1.1]]
      .map(([dx, dz, yaw]) => ({ ...buildingWorldPoint(netHouse, dx, dz), yaw }))
      .filter(point => saltwindPlantClearance(point.x, point.z, propSites, .1) && !insideAnyBuilding(point.x, point.z, .9))
      .map((point, index) => { const pot = footing(bound.lobster_pot, point.x, point.z, point.yaw, .55); pot.name = 'saltwind-harbor-lobster-pot-' + index; group.add(pot); return pot; });
    group.add(buildSaltwindHarborTerrain(materials.get('ground_earth')));
    // Sparse dune grass, pale straw rather than the island's green lawn tufts.
    const random = seededRandom(661209), grass = [];
    for (let index = 0; index < 1100 && grass.length < 140; index++) {
      const x = -44 + random() * 42, z = 76 + random() * 46;
      if (random() > saltwindHarborWeight(x, z) || !saltwindPlantClearance(x, z, propSites, .15)) continue;
      if (Math.sin(x * .5 + z * .2) + Math.sin(z * .47 - x * .13) < .1) continue;
      grass.push({ x, z, yaw: random() * TAU, scale: .5 + random() * .5 });
    }
    const detail = batches(library.grass_clump, grass, group, { kind: 'grass', wind, tint: new THREE.Color(1.7, 1.55, 1.0) });
    return { group, buildings, wind, detail, ownedRoots: [group, boundLibrary],
      counts: { prefabs: SALTWIND_HARBOR_PREFABS.length, buildings: SALTWIND_BUILDINGS.length, workSites: work.length, dockPosts: posts.length, lobsterPots: pots.length, grass: grass.length, detailMeshes: detail.length, cellSize: CELL } };
  } catch (error) { disposeOwnedResources([group, boundLibrary], borrowed); throw error; }
}

export function createSaltwindHarbor({ scene, settlements, assets = null, legacyVegetation = null, load } = {}) {
  const cache = assets ?? createEnvironmentAssets(load ? { load } : {}), ownsCache = !assets;
  const leases = [cache.acquire(SHARED_URL), cache.acquire(HARBOR_URL)];
  let disposed = false, kit = null, sources = [], status = 'loading', error = null;
  const release = () => { for (const lease of leases) lease.release(); if (ownsCache) cache.dispose(); };
  const restoreFallback = () => {
    try { settlements.setSaltwindHarborKit(null); }
    catch (failure) { error = [error, 'Fallback restore: ' + String(failure?.message ?? failure)].filter(Boolean).join('; '); }
    if (legacyVegetation) legacyVegetation.visible = true;
  };
  const ready = Promise.all(leases.map(lease => lease.ready)).then(([shared, harbor]) => {
    if (disposed) return false;
    sources = [harbor.scene, shared.scene];
    kit = buildSaltwindHarborKit(harbor, shared, { propSites: settlements.group.userData.propSites });
    scene.add(kit.group); settlements.setSaltwindHarborKit(kit);
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
    kit.wind.value = reducedMotion ? 0 : time * .9;
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
