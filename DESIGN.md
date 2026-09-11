# Skywake Isles — original implementation contract

## Intent and boundaries

Create a new, genuinely playable 1–5 player browser co-op pirate adventure on
the family LAN. The user explicitly says Rustbeard is only a similar prototype
and **must not be copied**. Do not read, copy, adapt, or import Rustbeard code,
models, assets, tests, documentation, saves, or its gameplay design. All source
and procedural art in this project are original. Three.js and ws are general
purpose dependencies. No accounts, external services, telemetry, or CDN runtime.

Only modify C:/repos/skywake-isles. Sibling projects are out of scope. No
subagent starts servers, containers, or commits. Use apply_patch for source
edits. Do not overwrite another package's files. The lead integrates and tests.

Title: **Skywake Isles**. A sky pirate crew recovers three lost compass shards
from a lush jungle, an amber caldera, and a glowing moonlit grove, then restores
the island's central lighthouse by defeating the mischievous Tempest Crab.
No PvP, no gore, no punishment for falling or being knocked down. Solo works.

## Packages / ownership

1. Server agent owns package.json, Dockerfile, compose.yaml, .dockerignore,
   .gitignore, shared/**, server/**, test/**, README.md, CREDITS.md.
2. World agent owns client/world.js and client/models.js (and optional
   client/world-*.js). Owns all original Three.js geometry and rendering.
3. Client agent owns client/index.html, client/style.css, client/main.js,
   client/net.js, client/input.js, client/ui.js, client/audio.js, favicon.svg.
4. Lead owns this spec, integration decisions, scratch verification probes,
   screenshots and verification report. Agents coordinate API changes first.

## Stack / runtime

Node 22 ES modules. Runtime dependencies pinned: three 0.180.0, ws 8.21.3.
No bundler. Browser importmap maps `three` to `/vendor/three.module.js`;
server serves both three.module.js and its sibling three.core.js from
node_modules/three/build. All other assets are original procedural geometry,
canvas, CSS, SVG, or synthesized audio. Nothing downloaded at browser runtime.
Single HTTP + ws process binds 0.0.0.0, default port 3400. Docker service and
container `skywake-isles`, published `3400:3400`, named volume for /app/data,
restart unless-stopped, healthcheck /health, init true. No external ports other
than 3400. DATA_DIR override for isolated test saves. JSON writes atomic.
/health returns {ok:true,game:'Skywake Isles',players,phase,version}.
Serve JS/HTML/CSS with no-cache; validate paths, reject malformed URLs safely;
no file outside client, shared or explicitly whitelisted vendor files exposed.
Graceful shutdown clears timers, closes sockets, persists aggregate victories.

## Visual plan (reviewed against brief)

The memorable element is the actual island and flying galleon, visible behind
the welcome UI and during play. Cel-shaded original chunky geometry, sunlit
colors, stepped shading, directional shadows, round expressive pirates.
Use MeshToonMaterial with a small nearest-filter gradient ramp. No costly
postprocessing chain. Cap DPR at 1.5, allow a low quality setting at DPR 1.
Large repeated props should use shared geometry/materials or instancing.

Palette: sky #85d9ff, ocean #168eaf, sand #f4d89a, foliage #3b9e69,
UI ink #123c51, UI highlight #ffd16c. Caldera ochre/coral, Moonbloom lilac/cyan.
Type: rounded humanist system stack ('Trebuchet MS','Segoe UI',sans-serif),
heavy tightly spaced large game title; familiar legible body at 16–18px.
Welcome: left aligned title, short story, name + five crew colors, one clear
Board the ship button. The right side shows the animated world. Lobby has the
crew roster and host's Set sail button, concise controls, a real ship backdrop.
HUD: objective top left, compact crew list below; minimap top right, central
reticle; health and two weapons bottom left, interact hint low center. Keep
the center clear for exploration and combat. Gold denotes shared objectives.
Responsive menu at 720px; desktop keyboard/mouse is the supported play mode.
Small touchscreens receive a clear keyboard/mouse notice, no false claims.
Use real semantic buttons/labels, visible focus, mute option, reduced motion.

## Shared world contract — server agent creates

`shared/world.js` exports:
- MAX_PLAYERS = 5, WORLD_RADIUS = 138, SHIP_DURATION = 28;
- SEED = 271828 (fixed designed terrain; seed controls decor only initially);
- COLORS array of five hex strings for crew colors;
- SPAWN = {x:0,z:94}; BEACON = {id:'beacon',x:0,z:4};
- REGIONS: [{id,name,x,z,radius,color,accent,description}]. IDs/names:
  beach / Sunwake Strand (0,94), jungle / Palmheart Wilds (-68,12),
  volcano / Emberpeak Caldera (48,-65), moon / Moonbloom Grove (76,32),
  haven / Tideglass Haven (0,4). All main routes walkable and broad.
- SHRINES: [{id,region,name,x,z,color}]. IDs palm (-68,12), ember (48,-65),
  moon (76,32), region matching jungle/volcano/moon respectively.
- CHESTS: at least 15 deterministic {id,x,z}; 3 easily visible near spawn;
- OBSTACLES: deterministic [{id,x,z,radius,height,type}] for rocks/trees/huts
  that block movement; keep all shrine/beacon/spawn centers + approach clear.
- heightAt(x,z): continuous terrain height, sea is y=0; walkable island
  plateaus about 2–8m, stylized hills localized away from the routes.
- regionAt(x,z): returns the region OBJECT, never just an ID.
- shipAt(elapsed): {x,y,z,yaw}; original galleon starts at (0,62,102) and
  cruises toward z=-60 over SHIP_DURATION. Deck surface is at returned y.
  At elapsed=0 this is also the lobby ship position.
- seededRandom(seed): returns a deterministic random() closure.

`shared/movement.js` exports `movePlayer(p,input,dt,elapsed)` and
`makePlayerPosition()` returning the movement fields described below.
Pure, no I/O. dt in seconds, clamped maximum 0.05. Mutates p and returns p.
Input: {forward,right,sprint,jump,yaw,pitch}; forward/right in [-1,1],
yaw/pitch radians. yaw=0 looks toward -Z, increasing yaw looks left.
Direction: x=-sin(yaw)*forward+cos(yaw)*right;
z=-cos(yaw)*forward-sin(yaw)*right. Normalize diagonal input.
Movement fields: x,y,z,yaw,pitch,vy,mode ('aboard'|'gliding'|'ground'),
jumpHeld,grounded. y is feet position. Walk 8m/s, sprint 11, jump velocity
8, gravity 22; descending from a high jump automatically glides at -6m/s.
While aboard, follow shipAt(elapsed), allow deck movement within +/-4 x,
+/-8 z via deckX/deckZ. Aboard is a durable safe state: movement never leaves
the ship, jump only releases a mounted gun, and no timer drops anybody.
Departure is an authoritative jump-gate interaction (see below), not a
movement outcome. Lobby caller passes elapsed=0 and suppresses jump.
Gliding steers freely; on landing y=heightAt and mode='ground'. Water/safety
boundary returns player to SPAWN safely. Circle obstacle collision, slope
following, no falling damage. A knocked player cannot move (caller enforces).

## Network / simulation contract — server agent

20Hz simulation, snapshots 15–20Hz, input at 20Hz. Server owns movement,
hits, enemies, objectives, health, respawn, rewards. Client predicts movement
using shared movePlayer and reconciles against snapshots. Clamp inputs and
reject NaN, oversized packets, unknown actions, excessive fire, distant
interactions. Never rely on client-supplied damage or enemy positions.

Client -> server:
{type:'join',name,color,token?}: name max 16 printable chars, color one of COLORS.
{type:'input',seq,forward,right,sprint,jump,yaw,pitch}
{type:'action',action,target?}: action enum ready,launch,fire,melee,reload,
interact,heal,ping,swap,restart. swap target='flintlock'|'scatter'.
{type:'leave'} for explicitly leaving.

Server -> client:
{type:'welcome',id,token,state}; token is random reconnect secret.
{type:'snapshot',state}; {type:'event',event}; {type:'error',message,code?}.
An unauthenticated socket may receive hello; client ignores unknown types.
One token per browser tab (sessionStorage), saved name/color in localStorage.
Allow five online players, reject sixth with clear error; disconnect reserved
for 60s and reconnect into same character. Reassign host on host disconnect.
Late joins allowed; drop from safe area then join the current shared progress.

State shape, all fields always present:
{phase:'lobby'|'voyage'|'finale'|'victory',elapsed,seed,round,hostId,
 players:[],enemies:[],shrines:[],chests:[],pearls,shards,bossId:null|string,
 finale:{stage,stages,remaining,sky?},
 pings:[],stats:{wins,voyages,bestPearls},victory:null|{pearls,duration,rescues,kills}}
finale.stage is 0 until the beacon is lit, then the 1-based index into
shared/finale.js FINALE_STAGES; stages is that list's length; remaining counts
the stage's living and still-forming enemies (boss minions excluded).
finale.sky is present ONLY while the skycrab siege (the airship stage) runs as
the real, current, last stage of phase finale; a forced stage number, a torn
down lifecycle, victory, lobby and the first three stages all publish no sky
block at all, so older clients are unchanged. It is live state, never an event history, and every array
is bounded: at most SKY_BOSSES.length (2) bosses and SKY_BOMBARD_MAX_ACTIVE (2)
shells, so a late joiner reads the whole fight from one snapshot.
{status:'boarding'|'countdown'|'active'|'cleared',countdownEndsAt,wave,waves,
 groundActive,groundPending,groundFuture,nextWaveAt,
 bosses:[{id,name,x,y,z,yaw,hp,maxHp,radius,state:'flying'|'winding'|'down'}],
 bombardments:[{id,bossId,x,y,z,impactX,impactY,impactZ,radius,launchAt,impactAt}]}
All of those times are absolute state.elapsed seconds like knockedUntil, and 0
when they do not apply. boarding waits for any able pirate at a cannon,
countdown is the shared SKY_COUNTDOWN grace after that latch, active runs the
fight and is the only status the completion guard answers true for; cleared is
the terminal state completeIsland() latches after that guard has already
passed. wave is 0 before the first
ground wave, then 1..waves; groundActive counts living stage enemies,
groundPending the ranks still forming up and groundFuture the waves that have
not started, so the HUD never reads an inter-wave gap as a cleared objective.
wave is the number of waves actually placed on the island, never a display
cursor that can run ahead of them.
A boss keeps its stable id for the whole stage and lingers for
SKY_BOSS_DOWN_LINGER after death before leaving the array. Sky boss x,y,z is
the CENTRE of the radius hit sphere (like flyingTargets, unlike Enemy.y which
is feet), a bombardment's x,y,z is its launch point at the boss and impact* the
ground point its warning ring marks. Sky bosses are never in enemies[] and
never practice flyingTargets, which are hidden for the whole stage.
Player public fields:
{id,name,color,online,ready,x,y,z,yaw,pitch,vy,mode,jumpHeld,grounded,
 deckX,deckZ,hp,maxHp,ammo,maxAmmo,weapon,reloadUntil,healUntil,
 knockedUntil,invulnerableUntil,lastInputSeq,kills,rescues,chests}
knockedUntil=0 means active, otherwise absolute state.elapsed timestamp.
Enemy: {id,type:'crab'|'spitter'|'tidebreaker'|'tempest',x,y,z,yaw,hp,maxHp,
 radius,state:'idle'|'chase'|'windup'|'attack',attackAt,zone,scale,attackRadius};
tempest is the boss; tidebreaker is the optional-defense mini boss. Base
stats per type live in shared/enemies.js. Enemy y is feet position.
Shrine dynamic fields: {id,status:'dormant'|'active'|'cleared',charge,
 remaining}; charge is retained for snapshot compatibility (0 until capture,
then 1), remaining is the number of living shrine guards; there is no hold timer.
Chest: {id,opened}; static positions from shared constants.
Ping: {id,playerId,x,z,expiresAt}.
Events always {kind,...}; common kinds:
shot {playerId,from:{x,y,z},to:{x,y,z},weapon,hitId?,damage?},
hit {targetId,damage,x,y,z,sourceId?}, defeated {id,x,y,z,type},
chest {id,playerId,pearls,weapon,rarity,dropId},
loot {id,playerId,weapon,rarity,upgraded} (a pirate equipped drop id),
salvage {id,playerId,weapon,rarity,pearls} (a pirate who already carried an
equal or better gun walked over drop id; it is hidden for them and the crew
gained pearls), shrine {id,status}, heal {playerId},
downed {playerId}, revive {playerId,by?}, ping {playerId,x,z},
phase {phase}, notice {message}, victory {pearls,duration,rescues,kills},
side-event {id,status,wave,reward?,spawns?:[{type,x,z,delay}]} (spawns only
when a wave forms; delay is the seconds until that rank breaks the surface;
clients stage the surge and its banner from this event, never from
snapshots), finale {stage,stages,spawns:[{type,x,z,delay,from?}]} (one per
stage start; from names the shrine whose direction a wave unit comes from; the
airship stage announces itself with an empty spawns list because its ground
waves form later), sky-wave {wave,waves,spawns:[{type,x,z,delay,from?}]} (one
per skycrab-siege ground wave, staged like a finale surge without re-announcing
the stage banner). A skycrab bombardment reuses the existing telegraph and
splash events, and a downed one emits defeated {id,type:'skycrab',x,y,z}.
World/client tolerate extra fields and unknown events.

Loop: host presses Set sail (launch) in lobby, all online crew begin aboard,
phase voyage elapsed reset to zero. Crew stay aboard until they walk onto one
of the two SHIP_JUMP_POINTS gates and press E; the same rule applies on the
opening voyage and on every later visit, and nothing ejects an idle pirate.
interactAboard dispatches an aboard E: a mounted press only releases the
station, otherwise jumpPointFor resolves a gate from deckX/deckZ using
JUMP_INTERACTION_RANGE and a clear deck route past SHIP_OBSTACLES (no
replicated in-zone flag). Both branches require phase voyage or finale. The
server, never the client, supplies the launch pose: shipAt(elapsed) plus the
gate's authored launch offset, which clears the rail, rendered hull, gunwale
and bowsprit at every flight time and while parked, then mode='gliding' with
vy=-6 and an airship-jump event. Three shrine quests any order:
E within 4m starts a shrine, spawning 3–11 guards scaled with the crew size.
Defeating its last living guard captures it immediately, with no proximity or
charging requirement. Cleared shrine grants shared shard, 25 pearls and checkpoint;
nearby living crew are healed. E within 4m (full 3D range, grounded, living,
line of sight) of a captured shrine returns the pirate to the boat during voyage
or finale, preserving equipment and using the existing airship-return event.
The shared shrine-return eligibility drives both the prompt and cyan model cue.
No respawning shrine guards or endless alarm. A few optional roaming crabs
stay away from the initial beach. Optional defenses (shared/side-events.js):
E at the cyan supplies of the market, farm or yard starts a once-per-voyage,
three-wave surge that never touches the shard quest. Attackers form ranks on
the seaward side of the supplies (bearing from the island centre, a 60 degree
half-arc, first rank at the site's front distance, later ranks 5m further
out with every other unit 2.5m deeper still, the yard's front on the surf
line) and walk the two-leg route the server validated at spawn when a
building blocks the straight approach. Ranks break the surface 2.5s apart
(spawns queue on the event and count toward remaining until they appear), so
a wave arrives as a stream rather than a clump; spitters form a rank behind
the crabs and Tidebreakers a rank behind the spitters.
Rosters latch to the starting crew: wave 1 crabs only, wave 2 adds spitters,
the final wave adds one Tidebreaker mini boss per two pirates. Supplies
hold 100 integrity, crabs strip 8 and Tidebreakers 14 per hit, the deadline
is 180s, and the reward is 45 pearls plus a local heal. Chests open when a
living landed pirate walks within 2m with line of sight (the server still
accepts an explicit E target within 3.5m for older clients; the client shows
no E prompt for chests), give 12 shared pearls and heal; the rolled gun lands
on the chest and is collected by walking within 2m, usually on the same tick.
A pirate already carrying an equal or better copy salvages it instead: the
drop is added to their collectedDropIds (hidden for them only) and the crew
gains SALVAGE_PEARLS (5); no competition for loot. Three shards unlock BEACON.
E at BEACON starts the finale, which runs through shared/finale.js
FINALE_STAGES in order with a 4s pause between stages; the voyage is won when
the last stage is cleared, and a stage is appended (never inserted before
the boss by assumption) to extend the battle. Rosters latch to the crew that
lit the beacon. Stage 1: crabs form ranks 38m out along the bearing from the
lighthouse toward each shard's shrine (3 per shrine +1 per extra pirate,
ranks 2.5s apart, each shrine direction 1.5s after the last) and march on
the dais, chasing pirates within 30m that they can reach. Stage 2: the
Tidebreaker elites from the optional defenses' final wave (2 + one per two
pirates, dealt across the shrine directions, 32m out). Stage 3: the Tempest
Crab spawns 16m in front of the beacon. Boss has
telegraphed swipes and ranged splashes (events acceptable for visuals) and
minion summons with cap; its minions leave with it.
Boss 650HP solo +180 per additional player; normal crabs ~45–65HP.
Stage 4 is the skycrab siege (shared/sky-finale.js), the one stage whose
finaleStageRoster returns a typed descriptor {kind:'airship',bossCount:2,
groundWaveCount:3} instead of ground groups: a caller must dispatch on kind and
never read it as an empty ground roster. Two giant skycrabs fly slow closed
lanes beside the parked airship while three finite ground waves march the same
shrine roads stage one uses. Lanes are authored in ship-local metres and added
to shipAt(elapsed), which is parked at (0,62,-60) from 28s on, so the beacon
lies 64m dead astern in the gap between the broadside arcs where no gun can
traverse. Each lane therefore stays on one broadside (port centre x=-34, run
28m along z, 6m sway; starboard x=34, run 27m, 5.5m sway) and 1.6-9.7m above
the gun pivot, tracing one closed ellipse every 46s/52s at under 4 m/s with an
integer number of altitude beats per lap. skyBossReachableFromGun(pose,gun,ship)
is the authoring and diagnostic rule for those lanes, NOT a runtime hit test: it
AUTO-AIMS the seat at the pose, applies the real gunAim traverse/pitch clamps and
then runs the server's own nearest-sphere test from gunMuzzle, so a clamped seat
simply misses. Cannon damage must still raycast the player's own validated
yaw/pitch; selecting hits with this helper would turn misses into auto-hits.
Every authored sample and
extremum is aimed dead on from at least two seats on the boss's own broadside,
inside GUN_RANGE with >=0.1rad of traverse headroom, always above the pivot
(never depressed through the hull) and with clear line of sight; a pose over
the lighthouse or dead astern has no solution at all. Galewrack (port) is
780HP +150 per extra pirate, Squallmaw (starboard) 700 +135, both capped at the
latched crew and under 1.8x solo, 40 pearls each. A boss lobs ONE telegraphed
shell at a time, 2.8s of warning, 4.6m ring, 15 damage, only to ground pirates
within 4m of the impact height and inside 46m of the beacon. The arrival pocket
is the haven lift with RETURN_RANGE (3.2m) around it, nothing wider: no shell is
aimed into it AND a pirate standing in it is exempt from a ring centred legally
just outside, since arrival safety is about the pirate's position, not only the
shell's. Ground enemies still walk into that pocket and attack normally, and it
shelters nothing else on the dais. Cadence eases from 8/8.6s to 5.4/5.8s as a
boss's health falls and it never gains a phase, a minion or a second attack.
Stage entry sets SKY_CHECKPOINT, derived from the haven lift and MAX_PLAYERS so
Game.revive()'s existing (+2+slot*.8, +3) offsets put all five slots at
x6.4..9.6,z12 — no collision push, dry ground, within 1.6m of the lift and
inside the pocket. WP-2 must clamp the sky-stage revive slot to 0..MAX_PLAYERS-1:
addPlayer caps the ONLINE crew while revive indexes the whole players Map, which
can run past the authored row when offline characters are still reserved, so
during this stage revive indexes the online roster instead. Earlier stages keep
their current checkpoints and slot behaviour, and the existing 8s auto-revive
with 3s protection is unchanged.
Ground waves use only the classes the finale already fields, crabs and
Tidebreakers, with no new ground attack vocabulary: 2 crabs per shrine +1 per
extra pirate, then 1 crab per shrine +1 per extra pirate led by one Tidebreaker,
then a crab per shrine plus 1-3 Tidebreakers. That is 4-10 units per wave and
14-24 for the stage, one wave in the field at a time with a 6s gap, extras dealt
round robin from a cursor that carries across unit types, and nothing is ever
refilled. skyStageCleared() is the single guarded question, asked while the
stage is active: both bosses gone, the last wave started, no future wave left
and no living or queued ground rank. Each of those is checked independently, so
a mis-set wave index alone cannot pass. Boarding, a countdown, a gap, a queued
rank or an empty enemy map never wins.
server/sky-finale.js owns that lifecycle and the Game is its adapter. The stage
starts in `boarding`: any online, living, un-knocked pirate holding any valid
cannon (including one already mounted) latches a one-way SKY_COUNTDOWN, after
which the bosses appear on their lanes, wave one forms and bombardment begins.
Bosses that have not spawned yet still count as remaining, so an empty live
array during boarding cannot read as a cleared sky, and finale.remaining is
every skycrab and attacker the stage still owes (queued ranks and unstarted
waves included) rather than only the enemies standing on the island. Every wave,
the first one included, waits on one deadline — its authored gap, or one second
after a blocked attempt — so nothing retries per tick; a placement that is
missing, empty or short of the planned roster is a failed attempt rather than a
smaller wave, and the count of placed waves never advances past work that never
spawned. Practice flying
targets are hidden and inert for the whole stage and return with the next
voyage's reset; bossId stays null because the two skycrabs carry their own ids.
A bombardment picks the eligible ground pirate nearest the dais (ties by id) and
falls on a fixed ring around the lighthouse when nobody is downstairs, which is
never a failure state. A defeated skycrab pays its pearls and kill credit once,
cancels its own outstanding shells, and lingers SKY_BOSS_DOWN_LINGER before
leaving the public array.
A deck gun shoots the skycrabs with exactly the checks it already used on the
practice flyers: online, alive, mounted in a station it really occupies, still
standing at that station, in voyage or finale, off cooldown, and then a ray from
gunMuzzle along the gunner's OWN clamped yaw/pitch against the nearest sphere
surface inside GUN_RANGE with world line of sight. shared/airship.js
raySphereSurface(from, direction, target) is that one ray/sphere test, shared so
a client reticle can agree with the server; nothing aims for the player, so a
barrel pointed away misses. While the sky stage owns the deck the pool is
livingSkyBosses(game) and never the practice flyers, so no practice respawn or
reward can leak into the boss fight; outside the stage the eight flyers behave
exactly as before. The shot event is published first with its true hitId and
damage, then a sky hit is routed into damageSkyBoss(), which applies the damage,
emits the hit, and on a kill pays pearls and credit once, cancels that boss's
shells and settles the stage. Handheld guns and the cutlass never reach the sky.
completeIsland() is the only encounter route to victory: it
checks the stage's identity first (the running stage must really be the table's
last stage AND the airship stage AND still own its lifecycle block, so a forced
stage number, an out-of-range index or a missing block is a broken state rather
than a finished island), never consults the mutable remaining field, re-asks the
shared guard while the stage is still active, latches `cleared`, records a small
{island,round,seed,stage,elapsed,pearls,crew} result and calls
beginIslandDeparture() — the documented stub that today only announces "Island
secured!" (no crew is moved or boarded yet) and calls win(). Future travel
replaces that stub BEFORE terminal victory; it adds no network action and loads
no world now. win() itself, by any route, tears the stage down: no boss, shell,
queued rank, stage enemy, hidden practice flyer or public sky block outlives the
fight, while the completion record stays until the round resets. Restart and
abandoned-round resets clear the same state.
Defeat boss -> victory tableau + all-player results -> host New voyage resets
to lobby for replay. Persist aggregate victories and best pearls.

Two always-available weapons: flintlock (8 shots, 24dmg, .3s shot cooldown,
1.2s reload), scatter (5 shots, 5 pellets x10 close range, .65s, 1.5s reload).
Ammo per equipped weapon can be simplified as one mag reset on swap WITH a
cooldown; no swap exploit bypassing fire cooldown. Infinite reserve ammo,
automatic reload on empty, R explicit reload. F cutlass arc within 3m,
cooldown .6s, 32dmg. Server ray/sphere hits with forgiving modest aim assist
(~8 degrees, 50m flintlock / 18m scatter). Never hurt teammates.
Q heal pulse affects self + teammates within 9m for 35HP, cooldown 20s.
Health regenerates after 8s without damage, 7HP/s. Downed players can be
revived with E near them; automatic safe checkpoint rescue after 8s with
3s immunity. All players down never ends the run. Ping G for crew navigation.

## World/render API — world agent

`createWorld(canvas, {quality='high'}={})` exported from client/world.js:
returns {scene,camera,renderer,update,render,resize,setQuality,dispose,
         handleEvent,project,aimRay,getStats}.
`update(dt,state,localPlayer,view)` handles world + entities + camera.
view={yaw,pitch,menu:boolean,aiming:boolean,time:number}. In menu, show
an attractive sweeping original galleon + island establishing view, never
just empty water. In game a smooth third-person camera behind pirate,
8m back 4m up, with collision/terrain elevation to avoid clipping. Look
direction matches yaw/pitch; camera center reticle aims along aimRay.
`render()` draws; `resize()` uses canvas CSS size and updates camera;
`setQuality('high'|'low')`; `handleEvent(event)` shows tracers, splashes,
hit pops, heal circles, confetti; `project({x,y,z})` -> {x,y,visible}, in CSS
pixels relative to canvas; `aimRay()` -> {origin:{x,y,z},direction:{x,y,z}};
`getStats()` -> renderer.info + calls/triangles if useful.
No DOM ownership outside canvas; world generates labels using sprites if
needed but UI agent owns HUD/nameplates. Map meshes keyed by state IDs and
delete missing enemies/players. Interpolate remote players. Local p already
predicted by controller; use it instead of stale snapshot for own pirate.

Original visible geometry: long curved wooden flying galleon (deck at y=0 in
its model, masts, cream full sails, pennants, navy/gold hull, hanging lanterns,
ropes, rudder, aft cabin); player pirate with animated arms/legs, tricorn,
face, bandana, boots, striped shirt, hand blaster and deployed colorful glider;
crabs with animated feet, bright shells and eyestalks; giant boss has crown
shell/coral and readable attack windup. Terrain is not a flat disc: vertex
colors, contours, beaches, paths, cliffs around the caldera, soft foliage.
Five regions visually identifiable at altitude and on foot. Original props:
palm fronds, broad jungle canopies, coral, crates, huts, docks, treasure chests,
volcano rock spires/crater, moon mushrooms/crystals and curling trees, central
grand lighthouse. All interactions have obvious gold or region-colored beams.
Shore foam, sea highlights, cloud islands/seabirds add life. Reuse geometry;
avoid a thousand individually drawn leaves. Collision props match OBSTACLES;
decorative foliage must not obstruct key gameplay routes or camera.

## Client / UX — client agent

Use above protocol/shared movement/render API exactly. Main boot imports the
world; no duplicate rendering implementation. Net provides reconnect backoff,
status callbacks, buffering only join (never replay stale combat actions).
Prevent multiple render loops/listeners after replay/reconnect. local player
movement predicted, reconcile network corrections without constant stutter.
Pointer lock on click; normal keyboard/mouse and right drag fallback supported
on LAN HTTP, Escape shows pause/help menu and releases input. Left click fire,
mouse look, WASD/arrows move, Shift sprint, Space jump on land and leave a
deck gun (never leaves the ship), F cutlass, E interact/revive/jump gate,
Q heal, R reload, 1/2 weapons, G ping, M large map, Esc menu.
Jump gates are persistent deck signage, not a tutorial notice: a dark pad with
gold chevrons, a gold-framed board reading JUMP in block capitals, and a cyan
cone pointing outward, plus painted approach lanes routing past the fore-mast.
They read without colour, glow or motion. While aboard, the objective marker
and quest panel name the nearest gate and its distance; while gliding they name
a landing area the glider can still reach (the lighthouse in the finale). The
ship banner offers its button only when the server would accept the press, and
it sends the same interact action E does. Clear queued controls and send one
neutral packet on a confirmed departure acknowledgement, exactly as on boarding.
Input does not leak through name field or buttons. Reset keys on blur/lost lock.
For browser automation `?test=1` permits gameplay keyboard without pointer
lock; this is only an input accessibility fallback, no simulation shortcuts.
Expose window.SKY={state:()=>snapshot,player:()=>predicted,input,world,net}
for lead diagnostics; no cheats or server debug APIs.

UI gives immediate loading state and actionable WebGL/connection failure.
Welcome/lobby/sail/drop/land/shrine/finale/victory/replay are distinct states.
Initial objective: Jump from the ship; land at Sunwake Strand. Then Find the
three compass shards. Active shrine: Defeat the defenders; capture is automatic.
Captured shrine nearby: E — Return to boat, with cyan inlays and a return glyph.
Three shards: Return to the lighthouse. Finale: Free the compass.
Minimap draws colored terrain regions, crew, live shrine state, lighthouse,
chests optionally; expanding M gives readable named destinations. Show
nearest objective distance and compass edge indicators so kids don't get lost.
Context E label chooses nearest eligible chest/shrine/downed friend/beacon.
Show team health, rescues, health bar, ammo/reload, heal cooldown, shard icons,
session connection status, pause controls, sound and graphics settings.
Use synthesized audio on user gesture: shoot, reload, hit, splash, collect,
shrine, heal, victory; restrained sea ambience optional. Mute persists.
On victory include crew contributions and Play another voyage for host;
others see Waiting for captain. No purchasing, ads, profiles, or text chat.

## Verification / acceptance (lead tests, agents write meaningful unit/e2e)

1. Original project and assets; no Rustbeard copy, no cross-project edits.
2. npm test passes: movement, reachable objectives, combat/cooldowns,
   shrine progression, revive/auto rescue, victory/replay, data persistence.
3. Real ws test with five clients completes launch/drop/three shrines/boss/
   victory and replay using normal movement/actions (no injected wins).
4. Sixth client is clearly rejected, reconnect returns same character, host
   transfer and late join work, invalid/distant commands cannot progress.
5. Browser boots without errors; create pirate, lobby, launch, walk deck,
   jump, glide, land, move, loot, shoot, heal, interact, map, pause work.
6. At least two browser players see each other moving and shooting. Test
   grounded third-person aiming and actual damage feedback, not just ws bots.
7. Visually inspect menu, skyship, drop, all region landmarks, combat, map,
   and victory. Pirate must remain visible and camera must be usable.
8. Measure browser performance at 1280x800 and 1920x1080; target >=50fps on
   this desktop, scale down safely for low quality; no shader/GL errors.
9. Docker build and healthcheck pass; LAN URL http://192.168.1.27:3400
   serves original game. Fresh container restart retains aggregate progress.
10. README includes launch/stop, LAN URL, controls, gameplay, saves, graphics,
    supported browsers and honest scope. Final report records exact evidence.
