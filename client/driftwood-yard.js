import * as THREE from 'three';
import { heightAt, seededRandom, SPAWN } from '../shared/world.js';
import { buildingLocalPoint, buildingWorldPoint } from '../shared/exploration.js';
import { DRIFTWOOD_BUILDINGS, SUNWAKE_LANDING_CRATES, SUNWAKE_PIER, SUNWAKE_BANNER, driftwoodYardWeight, sunwakeStrandWeight, driftwoodWeight,
  driftwoodPathDistance, sunwakeStrandPathDistance, driftwoodPlantClearance, driftwoodWorkSites } from '../shared/driftwood-yard.js';
import { createEnvironmentAssets, disposeOwnedResources } from './environment-assets.js';
import { renderedHeightAt, TERRAIN_GRID_STEP, TERRAIN_GRID_HALF } from './environment-geometry.js';

export const DRIFTWOOD_BUILDING_PREFIXES = Object.freeze({ 'timber-shed': 'timber_shed', 'shipwrights-cottage': 'shipwright_cottage' });
const BUILDING_PARTS = ['base', 'wall_east', 'wall_west', 'wall_front', 'wall_back', 'roof'];
export const DRIFTWOOD_YARD_PREFABS = [
  ...Object.values(DRIFTWOOD_BUILDING_PREFIXES).flatMap(prefix => BUILDING_PARTS.map(part => prefix + '_' + part)),
  'hull_frame', 'timber_stack', 'yard_lantern', 'sawhorse_bench', 'pitch_kettle', 'pier_section', 'banner_pole', 'banner_line', 'landing_crates', 'driftwood_log', 'strand_signpost',
];
export const DRIFTWOOD_MATERIAL_BINDINGS = Object.freeze({
  watch_stone: { source: 'watch_stone' }, aged_timber: { source: 'aged_timber' },
  forged_iron: { source: 'forged_iron' }, recess_shadow: { source: 'recess_shadow' }, lantern_amber: { source: 'lantern_amber' },
  raw_plank: { source: 'aged_timber', color: [5.4, 4.1, 2.3], normalScale: .45 },
  pitch_black: { source: 'aged_timber', color: [.55, .5, .45], normalScale: .35 },
  tar_roof: { source: 'aged_timber', color: [.85, .76, .66], normalScale: .30 },
  oxblood_paint: { source: 'aged_timber', color: [3.6, 1.05, .9], normalScale: .35 },
  bleached_wood: { source: 'aged_timber', color: [5.8, 5.7, 5.3], normalScale: .30 },
  silver_shingle: { source: 'dark_slate', color: [5.8, 5.4, 4.3], normalScale: .40 },
  sail_canvas: { source: 'ground_earth', color: [8.5, 8.0, 6.8], doubleSided: true },
  hemp_rope: { source: 'needle_foliage', color: [2.6, 1.7, 1.1] },
});
const SHARED_URL = '/assets/old-watch/kit.glb', YARD_URL = '/assets/driftwood-yard/kit.glb';
const TAU = Math.PI * 2, CELL = 16, clamp = THREE.MathUtils.clamp;
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function prefabRoots(scene, names) {
  return Object.fromEntries(names.map(name => {
    const root = scene.getObjectByName(name); let meshes = 0;
    root?.traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count && object.material) meshes++; });
    if (!meshes) throw new Error('Driftwood Yard kit is missing or empty: ' + name);
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
  return DRIFTWOOD_BUILDINGS.some(building => {
    const local = buildingLocalPoint(building, x, z);
    return Math.abs(local.x) < building.width / 2 + margin && Math.abs(local.z) < building.depth / 2 + margin;
  });
}
// Both overlays lie on the same alternating terrain triangles, so they share
// one assembly. Depth bias would pull them over the pier and the crates.
function overlay(material, name, positions, colors, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const sand = material.clone(); sand.vertexColors = true; sand.transparent = true; sand.depthWrite = false; sand.polygonOffset = false;
  const mesh = new THREE.Mesh(geometry, sand); mesh.name = name; mesh.receiveShadow = true; mesh.renderOrder = 2;
  return mesh;
}

// Pale worked sand with sawdust around the hull and the timber stack, trodden
// darker off the routes and bleached pale along them.
export function buildDriftwoodYardTerrain(material, sites = null) {
  const step = TERRAIN_GRID_STEP, origin = -TERRAIN_GRID_HALF;
  const minX = 10, minZ = 72, columns = 22, rows = 23;
  const positions = [], colors = [], uvs = [], indices = [];
  const sand = new THREE.Color('#d8cfae'), sawdust = new THREE.Color('#c9a46a'), trodden = new THREE.Color('#b09a72'), worn = new THREE.Color('#e6dcbe');
  for (let zi = 0; zi <= rows; zi++) for (let xi = 0; xi <= columns; xi++) {
    const x = minX + xi * step, z = minZ + zi * step;
    const weight = driftwoodYardWeight(x, z);
    const path = 1 - smooth((driftwoodPathDistance(x, z) - 1.6) / 2.4);
    const shavings = !sites ? 0 : Math.max(smooth((6.5 - Math.hypot(x - sites.hull.x, z - sites.hull.z)) / 3.5),
      smooth((4 - Math.hypot(x - sites.timber.x, z - sites.timber.z)) / 2.5));
    const mottling = clamp(.5 + Math.sin(x * .37 + z * .21) * .3 + Math.sin(z * .43 - x * .11) * .2, 0, 1);
    const color = sand.clone().lerp(trodden, mottling * .45 * (1 - path)).lerp(sawdust, shavings * .8).lerp(worn, path * .85).multiplyScalar(2.0 + path * .5);
    let alpha = Math.min(1, weight * (.36 + path * .44 + shavings * .25));
    if (insideAnyBuilding(x, z, .3) || xi === 0 || zi === 0 || xi === columns || zi === rows) alpha = 0;
    positions.push(x, renderedHeightAt(x, z) + .034, z); colors.push(color.r, color.g, color.b, alpha); uvs.push(x / 4, z / 4);
    if (xi < columns && zi < rows) {
      const n = zi * (columns + 1) + xi;
      const parity = ((x - origin) / step + (z - origin) / step) % 2;
      if (parity) indices.push(n, n + columns + 1, n + 1, n + 1, n + columns + 1, n + columns + 2);
      else indices.push(n, n + columns + 2, n + 1, n, n + columns + 1, n + columns + 2);
    }
  }
  return overlay(material, 'driftwood-yard-sawdust-and-worked-sand', positions, colors, uvs, indices);
}

// Open, near-white dry sand with a damp band toward the waterline and pale
// routes where the landing is walked.
export function buildSunwakeStrandTerrain(material) {
  const step = TERRAIN_GRID_STEP, origin = -TERRAIN_GRID_HALF;
  const minX = -12, minZ = 78, columns = 16, rows = 24;
  const positions = [], colors = [], uvs = [], indices = [];
  const dry = new THREE.Color('#ece3c6'), damp = new THREE.Color('#c8b88e'), worn = new THREE.Color('#f1ead4');
  for (let zi = 0; zi <= rows; zi++) for (let xi = 0; xi <= columns; xi++) {
    const x = minX + xi * step, z = minZ + zi * step, height = heightAt(x, z);
    const path = 1 - smooth((sunwakeStrandPathDistance(x, z) - 1.5) / 2.5);
    const color = dry.clone().lerp(damp, smooth((1.9 - height) / 1.2)).lerp(worn, path * .8).multiplyScalar(2.3);
    let alpha = sunwakeStrandWeight(x, z) * (.42 + path * .35);
    if (height < .25 || xi === 0 || zi === 0 || xi === columns || zi === rows) alpha = 0;
    positions.push(x, renderedHeightAt(x, z) + .034, z); colors.push(color.r, color.g, color.b, alpha); uvs.push(x / 4, z / 4);
    if (xi < columns && zi < rows) {
      const n = zi * (columns + 1) + xi;
      const parity = ((x - origin) / step + (z - origin) / step) % 2;
      if (parity) indices.push(n, n + columns + 1, n + 1, n + 1, n + columns + 1, n + columns + 2);
      else indices.push(n, n + columns + 2, n + 1, n, n + columns + 1, n + columns + 2);
    }
  }
  return overlay(material, 'sunwake-strand-open-sand', positions, colors, uvs, indices);
}

function swayPennants(root, wind, owner) {
  root.traverse(object => {
    if (!object.isMesh || object.material.name !== 'sail_canvas') return;
    const cloth = object.material = object.material.clone(); owner.material.push(cloth);
    cloth.onBeforeCompile = shader => {
      shader.uniforms.driftwoodWind = wind;
      shader.vertexShader = 'uniform float driftwoodWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(driftwoodWind + position.x * .55) * max(-position.y, 0.0) * .11;');
    };
    cloth.customProgramCacheKey = () => 'driftwood-yard-pennant-wind-v1';
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
    const blade = source.material.clone();
    parent.material.push(blade);
    if (tint) blade.color.multiply(tint);
    if (wind) {
      blade.side = THREE.DoubleSide;
      blade.onBeforeCompile = shader => {
        shader.uniforms.driftwoodWind = wind;
        shader.vertexShader = 'uniform float driftwoodWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x += sin(driftwoodWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * pow(max(position.y, 0.0), 2.0) * .045;\n#endif');
      };
      blade.customProgramCacheKey = () => 'driftwood-yard-grass-wind-v1';
    }
    for (const [key, cellPoints] of cells) {
      const mesh = new THREE.InstancedMesh(source.geometry, blade, cellPoints.length);
      mesh.name = 'driftwood-yard-' + kind + '-' + prefab.name + '-' + key;
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

export function buildDriftwoodYardKit(yard, shared, { propSites = [] } = {}) {
  const prefabs = prefabRoots(yard.scene, DRIFTWOOD_YARD_PREFABS), library = prefabRoots(shared.scene, ['grass_clump']);
  const materials = sourceMaterials(shared.scene), slots = sourceMaterials(yard.scene);
  for (const name of slots.keys()) {
    const binding = DRIFTWOOD_MATERIAL_BINDINGS[name];
    if (!binding || !materials.has(binding.source)) throw new Error('Driftwood Yard material binding is missing: ' + name);
  }
  if (!materials.has('ground_earth')) throw new Error('Driftwood Yard shared ground_earth is missing');
  const sites = driftwoodWorkSites(propSites);
  const group = new THREE.Group(); group.name = 'driftwood-yard-weathered-environment'; group.material = [];
  const boundLibrary = new THREE.Group(), borrowed = [yard.scene, shared.scene]; boundLibrary.material = [];
  try {
    const bindings = new Map();
    for (const name of slots.keys()) {
      const binding = DRIFTWOOD_MATERIAL_BINDINGS[name], material = materials.get(binding.source).clone();
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
    const buildings = {};
    for (const building of DRIFTWOOD_BUILDINGS) {
      const prefix = DRIFTWOOD_BUILDING_PREFIXES[building.id], floor = heightAt(building.x, building.z);
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
    const work = [['hull_frame', sites.hull, .3], ['timber_stack', sites.timber, 0], ['yard_lantern', sites.lantern, 0]];
    for (const [name, site, yaw] of work) {
      const root = footing(bound[name], site.x, site.z, yaw, site.radius); root.name = 'driftwood-yard-authored-' + name.replaceAll('_', '-'); group.add(root);
    }
    // Loose yard tools sit around the hull and behind the shed, never on the
    // trail, Ada's loop, the supplies, an original work site or each other.
    const shed = DRIFTWOOD_BUILDINGS[0], stackAnchor = buildingWorldPoint(shed, 0, -shed.depth / 2 - 5.5);
    const loose = [
      { prefab: 'sawhorse_bench', name: 'sawhorse-bench', origin: sites.hull, radius: 1.5, scale: 1, offsets: [[-4.6, 1.2, .9], [-4.2, -2.6, .4], [4.3, 2.2, -.5]] },
      { prefab: 'pitch_kettle', name: 'pitch-kettle', origin: sites.hull, radius: .75, scale: 1, offsets: [[-3.4, -3.6, 0], [3.6, -3.3, 0], [-4.9, 3.2, 0]] },
      { prefab: 'timber_stack', name: 'timber-stack-1', origin: stackAnchor, radius: 1.95, scale: .75, offsets: [[2.4, 0, 1.35], [-2.6, .8, 1.35], [0, 2.8, 1.35]] },
    ];
    const reserved = [...propSites], extras = [];
    for (const item of loose) {
      const radius = item.radius * item.scale;
      const point = item.offsets.map(([dx, dz, yaw]) => ({ x: item.origin.x + dx, z: item.origin.z + dz, yaw }))
        .find(candidate => driftwoodPlantClearance(candidate.x, candidate.z, reserved, .1) && !insideAnyBuilding(candidate.x, candidate.z, .9));
      if (!point) continue;
      const root = footing(bound[item.prefab], point.x, point.z, point.yaw, radius);
      root.scale.setScalar(item.scale); root.name = 'driftwood-yard-' + item.name; group.add(root); extras.push(root);
      reserved.push({ x: point.x, z: point.z, radius });
    }
    group.add(buildDriftwoodYardTerrain(materials.get('ground_earth'), sites), buildSunwakeStrandTerrain(materials.get('ground_earth')));
    // The pier follows the beach as one continuous ramp; every section tilts
    // toward its neighbours so the deck stays joined down to the water. The
    // seaward sections bottom out just clear of the swell rather than levelling
    // a metre above it; the pilings already reach -4 m.
    const decks = [];
    for (let index = 0; index < SUNWAKE_PIER.sections; index++) {
      const z = SUNWAKE_PIER.firstZ + index * SUNWAKE_PIER.length;
      decks.push({ z, y: Math.max(.85, renderedHeightAt(SUNWAKE_PIER.x, z) + .14) });
    }
    const pier = decks.map((deck, index) => {
      const previous = decks[index - 1] ?? deck, next = decks[index + 1] ?? deck;
      const section = place(bound.pier_section, SUNWAKE_PIER.x, deck.y, deck.z);
      section.rotation.x = Math.atan2(previous.y - next.y, next.z - previous.z || SUNWAKE_PIER.length);
      section.name = 'sunwake-pier-section-' + index; group.add(section); return section;
    });
    const poles = SUNWAKE_BANNER.poles.map((offset, index) => {
      const x = SPAWN.x + offset, pole = place(bound.banner_pole, x, renderedHeightAt(x, SUNWAKE_BANNER.z), SUNWAKE_BANNER.z);
      pole.name = 'sunwake-banner-pole-' + index; group.add(pole); return pole;
    });
    const line = place(bound.banner_line, SPAWN.x, heightAt(SPAWN.x, SUNWAKE_BANNER.z) + SUNWAKE_BANNER.lineHeight, SUNWAKE_BANNER.z);
    line.name = 'sunwake-banner-line'; swayPennants(line, wind, boundLibrary); group.add(line);
    const crates = SUNWAKE_LANDING_CRATES.map((crate, index) => {
      const root = footing(bound.landing_crates, crate.x, crate.z, .2, 1.15 * crate.scale);
      root.scale.setScalar(crate.scale); root.name = 'sunwake-landing-crates-' + index; group.add(root);
      reserved.push({ x: crate.x, z: crate.z, radius: 1.15 * crate.scale }); return root;
    });
    const signpost = [[-3.6, 98.4, .35], [4.2, 97.6, -.4], [-4.5, 104, .2]].map(([x, z, yaw]) => ({ x, z, yaw }))
      .find(point => driftwoodPlantClearance(point.x, point.z, reserved, .2));
    if (signpost) {
      const post = footing(bound.strand_signpost, signpost.x, signpost.z, signpost.yaw, .8); post.name = 'sunwake-strand-signpost'; group.add(post);
      reserved.push({ x: signpost.x, z: signpost.z, radius: .8 });
    }
    // Storm wrack along the tideline, clear of the drop point and the pier.
    const random = seededRandom(733901), logs = [];
    for (let index = 0; index < 400 && logs.length < 6; index++) {
      const x = -12 + random() * 60, z = 100 + random() * 20;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 14 || (Math.abs(x - SUNWAKE_PIER.x) < 4 && z > 112)) continue;
      if (!driftwoodPlantClearance(x, z, reserved, 1.2)) continue;
      logs.push({ x, z, yaw: random() * TAU, scale: .8 + random() * .35 });
      reserved.push({ x, z, radius: 1.4 });
    }
    logs.forEach((log, index) => {
      const root = footing(bound.driftwood_log, log.x, log.z, log.yaw, 1.4 * log.scale);
      root.scale.setScalar(log.scale); root.name = 'sunwake-driftwood-log-' + index; group.add(root);
    });
    // Sea oats, paler and greener than the harbor's dune straw.
    const grass = [];
    for (let index = 0; index < 1400 && grass.length < 170; index++) {
      const x = -12 + random() * 66, z = 72 + random() * 50;
      if (random() > driftwoodWeight(x, z) || !driftwoodPlantClearance(x, z, reserved, .15)) continue;
      if (Math.sin(x * .5 + z * .2) + Math.sin(z * .47 - x * .13) < .1) continue;
      grass.push({ x, z, yaw: random() * TAU, scale: .55 + random() * .5 });
    }
    const detail = batches(library.grass_clump, grass, group, { kind: 'grass', wind, tint: new THREE.Color(1.35, 1.45, .95) });
    return { group, buildings, wind, detail, ownedRoots: [group, boundLibrary],
      counts: { prefabs: DRIFTWOOD_YARD_PREFABS.length, buildings: DRIFTWOOD_BUILDINGS.length, workSites: work.length, extraProps: extras.length,
        pierSections: pier.length, bannerPoles: poles.length, crates: crates.length, logs: logs.length, grass: grass.length, detailMeshes: detail.length, cellSize: CELL } };
  } catch (error) { disposeOwnedResources([group, boundLibrary], borrowed); throw error; }
}

export function createDriftwoodYard({ scene, settlements, assets = null, legacyVegetation = null, landingFallback = null, load } = {}) {
  const cache = assets ?? createEnvironmentAssets(load ? { load } : {}), ownsCache = !assets;
  const leases = [cache.acquire(SHARED_URL), cache.acquire(YARD_URL)];
  let disposed = false, kit = null, sources = [], status = 'loading', error = null;
  const release = () => { for (const lease of leases) lease.release(); if (ownsCache) cache.dispose(); };
  const restoreFallback = () => {
    try { settlements.setDriftwoodYardKit(null); }
    catch (failure) { error = [error, 'Fallback restore: ' + String(failure?.message ?? failure)].filter(Boolean).join('; '); }
    if (legacyVegetation) legacyVegetation.visible = true;
    if (landingFallback) landingFallback.visible = true;
  };
  const ready = Promise.all(leases.map(lease => lease.ready)).then(([shared, yard]) => {
    if (disposed) return false;
    sources = [yard.scene, shared.scene];
    kit = buildDriftwoodYardKit(yard, shared, { propSites: settlements.group.userData.propSites });
    scene.add(kit.group); settlements.setDriftwoodYardKit(kit);
    if (legacyVegetation) legacyVegetation.visible = false;
    if (landingFallback) landingFallback.visible = false;
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
