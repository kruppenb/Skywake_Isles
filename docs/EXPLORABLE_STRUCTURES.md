# Explorable structures

## Captain's house palette card

This card was written before modeling. The house sits inland at approximately
`(-69, 65)`, facing the sea along +Z. Its 20 × 18 m ground plan supports two
full stories and an attic lookout; the porch and upper balcony make the main
entrance legible from the shore path.

| Surface | Captain's house treatment |
| --- | --- |
| Walls | Narrow, overlapping horizontal weatherboards in faded deep navy. Individual boards have alternating lengths, uneven sun bleaching and dark joints; the lower wall has a salt and rain worn stone skirt. |
| Trim | Warm ivory corner boards, jambs, window casings and eaves; dark umber framing around open doors; aged brass fittings. |
| Roof | Ochre cedar shakes with staggered courses, subtle lichen and a copper ridge cap. A stone chimney pierces one slope. |
| Interior | Honey amber floorboards with varied plank lengths, exposed dark beams, ivory partition walls, brass and amber practical lights. Living room and kitchen below; bedroom and chart room above; a small attic lookout and sea-facing balcony. |
| Accents | Rope-wrapped porch posts, a carved compass rose, shutter pairs, a chart table, sea chest, telescope, books, crockery and fireplace tools. |
| Ground | Trodden sandy gravel approach with low coast grass and weathered stepping stones; an open porch keeps the front doorway clear. |
| Light | The island's existing bright coastal profile, with localized amber lantern glass and hearth glow only. |

The faded navy weatherboards and ochre cedar roof repeat no wall and roof pair
in the environment pipeline's Area identity contract. The house uses the
island's shared construction language: exposed timber joints, modeled courses,
metal fasteners, weathering near the foundation and recesses at windows.
The separate flooded manor uses its own palette and silhouette.

## Captain's house visit and source

The house stands west of Tideglass Haven at `(-69, 65)`. A marked path branches
from Saltwind Harbor via `(-28, 95)`, `(-31, 88)`, `(-45, 91)` and `(-62, 83)`
to the front approach at `(-69, 77)`. The ivory trimmed navy facade, compass
relief, and seaward balcony identify it. The front (+Z) threshold opens into a living room.
The kitchen is to the rear left, and the first stair climbs the east side to
the bedroom and chart room. The west stair on that level reaches the attic
lookout. The upper front opening leads directly onto the balcony. Both stair
shafts are cut through the floor boards, with rails around the exposed edges.

The shared floor plan, collider boxes and continuous stair surfaces are in
`shared/captains-house.js`; the renderer in `client/captains-house.js` skins those
same boxes and adds the furniture, windows, weatherboards, shingles and
lanterns. `client/world.js` seats the structure on the island and reserves its
garden from procedural trees. Its indoor chase camera pulls closer and obeys
the new wall and floor line-of-sight checks.

The geometry is deterministic runtime authored work: 22 instanced material
batches, one small lettered sign plane, and about 66,400 triangles. Siding is broken into individually
weathered horizontal boards, roof cedar into overlapping staggered shakes,
and planked decks into mixed-length courses. Three small original generated
grain maps provide close-range wear without a downloaded texture or a new
lighting profile. The house has no GLB build step. Its contract-alignment
smoke test runs with `node --test test/captains-house-render.test.js`; the full
gameplay and rendering suite runs with `npm test`.

For repeatable visual inspection after starting the local server, run:

```powershell
node tools/qa/structures/capture.mjs --origin http://localhost:3400 --out .qa/structures-capture --quality both
```

The capture includes high and low quality house and flooded-manor overviews,
plus the actual local-avatar follow camera at each floor, the lower stair, and
the balcony. It writes PNGs and `report.json` outside the tracked source tree.
The synthetic voyage snapshot makes it presentation evidence; movement and
network behavior are covered by the gameplay tests.

## Verification

The final house uses **5,534 authored box instances, 66,408 triangles and 22
instanced material batches**, plus one small sign plane bearing actual
`CAPTAIN'S HOUSE` lettering. The porch threshold ray passes at foot height;
front and side window rays pass through the collision openings; the shared
pitched roof covers the lookout. The attic front has a physical Juliet guard.

The accepted local capture at `http://localhost:3401` produced fourteen high
and low quality house views in `.qa/structures-house-final`, with zero console
errors, page errors or failed requests. It includes the real follow camera with
the local avatar at the entry, living room, lower stair, upper room, balcony
and attic. A second high/low west-wall capture in `.qa/structures-house-walls`
reported `cameraClear: true` in both frames after a wall-adjacent turn. A
front-wall high/low capture in `.qa/structures-house-front-wall` also reported
`cameraClear: true` in both frames, with zero capture errors. These are ignored
local evidence, not committed art assets.

The deterministic scene test, environment test, island canopy tests and Farm
and Tideglass regressions passed together (47/47). The scenery comparison
against detached pre-house commit `71288c3` found identical 141,650 triangle
counts and the same next random value; all 131,906 triangles outside a 25 m
box around the house had the same SHA-256 multiset hash. Five original canopy
draws and five ground plant draws rooted in the house clearing remain in a
permanently hidden fallback batch; the authored island kit omits only those
sites. Thus the house does not inherit trees piercing its floors even if asset
loading fails.
The final repository suite passed **552/552 tests** with no failures or skips.
