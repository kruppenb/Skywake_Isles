import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { makePlayerPosition, movePlayer } from '../shared/movement.js';
import { SHIP_DURATION, SHIP_OBSTACLES, shipAt, heightAt } from '../shared/world.js';
import { SHIP_SCALE, SHIP_DECK, SHIP_GUNS, AIRSHIP_RETURNS, RETURN_RANGE, GUN_DAMAGE, GUN_COOLDOWN, GUN_RANGE, GUN_PIVOT_HEIGHT, GUN_MUZZLE_LENGTH, gunAim, gunMuzzle, gunOperator } from '../shared/airship.js';

function setup(count = 2) {
  const events = [], game = new Game({ onEvent: event => events.push(event) });
  const crew = Array.from({ length: count }, (_, i) => game.addPlayer(`crew-${i}`, `Crew ${i}`));
  game.action(crew[0].id, 'launch');
  return { game, crew, p: crew[0], events };
}
function tick(game, seconds) { for (let i = 0; i < Math.ceil(seconds / 0.05); i++) game.tick(0.05); }
function deck(game, p, gun) {
  const position = gunOperator(gun), ship = shipAt(game.elapsed);
  Object.assign(p, { mode: 'aboard', deckX: position.x, deckZ: position.z, x: ship.x + position.x,
    y: ship.y, z: ship.z + position.z, grounded: true, gunId: null });
}
function mount(game, p, gun = SHIP_GUNS[0]) {
  deck(game, p, gun);
  assert.equal(game.action(p.id, 'interact', gun.id).ok, true);
}
function ground(p, point = AIRSHIP_RETURNS[0]) {
  Object.assign(p, { x: point.x, z: point.z, y: heightAt(point.x, point.z), mode: 'ground', grounded: true, gunId: null, vy: 0 });
}
function input(game, p, fields = {}) {
  return game.setInput(p.id, { seq: p._receivedInputSeq + 1, forward: 0, right: 0, yaw: p.yaw, pitch: p.pitch, jump: false, ...fields });
}
function poseTarget(game, target, from, direction, along, offset = 0) {
  Object.assign(target, { x: from.x + direction.x * along, y: from.y + direction.y * along + offset,
    z: from.z + direction.z * along, hp: 80, _respawnAt: 0 });
}
function emptySky(game) {
  for (const target of game.flyingTargets) { target.hp = 0; target._respawnAt = game.elapsed + 100; }
}

test('enlarged deck has collision-safe walking routes to all four gun operators', () => {
  assert.deepEqual(SHIP_SCALE, { x: 1.5, y: 1.15, z: 1.5 });
  for (const gun of SHIP_GUNS) {
    const p = makePlayerPosition(), operator = gunOperator(gun);
    for (const waypoint of [{ x: operator.x, z: 0 }, operator]) {
      let steps = 0;
      while (Math.hypot(p.deckX - waypoint.x, p.deckZ - waypoint.z) > 0.12 && steps++ < 150) {
        const dx = waypoint.x - p.deckX, dz = waypoint.z - p.deckZ, d = Math.hypot(dx, dz);
        movePlayer(p, { yaw: 0, right: dx / d * Math.min(d / 0.4, 1), forward: -dz / d * Math.min(d / 0.4, 1) }, 0.05, 0);
        assert.ok(p.deckX >= SHIP_DECK.minX && p.deckX <= SHIP_DECK.maxX && p.deckZ >= SHIP_DECK.minZ && p.deckZ <= SHIP_DECK.maxZ);
        for (const obstacle of SHIP_OBSTACLES) {
          if (obstacle.type === 'circle') assert.ok(Math.hypot(p.deckX - obstacle.x, p.deckZ - obstacle.z) >= obstacle.radius + 0.6 - 1e-6, obstacle.id);
          else assert.ok(p.deckX <= obstacle.minX - 0.6 || p.deckX >= obstacle.maxX + 0.6 || p.deckZ <= obstacle.minZ - 0.6 || p.deckZ >= obstacle.maxZ + 0.6);
        }
      }
      assert.ok(steps < 150, `walk to ${gun.id}`);
    }
    assert.ok(Math.hypot(p.deckX - gun.x, p.deckZ - gun.z) < 2.4);
  }
  // Circle separation at a rail must not push a player beyond deck bounds.
  const p = makePlayerPosition(); p.deckX = 6; p.deckZ = -11;
  for (let i = 0; i < 20; i++) movePlayer(p, { forward: -1 }, 0.05, 0);
  assert.ok(p.deckX <= 6);
  assert.ok(Math.hypot(p.deckX - 5, p.deckZ + 9) >= 1.15 - 1e-8);
});

test('shared gun aim wraps, clamps and puts muzzle on the same firing ray', () => {
  for (const gun of SHIP_GUNS) {
    assert.ok(Math.abs(gunAim(gun, gun.yaw + 100 * Math.PI, 0.1).yaw - gun.yaw) < 1e-10);
    const high = gunAim(gun, gun.yaw + 2, 100), low = gunAim(gun, gun.yaw - 2, -100);
    assert.ok(Math.abs(high.yaw - gun.yaw - 1.25) < 1e-10); assert.equal(high.pitch, 0.8);
    assert.ok(Math.abs(low.yaw - gun.yaw + 1.25) < 1e-10); assert.equal(low.pitch, -0.55 * Math.cos(1.25));
    assert.equal(gunAim(gun, gun.yaw, -100).pitch, -0.55);
    const ship = shipAt(40), { from, direction } = gunMuzzle(gun, ship, high.yaw, high.pitch);
    assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-10);
    assert.ok(Math.abs(Math.hypot(from.x - ship.x - gun.x, from.y - ship.y - GUN_PIVOT_HEIGHT, from.z - ship.z - gun.z) - GUN_MUZZLE_LENGTH) < 1e-10);
    assert.ok(Object.values(gunAim(gun, Infinity, NaN)).every(Number.isFinite));
  }
});

test('airship return requires an active, alive, grounded pirate within full 3D lift range', () => {
  const { game, p } = setup();
  const pad = AIRSHIP_RETURNS[0];
  for (const invalid of [
    { x: pad.x + RETURN_RANGE + 0.01 }, { y: heightAt(pad.x, pad.z) + RETURN_RANGE + 0.01 },
    { x: pad.x + 2.5, y: heightAt(pad.x, pad.z) + 2.5 }, { mode: 'gliding' },
    { grounded: false }, { knockedUntil: 10 }, { hp: 0 }, { online: false },
  ]) {
    ground(p, pad); Object.assign(p, { hp: 100, online: true, knockedUntil: 0 }, invalid);
    assert.equal(game.action(p.id, 'interact', pad.id).ok, false, JSON.stringify(invalid));
    assert.notEqual(p.mode, 'aboard');
  }
  Object.assign(p, { hp: 100, online: true, knockedUntil: 0 }); ground(p);
  assert.equal(game.action(p.id, 'interact', 'airship-return-invalid').ok, false);
  for (const phase of ['lobby', 'victory']) {
    game.phase = phase; assert.equal(game.action(p.id, 'interact', pad.id).ok, false);
  }
  for (const phase of ['voyage', 'finale']) for (const point of AIRSHIP_RETURNS) {
    game.phase = phase; ground(p, point);
    assert.equal(game.action(p.id, 'interact', point.id).ok, true);
    assert.equal(p.mode, 'aboard'); assert.equal(p.shipReturned, true);
  }
});

test('late return keeps equipment and health, stops input/bursts, and survives the parked ship', () => {
  const { game, p } = setup(); game.elapsed = SHIP_DURATION + 4;
  ground(p); p.hp = 37; p.ammo = 3; p.inventory.flintlock.ammo = 3; p._burst = { remaining: 2 };
  p.jumpHeld = true; input(game, p, { forward: 1, jump: true });
  const inventory = structuredClone(p.inventory);
  assert.equal(game.action(p.id, 'interact', AIRSHIP_RETURNS[0].id).ok, true);
  assert.deepEqual([p.deckX, p.deckZ, p.hp, p.ammo, p.gunId, p._burst, p.jumpHeld], [0, 0, 37, 3, null, null, false]);
  assert.deepEqual(p.inventory, inventory); assert.equal(p._input.forward, 0); assert.equal(p._input.jump, false);
  game.tick(); assert.equal(p.mode, 'aboard'); assert.equal(p.y, shipAt(game.elapsed).y);
  input(game, p, { jump: true }); game.tick(); assert.equal(p.mode, 'gliding');
});

test('implicit return interaction keeps fallen crewmate revival priority', () => {
  const { game, crew: [p, ally] } = setup(); ground(p); ground(ally);
  ally.hp = 0; ally.knockedUntil = 20;
  assert.equal(game.action(p.id, 'interact').ok, true);
  assert.equal(ally.knockedUntil, 0); assert.equal(p.mode, 'ground');
  assert.equal(game.action(p.id, 'interact').ok, true); assert.equal(p.mode, 'aboard');
});

test('gun seats are exclusive and mounted movement pins position with authoritative aim', () => {
  const { game, crew: [p, other] } = setup(), gun = SHIP_GUNS[0];
  assert.equal(game.action(p.id, 'interact', gun.id).ok, false);
  mount(game, p, gun); deck(game, other, gun);
  assert.equal(game.action(other.id, 'interact', gun.id).code, 'GUN_OCCUPIED');
  input(game, p, { forward: 1, right: 1, sprint: true, yaw: gun.yaw + 2, pitch: 1.3, gunId: SHIP_GUNS[1].id, deckX: 99 });
  game.tick();
  const operator = gunOperator(gun), ship = shipAt(game.elapsed);
  assert.deepEqual([p.deckX, p.deckZ, p.x, p.z, p.gunId], [operator.x, operator.z, ship.x + operator.x, ship.z + operator.z, gun.id]);
  assert.ok(Math.abs(p.yaw - gun.yaw - 1.25) < 1e-8); assert.equal(p.pitch, 0.8);
  assert.equal(p.shipReturned, true);
  for (const action of ['melee', 'reload', 'heal', 'swap']) assert.equal(game.action(p.id, action, action === 'swap' ? 'scatter' : undefined).code, 'MOUNTED');
  assert.equal(game.action(p.id, 'ping').ok, true);
  assert.equal(game.action(p.id, 'interact', 'gun-invalid').ok, false); assert.equal(p.gunId, gun.id);
  assert.equal(game.action(p.id, 'interact', gun.id).ok, true);
  assert.equal(game.action(other.id, 'interact', gun.id).ok, true);
  assert.equal(p.gunId, null); assert.equal(other.gunId, gun.id);
  mount(game, p, SHIP_GUNS[1]); assert.equal(game.shipGuns.filter(g => g.occupantId).length, 2);
});

test('E and Space dismount after flight stay aboard, held jump cannot trigger glide', () => {
  for (const action of ['interact', 'jump']) {
    const { game, p } = setup(); mount(game, p); game.elapsed = SHIP_DURATION + 3; game.tick();
    if (action === 'interact') game.action(p.id, action, p.gunId);
    else { input(game, p, { jump: true }); game.tick(); }
    assert.equal(p.gunId, null); assert.ok(game.shipGuns.every(gun => !gun.occupantId));
    tick(game, 0.15); assert.equal(p.mode, 'aboard');
    input(game, p, { jump: false }); game.tick(); input(game, p, { jump: true }); game.tick();
    assert.equal(p.mode, 'gliding');
  }
});

test('cannon ray picks first spherical surface, records damage and preserves all island economy', () => {
  const { game, p, events } = setup(); mount(game, p); emptySky(game);
  const gun = SHIP_GUNS[0]; input(game, p, { yaw: gun.yaw, pitch: 0 });
  const { from, direction } = gunMuzzle(gun, shipAt(game.elapsed), p.yaw, p.pitch);
  const [grazed, centered] = game.flyingTargets;
  poseTarget(game, grazed, from, direction, 20, 1.95);
  poseTarget(game, centered, from, direction, 20.5);
  const before = { ammo: p.ammo, inventory: structuredClone(p.inventory), kills: p.kills, pearls: game.pearls, shards: game.shards, enemies: game.enemies.size };
  game.action(p.id, 'fire');
  const shot = events.findLast(event => event.kind === 'shot');
  assert.equal(shot.weapon, 'cannon'); assert.equal(shot.gunId, gun.id); assert.equal(shot.hitId, centered.id);
  assert.equal(shot.damage, GUN_DAMAGE); assert.equal(centered.hp, 40); assert.equal(grazed.hp, 80);
  assert.ok(Math.abs(Math.hypot(shot.to.x - from.x, shot.to.y - from.y, shot.to.z - from.z) - 18.5) < 1e-8);
  assert.deepEqual({ ammo: p.ammo, inventory: p.inventory, kills: p.kills, pearls: game.pearls, shards: game.shards, enemies: game.enemies.size }, before);
  assert.ok(events.some(event => event.kind === 'hit' && event.targetId === centered.id && event.y === centered.y));
});

test('misses, behind-ray targets, near misses and targets beyond range take no damage', () => {
  for (const [along, offset] of [[30, 2.01], [-10, 0], [GUN_RANGE + 2.01, 0]]) {
    const { game, p, events } = setup(); mount(game, p); emptySky(game);
    input(game, p, { yaw: SHIP_GUNS[0].yaw, pitch: 0 });
    const { from, direction } = gunMuzzle(SHIP_GUNS[0], shipAt(0), p.yaw, p.pitch), target = game.flyingTargets[0];
    poseTarget(game, target, from, direction, along, offset); game.action(p.id, 'fire');
    assert.equal(target.hp, 80); const shot = events.findLast(event => event.kind === 'shot');
    assert.equal(shot.hitId, undefined); assert.ok(Math.abs(Math.hypot(shot.to.x - from.x, shot.to.y - from.y, shot.to.z - from.z) - GUN_RANGE) < 1e-6);
  }
});

test('cannon cooldown belongs to gun across crew changes, and practice crabs respawn after seven seconds', () => {
  const { game, crew: [p, other], events } = setup(); mount(game, p); emptySky(game);
  const gun = SHIP_GUNS[0]; input(game, p, { yaw: gun.yaw, pitch: 0 });
  const ray = gunMuzzle(gun, shipAt(0), p.yaw, p.pitch), target = game.flyingTargets[0];
  poseTarget(game, target, ray.from, ray.direction, 30); game.action(p.id, 'fire');
  game.action(p.id, 'interact', gun.id); mount(game, other, gun); input(game, other, { yaw: gun.yaw, pitch: 0 });
  game.action(other.id, 'fire'); assert.equal(target.hp, 40); assert.equal(events.filter(e => e.kind === 'shot').length, 1);
  game.elapsed = GUN_COOLDOWN; movePlayer(other, other._input, 0, game.elapsed);
  const nextRay = gunMuzzle(gun, shipAt(game.elapsed), other.yaw, other.pitch);
  Object.assign(target, { x: nextRay.from.x + nextRay.direction.x * 30, y: nextRay.from.y, z: nextRay.from.z });
  game.action(other.id, 'fire'); assert.equal(target.hp, 0);
  assert.equal(game.snapshot().flyingTargets.some(t => t.id === target.id), false);
  const down = events.find(event => event.kind === 'target-down'); assert.equal(down.id, target.id); assert.ok(down.y > 60);
  game.elapsed = target._respawnAt - 0.01; game.tickFlyingTargets(); assert.equal(target.hp, 0);
  game.elapsed = target._respawnAt; game.tickFlyingTargets(); assert.equal(target.hp, 80);
  assert.equal(game.flyingTargets.length, 8); assert.ok(game.snapshot().flyingTargets.some(t => t.id === target.id));
  assert.equal(game.pearls, 0); assert.equal(p.kills + other.kills, 0);
});

test('disconnect, replacement connection, leave, victory and round reset release seats and public state stays bounded', () => {
  const { game, crew: [p, other] } = setup(); mount(game, p); game.action(p.id, 'fire');
  const readyAt = game.shipGuns[0].readyAt;
  game.disconnect(p.id); assert.equal(p.gunId, null); assert.equal(game.shipGuns[0].occupantId, null);
  game.reconnect(p.id); assert.equal(p.gunId, null); assert.equal(p.shipReturned, true); assert.equal(game.shipGuns[0].readyAt, readyAt);
  mount(game, p); game.reconnect(p.id); assert.equal(p.gunId, null);
  mount(game, other); game.disconnect(other.id, true); assert.equal(game.shipGuns[0].occupantId, null);
  mount(game, p); game.win(); assert.equal(p.gunId, null); assert.ok(game.shipGuns.every(gun => !gun.occupantId));
  assert.deepEqual(game.snapshot().flyingTargets, []);
  assert.equal(game.action(p.id, 'restart').ok, true);
  const snapshot = game.snapshot(); assert.equal(snapshot.players[0].shipReturned, false); assert.equal(snapshot.players[0].gunId, null);
  assert.equal(snapshot.shipGuns.length, 4); assert.ok(snapshot.shipGuns.every(gun => !gun.occupantId && gun.readyAt === 0));
  assert.deepEqual(snapshot.flyingTargets, []);
  game.action(p.id, 'launch'); const targets = game.snapshot().flyingTargets;
  assert.equal(targets.length, 8); assert.equal(new Set(targets.map(target => `${target.x},${target.z}`)).size, 8);
  assert.ok(targets.every(target => Object.keys(target).every(key => !key.startsWith('_')) && target.hp === 80));
  const start = structuredClone(targets); tick(game, 1);
  assert.ok(game.snapshot().flyingTargets.every((target, i) => target.x !== start[i].x || target.z !== start[i].z));
});
