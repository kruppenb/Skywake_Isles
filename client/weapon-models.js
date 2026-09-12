// Skywake guns: the Meshy-built GLB weapons swapped over the procedural ones at runtime.
//
// buildWeapon(palette, kind) in client/models.js stays the fallback and the studio comparison. It
// returns { group, stowed, socket, stowedSocket, action, actionOrigin } in gun space -- -Z forward
// (the muzzle direction), +Y up, +X the lock-plate side -- with group children [body mesh, action
// mesh, muzzle socket] and a stowed twin that mirrors them. upgradeWeapon() loads
// /assets/weapons/<kind>.glb once per page and applyWeaponAsset() rewrites that structure in
// place: the body mesh keeps its own object and name and only swaps geometry/material, the muzzle
// sockets move to the GLB's muzzle node, and the moving part is re-hung under a hinge group.
// Nothing outside this file changes, so stances, reload strokes, recoil, the muzzle socket, the
// stowed-on-back gun and the ground loot ring all keep working, and buildPirate stays procedural.
//
// The GLB's geometry, materials and textures are flagged userData.shared, exactly as
// loadNavigatorAsset does, so world.js's disposeObject never frees what another gun still draws.
//
// ------------------------------------------------------------------------------------ the hinge
// The animate loops in client/player-character.js and client/models.js drive the moving part with
// exactly three lines per frame, and this file must not make them change:
//
//   action.position.copy(actionOrigin); action.rotation.set(0, 0, 0); action.rotation.z = -1.15 * open;
//
// that is: a rotation about the *local Z* axis of an object parked at the procedural actionOrigin.
// A GLB hammer instead hinges about its own axis `a` (node extras `hingeAxis`, unit, gun space)
// through its own pivot `P` (the action node's position, with its vertices authored relative to
// P). The swap layer converts one into the other by wrapping the action in a carrier chain. With
// Q = setFromUnitVectors((0,0,1), a) -- the rotation that takes local +Z onto the hinge axis:
//
//   hinge   Group,    quaternion = Q,  position = P - Q*actionOrigin
//   |- action         Object3D, driven by the frame code: position = actionOrigin, rotation.z = t
//      |- mesh        quaternion = Q^-1, position = 0, carrying the GLB's action geometry
//
// Multiplying the chain out for a mesh-local point p, and using Q*T(v) = T(Q*v)*Q:
//
//   T(P - Q*actionOrigin) * Q * T(actionOrigin) * Rz(t) * Q^-1 * p
//     = T(P) * Q * Rz(t) * Q^-1 * p
//     = P + Rot(a, t) * p
//
// The translation cancels, so where the frame code parks the action no longer matters; the carrier
// swings by t radians about the GLB's own axis through the GLB's own pivot. Q^-1 on the mesh is
// what cancels Q at rest: at t = 0 the part sits exactly where the GLB placed it, never born
// rotated onto the hinge axis. The stowed twin gets the same chain and is never animated.
//
// The long guns translate a magazine or a bolt instead of rotating a hammer -- the frame code leaves
// the rotation at zero and writes `position = actionOrigin + d` (the repeater's d is
// (-.26, -.12, 0) * open) -- and the same chain carries that unchanged, because
//
//   T(P - Q*actionOrigin) * Q * T(actionOrigin + d) * Q^-1 * p = P + Q*d + p
//
// So a part whose `hingeAxis` is +Z, giving Q = identity, slides by exactly the frame code's d in
// gun space; any other axis would slide it along a rotated d instead. That is why the translating
// kinds' GLBs are built with `--hinge-axis 0 0 1`.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const WEAPON_ASSET_URLS = Object.freeze({
  flintlock: '/assets/weapons/flintlock.glb',
  scatter: '/assets/weapons/scatter.glb',
  repeater: '/assets/weapons/repeater.glb',
});

// Where the navigator's wrists go once a GLB is drawing instead of the procedural gun. Same gun
// space, same meaning and same units as WEAPON_HANDLING.<kind>.right / .left in client/models.js
// (the back of each palm, before FIRING_HAND_OFFSET / SUPPORT_HAND_OFFSET and the .78 weapon
// scale), and an optional `supportRoll` for a kind that needs one. This lives in JS rather than in
// the GLB or its manifest because it is not a property of the mesh: it is a fit between one mesh
// and one character's hands, retuned whenever either changes, and the asset tests must stay able
// to check the shipped bytes without knowing anything about who holds the gun.
//
// The flintlock's approved design rakes its grip to about half the procedural grip's height and
// sets it further back (mid-grip y = -.19, grip centroid z = .17, against the procedural slab's
// y = -.25, z = 0), so both wrists ride up and back from the procedural anchors. Measured in the
// character studio against the shipped GLB: the firing palm centre -- the RightHand bone plus .25
// gun units along the frame code's finger basis -- then sits .032 off the nearest grip vertex, and
// the support palm .011 off the butt, against .171 and .235 with the procedural anchors.
export const WEAPON_ASSET_HANDLING = Object.freeze({
  flintlock: Object.freeze({
    right: Object.freeze([.055, -.025, .375]),
    left: Object.freeze([-.20, -.085, .28]),
  }),
  // The scatter GLB moves both wrists up and back, for two different reasons. Its grip is the
  // flintlock's rake, not the procedural slab at z ~ 0: below y = -.15 the grip column runs
  // z .19 .. .43, so the firing wrist goes up .095, back .19 and .035 inboard. Its fore-end is a
  // round wooden tube fused to the barrel whose underside is only y = -.01 at z = -.45, where the
  // procedural block hung down to y = -.18, so the support wrist goes up .114 and back .04 instead
  // of reaching for wood that is not there any more. Measured in the character studio against the
  // shipped GLB: the firing palm -- the RightHand bone plus .25 gun units along the frame code's
  // finger basis -- sits .040 off the nearest grip vertex and the support palm .023 under the
  // fore-end, against .212 and .165 with the procedural anchors.
  scatter: Object.freeze({
    right: Object.freeze([.02, -.05, .40]),
    left: Object.freeze([-.228, -.086, -.28]),
  }),
  // The repeater GLB is a narrow carbine (|x| <= .095 against the procedural slab's .21), so both
  // wrists ride up and inboard. Its pistol grip is a short wood column at z .04 .. .18 whose bottom
  // is only y = -.146, where the procedural grip sphere hung to y = -.34 at z .08 .. .30, so the
  // firing wrist goes up .178, back .051 and .065 inboard. Its fore-end is a thin tube fused to the
  // barrel, underside y .065 .. .077 at z -.52 .. -.55, where the procedural block hung to y = -.135:
  // the procedural support anchor left the off hand .217 from that wood and only .151 from the
  // magazine -- cupping the magazine, which then slides out from under it on every reload -- so the
  // support wrist goes up .169, .023 inboard and .033 forward, onto the wooden finger groove at
  // z -.51 .. -.64. Measured in the character studio against the shipped GLB: the firing palm -- the
  // RightHand bone plus .25 gun units along the frame code's finger basis -- sits .034 off the
  // nearest grip vertex and the support palm .030 under the fore-end, against .224 and .217 with the
  // procedural anchors. (tools/qa/weapons/tune.mjs reports the support distance against a y band of
  // [-.30, .05], which cannot see this carbine's fore-end underside at all; .030 is the distance to
  // the nearest body vertex with the band lifted.)
  repeater: Object.freeze({
    right: Object.freeze([-.010, .033, .261]),
    left: Object.freeze([-.242, -.011, -.353]),
  }),
});

// The nodes every shipped gun GLB carries (docs: "Shipped asset contract"). `action` is optional:
// a gun whose moving part could not be separated cleanly ships without one.
export const WEAPON_NODES = Object.freeze({ body: 'body', action: 'action', muzzle: 'muzzle' });
// A hammer cocking back (its top moving toward +Z) turns about -X; assets say so in extras, and
// this is the fallback when they do not.
export const DEFAULT_HINGE_AXIS = Object.freeze([-1, 0, 0]);

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const workVector = new THREE.Vector3(), workMatrix = new THREE.Matrix4();
const workQuaternion = new THREE.Quaternion(), workScale = new THREE.Vector3();

// ------------------------------------------------------------------- loading --
const assetPromises = new Map();
let warned = false;

// Flags every geometry, material and base-colour map shared, the same contract loadNavigatorAsset
// uses: one loaded GLB backs every pirate's gun and every loot drop of that kind on screen, so
// disposing one of them must never free what the rest still draw.
export function markWeaponAssetShared(scene) {
  if (scene) scene.traverse(node => {
    if (!node.isMesh) return;
    if (node.geometry) node.geometry.userData.shared = true;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue;
      material.userData.shared = true;
      if (material.map) material.map.userData.shared = true;
    }
  });
  return scene;
}

// Loads one gun GLB per kind per page. A rejected load clears its cache entry so a later pirate
// can retry; kinds with no shipped asset return null and stay procedural.
export function loadWeaponAsset(kind, url = WEAPON_ASSET_URLS[kind]) {
  if (!url) return null;
  let pending = assetPromises.get(kind);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(url).then(gltf => ({ scene: markWeaponAssetShared(gltf.scene), url, kind }));
    pending.catch(() => { if (assetPromises.get(kind) === pending) assetPromises.delete(kind); });
    assetPromises.set(kind, pending);
  }
  return pending;
}

function canLoadInThisRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

// --------------------------------------------------------------------- swap --
// Every mesh a named asset node draws. A glTF mesh with two primitives (the textured body plus the
// dark `fill` for cut faces) arrives from GLTFLoader as a Group of meshes sharing the node's
// transform, so the extras ride along as identity-placed children of the first one.
function meshesOf(node) {
  if (!node) return [];
  if (node.isMesh) return [node];
  const found = [];
  node.traverse(child => { if (child.isMesh) found.push(child); });
  return found;
}

// Gun space is the asset scene's frame; the contract pins the `<kind>` root at identity, and
// reading through matrixWorld keeps the maths right even if an exporter adds a wrapper.
function gunSpace(scene) {
  scene.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  return (node, position, quaternion = workQuaternion, scale = workScale) => {
    workMatrix.multiplyMatrices(inverse, node.matrixWorld).decompose(position, quaternion, scale);
    return position;
  };
}

function hingeQuaternion(node) {
  const extras = node && node.userData ? node.userData.hingeAxis : null;
  const axis = workVector.fromArray(Array.isArray(extras) && extras.length >= 3 && extras.every(Number.isFinite)
    ? extras : DEFAULT_HINGE_AXIS);
  if (axis.lengthSq() < 1e-12) axis.fromArray(DEFAULT_HINGE_AXIS);
  return new THREE.Quaternion().setFromUnitVectors(Z_AXIS, axis.normalize());
}

function attachExtraParts(mesh, parts, prefix) {
  for (let i = 1; i < parts.length; i++) {
    const extra = new THREE.Mesh(parts[i].geometry, parts[i].material);
    extra.name = `${prefix}-part-${i}`;
    extra.castShadow = extra.receiveShadow = true;
    mesh.add(extra);
  }
}

// The held and stowed bodies keep their own mesh objects (and the held one its name), so anything
// holding a reference to them -- the studio, the loot ring, world.js's disposal -- keeps working.
function swapBody(mesh, parts, place, node, prefix, retired) {
  if (mesh.geometry) retired.add(mesh.geometry);
  mesh.geometry = parts[0].geometry;
  mesh.material = parts[0].material;
  place(node, mesh.position, mesh.quaternion, mesh.scale);
  mesh.castShadow = mesh.receiveShadow = true;
  attachExtraParts(mesh, parts, prefix);
}

// Replaces one procedural action mesh with the hinge -> action -> mesh chain described at the top
// of this file, and returns the new action object for the frame code to drive.
function rehinge(parent, previous, kind, prefix, node, parts, place, actionOrigin, retired) {
  if (previous) {
    if (previous.geometry) retired.add(previous.geometry);
    previous.removeFromParent();
  }
  const hinge = new THREE.Group(); hinge.name = `${prefix}reload-hinge-${kind}`;
  const action = new THREE.Object3D(); action.name = `${prefix}reload-action-${kind}`;
  action.position.copy(actionOrigin);
  hinge.add(action); parent.add(hinge);
  // Without an action node the chain stays identity and empty: no floating procedural gate, and
  // the frame code's three lines still find something to write to.
  if (node && parts.length) {
    const quaternion = hingeQuaternion(node);
    hinge.quaternion.copy(quaternion);
    place(node, hinge.position);
    hinge.position.sub(workVector.copy(actionOrigin).applyQuaternion(quaternion));
    const mesh = new THREE.Mesh(parts[0].geometry, parts[0].material);
    mesh.name = `${prefix}reload-action-mesh-${kind}`;
    mesh.quaternion.copy(quaternion).invert();
    mesh.castShadow = mesh.receiveShadow = true;
    action.add(mesh);
    attachExtraParts(mesh, parts, `${prefix}reload-action-${kind}`);
  }
  return action;
}

// Synchronous, pure three.js: rewrites a buildWeapon() result to draw `asset` instead. Returns
// false and leaves the procedural gun completely untouched when the asset is unusable or the
// weapon has already been upgraded.
export function applyWeaponAsset(weapon, kind, asset) {
  const scene = asset && (asset.scene || (asset.isObject3D ? asset : null));
  if (!weapon || !weapon.group || !weapon.stowed || !scene || weapon.asset) return false;
  const bodyNode = scene.getObjectByName(WEAPON_NODES.body);
  const muzzleNode = scene.getObjectByName(WEAPON_NODES.muzzle);
  const bodyParts = meshesOf(bodyNode);
  const heldBody = weapon.group.children.find(child => child.isMesh);
  const stowedBody = weapon.stowed.children.find(child => child.isMesh);
  if (!bodyParts.length || !muzzleNode || !heldBody || !stowedBody) return false;

  const place = gunSpace(scene);
  const actionNode = scene.getObjectByName(WEAPON_NODES.action);
  const actionParts = meshesOf(actionNode);
  const retired = new Set();

  swapBody(heldBody, bodyParts, place, bodyNode, `${kind}-body`, retired);
  swapBody(stowedBody, bodyParts, place, bodyNode, `stowed-${kind}-body`, retired);

  const stowedAction = weapon.stowed.getObjectByName(`stowed-reload-action-${kind}`);
  weapon.action = rehinge(weapon.group, weapon.action, kind, '', actionNode, actionParts, place, weapon.actionOrigin, retired);
  rehinge(weapon.stowed, stowedAction, kind, 'stowed-', actionNode, actionParts, place, weapon.actionOrigin, retired);

  place(muzzleNode, weapon.socket.position);
  weapon.stowedSocket.position.copy(weapon.socket.position);
  // The procedural batches are this gun's alone (their material is the shared palette solid, which
  // every other prop still draws), so only the geometry is freed.
  for (const geometry of retired) if (!geometry.userData.shared) geometry.dispose();
  weapon.asset = kind;
  // The renderers read this instead of WEAPON_HANDLING's wrist anchors when it is set; a gun that
  // never upgraded leaves it undefined and keeps the procedural fit.
  weapon.handling = WEAPON_ASSET_HANDLING[kind] || null;
  return true;
}

// The call-site entry point. Applies a supplied asset immediately; in a browser with no asset it
// loads the kind's GLB and applies it on resolve; in Node it is a no-op. Always returns `weapon`,
// so `upgradeWeapon(buildWeapon(palette, kind), kind)` is a drop-in for `buildWeapon(...)`.
export function upgradeWeapon(weapon, kind, { asset = null, url } = {}) {
  if (!weapon) return weapon;
  if (asset) { applyWeaponAsset(weapon, kind, asset); return weapon; }
  if (!canLoadInThisRuntime()) return weapon;
  const source = url || WEAPON_ASSET_URLS[kind];
  const pending = source ? loadWeaponAsset(kind, source) : null;
  if (pending) pending.then(loaded => {
    if (weapon.disposed) return;
    try {
      applyWeaponAsset(weapon, kind, loaded);
    } catch (error) {
      if (!warned) { warned = true; console.warn(`weapon model ${source} is unusable, keeping the procedural gun`, error); }
    }
  }, error => {
    if (!warned) { warned = true; console.warn(`weapon model ${source} failed to load, keeping the procedural gun`, error); }
  });
  return weapon;
}
