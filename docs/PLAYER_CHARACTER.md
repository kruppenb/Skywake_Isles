# Skywake navigator — player character prototype

Status: **inspection-only work in progress, not production-accepted.** This document
describes one renderer-only asset prototype and the binary contract tests that check it.
It is not a claim that the character is finished, approved, or ready to replace the live
player model.

## What this is

`client/assets/player-character/hero.glb` is one original pirate character —
**original pirate design, clothing, textures and rig, built in Blender on MakeHuman's
CC0 anatomical mesh topology.** The free CC0 mesh supplied only base human anatomy data
(principally head and hand topology); it is not source code, not a runtime dependency,
and nothing in the shipped asset is derived from any commercial character pack. Do not
describe this asset as entirely original topology, and do not describe the build as
requiring no external downloads — the anatomical base is a credited, pinned, free
external input, and that is a distinction worth preserving accurately.

Provenance is pinned independently of any generator claim: `tools/player-character/base.obj`
must hash to `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`
(1,749,303 bytes), the MakeHuman `basemesh hm08` release, CC0 1.0, September 2020.
`test/player-character.test.js` checks that hash directly against the committed file,
not against `tools/player-character/provenance.json`'s own claim about itself.

## What this is not

- **Not the live player model.** `client/models.js`'s `buildPirate` is still what
  players see and control in-game. Nothing about this milestone changes that.
- **Not professional or "vendor A" quality.** The direction is informed by a hand-painted
  reference pack the project chose not to purchase; this prototype is a first pass toward
  that fidelity, built with free tools and original work, not a reproduction of it.
- **Not gameplay-ready.** No weapon, IK, recoil, muzzle, glider or mount integration has
  been attempted. See "Remaining integration work" below.
- **Not proven by these tests.** `test/player-character.test.js` is a binary contract
  check — bytes, counts, budgets, finite math. It cannot and does not assert that the
  character looks good, reads as human, or is free of visual artifacts. That judgment is
  a manual, in-engine review, and the residuals below are its current findings, not a
  hypothesis the tests could confirm or refute.

## Known visual residuals (lead + worker review, not caught by the binary tests)

These were found by looking at the rendered character, not by the tests, and the tests
passing does **not** mean any of them are fixed:

- Facial hair (moustache/beard) is a solid, faceted form, not styled strands.
- Shoulder/collar seam tabs are visible where panels meet.
- A notch is visible under the back sash/belt where the coat's back slit passes beneath
  them.
- The coat skirt penetrates the thighs in a deep crouch pose.
- On the final `navigator-back.png` render, navy trouser fabric breaks through the
  **backs of both brown boot cuffs** — the front daylight gap between boot and trouser
  was fixed, but the back overlap was not, and this has not since been corrected.
  **Boot/shoulder clearance is not validated** — do not read the binary contract passing
  as evidence either seam is clean.
- Exposed ivory (shirt) tabs are visible at the collar, and a strap tab is visible at the
  shoulder, in the final renders.
- The `rig_check` pose (elbows/knees bent, per the animation contract below) still shows
  waist/coat interpenetration.

None of this is gameplay-blocking by itself — this is a renderer-only prototype with no
collision or gameplay integration yet — but it means the character is not visually
finished, and no claim of full visual acceptance is made here or should be inferred from
a passing test run.

## Remaining integration work (explicitly out of scope for this milestone)

- No finger or toe bones. Hands are rigid to `hand.L/R`, feet to `foot.L/R`.
- No weapon integration: none of the five gameplay weapons have been fitted, and
  `weapon_grip.L/R` are anchors only — their transforms are not validated against any
  current weapon code.
- No analytic IK, no recoil, no muzzle flash/point integration.
- No glider integration: `glider_grip.L/R` are anchors only, same caveat as above.
- No mount/vehicle (airship, boat) integration.
- `walk` is a rig proof (in-place cycle), not production locomotion.

## Build

```
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/build-player-character.py -- \
    --output <output-directory> [--blend <file.blend>] [--preview-dir <directory>]
```

- Blender **5.2.1 LTS**, run headless (`--background --factory-startup`), non-zero exit on
  any Python exception (`--python-exit-code 1`). Everything after the bare `--` is the
  generator script's own argument list.
- `--output` — directory that receives `hero.glb` and `manifest.json`. The shipping
  location is `client/assets/player-character`; point it elsewhere to regenerate for an
  independent byte comparison (the source is deterministic on one Blender version — see
  `tools/player-character/README.md`).
- `--blend` — optional. Writes a packed, editable `.blend` file. This is a working file,
  not a shipped asset: it must be written outside the repository and is **not**
  committed, along with any `--preview-dir` renders.
- `--preview-dir` — optional. Renders front/back/three-quarter/face-closeup/rig-check
  PNGs on a neutral studio set. Also not committed.
- The build needs no network access: the anatomical input is the already-committed,
  hash-pinned `tools/player-character/base.obj`, and everything else is generated
  procedurally. Only `tools/build-player-character.py` and `tools/player_character.py`
  (both original Python source) are committed; the `.blend` file and preview renders
  are not.

Syntax-check the generator without running Blender (keep the bytecode cache out of the
repository):

```
PYTHONPYCACHEPREFIX=<scratch-dir> python -m py_compile tools/build-player-character.py tools/player_character.py
```

## Files this milestone owns

| Path | Owner | Purpose |
|---|---|---|
| `tools/build-player-character.py`, `tools/player_character.py` | generator work package | Reproducible source generator |
| `tools/player-character/base.obj`, `CC0.txt`, `provenance.json`, `README.md` | generator work package | Pinned CC0 anatomy input, license text, provenance, build notes |
| `client/assets/player-character/hero.glb`, `manifest.json` | generator work package | Shipped asset and its self-reported measurements |
| `client/character-studio.html/.css/.js` | preview work package | Isolated browser studio (separate from this document — see below) |
| `test/player-character.test.js`, `docs/PLAYER_CHARACTER.md` (this file) | this work package | Independent binary contract tests and documentation |

## What the binary contract tests actually check

`node --test test/player-character.test.js` (13 tests, all passing at the time of
writing) parses `hero.glb` with its own minimal glTF-binary reader — it does not import
`tools/player_character.py`'s `Glb` helper (different language, and that is the
generator's own self-check) or `client/character-studio.js` (which loads the asset
through three.js's `GLTFLoader`, a different code path). Every exact number in the test
file was independently measured from the shipped bytes; `manifest.json` is then
cross-checked *against* those measurements, not used as the source of truth for them.

Coverage:

- **Container**: GLB magic/version/length, 4-byte-aligned JSON and BIN chunks that
  account for every byte of the file, no trailing data.
- **Identity**: exact file size (2,948,148 bytes) and SHA-256
  (`3d23b27c…b3588a`), both cross-checked against the manifest.
- **Scene graph**: one scene, one root node named `SkywakeNavigator`, one skin (no
  cloned skeletons), and the joint set is exactly the 20 required bones from the
  spec (`root`, `hips`, `spine`, `chest`, `neck`, `head`, `upper_arm`/`forearm`/`hand`
  ×L/R, `thigh`/`shin`/`foot` ×L/R, `coat_tail` ×L/R) — no more, no fewer, no
  duplicates, and every mesh node binds that one skin.
- **Geometry**: 8 mesh primitives (all TRIANGLES, all skinned), 35,656 triangles total —
  both exact and inside the ≤16-primitive / ≤50,000-triangle budgets — with every index
  in range and every position/normal/UV value finite.
- **Skinning**: `JOINTS_0` indices are in range, `WEIGHTS_0` rows sum to 1.0 within 2e-3
  and lie in [0,1], and more than a quarter of all vertices carry two or more
  significant joint weights — evidence of actual smooth blending across joints, not
  uniform rigid parenting.
- **Rest pose**: every joint's rotation is finite and unit-length and every scale is
  finite and strictly positive (no unapplied negative/zero/NaN scale), with no baked
  matrix transforms to obscure that.
- **Materials**: exactly the 8 named materials (`brass`, `cloth_ivory`, `cloth_navy`,
  `crew_accent`, `eye`, `hair`, `leather`, `skin`), all `OPAQUE`, all but `eye` carrying
  a `baseColorTexture`, and `crew_accent` specifically exposing a finite, in-range
  `baseColorFactor` on top of its own base color texture — the tint slot the studio's
  crew-accent color controls are meant to drive.
- **Textures**: exactly two embedded PNGs (a shared 2048² albedo atlas and a shared
  1024² normal atlas, real dimensions read from each PNG's own IHDR chunk, not from
  metadata), both within the 2048px budget, decoding to exactly 27,962,024 bytes total
  — inside the 32 MiB budget — cross-checked against the manifest's texture accounting.
- **Animation**: exactly the three required clips `idle`, `walk`, `rig_check` (no
  duplicates), every sampler's time values finite and non-decreasing, and at least one
  channel in each clip that actually changes value (not a static pose exported as a
  clip). Measured durations: idle ≈4.04s, walk ≈1.04s, rig_check ≈2.04s.
- **Sockets**: `weapon_grip.L/R` and `glider_grip.L/R` are each proven, by walking the
  actual node ancestry (not by name matching), to sit under the corresponding
  `hand.L/R`; `stow_back` is proven to sit under `chest`. No claim is made about
  compatibility with any current weapon or glider code — these are anchors only.
- **Bounds/orientation**: the mesh sits on the Y=0 ground plane (within 2 cm) and stands
  2.65–2.9 m tall, matching the spec's tricorn-included height range. The `-Z` forward
  convention is checked the only way that's actually verifiable from raw geometry: the
  bones specifically *named* for the back of the figure (`stow_back`, `coat_tail.L/R`)
  must sit toward +Z relative to their parent.
- **Export hygiene**: no cameras, no lights, no `extensionsRequired`, and no
  `extensionsUsed` entry that would need a decoder three.js r180 can't supply directly
  (currently: none at all).
- **Provenance**: the committed `base.obj` hashes to the pinned upstream SHA-256,
  checked directly against the file, not against `provenance.json`'s claim about itself.
- **Manifest drift**: material/joint/socket/clip lists, clip channel/sampler counts, and
  the budgets object in `manifest.json` are cross-checked against the values measured
  directly from the GLB, so the manifest can't silently drift from what actually shipped.

None of this substitutes for looking at the character. See "Known visual residuals"
above for what a human reviewer actually found.

## Studio controls (`/character-studio.html`)

`client/character-studio.html/.css/.js` is an isolated inspection page served by the
normal game server (`npm start`, then open `http://localhost:3400/character-studio.html`).
It imports only the served Three.js build, `GLTFLoader` and `client/models.js`; it never
joins a game session, never imports the game entry point and never replaces the live
player. Verified controls, in the order they appear:

- **View** — Prototype / Current player / Side by side (prototype on +X, current
  procedural player on −X). If the GLB fails to load, the page switches to Current player,
  shows the error and offers **Try again**.
- **Camera** — Front, Three-quarter (opening view), Back, Face, Gameplay distance. The
  gameplay preset uses the real rig numbers (FOV 50, near 0.12, back 7.45 m, height
  2.42 m, shoulder 1.48 m, pitch −0.15) as a scale approximation, not the game world.
- **Lighting** — Neutral studio / Island lighting (the game's ACES exposure 1.18,
  hemisphere and sun values on a plain ground disc).
- **Animation** — Idle / Walk / Rig check, plus Play/Pause. Playback starts paused only when
  the system asks for reduced motion.
- **Crew accent** — six swatches that tint the prototype's `crew_accent` material and
  rebuild the procedural player in the same colour.
- **Surface** — Textured / Clay / Wireframe; Textured restores each mesh's own material and
  maps.
- **Turntable** — drag the canvas, ← / → with the canvas focused, Rotate left/right and
  Reset view buttons.
- **Loaded asset** — triangle, primitive, material, joint, clip, height and bounds figures
  measured from the GLB loaded in the page (no manifest fetch), plus the current player's
  visible counts. No frame-rate claim is made.

`window.characterStudio` exposes the same state (`getState()`, `setCamera()`, `setClip()`,
…) for scripted inspection only; nothing in the game reads it.

## Honest summary

The shipped GLB passes every measured binary contract check above, on the exact bytes
that ship today. That is a narrow, mechanical guarantee about file structure, counts,
budgets and finite math — it is not a visual sign-off. The character has known,
documented visual residuals (seam tabs, a back-sash notch, crouch/coat penetration, boot
and shoulder cuff overlaps, and rig-check waist/coat interpenetration), no finger or toe
bones, and none of the five gameplay weapons, IK, recoil, muzzle, glider or mount
integration has been attempted. This is a first, renderer-only milestone toward an
original pirate character — not a finished asset, and not yet ready for gameplay.
