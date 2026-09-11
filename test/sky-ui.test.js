import test from 'node:test';
import assert from 'node:assert/strict';
import { skyHud, skyGunnerGuidance, skyObjective, nearestObjective, glideLanding, skyWaveAnnouncement, objectiveMarkerHeight, findInteractable, airshipBanner } from '../client/ui.js';
import { SKY_BOSSES, SKY_GROUND_WAVES, skyBossPose } from '../shared/sky-finale.js';
import { SHIP_GUNS, SHIP_JUMP_POINTS, AIRSHIP_RETURNS, gunOperator, jumpLaunchPose } from '../shared/airship.js';
import { BEACON, SPAWN, shipAt, heightAt } from '../shared/world.js';

const SHIP = shipAt(200);
const HAVEN = AIRSHIP_RETURNS.find((lift) => lift.id === 'airship-return-haven');
const bossRecord = (descriptor, overrides = {}) => {
  const pose = skyBossPose(descriptor, 0, SHIP);
  return { id: descriptor.id, name: descriptor.name, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw,
    hp: 600, maxHp: 900, radius: descriptor.radius, state: 'flying', ...overrides };
};
function state(sky = {}, extra = {}) {
  return { phase: 'finale', elapsed: 300, enemies: [], players: [], shrines: [], shards: 3, bossId: null,
    shipGuns: SHIP_GUNS.map((gun) => ({ id: gun.id, occupantId: null, readyAt: 0 })),
    finale: { stage: 4, stages: 4, remaining: 7, sky: { status: 'active', countdownEndsAt: 0, wave: 2, waves: 3,
      groundActive: 4, groundPending: 2, groundFuture: 1, nextWaveAt: 0,
      bosses: SKY_BOSSES.map((descriptor) => bossRecord(descriptor)), bombardments: [], ...sky } }, ...extra };
}
const aboard = (overrides = {}) => ({ id: 'p0', name: 'Gunner', online: true, hp: 100, knockedUntil: 0,
  mode: 'aboard', deckX: 0, deckZ: 0, gunId: null, x: SHIP.x, y: SHIP.y, z: SHIP.z, ...overrides });
const onGround = (overrides = {}) => ({ ...aboard(), mode: 'ground', grounded: true, x: BEACON.x + 8, y: heightAt(BEACON.x + 8, BEACON.z), z: BEACON.z, ...overrides });
const down = (descriptor) => bossRecord(descriptor, { hp: 0, state: 'down' });

test('the siege HUD separates current attackers from future waves', () => {
  const hud = skyHud(state(), aboard());
  assert.equal(hud.bosses.length, 2, 'two boss displays, in authored order');
  assert.deepEqual(hud.bosses.map((boss) => boss.name), SKY_BOSSES.map((boss) => boss.name));
  assert.deepEqual(hud.bosses.map((boss) => boss.side), ['port', 'starboard']);
  for (const boss of hud.bosses) { assert.equal(boss.percent, 67); assert.equal(boss.down, false); }
  assert.equal(hud.phase, 'Wave 2 of 3');
  // Queued ranks and unstarted waves are counted, so a gap never reads as clear.
  assert.equal(hud.groundLeft, 6);
  assert.equal(hud.hasGroundWork, true);
  assert.match(hud.ground, /6 attackers active or incoming/);
  assert.match(hud.ground, /1 wave to come/);
  assert.equal(hud.airLeft, 2);
  // No centre integrity, timer or failure state exists to report.
  assert.equal('integrity' in hud, false);
  assert.equal('failed' in hud, false);
});

test('setup, countdown, a wave gap and both completion orders each read correctly', () => {
  const boarding = skyHud(state({ status: 'boarding', bosses: [], wave: 0, groundActive: 0, groundPending: 0, groundFuture: 3 }), aboard());
  assert.equal(boarding.phase, 'Waiting for a gunner');
  assert.ok(boarding.bosses.every((boss) => boss.planned && !boss.down), 'an empty boarding array is planned, not defeated');
  assert.equal(boarding.bosses[0].percent, 0);
  assert.equal(boarding.airLeft, 2, 'both crabs are still to come');
  const countdown = skyHud(state({ status: 'countdown', countdownEndsAt: 304, bosses: [], wave: 0 }), aboard());
  assert.equal(countdown.phase, 'Skycrabs dive in 4s');
  assert.equal(countdown.countdown, 4);
  const gap = skyHud(state({ wave: 1, groundActive: 0, groundPending: 0, groundFuture: 2 }), aboard());
  assert.equal(gap.waiting, true);
  assert.match(gap.ground, /Wave 2 of 3 is forming up/);
  assert.equal(gap.groundLeft, 0, 'unstarted waves are not counted as individual attackers');
  assert.equal(gap.hasGroundWork, true, 'an inter-wave gap is not a cleared objective');
  const airFirst = skyHud(state({ bosses: SKY_BOSSES.map(down) }), aboard());
  assert.equal(airFirst.airLeft, 0); assert.ok(airFirst.groundLeft > 0);
  assert.ok(airFirst.bosses.every((boss) => boss.down));
  const groundFirst = skyHud(state({ wave: 3, groundActive: 0, groundPending: 0, groundFuture: 0 }), aboard());
  assert.equal(groundFirst.phase, 'Ground clear');
  assert.match(groundFirst.ground, /All three waves cleared/);
  assert.equal(groundFirst.airLeft, 2);
  const cleared = skyHud(state({ status: 'cleared', bosses: SKY_BOSSES.map(down), wave: 3, groundActive: 0, groundPending: 0, groundFuture: 0 }), aboard());
  assert.equal(cleared.phase, 'Island secured');
  assert.equal(cleared.airLeft, 0);
  assert.equal(cleared.hasGroundWork, false);
  assert.ok(cleared.bosses.every(boss => boss.down && !boss.planned));
  assert.match(cleared.ground, /All three waves cleared/);
  assert.equal(skyHud({ phase: 'victory', elapsed: 9, finale: { stage: 4, stages: 4, remaining: 0 } }, aboard()), null,
    'victory omits the block, so the HUD says nothing about boarding');
  assert.equal(skyHud({ phase: 'finale', elapsed: 9, finale: { stage: 3, stages: 4, remaining: 2 } }, aboard()), null);
});

test('a gunner is told which crab is on their side, where it is and how much is left', () => {
  const scene = state();
  for (const gun of SHIP_GUNS) {
    const player = aboard({ gunId: gun.id, ...gunOperator(gun) && { deckX: gunOperator(gun).x, deckZ: gunOperator(gun).z } });
    const guidance = skyGunnerGuidance(scene, player);
    const side = gun.x < 0 ? 'port' : 'starboard';
    const expected = SKY_BOSSES.find((boss) => boss.side === side);
    assert.equal(guidance.kind, 'boss', gun.id);
    assert.equal(guidance.boss.id, expected.id, `${gun.id} is pointed at its own broadside`);
    assert.match(guidance.title, new RegExp(expected.name));
    assert.match(guidance.detail, /67%/);
    // The marker is the boss itself, at its authoritative altitude, so an
    // offscreen crab still has an edge arrow instead of nothing at all.
    const marker = skyObjective(scene, player);
    assert.equal(marker.kind, 'sky-boss');
    assert.equal(marker.id, expected.id);
    assert.equal(objectiveMarkerHeight(marker), marker.y);
    assert.ok(marker.y > 60, 'the marker rides the lane, not the terrain');
    assert.notEqual(nearestObjective(scene, player), null, 'a gun user is no longer left with no objective at all');
  }
});

test('a finished broadside sends the gunner to the other side, then down to the dais', () => {
  const portGun = SHIP_GUNS.find((gun) => gun.x < 0);
  const portDead = state({ bosses: SKY_BOSSES.map((descriptor) => descriptor.side === 'port' ? down(descriptor) : bossRecord(descriptor)) });
  const switching = skyGunnerGuidance(portDead, aboard({ gunId: portGun.id }));
  assert.equal(switching.kind, 'switch');
  assert.match(switching.title, /Squallmaw/);
  assert.match(switching.detail, /leave this gun/i);
  assert.match(switching.detail, /starboard gun/);
  assert.equal(skyObjective(portDead, aboard({ gunId: portGun.id })).id, SKY_BOSSES[1].id,
    'the marker shows where the remaining crab is, without aiming the gun');
  // Air clear, ground still out: leave the gun and use a gate, not a new weapon.
  const airClear = state({ bosses: SKY_BOSSES.map(down) });
  const descend = skyGunnerGuidance(airClear, aboard({ gunId: portGun.id }));
  assert.equal(descend.kind, 'descend');
  assert.match(descend.detail, /leave the gun/i);
  assert.match(descend.detail, /jump gate/);
  assert.equal(skyObjective(airClear, aboard({ gunId: portGun.id })).kind, 'jump-gate', 'a physical waypoint comes first');
  const finished = state({ bosses: SKY_BOSSES.map(down), wave: 3, groundActive: 0, groundPending: 0, groundFuture: 0 });
  assert.equal(skyGunnerGuidance(finished, aboard({ gunId: portGun.id })).kind, 'clear');
  // Setup keeps a ready gunner at their post rather than sending them away.
  const ready = state({ status: 'countdown', countdownEndsAt: 303, bosses: [], wave: 0 });
  assert.equal(skyGunnerGuidance(ready, aboard({ gunId: portGun.id })).kind, 'ready');
  assert.equal(skyObjective(ready, aboard({ gunId: portGun.id })), null, 'a ready gunner is not sent to an exit');
  assert.equal(nearestObjective(ready, aboard({ gunId: portGun.id })), null);
  assert.equal(skyGunnerGuidance(state(), aboard()), null, 'nothing mounted, nothing gunner-specific');
  assert.equal(skyGunnerGuidance({ phase: 'finale', elapsed: 1, finale: { stage: 2, stages: 4 } }, aboard({ gunId: portGun.id })), null);
});

test('dismounting after a kill keeps guidance on the live side and prefers a free gun', () => {
  for (const defeated of SKY_BOSSES) {
    const survivor = SKY_BOSSES.find(boss => boss.id !== defeated.id);
    const oldGun = SHIP_GUNS.find(gun => (gun.x < 0 ? 'port' : 'starboard') === defeated.side && gun.z === 0);
    const stance = gunOperator(oldGun);
    const player = aboard({ deckX: stance.x, deckZ: stance.z, gunId: oldGun.id });
    for (const lingering of [true, false]) {
      const scene = state({ bosses: [bossRecord(survivor), ...(lingering ? [down(defeated)] : [])] });
      assert.equal(skyGunnerGuidance(scene, player).kind, 'switch');
      const unmounted = { ...player, gunId: null };
      const next = skyObjective(scene, unmounted);
      assert.ok(next.id.includes(survivor.side), 'leaving a gun must not point back to the defeated side');
      assert.equal(next.occupied, false);
      scene.shipGuns.find(gun => gun.id === next.id).occupantId = 'teammate';
      const free = skyObjective(scene, unmounted);
      assert.notEqual(free.id, next.id, 'a free compatible gun wins over a nearer occupied one');
      assert.ok(free.id.includes(survivor.side));
      assert.equal(free.occupied, false);
      scene.shipGuns.find(gun => gun.id === free.id).occupantId = 'other-teammate';
      const waiting = skyObjective(scene, unmounted);
      assert.equal(waiting.occupied, true);
      assert.match(waiting.name, /occupied/);
      assert.ok(waiting.id.includes(survivor.side));
    }
  }
});

test('a gunner returning between waves sees waves rather than a made-up attacker count', () => {
  const scene = state({ bosses: [], wave: 1, groundActive: 0, groundPending: 0, groundFuture: 2 });
  const gunner = aboard({ gunId: SHIP_GUNS[0].id });
  const guidance = skyGunnerGuidance(scene, gunner);
  assert.equal(guidance.kind, 'descend');
  assert.match(guidance.detail, /2 waves to come/);
  assert.doesNotMatch(guidance.detail, /2 attackers/);
  assert.equal(skyObjective(scene, onGround()).kind, 'beacon', 'future waves still need ground defense');
  const cleared = state({ status: 'cleared', bosses: [], wave: 3, groundActive: 0, groundPending: 0, groundFuture: 0 });
  assert.equal(skyGunnerGuidance(cleared, gunner).kind, 'clear');
  assert.equal(nearestObjective(cleared, gunner), null);
  assert.equal(nearestObjective(cleared, aboard()), null);
});

test('stage-four objectives put a physical waypoint first for every role', () => {
  const scene = state();
  // Aboard and unmounted while the crabs fly: the nearest cannon.
  const cannon = skyObjective(scene, aboard());
  assert.equal(cannon.kind, 'cannon');
  assert.ok(SHIP_GUNS.some((gun) => gun.id === cannon.id));
  assert.equal(objectiveMarkerHeight(cannon), cannon.y, 'a deck gun marks the deck, not the sea below it');
  // Readiness sends an aboard pirate to a gun too.
  assert.equal(skyObjective(state({ status: 'boarding', bosses: [], wave: 0 }), aboard()).kind, 'cannon');
  // Sky clear and ground still out: back down through a gate.
  const airClear = state({ bosses: SKY_BOSSES.map(down) });
  assert.equal(skyObjective(airClear, aboard()).kind, 'jump-gate');
  // Gliding: the safe lighthouse landing beside the haven lift, from both gates.
  for (const gate of SHIP_JUMP_POINTS) {
    const pose = jumpLaunchPose(gate, SHIP);
    const landing = skyObjective(scene, { ...aboard(), mode: 'gliding', ...pose });
    assert.equal(landing.kind, 'landing');
    assert.equal(landing.x, HAVEN.x); assert.equal(landing.z, HAVEN.z);
    assert.match(landing.name, /Lighthouse/);
    assert.deepEqual([glideLanding(scene, { ...pose, mode: 'gliding' }).x, glideLanding(scene, { ...pose, mode: 'gliding' }).z], [HAVEN.x, HAVEN.z],
      `${gate.id} glide guidance agrees`);
    // The route is a real glide, not a straight line through the lighthouse tower.
    const run = Math.hypot(HAVEN.x - pose.x, HAVEN.z - pose.z), drop = pose.y - heightAt(HAVEN.x, HAVEN.z);
    assert.ok(run <= drop * (11 / 6), `${gate.id} landing is reachable at sprint glide (${run.toFixed(0)}m across, ${drop.toFixed(0)}m down)`);
  }
  // On the ground: the dais while a wave is out, the lift while only the air is.
  assert.equal(skyObjective(scene, onGround()).kind, 'beacon');
  assert.equal(skyObjective(state({ groundActive: 0, groundPending: 0, groundFuture: 0 }), onGround()).id, HAVEN.id);
  assert.equal(skyObjective(state({ status: 'boarding', bosses: [], wave: 0, groundActive: 0, groundPending: 0, groundFuture: 3 }), onGround()).id, HAVEN.id);
  // A late joiner still gliding near the strand is shown the lighthouse, not moved.
  const lateJoin = { ...aboard(), mode: 'gliding', x: SPAWN.x, y: 32, z: SPAWN.z };
  assert.match(skyObjective(scene, lateJoin).name, /Lighthouse/);
});

test('earlier stages, the voyage and the deck rules of the ship are all untouched', () => {
  const voyage = { phase: 'voyage', elapsed: 10, enemies: [], players: [], shrines: [], shards: 0,
    shipGuns: SHIP_GUNS.map((gun) => ({ id: gun.id, occupantId: null, readyAt: 0 })) };
  assert.equal(skyObjective(voyage, aboard()), null);
  assert.equal(nearestObjective(voyage, aboard()).kind, 'jump-gate', 'the WP-0 gate marker still leads aboard');
  assert.equal(nearestObjective(voyage, aboard({ gunId: SHIP_GUNS[0].id })), null, 'practice gunners keep their quiet HUD');
  const tempest = { ...voyage, phase: 'finale', bossId: 'boss-1',
    enemies: [{ id: 'boss-1', type: 'tempest', x: BEACON.x, y: heightAt(BEACON.x, BEACON.z), z: BEACON.z, hp: 400, maxHp: 650 }],
    finale: { stage: 3, stages: 4, remaining: 1 } };
  const boss = nearestObjective(tempest, onGround());
  assert.equal(boss.kind, 'boss');
  assert.equal(objectiveMarkerHeight(boss), heightAt(boss.x, boss.z) + 4, 'the Tempest keeps its raised marker');
  // Gate prompts and the deck banner behave exactly as WP-0 left them.
  const scene = state();
  const atGate = aboard({ deckX: SHIP_JUMP_POINTS[0].x, deckZ: SHIP_JUMP_POINTS[0].z });
  assert.equal(findInteractable(scene, atGate).kind, 'jump-gate');
  assert.equal(airshipBanner(scene, atGate).button, 'Glide to lighthouse');
  const atGun = aboard({ deckX: gunOperator(SHIP_GUNS[0]).x, deckZ: gunOperator(SHIP_GUNS[0]).z });
  assert.equal(findInteractable(scene, atGun).kind, 'gun');
});

test('each ground wave announces itself instead of repeating the stage banner', () => {
  for (const plan of SKY_GROUND_WAVES) {
    const announcement = skyWaveAnnouncement({ kind: 'sky-wave', wave: plan.index, waves: SKY_GROUND_WAVES.length,
      spawns: [{ type: 'crab' }, { type: 'crab' }] });
    assert.equal(announcement.kicker, plan.name);
    assert.equal(announcement.title, plan.index === SKY_GROUND_WAVES.length ? 'Last wave' : `Wave ${plan.index} of 3`);
    assert.equal(announcement.subtitle, plan.notice);
    assert.equal(announcement.final, plan.index === SKY_GROUND_WAVES.length);
    assert.doesNotMatch(announcement.subtitle, /Stage 4/);
  }
  const elites = skyWaveAnnouncement({ kind: 'sky-wave', wave: 2, waves: 3, spawns: [{ type: 'tidebreaker' }, { type: 'crab' }] });
  assert.match(elites.subtitle, /1 Tidebreaker leads/);
  for (const invalid of [null, { kind: 'finale', stage: 4 }, { kind: 'sky-wave' }, { kind: 'sky-wave', wave: 0 }, { kind: 'sky-wave', wave: 9 }]) {
    assert.equal(skyWaveAnnouncement(invalid), null, JSON.stringify(invalid));
  }
});
