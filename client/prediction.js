import { movePlayer } from '../shared/movement.js';
import { shipAt } from '../shared/world.js';

export const PREDICTION_STEP = .05;
export const PREDICTION_HISTORY_LIMIT = 100;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const point = (player) => player.mode === 'aboard'
  ? { x: player.deckX || 0, y: 0, z: player.deckZ || 0 }
  : { x: player.x, y: player.y, z: player.z };
const distance = (a, b) => {
  const from = point(a), to = point(b);
  return Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
};
const MOVEMENT_FIELDS = new Set(['x', 'y', 'z', 'deckX', 'deckZ', 'yaw', 'pitch', 'vy', 'mode', 'jumpHeld', 'grounded', 'gunId', 'shipReturned']);
const gunChanged = (a, b) => (a?.gunId || null) !== (b?.gunId || null);
const TIME_EPSILON = 1e-7;

// Snapshot delivery changes the target clock offset, never the visible time.
// Slewing at at most 15% keeps the moving deck continuous even when packets
// arrive just before/after a display frame. The known ship trajectory keeps its
// clock during a stall; prediction history is reset separately. A phase/round
// change or reconnect explicitly starts a new timeline.
export class RenderClock {
  constructor() { this.phase = null; this.round = null; this.elapsed = 0; this.lastNow = 0; }

  observe(state, now, reset = false) {
    const changed = reset || this.phase !== state.phase || this.round !== state.round;
    this.phase = state.phase;
    this.round = state.round;
    this.snapshotTime = Number.isFinite(state.elapsed) ? state.elapsed : 0;
    this.receivedAt = now;
    if (changed) {
      this.elapsed = state.phase === 'lobby' ? 0 : this.snapshotTime;
      this.lastNow = now;
    }
    return changed;
  }

  sample(now) {
    const dt = Math.max(0, (now - this.lastNow) / 1000);
    this.lastNow = Math.max(now, this.lastNow);
    if (this.phase === 'lobby') return (this.elapsed = 0);
    if (this.phase === 'victory' || this.phase === null) return this.elapsed;
    const age = Math.max(0, (now - this.receivedAt) / 1000);
    const target = this.snapshotTime + age;
    const advance = dt + clamp((target - this.elapsed - dt) * (1 - Math.exp(-4 * dt)), -dt * .15, dt * .15);
    this.elapsed += Math.max(0, advance);
    return this.elapsed;
  }
}

// Position alone is interpolated. Aim, health and movement mode remain current.
// Aboard poses use deck coordinates, composed onto the same ship time used by
// the scene. Neither old snapshots nor a correction can move feet off the deck.
export function interpolatePose(previous, current, alpha, elapsed, correction = { x: 0, y: 0, z: 0 }) {
  if (!current) return null;
  const pose = { ...current };
  const from = point(previous?.mode === current.mode && !gunChanged(previous, current) ? previous : current);
  const to = point(current);
  const fraction = clamp(alpha, 0, 1);
  const x = from.x + (to.x - from.x) * fraction + (current.gunId ? 0 : correction.x);
  const y = from.y + (to.y - from.y) * fraction + (current.gunId ? 0 : correction.y);
  const z = from.z + (to.z - from.z) * fraction + (current.gunId ? 0 : correction.z);
  if (current.mode === 'aboard') {
    const ship = shipAt(elapsed);
    pose.deckX = x; pose.deckZ = z;
    pose.x = ship.x + x; pose.y = ship.y; pose.z = ship.z + z;
  } else {
    pose.x = x; pose.y = y; pose.z = z;
  }
  return pose;
}

function shiftedPrevious(previous, current, next) {
  if (!previous || previous.mode !== next.mode || current.mode !== next.mode || gunChanged(previous, next) || gunChanged(current, next)) return { ...next };
  const result = { ...previous };
  const fields = next.mode === 'aboard' ? ['deckX', 'deckZ'] : ['x', 'y', 'z'];
  for (const field of fields) result[field] += next[field] - current[field];
  return result;
}

export class LocalPrediction {
  constructor() { this.reset(); }

  reset(player = null, { simulationTime = 0 } = {}) {
    this.current = player ? { ...player } : null;
    this.previous = player ? { ...player } : null;
    this.pending = [];
    this.history = [];
    this.simulationTime = simulationTime;
    this.future = null;
    this.correction = { x: 0, y: 0, z: 0 };
    this.authoritative = player ? { ...player } : null;
    this.lastCalibratedSeq = player?.lastInputSeq ?? -1;
  }

  step(seq, input, elapsed, phase) {
    if (!this.current) return;
    this.simulationTime += PREDICTION_STEP;
    this.previous = { ...this.current };
    if (!this.current.knockedUntil && phase !== 'victory') {
      movePlayer(this.current, input, PREDICTION_STEP, phase === 'lobby' ? 0 : elapsed);
      if (this.previous.mode !== this.current.mode || gunChanged(this.previous, this.current) || distance(this.previous, this.current) > 5) {
        this.previous = { ...this.current };
        this.correction = { x: 0, y: 0, z: 0 };
      }
      const entry = { seq, time: this.simulationTime, input: { ...input }, dt: PREDICTION_STEP };
      this.pending.push(entry);
      this.history.push(entry);
      if (this.pending.length > PREDICTION_HISTORY_LIMIT) this.pending.splice(0, this.pending.length - PREDICTION_HISTORY_LIMIT);
      if (this.history.length > PREDICTION_HISTORY_LIMIT) this.history.splice(0, this.history.length - PREDICTION_HISTORY_LIMIT);
    }
    if (this.future && this.future.simulationTime <= this.simulationTime + TIME_EPSILON) {
      const snapshot = this.future;
      this.future = null;
      this.reconcile(snapshot.player, { ...snapshot, alpha: 0, renderElapsed: elapsed });
    }
  }

  sample(alpha, elapsed) { return interpolatePose(this.previous, this.current, alpha, elapsed, this.correction); }

  decay(dt) {
    const scale = Math.exp(-12 * Math.max(0, dt));
    this.correction.x *= scale; this.correction.y *= scale; this.correction.z *= scale;
  }

  reconcile(player, { phase, elapsed, simulationTime = elapsed, renderElapsed = elapsed, alpha = 0, force = false }) {
    const oldPose = this.sample(alpha, renderElapsed);
    const recovered = this.authoritative && !!this.authoritative.knockedUntil !== !!player.knockedUntil;
    const replaced = this.current && this.current.id !== player.id;
    const stationChanged = this.authoritative && gunChanged(this.authoritative, player);
    const returned = this.authoritative && !!this.authoritative.shipReturned !== !!player.shipReturned;
    const boarded = this.authoritative && this.authoritative.mode !== 'aboard' && player.mode === 'aboard';
    if (force || !this.current || recovered || replaced || stationChanged || returned || boarded) {
      this.reset(player, { simulationTime });
      return;
    }
    // A consumed packet cannot belong to a future authority tick. Clock drift
    // used to replay these already-consumed walking steps, then unwind them
    // after key release. Use advancing ACKs to bound the clock offset, without
    // interpreting an ACK jump (or a repeated ACK) as a number of server ticks.
    if (player.lastInputSeq > this.lastCalibratedSeq) {
      const consumed = this.history.findLast(entry => entry.seq <= player.lastInputSeq);
      const skew = consumed ? consumed.time - simulationTime : 0;
      if (skew > TIME_EPSILON) {
        this.simulationTime -= skew;
        for (const entry of this.history) entry.time -= skew;
      }
      this.lastCalibratedSeq = player.lastInputSeq;
    }
    this.pending = this.pending.filter(entry => entry.seq > player.lastInputSeq);
    if (player.knockedUntil || phase === 'victory') this.pending = [];
    // A just-sent jump may belong to this client tick while the authority's
    // matching tick ran before its packet arrived. Keep that airborne edge
    // until it is consumed instead of briefly landing/reboarding the pirate.
    const pendingJump = this.pending.some(entry => entry.input.jump);
    const leavingGun = !this.current.gunId && player.gunId && !player.jumpHeld && pendingJump;
    if (leavingGun || (!this.current.grounded && player.grounded && !player.jumpHeld && pendingJump)) {
      for (const [key, value] of Object.entries(player)) if (!MOVEMENT_FIELDS.has(key)) this.current[key] = value;
      this.authoritative = { ...player };
      this.future = null;
      return;
    }
    if (simulationTime > this.simulationTime + TIME_EPSILON) {
      if (simulationTime - this.simulationTime > .5 || this.current.mode !== player.mode || gunChanged(this.current, player) || distance(this.current, player) > 5) {
        this.reset(player, { simulationTime });
        return;
      }
      // A server timer can deliver two fixed ticks between two client ticks.
      // Keep its next pose until our matching tick instead of briefly moving
      // the current interval one step ahead, then correcting it back again.
      this.future = { player: { ...player }, phase, elapsed, simulationTime };
      for (const [key, value] of Object.entries(player)) if (!MOVEMENT_FIELDS.has(key)) this.current[key] = value;
      this.authoritative = { ...player };
      return;
    }
    const next = { ...player };
    let previous = null;
    let replayTime = elapsed;
    // ACKs retire packets; they are not a count of elapsed simulation steps.
    // The authority can hold one input for several ticks or consume only the
    // latest of two packets. Replay our fixed timeline after the snapshot's
    // tick, including acknowledged inputs that are still held in that interval.
    const replay = player.knockedUntil || phase === 'victory' ? [] : this.history.filter(entry => entry.time > simulationTime + TIME_EPSILON);
    for (const entry of replay) {
      previous = { ...next };
      replayTime += entry.dt;
      movePlayer(next, entry.input, entry.dt, phase === 'lobby' ? 0 : replayTime);
    }
    // When no unacknowledged step remains, retain the current fixed interval's
    // displacement while rebasing both ends. Reusing an old, unshifted previous
    // pose here makes every acknowledgement produce a small backwards step.
    previous ??= shiftedPrevious(this.previous, this.current, next);
    const discontinuity = this.current.mode !== next.mode || gunChanged(this.current, next) || distance(this.current, next) > 5;
    this.current = next;
    this.previous = discontinuity || previous.mode !== next.mode ? { ...next } : previous;
    this.correction = { x: 0, y: 0, z: 0 };
    this.authoritative = { ...player };
    if (discontinuity) {
      this.pending = [];
      this.history = [];
      this.future = null;
      return;
    }
    if (next.gunId) return;
    // Preserve the displayed pose at this exact alpha, including the remaining
    // visual offset, then decay just this one offset on subsequent frames.
    const before = point(oldPose), after = point(this.sample(alpha, renderElapsed));
    this.correction = { x: before.x - after.x, y: before.y - after.y, z: before.z - after.z };
    const size = Math.hypot(this.correction.x, this.correction.y, this.correction.z);
    if (size > 3) for (const key of ['x', 'y', 'z']) this.correction[key] *= 3 / size;
  }
}
