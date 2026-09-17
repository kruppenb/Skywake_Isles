import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const asset = new URL('../client/assets/player-character/navigator-female.glb', import.meta.url);
const manifestFile = new URL('../client/assets/player-character/female-manifest.json', import.meta.url);
const bytes = await readFile(asset);
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));

function parseGlb(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binaryHeader = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(binaryHeader + 4), 0x004e4942);
  const binaryOffset = binaryHeader + 8;
  assert.equal(binaryOffset + bytes.readUInt32LE(binaryHeader), bytes.length);
  return { json, binaryOffset };
}

const glb = parseGlb(bytes);
const { json, binaryOffset } = glb;
const components = { 5121: ['readUInt8', 1], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4] };
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(index) {
  const a = json.accessors[index], v = json.bufferViews[a.bufferView];
  const [read, size] = components[a.componentType], width = widths[a.type];
  const stride = v.byteStride || width * size;
  const start = binaryOffset + (v.byteOffset || 0) + (a.byteOffset || 0);
  assert.ok(start + (a.count - 1) * stride + width * size <= bytes.length);
  return Array.from({ length: a.count }, (_, row) =>
    Array.from({ length: width }, (_, column) => bytes[read](start + row * stride + column * size)));
}
const parent = new Map();
json.nodes.forEach((node, index) => node.children?.forEach(child => parent.set(child, index)));
const nodeByName = name => json.nodes.findIndex(node => node.name === name);

function decodePngRgba(image) {
  const view = json.bufferViews[image.bufferView];
  const start = binaryOffset + (view.byteOffset || 0);
  const png = bytes.subarray(start, start + view.byteLength);
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6);
  assert.equal(png[28], 0);
  const compressed = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') compressed.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
    if (type === 'IEND') break;
  }
  const rows = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(width * height * 4), stride = width * 4;
  for (let y = 0; y < height; y++) {
    const filter = rows[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = rows[y * (stride + 1) + 1 + x];
      const i = y * stride + x;
      const left = x >= 4 ? pixels[i - 4] : 0;
      const above = y ? pixels[i - stride] : 0;
      const upperLeft = y && x >= 4 ? pixels[i - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = (left + above) >> 1;
      else if (filter === 4) {
        const base = left + above - upperLeft;
        const da = Math.abs(base - left), db = Math.abs(base - above), dc = Math.abs(base - upperLeft);
        predictor = da <= db && da <= dc ? left : db <= dc ? above : upperLeft;
      } else assert.equal(filter, 0);
      pixels[i] = (value + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

test('female navigator identity and budget', () => {
  assert.equal(manifest.glb, 'navigator-female.glb');
  assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(manifest.bytes, bytes.length);
  assert.ok(bytes.length <= 8 * 1024 * 1024, `${bytes.length} bytes`);
  assert.equal(json.nodes[json.scenes[json.scene ?? 0].nodes[0]].name, 'SkywakeNavigator');
  assert.equal(json.skins.length, 1);
  assert.equal(json.cameras?.length || 0, 0);
  assert.equal(json.extensionsRequired?.length || 0, 0);
});

test('Mixamo rig and five sockets are present', () => {
  const joints = json.skins[0].joints.map(i => json.nodes[i].name);
  for (const name of ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm',
    'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg',
    'RightLeg', 'RightFoot']) assert.ok(joints.includes(name), `missing ${name}`);
  for (const [name, expectedParent] of [
    ['weapon_grip.L', 'LeftHand'], ['weapon_grip.R', 'RightHand'],
    ['glider_grip.L', 'LeftHand'], ['glider_grip.R', 'RightHand'], ['stow_back', 'Spine'],
  ]) {
    const index = nodeByName(name);
    assert.ok(index >= 0, `missing ${name}`);
    assert.equal(json.nodes[parent.get(index)].name, expectedParent);
  }
  assert.deepEqual(new Set(joints).size, joints.length);
  assert.deepEqual(manifest.joints, joints);
});

test('geometry is finite, skinned and within the character budget', () => {
  let triangles = 0, vertices = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4, 4);
    const indices = accessor(primitive.indices);
    assert.equal(indices.length % 3, 0);
    triangles += indices.length / 3;
    const positions = accessor(primitive.attributes.POSITION);
    const normals = accessor(primitive.attributes.NORMAL);
    const weights = accessor(primitive.attributes.WEIGHTS_0);
    const joints = accessor(primitive.attributes.JOINTS_0);
    const uvs = accessor(primitive.attributes.TEXCOORD_0);
    vertices += positions.length;
    assert.equal(positions.length, weights.length);
    assert.equal(positions.length, normals.length);
    assert.equal(positions.length, joints.length);
    assert.equal(positions.length, uvs.length);
    for (const p of positions) p.forEach((v, axis) => {
      assert.ok(Number.isFinite(v)); lo[axis] = Math.min(lo[axis], v); hi[axis] = Math.max(hi[axis], v);
    });
    assert.ok(normals.every(n => n.every(Number.isFinite)));
    for (let i = 0; i < weights.length; i++) {
      assert.ok(weights[i].every(w => Number.isFinite(w) && w >= -0.0001 && w <= 1.0001));
      assert.ok(Math.abs(weights[i].reduce((a, b) => a + b, 0) - 1) < 0.002);
      assert.ok(joints[i].every(j => j < json.skins[0].joints.length));
      assert.ok(uvs[i].every(v => Number.isFinite(v) && v >= -0.001 && v <= 1.001));
    }
  }
  assert.ok(vertices > 10000);
  assert.ok(triangles <= 50000, `${triangles} triangles`);
  assert.ok(hi[1] - lo[1] >= 2.65 && hi[1] - lo[1] <= 2.9);
  assert.ok(Math.abs(lo[1]) < 0.02);
  assert.equal(manifest.triangles, triangles);
});

test('crew tint uses an embedded RGBA atlas on opaque material', () => {
  assert.ok(json.materials.length >= 1);
  assert.ok(json.images.length >= 1);
  for (const material of json.materials) {
    assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE');
    assert.equal(material.extras?.crewMask, 'baseColorAlpha');
    assert.equal(material.extras?.crewReference?.length, 3);
    assert.ok(material.pbrMetallicRoughness?.baseColorTexture);
  }
  for (const image of json.images) {
    assert.equal(image.mimeType, 'image/png');
    const { width, height, pixels } = decodePngRgba(image);
    assert.ok(width >= 1024 && height >= 1024);
    let tinted = 0, feathered = 0;
    for (let at = 3; at < pixels.length; at += 4) {
      if (pixels[at] > 128) tinted++;
      if (pixels[at] > 0 && pixels[at] < 255) feathered++;
    }
    const coverage = tinted / (width * height);
    assert.ok(coverage > 0.02 && coverage < 0.2, `crew mask coverage ${coverage}`);
    assert.ok(feathered > 100, 'crew mask needs anti-aliased boundaries');
    // Facial skin must stay untinted. Sample only vertices strongly bound to the Head joint,
    // avoiding shared chart borders and the ponytail's blend at the neck.
    const head = json.skins[0].joints.findIndex(i => json.nodes[i].name === 'Head');
    let faceSamples = 0, tintedFaceSamples = 0;
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
      const jointRows = accessor(primitive.attributes.JOINTS_0);
      const weightRows = accessor(primitive.attributes.WEIGHTS_0);
      const uvRows = accessor(primitive.attributes.TEXCOORD_0);
      for (let i = 0; i < jointRows.length; i++) {
        const headWeight = jointRows[i].reduce((sum, joint, slot) => sum + (joint === head ? weightRows[i][slot] : 0), 0);
        if (headWeight < 0.8) continue;
        const x = Math.min(width - 1, Math.max(0, Math.floor(uvRows[i][0] * width)));
        const y = Math.min(height - 1, Math.max(0, Math.floor(uvRows[i][1] * height)));
        faceSamples++;
        if (pixels[(y * width + x) * 4 + 3] > 128) tintedFaceSamples++;
      }
    }
    assert.ok(faceSamples > 100);
    assert.ok(tintedFaceSamples / faceSamples < 0.02,
      `${tintedFaceSamples}/${faceSamples} head-bound vertices tinted`);
  }
  assert.equal(manifest.crewTint.convention, 'baseColorAlpha');
});

test('female chin and jaw texture stay clean-shaven', () => {
  const head = json.skins[0].joints.findIndex(i => json.nodes[i].name === 'Head');
  let samples = 0;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    const material = json.materials[primitive.material];
    const texture = json.textures[material.pbrMetallicRoughness.baseColorTexture.index];
    const { width, height, pixels } = decodePngRgba(json.images[texture.source]);
    const positions = accessor(primitive.attributes.POSITION);
    const joints = accessor(primitive.attributes.JOINTS_0);
    const weights = accessor(primitive.attributes.WEIGHTS_0);
    const uvs = accessor(primitive.attributes.TEXCOORD_0);
    for (let i = 0; i < positions.length; i++) {
      const [x, y, z] = positions[i];
      const headWeight = joints[i].reduce((sum, joint, slot) => sum + (joint === head ? weights[i][slot] : 0), 0);
      // Measured skin below the lower lip in the shipped 2.75 m asset, including the jaw's
      // downward-facing polygons. Keep lips, side locks and neckline out of this sample.
      if (headWeight < .8 || Math.abs(x) > .07 || y < 2.24 || y > 2.28 || z > -.12) continue;
      const u = Math.min(width - 1, Math.max(0, Math.floor(uvs[i][0] * width)));
      const v = Math.min(height - 1, Math.max(0, Math.floor(uvs[i][1] * height)));
      const at = (v * width + u) * 4;
      const brightness = pixels[at] * .299 + pixels[at + 1] * .587 + pixels[at + 2] * .114;
      assert.ok(brightness > 135, `dark facial-hair patch at chin vertex ${i}: ${brightness}`);
      assert.ok(pixels[at + 3] < 16, 'crew colour must not turn the chin into a beard');
      samples++;
    }
  }
  assert.ok(samples > 30, `expected a useful chin sample, got ${samples}`);
});

test('idle, walk and run clips animate the character', () => {
  assert.deepEqual(json.animations.map(a => a.name).sort(), ['idle', 'run', 'walk']);
  for (const animation of json.animations) {
    assert.ok(animation.channels.length >= 60, `${animation.name} channels`);
    assert.ok(animation.channels.some(c => c.target.path === 'rotation'));
    let duration = 0, rotating = false;
    for (const sampler of animation.samplers) {
      const times = accessor(sampler.input).map(row => row[0]);
      assert.ok(times.every(Number.isFinite));
      assert.ok(times.every((t, i) => i === 0 || t >= times[i - 1]));
      duration = Math.max(duration, times.at(-1));
      const values = accessor(sampler.output);
      assert.ok(values.every(row => row.every(Number.isFinite)));
      if (values.length > 1 && values.some(row => row.some((v, axis) => Math.abs(v - values[0][axis]) > 0.01))) {
        rotating = true;
      }
    }
    assert.ok(duration > 0.2, `${animation.name} duration`);
    assert.ok(rotating, `${animation.name} must contain real motion`);
  }
});
