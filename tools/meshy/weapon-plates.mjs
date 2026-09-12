// Generate Meshy-ready concept plates (side / left / top) for a weapon prop with Gemini
// (Nano Banana Pro). `side` is text-only; `left` and `top` pass the side plate back in as an
// inline reference image so the gun stays consistent across views.
// Usage: node weapon-plates.mjs <kind> [--views side,left,top] [--out <dir>] [--model X] [--size 1K|2K]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const KIND = args[0] && !args[0].startsWith('--') ? args[0] : null;
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const VIEWS = opt('--views', 'side,left,top').split(',').map(s => s.trim()).filter(Boolean);
const MODEL = opt('--model', null);
const SIZE = opt('--size', null);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const KEY = process.env.GEMINI_API_KEY;
if (!KEY || !KIND) { console.error('usage: node weapon-plates.mjs <kind> [--views side,left,top] [--out <dir>] [--model X] [--size 1K|2K] (needs GEMINI_API_KEY)'); process.exit(1); }

const prompts = JSON.parse(await readFile(path.join(HERE, 'weapon-prompts.json'), 'utf8'));
const weapon = prompts.weapons[KIND];
if (!weapon) { console.error(`unknown weapon kind: ${KIND} (known: ${Object.keys(prompts.weapons).join(', ')})`); process.exit(1); }

const OUT = path.resolve(REPO_ROOT, opt('--out', path.join('meshy_output', 'plates', KIND)));
const MODEL_NAME = MODEL || prompts.model;
const IMAGE_SIZE = SIZE || prompts.imageSize;
const ASPECT = prompts.aspectRatio;

await mkdir(OUT, { recursive: true });

const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const mimeExt = mime => (mime || 'image/png').split('/')[1].replace('jpeg', 'jpg');

async function readExisting(view) {
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const file = path.join(OUT, `${KIND}-${view}.${ext}`);
    try {
      const data = await readFile(file);
      return { file, data, mimeType: EXT_MIME[ext] };
    } catch {}
  }
  return null;
}

async function callGemini(parts, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: ASPECT, imageSize: IMAGE_SIZE } },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) {
    const msg = `${res.status} ${json.error?.status || ''} ${json.error?.message?.slice(0, 200) || ''}`;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      console.error(`retry ${attempt}: ${msg}`);
      await new Promise(r => setTimeout(r, 8000 * attempt));
      return callGemini(parts, attempt + 1);
    }
    throw new Error(msg);
  }
  return json;
}

async function generate(view, parts) {
  const json = await callGemini(parts);
  let text = '';
  for (const c of json.candidates || []) for (const p of c.content?.parts || []) {
    if (p.inlineData?.data) {
      const ext = mimeExt(p.inlineData.mimeType);
      const file = path.join(OUT, `${KIND}-${view}.${ext}`);
      const data = Buffer.from(p.inlineData.data, 'base64');
      await writeFile(file, data);
      return { file, data, mimeType: p.inlineData.mimeType || 'image/png' };
    }
    if (p.text) text += p.text;
  }
  throw new Error(`[${view}] no image (finishReason ${json.candidates?.[0]?.finishReason}) ${text.slice(0, 200)}`);
}

async function generateSide() {
  const text = `${weapon.description} ${prompts.framing.side}`;
  return generate('side', [{ text }]);
}

async function generateFromSide(view, sidePlate) {
  const text = prompts.framing[view];
  if (!text) throw new Error(`[${view}] no framing text for this view in weapon-prompts.json`);
  const parts = [{ inlineData: { mimeType: sidePlate.mimeType, data: sidePlate.data.toString('base64') } }, { text }];
  return generate(view, parts);
}

const results = [];
let sidePlate = null;

if (VIEWS.includes('side')) {
  try {
    sidePlate = await generateSide();
    results.push({ view: 'side', ok: true, value: sidePlate });
  } catch (err) {
    results.push({ view: 'side', ok: false, error: err });
  }
} else {
  sidePlate = await readExisting('side');
}

const otherViews = VIEWS.filter(v => v !== 'side');
if (otherViews.length) {
  if (!sidePlate) {
    const reason = new Error(`no side plate available in ${OUT} (run with --views side first, or include "side" in --views)`);
    for (const view of otherViews) results.push({ view, ok: false, error: reason });
  } else {
    const settled = await Promise.allSettled(otherViews.map(view => generateFromSide(view, sidePlate)));
    settled.forEach((r, i) => {
      const view = otherViews[i];
      if (r.status === 'fulfilled') results.push({ view, ok: true, value: r.value });
      else results.push({ view, ok: false, error: r.reason });
    });
  }
}

// Report in the order requested, not settlement order.
const order = VIEWS;
results.sort((a, b) => order.indexOf(a.view) - order.indexOf(b.view));

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`[${r.view}] wrote ${r.value.file} (${r.value.data.length} bytes)`);
  else { failed++; console.error(`[${r.view}] FAILED: ${r.error.message}`); }
}
process.exit(failed ? 1 : 0);
