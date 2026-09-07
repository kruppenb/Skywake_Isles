import * as THREE from 'three';
import { heightAt, seededRandom } from '../shared/world.js';
import { buildingLocalPoint, buildingWorldPoint } from '../shared/exploration.js';
import { CINDER_FORGE, CINDERWORKS_ROCK_OBSTACLES, cinderworksWeight, cinderworksPathDistance, cinderworksPlantClearance, cinderworksWorkSites } from '../shared/cinderworks.js';
import { createEnvironmentAssets, disposeOwnedResources } from './environment-assets.js';
import { renderedHeightAt, TERRAIN_GRID_STEP, TERRAIN_GRID_HALF } from './environment-geometry.js';

const BUILDING_PARTS = ['base', 'wall_east', 'wall_west', 'wall_front', 'wall_back', 'roof'];
export const CINDERWORKS_PREFABS = [
  ...BUILDING_PARTS.map(part => 'cinder_forge_' + part),
  'forge_sign', 'forge_anvil', 'ore_pile', 'forge_lantern', 'coal_bin', 'slag_heap', 'basalt_outcrop', 'basalt_boulder_a', 'basalt_boulder_b', 'cinder_clump', 'ember_crystal',
];
export const CINDERWORKS_MATERIAL_BINDINGS = Object.freeze({
  watch_stone: { source: 'watch_stone' }, aged_timber: { source: 'aged_timber' },
  forged_iron: { source: 'forged_iron' }, recess_shadow: { source: 'recess_shadow' }, lantern_amber: { source: 'lantern_amber' },
  basalt_block: { source: 'watch_stone', color: [1.75, 1.45, 1.38], normalScale: 1.0 },
  soot_stone: { source: 'watch_stone', color: [1.0, .88, .85], normalScale: .8 },
  charred_board: { source: 'aged_timber', color: [1.15, .90, .72], normalScale: .45 },
  rust_sheet: { source: 'ground_earth', color: [2.3, 1.35, .95], normalScale: .40 },
  ore_rock: { source: 'watch_stone', color: [1.45, .95, .62], normalScale: .9 },
  scoria: { source: 'watch_stone', color: [1.05, .70, .62], normalScale: 1.0 },
  coal: { source: 'watch_stone', color: [.30, .29, .29], normalScale: .6 },
  sign_plate: { source: 'forged_iron', color: [1.0, 1.0, 1.0] },
  ember_crystal: { source: 'lantern_amber', color: [1.15, .75, .50] },
});
const SHARED_URL = '/assets/old-watch/kit.glb', FORGE_URL = '/assets/cinderworks/kit.glb';
const TAU = Math.PI * 2, CELL = 16, BOULDER_CELL = 32, clamp = THREE.MathUtils.clamp;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
// One uniform drives both hooks. Only the hung sign and the scorched grass move;
// basalt, iron and the heaped scoria keep a rigid silhouette.
const GROUND_WIND = 'transformed.x += sin(cinderworksWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * pow(max(position.y, 0.0), 2.0) * .045;';

function prefabRoots(scene, names) {
  return Object.fromEntries(names.map(name => {
    const root = scene.getObjectByName(name); let meshes = 0;
    root?.traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count && object.material) meshes++; });
    if (!meshes) throw new Error('Cinderworks kit is missing or empty: ' + name);
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
function insideForge(x, z, margin) {
  const local = buildingLocalPoint(CINDER_FORGE, x, z);
  return Math.abs(local.x) < CINDER_FORGE.width / 2 + margin && Math.abs(local.z) < CINDER_FORGE.depth / 2 + margin;
}
// The ash lies on the same alternating terrain triangles as the other overlays.
// Depth bias would pull the cinder over the anvil and the flagstone threshold.
function overlay(material, name, positions, colors, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const ash = material.clone(); ash.vertexColors = true; ash.transparent = true; ash.depthWrite = false; ash.polygonOffset = false;
  const mesh = new THREE.Mesh(geometry, ash); mesh.name = name; mesh.receiveShadow = true; mesh.renderOrder = 2;
  return mesh;
}

// Black ash mottled with coarser cinder, soot rings burnt in at the anvil and
// the ore pile, and scorched orange-brown tracks where the yard is walked.
export function buildCinderworksTerrain(material, sites = null) {
  const step = TERRAIN_GRID_STEP, origin = -TERRAIN_GRID_HALF;
  const minX = 54, minZ = -66, columns = 23, rows = 23;
  const positions = [], colors = [], uvs = [], indices = [];
  const ash = new THREE.Color('#5f5752'), cinder = new THREE.Color('#6f4d43'), soot = new THREE.Color('#3a3431'), track = new THREE.Color('#a57a55');
  for (let zi = 0; zi <= rows; zi++) for (let xi = 0; xi <= columns; xi++) {
    const x = minX + xi * step, z = minZ + zi * step;
    const weight = cinderworksWeight(x, z);
    const path = 1 - smooth((cinderworksPathDistance(x, z) - 1.5) / 2.6);
    const rings = !sites ? 0 : Math.max(smooth((5 - Math.hypot(x - sites.anvil.x, z - sites.anvil.z)) / 3),
      smooth((5 - Math.hypot(x - sites.ore.x, z - sites.ore.z)) / 3));
    const mottling = clamp(.5 + Math.sin(x * .37 + z * .21) * .3 + Math.sin(z * .43 - x * .11) * .2, 0, 1);
    const color = ash.clone().lerp(cinder, mottling * .6).lerp(soot, rings * .7).lerp(track, path * .85).multiplyScalar(1.55 + path * .45);
    // Squaring the weight keeps the ash concentrated on the yard and lets the
    // apron feather into the original tan instead of ending in a visible disc.
    let alpha = weight * weight * (.42 + path * .32 + rings * .26) * (.8 + mottling * .2);
    if (heightAt(x, z) < 1.7 || insideForge(x, z, .3) || xi === 0 || zi === 0 || xi === columns || zi === rows) alpha = 0;
    positions.push(x, renderedHeightAt(x, z) + .034, z); colors.push(color.r, color.g, color.b, alpha); uvs.push(x / 4, z / 4);
    if (xi < columns && zi < rows) {
      const n = zi * (columns + 1) + xi;
      const parity = ((x - origin) / step + (z - origin) / step) % 2;
      if (parity) indices.push(n, n + columns + 1, n + 1, n + 1, n + columns + 1, n + columns + 2);
      else indices.push(n, n + columns + 2, n + 1, n, n + columns + 1, n + columns + 2);
    }
  }
  return overlay(material, 'cinderworks-ash-and-cinder', positions, colors, uvs, indices);
}

// The hanging hammer sign swings from its hinge; one clone serves the whole
// plate so the bracket and the chains share a single program.
function swingSign(root, wind, owner) {
  let plate = null;
  root.traverse(object => {
    if (!object.isMesh || object.material.name !== 'sign_plate') return;
    if (!plate) {
      plate = object.material.clone(); owner.material.push(plate);
      plate.onBeforeCompile = shader => {
        shader.uniforms.cinderworksWind = wind;
        shader.vertexShader = 'uniform float cinderworksWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(cinderworksWind * 1.1 + .7) * max(-position.y, 0.0) * .085;');
      };
      plate.customProgramCacheKey = () => 'cinderworks-sign-swing-v1';
    }
    object.material = plate;
  });
}

// One InstancedMesh per source primitive per cell. Boulders use larger cells and
// cast shadows; ground detail stays shadowless and thins with distance.
function batches(prefab, points, parent, { kind = 'cinder', cell = CELL, castShadow = false, wind = null, tint = null } = {}) {
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
    if (wind) {
      blade.side = THREE.DoubleSide;
      blade.onBeforeCompile = shader => {
        shader.uniforms.cinderworksWind = wind;
        shader.vertexShader = 'uniform float cinderworksWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n' + GROUND_WIND + '\n#endif');
      };
      blade.customProgramCacheKey = () => 'cinderworks-ground-wind-v1';
    }
    for (const [key, cellPoints] of cells) {
      const mesh = new THREE.InstancedMesh(source.geometry, blade, cellPoints.length);
      mesh.name = 'cinderworks-' + kind + '-' + prefab.name + '-' + key;
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

export function buildCinderworksKit(forge, shared, { propSites = [] } = {}) {
  const prefabs = prefabRoots(forge.scene, CINDERWORKS_PREFABS), library = prefabRoots(shared.scene, ['grass_clump']);
  const materials = sourceMaterials(shared.scene), slots = sourceMaterials(forge.scene);
  for (const name of slots.keys()) {
    const binding = CINDERWORKS_MATERIAL_BINDINGS[name];
    if (!binding || !materials.has(binding.source)) throw new Error('Cinderworks material binding is missing: ' + name);
  }
  if (!materials.has('ground_earth')) throw new Error('Cinderworks shared ground_earth is missing');
  const sites = cinderworksWorkSites(propSites);
  const group = new THREE.Group(); group.name = 'cinderworks-scorched-environment'; group.material = [];
  const boundLibrary = new THREE.Group(), borrowed = [forge.scene, shared.scene]; boundLibrary.material = [];
  try {
    const bindings = new Map();
    for (const name of slots.keys()) {
      const binding = CINDERWORKS_MATERIAL_BINDINGS[name], material = materials.get(binding.source).clone();
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
    const normals = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    const floor = heightAt(CINDER_FORGE.x, CINDER_FORGE.z);
    group.add(place(bound.cinder_forge_base, CINDER_FORGE.x, floor, CINDER_FORGE.z, CINDER_FORGE.yaw));
    const walls = new THREE.Group(); walls.name = 'cinder-forge-authored-cutaway-walls';
    ['east', 'west', 'front', 'back'].forEach((face, index) => {
      const wall = place(bound['cinder_forge_wall_' + face], CINDER_FORGE.x, floor, CINDER_FORGE.z, CINDER_FORGE.yaw); wall.userData.normal = normals[index]; walls.add(wall);
    });
    const roof = place(bound.cinder_forge_roof, CINDER_FORGE.x, floor, CINDER_FORGE.z, CINDER_FORGE.yaw); roof.name = 'cinder-forge-authored-cutaway-roof';
    group.add(walls, roof);
    const buildings = { 'cinder-forge': { walls, roof } };
    const wind = { value: 0 };
    // The bracket belongs to the front wall; the plate hangs from its hinge just
    // clear of the face so the swing never clips the charred boards.
    const hinge = buildingWorldPoint(CINDER_FORGE, 1.55, CINDER_FORGE.depth / 2 + .09);
    const sign = place(bound.forge_sign, hinge.x, floor + 3.85, hinge.z, CINDER_FORGE.yaw);
    sign.name = 'cinder-forge-sign'; swingSign(sign, wind, boundLibrary); group.add(sign);
    // Authored work sites take over the exact original positions and radii.
    const work = [['forge_anvil', sites.anvil, .45], ['ore_pile', sites.ore, 0], ['forge_lantern', sites.lantern, 0]];
    for (const [name, site, yaw] of work) {
      const root = footing(bound[name], site.x, site.z, yaw, site.radius);
      root.name = 'cinderworks-authored-' + name.replaceAll('_', '-'); group.add(root);
    }
    // Loose fuel and waste sit beside the west wall and downwind of the ore
    // pile, never on the trail, Sula's loop, a chest or an original work site.
    const loose = [
      { prefab: 'coal_bin', name: 'coal-bin', radius: 1.0, origin: buildingWorldPoint(CINDER_FORGE, -CINDER_FORGE.width / 2 - 1.6, -1.2), offsets: [[0, 0, .3], [-1.2, 1.0, .2], [.6, -2.2, -.4]] },
      { prefab: 'slag_heap', name: 'slag-heap', radius: 1.3, origin: sites.ore, offsets: [[3.2, -1.4, 0], [-3.1, -2.4, 0], [2.6, 2.8, 0]] },
    ];
    const reserved = [...propSites], extras = [];
    for (const item of loose) {
      const point = item.offsets.map(([dx, dz, yaw]) => ({ x: item.origin.x + dx, z: item.origin.z + dz, yaw }))
        .find(candidate => cinderworksPlantClearance(candidate.x, candidate.z, reserved, .1) && !insideForge(candidate.x, candidate.z, .9));
      if (!point) continue;
      const root = footing(bound[item.prefab], point.x, point.z, point.yaw, item.radius);
      root.name = 'cinderworks-' + item.name; group.add(root); extras.push(root);
      reserved.push({ x: point.x, z: point.z, radius: item.radius });
    }
    group.add(buildCinderworksTerrain(materials.get('ground_earth'), sites));
    // The collidable rock keeps its recorded radius and height; only the
    // silhouette is authored, so the columns carry a non-uniform scale.
    const outcrops = CINDERWORKS_ROCK_OBSTACLES.map(obstacle => {
      const root = place(bound.basalt_outcrop, obstacle.x, heightAt(obstacle.x, obstacle.z), obstacle.z, 0);
      root.scale.set(obstacle.radius / 3, obstacle.height / 8, obstacle.radius / 3);
      root.name = 'cinderworks-outcrop-' + obstacle.id; group.add(root); return root;
    });
    // Deterministic scatter: never on the trail, the shrine ring, Sula's loop,
    // the guarded approach, a chest or an original work site.
    const random = seededRandom(640311), boulders = [];
    for (let index = 0; index < 1600 && boulders.length < 16; index++) {
      const x = 52 + random() * 52, z = -70 + random() * 52;
      if (random() > cinderworksWeight(x, z) || !cinderworksPlantClearance(x, z, reserved, 1.2)) continue;
      if (boulders.some(boulder => Math.hypot(x - boulder.x, z - boulder.z) < 3.5)) continue;
      boulders.push({ prefab: boulders.length % 2 ? 'basalt_boulder_b' : 'basalt_boulder_a', x, z, yaw: random() * TAU, scale: .8 + random() * .45 });
    }
    const boulderMeshes = ['basalt_boulder_a', 'basalt_boulder_b'].flatMap(name => batches(bound[name], boulders.filter(boulder => boulder.prefab === name), group,
      { kind: 'boulder', cell: BOULDER_CELL, castShadow: true }));
    const scatter = (target, attempts, padding, base, spread) => {
      const points = [];
      for (let index = 0; index < attempts && points.length < target; index++) {
        const x = 52 + random() * 52, z = -70 + random() * 52;
        if (random() > cinderworksWeight(x, z) || !cinderworksPlantClearance(x, z, reserved, padding)) continue;
        points.push({ x, z, yaw: random() * TAU, scale: base + random() * spread });
      }
      return points;
    };
    const cinder = scatter(120, 1200, .15, .7, .5), crystals = [];
    // Ember crystals read as a find, so they stay apart and off the forge apron.
    for (let index = 0; index < 600 && crystals.length < 22; index++) {
      const x = 52 + random() * 52, z = -70 + random() * 52;
      if (random() > cinderworksWeight(x, z) || !cinderworksPlantClearance(x, z, reserved, .3)) continue;
      if (Math.hypot(x - CINDER_FORGE.x, z - CINDER_FORGE.z) < 7 || crystals.some(shard => Math.hypot(x - shard.x, z - shard.z) < 3)) continue;
      crystals.push({ x, z, yaw: random() * TAU, scale: .8 + random() * .5 });
    }
    const grass = scatter(90, 900, .15, .55, .5);
    const detail = [
      ...batches(bound.cinder_clump, cinder, group, { kind: 'cinder' }),
      ...batches(bound.ember_crystal, crystals, group, { kind: 'crystal' }),
      ...batches(library.grass_clump, grass, group, { kind: 'grass', wind, tint: new THREE.Color(1.45, 1.15, .62) }),
    ];
    return { group, buildings, wind, detail, boulders: boulderMeshes, ownedRoots: [group, boundLibrary],
      counts: { prefabs: CINDERWORKS_PREFABS.length, buildings: 1, workSites: work.length, extraProps: extras.length, outcrops: outcrops.length,
        boulders: boulders.length, cinderClumps: cinder.length, crystals: crystals.length, grass: grass.length, detailMeshes: detail.length, cellSize: CELL } };
  } catch (error) { disposeOwnedResources([group, boundLibrary], borrowed); throw error; }
}

export function createCinderworks({ scene, settlements, assets = null, legacyScenery = null, load } = {}) {
  const cache = assets ?? createEnvironmentAssets(load ? { load } : {}), ownsCache = !assets;
  const leases = [cache.acquire(SHARED_URL), cache.acquire(FORGE_URL)];
  let disposed = false, kit = null, sources = [], status = 'loading', error = null;
  const release = () => { for (const lease of leases) lease.release(); if (ownsCache) cache.dispose(); };
  const restoreFallback = () => {
    try { settlements.setCinderworksKit(null); }
    catch (failure) { error = [error, 'Fallback restore: ' + String(failure?.message ?? failure)].filter(Boolean).join('; '); }
    if (legacyScenery) legacyScenery.visible = true;
  };
  const ready = Promise.all(leases.map(lease => lease.ready)).then(([shared, forge]) => {
    if (disposed) return false;
    sources = [forge.scene, shared.scene];
    kit = buildCinderworksKit(forge, shared, { propSites: settlements.group.userData.propSites });
    scene.add(kit.group); settlements.setCinderworksKit(kit);
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
