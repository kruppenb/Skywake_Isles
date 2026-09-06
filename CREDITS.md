# Credits and licenses

Skywake Isles is an original game created for this project with Codex. The island layout, cooperative adventure, skyship, pirates, crabs, environment props, interface, procedural geometry, colors, and synthesized audio were created for this game. No Rustbeard Island source, design implementation, models, textures, or other assets were copied or imported. No Fortnite or other commercial game assets are included.

The Old Watch pilot's masonry, timber barracks, slate roof, boulders, fir trees, grass, ferns and soil are original Skywake Isles assets generated offline from `tools/build-old-watch.py`. Their mesh shapes, UVs, surface textures and weathering patterns were authored for this project using Blender and deterministic procedural functions; no commercial game assets, third-party texture packs, scans or external model downloads were used. The editable source, exported GLB and material manifest are included in the repository. Blender is an authoring tool and is not required by the running game. See `docs/ENVIRONMENT_PIPELINE.md` for regeneration and extension instructions.

The following general-purpose open-source packages are included in the pinned dependency lockfile:

| Package | Version | License | Use |
| --- | --- | --- | --- |
| Three.js | 0.180.0 | MIT | Browser WebGL rendering and geometry |
| ws | 8.21.3 | MIT | Authoritative server WebSocket connections |

Their license notices are included in their installed npm packages (`node_modules/three/LICENSE` and `node_modules/ws/LICENSE`). The application runs on Node.js; the Docker image uses the official Node.js 22 Alpine base. Browser fonts come from each device's system font stack. All game assets are served from the local server, with no external asset CDN, telemetry, advertisements, or account service.
