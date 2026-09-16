import * as THREE from 'three';
import { REEF_BOUNDS, REEF_CHEST, REEF_EXIT, REEF_SPAWN } from '../shared/underwater.js';
import { REEF_CACHES, REEF_DISCOVERIES, REEF_ENCOUNTERS, REEF_EVENTS, REEF_REGIONS } from '../shared/underwater-content.js';

const TAU = Math.PI * 2;
const GROUNDS = Object.freeze({
  'sunken-reach': ['#d8d3a9', '#82b9af'], 'coral-gardens': ['#ead0a3', '#d88b82'],
  'kelp-hollows': ['#89966c', '#405f51'], 'bell-sanctuary': ['#b3c3c1', '#6b849c'],
  'ember-vents': ['#9b7558', '#77534a'], 'crown-graveyard': ['#777787', '#615c79'],
});

function noise(x, z, seed = 1) { const n = Math.sin(x * 127.1 + z * 311.7 + seed * 19.19) * 43758.5453; return n - Math.floor(n); }
export function floorY(x, z) {
  // Terrain is deliberately only cosmetic: it reads as rippled ground without
  // ever affecting the authoritative y=0 collision floor.
  return Math.max(-.32, Math.min(.42, Math.sin(x * .167 - z * .113) * .105 + Math.cos(z * .243 + x * .077) * .075 + (noise(x, z) - .5) * .075));
}

function regionAt(x, z) {
  let total = 0, color = new THREE.Color(0, 0, 0), accent = new THREE.Color(0, 0, 0);
  for (const region of REEF_REGIONS) {
    const distance = Math.hypot(x - region.x, z - region.z), weight = 1 / Math.max(8, distance) ** 2;
    const [base, detail] = GROUNDS[region.id]; color.add(new THREE.Color(base).multiplyScalar(weight)); accent.add(new THREE.Color(detail).multiplyScalar(weight)); total += weight;
  }
  color.multiplyScalar(1 / total); accent.multiplyScalar(1 / total);
  return { color, accent };
}

function seabed(resources) {
  const segments = 78, width = REEF_BOUNDS.maxX - REEF_BOUNDS.minX + 8, depth = REEF_BOUNDS.maxZ - REEF_BOUNDS.minZ + 8;
  const geometry = new THREE.PlaneGeometry(width, depth, segments, segments), position = geometry.attributes.position, colors = [], uvs = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = -position.getY(i), tone = regionAt(x, z);
    const ripple = Math.sin(x * .55 + z * .14) * .055 + Math.sin(z * .39 - x * .08) * .035;
    position.setZ(i, floorY(x, z) + ripple);
    const tint = tone.color.clone().lerp(tone.accent, .08 + noise(x * 1.9, z * 1.9, 8) * .13 + Math.max(0, ripple) * .8);
    colors.push(tint.r, tint.g, tint.b);
    // The generated sand texture is measured in metres, so its ripples stay
    // legible from ordinary swim-camera distances instead of stretching once
    // across the entire realm.
    uvs.push(x / 16, z / 16);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, resources.materials.sand); mesh.name = 'sunken-reach-six-biome-seabed'; mesh.rotation.x = -Math.PI / 2; mesh.receiveShadow = true; mesh.userData.triangles = segments * segments * 2;
  return mesh;
}

const pointOf = entry => [entry.x, entry.z];
function clearPoints() {
  return [REEF_EXIT, REEF_CHEST, REEF_SPAWN, ...REEF_CACHES, ...REEF_DISCOVERIES, ...REEF_EVENTS, ...REEF_EVENTS.flatMap(event => event.nodes), ...REEF_EVENTS.flatMap(event => event.guards || []), ...REEF_ENCOUNTERS.flatMap(entry => entry.guards)].map(pointOf);
}
function clearOfInteraction(x, z, radius = 4.8) { return clearPoints().every(([px, pz]) => Math.hypot(x - px, z - pz) >= radius); }
function addRock(batch, x, z, size, color) { batch.add('pebble', [x, floorY(x, z) + size * .28, z], [size * (1 + noise(x, z) * .4), size * .55, size * (.78 + noise(z, x) * .35)], [.12, noise(x, z, 5) * TAU, .1], color); }
function coralShelf() {
  // A genuinely thick plate has a top, shaded underside and irregular rim.
  // The old single fan was a paper-thin pink star from side views.
  const positions = [0, .075, 0, 0, -.095, 0], indices = [], sides = 18;
  for (let i = 0; i < sides; i++) {
    const a = i / sides * TAU, r = .78 + Math.sin(i * 3.1) * .09 + Math.sin(i * 5.2 + .4) * .05;
    positions.push(Math.sin(a) * r, .07 + Math.sin(i * 2) * .022, Math.cos(a) * r);
    positions.push(Math.sin(a) * r * .97, -.085 + Math.sin(i * 2) * .014, Math.cos(a) * r * .97);
  }
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides, top = 2 + i * 2, bottom = top + 1, nextTop = 2 + next * 2, nextBottom = nextTop + 1;
    indices.push(0, top, nextTop, 1, nextBottom, bottom, top, bottom, nextTop, nextTop, bottom, nextBottom);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
function fanWeb() {
  const front = [0, 0, .025], indices = [], sides = 13;
  for (let i = 0; i < sides; i++) { const a = -1.16 + i / (sides - 1) * 2.32; front.push(Math.sin(a), .66 + Math.cos(a) * .22, Math.cos(a) * .18 + .025); }
  const back = [];
  for (let i = 0; i < front.length; i += 3) back.push(front[i], front[i + 1], front[i + 2] - .05);
  const positions = [...front, ...back], backOffset = sides + 1;
  for (let i = 0; i < sides - 1; i++) {
    indices.push(0, i + 1, i + 2, backOffset, backOffset + i + 2, backOffset + i + 1);
    // A narrow rim avoids a paper silhouette when a swimmer passes the fan.
    indices.push(i + 1, backOffset + i + 1, i + 2, i + 2, backOffset + i + 1, backOffset + i + 2);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
function brainCoral(batch, brain, x, z, scale, colors, angle = 0) {
  const floor = floorY(x, z);
  for (let lobe = 0; lobe < 3; lobe++) {
    const a = angle + lobe * TAU / 3, sx = scale * (.52 - lobe * .05);
    batch.add(brain, [x + Math.sin(a) * scale * .24, floor + scale * (.22 + lobe * .035), z + Math.cos(a) * scale * .24], [sx, scale * (.32 - lobe * .025), sx * .86], [.06, a, -.05], colors[lobe % colors.length]);
  }
}
function antler(batch, stub, root, scale, color, angle, forks = 3) {
  const trunkA = [root[0] + Math.sin(angle) * scale * .08, root[1] + scale * .48, root[2] + Math.cos(angle) * scale * .08];
  const trunkB = [root[0] + Math.sin(angle + .32) * scale * .22, root[1] + scale * .9, root[2] + Math.cos(angle + .32) * scale * .22];
  batch.line(root, trunkA, scale * .13, color, .72); batch.line(trunkA, trunkB, scale * .1, color, .62);
  for (let fork = 0; fork < forks; fork++) {
    const a = angle + (fork - (forks - 1) / 2) * .72, elbow = [trunkB[0] + Math.sin(a) * scale * .38, trunkB[1] + scale * (.32 + fork % 2 * .08), trunkB[2] + Math.cos(a) * scale * .38];
    batch.line(trunkB, elbow, scale * .075, color, .52);
    const tipAngle = a + (fork % 2 ? .29 : -.29), tip = [elbow[0] + Math.sin(tipAngle) * scale * .28, elbow[1] + scale * .27, elbow[2] + Math.cos(tipAngle) * scale * .28];
    batch.line(elbow, tip, scale * .05, color, .36);
    batch.add(stub, tip, [scale * .07, scale * .1, scale * .07], [0, tipAngle, 0], color);
  }
}
function coralBush(batch, shelf, brain, stub, x, z, scale, colors, branches = 3) {
  const floor = floorY(x, z), angle = noise(x, z, 19) * TAU;
  brainCoral(batch, brain, x, z, scale * .76, colors, angle);
  batch.add(shelf, [x, floor + scale * .28, z], [scale * .72, scale, scale * .72], [.1, angle, -.07], colors[0]);
  for (let i = 0; i < branches; i++) {
    const a = angle + i * TAU / branches, root = [x + Math.sin(a) * scale * .22, floor + scale * .2, z + Math.cos(a) * scale * .22];
    antler(batch, stub, root, scale * (.62 + (i % 2) * .08), colors[(i + 1) % colors.length], a, 2);
  }
}
function fan(batch, web, x, z, scale, color) {
  const floor = floorY(x, z);
  batch.add(web, [x, floor + .06, z], [scale, scale, scale], [0, noise(x, z) * TAU, 0], color);
  for (let i = 0; i < 10; i++) {
    const angle = -1.1 + i * .245, end = [x + Math.sin(angle) * scale, floor + scale * (.72 + Math.cos(angle) * .14), z + Math.cos(angle) * scale * .26];
    batch.line([x, floor + .08, z], end, scale * .038, color, .28);
  }
}
function coralColony(batch, shelf, web, brain, stub, x, z, scale, colors) {
  const floor = floorY(x, z), angle = noise(x, z, 71) * TAU;
  // A colony is a linked stack of weathered plates, cups and antlers. These
  // read as one broad living shelf from a swim route rather than a pot of
  // identical small sprigs.
  for (let layer = 0; layer < 3; layer++) {
    const size = scale * (1.75 - layer * .35), y = floor + scale * (.34 + layer * .72);
    batch.add(shelf, [x + Math.sin(angle + layer) * scale * .18, y, z + Math.cos(angle + layer) * scale * .18], [size, scale * (1.15 + layer * .1), size], [layer % 2 ? -.17 : .13, angle + layer * .74, .08], colors[layer % colors.length]);
  }
  brainCoral(batch, brain, x, z, scale * 1.12, colors, angle);
  for (let branch = 0; branch < 5; branch++) {
    const a = angle + branch * TAU / 5, root = [x + Math.sin(a) * scale * .5, floor + scale * .42, z + Math.cos(a) * scale * .5];
    antler(batch, stub, root, scale * (.92 + branch % 2 * .1), colors[(branch + 1) % colors.length], a, 2);
  }
  fan(batch, web, x + Math.sin(angle) * scale * .25, z + Math.cos(angle) * scale * .25, scale * 1.25, colors[1]);
}
function sponge(batch, x, z, scale, color) {
  const floor = floorY(x, z);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1, h = scale * (.7 + i * .18);
    batch.add('cone', [x + Math.sin(a) * scale * .18, floor + h * .5, z + Math.cos(a) * scale * .18], [scale * (.22 + i * .04), h, scale * (.22 + i * .04)], [.08, a, .04], color);
    batch.add('ring', [x + Math.sin(a) * scale * .18, floor + h + .01, z + Math.cos(a) * scale * .18], [scale * (.18 + i * .03), scale * (.18 + i * .03), scale * (.18 + i * .03)], [Math.PI / 2, 0, 0], '#e9d5a0');
  }
}
function kelpBlade() {
  const positions = [], indices = [], steps = 7;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, width = (Math.sin(t * Math.PI) * .21 + .065) * (1 + Math.sin(t * TAU * 1.5) * .12);
    // The local depth bend is intentionally comparable to a quarter of the
    // rendered leaf length (whose Y scale is much larger than X/Z).  A soft
    // tip droop stops the canopy reading as straight triangular reeds.
    const bend = Math.sin(t * Math.PI) * .34 + t * t * 1.15, y = t - Math.max(0, t - .58) ** 2 * .9;
    positions.push(-width, y, bend, width, y, bend);
    if (i < steps) { const p = i * 2; indices.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
function kelpPlant(batch, blade, x, z, scale, tall) {
  const floor = floorY(x, z), stems = tall ? 3 : 2, height = scale * (tall ? 10.8 : 2.1);
  for (let stem = 0; stem < stems; stem++) {
    const sx = x + (stem - (stems - 1) / 2) * scale * .16;
    let previous = [sx, floor + .04, z];
    for (let segment = 1; segment <= 4; segment++) {
      const t = segment / 4, next = [sx + Math.sin(stem * 1.71 + t * 1.8) * scale * (.12 + t * 1.12), floor + height * t, z + Math.cos(stem * 1.34 + t * 1.5) * scale * (.08 + t * .86)];
      batch.line(previous, next, scale * (tall ? .06 - t * .018 : .04 - t * .01), stem % 2 ? '#2e6c54' : '#3e7658', .48); previous = next;
    }
    const leaves = tall ? 3 : 2;
    for (let leaf = 1; leaf <= leaves; leaf++) {
      const y = floor + height * leaf / (leaves + 1), side = leaf % 2 ? 1 : -1;
      // Broad, curved ribbon blades create a canopy silhouette; the kelp
      // material bends their upper vertices in the shader.
      batch.add(blade, [sx + Math.sin(stem + leaf) * scale * .15, y - scale * .08, z + Math.cos(stem + leaf) * scale * .12], [scale * (tall ? .95 : .62), scale * (tall ? 4.2 : .65), scale], [side * .92, stem * 1.71 + leaf * .7, side * .38], leaf % 2 ? '#5d9b6f' : '#7ab47c');
    }
  }
}

export function createReefHabitat(resources) {
  if (!resources?.batch || !resources?.materials) throw new TypeError('createReefHabitat needs reef resources');
  const group = new THREE.Group(); group.name = 'sunken-reach-reef-habitat';
  const compositions = new THREE.Group(); compositions.name = 'sunken-reach-biome-compositions';
  const detail = new THREE.Group(); detail.name = 'sunken-reach-biome-small-detail';
  group.add(seabed(resources), compositions, detail);
  const stone = resources.batch('stone'), basalt = resources.batch('basalt'), coral = resources.batch('coral'), kelp = resources.batch('kelp'), sand = resources.batch('sand'), rope = resources.batch('rope'), blade = kelpBlade(), shelf = coralShelf(), web = fanWeb(), brain = new THREE.SphereGeometry(1, 7, 5), stub = new THREE.SphereGeometry(1, 6, 4);
  const detailStone = resources.batch('stone'), detailSand = resources.batch('sand'), detailCoral = resources.batch('coral');
  const plantCenters = [];
  let plants = 0, shells = 0;
  for (const region of REEF_REGIONS) {
    const isKelp = region.id === 'kelp-hollows', isGarden = region.id === 'coral-gardens', isVent = region.id === 'ember-vents';
    const primary = isVent ? basalt : stone, rockColor = isVent ? '#3b4548' : region.id === 'bell-sanctuary' ? '#9cb2b4' : region.id === 'crown-graveyard' ? '#70857d' : '#7e9e94';
    const count = isKelp ? 58 : isGarden ? 25 : region.id === 'sunken-reach' ? 18 : 27;
    for (let i = 0; i < count; i++) {
      const a = i * 2.399 + noise(region.x, region.z, i) * .8, r = 8 + ((i * 17) % 31), x = region.x + Math.sin(a) * r, z = region.z + Math.cos(a) * r;
      if (!clearOfInteraction(x, z, 5)) continue;
      addRock(primary, x, z, .42 + (i % 4) * .13, rockColor);
      if (isKelp) { kelpPlant(kelp, blade, x, z, .74 + (i % 4) * .08, true); plants++; plantCenters.push({ x, z, clearance: 5 }); }
      else if (isGarden || region.id === 'sunken-reach') { coralBush(coral, shelf, brain, stub, x, z, .45 + (i % 4) * .13, isGarden ? ['#eea07e', '#e68491', '#f1c16e', '#b87aba'] : ['#db907a', '#e6b86b', '#db786f']); plants++; plantCenters.push({ x, z, clearance: 5 }); if (isGarden && i % 3 === 0) fan(coral, web, x + .45, z - .35, .72, i % 2 ? '#dc7e91' : '#e9ad76'); }
      else if (i % 2 === 0) { sponge(coral, x, z, .48 + (i % 3) * .1, region.id === 'crown-graveyard' ? '#b95050' : region.id === 'bell-sanctuary' ? '#e1dfba' : '#b87967'); plants++; plantCenters.push({ x, z, clearance: 5 }); }
      if (i % 3 === 0) { const sx = x + Math.cos(a) * 1.05, sz = z - Math.sin(a) * 1.05; detailSand.add('pebble', [sx, floorY(sx, sz) + .035, sz], [.13, .032, .09], [0, a, 0], '#eee0b7'); shells++; }
    }
    // Sparse understory gives non-kelp regions life without closing swim lanes.
    if (!isKelp) for (let i = 0; i < 8; i++) { const a = i * .83, x = region.x + Math.sin(a) * (30 + i % 3 * 2), z = region.z + Math.cos(a) * (29 + i % 4 * 2); if (clearOfInteraction(x, z, 4.5)) { kelpPlant(kelp, blade, x, z, .45, false); plants++; plantCenters.push({ x, z, clearance: 4.5 }); } }
  }
  // Deliberate regional clusters make each place readable at a distance.
  for (let i = 0; i < 10; i++) { const a = i * TAU / 10, x = -70 + Math.sin(a) * (12 + i % 3 * 3), z = 72 + Math.cos(a) * (10 + i % 4 * 2); if (clearOfInteraction(x, z)) { coralBush(coral, shelf, brain, stub, x, z, .8 + i % 3 * .12, ['#efad82', '#df7f8c', '#edca7d', '#ae75ae'], 3); plants++; plantCenters.push({ x, z, clearance: 4.8 }); } }
  for (const [x, z, scale] of [[-48, 78, 1.6], [-54, 92, 1.35], [-70, 98, 1.75], [-91, 91, 1.5], [-99, 79, 1.25], [-80, 86, 1.7], [-58, 70, 1.35]]) if (clearOfInteraction(x, z, 5.5)) { coralColony(coral, shelf, web, brain, stub, x, z, scale, ['#f3a27f', '#e07e91', '#f0c26d', '#b779ad']); plants++; plantCenters.push({ x, z, clearance: 5.5 }); }
  for (let i = 0; i < 16; i++) { const a = i * TAU / 16 + .2, x = -88 + Math.sin(a) * 28, z = -20 + Math.cos(a) * 24; if (clearOfInteraction(x, z, 5.4)) { kelpPlant(kelp, blade, x, z, 1.05 + i % 3 * .1, true); plants++; plantCenters.push({ x, z, clearance: 5.4 }); } }
  for (let i = 0; i < 24; i++) { const x = -124 + (i * 23 % 248), z = i % 2 ? -129 + (i * 29 % 55) : 126 - (i * 31 % 55); if (clearOfInteraction(x, z, 4.5)) { detailStone.add('pebble', [x, floorY(x, z) + .12, z], [.32, .21, .28], [0, i, .1], '#a9ac93'); detailCoral.add('sphere', [x + .25, floorY(x + .25, z) + .09, z], [.16, .11, .15], [0, 0, 0], '#d6c79b'); } }
  compositions.add(stone.mesh(), basalt.mesh(), coral.mesh(), kelp.mesh({ shadow: false }), sand.mesh({ shadow: false }), rope.mesh({ shadow: false }));
  detail.add(detailStone.mesh(), detailSand.mesh({ shadow: false }), detailCoral.mesh({ shadow: false }));
  blade.dispose();
  shelf.dispose(); web.dispose(); brain.dispose(); stub.dispose();
  group.userData.plantCenters = plantCenters;
  let state = { lowQuality: false, reducedMotion: false };
  const getStats = () => {
    let triangles = 0, drawCalls = 0; group.traverse(node => { if (node.isMesh) { drawCalls++; triangles += node.userData.triangles || (node.geometry.index ? node.geometry.index.count / 3 : node.geometry.attributes.position.count / 3); } });
    return { regions: REEF_REGIONS.length, plants, plantSites: plantCenters.length, shells, lowQuality: state.lowQuality, reducedMotion: state.reducedMotion, drawCalls, triangles, clearancePoints: clearPoints().length, minimumClearance: 4.5 };
  };
  return { group, update(time = 0, { lowQuality = false, reducedMotion = false, player = null } = {}) {
    state = { lowQuality: !!lowQuality, reducedMotion: !!reducedMotion }; detail.visible = !state.lowQuality;
    resources.update(time, { reducedMotion: state.reducedMotion });
    // Keep this read-only: it lets integration pass a player without habitat
    // taking ownership of its transform or authority.
    group.userData.playerRegion = player && Number.isFinite(player.x) && Number.isFinite(player.z) ? regionAt(player.x, player.z).color.getHexString() : null;
  }, getStats };
}
