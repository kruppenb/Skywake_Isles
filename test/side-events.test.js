import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, sideEventSpawns, sideEventPathClear, sideEventWaypoint } from '../server/game.js';
import { SIDE_EVENTS, SIDE_EVENT_WAVES, SIDE_EVENT_DURATION, SIDE_EVENT_ARC, SIDE_EVENT_RANK_SPACING, SIDE_EVENT_RANK_STAGGER, SIDE_EVENT_RANK_DELAY, seawardBearing, sideEventWave } from '../shared/side-events.js';
import { FINALE_STAGES, FINALE_STAGE_DELAY } from '../shared/finale.js';
import { ENEMY_TYPES } from '../shared/enemies.js';
import { BEACON, CHESTS, SHRINES, COLORS, heightAt, shipAt } from '../shared/world.js';
import { SHIP_GUNS, gunOperator } from '../shared/airship.js';
import { damageSkyBoss, livingSkyBosses } from '../server/sky-finale.js';
import { resolveWorldCollision, hasWorldLineOfSight } from '../shared/collision.js';
import { inSafeLanding } from '../shared/encounters.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ticks = (game, seconds) => { for (let i = 0; i < Math.ceil(seconds / 0.05); i++) game.tick(0.05); };
const locate = (p, point) => Object.assign(p, { x: point.x, z: point.z, y: heightAt(point.x, point.z), mode: 'ground', grounded: true, vy: 0 });
const enemiesFor = (game, id) => [...game.enemies.values()].filter(enemy => enemy._sideEvent === id);
const eventFor = (game, id) => game.sideEvents.find(event => event.id === id);

// The last finale stage is fought from a deck gun against flying bosses, so a
// landed pirate boards through the normal action and the lifecycle is driven
// directly (the cannon path itself belongs to the airship suites).
function finishSkyStage(game, p) {
  const gun = SHIP_GUNS[0], operator = gunOperator(gun), ship = shipAt(game.elapsed);
  Object.assign(p, { mode: 'aboard', gunId: null, hp: p.maxHp, knockedUntil: 0, grounded: true, vy: 0,
    deckX: operator.x, deckZ: operator.z, x: ship.x + operator.x, y: ship.y, z: ship.z + operator.z });
  assert.equal(game.action(p.id, 'interact', gun.id).ok, true);
  for (let step = 0; step < 4000 && game.phase === 'finale'; step++) {
    game.tick(0.05);
    for (const boss of livingSkyBosses(game)) damageSkyBoss(game, boss.id, boss.hp, p.id);
    game.releaseSpawns(game.finale, Infinity);
    for (const enemy of [...game.enemies.values()]) if (enemy._finale) game.damageEnemy(enemy, enemy.hp, p.id);
  }
}
// Later ranks surge in seconds after the first; materialise the whole wave so
// an assertion sees the formation the server placed rather than its front rank.
const release = (game, id) => game.releaseSpawns(eventFor(game, id), Infinity);
const killAll = (game, id, p) => { release(game, id); for (const enemy of enemiesFor(game, id)) game.damageEnemy(enemy, enemy.hp, p.id); };
const rosterTotal = roster => roster.crab + roster.spitter + roster.tidebreaker;
const nearestNeighbours = points => points.map(point => Math.min(...points.filter(other => other !== point).map(other => distance(point, other))));
const bearingOffset = (point, spawn) => {
  const delta = Math.atan2(spawn.z - point.z, spawn.x - point.x) - seawardBearing(point);
  return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
};

function setup(count = 1, ambient = false) {
  const events = [], game = new Game({ onEvent: event => events.push(event) });
  for (let i = 0; i < count; i++) game.addPlayer(`p${i}`, `Pirate ${i}`, COLORS[i]);
  game.action('p0', 'launch');
  if (!ambient) game.enemies.clear();
  return { game, p: game.players.get('p0'), events };
}

// Independently walk each route leg with the enemy's full public body radius.
function assertWalkable(from, to, radius, label) {
  let previousY = heightAt(from.x, from.z);
  for (let fraction = 0; fraction <= 1 + 1e-9; fraction += 0.025) {
    const sample = { x: from.x + (to.x - from.x) * fraction, z: from.z + (to.z - from.z) * fraction };
    sample.y = heightAt(sample.x, sample.z);
    const resolved = resolveWorldCollision({ ...sample }, radius);
    assert.ok(distance(sample, resolved) < 0.001, `${label}: route does not cross props, furniture or building walls`);
    assert.ok(sample.y > 1 && Math.abs(sample.y - previousY) < 0.8, `${label}: route stays on walkable sand`);
    assert.equal(inSafeLanding(sample), false, `${label}: route avoids the safe landing`);
    previousY = sample.y;
  }
}

function assertSeawardWave(game, point, wave, count) {
  release(game, point.id);
  const roster = sideEventWave(wave, count), enemies = enemiesFor(game, point.id);
  assert.equal(enemies.length, rosterTotal(roster), `${point.id} wave ${wave}: roster size`);
  for (const type of ['crab', 'spitter', 'tidebreaker']) assert.equal(enemies.filter(enemy => enemy.type === type).length, roster[type], `${point.id} wave ${wave}: ${type} count`);
  for (const enemy of enemies) {
    const stats = ENEMY_TYPES[enemy.type];
    assert.equal(enemy.hp, stats.hp + (stats.hpPerExtraPlayer ?? 0) * (count - 1)); assert.equal(enemy.radius, stats.radius); assert.equal(enemy.scale, stats.scale);
    const out = distance(enemy, point);
    assert.ok(out >= point.front - 2.5 && out <= point.front + 4 * SIDE_EVENT_RANK_SPACING + SIDE_EVENT_RANK_STAGGER + 20.5,
      `${point.id}: ${enemy.type} forms up on the seaward front (${out.toFixed(1)}m)`);
    assert.ok(bearingOffset(point, enemy) <= SIDE_EVENT_ARC + Math.PI / 30, `${point.id}: ${enemy.type} attacks from the seaward arc`);
    assert.equal(inSafeLanding(enemy), false);
    assert.ok([BEACON, ...CHESTS, ...SHRINES].every(loot => distance(enemy, loot) >= 3.6));
    assert.ok([...game.enemies.values()].every(other => other === enemy || distance(enemy, other) >= 2.8));
    assert.equal(enemy._camp, null); assert.equal(enemy._shrine, null);
    const legs = enemy._sideWaypoint ? [enemy._sideWaypoint, point] : [point];
    let from = enemy;
    for (const leg of legs) {
      assert.ok(hasWorldLineOfSight({ ...from, y: heightAt(from.x, from.z) + 1 }, { ...leg, y: heightAt(leg.x, leg.z) + 1 }, enemy.radius - 0.05));
      assertWalkable(from, leg, enemy.radius, `${point.id} ${enemy.type}`);
      from = leg;
    }
  }
}

// Stand at the supplies with a landing shield and shoot the nearest attacker
// every tick; this exercises wave mechanics rather than combat balance.
function defend(game, point, { steps = 4000, shield = true } = {}) {
  let seq = 0, step = 0;
  const crew = [...game.players.values()];
  for (const p of crew) { locate(p, { x: point.x + 1 + crew.indexOf(p) * 0.6, z: point.z }); if (shield) p.invulnerableUntil = Infinity; }
  while (eventFor(game, point.id).status === 'active' && step++ < steps) {
    const enemies = enemiesFor(game, point.id);
    for (const p of crew) {
      const enemy = enemies.sort((a, b) => distance(a, p) - distance(b, p))[0];
      if (!enemy) break;
      const dx = enemy.x - p.x, dz = enemy.z - p.z;
      game.setInput(p.id, { seq: seq++, forward: 0, right: 0, yaw: Math.atan2(-dx, -dz),
        pitch: Math.atan2(enemy.y + enemy.radius * 0.8 - p.y - 1.25, Math.hypot(dx, dz)), jump: false, sprint: false });
      game.action(p.id, 'fire');
    }
    game.tick();
  }
  return step;
}

test('optional defenses never start or spawn automatically, even when crew stand at supplies', () => {
  const { game, p, events } = setup();
  for (const point of SIDE_EVENTS) { locate(p, point); ticks(game, 2); }
  assert.equal(game.enemies.size, 0);
  assert.ok(game.sideEvents.every(event => event.status === 'available' && event.wave === 0 && event.remaining === 0 && event.integrity === 100));
  assert.equal(events.some(event => event.kind === 'side-event'), false);
  assert.equal(game.shards, 0); assert.equal(game.phase, 'voyage');
});

test('wave rosters grow with the crew and the final wave scales Tidebreakers per pair of pirates', () => {
  assert.equal(SIDE_EVENT_WAVES, 3);
  assert.deepEqual([1, 2, 3, 4, 5].map(count => sideEventWave(3, count).tidebreaker), [1, 1, 2, 2, 3]);
  assert.deepEqual([1, 2, 3, 4, 5].map(count => rosterTotal(sideEventWave(1, count))), [5, 7, 9, 11, 13]);
  for (let count = 1; count <= 5; count++) {
    for (let wave = 1; wave <= SIDE_EVENT_WAVES; wave++) {
      const roster = sideEventWave(wave, count);
      assert.ok(roster.crab >= 5, 'every wave brings a lot of crabs');
      assert.equal(roster.tidebreaker, wave === SIDE_EVENT_WAVES ? 1 + Math.floor((count - 1) / 2) : 0);
    }
    assert.ok(rosterTotal(sideEventWave(2, count)) > rosterTotal(sideEventWave(1, count)));
  }
  for (const args of [[0, 1], [4, 1], [1.5, 1], [1, 0], [1, NaN]]) assert.equal(sideEventWave(...args), null);
  assert.equal(ENEMY_TYPES.tidebreaker.miniBoss, true); assert.ok(ENEMY_TYPES.tidebreaker.hp > ENEMY_TYPES.spitter.hp * 3);
});

test('all three centers form seaward, separated, routed and walkable ranks for solo and full crews', () => {
  for (const point of SIDE_EVENTS) for (const count of [1, 5]) {
    assert.ok(sideEventPathClear(point, point), `${point.id} supply center is clear`);
    const { game, p } = setup(count, true);
    locate(p, point);
    assert.equal(game.action(p.id, 'interact', point.id).ok, true, `${point.id}, ${count} players`);
    assertSeawardWave(game, point, 1, count);
    for (let wave = 2; wave <= SIDE_EVENT_WAVES; wave++) {
      killAll(game, point.id, p);
      p.mode = 'aboard';
      game.tick(); assert.equal(eventFor(game, point.id).remaining, 0);
      ticks(game, 2.9); assert.equal(enemiesFor(game, point.id).length, 0);
      ticks(game, 0.1);
      assertSeawardWave(game, point, wave, count);
    }
  }
});

test('routed attackers walk their two-leg route to the supplies instead of pushing against walls', () => {
  for (const point of SIDE_EVENTS) {
    const { game, p } = setup(5);
    locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
    release(game, point.id);
    const routed = enemiesFor(game, point.id).filter(enemy => enemy._sideWaypoint);
    assert.ok(routed.length > 0, `${point.id}: some attackers start behind cover and route around it`);
    for (const enemy of enemiesFor(game, point.id)) if (!routed.includes(enemy)) game.damageEnemy(enemy, enemy.hp, p.id);
    ticks(game, 30);
    for (const enemy of routed) assert.ok(distance(enemy, point) < 3.2, `${point.id}: ${enemy.id} reached the supplies (${distance(enemy, point).toFixed(1)}m)`);
    assert.ok(eventFor(game, point.id).integrity < 100);
  }
});

test('spawn input validation and exhausted fronts never return an invalid last candidate', () => {
  const id = SIDE_EVENTS[0].id;
  for (const args of [['unknown', 1, 1], [id, NaN, 1], [id, 0, 1], [id, 6, 1], [id, 2.5, 1], [id, 1, 0], [id, 1, SIDE_EVENT_WAVES + 1], [id, 1, 1, [{ x: NaN, z: 0 }]], [id, 1, 1, 'nope']]) {
    assert.equal(sideEventSpawns(...args), null);
  }
  assert.equal(sideEventWaypoint({ x: NaN, z: 0 }, SIDE_EVENTS[0]), null);
  const center = SIDE_EVENTS[0], occupied = [];
  for (let x = center.x - 60; x <= center.x + 60; x += 2) for (let z = center.z - 60; z <= center.z + 60; z += 2) occupied.push({ x, z });
  assert.equal(sideEventSpawns(id, 5, 1, occupied), null);
  assert.equal(sideEventSpawns(id, 1, SIDE_EVENT_WAVES, occupied), null);
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

test('player count is latched for all three waves despite disconnects and reconnects', () => {
  const { game, p } = setup(5), point = SIDE_EVENTS[1];
  locate(p, point); game.action(p.id, 'interact', point.id);
  for (let i = 1; i < 5; i++) game.disconnect(`p${i}`);
  killAll(game, point.id, p);
  p.mode = 'aboard'; ticks(game, 3.1); release(game, point.id);
  assert.equal(game.onlineCount, 1); assert.equal(enemiesFor(game, point.id).length, rosterTotal(sideEventWave(2, 5)));
  const before = game.snapshot().sideEvents;
  assert.ok(game.reconnect('p1')); assert.deepEqual(game.snapshot().sideEvents, before);
  killAll(game, point.id, p); ticks(game, 3.1); release(game, point.id);
  const finalWave = enemiesFor(game, point.id);
  assert.equal(finalWave.length, rosterTotal(sideEventWave(3, 5)));
  assert.equal(finalWave.filter(enemy => enemy.type === 'tidebreaker').length, 3);
  for (const boss of finalWave.filter(enemy => enemy.type === 'tidebreaker')) assert.equal(boss.hp, ENEMY_TYPES.tidebreaker.hp + ENEMY_TYPES.tidebreaker.hpPerExtraPlayer * 4);
});

test('wave events carry rounded spawn points and Tidebreakers, while snapshots stay private', () => {
  const { game, p, events } = setup(3), point = SIDE_EVENTS[0];
  locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
  const waves = () => events.filter(event => event.kind === 'side-event' && event.status === 'active');
  assert.equal(waves().length, 1); assert.equal(waves()[0].wave, 1);
  assert.equal(waves()[0].spawns.length, rosterTotal(sideEventWave(1, 3)));
  release(game, point.id);
  for (const spawn of waves()[0].spawns) {
    assert.deepEqual(Object.keys(spawn).sort(), ['delay', 'type', 'x', 'z']);
    assert.ok(enemiesFor(game, point.id).some(enemy => enemy.type === spawn.type && distance(enemy, spawn) < 0.6));
  }
  killAll(game, point.id, p); ticks(game, 3.1); killAll(game, point.id, p); ticks(game, 3.1);
  assert.equal(waves().length, 3); assert.equal(waves()[2].wave, SIDE_EVENT_WAVES);
  assert.equal(waves()[2].spawns.filter(spawn => spawn.type === 'tidebreaker').length, 2);
  assert.equal(events.filter(event => event.kind === 'notice' && /surging in from the sea/.test(event.message)).length, 1);
  release(game, point.id);
  const snapshot = game.snapshot();
  assert.ok(snapshot.enemies.every(enemy => Object.keys(enemy).every(key => !key.startsWith('_'))));
  assert.ok(snapshot.sideEvents.every(event => !('spawns' in event)));
  assert.ok(snapshot.enemies.some(enemy => enemy.type === 'tidebreaker' && enemy.scale === ENEMY_TYPES.tidebreaker.scale && enemy.attackRadius === ENEMY_TYPES.tidebreaker.attackRadius));
});

// A wave used to land on the supplies as one clump. Ranks must now stream in:
// later ranks stay pending, already counted, and stand spread out on arrival.
test('waves surge rank by rank, counted while pending, with Tidebreakers arriving last', () => {
  for (const point of [SIDE_EVENTS[0], SIDE_EVENTS[1]]) {
    const { game, p, events } = setup(5), event = eventFor(game, point.id);
    locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
    const waves = () => events.filter(item => item.kind === 'side-event' && item.status === 'active');
    for (let wave = 1; wave <= SIDE_EVENT_WAVES; wave++) {
      if (wave > 1) { killAll(game, point.id, p); ticks(game, 3.1); }
      const label = `${point.id} wave ${wave}`, total = rosterTotal(sideEventWave(wave, 5)), spawns = waves()[wave - 1].spawns;
      assert.equal(spawns.length, total, `${label}: the whole roster is announced at once`);
      const delays = spawns.map(spawn => spawn.delay);
      for (const delay of delays) {
        assert.ok(delay >= 0 && delay <= 5 * SIDE_EVENT_RANK_DELAY, `${label}: ${delay}s is inside one surge`);
        assert.ok(Math.abs(delay / SIDE_EVENT_RANK_DELAY - Math.round(delay / SIDE_EVENT_RANK_DELAY)) < 1e-6, `${label}: delays land on rank beats`);
      }
      assert.equal(Math.min(...delays), 0, `${label}: the front rank surges immediately`);
      assert.ok(new Set(delays).size >= 2, `${label}: the roster spans several ranks`);
      const crabs = spawns.filter(spawn => spawn.type === 'crab');
      for (const boss of spawns.filter(spawn => spawn.type === 'tidebreaker')) {
        assert.ok(crabs.every(crab => crab.delay < boss.delay), `${label}: the mini boss lumbers in behind every crab`);
      }
      assert.equal(event.remaining, total, `${label}: ranks still forming up already count as remaining`);
      assert.ok(enemiesFor(game, point.id).length < total, `${label}: later ranks have not surged yet`);
      // Silence the attackers while the wave forms: this measures arrival, and
      // a full wave would otherwise strip the supplies before the last rank.
      for (let step = 0; step < Math.ceil((Math.max(...delays) + 0.1) / 0.05); step++) {
        for (const enemy of enemiesFor(game, point.id)) enemy._nextAttack = Infinity;
        game.tick(0.05);
      }
      assert.equal(enemiesFor(game, point.id).length, total, `${label}: every rank arrived on time`);
      const nearest = nearestNeighbours(spawns), average = nearest.reduce((sum, gap) => sum + gap, 0) / nearest.length;
      assert.ok(average >= 3.6, `${label}: ranks stand spread out, not at the 2.8m minimum (${average.toFixed(1)}m)`);
    }
  }
});

test('unattended surges visibly damage all three supplies and fail with event-only cleanup', () => {
  for (const point of SIDE_EVENTS) {
    const { game, p, events } = setup();
    const unrelated = game.spawnEnemy('crab', 0, 50, 'haven', 'palm');
    locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
    const event = eventFor(game, point.id);
    let waited = 0;
    while (event.integrity === 100 && waited < 20) { game.tick(0.05); waited += 0.05; }
    assert.ok(waited > 3 && waited < 12, `${point.id}: the surge needs a few seconds to cross the sand (${waited.toFixed(1)}s)`);
    assert.ok(event.integrity < 100 && event.integrity > 0, `${point.id}: actual ticks damaged supplies (${event.integrity})`);
    assert.ok(events.some(item => item.kind === 'telegraph' && distance(item, point) < 0.01));
    assert.ok(events.some(item => item.kind === 'splash' && distance(item, point) < 0.01));
    ticks(game, 20);
    assert.equal(event.status, 'failed'); assert.equal(event.integrity, 0); assert.equal(event.remaining, 0);
    assert.equal(enemiesFor(game, point.id).length, 0); assert.ok(game.enemies.has(unrelated.id));
    assert.equal(game.pearls, 0); assert.equal(game.shards, 0); assert.equal(game.phase, 'voyage');
    assert.ok(events.some(item => item.kind === 'notice' && item.message === 'Supplies lost. Your compass quest continues.'));
    locate(p, point); assert.equal(game.action(p.id, 'interact', point.id).ok, false);
    ticks(game, 2); assert.equal(event.status, 'failed');
  }
});

test('Tidebreakers hit supplies harder with a wide swipe, and their pearls and damage follow the archetype', () => {
  const { game, p, events } = setup(), point = SIDE_EVENTS[1];
  locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
  killAll(game, point.id, p); ticks(game, 3.1); killAll(game, point.id, p); ticks(game, 3.1); release(game, point.id);
  const boss = enemiesFor(game, point.id).find(enemy => enemy.type === 'tidebreaker'), event = eventFor(game, point.id);
  assert.ok(boss); assert.equal(boss.hp, ENEMY_TYPES.tidebreaker.hp);
  for (const enemy of enemiesFor(game, point.id)) if (enemy !== boss) game.damageEnemy(enemy, enemy.hp, p.id);
  ticks(game, 22);
  assert.ok(distance(boss, point) <= 3.8, `mini boss reached the supplies (${distance(boss, point).toFixed(1)}m)`);
  const before = event.integrity; assert.ok(before < 100);
  assert.ok(events.some(item => item.kind === 'telegraph' && item.id === boss.id && item.radius === ENEMY_TYPES.tidebreaker.attackRadius && item.style === 'swipe'));
  Object.assign(boss, { state: 'windup', attackAt: game.elapsed, _attack: { x: point.x, z: point.z, radius: boss.attackRadius, sideEvent: point.id } });
  game.tick();
  assert.equal(event.integrity, before - ENEMY_TYPES.tidebreaker.supplyDamage);
  locate(p, { x: boss.x + 3.2, z: boss.z }); p.mode = 'ground'; p.invulnerableUntil = 0; p.hp = 100;
  Object.assign(boss, { state: 'windup', attackAt: game.elapsed, _attack: { x: boss.x, z: boss.z, radius: boss.attackRadius } });
  game.tick();
  assert.equal(p.hp, 100 - ENEMY_TYPES.tidebreaker.damage, 'the wide swipe reaches further than a crab swipe');
  const pearls = game.pearls;
  game.damageEnemy(boss, boss.hp, p.id);
  assert.equal(game.pearls, pearls + ENEMY_TYPES.tidebreaker.pearls);
  assert.ok(events.some(item => item.kind === 'defeated' && item.id === boss.id && item.type === 'tidebreaker'));
});

test('spitters advance to supplies, while walls, elevation and landing protection prevent damage', () => {
  const { game, p } = setup(), point = SIDE_EVENTS[2];
  locate(p, point); game.action(p.id, 'interact', point.id); p.mode = 'aboard';
  killAll(game, point.id, p);
  ticks(game, 3.1); release(game, point.id);
  const [spitter, ...others] = enemiesFor(game, point.id).filter(enemy => enemy.type === 'spitter');
  for (const enemy of enemiesFor(game, point.id)) if (enemy !== spitter) game.damageEnemy(enemy, enemy.hp, p.id);
  assert.ok(spitter && others.length >= 1, 'the second wave carries several spitters');
  const event = eventFor(game, point.id);
  ticks(game, 18);
  assert.ok(distance(spitter, point) <= 3, `spitter reached the supplies (${distance(spitter, point).toFixed(1)}m)`); assert.ok(event.integrity < 100);
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
  release(game, point.id);
  const [crab, ...others] = enemiesFor(game, point.id);
  for (const enemy of others) game.damageEnemy(enemy, enemy.hp, p.id);
  Object.assign(crab, { x: -47, z: 41, y: heightAt(-47, 41), _sideWaypoint: null });
  assert.equal(sideEventPathClear(crab, point), false);
  ticks(game, 15);
  assert.ok(distance(crab, point) < 3, 'navigation returns around the cottage');
  assert.ok(eventFor(game, point.id).integrity < 100);
});

for (const count of [1, 5]) test(`${count}-player shooting defense completes all three waves once without changing the compass quest`, () => {
  const { game, p, events } = setup(count), point = SIDE_EVENTS[0];
  locate(p, point); game.action(p.id, 'interact', point.id);
  const checkpoint = { ...game.checkpoint }, shrines = game.snapshot().shrines;
  const steps = defend(game, point);
  const event = eventFor(game, point.id);
  const rosters = [1, 2, 3].map(wave => sideEventWave(wave, count));
  const kills = rosters.reduce((sum, roster) => sum + rosterTotal(roster), 0);
  const pearls = rosters.reduce((sum, roster) => sum + roster.crab * 3 + roster.spitter * 3 + roster.tidebreaker * ENEMY_TYPES.tidebreaker.pearls, 0) + point.reward;
  assert.equal(event.status, 'completed', `defense completed within ${steps} ticks`); assert.equal(event.wave, SIDE_EVENT_WAVES); assert.equal(event.remaining, 0);
  assert.ok(event.integrity > 0); assert.equal([...game.players.values()].reduce((sum, crew) => sum + crew.kills, 0), kills); assert.equal(game.pearls, pearls);
  assert.ok(steps * 0.05 < SIDE_EVENT_DURATION);
  assert.equal(events.filter(item => item.kind === 'side-event' && item.status === 'completed').length, 1);
  assert.equal(events.find(item => item.kind === 'side-event' && item.status === 'completed').reward, point.reward);
  assert.equal(events.filter(item => item.kind === 'side-event' && item.status === 'active').length, SIDE_EVENT_WAVES);
  assert.deepEqual(game.snapshot().shrines, shrines); assert.deepEqual(game.checkpoint, checkpoint);
  assert.equal(game.shards, 0); assert.equal(game.phase, 'voyage'); assert.equal(game.bossId, null);
  assert.equal(game.action(p.id, 'interact', point.id).ok, false);
  ticks(game, 4); assert.equal(game.pearls, pearls);
});

test('completion heals only nearby alive ground crew and snapshots isolate public state', () => {
  const { game, p } = setup(5), point = SIDE_EVENTS[1];
  locate(p, point); game.action(p.id, 'interact', point.id);
  killAll(game, point.id, p);
  p.mode = 'aboard'; ticks(game, 3.1);
  killAll(game, point.id, p); ticks(game, 3.1);
  const event = eventFor(game, point.id);
  assert.equal(event.wave, SIDE_EVENT_WAVES);
  killAll(game, point.id, p);
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
  assert.equal(eventFor(game, point.id).endsAt, game.elapsed + SIDE_EVENT_DURATION);
  release(game, point.id);
  for (const enemy of enemiesFor(game, point.id)) enemy._nextAttack = Infinity;
  ticks(game, SIDE_EVENT_DURATION - 0.1); assert.equal(eventFor(game, point.id).status, 'active');
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
  assert.equal(enemiesFor(game, point.id).length, 0); assert.equal(game.pearls, 0);
  // The lighthouse now opens with a wave, so the boss arrives only in its own
  // stage; the defense must already be cancelled and its attackers gone.
  assert.equal(game.finale.stage, 1); assert.equal(game.bossId, null);
  p.mode = 'aboard';
  for (let stage = 0; !game.bossId && stage <= FINALE_STAGES.length; stage++) {
    game.releaseSpawns(game.finale, Infinity);
    for (const enemy of [...game.enemies.values()]) if (enemy._finale) game.damageEnemy(enemy, enemy.hp, p.id);
    ticks(game, FINALE_STAGE_DELAY + 0.1);
  }
  assert.equal(game.enemies.get(game.bossId).type, 'tempest');
  game.damageEnemy(game.enemies.get(game.bossId), 10000, p.id);
  // The Tempest hands over to the skycrab siege; the cancelled defense must stay
  // cancelled through it, and only that last stage wins the voyage.
  assert.equal(game.phase, 'finale');
  ticks(game, FINALE_STAGE_DELAY + 0.1);
  assert.equal(game.finale.stage, FINALE_STAGES.length);
  assert.equal(eventFor(game, point.id).status, 'cancelled'); assert.equal(enemiesFor(game, point.id).length, 0);
  finishSkyStage(game, p);
  assert.equal(game.phase, 'victory');
  assert.equal(game.action(p.id, 'restart').ok, true);
  assert.equal(game.finale.stage, 0); assert.equal(game.finale.stages, FINALE_STAGES.length);
  assert.ok(game.sideEvents.every(event => event.status === 'available' && event.wave === 0 && event.startedAt === 0 && event.finishedAt === 0));
  game.action(p.id, 'launch'); locate(p, point); game.action(p.id, 'interact', point.id);
  game.disconnect(p.id, true); game.tick();
  assert.equal(game.phase, 'lobby'); assert.equal(game.enemies.size, 0);
  assert.ok(game.sideEvents.every(event => event.status === 'available' && event.remaining === 0 && event.integrity === 100));
});
