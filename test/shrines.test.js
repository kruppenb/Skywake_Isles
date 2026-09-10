import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { SHRINES, SPAWN, OBSTACLES, SHIP_DURATION, heightAt, shipAt } from '../shared/world.js';
import { SHIP_GUNS, gunOperator } from '../shared/airship.js';
import { canReturnAtShrine, SHRINE_RETURN_RANGE } from '../shared/shrines.js';
import { findInteractable } from '../client/ui.js';

function setup(count = 1) {
  const events = [], game = new Game({ onEvent: event => events.push(event) });
  const crew = Array.from({ length: count }, (_, i) => game.addPlayer(`p${i}`, `Pirate ${i}`));
  game.action(crew[0].id, 'launch'); game.enemies.clear();
  return { game, p: crew[0], crew, events };
}
function ground(p, point) {
  Object.assign(p, { x: point.x, y: heightAt(point.x, point.z), z: point.z, mode: 'ground', grounded: true, vy: 0,
    hp: 100, online: true, knockedUntil: 0, gunId: null });
}
function capture(game, p, point) {
  ground(p, point);
  assert.equal(game.action(p.id, 'interact', point.id).ok, true);
  for (const enemy of [...game.enemies.values()].filter(e => e._shrine === point.id)) game.damageEnemy(enemy, enemy.hp, p.id);
}

test('last defender captures immediately outside the old circle; unrelated enemies do not count', () => {
  const { game, p, crew: [, ally], events } = setup(2), point = SHRINES[0];
  ground(p, point); ground(ally, { x: point.x, z: point.z + 2 }); ally.hp = 35;
  game.action(p.id, 'interact', point.id);
  const guards = [...game.enemies.values()], shrine = game.shrines[0];
  assert.equal(guards.length, 5);
  game.spawnEnemy('crab', point.x + 5, point.z + 5, point.region);
  ground(p, { x: point.x, z: point.z + 18 }); p.hp = 40;
  for (const guard of guards.slice(0, -1)) game.damageEnemy(guard, guard.hp, p.id);
  assert.equal(shrine.status, 'active'); assert.equal(shrine.remaining, 1); assert.equal(shrine.charge, 0);
  // Nobody needs to stay in the circle, including the last standing pirate.
  ally.knockedUntil = 20; ally.hp = 0;
  const pearls = game.pearls, elapsed = game.elapsed;
  game.damageEnemy(guards.at(-1), guards.at(-1).hp, p.id);
  assert.equal(game.elapsed, elapsed);
  assert.deepEqual(shrine, { id: point.id, status: 'cleared', charge: 1, remaining: 0 });
  assert.equal(game.shards, 1); assert.ok(game.pearls >= pearls + 25);
  assert.deepEqual(game.checkpoint, { x: point.x, z: point.z });
  assert.equal(p.hp, 40); assert.equal(ally.hp, 0);
  const reward = game.pearls;
  game.damageEnemy(guards.at(-1), 100, p.id); game.tick(); game.settleShrine(shrine);
  assert.equal(game.pearls, reward); assert.equal(game.shards, 1);
  assert.equal(events.filter(e => e.kind === 'shrine' && e.status === 'cleared').length, 1);
  assert.equal(game.shrines[1].status, 'dormant');
});

test('capture still heals nearby living crew, and tick settles cleared defenders without a hold timer', () => {
  const { game, p } = setup(), point = SHRINES[0];
  ground(p, point); game.action(p.id, 'interact', point.id); p.hp = 24;
  for (const guard of [...game.enemies.values()]) game.damageEnemy(guard, guard.hp, p.id);
  assert.equal(p.hp, p.maxHp);
  const other = SHRINES[1]; ground(p, other); game.action(p.id, 'interact', other.id);
  game.enemies.clear(); ground(p, SPAWN); game.tick();
  assert.equal(game.shrines[1].status, 'cleared'); assert.equal(game.shards, 2);
});

test('all captured shrines offer E return during voyage and finale, including implicit interaction', () => {
  const { game, p, events } = setup();
  for (const point of SHRINES) capture(game, p, point);
  for (const phase of ['voyage', 'finale']) for (const point of SHRINES) {
    game.phase = phase; ground(p, { x: point.x, z: point.z + 3.5 });
    const prompt = findInteractable(game.snapshot(), p);
    assert.equal(prompt?.id, point.id); assert.equal(prompt.kind, 'airship-return');
    assert.equal(prompt.label, 'Return to boat'); assert.equal(prompt.color, '#a5f5f0');
    assert.equal(game.action(p.id, 'interact', phase === 'voyage' ? point.id : undefined).ok, true);
    assert.equal(p.mode, 'aboard'); assert.equal(p.shipReturned, true);
    assert.equal(events.at(-1).kind, 'airship-return'); assert.equal(events.at(-1).id, point.id);
  }
});

test('return prompt, highlight eligibility and authority agree on full 3D range and player state', () => {
  const { game, p } = setup(), point = SHRINES[0]; capture(game, p, point);
  const baseY = heightAt(point.x, point.z);
  for (const invalid of [
    { x: point.x + SHRINE_RETURN_RANGE + .01 }, { y: baseY + SHRINE_RETURN_RANGE + .01 },
    { x: point.x + 3, y: baseY + 3 }, { grounded: false }, { mode: 'gliding' },
    { knockedUntil: 10 }, { hp: 0 }, { online: false },
  ]) {
    ground(p, point); Object.assign(p, invalid);
    assert.equal(canReturnAtShrine(game, p, point), false, JSON.stringify(invalid));
    assert.notEqual(findInteractable(game.snapshot(), p)?.kind, 'airship-return', JSON.stringify(invalid));
    assert.equal(game.action(p.id, 'interact', point.id).ok, false, JSON.stringify(invalid));
    assert.notEqual(p.mode, 'aboard');
  }
  for (const phase of ['lobby', 'victory']) {
    ground(p, point); game.phase = phase;
    assert.equal(canReturnAtShrine(game, p, point), false);
    assert.equal(findInteractable(game.snapshot(), p), null);
    assert.equal(game.action(p.id, 'interact', point.id).ok, false);
  }
  game.phase = 'voyage'; ground(p, point); p.x += SHRINE_RETURN_RANGE;
  assert.equal(canReturnAtShrine(game, p, point), true);
  assert.equal(game.action(p.id, 'interact', point.id).ok, true);
});

test('a blocked approach cannot light the return cue or teleport through scenery', () => {
  const { game, p } = setup(), point = SHRINES[0]; capture(game, p, point);
  const rock = OBSTACLES.find(o => !o.buildingId), original = { ...rock };
  try {
    Object.assign(rock, { x: point.x, z: point.z + 1.5, radius: .65, height: 5 });
    ground(p, { x: point.x, z: point.z + 3 });
    assert.equal(canReturnAtShrine(game, p, point), false);
    assert.equal(findInteractable(game.snapshot(), p), null);
    assert.equal(game.action(p.id, 'interact', point.id).ok, false);
  } finally { Object.assign(rock, original); }
});

test('uncaptured and active shrines never return a pirate, and reset removes return eligibility', () => {
  const { game, p } = setup(), point = SHRINES[0]; ground(p, point);
  assert.equal(canReturnAtShrine(game, p, point), false);
  assert.equal(findInteractable(game.snapshot(), p)?.kind, 'shrine');
  game.action(p.id, 'interact', point.id);
  assert.equal(findInteractable(game.snapshot(), p), null);
  assert.equal(game.action(p.id, 'interact', point.id).ok, false);
  assert.equal(p.mode, 'ground');
  for (const guard of [...game.enemies.values()]) game.damageEnemy(guard, guard.hp, p.id);
  game.resetRound(); game.phase = 'voyage'; ground(p, point);
  assert.equal(canReturnAtShrine(game, p, point), false);
  assert.equal(findInteractable(game.snapshot(), p)?.kind, 'shrine');
  assert.equal(game.action(p.id, 'interact', 'unknown-shrine').ok, false);
});

test('boat recall preserves equipment, stops old input and can lead straight to a cannon', () => {
  const { game, p } = setup(), point = SHRINES[0]; capture(game, p, point);
  game.elapsed = SHIP_DURATION + 10;
  p.hp = 37; p.ammo = 3; p.inventory.flintlock.ammo = 3;
  p.collectedDropIds.push('already-collected'); p._burst = { remaining: 2 }; p.jumpHeld = true;
  game.setInput(p.id, { seq: 0, forward: 1, right: 1, yaw: 1, pitch: .3, jump: true, sprint: true });
  const inventory = structuredClone(p.inventory), pearls = game.pearls;
  assert.equal(game.action(p.id, 'interact', point.id).ok, true);
  assert.deepEqual([p.deckX, p.deckZ, p.hp, p.ammo, p.gunId, p._burst, p.jumpHeld], [0, 0, 37, 3, null, null, false]);
  assert.deepEqual(p.inventory, inventory); assert.deepEqual(p.collectedDropIds, ['already-collected']);
  assert.equal(game.pearls, pearls); assert.equal(game.shards, 1);
  assert.equal(p._input.forward, 0); assert.equal(p._input.right, 0); assert.equal(p._input.jump, false);
  game.tick(); assert.equal(p.mode, 'aboard'); assert.equal(p.y, shipAt(game.elapsed).y);
  const gun = SHIP_GUNS[0], operator = gunOperator(gun), ship = shipAt(game.elapsed);
  Object.assign(p, { deckX: operator.x, deckZ: operator.z, x: ship.x + operator.x, z: ship.z + operator.z });
  assert.equal(game.action(p.id, 'interact', gun.id).ok, true); assert.equal(p.gunId, gun.id);
});

test('revive keeps priority at captured shrines and recall works after reconnect', () => {
  const { game, p, crew: [, ally] } = setup(2), point = SHRINES[0]; capture(game, p, point);
  ground(ally, point); ally.hp = 0; ally.knockedUntil = 20;
  assert.equal(findInteractable(game.snapshot(), p)?.kind, 'revive');
  assert.equal(game.action(p.id, 'interact').ok, true);
  assert.equal(ally.knockedUntil, 0); assert.equal(p.mode, 'ground');
  game.disconnect(p.id); game.reconnect(p.id);
  assert.equal(findInteractable(game.snapshot(), p)?.kind, 'airship-return');
  assert.equal(game.action(p.id, 'interact').ok, true); assert.equal(p.mode, 'aboard');
});
