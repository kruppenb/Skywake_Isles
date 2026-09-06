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

**Mac connection note (confirmed September 6, 2026):** Edge on the family Mac over Wi-Fi could not resolve `http://nickdesktop:3400`, although that hostname worked on a Windows laptop. Opening **http://192.168.1.27:3400** worked on the Mac. If the hostname fails, use the host's LAN IP address with the explicit `http://` prefix and port `3400`. The IP address may change if the router assigns a new one.

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
| 1 / 2 / 3 / 4 / 5 | Flintlock / scatter blaster / tide repeater / burst carbine / longshot |
| G | Mark your position for the crew |
| M | Expand the island map |
| Escape | Pause your controls and open help/settings |

The shared world continues while a player's menu is open. Sound and graphics settings are available in the menu. Low graphics reduces rendering cost; high quality caps device pixel ratio at 1.5. Muting persists in the browser. Movement and combat do not require precise aiming: blasters have a modest amount of aim assistance.

## Your voyage

The ship cruises above the island for 28 seconds. Jump when ready, steer while gliding, and land safely. Pirates still aboard at the end are automatically dropped above Sunwake Strand. Explore Sunwake Strand, Palmheart Wilds, Emberpeak Caldera, Moonbloom Grove, and central Tideglass Haven. The map and colored shrine markers guide the crew.

Branching footpaths lead to eight places with their own daily bustle: Saltwind Harbor's tavern and fishing boats, the striped awnings of Tideglass Market, Windward Farm's turning windmill, the ruins of Old Watch, Palmheart Camp, the caldera forge at Cinderworks, Moonwatch's observatory, and the hull under repair at Driftwood Yard. Friendly fishers, merchants, farmers, a smith, a lookout, a scholar, and shipwrights tend their work sites. Walk through the open doorways of nine furnished buildings to explore taverns, cottages, warehouses, a barn, forge, and barracks. Each contains a chest. Roofs cut away while you are inside, and pale gaps on map footprints mark entrances. Solid walls block movement, shots and interactions; open doors let you fight between indoors and outdoors.

Visit each place on foot to add it to your voyage journal. Press M for named destinations, building footprints, walking paths, and your personal discovery count. Discoveries begin afresh each voyage. Treasure tucked around the settlements still belongs to the whole crew, and the three shrines remain your shared objective.

Northwest of Windward Farm, Old Watch establishes the weathered environment style: mossy masonry, aged timber, pines, and worn stone paths surround its tower and furnished barracks. That material quality continues down the walking trail to Windward Farm's worn plaster windmill, turning timber sails, russet barn roof, crop rows and field edges. The barn retains its furnished interior, chest, paired entrances and roof cutaway.

Walk over a chest to open it, with no key press, for 12 shared pearls, nearby healing, and one random gun. Its floating model and glow show where it landed; walk over it to automatically collect and equip it. Guns stay on the ground so every crewmate can collect the same gun. Guns roll Common, Uncommon, Rare, Epic, or Legendary rarity, shown by both name and color. Better rarities increase damage. Your five slots hold one of each gun; new guns and higher rarity upgrades equip automatically. An equal or lower duplicate leaves your equipment unchanged, but walking over it still salvages it: the gun disappears for you, the crew earns 5 shared pearls, and the copy stays for crewmates who can use it. Everyone shares pearls.

Inland patrols guard paths and all eight destinations. Each destination has two melee crabs and one ranged spitter for a solo voyage, plus one melee crab for each additional pirate online at launch: 24, 32, 40, 48, or 56 enemies for crews of one through five. Groups patrol locally, return to their posts, and stay away from the safe landing beach. Defeated patrols never respawn, including when someone joins later. Visit the three compass shrines in any order, press E to awaken each one, defeat its guards, then stand near it for five seconds. Each shrine starts with 3, 5, 7, 9, or 11 guards based on the pirates online when it is awakened; later crew changes affect only future shrine starts. A restored shrine grants a shard, heals nearby pirates, and becomes the automatic rescue checkpoint. There are no endless shrine waves.

Tideglass Market, Windward Farm and Driftwood Yard each keep cyan supplies that offer an optional defense once per voyage. Press E beside them and three waves of crabs surge in from the seaward side, forming ranks on the sand (or in the surf at Driftwood Yard) and marching on the supplies, walking around buildings where they must. A banner across the top of the screen announces every wave. The second wave adds splash crabs, and the final wave brings Tidebreaker mini bosses, one for every two pirates in the crew that started the defense. Rosters grow with that crew. Keep the supplies above zero for all three waves within three minutes to earn 45 shared pearls and a heal; losing them never affects the compass quest.

With all three shards, return to the lighthouse and press E to begin the final encounter. Move away from the Tempest Crab's warning circles and keep firing together. Defeating it produces shared results and individual contributions. The captain can start another voyage from the results screen.

Start with a Common Flintlock and Scatter Blaster, then find the other three guns in chests. All guns have unlimited reserve ammunition and reload automatically when empty. Switching guns preserves each magazine and the firing cooldown.

| Gun | Magazine | Role |
| --- | --- | --- |
| Flintlock | 8 | Balanced single shots with 50 m reach |
| Scatter Blaster | 5 | Wide pellet spread for close fights, up to 18 m |
| Tide Repeater | 24 | Rapid automatic fire, up to 35 m |
| Burst Carbine | 18 | Three timed shots per burst, up to 48 m |
| Longshot | 4 | Slow, powerful scoped shots, up to 80 m |

The cutlass is always available. Q restores up to 35 health in a nine-meter radius and has a 20-second cooldown. Health also regenerates after eight seconds without damage.

Falling into the sea returns you safely to the landing beach. A knocked pirate can be revived by a nearby friend with E, or is automatically rescued after eight seconds with brief immunity. The whole crew being knocked down never ends the voyage.

## Connections and saves

Up to five pirates can be connected at once; a sixth receives a clear crew-full message. A disconnected character is reserved for 60 seconds and the browser reconnects automatically using a secret saved for that tab. If the captain disconnects, another online pirate becomes captain. New players may join an active voyage and glide in above the safe beach. Explicitly leaving releases the character immediately. When the last character leaves or its reconnect reservation expires, the abandoned voyage resets to a fresh ship lobby; aggregate statistics are kept. If everyone is temporarily disconnected, voyage progress stays available while any reconnect reservation remains.

Names and colors are saved only in each browser. Aggregate wins, voyages, and best pearl total are written atomically to `/app/data/stats.json` in Docker's `skywake-data` volume. Current voyage progress and reconnect characters live in memory, so a server restart begins a new lobby while keeping aggregate statistics. There is no cloud save or external service.

## Run without Docker and verify

Node.js 22 or later is required. Dependencies are pinned and served locally; there is no bundler, CDN, or external runtime download. The browser loads the shared Old Watch library and Windward Farm's smaller geometry kit from the local game server, with visible procedural scenery while assets load. See [ENVIRONMENT_PIPELINE.md](docs/ENVIRONMENT_PIPELINE.md) for asset regeneration, shared ownership, validation and the remaining regional rollout.

Environment progress and the next area are tracked in [ENVIRONMENT_ROLLOUT.md](docs/ENVIRONMENT_ROLLOUT.md). With this repository open, say **"upgrade next zone"** to resume one milestone in a fresh window; the tracked handoff supplies the context.

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

This is a designed co-op island adventure, with fixed terrain, procedural scenery, and authored original assets. It does not include Fortnite building, a competitive battle royale, accounts, public matchmaking, or internet hosting infrastructure. No Rustbeard Island source or assets were used. See [CREDITS.md](CREDITS.md) for dependency attribution.
