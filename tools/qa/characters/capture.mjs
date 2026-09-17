// Browser acceptance capture for character selection, snapshots, reconnect, and
// the character studio's female mermaid preview.
//
// Usage:
//   node tools/qa/characters/capture.mjs [--origin http://127.0.0.1:3401]
//     [--out .qa/characters]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const ORIGIN = opt('--origin', 'http://127.0.0.1:3401');
const OUT = path.resolve(process.cwd(), opt('--out', path.join('.qa', 'characters')));
const BROWSER = opt('--browser', 'chrome');
if (new URL(ORIGIN).port === '3400') throw new Error('Refusing to run browser QA against production port 3400.');

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_INDEX, 'playwright', 'playwright-core',
    'C:/Users/nicho/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'].filter(Boolean);
  const errors = [];
  for (const candidate of candidates) {
    try { const specifier = path.isAbsolute(candidate) && existsSync(candidate) ? pathToFileURL(candidate).href : candidate; return await import(specifier); }
    catch (error) { errors.push(`${candidate}: ${error.message}`); }
  }
  throw new Error(`Playwright was not found. Set PLAYWRIGHT_INDEX to its index.mjs.\n${errors.join('\n')}`);
}

let health;
try { health = await fetch(`${ORIGIN}/health`); } catch (error) { throw new Error(`Cannot reach ${ORIGIN}/health: ${error.message}`); }
if (!health.ok) throw new Error(`${ORIGIN}/health returned ${health.status}`);
mkdirSync(OUT, { recursive: true });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: BROWSER, headless: true });
const firstContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const secondContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const captain = await firstContext.newPage();
const crewmate = await secondContext.newPage();
const consoleLog = [], pageErrors = [], shots = [];
for (const [label, page] of [['captain', captain], ['crewmate', crewmate]]) {
  page.on('console', message => consoleLog.push({ page: label, type: message.type(), text: message.text() }));
  page.on('pageerror', error => pageErrors.push({ page: label, error: String(error?.stack || error) }));
}
async function shot(page, label) { const output = path.join(OUT, `${label}.png`); await page.screenshot({ path: output, fullPage: true }); shots.push({ label, path: output }); }
async function join(page, name, character) {
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  await page.locator('#pirate-name').fill(name);
  await page.locator(`input[name="character"][value="${character}"]`).check();
  await page.locator('#join-button').click();
  await page.waitForFunction(() => !!window.SKY?.player());
}
async function waitCharacter(page, character) {
  await page.waitForFunction(expected => window.SKY?.player()?.character === expected, character);
  return page.evaluate(() => window.SKY.player());
}

let report;
try {
  await join(captain, 'Pearl', 'female');
  const captainPlayer = await waitCharacter(captain, 'female');
  await shot(captain, '01-female-selected');
  await join(crewmate, 'Deckhand', 'male');
  await crewmate.waitForFunction(id => window.SKY?.state()?.players.find(player => player.id === id && player.character === 'female'), captainPlayer.id);
  const peerPlayer = await crewmate.evaluate(id => window.SKY.state().players.find(player => player.id === id), captainPlayer.id);
  const peerSelf = await crewmate.evaluate(() => window.SKY.player());
  await shot(crewmate, '02-peer-snapshot');

  // A reload uses the reserved session token. The form's default male choice is
  // deliberately different, proving the server keeps the authenticated choice.
  await captain.reload({ waitUntil: 'load' });
  const savedPreference = await captain.locator('input[name="character"][value="female"]').isChecked();
  await captain.locator('#pirate-name').fill('Tampered');
  await captain.locator('input[name="character"][value="male"]').check();
  await captain.locator('#join-button').click();
  const reconnectPlayer = await waitCharacter(captain, 'female');
  await shot(captain, '03-reconnect-preserved');

  const studio = await firstContext.newPage();
  studio.on('console', message => consoleLog.push({ page: 'studio', type: message.type(), text: message.text() }));
  studio.on('pageerror', error => pageErrors.push({ page: 'studio', error: String(error?.stack || error) }));
  await studio.goto(`${ORIGIN}/character-studio.html`, { waitUntil: 'load' });
  await studio.waitForFunction(() => {
    const state = window.characterStudio?.getState?.();
    return state?.ready === true && state.loading === false && !state.error;
  });
  await studio.locator('#character-female').click();
  await studio.waitForFunction(() => window.characterStudio?.getState().character === 'female');
  await studio.locator('[data-preview="mermaid"]').click();
  await studio.waitForFunction(() => window.characterStudio?.getState().preview === 'mermaid');
  await studio.locator('#mode-game').click();
  await studio.waitForFunction(() => {
    const model = window.characterStudio?.refs?.gameModel;
    return window.characterStudio?.getState().gameKind === 'mermaid-navigator'
      && model?.debug?.character === 'female' && !!model.debug.root;
  }, null, { timeout: 15_000 });
  await studio.waitForTimeout(250);
  await shot(studio, '04-studio-female-mermaid');

  // Upgraded weapon bodies replace their procedural materials asynchronously.
  // Exercise all studio surface and character paths after those swaps so a
  // later crew-colour update cannot restore the retired palette material.
  const studioWeaponsReady = async (character, preview, surface = 'textured') => {
    await studio.evaluate(([nextCharacter, nextPreview, nextSurface]) => {
      window.characterStudio.setPreview(nextPreview);
      window.characterStudio.setCharacter(nextCharacter);
      window.characterStudio.setSurface(nextSurface);
    }, [character, preview, surface]);
    await studio.waitForFunction(expected => {
      const api = window.characterStudio, model = api?.refs?.gameModel;
      if (api?.getState().character !== expected.character || api.getState().preview !== expected.preview || model?.character !== expected.character) return false;
      const bodies = Object.values(model?.debug?.weapons || {}).map(weapon => weapon.group.children.find(node => node.isMesh));
      return bodies.length === 5 && bodies.every(body => {
        const base = body?.userData?.studioBaseMaterial || body?.material;
        const textured = body?.geometry?.userData?.shared && base?.userData?.shared && base?.map?.isTexture;
        return textured && (expected.surface === 'clay' ? body.material === api.refs.clayMaterial
          : expected.surface === 'wireframe' ? body.material === api.refs.wireMaterial : body.material === base);
      });
    }, { character, preview, surface }, { timeout: 15_000 });
  };
  const studioWeaponMaterials = async () => studio.evaluate(() => {
    const api = window.characterStudio;
    const bodies = () => Object.values(api.refs.gameModel.debug.weapons).map(weapon => weapon.group.children.find(node => node.isMesh));
    const textured = () => bodies().every(body => body?.geometry?.userData?.shared && body.material?.userData?.shared && body.material?.map?.isTexture);
    for (const crew of ['#429f9a', '#f58faf', '#ffdb70']) {
      api.setCrewColor(crew); api.setSurface('textured');
      if (!textured()) return false;
    }
    api.setSurface('clay'); if (!bodies().every(body => body.material === api.refs.clayMaterial)) return false;
    api.setSurface('wireframe'); if (!bodies().every(body => body.material === api.refs.wireMaterial)) return false;
    api.setSurface('textured'); return textured();
  });
  let studioWeaponMaterialsPass = true;
  for (const [character, preview, surface] of [['female', 'land', 'clay'], ['female', 'mermaid', 'textured'], ['male', 'mermaid', 'textured'], ['male', 'land', 'textured']]) {
    await studioWeaponsReady(character, preview, surface);
    studioWeaponMaterialsPass &&= await studioWeaponMaterials();
  }
  await shot(studio, '05-studio-weapon-materials');
  await studioWeaponsReady('female', 'mermaid');

  report = {
    generatedAt: new Date().toISOString(), origin: ORIGIN, health: await health.json(), shots,
    checks: {
      selectedFemale: captainPlayer.character === 'female',
      peerSawFemale: peerPlayer?.character === 'female',
      peerSelectedMale: peerSelf?.character === 'male',
      localStorageFemalePreference: savedPreference,
      reconnectPreservedFemale: reconnectPlayer.character === 'female',
      studioFemale: await studio.evaluate(() => window.characterStudio.getState().character === 'female'),
      studioMermaid: await studio.evaluate(() => window.characterStudio.getState().preview === 'mermaid'),
      studioGameModel: await studio.evaluate(() => {
        const model = window.characterStudio.refs.gameModel;
        return window.characterStudio.getState().gameKind === 'mermaid-navigator'
          && model?.debug?.character === 'female' && !!model.debug.root;
      }),
      studioWeaponMaterials: studioWeaponMaterialsPass,
    }, console: consoleLog, pageErrors,
  };
  await studio.close();
} finally {
  await firstContext.close().catch(() => {}); await secondContext.close().catch(() => {}); await browser.close().catch(() => {});
}
writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const failed = Object.entries(report.checks).filter(([, value]) => !value);
console.log(`Character capture -> ${OUT}`);
for (const entry of shots) console.log(`  ${entry.label}`);
console.log(`checks: ${failed.length ? `FAILED ${failed.map(([name]) => name).join(', ')}` : 'all passed'}`);
const consoleErrors = consoleLog.filter(entry => entry.type === 'error');
console.log(`console: ${consoleErrors.length} error(s), page errors: ${pageErrors.length}`);
if (failed.length || pageErrors.length || consoleErrors.length) process.exitCode = 1;
