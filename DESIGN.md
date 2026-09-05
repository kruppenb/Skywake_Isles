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
+/-8 z via deckX/deckZ; jump leaves the ship. At SHIP_DURATION auto-drop
over safe SPAWN. Lobby caller passes elapsed=0 and suppresses jump.
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
 pings:[],stats:{wins,voyages,bestPearls},victory:null|{pearls,duration,rescues,kills}}
Player public fields:
{id,name,color,online,ready,x,y,z,yaw,pitch,vy,mode,jumpHeld,grounded,
 deckX,deckZ,hp,maxHp,ammo,maxAmmo,weapon,reloadUntil,healUntil,
 knockedUntil,invulnerableUntil,lastInputSeq,kills,rescues,chests}
knockedUntil=0 means active, otherwise absolute state.elapsed timestamp.
Enemy: {id,type:'crab'|'spitter'|'tempest',x,y,z,yaw,hp,maxHp,radius,
 state:'idle'|'chase'|'windup'|'attack',attackAt,zone,scale};
tempest is the boss and can have attackRadius. Enemy y is feet position.
Shrine dynamic fields: {id,status:'dormant'|'active'|'cleared',charge,
 remaining}; charge 0–1, remaining number of living shrine guards.
Chest: {id,opened}; static positions from shared constants.
Ping: {id,playerId,x,z,expiresAt}.
Events always {kind,...}; common kinds:
shot {playerId,from:{x,y,z},to:{x,y,z},weapon,hitId?,damage?},
hit {targetId,damage,x,y,z,sourceId?}, defeated {id,x,y,z,type},
chest {id,playerId,pearls}, shrine {id,status}, heal {playerId},
downed {playerId}, revive {playerId,by?}, ping {playerId,x,z},
phase {phase}, notice {message}, victory {pearls,duration,rescues,kills}.
World/client tolerate extra fields and unknown events.

Loop: host presses Set sail (launch) in lobby, all online crew begin aboard,
phase voyage elapsed reset to zero. The client shows Space to jump and auto
glide; server auto-drops remaining crew. Three shrine quests any order:
E within 4m starts a shrine, spawning 3–5 whimsical crabs scaled gently with
crew size. Defeat guards then stand within 9m for 5 seconds to charge it.
Cleared shrine grants shared shard and checkpoint; nearby crew healed.
No respawning shrine guards or endless alarm. A few optional roaming crabs
stay away from the initial beach. Chests open with E at 3.5m, give shared
pearls and heal; no competition for loot. Three shards unlock BEACON.
E at BEACON starts finale with Tempest Crab. Boss has telegraphed swipes and
ranged splashes (events acceptable for visuals) and minion summons with cap.
Boss 650HP solo +180 per additional player; normal crabs ~45–65HP.
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
mouse look, WASD/arrows move, Shift sprint, Space jump/drop, F cutlass, E
interact/revive, Q heal, R reload, 1/2 weapons, G ping, M large map, Esc menu.
Input does not leak through name field or buttons. Reset keys on blur/lost lock.
For browser automation `?test=1` permits gameplay keyboard without pointer
lock; this is only an input accessibility fallback, no simulation shortcuts.
Expose window.SKY={state:()=>snapshot,player:()=>predicted,input,world,net}
for lead diagnostics; no cheats or server debug APIs.

UI gives immediate loading state and actionable WebGL/connection failure.
Welcome/lobby/sail/drop/land/shrine/finale/victory/replay are distinct states.
Initial objective: Jump from the ship; land at Sunwake Strand. Then Find the
three compass shards. Active shrine: Defeat the crabs, then stand by the
shrine. Three shards: Return to the lighthouse. Finale: Free the compass.
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
