import * as THREE from 'three';
import { GeoBatch, buildChest } from './models.js';
import { DIVE_ENTRANCE, REEF_CHEST, REEF_EXIT, REEF_SOLIDS, REEF_WRECK_SOLIDS } from '../shared/underwater.js';
import { REEF_REGIONS, REEF_DISCOVERIES, REEF_CACHES, REEF_ENCOUNTERS, REEF_EVENTS, REEF_LANDMARK_SOLIDS, reefRegionAt } from '../shared/underwater-content.js';

const TAU = Math.PI * 2;
const REGION = Object.fromEntries(REEF_REGIONS.map(region => [region.id, region]));
const MATERIAL = { stone: '#668b8d', wood: '#493c32', basalt: '#343b3d' };
const SEABED = { 'sunken-reach': ['#d9d1a3', '#9ec4b2'], 'coral-gardens': ['#d8bb92', '#c9807d'], 'kelp-hollows': ['#8da27c', '#4b8065'], 'bell-sanctuary': ['#9ba8a5', '#637e9e'], 'ember-vents': ['#9b7657', '#9f5840'], 'crown-graveyard': ['#817b89', '#6c638b'] };

function ownedMaterial(color, options = {}) { return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, ...options }); }
function ring(batch, position, radius, color) { const geometry = new THREE.TorusGeometry(1, .12, 6, 12); batch.add(geometry, position, [radius, radius, radius], [Math.PI / 2, 0, 0], color); geometry.dispose(); }
function labelSprite(text, color = '#efffdc') {
  if (typeof document === 'undefined') return new THREE.Group();
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96; const context = canvas.getContext('2d'); if (!context) return new THREE.Group();
  context.font = 'bold 34px Trebuchet MS, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineWidth = 8; context.strokeStyle = '#173d4a';
  context.strokeText(text, 256, 48); context.fillStyle = color; context.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })); sprite.scale.set(1.55, .29, 1); return sprite;
}
function makeSeabed() {
  const geometry = new THREE.PlaneGeometry(276, 276, 84, 84), position = geometry.attributes.position, colors = [];
  for (let i = 0; i < position.count; i++) {
    // A plane rotated -90 degrees maps local Y to negative world Z.
    const x = position.getX(i), z = -position.getY(i), region = reefRegionAt(x, z), [ground, wear] = SEABED[region.id], base = new THREE.Color(ground), accent = new THREE.Color(wear);
    position.setZ(i, floorY(x, z));
    const tint = base.lerp(accent, Math.max(.08, Math.min(.42, .12 + .13 * Math.sin(x * .19 + z * .13) + .08 * Math.cos(z * .38 - x * .17)))); colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true })); mesh.rotation.x = -Math.PI / 2; mesh.name = 'sunken-reach-six-biome-seabed'; return mesh;
}
function floorY(x, z) { return Math.sin(x * .33 - z * .21) * .13 + Math.cos(z * .48) * .08; }
function coral(batch, x, z, scale, color) {
  const floor = floorY(x, z); for (let i = 0; i < 5; i++) { const a = i * 1.27 + x * .23, h = scale * (.6 + (i % 3) * .24), end = [x + Math.sin(a) * scale * .38, floor + h, z + Math.cos(a) * scale * .38]; batch.line([x, floor + .03, z], end, scale * .09, color, .42); batch.add('sphere', end, [scale * .14, scale * .17, scale * .14], [0, 0, 0], i % 2 ? '#e58f78' : '#e7b569'); }
}
function kelp(batch, x, z, scale, tall = false) {
  const height = scale * (tall ? 5.2 : 1.75), floor = floorY(x, z);
  for (let i = 0; i < 3; i++) { const dx = (i - 1) * scale * .15, top = [x + dx + Math.sin(i * 1.8) * scale * .22, floor + height * (1 + i * .08), z + Math.cos(i * 1.8) * scale * .25]; batch.line([x + dx, floor + .03, z], top, .042 * scale, tall ? '#285f51' : '#397e61', .45); for (let leaf = 1; leaf < 4; leaf++) batch.add('sphere', [top[0] + Math.sin(leaf + i) * scale * .23, floor + (top[1] - floor) * leaf / 4, top[2]], [.13 * scale, .52 * scale, .04 * scale], [0, i, .45], tall ? '#57956e' : '#66a978'); }
}
function rocks(batch, x, z, count, color, scale = 1) {
  for (let i = 0; i < count; i++) { const a = i * 2.4 + x * .1, r = (.65 + i % 3 * .34) * scale, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r; batch.add('pebble', [px, floorY(px, pz) + .36 * scale, pz], [scale * (.7 + i % 2 * .5), scale * (.55 + i % 3 * .28), scale * (.65 + i % 2 * .35)], [.12, a, .08], color); }
}
function makeWreck(palette) {
  const group = new THREE.Group(); group.name = 'sunken-reach-wreck-solid-hull'; const wood = new GeoBatch(palette), fittings = new GeoBatch(palette);
  for (const solid of REEF_WRECK_SOLIDS || REEF_SOLIDS.filter(solid => solid.id.startsWith('wreck-'))) wood.add('box', [solid.x, solid.y, solid.z], [solid.width, solid.height, solid.depth], [0, 0, 0], solid.id === 'wreck-deck' ? '#493c32' : '#382f2a');
  for (let x = -3; x <= 19; x += 2.15) wood.add('box', [x, 1.03, -10], [1.72, .08, 17.4], [0, 0, .015], x % 4 ? '#5d4937' : '#382f2e');
  for (const x of [-3.45, 19.45]) for (const z of [-17, -11, -5]) fittings.add('cylinder', [x, 5.4, z], [.13, 6.8, .13], [.05, 0, .05], '#557b72');
  for (const x of [-2.2, 18.2]) fittings.add('box', [x, 6.78, -10], [.16, .16, 17.9], [0, 0, 0], '#527a70');
  for (const x of [2, 14]) { fittings.add('cylinder', [x, 4, -1.15], [.17, 6, .17], [0, 0, .04], '#655141'); fittings.add('box', [x, 6.8, -1.15], [3.9, .18, .2], [0, 0, 0], '#5b4838'); }
  for (const z of [-16.5, -13, -9.5, -6, -2.5]) { fittings.line([-3.82, 1.02, z], [-4.15, 5.7, z], .12, '#705640', .72); fittings.line([19.82, 1.02, z], [20.18, 5.7, z], .12, '#705640', .72); }
  for (const side of [-1, 1]) for (const y of [1.35, 2.25, 3.15, 4.05, 4.95]) fittings.add('box', [side < 0 ? -4.52 : 20.52, y, -10], [.07, .13, 17.35], [0, 0, .01], y % 2 ? '#74553e' : '#5a4132');
  for (const side of [-1, 1]) { fittings.line([side < 0 ? -3.7 : 19.7, 1, -1.52], [side < 0 ? -2.3 : 18.3, 4.7, -.72], .13, '#765842', .72); fittings.line([side < 0 ? -2.3 : 18.3, 4.7, -.72], [side < 0 ? -.6 : 16.6, 5.45, -.35], .09, '#765842', .68); }
  fittings.line([11.5, 1.2, -12.5], [14.8, 8.1, -15.1], .19, '#4b3a31', .84); fittings.line([13.1, 4.5, -13.8], [18.8, 4.8, -15.6], .055, '#667d70'); for (const x of [3.8, 7.2, 10.6, 14]) fittings.add('box', [x, 5.9, -18.35], [2.7, .13, .14], [0, -.08, 0], '#624b39');
  group.add(wood.mesh(), fittings.mesh()); return group;
}
function addWeatheredSolid(batch, solid) {
  const { id, width: w, height: h, depth: d, material } = solid, stone = '#789797', pale = '#a7bab2', timber = '#5c4938';
  if (material === 'basalt') {
    const sections = Math.max(3, Math.round(h / 5)); for (let i = 0; i < sections; i++) { const t = i / sections, y = -h / 2 + h * (i + .5) / sections; batch.add('cylinder', [0, y, 0], [w * (.48 - t * .08), h / sections * .9, d * (.48 - t * .08)], [0, i * .43, .04], i % 2 ? '#3e4749' : '#303b3e'); if (i % 2 === 1) ring(batch, [0, y - h / sections * .35, 0], Math.min(w, d) * .38, '#9e6042'); }
    return;
  }
  if (material === 'wood') {
    if (id.includes('keel')) {
      // Layered side, bow and stern planks fill the collision hull's full
      // silhouette, so its sixteen-metre envelope reads as a closed wreck.
      const rows = Math.max(6, Math.round(h / 1.7));
      for (let row = 0; row < rows; row++) { const y = -h / 2 + h * (row + .5) / rows, color = row % 3 ? timber : '#765942'; for (const side of [-1, 1]) batch.add('box', [side * w * .36, y, 0], [.14, h / rows * .86, d * .9], [0, 0, side * .025], color); for (const end of [-1, 1]) batch.add('box', [0, y, end * d * .44], [w * .72, h / rows * .82, .14], [0, end * .035, 0], row % 2 ? '#694f3b' : '#87634a'); }
      for (let z = -d * .40; z <= d * .40; z += 2.1) { batch.add('box', [0, -h * .16 + Math.sin(z) * .25, z], [w * .68, h * .12, 1.45], [0, .08, 0], z % 4 ? timber : '#765942'); batch.line([-w * .34, -h * .26, z], [w * .34, h * .26, z], .08, '#87634a', .72); }
    } else if (w > d * 2) { const sections = Math.max(4, Math.round(w / 2)); for (let i = 0; i < sections; i++) { const x = -w / 2 + w * (i + .5) / sections; batch.add('box', [x, 0, 0], [w / sections * .94, h * .78, d * .78], [0, i % 2 ? .025 : -.025, 0], i % 3 ? timber : '#85634b'); if (i % 2 === 0) batch.add('box', [x, h * .34, -d * .3], [w / sections * .82, .09, .08], [0, 0, 0], '#a17b58'); }
    } else { batch.add('cylinder', [0, 0, 0], [Math.min(w, d) * .42, h * .92, Math.min(w, d) * .42], [.04, 0, .04], timber); for (let y = -h * .32; y < h * .42; y += 2.4) ring(batch, [0, y, 0], Math.min(w, d) * .43, '#80634c'); }
    return;
  }
  if (id.includes('spire')) { const sections = Math.max(10, Math.round(h / 2.35)); for (let i = 0; i < sections; i++) { const t = i / sections, y = -h / 2 + h * (i + .5) / sections, radius = .55 - t * .30, side = i % 2 ? 1 : -1; batch.add('pebble', [Math.sin(i * 2.1) * .14, y, Math.cos(i * 1.7) * .14], [w * radius, h / sections * .86, d * radius], [i * .17, i * .48, .12], i % 2 ? '#d98d82' : '#eed29a'); if (i % 2 === 0) { const root = [side * w * radius * .26, y, .08], tip = [side * w * radius * .60, y + h / sections * .58, .25]; batch.line(root, tip, .09, '#d97878', .38); batch.line(tip, [tip[0] + side * .35, tip[1] + .52, tip[2] - .22], .065, '#e9a06f', .32); batch.line(tip, [tip[0] - side * .12, tip[1] + .46, tip[2] + .34], .06, '#f0bc78', .30); batch.add('sphere', tip, [.18, .2, .16], [0, 0, 0], '#ef927b'); } }
  } else if (w > h * 1.6) { const sections = Math.max(3, Math.round(w / 4)); for (let i = 0; i < sections; i++) { const x = -w / 2 + w * (i + .5) / sections; batch.add('pebble', [x, 0, 0], [w / sections * .78, h * .68, d * .72], [0, i * .28, .05], i % 2 ? stone : pale); if (i % 2 === 0) batch.add('sphere', [x, h * .38, d * .35], [.16, .16, .12], [0, 0, 0], '#d9c98a'); }
  } else { const sections = Math.max(3, Math.round(h / 4)); for (let i = 0; i < sections; i++) { const t = i / sections, y = -h / 2 + h * (i + .5) / sections; batch.add('pebble', [Math.sin(i * 1.8) * .12, y, Math.cos(i * 2.1) * .12], [w * (.68 - t * .1), h / sections * .8, d * (.68 - t * .1)], [.08, i * .42, .05], i % 2 ? stone : pale); if (i % 2 === 0) batch.add('sphere', [w * .34, y, 0], [.14, .18, .14], [0, 0, 0], '#d9c98a'); }
  }
}
function makeLandmarkSolids(palette) {
  const group = new THREE.Group(); group.name = 'sunken-reach-authored-landmark-solids'; const materials = new Map();
  for (const solid of REEF_LANDMARK_SOLIDS) { const material = solid.material || 'stone'; if (!materials.has(material)) { const family = new THREE.Group(); family.name = `sunken-reach-${material}-collision-landmarks`; materials.set(material, family); group.add(family); } const art = new THREE.Group(); art.name = `sunken-reach-solid-${solid.id}`; art.position.set(solid.x, solid.y, solid.z); const single = new GeoBatch(palette); addWeatheredSolid(single, solid); art.add(single.mesh()); materials.get(material).add(art); }
  group.userData.solidIds = REEF_LANDMARK_SOLIDS.map(solid => solid.id); return group;
}
function makeBiomeLife(palette) {
  const group = new THREE.Group(); group.name = 'sunken-reach-biome-compositions'; const b = new GeoBatch(palette);
  for (let i = 0; i < 76; i++) { const side = i % 4, along = -132 + (i * 31 % 264), x = side < 2 ? (side ? 134 : -134) : along, z = side < 2 ? along : (side === 2 ? -134 : 134), region = reefRegionAt(x, z); rocks(b, x, z, 2 + i % 3, region.accent, 1.3 + i % 3 * .28); if (i % 3 === 0) kelp(b, x + Math.sin(i), z + Math.cos(i), .75); }
  for (const region of REEF_REGIONS) { const count = region.id === 'coral-gardens' || region.id === 'kelp-hollows' ? 36 : 22; for (let i = 0; i < count; i++) { const a = i * 2.399 + region.x, r = 9 + (i * 11 % 32), x = region.x + Math.sin(a) * r, z = region.z + Math.cos(a) * r; rocks(b, x, z, 2 + i % 2, region.accent, .7 + i % 4 * .22); if (region.id === 'kelp-hollows') kelp(b, x, z, .9 + i % 3 * .18, true); else if (region.id === 'coral-gardens' || region.id === 'sunken-reach') { coral(b, x, z, .72 + i % 4 * .19, i % 2 ? region.color : region.accent); if (region.id === 'coral-gardens' && i % 3 === 0) coral(b, x + 1.1, z - .7, .55, '#e99a8d'); } else if (i % 2 === 0) coral(b, x, z, .5 + i % 2 * .18, region.accent); } }
  const bells = REGION['bell-sanctuary']; for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + .2, x = bells.x + Math.sin(a) * 12, z = bells.z + Math.cos(a) * 12, h = 12 + i * 3; for (let segment = 0; segment < 4; segment++) b.add('pebble', [x + Math.sin(segment * 1.8) * .12, h * (segment + .5) / 4, z + Math.cos(segment * 1.8) * .12], [2.25 - segment * .14, h / 4 * .78, 2.25 - segment * .14], [.05, segment * .48, .04], segment % 2 ? '#789393' : '#9aada4'); b.add('cylinder', [x, h + 1.2, z], [2.3, 2.4, .45], [Math.PI / 2, 0, 0], '#9b8860'); b.line([x, h + .9, z], [bells.x, 15, bells.z], .12, '#426f70', .55); }
  const vents = REGION['ember-vents']; for (let i = 0; i < 7; i++) { const a = i * .9, x = vents.x + Math.sin(a) * (5 + i % 3 * 3), z = vents.z + Math.cos(a) * (5 + i % 3 * 3), h = 5 + i % 4 * 2.3; b.add('cylinder', [x, h / 2, z], [1.1, h, 1.1], [0, a, .05], '#353d3e'); b.add('sphere', [x, h + .15, z], [.7, .28, .7], [0, 0, 0], '#c26d43'); }
  const graves = REGION['crown-graveyard']; for (let i = 0; i < 8; i++) { const a = i * .79, x = graves.x + Math.sin(a) * (7 + i % 3 * 3), z = graves.z + Math.cos(a) * (7 + i % 3 * 3); b.line([x, .35, z], [x + Math.sin(a) * 2, 5 + i % 3 * 2.4, z + Math.cos(a) * 2], .18, '#4e4135', .68); if (i % 2 === 0) b.line([x - 2, 1.2, z], [x + 2.6, 2.8, z + .5], .13, '#715745', .7); }
  group.add(b.mesh()); return group;
}
function makeMarker(id, point, color, height = 3.4) {
  const group = new THREE.Group(); group.name = `sunken-reach-${id}-marker`; group.position.set(point.x, point.y || .35, point.z);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(.14, .6, height, 8, 1, true), ownedMaterial(color, { transparent: true, opacity: .13, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.y = height / 2;
  const icon = new THREE.Mesh(new THREE.OctahedronGeometry(.32), ownedMaterial(color, { transparent: true, opacity: .88, depthWrite: false })); icon.position.y = Math.min(height, 2.5); group.add(glow, icon); group.userData.icon = icon; group.userData.glow = glow; return group;
}
function makeDiscoveryArt(palette, discovery) {
  const group = new THREE.Group(); group.name = `sunken-reach-discovery-${discovery.id}-art`; group.position.set(discovery.x, discovery.y, discovery.z);
  const b = new GeoBatch(palette), wornStone = '#829c9a', barnacle = '#d8c998', wood = '#594738';
  switch (discovery.id) {
    case 'reach-figurehead': b.line([0, -1.5, 0], [0, 1.7, 0], .32, wood, .7); b.add('sphere', [0, .9, -.18], [.64, .72, .34], [0, 0, 0], '#c69c6c'); b.add('box', [0, 1.58, -.1], [1.5, .13, .22], [0, 0, .2], '#6e5640'); b.line([0, .6, .12], [0, -.8, .5], .08, '#b78d4f', .6); b.line([0, 1.7, 0], [0, 4.0, 0], .045, '#896d4c', .75); b.add('sphere', [0, 4.25, 0], [.42, .42, .42], [0, 0, 0], '#c99855'); break;
    case 'reach-watchtower': for (const side of [-1, 1]) b.line([side * .9, -2.4, 0], [side * .55, 1.8, 0], .12, wood, .72); b.add('box', [0, -.4, 0], [2.4, .18, .5], [0, 0, .04], '#735944'); b.line([0, -.2, 0], [1.7, 1.15, .2], .08, '#667d70', .7); break;
    case 'garden-fan': for (let i = 0; i < 9; i++) b.line([0, -1.2, 0], [Math.sin(i * .55) * 2.0, .65 + Math.cos(i * .55) * .35, Math.cos(i * .55) * .35], .08, i % 2 ? '#de7985' : '#f3b26d', .28); rocks(b, 0, 0, 3, '#c47a72', .65); break;
    case 'garden-spire': for (let i = 0; i < 6; i++) b.add('sphere', [Math.sin(i * 1.8) * .28, -1.7 + i * .72, Math.cos(i * 1.8) * .28], [1.0 - i * .1, .58, 1.0 - i * .1], [0, i, .15], i % 2 ? '#f0c785' : '#e78692'); break;
    case 'kelp-anchor': ring(b, [0, 0, 0], 1.2, '#596865'); b.line([0, .9, 0], [0, 2.1, 0], .11, '#596865', .8); for (const side of [-1, 1]) b.line([0, -.8, 0], [side * 1.2, -1.35, 0], .12, '#596865', .7); break;
    case 'kelp-window': for (const side of [-1, 1]) b.line([side * 1.7, -1.8, 0], [side * 1.1, 1.6, 0], .2, wornStone, .65); b.line([-1.1, 1.6, 0], [1.1, 1.6, 0], .2, wornStone, .65); for (const side of [-1, 1]) { b.line([side * 1.45, -1.8, .18], [side * 1.15, 1.3, .18], .06, '#376e59', .45); b.add('sphere', [side * 1.2, .35, .18], [.2, .72, .06], [0, side, .3], '#6ca77b'); } break;
    case 'bell-plinth': b.add('cylinder', [0, -.7, 0], [1.3, 1.1, 1.3], [0, 0, 0], wornStone); b.add('box', [0, .12, 0], [1.25, .14, 1.25], [0, .3, 0], '#c5b77c'); b.add('sphere', [0, .45, 0], [.33, .42, .33], [0, 0, 0], barnacle); break;
    case 'bell-crown': for (let i = 0; i < 6; i++) b.line([0, -.8, 0], [Math.sin(i * TAU / 6) * 1.7, .8, Math.cos(i * TAU / 6) * 1.7], .09, '#4d7473', .7); ring(b, [0, .8, 0], 1.7, '#b2935c'); break;
    case 'ember-mouth': b.add('cylinder', [0, -.65, 0], [1.55, .95, 1.55], [0, 0, 0], '#3b4040'); b.add('sphere', [0, -.08, 0], [.75, .18, .75], [0, 0, 0], '#e69050'); for (let i = 0; i < 4; i++) b.line([0, 0, 0], [Math.sin(i * 1.57) * 1.15, .28, Math.cos(i * 1.57) * 1.15], .09, '#5c4a40', .7); break;
    case 'ember-stack': for (let i = 0; i < 4; i++) b.add('cylinder', [0, -1.4 + i * .75, 0], [1.1 - i * .12, .72, 1.1 - i * .12], [0, i * .3, 0], i % 2 ? '#3b4040' : '#596063'); ring(b, [0, .25, 0], 1.05, '#b56c45'); break;
    case 'crown-keel': b.line([-1.65, -1.0, 0], [1.65, -1.0, 0], .22, wood, .75); b.line([-1.45, -1.0, 0], [0, .9, 0], .18, '#c09258', .7); b.line([0, .9, 0], [1.45, -1.0, 0], .18, '#c09258', .7); for (let i = 0; i < 3; i++) b.add('sphere', [-.7 + i * .7, -.7, -.2], [.14, .22, .12], [0, 0, 0], barnacle); break;
    case 'crown-mast': b.line([0, -2.3, 0], [0, 1.7, 0], .18, wood, .72); b.line([0, .75, 0], [1.4, .15, .1], .06, '#8b9a87', .75); b.add('box', [.72, .35, .12], [1.25, 1.0, .06], [0, 0, -.35], '#657f75'); break;
  }
  const signal = new THREE.Mesh(new THREE.SphereGeometry(.13, 6, 5), ownedMaterial('#d9fff0', { transparent: true, opacity: .85, depthWrite: false })); signal.name = 'discovery-pearl-signal'; signal.position.y = 1.9; group.add(b.mesh(), signal); group.userData.signal = signal; return group;
}
function makeCacheCradle(palette, cache) {
  const group = new THREE.Group(); group.name = `sunken-reach-cache-${cache.id}-cradle`; group.position.set(cache.x, cache.y, cache.z); const b = new GeoBatch(palette), floor = floorY(cache.x, cache.z) - cache.y;
  // Every cache lies away from the sea floor, so its basket is visibly moored
  // to an anchor below and a small buoy above rather than floating unsupported.
  b.add('pebble', [0, floor + .3, 0], [1.15, .5, 1.0], [0, .25, 0], cache.region === 'ember-vents' ? '#544840' : '#82938a'); b.line([0, floor + .55, 0], [0, .18, 0], .035, '#866e50', .85); b.add('sphere', [0, .92, 0], [.38, .38, .38], [0, 0, 0], '#cf9c59'); for (let i = 0; i < 3; i++) b.line([0, .16, 0], [Math.sin(i * TAU / 3) * .9, -.28, Math.cos(i * TAU / 3) * .9], .06, '#785943', .7);
  group.add(b.mesh()); return group;
}
function makeChime(palette, node) {
  const group = new THREE.Group(); group.name = `sunken-reach-chime-${node.id}`; group.position.set(node.x, node.y, node.z); const b = new GeoBatch(palette);
  for (const side of [-1, 1]) b.line([side * .9, -1.4, 0], [side * .65, 1.35, 0], .11, '#809896', .7); b.line([-.65, 1.35, 0], [.65, 1.35, 0], .12, '#758d8d', .7); b.add('cylinder', [0, .2, 0], [.62, 1.28, .62], [0, 0, 0], '#b99755'); ring(b, [0, .76, 0], .62, '#d2be76');
  const clapper = new THREE.Group(); clapper.name = `sunken-reach-chime-${node.id}-clapper`; const clapperMesh = new THREE.Mesh(new THREE.SphereGeometry(.15, 6, 5), ownedMaterial('#765838')); clapperMesh.position.y = -.3; clapper.add(clapperMesh); group.add(b.mesh(), clapper); group.userData.clapper = clapper; return group;
}
function makeRayCage(palette, node) {
  const group = new THREE.Group(); group.name = `sunken-reach-ray-cage-${node.id}`; group.position.set(node.x, node.y, node.z); const b = new GeoBatch(palette);
  for (const side of [-1, 1]) for (const depth of [-1, 1]) b.line([side * .9, -1.1, depth * .7], [side * .9, 1.1, depth * .7], .055, '#a6824e', .75); for (const y of [-.85, .9]) b.add('box', [0, y, 0], [1.95, .07, 1.55], [0, .2, 0], '#866c4c');
  const door = new THREE.Group(); door.name = `sunken-reach-ray-cage-${node.id}-door`; for (const x of [-.35, 0, .35]) door.add(new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 1.55, 5), ownedMaterial('#b7975b'))); for (let i = 0; i < door.children.length; i++) door.children[i].position.set(-.92 + i * .35, 0, -.77); door.position.y = 0; group.add(b.mesh(), door);
  const ray = new THREE.Group(); ray.name = `sunken-reach-ray-cage-${node.id}-ray`; const body = new THREE.Mesh(new THREE.SphereGeometry(.42, 7, 5), ownedMaterial('#6d9d9a')); body.scale.set(1.55, .22, 1.0); const tail = new THREE.Mesh(new THREE.ConeGeometry(.09, .85, 5), ownedMaterial('#4d7778')); tail.rotation.x = Math.PI / 2; tail.position.z = .62; ray.add(body, tail); ray.position.y = -.12; group.add(ray); group.userData.door = door; group.userData.ray = ray; return group;
}
function makeCrownStation(palette, event) {
  const group = new THREE.Group(); group.name = `sunken-reach-event-${event.id}-salvage-crown`; group.position.set(event.x, event.y, event.z); const b = new GeoBatch(palette);
  b.add('pebble', [0, -1.15, 0], [2.1, .65, 1.8], [0, .2, 0], '#6e687b'); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; b.line([Math.sin(a) * 1.25, -.65, Math.cos(a) * 1.25], [Math.sin(a) * .72, .78 + (i % 2) * .35, Math.cos(a) * .72], .11, '#c39c5b', .65); } ring(b, [0, -.45, 0], 1.28, '#b88b4d'); group.add(b.mesh()); return group;
}
function makeReturnCurrent() {
  const current = new THREE.Group(); current.name = 'sunken-reach-return-current'; current.position.set(REEF_EXIT.x + 1.55, REEF_EXIT.y - 1.45, REEF_EXIT.z + 1.1);
  const material = ownedMaterial('#a5f5df', { transparent: true, opacity: .12, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(.48 + i * .22, .028, 5, 16), material); ring.rotation.x = Math.PI / 2; ring.position.y = i * .42; current.add(ring); }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.11, .2, 22, 8, 1, true), ownedMaterial('#9beee0', { transparent: true, opacity: .025, depthWrite: false, blending: THREE.AdditiveBlending })); beam.position.y = 10; current.add(beam);
  const label = labelSprite('Return', '#d9fff0'); label.position.y = 2; label.scale.set(.92, .17, 1); current.add(label); return current;
}
function entries(snapshot, key) { return snapshot?.[key] || snapshot?.underwater?.[key] || []; }
function hasId(values, id) { return values.some(value => (typeof value === 'string' ? value : value?.id) === id); }
function isNear(player, point, distance = 38) { const p = player?.position || player; return !p || !Number.isFinite(p.x) || Math.hypot(p.x - point.x, (p.y ?? point.y) - point.y, p.z - point.z) <= distance; }

export function createUnderwaterPresentation({ palette, heightAt }) {
  const group = new THREE.Group(); group.name = 'sunken-reach-six-biome-expedition'; group.add(makeSeabed(), makeWreck(palette), makeLandmarkSolids(palette), makeBiomeLife(palette));
  const current = makeReturnCurrent(); group.add(current);
  const legacy = buildChest(palette), legacyBeam = makeMarker('legacy-chest', REEF_CHEST, '#f1bc69', 5.2); legacy.group.name = 'sunken-reach-guarded-chest'; legacy.group.position.set(REEF_CHEST.x, REEF_CHEST.y, REEF_CHEST.z); legacy.group.rotation.y = -.25; group.add(legacy.group, legacyBeam);
  const caches = REEF_CACHES.map(cache => { const chest = buildChest(palette), marker = makeMarker(`cache-${cache.id}`, cache, '#f4c56f', .9), cradle = makeCacheCradle(palette, cache); chest.group.name = `sunken-reach-cache-${cache.id}`; chest.group.position.set(cache.x, cache.y, cache.z); group.add(cradle, chest.group, marker); return { cache, chest, marker, cradle }; });
  const discoveries = REEF_DISCOVERIES.map(discovery => { const art = makeDiscoveryArt(palette, discovery); group.add(art); return { discovery, art }; });
  const events = REEF_EVENTS.map(event => { const station = event.kind === 'defense' ? makeCrownStation(palette, event) : makeMarker(`event-${event.id}`, event, '#9be5df', 1.15); group.add(station); const nodes = event.nodes.map(node => { const art = event.kind === 'chimes' ? makeChime(palette, node) : makeRayCage(palette, node); group.add(art); return { node, art }; }); return { event, station, nodes }; });
  const shafts = new THREE.Group(); shafts.name = 'sunken-reach-regional-light-shafts'; for (const region of REEF_REGIONS) { const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 1.1, 28, 10, 1, true), ownedMaterial(region.accent, { transparent: true, opacity: .022, depthWrite: false, blending: THREE.AdditiveBlending })); shaft.position.set(region.x, 17, region.z); shafts.add(shaft); } group.add(shafts);
  const bubbles = [], fish = [], bubbleMaterial = ownedMaterial('#d5fff1', { transparent: true, opacity: .48, depthWrite: false }), fishMaterial = ownedMaterial('#e9b264');
  const bubbleBatch = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), bubbleMaterial, 58), fishBatch = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), fishMaterial, 24); bubbleBatch.name = 'sunken-reach-batched-bubbles'; fishBatch.name = 'sunken-reach-batched-fish'; bubbleBatch.frustumCulled = false; fishBatch.frustumCulled = false; group.add(bubbleBatch, fishBatch);
  for (let i = 0; i < 58; i++) { const region = REEF_REGIONS[i % REEF_REGIONS.length]; bubbles.push({ index: i, size: .04 + i % 3 * .023, x: region.x - 20 + i * 7 % 40, z: region.z - 18 + i * 11 % 36, phase: i * .77, top: 5 + i % 12 }); }
  for (let i = 0; i < 24; i++) { const region = REEF_REGIONS[i % REEF_REGIONS.length]; fish.push({ index: i, phase: i * .59, radius: 4 + i % 5, centerX: region.x, centerZ: region.z }); fishBatch.setColorAt(i, new THREE.Color(i % 2 ? '#e9b264' : '#e77f73')); }
  fishBatch.instanceColor.needsUpdate = true; const instance = new THREE.Object3D(); instance.scale.setScalar(0); instance.updateMatrix(); for (let i = 0; i < bubbles.length; i++) bubbleBatch.setMatrixAt(i, instance.matrix); for (let i = 0; i < fish.length; i++) fishBatch.setMatrixAt(i, instance.matrix); bubbleBatch.instanceMatrix.needsUpdate = true; fishBatch.instanceMatrix.needsUpdate = true;
  const diveMarker = new THREE.Group(); diveMarker.name = 'sunken-reach-dive-tide-pool-marker'; const shoreY = heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z), pool = new THREE.Mesh(new THREE.CircleGeometry(2, 24), ownedMaterial('#3cc4c5', { transparent: true, opacity: .72, depthWrite: false })); pool.rotation.x = -Math.PI / 2; pool.position.set(DIVE_ENTRANCE.x, shoreY + .04, DIVE_ENTRANCE.z); const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, .1, 6, 24), ownedMaterial('#d7d59a')); ring.rotation.x = Math.PI / 2; ring.position.copy(pool.position); const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.32), ownedMaterial('#a7f3df', { transparent: true, opacity: .85, depthWrite: false })); marker.position.set(DIVE_ENTRANCE.x, shoreY + 1.15, DIVE_ENTRANCE.z); const diveLabel = labelSprite('Dive: Sunken Reach'); diveLabel.position.set(DIVE_ENTRANCE.x, shoreY + 2, DIVE_ENTRANCE.z); diveMarker.add(pool, ring, marker, diveLabel);
  let lowQuality = false;
  return { group, diveMarker,
    update(time, snapshot = {}, { lowQuality: low = false, reducedMotion = false, player = null } = {}) {
      snapshot = snapshot || {}; lowQuality = low; current.rotation.y = reducedMotion ? 0 : time * .65; current.position.y = REEF_EXIT.y - 1.45 + (reducedMotion ? 0 : Math.sin(time * 1.4) * .06); marker.rotation.y = time * .8; marker.position.y = shoreY + 1.15 + (reducedMotion ? 0 : Math.sin(time * 2) * .1); pool.material.opacity = .58 + (reducedMotion ? 0 : Math.sin(time * 1.6) * .12);
      const old = snapshot.chests?.find(item => item.id === REEF_CHEST.id) || snapshot.underwater || {}, opened = !!(old.opened || old.chestOpened), guarded = (snapshot.underwater?.remaining ?? old.remaining ?? 0) > 0; legacy.animate(time, opened, { reducedMotion }); legacyBeam.visible = !opened; legacyBeam.userData.glow.material.color.set(guarded ? '#df7d79' : '#f1bc69');
      const openedCaches = entries(snapshot, 'caches'), found = entries(snapshot, 'discoveries'), eventState = entries(snapshot, 'events');
      for (const entry of caches) { const cacheState = openedCaches.find(value => value?.id === entry.cache.id), cacheOpened = !!cacheState?.opened; entry.chest.animate(time, cacheOpened, { reducedMotion }); entry.marker.visible = !cacheOpened && isNear(player, entry.cache); }
      for (const entry of discoveries) { const foundHere = hasId(found, entry.discovery.id); entry.art.userData.signal.material.color.set(foundHere ? '#4f978c' : '#d9fff0'); entry.art.userData.signal.material.opacity = foundHere ? .22 : .85; }
      for (const entry of events) { const active = eventState.find(value => value?.id === entry.event.id) || {}, complete = active.status === 'completed'; if (entry.station.userData.icon) { entry.station.visible = isNear(player, entry.event); entry.station.userData.icon.material.color.set(complete ? '#5c988d' : active.status === 'active' ? '#f2d57a' : '#9be5df'); } for (const node of entry.nodes) { const done = hasId(active.progress || [], node.node.id); if (entry.event.kind === 'chimes') node.art.userData.clapper.rotation.z = done ? (reducedMotion ? .32 : Math.sin(time * 12) * .55) : 0; else { node.art.userData.door.rotation.y = done ? 1.35 : 0; node.art.userData.ray.position.set(done ? 2.2 + (reducedMotion ? 0 : Math.sin(time * 1.8) * .35) : 0, -.12 + (reducedMotion ? 0 : Math.sin(time * 2 + node.node.x) * .08), done ? .7 : 0); } } }
      for (let i = 0; i < bubbles.length; i++) { const bubble = bubbles[i], visible = !lowQuality || i % 2 === 0; instance.position.set(bubble.x + Math.sin(time * .7 + bubble.phase) * .25, .25 + ((time * .62 + bubble.phase) % bubble.top), bubble.z); instance.scale.setScalar(visible ? bubble.size : 0); instance.rotation.set(0, 0, 0); instance.updateMatrix(); bubbleBatch.setMatrixAt(bubble.index, instance.matrix); } bubbleBatch.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < fish.length; i++) { const f = fish[i], a = time * (.28 + i % 3 * .04) + f.phase, visible = !lowQuality || i % 2 === 0; instance.position.set(f.centerX + Math.sin(a) * f.radius, 3 + i % 3 * .75 + (reducedMotion ? 0 : Math.sin(a * 2) * .18), f.centerZ + Math.cos(a) * f.radius * .45); instance.scale.set(visible ? .15 : 0, visible ? .15 : 0, visible ? .27 : 0); instance.rotation.set(0, -a - Math.PI / 2, 0); instance.updateMatrix(); fishBatch.setMatrixAt(f.index, instance.matrix); } fishBatch.instanceMatrix.needsUpdate = true;
    },
    shotBubbles(from, to) { const geometry = new THREE.BufferGeometry(), positions = []; for (let i = 0; i < 8; i++) positions.push((Math.random() - .5) * .25, (Math.random() - .5) * .25, (Math.random() - .5) * .25); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#c9fff3', size: .09, transparent: true, opacity: .8, depthWrite: false })); points.position.copy(from); group.add(points); return { object: points, update(age) { points.position.lerp(to, Math.min(1, age * 2.7)); points.material.opacity = Math.max(0, 1 - age / .5); }, life: .5 }; },
    getStats() { return { ready: true, kind: 'sunken-reach', wreckSolids: (REEF_WRECK_SOLIDS || REEF_SOLIDS.filter(solid => solid.id.startsWith('wreck-'))).length, landmarkSolids: REEF_LANDMARK_SOLIDS.length, regions: REEF_REGIONS.length, discoveries: discoveries.length, caches: caches.length, encounters: REEF_ENCOUNTERS.length, events: events.length, bubbles: bubbles.length, fish: fish.length, chest: REEF_CHEST.id, lowQuality }; },
  };
}
