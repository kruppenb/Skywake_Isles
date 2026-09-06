import * as THREE from 'three';
import { WEAPON_ORDER, WEAPONS } from '../shared/weapons.js';

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

export function buildGalleon(palette) {
  const group = new THREE.Group(), b = new GeoBatch(palette);
  const sailMaterial = palette.solid.clone();
  sailMaterial.transparent = true;
  const sailBatch = new GeoBatch(palette, sailMaterial);
  const cabinMaterial = palette.solid.clone();
  cabinMaterial.transparent = true;
  const cabinBatch = new GeoBatch(palette, cabinMaterial);
  const rows = [[-15, .12], [-13, 2.0], [-10, 3.75], [-5, 4.55], [1, 4.75], [6, 4.5], [10, 3.8], [12, 2.0]];
  const hullVertices = [], hullIndices = [];
  for (const [z, width] of rows) {
    for (const [sx, yy] of [[-1, .2], [-.98, -1.3], [-.73, -3.05], [0, -4.2], [.73, -3.05], [.98, -1.3], [1, .2]]) hullVertices.push(sx * width, yy * Math.min(1, width / 2), z);
  }
  for (let j = 0; j < rows.length - 1; j++) for (let k = 0; k < 6; k++) {
    const a = j * 7 + k, c = a + 7;
    hullIndices.push(a, a + 1, c, a + 1, c + 1, c);
  }
  const hull = surface(hullVertices, hullIndices);
  b.add(hull, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#193f59'); hull.dispose();
  const outline = rows.map(([z, w]) => [-w, z]).concat(rows.slice().reverse().map(([z, w]) => [w, z]));
  const deck = flatShape(outline, .12);
  b.add(deck, [0, -.12, 0], [1, 1, 1], [0, 0, 0], '#b97946'); deck.dispose();
  for (let z = -12; z <= 10; z += 1.15) {
    const rowIndex = rows.findIndex(r => r[0] >= z), a = rows[Math.max(0, rowIndex - 1)], c = rows[Math.max(1, rowIndex)];
    const w = THREE.MathUtils.lerp(a[1], c[1], (z - a[0]) / (c[0] - a[0]));
    b.add('box', [0, .025, z], [w * 1.9, .045, .95], [0, 0, 0], Math.round(z) % 2 ? '#d5a161' : '#ca9258');
  }
  for (let side of [-1, 1]) {
    for (let j = 0; j < rows.length - 1; j++) {
      const [az, aw] = rows[j], [bz, bw] = rows[j + 1];
      b.line([side * aw, .2, az], [side * bw, .2, bz], .2, '#684733');
      b.line([side * aw, 1.05, az], [side * bw, 1.05, bz], .13, '#f0c05d');
      b.line([side * aw * .99, -1.1, az], [side * bw * .99, -1.1, bz], .11, '#e8b655');
      b.line([side * aw * .77, -2.9, az], [side * bw * .77, -2.9, bz], .08, '#34718a');
      b.line([side * aw, .1, az], [side * aw, 1.04, az], .09, '#7c5636');
    }
    for (let z of [-7, -2, 3, 7]) {
      b.add('sphere', [side * 4.43, -1.8, z], [.13, .34, .40], [0, 0, 0], '#e5b04e');
      b.add('sphere', [side * 4.53, -1.8, z], [.10, .22, .28], [0, 0, 0], '#4fc0cc');
    }
  }
  cabinBatch.add('box', [0, 1.25, 8.45], [6.4, 2.5, 4.0], [0, 0, 0], '#24495f');
  cabinBatch.add('box', [0, 2.65, 8.35], [7, .30, 4.55], [0, 0, 0], '#a96a42');
  for (const x of [-2.2, 0, 2.2]) {
    cabinBatch.add('box', [x, 1.5, 10.48], [1.4, 1.3, .12], [0, 0, 0], '#e8b44f');
    cabinBatch.add('box', [x, 1.5, 10.56], [1.12, 1.04, .08], [0, 0, 0], '#a6e7d2');
    cabinBatch.add('box', [x, 1.5, 10.62], [.09, 1.1, .08], [0, 0, 0], '#896441');
  }
  b.add('box', [0, -.9, 12.2], [.45, 4.8, 1.7], [.15, 0, 0], '#915d3c');
  b.line([0, .15, -12], [0, 2.2, -19], .21, '#886043');
  b.add('pebble', [0, .85, -15], [.70, .85, 1.25], [.35, 0, 0], '#f4c261');
  for (const [z, h, width] of [[-4.8, 18.8, 12], [4.4, 15.4, 10.2]]) {
    b.add('cylinder', [0, h / 2, z], [.20, h, .20], [0, 0, 0], '#755337');
    b.line([-width / 2, h - 2.0, z], [width / 2, h - 2.0, z], .13, '#926441');
    const vertices = [], indices = [], colors = [];
    for (let yy = 0; yy <= 8; yy++) for (let xx = 0; xx <= 10; xx++) {
      const u = xx / 10, v = yy / 8;
      const x = (u - .5) * width * (.8 + .2 * v);
      const y = h - 9.6 + v * 7.5 + .40 * Math.sin(u * Math.PI);
      const zz = z - .1 - 1.65 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      vertices.push(x, y, zz);
      const tint = new THREE.Color(xx >= 4 && xx <= 6 && yy > 1 && yy < 7 ? '#f5d18a' : '#fff0cb');
      colors.push(tint.r, tint.g, tint.b);
      if (yy < 8 && xx < 10) { const n = yy * 11 + xx; indices.push(n, n + 1, n + 11, n + 1, n + 12, n + 11); }
    }
    const sail = surface(vertices, indices);
    sail.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    sailBatch.add(sail); sail.dispose();
    b.line([-width / 2, h - 2, z], [-3.9, .2, z + 2], .032, '#9d865d');
    b.line([width / 2, h - 2, z], [3.9, .2, z + 2], .032, '#9d865d');
    b.line([0, h - .2, z], [0, .5, -14.2], .037, '#917a51');
    b.add('sphere', [0, h + .05, z], [.26, .26, .26], [0, 0, 0], '#efbf5c');
  }
  // A little gold compass crest in front of the main billowing sail.
  b.add('pebble', [0, 12.3, -6.65], [.85, 1.23, .13], [0, 0, 0], '#1c647a');
  b.add('pebble', [0, 12.3, -6.83], [.34, .68, .08], [0, 0, 0], '#ffc85a');
  for (const side of [-1, 1]) for (const z of [-7, 3, 9]) {
    b.line([side * 4.2, .9, z], [side * 5.0, 1.6, z], .065, '#cfac61');
    b.add('cylinder', [side * 5, 1.1, z], [.22, .7, .22], [0, 0, 0], '#b47d38');
    b.add('sphere', [side * 5, 1.1, z], [.18, .27, .18], [0, 0, 0], '#ffe9a2');
  }
  for (const [x, z] of [[-3, 4], [3, 5], [-3, -8]]) {
    b.add('cylinder', [x, .6, z], [.55, 1.2, .55], [0, 0, 0], '#956136');
    for (const y of [.22, .95]) b.add('cylinder', [x, y, z], [.57, .10, .57], [0, 0, 0], '#384a56');
  }
  b.add('box', [0, 2.85, 7], [.22, 1.0, .22], [0, 0, 0], '#6f4d35');
  b.add('ring', [0, 3.35, 7], [.70, .70, .7], [.15, 0, 0], '#efbd5a');
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3;
    b.line([0, 3.35, 7], [Math.sin(a) * .83, 3.35 + Math.cos(a) * .83, 7], .06, '#c48b46');
  }
  const sails = sailBatch.mesh();
  const cabin = cabinBatch.mesh();
  group.add(b.mesh(), sails, cabin);
  const pennantBatch = new GeoBatch(palette);
  const flag = surface([0, 0, 0, 3.2, -.2, 0, 2.4, -.95, 0, 0, -1.3, 0], [0, 1, 2, 0, 2, 3]);
  pennantBatch.add(flag, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#ed8366'); flag.dispose();
  const pennant = pennantBatch.mesh(); pennant.position.set(0, 18.4, -4.8); group.add(pennant);
  return { group, sails, cabin, animate(time) { pennant.rotation.y = -.3 + Math.sin(time * 2) * .18; } };
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

export function buildWeapon(palette, kind = 'flintlock') {
  const b = new GeoBatch(palette), scatter = kind === 'scatter';
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
    b.add('box', [0, .08, .32], [.23, .25, .32], [.08, 0, 0], wood);
    b.add('box', [0, .08, .50], [.26, .31, .075], [.08, 0, 0], brass);
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
    b.add('box', [0, .065, .40], [.23, .23, .51], [.09, 0, 0], wood);
    b.add('box', [0, .065, .68], [.255, .29, .065], [.09, 0, 0], brass);
    b.add('box', [0, .10, -.13], [.24, .25, .52], [0, 0, 0], steel);
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
      b.line([.15, .19, .02], [.23, .28, .02], .035, brass);
      b.add('characterSphere', [.23, .28, .02], [.055, .055, .055], [0, 0, 0], steel);
    } else {
      // Box magazine on the compact repeater, narrow curved feed on the carbine.
      b.add('box', [0, -.28, -.17], [repeater ? .15 : .11, repeater ? .29 : .36, .16], [repeater ? -.10 : -.25, 0, 0], repeater ? '#277f80' : steel);
      b.add('box', [0, -.43, -.13], [.17, .045, .19], [-.10, 0, 0], brass);
      b.add('box', [0, .32, -.15], [.06, .06, .13], [0, 0, 0], brass);
      b.add('box', [0, .25, barrelEnd + .17], [.035, .085, .07], [0, 0, 0], brass);
    }
    muzzle = new THREE.Vector3(0, .17, barrelEnd - .07);
  }
  const group = new THREE.Group(); group.name = 'held-' + kind;
  const mesh = b.mesh(); mesh.name = kind + '-wood-brass-steel'; group.add(mesh);
  const socket = new THREE.Object3D(); socket.name = 'muzzle-' + kind; socket.position.copy(muzzle); group.add(socket);
  const stowed = new THREE.Group(); stowed.name = 'stowed-' + kind;
  const stowedMesh = new THREE.Mesh(mesh.geometry, mesh.material);
  stowedMesh.castShadow = stowedMesh.receiveShadow = true; stowed.add(stowedMesh);
  const stowedSocket = new THREE.Object3D(); stowedSocket.name = 'stowed-muzzle-' + kind;
  stowedSocket.position.copy(muzzle); stowed.add(stowedSocket);
  return { group, stowed, socket, stowedSocket };
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
  stowRig.position.set(.22, .73, .405); stowRig.rotation.set(-Math.PI / 2, 0, -.63); torso.add(stowRig);
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
    anchor.position.set(side < 0 ? -.12 : .055, side < 0 ? -.12 : -.145, side < 0 ? -.44 : .21);
    weaponRig.add(anchor);
    const hand = new THREE.Group(); hand.name = label + '-hand';
    if (side < 0) {
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
    hand.add(handBatch.mesh()); upper.add(ub.mesh()); forearm.add(fb.mesh()); torso.add(upper, forearm, hand);
    arms.push({ side, shoulder, upper, forearm, hand, anchor, upperLength, lowerLength,
      wrist: new THREE.Vector3(), direction: new THREE.Vector3(), bend: new THREE.Vector3(), elbow: new THREE.Vector3(),
      segment: new THREE.Vector3(), glideTarget: new THREE.Vector3(side * .70, 2.29, -.17) });
  }

  const glider = new THREE.Group(); glider.name = 'pirate-glider';
  const gb = new GeoBatch(palette), sailVertices = [], sailIndices = [], sailColors = [];
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
  for (const side of [-1, 1]) {
    gb.line([0, 4.30, -.68], [side * 3.2, 3.85, -.68], .065, '#644d3d');
    gb.line([side * .70, 2.29, -.17], [side * 2.7, 3.90, -.60], .022, '#f7e6b9');
    gb.line([side * .70, 2.29, -.17], [side * 2.7, 3.56, 1.0], .022, '#f7e6b9');
    gb.add('characterCylinder', [side * .70, 2.31, -.17], [.044, .19, .044], [0, 0, side * -.35], leather);
    const grip = new THREE.Object3D(); grip.name = (side < 0 ? 'left' : 'right') + '-glider-grip';
    grip.position.set(side * .70, 2.29, -.17); glider.add(grip);
  }
  gb.line([0, 4.30, -.68], [0, 3.8, 1.2], .055, '#644d3d');
  glider.add(gb.mesh()); glider.visible = false; group.add(glider);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.70, 20), new THREE.MeshBasicMaterial({
    color: '#183c46', transparent: true, opacity: .20, depthWrite: false }));
  shadow.name = 'pirate-contact-shadow'; shadow.rotation.x = -Math.PI / 2; shadow.position.y = .025; group.add(shadow);

  let phase = 0, locomotion = 0, aiming = 0, glideBlend = 0, knockBlend = 0, reloadBlend = 0, recoil = 0;
  let equipped = 'flintlock', stowed = false;
  const gliderToTorso = new THREE.Matrix4();
  const ease = (a, target, rate, dt) => THREE.MathUtils.lerp(a, target, 1 - Math.exp(-rate * dt));
  function animate(time = 0, speed = 0, player = {}, pose = {}) {
    const dt = THREE.MathUtils.clamp(Number.isFinite(pose.dt) ? pose.dt : 1 / 60, 0, .1);
    const elapsed = Number.isFinite(pose.elapsed) ? pose.elapsed : 0;
    const falling = player.mode === 'gliding', knocked = !!player.knockedUntil;
    const motion = falling || knocked ? 0 : THREE.MathUtils.clamp(Number.isFinite(speed) ? speed : 0, 0, 18);
    equipped = WEAPONS[player.weapon] ? player.weapon : 'flintlock'; stowed = falling;
    // Distance-driven phase never changes frequency discontinuously at sprint.
    phase = (phase + motion * dt * 1.22) % (Math.PI * 2);
    locomotion = ease(locomotion, Math.min(1, motion / 4.5), 13, dt);
    if (motion === 0 && locomotion < .001) locomotion = 0;
    aiming = ease(aiming, pose.aiming ? 1 : 0, 16, dt);
    glideBlend = ease(glideBlend, falling ? 1 : 0, 10, dt);
    knockBlend = ease(knockBlend, knocked ? 1 : 0, 10, dt);
    const reloadDuration = WEAPONS[equipped].reload;
    const reloadProgress = THREE.MathUtils.clamp(1 - ((player.reloadUntil || 0) - elapsed) / reloadDuration, 0, 1);
    const reloadTarget = player.reloadUntil > elapsed ? Math.sin(reloadProgress * Math.PI) : 0;
    reloadBlend = ease(reloadBlend, reloadTarget, 18, dt);
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
    const pitch = THREE.MathUtils.clamp(Number.isFinite(player.pitch) ? player.pitch : 0, -1.2, 1.2);
    weaponRig.position.set(.40 - aiming * .035, .59 + aiming * .07 - reloadBlend * .16 - knockBlend * .13,
      -.34 - aiming * .065 + recoil * .10 + reloadBlend * .10);
    weaponRig.rotation.set(pitch + recoil * .13 + reloadBlend * .54 - knockBlend * .3,
      -.18 * reloadBlend, -.47 * reloadBlend);
    weaponRig.updateMatrix();
    glider.visible = falling; glider.rotation.z = Math.sin(time * 1.8) * .018;
    if (falling) {
      figure.updateMatrix(); torso.updateMatrix(); glider.updateMatrix();
      gliderToTorso.multiplyMatrices(figure.matrix, torso.matrix).invert().multiply(glider.matrix);
    }
    for (const [kind, weapon] of weaponEntries) {
      weapon.group.visible = !stowed && equipped === kind;
      weapon.stowed.visible = stowed && equipped === kind;
    }
    // Each wrist follows its gun socket exactly. Elbows solve the braced pose;
    // gait, aim, swap, recoil and reload cannot swing a hand away from the gun.
    for (const arm of arms) {
      arm.wrist.copy(falling ? arm.glideTarget : arm.anchor.position);
      arm.wrist.applyMatrix4(falling ? gliderToTorso : weaponRig.matrix);
      arm.hand.position.copy(arm.wrist);
      if (falling) arm.hand.rotation.set(0, arm.side * .2, arm.side * -.45);
      else arm.hand.quaternion.copy(weaponRig.quaternion);
      arm.direction.copy(arm.wrist).sub(arm.shoulder);
      const distance = Math.max(.001, arm.direction.length());
      arm.direction.multiplyScalar(1 / distance);
      const reachScale = Math.max(1, distance / (arm.upperLength + arm.lowerLength - .015));
      const upperLength = arm.upperLength * reachScale, lowerLength = arm.lowerLength * reachScale;
      const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
      const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
      arm.bend.set(arm.side * .42, -1, .35);
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
  const boss = type === 'tempest', spitter = type === 'spitter';
  const group = new THREE.Group(); group.name = type + '-crab'; group.userData.kind = type;
  const body = new THREE.Group(), b = new GeoBatch(palette);
  const shell = boss ? '#685fae' : spitter ? '#419f9f' : '#e88358';
  const light = boss ? '#9e92d7' : spitter ? '#72ccbb' : '#f3ad70';
  const dark = boss ? '#534b88' : spitter ? '#2d777f' : '#b96043';
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

export function buildChest(palette) {
  const group = new THREE.Group(), base = new GeoBatch(palette), lb = new GeoBatch(palette);
  base.add('box', [0, .39, 0], [1.42, .78, .98], [0, 0, 0], '#96603b');
  base.add('box', [0, .77, 0], [1.46, .10, 1.01], [0, 0, 0], '#e9b84f');
  for (const x of [-.48, .48]) {
    base.add('box', [x, .40, -.50], [.10, .8, .06], [0, 0, 0], '#ffd270');
    base.add('box', [x, .40, .50], [.10, .8, .06], [0, 0, 0], '#e4b653');
  }
  base.add('box', [0, .51, -.54], [.25, .29, .09], [0, 0, 0], '#fadd77');
  base.add('box', [0, .50, -.59], [.055, .105, .03], [0, 0, 0], '#785834');
  base.add('sphere', [0, .75, 0], [.55, .13, .36], [0, 0, 0], '#ffd16c');
  const lid = new THREE.Group(); lid.position.set(0, .77, .49);
  lb.add('sphere', [0, 0, -.49], [.75, .34, .51], [0, 0, 0], '#bb8346');
  for (const x of [-.48, .48]) lb.add('sphere', [x, .01, -.49], [.07, .355, .525], [0, 0, 0], '#f4c35d');
  lid.add(lb.mesh()); group.add(base.mesh(), lid);
  return { group, animate(time, opened) { lid.rotation.x = THREE.MathUtils.lerp(lid.rotation.x, opened ? 1.65 : 0, .14); } };
}

export function buildShrine(palette, color) {
  const group = new THREE.Group(), b = new GeoBatch(palette);
  b.add('cylinder', [0, .14, 0], [2.3, .28, 2.3], [0, 0, 0], '#abbda3');
  b.add('cylinder', [0, .37, 0], [1.8, .22, 1.8], [0, 0, 0], '#d4d2af');
  for (const side of [-1, 1]) {
    b.add('cylinder', [side * 1.32, 1.25, 0], [.30, 1.7, .30], [0, 0, 0], '#849d97');
    b.add('cone', [side * 1.32, 2.3, 0], [.48, .54, .48], [0, 0, 0], '#e6c57d');
  }
  b.add('cylinder', [0, .80, 0], [.62, .9, .62], [0, 0, 0], '#688f94');
  b.add('cylinder', [0, 1.3, 0], [.88, .14, .88], [0, 0, 0], '#e6c06b');
  group.add(b.mesh());
  const gemBatch = new GeoBatch(palette, palette.glow);
  gemBatch.add('pebble', [0, 0, 0], [.42, .72, .30], [0, 0, 0], color);
  gemBatch.add('ring', [0, 0, 0], [.85, .85, .85], [.2, 0, 0], '#ffe298');
  const gem = gemBatch.mesh({ shadow: false }); gem.position.y = 2.65; group.add(gem);
  return { group, gem, animate(time, state) {
    gem.position.y = 2.65 + Math.sin(time * 1.7) * .18; gem.rotation.y = time * .42;
    gem.scale.setScalar(state?.status === 'cleared' ? .65 : 1);
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
