import { MAX_PLAYERS, BEACON, SHRINES } from './world.js';
import { SHIP_GUNS, GUN_PIVOT_HEIGHT, GUN_RANGE, AIRSHIP_RETURNS, RETURN_RANGE, gunAim, gunMuzzle } from './airship.js';

// Authored data and pure helpers for the fourth finale stage, the skycrab
// siege. Two giant skycrabs fly slow broadside lanes beside the parked airship
// while three finite ground waves march on the lighthouse. Nothing here keeps
// state or advances time: shared/finale.js names the stage, server/sky-finale.js
// (WP-2) owns the lifecycle, and the client renders the snapshot block this
// module's field lists describe.
//
// This module must never import shared/finale.js: the stage table imports these
// counts, and importing it back would close a module cycle.
export const SKY_STAGE_ID = 'skycrabs';
export const SKY_STAGE_KIND = 'airship';

// Sky-stage status, in progression order. `boarding` waits for any online, able
// pirate to hold a cannon; `countdown` is the shared grace period after that
// latch; `active` runs bosses, bombardments and waves and is the ONLY status
// skyStageCleared() answers true for; `cleared` is the terminal state
// completeIsland() latches once that guard has passed.
export const SKY_STATUSES = Object.freeze(['boarding', 'countdown', 'active', 'cleared']);
export const SKY_COUNTDOWN = 5;

// --- Bosses -----------------------------------------------------------------
//
// Lanes are authored in SHIP-LOCAL metres and added to shipAt(elapsed), the same
// convention SHIP_GUNS uses: +x is starboard, -z is the bow, +z is astern toward
// the lighthouse. The parked ship sits at (0, 62, -60) and the beacon is 64m
// dead astern of it, inside the fore/aft gap between the broadside arcs, so a
// boss over the beacon centreline would be unshootable. Every lane therefore
// stays laterally offset on one broadside and at least a metre above the gun
// pivot, which keeps the whole path inside the traverse clamp and above the
// depression clamp without ever asking a shot to pass through the hull.
//
// `path` traces a closed ellipse once per `period` seconds:
//   x = ship.x + path.x + sway*cos(theta), z = ship.z + path.z + run*sin(theta),
//   y = ship.y + path.y + rise*sin(riseCycles*theta + riseOffset),
//   theta = 2*PI*(phase + laneTime/period)
// `riseCycles` is an integer so the altitude beat closes with the lap.
//
// POSE CONVENTION: x/y/z is the CENTRE of the `radius` hit sphere, matching the
// server's nearest-sphere cannon test and flyingTargets. It is NOT a feet
// position like Enemy.y, so WP-4 must centre the model on the pose.
export const SKY_BOSSES = Object.freeze([
  {
    id: 'skycrab-port', name: 'Galewrack', side: 'port', radius: 4.6, scale: 3.4, pearls: 40,
    hp: 780, hpPerExtraPlayer: 150,
    path: Object.freeze({ x: -34, y: 8, z: 26, sway: 6, run: 28, rise: 3.5, riseCycles: 2, riseOffset: 0, period: 46, phase: 0 }),
    bombard: Object.freeze({ interval: 8, fastInterval: 5.4, rage: 0.5, firstDelay: 6 }),
  },
  {
    id: 'skycrab-starboard', name: 'Squallmaw', side: 'starboard', radius: 4.2, scale: 3.1, pearls: 40,
    hp: 700, hpPerExtraPlayer: 135,
    path: Object.freeze({ x: 34, y: 6.5, z: 25, sway: 5.5, run: 27, rise: 3, riseCycles: 3, riseOffset: Math.PI / 2, period: 52, phase: 0.35 }),
    bombard: Object.freeze({ interval: 8.6, fastInterval: 5.8, rage: 0.5, firstDelay: 9 }),
  },
].map(boss => Object.freeze(boss)));

// A boss lingers in the snapshot this long after its last hit so the client can
// play a death, then WP-2 drops it from the bounded array.
export const SKY_BOSS_DOWN_LINGER = 1.2;
// Snapshot states for a boss. `winding` covers a telegraphed bombardment.
export const SKY_BOSS_STATES = Object.freeze(['flying', 'winding', 'down']);

// Latched crew scaling, capped by MAX_PLAYERS so a full crew never faces more
// than 1.8x the solo pool and a lone survivor can still finish what five began.
export function skyBossHp(boss, crewCount) {
  if (!boss || !Number.isFinite(boss.hp) || !Number.isInteger(crewCount) || crewCount < 1 || crewCount > MAX_PLAYERS) return null;
  return boss.hp + (boss.hpPerExtraPlayer ?? 0) * Math.min(Math.max(0, crewCount - 1), MAX_PLAYERS - 1);
}

export function skyBossPose(boss, laneTime, ship) {
  const path = boss?.path;
  if (!path || !Number.isFinite(laneTime) || ![ship?.x, ship?.y, ship?.z].every(Number.isFinite)) return null;
  const theta = Math.PI * 2 * (path.phase + laneTime / path.period);
  const sin = Math.sin(theta), cos = Math.cos(theta);
  // Forward is (-sin yaw, -cos yaw), the same heading convention the guns and
  // the practice flyers use, so the tangent of the lap gives the facing.
  return {
    x: ship.x + path.x + path.sway * cos,
    y: ship.y + path.y + path.rise * Math.sin(path.riseCycles * theta + path.riseOffset),
    z: ship.z + path.z + path.run * sin,
    yaw: Math.atan2(path.sway * sin, -path.run * cos),
  };
}

// Evenly spaced poses over exactly one lap, for authoring checks and debug
// overlays. The last sample is the lap's end, which equals the first pose.
export function skyBossPathSamples(boss, ship, samples = 64) {
  if (!boss?.path || !Number.isInteger(samples) || samples < 2) return null;
  return Array.from({ length: samples + 1 }, (_, index) => skyBossPose(boss, boss.path.period * index / samples, ship));
}

// AUTHORING AND DIAGNOSTICS ONLY — never a runtime hit test. This helper
// AUTO-AIMS the seat at the supplied pose, lets the real traverse/pitch clamps
// bite, and then runs the server's own nearest-sphere test from the resulting
// muzzle, which answers "could this seat ever hit that pose?" for lane authoring,
// tests and debug overlays. A clamped seat simply misses the sphere and returns
// null, so nothing here can widen an arc or depress through the hull to claim a
// target. WP-3 must still raycast from the player's own validated yaw/pitch:
// selecting hits with this helper would turn every miss into an auto-hit.
// (`miss` is how far the clamped ray passes from the centre: 0 means the seat
// aims dead on, and `clearance` is the sphere margin left over.)
export function skyBossReachableFromGun(pose, gun, ship) {
  if (![pose?.x, pose?.y, pose?.z, gun?.x, gun?.z, gun?.yaw, ship?.x, ship?.y, ship?.z].every(Number.isFinite)) return null;
  const radius = Number.isFinite(pose.radius) ? pose.radius : 0;
  const pivot = { x: ship.x + gun.x, y: ship.y + GUN_PIVOT_HEIGHT, z: ship.z + gun.z };
  const dx = pose.x - pivot.x, dy = pose.y - pivot.y, dz = pose.z - pivot.z;
  const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
  const aim = gunAim(gun, wantYaw, wantPitch);
  const { from, direction } = gunMuzzle(gun, ship, wantYaw, wantPitch);
  const ox = pose.x - from.x, oy = pose.y - from.y, oz = pose.z - from.z;
  const along = ox * direction.x + oy * direction.y + oz * direction.z;
  const offset = Math.max(0, ox * ox + oy * oy + oz * oz - along * along);
  const discriminant = radius * radius - offset;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant), enter = along - root, leave = along + root;
  const surface = enter >= 0 ? enter : leave;
  if (surface < 0 || surface > GUN_RANGE) return null;
  return { gunId: gun.id, yaw: aim.yaw, pitch: aim.pitch, distance: surface,
    range: Math.hypot(ox, oy, oz), miss: Math.sqrt(offset), clearance: radius - Math.sqrt(offset) };
}

// Every seat that could hit the pose if it aimed at it, nearest first. Same
// authoring/diagnostic role as skyBossReachableFromGun, not a hit test.
export function skyBossFiringSolutions(pose, ship, guns = SHIP_GUNS) {
  if (!Array.isArray(guns)) return [];
  return guns.map(gun => skyBossReachableFromGun(pose, gun, ship)).filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
}

// --- Bombardments -----------------------------------------------------------
//
// One telegraphed shell at a time per boss: the ring appears at launch and the
// shell lands SKY_BOMBARD_WARNING seconds later, so launch, travel and impact
// are the same authoritative record. Cadence tightens modestly as a boss loses
// health; it never gains a second attack, a minion or a phase.
export const SKY_BOMBARD_WARNING = 2.8;
export const SKY_BOMBARD_LINGER = 0.5;
export const SKY_BOMBARD_RADIUS = 4.6;
export const SKY_BOMBARD_DAMAGE = 15;
// A shell only touches pirates standing within this much of the impact height:
// no damage up to the deck, into a building or through any elevation change.
export const SKY_BOMBARD_HEIGHT = 4;
export const SKY_BOMBARD_MAX_PER_BOSS = 1;
export const SKY_BOMBARD_MAX_ACTIVE = SKY_BOSSES.length * SKY_BOMBARD_MAX_PER_BOSS;
export const SKY_BOMBARD_ID_PREFIX = 'sky-shell-';
// Impacts stay on the battlefield around the lighthouse, and never inside the
// lift/respawn pocket. That pocket is arrival safety ONLY: it is one lift's
// interaction range wide, ordinary ground enemies still walk in and attack
// there, and it shelters nothing else on the dais.
export const SKY_BOMBARD_FIELD = 46;
export const SKY_SAFE_POCKET_RADIUS = RETURN_RANGE;
const HAVEN_LIFT = AIRSHIP_RETURNS.find(point => point.id === 'airship-return-haven');
export const SKY_SAFE_POCKETS = Object.freeze([Object.freeze({
  id: HAVEN_LIFT.id, x: HAVEN_LIFT.x, z: HAVEN_LIFT.z, radius: SKY_SAFE_POCKET_RADIUS })]);
// Stage-entry checkpoint. Game.revive() puts slot n at (checkpoint.x + 2 + n*0.8,
// checkpoint.z + 3), so the anchor is offset back from the haven lift to centre
// that whole row of MAX_PLAYERS slots on the lift and inside the pocket.
// WP-2 MUST clamp the sky-stage revive slot to 0..MAX_PLAYERS-1: addPlayer caps
// the ONLINE crew, while revive indexes the full players Map, which can hold
// reserved offline characters and run past the last slot. Earlier stages keep
// their current checkpoints and slot behaviour.
export const SKY_REVIVE_SLOTS = MAX_PLAYERS;
export const SKY_REVIVE_SLOT_SPACING = 0.8;
export const SKY_CHECKPOINT = Object.freeze({
  x: HAVEN_LIFT.x - (2 + SKY_REVIVE_SLOT_SPACING * (SKY_REVIVE_SLOTS - 1) / 2),
  z: HAVEN_LIFT.z - 3,
});

// The tight arrival pocket, as a question about one point.
export function skyInSafePocket(point) {
  if (![point?.x, point?.z].every(Number.isFinite)) return false;
  return SKY_SAFE_POCKETS.some(pocket => Math.hypot(point.x - pocket.x, point.z - pocket.z) <= pocket.radius);
}

export function skyBombardInterval(boss, hpFraction) {
  const tuning = boss?.bombard;
  if (!tuning || !Number.isFinite(hpFraction)) return null;
  const fraction = Math.min(Math.max(hpFraction, 0), 1);
  const rage = Math.min(Math.max(tuning.rage, 0.05), 1);
  const heat = Math.min(Math.max((rage - fraction) / rage, 0), 1);
  return tuning.interval + (tuning.fastInterval - tuning.interval) * heat;
}

export function skyBombardSchedule(launchAt) {
  if (!Number.isFinite(launchAt)) return null;
  const impactAt = launchAt + SKY_BOMBARD_WARNING;
  return { launchAt, impactAt, expiresAt: impactAt + SKY_BOMBARD_LINGER };
}

export function skyBombardAllowed(point) {
  if (![point?.x, point?.z].every(Number.isFinite)) return false;
  if (Math.hypot(point.x - BEACON.x, point.z - BEACON.z) > SKY_BOMBARD_FIELD) return false;
  return !skyInSafePocket(point);
}

// Who a landed shell actually touches: horizontal ring plus a vertical window,
// so aboard crew and anyone at another elevation are never hit. A ring centred
// legally just outside the pocket still overlaps its edge, so standing inside
// the pocket is its own exemption — arrival safety is about the pirate's
// position, not only the shell's. It exempts nothing else: ground enemies walk
// into the pocket and attack normally.
export function skyBombardHits(impact, point) {
  if (![impact?.x, impact?.y, impact?.z, point?.x, point?.y, point?.z].every(Number.isFinite)) return false;
  if (skyInSafePocket(point)) return false;
  return Math.hypot(point.x - impact.x, point.z - impact.z) <= SKY_BOMBARD_RADIUS &&
    Math.abs(point.y - impact.y) <= SKY_BOMBARD_HEIGHT;
}

// --- Ground waves -----------------------------------------------------------
//
// Three finite waves of the crab classes the finale already fields — cheeky
// crabs and Tidebreaker elites, no new ground attack vocabulary — one wave at a
// time, marching the shrine approaches stage one already uses. The escalation is
// count first, then armour: crabs, crabs plus one elite, then a short rank led
// by elites. Counts are bounded: the largest wave any crew faces is ten units,
// and the stage brings 14 (solo) to 24 (five) attackers in total. Nothing is
// ever refilled.
export const SKY_WAVE_GAP = 6;
export const SKY_WAVE_MAX_UNITS = 12;
export const SKY_GROUND_WAVES = Object.freeze([
  { index: 1, id: 'sky-wave-skitter', name: 'Skitter tide', gap: 0,
    notice: 'Crabs swarm the lighthouse while the skycrabs circle!',
    crab: { perShrine: 2, perExtra: 1 }, tidebreaker: { base: 0, perPair: 0 } },
  { index: 2, id: 'sky-wave-shellwall', name: 'Shell wall', gap: SKY_WAVE_GAP,
    notice: 'A Tidebreaker leads the second wave up the shrine roads!',
    crab: { perShrine: 1, perExtra: 1 }, tidebreaker: { base: 1, perPair: 0 } },
  { index: 3, id: 'sky-wave-breakers', name: 'Last breakers', gap: SKY_WAVE_GAP,
    notice: 'Last wave: Tidebreakers are marching on the dais!',
    crab: { perShrine: 1, perExtra: 0 }, tidebreaker: { base: 1, perPair: 1 } },
].map(wave => Object.freeze(wave)));

// The roster of one wave, grouped by shrine direction in SHRINES order so WP-2
// can hand it to the same formation placer the earlier finale stages use. The
// `spitter: 0` field keeps that shared group shape; this stage never fields
// spitters. Extras are dealt round robin from one cursor that carries across
// unit types, so an elite never lands on the road that already drew an extra
// crab and no shrine faces two more attackers than another.
export function skyGroundWave(index, crewCount) {
  if (!Number.isInteger(index) || index < 1 || index > SKY_GROUND_WAVES.length ||
    !Number.isInteger(crewCount) || crewCount < 1 || crewCount > MAX_PLAYERS) return null;
  const wave = SKY_GROUND_WAVES[index - 1], extra = crewCount - 1, pairs = Math.floor(crewCount / 2);
  const groups = SHRINES.map(shrine => ({ from: shrine.id, crab: wave.crab.perShrine, spitter: 0, tidebreaker: 0 }));
  let cursor = 0;
  const deal = (unit, count) => { for (let i = 0; i < count; i++) groups[cursor++ % groups.length][unit]++; };
  deal('crab', wave.crab.perExtra * extra);
  deal('tidebreaker', wave.tidebreaker.base ? wave.tidebreaker.base + wave.tidebreaker.perPair * pairs : 0);
  const total = groups.reduce((sum, group) => sum + group.crab + group.spitter + group.tidebreaker, 0);
  return { index, id: wave.id, name: wave.name, notice: wave.notice, gap: wave.gap, groups, total };
}

// --- Completion -------------------------------------------------------------
//
// The single guarded question WP-2 asks while the stage is still `active`, and
// the only route into completeIsland(), which then latches `cleared`. Asking it
// after latching would deadlock, so the guard deliberately answers false for
// every status but `active`. Boarding, a countdown, an inter-wave gap, a queued
// rank, an unspawned boss or a wave still to come all keep the stage open; an
// empty enemy map never wins on its own. `bossesRemaining` counts living AND
// not-yet-spawned bosses, `groundActive` the stage's living ground enemies,
// `groundPending` the ranks still forming up and `groundFuture` the waves that
// have not started — each is checked independently, so a mis-set wave index
// alone can never pass the guard.
export function skyStageCleared(state) {
  const waves = Number.isInteger(state?.waves) ? state.waves : SKY_GROUND_WAVES.length;
  const counts = [state?.bossesRemaining, state?.wave, state?.groundActive, state?.groundPending, state?.groundFuture];
  if (state?.status !== 'active' || !Number.isInteger(waves) || waves !== SKY_GROUND_WAVES.length) return false;
  if (!counts.every(value => Number.isInteger(value) && value >= 0)) return false;
  return state.bossesRemaining === 0 && state.wave === waves && state.groundFuture === 0 &&
    state.groundActive === 0 && state.groundPending === 0;
}

// --- Public snapshot schema -------------------------------------------------
//
// `finale.sky` is present ONLY while the skycrab stage runs; the existing
// finale {stage, stages, remaining} fields are unchanged and every other phase
// omits the block entirely. All times are absolute state.elapsed seconds (the
// same clock as knockedUntil), 0 when they do not apply. Arrays are bounded by
// SKY_BOSSES.length and SKY_BOMBARD_MAX_ACTIVE: this is live state, never an
// event history, so a late joiner sees the whole fight from one snapshot.
export const SKY_STATE_FIELDS = Object.freeze(['status', 'countdownEndsAt', 'wave', 'waves',
  'groundActive', 'groundPending', 'groundFuture', 'nextWaveAt', 'bosses', 'bombardments']);
// Boss: x/y/z is the hit-sphere centre, state is one of SKY_BOSS_STATES.
export const SKY_BOSS_FIELDS = Object.freeze(['id', 'name', 'x', 'y', 'z', 'yaw', 'hp', 'maxHp', 'radius', 'state']);
// Bombardment: x/y/z is the launch point at the boss, impact* the ground point
// the ring marks, and impactAt the authoritative deadline the ring counts to.
export const SKY_BOMBARD_FIELDS = Object.freeze(['id', 'bossId', 'x', 'y', 'z',
  'impactX', 'impactY', 'impactZ', 'radius', 'launchAt', 'impactAt']);
