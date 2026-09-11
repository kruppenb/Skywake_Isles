# Skywake navigator — player character prototype

Original pirate design, clothing, textures and rig built in Blender on MakeHuman CC0
anatomy topology. The anatomical base mesh is a free, credited input; it is **not**
geometry authored from scratch here, and no part of this asset is derived from any
commercial character pack.

## Build

```
blender --background --factory-startup --python-exit-code 1 \
    --python tools/build-player-character.py -- \
    --output client/assets/player-character \
    [--blend <file.blend>] [--preview-dir <dir>] [--base-obj <base.obj>]
```

* `--output` — directory receiving `hero.glb` and `manifest.json`. Defaults to the shipping
  path. Point it elsewhere to regenerate for an independent byte comparison.
* `--blend` — writes a compressed, texture-packed, editable `.blend`. Save it outside the
  repository: it is a working file, not a shipped asset.
* `--preview-dir` — renders `navigator-front/back/three-quarter/face-closeup/rig-check.png`
  on a neutral studio set with Cycles CPU. Untracked; do not commit these.
* `--base-obj` — the CC0 anatomy input. Its SHA-256 is checked against `provenance.json`
  on every run and the build aborts on a mismatch.

Verified with Blender 5.2.1 LTS. Two runs to different output directories produced a
byte-identical GLB and manifest (`3d23b27c…`), so the generator is reproducible on one
Blender version; identity across Blender versions is not claimed.

Syntax check (keep the bytecode cache out of the repository):

```
PYTHONPYCACHEPREFIX=<scratch> python -m py_compile \
    tools/build-player-character.py tools/player_character.py
```

## What is in this directory

| File | |
|---|---|
| `base.obj` | MakeHuman `basemesh hm08`, released CC0 in September 2020. Unmodified copy. |
| `CC0.txt` | The CC0 1.0 text shipped with that repository. |
| `provenance.json` | Pinned upstream repo, commit, path, URL, byte count and SHA-256. |
| `README.md` | This file. |

Only the derived `hero.glb` ships to the client. `base.obj` never reaches the browser.

## How the asset is made

1. **Anatomy in.** The `body` face group of `base.obj` is parsed as data — helper tights,
   skirt, hair, genital, eye, teeth, tongue and eyelash proxies and every joint cube are
   excluded from the visible mesh. Joint cube centres are kept as rig landmark data.
   Source is decimetre-scale, Y-up, mid-body origin, facing +Z; it is rotated 180° about
   its own Y and scaled to metres, `game = (-sx, sy - groundY, -sz) * 0.14693`, so both X
   and Z flip and handedness (and face winding) survive.
2. **Stylising.** `morph_body` enlarges the head about a neck pivot, broadens the
   shoulders, takes in the waist, thickens the legs and enlarges the hands, giving an
   adult at about 6.4 heads instead of the base mesh's ~7. `sculpt_face` then runs ten
   grab brushes over the head — chin, jaw, brow, cheek, nose, lip, cranium — at single-digit
   millimetre amplitudes. A single uniform scale at the very end puts the crown of the
   tricorn at 2.72 m.
3. **Deletion.** Only the head, neck and hands survive. Everything the clothes cover is
   removed, so the face keeps its authored eyelids, lips and ears and the hands keep real
   fingers rather than becoming primitives.
4. **Garments grown from the body.** One smoothed, gap-filled radius field per region
   (torso, each arm, each leg, skull) is sampled once and shared by every layer to establish
   the intended rest-pose stacking order: shirt +11 mm, coat +36 mm, sash +56 mm, map
   strap +62 mm, belt +76 mm, with fold amplitude capped at 4.5 mm. `pc.shell` lofts each
   panel with a real inward thickness and closes every open border with rim quads, so
   lapels, cuffs, coat tails and the tricorn brim read as cloth rather than paper.
5. **Face hair** is laid out in measured (x, y) on the face and dropped onto the skin along
   +Z, using the mouth line and nose base measured from the teeth proxies rather than the
   `joint-mouth` marker, which is an interior jaw pivot roughly 35 mm above and 150 mm
   behind the lips.
6. **Textures.** Every part is rasterised into an object-space G-buffer (position, normal,
   two authored scalar channels) and painted procedurally from 3D position to reduce
   colour breaks at UV seams. One 2048² sRGB albedo and one 1024² normal map, shared by
   all eight materials. Skin UVs are the file's own retained face-corner UVs: the islands
   the kept faces use are isolated, normalised and shelf-packed into the skin atlas region
   with gutters.
7. **Rig.** One armature, 20 bones, distance-falloff weights normalised to at most four
   influences. Coat geometry deliberately ignores the leg bones and takes `coat_tail.L/R`
   instead. Three clips: `idle`, `walk`, `rig_check`.

## Honest limitations

* This is a prototype. It does not reach the polish of a professional hand-painted
  character pack, and nothing here should be read as claiming otherwise.
* Renderer-only: the live player is still `buildPirate` in `client/models.js`. No gameplay
  integration, IK, weapon fitting or collision work has been done.
* Attachment empties are future anchors. No compatibility with the current weapon or
  glider code is claimed or tested.
* `walk` is a rig proof, not production locomotion. `idle` is a subtle breathing loop.
* No finger or toe bones — hands and feet are rigid to `hand.L/R` and `foot.L/R`.
* The coat skirt passes through the thighs in a deep crouch; the tail bones are not driven
  by anything yet.
* The face is procedural texture plus a light parametric sculpt over CC0 topology, not a
  hand sculpt. Beard and moustache are solid forms, not strands.
* Residual artefacts in the inspected renders: a notch where the coat's back slit passes
  under the sash and belt, tabs at the shoulder/collar seams, and navy trouser breakthrough
  at the backs of both boot cuffs. Garment contact is not validated for gameplay.
