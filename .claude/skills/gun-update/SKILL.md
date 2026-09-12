---
name: gun-update
description: Upgrade the next procedural gun (repeater, burst or longshot) to a Meshy-built GLB the way the flintlock and the scatter were done — the lead plans, reviews plates/renders/shots and judges in-engine; Sonnet/Opus subagents generate, fit, wire, test and tune; credits are spent only after the lead approves the plates. Use when the user says "upgrade the next gun", "/gun-update <kind>", or asks for a GLB model of one of the guns.
argument-hint: <kind>   (repeater | burst | longshot)
---

# Gun update: one procedural gun → one Meshy GLB

This must work in a fresh window with no chat history. Authoritative references, read them first:
`docs/WEAPON_MODELS.md` (pipeline, gun-space contract, the flintlock's and the scatter's exact
commands), `client/weapon-models.js` (the runtime swap layer), `client/models.js` lines 617–720
(`WEAPON_HANDLING`, `buildWeapon`), `test/weapon-assets.test.js` (binary contract, per-kind
`CONTRACTS`) and `test/weapon-models.test.js`. The flintlock (pistol, 2026-09-11) and the scatter
(blunderbuss, 2026-09-11) are the worked examples; every number below was measured.

## Division of labour

- **Lead (you, the main session):** preflight, write the per-gun spec to the scratchpad, dispatch
  packages, look at plates / renders / studio shots yourself (the Read tool shows images), make the
  spend and fit decisions, run the full suite, commit, push, deploy, update docs and memory.
- **Subagents (writable `general-purpose`, always with an explicit `model`):** plates on
  `sonnet`; Meshy + Blender fit, runtime/test deltas and QA/tuning on `opus`. Give each the spec
  path, the worktree rules and a "report" list. Never let an agent submit to Meshy before the plate
  gate. If an agent dies with a rate-limit error, check disk state (`tools/meshy/weapons/<kind>.tasks.json`,
  `meshy_output/<kind>/`, the scratchpad renders) and resume it with `SendMessage` telling it exactly
  what already exists — never resubmit a Meshy task that was recorded.
- Budget per gun: one Meshy multi-image-to-3D submit (30 credits), one retry only if the lead judges
  the mesh unusable from the pass-1 renders; Gemini ≈ $0.15 per plate.

## Preflight (lead)

```
git status --short                      # only .claude/ untracked; note any peer edits
ListAgents                              # a peer session may share the checkout: stage explicit paths only
node tools/meshy/meshy.mjs balance      # must succeed; note the balance
ls C:/Apps/Blender/blender.exe          # Blender 5.2.1 headless is required
test -n "$GEMINI_API_KEY" && echo ok    # never print the key
```
Never `git stash`, `git clean` or `git add -A`; never QA against production port 3400; run everything
from the checkout you are in. Stop any 3401 server before `npm test`.

## Reference: gun space and the procedural guns

−Z forward (muzzle), +Y up, +X the lock/right side; units are the procedural pirate's, the navigator
draws guns at ×.78. Procedural landmarks (gun space, from `buildWeapon`); the GLB must land on the
muzzle, the bore height and the hand anchors, the rest guides the contract ranges:

| kind | body z | body y | body ǀxǀ | muzzle | action (procedural part, its box) | action motion per frame (`open` 0→1) | left anchor |
|---|---|---|---|---|---|---|---|
| flintlock | −1.00 … +.35 | −.355 … +.28 | .15 | (0, .13, −1.001) | loading gate, x −.13…−.10, y .02….12, z −.21…+.01, origin (−.115,.125,−.10) | `rotation.z = −1.15·open` | (−.24, −.17, .075) |
| scatter | −.96 … +.44 | −.355 … +.355 | .235 (muzzle flare) | (0, .12, −.967) | same gate as the flintlock | `rotation.z = −1.15·open` | (−.27, −.20, −.32) |
| repeater | −1.00 … +.45 | −.355 … +.35 | .21 | (0, .17, −1.0) | box magazine, x ±.085, y −.46…−.13, z −.26…−.03, origin (0,0,0) | `position += (−.26, −.12, 0)·open` | (−.265, −.18, −.32) |
| burst | −1.46 … +.45 | −.355 … +.35 | .21 | (0, .17, −1.46) | curved magazine, x ±.085, y −.47…−.09, z −.29…−.03 | `position += (−.26, −.12, +.04)·open` | (−.27, −.18, −.335) |
| longshot | −1.90 … +.45 | −.355 … +.62 (scope) | .21 | (0, .17, −1.9) | bolt handle, x .125….285, y .17….335, z −.035…+.075 | `position.z += .17·open` | (−.27, −.18, −.35) |

Right anchor for every gun: (.055, −.145, .21). The support hand cups the fore-end at z ≈ −.32…−.35
on the long guns, so the GLB needs a fore-end there; the firing hand needs a stock wrist/grip behind
the trigger. The frame code never changes; the swap layer maps its motion through the action's hinge
frame: for **rotating** parts (flintlock, scatter hammer) `hingeAxis [-1,0,0]` turns `rotation.z`
into a cock-back; for **translating** parts (repeater/burst magazine, longshot bolt) use
`--hinge-axis 0 0 1` (an identity frame) so the procedural translation applies unchanged in gun
space; put the pivot at the part's attachment centre (magazine top, bolt root).

Contract ranges are a guard against a mis-fit, not a design. They live in two identical `CONTRACTS`
tables, `tools/meshy/build_weapon.py` (verified at build time; an unknown `--kind` refuses to build)
and `test/weapon-assets.test.js` (verified from the shipped bytes; a manifest kind with no row
fails). The flintlock and scatter rows are shipped and stay verbatim. Starting points for the rest
(confirm after the pass-1 landmark print, widen only with a reason, and never loosen the muzzle
rule): repeater zMin [−1.10,−.90],
burst zMin [−1.56,−1.36], both zMax .60, yMin [−.65,−.25], yMax .55, ǀxǀ .25, action = magazine
below the receiver, y [−.60,.05], reach .40, translating; longshot zMin [−2.00,−1.80], zMax .60,
yMin [−.60,−.22], yMax .75 (scope), ǀxǀ .30, action = bolt on +X, y [.05,.45], reach .25, translating.
For the long guns use a stock-wrist band y [−.20,−.08] with centroid z [.05,.40] in place of the
pistol's grip band. Muzzle: y within .05 of the procedural bore, ǀxǀ ≤ .03, z within [zMin−.02, zMin+.06].

## Phase 0 — spec (lead)

Write `<scratchpad>/gun-update-<kind>.md`: the kind's description prompt (same palette words as
the flintlock: wood #825635, brass #e9b855, steel #334b5a; the repeater's magazine is teal #277f80;
the longshot's telescope is its high silhouette; the scatter's flared brass muzzle its wide one),
the per-kind contract ranges above, the fit arguments (`--length` = procedural span: scatter 1.40,
repeater 1.45, burst 1.91, longshot 2.35; `--muzzle-z` and `--bore-y` from the table), the action
plan (rotating or translating, which part) and the four packages below. Keep the flintlock's framing
text verbatim from `tools/meshy/weapon-prompts.json`.

## Phase 1 — plates (Sonnet) → lead gate

Add `weapons.<kind>` to `tools/meshy/weapon-prompts.json`, run
`node tools/meshy/weapon-plates.mjs <kind>` (side, then left and top from the side plate; outputs
under the gitignored `meshy_output/plates/<kind>/`). The agent looks at each plate and regenerates a
wrong one once. **Lead looks at side and left** and approves; the top plate goes to Meshy only if it
is a real top-down view (the flintlock's came back as a second side view and was dropped).

## Phase 2 — Meshy + Blender fit (Opus)

Exactly as `docs/WEAPON_MODELS.md`, in this order, and it first proves nothing: the pipeline is
already proven. `node tools/meshy/meshy.mjs prop <side> <left>` (30 credits) → `wait m2m <id>` →
`download m2m <id> meshy_output/<kind>` → write `tools/meshy/weapons/<kind>.tasks.json` → pass 1
`build_weapon.py --kind <kind> --length … --muzzle-z … --bore-y … --allow-misfit` (the kind's
`CONTRACTS` row from Phase 3 must already be in the script) →
`render_glb.py --wide` → the agent scans the pass-1 body in gun space for the action part (the
script's `hammerHint` is only a hint; on both guns so far it reached back into the frizzen) →
pass 2 with `--action-box`, `--hinge`, `--hinge-axis`,
`--texture-size 1024` to `client/assets/weapons/<kind>.glb` → `node tools/meshy/weapon-manifest.mjs`
→ `node --test test/weapon-assets.test.js` → renders of the shipped GLB. **Lead looks at the pass-1
side and three-quarter renders** (one clean gun, barrel −Z, lock on +X; this is the retry decision)
and at the shipped renders (fill only at the split seam). If the part cannot be split cleanly, ship
without an action and record it. Orientation lessons from the scatter: read the three auto votes in
the pass-1 log before trusting them. The muzzle-end vote compares the outer-25 % cross-sections
(`--muzzle-end wider` flips it for a gun whose muzzle is the fat end); bore levelling tracks the
front 2–35 % of the length by default and must be moved with `--level-band lo hi` onto a straight
stretch of barrel (the scatter used `.22 .52`, behind the flare and ahead of the pan); the lock-side
vote is the larger |x| reach above the bore near the breech and lost by .004 on a mesh with a side
plate on both flanks, so when its two numbers are within a few millimetres decide from the render
and pass `--lock-side +X`. Note the side render's screen-right is gun −Z (muzzle on the right).

## Phase 3 — pipeline, runtime and test deltas (Opus; runs in parallel with Phase 1, and its
`build_weapon.py` row must land before Phase 2's pass 1)

- `tools/meshy/build_weapon.py` and `test/weapon-assets.test.js`: add the kind's row to both
  `CONTRACTS` tables with identical numbers (the shipped rows stay verbatim; the grip rule takes an
  optional `zFrom`). Any new fit flag must default to today's behaviour, proven by rebuilding the
  flintlock from `meshy_output/flintlock/model_urls.glb.glb` with the docs' pass-2 flags to a scratch
  path: the Blender export is bit-reproducible, so the sha must equal the shipped one. The action
  rule must allow translating parts (negative y for magazines) — not yet done.
- `client/weapon-models.js`: add the kind to `WEAPON_ASSET_URLS` and a `WEAPON_ASSET_HANDLING`
  entry (start from the procedural anchors; Phase 4 tunes it). No other runtime change should be
  needed; if one is, the agent reports why instead of improvising in the frame code. Until the GLB
  exists every page load 404s on the new URL and logs one warning, so Phase 4 never runs before
  Phase 2 has shipped the file.
- `test/weapon-models.test.js`: move the "kind with no shipped asset" cases to a kind that still
  has none, and extend the handling cases for the new kind; a translating action needs a case
  proving the hinge chain carries the frame code's translation through unchanged.
- Run `node --test test/weapon-models.test.js test/presentation.test.js test/reload-animation.test.js test/airship-presentation.test.js test/player-character.test.js` (and the assets test once the GLB exists).

## Phase 4 — QA and hand tuning (Opus) → lead gate

Isolated server: `$env:PORT=3401; node server/index.js` (health at `/health`). Scripts in
`tools/qa/weapons/` (private Playwright runtime, headless Chrome):
`node tools/qa/weapons/capture.mjs --kind <kind>` (studio shot set + report.json: idle, aiming,
side close-up, gameplay distance, aim up/down, reload pinned at .49, gliding stowed, the other guns),
`node tools/qa/weapons/tune.mjs --kind <kind> --candidates <json>` (sets
`window.characterStudio.refs.gameModel.debug.weapons.<kind>.handling` live per candidate, captures
close-ups, logs palm-to-grip and support-palm-to-fore-end distances; aim for < .06 gun units),
`node tools/qa/weapons/game-check.mjs --kind <kind>` (join as Watcher, walk to a launch gate and
press E, glide, land, press the kind's digit key and wait for the visible `held-<kind>`, aim, fire;
the lobby is consumed per run, restart the server between runs; only the flintlock and scatter are
in the starting inventory, so the other kinds still need a pickup first). The landing spot is inside
the Driftwood Yard crab event, so the later frames show the knocked pose — the report's `heldGun`
block is the evidence. Tuned anchors so far: flintlock right (.055, −.025, .375) / left
(−.20, −.085, .28); scatter right (.02, −.05, .40) / left (−.228, −.086, −.28). The agent tries
the procedural anchors, then at least three candidates, looks at every shot, picks the one where
the grip sits in the firing palm with the fingers clear of the trigger guard and the support hand on
the fore-end (or the firing hand for a pistol), writes the values into `WEAPON_ASSET_HANDLING`
(and flips the swap-layer test that pinned the starting anchors to the flintlock-style
`notDeepEqual`), re-runs the tests and the full capture. **Lead looks at the side close-up, the
reload close-up and the in-game shot.** Expect zero console errors and warnings; the missing-asset
path is already covered (one warning, procedural gun).

## Completion (lead)

Stop the server. `node --test --test-concurrency=1 test/*.test.js` (all pass), `git diff --check`,
update the status line and the per-kind notes in `docs/WEAPON_MODELS.md`, commit explicit paths
(GLB, manifest, tasks json, prompts, tests, runtime, docs) with the Meshy task id and credits in
the message, push `HEAD:main`, deploy from a git-archive export
(`git archive HEAD | tar -x -C <scratch>/deploy && cd <scratch>/deploy && docker compose -p skywake-isles up -d --build --wait`),
verify `/health` and that `curl /assets/weapons/<kind>.glb | sha256sum` equals the manifest sha.
Report: what shipped, what was verified and how, credits spent and balance, and what the next gun
needs. Update the `weapon-model-pipeline-status` memory with the tuned anchors and anything that bit.
