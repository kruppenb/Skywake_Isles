import { MAX_PLAYERS, BEACON, heightAt, shipAt } from '../shared/world.js';
import { FINALE_STAGES } from '../shared/finale.js';
import { SKY_STAGE_KIND } from '../shared/sky-finale.js';
import {
  SKY_BOSSES, SKY_COUNTDOWN, SKY_CHECKPOINT, SKY_BOSS_DOWN_LINGER,
  SKY_BOMBARD_DAMAGE, SKY_BOMBARD_RADIUS, SKY_BOMBARD_MAX_PER_BOSS, SKY_BOMBARD_MAX_ACTIVE,
  SKY_BOMBARD_ID_PREFIX, SKY_BOMBARD_WARNING, SKY_BOSS_FIELDS, SKY_BOMBARD_FIELDS,
  SKY_GROUND_WAVES, skyBossHp, skyBossPose, skyGroundWave, skyBombardInterval, skyBombardSchedule,
  skyBombardAllowed, skyBombardHits, skyStageCleared,
} from '../shared/sky-finale.js';

// Authoritative lifecycle for the skycrab siege. The Game is the adapter: it
// owns enemies, players, events and the spawn queue, and every function here
// takes it explicitly. Authored numbers, lanes and the public schema live in
// shared/sky-finale.js; cannon targeting and damage routing are WP-3's.
//
// The private block hangs off game.finale._sky, so the snapshot's existing
// {stage, stages, remaining} fields are untouched and `sky` appears only while
// this stage runs. Nothing here ever publishes a live reference.

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const copyFields = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));

// Where a shell falls when no pirate is on the ground: a fixed ring around the
// lighthouse, walked in order, so an empty battlefield still reads as a siege
// and never stalls or fails the stage. Points inside the lift pocket, off the
// battlefield or in the water are skipped by skyBombardAllowed below.
const FALLBACK_STRIKES = Object.freeze(Array.from({ length: 6 }, (_, index) => {
  const angle = index * Math.PI / 3 + 0.35;
  return Object.freeze({ x: BEACON.x + Math.cos(angle) * 11, z: BEACON.z + Math.sin(angle) * 11 });
}));

// Any online, able pirate holding any valid cannon opens the fight, including
// one already mounted when the stage began. No host, no role assignment, no
// setup timer: the latch is one-way, so a gunner who steps away mid countdown
// cannot strand the crew.
function readyGunner(game) {
  return [...game.players.values()].some(p => p.online && p.hp > 0 && !p.knockedUntil && p.mode === 'aboard' &&
    p.gunId && game.shipGuns.some(station => station.id === p.gunId && station.occupantId === p.id));
}

// The whole encounter is planned once, from the crew that lit the beacon, and
// never re-rolled: a disconnect cannot shrink a wave already promised, and a
// late joiner cannot grow one.
function planSkyStage(crewCount) {
  const crew = Math.min(Math.max(Math.round(crewCount) || 1, 1), MAX_PLAYERS);
  return {
    crewCount: crew,
    bossPlan: SKY_BOSSES.map(boss => ({ id: boss.id, name: boss.name, radius: boss.radius,
      maxHp: skyBossHp(boss, crew), descriptor: boss })),
    wavePlan: SKY_GROUND_WAVES.map(wave => skyGroundWave(wave.index, crew)),
  };
}

// `started` is the authoritative count of waves actually placed on the island.
// Every count, guard and published cursor derives from it, so no display field
// can be nudged to erase a wave that never spawned.
export function createSkyStage(crewCount) {
  const plan = planSkyStage(crewCount);
  return {
    ...plan,
    status: 'boarding', startedAt: 0, countdownEndsAt: 0, activeAt: 0,
    started: 0, waves: SKY_GROUND_WAVES.length, nextWaveAt: 0,
    bosses: [], bombardments: [], defeated: [], _nextShellId: 1, _fallbackIndex: 0, _attempts: 0,
  };
}

// The stage this lifecycle belongs to, or null: a forced stage number, an
// out-of-range index or a table whose last stage is not the airship stage all
// answer null, and nothing downstream publishes or completes without it.
export function skyStageNumber(game) {
  const stage = game.finale?.stage, definition = Number.isInteger(stage) ? FINALE_STAGES[stage - 1] : null;
  if (!definition || definition.kind !== SKY_STAGE_KIND || stage !== FINALE_STAGES.length) return null;
  return stage;
}

export function startSkyStage(game, stage) {
  const finale = game.finale;
  finale.stage = stage; finale._nextStageAt = 0; finale._pending = []; finale._mark = null;
  finale._sky = createSkyStage(finale._crewCount);
  finale._sky.startedAt = game.elapsed;
  // A collision-safe haven checkpoint replaces the last shrine for this stage
  // only, so a downed defender returns to the lighthouse rather than a shard.
  game.checkpoint = { ...SKY_CHECKPOINT };
  // The scalar bossId names the Tempest, which is already gone; the two
  // skycrabs travel in finale.sky.bosses with their own stable ids.
  game.bossId = null;
  // Practice flyers do not fight and never count: they leave for the stage and
  // come back with the next voyage's reset.
  for (const target of game.flyingTargets) { target.hp = 0; target._respawnAt = Infinity; }
  updateRemaining(game);
  return finale._sky;
}

export function tickSkyStage(game) {
  const sky = game.finale._sky;
  if (!sky) return;
  game.releaseSpawns(game.finale);
  if (sky.status === 'boarding' && readyGunner(game)) {
    sky.status = 'countdown';
    sky.countdownEndsAt = game.elapsed + SKY_COUNTDOWN;
    game.emit({ kind: 'notice', message: `Gunner ready! The skycrabs dive in ${SKY_COUNTDOWN} seconds — hold the lighthouse.` });
  }
  if (sky.status === 'countdown' && game.elapsed + 1e-8 >= sky.countdownEndsAt) activate(game, sky);
  if (sky.status === 'active') {
    advanceBosses(game, sky);
    advanceBombardments(game, sky);
    advanceWaves(game, sky);
  }
  settleSkyStage(game);
}

// Wave one is not placed here: advanceWaves runs on this same tick and owns
// every wave's placement and its retry deadline, first wave included.
function activate(game, sky) {
  sky.status = 'active'; sky.countdownEndsAt = 0; sky.activeAt = game.elapsed;
  const ship = shipAt(game.elapsed);
  for (const plan of sky.bossPlan) {
    if (sky.defeated.includes(plan.id)) continue;
    const pose = skyBossPose(plan.descriptor, 0, ship);
    sky.bosses.push({ id: plan.id, name: plan.name, radius: plan.radius, hp: plan.maxHp, maxHp: plan.maxHp,
      state: 'flying', ...pose, _plan: plan, _downAt: 0,
      _nextBombardAt: game.elapsed + plan.descriptor.bombard.firstDelay });
  }
}

function advanceBosses(game, sky) {
  const ship = shipAt(game.elapsed), laneTime = game.elapsed - sky.activeAt;
  sky.bosses = sky.bosses.filter(boss => boss.state !== 'down' || game.elapsed < boss._downAt + SKY_BOSS_DOWN_LINGER);
  for (const boss of sky.bosses) {
    if (boss.state === 'down') continue;
    Object.assign(boss, skyBossPose(boss._plan.descriptor, laneTime, ship));
    boss.state = sky.bombardments.some(shell => shell.bossId === boss.id && !shell._resolved) ? 'winding' : 'flying';
  }
}

// One telegraphed shell per boss at a time. The ring, the travel and the impact
// are the same record, so a late joiner reads an unresolved warning straight
// from the snapshot instead of replaying an event.
function advanceBombardments(game, sky) {
  for (const shell of sky.bombardments) {
    if (shell._resolved || game.elapsed + 1e-8 < shell.impactAt) continue;
    shell._resolved = true;
    resolveImpact(game, shell);
  }
  sky.bombardments = sky.bombardments.filter(shell => game.elapsed < shell._expiresAt);
  for (const boss of sky.bosses) {
    if (boss.state === 'down' || game.elapsed + 1e-8 < boss._nextBombardAt) continue;
    const live = sky.bombardments.filter(shell => shell.bossId === boss.id && !shell._resolved).length;
    if (live >= SKY_BOMBARD_MAX_PER_BOSS || sky.bombardments.length >= SKY_BOMBARD_MAX_ACTIVE) continue;
    launchBombardment(game, sky, boss);
  }
}

function launchBombardment(game, sky, boss) {
  const impact = chooseImpact(game, sky);
  boss._nextBombardAt = game.elapsed + skyBombardInterval(boss._plan.descriptor, boss.hp / boss.maxHp);
  if (!impact) return null;
  const timing = skyBombardSchedule(game.elapsed);
  const shell = {
    id: `${SKY_BOMBARD_ID_PREFIX}${sky._nextShellId++}`, bossId: boss.id,
    x: boss.x, y: boss.y, z: boss.z,
    impactX: impact.x, impactY: heightAt(impact.x, impact.z), impactZ: impact.z,
    radius: SKY_BOMBARD_RADIUS, launchAt: timing.launchAt, impactAt: timing.impactAt,
    _expiresAt: timing.expiresAt, _resolved: false,
  };
  sky.bombardments.push(shell);
  boss.state = 'winding';
  // Reuse the ground telegraph vocabulary: the same ring every crab swipe draws.
  game.emit({ kind: 'telegraph', id: shell.id, x: shell.impactX, y: shell.impactY + 0.08, z: shell.impactZ,
    radius: SKY_BOMBARD_RADIUS, duration: SKY_BOMBARD_WARNING, style: 'splash' });
  return shell;
}

// Deterministic on purpose: the pirate closest to the dais (ties by id) draws
// the shell, and an empty battlefield still gets a strike from the fixed ring.
function chooseImpact(game, sky) {
  const targets = [...game.players.values()]
    .filter(p => p.online && p.hp > 0 && !p.knockedUntil && p.mode === 'ground' && skyBombardAllowed(p))
    .sort((a, b) => (distance(a, BEACON) - distance(b, BEACON)) || (a.id < b.id ? -1 : 1));
  if (targets[0]) return { x: targets[0].x, z: targets[0].z };
  for (let step = 0; step < FALLBACK_STRIKES.length; step++) {
    const point = FALLBACK_STRIKES[(sky._fallbackIndex + step) % FALLBACK_STRIKES.length];
    if (!skyBombardAllowed(point) || heightAt(point.x, point.z) < 1) continue;
    sky._fallbackIndex = (sky._fallbackIndex + step + 1) % FALLBACK_STRIKES.length;
    return point;
  }
  return null;
}

function resolveImpact(game, shell) {
  const impact = { x: shell.impactX, y: shell.impactY, z: shell.impactZ };
  for (const p of game.players.values()) {
    // Aboard, downed and offline crew are already excluded by damagePlayer; the
    // mode test keeps a gliding pirate out too, and skyBombardHits adds the
    // vertical window and the lift pocket. It is not cover: a wall between the
    // shell and a pirate at the same height does not protect them.
    if (!p.online || p.hp <= 0 || p.knockedUntil || p.mode !== 'ground') continue;
    if (skyBombardHits(impact, p)) game.damagePlayer(p, SKY_BOMBARD_DAMAGE, shell.bossId);
  }
  game.emit({ kind: 'splash', x: impact.x, y: impact.y + 0.1, z: impact.z, radius: SKY_BOMBARD_RADIUS });
}

// One finite wave in the field at a time. A wave that cannot be placed IN FULL
// retries a second later with its planned roster intact: an empty or partial
// placement is a failure, not a smaller wave, and `started` never advances past
// work that never spawned.
function startWave(game, sky, index) {
  const plan = sky.wavePlan[index - 1];
  if (!plan || index !== sky.started + 1) return false;
  sky._attempts++;
  const spawns = game.groundWaveSpawns(plan.groups);
  if (!Array.isArray(spawns) || spawns.length !== plan.total) { sky.nextWaveAt = game.elapsed + 1; return false; }
  sky.started = index; sky.nextWaveAt = 0;
  game.queueSpawns(game.finale, spawns, { _finale: game.finale.stage });
  game.emit({ kind: 'sky-wave', wave: index, waves: sky.waves,
    spawns: spawns.map(spawn => ({ type: spawn.type, x: Math.round(spawn.x * 10) / 10,
      z: Math.round(spawn.z * 10) / 10, delay: Math.round(spawn.delay * 10) / 10,
      ...(spawn.from ? { from: spawn.from } : {}) })) });
  game.emit({ kind: 'notice', message: plan.notice });
  return true;
}

// Every wave, the first included, waits on the same deadline: the authored gap
// before it, or one second after a blocked attempt. Nothing retries per tick.
function advanceWaves(game, sky) {
  if (sky.started >= sky.waves) return;
  if (sky.started >= 1 && (groundActive(game) || game.finale._pending.length)) return;
  if (!sky.nextWaveAt) {
    const gap = sky.wavePlan[sky.started]?.gap ?? 0;
    sky.nextWaveAt = game.elapsed + gap;
    if (gap > 0) return;
  }
  if (game.elapsed + 1e-8 >= sky.nextWaveAt) startWave(game, sky, sky.started + 1);
}

const groundActive = game => [...game.enemies.values()].filter(enemy => enemy._finale === game.finale.stage).length;

// Every count the completion guard and the HUD ask for. Bosses that have not
// spawned yet still count as remaining, so an empty live array during boarding
// can never read as a cleared sky.
export function skyCounts(game) {
  const sky = game.finale._sky;
  if (!sky) return null;
  return {
    status: sky.status,
    bossesRemaining: sky.bossPlan.filter(plan => !sky.defeated.includes(plan.id)).length,
    // The cursor IS the number of waves actually placed, so an unstarted wave
    // can never be counted as done and groundFuture stays the waves to come.
    wave: sky.started, waves: sky.waves,
    groundActive: groundActive(game),
    groundPending: game.finale._pending.length,
    groundFuture: sky.waves - sky.started,
  };
}

// finale.remaining stays honest while boarding, between waves and while ranks
// are still forming: it is every skycrab and ground attacker the stage still
// owes, not only the ones standing on the island right now.
function updateRemaining(game) {
  const sky = game.finale._sky, counts = skyCounts(game);
  if (!counts) return;
  const future = sky.wavePlan.slice(counts.wave).reduce((sum, plan) => sum + plan.total, 0);
  game.finale.remaining = counts.bossesRemaining + counts.groundActive + counts.groundPending + future;
}

export function settleSkyStage(game) {
  const sky = game.finale._sky;
  if (!sky) return;
  updateRemaining(game);
  if (sky.status !== 'active') return;
  // Ask the shared guard while the stage is still active; completeIsland()
  // re-asks it and only then latches `cleared`.
  if (!skyStageCleared(skyCounts(game))) return;
  game.completeIsland();
}

// WP-3 calls this after validating its own shot; the lifecycle never selects a
// target or decides a hit. Returns null when the shot found nothing to hurt.
export function damageSkyBoss(game, bossId, amount, sourceId) {
  const sky = game.finale?._sky;
  const boss = sky?.bosses.find(item => item.id === bossId && item.state !== 'down');
  if (!boss || !(amount > 0) || sky.status !== 'active') return null;
  const damage = Math.min(boss.hp, amount);
  boss.hp -= damage;
  game.emit({ kind: 'hit', targetId: boss.id, sourceId, damage, x: boss.x, y: boss.y, z: boss.z });
  if (boss.hp > 0) return { id: boss.id, damage, defeated: false };
  defeatSkyBoss(game, boss, sourceId);
  return { id: boss.id, damage, defeated: true };
}

// A skycrab dies exactly once: its id is latched as defeated, its outstanding
// shells are cancelled with it, and it never respawns like a practice flyer.
export function defeatSkyBoss(game, boss, sourceId) {
  const sky = game.finale._sky;
  if (!sky || boss.state === 'down' || sky.defeated.includes(boss.id)) return false;
  boss.hp = 0; boss.state = 'down'; boss._downAt = game.elapsed;
  sky.defeated.push(boss.id);
  sky.bombardments = sky.bombardments.filter(shell => shell.bossId !== boss.id || shell._resolved);
  game.pearls += boss._plan.descriptor.pearls;
  const p = game.players.get(sourceId); if (p) p.kills++;
  game.emit({ kind: 'defeated', id: boss.id, type: 'skycrab', x: boss.x, y: boss.y, z: boss.z });
  game.emit({ kind: 'notice', message: `${boss.name} falls out of the sky!` });
  settleSkyStage(game);
  return true;
}

// Live records for the server only (WP-3's shot validation). Never published.
export function livingSkyBosses(game) {
  const sky = game.finale?._sky;
  if (!sky || sky.status !== 'active') return [];
  return sky.bosses.filter(boss => boss.state !== 'down' && boss.hp > 0);
}

// Stop everything the stage still has in flight but keep the block, so the HUD
// can show a cleared sky through the victory tableau.
export function cancelSkyActivity(game) {
  const sky = game.finale._sky;
  if (!sky) return;
  sky.bombardments = []; sky.bosses = []; sky.nextWaveAt = 0; sky.countdownEndsAt = 0;
  game.finale._pending = [];
}

// Full teardown: no boss, shell, queued rank, stage enemy, hidden practice flyer
// or public sky block survives victory, a stage exit or an abandoned round. The
// island completion record is bookkeeping and deliberately outlives it.
export function clearSkyStage(game) {
  if (!game.finale?._sky) return;
  cancelSkyActivity(game);
  for (const enemy of [...game.enemies.values()]) if (enemy._finale === game.finale.stage) game.enemies.delete(enemy.id);
  for (const target of game.flyingTargets) { target.hp = target.maxHp; target._respawnAt = 0; }
  game.finale._sky = null;
}

// The bounded public block, published only while the airship stage is genuinely
// the running finale stage: no victory, lobby, forced stage number or torn-down
// block ever carries a sky block. Every array is a fresh copy of whitelisted
// fields, so the snapshot never hands a client a live boss or shell.
export function publicSkyState(game) {
  const sky = game.finale?._sky;
  if (!sky || game.phase !== 'finale' || !skyStageNumber(game)) return null;
  const counts = skyCounts(game);
  return {
    status: sky.status, countdownEndsAt: sky.countdownEndsAt,
    wave: counts.wave, waves: sky.waves,
    groundActive: counts.groundActive, groundPending: counts.groundPending, groundFuture: counts.groundFuture,
    nextWaveAt: sky.nextWaveAt,
    bosses: sky.bosses.slice(0, SKY_BOSSES.length).map(boss => copyFields(boss, SKY_BOSS_FIELDS)),
    bombardments: sky.bombardments.filter(shell => !shell._resolved).slice(0, SKY_BOMBARD_MAX_ACTIVE)
      .map(shell => copyFields(shell, SKY_BOMBARD_FIELDS)),
  };
}
