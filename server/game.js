import { MAX_PLAYERS, SEED, COLORS, SPAWN, BEACON, SHRINES, CHESTS, heightAt } from '../shared/world.js';
import { makePlayerPosition, movePlayer } from '../shared/movement.js';
import { resolveWorldCollision, hasWorldLineOfSight } from '../shared/collision.js';
import { WEAPONS, RARITIES, SALVAGE_PEARLS, weaponStats, rollWeapon } from '../shared/weapons.js';
import { encounterSpawns, inSafeLanding } from '../shared/encounters.js';
import { enemyStats } from '../shared/enemies.js';
import { SIDE_EVENTS, SIDE_EVENT_WAVES, SIDE_EVENT_DURATION, SIDE_EVENT_ARC, SIDE_EVENT_RANK_SPACING, SIDE_EVENT_RANK_STAGGER, SIDE_EVENT_RANK_DELAY, seawardBearing, sideEventWave } from '../shared/side-events.js';
import { FINALE_STAGES, FINALE_STAGE_DELAY, FINALE_FRONT, FINALE_ELITE_FRONT, FINALE_ARC, FINALE_RANK_SIZE, FINALE_DIRECTION_DELAY, shardBearing, finaleStageRoster } from '../shared/finale.js';
export { WEAPONS } from '../shared/weapons.js';
const ACTIONS = new Set(['ready', 'launch', 'fire', 'melee', 'reload', 'interact', 'heal', 'ping', 'swap', 'restart']);
const PUBLIC_PLAYER = ['id', 'name', 'color', 'online', 'ready', 'x', 'y', 'z', 'yaw', 'pitch', 'vy', 'mode', 'jumpHeld', 'grounded', 'deckX', 'deckZ', 'hp', 'maxHp', 'ammo', 'maxAmmo', 'weapon', 'rarity', 'reloadUntil', 'healUntil', 'knockedUntil', 'invulnerableUntil', 'lastInputSeq', 'kills', 'rescues', 'chests'];
const PUBLIC_ENEMY = ['id', 'type', 'x', 'y', 'z', 'yaw', 'hp', 'maxHp', 'radius', 'state', 'attackAt', 'zone', 'scale', 'attackRadius'];
const PUBLIC_SIDE_EVENT = ['id', 'status', 'wave', 'remaining', 'integrity', 'maxIntegrity', 'startedAt', 'endsAt', 'finishedAt'];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const cleanObject = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
const good = () => ({ ok: true });
const bad = (message, code = 'ACTION_DENIED') => ({ ok: false, message, code });
const restInput = p => ({ forward: 0, right: 0, sprint: false, jump: false, yaw: p.yaw, pitch: p.pitch });
const sightPoint = (point, lift = 1) => ({ x: point.x, y: (point.y ?? heightAt(point.x, point.z)) + lift, z: point.z });
const canReach = (from, to) => hasWorldLineOfSight(sightPoint(from, 1.25), sightPoint(to, 0.8));
// Landed pirates open chests and collect (or salvage) guns by walking this close.
const PICKUP_RADIUS = 2;
const CHEST_PEARLS = 12;
const CHEST_POINTS = new Map(CHESTS.map(c => [c.id, { ...c, y: heightAt(c.x, c.z) }]));

// Verify the whole walk, not just the endpoint: a clear-looking spawn on the
// other side of a cottage must not leave a crab walking into its wall.
export function sideEventPathClear(from, to, radius = 0.85) {
  if (![from?.x, from?.z, to?.x, to?.z].every(Number.isFinite)) return false;
  radius = Number.isFinite(radius) ? Math.max(0.85, radius) : 0.85;
  const length = distance(from, to);
  // The walker's own footprint is exempt. Crabs move with a smaller body than
  // this conservative check, so one pushed against a prop or resting on the
  // margin of a marginal straight route must still validate the walk away.
  const lead = Math.min(length, 0.6);
  const start = length > 0 ? { x: from.x + (to.x - from.x) / length * lead, z: from.z + (to.z - from.z) / length * lead } : { x: from.x, z: from.z };
  if (!hasWorldLineOfSight(sightPoint(start), sightPoint(to), radius - 0.05)) return false;
  const steps = Math.max(1, Math.ceil(length / 0.75));
  let previousY = heightAt(from.x, from.z);
  for (let step = 0; step <= steps; step++) {
    const fraction = step / steps;
    const point = { x: from.x + (to.x - from.x) * fraction, z: from.z + (to.z - from.z) * fraction };
    point.y = heightAt(point.x, point.z);
    if (point.y < 1 || inSafeLanding(point) || Math.abs(point.y - previousY) > 0.8) return false;
    if (fraction * length >= lead && distance(point, resolveWorldCollision({ ...point }, radius)) > 0.001) return false;
    previousY = point.y;
  }
  return true;
}

// Standing room for a whole body of this radius, used for spawn and waypoint
// positions that the footprint exemption above deliberately skips.
export function sideEventStandingClear(point, radius = 0.85) {
  if (![point?.x, point?.z].every(Number.isFinite)) return false;
  const sample = { x: point.x, z: point.z, y: heightAt(point.x, point.z) };
  return sample.y >= 1 && !inSafeLanding(sample) && distance(sample, resolveWorldCollision({ ...sample }, Math.max(0.85, radius))) <= 0.001;
}

// Crabs walk with a body radius near their public radius, so wide mini bosses
// route around props that ordinary crabs squeeze past.
const routeRadius = enemy => Math.max(0.85, Number(enemy?.radius) || 0);
const waypointRings = new Map();

// Two-leg routes let attackers start behind the buildings that stand between
// the supplies and the sea. Each supply center keeps the ring of points that
// reach it directly; a route then only needs one clear leg to that ring.
export function sideEventWaypoint(from, point, radius = 0.85) {
  if (![from?.x, from?.z, point?.x, point?.z].every(Number.isFinite)) return null;
  radius = Math.max(0.85, Number.isFinite(radius) ? radius : 0.85);
  const key = `${point.x},${point.z}:${radius}`;
  if (!waypointRings.has(key)) {
    const ring = [];
    for (const distanceOut of [4, 8, 12, 16, 20, 24]) for (let direction = 0; direction < 32; direction++) {
      const angle = direction * Math.PI / 16;
      const candidate = { x: point.x + Math.cos(angle) * distanceOut, z: point.z + Math.sin(angle) * distanceOut, out: distanceOut };
      if (sideEventStandingClear(candidate, radius) && sideEventPathClear(candidate, point, radius)) ring.push(candidate);
    }
    waypointRings.set(key, ring);
  }
  // Nearest total walk first, so the first clear leg is the shortest route. A
  // waypoint the walker already stands on cannot lead it anywhere new.
  const ordered = waypointRings.get(key).map(candidate => ({ candidate, route: distance(from, candidate) + candidate.out }))
    .filter(({ route, candidate }) => route - candidate.out >= 1).sort((a, b) => a.route - b.route);
  for (const { candidate } of ordered) if (sideEventPathClear(from, candidate, radius)) return { x: candidate.x, z: candidate.z, waypoint: true };
  return null;
}

// Deeper fallbacks first, then shallower ones: a rank that cannot fit behind a
// short front (the yard forms on the surf line) falls back toward the objective
// instead of stepping out to sea and failing the whole formation.
const FORMATION_FALLBACKS = [0, 2, -2, 4, -4, 6, -6, 8, -8, 12, -12, 16, -16, 20, -20];
// Routes are accepted with a slightly wider body than the walkers carry, so a
// spawn never hands an attacker a route that grazes a prop on the way in.
const FORMATION_ROUTE_MARGIN = 0.05;

// Lay `count` units of one type across `ranks` rows facing `point`: each row is
// a rank deeper, every other unit in a row stands staggered further out, and a
// row surges SIDE_EVENT_RANK_DELAY after the one in front of it.
export function rankUnits(type, count, firstRank, ranks, { bearing, arc, delay = 0 }) {
  const units = [], perRank = Math.ceil(count / Math.max(1, ranks));
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / perRank), inRow = Math.min(perRank, count - row * perRank);
    units.push({ type, rank: firstRank + row, angle: bearing + ((index % perRank + 0.5) / inRow - 0.5) * arc * 2,
      stagger: (index % perRank) % 2 ? SIDE_EVENT_RANK_STAGGER : 0, delay: (firstRank + row) * SIDE_EVENT_RANK_DELAY + delay });
  }
  return units;
}

// Place a formation of ranked units on an arc around `bearing`, `front` metres
// out from `point`, checking that every unit stands clear and can walk in.
export function formationSpawns({ point, bearing, arc, front, region, units, occupied = [] }) {
  if (![point?.x, point?.z, bearing, arc, front].every(Number.isFinite) || !Array.isArray(units) ||
    !Array.isArray(occupied) || occupied.some(item => ![item?.x, item?.z].every(Number.isFinite))) return null;
  const result = [];
  for (const unit of units) {
    const radius = routeRadius(enemyStats(unit.type)), spacing = unit.type === 'tidebreaker' ? 3.6 : 2.8;
    let spawn = null;
    // Nudge along the front first, then deeper or shallower. Every fallback
    // passes the same checks; exhausting candidates fails safely instead of
    // spawning the last rejected point.
    search: for (const extra of FORMATION_FALLBACKS) {
      const out = front + unit.rank * SIDE_EVENT_RANK_SPACING + (unit.stagger ?? 0) + extra;
      if (out < front - 2) continue;
      for (let attempt = 0; attempt < 29; attempt++) {
        const sway = Math.ceil(attempt / 2) * (attempt % 2 ? 1 : -1) * Math.PI / 36;
        const angle = unit.angle + sway;
        if (Math.abs(angle - bearing) > arc + Math.PI / 36) continue;
        const candidate = { x: point.x + Math.cos(angle) * out, z: point.z + Math.sin(angle) * out };
        if (heightAt(candidate.x, candidate.z) < 1.1 || !sideEventStandingClear(candidate, radius)) continue;
        if ([...occupied, ...result].some(other => distance(other, candidate) < Math.max(spacing, other.type === 'tidebreaker' ? 3.6 : 0))) continue;
        if ([BEACON, ...CHESTS, ...SHRINES].some(other => distance(other, candidate) < 3.6)) continue;
        const route = radius + FORMATION_ROUTE_MARGIN;
        const direct = sideEventPathClear(candidate, point, route);
        const waypoint = direct ? null : sideEventWaypoint(candidate, point, route);
        if (!direct && !waypoint) continue;
        spawn = { ...candidate, type: unit.type, zone: region, delay: Math.max(0, Number(unit.delay) || 0), ...(waypoint ? { waypoint } : {}) };
        break search;
      }
    }
    if (!spawn) return null;
    result.push(spawn);
  }
  return result;
}

export function sideEventSpawns(id, playerCount, wave, occupied = []) {
  const point = SIDE_EVENTS.find(event => event.id === id);
  const roster = sideEventWave(wave, playerCount);
  if (!point || !roster || playerCount > MAX_PLAYERS) return null;
  // Ranks form on the seaward side: crabs lead in up to three ranks, spitters
  // follow one rank behind them, and the Tidebreakers anchor a rank of their
  // own so the slow mini bosses arrive last and never crowd the spitters.
  const bearing = seawardBearing(point), arc = SIDE_EVENT_ARC;
  const crabRanks = Math.min(3, Math.ceil(roster.crab / 4));
  const units = [
    ...rankUnits('tidebreaker', roster.tidebreaker, crabRanks + (roster.spitter ? 1 : 0), 1, { bearing, arc }),
    ...rankUnits('spitter', roster.spitter, crabRanks, 1, { bearing, arc }),
    ...rankUnits('crab', roster.crab, 0, crabRanks, { bearing, arc }),
  ];
  return formationSpawns({ point, bearing, arc, front: point.front, region: point.region, units, occupied });
}

// Each stage of the final battle. Wave stages march in from the bearing of each
// shrine the crew looted a shard from, one direction after another; the boss
// stage claims the arena in front of the lighthouse with no placement checks.
export function finaleStageSpawns(stage, playerCount, occupied = []) {
  const roster = finaleStageRoster(stage, playerCount);
  if (!roster || !Array.isArray(occupied) || occupied.some(item => ![item?.x, item?.z].every(Number.isFinite))) return null;
  if (roster.tempest) return [{ type: 'tempest', x: BEACON.x, z: BEACON.z - 16, zone: 'haven', delay: 0 }];
  const result = [];
  for (let direction = 0; direction < roster.groups.length; direction++) {
    const group = roster.groups[direction], shrine = SHRINES.find(s => s.id === group.from);
    if (!shrine) return null;
    const bearing = shardBearing(shrine), delay = direction * FINALE_DIRECTION_DELAY;
    const crabRanks = Math.ceil(group.crab / FINALE_RANK_SIZE);
    // Tidebreakers form a column of their own closer in, so each one is a rank
    // deeper and a beat later than the elite ahead of it.
    const fronts = [
      { front: FINALE_ELITE_FRONT, units: rankUnits('tidebreaker', group.tidebreaker, 0, group.tidebreaker, { bearing, arc: FINALE_ARC, delay }) },
      { front: FINALE_FRONT, units: [...rankUnits('spitter', group.spitter, crabRanks, 1, { bearing, arc: FINALE_ARC, delay }),
        ...rankUnits('crab', group.crab, 0, crabRanks, { bearing, arc: FINALE_ARC, delay })] },
    ];
    for (const { front, units } of fronts) {
      if (!units.length) continue;
      const spawns = formationSpawns({ point: BEACON, bearing, arc: FINALE_ARC, front, region: 'haven', units, occupied: [...occupied, ...result] });
      if (!spawns) return null;
      for (const spawn of spawns) result.push({ ...spawn, from: group.from });
    }
  }
  return result;
}

function clipShotEndpoint(from, to) {
  if (hasWorldLineOfSight(from, to)) return to;
  let clear = 0, blocked = 1;
  const along = fraction => ({ x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction, z: from.z + (to.z - from.z) * fraction });
  // A blocked prefix stays blocked as the tracer extends. Thirteen bisections
  // stop even an 80m longshot within a centimetre of the first solid surface.
  for (let i = 0; i < 13; i++) {
    const middle = (clear + blocked) / 2;
    if (hasWorldLineOfSight(from, along(middle))) clear = middle;
    else blocked = middle;
  }
  return along(clear);
}

export function sanitizeName(value) {
  const text = typeof value === 'string' ? value : '';
  return text.replace(/[\p{C}<>]/gu, '').trim().slice(0, 16) || 'Pirate';
}

export class Game {
  constructor({ stats = {}, onEvent = () => {}, onStats = () => {}, random = Math.random } = {}) {
    this.players = new Map();
    this.enemies = new Map();
    this.onEvent = onEvent;
    this.onStats = onStats;
    this.random = random;
    this.stats = {
      wins: Math.max(0, Math.floor(Number(stats.wins) || 0)),
      voyages: Math.max(0, Math.floor(Number(stats.voyages) || 0)),
      bestPearls: Math.max(0, Math.floor(Number(stats.bestPearls) || 0)),
    };
    this.clock = 0;
    this.round = 1;
    this.hostId = null;
    this.nextEnemyId = 1;
    this.nextPingId = 1;
    this.resetRound();
  }

  resetRound() {
    this.phase = 'lobby'; this.elapsed = 0; this.pearls = 0; this.shards = 0;
    this.bossId = null; this.victory = null; this.checkpoint = { ...SPAWN };
    this.shrines = SHRINES.map(s => ({ id: s.id, status: 'dormant', charge: 0, remaining: 0 }));
    this.sideEvents = SIDE_EVENTS.map(event => ({ id: event.id, status: 'available', wave: 0, remaining: 0,
      integrity: 100, maxIntegrity: 100, startedAt: 0, endsAt: 0, finishedAt: 0 }));
    this.chests = CHESTS.map(c => ({ id: c.id, opened: false }));
    // Stage 0 means the beacon is unlit; `stages` travels in the snapshot so a
    // client can label "stage 2/3" without importing the stage table.
    this.finale = { stage: 0, stages: FINALE_STAGES.length, remaining: 0, _nextStageAt: 0, _crewCount: 1, _pending: [], _mark: null };
    this.pings = []; this.drops = []; this.enemies.clear();
    for (const p of this.players.values()) this.resetPlayer(p);
  }

  resetPlayer(p) {
    Object.assign(p, makePlayerPosition(), {
      ready: false, hp: 100, maxHp: 100, ammo: 8, maxAmmo: 8, weapon: 'flintlock', rarity: 'common',
      inventory: { flintlock: { rarity: 'common', ammo: 8 }, scatter: { rarity: 'common', ammo: 5 } },
      collectedDropIds: [],
      reloadUntil: 0, healUntil: 0, knockedUntil: 0, invulnerableUntil: 0,
      lastInputSeq: -1, _receivedInputSeq: -1, kills: 0, rescues: 0, chests: 0,
      _fireAt: 0, _meleeAt: 0, _swapAt: 0, _pingAt: 0, _damageAt: -100, _burst: null,
      _inputAt: -1, _input: { forward: 0, right: 0, sprint: false, jump: false, yaw: 0, pitch: 0 },
    });
    const slot = [...this.players.keys()].indexOf(p.id);
    p.deckX = ((Math.max(slot, 0) % 3) - 1) * 2;
    p.deckZ = Math.floor(Math.max(slot, 0) / 3) * 2;
    movePlayer(p, p._input, 0, 0);
  }

  get onlineCount() { return [...this.players.values()].filter(p => p.online).length; }

  resetAbandonedRound() {
    if (this.players.size || this.phase === 'lobby') return;
    this.hostId = null;
    this.round++;
    this.resetRound();
    this.emit({ kind: 'phase', phase: 'lobby' });
  }

  addPlayer(id, name, color) {
    // A new crew can arrive between the last explicit Leave and the next tick.
    this.resetAbandonedRound();
    if (this.onlineCount >= MAX_PLAYERS) return null;
    const p = { id, name: sanitizeName(name), color: COLORS.includes(color) ? color : COLORS[this.players.size % COLORS.length], online: true, _expiresAt: 0 };
    this.players.set(id, p);
    this.resetPlayer(p);
    if (this.phase !== 'lobby') {
      p.x = SPAWN.x; p.z = SPAWN.z; p.y = 32; p.mode = 'gliding'; p.grounded = false; p.vy = -6;
      p.invulnerableUntil = this.elapsed + 8;
    }
    if (!this.hostId) this.hostId = id;
    return p;
  }

  reconnect(id) {
    const p = this.players.get(id);
    if (!p || (!p.online && this.onlineCount >= MAX_PLAYERS)) return null;
    p.online = true; p._expiresAt = 0; p._input = restInput(p); p._inputAt = this.clock;
    p.lastInputSeq = -1; p._receivedInputSeq = -1;
    if (!this.hostId) this.hostId = id;
    return p;
  }

  disconnect(id, leave = false) {
    const p = this.players.get(id);
    if (!p) return;
    p.online = false; p._expiresAt = this.clock + 60; p._input = restInput(p); p._burst = null;
    if (leave) this.players.delete(id);
    if (this.hostId === id) {
      this.hostId = [...this.players.values()].find(other => other.online)?.id ?? null;
      if (this.hostId) this.emit({ kind: 'notice', message: `${this.players.get(this.hostId).name} is now captain.` });
    }
  }

  emit(event) { this.onEvent(event); }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p?.online) return bad('Join the crew first.', 'NOT_JOINED');
    if (!Number.isSafeInteger(input.seq) || input.seq < 0 || input.seq > 2 ** 31 - 1 ||
      !['forward', 'right', 'yaw', 'pitch'].every(k => typeof input[k] === 'number' && Number.isFinite(input[k]))) {
      return bad('Invalid movement input.', 'BAD_INPUT');
    }
    if (input.seq <= p._receivedInputSeq) return good();
    p._receivedInputSeq = input.seq;
    p._input = { forward: clamp(input.forward, -1, 1), right: clamp(input.right, -1, 1),
      yaw: ((input.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI,
      pitch: clamp(input.pitch, -1.35, 1.35), jump: input.jump === true, sprint: input.sprint === true };
    p.yaw = p._input.yaw; p.pitch = p._input.pitch; p._inputAt = this.clock;
    return good();
  }

  action(id, action, target) {
    const p = this.players.get(id);
    if (!p?.online) return bad('Join the crew first.', 'NOT_JOINED');
    if (!ACTIONS.has(action)) return bad('Unknown crew action.', 'BAD_ACTION');
    if (target !== undefined && (typeof target !== 'string' || target.length > 80)) return bad('Invalid action target.', 'BAD_TARGET');
    if (action === 'ready') { p.ready = !p.ready; return good(); }
    if (action === 'launch') {
      if (this.hostId !== id) return bad('Only the captain can set sail.', 'HOST_ONLY');
      if (this.phase !== 'lobby') return bad('The voyage has already begun.');
      this.phase = 'voyage'; this.elapsed = 0; this.stats.voyages++;
      for (const crew of this.players.values()) this.resetPlayer(crew);
      for (const spawn of encounterSpawns(this.onlineCount)) {
        const enemy = this.spawnEnemy(spawn.type, spawn.x, spawn.z, spawn.zone);
        enemy._camp = spawn.group;
      }
      this.onStats({ ...this.stats }); this.emit({ kind: 'phase', phase: this.phase });
      return good();
    }
    if (action === 'restart') {
      if (this.hostId !== id) return bad('Only the captain can start another voyage.', 'HOST_ONLY');
      if (this.phase !== 'victory') return bad('Finish this voyage before beginning another.');
      this.round++; this.resetRound(); this.emit({ kind: 'phase', phase: 'lobby' });
      return good();
    }
    if (this.phase !== 'voyage' && this.phase !== 'finale') return bad('Set sail to begin the adventure.');
    if (p.knockedUntil) return bad('Your crew will rescue you in a moment.', 'DOWNED');
    if (action === 'ping') return this.ping(p);
    if (p.mode === 'aboard') return bad('Jump from the ship to join the adventure.');
    if (action === 'fire') return this.fire(p);
    if (action === 'melee') return this.melee(p);
    if (action === 'reload') return this.reload(p);
    if (action === 'swap') return this.swap(p, target);
    if (action === 'heal') return this.heal(p);
    if (action === 'interact') return this.interact(p, target);
    return good();
  }

  reload(p) {
    const w = WEAPONS[p.weapon];
    if (p.reloadUntil || p.ammo >= p.maxAmmo) return good();
    p._burst = null;
    p.reloadUntil = this.elapsed + w.reload;
    this.emit({ kind: 'reload', playerId: p.id });
    return good();
  }

  swap(p, weapon) {
    if (!Object.hasOwn(WEAPONS, weapon)) return bad('Choose one of the five weapon slots.', 'BAD_TARGET');
    if (!Object.hasOwn(p.inventory, weapon)) return bad(`Find a ${WEAPONS[weapon].name} in a chest first.`, 'NOT_OWNED');
    if (p.weapon === weapon || this.elapsed < p._swapAt) return good();
    this.equip(p, weapon);
    this.emit({ kind: 'swap', playerId: p.id, weapon, rarity: p.rarity });
    return good();
  }

  equip(p, weapon) {
    p.inventory[p.weapon].ammo = p.ammo;
    p.weapon = weapon; p.rarity = p.inventory[weapon].rarity;
    p.maxAmmo = WEAPONS[weapon].ammo; p.ammo = p.inventory[weapon].ammo;
    p.reloadUntil = 0; p._burst = null; p._swapAt = this.elapsed + 0.9;
    p._fireAt = Math.max(p._fireAt, this.elapsed + 0.5);
  }

  pickupWeapon(p, drop) {
    if (p.collectedDropIds.includes(drop.id)) return bad(`You already carry an equal or better ${WEAPONS[drop.weapon].name}.`, 'DUPLICATE_WEAPON');
    const owned = p.inventory[drop.weapon];
    if (owned && RARITIES[owned.rarity].damageMultiplier >= RARITIES[drop.rarity].damageMultiplier) {
      // A gun this pirate cannot use still leaves their ground: it is salvaged
      // once per pirate for shared pearls while the drop stays for the crew.
      p.collectedDropIds.push(drop.id);
      this.pearls += SALVAGE_PEARLS;
      this.emit({ kind: 'salvage', id: drop.id, playerId: p.id, weapon: drop.weapon, rarity: drop.rarity, pearls: SALVAGE_PEARLS });
      return good();
    }
    // Keep the shared drop for the crew; each pirate records their own pickup.
    // Upgrades preserve both active and inactive magazines.
    if (p.weapon === drop.weapon) owned.ammo = p.ammo;
    p.inventory[drop.weapon] = { rarity: drop.rarity, ammo: owned?.ammo ?? WEAPONS[drop.weapon].ammo };
    this.equip(p, drop.weapon);
    p.collectedDropIds.push(drop.id);
    this.emit({ kind: 'loot', id: drop.id, playerId: p.id, weapon: drop.weapon, rarity: drop.rarity, upgraded: !!owned });
    return good();
  }

  fire(p) {
    const t = this.elapsed, w = weaponStats(p.weapon, p.rarity);
    if (t + 1e-8 < p._fireAt || p.reloadUntil || p._burst) return good();
    if (p.ammo <= 0) return this.reload(p);
    p._fireAt = t + w.cooldown;
    if (w.burst) p._burst = { weapon: p.weapon, rarity: p.rarity, yaw: p.yaw, pitch: p.pitch, remaining: w.burst - 1, nextAt: t + w.burstInterval };
    this.fireRound(p);
    return good();
  }

  fireRound(p, aim = p) {
    if (p.ammo <= 0 || p.reloadUntil) { p._burst = null; return; }
    const w = weaponStats(p.weapon, p.rarity);
    p.ammo--; p.inventory[p.weapon].ammo = p.ammo;
    const from = { x: p.x, y: p.y + 1.25, z: p.z };
    const pellets = p.weapon === 'scatter' ? [[0, 0], [-0.06, 0.025], [0.06, 0.025], [-0.035, -0.045], [0.035, -0.045]] : [[0, 0]];
    for (const [yawOffset, pitchOffset] of pellets) {
      const yaw = aim.yaw + yawOffset, pitch = aim.pitch + pitchOffset;
      const direction = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
      const hit = this.raycast(from, direction, w.range);
      const to = hit ? { x: hit.x, y: hit.y + hit.radius * 0.8, z: hit.z } : clipShotEndpoint(from, {
        x: from.x + direction.x * w.range, y: from.y + direction.y * w.range, z: from.z + direction.z * w.range,
      });
      const damage = hit ? Math.min(hit.hp, w.damage) : 0;
      this.emit({ kind: 'shot', playerId: p.id, from, to, weapon: p.weapon, ...(hit ? { hitId: hit.id, damage } : {}) });
      if (hit) this.damageEnemy(hit, w.damage, p.id);
    }
    if (!p.ammo) this.reload(p);
  }

  raycast(from, direction, range) {
    let best = null, bestDistance = Infinity;
    for (const e of this.enemies.values()) {
      if (e.hp <= 0) continue;
      const x = e.x - from.x, y = e.y + e.radius * 0.8 - from.y, z = e.z - from.z;
      const d = Math.hypot(x, y, z), along = x * direction.x + y * direction.y + z * direction.z;
      if (d > range + e.radius || along <= 0 || along >= bestDistance) continue;
      const offAxis = Math.sqrt(Math.max(0, d * d - along * along));
      if (offAxis > e.radius + Math.tan(8 * Math.PI / 180) * along) continue;
      if (hasWorldLineOfSight(from, sightPoint(e, e.radius * 0.8))) { best = e; bestDistance = along; }
    }
    return best;
  }

  melee(p) {
    if (this.elapsed + 1e-8 < p._meleeAt) return good();
    p._meleeAt = this.elapsed + 0.6;
    this.emit({ kind: 'melee', playerId: p.id, x: p.x, y: p.y + 1, z: p.z, yaw: p.yaw });
    for (const e of [...this.enemies.values()]) {
      const d = distance(p, e);
      if (d > 3 + e.radius || Math.abs(p.y - e.y) > 3 || !canReach(p, e)) continue;
      const dot = ((e.x - p.x) * -Math.sin(p.yaw) + (e.z - p.z) * -Math.cos(p.yaw)) / (d || 1);
      if (dot > 0.35 || d < 1.2) this.damageEnemy(e, 32, p.id);
    }
    return good();
  }

  damageEnemy(e, amount, sourceId) {
    if (e.hp <= 0 || !this.enemies.has(e.id)) return;
    const damage = Math.min(e.hp, amount);
    e.hp -= damage;
    this.emit({ kind: 'hit', targetId: e.id, damage, x: e.x, y: e.y + e.radius, z: e.z, sourceId });
    if (e.hp > 0) return;
    this.enemies.delete(e.id);
    const p = this.players.get(sourceId); if (p) p.kills++;
    this.pearls += enemyStats(e.type).pearls;
    this.emit({ kind: 'defeated', id: e.id, x: e.x, y: e.y, z: e.z, type: e.type });
    // Minions are conjured by the boss rather than by a stage, so they leave
    // with it and never hold a stage open.
    if (e.type === 'tempest') for (const minion of [...this.enemies.values()]) if (minion._bossMinion) this.enemies.delete(minion.id);
    // Settle here as well as on tick, so killing the last enemy of the last
    // stage wins in the same call.
    if (e._finale) this.settleFinale();
  }

  heal(p) {
    if (this.elapsed < p.healUntil) return good();
    p.healUntil = this.elapsed + 20;
    for (const ally of this.players.values()) if (ally.online && !ally.knockedUntil && distance(p, ally) <= 9) ally.hp = Math.min(ally.maxHp, ally.hp + 35);
    this.emit({ kind: 'heal', playerId: p.id });
    return good();
  }

  ping(p) {
    if (this.elapsed < p._pingAt) return good();
    p._pingAt = this.elapsed + 1;
    const ping = { id: `ping-${this.nextPingId++}`, playerId: p.id, x: p.x, z: p.z, expiresAt: this.elapsed + 8 };
    this.pings = this.pings.filter(item => item.playerId !== p.id); this.pings.push(ping);
    this.emit({ kind: 'ping', playerId: p.id, x: p.x, z: p.z });
    return good();
  }

  interact(p, target) {
    if (p.mode !== 'ground') return bad('Land near the treasure to interact.', 'TOO_FAR');
    const options = [];
    for (const ally of this.players.values()) if (ally.id !== p.id && ally.online && ally.knockedUntil) options.push({ id: ally.id, kind: 'revive', data: ally, range: 3.5, point: ally });
    // Chests open by walking over them (see tick); an explicit or nearby E
    // target remains a fallback for clients that still send it.
    for (const chest of this.chests) if (!chest.opened) options.push({ id: chest.id, kind: 'chest', data: chest, range: 3.5, point: CHEST_POINTS.get(chest.id) });
    // Retained weapons must not mask nearby E interactions. Explicit drop
    // targets remain supported for clients that still send pickup actions.
    if (target) for (const drop of this.drops) options.push({ id: drop.id, kind: 'loot', data: drop, range: 3.5, point: drop });
    for (const shrine of this.shrines) if (shrine.status === 'dormant') options.push({ id: shrine.id, kind: 'shrine', data: shrine, range: 4, point: SHRINES.find(s => s.id === shrine.id) });
    if (this.phase === 'voyage' && p.hp > 0 && p.grounded && !this.sideEvents.some(event => event.status === 'active')) {
      for (const event of this.sideEvents) if (event.status === 'available') {
        const point = SIDE_EVENTS.find(definition => definition.id === event.id);
        options.push({ id: event.id, kind: 'side-event', range: point.interactionRange, point });
      }
    }
    if (this.shards === 3 && this.phase === 'voyage') options.push({ id: BEACON.id, kind: 'beacon', range: 4, point: BEACON });
    const reachable = options.filter(o => (!target || o.id === target) && distance(p, o.point) <= o.range && Math.abs(p.y - (o.point.y ?? heightAt(o.point.x, o.point.z))) < 3 && canReach(p, o.point));
    reachable.sort((a, b) => (a.kind === 'revive' ? -10 : distance(p, a.point)) - (b.kind === 'revive' ? -10 : distance(p, b.point)));
    const option = reachable[0];
    if (!option) return bad(target === BEACON.id && this.shards < 3 ? 'Find all three compass shards first.' : 'Move closer with a clear path to treasure, a shrine, or a fallen friend.', 'TOO_FAR');
    if (option.kind === 'revive') { this.revive(option.data, p); return good(); }
    if (option.kind === 'side-event') return this.startSideEvent(p, option.id);
    if (option.kind === 'loot') return this.pickupWeapon(p, option.data);
    if (option.kind === 'chest') this.openChest(p, option.data, option.point);
    else if (option.kind === 'shrine') {
      option.data.status = 'active';
      const n = 3 + 2 * (clamp(this.onlineCount, 1, MAX_PLAYERS) - 1);
      for (let i = 0; i < n; i++) {
        const angle = i / n * Math.PI * 2 + 0.3;
        this.spawnEnemy(i === n - 1 && n > 3 ? 'spitter' : 'crab', option.point.x + Math.cos(angle) * 12, option.point.z + Math.sin(angle) * 12, option.point.region, option.id);
      }
      option.data.remaining = n;
      this.emit({ kind: 'shrine', id: option.id, status: 'active' });
    } else if (option.kind === 'beacon') {
      this.phase = 'finale';
      for (const event of this.sideEvents) if (event.status === 'active') this.finishSideEvent(event, 'cancelled');
      // The crew that lights the beacon is the crew every stage is sized for.
      this.finale._crewCount = Math.max(1, this.onlineCount);
      this.emit({ kind: 'phase', phase: 'finale' });
      this.startFinaleStage(1);
    }
    return good();
  }

  openChest(p, chest, point = CHEST_POINTS.get(chest.id)) {
    chest.opened = true; p.chests++; this.pearls += CHEST_PEARLS;
    for (const ally of this.players.values()) if (ally.online && !ally.knockedUntil && distance(p, ally) < 10) ally.hp = Math.min(100, ally.hp + 22);
    const rolled = rollWeapon(this.random);
    const drop = { id: `drop-${this.round}-${chest.id}`, ...rolled, x: point.x, y: point.y, z: point.z };
    this.drops.push(drop);
    this.emit({ kind: 'chest', id: chest.id, playerId: p.id, pearls: CHEST_PEARLS, ...rolled, dropId: drop.id });
  }

  startSideEvent(p, id) {
    const point = SIDE_EVENTS.find(definition => definition.id === id), event = this.sideEvents.find(item => item.id === id);
    if (!point || !event || event.status !== 'available' || this.phase !== 'voyage' ||
      this.sideEvents.some(item => item.status === 'active')) return bad('That optional defense is not available.');
    if (!p?.online || p.hp <= 0 || p.knockedUntil || p.mode !== 'ground' || !p.grounded ||
      distance(p, point) > point.interactionRange || Math.abs(p.y - heightAt(point.x, point.z)) >= 3 - 1e-8 || !canReach(p, point)) {
      return bad('Stand near the cyan supplies with a clear path to begin.', 'TOO_FAR');
    }
    const crewCount = Math.max(1, this.onlineCount);
    const spawns = sideEventSpawns(id, crewCount, 1, [...this.enemies.values()]);
    if (!spawns) return bad('The supplies need a clear approach. Try again in a moment.');
    Object.assign(event, { status: 'active', wave: 1, integrity: 100, startedAt: this.elapsed,
      endsAt: this.elapsed + SIDE_EVENT_DURATION, finishedAt: 0, _crewCount: crewCount, _nextWaveAt: 0, _pending: [] });
    this.spawnSideEventWave(event, spawns);
    this.notifySideEvent(event, `${point.name}: crabs are surging in from the sea! Keep them off the cyan supplies.`, undefined, spawns);
    return good();
  }

  // A surge arrives rank by rank: the front rank lands now and the rest wait on
  // the holder (a defense event or the finale) until their delay elapses, so a
  // wave streams onto the objective instead of landing as one clump.
  queueSpawns(holder, spawns, mark) {
    holder._pending = []; holder._mark = mark;
    for (const spawn of spawns) {
      if (spawn.delay > 0) holder._pending.push({ ...spawn, at: this.elapsed + spawn.delay });
      else this.placeSpawn(holder, spawn, mark);
    }
  }

  placeSpawn(holder, spawn, mark = holder._mark) {
    const enemy = this.spawnEnemy(spawn.type, spawn.x, spawn.z, spawn.zone, null, holder._crewCount);
    Object.assign(enemy, mark);
    enemy._sideWaypoint = spawn.waypoint ? { x: spawn.waypoint.x, z: spawn.waypoint.z, waypoint: true } : null;
    // The boss is the only enemy the snapshot names, whichever stage brings it.
    if (enemy.type === 'tempest') this.bossId = enemy.id;
    return enemy;
  }

  releaseSpawns(holder, until = this.elapsed) {
    const pending = holder?._pending;
    if (!pending?.length) return;
    holder._pending = pending.filter(spawn => spawn.at > until + 1e-8);
    for (const spawn of pending) if (spawn.at <= until + 1e-8) this.placeSpawn(holder, spawn, holder._mark);
  }

  spawnSideEventWave(event, spawns) {
    this.queueSpawns(event, spawns, { _sideEvent: event.id });
    event.remaining = spawns.length;
  }

  // Wave spawns travel with the event so every client can stage the surge and
  // its banner; the snapshot never carries individual spawn points.
  notifySideEvent(event, message, reward, spawns) {
    this.emit({ kind: 'side-event', id: event.id, status: event.status, wave: event.wave,
      ...(reward === undefined ? {} : { reward }),
      ...(spawns ? { spawns: spawns.map(spawn => ({ type: spawn.type, x: Math.round(spawn.x * 10) / 10, z: Math.round(spawn.z * 10) / 10, delay: Math.round(spawn.delay * 10) / 10 })) } : {}) });
    if (message) this.emit({ kind: 'notice', message });
  }

  finishSideEvent(event, status) {
    if (event.status !== 'active') return;
    const point = SIDE_EVENTS.find(definition => definition.id === event.id);
    event.status = status; event.remaining = 0; event.finishedAt = this.elapsed; event._nextWaveAt = 0; event._pending = [];
    for (const enemy of this.enemies.values()) if (enemy._sideEvent === event.id) this.enemies.delete(enemy.id);
    if (status === 'completed') {
      this.pearls += point.reward;
      for (const p of this.players.values()) if (p.online && p.hp > 0 && !p.knockedUntil && p.mode === 'ground' &&
        distance(p, point) <= point.radius && Math.abs(p.y - heightAt(point.x, point.z)) < 3 && canReach(p, point)) {
        p.hp = Math.min(p.maxHp, p.hp + 25);
      }
      this.notifySideEvent(event, `${point.name}: supplies saved! +${point.reward} shared pearls.`, point.reward);
    } else this.notifySideEvent(event, status === 'failed' ? 'Supplies lost. Your compass quest continues.' : null);
  }

  tickSideEvents(advanceWaves = true) {
    for (const event of this.sideEvents) {
      if (event.status !== 'active') continue;
      if (this.phase !== 'voyage') { this.finishSideEvent(event, 'cancelled'); continue; }
      if (event.integrity <= 0 || this.elapsed + 1e-8 >= event.endsAt) { this.finishSideEvent(event, 'failed'); continue; }
      this.releaseSpawns(event);
      // Ranks still forming up count as remaining, so a wave never completes
      // while part of it has yet to surge in.
      event.remaining = [...this.enemies.values()].filter(enemy => enemy._sideEvent === event.id).length + event._pending.length;
      if (!advanceWaves || event.remaining) continue;
      if (event.wave === SIDE_EVENT_WAVES) { this.finishSideEvent(event, 'completed'); continue; }
      if (!event._nextWaveAt) event._nextWaveAt = this.elapsed + 3;
      if (this.elapsed + 1e-8 < event._nextWaveAt) continue;
      const spawns = sideEventSpawns(event.id, event._crewCount, event.wave + 1, [...this.enemies.values()]);
      if (!spawns) { this.finishSideEvent(event, 'failed'); continue; }
      event.wave++; event._nextWaveAt = 0;
      this.spawnSideEventWave(event, spawns);
      this.notifySideEvent(event, null, undefined, spawns);
    }
  }

  // Stage numbers index FINALE_STAGES, so a new stage is added by appending to
  // that table: nothing here knows which stage brings the boss.
  startFinaleStage(n) {
    const definition = FINALE_STAGES[n - 1];
    if (!definition) return;
    const spawns = finaleStageSpawns(n, this.finale._crewCount, [...this.enemies.values()]);
    // A crowded lighthouse can block every candidate; retry a second later
    // rather than skipping a stage or throwing mid-tick.
    if (!spawns) { this.finale._nextStageAt = this.elapsed + 1; return; }
    this.finale.stage = n; this.finale._nextStageAt = 0;
    this.queueSpawns(this.finale, spawns, { _finale: n });
    this.finale.remaining = spawns.length;
    this.emit({ kind: 'finale', stage: n, stages: FINALE_STAGES.length,
      spawns: spawns.map(spawn => ({ type: spawn.type, x: Math.round(spawn.x * 10) / 10, z: Math.round(spawn.z * 10) / 10,
        delay: Math.round(spawn.delay * 10) / 10, ...(spawn.from ? { from: spawn.from } : {}) })) });
    this.emit({ kind: 'notice', message: definition.notice });
  }

  tickFinale() {
    // Stage 0 with a retry pending is a first stage that had no room yet; a
    // finale phase with no stage and no retry stays inert.
    if (this.phase !== 'finale' || (this.finale.stage < 1 && !this.finale._nextStageAt)) return;
    this.releaseSpawns(this.finale);
    this.settleFinale();
  }

  // A stage ends only when everything it brought is gone, pending ranks
  // included; the voyage is won when the last stage in the table is cleared.
  settleFinale() {
    const finale = this.finale;
    finale.remaining = [...this.enemies.values()].filter(enemy => enemy._finale === finale.stage).length + finale._pending.length;
    if (finale.remaining) return;
    if (finale.stage >= finale.stages) { this.win(); return; }
    if (!finale._nextStageAt) finale._nextStageAt = this.elapsed + FINALE_STAGE_DELAY;
    else if (this.elapsed + 1e-8 >= finale._nextStageAt) this.startFinaleStage(finale.stage + 1);
  }

  routeDestination(enemy, point) {
    const radius = routeRadius(enemy);
    if (sideEventPathClear(enemy, point, radius)) { enemy._sideWaypoint = null; return point; }
    if (enemy._sideWaypoint && distance(enemy, enemy._sideWaypoint) > 0.2) return enemy._sideWaypoint;
    if (this.elapsed < (enemy._sideRouteAt ?? 0)) return enemy;
    enemy._sideRouteAt = this.elapsed + 0.75;
    // A pursuit may draw a defender behind a building. Find a clear two-leg
    // return route around it instead of repeatedly pushing against its wall.
    enemy._sideWaypoint = sideEventWaypoint(enemy, point, radius);
    return enemy._sideWaypoint ?? enemy;
  }

  spawnEnemy(type, x, z, zone, shrine = null, crewCount = this.onlineCount) {
    const stats = enemyStats(type), boss = type === 'tempest';
    const point = resolveWorldCollision({ x, y: heightAt(x, z), z }, boss ? 1.7 : stats.miniBoss ? 1.2 : 0.8);
    x = point.x; z = point.z;
    const hp = stats.hp + (stats.hpPerExtraPlayer ?? 0) * Math.max(0, crewCount - 1);
    const e = { id: `enemy-${this.nextEnemyId++}`, type, x, y: heightAt(x, z), z, yaw: 0, hp, maxHp: hp,
      radius: stats.radius, scale: stats.scale,
      state: 'idle', attackAt: 0, attackRadius: stats.attackRadius, zone,
      _home: { x, z }, _shrine: shrine, _camp: null, _patrolIndex: 0, _nextAttack: this.elapsed + 1.4, _attack: null,
      _summonAt: this.elapsed + 12, _attackCount: 0, _endAttack: 0 };
    this.enemies.set(e.id, e);
    return e;
  }

  damagePlayer(p, amount, sourceId) {
    if (!p.online || p.knockedUntil || p.mode === 'aboard' || this.elapsed < p.invulnerableUntil) return;
    p.hp = Math.max(0, p.hp - amount); p._damageAt = this.elapsed;
    this.emit({ kind: 'hit', targetId: p.id, damage: amount, x: p.x, y: p.y + 1, z: p.z, sourceId });
    if (!p.hp) {
      p.knockedUntil = this.elapsed + 8; p._input = restInput(p); p._burst = null;
      this.emit({ kind: 'downed', playerId: p.id });
    }
  }

  revive(p, by = null) {
    p.hp = 65; p.knockedUntil = 0; p.invulnerableUntil = this.elapsed + 3; p._damageAt = this.elapsed;
    if (!by) {
      const slot = Math.max(0, [...this.players.keys()].indexOf(p.id));
      p.x = this.checkpoint.x + 2 + slot * 0.8; p.z = this.checkpoint.z + 3;
      p.y = heightAt(p.x, p.z); p.mode = 'ground'; p.grounded = true; p.vy = 0;
    } else by.rescues++;
    p._input = restInput(p);
    this.emit({ kind: 'revive', playerId: p.id, ...(by ? { by: by.id } : {}) });
  }

  tick(dt = 0.05) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    this.clock += dt;
    if (this.phase !== 'lobby' && this.phase !== 'victory') this.elapsed += dt;
    for (const p of [...this.players.values()]) {
      if (!p.online) { if (this.clock >= p._expiresAt) this.players.delete(p.id); continue; }
      // Inputs retire only when this simulation tick consumes them. Downed
      // and victory inputs are consumed as no-ops so they cannot replay later.
      if (this.phase === 'victory') { p.lastInputSeq = p._receivedInputSeq; continue; }
      if (p.knockedUntil) { if (this.elapsed >= p.knockedUntil) this.revive(p); p.lastInputSeq = p._receivedInputSeq; continue; }
      const input = this.clock - p._inputAt < 0.4 ? p._input : restInput(p);
      movePlayer(p, this.phase === 'lobby' ? { ...input, jump: false } : input, dt, this.phase === 'lobby' ? 0 : this.elapsed);
      p.lastInputSeq = p._receivedInputSeq;
      if (p.reloadUntil && this.elapsed + 1e-8 >= p.reloadUntil) { p.ammo = p.maxAmmo; p.inventory[p.weapon].ammo = p.ammo; p.reloadUntil = 0; }
      if ((this.phase === 'voyage' || this.phase === 'finale') && p.hp > 0 && p.mode === 'ground' && p.grounded) {
        // Walking over treasure opens it, and its gun is collected or salvaged
        // on the same tick; no key press is needed for either.
        for (const chest of this.chests) {
          if (chest.opened) continue;
          const point = CHEST_POINTS.get(chest.id);
          if (distance(p, point) <= PICKUP_RADIUS && Math.abs(p.y - point.y) < 3 && canReach(p, point)) this.openChest(p, chest, point);
        }
        for (const drop of this.drops) {
          if (distance(p, drop) <= PICKUP_RADIUS && Math.abs(p.y - drop.y) < 3 && canReach(p, drop)) this.pickupWeapon(p, drop);
        }
      }
      if (p._burst && (p.weapon !== p._burst.weapon || p.rarity !== p._burst.rarity || p.mode === 'aboard')) p._burst = null;
      if (p._burst && this.elapsed + 1e-8 >= p._burst.nextAt) {
        p._burst.remaining--; p._burst.nextAt += WEAPONS[p.weapon].burstInterval;
        const complete = p._burst.remaining === 0;
        this.fireRound(p, p._burst);
        if (complete) p._burst = null;
      }
      if (this.phase !== 'lobby' && this.elapsed - p._damageAt > 8) p.hp = Math.min(p.maxHp, p.hp + 7 * dt);
    }
    this.resetAbandonedRound();
    if (this.phase !== 'voyage' && this.phase !== 'finale') return;
    this.tickSideEvents(false);
    for (const e of [...this.enemies.values()]) this.tickEnemy(e, dt);
    this.tickFinale();
    this.tickSideEvents();
    for (const shrine of this.shrines) {
      if (shrine.status !== 'active') continue;
      shrine.remaining = [...this.enemies.values()].filter(e => e._shrine === shrine.id).length;
      if (shrine.remaining) continue;
      const point = SHRINES.find(s => s.id === shrine.id);
      const crew = [...this.players.values()].filter(p => p.online && !p.knockedUntil && p.mode === 'ground' && distance(p, point) <= 9);
      if (!crew.length) continue;
      shrine.charge = Math.min(1, shrine.charge + dt / 5);
      if (shrine.charge < 1 - 1e-8) continue;
      shrine.charge = 1; shrine.status = 'cleared'; this.shards++; this.pearls += 25; this.checkpoint = { x: point.x, z: point.z };
      for (const p of crew) p.hp = p.maxHp;
      this.emit({ kind: 'shrine', id: shrine.id, status: 'cleared' });
      this.emit({ kind: 'notice', message: this.shards === 3 ? 'All compass shards found! Return to Tideglass Lighthouse.' : `${point.name} restored! A new rescue checkpoint is ready.` });
    }
    this.pings = this.pings.filter(p => p.expiresAt > this.elapsed);
  }

  tickEnemy(e, dt) {
    const t = this.elapsed;
    if (!this.enemies.has(e.id)) return;
    const defense = e._sideEvent ? this.sideEvents.find(event => event.id === e._sideEvent) : null;
    const supplies = defense ? SIDE_EVENTS.find(point => point.id === defense.id) : null;
    if (e._sideEvent && (defense?.status !== 'active' || defense.integrity <= 0)) return;
    const stats = enemyStats(e.type);
    if (e.state === 'windup') {
      if (t + 1e-8 < e.attackAt) return;
      const a = e._attack;
      for (const p of this.players.values()) {
        if (!p.online || p.knockedUntil || p.mode !== 'ground') continue;
        if ((e._camp || e._sideEvent) && inSafeLanding(p)) continue;
        if (distance(p, a) < a.radius + 0.5 && Math.abs(p.y - heightAt(a.x, a.z)) < 3 && canReach(e, p)) this.damagePlayer(p, stats.damage, e.id);
      }
      this.emit({ kind: 'splash', x: a.x, y: heightAt(a.x, a.z) + 0.1, z: a.z, radius: a.radius });
      if (a.sideEvent === defense?.id && supplies && distance(e, supplies) <= 3 + (stats.miniBoss ? 1 : 0) && !inSafeLanding(e) &&
        Math.abs(e.y - heightAt(supplies.x, supplies.z)) < 3 && canReach(e, supplies)) {
        defense.integrity = Math.max(0, defense.integrity - (stats.supplyDamage ?? 8));
      }
      e.state = 'attack'; e._endAttack = t + 0.3;
      e._nextAttack = t + (stats.miniBoss ? 1.6 : a.sideEvent || e.type === 'tempest' ? 1.2 : 1.65);
      return;
    }
    if (e.state === 'attack') { if (t < e._endAttack) return; e.state = 'idle'; }
    // Stage attackers converge on the lighthouse, not on the point they spawned
    // at, and only chase a pirate they can actually walk to.
    const stageAttacker = !!e._finale && e.type !== 'tempest';
    const targets = [...this.players.values()].filter(p => p.online && p.hp > 0 && !p.knockedUntil && p.mode === 'ground' &&
      !((e._camp || e._sideEvent) && inSafeLanding(p)) &&
      (supplies ? distance(p, supplies) < supplies.radius + 8 && distance(p, e) < 18 :
        stageAttacker ? distance(p, BEACON) < 60 && distance(p, e) < 30 :
        distance(p, e._home) < (e.type === 'tempest' ? 55 : e._shrine ? 38 : e._camp ? 18 : 24)) &&
      canReach(e, p) && ((!supplies && !stageAttacker) || sideEventPathClear(e, p)));
    targets.sort((a, b) => distance(a, e) - distance(b, e));
    const target = targets[0];
    if (e.type === 'tempest' && target && t >= e._summonAt) {
      e._summonAt = t + 15;
      const minions = [...this.enemies.values()].filter(other => other._bossMinion).length;
      if (minions < 4) {
        for (let i = 0; i < Math.min(2, 4 - minions); i++) {
          const minion = this.spawnEnemy('crab', e.x + (i ? -6 : 6), e.z + 4, 'haven');
          minion._bossMinion = true;
        }
        this.emit({ kind: 'notice', message: 'Tiny tide crabs have joined the splash party!' });
      }
    }
    // Attackers that reached the dais hold it instead of stacking on one point.
    if (!target && stageAttacker && distance(e, BEACON) <= 4) { e.state = 'idle'; return; }
    let destination = target ?? (supplies ? this.routeDestination(e, supplies) : stageAttacker ? this.routeDestination(e, BEACON) : e._home);
    if (!target && supplies && distance(e, supplies) <= 2.8 + (stats.miniBoss ? 1 : 0) && Math.abs(e.y - heightAt(supplies.x, supplies.z)) < 3 && canReach(e, supplies)) {
      e.yaw = Math.atan2(-(supplies.x - e.x), -(supplies.z - e.z));
      if (t >= e._nextAttack) {
        e._attack = { x: supplies.x, z: supplies.z, radius: e.attackRadius, sideEvent: defense.id };
        e.state = 'windup'; e.attackAt = t + stats.windup;
        this.emit({ kind: 'telegraph', id: e.id, x: supplies.x, y: heightAt(supplies.x, supplies.z) + 0.08,
          z: supplies.z, radius: e.attackRadius, duration: stats.windup, style: stats.ranged ? 'splash' : 'swipe' });
      } else e.state = 'idle';
      return;
    }
    if (!target && e._camp) {
      const angle = e._patrolIndex * Math.PI * 2 / 3 + Number(e.id.split('-')[1]) * 0.7;
      destination = { x: e._home.x + Math.cos(angle) * 2.4, z: e._home.z + Math.sin(angle) * 2.4 };
      destination.y = heightAt(destination.x, destination.z);
      resolveWorldCollision(destination, e.radius * 0.7);
      if (distance(destination, e) < 0.5) e._patrolIndex = (e._patrolIndex + 1) % 3;
    }
    const d = distance(destination, e);
    if (target) {
      e.yaw = Math.atan2(-(target.x - e.x), -(target.z - e.z));
      const ranged = !!stats.ranged || (e.type === 'tempest' && (d > 8 || e._attackCount % 3 === 2));
      const canAttack = ranged ? d < (e.type === 'tempest' ? 35 : 22) : d < (e.type === 'tempest' ? 6.2 : e.attackRadius + 0.5);
      if (canAttack && t >= e._nextAttack) {
        e._attackCount++;
        const radius = ranged ? (e.type === 'tempest' ? 4 : 2.5) : e.attackRadius;
        e._attack = { x: ranged ? target.x : e.x, z: ranged ? target.z : e.z, radius };
        e.state = 'windup'; e.attackAt = t + stats.windup;
        this.emit({ kind: 'telegraph', id: e.id, x: e._attack.x, y: heightAt(e._attack.x, e._attack.z) + 0.08, z: e._attack.z, radius, duration: e.attackAt - t, style: ranged ? 'splash' : 'swipe' });
        return;
      }
      if ((ranged && d < 13) || (!ranged && d < (e.type === 'tempest' ? 4.5 : e.attackRadius - 0.5))) { e.state = 'idle'; return; }
    }
    if (d < (destination.waypoint ? 0.2 : 0.5)) { e.state = 'idle'; return; }
    e.state = target || supplies || stageAttacker ? 'chase' : 'idle';
    const speed = !target && e._camp ? 1.15 : stats.speed;
    if (!target) e.yaw = Math.atan2(-(destination.x - e.x), -(destination.z - e.z));
    const previous = { x: e.x, z: e.z };
    e.x += (destination.x - e.x) / d * Math.min(d, speed * dt);
    e.z += (destination.z - e.z) / d * Math.min(d, speed * dt);
    e.y = heightAt(e.x, e.z);
    resolveWorldCollision(e, e.radius * 0.7);
    if ((e._camp || e._sideEvent) && inSafeLanding(e)) {
      // Reject this step, so a wall beside the boundary cannot push a guard
      // back into the protected area after a radial correction.
      e.x = previous.x; e.z = previous.z;
    }
    e.y = heightAt(e.x, e.z);
  }

  win() {
    if (this.phase === 'victory') return;
    this.phase = 'victory'; this.enemies.clear();
    for (const p of this.players.values()) p._burst = null;
    this.victory = { pearls: this.pearls, duration: this.elapsed,
      rescues: [...this.players.values()].reduce((sum, p) => sum + p.rescues, 0),
      kills: [...this.players.values()].reduce((sum, p) => sum + p.kills, 0) };
    this.stats.wins++; this.stats.bestPearls = Math.max(this.stats.bestPearls, this.pearls);
    this.onStats({ ...this.stats }); this.emit({ kind: 'phase', phase: 'victory' });
    this.emit({ kind: 'victory', ...this.victory });
  }

  snapshot() {
    return { phase: this.phase, elapsed: this.elapsed, simulationTime: this.clock, seed: SEED, round: this.round, hostId: this.hostId,
      players: [...this.players.values()].map(p => ({ ...cleanObject(p, PUBLIC_PLAYER), collectedDropIds: [...p.collectedDropIds], inventory: Object.fromEntries(Object.entries(p.inventory).map(([weapon, slot]) => [weapon, { rarity: slot.rarity, ammo: slot.ammo }])) })),
      enemies: [...this.enemies.values()].map(e => cleanObject(e, PUBLIC_ENEMY)),
      sideEvents: this.sideEvents.map(event => cleanObject(event, PUBLIC_SIDE_EVENT)),
      finale: cleanObject(this.finale, ['stage', 'stages', 'remaining']),
      shrines: this.shrines.map(s => ({ ...s })), chests: this.chests.map(c => ({ ...c })), drops: this.drops.map(drop => cleanObject(drop, ['id', 'weapon', 'rarity', 'x', 'y', 'z'])),
      pearls: this.pearls, shards: this.shards, bossId: this.bossId,
      pings: this.pings.map(p => ({ ...p })), stats: { ...this.stats }, victory: this.victory ? { ...this.victory } : null };
  }
}
