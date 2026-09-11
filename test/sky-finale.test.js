import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, finaleStageSpawns, finaleGroupSpawns } from '../server/game.js';
import { damageSkyBoss, livingSkyBosses, skyCounts } from '../server/sky-finale.js';
import { FINALE_STAGES, FINALE_STAGE_DELAY } from '../shared/finale.js';
import {
  SKY_BOSSES, SKY_COUNTDOWN, SKY_CHECKPOINT, SKY_GROUND_WAVES, SKY_WAVE_GAP, SKY_BOMBARD_WARNING,
  SKY_BOMBARD_RADIUS, SKY_BOMBARD_DAMAGE, SKY_BOMBARD_MAX_ACTIVE, SKY_BOMBARD_FIELD, SKY_SAFE_POCKETS,
  SKY_STATE_FIELDS, SKY_BOSS_FIELDS, SKY_BOMBARD_FIELDS, skyBossHp, skyGroundWave,
  skyBossFiringSolutions, skyInSafePocket,
} from '../shared/sky-finale.js';
import { SHIP_GUNS, GUN_PIVOT_HEIGHT, gunOperator } from '../shared/airship.js';
import { MAX_PLAYERS, COLORS, BEACON, SHIP_DURATION, heightAt, shipAt } from '../shared/world.js';

const SKY = FINALE_STAGES.findIndex(stage => stage.kind === 'airship') + 1;
const ticks = (game, seconds) => { for (let i = 0; i < Math.ceil(seconds / 0.05); i++) game.tick(0.05); };
const stageEnemies = game => [...game.enemies.values()].filter(enemy => enemy._finale === SKY);
const sky = game => game.snapshot().finale.sky;

const locate = (p, point) => Object.assign(p, { x: point.x, z: point.z, y: heightAt(point.x, point.z),
  mode: 'ground', grounded: true, vy: 0, gunId: null });

function board(game, id, gunId = 'gun-port-aft') {
  const p = game.players.get(id), gun = SHIP_GUNS.find(station => station.id === gunId);
  const operator = gunOperator(gun), ship = shipAt(game.elapsed);
  Object.assign(p, { mode: 'aboard', gunId: null, deckX: operator.x, deckZ: operator.z,
    x: ship.x + operator.x, y: ship.y, z: ship.z + operator.z, grounded: true, vy: 0 });
  return p;
}
const mount = (game, id, gunId = 'gun-port-aft') => { board(game, id, gunId); return game.action(id, 'interact', gunId); };

// Reach stage four the way a voyage does: sail, light the beacon with three
// shards, then defeat every earlier stage. The ship is parked well before the
// finale, exactly as it is in a real run.
function skySetup(count = 1) {
  const events = [], game = new Game({ onEvent: event => events.push(event) });
  for (let i = 0; i < count; i++) game.addPlayer(`p${i}`, `Pirate ${i}`, COLORS[i]);
  game.action('p0', 'launch');
  game.enemies.clear();
  const p = game.players.get('p0');
  ticks(game, SHIP_DURATION + 2);
  game.shards = 3; locate(p, BEACON);
  assert.equal(game.action('p0', 'interact', BEACON.id).ok, true);
  for (let guard = 0; guard < FINALE_STAGES.length + 2 && game.finale.stage < SKY; guard++) {
    game.releaseSpawns(game.finale, Infinity);
    for (const enemy of [...game.enemies.values()]) if (enemy._finale) game.damageEnemy(enemy, enemy.hp, 'p0');
    ticks(game, FINALE_STAGE_DELAY + 0.1);
  }
  assert.equal(game.finale.stage, SKY, 'the Tempest advances the battle to the skycrab siege');
  events.length = 0;
  return { game, p, events };
}

const clearGround = (game, sourceId = 'p0') => {
  game.releaseSpawns(game.finale, Infinity);
  for (const enemy of stageEnemies(game)) game.damageEnemy(enemy, enemy.hp, sourceId);
};
const killBosses = (game, sourceId = 'p0') => {
  for (const boss of livingSkyBosses(game)) damageSkyBoss(game, boss.id, boss.hp, sourceId);
};

test('the Tempest opens the skycrab siege instead of winning, and boarding waits for a gunner', () => {
  const { game, p } = skySetup(1);
  assert.equal(game.phase, 'finale'); assert.equal(game.victory, null);
  assert.equal(game.bossId, null, 'the scalar bossId never names a skycrab');
  assert.equal(finaleStageSpawns(SKY, 1), null, 'the airship descriptor is rejected, not spawned as an empty wave');
  assert.deepEqual(game.checkpoint, { ...SKY_CHECKPOINT }, 'downed defenders return to the haven, not the last shrine');
  const state = sky(game);
  assert.deepEqual(Object.keys(game.snapshot().finale).sort(), ['remaining', 'sky', 'stage', 'stages']);
  assert.deepEqual(Object.keys(state).sort(), [...SKY_STATE_FIELDS].sort());
  assert.equal(state.status, 'boarding');
  assert.deepEqual([state.bosses, state.bombardments], [[], []]);
  assert.deepEqual([state.wave, state.waves, state.groundActive, state.groundPending, state.groundFuture],
    [0, SKY_GROUND_WAVES.length, 0, 0, SKY_GROUND_WAVES.length]);
  const planned = SKY_GROUND_WAVES.reduce((sum, wave) => sum + skyGroundWave(wave.index, 1).total, 0);
  assert.equal(game.finale.remaining, SKY_BOSSES.length + planned, 'remaining counts every skycrab and attacker still owed');
  assert.equal(game.snapshot().flyingTargets.length, 0, 'practice flyers leave for the stage');
  // No host, no timer: an empty deck simply waits, and nothing wins or fails.
  ticks(game, 45);
  assert.equal(sky(game).status, 'boarding'); assert.equal(game.phase, 'finale');
  assert.equal(game.enemies.size, 0); assert.equal(game.victory, null);
  assert.equal(game.completeIsland(), null, 'an empty battlefield never completes the island');
  locate(p, BEACON);
  ticks(game, 1);
  assert.equal(sky(game).status, 'boarding', 'a pirate on the ground is not a gunner');
});

test('a mounted gunner latches the countdown, then both skycrabs and the first wave arrive', () => {
  const { game, events } = skySetup(2);
  assert.equal(mount(game, 'p1').ok, true);
  ticks(game, 0.1);
  const counting = sky(game);
  assert.equal(counting.status, 'countdown');
  assert.ok(counting.countdownEndsAt > game.elapsed && counting.countdownEndsAt <= game.elapsed + SKY_COUNTDOWN);
  assert.equal(counting.bosses.length, 0, 'nothing flies until the countdown ends');
  // Stepping away cannot un-latch a fight the crew already opened.
  assert.equal(game.action('p1', 'interact', 'gun-port-aft').ok, true);
  ticks(game, SKY_COUNTDOWN + 0.2);
  const active = sky(game);
  assert.equal(active.status, 'active'); assert.equal(active.countdownEndsAt, 0);
  assert.equal(active.bosses.length, SKY_BOSSES.length);
  assert.equal(active.wave, 1); assert.equal(active.groundFuture, SKY_GROUND_WAVES.length - 1);
  for (const boss of active.bosses) {
    const plan = SKY_BOSSES.find(item => item.id === boss.id);
    assert.ok(plan, 'every boss keeps its authored id');
    assert.deepEqual(Object.keys(boss).sort(), [...SKY_BOSS_FIELDS].sort());
    assert.equal(boss.maxHp, skyBossHp(plan, 2)); assert.equal(boss.hp, boss.maxHp);
    assert.equal(boss.radius, plan.radius); assert.equal(boss.state, 'flying');
    assert.ok(boss.y > shipAt(game.elapsed).y + GUN_PIVOT_HEIGHT, 'boss y is the sphere centre, above the gun deck');
    assert.ok(skyBossFiringSolutions(boss, shipAt(game.elapsed)).length >= 1, `${boss.id} is shootable from a real seat`);
  }
  assert.equal(new Set(active.bosses.map(boss => boss.id)).size, SKY_BOSSES.length);
  const wave = skyGroundWave(1, 2);
  assert.equal(stageEnemies(game).length + game.finale._pending.length, wave.total, 'the whole first wave is on its way');
  assert.ok(stageEnemies(game).every(enemy => enemy.type === 'crab' || enemy.type === 'tidebreaker'));
  assert.ok(events.some(event => event.kind === 'sky-wave' && event.wave === 1 && event.spawns.length === wave.total));
  assert.ok(events.some(event => event.kind === 'notice' && event.message === SKY_GROUND_WAVES[0].notice));
  // The lane is a slow drift, not a teleport, and the two bosses never coincide.
  const before = sky(game).bosses;
  ticks(game, 2);
  const after = sky(game).bosses;
  for (const boss of after) {
    const was = before.find(item => item.id === boss.id);
    const moved = Math.hypot(boss.x - was.x, boss.y - was.y, boss.z - was.z);
    assert.ok(moved > 0.1 && moved < 12, `${boss.id} drifted ${moved.toFixed(2)}m in two seconds`);
  }
  assert.ok(Math.hypot(after[0].x - after[1].x, after[0].z - after[1].z) > 20, 'one lane per broadside');
  // The snapshot hands out copies, never the live encounter.
  const published = sky(game);
  published.bosses[0].hp = 1; published.bosses.push({ id: 'forged' }); published.status = 'cleared';
  const live = sky(game);
  assert.equal(live.bosses.length, SKY_BOSSES.length);
  assert.ok(live.bosses[0].hp > 1); assert.equal(live.status, 'active');
});

test('bombardments telegraph a ring, hurt only eligible ground crew, and die with their boss', () => {
  const { game, p, events } = skySetup(2);
  const gunner = game.players.get('p1');
  mount(game, 'p1');
  ticks(game, SKY_COUNTDOWN + 0.2);
  clearGround(game);
  locate(p, { x: BEACON.x + 1, z: BEACON.z });
  p.hp = 100; p.invulnerableUntil = 0; p._damageAt = game.elapsed;
  const firstDelay = Math.min(...SKY_BOSSES.map(boss => boss.bombard.firstDelay));
  ticks(game, firstDelay + 0.2);
  const shells = sky(game).bombardments;
  assert.equal(shells.length, 1, 'one telegraphed shell at a time');
  const shell = shells[0];
  assert.deepEqual(Object.keys(shell).sort(), [...SKY_BOMBARD_FIELDS].sort());
  assert.ok(shell.id.startsWith('sky-shell-'));
  assert.ok(SKY_BOSSES.some(boss => boss.id === shell.bossId));
  assert.ok(Math.abs(shell.impactAt - shell.launchAt - SKY_BOMBARD_WARNING) < 1e-6, 'the warning is the deadline');
  assert.ok(shell.impactAt > game.elapsed, 'the ring lands in the future, never on arrival');
  assert.ok(Math.hypot(shell.impactX - p.x, shell.impactZ - p.z) <= SKY_BOMBARD_RADIUS, 'it is aimed at the pirate on the dais');
  assert.ok(Math.hypot(shell.impactX - BEACON.x, shell.impactZ - BEACON.z) <= SKY_BOMBARD_FIELD);
  assert.ok(shell.y > shell.impactY + 40, 'the shell launches from the boss, high above its impact');
  const telegraph = events.find(event => event.kind === 'telegraph' && event.id === shell.id);
  assert.ok(telegraph && Math.abs(telegraph.duration - SKY_BOMBARD_WARNING) < 1e-6);
  assert.equal(sky(game).bosses.find(boss => boss.id === shell.bossId).state, 'winding');
  // The aboard gunner is never touched, wherever the shell lands.
  gunner.hp = 100;
  ticks(game, SKY_BOMBARD_WARNING + 0.2);
  assert.equal(p.hp, 100 - SKY_BOMBARD_DAMAGE, 'the pirate who stood still takes the shell');
  assert.equal(gunner.hp, 100, 'no bombardment reaches the deck');
  assert.ok(events.some(event => event.kind === 'splash' && Math.abs(event.x - shell.impactX) < 1e-9));
  assert.ok(sky(game).bombardments.every(item => item.id !== shell.id), 'a resolved shell leaves the snapshot');
  // Dodging works: the ring is fixed at launch, so stepping out of it is safe.
  p.hp = 100; p.invulnerableUntil = 0;
  const next = waitForShell(game);
  locate(p, { x: next.impactX + SKY_BOMBARD_RADIUS + 3, z: next.impactZ });
  ticks(game, SKY_BOMBARD_WARNING + 0.2);
  assert.equal(p.hp, 100, 'the warning ring is a real chance to move');
  // Killing a boss cancels the strike it had in the air. The other skycrab is
  // still shelling the dais, so look for damage credited to the dead one.
  p.invulnerableUntil = 0; p.hp = 100;
  const pending = waitForShell(game);
  locate(p, { x: pending.impactX, z: pending.impactZ });
  damageSkyBoss(game, pending.bossId, 1e9, 'p0');
  assert.ok(sky(game).bombardments.every(item => item.bossId !== pending.bossId), 'its outstanding shells die with it');
  const mark = events.length;
  ticks(game, SKY_BOMBARD_WARNING + 0.5);
  assert.equal(events.slice(mark).some(event => event.kind === 'hit' && event.sourceId === pending.bossId), false,
    'and nothing lands from a dead skycrab');
  assert.equal(sky(game).bosses.some(boss => boss.id === pending.bossId), false, 'a downed skycrab leaves the sky');
});

test('an empty battlefield still draws fire, and the lift pocket shelters an arriving pirate', () => {
  const { game, p } = skySetup(1);
  mount(game, 'p0');
  ticks(game, SKY_COUNTDOWN + 0.2);
  clearGround(game);
  // Nobody is downstairs: the siege keeps shelling the lighthouse anyway.
  const strike = waitForShell(game);
  assert.ok(Math.hypot(strike.impactX - BEACON.x, strike.impactZ - BEACON.z) <= SKY_BOMBARD_FIELD);
  assert.equal(skyInSafePocket({ x: strike.impactX, z: strike.impactZ }), false);
  assert.equal(game.phase, 'finale', 'an absent crew is never a failure');
  // A pirate in the lift pocket is exempt even from a ring that overlaps it.
  const pocket = SKY_SAFE_POCKETS[0];
  game.action('p0', 'interact', 'gun-port-aft');
  locate(p, { x: pocket.x, z: pocket.z });
  p.hp = 100; p.invulnerableUntil = 0; p._damageAt = game.elapsed;
  const aimed = waitForShell(game);
  assert.ok(Math.hypot(aimed.impactX - pocket.x, aimed.impactZ - pocket.z) > pocket.radius,
    'no shell is ever aimed into the pocket');
  ticks(game, SKY_BOMBARD_WARNING + 0.3);
  assert.equal(p.hp, 100, 'arrival safety holds even when a nearby ring overlaps it');
});

function waitForShell(game) {
  for (let step = 0; step < 600; step++) {
    const shells = sky(game).bombardments;
    if (shells.length) return shells[0];
    game.tick(0.05);
  }
  throw new Error('no bombardment was launched');
}

test('three finite waves arrive one at a time, with a gap, and are never refilled', () => {
  const { game, events } = skySetup(3);
  mount(game, 'p0');
  ticks(game, SKY_COUNTDOWN + 0.2);
  const seen = [];
  for (let index = 1; index <= SKY_GROUND_WAVES.length; index++) {
    const plan = skyGroundWave(index, 3);
    assert.equal(sky(game).wave, index);
    assert.equal(sky(game).groundFuture, SKY_GROUND_WAVES.length - index);
    game.releaseSpawns(game.finale, Infinity);
    const live = stageEnemies(game);
    assert.equal(live.length, plan.total, `wave ${index} brings its whole planned roster`);
    assert.ok(live.every(enemy => enemy._finale === SKY && enemy.zone === 'haven'));
    seen.push(...live.map(enemy => enemy.id));
    for (const enemy of live) game.damageEnemy(enemy, enemy.hp, 'p0');
    assert.equal(stageEnemies(game).length, 0);
    if (index === SKY_GROUND_WAVES.length) break;
    ticks(game, SKY_WAVE_GAP - 0.5);
    assert.equal(sky(game).wave, index, 'the next wave waits out the gap');
    assert.equal(game.phase, 'finale', 'and a gap is never mistaken for a cleared stage');
    ticks(game, 0.7);
  }
  assert.equal(new Set(seen).size, seen.length, 'no attacker is ever spawned twice');
  ticks(game, 30);
  assert.equal(stageEnemies(game).length, 0, 'the third wave is the last: nothing refills');
  assert.equal(sky(game).groundFuture, 0);
  assert.equal(game.phase, 'finale'); assert.equal(game.victory, null);
  assert.equal(sky(game).bosses.length, SKY_BOSSES.length, 'the sky is still held');
  assert.ok(game.finale.remaining >= SKY_BOSSES.length);
  assert.equal(events.filter(event => event.kind === 'sky-wave').length, SKY_GROUND_WAVES.length);
});

test('a blocked wave retries with its planned roster instead of advancing or shrinking', () => {
  const { game } = skySetup(1);
  mount(game, 'p0');
  ticks(game, SKY_COUNTDOWN + 0.2);
  clearGround(game);
  const plan = skyGroundWave(2, 1);
  const blocked = game.groundWaveSpawns;
  game.groundWaveSpawns = () => null;
  ticks(game, SKY_WAVE_GAP + 2);
  assert.equal(sky(game).wave, 1, 'a wave that cannot be placed never advances the counter');
  assert.equal(sky(game).groundFuture, SKY_GROUND_WAVES.length - 1);
  assert.equal(game.phase, 'finale'); assert.equal(game.victory, null);
  game.groundWaveSpawns = blocked;
  ticks(game, 1.2);
  assert.equal(sky(game).wave, 2);
  game.releaseSpawns(game.finale, Infinity);
  assert.equal(stageEnemies(game).length, plan.total, 'the planned roster survived the retry intact');
});

test('a blocked first wave waits for its retry deadline instead of hammering every tick', () => {
  const { game } = skySetup(1);
  mount(game, 'p0');
  const real = game.groundWaveSpawns.bind(game), plan = skyGroundWave(1, 1);
  let calls = 0;
  game.groundWaveSpawns = () => { calls++; return null; };
  ticks(game, SKY_COUNTDOWN + 3.2);
  const blocked = sky(game);
  assert.equal(blocked.status, 'active', 'the sky fight still opens');
  assert.equal(blocked.bosses.length, SKY_BOSSES.length);
  assert.equal(blocked.wave, 0); assert.equal(blocked.groundFuture, SKY_GROUND_WAVES.length);
  assert.equal(stageEnemies(game).length, 0);
  assert.ok(calls >= 3 && calls <= 6, `about one attempt a second, not one a tick (${calls})`);
  assert.equal(game.phase, 'finale'); assert.equal(game.victory, null);
  assert.ok(game.finale.remaining >= SKY_BOSSES.length + plan.total, 'a wave that never spawned is still owed');
  // An empty or partial placement is a failed attempt, never a smaller wave.
  game.groundWaveSpawns = () => [];
  ticks(game, 1.3);
  assert.equal(sky(game).wave, 0);
  game.groundWaveSpawns = groups => real(groups).slice(0, 2);
  ticks(game, 1.3);
  assert.equal(sky(game).wave, 0); assert.equal(stageEnemies(game).length, 0, 'a partial roster is rejected whole');
  game.groundWaveSpawns = real;
  ticks(game, 1.3);
  assert.equal(sky(game).wave, 1);
  game.releaseSpawns(game.finale, Infinity);
  assert.equal(stageEnemies(game).length, plan.total, 'and the planned roster finally arrives intact');
});

test('an unstarted wave cannot be erased by nudging a display cursor or the remaining count', () => {
  const { game } = skySetup(1);
  mount(game, 'p0');
  ticks(game, SKY_COUNTDOWN + 0.2);
  clearGround(game);
  killBosses(game);
  game.finale._sky.wave = SKY_GROUND_WAVES.length;
  game.finale._sky.groundFuture = 0;
  game.finale.remaining = 0;
  assert.equal(sky(game).wave, 1, 'the published cursor follows the waves actually placed');
  assert.equal(sky(game).groundFuture, SKY_GROUND_WAVES.length - 1);
  assert.equal(game.completeIsland(), null, 'the waves still to come cannot be forged away');
  assert.equal(game.phase, 'finale'); assert.equal(game.victory, null);
  ticks(game, SKY_WAVE_GAP + 1);
  assert.equal(sky(game).wave, 2, 'and the next wave forms up as planned');
  assert.ok(stageEnemies(game).length + game.finale._pending.length > 0);
});

test('a forged, broken or out-of-range final stage never completes the island', () => {
  const game = new Game({});
  game.addPlayer('p0', 'Pirate', COLORS[0]);
  game.action('p0', 'launch');
  // The exact broken state: the last stage, nothing remaining, no lifecycle.
  game.phase = 'finale'; game.finale.stage = FINALE_STAGES.length;
  game.finale.remaining = 0; game.finale._sky = null;
  assert.equal(game.completeIsland(), null, 'a missing sky lifecycle is broken, not finished');
  assert.equal(game.phase, 'finale'); assert.equal(game.victory, null); assert.equal(game.stats.wins, 0);
  ticks(game, 1);
  assert.equal(game.phase, 'finale', 'and no tick of that state wins either');
  assert.equal(game.snapshot().finale.sky, undefined);
  for (const stage of [0, 1, FINALE_STAGES.length - 1, FINALE_STAGES.length + 1, FINALE_STAGES.length + 3, 1.5, NaN]) {
    game.finale.stage = stage;
    assert.equal(game.completeIsland(), null, `stage ${stage} cannot complete the island`);
  }
  assert.equal(game.stats.wins, 0); assert.equal(game.victory, null);
  // A real, cleared sky stage under a forged stage number is refused as well.
  const live = skySetup(1);
  mount(live.game, 'p0');
  ticks(live.game, SKY_COUNTDOWN + 0.2);
  killBosses(live.game);
  for (let index = 1; index < SKY_GROUND_WAVES.length; index++) { clearGround(live.game); ticks(live.game, SKY_WAVE_GAP + 0.4); }
  live.game.finale.stage = FINALE_STAGES.length - 1;
  assert.equal(live.game.completeIsland(), null, 'the stage must really be the last one in the table');
  assert.equal(live.game.snapshot().finale.sky, undefined, 'and a mislabelled stage publishes no sky block');
  live.game.finale.stage = FINALE_STAGES.length;
  clearGround(live.game);
  assert.equal(live.game.phase, 'victory', 'restored to its real stage, the island completes normally');
});

test('victory tears the sky stage down and keeps only the completion record', () => {
  const { game } = skySetup(1);
  mount(game, 'p0');
  ticks(game, SKY_COUNTDOWN + 0.2);
  assert.ok(sky(game).bosses.length);
  // Any internal route to victory ends the stage, not just the guarded one.
  game.win();
  assert.equal(game.phase, 'victory');
  assert.equal(game.finale._sky, null);
  assert.equal(game.snapshot().finale.sky, undefined);
  assert.deepEqual(Object.keys(game.snapshot().finale).sort(), ['remaining', 'stage', 'stages']);
  assert.equal(game.enemies.size, 0); assert.deepEqual(game.finale._pending, []);
  assert.equal(game.snapshot().enemies.length, 0);
  assert.equal(game.snapshot().flyingTargets.length, 0, 'practice flyers stay out of the victory tableau');
  assert.ok(game.flyingTargets.every(target => target.hp === target.maxHp), 'but are restored for the next voyage');
});

test('the island completes only when both skycrabs and every wave are truly done', () => {
  const { game, p, events } = skySetup(2);
  mount(game, 'p0');
  ticks(game, SKY_COUNTDOWN + 0.2);
  killBosses(game);
  assert.equal(skyCounts(game).bossesRemaining, 0);
  assert.equal(game.phase, 'finale', 'a cleared sky is only half the battle');
  assert.equal(game.completeIsland(), null);
  // Ranks still forming up are not a cleared wave, and neither is a forced count.
  game.finale.remaining = 0;
  assert.equal(game.completeIsland(), null, 'a forced remaining=0 cannot bypass the guard');
  assert.ok(game.finale._pending.length || stageEnemies(game).length);
  for (let index = 1; index <= SKY_GROUND_WAVES.length; index++) {
    clearGround(game);
    if (index < SKY_GROUND_WAVES.length) ticks(game, SKY_WAVE_GAP + 0.4);
  }
  assert.equal(game.phase, 'victory', 'the last wave of a cleared sky secures the island');
  assert.equal(game.victory.pearls, game.pearls);
  assert.equal(game.stats.wins, 1);
  assert.ok(game._completion && game._completion.round === game.round && game._completion.stage === SKY);
  assert.equal(game.finale._sky, null, 'the sky stage is torn down by the victory it earned');
  assert.equal(game.snapshot().finale.sky, undefined);
  assert.deepEqual(game.finale._pending, []);
  assert.equal(game.completeIsland(), null, 'the handoff happens exactly once');
  assert.equal(game.stats.wins, 1);
  assert.equal(events.filter(event => event.kind === 'victory').length, 1);
  assert.equal(game.enemies.size, 0);
  assert.equal(p.gunId, null, 'victory releases the guns');
});

test('the other completion order works too, and a same-tick last kill wins once', () => {
  const { game, events } = skySetup(1);
  mount(game, 'p0');
  ticks(game, SKY_COUNTDOWN + 0.2);
  for (let index = 1; index <= SKY_GROUND_WAVES.length; index++) {
    clearGround(game);
    if (index < SKY_GROUND_WAVES.length) ticks(game, SKY_WAVE_GAP + 0.4);
  }
  assert.equal(sky(game).groundFuture, 0);
  assert.equal(game.phase, 'finale', 'the ground alone does not win');
  const bosses = livingSkyBosses(game);
  assert.equal(bosses.length, SKY_BOSSES.length);
  damageSkyBoss(game, bosses[0].id, bosses[0].hp, 'p0');
  assert.equal(game.phase, 'finale');
  damageSkyBoss(game, bosses[1].id, bosses[1].hp, 'p0');
  assert.equal(game.phase, 'victory', 'the last kill completes the island in the same call');
  assert.equal(game.stats.wins, 1);
  assert.equal(events.filter(event => event.kind === 'victory').length, 1);
  assert.equal(events.filter(event => event.kind === 'defeated' && event.type === 'skycrab').length, SKY_BOSSES.length);
  assert.equal(damageSkyBoss(game, bosses[0].id, 50, 'p0'), null, 'a dead skycrab cannot be killed twice');
  assert.equal(game.players.get('p0').kills >= SKY_BOSSES.length, true);
});

test('downed defenders revive on the haven row, even with offline characters still reserved', () => {
  const { game } = skySetup(MAX_PLAYERS);
  // Two pirates drop out but keep their reserved characters, then two more join:
  // the players Map is now longer than the authored revive row.
  game.disconnect('p3'); game.disconnect('p4');
  assert.ok(game.addPlayer('late-1', 'Late', COLORS[0]));
  assert.ok(game.addPlayer('late-2', 'Later', COLORS[1]));
  assert.ok(game.players.size > MAX_PLAYERS && game.onlineCount === MAX_PLAYERS);
  mount(game, 'p0');
  ticks(game, SKY_COUNTDOWN + 0.2);
  const late = game.players.get('late-2');
  const state = sky(game);
  assert.equal(state.status, 'active');
  assert.equal(state.wave, 1, 'a late joiner reads the fight in progress from one snapshot');
  const pocket = SKY_SAFE_POCKETS[0];
  for (const id of ['p1', 'p2', 'late-1', 'late-2']) {
    const crew = game.players.get(id);
    locate(crew, { x: BEACON.x + 6, z: BEACON.z + 6 });
    crew.invulnerableUntil = 0; crew.hp = 1;
    game.damagePlayer(crew, 50, 'test');
    assert.ok(crew.knockedUntil > 0);
    ticks(game, 8.2);
    assert.equal(crew.knockedUntil, 0, `${id} auto-revives`);
    assert.equal(crew.hp, 65); assert.ok(crew.invulnerableUntil > game.elapsed);
    assert.equal(crew.mode, 'ground');
    assert.ok(skyInSafePocket(crew), `${id} revives inside the arrival pocket`);
    assert.ok(Math.hypot(crew.x - pocket.x, crew.z - pocket.z) <= 1.6 + 1e-9);
  }
  assert.ok(late.hp > 0);
  assert.equal(game.phase, 'finale', 'downs never lose encounter progress');
  assert.equal(sky(game).wave, 1);
});

test('restarting and abandoning the round leave no skycrab, shell or hidden practice flyer behind', () => {
  const { game } = skySetup(1);
  mount(game, 'p0');
  ticks(game, SKY_COUNTDOWN + 0.2);
  killBosses(game);
  for (let index = 1; index <= SKY_GROUND_WAVES.length; index++) {
    clearGround(game);
    if (index < SKY_GROUND_WAVES.length) ticks(game, SKY_WAVE_GAP + 0.4);
  }
  assert.equal(game.phase, 'victory');
  assert.equal(game.action('p0', 'restart').ok, true);
  assert.equal(game.phase, 'lobby');
  assert.equal(game.finale.stage, 0); assert.equal(game.finale.remaining, 0);
  assert.equal(game.finale._sky, null); assert.equal(game._completion, null);
  assert.equal(game.snapshot().finale.sky, undefined, 'no sky block outside the stage');
  assert.deepEqual(Object.keys(game.snapshot().finale).sort(), ['remaining', 'stage', 'stages']);
  assert.deepEqual(game.finale._pending, []);
  assert.equal(game.enemies.size, 0);
  game.action('p0', 'launch');
  ticks(game, 1);
  assert.ok(game.snapshot().flyingTargets.length > 0, 'practice gunnery returns with the next voyage');
  const abandoned = skySetup(1);
  abandoned.game.disconnect('p0', true);
  abandoned.game.tick();
  assert.equal(abandoned.game.phase, 'lobby');
  assert.equal(abandoned.game.finale._sky, null);
  assert.equal(abandoned.game.enemies.size, 0);
  assert.equal(abandoned.game.flyingTargets.every(target => target.hp === target.maxHp), true);
});

test('sky-stage spawns reuse the shared stage formation rather than a second geometry', () => {
  const plan = skyGroundWave(3, MAX_PLAYERS);
  const spawns = finaleGroupSpawns(plan.groups, []);
  assert.equal(spawns.length, plan.total);
  assert.ok(spawns.every(spawn => spawn.zone === 'haven' && spawn.delay >= 0));
  assert.ok(spawns.some(spawn => spawn.type === 'tidebreaker'));
  assert.deepEqual([...new Set(spawns.map(spawn => spawn.from))].sort(), [...new Set(plan.groups.map(group => group.from))].sort());
  assert.ok(new Set(spawns.map(spawn => spawn.delay)).size > 1, 'ranks and directions still stagger');
  assert.equal(finaleGroupSpawns(null, []), null);
  assert.equal(finaleGroupSpawns(plan.groups, 'nope'), null);
  assert.equal(finaleGroupSpawns(plan.groups, [{ x: NaN, z: 0 }]), null);
  assert.equal(finaleGroupSpawns([{ from: 'nowhere', crab: 1, spitter: 0, tidebreaker: 0 }], []), null);
  assert.ok(SKY_BOMBARD_MAX_ACTIVE <= SKY_BOSSES.length);
});
