// Skywake Isles — QA capture for a GLB weapon upgrade (character studio).
//
// Drives <origin>/character-studio.html through window.characterStudio in headless Chrome and
// writes one PNG per review shot plus a machine-readable report for the chosen weapon kind.
//
// Usage:
//   node tools/qa/weapons/capture.mjs --kind <flintlock|scatter|repeater|burst|longshot>
//     [--origin http://localhost:3401] [--out .qa/weapons/<kind>/]
//
// This script starts NOTHING. Bring the isolated server up first (never port 3400):
//   PowerShell:  $env:PORT=3401; node server/index.js
//   bash:        PORT=3401 node server/index.js
// then run this script and stop the server afterwards. It refuses to run if <origin>/health is
// not reachable.
//
// Output (labels are stable, so a second run overwrites the same files):
//   <out>/<label>.png
//   <out>/report.json   console log, /assets/weapons/ request statuses, and the measured state of
//                        the navigator's held gun.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KINDS = ['flintlock', 'scatter', 'repeater', 'burst', 'longshot'];

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(`usage: node tools/qa/weapons/capture.mjs --kind <${KINDS.join('|')}> [--origin <url>] [--out <dir>]`);
  process.exit(1);
}

const KIND = opt('--kind', null);
if (!KIND) usage('--kind is required');
if (!KINDS.includes(KIND)) usage(`unknown --kind ${KIND} (known: ${KINDS.join(', ')})`);
const ORIGIN = opt('--origin', 'http://localhost:3401');
const OUT = path.resolve(process.cwd(), opt('--out', path.join('.qa', 'weapons', KIND)));
const PAGE_URL = `${ORIGIN}/character-studio.html`;
const WEAPON_ASSET_PREFIX = '/assets/weapons/';
// Long enough for the studio's eased blends (aim, glide, stance) to settle before a shot.
const SETTLE_MS = 1400;

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
const assetRequests = [];
const pageErrors = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();

page.on('console', message => {
  consoleLog.push({
    type: message.type(),
    text: message.text(),
    location: message.location() ? `${message.location().url}:${message.location().lineNumber}` : null,
  });
});
page.on('pageerror', error => pageErrors.push(String(error && error.stack || error)));
page.on('response', async response => {
  const url = response.url();
  if (!url.includes(WEAPON_ASSET_PREFIX)) return;
  assetRequests.push({ url, status: response.status(), statusText: response.statusText(), outcome: 'response' });
});
page.on('requestfailed', request => {
  const url = request.url();
  if (!url.includes(WEAPON_ASSET_PREFIX)) return;
  assetRequests.push({ url, status: null, statusText: request.failure()?.errorText || 'failed', outcome: 'requestfailed' });
});

const wait = ms => page.waitForTimeout(ms);

// ------------------------------------------------------------------- shots --
let canvasBox = null;
async function shot(label) {
  if (!canvasBox) canvasBox = await page.locator('#studio-canvas').boundingBox();
  const clip = {
    x: Math.round(canvasBox.x), y: Math.round(canvasBox.y),
    width: Math.round(canvasBox.width), height: Math.round(canvasBox.height),
  };
  const filePath = path.join(OUT, `${label}.png`);
  await page.screenshot({ path: filePath, clip });
  return { label, path: filePath, clip };
}

// -------------------------------------------------------------- navigation --
await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.characterStudio, null, { timeout: 30000 });
// The hero GLB has to be in before the live renderer can build a navigator.
await page.waitForFunction(() => {
  const state = window.characterStudio.getState();
  return state.ready || !!state.error;
}, null, { timeout: 60000 });

const heroState = await page.evaluate(() => window.characterStudio.getState());
if (heroState.error) throw new Error(`studio could not load the player character: ${heroState.error}`);

// Game model view = the live buildPlayerCharacter renderer, which is what builds (and upgrades)
// the guns. Island lighting is the colour-judging preset.
await page.evaluate(kind => {
  window.characterStudio.setMode('game');
  window.characterStudio.setLighting('island');
  window.characterStudio.setPose({ weapon: kind, state: 'ground', aiming: false, reload: false, knocked: false, pitch: 0, speed: 0, reloadProgress: null });
}, KIND);
await page.waitForFunction(() => window.characterStudio.getState().gameKind === 'navigator', null, { timeout: 60000 });
// Give the weapon GLB request (or its 404) time to settle, then let the pose ease out.
await page.waitForFunction(prefix => performance.getEntriesByType('resource').some(entry => entry.name.includes(prefix)),
  WEAPON_ASSET_PREFIX, { timeout: 15000 }).catch(() => { /* no request at all is itself a finding */ });
await wait(SETTLE_MS);

// ------------------------------------------------------------- inspection --
const rigReport = await page.evaluate(kind => {
  const api = window.characterStudio;
  const THREE = api.refs.THREE;
  const round = value => Number(value.toFixed(5));
  const arr = vector => vector.toArray().map(round);
  const model = api.refs.gameModel;
  if (!model || !model.group) return { error: 'no game model' };
  const group = model.group;
  const rig = group.getObjectByName('weapon-aim-recoil-rig');
  const stowRig = group.getObjectByName('weapon-back-stow-rig');
  const held = rig && rig.getObjectByName(`held-${kind}`);
  const stowed = stowRig && stowRig.getObjectByName(`stowed-${kind}`);
  if (!held) return { error: `no held-${kind} under weapon-aim-recoil-rig`, rigChildren: rig ? rig.children.map(c => c.name) : null };

  const describeMaterial = material => material && ({
    type: material.type, name: material.name || null,
    hasMap: !!material.map, mapName: material.map ? (material.map.name || null) : null,
    shared: !!(material.userData && material.userData.shared),
  });
  const describeMesh = mesh => mesh && ({
    name: mesh.name, type: mesh.type,
    triangles: mesh.geometry ? Math.floor((mesh.geometry.index || mesh.geometry.attributes.position).count / 3) : null,
    hasUv: !!(mesh.geometry && mesh.geometry.attributes.uv),
    material: Array.isArray(mesh.material) ? mesh.material.map(describeMaterial) : describeMaterial(mesh.material),
  });

  // Local ("gun space") bounds of everything the group draws.
  function localBox(root) {
    root.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const box = new THREE.Box3(); const scratch = new THREE.Box3(); const matrix = new THREE.Matrix4();
    root.traverse(node => {
      if (!node.isMesh || !node.geometry) return;
      if (node.geometry.boundingBox === null) node.geometry.computeBoundingBox();
      scratch.copy(node.geometry.boundingBox);
      matrix.multiplyMatrices(inverse, node.matrixWorld);
      box.union(scratch.applyMatrix4(matrix));
    });
    return box.isEmpty() ? null : { min: arr(box.min), max: arr(box.max) };
  }

  const heldBody = held.children.find(child => child.isMesh);
  const hinge = held.getObjectByName(`reload-hinge-${kind}`);
  const actionMesh = held.getObjectByName(`reload-action-mesh-${kind}`);
  const proceduralAction = held.getObjectByName(`reload-action-${kind}`);
  const muzzle = held.getObjectByName(`muzzle-${kind}`);
  const world = new THREE.Vector3();
  if (muzzle) { muzzle.updateWorldMatrix(true, false); world.setFromMatrixPosition(muzzle.matrixWorld); }

  // The procedural gun draws with the shared palette toon material; a swapped-in GLB body draws
  // with the asset's own (MeshStandard/MeshPhysical) material and carries a reload-hinge group.
  const paletteSolid = api.refs.palette ? api.refs.palette.solid : null;
  const bodyIsPalette = !!(heldBody && paletteSolid && heldBody.material === paletteSolid);
  return {
    gameKind: model.kind,
    upgraded: !!hinge && !bodyIsPalette,
    markers: {
      reloadHingePresent: !!hinge,
      reloadActionMeshPresent: !!actionMesh,
      proceduralActionIsMesh: !!(proceduralAction && proceduralAction.isMesh),
      bodyMaterialIsPaletteToon: bodyIsPalette,
      paletteSolidType: paletteSolid ? paletteSolid.type : null,
    },
    heldChildren: held.children.map(child => ({ name: child.name, type: child.type, position: arr(child.position) })),
    heldBody: describeMesh(heldBody),
    actionMesh: describeMesh(actionMesh),
    muzzleSocket: muzzle ? { name: muzzle.name, localPosition: arr(muzzle.position), worldPosition: arr(world) } : null,
    heldBoundsLocal: localBox(held),
    heldScale: arr(held.scale),
    stowed: stowed ? {
      children: stowed.children.map(child => ({ name: child.name, type: child.type })),
      boundsLocal: localBox(stowed),
      hingePresent: !!stowed.getObjectByName(`stowed-reload-hinge-${kind}`),
    } : null,
  };
}, KIND);

// ------------------------------------------------------------------ script --
const shots = [];
const setPose = partial => page.evaluate(p => window.characterStudio.setPose(p), partial);
const setCamera = name => page.evaluate(n => window.characterStudio.setCamera(n), name);

// 1 — three-quarter idle
await setCamera('threeQuarter');
await wait(SETTLE_MS);
shots.push(await shot('01-three-quarter-idle'));

// 2 — three-quarter aiming
await setPose({ aiming: true });
await wait(SETTLE_MS);
shots.push(await shot('02-three-quarter-aiming'));

// No camera preset frames a weapon, so this parks a narrow camera on the held gun's own
// world-space centre after spinning the turntable to `yaw` (π/2 puts the gun's +X lock-plate side
// towards the camera). refs.camera is only rewritten by applyCamera(), which nothing calls until
// the next preset change or a resize, so a hand-placed camera survives until then.
const gunCloseUp = (yaw, kind = KIND) => page.evaluate(({ yaw, kind }) => {
  const api = window.characterStudio, THREE = api.refs.THREE;
  api.setCamera('front');
  api.rotate(yaw - api.yaw);
  const held = api.refs.gameModel.group.getObjectByName(`held-${kind}`);
  held.updateWorldMatrix(true, true);
  const sphere = new THREE.Box3().setFromObject(held).getBoundingSphere(new THREE.Sphere());
  const centre = sphere.center;
  const camera = api.refs.camera;
  camera.fov = 28; camera.near = .05;
  // Frame the whole gun plus the hands holding it, whatever the gun's length.
  const distance = sphere.radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.28;
  camera.position.set(centre.x + .05, centre.y + .10, centre.z - distance);
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
}, { yaw, kind });

// 3 — right-side close-up on the held gun (lock plate / receiver side towards the camera)
await gunCloseUp(Math.PI / 2);
await wait(600);
shots.push(await shot('03-right-side-closeup'));

// 4 — gameplay distance (the real rig numbers). The preset is the over-the-shoulder gameplay
// camera, so it shows the player's back; 04b spins the turntable to put the gun in view at the
// same distance and FOV, which is what "does the gun read in play?" actually needs.
await setCamera('gameplay');
await wait(600);
shots.push(await shot('04-gameplay-distance'));
await page.evaluate(() => window.characterStudio.rotate(2.5 - window.characterStudio.yaw));
await wait(400);
shots.push(await shot('04b-gameplay-distance-gun-side'));

// 5/6 — aiming pitch up and down, back on the three-quarter
await setCamera('threeQuarter');
await setPose({ aiming: true, pitch: .8 });
await wait(SETTLE_MS);
shots.push(await shot('05-aim-up'));
await setPose({ aiming: true, pitch: -.8 });
await wait(SETTLE_MS);
shots.push(await shot('06-aim-down'));

// 7 — reload pinned mid-stroke (hammer/action cocked)
await setPose({ aiming: false, pitch: 0 });
await wait(SETTLE_MS);
await setPose({ reload: true, reloadProgress: .49 });
await wait(SETTLE_MS);
shots.push(await shot('07-reload-pinned-0.49'));
const reloadOpen = await page.evaluate(kind => {
  const api = window.characterStudio, THREE = api.refs.THREE;
  const held = api.refs.gameModel.group.getObjectByName(`held-${kind}`);
  const action = held && held.getObjectByName(`reload-action-${kind}`);
  if (!action) return null;
  action.updateWorldMatrix(true, false);
  const position = new THREE.Vector3().setFromMatrixPosition(action.matrixWorld);
  return {
    rotationZ: Number(action.rotation.z.toFixed(5)),
    worldPosition: position.toArray().map(v => Number(v.toFixed(5))),
    pose: api.getPose(),
  };
}, KIND);

// 7b — the same pinned stroke, close up, so the moving part's travel can actually be judged
await gunCloseUp(Math.PI / 2);
await wait(600);
shots.push(await shot('07b-reload-pinned-closeup'));
await setCamera('threeQuarter');

// 8 — gliding: the gun stows on the back, seen from behind
await setPose({ reload: false, reloadProgress: null, state: 'gliding' });
await wait(SETTLE_MS * 2);
await setCamera('back');
await wait(SETTLE_MS);
shots.push(await shot('08-gliding-stowed-back'));

// 9-12 — the other guns (every kind except the one under test), three-quarter, back on the ground
await setPose({ state: 'ground' });
await setCamera('threeQuarter');
await wait(SETTLE_MS * 2);
for (const otherKind of KINDS.filter(k => k !== KIND)) {
  await setPose({ weapon: otherKind });
  await wait(SETTLE_MS);
  shots.push(await shot(`09-weapon-${otherKind}-three-quarter`));
}

const otherWeapons = await page.evaluate(kinds => {
  const api = window.characterStudio;
  const paletteSolid = api.refs.palette ? api.refs.palette.solid : null;
  const rig = api.refs.gameModel.group.getObjectByName('weapon-aim-recoil-rig');
  return kinds.map(kind => {
    const held = rig && rig.getObjectByName(`held-${kind}`);
    const body = held && held.children.find(child => child.isMesh);
    return {
      kind,
      present: !!held,
      hingePresent: !!(held && held.getObjectByName(`reload-hinge-${kind}`)),
      bodyMaterialType: body ? body.material.type : null,
      bodyMaterialIsPaletteToon: !!(body && paletteSolid && body.material === paletteSolid),
    };
  });
}, KINDS);

await setPose({ weapon: KIND });

const finalState = await page.evaluate(() => window.characterStudio.getState());

// ------------------------------------------------------------------ report --
const warnings = consoleLog.filter(entry => entry.type === 'warning' || entry.type === 'warn');
const errors = consoleLog.filter(entry => entry.type === 'error');
const report = {
  generatedAt: new Date().toISOString(),
  url: PAGE_URL,
  kind: KIND,
  viewport: { width: 1280, height: 800 },
  canvasClip: shots.length ? shots[0].clip : null,
  console: { total: consoleLog.length, errors: errors.length, warnings: warnings.length, messages: consoleLog },
  pageErrors,
  weaponAssetRequests: assetRequests,
  weaponUpgrade: rigReport,
  otherWeapons,
  reloadPinned: reloadOpen,
  studioState: {
    heroUrl: finalState.hero ? finalState.hero.url : null,
    heroTriangles: finalState.hero ? finalState.hero.triangles : null,
    gameKind: finalState.gameKind, mode: finalState.mode, lighting: finalState.lighting, pose: finalState.pose,
  },
  shots: shots.map(entry => ({ label: entry.label, path: entry.path })),
};
writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

await context.close();
await browser.close();

console.log(`shots -> ${OUT}`);
for (const entry of shots) console.log(`  ${entry.label}`);
console.log(`console: ${errors.length} error(s), ${warnings.length} warning(s), ${consoleLog.length} message(s)`);
for (const entry of consoleLog) console.log(`  [${entry.type}] ${entry.text}`);
console.log(`${WEAPON_ASSET_PREFIX} requests:`);
if (!assetRequests.length) console.log('  (none)');
for (const entry of assetRequests) console.log(`  ${entry.status ?? entry.outcome} ${entry.url} ${entry.statusText}`);
console.log(`${KIND} upgraded: ${rigReport.upgraded}`);
console.log(`markers: ${JSON.stringify(rigReport.markers)}`);
console.log(`muzzle socket: ${JSON.stringify(rigReport.muzzleSocket)}`);
console.log(`held-${KIND} local bounds: ${JSON.stringify(rigReport.heldBoundsLocal)}`);
