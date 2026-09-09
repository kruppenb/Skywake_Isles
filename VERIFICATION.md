# Streaming defense waves and staged finale verification

September 6, 2026. Optional-defense waves now surge in rank by rank instead
of landing as one clump, and the final battle at Tideglass Lighthouse runs
in stages (shrine crabs, Tidebreaker elites, the Tempest Crab, with a fourth
stage reserved in `shared/finale.js`). Commit 65c9438, measured on this
Windows host.

- Spread: before the change `sideEventSpawns` placed almost every attacker at
  the 3 m spacing minimum (nearest-neighbour averages of 3.0 to 3.9 m at the
  market and farm for crews of 3 and 5) within 6 to 9 m of depth, so a wave
  reached the supplies inside about two seconds. Afterwards all 45 site, crew
  and wave combinations still return a full roster; nearest-neighbour
  averages are 5.1 to 10.0 m at the market and farm and 4.0 to 5.8 m at the
  yard's short surf-line front, wave depth spans 7.5 m (solo wave 1) to
  22.5 m (wave 3), ranks carry delays of 0, 2.5, 5, 7.5 and 10 s, spitters
  form a rank behind the crabs, and Tidebreakers carry the latest delay in
  every final wave. Pending ranks count toward `remaining` until they surface.
- Finale placement: stage 1 forms 9 (solo) to 21 (five pirates) crabs 38 to
  48 m from the beacon within 17 degrees of each shrine's bearing (palm 173,
  ember -55, moon 20 degrees), 4.8 to 12 m apart, each with a direct or
  validated two-leg route to the dais; shrine directions surge 1.5 s apart
  and ranks 2.5 s apart. Stage 2 places 2 to 4 Tidebreakers 32 to 37 m out on
  the same bearings, and stage 3 spawns the Tempest Crab 16 m in front of
  the beacon as before. Boss minions leave with the boss.
- Tests: `npm test` ran 202 tests in 176.5 s with no failures, including the
  new `test/finale.test.js` (7 cases), a rank-by-rank streaming test in the
  side-events suite, and the five-client network test, which now fights all
  three stages and reached victory. The scripted market defenses complete in
  37.6 s (solo) and 49.1 s (five pirates) of the 180 s deadline.
  `git diff --check` is clean.
- Docker was rebuilt from a git-archive export of 65c9438 (project
  `skywake-isles`, so the `skywake-isles_skywake-data` volume was kept) and
  reported healthy; the five changed browser assets (`/ui.js`, `/main.js`,
  `/world.js`, `/shared/finale.js`, `/shared/side-events.js`) returned
  HTTP 200 with `no-cache` and matched the commit after CRLF normalization.
- Live check on the deployed build: a Playwright-driven browser pirate
  ("Watcher") boarded as captain with four Node bot pirates, set sail, walked
  from the strand to the lighthouse dais, and watched the bots light the
  beacon. The server emitted the stage-1 `finale` event with 21 spawns
  (delays 0 to 8 s from palm, ember and moon), stage 2 with 4 Tidebreakers
  and stage 3 with the boss. A DOM recorder sampling the HUD every 250 ms
  (installed a few seconds into stage 1, so it caught that stage's "Stage 1
  cleared! The next stage gathers…" panel text but not its banner) recorded
  the banner "Tideglass Lighthouse / Stage 2 / 4 Tidebreakers march on the
  lighthouse!" beside its notice toast, the objective panel "Defend the
  lighthouse — Stage 2/3 · 4 Tidebreakers remaining" counting down, then
  "Stage 3 / The Tempest Crab has the final compass!" in the gold final
  style while the boss bar fell from 100% to 12% and the panel switched to
  "Free the compass". Victory arrived after 118 s of voyage with 98 kills and
  498 pearls; the page logged no console errors, warnings or runtime errors,
  and up to 32 simultaneous effects (delayed spawn foam plus tracers)
  rendered.

# Walkover chests and salvaged duplicates verification

September 6, 2026. Chests now open when a living, landed pirate walks within
2 m with line of sight, with no key press, and a gun the pirate cannot use
(an equal or better copy already carried) no longer lingers underfoot: it is
salvaged once per pirate for 5 shared pearls, disappears for that pirate and
stays on the ground for the rest of the crew. Measured on this Windows host.

- `server/game.js` shares one `openChest` between the walkover tick and the
  explicit E fallback (still accepted within 3.5 m for older clients), and
  `pickupWeapon` emits a new `salvage {id,playerId,weapon,rarity,pearls}`
  event instead of the old `DUPLICATE_WEAPON` denial for a first contact; a
  copy already in `collectedDropIds` is still denied so nothing pays twice.
  The client hides the chest E prompt, toasts and bursts the salvage, and the
  chest toast for the opener no longer tells them to walk over a gun they are
  already standing on.
- New and rewritten loot tests cover: chest walkover at 1.9 m opening, paying
  12 pearls, healing a crewmate 6 m away and equipping the rolled gun on the
  same tick; 2.7 m (E range) not opening it; every pickup guard (radius,
  jumping, falling, gliding, aboard, offline, downed, dead, lobby, victory)
  applied to chests, new guns and unusable duplicates alike; the through-wall
  case for salvage; a cottage chest opening through its rear doorway; salvage
  paying once per pirate across a two-pirate crew, a reconnect and a late
  arrival while `isLootVisible` hides the copy only for the salvager; and the
  upgrade path still equipping rather than salvaging.
- The full `npm test` passed 193 tests in 140.7 s, including the five-client
  network voyage (whose explicit re-pickup of an already collected gun still
  returns `DUPLICATE_WEAPON`). `git diff --check` is clean and `node --check`
  parses every edited module.
- Docker was rebuilt from a git-archive export of commit 7fb09c2 (project
  `skywake-isles`, `skywake-isles_skywake-data` volume kept) and reported
  healthy; `/health` returned 200 and `/`, `/index.html`, `/main.js`,
  `/ui.js`, `/world.js` and `/shared/weapons.js` all returned HTTP 200 with
  `no-cache` and matched the commit byte for byte after CRLF normalization.
- Live check against that deployment in a Playwright browser at 1280 by 800:
  joined as captain, set sail, took the automatic drop and landed at the
  spawn (0, 94). Holding W walked the pirate to (0, 80) straight through
  chest-1 at (0, 88) without pressing E; a second Node WebSocket crew member
  watching the server saw the `chest` event (+12, a Common Scatter Blaster)
  and, on the same tick, the `salvage` event (+5) because the pirate already
  carried a Common Scatter Blaster. The HUD read "17 shared pearls", the
  pirate's `collectedDropIds` hid the drop while it stayed in the crew's drop
  list, the loadout was unchanged, and the console logged no errors or
  warnings.

# Seaward crab defense verification

September 6, 2026. The optional supply defenses now stage three crew-scaled
waves that surge in from the seaward side, with Tidebreaker mini bosses on
the final wave and a large wave banner. Measured on this Windows host.

- Spawn placement was exercised for all three supply centers, waves 1 to 3,
  and crews of 1, 3 and 5: every combination produced its full roster (5 to
  19 attackers) inside the 60 degree seaward half-arc, on sand at or above
  1.1 m, with 2.8 m spacing (3.6 m for Tidebreakers). Between 2 and 12 of
  each wave start behind cover and carry a validated two-leg route. Driftwood
  Yard's first rank forms on the surf line 17 m out; the market and farm
  fronts sit 28 m and 26 m seaward. Warm spawn calls cost 6 to 32 ms; the
  first call per site builds its waypoint ring in 66 to 155 ms.
- Unattended solo surges reached the supplies and landed their first hit at
  about 4 s (yard) and 7 s (farm, market), then drained 100 integrity within
  10 to 14 s, so the failure path is exercised by real ticks.
- A stall was found and fixed during this pass: an attacker whose straight
  route flipped from clear to blocked could come to rest exactly on the 0.85 m
  clearance margin of a prop, where every route check failed from its own
  position and it idled forever. Route checks now exempt the walker's first
  0.6 m, spawn and waypoint positions keep an explicit standing-room check,
  waypoints count as reached at 0.2 m, and a ring point the walker already
  stands on is skipped. The routed-attacker test walks every two-leg route
  with the enemy's full public radius and confirms arrival within 3.2 m.
- `node --test` passes side-events (18), side-events-ui (7, including the
  banner text for waves 1, 2 and the final wave), presentation (14, including
  finite Tidebreaker geometry), encounters and game suites. The scripted
  solo and five-player defenses complete all three waves well inside the
  180 s deadline with the expected kills and pearls (45 reward, 15 per
  Tidebreaker, 3 per crab). The full working-tree `npm test` ran 167 tests
  in 130.2 s with 166 passing; the single failure belongs to the concurrent
  Driftwood Yard environment milestone's uncommitted manifest.
- Browser check at 1280 by 800 against a local server: after joining and
  setting sail, the wave banner rendered centered under the compass (top
  102 px to 194 px) with the place name, "WAVE 1" and its subtitle, and the
  toast stack moved below it to 222 px instead of overlapping. The gold
  "FINAL WAVE" variant with "2 Tidebreakers rise from the deep!" was also
  inspected. The only console error was the other session's missing
  driftwood-yard kit, unrelated to this change.
- Docker was rebuilt from a git-archive export of commit 3ac1087 (project
  `skywake-isles`, so the `skywake-isles_skywake-data` volume was kept) and
  reported healthy; all nine changed browser assets returned HTTP 200 with
  `no-cache` and matched the commit byte for byte after CRLF normalization.
  An isolated `npm test` on that export then showed that commit 3ac1087 had
  swept the other session's unfinished Driftwood Yard imports into
  client/world.js, which the export could not resolve, so the deployed
  client failed to load. The other session removed only those hunks in
  commit 9886cb4 and redeployed.
- Final state on 9886cb4: an isolated `npm test` on a git-archive export of
  that commit passed all 167 tests in 138.3 s. The Docker service is healthy,
  the nine changed assets served on port 3400 match the commit after CRLF
  normalization, and fetching the deployed client's entire ES module graph
  from `/main.js` resolved all 31 modules with HTTP 200, so the earlier
  unresolved-import failure is gone. No redeploy was needed after the fix.

# Movement and character polish verification

September 5, 2026 follow-up. `npm test` passed all 45 tests in 89.99 seconds,
including the full five-client voyage, victory/replay, and persistence checks.
Changed JavaScript passes syntax checks; `git diff --check` passes.

- Before the fix, an idle pirate drifted up to 0.491m relative to the initial
  boat and its hip swung between -0.65 and +0.65 radians. Afterward, all five
  pirates had zero deck/height drift and zero idle gait speed over 180 browser
  frames. The camera maintained a constant offset from the ship.
- Ground walking measured 8m/s and sprinting 11m/s, with frame variation below
  1e-12m/s after warm-up. Browser testing exposed repeated-ACK timing pulses;
  simulation-timestamp reconciliation and a coalesced-timer regression test
  resolved them. Unconsumed jumps also remain airborne until acknowledged.
- Browser controls verified deck movement, manual drop, gliding with a stowed
  gun, landing, ground jump, pause with zero movement, and same-character
  reconnect. Final drop/jump probes showed no return-to-deck or grounded bounce.
- Inspected new pirate front/shoulder views, both guns, firing/reload poses,
  glider, and crab combat. Pirates use 14 visible meshes aboard (15 grounded),
  with approximately 14,700 visible triangles. Hands remain on their gun grips
  through reload and recoil to floating-point precision.
- Actual shots produce moving tracers from the visible muzzle. Scattershot
  showed five trails and one flash. A second browser observed remote shots.
  Aimed browser fire dealt two 24-damage hits to a crab.
- Firing effects return to zero. Repeated shots settled at the same 274
  geometries and two textures; both graphics settings render the effects.
- Five-player probes at 1280x800 and 1920x1080 averaged about 60fps. The 1080p
  180-frame sample had a 16.8ms 95th percentile. Browser console: no warnings
  or errors. These short measurements are specific to this host.

Rebuilt the Docker service and confirmed it healthy. All six changed client
modules returned HTTP 200, `no-cache`, and exact SHA-256 matches to the local
files. The updated game loaded and joined successfully through
http://192.168.1.27:3400. Test servers used isolated save directories.

This update uses original procedural art, adds no dependencies, and preserves
combat balance, collision sizes, and the existing aggregate-save volume.
The original release's longer play-through and platform limitations follow.

# Original release verification

Verified on September 5, 2026 on this Windows host. Tests used original Skywake
Isles code and assets only. No Rustbeard files or running services were changed.

Final result: `npm test` passed all 26 tests (25 unit/input checks and one complete
five-client network voyage) in 89.48 seconds. `npm audit --omit=dev` reported zero
known vulnerabilities. The rebuilt Docker service is healthy and ready to play.

## Completed play-throughs

- Five real WebSocket players completed a full voyage using normal movement and
  game actions: manual ship drops, shared treasure, all three shrine encounters,
  the 1,370-health finale, victory, and captain-controlled replay. The run earned
  195 shared pearls and defeated 17 enemies in about 89 seconds. This fast run is
  an automated protocol regression, not an estimate of a child's play time.
- Two independent browser contexts completed the adventure together. The visible
  play-through earned 180 pearls and 12 enemy defeats, and both browsers showed
  the same victory results. This test included walking the island, reticle hits,
  both blasters, reloads, healing, automatic rescue, shrine charging, the finale,
  and replay. Automated camera steering assisted navigation and aiming; separate
  normal-mode mouse-input checks cover the actual browser controls.
- Five simultaneous players were accepted by the Docker deployment; a sixth
  browser received the crew-full explanation. Actual browser contexts verified
  shared movement, shot effects, treasure rewards, and crew pings.

## Reliability and safety checks

- Deterministic movement, traversable routes, ship/terrain collisions, sprint,
  jump/glide/landing, water rescue, combat range/cooldowns, friendly-fire
  prevention, finite encounters, checkpoints, victory, and replay were exercised.
- Disconnect/reconnect retained the character. Captain transfer and late joining
  were checked. Reusing a tab's reconnect identity stopped the old connection
  cleanly instead of producing a reconnect loop.
- Malformed packets, invalid inputs, remote interactions, simultaneous treasure
  claims, sixth-player rejection, and private-file/path traversal requests were
  tested. The service is designed for a trusted LAN, not public internet hosting.
- Abandoned rounds reset after the last character leaves or its reconnect
  reservation expires. A temporary disconnect does not discard reserved progress.
- Aggregate statistics survived restarting the isolated test server. Active
  voyages intentionally remain in memory and do not survive a server restart.
- Recreating the actual Docker container retained its existing statistics in
  the named volume (`voyages: 1` before and after recreation). Leaving the final
  browser crew returned `/health` to `players: 0, phase: "lobby"`.
- The dependency audit after upgrading ws to 8.21.3 reported no known production
  dependency vulnerabilities. Browser scripts and assets are served locally.

## Visual and performance checks

Screenshots were inspected for the welcome screen, ship deck and manual drop,
five island regions, treasure, crab encounters, minimap/full map, finale, and
shared victory screen. Camera-obstructing ship cabin geometry and enemy health
bar rendering were corrected during this pass. Menus, keyboard focus, mute,
graphics switching, and reconnect messages were exercised. The welcome layout
also fits a 390-by-844 viewport; touch gameplay is not implemented.

Normal-mode browser mouse checks used real mouse events on the LAN URL. A
120-pixel right drag changed yaw by exactly 0.3 radians, without double movement.
Both button-chord orders could look and fire together; releasing either button
preserved the other, and menus cleared all held input. Native pointer capture
also succeeded, moved the view with the same sensitivity, and released cleanly
on Escape while opening the menu. The fallback was additionally checked with
pointer capture deliberately unavailable. Quick Space taps produced a manual
ship drop and a safe landing. A crab's full health bar and its partial bar after
a real 24-damage shot were visually checked. Final browser console: zero errors
or warnings; game assets returned HTTP 200.

Hardware: Chromium 145 using ANGLE on an NVIDIA GTX 1080 Ti, device pixel ratio 1.
High-quality measurements averaged approximately 60 frames/second over 120 frames
at 1280 by 800 and over 180 frames at 1920 by 1080. A five-avatar Docker lobby at
1920 by 1080 also averaged 60 frames/second over 180 frames, with a 16.8 ms 95th
percentile and approximately 303,000 rendered triangles. These short measurements
are specific to this GPU and scene, not a guarantee for other computers.

## Deployment and scope

The Docker service publishes port 3400, runs as the non-root Node user, has a
health check and automatic restart policy, and retains aggregate statistics in
a named volume. The host successfully loaded the game through its LAN address,
http://192.168.1.27:3400. Existing games on their other ports were left running.

Network tests used separate clients and browser contexts on this host. A second
physical device on the household network was not available for verification.
Desktop keyboard and mouse are required. This is a complete, small cooperative
island adventure, not a recreation of Fortnite's scale, building, matchmaking,
or competitive modes.

## Island expansion worktree

The `island-expansion` branch lives at
`C:/repos/skywake-isles/.qa/worktrees/island-expansion`. Existing uncommitted
gameplay improvements were copied into this checkout before the expansion.
The finished expansion is integrated into `main` for the Docker game at
http://localhost:3400. The development preview at http://localhost:3402 uses
isolated saves.

The expansion adds eight named places, 14 buildings, 10 ambient residents,
eight treasure chests, two fishing skiffs, and 27 clusters of work-site props.
Buildings and paths use shared layout data for rendering, movement, combat
collision, and the map. Residents and their work pauses are decorative;
buildings are exterior landmarks. Discovery progress is local to the current
page/voyage and clears on a new voyage or page refresh.

After integration into `main`, `npm.cmd test` passed all 51 tests with no skips
or failures in 91.65 seconds.
The five-client network test completed all three shrines and the final boss,
then verified replay, reconnect behavior, and persisted aggregate statistics.
Six new tests exercise the real movement implementation along each destination
and treasure approach in both directions, across both edges of the five-meter
paths, around resident loops, and against every building's collision boundary.
The original 44 unit checks still pass. Final JavaScript syntax and whitespace
checks also pass.

An isolated Microsoft Edge browser on this host visited all eight places with
normal networked movement, completed the discovery journal, and opened a new
camp chest for 12 shared pearls. Discovery waited while the map was open and
registered on closing it on foot. The 1280-by-720 map was visually checked for
labels, legend, journal layout, and keyboard closing. Harbor, market, farm and
observatory scenery was reviewed with ground-level and inspection-camera
captures. The final browser reported no runtime or console errors. All 14
measured building meshes fit inside their shared footprints and collision
heights; all 180,570 settlement geometry vertices were finite.

Frame sampling confirmed rotating windmill sails, bobbing skiffs, drifting
smoke and resident motion/work pauses. The new ambient poses remained identical
over 60 frames with reduced motion enabled. Low graphics hid smoke while
retaining all buildings and all 10 residents. At 1920 by 1080 on this host, the
warmed high-quality preview averaged about 60 fps over 240 frames, with a
16.8 ms 95th percentile and 293 draw calls. The comparable pre-architecture
preview used 266 calls. These are short measurements on this machine, not a
performance guarantee for other hardware. No additional physical LAN device
was tested for this expansion.

## Airship gunnery — 2026-09-08

Implemented in the isolated `codex/airship-gunnery` worktree. The original
239-test baseline passed. The completed change passed all 269 tests with no
failures or skips (246.6 seconds), plus JavaScript syntax and `git diff --check`.
The existing five-client voyage still completes the island and final battle.

The additional public WebSocket test uses two real crew connections and ordinary
movement/actions to verify different simultaneous gun operators, exclusive seats,
synchronized shots and target health, cooldowns, unchanged handheld ammunition
and economy, disconnect/reconnect, dismounting, gliding, the beach return lift,
remaining aboard past the opening flight, and target respawning. Authority tests
also cover both lifts in voyage/finale, invalid distance/height/phase/health,
equipment preservation, nearest spherical hits, misses, reset and cleanup.

A Chrome browser playthrough on an isolated server walked to a cannon, fired
nine shots, landed six hits and destroyed three flying crabs. It stayed aboard
past 28 seconds, held/repeated Space to dismount without accidentally gliding,
used E to remount and leave, glided to the lighthouse lift and returned, then
repeated the trip while holding a movement key. The second return settled at
deck coordinates (0, 0) without continued movement. No browser exceptions,
console errors or failed asset requests were observed.

Visual checks covered the larger ship, four cannon stations, winged targets,
both lift pads, map labels, gun sights at traverse/elevation limits, and the
1440×1000 and 1024×768 gameplay layouts. The compact ship banner ends at y=578,
above the equipment panel at y=612. Model tests verify cannon socket/camera
agreement, walking/deck support at all stations, low/level shot clearance through
the actual hull and rail geometry, and a bounded pool of eight target models with
correct disposal. The cannon pivots are raised and downward aim narrows near
the traverse limits to keep the deck out of the firing ray. Thin decorative
rigging can still cross high-angle views.

This is practice gunnery: flying targets respawn and award no pearls or kills;
the existing final battle is unchanged. A future airship combat phase can use
the shared stations and return route. Verification used this host and loopback
clients; no additional physical LAN device was tested. QA screenshots, logs,
temporary saves and browser helpers remain untracked.
