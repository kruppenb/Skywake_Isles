# Skywake weapons — GLB models

Status: **gun 1, the flintlock, is built** (`client/assets/weapons/flintlock.glb`, Meshy task
`01a092d5-6e56-73cf-95f6-def4c7d721a3`); the other four guns are still `buildWeapon`'s procedural
meshes. This document describes the pipeline that turns a concept plate into
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

`meshy.mjs` reads `MESHY_API_KEY` from the environment or, failing that, the key registered for the
Meshy MCP server in `~/.claude.json`; it never prints it. Meshy downloads expire after a few days,
so re-download from the task id recorded in `tools/meshy/weapons/<kind>.tasks.json` before a rebuild.

## What the Blender fit does

`build_weapon.py` takes a Meshy prop straight out of `download` and does everything the export
leaves undone. Its flags are `--in --kind --out [--length 1.30] [--bore-y .13] [--muzzle-z -1.0]
[--forward auto|±X|±Y|±Z] [--up auto|…] [--lock-side auto|+X|-X] [--action-box x0 y0 z0 x1 y1 z1]
[--hinge x y z] [--hinge-axis -1 0 0] [--bore-from muzzle-face|band] [--texture-size 1024]
[--texture-format auto|png|jpeg] [--report <json>] [--allow-misfit]`.

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
   - *Muzzle end*: whichever end has the smaller cross-section over the outer 25 % of the length.
   - *Grip*: the half, perpendicular to the barrel, holding the vertices further than 30 % of the
     length from the bore axis — that half becomes −Y. The bore axis for that test runs through the
     centre of the barrel's cross-section at the muzzle face, not through the centroid of the front
     slice: the fore-end, ramrod and trigger guard drag a centroid far enough below the bore to hide
     the butt from the test. A gun whose grip is shallow enough that 30 % still finds nothing (the
     flintlock is one) drops the threshold in 5 % steps and says so.
   - *Bore levelling*: a PCA axis is pulled off the bore by anything parallel but offset (a ramrod,
     a fore-end), which leaves the gun a degree or two nose-up and the muzzle socket off the barrel.
     The barrel's top and side silhouettes are tracked across the front third and the frame is
     rotated (median slope, so one odd slab cannot swing it) until they run parallel to gun Z.
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
   and measures every contract landmark from those bytes — the printed table and the `--report`
   JSON are measurements of the shipped file, not of the Blender scene. A miss exits 1 unless
   `--allow-misfit`.

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

## Adding the next gun (scatter, repeater, burst, longshot)

1. Add the kind's description to `tools/meshy/weapon-prompts.json` and generate its plates.
2. `node tools/meshy/meshy.mjs prop …`, `wait`, `download` — 30 credits each.
3. Fit it. The defaults are the flintlock's; the others are longer, so pass their own
   `--length`/`--bore-y`/`--muzzle-z` taken from `buildWeapon`'s muzzle vector for that kind
   (e.g. the scatter's muzzle is (0, .12, −.967)). The contract ranges in this document are the
   flintlock's and will need the same treatment as the procedural landmarks for a long gun.
4. Only the scatter has a moving action in the frame code (`action.rotation.z = -1.15 * open`); the
   repeater, burst and longshot move a magazine or a bolt, so pick the `--action-box` around that
   part and set `--hinge-axis` to whatever makes −1.15 rad open it.
5. Record the task id in `tools/meshy/weapons/<kind>.tasks.json`, re-run
   `node tools/meshy/weapon-manifest.mjs`, add the URL to `WEAPON_ASSET_URLS` in
   `client/weapon-models.js`. `test/weapon-assets.test.js` iterates the manifest, so it picks the
   new gun up without an edit.
