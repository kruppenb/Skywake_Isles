import test from 'node:test';
import assert from 'node:assert/strict';
import { findInteractable, nearestObjective, sideEventForHUD } from '../client/ui.js';
import { SIDE_EVENTS } from '../shared/side-events.js';
import { BEACON, CHESTS, SHRINES, heightAt } from '../shared/world.js';

function fixture(point = SIDE_EVENTS[0]) {
  const player = { id: 'local', name: 'Captain', ...point, y: heightAt(point.x, point.z),
    mode: 'ground', hp: 100, online: true, grounded: true, knockedUntil: 0 };
  const state = { phase: 'voyage', elapsed: 50, players: [player], shards: 0, enemies: [], drops: [],
    chests: CHESTS.map((chest) => ({ id: chest.id, opened: true })),
    shrines: SHRINES.map((shrine) => ({ id: shrine.id, status: 'dormant' })),
    sideEvents: SIDE_EVENTS.map((event) => ({ id: event.id, status: 'available', wave: 0, remaining: 0,
      integrity: 100, maxIntegrity: 100, startedAt: 0, endsAt: 0, finishedAt: 0 })) };
  return { state, player };
}

test('each optional defense offers a reachable supplies interaction, without replacing the compass quest', () => {
  for (const definition of SIDE_EVENTS) {
    const { state, player } = fixture(definition);
    const mainObjective = nearestObjective(state, player);
    const prompt = findInteractable(state, player);
    assert.equal(prompt?.id, definition.id);
    assert.equal(prompt.kind, 'side-event');
    assert.match(prompt.label, /optional/);
    assert.equal(sideEventForHUD(state, player)?.id, definition.id);
    assert.ok(SHRINES.some((shrine) => shrine.id === mainObjective.id));
    state.sideEvents.find((event) => event.id === definition.id).status = 'active';
    assert.deepEqual(nearestObjective(state, player), mainObjective);
    state.shards = 3;
    assert.equal(nearestObjective(state, player).id, BEACON.id);
  }
});

test('defense prompts reject unavailable, distant, airborne, downed, dead, and offline players', () => {
  for (const change of [
    ({ state }) => { state.phase = 'lobby'; },
    ({ state }) => { state.phase = 'finale'; },
    ({ state }) => { state.sideEvents[0].status = 'completed'; },
    ({ state }) => { state.sideEvents[1].status = 'active'; },
    ({ player }) => { player.x += 4.1; },
    ({ player }) => { player.y += 3; },
    ({ player }) => { player.mode = 'gliding'; },
    ({ player }) => { player.grounded = false; },
    ({ player }) => { player.knockedUntil = 60; },
    ({ player }) => { player.hp = 0; },
    ({ player }) => { player.online = false; },
  ]) {
    const scenario = fixture(); change(scenario);
    assert.notEqual(findInteractable(scenario.state, scenario.player)?.kind, 'side-event');
  }
});

test('reviving a crewmate keeps priority and nearby loot keeps normal nearest ordering', () => {
  const { state, player } = fixture();
  player.x += 2; player.y = heightAt(player.x, player.z);
  const friend = { ...player, id: 'friend', knockedUntil: 60 };
  state.players.push(friend);
  assert.equal(findInteractable(state, player)?.kind, 'revive');
  friend.knockedUntil = 0;
  state.drops.push({ id: 'loot', weapon: 'longshot', rarity: 'rare', x: player.x, z: player.z });
  assert.equal(findInteractable(state, player)?.id, 'loot');
  state.drops[0].x += 3;
  assert.equal(findInteractable(state, player)?.kind, 'side-event');
});

test('optional HUD is nearby for available defenses and crew-wide for an active defense', () => {
  const { state, player } = fixture();
  player.x += 32;
  assert.equal(sideEventForHUD(state, player)?.id, SIDE_EVENTS[0].id);
  player.x += .1;
  assert.equal(sideEventForHUD(state, player), null);
  Object.assign(state.sideEvents[1], { status: 'active', wave: 2, remaining: 4, integrity: 64, endsAt: 170 });
  const event = sideEventForHUD(state, player);
  assert.equal(event.id, SIDE_EVENTS[1].id);
  assert.equal(event.wave, 2); assert.equal(event.remaining, 4); assert.equal(event.integrityPercent, 64);
  assert.equal(event.secondsLeft, 120);
  assert.ok(event.distance > 32);
  event.integrity = 0;
  assert.equal(state.sideEvents[1].integrity, 64, 'HUD model does not mutate authoritative state');
  state.elapsed = 175;
  assert.equal(sideEventForHUD(state, player).secondsLeft, 0, 'countdown never goes negative while awaiting a snapshot');
});

test('recent outcomes last eight seconds locally and hidden game modes suppress optional HUD', () => {
  const { state, player } = fixture();
  for (const status of ['completed', 'failed']) {
    Object.assign(state.sideEvents[0], { status, finishedAt: 45 });
    assert.equal(sideEventForHUD(state, player)?.status, status);
    state.elapsed = 53;
    assert.equal(sideEventForHUD(state, player), null);
    state.elapsed = 50;
    player.x += 33;
    assert.equal(sideEventForHUD(state, player), null);
    player.x -= 33;
  }
  for (const phase of ['lobby', 'finale', 'victory']) assert.equal(sideEventForHUD({ ...state, phase }, player), null);
  for (const mode of ['aboard', 'gliding']) assert.equal(sideEventForHUD(state, { ...player, mode }), null);
  assert.equal(sideEventForHUD(state, player, { paused: true }), null);
  assert.equal(sideEventForHUD(state, player, { mapOpen: true }), null);
});

test('old snapshots and unrecognized event IDs preserve existing objective and interaction behavior', () => {
  const { state, player } = fixture();
  const mainObjective = nearestObjective(state, player);
  delete state.sideEvents;
  assert.equal(sideEventForHUD(state, player), null);
  assert.equal(findInteractable(state, player), null);
  assert.deepEqual(nearestObjective(state, player), mainObjective);
  state.sideEvents = [{ id: 'unknown-event', status: 'available' }];
  assert.equal(sideEventForHUD(state, player), null);
  assert.equal(findInteractable(state, player), null);
});
