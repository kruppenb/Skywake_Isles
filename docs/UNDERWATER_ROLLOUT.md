# Underwater rollout

This handoff tracks the underwater environment separately from the island environment rollout. The current explicit expansion is the full six-region scope below; do not begin a further underwater zone automatically after it is accepted.

## Current scope: Sunken Reach exploration expansion

Status: the wreck milestone is retained as the entry experience, but the explicit exploration expansion supersedes its former one-milestone limit. The shared realm now spans `x/z -138..138` and has six named areas: Sunken Reach, Coral Gardens, Kelp Hollows, Bell Sanctuary, Ember Vents, and Crown Graveyard.

Sunken Reach is a bounded realm below the safe landing beach. Its shore entrance is at `(14, 106)` and its reef spawn and always-available return beacon are at `(-18, 6, 20)`. Players enter only during the voyage while healthy, grounded, within four metres, and on a clear route. Starting the lighthouse finale returns all reef players to shore and prevents another dive that voyage.

Core realm and controls:

- A separate reef realm with 3D swimming, bounded movement, wreck collision, realm-specific line of sight, and no island height or collision queries below.
- W/S swimming along the full look direction, including pitch, A/D level strafing, Space to rise, C to dive, Shift for faster swimming, and neutral hover when movement is released. Combined inputs stay within the swim speed cap.
- Three finite reef guards, ordinary underwater gun/cutlass/heal combat, same-realm 3D revives, and realm-isolated enemy behavior and damage.
- A wreck chest that becomes collectible after all guards fall, opens once per voyage, and grants shared pearls plus the ordinary shared weapon drop.
- An exit available at every stage of the expedition. The finale returns the reef crew to shore before its island encounter begins.
- Client prediction and remote interpolation reset at realm travel boundaries. Old land or swim inputs cannot replay after a transition.
- Underwater weapon HUD and targeting, reef-only nameplates and map markers, and a crew health list that identifies friends in the other realm.
- Updated in-game controls and README instructions.

### Exploration expansion delivered

- The full `M` chart shows all six named regions, their boundary colours, landmark solids, discoveries, unopened caches, event states, local-realm crew, local pings, and the always-available cyan return beacon. It describes the beacon and gives its distance from the current position.
- HUD guidance names the current region, 3D objective distance, discovery/cache counts, and active event progress; the map gives actual water depth from the realm ceiling. Nearby discoveries, treasure, or active event nodes are favored before old wreck combat. Clearing the original wreck chest redirects the player to remaining regions.
- Twelve passive discoveries award pearls. Nine caches collect when reached; some are guarded by their named encounter.
- Bell Sanctuary starts with `E` and accepts its three chimes in any order. Kelp Hollows starts with `E` and frees three ray cages. Crown Graveyard starts with `E` and calls four guards. Event state comes from the authoritative snapshot; the client only renders nearby, line-of-sight `E` prompts.
- Regional fog and lighting shift smoothly between turquoise wreck water, rose Coral Gardens, filtered green kelp, cool Bell Sanctuary, amber vents, and violet graveyard water. Landmark geometry follows the shared content coordinates.

## Known limitations and deferred work

These are future milestones beyond the current expansion:

- Additional underwater zones beyond the six current areas.
- Air or oxygen systems, currents, mounts, underwater gathering, new weapon families, or a separate underwater inventory.
- A larger underwater quest line, procedural caves, or persistence beyond the current voyage.
- Additional reef enemy families, bosses, settlements, or entrances elsewhere on the island.

## Fresh-window verification

Run unit checks first:

```powershell
npm.cmd test
git diff --check
```

For an isolated browser pass, start the reproducible fixture on a non-production port. It uses a temporary save directory and places launched players beside the real entrance; it does not bypass the E interaction or any underwater gameplay.

```powershell
node tools/qa/underwater/fixture-server.mjs --port 3401
```

With that fixture running, a repeatable two-browser smoke capture is available:

```powershell
node tools/qa/underwater/capture.mjs --origin http://127.0.0.1:3401 --out .qa/underwater
```

Add `--full` to drive the three-guard fight and wreck-chest collection through normal mouse and keyboard controls before returning. Add `--events` to complete the chimes and ray rescue with normal `E` inputs. Add `--tour` to traverse high, collision-safe water, verify the actual region reached at each stop, descend for six landmark frames, then capture the full region chart. Use `--browser msedge` where Chrome is unavailable. Set `PLAYWRIGHT_INDEX` to Playwright's `index.mjs` if it is not installed as a local package and cannot be found in the documented development cache. The generated `.qa` images and report are local evidence and must not be committed.

Open `http://127.0.0.1:3401/?test=1` in two browser contexts and verify:

1. Join and launch. Confirm the local player is grounded beside the blue Sunken Reach entrance and that E offers the dive only within range.
2. Press E. Confirm the view and HUD switch cleanly, with no continued land movement, and that the HUD names Sunken Reach, a 3D objective, exploration counts, and the return distance.
3. Look up and down while holding W/S and confirm travel follows the view. Confirm A/D stays level, Space/C still changes depth directly, Shift swims faster, and releasing movement hovers. Open Escape and M while holding C and confirm movement stops.
4. Fire, reload, swap guns, aim or scope, use the cutlass and heal. Confirm reef guards receive hits only with clear wreck sight lines and island enemies never appear as targets.
5. Leave one browser ashore and send the other below. Confirm the crew list names the other area, while map markers and floating nameplates include only the local realm.
6. Open M below. Confirm the full 276 × 276 chart names all six regions and shows landmark solids, discoveries, unopened caches, event state/nodes, the return beacon, local crew and local pings. Return ashore and confirm M restores the island chart with its dive marker.
7. Confirm E at the reef beacon returns to shore before the fight is complete. Dive again, defeat all three original wreck guards, collect the chest, and confirm the shared pearls and weapon drop occur once. Then complete the chimes and ray rescue with E; confirm each node progress toast and shared reward.
8. Start the lighthouse finale with a player below. Confirm that player returns to shore and the entrance no longer offers a dive.
9. Check the browser console for errors and confirm `/health` remains healthy.

After acceptance, follow the repository workflow in `AGENTS.md`: commit and push `main`, rebuild the local Docker service while preserving `skywake-data`, verify `docker compose ps` and `http://localhost:3400/health`, and compare changed browser assets served at the URL root with the committed files.

## Evidence

### Expansion browser evidence — 2026-09-15

An isolated Microsoft Edge run used the real fixture at `http://127.0.0.1:3402`, the normal keyboard/mouse controls, and no page-side state mutation:

```powershell
node tools/qa/underwater/capture.mjs --origin http://127.0.0.1:3402 --out .qa/underwater-expansion-final --full --events --tour --browser msedge
```

`report.json` passed all seven checks: E entered the reef, C changed depth, E returned to shore, the second browser stayed ashore, the original three wreck guards and chest completed, six actual coordinate checks reached the named regions, and both the chimes and ray rescue completed through E inputs. It recorded the full chart, one frame for each biome, the two completed events, wreck reward, shore return, and split-realm map. The run had zero browser console errors and zero page errors. Local evidence remains untracked at `.qa/underwater-expansion-final/`.

A follow-up `--tour` run after the final art changes passed its five applicable checks with zero console or page errors at `.qa/underwater-expansion-art/report.json`. The lead reviewed all six biome frames. The final Crown Graveyard keel/crossbeam cladding was separately rendered from the actual presentation module at `.qa/underwater-expansion-crown-detail.png`; this is art inspection evidence, not a gameplay claim.

A fresh `1024 × 768` low-graphics, reduced-motion Edge check entered the reef and opened the final map markup without overflow. The centered map panel bounds were `102, 61.8` through `922, 706.2`, inside the viewport; its screenshot is `.qa/underwater-expansion-low-map-1024.png`.

The final focused underwater set passed 22 of 22 checks after the renderer cladding update (`.qa/underwater-expansion-final-focused.log`). The full repository suite passed 523 of 523 tests with zero failures or skips (`.qa/underwater-expansion-final-tests.log`), and `git diff --check` passed.

The browser pass does not make a five-player stress or performance claim. Authority WebSocket tests cover late-join public exploration state; broader multiplayer load/performance testing remains outside this evidence.

### Historical wreck evidence

The entries below cover the pre-expansion wreck flow: entry, swimming, return, split realms, combat, and the old chest. They do not certify the six-region expansion.

Verified on 2026-09-13 with the isolated fixture and Chrome headless. The independent two-page run used:

```powershell
node tools/qa/underwater/fixture-server.mjs --port 3401
node tools/qa/underwater/capture.mjs --origin http://127.0.0.1:3401 --out .qa/underwater/final --full
```

The `1440 × 900` full capture passed all five automated checks: E entered the reef, held C moved the swimmer down, E returned the swimmer to shore, the second browser remained ashore, and normal combat controls cleared all three guards before normal movement collected the wreck chest. The captain finished with three reef kills, one opened chest, 27 shared pearls, a Tide Repeater reward, and the `drop-1-sunken-reach-chest` collection recorded. There were zero console errors and zero page errors. The report is `.qa/underwater/final/report.json`; reviewed frames `02-sunken-reach-objective.png` through `06-returned-to-shore.png` cover the split-crew HUD, reef and island maps, wreck reward, and shore return.

A second `1024 × 768` pass enabled reduced motion and low graphics through the visible settings controls. It confirmed that opening the map while C is held stops the dive, the compact HUD and reef map fit, and the browser remained free of console and page errors. Its local evidence is `.qa/underwater/final/low-report.json`, `07-low-quality-1024.png`, and `08-low-quality-map-1024.png`.

The focused client verification passed 56 of 56 tests:

```powershell
node --test test/underwater-ui.test.js test/underwater-prediction.test.js test/input.test.js test/prediction.test.js test/weapon-presentation.test.js test/airship-ui.test.js
```

The final repository suite passed 502 of 502 tests with no failures or skips, and `git diff --check` passed:

```powershell
npm.cmd test
git diff --check
```

The local full-suite log is `.qa/underwater-final-tests.log` and remains untracked with the other QA output.

The final commit, push, Docker service state, health response, and served-asset comparison are recorded in the delivery report after the standing `AGENTS.md` workflow completes.

### Look-directed swimming follow-up

On 2026-09-13, W/S was changed to follow both yaw and pitch. A/D remains level, Space/C adds direct vertical motion, and combined movement remains capped at normal or surge speed. The same shared movement code runs on the server and in client prediction.

A Chrome headless pass at `1440 x 900` used normal mouse and keyboard inputs at the isolated shore fixture. Forward swimming climbed while looking up and descended while looking down; backward movement reversed the look direction. Level strafing, direct rise/dive, and hover after release also passed, with no console or page errors. Local evidence is `.qa/underwater-look/report.json`, `look-up.png`, and `look-down.png`. The focused movement, network, and prediction tests passed 10 of 10.

The follow-up full suite passed 505 of 505 tests with no failures or skips; `git diff --check` passed. The local suite log is `.qa/underwater-look-tests.log`.
