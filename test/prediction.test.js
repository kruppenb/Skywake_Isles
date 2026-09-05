import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPrediction, RenderClock, PREDICTION_STEP, PREDICTION_HISTORY_LIMIT } from '../client/prediction.js';
import { makePlayerPosition, movePlayer } from '../shared/movement.js';
import { COLORS, SHIP_DURATION, SPAWN, heightAt, shipAt } from '../shared/world.js';
import { Game } from '../server/game.js';

const controls = (changes = {}) => ({ forward: 0, right: 0, sprint: false, jump: false, yaw: 0, pitch: 0, ...changes });
const pirate = (changes = {}) => ({ ...makePlayerPosition(), id: 'p0', lastInputSeq: -1, knockedUntil: 0, hp: 100, ...changes });
const ground = () => pirate({ ...SPAWN, y: heightAt(SPAWN.x, SPAWN.z), mode: 'ground' });
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
const xyzNear = (a, b) => { for (const key of ['x', 'y', 'z']) near(a[key], b[key]); };

// A real authority, fixed input ticks and independently timed display/snapshot
// events catch ordering issues that identical client/server loops can hide.
function voyageFrames({ frameMs = [1000 / 60], serverTickMs = [50], aboard = false, walking = true, duration = 2400 } = {}) {
  const game = new Game();
  const player = game.addPlayer('p0', 'Sailor', COLORS[0]);
  game.action(player.id, 'launch'); game.enemies.clear();
  if (!aboard) Object.assign(player, ground());
  const prediction = new LocalPrediction(), clock = new RenderClock();
  prediction.reset(game.snapshot().players[0]); clock.observe(game.snapshot(), 0);
  const events = [], frames = [], arrivals = [], acknowledgements = [];
  let sequence = 0, accumulator = 0, lastFrame = 0, snapshotCount = 0;
  const schedule = (time, kind, data) => events.push({ time, kind, data });
  for (let t = serverTickMs[0], i = 1; t <= duration; t += serverTickMs[i++ % serverTickMs.length]) schedule(t, 'server');
  for (let t = 0, i = 0; t <= duration; t += frameMs[i++ % frameMs.length]) schedule(t, 'frame');
  while (events.length) {
    events.sort((a, b) => a.time - b.time);
    const { time, kind, data } = events.shift();
    if (time > duration) break;
    if (kind === 'server') {
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
        const input = controls({ forward: walking ? 1 : 0 });
        const seq = ++sequence;
        prediction.step(seq, input, elapsed - accumulator + PREDICTION_STEP, 'voyage');
        schedule(time + 5, 'input', { seq, ...input });
        accumulator = Math.max(0, accumulator - PREDICTION_STEP);
      }
      prediction.decay(dt);
      frames.push({ time, elapsed, pose: prediction.sample(accumulator / PREDICTION_STEP, elapsed) });
    }
  }
  return { frames, arrivals, acknowledgements };
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

test('jump replay, auto-drop and landing keep current mode without blending back onto the boat', () => {
  const start = pirate({ deckX: -2, x: -2 });
  const prediction = new LocalPrediction(); prediction.reset(start);
  prediction.step(1, controls({ jump: true }), .05, 'voyage');
  assert.equal(prediction.sample(0, .05).mode, 'gliding');
  prediction.reconcile(start, { phase: 'voyage', elapsed: 0, alpha: .4, renderElapsed: .07 });
  assert.equal(prediction.current.mode, 'gliding');
  // The server tick at the same time can precede delivery of our jump packet.
  prediction.reconcile(start, { phase: 'voyage', elapsed: .05, alpha: .4, renderElapsed: .07 });
  assert.equal(prediction.current.mode, 'gliding', 'an unconsumed jump must not bounce back aboard');
  const ack = { ...start }; movePlayer(ack, controls({ jump: true }), .05, .05); ack.lastInputSeq = 1;
  prediction.reconcile(ack, { phase: 'voyage', elapsed: .05, alpha: .4, renderElapsed: .07 });
  assert.equal(prediction.sample(.4, .07).mode, 'gliding');
  for (let i = 2; i < 230; i++) prediction.step(i, controls(), i * .05, 'voyage');
  assert.equal(prediction.current.mode, 'ground');
  near(prediction.sample(0, 12).y, heightAt(prediction.current.x, prediction.current.z));
  prediction.reset(start); prediction.step(1, controls(), SHIP_DURATION, 'voyage');
  assert.equal(prediction.sample(0, SHIP_DURATION).mode, 'gliding');
  near(prediction.sample(0, SHIP_DURATION).z, SPAWN.z);
  prediction.reset(ground()); prediction.step(1, controls({ jump: true }), .05, 'voyage');
  prediction.reconcile(ground(), { phase: 'voyage', elapsed: .05, alpha: .4 });
  assert.equal(prediction.current.grounded, false, 'an unconsumed ground jump stays airborne');
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
