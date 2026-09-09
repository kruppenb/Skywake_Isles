import * as THREE from 'three';
import { AIRSHIP_RETURNS, SHIP_GUNS, gunMuzzle } from '../shared/airship.js';
import { heightAt } from '../shared/world.js';
import { buildAirshipLift, buildFlyingCrab } from './models.js';
import { createObjectiveMarker, updateObjectiveMarker } from './objective-markers.js';

// Camera, reticle and shots share a single ray, even at the swivel limits.
// Sitting just beyond the muzzle leaves the barrel and nearby rail out of view.
export function gunCameraPose(gun, ship, yaw, pitch) {
  const { from, direction } = gunMuzzle(gun, ship, yaw, pitch);
  return { origin: { x: from.x + direction.x * .2, y: from.y + direction.y * .2, z: from.z + direction.z * .2 }, direction };
}

export function updateDeckCannons(ship, state, localPlayer, view, dt) {
  for (const gun of SHIP_GUNS) {
    const station = state?.shipGuns?.find(candidate => candidate.id === gun.id);
    const local = localPlayer?.gunId === gun.id;
    const occupant = local ? localPlayer : state?.players?.find(player => player.id === station?.occupantId && player.gunId === gun.id);
    const yaw = local && Number.isFinite(view.yaw) ? view.yaw : occupant?.yaw ?? gun.yaw;
    const pitch = local && Number.isFinite(view.pitch) ? view.pitch : occupant?.pitch ?? .1;
    ship.guns.get(gun.id)?.animate(dt, yaw, pitch, occupant?.id || null);
  }
}

export function createAirshipPresentation({ scene, palette }) {
  const group = new THREE.Group(); group.name = 'airship-world-details'; scene.add(group);
  const targets = new Map(), slots = [], lifts = [];
  const position = new THREE.Vector3();
  let disposed = false;
  for (const lift of AIRSHIP_RETURNS) {
    const model = buildAirshipLift(palette);
    model.group.name = lift.id; model.group.userData.returnId = lift.id;
    model.group.position.set(lift.x, heightAt(lift.x, lift.z), lift.z);
    // Conform the small platform to terrain rather than burying its uphill half.
    const base = model.group.children.find(child => child.isMesh);
    const vertices = base.geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      vertices.setY(i, vertices.getY(i) + heightAt(lift.x + vertices.getX(i), lift.z + vertices.getZ(i)) - model.group.position.y);
    }
    vertices.needsUpdate = true; base.geometry.computeVertexNormals(); base.geometry.computeBoundingSphere();
    const ring = createObjectiveMarker({ ...lift, radius: 2.25, name: `${lift.id}-halo`, coreColor: '#baf9f0', haloColor: '#72e7e1' });
    group.add(model.group, ring); lifts.push({ ...model, ring });
  }
  function makeTarget() {
    const model = buildFlyingCrab(palette);
    const hpGroup = new THREE.Group(), back = new THREE.Mesh(new THREE.PlaneGeometry(2.5, .22), new THREE.MeshBasicMaterial({ color: '#273f4c', transparent: true, opacity: .9, depthWrite: false }));
    const hp = new THREE.Mesh(new THREE.PlaneGeometry(2.36, .12), new THREE.MeshBasicMaterial({ color: '#ffe2a8', transparent: true, depthWrite: false }));
    hp.position.z = .012; hpGroup.add(back, hp); hpGroup.name = 'flying-crab-health';
    hpGroup.position.y = 2.1; model.group.add(hpGroup);
    Object.assign(model, { hpGroup, hpBar: hp, flashUntil: 0, id: null });
    group.add(model.group); slots.push(model); return model;
  }
  function update(dt, state, time, camera, reducedMotion = false, effectTime = time) {
    if (disposed) return;
    const active = state?.phase === 'voyage' || state?.phase === 'finale';
    for (const lift of lifts) {
      lift.group.visible = active; lift.animate(time, reducedMotion);
      updateObjectiveMarker(lift.ring, { visible: active, time, reducedMotion });
    }
    const sources = active ? (state?.flyingTargets || []).filter(target => target.hp > 0 && [target.x, target.y, target.z].every(Number.isFinite)).slice(0, 8) : [];
    const seen = new Set(sources.map(target => target.id));
    for (const slot of slots) slot.group.visible = false;
    for (const target of sources) {
      let model = targets.get(target.id), fresh = !model || !model.wasVisible;
      if (!model) {
        model = slots.find(slot => !seen.has(slot.id)) || (slots.length < 8 ? makeTarget() : null);
        if (!model) continue;
        if (model.id) targets.delete(model.id);
        model.id = target.id; model.flashUntil = 0; targets.set(target.id, model);
        model.group.name = target.id; model.group.userData.targetId = target.id;
      }
      position.set(target.x, target.y, target.z);
      model.group.position.lerp(position, fresh || model.group.position.distanceToSquared(position) > 100 ? 1 : 1 - Math.exp(-dt * 20));
      const yaw = Number.isFinite(target.yaw) ? target.yaw : 0;
      model.group.rotation.y += Math.atan2(Math.sin(yaw - model.group.rotation.y), Math.cos(yaw - model.group.rotation.y)) * (fresh ? 1 : 1 - Math.exp(-dt * 14));
      model.animate(time, reducedMotion); model.body.scale.setScalar(model.flashUntil > effectTime ? 1.07 : 1);
      model.hpGroup.quaternion.copy(model.group.quaternion).invert().multiply(camera.quaternion);
      model.hpBar.scale.x = Math.max(.01, target.hp / target.maxHp); model.hpBar.position.x = -1.18 * (1 - model.hpBar.scale.x);
      model.hpGroup.visible = target.hp < target.maxHp; model.group.visible = true;
    }
    for (const slot of slots) slot.wasVisible = slot.group.visible;
  }
  function dispose() {
    if (disposed) return; disposed = true;
    group.removeFromParent();
    const geometries = new Set(), materials = new Set();
    group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
        if (material !== palette.solid && material !== palette.glow) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    targets.clear(); slots.length = 0; lifts.length = 0;
  }
  return { group, targets, lifts, update, dispose,
    getStats() { return { flyingTargets: slots.filter(slot => slot.group.visible).length, targetModels: slots.length, lifts: lifts.length }; },
  };
}
