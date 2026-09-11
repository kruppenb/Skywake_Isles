import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// WP-3: independent binary-contract tests for the shipped player-character prototype.
// This file owns its own minimal glTF-binary reader. It does not import
// tools/player_character.py's Glb helper (different language, and that helper is the
// generator's own self-check) and does not import client/character-studio.* (WP-2's
// runtime, which loads the asset through three.js's GLTFLoader instead of raw bytes).
// Every "exact" number below was independently measured from the shipped GLB, not
// copied from client/assets/player-character/manifest.json; the manifest is then
// cross-checked against those independent measurements, not the other way round.

const GLB_URL = new URL('../client/assets/player-character/hero.glb', import.meta.url);
const MANIFEST_URL = new URL('../client/assets/player-character/manifest.json', import.meta.url);
const BASE_OBJ_URL = new URL('../tools/player-character/base.obj', import.meta.url);

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

// Reads one accessor's raw values as an array of component-rows. Deliberately reads
// straight off bufferView/accessor byteOffset+stride math rather than trusting any
// accessor.min/max metadata, so finiteness/bounds checks below are of the real bytes.
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

function pngDimensions(blob) {
  assert.equal(blob.toString('hex', 0, 8), '89504e470d0a1a0a', 'embedded image is not a PNG (bad signature)');
  assert.equal(blob.toString('ascii', 12, 16), 'IHDR', 'PNG does not lead with an IHDR chunk');
  return { width: blob.readUInt32BE(16), height: blob.readUInt32BE(20) };
}

// Sum of width*height*4 over the base level and every integer-halved mip level down to
// 1x1 -- the same definition the manifest and client/environment-assets.js use, applied
// here independently against the actual decoded IHDR dimensions of each embedded image.
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

let cachedGlb = null, cachedManifest = null;
async function loadGlb() { return cachedGlb ??= parseGlb(await readFile(GLB_URL)); }
async function loadManifest() { return cachedManifest ??= JSON.parse(await readFile(MANIFEST_URL, 'utf8')); }

// Budgets and the required bone/socket/clip contract, transcribed from the Fable-approved
// spec (asset and rig contract, WP-1 budgets, Fable correction 2), not from the manifest.
const BUDGETS = {
  maxTriangles: 50000, maxMaterials: 8, maxMeshPrimitives: 16,
  maxGlbBytes: 8 * 1024 * 1024, maxDecodedTextureBytes: 32 * 1024 * 1024,
  maxDeformJoints: 64, maxImageDimension: 2048,
};
const REQUIRED_BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R',
  'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R',
  'coat_tail.L', 'coat_tail.R',
];
const REQUIRED_SOCKETS = {
  'weapon_grip.L': 'hand.L', 'weapon_grip.R': 'hand.R',
  'glider_grip.L': 'hand.L', 'glider_grip.R': 'hand.R',
  'stow_back': 'chest',
};
const REQUIRED_CLIPS = ['idle', 'walk', 'rig_check'];
const PINNED_ANATOMY_SHA256 = '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c';
const FORBIDDEN_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'KHR_lights_punctual'];

test('hero.glb is a well-formed binary glTF whose JSON+BIN chunks account for every byte, and its size/hash are pinned', async () => {
  const { bytes } = await loadGlb();
  assert.equal(bytes.length, 2948148);
  assert.ok(bytes.length <= BUDGETS.maxGlbBytes, `${bytes.length} bytes exceeds the ${BUDGETS.maxGlbBytes} GLB budget`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, '3d23b27cc6bf03001744cca77eafd6e772f51b15faa1700844ad5cdb70b3588a');
  const manifest = await loadManifest();
  assert.equal(manifest.bytes, bytes.length, 'manifest byte count has drifted from the shipped file');
  assert.equal(manifest.sha256, hash, 'manifest hash has drifted from the shipped file');
});

test('scene root is SkywakeNavigator with exactly one skin covering exactly the required bone set', async () => {
  const { json } = await loadGlb();
  const sceneIndex = json.scene ?? 0;
  assert.equal(json.scenes[sceneIndex].nodes.length, 1, 'exactly one scene root node');
  const root = json.nodes[json.scenes[sceneIndex].nodes[0]];
  assert.equal(root.name, 'SkywakeNavigator');
  assert.equal(json.skins.length, 1, 'exactly one armature/skin, no clones');
  const jointNames = json.skins[0].joints.map(i => json.nodes[i].name);
  assert.equal(jointNames.length, 20);
  assert.ok(jointNames.length <= BUDGETS.maxDeformJoints, `${jointNames.length} joints exceeds the ${BUDGETS.maxDeformJoints} budget`);
  assert.equal(new Set(jointNames).size, jointNames.length, 'duplicate joint name');
  assert.deepEqual([...jointNames].sort(), [...REQUIRED_BONES].sort(),
    'joint set is not exactly the required bones (no finger/toe bones are expected either, per the documented limitation)');
  const meshNodes = json.nodes.filter(n => n.mesh !== undefined);
  assert.equal(meshNodes.length, 8, 'expected exactly 8 mesh-carrying nodes');
  assert.ok(meshNodes.every(n => n.skin === 0), 'every mesh node must bind the single shared skin');
});

test('every mesh primitive is a valid indexed triangle list with finite positions, normals and UVs', async () => {
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
    assert.ok(readAccessor(glb, attrs.TEXCOORD_0).every(row => row.every(Number.isFinite)), `${mesh.name} has a non-finite UV`);
    if ('JOINTS_0' in attrs && 'WEIGHTS_0' in attrs) skinnedPrimitives++;
  }
  assert.equal(primitives, 8);
  assert.ok(primitives <= BUDGETS.maxMeshPrimitives, `${primitives} primitives exceeds the ${BUDGETS.maxMeshPrimitives} budget`);
  assert.equal(skinnedPrimitives, primitives, 'every visible mesh primitive must be weighted (none are left un-skinned)');
  assert.equal(triangles, 35656);
  assert.ok(triangles <= BUDGETS.maxTriangles, `${triangles} triangles exceeds the ${BUDGETS.maxTriangles} budget`);
});

test('JOINTS_0/WEIGHTS_0 are in range and normalized, and a meaningful share of vertices blend more than one joint', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  const jointCount = json.skins[0].joints.length;
  let totalVertices = 0, multiInfluence = 0, maxDrift = 0;
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
      for (const j of joints[i]) assert.ok(Number.isInteger(j) && j >= 0 && j < jointCount, `${mesh.name} JOINTS_0 index out of range`);
    }
  }
  assert.ok(maxDrift < 2e-3, `weight sums drift from 1.0 by up to ${maxDrift}`);
  const blendedFraction = multiInfluence / totalVertices;
  assert.ok(blendedFraction > 0.25,
    `only ${(blendedFraction * 100).toFixed(1)}% of vertices blend 2+ joints -- looks rigid-parented, not smoothly skinned`);
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

test('materials are opaque, textured (except the allowed eye), and expose exactly one tintable crew_accent slot', async () => {
  const { json } = await loadGlb();
  const names = json.materials.map(m => m.name);
  assert.deepEqual(names, ['brass', 'cloth_ivory', 'cloth_navy', 'crew_accent', 'eye', 'hair', 'leather', 'skin']);
  assert.equal(new Set(names).size, names.length, 'duplicate material name');
  assert.ok(names.length <= BUDGETS.maxMaterials, `${names.length} materials exceeds the ${BUDGETS.maxMaterials} budget`);
  for (const material of json.materials) {
    assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE', `${material.name} is not opaque`);
    if (material.name !== 'eye') assert.ok(material.pbrMetallicRoughness?.baseColorTexture, `${material.name} has no baseColorTexture`);
  }
  const crewAccent = json.materials.find(m => m.name === 'crew_accent');
  assert.ok(crewAccent.pbrMetallicRoughness.baseColorTexture, 'crew_accent has no base color texture to tint');
  const factor = crewAccent.pbrMetallicRoughness.baseColorFactor;
  assert.ok(Array.isArray(factor) && factor.length === 4 && factor.every(Number.isFinite), 'crew_accent baseColorFactor missing/non-finite');
  assert.ok(factor.every(c => c >= 0 && c <= 1), 'crew_accent baseColorFactor channel out of [0,1]');
  const measured = [0.0545, 0.3467, 0.3231];
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(factor[i] - measured[i]) < 0.01, `crew_accent baseColorFactor[${i}] drifted`);
});

test('embedded textures are real PNGs within the per-map size budget, and decoded memory matches exact mip arithmetic', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  assert.equal(json.images.length, 2, 'expected exactly one shared albedo atlas and one shared normal atlas');
  assert.ok(json.images.every(i => Number.isInteger(i.bufferView) && !i.uri), 'image is not embedded in the GLB');
  assert.ok(json.buffers.every(b => !b.uri), 'buffer references an external file instead of being embedded');
  let totalDecoded = 0;
  const byName = {};
  json.images.forEach((image, i) => {
    const { width, height } = pngDimensions(imageBytes(glb, i));
    assert.ok(width <= BUDGETS.maxImageDimension && height <= BUDGETS.maxImageDimension, `${image.name} exceeds the 2048px budget`);
    totalDecoded += decodedMipBytes(width, height);
    byName[image.name] = { width, height };
  });
  assert.deepEqual(byName, { navigator_normal: { width: 1024, height: 1024 }, navigator_albedo: { width: 2048, height: 2048 } });
  assert.equal(totalDecoded, 27962024);
  assert.ok(totalDecoded <= BUDGETS.maxDecodedTextureBytes, `${totalDecoded} decoded bytes exceeds the ${BUDGETS.maxDecodedTextureBytes} budget`);
  const manifest = await loadManifest();
  assert.equal(manifest.decodedTextureBytes, totalDecoded, 'manifest texture accounting has drifted from the shipped images');
});

test('idle, walk and rig_check clips exist exactly once with finite, time-ordered samplers and at least one moving channel each', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  const names = json.animations.map(a => a.name);
  assert.deepEqual([...names].sort(), [...REQUIRED_CLIPS].sort());
  assert.equal(new Set(names).size, names.length, 'duplicate clip name');
  const durations = {};
  for (const anim of json.animations) {
    let maxTime = -Infinity;
    for (const sampler of anim.samplers) {
      const times = readAccessor(glb, sampler.input).map(([t]) => t);
      assert.ok(times.every(Number.isFinite), `${anim.name} has a non-finite sampler time`);
      for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1], `${anim.name} sampler times are not ordered`);
      maxTime = Math.max(maxTime, ...times);
    }
    let moved = false;
    for (const channel of anim.channels) {
      const output = readAccessor(glb, anim.samplers[channel.sampler].output);
      assert.ok(output.every(row => row.every(Number.isFinite)), `${anim.name} has a non-finite channel value`);
      if (output.some(row => row.some((v, i) => Math.abs(v - output[0][i]) > 1e-5))) moved = true;
    }
    assert.ok(moved, `${anim.name} has no channel that actually changes -- a static pose exported as a clip`);
    durations[anim.name] = maxTime;
  }
  assert.ok(Math.abs(durations.idle - 4.0417) < 1e-3, `idle duration measured ${durations.idle}`);
  assert.ok(Math.abs(durations.walk - 1.0417) < 1e-3, `walk duration measured ${durations.walk}`);
  assert.ok(Math.abs(durations.rig_check - 2.0417) < 1e-3, `rig_check duration measured ${durations.rig_check}`);
});

test('attachment sockets exist exactly once and sit under their exact contractual ancestor bone', async () => {
  const { json } = await loadGlb();
  const nodeNames = json.nodes.map(n => n.name);
  const parents = parentIndex(json);
  const socketNames = nodeNames.filter(n => Object.prototype.hasOwnProperty.call(REQUIRED_SOCKETS, n));
  assert.deepEqual([...socketNames].sort(), [...Object.keys(REQUIRED_SOCKETS)].sort());
  for (const [name, ancestorBone] of Object.entries(REQUIRED_SOCKETS)) {
    const index = nodeNames.indexOf(name);
    assert.ok(index >= 0, `${name} socket node is missing`);
    const chain = ancestry(json, parents, index);
    assert.ok(chain.includes(ancestorBone), `${name} ancestry [${chain.join(' > ')}] does not include ${ancestorBone}`);
    assert.ok(chain.includes('SkywakeNavigator'), `${name} does not ultimately hang off the character root`);
  }
});

test('model bounds sit on the ground plane at the spec height, and named back sockets confirm the -Z forward convention', async () => {
  const glb = await loadGlb();
  const { json } = glb;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    for (const row of readAccessor(glb, primitive.attributes.POSITION)) {
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], row[i]); max[i] = Math.max(max[i], row[i]); }
    }
  }
  assert.ok(Math.abs(min[1]) < 0.02, `feet are not on the Y=0 ground plane: min Y ${min[1]}`);
  assert.ok(max[1] >= 2.65 && max[1] <= 2.9, `overall height ${max[1]}m is outside the spec's 2.65-2.9m tricorn-included range`);
  // "forward = -Z" is only checkable if something nameable is actually toward the back
  // (+Z). stow_back and the coat tails are specifically named for the back of the figure,
  // so their local translation along Z (relative to their parent bone) must be positive.
  for (const name of ['stow_back', 'coat_tail.L', 'coat_tail.R']) {
    const node = json.nodes.find(n => n.name === name);
    assert.ok(node?.translation, `${name} bone is missing a translation`);
    assert.ok(node.translation[2] > 0, `${name} sits toward -Z (the declared front) instead of +Z (the back)`);
  }
});

test('exported GLB carries no cameras, lights, or extensions needing a decoder Three r180 cannot supply', async () => {
  const { json } = await loadGlb();
  assert.ok(!json.extensionsRequired || json.extensionsRequired.length === 0, 'extensionsRequired must be empty');
  const used = json.extensionsUsed || [];
  for (const ext of used) assert.ok(!FORBIDDEN_EXTENSIONS.includes(ext), `${ext} needs a decoder Three r180 cannot supply directly`);
  assert.deepEqual(used, [], 'the shipped asset currently declares no glTF extensions at all');
  assert.ok(!json.cameras || json.cameras.length === 0, 'GLB contains a camera');
  for (const node of json.nodes) {
    assert.equal(node.camera, undefined, `${node.name} references a camera`);
    assert.ok(!node.extensions?.KHR_lights_punctual, `${node.name} references a light`);
  }
});

test('pinned MakeHuman CC0 anatomy source hashes to the exact upstream commit, independent of provenance.json', async () => {
  const bytes = await readFile(BASE_OBJ_URL);
  assert.equal(bytes.length, 1749303);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), PINNED_ANATOMY_SHA256);
});

test('manifest.json does not drift from the shipped GLB: materials, joints, sockets, clip shapes and budgets all agree', async () => {
  const { json } = await loadGlb();
  const manifest = await loadManifest();
  assert.deepEqual(manifest.budgets, BUDGETS, 'manifest budgets differ from the WP-1 spec contract');
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
  assert.deepEqual([...manifest.sockets.map(s => s.name)].sort(), Object.keys(REQUIRED_SOCKETS).sort());
  assert.equal(manifest.rootNode, 'SkywakeNavigator');
  assert.equal(manifest.forward, '-Z');
  assert.equal(manifest.tintableMaterial, 'crew_accent');
  assert.equal(manifest.triangles, 35656);
});
