import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPrediction, RenderClock, PREDICTION_STEP, PREDICTION_HISTORY_LIMIT } from '../client/prediction.js';
import { makePlayerPosition, movePlayer } from '../shared/movement.js';
import { COLORS, SHIP_DURATION, SPAWN, heightAt, shipAt } from '../shared/world.js';
import { Game } from '../server/game.js';
import { SHIP_GUNS, SHIP_JUMP_POINTS, gunAim, gunOperator, jumpLaunchPose } from '../shared/airship.js';

const controls = (changes = {}) => ({ forward: 0, right: 0, sprint: false, jump: false, yaw: 0, pitch: 0, ...changes });
const pirate = (changes = {}) => ({ ...makePlayerPosition(), id: 'p0', lastInputSeq: -1, knockedUntil: 0, hp: 100, ...changes });
const ground = () => pirate({ ...SPAWN, y: heightAt(SPAWN.x, SPAWN.z), mode: 'ground' });
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
const xyzNear = (a, b) => { for (const key of ['x', 'y', 'z']) near(a[key], b[key]); };

// A real authority, fixed input ticks and independently timed display/snapshot
// events catch ordering issues that identical client/server loops can hide.
function voyageFrames({ frameMs = [1000 / 60], serverTickMs = [50], aboard = false, walking = true, duration = 2400, stopAfter = Infinity, initialSkew = 0, lateSkew = 0, inputDelay = 5 } = {}) {
  const game = new Game();
  const player = game.addPlayer('p0', 'Sailor', COLORS[0]);
  game.action(player.id, 'launch'); game.enemies.clear();
  if (!aboard) Object.assign(player, ground());
  const prediction = new LocalPrediction(), clock = new RenderClock();
  prediction.reset(game.snapshot().players[0], { simulationTime: initialSkew }); clock.observe(game.snapshot(), 0);
  const events = [], frames = [], arrivals = [], acknowledgements = [];
  let sequence = 0, accumulator = 0, lastFrame = 0, snapshotCount = 0;
  const schedule = (time, kind, data) => events.push({ time, kind, data });
  if (lateSkew) schedule(850, 'skew');
  for (let t = serverTickMs[0], i = 1; t <= duration; t += serverTickMs[i++ % serverTickMs.length]) schedule(t, 'server');
  for (let t = 0, i = 0; t <= duration; t += frameMs[i++ % frameMs.length]) schedule(t, 'frame');
  while (events.length) {
    events.sort((a, b) => a.time - b.time);
    const { time, kind, data } = events.shift();
    if (time > duration) break;
    if (kind === 'skew') {
      prediction.simulationTime += lateSkew;
      for (const entry of prediction.history) entry.time += lateSkew;
    } else if (kind === 'server') {
      game.tick(PREDICTION_STEP);
      schedule(time + [3, 31, 9, 23, 5][snapshotCount++ % 5], 'snapshot', game.snapshot());
    } else if (kind === 'input') game.setInput(player.id, data);
    else if (kind === 'snapshot') {
      acknowledgements.push(data.players[0].lastInputSeq);
      const before = prediction.sample(accumulator / PREDICTION_STEP, clock.elapsed);
      const oldClock = clock.elapsed;
      clock.observe(data, time);
      prediction.reconcile(data.players[0], { phase: data.phase, elapsed: data.elapsed, simulationTime: data.simulationTime, renderElapsed: clock.elapsed, alpha: accumulator / PREDICTION_STEP });
      const after = prediction.sample(accumulator / PREDICTION_STEP, clock.elapsed);
      arrivals.push({ before, after, oldClock, clock: clock.elapsed });
    } else {
      const dt = (time - lastFrame) / 1000; lastFrame = time;
      const elapsed = clock.sample(time);
      accumulator += dt;
      while (accumulator + 1e-8 >= PREDICTION_STEP) {
        const input = controls({ forward: walking && time < stopAfter ? 1 : 0 });
        const seq = ++sequence;
        prediction.step(seq, input, elapsed - accumulator + PREDICTION_STEP, 'voyage');
        schedule(time + inputDelay, 'input', { seq, ...input });
        accumulator = Math.max(0, accumulator - PREDICTION_STEP);
      }
      prediction.decay(dt);
      frames.push({ time, elapsed, pose: prediction.sample(accumulator / PREDICTION_STEP, elapsed) });
    }
  }
  return { frames, arrivals, acknowledgements, authoritative: game.snapshot().players[0] };
}

test('render ship clock stays continuous and monotonic through uneven snapshot arrivals at different frame rates', () => {
  for (const frameMs of [[1000 / 30], [1000 / 60], [1000 / 144], [9, 17, 41, 7, 23]]) {
    const { frames, arrivals } = voyageFrames({ frameMs, aboard: true, walking: false });
    for (const arrival of arrivals) near(arrival.clock, arrival.oldClock);
    for (let i = 1; i < frames.length; i++) {
      const current = frames[i], previous = frames[i - 1];
      const dt = (current.time - previous.time) / 1000;
      const rate = (current.elapsed - previous.elapsed) / dt;
      assert.ok(rate >= .85 - 1e-8 && rate <= 1.15 + 1e-8, `continuous clock rate ${rate}`);
      const ship = shipAt(current.elapsed);
      near(current.pose.x - ship.x, current.pose.deckX);
      near(current.pose.z - ship.z, current.pose.deckZ);
      near(current.pose.y, ship.y);
      near(current.pose.deckX, -2); near(current.pose.deckZ, 0);
    }
  }
});

test('clock uses shipAt(0) in the lobby, progresses through stalls, and resets exactly on phase/round changes', () => {
  const clock = new RenderClock();
  clock.observe({ phase: 'lobby', round: 1, elapsed: 0 }, 100);
  near(clock.sample(10000), 0);
  clock.observe({ phase: 'voyage', round: 1, elapsed: 3 }, 10000);
  near(clock.sample(10000), 3); near(clock.sample(13000), 6);
  clock.observe({ phase: 'voyage', round: 1, elapsed: 5.9 }, 13000);
  near(clock.elapsed, 6);
  assert.ok(clock.sample(13016) > 6);
  clock.observe({ phase: 'victory', round: 1, elapsed: 28 }, 14000);
  near(clock.sample(19000), 28);
  clock.observe({ phase: 'lobby', round: 2, elapsed: 0 }, 20000);
  near(clock.sample(21000), 0);
  clock.observe({ phase: 'voyage', round: 2, elapsed: 10 }, 21000, true);
  near(clock.sample(21000), 10);
});

test('fixed pose rendering stays continuous across LAN acknowledgements at 30, 60 and 144Hz', () => {
  for (const hz of [30, 60, 144]) {
    const { frames, arrivals } = voyageFrames({ frameMs: [1000 / hz] });
    for (const { before, after } of arrivals) xyzNear(before, after);
    for (let i = 2; i < frames.length; i++) {
      const current = frames[i], previous = frames[i - 1];
      const speed = (previous.pose.z - current.pose.z) / ((current.time - previous.time) / 1000);
      assert.ok(speed >= -1e-7 && speed < 13, `no backwards tick or burst at ${hz}Hz: ${speed}`);
      if (current.time > 700) near(speed, 8, .05);
    }
  }
});

test('coalesced server timer ticks with repeated and skipped input ACKs preserve constant walking speed', () => {
  const { frames, acknowledgements } = voyageFrames({ serverTickMs: [75, 25, 75, 25, 50, 50], duration: 4000 });
  assert.ok(acknowledgements.some((seq, i) => i > 0 && seq === acknowledgements[i - 1]), 'one input is held for multiple server ticks');
  assert.ok(acknowledgements.some((seq, i) => i > 0 && seq > acknowledgements[i - 1] + 1), 'a newer packet supersedes an intermediate input');
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].time < 700) continue;
    const speed = (frames[i - 1].pose.z - frames[i].pose.z) / ((frames[i].time - frames[i - 1].time) / 1000);
    near(speed, 8, .01);
  }
});

test('stopping after clock drift never replays consumed walking inputs or slides backward', () => {
  for (const fps of [30, 60, 144]) for (const skew of [0, .05, .2]) for (const timing of [
    { serverTickMs: [50], inputDelay: 5 },
    { serverTickMs: [75, 25, 75, 25, 50, 50], inputDelay: 17 },
  ]) for (const drift of [{ initialSkew: skew }, { lateSkew: skew }]) {
    const { frames, authoritative } = voyageFrames({ frameMs: [1000 / fps], stopAfter: 1200, duration: 3000, ...timing, ...drift });
    const stopped = frames.filter(frame => frame.time >= 1320);
    const retreat = stopped.at(-1).pose.z - Math.min(...stopped.map(frame => frame.pose.z));
    assert.ok(retreat < .015, `stop retreat ${retreat}m at ${fps} fps, ${JSON.stringify(drift)}`);
    near(stopped.at(-1).pose.z, authoritative.z, .001);
  }
});

test('action ACK gaps calibrate from the last real fixed step and repeated ACKs never shift clocks twice', () => {
  const prediction = new LocalPrediction(); prediction.reset(ground(), { simulationTime: .2 });
  prediction.step(1, controls({ forward: 1 }), .05, 'voyage');
  prediction.step(2, controls(), .1, 'voyage');
  const authority = { ...ground(), z: SPAWN.z - .4, lastInputSeq: 4 };
  // Sequence 3/4 are immediate aim/neutral action packets, with no local step.
  prediction.reconcile(authority, { phase: 'voyage', elapsed: .1 });
  near(prediction.simulationTime, .1);
  assert.deepEqual(prediction.history.map(entry => entry.seq), [1, 2]);
  assert.ok(prediction.history.every(entry => entry.time <= .1 + 1e-7));
  const timeline = prediction.history.map(entry => entry.time);
  prediction.reconcile(authority, { phase: 'voyage', elapsed: .1 });
  assert.deepEqual(prediction.history.map(entry => entry.time), timeline);
  near(prediction.simulationTime, .1);
});

test('turning or releasing input between ticks cannot reinterpret an already simulated interval', () => {
  const prediction = new LocalPrediction(); prediction.reset(ground());
  const input = controls({ forward: 1 });
  prediction.step(1, input, .05, 'voyage');
  const beforeTurn = prediction.sample(.7, .085);
  input.yaw = Math.PI / 2; input.forward = 0;
  const afterTurn = prediction.sample(.7, .085);
  xyzNear(beforeTurn, afterTurn);
  near(afterTurn.x, 0); near(afterTurn.z, SPAWN.z - .28);
  prediction.step(2, controls({ forward: 1, yaw: Math.PI / 2, pitch: .5 }), .1, 'voyage');
  const corner = prediction.sample(.5, .125);
  near(corner.x, -.2); near(corner.z, SPAWN.z - .4);
  near(corner.yaw, Math.PI / 2); near(corner.pitch, .5);
  prediction.step(3, controls({ yaw: Math.PI / 2 }), .15, 'voyage');
  const stop = prediction.sample(0, .15);
  for (const alpha of [.1, .5, .99]) xyzNear(prediction.sample(alpha, .15 + alpha * .05), stop);
});

test('walk and sprint advance at fixed speed with no fractional extra step, including low frame rates', () => {
  for (const dt of [1 / 15, 1 / 30, 1 / 60, 1 / 144]) {
    const prediction = new LocalPrediction(); prediction.reset(ground());
    let accumulator = 0, seq = 0, time = 0;
    for (let i = 0; i < Math.round(1 / dt); i++) {
      time += dt; accumulator += dt;
      while (accumulator + 1e-8 >= .05) {
        prediction.step(++seq, controls({ forward: 1, sprint: true }), time - accumulator + .05, 'voyage');
        accumulator = Math.max(0, accumulator - .05);
      }
    }
    assert.equal(seq, 20);
    near(prediction.current.z, SPAWN.z - 11);
    near(prediction.sample(accumulator / .05, time).z, SPAWN.z - 10.45);
  }
});

test('rebasing preserves the same interpolation alpha exactly and applies one bounded decaying correction', () => {
  for (const alpha of [0, .2, .73, .999]) {
    const prediction = new LocalPrediction(); prediction.reset(ground());
    prediction.step(1, controls({ forward: 1 }), .05, 'voyage');
    prediction.step(2, controls({ right: 1 }), .1, 'voyage');
    const authority = { ...ground(), x: .1, z: SPAWN.z - .2, lastInputSeq: 1 };
    const before = prediction.sample(alpha, .12);
    prediction.reconcile(authority, { phase: 'voyage', elapsed: .05, alpha, renderElapsed: .12 });
    xyzNear(prediction.sample(alpha, .12), before);
    const firstOffset = { ...prediction.correction };
    prediction.reconcile(authority, { phase: 'voyage', elapsed: .05, alpha, renderElapsed: .12 });
    xyzNear(prediction.correction, firstOffset);
    prediction.decay(.1);
    const size = Math.hypot(...Object.values(prediction.correction));
    assert.ok(size < Math.hypot(...Object.values(firstOffset)));
    prediction.reconcile({ ...prediction.current, x: prediction.current.x + 4, lastInputSeq: 2 }, { phase: 'voyage', elapsed: .1, alpha });
    assert.ok(Math.hypot(...Object.values(prediction.correction)) <= 3 + 1e-8);
  }
});

test('aboard reconciliation corrects deck offsets only and keeps the rendered feet on one ship pose', () => {
  const prediction = new LocalPrediction();
  prediction.reset(pirate({ deckX: -2, x: -2 }), { simulationTime: .9 });
  prediction.step(1, controls({ right: 1 }), 1, 'voyage');
  const before = prediction.sample(.6, 1.04);
  const authority = { ...pirate(), deckX: -1.9, deckZ: .2, x: -1.9, y: 62, z: 90, lastInputSeq: 0 };
  prediction.reconcile(authority, { phase: 'voyage', elapsed: .9, renderElapsed: 1.04, alpha: .6 });
  xyzNear(prediction.sample(.6, 1.04), before);
  near(prediction.correction.y, 0);
  const later = prediction.sample(.6, 1.25), ship = shipAt(1.25);
  near(later.x - ship.x, later.deckX); near(later.z - ship.z, later.deckZ); near(later.y, ship.y);
  near(later.deckX, before.deckX); near(later.deckZ, before.deckZ);
});

test('an acknowledged gate departure lands the glide without snapping back onto the deck', () => {
  const gate = SHIP_JUMP_POINTS[0];
  const start = pirate({ deckX: gate.x, deckZ: gate.z, ...shipAt(0), y: shipAt(0).y });
  const prediction = new LocalPrediction(); prediction.reset(start);
  // Local prediction never departs on its own: a held Space at the gate stays aboard.
  for (let i = 1; i < 6; i++) prediction.step(i, controls({ jump: i % 2 === 1, forward: 1 }), i * .05, 'voyage');
  assert.equal(prediction.current.mode, 'aboard', 'no client-side departure without the authority');
  // The authority answers the E with a launch pose metres off the ship.
  const launch = jumpLaunchPose(gate, shipAt(.3));
  const departed = { ...start, ...launch, mode: 'gliding', grounded: false, vy: -6, jumpHeld: false,
    deckX: gate.x, deckZ: gate.z, lastInputSeq: 5 };
  prediction.reconcile(departed, { phase: 'voyage', elapsed: .3, simulationTime: .3, renderElapsed: .3, alpha: .5 });
  assert.equal(prediction.current.mode, 'gliding');
  assert.equal(prediction.pending.length, 0); assert.equal(prediction.history.length, 0);
  xyzNear(prediction.sample(.5, .3), launch);
  // A late snapshot from before the departure cannot pull the pirate back aboard.
  prediction.step(6, controls({ forward: 1 }), .35, 'voyage');
  prediction.reconcile({ ...departed, lastInputSeq: 5 }, { phase: 'voyage', elapsed: .3, simulationTime: .3, renderElapsed: .35, alpha: .5 });
  assert.equal(prediction.current.mode, 'gliding');
  assert.equal(prediction.current.gunId, null);
  for (let i = 7; i < 260; i++) prediction.step(i, controls(), i * .05, 'voyage');
  assert.equal(prediction.current.mode, 'ground');
  near(prediction.sample(0, 13).y, heightAt(prediction.current.x, prediction.current.z));
  assert.ok(heightAt(prediction.current.x, prediction.current.z) > 1, 'the acknowledged launch glides to dry ground');
  prediction.reset(ground()); prediction.step(1, controls({ jump: true }), .05, 'voyage');
  prediction.reconcile(ground(), { phase: 'voyage', elapsed: .05, alpha: .4 });
  assert.equal(prediction.current.grounded, false, 'an unconsumed ground jump stays airborne');
});

test('no duration, held key or replayed input can predict a departure from the deck', () => {
  const prediction = new LocalPrediction();
  for (const gate of [...SHIP_JUMP_POINTS, { x: 0, z: 0 }]) {
    prediction.reset(pirate({ deckX: gate.x, deckZ: gate.z }), { simulationTime: SHIP_DURATION - .1 });
    for (let i = 1; i < 40; i++) prediction.step(i, controls({ jump: true, forward: 1 }), SHIP_DURATION - .1 + i * .05, 'voyage');
    assert.equal(prediction.current.mode, 'aboard');
    assert.equal(prediction.sample(.5, SHIP_DURATION + 2).mode, 'aboard');
    // Replaying acknowledged inputs across the old drop time changes nothing.
    const held = { ...prediction.current, lastInputSeq: 20 };
    prediction.reconcile(held, { phase: 'voyage', elapsed: SHIP_DURATION, simulationTime: SHIP_DURATION, renderElapsed: SHIP_DURATION, alpha: .5 });
    assert.equal(prediction.current.mode, 'aboard');
  }
});

test('teleport, down/rescue and explicit stale-history resets discard old visual and replay state', () => {
  const prediction = new LocalPrediction(); prediction.reset(ground());
  prediction.step(1, controls({ forward: 1, jump: true }), .05, 'voyage');
  const teleported = { ...ground(), x: 30, z: 40, y: heightAt(30, 40), lastInputSeq: 1 };
  prediction.reconcile(teleported, { phase: 'voyage', elapsed: .1, alpha: .5 });
  xyzNear(prediction.sample(.5, .1), teleported); assert.equal(prediction.pending.length, 0);
  prediction.step(2, controls({ forward: 1 }), .15, 'voyage');
  const downed = { ...teleported, knockedUntil: 8, lastInputSeq: 2 };
  prediction.reconcile(downed, { phase: 'voyage', elapsed: .15, alpha: .3 });
  for (let i = 3; i < 30; i++) prediction.step(i, controls({ forward: 1 }), i * .05, 'voyage');
  assert.equal(prediction.pending.length, 0); xyzNear(prediction.sample(.8, 1), downed);
  const rescued = { ...ground(), lastInputSeq: 30 };
  prediction.reconcile(rescued, { phase: 'voyage', elapsed: 8, alpha: .9 });
  xyzNear(prediction.sample(.9, 8), rescued);
  prediction.step(31, controls({ right: 1 }), 8.05, 'voyage');
  prediction.reset(rescued);
  xyzNear(prediction.sample(.6, 8.2), rescued); assert.equal(prediction.pending.length, 0);
  for (let i = 0; i < 200; i++) prediction.step(32 + i, controls(), 8.1 + i * .05, 'voyage');
  assert.equal(prediction.pending.length, PREDICTION_HISTORY_LIMIT);
  prediction.reset(); assert.equal(prediction.sample(.5, 0), null);
});

test('server acknowledgements follow consumed ticks while aim actions stay immediate and sequences stay private', () => {
  const game = new Game(), player = game.addPlayer('p0', 'Sailor', COLORS[0]);
  game.action(player.id, 'launch'); game.enemies.clear(); Object.assign(player, ground());
  game.setInput(player.id, { seq: 1, ...controls({ forward: 1, yaw: .25, pitch: .3 }) });
  assert.equal(player.lastInputSeq, -1); near(player.yaw, .25); near(player.pitch, .3);
  game.setInput(player.id, { seq: 3, ...controls({ right: 1, yaw: .5 }) });
  game.setInput(player.id, { seq: 2, ...controls({ forward: -1, yaw: -1 }) });
  assert.equal(player.lastInputSeq, -1); near(player.yaw, .5);
  assert.equal(game.snapshot().players[0]._receivedInputSeq, undefined);
  const expected = { ...player }; movePlayer(expected, controls({ right: 1, yaw: .5 }), .05, .05);
  game.tick(); assert.equal(player.lastInputSeq, 3); xyzNear(player, expected);
  game.setInput(player.id, { seq: 4, ...controls({ yaw: Math.PI / 2 }) });
  const shots = []; game.onEvent = event => { if (event.kind === 'shot') shots.push(event); };
  game.action(player.id, 'fire');
  assert.equal(player.lastInputSeq, 3); assert.ok(shots[0].to.x < shots[0].from.x - 40);
  game.tick(); assert.equal(player.lastInputSeq, 4);
  game.disconnect(player.id); game.reconnect(player.id);
  assert.equal(player.lastInputSeq, -1); assert.equal(player._receivedInputSeq, -1);
  game.setInput(player.id, { seq: 0, ...controls() }); game.tick(); assert.equal(player.lastInputSeq, 0);
  game.resetRound(); assert.equal(player.lastInputSeq, -1); assert.equal(player._receivedInputSeq, -1);
});

test('downed and victory ticks acknowledge no-op inputs without movement or future replay debt', () => {
  const game = new Game(), player = game.addPlayer('p0', 'Sailor', COLORS[0]);
  game.action(player.id, 'launch'); game.enemies.clear(); Object.assign(player, ground());
  game.damagePlayer(player, 100, 'crab');
  const before = { ...player };
  game.setInput(player.id, { seq: 7, ...controls({ forward: 1 }) });
  assert.equal(player.lastInputSeq, -1); game.tick();
  assert.equal(player.lastInputSeq, 7); xyzNear(player, before);
  game.win();
  game.setInput(player.id, { seq: 8, ...controls({ right: 1 }) });
  assert.equal(player.lastInputSeq, 7); game.tick();
  assert.equal(player.lastInputSeq, 8); xyzNear(player, before);
});

test('return and gun mounting discard old walking history and keep a stationary constrained operator', () => {
  const prediction = new LocalPrediction(); prediction.reset(ground(), { simulationTime: SHIP_DURATION + 4 });
  prediction.step(1, controls({ forward: 1, jump: true }), SHIP_DURATION + 4.05, 'voyage');
  const returned = pirate({ shipReturned: true, deckX: 0, deckZ: 0, lastInputSeq: 1 });
  prediction.reconcile(returned, { phase: 'voyage', elapsed: SHIP_DURATION + 4.05, alpha: .7 });
  assert.equal(prediction.pending.length, 0); assert.equal(prediction.history.length, 0);
  assert.equal(prediction.current.mode, 'aboard'); assert.equal(prediction.current.jumpHeld, false);
  prediction.step(2, controls(), SHIP_DURATION + 4.1, 'voyage');
  assert.equal(prediction.current.mode, 'aboard', 'return after flight never auto-drops');
  for (const gun of SHIP_GUNS) {
    const operator = gunOperator(gun);
    const mounted = { ...returned, gunId: gun.id, deckX: operator.x, deckZ: operator.z, lastInputSeq: 2 };
    prediction.reconcile(mounted, { phase: 'voyage', elapsed: SHIP_DURATION + 4.1, alpha: .7 });
    assert.equal(prediction.pending.length, 0);
    for (let i = 0; i < 10; i++) {
      prediction.step(i + 3, controls({ forward: 1, right: 1, sprint: true, yaw: gun.yaw + 2, pitch: 1.1 }), SHIP_DURATION + 4.15 + i * .05, 'voyage');
      const pose = prediction.sample(.73, SHIP_DURATION + 4.18 + i * .05), ship = shipAt(SHIP_DURATION + 4.18 + i * .05);
      near(pose.deckX, operator.x); near(pose.deckZ, operator.z); near(pose.y, ship.y);
      near(pose.yaw, gunAim(gun, gun.yaw + 2, 1.1).yaw); near(pose.pitch, .8);
    }
  }
});

test('Space dismount stays predicted through an unconsumed snapshot, and a fresh press stays aboard', () => {
  const gun = SHIP_GUNS[0], operator = gunOperator(gun), time = SHIP_DURATION + 20;
  const start = pirate({ gunId: gun.id, shipReturned: true, deckX: operator.x, deckZ: operator.z });
  const prediction = new LocalPrediction(); prediction.reset(start, { simulationTime: time });
  prediction.step(1, controls({ jump: true, yaw: gun.yaw }), time + .05, 'voyage');
  assert.equal(prediction.current.gunId, null); assert.equal(prediction.current.mode, 'aboard');
  prediction.reconcile(start, { phase: 'voyage', elapsed: time + .05, alpha: .4 });
  assert.equal(prediction.current.gunId, null, 'an old mounted snapshot cannot steal the dismount edge');
  const acknowledged = { ...prediction.current, lastInputSeq: 1 };
  prediction.reconcile(acknowledged, { phase: 'voyage', elapsed: time + .05, alpha: .4 });
  assert.equal(prediction.pending.length, 0); assert.equal(prediction.current.gunId, null);
  prediction.step(2, controls({ jump: true }), time + .1, 'voyage');
  assert.equal(prediction.current.mode, 'aboard', 'holding the first Space does not jump off');
  prediction.step(3, controls(), time + .15, 'voyage');
  prediction.step(4, controls({ jump: true }), time + .2, 'voyage');
  assert.equal(prediction.current.mode, 'aboard', 'a second, fresh Space still stays aboard');
  assert.equal(prediction.sample(0, time + .2).mode, 'aboard');
  near(prediction.sample(0, time + .2).deckX, operator.x);
});

test('a repeat lift trip discards a pending ground jump even when shipReturned was already true', () => {
  const prediction = new LocalPrediction(), time = SHIP_DURATION + 50;
  const onIsland = { ...ground(), shipReturned: true };
  prediction.reset(onIsland, { simulationTime: time });
  prediction.step(1, controls({ jump: true, forward: 1 }), time + .05, 'voyage');
  const aboard = pirate({ shipReturned: true, deckX: 0, deckZ: 0, lastInputSeq: -1 });
  prediction.reconcile(aboard, { phase: 'voyage', elapsed: time + .05, alpha: .8 });
  assert.equal(prediction.current.mode, 'aboard'); assert.equal(prediction.current.jumpHeld, false);
  assert.equal(prediction.pending.length, 0); assert.equal(prediction.history.length, 0);
  prediction.step(2, controls(), time + .1, 'voyage');
  assert.equal(prediction.current.mode, 'aboard'); near(prediction.sample(.5, time + .12).deckZ, 0);
});
