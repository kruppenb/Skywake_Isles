import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
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
  const fan = mermaid.group.getObjectByName('meridian-forked-fan-membrane');
  assert.ok(fan?.isMesh && fan.geometry.attributes.position.count > 12, 'one curved membrane replaces the old separate fluke paddles');
  fan.geometry.computeBoundingBox(); assert.ok(fan.geometry.boundingBox.min.x < -.5 && fan.geometry.boundingBox.max.x > .5, 'connected fan spans both fork tips');
  assert.equal(mermaid.group.getObjectByName('pirate-glider')?.visible, false);
  assert.equal(mermaid.group.getObjectByName('pirate-contact-shadow')?.visible, false);
  assert.ok(mermaid.getMuzzle(), 'the retained weapon rig still supplies the authoritative muzzle');
  mermaid.dispose(); disposePalette(palette);
});

test('mermaid tail stays on the live waist through fallback, navigator swap, recoil, and deformation', async () => {
  const palette = makePalette(), asset = await navigatorAsset(), mermaid = buildMermaid(palette, '#4faeb0', { asset });
  const tailRoot = mermaid.group.getObjectByName('meridian-articulated-tail');
  const topVertexAtWaist = (waist, vertex) => {
    const skin = mermaid.group.getObjectByName('meridian-continuous-crew-tail');
    return waist.worldToLocal(tailRoot.localToWorld(new THREE.Vector3().fromBufferAttribute(skin.geometry.attributes.position, vertex)));
  };
  const skinCenterAtWaist = waist => {
    const skin = mermaid.group.getObjectByName('meridian-continuous-crew-tail'), centre = new THREE.Vector3(), count = 14;
    for (let vertex = 0; vertex < count; vertex++) centre.add(new THREE.Vector3().fromBufferAttribute(skin.geometry.attributes.position, vertex));
    return waist.worldToLocal(tailRoot.localToWorld(centre.multiplyScalar(1 / count)));
  };
  mermaid.animate(0, 0, { mode: 'swimming', weapon: 'flintlock' }, { dt: 1 / 60 });
  const fallbackWaist = mermaid.group.getObjectByName('pirate-upper-body');
  assert.ok(fallbackWaist, 'the compact upper body anchors the loading fallback');
  const fallbackJoin = skinCenterAtWaist(fallbackWaist);
  const fallbackRing = [topVertexAtWaist(fallbackWaist, 0), topVertexAtWaist(fallbackWaist, 4)];
  mermaid.fire('scatter'); mermaid.animate(.1, 3, { mode: 'swimming', weapon: 'scatter' }, { dt: 1 / 60 });
  assert.ok(skinCenterAtWaist(fallbackWaist).distanceTo(fallbackJoin) < .025, 'fallback tail top stays in its rotating, recoiling coat frame');
  assert.ok(topVertexAtWaist(fallbackWaist, 0).distanceTo(fallbackRing[0]) < .025 && topVertexAtWaist(fallbackWaist, 4).distanceTo(fallbackRing[1]) < .025,
    'fallback waist rotation carries the whole attachment ring, not only its centre');

  await new Promise(resolve => setTimeout(resolve, 0));
  mermaid.animate(.4, 4, { mode: 'swimming', weapon: 'scatter' }, { dt: 1 /60 });
  const hips = mermaid.group.getObjectByName('Hips');
  assert.ok(hips, 'loaded navigator supplies the live pelvis');
  const navigatorJoin = skinCenterAtWaist(hips);
  const navigatorRing = [topVertexAtWaist(hips, 0), topVertexAtWaist(hips, 5)];
  mermaid.fire('scatter'); mermaid.animate(.7, 1, { mode: 'swimming', weapon: 'scatter', knockedUntil: 5 }, { dt: 1 /60 });
  assert.ok(skinCenterAtWaist(hips).distanceTo(navigatorJoin) < .025, 'tail top remains fixed in the live hips frame through idle, recoil, and body motion');
  assert.ok(topVertexAtWaist(hips, 0).distanceTo(navigatorRing[0]) < .025 && topVertexAtWaist(hips, 5).distanceTo(navigatorRing[1]) < .025,
    'calibrated navigator pelvis rotation carries the complete tail cuff');

  const skin = mermaid.group.getObjectByName('meridian-continuous-crew-tail'), scales = mermaid.group.getObjectByName('meridian-overlapping-scalloped-scales');
  const fluke = mermaid.group.getObjectByName('meridian-two-lobed-fluke'), membrane = mermaid.group.getObjectByName('meridian-forked-fan-membrane'), position = skin.geometry.attributes.position;
  assert.equal(skin.geometry.index.count > 900, true, 'continuous tail has enough rings for a smooth wave');
  assert.equal(mermaid.group.getObjectByName('meridian-forked-fan-membrane')?.isMesh, true, 'fluke is one connected membrane');
  assert.ok(mermaid.group.getObjectByName('meridian-fluke-fin-rays')?.isLineSegments, 'forked fan keeps readable fin rays');
  const lastRing = new THREE.Vector3();
  const capIndex = position.count - 1;
  for (let vertex = capIndex - 14; vertex < capIndex; vertex++) lastRing.add(new THREE.Vector3().fromBufferAttribute(position, vertex));
  lastRing.multiplyScalar(1 / 14);
  assert.ok(lastRing.distanceTo(fluke.position) < .03, 'forked fan remains attached to the deformed peduncle');
  for (const geometry of [skin.geometry, scales.geometry]) {
    assert.ok(geometry.boundingBox && geometry.boundingSphere, 'dynamic tail geometry refreshes culling bounds');
    const bounds = geometry.boundingBox.clone().expandByScalar(1e-6), radius = geometry.boundingSphere.radius + 1e-6;
    const point = new THREE.Vector3();
    for (let vertex = 0; vertex < geometry.attributes.position.count; vertex++) {
      point.fromBufferAttribute(geometry.attributes.position, vertex);
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z), 'tail deformation stays finite');
      assert.ok(bounds.containsPoint(point) && point.distanceTo(geometry.boundingSphere.center) <= radius, 'refreshed bounds contain every moving vertex');
    }
  }
  const beforeLastRing = new THREE.Vector3();
  for (let vertex = capIndex - 28; vertex < capIndex - 14; vertex++) beforeLastRing.add(new THREE.Vector3().fromBufferAttribute(position, vertex));
  beforeLastRing.multiplyScalar(1 / 14);
  mermaid.group.rotation.y = .61; mermaid.group.updateMatrixWorld(true);
  const distal = new THREE.Vector3();
  const flukeWorld = fluke.getWorldPosition(new THREE.Vector3());
  for (let vertex = 0; vertex < membrane.geometry.attributes.position.count; vertex++) {
    const candidate = membrane.localToWorld(new THREE.Vector3().fromBufferAttribute(membrane.geometry.attributes.position, vertex)).sub(flukeWorld);
    if (candidate.length() > distal.length()) distal.copy(candidate);
  }
  const lastRingWorld = tailRoot.localToWorld(lastRing.clone()), beforeLastRingWorld = tailRoot.localToWorld(beforeLastRing.clone());
  assert.ok(distal.dot(lastRingWorld.sub(beforeLastRingWorld).normalize()) > .08, 'actual forked membrane extends beyond the peduncle instead of back into it');
  const tailDrawables = []; tailRoot.traverse(node => { if (node.isMesh || node.isLineSegments) tailDrawables.push(node); });
  assert.ok(tailDrawables.length <= 4, 'tail remains a bounded number of draw calls');
  mermaid.animate(1, 4, { mode: 'swimming', weapon: 'flintlock' }, { dt: 1 / 60 });
  const phaseSteps = [], previousFluke = fluke.position.clone();
  for (let frame = 0; frame < 150; frame++) {
    mermaid.animate(1 + frame / 60, 4, { mode: 'swimming', weapon: 'flintlock' }, { dt: 1 / 60 });
    phaseSteps.push(previousFluke.distanceTo(fluke.position)); previousFluke.copy(fluke.position);
  }
  assert.ok(Math.max(...phaseSteps) < .05, 'tail wave remains continuous when its bounded phase wraps');
  for (const weapon of ['flintlock', 'scatter', 'repeater', 'burst', 'longshot']) {
    mermaid.fire(weapon); mermaid.animate(.7, 2, { mode: 'swimming', weapon }, { dt: 1 /60 });
    assert.ok(Number.isFinite(mermaid.getMuzzle(new THREE.Vector3()).length()), weapon + ' retains a live swimming muzzle');
  }
  mermaid.dispose(); disposePalette(palette);
});

test('reef camera clear arm respects hull walls, floor and an open upper route', () => {
  assert.ok(reefCameraFraction({ x: -7, y: 4, z: -10 }, { x: 6, y: 4, z: -10 }) < .3, 'low chase arm stops before the west wreck wall');
  assert.equal(reefCameraFraction({ x: -7, y: 12, z: -10 }, { x: 6, y: 12, z: -10 }), 1, 'open water above the walls remains usable');
  assert.ok(reefCameraFraction({ x: -18, y: 2, z: 20 }, { x: -18, y: -9, z: 20 }) < 1, 'camera cannot sink below the reef floor');
});

test('mermaid tail narrows gradually from the coat to the fluke throughout its stroke', () => {
  const palette = makePalette(), mermaid = buildMermaid(palette);
  const skin = mermaid.group.getObjectByName('meridian-continuous-crew-tail');
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const speed of [0, 8, 12]) for (let frame = 0; frame < 30; frame++) {
    mermaid.animate(frame / 30, speed, { mode: 'swimming' }, { dt: 1 / 30 });
    const positions = skin.geometry.attributes.position, widths = [];
    for (let ring = 0; ring < (positions.count - 1) / 14; ring++) {
      a.fromBufferAttribute(positions, ring * 14); b.fromBufferAttribute(positions, ring * 14 + 7);
      widths.push(a.distanceTo(b));
    }
    for (let ring = 1; ring < widths.length; ring++) {
      assert.ok(widths[ring] < widths[ring - 1], 'no round hip bulge beneath a narrow cuff');
      assert.ok(widths[ring - 1] - widths[ring] < .04, 'each ring continues a gradual taper without a sudden pinch');
    }
    assert.ok(widths.at(-1) < widths[0] * .35, 'the taper reaches a slender fluke attachment');
  }
  mermaid.dispose(); disposePalette(palette);
});

test('sprint swimming eases into a forward waist pivot at every heading and releases cleanly', async () => {
  const palette = makePalette(), asset = await navigatorAsset(), mermaid = buildMermaid(palette, '#55c9ba', { asset });
  await Promise.resolve();
  const pivot = mermaid.group.getObjectByName('meridian-swim-pivot');
  const state = { mode: 'swimming', weapon: 'flintlock', pitch: 0 };
  let time = 0;
  const advance = (speed, frames = 60, player = state) => {
    for (let frame = 0; frame < frames; frame++) { time += 1 / 60; mermaid.animate(time, speed, player, { dt: 1 / 60 }); }
    mermaid.group.updateMatrixWorld(true);
  };
  const hips = () => mermaid.group.getObjectByName('Hips').getWorldPosition(new THREE.Vector3());
  const torso = () => mermaid.group.getObjectByName('Head').getWorldPosition(new THREE.Vector3()).sub(hips()).normalize();
  advance(8);
  const normalLean = pivot.rotation.x, normalHips = hips();
  assert.ok(torso().y > .85, 'normal swimming stays mostly upright');
  advance(12, 1);
  assert.ok(pivot.rotation.x < normalLean && pivot.rotation.x > normalLean - .15, 'pressing sprint begins a blend, not a pose snap');
  advance(12);
  assert.ok(hips().distanceTo(normalHips) < .25, 'leaning rotates around the waist rather than sinking from the feet');
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    mermaid.group.rotation.y = yaw; mermaid.group.updateMatrixWorld(true);
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), direction = torso();
    assert.ok(direction.dot(forward) > .75 && direction.y < .65, 'head leads the hips toward the facing while sprinting');
    assert.ok(Number.isFinite(mermaid.getMuzzle(new THREE.Vector3()).length()), 'sprint retains a live weapon muzzle');
  }
  const sprintLean = pivot.rotation.x;
  mermaid.animate(time, 0, state, { dt: 0 });
  assert.equal(pivot.rotation.x, sprintLean, 'a paused renderer holds the swim pose');
  advance(8);
  assert.ok(Math.abs(pivot.rotation.x - normalLean) < .005, 'releasing sprint restores normal swimming');
  advance(12); advance(12, 60, { ...state, knockedUntil: 100 });
  assert.ok(pivot.rotation.x > -.2, 'a knock releases sprint even if a travel sample still reports speed');
  mermaid.dispose(); disposePalette(palette);
});
