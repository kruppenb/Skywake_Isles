# Skywake navigator — the player character

Status: **live player asset, under review.** `client/assets/player-character/navigator-meshy.glb`
is what `client/player-character.js` renders for every pirate on screen, local and remote. The
procedural `buildPirate` in `client/models.js` is still in the tree as the fallback that shows
while the GLB loads (or forever if it cannot load) and as the comparison model in the studio.
This document describes what is built, what is verified and how, and what still looks wrong.

## What this is

An original pirate character, "the Skywake navigator": a Gemini-painted concept (four A-pose
plates: front, back, left, right) turned into a mesh and texture by Meshy 7 multi-image-to-3D,
auto-rigged by Meshy, cleaned up and merged in Blender 5.2.1, with a numpy albedo pass for the
coat back and the crew-colour mask. Every step is a script in `tools/meshy/` plus recorded Meshy
task ids (listed in `client/assets/player-character/manifest.json` under `meshyTasks`); nothing
in the shipped asset is hand-edited.

It is not a bought pack and it is not a MakeHuman derivative: the earlier Blender-generated
prototype (`hero.glb`, its generator and the pinned CC0 anatomy input) was removed once this
asset replaced it; its history is in git.

## Pipeline (`tools/meshy/`)

| Step | Script | Input → output |
|---|---|---|
| Concept plates | `generate.mjs`, `views.mjs`, `prompts.json` | Gemini `gemini-3-pro-image` (key `GEMINI_API_KEY`) → four 2K plates of candidate A "Captain" |
| Mesh + texture | `meshy.mjs m2m` | plates → Meshy 7 multi-image-to-3D (ultra, A-pose, 40k tris, 2K albedo, no PBR) |
| Rig + clips | `meshy.mjs rig`, `meshy.mjs anim` | m2m task → rigged GLB with walking/running; idle from the library (action 0) |
| Albedo pass | `albedo.py` | rigged GLB + Meshy albedo + back plate → RGBA atlas with the coat back repainted and the crew mask in alpha, plus a JSON sidecar with the reference coral |
| Merge | `build_navigator.py` (Blender headless) | rig + three clip GLBs + RGBA atlas → one GLB: proportions, sockets, clips as NLA tracks, −Z forward, 2.75 m |
| Manifest | `manifest.mjs` | shipped GLB bytes → `manifest.json` (measured, not copied from inputs) |
| Checks | `glb_dump.mjs`, `inspect_glb.py`, `render_glb.py` | structure dumps and Blender turntable renders |

The exact build that ships:

```
python tools/meshy/albedo.py --glb <rig>/result.rigged_character_glb_url.glb \
    --albedo <m2m>/texture_urls.0.base_color.png --back <plates>/navigator-a-back.jpg \
    --out <scratch>/navigator_albedo.png --sidecar <scratch>/navigator_albedo.json
"C:/Apps/Blender/blender.exe" --background --factory-startup --python-exit-code 1 \
    --python tools/meshy/build_navigator.py -- \
    --rig <rig>/result.rigged_character_glb_url.glb \
    --clip idle=<anim-idle>/result.animation_glb_url.glb \
    --clip walk=<rig>/result.basic_animations.walking_glb_url.glb \
    --clip run=<rig>/result.basic_animations.running_glb_url.glb \
    --albedo <scratch>/navigator_albedo.png --sidecar <scratch>/navigator_albedo.json \
    --head 1.38 --hands 1.25 --feet 1.2 --torso 1.14 \
    --out client/assets/player-character/navigator-meshy.glb
node tools/meshy/manifest.mjs
```

`meshy.mjs` reads `MESHY_API_KEY` from the environment or, failing that, the key registered for
the Meshy MCP server in `~/.claude.json`; it never prints it. Meshy task downloads expire after a
few days, so the originals must be re-downloaded from the recorded task ids
(`node tools/meshy/meshy.mjs download <kind> <id> <dir>`) before a rebuild.

### What the Blender merge does to Meshy's export

Meshy's rigged GLB needs the same cleanup every time: the armature comes in at 0.01 scale with
centimetre bones (the mesh data is already metres), a helper Icosphere is included, the albedo is
wired into emission (unlit in three.js), the importer parks the static clip in an NLA track, and
the leaf bones (hands, toes, head_end) have meaningless tail lengths. `build_navigator.py` bakes
the scale into bones, clip location curves and vertices, deletes the junk, strips emission, spins
the root half a turn to face −Z, scales to 2.75 m with the soles on y = 0, adds the five socket
bones with fixed metre offsets along real bone pairs, gathers the clips as NLA tracks and exports.

**Proportions.** The chunky adventure look is pushed by scaling vertices, not bones: each vertex
moves about a pivot (chin line for the head, wrist for the hands, sole for the boots, spine for
torso width) by `1 + (factor − 1) × skin weight`. No bone or clip changes, so every Meshy/Mixamo
clip still applies. Shipped factors: head ×1.38, hands ×1.25, feet ×1.2, torso width ×1.14
(depth ×1.084). Stronger head factors start to stretch the neck blend and were not used.

**Coat back.** Meshy lost the vent, the coral lining and the back belt tab. `albedo.py` projects
the back plate orthographically onto back-facing coat texels (region |x| < 0.22 m, 0.62–1.33 m up,
normal facing +Z in Meshy's frame), classifies each plate pixel as coat blue, coral or gold, and
paints it with the atlas's own colour for that class (the texel's existing blue, the front lapels'
measured coral, the front piping's measured gold) modulated by the plate's relative shading. A
Meshy retexture with the four plates (10 credits, task `01a091d8-…`) was tried first: it recovered
the belt tab but not the vent or lining, so the projection is what ships.

**Crew colour.** The coral lapels, cuffs, collar, sash and lining are one atlas. `albedo.py`
classifies coral texels by chromaticity (red/green and green/blue ratios, saturation, value),
excludes face and hand texels by skin weight (so lips and skin never tint), cleans and feathers
the mask, grows it into the chart gutters, and stores it in the PNG alpha channel. The material
stays `OPAQUE`; its extras carry `crewMask: "baseColorAlpha"` and `crewReference`, the measured
mean coral. The runtime shader (`installCrewTint`) computes
`mix(albedo, clamp(albedo / reference × tint), alpha)` per texel, so the painted shading survives
and each player's material clone has its own tint uniform. The headband, brass buttons and ivory
piping are deliberately outside the mask.

## Asset contract (`test/player-character.test.js`, 12 tests)

The contract was revised from the Blender prototype's 20 renamed bones to Meshy's skeleton, on
purpose: keeping the Mixamo names keeps every Meshy/Mixamo library clip retargetable for free,
and the runtime does not need renamed bones. The test file has its own glTF-binary reader and PNG
decoder and imports nothing from the runtime or the tools. Every exact number was measured from
the shipped bytes; `manifest.json` is cross-checked against those measurements.

- **Container and identity**: valid GLB, JSON+BIN account for every byte, 6,553,672 bytes,
  SHA-256 `73230004…57a04666`, ≤ 8 MiB.
- **Scene**: one root `SkywakeNavigator` rotated a half turn about Y (Meshy faces +Z; the game
  faces −Z) with uniform scale 1.4843; one skin; one skinned mesh node.
- **Skeleton**: exactly 29 joints = Meshy's 24 (`Hips`, `Spine02→Spine01→Spine`, `neck`, `Head`,
  `head_end`, `headfront`, `Left/RightShoulder/Arm/ForeArm/Hand`,
  `Left/RightUpLeg/Leg/Foot/ToeBase`) plus the five sockets, no duplicates; the 16 bones the
  runtime drives must be present.
- **Sockets**: `weapon_grip.L/R` and `glider_grip.L/R` are leaf joints directly under
  `LeftHand`/`RightHand`, `stow_back` directly under `Spine`, each proven by walking the node
  ancestry, carrying zero skin weight. Note that three.js's `GLTFLoader` strips the dot from node
  names (`weapon_gripL`), which the runtime accounts for.
- **Geometry**: one TRIANGLES primitive, 41,357 triangles (≤ 50,000), finite positions, normals
  and in-range UVs, fully skinned; weights in [0,1] summing to 1 within 2e-3, > 25 % of vertices
  blending two or more joints.
- **Material**: exactly one, `navigator`, `OPAQUE`, textured, metallic 0, no emissive texture,
  extras `crewMask = "baseColorAlpha"` and `crewReference` within 0.01 of the measured
  (0.698, 0.398, 0.352).
- **Texture**: exactly one embedded 2048² 8-bit **RGBA** PNG (decoded in the test) whose alpha is
  a sparse mask covering 3–15 % of the atlas (measured 6.8 %) with feathering only at edges;
  22,369,620 decoded mip bytes (≤ 32 MiB).
- **Clips**: exactly `idle` (4.033 s), `walk` (1.067 s), `run` (0.667 s); each keys all 29 joints
  on translation, rotation and scale (87 channels), finite and time-ordered, with real rotation.
- **Bounds and facing**: soles on y = 0 within 2 cm, 2.65–2.9 m tall, A-pose centred on X with a
  1.3–1.7 m span; from the rest skeleton (own quaternion math) the stow socket is behind the
  spine (+Z), `headfront` is in front of the head (−Z), the left hand is on −X.
- **Export hygiene**: no cameras or lights; `extensionsRequired` empty; only
  `KHR_materials_specular` and `KHR_materials_ior` used (Blender's Principled export; supported
  by three r180), nothing needing a decoder.
- **Manifest drift**: joints, materials, clip channel/sampler counts, socket ancestry, bounds,
  triangle count, the tint convention and the image channel count all agree with the bytes.

Run with `node --test test/player-character.test.js`; it is part of `npm test`.

## Runtime (`client/player-character.js`)

`buildPlayerCharacter(palette, color)` returns the same object shape as `buildPirate`
(`group`, `animate(time, speed, player, pose)`, `fire(weapon)`, `getMuzzle(target)`) so
`client/world.js` only changed its import. Inside:

- The GLB is fetched once per page (`loadNavigatorAsset`), its geometry and texture flagged
  `userData.shared` so `world.js`'s `disposeObject` never frees them when one pirate leaves.
  Each pirate is a `SkeletonUtils.clone` with its own material clone and tint uniform
  (`utils/SkeletonUtils.js` was added to the server's served three addons).
- While loading, or if loading or rig lookup fails, the procedural pirate is shown; the swap
  happens in place and is logged once. In Node (tests) the loader never starts.
- Locomotion: an `AnimationMixer` blends idle / walk / run by speed (walk in by 4.5 m/s, run
  cross-fades over 3–6.5 m/s). Walk and run are parked and stepped by a distance-driven cycle
  (2.2 m per walk cycle, 3.2 m per run cycle) so feet plant at any speed and the cross-fade keeps
  one footfall; idle runs on the clock. Meshy's library idle is a look-around that turns the hips
  54° and the head 56°, so it plays at a quarter of its motion against a hold pose built from its
  own first frame: the pirate keeps facing its aim with breathing and small glances (measured
  head travel 16 cm, shoulder travel 15 cm per loop, down from about 54 cm). Remote players get
  their speed from the interpolation layer exactly as before.
- Every hand target is `buildPirate`'s: the `WEAPON_HANDLING` stances, `sampleReloadAnimation`
  strokes, recoil, the glider grips at (±.70, 2.29, −.17) and the mounted cannon rails. The
  weapon rig lives in a "torso" group placed so the navigator's shoulders sit at the procedural
  shoulder line; stances are pulled toward that line by the arm-reach ratio (0.74 m navigator vs
  1.09 m procedural, depth kept at 90 %) and the same reach clamp nudges the gun into range. The
  guns are drawn at 0.78 scale for this character; muzzle sockets scale with them.
- After the mixer poses the body, the arms are overwritten in figure space: analytic two-bone IK
  from the live shoulder joint to the wrist target, the upper arm and forearm aimed from their rest
  orientations with a twist so the elbow crease faces the forearm and the wrist follows the palm,
  and the hand bone given an explicit grip basis (fingers forward-down and palm inward on the
  firing hand; palm up and in on the support hand; palms inward on the glider bars). Head pitch
  follows `player.pitch`; gliding trails the legs, knockback folds them and tilts the figure, both
  as additive bone rotations.
- The stowed gun (gliding) hangs off a stow rig placed from the `stow_back` socket's rest
  position; weapon visibility, action-mesh reload motion, the contact shadow and `getMuzzle`
  are unchanged from `buildPirate`.

## Studio (`/character-studio.html`)

`npm start` (or `PORT=3401 node server/index.js`), then `http://localhost:3401/character-studio.html`.
The page loads `navigator-meshy.glb` by default; `?glb=/assets/player-character/<file>.glb`
loads another served asset such as a candidate rebuild (only same-origin `/assets/…*.glb`).
Controls:

- **View** — Prototype (raw asset + its clips), Current player (procedural), Side by side,
  **Game model** (the live `buildPlayerCharacter` renderer beside the procedural pirate, both
  driven by the Pose panel).
- **Pose (game model)** — weapon, ground / gliding / aboard-with-gun, aim, reload (a real stroke
  from the moment pressed), knocked, fire (one recoil kick), aim pitch, speed still/walk/sprint.
  `window.characterStudio.setPose({ reloadProgress: 0.49 })` pins a stroke for screenshots.
- **Camera** — Front, Three-quarter, Back, Face, Gameplay distance. Fitted presets are fractions
  of the measured subject height, so the 2.75 m navigator and the 3.27 m procedural pirate both
  frame correctly.
- **Lighting** — Neutral studio / Island lighting (the game's ACES exposure 1.18 and light
  values). Judge colour under Island lighting; Blender's AgX renders read washed out.
- **Animation**, **Crew accent** (coral, teal, sand, tide, lilac, rose, gold), **Surface**,
  **Turntable**, **Loaded asset** report — as before; the crew swatches drive the alpha-mask
  tint on the navigator and rebuild the procedural pirate in the same colour.

`window.characterStudio` exposes `getState()`, `setMode/setCamera/setLighting/setClip/
setCrewColor/setPlaying/setPose/fire/rotate` and `refs` (scene, mixer, actions, gameModel) for
scripted inspection; nothing in the game reads it.

## What was verified, and how

Studio (headless Chrome via Playwright driving `window.characterStudio`, island lighting,
screenshots kept in the review sheet): front, back, three-quarter, face and gameplay-distance
views; all seven crew swatches (mask edges clean, no tint on skin, lips, buttons or piping); the
projected coat back (belt tab, pocket-flap piping, vent lining); idle, walk and run clips; the game
model holding all five guns (three-quarter, front, right-side close-ups), aiming up and down,
mid-stroke reloads for all five guns, gliding on the glider grips, knockback, the mounted-cannon
pose, walking and sprinting, side by side with the procedural pirate at gameplay distance. No
console errors or warnings in any run.

In game (isolated server on port 3401, `?test=1`, synthetic key/mouse events, WebSocket bot crew;
never against the production container): both the local player and remote bots render as the
navigator (no procedural fallback left on screen), the lobby deck with two crew colours, the
voyage drop and glide (two pirates on their gliders), landing, walking, sprinting, aiming at three
pitches, firing, mid-stroke reloads of the flintlock and scatter blaster, and seven pirates in
different crew colours. **Not verified in game:** the repeater, burst and longshot reloads (a
fresh crew only owns the first two guns; the other three strokes were checked in the studio with
pinned reload progress), the mounted-cannon pose (the scripted bot never reached a cannon; checked
in the studio only) and knockback (needs a downing hit; studio only). The headless run reports a
vsync-capped 60 fps with one and with seven navigators; that is a software-ANGLE number and says
nothing about a real GPU beyond "no obvious regression".

Tests: `node --test test/player-character.test.js` (12/12) and the full `npm test` suite
(333/333 on 2026-09-11) pass on the shipped bytes.

## Known visual residuals (found by looking, not by the tests)

- No finger bones. Hands are rigid wrists posed by IK: at gameplay distance the grips read, in
  close-up the fingers do not curl around grips or fore-ends and the support hand can float a
  few centimetres off the wood.
- The vent lining on the coat back is a thin coral wedge with a slightly serrated edge; the belt
  tab and pocket-flap piping are good. The back is still softer than the front.
- Meshy's atlas is soft on the beard, hair and hat brim, and a few light seam flecks run along the
  coat's front edge and one sleeve seam.
- The stowed gun while gliding sits behind the shoulder blades from a fixed rest offset; it does
  not follow spine motion.
- Knockback and the mounted-cannon pose are lean-and-IK approximations with no dedicated clip.
- The idle is Meshy's look-around damped to a quarter; the small glances that remain are the
  intended amount, and the raw clip still plays undamped in the studio's Prototype view.
- The remaining hue-mask edge cases: a few coral texels on the collar's underside tint with the
  crew colour (intended) and the headband stays coral (intended); both are choices, not bugs.

## Files

| Path | Purpose |
|---|---|
| `client/assets/player-character/navigator-meshy.glb`, `manifest.json` | Shipped asset and its measured manifest |
| `client/player-character.js` | Live renderer, loader, crew-tint shader |
| `client/models.js` | Procedural fallback (`buildPirate`), shared `buildGlider`, `WEAPON_HANDLING`, weapons |
| `client/world.js` | Uses `buildPlayerCharacter`; disposal skips shared GLB resources |
| `client/character-studio.html/.css/.js` | Inspection studio with the Game model view |
| `tools/meshy/*` | Pipeline scripts (see table above) |
| `test/player-character.test.js` | Binary contract tests |
