// Generate back / left / right plates of a chosen front candidate, using the front render
// as an inline reference image so the outfit stays consistent. Usage: node views.mjs a [--views back,left,right]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const id = args[0];
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const VIEWS = opt('--views', 'back,left,right').split(',');
const MODEL = opt('--model', 'gemini-3-pro-image');
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const KEY = process.env.GEMINI_API_KEY;
if (!KEY || !id) { console.error('need GEMINI_API_KEY and a candidate id'); process.exit(1); }

const prompts = JSON.parse(await readFile(path.join(HERE, 'prompts.json'), 'utf8'));
const frontFile = path.join(HERE, `navigator-${id}-front.jpg`);
const front = (await readFile(frontFile)).toString('base64');

const VIEW_TEXT = {
  back: 'seen from directly behind (a straight-on back view, the camera at chest height behind the character, so the back of the hat, the back of the coat with its centre vent and the boot heels are visible; the face is not visible)',
  left: "seen from the character's left side (a straight-on side profile, the camera at chest height on the character's left, the character facing screen-left; the nose, the near sleeve, the coat skirt and the near boot are in profile)",
  right: "seen from the character's right side (a straight-on side profile, the camera at chest height on the character's right, the character facing screen-right; the nose, the near sleeve, the coat skirt and the near boot are in profile)",
};

async function gen(view, attempt = 1) {
  const text = `The attached image is the front-view reference of one stylized pirate character. Render exactly the same character ${VIEW_TEXT[view]}. Keep everything identical to the reference: the same person, face, hair and beard, the same tricorn hat, coat, coral lapels, cuffs and sash, shirt, belt, trousers and boots, the same colours, the same proportions and the same painterly hand-painted style. Same relaxed A-pose with both arms straight and angled about 40 degrees down away from the body, feet shoulder-width apart and flat, spine upright. Same scale and framing: the whole figure from the top of the hat to the boot soles centered with clear margin, orthographic-style view with no perspective distortion. Same plain flat light grey studio background, soft even diffuse lighting, no cast shadow on the ground, no rim light. No weapons, no props, no text, no labels, no watermark, no background elements.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: front } }, { text }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '3:4', imageSize: '2K' } },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) {
    const msg = `${res.status} ${json.error?.status || ''} ${json.error?.message?.slice(0, 200) || ''}`;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { console.error(`[${view}] retry ${attempt}: ${msg}`); await new Promise(r => setTimeout(r, 8000 * attempt)); return gen(view, attempt + 1); }
    throw new Error(`[${view}] ${msg}`);
  }
  for (const c of json.candidates || []) for (const p of c.content?.parts || []) if (p.inlineData?.data) {
    const ext = (p.inlineData.mimeType || 'image/png').split('/')[1].replace('jpeg', 'jpg');
    const file = path.join(HERE, `navigator-${id}-${view}.${ext}`);
    await writeFile(file, Buffer.from(p.inlineData.data, 'base64'));
    console.log(`[${view}] wrote ${path.basename(file)}`);
    return file;
  }
  throw new Error(`[${view}] no image (finishReason ${json.candidates?.[0]?.finishReason})`);
}

const results = await Promise.allSettled(VIEWS.map(v => gen(v)));
let failed = 0;
for (const r of results) if (r.status === 'rejected') { failed++; console.error(r.reason.message); }
process.exit(failed ? 1 : 0);
