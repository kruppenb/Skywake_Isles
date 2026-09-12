// Skywake Isles — in-game check of the held gun (join, sail, launch, glide, land, aim, fire).
//
// Joins an isolated server as "Watcher", sets sail, walks to a launch gate and presses E, waits
// out the glide, then screenshots the local navigator idle and mid-recoil, aiming up and down.
// Never point this at port 3400 (production).
//
// Usage:
//   node tools/qa/weapons/game-check.mjs [--kind flintlock] [--origin http://localhost:3401]
//     [--out .qa/weapons/game/]
//
// `--kind` labels the report's fields and picks the held-gun probe's node names to look for. The
// server always starts a fresh player on the flintlock (see server/game.js), so every other kind is
// pressed in: once the pirate is on the ground this sends that kind's slot key (client/input.js
// ACTION_KEYS maps Digit1..Digit5 onto flintlock, scatter, repeater, burst, longshot) and waits for
// a visible `held-<kind>` before it shoots. The starting inventory is flintlock + scatter only and
// `swap` refuses an unowned kind with NOT_OWNED, so `--kind repeater|burst|longshot` needs a server
// that has already given this pirate that gun -- point `--origin` at a fixture that seeds the
// inventory around createGameServer rather than editing gameplay code, or the wait for
// `held-<kind>` just times out.
//
// This script starts NOTHING. Bring the isolated server up first (never port 3400):
//   PowerShell:  $env:PORT=3401; node server/index.js
// then run this script. The lobby is consumed per run: restart the server between runs. Refuses
// to run if <origin>/health is not reachable.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KINDS = ['flintlock', 'scatter', 'repeater', 'burst', 'longshot'];

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(`usage: node tools/qa/weapons/game-check.mjs [--kind <${KINDS.join('|')}>] [--origin <url>] [--out <dir>]`);
  process.exit(1);
}

const KIND = opt('--kind', 'flintlock');
if (!KINDS.includes(KIND)) usage(`unknown --kind ${KIND} (known: ${KINDS.join(', ')})`);
const ORIGIN = opt('--origin', 'http://localhost:3401');
const OUT = path.resolve(process.cwd(), opt('--out', path.join('.qa', 'weapons', 'game')));

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
const shot = async label => { const filePath = path.join(OUT, `${label}.png`); await page.screenshot({ path: filePath }); return filePath; };

await page.goto(`${ORIGIN}/?test=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.SKY, null, { timeout: 30000 });
await page.fill('#pirate-name', 'Watcher');
await page.click('#join-button');
await page.waitForSelector('#launch-button', { state: 'visible', timeout: 30000 });
await wait(800);
await page.click('#launch-button');

// Since the jump gates shipped (89da84b, d888c96) nothing drops the crew automatically: a pirate
// walks onto a launch gate and presses E, and the server decides where they leave from. So this
// walks the deck to the starboard rail gate with ordinary WASD input, presses E, and then waits
// out the glide. The authoritative snapshot is the one that carries `mode`; renderedPlayer is the
// interpolated pose.
const self = () => {
  const state = window.SKY.state(), id = window.SKY.net ? window.SKY.net.id : null;
  return state.players ? state.players.find(entry => entry.id === id) : null;
};
await page.waitForFunction(`(${self.toString()})()?.mode === 'aboard' && window.SKY.state().phase === 'voyage'`,
  null, { timeout: 60000 });
await wait(3000);

const departure = await page.evaluate(`(async () => {
  const self = ${self.toString()};
  // shared/airship.js SHIP_JUMP_POINTS['jump-gate-starboard'], deck coordinates. The ship never
  // yaws, so deck axes are world axes and movePlayer's dx/dz invert to this yaw.
  const GATE = { x: 5.2, z: 5 };
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const trail = [];
  key('keydown', 'KeyW');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const p = self();
    if (!p || p.mode !== 'aboard') break;
    const ux = GATE.x - p.deckX, uz = GATE.z - p.deckZ, distance = Math.hypot(ux, uz);
    trail.push([Math.round(p.deckX * 100) / 100, Math.round(p.deckZ * 100) / 100]);
    if (distance < .7) break;
    window.SKY.input.setView(Math.atan2(-ux / distance, -uz / distance), 0);
    await sleep(120);
  }
  key('keyup', 'KeyW');
  await sleep(500);
  for (let attempt = 0; attempt < 4 && self() && self().mode === 'aboard'; attempt++) {
    key('keydown', 'KeyE'); await sleep(90); key('keyup', 'KeyE');
    await sleep(700);
  }
  const p = self();
  return { deck: p ? [p.deckX, p.deckZ] : null, mode: p ? p.mode : null, steps: trail.length, trail: trail.slice(-4) };
})()`);
console.log(`departure: ${JSON.stringify(departure)}`);

await page.waitForFunction(`(${self.toString()})()?.mode === 'ground'`, null, { timeout: 120000 });
await wait(2500);

// Slot keys. Every pirate spawns holding the flintlock (server/game.js), and client/input.js maps
// Digit1..Digit5 onto the five kinds, so anything but the flintlock has to be equipped -- with an
// ordinary key event, and only if the server says the pirate owns it (see the header) -- before the
// shots are worth taking, and only once the renderer has actually built and shown it. A
// held-<kind> group under a weapon-aim-recoil-rig is a gun in a pirate's hands
// (buildWeapon names ground loot the same way), and this lobby holds no pirate but ours.
const equipped = KIND === 'flintlock' ? null : await (async () => {
  await page.evaluate(async code => {
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    key('keydown', code);
    await new Promise(resolve => setTimeout(resolve, 90));
    key('keyup', code);
  }, `Digit${KINDS.indexOf(KIND) + 1}`);
  await page.waitForFunction(kind => {
    const scene = window.SKY.world && window.SKY.world.scene ? window.SKY.world.scene : null;
    if (!scene) return false;
    let held = false;
    scene.traverse(node => {
      if (node.name !== `held-${kind}` || !node.visible) return;
      for (let at = node.parent; at; at = at.parent) if (at.name === 'weapon-aim-recoil-rig') held = true;
    });
    return held;
  }, KIND, { timeout: 30000 });
  await wait(1200);
  return page.evaluate(`(() => { const p = (${self.toString()})(); return { key: 'Digit${KINDS.indexOf(KIND) + 1}', weapon: p ? p.weapon : null }; })()`);
})();
if (equipped) console.log(`equipped: ${JSON.stringify(equipped)}`);

const landed = await page.evaluate(`(() => { const p = (${self.toString()})();
  return { mode: p.mode, weapon: p.weapon, x: Math.round(p.x), z: Math.round(p.z), hp: p.hp }; })()`);

// The gameplay camera sits behind the pirate, so a level aim hides the gun inside the torso.
// Pitching up swings the gun out beside the head, which is the only angle in play that shows the
// hands on the grip.
const aim = (yaw, pitch) => page.evaluate(([y, p]) => window.SKY.input.setView(y, p), [yaw, pitch]);
const mouse = type => page.evaluate(type => document.getElementById('world')
  .dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, cancelable: true })), type);

await aim(0, .62);
await wait(1400);
const shots = { idle: await shot(`game-01-idle-${KIND}`) };

await mouse('mousedown');
await wait(130);
shots.firing = await shot(`game-02-firing-${KIND}`);
await mouse('mouseup');
await wait(1200);

await aim(0, -.45);
await wait(1400);
shots.aimDown = await shot(`game-03-aim-down-${KIND}`);
await aim(0, 0);
await wait(1000);
shots.level = await shot('game-04-level-over-shoulder');

const heldGun = await page.evaluate(kind => {
  const scene = window.SKY.world && window.SKY.world.scene ? window.SKY.world.scene : null;
  if (!scene) return { error: 'no scene handle on window.SKY.world' };
  let held = null, count = 0;
  scene.traverse(node => { if (node.name === `held-${kind}`) { count++; if (node.visible) held = node; } });
  if (!held) return { error: `no visible held-${kind} in the scene`, count };
  const body = held.children.find(child => child.isMesh);
  return {
    count,
    materialType: body ? body.material.type : null,
    hasMap: !!(body && body.material && body.material.map),
    hingePresent: !!held.getObjectByName(`reload-hinge-${kind}`),
    scale: held.scale.toArray(),
  };
}, KIND);

const errors = consoleLog.filter(entry => entry.type === 'error');
const warnings = consoleLog.filter(entry => entry.type === 'warning' || entry.type === 'warn');
writeFileSync(path.join(OUT, 'game-report.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(), url: `${ORIGIN}/?test=1`, kind: KIND, equipped, landed, heldGun, shots,
  console: { errors: errors.length, warnings: warnings.length, messages: consoleLog }, pageErrors,
}, null, 2)}\n`, 'utf8');

await context.close();
await browser.close();
console.log(`landed: ${JSON.stringify(landed)}`);
console.log(`held gun: ${JSON.stringify(heldGun)}`);
console.log(`console: ${errors.length} error(s), ${warnings.length} warning(s), ${consoleLog.length} message(s)`);
for (const entry of consoleLog) console.log(`  [${entry.type}] ${entry.text}`);
for (const entry of pageErrors) console.log(`  [pageerror] ${entry}`);
for (const [label, filePath] of Object.entries(shots)) console.log(`  ${label} -> ${filePath}`);
