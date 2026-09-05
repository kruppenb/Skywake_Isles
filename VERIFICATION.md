# Release verification

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
