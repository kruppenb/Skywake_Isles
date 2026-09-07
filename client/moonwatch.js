import * as THREE from 'three';
import { heightAt, seededRandom } from '../shared/world.js';
import { MOONWATCH_DOME, MOONWATCH_CANOPY_OBSTACLES, MOONWATCH_ROCK_OBSTACLES, moonwatchWeight, moonwatchPathDistance, moonwatchPlantClearance, moonwatchWorkSites } from '../shared/moonwatch.js';
import { createEnvironmentAssets, disposeOwnedResources } from './environment-assets.js';
import { renderedHeightAt, TERRAIN_GRID_STEP, TERRAIN_GRID_HALF } from './environment-geometry.js';

export const MOONWATCH_PREFABS = [
  'moonwatch_observatory', 'star_telescope', 'star_table', 'chart_crate', 'moon_lantern', 'armillary_sphere', 'scholar_bench',
  'silver_tree_a', 'silver_tree_b', 'moon_mushroom', 'moon_crystal', 'moon_boulder', 'moonbell_clump',
];
export const MOONWATCH_MATERIAL_BINDINGS = Object.freeze({
  recess_shadow: { source: 'recess_shadow' },
  moon_ashlar: { source: 'watch_stone', color: [2.30, 2.25, 2.45], normalScale: .70 },
  silver_stave: { source: 'aged_timber', color: [4.40, 5.60, 9.20], normalScale: .35 },
  pale_frame: { source: 'aged_timber', color: [5.60, 5.50, 5.40], normalScale: .30 },
  verdigris_bronze: { source: 'forged_iron', color: [1.90, 3.40, 3.00] },
  bright_brass: { source: 'forged_iron', color: [7.50, 5.60, 2.60] },
  moon_glass: { source: 'lantern_amber', color: [.80, 2.90, 12.0], emissive: [.16, .40, .44], emissiveIntensity: 1.0, doubleSided: true },
  // The shared timber and foliage bases are warm and green (timber 104/93/74,
  // foliage 83/108/54 sRGB), so silver and lavender need blue far above red and
  // green well below it; the first pass (2.6/2.5/2.9 bark, 1.55/.95/1.85 leaves)
  // rendered brown trunks under dead olive canopies.
  silver_bark: { source: 'pine_bark', color: [3.90, 4.90, 8.60], normalScale: .70 },
  lavender_leaf: { source: 'needle_foliage', color: [6.50, 2.40, 20.0], normalScale: .50, doubleSided: true },
  mushroom_stem: { source: 'aged_timber', color: [4.40, 4.50, 4.30], normalScale: .30 },
  mushroom_cap: { source: 'watch_stone', color: [3.40, 2.60, 8.00], normalScale: .35 },
  moonbell: { source: 'watch_stone', color: [5.60, 4.60, 8.00], normalScale: .40, doubleSided: true },
});
const SHARED_URL = '/assets/old-watch/kit.glb', MOONWATCH_URL = '/assets/moonwatch/kit.glb';
const TAU = Math.PI * 2, CELL = 16, MUSHROOM_CELL = 32, TREE_CELL = 64, clamp = THREE.MathUtils.clamp;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
// One uniform drives both hooks. Only the lavender leaves, the moonbells and the
// shared ground plants move; bark, glass, bronze, ashlar and the mushroom caps
// keep a rigid silhouette.
const GROUND_WIND = { key: 'moonwatch-ground-wind-v1', hook: 'transformed.x += sin(moonwatchWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * pow(max(position.y, 0.0), 2.0) * .045;' };
const CANOPY_WIND = { key: 'moonwatch-canopy-wind-v1', hook: 'transformed.x += sin(moonwatchWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * max(position.y - 2.0, 0.0) * .012;' };
const CANOPY_MATERIALS = new Set(['lavender_leaf']);

function prefabRoots(scene, names) {
  return Object.fromEntries(names.map(name => {
    const root = scene.getObjectByName(name); let meshes = 0;
    root?.traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count && object.material) meshes++; });
    if (!meshes) throw new Error('Moonwatch kit is missing or empty: ' + name);
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
function insideDome(x, z, margin) {
  return Math.hypot(x - MOONWATCH_DOME.x, z - MOONWATCH_DOME.z) < MOONWATCH_DOME.radius + margin;
}
// The moss lies on the same alternating terrain triangles as the other overlays.
// Depth bias would pull the gravel over the star table and the door steps.
function overlay(material, name, positions, colors, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const moss = material.clone(); moss.vertexColors = true; moss.transparent = true; moss.depthWrite = false; moss.polygonOffset = false;
  const mesh = new THREE.Mesh(geometry, moss); mesh.name = name; mesh.receiveShadow = true; mesh.renderOrder = 2;
  return mesh;
}

// Silver-lilac moss mottled with pale mineral gravel, a swept gravel court under
// the star table and a pale trodden track along the trail and the door approach.
export function buildMoonwatchTerrain(material, sites = null) {
  const step = TERRAIN_GRID_STEP, origin = -TERRAIN_GRID_HALF;
  const minX = 72, minZ = 18, columns = 24, rows = 24;
  const positions = [], colors = [], uvs = [], indices = [];
  const moss = new THREE.Color('#7a72a2'), gravel = new THREE.Color('#b3adcc'), track = new THREE.Color('#cfc9de');
  for (let zi = 0; zi <= rows; zi++) for (let xi = 0; xi <= columns; xi++) {
    const x = minX + xi * step, z = minZ + zi * step;
    const weight = moonwatchWeight(x, z);
    const path = 1 - smooth((moonwatchPathDistance(x, z) - 1.5) / 2.6);
    const court = !sites ? 0 : smooth((6 - Math.hypot(x - sites.table.x, z - sites.table.z)) / 6);
    const mottling = clamp(.5 + Math.sin(x * .37 + z * .21) * .3 + Math.sin(z * .43 - x * .11) * .2, 0, 1);
    const color = moss.clone().lerp(gravel, mottling * .6).lerp(gravel, court * .7).lerp(track, path * .85).multiplyScalar(1.55 + path * .45);
    // Squaring the weight keeps the moss on the grounds and lets its edge feather
    // into the original lilac ground instead of ending in a visible disc.
    let alpha = weight * weight * (.40 + path * .35 + court * .2) * (.8 + mottling * .2);
    if (heightAt(x, z) < 1.7 || insideDome(x, z, .3) || xi === 0 || zi === 0 || xi === columns || zi === rows) alpha = 0;
    positions.push(x, renderedHeightAt(x, z) + .034, z); colors.push(color.r, color.g, color.b, alpha); uvs.push(x / 4, z / 4);
    if (xi < columns && zi < rows) {
      const n = zi * (columns + 1) + xi;
      const parity = ((x - origin) / step + (z - origin) / step) % 2;
      if (parity) indices.push(n, n + columns + 1, n + 1, n + 1, n + columns + 1, n + columns + 2);
      else indices.push(n, n + columns + 2, n + 1, n, n + columns + 1, n + columns + 2);
    }
  }
  return overlay(material, 'moonwatch-moss-and-gravel', positions, colors, uvs, indices);
}

// One InstancedMesh per source primitive per cell. Trees and mushrooms use larger
// cells, cast shadows and are never distance-hidden; ground detail stays
// shadowless and thins with distance.
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
        shader.uniforms.moonwatchWind = wind;
        shader.vertexShader = 'uniform float moonwatchWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n' + windHook + '\n#endif');
      };
      blade.customProgramCacheKey = () => windKey;
    }
    for (const [key, cellPoints] of cells) {
      const mesh = new THREE.InstancedMesh(source.geometry, blade, cellPoints.length);
      mesh.name = 'moonwatch-' + kind + '-' + prefab.name + '-' + key;
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

export function buildMoonwatchKit(kit, shared, { propSites = [] } = {}) {
  const prefabs = prefabRoots(kit.scene, MOONWATCH_PREFABS), library = prefabRoots(shared.scene, ['fern_clump', 'grass_clump']);
  const materials = sourceMaterials(shared.scene), slots = sourceMaterials(kit.scene);
  for (const name of slots.keys()) {
    const binding = MOONWATCH_MATERIAL_BINDINGS[name];
    if (!binding || !materials.has(binding.source)) throw new Error('Moonwatch material binding is missing: ' + name);
  }
  if (!materials.has('ground_earth')) throw new Error('Moonwatch shared ground_earth is missing');
  const sites = moonwatchWorkSites(propSites);
  const group = new THREE.Group(); group.name = 'moonwatch-silvered-environment'; group.material = [];
  const boundLibrary = new THREE.Group(), borrowed = [kit.scene, shared.scene]; boundLibrary.material = [];
  try {
    const bindings = new Map();
    for (const name of slots.keys()) {
      const binding = MOONWATCH_MATERIAL_BINDINGS[name], material = materials.get(binding.source).clone();
      boundLibrary.material.push(material); material.name = name; material.vertexColors = true;
      if (binding.color) material.color.multiply(new THREE.Color(...binding.color));
      if (binding.normalScale != null) material.normalScale.setScalar(binding.normalScale);
      if (binding.doubleSided) material.side = THREE.DoubleSide;
      // Moon glass is the kit's only light source: an emissive binding, never a
      // second scene light, which would change every island's shading.
      if (binding.emissive) material.emissive.setRGB(...binding.emissive);
      if (binding.emissiveIntensity != null) material.emissiveIntensity = binding.emissiveIntensity;
      bindings.set(name, material);
    }
    const bound = Object.fromEntries(Object.entries(prefabs).map(([name, prefab]) => {
      const copy = prefab.clone(true);
      copy.traverse(object => { if (object.isMesh) object.material = Array.isArray(object.material) ? object.material.map(material => bindings.get(material.name)) : bindings.get(object.material.name); });
      boundLibrary.add(copy); return [name, copy];
    }));
    const wind = { value: 0 };
    // The dome is not enterable: one authored shell over the original footprint.
    const observatory = footing(bound.moonwatch_observatory, MOONWATCH_DOME.x, MOONWATCH_DOME.z, MOONWATCH_DOME.yaw, MOONWATCH_DOME.radius);
    observatory.name = 'moonwatch-authored-observatory'; group.add(observatory);
    // Authored work sites take over the exact original positions and radii.
    const work = [['star_telescope', sites.telescope, -.75], ['star_table', sites.table, 0], ['chart_crate', sites.crate, .25], ['moon_lantern', sites.lantern, 0]];
    for (const [name, site, yaw] of work) {
      const root = footing(bound[name], site.x, site.z, yaw, site.radius);
      root.name = 'moonwatch-authored-' + name.replaceAll('_', '-'); group.add(root);
    }
    // The scholar's loose instruments stand around the star table (the telescope
    // corner is hemmed in by the guard ring and the door approach), never on the
    // trail, Lio's loop, a chest or an original work site.
    const loose = [
      { prefab: 'armillary_sphere', name: 'armillary-sphere', radius: .8, origin: sites.table, offsets: [[3.4, -1.2, .4], [-3.6, 1.8, .2], [2.8, 3.1, -.3]] },
      { prefab: 'scholar_bench', name: 'scholar-bench', radius: 1.1, origin: sites.table, offsets: [[-3.2, 1.6, .8], [-2.4, -2.8, .3], [3.2, 2.6, -.6]] },
    ];
    const reserved = [...propSites], extras = [];
    for (const item of loose) {
      const point = item.offsets.map(([dx, dz, yaw]) => ({ x: item.origin.x + dx, z: item.origin.z + dz, yaw }))
        .find(candidate => moonwatchPlantClearance(candidate.x, candidate.z, reserved, .1) && !insideDome(candidate.x, candidate.z, .9));
      if (!point) continue;
      const root = footing(bound[item.prefab], point.x, point.z, point.yaw, item.radius);
      root.name = 'moonwatch-' + item.name; group.add(root); extras.push(root);
      reserved.push({ x: point.x, z: point.z, radius: item.radius });
    }
    group.add(buildMoonwatchTerrain(materials.get('ground_earth'), sites));
    // The collidable boulder and silver tree keep their recorded radius and
    // height; only the silhouette is authored, so both carry a non-uniform scale.
    const boulders = MOONWATCH_ROCK_OBSTACLES.map(obstacle => {
      const root = place(bound.moon_boulder, obstacle.x, heightAt(obstacle.x, obstacle.z), obstacle.z, 0);
      root.scale.set(obstacle.radius / 2.2, obstacle.height / 4, obstacle.radius / 2.2);
      root.name = 'moonwatch-boulder-' + obstacle.id; group.add(root); return root;
    });
    const canopyTrees = MOONWATCH_CANOPY_OBSTACLES.map(obstacle => {
      const root = place(bound.silver_tree_b, obstacle.x, heightAt(obstacle.x, obstacle.z), obstacle.z);
      root.scale.set(obstacle.radius / 3.8, obstacle.height / 11, obstacle.radius / 3.8);
      root.name = 'moonwatch-canopy-' + obstacle.id; group.add(root); return root;
    });
    // Deterministic planting: never on the trail, the shrine ring, Lio's loop,
    // the guarded approach, a chest or an original work site.
    const random = seededRandom(733019), trees = [];
    for (let index = 0; index < 3600 && trees.length < 22; index++) {
      const x = 70 + random() * 54, z = 16 + random() * 54;
      if (random() > moonwatchWeight(x, z) || !moonwatchPlantClearance(x, z, reserved, 1.4)) continue;
      if (trees.some(tree => Math.hypot(x - tree.x, z - tree.z) < 4.5)) continue;
      trees.push({ prefab: trees.length % 2 ? 'silver_tree_b' : 'silver_tree_a', x, z, yaw: random() * TAU, scale: .8 + random() * .35 });
    }
    const mushrooms = [];
    for (let index = 0; index < 2200 && mushrooms.length < 24; index++) {
      const x = 70 + random() * 54, z = 16 + random() * 54;
      if (random() > moonwatchWeight(x, z) || !moonwatchPlantClearance(x, z, reserved, .6)) continue;
      if (insideDome(x, z, 5) || mushrooms.some(cap => Math.hypot(x - cap.x, z - cap.z) < 3.5)) continue;
      mushrooms.push({ x, z, yaw: random() * TAU, scale: .7 + random() * .8 });
    }
    // Moon crystals read as a find, so they stay apart from one another.
    const crystals = [];
    for (let index = 0; index < 1600 && crystals.length < 26; index++) {
      const x = 70 + random() * 54, z = 16 + random() * 54;
      if (random() > moonwatchWeight(x, z) || !moonwatchPlantClearance(x, z, reserved, .3)) continue;
      if (crystals.some(shard => Math.hypot(x - shard.x, z - shard.z) < 3)) continue;
      crystals.push({ x, z, yaw: random() * TAU, scale: .8 + random() * .5 });
    }
    const scatter = (target, attempts, padding, base, spread) => {
      const points = [];
      for (let index = 0; index < attempts && points.length < target; index++) {
        const x = 70 + random() * 54, z = 16 + random() * 54;
        if (random() > moonwatchWeight(x, z) || !moonwatchPlantClearance(x, z, reserved, padding)) continue;
        points.push({ x, z, yaw: random() * TAU, scale: base + random() * spread });
      }
      return points;
    };
    const moonbells = scatter(110, 1400, .15, .7, .5), ferns = scatter(90, 1200, .15, .7, .5), grass = scatter(90, 1200, .15, .55, .5);
    const canopy = [
      ...['silver_tree_a', 'silver_tree_b'].flatMap(name => batches(bound[name], trees.filter(tree => tree.prefab === name), group,
        { kind: 'tree', cell: TREE_CELL, castShadow: true, wind, windKey: CANOPY_WIND.key, windHook: CANOPY_WIND.hook, windMaterials: CANOPY_MATERIALS })),
      ...batches(bound.moon_mushroom, mushrooms, group, { kind: 'mushroom', cell: MUSHROOM_CELL, castShadow: true }),
    ];
    const detail = [
      ...batches(bound.moon_crystal, crystals, group, { kind: 'crystal' }),
      ...batches(bound.moonbell_clump, moonbells, group, { kind: 'moonbell', wind }),
      ...batches(library.fern_clump, ferns, group, { kind: 'fern', wind, tint: new THREE.Color(3.0, 1.4, 7.0) }),
      ...batches(library.grass_clump, grass, group, { kind: 'grass', wind, tint: new THREE.Color(3.2, 1.6, 7.5) }),
    ];
    return { group, wind, detail, canopy, ownedRoots: [group, boundLibrary],
      counts: { prefabs: MOONWATCH_PREFABS.length, workSites: work.length, extraProps: extras.length, canopyTrees: canopyTrees.length, boulders: boulders.length,
        trees: trees.length, mushrooms: mushrooms.length, crystals: crystals.length, moonbells: moonbells.length, ferns: ferns.length, grass: grass.length,
        detailMeshes: detail.length, cellSize: CELL } };
  } catch (error) { disposeOwnedResources([group, boundLibrary], borrowed); throw error; }
}

export function createMoonwatch({ scene, settlements, assets = null, legacyScenery = null, load } = {}) {
  const cache = assets ?? createEnvironmentAssets(load ? { load } : {}), ownsCache = !assets;
  const leases = [cache.acquire(SHARED_URL), cache.acquire(MOONWATCH_URL)];
  let disposed = false, kit = null, sources = [], status = 'loading', error = null;
  const release = () => { for (const lease of leases) lease.release(); if (ownsCache) cache.dispose(); };
  const restoreFallback = () => {
    try { settlements.setMoonwatchKit(null); }
    catch (failure) { error = [error, 'Fallback restore: ' + String(failure?.message ?? failure)].filter(Boolean).join('; '); }
    if (legacyScenery) legacyScenery.visible = true;
  };
  const ready = Promise.all(leases.map(lease => lease.ready)).then(([shared, moonwatch]) => {
    if (disposed) return false;
    sources = [moonwatch.scene, shared.scene];
    kit = buildMoonwatchKit(moonwatch, shared, { propSites: settlements.group.userData.propSites });
    scene.add(kit.group); settlements.setMoonwatchKit(kit);
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
