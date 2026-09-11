// Regenerates client/assets/player-character/manifest.json from the shipped navigator GLB bytes.
// node tools/meshy/manifest.mjs [glb] [manifest.json]
// Everything here is measured from the file; nothing is copied from the build inputs, so the
// contract test can cross-check the manifest against its own independent measurements.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const glbPath = process.argv[2] || path.join(ROOT, 'client/assets/player-character/navigator-meshy.glb');
const outPath = process.argv[3] || path.join(ROOT, 'client/assets/player-character/manifest.json');

const bytes = readFileSync(glbPath);
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
const binOffset = 20 + jsonLength + 8;
const COMPONENT = { 5121: ['readUInt8', 1], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4] };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(index) {
  const acc = json.accessors[index], view = json.bufferViews[acc.bufferView];
  const [read, size] = COMPONENT[acc.componentType], width = WIDTH[acc.type];
  const stride = view.byteStride || width * size, base = binOffset + (view.byteOffset || 0) + (acc.byteOffset || 0);
  return Array.from({ length: acc.count }, (_, i) => Array.from({ length: width }, (_, c) => bytes[read](base + i * stride + c * size)));
}
const parents = new Map();
json.nodes.forEach((node, i) => (node.children || []).forEach(child => parents.set(child, i)));
const ancestry = index => { const names = []; let cursor = index; while (parents.has(cursor)) { cursor = parents.get(cursor); names.push(json.nodes[cursor].name); } return names; };

let triangles = 0, primitives = 0;
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
  primitives++;
  triangles += accessor(primitive.indices).length / 3;
  for (const row of accessor(primitive.attributes.POSITION)) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], row[i]); max[i] = Math.max(max[i], row[i]); }
}
const images = json.images.map(image => {
  const view = json.bufferViews[image.bufferView];
  const start = binOffset + (view.byteOffset || 0);
  const width = bytes.readUInt32BE(start + 16), height = bytes.readUInt32BE(start + 20), colourType = bytes[start + 25];
  let decoded = 0, w = width, h = height;
  for (;;) { decoded += w * h * 4; if (w === 1 && h === 1) break; w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2)); }
  return { name: image.name || null, mimeType: image.mimeType, width, height, channels: colourType === 6 ? 4 : colourType === 2 ? 3 : null, embeddedBytes: view.byteLength, decodedBytes: decoded };
});
const animations = json.animations.map(anim => {
  let duration = 0;
  for (const sampler of anim.samplers) duration = Math.max(duration, ...accessor(sampler.input).map(([t]) => t));
  return { name: anim.name, duration: Number(duration.toFixed(4)), channels: anim.channels.length, samplers: anim.samplers.length };
});
const socketNames = ['weapon_grip.L', 'weapon_grip.R', 'glider_grip.L', 'glider_grip.R', 'stow_back'];
const sockets = socketNames.map(name => {
  const index = json.nodes.findIndex(node => node.name === name);
  return { name, parent: json.nodes[parents.get(index)].name, ancestry: ancestry(index) };
});
const root = json.nodes[json.scenes[json.scene ?? 0].nodes[0]];
const material = json.materials[0];

const manifest = {
  schemaVersion: 2,
  id: 'skywake-navigator',
  generator: 'tools/meshy/build_navigator.py (Blender 5.2.1) on Meshy multi-image-to-3D + rig outputs, albedo from tools/meshy/albedo.py',
  glb: path.basename(glbPath),
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  units: 'meters', forward: '-Z', up: '+Y',
  rootNode: root.name, rootScale: root.scale ? Number(root.scale[0].toFixed(4)) : 1,
  triangles, meshPrimitives: primitives,
  materialNames: json.materials.map(m => m.name),
  crewTint: { convention: material.extras?.crewMask || null, reference: material.extras?.crewReference || null, material: material.name },
  images, decodedTextureBytes: images.reduce((sum, image) => sum + image.decodedBytes, 0),
  bounds: { min: min.map(v => Number(v.toFixed(4))), max: max.map(v => Number(v.toFixed(4))) },
  skins: json.skins.length,
  jointCount: json.skins[0].joints.length,
  joints: json.skins[0].joints.map(i => json.nodes[i].name),
  animations, sockets,
  meshyTasks: {
    multiImageTo3d: '01a091b6-5ad1-7534-a2ba-835316a356f2', rig: '01a091b9-9557-77a8-ae76-1d8b84d19345',
    idleAnimation: '01a091ba-b8d6-751d-937c-71b32fb47b5e', retextureTrial: '01a091d8-9461-70d9-a066-73e12508df83',
  },
  limitations: [
    'No finger or toe bones: hands are rigid to LeftHand/RightHand, so grips are posed by the runtime IK, not by finger curls.',
    'idle/walk/run are Meshy library clips; the runtime overrides both arms, the head pitch and the legs during glide and knockback.',
    'The crew mask is a hue classification of the Meshy atlas; the headband, lips and brass buttons are deliberately excluded.',
    'The coat-back vent, lining and belt tab are projected from the back concept plate, not modelled.',
  ],
};
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', outPath, `${triangles} tris, ${manifest.jointCount} joints, sha256 ${manifest.sha256.slice(0, 12)}…, ${bytes.length} bytes`);
