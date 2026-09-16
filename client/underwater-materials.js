import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Self contained materials for the dive.  They intentionally do not borrow or
// alter the island palette: a reef can be torn down while the island stays up.
const TAU = Math.PI * 2;
const MATERIALS = Object.freeze({
  stone: { color: '#8daaa4', roughness: .88, scale: 5.6 },
  timber: { color: '#614c39', roughness: .83, scale: 7.5 },
  bronze: { color: '#8d7850', roughness: .53, metalness: .58, scale: 1.25 },
  basalt: { color: '#384447', roughness: .96, scale: 1.75 },
  coral: { color: '#d78d79', roughness: .78, scale: 1.35 },
  sand: { color: '#d6c89d', roughness: 1, scale: 16 },
  kelp: { color: '#4c8c69', roughness: .74, side: THREE.DoubleSide, scale: 1.8 },
  rope: { color: '#756046', roughness: .94, scale: .75 },
});

function hash(x, y, seed = 1) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

const loopDistance = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

// All patterns are periodic in the texture domain so the DataTexture can tile
// across a long board or cliff face without a visible seam at its edge.
function surfaceSignal(u, v, seed, kind, size = 128) {
  const broad = Math.sin(TAU * (u * 2 + v) + seed) * .52 + Math.sin(TAU * (u - v * 3) + seed * .37) * .27;
  // Fine grain is indexed in the tile and wraps at its integer boundary. It
  // gives stone and sand tactile variation without introducing a seam line.
  const wrap = value => ((value % size) + size) % size;
  const grain = hash(wrap(Math.floor(u * size)), wrap(Math.floor(v * size)), seed + 13) - .5;
  if (kind === 'timber') {
    const longGrain = Math.sin(TAU * (u * 8 + Math.sin(TAU * v) * .16 + Math.sin(TAU * v * 3) * .035));
    const fineGrain = Math.sin(TAU * (u * 24 + Math.sin(TAU * v * 2) * .34));
    const split = Math.pow(Math.max(0, Math.cos(TAU * (u * 3 + Math.sin(TAU * v) * .13))), 25);
    const knotA = Math.exp(-((loopDistance(u, .29) / .055) ** 2 + (loopDistance(v, .56) / .12) ** 2));
    const knotB = Math.exp(-((loopDistance(u, .73) / .035) ** 2 + (loopDistance(v, .22) / .075) ** 2));
    return broad * .025 + longGrain * .055 + fineGrain * .018 + grain * .025 - split * .19 - (knotA + knotB) * .15;
  }
  if (kind === 'rope') {
    const twist = Math.sin(TAU * (v * 12 + u * 2 + Math.sin(TAU * u) * .18));
    const strand = Math.sin(TAU * (v * 24 - u * 2));
    return broad * .025 + twist * .09 + strand * .03 + grain * .018;
  }
  if (kind === 'basalt') {
    const mass = Math.sin(TAU * (u + v) + Math.sin(TAU * v * 2) * .35);
    const faultA = 1 - Math.min(1, Math.abs(Math.sin(TAU * (u * 2 - v + Math.sin(TAU * v) * .11))) * 13);
    const faultB = 1 - Math.min(1, Math.abs(Math.sin(TAU * (u + v * 2))) * 16);
    const pores = Math.max(0, Math.sin(TAU * (u * 6 + v * 5) + Math.sin(TAU * u * 2) * .7) - .72);
    return broad * .07 + mass * .18 + grain * .03 - Math.max(faultA, faultB) * .38 - pores * .32;
  }
  if (kind === 'stone') return broad * .135 + Math.sin(TAU * (u * 3 - v * 2)) * .05 + grain * .07;
  if (kind === 'sand') return Math.sin(TAU * (u + v * 5) + Math.sin(TAU * u * 2) * .55) * .10 + Math.sin(TAU * (u * 3 - v * 2)) * .038 + grain * .055;
  if (kind === 'coral') return broad * .105 + Math.sin(TAU * (u * 4 + v * 3)) * .045 + grain * .055;
  if (kind === 'kelp') return broad * .075 + grain * .045;
  return broad * .075 + grain * .045;
}

function textureData(size, seed, kind, normal = false) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (x + y * size) * 4, u = x / size, v = y / size;
    const signal = surfaceSignal(u, v, seed, kind, size);
    if (normal) {
      const step = 1 / size, strength = kind === 'timber' || kind === 'rope' ? 105 : kind === 'basalt' ? 145 : kind === 'sand' ? 260 : kind === 'stone' ? 245 : kind === 'coral' ? 220 : 170;
      const nx = 128 + Math.round((surfaceSignal((u + step) % 1, v, seed, kind, size) - surfaceSignal((u - step + 1) % 1, v, seed, kind, size)) * strength);
      const ny = 128 + Math.round((surfaceSignal(u, (v + step) % 1, seed, kind, size) - surfaceSignal(u, (v - step + 1) % 1, seed, kind, size)) * strength);
      data[i] = nx; data[i + 1] = ny; data[i + 2] = 250; data[i + 3] = 255;
    } else {
      const value = Math.max(176, Math.min(248, Math.round(226 + signal * 82)));
      data[i] = value; data[i + 1] = Math.min(255, value + 3); data[i + 2] = Math.max(0, value - 5); data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

function makeGeometry() {
  return {
    // A small bevel catches the filtered underwater light; plain cube edges
    // made even authored planks and ashlar read as placeholder collision art.
    box: new RoundedBoxGeometry(1, 1, 1, 2, .055),
    sphere: new THREE.SphereGeometry(1, 12, 8),
    pebble: new THREE.DodecahedronGeometry(1, 0),
    cylinder: new THREE.CylinderGeometry(1, .92, 1, 8, 1),
    cone: new THREE.ConeGeometry(1, 1, 9, 2),
    ring: new THREE.TorusGeometry(1, .11, 6, 18),
  };
}

function wear(tint, point, normal) {
  const pitting = hash(point.x * 3.7, point.z * 3.7, point.y * 7.1);
  // Up-facing vertices collect pale shell dust; small variation keeps merged
  // forms from reading as flat toy colours.
  const light = .87 + pitting * .16 + Math.max(0, normal.y) * .06;
  return [tint.r * light, tint.g * light, tint.b * light];
}

function longitudinalBasis(source, matrix) {
  if (!source.boundingBox) source.computeBoundingBox();
  const size = source.boundingBox?.getSize(new THREE.Vector3()) || new THREE.Vector3(1, 1, 1), e = matrix.elements;
  const axes = [new THREE.Vector3(e[0], e[1], e[2]), new THREE.Vector3(e[4], e[5], e[6]), new THREE.Vector3(e[8], e[9], e[10])];
  const spans = axes.map((axis, index) => axis.length() * [size.x, size.y, size.z][index]);
  const longitudinalIndex = spans.indexOf(Math.max(...spans));
  const transverseIndex = spans.map((span, index) => index === longitudinalIndex ? -1 : span).indexOf(Math.max(...spans.map((span, index) => index === longitudinalIndex ? -1 : span)));
  const longitudinal = axes[longitudinalIndex].normalize(), transverse = axes[transverseIndex].normalize();
  return { longitudinal, transverse, secondary: new THREE.Vector3().crossVectors(longitudinal, transverse).normalize() };
}

class ReefBatch {
  constructor(resources, kind) {
    this.resources = resources; this.kind = kind;
    this.positions = []; this.normals = []; this.colors = []; this.uvs = [];
    this._point = new THREE.Vector3(); this._normal = new THREE.Vector3();
  }

  add(geometry, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], color = '#ffffff') {
    const source = typeof geometry === 'string' ? this.resources.geometry[geometry] : geometry;
    if (!source?.attributes?.position) throw new TypeError('ReefBatch.add needs a known geometry or BufferGeometry');
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    return this.addMatrix(source, matrix, color);
  }

  addMatrix(source, matrix, color = '#ffffff') {
    const position = source.attributes.position, normal = source.attributes.normal, index = source.index;
    const count = index ? index.count : position.count, normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix), tint = new THREE.Color(color);
    const scale = this.resources.surfaceScale[this.kind] || 1;
    const basis = this.kind === 'timber' || this.kind === 'rope' ? longitudinalBasis(source, matrix) : null;
    const triangle = [];
    for (let i = 0; i < count; i++) {
      const sourceIndex = index ? index.getX(i) : i;
      this._point.fromBufferAttribute(position, sourceIndex).applyMatrix4(matrix);
      if (normal) this._normal.fromBufferAttribute(normal, sourceIndex).applyMatrix3(normalMatrix).normalize(); else this._normal.set(0, 1, 0);
      const [r, g, b] = wear(tint, this._point, this._normal);
      this.positions.push(this._point.x, this._point.y, this._point.z);
      this.normals.push(this._normal.x, this._normal.y, this._normal.z);
      this.colors.push(r, g, b);
      triangle.push(this._point.clone());
      if (triangle.length === 3) {
        // One projection is selected for the full face, avoiding seams when
        // smooth vertex normals happen to cross a dominant-axis threshold.
        const face = triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0]));
        const ax = Math.abs(face.x), ay = Math.abs(face.y), az = Math.abs(face.z);
        const faceLength = face.length(), faceNormal = faceLength > 1e-8 ? face.multiplyScalar(1 / faceLength) : null;
        const sideAxis = basis && faceNormal && Math.abs(faceNormal.dot(basis.longitudinal)) < .94
          ? new THREE.Vector3().crossVectors(faceNormal, basis.longitudinal).normalize() : null;
        for (const point of triangle) {
          // Side faces retain the beam's grain in V while U follows the face,
          // rather than collapsing on a fixed perpendicular axis. End caps
          // have no longitudinal span, so they use the two cross-section axes.
          if (basis && sideAxis) this.uvs.push(point.dot(sideAxis) / scale, point.dot(basis.longitudinal) / scale);
          else if (basis) this.uvs.push(point.dot(basis.transverse) / scale, point.dot(basis.secondary) / scale);
          else if (ay >= ax && ay >= az) this.uvs.push(point.x / scale, point.z / scale);
          else if (ax >= az) this.uvs.push(point.z / scale, point.y / scale);
          else this.uvs.push(point.x / scale, point.y / scale);
        }
        triangle.length = 0;
      }
    }
    return this;
  }

  line(a, b, radius, color = '#ffffff', taper = 1) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start), length = direction.length();
    if (!Number.isFinite(length) || length < 1e-5) return this;
    const geometry = taper === 1 ? this.resources.geometry.cylinder : new THREE.CylinderGeometry(taper, 1, 1, 8, 1);
    const matrix = new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()), new THREE.Vector3(radius, length, radius));
    this.addMatrix(geometry, matrix, color); if (geometry !== this.resources.geometry.cylinder) geometry.dispose();
    return this;
  }

  mesh({ shadow = true } = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.positions.length) geometry.computeBoundingBox(), geometry.computeBoundingSphere();
    else { geometry.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()); geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0); }
    const mesh = new THREE.Mesh(geometry, this.resources.materials[this.kind]);
    mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.userData.triangles = this.positions.length / 9;
    return mesh;
  }
}

export function createReefResources(_palette = null) {
  const geometry = makeGeometry(), textures = [], materials = {}, surfaceScale = {};
  let disposed = false;
  for (const [index, [kind, spec]] of Object.entries(MATERIALS).entries()) {
    const textureSize = kind === 'timber' ? 256 : 128, map = textureData(textureSize, index + 1, kind), normalMap = textureData(textureSize, index + 41, kind, true), roughnessMap = textureData(textureSize, index + 81, kind);
    roughnessMap.colorSpace = THREE.NoColorSpace;
    textures.push(map, normalMap, roughnessMap); map.repeat.set(1, 1); normalMap.repeat.set(1, 1); roughnessMap.repeat.set(1, 1);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', map, normalMap, roughnessMap, roughness: spec.roughness, metalness: spec.metalness || 0, vertexColors: true, side: spec.side || THREE.FrontSide });
    material.name = `sunken-reach-${kind}-weathered-material`; materials[kind] = material; surfaceScale[kind] = spec.scale;
  }
  const kelpUniforms = { time: { value: 0 }, motion: { value: 1 } };
  materials.kelp.onBeforeCompile = shader => {
    shader.uniforms.reefTime = kelpUniforms.time; shader.uniforms.reefMotion = kelpUniforms.motion;
    shader.vertexShader = `uniform float reefTime; uniform float reefMotion;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>\nfloat reefWeight = smoothstep(.25, 9.0, position.y);\ntransformed.x += sin(reefTime * 1.45 + position.y * .71 + position.z * .37) * .23 * reefWeight * reefMotion;\ntransformed.z += cos(reefTime * 1.12 + position.y * .54 + position.x * .42) * .13 * reefWeight * reefMotion;`);
  };
  materials.kelp.customProgramCacheKey = () => 'sunken-reach-kelp-sway-v1';
  materials.kelp.userData.reefSwayUniforms = kelpUniforms;
  return {
    materials, geometry, surfaceScale,
    batch(kind) { if (!materials[kind]) throw new RangeError(`Unknown reef material: ${kind}`); return new ReefBatch(this, kind); },
    update(time = 0, { reducedMotion = false } = {}) { kelpUniforms.time.value = Number.isFinite(time) ? time : 0; kelpUniforms.motion.value = reducedMotion ? 0 : 1; },
    dispose() {
      if (disposed) return; disposed = true;
      for (const material of Object.values(materials)) material.dispose();
      for (const texture of textures) texture.dispose();
      for (const source of Object.values(geometry)) source.dispose();
    },
  };
}
