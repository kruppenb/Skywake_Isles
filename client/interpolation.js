const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const lerp = (a, b, amount) => a + (b - a) * amount;
const poseFields = ['x', 'y', 'z', 'pitch', 'deckX', 'deckZ', 'vy'];

export function poseDiscontinuity(previous, current, dt = .05) {
  if (!previous || previous.mode !== current.mode || (previous.gunId || null) !== (current.gunId || null)
    || !!previous.shipReturned !== !!current.shipReturned || !!previous.knockedUntil !== !!current.knockedUntil) return true;
  const aboard = current.mode === 'aboard';
  const dx = finite(current[aboard ? 'deckX' : 'x']) - finite(previous[aboard ? 'deckX' : 'x']);
  const dz = finite(current[aboard ? 'deckZ' : 'z']) - finite(previous[aboard ? 'deckZ' : 'z']);
  const dy = aboard ? 0 : finite(current.y) - finite(previous.y);
  return Math.hypot(dx, dy, dz) > Math.max(3.5, Math.max(0, dt) * 24);
}

// The ship's own movement is transport, not a footstep. Use the same rule for
// local predicted poses and the displayed, interpolated poses of other crew.
export function displayedSpeed(previous, current, dt, reset = false) {
  if (reset || !(dt > 0) || dt > .2 || poseDiscontinuity(previous, current, dt) || current.knockedUntil || current.gunId || current.mode === 'gliding') return 0;
  const aboard = current.mode === 'aboard';
  const x = aboard ? 'deckX' : 'x', z = aboard ? 'deckZ' : 'z';
  return Math.min(12, Math.hypot(finite(current[x]) - finite(previous[x]), finite(current[z]) - finite(previous[z])) / dt);
}

export function createRemoteInterpolation({ delay = 100, maxFrames = 12, staleAfter = 400 } = {}) {
  const tracks = new Map();
  let sourceIdentity = null, lastReceivedAt = null, lastSnapshotTime = null, epoch = null, generation = 0;
  function clear() {
    tracks.clear(); sourceIdentity = null; lastReceivedAt = null; lastSnapshotTime = null; epoch = null;
  }
  function push(sources = [], { receivedAt, snapshotTime, round = 0, phase = '', now = 0 } = {}) {
    const nextEpoch = `${round}:${phase}`;
    if (epoch !== nextEpoch || Number.isFinite(snapshotTime) && lastSnapshotTime !== null && snapshotTime < lastSnapshotTime - .001) clear();
    epoch = nextEpoch;
    const hasReceipt = Number.isFinite(receivedAt);
    if (hasReceipt ? receivedAt === lastReceivedAt : sources === sourceIdentity) return;
    const timestamp = hasReceipt ? receivedAt : finite(now);
    if (lastReceivedAt !== null && timestamp < lastReceivedAt) { clear(); epoch = nextEpoch; }
    sourceIdentity = sources; lastReceivedAt = timestamp;
    if (Number.isFinite(snapshotTime)) lastSnapshotTime = snapshotTime;
    const seen = new Set();
    for (const source of sources) {
      if (source.online === false || ![source.x, source.y, source.z].every(Number.isFinite)) continue;
      seen.add(source.id);
      let track = tracks.get(source.id);
      const previous = track?.frames.at(-1);
      const gap = previous ? timestamp - previous.receivedAt : 0;
      if (!track || gap > staleAfter || poseDiscontinuity(previous?.player, source, gap / 1000)) {
        track = { frames: [], generation: ++generation }; tracks.set(source.id, track);
      }
      track.frames.push({ receivedAt: timestamp, player: { ...source } });
      if (track.frames.length > maxFrames) track.frames.splice(0, track.frames.length - maxFrames);
    }
    for (const id of tracks.keys()) if (!seen.has(id)) tracks.delete(id);
  }
  function sample(id, now, shipPose) {
    const track = tracks.get(id);
    if (!track) return null;
    const { frames } = track, newest = frames.at(-1), target = finite(now) - delay;
    let before = frames[0], after = before;
    for (let i = 1; i < frames.length; i++) {
      after = frames[i];
      if (after.receivedAt >= target) break;
      before = after;
    }
    const span = after.receivedAt - before.receivedAt;
    const amount = span > 0 ? clamp((target - before.receivedAt) / span, 0, 1) : 0;
    const player = { ...newest.player };
    for (const field of poseFields) player[field] = lerp(finite(before.player[field]), finite(after.player[field]), amount);
    const yaw = finite(before.player.yaw), delta = finite(after.player.yaw) - yaw;
    player.yaw = yaw + Math.atan2(Math.sin(delta), Math.cos(delta)) * amount;
    if (player.mode === 'aboard' && shipPose) {
      // Shared movement uses deck coordinates in the ship's world X/Z basis.
      player.x = shipPose.x + player.deckX; player.y = shipPose.y; player.z = shipPose.z + player.deckZ;
    }
    // A stalled connection holds its last sample without dead reckoning beyond
    // a stop or turn. The next packet after a long stall starts fresh history.
    return { player, generation: track.generation, held: target >= newest.receivedAt };
  }
  return { push, sample, clear, count: id => tracks.get(id)?.frames.length || 0 };
}

export function makeTracerFlight(from, to, weapon = 'flintlock') {
  if (!from || !to || ![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite)) return null;
  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (!Number.isFinite(distance) || distance < .001 || distance > 10000) return null;
  const duration = clamp(distance / (weapon === 'scatter' ? 115 : 140), .035, .45);
  return { distance, duration, fade: .075, trail: Math.min(distance, weapon === 'scatter' ? 2.3 : 4.2) };
}

export function sampleTracerFlight(flight, age) {
  const travel = clamp(age / flight.duration, 0, 1), fade = clamp((age - flight.duration) / flight.fade, 0, 1);
  const head = flight.distance * travel;
  return { head, tail: Math.max(0, head - flight.trail * (1 - fade)), opacity: 1 - fade, arrived: travel === 1 };
}
