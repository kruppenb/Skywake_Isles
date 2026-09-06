import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, finaleStageSpawns, sideEventPathClear, sideEventStandingClear } from '../server/game.js';
import { FINALE_STAGES, FINALE_STAGE_DELAY, FINALE_FRONT, FINALE_ELITE_FRONT, FINALE_ARC, FINALE_DIRECTION_DELAY, shardBearing, finaleStageRoster } from '../shared/finale.js';
import { SIDE_EVENT_RANK_SPACING, SIDE_EVENT_RANK_STAGGER, SIDE_EVENT_RANK_DELAY } from '../shared/side-events.js';
import { ENEMY_TYPES } from '../shared/enemies.js';
import { MAX_PLAYERS, BEACON, SHRINES, COLORS, heightAt } from '../shared/world.js';

// Stage numbers are indexes into the shared table, never literals: appending a
// fourth stage must not force every assertion in this file to be renumbered.
const stageNumber = id => FINALE_STAGES.findIndex(stage => stage.id === id) + 1;
const CRABS = stageNumber('crabs'), ELITES = stageNumber('elites');
const BOSS = FINALE_STAGES.findIndex(stage => stage.kind === 'boss') + 1;

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ticks = (game, seconds) => { for (let i = 0; i < Math.ceil(seconds / 0.05); i++) game.tick(0.05); };
const locate = (p, point) => Object.assign(p, { x: point.x, z: point.z, y: heightAt(point.x, point.z), mode: 'ground', grounded: true, vy: 0 });
const stageEnemies = game => [...game.enemies.values()].filter(enemy => enemy._finale);
const bearingOffset = (bearing, spawn) => {
  const delta = Math.atan2(spawn.z - BEACON.z, spawn.x - BEACON.x) - bearing;
  return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
};

function setup(count = 1) {
  const events = [], game = new Game({ onEvent: event => events.push(event) });
  for (let i = 0; i < count; i++) game.addPlayer(`p${i}`, `Pirate ${i}`, COLORS[i]);
  game.action('p0', 'launch');
  game.enemies.clear();
  return { game, p: game.players.get('p0'), events };
}

function lightBeacon(game, p) {
  game.shards = 3; locate(p, BEACON);
  assert.equal(game.action(p.id, 'interact', BEACON.id).ok, true);
}

// Materialise the ranks still marching in, then defeat the whole stage.
function clearStage(game, p) {
  game.releaseSpawns(game.finale, Infinity);
  for (const enemy of stageEnemies(game)) game.damageEnemy(enemy, enemy.hp, p.id);
}

test('every finale stage is a named roster that scales with the crew that lit the beacon', () => {
  assert.equal(FINALE_STAGES.at(-1).kind, 'boss');
  assert.ok(CRABS >= 1 && ELITES > CRABS && BOSS === FINALE_STAGES.length);
  for (const stage of FINALE_STAGES) for (const key of ['id', 'kind', 'name', 'unit', 'objective', 'banner', 'notice']) {
    assert.equal(typeof stage[key], 'string', `${stage.id} describes its ${key}`);
  }
  for (let count = 1; count <= MAX_PLAYERS; count++) {
    const roster = finaleStageRoster(CRABS, count);
    assert.equal(roster.tempest, 0);
    assert.deepEqual(roster.groups.map(group => group.from), SHRINES.map(shrine => shrine.id));
    for (const group of roster.groups) {
      assert.equal(group.crab, 3 + count - 1, `crew ${count} faces one extra crab per shard direction per pirate`);
      assert.equal(group.tidebreaker, 0); assert.equal(group.spitter, 0);
    }
  }
  assert.deepEqual([1, 2, 3, 4, 5].map(count => finaleStageRoster(ELITES, count).groups.reduce((sum, group) => sum + group.tidebreaker, 0)), [2, 3, 3, 4, 4]);
  for (let count = 1; count <= MAX_PLAYERS; count++) {
    const elites = finaleStageRoster(ELITES, count).groups.map(group => group.tidebreaker);
    assert.ok(Math.max(...elites) - Math.min(...elites) <= 1, 'Tidebreakers are dealt round-robin across the shrines');
  }
  assert.deepEqual(finaleStageRoster(BOSS, 1), { tempest: 1, groups: [] });
  for (const args of [[0, 1], [FINALE_STAGES.length + 1, 1], [1.5, 1], [1, 0], [1, MAX_PLAYERS + 1], [1, NaN]]) {
    assert.equal(finaleStageRoster(...args), null);
  }
});

test('stage waves form on each shard bearing, spread, walkable and delayed direction by direction', () => {
  for (const count of [1, 5]) {
    const roster = finaleStageRoster(CRABS, count), spawns = finaleStageSpawns(CRABS, count);
    const total = roster.groups.reduce((sum, group) => sum + group.crab, 0);
    assert.equal(spawns.length, total, `crew ${count}: the whole roster is placed`);
    assert.ok(spawns.every(spawn => spawn.type === 'crab' && spawn.zone === 'haven'));
    for (const spawn of spawns) {
      const shrine = SHRINES.find(item => item.id === spawn.from);
      assert.ok(shrine, 'every attacker marches from the direction of a shrine');
      assert.ok(bearingOffset(shardBearing(shrine), spawn) <= FINALE_ARC + Math.PI / 30, `crew ${count}: ${spawn.from} attackers keep to their arc`);
      const out = distance(spawn, BEACON);
      assert.ok(out >= FINALE_FRONT - 2.5 && out <= FINALE_FRONT + 3 * SIDE_EVENT_RANK_SPACING + SIDE_EVENT_RANK_STAGGER + 20.5,
        `crew ${count}: a crab forms up ${out.toFixed(1)}m from the lighthouse`);
      assert.equal(sideEventStandingClear(spawn, 0.85), true, 'attackers stand clear of props');
      if (spawn.waypoint) {
        assert.ok(sideEventPathClear(spawn, spawn.waypoint) && sideEventPathClear(spawn.waypoint, BEACON), 'both legs of a routed approach are clear');
      } else assert.equal(sideEventPathClear(spawn, BEACON), true, 'a direct approach is clear');
    }
    for (const spawn of spawns) for (const other of spawns) {
      if (other !== spawn) assert.ok(distance(spawn, other) >= 2.8, `crew ${count}: attackers never share a spot`);
    }
    for (let direction = 0; direction < roster.groups.length; direction++) {
      const delays = spawns.filter(spawn => spawn.from === roster.groups[direction].from).map(spawn => spawn.delay);
      assert.equal(Math.min(...delays), direction * FINALE_DIRECTION_DELAY, `crew ${count}: direction ${direction} surges after the one before it`);
      for (const delay of delays) {
        const rank = (delay - direction * FINALE_DIRECTION_DELAY) / SIDE_EVENT_RANK_DELAY;
        assert.ok(rank >= 0 && Math.abs(rank - Math.round(rank)) < 1e-6, `crew ${count}: ${delay}s is a rank beat behind its direction`);
      }
      if (count === MAX_PLAYERS) assert.ok(new Set(delays).size >= 3, 'a full crew is charged by three ranks per direction');
    }
  }
  const elites = finaleStageSpawns(ELITES, 5);
  assert.equal(elites.length, 4);
  assert.ok(elites.every(spawn => spawn.type === 'tidebreaker'));
  for (const spawn of elites) {
    const out = distance(spawn, BEACON);
    assert.ok(out >= FINALE_ELITE_FRONT - 2.5 && out <= FINALE_ELITE_FRONT + 3 * SIDE_EVENT_RANK_SPACING + SIDE_EVENT_RANK_STAGGER + 20.5,
      `a Tidebreaker starts ${out.toFixed(1)}m out, closer than the crabs`);
    for (const other of elites) if (other !== spawn) assert.ok(distance(spawn, other) >= 3.6, 'mini bosses need their own room');
  }
  const boss = finaleStageSpawns(BOSS, 1);
  assert.deepEqual(boss, [{ type: 'tempest', x: BEACON.x, z: BEACON.z - 16, zone: 'haven', delay: 0 }]);
  for (const args of [[0, 1], [FINALE_STAGES.length + 1, 1], [1.5, 1], [1, 0], [1, MAX_PLAYERS + 1], [1, NaN], [1, 1, 'nope'], [1, 1, [{ x: NaN, z: 0 }]]]) {
    assert.equal(finaleStageSpawns(...args), null);
  }
});

test('lighting the beacon opens the first stage with a public snapshot, one event and its notice', () => {
  const { game, p, events } = setup(3);
  lightBeacon(game, p);
  assert.equal(game.phase, 'finale'); assert.equal(game.bossId, null);
  const total = finaleStageRoster(CRABS, 3).groups.reduce((sum, group) => sum + group.crab, 0);
  assert.equal(total, 15);
  const finale = game.snapshot().finale;
  assert.deepEqual(Object.keys(finale).sort(), ['remaining', 'stage', 'stages']);
  assert.equal(finale.stage, CRABS); assert.equal(finale.stages, FINALE_STAGES.length); assert.equal(finale.remaining, total);
  const announced = events.filter(event => event.kind === 'finale');
  assert.equal(announced.length, 1);
  assert.equal(announced[0].stage, CRABS); assert.equal(announced[0].stages, FINALE_STAGES.length);
  assert.equal(announced[0].spawns.length, total);
  for (const spawn of announced[0].spawns) {
    assert.deepEqual(Object.keys(spawn).sort(), ['delay', 'from', 'type', 'x', 'z']);
    assert.ok(SHRINES.some(shrine => shrine.id === spawn.from));
    for (const key of ['x', 'z', 'delay']) assert.equal(spawn[key], Math.round(spawn[key] * 10) / 10, `${key} is rounded for the wire`);
  }
  assert.equal(events[events.indexOf(announced[0]) + 1].kind, 'notice');
  assert.equal(events[events.indexOf(announced[0]) + 1].message, FINALE_STAGES[CRABS - 1].notice);
  assert.ok(game.enemies.size < total, 'the later ranks are still forming up');
  for (const spawn of announced[0].spawns.filter(item => item.delay === 0)) {
    assert.ok([...game.enemies.values()].some(enemy => enemy.type === spawn.type && distance(enemy, spawn) < 0.6));
  }
  p.mode = 'aboard'; ticks(game, 10);
  const attackers = stageEnemies(game);
  assert.equal(attackers.length, total, 'every rank has surged in by its delay');
  for (const enemy of attackers) {
    assert.equal(enemy._finale, CRABS); assert.equal(enemy.type, 'crab'); assert.equal(enemy.hp, ENEMY_TYPES.crab.hp);
  }
  assert.ok(game.snapshot().enemies.every(enemy => Object.keys(enemy).every(key => !key.startsWith('_'))));
});

test('cleared stages advance after a pause, ending with the Tempest Crab and a synchronous victory', () => {
  const { game, p, events } = setup(5);
  lightBeacon(game, p); p.mode = 'aboard';
  assert.equal(game.finale.stage, CRABS);
  clearStage(game, p);
  assert.equal(game.finale.remaining, 0); assert.equal(game.phase, 'finale');
  ticks(game, FINALE_STAGE_DELAY - 0.1);
  assert.equal(game.finale.stage, CRABS, 'the next stage waits out the pause');
  ticks(game, 0.2);
  assert.equal(game.finale.stage, ELITES);
  game.releaseSpawns(game.finale, Infinity);
  const elites = stageEnemies(game);
  assert.equal(elites.length, 4);
  for (const elite of elites) {
    assert.equal(elite.type, 'tidebreaker');
    assert.equal(elite.hp, ENEMY_TYPES.tidebreaker.hp + ENEMY_TYPES.tidebreaker.hpPerExtraPlayer * 4);
  }
  const announced = events.filter(event => event.kind === 'finale');
  assert.equal(announced.length, 2); assert.equal(announced[1].stage, ELITES);
  assert.ok(events.some(event => event.kind === 'notice' && event.message === FINALE_STAGES[ELITES - 1].notice));
  clearStage(game, p);
  ticks(game, FINALE_STAGE_DELAY + 0.1);
  assert.equal(game.finale.stage, BOSS); assert.equal(game.enemies.size, 1);
  const boss = game.enemies.get(game.bossId);
  assert.equal(boss.type, 'tempest');
  assert.equal(boss.maxHp, ENEMY_TYPES.tempest.hp + ENEMY_TYPES.tempest.hpPerExtraPlayer * 4);
  assert.ok(events.some(event => event.kind === 'notice' && event.message === FINALE_STAGES[BOSS - 1].notice));
  game.damageEnemy(boss, 10000, p.id);
  assert.equal(game.phase, 'victory', 'the last kill of the last stage wins in the same call');
  assert.equal(game.finale.stage, BOSS); assert.equal(game.finale.remaining, 0); assert.equal(game.stats.wins, 1);
  assert.equal(game.action(p.id, 'restart').ok, true);
  assert.equal(game.finale.stage, 0); assert.equal(game.finale.stages, FINALE_STAGES.length);
});

test('stage attackers gather on the lighthouse dais and swipe at the crew defending it', () => {
  const { game, p, events } = setup(1);
  lightBeacon(game, p); p.mode = 'aboard';
  game.releaseSpawns(game.finale, Infinity);
  const attackers = stageEnemies(game);
  assert.equal(attackers.length, 9);
  ticks(game, 30);
  for (const enemy of attackers) {
    assert.ok(game.enemies.has(enemy.id));
    assert.ok(distance(enemy, BEACON) <= 5, `${enemy.id} reached the dais (${distance(enemy, BEACON).toFixed(1)}m)`);
    assert.notEqual(enemy.state, 'chase', 'nobody is chasing an aboard pirate');
  }
  locate(p, { x: BEACON.x + 2, z: BEACON.z }); p.invulnerableUntil = 0; p.hp = 100; p._damageAt = game.elapsed;
  ticks(game, 4);
  assert.ok(p.hp < 100, `the gathered crabs fight for the dais (${p.hp} hp)`);
  assert.ok(events.some(event => event.kind === 'telegraph' && attackers.some(enemy => enemy.id === event.id)));
});

test('boss minions leave with the Tempest Crab instead of holding its stage open', () => {
  const { game, p } = setup(1);
  lightBeacon(game, p); p.mode = 'aboard';
  for (let stage = 0; !game.bossId && stage <= FINALE_STAGES.length; stage++) {
    clearStage(game, p);
    ticks(game, FINALE_STAGE_DELAY + 0.1);
  }
  const boss = game.enemies.get(game.bossId);
  assert.equal(boss.type, 'tempest');
  locate(p, { x: boss.x, z: boss.z + 7 }); p.invulnerableUntil = Infinity;
  ticks(game, 13);
  const minions = [...game.enemies.values()].filter(enemy => enemy._bossMinion);
  assert.ok(minions.length >= 1, 'the boss summons tide crabs of its own');
  assert.ok(minions.every(minion => !minion._finale), 'summoned crabs never count toward the stage roster');
  game.damageEnemy(boss, 10000, p.id);
  assert.equal(game.phase, 'victory'); assert.equal(game.enemies.size, 0);
});

test('a hand-set finale phase without a stage is inert, and abandoning resets the battle', () => {
  const { game, events } = setup(1);
  game.phase = 'finale';
  ticks(game, 5);
  assert.equal(events.some(event => event.kind === 'finale'), false);
  assert.equal(game.enemies.size, 0); assert.equal(game.phase, 'finale');
  assert.equal(game.finale.stage, 0); assert.equal(game.victory, null);
  const abandoned = setup(1);
  lightBeacon(abandoned.game, abandoned.p);
  assert.ok(abandoned.game.finale._pending.length > 0, 'later directions are still queued');
  abandoned.game.disconnect('p0', true); abandoned.game.tick();
  assert.equal(abandoned.game.phase, 'lobby'); assert.equal(abandoned.game.enemies.size, 0);
  assert.equal(abandoned.game.finale.stage, 0); assert.equal(abandoned.game.finale.remaining, 0);
  assert.deepEqual(abandoned.game.finale._pending, []);
});
