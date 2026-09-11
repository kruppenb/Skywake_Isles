import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { livingSkyBosses, skyCounts } from '../server/sky-finale.js';
import { FINALE_STAGES, FINALE_STAGE_DELAY } from '../shared/finale.js';
import { SKY_BOSSES, SKY_COUNTDOWN, SKY_GROUND_WAVES, SKY_WAVE_GAP, skyBossHp } from '../shared/sky-finale.js';
import { SHIP_GUNS, GUN_DAMAGE, GUN_COOLDOWN, GUN_RANGE, GUN_PIVOT_HEIGHT, gunOperator, gunMuzzle, raySphereSurface } from '../shared/airship.js';
import { COLORS, BEACON, SHIP_DURATION, heightAt, shipAt } from '../shared/world.js';
import { hasWorldLineOfSight } from '../shared/collision.js';

// Cannon-to-skycrab targeting through the ordinary mount/aim/fire actions. No
// client module is imported here: only shared geometry and the server.
const SKY = FINALE_STAGES.findIndex(stage => stage.kind === 'airship') + 1;
const ticks = (game, seconds) => { for (let i = 0; i < Math.ceil(seconds / 0.05); i++) game.tick(0.05); };
const stageEnemies = game => [...game.enemies.values()].filter(enemy => enemy._finale === SKY);
const sky = game => game.snapshot().finale.sky;
const seqs = new Map();

const locate = (p, point) => Object.assign(p, { x: point.x, z: point.z, y: heightAt(point.x, point.z),
  mode: 'ground', grounded: true, vy: 0, gunId: null });

function mount(game, id, gunId) {
  const p = game.players.get(id), gun = SHIP_GUNS.find(station => station.id === gunId);
  const operator = gunOperator(gun), ship = shipAt(game.elapsed);
  Object.assign(p, { mode: 'aboard', gunId: null, deckX: operator.x, deckZ: operator.z,
    x: ship.x + operator.x, y: ship.y, z: ship.z + operator.z, grounded: true, vy: 0 });
  return game.action(id, 'interact', gunId);
}

// The pose a client can compute from the snapshot alone: the mounted pirate
// stands at the operator spot, so the pivot is one gun offset outboard of them.
function gunPivot(p) {
  const gun = SHIP_GUNS.find(station => station.id === p.gunId), operator = gunOperator(gun);
  return { x: p.x + (gun.x - operator.x), y: p.y + GUN_PIVOT_HEIGHT, z: p.z + (gun.z - operator.z) };
}

// Aim the way a player does: an ordinary input packet, clamped by the server.
function aim(game, p, point) {
  const pivot = gunPivot(p);
  const dx = point.x - pivot.x, dy = point.y - pivot.y, dz = point.z - pivot.z;
  const seq = (seqs.get(p.id) ?? 0) + 1; seqs.set(p.id, seq);
  return game.setInput(p.id, { seq, forward: 0, right: 0, jump: false, sprint: false,
    yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
}

function skySetup(count = 1) {
  const events = [], game = new Game({ onEvent: event => events.push(event) });
  for (let i = 0; i < count; i++) game.addPlayer(`p${i}`, `Pirate ${i}`, COLORS[i]);
  game.action('p0', 'launch');
  game.enemies.clear();
  seqs.clear();
  const p = game.players.get('p0');
  ticks(game, SHIP_DURATION + 2);
  game.shards = 3; locate(p, BEACON);
  assert.equal(game.action('p0', 'interact', BEACON.id).ok, true);
  for (let guard = 0; guard < FINALE_STAGES.length + 2 && game.finale.stage < SKY; guard++) {
    game.releaseSpawns(game.finale, Infinity);
    for (const enemy of [...game.enemies.values()]) if (enemy._finale) game.damageEnemy(enemy, enemy.hp, 'p0');
    ticks(game, FINALE_STAGE_DELAY + 0.1);
  }
  assert.equal(game.finale.stage, SKY);
  return { game, p, events };
}

// Open the fight: mount, run the countdown out and return the live bosses.
function openSky(count = 1, gunId = 'gun-port-aft') {
  const fixture = skySetup(count);
  assert.equal(mount(fixture.game, 'p0', gunId).ok, true);
  ticks(fixture.game, SKY_COUNTDOWN + 0.2);
  assert.equal(sky(fixture.game).status, 'active');
  return fixture;
}

const bossOn = (game, side) => {
  const ship = shipAt(game.elapsed);
  return livingSkyBosses(game).find(boss => (boss.x < ship.x) === (side === 'port'));
};
const shots = (events, playerId) => events.filter(event => event.kind === 'shot' && event.weapon === 'cannon' && event.playerId === playerId);

// Take each broadside in turn and shoot that lane's skycrab down for real.
function downSky(game, p) {
  for (const gunId of ['gun-port-aft', 'gun-starboard-aft']) {
    if (!livingSkyBosses(game).length) break;
    const boss = bossOn(game, gunId.includes('port') ? 'port' : 'starboard');
    if (!boss) continue;
    if (p.gunId !== gunId) {
      if (p.gunId) assert.equal(game.action(p.id, 'interact', p.gunId).ok, true);
      assert.equal(mount(game, p.id, gunId).ok, true);
    }
    p._targetId = boss.id;
    assert.equal(shootUntil(game, p, () => !livingSkyBosses(game).some(item => item.id === boss.id)), true,
      `${boss.id} was shot down from ${gunId}`);
  }
}

// Fire whenever the station is off cooldown, re-aiming at the moving boss.
function shootUntil(game, p, done, seconds = 90) {
  const station = game.shipGuns.find(item => item.id === p.gunId);
  for (let step = 0; step < seconds / 0.05; step++) {
    if (done()) return true;
    const boss = livingSkyBosses(game).find(item => item.id === p._targetId) ?? livingSkyBosses(game)[0];
    if (boss && game.elapsed + 1e-8 >= station.readyAt) { aim(game, p, boss); game.action(p.id, 'fire'); }
    game.tick(0.05);
  }
  return done();
}

test('a gunner’s own aim hits a skycrab, and a barrel pointed anywhere else misses', () => {
  const { game, p, events } = openSky(1, 'gun-port-aft');
  const boss = bossOn(game, 'port');
  assert.ok(boss, 'the port lane boss is the one this seat can reach');
  const before = boss.hp;
  assert.equal(before, skyBossHp(SKY_BOSSES.find(item => item.id === boss.id), 1));
  assert.equal(aim(game, p, boss).ok, true);
  assert.equal(game.action('p0', 'fire').ok, true);
  const shot = shots(events, 'p0').at(-1);
  assert.equal(shot.hitId, boss.id); assert.equal(shot.damage, GUN_DAMAGE);
  assert.equal(shot.gunId, 'gun-port-aft');
  assert.equal(boss.hp, before - GUN_DAMAGE, 'the lifecycle applied the damage exactly once');
  const hits = events.filter(event => event.kind === 'hit' && event.targetId === boss.id);
  assert.equal(hits.length, 1); assert.equal(hits[0].damage, GUN_DAMAGE); assert.equal(hits[0].sourceId, 'p0');
  assert.equal(events.some(event => event.kind === 'target-down'), false, 'a skycrab is never a practice target');
  // The shot is on the wire before its consequences.
  assert.ok(events.indexOf(shot) < events.indexOf(hits[0]));
  // Nothing is hit while the station is reloading, and no event is invented.
  const fired = shots(events, 'p0').length;
  assert.equal(game.action('p0', 'fire').ok, true);
  assert.equal(shots(events, 'p0').length, fired, 'a shot inside the cooldown is simply not taken');
  assert.equal(boss.hp, before - GUN_DAMAGE);
  ticks(game, GUN_COOLDOWN + 0.1);
  // A barrel pointed away from the lane misses: nothing steers it onto a boss.
  const away = { x: boss.x, y: boss.y, z: boss.z };
  aim(game, p, away); p.yaw += Math.PI; p.pitch = 0.4;
  assert.equal(game.action('p0', 'fire').ok, true);
  const miss = shots(events, 'p0').at(-1);
  assert.equal(miss.hitId, undefined); assert.equal(miss.damage, undefined);
  assert.equal(boss.hp, before - GUN_DAMAGE, 'a miss costs the skycrab nothing');
  ticks(game, GUN_COOLDOWN + 0.1);
  // The far broadside cannot swing round to it either.
  const other = game.addPlayer('p1', 'Second', COLORS[1]);
  assert.equal(mount(game, 'p1', 'gun-starboard-aft').ok, true);
  const portBoss = bossOn(game, 'port');
  aim(game, other, portBoss);
  assert.equal(game.action('p1', 'fire').ok, true);
  assert.equal(shots(events, 'p1').at(-1).hitId, undefined, 'the starboard gun clamps away from a port-lane skycrab');
  // And a boss beyond cannon range is out of reach even when aimed at dead on.
  ticks(game, GUN_COOLDOWN + 0.1);
  const far = bossOn(game, 'port');
  const kept = { x: far.x, z: far.z };
  far.x -= GUN_RANGE + 40;
  aim(game, p, far);
  assert.equal(game.action('p0', 'fire').ok, true);
  assert.equal(shots(events, 'p0').at(-1).hitId, undefined, 'GUN_RANGE still bounds a cannon shot');
  Object.assign(far, kept);
  // Every hit this stage takes is one the world can actually see.
  const gun = SHIP_GUNS.find(station => station.id === 'gun-port-aft');
  const { from, direction } = gunMuzzle(gun, shipAt(game.elapsed), p.yaw, p.pitch);
  const surface = raySphereSurface(from, direction, { ...boss, radius: boss.radius });
  if (surface !== null) {
    const point = { x: from.x + direction.x * surface, y: from.y + direction.y * surface, z: from.z + direction.z * surface };
    assert.equal(hasWorldLineOfSight(from, point), true, 'the lanes are clear of every island prop');
  }
});

test('practice flyers stay out of the boss fight and come back with the next voyage', () => {
  const { game, p, events } = openSky(1, 'gun-port-aft');
  assert.equal(game.snapshot().flyingTargets.length, 0);
  assert.ok(game.flyingTargets.every(target => target.hp === 0), 'the eight practice crabs are inert');
  for (const target of game.flyingTargets) {
    ticks(game, GUN_COOLDOWN + 0.05);
    aim(game, p, { x: target.x, y: target.y, z: target.z });
    game.action('p0', 'fire');
  }
  assert.equal(events.some(event => event.kind === 'target-down'), false);
  assert.equal(shots(events, 'p0').some(shot => shot.hitId?.startsWith('flying-crab')), false,
    'no cannon shot can find a practice crab during the siege');
  // Finish the island, replay, and the practice range is back exactly as before.
  downSky(game, p);
  for (let index = 1; index <= SKY_GROUND_WAVES.length; index++) {
    game.releaseSpawns(game.finale, Infinity);
    for (const enemy of stageEnemies(game)) game.damageEnemy(enemy, enemy.hp, 'p0');
    if (index < SKY_GROUND_WAVES.length) ticks(game, SKY_WAVE_GAP + 0.4);
  }
  assert.equal(game.phase, 'victory');
  assert.equal(game.action('p0', 'restart').ok, true);
  assert.equal(game.action('p0', 'launch').ok, true);
  ticks(game, SHIP_DURATION + 1);
  assert.ok(game.flyingTargets.every(target => target.hp === target.maxHp));
  assert.ok(game.snapshot().flyingTargets.length > 0);
  assert.equal(mount(game, 'p0', 'gun-port-aft').ok, true);
  const gunner = game.players.get('p0');
  // The practice flyers orbit the whole ship, so try each one this broadside
  // can bear on; at least one ordinary shot must land as it always did.
  let practice = null;
  for (const target of game.flyingTargets) {
    ticks(game, GUN_COOLDOWN + 0.05);
    aim(game, gunner, target);
    assert.equal(game.action('p0', 'fire').ok, true);
    const shot = shots(events, 'p0').at(-1);
    if (shot.hitId === target.id) { practice = target; break; }
  }
  assert.ok(practice, 'ordinary practice gunnery behaves exactly as before');
  assert.equal(practice.hp, practice.maxHp - GUN_DAMAGE);
  assert.ok(events.some(event => event.kind === 'hit' && event.targetId === practice.id));
});

test('the station cooldown survives a seat change, and only its real occupant may fire it', () => {
  const { game, events } = openSky(2, 'gun-port-aft');
  const p = game.players.get('p0'), other = game.players.get('p1');
  const boss = bossOn(game, 'port');
  aim(game, p, boss); game.action('p0', 'fire');
  assert.equal(shots(events, 'p0').length, 1);
  const station = game.shipGuns.find(item => item.id === 'gun-port-aft');
  assert.ok(station.readyAt > game.elapsed);
  // p0 leaves the seat; the gun itself is still reloading for whoever takes it.
  assert.equal(game.action('p0', 'interact', 'gun-port-aft').ok, true);
  assert.equal(mount(game, 'p1', 'gun-port-aft').ok, true);
  aim(game, other, boss); game.action('p1', 'fire');
  assert.equal(shots(events, 'p1').length, 0, 'a new gunner inherits the station cooldown');
  // A forged seat, an empty-handed press and a dismounted pirate are all refused.
  const forged = game.players.get('p0');
  forged.gunId = 'gun-port-aft';
  assert.equal(game.fireCannon(forged).code, 'NOT_MOUNTED', 'claiming an occupied gun fires nothing');
  forged.gunId = 'gun-starboard-fore';
  assert.equal(game.fireCannon(forged).code, 'NOT_MOUNTED', 'a seat nobody sat in fires nothing');
  forged.gunId = null;
  assert.equal(game.action('p0', 'fire').ok, false, 'an unmounted pirate aboard has no cannon');
  assert.equal(shots(events, 'p0').length, 1);
  // Standing away from the seat cannot fire it either.
  assert.equal(mount(game, 'p0', 'gun-starboard-fore').ok, true);
  forged.x += 6;
  assert.equal(game.fireCannon(forged).code, 'TOO_FAR');
  // Nor can a cannon fire outside a voyage.
  const phase = game.phase; game.phase = 'victory';
  assert.equal(game.fireCannon(game.players.get('p1')).code, 'NOT_MOUNTED');
  game.phase = phase;
});

test('cannon fire downs a skycrab once, cancels its shells, and still waits for the ground', () => {
  const { game, p, events } = openSky(1, 'gun-port-aft');
  const target = bossOn(game, 'port'), earlierKills = p.kills;
  p._targetId = target.id;
  const down = shootUntil(game, p, () => !livingSkyBosses(game).some(boss => boss.id === target.id));
  assert.equal(down, true, 'the port lane boss was shot down from its own broadside');
  const defeated = events.filter(event => event.kind === 'defeated' && event.id === target.id);
  assert.equal(defeated.length, 1, 'exactly one defeat, exactly once');
  assert.equal(defeated[0].type, 'skycrab');
  assert.equal(p.kills, earlierKills + 1, 'the gunner is credited once');
  assert.equal(game.pearls >= SKY_BOSSES.find(item => item.id === target.id).pearls, true);
  const pearls = game.pearls;
  assert.ok(sky(game).bombardments.every(shell => shell.bossId !== target.id), 'its shells left with it');
  assert.equal(skyCounts(game).bossesRemaining, 1);
  // A further shot cannot find or re-kill it.
  const fired = shots(events, 'p0').length;
  ticks(game, GUN_COOLDOWN + 0.1);
  aim(game, p, target); game.action('p0', 'fire');
  assert.equal(shots(events, 'p0').at(-1).hitId, undefined);
  assert.ok(shots(events, 'p0').length > fired);
  assert.equal(events.filter(event => event.kind === 'defeated' && event.id === target.id).length, 1);
  assert.equal(game.pearls, pearls, 'and pays nothing a second time');
  // Down the second skycrab too: a cleared sky is still not a won island.
  assert.equal(game.action('p0', 'interact', 'gun-port-aft').ok, true);
  assert.equal(mount(game, 'p0', 'gun-starboard-aft').ok, true);
  p._targetId = null;
  assert.equal(shootUntil(game, p, () => livingSkyBosses(game).length === 0), true, 'both skycrabs fall to real cannon fire');
  assert.equal(skyCounts(game).bossesRemaining, 0);
  assert.equal(game.phase, 'finale', 'the ground waves still have to be fought');
  assert.ok(game.finale.remaining > 0);
  assert.equal(p.kills, earlierKills + 2, 'both skycrabs paid their credit, once each');
  // Finishing the ground now secures the island exactly once.
  for (let index = skyCounts(game).wave; index <= SKY_GROUND_WAVES.length; index++) {
    game.releaseSpawns(game.finale, Infinity);
    for (const enemy of stageEnemies(game)) game.damageEnemy(enemy, enemy.hp, 'p0');
    if (index < SKY_GROUND_WAVES.length) ticks(game, SKY_WAVE_GAP + 0.4);
  }
  assert.equal(game.phase, 'victory');
  assert.equal(events.filter(event => event.kind === 'victory').length, 1);
  assert.equal(events.filter(event => event.kind === 'defeated' && event.type === 'skycrab').length, SKY_BOSSES.length);
  // Victory order: every cannon shot was published before the win it caused.
  const last = events.findIndex(event => event.kind === 'victory');
  assert.ok(events.slice(0, last).some(event => event.kind === 'shot' && event.weapon === 'cannon'));
});

test('a boss the gunner never aimed at is never hit by someone else’s shot', () => {
  const { game, events } = openSky(2, 'gun-port-aft');
  const starboard = game.players.get('p1');
  assert.equal(mount(game, 'p1', 'gun-starboard-aft').ok, true);
  const portBoss = bossOn(game, 'port'), starboardBoss = bossOn(game, 'starboard');
  assert.notEqual(portBoss.id, starboardBoss.id);
  const before = portBoss.hp;
  aim(game, starboard, starboardBoss);
  assert.equal(game.action('p1', 'fire').ok, true);
  assert.equal(shots(events, 'p1').at(-1).hitId, starboardBoss.id);
  assert.equal(portBoss.hp, before, 'each broadside only reaches its own lane');
  assert.equal(starboardBoss.hp, starboardBoss.maxHp - GUN_DAMAGE);
});
