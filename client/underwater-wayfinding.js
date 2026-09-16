import * as THREE from 'three';
import { floorY } from './underwater-habitat.js';
import { REEF_EXIT, REEF_SWIMMER_BODY } from '../shared/underwater.js';
import { REEF_REGIONS } from '../shared/underwater-content.js';

const TAU = Math.PI * 2;
const BEACON_FADE_START = 48;
const BEACON_FADE_END = 92;
const REGION = Object.fromEntries(REEF_REGIONS.map(region => [region.id, region]));
const BEACON_SITES = Object.freeze({
  'sunken-reach': REEF_EXIT,
  'coral-gardens': { x: -76, y: 30, z: 62 },
  'kelp-hollows': { x: -100, y: 25, z: -29 },
  'bell-sanctuary': { x: 14, y: 27, z: -100 },
  'ember-vents': { x: 95, y: 31, z: -55 },
  'crown-graveyard': { x: 94, y: 32, z: 47 },
});
const PATH_TONES = Object.freeze({ 'sunken-reach': '#e6dfb5', 'coral-gardens': '#efd5b2', 'kelp-hollows': '#b3b48e', 'bell-sanctuary': '#bdc9cc', 'ember-vents': '#b9926b', 'crown-graveyard': '#a4a49b' });

const route = (id, region, nodes, kind = 'main') => Object.freeze({ id, region, kind, nodes: Object.freeze(nodes.map(point => Object.freeze({ ...point }))) });

// These are navigation approaches rather than rails: their offsets preserve a
// swimmer-body corridor around every physical landmark while ending inside the
// interaction ranges of discoveries, caches, and events.
export const REEF_WAYFINDING_ROUTES = Object.freeze([
  route('exit-to-gardens', 'sunken-reach', [{ x: -18, y: 6, z: 20 }, { x: -30, y: 8, z: 31 }, { x: -45, y: 8, z: 45 }, { x: -54, y: 9, z: 58 }, { x: -61, y: 10, z: 67 }]),
  route('exit-to-hollows', 'sunken-reach', [{ x: -18, y: 6, z: 20 }, { x: -31, y: 7, z: 5 }, { x: -48, y: 8, z: -9 }, { x: -65, y: 9, z: -20 }, { x: -74, y: 10, z: -20 }]),
  route('exit-to-bells', 'sunken-reach', [{ x: -18, y: 6, z: 20 }, { x: -15, y: 9, z: -5 }, { x: -12, y: 11, z: -28 }, { x: -7, y: 12, z: -54 }, { x: -1, y: 14, z: -76 }, { x: 2, y: 16, z: -84 }]),
  route('bells-to-vents', 'ember-vents', [{ x: 2, y: 16, z: -84 }, { x: 25, y: 15, z: -86 }, { x: 51, y: 14, z: -82 }, { x: 68, y: 14, z: -77 }, { x: 72, y: 15, z: -62 }]),
  route('vents-to-graveyard', 'crown-graveyard', [{ x: 72, y: 15, z: -62 }, { x: 76, y: 16, z: -40 }, { x: 76, y: 17, z: -12 }, { x: 84, y: 20, z: 20 }, { x: 84, y: 20, z: 28 }, { x: 84, y: 16, z: 38 }]),
  route('exit-to-graveyard', 'crown-graveyard', [{ x: -18, y: 6, z: 20 }, { x: 5, y: 10, z: 30 }, { x: 29, y: 13, z: 35 }, { x: 52, y: 15, z: 38 }, { x: 68, y: 19, z: 47 }, { x: 84, y: 19, z: 48 }, { x: 84, y: 16, z: 38 }]),
  route('reach-chest', 'sunken-reach', [{ x: -18, y: 6, z: 20 }, { x: -10, y: 5, z: 9 }, { x: 0, y: 4, z: 2 }, { x: 8, y: 3, z: 1.5 }, { x: 8, y: 2, z: -5 }, { x: 8, y: 2, z: -12 }], 'branch'),
  route('reach-figurehead', 'sunken-reach', [{ x: -18, y: 6, z: 20 }, { x: -15, y: 9, z: 25 }, { x: -12, y: 10, z: 25 }], 'branch'),
  route('reach-watchtower', 'sunken-reach', [{ x: -10, y: 5, z: 9 }, { x: 8, y: 9, z: 15 }, { x: 17, y: 17, z: 18 }, { x: 21, y: 28, z: 17 }], 'branch'),
  route('garden-fan', 'coral-gardens', [{ x: -61, y: 10, z: 67 }, { x: -60, y: 8, z: 74 }], 'branch'),
  route('garden-spire', 'coral-gardens', [{ x: -61, y: 10, z: 67 }, { x: -69, y: 14, z: 66 }, { x: -72, y: 24, z: 63 }, { x: -76, y: 30, z: 62 }], 'vertical'),
  route('garden-canopy', 'coral-gardens', [{ x: -76, y: 30, z: 62 }, { x: -79, y: 27, z: 68 }, { x: -84, y: 26, z: 70 }], 'vertical'),
  route('kelp-anchor', 'kelp-hollows', [{ x: -74, y: 10, z: -20 }, { x: -78, y: 9, z: -17 }], 'branch'),
  route('kelp-window', 'kelp-hollows', [{ x: -74, y: 10, z: -20 }, { x: -83, y: 18, z: -24 }, { x: -88, y: 25, z: -27 }, { x: -100, y: 25, z: -29 }], 'vertical'),
  route('kelp-ray-cages', 'kelp-hollows', [{ x: -74, y: 10, z: -20 }, { x: -78, y: 10, z: -20 }, { x: -85, y: 11, z: -20 }, { x: -91, y: 16, z: -27 }, { x: -91, y: 13, z: -18 }, { x: -98, y: 10, z: -13 }], 'branch'),
  route('bell-plinth-low-chime', 'bell-sanctuary', [{ x: 2, y: 16, z: -84 }, { x: 2, y: 12, z: -91 }, { x: -13, y: 11, z: -89 }], 'branch'),
  route('bell-crown', 'bell-sanctuary', [{ x: 2, y: 16, z: -84 }, { x: 8, y: 22, z: -92 }, { x: 14, y: 27, z: -100 }], 'vertical'),
  route('sanctuary-high-chime', 'bell-sanctuary', [{ x: 2, y: 16, z: -84 }, { x: 4, y: 23, z: -90 }, { x: 14, y: 25, z: -100 }, { x: 9, y: 21, z: -99 }], 'vertical'),
  route('sanctuary-far-chime', 'bell-sanctuary', [{ x: 2, y: 16, z: -84 }, { x: 4, y: 23, z: -90 }, { x: 7, y: 23, z: -101 }, { x: 6, y: 13, z: -105 }], 'vertical'),
  route('ember-mouth', 'ember-vents', [{ x: 72, y: 15, z: -62 }, { x: 75, y: 12, z: -66 }, { x: 78, y: 11, z: -72 }], 'branch'),
  route('ember-stack', 'ember-vents', [{ x: 72, y: 15, z: -62 }, { x: 86, y: 20, z: -57 }, { x: 92, y: 26, z: -55 }, { x: 95, y: 31, z: -55 }], 'vertical'),
  route('crown-keel', 'crown-graveyard', [{ x: 84, y: 16, z: 38 }, { x: 81, y: 11, z: 31 }], 'branch'),
  route('crown-mast', 'crown-graveyard', [{ x: 84, y: 16, z: 38 }, { x: 92, y: 27, z: 38 }, { x: 94, y: 31, z: 43 }, { x: 94, y: 32, z: 47 }], 'vertical'),
]);

function between(a, b, distance) {
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const count = Math.max(1, Math.ceil(length / distance));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    return { x: THREE.MathUtils.lerp(a.x, b.x, t), y: THREE.MathUtils.lerp(a.y, b.y, t), z: THREE.MathUtils.lerp(a.z, b.z, t), t };
  });
}

function routeSamples(routes, spacing) {
  const unique = new Map();
  for (const entry of routes) for (let index = 1; index < entry.nodes.length; index++) for (const point of between(entry.nodes[index - 1], entry.nodes[index], spacing)) {
    const key = `${point.x.toFixed(3)}:${point.y.toFixed(3)}:${point.z.toFixed(3)}`;
    if (!unique.has(key)) unique.set(key, { ...point, route: entry });
  }
  return [...unique.values()];
}

function makePearls(samples) {
  const geometry = new THREE.SphereGeometry(.13, 7, 5);
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .78, depthWrite: false, depthTest: true });
  const mesh = new THREE.InstancedMesh(geometry, material, samples.length);
  mesh.name = 'sunken-reach-wayfinding-pearl-trails'; mesh.frustumCulled = false;
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  samples.forEach((sample, index) => {
    const accent = REGION[sample.route.region]?.accent || '#d9fff0';
    matrix.makeTranslation(sample.x, sample.y + (index % 3 - 1) * .18, sample.z); matrix.scale(new THREE.Vector3(index % 5 === 0 ? 1.3 : .8, index % 5 === 0 ? 1.3 : .8, index % 5 === 0 ? 1.3 : .8));
    mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, color.set(accent).lerp(new THREE.Color('#fff3cf'), .42));
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  mesh.userData.samples = samples;
  return { mesh, material, samples };
}

function makeRouteBed(resources, samples) {
  const group = new THREE.Group(); group.name = 'sunken-reach-wayfinding-shell-silt-paths';
  for (const region of REEF_REGIONS) {
    const silt = resources.batch('sand'), shells = resources.batch('stone'); let count = 0;
    samples.filter(sample => sample.route.region === region.id).forEach((sample, index) => {
      const y = floorY(sample.x, sample.z) + .055;
      const size = 1.05 + index % 3 * .18, angle = index * 1.71;
      // Flattened silt pockets collect unevenly in the current, while the
      // three small shell pieces form a readable but non-continuous trail.
      silt.add('sphere', [sample.x, y, sample.z], [size, .026, .5 + index % 2 * .12], [0, angle, 0], PATH_TONES[region.id]);
      for (let shell = 0; shell < 3; shell++) {
        const a = angle + shell * 2.19, r = .28 + shell * .11;
        shells.add('pebble', [sample.x + Math.cos(a) * r, y + .045, sample.z + Math.sin(a) * r], [.09 + shell * .025, .035, .12 + (shell % 2) * .025], [0, a, shell * .4], shell === 1 ? region.accent : '#d9d0a8');
      }
      count++;
    });
    if (!count) continue;
    const siltMesh = silt.mesh({ shadow: false }), shellMesh = shells.mesh({ shadow: false });
    siltMesh.name = `sunken-reach-wayfinding-${region.id}-silt`; shellMesh.name = `sunken-reach-wayfinding-${region.id}-shells`; group.add(siltMesh, shellMesh);
  }
  return group;
}

function makeSeaweed(resources, samples) {
  const group = new THREE.Group(); group.name = 'sunken-reach-wayfinding-seaweed-clusters';
  for (const region of REEF_REGIONS) {
    const batch = resources.batch('kelp'); let count = 0;
    samples.filter((sample, index) => sample.route.region === region.id && sample.y < 17 && index % 3 === 0).forEach((sample, index) => {
      const baseY = floorY(sample.x, sample.z) + .08, offset = (index % 2 ? .34 : -.34);
      batch.line([sample.x + offset, baseY, sample.z - offset], [sample.x + offset * .32, baseY + 1.25 + index % 3 * .18, sample.z - offset * .2], .045, region.accent, .55);
      batch.add('cone', [sample.x - offset, baseY + .52, sample.z + offset * .4], [.16, .9, .06], [0, index * .4, index % 2 ? -.42 : .42], region.accent); count++;
    });
    if (count) { const mesh = batch.mesh({ shadow: false }); mesh.name = `sunken-reach-wayfinding-${region.id}-seaweed`; group.add(mesh); }
  }
  return group;
}

function makeBeaconGlowTexture() {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot(x / (size - 1) * 2 - 1, y / (size - 1) * 2 - 1), alpha = Math.round(255 * Math.max(0, 1 - distance) ** 2.3), index = (y * size + x) * 4;
    data[index] = data[index + 1] = data[index + 2] = 255; data[index + 3] = alpha;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true; return texture;
}

function makeBeacons() {
  const group = new THREE.Group(); group.name = 'sunken-reach-wayfinding-landmark-beacons';
  const geometry = new THREE.SphereGeometry(.17, 8, 6), glowTexture = makeBeaconGlowTexture();
  for (const region of REEF_REGIONS) {
    const beacon = new THREE.Group(); beacon.name = `sunken-reach-wayfinding-${region.id}-beacon`; beacon.position.set(region.x, Math.max(12, region.id === 'crown-graveyard' || region.id === 'coral-gardens' ? 23 : 15), region.z);
    const site = BEACON_SITES[region.id], coreMaterial = new THREE.MeshBasicMaterial({ color: region.accent, transparent: true, opacity: .78, depthWrite: false, depthTest: true });
    beacon.position.set(site.x, site.y, site.z);
    const core = new THREE.Mesh(geometry, coreMaterial); core.name = 'landmark-bearing'; core.position.y = .38;
    const glowMaterial = new THREE.SpriteMaterial({ map: glowTexture, color: region.accent, transparent: true, opacity: .16, depthWrite: false, depthTest: true, fog: false });
    const glow = new THREE.Sprite(glowMaterial); glow.name = 'landmark-bearing-halo'; glow.position.y = .38; glow.scale.set(3.6, 3.6, 1);
    beacon.add(glow, core); beacon.userData = { core, coreMaterial, glowMaterial, baseOpacity: .16, phase: region.x * .07 + region.z * .03 };
    group.add(beacon);
  }
  return { group, glowTexture };
}

function drawCalls(root) { let count = 0; root.traverse(node => { if (node.isMesh || node.isSprite) count++; }); return count; }

export function createReefWayfinding(resources) {
  if (!resources?.batch) throw new TypeError('createReefWayfinding needs shared reef resources');
  const group = new THREE.Group(); group.name = 'sunken-reach-authored-wayfinding';
  const routeRoot = new THREE.Group(); routeRoot.name = 'sunken-reach-wayfinding-routes'; routeRoot.userData.routes = REEF_WAYFINDING_ROUTES;
  const shellSamples = routeSamples(REEF_WAYFINDING_ROUTES, 12.5), pearlSamples = routeSamples(REEF_WAYFINDING_ROUTES, 9.4);
  const shellSilt = makeRouteBed(resources, shellSamples), seaweed = makeSeaweed(resources, shellSamples), pearls = makePearls(pearlSamples), beaconSet = makeBeacons(), beacons = beaconSet.group;
  routeRoot.add(shellSilt, seaweed, pearls.mesh); group.add(routeRoot, beacons);
  let disposed = false, lowQuality = false, reducedMotion = false;
  const stats = { routes: REEF_WAYFINDING_ROUTES.length, routePoints: REEF_WAYFINDING_ROUTES.reduce((sum, entry) => sum + entry.nodes.length, 0), shellSilt: shellSamples.length, seaweed: seaweed.children.length, pearls: pearlSamples.length, beacons: beacons.children.length, drawCalls: drawCalls(group) };
  const playerPosition = player => player?.position || player;
  return {
    group,
    update(time = 0, { lowQuality: low = false, reducedMotion: reduced = false, player = null } = {}) {
      lowQuality = !!low; reducedMotion = !!reduced;
      shellSilt.visible = true; seaweed.visible = !lowQuality; pearls.mesh.visible = true;
      const pulse = reducedMotion ? 1 : .78 + Math.sin(Number.isFinite(time) ? time * 2.1 : 0) * .22;
      pearls.material.opacity = lowQuality ? .64 : .78 * pulse;
      const position = playerPosition(player);
      for (const beacon of beacons.children) {
        const distance = position && Number.isFinite(position.x) && Number.isFinite(position.z) ? Math.hypot(position.x - beacon.position.x, (position.y ?? beacon.position.y) - beacon.position.y, position.z - beacon.position.z) : 0;
        const fade = THREE.MathUtils.clamp((BEACON_FADE_END - distance) / (BEACON_FADE_END - BEACON_FADE_START), 0, 1);
        beacon.visible = fade > 0;
        beacon.userData.coreMaterial.opacity = .78 * fade;
        beacon.userData.glowMaterial.opacity = beacon.userData.baseOpacity * fade * (reducedMotion ? 1 : .86 + Math.sin(time * 1.35 + beacon.userData.phase) * .14);
        beacon.rotation.y = reducedMotion ? 0 : time * .16 + beacon.userData.phase;
      }
    },
    getStats() { return { status: disposed ? 'disposed' : 'ready', ...stats, lowQuality, reducedMotion, beaconFade: { start: BEACON_FADE_START, end: BEACON_FADE_END }, origin: REEF_EXIT.id, swimmerRadius: REEF_SWIMMER_BODY.radius }; },
    dispose() { if (disposed) return; disposed = true; beaconSet.glowTexture.dispose(); },
  };
}
