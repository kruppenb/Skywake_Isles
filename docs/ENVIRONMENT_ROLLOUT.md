# Environment art rollout and handoff

This is the authoritative progress tracker for the environment rollout. With this repository open, the user can say **“upgrade next zone”** in a fresh window. Follow [AGENTS.md](../AGENTS.md), resume any in-progress milestone below, or start the first planned milestone. Complete one milestone per request; do not automatically start the following one. No previous conversation or local `.qa` files are required to resume.

## Visual direction

Old Watch is the approved visual benchmark. At commit `2c2d3fe`, the user explicitly approved it: “this is great, excellent style and quality.” Carry its moderate-fidelity weathering across the island: worn masonry, aged timber, moss, natural vegetation, textured ground, readable paths and restrained atmospheric lighting. Match that quality without raising the fidelity target. Coastal settlements, jungle, volcanic terrain and the magical grove retain their own colors, vegetation, architecture and atmosphere.

Windward Farm is shipped and validated at `8b66888`, Tideglass Market / central Haven at `2e2bc1d`, and Saltwind Harbor at `b8960c9`; these record implementation and QA completion, without implying separate explicit aesthetic approvals. Existing gameplay, character art, controls, objectives and UI stay intact.

**Every area keeps the style, not the colours.** What the island shares is the construction and weathering language: beveled blocks, vertex wear, metric UVs, stone footings, paired clear doors, restrained fidelity and the one lighting owner. What must change is the area's palette card — wall treatment, trim, roof colour, accent props, ground and light. Before modelling, write that card and compare it with the shipped table in the pipeline's [Area identity contract](ENVIRONMENT_PIPELINE.md#area-identity-contract): a new area may not reuse another area's wall treatment + roof colour pair, and neighbouring buildings inside one area should differ from each other as well (the harbor's three buildings use three sidings and three roofs). Open coast and beach are lighter and airier than the northern ruins; do not carry Old Watch's gloom everywhere.

## Milestones

| Order | Area | Status | Implementation / evidence |
| --- | --- | --- | --- |
| 1 | The Old Watch pilot | Complete | `2c2d3fe`; explicit user style approval; reproducible original kit. |
| 2 | Windward Farm and Old Watch connector | Complete | `8b66888`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 3 | Tideglass Market and central Haven | Complete | `2e2bc1d`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 4 | Saltwind Harbor | Complete | `b8960c9`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 5 | Driftwood Yard and Sunwake Strand | Planned — next | Boatyard timber-stack identity and a lighter open-beach landing; both must read differently from the harbor next door. |
| 6 | Palmheart Camp and Wilds | Planned | Jungle settlement and vegetation identity. |
| 7 | Cinderworks and Emberpeak | Planned | Volcanic architecture, terrain and atmosphere. |
| 8 | Moonwatch and Moonbloom | Planned | Magical grove architecture, vegetation and atmosphere. |
| 9 | Island-wide landscape, shoreline, distant detail and performance | Planned | Transitions, distant composition and total island finishing. |

## Active handoff

- **Active milestone:** None. Milestone 4 is complete; milestone 5 has not started.
- **Latest shipped environment implementation:** `b8960c9` on canonical GitHub `main`.
- **Last confirmed deployment:** Local Docker game at `http://localhost:3400`, healthy after the Saltwind deployment on 2026-09-06 (`All **18** checked served browser assets — every changed client module, the shared gameplay modules and all four kit GLBs — matched `git show HEAD:<path>` by SHA-256 (manifests are not served: the game server answers 404 for them and only the GLBs are fetched).`). Recheck current reality before working.
- **Next objective:** Bring Driftwood Yard (shipwrights' cottage, timber shed, the hull under repair and timber stacks) and the Sunwake Strand landing (pier, banners, beach dressing) to the approved material quality with their own palette cards — raw boatyard timber and pitch for the yard, pale open sand and bleached driftwood for the strand — distinct from the harbor's grey/cream/white sheds next door. Preserve the landing dock, spawn approach, routes, residents, loot and collision; later regions remain planned.
- **Known blocker:** None recorded. The harbor's generic fishing skiffs and the large rock beside the net-house are retained original scenery and are candidates for milestone 5 or 9, not defects.
- **Next action:** Read the sources below, inspect repository/remote/deployment state, write the two palette cards against the identity table, and capture walking, close and aerial baselines for the yard and strand plus the finished harbor as the comparison view. Complete only milestone 5 on the next request.

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

- **Shared gameplay/layout:** `shared/exploration.js`, `shared/world.js`, `shared/old-watch.js`, `shared/windward-farm.js`, `shared/tideglass-market.js`, `shared/saltwind-harbor.js`. Use the actual target buildings, trails, resident routes, doors and loot.
- **Runtime integration:** `client/world.js`, `client/settlement.js`, `client/environment-assets.js`, `client/environment-lighting.js`, `client/environment-geometry.js`, `client/old-watch.js`, `client/windward-farm.js`, `client/tideglass-market.js`, `client/saltwind-harbor.js`.
- **Editable assets:** `tools/environment_kit.py`, `tools/build-old-watch.py`, `tools/build-windward-farm.py`, `tools/build-tideglass-market.py`, `tools/build-saltwind-harbor.py`, and each kit's tracked manifest in `client/assets/`.
- **Regression coverage:** `test/old-watch.test.js`, `test/windward-farm.test.js`, `test/tideglass-market.test.js`, `test/saltwind-harbor.test.js`, `test/environment.test.js`, plus target-area gameplay tests.

## One-milestone resume workflow

1. Read this tracker and repository instructions. Inspect the working tree, branch, recent commits and canonical remote history; preserve unrelated changes and later commits. Check Docker's current service, `/health` and deployed source before assuming the recorded deployment is still current.
2. Resume an in-progress milestone first. Otherwise use the first planned row, unless the user's current request changes the scope. Update the active handoff with the chosen objective and source state.
3. Capture the target area's existing walking, close and aerial views and a finished-area comparison. Record repeatable camera/quality/population settings and a warm performance baseline. State a concise implementation plan.
4. Implement only that milestone and the shared infrastructure it actually needs. Preserve existing IDs, append any necessary new IDs, use shared collision/layout data, keep routes/chests/both doorway approaches clear, and preserve the original procedural RNG stream. Overlays must match the alternating 2m rendered terrain triangles. Reuse the shared asset cache and single lighting owner; preserve visible fallback, atomic installation and exact-once resource disposal. Follow the pipeline's detailed constraints.
5. Complete the quality gates below, review the diff, then commit, push canonical `main` without force, deploy with `docker compose up -d --build --wait`, and verify service/health/served hashes under [AGENTS.md](../AGENTS.md). Routine completion is already authorized. Preserve `skywake-data` and other projects' containers.
6. Update this tracker with actual checks, implementation commit, push/deployment evidence, remaining limitations and the next handoff. Include the final tracking update in the authorized commit/push/deployment workflow. Report the result and stop; leave the next milestone planned.

## Quality gates and evidence to retain

- Compare against Old Watch at walking distance, close range and aerial/glider approach. Inspect interiors, animated parts, structural joins, terrain seams, path readability, vegetation placement and transition boundaries.
- Compare the area's palette card against every shipped row of the pipeline's identity table, in the running game rather than the offline preview: the shared textures are dark and the engine's light is different from Cycles, so judge brightness and hue only in the actual third-person camera next to an already-finished kit.
- Verify ordinary multiplayer movement/interactions and collision, both doors, cutaway/restoration, low graphics, reduced motion and deliberate asset-load failure. Check console and network failures.
- Regenerate assets in independent background Blender processes, preserving the user's interactive scene. Verify exported bounds/attributes/material bindings/manifests and byte reproducibility; commit original generators, assets, manifests and provenance together. Retain outward-winding and shared-resource regressions.
- Track unique download bytes, estimated decoded texture memory, visible renderer triangles/draw calls and comparable warm frame times. Include a populated gameplay view and its limitations. Per-kit ceilings do not allocate that cost to every later area; retain instancing, bounded batches and distance/quality detail reductions.
- Run relevant checks, full `npm.cmd test` for gameplay/network/rendering changes, and `git diff --check`. Record actual results. Verify pushed commit, `docker compose ps`, `/health`, and changed client assets served from the URL root against committed source.
- Keep the concise durable evidence here and detailed methods/measurements in the pipeline. Never commit credentials, saves, dependencies, previews, logs or QA output.

## Latest completed milestone evidence

**Saltwind Harbor — `b8960c9`, 2026-09-06:** committed and pushed to canonical `main`; `docker compose up -d --build --wait` succeeded, `docker compose ps` reported healthy, and `/health` returned `ok: true`. `All **18** checked served browser assets — every changed client module, the shared gameplay modules and all four kit GLBs — matched `git show HEAD:<path>` by SHA-256 (manifests are not served: the game server answers 404 for them and only the GLBs are fetched).` The persistent volume mount was unchanged. Full `npm.cmd test` passed **161 tests** (nine harbor regressions added), and `git diff --check` passed. The harbor kit regenerated byte for byte (GLB `26b6fb73…bff51`); Old Watch, Farm and Tideglass assets remain unchanged.

The milestone replaces the harbor's three enterable buildings — the net-house, the tavern and the fisher's cottage, each with its own siding, trim and roof colour — plus its four original work sites (mending table, crates and barrel, net frame, lantern), and adds mooring pilings, lobster pots, a pale sand overlay with shell-grit routes, straw dune grass and an airier lighting profile. The original geometry adds **3,263,132 GLB bytes** (35,510 source triangles, 103 primitives) and no texture images. Combined unique environment GLBs total **15,326,172 bytes**, retaining **9,786,696 bytes** estimated decoded texture memory. At the fixed tavern-front comparison view the deployed build measured **56.9 fps / 18.4ms p95, 670 calls, ≈807k renderer triangles** against the baseline's **56.8 fps / 18.3ms, 646 calls, ≈786k** — a single live player, vsync-bound; details in [the pipeline QA record](ENVIRONMENT_PIPELINE.md#saltwind-harbor-milestone-qa--2026-09-06).

Validated walking views of all three buildings, cottage and tavern close-ups, the tavern interior cutaway with its chest interaction, the aerial glide-in, low graphics and a clean console; reduced motion and both asset-failure paths are covered by the harbor test file. Visual review found the first pass far too dark in the engine (unlike the Cycles preview) and corrected it by raising wall multipliers to the 5–10 range with reduced normal scale, then pushed both painted roofs to true coral against the bluish slate base. Milestone 5 remains planned.

### Previous milestone

**Tideglass Market and central Haven — `2e2bc1d`, 2026-09-05:** committed and pushed to canonical `main`; Docker healthy; all **16** checked browser environment assets matched committed source. Full `npm.cmd test` passed **152 tests**. The milestone replaced the market cottage, two stalls and two closed Haven huts with bounded ground, paving and coastal planting, adding **2,019,240 GLB bytes**; five-player fixed-render views measured **17.65–17.81ms mean / 18.2–18.6ms p95**. Fixtures and costs are in [the pipeline QA record](ENVIRONMENT_PIPELINE.md#tideglass-implementation-qa--2026-09-05).
