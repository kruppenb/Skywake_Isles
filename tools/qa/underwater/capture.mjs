// Browser acceptance capture for the real Sunken Reach entry and return flow.
// Start fixture-server.mjs first. This script uses only visible controls and
// read-only SKY diagnostics; it never mutates game state from the page.
//
// Usage:
//   node tools/qa/underwater/capture.mjs [--origin http://127.0.0.1:3401]
//     [--out .qa/underwater]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const ORIGIN = opt('--origin', 'http://127.0.0.1:3401');
const OUT = path.resolve(process.cwd(), opt('--out', path.join('.qa', 'underwater')));
const PAGE_URL = `${ORIGIN}/?test=1`;
const FULL = args.includes('--full');
if (new URL(ORIGIN).port === '3400') throw new Error('Refusing to run browser QA against production port 3400.');

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_INDEX, 'playwright',
    'C:/Users/nicho/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'].filter(Boolean);
  const errors = [];
  for (const candidate of candidates) {
    try {
      const specifier = path.isAbsolute(candidate) && existsSync(candidate) ? pathToFileURL(candidate).href : candidate;
      return await import(specifier);
    } catch (error) { errors.push(`${candidate}: ${error.message}`); }
  }
  throw new Error(`Playwright was not found. Set PLAYWRIGHT_INDEX to its index.mjs.\n${errors.join('\n')}`);
}

let health;
try { health = await fetch(`${ORIGIN}/health`); } catch (error) { throw new Error(`Cannot reach ${ORIGIN}/health: ${error.message}`); }
if (!health.ok) throw new Error(`${ORIGIN}/health returned ${health.status}`);
mkdirSync(OUT, { recursive: true });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const captain = await context.newPage();
const consoleLog = [], pageErrors = [];
function watch(label, page) {
  page.on('console', message => consoleLog.push({ page: label, type: message.type(), text: message.text() }));
  page.on('pageerror', error => pageErrors.push({ page: label, error: String(error?.stack || error) }));
}
watch('captain', captain);
const shots = [];
async function shot(page, label) {
  const output = path.join(OUT, `${label}.png`); await page.screenshot({ path: output, fullPage: true }); shots.push({ label, path: output });
}
async function join(page, name) {
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.locator('#pirate-name').fill(name); await page.locator('#join-button').click();
  await page.waitForFunction(() => !!window.SKY?.player());
}
async function player(page) { return page.evaluate(() => window.SKY.player()); }
async function focusGame(page) {
  await page.bringToFront();
  if (await page.locator('#pause-overlay').isVisible()) await page.locator('#resume-button').click();
  await page.locator('#world').focus();
}
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
async function aimAt(page, target) {
  await focusGame(page);
  for (let pass = 0; pass < 5; pass++) {
    const pose = await page.evaluate(() => ({ player: window.SKY.player(), yaw: window.SKY.input.yaw, pitch: window.SKY.input.pitch }));
    const dx = target.x - pose.player.x, dz = target.z - pose.player.z;
    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.atan2((target.y ?? pose.player.y + 1.25) - (pose.player.y + 1.25), Math.hypot(dx, dz));
    const mouseX = -wrap(targetYaw - pose.yaw) / .0025, mouseY = -(targetPitch - pose.pitch) / .0025;
    if (Math.abs(mouseX) < 2 && Math.abs(mouseY) < 2) break;
    const box = await page.locator('#world').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const scale = Math.min(1, 420 / Math.max(Math.abs(mouseX), Math.abs(mouseY), 1));
    await page.mouse.move(x, y); await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + mouseX * scale, y + mouseY * scale, { steps: 4 }); await page.mouse.up({ button: 'right' });
  }
}
async function swimToward(page, target, stop = 1.5) {
  const current = await player(page), distance = Math.hypot(target.x - current.x, target.z - current.z);
  if (distance <= stop) return;
  await aimAt(page, { ...target, y: current.y + 1.25 });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(Math.max(100, (distance - stop) / 8 * 1000)); await page.keyboard.up('KeyW');
  await page.waitForTimeout(150);
}
async function hold(page, key, milliseconds) {
  await focusGame(page); await page.keyboard.down(key); await page.waitForTimeout(milliseconds); await page.keyboard.up(key); await page.waitForTimeout(150);
}
async function clearReef(page) {
  let stalled = 0, previous = Infinity;
  for (let attempt = 0; attempt < 10; attempt++) {
    const state = await page.evaluate(() => window.SKY.state());
    const enemies = state.enemies.filter(enemy => enemy.realm === 'reef' && enemy.hp > 0);
    if (!enemies.length) return;
    const current = await player(page);
    enemies.sort((a, b) => Math.hypot(a.x - current.x, a.y - current.y, a.z - current.z) - Math.hypot(b.x - current.x, b.y - current.y, b.z - current.z));
    const target = enemies[0]; await aimAt(page, { ...target, y: target.y + target.radius * .8 });
    const box = await page.locator('#world').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'left' }); await page.waitForTimeout(2800); await page.mouse.up({ button: 'left' }); await page.waitForTimeout(300);
    const remaining = await page.evaluate(() => window.SKY.state().underwater.remaining);
    stalled = remaining >= previous ? stalled + 1 : 0; previous = remaining;
    if (stalled >= 1) { await hold(page, 'Space', 900); await swimToward(page, { x: 8, z: 5 }); stalled = 0; }
  }
  throw new Error('Could not clear all reef guards through normal controls.');
}

let report;
try {
await join(captain, 'Deep Current');
await captain.bringToFront();
await captain.waitForFunction(() => !document.querySelector('#launch-button').hidden);
await captain.locator('#launch-button').click();
await captain.waitForFunction(() => window.SKY.state().phase === 'voyage' && window.SKY.player()?.mode === 'ground');
await shot(captain, '01-shore-dive-prompt');

const scout = await context.newPage(); watch('scout', scout);
await join(scout, 'Shore Lantern');
await scout.waitForFunction(() => window.SKY.state().phase === 'voyage' && window.SKY.player()?.mode === 'ground');
await focusGame(captain);
await captain.keyboard.press('KeyE');
await captain.waitForFunction(() => window.SKY.player()?.realm === 'reef' && window.SKY.player()?.mode === 'swimming');
await shot(captain, '02-sunken-reach-objective');

const beforeDive = await player(captain);
await focusGame(captain); await captain.keyboard.down('KeyC'); await captain.waitForTimeout(350); await captain.keyboard.up('KeyC'); await captain.waitForTimeout(150);
const afterDive = await player(captain);
await focusGame(captain); await captain.keyboard.press('KeyM'); await captain.waitForFunction(() => !document.querySelector('#map-overlay').hidden);
await shot(captain, '03-sunken-reach-map');
await captain.keyboard.press('KeyM');
await focusGame(scout); await scout.keyboard.press('KeyM'); await scout.waitForFunction(() => !document.querySelector('#map-overlay').hidden);
await shot(scout, '04-island-map-split-crew');
await scout.keyboard.press('KeyM');

let chestOpened = null;
if (FULL) {
  await clearReef(captain);
  await hold(captain, 'Space', 900); await swimToward(captain, { x: 8, z: -15 });
  let current = await player(captain);
  if (current.y > 2.2) await hold(captain, 'KeyC', Math.min(1800, (current.y - 2) / 8 * 1000));
  await captain.waitForFunction(() => window.SKY.state().underwater.chestOpened, null, { timeout: 10000 });
  chestOpened = true; await shot(captain, '05-wreck-chest-collected');
  await hold(captain, 'Space', 900); await swimToward(captain, { x: -18, z: 20 });
  current = await player(captain);
  if (current.y > 6.2) await hold(captain, 'KeyC', Math.min(1800, (current.y - 6) / 8 * 1000));
}

await focusGame(captain); await captain.keyboard.press('KeyE');
await captain.waitForFunction(() => window.SKY.player()?.realm !== 'reef' && window.SKY.player()?.mode === 'ground');
await shot(captain, FULL ? '06-returned-to-shore' : '05-returned-to-shore');

const finalCaptain = await player(captain), finalScout = await player(scout);
report = {
  generatedAt: new Date().toISOString(), url: PAGE_URL, viewport: { width: 1440, height: 900 },
  health: await health.json(),
  checks: {
    enteredByKeyboard: beforeDive.realm === 'reef' && beforeDive.mode === 'swimming',
    cMovedDown: afterDive.y < beforeDive.y,
    returnedByKeyboard: finalCaptain.realm !== 'reef' && finalCaptain.mode === 'ground',
    secondBrowserStayedAshore: finalScout.realm !== 'reef' && finalScout.mode === 'ground',
    ...(FULL ? { guardsClearedAndChestOpened: chestOpened === true } : {}),
  },
  poses: { beforeDive, afterDive, finalCaptain, finalScout }, shots,
  console: consoleLog, pageErrors,
};
writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} finally {
  await context.close().catch(() => {}); await browser.close().catch(() => {});
}
const failed = Object.entries(report.checks).filter(([, value]) => !value);
console.log(`Sunken Reach capture -> ${OUT}`);
for (const entry of shots) console.log(`  ${entry.label}`);
console.log(`checks: ${failed.length ? `FAILED ${failed.map(([name]) => name).join(', ')}` : 'all passed'}`);
const consoleErrors = consoleLog.filter(entry => entry.type === 'error');
console.log(`console: ${consoleErrors.length} error(s), page errors: ${pageErrors.length}`);
if (failed.length || pageErrors.length || consoleErrors.length) process.exitCode = 1;
