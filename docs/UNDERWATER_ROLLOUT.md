# Underwater rollout

This handoff tracks the underwater environment separately from the island environment rollout. Complete one milestone at a time. Do not begin a larger underwater zone automatically after the first milestone is accepted.

## Current milestone: Sunken Reach wreck

Status: first milestone implemented and independently verified. No later underwater milestone has started.

Sunken Reach is a bounded realm below the safe landing beach. Its shore entrance is at `(14, 106)` and its reef spawn and always-available return beacon are at `(-18, 6, 20)`. Players enter only during the voyage while healthy, grounded, within four metres, and on a clear route. Starting the lighthouse finale returns all reef players to shore and prevents another dive that voyage.

Implemented scope:

- A separate reef realm with 3D swimming, bounded movement, wreck collision, realm-specific line of sight, and no island height or collision queries below.
- WASD horizontal swimming relative to view, Space to rise, C to dive, Shift for faster swimming, and neutral hover when movement is released.
- Three finite reef guards, ordinary underwater gun/cutlass/heal combat, same-realm 3D revives, and realm-isolated enemy behavior and damage.
- A wreck chest that becomes collectible after all guards fall, opens once per voyage, and grants shared pearls plus the ordinary shared weapon drop.
- An exit available at every stage of the expedition. The finale returns the reef crew to shore before its island encounter begins.
- Client prediction and remote interpolation reset at realm travel boundaries. Old land or swim inputs cannot replay after a transition.
- A Sunken Reach objective that advances from guard count, to wreck chest, to return beacon; underwater weapon HUD and targeting; and reef-only nameplates and map markers.
- An island dive marker and a separate underwater wreck map showing the exit, wreck, chest, local crew and local pings. The crew health list identifies friends in the other realm.
- Updated in-game controls and README instructions.

## Deferred work

These are future milestones and are not part of the wreck acceptance:

- Additional or connected underwater zones beyond the current bounded reef.
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

Add `--full` to drive the three-guard fight and wreck-chest collection through normal mouse and keyboard controls before returning. Set `PLAYWRIGHT_INDEX` to Playwright's `index.mjs` if it is not installed as a local package and cannot be found in the documented development cache. The generated `.qa` images and report are local evidence and must not be committed.

Open `http://127.0.0.1:3401/?test=1` in two browser contexts and verify:

1. Join and launch. Confirm the local player is grounded beside the blue Sunken Reach entrance and that E offers the dive only within range.
2. Press E. Confirm the view and HUD switch cleanly, with no continued land movement, and the objective reports three reef guards.
3. Hold WASD, Space, C, and Shift in turn. Confirm horizontal travel, rising, diving, faster travel, and hovering after release. Open Escape and M while holding C and confirm movement stops.
4. Fire, reload, swap guns, aim or scope, use the cutlass and heal. Confirm reef guards receive hits only with clear wreck sight lines and island enemies never appear as targets.
5. Leave one browser ashore and send the other below. Confirm the crew list names the other area, while map markers and floating nameplates include only the local realm.
6. Open M below. Confirm the plan shows the wreck walls, chest, return beacon, local crew and local pings. Return ashore and confirm M restores the island chart with its dive marker.
7. Confirm E at the reef beacon returns to shore before the fight is complete. Dive again, defeat all three guards, collect the chest, and confirm the shared pearls and weapon drop occur once.
8. Start the lighthouse finale with a player below. Confirm that player returns to shore and the entrance no longer offers a dive.
9. Check the browser console for errors and confirm `/health` remains healthy.

After acceptance, follow the repository workflow in `AGENTS.md`: commit and push `main`, rebuild the local Docker service while preserving `skywake-data`, verify `docker compose ps` and `http://localhost:3400/health`, and compare changed browser assets served at the URL root with the committed files.

## Evidence

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
