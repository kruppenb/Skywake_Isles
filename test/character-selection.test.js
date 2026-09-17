import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { CHARACTER_VARIANTS, normalizeCharacter } from '../shared/characters.js';
import { Game } from '../server/game.js';
import { createGameServer } from '../server/index.js';

test('character contract accepts only the female variant', () => {
  assert.deepEqual(CHARACTER_VARIANTS, ['male', 'female']);
  assert.equal(normalizeCharacter('female'), 'female');
  for (const value of ['male', 'Female', '', null, 1, { character: 'female' }]) assert.equal(normalizeCharacter(value), 'male');
});

test('game stores an authorized character in public snapshots and preserves it through reset/reconnect', () => {
  const game = new Game();
  const female = game.addPlayer('female-id', 'Pearl', '#f00', 'female');
  const malformed = game.addPlayer('malformed-id', 'Drift', '#0f0', '../female');
  assert.equal(female.character, 'female');
  assert.equal(malformed.character, 'male');
  assert.equal(game.snapshot().players.find(player => player.id === female.id).character, 'female');

  game.disconnect(female.id);
  assert.equal(game.reconnect(female.id).character, 'female');
  game.resetRound();
  assert.equal(game.players.get(female.id).character, 'female');
});

test('websocket join authorizes character, broadcasts it, and rejects reconnect tampering', { timeout: 15_000 }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'skywake-character-'));
  const sockets = [];
  let server;
  const connect = (message) => new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`); sockets.push(socket);
    const messages = [];
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('Timed out waiting for welcome')); socket.close(); }, 4000);
    socket.on('error', error => { if (settled) return; settled = true; clearTimeout(timer); reject(error); });
    socket.on('message', raw => {
      const value = JSON.parse(raw.toString()); messages.push(value);
      if (value.type === 'welcome' && !settled) { settled = true; clearTimeout(timer); resolve({ socket, messages, id: value.id, token: value.token, state: value.state }); }
    });
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join', ...message })));
  });
  try {
    server = await createGameServer({ port: 0, host: '127.0.0.1', dataDir });
    const female = await connect({ name: 'Pearl', color: '#f00', character: 'female' });
    const defaulted = await connect({ name: 'Deckhand', color: '#0f0' });
    const invalid = await connect({ name: 'Odd', color: '#65d7c5', character: '../female' });
    assert.equal(female.messages.find(message => message.type === 'welcome').state.players.find(player => player.id === female.id).character, 'female');
    assert.equal(defaulted.messages.find(message => message.type === 'welcome').state.players.find(player => player.id === defaulted.id).character, 'male');
    assert.equal(invalid.messages.find(message => message.type === 'welcome').state.players.find(player => player.id === invalid.id).character, 'male');
    const publicPlayers = () => server.game.snapshot().players;
    assert.equal(publicPlayers().find(player => player.id === female.id).character, 'female');
    assert.equal(publicPlayers().find(player => player.id === defaulted.id).character, 'male');
    assert.equal(publicPlayers().find(player => player.id === invalid.id).character, 'male');

    female.socket.close();
    await new Promise(resolve => female.socket.once('close', resolve));
    const reconnected = await connect({ name: 'Tampered', color: '#0f0', character: 'male', token: female.token });
    assert.equal(reconnected.id, female.id);
    assert.equal(reconnected.messages.find(message => message.type === 'welcome').state.players.find(player => player.id === female.id).character, 'female');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(defaulted.messages.at(-1)?.state?.players.find(player => player.id === female.id)?.character, 'female');
    assert.equal(server.game.players.get(female.id).character, 'female');
    server.game.resetRound();
    assert.equal(server.game.snapshot().players.find(player => player.id === female.id).character, 'female');
  } finally {
    for (const socket of sockets) if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    if (server) await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
