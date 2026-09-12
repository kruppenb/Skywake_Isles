import * as THREE from 'three';
import { WEAPON_ORDER, WEAPONS } from '../shared/weapons.js';
import { sampleReloadAnimation } from './reload-animation.js';
import { buildGalleon as buildShipModel, buildDeckCannon as buildShipDeckCannon } from './ship-model.js';

// Original, compact geometry for Skywake Isles. A part is baked into a colored
// batch whenever it does not need to articulate; the island is not a forest of
// individual draw calls.
export function makePalette() {
  const ramp = new THREE.DataTexture(new Uint8Array([92, 157, 209, 255]), 4, 1, THREE.RedFormat);
  ramp.needsUpdate = true;
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  const solid = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  const geometry = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(1, 10, 7),
    pebble: new THREE.DodecahedronGeometry(1, 0),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
    cone: new THREE.ConeGeometry(1, 1, 8),
    ring: new THREE.TorusGeometry(1, .1, 5, 20),
    // Character detail is independent of the much cheaper scenery primitives.
    characterSphere: new THREE.SphereGeometry(1, 20, 14),
    characterDetail: new THREE.SphereGeometry(1, 12, 8),
    characterCylinder: new THREE.CylinderGeometry(1, 1, 1, 16),
    characterCone: new THREE.ConeGeometry(1, 1, 16),
  };
  return { solid, glow, geometry, ramp };
}

export class GeoBatch {
  constructor(palette, material = palette.solid) {
    this.palette = palette; this.material = material;
    this.positions = []; this.normals = []; this.colors = [];
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3();
  }
  add(geometry, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], color = '#ffffff') {
    const g = typeof geometry === 'string' ? this.palette.geometry[geometry] : geometry;
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    return this.addMatrix(g, transform, color);
  }
  addMatrix(g, transform, color = '#ffffff') {
    const pos = g.attributes.position, norm = g.attributes.normal, sourceColor = g.attributes.color;
    const index = g.index, count = index ? index.count : pos.count;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform);
    const tint = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const j = index ? index.getX(i) : i;
      this._v.fromBufferAttribute(pos, j).applyMatrix4(transform);
      this.positions.push(this._v.x, this._v.y, this._v.z);
      if (norm) this._n.fromBufferAttribute(norm, j).applyMatrix3(normalMatrix).normalize();
      else this._n.set(0, 1, 0);
      this.normals.push(this._n.x, this._n.y, this._n.z);
      this.colors.push(tint.r * (sourceColor ? sourceColor.getX(j) : 1),
        tint.g * (sourceColor ? sourceColor.getY(j) : 1), tint.b * (sourceColor ? sourceColor.getZ(j) : 1));
    }
    return this;
  }
  line(a, b, radius, color, taper = 1) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start), length = direction.length();
    const geometry = taper === 1 ? this.palette.geometry.cylinder : new THREE.CylinderGeometry(taper, 1, 1, 7);
    this.addMatrix(geometry, new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
      new THREE.Vector3(radius, length, radius)), color);
    if (taper !== 1) geometry.dispose();
    return this;
  }
  mesh({ shadow = true } = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    return mesh;
  }
}

function surface(vertices, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}

function flatShape(points, thickness = .1) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 5 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function addPalm(batch, x, y, z, size = 1, angle = 0, lush = false) {
  const direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
  const top = [x + direction.x * 1.25 * size, y + 6.8 * size, z + direction.z * 1.25 * size];
  let prev = [x, y, z];
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    const next = [x + direction.x * t * t * 1.25 * size, y + t * 6.8 * size, z + direction.z * t * t * 1.25 * size];
    batch.line(prev, next, size * (.30 - t * .10), i % 2 ? '#bb794f' : '#d39a60', .88);
    prev = next;
  }
  const colors = lush ? ['#236d50', '#36885a', '#58b76a'] : ['#31845c', '#4ca86a', '#6dbe72'];
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + angle;
    const length = size * (3.0 + (k % 3) * .38), width = size * .63;
    const vertices = [], indices = [];
    for (let j = 0; j <= 4; j++) {
      const t = j / 4, r = length * t, w = Math.sin(t * Math.PI) * width;
      const h = Math.sin(t * Math.PI) * size * .8 - t * t * size * .65;
      vertices.push(Math.sin(a) * r + Math.cos(a) * w, h, Math.cos(a) * r - Math.sin(a) * w,
        Math.sin(a) * r, h + .1 * size, Math.cos(a) * r,
        Math.sin(a) * r - Math.cos(a) * w, h, Math.cos(a) * r + Math.sin(a) * w);
      if (j < 4) { const n = j * 3; indices.push(n, n + 3, n + 1, n + 1, n + 3, n + 4, n + 1, n + 4, n + 2, n + 2, n + 4, n + 5); }
    }
    const frond = surface(vertices, indices);
    batch.add(frond, top, [1, 1, 1], [0, 0, 0], colors[k % 3]); frond.dispose();
  }
  for (let k = 0; k < 3; k++) batch.add('sphere', [top[0] + Math.sin(k * 2.1) * .35 * size, top[1] - .35 * size, top[2] + Math.cos(k * 2.1) * .35 * size], [.3 * size, .35 * size, .3 * size], [0, 0, 0], '#79543c');
}

export function addBroadTree(batch, x, y, z, size = 1, moon = false, angle = 0) {
  const trunk = moon ? '#746681' : '#775539';
  const leaves = moon ? ['#8769ba', '#ad82c9', '#c8a0e0'] : ['#246c51', '#388855', '#56a963'];
  batch.line([x, y, z], [x + .35 * size, y + 4.6 * size, z], .45 * size, trunk, .65);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + angle, dx = Math.sin(a) * size * 1.8, dz = Math.cos(a) * size * 1.8;
    batch.line([x + .2 * size, y + 2.8 * size, z], [x + dx, y + (5.4 + i % 2) * size, z + dz], .20 * size, trunk, .45);
    batch.add('pebble', [x + dx, y + (5.7 + i % 2) * size, z + dz], [2.8 * size, 1.8 * size, 2.4 * size], [.2, a, .15], leaves[i % 3]);
  }
  batch.add('pebble', [x, y + 7 * size, z], [2.5 * size, 2.0 * size, 2.5 * size], [0, angle, .2], leaves[1]);
  if (moon) {
    for (let j = 0; j < 4; j++) batch.add('sphere', [x + Math.sin(j * 2.3) * size, y + (2 + j * .6) * size, z + .5 * size], [.18 * size, .23 * size, .18 * size], [0, 0, 0], '#94f3ed');
  }
}

export function addMushroom(batch, x, y, z, size = 1, angle = 0) {
  batch.add('cylinder', [x, y + 1.35 * size, z], [.28 * size, 2.7 * size, .28 * size], [0, 0, .13], '#cddbcc');
  batch.add('sphere', [x - .15 * size, y + 2.7 * size, z], [1.65 * size, .7 * size, 1.65 * size], [0, angle, 0], '#8b83d1');
  batch.add('cylinder', [x - .15 * size, y + 2.55 * size, z], [1.57 * size, .12 * size, 1.57 * size], [0, 0, 0], '#a6ebee');
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4 + angle, r = (.45 + i % 2 * .5) * size;
    batch.add('sphere', [x - .15 * size + Math.sin(a) * r, y + (3.26 - r / size * .18) * size, z + Math.cos(a) * r], [.22 * size, .055 * size, .22 * size], [0, 0, 0], '#dcf9df');
  }
}

export function addCrystal(batch, x, y, z, size = 1, angle = 0, color = '#90e7e8') {
  const crystal = new THREE.CylinderGeometry(0, 1, 1, 5, 1);
  for (let k = 0; k < 3; k++) {
    const a = angle + k * 2.3, h = size * (k === 0 ? 3 : 1.8);
    batch.add(crystal, [x + Math.sin(a) * size * k * .3, y + h * .5, z + Math.cos(a) * size * k * .3], [size * .42, h, size * .42], [Math.sin(a) * .22, a, Math.cos(a) * .22], k === 1 ? '#d3fbef' : color);
  }
  crystal.dispose();
}

export function addHut(batch, x, y, z, size = 1, angle = 0) {
  const local = new GeoBatch(batch.palette);
  local.add('box', [0, 1.45, 0], [3.8, 2.9, 3.5], [0, 0, 0], '#d99b5c');
  for (const xx of [-1.85, 1.85]) for (const zz of [-1.65, 1.65]) local.add('cylinder', [xx, 1.6, zz], [.16, 3.4, .16], [0, 0, 0], '#73523b');
  local.add('box', [0, 1.08, 1.77], [1.2, 2.16, .06], [0, 0, 0], '#465755');
  local.add('box', [-1.05, 1.8, 1.83], [.65, .75, .07], [0, 0, 0], '#a6e9eb');
  local.add('box', [1.05, 1.8, 1.83], [.65, .75, .07], [0, 0, 0], '#a6e9eb');
  const roof = flatShape([[-2.6, -2.4], [2.6, -2.4], [2.6, 2.4], [-2.6, 2.4]], .1);
  // Four-sided thatch pyramid, intentionally broader than the hut walls.
  const pyramid = new THREE.ConeGeometry(3.65, 2.2, 4);
  local.add(pyramid, [0, 3.7, 0], [1, 1, 1], [0, Math.PI / 4, 0], '#b78b40');
  local.add('box', [0, .14, 2.4], [2.6, .28, 1], [0, 0, 0], '#b9804f');
  const mesh = local.mesh();
  batch.add(mesh.geometry, [x, y, z], [size, size, size], [0, angle, 0]);
  roof.dispose(); pyramid.dispose(); mesh.geometry.dispose();
}

// Ship visuals live in a focused module; the dependency injection keeps that
// module independent of this general scenery file while preserving this public
// API for world.js and existing callers.
export function buildGalleon(palette) {
  return buildShipModel(palette, { buildJumpGate, addDeckChevron });
}

export function buildDeckCannon(palette, gun) {
  return buildShipDeckCannon(palette, gun);
}

export function buildFlyingCrab(palette) {
  const group = new THREE.Group(), body = new THREE.Group(), shell = new GeoBatch(palette), wings = [];
  group.name = 'flying-crab'; body.name = 'flying-crab-body'; group.add(body);
  shell.add('sphere', [0, 0, 0], [1.25, .64, .92], [0, 0, 0], '#df7156');
  shell.add('sphere', [0, .16, -.02], [1.03, .56, .77], [0, 0, 0], '#f49c76');
  shell.add('sphere', [0, -.3, -.15], [.84, .32, .65], [0, 0, 0], '#ffe3b2');
  for (const side of [-1, 1]) {
    shell.line([side * .48, .15, -.55], [side * .55, .64, -.8], .075, '#7e493f');
    shell.add('sphere', [side * .55, .64, -.8], [.19, .21, .19], [0, 0, 0], '#263f50');
    shell.add('sphere', [side * .59, .69, -.94], [.055, .06, .045], [0, 0, 0], '#fff2d0');
    shell.line([side * .78, -.2, -.45], [side * 1.35, -.48, -.98], .12, '#e98763');
    shell.add('sphere', [side * 1.42, -.37, -1.1], [.32, .23, .4], [0, side * -.3, 0], '#f0a07a');
    for (let i = 0; i < 3; i++) {
      shell.line([side * .83, -.28, -.1 + i * .32], [side * 1.23, -.68, .15 + i * .32], .06, '#ac594b');
      shell.line([side * 1.23, -.68, .15 + i * .32], [side * 1.43, -.57, .30 + i * .32], .055, '#ffd6a8');
    }
    const wing = new THREE.Group(), feathers = new GeoBatch(palette); wing.name = side < 0 ? 'left-cream-wing' : 'right-cream-wing';
    wing.position.set(side * .8, .35, .2);
    for (let i = 0; i < 4; i++) {
      feathers.add('sphere', [side * (.57 + i * .16), .02, -.42 + i * .35], [.82 - i * .07, .085, .23], [0, side * (-.4 + i * .16), side * .08], i % 2 ? '#f5d4a1' : '#fff1ce');
    }
    feathers.line([0, 0, -.48], [side * 1.15, .02, -.66], .055, '#ac7252');
    wing.add(feathers.mesh()); body.add(wing); wings.push({ wing, side });
  }
  body.add(shell.mesh());
  return { group, body, wings, animate(time, reducedMotion = false) {
    // Keep the target root at its authoritative sphere center; only the small body pose bobs.
    body.position.y = reducedMotion ? 0 : Math.sin(time * 2.1) * .07;
    body.rotation.z = reducedMotion ? 0 : Math.sin(time * 1.4) * .05;
    for (const { wing, side } of wings) wing.rotation.z = side * (reducedMotion ? .18 : .18 + Math.sin(time * 7.5) * .52);
  } };
}

// A giant storm-shell skycrab. It speaks the practice flying crab's visual
// language — lofted shell, stalked eyes, cream wings — grown and darkened into a
// squall silhouette, with a lit crest and belly core so a wind-up reads at cannon
// range. The root stays exactly on the authoritative hit-sphere centre: only
// sub-parts move, and nothing here touches a shared palette material.
export function buildSkycrab(palette, descriptor = {}) {
  const port = descriptor.side !== 'starboard';
  const shell = port ? '#46508f' : '#2b6b74', plate = port ? '#6b76c4' : '#47969a';
  const belly = port ? '#c9d3ff' : '#c2f0ea', limb = port ? '#3a4275' : '#235860';
  const group = new THREE.Group(), body = new THREE.Group(), hull = new GeoBatch(palette);
  const lit = new GeoBatch(palette, palette.glow), wings = [], claws = [];
  group.name = descriptor.id || 'skycrab'; body.name = 'skycrab-body'; group.add(body);
  // Every part is authored inside a unit envelope of about 1.35, which is the
  // frozen radius/scale of both bosses. The silhouette therefore fills its hit
  // sphere instead of hanging wingtips outside a shot's reach.
  hull.add('sphere', [0, 0, 0], [.86, .5, .68], [0, 0, 0], shell);
  hull.add('sphere', [0, .14, -.03], [.7, .42, .56], [0, 0, 0], plate);
  hull.add('sphere', [0, -.25, -.11], [.58, .26, .48], [0, 0, 0], belly);
  // A jagged storm crest replaces the practice crab's smooth back.
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * .26, height = .34 - Math.abs(i - 2) * .06;
    lit.add('cone', [x, .38 + height / 2, -.06 + Math.abs(i - 2) * .05], [.09, height, .07], [0, 0, (i - 2) * .16], belly);
  }
  lit.add('sphere', [0, -.31, -.07], [.28, .11, .23], [0, 0, 0], belly);
  for (const side of [-1, 1]) {
    hull.line([side * .32, .12, -.4], [side * .38, .54, -.6], .06, limb);
    hull.add('sphere', [side * .38, .56, -.62], [.15, .17, .15], [0, 0, 0], '#1d2c3c');
    lit.add('sphere', [side * .4, .6, -.71], [.05, .06, .05], [0, 0, 0], belly);
    for (let i = 0; i < 4; i++) {
      hull.line([side * .58, -.2, -.14 + i * .23], [side * .86, -.55, .04 + i * .23], .05, limb);
      hull.line([side * .86, -.55, .04 + i * .23], [side * 1.02, -.45, .16 + i * .23], .045, plate);
    }
    // Claws ride their own pivot so a telegraphed strike can raise them.
    const claw = new THREE.Group(), arm = new GeoBatch(palette);
    claw.name = side < 0 ? 'skycrab-left-claw' : 'skycrab-right-claw';
    claw.position.set(side * .52, -.11, -.33);
    arm.line([0, 0, 0], [side * .4, -.19, -.38], .1, plate);
    arm.add('sphere', [side * .48, -.23, -.48], [.26, .19, .31], [0, side * -.32, 0], shell);
    arm.add('sphere', [side * .6, -.13, -.58], [.19, .08, .22], [0, side * -.32, .3], plate);
    claw.add(arm.mesh()); body.add(claw); claws.push({ claw, side });
    const wing = new THREE.Group(), feathers = new GeoBatch(palette);
    wing.name = side < 0 ? 'skycrab-left-wing' : 'skycrab-right-wing';
    wing.position.set(side * .34, .28, .14);
    for (let i = 0; i < 5; i++) {
      feathers.add('sphere', [side * (.26 + i * .09), .01, -.32 + i * .24], [.4 - i * .035, .06, .2],
        [0, side * (-.42 + i * .15), side * .09], i % 2 ? '#e8ddc0' : '#fff4dc');
    }
    feathers.line([0, 0, -.34], [side * .62, .02, -.46], .05, limb);
    wing.add(feathers.mesh()); body.add(wing); wings.push({ wing, side });
  }
  body.add(hull.mesh(), lit.mesh({ shadow: false }));
  // Fit the drawn silhouette inside the authoritative hit sphere, so every pixel
  // a gunner can see sits on geometry the server's sphere test can register. The
  // envelope is the descriptor's own frozen radius/scale; nothing here changes a
  // hitbox to cover a mismatch, the drawing yields to it.
  const envelope = descriptor.radius > 0 && descriptor.scale > 0 ? descriptor.radius / descriptor.scale : 1.35;
  const probe = new THREE.Vector3();
  let reach = 0;
  body.updateMatrixWorld(true);
  body.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) reach = Math.max(reach, probe.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).length());
  });
  const fit = reach > 0 ? Math.min(1, envelope * .96 / reach) : 1;
  body.scale.setScalar(fit);
  let clawLift = 0;
  return { group, body, wings, claws, fit,
    animate(time, { reducedMotion = false, winding = false, down = false, downAge = 0 } = {}) {
      const target = down ? 1.1 : winding ? 1 : 0;
      clawLift += (target - clawLift) * (reducedMotion ? 1 : .12);
      body.position.y = reducedMotion || down ? 0 : Math.sin(time * 1.3) * .05;
      body.rotation.z = down ? Math.min(1.5, downAge * 1.9) : reducedMotion ? 0 : Math.sin(time * .9) * .05;
      body.rotation.x = down ? Math.min(.7, downAge * .9) : winding ? .22 * clawLift : 0;
      for (const { wing, side } of wings) {
        const beat = down ? -.5 : reducedMotion ? .2 : .2 + Math.sin(time * (winding ? 6.4 : 3.1)) * (winding ? .5 : .34);
        wing.rotation.z = side * beat;
      }
      for (const { claw, side } of claws) {
        claw.rotation.x = -1.05 * clawLift;
        claw.rotation.y = side * .3 * clawLift;
      }
    } };
}

export function buildAirshipLift(palette) {
  const group = new THREE.Group(), marker = new THREE.Group(), base = new GeoBatch(palette), icon = new GeoBatch(palette, palette.glow);
  const cyan = '#baf9f0', brass = '#e5b55f';
  base.add('cylinder', [0, .03, 0], [1.65, .16, 1.65], [0, 0, 0], '#335665');
  base.add('cylinder', [0, .13, 0], [1.45, .08, 1.45], [0, 0, 0], '#69b8b4');
  base.add('ring', [0, .19, 0], [1.45, 1.45, .6], [Math.PI / 2, 0, 0], brass);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2, x = Math.cos(angle) * 1.9, z = Math.sin(angle) * 1.9;
    base.add('cylinder', [x, .3, z], [.15, .6, .15], [0, 0, 0], brass);
    base.add('sphere', [x, .64, z], [.18, .16, .18], [0, 0, 0], cyan);
  }
  icon.add('cylinder', [0, 0, 0], [.14, .9, .14], [0, 0, 0], cyan);
  icon.add('cone', [0, .72, 0], [.6, .65, .6], [0, 0, 0], cyan);
  icon.add('ring', [0, -.6, 0], [.66, .66, .4], [Math.PI / 2, 0, 0], brass);
  marker.name = 'airship-lift-up-arrow'; marker.position.y = 3.6; marker.add(icon.mesh({ shadow: false }));
  group.add(base.mesh(), marker);
  return { group, marker, animate(time, reducedMotion = false) { marker.position.y = 3.6 + (reducedMotion ? 0 : Math.sin(time * 1.8) * .22); } };
}

// Block capitals keep the gate sign readable at any effects quality and without
// a font atlas, so the word itself carries the meaning rather than a colour.
const SIGN_GLYPHS = {
  J: ['..X', '..X', '..X', 'X.X', '.X.'],
  U: ['X.X', 'X.X', 'X.X', 'X.X', 'XXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'],
  P: ['XX.', 'X.X', 'XX.', 'X..', 'X..'],
};

export function addSignWord(batch, word, origin, cell, color) {
  const glyphs = [...word].map((letter) => SIGN_GLYPHS[letter]).filter(Boolean);
  const cells = glyphs.reduce((total, rows) => total + rows[0].length, 0) + Math.max(0, glyphs.length - 1) * .6;
  let cursor = -cells / 2;
  for (const rows of glyphs) {
    for (let row = 0; row < rows.length; row++) for (let column = 0; column < rows[row].length; column++) {
      if (rows[row][column] !== 'X') continue;
      batch.add('box', [origin[0] + (cursor + column + .5) * cell, origin[1] + (rows.length / 2 - row - .5) * cell, origin[2]],
        [cell * .96, cell * .96, .05], [0, 0, 0], color);
    }
    cursor += rows[0].length + .6;
  }
  return cells * cell;
}

// A painted chevron: two flat bars meeting at a tip, so the direction reads from
// shape alone with effects turned down or colour ignored. Reach and spread are
// separate because a wide, shallow arrow fits the deck without overhanging it.
export function addDeckChevron(batch, x, z, heading, reach, spread, y, thickness, color) {
  const tipX = x + Math.sin(heading) * reach, tipZ = z + Math.cos(heading) * reach;
  for (const side of [-1, 1]) {
    const endX = x + Math.cos(heading) * spread * side, endZ = z - Math.sin(heading) * spread * side;
    const dx = endX - tipX, dz = endZ - tipZ;
    batch.add('box', [(tipX + endX) / 2, y, (tipZ + endZ) / 2],
      [thickness, .05, Math.hypot(dx, dz)], [0, Math.atan2(dx, dz), 0], color);
  }
}

// A jump gate is built in its own frame with the launch direction along -z, the
// same convention the shared gun yaw uses. Everything is deck-local, so the
// whole gate rides the ship exactly like a cannon station.
export function buildJumpGate(palette, point) {
  const group = new THREE.Group(), marker = new THREE.Group();
  const solid = new GeoBatch(palette), glow = new GeoBatch(palette, palette.glow);
  const gold = '#f7c559', dark = '#1d3d4d', cream = '#fff3d4', cyan = '#baf9f0';
  group.name = point.id; group.userData.jumpPointId = point.id;
  group.position.set(point.x, 0, point.z); group.rotation.y = point.yaw || 0;
  // A dark pad makes the gold chevrons read against tan planks in every mode.
  solid.add('box', [0, .07, .1], [3.0, .06, 2.7], [0, 0, 0], dark);
  for (const z of [1.05, .25, -.55]) addDeckChevron(solid, 0, z, Math.PI, .5, .95, .115, .18, gold);
  solid.add('box', [0, .19, -1.12], [2.76, .26, .22], [0, 0, 0], gold);
  // A gate on the centreline stands directly behind the fore-mast from the
  // opening spawn, and the mast hides roughly 0.8 m of any board at that range,
  // which is enough to eat a letter out of a single centred sign. That gate
  // carries its word twice, on side panels outside the occlusion band; a rail
  // gate has nothing in front of it and keeps one wide board.
  const split = Math.abs(point.x) < 1, postX = split ? 1.55 : 1.38;
  // Each support stands behind its own board: at the shared z the post and lamp
  // reached past the glyph plane at -.11 and cut through the word close up.
  for (const side of [-1, 1]) {
    solid.add('cylinder', [side * postX, 1.2, -.42], [.12, 2.4, .12], [0, 0, 0], dark);
    solid.add('sphere', [side * postX, 2.48, -.42], [.19, .19, .19], [0, 0, 0], cream);
  }
  for (const [x, frame, board, cell] of split
    ? [[-1.55, 1.56, 1.42, .086], [1.55, 1.56, 1.42, .086]] : [[0, 3.5, 3.2, .16]]) {
    solid.add('box', [x, 2.3, -.24], [frame, cell * 7.75, .09], [0, 0, 0], gold);
    solid.add('box', [x, 2.3, -.18], [board, cell * 6.25, .12], [0, 0, 0], dark);
    addSignWord(solid, 'JUMP', [x, 2.3, -.11], cell, cream);
  }
  const sign = solid.mesh(); sign.name = 'jump-gate-sign';
  glow.add('cylinder', [0, 0, .2], [.12, .9, .12], [Math.PI / 2, 0, 0], cyan);
  glow.add('cone', [0, 0, -.52], [.52, .62, .52], [-Math.PI / 2, 0, 0], cyan);
  marker.name = 'jump-gate-arrow'; marker.position.set(0, 3.15, -.5);
  marker.add(glow.mesh({ shadow: false }));
  group.add(sign, marker);
  return { group, marker,
    animate(time, reducedMotion = false) { marker.position.z = -.5 + (reducedMotion ? 0 : Math.sin(time * 1.7) * .2); } };
}

// Lofted, softly squared volumes give the characters jaws, shoulders and seams
// without increasing the polygon count of every palm, rock and island prop.
function characterProfile(rings, segments = 16, roundness = .78) {
  const vertices = [], indices = [];
  for (const [y, width, depth, centerZ = 0] of rings) for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    vertices.push(Math.sign(s) * Math.abs(s) ** roundness * width, y,
      centerZ + Math.sign(c) * Math.abs(c) ** roundness * depth);
  }
  for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < segments; i++) {
    const a = row * segments + i, b = row * segments + (i + 1) % segments;
    indices.push(a, b, a + segments, b, b + segments, a + segments);
  }
  for (const [row, reverse] of [[0, true], [rings.length - 1, false]]) {
    const [y, , , z = 0] = rings[row], center = vertices.length / 3;
    vertices.push(0, y, z);
    for (let i = 0; i < segments; i++) {
      const a = row * segments + i, b = row * segments + (i + 1) % segments;
      indices.push(center, reverse ? b : a, reverse ? a : b);
    }
  }
  return surface(vertices, indices);
}

function characterPanel(batch, points, position, color, depth = .035, rotation = [0, 0, 0]) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true,
    bevelSize: .012, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 6 });
  batch.add(geometry, position, [1, 1, 1], rotation, color); geometry.dispose();
}

function characterStrap(batch, a, b, width, thickness, color) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  batch.addMatrix(batch.palette.geometry.box, new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
    new THREE.Vector3(width, direction.length(), thickness)), color);
}

// Wrist sockets sit at the back of each palm. The support hand cups the
// fore-end, except on the pistol where it wraps around the firing hand.
export const WEAPON_HANDLING = {
  flintlock: { left: [-.24, -.17, .075], right: [.055, -.145, .21], stance: [.20, .65, -.70], supportRoll: -.15 },
  scatter: { left: [-.27, -.20, -.32], right: [.055, -.145, .21], stance: [.55, .69, -.405], supportRoll: .04 },
  repeater: { left: [-.265, -.18, -.32], right: [.055, -.145, .21], stance: [.55, .70, -.405], supportRoll: .02 },
  burst: { left: [-.27, -.18, -.335], right: [.055, -.145, .21], stance: [.55, .71, -.395], supportRoll: .04 },
  longshot: { left: [-.27, -.18, -.35], right: [.055, -.145, .21], stance: [.55, .72, -.385], supportRoll: .06 },
};

export function buildWeapon(palette, kind = 'flintlock') {
  const b = new GeoBatch(palette), scatter = kind === 'scatter';
  const moving = new GeoBatch(palette), actionOrigin = new THREE.Vector3();
  const wood = '#825635', brass = '#e9b855', steel = '#334b5a';
  const stock = flatShape([[-.09, .29], [-.13, .10], [-.105, -.48], [-.07, -.68], [.075, -.68], [.11, -.48], [.13, .10], [.09, .29]], .13);
  b.add(stock, [0, -.055, 0], [1, 1, 1], [0, 0, 0], wood); stock.dispose();
  b.add('characterSphere', [0, -.12, .19], [.10, .22, .115], [.34, 0, 0], wood);
  b.add('characterDetail', [0, -.30, .25], [.112, .045, .105], [.34, 0, 0], brass);
  b.add('box', [0, .015, .17], [.19, .16, .095], [.08, 0, 0], scatter ? wood : steel);
  b.add('box', [.098, .07, .025], [.024, .105, .25], [0, 0, 0], brass);
  b.line([.118, .12, .08], [.118, .25, .055], .026, steel);
  b.add('box', [.118, .25, .025], [.06, .045, .11], [.2, 0, 0], brass);
  const guard = new THREE.TorusGeometry(1, .12, 6, 16);
  b.add(guard, [.016, -.09, -.055], [.125, .14, .055], [0, Math.PI / 2, 0], brass); guard.dispose();
  b.line([.025, -.005, -.045], [.025, -.085, -.075], .018, steel);
  let muzzle;
  if (scatter) {
    b.add('box', [.055, .08, .25], [.21, .23, .23], [.08, .24, 0], wood);
    b.add('box', [.082, .08, .37], [.235, .27, .055], [.08, .24, 0], brass);
    b.add('characterCylinder', [0, .12, -.39], [.12, .69, .12], [Math.PI / 2, 0, 0], steel);
    const flare = new THREE.CylinderGeometry(.235, .12, .29, 20);
    b.add(flare, [0, .12, -.79], [1, 1, 1], [-Math.PI / 2, 0, 0], brass); flare.dispose();
    b.add('characterCylinder', [0, .12, -.938], [.18, .012, .18], [Math.PI / 2, 0, 0], '#172c37');
    const rim = new THREE.TorusGeometry(.202, .026, 6, 20);
    b.add(rim, [0, .12, -.941], [1, 1, 1], [0, 0, 0], '#f7ce77'); rim.dispose();
    b.add('characterCylinder', [.135, -.07, -.41], [.042, .66, .042], [Math.PI / 2, 0, 0], steel);
    b.add('characterCylinder', [0, -.08, -.44], [.125, .20, .12], [0, 0, 0], wood);
    for (const z of [-.22, -.58]) b.add('characterCylinder', [0, .12, z], [.133, .06, .133], [Math.PI / 2, 0, 0], brass);
    muzzle = new THREE.Vector3(0, .12, -.967);
  } else if (kind === 'flintlock') {
    b.add('characterCylinder', [0, .13, -.44], [.078, .99, .078], [Math.PI / 2, 0, 0], steel);
    b.add('box', [0, .105, -.15], [.15, .13, .11], [0, 0, 0], '#213946');
    b.add('characterCylinder', [0, .13, -.94], [.094, .10, .094], [Math.PI / 2, 0, 0], brass);
    b.add('characterCylinder', [0, .13, -.994], [.064, .012, .064], [Math.PI / 2, 0, 0], '#142b36');
    for (const z of [-.20, -.66]) b.add('characterCylinder', [0, .13, z], [.082, .058, .082], [Math.PI / 2, 0, 0], brass);
    b.line([0, -.065, -.08], [0, -.065, -.82], .022, '#becbc5');
    b.add('box', [0, .22, -.80], [.032, .058, .075], [0, 0, 0], brass);
    b.add('box', [0, .205, -.96], [.024, .045, .042], [0, 0, 0], brass);
    muzzle = new THREE.Vector3(0, .13, -1.001);
  } else {
    const longshot = kind === 'longshot', repeater = kind === 'repeater';
    const barrelEnd = longshot ? -1.83 : repeater ? -.93 : -1.39;
    const barrelStart = -.12;
    // A shorter, slightly cast-off stock meets the outside of the shoulder.
    // The previous long butt extended through the chest and into the cheek
    // when looking down, regardless of how the wrists were posed.
    b.add('box', [.06, .065, .25], [.205, .22, .24], [.09, .28, 0], wood);
    b.add('box', [.095, .065, .38], [.23, .26, .055], [.09, .28, 0], brass);
    b.add('box', [0, .10, -.145], [.22, .235, .46], [0, 0, 0], steel);
    b.add('characterCylinder', [0, .17, (barrelEnd + barrelStart) / 2], [.065, barrelStart - barrelEnd, .065], [Math.PI / 2, 0, 0], steel);
    b.add('characterCylinder', [0, .17, barrelEnd], [.082, .11, .082], [Math.PI / 2, 0, 0], brass);
    b.add('characterCylinder', [0, .17, barrelEnd - .06], [.052, .012, .052], [Math.PI / 2, 0, 0], '#142b36');
    b.add('box', [0, -.035, -.48], [.20, .20, repeater ? .29 : .57], [0, 0, 0], wood);
    for (const z of (repeater ? [-.37, -.58] : [-.30, -.48, -.66])) b.add('box', [0, -.025, z], [.216, .205, .036], [0, 0, 0], brass);
    if (longshot) {
      // A brass telescope is the longshot's unmistakable high silhouette.
      for (const z of [-.20, -.56]) b.add('box', [0, .36, z], [.085, .22, .09], [0, 0, 0], brass);
      b.add('characterCylinder', [0, .48, -.40], [.115, .78, .115], [Math.PI / 2, 0, 0], '#233f50');
      for (const z of [-.01, -.80]) b.add('characterCylinder', [0, .48, z], [.137, .09, .137], [Math.PI / 2, 0, 0], brass);
      b.add('characterCylinder', [0, .48, -.851], [.107, .012, .107], [Math.PI / 2, 0, 0], '#78d5df');
      moving.line([.15, .19, .02], [.23, .28, .02], .035, brass);
      moving.add('characterSphere', [.23, .28, .02], [.055, .055, .055], [0, 0, 0], steel);
    } else {
      // Box magazine on the compact repeater, narrow curved feed on the carbine.
      moving.add('box', [0, -.28, -.17], [repeater ? .15 : .11, repeater ? .29 : .36, .16], [repeater ? -.10 : -.25, 0, 0], repeater ? '#277f80' : steel);
      moving.add('box', [0, -.43, -.13], [.17, .045, .19], [-.10, 0, 0], brass);
      b.add('box', [0, .32, -.15], [.06, .06, .13], [0, 0, 0], brass);
      b.add('box', [0, .25, barrelEnd + .17], [.035, .085, .07], [0, 0, 0], brass);
    }
    muzzle = new THREE.Vector3(0, .17, barrelEnd - .07);
  }
  if (scatter || kind === 'flintlock') {
    // A small hinged loading gate gives the breech action a visible mechanism.
    // The dark receiver backing remains solid when the gate opens.
    actionOrigin.set(-.115, .125, -.10);
    b.add('box', [-.112, .07, -.10], [.018, .105, .22], [0, 0, 0], '#213946');
    moving.add('box', [0, -.055, 0], [.025, .105, .22], [0, 0, 0], brass);
  }
  const group = new THREE.Group(); group.name = 'held-' + kind;
  const mesh = b.mesh(); mesh.name = kind + '-wood-brass-steel'; group.add(mesh);
  const action = moving.mesh(); action.name = 'reload-action-' + kind; action.position.copy(actionOrigin); group.add(action);
  const socket = new THREE.Object3D(); socket.name = 'muzzle-' + kind; socket.position.copy(muzzle); group.add(socket);
  const stowed = new THREE.Group(); stowed.name = 'stowed-' + kind;
  const stowedMesh = new THREE.Mesh(mesh.geometry, mesh.material);
  stowedMesh.castShadow = stowedMesh.receiveShadow = true; stowed.add(stowedMesh);
  const stowedAction = new THREE.Mesh(action.geometry, action.material);
  stowedAction.name = 'stowed-reload-action-' + kind; stowedAction.position.copy(actionOrigin);
  stowedAction.castShadow = stowedAction.receiveShadow = true; stowed.add(stowedAction);
  const stowedSocket = new THREE.Object3D(); stowedSocket.name = 'stowed-muzzle-' + kind;
  stowedSocket.position.copy(muzzle); stowed.add(stowedSocket);
  return { group, stowed, socket, stowedSocket, action, actionOrigin };
}

// The crew-coloured glider, hidden until the pirate is gliding. Its grips at
// (±.70, 2.29, −.17) are the hand targets shared by every player renderer.
export const GLIDER_GRIP = Object.freeze({ x: .70, y: 2.29, z: -.17 });
export function buildGlider(palette, color = '#eb785d') {
  const glider = new THREE.Group(); glider.name = 'pirate-glider';
  const gb = new GeoBatch(palette), sailVertices = [], sailIndices = [], sailColors = [], leather = '#674938';
  for (let row = 0; row <= 3; row++) for (let col = 0; col <= 12; col++) {
    const x = (col / 12 - .5) * 6.4, t = row / 3;
    const y = 3.85 + .48 * Math.cos(x / 3.2 * Math.PI / 2) - t * .34;
    const z = -.65 + t * (1.6 + .23 * Math.cos(col / 12 * Math.PI * 6));
    sailVertices.push(x, y, z);
    const c = new THREE.Color(col % 4 < 2 ? color : '#ffdfa0'); sailColors.push(c.r, c.g, c.b);
    if (row < 3 && col < 12) { const n = row * 13 + col; sailIndices.push(n, n + 13, n + 1, n + 1, n + 13, n + 14); }
  }
  const cloth = surface(sailVertices, sailIndices);
  cloth.setAttribute('color', new THREE.Float32BufferAttribute(sailColors, 3)); gb.add(cloth); cloth.dispose();
  const grips = [];
  for (const side of [-1, 1]) {
    gb.line([0, 4.30, -.68], [side * 3.2, 3.85, -.68], .065, '#644d3d');
    gb.line([side * GLIDER_GRIP.x, GLIDER_GRIP.y, GLIDER_GRIP.z], [side * 2.7, 3.90, -.60], .022, '#f7e6b9');
    gb.line([side * GLIDER_GRIP.x, GLIDER_GRIP.y, GLIDER_GRIP.z], [side * 2.7, 3.56, 1.0], .022, '#f7e6b9');
    gb.add('characterCylinder', [side * GLIDER_GRIP.x, GLIDER_GRIP.y + .02, GLIDER_GRIP.z], [.044, .19, .044], [0, 0, side * -.35], leather);
    const grip = new THREE.Object3D(); grip.name = (side < 0 ? 'left' : 'right') + '-glider-grip';
    grip.position.set(side * GLIDER_GRIP.x, GLIDER_GRIP.y, GLIDER_GRIP.z); glider.add(grip); grips.push(grip);
  }
  gb.line([0, 4.30, -.68], [0, 3.8, 1.2], .055, '#644d3d');
  glider.add(gb.mesh()); glider.visible = false;
  return { group: glider, grips };
}

export function buildPirate(palette, color = '#eb785d') {
  const group = new THREE.Group(); group.name = 'pirate'; group.userData.kind = 'pirate';
  const figure = new THREE.Group(); figure.name = 'pirate-figure'; group.add(figure);
  const torso = new THREE.Group(); torso.name = 'pirate-upper-body'; torso.position.y = 1.15; figure.add(torso);
  const b = new GeoBatch(palette), skin = '#e5b08a', navy = '#243e51', ivory = '#fff0d0', leather = '#674938', brass = '#e9b855';
  const coat = characterProfile([[-.12, .34, .235], [.13, .35, .24], [.48, .425, .28], [.76, .455, .265], [.88, .34, .21]]);
  b.add(coat, [0, 0, 0], [1, 1, 1], [0, 0, 0], navy); coat.dispose();
  characterPanel(b, [[-.15, .18], [.15, .18], [.20, .69], [.11, .83], [-.11, .83], [-.20, .69]], [0, 0, -.285], ivory);
  for (const y of [.29, .43, .57]) b.add('box', [0, y, -.314], [.31, .055, .016], [0, 0, 0], '#497b91');
  for (const side of [-1, 1]) {
    const panel = [[.16, .15], [.35, .07], [.43, .60], [.34, .80], [.20, .67]].map(([x, y]) => [x * side, y]);
    characterPanel(b, panel, [0, 0, -.273], color, .045);
    const lapel = [[.16, .47], [.32, .68], [.26, .83], [.13, .77]].map(([x, y]) => [x * side, y]);
    characterPanel(b, lapel, [0, 0, -.329], brass, .018);
    characterPanel(b, lapel.map(([x, y]) => [x * .92 + side * .012, y * .93 + .043]), [0, 0, -.348], navy, .018);
    b.add('characterDetail', [side * .28, .38, -.321], [.024, .024, .016], [0, 0, 0], brass);
    b.add('characterDetail', [side * .31, .22, -.304], [.024, .024, .016], [0, 0, 0], brass);
    characterStrap(b, [side * .34, .75, .225], [side * .29, .24, .25], .018, .02, '#567487');
  }
  b.add('characterCylinder', [0, .07, 0], [.373, .14, .255], [0, 0, 0], leather);
  b.add('box', [0, .07, -.277], [.20, .17, .035], [0, 0, 0], brass);
  b.add('box', [0, .07, -.300], [.125, .092, .014], [0, 0, 0], '#513c30');
  b.add('box', [.005, .075, -.313], [.095, .024, .016], [0, 0, 0], brass);
  characterStrap(b, [.32, .81, -.26], [-.26, .16, -.31], .10, .038, leather);
  characterStrap(b, [.32, .81, .24], [-.26, .16, .29], .10, .036, leather);
  b.add('box', [.13, .57, -.333], [.12, .095, .024], [0, 0, -.72], brass);
  characterPanel(b, [[-.12, -.15], [.12, -.15], [.15, .11], [.09, .19], [-.11, .18]], [-.44, .08, .06], leather, .18);
  characterPanel(b, [[-.13, .13], [.13, .13], [.11, -.015], [0, -.065], [-.11, -.015]], [-.44, .08, .045], '#946746', .024);
  b.add('characterDetail', [-.44, .065, .026], [.031, .036, .021], [0, 0, 0], brass);
  b.add('characterCylinder', [.40, .015, .12], [.083, .25, .083], [0, 0, -.12], '#81cec4');
  b.add('characterCylinder', [.42, .17, .12], [.050, .065, .050], [0, 0, -.12], brass);
  b.add('characterCylinder', [0, .875, 0], [.13, .20, .13], [0, 0, 0], skin);
  characterPanel(b, [[-.21, .80], [0, .74], [.21, .80], [.18, .91], [0, .86], [-.18, .91]], [0, 0, -.21], color, .055);
  const torsoMesh = b.mesh(); torsoMesh.name = 'tailored-coat-shirt-and-gear'; torso.add(torsoMesh);

  const tails = new THREE.Group(); tails.name = 'split-coat-tails'; tails.position.set(0, .13, .21);
  const tb = new GeoBatch(palette);
  for (const side of [-1, 1]) {
    const panel = [[.055, .06], [.36, .10], [.42, -.36], [.15, -.53], [.075, -.40]].map(([x, y]) => [x * side, y]);
    characterPanel(tb, panel, [0, 0, 0], navy, .065);
    characterStrap(tb, [side * .17, -.46, .082], [side * .38, -.33, .082], .024, .018, brass);
    characterPanel(tb, [[.10, -.01], [.30, .015], [.32, -.18], [.12, -.19]].map(([x, y]) => [x * side, y]), [0, 0, .075], color, .025);
  }
  tails.add(tb.mesh()); torso.add(tails);

  const head = new THREE.Group(); head.name = 'pirate-head'; head.position.y = 1.0; torso.add(head);
  const hb = new GeoBatch(palette);
  const face = characterProfile([[-.17, .17, .18, -.015], [-.10, .25, .225], [.10, .31, .267], [.31, .285, .25], [.41, .22, .20]]);
  hb.add(face, [0, 0, 0], [1, 1, 1], [0, 0, 0], skin); face.dispose();
  hb.add('characterSphere', [0, .24, .070], [.312, .25, .238], [0, 0, 0], '#553d31');
  for (const side of [-1, 1]) {
    hb.add('characterDetail', [side * .307, .095, .008], [.086, .112, .071], [0, 0, 0], skin);
    hb.add('characterDetail', [side * .333, .095, -.048], [.042, .063, .021], [0, 0, 0], '#cc8d6c');
    hb.add('characterDetail', [side * .255, .22, -.17], [.063, .15, .092], [0, side * -.28, side * .15], '#553d31');
    hb.add('characterDetail', [side * .126, .15, -.255], [.085, .076, .032], [0, 0, side * -.05], ivory);
    hb.add('characterDetail', [side * .122, .145, -.284], [.037, .047, .020], [0, 0, 0], '#233e51');
    hb.add('characterDetail', [side * .113 - .009, .16, -.303], [.010, .012, .006], [0, 0, 0], '#ffffff');
    characterStrap(hb, [side * .058, .238, -.273], [side * .20, .245, -.244], .039, .025, '#553d31');
    hb.add('characterDetail', [side * .194, -.005, -.243], [.068, .050, .034], [0, 0, 0], '#e8a081');
    hb.add('characterDetail', [side * .044, -.065, -.258], [.060, .023, .025], [0, 0, side * .16], '#6d4936');
  }
  hb.add('characterDetail', [0, .098, -.281], [.051, .083, .061], [.12, 0, 0], '#df9d74');
  hb.add('characterDetail', [0, .056, -.322], [.078, .058, .072], [0, 0, 0], skin);
  characterStrap(hb, [-.063, -.103, -.232], [.063, -.101, -.234], .026, .025, '#9e6152');
  hb.add('characterDetail', [0, -.10, -.252], [.049, .012, .009], [0, 0, 0], ivory);
  for (let i = 0; i < 3; i++) hb.add('characterDetail', [-.16 + i * .105, .354 - i * .012, -.175],
    [.125, .092, .129], [0, -.2, -.30], i % 2 ? '#77513b' : '#644330');
  const earring = new THREE.TorusGeometry(.068, .018, 6, 14);
  hb.add(earring, [-.335, -.027, -.007], [1, 1, 1], [0, .15, 0], brass); earring.dispose();
  hb.add('characterCylinder', [0, .409, .015], [.303, .09, .256], [0, 0, 0], color);
  hb.add('characterSphere', [0, .514, .035], [.38, .23, .32], [0, 0, 0], navy);
  // Three lifted sides and three low pointed corners, with an actual brass rim.
  for (const [inner, outer, tint] of [[.46, 1, navy], [.94, 1.025, brass]]) {
    const vertices = [], indices = [], count = 48;
    for (const fraction of [inner, outer]) for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2, corner = Math.cos(a * 3), r = .47 - .125 * corner;
      const edgeY = .50 + .17 * (1 + corner) / 2;
      vertices.push(Math.sin(a) * r * 1.19 * fraction, .455 + (edgeY - .455) * fraction ** 2,
        Math.cos(a) * r * fraction + .015);
    }
    for (let i = 0; i < count; i++) { const n = (i + 1) % count; indices.push(i, n, i + count, n, n + count, i + count); }
    const brim = surface(vertices, indices); hb.add(brim, [0, 0, 0], [1, 1, 1], [0, 0, 0], tint); brim.dispose();
  }
  hb.add('characterDetail', [0, .60, -.301], [.105, .118, .032], [.13, 0, 0], brass);
  characterPanel(hb, [[0, .07], [.035, 0], [0, -.066], [-.035, 0]], [0, .60, -.338], ivory, .012);
  characterPanel(hb, [[0, -.22], [-.095, -.04], [-.08, .15], [0, .35], [.055, .13], [.075, -.08]],
    [.42, .79, .02], ivory, .019, [0, -.2, -.42]);
  characterStrap(hb, [.34, .56, -.004], [.56, 1.04, .025], .015, .014, brass);
  hb.add('characterDetail', [.57, 1.014, .033], [.042, .11, .024], [0, 0, -.43], color);
  const headMesh = hb.mesh(); headMesh.name = 'face-hair-and-tricorn'; head.add(headMesh);

  const legs = [];
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'left' : 'right';
    const hip = new THREE.Group(); hip.name = label + '-hip'; hip.position.set(side * .215, 1.12, 0);
    const knee = new THREE.Group(); knee.name = label + '-knee'; knee.position.y = -.51;
    const upper = new GeoBatch(palette), lower = new GeoBatch(palette);
    const trouser = characterProfile([[-.49, .148, .16], [-.28, .18, .19], [-.04, .19, .195]], 12);
    upper.add(trouser, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#304c64'); trouser.dispose();
    characterStrap(upper, [side * .158, -.08, .115], [side * .146, -.46, .12], .025, .025, '#647789');
    upper.add('characterDetail', [0, -.45, -.105], [.142, .11, .09], [0, 0, 0], '#3e5a6c');
    lower.add('characterCylinder', [0, -.20, .014], [.158, .39, .171], [0, 0, 0], leather);
    lower.add('characterCylinder', [0, -.034, .014], [.186, .115, .19], [0, 0, 0], '#996a47');
    lower.add('characterSphere', [0, -.481, -.105], [.184, .128, .285], [-.04, 0, 0], '#514135');
    lower.add('box', [0, -.543, -.10], [.345, .075, .46], [0, 0, 0], '#35414a');
    lower.add('box', [0, -.51, .08], [.29, .13, .14], [0, 0, 0], '#35414a');
    lower.add('box', [side * .167, -.105, -.025], [.025, .092, .10], [0, 0, 0], brass);
    lower.add('box', [side * .183, -.105, -.025], [.010, .048, .054], [0, 0, 0], '#69523b');
    hip.add(upper.mesh(), knee); knee.add(lower.mesh()); figure.add(hip); legs.push({ hip, knee });
  }

  const weaponRig = new THREE.Group(); weaponRig.name = 'weapon-aim-recoil-rig'; torso.add(weaponRig);
  const stowRig = new THREE.Group(); stowRig.name = 'weapon-back-stow-rig';
  // Muzzle down, telescope facing away from the coat, butt below the tricorn.
  stowRig.position.set(.10, .92, .52); stowRig.rotation.set(-Math.PI / 2, 0, Math.PI / 2 + .12); torso.add(stowRig);
  const weapons = Object.fromEntries(WEAPON_ORDER.map(kind => [kind, buildWeapon(palette, kind)]));
  const weaponEntries = Object.entries(weapons);
  for (const [, weapon] of weaponEntries) { weaponRig.add(weapon.group); stowRig.add(weapon.stowed); }
  const arms = [], down = new THREE.Vector3(0, -1, 0);
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'left' : 'right';
    const shoulder = new THREE.Vector3(side * .45, .745, .015), upperLength = .52, lowerLength = .57;
    const upper = new THREE.Group(); upper.name = label + '-upper-arm'; upper.position.copy(shoulder);
    const forearm = new THREE.Group(); forearm.name = label + '-forearm';
    const ub = new GeoBatch(palette), fb = new GeoBatch(palette), handBatch = new GeoBatch(palette);
    ub.add('characterSphere', [0, -.11, 0], [.162, .22, .17], [0, 0, 0], color);
    ub.add('characterCylinder', [0, -.315, 0], [.137, .35, .145], [0, 0, 0], ivory);
    ub.add('characterCylinder', [0, -.465, 0], [.145, .09, .15], [0, 0, 0], '#d6c49f');
    ub.add('characterDetail', [0, -.505, 0], [.112, .09, .12], [0, 0, 0], skin);
    const forearmShape = characterProfile([[-.54, .088, .091], [-.34, .11, .105], [-.055, .119, .123]], 12);
    fb.add(forearmShape, [0, 0, 0], [1, 1, 1], [0, 0, 0], skin); forearmShape.dispose();
    fb.add('characterCylinder', [0, -.45, 0], [.107, .12, .111], [0, 0, 0], leather);
    fb.add('box', [0, -.45, -.113], [.075, .055, .018], [0, 0, 0], brass);
    const anchor = new THREE.Object3D(); anchor.name = label + '-weapon-grip';
    weaponRig.add(anchor);
    const hand = new THREE.Group(); hand.name = label + '-hand';
    if (side < 0) {
      handBatch.add('characterDetail', [-.075, .015, 0], [.08, .062, .075], [0, 0, 0], skin);
      handBatch.add('characterDetail', [.045, .039, 0], [.115, .074, .129], [0, 0, -.3], skin);
      for (const z of [-.073, -.024, .025, .074])
        handBatch.add('characterDetail', [.124, .092, z], [.047, .058, .023], [0, 0, -.28], skin);
      handBatch.add('characterDetail', [-.025, .10, -.02], [.043, .083, .036], [.3, 0, .25], skin);
    } else {
      handBatch.add('characterDetail', [-.004, .016, -.082], [.09, .09, .12], [.18, 0, 0], skin);
      for (const y of [-.035, .003, .041])
        handBatch.add('characterDetail', [-.079, y, -.114], [.048, .020, .084], [.1, 0, -.18], skin);
      handBatch.add('characterDetail', [-.024, .091, -.075], [.041, .035, .088], [0, -.18, 0], skin);
    }
    const handMesh = handBatch.mesh();
    if (side < 0) handMesh.position.x = .105;
    hand.add(handMesh); upper.add(ub.mesh()); forearm.add(fb.mesh()); torso.add(upper, forearm, hand);
    arms.push({ side, shoulder, upper, forearm, hand, handMesh, anchor, upperLength, lowerLength,
      wrist: new THREE.Vector3(), direction: new THREE.Vector3(), bend: new THREE.Vector3(), elbow: new THREE.Vector3(),
      segment: new THREE.Vector3(), glideTarget: new THREE.Vector3(side * .70, 2.29, -.17) });
  }

  const glider = buildGlider(palette, color).group; group.add(glider);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.70, 20), new THREE.MeshBasicMaterial({
    color: '#183c46', transparent: true, opacity: .20, depthWrite: false }));
  shadow.name = 'pirate-contact-shadow'; shadow.rotation.x = -Math.PI / 2; shadow.position.y = .025; group.add(shadow);

  let phase = 0, locomotion = 0, aiming = 0, glideBlend = 0, knockBlend = 0, recoil = 0;
  let equipped = 'flintlock', stowed = false;
  let previousReloadUntil = 0, cancelledReloadUntil = 0;
  const gliderToTorso = new THREE.Matrix4();
  const ease = (a, target, rate, dt) => THREE.MathUtils.lerp(a, target, 1 - Math.exp(-rate * dt));
  function animate(time = 0, speed = 0, player = {}, pose = {}) {
    const dt = THREE.MathUtils.clamp(Number.isFinite(pose.dt) ? pose.dt : 1 / 60, 0, .1);
    const elapsed = Number.isFinite(pose.elapsed) ? pose.elapsed : 0;
    const falling = player.mode === 'gliding', knocked = !!player.knockedUntil, mounted = player.mode === 'aboard' && !!player.gunId;
    const motion = falling || knocked ? 0 : THREE.MathUtils.clamp(Number.isFinite(speed) ? speed : 0, 0, 18);
    const nextWeapon = WEAPONS[player.weapon] ? player.weapon : 'flintlock';
    const reloadUntil = Number.isFinite(player.reloadUntil) ? player.reloadUntil : 0;
    const canReload = player.mode === 'ground' && !knocked && player.online !== false && !(Number.isFinite(player.hp) && player.hp <= 0);
    // A stale deadline must not transfer to a newly equipped gun or resume
    // after a glide/knock/offline transition. A new server deadline releases it.
    if (reloadUntil !== previousReloadUntil) cancelledReloadUntil = 0;
    if (!canReload || (nextWeapon !== equipped && reloadUntil === previousReloadUntil)) cancelledReloadUntil = reloadUntil;
    previousReloadUntil = reloadUntil;
    equipped = nextWeapon; stowed = falling;
    const handling = WEAPON_HANDLING[equipped];
    const reload = sampleReloadAnimation(equipped, reloadUntil, elapsed, handling.left,
      canReload && reloadUntil !== cancelledReloadUntil);
    // Distance-driven phase never changes frequency discontinuously at sprint.
    phase = (phase + motion * dt * 1.22) % (Math.PI * 2);
    locomotion = ease(locomotion, Math.min(1, motion / 4.5), 13, dt);
    if (motion === 0 && locomotion < .001) locomotion = 0;
    aiming = ease(aiming, pose.aiming ? 1 : 0, 16, dt);
    glideBlend = ease(glideBlend, falling ? 1 : 0, 10, dt);
    knockBlend = ease(knockBlend, knocked ? 1 : 0, 10, dt);
    recoil *= Math.exp(-18 * dt);
    figure.position.y = -.20 * knockBlend;
    figure.rotation.set(.07 * glideBlend, 0, .32 * knockBlend);
    const gait = Math.sin(phase), doubleGait = Math.cos(phase * 2);
    torso.position.y = 1.15 + doubleGait * .015 * locomotion;
    torso.rotation.set(.07 * knockBlend, Math.sin(phase) * .025 * locomotion * (1 - aiming * .7), gait * .022 * locomotion);
    tails.rotation.set(-.10 - glideBlend * .26 - doubleGait * .055 * locomotion, 0, -gait * .035 * locomotion);
    head.rotation.set((Number.isFinite(player.pitch) ? player.pitch : 0) * .12 - .09 * knockBlend,
      Math.sin(time * .75) * .025 * (1 - aiming), -gait * .012 * locomotion);
    for (let i = 0; i < legs.length; i++) {
      const step = Math.sin(phase + i * Math.PI);
      const hipAngle = step * .57 * locomotion;
      legs[i].hip.rotation.x = hipAngle * (1 - glideBlend) + (i ? .13 : -.24) * glideBlend - .76 * knockBlend;
      legs[i].hip.rotation.z = (i ? -.055 : .055) * glideBlend;
      legs[i].knee.rotation.x = -Math.max(0, -step) * .76 * locomotion * (1 - glideBlend) - .17 * glideBlend - .36 * knockBlend;
    }
    const pitch = THREE.MathUtils.lerp(THREE.MathUtils.clamp(Number.isFinite(player.pitch) ? player.pitch : 0, -1.2, 1.2), reload.pitch, reload.work);
    const steepness = Math.abs(Math.sin(pitch));
    const magazineReload = equipped === 'repeater' || equipped === 'burst';
    weaponRig.position.set(THREE.MathUtils.lerp(handling.stance[0], equipped === 'flintlock' ? .34 : magazineReload ? .47 : .55, reload.work),
      handling.stance[1] + aiming * .035 * (1 - reload.work) + Math.max(0, Math.sin(pitch)) * .045 - Math.min(0, Math.sin(pitch)) * .10 + reload.work * (magazineReload ? .03 : -.09) - knockBlend * .035,
      handling.stance[2] - steepness * .055 + Math.min(0, Math.sin(pitch)) * .22 + recoil * .025 - reload.work * (equipped === 'longshot' ? .18 : .09));
    // Work at chest height, then smoothly restore the live aim angle. This
    // keeps a high/low camera pitch from swinging the receiver through the face.
    weaponRig.rotation.set(pitch + recoil * .055 * (1 - reload.work) - knockBlend * .05,
      .30 * reload.work, reload.roll * reload.work);
    for (const arm of arms) {
      // left-weapon-grip is the current wrist target: fore-end at rest, loading
      // mechanism during a reload. The right socket always stays on the grip.
      arm.anchor.position.fromArray(arm.side < 0 ? reload.hand : handling.right);
      arm.anchor.rotation.set(0, arm.side < 0 ? -.12 * reload.release : 0,
        arm.side < 0 ? handling.supportRoll * (1 - reload.release) : -.04);
    }
    // Move the gun a few centimetres into the intersection of the two reachable
    // wrist spheres, rather than stretching the character's arms to meet it.
    for (let pass = 0; pass < 4; pass++) {
      weaponRig.updateMatrix();
      for (const arm of arms) {
        arm.wrist.copy(arm.anchor.position).applyMatrix4(weaponRig.matrix);
        arm.direction.copy(arm.wrist).sub(arm.shoulder);
        const reach = arm.direction.length(), maximum = arm.upperLength + arm.lowerLength - .025;
        if (reach > maximum) weaponRig.position.addScaledVector(arm.direction, -(reach - maximum) / reach);
      }
    }
    weaponRig.updateMatrix();
    glider.visible = falling; glider.rotation.z = Math.sin(time * 1.8) * .018;
    if (falling) {
      figure.updateMatrix(); torso.updateMatrix(); glider.updateMatrix();
      gliderToTorso.multiplyMatrices(figure.matrix, torso.matrix).invert().multiply(glider.matrix);
    }
    for (const [kind, weapon] of weaponEntries) {
      weapon.group.visible = !mounted && !stowed && equipped === kind;
      weapon.stowed.visible = !mounted && stowed && equipped === kind;
      // Reset every mesh, including hidden guns, so cancelled reloads and swaps
      // cannot leave a magazine or bolt displaced when that gun is used again.
      weapon.action.position.copy(weapon.actionOrigin); weapon.action.rotation.set(0, 0, 0);
      if (kind !== equipped) continue;
      if (kind === 'flintlock' || kind === 'scatter') weapon.action.rotation.z = -1.15 * reload.open;
      else if (kind === 'longshot') weapon.action.position.z += .17 * reload.open;
      else {
        weapon.action.position.x -= .26 * reload.open;
        weapon.action.position.y -= .12 * reload.open;
        if (kind === 'burst') weapon.action.position.z += .04 * reload.open;
      }
    }
    // Each wrist follows its current target exactly. Fixed-length IK supports
    // the gun with the right hand while the left performs the loading action.
    for (const arm of arms) {
      arm.wrist.copy(falling ? arm.glideTarget : arm.anchor.position);
      arm.wrist.applyMatrix4(falling ? gliderToTorso : weaponRig.matrix);
      if (mounted) arm.wrist.set(arm.side * .28, .38, -.48);
      arm.hand.position.copy(arm.wrist);
      if (falling) {
        arm.hand.rotation.set(0, arm.side * .2, arm.side * -.45);
        // Center the actual palm around the glider handle; the extended
        // sideways wrist used to cup a rifle is only part of the gun grip.
        arm.handMesh.position.set(arm.side < 0 ? -.045 : .004, arm.side < 0 ? -.039 : -.016, arm.side < 0 ? 0 : .082);
      } else {
        arm.hand.quaternion.copy(weaponRig.quaternion).multiply(arm.anchor.quaternion);
        arm.handMesh.position.set(arm.side < 0 ? .105 : 0, 0, 0);
      }
      arm.direction.copy(arm.wrist).sub(arm.shoulder);
      const distance = Math.max(.001, arm.direction.length());
      arm.direction.multiplyScalar(1 / distance);
      const upperLength = arm.upperLength, lowerLength = arm.lowerLength;
      const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
      const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
      // Forward is -Z. Outward elbows keep the entire forearm in front of the
      // coat even when the support wrist crosses toward the firing shoulder.
      if (falling) arm.bend.set(arm.side * .7, -.8, -.7);
      else if (arm.side > 0) arm.bend.set(.82 - aiming * .08, -1.2, -.08);
      else if (equipped === 'flintlock') arm.bend.set(-.65, -1.1, -.3);
      else arm.bend.set(-.4 + aiming * .10, -.30, -2.8);
      arm.bend.addScaledVector(arm.direction, -arm.bend.dot(arm.direction)).normalize();
      arm.elbow.copy(arm.shoulder).addScaledVector(arm.direction, along).addScaledVector(arm.bend, height);
      arm.segment.copy(arm.elbow).sub(arm.shoulder);
      arm.upper.scale.y = arm.segment.length() / arm.upperLength;
      arm.upper.quaternion.setFromUnitVectors(down, arm.segment.normalize());
      arm.forearm.position.copy(arm.elbow);
      arm.segment.copy(arm.wrist).sub(arm.elbow);
      arm.forearm.scale.y = arm.segment.length() / arm.lowerLength;
      arm.forearm.quaternion.setFromUnitVectors(down, arm.segment.normalize());
    }
    shadow.visible = player.mode === 'ground';
  }
  animate(0, 0, { mode: 'aboard', weapon: 'flintlock' });
  return { group, animate,
    fire(weapon = equipped) { recoil = Math.min(1.4, recoil + ({ flintlock: .82, scatter: 1.15, repeater: .38, burst: .48, longshot: 1.3 }[weapon] || .82)); },
    getMuzzle(targetVector3 = new THREE.Vector3()) {
      const weapon = weapons[equipped], socket = stowed ? weapon.stowedSocket : weapon.socket;
      socket.updateWorldMatrix(true, false);
      return targetVector3.setFromMatrixPosition(socket.matrixWorld);
    },
  };
}

export function buildCrab(palette, type = 'crab', size = 1) {
  const boss = type === 'tempest', spitter = type === 'spitter', tidebreaker = type === 'tidebreaker';
  const group = new THREE.Group(); group.name = type + '-crab'; group.userData.kind = type;
  const body = new THREE.Group(), b = new GeoBatch(palette);
  const shell = boss ? '#685fae' : spitter ? '#419f9f' : tidebreaker ? '#2f5f7c' : '#e88358';
  const light = boss ? '#9e92d7' : spitter ? '#72ccbb' : tidebreaker ? '#6fb3c4' : '#f3ad70';
  const dark = boss ? '#534b88' : spitter ? '#2d777f' : tidebreaker ? '#1e3f55' : '#b96043';
  const carapace = characterProfile([[.38, .63, .46], [.52, .83, .62], [.70, .86, .64], [.94, .69, .54], [1.10, .34, .34]], 20, 1);
  b.add(carapace, [0, 0, 0], [1, 1, 1], [0, 0, 0], shell); carapace.dispose();
  b.add('characterCylinder', [0, .525, -.015], [.855, .085, .636], [0, 0, 0], light);
  b.add('characterSphere', [0, .43, -.09], [.69, .16, .49], [0, 0, 0], '#f4d29d');
  for (const z of [-.30, -.06, .20, .40]) {
    const width = .67 * Math.sqrt(Math.max(.1, 1 - (z / .70) ** 2));
    const vertices = [], indices = [];
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10 - .5) * width * 2;
      const y = .69 + .43 * Math.sqrt(Math.max(.05, 1 - (x / .91) ** 2 - (z / .86) ** 2));
      vertices.push(x, y + .01, z - .018, x, y + .026, z + .018);
      if (i < 10) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
    }
    const ridge = surface(vertices, indices); b.add(ridge, [0, 0, 0], [1, 1, 1], [0, 0, 0], light); ridge.dispose();
  }
  for (const side of [-1, 1]) {
    for (const z of [-.22, .12, .39]) b.add('characterCone', [side * .81, .69, z], [.09, .21, .10], [0, 0, side * -1.16], light);
    b.add('characterDetail', [side * .32, .86, -.43], [.11, .11, .12], [0, 0, 0], dark);
    b.line([side * .32, .85, -.43], [side * .37, 1.23, -.49], .075, shell);
    b.add('characterDetail', [side * .37, 1.27, -.49], [.165, .18, .145], [0, 0, 0], '#fff7d8');
    b.add('characterDetail', [side * .37, 1.28, -.622], [.071, .093, .029], [0, 0, 0], '#173f50');
    b.add('characterDetail', [side * .389, 1.318, -.646], [.020, .025, .010], [0, 0, 0], '#ffffff');
    b.add('characterDetail', [side * .37, 1.398, -.51], [.16, .036, .12], [0, 0, side * -.14], shell);
  }
  characterStrap(b, [-.10, .44, -.575], [.10, .44, -.575], .035, .025, '#a36a50');
  for (const side of [-1, 1]) b.add('characterDetail', [side * .10, .47, -.59], [.088, .055, .07], [0, side * .25, 0], '#fff0c6');
  if (spitter) {
    b.add('characterDetail', [0, .93, .21], [.22, .15, .26], [0, 0, 0], '#b0edd2');
    for (const x of [-.12, .10]) b.add('characterDetail', [x, 1.015, .15], [.045, .025, .05], [0, 0, 0], '#e3f7be');
  }
  if (tidebreaker) {
    // A reef-armoured mini boss: barnacle clusters, a kelp drape and a pale
    // tide line across a shell that has spent years under the surf.
    for (const [x, z, r] of [[-.42, .05, .11], [-.28, .30, .085], [.36, -.08, .12], [.22, .34, .09], [.05, .44, .075], [-.10, -.22, .07], [.50, .18, .07]]) {
      const y = .69 + .43 * Math.sqrt(Math.max(.05, 1 - (x / .91) ** 2 - (z / .86) ** 2));
      b.add('characterCone', [x, y + .03, z], [r, r * 1.3, r], [0, 0, 0], '#e9e2cd');
      b.add('characterDetail', [x, y + .1 + r * .9, z], [r * .42, r * .3, r * .42], [0, 0, 0], '#6a6151');
    }
    b.add('characterCylinder', [0, .86, -.02], [.99, .03, .74], [0, 0, 0], '#c9ebe4');
    for (const side of [-1, 1]) {
      b.line([side * .55, .95, .28], [side * .74, .58, .55], .045, '#3e7d5c', .3);
      b.line([side * .40, .99, .40], [side * .48, .64, .70], .04, '#4f9a68', .3);
    }
    for (const side of [-1, 1]) b.add('characterCone', [side * .62, .93, -.30], [.11, .26, .11], [0, 0, side * -.9], light);
  }
  if (boss) {
    b.add('cone', [0, 1.40, .10], [.70, .65, .60], [0, 0, 0], '#bda4d1');
    b.add('characterCylinder', [0, 1.36, .10], [.56, .20, .56], [0, 0, 0], '#f3c561');
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      b.add('characterCone', [Math.sin(a) * .52, 1.69, .1 + Math.cos(a) * .52], [.16, .72, .16],
        [Math.cos(a) * .18, 0, -Math.sin(a) * .18], '#ffe29b');
      b.add('characterDetail', [Math.sin(a) * .59, 2.04, .1 + Math.cos(a) * .59], [.10, .10, .10], [0, 0, 0], '#79e1df');
    }
    for (const side of [-1, 1]) {
      b.line([side * .60, .88, .26], [side * .87, 1.38, .37], .095, '#ed8ea2', .65);
      b.line([side * .79, 1.2, .34], [side * 1.0, 1.37, .20], .065, '#f7afa9', .50);
    }
  }
  const shellMesh = b.mesh(); shellMesh.name = 'ridged-carapace-face-and-crown'; body.add(shellMesh); group.add(body);
  const legs = [], claws = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -.27 + i * .33, leg = new THREE.Group(), l = new GeoBatch(palette);
      leg.name = (side < 0 ? 'left' : 'right') + '-crab-leg-' + i; leg.position.set(side * .57, .53, z);
      const knee = [side * .45, -.015, .13 + i * .015], ankle = [side * .63, -.34, .19 + i * .015];
      l.line([0, 0, 0], knee, .095, shell, .75);
      l.add('characterDetail', knee, [.115, .105, .105], [0, 0, 0], dark);
      l.line(knee, ankle, .075, light, .65);
      l.add('characterDetail', ankle, [.076, .070, .080], [0, 0, 0], shell);
      l.line(ankle, [side * .72, -.49, .12], .055, dark, .20);
      leg.add(l.mesh()); group.add(leg); legs.push({ group: leg, side, index: i });
    }
    const claw = new THREE.Group(), c = new GeoBatch(palette);
    claw.name = (side < 0 ? 'left' : 'right') + '-crab-claw'; claw.position.set(side * .65, .64, -.43);
    c.add('characterDetail', [0, 0, 0], [.16, .14, .15], [0, 0, 0], dark);
    c.line([0, 0, 0], [side * .32, .035, -.18], .13, shell, .85);
    c.add('characterDetail', [side * .33, .035, -.19], [.15, .14, .14], [0, 0, 0], dark);
    c.line([side * .34, .04, -.20], [side * .45, .10, -.35], .145, shell);
    c.add('characterSphere', [side * .48, .11, -.42], [.265, .24, .34], [0, side * -.20, -.08], light);
    c.add('characterDetail', [side * .45, .245, -.42], [.18, .054, .23], [0, side * -.20, 0], shell);
    c.line([side * .34, .08, -.60], [side * .32, .08, -.84], .105, light, .55);
    c.line([side * .32, .08, -.84], [side * .42, .08, -.93], .059, '#fff0c6', .15);
    const jaw = new THREE.Group(), j = new GeoBatch(palette); jaw.name = 'moving-pincer-jaw';
    jaw.position.set(side * .59, .105, -.55);
    j.line([0, 0, 0], [side * .06, .02, -.23], .092, shell, .60);
    j.line([side * .06, .02, -.23], [side * -.065, .01, -.33], .052, '#fff0c6', .15);
    jaw.add(j.mesh()); claw.add(c.mesh(), jaw); group.add(claw); claws.push({ group: claw, jaw, side });
  }
  group.scale.setScalar(size);
  return { group, animate(time, enemy) {
    const windup = enemy.state === 'windup', moving = enemy.state === 'chase';
    body.position.y = Math.sin(time * 6) * (windup ? .09 : .018);
    body.scale.set(1 + (windup ? .06 : 0), 1 + (windup ? .09 : 0), 1);
    for (const leg of legs) {
      const phase = time * (moving ? 13 : 4) + leg.index * 1.45 + (leg.side < 0 ? Math.PI : 0);
      leg.group.rotation.z = Math.sin(phase) * (moving ? .17 : .025);
      leg.group.rotation.y = Math.cos(phase) * (moving ? .095 : .01);
    }
    for (const claw of claws) {
      claw.group.rotation.x = windup ? .85 + Math.sin(time * 18 + claw.side) * .08 : Math.sin(time * 4 + claw.side) * .045;
      claw.jaw.rotation.y = claw.side * (windup ? .40 + Math.sin(time * 15) * .05 : .09 + Math.sin(time * 2) * .035);
    }
  } };
}

// Chests and shrines are hero props: a pirate walks right up to them, so they
// are cut from chamfered slabs, swept arcs and flat facets instead of the
// scenery primitives. Every template below is shared by all instances and is
// only ever copied into a batch, never handed to a mesh, so disposing a model
// never takes one of them with it.
const CHAMFERED = new Map();
function chamferBox(chamfer = .12) {
  let geometry = CHAMFERED.get(chamfer);
  if (!geometry) {
    const half = .5 - chamfer, shape = new THREE.Shape();
    shape.moveTo(-half, -half); shape.lineTo(half, -half); shape.lineTo(half, half); shape.lineTo(-half, half); shape.closePath();
    geometry = new THREE.ExtrudeGeometry(shape, { depth: 1 - 2 * chamfer, bevelEnabled: true, bevelSize: chamfer, bevelThickness: chamfer, bevelSegments: 1, steps: 1 });
    geometry.translate(0, 0, chamfer - .5);
    CHAMFERED.set(chamfer, geometry);
  }
  return geometry;
}
const STUD = new THREE.OctahedronGeometry(1, 0);
const COIN = new THREE.CylinderGeometry(1, 1, 1, 8);
const DRUM = new THREE.CylinderGeometry(1, 1, 1, 12);
const TAPERED_DRUM = new THREE.CylinderGeometry(.76, 1, 1, 12);

// One elliptical sweep drives the chest lid's staves, its iron straps and the
// shrine's support arms. Each step reports the mid point of a chord, its
// length, the roll that lines a box up with the tangent, and the outward normal
// so a strap can be seated proud of the boards it holds down.
function arcSegments(count, radiusZ, radiusY, from = 0, to = Math.PI) {
  const steps = [];
  for (let i = 0; i < count; i++) {
    const a = from + (to - from) * i / count, b = from + (to - from) * (i + 1) / count;
    const ay = Math.sin(a) * radiusY, az = -Math.cos(a) * radiusZ;
    const by = Math.sin(b) * radiusY, bz = -Math.cos(b) * radiusZ;
    const dy = by - ay, dz = bz - az, length = Math.hypot(dy, dz) || 1e-6;
    steps.push({ y: (ay + by) / 2, z: (az + bz) / 2, length, angle: Math.atan2(-dy / length, dz / length),
      normalY: dz / length, normalZ: -dy / length });
  }
  return steps;
}

// The lid's end boards: a half ellipse with a chamfered rim, standing in the
// z/y plane so its thickness runs along x.
function archPlate(radiusZ, radiusY, thickness, segments = 14) {
  const shape = new THREE.Shape();
  shape.moveTo(-radiusZ, 0);
  for (let i = 1; i <= segments; i++) {
    const a = Math.PI - i * Math.PI / segments;
    shape.lineTo(Math.cos(a) * radiusZ, Math.sin(a) * radiusY);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 4 });
  geometry.translate(0, 0, -thickness / 2); geometry.rotateY(Math.PI / 2); return geometry;
}

// A cut crystal: staggered rings of flat facets. The shell is left unindexed so
// every facet keeps its own normal and the light breaks across the cut instead
// of sliding over a smooth ball.
function facetShell(rings, segments = 9, twist = .34) {
  const positions = [];
  const at = (k, i) => {
    const [y, radius] = rings[k], a = (i + k * twist) / segments * Math.PI * 2;
    return [Math.sin(a) * radius, y, Math.cos(a) * radius];
  };
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < segments; i++) {
    const a0 = at(k, i), a1 = at(k, i + 1), b0 = at(k + 1, i), b1 = at(k + 1, i + 1);
    if (rings[k][1] > 1e-6) positions.push(...a0, ...a1, ...b1);
    if (rings[k + 1][1] > 1e-6) positions.push(...a0, ...b1, ...b0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); return geometry;
}

// Deterministic hoard scatter: every client spills the same coins in the same
// chest, and a test can rely on the layout.
function scatter(seed) { let value = seed >>> 0; return () => (value = (value * 1664525 + 1013904223) >>> 0) / 4294967296; }
// Frame rate independent approach without importing a clock: the same easing at
// 30, 60 or 144 Hz, and an instant snap when motion is turned down.
function approach(current, target, dt, rate, snap) {
  if (snap) return target;
  const step = Number.isFinite(dt) && dt > 0 ? 1 - Math.exp(-Math.min(dt, .25) * rate) : 1 - Math.exp(-rate / 60);
  return current + (target - current) * step;
}

const CHEST_SEAM = .645, CHEST_OPEN = 1.78;

export function buildChest(palette) {
  const oak = '#8f5a35', oakLit = '#a97243', oakDark = '#6f452a', lining = '#59371f', liningLit = '#7b4f2e';
  const brass = '#e9b855', brassLit = '#ffd270', brassDark = '#b98a37', iron = '#4a3a30';
  const group = new THREE.Group(), shell = new GeoBatch(palette), hoardBatch = new GeoBatch(palette), lidBatch = new GeoBatch(palette);
  const glintMaterial = palette.glow.clone();
  glintMaterial.name = 'chest-hoard-glint'; glintMaterial.transparent = true; glintMaterial.depthWrite = false; glintMaterial.opacity = .3;
  const glintBatch = new GeoBatch(palette, glintMaterial);
  // The hollow the lid uncovers. Nothing structural reaches inside it.
  const cavity = new THREE.Box3(new THREE.Vector3(-.6375, .20, -.3775), new THREE.Vector3(.6375, CHEST_SEAM, .3775));

  shell.add(chamferBox(.14), [0, .025, 0], [1.50, .05, 1.00], [0, 0, 0], iron);
  shell.add(chamferBox(.14), [0, .085, 0], [1.46, .09, .96], [0, 0, 0], oakDark);
  // Front and back are five upright staves; the ends are three stacked boards.
  // Real seams, so the toon ramp draws the planking instead of implying it.
  for (const sz of [-1, 1]) [-.60, -.30, 0, .30, .60].forEach((x, i) => {
    shell.add(chamferBox(.16), [x, .385, sz * .465], [.285, .53, .07], [0, 0, 0], i % 2 ? oak : oakLit);
  });
  for (const sx of [-1, 1]) [.20, .385, .57].forEach((y, i) => {
    shell.add(chamferBox(.16), [sx * .715, y, 0], [.07, .155, .93], [0, 0, 0], i % 2 ? oakLit : oak);
  });
  // The liner: a darker second skin that only reads once the lid swings clear.
  shell.add(chamferBox(.1), [0, .175, 0], [1.30, .05, .80], [0, 0, 0], lining);
  for (let i = 0; i < 5; i++) shell.add(chamferBox(.14), [-.52 + i * .26, .19, 0], [.235, .03, .76], [0, 0, 0], i % 2 ? liningLit : lining);
  for (const sz of [-1, 1]) shell.add(chamferBox(.1), [0, .42, sz * .395], [1.28, .45, .035], [0, 0, 0], lining);
  for (const sx of [-1, 1]) shell.add(chamferBox(.1), [sx * .655, .42, 0], [.035, .45, .78], [0, 0, 0], liningLit);
  // Brass mouth frame, the lip the lid closes onto.
  for (const sz of [-1, 1]) shell.add(chamferBox(.2), [0, .615, sz * .45], [1.48, .055, .11], [0, 0, 0], brassDark);
  for (const sx of [-1, 1]) shell.add(chamferBox(.2), [sx * .70, .615, 0], [.11, .055, .90], [0, 0, 0], brassDark);
  // Two hammered straps per face, riveted, plus the corner caps and feet.
  for (const sx of [-.47, .47]) for (const sz of [-1, 1]) {
    shell.add(chamferBox(.22), [sx, .38, sz * .513], [.13, .55, .045], [0, 0, 0], sz < 0 ? brass : brassDark);
    for (const y of [.19, .38, .57]) shell.add(STUD, [sx, y, sz * .5375], [.038, .038, .022], [0, 0, 0], brassLit);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    shell.add(chamferBox(.2), [sx * .753, .38, sz * .42], [.04, .55, .18], [0, 0, 0], brassDark);
    shell.add(chamferBox(.2), [sx * .645, .38, sz * .513], [.20, .55, .045], [0, 0, 0], brass);
    shell.add(chamferBox(.2), [sx * .655, .075, sz * .43], [.24, .11, .20], [0, 0, 0], iron);
    for (const y of [.19, .57]) shell.add(STUD, [sx * .70, y, sz * .5375], [.042, .042, .022], [0, 0, 0], brassLit);
  }
  // Shield shaped lock with a real keyhole cut, and a drop ring at each end.
  shell.add(chamferBox(.22), [0, .50, -.508], [.30, .28, .04], [0, 0, 0], brass);
  shell.add(chamferBox(.3), [0, .335, -.505], [.19, .11, .036], [0, 0, 0], brassLit);
  shell.add(chamferBox(.3), [0, .615, -.505], [.19, .07, .036], [0, 0, 0], brassLit);
  shell.add('cylinder', [0, .525, -.535], [.048, .022, .048], [Math.PI / 2, 0, 0], '#2b211a');
  shell.add(chamferBox(.3), [0, .465, -.535], [.032, .08, .022], [0, 0, 0], '#2b211a');
  for (const sx of [-1, 1]) {
    shell.add(chamferBox(.24), [sx * .748, .40, 0], [.05, .24, .32], [0, 0, 0], brassDark);
    shell.add('ring', [sx * .756, .335, 0], [.15, .15, .12], [0, Math.PI / 2, 0], brass);
    for (const sz of [-1, 1]) shell.add(STUD, [sx * .758, .475, sz * .105], [.028, .046, .046], [0, 0, 0], brassLit);
  }

  // Segmented barrel lid. The pivot sits on the back top edge so the boards
  // rotate about the hinge line itself: the mouth is never swept through.
  const lid = new THREE.Group(); lid.name = 'chest-lid'; lid.position.set(0, CHEST_SEAM, .50);
  const staves = arcSegments(9, .50, .415);
  staves.forEach((s, i) => {
    lidBatch.add(chamferBox(.13), [0, s.y - s.normalY * .0375, -.50 + s.z - s.normalZ * .0375],
      [1.42, .075, s.length - .014], [s.angle, 0, 0], i % 2 ? oak : oakLit);
  });
  for (const s of arcSegments(4, .50, .415, .38, Math.PI - .38)) {
    lidBatch.add(chamferBox(.16), [0, s.y - s.normalY * .105, -.50 + s.z - s.normalZ * .105], [1.30, .04, s.length - .03], [s.angle, 0, 0], lining);
  }
  const board = archPlate(.50, .415, .055), boss = archPlate(.33, .27, .03);
  for (const sx of [-1, 1]) {
    lidBatch.add(board, [sx * .715, 0, -.50], [1, 1, 1], [0, 0, 0], oakDark);
    lidBatch.add(boss, [sx * .752, .015, -.50], [1, 1, 1], [0, 0, 0], brassDark);
  }
  board.dispose(); boss.dispose();
  for (const sx of [-.47, .47]) for (const s of arcSegments(10, .50, .415, .10, Math.PI - .10)) {
    lidBatch.add(chamferBox(.22), [sx, s.y + s.normalY * .0225, -.50 + s.z + s.normalZ * .0225], [.13, .045, s.length], [s.angle, 0, 0], brass);
  }
  for (const sx of [-.47, .47]) for (const t of [.42, Math.PI / 2, Math.PI - .42]) {
    const [s] = arcSegments(1, .50, .415, t - .02, t + .02);
    lidBatch.add(STUD, [sx, s.y + s.normalY * .044, -.50 + s.z + s.normalZ * .044], [.038, .032, .038], [s.angle, 0, 0], brassLit);
  }
  lidBatch.add(chamferBox(.26), [0, -.09, -1.018], [.17, .25, .04], [0, 0, 0], brass);
  lidBatch.add(STUD, [0, -.17, -1.044], [.042, .042, .022], [0, 0, 0], brassLit);
  lidBatch.add(chamferBox(.24), [0, .012, -.998], [.24, .07, .07], [0, 0, 0], brassDark);

  // The hoard itself: mounded coin, loose struck coins and cut stones, all of
  // it seated below the seam so it is only ever seen through an open lid.
  const random = scatter(0x5c1e77);
  for (const [mx, mz, radius] of [[-.30, -.04, .26], [.06, .05, .30], [.36, -.02, .22]])
    hoardBatch.add('pebble', [mx, .305, mz], [radius, .10, radius * .7], [0, random() * 3, 0], '#c9902a');
  for (let i = 0; i < 18; i++) {
    const x = -.50 + random() * 1.00, z = -.28 + random() * .56, y = .252 + random() * .085;
    hoardBatch.add(COIN, [x, y, z], [.072, .016, .072], [(random() - .5) * .55, random() * 3, (random() - .5) * .55], i % 3 ? '#f6c343' : '#ffe08a');
  }
  const gemColors = ['#ff7f9d', '#7de3a8', '#8ec9ff', '#ffd76a', '#c79bff'];
  for (let i = 0; i < 7; i++) {
    const x = -.44 + random() * .88, z = -.22 + random() * .44, y = .335 + random() * .07;
    const spin = random() * 3, tone = gemColors[i % gemColors.length];
    hoardBatch.add(STUD, [x, y, z], [.07, .105, .07], [.18, spin, 0], tone);
    glintBatch.add(STUD, [x, y, z], [.042, .066, .042], [.18, spin, 0], tone);
  }
  for (let i = 0; i < 5; i++) glintBatch.add(COIN, [-.42 + i * .21, .335, -.16 + random() * .32], [.055, .01, .055], [0, random() * 3, 0], '#ffeeb0');

  const shellMesh = shell.mesh(), hoard = hoardBatch.mesh(), glints = glintBatch.mesh({ shadow: false }), lidMesh = lidBatch.mesh();
  shellMesh.name = 'chest-shell'; hoard.name = 'chest-hoard'; glints.name = 'chest-hoard-glint';
  lid.add(lidMesh); group.add(shellMesh, hoard, glints, lid);
  const readout = { lidAngle: 0, openness: 0, glow: glintMaterial.opacity };
  // animate(time, opened, options) — options may also be a bare reduced motion
  // flag. { reducedMotion, dt, nearby } are all optional; the legacy two
  // argument call still eases at exactly the old 60 Hz rate.
  return { group, lid, shell: shellMesh, hoard, glints, glintMaterial, cavity, seam: CHEST_SEAM, openAngle: CHEST_OPEN, readout,
    animate(time, opened, options = {}) {
      const settings = typeof options === 'boolean' ? { reducedMotion: options } : (options || {});
      const { reducedMotion = false, dt = 1 / 60, nearby = false } = settings;
      lid.rotation.x = approach(lid.rotation.x, opened ? CHEST_OPEN : 0, dt, 9, reducedMotion);
      const openness = THREE.MathUtils.clamp(lid.rotation.x / CHEST_OPEN, 0, 1), motion = reducedMotion ? 0 : time;
      glintMaterial.opacity = THREE.MathUtils.clamp(.26 + openness * .62 + (nearby ? .06 : 0) + Math.sin(motion * 2.3) * .035 * openness, 0, 1);
      readout.lidAngle = lid.rotation.x; readout.openness = openness; readout.glow = glintMaterial.opacity;
      return readout;
    } };
}

const SHRINE_GEM_HEIGHT = 2.65, SHRINE_RETURN_HEIGHT = 4.15;
const SHRINE_CYAN = '#7ef0ff', SHRINE_WARM = '#ffdca0';

export function buildShrine(palette, color = '#f8d778') {
  const pale = '#d6d3b0', moss = '#a3b79f', mossDark = '#8aa197', slate = '#6f8a86', shade = '#b9c3a8';
  const brass = '#e6c57d', brassLit = '#ffe3a6', brassDark = '#b9903f';
  const group = new THREE.Group(), stone = new GeoBatch(palette), brassBatch = new GeoBatch(palette);
  const gemMaterial = palette.glow.clone(), runeMaterial = palette.glow.clone(), returnMaterial = palette.glow.clone();
  gemMaterial.name = 'shrine-crystal'; gemMaterial.transparent = true; gemMaterial.depthWrite = false; gemMaterial.opacity = .86; gemMaterial.side = THREE.DoubleSide;
  runeMaterial.name = 'shrine-runes'; runeMaterial.transparent = true; runeMaterial.depthWrite = false; runeMaterial.opacity = .18; runeMaterial.color.set(SHRINE_WARM);
  returnMaterial.name = 'shrine-return-glyph'; returnMaterial.transparent = true; returnMaterial.depthWrite = false; returnMaterial.opacity = 0; returnMaterial.color.set(SHRINE_CYAN);
  const gemBatch = new GeoBatch(palette, gemMaterial), runeBatch = new GeoBatch(palette, runeMaterial), returnBatch = new GeoBatch(palette, returnMaterial);
  // Everything on the drums is placed by station: an angle around the shrine,
  // a radius, and a sideways offset along that facet's tangent.
  const station = (batch, geometry, angle, radius, offset, y, scale, color2, rotation = 0) => {
    const sin = Math.sin(angle), cos = Math.cos(angle);
    batch.add(geometry, [sin * radius + cos * offset, y, cos * radius - sin * offset], scale, [rotation, angle, 0], color2);
  };

  // Three cut tiers. The middle drum is a recessed core wearing twelve framed
  // panels, so the ornament is a real hollow in the stone, not a painted line.
  stone.add(DRUM, [0, .09, 0], [2.14, .18, 2.14], [0, 0, 0], mossDark);
  for (let i = 0; i < 12; i++) station(stone, chamferBox(.16), i / 12 * Math.PI * 2, 2.16, 0, .095, [.92, .19, .16], i % 2 ? moss : '#98ac95');
  stone.add(DRUM, [0, .205, 0], [2.02, .07, 2.02], [0, 0, 0], slate);
  stone.add(DRUM, [0, .32, 0], [1.74, .21, 1.74], [0, 0, 0], slate);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    station(stone, 'box', a, 1.755, 0, .32, [.80, .17, .07], '#5f7b78');
    for (const sx of [-1, 1]) station(stone, 'box', a, 1.83, sx * .335, .32, [.13, .19, .10], shade);
    for (const [sy, tone] of [[1, pale], [-1, mossDark]]) station(stone, 'box', a, 1.83, 0, .32 + sy * .085, [.80, .05, .10], tone);
    // Inset glyph, seated on the floor of its own recess.
    station(runeBatch, 'box', a, 1.80, 0, .335, [.045, .085, .02], '#ffffff');
    station(runeBatch, 'box', a, 1.80, 0, .295, [.10, .022, .02], '#ffffff');
    station(runeBatch, 'box', a, 1.80, i % 2 ? .06 : -.06, .365, [.055, .022, .02], '#e8fbff');
  }
  stone.add(DRUM, [0, .445, 0], [1.62, .06, 1.62], [0, 0, 0], slate);
  stone.add(DRUM, [0, .53, 0], [1.50, .14, 1.50], [0, 0, 0], pale);
  // Mosaic inlay across the top tread, with a carved compass rose at its heart.
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    station(stone, 'box', a, 1.16, 0, .607, [.46, .03, .40], i % 2 ? shade : '#c7bf9a');
    station(runeBatch, 'box', a, 1.16, 0, .615, [.05, .022, .19], '#ffffff');
  }
  stone.add(DRUM, [0, .615, 0], [.94, .03, .94], [0, 0, 0], shade);
  for (let i = 0; i < 4; i++) station(runeBatch, 'box', i / 4 * Math.PI * 2 + Math.PI / 4, .62, 0, .625, [.05, .022, .62], '#ffffff');

  // Fluted column, carved collar and a brass table under the crystal.
  stone.add(DRUM, [0, .68, 0], [.88, .12, .88], [0, 0, 0], pale);
  stone.add(DRUM, [0, .76, 0], [.72, .07, .72], [0, 0, 0], slate);
  stone.add(TAPERED_DRUM, [0, 1.14, 0], [.50, .78, .50], [0, 0, 0], shade);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    stone.add('cylinder', [Math.sin(a) * .46, 1.14, Math.cos(a) * .46], [.075, .74, .075], [0, 0, 0], i % 2 ? pale : mossDark);
  }
  stone.add(DRUM, [0, 1.56, 0], [.66, .09, .66], [0, 0, 0], slate);
  stone.add(DRUM, [0, 1.65, 0], [.86, .10, .86], [0, 0, 0], brass);
  for (let i = 0; i < 16; i++) station(runeBatch, 'box', i / 16 * Math.PI * 2, .90, 0, 1.65, [.05, .05, .03], '#ffffff');

  // Sculpted supports: a fluted post on each of the original pillar sites, and
  // a brass arm that bows out and sweeps up to cradle the astrolabe.
  for (const sx of [-1, 1]) {
    stone.add(DRUM, [sx * 1.32, .655, 0], [.44, .11, .44], [0, 0, 0], pale);
    stone.add(TAPERED_DRUM, [sx * 1.32, 1.00, 0], [.30, .70, .30], [0, 0, 0], mossDark);
    for (const sz of [-1, 1]) stone.add('cylinder', [sx * 1.32, 1.00, sz * .24], [.06, .66, .06], [0, 0, 0], shade);
    stone.add(DRUM, [sx * 1.32, 1.375, 0], [.38, .08, .38], [0, 0, 0], pale);
    stone.add('cone', [sx * 1.32, 1.52, 0], [.28, .30, .28], [0, 0, 0], brass);
    const arm = u => [sx * (1.32 + .20 * Math.sin(u * Math.PI) - .36 * u), 1.55 + 1.10 * u ** .85];
    for (let i = 0; i < 7; i++) {
      const [x0, y0] = arm(i / 7), [x1, y1] = arm((i + 1) / 7);
      const dx = x1 - x0, dy = y1 - y0, length = Math.hypot(dx, dy);
      stone.add(chamferBox(.2), [(x0 + x1) / 2, (y0 + y1) / 2, 0], [.12, length + .02, .19],
        [0, 0, Math.atan2(-dx / length, dy / length)], i % 2 ? brass : brassDark);
    }
    const [tipX, tipY] = arm(1);
    stone.add(STUD, [tipX, tipY, 0], [.11, .13, .11], [0, .4, 0], brassLit);
  }

  // Brass astrolabe: three rings on different planes, an inclined axis and
  // graduated ticks. It is its own mesh so it can turn against the crystal.
  const orrery = new THREE.Group(); orrery.name = 'shrine-astrolabe'; orrery.position.y = SHRINE_GEM_HEIGHT;
  brassBatch.add('ring', [0, 0, 0], [.98, .98, .5], [Math.PI / 2, 0, 0], brass);
  brassBatch.add('ring', [0, 0, 0], [.88, .88, .5], [0, 0, .26], brassDark);
  brassBatch.add('ring', [0, 0, 0], [.78, .78, .45], [0, Math.PI / 2, .42], brassLit);
  // The inclined axis stops short of the crystal at both poles rather than
  // spearing it, so the stone reads as suspended between the bearings.
  const axis = new THREE.Vector3(.20, 1, .13).normalize();
  for (const sy of [-1, 1]) {
    const inner = axis.clone().multiplyScalar(sy * .80), outer = axis.clone().multiplyScalar(sy * 1.02);
    brassBatch.line([inner.x, inner.y, inner.z], [outer.x, outer.y, outer.z], .028, brass);
    brassBatch.add(STUD, [outer.x, outer.y, outer.z], [.075, .095, .075], [0, .4, 0], brassLit);
  }
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    brassBatch.add('box', [Math.sin(a) * .98, 0, Math.cos(a) * .98], [.035, i % 3 ? .07 : .12, .035], [0, a, 0], i % 3 ? brassDark : brassLit);
  }
  const orreryMesh = brassBatch.mesh(); orreryMesh.name = 'shrine-astrolabe-brass'; orrery.add(orreryMesh);

  // The crystal: a cut shell with a brighter core burning inside it.
  const crystal = facetShell([[-1, 0], [-.62, .46], [-.12, .64], [.38, .42], [.78, .18], [1, 0]], 9, .38);
  gemBatch.add(crystal, [0, 0, 0], [.62, .72, .62], [0, 0, 0], color);
  gemBatch.add(crystal, [0, .02, 0], [.34, .46, .34], [0, .35, 0], '#ffffff');
  crystal.dispose();
  const gem = gemBatch.mesh({ shadow: false }); gem.name = 'shrine-crystal'; gem.position.y = SHRINE_GEM_HEIGHT;

  // The cyan way home: a ring, a rising arrow and a hull, in the same glyph
  // language as the airship lift so it reads as "back to the boat".
  returnBatch.add('ring', [0, -.44, 0], [.52, .52, .3], [Math.PI / 2, 0, 0], '#ffffff');
  returnBatch.add('cylinder', [0, -.04, 0], [.115, .62, .115], [0, 0, 0], '#dffcff');
  returnBatch.add('cone', [0, .48, 0], [.38, .46, .38], [0, 0, 0], '#ffffff');
  returnBatch.add(chamferBox(.28), [0, -.62, 0], [.62, .12, .26], [0, 0, 0], '#dffcff');
  returnBatch.add(chamferBox(.3), [0, -.53, 0], [.30, .08, .16], [0, 0, 0], '#ffffff');
  const returnMarker = returnBatch.mesh({ shadow: false });
  returnMarker.name = 'shrine-return-to-boat-marker'; returnMarker.position.y = SHRINE_RETURN_HEIGHT; returnMarker.visible = false;

  const stoneMesh = stone.mesh(), runes = runeBatch.mesh({ shadow: false });
  stoneMesh.name = 'shrine-stone'; runes.name = 'shrine-runes';
  group.add(stoneMesh, runes, orrery, gem, returnMarker);
  let proximity = 0;
  const readout = { proximity: 0, cleared: false, active: false, returnVisible: false, runeGlow: runeMaterial.opacity };
  // animate(time, state, options) with options { nearby, reducedMotion, dt,
  // returnEnabled }. returnEnabled: false keeps the crystal alive but drops
  // every trace of the way-home glyph, which is what the central beacon wants.
  return { group, gem, gemMaterial, runes, runeMaterial, returnMarker, returnMaterial, orrery, stone: stoneMesh,
    gemHeight: SHRINE_GEM_HEIGHT, returnHeight: SHRINE_RETURN_HEIGHT, readout,
    animate(time, state, options = {}) {
      const { nearby = false, reducedMotion = false, dt = 1 / 60, returnEnabled = true } = options || {};
      const status = state?.status, cleared = status === 'cleared', active = status === 'active';
      proximity = THREE.MathUtils.clamp(approach(proximity, nearby ? 1 : 0, dt, 5, reducedMotion), 0, 1);
      const motion = reducedMotion ? 0 : time, guiding = cleared && returnEnabled !== false;
      gem.position.y = SHRINE_GEM_HEIGHT + Math.sin(motion * 1.7) * .18;
      gem.rotation.y = motion * .42;
      gem.scale.setScalar(cleared ? .82 : 1);
      orrery.rotation.y = -motion * .23; orrery.rotation.z = Math.sin(motion * .5) * .05;
      gemMaterial.opacity = THREE.MathUtils.clamp(.64 + proximity * .3 + (active ? .06 : 0) + Math.sin(motion * 1.1) * .04, 0, 1);
      runeMaterial.color.set(guiding ? SHRINE_CYAN : SHRINE_WARM);
      runeMaterial.opacity = THREE.MathUtils.clamp((cleared ? .30 : active ? .34 : .16) + proximity * .52 + Math.sin(motion * 1.3) * .035, 0, 1);
      returnMarker.visible = guiding;
      returnMaterial.opacity = guiding ? THREE.MathUtils.clamp(.24 + proximity * .66, 0, 1) : 0;
      returnMarker.position.y = SHRINE_RETURN_HEIGHT + proximity * .26 + Math.sin(motion * 1.6) * .14;
      returnMarker.scale.setScalar(.74 + proximity * .32);
      returnMarker.rotation.y = motion * .5;
      readout.proximity = proximity; readout.cleared = cleared; readout.active = active;
      readout.returnVisible = guiding; readout.runeGlow = runeMaterial.opacity;
      return readout;
    } };
}

export function addLighthouse(batch, x, y, z) {
  batch.add('cylinder', [x, y + .35, z], [4.5, .7, 4.5], [0, 0, 0], '#b7c4b9');
  batch.add('cylinder', [x, y + .9, z], [3.6, .45, 3.6], [0, 0, 0], '#d7cbb0');
  const tower = new THREE.CylinderGeometry(1.75, 3.15, 23, 12);
  batch.add(tower, [x, y + 12.5, z], [1, 1, 1], [0, 0, 0], '#f1e6cc'); tower.dispose();
  for (const h of [5.5, 12.4, 19.3]) {
    const radius = THREE.MathUtils.lerp(3.15, 1.75, (h - 1) / 23);
    batch.add('cylinder', [x, y + h, z], [radius + .035, 1.7, radius + .035], [0, 0, 0], '#45a5ac');
  }
  batch.add('box', [x, y + 2.4, z + 3.03], [1.45, 2.6, .18], [0, 0, 0], '#345767');
  batch.add('box', [x + .4, y + 2.1, z + 3.15], [.16, .16, .07], [0, 0, 0], '#f8d36c');
  for (const h of [7.8, 14.8, 21.6]) {
    const radius = THREE.MathUtils.lerp(3.15, 1.75, (h - 1) / 23);
    batch.add('box', [x, y + h, z + radius], [.65, 1.08, .15], [0, 0, 0], '#f1c25b');
    batch.add('box', [x, y + h, z + radius + .10], [.44, .86, .1], [0, 0, 0], '#567fa2');
  }
  batch.add('cylinder', [x, y + 24.1, z], [3.0, .45, 3.0], [0, 0, 0], '#32566c');
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    batch.line([x + Math.sin(a) * 2.8, y + 24.3, z + Math.cos(a) * 2.8], [x + Math.sin(a) * 2.8, y + 25.5, z + Math.cos(a) * 2.8], .07, '#ecbd62');
    const n = (i + 1) / 12 * Math.PI * 2;
    batch.line([x + Math.sin(a) * 2.8, y + 25.5, z + Math.cos(a) * 2.8], [x + Math.sin(n) * 2.8, y + 25.5, z + Math.cos(n) * 2.8], .07, '#ecbd62');
  }
  batch.add('cylinder', [x, y + 26.0, z], [1.55, 3.5, 1.55], [0, 0, 0], '#b2eeeb');
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    batch.line([x + Math.sin(a) * 1.63, y + 24.3, z + Math.cos(a) * 1.63], [x + Math.sin(a) * 1.63, y + 27.7, z + Math.cos(a) * 1.63], .11, '#8d7349');
  }
  batch.add('cone', [x, y + 28.7, z], [2.6, 2.5, 2.6], [0, 0, 0], '#35687e');
  batch.add('sphere', [x, y + 30.2, z], [.38, .42, .38], [0, 0, 0], '#f7ce77');
  for (let i = 0; i < 4; i++) batch.add('box', [x, y + .12 + i * .15, z + 4.4 - i * .45], [3.3, .23 + i * .3, .6], [0, 0, 0], '#d4c7a8');
}
