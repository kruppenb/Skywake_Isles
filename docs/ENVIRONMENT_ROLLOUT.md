# Environment art rollout and handoff

This is the authoritative progress tracker for the environment rollout. With this repository open, the user can say **“upgrade next zone”** in a fresh window. Follow [AGENTS.md](../AGENTS.md), resume any in-progress milestone below, or start the first planned milestone. Complete one milestone per request; do not automatically start the following one. No previous conversation or local `.qa` files are required to resume.

## Visual direction

Old Watch is the approved visual benchmark. At commit `2c2d3fe`, the user explicitly approved it: “this is great, excellent style and quality.” Carry its moderate-fidelity weathering across the island: worn masonry, aged timber, moss, natural vegetation, textured ground, readable paths and restrained atmospheric lighting. Match that quality without raising the fidelity target. Coastal settlements, jungle, volcanic terrain and the magical grove retain their own colors, vegetation, architecture and atmosphere.

Windward Farm is shipped and validated at `8b66888`, and Tideglass Market / central Haven at `2e2bc1d`; these record implementation and QA completion, without implying separate explicit aesthetic approvals. Existing gameplay, character art, controls, objectives and UI stay intact.

## Milestones

| Order | Area | Status | Implementation / evidence |
| --- | --- | --- | --- |
| 1 | The Old Watch pilot | Complete | `2c2d3fe`; explicit user style approval; reproducible original kit. |
| 2 | Windward Farm and Old Watch connector | Complete | `8b66888`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 3 | Tideglass Market and central Haven | Complete | `2e2bc1d`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 4 | Saltwind Harbor, Driftwood Yard and Sunwake Strand | Planned — next | Coastal working waterfront and beach identity. |
| 5 | Palmheart Camp and Wilds | Planned | Jungle settlement and vegetation identity. |
| 6 | Cinderworks and Emberpeak | Planned | Volcanic architecture, terrain and atmosphere. |
| 7 | Moonwatch and Moonbloom | Planned | Magical grove architecture, vegetation and atmosphere. |
| 8 | Island-wide landscape, shoreline, distant detail and performance | Planned | Transitions, distant composition and total island finishing. |

## Active handoff

- **Active milestone:** None. Milestone 3 is complete; milestone 4 has not started.
- **Latest shipped environment implementation:** `2e2bc1d` on canonical GitHub `main`, preserving the concurrent pickup implementation `be58b78`.
- **Last confirmed deployment:** Local Docker game at `http://localhost:3400`, healthy after the Tideglass deployment on 2026-09-05. All 16 checked browser environment assets matched committed source; the persistent volume mount was preserved. Deployed walking/interior/aerial views and deliberate asset-failure checks passed. Recheck current reality before working.
- **Next objective:** Bring Saltwind Harbor, Driftwood Yard and Sunwake Strand to the approved weathered material quality while retaining their working-waterfront and beach identities. Bound the work to those existing coastal compositions and necessary transitions. Preserve routes, resident activity, loot, collision and gameplay; later regions remain planned.
- **Known blocker:** None recorded. Inspect the current tree and remote for subsequent work.
- **Next action:** Read the sources below, inspect repository/remote/deployment state, and capture walking, close and aerial baselines for the next area and an already-finished comparison view. Complete only milestone 4 on the next request.

When work is interrupted, replace the active handoff with concrete current facts:

| Handoff field | Record while a milestone is active |
| --- | --- |
| Scope and status | Milestone, bounded objective, in progress / blocked / awaiting a specific check. |
| Source state | Branch/worktree, implementation commits, relevant uncommitted files, unrelated work to preserve. |
| Completed work | Installed assets/runtime changes and checks that actually passed. |
| Remaining work | Exact next action, checks yet to run, failed checks, visual/gameplay findings and unresolved decisions. |
| Evidence | Reproducible commands, tracked manifests, comparison context and measurements; summarize any local-only screenshots. |
| Publication state | Last pushed commit, last verified deployed commit, health/hash results and any remaining failure. |

Keep this handoff useful without `.qa`: local helpers may accelerate verification if inspected first, but their absence must not hide requirements or block resumption. Do not mark a milestone complete before its implementation, checks, push and deployment are verified.

## Read first

Read [ENVIRONMENT_PIPELINE.md](ENVIRONMENT_PIPELINE.md) for the detailed asset contract, generation commands, ownership, terrain/lighting constraints, validation methods and measured limitations. Also read [CREDITS.md](../CREDITS.md) and the relevant existing tests before extending the kit.

- **Shared gameplay/layout:** `shared/exploration.js`, `shared/world.js`, `shared/old-watch.js`, `shared/windward-farm.js`, `shared/tideglass-market.js`. Use the actual target buildings, trails, resident routes, doors and loot.
- **Runtime integration:** `client/world.js`, `client/settlement.js`, `client/environment-assets.js`, `client/environment-lighting.js`, `client/environment-geometry.js`, `client/old-watch.js`, `client/windward-farm.js`, `client/tideglass-market.js`.
- **Editable assets:** `tools/environment_kit.py`, `tools/build-old-watch.py`, `tools/build-windward-farm.py`, `tools/build-tideglass-market.py`, and each kit's tracked manifest in `client/assets/`.
- **Regression coverage:** `test/old-watch.test.js`, `test/windward-farm.test.js`, `test/tideglass-market.test.js`, `test/environment.test.js`, plus target-area gameplay tests.

## One-milestone resume workflow

1. Read this tracker and repository instructions. Inspect the working tree, branch, recent commits and canonical remote history; preserve unrelated changes and later commits. Check Docker's current service, `/health` and deployed source before assuming the recorded deployment is still current.
2. Resume an in-progress milestone first. Otherwise use the first planned row, unless the user's current request changes the scope. Update the active handoff with the chosen objective and source state.
3. Capture the target area's existing walking, close and aerial views and a finished-area comparison. Record repeatable camera/quality/population settings and a warm performance baseline. State a concise implementation plan.
4. Implement only that milestone and the shared infrastructure it actually needs. Preserve existing IDs, append any necessary new IDs, use shared collision/layout data, keep routes/chests/both doorway approaches clear, and preserve the original procedural RNG stream. Overlays must match the alternating 2m rendered terrain triangles. Reuse the shared asset cache and single lighting owner; preserve visible fallback, atomic installation and exact-once resource disposal. Follow the pipeline's detailed constraints.
5. Complete the quality gates below, review the diff, then commit, push canonical `main` without force, deploy with `docker compose up -d --build --wait`, and verify service/health/served hashes under [AGENTS.md](../AGENTS.md). Routine completion is already authorized. Preserve `skywake-data` and other projects' containers.
6. Update this tracker with actual checks, implementation commit, push/deployment evidence, remaining limitations and the next handoff. Include the final tracking update in the authorized commit/push/deployment workflow. Report the result and stop; leave the next milestone planned.

## Quality gates and evidence to retain

- Compare against Old Watch at walking distance, close range and aerial/glider approach. Inspect interiors, animated parts, structural joins, terrain seams, path readability, vegetation placement and transition boundaries.
- Verify ordinary multiplayer movement/interactions and collision, both doors, cutaway/restoration, low graphics, reduced motion and deliberate asset-load failure. Check console and network failures.
- Regenerate assets in independent background Blender processes, preserving the user's interactive scene. Verify exported bounds/attributes/material bindings/manifests and byte reproducibility; commit original generators, assets, manifests and provenance together. Retain outward-winding and shared-resource regressions.
- Track unique download bytes, estimated decoded texture memory, visible renderer triangles/draw calls and comparable warm frame times. Include a populated gameplay view and its limitations. Per-kit ceilings do not allocate that cost to every later area; retain instancing, bounded batches and distance/quality detail reductions.
- Run relevant checks, full `npm.cmd test` for gameplay/network/rendering changes, and `git diff --check`. Record actual results. Verify pushed commit, `docker compose ps`, `/health`, and changed client assets served from the URL root against committed source.
- Keep the concise durable evidence here and detailed methods/measurements in the pipeline. Never commit credentials, saves, dependencies, previews, logs or QA output.

## Latest completed milestone evidence

**Tideglass Market and central Haven — `2e2bc1d`, 2026-09-05:** committed and pushed to canonical `main`; `docker compose up -d --build --wait` succeeded, `docker compose ps` reported healthy, and `/health` returned `ok: true`. All **16** checked browser environment assets matched committed source by SHA-256. The persistent volume mount was unchanged. Full `npm.cmd test` passed **152 tests**, and `git diff --check` plus independent implementation review passed. All three kits independently regenerated with identical GLB and manifest bytes; Old Watch and Farm assets remain unchanged.

The milestone replaces the existing market cottage, two stalls and two closed Haven huts, with bounded ground, paving and coastal planting. The original geometry adds **2,019,240 GLB bytes** and no texture images. Combined unique environment GLBs total **12,063,040 bytes**, retaining **9,786,696 bytes** estimated decoded texture memory. Final deployed five-player fixed-render views measured **17.65–17.81ms mean / 18.2–18.6ms p95**, with materially higher market/Haven renderer costs. A live five-player scene with 36 enemies measured **16.67ms mean / 18.4ms p95**. Host scheduling, fixed poses and variable combat limit these comparisons; detailed fixtures, costs and provenance are retained in [the pipeline QA record](ENVIRONMENT_PIPELINE.md#tideglass-implementation-qa--2026-09-05).

Validated both cottage doors in both directions, chests, furnished cutaway/restoration, the market-to-Haven trail, low graphics, reduced motion, close/walking/aerial/glider views and independent/shared asset-failure fallback. Visual review corrected dark plaster/canvas, awning beam intersections, masonry backing and the soil overlay hiding paving. Deployed browser review and repeated failure checks had no unexpected console/network errors. Milestone 4 remains planned.

### Previous milestone

**Windward Farm — `8b66888`, 2026-09-05:** committed and pushed to canonical `main`; local Docker deployment healthy; 13 browser-asset hashes matched committed source. Full `npm.cmd test` passed **130 tests**, and `git diff --check` passed. Both kits independently regenerated with matching GLB and manifest bytes. Old Watch's approved GLB remained unchanged.

Farm adds 2,459,180 GLB bytes and no texture images. Combined unique environment GLBs total **10,043,800 bytes**, with **9,786,696 bytes** estimated decoded RGBA8 textures plus full mip chains. Fixed-render five-player comparisons ran around **57 FPS / 18.2ms p95** on this host; a populated live sample measured **56.63 FPS / 18.2ms p95**. Farm triangles and draw calls increased materially. These are measured comparisons, not a guarantee for other hardware or permission to multiply the same cost island-wide; exact fixture/population settings and before/after costs are in [the pipeline QA record](ENVIRONMENT_PIPELINE.md#windward-farm-milestone-qa--2026-09-05).

Validated walking/interactions, both barn doors in both directions, furnished cutaway, rotating sails, the connecting trail, low/reduced settings, aerial views and shared/Farm asset failure fallback. Visual review found and fixed floating hay and the mill cap underside slit. No unexpected console/network errors remained. Later regions are still planned.
