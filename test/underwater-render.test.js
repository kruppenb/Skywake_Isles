import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makePalette } from '../client/models.js';
import { createUnderwaterPresentation } from '../client/underwater.js';
import { buildMermaid } from '../client/mermaid.js';
import { reefCameraFraction } from '../client/camera.js';
import { REEF_CHEST, REEF_EXIT, REEF_SOLIDS } from '../shared/underwater.js';

// GLTFLoader's image path uses the browser spelling even though this fixture is
// embedded; Node supplies Blob/createImageBitmap but not `self`.
if (!globalThis.self) globalThis.self = globalThis;

async function navigatorAsset() {
  const source = await fs.readFile(new URL('../client/assets/player-character/navigator-meshy.glb', import.meta.url));
  // Node has no image decoder for the embedded atlas. Geometry, skinning and
  // clips still parse; suppress only that expected loader warning for this
  // structural fixture.
  const warn = console.warn, error = console.error; console.warn = () => {}; console.error = () => {};
  try {
    const asset = await new Promise((resolve, reject) => new GLTFLoader().parse(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), '', gltf => resolve({ scene: gltf.scene, animations: gltf.animations }), reject));
    await new Promise(resolve => setTimeout(resolve, 0)); return asset;
  } finally { console.warn = warn; console.error = error; }
}
function disposePalette(palette) { Object.values(palette.geometry).forEach(geometry => geometry.dispose()); palette.ramp.dispose(); palette.solid.dispose(); palette.glow.dispose(); }

test('Sunken Reach presentation names its readable routes, chest, current and bounded lagoon dressing', () => {
  const palette = makePalette(), reef = createUnderwaterPresentation({ palette, heightAt: () => 3 });
  assert.equal(reef.group.getObjectByName('sunken-reach-wreck-solid-hull')?.children.length, 2);
  assert.ok(reef.group.getObjectByName('sunken-reach-coral-swim-arch'));
  assert.ok(reef.group.getObjectByName('sunken-reach-return-current'));
  assert.ok(reef.group.getObjectByName('sunken-reach-guarded-chest'));
  assert.ok(reef.diveMarker.getObjectByName('sunken-reach-dive-tide-pool-marker') || reef.diveMarker.name === 'sunken-reach-dive-tide-pool-marker');
  reef.update(1, { underwater: { remaining: 2 } });
  const current = reef.group.getObjectByName('sunken-reach-return-current');
  assert.deepEqual(current.position.toArray().map(value => Number(value.toFixed(4))), [REEF_EXIT.x + 1.55, Number((REEF_EXIT.y - 1.45 + Math.sin(1.4) * .06).toFixed(4)), REEF_EXIT.z + 1.1]);
  assert.equal(reef.getStats().wreckSolids, REEF_SOLIDS.length); assert.equal(reef.getStats().chest, REEF_CHEST.id);
  reef.group.traverse(object => { object.geometry?.dispose(); if (object.material?.dispose) object.material.dispose(); }); disposePalette(palette);
});

test('mermaid swaps in a leg-trimmed navigator upper body, preserving the pirate weapon rig without glider or boots', async () => {
  const palette = makePalette(), asset = await navigatorAsset(), mermaid = buildMermaid(palette, '#e9786d', { asset });
  await new Promise(resolve => setTimeout(resolve, 0));
  const root = mermaid.group.getObjectByName('SkywakeNavigator');
  assert.ok(root, 'loaded navigator replaces the fallback');
  const sourceMesh = asset.scene.getObjectByProperty('isSkinnedMesh', true), renderedMesh = root.getObjectByProperty('isSkinnedMesh', true);
  assert.ok(renderedMesh.geometry.index.count < sourceMesh.geometry.index.count, 'leg-weighted triangles are cut from the cloned navigator mesh');
  assert.notEqual(renderedMesh.geometry, sourceMesh.geometry, 'source GLB geometry remains borrowed and untouched');
  mermaid.animate(.6, 4, { mode: 'swimming', weapon: 'flintlock' }, { dt: 1 / 60 });
  assert.ok(mermaid.group.getObjectByName('meridian-articulated-tail'));
  const tail = mermaid.group.getObjectByName('meridian-continuous-crew-tail');
  assert.ok(tail?.geometry.index.count > 500, 'one indexed tube joins waist to fluke without segmented cones');
  assert.ok(mermaid.group.getObjectByName('meridian-two-lobed-fluke')?.getObjectByName('meridian-fluke-port'));
  assert.equal(mermaid.group.getObjectByName('pirate-glider')?.visible, false);
  assert.equal(mermaid.group.getObjectByName('pirate-contact-shadow')?.visible, false);
  assert.ok(mermaid.getMuzzle(), 'the retained weapon rig still supplies the authoritative muzzle');
  mermaid.dispose(); disposePalette(palette);
});

test('reef camera clear arm respects hull walls, floor and an open upper route', () => {
  assert.ok(reefCameraFraction({ x: -7, y: 4, z: -10 }, { x: 6, y: 4, z: -10 }) < .3, 'low chase arm stops before the west wreck wall');
  assert.equal(reefCameraFraction({ x: -7, y: 12, z: -10 }, { x: 6, y: 12, z: -10 }), 1, 'open water above the walls remains usable');
  assert.ok(reefCameraFraction({ x: -18, y: 2, z: 20 }, { x: -18, y: -9, z: 20 }) < 1, 'camera cannot sink below the reef floor');
});
