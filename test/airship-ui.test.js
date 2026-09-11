import test from 'node:test';
import assert from 'node:assert/strict';
import { airshipBanner, cannonPresentation, deckPromptMirrored, findInteractable, flyingTargetAtRay, glideLanding, nearestObjective, objectiveMarkerHeight } from '../client/ui.js';
import { AIRSHIP_RETURNS, RETURN_RANGE, SHIP_GUNS, SHIP_JUMP_POINTS, JUMP_INTERACTION_RANGE, GUN_COOLDOWN, GUN_RANGE, gunMuzzle, gunOperator, jumpLaunchPose } from '../shared/airship.js';
import { SHIP_DURATION, SPAWN, BEACON, SHRINES, heightAt, shipAt } from '../shared/world.js';
import { createRemoteInterpolation, displayedSpeed } from '../client/interpolation.js';

function fixture(point = AIRSHIP_RETURNS[0]) {
  const player = { id: 'captain', name: 'Captain', online: true, hp: 100, mode: 'ground', grounded: true,
    knockedUntil: 0, gunId: null, shipReturned: false, x: point.x, y: heightAt(point.x, point.z), z: point.z };
  const state = { phase: 'voyage', elapsed: 40, players: [player], enemies: [], shards: 0,
    shrines: SHRINES.map((shrine) => ({ id: shrine.id, status: 'dormant' })),
    shipGuns: SHIP_GUNS.map((gun) => ({ id: gun.id, occupantId: null, readyAt: 0 })), flyingTargets: [] };
  return { state, player };
}

function aboard(state, player, gun = SHIP_GUNS[0]) {
  const operator = gunOperator(gun), ship = shipAt(state.elapsed);
  Object.assign(player, { mode: 'aboard', x: ship.x + operator.x, y: ship.y, z: ship.z + operator.z,
    deckX: operator.x, deckZ: operator.z });
}

test('both airship lifts offer return in voyage and finale while preserving revive priority', () => {
  for (const lift of AIRSHIP_RETURNS) for (const phase of ['voyage', 'finale']) {
    const { state, player } = fixture(lift); state.phase = phase;
    assert.equal(findInteractable(state, player)?.id, lift.id);
    assert.equal(findInteractable(state, player)?.label, 'Teleport to airship');
    const friend = { ...player, id: 'friend', name: 'Matey', knockedUntil: state.elapsed + 6 };
    state.players.push(friend);
    assert.equal(findInteractable(state, player)?.kind, 'revive');
  }
});

test('return hints reject distance, vertical distance, airborne, downed, dead, offline and closed phases', () => {
  for (const lift of AIRSHIP_RETURNS) for (const mutate of [
    ({ player }) => { player.x += RETURN_RANGE + .01; },
    ({ player }) => { player.y += RETURN_RANGE + .01; },
    ({ player }) => { player.x += 2.3; player.y += 2.3; },
    ({ player }) => { player.grounded = false; },
    ({ player }) => { player.mode = 'gliding'; },
    ({ player }) => { player.knockedUntil = 80; },
    ({ player }) => { player.hp = 0; },
    ({ player }) => { player.online = false; },
    ({ state }) => { state.phase = 'lobby'; },
    ({ state }) => { state.phase = 'victory'; },
  ]) {
    const scenario = fixture(lift); mutate(scenario);
    assert.notEqual(findInteractable(scenario.state, scenario.player)?.kind, 'airship-return');
  }
});

test('all four gun prompts work aboard, name occupied crew and leave only the mounted gun', () => {
  for (const gun of SHIP_GUNS) {
    const { state, player } = fixture(); aboard(state, player, gun);
    const prompt = findInteractable(state, player);
    assert.equal(prompt?.id, gun.id); assert.equal(prompt.label, `Man ${gun.name}`);
    state.shipGuns.find((entry) => entry.id === gun.id).occupantId = 'friend';
    state.players.push({ id: 'friend', name: 'Crab Captain' });
    const occupied = findInteractable(state, player);
    assert.equal(occupied.disabled, true); assert.match(occupied.label, /Crab Captain/);
    player.gunId = gun.id;
    assert.equal(findInteractable(state, player).label, 'Leave gun');
    assert.equal(nearestObjective(state, player), null);
    player.gunId = null; player.deckX = 0; player.deckZ = -4;
    assert.equal(findInteractable(state, player), null);
  }
});

test('gun prompts reject lobby, victory, downed and invalid stations', () => {
  for (const mutate of [
    ({ state }) => { state.phase = 'lobby'; },
    ({ state }) => { state.phase = 'victory'; },
    ({ player }) => { player.knockedUntil = 80; },
    ({ player }) => { player.hp = 0; },
    ({ player }) => { player.online = false; },
  ]) {
    const scenario = fixture(); aboard(scenario.state, scenario.player); mutate(scenario);
    assert.equal(findInteractable(scenario.state, scenario.player), null);
  }
  const { state, player } = fixture(); aboard(state, player); player.gunId = 'unknown';
  assert.equal(cannonPresentation(state, player), null);
});

test('cannon HUD uses station cooldown, unlimited role and neutral scope despite carried Longshot reload', () => {
  const { state, player } = fixture(); aboard(state, player);
  Object.assign(player, { gunId: SHIP_GUNS[0].id, weapon: 'longshot', ammo: 0, reloadUntil: 400 });
  state.shipGuns[0].readyAt = state.elapsed + GUN_COOLDOWN;
  const options = { connected: true, controlsActive: true, aiming: true };
  const busy = cannonPresentation(state, player, options);
  assert.equal(busy.name, 'Deck cannon'); assert.equal(busy.active, true);
  assert.equal(busy.reloading, true); assert.equal(busy.scoped, false); assert.equal(busy.sensitivity, 1);
  assert.ok(Math.abs(busy.reloadProgress) < 1e-8);
  const ready = cannonPresentation(state, player, { ...options, elapsed: state.elapsed + GUN_COOLDOWN });
  assert.equal(ready.reloading, false); assert.equal(ready.remaining, 0);
  assert.equal(player.ammo, 0); assert.equal(player.reloadUntil, 400);
  for (const overrides of [{ connected: false }, { controlsActive: false }, { menuOpen: true }]) {
    const hidden = cannonPresentation(state, player, { ...options, ...overrides });
    assert.equal(hidden.active, false); assert.equal(hidden.reloading, false); assert.equal(hidden.scoped, false);
  }
});

test('ship banner never counts down or advertises Space, and only offers its button at a gate', () => {
  for (const elapsed of [2, SHIP_DURATION - 4, SHIP_DURATION + 600]) {
    const { state, player } = fixture(); aboard(state, player); state.elapsed = elapsed;
    const away = airshipBanner(state, player);
    assert.equal(away.button, null, 'no departure button away from a gate');
    assert.doesNotMatch(away.text, /until|drops|\d+s|Space/);
    assert.match(away.text, /JUMP gate/);
    player.gunId = SHIP_GUNS[0].id; player.shipReturned = true;
    assert.equal(airshipBanner(state, player).button, 'Leave gun');
    assert.match(airshipBanner(state, player).text, /Hold click fire/);
    player.gunId = null;
    for (const gate of SHIP_JUMP_POINTS) {
      Object.assign(player, { deckX: gate.x, deckZ: gate.z });
      const banner = airshipBanner(state, player);
      assert.equal(banner.button, 'Jump & glide to island');
      assert.match(banner.text, new RegExp(gate.name));
      assert.doesNotMatch(banner.text, /Space/);
      assert.equal(airshipBanner({ ...state, phase: 'finale' }, player).button, 'Glide to lighthouse');
    }
    assert.equal(airshipBanner(state, { ...player, mode: 'ground' }), null);
  }
});

test('only deck-mounted markers use an absolute height; island objectives keep terrain offsets', () => {
  const ship = shipAt(40);
  const gate = { id: 'jump-gate-bow', kind: 'jump-gate', x: ship.x, y: ship.y + 2.6, z: ship.z - 11 };
  assert.equal(objectiveMarkerHeight(gate), ship.y + 2.6);
  // A finale boss reports feet height and must keep its own raised offset.
  const boss = { id: 'boss', kind: 'boss', x: BEACON.x, y: heightAt(BEACON.x, BEACON.z), z: BEACON.z };
  assert.equal(objectiveMarkerHeight(boss), heightAt(BEACON.x, BEACON.z) + 4);
  for (const kind of ['landing', 'beacon', 'shrine', undefined]) {
    assert.equal(objectiveMarkerHeight({ kind, x: SPAWN.x, y: heightAt(SPAWN.x, SPAWN.z), z: SPAWN.z }), heightAt(SPAWN.x, SPAWN.z) + 9, String(kind));
  }
  assert.equal(objectiveMarkerHeight({ kind: 'jump-gate', x: 0, y: NaN, z: 0 }), heightAt(0, 0) + 9);
});

test('the deck banner and its button share the aboard interaction guard', () => {
  const active = () => { const scenario = fixture(); aboard(scenario.state, scenario.player); return scenario; };
  for (const mutate of [
    ({ state }) => { state.phase = 'lobby'; },
    ({ state }) => { state.phase = 'victory'; },
    ({ player, state }) => { player.knockedUntil = state.elapsed + 6; },
    ({ player }) => { player.hp = 0; },
    ({ player }) => { player.online = false; },
  ]) {
    const scenario = active(); mutate(scenario);
    assert.equal(airshipBanner(scenario.state, scenario.player), null, 'no stale deck text outside an active voyage');
    // The prompt agrees, so the banner can never offer an E the server refuses.
    assert.equal(findInteractable(scenario.state, scenario.player), null);
    Object.assign(scenario.player, { deckX: SHIP_JUMP_POINTS[0].x, deckZ: SHIP_JUMP_POINTS[0].z });
    assert.equal(airshipBanner(scenario.state, scenario.player), null, 'standing on a gate does not revive the button');
    scenario.player.gunId = SHIP_GUNS[0].id;
    assert.equal(airshipBanner(scenario.state, scenario.player), null, 'nor does a mounted station');
  }
  // Valid active states keep the instructional text even with no gate in reach.
  for (const phase of ['voyage', 'finale']) {
    const { state, player } = active(); state.phase = phase;
    Object.assign(player, { deckX: 0, deckZ: 0, gunId: null });
    const banner = airshipBanner(state, player);
    assert.equal(banner.button, null); assert.match(banner.text, /JUMP gate/);
  }
  // An occupied gun offers no button: that prompt belongs to the E hint.
  const { state, player } = active();
  const operator = gunOperator(SHIP_GUNS[0]);
  Object.assign(player, { deckX: operator.x, deckZ: operator.z, gunId: null });
  state.shipGuns.find((entry) => entry.id === SHIP_GUNS[0].id).occupantId = 'friend';
  state.players.push({ id: 'friend', name: 'Crab Captain' });
  assert.equal(airshipBanner(state, player).button, null);
});

test('the deck banner owns the aboard E prompt and never duplicates it beside itself', () => {
  const { state, player } = fixture(); aboard(state, player);
  // At a gate, and while mounted, the banner button is the only E presentation.
  Object.assign(player, { deckX: SHIP_JUMP_POINTS[0].x, deckZ: SHIP_JUMP_POINTS[0].z, gunId: null });
  assert.equal(deckPromptMirrored(airshipBanner(state, player), findInteractable(state, player)), true);
  player.gunId = SHIP_GUNS[0].id;
  assert.equal(deckPromptMirrored(airshipBanner(state, player), findInteractable(state, player)), true);
  // A gun you have not mounted still gets its own prompt: the banner has no button.
  const operator = gunOperator(SHIP_GUNS[0]);
  Object.assign(player, { deckX: operator.x, deckZ: operator.z, gunId: null });
  const banner = airshipBanner(state, player), prompt = findInteractable(state, player);
  assert.equal(banner.button, null); assert.equal(prompt.kind, 'gun');
  assert.equal(deckPromptMirrored(banner, prompt), false);
  // Ground interactions are never suppressed.
  const island = fixture();
  assert.equal(airshipBanner(island.state, island.player), null);
  assert.equal(deckPromptMirrored(null, findInteractable(island.state, island.player)), false);
});

test('both gates prompt for E from every side of their pad and never from a gun stance', () => {
  for (const gate of SHIP_JUMP_POINTS) {
    const { state, player } = fixture(); aboard(state, player);
    for (const [dx, dz] of [[0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4], [1.3, 1.3]]) {
      Object.assign(player, { deckX: gate.x + dx, deckZ: gate.z + dz });
      const prompt = findInteractable(state, player);
      assert.equal(prompt?.id, gate.id, `${gate.id} at ${dx},${dz}`);
      assert.equal(prompt.kind, 'jump-gate');
      assert.equal(prompt.label, 'Jump & glide to island');
      assert.equal(findInteractable({ ...state, phase: 'finale' }, player).label, 'Glide to lighthouse');
    }
    Object.assign(player, { deckX: gate.x, deckZ: gate.z + JUMP_INTERACTION_RANGE + 0.3 });
    assert.notEqual(findInteractable(state, player)?.kind, 'jump-gate', 'out of range');
    // Every gun stance offers the gun, never a gate.
    for (const gun of SHIP_GUNS) {
      const operator = gunOperator(gun);
      Object.assign(player, { deckX: operator.x, deckZ: operator.z, gunId: null });
      assert.equal(findInteractable(state, player)?.kind, 'gun');
    }
    // A mounted crew member is still only offered the station.
    player.gunId = SHIP_GUNS[0].id;
    Object.assign(player, { deckX: gate.x, deckZ: gate.z });
    assert.equal(findInteractable(state, player).label, 'Leave gun');
  }
});

test('aboard guidance marks a physical gate and gliding guidance marks reachable ground', () => {
  const { state, player } = fixture(); aboard(state, player);
  Object.assign(player, { gunId: null, deckX: 0, deckZ: 0 });
  const ship = shipAt(state.elapsed);
  const marker = nearestObjective(state, player);
  const forward = SHIP_JUMP_POINTS.reduce((best, gate) => (gate.z < best.z ? gate : best));
  assert.equal(marker.kind, 'jump-gate');
  assert.equal(marker.id, forward.id, 'the opening spawn is marked to the gate its view already faces');
  assert.equal(marker.x, ship.x + forward.x);
  assert.equal(marker.z, ship.z + forward.z);
  assert.ok(marker.y > ship.y, 'the marker rides the deck rather than the island terrain');
  // Every spawn slot starts pointed at the forward gate, never turned around.
  for (let slot = 0; slot < 5; slot++) {
    Object.assign(player, { deckX: ((slot % 3) - 1) * 2, deckZ: Math.floor(slot / 3) * 2 });
    assert.equal(nearestObjective(state, player).id, forward.id, `spawn slot ${slot}`);
  }
  // Standing at, or walking up to, another gate follows that one instead.
  for (const gate of SHIP_JUMP_POINTS) {
    Object.assign(player, { deckX: gate.x, deckZ: gate.z });
    assert.equal(nearestObjective(state, player).id, gate.id);
  }
  const rail = SHIP_JUMP_POINTS.find((gate) => gate.id !== forward.id);
  Object.assign(player, { deckX: rail.x - 2, deckZ: rail.z - 2 });
  assert.equal(nearestObjective(state, player).id, rail.id, 'approaching the rail gate follows it');
  Object.assign(player, { deckX: gunOperator(SHIP_GUNS[3]).x, deckZ: gunOperator(SHIP_GUNS[3]).z });
  assert.equal(nearestObjective(state, player).id, rail.id, 'the starboard aft gunner is sent to the gate at hand');
  Object.assign(player, { deckX: 0, deckZ: -6 });
  assert.equal(nearestObjective(state, player).id, forward.id, 'walking forward marks the bow gate');
  // An opening bow departure still points at the friendly landing beach.
  const opening = jumpLaunchPose(SHIP_JUMP_POINTS[0], shipAt(0));
  const early = glideLanding({ ...state, phase: 'voyage' }, { ...opening, mode: 'gliding' });
  assert.equal(early.x, SPAWN.x); assert.equal(early.z, SPAWN.z);
  // A late departure from the parked ship is pointed at ground it can reach.
  const late = jumpLaunchPose(SHIP_JUMP_POINTS[0], shipAt(SHIP_DURATION + 90));
  const landing = glideLanding({ ...state, phase: 'voyage' }, { ...late, mode: 'gliding' });
  assert.ok(Math.hypot(landing.x - late.x, landing.z - late.z) < Math.hypot(SPAWN.x - late.x, SPAWN.z - late.z));
  assert.ok(Math.hypot(landing.x - late.x, landing.z - late.z) <= 12 + (late.y - heightAt(late.x, late.z)) * 1.25);
  // The finale sends returning crew to the open landing beside the haven lift
  // from BOTH gates: a straight line from the bow launch to the beacon itself
  // runs into the lighthouse tower, and this approach clears it.
  const lift = AIRSHIP_RETURNS.find((entry) => entry.id === 'airship-return-haven');
  for (const gate of SHIP_JUMP_POINTS) {
    const pose = jumpLaunchPose(gate, shipAt(SHIP_DURATION + 90));
    const finale = glideLanding({ ...state, phase: 'finale' }, { ...pose, mode: 'gliding' });
    assert.equal(finale.x, lift.x); assert.equal(finale.z, lift.z);
    assert.match(finale.name, /Lighthouse/);
    assert.notEqual(finale.z, BEACON.z, `${gate.id} is not aimed through the tower`);
  }
});

test('flying target reticle intersects exact authoritative sphere centers and nearest surfaces', () => {
  const { state } = fixture(), gun = SHIP_GUNS[0];
  const { from, direction } = gunMuzzle(gun, shipAt(state.elapsed), gun.yaw, .1);
  const targetAt = (id, distance, radius = 2) => ({ id, type: 'flying-crab', hp: 80, maxHp: 80, radius,
    x: from.x + direction.x * distance, y: from.y + direction.y * distance, z: from.z + direction.z * distance });
  const crab = targetAt('near', 10);
  state.flyingTargets = [targetAt('far', 25), crab];
  assert.equal(flyingTargetAtRay(state, from, direction)?.id, crab.id);
  state.flyingTargets = [{ ...crab, y: crab.y - 3 }];
  assert.equal(flyingTargetAtRay(state, from, direction), null, 'no ground-enemy radius-height offset');
  state.flyingTargets = [{ ...crab, hp: 0 }, targetAt('out-of-range', GUN_RANGE + 3)];
  assert.equal(flyingTargetAtRay(state, from, direction), null);
  state.flyingTargets = [targetAt('smaller', 10, 1), targetAt('larger', 11, 3)];
  assert.equal(flyingTargetAtRay(state, from, direction)?.id, 'larger', 'surface distance determines the first hit');
});

test('remote mount, leave and return transitions snap even when deck displacement is tiny', () => {
  const buffer = createRemoteInterpolation(), gun = SHIP_GUNS[0], operator = gunOperator(gun), ship = shipAt(40);
  const { state, player } = fixture(); aboard(state, player, gun);
  const push = (at, pose) => buffer.push([pose], { receivedAt: at, snapshotTime: 40 + at / 1000, round: 1, phase: 'voyage' });
  push(0, { ...player, deckX: operator.x + .1 });
  let generation = buffer.sample(player.id, 0, ship).generation;
  for (const [at, changes] of [[50, { gunId: gun.id, shipReturned: true }], [100, { gunId: null }],
    [150, { shipReturned: false }], [200, { shipReturned: true }]]) {
    const previous = { ...player }; Object.assign(player, changes);
    push(at, player);
    const sample = buffer.sample(player.id, at, ship);
    assert.notEqual(sample.generation, generation); assert.equal(buffer.count(player.id), 1);
    assert.equal(sample.player.deckX, operator.x); assert.equal(sample.player.deckZ, operator.z);
    assert.equal(displayedSpeed(previous, sample.player, .05), 0);
    generation = sample.generation;
  }
});
