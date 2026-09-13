import * as THREE from 'three';
import { GeoBatch, buildChest } from './models.js';
import { DIVE_ENTRANCE, REEF_CHEST, REEF_EXIT, REEF_SOLIDS } from '../shared/underwater.js';

const TAU = Math.PI * 2;

function ownedMaterial(color, options = {}) {
  return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, ...options });
}
function labelSprite(text, color = '#efffdc') {
  if (typeof document === 'undefined') return new THREE.Group();
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const context = canvas.getContext('2d'); if (!context) return new THREE.Group();
  context.font = 'bold 34px Trebuchet MS, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.lineWidth = 8; context.strokeStyle = '#173d4a'; context.strokeText(text, 256, 48); context.fillStyle = color; context.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })); sprite.scale.set(1.55, .29, 1); return sprite;
}

function makeSand() {
  const geometry = new THREE.PlaneGeometry(72, 76, 48, 48), position = geometry.attributes.position, colors = [];
  const pale = new THREE.Color('#d9d1a3'), shade = new THREE.Color('#b8c69d');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getY(i);
    position.setZ(i, Math.sin(x * .74 + z * .31) * .045 + Math.cos(z * 1.1) * .022);
    const tint = pale.clone().lerp(shade, .18 + .14 * Math.sin(x * 1.4 - z * .8)); colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'sunken-reach-pale-rippled-sand'; mesh.rotation.x = -Math.PI / 2; return mesh;
}

function coral(batch, x, z, scale, color) {
  for (let i = 0; i < 5; i++) {
    const a = i * 1.27 + x * .23, height = scale * (.6 + (i % 3) * .24);
    const end = [x + Math.sin(a) * scale * .38, height, z + Math.cos(a) * scale * .38];
    batch.line([x, .06, z], end, scale * .09, color, .42);
    batch.add('sphere', end, [scale * .14, scale * .17, scale * .14], [0, 0, 0], i % 2 ? '#e58f78' : '#e7b569');
  }
}
function kelp(batch, x, z, scale) {
  for (let i = 0; i < 3; i++) {
    const y = scale * (1.35 + i * .22), dx = (i - 1) * scale * .15;
    batch.line([x + dx, .03, z], [x + dx + Math.sin(i * 1.8) * .17, y, z + Math.cos(i * 1.8) * .17], .042 * scale, '#397e61', .45);
    batch.add('sphere', [x + dx + .1, y * .62, z], [.11 * scale, .42 * scale, .035 * scale], [0, i, .35], '#66a978');
  }
}

function makeWreck(palette) {
  const group = new THREE.Group(); group.name = 'sunken-reach-wreck-solid-hull';
  const wood = new GeoBatch(palette), fittings = new GeoBatch(palette);
  for (const solid of REEF_SOLIDS) {
    wood.add('box', [solid.x, solid.y, solid.z], [solid.width, solid.height, solid.depth], [0, 0, 0], solid.id === 'wreck-deck' ? '#493c32' : '#382f2a');
  }
  // Thin planks and beams sit on the exact collision boxes, adding an aged
  // hull silhouette without narrowing the contract's open south doorway.
  for (let x = -3; x <= 19; x += 2.15) wood.add('box', [x, 1.03, -10], [1.72, .08, 17.4], [0, 0, .015], x % 4 ? '#5d4937' : '#382f2e');
  for (const x of [-3.45, 19.45]) for (const z of [-17, -11, -5]) fittings.add('cylinder', [x, 5.4, z], [.13, 6.8, .13], [.05, 0, .05], '#557b72');
  for (const x of [-2.2, 18.2]) fittings.add('box', [x, 6.78, -10], [.16, .16, 17.9], [0, 0, 0], '#527a70');
  // The frame makes both routes obvious: low through the south doorway and high
  // over the open deck, while the north wall remains the real solid boundary.
  for (const x of [2.0, 14.0]) {
    fittings.add('cylinder', [x, 4.0, -1.15], [.17, 6.0, .17], [0, 0, .04], '#655141');
    fittings.add('box', [x, 6.8, -1.15], [3.9, .18, .20], [0, 0, 0], '#5b4838');
  }
  // Broken ribs, a fallen mast, and a short stern rail turn the collision hull
  // into a weathered ship without narrowing its shared low and high swim lanes.
  for (const z of [-16.5, -13, -9.5, -6, -2.5]) {
    fittings.line([-3.82, 1.02, z], [-4.15, 5.7, z], .12, '#705640', .72);
    fittings.line([19.82, 1.02, z], [20.18, 5.7, z], .12, '#705640', .72);
  }
  for (const side of [-1, 1]) for (const y of [1.35, 2.25, 3.15, 4.05, 4.95]) {
    fittings.add('box', [side < 0 ? -4.52 : 20.52, y, -10], [.07, .13, 17.35], [0, 0, .01], y % 2 ? '#74553e' : '#5a4132');
  }
  // A broken curved bow lip at the open south face makes the box contract read
  // as a ship while leaving the authoritative doorway completely clear.
  for (const side of [-1, 1]) {
    fittings.line([side < 0 ? -3.7 : 19.7, 1.0, -1.52], [side < 0 ? -2.3 : 18.3, 4.7, -.72], .13, '#765842', .72);
    fittings.line([side < 0 ? -2.3 : 18.3, 4.7, -.72], [side < 0 ? -.6 : 16.6, 5.45, -.35], .09, '#765842', .68);
  }
  fittings.line([11.5, 1.2, -12.5], [14.8, 8.1, -15.1], .19, '#4b3a31', .84);
  fittings.line([13.1, 4.5, -13.8], [18.8, 4.8, -15.6], .055, '#667d70');
  for (const x of [3.8, 7.2, 10.6, 14]) fittings.add('box', [x, 5.9, -18.35], [2.7, .13, .14], [0, -.08, 0], '#624b39');
  group.add(wood.mesh(), fittings.mesh()); return group;
}

function makeArch(palette) {
  const group = new THREE.Group(); group.name = 'sunken-reach-coral-swim-arch';
  const b = new GeoBatch(palette);
  for (const side of [-1, 1]) {
    b.line([side * 7.0, .05, 5], [side * 5.1, 4.3, 5], .38, side < 0 ? '#db8978' : '#d9aa6e', .62);
    b.line([side * 5.1, 4.3, 5], [side * 2.0, 5.1, 5], .28, '#e39b76', .56);
  }
  coral(b, -6, 7, 1.1, '#e68173'); coral(b, 6, 4, .9, '#e6af6f');
  group.add(b.mesh()); return group;
}

export function createUnderwaterPresentation({ palette, heightAt }) {
  const group = new THREE.Group(); group.name = 'sunken-reach-lagoon';
  group.add(makeSand(), makeWreck(palette), makeArch(palette));
  const life = new GeoBatch(palette);
  // A broken perimeter of low coral rock and kelp gives the bounded arena a
  // lagoon horizon. It is deliberately decorative: REEF_BOUNDS stays the only
  // authority, and gaps keep the shallow water visually open.
  for (let i = 0; i < 26; i++) {
    const side = i % 4, along = -29 + (i * 11 % 58), x = side < 2 ? (side ? 32.5 : -32.5) : along, z = side < 2 ? along : (side === 2 ? -36.5 : 32.5);
    const scale = .85 + (i % 4) * .20;
    life.add('pebble', [x, .55 * scale, z], [1.45 * scale, .7 * scale, 1.25 * scale], [.14, i * .71, .08], i % 3 ? '#5a8879' : '#477366');
    if (i % 3 === 0) kelp(life, x + Math.sin(i) * .45, z + Math.cos(i) * .45, scale * .72);
  }
  for (const [x, z, s] of [[-20, 12, 1.1], [-13, -5, .9], [-6, -25, 1.2], [18, 8, 1], [24, -23, .9], [2, 16, .8], [13, -29, .85]]) kelp(life, x, z, s);
  for (const [x, z, s, c] of [[-22, 4, 1.2, '#e98276'], [-10, 9, .85, '#e1af68'], [3, -3, 1.0, '#ed9077'], [17, -25, .9, '#d8a460'], [23, 15, .8, '#e78075']]) coral(life, x, z, s, c);
  group.add(life.mesh());

  const current = new THREE.Group(); current.name = 'sunken-reach-return-current'; current.position.set(REEF_EXIT.x + 1.55, REEF_EXIT.y - 1.45, REEF_EXIT.z + 1.1);
  const currentMaterial = ownedMaterial('#a5f5df', { transparent: true, opacity: .25, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 2; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(.48 + i * .17, .028, 5, 16), currentMaterial); ring.rotation.x = Math.PI / 2; ring.position.y = i * .28; current.add(ring); }
  const currentCore = new THREE.Mesh(new THREE.SphereGeometry(.13, 8, 6), ownedMaterial('#d2fff0', { transparent: true, opacity: .42, depthWrite: false })); currentCore.position.y = .28; current.add(currentCore);
  const returnLabel = labelSprite('Return', '#d9fff0'); returnLabel.position.y = .94; returnLabel.scale.set(.92, .17, 1); current.add(returnLabel); group.add(current);

  const chest = buildChest(palette), chestBeam = new THREE.Mesh(new THREE.CylinderGeometry(.13, .5, 5.2, 12, 1, true), ownedMaterial('#f1bc69', { transparent: true, opacity: .13, depthWrite: false, blending: THREE.AdditiveBlending }));
  chest.group.name = 'sunken-reach-guarded-chest'; chest.group.position.set(REEF_CHEST.x, REEF_CHEST.y, REEF_CHEST.z); chest.group.rotation.y = -.25;
  chestBeam.name = 'sunken-reach-chest-amber-beam'; chestBeam.position.set(REEF_CHEST.x, REEF_CHEST.y + 2.8, REEF_CHEST.z); group.add(chest.group, chestBeam);

  const shafts = new THREE.Group(); shafts.name = 'sunken-reach-sparse-light-shafts';
  for (const [x, z, r] of [[-14, 7, 1.15], [6, -8, .95], [21, 15, .82]]) { const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r * .45, 13, 10, 1, true), ownedMaterial('#c9fff0', { transparent: true, opacity: .016, depthWrite: false, blending: THREE.AdditiveBlending })); shaft.position.set(x, 11, z); shafts.add(shaft); }
  group.add(shafts);
  const bubbles = [], fish = [];
  const bubbleMaterial = ownedMaterial('#d5fff1', { transparent: true, opacity: .55, depthWrite: false });
  for (let i = 0; i < 22; i++) { const bubble = new THREE.Mesh(new THREE.SphereGeometry(.04 + (i % 3) * .025, 6, 5), bubbleMaterial); group.add(bubble); bubbles.push({ mesh: bubble, x: -27 + (i * 13 % 51), z: -31 + (i * 17 % 58), phase: i * .77, top: 4 + i % 8 }); }
  for (let i = 0; i < 10; i++) { const fishGroup = new THREE.Group(), fishMesh = new THREE.Mesh(new THREE.SphereGeometry(.15, 7, 5), ownedMaterial(i % 2 ? '#e9b264' : '#e77f73')); fishMesh.scale.z = 1.8; const fin = new THREE.Mesh(new THREE.ConeGeometry(.13, .28, 3), ownedMaterial('#f4d49a')); fin.rotation.x = Math.PI / 2; fin.position.z = .28; fishGroup.add(fishMesh, fin); group.add(fishGroup); fish.push({ group: fishGroup, phase: i * .59, radius: 5 + i % 4, centerX: i < 5 ? -12 : 14, centerZ: i < 5 ? 8 : -19 }); }

  const diveMarker = new THREE.Group(); diveMarker.name = 'sunken-reach-dive-tide-pool-marker';
  const shoreY = heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.0, 24), ownedMaterial('#3cc4c5', { transparent: true, opacity: .72, depthWrite: false })); pool.rotation.x = -Math.PI / 2; pool.position.set(DIVE_ENTRANCE.x, shoreY + .04, DIVE_ENTRANCE.z);
  const poolRing = new THREE.Mesh(new THREE.TorusGeometry(2.05, .10, 6, 24), ownedMaterial('#d7d59a')); poolRing.rotation.x = Math.PI / 2; poolRing.position.copy(pool.position);
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.32), ownedMaterial('#a7f3df', { transparent: true, opacity: .85, depthWrite: false })); marker.position.set(DIVE_ENTRANCE.x, shoreY + 1.15, DIVE_ENTRANCE.z);
  const diveLabel = labelSprite('Dive: Sunken Reach'); diveLabel.position.set(DIVE_ENTRANCE.x, shoreY + 2.0, DIVE_ENTRANCE.z); diveMarker.add(pool, poolRing, marker, diveLabel);

  let lowQuality = false;
  return { group, diveMarker,
    update(time, state = {}, { lowQuality: low = false, reducedMotion = false } = {}) {
      state = state || {};
      lowQuality = low; current.rotation.y = reducedMotion ? 0 : time * .65; current.position.y = REEF_EXIT.y - 1.45 + (reducedMotion ? 0 : Math.sin(time * 1.4) * .06);
      marker.rotation.y = time * .8; marker.position.y = shoreY + 1.15 + (reducedMotion ? 0 : Math.sin(time * 2) * .10);
      pool.material.opacity = .58 + (reducedMotion ? 0 : Math.sin(time * 1.6) * .12);
      const chestState = state.chests?.find(item => item.id === REEF_CHEST.id) || state.underwater;
      const opened = !!(chestState?.opened || chestState?.chestOpened), guarded = (state.underwater?.remaining ?? chestState?.remaining ?? 0) > 0;
      chest.animate(time, opened, { reducedMotion }); chestBeam.visible = !opened; chestBeam.material.color.set(guarded ? '#df7d79' : '#f1bc69'); chestBeam.material.opacity = .10 + Math.sin(time * 1.5) * .035;
      for (let i = 0; i < bubbles.length; i++) { const b = bubbles[i]; b.mesh.visible = !lowQuality || i % 2 === 0; b.mesh.position.set(b.x + Math.sin(time * .7 + b.phase) * .25, .25 + ((time * .62 + b.phase) % b.top), b.z); }
      for (let i = 0; i < fish.length; i++) { const f = fish[i], a = time * (.34 + i % 3 * .04) + f.phase; f.group.visible = !lowQuality || i % 2 === 0; f.group.position.set(f.centerX + Math.sin(a) * f.radius, 3 + (i % 3) * .75 + Math.sin(a * 2) * .18, f.centerZ + Math.cos(a) * f.radius * .45); f.group.rotation.y = -a - Math.PI / 2; }
    },
    shotBubbles(from, to) {
      const geometry = new THREE.BufferGeometry(), positions = [];
      for (let i = 0; i < 8; i++) positions.push((Math.random() - .5) * .25, (Math.random() - .5) * .25, (Math.random() - .5) * .25);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#c9fff3', size: .09, transparent: true, opacity: .8, depthWrite: false })); points.position.copy(from); group.add(points);
      return { object: points, update(age) { points.position.lerp(to, Math.min(1, age * 2.7)); points.material.opacity = Math.max(0, 1 - age / .5); }, life: .5 };
    },
    getStats() { return { ready: true, kind: 'sunken-reach', wreckSolids: REEF_SOLIDS.length, bubbles: bubbles.length, fish: fish.length, chest: REEF_CHEST.id, lowQuality }; },
  };
}
