// Skywake Isles — wrist-anchor tuning rig for a GLB weapon (character studio).
//
// Same harness as capture.mjs (headless Chrome on the character studio, window.characterStudio),
// but instead of one pass it drives a list of candidate wrist anchors through the live rig:
//
//   refs.gameModel.debug.weapons[kind].handling = { right: [...], left: [...] }
//
// client/player-character.js reads that per frame in place of WEAPON_HANDLING[kind]'s right/left
// (stance and supportRoll still come from WEAPON_HANDLING), so a candidate takes effect on the
// next animation frame with no reload.
//
// Per candidate it writes five shots and one numeric fit:
//   <label>-a-right-closeup .. -e-reload-0.49   PNGs under <out>/
//   fit.firing.grip.distance                    gun-space distance from the firing palm centre
//                                               (the RightHand bone plus .25 gun units along the
//                                               finger basis the frame code builds) to the nearest
//                                               body vertex in the kind's FIRING_TARGET band
//                                               (below) -- the grip or stock wrist. Under ~.06
//                                               means the grip is inside the palm.
//   fit.support.grip.distance                   the equivalent support-hand distance to the kind's
//                                               SUPPORT_TARGET band (below): the fore-end under the
//                                               barrel on the long guns and the blunderbuss, the
//                                               grip on the pistol, whose off hand wraps the firing
//                                               hand. fit.support.target echoes the band searched.
//
// Usage:
//   node tools/qa/weapons/tune.mjs --kind <flintlock|scatter|repeater|burst|longshot>
//     --candidates <file.json> [--origin http://localhost:3401] [--out .qa/weapons/<kind>/]
//
// The candidates file is a JSON array of { label, right: [x,y,z], left: [x,y,z], note? }.
// See candidates.example.json for the flintlock's procedural and shipped anchors.
//
// This script starts NOTHING. Bring the isolated server up first (never port 3400):
//   PowerShell:  $env:PORT=3401; node server/index.js
// then run this script and stop the server afterwards. It refuses to run if <origin>/health is
// not reachable.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const KINDS = ['flintlock', 'scatter', 'repeater', 'burst', 'longshot'];

// Where each kind's support palm has to land, in gun space: the body vertices the support metric
// searches. A band that cannot see the target is worse than none -- it reports the distance to
// whatever else is in it and reads the same for every candidate. Measured from z-slices of the
// shipped GLBs (2026-09-12):
//   flintlock  the off hand wraps the firing hand around the grip, so the target is the grip band
//              (y -.30 .. .05 anywhere along the gun), as the firing metric's is.
//   scatter    the fore-end is a wooden tube fused under the barrel whose underside runs y -.03 ..
//              +.03 over z -.75 .. -.30; the flare starts at z -.85 and the trigger-guard bow at
//              z -.20. Ceiling .10 is just under the bore (.12).
//   repeater   the fore-end is a thin tube under the barrel with its underside at y .049 .. .075
//              over z -.80 .. -.45 (nothing below y .10 at z -.45 .. -.40, the front brass band),
//              which the old flat [-.30, .05] band could not see at all: every correct candidate
//              read ~.17, the distance to the receiver lip behind the magazine well. Ceiling .15 is
//              just under the bore (.17); the window stops at z -.40 so the magazine well, the
//              trigger guard and the receiver stay out.
//   burst      re-measured from the shipped GLB (2026-09-12) and kept as drawn: the fore-end is a
//              fat wooden tube under the barrel whose underside runs y .105 .. .119 over
//              z -.60 .. -.45 and y .078 .. .086 over z -.85 .. -.65 (the finger groove between the
//              brass bands). The window's back edge at z -.45 keeps out the magazine well, which
//              drops to y ~ 0 over z -.45 .. -.30, and the trigger guard behind it; ceiling .15 is
//              just under the bore (.17). 656 vertices, and the tuned support palm reads .028.
//   longshot   measured from the shipped GLB's z-slices (2026-09-12): the fore-end is a fat wooden
//              tube under the barrel running z -1.34 .. -.60, its centre-line underside y -.004 ..
//              +.016 over z -1.25 .. -.70 and rising to +.058 at its rear end (z -.60), |x| <= .100.
//              The window's back edge at z -.60 is where the wood stops: behind it the trigger
//              guard hangs from z -.51 to -.18 (bottom y -.127) and would answer for every
//              candidate whose palm fell short of the wood. Ceiling .15 is just under the bore
//              (.17), as on the repeater and the burst. 1,484 vertices.
// `z` is optional (omit it for a target anywhere along the gun); page.evaluate serialises the
// band as JSON, so never use Infinity here.
const SUPPORT_TARGET = {
  flintlock: { y: [-.30, .05] },
  scatter: { y: [-.30, .10], z: [-.85, -.25] },
  repeater: { y: [-.30, .15], z: [-.80, -.40] },
  burst: { y: [-.30, .15], z: [-1.05, -.45] },
  longshot: { y: [-.30, .15], z: [-1.34, -.60] },
};

// The same for the firing palm: the grip (pistols) or the pistol grip / stock wrist behind the
// trigger (long guns). The flat y [-.27, -.05] band fits the flintlock's raked grip (bottom
// y -.27), the scatter's (-.33) and the repeater's pistol grip (bottom -.146), but the burst's
// whole stock is shallow -- grip belly y -.030 at z .05 .. .08, stock wrist +.02, butt toe -.035 --
// so that band is empty there and the distance read null for every candidate; its band is the
// stock-wrist band behind the trigger (z >= -.02), y -.10 .. .12, measured from the shipped GLB.
//   longshot   measured from the shipped GLB's z-slices (2026-09-12): it has a real pistol grip --
//              a wood column of |x| <= .072 whose belly bottoms at y -.2805 (z -.10 .. -.08) and
//              stays below -.23 over z -.16 .. +.04 -- so the flat y band the three earlier grips
//              use fits it unchanged. It gets a z window only to keep two other things out of an
//              otherwise flat band: the trigger guard (y -.05 .. -.127 over z -.51 .. -.18), which
//              a palm reaching too far forward would score against, and the butt plate (y down to
//              -.252 over z .35 .. .45). 393 vertices, all of them grip.
const FIRING_TARGET = {
  flintlock: { y: [-.27, -.05] },
  scatter: { y: [-.27, -.05] },
  repeater: { y: [-.27, -.05] },
  burst: { y: [-.10, .12], z: [-.02, .60] },
  longshot: { y: [-.27, -.05], z: [-.17, .10] },
};

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(`usage: node tools/qa/weapons/tune.mjs --kind <${KINDS.join('|')}> --candidates <file.json> [--origin <url>] [--out <dir>]`);
  process.exit(1);
}

const KIND = opt('--kind', null);
if (!KIND) usage('--kind is required');
if (!KINDS.includes(KIND)) usage(`unknown --kind ${KIND} (known: ${KINDS.join(', ')})`);
const candidatesArg = opt('--candidates', null);
if (!candidatesArg) usage('--candidates <file.json> is required');
const ORIGIN = opt('--origin', 'http://localhost:3401');
const OUT = path.resolve(process.cwd(), opt('--out', path.join('.qa', 'weapons', KIND)));
const PAGE_URL = `${ORIGIN}/character-studio.html`;
const SETTLE_MS = 1200;

const candidatesPath = path.resolve(process.cwd(), candidatesArg);
const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'));

const PLAYWRIGHT_INDEX = process.env.PLAYWRIGHT_INDEX
  || 'file:///C:/Users/nicho/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(PLAYWRIGHT_INDEX);

async function requireHealth(origin) {
  let response;
  try {
    response = await fetch(`${origin}/health`);
  } catch (error) {
    console.error(`error: cannot reach ${origin}/health (${error.message}). Start the server first, e.g. $env:PORT=3401; node server/index.js`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`error: ${origin}/health returned ${response.status}. Start the server first.`);
    process.exit(1);
  }
}
await requireHealth(ORIGIN);

mkdirSync(OUT, { recursive: true });

const consoleLog = [];
const pageErrors = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('console', message => consoleLog.push({ type: message.type(), text: message.text() }));
page.on('pageerror', error => pageErrors.push(String(error && error.stack || error)));

const wait = ms => page.waitForTimeout(ms);
let canvasBox = null;
async function shot(label) {
  if (!canvasBox) canvasBox = await page.locator('#studio-canvas').boundingBox();
  const clip = {
    x: Math.round(canvasBox.x), y: Math.round(canvasBox.y),
    width: Math.round(canvasBox.width), height: Math.round(canvasBox.height),
  };
  const filePath = path.join(OUT, `${label}.png`);
  await page.screenshot({ path: filePath, clip });
  return filePath;
}

await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.characterStudio, null, { timeout: 30000 });
await page.waitForFunction(() => {
  const state = window.characterStudio.getState();
  return state.ready || !!state.error;
}, null, { timeout: 60000 });
const heroState = await page.evaluate(() => window.characterStudio.getState());
if (heroState.error) throw new Error(`studio could not load the player character: ${heroState.error}`);

await page.evaluate(kind => {
  window.characterStudio.setMode('game');
  window.characterStudio.setLighting('island');
  window.characterStudio.setPose({ weapon: kind, state: 'ground', aiming: false, reload: false, knocked: false, pitch: 0, speed: 0, reloadProgress: null });
}, KIND);
await page.waitForFunction(() => window.characterStudio.getState().gameKind === 'navigator', null, { timeout: 60000 });
// Game mode parks the procedural buildPirate baseline beside the navigator, close enough that its
// own gun crosses every close-up. Nothing re-syncs slot visibility until setMode runs again.
await page.evaluate(() => { window.characterStudio.refs.baselineSlot.visible = false; });
// The gun GLB has to have swapped in, or every candidate would be measured against the
// procedural gun. debug.weapons is the rig's own map of built weapons.
await page.waitForFunction(kind => {
  const debug = window.characterStudio.refs.gameModel && window.characterStudio.refs.gameModel.debug;
  return !!(debug && debug.weapons && debug.weapons[kind] && debug.weapons[kind].asset === kind);
}, KIND, { timeout: 30000 });
await wait(SETTLE_MS);

const shippedHandling = await page.evaluate(kind => {
  const weapon = window.characterStudio.refs.gameModel.debug.weapons[kind];
  return weapon.handling ? { right: [...weapon.handling.right], left: [...weapon.handling.left] } : null;
}, KIND);

const setPose = partial => page.evaluate(p => window.characterStudio.setPose(p), partial);
const setCamera = name => page.evaluate(n => window.characterStudio.setCamera(n), name);

// Parks a narrow camera on a gun-space point after spinning the turntable to `yaw`: +pi/2 puts the
// gun's +X lock-plate side towards the camera, -pi/2 its left side. Default target is the grip and
// the hands closed around it, which is the whole question here; `radius` frames the rest.
const closeUp = (yaw, at = [0, -.12, .12], radius = .48) => page.evaluate(({ yaw, at, radius, kind }) => {
  const api = window.characterStudio, THREE = api.refs.THREE;
  api.setCamera('front');
  api.rotate(yaw - api.yaw);
  const held = api.refs.gameModel.group.getObjectByName(`held-${kind}`);
  held.updateWorldMatrix(true, true);
  const centre = held.localToWorld(new THREE.Vector3(...at));
  const camera = api.refs.camera;
  camera.fov = 28; camera.near = .05;
  const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(centre.x, centre.y + .04, centre.z - distance);
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
}, { yaw, at, radius, kind: KIND });

const applyCandidate = candidate => page.evaluate(({ candidate, kind }) => {
  const weapon = window.characterStudio.refs.gameModel.debug.weapons[kind];
  weapon.handling = { right: candidate.right.slice(), left: candidate.left.slice() };
  return { right: [...weapon.handling.right], left: [...weapon.handling.left] };
}, { candidate, kind: KIND });

// The numeric fit, all of it in gun space (the held-<kind> group's local frame, so the weapon's
// draw scale and every parent transform divide out).
//
// palm  = RightHand bone position + .25 along the firing hand's finger basis. The frame code
//         builds that basis as (-.20, -.62, -.76) normalised, rotated by weaponRig * anchor; the
//         gun group is weaponRig's child at identity rotation, so in gun space only the anchor's
//         own rotation applies.
// grip  = the body vertices in the kind's FIRING_TARGET band (y, and z when given): the GLB's
//         raked grip between its butt and the tang, or a long gun's stock wrist, which is what the
//         palm has to close around.
// support target = the kind's SUPPORT_TARGET band (y, and z when given) of body vertices.
const measure = () => page.evaluate(({ kind, firingTarget, supportTarget }) => {
  const api = window.characterStudio, THREE = api.refs.THREE;
  const debug = api.refs.gameModel.debug;
  const held = api.refs.gameModel.group.getObjectByName(`held-${kind}`);
  held.updateWorldMatrix(true, true);
  const toGun = new THREE.Matrix4().copy(held.matrixWorld).invert();
  const round = value => Number(value.toFixed(4));

  const armOf = sign => debug.arms.find(arm => Math.sign(arm.side) === sign);
  const palmOf = (arm, base) => {
    arm.hand.updateWorldMatrix(true, false);
    const wrist = new THREE.Vector3().setFromMatrixPosition(arm.hand.matrixWorld).applyMatrix4(toGun);
    const fingers = new THREE.Vector3(...base).normalize().applyQuaternion(arm.anchor.quaternion);
    return { wrist, fingers, palm: wrist.clone().addScaledVector(fingers, .25) };
  };
  const firing = palmOf(armOf(1), [-.20, -.62, -.76]);
  // The support hand's finger basis is per kind in client/player-character.js (~line 442): the
  // flintlock's off hand wraps the firing hand at (.70, -.25, -.67); every other kind cups a
  // fore-end from below at (.62, .55, -.56), which is .20 gun units higher at .25 along the
  // fingers. Measuring one of those with the pistol's basis would put the palm .20 below the one
  // the renderer actually draws -- more than three times the .06 fit this rig is tuned against.
  const support = palmOf(armOf(-1), kind === 'flintlock' ? [.70, -.25, -.67] : [.62, .55, -.56]);

  // Body vertices in gun space, banded by height.
  const body = held.children.find(child => child.isMesh);
  const local = new THREE.Matrix4().multiplyMatrices(toGun, body.matrixWorld);
  const positions = body.geometry.attributes.position;
  const vertex = new THREE.Vector3();
  const nearest = (point, band) => {
    let best = Infinity, at = null, count = 0;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(local);
      if (vertex.y < band.y[0] || vertex.y > band.y[1]) continue;
      if (band.z && (vertex.z < band.z[0] || vertex.z > band.z[1])) continue;
      count++;
      const distance = vertex.distanceTo(point);
      if (distance < best) { best = distance; at = vertex.toArray().map(round); }
    }
    return { distance: count ? round(best) : null, at, candidates: count };
  };

  return {
    firing: {
      wrist: firing.wrist.toArray().map(round), palm: firing.palm.toArray().map(round),
      fingers: firing.fingers.toArray().map(round),
      target: firingTarget,
      grip: nearest(firing.palm, firingTarget),
    },
    support: {
      wrist: support.wrist.toArray().map(round), palm: support.palm.toArray().map(round),
      target: supportTarget,
      grip: nearest(support.palm, supportTarget),
      toFiringPalm: round(support.palm.distanceTo(firing.palm)),
    },
  };
}, { kind: KIND, firingTarget: FIRING_TARGET[KIND], supportTarget: SUPPORT_TARGET[KIND] });

const results = [];
for (const candidate of candidates) {
  const applied = await applyCandidate(candidate);
  // Neutral ground idle for the numbers and the two close-ups.
  await setPose({ aiming: false, pitch: 0, reload: false, reloadProgress: null, state: 'ground' });
  await wait(SETTLE_MS);
  const fit = await measure();

  const shots = {};
  await closeUp(Math.PI / 2); await wait(500);
  shots.rightCloseUp = await shot(`${candidate.label}-a-right-closeup`);
  await closeUp(-Math.PI / 2); await wait(500);
  shots.leftCloseUp = await shot(`${candidate.label}-b-left-closeup`);
  await closeUp(2.3, [0, -.05, -.10], .62); await wait(500);
  shots.threeQuarterGun = await shot(`${candidate.label}-f-three-quarter-gun`);

  // Aim and reload frame the gun plus the torso and head it could clip into: the anchor point is
  // in gun space, so the camera swings with the stroke instead of losing the gun off-frame.
  const upperBody = () => closeUp(2.3, [0, -.05, -.15], .85);
  await setPose({ aiming: true, pitch: .8 });
  await wait(SETTLE_MS); await upperBody(); await wait(400);
  shots.aimUp = await shot(`${candidate.label}-c-aim-up`);
  await setPose({ aiming: true, pitch: -.8 });
  await wait(SETTLE_MS); await upperBody(); await wait(400);
  shots.aimDown = await shot(`${candidate.label}-d-aim-down`);

  await setPose({ aiming: false, pitch: 0 });
  await wait(SETTLE_MS);
  await setPose({ reload: true, reloadProgress: .49 });
  await wait(SETTLE_MS); await upperBody(); await wait(400);
  shots.reload = await shot(`${candidate.label}-e-reload-0.49`);
  await setPose({ reload: false, reloadProgress: null });
  await wait(400);

  results.push({ ...candidate, applied, fit, shots });
  console.log(`${candidate.label}  right=[${candidate.right}] left=[${candidate.left}]`);
  console.log(`   firing palm ${JSON.stringify(fit.firing.palm)} -> grip ${fit.firing.grip.distance} (at ${JSON.stringify(fit.firing.grip.at)}, ${fit.firing.grip.candidates} verts in y ${JSON.stringify(fit.firing.target.y)}${fit.firing.target.z ? ` z ${JSON.stringify(fit.firing.target.z)}` : ''})`);
  console.log(`   support palm ${JSON.stringify(fit.support.palm)} -> target ${fit.support.grip.distance} (at ${JSON.stringify(fit.support.grip.at)}, ${fit.support.grip.candidates} verts in y ${JSON.stringify(fit.support.target.y)}${fit.support.target.z ? ` z ${JSON.stringify(fit.support.target.z)}` : ''}), to firing palm ${fit.support.toFiringPalm}`);
}

const errors = consoleLog.filter(entry => entry.type === 'error');
const warnings = consoleLog.filter(entry => entry.type === 'warning' || entry.type === 'warn');
writeFileSync(path.join(OUT, 'tune-report.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(), url: PAGE_URL, kind: KIND, candidatesPath, shippedHandling,
  console: { errors: errors.length, warnings: warnings.length, messages: consoleLog }, pageErrors, results,
}, null, 2)}\n`, 'utf8');

await context.close();
await browser.close();
console.log(`\nshipped handling in the page: ${JSON.stringify(shippedHandling)}`);
console.log(`console: ${errors.length} error(s), ${warnings.length} warning(s)`);
for (const entry of consoleLog) console.log(`  [${entry.type}] ${entry.text}`);
console.log(`report -> ${path.join(OUT, 'tune-report.json')}`);
