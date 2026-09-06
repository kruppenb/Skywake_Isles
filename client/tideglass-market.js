import * as THREE from 'three';
import { heightAt, seededRandom, BEACON } from '../shared/world.js';
import { BUILDINGS, buildingLocalPoint } from '../shared/exploration.js';
import { tideglassWeight, tideglassPaths, tideglassPathDistance, tideglassPlantClearance } from '../shared/tideglass-market.js';
import { createEnvironmentAssets, disposeOwnedResources } from './environment-assets.js';
import { renderedHeightAt, TERRAIN_GRID_STEP, TERRAIN_GRID_HALF } from './environment-geometry.js';

export const TIDEGLASS_MARKET_PREFABS = ['cottage_base', 'cottage_wall_east', 'cottage_wall_west', 'cottage_wall_front', 'cottage_wall_back', 'cottage_roof', 'fruit_stall', 'sailcloth_stall', 'haven_hut', 'paving_slab', 'coastal_shrub'];
export const TIDEGLASS_MATERIAL_BINDINGS = Object.freeze({
  watch_stone: { source: 'watch_stone' }, aged_timber: { source: 'aged_timber', color: [1.85, 1.85, 1.85] },
  forged_iron: { source: 'forged_iron' }, recess_shadow: { source: 'recess_shadow' },
  haven_plaster: { source: 'watch_stone', color: [6.2, 6.0, 5.0], normalScale: .28 },
  harbor_teal: { source: 'dark_slate', color: [1.25, 3.1, 2.5] },
  canvas_cream: { source: 'ground_earth', color: [10, 10, 12], normalScale: .18 },
  canvas_coral: { source: 'ground_earth', color: [9, 3.8, 3.5], normalScale: .18 },
  canvas_teal: { source: 'ground_earth', color: [2.6, 7, 10], normalScale: .18 },
  coastal_leaf: { source: 'needle_foliage', color: [1.1, 1.4, .9] },
  produce_gold: { source: 'needle_foliage', color: [4.1, 2.1, .38] },
  produce_coral: { source: 'needle_foliage', color: [4.1, .85, .45] },
});
const SHARED_URL = '/assets/old-watch/kit.glb', MARKET_URL = '/assets/tideglass-market/kit.glb';
const TAU = Math.PI * 2, CELL = 16, clamp = THREE.MathUtils.clamp;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function prefabRoots(scene, names) {
  return Object.fromEntries(names.map(name => {
    const root = scene.getObjectByName(name); let meshes = 0;
    root?.traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count && object.material) meshes++; });
    if (!meshes) throw new Error('Tideglass Market kit is missing or empty: ' + name);
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
function footing(prefab, site) {
  let y = renderedHeightAt(site.x, site.z);
  for (let index = 0; index < 16; index++) {
    const a = index / 16 * TAU;
    y = Math.max(y, renderedHeightAt(site.x + Math.sin(a) * site.radius * .83, site.z + Math.cos(a) * site.radius * .83));
  }
  const root = place(prefab, site.x, y, site.z, site.yaw ?? 0);
  // Use a disposable graph for bounds; never write matrixWorld on cached roots.
  const bounds = new THREE.Box3().setFromObject(prefab.clone(true));
  root.scale.y = Math.min(1, Math.max(.5, (heightAt(site.x, site.z) + site.height - y) / bounds.max.y));
  return root;
}

export function buildTideglassTerrain(material, hutSites) {
  const origin = -TERRAIN_GRID_HALF, step = TERRAIN_GRID_STEP;
  const minX = -54, minZ = -20, columns = 45, rows = 42;
  const positions = [], colors = [], uvs = [], indices = [];
  const earth = new THREE.Color('#b9ae90'), moss = new THREE.Color('#849a78'), pathColor = new THREE.Color('#d0c6ac');
  const cottage = BUILDINGS.find(building => building.id === 'market-cottage');
  for (let zi = 0; zi <= rows; zi++) for (let xi = 0; xi <= columns; xi++) {
    const x = minX + xi * step, z = minZ + zi * step;
    const path = 1 - smooth((tideglassPathDistance(x, z, hutSites) - 1.5) / 2.2);
    const mottling = clamp(.35 + Math.sin(x * .36 + z * .14) * .25 + Math.sin(z * .41) * .17, 0, 1);
    const color = earth.clone().lerp(moss, mottling * (1 - path)).lerp(pathColor, path * .8).multiplyScalar(1.9 + path * 1.1);
    // Let the original green lawn remain between worn sandy routes.
    let alpha = tideglassWeight(x, z) * (.48 + path * .43);
    const local = buildingLocalPoint(cottage, x, z);
    if (Math.abs(local.x) < cottage.width / 2 + .3 && Math.abs(local.z) < cottage.depth / 2 + .3) alpha = 0;
    // Existing raised objective masonry stays clean, with a soft soil transition.
    alpha *= smooth((Math.hypot(x - BEACON.x, z - BEACON.z) - 5.3) / 2.5);
    if (xi === 0 || zi === 0 || xi === columns || zi === rows) alpha = 0;
    positions.push(x, renderedHeightAt(x, z) + .036, z); colors.push(color.r, color.g, color.b, alpha); uvs.push(x / 4, z / 4);
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
  const surface = material.clone(); surface.vertexColors = true; surface.transparent = true; surface.depthWrite = false;
  // The matching terrain triangles already have 36mm clearance. Depth bias
  // would pull this translucent soil over the pavers' shallow exposed tops.
  surface.polygonOffset = false;
  const mesh = new THREE.Mesh(geometry, surface); mesh.name = 'tideglass-market-earth-and-public-paths'; mesh.receiveShadow = true; mesh.renderOrder = 2;
  return mesh;
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
        shader.uniforms.tideglassWind = wind;
        shader.vertexShader = 'uniform float tideglassWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x += sin(tideglassWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * pow(max(position.y, 0.0), 2.0) * .035;\n#endif');
      };
      surface.customProgramCacheKey = () => 'tideglass-market-wind-v1';
    }
    for (const [key, cellPoints] of cells) {
      const mesh = new THREE.InstancedMesh(source.geometry, surface, cellPoints.length);
      mesh.name = 'tideglass-market-' + kind + '-' + prefab.name + '-' + key;
      cellPoints.forEach((point, index) => {
        transform.position.set(point.x, point.y ?? renderedHeightAt(point.x, point.z) + .015, point.z); transform.rotation.set(0, point.yaw ?? 0, 0);
        if (Array.isArray(point.scale)) transform.scale.set(...point.scale); else transform.scale.setScalar(point.scale ?? 1);
        transform.updateMatrix();
        if (point.slopeX != null) {
          const elements = transform.matrix.elements;
          elements[1] = point.slopeX * elements[0] + point.slopeZ * elements[2];
          elements[9] = point.slopeX * elements[8] + point.slopeZ * elements[10];
        }
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

function pathStones(propSites, hutSites) {
  const random = seededRandom(834993), points = [], cottage = BUILDINGS.find(building => building.id === 'market-cottage');
  for (const route of tideglassPaths(hutSites)) for (let index = 1; index < route.length; index++) {
    const a = route[index - 1], b = route[index], length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let along = .8; along < length; along += 1.2 + random() * .8) {
      const t = along / length, side = (random() - .5) * 1.5;
      const x = a.x + (b.x - a.x) * t + (b.z - a.z) / length * side, z = a.z + (b.z - a.z) * t - (b.x - a.x) / length * side;
      const local = buildingLocalPoint(cottage, x, z);
      if (tideglassWeight(x, z) < .15 || Math.hypot(x - BEACON.x, z - BEACON.z) < 7.6) continue;
      if (Math.abs(local.x) < cottage.width / 2 + .6 && Math.abs(local.z) < cottage.depth / 2 + .8) continue;
      if (propSites.some(site => Math.hypot(x - site.x, z - site.z) < site.radius + .3)) continue;
      if (BUILDINGS.some(site => !site.enterable && Math.hypot(x - site.x, z - site.z) < site.radius + .4)) continue;
      points.push({ x, z, yaw: random() * TAU, scale: [.72 + random() * .3, 1, .65 + random() * .3], y: renderedHeightAt(x, z) + .018,
        slopeX: (renderedHeightAt(x + .4, z) - renderedHeightAt(x - .4, z)) / .8,
        slopeZ: (renderedHeightAt(x, z + .4) - renderedHeightAt(x, z - .4)) / .8 });
    }
  }
  return points;
}

export function buildTideglassMarketKit(market, shared, { propSites = [], hutSites = [] } = {}) {
  const prefabs = prefabRoots(market.scene, TIDEGLASS_MARKET_PREFABS), library = prefabRoots(shared.scene, ['grass_clump', 'ground_sample']);
  const materials = sourceMaterials(shared.scene), slots = sourceMaterials(market.scene);
  for (const name of slots.keys()) {
    const binding = TIDEGLASS_MATERIAL_BINDINGS[name];
    if (!binding || !materials.has(binding.source)) throw new Error('Tideglass Market material binding is missing: ' + name);
  }
  if (!materials.has('ground_earth')) throw new Error('Tideglass Market shared ground_earth is missing');
  const group = new THREE.Group(); group.name = 'tideglass-market-weathered-environment'; group.material = [];
  const boundLibrary = new THREE.Group(), borrowed = [market.scene, shared.scene]; boundLibrary.material = [];
  try {
    const bindings = new Map();
    for (const name of slots.keys()) {
      const binding = TIDEGLASS_MATERIAL_BINDINGS[name], material = materials.get(binding.source).clone();
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
    const cottage = BUILDINGS.find(building => building.id === 'market-cottage'), floor = heightAt(cottage.x, cottage.z);
    group.add(place(bound.cottage_base, cottage.x, floor, cottage.z, cottage.yaw));
    const walls = new THREE.Group(); walls.name = 'market-cottage-authored-cutaway-walls';
    const normals = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    ['east', 'west', 'front', 'back'].forEach((face, index) => {
      const wall = place(bound['cottage_wall_' + face], cottage.x, floor, cottage.z, cottage.yaw); wall.userData.normal = normals[index]; walls.add(wall);
    });
    const roof = place(bound.cottage_roof, cottage.x, floor, cottage.z, cottage.yaw); roof.name = 'market-cottage-authored-cutaway-roof'; group.add(walls, roof);
    for (const id of ['fruit-stall', 'sailcloth-stall']) {
      const root = footing(bound[id.replaceAll('-', '_')], BUILDINGS.find(building => building.id === id)); root.name = id + '-authored'; group.add(root);
    }
    for (const hut of hutSites) { const root = footing(bound.haven_hut, hut); root.name = hut.id + '-authored-haven-hut'; group.add(root); }
    group.add(buildTideglassTerrain(materials.get('ground_earth'), hutSites));
    const random = seededRandom(843251), grass = [], shrubs = [], wind = { value: 0 }, detail = [];
    for (let index = 0; index < 1800; index++) {
      const x = -52 + random() * 85, z = -17 + random() * 79;
      if (random() > tideglassWeight(x, z) || !tideglassPlantClearance(x, z, propSites, .15, hutSites)) continue;
      const patch = Math.sin(x * .45 + z * .18) + Math.sin(z * .51 - x * .16);
      if (patch < -.3) continue;
      const shrub = patch > .8 && shrubs.length < 52 && random() < .27;
      if (shrub || grass.length < 190) (shrub ? shrubs : grass).push({ x, z, yaw: random() * TAU, scale: shrub ? .72 + random() * .3 : .45 + random() * .45 });
    }
    detail.push(...batches(library.grass_clump, grass, group, { kind: 'grass', wind, tint: new THREE.Color(1.12, 1.18, .82) }));
    detail.push(...batches(bound.coastal_shrub, shrubs, group, { kind: 'shrubs', wind }));
    const stones = pathStones(propSites, hutSites);
    detail.push(...batches(bound.paving_slab, stones, group, { kind: 'stones', tint: new THREE.Color(1.8, 1.8, 1.65) }));
    return { group, walls, roof, detail, wind, ownedRoots: [group, boundLibrary], counts: { prefabs: TIDEGLASS_MARKET_PREFABS.length, huts: hutSites.length, stalls: 2, grass: grass.length, shrubs: shrubs.length, flagstones: stones.length, detailMeshes: detail.length, cellSize: CELL } };
  } catch (error) { disposeOwnedResources([group, boundLibrary], borrowed); throw error; }
}

export function createTideglassMarket({ scene, settlements, assets = null, legacyVegetation = null, hutSites = [], hutFallback = null, load } = {}) {
  const cache = assets ?? createEnvironmentAssets(load ? { load } : {}), ownsCache = !assets;
  const leases = [cache.acquire(SHARED_URL), cache.acquire(MARKET_URL)];
  let disposed = false, kit = null, sources = [], status = 'loading', error = null;
  const release = () => { for (const lease of leases) lease.release(); if (ownsCache) cache.dispose(); };
  const restoreFallback = () => {
    try { settlements.setTideglassMarketKit(null); }
    catch (failure) { error = [error, 'Fallback restore: ' + String(failure?.message ?? failure)].filter(Boolean).join('; '); }
    if (legacyVegetation) legacyVegetation.visible = true;
    if (hutFallback) hutFallback.visible = true;
  };
  const ready = Promise.all(leases.map(lease => lease.ready)).then(([shared, market]) => {
    if (disposed) return false;
    sources = [market.scene, shared.scene];
    kit = buildTideglassMarketKit(market, shared, { propSites: settlements.group.userData.propSites, hutSites });
    scene.add(kit.group); settlements.setTideglassMarketKit(kit);
    if (legacyVegetation) legacyVegetation.visible = false;
    if (hutFallback) hutFallback.visible = false;
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
    kit.wind.value = reducedMotion ? 0 : time * 1.1;
    for (const mesh of kit.detail) {
      const { cellCenter: cell, detailKind: kind, fullCount } = mesh.userData;
      const distance = player ? Math.hypot(player.x - cell.x, player.z - cell.z) : Infinity;
      mesh.visible = distance < (lowQuality ? 65 : 105);
      mesh.count = kind === 'stones' ? fullCount : Math.max(1, Math.floor(fullCount * (lowQuality ? .42 : distance > 65 ? .65 : 1)));
    }
  }, getStats: () => ({ status, ready: status === 'ready', loading: status === 'loading', fallback: status !== 'ready', error, ...(kit?.counts ?? {}), visibleDetailMeshes: kit?.detail.filter(mesh => mesh.visible).length ?? 0 }), dispose() {
    if (disposed) return;
    disposed = true; status = 'disposed'; restoreFallback();
    if (kit) { kit.group.removeFromParent(); disposeOwnedResources(kit.ownedRoots, sources); }
    kit = null; sources = []; release();
  } };
}
