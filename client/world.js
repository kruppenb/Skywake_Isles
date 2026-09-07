import * as THREE from 'three';
import { heightAt, regionAt, shipAt, seededRandom, REGIONS, SHRINES, CHESTS, OBSTACLES, BEACON, SPAWN, SEED } from '../shared/world.js';
import { POINTS_OF_INTEREST, BUILDINGS, trailDistance, buildingAt } from '../shared/exploration.js';
import { makePalette, GeoBatch, buildGalleon, buildPirate, buildWeapon, buildCrab, buildChest, buildShrine, addPalm, addBroadTree, addMushroom, addCrystal, addHut, addLighthouse } from './models.js';
import { WEAPONS, RARITIES } from '../shared/weapons.js';
import { isLootVisible } from './loot-visibility.js';
import { hasWorldLineOfSight } from '../shared/collision.js';
import { cameraTravel, scopeCameraPose } from './camera.js';
import { SCOPE_FOV } from './weapon-presentation.js';
import { buildSettlements } from './settlement.js';
import { createRemoteInterpolation, displayedSpeed, makeTracerFlight, sampleTracerFlight } from './interpolation.js';
import { SIDE_EVENTS, SIDE_EVENT_COLOR } from '../shared/side-events.js';
import { ENEMY_TYPES } from '../shared/enemies.js';
import { createObjectiveMarker, updateObjectiveMarker } from './objective-markers.js';
import { createOldWatch } from './old-watch.js';
import { oldWatchWeight } from '../shared/old-watch.js';
import { windwardFarmWeight } from '../shared/windward-farm.js';
import { createWindwardFarm } from './windward-farm.js';
import { tideglassWeight } from '../shared/tideglass-market.js';
import { createTideglassMarket } from './tideglass-market.js';
import { saltwindHarborWeight } from '../shared/saltwind-harbor.js';
import { createSaltwindHarbor } from './saltwind-harbor.js';
import { driftwoodWeight, SUNWAKE_LANDING_CRATE_CANDIDATES } from '../shared/driftwood-yard.js';
import { createDriftwoodYard } from './driftwood-yard.js';
import { palmheartWeight } from '../shared/palmheart-camp.js';
import { createPalmheartCamp } from './palmheart-camp.js';
import { cinderworksWeight } from '../shared/cinderworks.js';
import { createCinderworks } from './cinderworks.js';
import { createEnvironmentAssets } from './environment-assets.js';
import { createEnvironmentLighting } from './environment-lighting.js';
import { TERRAIN_GRID_STEP, TERRAIN_GRID_COUNT, TERRAIN_GRID_HALF } from './environment-geometry.js';

const TAU = Math.PI * 2;
const COLORS = { beach: '#e6d394', jungle: '#5aab70', volcano: '#c08d67', moon: '#839fa0', haven: '#81b57a' };
const WAYPOINTS = [SPAWN, ...SHRINES];
const ENTERABLE_IDS = new Set(BUILDINGS.filter(building => building.enterable).map(building => building.id));
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, t) => lerp(a, b, 1 - Math.exp(-t));

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}
function routeDistance(x, z) {
  let d = trailDistance(x, z);
  for (const point of WAYPOINTS) d = Math.min(d, segmentDistance(x, z, BEACON, point));
  return d;
}
function reserved(x, z, padding = 0) {
  if (routeDistance(x, z) < 6 + padding) return true;
  if (POINTS_OF_INTEREST.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + padding)) return true;
  if (BUILDINGS.some(b => Math.hypot(x - b.x, z - b.z) < b.radius + 2 + padding)) return true;
  if ([SPAWN, BEACON, ...SHRINES].some(p => Math.hypot(x - p.x, z - p.z) < 11 + padding)) return true;
  return CHESTS.some(p => Math.hypot(x - p.x, z - p.z) < 3.2 + padding);
}
function meshRing(radius, width, color, opacity = 1) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(Math.max(.01, radius - width), radius, 48),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
function makeBeam(color, height = 12, radius = .40) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(radius * .6, radius, height, 12, 1, true), material);
  column.position.y = height / 2; group.add(column);
  const ring = meshRing(1.12, .22, color, .95); ring.position.y = .16; ring.material.toneMapped = false; group.add(ring);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(.25, 0), new THREE.MeshBasicMaterial({ color }));
  star.position.y = 2.0; group.add(star);
  group.userData = { column, ring, star, baseHeight: height };
  return group;
}

function buildDefenseSupplies(palette, event) {
  const group = new THREE.Group(); group.name = 'supplies-' + event.id;
  group.position.set(event.x, heightAt(event.x, event.z), event.z);
  const batch = new GeoBatch(palette);
  const crate = (x, y, z, size) => {
    batch.add('box', [x, y + size * .42, z], [size * .9, size * .84, size * .8], [0, 0, 0], '#c49864');
    for (const h of [.08, .74]) batch.add('box', [x, y + size * h, z], [size * .96, size * .1, size * .86], [0, 0, 0], '#94633f');
    for (const side of [-1, 1]) {
      batch.line([x - size * .38, y + size * .12, z + side * size * .42], [x + size * .38, y + size * .7, z + side * size * .42], size * .045, '#94633f');
      batch.add('box', [x, y + size * .44, z + side * size * .425], [size * .16, size * .65, size * .025], [0, 0, 0], SIDE_EVENT_COLOR);
    }
  };
  crate(-.38, 0, .02, .85); crate(.38, 0, .08, .72); crate(-.3, .715, .02, .6);
  batch.line([.62, 0, -.34], [.62, 1.58, -.34], .035, '#123c51');
  group.add(batch.mesh());
  const pennantGeometry = new THREE.BufferGeometry();
  pennantGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    .65, 1.53, -.34, 1.15, 1.53, -.34, 1.03, 1.32, -.34, 1.15, 1.1, -.34, .65, 1.1, -.34,
  ], 3));
  pennantGeometry.setIndex([0, 1, 2, 0, 2, 4, 4, 2, 3]);
  pennantGeometry.computeBoundingSphere();
  group.add(new THREE.Mesh(pennantGeometry, new THREE.MeshBasicMaterial({ color: SIDE_EVENT_COLOR, side: THREE.DoubleSide, toneMapped: false })));
  return group;
}

function buildTerrain(palette) {
  const step = TERRAIN_GRID_STEP, count = TERRAIN_GRID_COUNT, span = TERRAIN_GRID_HALF * 2;
  const positions = [], colors = [], indices = [];
  const sand = new THREE.Color('#f1d89e'), darkSand = new THREE.Color('#d5c795');
  const path = new THREE.Color('#d6c28e'), rock = new THREE.Color('#947d66');
  const regionColors = Object.fromEntries(Object.entries(COLORS).map(([id, color]) => [id, new THREE.Color(color)]));
  for (let zi = 0; zi <= count; zi++) for (let xi = 0; xi <= count; xi++) {
    const x = xi * step - span / 2, z = zi * step - span / 2, y = heightAt(x, z);
    positions.push(x, y, z);
    const region = regionAt(x, z), base = (regionColors[region?.id] || regionColors.haven).clone();
    const grain = Math.sin(x * .51 + z * .34) * .016 + Math.sin(x * .22 - z * .67) * .014;
    if (y < 2.6) base.copy(sand).lerp(darkSand, clamp((2.6 - y) / 5, 0, .5));
    else if (region?.id === 'volcano') base.lerp(rock, clamp((y - 5.5) / 12, 0, .65));
    if (y > 2.0 && routeDistance(x, z) < 5.0) base.lerp(path, .72 * (1 - clamp((routeDistance(x, z) - 2.5) / 2.5, 0, 1)));
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 22) base.lerp(sand, .55);
    base.offsetHSL(0, 0, grain);
    colors.push(base.r, base.g, base.b);
    if (zi < count && xi < count) {
      const n = zi * (count + 1) + xi;
      if ((xi + zi) % 2) indices.push(n, n + count + 1, n + 1, n + 1, n + count + 1, n + count + 2);
      else indices.push(n, n + count + 2, n + 1, n, n + count + 1, n + count + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, palette.solid); mesh.receiveShadow = true;
  return mesh;
}

function buildOcean(palette, random) {
  const group = new THREE.Group();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800, 64, 64), new THREE.MeshPhongMaterial({
    color: '#168eaf', specular: '#8cdce0', shininess: 35, transparent: false, flatShading: true,
  }));
  water.rotation.x = -Math.PI / 2; water.position.y = -.05;
  const waveUniform = { value: 0 };
  water.material.onBeforeCompile = shader => {
    shader.uniforms.uSkywakeTime = waveUniform;
    shader.vertexShader = 'uniform float uSkywakeTime;\n' + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed.z += sin(position.x * .028 + uSkywakeTime * .6) * .12 + cos(position.y * .031 - uSkywakeTime * .48) * .08;');
  };
  group.add(water);
  const foamPositions = [], foamIndices = [];
  for (let i = 0; i <= 240; i++) {
    const a = i / 240 * TAU, dx = Math.sin(a), dz = Math.cos(a);
    let lo = 100, hi = 150;
    for (let j = 0; j < 12; j++) {
      const mid = (lo + hi) / 2;
      if (heightAt(dx * mid, dz * mid) > .10) lo = mid; else hi = mid;
    }
    const r = (lo + hi) / 2 + .5, width = .55 + .3 * Math.sin(a * 17);
    foamPositions.push(dx * r, .07, dz * r, dx * (r + width), .07, dz * (r + width));
    if (i < 240) { const n = i * 2; foamIndices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
  }
  const foamGeo = new THREE.BufferGeometry(); foamGeo.setAttribute('position', new THREE.Float32BufferAttribute(foamPositions, 3)); foamGeo.setIndex(foamIndices);
  const foam = new THREE.Mesh(foamGeo, new THREE.MeshBasicMaterial({ color: '#c0f4e2', transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false }));
  group.add(foam);
  const highlights = new GeoBatch(palette, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .34, depthWrite: false }));
  for (let i = 0; i < 200; i++) {
    const a = random() * TAU, r = 143 + random() * 430;
    highlights.add('sphere', [Math.sin(a) * r, .03, Math.cos(a) * r], [1 + random() * 5, .035, .18 + random() * .30], [0, -.55, 0], i % 3 ? '#73d6dd' : '#b8eeec');
  }
  const glints = highlights.mesh({ shadow: false }); group.add(glints);
  return { group, animate(time) { waveUniform.value = time; foam.material.opacity = .54 + Math.sin(time * 1.3) * .10; glints.position.x = Math.sin(time * .2) * 1.5; } };
}

export function buildScenery(palette, random) {
  const group = new THREE.Group(), land = new GeoBatch(palette), luminous = new GeoBatch(palette, palette.glow);
  const oldWatchDecoration = new GeoBatch(palette), farmDecoration = new GeoBatch(palette);
  const tideglassDecoration = new GeoBatch(palette), tideglassHuts = new GeoBatch(palette), tideglassHutSites = [], saltwindDecoration = new GeoBatch(palette);
  const driftwoodDecoration = new GeoBatch(palette), sunwakeLanding = new GeoBatch(palette), palmheartDecoration = new GeoBatch(palette);
  const cinderworksDecoration = new GeoBatch(palette);
  for (const obstacle of OBSTACLES) {
    if (obstacle.type === 'landmark' || obstacle.type === 'building' || obstacle.pilot === 'old-watch') continue;
    const { x, z } = obstacle, y = heightAt(x, z), region = regionAt(x, z)?.id;
    if (obstacle.type === 'tree') {
      const size = clamp((obstacle.height || 7) / 7, .7, 1.5);
      if (region === 'moon') addBroadTree(land, x, y, z, size, true, random() * TAU);
      else if (region === 'jungle') addBroadTree(palmheartWeight(x, z) > 0 ? palmheartDecoration : land, x, y, z, size, false, random() * TAU);
      else addPalm(land, x, y, z, size, random() * TAU);
    } else if (obstacle.type === 'hut') {
      const yaw = random() * .5, tideglass = obstacle.id === 'prop-16' || obstacle.id === 'prop-17';
      // Keep the original yaw draw and geometry generation in their RNG order.
      addHut(tideglass ? tideglassHuts : land, x, y, z, clamp((obstacle.radius || 2) / 2, .9, 1.6), yaw);
      if (tideglass) tideglassHutSites.push({ ...obstacle, yaw });
    }
    else {
      const radius = obstacle.radius || 1.6, h = obstacle.height || 2;
      const rocks = cinderworksWeight(x, z) > 0 ? cinderworksDecoration : land;
      rocks.add('pebble', [x, y + h * .42, z], [radius, h * .65, radius * .9], [.1, random() * TAU, .15], region === 'volcano' ? '#7f6860' : '#8fa79a');
      rocks.add('pebble', [x + radius * .35, y + h * .72, z], [radius * .56, h * .37, radius * .65], [.1, .4, -.1], region === 'volcano' ? '#b98468' : '#b9bc9b');
    }
  }
  // Decorative trees stay clear of the routes. Collidable silhouettes above
  // correspond exactly to shared OBSTACLES; these smaller bases are walkable.
  for (let i = 0; i < 245; i++) {
    const a = random() * TAU, radius = Math.sqrt(random()) * 124;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius, y = heightAt(x, z);
    if (y < 1.7 || reserved(x, z, 1.2) || OBSTACLES.some(o => o.pilot !== 'old-watch' && Math.hypot(x - o.x, z - o.z) < o.radius + 3)) continue;
    const region = regionAt(x, z)?.id, size = .58 + random() * .40;
    // Route completed-area detail after all original rejection/RNG decisions.
    const decoration = oldWatchWeight(x, z) > 0 ? oldWatchDecoration : windwardFarmWeight(x, z) > 0 ? farmDecoration : palmheartWeight(x, z) > 0 ? palmheartDecoration : cinderworksWeight(x, z) > 0 ? cinderworksDecoration : land;
    if (region === 'moon') {
      if (i % 3 === 0) addBroadTree(decoration, x, y, z, size, true, a);
      else addMushroom(decoration, x, y, z, size * (i % 4 === 0 ? 1.55 : 1), a);
    } else if (region === 'volcano') {
      if (i % 3 === 0) addCrystal(decoration, x, y, z, size, a, '#f0b168');
      else decoration.add('pebble', [x, y + size * .8, z], [size * 1.3, size * 1.2, size], [.3, a, .1], i % 2 ? '#966e61' : '#bd8c6b');
    } else if (region === 'jungle' && i % 3 !== 0) addBroadTree(decoration, x, y, z, size, false, a);
    else addPalm(decoration, x, y, z, size, a, region === 'jungle');
  }
  for (let i = 0; i < 720; i++) {
    const x = (random() - .5) * 254, z = (random() - .5) * 254, y = heightAt(x, z);
    if (y < 2 || reserved(x, z, .2)) continue;
    const region = regionAt(x, z)?.id, s = .30 + random() * .5;
    // Only small ground plants are replaced here. The coastal palm canopy above
    // keeps its original geometry, density, positions and RNG consumption.
    const decoration = oldWatchWeight(x, z) > 0 ? oldWatchDecoration : windwardFarmWeight(x, z) > 0 ? farmDecoration : palmheartWeight(x, z) > 0 ? palmheartDecoration : cinderworksWeight(x, z) > 0 ? cinderworksDecoration : tideglassWeight(x, z) > .08 ? tideglassDecoration : saltwindHarborWeight(x, z) > .08 ? saltwindDecoration : driftwoodWeight(x, z) > .08 ? driftwoodDecoration : land;
    if (region === 'volcano') decoration.add('pebble', [x, y + .18 * s, z], [s, .45 * s, .65 * s], [0, random() * TAU, 0], '#bb9876');
    else {
      const color = region === 'moon' ? '#a599c8' : i % 3 === 0 ? '#91b773' : '#579868';
      decoration.add('sphere', [x, y + .30 * s, z], [s, .66 * s, s * .85], [0, random() * TAU, 0], color);
      if (i % 4 === 0) for (let j = 0; j < 3; j++) {
        const ox = Math.sin(j * 2.4) * .25, oz = Math.cos(j * 2.4) * .25;
        decoration.add('sphere', [x + ox, y + .58 * s, z + oz], [.13, .12, .13], [0, 0, 0], region === 'moon' ? '#b8f2e8' : '#ffe1a5');
      }
    }
  }
  // The caldera is a crescent behind the shrine; its south face stays open.
  const volcano = SHRINES.find(s => s.id === 'ember') || { x: 48, z: -65 };
  for (let i = 0; i < 18; i++) {
    const a = -.45 * Math.PI + i / 17 * .9 * Math.PI;
    const x = volcano.x + Math.sin(a) * (15 + random() * 3), z = volcano.z - Math.cos(a) * (17 + random() * 3), y = heightAt(x, z), h = 5 + random() * 6;
    land.add('pebble', [x, y + h * .36, z], [3.8, h * .62, 3.5], [.10, a, -.08], i % 2 ? '#9b6d5a' : '#bd795e');
    land.add('cone', [x, y + h * .9, z], [2.4, h * .45, 2.2], [0, a, -.08], '#d7956d');
    if (i % 3 === 0) addCrystal(luminous, x + 1, y + .2, z + 1.8, 1.1, a, '#ffd276');
  }
  const coreX = volcano.x, coreZ = volcano.z - 22, coreY = heightAt(coreX, coreZ);
  luminous.add('sphere', [coreX, coreY + .30, coreZ], [5.0, .50, 4.0], [0, 0, 0], '#f8b968');
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU;
    land.add('pebble', [coreX + Math.sin(a) * 5.2, coreY + 1.1, coreZ + Math.cos(a) * 4.2], [1.8, 1.7, 1.8], [0, a, .2], '#816465');
  }
  const moon = SHRINES.find(s => s.id === 'moon') || { x: 76, z: 32 };
  for (const [dx, dz, s] of [[-14, -12, 2.1], [15, -9, 2.6], [18, 11, 1.8], [-9, 16, 1.6]]) {
    const x = moon.x + dx, z = moon.z + dz;
    if (POINTS_OF_INTEREST.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + s * 1.65)) continue;
    addMushroom(land, x, heightAt(x, z), z, s, random() * TAU);
  }
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * TAU, x = moon.x + Math.sin(a) * 13.7, z = moon.z + Math.cos(a) * 13.7;
    if (routeDistance(x, z) > 6) addCrystal(luminous, x, heightAt(x, z), z, .7 + random() * .6, a, '#a1e8e5');
  }
  const gateX = moon.x + 2, gateZ = moon.z - 13, gateY = heightAt(gateX, gateZ);
  land.add('ring', [gateX, gateY + 4.7, gateZ], [3.9, 3.9, 3.9], [0, -.45, -.18], '#c3afd8');
  land.add('sphere', [gateX + 2.4, gateY + 6.8, gateZ], [.75, .75, .75], [0, 0, 0], '#dbd4e5');
  const palm = SHRINES.find(s => s.id === 'palm') || { x: -68, z: 12 };
  for (const dx of [-4.8, 4.8]) {
    const x = palm.x + dx, z = palm.z - 11, y = heightAt(x, z);
    land.add('box', [x, y + 2.6, z], [2.1, 5.2, 2.1], [0, dx * .01, .04], '#7c9a83');
    land.add('box', [x, y + 5.5, z], [2.7, .8, 2.7], [0, -.04, 0], '#b2b98d');
    land.add('sphere', [x + .3, y + 5.95, z], [1.7, .35, 1.4], [0, 0, 0], '#4c9164');
  }
  land.add('box', [palm.x, heightAt(palm.x, palm.z - 11) + 6.35, palm.z - 11], [11.5, 1.1, 2.0], [0, 0, -.035], '#a5b58b');
  // Keep the lighthouse behind the open interaction dais and finale arena.
  addLighthouse(land, BEACON.x, heightAt(BEACON.x, BEACON.z - 24), BEACON.z - 24);
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU, x = BEACON.x + Math.sin(a) * 12, z = BEACON.z + Math.cos(a) * 12;
    if (routeDistance(x, z) > 4.8 && z > BEACON.z - 4) land.add('cylinder', [x, heightAt(x, z) + .32, z], [.55, .64, .55], [0, 0, 0], '#ced0ad');
  }
  // The landing dock, its pennant line and the crates are the strand's own
  // fallback; the authored kit hides this batch and keeps their geometry.
  const dockZ = SPAWN.z + 26;
  for (let i = 0; i < 16; i++) {
    const z = dockZ - 5 + i * .80, y = Math.max(.75, heightAt(SPAWN.x, z) + .12);
    sunwakeLanding.add('box', [SPAWN.x, y, z], [4.4, .18, .66], [0, .015 * Math.sin(i), 0], i % 3 ? '#ae8054' : '#c19360');
    if (i % 4 === 0) for (const side of [-1, 1]) sunwakeLanding.add('cylinder', [SPAWN.x + side * 2.05, y - .3, z], [.16, 2.6, .16], [0, 0, .04], '#806144');
  }
  for (const dx of [-7, 7]) {
    const x = SPAWN.x + dx, z = SPAWN.z + 7, y = heightAt(x, z);
    sunwakeLanding.line([x, y, z], [x, y + 5, z], .13, '#a27648');
  }
  const flagY = heightAt(SPAWN.x, SPAWN.z + 7) + 4.8;
  sunwakeLanding.line([SPAWN.x - 7, flagY, SPAWN.z + 7], [SPAWN.x + 7, flagY, SPAWN.z + 7], .032, '#bea978');
  for (let i = 0; i < 9; i++) sunwakeLanding.add('cone', [SPAWN.x - 5.8 + i * 1.45, flagY - .35, SPAWN.z + 7], [.40, .85, .07], [Math.PI, 0, 0], ['#ea8c69', '#f4d177', '#69b8b5'][i % 3]);
  for (const [x, z, s] of SUNWAKE_LANDING_CRATE_CANDIDATES) {
    if (POINTS_OF_INTEREST.some(p => Math.hypot(x - p.x, z - p.z) < p.radius)) continue;
    const y = heightAt(x, z);
    sunwakeLanding.add('box', [x, y + .6 * s, z], [1.4 * s, 1.2 * s, 1.3 * s], [0, .2, 0], '#a97b4b');
    for (const dy of [.12, 1.03]) sunwakeLanding.add('box', [x, y + dy * s, z], [1.46 * s, .12 * s, 1.36 * s], [0, .2, 0], '#dab174');
  }
  for (let i = 0; i < 35; i++) {
    const a = random() * TAU, r = 112 + random() * 10, x = Math.sin(a) * r, z = Math.cos(a) * r, y = heightAt(x, z);
    if (y < .2 || y > 3 || reserved(x, z, 1)) continue;
    for (let k = 0; k < 3; k++) {
      const h = .4 + random() * .9;
      land.line([x + k * .23, y, z], [x + k * .32, y + h, z + .05], .13, i % 2 ? '#efa593' : '#ccb2cb', .6);
      land.line([x + k * .28, y + h * .55, z], [x + k * .28 + .28, y + h * .9, z + .18], .08, '#eab6b0', .5);
    }
  }
  group.add(land.mesh(), luminous.mesh({ shadow: false }));
  const legacyVegetation = oldWatchDecoration.mesh(); legacyVegetation.name = 'old-watch-original-vegetation'; group.add(legacyVegetation);
  const farmLegacyVegetation = farmDecoration.mesh(); farmLegacyVegetation.name = 'windward-farm-original-vegetation'; group.add(farmLegacyVegetation);
  const tideglassLegacyVegetation = tideglassDecoration.mesh(); tideglassLegacyVegetation.name = 'tideglass-market-original-vegetation'; group.add(tideglassLegacyVegetation);
  const tideglassHutFallback = tideglassHuts.mesh(); tideglassHutFallback.name = 'tideglass-market-original-haven-huts'; group.add(tideglassHutFallback);
  const saltwindLegacyVegetation = saltwindDecoration.mesh(); saltwindLegacyVegetation.name = 'saltwind-harbor-original-vegetation'; group.add(saltwindLegacyVegetation);
  const driftwoodLegacyVegetation = driftwoodDecoration.mesh(); driftwoodLegacyVegetation.name = 'driftwood-yard-original-vegetation'; group.add(driftwoodLegacyVegetation);
  const sunwakeLandingFallback = sunwakeLanding.mesh(); sunwakeLandingFallback.name = 'sunwake-strand-original-landing'; group.add(sunwakeLandingFallback);
  const palmheartLegacyVegetation = palmheartDecoration.mesh(); palmheartLegacyVegetation.name = 'palmheart-wilds-original-vegetation'; group.add(palmheartLegacyVegetation);
  const cinderworksLegacyScenery = cinderworksDecoration.mesh(); cinderworksLegacyScenery.name = 'cinderworks-original-scenery'; group.add(cinderworksLegacyScenery);
  group.userData.tideglassHutSites = tideglassHutSites;
  return { group, legacyVegetation, farmLegacyVegetation, tideglassLegacyVegetation, tideglassHutFallback, tideglassHutSites, saltwindLegacyVegetation,
    driftwoodLegacyVegetation, sunwakeLandingFallback, palmheartLegacyVegetation, cinderworksLegacyScenery, volcano: { x: coreX, y: coreY + 3, z: coreZ }, moon };
}

function buildSky(palette, random) {
  const group = new THREE.Group(), b = new GeoBatch(palette, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  for (let i = 0; i < 25; i++) {
    const a = i / 25 * TAU, r = 265 + random() * 180, x = Math.sin(a) * r, z = Math.cos(a) * r, y = 72 + random() * 62, s = 8 + random() * 12;
    for (let j = 0; j < 4; j++) b.add('sphere', [x + (j - 1.5) * s * .65, y + Math.sin(j) * s * .2, z], [s, s * (.38 + random() * .2), s * .5], [0, a, 0], j % 2 ? '#e9f7ed' : '#f7faf0');
  }
  group.add(b.mesh({ shadow: false }));
  const birds = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group(), wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1.3, .30, .15, .5, -.05, .38, 0, 0, 0, -1.3, .30, .15, -.5, -.05, .38], 3));
    const mesh = new THREE.Mesh(wing, new THREE.MeshBasicMaterial({ color: '#edf8ec', side: THREE.DoubleSide })); g.add(mesh); group.add(g);
    birds.push({ group: g, mesh, phase: random() * TAU, radius: 52 + random() * 70, height: 24 + random() * 25 });
  }
  return { group, animate(time) {
    for (const bird of birds) {
      const a = time * .033 + bird.phase;
      bird.group.position.set(Math.sin(a) * bird.radius, bird.height + Math.sin(time * .4 + bird.phase) * 1.2, Math.cos(a) * bird.radius);
      bird.group.rotation.y = -a; bird.mesh.scale.y = .7 + Math.sin(time * 4 + bird.phase) * .45;
    }
  } };
}

function disposeObject(object, preserveMaterials = new Set()) {
  const geometries = new Set(), materials = new Set();
  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (!preserveMaterials.has(material)) materials.add(material);
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
  object.removeFromParent();
}

export function createWorld(canvas, { quality = 'high' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = quality !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#85d9ee'); scene.fog = new THREE.Fog('#a2def0', 180, 610);
  const camera = new THREE.PerspectiveCamera(53, 1, .12, 1100);
  const palette = makePalette(), preserve = new Set([palette.solid, palette.glow]);
  const random = seededRandom(SEED);
  const hemisphere = new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2); scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#fff0d0', 2.7); sun.position.set(-70, 140, 80); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.00025; sun.shadow.normalBias = .06;
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 10, far: 360 });
  sun.shadow.camera.updateProjectionMatrix(); scene.add(sun, sun.target);
  scene.add(buildTerrain(palette));
  const ocean = buildOcean(palette, random), scenery = buildScenery(palette, random), sky = buildSky(palette, random);
  scene.add(ocean.group, scenery.group, sky.group);
  const settlements = buildSettlements(palette), reducedMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  scene.add(settlements.group);
  const environmentAssets = createEnvironmentAssets(), environmentLighting = createEnvironmentLighting({ scene, hemisphere, sun });
  const oldWatch = createOldWatch({ scene, settlements, assets: environmentAssets, legacyVegetation: scenery.legacyVegetation });
  const windwardFarm = createWindwardFarm({ scene, settlements, assets: environmentAssets, legacyVegetation: scenery.farmLegacyVegetation });
  const tideglassMarket = createTideglassMarket({ scene, settlements, assets: environmentAssets, legacyVegetation: scenery.tideglassLegacyVegetation, hutSites: scenery.tideglassHutSites, hutFallback: scenery.tideglassHutFallback });
  const saltwindHarbor = createSaltwindHarbor({ scene, settlements, assets: environmentAssets, legacyVegetation: scenery.saltwindLegacyVegetation });
  const driftwoodYard = createDriftwoodYard({ scene, settlements, assets: environmentAssets, legacyVegetation: scenery.driftwoodLegacyVegetation, landingFallback: scenery.sunwakeLandingFallback });
  const palmheartCamp = createPalmheartCamp({ scene, settlements, assets: environmentAssets, legacyVegetation: scenery.palmheartLegacyVegetation });
  const cinderworks = createCinderworks({ scene, settlements, assets: environmentAssets, legacyScenery: scenery.cinderworksLegacyScenery });
  const ship = buildGalleon(palette); scene.add(ship.group);
  const players = new Map(), enemies = new Map(), chestModels = new Map(), shrineModels = new Map(), sideEventModels = new Map(), pingModels = new Map(), dropModels = new Map();
  const effects = [], pendingSurges = [], telegraphs = new Map(), discharges = new Map(), pendingImpacts = new Map();
  const remotePlayers = createRemoteInterpolation();
  let elapsed = 0, clockTime = 0, latestState = null, latestLocal = null, latestView = {}, disposed = false, cameraReady = false;
  let cameraShipPose = null, cameraFollowPose = null;
  let width = 1, height = 1, frameCount = 0, fps = 60, fpsElapsed = 0, lowQuality = quality === 'low';
  const direction = new THREE.Vector3(), right = new THREE.Vector3(), desiredCamera = new THREE.Vector3(), cameraTarget = new THREE.Vector3();
  const projectVector = new THREE.Vector3(), raycaster = new THREE.Raycaster();
  const cabinBounds = new THREE.Box3(new THREE.Vector3(-3.55, 0, 6.10), new THREE.Vector3(3.55, 2.85, 10.85));
  const cabinNearBounds = cabinBounds.clone().expandByScalar(.4);
  const cabinCamera = new THREE.Vector3(), cabinTorso = new THREE.Vector3(), cabinHit = new THREE.Vector3(), cabinRay = new THREE.Ray();

  for (const chest of CHESTS) {
    const model = buildChest(palette), beam = makeBeam('#ffd473', 7, .26);
    model.group.position.set(chest.x, heightAt(chest.x, chest.z), chest.z);
    model.group.rotation.y = .2 + random() * TAU;
    beam.position.copy(model.group.position); scene.add(model.group, beam);
    chestModels.set(chest.id, { ...model, beam, opened: false });
  }
  for (const shrine of SHRINES) {
    const color = shrine.color || REGIONS.find(r => r.id === shrine.region)?.accent || '#f8d778';
    const model = buildShrine(palette, color), beam = makeBeam('#ffd16c', 18, .7);
    const availableRing = createObjectiveMarker({ ...shrine, radius: 4, name: 'shrine-available-' + shrine.id });
    const activeRing = createObjectiveMarker({ ...shrine, radius: 9, name: 'shrine-active-' + shrine.id });
    model.group.position.set(shrine.x, heightAt(shrine.x, shrine.z), shrine.z);
    beam.position.copy(model.group.position); activeRing.visible = false;
    scene.add(model.group, beam, availableRing, activeRing); shrineModels.set(shrine.id, { ...model, beam, availableRing, activeRing });
  }
  const beaconModel = buildShrine(palette, '#ffd36e'), beaconBeam = makeBeam('#ffe292', 35, .85);
  beaconModel.group.position.set(BEACON.x, heightAt(BEACON.x, BEACON.z), BEACON.z);
  beaconBeam.position.copy(beaconModel.group.position); scene.add(beaconModel.group, beaconBeam);
  const beaconHalo = createObjectiveMarker({ ...BEACON, radius: 4, name: 'beacon-interaction-ring' }); scene.add(beaconHalo);
  for (const event of SIDE_EVENTS) {
    const group = buildDefenseSupplies(palette, event), beam = makeBeam(SIDE_EVENT_COLOR, 5.5, .19);
    const availableRing = createObjectiveMarker({ ...event, radius: event.interactionRange, coreColor: SIDE_EVENT_COLOR, haloColor: SIDE_EVENT_COLOR, name: 'side-event-available-' + event.id });
    const activeRing = createObjectiveMarker({ ...event, radius: event.radius, coreColor: SIDE_EVENT_COLOR, haloColor: SIDE_EVENT_COLOR, name: 'side-event-active-' + event.id });
    beam.name = 'side-event-beam-' + event.id; beam.position.copy(group.position); beam.userData.star.visible = false;
    group.visible = beam.visible = availableRing.visible = activeRing.visible = false;
    scene.add(group, beam, availableRing, activeRing); sideEventModels.set(event.id, { group, beam, availableRing, activeRing });
  }
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(.8, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff1b0' }));
  lantern.position.set(BEACON.x, heightAt(BEACON.x, BEACON.z - 24) + 26, BEACON.z - 24); scene.add(lantern);
  const lighthouseRay = new THREE.Mesh(new THREE.ConeGeometry(8, 62, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#fff1be', transparent: true, opacity: .065, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  lighthouseRay.geometry.translate(0, -31, 0); lighthouseRay.rotation.z = Math.PI / 2;
  const lighthousePivot = new THREE.Group(); lighthousePivot.position.copy(lantern.position); lighthousePivot.add(lighthouseRay); scene.add(lighthousePivot);
  const atmospheric = new THREE.Group(); scene.add(atmospheric);
  const motes = [];
  for (let i = 0; i < 34; i++) {
    const isEmber = i < 12, center = isEmber ? scenery.volcano : { x: scenery.moon.x, y: heightAt(scenery.moon.x, scenery.moon.z) + 2, z: scenery.moon.z };
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(isEmber ? .13 : .08, 0), new THREE.MeshBasicMaterial({ color: isEmber ? '#ffd496' : '#c4fff2', transparent: true, opacity: .8, depthWrite: false }));
    atmospheric.add(mesh); motes.push({ mesh, center, phase: random() * TAU, radius: isEmber ? 3 + random() * 3 : 4 + random() * 12, rise: random() * 5, ember: isEmber });
  }

  function removeEffect(effect) {
    effect.cleanup?.(); disposeObject(effect.object, preserve);
  }
  function addEffect(object, life, update, cleanup) {
    scene.add(object); effects.push({ object, life, age: 0, update, cleanup });
    if (effects.length > 120) removeEffect(effects.shift());
    return object;
  }
  function burst(x, y, z, color, count = 12, scale = 1) {
    const geometry = new THREE.BufferGeometry(), positions = [], velocities = [];
    for (let i = 0; i < count; i++) {
      positions.push(0, 0, 0);
      const a = Math.random() * TAU, speed = (.8 + Math.random() * 2.5) * scale;
      velocities.push(Math.sin(a) * speed, (1.5 + Math.random() * 2.5) * scale, Math.cos(a) * speed);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: .14 * scale, transparent: true, opacity: 1, depthWrite: false, sizeAttenuation: true }));
    points.position.set(x, y, z);
    addEffect(points, .9, (fx, age) => {
      const p = fx.geometry.attributes.position;
      for (let i = 0; i < count; i++) p.setXYZ(i, velocities[i * 3] * age, velocities[i * 3 + 1] * age - 3 * age * age, velocities[i * 3 + 2] * age);
      p.needsUpdate = true; fx.material.opacity = Math.max(0, 1 - age / .9);
    });
  }
  function pulse(x, z, color, radius = 5, duration = .7) {
    const ring = meshRing(1, .06, color, .8); ring.position.set(x, heightAt(x, z) + .14, z);
    addEffect(ring, duration, (object, age) => { object.scale.setScalar(.3 + radius * age / duration); object.material.opacity = (1 - age / duration) * .85; });
  }
  // A surge's spawns break the surface one rank at a time; each spawn's foam
  // waits for its own delay instead of firing all at once with the event.
  function scheduleSurge(delay, fn) { pendingSurges.push({ at: clockTime + Math.max(0, delay || 0), fn }); }
  function speechPop(text, x, y, z, color = '#ffe7a6') {
    const surface = document.createElement('canvas'); surface.width = 256; surface.height = 128;
    const context = surface.getContext('2d'); if (!context) return;
    context.font = 'bold 58px Trebuchet MS, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.lineWidth = 10; context.strokeStyle = '#224659'; context.strokeText(String(text), 128, 64); context.fillStyle = color; context.fillText(String(text), 128, 64);
    const texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })); sprite.position.set(x, y, z); sprite.scale.set(2.7, 1.35, 1);
    addEffect(sprite, .85, (object, age) => { object.position.y = y + age * 1.8; object.material.opacity = clamp((.85 - age) * 3, 0, 1); });
  }
  function makeTelegraph(event) {
    if (!Number.isFinite(event.x) || !Number.isFinite(event.z)) return;
    const radius = event.radius || 3, group = new THREE.Group(), ring = meshRing(radius, .13, '#ffbd79', .9);
    group.add(ring);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), new THREE.MeshBasicMaterial({ color: '#f49468', transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false })); fill.rotation.x = -Math.PI / 2; group.add(fill);
    group.position.set(event.x, heightAt(event.x, event.z) + .11, event.z);
    const duration = clamp(event.duration || .8, .2, 4);
    addEffect(group, duration, (object, age) => { ring.material.opacity = .6 + Math.sin(age * 24) * .3; fill.material.opacity = .08 + .25 * (age / duration); });
    if (event.id) telegraphs.set(event.id, clockTime + duration);
  }

  function showHit(event) {
    const target = enemies.get(event.targetId) || players.get(event.targetId);
    const x = event.x ?? target?.group.position.x, y = event.y ?? (target?.group.position.y || 0) + 1, z = event.z ?? target?.group.position.z;
    if ([x, y, z].every(Number.isFinite)) {
      burst(x, y, z, '#ffe9bd', 8, .75);
      if (event.damage) speechPop(Math.round(event.damage), x, y + .8, z);
    }
    if (target) target.flashUntil = clockTime + .13;
  }
  function muzzleEffects(model, from, shotDirection) {
    const flash = new THREE.Group(); flash.name = 'muzzle-flash';
    const amber = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color: '#ffc05a', transparent: true, opacity: .85, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color: '#fff8cf', transparent: true, opacity: 1, depthWrite: false, toneMapped: false }));
    amber.scale.set(.23, .55, .23); amber.position.y = .28;
    core.scale.set(.12, .34, .12); core.position.y = .19;
    flash.add(amber, core); flash.position.copy(from); flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shotDirection);
    addEffect(flash, .08, (object, age) => {
      if (model?.group.parent) model.getMuzzle?.(object.position);
      const fade = 1 - age / .08; amber.material.opacity = fade * .85; core.material.opacity = fade;
      object.scale.setScalar(.75 + fade * .3);
    });
    const smoke = new THREE.Group(); smoke.name = 'muzzle-smoke'; smoke.position.copy(from);
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? '#eee1bd' : '#b9c1b6', transparent: true, opacity: .27, depthWrite: false }));
      puff.userData.velocity = shotDirection.clone().multiplyScalar(.8 + i * .4).add(new THREE.Vector3((i - 1) * .17, .45 + i * .12, 0));
      puff.scale.setScalar(.09); smoke.add(puff);
    }
    addEffect(smoke, .48, (object, age) => {
      object.children.forEach((puff, index) => {
        puff.position.copy(puff.userData.velocity).multiplyScalar(age);
        puff.scale.setScalar(.09 + age * (.52 + index * .13)); puff.material.opacity = .27 * (1 - age / .48);
      });
    });
  }
  function impactRing(point, direction) {
    const ring = meshRing(.22, .075, '#ffe7a0', .9); ring.name = 'bullet-impact';
    ring.position.copy(point); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    addEffect(ring, .18, (object, age) => { object.scale.setScalar(1 + age * 7); object.material.opacity = .9 * (1 - age / .18); });
  }
  function showShot(event) {
    const model = players.get(event.playerId), from = new THREE.Vector3(), to = new THREE.Vector3(event.to.x, event.to.y, event.to.z);
    from.set(event.from.x, event.from.y, event.from.z);
    if (model?.getMuzzle) model.getMuzzle(from);
    const flight = makeTracerFlight(from, to, event.weapon);
    if (!flight) return;
    const shotDirection = to.clone().sub(from).normalize();
    const shotTime = typeof performance === 'undefined' ? clockTime : performance.now() / 1000;
    const previous = discharges.get(event.playerId);
    if (!previous || previous.weapon !== event.weapon || shotTime - previous.time >= .08) {
      model?.fire?.(event.weapon); muzzleEffects(model, from, shotDirection);
      discharges.set(event.playerId, { weapon: event.weapon, time: shotTime });
    }
    const tracer = new THREE.Group(); tracer.name = 'bullet-tracer';
    tracer.userData = { kind: 'tracer', playerId: event.playerId, weapon: event.weapon, from: { ...from }, to: { ...to }, duration: flight.duration };
    tracer.position.copy(from); tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shotDirection);
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(.085, .055, 1, 7), new THREE.MeshBasicMaterial({ color: '#ffbf4a', transparent: true, opacity: .6, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(.033, .024, 1, 6), new THREE.MeshBasicMaterial({ color: '#fff3ba', transparent: true, opacity: 1, depthWrite: false, toneMapped: false }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: '#fffbdc', transparent: true, opacity: 1, depthWrite: false, toneMapped: false }));
    outer.name = 'tracer-amber-trail'; core.name = 'tracer-pale-core'; head.name = 'tracer-moving-head'; head.scale.set(.11, .18, .11);
    tracer.add(outer, core, head);
    const impact = { key: `${event.playerId}:${event.hitId}`, hit: null };
    if (event.hitId) {
      const queue = pendingImpacts.get(impact.key) || []; queue.push(impact); pendingImpacts.set(impact.key, queue);
    }
    function forgetImpact() {
      const queue = pendingImpacts.get(impact.key);
      if (!queue) return;
      const index = queue.indexOf(impact); if (index >= 0) queue.splice(index, 1);
      if (!queue.length) pendingImpacts.delete(impact.key);
    }
    let arrived = false;
    function animateTracer(object, age) {
      const pose = sampleTracerFlight(flight, age), length = Math.max(.001, pose.head - pose.tail);
      outer.position.y = core.position.y = (pose.head + pose.tail) * .5;
      outer.scale.y = core.scale.y = length; head.position.y = pose.head;
      outer.material.opacity = pose.opacity * .65; core.material.opacity = head.material.opacity = pose.opacity;
      if (pose.arrived && !arrived) {
        arrived = true;
        if (event.hitId) {
          impactRing(to, shotDirection); if (impact.hit) showHit(impact.hit); else burst(to.x, to.y, to.z, '#ffe9b8', 7, .7);
        }
        forgetImpact();
      }
    }
    animateTracer(tracer, 0);
    addEffect(tracer, flight.duration + flight.fade, animateTracer, forgetImpact);
  }

  function handleEvent(event) {
    if (!event || disposed) return;
    // A new phase (finale start, victory, restart) drops any surge foam still
    // waiting on its delay, so a fresh round never pops old ranks late.
    if (event.kind === 'phase') pendingSurges.length = 0;
    if (event.kind === 'shot' && event.from && event.to) {
      if (![event.from.x, event.from.y, event.from.z, event.to.x, event.to.y, event.to.z].every(Number.isFinite)) return;
      showShot(event);
    } else if (event.kind === 'hit') {
      const pending = pendingImpacts.get(`${event.sourceId}:${event.targetId}`)?.find(impact => !impact.hit);
      if (pending) pending.hit = event; else showHit(event);
    } else if (event.kind === 'defeated') {
      if (Number.isFinite(event.x)) {
        const boss = event.type === 'tempest', mini = event.type === 'tidebreaker';
        burst(event.x, (event.y || heightAt(event.x, event.z)) + .8, event.z, boss ? '#f4d582' : mini ? '#bfe9f6' : '#f2b789', boss ? 55 : mini ? 34 : 19, boss ? 3.5 : mini ? 2.3 : 1.4);
        pulse(event.x, event.z, mini ? '#a9ecff' : '#ffdb8a', boss ? 12 : mini ? 5 : 2.5);
      }
    } else if (event.kind === 'chest') {
      const chest = CHESTS.find(c => c.id === event.id);
      if (chest) { burst(chest.x, heightAt(chest.x, chest.z) + 1, chest.z, '#ffe295', 23, 1.8); speechPop('+' + (event.pearls || 10), chest.x, heightAt(chest.x, chest.z) + 2, chest.z); pulse(chest.x, chest.z, '#ffe193', 3); }
    } else if (event.kind === 'loot') {
      const player = latestState?.players?.find(p => p.id === event.playerId);
      if (player) pulse(player.x, player.z, RARITIES[event.rarity]?.color || '#aebbc5', 1.8, .6);
    } else if (event.kind === 'salvage') {
      // The spare gun turns into pearls where it lay (the drop stays for the crew).
      const at = latestState?.drops?.find(d => d.id === event.id) || latestState?.players?.find(p => p.id === event.playerId);
      if (at && Number.isFinite(at.x) && Number.isFinite(at.z)) {
        const y = Number.isFinite(at.y) ? at.y : heightAt(at.x, at.z);
        burst(at.x, y + 1, at.z, '#ffe295', 14, 1.2); speechPop('+' + (event.pearls || 0), at.x, y + 2, at.z); pulse(at.x, at.z, '#ffe193', 2);
      }
    } else if (event.kind === 'shrine') {
      const shrine = SHRINES.find(s => s.id === event.id);
      if (shrine) { pulse(shrine.x, shrine.z, shrine.color || '#b9f0d7', 10, 1.6); if (event.status === 'cleared') burst(shrine.x, heightAt(shrine.x, shrine.z) + 2.5, shrine.z, '#fce49d', 40, 2.5); }
    } else if (event.kind === 'heal' || event.kind === 'revive') {
      const player = latestState?.players?.find(p => p.id === event.playerId);
      if (player) { pulse(player.x, player.z, '#9ef5c5', event.kind === 'heal' ? 9 : 3, 1.2); burst(player.x, player.y + 1, player.z, '#bafadb', 14, 1.2); }
    } else if (event.kind === 'side-event' && Array.isArray(event.spawns)) {
      // Each attacker breaks the surface in a burst of foam where it spawned,
      // timed to its own delay so a wave's ranks surge in rather than pop at once.
      for (const spawn of event.spawns) {
        if (!Number.isFinite(spawn?.x) || !Number.isFinite(spawn?.z)) continue;
        const big = spawn.type === 'tidebreaker', y = heightAt(spawn.x, spawn.z);
        scheduleSurge(spawn.delay, () => {
          pulse(spawn.x, spawn.z, '#c9f4ff', big ? 4.5 : 2.6, big ? 1.1 : .8);
          burst(spawn.x, y + .35, spawn.z, '#eafcff', big ? 30 : 16, big ? 2.2 : 1.5);
        });
      }
    } else if (event.kind === 'finale' && Array.isArray(event.spawns)) {
      // The lighthouse stages surge from each shrine's bearing (or, for the
      // boss, straight from the deep); reuse the side-event foam sizes.
      for (const spawn of event.spawns) {
        if (!Number.isFinite(spawn?.x) || !Number.isFinite(spawn?.z)) continue;
        const y = heightAt(spawn.x, spawn.z);
        if (spawn.type === 'tempest') {
          scheduleSurge(spawn.delay, () => { pulse(spawn.x, spawn.z, '#ffd478', 9, 1.2); burst(spawn.x, y + .8, spawn.z, '#ffe295', 40, 3); });
        } else {
          const color = SHRINES.find((shrine) => shrine.id === spawn.from)?.color || '#c9f4ff', big = spawn.type === 'tidebreaker';
          scheduleSurge(spawn.delay, () => {
            pulse(spawn.x, spawn.z, color, big ? 4.5 : 2.6, big ? 1.1 : .8);
            burst(spawn.x, y + .35, spawn.z, color, big ? 30 : 16, big ? 2.2 : 1.5);
          });
        }
      }
    } else if (event.kind === 'telegraph') makeTelegraph(event);
    else if (event.kind === 'splash') {
      if (Number.isFinite(event.x) && Number.isFinite(event.z)) { pulse(event.x, event.z, '#b8eff2', event.radius || 4, .65); burst(event.x, (event.y || heightAt(event.x, event.z)) + .3, event.z, '#a2e5ed', 28, 1.9); }
    } else if (event.kind === 'melee') {
      const player = latestState?.players?.find(p => p.id === event.playerId);
      if (player) {
        const slash = new THREE.Mesh(new THREE.TorusGeometry(1.8, .09, 4, 18, Math.PI * .8), new THREE.MeshBasicMaterial({ color: '#fff2c1', transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false }));
        slash.position.set(player.x, player.y + 1.0, player.z); slash.rotation.set(Math.PI / 2, player.yaw, -.5);
        addEffect(slash, .22, (object, age) => { object.rotation.z += .18; object.material.opacity = 1 - age / .22; });
      }
    } else if (event.kind === 'victory' || event.kind === 'phase' && event.phase === 'victory') {
      const p = latestLocal || BEACON;
      for (let i = 0; i < 5; i++) burst(p.x + Math.sin(i * 1.26) * 5, (p.y || heightAt(p.x, p.z)) + 3, p.z + Math.cos(i * 1.26) * 5, ['#ffd478', '#a5ece1', '#d6b1ed', '#f4a084', '#f8f0cb'][i], 34, 3);
    }
  }

  function updatePlayers(dt, state, localPlayer, time, view, shipPose) {
    remotePlayers.push(state?.players || [], { receivedAt: view.snapshotReceivedAt, snapshotTime: view.snapshotTime, round: view.round ?? state?.round, phase: state?.phase, now: time * 1000 });
    const seen = new Set();
    for (const source of state?.players || []) {
      if (!source.online && source.id !== localPlayer?.id) continue;
      const isLocal = source.id === localPlayer?.id;
      const sample = isLocal ? null : remotePlayers.sample(source.id, time * 1000, shipPose);
      const player = isLocal ? localPlayer : sample?.player || source;
      seen.add(player.id);
      let model = players.get(player.id);
      if (!model) {
        model = { ...buildPirate(palette, player.color), flashUntil: 0 };
        model.group.userData.playerId = player.id;
        model.group.position.set(player.x, player.y, player.z); model.group.rotation.y = player.yaw || 0;
        scene.add(model.group); players.set(player.id, model);
      }
      model.group.position.set(player.x, player.y, player.z); model.group.rotation.y = player.yaw || 0;
      model.speed = displayedSpeed(model.lastPose, player, dt, !!sample && model.generation !== sample.generation);
      model.group.userData.movementSpeed = model.speed;
      model.animate(time, model.speed, player, { dt, aiming: isLocal && !!view.aiming, elapsed });
      model.lastPose = { ...player }; model.generation = sample?.generation;
      model.group.visible = !(isLocal && view.scoped) && (!player.invulnerableUntil || player.invulnerableUntil <= state.elapsed || Math.floor(time * 12) % 4 !== 0);
    }
    for (const [id, model] of players) if (!seen.has(id)) { disposeObject(model.group, preserve); players.delete(id); discharges.delete(id); }
  }
  function updateEnemies(dt, state, time) {
    const seen = new Set();
    for (const enemy of state?.enemies || []) {
      if (enemy.hp <= 0) continue;
      seen.add(enemy.id); let model = enemies.get(enemy.id);
      if (!model) {
        const scale = enemy.scale || ENEMY_TYPES[enemy.type]?.scale || 1.0;
        model = { ...buildCrab(palette, enemy.type, scale), flashUntil: 0 };
        model.group.position.set(enemy.x, enemy.y ?? heightAt(enemy.x, enemy.z), enemy.z);
        const hpGroup = new THREE.Group(), back = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .17), new THREE.MeshBasicMaterial({ color: '#244657', transparent: true, opacity: .85, depthWrite: false }));
        const hp = new THREE.Mesh(new THREE.PlaneGeometry(1.72, .095), new THREE.MeshBasicMaterial({ color: '#ffcf7d', transparent: true, depthWrite: false })); hp.position.z = .012;
        back.renderOrder = 1; hp.renderOrder = 2;
        hpGroup.add(back, hp); hpGroup.position.y = enemy.type === 'tempest' ? 8.8 : 2.0; scene.add(hpGroup); model.hpGroup = hpGroup; model.hpBar = hp; model.baseScale = scale;
        scene.add(model.group); enemies.set(enemy.id, model);
      }
      const goal = new THREE.Vector3(enemy.x, enemy.y ?? heightAt(enemy.x, enemy.z), enemy.z);
      model.group.position.lerp(goal, model.group.position.distanceTo(goal) > 12 ? 1 : 1 - Math.exp(-dt * 16));
      model.group.rotation.y += Math.atan2(Math.sin((enemy.yaw || 0) - model.group.rotation.y), Math.cos((enemy.yaw || 0) - model.group.rotation.y)) * (1 - Math.exp(-dt * 13));
      model.animate(time, enemy);
      model.hpGroup.position.set(model.group.position.x, model.group.position.y + (enemy.type === 'tempest' ? model.baseScale * 2.5 : model.baseScale * 1.8), model.group.position.z);
      model.hpGroup.quaternion.copy(camera.quaternion); model.hpBar.scale.x = Math.max(.01, enemy.hp / enemy.maxHp);
      model.hpBar.position.x = -.86 * (1 - model.hpBar.scale.x);
      model.hpGroup.visible = enemy.hp < enemy.maxHp || enemy.state !== 'idle';
      if (enemy.type === 'tempest') model.hpGroup.scale.setScalar(3);
      else if (enemy.type === 'tidebreaker') model.hpGroup.scale.setScalar(1.7);
      model.group.scale.setScalar(model.baseScale * (model.flashUntil > clockTime ? 1.035 : 1));
    }
    for (const [id, model] of enemies) if (!seen.has(id)) { disposeObject(model.group, preserve); disposeObject(model.hpGroup, preserve); enemies.delete(id); }
  }
  function updateObjectives(state, time) {
    const reducedMotion = reducedMotionPreference.matches, objectiveTime = reducedMotion ? 0 : time;
    const seenDrops = new Set();
    for (const drop of state?.drops || []) {
      if (!isLootVisible(drop, latestLocal) || !Object.hasOwn(WEAPONS, drop.weapon)) continue;
      seenDrops.add(drop.id);
      let model = dropModels.get(drop.id);
      if (!model) {
        const color = RARITIES[drop.rarity]?.color || '#aebbc5';
        const group = new THREE.Group(); group.name = 'loot-' + drop.id;
        group.userData = { kind: 'loot', weapon: drop.weapon, rarity: drop.rarity, id: drop.id };
        const gun = buildWeapon(palette, drop.weapon).group;
        gun.name = 'floating-' + drop.weapon; gun.rotation.z = -.14; gun.scale.setScalar(.92);
        const ring = meshRing(.68, .065, color, .75);
        ring.position.y = .075;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(.12, .36, 2.7, 10, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .10, side: THREE.DoubleSide, depthWrite: false }));
        beam.position.y = 1.4;
        group.add(gun, ring, beam); scene.add(group);
        model = { group, gun, ring, beam }; dropModels.set(drop.id, model);
      }
      model.group.position.set(drop.x, drop.y ?? heightAt(drop.x, drop.z), drop.z);
      const motion = reducedMotionPreference.matches ? 0 : time;
      model.gun.position.y = 1.20 + Math.sin(motion * 1.7) * .11;
      model.gun.rotation.y = motion * .48 + .7;
      model.ring.material.opacity = .64 + Math.sin(motion * 1.7) * .10;
    }
    for (const [id, model] of dropModels) if (!seenDrops.has(id)) { disposeObject(model.group, preserve); dropModels.delete(id); }
    for (const chest of state?.chests || []) { const model = chestModels.get(chest.id); if (model) model.opened = !!chest.opened; }
    for (const model of chestModels.values()) {
      model.animate(time, model.opened); model.beam.visible = !model.opened;
      model.beam.userData.star.position.y = 1.9 + Math.sin(time * 2.0) * .15; model.beam.userData.star.rotation.y = time;
    }
    for (const shrine of SHRINES) {
      const model = shrineModels.get(shrine.id), status = state?.shrines?.find(s => s.id === shrine.id);
      const active = status?.status === 'active', cleared = status?.status === 'cleared';
      model.animate(objectiveTime, status); model.beam.visible = !cleared;
      updateObjectiveMarker(model.availableRing, { visible: !active && !cleared, time, reducedMotion });
      updateObjectiveMarker(model.activeRing, { visible: active, active: true, time, reducedMotion });
      model.beam.userData.star.visible = false;
      model.beam.userData.column.material.opacity = active ? .21 : .105;
    }
    for (const event of SIDE_EVENTS) {
      const model = sideEventModels.get(event.id), status = (state?.sideEvents || []).find(s => s.id === event.id);
      const voyage = state?.phase === 'voyage', active = status?.status === 'active', available = status?.status === 'available';
      model.group.visible = voyage;
      model.beam.visible = voyage && (active || available);
      model.beam.userData.column.material.opacity = active ? .19 : .1;
      updateObjectiveMarker(model.availableRing, { visible: voyage && available, time, reducedMotion });
      updateObjectiveMarker(model.activeRing, { visible: voyage && active, active: true, time, reducedMotion });
    }
    const shards = Array.isArray(state?.shards) ? state.shards.length : (state?.shards || 0), unlocked = shards >= 3;
    beaconModel.animate(objectiveTime, null); beaconModel.gem.rotation.y = -objectiveTime * .3;
    beaconBeam.visible = unlocked || !state || state.phase === 'lobby'; beaconBeam.userData.star.visible = false;
    updateObjectiveMarker(beaconHalo, { active: unlocked, muted: !unlocked, time, reducedMotion });
    lantern.scale.setScalar(state?.phase === 'victory' ? 1.6 : 1 + Math.sin(time * 1.3) * .07);
    lighthousePivot.rotation.y = time * .20; lighthouseRay.material.opacity = state?.phase === 'victory' ? .13 : .04;
    const seen = new Set();
    for (const ping of state?.pings || []) {
      seen.add(ping.id); let marker = pingModels.get(ping.id);
      if (!marker) { marker = makeBeam('#a6f2f1', 9, .22); scene.add(marker); pingModels.set(ping.id, marker); }
      marker.position.set(ping.x, heightAt(ping.x, ping.z), ping.z); marker.userData.star.position.y = 2.4 + Math.sin(time * 3) * .25; marker.userData.star.rotation.y = time;
    }
    for (const [id, model] of pingModels) if (!seen.has(id)) { disposeObject(model, preserve); pingModels.delete(id); }
  }

  function updateCamera(dt, player, view, shipPose) {
    const GROUND_SHOULDER_OFFSET = 1.48, GROUND_CAMERA_HEIGHT = 2.42;
    const GROUND_CAMERA_BACK = 7.45, AIM_CAMERA_BACK = 5.7;
    const NORMAL_GAMEPLAY_FOV = 50, AIM_GAMEPLAY_FOV = 43, GLIDING_FOV = 58;
    const menu = view.menu || !player;
    const travel = cameraTravel(cameraFollowPose, player, { menu, round: view.round });
    cameraFollowPose = travel.anchor;
    if (travel.delta) { camera.position.x += travel.delta.x; camera.position.y += travel.delta.y; camera.position.z += travel.delta.z; }
    if (!menu && player.mode === 'aboard' && cameraShipPose) {
      camera.position.x += shipPose.x - cameraShipPose.x;
      camera.position.y += shipPose.y - cameraShipPose.y;
      camera.position.z += shipPose.z - cameraShipPose.z;
    }
    if (menu) {
      const t = view.time ?? clockTime, orbit = Math.sin(t * .035) * .08;
      desiredCamera.set(-122 * Math.cos(orbit) + 174 * Math.sin(orbit), 105 + Math.sin(t * .09) * 2.3, 174 * Math.cos(orbit) + 122 * Math.sin(orbit));
      cameraTarget.set(6, 18, 4);
      camera.position.lerp(desiredCamera, cameraReady ? 1 - Math.exp(-dt * 2) : 1); camera.lookAt(cameraTarget);
      camera.fov = latestView.scoped ? 53 : smooth(camera.fov, 53, dt * 3);
    } else if (view.scoped) {
      const pose = scopeCameraPose(player, view.yaw, view.pitch);
      camera.position.set(pose.origin.x, pose.origin.y, pose.origin.z);
      direction.set(pose.direction.x, pose.direction.y, pose.direction.z);
      cameraTarget.copy(camera.position).addScaledVector(direction, 100); camera.lookAt(cameraTarget);
      camera.fov = reducedMotionPreference.matches ? SCOPE_FOV : camera.fov + (SCOPE_FOV - camera.fov) * (1 - Math.exp(-dt * 12));
    } else {
      const yaw = Number.isFinite(view.yaw) ? view.yaw : player.yaw || 0, pitch = clamp(Number.isFinite(view.pitch) ? view.pitch : player.pitch || -.15, -1.25, 1.1);
      direction.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const back = player.mode === 'gliding' ? 10.2 : view.aiming && player.mode === 'ground' ? AIM_CAMERA_BACK : GROUND_CAMERA_BACK;
      const anchor = new THREE.Vector3(player.x, player.y + (player.mode === 'ground' ? GROUND_CAMERA_HEIGHT : 2.7), player.z);
      desiredCamera.copy(anchor).addScaledVector(direction, -back).addScaledVector(right, player.mode === 'ground' ? GROUND_SHOULDER_OFFSET : .92);
      let safeFraction = 1;
      if (player.mode === 'ground') {
        const dx = desiredCamera.x - anchor.x, dz = desiredCamera.z - anchor.z, lengthSq = dx * dx + dz * dz;
        for (const obstacle of OBSTACLES) {
          if (ENTERABLE_IDS.has(obstacle.buildingId)) continue;
          const t = clamp(((obstacle.x - anchor.x) * dx + (obstacle.z - anchor.z) * dz) / (lengthSq || 1), 0, 1);
          if (t < .12 || t >= safeFraction) continue;
          const separation = Math.hypot(anchor.x + t * dx - obstacle.x, anchor.z + t * dz - obstacle.z);
          const top = heightAt(obstacle.x, obstacle.z) + (obstacle.height || 4);
          if (separation < (obstacle.radius || 1) + .45 && lerp(anchor.y, desiredCamera.y, t) < top + .5) safeFraction = Math.max(.3, t - .15);
        }
        // Inside roofs and tall walls cut away. Outside, real wall segments
        // replace the old solid building circles so open doors remain usable.
        if (!buildingAt(player.x, player.z) && !hasWorldLineOfSight(anchor, desiredCamera, .22)) {
          let low = 0, high = 1;
          for (let pass = 0; pass < 7; pass++) {
            const middle = (low + high) / 2;
            const probe = { x: lerp(anchor.x, desiredCamera.x, middle), y: lerp(anchor.y, desiredCamera.y, middle), z: lerp(anchor.z, desiredCamera.z, middle) };
            if (hasWorldLineOfSight(anchor, probe, .22)) low = middle; else high = middle;
          }
          safeFraction = Math.min(safeFraction, Math.max(.20, low));
        }
      }
      if (safeFraction < 1) desiredCamera.lerpVectors(anchor, desiredCamera, safeFraction);
      desiredCamera.y = Math.max(desiredCamera.y, heightAt(desiredCamera.x, desiredCamera.z) + 1.25);
      if (player.mode === 'aboard') desiredCamera.y = Math.max(desiredCamera.y, player.y + 1.6);
      const snap = !cameraReady || travel.reset || camera.position.distanceTo(desiredCamera) > 45 || latestView.menu || latestView.scoped;
      camera.position.lerp(desiredCamera, snap ? 1 : 1 - Math.exp(-dt * 18));
      // Center ray is exactly input direction, including after collision.
      cameraTarget.copy(camera.position).addScaledVector(direction, 100); camera.lookAt(cameraTarget);
      const targetFov = view.aiming ? AIM_GAMEPLAY_FOV : player.mode === 'gliding' ? GLIDING_FOV : NORMAL_GAMEPLAY_FOV;
      camera.fov = latestView.scoped ? targetFov : smooth(camera.fov, targetFov, dt * 8);
    }
    if (!menu && Math.hypot(player.x - sun.target.position.x, player.z - sun.target.position.z) > 8) {
      sun.target.position.set(player.x, 0, player.z); sun.position.set(player.x - 60, 130, player.z + 70);
      sun.target.updateMatrixWorld();
    }
    if (ship.sails) {
      const fade = !menu && player.mode === 'aboard' && camera.position.y - player.y > 5;
      ship.sails.material.opacity = smooth(ship.sails.material.opacity, fade ? .18 : 1, dt * 8);
      ship.sails.material.depthWrite = ship.sails.material.opacity > .95;
    }
    if (ship.cabin) {
      let fade = false;
      if (!menu && player.mode === 'aboard') {
        // Keep the full shoulder view; only the cabin yields when it hides the torso.
        ship.group.updateMatrixWorld(true);
        cabinCamera.copy(camera.position); ship.group.worldToLocal(cabinCamera);
        cabinTorso.set(player.x, player.y + 1.3, player.z); ship.group.worldToLocal(cabinTorso);
        const distanceSquared = cabinCamera.distanceToSquared(cabinTorso);
        cabinRay.origin.copy(cabinCamera);
        cabinRay.direction.subVectors(cabinTorso, cabinCamera).normalize();
        fade = cabinNearBounds.containsPoint(cabinCamera) || !!cabinRay.intersectBox(cabinBounds, cabinHit) && cabinCamera.distanceToSquared(cabinHit) <= distanceSquared;
      }
      ship.cabin.material.opacity = smooth(ship.cabin.material.opacity, fade ? .12 : 1, dt * 14);
      ship.cabin.material.depthWrite = !fade && ship.cabin.material.opacity > .95;
    }
    cameraShipPose = !menu && player.mode === 'aboard' ? { ...shipPose } : null;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(); cameraReady = true;
  }

  function update(dt, state, localPlayer, view = {}) {
    if (disposed) return;
    dt = clamp(Number.isFinite(dt) ? dt : .016, 0, .1); clockTime += dt;
    for (let i = pendingSurges.length - 1; i >= 0; i--) if (pendingSurges[i].at <= clockTime) pendingSurges.splice(i, 1)[0].fn();
    elapsed = state?.elapsed || 0; latestState = state; latestLocal = localPlayer;
    const time = Number.isFinite(view.time) ? view.time : clockTime;
    const shipPose = shipAt(state?.phase === 'lobby' || !state ? 0 : elapsed);
    ship.group.position.set(shipPose.x, shipPose.y, shipPose.z); ship.group.rotation.y = shipPose.yaw || 0; ship.animate(time);
    ocean.animate(time); sky.animate(time);
    updateCamera(dt, localPlayer, view, shipPose);
    settlements.animate(time, { lowQuality, reducedMotion: reducedMotionPreference.matches, player: localPlayer, camera: camera.position });
    oldWatch.animate(time, { lowQuality, reducedMotion: reducedMotionPreference.matches, player: localPlayer });
    windwardFarm.animate(time, { lowQuality, reducedMotion: reducedMotionPreference.matches, player: localPlayer });
    tideglassMarket.animate(time, { lowQuality, reducedMotion: reducedMotionPreference.matches, player: localPlayer });
    saltwindHarbor.animate(time, { lowQuality, reducedMotion: reducedMotionPreference.matches, player: localPlayer });
    driftwoodYard.animate(time, { lowQuality, reducedMotion: reducedMotionPreference.matches, player: localPlayer });
    palmheartCamp.animate(time, { lowQuality, reducedMotion: reducedMotionPreference.matches, player: localPlayer });
    cinderworks.animate(time, { lowQuality, reducedMotion: reducedMotionPreference.matches, player: localPlayer });
    environmentLighting.update(localPlayer, { oldWatchReady: oldWatch.isReady(), farmReady: windwardFarm.isReady(), tideglassReady: tideglassMarket.isReady(), saltwindReady: saltwindHarbor.isReady(), driftwoodReady: driftwoodYard.isReady(), palmheartReady: palmheartCamp.isReady(), cinderworksReady: cinderworks.isReady() });
    updatePlayers(dt, state, localPlayer, time, view, shipPose); updateEnemies(dt, state, time); updateObjectives(state, time);
    for (const mote of motes) {
      const a = mote.phase + time * (mote.ember ? .1 : .16);
      mote.mesh.position.set(mote.center.x + Math.sin(a) * mote.radius, mote.center.y + (mote.ember ? (mote.rise + time * .7) % 7 : Math.sin(time * .5 + mote.phase) * 1.1 + mote.rise * .4), mote.center.z + Math.cos(a) * mote.radius);
      mote.mesh.material.opacity = .5 + Math.sin(time * 1.5 + mote.phase) * .3;
    }
    for (const effect of [...effects]) {
      const index = effects.indexOf(effect); if (index < 0) continue;
      effect.age += dt;
      if (effect.age >= effect.life) {
        effects.splice(index, 1); effect.update?.(effect.object, effect.life, dt); removeEffect(effect);
      } else effect.update?.(effect.object, effect.age, dt);
    }
    for (const [id, until] of telegraphs) if (until < clockTime) telegraphs.delete(id);
    frameCount++; fpsElapsed += dt;
    if (fpsElapsed >= 1) { fps = Math.round(frameCount / fpsElapsed); frameCount = 0; fpsElapsed = 0; }
    latestView = { ...view };
  }
  function render() { if (!disposed) renderer.render(scene, camera); }
  function resize() {
    const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width || canvas.clientWidth || window.innerWidth); height = Math.max(1, rect.height || canvas.clientHeight || window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowQuality ? 1 : 1.5)); renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  function setQuality(value) { lowQuality = value === 'low'; renderer.shadowMap.enabled = !lowQuality; resize(); }
  function project(point) {
    projectVector.set(point.x, point.y, point.z).project(camera);
    return { x: (projectVector.x * .5 + .5) * width, y: (-projectVector.y * .5 + .5) * height, visible: projectVector.z > -1 && projectVector.z < 1 && Math.abs(projectVector.x) < 1.15 && Math.abs(projectVector.y) < 1.15 };
  }
  function projectPlayer(id, height = 3.35) {
    const position = players.get(id)?.group.position;
    return position ? project({ x: position.x, y: position.y + height, z: position.z }) : null;
  }
  function aimRay() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    return { origin: { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z }, direction: { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z } };
  }
  function getStats() { return { render: { ...renderer.info.render }, memory: { ...renderer.info.memory }, programs: renderer.info.programs?.length || 0, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps, quality: lowQuality ? 'low' : 'high', players: players.size, enemies: enemies.size, drops: dropModels.size, effects: effects.length, settlements: { ...settlements.stats }, oldWatch: oldWatch.getStats(), windwardFarm: windwardFarm.getStats(), tideglassMarket: tideglassMarket.getStats(), saltwindHarbor: saltwindHarbor.getStats(), driftwoodYard: driftwoodYard.getStats(), palmheartCamp: palmheartCamp.getStats(), cinderworks: cinderworks.getStats(), environmentAssets: environmentAssets.getStats() }; }
  function dispose() {
    if (disposed) return; disposed = true;
    oldWatch.dispose();
    windwardFarm.dispose(); tideglassMarket.dispose(); saltwindHarbor.dispose(); driftwoodYard.dispose(); palmheartCamp.dispose(); cinderworks.dispose(); environmentLighting.dispose(); environmentAssets.dispose();
    disposeObject(scene); Object.values(palette.geometry).forEach(g => g.dispose()); palette.ramp.dispose(); palette.solid.dispose(); palette.glow.dispose();
    renderer.dispose(); players.clear(); enemies.clear(); chestModels.clear(); shrineModels.clear(); sideEventModels.clear(); pingModels.clear(); dropModels.clear(); effects.length = 0; pendingSurges.length = 0; remotePlayers.clear(); discharges.clear(); pendingImpacts.clear();
  }
  resize(); update(0, null, null, { menu: true, time: 0 });
  return { scene, camera, renderer, update, render, resize, setQuality, dispose, handleEvent, project, projectPlayer, aimRay, getStats };
}
