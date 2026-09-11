import { createWorld } from './world.js';
import { createInput } from './input.js';
import { GameNet } from './net.js';
import { createUI, findInteractable, sideEventAnnouncement, finaleAnnouncement, skyWaveAnnouncement, cannonPresentation, flyingTargetAtRay } from './ui.js';
import { skyBossAtRay } from './sky-finale.js';
import { createAudio } from './audio.js';
import { LocalPrediction, RenderClock, PREDICTION_STEP } from './prediction.js';
import { weaponPresentation } from './weapon-presentation.js';
import { SEED, SHRINES, CHESTS, heightAt, shipAt } from '/shared/world.js';
import { SHIP_GUNS, GUN_COOLDOWN, GUN_RANGE, gunAim, gunMuzzle } from '/shared/airship.js';
import { WEAPON_ORDER, WEAPONS, RARITIES, weaponStats } from '/shared/weapons.js';

const canvas = document.getElementById('world');
const testMode = new URLSearchParams(location.search).get('test') === '1';
const STEP = PREDICTION_STEP;
const neutral = (view) => ({ forward: 0, right: 0, sprint: false, jump: false, yaw: view?.yaw || 0, pitch: view?.pitch || 0 });
const previewState = () => ({
  phase: 'lobby', elapsed: 0, seed: SEED, round: 0, hostId: null,
  players: [], enemies: [], shipGuns: [], flyingTargets: [], shrines: SHRINES.map((shrine) => ({ id: shrine.id, status: 'dormant', charge: 0, remaining: 0 })),
  chests: CHESTS.map((chest) => ({ id: chest.id, opened: false })), pearls: 0, shards: 0, bossId: null,
  pings: [], drops: [], stats: { wins: 0, voyages: 0, bestPearls: 0 }, victory: null,
});
let state = previewState();
let simulationPlayer = null;
let renderedPlayer = null;
let sequence = 0;
let accumulator = 0;
let receivedAt = performance.now();
let lastFrame = performance.now();
let lastUIAt = 0;
let nextShotAt = 0;
let pendingWeaponAction = null;
let forcePrediction = false;
let lastAuthoritativeMode = null;
let lastAuthoritativeGunId = null;
let lastAuthoritativeReturned = false;
let lastVictoryRound = null;
let running = true;
let animationFrame = 0;
let input;
let world;
let net;
const prediction = new LocalPrediction();
const renderClock = new RenderClock();
renderClock.observe(state, receivedAt);
const frameTimes = [];
const audio = createAudio();

const ui = createUI({
  onJoin(name, color) {
    audio.unlock();
    ui.setJoining(true);
    net.join(name, color);
  },
  onAction(action) { performAction(action); },
  // The deck button runs the same E interaction the keyboard does, so it can
  // never depart from somewhere the server would refuse.
  onDeckAction() { audio.unlock(); performAction('interact'); },
  onModalChange() {
    synchronizeInput();
    sendNeutralInput();
    if (!ui.menuOpen && simulationPlayer && state.phase !== 'victory') input?.focus();
  },
  onSound(muted) { audio.setMuted(muted); ui.setSound(audio.muted); },
  onLootReveal() { audio.play('upgrade'); },
  onQuality(quality) { world?.setQuality(quality); },
  onLeave() {
    input.reset(); input.releasePointer();
    net.leave();
    resetToWelcome();
  },
});
ui.setSound(audio.muted);

try {
  world = createWorld(canvas, { quality: ui.quality });
} catch (error) {
  ui.fatal('Your browser could not start the 3D island. Enable hardware acceleration or try a current version of Chrome, Edge, or Firefox. ' + error.message);
  throw error;
}

input = createInput(canvas, {
  onAction: performAction,
  onEscape() {
    if (ui.mapOpen) ui.setMap(false);
    else ui.setPaused(!ui.paused);
  },
  onMap() { if (!ui.paused && state.phase !== 'lobby' && state.phase !== 'victory') ui.setMap(!ui.mapOpen); },
  onGesture() { audio.unlock(); },
  onNotice(message) { ui.toast(message); },
  onBlur() { ui.clearWeaponPresentation(); sendNeutralInput(); },
}, { testMode });

net = new GameNet({
  onStatus(status) {
    ui.setConnection(status);
    if (status.status !== 'connected') {
      input.reset();
      input.setEnabled(false);
      resetPredictionHistory();
    }
    if (status.status === 'reconnecting' && simulationPlayer && status.attempt === 0) ui.toast('The connection drifted. Your place in the crew is saved while we reconnect.', true);
  },
  onWelcome(message) {
    forcePrediction = true;
    input.reset();
    resetPredictionHistory();
    renderClock.observe(message.state, performance.now(), true);
    const player = message.state.players.find((entry) => entry.id === message.id);
    sequence = Math.max(sequence, player?.lastInputSeq || 0);
    if (player && !message.reconnected) input.setView(player.yaw || 0, -.16);
    if (message.reconnected) ui.toast('Back with your crew. Welcome aboard!');
    if (!ui.menuOpen) input.focus();
  },
  onState: receiveState,
  onEvent: receiveEvent,
  onError(error) {
    if (!simulationPlayer) ui.setError(error.message);
    else ui.toast(error.message, true);
  },
  onReplaced(message) {
    resetToWelcome();
    ui.setError(message);
  },
});

function resetToWelcome() {
  pendingWeaponAction = null;
  simulationPlayer = null;
  renderedPlayer = null;
  prediction.reset();
  accumulator = 0;
  state = previewState();
  receivedAt = performance.now();
  renderClock.observe(state, receivedAt, true);
  lastAuthoritativeMode = null;
  lastAuthoritativeGunId = null;
  lastAuthoritativeReturned = false;
  ui.reset();
  input.reset(); input.releasePointer(); input.setEnabled(false);
  lastUIAt = 0;
}

function synchronizeInput() {
  if (!input) return;
  input.setEnabled(!!simulationPlayer && !!net?.connected && state.phase !== 'victory');
  input.setSuspended(ui.menuOpen || !simulationPlayer || state.phase === 'victory');
}

function resetPredictionHistory() {
  prediction.reset(simulationPlayer, { simulationTime: prediction.simulationTime });
  simulationPlayer = prediction.current;
  accumulator = 0;
  forcePrediction = true;
}

function sendInput(packet) {
  return net?.sendInput({ seq: ++sequence, ...packet });
}

function sendNeutralInput() {
  if (net?.connected && simulationPlayer) sendInput(neutral(input));
}

function receiveState(next) {
  if (!next || !Array.isArray(next.players)) return;
  const phaseChanged = next.phase !== state.phase || next.round !== state.round;
  const now = performance.now();
  const stale = now - receivedAt > 500 || document.hidden;
  state = next;
  pendingWeaponAction = null;
  receivedAt = now;
  renderClock.observe(state, now);
  const authoritative = state.players.find((entry) => entry.id === net.id);
  ui.updateLootContext(state, authoritative);
  if (!authoritative) { simulationPlayer = null; renderedPlayer = null; prediction.reset(); synchronizeInput(); return; }
  if (phaseChanged) {
    accumulator = 0;
    input.reset();
    nextShotAt = 0;
    if (state.phase !== 'victory') { ui.setMap(false); ui.setPaused(false); }
    if (state.phase === 'voyage' && state.elapsed < 1) {
      input.setView(0, -.16);
      ui.toast('The sails are up! Walk to a jump gate, then press E to glide to the island.');
    }
    if (state.phase === 'finale') ui.toast('The final battle begins! Defend the lighthouse with your crew.');
  }
  const gunChanged = (authoritative.gunId || null) !== lastAuthoritativeGunId;
  const returned = authoritative.shipReturned && authoritative.mode === 'aboard'
    && (!lastAuthoritativeReturned || lastAuthoritativeMode !== 'aboard');
  // A confirmed gate departure ends the deck timeline: queued walking steps and
  // a held key are consumed once here, so nothing replays onto the deck we left.
  const departed = lastAuthoritativeMode === 'aboard' && authoritative.mode === 'gliding';
  if (gunChanged || returned || departed) {
    // Keep a held Space through the dismount ACK. Sending a neutral packet here
    // would release its jump edge before the authority has consumed it.
    const settling = !!authoritative.gunId || returned || departed;
    if (settling) input.reset();
    nextShotAt = 0;
    ui.clearWeaponPresentation();
    const gun = SHIP_GUNS.find((entry) => entry.id === authoritative.gunId);
    if (gunChanged && gun) input.setView(gun.yaw, .1);
    if (settling) sendNeutralInput();
  }
  reconcile(authoritative, forcePrediction || phaseChanged || stale || !simulationPlayer || gunChanged || returned || departed);
  lastAuthoritativeGunId = authoritative.gunId || null;
  lastAuthoritativeReturned = !!authoritative.shipReturned;
  forcePrediction = false;
  if (lastAuthoritativeMode !== authoritative.mode) {
    if (lastAuthoritativeMode === 'aboard' && authoritative.mode === 'gliding') audio.play('drop');
    if (lastAuthoritativeMode === 'gliding' && authoritative.mode === 'ground') {
      audio.play('land');
      ui.toast('Boots on the island! Cyan ↑ airship lifts at Sunwake beach and the lighthouse return you to the guns. Find them on M.');
    }
    if (lastAuthoritativeMode === 'ground' && authoritative.mode === 'aboard') ui.toast('Back aboard! E mans a deck gun. Walk to the bow or starboard JUMP gate and press E when you want to glide down.');
    lastAuthoritativeMode = authoritative.mode;
  }
  synchronizeInput();
}

function reconcile(authoritative, force) {
  sequence = Math.max(sequence, authoritative.lastInputSeq || 0);
  prediction.reconcile(authoritative, {
    phase: state.phase, elapsed: state.elapsed, simulationTime: state.simulationTime ?? state.elapsed, renderElapsed: renderClock.elapsed,
    alpha: accumulator / STEP, force,
  });
  simulationPlayer = prediction.current;
  if (force) accumulator = 0;
}

function receiveEvent(event) {
  if (!event || typeof event.kind !== 'string') return;
  world.handleEvent(event);
  const mine = event.playerId === net.id;
  const name = state.players.find((player) => player.id === event.playerId)?.name || 'A crewmate';
  switch (event.kind) {
    case 'shot':
      if (mine || !renderedPlayer || Math.hypot((event.from?.x || 0) - renderedPlayer.x, (event.from?.z || 0) - renderedPlayer.z) < 40) audio.play('shot', { distant: !mine, weapon: event.weapon });
      if (mine && event.hitId) { ui.hit(); audio.play('hit'); }
      break;
    case 'hit':
      if (event.targetId === net.id) { ui.hurt(); audio.play('hurt'); }
      else if (event.sourceId === net.id) { ui.hit(); audio.play('hit'); }
      break;
    case 'reload': if (mine) audio.play('reload'); break;
    case 'swap': if (mine) audio.play('reload'); break;
    case 'melee': if (mine) audio.play('melee'); break;
    case 'chest': {
      audio.play('collect', { distant: !mine });
      const gun = Object.hasOwn(WEAPONS, event.weapon) ? `${RARITIES[event.rarity]?.name || 'Common'} ${WEAPONS[event.weapon].name}` : '';
      // The opener is already standing on the gun, so it equips or is salvaged
      // on the same tick; only crewmates need directions to it.
      if (mine) ui.toast(`You found ${event.pearls || 0} shared pearls!${gun ? ` A ${gun} tumbles out.` : ''}`);
      else ui.toast(`${name} found ${event.pearls || 0} shared pearls!${gun ? ` Walk over the ${gun} to equip it. Your copy disappears; the crew's stays.` : ''}`);
      break;
    }
    case 'salvage': {
      if (!Object.hasOwn(WEAPONS, event.weapon)) break;
      audio.play('collect', { distant: !mine });
      const pearls = Number.isFinite(event.pearls) ? event.pearls : 0;
      ui.toast(mine ? `You already carry an equal or better ${WEAPONS[event.weapon].name}, so it was salvaged for +${pearls} shared pearls.`
        : `${name} salvaged a spare ${WEAPONS[event.weapon].name} for +${pearls} shared pearls.`);
      break;
    }
    case 'loot':
      if (mine) ui.revealLoot(event);
      else if (Object.hasOwn(WEAPONS, event.weapon) && Object.hasOwn(RARITIES, event.rarity)) {
        audio.play('collect', { distant: true });
        ui.toast(`${name} equipped ${RARITIES[event.rarity].name} ${WEAPONS[event.weapon].name}.`);
      }
      break;
    case 'shrine': {
      const shrine = SHRINES.find((entry) => entry.id === event.id);
      if (event.status === 'cleared') { audio.play('shrine'); ui.toast(`${shrine?.name || 'A compass shard'} restored! Your whole crew shares the reward.`); }
      else if (event.status === 'active') ui.toast(`${shrine?.name || 'The shrine'} is awake. Clear its cheeky crabs!`);
      break;
    }
    case 'heal': audio.play('heal', { distant: !mine }); if (mine) ui.toast('Healing pulse! Nearby friends recover health too.'); break;
    case 'revive': audio.play('heal', { distant: !mine }); ui.toast(mine ? 'Back on your feet! You have a short safety shield.' : `${name} is back on their feet!`); break;
    case 'downed': if (mine) audio.play('downed'); else ui.toast(`${name} needs a hand. Get close and press E to help.`); break;
    case 'ping': audio.play('ping', { distant: !mine }); ui.toast(mine ? 'Your location is marked on everyone’s map.' : `${name} marked a location on your map.`); break;
    case 'splash': audio.play('splash', { distant: true }); break;
    case 'victory': if (lastVictoryRound !== state.round) { lastVictoryRound = state.round; audio.play('victory'); } break;
    case 'notice': if (typeof event.message === 'string') ui.toast(event.message); break;
    case 'side-event': {
      const announcement = sideEventAnnouncement(event);
      if (announcement) { ui.announce(announcement); audio.play('surge'); }
      break;
    }
    case 'finale': {
      const a = finaleAnnouncement(event);
      if (a) { ui.announce(a); audio.play('surge'); }
      break;
    }
    case 'sky-wave': {
      // The siege's ground waves get their own call-out rather than repeating
      // the stage banner every time a rank forms up.
      const a = skyWaveAnnouncement(event);
      if (a) { ui.announce(a); audio.play('surge'); }
      break;
    }
    default: break;
  }
}

// Locate what the visible center reticle touches. The muzzle then aims toward
// that point, correcting the third-person camera's height and shoulder offset.
function aimPoint(player) {
  const gun = SHIP_GUNS.find((entry) => entry.id === player.gunId);
  if (gun && player.mode === 'aboard') {
    const aim = gunAim(gun, input.yaw, input.pitch);
    const muzzle = gunMuzzle(gun, shipAt(renderClock.elapsed), aim.yaw, aim.pitch);
    return { ...aim, enemy: skyBossAtRay(state, muzzle.from, muzzle.direction, GUN_RANGE) || flyingTargetAtRay(state, muzzle.from, muzzle.direction) };
  }
  const ray = world.aimRay();
  const origin = ray.origin;
  const direction = ray.direction;
  let nearest = Math.max(72, weaponStats(player.weapon, player.rarity).range + 12);
  let enemy = null;
  for (const candidate of state.enemies) {
    if (candidate.hp <= 0) continue;
    const ox = origin.x - candidate.x;
    const oy = origin.y - (candidate.y + candidate.radius * .8);
    const oz = origin.z - candidate.z;
    const b = ox * direction.x + oy * direction.y + oz * direction.z;
    const c = ox * ox + oy * oy + oz * oz - candidate.radius * candidate.radius;
    const discriminant = b * b - c;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    let t = -b - root;
    if (t < 0) t = -b + root;
    if (t > .1 && t < nearest) { nearest = t; enemy = candidate; }
  }
  if (direction.y < -.015) {
    for (let t = 2; t < nearest; t += 1.2) {
      const x = origin.x + direction.x * t;
      const y = origin.y + direction.y * t;
      const z = origin.z + direction.z * t;
      if (y <= heightAt(x, z) + .1) { nearest = t; enemy = null; break; }
    }
  }
  const point = { x: origin.x + direction.x * nearest, y: origin.y + direction.y * nearest, z: origin.z + direction.z * nearest };
  const dx = point.x - player.x;
  const dy = point.y - (player.y + 1.25);
  const dz = point.z - player.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), enemy };
}

function performAction(action) {
  if (!net?.connected || !simulationPlayer) return;
  audio.unlock();
  if (['launch', 'ready', 'restart'].includes(action)) {
    net.action(action);
    input.focus();
    return;
  }
  if (ui.menuOpen || state.phase === 'lobby' || state.phase === 'victory') return;
  const player = renderedPlayer && (renderedPlayer.gunId || null) === (simulationPlayer.gunId || null) ? renderedPlayer : simulationPlayer;
  if (player.knockedUntil > state.elapsed) return;
  const base = input.snapshot();
  const gun = player.mode === 'aboard' && SHIP_GUNS.find((entry) => entry.id === player.gunId);
  if (gun && !['fire', 'interact', 'ping'].includes(action)) return;
  if (action === 'fire') {
    const now = performance.now();
    if (now < nextShotAt || (!gun && player.mode !== 'ground')) return;
    if (gun && (state.shipGuns?.find((entry) => entry.id === gun.id)?.readyAt || 0) > renderClock.elapsed) return;
    nextShotAt = now + (gun ? GUN_COOLDOWN : weaponStats(player.weapon, player.rarity).cooldown) * 1000 + 10;
    const aim = aimPoint(player);
    if (gun) {
      input.setView(aim.yaw, aim.pitch);
      sendInput({ ...base, yaw: aim.yaw, pitch: aim.pitch });
      net.action('fire');
      return;
    }
    sendInput({ ...base, yaw: aim.yaw, pitch: aim.pitch });
    net.action('fire');
    // Facing changes used for the shot never change the player's mouse view or
    // leave their movement pointed along the offset muzzle ray on the next tick.
    sendInput(base);
  } else if (action === 'interact') {
    const target = findInteractable(state, player);
    if (target && !target.disabled) {
      // Stop held movement before requesting a lift, so fixed ticks queued
      // before its snapshot cannot carry island input onto the returned deck.
      if (target.kind === 'airship-return' || target.kind === 'jump-gate') { input.reset(); sendInput(neutral(input)); }
      else sendInput(base);
      net.action('interact', target.id);
    }
  } else if (WEAPON_ORDER.includes(action)) {
    if (!player.inventory?.[action]) { ui.toast(`Find the ${WEAPONS[action].name} in chests.`); input.focus(); return; }
    if (action !== player.weapon) { pendingWeaponAction = 'swap'; input.setLookScale(1); ui.clearWeaponPresentation(); }
    net.action('swap', action);
    input.focus();
  } else if (action === 'heal') {
    const cooldown = player.healUntil - state.elapsed;
    if (cooldown > 0) ui.toast(`Your healing pulse returns in ${Math.ceil(cooldown)} seconds.`);
    else net.action('heal');
    input.focus();
  } else if (['melee', 'reload', 'ping'].includes(action)) {
    if (action === 'reload') { pendingWeaponAction = 'reload'; input.setLookScale(1); ui.clearWeaponPresentation(); }
    sendInput(base);
    net.action(action);
  }
}

function fixedUpdate(elapsed) {
  if (!net.connected || !simulationPlayer || state.phase === 'victory') return;
  const controls = input.snapshot();
  const gun = SHIP_GUNS.find((entry) => entry.id === simulationPlayer.gunId);
  if (gun) Object.assign(controls, gunAim(gun, controls.yaw, controls.pitch));
  if (state.phase === 'lobby') controls.jump = false;
  const packet = { ...controls, seq: ++sequence };
  if (!net.sendInput(packet)) return;
  prediction.step(sequence, controls, elapsed, state.phase);
  simulationPlayer = prediction.current;
}

function frame(now) {
  if (!running) return;
  const rawDt = (now - lastFrame) / 1000;
  const dt = Math.min(.05, Math.max(.001, rawDt));
  lastFrame = now;
  if (!document.hidden && rawDt < .5) { frameTimes.push(rawDt); if (frameTimes.length > 240) frameTimes.shift(); }
  try {
    const elapsed = renderClock.sample(now);
    const gun = SHIP_GUNS.find((entry) => entry.id === simulationPlayer?.gunId);
    if (gun) { const aim = gunAim(gun, input.yaw, input.pitch); input.setView(aim.yaw, aim.pitch); }
    if (document.hidden || rawDt > .5 || now - receivedAt > 500) {
      if (!forcePrediction) resetPredictionHistory();
      input.reset();
    } else if (!forcePrediction) {
      accumulator = Math.min(.2, accumulator + Math.max(0, rawDt));
      while (accumulator + 1e-8 >= STEP) {
        fixedUpdate(state.phase === 'lobby' ? 0 : elapsed - accumulator + STEP);
        accumulator = Math.max(0, accumulator - STEP);
      }
    }
    if (input.firing) performAction('fire');
    prediction.decay(Math.min(.2, Math.max(0, rawDt)));
    renderedPlayer = prediction.sample(accumulator / STEP, state.phase === 'lobby' ? 0 : elapsed);
    if (renderedPlayer) {
      renderedPlayer.yaw = input.yaw; renderedPlayer.pitch = input.pitch;
    }
    const view = {
      yaw: input.yaw, pitch: input.pitch,
      menu: !renderedPlayer || state.phase === 'victory',
      aiming: input.aiming && input.active && !!net.connected, time: now / 1000, locked: input.locked,
      snapshotTime: state.elapsed, snapshotReceivedAt: receivedAt, round: state.round,
    };
    const renderState = { ...state, elapsed };
    const presentationOptions = {
      elapsed, connected: !!net.connected, controlsActive: input.active && !document.hidden && document.hasFocus(),
      menuOpen: ui.menuOpen, aiming: view.aiming, pendingAction: pendingWeaponAction,
    };
    const authoritative = state.players.find((player) => player.id === net.id);
    const presentation = cannonPresentation(state, renderedPlayer, presentationOptions) || weaponPresentation(state, authoritative, presentationOptions);
    view.scoped = presentation.scoped;
    input.setLookScale(presentation.sensitivity);
    ui.updateWeaponPresentation(presentation, renderedPlayer, view);
    world.update(dt, renderState, renderedPlayer, view);
    world.render();
    if (now - lastUIAt >= 65) {
      ui.setTarget(renderedPlayer && (renderedPlayer.mode === 'ground' || renderedPlayer.gunId) ? aimPoint(renderedPlayer).enemy : null);
      ui.update(renderState, renderedPlayer, world, view);
      lastUIAt = now;
    }
  } catch (error) {
    console.error('Skywake Isles rendering failed:', error);
    running = false;
    input.reset(); input.setEnabled(false); sendNeutralInput();
    ui.fatal('The island stopped drawing. Refresh to return to your crew. ' + error.message);
    return;
  }
  animationFrame = requestAnimationFrame(frame);
}

window.addEventListener('resize', () => { world.resize(); lastUIAt = 0; });
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  running = false;
  cancelAnimationFrame(animationFrame);
  input.reset(); input.setEnabled(false); sendNeutralInput();
  ui.fatal('Your browser paused its graphics device. Refresh this page to rejoin your crew. If this happens again, choose Smooth sailing in the graphics menu.');
});
document.addEventListener('visibilitychange', () => {
  resetPredictionHistory();
  if (document.hidden) { input.reset(); ui.clearWeaponPresentation(); sendNeutralInput(); }
  else lastFrame = performance.now();
});

// Readable diagnostics for local verification. There are no simulation bypasses.
window.SKY = {
  state: () => state,
  player: () => renderedPlayer,
  input, world, net,
  fps: () => ({
    average: frameTimes.length ? frameTimes.length / frameTimes.reduce((sum, seconds) => sum + seconds, 0) : 0,
    samples: frameTimes.length,
    frameMs: frameTimes.length ? [...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length * .95)] * 1000 : 0,
  }),
};

synchronizeInput();
ui.ready();
animationFrame = requestAnimationFrame(frame);
