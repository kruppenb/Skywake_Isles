import * as THREE from 'three';
import { buildChest } from './models.js';
import { createReefResources } from './underwater-materials.js';
import { createReefHabitat, floorY } from './underwater-habitat.js';
import { addFanCoralDiscovery, addLandmarkSolid, addSpireDiscoveryCrown, makeLandmarkSupports, makeRegionalLandmarkCompositions, makeWreckLandmark } from './underwater-landmarks.js';
import { DIVE_ENTRANCE, REEF_CHEST, REEF_EXIT, REEF_SOLIDS, REEF_WRECK_SOLIDS } from '../shared/underwater.js';
import { REEF_REGIONS, REEF_DISCOVERIES, REEF_CACHES, REEF_ENCOUNTERS, REEF_EVENTS, REEF_LANDMARK_SOLIDS, REEF_LANDMARK_SUPPORTS } from '../shared/underwater-content.js';

const TAU = Math.PI * 2;
const REGION = Object.fromEntries(REEF_REGIONS.map(region => [region.id, region]));

function ownedMaterial(color, options = {}) { return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, ...options }); }
function ring(batch, position, radius, color) { const geometry = new THREE.TorusGeometry(1, .12, 6, 12); batch.add(geometry, position, [radius, radius, radius], [Math.PI / 2, 0, 0], color); geometry.dispose(); }
function bellSkirt(batch, position, scale, color = '#c6a461') { const geometry = new THREE.LatheGeometry([new THREE.Vector2(.08, .58), new THREE.Vector2(.43, .55), new THREE.Vector2(.62, .28), new THREE.Vector2(.72, -.28), new THREE.Vector2(.57, -.53), new THREE.Vector2(.25, -.62)], 12); batch.add(geometry, position, scale, [0, 0, 0], color); geometry.dispose(); }
function labelSprite(text, color = '#efffdc') {
  if (typeof document === 'undefined') return new THREE.Group();
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96; const context = canvas.getContext('2d'); if (!context) return new THREE.Group();
  context.font = 'bold 34px Trebuchet MS, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineWidth = 8; context.strokeStyle = '#173d4a';
  context.strokeText(text, 256, 48); context.fillStyle = color; context.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })); sprite.scale.set(1.55, .29, 1); return sprite;
}
function softShaft(color, x, z) {
  const group = new THREE.Group(), width = 32, height = 64, data = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const u = px / (width - 1), v = py / (height - 1), edge = Math.sin(Math.PI * u) ** 1.6, ends = Math.sin(Math.PI * v) ** .72, alpha = Math.round(255 * edge * ends), offset = (py * width + px) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = alpha; data[offset + 3] = 255;
  }
  const fade = new THREE.DataTexture(data, width, height, THREE.RGBAFormat); fade.colorSpace = THREE.NoColorSpace; fade.needsUpdate = true;
  const material = ownedMaterial(color, { alphaMap: fade, transparent: true, opacity: .055, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 3; i++) { const angle = i * Math.PI / 3, top = 3.4 - i * .35, bottom = .65 + i * .1, height = 29 + i * 2;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([-bottom, -height / 2, 0, bottom, -height / 2, 0, top, height / 2, 0, -top, height / 2, 0], 3)); geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const sheet = new THREE.Mesh(geometry, material); sheet.rotation.y = angle; sheet.position.set(x, 26, z); group.add(sheet);
  }
  group.userData.dispose = () => { for (const sheet of group.children) sheet.geometry.dispose(); material.dispose(); fade.dispose(); };
  return group;
}
function fishGeometry() {
  const geometry = new THREE.BufferGeometry();
  // A single inexpensive low-poly body and forked tail can still be instanced
  // as one draw call for the whole school.
  const v = [0, 0, 1,  .52, 0, 0,  0, .28, 0,  -.52, 0, 0,  0, -.28, 0,  0, 0, -.58,  0, .46, -1.12,  0, -.46, -1.12];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4, 5, 6, 7]); geometry.computeVertexNormals(); return geometry;
}
function makeLandmarkSolids(resources) {
  const group = new THREE.Group(); group.name = 'sunken-reach-authored-landmark-solids'; const materials = new Map();
  for (const solid of REEF_LANDMARK_SOLIDS) { const material = solid.material || 'stone'; if (!materials.has(material)) { const family = new THREE.Group(); family.name = `sunken-reach-${material}-collision-landmarks`; materials.set(material, family); group.add(family); } const art = new THREE.Group(); art.name = `sunken-reach-solid-${solid.id}`; art.position.set(solid.x, solid.y, solid.z); const single = resources.batch(solid.id === 'garden-spire' ? 'coral' : material === 'wood' ? 'timber' : material); addLandmarkSolid(single, solid); art.add(single.mesh()); materials.get(material).add(art); }
  group.userData.solidIds = REEF_LANDMARK_SOLIDS.map(solid => solid.id); return group;
}
function makeMarker(id, point, color, height = 3.4) {
  const group = new THREE.Group(); group.name = `sunken-reach-${id}-marker`; group.position.set(point.x, point.y || .35, point.z);
  const glow = new THREE.Mesh(new THREE.ConeGeometry(.52, height, 10, 1, true), ownedMaterial(color, { transparent: true, opacity: .095, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.y = height / 2;
  const icon = new THREE.Mesh(new THREE.OctahedronGeometry(.32), ownedMaterial(color, { transparent: true, opacity: .88, depthWrite: false })); icon.position.y = Math.min(height, 2.5); group.add(glow, icon); group.userData.icon = icon; group.userData.glow = glow; return group;
}
function makeDiscoveryArt(resources, discovery) {
  const group = new THREE.Group(); group.name = `sunken-reach-discovery-${discovery.id}-art`; group.position.set(discovery.x, discovery.y, discovery.z);
  const b = resources.batch(discovery.region === 'ember-vents' ? 'basalt' : discovery.region === 'crown-graveyard' || discovery.region === 'sunken-reach' ? 'timber' : discovery.region === 'coral-gardens' ? 'coral' : 'stone'), wornStone = '#829c9a', barnacle = '#d8c998', wood = '#594738';
  switch (discovery.id) {
    case 'reach-figurehead': b.line([0, -1.5, 0], [0, 1.7, 0], .32, wood, .7); b.add('sphere', [0, .9, -.18], [.64, .72, .34], [0, 0, 0], '#c69c6c'); b.add('box', [0, 1.58, -.1], [1.5, .13, .22], [0, 0, .2], '#6e5640'); b.line([0, .6, .12], [0, -.8, .5], .08, '#b78d4f', .6); b.line([0, 1.7, 0], [0, 4.0, 0], .045, '#896d4c', .75); b.add('sphere', [0, 4.25, 0], [.42, .42, .42], [0, 0, 0], '#c99855'); break;
    case 'reach-watchtower': for (const side of [-1, 1]) { b.line([side * .9, -2.4, 0], [side * .55, 1.8, 0], .12, wood, .72); b.line([side * .9, -2.4, -.18], [-side * .55, 1.8, -.18], .055, '#7b6048', .7); } b.add('box', [0, -.4, 0], [2.4, .18, .5], [0, 0, .04], '#735944'); b.add('box', [0, 1.72, 0], [1.45, .14, .62], [0, 0, 0], '#604a38'); b.line([0, -.2, 0], [1.7, 1.15, .2], .08, '#667d70', .7); b.add('sphere', [1.78, 1.17, .22], [.22, .3, .16], [0, 0, 0], '#cf9a55'); break;
    case 'garden-fan': addFanCoralDiscovery(b); break;
    case 'garden-spire': addSpireDiscoveryCrown(b); break;
    case 'kelp-anchor': ring(b, [0, 0, 0], 1.2, '#596865'); b.line([0, .9, 0], [0, 2.1, 0], .11, '#596865', .8); for (const side of [-1, 1]) { b.line([0, -.8, 0], [side * 1.2, -1.35, 0], .12, '#596865', .7); b.line([side * .76, -.52, 0], [side * 1.52, .94, .22], .052, '#4c8868', .44); b.add('sphere', [side * 1.48, 1.08, .22], [.18, .56, .08], [0, side, .3], '#79aa78'); } break;
    case 'kelp-window': for (const side of [-1, 1]) b.line([side * 1.7, -1.8, 0], [side * 1.1, 1.6, 0], .2, wornStone, .65); b.line([-1.1, 1.6, 0], [1.1, 1.6, 0], .2, wornStone, .65); for (const side of [-1, 1]) { b.line([side * 1.45, -1.8, .18], [side * 1.15, 1.3, .18], .06, '#376e59', .45); b.add('sphere', [side * 1.2, .35, .18], [.2, .72, .06], [0, side, .3], '#6ca77b'); } break;
    case 'bell-plinth': for (let row = 0; row < 3; row++) for (let x = -1; x <= 1; x++) b.add('box', [x * .62 + (row % 2 ? .12 : 0), -1.15 + row * .38, 0], [.56, .32, 1.16], [0, row * .08, 0], row % 2 ? wornStone : '#b6c2bd'); b.add('box', [0, .12, 0], [1.25, .14, 1.25], [0, .3, 0], '#c5b77c'); b.add('sphere', [0, .45, 0], [.33, .42, .33], [0, 0, 0], barnacle); break;
    case 'bell-crown': for (let i = 0; i < 6; i++) b.line([0, -.8, 0], [Math.sin(i * TAU / 6) * 1.7, .8, Math.cos(i * TAU / 6) * 1.7], .09, '#4d7473', .7); ring(b, [0, .8, 0], 1.7, '#b2935c'); b.line([0, .8, 0], [0, -.15, 0], .045, '#587a75', .7); b.add('cone', [0, -.45, 0], [.5, .65, .5], [Math.PI, 0, 0], '#b68e54'); ring(b, [0, -.15, 0], .43, '#d1b874'); break;
    case 'ember-mouth': for (let i = 0; i < 7; i++) { const a = i * TAU / 7, r = 1.08 + (i % 2) * .18; b.add('pebble', [Math.sin(a) * r, -.76 + i % 2 * .11, Math.cos(a) * r], [.53, .38, .46], [.1, a, .1], i % 2 ? '#263236' : '#4a4e4c'); b.line([Math.sin(a) * .58, -.48, Math.cos(a) * .58], [Math.sin(a) * 1.15, -.35, Math.cos(a) * 1.15], .035, '#ca754a', .58); } b.add('sphere', [0, -.83, 0], [.68, .09, .68], [0, 0, 0], '#172426'); for (const side of [-1, 1]) b.line([side * .62, -1.0, 0], [side * .85, -2.05, .18], .24, '#343b3b', .76); break;
    case 'ember-stack': for (let i = 0; i < 5; i++) { const y = -1.42 + i * .67, r = 1.08 - i * .11; b.add('pebble', [Math.sin(i * 1.9) * .12, y, Math.cos(i * 1.4) * .12], [r, .57, r * .88], [0, i * .38, .08], i % 2 ? '#2c393c' : '#505456'); if (i % 2 === 0) b.line([r * .48, y - .2, 0], [r * .64, y + .24, .08], .032, '#bd6e48', .55); } break;
    case 'crown-keel': b.line([-1.65, -1.0, 0], [1.65, -1.0, 0], .22, wood, .75); b.line([-1.45, -1.0, 0], [0, .9, 0], .18, '#c09258', .7); b.line([0, .9, 0], [1.45, -1.0, 0], .18, '#c09258', .7); for (let i = 0; i < 4; i++) { const x = -1.2 + i * .8; b.line([x, -1, 0], [x, .4 + (i % 2) * .35, .18], .09, '#765540', .7); b.add('box', [x, -.92, -.18], [.66, .12, .26], [0, 0, .04], i % 2 ? '#76543e' : '#4e4136'); } for (let i = 0; i < 3; i++) b.add('sphere', [-.7 + i * .7, -.7, -.2], [.14, .22, .12], [0, 0, 0], barnacle); break;
    case 'crown-mast': b.line([0, -2.3, 0], [0, 1.7, 0], .18, wood, .72); b.line([0, .75, 0], [1.4, .15, .1], .06, '#8b9a87', .75); b.line([0, 1.05, 0], [-1.05, .52, -.12], .07, '#70523f', .72); b.line([0, .3, 0], [1.08, -.52, .18], .045, '#79968a', .72); b.add('box', [.72, .35, .12], [1.25, 1.0, .06], [0, 0, -.35], '#657f75'); break;
  }
  const signal = new THREE.Mesh(new THREE.SphereGeometry(.13, 6, 5), ownedMaterial('#d9fff0', { transparent: true, opacity: .85, depthWrite: false })); signal.name = 'discovery-pearl-signal'; signal.position.y = 1.9; group.add(b.mesh(), signal); group.userData.signal = signal; return group;
}
function makeCacheCradle(resources, cache) {
  const group = new THREE.Group(); group.name = `sunken-reach-cache-${cache.id}-cradle`; group.position.set(cache.x, cache.y, cache.z); const b = resources.batch(cache.region === 'ember-vents' ? 'basalt' : 'stone'), floor = floorY(cache.x, cache.z) - cache.y;
  // Every cache lies away from the sea floor, so its basket is visibly moored
  // to an anchor below and a small buoy above rather than floating unsupported.
  b.add('pebble', [0, floor + .3, 0], [1.15, .5, 1.0], [0, .25, 0], cache.region === 'ember-vents' ? '#544840' : '#82938a'); b.line([0, floor + .55, 0], [0, .18, 0], .035, '#866e50', .85); b.add('sphere', [0, .92, 0], [.38, .38, .38], [0, 0, 0], '#cf9c59'); for (let i = 0; i < 3; i++) b.line([0, .16, 0], [Math.sin(i * TAU / 3) * .9, -.28, Math.cos(i * TAU / 3) * .9], .06, '#785943', .7);
  group.add(b.mesh()); return group;
}
function makeChime(resources, node) {
  const group = new THREE.Group(); group.name = `sunken-reach-chime-${node.id}`; group.position.set(node.x, node.y, node.z); const b = resources.batch('bronze');
  for (const side of [-1, 1]) { b.line([side * .9, -1.4, 0], [side * .65, 1.35, 0], .11, '#728f8a', .7); b.line([side * .9, -1.35, -.16], [-side * .65, 1.35, -.16], .045, '#587c75', .72); } b.line([-.65, 1.35, 0], [.65, 1.35, 0], .12, '#758d8d', .7); b.line([0, 1.3, 0], [0, .8, 0], .035, '#607b6e', .7); bellSkirt(b, [0, .18, 0], [.68, .78, .68], '#b99755'); ring(b, [0, .69, 0], .61, '#d2be76'); b.add('sphere', [0, -.32, 0], [.13, .16, .13], [0, 0, 0], '#604d35');
  const clapper = new THREE.Group(); clapper.name = `sunken-reach-chime-${node.id}-clapper`; const clapperMesh = new THREE.Mesh(new THREE.SphereGeometry(.15, 6, 5), ownedMaterial('#765838')); clapperMesh.position.y = -.3; clapper.add(clapperMesh); group.add(b.mesh(), clapper); group.userData.clapper = clapper; return group;
}
function makeRayCage(resources, node) {
  const group = new THREE.Group(); group.name = `sunken-reach-ray-cage-${node.id}`; group.position.set(node.x, node.y, node.z); const b = resources.batch('bronze');
  for (const side of [-1, 1]) for (const depth of [-1, 1]) { b.line([side * .9, -1.1, depth * .7], [side * .9, 1.1, depth * .7], .055, '#a6824e', .75); b.line([side * .9, -.86, depth * .7], [side * .9, .9, depth * .7], .023, '#cfad63', .7); } for (const y of [-.85, .9]) b.add('box', [0, y, 0], [1.95, .07, 1.55], [0, .2, 0], '#866c4c');
  const door = new THREE.Group(); door.name = `sunken-reach-ray-cage-${node.id}-door`; for (const x of [-.35, 0, .35]) door.add(new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 1.55, 5), ownedMaterial('#b7975b'))); for (let i = 0; i < door.children.length; i++) door.children[i].position.set(-.92 + i * .35, 0, -.77); door.position.y = 0; group.add(b.mesh(), door);
  const ray = new THREE.Group(); ray.name = `sunken-reach-ray-cage-${node.id}-ray`; const body = new THREE.Mesh(new THREE.SphereGeometry(.42, 7, 5), ownedMaterial('#6d9d9a')); body.scale.set(1.55, .22, 1.0); const tail = new THREE.Mesh(new THREE.ConeGeometry(.09, .85, 5), ownedMaterial('#4d7778')); tail.rotation.x = Math.PI / 2; tail.position.z = .62; ray.add(body, tail); ray.position.y = -.12; group.add(ray); group.userData.door = door; group.userData.ray = ray; return group;
}
function makeCrownStation(resources, event) {
  const group = new THREE.Group(); group.name = `sunken-reach-event-${event.id}-salvage-crown`; group.position.set(event.x, event.y, event.z); const b = resources.batch('bronze');
  b.add('pebble', [0, -1.15, 0], [2.1, .65, 1.8], [0, .2, 0], '#6e687b'); ring(b, [0, -.45, 0], 1.28, '#b88b4d'); for (let i = 0; i < 6; i++) { const a = i * TAU / 6, base = [Math.sin(a) * 1.18, -.58, Math.cos(a) * 1.18], tip = [Math.sin(a) * .84, 1.2 + (i % 2) * .5, Math.cos(a) * .84]; b.line(base, tip, .12, '#c39c5b', .52); b.add('sphere', tip, [.13, .2, .13], [0, a, 0], '#d8bc6b'); } group.add(b.mesh()); return group;
}
function makeReturnCurrent() {
  const current = new THREE.Group(); current.name = 'sunken-reach-return-current'; current.position.set(REEF_EXIT.x + 1.55, REEF_EXIT.y - 1.45, REEF_EXIT.z + 1.1);
  const material = ownedMaterial('#a5f5df', { transparent: true, opacity: .12, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(.48 + i * .22, .028, 5, 16), material); ring.rotation.x = Math.PI / 2; ring.position.y = i * .42; current.add(ring); }
  const beam = new THREE.Mesh(new THREE.ConeGeometry(.72, 22, 10, 1, true), ownedMaterial('#9beee0', { transparent: true, opacity: .018, depthWrite: false, blending: THREE.AdditiveBlending })); beam.position.y = 10; current.add(beam);
  const label = labelSprite('Return', '#d9fff0'); label.position.y = 2; label.scale.set(.92, .17, 1); current.add(label); return current;
}
function entries(snapshot, key) { return snapshot?.[key] || snapshot?.underwater?.[key] || []; }
function hasId(values, id) { return values.some(value => (typeof value === 'string' ? value : value?.id) === id); }
function isNear(player, point, distance = 38) { const p = player?.position || player; return !p || !Number.isFinite(p.x) || Math.hypot(p.x - point.x, (p.y ?? point.y) - point.y, p.z - point.z) <= distance; }

export function createUnderwaterPresentation({ palette, heightAt }) {
  const resources = createReefResources(palette), habitat = createReefHabitat(resources);
  const group = new THREE.Group(); group.name = 'sunken-reach-six-biome-expedition'; group.add(habitat.group, makeWreckLandmark(resources), makeLandmarkSolids(resources), makeLandmarkSupports(resources, REEF_LANDMARK_SUPPORTS), makeRegionalLandmarkCompositions(resources, REGION));
  const current = makeReturnCurrent(); group.add(current);
  const legacy = buildChest(palette), legacyBeam = makeMarker('legacy-chest', REEF_CHEST, '#f1bc69', 5.2); legacy.group.name = 'sunken-reach-guarded-chest'; legacy.group.position.set(REEF_CHEST.x, REEF_CHEST.y, REEF_CHEST.z); legacy.group.rotation.y = -.25; group.add(legacy.group, legacyBeam);
  const caches = REEF_CACHES.map(cache => { const chest = buildChest(palette), marker = makeMarker(`cache-${cache.id}`, cache, '#f4c56f', .9), cradle = makeCacheCradle(resources, cache); chest.group.name = `sunken-reach-cache-${cache.id}`; chest.group.position.set(cache.x, cache.y, cache.z); group.add(cradle, chest.group, marker); return { cache, chest, marker, cradle }; });
  const discoveries = REEF_DISCOVERIES.map(discovery => { const art = makeDiscoveryArt(resources, discovery); group.add(art); return { discovery, art }; });
  const events = REEF_EVENTS.map(event => { const station = event.kind === 'defense' ? makeCrownStation(resources, event) : makeMarker(`event-${event.id}`, event, '#9be5df', 1.15); group.add(station); const nodes = event.nodes.map(node => { const art = event.kind === 'chimes' ? makeChime(resources, node) : makeRayCage(resources, node); group.add(art); return { node, art }; }); return { event, station, nodes }; });
  const shafts = new THREE.Group(); shafts.name = 'sunken-reach-regional-light-shafts'; for (const region of REEF_REGIONS) { shafts.add(softShaft(region.accent, region.x, region.z)); const dapple = new THREE.Mesh(new THREE.CircleGeometry(5.2, 12), ownedMaterial(region.accent, { transparent: true, opacity: .028, depthWrite: false, blending: THREE.AdditiveBlending })); dapple.rotation.x = -Math.PI / 2; dapple.position.set(region.x, floorY(region.x, region.z) + .05, region.z); shafts.add(dapple); } group.add(shafts);
  const bubbles = [], fish = [], bubbleMaterial = ownedMaterial('#d5fff1', { transparent: true, opacity: .48, depthWrite: false }), fishMaterial = ownedMaterial('#e9b264');
  const bubbleBatch = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), bubbleMaterial, 58), fishBatch = new THREE.InstancedMesh(fishGeometry(), fishMaterial, 24); bubbleBatch.name = 'sunken-reach-batched-bubbles'; fishBatch.name = 'sunken-reach-batched-fish'; bubbleBatch.frustumCulled = false; fishBatch.frustumCulled = false; group.add(bubbleBatch, fishBatch);
  for (let i = 0; i < 58; i++) { const region = REEF_REGIONS[i % REEF_REGIONS.length], atVent = region.id === 'ember-vents', mainMouth = atVent && i % 3 === 1; bubbles.push({ index: i, size: .04 + i % 3 * .023, x: mainMouth ? 101 + Math.sin(i) * .9 : region.x - 20 + i * 7 % 40, z: mainMouth ? -55 + Math.cos(i) * .8 : region.z - 18 + i * 11 % 36, phase: i * .77, baseY: mainMouth ? 28.55 : atVent ? 4.5 + i % 4 * 1.9 : .25, rise: atVent ? 5 + i % 4 : 5 + i % 12 }); }
  for (let i = 0; i < 24; i++) { const region = REEF_REGIONS[i % REEF_REGIONS.length]; fish.push({ index: i, phase: i * .59, radius: 4 + i % 5, centerX: region.x, centerZ: region.z }); fishBatch.setColorAt(i, new THREE.Color(i % 2 ? '#e9b264' : '#e77f73')); }
  fishBatch.instanceColor.needsUpdate = true; const instance = new THREE.Object3D(); instance.scale.setScalar(0); instance.updateMatrix(); for (let i = 0; i < bubbles.length; i++) bubbleBatch.setMatrixAt(i, instance.matrix); for (let i = 0; i < fish.length; i++) fishBatch.setMatrixAt(i, instance.matrix); bubbleBatch.instanceMatrix.needsUpdate = true; fishBatch.instanceMatrix.needsUpdate = true;
  const diveMarker = new THREE.Group(); diveMarker.name = 'sunken-reach-dive-tide-pool-marker'; const shoreY = heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z), pool = new THREE.Mesh(new THREE.CircleGeometry(2, 24), ownedMaterial('#3cc4c5', { transparent: true, opacity: .72, depthWrite: false })); pool.rotation.x = -Math.PI / 2; pool.position.set(DIVE_ENTRANCE.x, shoreY + .04, DIVE_ENTRANCE.z); const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, .1, 6, 24), ownedMaterial('#d7d59a')); ring.rotation.x = Math.PI / 2; ring.position.copy(pool.position); const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.32), ownedMaterial('#a7f3df', { transparent: true, opacity: .85, depthWrite: false })); marker.position.set(DIVE_ENTRANCE.x, shoreY + 1.15, DIVE_ENTRANCE.z); const diveLabel = labelSprite('Dive: Sunken Reach'); diveLabel.position.set(DIVE_ENTRANCE.x, shoreY + 2, DIVE_ENTRANCE.z); diveMarker.add(pool, ring, marker, diveLabel);
  let lowQuality = false, disposed = false;
  return { group, diveMarker,
    update(time, snapshot = {}, { lowQuality: low = false, reducedMotion = false, player = null } = {}) {
      snapshot = snapshot || {}; lowQuality = low; marker.rotation.y = reducedMotion ? 0 : time * .8; marker.position.y = shoreY + 1.15 + (reducedMotion ? 0 : Math.sin(time * 2) * .1); pool.material.opacity = .58 + (reducedMotion ? 0 : Math.sin(time * 1.6) * .12);
      const isReefPlayer = !player || player.realm === 'reef' || player.mode === 'swimming';
      if (!isReefPlayer) return;
      habitat.update(time, { lowQuality, reducedMotion, player }); current.rotation.y = reducedMotion ? 0 : time * .65; current.position.y = REEF_EXIT.y - 1.45 + (reducedMotion ? 0 : Math.sin(time * 1.4) * .06);
      const old = snapshot.chests?.find(item => item.id === REEF_CHEST.id) || snapshot.underwater || {}, opened = !!(old.opened || old.chestOpened), guarded = (snapshot.underwater?.remaining ?? old.remaining ?? 0) > 0; legacy.animate(time, opened, { reducedMotion }); legacyBeam.visible = !opened; legacyBeam.userData.glow.material.color.set(guarded ? '#df7d79' : '#f1bc69');
      const openedCaches = entries(snapshot, 'caches'), found = entries(snapshot, 'discoveries'), eventState = entries(snapshot, 'events');
      for (const entry of caches) { const cacheState = openedCaches.find(value => value?.id === entry.cache.id), cacheOpened = !!cacheState?.opened; entry.chest.animate(time, cacheOpened, { reducedMotion }); entry.marker.visible = !cacheOpened && isNear(player, entry.cache); }
      for (const entry of discoveries) { const foundHere = hasId(found, entry.discovery.id); entry.art.userData.signal.material.color.set(foundHere ? '#4f978c' : '#d9fff0'); entry.art.userData.signal.material.opacity = foundHere ? .22 : .85; }
      for (const entry of events) { const active = eventState.find(value => value?.id === entry.event.id) || {}, complete = active.status === 'completed'; if (entry.station.userData.icon) { entry.station.visible = isNear(player, entry.event); entry.station.userData.icon.material.color.set(complete ? '#5c988d' : active.status === 'active' ? '#f2d57a' : '#9be5df'); } for (const node of entry.nodes) { const done = hasId(active.progress || [], node.node.id); if (entry.event.kind === 'chimes') node.art.userData.clapper.rotation.z = done ? (reducedMotion ? .32 : Math.sin(time * 12) * .55) : 0; else { node.art.userData.door.rotation.y = done ? 1.35 : 0; node.art.userData.ray.position.set(done ? 2.2 + (reducedMotion ? 0 : Math.sin(time * 1.8) * .35) : 0, -.12 + (reducedMotion ? 0 : Math.sin(time * 2 + node.node.x) * .08), done ? .7 : 0); } } }
      const decorativeTime = reducedMotion ? 0 : time;
      for (let i = 0; i < bubbles.length; i++) { const bubble = bubbles[i], visible = !lowQuality || i % 2 === 0; instance.position.set(bubble.x + Math.sin(decorativeTime * .7 + bubble.phase) * .25, bubble.baseY + ((decorativeTime * .62 + bubble.phase) % bubble.rise), bubble.z); instance.scale.setScalar(visible ? bubble.size : 0); instance.rotation.set(0, 0, 0); instance.updateMatrix(); bubbleBatch.setMatrixAt(bubble.index, instance.matrix); } bubbleBatch.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < fish.length; i++) { const f = fish[i], a = decorativeTime * (.28 + i % 3 * .04) + f.phase, visible = !lowQuality || i % 2 === 0; instance.position.set(f.centerX + Math.sin(a) * f.radius, 3 + i % 3 * .75 + Math.sin(a * 2) * .18, f.centerZ + Math.cos(a) * f.radius * .45); instance.scale.set(visible ? .15 : 0, visible ? .15 : 0, visible ? .27 : 0); instance.rotation.set(0, -a - Math.PI / 2, 0); instance.updateMatrix(); fishBatch.setMatrixAt(f.index, instance.matrix); } fishBatch.instanceMatrix.needsUpdate = true;
    },
    shotBubbles(from, to) { const geometry = new THREE.BufferGeometry(), positions = []; for (let i = 0; i < 8; i++) positions.push((Math.random() - .5) * .25, (Math.random() - .5) * .25, (Math.random() - .5) * .25); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#c9fff3', size: .09, transparent: true, opacity: .8, depthWrite: false })); points.position.copy(from); group.add(points); return { object: points, update(age) { points.position.lerp(to, Math.min(1, age * 2.7)); points.material.opacity = Math.max(0, 1 - age / .5); }, life: .5 }; },
    getStats() { return { ready: true, kind: 'sunken-reach', wreckSolids: (REEF_WRECK_SOLIDS || REEF_SOLIDS.filter(solid => solid.id.startsWith('wreck-'))).length, landmarkSolids: REEF_LANDMARK_SOLIDS.length, landmarkSupports: REEF_LANDMARK_SUPPORTS.length, regions: REEF_REGIONS.length, discoveries: discoveries.length, caches: caches.length, encounters: REEF_ENCOUNTERS.length, events: events.length, bubbles: bubbles.length, fish: fish.length, chest: REEF_CHEST.id, lowQuality, resources: { materials: Object.keys(resources.materials).length, texturesPerMaterial: 3 }, habitat: habitat.getStats() }; },
    dispose() { if (disposed) return; disposed = true; for (const shaft of shafts.children) shaft.userData.dispose?.(); resources.dispose(); },
  };
}
