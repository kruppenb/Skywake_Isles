import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildPlayerCharacter, loadNavigatorAsset } from '../client/player-character.js';
import { buildMermaid } from '../client/mermaid.js';
import { makePalette } from '../client/models.js';
import { WEAPONS } from '../shared/weapons.js';
import { navigatorAsset } from './helpers/navigator.js';

test('female land and swimming fallbacks have no moustache', () => {
  const palette = makePalette();
  const moustacheColor = new THREE.Color('#6d4936');
  for (const build of [buildPlayerCharacter, buildMermaid]) {
    for (const character of ['male', 'female']) {
      const model = build(palette, '#55c9ba', { character });
      const face = model.group.getObjectByName('face-hair-and-tricorn');
      assert.ok(face, 'the procedural face is visible before the asset loads');
      const positions = face.geometry.getAttribute('position');
      const colors = face.geometry.getAttribute('color');
      let moustacheVertices = 0;
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(positions.getX(i)) > .09 || positions.getY(i) < -.09
            || positions.getY(i) > -.04 || positions.getZ(i) > -.24) continue;
        const difference = Math.abs(colors.getX(i) - moustacheColor.r)
          + Math.abs(colors.getY(i) - moustacheColor.g) + Math.abs(colors.getZ(i) - moustacheColor.b);
        if (difference < .001) moustacheVertices++;
      }
      assert.equal(moustacheVertices > 0, character === 'male', `${character} fallback facial hair`);
      model.dispose();
    }
  }
});

test('navigator asset cache isolates variant URLs and evicts only a failed URL', async () => {
  const originalLoad = GLTFLoader.prototype.loadAsync;
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  const calls = [];
  let failedOnce = true;
  try {
    globalThis.window = {};
    globalThis.document = {};
    GLTFLoader.prototype.loadAsync = function loadAsync(url) {
      calls.push(url);
      if (url === '/qa-failed.glb' && failedOnce) { failedOnce = false; return Promise.reject(new Error('expected fixture failure')); }
      return Promise.resolve({ scene: new THREE.Group(), animations: [] });
    };
    const [male, female] = await Promise.all([
      loadNavigatorAsset('/qa-male.glb'), loadNavigatorAsset('/qa-female.glb'),
    ]);
    assert.equal(male.url, '/qa-male.glb');
    assert.equal(female.url, '/qa-female.glb');
    await loadNavigatorAsset('/qa-male.glb');
    assert.deepEqual(calls, ['/qa-male.glb', '/qa-female.glb'], 'each variant loads once and does not share the other URL cache');
    await assert.rejects(loadNavigatorAsset('/qa-failed.glb'), /fixture failure/);
    await loadNavigatorAsset('/qa-failed.glb');
    assert.deepEqual(calls.slice(-2), ['/qa-failed.glb', '/qa-failed.glb'], 'only the rejected URL is evicted for retry');
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoad;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
});

test('female navigator keeps the live weapon, glide, swim, and downed contracts', async () => {
  const palette = makePalette();
  const female = await navigatorAsset('navigator-female.glb');
  const model = buildPlayerCharacter(palette, '#55c9ba', { character: 'female', asset: female });
  await Promise.resolve();
  assert.equal(model.character, 'female');
  assert.equal(model.kind, 'navigator');
  assert.equal(model.group.userData.character, 'female');
  assert.equal(model.debug.root.name, 'SkywakeNavigator');

  const reloadPaths = new Set();
  for (const weapon of ['flintlock', 'scatter', 'repeater', 'burst', 'longshot']) {
    model.fire(weapon);
    model.animate(.4, 5, { mode: 'ground', weapon, pitch: .25 }, { dt: 1 / 60, elapsed: .4, aiming: true });
    assert.ok(Number.isFinite(model.getMuzzle(new THREE.Vector3()).length()), `${weapon} has a live female muzzle`);
    const rest = model.group.getObjectByName('LeftHand').getWorldPosition(new THREE.Vector3());
    const elapsed = 20, progress = .49, deadline = elapsed + WEAPONS[weapon].reload * (1 - progress);
    model.animate(elapsed, 0, { mode: 'ground', weapon, reloadUntil: deadline }, { dt: 0, elapsed });
    const loading = model.group.getObjectByName('LeftHand').getWorldPosition(new THREE.Vector3());
    assert.ok(loading.distanceTo(rest) > .04, `${weapon} moves the female support hand during reload`);
    reloadPaths.add(loading.toArray().map(value => value.toFixed(3)).join(':'));
  }
  assert.equal(reloadPaths.size, 5, 'each weapon keeps its distinct female reload hand path');
  for (let frame = 0; frame < 20; frame++) model.animate(frame / 60, 0, { mode: 'gliding', weapon: 'flintlock' }, { dt: 1 / 60 });
  assert.equal(model.group.getObjectByName('pirate-glider').visible, true);
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'left' : 'right', hand = model.group.getObjectByName(side < 0 ? 'LeftHand' : 'RightHand');
    const grip = model.group.getObjectByName(`${label}-glider-grip`);
    const restScale = female.scene.getObjectByName(hand.name).getWorldScale(new THREE.Vector3()).y;
    const palm = hand.localToWorld(new THREE.Vector3(0, .18, .07).divideScalar(restScale));
    assert.ok(palm.distanceTo(grip.getWorldPosition(new THREE.Vector3())) < .001, `female ${label} palm stays on its glider grip`);
  }
  model.dispose();

  const mermaid = buildMermaid(palette, '#55c9ba', { character: 'female', asset: female });
  await Promise.resolve();
  const sourceSkin = female.scene.getObjectByName('SkywakeNavigator') || female.scene;
  let sourceTriangles = 0, liveTriangles = 0;
  sourceSkin.traverse(node => { if (node.isSkinnedMesh) sourceTriangles += (node.geometry.index || node.geometry.attributes.position).count; });
  mermaid.debug.root.traverse(node => { if (node.isSkinnedMesh) liveTriangles += (node.geometry.index || node.geometry.attributes.position).count; });
  assert.ok(liveTriangles < sourceTriangles, 'swimming variant trims the female legs before adding the tail');
  assert.equal(mermaid.debug.character, 'female');
  assert.ok(mermaid.debug.tailRoot && mermaid.debug.tail && mermaid.debug.root, 'swim QA can inspect the live root and tail');
  const tailJoin = () => {
    const skin = mermaid.debug.tail, centre = new THREE.Vector3();
    for (let vertex = 0; vertex < 14; vertex++) centre.add(new THREE.Vector3().fromBufferAttribute(skin.geometry.attributes.position, vertex));
    return mermaid.debug.root.getObjectByName('Hips').worldToLocal(mermaid.debug.tailRoot.localToWorld(centre.multiplyScalar(1 / 14)));
  };
  mermaid.animate(0, 2, { mode: 'swimming', weapon: 'scatter' }, { dt: 1 / 60, elapsed: 0 });
  const hipJoin = tailJoin();
  for (let frame = 0; frame < 100; frame++) {
    mermaid.animate(frame / 60, 6, { mode: 'swimming', weapon: 'longshot', knockedUntil: 10 }, { dt: 1 / 60, elapsed: frame / 60 });
  }
  mermaid.group.updateMatrixWorld(true);
  assert.ok(tailJoin().distanceTo(hipJoin) < .025, 'female tail cuff remains in the live hip frame through swim speed and downing');
  assert.ok(mermaid.debug.tail.getWorldQuaternion(new THREE.Quaternion()).toArray().every(Number.isFinite), 'tail remains attached through the female downed pose');
  assert.ok(Number.isFinite(mermaid.getMuzzle(new THREE.Vector3()).length()), 'female mermaid retains the weapon rig');
  mermaid.dispose();
  for (const geometry of Object.values(palette.geometry)) geometry.dispose();
  palette.solid.dispose(); palette.glow.dispose(); palette.ramp.dispose();
});
