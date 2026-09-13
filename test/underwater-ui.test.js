import test from 'node:test';
import assert from 'node:assert/strict';
import { crewLocationLabel, findInteractable, mapEntries, nearestObjective, objectiveMarkerHeight, underwaterHud } from '../client/ui.js';
import { weaponPresentation } from '../client/weapon-presentation.js';
import { createInput } from '../client/input.js';
import { DIVE_ENTRANCE, REEF_CHEST, REEF_EXIT } from '../shared/underwater.js';
import { heightAt } from '../shared/world.js';

const landPlayer = (overrides = {}) => ({ id: 'local', name: 'Local', color: '#65d7c5', online: true, hp: 100, maxHp: 100,
  mode: 'ground', realm: 'island', grounded: true, knockedUntil: 0, x: DIVE_ENTRANCE.x,
  y: heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z), z: DIVE_ENTRANCE.z, ...overrides });
const reefPlayer = (overrides = {}) => ({ ...landPlayer(), mode: 'swimming', realm: 'reef', grounded: false,
  x: REEF_EXIT.x, y: REEF_EXIT.y, z: REEF_EXIT.z, ...overrides });
const fixture = player => ({ phase: 'voyage', elapsed: 20, players: [player], enemies: [], underwater: {
  entered: true, completed: false, remaining: 3, chestOpened: false,
}, shrines: [], chests: [], pings: [], drops: [], shards: 0 });

test('C is a held dive control and blur or menu suspension sends it back to neutral', t => {
  const browserWindow = new EventTarget(), browserDocument = new EventTarget(), canvas = new EventTarget();
  browserDocument.activeElement = canvas; browserDocument.pointerLockElement = null; browserDocument.hidden = false;
  browserDocument.exitPointerLock = () => {};
  canvas.closest = () => null; canvas.focus = () => { browserDocument.activeElement = canvas; };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: browserDocument });
  const emit = (target, type, values = {}) => { const event = new Event(type, { cancelable: true }); Object.assign(event, values); target.dispatchEvent(event); return event; };
  const controls = createInput(canvas); controls.setEnabled(true); controls.setSuspended(false);
  t.after(() => {
    controls.dispose();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
  });
  assert.equal(emit(browserWindow, 'keydown', { code: 'KeyC', repeat: false }).defaultPrevented, true);
  assert.equal(controls.snapshot().dive, true);
  emit(browserWindow, 'blur'); assert.equal(controls.snapshot().dive, false);
  emit(browserWindow, 'keydown', { code: 'KeyC', repeat: false }); assert.equal(controls.snapshot().dive, true);
  controls.setSuspended(true); assert.equal(controls.snapshot().dive, false);
});

test('the shore dive and reef return prompts match their phase, health, range and realm rules', () => {
  const player = landPlayer(), state = fixture(player);
  assert.equal(findInteractable(state, player)?.kind, 'dive-entrance');
  assert.equal(findInteractable(state, player)?.label, 'Dive to Sunken Reach');
  for (const changes of [{ phase: 'finale' }, { phase: 'victory' }]) assert.notEqual(findInteractable({ ...state, ...changes }, player)?.kind, 'dive-entrance');
  for (const changes of [{ hp: 0 }, { grounded: false }, { x: player.x + DIVE_ENTRANCE.range + .1 }, { y: player.y + DIVE_ENTRANCE.range + .1 }]) {
    const changed = { ...player, ...changes }; assert.notEqual(findInteractable(fixture(changed), changed)?.kind, 'dive-entrance');
  }
  const swimmer = reefPlayer(), below = fixture(swimmer);
  for (const underwater of [below.underwater, { ...below.underwater, remaining: 0 }, { ...below.underwater, remaining: 0, chestOpened: true }]) {
    assert.equal(findInteractable({ ...below, underwater }, swimmer)?.kind, 'reef-exit', 'return stays open throughout the dive');
  }
});

test('split crew labels follow the local player across realm transitions', () => {
  const shore = landPlayer({ id: 'shore' }), below = reefPlayer({ id: 'below' });
  assert.equal(crewLocationLabel(shore, below), 'below');
  assert.equal(crewLocationLabel(below, shore), 'ashore');
  assert.equal(crewLocationLabel({ ...shore, realm: 'reef', mode: 'swimming' }, below), '');
});

test('reef revives use 3D distance, stay in realm and take priority over return', () => {
  const player = reefPlayer(), state = fixture(player);
  const friend = reefPlayer({ id: 'friend', name: 'Pearl', x: player.x + 2, knockedUntil: 25 });
  state.players.push(friend);
  assert.equal(findInteractable(state, player)?.kind, 'revive');
  friend.y += 4;
  assert.equal(findInteractable(state, player)?.kind, 'reef-exit');
  Object.assign(friend, { y: player.y, realm: 'island', mode: 'ground' });
  assert.equal(findInteractable(state, player)?.kind, 'reef-exit');
});

test('Sunken Reach guidance advances from guards to chest to the always-available exit', () => {
  const player = reefPlayer({ x: -10, y: 8, z: 12 }), state = fixture(player);
  state.enemies.push({ id: 'guard', type: 'reef-guard', realm: 'reef', hp: 30, x: -3, y: 8, z: 4 });
  assert.deepEqual(underwaterHud(state, player), { stage: 'guards', title: 'Clear the Sunken Reach', detail: '3 reef guards remaining' });
  assert.equal(nearestObjective(state, player).id, 'guard');
  Object.assign(state.underwater, { remaining: 0 });
  assert.equal(underwaterHud(state, player).stage, 'chest');
  assert.equal(nearestObjective(state, player).id, REEF_CHEST.id);
  state.underwater.chestOpened = true;
  assert.equal(underwaterHud(state, player).stage, 'return');
  assert.equal(nearestObjective(state, player).id, REEF_EXIT.id);
  assert.equal(objectiveMarkerHeight(nearestObjective(state, player)), REEF_EXIT.y);
});

test('area map entries include fixed landmarks and only markers from the local realm', () => {
  const swimmer = reefPlayer(), island = landPlayer({ id: 'island', name: 'Shore' });
  const state = fixture(swimmer); state.players.push(island);
  state.pings = [{ id: 'reef-ping', playerId: swimmer.id, x: 0, z: 0, expiresAt: 30 }, { id: 'land-ping', playerId: island.id, x: 0, z: 0, expiresAt: 30 }];
  state.drops = [{ id: 'reef-drop', realm: 'reef' }, { id: 'land-drop' }];
  const reef = mapEntries(state, swimmer);
  assert.deepEqual(reef.players.map(entry => entry.id), ['local']);
  assert.deepEqual(reef.pings.map(entry => entry.id), ['reef-ping']);
  assert.deepEqual(reef.drops.map(entry => entry.id), ['reef-drop']);
  assert.deepEqual(reef.landmarks.map(entry => entry.id), [REEF_EXIT.id, REEF_CHEST.id]);
  const shore = mapEntries(state, island);
  assert.deepEqual(shore.players.map(entry => entry.id), ['island']);
  assert.equal(shore.landmarks[0].id, DIVE_ENTRANCE.id);
});

test('all carried weapons, reload feedback and Longshot scope remain active while swimming', () => {
  const player = reefPlayer({ weapon: 'longshot', rarity: 'common', reloadUntil: 0 });
  const state = fixture(player), controls = { connected: true, controlsActive: true, aiming: true };
  assert.equal(weaponPresentation(state, player, controls).scoped, true);
  player.weapon = 'scatter'; player.reloadUntil = state.elapsed + .5;
  const reload = weaponPresentation(state, player, controls);
  assert.equal(reload.active, true); assert.equal(reload.reloading, true); assert.ok(reload.reloadProgress >= 0);
});
