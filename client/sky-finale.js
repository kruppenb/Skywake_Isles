import * as THREE from 'three';
import { SKY_BOSSES, SKY_STAGE_KIND, SKY_STATUSES, SKY_BOMBARD_ID_PREFIX, SKY_BOMBARD_WARNING, SKY_BOMBARD_MAX_ACTIVE } from '../shared/sky-finale.js';
import { FINALE_STAGES } from '../shared/finale.js';
import { GUN_RANGE, raySphereSurface } from '../shared/airship.js';
import { hasWorldLineOfSight } from '../shared/collision.js';
import { heightAt } from '../shared/world.js';
import { buildSkycrab } from './models.js';

// The dedicated presentation layer for the skycrab siege. Everything here is
// driven by the bounded `finale.sky` snapshot block, never by an event history,
// so a late joiner sees both bosses, their health and every unresolved shell
// from the first snapshot it receives. The server owns hits, damage, timing and
// cancellation; this layer only draws what the block already says.
//
// Bodies are centred on the authoritative hit-sphere centre (SKY_BOSS_FIELDS
// x/y/z), never on a feet position, and nothing scales a model to cover a
// mismatch. Models are bounded by SKY_BOSSES.length and shells by the snapshot's
// own cap, and dispose() releases only geometry and materials this layer made.
const BOSS_TINT = new Map(SKY_BOSSES.map(boss => [boss.id, boss.side === 'starboard' ? '#8ef0e2' : '#b9c4ff']));
// A shell hangs at the crab for this share of its warning, so the wind-up, the
// fall and the marked impact read as one attack rather than three effects.
const WINDUP_SHARE = .3;

export const skyBombardmentId = id => typeof id === 'string' && id.startsWith(SKY_BOMBARD_ID_PREFIX);

// The live sky block, or null whenever the stage is not the running fight. Every
// consumer funnels through this, so victory, a restart, an earlier stage and a
// torn-down block all hide the layer the same way.
export function skyState(state) {
  const sky = state?.finale?.sky;
  const stage = FINALE_STAGES[(state?.finale?.stage || 0) - 1];
  return state?.phase === 'finale' && stage?.kind === SKY_STAGE_KIND && sky && SKY_STATUSES.includes(sky.status)
    && Array.isArray(sky.bosses) && Array.isArray(sky.bombardments) ? sky : null;
}

// The bosses a shot may actually select: the server's own active/alive/not-down
// filter, so the reticle never offers a target the authority would refuse.
export function skyTargets(state) {
  const sky = skyState(state);
  if (!sky || sky.status !== 'active') return [];
  return sky.bosses.filter(boss => boss.hp > 0 && boss.state !== 'down' &&
    [boss.x, boss.y, boss.z, boss.radius].every(Number.isFinite));
}

// Nearest sphere surface along the clamped cannon ray, mirroring the server's
// selection exactly. Returns null when the ray misses every legal boss.
export function skyBossAtRay(state, origin, direction, range = GUN_RANGE) {
  if (!(range > 0)) return null;
  let nearest = Math.min(range, GUN_RANGE), hit = null;
  for (const boss of skyTargets(state)) {
    const surface = raySphereSurface(origin, direction, boss);
    if (surface === null || surface > nearest) continue;
    const point = { x: origin.x + direction.x * surface, y: origin.y + direction.y * surface, z: origin.z + direction.z * surface };
    if (!hasWorldLineOfSight(origin, point)) continue;
    nearest = surface; hit = boss;
  }
  return hit;
}

export function createSkyFinalePresentation({ scene, palette }) {
  const group = new THREE.Group(); group.name = 'sky-finale'; scene.add(group);
  const bosses = new Map(), shells = new Map();
  const bossSlots = [], shellSlots = [];
  const owned = { geometries: new Set(), materials: new Set() };
  const position = new THREE.Vector3(), impact = new THREE.Vector3();
  let disposed = false, currentRound = null;

  const own = (geometry, material) => {
    if (geometry) owned.geometries.add(geometry);
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      if (item !== palette.solid && item !== palette.glow) owned.materials.add(item);
    }
  };
  function makeBoss(descriptor) {
    const model = buildSkycrab(palette, descriptor);
    model.group.traverse(object => { if (object.isMesh) own(object.geometry, object.material); });
    const plate = new THREE.Group(), tint = BOSS_TINT.get(descriptor.id) || '#d8e6ff';
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .18), new THREE.MeshBasicMaterial({ color: '#17303f', transparent: true, opacity: .88, depthWrite: false }));
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.5, .1), new THREE.MeshBasicMaterial({ color: tint, transparent: true, depthWrite: false }));
    bar.position.z = .012; plate.add(back, bar); plate.name = 'skycrab-health';
    own(back.geometry, back.material); own(bar.geometry, bar.material);
    // Wide wings set the hit-sphere radius; the health plate follows the much
    // lower visible shell instead of floating a full sphere-radius above it.
    plate.position.y = new THREE.Box3().setFromObject(model.body).max.y + .22;
    model.group.add(plate);
    Object.assign(model, { plate, bar, descriptor, flashUntil: 0, id: null, downAt: 0 });
    group.add(model.group); bossSlots.push(model); return model;
  }
  function makeShell() {
    const shell = new THREE.Group(), core = new THREE.Group();
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(.62, 0), new THREE.MeshBasicMaterial({ color: '#2d3d63', transparent: true, opacity: .95, depthWrite: false }));
    const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(.34, 0), new THREE.MeshBasicMaterial({ color: '#ffe6a8', transparent: true, depthWrite: false }));
    const tail = new THREE.Mesh(new THREE.ConeGeometry(.46, 2.2, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#9fb6ff', transparent: true, opacity: .32, side: THREE.DoubleSide, depthWrite: false }));
    tail.position.y = 1.2; core.add(orb, spark, tail); shell.add(core);
    // The warning ring is a plain outline plus a shrinking disc, so the time left
    // reads from geometry alone with effects or motion turned down.
    const ring = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 44), new THREE.MeshBasicMaterial({ color: '#ffbd79', transparent: true, opacity: .95, side: THREE.DoubleSide, depthWrite: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#f2915f', transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false }));
    const mark = new THREE.Group(); ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    disc.position.y = -.015; mark.add(ring, disc); mark.name = 'sky-bombard-warning';
    const model = { shell, core, orb, spark, tail, mark, ring, disc, id: null };
    for (const mesh of [orb, spark, tail, ring, disc]) own(mesh.geometry, mesh.material);
    group.add(shell, mark); shellSlots.push(model); return model;
  }

  function updateBosses(sky, dt, time, camera, reducedMotion, elapsed, effectTime) {
    const live = sky.bosses.filter(boss => [boss.x, boss.y, boss.z].every(Number.isFinite)).slice(0, SKY_BOSSES.length);
    const seen = new Set(live.map(boss => boss.id));
    for (const slot of bossSlots) slot.group.visible = false;
    for (const boss of live) {
      const descriptor = SKY_BOSSES.find(entry => entry.id === boss.id);
      if (!descriptor) continue;
      let model = bosses.get(boss.id), fresh = !model || !model.wasVisible;
      if (!model) {
        model = bossSlots.find(slot => !seen.has(slot.id) && slot.descriptor.id === descriptor.id)
          || (bossSlots.length < SKY_BOSSES.length ? makeBoss(descriptor) : null);
        if (!model) continue;
        if (model.id) bosses.delete(model.id);
        model.id = boss.id; model.flashUntil = 0; model.downAt = 0; bosses.set(boss.id, model);
        model.group.userData.skyBossId = boss.id;
      }
      model.group.scale.setScalar(descriptor.scale);
      position.set(boss.x, boss.y, boss.z);
      // Authoritative altitude: the pose is the hit-sphere centre, so the body is
      // centred on it and only eased toward the next snapshot, never offset.
      model.group.position.lerp(position, fresh || model.group.position.distanceToSquared(position) > 400 ? 1 : 1 - Math.exp(-dt * 14));
      const yaw = Number.isFinite(boss.yaw) ? boss.yaw : 0;
      model.group.rotation.y += Math.atan2(Math.sin(yaw - model.group.rotation.y), Math.cos(yaw - model.group.rotation.y)) * (fresh ? 1 : 1 - Math.exp(-dt * 8));
      const down = boss.state === 'down';
      if (down && !model.downAt) model.downAt = elapsed;
      if (!down) model.downAt = 0;
      model.animate(time, { reducedMotion, winding: boss.state === 'winding', down, downAge: down ? Math.max(0, elapsed - model.downAt) : 0 });
      // The flash pops around the sphere centre and keeps the fitted silhouette.
      model.body.scale.setScalar(model.fit * (model.flashUntil > effectTime ? 1.06 : 1));
      const fraction = boss.maxHp > 0 ? Math.max(0, Math.min(1, boss.hp / boss.maxHp)) : 0;
      model.bar.scale.x = Math.max(.01, fraction); model.bar.position.x = -.75 * (1 - model.bar.scale.x);
      model.plate.quaternion.copy(model.group.quaternion).invert().multiply(camera.quaternion);
      model.plate.visible = !down;
      model.group.visible = true;
    }
    for (const [id, model] of bosses) if (!seen.has(id)) { bosses.delete(id); model.id = null; }
    for (const slot of bossSlots) slot.wasVisible = slot.group.visible;
  }

  function updateShells(sky, elapsed, time, reducedMotion, lowQuality) {
    const live = sky.bombardments
      .filter(shell => skyBombardmentId(shell?.id) && SKY_BOSSES.some(boss => boss.id === shell.bossId)
        && [shell.x, shell.y, shell.z, shell.impactX, shell.impactZ, shell.launchAt, shell.impactAt].every(Number.isFinite))
      .slice(0, SKY_BOMBARD_MAX_ACTIVE);
    const seen = new Set(live.map(shell => shell.id));
    for (const slot of shellSlots) { slot.shell.visible = false; slot.mark.visible = false; }
    for (const record of live) {
      let model = shells.get(record.id);
      if (!model) {
        model = shellSlots.find(slot => !seen.has(slot.id)) || (shellSlots.length < SKY_BOMBARD_MAX_ACTIVE ? makeShell() : null);
        if (!model) continue;
        if (model.id) shells.delete(model.id);
        model.id = record.id; shells.set(record.id, model);
      }
      // Timing comes from the authoritative launch/impact stamps, so a shell
      // picked up mid-flight by a late joiner starts at its true progress.
      const span = Math.max(.1, record.impactAt - record.launchAt || SKY_BOMBARD_WARNING);
      const progress = Math.max(0, Math.min(1, (elapsed - record.launchAt) / span));
      const travel = Math.max(0, (progress - WINDUP_SHARE) / (1 - WINDUP_SHARE));
      const radius = Number.isFinite(record.radius) ? record.radius : 4.6;
      const groundY = Number.isFinite(record.impactY) ? record.impactY : heightAt(record.impactX, record.impactZ);
      impact.set(record.impactX, groundY, record.impactZ);
      position.set(record.x, record.y, record.z);
      // The shell accelerates out of the wind-up and arrives exactly on the
      // authoritative deadline, so launch, fall and impact read as one attack.
      model.shell.position.lerpVectors(position, impact, Math.pow(travel, 1.7));
      model.shell.lookAt(impact.x, impact.y - 12, impact.z);
      model.core.rotation.z = reducedMotion ? 0 : time * 3.4;
      const windup = Math.min(1, progress / WINDUP_SHARE);
      model.orb.scale.setScalar(.6 + windup * .55);
      model.spark.scale.setScalar(reducedMotion ? 1 : 1 + Math.sin(time * 14) * .12);
      model.tail.visible = !lowQuality && travel > .02;
      model.shell.visible = true;
      model.mark.position.set(record.impactX, groundY + .12, record.impactZ);
      model.mark.scale.setScalar(radius);
      // The disc shrinks to nothing exactly at the impact deadline: a countdown
      // that survives reduced motion and the low-effects palette.
      model.disc.scale.setScalar(Math.max(.02, 1 - progress));
      model.ring.material.opacity = reducedMotion ? .95 : .72 + Math.sin(time * 18) * .22;
      model.mark.visible = true;
    }
    for (const [id, model] of shells) if (!seen.has(id)) { shells.delete(id); model.id = null; }
  }

  function clear() {
    bosses.clear(); shells.clear();
    for (const slot of bossSlots) {
      slot.group.visible = false; slot.id = null; slot.wasVisible = false; slot.downAt = 0; slot.flashUntil = 0;
    }
    for (const slot of shellSlots) { slot.shell.visible = false; slot.mark.visible = false; slot.id = null; }
    group.visible = false;
  }

  // `effectTime` is the world's own effect clock, the one a hit flash is stamped
  // against; `time` is the render clock the animations ride.
  function update(dt, state, time, camera, { reducedMotion = false, lowQuality = false, effectTime = time } = {}) {
    if (disposed) return;
    // A hidden tab can miss every rendered lobby frame between two voyages.
    if (Number.isInteger(state?.round) && state.round !== currentRound) {
      clear(); currentRound = state.round;
    }
    const sky = skyState(state);
    if (!sky || sky.status === 'cleared') { clear(); return; }
    group.visible = true;
    const elapsed = Number.isFinite(state.elapsed) ? state.elapsed : 0;
    updateBosses(sky, dt, time, camera, reducedMotion, elapsed, effectTime);
    updateShells(sky, elapsed, time, reducedMotion, lowQuality);
  }

  function dispose() {
    if (disposed) return; disposed = true;
    group.removeFromParent();
    for (const geometry of owned.geometries) geometry.dispose();
    for (const material of owned.materials) material.dispose();
    owned.geometries.clear(); owned.materials.clear();
    bosses.clear(); shells.clear(); bossSlots.length = 0; shellSlots.length = 0;
  }

  return { group, bosses, shells, update, dispose,
    // World routes a hit flash and its own telegraph skip through these.
    hitTarget(id) { return bosses.get(id) || null; },
    ownsTelegraph: skyBombardmentId,
    getStats() {
      return { bosses: bossSlots.filter(slot => slot.group.visible).length, bossModels: bossSlots.length,
        shells: shellSlots.filter(slot => slot.shell.visible).length, shellModels: shellSlots.length };
    },
  };
}
