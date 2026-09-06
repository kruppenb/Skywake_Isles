# Environment art rollout and handoff

This is the authoritative progress tracker for the environment rollout. With this repository open, the user can say **“upgrade next zone”** in a fresh window. Follow [AGENTS.md](../AGENTS.md), resume any in-progress milestone below, or start the first planned milestone. Complete one milestone per request; do not automatically start the following one. No previous conversation or local `.qa` files are required to resume.

## Visual direction

Old Watch is the approved visual benchmark. At commit `2c2d3fe`, the user explicitly approved it: “this is great, excellent style and quality.” Carry its moderate-fidelity weathering across the island: worn masonry, aged timber, moss, natural vegetation, textured ground, readable paths and restrained atmospheric lighting. Match that quality without raising the fidelity target. Coastal settlements, jungle, volcanic terrain and the magical grove retain their own colors, vegetation, architecture and atmosphere.

Windward Farm is shipped and validated at `8b66888`, Tideglass Market / central Haven at `2e2bc1d`, Saltwind Harbor at `b8960c9`, and Driftwood Yard / Sunwake Strand at `668ec8c`; these record implementation and QA completion, without implying separate explicit aesthetic approvals. Existing gameplay, character art, controls, objectives and UI stay intact.

**Every area keeps the style, not the colours.** What the island shares is the construction and weathering language: beveled blocks, vertex wear, metric UVs, stone footings, paired clear doors, restrained fidelity and the one lighting owner. What must change is the area's palette card — wall treatment, trim, roof colour, accent props, ground and light. Before modelling, write that card and compare it with the shipped table in the pipeline's [Area identity contract](ENVIRONMENT_PIPELINE.md#area-identity-contract): a new area may not reuse another area's wall treatment + roof colour pair, and neighbouring buildings inside one area should differ from each other as well (the harbor's three buildings use three sidings and three roofs). Open coast and beach are lighter and airier than the northern ruins; do not carry Old Watch's gloom everywhere.

## Milestones

| Order | Area | Status | Implementation / evidence |
| --- | --- | --- | --- |
| 1 | The Old Watch pilot | Complete | `2c2d3fe`; explicit user style approval; reproducible original kit. |
| 2 | Windward Farm and Old Watch connector | Complete | `8b66888`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 3 | Tideglass Market and central Haven | Complete | `2e2bc1d`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 4 | Saltwind Harbor | Complete | `b8960c9`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 5 | Driftwood Yard and Sunwake Strand | Complete | `668ec8c`; pushed to canonical `main`, Docker deployed and verified; evidence below. |
| 6 | Palmheart Camp and Wilds | Planned — next | Jungle settlement and vegetation identity: hardwood and woven palm, distinct from every coastal row. |
| 7 | Cinderworks and Emberpeak | Planned | Volcanic architecture, terrain and atmosphere. |
| 8 | Moonwatch and Moonbloom | Planned | Magical grove architecture, vegetation and atmosphere. |
| 9 | Island-wide landscape, shoreline, distant detail and performance | Planned | Transitions, distant composition and total island finishing. |

## Active handoff

- **Active milestone:** None. Milestone 5 is complete; milestone 6 has not started.
- **Latest shipped environment implementation:** `668ec8c` on canonical GitHub `main`.
- **Last confirmed deployment:** Local Docker game at `http://localhost:3400`, healthy after the Driftwood deployment on 2026-09-06: all **22** checked served browser assets — every changed client module, the concurrent loot modules, the shared gameplay modules and all five kit GLBs — matched `git show HEAD:<path>` by SHA-256 after CRLF normalization (manifests are not served; only the GLBs are fetched). The `skywake-isles_skywake-data` volume mount was preserved. Recheck current reality before working.
- **Next objective:** Bring Palmheart Camp (the trailkeepers' tent, the fire ring and the crate-and-flag work site, Bram's loop and chest-23) and the immediate Palmheart Wilds vegetation (the jungle region's broadleaf canopy and ground plants around the camp and the shrine approach) to the approved material quality with their own palette card — jungle hardwood, woven palm and lashed poles, deeper green and humid light — distinct from every coastal row. The tent is a non-enterable `tent` kind (radius 3, height 4.3), so it has no cutaway contract; the Palmheart Shrine, its objective ring, the primary shrine route and the encounter group at `(-88, 12)` must stay clear.
- **Known blocker:** None recorded. Two other sessions pushed gameplay commits to `main` during milestone 5; this checkout may be shared, so inspect `git status` and `git log origin/main` before editing, stage by explicit path, and never stash while agents write untracked files. The harbor rock and skiffs and the pier's level seaward end remain candidates for milestone 9.
- **Next action:** Read the sources below, inspect repository/remote/deployment state, write the Palmheart palette card against the identity table, and capture walking, close and aerial baselines for the camp and shrine approach plus a finished coastal area as the comparison view. Complete only milestone 6 on the next request.

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

- **Shared gameplay/layout:** `shared/exploration.js`, `shared/world.js`, `shared/old-watch.js`, `shared/windward-farm.js`, `shared/tideglass-market.js`, `shared/saltwind-harbor.js`, `shared/driftwood-yard.js`. Use the actual target buildings, trails, resident routes, doors and loot.
- **Runtime integration:** `client/world.js`, `client/settlement.js`, `client/environment-assets.js`, `client/environment-lighting.js`, `client/environment-geometry.js`, `client/old-watch.js`, `client/windward-farm.js`, `client/tideglass-market.js`, `client/saltwind-harbor.js`, `client/driftwood-yard.js`.
- **Editable assets:** `tools/environment_kit.py`, `tools/build-old-watch.py`, `tools/build-windward-farm.py`, `tools/build-tideglass-market.py`, `tools/build-saltwind-harbor.py`, `tools/build-driftwood-yard.py`, and each kit's tracked manifest in `client/assets/`.
- **Regression coverage:** `test/old-watch.test.js`, `test/windward-farm.test.js`, `test/tideglass-market.test.js`, `test/saltwind-harbor.test.js`, `test/driftwood-yard.test.js`, `test/environment.test.js`, plus target-area gameplay tests.

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

**Driftwood Yard and Sunwake Strand — `668ec8c`, 2026-09-06:** committed and pushed to canonical `main` (rebased onto two concurrent gameplay commits, `a092317` and `30dda43`, from other sessions); `docker compose up -d --build --wait` succeeded, `docker compose ps` reported healthy, and `/health` returned `ok: true`. All **22** checked served browser assets — every changed client module, the concurrent loot modules, the shared gameplay modules and all five kit GLBs — matched `git show HEAD:<path>` by SHA-256 after CRLF normalization (manifests are not served; only the GLBs are fetched). The `skywake-isles_skywake-data` volume mount was unchanged. Full `npm.cmd test` passed **177 tests** on the milestone tree (ten yard regressions added) and **189** on the rebased `main`; `git diff --check` passed. The yard kit regenerated byte for byte (GLB `5d73fa9f…290b`, manifest `1d6a7fff…fd0a`); Old Watch, Farm, Tideglass and Saltwind assets remain unchanged.

The milestone replaces both yard buildings — the raw honey weatherboard timber shed with pitch-black trim and tarred, battened roof boards, and the oxblood clinker shipwright's cottage with bleached trim and silver shingles — plus the three original work sites (hull, timber stack, lantern), adds a sawhorse bench, pitch kettle and second stack by clearance, and replaces the Sunwake landing's dock, flag poles, pennants and crates with a terrain-following pier, banner poles, a swaying sailcloth pennant line and rope-tied crates, adding a signpost, driftwood logs, sea-oat grass, two ground overlays and two lighting profiles. The original geometry adds **2,432,348 GLB bytes** (26,569 source triangles, 82 primitives) and no texture images. Combined unique environment GLBs total **17,758,520 bytes**, retaining **9,786,696 bytes** estimated decoded texture memory. Five-player fixed views measured **16.67ms mean / 16.8ms p95** before and after (vsync-bound), with the yard rising **118 → 163 calls / 309k → 335k triangles** and the strand **174 → 223 calls / 348k → 392k**; details in [the pipeline QA record](ENVIRONMENT_PIPELINE.md#driftwood-yard-and-sunwake-strand-milestone-qa--2026-09-06).

Validated walking views of both buildings, the hull and timber stack close-ups, both interior cutaways with their chests, the strand landing, pier, banner line and crate, the harbor comparison, both aerials and the glider approach with a clean console and network log; reduced motion, low-quality thinning, pennant double-siding and both asset-failure paths are covered by the yard test file. Visual review corrected blue-grey shingles and orange clinker to warm silver and deep oxblood, and the first export was slimmed from 4.9MB to 2.4MB before shipping. During this milestone another session's commit accidentally swept in-progress `client/world.js` hunks and broke the deployment until `9886cb4` removed them; stage by explicit path in this shared checkout. Milestone 6 remains planned.

### Previous milestone

**Saltwind Harbor — `b8960c9`, 2026-09-06:** committed and pushed to canonical `main`; Docker healthy; all **18** checked browser environment assets matched committed source. Full `npm.cmd test` passed **161 tests**. The milestone replaced the harbor's three enterable buildings and four work sites and added pilings, lobster pots, a sand overlay, dune grass and an airier lighting profile, adding **3,263,132 GLB bytes**; the fixed tavern-front view measured **56.9 fps / 18.4ms p95, 670 calls** against **56.8 fps / 18.3ms, 646 calls**. Fixtures and costs are in [the pipeline QA record](ENVIRONMENT_PIPELINE.md#saltwind-harbor-milestone-qa--2026-09-06).
