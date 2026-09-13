// Isolated browser-QA server for the first Sunken Reach milestone.
//
// It serves the real game and places voyage players beside the real shore dive
// entrance. The browser must still press E, swim, fight, collect, and return
// through production gameplay paths. It never changes the underwater state.
//
// Usage:
//   node tools/qa/underwater/fixture-server.mjs [--port 3401]
//     [--host 127.0.0.1] [--data-dir <dir>] [--companion]
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const PORT = Number(opt('--port', 3401));
const HOST = opt('--host', '127.0.0.1');
const DATA_DIR = path.resolve(opt('--data-dir', path.join(os.tmpdir(), 'skywake-underwater-qa', String(PORT))));
const COMPANION = args.includes('--companion');

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535 || PORT === 3400) {
  console.error('error: choose a valid fixture port other than production port 3400');
  process.exit(1);
}

const { DIVE_ENTRANCE } = await import(pathToFileURL(path.join(ROOT, 'shared', 'underwater.js')).href);
const { heightAt } = await import(pathToFileURL(path.join(ROOT, 'shared', 'world.js')).href);
const { createGameServer } = await import(pathToFileURL(path.join(ROOT, 'server', 'index.js')).href);
mkdirSync(DATA_DIR, { recursive: true });
const instance = await createGameServer({ port: PORT, host: HOST, dataDir: DATA_DIR });
const { game } = instance;

function seedAtDive(player) {
  if (!player || game.phase !== 'voyage') return player;
  game.releaseGun(player);
  Object.assign(player, {
    realm: 'island', mode: 'ground', x: DIVE_ENTRANCE.x,
    y: heightAt(DIVE_ENTRANCE.x, DIVE_ENTRANCE.z), z: DIVE_ENTRANCE.z,
    grounded: true, vy: 0, launchVx: 0, launchVz: 0, gunId: null,
    shipReturned: false, jumpHeld: false, yaw: Math.PI, pitch: -.12,
  });
  player._input = { forward: 0, right: 0, sprint: false, jump: false, dive: false, yaw: player.yaw, pitch: player.pitch };
  player._inputAt = game.clock;
  return player;
}

const resetPlayer = game.resetPlayer.bind(game);
game.resetPlayer = player => { const result = resetPlayer(player); seedAtDive(player); return result; };
const addPlayer = game.addPlayer.bind(game);
game.addPlayer = (...values) => seedAtDive(addPlayer(...values));
// Browser automation closes contexts between runs. Release those fixture-only
// sessions immediately so the next run receives captaincy without a 60-second
// reconnect reservation from the previous capture.
const disconnect = game.disconnect.bind(game);
game.disconnect = id => disconnect(id, true);

// A companion is useful for verifying split-realm roster and map behavior. It
// is offline, so it consumes no live crew slot and never changes encounter size.
if (COMPANION) {
  const launch = game.action.bind(game);
  game.action = (id, action, target) => {
    const result = launch(id, action, target);
    if (action === 'launch' && result.ok && !game.players.has('qa-companion')) {
      const companion = game.addPlayer('qa-companion', 'Shore Scout', '#ff8a5b');
      if (companion) { Object.assign(companion, { online: false, _expiresAt: Infinity }); seedAtDive(companion); }
    }
    return result;
  };
}

console.log(`fixture: Sunken Reach browser QA on http://${HOST}:${instance.port} (data ${DATA_DIR})`);
console.log(`fixture: voyage players start at ${DIVE_ENTRANCE.id}; E still performs the real dive${COMPANION ? '; offline shore companion enabled' : ''}`);

const shutdown = async () => { await instance.close(); process.exit(0); };
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
