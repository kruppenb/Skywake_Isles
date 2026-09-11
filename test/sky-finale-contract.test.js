import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKY_STAGE_ID, SKY_STAGE_KIND, SKY_STATUSES, SKY_COUNTDOWN,
  SKY_BOSSES, SKY_BOSS_STATES, SKY_BOSS_DOWN_LINGER, skyBossHp, skyBossPose, skyBossPathSamples,
  skyBossReachableFromGun, skyBossFiringSolutions,
  SKY_BOMBARD_WARNING, SKY_BOMBARD_LINGER, SKY_BOMBARD_RADIUS, SKY_BOMBARD_HEIGHT,
  SKY_BOMBARD_MAX_ACTIVE, SKY_BOMBARD_MAX_PER_BOSS, SKY_BOMBARD_FIELD, SKY_SAFE_POCKETS,
  SKY_CHECKPOINT, SKY_REVIVE_SLOTS, SKY_REVIVE_SLOT_SPACING, skyInSafePocket,
  skyBombardInterval, skyBombardSchedule, skyBombardAllowed, skyBombardHits,
  SKY_WAVE_GAP, SKY_WAVE_MAX_UNITS, SKY_GROUND_WAVES, skyGroundWave, skyStageCleared,
  SKY_STATE_FIELDS, SKY_BOSS_FIELDS, SKY_BOMBARD_FIELDS,
} from '../shared/sky-finale.js';
import { FINALE_STAGES, finaleStageRoster } from '../shared/finale.js';
import { SHIP_GUNS, GUN_RANGE, GUN_PIVOT_HEIGHT, AIRSHIP_RETURNS, RETURN_RANGE, gunAim, gunMuzzle } from '../shared/airship.js';
import { MAX_PLAYERS, SHIP_DURATION, BEACON, SHRINES, shipAt, heightAt } from '../shared/world.js';
import { hasWorldLineOfSight, resolveWorldCollision } from '../shared/collision.js';
import { ENEMY_TYPES } from '../shared/enemies.js';

// Data and pure helpers only. The authoritative lifecycle (WP-2), cannon
// damage (WP-3) and presentation (WP-4) are verified in their own suites.
const PARKED = shipAt(SHIP_DURATION + 10);
const TRAVERSE_LIMIT = 1.25;
const relativeYaw = (yaw, gun) => Math.abs(Math.atan2(Math.sin(yaw - gun.yaw), Math.cos(yaw - gun.yaw)));
const gunOf = id => SHIP_GUNS.find(gun => gun.id === id);

// Every pose worth arguing about: a dense sweep of a full lap plus the exact
// extremes of the sway, run and rise terms, which a sample grid can step over.
function laneSamples(boss, samples = 512) {
  const path = boss.path, times = [];
  for (let index = 0; index < samples; index++) times.push(path.period * index / samples);
  const at = theta => ((theta / (Math.PI * 2) - path.phase) % 1 + 1) % 1 * path.period;
  for (let quarter = 0; quarter < 4; quarter++) times.push(at(quarter * Math.PI / 2));
  for (let beat = 0; beat < path.riseCycles * 2; beat++) {
    times.push(at((Math.PI / 2 + beat * Math.PI - path.riseOffset) / path.riseCycles));
  }
  return times.map(time => ({ time, pose: { ...skyBossPose(boss, time, PARKED), radius: boss.radius } }));
}

test('the finale table ends with the skycrab siege and an explicit airship descriptor', () => {
  const last = FINALE_STAGES.at(-1), sky = FINALE_STAGES.length;
  assert.equal(last.id, SKY_STAGE_ID); assert.equal(last.kind, SKY_STAGE_KIND);
  assert.equal(FINALE_STAGES.filter(stage => stage.kind === SKY_STAGE_KIND).length, 1);
  assert.equal(FINALE_STAGES[sky - 2].kind, 'boss', 'the Tempest still fights the stage before it');
  for (const key of ['id', 'kind', 'name', 'unit', 'objective', 'banner', 'notice']) assert.equal(typeof last[key], 'string');
  for (let count = 1; count <= MAX_PLAYERS; count++) {
    assert.deepEqual(finaleStageRoster(sky, count), { kind: 'airship', bossCount: 2, groundWaveCount: 3 });
  }
  const roster = finaleStageRoster(sky, 1);
  assert.equal(roster.bossCount, SKY_BOSSES.length); assert.equal(roster.groundWaveCount, SKY_GROUND_WAVES.length);
  assert.equal('groups' in roster, false, 'an airship stage is never an empty ground roster');
  assert.equal('tempest' in roster, false);
  for (const args of [[sky, 0], [sky, MAX_PLAYERS + 1], [sky + 1, 1], [sky, 1.5]]) {
    assert.equal(finaleStageRoster(...args), null);
  }
});

test('each skycrab flies a slow closed lane on its own broadside, above the gun deck', () => {
  assert.equal(SKY_BOSSES.length, 2);
  assert.deepEqual(SKY_BOSSES.map(boss => boss.id), ['skycrab-port', 'skycrab-starboard']);
  assert.deepEqual(SKY_BOSSES.map(boss => boss.side), ['port', 'starboard']);
  assert.equal(new Set(SKY_BOSSES.map(boss => boss.path.period)).size, 2, 'the two lanes never march in lockstep');
  for (const boss of SKY_BOSSES) {
    const path = boss.path;
    assert.ok(Number.isInteger(path.riseCycles) && path.riseCycles >= 1, 'the altitude beat closes with the lap');
    assert.equal(Math.sign(path.x), boss.side === 'port' ? -1 : 1);
    assert.ok(Math.abs(path.x) - path.sway >= 20, 'the lane never drifts onto the ship axis');
    let maxSpeed = 0, minSpeed = Infinity;
    for (const { time, pose } of laneSamples(boss)) {
      assert.ok(Math.sign(pose.x - PARKED.x) === (boss.side === 'port' ? -1 : 1));
      assert.ok(pose.y >= PARKED.y + GUN_PIVOT_HEIGHT + 1, `${boss.id} stays above the gun pivot (${pose.y.toFixed(1)})`);
      assert.ok(pose.y - heightAt(pose.x, pose.z) > 40, 'a skycrab never dips toward the terrain');
      assert.ok(Math.hypot(pose.x - BEACON.x, pose.z - BEACON.z) > 20, 'neither boss hovers over the lighthouse');
      assert.ok(Number.isFinite(pose.yaw));
      const step = 0.02, next = skyBossPose(boss, time + step, PARKED);
      const speed = Math.hypot(next.x - pose.x, next.y - pose.y, next.z - pose.z) / step;
      maxSpeed = Math.max(maxSpeed, speed); minSpeed = Math.min(minSpeed, speed);
      // Forward is (-sin yaw, -cos yaw): the heading tracks the lap tangent.
      const forward = { x: -Math.sin(pose.yaw), z: -Math.cos(pose.yaw) };
      const travel = Math.hypot(next.x - pose.x, next.z - pose.z);
      assert.ok(((next.x - pose.x) * forward.x + (next.z - pose.z) * forward.z) / travel > 0.99, 'a skycrab faces the way it flies');
    }
    assert.ok(maxSpeed <= 5, `${boss.id} drifts slowly (${maxSpeed.toFixed(2)} m/s)`);
    assert.ok(minSpeed > 0.5, 'and never parks mid-lane');
    for (const time of [0, 7.5, 19, 31.25]) {
      const here = skyBossPose(boss, time, PARKED), lap = skyBossPose(boss, time + path.period, PARKED);
      for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(here[axis] - lap[axis]) < 1e-9, 'the lane is a closed cycle');
    }
    const samples = skyBossPathSamples(boss, PARKED, 32);
    assert.equal(samples.length, 33);
    assert.ok(Math.hypot(samples[0].x - samples[32].x, samples[0].z - samples[32].z) < 1e-9);
  }
  assert.equal(skyBossPose(SKY_BOSSES[0], NaN, PARKED), null);
  assert.equal(skyBossPose(SKY_BOSSES[0], 0, { x: 0, y: NaN, z: 0 }), null);
  assert.equal(skyBossPose(null, 0, PARKED), null);
  assert.equal(skyBossPathSamples(SKY_BOSSES[0], PARKED, 1), null);
});

test('every authored lane sample and extremum is reachable from a real deck gun', () => {
  // The parked ship is the only pose the sky stage ever sees, and the beacon is
  // dead astern of it, in the gap between the broadside arcs.
  for (const elapsed of [SHIP_DURATION, SHIP_DURATION + 60, 600]) assert.deepEqual(shipAt(elapsed), PARKED);
  assert.equal(skyBossFiringSolutions({ x: BEACON.x, y: PARKED.y + 8, z: BEACON.z, radius: 5 }, PARKED).length, 0,
    'a boss over the lighthouse would sit in the astern dead zone');
  assert.equal(skyBossFiringSolutions({ x: PARKED.x, y: PARKED.y + 6, z: PARKED.z + 40, radius: 5 }, PARKED).length, 0);
  for (const boss of SKY_BOSSES) {
    const side = boss.side === 'port' ? -1 : 1;
    let worstTraverse = 0, worstMiss = 0, farthest = 0, nearest = Infinity, fewestSeats = SHIP_GUNS.length;
    for (const { time, pose } of laneSamples(boss)) {
      const solutions = skyBossFiringSolutions(pose, PARKED);
      assert.ok(solutions.length >= 2, `${boss.id} at t=${time.toFixed(2)} is covered by at least two seats`);
      fewestSeats = Math.min(fewestSeats, solutions.length);
      for (const solution of solutions) {
        const gun = gunOf(solution.gunId);
        assert.equal(Math.sign(gun.x), side, 'only the boss’s own broadside claims the shot');
        assert.ok(solution.distance <= GUN_RANGE, 'inside the cannon’s reach');
        assert.ok(solution.pitch >= 0 && solution.pitch <= 0.8, 'no shot is depressed through the hull');
        worstTraverse = Math.max(worstTraverse, relativeYaw(solution.yaw, gun));
        // Nothing on the island stands between the muzzle and a skycrab.
        assert.equal(hasWorldLineOfSight(gunMuzzle(gun, PARKED, solution.yaw, solution.pitch).from, pose), true);
      }
      const best = solutions.reduce((a, b) => (a.miss <= b.miss ? a : b));
      worstMiss = Math.max(worstMiss, best.miss);
      farthest = Math.max(farthest, best.distance); nearest = Math.min(nearest, best.distance);
      const easiest = Math.min(...solutions.map(solution => relativeYaw(solution.yaw, gunOf(solution.gunId))));
      assert.ok(easiest <= TRAVERSE_LIMIT - 0.1, `${boss.id} at t=${time.toFixed(2)} keeps traverse headroom (${easiest.toFixed(3)})`);
    }
    assert.ok(worstMiss < 0.01, `${boss.id} is aimed dead on, never grazed by a clamped barrel (${worstMiss})`);
    assert.ok(worstTraverse < TRAVERSE_LIMIT, `${boss.id} stays inside the traverse clamp (${worstTraverse.toFixed(3)})`);
    assert.ok(farthest <= GUN_RANGE - 40, `${boss.id} keeps range headroom (${farthest.toFixed(1)}m)`);
    assert.ok(nearest >= 15, `${boss.id} never crowds the deck (${nearest.toFixed(1)}m)`);
    assert.ok(fewestSeats >= 2);
  }
});

test('the reachability predicate is the cannon’s own nearest-sphere test, not a widened arc', () => {
  const boss = SKY_BOSSES[0], pose = { ...skyBossPose(boss, 11, PARKED), radius: boss.radius };
  const solution = skyBossReachableFromGun(pose, gunOf('gun-port-aft'), PARKED);
  assert.ok(solution && solution.gunId === 'gun-port-aft');
  // Replay server/game.js fireCannon with the solution's aim and hit the sphere.
  const gun = gunOf('gun-port-aft');
  const aim = gunAim(gun, solution.yaw, solution.pitch);
  assert.ok(Math.abs(aim.yaw - solution.yaw) < 1e-9 && Math.abs(aim.pitch - solution.pitch) < 1e-9, 'the solution survives the clamps');
  const { from, direction } = gunMuzzle(gun, PARKED, solution.yaw, solution.pitch);
  const x = pose.x - from.x, y = pose.y - from.y, z = pose.z - from.z;
  const along = x * direction.x + y * direction.y + z * direction.z;
  const discriminant = pose.radius ** 2 - (x * x + y * y + z * z - along * along);
  assert.ok(discriminant >= 0, 'the shot intersects the hit sphere');
  assert.ok(Math.abs((along - Math.sqrt(discriminant)) - solution.distance) < 1e-9, 'and at the reported surface distance');
  assert.ok(Math.abs(solution.clearance - (pose.radius - solution.miss)) < 1e-12);
  // The opposite broadside cannot swing round to it, and no seat reaches past
  // GUN_RANGE or through the deck.
  for (const id of ['gun-starboard-fore', 'gun-starboard-aft']) assert.equal(skyBossReachableFromGun(pose, gunOf(id), PARKED), null);
  assert.equal(skyBossReachableFromGun({ x: PARKED.x - 200, y: PARKED.y + 8, z: PARKED.z, radius: 4.6 }, gun, PARKED), null);
  assert.equal(skyBossReachableFromGun({ x: PARKED.x - 30, y: PARKED.y - 40, z: PARKED.z, radius: 4.6 }, gun, PARKED), null,
    'a target under the hull is below the depression clamp');
  for (const args of [[null, gun, PARKED], [pose, null, PARKED], [pose, gun, null],
    [{ ...pose, x: NaN }, gun, PARKED], [pose, gun, { x: 0, y: 0, z: NaN }]]) {
    assert.equal(skyBossReachableFromGun(...args), null);
  }
  assert.deepEqual(skyBossFiringSolutions(pose, PARKED, 'nope'), []);
  const sorted = skyBossFiringSolutions(pose, PARKED);
  assert.deepEqual(sorted.map(item => item.distance), [...sorted.map(item => item.distance)].sort((a, b) => a - b));
});

test('skycrab health and bombardment cadence stay in a tuned, capped band', () => {
  for (const boss of SKY_BOSSES) {
    const solo = skyBossHp(boss, 1), full = skyBossHp(boss, MAX_PLAYERS);
    assert.equal(solo, boss.hp);
    assert.ok(full > solo && full <= solo * 1.8, `${boss.id} scales modestly (${solo} -> ${full})`);
    assert.ok(solo >= 600 && full <= 1500, 'no sponge, no pushover');
    for (let count = 1; count < MAX_PLAYERS; count++) assert.ok(skyBossHp(boss, count + 1) > skyBossHp(boss, count));
    // Two skycrabs are a longer fight than the Tempest, not an order more.
    assert.ok(full < (ENEMY_TYPES.tempest.hp + ENEMY_TYPES.tempest.hpPerExtraPlayer * (MAX_PLAYERS - 1)) * 1.2);
    for (const args of [[boss, 0], [boss, MAX_PLAYERS + 1], [boss, 2.5], [null, 1]]) assert.equal(skyBossHp(...args), null);
    const fresh = skyBombardInterval(boss, 1), hurt = skyBombardInterval(boss, boss.bombard.rage / 2), dying = skyBombardInterval(boss, 0);
    assert.equal(fresh, boss.bombard.interval);
    assert.equal(dying, boss.bombard.fastInterval);
    assert.ok(hurt < fresh && hurt > dying, 'cadence tightens gradually as health falls');
    assert.equal(skyBombardInterval(boss, 4), boss.bombard.interval, 'out-of-range fractions clamp, never invert');
    assert.equal(skyBombardInterval(boss, -1), boss.bombard.fastInterval);
    assert.ok(boss.bombard.fastInterval > SKY_BOMBARD_WARNING + 1, 'a warning always resolves before the next shell');
    assert.ok(boss.bombard.firstDelay >= SKY_BOMBARD_WARNING, 'nobody is shelled the instant the stage starts');
    assert.equal(skyBombardInterval(null, 1), null);
    assert.equal(skyBombardInterval(boss, NaN), null);
  }
});

test('bombardments are telegraphed, bounded, and never reach the deck or the lift pocket', () => {
  assert.equal(SKY_BOMBARD_MAX_ACTIVE, SKY_BOSSES.length * SKY_BOMBARD_MAX_PER_BOSS);
  assert.ok(SKY_BOMBARD_MAX_ACTIVE <= 3, 'the snapshot array stays small enough to read');
  assert.ok(SKY_BOMBARD_WARNING >= 2.5, 'a running pirate can clear the ring');
  const schedule = skyBombardSchedule(40);
  assert.deepEqual(schedule, { launchAt: 40, impactAt: 40 + SKY_BOMBARD_WARNING, expiresAt: 40 + SKY_BOMBARD_WARNING + SKY_BOMBARD_LINGER });
  assert.ok(schedule.expiresAt > schedule.impactAt, 'an impact lingers only long enough to be drawn');
  assert.equal(skyBombardSchedule('soon'), null);
  const pocket = SKY_SAFE_POCKETS[0], lift = AIRSHIP_RETURNS.find(point => point.id === 'airship-return-haven');
  assert.equal(SKY_SAFE_POCKETS.length, 1);
  assert.deepEqual({ x: pocket.x, z: pocket.z }, { x: lift.x, z: lift.z }, 'the pocket is the haven lift itself');
  assert.equal(pocket.radius, RETURN_RANGE, 'one lift interaction range wide, no more');
  assert.equal(skyBombardAllowed(BEACON), true, 'the dais itself is fair game');
  assert.equal(skyBombardAllowed(pocket), false);
  assert.equal(skyBombardAllowed({ x: pocket.x + pocket.radius - 0.5, z: pocket.z }), false);
  assert.equal(skyBombardAllowed({ x: pocket.x + pocket.radius + 2, z: pocket.z }), true, 'the pocket is arrival safety, not an immune field');
  assert.ok(pocket.radius < SKY_BOMBARD_RADIUS + 1 && SKY_BOMBARD_FIELD > 30, 'the pocket never shelters the battlefield');
  for (const shrine of SHRINES) assert.equal(skyBombardAllowed(shrine), false, 'shells stay on the lighthouse battlefield');
  assert.equal(skyBombardAllowed({ x: BEACON.x, z: NaN }), false);
  const impact = { x: BEACON.x, y: heightAt(BEACON.x, BEACON.z), z: BEACON.z };
  assert.equal(skyBombardHits(impact, { ...impact, x: impact.x + SKY_BOMBARD_RADIUS - 0.2 }), true);
  assert.equal(skyBombardHits(impact, { ...impact, x: impact.x + SKY_BOMBARD_RADIUS + 0.2 }), false);
  assert.equal(skyBombardHits(impact, { ...impact, y: impact.y + SKY_BOMBARD_HEIGHT + 0.1 }), false, 'no damage through elevation');
  assert.equal(skyBombardHits(impact, { ...impact, y: PARKED.y }), false, 'and never up to the deck');
  assert.equal(skyBombardHits(impact, null), false);
  // A legal impact just outside the pocket still overlaps its edge: standing in
  // the pocket is its own exemption, and only that pocket.
  const edge = { x: pocket.x + pocket.radius + 0.4, y: heightAt(pocket.x, pocket.z), z: pocket.z };
  assert.equal(skyBombardAllowed(edge), true);
  assert.ok(Math.hypot(edge.x - pocket.x, edge.z - pocket.z) - SKY_BOMBARD_RADIUS < pocket.radius, 'its ring reaches into the pocket');
  const sheltered = { x: pocket.x + pocket.radius - 0.3, y: edge.y, z: pocket.z };
  assert.ok(Math.hypot(sheltered.x - edge.x, sheltered.z - edge.z) < SKY_BOMBARD_RADIUS, 'a pirate there is inside the ring');
  assert.equal(skyInSafePocket(sheltered), true);
  assert.equal(skyBombardHits(edge, sheltered), false, 'but arrival safety exempts the pirate, not just the shell');
  assert.equal(skyBombardHits(edge, { ...sheltered, x: pocket.x + pocket.radius + 0.3 }), true, 'one step out of the pocket is fair game again');
  assert.equal(skyInSafePocket({ x: BEACON.x, z: BEACON.z }), false);
  assert.equal(skyInSafePocket(null), false);
});

test('the stage-entry checkpoint lands the whole revive row in the arrival pocket', () => {
  const pocket = SKY_SAFE_POCKETS[0];
  assert.equal(SKY_REVIVE_SLOTS, MAX_PLAYERS);
  assert.deepEqual(SKY_CHECKPOINT, { x: 4.4, z: 9 });
  // Game.revive() places slot n at (checkpoint.x + 2 + n*0.8, checkpoint.z + 3).
  for (let slot = 0; slot < SKY_REVIVE_SLOTS; slot++) {
    const spot = { x: SKY_CHECKPOINT.x + 2 + slot * SKY_REVIVE_SLOT_SPACING, z: SKY_CHECKPOINT.z + 3 };
    const settled = resolveWorldCollision({ ...spot, y: heightAt(spot.x, spot.z) }, 0.6);
    assert.ok(Math.hypot(settled.x - spot.x, settled.z - spot.z) < 1e-9, `slot ${slot} needs no collision push`);
    assert.ok(heightAt(spot.x, spot.z) > 3, `slot ${slot} stands on the haven, not in the water`);
    assert.ok(skyInSafePocket(spot), `slot ${slot} revives inside the arrival pocket`);
    assert.ok(Math.hypot(spot.x - pocket.x, spot.z - pocket.z) <= 1.6 + 1e-9, `slot ${slot} arrives beside the lift`);
    assert.equal(skyBombardAllowed(spot), false, 'and no shell is ever aimed at it');
  }
  // The row is authored for MAX_PLAYERS seats only. Game.revive() indexes the
  // whole players Map, which can run past that when offline characters are
  // still reserved, so WP-2 must clamp the sky-stage slot to 0..MAX_PLAYERS-1:
  // an unclamped index walks straight out of the pocket.
  const slotAt = slot => ({ x: SKY_CHECKPOINT.x + 2 + slot * SKY_REVIVE_SLOT_SPACING, z: SKY_CHECKPOINT.z + 3 });
  const escapes = Array.from({ length: 16 }, (_, slot) => slot).find(slot => !skyInSafePocket(slotAt(slot)));
  assert.ok(Number.isInteger(escapes), 'an unclamped slot index does leave the pocket');
  assert.ok(escapes >= SKY_REVIVE_SLOTS, `every authored slot is safe, but slot ${escapes} is not`);
});

test('three finite ground waves march the shrine roads, bounded for every crew size', () => {
  assert.equal(SKY_GROUND_WAVES.length, 3);
  assert.deepEqual(SKY_GROUND_WAVES.map(wave => wave.index), [1, 2, 3]);
  assert.equal(SKY_GROUND_WAVES[0].gap, 0, 'the first wave forms as the countdown ends');
  for (const wave of SKY_GROUND_WAVES.slice(1)) assert.equal(wave.gap, SKY_WAVE_GAP);
  for (let count = 1; count <= MAX_PLAYERS; count++) {
    let stageTotal = 0;
    for (let index = 1; index <= SKY_GROUND_WAVES.length; index++) {
      const wave = skyGroundWave(index, count);
      assert.equal(wave.index, index);
      assert.equal(typeof wave.id, 'string'); assert.equal(typeof wave.name, 'string'); assert.equal(typeof wave.notice, 'string');
      assert.deepEqual(wave.groups.map(group => group.from), SHRINES.map(shrine => shrine.id));
      const units = wave.groups.map(group => group.crab + group.spitter + group.tidebreaker);
      assert.equal(wave.total, units.reduce((sum, value) => sum + value, 0));
      assert.ok(wave.total >= 3 && wave.total <= SKY_WAVE_MAX_UNITS, `crew ${count} wave ${index} brings ${wave.total} attackers`);
      assert.ok(Math.max(...units) - Math.min(...units) <= 1, 'extras are dealt round robin across the shrine roads');
      for (const group of wave.groups) for (const unit of ['crab', 'spitter', 'tidebreaker']) {
        assert.ok(Number.isInteger(group[unit]) && group[unit] >= 0 && Object.hasOwn(ENEMY_TYPES, unit));
      }
      // Only the classes the finale already fields: no new ground vocabulary.
      assert.equal(wave.groups.reduce((sum, group) => sum + group.spitter, 0), 0, 'the sky stage never fields spitters');
      assert.ok(wave.groups.reduce((sum, group) => sum + group.crab, 0) >= 3, 'every wave still leads with crabs');
      stageTotal += wave.total;
    }
    assert.ok(stageTotal >= 12 && stageTotal <= 26, `crew ${count} faces ${stageTotal} ground attackers in all, and no more arrive`);
  }
  const elites = index => skyGroundWave(index, 1).groups.reduce((sum, group) => sum + group.tidebreaker, 0);
  assert.deepEqual([elites(1), elites(2), elites(3)], [0, 1, 1], 'armour escalates wave by wave, solo included');
  assert.ok(skyGroundWave(3, MAX_PLAYERS).groups.reduce((sum, group) => sum + group.tidebreaker, 0) <= 3);
  assert.ok(skyGroundWave(1, MAX_PLAYERS).total > skyGroundWave(1, 1).total, 'a bigger crew is met by a bigger wave');
  for (const args of [[0, 1], [SKY_GROUND_WAVES.length + 1, 1], [1, 0], [1, MAX_PLAYERS + 1], [1.5, 1], [1, NaN]]) {
    assert.equal(skyGroundWave(...args), null);
  }
});

test('the sky stage clears only when setup, both bosses and every queued rank are done', () => {
  const done = { status: 'active', bossesRemaining: 0, wave: SKY_GROUND_WAVES.length, waves: SKY_GROUND_WAVES.length,
    groundActive: 0, groundPending: 0, groundFuture: 0 };
  assert.equal(skyStageCleared(done), true);
  assert.equal(skyStageCleared({ ...done, waves: undefined }), true, 'waves defaults to the authored count');
  // The guard runs while the stage is active; completeIsland() latches cleared
  // afterwards, so asking it again once latched must not re-enter the handoff.
  for (const status of ['boarding', 'countdown', 'cleared']) {
    assert.equal(skyStageCleared({ ...done, status }), false, `${status} never wins on an empty battlefield`);
  }
  assert.equal(skyStageCleared({ ...done, bossesRemaining: 1 }), false);
  assert.equal(skyStageCleared({ ...done, wave: SKY_GROUND_WAVES.length - 1 }), false, 'a wave that has not formed yet holds the stage open');
  assert.equal(skyStageCleared({ ...done, wave: 0 }), false);
  assert.equal(skyStageCleared({ ...done, groundActive: 2 }), false);
  assert.equal(skyStageCleared({ ...done, groundPending: 1 }), false, 'a delayed rank is not a cleared wave');
  assert.equal(skyStageCleared({ ...done, groundFuture: 1 }), false, 'a wave still to come is checked on its own');
  assert.equal(skyStageCleared({ ...done, groundFuture: 1, wave: SKY_GROUND_WAVES.length }), false,
    'even when the wave index already reads as the last one');
  assert.equal(skyStageCleared({ ...done, waves: SKY_GROUND_WAVES.length + 1 }), false, 'a forged wave total cannot fast-path a win');
  for (const bad of [null, undefined, {}, { ...done, groundActive: -1 }, { ...done, wave: 1.5 }, { ...done, bossesRemaining: NaN },
    { ...done, groundFuture: undefined }, { ...done, groundFuture: -1 }, { ...done, groundFuture: 0.5 }, { ...done, groundFuture: '0' }]) {
    assert.equal(skyStageCleared(bad), false);
  }
});

test('the public finale.sky schema is a bounded, frozen contract for the client', () => {
  assert.deepEqual(SKY_STATUSES, ['boarding', 'countdown', 'active', 'cleared']);
  assert.ok(SKY_COUNTDOWN >= 3 && SKY_COUNTDOWN <= 10);
  assert.ok(SKY_BOSS_DOWN_LINGER > 0 && SKY_BOSS_DOWN_LINGER < 3);
  assert.deepEqual(SKY_BOSS_STATES, ['flying', 'winding', 'down']);
  for (const list of [SKY_STATUSES, SKY_BOSS_STATES, SKY_STATE_FIELDS, SKY_BOSS_FIELDS, SKY_BOMBARD_FIELDS, SKY_GROUND_WAVES, SKY_BOSSES, SKY_SAFE_POCKETS]) {
    assert.equal(Object.isFrozen(list), true);
  }
  for (const boss of SKY_BOSSES) { assert.equal(Object.isFrozen(boss), true); assert.equal(Object.isFrozen(boss.path), true); }
  for (const field of ['status', 'countdownEndsAt', 'wave', 'waves', 'groundActive', 'groundPending', 'groundFuture', 'nextWaveAt', 'bosses', 'bombardments']) {
    assert.ok(SKY_STATE_FIELDS.includes(field), `the snapshot publishes ${field}`);
  }
  for (const field of ['id', 'x', 'y', 'z', 'yaw', 'hp', 'maxHp', 'radius', 'state']) assert.ok(SKY_BOSS_FIELDS.includes(field));
  for (const field of ['id', 'bossId', 'x', 'y', 'z', 'impactX', 'impactY', 'impactZ', 'radius', 'launchAt', 'impactAt']) {
    assert.ok(SKY_BOMBARD_FIELDS.includes(field));
  }
  assert.equal(new Set(SKY_BOSSES.map(boss => boss.id)).size, SKY_BOSSES.length, 'boss ids are stable and distinct');
  assert.equal(new Set(SKY_GROUND_WAVES.map(wave => wave.id)).size, SKY_GROUND_WAVES.length);
  // Nothing in the sky block is an accumulating history: a late joiner reads
  // the whole fight from at most two bosses and SKY_BOMBARD_MAX_ACTIVE shells.
  assert.ok(SKY_BOSSES.length <= 2 && SKY_BOMBARD_MAX_ACTIVE <= 3);
});
