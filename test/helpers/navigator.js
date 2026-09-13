import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Use the shipped mesh, skin and clips in Node. Only textures are omitted;
// no DOM/image decoder is needed to measure the actual animated skeleton.
export async function navigatorAsset() {
  const bytes = await readFile(new URL('../../client/assets/player-character/navigator-meshy.glb', import.meta.url));
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  for (const material of json.materials) {
    delete material.pbrMetallicRoughness.baseColorTexture;
    delete material.normalTexture; delete material.emissiveTexture;
  }
  const content = JSON.stringify(json), chunk = Buffer.from(content + ' '.repeat((4 - Buffer.byteLength(content) % 4) % 4));
  const header = Buffer.from(bytes.subarray(0, 20)), bin = bytes.subarray(20 + length);
  header.writeUInt32LE(20 + chunk.length + bin.length, 8); header.writeUInt32LE(chunk.length, 12);
  const glb = Buffer.concat([header, chunk, bin]);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
}
