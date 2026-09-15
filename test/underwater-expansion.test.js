import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Game } from '../server/game.js';
import { createGameServer } from '../server/index.js';
import { REEF_CACHES, REEF_DISCOVERIES, REEF_ENCOUNTERS, REEF_EVENTS } from '../shared/underwater-content.js';
import { DIVE_ENTRANCE, REEF_CHEST, REEF_SOLIDS, reefLineOfSight, resolveReefCollision, resolveReefSwimmerCollision } from '../shared/underwater.js';
import { BEACON, heightAt } from '../shared/world.js';

const reefPlayer = (game, id = 'a') => {
  const player = game.addPlayer(id, id.toUpperCase(), '#f00');
  game.phase = 'voyage';
  Object.assign(player, { realm: 'reef', mode: 'swimming', grounded: false, x: -18, y: 6, z: 20 });
  return player;
};
const moveTo = (player, point) => Object.assign(player, { x: point.x, y: point.y, z: point.z, realm: 'reef', mode: 'swimming', grounded: false });
const stateFor = (game, key, id) => game.snapshot().underwater[key].find(item => item.id === id);
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail(`Timed out waiting for ${label}`);
};
const socketJoin = (url, name) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url), client = { socket, id: null, state: null, events: [] };
  socket.on('error', reject);
  socket.on('open', () => socket.send(JSON.stringify({ type: 'join', name, color: '#f00' })));
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.type === 'welcome') { client.id = message.id; client.state = message.state; resolve(client); }
    if (message.type === 'snapshot') client.state = message.state;
    if (message.type === 'event') client.events.push(message.event);
  });
});

test('distant exploration is safe, visible in true 3D, and does not gate the original wreck chest', () => {
  const game = new Game({ random: () => .5 }), player = game.addPlayer('a', 'A', '#f00');
  game.phase = 'voyage';
  Object.assign(player, { realm: 'island', mode: 'ground', grounded: true, x: DIVE_ENTRANCE.x, y: heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z), z: DIVE_ENTRANCE.z });
  assert.equal(game.action(player.id, 'interact', DIVE_ENTRANCE.id).ok, true, 'the test enters through the authoritative dive');
  const discovery = REEF_DISCOVERIES.find(item => item.id === 'garden-fan');
  moveTo(player, { ...discovery, y: discovery.y + discovery.range + .1 }); game.tick(.05);
  assert.deepEqual(game.snapshot().underwater.discoveries, [], 'matching x/z at the wrong depth cannot discover a silhouette');
  moveTo(player, discovery); game.tick(.05);
  assert.deepEqual(game.snapshot().underwater.discoveries, [discovery.id]);
  assert.equal(game.pearls, discovery.pearls);
  game.tick(.05);
  assert.equal(game.pearls, discovery.pearls, 'a discovery pays once');
  const garden = REEF_ENCOUNTERS.find(item => item.id === 'garden-sentries');
  moveTo(player, garden.guards[0]); game.tick(.05);
  assert.equal(stateFor(game, 'encounters', garden.id).remaining, 2);
  assert.equal(game.snapshot().underwater.remaining, 3, 'distant guards do not count for the wreck');
  for (const guard of [...game.enemies.values()].filter(enemy => enemy._reefOriginal)) game.damageEnemy(guard, guard.hp, player.id);
  moveTo(player, REEF_CHEST);
  assert.equal(game.action(player.id, 'interact', REEF_CHEST.id).ok, true, 'the old chest remains independent of a distant pocket');
});

test('reef caches grant their shared reward once and guarded caches require their own pocket', () => {
  const game = new Game({ random: () => .5 }), player = reefPlayer(game), safe = REEF_CACHES.find(cache => !cache.encounterId);
  moveTo(player, safe);
  assert.equal(game.action(player.id, 'interact', safe.id).ok, true);
  assert.equal(game.pearls, safe.pearls);
  assert.equal(game.action(player.id, 'interact', safe.id).ok, false);
  assert.equal(game.pearls, safe.pearls);
  const crewmate = game.addPlayer('b', 'B', '#0f0'); moveTo(crewmate, safe);
  assert.equal(game.action(crewmate.id, 'interact', safe.id).ok, false, 'a second diver cannot reopen the shared cache');
  assert.equal(game.snapshot().drops.filter(drop => drop.id.endsWith(safe.id)).length, 1);
  const guarded = REEF_CACHES.find(cache => cache.encounterId);
  moveTo(player, guarded);
  assert.equal(game.action(player.id, 'interact', guarded.id).ok, false, 'the first cache attempt wakes its guards');
  const encounter = stateFor(game, 'encounters', guarded.encounterId);
  assert.ok(encounter.remaining > 0);
  for (const guard of [...game.enemies.values()].filter(enemy => enemy._reefEncounter === guarded.encounterId)) game.damageEnemy(guard, guard.hp, player.id);
  assert.equal(game.action(player.id, 'interact', guarded.id).ok, true);
  assert.equal(stateFor(game, 'caches', guarded.id).opened, true);
});

test('chime, rescue, and defense events have finite shared lifecycle and clean finale reset', () => {
  const game = new Game({ random: () => .5 }), player = reefPlayer(game);
  const completeNodes = definition => {
    const pearls = game.pearls, drops = game.snapshot().drops.length;
    moveTo(player, definition); assert.equal(game.action(player.id, 'interact', definition.id).ok, true);
    for (const node of definition.nodes) {
      moveTo(player, node); assert.equal(game.action(player.id, 'interact', node.id).ok, true);
      assert.equal(game.action(player.id, 'interact', node.id).ok, false, 'a node is accepted once');
    }
    assert.equal(stateFor(game, 'events', definition.id).status, 'completed');
    assert.equal(game.pearls, pearls + definition.pearls); assert.equal(game.snapshot().drops.length, drops + 1);
    moveTo(player, definition); assert.equal(game.action(player.id, 'interact', definition.id).ok, false, 'a completed event cannot restart');
  };
  completeNodes(REEF_EVENTS.find(event => event.kind === 'chimes'));
  completeNodes(REEF_EVENTS.find(event => event.kind === 'rescue'));
  const defense = REEF_EVENTS.find(event => event.kind === 'defense');
  const defensePearls = game.pearls, defenseDrops = game.snapshot().drops.length;
  moveTo(player, defense); assert.equal(game.action(player.id, 'interact', defense.id).ok, true);
  assert.equal(stateFor(game, 'events', defense.id).remaining, 4);
  for (const guard of [...game.enemies.values()].filter(enemy => enemy._reefEvent === defense.id)) game.damageEnemy(guard, guard.hp, player.id);
  assert.equal(stateFor(game, 'events', defense.id).status, 'completed');
  assert.equal(game.pearls, defensePearls + defense.pearls + 20, 'the event reward is added once alongside four guard rewards');
  assert.equal(game.snapshot().drops.length, defenseDrops + 1);
  game.finishReefEvent(defense.id, player.id);
  assert.equal(game.pearls, defensePearls + defense.pearls + 20, 'a completed defense cannot pay again');
  const restartable = REEF_EVENTS.find(event => event.kind === 'chimes');
  // A fresh active event is returned to available when the beacon begins the finale.
  const fresh = new Game(), freshPlayer = reefPlayer(fresh);
  moveTo(freshPlayer, restartable); assert.equal(fresh.action(freshPlayer.id, 'interact', restartable.id).ok, true);
  fresh.shards = 3;
  Object.assign(freshPlayer, { realm: 'island', mode: 'ground', grounded: true, x: BEACON.x, y: heightAt(BEACON.x, BEACON.z), z: BEACON.z });
  assert.equal(fresh.action(freshPlayer.id, 'interact', BEACON.id).ok, true);
  assert.equal(stateFor(fresh, 'events', restartable.id).status, 'available');
});

test('late joins receive only public reef state and landmark arches retain swim-through routes', () => {
  const game = new Game(), player = reefPlayer(game);
  const discovery = REEF_DISCOVERIES[0]; moveTo(player, discovery); game.tick(.05);
  const late = game.addPlayer('b', 'B', '#0f0'), snapshot = game.snapshot();
  assert.ok(late);
  assert.deepEqual(Object.keys(snapshot.underwater).sort(), ['caches', 'chestOpened', 'completed', 'discoveries', 'encounters', 'entered', 'events', 'remaining']);
  assert.equal(Object.keys(snapshot.underwater.encounters[0]).includes('_spawned'), false);
  assert.equal(snapshot.underwater.discoveries.includes(discovery.id), true);
  const leftPillar = REEF_SOLIDS.find(box => box.id === 'bell-arch-left');
  assert.equal(reefLineOfSight({ x: 2, y: 12, z: -110 }, { x: 2, y: 12, z: -80 }), true, 'the central arch remains traversable');
  assert.equal(reefLineOfSight({ x: leftPillar.x - 5, y: 12, z: leftPillar.z }, { x: leftPillar.x + 5, y: 12, z: leftPillar.z }), false);
  const inside = { x: leftPillar.x, y: leftPillar.y, z: leftPillar.z }; resolveReefCollision(inside, .6);
  assert.notDeepEqual(inside, { x: leftPillar.x, y: leftPillar.y, z: leftPillar.z });
});

test('all authored points remain reachable after real swimmer collision, and public reef helpers reject invalid actors', () => {
  const game = new Game(), player = reefPlayer(game), allPoints = [...REEF_DISCOVERIES, ...REEF_CACHES, ...REEF_EVENTS, ...REEF_EVENTS.flatMap(event => event.nodes)];
  for (const point of allPoints) {
    const swimmer = { ...point }; resolveReefSwimmerCollision(swimmer);
    const range = point.range ?? 3.5;
    assert.ok(Math.hypot(swimmer.x - point.x, swimmer.y - point.y, swimmer.z - point.z) <= range, `${point.id} remains within its interaction range`);
    assert.equal(reefLineOfSight(swimmer, point), true, `${point.id} remains visible after collision resolution`);
  }
  const event = REEF_EVENTS.find(item => item.kind === 'chimes'), cache = REEF_CACHES.find(item => !item.encounterId);
  const islandCopy = { ...player, realm: 'island', mode: 'ground', grounded: true, x: event.x, y: event.y, z: event.z };
  assert.equal(game.startReefEvent(islandCopy, event.id), false, 'a matching coordinate in the island realm cannot start a reef event');
  moveTo(player, event); player.knockedUntil = 1;
  assert.equal(game.startReefEvent(player, event.id), false, 'a downed diver cannot start an event');
  moveTo(player, cache); assert.equal(game.openReefCache(player, cache.id), false, 'a downed diver cannot open a cache');
  player.knockedUntil = 0; game.underwater.discoveries.push(REEF_DISCOVERIES[0].id); game.resetRound();
  assert.deepEqual(game.snapshot().underwater.discoveries, []); assert.ok(game.snapshot().underwater.caches.every(cacheState => !cacheState.opened), 'round reset recreates shared reef progress');
});

test('a late socket receives shared exploration, cache, and active event state from authoritative actions', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'skywake-reef-expansion-'));
  let server; const clients = [];
  try {
    server = await createGameServer({ port: 0, host: '127.0.0.1', dataDir });
    const url = `ws://127.0.0.1:${server.port}`, a = await socketJoin(url, 'A'); clients.push(a);
    server.game.phase = 'voyage';
    const player = server.game.players.get(a.id), discovery = REEF_DISCOVERIES[0], cache = REEF_CACHES.find(item => !item.encounterId), event = REEF_EVENTS.find(item => item.kind === 'chimes');
    moveTo(player, discovery); server.game.tick(.05);
    moveTo(player, cache); a.socket.send(JSON.stringify({ type: 'action', action: 'interact', target: cache.id }));
    await waitFor(() => a.events.some(item => item.kind === 'chest' && item.id === cache.id), 'cache action event');
    moveTo(player, event); a.socket.send(JSON.stringify({ type: 'action', action: 'interact', target: event.id }));
    await waitFor(() => a.events.some(item => item.kind === 'reef-event' && item.id === event.id && item.status === 'active'), 'reef event start');
    const b = await socketJoin(url, 'B'); clients.push(b);
    await waitFor(() => b.state?.underwater?.events?.some(item => item.id === event.id && item.status === 'active'), 'late join reef event snapshot');
    assert.equal(b.state.underwater.discoveries.includes(discovery.id), true);
    assert.equal(b.state.underwater.caches.find(item => item.id === cache.id).opened, true);
    const node = event.nodes[0]; moveTo(player, node); a.socket.send(JSON.stringify({ type: 'action', action: 'interact', target: node.id }));
    await waitFor(() => b.events.some(item => item.kind === 'reef-event' && item.nodeId === node.id && item.status === 'progress'), 'shared reef node progress');
  } finally {
    for (const client of clients) client.socket.close();
    if (server) await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
