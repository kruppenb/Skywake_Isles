import { COLORS, REGIONS, SHRINES, CHESTS, BEACON, SPAWN, WORLD_RADIUS, SHIP_DURATION, heightAt, regionAt } from '../shared/world.js';
import { POINTS_OF_INTEREST, BUILDINGS, EXPLORATION_TRAILS, pointOfInterestAt } from '../shared/exploration.js';
import { hasWorldLineOfSight } from '../shared/collision.js';
import { WEAPON_ORDER, WEAPONS, RARITIES } from '../shared/weapons.js';
import { SIDE_EVENTS, SIDE_EVENT_WAVES, SIDE_EVENT_COLOR } from '../shared/side-events.js';
import { ENEMY_TYPES } from '../shared/enemies.js';
import { createLootReveal } from './loot-reveal.js';

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
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

export function findInteractable(state, player) {
  if (!player || player.mode !== 'ground' || player.knockedUntil > state.elapsed || state.phase === 'victory') return null;
  const options = [];
  const reachable = (target) => hasWorldLineOfSight(
    { x: player.x, y: player.y + 1.1, z: player.z },
    { x: target.x, y: (target.y ?? heightAt(target.x, target.z)) + .9, z: target.z }, .08);
  for (const friend of state.players) {
    if (friend.id !== player.id && friend.online && friend.knockedUntil > state.elapsed && distance(player, friend) <= 3.5 && reachable(friend)) {
      options.push({ id: friend.id, kind: 'revive', label: `Help ${friend.name} up`, distance: distance(player, friend) - 10 });
    }
  }
  // Chests open by walking over them, so they never ask for E; only shrines,
  // revives, optional defenses and the lighthouse do.
  for (const shrine of SHRINES) {
    const dynamic = state.shrines.find((entry) => entry.id === shrine.id);
    if (dynamic?.status === 'dormant' && distance(player, shrine) <= 4 && reachable(shrine)) {
      options.push({ ...shrine, kind: 'shrine', label: `Awaken ${shrine.name}`, distance: distance(player, shrine) });
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

export function nearestObjective(state, player) {
  if (!player) return null;
  if (player.mode === 'aboard' || player.mode === 'gliding') return { ...SPAWN, id: 'strand', name: 'Sunwake Strand', kind: 'landing' };
  if (state.phase === 'finale') {
    const boss = state.enemies.find((enemy) => enemy.id === state.bossId);
    return boss ? { ...boss, name: 'Tempest Crab', kind: 'boss' } : { ...BEACON, name: 'Tideglass Lighthouse', kind: 'beacon' };
  }
  if (state.shards >= 3) return { ...BEACON, name: 'Tideglass Lighthouse', kind: 'beacon' };
  const remaining = SHRINES.filter((shrine) => state.shrines.find((entry) => entry.id === shrine.id)?.status !== 'cleared');
  const nearbyActive = remaining.find((shrine) => state.shrines.find((entry) => entry.id === shrine.id)?.status === 'active' && distance(player, shrine) < 30);
  return nearbyActive || remaining.sort((a, b) => distance(player, a) - distance(player, b))[0] || null;
}

function avatar(player) {
  const element = document.createElement('span');
  element.className = 'crew-avatar';
  element.style.setProperty('--crew-color', COLORS.includes(player.color) ? player.color : COLORS[0]);
  element.textContent = (player.name || '?').slice(0, 1).toUpperCase();
  return element;
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
    const mapPoint = (point) => ({ x: ox + size * (.5 + point.x / (extent * 2)), y: oy + size * (.5 + point.z / (extent * 2)) });
    const mapEvents = state.phase === 'voyage' ? sideEventEntries(state).filter((event) => ['available', 'active'].includes(event.status)) : [];
    const occupied = [];
    if (large) {
      for (const point of [...SHRINES, BEACON, ...POINTS_OF_INTEREST, ...mapEvents]) {
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
    const destinations = [...mapEvents, ...POINTS_OF_INTEREST.filter((place) => !mapEvents.some((event) => event.placeId === place.id))];
    for (const place of destinations) {
      const position = mapPoint(place); const isEvent = !!place.placeId; const discovered = discoveries.has(isEvent ? place.placeId : place.id);
      if (isEvent) shield(ctx, position.x, position.y, large ? 8 : 4.5, place.status === 'active');
      else {
        ctx.beginPath(); ctx.arc(position.x, position.y, large ? 4 : 2, 0, Math.PI * 2);
        ctx.fillStyle = discovered ? '#286e67' : '#e9efda'; ctx.fill();
        ctx.strokeStyle = '#286e67'; ctx.lineWidth = large ? 1.5 : .8; ctx.stroke();
      }
      if (!large) continue;
      ctx.font = 'bold 10px "Trebuchet MS",sans-serif';
      const statusLine = isEvent ? `${place.status === 'active' ? `Wave ${place.wave}/${SIDE_EVENT_WAVES}` : 'Optional defense'} · ${place.reward} pearls` : '';
      const labelWidth = Math.max(ctx.measureText(place.name).width, ctx.measureText(statusLine).width) + 10; const labelHeight = isEvent ? 31 : 18;
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
      ctx.fillStyle = isEvent ? '#123c51f2' : discovered ? '#e9f5dfed' : '#eef1e3dd'; ctx.fillRect(label.x, label.y, label.width, label.height);
      ctx.textAlign = 'left'; ctx.fillStyle = isEvent ? SIDE_EVENT_COLOR : discovered ? '#19594f' : '#3b6269';
      ctx.fillText(place.name, label.x + 5, label.y + 12);
      if (isEvent) { ctx.fillStyle = '#fff6dd'; ctx.font = '10px "Trebuchet MS",sans-serif'; ctx.fillText(statusLine, label.x + 5, label.y + 25); }
    }
    for (const ping of state.pings) {
      if (ping.expiresAt < elapsed) continue;
      const position = mapPoint(ping);
      const owner = state.players.find((entry) => entry.id === ping.playerId);
      ctx.beginPath(); ctx.arc(position.x, position.y, (large ? 12 : 6) + Math.sin(elapsed * 5) * 2, 0, Math.PI * 2); ctx.strokeStyle = owner?.color || '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    for (const friend of state.players) {
      if (!friend.online) continue;
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
        && player.mode === 'ground' && player.hp > 0 && player.online !== false
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
  button('drop-button', () => callbacks.onDrop?.());
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
    const signature = friends.map((player) => `${player.id}:${player.name}:${player.color}:${Math.ceil(player.hp)}:${player.online}:${player.knockedUntil > state.elapsed}`).join('|');
    if (signature === lastCrewHealth) return;
    lastCrewHealth = signature;
    refs['crew-hud'].replaceChildren();
    for (const player of friends) {
      const li = document.createElement('li'); li.className = player.online ? '' : 'offline';
      const name = document.createElement('span'); name.className = 'crew-name'; name.textContent = `${player.name}${player.knockedUntil > state.elapsed ? ' · needs help' : !player.online ? ' · rejoining' : ''}`;
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
      joined = false; paused = false; mapOpen = false; lastPhase = ''; lastRoster = ''; lastCrewHealth = ''; lastVictory = '';
      discoveryRound = null; clearDiscoveries();
      show(refs['pause-overlay'], false); show(refs['map-overlay'], false); show(refs['victory-overlay'], false); show(refs['join-error'], false);
      api.announce(null);
      document.body.classList.remove('paused', 'map-open'); plates.forEach((plate) => plate.remove()); plates.clear(); modalChanged();
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
      refs.reticle.classList.toggle('scatter', player?.weapon === 'scatter');
      refs.reticle.classList.toggle('reloading', presentation.reloading);
      show(refs['look-hint'], presentation.active && (!view.locked || player?.weapon === 'longshot'));
      text(refs['look-hint'], presentation.scoped ? 'Release right mouse to leave scope · R reload · Esc menu'
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
        text(refs['lobby-hint'], host ? 'Sail solo or wait for friends. You’re the captain.' : 'Your captain will set sail when the crew is aboard.');
      }
      if (won) { victory(state, player); return; }
      if (!playing) return;
      const region = regionAt(player.x, player.z);
      const place = player.mode === 'ground' ? pointOfInterestAt(player.x, player.z) : null;
      if (place && player.grounded && player.knockedUntil <= state.elapsed && !paused && !mapOpen && !discoveries.has(place.id)) {
        discoveries.add(place.id); updateDiscoveries(); mapAt = 0;
        text(refs['discovery-name'], place.name); text(refs['discovery-description'], place.description);
        discoveryUntil = now + 6500; show(refs['discovery-notice'], true);
      }
      const objective = nearestObjective(state, player);
      const objectiveDistance = objective ? Math.round(distance(player, objective)) : 0;
      let title = 'Find the three compass shards';
      let detail = objective ? `${objective.name} · ${objectiveDistance} m away` : 'Explore the island with your crew.';
      let activeShrine = null;
      if (player.mode === 'aboard') {
        title = 'Jump from the ship'; detail = 'Press Space. Your glider opens automatically.';
      } else if (player.mode === 'gliding') {
        title = 'Glide onto the island'; detail = 'Steer with WASD. Sunwake Strand is a friendly landing spot.';
      } else if (state.phase === 'finale') {
        title = 'Free the compass'; detail = 'Defeat the Tempest Crab. Keep clear of its glowing attacks!';
      } else if (state.shards >= 3) {
        title = 'Return to the lighthouse'; detail = `Tideglass Haven · ${objectiveDistance} m away`;
      } else {
        const nearby = SHRINES.find((shrine) => distance(player, shrine) <= 28 && state.shrines.find((entry) => entry.id === shrine.id)?.status === 'active');
        if (nearby) {
          activeShrine = state.shrines.find((entry) => entry.id === nearby.id);
          title = activeShrine.remaining > 0 ? 'Clear the shrine’s crabs' : 'Stand in the shrine’s glow';
          detail = activeShrine.remaining > 0 ? `${activeShrine.remaining} crab${activeShrine.remaining === 1 ? '' : 's'} left. Your crew can help!` : 'Stay close together to restore this compass shard.';
        }
      }
      text(refs['quest-region'], player.mode === 'aboard' ? 'Aboard the Skywake' : place?.name || region.name);
      text(refs['quest-title'], title); text(refs['quest-detail'], detail); text(refs['pearl-count'], `${state.pearls} shared pearls`);
      refs['shard-slots'].setAttribute('aria-label', `${state.shards} of 3 compass shards`);
      [...refs['shard-slots'].children].forEach((slot, index) => slot.classList.toggle('collected', index < state.shards));
      show(refs['shrine-progress'], !!activeShrine);
      if (activeShrine) {
        text(refs['shrine-label'], activeShrine.remaining > 0 ? 'Guardians remaining' : 'Restoring the compass…');
        text(refs['shrine-percent'], activeShrine.remaining > 0 ? activeShrine.remaining : `${Math.round(activeShrine.charge * 100)}%`);
        refs['shrine-meter'].value = activeShrine.charge;
      }
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
      const hp = Math.max(0, Math.ceil(player.hp));
      text(refs['health-number'], hp); refs['health-bar'].value = hp; refs['health-bar'].max = player.maxHp;
      refs['health-bar'].setAttribute('aria-label', `Your health: ${hp} of ${player.maxHp}`);
      refs['health-bar'].parentElement.classList.toggle('low-health', hp < 35);
      const downed = player.knockedUntil > state.elapsed;
      text(refs['health-status'], downed ? 'A friend can help you up' : player.invulnerableUntil > state.elapsed ? 'Safe landing shield' : hp < player.maxHp ? 'Rest a moment to recover' : 'Ready for adventure');
      const reload = Math.max(0, player.reloadUntil - state.elapsed);
      refs['ammo-count'].replaceChildren(document.createTextNode(reload > 0 ? '…' : String(player.ammo)));
      const reserve = document.createElement('span'); reserve.textContent = `/ ${player.maxAmmo}`; refs['ammo-count'].append(reserve);
      text(refs['reload-label'], reload > 0 ? `Reloading · ${reload.toFixed(1)}s` : 'R reload · ∞ reserve');
      for (const [index, weapon] of WEAPON_ORDER.entries()) {
        const slot = refs[`weapon-${weapon}`], owned = player.inventory?.[weapon];
        const rarity = RARITIES[owned?.rarity] || RARITIES.common;
        slot.classList.toggle('selected', player.weapon === weapon); slot.classList.toggle('empty', !owned);
        slot.setAttribute('aria-pressed', String(player.weapon === weapon));
        slot.setAttribute('aria-label', `${index + 1}: ${WEAPONS[weapon].name}, ${owned ? rarity.name : 'find in chests'}`);
        slot.style.setProperty('--rarity', owned ? rarity.color : '#8199a3');
        text(slot.querySelector('.weapon-rarity'), owned ? rarity.name : 'Find in chests');
      }
      text(refs['equipped-name'], `${RARITIES[player.rarity]?.name || 'Common'} ${WEAPONS[player.weapon]?.name || 'Flintlock'}`);
      refs['equipped-name'].style.color = RARITIES[player.rarity]?.color || RARITIES.common.color;
      const heal = Math.max(0, Math.ceil(player.healUntil - state.elapsed));
      text(refs['heal-label'], heal ? `Heal ready in ${heal}s` : 'Healing pulse'); refs['heal-button'].classList.toggle('ready', !heal); refs['heal-button'].disabled = !!heal || downed;
      show(refs['knocked-banner'], downed);
      if (downed) text(refs['knocked-text'], `A crewmate can help you up. Otherwise, a safe rescue arrives in ${Math.ceil(player.knockedUntil - state.elapsed)}s.`);
      show(refs['ship-banner'], player.mode === 'aboard');
      if (player.mode === 'aboard') text(refs['ship-banner-text'], `${Math.max(0, Math.ceil(SHIP_DURATION - state.elapsed))}s until the crew drops. Ready when you are!`);
      const interact = findInteractable(state, player);
      show(refs['interact-hint'], !!interact && !downed);
      if (interact) { text(refs['interact-hint'].lastElementChild, interact.label); refs['interact-hint'].style.borderColor = interact.color || '#ffd16c'; }
      refs['hit-marker'].classList.toggle('active', now < hitUntil);
      const boss = state.enemies.find((enemy) => enemy.id === state.bossId && enemy.hp > 0);
      show(refs['boss-health'], state.phase === 'finale' && !!boss);
      if (boss) { refs['boss-meter'].value = boss.hp / boss.maxHp; text(refs['boss-percent'], `${Math.ceil(boss.hp / boss.maxHp * 100)}%`); }
      show(refs['target-health'], !!target && target.hp > 0 && !paused && !mapOpen && player.mode === 'ground');
      if (target) { text(refs['target-health'].firstElementChild, ENEMY_TYPES[target.type]?.name || ENEMY_TYPES.crab.name); refs['target-health'].lastElementChild.max = target.maxHp; refs['target-health'].lastElementChild.value = target.hp; }
      const bearing = ((-view.yaw * 180 / Math.PI) % 360 + 360) % 360;
      for (const point of compassPoints) {
        const delta = ((point.degrees - bearing + 540) % 360) - 180;
        point.span.style.transform = `translateX(calc(-50% + ${delta * 2.7}px))`;
      }
      show(refs['objective-marker'], !!objective && !downed && !paused && !mapOpen);
      if (objective) {
        const bounds = refs.world.getBoundingClientRect();
        const position = world.project({ x: objective.x, y: heightAt(objective.x, objective.z) + (objective.kind === 'boss' ? 4 : 9), z: objective.z });
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
        if (!friend.online || friend.id === player.id || distance(friend, player) > 95) continue;
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
