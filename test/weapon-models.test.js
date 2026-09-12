import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makePalette, buildWeapon, WEAPON_HANDLING } from '../client/models.js';
import { WEAPON_ASSET_HANDLING, WEAPON_ASSET_URLS, applyWeaponAsset, loadWeaponAsset, markWeaponAssetShared, upgradeWeapon } from '../client/weapon-models.js';

// The runtime swap layer that draws the Meshy gun GLBs over buildWeapon's procedural guns. The
// asset here is synthetic (three.js objects shaped exactly like the shipped contract: a <kind>
// root with body / action / muzzle children) so the whole hinge, socket and sharing contract is
// exercised without a browser, a loader or a shipped file. test/weapon-assets.test.js checks the
// real bytes; test/presentation.test.js and test/reload-animation.test.js check that the
// procedural fallback these tests upgrade from is still intact and unchanged.

const KIND = 'flintlock';
// The action node's own hinge pivot, deliberately nowhere near buildWeapon's procedural
// actionOrigin (-.115, .125, -.10), so the translation cancellation in the hinge chain is real.
const PIVOT = new THREE.Vector3(.10, .25, -.08);
const MUZZLE = new THREE.Vector3(0, .13, -1.02);
const CARRIER_POINT = new THREE.Vector3(0, .2, 0);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} versus ${expected}`);
const closeTo = (actual, expected, message) => assert.ok(actual.distanceTo(expected) < 1e-6,
  `${message}: ${actual.toArray()} versus ${expected.toArray()}`);

function syntheticAsset(kind = KIND, { hingeAxis = [-1, 0, 0], omit = '', split = false } = {}) {
  const scene = new THREE.Group(); scene.name = 'Scene';
  const root = new THREE.Object3D(); root.name = kind; scene.add(root);
  if (omit !== 'body') {
    const map = new THREE.DataTexture(new Uint8Array([200, 150, 90, 255]), 1, 1);
    const albedo = new THREE.MeshStandardMaterial({ color: '#825635', map });
    const body = new THREE.Mesh(new THREE.BoxGeometry(.2, .3, 1.2), albedo);
    body.name = 'body'; root.add(body);
    if (split) {
      // What GLTFLoader hands back for a two-primitive mesh: a Group carrying the node transform
      // with one identity-placed mesh per primitive (here the albedo body plus the `fill` cut
      // faces), rather than a single Mesh.
      const group = new THREE.Group(); group.name = 'body'; body.name = 'body_0'; root.remove(body);
      const cut = new THREE.Mesh(new THREE.BoxGeometry(.14, .14, .01), new THREE.MeshStandardMaterial({ color: '#1c2a33' }));
      cut.name = 'body_1'; group.add(body, cut); root.add(group);
    }
  }
  if (omit !== 'action') {
    const action = new THREE.Mesh(new THREE.BoxGeometry(.06, .22, .10), new THREE.MeshStandardMaterial({ color: '#334b5a' }));
    action.name = 'action'; action.position.copy(PIVOT); action.userData.hingeAxis = [...hingeAxis]; root.add(action);
  }
  if (omit !== 'muzzle') {
    const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.copy(MUZZLE); root.add(muzzle);
  }
  return { scene, url: `/assets/weapons/${kind}.glb`, kind };
}

const palette = makePalette();
function upgraded(options, kind = KIND) {
  const weapon = buildWeapon(palette, kind);
  assert.equal(applyWeaponAsset(weapon, kind, syntheticAsset(kind, options)), true, 'the synthetic asset should apply');
  return weapon;
}
// The exact three lines client/player-character.js and the studio run on the action every frame.
function frame(weapon, open) {
  weapon.action.position.copy(weapon.actionOrigin);
  weapon.action.rotation.set(0, 0, 0);
  weapon.action.rotation.z = -1.15 * open;
  weapon.group.updateMatrixWorld(true);
  weapon.stowed.updateMatrixWorld(true);
}

test('every shipped kind has a frozen asset URL and unknown kinds never start a load', () => {
  assert.equal(WEAPON_ASSET_URLS.flintlock, '/assets/weapons/flintlock.glb');
  assert.equal(WEAPON_ASSET_URLS.scatter, '/assets/weapons/scatter.glb');
  assert.ok(Object.isFrozen(WEAPON_ASSET_URLS));
  assert.equal(loadWeaponAsset('repeater'), null, 'a kind with no shipped GLB must stay procedural, not fetch');
  assert.equal(loadWeaponAsset('flintlock', ''), null);
});

test('the upgraded gun keeps every name gameplay looks up, held and stowed', () => {
  const weapon = upgraded();
  assert.equal(weapon.group.name, `held-${KIND}`);
  assert.equal(weapon.stowed.name, `stowed-${KIND}`);
  assert.equal(weapon.group.children.find(child => child.isMesh).name, `${KIND}-wood-brass-steel`);
  for (const [name, expected] of [
    [`reload-action-${KIND}`, weapon.action], [`muzzle-${KIND}`, weapon.socket],
  ]) assert.equal(weapon.group.getObjectByName(name), expected, `${name} is not the object the runtime drives`);
  assert.ok(weapon.group.getObjectByName(`reload-hinge-${KIND}`), 'held hinge missing');
  assert.ok(weapon.group.getObjectByName(`reload-action-mesh-${KIND}`), 'held action mesh missing');
  assert.equal(weapon.stowed.getObjectByName(`stowed-muzzle-${KIND}`), weapon.stowedSocket);
  for (const name of [`stowed-reload-hinge-${KIND}`, `stowed-reload-action-${KIND}`, `stowed-reload-action-mesh-${KIND}`]) {
    assert.ok(weapon.stowed.getObjectByName(name), `${name} missing from the stowed twin`);
  }
  assert.equal(weapon.asset, KIND, 'the weapon must say which asset it drew');
});

test('both twins draw the asset objects themselves, the procedural geometry is freed, and the old gate is gone', () => {
  const weapon = buildWeapon(palette, KIND);
  const asset = syntheticAsset();
  const bodyNode = asset.scene.getObjectByName('body'), actionNode = asset.scene.getObjectByName('action');
  const oldBody = weapon.group.children.find(child => child.isMesh).geometry;
  const oldAction = weapon.action.geometry, oldGate = weapon.action;
  const disposed = new Set();
  for (const geometry of [oldBody, oldAction]) geometry.addEventListener('dispose', () => disposed.add(geometry));
  assert.equal(applyWeaponAsset(weapon, KIND, asset), true);

  const held = weapon.group.children.find(child => child.isMesh), stowedBody = weapon.stowed.children.find(child => child.isMesh);
  assert.equal(held.geometry, bodyNode.geometry, 'the held body must draw the asset geometry, not a clone');
  assert.equal(held.material, bodyNode.material, 'the held body must draw the asset material, not a clone');
  assert.equal(stowedBody.geometry, bodyNode.geometry, 'the stowed twin must share the same geometry');
  assert.equal(stowedBody.material, bodyNode.material);
  assert.ok(held.castShadow && held.receiveShadow && stowedBody.castShadow && stowedBody.receiveShadow);
  assert.equal(weapon.group.getObjectByName(`reload-action-mesh-${KIND}`).geometry, actionNode.geometry);
  assert.equal(weapon.stowed.getObjectByName(`stowed-reload-action-mesh-${KIND}`).geometry, actionNode.geometry);

  assert.deepEqual([...disposed], [oldBody, oldAction].filter(g => disposed.has(g)), 'unexpected disposal');
  assert.ok(disposed.has(oldBody), 'the procedural body batch was not disposed');
  assert.ok(disposed.has(oldAction), 'the procedural action batch was not disposed');
  assert.equal(oldGate.parent, null, 'the procedural loading gate is still in the group');
  assert.equal(weapon.group.children.filter(child => child.isMesh).length, 1, 'only the body mesh hangs directly off the group');
});

test('both muzzle sockets move to the asset muzzle node', () => {
  const weapon = upgraded();
  closeTo(weapon.socket.position, MUZZLE, 'held muzzle');
  closeTo(weapon.stowedSocket.position, MUZZLE, 'stowed muzzle');
  weapon.group.updateMatrixWorld(true);
  closeTo(weapon.socket.getWorldPosition(new THREE.Vector3()), MUZZLE, 'muzzle world position');
});

test('the frame code\'s three action lines swing the part about the asset hinge axis through its pivot', () => {
  const weapon = upgraded();
  const carrier = weapon.group.getObjectByName(`reload-action-mesh-${KIND}`);
  const axis = new THREE.Vector3(-1, 0, 0);
  frame(weapon, 0);
  closeTo(CARRIER_POINT.clone().applyMatrix4(carrier.matrixWorld), PIVOT.clone().add(CARRIER_POINT),
    'at rest the part must sit exactly where the GLB placed it');
  frame(weapon, 1);
  const expected = PIVOT.clone().add(new THREE.Vector3(0, .2 * Math.cos(1.15), .2 * Math.sin(1.15)));
  closeTo(CARRIER_POINT.clone().applyMatrix4(carrier.matrixWorld), expected, 'fully open hammer');
  // The same maths for every intermediate frame and for a hinge axis that is not the default.
  for (const open of [0, .17, .5, .83, 1]) {
    frame(weapon, open);
    closeTo(CARRIER_POINT.clone().applyMatrix4(carrier.matrixWorld),
      PIVOT.clone().add(CARRIER_POINT.clone().applyAxisAngle(axis, -1.15 * open)), `open ${open}`);
  }
  const tilted = new THREE.Vector3(-.6, .8, 0).normalize();
  const slanted = upgraded({ hingeAxis: tilted.toArray() });
  const slantedCarrier = slanted.group.getObjectByName(`reload-action-mesh-${KIND}`);
  for (const open of [0, .5, 1]) {
    frame(slanted, open);
    closeTo(CARRIER_POINT.clone().applyMatrix4(slantedCarrier.matrixWorld),
      PIVOT.clone().add(CARRIER_POINT.clone().applyAxisAngle(tilted, -1.15 * open)), `slanted hinge, open ${open}`);
  }
});

test('the stowed action never moves while the held one is animated', () => {
  const weapon = upgraded();
  const stowedCarrier = weapon.stowed.getObjectByName(`stowed-reload-action-mesh-${KIND}`);
  frame(weapon, 0);
  const rest = stowedCarrier.matrixWorld.clone();
  const restPoint = CARRIER_POINT.clone().applyMatrix4(stowedCarrier.matrixWorld);
  closeTo(restPoint, PIVOT.clone().add(CARRIER_POINT), 'the stowed part sits where the GLB placed it');
  for (const open of [.3, 1]) {
    frame(weapon, open);
    assert.deepEqual(stowedCarrier.matrixWorld.elements, rest.elements, 'the stowed twin must never animate');
  }
});

test('an asset with no action leaves an empty hinge rather than a floating procedural gate', () => {
  const weapon = upgraded({ omit: 'action' });
  const action = weapon.group.getObjectByName(`reload-action-${KIND}`);
  assert.equal(action, weapon.action);
  assert.equal(action.children.length, 0, 'nothing should hang off an empty action');
  assert.equal(weapon.group.getObjectByName(`reload-action-mesh-${KIND}`), undefined);
  frame(weapon, 1);
  assert.ok([...weapon.group.children, ...weapon.stowed.children].every(child => !child.isMesh || child.geometry.attributes.position.count > 0));
});

test('a second apply is refused, and a broken asset leaves the procedural gun untouched', () => {
  const weapon = upgraded();
  assert.equal(applyWeaponAsset(weapon, KIND, syntheticAsset()), false, 'a weapon must only be upgraded once');

  for (const omit of ['body', 'muzzle']) {
    const procedural = buildWeapon(palette, KIND);
    const body = procedural.group.children.find(child => child.isMesh);
    const before = {
      geometry: body.geometry, action: procedural.action, actionGeometry: procedural.action.geometry,
      socket: procedural.socket.position.clone(), children: procedural.group.children.length,
    };
    assert.equal(applyWeaponAsset(procedural, KIND, syntheticAsset(KIND, { omit })), false, `a GLB with no ${omit} must be refused`);
    assert.equal(body.geometry, before.geometry, `the procedural body changed after a missing ${omit}`);
    assert.equal(procedural.action, before.action);
    assert.equal(procedural.action.geometry, before.actionGeometry);
    assert.ok(procedural.action.geometry.attributes.position.count > 0, 'the procedural gate was disposed anyway');
    closeTo(procedural.socket.position, before.socket, 'muzzle socket moved');
    assert.equal(procedural.group.children.length, before.children);
    assert.equal(procedural.asset, undefined);
  }
  assert.equal(applyWeaponAsset(buildWeapon(palette, KIND), KIND, null), false, 'no asset at all');
});

test('two guns upgraded from one asset share its geometry, materials and texture', () => {
  const asset = syntheticAsset();
  markWeaponAssetShared(asset.scene);
  const first = buildWeapon(palette, KIND), second = buildWeapon(palette, KIND);
  assert.equal(applyWeaponAsset(first, KIND, asset), true);
  assert.equal(applyWeaponAsset(second, KIND, asset), true);
  const body = weapon => weapon.group.children.find(child => child.isMesh);
  assert.equal(body(first).geometry, body(second).geometry, 'each gun must draw the one loaded geometry');
  assert.equal(body(first).material, body(second).material);
  assert.equal(first.group.getObjectByName(`reload-action-mesh-${KIND}`).geometry,
    second.group.getObjectByName(`reload-action-mesh-${KIND}`).geometry);
  // world.js's disposeObject skips anything flagged shared, which is what keeps one loot drop
  // expiring from blanking every other gun on screen.
  let meshes = 0;
  for (const weapon of [first, second]) for (const group of [weapon.group, weapon.stowed]) group.traverse(node => {
    if (!node.isMesh) return;
    meshes++;
    assert.equal(node.geometry.userData.shared, true, 'shared flag missing from a drawn geometry');
    assert.equal(node.material.userData.shared, true, 'shared flag missing from a drawn material');
    if (node.material.map) assert.equal(node.material.map.userData.shared, true, 'shared flag missing from a drawn texture');
  });
  assert.equal(meshes, 8, 'two guns, each a held and stowed body plus a held and stowed action mesh');
});

test('a two-primitive body (albedo plus the dark fill for cut faces) draws both parts on both twins', () => {
  const asset = syntheticAsset(KIND, { split: true });
  markWeaponAssetShared(asset.scene);
  const parts = [];
  asset.scene.getObjectByName('body').traverse(node => { if (node.isMesh) parts.push(node); });
  assert.equal(parts.length, 2, 'the fixture must mimic GLTFLoader\'s group-per-multi-primitive-mesh');
  const weapon = buildWeapon(palette, KIND);
  assert.equal(applyWeaponAsset(weapon, KIND, asset), true);
  for (const [group, prefix] of [[weapon.group, `${KIND}-body`], [weapon.stowed, `stowed-${KIND}-body`]]) {
    const body = group.children.find(child => child.isMesh);
    assert.equal(body.geometry, parts[0].geometry, 'primitive 0 goes on the kept mesh object');
    const extra = group.getObjectByName(`${prefix}-part-1`);
    assert.ok(extra, `${prefix}-part-1 is missing: the fill primitive was dropped`);
    assert.equal(extra.parent, body, 'extra primitives ride along under the body node transform');
    assert.equal(extra.geometry, parts[1].geometry);
    assert.equal(extra.material, parts[1].material);
    assert.ok(extra.position.lengthSq() === 0 && extra.quaternion.angleTo(new THREE.Quaternion()) === 0,
      'extra primitives share the node transform, they do not add one');
  }
});

test('markWeaponAssetShared flags every geometry, material and map in the loaded scene', () => {
  const asset = syntheticAsset();
  const meshes = [];
  asset.scene.traverse(node => { if (node.isMesh) meshes.push(node); });
  assert.ok(meshes.length >= 2);
  assert.ok(meshes.every(node => node.geometry.userData.shared === undefined), 'a fresh scene starts unflagged');
  assert.equal(markWeaponAssetShared(asset.scene), asset.scene);
  for (const node of meshes) {
    assert.equal(node.geometry.userData.shared, true);
    assert.equal(node.material.userData.shared, true);
    if (node.material.map) assert.equal(node.material.map.userData.shared, true);
  }
  assert.equal(markWeaponAssetShared(null), null, 'no scene is not a crash');
});

test('upgradeWeapon applies a supplied asset, and in Node without one it is a no-op that returns the weapon', () => {
  const supplied = buildWeapon(palette, KIND);
  assert.equal(upgradeWeapon(supplied, KIND, { asset: syntheticAsset() }), supplied);
  assert.equal(supplied.asset, KIND);

  const procedural = buildWeapon(palette, KIND);
  const body = procedural.group.children.find(child => child.isMesh);
  const snapshot = { geometry: body.geometry, action: procedural.action, socket: procedural.socket.position.clone() };
  assert.equal(upgradeWeapon(procedural, KIND), procedural, 'upgradeWeapon always returns the weapon');
  assert.equal(procedural.asset, undefined, 'no window/document means no load and no swap');
  assert.equal(body.geometry, snapshot.geometry);
  assert.equal(procedural.action, snapshot.action);
  closeTo(procedural.socket.position, snapshot.socket, 'muzzle socket');
  assert.equal(upgradeWeapon(procedural, 'repeater'), procedural, 'a kind with no asset is a no-op');
  assert.equal(upgradeWeapon(null, KIND), null);
});

test('every asset wrist-anchor entry is a frozen pair of finite gun-space triples', () => {
  assert.ok(Object.isFrozen(WEAPON_ASSET_HANDLING));
  for (const [kind, entry] of Object.entries(WEAPON_ASSET_HANDLING)) {
    assert.ok(WEAPON_HANDLING[kind], `${kind} is not a gun buildWeapon knows how to hold`);
    assert.ok(Object.isFrozen(entry), `${kind}'s anchors must not be editable by accident`);
    for (const side of ['right', 'left']) {
      assert.ok(Array.isArray(entry[side]) && entry[side].length === 3, `${kind}.${side} must be an [x, y, z] triple`);
      assert.ok(entry[side].every(Number.isFinite), `${kind}.${side} has a non-finite component`);
      // Same gun space as WEAPON_HANDLING: a wrist within arm's length of the grip, not a stance.
      assert.ok(entry[side].every(value => Math.abs(value) < 1.5), `${kind}.${side} is nowhere near the gun`);
    }
    if (entry.supportRoll !== undefined) assert.ok(Number.isFinite(entry.supportRoll), `${kind}.supportRoll`);
  }
});

test('upgrading hands the gun its own wrist anchors, and a kind with no entry gets none', () => {
  const weapon = upgraded();
  assert.equal(weapon.handling, WEAPON_ASSET_HANDLING[KIND], 'the upgraded flintlock must carry the tuned anchors');
  assert.notDeepEqual(weapon.handling.right, WEAPON_HANDLING[KIND].right,
    'the override exists because the GLB grip is not the procedural one');
  for (const side of ['right', 'left']) {
    assert.equal(weapon.handling[side].length, 3);
    assert.ok(weapon.handling[side].every(Number.isFinite), `${side} anchor must be finite`);
  }
  // The renderers read `weapon.handling || WEAPON_HANDLING[kind]`, so a gun whose kind is not in
  // the table has to fall through rather than take a half-filled object.
  const other = buildWeapon(palette, 'repeater');
  assert.equal(WEAPON_ASSET_HANDLING.repeater, undefined, 'this case needs a kind with no tuned anchors');
  assert.equal(applyWeaponAsset(other, 'repeater', syntheticAsset('repeater')), true);
  assert.equal(other.handling, null, 'an untuned kind must fall back to WEAPON_HANDLING');
  assert.ok(!other.handling, 'and must be falsy so the || in the renderers picks the procedural pair');
});

test('the scatter upgrades to its own GLB and its own wrist anchors', () => {
  assert.equal(WEAPON_ASSET_URLS.scatter, '/assets/weapons/scatter.glb', "the blunderbuss's asset URL is frozen in");
  const weapon = upgraded({}, 'scatter');
  assert.equal(weapon.asset, 'scatter');
  assert.equal(weapon.handling, WEAPON_ASSET_HANDLING.scatter, 'the upgraded scatter must carry its own anchors');
  for (const side of ['right', 'left']) {
    assert.equal(weapon.handling[side].length, 3, `${side} anchor must be an [x, y, z] triple`);
    assert.ok(weapon.handling[side].every(Number.isFinite), `${side} anchor must be finite`);
  }
  // Tuned in the character studio against the shipped GLB, whose grip is raked back to z .19 .. .43
  // and whose fore-end is a tube fused to the barrel rather than a block hanging to y -.18: both
  // wrists ride up and back, so neither anchor may be the procedural pair any more.
  assert.notDeepEqual([...weapon.handling.right], WEAPON_HANDLING.scatter.right,
    'the firing override exists because the GLB grip is not the procedural slab');
  assert.notDeepEqual([...weapon.handling.left], WEAPON_HANDLING.scatter.left,
    'the support override exists because the GLB fore-end is not the procedural block');
  closeTo(weapon.socket.position, MUZZLE, 'the scatter muzzle socket moves to the asset node');
});

test("the scatter's loading gate swings about the asset hinge axis through the asset pivot", () => {
  const weapon = upgraded({}, 'scatter');
  const carrier = weapon.group.getObjectByName('reload-action-mesh-scatter');
  assert.ok(carrier, 'the scatter must get the same hinge -> action -> mesh carrier chain');
  // buildWeapon gives the scatter the flintlock's loading gate, so the frame code parks the action
  // at its own procedural actionOrigin and the chain still has to cancel that translation.
  near(weapon.actionOrigin.x, -.115, "actionOrigin is buildWeapon's scatter gate, untouched");
  const axis = new THREE.Vector3(-1, 0, 0);
  frame(weapon, 0);
  closeTo(CARRIER_POINT.clone().applyMatrix4(carrier.matrixWorld), PIVOT.clone().add(CARRIER_POINT),
    'at rest the scatter gate must sit exactly where the GLB placed it');
  for (const open of [0, .17, .5, .83, 1]) {
    frame(weapon, open);
    closeTo(CARRIER_POINT.clone().applyMatrix4(carrier.matrixWorld),
      PIVOT.clone().add(CARRIER_POINT.clone().applyAxisAngle(axis, -1.15 * open)), `scatter open ${open}`);
  }
  const stowedCarrier = weapon.stowed.getObjectByName('stowed-reload-action-mesh-scatter');
  closeTo(CARRIER_POINT.clone().applyMatrix4(stowedCarrier.matrixWorld), PIVOT.clone().add(CARRIER_POINT),
    'the stowed scatter never animates');
});

test('a gun that never upgraded keeps the procedural fit and carries no anchors of its own', () => {
  const procedural = buildWeapon(palette, KIND);
  assert.equal(procedural.handling, undefined, 'buildWeapon must not invent a handling override');
  assert.equal(upgradeWeapon(procedural, KIND), procedural, 'in Node with no asset nothing loads');
  assert.equal(procedural.handling, undefined, 'a no-op upgrade must not set anchors either');
  // A refused apply (no muzzle node) is the other way a gun stays procedural.
  const refused = buildWeapon(palette, KIND);
  assert.equal(applyWeaponAsset(refused, KIND, syntheticAsset(KIND, { omit: 'muzzle' })), false);
  assert.equal(refused.handling, undefined, 'a refused upgrade must leave the procedural gun alone');
});

test('an upgraded gun still answers buildWeapon\'s gun-space contract for the animate loops', () => {
  const weapon = upgraded();
  // The shape world.js, player-character.js and the studio destructure.
  for (const key of ['group', 'stowed', 'socket', 'stowedSocket', 'action', 'actionOrigin']) {
    assert.ok(weapon[key], `${key} disappeared from the upgraded weapon`);
  }
  near(weapon.actionOrigin.x, -.115, 'actionOrigin is buildWeapon\'s, untouched');
  for (const open of [0, .5, 1]) {
    frame(weapon, open);
    near(weapon.action.position.x, weapon.actionOrigin.x, 'the frame code still owns the action position');
    near(weapon.action.rotation.z, -1.15 * open, 'the frame code still owns the action rotation');
    assert.ok(weapon.socket.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite));
  }
  // Visibility toggling and scaling, the two other things the rigs do to a weapon, still reach it.
  weapon.group.scale.setScalar(.78); weapon.stowed.scale.setScalar(.78);
  weapon.group.visible = false; weapon.stowed.visible = true;
  frame(weapon, .49);
  const stowedMuzzle = weapon.stowedSocket.getWorldPosition(new THREE.Vector3());
  closeTo(stowedMuzzle, MUZZLE.clone().multiplyScalar(.78), 'the stowed muzzle scales with its rig');
  const bounds = new THREE.Box3().setFromObject(weapon.group);
  assert.ok(bounds.min.toArray().every(Number.isFinite) && !bounds.isEmpty(), 'the upgraded gun still has a drawable envelope');
});
