import test from 'node:test';
import assert from 'node:assert/strict';
import { isLootVisible } from '../client/loot-visibility.js';

const drop = { id: 'drop-1', weapon: 'repeater', rarity: 'rare' };

test('only the viewing pirate hides a collected drop', () => {
  const collector = { id: 'collector', collectedDropIds: [drop.id] };
  const crewmate = { id: 'crewmate', collectedDropIds: [] };
  assert.equal(isLootVisible(drop, collector), false);
  assert.equal(isLootVisible(drop, crewmate), true);
  assert.equal(isLootVisible(drop, { id: 'late', collectedDropIds: [] }), true);
  assert.deepEqual(drop, { id: 'drop-1', weapon: 'repeater', rarity: 'rare' });
  assert.deepEqual(crewmate.collectedDropIds, []);
});

test('inventory rarity does not hide uncollected copies of the same weapon', () => {
  const player = { collectedDropIds: [drop.id], inventory: { repeater: { rarity: 'legendary', ammo: 8 } } };
  assert.equal(isLootVisible(drop, player), false);
  assert.equal(isLootVisible({ ...drop, id: 'drop-2' }, player), true);
  assert.equal(isLootVisible({ ...drop, id: 'drop-3', rarity: 'common' }, player), true);
});

test('missing or malformed optional player state leaves valid drops visible', () => {
  for (const player of [undefined, null, {}, false, { collectedDropIds: null }, { collectedDropIds: drop.id },
    { collectedDropIds: { includes: () => true } }, { collectedDropIds: [null, undefined, 1, { id: drop.id }] }]) {
    assert.equal(isLootVisible(drop, player), true);
  }
  for (const invalid of [undefined, null, {}, { id: null }, { id: 1 }, { id: '' }]) {
    assert.equal(isLootVisible(invalid, { collectedDropIds: [] }), false);
  }
});

test('snapshot history hides loot without replaying events and reset reveals it', () => {
  const reconnect = JSON.parse(JSON.stringify({ collectedDropIds: [drop.id] }));
  assert.equal(isLootVisible(drop, reconnect), false);
  assert.equal(isLootVisible(drop, { collectedDropIds: [] }), true);
});
