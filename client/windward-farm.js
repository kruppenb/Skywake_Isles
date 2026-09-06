import * as THREE from 'three';
import { heightAt, seededRandom } from '../shared/world.js';
import { BUILDINGS, buildingLocalPoint } from '../shared/exploration.js';
import { oldWatchWeight } from '../shared/old-watch.js';
import { windwardFarmWeight, windwardFarmPaths, windwardFarmPathDistance, windwardFarmFields, windwardFarmCrops, windwardFarmFences, farmPlantClearance } from '../shared/windward-farm.js';
import { createEnvironmentAssets, disposeOwnedResources } from './environment-assets.js';
import { renderedHeightAt, TERRAIN_GRID_STEP, TERRAIN_GRID_HALF } from './environment-geometry.js';

export const WINDWARD_FARM_PREFABS = ['windmill_body', 'windmill_sails', 'barn_base', 'barn_wall_east', 'barn_wall_west', 'barn_wall_front', 'barn_wall_back', 'barn_roof', 'crop_wheat', 'crop_leafy', 'fence_section', 'hay_bale'];
export const WINDWARD_FARM_MATERIAL_BINDINGS = Object.freeze({
  watch_stone: { source: 'watch_stone' }, aged_timber: { source: 'aged_timber' },
  forged_iron: { source: 'forged_iron' }, recess_shadow: { source: 'recess_shadow' },
  farm_plaster: { source: 'watch_stone', color: [1.65, 1.48, 1.20] },
  farm_roof: { source: 'dark_slate', color: [3.40, 1.22, .69] },
  crop_straw: { source: 'needle_foliage', color: [3.00, 1.65, .62] },
  crop_leaf: { source: 'needle_foliage', color: [.91, 1.16, .68] },
  hay_straw: { source: 'aged_timber', color: [2.20, 1.68, .74] },
});
const SHARED_URL = '/assets/old-watch/kit.glb', FARM_URL = '/assets/windward-farm/kit.glb';
const TAU = Math.PI * 2, CELL = 14, clamp = THREE.MathUtils.clamp;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function prefabRoots(scene, names) {
  return Object.fromEntries(names.map(name => {
    const root = scene.getObjectByName(name); let meshes = 0;
    root?.traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count && object.material) meshes++; });
    if (!meshes) throw new Error('Windward Farm kit is missing or empty: ' + name);
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

function addHayStack(parent, prefab, site) {
  const bounds = new THREE.Box3().setFromObject(prefab), width = bounds.max.x - bounds.min.x;
  const lower = [-1, 1].map(side => {
    const x = site.x + side * width * .46, z = site.z + (side > 0 ? .025 : 0);
    const bale = place(prefab, x, renderedHeightAt(x, z) - bounds.min.y, z, side * -.025);
    bale.name = 'windward-farm-hay-lower-' + side; parent.add(bale); return bale;
  });
  // Bales use their exported support height, including small terrain changes.
  // Settle the bevel slightly into the two supports rather than floating above.
  const support = Math.max(...lower.map(bale => bale.position.y + bounds.max.y));
  const top = place(prefab, site.x, support - bounds.min.y - .025, site.z, .04);
  top.name = 'windward-farm-hay-top'; parent.add(top);
}

export function buildWindwardFarmTerrain(material, fields) {
  const origin = -TERRAIN_GRID_HALF, step = TERRAIN_GRID_STEP;
  const minX = origin + Math.floor((-74 - origin) / step) * step, minZ = origin + Math.floor((-82 - origin) / step) * step;
  const columns = 29, rows = 28, positions = [], colors = [], uvs = [], indices = [];
  const dirt = new THREE.Color('#b4aa8c'), moss = new THREE.Color('#808c69'), track = new THREE.Color('#c3b497'), cultivated = new THREE.Color('#987e5c');
  const barn = BUILDINGS.find(building => building.id === 'harvest-barn');
  for (let zi = 0; zi <= rows; zi++) for (let xi = 0; xi <= columns; xi++) {
    const x = minX + xi * step, z = minZ + zi * step;
    const path = 1 - smooth((windwardFarmPathDistance(x, z) - 1.4) / 2.2);
    const mottling = clamp(.35 + Math.sin(x * .39) * .22 + Math.sin(z * .3 + x * .1) * .18, 0, 1);
    const color = dirt.clone().lerp(moss, mottling * (1 - path));
    const fieldWeight = Math.max(...fields.map(field => smooth(Math.min((field.rows - 1) * field.rowSpacing / 2 + .9 - Math.abs(x - field.x), (field.columns - 1) * field.spacing / 2 + .8 - Math.abs(z - field.z)) / .8)));
    color.lerp(cultivated, fieldWeight * .82).lerp(track, path * .7).multiplyScalar(1 + path * 2.2);
    const variation = .94 + .06 * Math.sin(x * .49 + z * .24);
    let alpha = windwardFarmWeight(x, z) * (1 - oldWatchWeight(x, z)) * .98 * variation;
    const local = buildingLocalPoint(barn, x, z);
    if (Math.abs(local.x) < barn.width / 2 + .25 && Math.abs(local.z) < barn.depth / 2 + .25) alpha = 0;
    positions.push(x, renderedHeightAt(x, z) + .036, z); colors.push(color.r, color.g, color.b, alpha); uvs.push(x / 4, z / 4);
    if (zi < rows && xi < columns) {
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
  surface.polygonOffset = true; surface.polygonOffsetFactor = -1; surface.polygonOffsetUnits = -1;
  const mesh = new THREE.Mesh(geometry, surface); mesh.name = 'windward-farm-earth-fields-and-trail'; mesh.receiveShadow = true; mesh.renderOrder = 2;
  return mesh;
}

function batches(prefab, points, parent, { material = null, kind = 'detail', wind = null, tint = null } = {}) {
  if (!points.length) return [];
  const cells = new Map(), result = [], transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
  for (const point of points) {
    const key = Math.floor(point.x / CELL) + ':' + Math.floor(point.z / CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }
  // Compute matrices on a disposable clone, leaving the cache's source graph alone.
  const template = prefab.clone(true); template.updateMatrixWorld(true);
  template.traverse(source => {
    if (!source.isMesh) return;
    const surface = (material ?? source.material).clone();
    if (tint) surface.color.multiply(tint);
    if (wind) {
      surface.side = THREE.DoubleSide;
      surface.onBeforeCompile = shader => {
        shader.uniforms.farmWind = wind;
        shader.vertexShader = 'uniform float farmWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x += sin(farmWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * pow(max(position.y, 0.0), 2.0) * .035;\n#endif');
      };
      surface.customProgramCacheKey = () => 'windward-farm-wind-v1';
    }
    for (const [key, cellPoints] of cells) {
      const mesh = new THREE.InstancedMesh(source.geometry, surface, cellPoints.length);
      mesh.name = 'windward-farm-' + kind + '-' + prefab.name + '-' + key;
      cellPoints.forEach((point, index) => {
        transform.position.set(point.x, point.y ?? renderedHeightAt(point.x, point.z) + .015, point.z);
        transform.rotation.set(0, point.yaw ?? 0, 0);
        if (Array.isArray(point.scale)) transform.scale.set(...point.scale); else transform.scale.setScalar(point.scale ?? 1);
        transform.updateMatrix();
        if (point.slope != null) transform.matrix.elements[1] = point.slope;
        matrix.multiplyMatrices(transform.matrix, source.matrixWorld); mesh.setMatrixAt(index, matrix);
      });
      mesh.castShadow = kind === 'fences'; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      mesh.userData.fullCount = cellPoints.length; mesh.userData.detailKind = kind;
      const [cx, cz] = key.split(':').map(Number); mesh.userData.cellCenter = { x: (cx + .5) * CELL, z: (cz + .5) * CELL };
      parent.add(mesh); result.push(mesh);
    }
  });
  return result;
}

function pathStones(propSites) {
  const random = seededRandom(92419), points = [];
  for (const route of windwardFarmPaths()) for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let along = .7; along < length; along += 1.25 + random() * .9) {
      const t = along / length, side = (random() - .5) * 1.65;
      const x = a.x + (b.x - a.x) * t + (b.z - a.z) / length * side;
      const z = a.z + (b.z - a.z) * t - (b.x - a.x) / length * side;
      if (windwardFarmWeight(x, z) < .1 || oldWatchWeight(x, z) > .28 || propSites.some(site => Math.hypot(x - site.x, z - site.z) < site.radius + .2)) continue;
      points.push({ x, z, yaw: random() * TAU, scale: [.30 + random() * .2, .032, .24 + random() * .2], y: renderedHeightAt(x, z) + .018 });
    }
  }
  return points;
}

// All validation and staging finish before the settlement swaps its live shell.
export function buildWindwardFarmKit(farm, shared, { propSites = [], fenceSites = [] } = {}) {
  const prefabs = prefabRoots(farm.scene, WINDWARD_FARM_PREFABS);
  const library = prefabRoots(shared.scene, ['rock_a', 'rock_b', 'grass_clump', 'fern_clump', 'ground_sample']);
  const materials = sourceMaterials(shared.scene), slots = sourceMaterials(farm.scene);
  for (const name of slots.keys()) {
    const binding = WINDWARD_FARM_MATERIAL_BINDINGS[name];
    if (!binding || !materials.has(binding.source)) throw new Error('Windward Farm material binding is missing: ' + name);
  }
  if (!materials.has('ground_earth')) throw new Error('Windward Farm shared ground_earth is missing');
  const fields = windwardFarmFields(propSites), crops = windwardFarmCrops(propSites), fences = windwardFarmFences(propSites, fenceSites);
  const group = new THREE.Group(); group.name = 'windward-farm-weathered-environment';
  const boundLibrary = new THREE.Group(), borrowed = [farm.scene, shared.scene];
  // The non-rendered owner also reaches bindings whose prefab staging fails.
  boundLibrary.material = [];
  try {
    const bindings = new Map();
    for (const name of slots.keys()) {
      const binding = WINDWARD_FARM_MATERIAL_BINDINGS[name], material = materials.get(binding.source).clone();
      boundLibrary.material.push(material);
      material.name = name; material.vertexColors = true;
      if (binding.color) material.color.multiply(new THREE.Color(...binding.color));
      bindings.set(name, material);
    }
    const bound = Object.fromEntries(Object.entries(prefabs).map(([name, prefab]) => {
      const copy = prefab.clone(true);
      copy.traverse(object => { if (object.isMesh) object.material = Array.isArray(object.material) ? object.material.map(material => bindings.get(material.name)) : bindings.get(object.material.name); });
      boundLibrary.add(copy); return [name, copy];
    }));
    const barn = BUILDINGS.find(building => building.id === 'harvest-barn'), mill = BUILDINGS.find(building => building.id === 'windward-mill');
    const floor = heightAt(barn.x, barn.z);
    group.add(place(bound.barn_base, barn.x, floor, barn.z, barn.yaw));
    const walls = new THREE.Group(); walls.name = 'harvest-barn-authored-cutaway-walls';
    const normals = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    ['east', 'west', 'front', 'back'].forEach((face, index) => {
      const wall = place(bound['barn_wall_' + face], barn.x, floor, barn.z, barn.yaw); wall.userData.normal = normals[index]; walls.add(wall);
    });
    const roof = place(bound.barn_roof, barn.x, floor, barn.z, barn.yaw); roof.name = 'harvest-barn-authored-cutaway-roof'; group.add(walls, roof);
    let millY = renderedHeightAt(mill.x, mill.z);
    for (let i = 0; i < 12; i++) millY = Math.max(millY, renderedHeightAt(mill.x + Math.sin(i / 12 * TAU) * 2.6, mill.z + Math.cos(i / 12 * TAU) * 2.6));
    const millFrame = new THREE.Group(); millFrame.position.set(mill.x, millY, mill.z); millFrame.rotation.y = mill.yaw;
    millFrame.scale.y = Math.min(1, (heightAt(mill.x, mill.z) + mill.height - millY) / 12);
    millFrame.add(place(bound.windmill_body, 0, 0, 0));
    const rotor = bound.windmill_sails.clone(true); rotor.name = 'windward-mill-authored-rotating-sails';
    rotor.position.set(0, 7.82, 2.108); rotor.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    millFrame.add(rotor); group.add(millFrame);
    const hay = propSites.find(site => site.poiId === 'windward-farm' && site.radius === 1.9);
    if (hay) addHayStack(group, bound.hay_bale, hay);
    group.add(buildWindwardFarmTerrain(materials.get('ground_earth'), fields));
    const wind = { value: 0 }, detail = [];
    for (const crop of ['crop_wheat', 'crop_leafy']) detail.push(...batches(bound[crop], crops.filter(point => point.crop === crop), group, { kind: 'crops', wind }));
    const fencePoints = fences.map(point => {
      const c = Math.cos(point.yaw), s = Math.sin(point.yaw);
      const a = renderedHeightAt(point.x - c, point.z + s), b = renderedHeightAt(point.x + c, point.z - s);
      return { ...point, y: (a + b) / 2, slope: (b - a) / 2 };
    });
    detail.push(...batches(bound.fence_section, fencePoints, group, { kind: 'fences' }));
    const grass = [], ferns = [], scatter = [], random = seededRandom(693201);
    const fieldClear = (x, z) => fields.every(field => Math.abs(x - field.x) > (field.rows - 1) * field.rowSpacing / 2 + .85 || Math.abs(z - field.z) > (field.columns - 1) * field.spacing / 2 + .8);
    for (let i = 0; i < 1700; i++) {
      const x = -68 + random() * 48, z = -77 + random() * 47;
      if (random() > windwardFarmWeight(x, z) * (1 - oldWatchWeight(x, z)) || !farmPlantClearance(x, z, propSites) || !fieldClear(x, z)) continue;
      if (fences.some(fence => Math.hypot(x - fence.x, z - fence.z) < 1.2)) continue;
      const patch = Math.sin(x * .51 + z * .21) + Math.sin(z * .59 - x * .13);
      if (patch < -.4) continue;
      const fern = x < -47 && patch > .8 && ferns.length < 24 && random() < .2;
      if (fern || grass.length < 320) (fern ? ferns : grass).push({ x, z, yaw: random() * TAU, scale: fern ? .65 + random() * .35 : .46 + random() * .65 });
      if (scatter.length < 30 && random() < .12) scatter.push({ x, z, yaw: random() * TAU, scale: [.16 + random() * .23, .04, .14 + random() * .2] });
    }
    detail.push(...batches(library.grass_clump, grass, group, { kind: 'grass', wind, tint: new THREE.Color(1.15, 1.08, .77) }));
    detail.push(...batches(library.fern_clump, ferns, group, { kind: 'grass', wind }));
    const stones = pathStones(propSites);
    detail.push(...batches(library.rock_a, stones, group, { kind: 'stones', tint: new THREE.Color(1.9, 1.9, 1.9) }));
    detail.push(...batches(library.rock_b, scatter, group, { kind: 'stones', tint: new THREE.Color(1.3, 1.25, 1.12) }));
    return { group, walls, roof, rotor, detail, wind, ownedRoots: [group, boundLibrary], counts: { prefabs: WINDWARD_FARM_PREFABS.length, wheat: crops.filter(point => point.crop === 'crop_wheat').length, vegetables: crops.filter(point => point.crop === 'crop_leafy').length, fields: fields.length, grass: grass.length, ferns: ferns.length, fences: fences.length, flagstones: stones.length, scatteredStones: scatter.length, detailMeshes: detail.length, cellSize: CELL } };
  } catch (error) { disposeOwnedResources([group, boundLibrary], borrowed); throw error; }
}

export function createWindwardFarm({ scene, settlements, assets = null, legacyVegetation = null, load } = {}) {
  const cache = assets ?? createEnvironmentAssets(load ? { load } : {}), ownsCache = !assets;
  const leases = [cache.acquire(SHARED_URL), cache.acquire(FARM_URL)];
  let disposed = false, kit = null, sources = [], status = 'loading', error = null;
  const release = () => { for (const lease of leases) lease.release(); if (ownsCache) cache.dispose(); };
  const restoreFallback = () => {
    try { settlements.setWindwardFarmKit(null); }
    catch (failure) { error = [error, 'Fallback restore: ' + String(failure?.message ?? failure)].filter(Boolean).join('; '); }
    if (legacyVegetation) legacyVegetation.visible = true;
  };
  const ready = Promise.all(leases.map(lease => lease.ready)).then(([shared, farm]) => {
    if (disposed) return false;
    sources = [farm.scene, shared.scene];
    kit = buildWindwardFarmKit(farm, shared, { propSites: settlements.group.userData.propSites, fenceSites: settlements.group.userData.farmFenceSites });
    scene.add(kit.group); settlements.setWindwardFarmKit(kit);
    if (legacyVegetation) legacyVegetation.visible = false;
    status = 'ready'; return true;
  }).catch(failure => {
    error = String(failure?.message ?? failure);
    restoreFallback();
    if (kit) { kit.group.removeFromParent(); disposeOwnedResources(kit.ownedRoots, sources); }
    kit = null; sources = []; release();
    if (!disposed) status = 'fallback';
    return false;
  });
  return { ready, isReady: () => status === 'ready', animate(time, { player = null, lowQuality = false, reducedMotion = false } = {}) {
    if (!kit || disposed) return;
    kit.wind.value = reducedMotion ? 0 : time * 1.15;
    for (const mesh of kit.detail) {
      const { cellCenter: cell, detailKind: kind, fullCount } = mesh.userData;
      const distance = player ? Math.hypot(player.x - cell.x, player.z - cell.z) : Infinity;
      const limit = kind === 'crops' ? (lowQuality ? 105 : 150) : kind === 'fences' ? 210 : (lowQuality ? 65 : 105);
      mesh.visible = distance < limit;
      mesh.count = kind === 'grass' ? Math.max(1, Math.floor(fullCount * (lowQuality ? .42 : distance > 65 ? .65 : 1))) : fullCount;
    }
  }, getStats: () => ({ status, ready: status === 'ready', loading: status === 'loading', fallback: status !== 'ready', error, ...(kit?.counts ?? {}), visibleDetailMeshes: kit?.detail.filter(mesh => mesh.visible).length ?? 0 }), dispose() {
    if (disposed) return;
    disposed = true; status = 'disposed'; restoreFallback();
    if (kit) { kit.group.removeFromParent(); disposeOwnedResources(kit.ownedRoots, sources); }
    kit = null; sources = []; release();
  } };
}
