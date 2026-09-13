import { COLORS, REGIONS, SHRINES, CHESTS, BEACON, SPAWN, WORLD_RADIUS, SHIP_OBSTACLES, heightAt, regionAt, shipAt } from '../shared/world.js';
import { POINTS_OF_INTEREST, BUILDINGS, EXPLORATION_TRAILS, pointOfInterestAt } from '../shared/exploration.js';
import { hasWorldLineOfSight } from '../shared/collision.js';
import { WEAPON_ORDER, WEAPONS, RARITIES } from '../shared/weapons.js';
import { SIDE_EVENTS, SIDE_EVENT_WAVES, SIDE_EVENT_COLOR } from '../shared/side-events.js';
import { FINALE_STAGES } from '../shared/finale.js';
import { ENEMY_TYPES } from '../shared/enemies.js';
import { AIRSHIP_RETURNS, RETURN_RANGE, SHIP_GUNS, SHIP_JUMP_POINTS, GUN_INTERACTION_RANGE, GUN_COOLDOWN, GUN_RANGE, jumpPointFor } from '../shared/airship.js';
import { canReturnAtShrine } from '../shared/shrines.js';
import { SKY_BOSSES, SKY_GROUND_WAVES } from '../shared/sky-finale.js';
import { skyState } from './sky-finale.js';
import { createLootReveal } from './loot-reveal.js';
import { DIVE_ENTRANCE, REEF_EXIT, REEF_CHEST, REEF_BOUNDS, REEF_SOLIDS, reefLineOfSight, realmOf, sameRealm } from '../shared/underwater.js';

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const distance3 = (a, b) => Math.hypot(a.x - b.x, (a.y || 0) - (b.y || 0), a.z - b.z);
const formatTime = (seconds) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ } };
const show = (element, visible) => { element.hidden = !visible; };
const text = (element, value) => { const next = String(value); if (element.textContent !== next) element.textContent = next; };

function sideEventEntries(state) {
  return (state.sideEvents || []).flatMap((event) => {
    const definition = SIDE_EVENTS.find((entry) => entry.id === event.id);
    return definition ? [{ ...event, ...definition }] : [];
  });
}

export function sideEventForHUD(state, player, { paused = false, mapOpen = false } = {}) {
  if (!player || player.mode !== 'ground' || state.phase !== 'voyage' || paused || mapOpen) return null;
  const events = sideEventEntries(state).map((event) => ({ ...event, distance: distance(player, event) }));
  const active = events.find((event) => event.status === 'active');
  const nearby = events.filter((event) => event.distance <= 32);
  const recent = nearby.filter((event) => ['completed', 'failed'].includes(event.status)
    && state.elapsed >= event.finishedAt && state.elapsed - event.finishedAt < 8)
    .sort((a, b) => b.finishedAt - a.finishedAt)[0];
  const available = nearby.filter((event) => event.status === 'available').sort((a, b) => a.distance - b.distance)[0];
  const event = active || recent || available;
  return event ? { ...event, integrityPercent: Math.round(clamp(event.integrity / Math.max(1, event.maxIntegrity) * 100, 0, 100)),
    secondsLeft: Math.max(0, event.endsAt - state.elapsed) } : null;
}

// Big top-of-screen call-out for each surge of an optional defense. Waves
// are announced by their event, never inferred from snapshots, so a late
// joiner does not see a stale banner.
export function sideEventAnnouncement(event) {
  if (!event || event.kind !== 'side-event' || event.status !== 'active' || !Number.isInteger(event.wave) || event.wave < 1) return null;
  const definition = SIDE_EVENTS.find((entry) => entry.id === event.id);
  if (!definition) return null;
  const spawns = Array.isArray(event.spawns) ? event.spawns : [];
  const bosses = spawns.filter((spawn) => spawn?.type === 'tidebreaker').length;
  const final = event.wave >= SIDE_EVENT_WAVES;
  const subtitle = final ? (bosses ? `${bosses} Tidebreaker${bosses === 1 ? ' rises' : 's rise'} from the deep!` : 'The tide throws everything it has!')
    : event.wave === 1 ? 'Crabs surge in from the sea!' : 'The tide brings more crabs!';
  return { kicker: definition.name, title: final ? 'Final wave' : `Wave ${event.wave}`, subtitle, final };
}

// Big top-of-screen call-out for each stage of the final battle. Like the
// side-event banner, this is driven only by the event, never inferred from
// the snapshot, so a late joiner does not see a stale banner.
export function finaleAnnouncement(event) {
  if (!event || event.kind !== 'finale' || !Number.isInteger(event.stage) || event.stage < 1) return null;
  const stage = FINALE_STAGES[event.stage - 1];
  if (!stage) return null;
  const stages = Number.isInteger(event.stages) ? event.stages : FINALE_STAGES.length;
  const spawns = Array.isArray(event.spawns) ? event.spawns : [];
  const tidebreakers = spawns.filter((spawn) => spawn?.type === 'tidebreaker').length;
  const subtitle = tidebreakers > 0 ? `${tidebreakers} Tidebreaker${tidebreakers === 1 ? ' marches' : 's march'} on the lighthouse!` : stage.banner;
  return { kicker: 'Tideglass Lighthouse', title: `Stage ${event.stage}`, subtitle, final: event.stage >= stages };
}

// Each ground wave of the siege gets its own call-out. It never repeats the
// stage banner, and it is driven by the event so a late joiner sees no stale one.
export function skyWaveAnnouncement(event) {
  if (!event || event.kind !== 'sky-wave' || !Number.isInteger(event.wave) || event.wave < 1) return null;
  const plan = SKY_GROUND_WAVES[event.wave - 1];
  if (!plan) return null;
  const waves = Number.isInteger(event.waves) ? event.waves : SKY_GROUND_WAVES.length;
  const spawns = Array.isArray(event.spawns) ? event.spawns : [];
  const elites = spawns.filter((spawn) => spawn?.type === 'tidebreaker').length;
  const final = event.wave >= waves;
  return { kicker: plan.name, title: final ? 'Last wave' : `Wave ${event.wave} of ${waves}`,
    subtitle: elites > 0 ? `${elites} Tidebreaker${elites === 1 ? '' : 's'} lead${elites === 1 ? 's' : ''} the march on the dais!` : plan.notice,
    final };
}

export function jumpGateLabel(state) {
  return state?.phase === 'finale' ? 'Glide to lighthouse' : 'Jump & glide to island';
}

// Objectives that already carry a world height — a gate or a gun on the moving
// deck, a skycrab on its lane — mark that exact point. Everything standing on the
// island keeps its terrain-relative offset, including the Tempest, whose y is a
// feet position. A new kind opts in here explicitly.
const ABSOLUTE_MARKER_KINDS = new Set(['jump-gate', 'cannon', 'sky-boss', 'reef-guard', 'reef-chest', 'reef-exit']);
export function objectiveMarkerHeight(objective) {
  if (ABSOLUTE_MARKER_KINDS.has(objective?.kind) && Number.isFinite(objective.y)) return objective.y;
  return heightAt(objective.x, objective.z) + (objective.kind === 'boss' ? 4 : 9);
}

// Guidance leads with the gate the opening view is already facing — the forward
// one, on the bow — rather than turning a new pirate around toward a marginally
// closer gate behind them. Once somebody is beside another gate, the marker
// follows the one at hand instead of sending them back across the deck.
const GATE_AT_HAND = 5.5;
export function aboardGate(player) {
  const gates = SHIP_JUMP_POINTS.map((point) => ({ ...point, distance: Math.hypot(player.deckX - point.x, player.deckZ - point.z) }));
  return gates.filter((gate) => gate.distance <= GATE_AT_HAND).sort((a, b) => a.distance - b.distance)[0]
    || gates.reduce((forward, gate) => (gate.z < forward.z ? gate : forward));
}

// The deck banner already presents the one action E performs, so a second
// floating E prompt saying the same thing only crowds it. A nearby gun nobody
// has mounted keeps its own prompt, and ground prompts are untouched.
export function deckPromptMirrored(banner, interact) {
  return !!banner?.button && ['jump-gate', 'gun'].includes(interact?.kind);
}

// The one aboard eligibility guard. The deck banner, its button and the E prompt
// must never disagree about whether an interaction is possible.
export function canActAboard(state, player) {
  return !!player && player.mode === 'aboard' && ['voyage', 'finale'].includes(state?.phase)
    && player.online !== false && player.hp > 0 && !(player.knockedUntil > state.elapsed);
}

export function findInteractable(state, player) {
  if (!player || player.knockedUntil > state.elapsed || state.phase === 'victory') return null;
  if (player.mode === 'aboard') {
    if (!canActAboard(state, player)) return null;
    const mounted = SHIP_GUNS.find((gun) => gun.id === player.gunId);
    if (mounted) return { ...mounted, kind: 'gun', label: 'Leave gun' };
    // Gates mirror the server dispatcher: same deck-local range and clear route,
    // and their zones never reach a gun, so one E is never ambiguous.
    const gate = jumpPointFor({ x: player.deckX, z: player.deckZ }, SHIP_OBSTACLES);
    if (gate) return { ...gate, kind: 'jump-gate', color: '#ffd16c', label: jumpGateLabel(state) };
    const nearby = SHIP_GUNS.map((gun) => ({ ...gun, distance: Math.hypot(player.deckX - gun.x, player.deckZ - gun.z) }))
      .filter((gun) => gun.distance <= GUN_INTERACTION_RANGE).sort((a, b) => a.distance - b.distance);
    for (const gun of nearby) {
      const occupantId = state.shipGuns?.find((entry) => entry.id === gun.id)?.occupantId;
      if (!occupantId || occupantId === player.id) return { ...gun, kind: 'gun', label: `Man ${gun.name}` };
    }
    if (nearby.length) {
      const gun = nearby[0], occupantId = state.shipGuns?.find((entry) => entry.id === gun.id)?.occupantId;
      const occupant = state.players.find((entry) => entry.id === occupantId);
      return { ...gun, kind: 'gun', disabled: true, label: `${gun.name} · ${occupant?.name || 'Crew'} at gun` };
    }
    return null;
  }
  if (player.mode === 'swimming' || realmOf(player) === 'reef') {
    if (!['voyage', 'finale'].includes(state.phase) || player.hp <= 0 || player.online === false) return null;
    const options = [];
    const eye = { x: player.x, y: player.y + .7, z: player.z };
    for (const friend of state.players || []) {
      if (friend.id !== player.id && friend.online && sameRealm(player, friend) && friend.knockedUntil > state.elapsed
        && distance3(player, friend) <= 3.5 && reefLineOfSight(eye, { x: friend.x, y: friend.y + .7, z: friend.z }, .08)) {
        options.push({ id: friend.id, kind: 'revive', label: `Help ${friend.name} up`, distance: distance3(player, friend) - 10 });
      }
    }
    const exitDistance = distance3(player, REEF_EXIT);
    if (exitDistance <= REEF_EXIT.range && reefLineOfSight(eye, { x: REEF_EXIT.x, y: REEF_EXIT.y + .7, z: REEF_EXIT.z }, .08)) {
      options.push({ ...REEF_EXIT, kind: 'reef-exit', label: 'Return to shore', color: '#79f5ff', distance: exitDistance });
    }
    return options.sort((a, b) => a.distance - b.distance)[0] || null;
  }
  if (player.mode !== 'ground') return null;
  const options = [];
  const reachable = (target) => hasWorldLineOfSight(
    { x: player.x, y: player.y + 1.1, z: player.z },
    { x: target.x, y: (target.y ?? heightAt(target.x, target.z)) + .9, z: target.z }, .08);
  for (const friend of state.players) {
    if (friend.id !== player.id && friend.online && sameRealm(player, friend) && friend.knockedUntil > state.elapsed && distance(player, friend) <= 3.5 && reachable(friend)) {
      options.push({ id: friend.id, kind: 'revive', label: `Help ${friend.name} up`, distance: distance(player, friend) - 10 });
    }
  }
  const diveEntrance = { ...DIVE_ENTRANCE, y: heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z) };
  if (state.phase === 'voyage' && player.grounded && player.hp > 0 && player.online !== false
    && distance3(player, diveEntrance) <= DIVE_ENTRANCE.range && reachable(diveEntrance)) {
    options.push({ ...diveEntrance, kind: 'dive-entrance', label: 'Dive to Sunken Reach', color: '#79f5ff', distance: distance3(player, diveEntrance) });
  }
  if (['voyage', 'finale'].includes(state.phase) && player.grounded && player.hp > 0 && player.online !== false) {
    for (const lift of AIRSHIP_RETURNS) {
      const ground = heightAt(lift.x, lift.z);
      const separation = Math.hypot(player.x - lift.x, player.y - ground, player.z - lift.z);
      if (separation > RETURN_RANGE || !hasWorldLineOfSight(
        { x: player.x, y: player.y + 1.25, z: player.z }, { x: lift.x, y: ground + .8, z: lift.z })) continue;
      options.push({ ...lift, kind: 'airship-return', label: 'Teleport to airship', color: '#a5f5f0', distance: separation });
    }
  }
  // Chests open by walking over them, so they never ask for E; only shrines,
  // revives, optional defenses and the lighthouse do.
  for (const shrine of SHRINES) {
    const dynamic = state.shrines.find((entry) => entry.id === shrine.id);
    if (dynamic?.status === 'dormant' && distance(player, shrine) <= 4 && reachable(shrine)) {
      options.push({ ...shrine, kind: 'shrine', label: `Awaken ${shrine.name}`, distance: distance(player, shrine) });
    } else if (canReturnAtShrine(state, player, shrine)) {
      options.push({ ...shrine, kind: 'airship-return', label: 'Return to boat', color: '#a5f5f0', distance: distance(player, shrine) });
    }
  }
  if (state.phase === 'voyage' && state.shards >= 3 && distance(player, BEACON) <= 4 && reachable(BEACON)) {
    options.push({ ...BEACON, kind: 'beacon', label: 'Restore the lighthouse', distance: distance(player, BEACON) });
  }
  if (state.phase === 'voyage' && player.grounded && player.hp > 0 && player.online !== false && !(state.sideEvents || []).some((event) => event.status === 'active')) {
    for (const event of sideEventEntries(state)) {
      if (event.status !== 'available' || distance(player, event) > event.interactionRange
        || Math.abs(player.y - heightAt(event.x, event.z)) >= 3 || !reachable(event)) continue;
      options.push({ ...event, kind: 'side-event', label: 'Defend supplies (optional)', color: SIDE_EVENT_COLOR, distance: distance(player, event) });
    }
  }
  return options.sort((a, b) => a.distance - b.distance)[0] || null;
}

// The deck banner never counts anybody down and never advertises Space: staying
// aboard is safe forever. Its button is the same interaction the E prompt offers,
// so it appears only where the server would accept the press, and the whole
// banner disappears rather than holding stale text outside an active voyage.
export function airshipBanner(state, player) {
  if (!canActAboard(state, player)) return null;
  const action = findInteractable(state, player);
  if (player.gunId && action?.kind === 'gun') return { text: 'Mouse aim · Hold click fire · E or Space leaves the gun', button: 'Leave gun' };
  if (action?.kind === 'jump-gate') return { text: `${action.name}: press E to open your glider and drop to the island.`, button: jumpGateLabel(state) };
  return { text: 'Walk onto a JUMP gate — the bow ramp or the starboard rail — then press E to glide down. E also mans a deck gun.', button: null };
}

export function cannonPresentation(state, player, { elapsed = state.elapsed, connected = false, controlsActive = false, menuOpen = false } = {}) {
  const gun = SHIP_GUNS.find((entry) => entry.id === player?.gunId);
  if (!gun || player.mode !== 'aboard') return null;
  const active = connected && controlsActive && !menuOpen && ['voyage', 'finale'].includes(state.phase)
    && player.online !== false && player.hp > 0 && !(player.knockedUntil > elapsed);
  const remaining = Math.max(0, (state.shipGuns?.find((entry) => entry.id === gun.id)?.readyAt || 0) - elapsed);
  return { active, scoped: false, reloading: active && remaining > 0, reloadProgress: clamp(1 - remaining / GUN_COOLDOWN, 0, 1),
    sensitivity: 1, remaining, name: 'Deck cannon' };
}

// Flying target snapshots give the sphere center directly, unlike ground crabs.
export function flyingTargetAtRay(state, origin, direction) {
  let nearest = GUN_RANGE, target = null;
  for (const candidate of state.flyingTargets || []) {
    if (!(candidate.hp > 0)) continue;
    const ox = origin.x - candidate.x, oy = origin.y - candidate.y, oz = origin.z - candidate.z;
    const b = ox * direction.x + oy * direction.y + oz * direction.z;
    const c = ox * ox + oy * oy + oz * oz - candidate.radius ** 2;
    const discriminant = b * b - c;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant), entry = -b - root, exit = -b + root;
    const distance = entry >= 0 ? entry : exit;
    if (distance >= 0 && distance <= nearest) { nearest = distance; target = candidate; }
  }
  return target;
}

// Steering a glider carries roughly 8 m across for every 6 m of descent, so a
// late departure from the parked ship is pointed at ground it can actually
// reach instead of the distant opening beach.
export function glideLanding(state, player) {
  const reach = 12 + Math.max(0, player.y - heightAt(player.x, player.z)) * 1.25;
  const lighthouse = { ...BEACON, name: 'Tideglass Lighthouse', kind: 'landing' };
  const options = REGIONS.map((region) => ({ id: region.id, x: region.x, z: region.z, name: region.name,
    kind: 'landing', distance: distance(player, region) })).sort((a, b) => a.distance - b.distance);
  // In the finale both gates aim at the open landing beside the haven lift, not
  // the beacon itself: a straight line from the bow launch to the dais runs into
  // the lighthouse tower, and this approach clears it.
  if (state.phase === 'finale') return { ...LIGHTHOUSE_LANDING };
  const reachable = options.find((option) => option.distance <= reach) || options[0];
  return reachable.id === 'haven' ? lighthouse : reachable;
}

// --- Skycrab siege -----------------------------------------------------------
//
// Every read of the fourth stage funnels through skyState(), so an earlier
// stage, a victory tableau and a restart all fall back to the existing finale
// HUD untouched. Nothing below infers state from an event.
const HAVEN_LIFT = AIRSHIP_RETURNS.find((lift) => lift.id === 'airship-return-haven');
const LIGHTHOUSE_LANDING = { id: 'lighthouse-landing', x: HAVEN_LIFT.x, z: HAVEN_LIFT.z,
  name: 'Lighthouse landing', kind: 'landing' };
const gunSide = (gunId) => {
  const gun = SHIP_GUNS.find((entry) => entry.id === gunId);
  return gun ? (gun.x < 0 ? 'port' : 'starboard') : null;
};
const skyBossSide = (id) => SKY_BOSSES.find((boss) => boss.id === id)?.side || null;

// The bounded HUD model for the siege: two boss rows in authored order, the
// wave counter and the ground work that is still coming. Counts include queued
// ranks and unstarted waves, so an inter-wave gap never reads as cleared.
export function skyHud(state, player) {
  const sky = skyState(state);
  if (!sky) return null;
  const setup = sky.status === 'boarding' || sky.status === 'countdown';
  const cleared = sky.status === 'cleared';
  const bosses = SKY_BOSSES.map((descriptor) => {
    const live = sky.bosses.find((boss) => boss.id === descriptor.id);
    const planned = setup && !live;
    const down = !planned && (cleared || !live || live.state === 'down' || !(live.hp > 0));
    const maxHp = live?.maxHp > 0 ? live.maxHp : 0;
    return { id: descriptor.id, name: descriptor.name, side: descriptor.side,
      hp: live?.hp ?? 0, maxHp, percent: maxHp ? clamp(Math.ceil((live.hp / maxHp) * 100), 0, 100) : 0,
      state: planned ? 'planned' : down ? 'down' : live.state,
      down, planned, winding: !down && live?.state === 'winding' };
  });
  const airLeft = setup ? bosses.length : bosses.filter((boss) => !boss.down).length;
  // Active/pending are attackers; future is a count of waves, not more attackers.
  const groundLeft = sky.groundActive + sky.groundPending;
  const hasGroundWork = !cleared && (groundLeft > 0 || sky.groundFuture > 0);
  const countdown = sky.status === 'countdown' ? Math.max(0, Math.ceil(sky.countdownEndsAt - state.elapsed)) : 0;
  let phase = `Wave ${Math.max(1, sky.wave)} of ${sky.waves}`;
  if (sky.status === 'boarding') phase = 'Waiting for a gunner';
  else if (sky.status === 'countdown') phase = `Skycrabs dive in ${countdown}s`;
  else if (cleared) phase = 'Island secured';
  else if (!hasGroundWork) phase = 'Ground clear';
  const waiting = sky.status === 'active' && !groundLeft && sky.groundFuture > 0;
  const future = sky.groundFuture > 0 ? ` · ${sky.groundFuture} wave${sky.groundFuture === 1 ? '' : 's'} to come` : '';
  return { status: sky.status, countdown, bosses, airLeft, groundLeft, hasGroundWork, waiting, phase,
    wave: sky.wave, waves: sky.waves, groundActive: sky.groundActive,
    groundPending: sky.groundPending, groundFuture: sky.groundFuture,
    ground: cleared ? 'All three waves cleared.' : setup ? 'Three finite waves march once the crabs dive.'
      : waiting ? `Wave ${Math.min(sky.waves, sky.wave + 1)} of ${sky.waves} is forming up${future}.`
      : groundLeft ? `${groundLeft} attacker${groundLeft === 1 ? '' : 's'} active or incoming${future}`
      : 'All three waves cleared.' };
}

// What a gunner needs and the old practice HUD never told them: which crab is on
// their side, how far round it is, and — when their side is finished — that the
// fight is elsewhere. It never aims for them: the marker and the words point,
// the player still swings the gun.
export function skyGunnerGuidance(state, player) {
  const hud = skyHud(state, player);
  if (!hud || !player?.gunId) return null;
  const side = gunSide(player.gunId);
  if (!side) return null;
  const mine = hud.bosses.find((boss) => boss.side === side);
  const other = hud.bosses.find((boss) => boss.side !== side);
  if (hud.status === 'boarding' || hud.status === 'countdown') {
    return { kind: 'ready', boss: null,
      title: 'Hold this gun — the skycrabs are coming',
      detail: hud.status === 'countdown' ? `Two skycrabs dive in ${hud.countdown}s. Swing the gun and watch your broadside.`
        : 'Hold this station. A ready gunner starts the shared countdown automatically.' };
  }
  if (mine && !mine.down) {
    return { kind: 'boss', boss: mine, title: `Shoot ${mine.name}`,
      detail: `${mine.name} flies the ${mine.side} lane · ${mine.percent}% left. Swing to the marker; it loops astern and back.` };
  }
  if (other && !other.down) {
    return { kind: 'switch', boss: other, title: `Switch sides — ${other.name} is still up`,
      detail: `Your lane is clear. Press E to leave this gun, then take a ${other.side} gun for ${other.name} (${other.percent}%).` };
  }
  if (hud.hasGroundWork) {
    return { kind: 'descend', boss: null, title: 'Sky clear — get down to the lighthouse',
      detail: `Press E to leave the gun, walk to a jump gate and glide down. ${hud.ground}` };
  }
  return { kind: 'clear', boss: null, title: 'Island secured', detail: 'Both skycrabs are down and the dais is clear.' };
}

// Stage-four objective priority, ahead of the generic finale and strand
// branches. A physical waypoint always comes first: a gun, a gate, the lift or
// the dais — never a distant beach.
export function skyObjective(state, player) {
  const hud = skyHud(state, player);
  if (!hud || !player || hud.status === 'cleared') return null;
  const setup = hud.status === 'boarding' || hud.status === 'countdown';
  if (player.mode === 'aboard') {
    const ship = shipAt(state.elapsed);
    const gateMarker = () => {
      const gate = aboardGate(player);
      return { id: gate.id, name: gate.name, kind: 'jump-gate', x: ship.x + gate.x, y: ship.y + 2.6, z: ship.z + gate.z };
    };
    if (player.gunId) {
      const gunner = skyGunnerGuidance(state, player);
      if (gunner?.boss) {
        const live = skyState(state).bosses.find((boss) => boss.id === gunner.boss.id);
        return live ? { id: live.id, name: live.name, kind: 'sky-boss', x: live.x, y: live.y, z: live.z } : null;
      }
      // A ready gunner should hold position, not follow an exit marker.
      return gunner?.kind === 'descend' ? gateMarker() : null;
    }
    if (setup || hud.airLeft) {
      const sides = new Set(hud.bosses.filter((boss) => setup || !boss.down).map((boss) => boss.side));
      const guns = SHIP_GUNS.filter((gun) => sides.has(gunSide(gun.id)))
        .map((gun) => ({ gun, occupied: !!state.shipGuns?.some((station) => station.id === gun.id
          && station.occupantId && station.occupantId !== player.id),
        distance: Math.hypot(player.deckX - gun.x, player.deckZ - gun.z) }))
        .sort((a, b) => Number(a.occupied) - Number(b.occupied) || a.distance - b.distance);
      const choice = guns[0];
      if (choice) {
        const { gun, occupied } = choice;
        return { id: gun.id, name: `${gun.name}${occupied ? ' (occupied)' : ''}`, kind: 'cannon', occupied,
          x: ship.x + gun.x, y: ship.y + 1.85, z: ship.z + gun.z };
      }
    }
    return hud.hasGroundWork ? gateMarker() : null;
  }
  if (player.mode === 'gliding') return { ...LIGHTHOUSE_LANDING };
  // On the ground: the dais while a wave is out, the haven lift while the fight
  // is only in the air or still forming up.
  if (setup || (!hud.hasGroundWork && hud.airLeft)) return { ...HAVEN_LIFT, name: 'Lighthouse airship lift', kind: 'lift' };
  return { ...BEACON, name: 'Tideglass Lighthouse', kind: 'beacon' };
}

export function underwaterHud(state, player) {
  if (!player || realmOf(player) !== 'reef') return null;
  const underwater = state.underwater || {};
  const remaining = Math.max(0, Number(underwater.remaining) || 0);
  if (remaining > 0) return { stage: 'guards', title: 'Clear the Sunken Reach', detail: `${remaining} reef guard${remaining === 1 ? '' : 's'} remaining` };
  if (!underwater.chestOpened) return { stage: 'chest', title: 'Search the wreck', detail: 'The treasure chest is unlocked. Swim inside to collect it.' };
  return { stage: 'return', title: 'Return to shore', detail: 'The wreck is secured. Follow the cyan beacon and press E.' };
}

export function underwaterObjective(state, player) {
  const hud = underwaterHud(state, player);
  if (!hud) return null;
  if (hud.stage === 'guards') {
    const enemies = (state.enemies || []).filter(enemy => enemy.hp > 0 && sameRealm(player, enemy));
    const target = enemies.sort((a, b) => distance3(player, a) - distance3(player, b))[0];
    return target ? { ...target, name: 'Reef guard', kind: 'reef-guard' } : { ...REEF_CHEST, name: 'Sunken wreck', kind: 'reef-chest' };
  }
  if (hud.stage === 'chest') return { ...REEF_CHEST, name: 'Wreck treasure', kind: 'reef-chest' };
  return { ...REEF_EXIT, kind: 'reef-exit' };
}

export function nearestObjective(state, player) {
  if (!player) return null;
  if (realmOf(player) === 'reef') return underwaterObjective(state, player);
  if (skyState(state)) return skyObjective(state, player);
  if (player.gunId) return null;
  if (player.mode === 'aboard') {
    // A physical gate comes first aboard: the marker is a place to walk to, not
    // a distant beach the pirate cannot steer for yet.
    const ship = shipAt(state.elapsed), gate = aboardGate(player);
    return { id: gate.id, name: gate.name, kind: 'jump-gate', x: ship.x + gate.x, y: ship.y + 2.6, z: ship.z + gate.z };
  }
  if (player.mode === 'gliding') return glideLanding(state, player);
  if (state.phase === 'finale') {
    const boss = state.enemies.find((enemy) => enemy.id === state.bossId);
    return boss ? { ...boss, name: 'Tempest Crab', kind: 'boss' } : { ...BEACON, name: 'Tideglass Lighthouse', kind: 'beacon' };
  }
  if (state.shards >= 3) return { ...BEACON, name: 'Tideglass Lighthouse', kind: 'beacon' };
  const remaining = SHRINES.filter((shrine) => state.shrines.find((entry) => entry.id === shrine.id)?.status !== 'cleared');
  const nearbyActive = remaining.find((shrine) => state.shrines.find((entry) => entry.id === shrine.id)?.status === 'active' && distance(player, shrine) < 30);
  return nearbyActive || remaining.sort((a, b) => distance(player, a) - distance(player, b))[0] || null;
}

// Pure map inventory used by the painter and tests. Cross-realm crew, pings and
// drops never appear as if they occupy the same chart.
export function mapEntries(state, player) {
  const realm = realmOf(player);
  const players = (state.players || []).filter(entry => entry.online && realmOf(entry) === realm);
  const playerIds = new Set(players.map(entry => entry.id));
  return {
    realm,
    players,
    pings: (state.pings || []).filter(entry => entry.realm ? realmOf(entry) === realm : playerIds.has(entry.playerId)),
    drops: (state.drops || []).filter(entry => realmOf(entry) === realm),
    landmarks: realm === 'reef'
      ? [{ ...REEF_EXIT, kind: 'reef-exit' }, { ...REEF_CHEST, name: 'Wreck treasure', kind: 'reef-chest' }]
      : [{ ...DIVE_ENTRANCE, kind: 'dive-entrance' }],
  };
}

function avatar(player) {
  const element = document.createElement('span');
  element.className = 'crew-avatar';
  element.style.setProperty('--crew-color', COLORS.includes(player.color) ? player.color : COLORS[0]);
  element.textContent = (player.name || '?').slice(0, 1).toUpperCase();
  return element;
}

export function crewLocationLabel(localPlayer, player) {
  if (sameRealm(localPlayer, player)) return '';
  return realmOf(player) === 'reef' ? 'below' : 'ashore';
}

function createMapPainter() {
  const extent = WORLD_RADIUS + 12;
  const base = document.createElement('canvas');
  base.width = 450; base.height = 450;
  const context = base.getContext('2d');
  context.fillStyle = '#499fae'; context.fillRect(0, 0, 450, 450);
  const regionColors = { beach: '#e4cc90', jungle: '#6fba84', volcano: '#dca679', moon: '#a4acd9', haven: '#90c6ad' };
  const cell = 3;
  for (let py = 0; py < 450; py += cell) {
    for (let px = 0; px < 450; px += cell) {
      const x = (px / 450 * 2 - 1) * extent;
      const z = (py / 450 * 2 - 1) * extent;
      const h = heightAt(x, z);
      if (h <= .05 || Math.hypot(x, z) > WORLD_RADIUS) continue;
      const coast = Math.hypot(x, z) > WORLD_RADIUS - 12 || h < 1.1;
      context.fillStyle = coast ? '#eddaaa' : regionColors[regionAt(x, z).id] || '#9ac797';
      context.fillRect(px, py, cell + .2, cell + .2);
      if (!coast && h > 7) {
        context.fillStyle = `rgba(27,73,74,${Math.min(.23, (h - 7) * .012)})`;
        context.fillRect(px, py, cell + .2, cell + .2);
      }
    }
  }
  const basePoint = (point) => ({ x: 450 * (.5 + point.x / (extent * 2)), y: 450 * (.5 + point.z / (extent * 2)) });
  context.lineCap = 'round'; context.lineJoin = 'round';
  context.strokeStyle = '#efdbad'; context.lineWidth = 5 * 450 / (extent * 2);
  const routes = [...[SPAWN, ...SHRINES].map((point) => [BEACON, point]), ...EXPLORATION_TRAILS.map((trail) => trail.points)];
  for (const points of routes) {
    context.beginPath();
    points.forEach((point, index) => {
      const position = basePoint(point);
      if (index === 0) context.moveTo(position.x, position.y); else context.lineTo(position.x, position.y);
    });
    context.stroke();
  }
  for (const building of BUILDINGS) {
    const position = basePoint(building); const radius = building.radius * 450 / (extent * 2);
    context.save(); context.translate(position.x, position.y); context.rotate(-building.yaw);
    context.fillStyle = building.roofColor; context.strokeStyle = '#725b49'; context.lineWidth = .8;
    if (['watchtower', 'windmill', 'observatory'].includes(building.kind)) {
      context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    } else {
      const width = (building.width || building.radius * Math.SQRT2) * 450 / (extent * 2);
      const depth = (building.depth || building.radius * Math.SQRT2) * 450 / (extent * 2);
      context.fillRect(-width / 2, -depth / 2, width, depth); context.strokeRect(-width / 2, -depth / 2, width, depth);
      if (building.enterable) {
        const door = building.doorWidth * 450 / (extent * 2);
        context.strokeStyle = '#fff6dd'; context.lineWidth = 2;
        for (const side of [-1, 1]) { context.beginPath(); context.moveTo(-door / 2, side * depth / 2); context.lineTo(door / 2, side * depth / 2); context.stroke(); }
      }
    }
    context.restore();
  }
  context.strokeStyle = '#ffffff16'; context.lineWidth = 1;
  for (let x = 0; x <= 450; x += 45) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 450); context.stroke(); }
  for (let y = 0; y <= 450; y += 45) { context.beginPath(); context.moveTo(0, y); context.lineTo(450, y); context.stroke(); }

  const diamond = (ctx, x, y, radius, fill, stroke = '#123c51') => {
    ctx.beginPath(); ctx.moveTo(x, y - radius); ctx.lineTo(x + radius * .8, y); ctx.lineTo(x, y + radius); ctx.lineTo(x - radius * .8, y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
  };
  const shield = (ctx, x, y, radius, active) => {
    if (active) {
      ctx.beginPath(); ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
      ctx.fillStyle = '#123c51cc'; ctx.fill(); ctx.strokeStyle = SIDE_EVENT_COLOR; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(x - radius * .8, y - radius * .8); ctx.lineTo(x + radius * .8, y - radius * .8);
    ctx.lineTo(x + radius * .7, y + radius * .15); ctx.lineTo(x, y + radius); ctx.lineTo(x - radius * .7, y + radius * .15); ctx.closePath();
    ctx.fillStyle = SIDE_EVENT_COLOR; ctx.fill(); ctx.strokeStyle = '#123c51'; ctx.lineWidth = 1.5; ctx.stroke();
  };

  function drawReefMap(ctx, width, height, size, ox, oy, state, player, large, elapsed) {
    const entries = mapEntries(state, player);
    const spanX = REEF_BOUNDS.maxX - REEF_BOUNDS.minX, spanZ = REEF_BOUNDS.maxZ - REEF_BOUNDS.minZ;
    const point = value => ({ x: ox + (value.x - REEF_BOUNDS.minX) / spanX * size,
      y: oy + (value.z - REEF_BOUNDS.minZ) / spanZ * size });
    const scaleX = size / spanX, scaleZ = size / spanZ;
    const gradient = ctx.createLinearGradient(0, oy, 0, oy + size);
    gradient.addColorStop(0, '#176b76'); gradient.addColorStop(1, '#062f47');
    ctx.fillStyle = '#082d41'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = gradient; ctx.fillRect(ox, oy, size, size);
    ctx.strokeStyle = '#89e7df22'; ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(ox, oy + size * i / 8); ctx.lineTo(ox + size, oy + size * i / 8); ctx.stroke(); }
    // Broken hull boxes are drawn from the exact collision plan shared with the server.
    for (const solid of REEF_SOLIDS) {
      const center = point(solid);
      ctx.fillStyle = solid.id === 'wreck-deck' ? '#98754a' : '#694f39';
      ctx.strokeStyle = '#d3bd83'; ctx.lineWidth = large ? 2 : 1;
      ctx.fillRect(center.x - solid.width * scaleX / 2, center.y - solid.depth * scaleZ / 2,
        solid.width * scaleX, solid.depth * scaleZ);
      ctx.strokeRect(center.x - solid.width * scaleX / 2, center.y - solid.depth * scaleZ / 2,
        solid.width * scaleX, solid.depth * scaleZ);
    }
    if (large) {
      ctx.font = 'bold 12px "Trebuchet MS",sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#dcf8ed';
      const wreck = point(REEF_CHEST); ctx.fillText('Sunken wreck', wreck.x, wreck.y - 18);
      ctx.font = '11px "Trebuchet MS",sans-serif'; ctx.fillStyle = '#9ed7d3'; ctx.fillText(`Depth ${Math.max(0, Math.round(18 - player.y))} m`, ox + size - 43, oy + 17);
    }
    const exit = point(REEF_EXIT);
    ctx.beginPath(); ctx.arc(exit.x, exit.y, large ? 9 : 5, 0, Math.PI * 2); ctx.fillStyle = '#79f5ff'; ctx.fill();
    ctx.strokeStyle = '#fff7d9'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(exit.x, exit.y + 4); ctx.lineTo(exit.x, exit.y - 5); ctx.moveTo(exit.x - 4, exit.y - 1); ctx.lineTo(exit.x, exit.y - 5); ctx.lineTo(exit.x + 4, exit.y - 1); ctx.stroke();
    const chest = point(REEF_CHEST);
    if (!state.underwater?.chestOpened) {
      ctx.fillStyle = '#ffd16c'; ctx.fillRect(chest.x - (large ? 5 : 3), chest.y - (large ? 4 : 2), large ? 10 : 6, large ? 8 : 4);
    }
    const objective = nearestObjective(state, player);
    if (large && objective) {
      const a = point(player), b = point(objective);
      ctx.strokeStyle = '#fff0a0'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const ping of entries.pings) {
      if (ping.expiresAt < elapsed) continue;
      const position = point(ping), owner = entries.players.find(entry => entry.id === ping.playerId);
      ctx.beginPath(); ctx.arc(position.x, position.y, (large ? 12 : 6) + Math.sin(elapsed * 5) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = owner?.color || '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    for (const friend of entries.players) {
      const current = friend.id === player.id ? player : friend, position = point(current), local = friend.id === player.id;
      ctx.save(); ctx.translate(position.x, position.y);
      if (local) { ctx.rotate(-current.yaw); ctx.beginPath(); ctx.moveTo(0, large ? -9 : -6); ctx.lineTo(large ? 7 : 4.5, large ? 7 : 4.5); ctx.lineTo(0, large ? 3 : 2); ctx.lineTo(large ? -7 : -4.5, large ? 7 : 4.5); ctx.closePath(); }
      else { ctx.beginPath(); ctx.arc(0, 0, large ? 5 : 3.5, 0, Math.PI * 2); }
      ctx.fillStyle = current.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
      if (large) { ctx.font = `${local ? 'bold ' : ''}11px "Trebuchet MS",sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#e9fffb'; ctx.fillText(local ? 'You' : friend.name, position.x, position.y - 12); }
    }
    ctx.strokeStyle = '#8be7df88'; ctx.lineWidth = large ? 2 : 1; ctx.strokeRect(ox, oy, size, size);
  }

  return function drawMap(canvas, state, player, large, elapsed, discoveries) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const width = rect.width; const height = rect.height;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const size = Math.min(width, height) - (large ? 16 : 0);
    const ox = (width - size) / 2; const oy = (height - size) / 2;
    if (realmOf(player) === 'reef') {
      drawReefMap(ctx, width, height, size, ox, oy, state, player, large, elapsed);
      return;
    }
    const mapPoint = (point) => ({ x: ox + size * (.5 + point.x / (extent * 2)), y: oy + size * (.5 + point.z / (extent * 2)) });
    const mapEvents = state.phase === 'voyage' ? sideEventEntries(state).filter((event) => ['available', 'active'].includes(event.status)) : [];
    const occupied = [];
    if (large) {
      for (const point of [...SHRINES, BEACON, ...POINTS_OF_INTEREST, ...mapEvents, ...AIRSHIP_RETURNS]) {
        const position = mapPoint(point); const radius = point === BEACON ? 17 : point.placeId ? 12 : point.radius ? 7 : 15;
        occupied.push({ x: position.x - radius, y: position.y - radius, width: radius * 2, height: radius * 2 });
      }
    }
    ctx.fillStyle = large ? '#e4f0e6' : '#499fae'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(base, ox, oy, size, size);
    if (large) {
      ctx.strokeStyle = '#123c5138'; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, size, size);
      ctx.font = 'bold 11px "Trebuchet MS",sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#315e66';
      ctx.fillText('N', width / 2, oy + 13);
      ctx.fillText('S', width / 2, oy + size - 5);
      ctx.fillText('W', ox + 10, height / 2 + 3); ctx.fillText('E', ox + size - 10, height / 2 + 3);
    } else {
      ctx.font = 'bold 10px "Trebuchet MS",sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff7d9'; ctx.fillText('N', width / 2, 13);
    }
    const objective = nearestObjective(state, player);
    if (large && objective && player && player.mode === 'ground') {
      const a = mapPoint(player); const b = mapPoint(objective);
      ctx.strokeStyle = '#fff0a0'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const chest of CHESTS) {
      if (state.chests.find((entry) => entry.id === chest.id)?.opened) continue;
      const position = mapPoint(chest);
      ctx.fillStyle = large ? '#896138' : '#725337';
      const r = large ? 3 : 1.3; ctx.fillRect(position.x - r, position.y - r, r * 2, r * 2);
    }
    for (const shrine of SHRINES) {
      const dynamic = state.shrines.find((entry) => entry.id === shrine.id);
      const position = mapPoint(shrine);
      if (dynamic?.status === 'active') {
        ctx.beginPath(); ctx.arc(position.x, position.y, large ? 14 : 8, 0, Math.PI * 2); ctx.fillStyle = '#fff7c477'; ctx.fill();
      }
      diamond(ctx, position.x, position.y, large ? 9 : 5, dynamic?.status === 'cleared' ? '#7df0b9' : '#ffdb70');
      if (dynamic?.status === 'cleared' && large) {
        ctx.fillStyle = '#123c51'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✓', position.x, position.y + 3);
      }
    }
    const beacon = mapPoint(BEACON);
    ctx.font = `${large ? 27 : 17}px "Trebuchet MS",sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = state.shards >= 3 ? '#fff4b2' : '#f6f6e7'; ctx.strokeStyle = '#123c51'; ctx.lineWidth = 3;
    ctx.strokeText('✦', beacon.x, beacon.y + (large ? 9 : 6)); ctx.fillText('✦', beacon.x, beacon.y + (large ? 9 : 6));
    if (large) {
      for (const region of REGIONS) {
        const position = mapPoint(region);
        const name = region.name.split(' ');
        const line1 = name.slice(0, -1).join(' '); const line2 = name.at(-1);
        const y = position.y + (region.id === 'beach' ? 21 : 29);
        ctx.textAlign = 'center'; ctx.font = 'bold 12px "Trebuchet MS",sans-serif'; ctx.fillStyle = '#174555'; ctx.strokeStyle = '#ecf0d3'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
        ctx.strokeText(line1, position.x, y); ctx.fillText(line1, position.x, y);
        ctx.strokeText(line2, position.x, y + 14); ctx.fillText(line2, position.x, y + 14);
        const labelWidth = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 8;
        occupied.push({ x: position.x - labelWidth / 2, y: y - 13, width: labelWidth, height: 31 });
      }
    }
    // At a defense settlement, its shield and title also identify the place.
    // Every destination uses the same collision-aware label placement below.
    const destinations = [...AIRSHIP_RETURNS.map((lift) => ({ ...lift, kind: 'airship-return' })), ...mapEvents,
      ...POINTS_OF_INTEREST.filter((place) => !mapEvents.some((event) => event.placeId === place.id))];
    for (const place of destinations) {
      const position = mapPoint(place); const isEvent = !!place.placeId, isLift = place.kind === 'airship-return';
      const discovered = isLift || discoveries.has(isEvent ? place.placeId : place.id);
      if (isLift) {
        const radius = large ? 8 : 5;
        ctx.beginPath(); ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#baf9f3'; ctx.fill(); ctx.strokeStyle = '#856331'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = '#174555'; ctx.lineWidth = large ? 1.8 : 1.3;
        ctx.beginPath(); ctx.moveTo(position.x, position.y + radius * .5); ctx.lineTo(position.x, position.y - radius * .5);
        ctx.moveTo(position.x - radius * .45, position.y); ctx.lineTo(position.x, position.y - radius * .5); ctx.lineTo(position.x + radius * .45, position.y); ctx.stroke();
      } else if (isEvent) shield(ctx, position.x, position.y, large ? 8 : 4.5, place.status === 'active');
      else {
        ctx.beginPath(); ctx.arc(position.x, position.y, large ? 4 : 2, 0, Math.PI * 2);
        ctx.fillStyle = discovered ? '#286e67' : '#e9efda'; ctx.fill();
        ctx.strokeStyle = '#286e67'; ctx.lineWidth = large ? 1.5 : .8; ctx.stroke();
      }
      if (!large) continue;
      ctx.font = 'bold 10px "Trebuchet MS",sans-serif';
      const statusLine = isLift ? 'E · Teleport to airship' : isEvent ? `${place.status === 'active' ? `Wave ${place.wave}/${SIDE_EVENT_WAVES}` : 'Optional defense'} · ${place.reward} pearls` : '';
      const labelWidth = Math.max(ctx.measureText(place.name).width, ctx.measureText(statusLine).width) + 10; const labelHeight = statusLine ? 31 : 18;
      const candidates = [
        [12, -labelHeight / 2], [-labelWidth - 12, -labelHeight / 2], [-labelWidth / 2, -labelHeight - 12], [-labelWidth / 2, 14],
        [12, -labelHeight - 12], [-labelWidth - 12, -labelHeight - 12], [12, 15], [-labelWidth - 12, 15],
        [-labelWidth / 2, -labelHeight - 32], [-labelWidth / 2, 34],
      ];
      // Keep destination names clear of the quest symbols, region names, and one another.
      const labels = candidates.map(([dx, dy], index) => {
        const box = { x: clamp(position.x + dx, 4, width - labelWidth - 4), y: clamp(position.y + dy, oy + 18, oy + size - labelHeight - 18), width: labelWidth, height: labelHeight };
        const overlap = occupied.reduce((sum, other) => sum + Math.max(0, Math.min(box.x + box.width + 3, other.x + other.width) - Math.max(box.x - 3, other.x)) * Math.max(0, Math.min(box.y + box.height + 3, other.y + other.height) - Math.max(box.y - 3, other.y)), 0);
        return { ...box, score: overlap * 100 + index };
      });
      labels.sort((a, b) => a.score - b.score); const label = labels[0]; occupied.push(label);
      ctx.beginPath(); ctx.moveTo(position.x, position.y);
      ctx.lineTo(clamp(position.x, label.x, label.x + label.width), clamp(position.y, label.y, label.y + label.height));
      ctx.strokeStyle = '#315e6677'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = isLift ? '#d7faf1f2' : isEvent ? '#123c51f2' : discovered ? '#e9f5dfed' : '#eef1e3dd'; ctx.fillRect(label.x, label.y, label.width, label.height);
      ctx.textAlign = 'left'; ctx.fillStyle = isEvent ? SIDE_EVENT_COLOR : discovered ? '#19594f' : '#3b6269';
      ctx.fillText(place.name, label.x + 5, label.y + 12);
      if (statusLine) { ctx.fillStyle = isLift ? '#315e66' : '#fff6dd'; ctx.font = '10px "Trebuchet MS",sans-serif'; ctx.fillText(statusLine, label.x + 5, label.y + 25); }
    }
    const entries = mapEntries(state, player);
    const dive = mapPoint(DIVE_ENTRANCE);
    ctx.beginPath(); ctx.arc(dive.x, dive.y, large ? 8 : 4.5, 0, Math.PI * 2); ctx.fillStyle = '#146d86'; ctx.fill(); ctx.strokeStyle = '#c9fbef'; ctx.lineWidth = 2; ctx.stroke();
    if (large) { ctx.font = 'bold 10px "Trebuchet MS",sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#174555'; ctx.fillText('Sunken Reach', dive.x, dive.y + 20); }
    for (const ping of entries.pings) {
      if (ping.expiresAt < elapsed) continue;
      const position = mapPoint(ping);
      const owner = entries.players.find((entry) => entry.id === ping.playerId);
      ctx.beginPath(); ctx.arc(position.x, position.y, (large ? 12 : 6) + Math.sin(elapsed * 5) * 2, 0, Math.PI * 2); ctx.strokeStyle = owner?.color || '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    for (const friend of entries.players) {
      const isLocal = friend.id === player?.id;
      const current = isLocal ? player : friend;
      const position = mapPoint(current);
      ctx.save(); ctx.translate(position.x, position.y);
      if (isLocal) {
        ctx.rotate(-current.yaw);
        ctx.beginPath(); ctx.moveTo(0, large ? -9 : -6); ctx.lineTo(large ? 7 : 4.5, large ? 7 : 4.5); ctx.lineTo(0, large ? 3 : 2); ctx.lineTo(large ? -7 : -4.5, large ? 7 : 4.5); ctx.closePath();
      } else { ctx.beginPath(); ctx.arc(0, 0, large ? 5 : 3.5, 0, Math.PI * 2); }
      ctx.fillStyle = current.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
      if (large) {
        ctx.font = `${isLocal ? 'bold ' : ''}11px "Trebuchet MS",sans-serif`; ctx.fillStyle = '#123c51'; ctx.strokeStyle = '#eff5e3'; ctx.lineWidth = 3; ctx.textAlign = 'center';
        const label = isLocal ? 'You' : friend.name; ctx.strokeText(label, position.x, position.y - 12); ctx.fillText(label, position.x, position.y - 12);
      }
    }
  };
}

export function createUI(callbacks = {}) {
  const refs = {};
  for (const element of document.querySelectorAll('[id]')) refs[element.id] = element;
  let joined = false;
  let paused = false;
  let mapOpen = false;
  let lastPhase = '';
  let lastRoster = '';
  let lastCrewHealth = '';
  let lastVictory = '';
  let lastMapRealm = '';
  let mapAt = 0;
  let hitUntil = 0;
  let bannerTimer = 0;
  let target = null;
  let discoveryRound = null;
  let discoveryUntil = 0;
  const discoveries = new Set();
  const placeEntries = new Map();
  let settings = { quality: read('skywake-quality', 'high'), muted: false };
  const plates = new Map();
  const notices = new Map();
  const drawMap = createMapPainter();
  const cleanup = [];
  const listen = (element, event, handler) => { element.addEventListener(event, handler); cleanup.push(() => element.removeEventListener(event, handler)); };
  const button = (id, callback) => listen(refs[id], 'click', callback);
  const modalChanged = () => callbacks.onModalChange?.({ paused, mapOpen });
  let lootState = null;
  let lootPlayer = null;
  let lootConnected = false;
  const lootReveal = createLootReveal({
    root: refs['loot-reveal'], medallion: refs['loot-medallion'], art: refs['loot-art'], details: refs['loot-details'],
    kicker: refs['loot-kicker'], name: refs['loot-name'], rarity: refs['loot-rarity'], rays: refs['loot-rays'],
    getIcon: (weapon) => refs[`weapon-${weapon}`]?.querySelector('.weapon-icon'),
    onStart: (event) => callbacks.onLootReveal?.(event),
  });
  function updateLootContext(state = lootState, player = lootPlayer) {
    lootState = state; lootPlayer = player;
    lootReveal.setContext({ round: state?.round ?? null, playerId: player?.id ?? null,
      active: lootConnected && !!player && ['voyage', 'finale'].includes(state?.phase)
        && ['ground', 'swimming'].includes(player.mode) && player.hp > 0 && player.online !== false
        && !(player.knockedUntil > state.elapsed) && !paused && !mapOpen && !document.hidden });
  }
  listen(document, 'visibilitychange', () => updateLootContext());

  for (const place of POINTS_OF_INTEREST) {
    const entry = document.createElement('li');
    const mark = document.createElement('span'); mark.setAttribute('aria-hidden', 'true'); mark.textContent = '○';
    const name = document.createElement('span'); name.textContent = place.name;
    entry.append(mark, name); entry.title = place.description; entry.setAttribute('aria-label', `${place.name}, not yet visited`);
    refs['places-list'].append(entry); placeEntries.set(place.id, entry);
  }
  function updateDiscoveries() {
    text(refs['places-count'], `Places discovered ${discoveries.size} / ${POINTS_OF_INTEREST.length}`);
    for (const place of POINTS_OF_INTEREST) {
      const entry = placeEntries.get(place.id); const discovered = discoveries.has(place.id);
      entry.classList.toggle('discovered', discovered); text(entry.firstElementChild, discovered ? '✓' : '○');
      entry.setAttribute('aria-label', `${place.name}, ${discovered ? 'discovered' : 'not yet visited'}`);
    }
  }
  function clearDiscoveries() {
    discoveries.clear(); discoveryUntil = 0; show(refs['discovery-notice'], false); updateDiscoveries();
  }
  updateDiscoveries();

  const colorNames = ['Sunset orange', 'Seafoam teal', 'Moonlight purple', 'Coral pink', 'Treasure gold'];
  const savedColor = read('skywake-color', COLORS[0]);
  COLORS.forEach((color, index) => {
    const label = document.createElement('label'); label.className = 'color-choice'; label.style.setProperty('--crew-color', color); label.title = colorNames[index];
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'crew-color'; radio.value = color; radio.checked = color === savedColor || (index === 0 && !COLORS.includes(savedColor)); radio.setAttribute('aria-label', colorNames[index]);
    const swatch = document.createElement('span'); swatch.setAttribute('aria-hidden', 'true'); label.append(radio, swatch); refs['crew-colors'].append(label);
  });
  refs['pirate-name'].value = read('skywake-name', 'Sea Explorer').slice(0, 16);
  refs['quality-select'].value = settings.quality === 'low' ? 'low' : 'high';

  listen(refs['join-form'], 'submit', (event) => {
    event.preventDefault();
    const name = refs['pirate-name'].value.trim().slice(0, 16) || 'Sea Explorer';
    const color = refs['crew-colors'].querySelector('input:checked')?.value || COLORS[0];
    refs['pirate-name'].value = name;
    write('skywake-name', name); write('skywake-color', color);
    show(refs['join-error'], false);
    callbacks.onJoin?.(name, color);
  });
  button('launch-button', () => callbacks.onAction?.('launch'));
  button('ready-button', () => callbacks.onAction?.('ready'));
  button('restart-button', () => callbacks.onAction?.('restart'));
  button('deck-action-button', () => callbacks.onDeckAction?.());
  for (const weapon of WEAPON_ORDER) button(`weapon-${weapon}`, () => callbacks.onAction?.(weapon));
  button('heal-button', () => callbacks.onAction?.('heal'));
  button('menu-button', () => api.setPaused(!paused));
  button('resume-button', () => api.setPaused(false));
  button('minimap-button', () => api.setMap(true));
  button('close-map', () => api.setMap(false));
  button('sound-button', () => callbacks.onSound?.(!settings.muted));
  listen(refs['sound-toggle'], 'change', () => callbacks.onSound?.(!refs['sound-toggle'].checked));
  listen(refs['quality-select'], 'change', () => {
    settings.quality = refs['quality-select'].value;
    write('skywake-quality', settings.quality);
    callbacks.onQuality?.(settings.quality);
  });
  button('leave-button', () => callbacks.onLeave?.());
  button('victory-leave', () => callbacks.onLeave?.());
  button('boot-retry', () => location.reload());
  // The logo is an explicit return to the welcome screen, without a page unload.
  listen(document.querySelector('.wordmark'), 'click', (event) => { event.preventDefault(); if (joined) api.setPaused(true); });

  // Two boss rows, built once from the authored roster and only updated after
  // that, so the siege HUD never grows with events or snapshots.
  const skyRows = new Map();
  function renderSkyProgress(sky) {
    text(refs['sky-phase'], sky.phase);
    for (const boss of sky.bosses) {
      let row = skyRows.get(boss.id);
      if (!row) {
        const item = document.createElement('li');
        const name = document.createElement('span'); name.className = 'sky-boss-name';
        const percent = document.createElement('strong'); percent.className = 'sky-boss-percent';
        const meter = document.createElement('progress'); meter.max = 1; meter.value = 1;
        const note = document.createElement('span'); note.className = 'sky-boss-note';
        item.append(name, percent, meter, note); refs['sky-bosses'].append(item);
        row = { item, name, percent, meter, note }; skyRows.set(boss.id, row);
      }
      text(row.name, boss.name);
      text(row.percent, boss.planned ? '—' : boss.down ? 'Down' : `${boss.percent}%`);
      row.meter.value = boss.planned ? 1 : boss.maxHp > 0 && !boss.down ? Math.max(0, boss.hp / boss.maxHp) : 0;
      row.meter.setAttribute('aria-label', `${boss.name}: ${boss.planned ? 'approaching' : boss.down ? 'defeated' : `${boss.percent}% health`}`);
      text(row.note, boss.planned ? `${boss.side} lane · not yet diving`
        : boss.down ? 'Defeated' : boss.winding ? `${boss.side} lane · winding up a shell` : `${boss.side} lane`);
      row.item.classList.toggle('down', boss.down || boss.planned);
      row.item.classList.toggle('winding', !!boss.winding);
    }
    text(refs['sky-ground'], sky.ground);
  }

  function roster(state, localPlayer) {
    const signature = `${state.hostId}|${state.players.map((player) => `${player.id}:${player.name}:${player.color}:${player.online}:${player.ready}`).join('|')}`;
    if (signature === lastRoster) return;
    lastRoster = signature;
    refs['lobby-roster'].replaceChildren();
    const onlinePlayers = state.players.filter((player) => player.online);
    text(refs['crew-count'], `${onlinePlayers.length} / 5`);
    for (const player of state.players) {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.className = 'crew-name'; name.textContent = `${player.name}${player.id === localPlayer.id ? ' (you)' : ''}`;
      const badge = document.createElement('span'); badge.className = 'crew-badge'; badge.textContent = !player.online ? 'Rejoining…' : player.id === state.hostId ? 'Captain' : player.ready ? 'Ready ✓' : 'Aboard';
      li.append(avatar(player), name, badge); refs['lobby-roster'].append(li);
    }
    for (let i = state.players.length; i < 5; i++) {
      const li = document.createElement('li'); li.className = 'empty-seat';
      const circle = document.createElement('span'); circle.className = 'crew-avatar'; circle.textContent = '+';
      const label = document.createElement('span'); label.textContent = 'A place for a friend'; li.append(circle, label); refs['lobby-roster'].append(li);
    }
  }

  function crewHealth(state, localPlayer) {
    const friends = state.players.filter((player) => player.id !== localPlayer.id);
    const signature = `${localPlayer.id}:${realmOf(localPlayer)}|${friends.map((player) => `${player.id}:${player.name}:${player.color}:${Math.ceil(player.hp)}:${player.online}:${player.knockedUntil > state.elapsed}:${realmOf(player)}`).join('|')}`;
    if (signature === lastCrewHealth) return;
    lastCrewHealth = signature;
    refs['crew-hud'].replaceChildren();
    for (const player of friends) {
      const li = document.createElement('li'); li.className = player.online ? '' : 'offline';
      const location = crewLocationLabel(localPlayer, player);
      const elsewhere = location ? ` · ${location}` : '';
      const status = player.knockedUntil > state.elapsed ? ' · needs help' : !player.online ? ' · rejoining' : '';
      const name = document.createElement('span'); name.className = 'crew-name'; name.textContent = `${player.name}${status}${elsewhere}`;
      name.title = `${player.name}${status}${elsewhere}`;
      const health = document.createElement('progress'); health.max = player.maxHp; health.value = player.hp; health.setAttribute('aria-label', `${player.name}: ${Math.ceil(player.hp)} health`);
      li.append(avatar(player), name, health); refs['crew-hud'].append(li);
    }
  }

  function victory(state, localPlayer) {
    const result = state.victory || { pearls: state.pearls, duration: state.elapsed, rescues: 0, kills: 0 };
    const signature = `${state.round}:${state.hostId}:${state.players.length}:${result.pearls}`;
    show(refs['restart-button'], state.hostId === localPlayer.id);
    show(refs['victory-waiting'], state.hostId !== localPlayer.id);
    if (signature === lastVictory) return;
    lastVictory = signature;
    text(refs['victory-pearls'], result.pearls);
    text(refs['victory-time'], formatTime(result.duration));
    text(refs['victory-rescues'], result.rescues);
    text(refs['victory-record'], `${state.stats.wins} island${state.stats.wins === 1 ? '' : 's'} restored by crews on this server · Best treasure: ${state.stats.bestPearls} pearls`);
    refs['victory-crew'].replaceChildren();
    for (const player of state.players) {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.className = 'crew-name'; name.textContent = player.name;
      const contribution = document.createElement('span'); contribution.className = 'victory-contribution'; contribution.textContent = `${player.kills} crabs · ${player.chests} chests · ${player.rescues} rescues`;
      li.append(avatar(player), name, contribution); refs['victory-crew'].append(li);
    }
  }

  const compassPoints = [];
  for (let degrees = 0; degrees < 360; degrees += 15) {
    const span = document.createElement('span');
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    span.textContent = names[degrees] || '│'; span.className = names[degrees] ? '' : 'minor';
    refs['compass-strip'].append(span); compassPoints.push({ span, degrees });
  }

  const api = {
    get paused() { return paused; },
    get mapOpen() { return mapOpen; },
    get quality() { return settings.quality; },
    get menuOpen() { return paused || mapOpen; },
    ready() { show(refs.boot, false); show(refs.topbar, true); show(refs.welcome, true); show(refs['welcome-caption'], true); },
    fatal(message) { lootConnected = false; updateLootContext(); api.clearWeaponPresentation(); show(refs.boot, true); text(refs['boot-title'], 'The island needs a hand.'); text(refs['boot-message'], message); show(refs['boot-retry'], true); },
    setJoining(value) {
      refs['join-button'].disabled = !!value; refs['join-button'].setAttribute('aria-busy', String(!!value));
      text(refs['join-button'].firstElementChild, value ? 'Finding your ship…' : 'Board the ship');
    },
    setError(message) { text(refs['join-error'], message); show(refs['join-error'], true); api.setJoining(false); },
    setConnection({ status, message }) {
      lootConnected = status === 'connected'; updateLootContext();
      if (status !== 'connected') api.clearWeaponPresentation();
      refs.connection.classList.toggle('offline', status === 'reconnecting' || status === 'connecting');
      refs.connection.classList.toggle('error', status === 'error');
      text(refs.connection.lastElementChild, message);
      if (status === 'connected' || status === 'error' || status === 'idle') api.setJoining(false);
    },
    setSound(muted) {
      settings.muted = !!muted; refs['sound-toggle'].checked = !muted;
      text(refs['sound-button'], muted ? '♪̸' : '♫');
      refs['sound-button'].setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound'); refs['sound-button'].setAttribute('aria-pressed', String(muted));
    },
    setPaused(value) {
      if (!joined && value) return;
      paused = !!value;
      if (paused) api.clearWeaponPresentation();
      if (paused) { mapOpen = false; show(refs['map-overlay'], false); }
      if (paused) { show(refs['discovery-notice'], false); show(refs['side-event-status'], false); }
      updateLootContext();
      show(refs['pause-overlay'], paused); document.body.classList.toggle('paused', paused); document.body.classList.toggle('map-open', mapOpen);
      modalChanged();
      if (paused) refs['resume-button'].focus({ preventScroll: true });
    },
    setMap(value) {
      if (!joined || paused) return;
      mapOpen = !!value; show(refs['map-overlay'], mapOpen); document.body.classList.toggle('map-open', mapOpen); mapAt = 0;
      if (mapOpen) api.clearWeaponPresentation();
      if (mapOpen) { show(refs['discovery-notice'], false); show(refs['side-event-status'], false); }
      updateLootContext();
      modalChanged();
      if (mapOpen) refs['close-map'].focus({ preventScroll: true });
    },
    reset() {
      lootReveal.reset(); lootState = null; lootPlayer = null;
      api.clearWeaponPresentation();
      joined = false; paused = false; mapOpen = false; lastPhase = ''; lastRoster = ''; lastCrewHealth = ''; lastVictory = ''; lastMapRealm = '';
      discoveryRound = null; clearDiscoveries();
      show(refs['pause-overlay'], false); show(refs['map-overlay'], false); show(refs['victory-overlay'], false); show(refs['join-error'], false);
      api.announce(null);
      document.body.classList.remove('paused', 'map-open', 'in-reef'); plates.forEach((plate) => plate.remove()); plates.clear(); modalChanged();
    },
    updateLootContext,
    revealLoot(event) { return lootReveal.enqueue(event); },
    toast(message, warning = false) {
      const now = performance.now();
      if (now - (notices.get(message) || -10000) < 1800) return;
      notices.set(message, now);
      if (notices.size > 80) notices.delete(notices.keys().next().value);
      const element = document.createElement('div'); element.className = `toast${warning ? ' warning' : ''}`; element.textContent = message;
      refs['toast-stack'].append(element);
      while (refs['toast-stack'].children.length > 3) refs['toast-stack'].firstElementChild.remove();
      setTimeout(() => { element.classList.add('fade'); setTimeout(() => element.remove(), 270); }, warning ? 4800 : 3600);
    },
    hit() { hitUntil = performance.now() + 150; },
    announce(announcement) {
      const banner = refs['wave-banner'];
      clearTimeout(bannerTimer);
      show(banner, false); banner.classList.remove('fade');
      if (!announcement) return;
      banner.classList.toggle('final', !!announcement.final);
      text(refs['wave-kicker'], announcement.kicker || ''); text(refs['wave-title'], announcement.title || '');
      text(refs['wave-subtitle'], announcement.subtitle || '');
      void banner.offsetWidth; show(banner, true);
      bannerTimer = setTimeout(() => {
        banner.classList.add('fade');
        bannerTimer = setTimeout(() => { show(banner, false); banner.classList.remove('fade'); }, 560);
      }, 4000);
    },
    hurt() { refs.game.classList.remove('damage-flash'); void refs.game.offsetWidth; refs.game.classList.add('damage-flash'); },
    setTarget(enemy) { target = enemy; },
    clearWeaponPresentation() {
      show(refs['reload-ring'], false); show(refs['scope-overlay'], false); show(refs.reticle, false);
      refs['reload-progress'].style.strokeDashoffset = '100';
      document.body.classList.remove('scoped');
    },
    updateWeaponPresentation(presentation, player, view) {
      show(refs['reload-ring'], presentation.reloading);
      refs['reload-progress'].style.strokeDashoffset = String((1 - presentation.reloadProgress) * 100);
      show(refs['scope-overlay'], presentation.scoped);
      document.body.classList.toggle('scoped', presentation.scoped);
      show(refs.reticle, presentation.active && !presentation.scoped);
      refs.reticle.classList.toggle('scatter', !player?.gunId && player?.weapon === 'scatter');
      refs.reticle.classList.toggle('cannon', !!player?.gunId);
      refs.reticle.classList.toggle('reloading', presentation.reloading);
      show(refs['look-hint'], presentation.active && (!view.locked || player?.weapon === 'longshot'));
      text(refs['look-hint'], player?.gunId ? 'Hold right mouse to aim · Hold click fire · E or Space leaves the gun'
        : player?.mode === 'swimming' ? 'Look to steer · WASD swim · Space rise · C dive · Shift surge'
        : presentation.scoped ? 'Release right mouse to leave scope · R reload · Esc menu'
        : player?.weapon === 'longshot' ? 'Hold right mouse to scope Longshot · R reload · Esc menu'
          : 'Click to aim · Hold right mouse to look · R reload · Esc menu');
    },
    update(state, player, world, view) {
      updateLootContext(state, player);
      const now = performance.now();
      joined = !!player;
      const playing = joined && state.phase !== 'lobby' && state.phase !== 'victory';
      const lobby = joined && state.phase === 'lobby';
      const won = joined && state.phase === 'victory';
      const sideEvent = sideEventForHUD(state, player, { paused, mapOpen });
      show(refs['side-event-status'], !!sideEvent);
      if (joined && discoveryRound !== state.round) { discoveryRound = state.round; clearDiscoveries(); }
      show(refs['discovery-notice'], playing && !paused && !mapOpen && player.mode === 'ground' && now < discoveryUntil);
      show(refs.welcome, !joined); show(refs['welcome-caption'], !joined); show(refs['welcome-shade'], !joined);
      show(refs.lobby, lobby); show(refs.hud, playing); show(refs['menu-button'], joined && !won);
      if (!playing && !refs['wave-banner'].hidden) api.announce(null);
      show(refs['victory-overlay'], won);
      document.body.classList.toggle('is-playing', joined);
      document.body.classList.toggle('cannon-mounted', !!player?.gunId);
      document.body.classList.toggle('in-reef', realmOf(player) === 'reef');
      if (!joined) return;
      if (lastPhase !== state.phase) {
        lastPhase = state.phase;
        if (won) { paused = false; mapOpen = false; show(refs['pause-overlay'], false); show(refs['map-overlay'], false); document.body.classList.remove('paused', 'map-open'); modalChanged(); }
      }
      if (lobby) {
        roster(state, player);
        const host = state.hostId === player.id;
        show(refs['launch-button'], host); show(refs['ready-button'], !host);
        text(refs['ready-button'], player.ready ? 'Ready ✓' : 'Ready for adventure');
        text(refs['lobby-hint'], host ? 'Sail solo or wait for friends. You’re the captain: Enter sets sail.' : 'Your captain will set sail when the crew is aboard. Enter marks you ready.');
      }
      if (won) { victory(state, player); return; }
      if (!playing) return;
      const reef = realmOf(player) === 'reef';
      const region = reef ? null : regionAt(player.x, player.z);
      const place = player.mode === 'ground' ? pointOfInterestAt(player.x, player.z) : null;
      if (place && player.grounded && player.knockedUntil <= state.elapsed && !paused && !mapOpen && !discoveries.has(place.id)) {
        discoveries.add(place.id); updateDiscoveries(); mapAt = 0;
        text(refs['discovery-name'], place.name); text(refs['discovery-description'], place.description);
        discoveryUntil = now + 6500; show(refs['discovery-notice'], true);
      }
      const objective = nearestObjective(state, player);
      const objectiveDistance = objective ? Math.round(reef ? distance3(player, objective) : distance(player, objective)) : 0;
      let title = 'Find the three compass shards';
      let detail = objective ? `${objective.name} · ${objectiveDistance} m away` : 'Explore the island with your crew.';
      let activeShrine = null;
      const underwater = underwaterHud(state, player);
      const sky = skyHud(state, player);
      const gunner = skyGunnerGuidance(state, player);
      if (underwater) {
        title = underwater.title;
        detail = `${underwater.detail}${objective ? ` · ${objective.name} ${objectiveDistance} m away` : ''}`;
      } else if (gunner) {
        // The old practice line was the only thing a gunner ever read. During the
        // siege they get their own crab, its health and where the fight moved to.
        title = gunner.title;
        detail = objective && gunner.kind === 'boss' ? `${gunner.detail} · ${objectiveDistance} m` : gunner.detail;
      } else if (sky && player.mode === 'aboard') {
        const ready = sky.status === 'boarding' || sky.status === 'countdown';
        title = objective?.occupied ? 'The cannons are crewed' : ready ? 'Man a deck cannon'
          : sky.airLeft ? 'Gunners to the cannons' : sky.hasGroundWork ? 'Get down to the lighthouse' : 'Island secured';
        detail = objective?.occupied ? (sky.hasGroundWork
          ? 'Wait for a suitable gun, or use a jump gate to help on the ground.'
          : 'Your crewmates are on the remaining guns. Stay aboard while they finish the skycrabs.')
          : ready ? `E at a deck gun starts the siege${sky.countdown ? ` · diving in ${sky.countdown}s` : ''} · ${objective?.name || 'a gun'} ${objectiveDistance} m away`
          : sky.airLeft ? `${objective?.name || 'A deck gun'} · ${objectiveDistance} m away · only the cannons reach the skycrabs.`
          : sky.hasGroundWork ? `Sky clear. ${objective?.name || 'A jump gate'} · ${objectiveDistance} m away · E to glide down and hold the dais.`
          : 'Both skycrabs are down and every wave is cleared.';
      } else if (sky && player.mode === 'ground') {
        title = sky.hasGroundWork ? 'Hold the lighthouse' : sky.airLeft ? 'Take the lift to a cannon' : 'Island secured';
        detail = sky.hasGroundWork ? `${sky.ground} · watch for the ringed shells.`
          : sky.airLeft ? `${objective?.name || 'The haven lift'} · ${objectiveDistance} m away · the skycrabs only fall to cannon fire.`
          : 'Both skycrabs are down and every wave is cleared.';
      } else if (player.mode === 'aboard') {
        // Aboard guidance always names a physical gate and how far it is, so it
        // survives a missed toast and reads without colour or motion.
        title = player.gunId ? 'Try the deck cannon' : 'Walk to a jump gate, then press E';
        detail = player.gunId ? 'Aim at the winged flying crabs. Two hits, then a fresh target returns.'
          : `${objective?.name || 'A jump gate'} · ${objectiveDistance} m away · E opens your glider. The deck is safe: stay as long as you like.`;
      } else if (player.mode === 'gliding') {
        title = 'Glide onto the island';
        // A long return from the bow gate needs the whole glide: say so rather
        // than letting a pirate drift and land short.
        detail = `Steer with WASD toward ${objective?.name || 'open ground'} · ${objectiveDistance} m away.${objectiveDistance > 70 ? ' Hold Shift the whole way.' : ''}`;
      } else if (state.phase === 'finale') {
        const stage = FINALE_STAGES[(state.finale?.stage || 0) - 1];
        const boss = state.enemies.find((enemy) => enemy.id === state.bossId && enemy.hp > 0);
        if (!stage || stage.kind === 'boss' || boss) {
          title = 'Free the compass'; detail = 'Defeat the Tempest Crab. Keep clear of its glowing attacks!';
        } else {
          const remaining = state.finale.remaining, stages = state.finale.stages;
          title = stage.objective;
          detail = remaining > 0 ? `Stage ${state.finale.stage}/${stages} · ${remaining} ${stage.unit}${remaining === 1 ? '' : 's'} remaining` : `Stage ${state.finale.stage} cleared! The next stage gathers…`;
        }
      } else if (state.shards >= 3) {
        title = 'Return to the lighthouse'; detail = `Tideglass Haven · ${objectiveDistance} m away`;
      } else {
        const nearby = SHRINES.find((shrine) => distance(player, shrine) <= 28 && state.shrines.find((entry) => entry.id === shrine.id)?.status === 'active');
        if (nearby) {
          activeShrine = state.shrines.find((entry) => entry.id === nearby.id);
          title = 'Defeat the shrine’s defenders';
          detail = 'The shrine captures automatically when its last defender falls.';
        }
      }
      text(refs['quest-region'], reef ? 'Beneath Sunwake Strand' : player.mode === 'aboard' ? 'Aboard the Skywake' : place?.name || region.name);
      text(refs['quest-title'], title); text(refs['quest-detail'], detail); text(refs['pearl-count'], `${state.pearls} shared pearls`);
      refs['shard-slots'].setAttribute('aria-label', `${state.shards} of 3 compass shards`);
      [...refs['shard-slots'].children].forEach((slot, index) => slot.classList.toggle('collected', index < state.shards));
      show(refs['shrine-progress'], !!activeShrine);
      if (activeShrine) {
        text(refs['shrine-label'], 'Defenders remaining');
        text(refs['shrine-remaining'], activeShrine.remaining);
      }
      show(refs['sky-progress'], !!sky);
      if (sky) renderSkyProgress(sky);
      if (sideEvent) {
        const active = sideEvent.status === 'active';
        text(refs['side-event-name'], `${sideEvent.name}${sideEvent.distance > 32 ? ` · ${Math.round(sideEvent.distance)} m` : ''}`);
        let eventDetail = `${sideEvent.description} Earn ${sideEvent.reward} shared pearls.`;
        let eventHint = 'Approach the cyan supplies and press E';
        if (active) {
          eventDetail = `${sideEvent.wave >= SIDE_EVENT_WAVES ? 'Final wave' : `Wave ${sideEvent.wave}/${SIDE_EVENT_WAVES}`} · ${sideEvent.remaining > 0 ? `${sideEvent.remaining} crab${sideEvent.remaining === 1 ? '' : 's'} remaining` : 'Next wave gathering offshore'} · ${formatTime(sideEvent.secondsLeft)} left`;
          eventHint = 'They come from the sea. Keep them off the supplies.';
        } else if (sideEvent.status === 'completed') {
          eventDetail = `Supplies saved! +${sideEvent.reward} shared pearls.`;
          eventHint = 'Your compass quest continues.';
        } else if (sideEvent.status === 'failed') {
          eventDetail = 'Supplies lost. Your compass quest continues.';
          eventHint = '';
        }
        refs['side-event-status'].dataset.status = sideEvent.status;
        text(refs['side-event-detail'], eventDetail); text(refs['side-event-hint'], eventHint);
        show(refs['side-event-hint'], !!eventHint); show(refs['side-event-supplies'], active);
        if (active) {
          text(refs['side-event-percent'], `${sideEvent.integrityPercent}%`);
          refs['side-event-meter'].value = sideEvent.integrityPercent;
          refs['side-event-meter'].setAttribute('aria-label', `${sideEvent.name}: supplies ${sideEvent.integrityPercent}% intact`);
        }
      }
      crewHealth(state, player);
      const mapRealm = reef ? 'reef' : 'island';
      if (lastMapRealm !== mapRealm) {
        lastMapRealm = mapRealm;
        refs['minimap-caption'].replaceChildren(document.createTextNode(reef ? 'Sunken Reach map ' : 'Island map '), Object.assign(document.createElement('kbd'), { textContent: 'M' }));
        refs['minimap-button'].setAttribute('aria-label', `Open ${reef ? 'Sunken Reach' : 'island'} map (M)`);
        text(refs['map-title'], reef ? 'The Sunken Reach' : 'Chart the isles.');
        text(refs['map-kicker'], reef ? 'A wreck below the safe beach' : 'Your shared adventure');
        refs['large-map'].setAttribute('aria-label', reef
          ? 'Sunken Reach chart showing the wreck, treasure chest, return beacon, and nearby crew'
          : 'Island chart showing regions, paths, buildings, places, shrines, lighthouse, lifts, dive entrance, and nearby crew');
      }
      const hp = Math.max(0, Math.ceil(player.hp));
      text(refs['health-number'], hp); refs['health-bar'].value = hp; refs['health-bar'].max = player.maxHp;
      refs['health-bar'].setAttribute('aria-label', `Your health: ${hp} of ${player.maxHp}`);
      refs['health-bar'].parentElement.classList.toggle('low-health', hp < 35);
      const downed = player.knockedUntil > state.elapsed;
      text(refs['health-status'], downed ? 'A friend can help you up' : player.invulnerableUntil > state.elapsed ? 'Safe landing shield' : hp < player.maxHp ? 'Rest a moment to recover' : 'Ready for adventure');
      const cannon = cannonPresentation(state, player), mounted = !!cannon;
      const reload = cannon ? cannon.remaining : Math.max(0, player.reloadUntil - state.elapsed);
      refs['ammo-count'].replaceChildren(document.createTextNode(cannon ? '∞' : reload > 0 ? '…' : String(player.ammo)));
      if (!cannon) { const reserve = document.createElement('span'); reserve.textContent = `/ ${player.maxAmmo}`; refs['ammo-count'].append(reserve); }
      refs['ammo-count'].setAttribute('aria-label', cannon ? 'Unlimited cannon ammunition' : `${player.ammo} of ${player.maxAmmo} rounds`);
      text(refs['reload-label'], cannon ? reload > 0 ? `Reloading · ${reload.toFixed(1)}s` : 'Ready · Unlimited ammo'
        : reload > 0 ? `Reloading · ${reload.toFixed(1)}s` : 'R reload · ∞ reserve');
      for (const [index, weapon] of WEAPON_ORDER.entries()) {
        const slot = refs[`weapon-${weapon}`], owned = player.inventory?.[weapon];
        const rarity = RARITIES[owned?.rarity] || RARITIES.common;
        slot.classList.toggle('selected', !mounted && player.weapon === weapon); slot.classList.toggle('empty', !owned);
        slot.disabled = mounted;
        slot.setAttribute('aria-pressed', String(!mounted && player.weapon === weapon));
        slot.setAttribute('aria-label', `${index + 1}: ${WEAPONS[weapon].name}, ${owned ? rarity.name : 'find in chests'}`);
        slot.style.setProperty('--rarity', owned ? rarity.color : '#8199a3');
        text(slot.querySelector('.weapon-rarity'), owned ? rarity.name : 'Find in chests');
      }
      text(refs['equipped-name'], cannon ? cannon.name : `${RARITIES[player.rarity]?.name || 'Common'} ${WEAPONS[player.weapon]?.name || 'Flintlock'}`);
      refs['equipped-name'].style.color = cannon ? '#ffe4a2' : RARITIES[player.rarity]?.color || RARITIES.common.color;
      const heal = Math.max(0, Math.ceil(player.healUntil - state.elapsed));
      text(refs['heal-label'], heal ? `Heal ready in ${heal}s` : 'Healing pulse'); refs['heal-button'].classList.toggle('ready', !heal && !mounted); refs['heal-button'].disabled = !!heal || downed || mounted;
      show(refs['knocked-banner'], downed);
      if (downed) text(refs['knocked-text'], `A crewmate can help you up. Otherwise, a safe rescue arrives in ${Math.ceil(player.knockedUntil - state.elapsed)}s.`);
      const banner = airshipBanner(state, player);
      // The deck button is the same E interaction, not a synthetic key: it is
      // hidden unless the server would actually accept the press, and the banner
      // itself hides rather than keeping stale text when the deck is not usable.
      show(refs['ship-banner'], !!banner);
      show(refs['deck-action-button'], !!banner?.button);
      if (banner) { text(refs['ship-banner-text'], banner.text); if (banner.button) text(refs['deck-action-button'], `E · ${banner.button}`); }
      const interact = findInteractable(state, player);
      show(refs['interact-hint'], !!interact && !downed && !deckPromptMirrored(banner, interact));
      if (interact) {
        text(refs['interact-hint'].lastElementChild, interact.label); refs['interact-hint'].style.borderColor = interact.color || '#ffd16c';
        refs['interact-hint'].classList.toggle('occupied', !!interact.disabled);
      }
      refs['hit-marker'].classList.toggle('active', now < hitUntil);
      const boss = state.enemies.find((enemy) => enemy.id === state.bossId && enemy.hp > 0);
      show(refs['boss-health'], state.phase === 'finale' && !!boss);
      if (boss) { refs['boss-meter'].value = boss.hp / boss.maxHp; text(refs['boss-percent'], `${Math.ceil(boss.hp / boss.maxHp * 100)}%`); }
      show(refs['target-health'], !!target && target.hp > 0 && !paused && !mapOpen && (['ground', 'swimming'].includes(player.mode) || mounted));
      if (target) { text(refs['target-health'].firstElementChild, target.name || (target.type === 'flying-crab' ? 'Flying crab' : ENEMY_TYPES[target.type]?.name || ENEMY_TYPES.crab.name)); refs['target-health'].lastElementChild.max = target.maxHp; refs['target-health'].lastElementChild.value = target.hp; }
      const bearing = ((-view.yaw * 180 / Math.PI) % 360 + 360) % 360;
      for (const point of compassPoints) {
        const delta = ((point.degrees - bearing + 540) % 360) - 180;
        point.span.style.transform = `translateX(calc(-50% + ${delta * 2.7}px))`;
      }
      show(refs['objective-marker'], !!objective && !downed && !paused && !mapOpen);
      if (objective) {
        const bounds = refs.world.getBoundingClientRect();
        const position = world.project({ x: objective.x, y: objectiveMarkerHeight(objective), z: objective.z });
        let x = position.x; let y = position.y;
        let edge = !position.visible || x < 42 || x > bounds.width - 42 || y < 82 || y > bounds.height - 120;
        if (edge) {
          const angle = Math.atan2(-(objective.x - player.x), -(objective.z - player.z)) - view.yaw;
          const normalized = Math.atan2(Math.sin(angle), Math.cos(angle));
          x = bounds.width / 2 - Math.sin(normalized) * (bounds.width / 2 - 55);
          y = bounds.height / 2 - Math.cos(normalized) * (bounds.height / 2 - 110);
        }
        refs['objective-marker'].classList.toggle('edge', edge);
        text(refs['objective-marker'].lastElementChild, `${objectiveDistance} m`);
        const markerBounds = refs['objective-marker'].getBoundingClientRect();
        const halfWidth = markerBounds.width / 2; const halfHeight = markerBounds.height / 2;
        const horizontalMargin = Math.max(42, halfWidth + 8);
        x = clamp(x, horizontalMargin, bounds.width - horizontalMargin);
        y = clamp(y, Math.max(86, halfHeight + 8), bounds.height - Math.max(125, halfHeight + 8));
        const questBounds = refs['crew-hud'].parentElement.getBoundingClientRect();
        if (!refs['objective-marker'].hidden && questBounds.width > 0 && questBounds.height > 0
          && x + halfWidth > questBounds.left - bounds.left - 8 && x - halfWidth < questBounds.right - bounds.left + 8
          && y + halfHeight > questBounds.top - bounds.top - 8 && y - halfHeight < questBounds.bottom - bounds.top + 8) {
          x = clamp(questBounds.right - bounds.left + halfWidth + 8, horizontalMargin, bounds.width - horizontalMargin);
        }
        refs['objective-marker'].style.left = `${x}px`; refs['objective-marker'].style.top = `${y}px`;
      }
      const activeIds = new Set();
      for (const friend of state.players) {
        if (!friend.online || friend.id === player.id || !sameRealm(friend, player) || distance3(friend, player) > 95) continue;
        activeIds.add(friend.id);
        let plate = plates.get(friend.id);
        if (!plate) { plate = document.createElement('span'); plate.className = 'nameplate'; refs.nameplates.append(plate); plates.set(friend.id, plate); }
        const position = world.projectPlayer?.(friend.id, 3.35) ?? world.project({ x: friend.x, y: friend.y + 3.35, z: friend.z });
        show(plate, position.visible && !paused && !mapOpen); text(plate, friend.name); plate.style.setProperty('--crew-color', friend.color);
        plate.style.left = `${position.x}px`; plate.style.top = `${position.y}px`;
      }
      for (const [id, plate] of plates) if (!activeIds.has(id)) { plate.remove(); plates.delete(id); }
      if (now - mapAt > 130) {
        drawMap(refs.minimap, state, player, false, state.elapsed, discoveries);
        if (mapOpen) drawMap(refs['large-map'], state, player, true, state.elapsed, discoveries);
        mapAt = now;
      }
    },
    dispose() { lootReveal.dispose(); cleanup.forEach((remove) => remove()); plates.forEach((plate) => plate.remove()); },
  };
  return api;
}
