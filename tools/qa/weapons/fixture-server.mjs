// Skywake Isles — isolated QA server that seeds one gun into every player's inventory.
//
// The starting inventory is flintlock + scatter and chests roll random drops, so an in-game check
// of any other kind (game-check.mjs pressing its digit key) needs the player to own it. This
// wraps the real createGameServer -- no gameplay code changes -- and seeds `inventory.<kind>` in
// BOTH game.addPlayer and game.resetPlayer: the voyage start calls resetPlayer on everyone and
// reassigns the stock two-gun inventory, so a join-only seed is gone by landing and the digit is
// refused NOT_OWNED with no toast (the repeater's first QA run failed exactly so).
//
// Usage:
//   node tools/qa/weapons/fixture-server.mjs --kind <repeater|burst|longshot|...>
//       [--port 3401] [--host 127.0.0.1] [--data-dir <dir>] [--self-check]
//
// Never point this at production port 3400. --data-dir defaults to a scratch directory under the
// OS temp dir so the checkout's data/ is never touched; --self-check adds a player, resets them,
// prints both inventories and exits non-zero if the seed did not survive. The game lobby is
// consumed per game-check run, so restart this between runs. Stop it with Ctrl+C / Stop-Process.
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const KIND = opt('--kind', null);
const PORT = Number(opt('--port', 3401));
const HOST = opt('--host', '127.0.0.1');
const DATA_DIR = path.resolve(opt('--data-dir', path.join(os.tmpdir(), 'skywake-qa-fixture', String(PORT))));
const SELF_CHECK = args.includes('--self-check');

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error('usage: node tools/qa/weapons/fixture-server.mjs --kind <kind> [--port 3401] [--host 127.0.0.1] [--data-dir <dir>] [--self-check]');
  process.exit(1);
}
if (!KIND) usage('--kind is required');
if (PORT === 3400) usage('port 3400 is production; use 3401 or another free port');

const { WEAPONS, WEAPON_ORDER } = await import(pathToFileURL(path.join(ROOT, 'shared', 'weapons.js')).href);
const weapon = WEAPONS[KIND];
if (!weapon) usage(`unknown --kind ${KIND} (known: ${WEAPON_ORDER.join(', ')})`);
const { createGameServer } = await import(pathToFileURL(path.join(ROOT, 'server', 'index.js')).href);

mkdirSync(DATA_DIR, { recursive: true });
const instance = await createGameServer({ port: PORT, host: HOST, dataDir: DATA_DIR });
const { game } = instance;

const seed = player => {
  if (player && player.inventory && !player.inventory[KIND]) player.inventory[KIND] = { rarity: 'common', ammo: weapon.ammo };
  return player;
};
const resetPlayer = game.resetPlayer.bind(game);
game.resetPlayer = player => { const result = resetPlayer(player); seed(player); return result; };
const addPlayer = game.addPlayer.bind(game);
game.addPlayer = (...rest) => seed(addPlayer(...rest));

console.log(`fixture: Skywake Isles on http://${HOST}:${instance.port} (data ${DATA_DIR}), seeding inventory.${KIND} ammo ${weapon.ammo}`);

if (SELF_CHECK) {
  const player = game.addPlayer('qa-self-check', 'Watcher', '#e0c060');
  const afterJoin = player.inventory[KIND];
  game.resetPlayer(player);
  const afterReset = player.inventory[KIND];
  const ok = !!(afterJoin && afterReset && afterJoin.ammo === weapon.ammo && afterReset.ammo === weapon.ammo);
  console.log(`self-check: after join ${JSON.stringify(afterJoin)}, after reset ${JSON.stringify(afterReset)}, kinds ${Object.keys(player.inventory).join(',')} -> ${ok ? 'OK' : 'FAILED'}`);
  await instance.close();
  process.exit(ok ? 0 : 1);
}

const shutdown = async () => { await instance.close(); process.exit(0); };
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
