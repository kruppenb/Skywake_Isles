// Reproducible presentation QA for reef wayfinding and fish response.
// Loads production modules through a synthetic page; no socket or gameplay
// action is sent to the origin. Missing optional diagnostics are reported as
// missing diagnostics are reported as failures so the evidence cannot hide an
// integration regression.
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Game } from '../../../server/game.js';

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const ORIGIN = value('--origin', 'http://localhost:3400').replace(/\/$/, '');
const OUT = path.resolve(value('--out', '.qa/underwater-wayfinding'));
const QUALITY = value('--quality', 'both');
const BROWSER = value('--browser', 'msedge');
const REDUCED = args.includes('--reduced-motion');
const viewportValue = value('--viewport', '1440x900').split('x').map(Number);
const VIEWPORT = { width: viewportValue[0] || 1440, height: viewportValue[1] || 900 };
const consoleErrors = [], pageErrors = [], failedRequests = [];
const report = { generatedAt: new Date().toISOString(), origin: ORIGIN, viewport: VIEWPORT, quality: QUALITY, browser: BROWSER, reducedMotion: REDUCED, presentationOnly: true, views: [], checks: [], consoleErrors, pageErrors, failedRequests };
if (!['high', 'low', 'both'].includes(QUALITY)) throw new Error('--quality must be high, low, or both');
if (!['chrome', 'msedge'].includes(BROWSER)) throw new Error('--browser must be chrome or msedge');
if (!/^https?:$/.test(new URL(ORIGIN).protocol)) throw new Error('--origin must be an http(s) URL');

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_INDEX, 'playwright', 'playwright-core', 'file:///C:/Users/nicho/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'];
  const errors = [];
  for (const candidate of candidates) if (candidate) try { return await import(candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate) ? pathToFileURL(candidate).href : candidate); } catch (error) { errors.push(`${candidate}: ${error.message}`); }
  throw new Error(`Playwright was not found. Set PLAYWRIGHT_INDEX to its index.mjs.\n${errors.join('\n')}`);
}

const views = [
  { name: 'entry-route', player: [-18, 6, 20], camera: [-12, 8, 32], target: [-35, 8, 36], note: 'route entry at authored dive approach' },
  { name: 'route-fork-murk', player: [-38, 12, 48], camera: [-22, 14, 57], target: [-52, 15, 66], note: 'inter-region fork in fog' },
  { name: 'vertical-poi-approach', player: [-82, 20, 61], camera: [-69, 17, 75], target: [-82, 30, 62], note: 'vertical approach to Pearl Spire' },
  { name: 'school-calm-close', player: [0, 5, 8], camera: [5, 5, 15], target: [0, 5, 8], fishPhase: 'calm' },
  { name: 'school-approaching-player', player: [-5, 7, 12], camera: [12, 5, 18], target: [-5, 7, 12], fishPhase: 'approach' },
  { name: 'school-after-scatter', player: [18, 5, 22], camera: [27, 6, 30], target: [18, 5, 22], fishPhase: 'scatter' },
  { name: 'school-regroup', player: [28, 5, 32], camera: [37, 6, 40], target: [28, 5, 32], fishPhase: 'regroup' },
];

let browser, context, page;
try {
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ channel: BROWSER, headless: true });
  context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: REDUCED ? 'reduce' : 'no-preference' });
  page = await context.newPage(); await mkdir(OUT, { recursive: true });
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleErrors.push({ type: message.type(), text: message.text() }); });
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('response', response => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'request failed' }));
  const originHtml = await (await fetch(ORIGIN)).text();
  const importMap = originHtml.match(/<script type="importmap">[\s\S]*?<\/script>/)?.[0];
  if (!importMap) throw new Error(`No import map found at ${ORIGIN}`);
  const syntheticHtml = `<!doctype html><html><head>${importMap}<style>html,body{margin:0;height:100%;overflow:hidden;background:#071d27}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="world"></canvas><script type="module">import{createWorld}from'/world.js';import{reefRegionAt}from'/shared/underwater-content.js';window.reefRegionAt=reefRegionAt;window.world=createWorld(document.querySelector('#world'));window.ready=true;</script></body></html>`;
  await page.route(`${ORIGIN}/__qa_underwater_wayfinding`, route => route.fulfill({ contentType: 'text/html', body: syntheticHtml }));

  const game = new Game(); const qaPlayer = game.addPlayer('qa-wayfinding', 'Wayfinding Reviewer', '#9be6da'); game.phase = 'voyage'; game.elapsed = 45;
  const snapshot = view => { const [x, y, z] = view.player; Object.assign(qaPlayer, { x, y, z, realm: 'reef', mode: 'swimming', grounded: false, hp: 100, maxHp: 100, yaw: 0, pitch: 0 }); const state = game.snapshot(); const player = state.players[0]; state.players = []; return { state, player }; };
  await page.goto(`${ORIGIN}/__qa_underwater_wayfinding`); await page.waitForFunction(() => window.ready, { timeout: 30000 });
  await page.waitForFunction(() => { const s = window.world?.getStats?.(); return s?.underwater?.ready && (!s.environmentAssets || s.environmentAssets.loading === 0); }, null, { timeout: 30000 });

  for (const quality of QUALITY === 'both' ? ['high', 'low'] : [QUALITY]) {
    await page.goto(`${ORIGIN}/__qa_underwater_wayfinding`); await page.waitForFunction(() => window.ready, { timeout: 30000 }); await page.waitForFunction(() => { const s = window.world?.getStats?.(); return s?.underwater?.ready && (!s.environmentAssets || s.environmentAssets.loading === 0); }, null, { timeout: 30000 }); await page.evaluate(() => { window.__qaTime = 0; window.__qaApproachPlayer = null; });
    for (const view of views) {
    const result = await page.evaluate(async ({ view, quality, snap }) => {
      const { state, player } = snap; world.setQuality(quality);
      const before = world.getStats(), first = before.underwater?.fishSchools?.schools?.[0] || before.underwater?.fishSchools?.[0] || before.underwater?.schools?.[0];
      const center = first?.center || { x: -23, y: 7.2, z: 26 };
      if (view.fishPhase === 'calm') Object.assign(player, { x: center.x + 12, y: center.y + 4, z: center.z + 7 });
      if (view.fishPhase === 'approach') Object.assign(player, { x: center.x + 2.5, y: center.y + 1, z: center.z + 2 });
      if (view.fishPhase === 'approach') window.__qaApproachPlayer = { x: player.x, y: player.y, z: player.z };
      if (view.fishPhase === 'scatter' && window.__qaApproachPlayer) Object.assign(player, window.__qaApproachPlayer);
      if (view.fishPhase === 'regroup') Object.assign(player, { x: 130, y: 40, z: 130 });
      const target = view.fishPhase ? center : { x: view.target[0], y: view.target[1], z: view.target[2] };
      const camera = view.fishPhase ? [center.x + 13, center.y + 7, center.z + 15] : view.camera;
      const restore = () => { world.camera.position.set(...camera); world.camera.lookAt(target.x, target.y, target.z); world.camera.updateMatrixWorld(true); };
      const frames = view.fishPhase === 'regroup' ? 300 : view.fishPhase === 'scatter' ? 42 : 48;
      const startTime = Number.isFinite(window.__qaTime) ? window.__qaTime : 0;
      for (let i = 0; i < frames; i++) { window.__qaTime = startTime + (i + 1) / 60; world.update(1 / 60, state, player, { menu: false, yaw: 0, pitch: 0, time: window.__qaTime, round: 1 }); restore(); world.render(); await new Promise(r => requestAnimationFrame(r)); }
      const stats = world.getStats();
      return { stats, camera: world.camera.position.toArray(), player: { x: player.x, y: player.y, z: player.z }, regionAtPlayer: window.reefRegionAt?.(player.x, player.z)?.id || 'unknown', optionalWayfinding: stats.underwater?.wayfinding || null, optionalFish: stats.underwater?.fishSchools || stats.underwater?.schools || stats.underwater?.fishDiagnostics || null };
    }, { view, quality, snap: snapshot(view) });
    const file = `${view.name}-${quality}.png`; await page.screenshot({ path: path.join(OUT, file) });
    report.views.push({ name: view.name, quality, file, note: view.note || null, phase: view.fishPhase || null, stats: result.stats, camera: result.camera, player: result.player, regionAtPlayer: result.regionAtPlayer, diagnostics: { wayfinding: result.optionalWayfinding, fish: result.optionalFish } });
    }
  }
  const routeViews = report.views.filter(v => ['entry-route', 'route-fork-murk', 'vertical-poi-approach'].includes(v.name));
  const routeDiagnostics = routeViews.map(v => v.diagnostics.wayfinding).filter(Boolean);
  const routeRegions = [...new Set(routeViews.map(v => v.regionAtPlayer))];
  report.checks.push(routeDiagnostics.length ? { name: 'route-guidance-diagnostics', status: routeDiagnostics.every(d => Number(d.routes) > 0 && Number(d.routePoints) > 0 && Number(d.pearls) > 0) ? 'pass' : 'fail', evidence: routeDiagnostics, regionEvidence: routeRegions } : { name: 'route-guidance-diagnostics', status: 'fail', reason: 'production world.getStats().underwater exposes no wayfinding diagnostic', regionEvidence: routeRegions });
  const fishViews = report.views.filter(v => v.phase); const fishDiagnostics = fishViews.map(v => v.diagnostics.fish).filter(Boolean);
  if (fishDiagnostics.length) for (const quality of [...new Set(fishViews.map(v => v.quality))]) {
    const phase = name => { const value = report.views.find(v => v.quality === quality && v.phase === name)?.diagnostics.fish; return Array.isArray(value) ? value : value?.schools; };
    const calm = phase('calm'), approach = phase('approach'), scatter = phase('scatter'), regroup = phase('regroup');
    const valid = value => Array.isArray(value) && value.length > 0 && value.every(s => s.count > 0 && s.center && Number.isFinite(s.center.x) && Number.isFinite(s.center.y) && Number.isFinite(s.center.z));
    const alarmed = value => Array.isArray(value) && value.some(s => s.alarm === true || (Number.isFinite(s.alarm) && s.alarm > 0));
    const speed = value => Array.isArray(value) ? Math.max(...value.map(s => Number(s.speed) || 0)) : 0;
    const settled = value => Array.isArray(value) && value.every(s => s.alarm === false || s.alarm === 0);
    const firstCenter = value => value?.[0]?.center, sameCenter = (a, b) => a && b && a.x === b.x && a.y === b.y && a.z === b.z;
    const freeze = sameCenter(firstCenter(calm), firstCenter(approach)) && sameCenter(firstCenter(approach), firstCenter(scatter)) && sameCenter(firstCenter(scatter), firstCenter(regroup));
    const movement = firstCenter(approach) && firstCenter(scatter) ? { x: firstCenter(scatter).x - firstCenter(approach).x, y: firstCenter(scatter).y - firstCenter(approach).y, z: firstCenter(scatter).z - firstCenter(approach).z } : null;
    const approachPlayer = report.views.find(v => v.quality === quality && v.phase === 'approach')?.player;
    const approachCenter = firstCenter(approach);
    const awayVector = approachCenter && approachPlayer ? { x: approachCenter.x - approachPlayer.x, y: approachCenter.y - approachPlayer.y, z: approachCenter.z - approachPlayer.z } : null;
    const away = movement && awayVector ? movement.x * awayVector.x + movement.y * awayVector.y + movement.z * awayVector.z : -1;
    const status = REDUCED ? valid(calm) && valid(approach) && valid(scatter) && valid(regroup) && freeze ? 'pass' : 'fail' : valid(calm) && valid(approach) && valid(scatter) && valid(regroup) && alarmed(approach) && alarmed(scatter) && speed(scatter) > speed(calm) && away > 0 && settled(regroup) ? 'pass' : 'fail';
    report.checks.push({ name: `fish-response-${quality}`, status, evidence: { calm, approach, scatter, regroup, movement, away }, assertions: REDUCED ? ['school centers/counts remain inspectable', 'centers freeze exactly under reduced motion'] : ['non-empty school centers/counts', 'approach/scatter alarm', 'scatter speed exceeds calm speed', 'school moves away from swimmer', 'regroup alarm clears'] });
  } else report.checks.push({ name: 'fish-response-diagnostics', status: 'fail', reason: 'production world.getStats().underwater exposes no fish diagnostic' });
  const qualityRows = report.views.filter(v => v.name === 'entry-route');
  report.checks.push({ name: 'quality-coverage', status: new Set(qualityRows.map(v => v.quality)).size === (QUALITY === 'both' ? 2 : 1) ? 'pass' : 'fail', evidence: qualityRows.map(v => ({ quality: v.quality, lowQuality: v.stats.underwater?.lowQuality })) });
  report.checks.push({ name: 'browser-errors', status: consoleErrors.length || pageErrors.length || failedRequests.length ? 'fail' : 'pass', consoleErrors, pageErrors, failedRequests });
} catch (error) { report.error = String(error?.stack || error); report.consoleErrors = consoleErrors; report.pageErrors = pageErrors; report.failedRequests = failedRequests; process.exitCode = 1; }
finally { await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`).catch(() => {}); if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {}); }
console.log(JSON.stringify({ out: OUT, presentationOnly: true, views: report.views.length, checks: report.checks, errors: consoleErrors.length + pageErrors.length + failedRequests.length }, null, 2));
if (consoleErrors.length || pageErrors.length || failedRequests.length || report.checks.some(check => check.status === 'fail')) process.exitCode = 1;
