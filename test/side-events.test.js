import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, sideEventSpawns, sideEventPathClear } from '../server/game.js';
import { SIDE_EVENTS, SIDE_EVENT_WAVES } from '../shared/side-events.js';
import { BEACON, CHESTS, SHRINES, COLORS, heightAt } from '../shared/world.js';
import { resolveWorldCollision, hasWorldLineOfSight } from '../shared/collision.js';
import { inSafeLanding } from '../shared/encounters.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ticks = (game, seconds) => { for (let i = 0; i < Math.ceil(seconds / 0.05); i++) game.tick(0.05); };
const locate = (p, point) => Object.assign(p, { x: point.x, z: point.z, y: heightAt(point.x, point.z), mode: 'ground', grounded: true, vy: 0 });
const enemiesFor = (game, id) => [...game.enemies.values()].filter(enemy => enemy._sideEvent === id);
const eventFor = (game, id) => game.sideEvents.find(event => event.id === id);

function setup(count = 1, ambient = false) {
  const events = [], game = new Game({ onEvent: event => events.push(event) });
  for (let i = 0; i < count; i++) game.addPlayer(`p${i}`, `Pirate ${i}`, COLORS[i]);
  game.action('p0', 'launch');
  if (!ambient) game.enemies.clear();
  return { game, p: game.players.get('p0'), events };
}

function assertClearWave(game, point, expected) {
  const enemies = enemiesFor(game, point.id);
  assert.equal(enemies.length, expected);
  for (const enemy of enemies) {
    const radius = distance(enemy, point);
    assert.ok(radius >= 10 - 1e-8 && radius <= 15 + 1e-8, 'spawn stays on the finite approach annulus');
    assert.equal(inSafeLanding(enemy), false);
    assert.ok([BEACON, ...CHESTS, ...SHRINES].every(loot => distance(enemy, loot) >= 3.6));
    assert.ok([...game.enemies.values()].every(other => other === enemy || distance(enemy, other) >= 2.8));
    assert.equal(enemy._camp, null); assert.equal(enemy._shrine, null);
    assert.ok(hasWorldLineOfSight({ ...enemy, y: enemy.y + 1 }, { ...point, y: heightAt(point.x, point.z) + 1 }, 0.8));
    let previousY = enemy.y;
    // Independently walk the route with the crab's full public body radius.
    for (let fraction = 0; fraction <= 1; fraction += 0.025) {
      const sample = { x: enemy.x + (point.x - enemy.x) * fraction, z: enemy.z + (point.z - enemy.z) * fraction };
      sample.y = heightAt(sample.x, sample.z);
      const resolved = resolveWorldCollision({ ...sample }, enemy.radius);
      assert.ok(distance(sample, resolved) < 0.001, 'route does not cross props, furniture or building walls');
      assert.ok(sample.y > 1 && Math.abs(sample.y - previousY) < 0.8);
      assert.equal(inSafeLanding(sample), false);
      previousY = sample.y;
    }
  }
}

test('optional defenses never start or spawn automatically, even when crew stand at supplies', () => {
  const { game, p, events } = setup();
  for (const point of SIDE_EVENTS) { locate(p, point); ticks(game, 2); }
  assert.equal(game.enemies.size, 0);
  assert.ok(game.sideEvents.every(event => event.status === 'available' && event.wave === 0 && event.remaining === 0 && event.integrity === 100));
  assert.equal(events.some(event => event.kind === 'side-event'), false);
  assert.equal(game.shards, 0); assert.equal(game.phase, 'voyage');
});

test('all three centers and both solo/five-player waves have separated, clear, walkable spawns beside ambient guards', () => {
  for (const point of SIDE_EVENTS) for (const count of [1, 5]) {
    assert.ok(sideEventPathClear(point, point), `${point.id} supply center is clear`);
    const { game, p } = setup(count, true);
    locate(p, point);
    assert.equal(game.action(p.id, 'interact', point.id).ok, true, `${point.id}, ${count} players`);
    assertClearWave(game, point, 3 + Math.floor((count - 1) / 2));
    for (const enemy of enemiesFor(game, point.id)) game.damageEnemy(enemy, enemy.hp, p.id);
    p.mode = 'aboard';
    game.tick(); assert.equal(eventFor(game, point.id).remaining, 0);
    ticks(game, 2.9); assert.equal(enemiesFor(game, point.id).length, 0);
    ticks(game, 0.1);
    assertClearWave(game, point, 4 + Math.floor((count - 1) / 2));
    assert.equal(enemiesFor(game, point.id).filter(enemy => enemy.type === 'spitter').length, 1);
  }
});

test('spawn input validation and exhausted fallbacks never return an invalid last candidate', () => {
  const id = SIDE_EVENTS[0].id;
  for (const args of [['unknown', 1, 1], [id, NaN, 1], [id, 0, 1], [id, 6, 1], [id, 2.5, 1], [id, 1, 0], [id, 1, 3], [id, 1, 1, [{ x: NaN, z: 0 }]]]) {
    assert.equal(sideEventSpawns(...args), null);
  }
  const center = SIDE_EVENTS[0], occupied = [];
  for (const radius of [10, 12, 14, 16]) for (let direction = 0; direction < 96; direction++) {
    const angle = direction * Math.PI / 48;
    occupied.push({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius });
  }
  assert.equal(sideEventSpawns(id, 5, 1, occupied), null);
});

test('invalid, distant, airborne, downed, offline, elevated and obstructed starts are rejected', () => {
  const { game, p } = setup(), point = SIDE_EVENTS[2];
  const reject = () => { assert.equal(game.action(p.id, 'interact', point.id).ok, false); assert.equal(game.enemies.size, 0); };
  locate(p, point); assert.equal(game.action(p.id, 'interact', 'defense-forged').ok, false);
  assert.equal(game.action(p.id, 'interact', { id: point.id, reward: 999, status: 'completed' }).code, 'BAD_TARGET');
  locate(p, { x: point.x + 4.01, z: point.z }); reject();
  locate(p, point); p.mode = 'gliding'; reject();
  locate(p, point); p.grounded = false; reject();
  locate(p, point); p.y += 3; reject();
  locate(p, point); p.knockedUntil = 10; reject(); p.knockedUntil = 0;
  p.hp = 0; reject(); p.hp = 100;
  p.online = false; reject(); p.online = true;
  // The yard's dock palm occludes this nearby position, even with legal range
  // and elevation. Collision cannot be bypassed by an interaction packet.
  locate(p, { x: 27.2, z: 93.2 });
  assert.ok(distance(p, point) < 4);
  assert.equal(hasWorldLineOfSight({ ...p, y: p.y + 1.25 }, { ...point, y: heightAt(point.x, point.z) + 0.8 }), false);
  reject();
  locate(p, point); game.phase = 'finale'; reject(); game.phase = 'lobby'; reject();
  assert.ok(game.sideEvents.every(event => event.status === 'available'));
});

test('explicit and targetless interactions preserve one crew defense, nearest loot and revive priority', () => {
  const { game, p } = setup(2), point = SIDE_EVENTS[0], ally = game.players.get('p1');
  const chest = CHESTS.find(item => item.id === 'chest-6');
  locate(p, { x: -30.5, z: 37 });
  assert.ok(distance(p, chest) < distance(p, point));
  game.action(p.id, 'interact');
  assert.equal(game.chests.find(item => item.id === chest.id).opened, true);
  assert.equal(eventFor(game, point.id).status, 'available');
  locate(p, point); locate(ally, { x: point.x + 1, z: point.z }); ally.knockedUntil = 10; ally.hp = 0;
  game.action(p.id, 'interact');
  assert.equal(ally.knockedUntil, 0); assert.equal(eventFor(game, point.id).status, 'available');
  assert.equal(game.action(p.id, 'interact', point.id).ok, true);
  const ids = [...game.enemies.keys()];
  for (let i = 0; i < 5; i++) assert.equal(game.action(p.id, 'interact', point.id).ok, false);
  locate(ally, SIDE_EVENTS[1]); assert.equal(game.action(ally.id, 'interact', SIDE_EVENTS[1].id).ok, false);
  assert.deepEqual([...game.enemies.keys()], ids);
});

test('player count is latched for the whole two-wave defense despite disconnects and reconnects', () => {
  const { game, p } = setup(5), point = SIDE_EVENTS[1];
  locate(p, point); game.action(p.id, 'interact', point.id);
  for (let i = 1; i < 5; i++) game.disconnect(`p${i}`);
  for (const enemy of enemiesFor(game, point.id)) game.damageEnemy(enemy, enemy.hp, p.id);
  p.mode = 'aboard'; ticks(game, 3.1);
  assert.equal(game.onlineCount, 1); assert.equal(enemiesFor(game, point.id).length, 6);
  const before = game.snapshot().sideEvents;
  assert.ok(game.reconnect('p1')); assert.deepEqual(game.snapshot().sideEvents, before);
});

test('unattended crab attacks visibly damage all three supplies and fail with event-only cleanup', () => {
  for (const point of SIDE_EVENTS) {
    const { game, p, events } = setup();
    const unrelated = game.spawnEnemy('crab', 0, 50, 'haven', 'palm');
    locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
    ticks(game, 6);
    const event = eventFor(game, point.id);
    assert.ok(event.integrity < 100 && event.integrity > 0, `${point.id}: actual ticks damaged supplies`);
    assert.ok(events.some(item => item.kind === 'telegraph' && distance(item, point) < 0.01));
    assert.ok(events.some(item => item.kind === 'splash' && distance(item, point) < 0.01));
    ticks(game, 15);
    assert.equal(event.status, 'failed'); assert.equal(event.integrity, 0); assert.equal(event.remaining, 0);
    assert.equal(enemiesFor(game, point.id).length, 0); assert.ok(game.enemies.has(unrelated.id));
    assert.equal(game.pearls, 0); assert.equal(game.shards, 0); assert.equal(game.phase, 'voyage');
    assert.ok(events.some(item => item.kind === 'notice' && item.message === 'Supplies lost. Your compass quest continues.'));
    locate(p, point); assert.equal(game.action(p.id, 'interact', point.id).ok, false);
    ticks(game, 2); assert.equal(event.status, 'failed');
  }
});

test('spitters advance to supplies, while walls, elevation and landing protection prevent damage', () => {
  const { game, p } = setup(), point = SIDE_EVENTS[2];
  locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
  for (const enemy of enemiesFor(game, point.id)) game.damageEnemy(enemy, enemy.hp, p.id);
  ticks(game, 3.1);
  for (const enemy of enemiesFor(game, point.id).filter(enemy => enemy.type !== 'spitter')) game.damageEnemy(enemy, enemy.hp, p.id);
  const spitter = enemiesFor(game, point.id)[0], event = eventFor(game, point.id);
  ticks(game, 7);
  assert.ok(distance(spitter, point) <= 3); assert.ok(event.integrity < 100);
  const integrity = event.integrity;
  // Resolve a stored windup after displacement into the nearby palm: the
  // supply range/elevation pass, but the obstruction must still prevent damage.
  Object.assign(spitter, { x: 28, z: 94, y: heightAt(28, 94), state: 'windup', attackAt: game.elapsed,
    _attack: { x: point.x, z: point.z, radius: 2.5, sideEvent: point.id } });
  assert.ok(distance(spitter, point) < 3);
  assert.equal(hasWorldLineOfSight({ ...spitter, y: spitter.y + 1.25 }, { ...point, y: heightAt(point.x, point.z) + 0.8 }), false);
  game.tick(); assert.equal(event.integrity, integrity);
  Object.assign(spitter, { x: point.x, z: point.z, y: heightAt(point.x, point.z) + 4, state: 'windup', attackAt: game.elapsed });
  game.tick(); assert.equal(event.integrity, integrity);
  locate(p, { x: 19, z: 94 }); p.invulnerableUntil = 0; p.hp = 100;
  Object.assign(spitter, { x: 21, z: 94, y: heightAt(21, 94), state: 'windup', attackAt: game.elapsed,
    _attack: { x: p.x, z: p.z, radius: 2.5 } });
  assert.equal(inSafeLanding(p), true);
  game.tick(); assert.equal(p.hp, 100);
  for (let i = 0; i < 20; i++) { game.tick(); assert.equal(inSafeLanding(spitter), false); }
});

test('a crab displaced behind the market cottage finds a clear return route and resumes supply attacks', () => {
  const { game, p } = setup(), point = SIDE_EVENTS[0];
  locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
  const [crab, ...others] = enemiesFor(game, point.id);
  for (const enemy of others) game.damageEnemy(enemy, enemy.hp, p.id);
  Object.assign(crab, { x: -47, z: 41, y: heightAt(-47, 41) });
  assert.equal(sideEventPathClear(crab, point), false);
  ticks(game, 15);
  assert.ok(distance(crab, point) < 3, 'navigation returns around the cottage');
  assert.ok(eventFor(game, point.id).integrity < 100);
});

for (const count of [1, 5]) test(`${count}-player shooting defense completes both waves once without changing the compass quest`, () => {
  const { game, p, events } = setup(count), point = SIDE_EVENTS[0];
  locate(p, point); game.action(p.id, 'interact', point.id);
  const checkpoint = { ...game.checkpoint }, shrines = game.snapshot().shrines;
  let seq = 0, steps = 0;
  while (eventFor(game, point.id).status === 'active' && steps++ < 1800) {
    const enemy = enemiesFor(game, point.id)[0];
    if (enemy) {
      const dx = enemy.x - p.x, dz = enemy.z - p.z;
      game.setInput(p.id, { seq: seq++, forward: 0, right: 0, yaw: Math.atan2(-dx, -dz),
        pitch: Math.atan2(enemy.y + enemy.radius * 0.8 - p.y - 1.25, Math.hypot(dx, dz)), jump: false, sprint: false });
      game.action(p.id, 'fire');
      if (p.hp < 65) game.action(p.id, 'heal');
    }
    game.tick();
  }
  const event = eventFor(game, point.id), kills = (3 + 4) + 2 * Math.floor((count - 1) / 2);
  assert.equal(event.status, 'completed'); assert.equal(event.wave, SIDE_EVENT_WAVES); assert.equal(event.remaining, 0);
  assert.ok(event.integrity > 0); assert.equal(p.kills, kills); assert.equal(game.pearls, kills * 3 + 30);
  assert.equal(events.filter(item => item.kind === 'side-event' && item.status === 'completed').length, 1);
  assert.equal(events.find(item => item.kind === 'side-event' && item.status === 'completed').reward, 30);
  assert.deepEqual(game.snapshot().shrines, shrines); assert.deepEqual(game.checkpoint, checkpoint);
  assert.equal(game.shards, 0); assert.equal(game.phase, 'voyage'); assert.equal(game.bossId, null);
  assert.equal(game.action(p.id, 'interact', point.id).ok, false);
  ticks(game, 4); assert.equal(game.pearls, kills * 3 + 30);
});

test('completion heals only nearby alive ground crew and snapshots isolate public state', () => {
  const { game, p } = setup(5), point = SIDE_EVENTS[1];
  locate(p, point); game.action(p.id, 'interact', point.id);
  for (const enemy of enemiesFor(game, point.id)) game.damageEnemy(enemy, enemy.hp, p.id);
  p.mode = 'aboard'; ticks(game, 3.1);
  const event = eventFor(game, point.id);
  for (const enemy of enemiesFor(game, point.id)) game.damageEnemy(enemy, enemy.hp, p.id);
  const crew = [...game.players.values()];
  for (const ally of crew) { locate(ally, point); ally.hp = 40; ally._damageAt = game.elapsed; }
  crew[1].mode = 'gliding'; crew[1].y += 10; crew[2].knockedUntil = game.elapsed + 20;
  locate(crew[3], { x: point.x + 20, z: point.z }); crew[4].online = false; crew[4]._expiresAt = game.clock + 60;
  game.tick();
  assert.equal(event.status, 'completed'); assert.equal(p.hp, 65);
  for (const ally of crew.slice(1)) assert.equal(ally.hp, 40);
  const snapshot = game.snapshot(), publicEvent = snapshot.sideEvents.find(item => item.id === point.id);
  assert.deepEqual(Object.keys(publicEvent).sort(), ['id', 'status', 'wave', 'remaining', 'integrity', 'maxIntegrity', 'startedAt', 'endsAt', 'finishedAt'].sort());
  publicEvent.integrity = -100; publicEvent.status = 'available'; snapshot.sideEvents.pop();
  assert.equal(event.status, 'completed'); assert.ok(event.integrity > 0); assert.equal(game.sideEvents.length, 3);
  assert.ok(game.snapshot().enemies.every(enemy => Object.keys(enemy).every(key => !key.startsWith('_'))));
});

test('a finite deadline fails safely, preserving unrelated enemies and denying restart rewards', () => {
  const { game, p, events } = setup(), point = SIDE_EVENTS[1];
  const unrelated = game.spawnEnemy('crab', 0, 50, 'haven', 'palm');
  locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
  for (const enemy of enemiesFor(game, point.id)) enemy._nextAttack = Infinity;
  ticks(game, 119.9); assert.equal(eventFor(game, point.id).status, 'active');
  ticks(game, 0.15);
  assert.equal(eventFor(game, point.id).status, 'failed'); assert.equal(enemiesFor(game, point.id).length, 0);
  assert.ok(game.enemies.has(unrelated.id)); assert.equal(game.pearls, 0);
  assert.equal(events.filter(item => item.kind === 'side-event' && item.status === 'failed').length, 1);
  locate(p, point); assert.equal(game.action(p.id, 'interact', point.id).ok, false);
});

test('reconnect preserves defense state; finale cancels before boss; abandon and replay reset every event', () => {
  const { game, p } = setup(), point = SIDE_EVENTS[0];
  locate(p, point); game.action(p.id, 'interact', point.id);
  const enemyIds = enemiesFor(game, point.id).map(enemy => enemy.id), state = game.snapshot().sideEvents;
  game.disconnect(p.id); assert.equal(game.reconnect(p.id), p);
  assert.deepEqual(game.snapshot().sideEvents, state); assert.deepEqual(enemiesFor(game, point.id).map(enemy => enemy.id), enemyIds);
  game.shards = 3; locate(p, BEACON); assert.equal(game.action(p.id, 'interact', BEACON.id).ok, true);
  assert.equal(game.phase, 'finale'); assert.equal(eventFor(game, point.id).status, 'cancelled');
  assert.equal(enemiesFor(game, point.id).length, 0); assert.equal(game.enemies.get(game.bossId).type, 'tempest'); assert.equal(game.pearls, 0);
  game.damageEnemy(game.enemies.get(game.bossId), 10000, p.id);
  assert.equal(game.action(p.id, 'restart').ok, true);
  assert.ok(game.sideEvents.every(event => event.status === 'available' && event.wave === 0 && event.startedAt === 0 && event.finishedAt === 0));
  game.action(p.id, 'launch'); locate(p, point); game.action(p.id, 'interact', point.id);
  game.disconnect(p.id, true); game.tick();
  assert.equal(game.phase, 'lobby'); assert.equal(game.enemies.size, 0);
  assert.ok(game.sideEvents.every(event => event.status === 'available' && event.remaining === 0 && event.integrity === 100));
});
