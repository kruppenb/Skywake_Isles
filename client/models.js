import * as THREE from 'three';

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

export function buildPirate(palette, color = '#eb785d') {
  const group = new THREE.Group(), torso = new THREE.Group(), b = new GeoBatch(palette);
  b.add('sphere', [0, 1.28, 0], [.42, .48, .29], [0, 0, 0], '#fff0d0');
  for (const y of [1.06, 1.22, 1.38]) b.add('cylinder', [0, y, 0], [.404, .065, .276], [0, 0, 0], '#426b83');
  for (const side of [-1, 1]) b.add('sphere', [side * .30, 1.31, .04], [.16, .47, .30], [0, 0, side * -.12], color);
  b.add('cylinder', [0, .91, 0], [.38, .13, .26], [0, 0, 0], '#534537');
  b.add('box', [0, .92, -.28], [.18, .16, .07], [0, 0, 0], '#ffd375');
  b.add('sphere', [0, 1.78, 0], [.32, .38, .29], [0, 0, 0], '#e9b58a');
  b.add('sphere', [0, 1.75, -.30], [.085, .085, .10], [0, 0, 0], '#d99c72');
  for (const side of [-1, 1]) {
    b.add('sphere', [side * .12, 1.86, -.263], [.075, .085, .035], [0, 0, 0], '#fff7e9');
    b.add('sphere', [side * .12, 1.85, -.295], [.032, .047, .023], [0, 0, 0], '#213d50');
    b.add('sphere', [side * .31, 1.77, 0], [.09, .115, .08], [0, 0, 0], '#e9b58a');
  }
  b.add('box', [0, 1.65, -.276], [.13, .035, .04], [0, 0, 0], '#8e514a');
  b.add('cylinder', [0, 2.00, 0], [.32, .13, .29], [0, 0, 0], color);
  b.add('sphere', [0, 2.16, .015], [.39, .23, .32], [0, 0, 0], '#233c52');
  const hatShape = new THREE.Shape();
  hatShape.moveTo(0, .5); hatShape.quadraticCurveTo(.11, .43, .18, .23);
  hatShape.quadraticCurveTo(.35, .11, .57, -.22); hatShape.quadraticCurveTo(.25, -.44, 0, -.25);
  hatShape.quadraticCurveTo(-.25, -.44, -.57, -.22); hatShape.quadraticCurveTo(-.35, .11, -.18, .23); hatShape.quadraticCurveTo(-.11, .43, 0, .5);
  const hat = new THREE.ExtrudeGeometry(hatShape, { depth: .10, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .025, bevelThickness: .025, curveSegments: 4 });
  hat.rotateX(-Math.PI / 2);
  b.add(hat, [0, 2.05, 0], [1.06, 1, 1.06], [0, 0, 0], '#e9b855');
  b.add(hat, [0, 2.085, 0], [1, 1, 1], [0, 0, 0], '#243e51'); hat.dispose();
  b.add('pebble', [0, 2.20, -.27], [.12, .13, .045], [0, 0, 0], '#ffdc7d');
  b.add('sphere', [.35, 2.40, .02], [.08, .35, .045], [0, 0, -.4], '#fff1ce');
  b.add('sphere', [.45, 2.48, .02], [.065, .24, .045], [0, 0, -.65], color);
  torso.add(b.mesh()); group.add(torso);
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(), a = new GeoBatch(palette);
    arm.position.set(side * .42, 1.5, 0);
    a.add('sphere', [side * .03, -.15, 0], [.17, .28, .17], [0, 0, side * .12], '#fff0d0');
    a.add('sphere', [side * .045, -.40, -.025], [.125, .21, .125], [.15, 0, 0], '#e9b58a');
    a.add('sphere', [side * .05, -.55, -.065], [.15, .14, .15], [0, 0, 0], '#e9b58a');
    if (side === 1) {
      a.add('box', [.05, -.54, -.20], [.13, .18, .28], [-.2, 0, 0], '#a36d44');
      a.add('cylinder', [.05, -.48, -.41], [.068, .42, .068], [Math.PI / 2, 0, 0], '#5b7783');
      a.add('cylinder', [.05, -.48, -.62], [.085, .07, .085], [Math.PI / 2, 0, 0], '#e0b65e');
    }
    arm.add(a.mesh()); group.add(arm); arms.push(arm);
    const leg = new THREE.Group(), l = new GeoBatch(palette);
    leg.position.set(side * .19, .88, 0);
    l.add('sphere', [0, -.28, 0], [.17, .35, .19], [0, 0, 0], '#24455d');
    l.add('cylinder', [0, -.62, .015], [.17, .33, .17], [0, 0, 0], '#674938');
    l.add('sphere', [0, -.77, -.095], [.19, .13, .30], [0, 0, 0], '#4b3d36');
    l.add('cylinder', [0, -.49, .015], [.195, .11, .195], [0, 0, 0], '#956749');
    leg.add(l.mesh()); group.add(leg); legs.push(leg);
  }
  const glider = new THREE.Group(), gb = new GeoBatch(palette);
  const sailVertices = [], sailIndices = [], sailColors = [];
  for (let row = 0; row <= 3; row++) for (let col = 0; col <= 12; col++) {
    const x = (col / 12 - .5) * 6.4, t = row / 3;
    const y = 3.65 + .48 * Math.cos(x / 3.2 * Math.PI / 2) - t * .34;
    const z = -.65 + t * (1.6 + .23 * Math.cos(col / 12 * Math.PI * 6));
    sailVertices.push(x, y, z);
    const c = new THREE.Color(col % 4 < 2 ? color : '#ffdfa0'); sailColors.push(c.r, c.g, c.b);
    if (row < 3 && col < 12) { const n = row * 13 + col; sailIndices.push(n, n + 13, n + 1, n + 1, n + 13, n + 14); }
  }
  const cloth = surface(sailVertices, sailIndices);
  cloth.setAttribute('color', new THREE.Float32BufferAttribute(sailColors, 3)); gb.add(cloth); cloth.dispose();
  for (const side of [-1, 1]) {
    gb.line([0, 4.1, -.68], [side * 3.2, 3.65, -.68], .065, '#644d3d');
    gb.line([side * .67, 1.85, -.15], [side * 2.7, 3.70, -.60], .022, '#f7e6b9');
    gb.line([side * .67, 1.85, -.15], [side * 2.7, 3.36, 1.0], .022, '#f7e6b9');
  }
  gb.line([0, 4.1, -.68], [0, 3.6, 1.2], .055, '#644d3d');
  glider.add(gb.mesh()); glider.visible = false; group.add(glider);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.68, 16), new THREE.MeshBasicMaterial({ color: '#183c46', transparent: true, opacity: .20, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .025; group.add(shadow);
  return { group, animate(time, speed, player) {
    const falling = player.mode === 'gliding'; glider.visible = falling;
    const walk = Math.sin(time * (speed > 8.5 ? 12 : 9)) * Math.min(1, speed / 5);
    legs[0].rotation.x = falling ? -.24 : walk * .65;
    legs[1].rotation.x = falling ? .16 : -walk * .65;
    arms[0].rotation.x = falling ? Math.PI * .80 : -walk * .40;
    arms[1].rotation.x = falling ? Math.PI * .80 : -.30 + walk * .22;
    arms[0].rotation.z = falling ? -.42 : .08; arms[1].rotation.z = falling ? .42 : -.08;
    torso.position.y = falling ? 0 : Math.abs(walk) * .055;
    glider.rotation.z = Math.sin(time * 1.8) * .035;
    if (player.knockedUntil) { torso.rotation.z = .32; legs[0].rotation.x = -1; legs[1].rotation.x = -1; }
    else torso.rotation.z = 0;
    shadow.visible = player.mode === 'ground';
  } };
}

export function buildCrab(palette, type = 'crab', size = 1) {
  const boss = type === 'tempest', spitter = type === 'spitter';
  const group = new THREE.Group(), body = new THREE.Group(), b = new GeoBatch(palette);
  const shell = boss ? '#685fae' : spitter ? '#419f9f' : '#e88358';
  const light = boss ? '#9e92d7' : spitter ? '#72ccbb' : '#f3ad70';
  b.add('sphere', [0, .66, 0], [.80, .51, .62], [0, 0, 0], shell);
  b.add('sphere', [0, .47, -.13], [.71, .22, .52], [0, 0, 0], '#f9d7a0');
  b.add('pebble', [0, 1.05, .10], [.48, .22, .42], [0, .5, 0], light);
  for (const side of [-1, 1]) {
    b.line([side * .32, .82, -.38], [side * .37, 1.25, -.48], .08, shell);
    b.add('sphere', [side * .37, 1.27, -.48], [.16, .18, .16], [0, 0, 0], '#fff7d8');
    b.add('sphere', [side * .37, 1.28, -.626], [.07, .09, .03], [0, 0, 0], '#173f50');
  }
  b.add('box', [0, .49, -.66], [.18, .05, .035], [0, 0, 0], '#ad6952');
  if (boss) {
    b.add('cone', [0, 1.4, .10], [.70, .65, .60], [0, 0, 0], '#bda4d1');
    b.add('cylinder', [0, 1.36, .10], [.56, .20, .56], [0, 0, 0], '#f3c561');
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      b.add('cone', [Math.sin(a) * .52, 1.69, .1 + Math.cos(a) * .52], [.16, .72, .16], [Math.cos(a) * .18, 0, -Math.sin(a) * .18], '#ffe29b');
      b.add('sphere', [Math.sin(a) * .59, 2.04, .1 + Math.cos(a) * .59], [.10, .10, .10], [0, 0, 0], '#79e1df');
    }
    for (const side of [-1, 1]) {
      b.line([side * .60, .88, .26], [side * .87, 1.38, .37], .095, '#ed8ea2', .65);
      b.line([side * .79, 1.2, .34], [side * 1.0, 1.37, .20], .065, '#f7afa9', .50);
    }
  }
  body.add(b.mesh()); group.add(body);
  const legGroups = [], claws = [];
  for (const side of [-1, 1]) {
    const legGroup = new THREE.Group(), l = new GeoBatch(palette);
    for (let i = 0; i < 3; i++) {
      const z = -.32 + i * .34;
      l.line([side * .56, .58, z], [side * 1.03, .46, z + .14], .08, shell, .8);
      l.line([side * 1.03, .46, z + .14], [side * 1.24, .05, z + .21], .062, light, .3);
    }
    legGroup.add(l.mesh()); group.add(legGroup); legGroups.push(legGroup);
    const claw = new THREE.Group(), c = new GeoBatch(palette);
    claw.position.set(side * .67, .65, -.45);
    c.line([0, 0, 0], [side * .40, .04, -.24], .13, shell, .8);
    c.add('sphere', [side * .49, .11, -.39], [.29, .25, .36], [0, side * -.25, -.10], light);
    c.add('cone', [side * .40, .08, -.73], [.11, .37, .11], [-Math.PI / 2, 0, side * -.23], shell);
    c.add('cone', [side * .62, .13, -.70], [.105, .35, .105], [-Math.PI / 2, 0, side * .2], light);
    claw.add(c.mesh()); group.add(claw); claws.push(claw);
  }
  group.scale.setScalar(size);
  return { group, animate(time, enemy) {
    const windup = enemy.state === 'windup', moving = enemy.state === 'chase';
    body.position.y = Math.sin(time * 6) * (windup ? .09 : .025);
    body.scale.set(1 + (windup ? .06 : 0), 1 + (windup ? .09 : 0), 1);
    legGroups[0].rotation.z = Math.sin(time * (moving ? 13 : 4)) * (moving ? .12 : .035);
    legGroups[1].rotation.z = -legGroups[0].rotation.z;
    claws[0].rotation.x = windup ? .85 + Math.sin(time * 18) * .08 : Math.sin(time * 4) * .06;
    claws[1].rotation.x = windup ? .85 + Math.cos(time * 18) * .08 : -Math.sin(time * 4) * .06;
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
