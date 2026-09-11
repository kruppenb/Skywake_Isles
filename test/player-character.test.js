import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

// Binary-contract tests for the shipped player character, navigator-meshy.glb (the Meshy-built
// Skywake navigator that client/player-character.js renders as the live pirate). The file owns
// its own minimal glTF-binary reader and PNG decoder; it does not import the runtime, three.js
// or the generator scripts in tools/meshy/. Every "exact" number below was independently measured
// from the shipped bytes; client/assets/player-character/manifest.json (written by
// tools/meshy/manifest.mjs from the same bytes) is then cross-checked against those
// measurements, never used as the source of truth for them.

const GLB_URL = new URL('../client/assets/player-character/navigator-meshy.glb', import.meta.url);
const MANIFEST_URL = new URL('../client/assets/player-character/manifest.json', import.meta.url);

const COMPONENT_TYPES = { 5121: ['readUInt8', 1], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4] };
const TYPE_WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGlb(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', 'GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'binary glTF version must be 2');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'header length field must match the actual file size');
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(jsonLength % 4, 0, 'JSON chunk length must be 4-byte aligned');
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'first chunk type must be JSON');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  assert.equal(json.asset?.version, '2.0');
  const binHeader = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(binHeader);
  assert.equal(binLength % 4, 0, 'BIN chunk length must be 4-byte aligned');
  assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942, 'second chunk type must be BIN');
  const binOffset = binHeader + 8;
  assert.equal(binOffset + binLength, bytes.length, 'JSON+BIN chunks must account for every byte of the file, no trailing chunk');
  return { json, bytes, binOffset, binLength };
}

// Reads one accessor's raw values straight off bufferView/accessor byteOffset+stride math rather
// than trusting any accessor.min/max metadata, so bounds and finiteness checks are of real bytes.
function readAccessor({ json, bytes, binOffset, binLength }, index) {
  const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView];
  const [read, size] = COMPONENT_TYPES[accessor.componentType], width = TYPE_WIDTH[accessor.type];
  const stride = view.byteStride || width * size;
  const base = binOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  assert.ok(base + Math.max(0, accessor.count - 1) * stride + width * size <= binOffset + binLength,
    `accessor ${index} reads past the end of the BIN chunk`);
  return Array.from({ length: accessor.count }, (_, i) =>
    Array.from({ length: width }, (_, c) => bytes[read](base + i * stride + c * size)));
}

function imageBytes({ json, bytes, binOffset }, index) {
  const view = json.bufferViews[json.images[index].bufferView];
  const start = binOffset + (view.byteOffset || 0);
  return bytes.subarray(start, start + view.byteLength);
}

function pngHeader(blob) {
  assert.equal(blob.toString('hex', 0, 8), '89504e470d0a1a0a', 'embedded image is not a PNG (bad signature)');
  assert.equal(blob.toString('ascii', 12, 16), 'IHDR', 'PNG does not lead with an IHDR chunk');
  return { width: blob.readUInt32BE(16), height: blob.readUInt32BE(20), bitDepth: blob[24], colourType: blob[25], interlace: blob[28] };
}

// Minimal PNG decode (8-bit RGBA, non-interlaced, all five scanline filters) so the crew mask in
// the alpha channel is checked on real texels rather than taken on trust.
function decodeRgbaPng(blob) {
  const { width, height, bitDepth, colourType, interlace } = pngHeader(blob);
  assert.equal(bitDepth, 8); assert.equal(colourType, 6, 'expected an RGBA PNG'); assert.equal(interlace, 0);
  const chunks = [];
  for (let offset = 8; offset < blob.length;) {
    const length = blob.readUInt32BE(offset), type = blob.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(blob.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const bpp = 4, stride = width * bpp, pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0, b = previous[i], c = i >= bpp ? previous[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else assert.equal(filter, 0, `unsupported PNG filter ${filter} on row ${y}`);
      out[i] = value & 255;
    }
    previous = out;
  }
  return { width, height, pixels };
}

// Sum of width*height*4 over the base level and every integer-halved mip level down to 1x1, the
// same definition the manifest and client/environment-assets.js use.
function decodedMipBytes(width, height) {
  let total = 0, w = width, h = height;
  for (;;) {
    total += w * h * 4;
    if (w === 1 && h === 1) break;
    w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
  }
  return total;
}

function parentIndex(json) {
  const parents = new Map();
  json.nodes.forEach((node, i) => (node.children || []).forEach(child => parents.set(child, i)));
  return parents;
}

function ancestry(json, parents, nodeIndex) {
  const names = [];
  let cursor = nodeIndex;
  while (parents.has(cursor)) { cursor = parents.get(cursor); names.push(json.nodes[cursor].name); }
  return names;
}

// Rest-pose world position of a node, composed from node TRS up the parent chain (own math, no
// three.js), so "forward is -Z" can be checked on the actual rest skeleton including the root spin.
function quaternionRotate([x, y, z, w], [vx, vy, vz]) {
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
function quaternionMultiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [ax * bw + aw * bx + ay * bz - az * by, ay * bw + aw * by + az * bx - ax * bz, az * bw + aw * bz + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz];
}
function restWorld(json, parents, nodeIndex) {
  const chain = [nodeIndex];
  while (parents.has(chain[0])) chain.unshift(parents.get(chain[0]));
  let position = [0, 0, 0], rotation = [0, 0, 0, 1], scale = 1;
  for (const index of chain) {
    const node = json.nodes[index];
    const t = node.translation || [0, 0, 0], r = node.rotation || [0, 0, 0, 1], s = node.scale ? node.scale[0] : 1;
    const offset = quaternionRotate(rotation, t.map(v => v * scale));
    position = [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]];
    rotation = quaternionMultiply(rotation, r);
    scale *= s;
  }
  return { position, rotation, scale };
}

let cachedGlb = null, cachedManifest = null;
async function loadGlb() { return cachedGlb ??= parseGlb(await readFile(GLB_URL)); }
async function loadManifest() { return cachedManifest ??= JSON.parse(await readFile(MANIFEST_URL, 'utf8')); }

// Budgets from the original asset spec; the bone, socket, clip and material contract as revised for
// the Meshy pipeline (docs/PLAYER_CHARACTER.md, "Asset contract"): Meshy's Mixamo-named skeleton is
// kept verbatim so every library clip stays retargetable, five sockets hang off it, and the crew
// colour is a per-texel alpha mask on the single material instead of a separate tinted material.
const BUDGETS = {
  maxTriangles: 50000, maxMaterials: 8, maxMeshPrimitives: 16,
  maxGlbBytes: 8 * 1024 * 1024, maxDecodedTextureBytes: 32 * 1024 * 1024,
  maxDeformJoints: 64, maxImageDimension: 2048,
};
const SKELETON = [
  'Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head', 'head_end', 'headfront',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];
const REQUIRED_SOCKETS = {
  'weapon_grip.L': 'LeftHand', 'weapon_grip.R': 'RightHand',
  'glider_grip.L': 'LeftHand', 'glider_grip.R': 'RightHand',
  'stow_back': 'Spine',
};
// Bones client/player-character.js drives directly (arm IK, head pitch, leg bends, stow socket).
const RUNTIME_BONES = ['Hips', 'Spine', 'Head', 'stow_back', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm',
  'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];
const REQUIRED_CLIPS = ['idle', 'walk', 'run'];
const CREW_MASK_CONVENTION = 'baseColorAlpha';
// KHR_materials_specular/ior are what Blender 5.2 always declares for a Principled export; three.js
// r180's GLTFLoader supports both natively. Anything needing a decoder is still forbidden.
const ALLOWED_EXTENSIONS = ['KHR_materials_specular', 'KHR_materials_ior'];
const FORBIDDEN_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'KHR_lights_punctual'];

test('navigator-meshy.glb is a well-formed binary glTF whose JSON+BIN chunks account for every byte, and its size/hash are pinned', async () => {
  const { bytes } = await loadGlb();
  assert.equal(bytes.length, 6553672);
  assert.ok(bytes.length <= BUDGETS.maxGlbBytes, `${bytes.length} bytes exceeds the ${BUDGETS.maxGlbBytes} GLB budget`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, '7323000466396209352719a1d84f91f6c6e5e68fc61e1d07280fe7b557a04666');
  const manifest = await loadManifest();
  assert.equal(manifest.bytes, bytes.length, 'manifest byte count has drifted from the shipped file');
  assert.equal(manifest.sha256, hash, 'manifest hash has drifted from the shipped file');
});

test('scene root is SkywakeNavigator, spun to face -Z and scaled to game size, with exactly one skin covering the Meshy skeleton plus the five sockets', async () => {
  const { json } = await loadGlb();
  const sceneIndex = json.scene ?? 0;
  assert.equal(json.scenes[sceneIndex].nodes.length, 1, 'exactly one scene root node');
  const root = json.nodes[json.scenes[sceneIndex].nodes[0]];
  assert.equal(root.name, 'SkywakeNavigator');
  // Meshy characters face +Z; the build spins the root half a turn about Y and scales it up.
  const [rx, ry, rz, rw] = root.rotation;
  assert.ok(Math.abs(rx) < 1e-3 && Math.abs(rz) < 1e-3 && Math.abs(Math.abs(ry) - 1) < 1e-3 && Math.abs(rw) < 1e-3, `root rotation ${root.rotation} is not a half turn about Y`);
  assert.ok(root.scale.every(s => Math.abs(s - root.scale[0]) < 1e-6), 'root scale must be uniform');
  assert.ok(Math.abs(root.scale[0] - 1.4843) < 1e-3, `root scale ${root.scale[0]} drifted from the measured 1.4843`);
  assert.equal(json.skins.length, 1, 'exactly one armature/skin, no clones');
  const jointNames = json.skins[0].joints.map(i => json.nodes[i].name);
  assert.equal(jointNames.length, 29);
  assert.ok(jointNames.length <= BUDGETS.maxDeformJoints, `${jointNames.length} joints exceeds the ${BUDGETS.maxDeformJoints} budget`);
  assert.equal(new Set(jointNames).size, jointNames.length, 'duplicate joint name');
  assert.deepEqual([...jointNames].sort(), [...SKELETON, ...Object.keys(REQUIRED_SOCKETS)].sort(),
    'joint set is not exactly the Meshy/Mixamo skeleton plus the five sockets (no finger or toe bones beyond ToeBase, per the documented limitation)');
  for (const name of RUNTIME_BONES) assert.ok(jointNames.includes(name), `runtime bone ${name} is missing from the skin`);
  const meshNodes = json.nodes.filter(n => n.mesh !== undefined);
  assert.equal(meshNodes.length, 1, 'expected exactly one mesh-carrying node');
  assert.ok(meshNodes.every(n => n.skin === 0), 'the mesh node must bind the single skin');
});

test('the mesh is one valid indexed triangle list with finite positions, normals and UVs, fully skinned', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  let triangles = 0, primitives = 0, skinnedPrimitives = 0;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    primitives++;
    assert.equal(primitive.mode ?? 4, 4, `${mesh.name} primitive is not TRIANGLES`);
    const attrs = primitive.attributes;
    assert.ok('POSITION' in attrs && 'NORMAL' in attrs && 'TEXCOORD_0' in attrs, `${mesh.name} is missing a required attribute`);
    const indices = readAccessor(glb, primitive.indices).map(([i]) => i);
    assert.equal(indices.length % 3, 0, `${mesh.name} index count is not a multiple of 3`);
    triangles += indices.length / 3;
    const positions = readAccessor(glb, attrs.POSITION);
    assert.ok(indices.every(i => Number.isInteger(i) && i >= 0 && i < positions.length), `${mesh.name} has an out-of-range index`);
    assert.ok(positions.every(row => row.every(Number.isFinite)), `${mesh.name} has a non-finite position`);
    assert.ok(readAccessor(glb, attrs.NORMAL).every(row => row.every(Number.isFinite)), `${mesh.name} has a non-finite normal`);
    const uvs = readAccessor(glb, attrs.TEXCOORD_0);
    assert.ok(uvs.every(row => row.every(Number.isFinite)), `${mesh.name} has a non-finite UV`);
    assert.ok(uvs.every(([u, v]) => u >= -1e-3 && u <= 1 + 1e-3 && v >= -1e-3 && v <= 1 + 1e-3), `${mesh.name} has UVs outside the atlas`);
    if ('JOINTS_0' in attrs && 'WEIGHTS_0' in attrs) skinnedPrimitives++;
  }
  assert.equal(primitives, 1);
  assert.ok(primitives <= BUDGETS.maxMeshPrimitives, `${primitives} primitives exceeds the ${BUDGETS.maxMeshPrimitives} budget`);
  assert.equal(skinnedPrimitives, primitives, 'the visible mesh must be weighted');
  assert.equal(triangles, 41357);
  assert.ok(triangles <= BUDGETS.maxTriangles, `${triangles} triangles exceeds the ${BUDGETS.maxTriangles} budget`);
});

test('JOINTS_0/WEIGHTS_0 are in range and normalized, a meaningful share of vertices blend more than one joint, and socket bones deform nothing', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  const jointNames = json.skins[0].joints.map(i => json.nodes[i].name);
  const socketIndices = new Set(Object.keys(REQUIRED_SOCKETS).map(name => jointNames.indexOf(name)));
  let totalVertices = 0, multiInfluence = 0, maxDrift = 0, socketWeight = 0;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    const joints = readAccessor(glb, primitive.attributes.JOINTS_0);
    const weights = readAccessor(glb, primitive.attributes.WEIGHTS_0);
    assert.equal(joints.length, weights.length, `${mesh.name} JOINTS_0/WEIGHTS_0 count mismatch`);
    for (let i = 0; i < weights.length; i++) {
      totalVertices++;
      const row = weights[i];
      assert.ok(row.every(w => Number.isFinite(w) && w >= 0 && w <= 1), `${mesh.name} weight outside [0,1]`);
      const sum = row.reduce((a, b) => a + b, 0);
      maxDrift = Math.max(maxDrift, Math.abs(sum - 1));
      if (row.filter(w => w > 0.02).length >= 2) multiInfluence++;
      for (let k = 0; k < 4; k++) {
        const j = joints[i][k];
        assert.ok(Number.isInteger(j) && j >= 0 && j < jointNames.length, `${mesh.name} JOINTS_0 index out of range`);
        if (socketIndices.has(j)) socketWeight += row[k];
      }
    }
  }
  assert.ok(maxDrift < 2e-3, `weight sums drift from 1.0 by up to ${maxDrift}`);
  const blendedFraction = multiInfluence / totalVertices;
  assert.ok(blendedFraction > 0.25,
    `only ${(blendedFraction * 100).toFixed(1)}% of vertices blend 2+ joints -- looks rigid-parented, not smoothly skinned`);
  assert.equal(socketWeight, 0, 'attachment sockets must carry no skin weight');
});

test('bone rest transforms carry finite, unit-length rotations and no zero or negative scale', async () => {
  const { json } = await loadGlb();
  for (const index of json.skins[0].joints) {
    const node = json.nodes[index];
    assert.equal(node.matrix, undefined, `${node.name} bakes a raw matrix instead of TRS`);
    if (node.translation) assert.ok(node.translation.every(Number.isFinite), `${node.name} has a non-finite translation`);
    if (node.rotation) {
      assert.ok(node.rotation.every(Number.isFinite), `${node.name} has a non-finite rotation`);
      assert.ok(Math.abs(Math.hypot(...node.rotation) - 1) < 1e-2, `${node.name} rotation quaternion is not unit length`);
    }
    if (node.scale) assert.ok(node.scale.every(s => Number.isFinite(s) && s > 0), `${node.name} has a zero/negative/NaN scale`);
  }
});

test('one opaque textured material named navigator declares the alpha-channel crew mask and its reference coral in extras', async () => {
  const { json } = await loadGlb();
  assert.deepEqual(json.materials.map(m => m.name), ['navigator']);
  assert.ok(json.materials.length <= BUDGETS.maxMaterials);
  const material = json.materials[0];
  assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE', 'the mask must never become blending: the material stays OPAQUE');
  assert.ok(material.pbrMetallicRoughness?.baseColorTexture, 'navigator has no baseColorTexture');
  assert.equal(material.pbrMetallicRoughness.metallicFactor ?? 1, 0, 'painted cloth and skin must not be metallic');
  assert.equal(material.emissiveTexture, undefined, "Meshy's albedo-as-emission wiring must be stripped (it renders unlit)");
  assert.equal(material.extras?.crewMask, CREW_MASK_CONVENTION);
  const reference = material.extras?.crewReference;
  assert.ok(Array.isArray(reference) && reference.length === 3 && reference.every(c => Number.isFinite(c) && c >= 0 && c <= 1), 'crewReference must be three unit-range channels');
  const measured = [0.6982, 0.3977, 0.3521];
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(reference[i] - measured[i]) < 0.01, `crewReference[${i}] drifted from the measured lapel coral`);
});

test('the single embedded atlas is a 2048 RGBA PNG whose alpha really carries a sparse crew mask, within the decoded-memory budget', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  assert.equal(json.images.length, 1, 'expected exactly one shared albedo atlas');
  assert.ok(json.images.every(i => Number.isInteger(i.bufferView) && !i.uri), 'image is not embedded in the GLB');
  assert.ok(json.buffers.every(b => !b.uri), 'buffer references an external file instead of being embedded');
  const blob = imageBytes(glb, 0);
  const { width, height, pixels } = decodeRgbaPng(blob);
  assert.equal(width, 2048); assert.equal(height, 2048);
  assert.ok(width <= BUDGETS.maxImageDimension && height <= BUDGETS.maxImageDimension);
  let masked = 0, partial = 0, dark = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a > 127) masked++;
    else if (a > 8) partial++;
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 24) dark++;
  }
  const texels = width * height;
  const maskedFraction = masked / texels;
  assert.ok(maskedFraction > 0.03 && maskedFraction < 0.15, `crew mask covers ${(maskedFraction * 100).toFixed(2)}% of the atlas; expected the lapels/cuffs/collar/sash/lining band (3-15%)`);
  assert.ok(partial / texels < 0.03, 'the mask should be feathered only at its edges, not smeared across the atlas');
  assert.ok(dark / texels < 0.05, 'the albedo is mostly painted colour, not black gutters');
  const totalDecoded = decodedMipBytes(width, height);
  assert.equal(totalDecoded, 22369620);
  assert.ok(totalDecoded <= BUDGETS.maxDecodedTextureBytes);
  const manifest = await loadManifest();
  assert.equal(manifest.decodedTextureBytes, totalDecoded, 'manifest texture accounting has drifted from the shipped image');
});

test('idle, walk and run clips exist exactly once, key every joint on all three paths, with finite time-ordered samplers and real motion', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  const names = json.animations.map(a => a.name);
  assert.deepEqual([...names].sort(), [...REQUIRED_CLIPS].sort());
  const jointSet = new Set(json.skins[0].joints);
  const durations = {};
  for (const anim of json.animations) {
    let maxTime = -Infinity;
    for (const sampler of anim.samplers) {
      const times = readAccessor(glb, sampler.input).map(([t]) => t);
      assert.ok(times.every(Number.isFinite), `${anim.name} has a non-finite sampler time`);
      for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1], `${anim.name} sampler times are not ordered`);
      maxTime = Math.max(maxTime, ...times);
    }
    assert.equal(anim.channels.length, 87, `${anim.name}: expected 29 joints x translation/rotation/scale channels`);
    const targeted = new Set(anim.channels.map(c => c.target.node));
    assert.deepEqual([...targeted].sort(), [...jointSet].sort(), `${anim.name} does not key every joint (the mixer blends whole poses)`);
    let moved = false;
    for (const channel of anim.channels) {
      assert.ok(['translation', 'rotation', 'scale'].includes(channel.target.path));
      const output = readAccessor(glb, anim.samplers[channel.sampler].output);
      assert.ok(output.every(row => row.every(Number.isFinite)), `${anim.name} has a non-finite channel value`);
      if (channel.target.path === 'rotation' && output.some(row => row.some((v, i) => Math.abs(v - output[0][i]) > 1e-3))) moved = true;
    }
    assert.ok(moved, `${anim.name} has no rotation that actually changes -- a static pose exported as a clip`);
    durations[anim.name] = maxTime;
  }
  assert.ok(Math.abs(durations.idle - 4.0333) < 1e-3, `idle duration measured ${durations.idle}`);
  assert.ok(Math.abs(durations.walk - 1.0667) < 1e-3, `walk duration measured ${durations.walk}`);
  assert.ok(Math.abs(durations.run - 0.6667) < 1e-3, `run duration measured ${durations.run}`);
});

test('attachment sockets exist exactly once, sit directly under their contractual bone, and are joints (not loose nodes)', async () => {
  const { json } = await loadGlb();
  const nodeNames = json.nodes.map(n => n.name);
  const parents = parentIndex(json);
  const jointNames = new Set(json.skins[0].joints.map(i => json.nodes[i].name));
  const socketNames = nodeNames.filter(n => Object.prototype.hasOwnProperty.call(REQUIRED_SOCKETS, n));
  assert.deepEqual([...socketNames].sort(), [...Object.keys(REQUIRED_SOCKETS)].sort());
  for (const [name, parentBone] of Object.entries(REQUIRED_SOCKETS)) {
    const index = nodeNames.indexOf(name);
    assert.ok(index >= 0, `${name} socket node is missing`);
    const chain = ancestry(json, parents, index);
    assert.equal(chain[0], parentBone, `${name} hangs off ${chain[0]}, not ${parentBone}`);
    assert.ok(chain.includes('SkywakeNavigator'), `${name} does not ultimately hang off the character root`);
    assert.ok(jointNames.has(name), `${name} must be a skin joint so three.js exposes it as a Bone (loaded as "${name.replace('.', '')}")`);
    assert.ok(!json.nodes[index].children?.length, `${name} must be a leaf`);
  }
});

test('model bounds sit on the ground plane at the spec height, and the rest skeleton confirms the -Z forward convention', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    for (const row of readAccessor(glb, primitive.attributes.POSITION)) {
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], row[i]); max[i] = Math.max(max[i], row[i]); }
    }
  }
  // Vertex data is stored in the root's post-spin frame, so these are game metres already.
  assert.ok(Math.abs(min[1]) < 0.02, `feet are not on the Y=0 ground plane: min Y ${min[1]}`);
  assert.ok(max[1] >= 2.65 && max[1] <= 2.9, `overall height ${max[1]}m is outside the spec's 2.65-2.9m tricorn-included range`);
  assert.ok(Math.abs(min[0] + max[0]) < 0.05, `A-pose is not centred on X: ${min[0]}..${max[0]}`);
  assert.ok(max[0] - min[0] > 1.3 && max[0] - min[0] < 1.7, `arm span ${max[0] - min[0]} is not the expected A-pose width`);
  const parents = parentIndex(json);
  const byName = name => json.nodes.findIndex(n => n.name === name);
  // Named landmarks decide the facing: the back stow socket must be behind the spine (+Z), the
  // face helper bone in front of the head (-Z), and the left hand on -X (the character's own left).
  const spine = restWorld(json, parents, byName('Spine')).position, stow = restWorld(json, parents, byName('stow_back')).position;
  const head = restWorld(json, parents, byName('Head')).position, face = restWorld(json, parents, byName('headfront')).position;
  const leftHand = restWorld(json, parents, byName('LeftHand')).position, rightHand = restWorld(json, parents, byName('RightHand')).position;
  assert.ok(stow[2] > spine[2] + 0.1, `stow_back (z ${stow[2].toFixed(3)}) is not behind the spine (z ${spine[2].toFixed(3)})`);
  assert.ok(face[2] < head[2] - 0.05, `headfront (z ${face[2].toFixed(3)}) is not in front of the head (z ${head[2].toFixed(3)})`);
  assert.ok(leftHand[0] < -0.4 && rightHand[0] > 0.4, `hands are not on their own sides: L ${leftHand[0].toFixed(2)}, R ${rightHand[0].toFixed(2)}`);
  assert.ok(Math.abs(head[1] - 2.33) < 0.1 && Math.abs(spine[1] - 2.04) < 0.1, `spine/head heights ${spine[1].toFixed(2)}/${head[1].toFixed(2)} drifted from the measured rest pose`);
});

test('exported GLB carries no cameras, lights, or extensions needing a decoder three.js r180 cannot supply', async () => {
  const { json } = await loadGlb();
  assert.ok(!json.extensionsRequired || json.extensionsRequired.length === 0, 'extensionsRequired must be empty');
  const used = json.extensionsUsed || [];
  for (const ext of used) assert.ok(!FORBIDDEN_EXTENSIONS.includes(ext), `${ext} needs a decoder three r180 cannot supply directly`);
  assert.deepEqual([...used].sort(), [...ALLOWED_EXTENSIONS].sort(), 'only the Blender Principled export extensions are expected');
  assert.ok(!json.cameras || json.cameras.length === 0, 'GLB contains a camera');
  for (const node of json.nodes) {
    assert.equal(node.camera, undefined, `${node.name} references a camera`);
    assert.ok(!node.extensions?.KHR_lights_punctual, `${node.name} references a light`);
  }
});

test('manifest.json does not drift from the shipped GLB: materials, joints, sockets, clip shapes, bounds and the tint convention all agree', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  const manifest = await loadManifest();
  assert.equal(manifest.glb, 'navigator-meshy.glb');
  assert.deepEqual(manifest.materialNames, json.materials.map(m => m.name));
  assert.deepEqual(manifest.joints, json.skins[0].joints.map(i => json.nodes[i].name));
  assert.equal(manifest.jointCount, json.skins[0].joints.length);
  assert.equal(manifest.skins, json.skins.length);
  assert.deepEqual([...manifest.animations.map(a => a.name)].sort(), [...json.animations.map(a => a.name)].sort());
  for (const clip of manifest.animations) {
    const anim = json.animations.find(a => a.name === clip.name);
    assert.equal(clip.channels, anim.channels.length, `${clip.name} channel count drifted`);
    assert.equal(clip.samplers, anim.samplers.length, `${clip.name} sampler count drifted`);
  }
  const parents = parentIndex(json);
  for (const socket of manifest.sockets) {
    assert.equal(socket.parent, REQUIRED_SOCKETS[socket.name], `manifest parent for ${socket.name} disagrees with the contract`);
    const index = json.nodes.findIndex(n => n.name === socket.name);
    assert.deepEqual(socket.ancestry, ancestry(json, parents, index), `manifest ancestry for ${socket.name} drifted`);
  }
  assert.equal(manifest.rootNode, 'SkywakeNavigator');
  assert.equal(manifest.forward, '-Z');
  assert.equal(manifest.triangles, 41357);
  assert.equal(manifest.crewTint.convention, CREW_MASK_CONVENTION);
  assert.equal(manifest.crewTint.material, 'navigator');
  assert.deepEqual(manifest.crewTint.reference, json.materials[0].extras.crewReference);
  assert.equal(manifest.images.length, 1);
  assert.equal(manifest.images[0].channels, 4);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const row of readAccessor(glb, json.meshes[0].primitives[0].attributes.POSITION)) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], row[i]); max[i] = Math.max(max[i], row[i]); }
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(manifest.bounds.min[i] - min[i]) < 1e-3 && Math.abs(manifest.bounds.max[i] - max[i]) < 1e-3, 'manifest bounds drifted from the vertex data');
  }
});
