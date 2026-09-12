import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Binary-contract tests for the shipped gun GLBs in client/assets/weapons/ (the Meshy-built props
// that client/weapon-models.js swaps over buildWeapon's procedural guns). This file owns its own
// minimal glTF-binary reader plus PNG-IHDR and JPEG-SOF header parsing; it imports nothing from
// the runtime, from three.js or from tools/meshy/. Sizes, hashes and triangle counts are read from
// client/assets/weapons/manifest.json and checked against the shipped bytes, so adding the next
// gun needs no edit here: every kind listed in the manifest is put through the same contract.
//
// Gun space (client/models.js buildWeapon, and the table in the weapon spec): -Z is forward, the
// muzzle direction; +Y is up; +X is the gun's right side, the lock-plate/hammer side. Units are
// the procedural pirate's, so the numbers below are the procedural flintlock's own landmarks.

const WEAPONS_DIR = new URL('../client/assets/weapons/', import.meta.url);
const MANIFEST_URL = new URL('manifest.json', WEAPONS_DIR);
const MANIFEST_PATH = 'client/assets/weapons/manifest.json';

const BUDGETS = {
  maxGlbBytes: 3 * 1024 * 1024, maxBodyTriangles: 9000, maxActionTriangles: 1500,
  maxImageDimension: 1024, maxEmbeddedImageBytes: 2 * 1024 * 1024, maxMetallicFactor: .05,
};
// Gun-space envelope and landmarks, from the approved concept: a raked grip about half the
// procedural grip's height, the bore running to a muzzle at z = -1.0.
const CONTRACT = {
  bounds: { zMin: [-1.12, -.92], zMax: .50, yMin: [-.60, -.22], yMax: .50, absX: .22 },
  muzzle: { zBelowMin: -.02, zAboveMin: .06, y: [.08, .18], absX: .03 },
  grip: { band: [-.24, -.14], absCentroidX: .05, centroidZ: [-.02, .30], extentX: .30, extentZ: .36 },
  barrel: { band: [-.90, -.60], centroidY: [.05, .20], absCentroidX: .03, extentX: .22, extentY: .34 },
  action: { reach: .30, y: [.10, .55] },
};
const ALLOWED_EXTENSIONS = ['KHR_materials_specular', 'KHR_materials_ior'];
const COMPONENT_TYPES = { 5120: ['readInt8', 1], 5121: ['readUInt8', 1], 5122: ['readInt16LE', 2], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4] };
const TYPE_WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

// ------------------------------------------------------------- binary readers --
function parseGlb(bytes, label) {
  assert.ok(bytes.length >= 20, `${label}: file is too short to be a GLB`);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${label}: GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${label}: binary glTF version must be 2`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${label}: header length field must match the actual file size`);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(jsonLength % 4, 0, `${label}: JSON chunk length must be 4-byte aligned`);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${label}: first chunk type must be JSON`);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  assert.equal(json.asset?.version, '2.0', `${label}: asset version`);
  const binHeader = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(binHeader);
  assert.equal(binLength % 4, 0, `${label}: BIN chunk length must be 4-byte aligned`);
  assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942, `${label}: second chunk type must be BIN`);
  const binOffset = binHeader + 8;
  assert.equal(binOffset + binLength, bytes.length, `${label}: JSON+BIN chunks must account for every byte, no trailing chunk`);
  return { json, bytes, binOffset, binLength, label };
}

// Reads an accessor straight off bufferView/accessor byteOffset+stride maths rather than trusting
// accessor.min/max, so every bound below is measured from real vertex bytes.
function readAccessor({ json, bytes, binOffset, binLength, label }, index) {
  const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView];
  const [read, size] = COMPONENT_TYPES[accessor.componentType], width = TYPE_WIDTH[accessor.type];
  const stride = view.byteStride || width * size;
  const base = binOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  assert.ok(base + Math.max(0, accessor.count - 1) * stride + width * size <= binOffset + binLength,
    `${label}: accessor ${index} reads past the end of the BIN chunk`);
  return Array.from({ length: accessor.count }, (_, i) =>
    Array.from({ length: width }, (_, c) => bytes[read](base + i * stride + c * size)));
}

function imageBytes({ json, bytes, binOffset }, index) {
  const image = json.images[index];
  const view = json.bufferViews[image.bufferView];
  const start = binOffset + (view.byteOffset || 0);
  return bytes.subarray(start, start + view.byteLength);
}

function pngHeader(blob, label) {
  assert.equal(blob.toString('ascii', 12, 16), 'IHDR', `${label}: PNG does not lead with an IHDR chunk`);
  return { width: blob.readUInt32BE(16), height: blob.readUInt32BE(20), format: 'image/png' };
}

// Walks the JPEG marker chain to the first start-of-frame; SOF carries height then width.
function jpegHeader(blob, label) {
  for (let offset = 2; offset + 4 <= blob.length;) {
    if (blob[offset] !== 0xff) { offset++; continue; }
    const marker = blob[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
    const length = blob.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      assert.ok(offset + 9 <= blob.length, `${label}: truncated JPEG frame header`);
      return { width: blob.readUInt16BE(offset + 7), height: blob.readUInt16BE(offset + 5), format: 'image/jpeg' };
    }
    offset += 2 + length;
  }
  return assert.fail(`${label}: JPEG has no start-of-frame header`);
}

function decodeImageHeader(blob, label) {
  if (blob.length >= 8 && blob.toString('hex', 0, 8) === '89504e470d0a1a0a') return pngHeader(blob, label);
  if (blob.length >= 4 && blob.readUInt16BE(0) === 0xffd8) return jpegHeader(blob, label);
  return assert.fail(`${label}: embedded image is neither a PNG nor a JPEG`);
}

// ---------------------------------------------------------------- glTF walks --
function nodeIndexByName(json, name) {
  return json.nodes.findIndex(node => node.name === name);
}

function isIdentityTrs(node) {
  const t = node.translation || [0, 0, 0], r = node.rotation || [0, 0, 0, 1], s = node.scale || [1, 1, 1];
  return node.matrix === undefined && t.every(v => Math.abs(v) < 1e-6)
    && Math.abs(r[0]) < 1e-6 && Math.abs(r[1]) < 1e-6 && Math.abs(r[2]) < 1e-6 && Math.abs(Math.abs(r[3]) - 1) < 1e-6
    && s.every(v => Math.abs(v - 1) < 1e-6);
}

function primitivesOf(glb, node) {
  return node?.mesh === undefined ? [] : glb.json.meshes[node.mesh].primitives;
}

function trianglesOf(glb, primitives) {
  let triangles = 0;
  for (const primitive of primitives) {
    assert.ok(primitive.indices !== undefined, `${glb.label}: a primitive is not indexed`);
    const indices = readAccessor(glb, primitive.indices);
    assert.equal(indices.length % 3, 0, `${glb.label}: index count is not a multiple of 3`);
    triangles += indices.length / 3;
  }
  return triangles;
}

// Gun-space vertices of one node's primitives: the contract keeps every node axis-aligned and
// unscaled, so the node's own translation is all that separates local vertices from gun space.
function gunSpaceVertices(glb, node) {
  const offset = node?.translation || [0, 0, 0];
  const out = [];
  for (const primitive of primitivesOf(glb, node)) {
    for (const row of readAccessor(glb, primitive.attributes.POSITION)) {
      out.push([row[0] + offset[0], row[1] + offset[1], row[2] + offset[2]]);
    }
  }
  return out;
}

function extentsOf(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], sum = [0, 0, 0];
  for (const point of points) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], point[i]); max[i] = Math.max(max[i], point[i]); sum[i] += point[i];
  }
  return { min, max, centroid: sum.map(v => v / (points.length || 1)), count: points.length };
}

const inRange = (value, [low, high]) => value >= low && value <= high;
const show = value => Number(value).toFixed(4);

// ------------------------------------------------------------------- loading --
let manifest = null, manifestFailure = null;
try {
  manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'));
} catch (error) {
  manifestFailure = `weapon asset manifest missing: ${MANIFEST_PATH} (${error.code || error.name}). `
    + 'Ship WP-2 first: tools/meshy/build_weapon.py writes client/assets/weapons/<kind>.glb and '
    + 'tools/meshy/weapon-manifest.mjs writes the manifest this contract is measured against.';
}

const kinds = manifest && manifest.weapons && typeof manifest.weapons === 'object' ? Object.keys(manifest.weapons) : [];
const shipped = new Map();
for (const kind of kinds) {
  const file = typeof manifest.weapons[kind]?.glb === 'string' ? manifest.weapons[kind].glb : `${kind}.glb`;
  try {
    shipped.set(kind, await readFile(new URL(file, WEAPONS_DIR)));
  } catch (error) {
    shipped.set(kind, `weapon asset missing: client/assets/weapons/${file} — the manifest lists "${kind}" `
      + `but the file is not on disk (${error.code || error.name}). Re-run tools/meshy/build_weapon.py for ${kind}.`);
  }
}

// ---------------------------------------------------------------- the contract --
if (manifestFailure) {
  test('client/assets/weapons ships a manifest describing every gun GLB', () => { assert.fail(manifestFailure); });
} else {
  test('the manifest is a schema-1 index of at least the flintlock', () => {
    assert.equal(manifest.schemaVersion, 1, 'manifest schemaVersion');
    assert.ok(kinds.length > 0, `weapon asset manifest missing: ${MANIFEST_PATH} lists no weapons`);
    assert.ok(kinds.includes('flintlock'), 'gun 1, the flintlock, must be in the manifest');
  });

  for (const kind of kinds) describeKind(kind);
}

function describeKind(kind) {
  const entry = manifest.weapons[kind];
  const bytes = shipped.get(kind);
  if (typeof bytes === 'string') {
    test(`${kind}: the GLB named by the manifest is on disk`, () => { assert.fail(bytes); });
    return;
  }
  const label = `${kind}.glb`;
  const glb = () => parseGlb(bytes, label);

  test(`${kind}: the GLB is a well-formed binary glTF whose size and hash the manifest pins`, () => {
    glb();
    assert.equal(entry.glb, `${kind}.glb`, 'manifest glb filename');
    assert.equal(entry.bytes, bytes.length, 'manifest byte count has drifted from the shipped file');
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'), 'manifest hash has drifted from the shipped file');
    assert.ok(bytes.length <= BUDGETS.maxGlbBytes, `${bytes.length} bytes exceeds the ${BUDGETS.maxGlbBytes} GLB budget`);
  });

  test(`${kind}: the scene is the flat gun-space rig — one ${kind} root over body/action/muzzle, no rig and no scene extras`, () => {
    const { json } = glb();
    const sceneIndex = json.scene ?? 0;
    assert.equal(json.scenes[sceneIndex].nodes.length, 1, 'exactly one scene root node');
    const rootIndex = json.scenes[sceneIndex].nodes[0], root = json.nodes[rootIndex];
    assert.equal(root.name, kind, 'the scene root must be named for the gun kind');
    assert.ok(isIdentityTrs(root), `the ${kind} root must carry an identity TRS so its children are already gun space`);
    const children = (root.children || []).map(index => json.nodes[index]);
    const names = children.map(node => node.name);
    assert.ok(names.includes('body'), `${kind} has no body node`);
    assert.ok(names.includes('muzzle'), `${kind} has no muzzle node`);
    assert.ok(names.every(name => ['body', 'action', 'muzzle'].includes(name)), `unexpected root children: ${names.join(', ')}`);
    assert.equal(new Set(names).size, names.length, 'duplicate child node name');
    const body = children.find(node => node.name === 'body');
    assert.ok(body.mesh !== undefined, 'body must carry a mesh');
    assert.ok(isIdentityTrs(body), 'body must carry an identity TRS: its vertices are gun space');
    const muzzle = children.find(node => node.name === 'muzzle');
    assert.equal(muzzle.mesh, undefined, 'muzzle must be an empty node, not a mesh');
    assert.ok(!muzzle.children?.length, 'muzzle must be a leaf');
    const action = children.find(node => node.name === 'action');
    if (action) {
      assert.ok(action.mesh !== undefined, 'an action node must carry a mesh');
      assert.ok(!action.rotation || (Math.abs(action.rotation[0]) < 1e-6 && Math.abs(action.rotation[1]) < 1e-6
        && Math.abs(action.rotation[2]) < 1e-6 && Math.abs(Math.abs(action.rotation[3]) - 1) < 1e-6),
        'the action node rotation must be identity; the hinge axis lives in extras');
      assert.ok(!action.scale || action.scale.every(s => Math.abs(s - 1) < 1e-6), 'the action node must be unscaled');
    }
    // Nothing that needs a rig, a clock or a decoder three.js r180 cannot supply.
    assert.ok(!json.skins?.length, 'a gun prop must have no skins');
    assert.ok(!json.animations?.length, 'a gun prop must have no animations');
    assert.ok(!json.cameras?.length, 'GLB contains a camera');
    for (const node of json.nodes) assert.ok(!node.extensions?.KHR_lights_punctual, `${node.name} references a light`);
    assert.ok(!json.extensionsRequired?.length, 'extensionsRequired must be empty');
    for (const extension of json.extensionsUsed || []) {
      assert.ok(ALLOWED_EXTENSIONS.includes(extension), `${extension} is outside the allowed Blender Principled export extensions`);
    }
    assert.ok(json.buffers.every(buffer => !buffer.uri), 'buffer references an external file instead of being embedded');
  });

  test(`${kind}: body and action are finite triangle lists inside budget, with normals and atlas UVs`, () => {
    const parsed = glb();
    const { json } = parsed;
    const byName = name => json.nodes[nodeIndexByName(json, name)];
    const bodyNode = byName('body'), actionNode = nodeIndexByName(json, 'action') >= 0 ? byName('action') : null;
    const bodyPrimitives = primitivesOf(parsed, bodyNode), actionPrimitives = primitivesOf(parsed, actionNode);
    assert.ok(bodyPrimitives.length >= 1 && bodyPrimitives.length <= 2, 'body is the textured primitive plus at most one fill primitive');
    assert.ok(actionPrimitives.length <= 2, 'action is the textured primitive plus at most one fill primitive');
    for (const primitive of [...bodyPrimitives, ...actionPrimitives]) {
      assert.equal(primitive.mode ?? 4, 4, 'every primitive must be TRIANGLES');
      assert.ok('POSITION' in primitive.attributes && 'NORMAL' in primitive.attributes, 'a primitive is missing POSITION or NORMAL');
      const positions = readAccessor(parsed, primitive.attributes.POSITION);
      assert.ok(positions.every(row => row.every(Number.isFinite)), 'non-finite position');
      assert.ok(readAccessor(parsed, primitive.attributes.NORMAL).every(row => row.every(Number.isFinite)), 'non-finite normal');
      const indices = readAccessor(parsed, primitive.indices).map(([i]) => i);
      assert.ok(indices.every(i => Number.isInteger(i) && i >= 0 && i < positions.length), 'out-of-range index');
      const textured = json.materials[primitive.material]?.pbrMetallicRoughness?.baseColorTexture !== undefined;
      if (!textured) continue;
      assert.ok('TEXCOORD_0' in primitive.attributes, 'a textured primitive has no UVs');
      const uvs = readAccessor(parsed, primitive.attributes.TEXCOORD_0);
      assert.ok(uvs.every(row => row.every(Number.isFinite)), 'non-finite UV');
      assert.ok(uvs.every(([u, v]) => u >= -.01 && u <= 1.01 && v >= -.01 && v <= 1.01), 'textured UVs outside the atlas');
    }
    const bodyTriangles = trianglesOf(parsed, bodyPrimitives), actionTriangles = trianglesOf(parsed, actionPrimitives);
    assert.ok(bodyTriangles > 0, 'the body draws nothing');
    assert.ok(bodyTriangles <= BUDGETS.maxBodyTriangles, `body ${bodyTriangles} triangles exceeds the ${BUDGETS.maxBodyTriangles} budget`);
    assert.ok(actionTriangles <= BUDGETS.maxActionTriangles, `action ${actionTriangles} triangles exceeds the ${BUDGETS.maxActionTriangles} budget`);
    assert.equal(entry.triangles?.body, bodyTriangles, 'manifest body triangle count has drifted');
    assert.equal(entry.triangles?.action ?? 0, actionTriangles, 'manifest action triangle count has drifted');
  });

  test(`${kind}: every material is opaque and unpainted-metal, over exactly one small embedded albedo`, () => {
    const parsed = glb();
    const { json } = parsed;
    assert.ok(json.materials?.length >= 1, 'no materials');
    for (const material of json.materials) {
      assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE', `${material.name} must stay OPAQUE`);
      const metallic = material.pbrMetallicRoughness?.metallicFactor ?? 1;
      assert.ok(metallic <= BUDGETS.maxMetallicFactor, `${material.name} metallicFactor ${metallic} exceeds ${BUDGETS.maxMetallicFactor}`);
      assert.equal(material.emissiveTexture, undefined, `${material.name} keeps Meshy's albedo-as-emission wiring (it renders unlit)`);
    }
    assert.deepEqual(entry.materialNames, json.materials.map(m => m.name), 'manifest materialNames have drifted');
    const bodyNode = json.nodes[nodeIndexByName(json, 'body')];
    const main = json.materials[primitivesOf(parsed, bodyNode)[0].material];
    assert.ok(main?.pbrMetallicRoughness?.baseColorTexture, "the body's main material has no baseColorTexture");
    for (const node of ['body', 'action']) {
      const index = nodeIndexByName(json, node);
      if (index < 0) continue;
      const primitives = primitivesOf(parsed, json.nodes[index]);
      if (primitives.length < 2) continue;
      const fill = json.materials[primitives[1].material];
      assert.equal(fill.pbrMetallicRoughness?.baseColorTexture, undefined, `${node}'s fill material must be untextured`);
      const colour = fill.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
      assert.ok(colour.slice(0, 3).every(c => c <= .15), `${node}'s fill material must be the dark cut-face colour, got ${colour.slice(0, 3).map(show).join(', ')}`);
    }
    assert.equal(json.images?.length, 1, 'expected exactly one embedded albedo');
    assert.ok(json.images.every(image => Number.isInteger(image.bufferView) && !image.uri), 'image is not embedded in the GLB');
    const blob = imageBytes(parsed, 0);
    const { width, height, format } = decodeImageHeader(blob, label);
    assert.ok(width <= BUDGETS.maxImageDimension && height <= BUDGETS.maxImageDimension,
      `albedo ${width}x${height} exceeds the ${BUDGETS.maxImageDimension} budget`);
    assert.ok(blob.length <= BUDGETS.maxEmbeddedImageBytes, `embedded albedo ${blob.length} bytes exceeds ${BUDGETS.maxEmbeddedImageBytes}`);
    assert.equal(json.images[0].mimeType, format, 'declared mimeType disagrees with the embedded bytes');
    assert.equal(entry.images?.length, 1, 'manifest image count has drifted');
    const recorded = entry.images[0];
    assert.equal(typeof recorded.name, 'string', 'manifest image name');
    assert.equal(recorded.mimeType, format, 'manifest image mimeType has drifted');
    assert.equal(recorded.width, width, 'manifest image width has drifted');
    assert.equal(recorded.height, height, 'manifest image height has drifted');
    assert.equal(recorded.embeddedBytes, blob.length, 'manifest embeddedBytes has drifted');
  });

  test(`${kind}: gun-space bounds, muzzle, grip and barrel land where the procedural gun's do`, () => {
    const parsed = glb();
    const { json } = parsed;
    const bodyNode = json.nodes[nodeIndexByName(json, 'body')];
    const actionIndex = nodeIndexByName(json, 'action');
    const actionNode = actionIndex >= 0 ? json.nodes[actionIndex] : null;
    const bodyPoints = gunSpaceVertices(parsed, bodyNode);
    const all = [...bodyPoints, ...gunSpaceVertices(parsed, actionNode)];
    const { min, max } = extentsOf(all);
    const { bounds, muzzle: muzzleRule, grip, barrel } = CONTRACT;
    assert.ok(inRange(min[2], bounds.zMin), `z_min ${show(min[2])} is outside ${bounds.zMin.join('..')}: the muzzle is not at the bore end`);
    assert.ok(max[2] <= bounds.zMax, `z_max ${show(max[2])} runs past ${bounds.zMax} behind the grip`);
    assert.ok(inRange(min[1], bounds.yMin), `y_min ${show(min[1])} is outside ${bounds.yMin.join('..')}: the grip is the wrong depth`);
    assert.ok(max[1] <= bounds.yMax, `y_max ${show(max[1])} rises past ${bounds.yMax}`);
    assert.ok(Math.max(Math.abs(min[0]), Math.abs(max[0])) <= bounds.absX,
      `|x| reaches ${show(Math.max(Math.abs(min[0]), Math.abs(max[0])))}, past the ${bounds.absX} half-width`);

    const muzzleNode = json.nodes[nodeIndexByName(json, 'muzzle')];
    const muzzle = muzzleNode.translation || [0, 0, 0];
    assert.ok(inRange(muzzle[2], [min[2] + muzzleRule.zBelowMin, min[2] + muzzleRule.zAboveMin]),
      `muzzle z ${show(muzzle[2])} is not at the barrel's end (z_min ${show(min[2])})`);
    assert.ok(inRange(muzzle[1], muzzleRule.y), `muzzle y ${show(muzzle[1])} is off the bore axis`);
    assert.ok(Math.abs(muzzle[0]) <= muzzleRule.absX, `muzzle x ${show(muzzle[0])} is off centre`);

    const gripPoints = bodyPoints.filter(([, y]) => y >= grip.band[0] && y <= grip.band[1]);
    assert.ok(gripPoints.length > 0, `no body vertices in the grip band y ${grip.band.join('..')}`);
    const gripBox = extentsOf(gripPoints);
    assert.ok(Math.abs(gripBox.centroid[0]) <= grip.absCentroidX, `grip centroid x ${show(gripBox.centroid[0])} is off centre`);
    assert.ok(inRange(gripBox.centroid[2], grip.centroidZ), `grip centroid z ${show(gripBox.centroid[2])} is outside ${grip.centroidZ.join('..')}`);
    assert.ok(gripBox.max[0] - gripBox.min[0] <= grip.extentX, `grip is ${show(gripBox.max[0] - gripBox.min[0])} wide, past ${grip.extentX}`);
    assert.ok(gripBox.max[2] - gripBox.min[2] <= grip.extentZ, `grip is ${show(gripBox.max[2] - gripBox.min[2])} deep, past ${grip.extentZ}`);

    const barrelPoints = bodyPoints.filter(([, , z]) => z >= barrel.band[0] && z <= barrel.band[1]);
    assert.ok(barrelPoints.length > 0, `no body vertices in the barrel band z ${barrel.band.join('..')}`);
    const barrelBox = extentsOf(barrelPoints);
    assert.ok(inRange(barrelBox.centroid[1], barrel.centroidY), `barrel centroid y ${show(barrelBox.centroid[1])} is outside ${barrel.centroidY.join('..')}`);
    assert.ok(Math.abs(barrelBox.centroid[0]) <= barrel.absCentroidX, `barrel centroid x ${show(barrelBox.centroid[0])} is off centre`);
    assert.ok(barrelBox.max[0] - barrelBox.min[0] <= barrel.extentX, `barrel is ${show(barrelBox.max[0] - barrelBox.min[0])} wide, past ${barrel.extentX}`);
    assert.ok(barrelBox.max[1] - barrelBox.min[1] <= barrel.extentY, `barrel is ${show(barrelBox.max[1] - barrelBox.min[1])} tall, past ${barrel.extentY}`);

    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(entry.bounds.min[i] - min[i]) < 1e-3 && Math.abs(entry.bounds.max[i] - max[i]) < 1e-3,
        `manifest bounds drifted from the vertex data on axis ${'xyz'[i]}`);
      assert.ok(Math.abs(entry.muzzle[i] - muzzle[i]) < 1e-3, `manifest muzzle drifted on axis ${'xyz'[i]}`);
    }
    assert.equal(entry.nodes?.body, 'body', 'manifest node name for the body');
    assert.equal(entry.nodes?.muzzle, 'muzzle', 'manifest node name for the muzzle');
    assert.equal(entry.nodes?.action ?? null, actionNode ? 'action' : null, 'manifest node name for the action');
  });

  test(`${kind}: the action hinges about a unit axis through a pivot inside the body`, () => {
    const parsed = glb();
    const { json } = parsed;
    const actionIndex = nodeIndexByName(json, 'action');
    if (actionIndex < 0) {
      // A gun whose moving part could not be separated cleanly ships without one; the manifest
      // must then say so, and client/weapon-models.js leaves an empty hinge.
      assert.equal(entry.hingePivot ?? null, null, `${kind} has no action node but the manifest records a hinge pivot`);
      assert.equal(entry.hingeAxis ?? null, null, `${kind} has no action node but the manifest records a hinge axis`);
      assert.equal(entry.triangles?.action ?? 0, 0, `${kind} has no action node but the manifest counts action triangles`);
      return;
    }
    const actionNode = json.nodes[actionIndex];
    const pivot = actionNode.translation || [0, 0, 0];
    const bodyBox = extentsOf(gunSpaceVertices(parsed, json.nodes[nodeIndexByName(json, 'body')]));
    for (let i = 0; i < 3; i++) {
      assert.ok(pivot[i] >= bodyBox.min[i] - 1e-6 && pivot[i] <= bodyBox.max[i] + 1e-6,
        `hinge pivot ${'xyz'[i]} ${show(pivot[i])} sits outside the body bounds ${show(bodyBox.min[i])}..${show(bodyBox.max[i])}`);
    }
    let reach = 0, minY = Infinity, maxY = -Infinity;
    for (const primitive of primitivesOf(parsed, actionNode)) {
      for (const [x, y, z] of readAccessor(parsed, primitive.attributes.POSITION)) {
        reach = Math.max(reach, Math.hypot(x, y, z));
        minY = Math.min(minY, y + pivot[1]); maxY = Math.max(maxY, y + pivot[1]);
      }
    }
    assert.ok(reach <= CONTRACT.action.reach, `an action vertex is ${show(reach)} from the pivot, past ${CONTRACT.action.reach}: the split caught barrel or stock faces`);
    assert.ok(inRange(minY, CONTRACT.action.y) && inRange(maxY, CONTRACT.action.y),
      `action spans y ${show(minY)}..${show(maxY)} in gun space, outside ${CONTRACT.action.y.join('..')}`);
    const axis = actionNode.extras?.hingeAxis;
    assert.ok(Array.isArray(axis) && axis.length === 3 && axis.every(Number.isFinite),
      'the action node must carry extras.hingeAxis as three finite numbers');
    assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-3, `hingeAxis ${axis.map(show).join(', ')} is not unit length`);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(entry.hingePivot[i] - pivot[i]) < 1e-3, `manifest hingePivot drifted on axis ${'xyz'[i]}`);
      assert.ok(Math.abs(entry.hingeAxis[i] - axis[i]) < 1e-3, `manifest hingeAxis drifted on axis ${'xyz'[i]}`);
    }
  });

  test(`${kind}: the manifest records how the asset was made`, () => {
    assert.ok(entry.meshyTasks && typeof entry.meshyTasks === 'object', `${kind} has no meshyTasks record`);
    assert.ok(Object.values(entry.meshyTasks).every(id => typeof id === 'string' && id.length > 0), 'every recorded Meshy task id must be a non-empty string');
    assert.ok(Array.isArray(entry.plates), `${kind} has no plates list`);
    assert.ok(entry.plates.every(plate => typeof plate === 'string'), 'plate ids must be strings');
    assert.ok(typeof entry.generator === 'string' && entry.generator.length > 0, `${kind} does not name its generator`);
  });
}
