// Reproducible browser capture for the airship model under the game's baseline light.
//
// Usage:
//   node tools/qa/ship/capture.mjs [--origin http://localhost:3401]
//       [--out .qa/ship/baseline]
//
// The script starts no server and uses an independently launched Playwright Chrome.
// It builds the live client model in a tiny same-origin fixture page, so captures do
// not depend on a QA-only product route.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const ORIGIN = opt('--origin', 'http://localhost:3401').replace(/\/$/, '');
const OUT = path.resolve(process.cwd(), opt('--out', path.join('.qa', 'ship', 'capture')));
const PLAYWRIGHT_INDEX = process.env.PLAYWRIGHT_INDEX
  || 'file:///C:/Users/nicho/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(PLAYWRIGHT_INDEX);

let health;
try { health = await fetch(`${ORIGIN}/health`); } catch (error) {
  console.error(`error: cannot reach ${ORIGIN}/health (${error.message})`); process.exit(1);
}
if (!health.ok) { console.error(`error: ${ORIGIN}/health returned ${health.status}`); process.exit(1); }

mkdirSync(OUT, { recursive: true });
const consoleLog = [], pageErrors = [];
console.error(`ship QA: launching Chrome for ${ORIGIN}`);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
console.error('ship QA: Chrome launched');
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('console', message => consoleLog.push({ type: message.type(), text: message.text(), location: message.location()?.url || null }));
page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
// The fixture has no product favicon route; consume the browser's automatic probe so
// a report error always means the actual ship setup or renderer failed.
await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));

await page.goto(`${ORIGIN}/health`, { waitUntil: 'load' });
console.error('ship QA: health page loaded; installing fixture');
await page.setContent(`<!doctype html><html><head>
  <meta charset="utf-8"><link rel="icon" href="data:,">
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#85d9ee}canvas{display:block;width:1280px;height:900px}</style>
  <script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
</head><body><canvas id="ship-canvas" width="1280" height="900"></canvas>
<script type="module">
import * as THREE from 'three';
import { makePalette, buildGalleon } from '/models.js';
import { buildPlayerCharacter, loadNavigatorAsset } from '/player-character.js';
import { SHIP_GUNS } from '/shared/airship.js';

const canvas = document.querySelector('#ship-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#85d9ee');
scene.fog = new THREE.Fog('#a2def0', 180, 610);
const camera = new THREE.PerspectiveCamera(53, 1280 / 900, .12, 1100);
const hemisphere = new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2); scene.add(hemisphere);
const sun = new THREE.DirectionalLight('#fff0d0', 2.7); sun.position.set(-70, 140, 80); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.00025; sun.shadow.normalBias = .06;
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 10, far: 360 });
sun.shadow.camera.updateProjectionMatrix(); scene.add(sun, sun.target);
const palette = makePalette(), ship = buildGalleon(palette); scene.add(ship.group);
const navigatorAsset = await loadNavigatorAsset();
const navigator = buildPlayerCharacter(palette, '#f4a261', { asset: navigatorAsset });
await new Promise(resolve => setTimeout(resolve, 0));
if (navigator.kind !== 'navigator') throw new Error('navigator asset did not build in the isolated fixture');
 navigator.group.name = 'qa-navigator';
const state = { renderer, scene, camera, palette, ship, navigator, navigatorShown: false };
window.shipQa = {
  state,
  setCamera(name) {
    const poses = {
      full: [[39, 25, -48], [0, 7, 0], 40],
      front: [[0, 8, -43], [0, 5, -1], 53],
      stern: [[0, 8, 43], [0, 5, 3], 53],
      side: [[40, 10, 4], [0, 4, 0], 53],
      deck: [[0, 31, 12], [0, 1, 0], 53],
      cannon: [[12, 5.7, -12], [4.2, 1.2, -5.2], 30],
    };
    const [position, target, fov] = poses[name] || poses.full;
    camera.position.set(...position); camera.fov = fov; camera.lookAt(...target); camera.updateProjectionMatrix();
  },
  showNavigator(value) {
    state.navigatorShown = value;
    if (value && !navigator.group.parent) scene.add(navigator.group);
    navigator.group.visible = value;
    if (value) navigator.group.position.set(3.75, 0, 0);
  },
  render() {
    ship.group.updateMatrixWorld(true); navigator.group.updateMatrixWorld(true); renderer.render(scene, camera);
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      points: renderer.info.render.points, lines: renderer.info.render.lines };
  },
};
window.shipQa.setCamera('full'); window.shipQa.showNavigator(false); window.shipQa.render();
</script></body></html>`, { waitUntil: 'load' });
console.error('ship QA: fixture loaded');
await page.waitForFunction(() => !!window.shipQa, null, { timeout: 30000 }).catch(error => {
  console.error(`ship QA: fixture did not initialize (${error.message})`);
  console.error(`ship QA console: ${JSON.stringify(consoleLog)}`);
  console.error(`ship QA page errors: ${JSON.stringify(pageErrors)}`);
  throw error;
});
console.error('ship QA: ship API ready');

const metrics = await page.evaluate(() => {
  const { ship, renderer } = window.shipQa.state;
  const meshes = [], materials = new Set(); let triangles = 0, finite = true;
  const check = value => { if (!Number.isFinite(value)) finite = false; };
  ship.group.updateMatrixWorld(true);
  ship.group.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    meshes.push({ name: object.name || '', geometry: object.geometry.type, vertices: object.geometry.attributes.position?.count || 0 });
    const index = object.geometry.index;
    triangles += Math.floor((index ? index.count : object.geometry.attributes.position?.count || 0) / 3);
    for (const attribute of Object.values(object.geometry.attributes)) for (const value of attribute.array) check(value);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material);
  });
  const materialInfo = material => material ? { type: material.type, transparent: !!material.transparent,
    opacity: material.opacity, depthWrite: material.depthWrite } : null;
  const materialCount = node => {
    const found = new Set(); node.traverse(object => { if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) found.add(material);
    }); return found;
  };
  const cabinMaterials = materialCount(ship.cabin), sailMaterials = materialCount(ship.sails);
  let allFiniteTransforms = true;
  ship.group.traverse(object => {
    for (const vector of [object.position, object.rotation, object.scale]) {
      if (![vector.x, vector.y, vector.z].every(Number.isFinite)) allFiniteTransforms = false;
    }
    if (!object.matrix.elements.every(Number.isFinite)) allFiniteTransforms = false;
  });
  return {
    visibleMeshCount: meshes.length, triangles, finiteGeometry: finite, finiteTransforms: allFiniteTransforms,
    meshes, uniqueMaterialCount: materials.size,
    cabin: { mesh: ship.cabin.isMesh, materialCount: cabinMaterials.size, material: materialInfo(ship.cabin.material),
      childCount: ship.cabin.children.length },
    sails: { mesh: ship.sails.isMesh, materialCount: sailMaterials.size, material: materialInfo(ship.sails.material),
      childCount: ship.sails.children.length },
    render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
  };
});

const canvas = page.locator('#ship-canvas');
const shots = [];
for (const [label, camera, navigatorShown] of [
  ['01-full-three-quarter', 'full', false], ['02-front-bow', 'front', false], ['03-stern', 'stern', false],
  ['04-starboard-side', 'side', false], ['05-deck-top', 'deck', false], ['06-cannon-closeup', 'cannon', true],
]) {
  const render = await page.evaluate(({ camera, navigatorShown }) => { window.shipQa.showNavigator(navigatorShown); window.shipQa.setCamera(camera); return window.shipQa.render(); }, { camera, navigatorShown });
  const filePath = path.join(OUT, `${label}.png`); await canvas.screenshot({ path: filePath });
  shots.push({ label, path: filePath, camera, navigatorShown, render });
}

const consoleErrors = consoleLog.filter(entry => entry.type === 'error');
const warnings = consoleLog.filter(entry => entry.type === 'warning' || entry.type === 'warn');
const budgetOk = metrics.finiteGeometry && metrics.finiteTransforms && metrics.visibleMeshCount <= 60 && metrics.triangles <= 100_000;
const report = { generatedAt: new Date().toISOString(), origin: ORIGIN, viewport: { width: 1280, height: 900 },
  console: { total: consoleLog.length, errors: consoleErrors.length, warnings: warnings.length, messages: consoleLog },
  pageErrors, geometry: { ...metrics, budgetOk, budgets: { maxVisibleMeshes: 60, maxTriangles: 100_000 } }, shots };
writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await context.close(); await browser.close();
console.log(`shots -> ${OUT}`);
for (const shot of shots) console.log(`  ${shot.label} (${shot.render.calls} draw calls, ${shot.render.triangles} triangles)`);
console.log(`geometry: ${metrics.visibleMeshCount} visible mesh(es), ${metrics.triangles} triangles, finite=${metrics.finiteGeometry}`);
console.log(`console: ${report.console.errors} error(s), ${report.console.warnings} warning(s), page errors=${pageErrors.length}`);
if (consoleErrors.length || pageErrors.length || !budgetOk) process.exitCode = 1;
