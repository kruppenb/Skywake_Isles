// Reproducible underwater art inspection. This loads production presentation
// modules from --origin, but uses a synthetic Game snapshot and never opens a
// socket or sends gameplay actions to that origin. Captures are presentation
// evidence only; they do not prove gameplay, collision, or network behavior.
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Game } from '../../../server/game.js';

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const ORIGIN = value('--origin', 'http://localhost:3400').replace(/\/$/, '');
const OUT = path.resolve(value('--out', '.qa/underwater-art'));
const QUALITY = value('--quality', 'both');
const BROWSER = value('--browser', 'msedge');
const VIEWS = value('--views', '').split(',').map(v => v.trim()).filter(Boolean);
const NO_OVERWORLD = args.includes('--no-overworld');
const TIMING = args.includes('--timing');
const REDUCED_MOTION = args.includes('--reduced-motion');
const viewportValue = value('--viewport', '1440x900').split('x').map(Number);
const VIEWPORT = { width: viewportValue[0] || 1440, height: viewportValue[1] || 900 };
const consoleErrors = [], pageErrors = [], failedRequests = [];
const report = { generatedAt: new Date().toISOString(), origin: ORIGIN, viewport: VIEWPORT, quality: QUALITY, browser: BROWSER, reducedMotion: REDUCED_MOTION, presentationOnly: true, views: [], consoleErrors, pageErrors, failedRequests };

if (!['high', 'low', 'both'].includes(QUALITY)) throw new Error('--quality must be high, low, or both');
if (!['chrome', 'msedge'].includes(BROWSER)) throw new Error('--browser must be chrome or msedge');
const originUrl = new URL(ORIGIN);
if (!['http:', 'https:'].includes(originUrl.protocol)) throw new Error('--origin must be an http(s) URL');

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_INDEX, 'playwright', 'playwright-core',
    'file:///C:/Users/nicho/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'];
  const errors = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return await import(candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate) ? pathToFileURL(candidate).href : candidate); } catch (error) { errors.push(`${candidate}: ${error.message}`); }
  }
  throw new Error(`Playwright was not found. Set PLAYWRIGHT_INDEX to its index.mjs.\n${errors.join('\n')}`);
}

let browser, context, page;
try {
const { chromium } = await loadPlaywright();
browser = await chromium.launch({ channel: BROWSER, headless: true });
context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: REDUCED_MOTION ? 'reduce' : 'no-preference' });
page = await context.newPage();
await mkdir(OUT, { recursive: true });
page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleErrors.push({ type: message.type(), text: message.text() }); });
page.on('pageerror', error => pageErrors.push(String(error)));
page.on('response', response => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'request failed' }));

const originHtml = await (await fetch(ORIGIN)).text();
const importMap = originHtml.match(/<script type="importmap">[\s\S]*?<\/script>/)?.[0];
if (!importMap) throw new Error(`No import map found at ${ORIGIN}`);
const syntheticHtml = `<!doctype html><html><head>${importMap}<style>html,body{margin:0;height:100%;overflow:hidden;background:#071d27}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="world"></canvas><script type="module">import{createWorld}from'/world.js';import{reefRegionAt}from'/shared/underwater-content.js';window.reefRegionAt=reefRegionAt;window.world=createWorld(document.querySelector('#world'));window.ready=true;</script></body></html>`;
await page.route(`${ORIGIN}/__qa_underwater_art`, route => route.fulfill({ contentType: 'text/html', body: syntheticHtml }));

const views = [
  { name: 'sunken-wreck-front', region: 'sunken-reach', player: [0, 8, 8], camera: [8, 7, 24], target: [8, 3, -10], note: 'entry wreck front' },
  { name: 'sunken-wreck-interior', region: 'sunken-reach', player: [0, 6, 8], camera: [8, 3, -3], target: [8, 3, -15], note: 'entry wreck interior' },
  { name: 'sunken-reach-art', region: 'sunken-reach', player: [0, 8, 8], camera: [39, 14, 35], target: [25, 15, 13], note: 'return watch structure' },
  { name: 'coral-gardens', region: 'coral-gardens', player: [-70, 10, 72], camera: [-35, 12, 96], target: [-70, 12, 72] },
  { name: 'coral-gardens-close', region: 'coral-gardens', player: [-70, 4, 72], camera: [-58, 3, 87], target: [-64, 5, 78], note: 'shelf materials' },
  { name: 'kelp-hollows', region: 'kelp-hollows', player: [-88, 10, -20], camera: [-60, 13, 5], target: [-88, 14, -20] },
  { name: 'kelp-hollows-close', region: 'kelp-hollows', player: [-88, 4, -20], camera: [-76, 3, -5], target: [-82, 5, -13], note: 'root and silt materials' },
  { name: 'bell-sanctuary', region: 'bell-sanctuary', player: [2, 11, -95], camera: [30, 13, -74], target: [2, 13, -95] },
  { name: 'bell-sanctuary-close', region: 'bell-sanctuary', player: [2, 4, -95], camera: [17, 3, -84], target: [2, 7, -95], note: 'ashlar and bell fittings' },
  { name: 'ember-vents', region: 'ember-vents', player: [88, 12, -65], camera: [59, 14, -42], target: [88, 15, -65] },
  { name: 'ember-vents-close', region: 'ember-vents', player: [88, 4, -65], camera: [76, 3, -78], target: [78, 7, -72], note: 'basalt and mineral seams' },
  { name: 'crown-graveyard', region: 'crown-graveyard', player: [84, 13, 40], camera: [51, 15, 68], target: [84, 16, 40] },
  { name: 'crown-graveyard-close', region: 'crown-graveyard', player: [84, 4, 40], camera: [73, 3, 54], target: [80, 8, 31], note: 'keel and reefstone materials' },
  { name: 'old-watch-compare', region: 'island', player: [-64, 4, -76], camera: null, target: null, yaw: .6, pitch: .03, overworld: true },
].filter(view => !NO_OVERWORLD || !view.overworld).filter(view => !VIEWS.length || VIEWS.includes(view.name));

const game = new Game();
const qaPlayer = game.addPlayer('qa-art', 'Art Reviewer', '#9be6da');
game.phase = 'voyage'; game.elapsed = 45;
const makeSnapshot = view => {
  const [x, y, z] = view.player;
  Object.assign(qaPlayer, { x, y, z, realm: view.overworld ? 'island' : 'reef', mode: view.overworld ? 'ground' : 'swimming', grounded: view.overworld, hp: 100, maxHp: 100, yaw: view.yaw || 0, pitch: view.pitch || 0 });
  const state = game.snapshot();
  // The local player remains valid for lighting/realm selection, while an
  // empty player list keeps the reviewer avatar out of the presentation shot.
  const player = state.players[0]; state.players = [];
  return { state, player };
};

await page.goto(`${ORIGIN}/__qa_underwater_art`);
await page.waitForFunction(() => window.ready, { timeout: 30000 });
await page.waitForFunction(() => {
  const s = window.world?.getStats?.(); const assets = s?.environmentAssets;
  return s && s.underwater?.ready && (!assets || assets.loading === 0) && (!s.oldWatch || s.oldWatch.status === 'ready') && (!s.island || s.island.status === 'ready');
}, null, { timeout: 30000 });
for (const view of views) {
  for (const quality of QUALITY === 'both' ? ['high', 'low'] : [QUALITY]) {
    const capture = await page.evaluate(async ({ view, quality, snapshot, timing }) => {
      const { state, player } = snapshot;
      world.setQuality(quality); world.update(1 / 60, state, player, { menu: false, yaw: view.yaw || 0, pitch: view.pitch || 0, time: 18, round: 1 });
      const restore = () => { if (view.camera) { world.camera.position.set(...view.camera); world.camera.lookAt(...view.target); world.camera.updateMatrixWorld(true); } };
      restore();
      for (let i = 0; i < 30; i++) { world.update(1 / 60, state, player, { menu: false, yaw: view.yaw || 0, pitch: view.pitch || 0, time: 18 + i / 60, round: 1 }); restore(); world.render(); await new Promise(resolve => requestAnimationFrame(resolve)); }
      const timings = [];
      for (let i = 0; i < (timing ? 120 : 0); i++) { const start = performance.now(); world.update(1 / 60, state, player, { menu: false, yaw: view.yaw || 0, pitch: view.pitch || 0, time: 19 + i / 60, round: 1 }); restore(); world.render(); await new Promise(resolve => requestAnimationFrame(resolve)); timings.push(performance.now() - start); }
      world.render(); await new Promise(resolve => requestAnimationFrame(resolve)); world.render();
      timings.sort((a, b) => a - b);
      return { stats: world.getStats(), camera: world.camera.position.toArray(), player: { x: player.x, y: player.y, z: player.z }, regionAtCamera: view.overworld ? 'island' : (window.reefRegionAt?.(world.camera.position.x, world.camera.position.z)?.id || 'unknown'), timing: timings.length ? { meanMs: +(timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(2), p95Ms: +timings[Math.floor(timings.length * .95)].toFixed(2), disclaimer: 'update+camera restore+render telemetry, not a device performance guarantee' } : null };
    }, { view, quality, snapshot: makeSnapshot(view), timing: TIMING });
    const file = `${view.name}-${quality}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    report.views.push({ name: view.name, quality, file, note: view.note || 'region landmark frame', calls: capture.stats.calls, triangles: capture.stats.triangles, stats: capture.stats, camera: capture.camera, player: capture.player, regionAtCamera: capture.regionAtCamera, timing: capture.timing });
  }
}
if (TIMING) report.timing = { mode: 'per-view update+camera restore+render samples', reducedMotion: REDUCED_MOTION };
await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  report.error = String(error?.stack || error);
  report.consoleErrors = consoleErrors;
  report.pageErrors = pageErrors;
  report.failedRequests = failedRequests;
  await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  console.error(`underwater art capture failed after ${report.views.length} view(s): ${error.message}`);
  process.exitCode = 1;
} finally { if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {}); }
console.log(JSON.stringify({ out: OUT, presentationOnly: true, views: report.views.length, errors: consoleErrors.length + pageErrors.length + failedRequests.length, timing: report.timing || null }, null, 2));
if (consoleErrors.length || pageErrors.length || failedRequests.length) process.exitCode = 1;
