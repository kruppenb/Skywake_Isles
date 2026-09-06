import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heightAt, seededRandom, CHESTS, OBSTACLES, WORLD_RADIUS } from '../shared/world.js';
import { BUILDINGS, RESIDENTS, EXPLORATION_TRAILS, trailDistance, buildingLocalPoint, buildingWorldPoint } from '../shared/exploration.js';
import { OLD_WATCH, OLD_WATCH_PROPS, oldWatchWeight, oldWatchFarmClearance } from '../shared/old-watch.js';

export const OLD_WATCH_PREFABS = ['watch_tower', 'barracks_base', 'barracks_wall_east', 'barracks_wall_west', 'barracks_wall_front', 'barracks_wall_back', 'barracks_roof', 'ruin_wall', 'rock_a', 'rock_b', 'pine_a', 'pine_b', 'grass_clump', 'fern_clump', 'ground_sample'];
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const TERRAIN_ORIGIN = -Math.ceil(WORLD_RADIUS + 12);

// Interpolate the exact alternating 2 m triangles used by world.buildTerrain.
// Sampling only the height function between grid vertices can float plants.
export function renderedHeightAt(x, z) {
  const origin = TERRAIN_ORIGIN;
  const ix = Math.floor((x - origin) / 2), iz = Math.floor((z - origin) / 2);
  const xx = origin + ix * 2, zz = origin + iz * 2, u = (x - xx) / 2, v = (z - zz) / 2;
  const a = heightAt(xx, zz), b = heightAt(xx + 2, zz), c = heightAt(xx, zz + 2), d = heightAt(xx + 2, zz + 2);
  if ((ix + iz) % 2) return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  return u >= v ? a + (b - a) * u + (d - b) * v : a + (d - c) * u + (c - a) * v;
}

function disposeResources(...roots) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  for (const root of roots) root?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of !object.material ? [] : Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) { textures.add(value); if (value.source?.data?.close) images.add(value.source.data); }
    }
  });
  geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
  textures.forEach(value => value.dispose()); images.forEach(value => value.close());
}

function terrainPatch(material) {
  const positions = [], colors = [], uvs = [], indices = [], count = 28, minX = OLD_WATCH.x - 28, minZ = OLD_WATCH.z - 28;
  const dirt = new THREE.Color('#b4aa8c'), moss = new THREE.Color('#808c69'), track = new THREE.Color('#c3b497');
  for (let zi = 0; zi <= count; zi++) for (let xi = 0; xi <= count; xi++) {
    const x = minX + xi * 2, z = minZ + zi * 2;
    const radius = Math.hypot(x - OLD_WATCH.x, z - OLD_WATCH.z);
    const broken = Math.sin(x * .41 + z * .2) * 1.3 + Math.sin(z * .71 - x * .13) * .8;
    let edge = clamp((26 + broken - radius) / 7, 0, 1); edge = edge * edge * (3 - 2 * edge);
    const path = 1 - clamp((trailDistance(x, z) - 1.5) / 2.8, 0, 1);
    const mottling = clamp(.35 + Math.sin(x * .39) * .22 + Math.sin(z * .3 + x * .1) * .18, 0, 1);
    const color = dirt.clone().lerp(moss, mottling * (1 - path)).lerp(track, path * .7);
    // The same soil texture reads as sun-worn gravel along the public approach.
    // Linear vertex values above one lift that strip without bleaching the moss.
    color.multiplyScalar(1 + path * 2.2);
    positions.push(x, renderedHeightAt(x, z) + .028, z); colors.push(color.r, color.g, color.b, edge * .98 * oldWatchFarmClearance(x, z)); uvs.push(x / 4, z / 4);
    if (zi < count && xi < count) {
      const n = zi * (count + 1) + xi, parity = ((x - TERRAIN_ORIGIN) / 2 + (z - TERRAIN_ORIGIN) / 2) % 2;
      if (parity) indices.push(n, n + count + 1, n + 1, n + 1, n + count + 1, n + count + 2);
      else indices.push(n, n + count + 2, n + 1, n, n + count + 1, n + count + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const surface = material.clone(); surface.vertexColors = true; surface.transparent = true; surface.depthWrite = false;
  surface.polygonOffset = true; surface.polygonOffsetFactor = -1; surface.polygonOffsetUnits = -1;
  for (const texture of [surface.map, surface.normalMap, surface.roughnessMap]) if (texture) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.needsUpdate = true; }
  const mesh = new THREE.Mesh(geometry, surface); mesh.name = 'old-watch-earth-and-gravel'; mesh.receiveShadow = true; mesh.renderOrder = 1;
  return mesh;
}

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}

export function plantClearance(x, z, sites = []) {
  if (trailDistance(x, z) < 2.8 || CHESTS.some(p => Math.hypot(x - p.x, z - p.z) < 2.4)) return false;
  if (sites.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + .2)) return false;
  for (const b of BUILDINGS) {
    if (!b.enterable) { if (Math.hypot(x - b.x, z - b.z) < b.radius + .45) return false; continue; }
    const local = buildingLocalPoint(b, x, z);
    if (Math.abs(local.x) < b.width / 2 + .65 && Math.abs(local.z) < b.depth / 2 + .65) return false;
    if (Math.abs(local.x) < b.doorWidth / 2 + .8 && Math.abs(local.z) < b.depth / 2 + 4) return false;
  }
  for (const person of RESIDENTS) for (let i = 0; i < person.route.length; i++) if (segmentDistance(x, z, person.route[i], person.route[(i + 1) % person.route.length]) < 1.2) return false;
  return !OBSTACLES.some(p => p.type !== 'building' && Math.hypot(x - p.x, z - p.z) < p.radius + .25);
}

function placePrefab(prefab, x, z, yaw = 0, y = renderedHeightAt(x, z)) {
  const object = prefab.clone(true); object.position.set(x, y, z); object.rotation.y = yaw;
  object.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
  return object;
}

function addLantern(parent, site, agedTimber) {
  const group = new THREE.Group(); group.name = 'old-watch-iron-lantern'; group.position.set(site.x, renderedHeightAt(site.x, site.z), site.z);
  const iron = new THREE.MeshStandardMaterial({ color: '#343932', roughness: .9 });
  const timber = agedTimber?.clone() ?? new THREE.MeshStandardMaterial({ color: '#686252', roughness: 1 });
  const amber = new THREE.MeshStandardMaterial({ color: '#c79651', emissive: '#e69b48', emissiveIntensity: .7, roughness: .7 });
  const piece = (geometry, material, x, y, z) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = material !== amber; group.add(mesh); };
  piece(new THREE.CylinderGeometry(.055, .09, 2.55, 7), timber, 0, 1.25, 0);
  piece(new THREE.BoxGeometry(.53, .075, .075), iron, .2, 2.42, 0);
  piece(new THREE.BoxGeometry(.25, .36, .25), amber, .4, 2.09, 0);
  for (const y of [1.88, 2.3]) piece(new THREE.BoxGeometry(.37, .07, .37), iron, .4, y, 0);
  for (const x of [-1, 1]) for (const z of [-1, 1]) piece(new THREE.BoxGeometry(.025, .45, .025), iron, .4 + x * .16, 2.09, z * .16);
  const light = new THREE.PointLight('#ffc179', 2, 5, 2); light.position.set(.4, 2.05, 0); group.add(light); parent.add(group);
}

function addFlagstones(prefab, parent, propSites) {
  const room = BUILDINGS.find(b => b.id === 'watch-barracks');
  const approach = EXPLORATION_TRAILS.find(t => t.id === 'old-watch').points;
  const routes = [approach, [OLD_WATCH, buildingWorldPoint(room, 0, room.depth / 2 + 1.5)]];
  const random = seededRandom(9163), points = [], transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
  for (const route of routes) for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let along = .7; along < length; along += 1.35 + random() * .9) {
      const t = along / length, offset = (random() - .5) * 1.8;
      const x = a.x + (b.x - a.x) * t + (b.z - a.z) / length * offset, z = a.z + (b.z - a.z) * t - (b.x - a.x) / length * offset;
      if (oldWatchWeight(x, z) < .2 || propSites.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + .3)) continue;
      points.push({ x, z, yaw: random() * TAU, width: .44 + random() * .28, depth: .35 + random() * .23 });
    }
  }
  prefab.updateMatrixWorld(true);
  prefab.traverse(source => {
    if (!source.isMesh) return;
    const material = source.material.clone(); material.color.multiplyScalar(1.9);
    const mesh = new THREE.InstancedMesh(source.geometry, material, points.length); mesh.name = 'old-watch-worn-path-stones';
    points.forEach((point, index) => {
      // Stones sit only a few centimetres above the rendered triangle surface;
      // they never introduce a step or another collision/elevation surface.
      transform.position.set(point.x, renderedHeightAt(point.x, point.z) + .02, point.z); transform.rotation.set(0, point.yaw, 0); transform.scale.set(point.width, .045, point.depth); transform.updateMatrix();
      matrix.multiplyMatrices(transform.matrix, source.matrixWorld); mesh.setMatrixAt(index, matrix);
    });
    mesh.receiveShadow = true; mesh.computeBoundingSphere(); parent.add(mesh);
  });
  return points.length;
}

function foliageInstances(prefab, points, parent, wind) {
  const result = [], transform = new THREE.Object3D(), matrix = new THREE.Matrix4(); prefab.updateMatrixWorld(true);
  prefab.traverse(source => {
    if (!source.isMesh) return;
    const material = source.material.clone(); material.side = THREE.DoubleSide;
    material.onBeforeCompile = shader => {
      shader.uniforms.oldWatchWind = wind;
      shader.vertexShader = 'uniform float oldWatchWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x += sin(oldWatchWind + instanceMatrix[3].x * .47 + instanceMatrix[3].z * .31) * pow(max(position.y, 0.0), 2.0) * .055;\n#endif');
    };
    material.customProgramCacheKey = () => 'old-watch-wind-v1';
    const mesh = new THREE.InstancedMesh(source.geometry, material, points.length); mesh.name = 'old-watch-instanced-' + prefab.name;
    points.forEach((point, index) => {
      transform.position.set(point.x, renderedHeightAt(point.x, point.z) + .025, point.z); transform.rotation.set(0, point.yaw, 0); transform.scale.setScalar(point.scale); transform.updateMatrix();
      matrix.multiplyMatrices(transform.matrix, source.matrixWorld); mesh.setMatrixAt(index, matrix);
    });
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.computeBoundingSphere(); mesh.userData.fullCount = points.length; parent.add(mesh); result.push(mesh);
  });
  return result;
}

// Builds without a renderer. Validate all roots before touching live scenery.
export function buildOldWatchKit(gltf, { propSites = [] } = {}) {
  const root = gltf.scene, prefabs = Object.fromEntries(OLD_WATCH_PREFABS.map(name => [name, root.getObjectByName(name)]));
  for (const name of OLD_WATCH_PREFABS) {
    if (!prefabs[name]) throw new Error('Old Watch kit is missing ' + name);
    let meshes = 0;
    prefabs[name].traverse(object => { if (object.isMesh && object.geometry?.attributes.position?.count > 0 && object.material) meshes++; });
    if (!meshes) throw new Error('Old Watch kit has an empty prefab: ' + name);
  }
  let groundMaterial;
  prefabs.ground_sample.traverse(object => { if (object.material?.name === 'ground_earth') groundMaterial = object.material; });
  if (!groundMaterial) throw new Error('Old Watch kit is missing ground_earth');
  const group = new THREE.Group(); group.name = 'old-watch-weathered-pilot';
  let agedTimber; root.traverse(object => { if (object.material?.name === 'aged_timber') agedTimber = object.material; });
  const tower = BUILDINGS.find(b => b.id === 'signal-tower'), room = BUILDINGS.find(b => b.id === 'watch-barracks');
  const floor = heightAt(room.x, room.z);
  let towerY = renderedHeightAt(tower.x, tower.z);
  for (let i = 0; i < 12; i++) towerY = Math.max(towerY, renderedHeightAt(tower.x + Math.sin(i / 12 * TAU) * 2.7, tower.z + Math.cos(i / 12 * TAU) * 2.7));
  const towerObject = placePrefab(prefabs.watch_tower, tower.x, tower.z, tower.yaw, towerY);
  // Fit the same collision roof height even on the uphill foundation edge.
  towerObject.scale.y = Math.min(1, (heightAt(tower.x, tower.z) + tower.height - towerY) / 10); group.add(towerObject);
  group.add(placePrefab(prefabs.barracks_base, room.x, room.z, room.yaw, floor));
  const walls = new THREE.Group(); walls.name = 'watch-barracks-authored-cutaway-walls';
  const normals = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
  ['east', 'west', 'front', 'back'].forEach((face, index) => {
    const wall = placePrefab(prefabs['barracks_wall_' + face], room.x, room.z, room.yaw, floor); wall.userData.normal = normals[index]; walls.add(wall);
  });
  const roof = placePrefab(prefabs.barracks_roof, room.x, room.z, room.yaw, floor); roof.name = 'watch-barracks-authored-cutaway-roof'; group.add(walls, roof);
  for (const site of propSites.filter(p => p.poiId === 'old-watch')) {
    if (site.prefab === 'ruin_wall') group.add(placePrefab(prefabs.ruin_wall, site.x, site.z, site.yaw));
    if (site.prefab === 'lantern') addLantern(group, site, agedTimber);
  }
  for (const prop of OLD_WATCH_PROPS) {
    const object = placePrefab(prefabs[prop.prefab], prop.x, prop.z, prop.yaw, heightAt(prop.x, prop.z));
    const baseHeight = prop.prefab === 'pine_a' ? 8 : prop.prefab === 'pine_b' ? 10 : 1.25;
    const widthScale = prop.type === 'tree' ? prop.radius / (prop.prefab === 'pine_a' ? .28 : .32) : prop.radius;
    object.scale.set(widthScale, prop.height / baseHeight, widthScale); object.name = prop.id; group.add(object);
  }
  group.add(terrainPatch(groundMaterial));
  const flagstones = addFlagstones(prefabs.rock_a, group, propSites);
  const random = seededRandom(80211), grass = [], ferns = [];
  for (let i = 0; i < 1900; i++) {
    const a = random() * TAU, r = Math.sqrt(random()) * 26, x = OLD_WATCH.x + Math.sin(a) * r, z = OLD_WATCH.z + Math.cos(a) * r;
    if (random() > oldWatchWeight(x, z) || !plantClearance(x, z, propSites)) continue;
    const patch = Math.sin(x * .48 + z * .13) + Math.sin(z * .51 - x * .23);
    if (patch < -.35 || (r < 9 && random() < .65)) continue;
    const fern = patch > .95 && random() < .24;
    (fern ? ferns : grass).push({ x, z, yaw: random() * TAU, scale: fern ? .7 + random() * .5 : .5 + random() * .8 });
  }
  const wind = { value: 0 }, foliage = [...foliageInstances(prefabs.grass_clump, grass, group, wind), ...foliageInstances(prefabs.fern_clump, ferns, group, wind)];
  return { group, walls, roof, foliage, wind, counts: { prefabs: OLD_WATCH_PREFABS.length, collidableProps: OLD_WATCH_PROPS.length, grass: grass.length, ferns: ferns.length, flagstones, foliageMeshes: foliage.length } };
}

function fallbackProps() {
  const group = new THREE.Group(); group.name = 'old-watch-solid-prop-fallback';
  const stone = new THREE.MeshStandardMaterial({ color: '#777b6d', roughness: 1, flatShading: true });
  const bark = new THREE.MeshStandardMaterial({ color: '#686050', roughness: 1 });
  const needle = new THREE.MeshStandardMaterial({ color: '#435e4c', roughness: 1, flatShading: true });
  for (const p of OLD_WATCH_PROPS) {
    const object = new THREE.Group(); object.position.set(p.x, heightAt(p.x, p.z), p.z); object.name = p.id;
    if (p.type === 'tree') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(p.radius * .65, p.radius, p.height, 7), bark); trunk.position.y = p.height / 2; object.add(trunk);
      for (let i = 0; i < 3; i++) { const crown = new THREE.Mesh(new THREE.ConeGeometry(2 - i * .35, p.height * .43, 7), needle); crown.position.y = p.height * (.45 + i * .17); object.add(crown); }
    } else {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), stone); rock.scale.set(p.radius, p.height * .7, p.radius); rock.position.y = p.height * .3; object.add(rock);
    }
    object.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } }); group.add(object);
  }
  return group;
}

export function createOldWatch({ scene, settlements, legacyVegetation = null, hemisphere = null, sun = null, load = () => new GLTFLoader().loadAsync('/assets/old-watch/kit.glb') }) {
  const fallback = fallbackProps(); scene.add(fallback);
  let disposed = false, kit = null, gltf = null, status = 'loading', failure = null;
  const original = { sky: scene.background?.isColor ? scene.background.clone() : null, fog: scene.fog?.color.clone(), near: scene.fog?.near, far: scene.fog?.far,
    skyLight: hemisphere?.color.clone(), groundLight: hemisphere?.groundColor.clone(), ambient: hemisphere?.intensity, sunColor: sun?.color.clone(), sunIntensity: sun?.intensity };
  const coolSky = new THREE.Color('#abc6cc'), coolFog = new THREE.Color('#b0c8ca'), coolAmbient = new THREE.Color('#d2dce1'), earthBounce = new THREE.Color('#77765e'), warmSun = new THREE.Color('#f5ddba');
  const ready = Promise.resolve().then(load).then(asset => {
    if (disposed) { disposeResources(asset.scene); return false; }
    gltf = asset; kit = buildOldWatchKit(asset, { propSites: settlements.group.userData.propSites });
    scene.add(kit.group); settlements.setOldWatchKit(kit); fallback.visible = false;
    if (legacyVegetation) legacyVegetation.visible = false;
    status = 'ready'; return true;
  }).catch(error => {
    if (gltf) disposeResources(gltf.scene, kit?.group);
    gltf = null; kit = null; failure = String(error?.message ?? error); if (!disposed) status = 'fallback';
    return false;
  });
  function animate(time, { player = null, lowQuality = false, reducedMotion = false } = {}) {
    if (disposed) return;
    const weight = kit && player && player.mode !== 'aboard' ? oldWatchWeight(player.x, player.z) : 0;
    if (original.sky) scene.background.copy(original.sky).lerp(coolSky, weight * .8);
    if (scene.fog && original.fog) { scene.fog.color.copy(original.fog).lerp(coolFog, weight); scene.fog.near = THREE.MathUtils.lerp(original.near, 72, weight); scene.fog.far = THREE.MathUtils.lerp(original.far, 340, weight); }
    if (hemisphere) { hemisphere.color.copy(original.skyLight).lerp(coolAmbient, weight); hemisphere.groundColor.copy(original.groundLight).lerp(earthBounce, weight); hemisphere.intensity = THREE.MathUtils.lerp(original.ambient, 1.5, weight); }
    if (sun) { sun.color.copy(original.sunColor).lerp(warmSun, weight); sun.intensity = THREE.MathUtils.lerp(original.sunIntensity, 2.25, weight); }
    if (!kit) return;
    kit.wind.value = reducedMotion ? 0 : time * 1.3;
    const distance = player ? Math.hypot(player.x - OLD_WATCH.x, player.z - OLD_WATCH.z) : Infinity;
    for (const mesh of kit.foliage) { mesh.visible = distance < (lowQuality ? 60 : 110); mesh.count = Math.floor(mesh.userData.fullCount * (lowQuality ? .36 : 1)); }
  }
  return { ready, animate, getStats: () => ({ status, loading: status === 'loading', fallback: status !== 'ready', error: failure, ...(kit?.counts ?? {}) }), dispose() {
    if (disposed) return;
    // Restore the island before releasing this controller's independently owned resources.
    animate(0); disposed = true; status = 'disposed'; settlements.setOldWatchKit(null);
    if (legacyVegetation) legacyVegetation.visible = true;
    fallback.removeFromParent(); kit?.group.removeFromParent(); disposeResources(fallback, gltf?.scene, kit?.group); gltf = null; kit = null;
  } };
}
