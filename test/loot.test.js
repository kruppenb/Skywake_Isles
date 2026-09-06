import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { COLORS, CHESTS, heightAt, seededRandom } from '../shared/world.js';
import { BUILDINGS, buildingWorldPoint, buildingLocalPoint } from '../shared/exploration.js';
import { WEAPONS, WEAPON_ORDER, RARITIES, rollWeapon, weaponStats } from '../shared/weapons.js';

function locate(p, point) { Object.assign(p, { x: point.x, z: point.z, y: heightAt(point.x, point.z), mode: 'ground', grounded: true, vy: 0 }); }
function ticks(game, seconds) { for (let i = 0; i < Math.ceil(seconds / 0.05); i++) game.tick(0.05); }
function setup(random = () => 0.99, count = 1) {
  const events = [], game = new Game({ random, onEvent: event => events.push({ ...event, at: game.elapsed }) });
  for (let i = 0; i < count; i++) game.addPlayer(`p${i}`, `Pirate ${i}`, COLORS[i]);
  game.action('p0', 'launch'); game.enemies.clear();
  const p = game.players.get('p0'); locate(p, { x: 0, z: 50 });
  return { game, p, events };
}
function grant(game, p, weapon, rarity = 'common', ammo = WEAPONS[weapon].ammo) {
  p.inventory[weapon] = { rarity, ammo };
  game.equip(p, weapon); game.elapsed += 1;
}
function aim(p, enemy) {
  p.yaw = Math.atan2(-(enemy.x - p.x), -(enemy.z - p.z));
  p.pitch = Math.atan2(enemy.y + enemy.radius * .8 - p.y - 1.25, Math.hypot(enemy.x - p.x, enemy.z - p.z));
}

test('five distinct weapons and weighted rarity rolls cover every tier and gun', () => {
  assert.equal(WEAPON_ORDER.length, 5);
  assert.equal(new Set(WEAPON_ORDER.map(id => WEAPONS[id].name)).size, 5);
  assert.equal(new Set(WEAPON_ORDER.map(id => WEAPONS[id].cooldown)).size, 5);
  const boundaries = [0, .45, .73, .89, .97], rarities = Object.keys(RARITIES);
  for (let i = 0; i < 5; i++) {
    const rolls = [i / 5 + .01, boundaries[i] + .000001];
    assert.deepEqual(rollWeapon(() => rolls.shift()), { weapon: WEAPON_ORDER[i], rarity: rarities[i] });
    assert.equal(weaponStats(WEAPON_ORDER[i], 'legendary').damage, WEAPONS[WEAPON_ORDER[i]].damage * 1.6);
  }
  assert.equal(weaponStats('__proto__', 'constructor').id, 'flintlock');
  const random = seededRandom(8811), counts = Object.fromEntries(rarities.map(id => [id, 0])), guns = new Set();
  for (let i = 0; i < 20000; i++) { const item = rollWeapon(random); counts[item.rarity]++; guns.add(item.weapon); }
  assert.equal(guns.size, 5);
  for (const rarity of Object.values(RARITIES)) assert.ok(Math.abs(counts[rarity.id] / 200 - rarity.weight) < 1.2, `${rarity.id} weight`);
});

test('a chest rolls once, shares pearls/healing and has one authoritative claimant', () => {
  let rolls = 0;
  const { game, p, events } = setup(() => { rolls++; return .99; }, 2), ally = game.players.get('p1');
  locate(p, CHESTS[0]); locate(ally, CHESTS[0]); p.hp = ally.hp = 40;
  assert.equal(game.action(p.id, 'interact', CHESTS[0].id).ok, true);
  assert.equal(rolls, 2); assert.equal(game.drops.length, 1); assert.equal(game.pearls, 12);
  assert.equal(p.hp, 62); assert.equal(ally.hp, 62);
  const drop = { ...game.drops[0] };
  assert.equal(drop.weapon, 'longshot'); assert.equal(drop.rarity, 'legendary');
  assert.equal(events.find(e => e.kind === 'chest').dropId, drop.id);
  assert.equal(game.action(ally.id, 'interact', CHESTS[0].id).ok, false);
  assert.equal(rolls, 2); assert.equal(game.drops.length, 1); assert.equal(game.pearls, 12);
  assert.equal(game.action(p.id, 'interact', drop.id).ok, true);
  assert.equal(p.weapon, 'longshot'); assert.equal(p.rarity, 'legendary'); assert.equal(p.ammo, 4);
  assert.equal(game.drops.length, 0);
  assert.equal(game.action(ally.id, 'interact', drop.id).code, 'TOO_FAR');
  assert.equal(ally.inventory.longshot, undefined);
  assert.equal(events.filter(e => e.kind === 'loot').length, 1);
  assert.equal(events.find(e => e.kind === 'loot').playerId, p.id);
});

test('far, malformed, invented and through-wall drop/chest claims cannot grant weapons', () => {
  const { game, p } = setup(); locate(p, CHESTS[0]); game.action(p.id, 'interact', CHESTS[0].id);
  const drop = game.drops[0]; locate(p, { x: drop.x + 4, z: drop.z });
  assert.equal(game.action(p.id, 'interact', drop.id).code, 'TOO_FAR');
  for (const target of ['drop-fake', '__proto__', 'constructor', 'toString']) assert.equal(game.action(p.id, 'interact', target).ok, false);
  for (const target of [{ id: drop.id }, ['longshot'], 'x'.repeat(81)]) assert.equal(game.action(p.id, 'interact', target).code, 'BAD_TARGET');
  const building = BUILDINGS.find(b => b.kind === 'cottage' && b.enterable), chest = CHESTS.find(c => c.buildingId === building.id);
  locate(p, buildingWorldPoint(building, building.width / 2 + .7, -.45));
  assert.ok(Math.hypot(chest.x - p.x, chest.z - p.z) < 3.5, 'wall test is within ordinary interaction distance');
  assert.equal(game.action(p.id, 'interact', chest.id).code, 'TOO_FAR');
  assert.equal(game.chests.find(c => c.id === chest.id).opened, false);
  locate(p, buildingWorldPoint(building, 0, .7));
  assert.equal(game.action(p.id, 'interact', chest.id).ok, true);
  const indoors = game.drops.find(d => d.id.endsWith(chest.id));
  locate(p, buildingWorldPoint(building, building.width / 2 + .7, -.45));
  assert.equal(game.action(p.id, 'interact', indoors.id).code, 'TOO_FAR');
  assert.equal(p.inventory.longshot, undefined);
  locate(p, buildingWorldPoint(building, 0, building.depth / 2 + .65));
  assert.equal(game.action(p.id, 'interact', indoors.id).ok, true, 'open door permits reachable loot');
});

test('duplicate and lower-rarity guns stay for crew; upgrades preserve magazines and cooldown', () => {
  const { game, p } = setup(); p.ammo = 2;
  const place = (rarity, id) => game.drops.push({ id, weapon: 'flintlock', rarity, x: p.x, y: p.y, z: p.z });
  place('common', 'same');
  assert.equal(game.action(p.id, 'interact', 'same').code, 'DUPLICATE_WEAPON');
  assert.equal(game.drops.length, 1); assert.equal(p.ammo, 2);
  p._fireAt = game.elapsed + 4;
  place('epic', 'upgrade'); assert.equal(game.action(p.id, 'interact', 'upgrade').ok, true);
  assert.equal(p.rarity, 'epic'); assert.equal(p.inventory.flintlock.rarity, 'epic');
  assert.equal(p.ammo, 2); assert.equal(p.inventory.flintlock.ammo, 2);
  assert.equal(p._fireAt, game.elapsed + 4);
  assert.equal(game.action(p.id, 'fire').ok, true); assert.equal(p.ammo, 2);
  place('rare', 'lower'); assert.equal(game.action(p.id, 'interact', 'lower').code, 'DUPLICATE_WEAPON');
  assert.deepEqual(game.drops.map(d => d.id), ['same', 'lower']);
});

test('empty/prototype slots cannot equip and swapping cannot refill either magazine', () => {
  const { game, p } = setup();
  for (const weapon of ['repeater', 'burst', 'longshot']) assert.equal(game.action(p.id, 'swap', weapon).code, 'NOT_OWNED');
  for (const weapon of ['__proto__', 'constructor', 'toString', 'unknown']) assert.equal(game.action(p.id, 'swap', weapon).code, 'BAD_TARGET');
  game.action(p.id, 'fire'); assert.equal(p.ammo, 7); assert.equal(p.inventory.flintlock.ammo, 7);
  game.elapsed += 1; game.action(p.id, 'swap', 'scatter'); game.elapsed += 1;
  game.action(p.id, 'fire'); assert.equal(p.ammo, 4);
  game.elapsed += 1; game.action(p.id, 'swap', 'flintlock'); assert.equal(p.ammo, 7);
  game.action(p.id, 'reload'); assert.ok(p.reloadUntil);
  game.elapsed += 1; game.action(p.id, 'swap', 'scatter'); assert.equal(p.ammo, 4); assert.equal(p.reloadUntil, 0);
  ticks(game, 1); game.action(p.id, 'swap', 'flintlock'); assert.equal(p.ammo, 7);
  game.action(p.id, 'reload'); ticks(game, 1.25); assert.equal(p.ammo, 8); assert.equal(p.inventory.flintlock.ammo, 8);
});

test('all guns cause their distinct effective damage, pellet count and cadence', () => {
  for (const weapon of WEAPON_ORDER) {
    const { game, p, events } = setup(); grant(game, p, weapon, 'rare');
    const enemy = game.spawnEnemy('tempest', 0, 42, 'haven'); aim(p, enemy);
    const stats = weaponStats(weapon, 'rare'), rounds = stats.burst ?? 1;
    game.action(p.id, 'fire');
    assert.equal(p.ammo, stats.ammo - 1, `${weapon} consumes one first round`);
    const fireAt = p._fireAt; game.action(p.id, 'fire'); assert.equal(p._fireAt, fireAt);
    if (stats.burst) ticks(game, .2);
    assert.equal(events.filter(e => e.kind === 'shot').length, rounds * (stats.pellets ?? 1), weapon);
    assert.ok(Math.abs(enemy.maxHp - enemy.hp - stats.damage * rounds * (stats.pellets ?? 1)) < 1e-8, `${weapon} damage`);
    assert.equal(p.ammo, stats.ammo - rounds);
  }
  const { game, p } = setup(), far = game.spawnEnemy('crab', 0, -10, 'haven'); aim(p, far);
  game.action(p.id, 'fire'); assert.equal(far.hp, far.maxHp, 'flintlock cannot reach 60m');
  grant(game, p, 'longshot'); game.action(p.id, 'fire'); assert.equal(game.enemies.has(far.id), false, 'longshot reaches 60m');
});

test('burst shots are staggered, keep trigger aim, and cannot overdraw a partial magazine', () => {
  const { game, p, events } = setup(); grant(game, p, 'burst'); p.yaw = 0; p.pitch = 0;
  game.action(p.id, 'fire'); assert.equal(events.filter(e => e.kind === 'shot').length, 1);
  p.yaw = Math.PI / 2; p.pitch = .5;
  ticks(game, .05); assert.equal(events.filter(e => e.kind === 'shot').length, 1);
  ticks(game, .05); assert.equal(events.filter(e => e.kind === 'shot').length, 2);
  ticks(game, .1); const shots = events.filter(e => e.kind === 'shot'); assert.equal(shots.length, 3);
  assert.ok(shots[1].at > shots[0].at && shots[2].at > shots[1].at);
  for (const shot of shots) { assert.equal(shot.to.x, shot.from.x); assert.equal(shot.to.y, shot.from.y); assert.equal(shot.to.z, shot.from.z - 48); }
  assert.equal(p.ammo, 15); assert.equal(p._burst, null);
  ticks(game, .4); p.ammo = 2; p.inventory.burst.ammo = 2; game.action(p.id, 'fire'); ticks(game, .2);
  assert.equal(p.ammo, 0); assert.equal(p.inventory.burst.ammo, 0); assert.equal(p._burst, null); assert.ok(p.reloadUntil);
  assert.equal(events.filter(e => e.kind === 'shot').length, 5);
});

test('swap, reload, downing, disconnect, victory and reset cancel pending burst shots', () => {
  const cancels = [
    (game, p) => game.action(p.id, 'swap', 'flintlock'),
    (game, p) => game.action(p.id, 'reload'),
    (game, p) => game.damagePlayer(p, 100, 'test'),
    (game, p) => game.disconnect(p.id),
    game => game.win(),
    game => game.resetRound(),
  ];
  for (const cancel of cancels) {
    const { game, p, events } = setup(); grant(game, p, 'burst'); game.action(p.id, 'fire');
    assert.ok(p._burst); cancel(game, p); assert.equal(p._burst, null);
    ticks(game, .4); assert.equal(events.filter(e => e.kind === 'shot').length, 1);
  }
});

test('snapshots deeply isolate loadouts/drops, reconnect retains loot and a new round clears it', () => {
  const { game, p } = setup(); locate(p, CHESTS[0]); game.action(p.id, 'interact', CHESTS[0].id);
  game.drops[0]._secret = 'private'; p.inventory.flintlock._secret = 'private';
  let snapshot = game.snapshot(), publicPlayer = snapshot.players[0];
  assert.equal('_secret' in snapshot.drops[0], false); assert.equal('_secret' in publicPlayer.inventory.flintlock, false);
  assert.ok(!Object.keys(publicPlayer).some(key => key.startsWith('_')));
  snapshot.drops[0].rarity = 'common'; publicPlayer.inventory.flintlock.ammo = -100;
  assert.equal(game.drops[0].rarity, 'legendary'); assert.equal(p.inventory.flintlock.ammo, 8);
  game.action(p.id, 'interact', game.drops[0].id); game.disconnect(p.id); game.reconnect(p.id);
  assert.equal(p.rarity, 'legendary'); assert.equal(p.inventory.longshot.ammo, 4);
  const late = game.addPlayer('late', 'Navigator', COLORS[1]); assert.equal(late.mode, 'gliding');
  assert.deepEqual(Object.keys(late.inventory), ['flintlock', 'scatter']); assert.equal(game.drops.length, 0);
  game.resetRound(); snapshot = game.snapshot(); assert.deepEqual(snapshot.drops, []);
  assert.equal(p.rarity, 'common'); assert.deepEqual(Object.keys(p.inventory), ['flintlock', 'scatter']);
  assert.equal(p.inventory.flintlock.ammo, 8); assert.equal(p.inventory.scatter.ammo, 5);
});

test('shot damage/tracers, cutlass, revives and enemy attacks stop at walls and work through doors', () => {
  const { game, p, events } = setup(undefined, 2), ally = game.players.get('p1');
  const building = BUILDINGS.find(b => b.kind === 'cottage' && b.enterable);
  const inside = buildingWorldPoint(building, 0, 0), outside = buildingWorldPoint(building, building.width / 2 + .8, 0);
  locate(p, outside); locate(ally, inside); ally.knockedUntil = 100;
  assert.equal(game.action(p.id, 'interact', ally.id).code, 'TOO_FAR');
  const enemy = game.spawnEnemy('crab', inside.x, inside.z, 'beach'); aim(p, enemy);
  game.action(p.id, 'fire'); game.action(p.id, 'melee'); assert.equal(enemy.hp, enemy.maxHp);
  const blockedShot = events.find(e => e.kind === 'shot');
  assert.equal(blockedShot.hitId, undefined);
  const endpoint = buildingLocalPoint(building, blockedShot.to.x, blockedShot.to.z);
  assert.ok(Math.abs(endpoint.x - building.width / 2) < .01, 'tracer ends at the first side wall');
  assert.ok(Math.abs(endpoint.z) < .01);
  enemy.state = 'windup'; enemy.attackAt = 0; enemy._attack = { x: p.x, z: p.z, radius: 3 };
  game.tickEnemy(enemy, .05); assert.equal(p.hp, 100);
  locate(p, buildingWorldPoint(building, 0, building.depth / 2 + .7)); aim(p, enemy);
  game.elapsed += 1; game.action(p.id, 'fire'); assert.equal(enemy.hp, enemy.maxHp - 24);
  const doorShot = events.filter(e => e.kind === 'shot').at(-1);
  assert.equal(doorShot.hitId, enemy.id);
  assert.deepEqual(doorShot.to, { x: enemy.x, y: enemy.y + enemy.radius * .8, z: enemy.z }, 'doorway tracer reaches its target');
  game.action(p.id, 'interact', ally.id); assert.equal(ally.knockedUntil, 0);
  game.action(p.id, 'melee'); assert.equal(game.enemies.has(enemy.id), false);
});
