import * as THREE from 'three';
import { heightAt } from '../shared/world.js';
import { coastRockDressing, ISLAND_LANDMARK_COUNTS } from '../shared/island.js';
import { createEnvironmentAssets, disposeOwnedResources } from './environment-assets.js';
import { renderedHeightAt } from './environment-geometry.js';
// The wild canopy dresses the island beyond each settlement in that
// settlement's own published palette, so the three resident dictionaries are
// read here rather than restated.
import { PALMHEART_MATERIAL_BINDINGS } from './palmheart-camp.js';
import { MOONWATCH_MATERIAL_BINDINGS } from './moonwatch.js';
import { CINDERWORKS_MATERIAL_BINDINGS } from './cinderworks.js';

// The three shrines the second island slice authors: the Palmheart gateway, the
// Moonbloom ring and its grove, and the Emberpeak caldera.
export const ISLAND_LANDMARK_PREFABS = ['palm_gate_pillar', 'palm_gate_lintel', 'moon_gate_ring', 'moon_gate_orb',
  'shrine_mushroom', 'shrine_moon_crystal', 'caldera_ridge_a', 'caldera_ridge_b', 'caldera_amber_crystal', 'ember_core', 'ember_core_rock'];
export const ISLAND_PREFABS = ['coast_palm_a', 'coast_palm_b', 'coast_rock_a', 'coast_rock_b', 'fishing_skiff_a', 'fishing_skiff_b', ...ISLAND_LANDMARK_PREFABS];
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
  // Palmheart's gateway is jungle stone: worn olive-jade blocks with pale
  // yellow-green carved edges, not another Old Watch grey-green wall.
  jungle_gate_stone: { source: 'watch_stone',   color: [2.70, 3.00, 1.90], normalScale: .75 },
  jungle_gate_edge:  { source: 'watch_stone',   color: [4.00, 4.20, 2.70], normalScale: .60 },
  // Moonbloom keeps the grove's silver-lilac language: dressed lunar stone, the
  // lilac caps on pale stems, and one cyan emissive slot for the ring inlay,
  // the orb and the crystal shards - an emissive binding, never a scene light.
  lunar_stone: { source: 'watch_stone',   color: [4.00, 3.60, 5.20], normalScale: .55 },
  lunar_cap:   { source: 'watch_stone',   color: [3.40, 2.60, 8.00], normalScale: .35 },
  lunar_stem:  { source: 'aged_timber',   color: [4.40, 4.50, 4.30], normalScale: .30 },
  lunar_glow:  { source: 'lantern_amber', color: [.80, 2.90, 12.0], emissive: [.16, .40, .44], emissiveIntensity: 1 },
  // Emberpeak is fractured charcoal basalt with iron-brown weathered shoulders
  // and amber seams. The dark stone comes from the binding, never from
  // near-black vertex colours, which the Cinderworks pass proved unreadable.
  caldera_basalt:    { source: 'watch_stone',   color: [1.85, 1.45, 1.40], normalScale: .90 },
  caldera_weathered: { source: 'watch_stone',   color: [2.70, 1.70, 1.10], normalScale: .80 },
  caldera_glow:      { source: 'lantern_amber', color: [1.15, .75, .50], emissive: [.55, .16, .025], emissiveIntensity: 1 },
});
const SHARED_URL = '/assets/old-watch/kit.glb', ISLAND_URL = '/assets/island/kit.glb';
const PALM_CELL = 64, LANDMARK_CELL = 64;
// The three roots that take over the original luminous draws never cast a
// shadow, so the caldera core and both crystal kinds keep that silhouette.
const LANDMARK_SHADOWLESS = new Set(['shrine_moon_crystal', 'caldera_amber_crystal', 'ember_core']);
// One uniform drives the canopy hook. Only the green and dead fronds move; the
// trunks, coconuts, rocks and moored skiffs keep a rigid silhouette.
const CANOPY_WIND = { key: 'island-canopy-wind-v1', hook: 'transformed.x += sin(islandWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * max(position.y - 3.0, 0.0) * .010;' };
const CANOPY_MATERIALS = new Set(['coast_frond', 'dead_frond']);
// The wild canopy keeps the skyline, so trees, palms, mushrooms and every
// collidable rock batch on the same 64 m cells as the coast and the shrines.
// Volcanic pebbles and crystal clusters use tighter 32 m cells.
const CANOPY_CELL = 64, ROCK_DETAIL_CELL = 32;
// The three resident kits the canopy borrows, alongside the shared library and
// the island kit the coast and shrines already lease.
export const ISLAND_CANOPY_KIT_URLS = Object.freeze({
  jungle: '/assets/palmheart-camp/kit.glb', moon: '/assets/moonwatch/kit.glb', volcano: '/assets/cinderworks/kit.glb',
});
const CANOPY_BINDINGS = Object.freeze({ jungle: PALMHEART_MATERIAL_BINDINGS, moon: MOONWATCH_MATERIAL_BINDINGS,
  volcano: CINDERWORKS_MATERIAL_BINDINGS, island: ISLAND_MATERIAL_BINDINGS });
// Every canopy root is a resident prefab cloned out of the kit that authored it,
// bound through that kit's own published dictionary: the jungle beyond Palmheart
// stays Palmheart's jungle, the moon beyond Moonwatch stays Moonwatch's.
// prop-12's boulder is the single alias - the coast's own coast_rock_b geometry
// with its coast_stone slot rebound to the Palmheart gateway's olive-jade, so
// the jungle rock never reads as pale surf limestone. `slots` renames a source
// slot onto the binding it is dressed with; it never edits a dictionary.
export const ISLAND_CANOPY_SOURCES = Object.freeze({
  jungle_tree_a: Object.freeze({ kit: 'jungle',  source: 'jungle_tree_a',    cell: CANOPY_CELL }),
  jungle_tree_b: Object.freeze({ kit: 'jungle',  source: 'jungle_tree_b',    cell: CANOPY_CELL }),
  jungle_palm:   Object.freeze({ kit: 'jungle',  source: 'jungle_palm',      cell: CANOPY_CELL }),
  jungle_rock:   Object.freeze({ kit: 'island',  source: 'coast_rock_b',     cell: CANOPY_CELL, slots: Object.freeze({ coast_stone: 'jungle_gate_stone' }) }),
  silver_tree_a: Object.freeze({ kit: 'moon',    source: 'silver_tree_a',    cell: CANOPY_CELL }),
  silver_tree_b: Object.freeze({ kit: 'moon',    source: 'silver_tree_b',    cell: CANOPY_CELL }),
  moon_mushroom: Object.freeze({ kit: 'moon',    source: 'moon_mushroom',    cell: CANOPY_CELL }),
  basalt_outcrop:   Object.freeze({ kit: 'volcano', source: 'basalt_outcrop',   cell: CANOPY_CELL }),
  basalt_boulder_a: Object.freeze({ kit: 'volcano', source: 'basalt_boulder_a', cell: ROCK_DETAIL_CELL }),
  basalt_boulder_b: Object.freeze({ kit: 'volcano', source: 'basalt_boulder_b', cell: ROCK_DETAIL_CELL }),
  ember_crystal:    Object.freeze({ kit: 'volcano', source: 'ember_crystal',    cell: ROCK_DETAIL_CELL }),
});
export const ISLAND_CANOPY_PREFABS = Object.freeze(Object.keys(ISLAND_CANOPY_SOURCES));
// Only the three leaf slots sway, on the one island uniform the coast fronds
// already drive. Bark, hardwood, stone, mushroom caps, moon glass and both
// crystal kinds keep a rigid silhouette.
const CANOPY_LEAF_MATERIALS = new Set(['broad_leaf', 'palm_frond', 'lavender_leaf']);

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
// One recipe binds every slot the island installs, coast, shrine or canopy: a
// clone of the shared Old Watch source, tinted by its own dictionary entry. A
// bound clone is never re-tinted, so no slot ever multiplies one palette over
// another, and no borrowed source material is touched.
function bindMaterial(source, binding, name) {
  const material = source.clone();
  material.name = name; material.vertexColors = true;
  if (binding.color) material.color.multiply(new THREE.Color(...binding.color));
  if (binding.normalScale != null) material.normalScale.setScalar(binding.normalScale);
  if (binding.doubleSided) material.side = THREE.DoubleSide;
  // The shrine glints and the moon glass are emissive clones of the shared
  // lantern material; the kit adds no scene light and never edits a borrowed
  // source.
  if (binding.emissive) material.emissive.setRGB(...binding.emissive);
  if (binding.emissiveIntensity != null) material.emissiveIntensity = binding.emissiveIntensity;
  return material;
}
// The one island wind uniform, hooked onto a leaf material. Reduced motion parks
// the uniform, so every swaying slot stops together.
function sway(material, wind) {
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = shader => {
    shader.uniforms.islandWind = wind;
    shader.vertexShader = 'uniform float islandWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n' + CANOPY_WIND.hook + '\n#endif');
  };
  material.customProgramCacheKey = () => CANOPY_WIND.key;
}
function place(prefab, x, y, z, yaw = 0) {
  const root = prefab.clone(true); root.position.set(x, y, z); root.rotation.y = yaw;
  root.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
  return root;
}
// A landmark stands on the exact transform buildScenery recorded for the draw it
// replaces: an analytic ground or pivot height, a full XYZ rotation and a scale
// that is non-uniform on the crescent towers.
function placeLandmark(prefab, site) {
  const root = prefab.clone(true), shadow = !LANDMARK_SHADOWLESS.has(prefab.name);
  root.position.set(site.x, site.y, site.z);
  root.rotation.set(site.rotation[0], site.rotation[1], site.rotation[2]);
  root.scale.set(site.scale[0], site.scale[1], site.scale[2]);
  root.traverse(object => { if (object.isMesh) { object.castShadow = shadow; object.receiveShadow = true; } });
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
    if (CANOPY_MATERIALS.has(source.material.name)) sway(frond, wind);
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

// Repeated landmarks - the eighteen crescent towers, the ring rocks, both
// crystal kinds and the grove mushrooms - collapse to one InstancedMesh per
// source primitive per 64 m cell. Unlike the palm canopy this helper takes the
// captured transform whole: it never resamples the terrain, never applies a
// uniform-only scale and never thins or distance-hides, because a missing
// gateway pillar or caldera tower would change the island's skyline.
function landmarkBatches(prefab, sites, parent) {
  if (!sites.length) return [];
  const cells = new Map(), result = [], transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
  const shadow = !LANDMARK_SHADOWLESS.has(prefab.name);
  for (const site of sites) {
    const key = Math.floor(site.x / LANDMARK_CELL) + ':' + Math.floor(site.z / LANDMARK_CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(site);
  }
  const template = prefab.clone(true); template.updateMatrixWorld(true);
  template.traverse(source => {
    if (!source.isMesh) return;
    for (const [key, cellSites] of cells) {
      // The bound material is shared, not cloned: no landmark sways, so a copy
      // would only add a resource to dispose.
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, cellSites.length);
      mesh.name = 'island-landmark-' + prefab.name + '-' + key;
      cellSites.forEach((site, index) => {
        transform.position.set(site.x, site.y, site.z);
        transform.rotation.set(site.rotation[0], site.rotation[1], site.rotation[2]);
        transform.scale.set(site.scale[0], site.scale[1], site.scale[2]); transform.updateMatrix();
        matrix.multiplyMatrices(transform.matrix, source.matrixWorld); mesh.setMatrixAt(index, matrix);
      });
      mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      mesh.userData.fullCount = cellSites.length; mesh.userData.landmarkPrefab = prefab.name;
      const [cx, cz] = key.split(':').map(Number); mesh.userData.cellCenter = { x: (cx + .5) * LANDMARK_CELL, z: (cz + .5) * LANDMARK_CELL };
      parent.add(mesh); result.push(mesh);
    }
  });
  return result;
}

// A canopy descriptor carries a complete transform - the terrain height the
// original draw stood on, all three rotations and a possibly non-uniform scale -
// so nothing here resamples the ground or drops an axis. A malformed descriptor
// fails the whole build rather than writing a NaN into an instance matrix, which
// would silently swallow a batch's bounding sphere.
function canopyTransform(site) {
  const { rotation, scale } = site;
  const complete = Array.isArray(rotation) && rotation.length === 3 && Array.isArray(scale) && scale.length === 3
    && [site.x, site.y, site.z, ...rotation, ...scale].every(Number.isFinite);
  if (!complete) throw new Error('Island canopy site is malformed: ' + site.id);
}
// Clones of the resident roots the descriptors name, rebound onto materials this
// kit owns. Geometry is borrowed from the kit that authored it and never
// disposed here; every material is a fresh clone of a shared Old Watch source,
// so no settlement's own bound clone is reused or mutated.
function canopyPrefabs(sites, kits, islandPrefabs, materials, library, wind) {
  const used = new Map();
  for (const site of sites) {
    const source = ISLAND_CANOPY_SOURCES[site.prefab];
    if (!source) throw new Error('Island canopy prefab is missing: ' + site.prefab);
    canopyTransform(site); used.set(site.prefab, source);
  }
  const bindings = new Map();
  // Keyed by kit as well as slot: prop-12's olive-jade boulder is an
  // independent clone, never the gateway's own bound jungle_gate_stone.
  const bind = (source, slot) => {
    const name = source.slots?.[slot] ?? slot, key = source.kit + ':' + name;
    if (bindings.has(key)) return bindings.get(key);
    const binding = CANOPY_BINDINGS[source.kit][name];
    if (!binding || !materials.has(binding.source)) throw new Error('Island canopy material binding is missing: ' + name);
    const material = bindMaterial(materials.get(binding.source), binding, name);
    if (CANOPY_LEAF_MATERIALS.has(name)) sway(material, wind);
    library.material.push(material); bindings.set(key, material); return material;
  };
  const bound = new Map();
  for (const [name, source] of used) {
    if (source.kit !== 'island' && !kits[source.kit]?.scene?.traverse) throw new Error('Island canopy kit is missing: ' + source.kit);
    const root = source.kit === 'island' ? islandPrefabs[source.source] : kits[source.kit].scene.getObjectByName(source.source);
    let meshes = 0;
    root?.traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count && object.material) meshes++; });
    if (!meshes) throw new Error('Island canopy kit is missing or empty: ' + name);
    const copy = root.clone(true); copy.name = name;
    copy.traverse(object => { if (object.isMesh) object.material = Array.isArray(object.material) ? object.material.map(material => bind(source, material.name)) : bind(source, object.material.name); });
    library.add(copy); bound.set(name, copy);
  }
  return bound;
}
// One InstancedMesh per source primitive per cell, taking the captured transform
// whole. The wild canopy carries the island's skyline from the ship, the glider
// and every jungle path, so like the shrines it is never thinned, never
// distance-hidden and never dropped at low quality.
function canopyBatches(prefab, name, sites, parent, cell) {
  if (!sites.length) return [];
  const cells = new Map(), result = [], transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
  for (const site of sites) {
    const key = Math.floor(site.x / cell) + ':' + Math.floor(site.z / cell);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(site);
  }
  const template = prefab.clone(true); template.updateMatrixWorld(true);
  template.traverse(source => {
    if (!source.isMesh) return;
    for (const [key, cellSites] of cells) {
      // The bound material is shared across every cell and every root that uses
      // the slot: the leaf hook already lives on it, so a copy would only add a
      // resource to dispose.
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, cellSites.length);
      mesh.name = 'island-canopy-' + name + '-' + key;
      cellSites.forEach((site, index) => {
        transform.position.set(site.x, site.y, site.z);
        transform.rotation.set(site.rotation[0], site.rotation[1], site.rotation[2]);
        transform.scale.set(site.scale[0], site.scale[1], site.scale[2]); transform.updateMatrix();
        matrix.multiplyMatrices(transform.matrix, source.matrixWorld); mesh.setMatrixAt(index, matrix);
      });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      mesh.userData.fullCount = cellSites.length; mesh.userData.canopyPrefab = name; mesh.userData.canopyCellSize = cell;
      const [cx, cz] = key.split(':').map(Number); mesh.userData.cellCenter = { x: (cx + .5) * cell, z: (cz + .5) * cell };
      parent.add(mesh); result.push(mesh);
    }
  });
  return result;
}

export function buildIslandKit(kit, shared, { palmSites = [], rockSites = [], skiffs = [], landmarkSites = [], canopySites = [], canopyKits = {} } = {}) {
  const prefabs = prefabRoots(kit.scene, ISLAND_PREFABS);
  const materials = sourceMaterials(shared.scene), slots = sourceMaterials(kit.scene);
  for (const name of slots.keys()) {
    const binding = ISLAND_MATERIAL_BINDINGS[name];
    if (!binding || !materials.has(binding.source)) throw new Error('Island material binding is missing: ' + name);
  }
  const group = new THREE.Group(); group.name = 'island-coast-environment'; group.material = [];
  // The three canopy kits are borrowed the same way the shared library is: this
  // kit reads their geometry and never disposes it.
  const borrowedCanopy = Object.values(canopyKits).map(asset => asset?.scene).filter(Boolean);
  const boundLibrary = new THREE.Group(), borrowed = [kit.scene, shared.scene, ...borrowedCanopy]; boundLibrary.material = [];
  try {
    const bindings = new Map();
    for (const name of slots.keys()) {
      const material = bindMaterial(materials.get(ISLAND_MATERIAL_BINDINGS[name].source), ISLAND_MATERIAL_BINDINGS[name], name);
      boundLibrary.material.push(material); bindings.set(name, material);
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
    // The three shrines stand on the transforms buildScenery recorded while it
    // drew the originals. A repeated root is instanced per cell; the four
    // one-offs - the carved lintel, the moon gate and its orb, and the magma
    // core - are shared-material clones.
    const byPrefab = new Map();
    for (const site of landmarkSites) {
      if (!bound[site.prefab]) throw new Error('Island landmark prefab is missing: ' + site.prefab);
      if (!byPrefab.has(site.prefab)) byPrefab.set(site.prefab, []);
      byPrefab.get(site.prefab).push(site);
    }
    const landmarkMeshes = [];
    for (const name of ISLAND_LANDMARK_PREFABS) {
      const sites = byPrefab.get(name) ?? [];
      if (sites.length > 1) { landmarkMeshes.push(...landmarkBatches(bound[name], sites, group)); continue; }
      for (const site of sites) {
        const root = placeLandmark(bound[name], site); root.name = 'island-landmark-' + site.id; group.add(root);
        root.traverse(object => { if (object.isMesh) landmarkMeshes.push(object); });
      }
    }
    const landmarkCounts = Object.fromEntries(Object.keys(ISLAND_LANDMARK_COUNTS)
      .map(kind => [kind, landmarkSites.filter(site => site.kind === kind).length]));
    // The wild canopy the third slice adds: the jungle, moon and volcanic
    // scenery beyond the three settlements, every root a resident prefab on the
    // transform buildScenery recorded for the original draw it replaces. A build
    // with no canopy sites - a focused coast or shrine build - stages nothing
    // here and reports the coast counts it always did.
    const wildCanopy = [], canopyCounts = {};
    if (canopySites.length) {
      const canopyBound = canopyPrefabs(canopySites, canopyKits, prefabs, materials, boundLibrary, wind);
      const byCanopyPrefab = new Map();
      for (const site of canopySites) {
        if (!byCanopyPrefab.has(site.prefab)) byCanopyPrefab.set(site.prefab, []);
        byCanopyPrefab.get(site.prefab).push(site);
        canopyCounts[site.kind] = (canopyCounts[site.kind] ?? 0) + 1;
      }
      for (const name of ISLAND_CANOPY_PREFABS) {
        const sites = byCanopyPrefab.get(name);
        if (sites?.length) wildCanopy.push(...canopyBatches(canopyBound.get(name), name, sites, group, ISLAND_CANOPY_SOURCES[name].cell));
      }
    }
    return { group, wind, detail: [], canopy, wildCanopy, skiffs: authored, landmarkMeshes, ownedRoots: [group, boundLibrary, ...authored],
      counts: { prefabs: ISLAND_PREFABS.length, palms: palmSites.length, collidablePalms: palmSites.filter(site => site.id).length,
        rocks: rocks.length, skiffs: authored.length, canopyMeshes: canopy.length, cellSize: PALM_CELL,
        landmarks: landmarkSites.length, landmarkMeshes: landmarkMeshes.length, landmarkCounts, landmarkCellSize: LANDMARK_CELL,
        ...(canopySites.length ? { canopyPlacements: canopySites.length, canopyCounts, wildCanopyMeshes: wildCanopy.length,
          canopyCellSize: CANOPY_CELL, rockDetailCellSize: ROCK_DETAIL_CELL } : {}) } };
  } catch (error) { disposeOwnedResources([group, boundLibrary], borrowed); throw error; }
}

export function createIsland({ scene, settlements, assets = null, legacyScenery = null, landmarkFallback = null, canopyFallback = null,
  palmSites = [], rockSites = [], landmarkSites = [], canopySites = [], load } = {}) {
  const cache = assets ?? createEnvironmentAssets(load ? { load } : {}), ownsCache = !assets;
  // The canopy borrows Palmheart's, Moonwatch's and the Cinderworks' kits from
  // the same environment cache the settlements themselves lease, so the island
  // downloads no new payload. A build with no canopy sites - a focused coast or
  // shrine controller - still leases exactly the shared library and the island
  // kit, in that order.
  const canopyKeys = canopySites.length ? Object.keys(ISLAND_CANOPY_KIT_URLS) : [];
  const leases = [cache.acquire(SHARED_URL), cache.acquire(ISLAND_URL), ...canopyKeys.map(key => cache.acquire(ISLAND_CANOPY_KIT_URLS[key]))];
  let disposed = false, kit = null, sources = [], status = 'loading', error = null;
  const release = () => { for (const lease of leases) lease.release(); if (ownsCache) cache.dispose(); };
  // All three original batches - the coast strand, the shrine solid/glow pair
  // and the wild canopy - come back together, whatever failed.
  const restoreFallback = () => {
    try { settlements.setIslandKit(null); }
    catch (failure) { error = [error, 'Fallback restore: ' + String(failure?.message ?? failure)].filter(Boolean).join('; '); }
    if (legacyScenery) legacyScenery.visible = true;
    if (landmarkFallback) landmarkFallback.visible = true;
    if (canopyFallback) canopyFallback.visible = true;
  };
  const ready = Promise.all(leases.map(lease => lease.ready)).then(([shared, island, ...residents]) => {
    if (disposed) return false;
    const canopyKits = Object.fromEntries(canopyKeys.map((key, index) => [key, residents[index]]));
    sources = [island.scene, shared.scene, ...residents.map(asset => asset?.scene).filter(Boolean)];
    kit = buildIslandKit(island, shared, { palmSites, rockSites, landmarkSites, canopySites, canopyKits, skiffs: settlements.group.userData.skiffs ?? [] });
    // Nothing is hidden until every coast palm, surf rock, skiff, shrine
    // landmark and canopy batch is installed and the settlement has taken the
    // kit: a kit that fails anywhere leaves all three originals standing.
    scene.add(kit.group); settlements.setIslandKit(kit);
    if (legacyScenery) legacyScenery.visible = false;
    if (landmarkFallback) landmarkFallback.visible = false;
    if (canopyFallback) canopyFallback.visible = false;
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
