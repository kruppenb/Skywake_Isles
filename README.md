# Skywake Isles

An original, colorful 3D pirate adventure for one to five players on a family LAN. Board a flying galleon, jump and glide onto an island, recover three compass shards with your crew, then restore the lighthouse by defeating the mischievous Tempest Crab. All loot and objectives are shared. There is no PvP, text chat, purchasing, or account setup.

## Run with Docker

From this directory, with Docker Desktop running:

```powershell
docker compose up -d --build
docker compose ps
```

Open **http://localhost:3400** on the host, or **http://192.168.1.27:3400** from another computer on the same network. If the host's LAN address changes, use its new address with port 3400. Each player opens a browser tab, chooses a pirate name and color, and boards the same crew. The first connected pirate is captain and can choose **Set sail**. Solo adventures work too.

```powershell
docker compose logs --tail 100 skywake-isles
docker compose stop
docker compose start
```

The container restarts automatically after Docker restarts. `docker compose down` removes the container but retains aggregate statistics in the named volume. Rebuild after source changes with `docker compose up -d --build`. The health endpoint is `/health`; only port 3400 is published.

If another computer cannot load the game, check that it is on the same LAN, the host URL is correct, and the host firewall permits port 3400 on the home network. The game is intended for a trusted local network.

## Controls

Use a desktop or laptop with a keyboard, mouse, and a browser supporting WebGL2. Chrome and Edge are the primary desktop targets; the renderer also uses standard WebGL2 APIs supported by current Firefox. Small touchscreens are not a supported play mode.

| Control | Action |
| --- | --- |
| WASD or arrow keys | Move |
| Mouse | Look; click the game to capture the pointer |
| Right mouse drag | Look when pointer capture is unavailable |
| Shift | Sprint |
| Space | Jump; leave the flying ship and deploy your glider |
| Left mouse | Fire the equipped blaster |
| F | Cutlass swing |
| E | Open treasure, activate a shrine, restore the lighthouse, or revive a nearby friend |
| Q | Healing pulse for you and nearby crew |
| R | Reload |
| 1 / 2 | Flintlock / scatter blaster |
| G | Mark your position for the crew |
| M | Expand the island map |
| Escape | Pause your controls and open help/settings |

The shared world continues while a player's menu is open. Sound and graphics settings are available in the menu. Low graphics reduces rendering cost; high quality caps device pixel ratio at 1.5. Muting persists in the browser. Movement and combat do not require precise aiming: blasters have a modest amount of aim assistance.

## Your voyage

The ship cruises above the island for 28 seconds. Jump when ready, steer while gliding, and land safely. Pirates still aboard at the end are automatically dropped above Sunwake Strand. Explore Sunwake Strand, Palmheart Wilds, Emberpeak Caldera, Moonbloom Grove, and central Tideglass Haven. The map and colored shrine markers guide the crew.

Branching footpaths lead to eight places with their own daily bustle: Saltwind Harbor's tavern and fishing boats, the striped awnings of Tideglass Market, Windward Farm's turning windmill, the ruins of Old Watch, Palmheart Camp, the caldera forge at Cinderworks, Moonwatch's observatory, and the hull under repair at Driftwood Yard. Friendly fishers, merchants, farmers, a smith, a lookout, a scholar, and shipwrights tend their work sites. These ambient locals add life to the island; the buildings are exterior landmarks.

Visit each place on foot to add it to your voyage journal. Press M for named destinations, building footprints, walking paths, and your personal discovery count. Discoveries begin afresh each voyage. Treasure tucked around the settlements still belongs to the whole crew, and the three shrines remain your shared objective.

Open chests for shared pearls and nearby healing. Visit the three compass shrines in any order, press E to awaken each one, defeat its crab guards, then stand near it for five seconds. A restored shrine grants a shard, heals nearby pirates, and becomes the automatic rescue checkpoint. There are no endless shrine waves.

With all three shards, return to the lighthouse and press E to begin the final encounter. Move away from the Tempest Crab's warning circles and keep firing together. Defeating it produces shared results and individual contributions. The captain can start another voyage from the results screen.

The flintlock holds eight shots and reaches farther; the scatter blaster holds five shots and is strongest nearby. Both have unlimited reserve ammunition and reload automatically when empty. The cutlass is always available. Q restores up to 35 health in a nine-meter radius and has a 20-second cooldown. Health also regenerates after eight seconds without damage.

Falling into the sea returns you safely to the landing beach. A knocked pirate can be revived by a nearby friend with E, or is automatically rescued after eight seconds with brief immunity. The whole crew being knocked down never ends the voyage.

## Connections and saves

Up to five pirates can be connected at once; a sixth receives a clear crew-full message. A disconnected character is reserved for 60 seconds and the browser reconnects automatically using a secret saved for that tab. If the captain disconnects, another online pirate becomes captain. New players may join an active voyage and glide in above the safe beach. Explicitly leaving releases the character immediately. When the last character leaves or its reconnect reservation expires, the abandoned voyage resets to a fresh ship lobby; aggregate statistics are kept. If everyone is temporarily disconnected, voyage progress stays available while any reconnect reservation remains.

Names and colors are saved only in each browser. Aggregate wins, voyages, and best pearl total are written atomically to `/app/data/stats.json` in Docker's `skywake-data` volume. Current voyage progress and reconnect characters live in memory, so a server restart begins a new lobby while keeping aggregate statistics. There is no cloud save or external service.

## Run without Docker and verify

Node.js 22 or later is required. Dependencies are pinned and served locally; there is no bundler, CDN, or browser-time asset download.

```powershell
npm ci
npm start
```

Optional PowerShell overrides for a separate local verification instance:

```powershell
$env:PORT = '3401'
$env:DATA_DIR = '.qa/data'
npm start
```

The island expansion is included in the normal Docker game on port 3400. For an isolated development preview, the local expansion worktree can also run on port 3402 with separate saves:

```powershell
Set-Location C:/repos/skywake-isles/.qa/worktrees/island-expansion
$env:PORT = '3402'
$env:DATA_DIR = '.qa/data-3402'
npm start
```

Open **http://localhost:3402** for that development preview. It has its own crew and voyage; use **http://localhost:3400** for the Docker game.

```powershell
npm run test:unit
npm run test:e2e
npm test
```

The unit suite checks keyboard/mouse input, deterministic movement, snapshot timing and prediction, movement on the ship, remote interpolation, traveling tracers, walkable routes, physical collisions, combat and cooldowns, health and rescues, finite shrine progression, victory/replay, and atomic statistics. The end-to-end suite creates its own temporary save directory and ephemeral loopback port, joins five actual WebSocket clients, walks and fights using normal controls through the entire adventure, checks reconnect/late join/sixth-player rejection, and starts a new server instance to verify persistence. It takes roughly two minutes and cleans up its own sockets, server, and temporary files. See [VERIFICATION.md](VERIFICATION.md) for the browser play-through, hardware measurements, deployment checks, and testing limitations.

This is a designed co-op island adventure, with fixed terrain and procedural original art. It does not include Fortnite building, a competitive battle royale, accounts, public matchmaking, or internet hosting infrastructure. No Rustbeard Island source or assets were used. See [CREDITS.md](CREDITS.md) for dependency attribution.
