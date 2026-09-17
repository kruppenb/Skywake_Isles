// Reproducible structure art inspection. Uses production presentation and a
// synthetic voyage snapshot; it never opens a game socket or sends actions.
// Gameplay views retain the real follow camera and local avatar. Only named
// overview views place a free inspection camera after each update.
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Game } from '../../../server/game.js';
import { heightAt } from '../../../shared/world.js';
import { CAPTAINS_HOUSE } from '../../../shared/captains-house.js';
import { SUNKEN_MANOR } from '../../../shared/sunken-manor.js';

const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const ORIGIN = value('--origin', 'http://localhost:3400').replace(/\/$/, '');
const OUT = path.resolve(value('--out', '.qa/structures-capture'));
const QUALITY = value('--quality', 'high');
const BROWSER = value('--browser', 'msedge');
const VIEWS = value('--views', '').split(',').map(name => name.trim()).filter(Boolean);
const viewportParts = value('--viewport', '1440x900').split('x').map(Number);
const VIEWPORT = { width: viewportParts[0] || 1440, height: viewportParts[1] || 900 };
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
    try { return await import(candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate) ? pathToFileURL(candidate).href : candidate); }
    catch (error) { errors.push(`${candidate}: ${error.message}`); }
  }
  throw new Error(`Playwright was not found. Set PLAYWRIGHT_INDEX to its index.mjs.\n${errors.join('\n')}`);
}

const base = heightAt(CAPTAINS_HOUSE.x, CAPTAINS_HOUSE.z);
const housePoint = (x, level, z) => [CAPTAINS_HOUSE.x + x, base + level, CAPTAINS_HOUSE.z + z];
const views = [
  { name: 'house-overview', realm: 'island', player: housePoint(0, 0, 13), camera: [-43, base + 22, 100], target: [CAPTAINS_HOUSE.x, base + 8, CAPTAINS_HOUSE.z], note: 'free camera facade and setting' },
  { name: 'house-entry-gameplay', realm: 'island', player: housePoint(0, 0, 7.2), yaw: 0, note: 'actual follow camera at front threshold' },
  { name: 'house-ground-gameplay', realm: 'island', player: housePoint(0, 0, 0), yaw: 0, note: 'actual follow camera in living room' },
  { name: 'house-front-wall-gameplay', realm: 'island', player: housePoint(0, 0, 7.7), yaw: 0, note: 'follow camera constrained by front wall' },
  { name: 'house-west-wall-gameplay', realm: 'island', player: housePoint(-8.5, 0, 0), yaw: Math.PI / 2, note: 'follow camera after 180-degree turn beside side wall' },
  { name: 'house-stair-gameplay', realm: 'island', player: housePoint(6, 2.46, 0), yaw: 0, note: 'actual follow camera on lower stair' },
  { name: 'house-upper-gameplay', realm: 'island', player: housePoint(0, 4.6, -1.8), yaw: 0, note: 'actual follow camera between bedroom and chart room' },
  { name: 'house-balcony-gameplay', realm: 'island', player: housePoint(0, 4.6, 10.8), yaw: Math.PI, note: 'actual follow camera facing seaward from balcony' },
  { name: 'house-attic-gameplay', realm: 'island', player: housePoint(1, 9.2, -1), yaw: 0, note: 'actual follow camera in lookout' },
  { name: 'manor-overview', realm: 'reef', player: [SUNKEN_MANOR.x, 2.1, SUNKEN_MANOR.z + 17], camera: [68, 23, -14], target: [SUNKEN_MANOR.x, 9, SUNKEN_MANOR.z], note: 'free camera flooded shell and entrances' },
  { name: 'manor-ground-gameplay', realm: 'reef', player: [SUNKEN_MANOR.x, SUNKEN_MANOR.levels[0].swimY, SUNKEN_MANOR.z + 3], yaw: 0, note: 'actual swim camera in dining level' },
  { name: 'manor-upper-gameplay', realm: 'reef', player: [SUNKEN_MANOR.x, SUNKEN_MANOR.levels[1].swimY, SUNKEN_MANOR.z + 3], yaw: 0, note: 'actual swim camera in library level' },
  { name: 'manor-gallery-gameplay', realm: 'reef', player: [SUNKEN_MANOR.x, SUNKEN_MANOR.levels[2].swimY, SUNKEN_MANOR.z + 3], yaw: 0, note: 'actual swim camera in broken gallery' },
].filter(view => !VIEWS.length || VIEWS.includes(view.name));
if (!views.length) throw new Error('No matching --views');

const report = { generatedAt: new Date().toISOString(), origin: ORIGIN, out: OUT,
  browser: BROWSER, quality: QUALITY, viewport: VIEWPORT, presentationOnly: true,
  views: [], consoleErrors: [], pageErrors: [], failedRequests: [] };
let browser, context, page;
try {
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ channel: BROWSER, headless: true });
  context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
  page = await context.newPage();
  await mkdir(OUT, { recursive: true });
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('response', response => { if (response.status() >= 400) report.failedRequests.push({ url: response.url(), status: response.status() }); });
  page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'request failed' }));

  const originHtml = await (await fetch(ORIGIN)).text();
  const importMap = originHtml.match(/<script type="importmap">[\s\S]*?<\/script>/)?.[0];
  if (!importMap) throw new Error(`No import map found at ${ORIGIN}`);
  const html = `<!doctype html><html><head>${importMap}<style>html,body{margin:0;height:100%;overflow:hidden;background:#071d27}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="world"></canvas><script type="module">import{createWorld}from'/world.js';import{hasWorldLineOfSight}from'/shared/collision.js';window.hasWorldLineOfSight=hasWorldLineOfSight;window.world=createWorld(document.querySelector('#world'));window.ready=true;</script></body></html>`;
  await page.route(`${ORIGIN}/__qa_structures`, route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`${ORIGIN}/__qa_structures`);
  await page.waitForFunction(() => window.ready, { timeout: 30000 });
  await page.waitForFunction(() => {
    const stats = window.world?.getStats?.();
    return stats?.underwater?.ready && stats?.captainsHouse && stats?.island?.status === 'ready';
  }, null, { timeout: 30000 });

  const game = new Game(), qaPlayer = game.addPlayer('qa-structures', 'Structure Reviewer', '#9be6da');
  game.phase = 'voyage'; game.elapsed = 45;
  for (const view of views) for (const quality of QUALITY === 'both' ? ['high', 'low'] : [QUALITY]) {
    const [x, y, z] = view.player;
    Object.assign(qaPlayer, { x, y, z, realm: view.realm, mode: view.realm === 'reef' ? 'swimming' : 'ground',
      grounded: view.realm !== 'reef', hp: 100, maxHp: 100, yaw: view.yaw || 0, pitch: 0 });
    const state = game.snapshot(), player = state.players.find(candidate => candidate.id === qaPlayer.id);
    const capture = await page.evaluate(async ({ view, quality, state, player }) => {
      world.setQuality(quality);
      // Travel discontinuity makes the follow camera snap to this new room.
      world.camera.position.set(999, 999, 999);
      for (let i = 0; i < 45; i++) {
        world.update(1 / 60, state, player, { menu: false, yaw: view.yaw || 0, pitch: 0, time: 18 + i / 60, round: 1 });
        if (view.camera) { world.camera.position.set(...view.camera); world.camera.lookAt(...view.target); world.camera.updateMatrixWorld(true); }
        world.render(); await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const anchor = { x: player.x, y: player.y + 2.65, z: player.z };
      return { stats: world.getStats(), camera: world.camera.position.toArray(),
        cameraClear: view.realm !== 'island' || !!view.camera || window.hasWorldLineOfSight(anchor, world.camera.position, .22),
        player: { x: player.x, y: player.y, z: player.z } };
    }, { view, quality, state, player });
    if (!capture.cameraClear) throw new Error(`House follow camera crossed a wall in ${view.name}-${quality}`);
    const file = `${view.name}-${quality}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    report.views.push({ name: view.name, quality, file, note: view.note, camera: capture.camera,
      player: capture.player, cameraClear: capture.cameraClear, calls: capture.stats.calls, triangles: capture.stats.triangles, stats: capture.stats });
  }
  await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  report.error = String(error?.stack || error);
  await mkdir(OUT, { recursive: true }).catch(() => {});
  await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  console.error(`structure capture failed after ${report.views.length} view(s): ${error.message}`);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}
console.log(JSON.stringify({ out: OUT, views: report.views.length,
  errors: report.consoleErrors.length + report.pageErrors.length + report.failedRequests.length }, null, 2));
if (report.consoleErrors.length || report.pageErrors.length || report.failedRequests.length) process.exitCode = 1;
