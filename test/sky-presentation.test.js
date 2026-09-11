import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makePalette, buildSkycrab } from '../client/models.js';
import { createSkyFinalePresentation, skyBombardmentId, skyBossAtRay, skyState, skyTargets } from '../client/sky-finale.js';
import { SKY_BOSSES, SKY_BOMBARD_ID_PREFIX, SKY_BOMBARD_RADIUS, SKY_BOMBARD_WARNING, SKY_BOMBARD_MAX_ACTIVE, SKY_BOSS_DOWN_LINGER, skyBossPose } from '../shared/sky-finale.js';
import { GUN_RANGE, raySphereSurface } from '../shared/airship.js';
import { shipAt } from '../shared/world.js';

const SHIP = shipAt(200);
const camera = () => new THREE.PerspectiveCamera();
function bossRecord(descriptor, overrides = {}) {
  const pose = skyBossPose(descriptor, 0, SHIP);
  return { id: descriptor.id, name: descriptor.name, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw,
    hp: 600, maxHp: 900, radius: descriptor.radius, state: 'flying', ...overrides };
}
function shellRecord(overrides = {}) {
  const boss = bossRecord(SKY_BOSSES[0]);
  return { id: `${SKY_BOMBARD_ID_PREFIX}1`, bossId: boss.id, x: boss.x, y: boss.y, z: boss.z,
    impactX: 6, impactY: 3.3, impactZ: 8, radius: SKY_BOMBARD_RADIUS, launchAt: 100, impactAt: 100 + SKY_BOMBARD_WARNING, ...overrides };
}
function snapshot(sky = {}, elapsed = 101) {
  return { phase: 'finale', elapsed, finale: { stage: 4, stages: 4, remaining: 6,
    sky: { status: 'active', countdownEndsAt: 0, wave: 1, waves: 3, groundActive: 3, groundPending: 1,
      groundFuture: 2, nextWaveAt: 0, bosses: SKY_BOSSES.map(descriptor => bossRecord(descriptor)),
      bombardments: [], ...sky } } };
}
function layer() {
  const scene = new THREE.Scene(), palette = makePalette();
  return { scene, palette, presentation: createSkyFinalePresentation({ scene, palette }) };
}

test('both skycrabs are giant, distinct and drawn inside the hit sphere the server tests', () => {
  const palette = makePalette(), probe = new THREE.Vector3();
  const silhouettes = [];
  for (const descriptor of SKY_BOSSES) {
    const model = buildSkycrab(palette, descriptor);
    assert.ok(model.group.getObjectByName('skycrab-left-wing'), `${descriptor.id} keeps the flying-crab wing vocabulary`);
    assert.ok(model.group.getObjectByName('skycrab-right-claw'), `${descriptor.id} has articulated claws`);
    let reach = 0, flashReach = 0, colors = new Set();
    // Every pose a gunner can shoot at must stay inside the authoritative sphere,
    // so no visible pixel is unhittable and no hitbox is widened to match art.
    for (const pose of [{}, { winding: true }, { reducedMotion: true }, { reducedMotion: true, winding: true }]) {
      for (let step = 0; step < 24; step++) {
        model.animate(step * .31, pose);
        model.body.scale.setScalar(model.fit);
        model.group.updateMatrixWorld(true);
        model.body.traverse((object) => {
          if (!object.isMesh) return;
          const positions = object.geometry.attributes.position, tint = object.geometry.attributes.color;
          for (let i = 0; i < positions.count; i++) {
            reach = Math.max(reach, probe.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).length());
            if (tint && i % 97 === 0) colors.add(`${tint.getX(i).toFixed(2)}:${tint.getY(i).toFixed(2)}:${tint.getZ(i).toFixed(2)}`);
          }
        });
      }
    }
    model.body.scale.setScalar(model.fit * 1.06);
    model.group.updateMatrixWorld(true);
    model.body.traverse((object) => {
      if (!object.isMesh) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) flashReach = Math.max(flashReach, probe.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).length());
    });
    assert.ok(reach * descriptor.scale <= descriptor.radius + 1e-6,
      `${descriptor.id} silhouette ${(reach * descriptor.scale).toFixed(2)}m fits its ${descriptor.radius}m hit sphere`);
    assert.ok(reach * descriptor.scale > descriptor.radius * .8, `${descriptor.id} fills its sphere rather than rattling inside it`);
    assert.ok(flashReach * descriptor.scale < descriptor.radius * 1.1, 'the hit flash is a brief pop, not a new size');
    // Giant: a practice flying crab spans about 2.5m, a pirate about 1.8m.
    assert.ok(reach * descriptor.scale * 2 > 7, `${descriptor.id} reads as giant`);
    silhouettes.push(colors);
  }
  assert.notDeepEqual([...silhouettes[0]].sort(), [...silhouettes[1]].sort(), 'the two lanes are visually distinct');
});

test('bosses ride the authoritative sphere centre, stay bounded and never move the pose', () => {
  const { presentation } = layer();
  const view = camera();
  const state = snapshot();
  presentation.update(.016, state, 1, view, {});
  assert.deepEqual(presentation.getStats(), { bosses: 2, bossModels: 2, shells: 0, shellModels: 0 });
  for (const descriptor of SKY_BOSSES) {
    const record = state.finale.sky.bosses.find((boss) => boss.id === descriptor.id);
    const model = presentation.bosses.get(descriptor.id);
    assert.deepEqual(model.group.position.toArray().map((value) => +value.toFixed(6)),
      [record.x, record.y, record.z].map((value) => +value.toFixed(6)), `${descriptor.id} sits on the sphere centre`);
    assert.equal(model.group.scale.x, descriptor.scale);
    assert.ok(model.plate.visible, 'a living crab names itself in the world');
  }
  // A second lap of snapshots never adds a model or leaks one.
  for (let step = 0; step < 40; step++) {
    const moved = snapshot({ bosses: SKY_BOSSES.map((descriptor) => {
      const pose = skyBossPose(descriptor, step * 1.1, SHIP);
      return bossRecord(descriptor, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });
    }) }, 101 + step * 1.1);
    presentation.update(.05, moved, step * .05, view, {});
  }
  assert.equal(presentation.getStats().bossModels, SKY_BOSSES.length);
  presentation.dispose();
});

test('oversized or unknown shell records cannot grow the presentation pool', () => {
  const { presentation } = layer();
  const view = camera();
  for (let step = 0; step < 20; step++) {
    const records = Array.from({ length: 10 }, (_, index) => shellRecord({
      id: `${SKY_BOMBARD_ID_PREFIX}${step * 10 + index}`,
      bossId: SKY_BOSSES[index % SKY_BOSSES.length].id,
    }));
    records.unshift(shellRecord({ id: 'not-a-sky-shell' }), shellRecord({ bossId: 'unknown-boss' }), null);
    presentation.update(.05, snapshot({ bombardments: records }), step, view, {});
    assert.equal(presentation.getStats().shells, SKY_BOMBARD_MAX_ACTIVE);
    assert.equal(presentation.getStats().shellModels, SKY_BOMBARD_MAX_ACTIVE);
    assert.equal(presentation.shells.has('not-a-sky-shell'), false);
  }
  presentation.dispose();
});

test('a round change resets cached poses and flashes even without a rendered lobby frame', () => {
  const { presentation } = layer();
  const view = camera();
  presentation.update(.05, { ...snapshot({ bombardments: [shellRecord()] }), round: 1 }, 1, view, { effectTime: 10 });
  presentation.hitTarget(SKY_BOSSES[0].id).flashUntil = 100;
  const records = SKY_BOSSES.map(descriptor => {
    const record = bossRecord(descriptor);
    return { ...record, x: record.x + 3 };
  });
  presentation.update(.05, { ...snapshot({ bosses: records }), round: 2 }, 2, view, { effectTime: 10.1 });
  for (const record of records) {
    const model = presentation.hitTarget(record.id);
    assert.deepEqual(model.group.position.toArray(), [record.x, record.y, record.z]);
    assert.equal(model.flashUntil, 0);
  }
  assert.equal(presentation.getStats().shells, 0);
  assert.equal(presentation.getStats().bossModels, SKY_BOSSES.length);
  presentation.dispose();
});

test('a downed skycrab lingers without being targetable, then leaves with the snapshot', () => {
  const { presentation } = layer();
  const view = camera();
  const down = snapshot({ bosses: [bossRecord(SKY_BOSSES[0], { hp: 0, state: 'down' }), bossRecord(SKY_BOSSES[1])] });
  presentation.update(.016, down, 1, view, {});
  const model = presentation.bosses.get(SKY_BOSSES[0].id);
  assert.equal(model.group.visible, true, 'the death plays where the crab died');
  assert.equal(model.plate.visible, false, 'a defeated crab drops its health plate');
  assert.deepEqual(skyTargets(down).map((boss) => boss.id), [SKY_BOSSES[1].id], 'a downed crab is never a target');
  // The body keeps rolling for the linger the server holds it for.
  const before = model.body.rotation.z;
  presentation.update(.05, { ...down, elapsed: down.elapsed + SKY_BOSS_DOWN_LINGER }, 2, view, {});
  assert.ok(model.body.rotation.z > before, 'the fall reads over the linger');
  const gone = snapshot({ bosses: [bossRecord(SKY_BOSSES[1])] });
  presentation.update(.05, gone, 3, view, {});
  assert.equal(presentation.bosses.has(SKY_BOSSES[0].id), false);
  assert.equal(presentation.getStats().bosses, 1);
  presentation.dispose();
});

test('a bombardment travels from its crab to the marked impact on authoritative time', () => {
  const { presentation } = layer();
  const view = camera();
  const shell = shellRecord();
  const boss = snapshot().finale.sky.bosses[0];
  const positions = [];
  for (const elapsed of [shell.launchAt, shell.launchAt + .7, shell.launchAt + 1.6, shell.impactAt]) {
    presentation.update(.05, snapshot({ bombardments: [shell] }, elapsed), elapsed, view, {});
    const model = presentation.shells.get(shell.id);
    positions.push(model.shell.position.clone());
    assert.equal(model.mark.visible, true, 'the ground ring marks the impact for the whole warning');
    assert.ok(Math.abs(model.mark.position.x - shell.impactX) < 1e-6 && Math.abs(model.mark.position.z - shell.impactZ) < 1e-6);
    assert.ok(Math.abs(model.mark.scale.x - shell.radius) < 1e-6, 'the ring is the authoritative blast radius');
  }
  const model = presentation.shells.get(shell.id);
  assert.ok(positions[0].distanceTo(new THREE.Vector3(boss.x, boss.y, boss.z)) < .01, 'the shell winds up at the crab');
  assert.ok(positions[1].y > positions[2].y, 'it falls');
  assert.ok(positions[3].distanceTo(new THREE.Vector3(shell.impactX, shell.impactY, shell.impactZ)) < .01, 'it arrives on the marked point');
  // The disc is a geometric countdown, so the time left reads without motion.
  const early = presentation.shells.get(shell.id).disc.scale.x;
  presentation.update(.05, snapshot({ bombardments: [shell] }, shell.launchAt + .2), 5, view, {});
  assert.ok(model.disc.scale.x > early, 'the countdown disc shrinks toward the impact');
  presentation.dispose();
});

test('a late joiner picks a shell up mid-flight, and a cancelled shell leaves with no impact', () => {
  const { presentation } = layer();
  const view = camera();
  const shell = shellRecord();
  // First snapshot ever seen is already most of the way through the warning.
  presentation.update(.05, snapshot({ bombardments: [shell] }, shell.impactAt - .4), 1, view, {});
  const model = presentation.shells.get(shell.id);
  assert.equal(model.mark.visible, true);
  const launch = new THREE.Vector3(shell.x, shell.y, shell.z);
  const ground = new THREE.Vector3(shell.impactX, shell.impactY, shell.impactZ);
  const covered = model.shell.position.distanceTo(launch) / launch.distanceTo(ground);
  assert.ok(covered > .6, `a late joiner sees the shell where it actually is (${(covered * 100).toFixed(0)}% down), not at its launch`);
  assert.ok(model.shell.position.distanceTo(ground) < model.shell.position.distanceTo(launch));
  assert.ok(model.disc.scale.x < .2, 'and sees how little warning is left');
  // A dead crab takes its outstanding shells with it: they simply stop existing.
  presentation.update(.05, snapshot({ bombardments: [] }, shell.impactAt - .2), 2, view, {});
  assert.equal(presentation.shells.has(shell.id), false);
  assert.equal(presentation.getStats().shells, 0);
  presentation.dispose();
});

test('a hit flashes the crab the server named, on the world effect clock', () => {
  const { presentation } = layer();
  const view = camera();
  const state = snapshot();
  presentation.update(.016, state, 1, view, { effectTime: 10 });
  const model = presentation.hitTarget(SKY_BOSSES[0].id);
  assert.ok(model, 'world can find a skycrab to flash by its snapshot id');
  assert.equal(presentation.hitTarget('skycrab-nobody'), null);
  assert.equal(presentation.hitTarget(undefined), null);
  const resting = model.body.scale.x;
  // world stamps flashUntil against its own effect clock, not the render clock.
  model.flashUntil = 10.13;
  presentation.update(.016, state, 99, view, { effectTime: 10.05 });
  assert.ok(model.body.scale.x > resting, 'the hit reads as a pop around the sphere centre');
  presentation.update(.016, state, 99, view, { effectTime: 10.2 });
  assert.equal(model.body.scale.x, resting, 'and settles back to the fitted silhouette');
  presentation.dispose();
});

test('the layer owns its own telegraph ids so the generic ring is never drawn twice', () => {
  assert.equal(skyBombardmentId(`${SKY_BOMBARD_ID_PREFIX}7`), true);
  assert.equal(skyBombardmentId('telegraph-crab-3'), false);
  assert.equal(skyBombardmentId(undefined), false);
  const { presentation } = layer();
  assert.equal(presentation.ownsTelegraph(`${SKY_BOMBARD_ID_PREFIX}0`), true);
  presentation.dispose();
});

test('reduced motion and low quality keep the hazard readable without animation', () => {
  const { presentation } = layer();
  const view = camera();
  const shell = shellRecord();
  const state = snapshot({ bombardments: [shell] }, shell.launchAt + 1.4);
  presentation.update(.05, state, 3, view, { reducedMotion: true, lowQuality: true });
  const model = presentation.shells.get(shell.id);
  assert.equal(model.mark.visible, true, 'the warning ring survives every effects mode');
  assert.ok(model.disc.scale.x > .01 && model.disc.scale.x < 1, 'the countdown still reads');
  assert.equal(model.ring.material.opacity, .95, 'no flashing under reduced motion');
  assert.equal(model.tail.visible, false, 'the low-quality mode drops the trail, not the shell');
  assert.equal(model.shell.visible, true);
  const spin = model.core.rotation.z;
  presentation.update(.05, state, 9, view, { reducedMotion: true, lowQuality: true });
  assert.equal(model.core.rotation.z, spin, 'nothing spins under reduced motion');
  presentation.dispose();
});

test('victory, a restart and every other stage clear the whole layer', () => {
  const { presentation } = layer();
  const view = camera();
  presentation.update(.016, snapshot({ bombardments: [shellRecord()] }), 1, view, {});
  assert.equal(presentation.getStats().bosses, 2);
  for (const dead of [{ phase: 'victory', elapsed: 300, finale: { stage: 4, stages: 4, remaining: 0 } },
    { phase: 'lobby', elapsed: 0, round: 2 },
    { phase: 'finale', elapsed: 10, finale: { stage: 3, stages: 4, remaining: 1 } },
    { ...snapshot(), finale: { ...snapshot().finale, stage: 3 } },
    snapshot({ status: 'unknown-status' }),
    { phase: 'finale', elapsed: 10, finale: { stage: 4, stages: 4, remaining: 0, sky: null } }]) {
    presentation.update(.016, dead, 2, view, {});
    assert.deepEqual(presentation.getStats(), { bosses: 0, bossModels: 2, shells: 0, shellModels: 1 }, JSON.stringify(dead.phase));
    assert.equal(presentation.group.visible, false);
    assert.equal(skyState(dead), null);
  }
  presentation.update(.016, snapshot({ status: 'cleared', bombardments: [shellRecord()] }), 2, view, {});
  assert.equal(presentation.getStats().bosses, 0);
  assert.equal(presentation.getStats().shells, 0, 'a cleared block never keeps an attack visible');
  // Coming back for another round reuses the same bounded models.
  presentation.update(.016, snapshot(), 3, view, {});
  assert.equal(presentation.getStats().bossModels, 2);
  presentation.dispose();
});

test('disposing releases only this layer, twice safely, and leaves the shared palette alone', () => {
  const { scene, palette, presentation } = layer();
  presentation.update(.016, snapshot({ bombardments: [shellRecord()] }), 1, camera(), {});
  let sharedDisposed = 0, ownedDisposed = 0;
  palette.solid.addEventListener('dispose', () => sharedDisposed++);
  palette.glow.addEventListener('dispose', () => sharedDisposed++);
  const owned = new Set();
  presentation.group.traverse((object) => { if (object.geometry) owned.add(object.geometry); });
  for (const geometry of owned) geometry.addEventListener('dispose', () => ownedDisposed++);
  presentation.dispose(); presentation.dispose();
  assert.equal(presentation.group.parent, null);
  assert.equal(scene.children.includes(presentation.group), false);
  assert.equal(ownedDisposed, owned.size, 'every owned geometry disposed exactly once');
  assert.equal(sharedDisposed, 0, 'the shared island palette stays usable');
});

test('the reticle ray mirrors the server target filter and the real cannon range', () => {
  const state = snapshot();
  const boss = state.finale.sky.bosses[0];
  const from = { x: boss.x - 60, y: boss.y, z: boss.z };
  const direction = { x: 1, y: 0, z: 0 };
  assert.equal(skyBossAtRay(state, from, direction)?.id, boss.id);
  const surface = raySphereSurface(from, direction, boss);
  assert.equal(skyBossAtRay(state, from, direction, surface - 1e-6), null);
  assert.equal(skyBossAtRay(state, from, direction, surface + 1e-6)?.id, boss.id, 'the shared server surface calculation is used');
  const far = { ...from, x: boss.x - GUN_RANGE - boss.radius - 1 };
  assert.equal(skyBossAtRay(state, far, direction), null, 'the default is the real cannon range');
  assert.equal(skyBossAtRay(state, far, direction, Infinity), null, 'a caller cannot widen the real range');
  assert.equal(skyBossAtRay(state, from, direction, NaN), null);
  assert.equal(skyBossAtRay(state, from, direction, 40), null, 'beyond cannon range there is no target');
  assert.equal(skyBossAtRay(state, { ...from, y: boss.y + boss.radius + 1 }, direction), null, 'a miss stays a miss');
  for (const mutate of [{ hp: 0 }, { state: 'down' }]) {
    const filtered = snapshot({ bosses: [{ ...boss, ...mutate }, state.finale.sky.bosses[1]] });
    assert.equal(skyBossAtRay(filtered, from, direction), null, JSON.stringify(mutate));
  }
  for (const status of ['boarding', 'countdown', 'cleared']) {
    assert.deepEqual(skyTargets(snapshot({ status })), [], `${status} offers no targets`);
  }
  // Nearest surface wins, exactly like the authoritative sphere test.
  const near = { ...boss, id: SKY_BOSSES[1].id, name: SKY_BOSSES[1].name, x: boss.x - 20, radius: SKY_BOSSES[1].radius };
  assert.equal(skyBossAtRay(snapshot({ bosses: [boss, near] }), from, direction)?.id, near.id);
});
