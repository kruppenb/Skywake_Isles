import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildPlayerCharacter } from '../client/player-character.js';
import { makePalette } from '../client/models.js';

// Load the shipped skeleton, clips and mesh. Only textures are omitted for Node;
// the same skin weights and bind matrices used by the browser drive these checks.
async function navigatorAsset() {
  const bytes = await readFile(new URL('../client/assets/player-character/navigator-meshy.glb', import.meta.url));
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

const asset = await navigatorAsset();
async function character() {
  const model = buildPlayerCharacter(makePalette(), '#eb785d', { asset });
  await Promise.resolve();
  assert.equal(model.kind, 'navigator');
  return model;
}

test('navigator grips track the swaying handles with thumbs up and fixed arm lengths', async () => {
  const model = await character(), group = model.group;
  group.position.set(12, 4, -8); group.rotation.y = 1.2;
  const world = node => node.getWorldPosition(new THREE.Vector3());
  const arms = [-1, 1].map(side => {
    const name = side < 0 ? 'Left' : 'Right', label = side < 0 ? 'left' : 'right';
    const upper = group.getObjectByName(name + 'Arm'), fore = group.getObjectByName(name + 'ForeArm');
    const hand = group.getObjectByName(name + 'Hand'), grip = group.getObjectByName(label + '-glider-grip');
    return { side, upper, fore, hand, grip, upperLength: world(upper).distanceTo(world(fore)), lowerLength: world(fore).distanceTo(world(hand)) };
  });
  for (let frame = 0; frame < 180; frame++) {
    model.animate(frame / 30, 0, { mode: 'gliding', weapon: 'flintlock', pitch: Math.sin(frame / 20) }, { dt: 1 / 30 });
    group.updateMatrixWorld(true);
    for (const arm of arms) {
      const rotation = arm.hand.getWorldQuaternion(new THREE.Quaternion());
      const restScale = asset.scene.getObjectByName(arm.hand.name).getWorldScale(new THREE.Vector3()).y;
      const palm = arm.hand.localToWorld(new THREE.Vector3(0, .18, .07).divideScalar(restScale));
      assert.ok(palm.distanceTo(world(arm.grip)) < .001, `closed palm stays on the handle throughout glide entry and sway: frame ${frame}, side ${arm.side}, error ${palm.distanceTo(world(arm.grip))}`);
      const thumb = new THREE.Vector3(arm.side, 0, 0).applyQuaternion(rotation);
      const handle = new THREE.Vector3(0, 1, 0).applyQuaternion(arm.grip.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(thumb.dot(handle) > .999, 'thumb points up along the handle instead of twisting backward');
      assert.ok(Math.abs(world(arm.upper).distanceTo(world(arm.fore)) - arm.upperLength) < .001);
      assert.ok(Math.abs(world(arm.fore).distanceTo(world(arm.hand)) - arm.lowerLength) < .001);
    }
  }
});

test('glide closes only hand geometry and restores weapon hands without altering other players', async () => {
  const model = await character(), other = await character();
  const meshes = [];
  model.group.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  let changed = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry, rest = geometry.attributes.position, curl = geometry.morphAttributes.position[0];
    const hands = mesh.skeleton.bones.map((bone, index) => /^(Left|Right)Hand$/.test(bone.name) ? index : -1);
    assert.equal(geometry.userData.shared, false, 'the private morph geometry can be disposed with this player');
    for (let i = 0; i < rest.count; i++) {
      const before = new THREE.Vector3().fromBufferAttribute(rest, i), after = new THREE.Vector3().fromBufferAttribute(curl, i);
      assert.ok(after.toArray().every(Number.isFinite));
      if (before.distanceTo(after) < 1e-6) continue;
      changed++;
      let handWeight = 0;
      for (let j = 0; j < 4; j++) {
        if (hands.includes(geometry.attributes.skinIndex.getComponent(i, j))) handWeight += geometry.attributes.skinWeight.getComponent(i, j);
      }
      assert.ok(handWeight > .5, 'curl never changes the body, cuffs or other joints');
    }
  }
  assert.ok(changed > 100, 'the actual fingers close, not just the wrist orientation');
  model.animate(1, 0, { mode: 'gliding' });
  for (const mesh of meshes) assert.equal(mesh.morphTargetInfluences[0], 1);
  other.group.traverse(node => { if (node.isSkinnedMesh) assert.equal(node.morphTargetInfluences[0], 0); });
  for (const mode of ['ground', 'aboard']) {
    model.animate(2, 0, { mode, weapon: 'scatter' });
    for (const mesh of meshes) assert.equal(mesh.morphTargetInfluences[0], 0);
  }
  asset.scene.traverse(node => { if (node.isSkinnedMesh) assert.equal(node.geometry.morphAttributes.position, undefined); });
});
