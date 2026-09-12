# Skywake ship model

The Skywake is authored in `client/ship-model.js` as batched Three.js geometry. It uses no downloaded model or canvas API, so the same builder works in the browser and in Node contract tests. `client/models.js` keeps the public `buildGalleon(palette)` and `buildDeckCannon(palette, gun)` exports and injects the existing jump-gate helpers into the focused ship builder.

## Visual language

The model uses the same restrained material family as the navigator and weapon GLBs: blue-black and deep teal painted hull strakes, warm walnut structure, honey deck boards, muted aged brass, blue-grey iron and warm linen. Broad chamfers, overlap lines, framed panels, deliberate fasteners and large readable fittings carry the detail. Small deterministic `DataTexture` maps provide low-contrast brush grain and linen weave under `MeshStandardMaterial`, giving the ship soft continuous lighting without changing the global palette or lights.

The hull is built as individually coloured clinker bands with raised seams, a closed stern transom, keel and stem. Deck planks follow the complete curved outline, use staggered joints, and carry paired fastening pegs. The sternhouse includes overlapping siding, corner posts, a framed panel door, framed windows and a cornice. Masts retain their exact feet and add collars, double-layer yards, high inboard braces and rigging blocks. Linen sails have broad panel variation, conformed seams and hems, reef ties, and a flat compass-star inlay that follows the sail billow.

Deck cannons retain the authoritative station, pivot, muzzle, aim and recoil hierarchy. Their visible construction adds a fastened timber-and-brass pedestal, chamfered iron yoke, faceted blue-steel breech, heavy bands, handling bar and an open annular muzzle with a recessed dark bore.

## Runtime contracts

- The returned object remains `{ group, base, sails, cabin, guns, gates, animate }`.
- `SHIP_SCALE` is applied once to `base`. Cannon and gate stations remain children of the unscaled root group because their coordinates are already world-sized deck metres.
- `airship-hull-and-deck`, `airship-cabin`, and `airship-sails` remain named `Mesh` objects with their own geometry.
- Cabin wall and roof detail is baked into the cabin mesh. The roof-mounted helm is a named child mesh at its original base-local position and shares the cabin material, so it fades with the cabin body. Sail seams, hems and the compass are baked into the sails mesh, while the pennant is its child and shares the same material. The world can therefore fade either assembly without leaving floating detail.
- The cabin body stays inside the camera fade envelope; the existing roof-mounted helm follows the same fade state. Mast feet keep radius `0.195`, under the `0.20` limit.
- Gun geometry keeps `GUN_PIVOT_HEIGHT`, `GUN_MUZZLE_LENGTH`, the existing traverse/pitch clamp, muzzle transform, and recoil distance. Decorative rails and rigging are arranged around the complete legal shot cone.
- Jump-gate signs, pads and approach chevrons still come from the existing gameplay-facing helpers. Ship geometry does not enter either gate standing corridor.
- All procedural textures and materials belong to the constructed ship; no shared palette material or global renderer setting is mutated.

The ship contract test measures finite geometry, a maximum of 60 visible mesh draws and 100,000 triangles, fade ownership, exterior front-face winding, cannon-ray clearance and gate-corridor clearance. The final authored ship measures 22 visible meshes and 49,433 triangles.

With the local service running, reproduce the inspection captures and JSON report with:

```powershell
node tools/qa/ship/capture.mjs --origin http://localhost:3401 --out .qa/ship/capture
```
