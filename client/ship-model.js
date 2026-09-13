import * as THREE from 'three';
import {
  SHIP_SCALE, SHIP_GUNS, SHIP_JUMP_POINTS, SHIP_JUMP_APPROACHES,
  gunAim, GUN_PIVOT_HEIGHT, GUN_MUZZLE_LENGTH,
} from '../shared/airship.js';

// The ship has its own restrained material treatment.  Small procedural maps
// keep broad surfaces alive at gameplay distance without relying on canvas,
// image downloads, or global palette changes.
const INK = {
  navy: '#153e52', blue: '#1d5366', teal: '#277080', deep: '#102f40',
  walnut: '#74462f', wood: '#8c5839', honey: '#b97c48', deck: '#c99b63',
  deckLight: '#d5ae73', brass: '#c29548', brassLight: '#d7ad59',
  iron: '#304b5b', ironDark: '#172f3e', linen: '#eee1bd', linenShade: '#d8c79d',
  coral: '#db6f58', glass: '#80ced0', rope: '#9b8052', seam: '#69503b',
};

function patternTexture(kind) {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    let value = 235;
    if (kind === 'sail') {
      const thread = x % 8 === 0 || y % 8 === 0 ? -2 : 1;
      value = 241 + thread + ((x * 5 + y * 3) % 5 - 2);
    } else if (kind === 'metal') {
      // Broad oxidation with small hammer marks; deliberately no high-contrast
      // pixel noise so the finish remains readable on a moving deck.
      value = 225 + Math.sin(x * .55 + Math.sin(y * .4)) * 9
        + Math.cos(y * .71 - x * .21) * 6 + ((x * 13 + y * 7) % 7 - 3);
    } else {
      // Neutral hand-painted tooth works on paint, wood and metal. Directional
      // wood marks are authored only on selected boards below.
      const brush = (y % 17 === 0 ? -1 : 0) + ((x * 13 + y * 7) % 5 - 2);
      value = 237 + brush;
    }
    value = Math.max(0, Math.min(255, Math.round(value)));
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'sail' ? 1.25 : 3, kind === 'sail' ? 1.25 : 6);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function shipMaterial(kind = 'paint', { transparent = false, side = THREE.FrontSide } = {}) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: patternTexture(kind),
    roughness: kind === 'sail' ? .9 : kind === 'metal' ? .62 : .78,
    metalness: kind === 'metal' ? .42 : 0,
    side,
    transparent,
  });
}

// GeoBatch deliberately drops UVs for the original procedural scenery.
// This local batch keeps them and provides stable planar UVs for custom
// geometry, while retaining the same single-draw batching strategy.
class ShipBatch {
  constructor(palette, material) {
    this.palette = palette; this.material = material;
    this.positions = []; this.normals = []; this.colors = []; this.uvs = [];
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3();
  }
  add(geometry, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], color = '#ffffff') {
    const g = typeof geometry === 'string' ? this.palette.geometry[geometry] : geometry;
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    return this.addMatrix(g, matrix, color);
  }
  addMatrix(g, matrix, color = '#ffffff') {
    const pos = g.attributes.position, normal = g.attributes.normal, sourceColor = g.attributes.color;
    const uv = g.attributes.uv, index = g.index, count = index ? index.count : pos.count;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix), tint = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const j = index ? index.getX(i) : i;
      this._v.fromBufferAttribute(pos, j).applyMatrix4(matrix);
      this.positions.push(this._v.x, this._v.y, this._v.z);
      if (normal) this._n.fromBufferAttribute(normal, j).applyMatrix3(normalMatrix).normalize();
      else this._n.set(0, 1, 0);
      this.normals.push(this._n.x, this._n.y, this._n.z);
      this.colors.push(tint.r * (sourceColor ? sourceColor.getX(j) : 1),
        tint.g * (sourceColor ? sourceColor.getY(j) : 1), tint.b * (sourceColor ? sourceColor.getZ(j) : 1));
      if (uv) this.uvs.push(uv.getX(j), uv.getY(j));
      else this.uvs.push(this._v.x * .16, this._v.z * .16 + this._v.y * .08);
    }
    return this;
  }
  line(a, b, radius, color, taper = 1, segments = 9, openEnded = false) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start), length = direction.length();
    const geometry = taper === 1 ? new THREE.CylinderGeometry(1, 1, 1, segments, 1, openEnded)
      : new THREE.CylinderGeometry(taper, 1, 1, segments, 1, openEnded);
    this.addMatrix(geometry, new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
      new THREE.Vector3(radius, length, radius)), color);
    geometry.dispose(); return this;
  }
  mesh({ shadow = true } = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    return mesh;
  }
}

function surface(vertices, indices, uvs = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function flatShape(points, thickness = .1) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 5 });
  geometry.rotateX(-Math.PI / 2); return geometry;
}

function beveledBox(width, height, depth, bevel = .035) {
  const b = Math.min(bevel, width * .2, height * .2);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2 + b, -height / 2);
  shape.lineTo(width / 2 - b, -height / 2); shape.lineTo(width / 2, -height / 2 + b);
  shape.lineTo(width / 2, height / 2 - b); shape.lineTo(width / 2 - b, height / 2);
  shape.lineTo(-width / 2 + b, height / 2); shape.lineTo(-width / 2, height / 2 - b);
  shape.lineTo(-width / 2, -height / 2 + b); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(.001, depth - b * 2), bevelEnabled: true, bevelThickness: b,
    bevelSize: b, bevelSegments: 1, curveSegments: 1, steps: 1,
  });
  geometry.translate(0, 0, -depth / 2 + b); return geometry;
}

function addBeveledBox(batch, position, dimensions, color, bevel = .035, rotation = [0, 0, 0]) {
  const geometry = beveledBox(dimensions[0], dimensions[1], dimensions[2], bevel);
  batch.add(geometry, position, [1, 1, 1], rotation, color); geometry.dispose();
}

function fittingBox(batch, position, dimensions, color, bevel = .025, rotation = [0, 0, 0]) {
  const geometry = beveledBox(...dimensions, bevel);
  const p = geometry.attributes.position, n = geometry.attributes.normal, colors = [];
  for (let i = 0; i < p.count; i++) {
    // Exposed chamfers polish lighter, with broad uneven grain on the faces.
    // Position-based variation gives duplicated face vertices matching wear.
    const edge = 1 - Math.max(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i)));
    const grain = Math.sin(p.getX(i) * 49 + p.getZ(i) * 5 + position[2] * 3) * .045;
    const shade = .87 + edge * .8 + grain + Math.min(.07, Math.max(-.06, p.getY(i) * .09));
    colors.push(shade, shade * .99, shade * .97);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  batch.add(geometry, position, [1, 1, 1], rotation, color); geometry.dispose();
}

function fittingBeam(batch, a, b, width, height, color, bevel = .025) {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  fittingBox(batch, [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2],
    [width, height, Math.hypot(dx, dz) + .025], color, bevel, [0, Math.atan2(dx, dz), 0]);
}

function cannonTubeGeometry(brass) {
  const muzzle = -GUN_MUZZLE_LENGTH;
  // One continuous turned profile, including reinforcing rings, rolled lip,
  // inner bore and recessed backing. No overlapping capped cylinders in the bore.
  const steel = '#3b505c', edge = '#637580', soot = '#1c2a31';
  const profile = [
    [0, .52, steel], [.24, .52, steel], [.36, .40, edge], [.39, .29, steel],
    [.39, -.25, steel], [.405, -.29, brass], [.405, -.39, brass], [.35, -.44, steel],
    [.31, -.86, steel], [.35, -.90, edge], [.35, -1.04, steel], [.30, -1.08, steel],
    [.27, -1.77, steel], [.30, -1.81, brass], [.30, -1.91, brass], [.265, -1.95, steel],
    [.26, muzzle + .30, soot], [.31, muzzle + .20, steel], [.345, muzzle + .13, edge],
    [.345, muzzle + .045, brass], [.32, muzzle, brass], [.215, muzzle, edge],
    [.20, muzzle + .08, '#111d24'], [.20, muzzle + .46, '#080f14'], [0, muzzle + .46, '#080f14'],
  ].reverse(); // Lathe exterior winding runs from muzzle towards breech (+Z).
  const geometry = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), 20);
  const p = geometry.attributes.position, colors = [], tint = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const row = profile[i % profile.length];
    const shade = .94 + .07 * Math.sin(Math.atan2(p.getX(i), p.getZ(i)) * 3 + row[1] * 2.1);
    tint.set(row[2]).multiplyScalar(shade); colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function widthAt(rows, z) {
  if (z <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) if (z <= rows[i][0]) {
    const a = rows[i - 1], b = rows[i], t = (z - a[0]) / (b[0] - a[0]);
    return THREE.MathUtils.lerp(a[1], b[1], t);
  }
  return rows.at(-1)[1];
}

function addHullStrakes(batch, rows) {
  const profiles = [[1, .18], [.985, -.72], [.92, -1.58], [.76, -2.55], [.48, -3.5], [0, -4.18]];
  const colors = [INK.blue, INK.navy, '#1c4a5f', INK.teal, '#1c5369'];
  for (const side of [-1, 1]) for (let band = 0; band < profiles.length - 1; band++) {
    for (let j = 0; j < rows.length - 1; j++) {
      const [az, aw] = rows[j], [bz, bw] = rows[j + 1];
      const a = profiles[band], d = profiles[band + 1];
      const verts = [side * aw * a[0], a[1] * Math.min(1, aw / 2), az,
        side * bw * a[0], a[1] * Math.min(1, bw / 2), bz,
        side * bw * d[0], d[1] * Math.min(1, bw / 2), bz,
        side * aw * d[0], d[1] * Math.min(1, aw / 2), az];
      const g = surface(verts, side < 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3], [0, 0, 1, 0, 1, 1, 0, 1]);
      const tint = (j + band) % 3 === 0 ? new THREE.Color(colors[band]).multiplyScalar(.92) : colors[band];
      batch.add(g, [0, 0, 0], [1, 1, 1], [0, 0, 0], tint); g.dispose();
    }
    // Raised lower edges give the clinker-built hull a readable construction.
    for (let j = 0; j < rows.length - 1; j++) {
      const [az, aw] = rows[j], [bz, bw] = rows[j + 1], d = profiles[band + 1];
      batch.line([side * aw * d[0], d[1] * Math.min(1, aw / 2), az],
        [side * bw * d[0], d[1] * Math.min(1, bw / 2), bz], .04, band === 3 ? '#2b6675' : '#173f54', 1, 7);
    }
  }
  // Rounded keel and stem pieces visually close the open bottom and sharpen the prow.
  batch.line([0, -4.15, -10], [0, -4.15, 10.8], .16, INK.deep, .82, 10);
  batch.line([0, -3.95, -10], [0, -.05, -15], .18, INK.deep, .72, 10);
  batch.line([0, -4.08, 10.6], [0, -.25, 12.1], .16, INK.walnut, .8, 10);
  // The stern is a real transom rather than the open end of the lofted sides.
  const w = rows.at(-1)[1], z = rows.at(-1)[0];
  const edge = profiles.slice(0, -1).map(([scale, y]) => [-w * scale, y, z]);
  edge.push([0, profiles.at(-1)[1], z]);
  edge.push(...profiles.slice(0, -1).reverse().map(([scale, y]) => [w * scale, y, z]));
  const center = edge.length, capVertices = edge.flat(); capVertices.push(0, -1.65, z);
  const capIndices = [];
  for (let i = 0; i < edge.length; i++) capIndices.push(center, i, (i + 1) % edge.length);
  const cap = surface(capVertices, capIndices);
  batch.add(cap, [0, 0, .015], [1, 1, 1], [0, 0, 0], INK.navy); cap.dispose();
}

function addDeckPlanking(batch, rows) {
  const plankWidth = .58, segmentLength = 3.35;
  for (let lane = -8; lane <= 8; lane++) {
    const x = lane * plankWidth, offset = (Math.abs(lane) % 2) * segmentLength * .5;
    const needed = Math.abs(x) + plankWidth * .52 + .06;
    const crossings = [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if ((a[1] - needed) * (b[1] - needed) <= 0 && a[1] !== b[1])
        crossings.push(a[0] + (needed - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    const valid = rows.filter(row => row[1] >= needed).map(row => row[0]);
    if (!valid.length) continue;
    const minZ = Math.min(...valid, ...crossings), maxZ = Math.max(...valid, ...crossings);
    const origin = -15 + offset;
    for (let k = Math.floor((minZ - origin) / segmentLength); origin + k * segmentLength < maxZ; k++) {
      const start = Math.max(minZ, origin + k * segmentLength + .025);
      const end = Math.min(maxZ, origin + (k + 1) * segmentLength - .025);
      if (end - start < .08) continue;
      const center = (start + end) / 2;
      const tone = (lane + k) % 3;
      addBeveledBox(batch, [x, .028, center], [plankWidth - .035, .046, end - start],
        tone === 0 ? INK.deckLight : tone === 1 ? INK.deck : '#c99458', .018);
      if ((lane + k) % 4 === 0 && end - start > .7)
        batch.line([x + .12, .057, start + .24], [x + .10, .057, end - .24], .008, '#967046', 1, 5);
      // Paired dark pegs make the staggered plank rhythm legible without noisy speckling.
      for (const zz of [start + .1, end - .1]) batch.add('cylinder', [x - .17, .055, zz], [.025, .018, .025], [0, 0, 0], INK.seam);
    }
  }
}

function addRailSections(batch, rows) {
  for (const side of [-1, 1]) {
    const rawPorts = SHIP_GUNS.filter(gun => Math.sign(gun.x) === side)
      // The wider aft deck needs more longitudinal room for the full oblique
      // cone to clear solid balusters; the narrowing bow clears sooner.
      .map(gun => {
        const clearance = gun.z < -4 ? 4.6 : 6.8;
        return [(gun.z - clearance) / SHIP_SCALE.z, (gun.z + clearance) / SHIP_SCALE.z];
      });
    const ports = [];
    for (const interval of rawPorts.sort((a, b) => a[0] - b[0])) {
      const previous = ports.at(-1);
      if (previous && interval[0] - previous[1] < .75) previous[1] = Math.max(previous[1], interval[1]);
      else ports.push([...interval]);
    }
    const insidePort = z => ports.some(([low, high]) => z >= low && z <= high);
    const posts = new Set();
    const post = (z, x, heading) => {
      const key = z.toFixed(4);
      if (posts.has(key)) return;
      posts.add(key);
      const turn = [0, heading, 0];
      fittingBox(batch, [x, .60, z], [.22, .85, .25], side < 0 ? INK.blue : INK.teal, .025, turn);
      fittingBox(batch, [x, .29, z], [.28, .25, .31], INK.ironDark, .02, turn);
      fittingBox(batch, [x, .87, z], [.26, .09, .29], INK.walnut, .018, turn);
      // Broad iron shoes and a paired pin on the inside face read from the deck.
      for (const y of [.30, .79]) batch.add('cylinder', [x - side * .145, y, z],
        [.035, .026, .035], [0, 0, Math.PI / 2], INK.brass);
    };
    for (let j = 0; j < rows.length - 1; j++) {
      const [az, aw] = rows[j], [bz, bw] = rows[j + 1];
      const cuts = [az, bz, ...ports.flat().filter(z => z > az && z < bz)].sort((a, b) => a - b);
      const railWidth = z => THREE.MathUtils.lerp(aw, bw, (z - az) / (bz - az));
      const heading = Math.atan2(side * (bw - aw), bz - az);
      fittingBeam(batch, [side * aw, .16, az], [side * bw, .16, bz], .34, .29, INK.walnut, .035);
      fittingBeam(batch, [side * aw, .31, az], [side * bw, .31, bz], .29, .045, INK.honey, .01);
      batch.line([side * aw * .99, -1.03, az], [side * bw * .99, -1.03, bz], .095, INK.brass, 1, 9);
      for (let k = 0; k < cuts.length - 1; k++) {
        const start = cuts[k], end = cuts[k + 1];
        if (!insidePort((start + end) / 2)) {
          fittingBeam(batch, [side * railWidth(start), 1.04, start], [side * railWidth(end), 1.04, end],
            .34, .17, INK.wood, .035);
          fittingBeam(batch, [side * railWidth(start), 1.127, start], [side * railWidth(end), 1.127, end],
            .26, .025, INK.honey, .008);
          fittingBeam(batch, [side * railWidth(start), .55, start], [side * railWidth(end), .55, end],
            .15, .13, INK.blue, .018);
          const count = Math.max(1, Math.ceil((end - start) / 1.65));
          for (let p = 0; p <= count; p++) {
            // Keep the shoes inside the port cut, including their full thickness.
            const z = THREE.MathUtils.lerp(start + .15, end - .15, p / count);
            if (end - start < .4) continue;
            post(z, side * railWidth(z), heading);
          }
          // Iron scarf plates join the timber caps, with a warm worn pin head.
          const z = (start + end) / 2, x = side * railWidth(z);
          fittingBox(batch, [x, 1.147, z], [.30, .025, .20], INK.iron, .008, [0, heading, 0]);
          batch.add('cylinder', [x, 1.168, z], [.035, .016, .035], [0, 0, 0], INK.brass);
        }
      }
    }
  }
}

function sailPoint(z, h, width, u, v, offset = 0) {
  return [(u - .5) * width * (.8 + .2 * v), h - 9.6 + v * 7.5 + .38 * Math.sin(u * Math.PI),
    z - .12 - 1.55 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) + offset];
}

function sailGeometry(z, h, width) {
  const columns = 12, rows = 10, vertices = [], indices = [], uvs = [], colors = [];
  for (let yy = 0; yy <= rows; yy++) for (let xx = 0; xx <= columns; xx++) {
    const u = xx / columns, v = yy / rows;
    vertices.push(...sailPoint(z, h, width, u, v)); uvs.push(u, v);
    const panel = Math.floor(Math.min(.999, u) * 5), shade = .965 + (panel % 2) * .035 + (v < .22 && panel === 1 ? -.035 : 0);
    colors.push(shade, shade * .995, shade * .96);
    if (yy < rows && xx < columns) {
      const n = yy * (columns + 1) + xx;
      indices.push(n, n + 1, n + columns + 1, n + 1, n + columns + 2, n + columns + 1);
    }
  }
  const geometry = surface(vertices, indices, uvs);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function addCompassEmblem(batch, z, h, width) {
  // A conforming flat inlay: every ring segment and star point samples the same
  // billow as the sail, then sits just proud of its forward face.
  const centerU = .5, centerV = .355, du = .078, dv = .115, ring = [];
  for (let k = 0; k < 24; k++) {
    const angle = k / 24 * Math.PI * 2;
    ring.push(sailPoint(z, h, width, centerU + Math.sin(angle) * du, centerV + Math.cos(angle) * dv, -.035));
  }
  for (let k = 0; k < ring.length; k++) batch.line(ring[k], ring[(k + 1) % ring.length], .035, INK.teal, 1, 6);
  for (let k = 0; k < 8; k++) {
    const angle = k * Math.PI / 4, long = k % 2 === 0;
    const tip = sailPoint(z, h, width, centerU + Math.sin(angle) * (long ? du * .88 : du * .6),
      centerV + Math.cos(angle) * (long ? dv * .88 : dv * .6), -.043);
    const left = sailPoint(z, h, width, centerU + Math.sin(angle - .55) * du * .2,
      centerV + Math.cos(angle - .55) * dv * .2, -.043);
    const right = sailPoint(z, h, width, centerU + Math.sin(angle + .55) * du * .2,
      centerV + Math.cos(angle + .55) * dv * .2, -.043);
    const g = surface([...left, ...tip, ...right], [0, 1, 2], [0, 0, .5, 1, 1, 0]);
    batch.add(g, [0, 0, 0], [1, 1, 1], [0, 0, 0], long ? INK.brassLight : INK.honey); g.dispose();
  }
  const center = sailPoint(z, h, width, centerU, centerV, -.05);
  batch.add('sphere', center, [.12, .12, .035], [0, 0, 0], INK.deep);
}

function addCabin(batch) {
  // The original gameplay collider is larger.  Everything drawn here stays in
  // the camera-fade envelope and reads as one compact sternhouse.
  addBeveledBox(batch, [0, 1.22, 8.45], [6.30, 2.24, 3.94], INK.navy, .07);
  addBeveledBox(batch, [0, 2.58, 8.42], [6.68, .24, 4.20], INK.walnut, .05);
  addBeveledBox(batch, [0, 2.75, 8.42], [6.52, .10, 4.08], INK.honey, .03);
  // Overlapping painted siding catches light as real boards instead of a flat decal.
  for (let y = .22; y <= 2.26; y += .34) {
    addBeveledBox(batch, [0, y, 6.455], [6.08, .31, .075], y % .68 < .1 ? INK.blue : INK.navy, .018);
    for (const side of [-1, 1]) addBeveledBox(batch, [side * 3.19, y, 8.45], [.075, .31, 3.72],
      y % .68 < .1 ? INK.blue : INK.navy, .018);
  }
  for (const side of [-1, 1]) for (const z of [6.55, 10.34])
    addBeveledBox(batch, [side * 3.22, 1.28, z], [.16, 2.42, .16], INK.honey, .035);
  // Stern window bays, with chunky frames and cyan glass in recessed openings.
  for (const x of [-2.1, 0, 2.1]) {
    addBeveledBox(batch, [x, 1.5, 10.48], [1.42, 1.35, .14], INK.brass, .055);
    batch.add('box', [x, 1.5, 10.57], [1.14, 1.07, .08], [0, 0, 0], INK.glass);
    batch.add('box', [x, 1.5, 10.63], [.08, 1.08, .06], [0, 0, 0], INK.walnut);
    batch.add('box', [x, 1.5, 10.64], [1.12, .075, .06], [0, 0, 0], INK.walnut);
  }
  // Bow-facing panelled door and side frames add scale where players pass it.
  addBeveledBox(batch, [0, 1.1, 6.43], [1.45, 2.05, .10], INK.walnut, .04);
  for (const y of [.55, 1.45]) addBeveledBox(batch, [0, y, 6.355], [1.08, .62, .045], '#8e5938', .018);
  for (const x of [-.73, .73]) addBeveledBox(batch, [x, 1.13, 6.36], [.13, 2.2, .08], INK.honey, .02);
  addBeveledBox(batch, [0, 2.22, 6.36], [1.58, .14, .08], INK.honey, .02);
  batch.add('sphere', [.48, 1.08, 6.35], [.08, .08, .045], [0, 0, 0], INK.brassLight);
  for (const side of [-1, 1]) {
    batch.add('box', [side * 3.24, 1.32, 8.45], [.11, 1.65, 3.25], [0, 0, 0], INK.honey);
    for (const z of [7.35, 9.15]) {
      batch.add('box', [side * 3.28, 1.55, z], [.08, .82, 1.04], [0, 0, 0], INK.brass);
      batch.add('box', [side * 3.34, 1.55, z], [.045, .62, .82], [0, 0, 0], INK.glass);
    }
  }
}

function addWheel(batch) {
  batch.add('box', [0, 2.78, 7.05], [.24, .92, .24], [0, 0, 0], INK.walnut);
  batch.add('ring', [0, 3.3, 7.04], [.74, .74, .62], [0, 0, 0], INK.brass);
  batch.add('ring', [0, 3.3, 7.02], [.22, .22, .7], [0, 0, 0], INK.walnut);
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    batch.line([Math.sin(a) * .16, 3.3 + Math.cos(a) * .16, 7.03],
      [Math.sin(a) * .87, 3.3 + Math.cos(a) * .87, 7.03], .055, INK.honey, .72, 7);
    batch.add('sphere', [Math.sin(a) * .92, 3.3 + Math.cos(a) * .92, 7.03], [.09, .09, .09], [0, 0, 0], INK.walnut);
  }
}

export function buildGalleon(palette, { buildJumpGate, addDeckChevron } = {}) {
  if (!buildJumpGate || !addDeckChevron) throw new Error('buildGalleon requires jump-gate helpers');
  const group = new THREE.Group(), base = new THREE.Group();
  group.name = 'airship'; base.name = 'airship-scaled-hull';
  base.scale.set(SHIP_SCALE.x, SHIP_SCALE.y, SHIP_SCALE.z); group.add(base);
  const hullMaterial = shipMaterial('paint'), sailMaterial = shipMaterial('sail', { transparent: true, side: THREE.DoubleSide });
  const cabinMaterial = shipMaterial('paint', { transparent: true });
  const hullBatch = new ShipBatch(palette, hullMaterial), sailBatch = new ShipBatch(palette, sailMaterial);
  const cabinBatch = new ShipBatch(palette, cabinMaterial);
  const rows = [[-15, .12], [-13, 2.0], [-10, 3.75], [-5, 4.55], [1, 4.75], [6, 4.5], [10, 3.8], [12, 2.0]];
  addHullStrakes(hullBatch, rows);
  const outline = rows.map(([z, w]) => [-w, z]).concat(rows.slice().reverse().map(([z, w]) => [w, z]));
  const deck = flatShape(outline, .11);
  hullBatch.add(deck, [0, -.11, 0], [1, 1, 1], [0, 0, 0], '#b9844d'); deck.dispose();
  addDeckPlanking(hullBatch, rows); addRailSections(hullBatch, rows);
  // Brass bolt lines and controlled paint wear repeat the long sweep of the hull.
  for (const side of [-1, 1]) for (const z of [-8, -3, 2, 7]) {
    const w = widthAt(rows, z);
    hullBatch.add('sphere', [side * (w + .035), -1.05, z], [.10, .20, .24], [0, 0, 0], INK.brass);
    hullBatch.add('sphere', [side * (w + .075), -1.05, z], [.065, .12, .15], [0, 0, 0], '#76bdc0');
  }
  addCabin(cabinBatch);
  // Rudder, bowsprit, mast construction and fittings.
  hullBatch.add('box', [0, -.9, 12.15], [.42, 4.65, 1.55], [.15, 0, 0], INK.walnut);
  hullBatch.line([0, .14, -12], [0, 2.15, -19], .22, INK.walnut, .72, 10);
  hullBatch.line([0, .14, -12], [0, 2.14, -19], .105, INK.honey, .72, 10);
  // A compact winged compass replaces the old featureless gold prow lump.
  hullBatch.add('ring', [0, .82, -15.35], [.31, .31, .7], [0, 0, 0], INK.brass);
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, length = k % 2 ? .16 : .25;
    hullBatch.line([0, .82, -15.39], [Math.sin(a) * length, .82 + Math.cos(a) * length, -15.39], .025,
      k % 2 ? INK.honey : INK.brassLight, .45, 6);
  }
  for (const side of [-1, 1]) {
    const wing = surface([side * .23, .82, -15.32, side * .68, 1.22, -15.28, side * .55, .79, -15.46,
      side * .70, .54, -15.28], side < 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    hullBatch.add(wing, [0, 0, 0], [1, 1, 1], [0, 0, 0], INK.brass); wing.dispose();
    hullBatch.line([side * .24, .82, -15.39], [side * .63, .9, -15.36], .035, INK.brassLight, .65, 6);
  }
  const mastSpecs = [[-4.8, 18.8, 12], [4.4, 15.4, 10.2]];
  for (const [z, h, width] of mastSpecs) {
    // Contract keeps the mast foot at radius .20; upper collars sit overhead.
    hullBatch.add('cylinder', [0, h / 2, z], [.195, h, .195], [0, 0, 0], INK.walnut);
    for (const y of [3.2, h - 3.7]) hullBatch.add('cylinder', [0, y, z], [.23, .12, .23], [0, 0, 0], INK.brass);
    hullBatch.line([-width / 2, h - 2, z], [width / 2, h - 2, z], .145, INK.wood, 1, 10);
    hullBatch.line([-width / 2, h - 2, z], [width / 2, h - 2, z], .045, INK.honey, 1, 8);
    const sail = sailGeometry(z, h, width); sailBatch.add(sail, [0, 0, 0], [1, 1, 1], [0, 0, 0], INK.linen); sail.dispose();
    // Vertical seams, lower hem, patches and reef ties share the sail material/fade.
    for (const u of [.2, .4, .6, .8]) for (let step = 0; step < 8; step++)
      sailBatch.line(sailPoint(z, h, width, u, step / 8, -.028),
        sailPoint(z, h, width, u, (step + 1) / 8, -.028), .018, INK.linenShade, 1, 6);
    for (let step = 0; step < 12; step++) sailBatch.line(sailPoint(z, h, width, step / 12, .025, -.028),
      sailPoint(z, h, width, (step + 1) / 12, .025, -.028), .027, '#bda97e', 1, 6);
    for (const side of [-1, 1]) for (const yy of [h - 7.2, h - 5.1]) {
      const x = side * width * .27;
      sailBatch.line([x - .13, yy, z - .28], [x + .13, yy - .22, z - .28], .022, INK.rope, 1, 6);
    }
    // Braces terminate high and inboard.  Deck-edge anchors would cross the
    // cannons' complete legal traverse cone even though they look plausible.
    hullBatch.line([-width / 2, h - 2, z], [0, h - 6.2, z], .034, INK.rope, 1, 7);
    hullBatch.line([width / 2, h - 2, z], [0, h - 6.2, z], .034, INK.rope, 1, 7);
    hullBatch.add('cylinder', [0, h - 6.2, z], [.195, .12, .195], [0, 0, 0], INK.brass);
    hullBatch.line([0, h - .2, z], [0, .5, -14.2], .039, INK.rope, 1, 7);
    hullBatch.add('sphere', [0, h + .05, z], [.27, .27, .27], [0, 0, 0], INK.brassLight);
    // Paired blocks at the yard ends make the rig feel tensioned and functional.
    for (const side of [-1, 1]) {
      hullBatch.add('cylinder', [side * width * .43, h - 2.2, z], [.11, .25, .11], [0, 0, side * .35], INK.walnut);
      hullBatch.add('ring', [side * width * .43, h - 2.2, z - .08], [.12, .12, .5], [Math.PI / 2, 0, 0], INK.brass);
    }
  }
  addCompassEmblem(sailBatch, -4.8, 18.8, 12);
  for (const [x, z] of [[-3, 4], [3, 5], [-3, -8]]) {
    hullBatch.add('cylinder', [x, .58, z], [.52, 1.16, .52], [0, 0, 0], INK.wood);
    for (const y of [.18, .94]) hullBatch.add('cylinder', [x, y, z], [.555, .11, .555], [0, 0, 0], INK.iron);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      hullBatch.add('sphere', [x + Math.sin(a) * .51, .94, z + Math.cos(a) * .51], [.04, .04, .04], [0, 0, 0], INK.brass);
    }
  }
  // Rail lanterns hang below the gunwale, beneath the complete depressed shot
  // cone as well as outside the walk lanes. Opaque glass stays in the hull draw.
  for (const side of [-1, 1]) for (const z of [-7, 3, 9]) {
    hullBatch.line([side * widthAt(rows, z), .18, z], [side * 5.0, .02, z], .06, INK.iron, 1, 7);
    hullBatch.add('cylinder', [side * 5, -.05, z], [.18, .12, .18], [0, 0, 0], INK.iron);
    hullBatch.add('cylinder', [side * 5, -.57, z], [.18, .12, .18], [0, 0, 0], INK.ironDark);
    hullBatch.add('sphere', [side * 5, -.31, z], [.15, .25, .15], [0, 0, 0], '#efce84');
    for (const dx of [-.16, .16]) hullBatch.line([side * 5 + dx, -.56, z], [side * 5 + dx, -.06, z], .025, INK.brass, 1, 6);
  }
  const hullMesh = hullBatch.mesh(); hullMesh.name = 'airship-hull-and-deck';
  const sails = sailBatch.mesh(); sails.name = 'airship-sails';
  const cabin = cabinBatch.mesh(); cabin.name = 'airship-cabin';
  const helmBatch = new ShipBatch(palette, cabinMaterial); addWheel(helmBatch);
  const helm = helmBatch.mesh(); helm.name = 'airship-cabin-helm'; cabin.add(helm);
  base.add(hullMesh, sails, cabin);
  const pennantBatch = new ShipBatch(palette, sailMaterial);
  const flag = surface([0, 0, 0, 3.2, -.2, 0, 2.4, -.95, 0, 0, -1.3, 0], [0, 1, 2, 0, 2, 3], [0, 0, 1, .1, .75, .8, 0, 1]);
  pennantBatch.add(flag, [0, 0, 0], [1, 1, 1], [0, 0, 0], INK.coral); flag.dispose();
  const pennant = pennantBatch.mesh(); pennant.position.set(0, 18.4, -4.8); sails.add(pennant);
  // Stations use shared, already enlarged deck coordinates, outside the scaled hull.
  const guns = new Map(SHIP_GUNS.map(gun => {
    const model = buildDeckCannon(palette, gun); group.add(model.group); return [gun.id, model];
  }));
  const gates = new Map(SHIP_JUMP_POINTS.map(point => {
    const model = buildJumpGate(palette, point); group.add(model.group); return [point.id, model];
  }));
  const laneBatch = new ShipBatch(palette, hullMaterial);
  for (const lanes of Object.values(SHIP_JUMP_APPROACHES)) for (const lane of lanes) for (let i = 0; i < lane.length - 1; i++) {
    const from = lane[i], to = lane[i + 1];
    const span = Math.hypot(to.x - from.x, to.z - from.z), heading = Math.atan2(to.x - from.x, to.z - from.z);
    const count = Math.max(1, Math.round(span / 1.15));
    for (let step = 0; step < count; step++) {
      const t = (step + .5) / count, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      addDeckChevron(laneBatch, x, z, heading, .45, .5, .1, .22, '#24404f');
      addDeckChevron(laneBatch, x, z, heading, .43, .47, .115, .12, '#f7c559');
    }
  }
  const lanes = laneBatch.mesh(); lanes.name = 'jump-gate-approach-lanes'; group.add(lanes);
  return { group, base, sails, cabin, guns, gates, animate(time, reducedMotion = false) {
    pennant.rotation.y = -.3 + (reducedMotion ? 0 : Math.sin(time * 2) * .18);
    for (const gate of gates.values()) gate.animate(time, reducedMotion);
  } };
}

export function buildDeckCannon(palette, gun) {
  const group = new THREE.Group(), swivel = new THREE.Group(), elevation = new THREE.Group(), barrel = new THREE.Group();
  group.name = gun.id; group.userData.gunId = gun.id; group.position.set(gun.x, 0, gun.z);
  swivel.name = 'cannon-swivel'; elevation.name = 'cannon-elevation'; barrel.name = 'cannon-recoil-barrel';
  const port = gun.x < 0, fore = gun.z < -4;
  const wood = port ? '#805238' : '#95603c', brass = fore ? '#b39563' : '#a78a59';
  const material = shipMaterial('metal'), timberMaterial = shipMaterial('paint');
  const base = new ShipBatch(palette, material);
  const timber = new ShipBatch(palette, timberMaterial);
  fittingBox(base, [0, .12, 0], [1.12, .17, 1.12], INK.ironDark, .065);
  fittingBox(timber, [0, .25, 0], [1.01, .16, 1.01], wood, .04);
  // Eight separate staves and bolted vertical straps give the post real joinery.
  const postHeight = GUN_PIVOT_HEIGHT - .72;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, sin = Math.sin(a), cos = Math.cos(a);
    fittingBox(timber, [sin * .30, .31 + postHeight / 2, cos * .30], [.245, postHeight, .19],
      k % 3 === 0 ? INK.honey : wood, .022, [0, a, 0]);
    if (k % 2 === 0) {
      fittingBox(base, [sin * .415, .82, cos * .415], [.10, 1.10, .045], INK.iron, .012, [0, a, 0]);
      for (const y of [.42, 1.19]) base.add('sphere', [sin * .448, y, cos * .448], [.036, .036, .036], [0, 0, 0], brass);
    }
  }
  for (const y of [.36, 1.35]) {
    base.add('cylinder', [0, y, 0], [.455, .10, .455], [0, 0, 0], INK.ironDark);
    base.add('cylinder', [0, y + .055, 0], [.458, .025, .458], [0, 0, 0], brass);
  }
  for (const x of [-.43, .43]) for (const z of [-.43, .43]) {
    base.add('cylinder', [x, .355, z], [.071, .035, .071], [0, 0, 0], INK.ironDark);
    base.add('cylinder', [x, .38, z], [.045, .037, .045], [0, 0, 0], brass);
  }
  base.add('cylinder', [0, GUN_PIVOT_HEIGHT - .35, 0], [.50, .15, .50], [0, 0, 0], '#4d626c');
  base.add('cylinder', [0, GUN_PIVOT_HEIGHT - .23, 0], [.46, .09, .46], [0, 0, 0], brass);
  // Repeated lugs describe the swivel race without an extra mesh per fitting.
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6;
    fittingBox(base, [Math.sin(a) * .49, GUN_PIVOT_HEIGHT - .35, Math.cos(a) * .49],
      [.095, .12, .075], INK.ironDark, .01, [0, a, 0]);
  }
  const pedestal = base.mesh(); pedestal.name = 'cannon-pedestal'; group.add(pedestal, swivel);
  const pedestalTimber = timber.mesh(); pedestalTimber.name = 'cannon-pedestal-timber'; group.add(pedestalTimber);
  swivel.position.y = GUN_PIVOT_HEIGHT;
  const fork = new ShipBatch(palette, material);
  for (const side of [-1, 1]) {
    fittingBox(fork, [side * .46, -.12, 0], [.18, .61, .69], port ? INK.blue : INK.teal, .045, [0, 0, side * -.11]);
    fittingBox(fork, [side * .46, .18, 0], [.23, .09, .70], '#64757c', .025, [0, 0, side * -.11]);
    fittingBox(fork, [side * .568, -.12, .02], [.045, .35, .47], INK.ironDark, .02);
    fork.add('cylinder', [side * .55, 0, 0], [.185, .15, .185], [0, 0, Math.PI / 2], brass);
    fork.add('cylinder', [side * .64, 0, 0], [.12, .045, .12], [0, 0, Math.PI / 2], '#556671');
    fittingBox(fork, [side * .67, 0, 0], [.025, .036, .14], INK.ironDark, .008);
    for (const z of [-.24, .25]) fork.add('sphere', [side * .58, -.19, z], [.028, .035, .035], [0, 0, 0], brass);
  }
  fittingBox(fork, [0, -.29, .02], [1.0, .14, .64], INK.ironDark, .03);
  // Outboard adjustment wheel is fixed to the yoke, clear of the recoil slide.
  const wheel = new THREE.TorusGeometry(.22, .029, 6, 16);
  fork.add(wheel, [.76, -.02, .18], [1, 1, 1], [0, Math.PI / 2, 0], brass); wheel.dispose();
  fork.line([.55, -.02, .18], [.79, -.02, .18], .045, INK.iron, 1, 8);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    fork.line([.76, -.02, .18], [.76, -.02 + Math.sin(a) * .20, .18 + Math.cos(a) * .20], .019, brass, 1, 6);
  }
  swivel.add(elevation); elevation.add(barrel);
  const tube = new ShipBatch(palette, material);
  const tubeGeometry = cannonTubeGeometry(brass);
  tube.add(tubeGeometry, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]); tubeGeometry.dispose();
  // Breech cheek plates and rubbed edges echo the handheld weapon receivers.
  for (const side of [-1, 1]) {
    fittingBox(tube, [side * .345, 0, .035], [.09, .34, .49], INK.iron, .025);
    fittingBox(tube, [side * .398, .06, .025], [.02, .045, .25], '#809095', .006);
    for (const z of [-.13, .20]) tube.add('sphere', [side * .406, -.08, z], [.025, .032, .032], [0, 0, 0], brass);
    tube.line([side * .19, .18, -1.14], [side * .165, .16, -1.66], .009, '#75838a', .45, 5);
  }
  tube.add('cylinder', [0, 0, .58], [.11, .18, .11], [Math.PI / 2, 0, 0], brass);
  tube.add('sphere', [0, 0, .69], [.15, .15, .14], [0, 0, 0], INK.iron);
  fittingBox(tube, [0, .36, -.04], [.16, .10, .18], INK.ironDark, .02);
  fittingBox(tube, [0, .26, -1.99], [.065, .10, .14], brass, .012);
  // Handling grips belong to the fixed yoke; pitching/recoiling the barrel must
  // not drive the controls down through the timber pedestal.
  for (const side of [-1, 1]) fork.line([side * .46, -.24, .29], [side * .46, -.30, 1.0], .045, INK.iron, 1, 8);
  fork.line([-.46, -.30, 1.0], [.46, -.30, 1.0], .055, brass, 1, 10);
  const grips = new ShipBatch(palette, timberMaterial);
  for (const side of [-1, 1]) {
    fittingBox(grips, [side * .30, -.30, 1.0], [.23, .13, .14], wood, .025);
    for (const x of [.195, .405]) fork.add('cylinder', [side * x, -.30, 1.0], [.083, .028, .083], [0, 0, Math.PI / 2], brass);
  }
  const forkMesh = fork.mesh(); forkMesh.name = 'cannon-yoke'; swivel.add(forkMesh);
  const barrelMesh = tube.mesh(); barrelMesh.name = 'cannon-barrel-detail'; barrel.add(barrelMesh);
  const gripMesh = grips.mesh(); gripMesh.name = 'cannon-timber-grips'; swivel.add(gripMesh);
  const muzzle = new THREE.Object3D(); muzzle.name = 'cannon-muzzle'; muzzle.position.z = -GUN_MUZZLE_LENGTH; elevation.add(muzzle);
  let recoil = 0;
  function animate(dt, yaw = gun.yaw, pitch = .1, occupantId = null) {
    const aim = gunAim(gun, yaw, pitch);
    swivel.rotation.y = aim.yaw; elevation.rotation.x = aim.pitch;
    recoil *= Math.exp(-16 * Math.max(0, dt)); barrel.position.z = recoil * .36;
    group.userData.occupantId = occupantId;
  }
  animate(0);
  return { group, swivel, elevation, barrel, muzzle, animate,
    fire() { recoil = 1; barrel.position.z = .36; },
    getMuzzle(target = new THREE.Vector3()) { muzzle.updateWorldMatrix(true, false); return muzzle.getWorldPosition(target); },
  };
}
