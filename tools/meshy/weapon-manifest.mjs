// Regenerates client/assets/weapons/manifest.json from the shipped weapon GLB bytes.
// node tools/meshy/weapon-manifest.mjs [weapons-dir] [manifest.json]
// Every number is measured from the file the game ships, so the contract test can cross-check the
// manifest against its own independent measurements. The only things copied in are the Meshy task
// ids and plate prompt ids from tools/meshy/weapons/<kind>.tasks.json, which are not in the bytes.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const dir = process.argv[2] || path.join(ROOT, 'client/assets/weapons');
const outPath = process.argv[3] || path.join(dir, 'manifest.json');
const tasksDir = path.join(ROOT, 'tools/meshy/weapons');
const GENERATOR = 'tools/meshy/build_weapon.py (Blender 5.2.1) on a Meshy multi-image-to-3D prop task';

const COMPONENT = { 5120: ['readInt8', 1], 5121: ['readUInt8', 1], 5122: ['readInt16LE', 2], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4] };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const round = v => Number(v.toFixed(5));

function imageSize(bytes, start, length) {
  // PNG: IHDR is the first chunk, width/height big-endian at +16/+20 from the signature.
  if (bytes.readUInt32BE(start) === 0x89504e47) return { width: bytes.readUInt32BE(start + 16), height: bytes.readUInt32BE(start + 20) };
  // JPEG: walk the markers to the first SOFn (C0-CF except C4/C8/CC), height/width at +5/+7.
  let at = start + 2;
  while (at < start + length - 9) {
    if (bytes[at] !== 0xff) { at++; continue; }
    const marker = bytes[at + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return { width: null, height: null };
}

function measure(glbPath) {
  const bytes = readFileSync(glbPath);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binOffset = 20 + jsonLength + 8;
  const accessor = index => {
    const acc = json.accessors[index], view = json.bufferViews[acc.bufferView];
    const [read, size] = COMPONENT[acc.componentType], width = WIDTH[acc.type];
    const stride = view.byteStride || width * size, base = binOffset + (view.byteOffset || 0) + (acc.byteOffset || 0);
    return Array.from({ length: acc.count }, (_, i) => Array.from({ length: width }, (_, c) => bytes[read](base + i * stride + c * size)));
  };
  const nodeIndex = name => json.nodes.findIndex(node => node.name === name);
  const kind = path.basename(glbPath, '.glb');
  const rootIndex = nodeIndex(kind);
  const bodyIndex = nodeIndex('body'), actionIndex = nodeIndex('action'), muzzleIndex = nodeIndex('muzzle');
  if (bodyIndex < 0 || muzzleIndex < 0) throw new Error(`${glbPath}: expected nodes body and muzzle, found ${json.nodes.map(n => n.name).join(', ')}`);

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const partOf = index => {
    const node = json.nodes[index];
    const origin = node.translation || [0, 0, 0];
    let triangles = 0;
    for (const primitive of json.meshes[node.mesh].primitives) {
      triangles += accessor(primitive.indices).length / 3;
      for (const row of accessor(primitive.attributes.POSITION)) for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], row[i] + origin[i]); max[i] = Math.max(max[i], row[i] + origin[i]);
      }
    }
    return triangles;
  };
  const triangles = { body: partOf(bodyIndex), action: actionIndex < 0 ? 0 : partOf(actionIndex) };
  const action = actionIndex < 0 ? null : json.nodes[actionIndex];

  const images = (json.images || []).map(image => {
    const view = json.bufferViews[image.bufferView];
    const start = binOffset + (view.byteOffset || 0);
    return { name: image.name || null, mimeType: image.mimeType, ...imageSize(bytes, start, view.byteLength), embeddedBytes: view.byteLength };
  });

  const tasksPath = path.join(tasksDir, `${kind}.tasks.json`);
  const tasks = existsSync(tasksPath) ? JSON.parse(readFileSync(tasksPath, 'utf8')) : {};

  return [kind, {
    glb: path.basename(glbPath),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    triangles,
    rootNode: rootIndex < 0 ? null : json.nodes[rootIndex].name,
    // Node names, not indices: the runtime and the contract test look these up by name.
    nodes: { body: json.nodes[bodyIndex].name, action: action ? json.nodes[actionIndex].name : null, muzzle: json.nodes[muzzleIndex].name },
    muzzle: (json.nodes[muzzleIndex].translation || [0, 0, 0]).map(round),
    hingePivot: action ? (action.translation || [0, 0, 0]).map(round) : null,
    hingeAxis: action?.extras?.hingeAxis ? action.extras.hingeAxis.map(round) : null,
    bounds: { min: min.map(round), max: max.map(round) },
    images,
    materialNames: (json.materials || []).map(material => material.name),
    meshyTasks: tasks.meshyTasks || {},
    plates: tasks.plates || [],
    generator: tasks.generator || GENERATOR,
  }];
}

const files = existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.glb')).sort() : [];
if (!files.length) {
  console.error(`no weapon GLBs in ${dir}; build one with tools/meshy/build_weapon.py first`);
  process.exit(1);
}
const weapons = Object.fromEntries(files.map(name => measure(path.join(dir, name))));
writeFileSync(outPath, JSON.stringify({ schemaVersion: 1, weapons }, null, 2) + '\n');
for (const [kind, weapon] of Object.entries(weapons)) {
  console.log(`${kind}: ${weapon.triangles.body}+${weapon.triangles.action} tris, ${weapon.bytes} bytes, ` +
    `sha256 ${weapon.sha256.slice(0, 12)}…, muzzle [${weapon.muzzle}], hinge ${weapon.hingePivot ? `[${weapon.hingePivot}] about [${weapon.hingeAxis}]` : 'none'}`);
}
console.log('wrote', outPath, `${files.length} weapon(s)`);
