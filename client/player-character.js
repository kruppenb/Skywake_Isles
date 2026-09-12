// Skywake navigator: the Meshy-built player character as the live pirate renderer.
//
// buildPlayerCharacter() keeps buildPirate's external contract — { group, animate(time, speed,
// player, pose), fire(weapon), getMuzzle(target) } — so client/world.js drives both the same
// way. The procedural pirate is built first and shown until the GLB has loaded (or forever if it
// cannot), then the navigator rig takes over inside the same group:
//
//   group                      positioned/yawed by world.js
//   ├─ figure                  glide pitch and knockback roll, as in buildPirate
//   │  ├─ SkywakeNavigator     the cloned GLB (skinned mesh + 29-joint Mixamo-named skeleton)
//   │  └─ torso                weapon aim/recoil rig and back stow rig, in buildPirate's torso space
//   ├─ pirate-glider           the shared crew-coloured glider, grips at (±.70, 2.29, −.17)
//   └─ pirate-contact-shadow
//
// Locomotion comes from the GLB's idle/walk/run clips blended by speed, with walk and run keyed
// to a distance-driven cycle so feet do not slide. Everything the gameplay needs a hand for
// (five weapon stances, reload strokes, recoil, glider grips, mounted cannon rails) is the same
// analytic two-bone arm IK as buildPirate, now written onto the LeftArm/ForeArm/Hand bones in
// figure space after the mixer has posed the body. Knockback and gliding bend the leg bones
// additively; the head follows the aim pitch.
//
// Crew colour: navigator-meshy.glb ships one opaque material whose base-colour PNG carries the
// accent mask (lapels, cuffs, collar, sash, lining) in its alpha channel; the material extras say
// so (`crewMask: "baseColorAlpha"`) and record the baked coral the mask was measured against
// (`crewReference`). The tint replaces the baked coral per texel, keeping the painted shading:
// out = albedo / reference * tint, mixed in by the mask. Alpha never reaches blending, so the
// material stays OPAQUE for every other viewer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { WEAPON_ORDER, WEAPONS } from '../shared/weapons.js';
import { buildPirate, buildWeapon, buildGlider, WEAPON_HANDLING } from './models.js';
import { upgradeWeapon } from './weapon-models.js';
import { sampleReloadAnimation } from './reload-animation.js';

export const NAVIGATOR_URL = '/assets/player-character/navigator-meshy.glb';
export const CREW_MASK_CONVENTION = 'baseColorAlpha';
const DEFAULT_REFERENCE = [0.7, 0.4, 0.35];

// ------------------------------------------------------------------ crew tint --
const CREW_MAP_FRAGMENT = /* glsl */`
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	vec3 crewRecolored = clamp( sampledDiffuseColor.rgb / max( crewReference, vec3( 0.02 ) ) * crewTint, 0.0, 1.0 );
	diffuseColor.rgb *= mix( sampledDiffuseColor.rgb, crewRecolored, sampledDiffuseColor.a );
#endif
`;
const crewUniforms = new WeakMap();

export function isCrewMaskMaterial(material) {
  return !!material && !!material.userData && material.userData.crewMask === CREW_MASK_CONVENTION;
}

// Installs the per-texel tint on a material that follows the convention. Each material instance
// carries its own uniforms, so cloning the material per player and calling this on the clone gives
// every pirate an independent crew colour while all of them share one compiled program.
export function installCrewTint(material, hex = '#eb785d') {
  if (!isCrewMaskMaterial(material)) return false;
  const reference = Array.isArray(material.userData.crewReference) && material.userData.crewReference.length >= 3
    ? material.userData.crewReference : DEFAULT_REFERENCE;
  const uniforms = {
    crewTint: { value: new THREE.Color().setStyle(hex, THREE.SRGBColorSpace) },
    crewReference: { value: new THREE.Color().setRGB(reference[0], reference[1], reference[2], THREE.SRGBColorSpace) },
  };
  crewUniforms.set(material, uniforms);
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 crewTint;\nuniform vec3 crewReference;')
      .replace('#include <map_fragment>', CREW_MAP_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'skywake-crew-mask';
  material.needsUpdate = true;
  return true;
}

export function setCrewTint(material, hex) {
  const uniforms = crewUniforms.get(material);
  if (!uniforms || typeof hex !== 'string') return false;
  uniforms.crewTint.value.setStyle(hex, THREE.SRGBColorSpace);
  return true;
}

export function crewTintHex(material) {
  const uniforms = crewUniforms.get(material);
  return uniforms ? `#${uniforms.crewTint.value.getHexString(THREE.SRGBColorSpace)}` : null;
}

// ------------------------------------------------------------------- loading --
let assetPromise = null;
let warned = false;

// Loads the GLB once per page. Geometry and texture are flagged shared so world.js's disposal of
// one pirate never frees what the others still draw.
export function loadNavigatorAsset(url = NAVIGATOR_URL) {
  if (!assetPromise) {
    assetPromise = new GLTFLoader().loadAsync(url).then(gltf => {
      gltf.scene.traverse(node => {
        if (!node.isMesh) return;
        node.geometry.userData.shared = true;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          material.userData.shared = true;
          if (material.map) material.map.userData.shared = true;
        }
      });
      return { scene: gltf.scene, animations: gltf.animations, url };
    });
    assetPromise.catch(() => { assetPromise = null; });
  }
  return assetPromise;
}

function canLoadInThisRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

// ----------------------------------------------------------------- constants --
// buildPirate's shoulder line in its torso space; stances are scaled toward it by the ratio of the
// navigator's real arm reach to the procedural arms so every gun sits within reach.
const PROCEDURAL_SHOULDER = new THREE.Vector3(0, .745, .015);
const PROCEDURAL_REACH = .52 + .57;
// The guns were modelled for the procedural pirate's block hands; the navigator holds them at
// this scale, its firing hand shifted onto the grip's outer face instead of engulfing it.
const WEAPON_SCALE = .78;
// The procedural anchors mark the back of a block palm; the navigator's wrist joint sits a little
// higher and further back so its palm, 9 cm along the fingers, lands on the grip and fore-end.
const FIRING_HAND_OFFSET = new THREE.Vector3(.11, .05, .06);
const SUPPORT_HAND_OFFSET = new THREE.Vector3(-.03, -.02, .05);
const STANCE_DEPTH_KEEP = .9;   // stances keep most of their forward reach; the reach clamp does the rest
const WALK_CYCLE = 2.2, RUN_CYCLE = 3.2;      // metres of travel per stride cycle
const SPRINT_FROM = 3.0, SPRINT_TO = 6.5;     // m/s band that cross-fades walk into run
// Meshy's library idle is a look-around that turns the hips 54° and the head 56°; in gameplay the
// pirate should face where it aims. The idle plays at this fraction of its motion against its
// own first frame, which keeps the breathing and small glances and drops the body turn.
const IDLE_MOTION = .25;
const BONE_NAMES = {
  hips: 'Hips', spine: 'Spine', head: 'Head', stow: 'stow_back',
  shoulder: { L: 'LeftShoulder', R: 'RightShoulder' }, upper: { L: 'LeftArm', R: 'RightArm' },
  fore: { L: 'LeftForeArm', R: 'RightForeArm' }, hand: { L: 'LeftHand', R: 'RightHand' },
  thigh: { L: 'LeftUpLeg', R: 'RightUpLeg' }, shin: { L: 'LeftLeg', R: 'RightLeg' },
};
const UP = new THREE.Vector3(0, 1, 0), FORWARD = new THREE.Vector3(0, 0, -1), AXIS_X = new THREE.Vector3(1, 0, 0);
const ease = (a, target, rate, dt) => THREE.MathUtils.lerp(a, target, 1 - Math.exp(-rate * dt));
const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ builder --
export function buildPlayerCharacter(palette, color = '#eb785d', { url = NAVIGATOR_URL, asset = null } = {}) {
  const group = new THREE.Group(); group.name = 'pirate'; group.userData.kind = 'pirate';
  let fallback = buildPirate(palette, color); group.add(fallback.group);
  let navigator = null, disposed = false;
  const ready = asset ? Promise.resolve(asset) : canLoadInThisRuntime() ? loadNavigatorAsset(url) : null;
  if (ready) {
    ready.then(loaded => {
      if (disposed) return;
      try {
        navigator = buildNavigator(loaded, palette, color, group);
      } catch (error) {
        if (!warned) { warned = true; console.warn('navigator rig unusable, keeping the procedural pirate', error); }
        return;
      }
      group.remove(fallback.group); disposeProcedural(fallback.group); fallback = null;
    }, error => {
      if (!warned) { warned = true; console.warn(`player character ${url} failed to load, keeping the procedural pirate`, error); }
    });
  }
  return {
    group,
    get kind() { return navigator ? 'navigator' : 'procedural'; },
    animate(time, speed, player, pose) { (navigator || fallback).animate(time, speed, player, pose); },
    fire(weapon) { (navigator || fallback).fire(weapon); },
    getMuzzle(target) { return (navigator || fallback).getMuzzle(target); },
    setCrewColor(hex) { if (navigator) navigator.setCrewColor(hex); },
    // The rig's innards, for the character studio only: null until the GLB has built a navigator.
    get debug() { return navigator ? navigator.debug : null; },
    dispose() { disposed = true; if (navigator) navigator.dispose(); },
  };
}

function disposeProcedural(object) {
  object.traverse(child => { if (child.isMesh && child.geometry) child.geometry.dispose(); });
  object.removeFromParent();
}

function buildNavigator(asset, palette, color, group) {
  const figure = new THREE.Group(); figure.name = 'navigator-figure'; group.add(figure);
  const root = cloneSkeleton(asset.scene); root.name = 'SkywakeNavigator'; figure.add(root);
  const materials = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    node.frustumCulled = false; node.castShadow = true; node.receiveShadow = true;
    const clone = material => { const copy = material.clone(); copy.userData.shared = false; installCrewTint(copy, color); materials.push(copy); return copy; };
    node.material = Array.isArray(node.material) ? node.material.map(clone) : clone(node.material);
  });
  const bone = name => {
    const found = root.getObjectByName(name);
    if (!found) throw new Error(`navigator bone ${name} missing`);
    return found;
  };
  const bones = {
    hips: bone(BONE_NAMES.hips), spine: bone(BONE_NAMES.spine), head: bone(BONE_NAMES.head), stow: bone(BONE_NAMES.stow),
  };

  // Rest-pose measurements in figure space (metres, -Z forward), taken before any clip runs.
  figure.updateMatrixWorld(true);
  const figureInv = new THREE.Matrix4().copy(figure.matrixWorld).invert();
  const relative = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  const frameOf = (node, outPosition, outQuaternion) => {
    relative.multiplyMatrices(figureInv, node.matrixWorld).decompose(outPosition || position, outQuaternion || quaternion, scale);
    return outPosition || position;
  };
  const arms = [];
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'L' : 'R';
    const upper = bone(BONE_NAMES.upper[key]), fore = bone(BONE_NAMES.fore[key]), hand = bone(BONE_NAMES.hand[key]);
    const shoulder = frameOf(upper, new THREE.Vector3());
    const elbow = frameOf(fore, new THREE.Vector3()), wrist = frameOf(hand, new THREE.Vector3());
    const restUpper = new THREE.Quaternion(), restFore = new THREE.Quaternion();
    frameOf(upper, position, restUpper); frameOf(fore, position, restFore);
    // Which way each segment folds at rest, in its own bone space: forward for the upper arm (the
    // elbow crease faces the chest), the palm for the forearm (the wrist follows the hand).
    const foldUpper = FORWARD.clone().applyQuaternion(restUpper.clone().invert()); foldUpper.y = 0; foldUpper.normalize();
    const restHand = new THREE.Quaternion(); frameOf(hand, position, restHand);
    const palmFore = new THREE.Vector3(0, 0, 1).applyQuaternion(restHand).applyQuaternion(restFore.clone().invert()); palmFore.y = 0; palmFore.normalize();
    arms.push({
      side, key, upper, fore, hand, restShoulder: shoulder,
      upperLength: elbow.distanceTo(shoulder), lowerLength: wrist.distanceTo(elbow),
      upperLocalRest: upper.quaternion.clone(), foreLocalRest: fore.quaternion.clone(),
      foldUpper, palmFore,
      shoulder: new THREE.Vector3(), wrist: new THREE.Vector3(), direction: new THREE.Vector3(), bend: new THREE.Vector3(),
      elbow: new THREE.Vector3(), segment: new THREE.Vector3(), anchor: null,
      fingers: new THREE.Vector3(), palm: new THREE.Vector3(),
      upperQuat: new THREE.Quaternion(), foreQuat: new THREE.Quaternion(), handQuat: new THREE.Quaternion(),
    });
  }
  const legs = [];
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'L' : 'R';
    legs.push({ thigh: bone(BONE_NAMES.thigh[key]), shin: bone(BONE_NAMES.shin[key]) });
  }
  const shoulderHeight = (arms[0].restShoulder.y + arms[1].restShoulder.y) / 2;
  const reach = (arms[0].upperLength + arms[0].lowerLength + arms[1].upperLength + arms[1].lowerLength) / 2;
  const reachScale = reach / PROCEDURAL_REACH;
  const stowRest = frameOf(bones.stow, new THREE.Vector3());

  // Torso space: buildPirate's frame, shoulders at y = .745, so its stance tables apply unchanged.
  const torso = new THREE.Group(); torso.name = 'navigator-torso'; torso.position.y = shoulderHeight - PROCEDURAL_SHOULDER.y; figure.add(torso);
  const weaponRig = new THREE.Group(); weaponRig.name = 'weapon-aim-recoil-rig'; torso.add(weaponRig);
  const stowRig = new THREE.Group(); stowRig.name = 'weapon-back-stow-rig';
  stowRig.position.set(stowRest.x + .10, stowRest.y - torso.position.y + .05, stowRest.z + .18);
  stowRig.rotation.set(-Math.PI / 2, 0, Math.PI / 2 + .12); torso.add(stowRig);
  const weapons = Object.fromEntries(WEAPON_ORDER.map(kind => [kind, upgradeWeapon(buildWeapon(palette, kind), kind)]));
  const weaponEntries = Object.entries(weapons);
  for (const [, weapon] of weaponEntries) {
    weapon.group.scale.setScalar(WEAPON_SCALE); weapon.stowed.scale.setScalar(WEAPON_SCALE);
    weaponRig.add(weapon.group); stowRig.add(weapon.stowed);
  }
  const stanceScale = new THREE.Vector3(reachScale, reachScale, Math.min(1, reachScale + STANCE_DEPTH_KEEP * (1 - reachScale)));
  for (const arm of arms) {
    const anchor = new THREE.Object3D(); anchor.name = (arm.side < 0 ? 'left' : 'right') + '-weapon-grip';
    weaponRig.add(anchor); arm.anchor = anchor;
  }
  const { group: glider, grips } = buildGlider(palette, color); group.add(glider);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.70, 20), new THREE.MeshBasicMaterial({
    color: '#183c46', transparent: true, opacity: .20, depthWrite: false }));
  shadow.name = 'pirate-contact-shadow'; shadow.rotation.x = -Math.PI / 2; shadow.position.y = .025; group.add(shadow);

  // Clips: idle runs on the clock, damped against a hold pose built from its first frame; walk
  // and run are parked (timeScale 0) and stepped by distance.
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of asset.animations) {
    if (!['idle', 'walk', 'run'].includes(clip.name)) continue;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity); action.enabled = true; action.setEffectiveWeight(clip.name === 'idle' ? IDLE_MOTION : 0); action.play();
    if (clip.name !== 'idle') action.timeScale = 0;
    actions[clip.name] = action;
  }
  if (!actions.idle) throw new Error('navigator asset has no idle clip');
  const holdTracks = actions.idle.getClip().tracks.map(track =>
    new track.constructor(track.name, [0], Array.from(track.values.subarray(0, track.getValueSize()))));
  actions.hold = mixer.clipAction(new THREE.AnimationClip('idle_hold', 1, holdTracks));
  actions.hold.setLoop(THREE.LoopRepeat, Infinity); actions.hold.enabled = true; actions.hold.setEffectiveWeight(1 - IDLE_MOTION); actions.hold.play();

  let phase = 0, cycle = 0, locomotion = 0, sprint = 0, aiming = 0, glideBlend = 0, knockBlend = 0, recoil = 0;
  let equipped = 'flintlock', stowed = false;
  let previousReloadUntil = 0, cancelledReloadUntil = 0;
  const gliderToFigure = new THREE.Matrix4(), figureMatrixInv = new THREE.Matrix4();
  const parentQuat = new THREE.Quaternion(), workQuat = new THREE.Quaternion(), swing = new THREE.Quaternion(), axisQuat = new THREE.Quaternion();
  const thighQuat = new THREE.Quaternion(), shinQuat = new THREE.Quaternion(), headQuat = new THREE.Quaternion();
  const along = new THREE.Vector3(), reference = new THREE.Vector3(), target = new THREE.Vector3(), basisX = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const gripTarget = new THREE.Vector3();

  // Figure-space quaternion of a bone's parent, from world matrices refreshed after the mixer.
  function parentFrame(boneNode, out) {
    relative.multiplyMatrices(figureMatrixInv, boneNode.parent.matrixWorld).decompose(position, out, scale);
    return out;
  }
  // Rotate a bone additively about a figure-space axis; returns its new figure-space quaternion.
  function rotateInFigure(boneNode, parentQ, axis, angle, out) {
    out.copy(parentQ).multiply(boneNode.quaternion);
    axisQuat.setFromAxisAngle(axis, angle); out.premultiply(axisQuat);
    boneNode.quaternion.copy(parentQ).invert().multiply(out);
    return out;
  }
  // Point a bone (its +Y runs to the child joint) from its rest orientation toward `dir`, then twist
  // about `dir` so the bone-space `foldLocal` faces `foldDir`. Writes the bone's local rotation.
  function aimBone(boneNode, parentQ, localRest, dir, foldLocal, foldDir, out) {
    out.copy(parentQ).multiply(localRest);
    along.copy(UP).applyQuaternion(out);
    swing.setFromUnitVectors(along, dir); out.premultiply(swing);
    if (foldLocal) {
      reference.copy(foldLocal).applyQuaternion(out).addScaledVector(dir, -reference.dot(dir));
      target.copy(foldDir).addScaledVector(dir, -foldDir.dot(dir));
      if (reference.lengthSq() > 1e-6 && target.lengthSq() > 1e-6) {
        swing.setFromUnitVectors(reference.normalize(), target.normalize()); out.premultiply(swing);
      }
    }
    boneNode.quaternion.copy(parentQ).invert().multiply(out);
    return out;
  }

  function animate(time = 0, speed = 0, player = {}, pose = {}) {
    const dt = THREE.MathUtils.clamp(Number.isFinite(pose.dt) ? pose.dt : 1 / 60, 0, .1);
    const elapsed = Number.isFinite(pose.elapsed) ? pose.elapsed : 0;
    const falling = player.mode === 'gliding', knocked = !!player.knockedUntil, mounted = player.mode === 'aboard' && !!player.gunId;
    const motion = falling || knocked ? 0 : THREE.MathUtils.clamp(Number.isFinite(speed) ? speed : 0, 0, 18);
    const nextWeapon = WEAPONS[player.weapon] ? player.weapon : 'flintlock';
    const reloadUntil = Number.isFinite(player.reloadUntil) ? player.reloadUntil : 0;
    const canReload = player.mode === 'ground' && !knocked && player.online !== false && !(Number.isFinite(player.hp) && player.hp <= 0);
    // A stale deadline must not transfer to a newly equipped gun or resume
    // after a glide/knock/offline transition. A new server deadline releases it.
    if (reloadUntil !== previousReloadUntil) cancelledReloadUntil = 0;
    if (!canReload || (nextWeapon !== equipped && reloadUntil === previousReloadUntil)) cancelledReloadUntil = reloadUntil;
    previousReloadUntil = reloadUntil;
    equipped = nextWeapon; stowed = falling;
    const handling = WEAPON_HANDLING[equipped];
    // Wrist anchors only: a gun drawing a GLB carries its own pair (client/weapon-models.js's
    // WEAPON_ASSET_HANDLING), tuned against this character's hands and that mesh's grip. Stance,
    // support roll and everything else stay WEAPON_HANDLING's, and a procedural gun has no
    // override at all, so the lookup is a property read per frame and allocates nothing.
    const anchors = (weapons[equipped] && weapons[equipped].handling) || handling;
    const reload = sampleReloadAnimation(equipped, reloadUntil, elapsed, anchors.left,
      canReload && reloadUntil !== cancelledReloadUntil);
    // Distance-driven phase never changes frequency discontinuously at sprint.
    phase = (phase + motion * dt * 1.22) % (Math.PI * 2);
    locomotion = ease(locomotion, Math.min(1, motion / 4.5), 13, dt);
    if (motion === 0 && locomotion < .001) locomotion = 0;
    sprint = ease(sprint, smooth((motion - SPRINT_FROM) / (SPRINT_TO - SPRINT_FROM)), 8, dt);
    aiming = ease(aiming, pose.aiming ? 1 : 0, 16, dt);
    glideBlend = ease(glideBlend, falling ? 1 : 0, 10, dt);
    knockBlend = ease(knockBlend, knocked ? 1 : 0, 10, dt);
    recoil *= Math.exp(-18 * dt);

    // Locomotion clips. The stride cycle advances with distance travelled so feet plant instead of
    // sliding at any speed; walk and run share the cycle so the cross-fade keeps the same footfall.
    cycle = (cycle + motion * dt / THREE.MathUtils.lerp(WALK_CYCLE, RUN_CYCLE, sprint)) % 1;
    actions.idle.setEffectiveWeight((1 - locomotion) * IDLE_MOTION);
    actions.hold.setEffectiveWeight((1 - locomotion) * (1 - IDLE_MOTION));
    if (actions.walk) { actions.walk.setEffectiveWeight(locomotion * (1 - sprint)); actions.walk.time = cycle * actions.walk.getClip().duration; }
    if (actions.run) { actions.run.setEffectiveWeight(locomotion * sprint); actions.run.time = cycle * actions.run.getClip().duration; }
    mixer.update(dt);

    figure.position.y = -.20 * knockBlend;
    figure.rotation.set(.07 * glideBlend, 0, .32 * knockBlend);
    figure.updateMatrixWorld(true);
    figureMatrixInv.copy(figure.matrixWorld).invert();

    // Legs trail in a glide and fold under a knockback; the head follows the aim pitch.
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const hipAngle = (i ? .13 : -.24) * glideBlend - .76 * knockBlend;
      const kneeAngle = -.17 * glideBlend - .36 * knockBlend;
      if (Math.abs(hipAngle) + Math.abs(kneeAngle) < 1e-4) continue;
      rotateInFigure(leg.thigh, parentFrame(leg.thigh, parentQuat), AXIS_X, hipAngle, thighQuat);
      rotateInFigure(leg.shin, thighQuat, AXIS_X, kneeAngle, shinQuat);
    }
    const lookPitch = (Number.isFinite(player.pitch) ? player.pitch : 0) * .30 - .09 * knockBlend;
    rotateInFigure(bones.head, parentFrame(bones.head, parentQuat), AXIS_X, lookPitch, headQuat);

    // Weapon stance, reload work and recoil, exactly as buildPirate, then pulled toward the shoulder
    // line by the arm-reach ratio so the navigator's shorter arms hold every gun.
    const pitch = THREE.MathUtils.lerp(THREE.MathUtils.clamp(Number.isFinite(player.pitch) ? player.pitch : 0, -1.2, 1.2), reload.pitch, reload.work);
    const steepness = Math.abs(Math.sin(pitch));
    const magazineReload = equipped === 'repeater' || equipped === 'burst';
    weaponRig.position.set(THREE.MathUtils.lerp(handling.stance[0], equipped === 'flintlock' ? .34 : magazineReload ? .47 : .55, reload.work),
      handling.stance[1] + aiming * .035 * (1 - reload.work) + Math.max(0, Math.sin(pitch)) * .045 - Math.min(0, Math.sin(pitch)) * .10 + reload.work * (magazineReload ? .03 : -.09) - knockBlend * .035,
      handling.stance[2] - steepness * .055 + Math.min(0, Math.sin(pitch)) * .22 + recoil * .025 - reload.work * (equipped === 'longshot' ? .18 : .09));
    weaponRig.position.sub(PROCEDURAL_SHOULDER).multiply(stanceScale).add(PROCEDURAL_SHOULDER);
    weaponRig.rotation.set(pitch + recoil * .055 * (1 - reload.work) - knockBlend * .05, .30 * reload.work, reload.roll * reload.work);
    for (const arm of arms) {
      arm.anchor.position.fromArray(arm.side < 0 ? reload.hand : anchors.right);
      arm.anchor.position.add(arm.side > 0 ? FIRING_HAND_OFFSET : SUPPORT_HAND_OFFSET);
      arm.anchor.position.multiplyScalar(WEAPON_SCALE);
      arm.anchor.rotation.set(0, arm.side < 0 ? -.12 * reload.release : 0,
        arm.side < 0 ? handling.supportRoll * (1 - reload.release) : -.04);
      // Live shoulder joints follow the animated spine.
      arm.shoulder.setFromMatrixPosition(arm.upper.matrixWorld).applyMatrix4(figureMatrixInv).sub(torso.position);
    }
    // Move the gun a few centimetres into the intersection of the two reachable wrist spheres.
    for (let pass = 0; pass < 4; pass++) {
      weaponRig.updateMatrix();
      for (const arm of arms) {
        arm.wrist.copy(arm.anchor.position).applyMatrix4(weaponRig.matrix);
        arm.direction.copy(arm.wrist).sub(arm.shoulder);
        const reachable = arm.direction.length(), maximum = arm.upperLength + arm.lowerLength - .025;
        if (reachable > maximum) weaponRig.position.addScaledVector(arm.direction, -(reachable - maximum) / reachable);
      }
    }
    weaponRig.updateMatrix();
    glider.visible = falling; glider.rotation.z = Math.sin(time * 1.8) * .018;
    if (falling) { glider.updateMatrix(); gliderToFigure.copy(figure.matrix).invert().multiply(glider.matrix); }
    for (const [kind, weapon] of weaponEntries) {
      weapon.group.visible = !mounted && !stowed && equipped === kind;
      weapon.stowed.visible = !mounted && stowed && equipped === kind;
      weapon.action.position.copy(weapon.actionOrigin); weapon.action.rotation.set(0, 0, 0);
      if (kind !== equipped) continue;
      if (kind === 'flintlock' || kind === 'scatter') weapon.action.rotation.z = -1.15 * reload.open;
      else if (kind === 'longshot') weapon.action.position.z += .17 * reload.open;
      else {
        weapon.action.position.x -= .26 * reload.open;
        weapon.action.position.y -= .12 * reload.open;
        if (kind === 'burst') weapon.action.position.z += .04 * reload.open;
      }
    }

    // Arms: each wrist reaches its target exactly (gun anchor, glider grip or cannon rail) through
    // fixed-length two-bone IK, written onto the bones as figure-space orientations.
    for (const arm of arms) {
      if (falling) {
        arm.wrist.copy(grips[arm.side < 0 ? 0 : 1].position).applyMatrix4(gliderToFigure).sub(torso.position);
        arm.fingers.set(-arm.side * .35, -.15, -.92).normalize(); arm.palm.set(-arm.side, 0, 0);
      } else if (mounted) {
        arm.wrist.set(arm.side * .28, .38, -.48).sub(PROCEDURAL_SHOULDER).multiply(stanceScale).add(PROCEDURAL_SHOULDER);
        arm.fingers.set(0, -.3, -1).normalize(); arm.palm.set(0, -1, 0);
      } else {
        arm.wrist.copy(arm.anchor.position).applyMatrix4(weaponRig.matrix);
        // Gun-space grip: the firing hand wraps the grip (knuckles forward-down, palm to the left),
        // the support hand cups the fore-end from below (palm up and in, fingers curling up the far
        // side); on the pistol it wraps the firing hand instead.
        if (arm.side > 0) { arm.fingers.set(-.20, -.62, -.76); arm.palm.set(-.92, .25, -.30); }
        else if (equipped === 'flintlock') { arm.fingers.set(.70, -.25, -.67); arm.palm.set(.55, .70, -.45); }
        else { arm.fingers.set(.62, .55, -.56); arm.palm.set(.25, .85, .45); }
        workQuat.copy(weaponRig.quaternion).multiply(arm.anchor.quaternion);
        arm.fingers.normalize().applyQuaternion(workQuat); arm.palm.applyQuaternion(workQuat);
      }
      arm.direction.copy(arm.wrist).sub(arm.shoulder);
      const distance = Math.max(.001, arm.direction.length());
      arm.direction.multiplyScalar(1 / distance);
      const upperLength = arm.upperLength, lowerLength = arm.lowerLength;
      const clamped = Math.min(distance, upperLength + lowerLength - .01);
      const alongReach = (upperLength * upperLength - lowerLength * lowerLength + clamped * clamped) / (2 * clamped);
      const height = Math.sqrt(Math.max(0, upperLength * upperLength - alongReach * alongReach));
      // Forward is -Z. Outward elbows keep the entire forearm in front of the coat.
      if (falling) arm.bend.set(arm.side * .7, -.8, -.7);
      else if (arm.side > 0) arm.bend.set(.82 - aiming * .08, -1.2, -.08);
      else if (equipped === 'flintlock') arm.bend.set(-.65, -1.1, -.3);
      else arm.bend.set(-.4 + aiming * .10, -.30, -2.8);
      arm.bend.addScaledVector(arm.direction, -arm.bend.dot(arm.direction)).normalize();
      arm.elbow.copy(arm.shoulder).addScaledVector(arm.direction, alongReach).addScaledVector(arm.bend, height);
      // Upper arm: shoulder -> elbow, crease facing the forearm. Forearm: elbow -> wrist, twisted to
      // the palm. Hand: the grip basis (x = fingers × palm, y = fingers, z = palm) in figure space.
      arm.segment.copy(arm.elbow).sub(arm.shoulder).normalize();
      const foreDir = gripTarget.copy(arm.wrist).sub(arm.elbow).normalize();
      aimBone(arm.upper, parentFrame(arm.upper, parentQuat), arm.upperLocalRest, arm.segment, arm.foldUpper, foreDir, arm.upperQuat);
      aimBone(arm.fore, arm.upperQuat, arm.foreLocalRest, foreDir, arm.palmFore, arm.palm, arm.foreQuat);
      basisX.crossVectors(arm.fingers, arm.palm).normalize();
      arm.palm.crossVectors(basisX, arm.fingers).normalize();
      basis.makeBasis(basisX, arm.fingers, arm.palm);
      arm.handQuat.setFromRotationMatrix(basis);
      arm.hand.quaternion.copy(arm.foreQuat).invert().multiply(arm.handQuat);
    }
    shadow.visible = player.mode === 'ground';
  }
  animate(0, 0, { mode: 'aboard', weapon: 'flintlock' });
  return {
    animate,
    fire(weapon = equipped) { recoil = Math.min(1.4, recoil + ({ flintlock: .82, scatter: 1.15, repeater: .38, burst: .48, longshot: 1.3 }[weapon] || .82)); },
    getMuzzle(targetVector3 = new THREE.Vector3()) {
      const weapon = weapons[equipped], socket = stowed ? weapon.stowedSocket : weapon.socket;
      socket.updateWorldMatrix(true, false);
      return targetVector3.setFromMatrixPosition(socket.matrixWorld);
    },
    setCrewColor(hex) { for (const material of materials) setCrewTint(material, hex); },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(root); },
    debug: { root, bones, arms, legs, torso, weaponRig, stowRig, weapons, mixer, actions, reachScale, shoulderHeight },
  };
}
