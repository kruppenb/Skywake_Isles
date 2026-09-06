# Old Watch environment pipeline

Old Watch is the first playable environment sample for a weathered northern coastal art direction. The kit uses original mossy gray-green masonry, silvered timber, dark overlapping slate, irregular fir boughs, tawny grass and pinnate ferns. Warm lantern glass provides a small point of contrast. It is an original style study, with no assets copied from Skyrim or another game.

## Build and inspect

The editable source is `tools/build-old-watch.py`. It constructs meshes and repeatable textures offline in Blender and exports a self-contained, uncompressed glTF 2 binary. It needs Blender 5.2 or a compatible newer Blender with its bundled NumPy and glTF exporter; it does not need downloaded assets, image libraries, an asset CDN, or a running game server.

From the repository root in PowerShell:

```powershell
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-old-watch.py
```

Use a different Blender executable path where appropriate. `--background --factory-startup` starts an independent process and never touches an artist's open Blender scene. To render an optional inspection image outside the shipping asset directory:

```powershell
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-old-watch.py -- --preview .qa/old-watch-kit-preview.png
```

To compare a regeneration without overwriting shipping output:

```powershell
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/build-old-watch.py -- --output .qa/old-watch-regenerated
```

The seed is fixed. Keep the Blender/exporter version fixed when comparing binary hashes; exporter versions can change the binary representation. `--python-exit-code 1` makes validation errors fail the CLI process. Commit the source generator, `client/assets/old-watch/kit.glb` and its regenerated `manifest.json` together. Keep previews, build logs, temporary textures and Python cache files out of commits. The browser loads `/assets/old-watch/kit.glb` from the same local server as the game.

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

## Materials and texture scale

Five small original texture families are shared: stone, timber, slate, earth and foliage. Stone, timber and earth use 512 × 512 base color and normal maps; slate and foliage use 256 × 256. They are tileable and embedded in the GLB. Base color is sRGB. Tangent-space normal maps are linear/non-color, with glTF's +Y convention; normal pixels use six-bit precision per channel to keep the asset compact. Roughness is a material scalar, not a painted shadow map. No directional light or ambient occlusion is baked into the textures.

Explicit metric UVs provide approximately meter-scale masonry/soil detail and longitudinal timber grain over roughly 2.2m of beam length. Vertex colors add per-stone variation, moss near damp ground and color variation in vegetation. Preserve `COLOR_0` when changing the exporter. Each geometric blade or needle spray has a modeled outline; there are no transparency cards or alpha sorting dependencies. Foliage is double-sided; masonry, timber and bark use outward-facing surfaces.

The initial kit targets at most 120,000 triangles and 8MiB on disk. The current manifest is the exact count; the first accepted revision is approximately 59,000 triangles, 33 material primitives and 7.3MiB. This is above the aspirational 4MiB download target: the current tradeoff retains uncompressed, broadly compatible meshes and ten embedded PNG textures. Repeated meshes are instanced by the runtime. Avoid multiplying prefab draw calls by creating separate objects for every stone, tile or frond.

## Placement, collision and lighting

`shared/old-watch.js` owns stable authored pine and rock placements and their collision data. `shared/world.js` appends those colliders without changing existing obstacle indices. Gameplay collision is sourced from these shared shapes, not inferred from GLB visuals. Keep trunk/rock silhouettes inside the corresponding collision envelopes after runtime scaling, and keep resident routes, loot, both doors and the route to the farm clear.

`client/old-watch.js` loads the kit once and installs it atomically. Original buildings and primitive props remain visible on load failure. The earth overlay follows the existing 2m rendered terrain triangle grid without changing gameplay elevation. Small plants use seeded instanced placement; low quality reduces density and draw distance, and reduced motion disables their sway. The local lighting/fog blend returns to the original island settings outside the approximately 27m pilot and excludes the nearby farm. `getStats().oldWatch` reports loading/fallback status and installation counts.

Judge changes in the actual third-person gameplay camera as well as the offline preview. Check the tower front, courtyard, both doors, interior cutaway, gliding/roof view and transition to the farm at high and low quality. Inspect the console and network tab for asset/texture failures; deliberately block the GLB once to confirm fallback. Run the relevant automated tests, `npm test` and `git diff --check` before committing and deploying.

## Extending the next area

1. Pick a small playable composition and specific reference characteristics: stone color, timber age, roof shape, vegetation and light. Establish collider and doorway envelopes before authoring.
2. Reuse these material families where the surface language matches. Add a new small texture set only for a distinct surface, and record its origin and license in `CREDITS.md`.
3. Add a ground-centered prefab with explicit UVs, vertex wear and an intentional silhouette. Merge by material. Add its naming, bounds and collision contract to both the generator validation and runtime integration.
4. Export into a new area's asset directory, integrate with visible fallback, and compare gameplay screenshots and renderer statistics at the same camera/quality settings. Preserve broad paths and readable interactive objects.
5. Commit the reproducible source, final GLB and manifest together after visual and gameplay checks. Reuse that validated pattern for a larger area only after the sample looks and performs well.

This first pass establishes an asset pipeline rather than a finished island-wide art library. Geometry and texture patterns are procedurally authored in the source generator; there is no hand-sculpted high-poly bake, painted unique facade atlas, terrain displacement, baked global illumination, seasonal art set or native-engine virtualized geometry. Those are possible later investments if the playable sample justifies them. Avoid promising that extra polygon count alone will improve the result: composition, surface scale, edge wear and light need to be reviewed together.
