import test from 'node:test';
import assert from 'node:assert/strict';
import { airshipBanner, cannonPresentation, findInteractable, flyingTargetAtRay, nearestObjective } from '../client/ui.js';
import { AIRSHIP_RETURNS, RETURN_RANGE, SHIP_GUNS, GUN_COOLDOWN, GUN_RANGE, gunMuzzle, gunOperator } from '../shared/airship.js';
import { SHIP_DURATION, SHRINES, heightAt, shipAt } from '../shared/world.js';
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

test('ship banner shows opening countdown only until a player opts into staying aboard', () => {
  const { state, player } = fixture(); aboard(state, player); state.elapsed = SHIP_DURATION - 4;
  assert.match(airshipBanner(state, player).text, /^4s until/);
  player.gunId = SHIP_GUNS[0].id; player.shipReturned = true;
  assert.equal(airshipBanner(state, player).button, 'Leave gun');
  assert.match(airshipBanner(state, player).text, /Hold click fire/);
  player.gunId = null; state.elapsed = SHIP_DURATION + 60;
  assert.doesNotMatch(airshipBanner(state, player).text, /until|0s/);
  assert.match(airshipBanner(state, player).text, /E man/);
  assert.equal(airshipBanner(state, { ...player, mode: 'ground' }), null);
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
