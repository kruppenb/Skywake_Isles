import { MAX_PLAYERS, SEED, COLORS, SPAWN, BEACON, SHRINES, CHESTS, OBSTACLES, heightAt } from '../shared/world.js';
import { makePlayerPosition, movePlayer } from '../shared/movement.js';

export const WEAPONS = Object.freeze({
  flintlock: { ammo: 8, damage: 24, cooldown: 0.3, reload: 1.2, range: 50 },
  scatter: { ammo: 5, damage: 10, cooldown: 0.65, reload: 1.5, range: 18 },
});
const ACTIONS = new Set(['ready', 'launch', 'fire', 'melee', 'reload', 'interact', 'heal', 'ping', 'swap', 'restart']);
const PUBLIC_PLAYER = ['id', 'name', 'color', 'online', 'ready', 'x', 'y', 'z', 'yaw', 'pitch', 'vy', 'mode', 'jumpHeld', 'grounded', 'deckX', 'deckZ', 'hp', 'maxHp', 'ammo', 'maxAmmo', 'weapon', 'reloadUntil', 'healUntil', 'knockedUntil', 'invulnerableUntil', 'lastInputSeq', 'kills', 'rescues', 'chests'];
const PUBLIC_ENEMY = ['id', 'type', 'x', 'y', 'z', 'yaw', 'hp', 'maxHp', 'radius', 'state', 'attackAt', 'zone', 'scale', 'attackRadius'];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const cleanObject = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
const good = () => ({ ok: true });
const bad = (message, code = 'ACTION_DENIED') => ({ ok: false, message, code });
const restInput = p => ({ forward: 0, right: 0, sprint: false, jump: false, yaw: p.yaw, pitch: p.pitch });

export function sanitizeName(value) {
  const text = typeof value === 'string' ? value : '';
  return text.replace(/[\p{C}<>]/gu, '').trim().slice(0, 16) || 'Pirate';
}

export class Game {
  constructor({ stats = {}, onEvent = () => {}, onStats = () => {} } = {}) {
    this.players = new Map();
    this.enemies = new Map();
    this.onEvent = onEvent;
    this.onStats = onStats;
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
    this.chests = CHESTS.map(c => ({ id: c.id, opened: false }));
    this.pings = []; this.enemies.clear();
    for (const p of this.players.values()) this.resetPlayer(p);
  }

  resetPlayer(p) {
    Object.assign(p, makePlayerPosition(), {
      ready: false, hp: 100, maxHp: 100, ammo: 8, maxAmmo: 8, weapon: 'flintlock',
      reloadUntil: 0, healUntil: 0, knockedUntil: 0, invulnerableUntil: 0,
      lastInputSeq: -1, kills: 0, rescues: 0, chests: 0,
      _fireAt: 0, _meleeAt: 0, _swapAt: 0, _pingAt: 0, _damageAt: -100,
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
    p.lastInputSeq = -1;
    if (!this.hostId) this.hostId = id;
    return p;
  }

  disconnect(id, leave = false) {
    const p = this.players.get(id);
    if (!p) return;
    p.online = false; p._expiresAt = this.clock + 60; p._input = restInput(p);
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
    if (input.seq <= p.lastInputSeq) return good();
    p.lastInputSeq = input.seq;
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
      this.spawnEnemy('crab', -42, -38, 'haven');
      this.spawnEnemy('crab', -108, 56, 'jungle');
      this.spawnEnemy('spitter', 102, -6, 'moon');
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
    p.reloadUntil = this.elapsed + w.reload;
    this.emit({ kind: 'reload', playerId: p.id });
    return good();
  }

  swap(p, weapon) {
    if (!WEAPONS[weapon]) return bad('Choose a flintlock or scatter blaster.', 'BAD_TARGET');
    if (p.weapon === weapon || this.elapsed < p._swapAt) return good();
    p.weapon = weapon; p.maxAmmo = WEAPONS[weapon].ammo; p.ammo = p.maxAmmo;
    p.reloadUntil = 0; p._swapAt = this.elapsed + 0.9;
    p._fireAt = Math.max(p._fireAt, this.elapsed + 0.5);
    this.emit({ kind: 'swap', playerId: p.id, weapon });
    return good();
  }

  fire(p) {
    const t = this.elapsed, w = WEAPONS[p.weapon];
    if (t + 1e-8 < p._fireAt || p.reloadUntil) return good();
    if (p.ammo <= 0) return this.reload(p);
    p.ammo--; p._fireAt = t + w.cooldown;
    const from = { x: p.x, y: p.y + 1.25, z: p.z };
    const pellets = p.weapon === 'scatter' ? [[0, 0], [-0.06, 0.025], [0.06, 0.025], [-0.035, -0.045], [0.035, -0.045]] : [[0, 0]];
    for (const [yawOffset, pitchOffset] of pellets) {
      const yaw = p.yaw + yawOffset, pitch = p.pitch + pitchOffset;
      const direction = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
      const hit = this.raycast(from, direction, w.range);
      const to = hit ? { x: hit.x, y: hit.y + hit.radius * 0.8, z: hit.z } : {
        x: from.x + direction.x * w.range, y: from.y + direction.y * w.range, z: from.z + direction.z * w.range,
      };
      const damage = hit ? Math.min(hit.hp, w.damage) : 0;
      this.emit({ kind: 'shot', playerId: p.id, from, to, weapon: p.weapon, ...(hit ? { hitId: hit.id, damage } : {}) });
      if (hit) this.damageEnemy(hit, w.damage, p.id);
    }
    if (!p.ammo) this.reload(p);
    return good();
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
      let blocked = false;
      // The forgiving ray is still stopped by substantial island props.
      const ex = x / d, ey = y / d, ez = z / d;
      for (const o of OBSTACLES) {
        const ox = o.x - from.x, oz = o.z - from.z;
        const h2 = ex * ex + ez * ez;
        const at = (ox * ex + oz * ez) / (h2 || 1);
        if (at < 0.5 || at > d - e.radius) continue;
        const miss = Math.hypot(from.x + ex * at - o.x, from.z + ez * at - o.z);
        const yAt = from.y + ey * at, bottom = heightAt(o.x, o.z);
        if (miss < o.radius && yAt > bottom && yAt < bottom + o.height) { blocked = true; break; }
      }
      if (!blocked) { best = e; bestDistance = along; }
    }
    return best;
  }

  melee(p) {
    if (this.elapsed + 1e-8 < p._meleeAt) return good();
    p._meleeAt = this.elapsed + 0.6;
    this.emit({ kind: 'melee', playerId: p.id, x: p.x, y: p.y + 1, z: p.z, yaw: p.yaw });
    for (const e of [...this.enemies.values()]) {
      const d = distance(p, e);
      if (d > 3 + e.radius || Math.abs(p.y - e.y) > 3) continue;
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
    this.pearls += e.type === 'tempest' ? 60 : 3;
    this.emit({ kind: 'defeated', id: e.id, x: e.x, y: e.y, z: e.z, type: e.type });
    if (e.type === 'tempest') this.win();
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
    for (const chest of this.chests) if (!chest.opened) options.push({ id: chest.id, kind: 'chest', data: chest, range: 3.5, point: CHESTS.find(c => c.id === chest.id) });
    for (const shrine of this.shrines) if (shrine.status === 'dormant') options.push({ id: shrine.id, kind: 'shrine', data: shrine, range: 4, point: SHRINES.find(s => s.id === shrine.id) });
    if (this.shards === 3 && this.phase === 'voyage') options.push({ id: BEACON.id, kind: 'beacon', range: 4, point: BEACON });
    const reachable = options.filter(o => (!target || o.id === target) && distance(p, o.point) <= o.range && Math.abs(p.y - (o.point.y ?? heightAt(o.point.x, o.point.z))) < 3);
    reachable.sort((a, b) => (a.kind === 'revive' ? -10 : distance(p, a.point)) - (b.kind === 'revive' ? -10 : distance(p, b.point)));
    const option = reachable[0];
    if (!option) return bad(target === BEACON.id && this.shards < 3 ? 'Find all three compass shards first.' : 'Move closer to treasure, a shrine, or a fallen friend.', 'TOO_FAR');
    if (option.kind === 'revive') { this.revive(option.data, p); return good(); }
    if (option.kind === 'chest') {
      option.data.opened = true; p.chests++; this.pearls += 12;
      for (const ally of this.players.values()) if (ally.online && !ally.knockedUntil && distance(p, ally) < 10) ally.hp = Math.min(100, ally.hp + 22);
      this.emit({ kind: 'chest', id: option.id, playerId: p.id, pearls: 12 });
    } else if (option.kind === 'shrine') {
      option.data.status = 'active';
      const n = 3 + Math.min(2, Math.floor((this.onlineCount - 1) / 2));
      for (let i = 0; i < n; i++) {
        const angle = i / n * Math.PI * 2 + 0.3;
        this.spawnEnemy(i === n - 1 && n > 3 ? 'spitter' : 'crab', option.point.x + Math.cos(angle) * 12, option.point.z + Math.sin(angle) * 12, option.point.region, option.id);
      }
      option.data.remaining = n;
      this.emit({ kind: 'shrine', id: option.id, status: 'active' });
    } else if (option.kind === 'beacon') {
      this.phase = 'finale';
      const boss = this.spawnEnemy('tempest', BEACON.x, BEACON.z - 16, 'haven');
      this.bossId = boss.id;
      this.emit({ kind: 'phase', phase: 'finale' });
      this.emit({ kind: 'notice', message: 'The Tempest Crab has the final compass! Watch the splash circles.' });
    }
    return good();
  }

  spawnEnemy(type, x, z, zone, shrine = null) {
    // Resolve a rare spawn inside a matching physical prop.
    for (const o of OBSTACLES) {
      const d = Math.hypot(x - o.x, z - o.z), r = o.radius + 1.5;
      if (d < r) { const a = Math.atan2(z - o.z, x - o.x); x = o.x + Math.cos(a) * r; z = o.z + Math.sin(a) * r; }
    }
    const boss = type === 'tempest';
    const hp = boss ? 650 + 180 * Math.max(0, this.onlineCount - 1) : type === 'spitter' ? 60 : 52;
    const e = { id: `enemy-${this.nextEnemyId++}`, type, x, y: heightAt(x, z), z, yaw: 0, hp, maxHp: hp,
      radius: boss ? 2.4 : 0.85, scale: boss ? 3.1 : type === 'spitter' ? 1.1 : 1,
      state: 'idle', attackAt: 0, attackRadius: boss ? 5.5 : type === 'spitter' ? 2.5 : 2.3, zone,
      _home: { x, z }, _shrine: shrine, _nextAttack: this.elapsed + 1.4, _attack: null,
      _summonAt: this.elapsed + 12, _attackCount: 0, _endAttack: 0 };
    this.enemies.set(e.id, e);
    return e;
  }

  damagePlayer(p, amount, sourceId) {
    if (!p.online || p.knockedUntil || p.mode === 'aboard' || this.elapsed < p.invulnerableUntil) return;
    p.hp = Math.max(0, p.hp - amount); p._damageAt = this.elapsed;
    this.emit({ kind: 'hit', targetId: p.id, damage: amount, x: p.x, y: p.y + 1, z: p.z, sourceId });
    if (!p.hp) {
      p.knockedUntil = this.elapsed + 8; p._input = restInput(p);
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
      if (this.phase === 'victory') continue;
      if (p.knockedUntil) { if (this.elapsed >= p.knockedUntil) this.revive(p); continue; }
      const input = this.clock - p._inputAt < 0.4 ? p._input : restInput(p);
      movePlayer(p, this.phase === 'lobby' ? { ...input, jump: false } : input, dt, this.phase === 'lobby' ? 0 : this.elapsed);
      if (p.reloadUntil && this.elapsed + 1e-8 >= p.reloadUntil) { p.ammo = p.maxAmmo; p.reloadUntil = 0; }
      if (this.phase !== 'lobby' && this.elapsed - p._damageAt > 8) p.hp = Math.min(p.maxHp, p.hp + 7 * dt);
    }
    this.resetAbandonedRound();
    if (this.phase !== 'voyage' && this.phase !== 'finale') return;
    for (const e of [...this.enemies.values()]) this.tickEnemy(e, dt);
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
    if (e.state === 'windup') {
      if (t + 1e-8 < e.attackAt) return;
      const a = e._attack;
      for (const p of this.players.values()) {
        if (!p.online || p.knockedUntil || p.mode !== 'ground') continue;
        if (distance(p, a) < a.radius + 0.5 && Math.abs(p.y - heightAt(a.x, a.z)) < 3) this.damagePlayer(p, e.type === 'tempest' ? 22 : e.type === 'spitter' ? 12 : 10, e.id);
      }
      this.emit({ kind: 'splash', x: a.x, y: heightAt(a.x, a.z) + 0.1, z: a.z, radius: a.radius });
      e.state = 'attack'; e._endAttack = t + 0.3;
      e._nextAttack = t + (e.type === 'tempest' ? 1.2 : 1.65);
      return;
    }
    if (e.state === 'attack') { if (t < e._endAttack) return; e.state = 'idle'; }
    const targets = [...this.players.values()].filter(p => p.online && !p.knockedUntil && p.mode === 'ground' && distance(p, e._home) < (e.type === 'tempest' ? 55 : e._shrine ? 38 : 24));
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
    const destination = target ?? e._home;
    const d = distance(destination, e);
    if (target) {
      e.yaw = Math.atan2(-(target.x - e.x), -(target.z - e.z));
      const ranged = e.type === 'spitter' || (e.type === 'tempest' && (d > 8 || e._attackCount % 3 === 2));
      const canAttack = ranged ? d < (e.type === 'tempest' ? 35 : 22) : d < (e.type === 'tempest' ? 6.2 : 2.8);
      if (canAttack && t >= e._nextAttack) {
        e._attackCount++;
        const radius = ranged ? (e.type === 'tempest' ? 4 : 2.5) : e.attackRadius;
        e._attack = { x: ranged ? target.x : e.x, z: ranged ? target.z : e.z, radius };
        e.state = 'windup'; e.attackAt = t + (e.type === 'tempest' ? 1.05 : 0.8);
        this.emit({ kind: 'telegraph', id: e.id, x: e._attack.x, y: heightAt(e._attack.x, e._attack.z) + 0.08, z: e._attack.z, radius, duration: e.attackAt - t, style: ranged ? 'splash' : 'swipe' });
        return;
      }
      if ((ranged && d < 13) || (!ranged && d < (e.type === 'tempest' ? 4.5 : 1.8))) { e.state = 'idle'; return; }
    }
    if (d < 0.5) { e.state = 'idle'; return; }
    e.state = target ? 'chase' : 'idle';
    const speed = e.type === 'tempest' ? 3 : e.type === 'spitter' ? 2.7 : 3.6;
    e.x += (destination.x - e.x) / d * Math.min(d, speed * dt);
    e.z += (destination.z - e.z) / d * Math.min(d, speed * dt);
    for (const o of OBSTACLES) {
      const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz), r = o.radius + e.radius * 0.7;
      if (od < r) { e.x = o.x + (ox / (od || 1)) * r; e.z = o.z + (oz / (od || 1)) * r; }
    }
    e.y = heightAt(e.x, e.z);
  }

  win() {
    if (this.phase === 'victory') return;
    this.phase = 'victory'; this.enemies.clear();
    this.victory = { pearls: this.pearls, duration: this.elapsed,
      rescues: [...this.players.values()].reduce((sum, p) => sum + p.rescues, 0),
      kills: [...this.players.values()].reduce((sum, p) => sum + p.kills, 0) };
    this.stats.wins++; this.stats.bestPearls = Math.max(this.stats.bestPearls, this.pearls);
    this.onStats({ ...this.stats }); this.emit({ kind: 'phase', phase: 'victory' });
    this.emit({ kind: 'victory', ...this.victory });
  }

  snapshot() {
    return { phase: this.phase, elapsed: this.elapsed, seed: SEED, round: this.round, hostId: this.hostId,
      players: [...this.players.values()].map(p => cleanObject(p, PUBLIC_PLAYER)),
      enemies: [...this.enemies.values()].map(e => cleanObject(e, PUBLIC_ENEMY)),
      shrines: this.shrines.map(s => ({ ...s })), chests: this.chests.map(c => ({ ...c })),
      pearls: this.pearls, shards: this.shards, bossId: this.bossId,
      pings: this.pings.map(p => ({ ...p })), stats: { ...this.stats }, victory: this.victory ? { ...this.victory } : null };
  }
}
