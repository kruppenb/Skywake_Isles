# Skywake Isles environment pipeline

Old Watch is the first playable environment sample for a weathered northern coastal art direction. The kit uses original mossy gray-green masonry, silvered timber, dark overlapping slate, irregular fir boughs, tawny grass and pinnate ferns. Warm lantern glass provides a small point of contrast. It is an original style study, with no assets copied from Skyrim or another game.

Windward Farm and its Old Watch connector are the second area. They carry that approved material quality into a working farm: aged limewash over stone, warm barn timber, muted russet roofing, turning framed sails, golden crops, leafy vegetables and worn field edges. The visual benchmark remains Old Watch; later regions should retain their own vegetation, architecture and atmosphere at this fidelity.

## Build and inspect

The editable sources are `tools/build-old-watch.py` and `tools/build-windward-farm.py`. Shared deterministic mesh construction, metric UVs, vertex colors, material creation, tileable-noise helpers and glTF export live in `tools/environment_kit.py`. Each area retains its explicit models, seed, layout contract and exported bounds validation. Old Watch exports the self-contained shared library; Farm exports an uncompressed glTF 2 geometry extension. The generators need Blender 5.2 or a compatible newer Blender with its bundled NumPy and glTF exporter; they do not need downloaded assets, image libraries, an asset CDN, or a running game server.

From the repository root in PowerShell:

```powershell
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-old-watch.py
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-windward-farm.py
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
```

Each seed is fixed. Keep the Blender/exporter version fixed when comparing binary hashes; exporter versions can change the binary representation. `--python-exit-code 1` makes validation errors fail the CLI process. Commit the source generator, area's `client/assets/<area>/kit.glb` and regenerated `manifest.json` together. Keep previews, build logs, temporary textures and Python cache files out of commits. Both kits load from `/assets/<area>/kit.glb` on the same local server as the game. The optional Farm preview binds generated shared materials only after export, so preview textures never enter its shipping GLB.

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

## Materials and texture scale

Five small original texture families are shared: stone, timber, slate, earth and foliage. Stone, timber and earth use 512 × 512 base color and normal maps; slate and foliage use 256 × 256. They are tileable and embedded in the GLB. Base color is sRGB. Tangent-space normal maps are linear/non-color, with glTF's +Y convention; normal pixels use six-bit precision per channel to keep the asset compact. Roughness is a material scalar, not a painted shadow map. No directional light or ambient occlusion is baked into the textures.

Explicit metric UVs provide approximately meter-scale masonry/soil detail and longitudinal timber grain over roughly 2.2m of beam length. Vertex colors add per-stone variation, moss near damp ground and color variation in vegetation. Preserve `COLOR_0` when changing the exporter. Each geometric blade or needle spray has a modeled outline; there are no transparency cards or alpha sorting dependencies. Foliage is double-sided; masonry, timber and bark use outward-facing surfaces.

Farm reuses those texture families with explicit named slots. `watch_stone`, `aged_timber`, `forged_iron` and `recess_shadow` retain the source material; `farm_plaster`, `farm_roof`, `crop_straw`, `crop_leaf` and `hay_straw` clone the corresponding shared material with linear color multipliers recorded in the manifest. UVs and `COLOR_0` still provide scale and individual weathering. Multipliers above one deliberately brighten the darker shared surfaces for limewash and straw. Do not treat these linear multipliers as sRGB display colors.

## Shared ownership and total cost

`client/environment-assets.js` owns local GLB loads and decoded resources. Area controllers acquire leases, share the in-flight promise and source geometry/material/texture/ImageBitmap ownership, then release idempotently. Area-created material clones retain borrowed textures; releasing a clone must not dispose the shared maps. Staged instances are installed atomically, and failed or late completion cleans up area resources before releasing source leases. Legacy building and scenery batches remain visible until the full area is ready; failed loading leaves a playable fallback.

Old Watch's existing GLB is the first shared library. It is loaded once per live cache even when both controllers need it. Farm depends on that entire library, including the original building geometry; this milestone does not split it into independent prop/texture downloads or ship distance-triggered asset streaming. A later measured need can justify splitting the library while maintaining the ownership contract. Copying the complete Old Watch kit into another area is not the extension pattern.

| Shipping kit | GLB bytes | Source triangles | Material primitives | Embedded images | Added decoded RGBA8 + full mip chain estimate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shared Old Watch | 7,584,620 | 59,078 | 33 | 10 | 9,786,696 bytes |
| Windward Farm additions | 2,459,180 | 26,740 | 30 | 0 | 0 bytes |
| Unique combined total | 10,043,800 | 85,818 | 63 | 10 | 9,786,696 bytes |

These are download/source costs, not triangles or draw calls in a gameplay frame. Source parts are reused and instanced, and shadows can draw a visible mesh again. The texture estimate excludes browser decode copies, driver allocation overhead, render targets and other game textures. `world.getStats()` exposes renderer triangles/calls alongside `environmentAssets`, `oldWatch` and `windwardFarm` loading/installation statistics; measure warm views and populated gameplay as the rollout grows.

Old Watch's 8MiB/120k-triangle ceiling remains a per-kit failure guard. Farm's additions stay below 2.5MiB and 32k source triangles. Neither limit is an island-wide budget allocation. The present tradeoff retains uncompressed meshes and ten original PNG images. Small Farm foliage/field detail uses spatially bounded instance batches and distance/quality reductions; architecture remains visible at distance for ship and glider approaches. Avoid multiplying material draw calls by creating a separate object for every stone, tile or frond.

## Placement, collision and lighting

`shared/old-watch.js` owns stable authored pine and rock placements and their collision data. `shared/world.js` appends those colliders without changing existing obstacle indices. Gameplay collision is sourced from these shared shapes, not inferred from GLB visuals. Keep trunk/rock silhouettes inside the corresponding collision envelopes after runtime scaling, and keep resident routes, loot, both doors and the route to the farm clear.

`shared/windward-farm.js` derives the connector from the existing exploration trails and owns deterministic field, fence and planting clearance. Building IDs, obstacle IDs, resident loops, chests and doors remain authoritative in shared gameplay data. Farm adds no blocking obstacles: its small surface stones are walkable and fences retain the existing cosmetic semantics. Existing procedural scenery consumes the original RNG stream before routing the two areas' fallback batches, preserving unrelated regional placement.

`client/environment-geometry.js` owns the actual rendered-height helper. Ground overlays follow the alternating triangles of the existing 2m terrain grid, with smooth vertex-alpha boundaries and no new gameplay elevation. Do not sample only the analytical height function or assume every cell uses the same diagonal. Small plants use seeded instanced placement; low quality reduces decorative density/draw distance, and reduced motion freezes sway and the original mill animation convention. Barn furnishings and its existing paired-door/cutaway behavior are retained when authored faces and roof install.

`client/environment-lighting.js` is the single owner of global sky, fog, hemisphere and sunlight. It captures an immutable baseline, blends normalized overlapping area weights and restores the baseline outside the areas and aboard ship. Old Watch's center profile stays the approved profile. A ready Farm adds a restrained warmer profile along the field and connector; Old Watch's former Farm lighting exclusion is removed only when Farm is ready. Farm failure keeps the original exclusion and baseline transition. Area animation controllers do not compete to write global lighting each frame.

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

## Extending the next area

1. Pick a small playable composition and specific reference characteristics: stone color, timber age, roof shape, vegetation and light. Establish collider and doorway envelopes before authoring.
2. Reuse these material families where the surface language matches. Add a new small texture set only for a distinct surface, and record its origin and license in `CREDITS.md`.
3. Add a ground-centered prefab with explicit UVs, vertex wear and an intentional silhouette. Merge by material. Add its naming, bounds and collision contract to both the generator validation and runtime integration.
4. Export geometry additions into a new area's asset directory with declared shared material dependencies, integrate with visible fallback, and compare gameplay screenshots and renderer statistics at the same camera/quality settings. Preserve broad paths and readable interactive objects. Add profiles to the one lighting owner, not another area-specific global light writer.
5. Commit the reproducible source, final GLB and manifest together after visual and gameplay checks. Reuse that validated pattern for a larger area only after the sample looks and performs well.

After Windward Farm, the remaining rollout is Tideglass Market and central Haven; Saltwind Harbor, Driftwood Yard and Sunwake Strand; Palmheart Camp and Wilds; Cinderworks and Emberpeak; Moonwatch and Moonbloom; then island-wide landscape, shoreline, distant-detail and performance finishing. Those later areas remain roadmap work.

This milestone establishes a reusable pipeline, with a first shared material/prop owner rather than a finished island-wide art library. Geometry and texture patterns are procedurally authored in the source generator; there is no hand-sculpted high-poly bake, painted unique facade atlas, terrain displacement, baked global illumination, seasonal art set or native-engine virtualized geometry. Those are possible later investments if the playable sample justifies them. Extra polygon count alone will not improve the result: composition, surface scale, edge wear and light need to be reviewed together.
