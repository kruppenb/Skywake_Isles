# Environment art rollout and handoff

This is the authoritative progress tracker for the environment rollout. With this repository open, the user can say **“upgrade next zone”** in a fresh window. Follow [AGENTS.md](../AGENTS.md), resume any in-progress milestone below, or start the first planned milestone. Complete one milestone per request; do not automatically start the following one. No previous conversation or local `.qa` files are required to resume.

## Visual direction

Old Watch is the approved visual benchmark. At commit `2c2d3fe`, the user explicitly approved it: “this is great, excellent style and quality.” Carry its moderate-fidelity weathering across the island: worn masonry, aged timber, moss, natural vegetation, textured ground, readable paths and restrained atmospheric lighting. Match that quality without raising the fidelity target. Coastal settlements, jungle, volcanic terrain and the magical grove retain their own colors, vegetation, architecture and atmosphere.

Windward Farm is shipped and validated at `8b66888`; that records implementation and QA completion, without implying a separate explicit aesthetic approval. Existing gameplay, character art, controls, objectives and UI stay intact.

## Milestones

| Order | Area | Status | Implementation / evidence |
| --- | --- | --- | --- |
| 1 | The Old Watch pilot | Complete | `2c2d3fe`; explicit user style approval; reproducible original kit. |
| 2 | Windward Farm and Old Watch connector | Complete | `8b66888`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 3 | Tideglass Market and central Haven | In progress | Implementation and QA complete; publication and Docker verification pending. |
| 4 | Saltwind Harbor, Driftwood Yard and Sunwake Strand | Planned | Coastal working waterfront and beach identity. |
| 5 | Palmheart Camp and Wilds | Planned | Jungle settlement and vegetation identity. |
| 6 | Cinderworks and Emberpeak | Planned | Volcanic architecture, terrain and atmosphere. |
| 7 | Moonwatch and Moonbloom | Planned | Magical grove architecture, vegetation and atmosphere. |
| 8 | Island-wide landscape, shoreline, distant detail and performance | Planned | Transitions, distant composition and total island finishing. |

## Active handoff

- **Active milestone:** Tideglass Market and central Haven — in progress, 2026-09-05.
- **Scope:** Weathered market cottage, fruit/sailcloth stalls, the two existing central-Haven huts, market square and immediate connecting paths/planting. Preserve gameplay and later coastal regions.
- **Source state:** Started from `8890454`; concurrent unrelated pickup work was committed and pushed as `be58b78`, now the implementation base on `main`. Preserve that history. Only milestone art/runtime/tests and documentation are being changed.
- **Deployment at start:** Docker service and `/health` healthy at `be58b78`; 13 served environment assets matched committed source, and the persistent volume mount was recorded.
- **Completed work:** Original cottage/stalls/huts, bounded ground/planting/paving and cached runtime integration are complete. Walking, close, interior, aerial, glider, low/reduced and asset-failure views passed review. Five-client gameplay checked both doors, chests, cutaway and the connecting trail. All three kits independently regenerated with identical GLB/manifest bytes. Final full suite passed 152 tests; diff and independent implementation review passed. Detailed measurements and recreation instructions are in the pipeline.
- **Remaining work:** Commit and push the completed implementation, deploy Docker, verify health, served hashes and deployed browser views, then record actual publication evidence here.
- **Known blocker:** None. No environment changes were in progress at start.
- **Next action:** Publish and verify this milestone, update the completed handoff, and stop with milestone 4 still planned.

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

- **Shared gameplay/layout:** `shared/exploration.js`, `shared/world.js`, `shared/old-watch.js`, `shared/windward-farm.js`. Use the actual target buildings, trails, resident routes, doors and loot.
- **Runtime integration:** `client/world.js`, `client/settlement.js`, `client/environment-assets.js`, `client/environment-lighting.js`, `client/environment-geometry.js`, `client/old-watch.js`, `client/windward-farm.js`.
- **Editable assets:** `tools/environment_kit.py`, `tools/build-old-watch.py`, `tools/build-windward-farm.py`, and each kit's tracked manifest in `client/assets/`.
- **Regression coverage:** `test/old-watch.test.js`, `test/windward-farm.test.js`, `test/environment.test.js`, plus target-area gameplay tests.

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

**Windward Farm — `8b66888`, 2026-09-05:** committed and pushed to canonical `main`; local Docker deployment healthy; 13 browser-asset hashes matched committed source. Full `npm.cmd test` passed **130 tests**, and `git diff --check` passed. Both kits independently regenerated with matching GLB and manifest bytes. Old Watch's approved GLB remained unchanged.

Farm adds 2,459,180 GLB bytes and no texture images. Combined unique environment GLBs total **10,043,800 bytes**, with **9,786,696 bytes** estimated decoded RGBA8 textures plus full mip chains. Fixed-render five-player comparisons ran around **57 FPS / 18.2ms p95** on this host; a populated live sample measured **56.63 FPS / 18.2ms p95**. Farm triangles and draw calls increased materially. These are measured comparisons, not a guarantee for other hardware or permission to multiply the same cost island-wide; exact fixture/population settings and before/after costs are in [the pipeline QA record](ENVIRONMENT_PIPELINE.md#windward-farm-milestone-qa--2026-09-05).

Validated walking/interactions, both barn doors in both directions, furnished cutaway, rotating sails, the connecting trail, low/reduced settings, aerial views and shared/Farm asset failure fallback. Visual review found and fixed floating hay and the mill cap underside slit. No unexpected console/network errors remained. Later regions are still planned.
