# Underwater quality upgrade

## Scope and acceptance bar

Upgrade all six existing underwater regions to the approved Old Watch level of
moderate-fidelity environment finish. The scope is the whole current realm, not
another exploration expansion. Preserve realm bounds and existing primary
collision solids, with the six approved support solids documented below, plus
swim controls, rewards, interactions, discovery coordinates, and multiplayer authority.

The visual baseline is commit `0d26bd4`. Fresh pre-change captures are local at
`.qa/underwater-quality-review/` and `.qa/island-quality-review-*.png`.
Acceptance requires visible surface texture and wear at gameplay distance,
convincing connected landmark construction, planted compositions with clear
swim routes, and regional lighting that supports depth and navigation.

## Palette and identity contract, before modelling

The existing [palette card](UNDERWATER_PALETTE.md) remains authoritative. Compared
with the island pipeline's Area identity contract, these are submerged, roofless
environments sharing construction quality rather than any island wall/roof pair.
Neighbouring landmarks must also vary their materials and silhouettes.

| Region | Required visible result |
| --- | --- |
| Sunken Reach | Pale rippled shell sand; eroded teal limestone; a broken waterlogged ship with worn planks, ribs, iron fittings and attached marine growth; open turquoise arrival and clear return beacon. |
| Coral Gardens | Cream and rose terraces, broad shelf colonies, branching peach/saffron/violet coral and an organic connected spire. |
| Kelp Hollows | Green-black roots, olive silt, tall curved jade fronds with restrained sway and open swim windows; quiet brass rescue cages. |
| Bell Sanctuary | Salt-rounded pale blue ashlar, coursed ruins with convincing joints, shaped bronze bells and verdigris fittings; cool clear water. |
| Ember Vents | Fractured, porous charcoal basalt, mineral seams and vent mouths; umber grit, local amber accents and rising bubbles. |
| Crown Graveyard | Distinct broken timber hulls, ribs and masts, grey-green reefstone, copper fittings and red anemones; violet depth and restrained treasure lamps. |

## Implementation packages

1. **Materials and habitat — gpt-5.6-terra.** Own
   `client/underwater-materials.js`, `client/underwater-habitat.js` and focused
   habitat/resource tests. Build deterministic original texture resources,
   metric UV geometry, six seabed treatments, coral/sponge/grass compositions,
   and animated kelp with low-quality thinning and reduced-motion support.
2. **Landmarks geometry follow-up — gpt-5.6-sol.** Own
   `client/underwater.js` and `client/underwater-landmarks.js`.
   Terra's initial reef landmark implementation remains the integration
   baseline; Terra retains reef-only `client/world.js` changes. Sol rebuilds the landmark and discovery/event art,
   integrates package 1, replaces hard-sided light columns, and tunes depth and
   grounding with the integration owner.
3. **Repeatable inspection and handoff — gpt-5.6-luna.** Own additional
   `tools/qa/underwater/` art-inspection tooling, underwater documentation,
   shared support data, and focused support/render tests. Capture consistent
   high/low gameplay-scale and unobstructed art views, renderer statistics and
   errors, then record independently verified results.

The runtime-generated art remains original, deterministic and offline. Its
source is the editable asset generator; texture data and metric UVs are created
synchronously, avoiding new network-loading failure states. It must match the
pipeline's wear, material scale, geometry and resource-budget standards.

The six `REEF_LANDMARK_SUPPORTS` boxes added to the shared collision/line-of-
sight data are the approved art/physical alignment exception for this pass.
They are separate from the 16 primary landmark solids and preserve all primary
colliders, interaction coordinates, rewards, and routes; the support geometry
is authoritative for the matching visual columns and buttresses.

### Shared interfaces

`createReefResources(palette)` exports `materials`, `batch(kind)`,
`update(time, { reducedMotion })`, and idempotent `dispose()`.
Material keys: `stone`, `timber`, `bronze`, `basalt`, `coral`, `sand`, `kelp`,
`rope`. Batches support the existing GeoBatch `add`, `line`, and `mesh` shape,
including custom BufferGeometry, while preserving metric UVs and vertex wear.

`createReefHabitat(resources)` exports `group`,
`update(time, { lowQuality, reducedMotion, player })`, and `getStats()`.
`floorY(x, z)` is shared cosmetic seabed elevation and stays below 0.45 m.
Habitat groups retain the named seabed and biome-composition roots. Large solid
landmark art follows the existing collision envelopes; decorative plants keep
interaction and approach corridors clear. All new resources have explicit
ownership and teardown; shared island/player resources are never mutated.

## Verification and completion

- Lead reviews real diffs and high/low rendered views of every region, sends
  implementation corrections back to the owning worker, and repeats affected
  checks after corrections.
- Run the normal two-browser fixture with `--full --events --tour`; verify
  entry, swimming, combat/chest, chimes, rescue, six regions and return.
- Verify low graphics/reduced motion, readable routes/objectives, finite
  geometry, resource cleanup, and bounded draw/triangle cost. Compare fixed
  views before/after; do not equate headless timings with device guarantees.
- Run `npm.cmd test` and `git diff --check`; review and commit only source,
  tests and documentation. Push the completed commit to canonical `main`
  without force, preserving unrelated local and remote work.
- Run `docker compose up -d --build --wait`, verify service and `/health`,
  compare changed served browser assets with the committed source, and inspect
  deployed views. Preserve `skywake-data` and other projects' containers.
- Update [UNDERWATER_ROLLOUT.md](UNDERWATER_ROLLOUT.md) with actual evidence and
  remaining limitations. QA output stays ignored and uncommitted.
