# Skywake Isles environment pipeline

Old Watch is the first playable environment sample for a weathered northern coastal art direction. The kit uses original mossy gray-green masonry, silvered timber, dark overlapping slate, irregular fir boughs, tawny grass and pinnate ferns. Warm lantern glass provides a small point of contrast. It is an original style study, with no assets copied from Skyrim or another game.

Windward Farm and its Old Watch connector are the second area. They carry that approved material quality into a working farm: aged limewash over stone, warm barn timber, muted russet roofing, turning framed sails, golden crops, leafy vegetables and worn field edges. The visual benchmark remains Old Watch; later regions should retain their own vegetation, architecture and atmosphere at this fidelity.

Tideglass Market and immediate central Haven are the third area: pale weathered plaster, aged timber, teal tile roofs, coral and teal canvas, market stock, sandy walking routes and restrained broadleaf planting. The existing market cottage, two stalls and two closed Haven huts receive authored geometry. Original palms, residents, furniture, lighthouse, objectives and gameplay layout remain intact.

## Build and inspect

The editable sources are `tools/build-old-watch.py`, `tools/build-windward-farm.py` and `tools/build-tideglass-market.py`. Shared deterministic mesh construction, metric UVs, vertex colors, material creation, tileable-noise helpers and glTF export live in `tools/environment_kit.py`. Each area retains its explicit models, seed, layout contract and exported bounds validation. Old Watch exports the self-contained shared library; Farm and Tideglass export uncompressed glTF 2 geometry extensions. The generators need Blender 5.2 or a compatible newer Blender with its bundled NumPy and glTF exporter; they do not need downloaded assets, image libraries, an asset CDN, or a running game server.

From the repository root in PowerShell:

```powershell
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-old-watch.py
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-windward-farm.py
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-tideglass-market.py
```

Use a different Blender executable path where appropriate. `--background --factory-startup` starts an independent process and never touches an artist's open Blender scene. To render an optional inspection image outside the shipping asset directory:

```powershell
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-old-watch.py -- --preview .qa/old-watch-kit-preview.png
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-windward-farm.py -- --preview .qa/farm-kit-preview.png
```

To compare a regeneration without overwriting shipping output:

```powershell
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-old-watch.py -- --output .qa/old-watch-regenerated
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-windward-farm.py -- --output .qa/farm-regenerated
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-tideglass-market.py -- --output .qa/tideglass-regenerated
```

Each seed is fixed. Keep the Blender/exporter version fixed when comparing binary hashes; exporter versions can change the binary representation. `--python-exit-code 1` makes validation errors fail the CLI process. Commit the source generator, area's `client/assets/<area>/kit.glb` and regenerated `manifest.json` together. Keep previews, build logs, temporary textures and Python cache files out of commits. All kits load from `/assets/<area>/kit.glb` on the same local server as the game. Farm and Tideglass accept `--preview <ignored-output.png>` and bind generated shared materials only after export, so preview textures never enter their shipping GLBs.

Helper extraction preserved the approved Old Watch binary and manifest byte for byte under Blender 5.2.1 LTS. Its GLB SHA-256 remains `3fce2c1f50178bf0a681fdec6aafba86b98140cc108ce6ae522b45e6370f152b`. Independent Farm regeneration also matches its shipping GLB and manifest; use each manifest's hash as the authoritative asset version.

## Asset contract

Units are meters. Authoring helpers accept game coordinates: X right, Y up, +Z forward. They convert to Blender's Z-up coordinates before exporting Y-up glTF. Every prefab root and its children have identity transforms, with geometry already in the building or prop's ground-centered frame. Front doors face +Z. The runtime supplies position, yaw and instance scale.

| Root nodes | Purpose and envelope |
| --- | --- |
| `watch_tower` | Solid tower, radius under 3m, height under 10m; closed arched door, slit recesses, buttress feet, worn parapet and warm lantern. |
| `barracks_base` | 4.26 × 3.54m floor and low stone perimeter; two clear centered 2.30m doors. |
| `barracks_wall_east`, `barracks_wall_west` | Individually removable long walls, up to 3.20m; timber infill, stone base and recessed leaded windows. |
| `barracks_wall_front`, `barracks_wall_back` | Individually removable end walls; 2.30m clear width below the 2.80m header. |
| `barracks_roof` | Separate gable/rafters/slate assembly, under 4.60 × 3.90m and 5.50m total height. |
| `ruin_wall` | Broken mossy wall, approximately 4.20 × 0.65 × 1.95m including the buried base. |
| `rock_a`, `rock_b` | Two shaped boulders within 1m horizontal radius, from -0.25m to at most 1.25m. |
| `pine_a`, `pine_b` | 8m / 10m trees, 0.28m / 0.32m nominal trunk radii; irregular modeled boughs rather than cone stacks. |
| `grass_clump`, `fern_clump` | Curved tapered grass and arching paired fern leaflets; merged geometry for instancing. |
| `ground_sample` | Material carrier for `ground_earth`; hidden by the runtime, which reuses its textures for the terrain overlay. |

Each prefab contains one merged mesh per material. The separate barracks parts share the same building frame: do not recenter each face or place furniture in those roots. Existing gameplay furnishings and the existing cutaway controller are retained by the runtime.

`manifest.json` records exported bounds, radius, triangle and primitive counts, materials, texture dimensions, file size and SHA-256. The generator checks names, identity transforms, embedded resources, UVs, vertex colors, finite positions, footprint/height limits, door clearance and the hard size/triangle budgets against the exported GLB, rather than only against the source objects.

The Farm extension has these additional roots, using the same identity-transform convention:

| Root nodes | Purpose and envelope |
| --- | --- |
| `windmill_body` | Tapered worn plaster, exposed fieldstone, timber hoops, closed door and russet tiled cap; foundation to -0.65m, visible top 11.75m, within the existing 3.40m radius. |
| `windmill_sails` | Four framed, modeled sails, centered on the rotor origin; rotation in local XY, sweep under 2.48m. Mount at mill-local `(0, 7.82, 2.108)`. |
| `barn_base` | 4.97 × 4.13m floor and low masonry; floor top 0.025m, no threshold across either doorway. |
| `barn_wall_east`, `barn_wall_west`, `barn_wall_front`, `barn_wall_back` | Four complete removable faces, with braces, vents and 3.48m wall height; both centered 2.30 × 2.80m doors remain clear. |
| `barn_roof` | Separate gables, rafters, sealed roof planes and russet tiles; about 5.20 × 4.47m, under the 6m building envelope. |
| `crop_wheat`, `crop_leafy` | Seven-stalk wheat clump and modeled broad leaves; one material primitive each, heights under 0.90m / 0.50m. |
| `fence_section`, `hay_bale` | Two-meter split-rail span with buried posts and a tied, textured hay stack; original geometry. |

The Farm manifest additionally declares the shared kit dependency, named `materialBindings`, zero embedded images, zero added decoded texture memory and the rotor pivot. Export checks validate those contracts and the full paired doorway prisms. Shared rock outward winding remains protected by the signed-volume regression in `test/old-watch.test.js`, including rocks reused as flattened paving.

Tideglass uses eleven additional identity-transform roots:

| Root nodes | Purpose and envelope |
| --- | --- |
| `cottage_base` | 4.544 × 3.776m timber floor and backed stone perimeter; floor top .025m, base top .48m; paired 2.30m doors remain clear. |
| `cottage_wall_east`, `cottage_wall_west`, `cottage_wall_front`, `cottage_wall_back` | Independently removable plaster/timber faces between .48 and 3.20m, including recessed shutters and door headers above 2.80m. |
| `cottage_roof` | Sealed gable/underside, overlapping teal tiles and ridge; from 3.20 to 5.491m, within .16m overhangs. |
| `fruit_stall`, `sailcloth_stall` | Timber stock cabinets, tied double-surface sagging/scalloped canvas and distinct produce/rolled cloth. Foundation -.50m, top 3.44m, radius under the existing 2.50/2.40m colliders. |
| `haven_hut` | Closed timber door, shutters, worn plaster/stone and teal roof; foundation -.50m, top 4.841m, radius 2.962m inside the original 3.20m collider. |
| `paving_slab` | Convex outward-wound 28-triangle stone, radius under .55m, top under .035m. Runtime instances fit local terrain slopes. |
| `coastal_shrub` | Sixteen modeled broad leaves/stems, 576 triangles in one primitive, under .50m radius and .80m height. |

The Tideglass exporter clips complete triangles against both open doorway prisms, validates normals/UVs/vertex colors, identity transforms, bounds, shared dependency hash, size and zero images. Tests independently check triangle/door intersections, roof underside coverage, every paving face's outward direction and runtime building footing/height envelopes. The two hut yaws are taken after their original RNG draws; no gameplay IDs or colliders are added.

## Materials and texture scale

Five small original texture families are shared: stone, timber, slate, earth and foliage. Stone, timber and earth use 512 × 512 base color and normal maps; slate and foliage use 256 × 256. They are tileable and embedded in the GLB. Base color is sRGB. Tangent-space normal maps are linear/non-color, with glTF's +Y convention; normal pixels use six-bit precision per channel to keep the asset compact. Roughness is a material scalar, not a painted shadow map. No directional light or ambient occlusion is baked into the textures.

Explicit metric UVs provide approximately meter-scale masonry/soil detail and longitudinal timber grain over roughly 2.2m of beam length. Vertex colors add per-stone variation, moss near damp ground and color variation in vegetation. Preserve `COLOR_0` when changing the exporter. Each geometric blade or needle spray has a modeled outline; there are no transparency cards or alpha sorting dependencies. Foliage is double-sided; masonry, timber and bark use outward-facing surfaces.

Farm reuses those texture families with explicit named slots. `watch_stone`, `aged_timber`, `forged_iron` and `recess_shadow` retain the source material; `farm_plaster`, `farm_roof`, `crop_straw`, `crop_leaf` and `hay_straw` clone the corresponding shared material with linear color multipliers recorded in the manifest. UVs and `COLOR_0` still provide scale and individual weathering. Multipliers above one deliberately brighten the darker shared surfaces for limewash and straw. Do not treat these linear multipliers as sRGB display colors.

Tideglass also clones named shared materials without copying their textures. Its manifest records the exact brighter linear multipliers for plaster, timber, cream/coral/teal canvas, teal roofs, foliage and produce. Plaster normal scale is .28 and canvas .18; canvas has modeled reverse faces so its underside survives binding to the shared front-sided earth material. Gameplay review, rather than the offline preview alone, determined the brighter coastal palette. Clones remain owned by their area and never dispose borrowed textures.

## Shared ownership and total cost

`client/environment-assets.js` owns local GLB loads and decoded resources. Area controllers acquire leases, share the in-flight promise and source geometry/material/texture/ImageBitmap ownership, then release idempotently. Area-created material clones retain borrowed textures; releasing a clone must not dispose the shared maps. Staged instances are installed atomically, and failed or late completion cleans up area resources before releasing source leases. Legacy building and scenery batches remain visible until the full area is ready; failed loading leaves a playable fallback.

Old Watch's existing GLB is the first shared library. It is loaded once per live cache even when both controllers need it. Farm depends on that entire library, including the original building geometry; this milestone does not split it into independent prop/texture downloads or ship distance-triggered asset streaming. A later measured need can justify splitting the library while maintaining the ownership contract. Copying the complete Old Watch kit into another area is not the extension pattern.

| Shipping kit | GLB bytes | Source triangles | Material primitives | Embedded images | Added decoded RGBA8 + full mip chain estimate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shared Old Watch | 7,584,620 | 59,078 | 33 | 10 | 9,786,696 bytes |
| Windward Farm additions | 2,459,180 | 26,740 | 30 | 0 | 0 bytes |
| Tideglass Market additions | 2,019,240 | 22,258 | 45 | 0 | 0 bytes |
| Unique combined total | 12,063,040 | 108,076 | 108 | 10 | 9,786,696 bytes |

These are download/source costs, not triangles or draw calls in a gameplay frame. Source parts are reused and instanced, and shadows can draw a visible mesh again. The texture estimate excludes browser decode copies, driver allocation overhead, render targets and other game textures. `world.getStats()` exposes renderer triangles/calls alongside `environmentAssets`, `oldWatch`, `windwardFarm` and `tideglassMarket` loading/installation statistics; measure warm views and populated gameplay as the rollout grows.

Old Watch's 8MiB/120k-triangle ceiling remains a per-kit failure guard. Farm's additions stay below 2.5MiB and 32k source triangles. Neither limit is an island-wide budget allocation. The present tradeoff retains uncompressed meshes and ten original PNG images. Small Farm foliage/field detail uses spatially bounded instance batches and distance/quality reductions; architecture remains visible at distance for ship and glider approaches. Avoid multiplying material draw calls by creating a separate object for every stone, tile or frond.

Tideglass's guard is 2.3MiB and 24k source triangles. Its 190 grass clumps, 32 shrubs and 69 low-poly pavers use 46 bounded detail meshes with 16m cells. High/low detail distance is 105/65m; low quality uses 42% of plant instances, and distant high-quality planting uses 65%. Architecture remains visible for aerial approaches. The three loaded kits share five leases and the same ten texture images. These per-area guards still do not authorize multiplying the same cost across the island.

## Placement, collision and lighting

`shared/old-watch.js` owns stable authored pine and rock placements and their collision data. `shared/world.js` appends those colliders without changing existing obstacle indices. Gameplay collision is sourced from these shared shapes, not inferred from GLB visuals. Keep trunk/rock silhouettes inside the corresponding collision envelopes after runtime scaling, and keep resident routes, loot, both doors and the route to the farm clear.

`shared/windward-farm.js` derives the connector from the existing exploration trails and owns deterministic field, fence and planting clearance. Building IDs, obstacle IDs, resident loops, chests and doors remain authoritative in shared gameplay data. Farm adds no blocking obstacles: its small surface stones are walkable and fences retain the existing cosmetic semantics. Existing procedural scenery consumes the original RNG stream before routing the two areas' fallback batches, preserving unrelated regional placement.

`client/environment-geometry.js` owns the actual rendered-height helper. Ground overlays follow the alternating triangles of the existing 2m terrain grid, with smooth vertex-alpha boundaries and no new gameplay elevation. Do not sample only the analytical height function or assume every cell uses the same diagonal. Small plants use seeded instanced placement; low quality reduces decorative density/draw distance, and reduced motion freezes sway and the original mill animation convention. Barn furnishings and its existing paired-door/cutaway behavior are retained when authored faces and roof install.

`client/environment-lighting.js` is the single owner of global sky, fog, hemisphere and sunlight. It captures an immutable baseline, blends normalized overlapping area weights and restores the baseline outside the areas and aboard ship. Old Watch's center profile stays the approved profile. A ready Farm adds a restrained warmer profile along the field and connector; Old Watch's former Farm lighting exclusion is removed only when Farm is ready. Farm failure keeps the original exclusion and baseline transition. Area animation controllers do not compete to write global lighting each frame.

`shared/tideglass-market.js` bounds the market and immediate Haven dressing and excludes primary/exploration paths, resident loops, both cottage approaches, loot, work props and the objective dais from planting. Its ground follows the same alternating terrain triangles with transparent fades and a cottage/dais exclusion. Existing palm canopy geometry is retained. Only the original hut geometry and small ground vegetation are separated into complete fallbacks; the full original scenery triangle multiset and next RNG value remain regression-tested. Tideglass adds a ready-dependent coastal profile to the one lighting owner; market-only failure leaves Watch/Farm authored, while shared-library failure restores all three procedural areas and baseline lighting.

Judge changes in the actual third-person gameplay camera as well as the offline preview. Check the tower front, courtyard, both doors, interior cutaway, gliding/roof view and transition to the farm at high and low quality. Inspect the console and network tab for asset/texture failures; deliberately block the GLB once to confirm fallback. Run the relevant automated tests, `npm test` and `git diff --check` before committing and deploying.

## Windward Farm milestone QA — 2026-09-05

Measured on this host in Chrome/WebGL2 at 1920 × 1080, device pixel ratio 1. Matching five-player fixed-render fixtures sampled 240 frames after 60 warm-up frames. Their poses were static and contained no enemies; browser scheduling, vsync and platform limits affect these timings. Baseline `2c2d3fe` averaged 16.67ms with 16.8ms p95 in all four fixtures. The final-source comparison is:

| View / quality | Draw calls, baseline → final | Renderer triangles, baseline → final | Final mean / p95 frame time |
| --- | ---: | ---: | ---: |
| Old Watch / high | 149 → 150 | 670,302 → 667,618 | 17.52 / 18.2ms |
| Old Watch / low | 148 → 149 | 500,254 → 497,570 | 17.51 / 18.2ms |
| Farm / high | 173 → 222 | 709,991 → 942,731 | 17.54 / 18.2ms |
| Farm / low | 172 → 221 | 539,943 → 723,427 | 17.51 / 18.2ms |

The current fixtures run at approximately 57 FPS on this host. Farm draw calls and triangles rose materially even while frame times remained close: this result is not a hardware guarantee or permission to multiply the same cost across later regions. Retain bounded batches and density/distance reductions, and benchmark each extension against the total island cost.

An isolated live five-client session exercised ordinary browser movement and interactions: opened chest 21 and the barn chest, traversed both barn doors in both directions and the connecting trail both ways, checked roof cutaway/restoration, turning sails, low graphics, reduced-motion freeze and the map. The populated world held 36 enemies, with seven within 28m of the farm, though not all seven were necessarily on screen. A warm populated sample measured 56.63 FPS and 18.2ms p95; one renderer snapshot reported 346 calls and 1,019,495 triangles. Combat and effects vary, so that snapshot is not a fixed scene budget.

Walking, barn-interior and aerial/gliding screenshots passed visual review. This review found and corrected floating hay placement and a sky slit below the mill cap's shingle fringe. No unexpected console or network errors remained. Deliberately blocking only Farm's GLB preserved authored Old Watch and the complete Farm fallback; blocking the shared GLB preserved both fallbacks and baseline sky at the farm. The loaded cache reported two URLs, three leases, ten shared images and 9,786,696 estimated decoded texture bytes, for 10,043,800 unique GLB download bytes. Both generators independently reproduced their shipping GLB and manifest byte for byte. Local screenshot/fixture helpers and output remain ignored QA aids and are not shipped.

Full `npm.cmd test` passed all 130 tests, including multiplayer progression and the environment regressions. `git diff --check` passed.

## Tideglass milestone baseline and repeatable review setup — 2026-09-05

Milestone 3 starts from `be58b78` (the preceding environment implementation remains `8b66888`). The existing market has the `fruit-stall`, `sailcloth-stall`, and furnished `market-cottage`; central Haven has the existing closed huts `prop-16` and `prop-17`. Their shared footprints, heights, paired cottage doors, resident loops and chest IDs are the authoring contract. The lighthouse and later coastal settlements are outside this milestone's architecture scope.

Baseline checks: `npm.cmd test` passed 136 tests; Docker `/health` returned `ok: true`, and 13 browser environment assets matched `git show HEAD:<path>` by SHA-256. Old Watch and Farm regenerated independently with the build commands above and their GLB/manifest bytes matched shipping source. Local captures had no console/page or failed-network errors.

Repeatable browser fixture: Chrome/WebGL2, 1920 × 1080 viewport, device scale factor 1. Serve the repository with an isolated `DATA_DIR` and unused `PORT`, or use the committed Docker service for read-only fixed-scene rendering. Build a local HTML fixture using the game's import map, import `createWorld` from `/world.js` and `heightAt` from `/shared/world.js`, and create a world on a full-viewport canvas. Use a `Game` snapshot with five players, phase `voyage`, elapsed 45 and no enemies. Wait until all environment controllers report ready. For each view, set the local player to ground mode and `y = heightAt(x,z)`, use the stated yaw/pitch, and settle `world.update(1/60, state, player, view)` for 120 iterations at time 12. For art stills, park the four peers at `(2i,94)`; for performance, increment `state.round` and place them at `(x - 3 + 1.5i, z - 3)`, with ground elevation and ground mode. Measure 300 `requestAnimationFrame` updates/renders per view/quality, discard the first 60, and report arithmetic mean and sorted 95th percentile alongside `world.getStats()`. This is a fixed-pose, five-player comparison, not combat or a hardware guarantee.

| Walking / close view | Player X, Z | Yaw, pitch (radians) |
| --- | --- | --- |
| Market square / performance | -27, 40 | 1.2, .02 |
| Fruit stall | -32, 31 | 1.45, .10 |
| Sailcloth stall | -24, 40 | 3.0, .06 |
| Cottage exterior | -35, 41 | 1.73, .03 |
| Cottage interior | -41, 41 | 1.73, -.13 |
| Haven west hut / performance | -14, 19 | .85, .03 |
| Haven east hut | 12, 31 | -.95, .03 |
| Beacon connection | 0, 17 | 0, .04 |
| Old Watch comparison / performance | -64, -76 | .60, .03 |

The aerial view uses player `(-29,39)`, then explicitly sets camera `(-7,30,61)` looking at `(-27,3,31)` after settling. The glider approach uses player `(-15,21,53)` in gliding mode with yaw .65 and pitch -.35. Keep these settings for the before/after comparison. Baseline performance was approximately 16.67ms mean / 16.8–17ms p95 across all six high/low fixtures; renderer costs are retained in the final comparison table below. Screenshots, generated fixtures, temporary save directories and reports belong in ignored QA storage; the instructions here are sufficient to recreate them without previous local helpers.

### Tideglass implementation QA — 2026-09-05

The final geometry adds **2,019,240 bytes**, **22,258 source triangles** and **45 material primitives**, with zero texture images. Its SHA-256 is `d43b7c1585bab1b2b6e69db5493189b6a1ba08702fe1409027f5c6bad4510690`. Independent background Blender 5.2.1 LTS regeneration reproduced both GLB and manifest exactly; the manifest SHA-256 is `0a6b32fbec40e901752850f895d55d08ecbdc0792568f4cf88d57866c62bf1a8`. Old Watch and Farm also reproduced their unchanged shipping bytes. The loaded cache reports three URLs, five leases, ten shared texture images and **12,063,040 unique GLB bytes / 9,786,696 estimated decoded texture bytes**.

Using the fixed comparison setup above:

| View / quality | Draw calls, baseline → final | Renderer triangles, baseline → final | Final mean / p95 frame time |
| --- | ---: | ---: | ---: |
| Old Watch / high | 150 → 150 | 667,618 → 660,922 | 16.67 / 16.8ms |
| Old Watch / low | 149 → 149 | 497,570 → 490,874 | 16.67 / 16.8ms |
| Market / high | 178 → 215 | 361,373 → 393,993 | 16.67 / 16.8ms |
| Market / low | 177 → 214 | 361,213 → 376,689 | 16.67 / 16.8ms |
| Haven / high | 306 → 326 | 997,949 → 1,034,165 | 16.67 / 16.8ms |
| Haven / low | 274 → 294 | 636,055 → 652,071 | 16.67 / 16.8ms |

An earlier first-pass sample ran around 17.5–17.6ms with 18.1–18.3ms p95, illustrating host scheduling variability. These are renderer-frame totals, including other regions and shadows; the Watch change is from other scenery visible to that view, not a changed Watch kit. The comparison remains vsync limited near 60 FPS and is not permission to multiply the new area cost across the island.

An isolated live server used five joined clients: one ordinary browser player and four WebSocket peers. With camp enemies temporarily withheld for navigation checks, browser W movement and E interactions opened chest 20 and the cottage chest, traversed both cottage doors in both directions, checked roof/wall cutaway and restoration, walked the market trail both ways and continued to the beacon. Map, low graphics and reduced motion worked; the new foliage wind uniform became zero, and the existing Farm sails froze. Restore the original enemy collection for the populated sample. The final live scene held **36 enemies**, with **five within 28m of the market** (not necessarily all on screen). Its warm sample averaged **16.67ms / 18.4ms p95**; one renderer snapshot was **301 calls / 455,763 triangles** with five players. Combat/effect timing and stationary peers limit comparability to other sessions.

Walking, close, cottage interior, both Haven huts, aerial/glider and Old Watch comparison views were inspected. Review brightened overly dark plaster/canvas, lowered beams protruding through sagged awnings and backed the cottage's low masonry. A close paving inspection found the overlay's negative polygon offset drawing soil over slabs despite correct winding: the actual slab tops sit only about 4mm above the already-raised overlay. Tideglass now uses its explicit 36mm terrain offset without polygon depth bias; close, ordinary, low and aerial views verify visible paving. No extra gameplay elevation was introduced.

To reproduce failure checks, intercept `/assets/tideglass-market/kit.glb` and then `/assets/old-watch/kit.glb` in separate fresh browser contexts and abort each request deliberately. The first preserves authored Watch/Farm plus complete market, cottage and hut fallbacks; the second preserves all three procedural areas. At market `(-27,40)`, both failed cases restore baseline sky `85d9ee`. No unexpected page/console/network errors remained in the successful runs, and failed contexts produced only the deliberately aborted request. Automated regressions additionally cover partial installation, independently arriving resources after failure/disposal, source nonmutation, exact-once shared disposal, roof undersides, full door prisms and original scenery/RNG preservation.

Final `npm.cmd test` passed all **152 tests**, including the final paving depth-bias correction. `git diff --check` and independent implementation review passed.

## Extending the next area

1. Pick a small playable composition and specific reference characteristics: stone color, timber age, roof shape, vegetation and light. Establish collider and doorway envelopes before authoring.
2. Reuse these material families where the surface language matches. Add a new small texture set only for a distinct surface, and record its origin and license in `CREDITS.md`.
3. Add a ground-centered prefab with explicit UVs, vertex wear and an intentional silhouette. Merge by material. Add its naming, bounds and collision contract to both the generator validation and runtime integration.
4. Export geometry additions into a new area's asset directory with declared shared material dependencies, integrate with visible fallback, and compare gameplay screenshots and renderer statistics at the same camera/quality settings. Preserve broad paths and readable interactive objects. Add profiles to the one lighting owner, not another area-specific global light writer.
5. Commit the reproducible source, final GLB and manifest together after visual and gameplay checks. Reuse that validated pattern for a larger area only after the sample looks and performs well.

See [ENVIRONMENT_ROLLOUT.md](ENVIRONMENT_ROLLOUT.md) for the authoritative milestone order, completion evidence, active handoff and the **"upgrade next zone"** resume workflow. Keep progress there so fresh windows can continue without previous chat history.

This milestone establishes a reusable pipeline, with a first shared material/prop owner rather than a finished island-wide art library. Geometry and texture patterns are procedurally authored in the source generator; there is no hand-sculpted high-poly bake, painted unique facade atlas, terrain displacement, baked global illumination, seasonal art set or native-engine virtualized geometry. Those are possible later investments if the playable sample justifies them. Extra polygon count alone will not improve the result: composition, surface scale, edge wear and light need to be reviewed together.
