# Skywake weapons — GLB models

Status: **guns 1, 2 and 3 are built** — the flintlock (`client/assets/weapons/flintlock.glb`, Meshy
task `01a092d5-6e56-73cf-95f6-def4c7d721a3`), the scatter (`client/assets/weapons/scatter.glb`,
Meshy task `01a093f7-8504-73a2-8436-be4019fcef3c`) and the repeater
(`client/assets/weapons/repeater.glb`, Meshy task `01a09439-b36a-74aa-b327-a9e971ec33b0`, the
first gun whose action translates instead of rotating); the burst and longshot are still
`buildWeapon`'s procedural meshes. This document describes the pipeline that turns a concept plate into
`client/assets/weapons/<kind>.glb`, the gun-space contract that GLB must satisfy, and how to add
the next gun. The end-to-end workflow (who does what, the gates, the per-gun landmark table and
the QA scripts in `tools/qa/weapons/`) is the `/gun-update <kind>` skill in
`.claude/skills/gun-update/SKILL.md`. It is the weapon counterpart of `docs/PLAYER_CHARACTER.md`, and it follows the same
rule: every step is a script, nothing in a shipped asset is hand-edited, and every number in the
manifest is measured from the bytes the game loads.

## Gun space

The runtime contract every weapon shares, procedural or GLB (`buildWeapon` in `client/models.js`,
`WEAPON_HANDLING`, `client/reload-animation.js`, the animate loops in `client/player-character.js`):

| axis | meaning |
|---|---|
| −Z | forward — the direction the muzzle points |
| +Y | up |
| +X | the gun's right side: the lock plate and hammer |

Units are the procedural pirate's; the navigator draws guns at `WEAPON_SCALE = .78`. The flintlock's
landmarks are the bore at x 0 / y .13 running back from the muzzle at z −1.0, an overall length
along z of about 1.30, and a grip whose mid-point (where the firing palm sits) is around y −.19.

### Shipped asset — `client/assets/weapons/<kind>.glb`

- One root node named `<kind>` with identity TRS and three children:
  - **`body`** — mesh, identity TRS, vertices already in gun space. Primitive 0 carries the albedo
    texture; the optional primitive 1 uses the untextured `fill` material (`#1c2a33`) on the faces
    that cap the cut left by the action split.
  - **`action`** — mesh, optional. Its **node position is the hinge pivot P** in gun space,
    rotation identity, scale 1, vertices relative to P. Node extras carry
    `hingeAxis: [x, y, z]` (unit, gun space) chosen so that rotating by −1.15 rad about it *opens*
    the part; for a hammer cocking back (its top moving toward +Z) that is `[-1, 0, 0]`.
  - **`muzzle`** — an empty at the bore centre at the barrel's end, ≈ (0, .13, −1.0).
- No skins, animations, cameras or lights; `extensionsRequired` empty; `extensionsUsed` ⊆
  {`KHR_materials_specular`, `KHR_materials_ior`}.
- Body ≤ 9,000 triangles, action ≤ 1,500, TRIANGLES mode, normals present, UVs in range on the
  textured primitives. All materials `OPAQUE`, `metallicFactor` ≤ .05, no emissive texture, exactly
  one embedded image ≤ 1024² and ≤ 2 MiB, GLB ≤ 3 MiB.
- Gun-space bounds (body ∪ action, node positions applied): z_min ∈ [−1.12, −.92]; z_max ≤ .50;
  y_min ∈ [−.60, −.22]; y_max ≤ .50; |x| ≤ .22. Muzzle node z ∈ [z_min − .02, z_min + .06],
  y ∈ [.08, .18], |x| ≤ .03. Grip: body vertices with y ∈ [−.24, −.14] have centroid |x| ≤ .05 and
  z ∈ [−.02, .30], x-extent ≤ .30, z-extent ≤ .36. Barrel: body vertices with z ∈ [−.90, −.60] have
  centroid y ∈ [.05, .20] and |x| ≤ .03, x-extent ≤ .22, y-extent ≤ .34. Action: pivot inside the
  body bounds, every action vertex within .30 of the pivot and y ∈ [.10, .55], `hingeAxis` unit.

Those ranges are the flintlock's. Every shipped kind has its own row in the `CONTRACTS` tables of
`tools/meshy/build_weapon.py` and `test/weapon-assets.test.js` (kept identical; a `--kind` or a
manifest kind with no row fails both rather than borrowing another gun's numbers). The scatter's
row: z_min ∈ [−1.08, −.88], z_max ≤ .60, y_min ∈ [−.60, −.20], y_max ≤ .55, |x| ≤ .30 (the
flare); muzzle y ∈ [.07, .17]; grip band y ∈ [−.24, −.14] restricted to z ≥ −.10 (`zFrom`, so the
fore-end under the barrel is not counted as grip) with z-extent ≤ .48 (the trigger-guard bow
shares the band with the raked grip, .24 behind it); barrel band z ∈ [−.60, −.35] (behind the
flare) with centroid y ∈ [−.05, .20], x-extent ≤ .30, y-extent ≤ .45; action y ∈ [.05, .55].
The repeater's row, the first long gun's: z_min ∈ [−1.10, −.90] (muzzle at z −1.0), z_max ≤ .60,
y_min ∈ [−.65, −.18] (the magazine, not the grip, is the lowest point), y_max ≤ .55, |x| ≤ .25;
muzzle y ∈ [.12, .22] (bore .17); a **stock-wrist band** y ∈ [−.20, −.08] with `zFrom` −.02 (so
neither the magazine nor the trigger-guard bow counts) whose centroid must land on the pistol
grip / stock wrist at z ∈ [.05, .40], x-extent ≤ .30, z-extent ≤ .50; barrel band z ∈ [−.90, −.66]
(ahead of the fore-end, behind the muzzle ring) with centroid y ∈ [.02, .25], x-extent ≤ .25,
y-extent ≤ .40; action y ∈ [−.60, .10] and reach ≤ .40 — a magazine hanging *under* the receiver,
so the band is negative.

`build_weapon.py` checks every one of those against the exported bytes and exits non-zero on a miss;
`test/weapon-assets.test.js` checks them again independently.

## Pipeline (`tools/meshy/`)

| Step | Script | Input → output |
|---|---|---|
| Concept plates | `weapon-plates.mjs`, `weapon-prompts.json` | Gemini `gemini-3-pro-image` (key `GEMINI_API_KEY`) → `meshy_output/plates/<kind>/<kind>-{side,left,top}.jpg` |
| Mesh + texture | `meshy.mjs prop` | plates → Meshy 7 multi-image-to-3D, static prop: no pose, 8k triangles, 2K albedo, no PBR (**30 credits**) |
| Fit | `build_weapon.py` (Blender 5.2.1 headless) | Meshy GLB → gun-space `client/assets/weapons/<kind>.glb` with the action split off and a `muzzle` empty |
| Manifest | `weapon-manifest.mjs` | shipped GLB bytes (+ `tools/meshy/weapons/<kind>.tasks.json`) → `client/assets/weapons/manifest.json` |
| Checks | `glb_dump.mjs`, `render_glb.py --wide` | structure dump and studio renders |
| Pipeline self-test | `standin_pistol.py` | a blocky primitive pistol with a checker texture, in a deliberately wrong orientation, for exercising the fit without spending credits |

**The exact commands that produced the shipped flintlock** (`$SCRATCH` is any scratch directory;
Meshy downloads go under the gitignored `meshy_output/`). Only the **side** and **left** plates were
submitted — the top plate came back as a near-duplicate side view and would only have confused the
reconstruction:

```
node tools/meshy/weapon-plates.mjs flintlock
node tools/meshy/meshy.mjs balance                        # 1097 before
node tools/meshy/meshy.mjs prop meshy_output/plates/flintlock/flintlock-side.jpg \
    meshy_output/plates/flintlock/flintlock-left.jpg      # 30 credits -> 01a092d5-6e56-73cf-95f6-def4c7d721a3
node tools/meshy/meshy.mjs wait m2m 01a092d5-6e56-73cf-95f6-def4c7d721a3
node tools/meshy/meshy.mjs download m2m 01a092d5-6e56-73cf-95f6-def4c7d721a3 meshy_output/flintlock

# pass 1: auto orientation only, to read the landmarks and find the hammer
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/build_weapon.py -- \
    --in meshy_output/flintlock/model_urls.glb.glb --kind flintlock \
    --out $SCRATCH/flintlock/pass1.glb --report $SCRATCH/flintlock/pass1.json --allow-misfit
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/render_glb.py -- $SCRATCH/flintlock/pass1.glb \
    $SCRATCH/flintlock/renders-pass1 --wide

# pass 2: the real build, with the action box and hinge read off pass 1
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/build_weapon.py -- \
    --in meshy_output/flintlock/model_urls.glb.glb --kind flintlock \
    --out client/assets/weapons/flintlock.glb \
    --length 1.30 --bore-y .13 --muzzle-z -1.0 \
    --action-box 0.04 0.285 -0.245 0.215 0.45 0.02 --hinge 0.118 0.285 -0.09 \
    --hinge-axis -1 0 0 --texture-size 1024 --report $SCRATCH/flintlock/flintlock.json
node tools/meshy/weapon-manifest.mjs
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/render_glb.py -- client/assets/weapons/flintlock.glb \
    $SCRATCH/flintlock/renders-shipped --wide
node --test test/weapon-assets.test.js
```

Everything was auto-detected except the action box and hinge. The fit read the barrel as the model's
−X, the grip as −Y, found the lock on the gun's **left** and mirrored it onto +X, levelled the bore
by 7.01° and scaled the mesh by 0.66642. Result: body 7,200 triangles, action (the cock) 1,057, one
1024² JPEG albedo of 292,953 bytes, 639,728 bytes of GLB.

The action box is the **cock only**. Meshy's lock has the cock at z −0.239…−0.006 and the frizzen
immediately in front of it at z −0.338…−0.251, with a clean gap between them at z ≈ −0.245, so the
box's front face is set there and the frizzen stays on the body where it belongs. The box's floor at
y 0.285 cuts the cock at its neck, just above the lock plate, and the hinge sits on that plane at
the centre of the cock's foot.

### Gun 2 — the scatter

The scatter is drawn as a blunderbuss pistol: the flintlock's lock and raked grip behind a short
fat barrel that swells into a brass trumpet muzzle, with a fat wooden fore-end under the barrel
for the support hand. Same two plates (side and left; the top plate came back as a side view
again and was dropped), same 30-credit prop task, 95 s to reconstruct. **The exact commands that
produced the shipped scatter:**

```
node tools/meshy/weapon-plates.mjs scatter
node tools/meshy/meshy.mjs prop meshy_output/plates/scatter/scatter-side.jpg \
    meshy_output/plates/scatter/scatter-left.jpg      # 30 credits -> 01a093f7-8504-73a2-8436-be4019fcef3c
node tools/meshy/meshy.mjs wait m2m 01a093f7-8504-73a2-8436-be4019fcef3c
node tools/meshy/meshy.mjs download m2m 01a093f7-8504-73a2-8436-be4019fcef3c meshy_output/scatter

# pass 1: orientation only, the levelling band on the straight barrel behind the flare
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/build_weapon.py -- \
    --in meshy_output/scatter/model_urls.glb.glb --kind scatter \
    --length 1.40 --muzzle-z -0.967 --bore-y 0.12 --level-band .22 .52 --lock-side +X \
    --out $SCRATCH/scatter/pass1.glb --report $SCRATCH/scatter/pass1.json --allow-misfit
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/render_glb.py -- $SCRATCH/scatter/pass1.glb \
    $SCRATCH/scatter/renders-pass1 --wide

# pass 2: the real build
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/build_weapon.py -- \
    --in meshy_output/scatter/model_urls.glb.glb --kind scatter \
    --out client/assets/weapons/scatter.glb \
    --length 1.40 --muzzle-z -0.967 --bore-y 0.12 --level-band .22 .52 --lock-side +X \
    --action-box -0.03 0.23 -0.105 0.10 0.40 0.075 --hinge 0.035 0.23 -0.015 \
    --hinge-axis -1 0 0 --texture-size 1024 --report $SCRATCH/scatter/scatter.json
node tools/meshy/weapon-manifest.mjs
node --test test/weapon-assets.test.js
```

What the blunderbuss needed that the pistol did not:

- **`--level-band .22 .52`.** Bore levelling tracks the barrel's silhouettes across a slice of the
  length (the front 2–35 % by default). On a blunderbuss that slice is mostly flare, whose
  silhouette is not parallel to the bore, so the band was moved onto the straight barrel behind
  the flare and ahead of the pan. Levelling came out at 5.35° and the barrel top then runs flat to
  within .01 over z −.60 … −.40.
- **`--lock-side +X`.** The auto vote (the larger |x| reach above the bore near the breech) lost by
  .004 because this mesh carries a brass side plate on both flanks; the mirror it triggered put
  the cock on the gun's left. When the two numbers in the `lock side` log line are that close,
  decide from the pass-1 render and pass the flag.
- **`--muzzle-end wider`** exists for the same family of problem (a flare can be the fatter end)
  but was not needed here: the outer-25 % cross-sections were .157 at the flare against .193 at
  the grip end, so the default vote was right.
- **Grip auto-detect** found nothing beyond 30 % or 25 % of the length from the bore and settled
  at 20 % (271 vertices toward −Y): the raked grip is as shallow as the flintlock's.
- **The action box is the cock only**, as on the flintlock. The frizzen sits at z −.178 … −.11,
  the cock at z −.10 … +.058, with an eight-vertex trough between them at z ≈ −.105 where the
  box's front face goes; the cock's neck is at y ≈ .23, just above the lock plate, which is the
  box floor and the hinge height. 906 of 8,090 faces split off. The script's `hammerHint` box
  reached back to z −.19 and would have swallowed the frizzen — scan the pass-1 body yourself.

The fit read the barrel as the model's −X and scaled by .73511. Result: body 7,205 triangles,
action 929, one 1024² JPEG albedo of 272,453 bytes, 600,788 bytes of GLB, and no visible `fill` at
all — the cut hides between the cock's foot and its socket.

Hands (`WEAPON_ASSET_HANDLING.scatter`, tuned with `tools/qa/weapons/tune.mjs`): right
(.02, −.05, .40), left (−.228, −.086, −.28). Both wrists moved up and back from the procedural
anchors — the grip is raked to z .19 … .43 like the flintlock's, and the fore-end is a tube fused
to the barrel whose underside is at y −.01 where the procedural block hung to y −.18. Firing palm
.040 off the grip, support palm .023 under the fore-end, against .212 and .165 procedural. The tune
script's support-hand finger basis is now per kind, matching `client/player-character.js`: the
pistol's off hand wraps the firing hand, every other kind cups a fore-end from below.

### Gun 3 — the repeater

The repeater is drawn as a compact repeating carbine: a short banded barrel, a boxy steel
receiver carrying the flintlock's lock and hammer on +X, a fat teal box magazine hanging under
the receiver just ahead of the trigger guard, a wooden fore-end ahead of that, a pistol grip and
a short brass-capped shoulder stock. Same two plates (side and left; the top came back as a side
view twice and was dropped), same 30-credit prop task, 76 s to reconstruct. It is the first gun
whose action **translates**: the frame code slides the magazine by (−.26, −.12, 0) · `open`, so
the GLB's action carries `hingeAxis [0, 0, 1]` and the carrier chain applies that translation
unchanged in gun space (the derivation is at the top of `client/weapon-models.js`). **The exact
commands that produced the shipped repeater:**

```
node tools/meshy/weapon-plates.mjs repeater
node tools/meshy/meshy.mjs prop meshy_output/plates/repeater/repeater-side.jpg \
    meshy_output/plates/repeater/repeater-left.jpg    # 30 credits -> 01a09439-b36a-74aa-b327-a9e971ec33b0
node tools/meshy/meshy.mjs wait m2m 01a09439-b36a-74aa-b327-a9e971ec33b0
node tools/meshy/meshy.mjs download m2m 01a09439-b36a-74aa-b327-a9e971ec33b0 meshy_output/repeater

# pass 1: orientation only, to read the landmarks and scan for the magazine
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/build_weapon.py -- \
    --in meshy_output/repeater/model_urls.glb.glb --kind repeater \
    --length 1.45 --muzzle-z -1.0 --bore-y .17 \
    --out $SCRATCH/repeater/pass1.glb --report $SCRATCH/repeater/pass1.json --allow-misfit
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/render_glb.py -- $SCRATCH/repeater/pass1.glb \
    $SCRATCH/repeater/renders-pass1 --wide

# pass 2: the real build, the magazine boxed and hinged at its top centre
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/build_weapon.py -- \
    --in meshy_output/repeater/model_urls.glb.glb --kind repeater \
    --out client/assets/weapons/repeater.glb \
    --length 1.45 --muzzle-z -1.0 --bore-y .17 --lock-side -X \
    --action-box -0.10 -0.25 -0.37 0.10 0.045 -0.14 --hinge 0 0.045 -0.255 \
    --hinge-axis 0 0 1 --texture-size 1024 --report $SCRATCH/repeater/repeater.json
node tools/meshy/weapon-manifest.mjs
node --test test/weapon-assets.test.js
```

What the carbine needed that the pistols did not:

- **`--lock-side -X` means "the lock is on the input's left: mirror it"** — the opposite flag from
  the scatter's. The auto vote here read +X .0826 against −X .0934, fired the mirror and was right
  (the pass-1 render shows the hammer on +X), but on a 1 cm margin, so pass 2 pins the same
  decision rather than re-voting. The flag names the side the lock is *detected* on, not the side
  you want it to end up on; `+X` would have skipped the mirror and shipped the lock on the left.
- **The action box is the magazine only, found by scanning the pass-1 body** — the script's
  `hammerHint` looks for a hammer and points at the lock plate. The magazine is the mass under
  the receiver at z −.341 … −.147, |x| ≤ .054, from the brass base plate at y −.212 up through a
  neck (|x| .039 … .047 over y +.02 … +.06) into the receiver above y +.06; behind it, nothing on
  the body goes below y −.01 over z −.14 … 0, so the box's rear face has air around it. The box
  top at y .045 cuts across that neck, the hinge is the magazine's top centre, and 491 of 8,023
  faces split off. Fill: 50 cap faces on each side, visible only as a sliver at the neck through
  the trigger-guard aperture — and the well *should* show when the magazine slides out.
- **Levelling came out 4.60° with the default band.** That is above the "move the band" trigger,
  but the barrel-top silhouette is not a levelling measure on a barrel drawn octagonal at the
  breech and round at the muzzle (and the shipped scatter's reads worse). The taper-immune check
  is the tube's cross-section centre at the muzzle station: y .169 against the muzzle empty's
  .170, so the socket is on the bore to 1 mm and the default band stayed.
- Grip auto-detect again settled at 20 %; forward was the model's −X, scale .75924. The two-plate
  reconstruction is narrow — |x| max .095 against the procedural .21 — so the fore-end is a thin
  wooden tube fused under the barrel rather than the procedural block.

Result: body 7,580 triangles, action 537, one 1024² JPEG albedo of 295,295 bytes, 659,032 bytes of
GLB; y runs from −.212 (the magazine's base plate) to .351 (the hammer).

Hands (`WEAPON_ASSET_HANDLING.repeater`, tuned with `tools/qa/weapons/tune.mjs` over three
candidate passes): right (−.010, .033, .261), left (−.242, −.011, −.353). Both wrists ride up and
inboard, for the same reason on each side: the GLB is shallower than the procedural gun. The pistol
grip is a short wood column at z .04 … .18 bottoming at y −.146 where the procedural sphere hung to
y −.34, so the firing wrist goes up .178, back .051 and .065 inboard; the fore-end is a thin tube
fused under the barrel, underside y .065 … .077, where the procedural block hung to y −.135, so the
support wrist goes up .169, .023 inboard and .033 forward onto the finger groove at z −.51 … −.64.
The procedural anchors were not merely loose on this mesh: the firing palm dangled .224 below the
grip and the support palm was nearer the **magazine** (.151) than the fore-end (.217) — and the
magazine slides (−.26, −.12, 0) out of the receiver on every reload, straight through where that
hand was. Tuned: firing palm .034 off the grip, support palm .030 under the fore-end, .211 clear of
the magazine at rest and .302 at full stroke. The winner was chosen on the images over tighter
candidates whose palm sat .010 off the grip's lock-side face and read as sunk into the receiver;
.033 of clearance matches the approved scatter's .034. Caveat for the next long gun:
`tune.mjs`'s support metric searches body vertices in y ∈ [−.30, .05], and this carbine's fore-end
underside sits above that band, so its `fit.support.grip.distance` reads ≈ .17 for every correct
candidate; the .030 above was measured from the shipped GLB's vertices with the band lifted.

The in-game check needs an owned repeater: the starting inventory is flintlock + scatter and
chests roll random drops, so the QA run used a scratch fixture wrapping `createGameServer` on
127.0.0.1:3401 that seeds `inventory.repeater` in **both** `addPlayer` and `resetPlayer` (the
voyage start reassigns the stock inventory, so a join-only seed is gone by landing and `Digit3` is
refused `NOT_OWNED` without a toast). No gameplay code changed; `game-check.mjs`'s digit path was
already generic.

`meshy.mjs` reads `MESHY_API_KEY` from the environment or, failing that, the key registered for the
Meshy MCP server in `~/.claude.json`; it never prints it. Meshy downloads expire after a few days,
so re-download from the task id recorded in `tools/meshy/weapons/<kind>.tasks.json` before a rebuild.

## What the Blender fit does

`build_weapon.py` takes a Meshy prop straight out of `download` and does everything the export
leaves undone. Its flags are `--in --kind --out [--length 1.30] [--bore-y .13] [--muzzle-z -1.0]
[--forward auto|±X|±Y|±Z] [--up auto|…] [--lock-side auto|+X|-X] [--muzzle-end thinner|wider]
[--level-band .02 .35] [--action-box x0 y0 z0 x1 y1 z1] [--hinge x y z] [--hinge-axis -1 0 0]
[--bore-from muzzle-face|band] [--texture-size 1024] [--texture-format auto|png|jpeg]
[--report <json>] [--allow-misfit]`. `--kind` also selects the `CONTRACTS` row the export is
verified against; a kind with no row refuses to build.

**Axes.** Blender's glTF importer maps glTF +Y-up/−Z-forward onto Blender Z-up/−Y-forward
(`blender = (gx, −gz, gy)`) and the exporter maps back with `export_yup=True`. Every decision in the
script is reasoned in glTF axes and converted in one place. `--forward` and `--up` name axes of the
**input** model; `--action-box` and `--hinge` are in **output gun space**.

1. **Import and clean.** Drops everything that is not a mesh, applies transforms, joins, then
   **welds by distance**. That weld matters: glTF stores one vertex per (position, UV, normal)
   triple, so a re-imported GLB is split along every UV seam and would look like a mesh full of
   holes — without the weld the hole-filling pass paints `fill` over half the gun. Meshy's custom
   split normals are dropped in favour of shade-by-angle, so a mirror cannot invert the shading.
2. **Material.** One new Principled material named after the kind: the albedo in Base Color,
   metallic 0, roughness .7, no emission (Meshy wires the albedo into emission, which renders
   unlit in three.js), single-sided. Plus a flat `fill` material, `#1c2a33`, for cut faces.
3. **Orientation, all printed and all overridable.**
   - *Barrel*: the longest PCA axis, refined on the front 40 % of the model.
   - *Muzzle end*: whichever end has the smaller cross-section over the outer 25 % of the length
     (`--muzzle-end wider` flips that for a gun whose muzzle is the fatter end; the log prints both
     areas).
   - *Grip*: the half, perpendicular to the barrel, holding the vertices further than 30 % of the
     length from the bore axis — that half becomes −Y. The bore axis for that test runs through the
     centre of the barrel's cross-section at the muzzle face, not through the centroid of the front
     slice: the fore-end, ramrod and trigger guard drag a centroid far enough below the bore to hide
     the butt from the test. A gun whose grip is shallow enough that 30 % still finds nothing (the
     flintlock and the scatter both are) drops the threshold in 5 % steps and says so.
   - *Bore levelling*: a PCA axis is pulled off the bore by anything parallel but offset (a ramrod,
     a fore-end), which leaves the gun a degree or two nose-up and the muzzle socket off the barrel.
     The barrel's top and side silhouettes are tracked across `--level-band` (fractions of the
     length, the front 2–35 % by default) and the frame is rotated (median slope, so one odd slab
     cannot swing it) until they run parallel to gun Z. A flared muzzle needs the band moved behind
     the flare, whose silhouette is not parallel to the bore.
   - *Lock side*: the sign of x with the larger |x| extent among the vertices above the bore within
     z ∈ [−.35, .10]. **Forward and up already fix the frame completely, so when the lock comes out
     on the gun's left the only way to move it to +X is to mirror the mesh across x = 0** (winding
     reversed with it). The script says so loudly when it does; `--lock-side +X` skips it.
4. **Fit.** Uniform scale so the extent along gun Z is `--length`, then a translation putting the
   bore at x 0 / y `--bore-y` and the front-most z at `--muzzle-z`. The bore is measured as the
   centre of the barrel's cross-section **at the muzzle face** rather than the centroid of the whole
   barrel band, because a ramrod slung under the barrel drags that centroid several centimetres
   down; `--bore-from band` restores the plain centroid for a gun with nothing under the barrel.
5. **Action split.** Faces whose centroid lies inside `--action-box` are separated into `action`.
   Both halves then get their open boundary walked into closed loops and capped with the `fill`
   material. The action's origin moves to `--hinge` (so its node position is the pivot and its
   vertices are relative to it) and `--hinge-axis` is written as the object custom property
   `hingeAxis`, exported as node extras.
6. **Muzzle and root.** An empty at the measured bore end, and `body` / `action` / `muzzle` parented
   to a root empty named `<kind>`.
7. **Texture.** The albedo is downscaled to `--texture-size` (never upscaled) and packed as PNG, or
   JPEG when the PNG would be over about 1.5 MiB and the image has no alpha.
8. **Export and verify.** `export_yup=True, export_apply=True, export_extras=True`, no animations,
   cameras, lights or skins. The script then **re-reads its own output** with a small glTF parser
   and measures every landmark of the kind's `CONTRACTS` row from those bytes — the printed table
   and the `--report` JSON are measurements of the shipped file, not of the Blender scene. A miss
   exits 1 unless `--allow-misfit`.

### Choosing `--action-box` and `--hinge`

Run pass 1 with no box. The log and the report's `hammerHint` give you, in gun space, the bounds of
the lock-side mass above the bore near the breech and then the bounds of its top 55 % — on a
flintlock that is the cock standing proud of the lock plate — plus a `suggestedActionBox` and
`suggestedHinge` derived from them. Render pass 1 with `render_glb.py --wide` and look at `side`
(the camera sits on gun +X, so that is the lock plate straight on) and `three-quarter`.

Then sanity-check the suggestion before using it:

- The box's **lower y** must sit just above the lock plate / receiver surface the hammer stands on,
  and below the centroid of the lowest row of hammer faces. Too low and the box eats lock-plate or
  stock faces; too high and the hammer is cut through its middle.
- The box should be generous in x and z (a couple of centimetres of margin) — it only ever catches
  what is also inside the y band.
- The **hinge** is the hammer's base: the centre of the box in x and z, at the box's lower y. The
  contract wants every action vertex within .30 of it.
- Re-run and read the split line: `action split: N of M faces …`. A plausible flintlock hammer is
  tens to a few hundred faces. If N is in the thousands the box is catching the barrel or the stock.
- Look at the renders again. The cut follows whole faces, so the seam is slightly jagged; that is
  expected. What is not expected is `fill` appearing anywhere except at the hammer's base and in the
  matching socket in the lock plate.

If the hammer cannot be separated cleanly, ship without an action: leave `--action-box` off. The
runtime then draws no moving part and the reload stroke still plays.

## Manifest

`node tools/meshy/weapon-manifest.mjs [weapons-dir] [manifest.json]` reads every
`client/assets/weapons/*.glb` and writes `client/assets/weapons/manifest.json`:

```
{ schemaVersion: 1, weapons: { <kind>: { glb, sha256, bytes, triangles: { body, action },
  rootNode, nodes: { body, action, muzzle },       // node names; action is null when there is none
  muzzle: [x,y,z], hingePivot: [x,y,z] | null, hingeAxis | null,
  bounds: { min, max },                            // body ∪ action, node positions applied
  images: [{ name, mimeType, width, height, embeddedBytes }],
  materialNames, meshyTasks, plates, generator } } }
```

Everything except `meshyTasks`, `plates` and `generator` is measured from the GLB bytes (the image
dimensions come from the PNG IHDR / JPEG SOF header). Those three are merged in from the tracked
`tools/meshy/weapons/<kind>.tasks.json`, which is where the Meshy task id and the plate prompt ids
are recorded so a rebuild can re-download its inputs:

```json
{
  "meshyTasks": { "m2m": "01a092d5-6e56-73cf-95f6-def4c7d721a3" },
  "plates": ["side", "left"],
  "promptsFile": "tools/meshy/weapon-prompts.json"
}
```

The manifest is tracked, and `test/weapon-assets.test.js` pins the sha and byte count through it, so
adding a gun needs no test edit.

## Proving the pipeline without spending credits

`standin_pistol.py` builds a blocky pistol from primitives — barrel cylinder, ramrod, receiver,
raked grip, butt cap, trigger guard and a hammer deliberately on the gun's **left** — welds them
with boolean unions, subdivides, unwraps and paints a 512² checker, then rotates the whole thing
into a deliberately wrong frame (exported with the barrel along +X, the grip along −Z and the hammer
on +Y) so the fit's auto-detection has real work to do:

```
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/standin_pistol.py -- --out $SCRATCH/standin/standin-pistol.glb
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/build_weapon.py -- --in $SCRATCH/standin/standin-pistol.glb \
    --kind flintlock --out $SCRATCH/standin/pass1.glb --report $SCRATCH/standin/pass1.json \
    --allow-misfit
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/build_weapon.py -- --in $SCRATCH/standin/standin-pistol.glb \
    --kind flintlock --out $SCRATCH/standin/flintlock.glb \
    --action-box 0.04 0.241 -0.026 0.189 0.357 0.129 --hinge 0.114 0.241 0.051 \
    --hinge-axis -1 0 0 --texture-size 1024 --report $SCRATCH/standin/standin-report.json
node tools/meshy/weapon-manifest.mjs $SCRATCH/standin $SCRATCH/standin/manifest.json
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/render_glb.py -- $SCRATCH/standin/flintlock.glb \
    $SCRATCH/standin/renders --wide
```

The stand-in's output is a throwaway — **build it to a scratch path, not over the shipped
`client/assets/weapons/flintlock.glb`**, and never commit a checker-board pistol. Re-run
`node tools/meshy/weapon-manifest.mjs` afterwards if you did overwrite the real asset, and rebuild
it from the Meshy task above.

## Adding the next gun (burst, longshot)

The end-to-end workflow with its gates and the per-gun landmark table is the `/gun-update <kind>`
skill; in outline:

1. Add the kind's description to `tools/meshy/weapon-prompts.json` and generate its plates.
2. `node tools/meshy/meshy.mjs prop …`, `wait`, `download` — 30 credits each.
3. Add the kind's row to both `CONTRACTS` tables first (an unknown `--kind` refuses to build),
   then fit it with its own `--length`/`--bore-y`/`--muzzle-z` taken from `buildWeapon`'s muzzle
   vector. The long guns need a stock-wrist band in place of the pistol grip band and a fore-end
   where the support hand cups at z ≈ −.32 … −.35.
4. The flintlock and the scatter rotate a hammer (`action.rotation.z = -1.15 * open`); the
   repeater, burst and longshot **translate** a magazine or a bolt (`position += … * open`). Box
   that part, put `--hinge` at its attachment centre and pass `--hinge-axis 0 0 1` — an identity
   hinge frame — so the frame code's translation applies unchanged in gun space through the
   carrier chain in `client/weapon-models.js`. The repeater is the worked example: its section
   above has the box, the hinge and the scan that found them.
5. Record the task id in `tools/meshy/weapons/<kind>.tasks.json`, re-run
   `node tools/meshy/weapon-manifest.mjs`, add the URL to `WEAPON_ASSET_URLS` and a starting
   `WEAPON_ASSET_HANDLING` entry in `client/weapon-models.js`, then tune the anchors with
   `tools/qa/weapons/tune.mjs`.
