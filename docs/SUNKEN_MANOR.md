# Sunken Manor

The Sunken Manor occupies reef coordinates `(42, -44)`. Its shell is 28 × 24 metres, from `x=28..56`, `z=-56..-32`, and `y=0..19.2`. The front faces south, toward the return current. It is entirely underwater: every room uses swimming movement, and there are no dry pockets or walking transitions.

## Palette card

| Element | Manor treatment |
| --- | --- |
| Construction | Shell-limestone ashlar and cracked, weathered indigo plaster panels; the same masonry language runs through all three floors. |
| Trim | Corroded green bronze around broken windows, balcony remnants and the drowned chandelier. |
| Roof | Discontinuous oxidized verdigris slabs, with open atrium and eastern breach. |
| Accents | Ivory barnacles, peach coral fans, dark timber furniture, fallen books, pale table service and seaweed in damaged corners. |
| Ground | Fine shell silt against the foundation; the authored manor excludes random habitat growth from its rooms and south approach. |
| Light | The reef's teal fog and filtered daylight remain visible through the generous openings. No additional scene light is introduced. |

This differs from the pipeline's shipped wall and roof pairs: indigo plaster on shell-limestone under a broken verdigris roof is not used by the island areas. The dining hall, library and bedchambers, and upper gallery differ by their furnishings and damage while sharing one construction and weathering language.

## Swim plan

The ground dining level has a clear swimmer origin around `y=2.1`, the library and bedchambers around `y=8.5`, and the ruined gallery around `y=14.9`. The plan's `floorY` values are nominal story datums. The physical foundation tops at `y=0.5`; the upper slabs are centered at `y=6.4` and `12.8` and top at `y=6.65` and `13.05`. Each slab leaves an 8 × 8 metre central atrium opening (`x=38..46`, `z=-48..-40`). The open atrium rises through the roof. The south front has an 8 metre entrance; north, east and west faces have broad swimming windows on each tier. The gallery's eastern floor and roof also have broken openings. Large furnishings and stair fragments have server-side collision boxes. All masonry and furnishing boxes are exported from [the shared plan](../shared/sunken-manor.js), which the client renders in batched textured material passes.

To explore, dive at the Sunken Reach entrance and follow the pale pearl route east from the return current: `(0,25)` → `(34,25)` → `(42,8)` → `(42,-19)` → the south entrance `(42,-30.5)`. Enter at `y≈2`, swim to the central atrium `(42,-44)`, ascend through the two floor openings, visit the west dining wing and mid-level library and bedchamber, then leave by an upper window or the roof breach. The chandelier at `(42,15,-44)` is a discovery. The Gallery Reliquary cache sits on the upper floor at `(50,13.4,-37)`; enter its wing from the central opening at `z=-44`.

## Verification

The manor contributes **50,908 triangles in 12 batched draw calls**. Exterior indigo panels, staggered shell-limestone quoins, carved arches, bronze cornices, roof remnants and window growth project beyond the shell's outer wall faces; interior pier ends and floor edges have their own coursing and trim. Its merged geometry is released when the manor detaches from the world, while it leaves borrowed reef materials and textures to their shared owner.

`test/sunken-manor.test.js` samples full swimmer collision along the return route, all three levels, windows and roof, and checks blocked floor and wall rays, camera clipping, physical furnishings, exposed exterior geometry and the rendering budget. `test/sunken-manor-network.test.js` uses two live socket clients swimming in the atrium and checks that a late join receives the shared cache and discovery state. The existing reef wayfinding and habitat tests cover the expanded route and procedural exclusion.

The reproducible visual capture uses `node tools/qa/structures/capture.mjs --origin http://localhost:3400 --out .qa/structures-manor-final --views manor-overview,manor-ground-gameplay,manor-upper-gameplay,manor-gallery-gameplay --quality both --browser msedge`. The accepted local capture used port `3401`: eight high/low screenshots and `report.json` under `.qa/structures-manor-final`, with zero console errors, page errors or failed requests. It uses the production presentation and a synthetic voyage snapshot (`presentationOnly: true`); the live two-client authority check is the separate network test. `.qa` output is local evidence and is not committed.
