// Generate Meshy-ready front-view concept references for the Skywake navigator
// with Gemini (Nano Banana Pro). Usage: node generate.mjs [--model X] [--size 1K|2K] [--only a,b,c]
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const MODEL = opt('--model', 'gemini-3-pro-image');
const SIZE = opt('--size', '2K');
const ONLY = opt('--only', '').split(',').filter(Boolean);
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

// Shared framing block: everything Meshy image-to-3D and auto-rig want from a reference.
const FRAMING = `Full-body character reference render of one stylized pirate, straight-on front view, standing in a relaxed A-pose: both arms straight and angled about 40 degrees down and away from the body, palms turned toward the thighs, fingers relaxed and slightly apart, feet shoulder-width apart and flat on the ground, weight even, spine upright, looking straight at the camera with a calm neutral expression, mouth closed. Camera at chest height, orthographic-style front view with no perspective distortion, the whole figure from the top of the hat to the boot soles centered with clear margin on all sides. Plain flat light grey studio background, soft even diffuse lighting from the front, no cast shadow on the ground, no rim light, no fog, no vignette. Hand-painted stylized adventure-game character look: chunky readable shapes, slightly exaggerated proportions (broad shoulders, large hands and boots, head a little large), painterly textures with soft gradients and crisp edge highlights, a clean unbroken silhouette. Nothing overlaps the body silhouette: no weapons, no held props, no hanging belt gear, no cape. No text, no labels, no watermark, no background elements, no ground plane.`;

// The uniform is identical across candidates so the crew-accent (coral) parts stay maskable later.
const UNIFORM = `Uniform: knee-length navy blue captain's coat (deep navy #243e51) with wide folded-back cuffs and two rows of brass buttons; the lapel facings, the cuff linings and a broad sash at the waist are coral red (#eb785d). Ivory linen shirt (#fff0d0) with an open collar under the coat, a brown leather belt (#674938) with a plain brass buckle, dark navy trousers tucked into tall brown leather boots with folded-over cuffs. Black tricorn hat with a thin brass edge trim.`;

const CANDIDATES = {
  a: {
    title: 'Captain',
    text: `A male sky-pirate navigator in his mid-thirties, medium build with broad shoulders, weathered tan skin (#e5b08a), short dark beard and moustache, dark hair tied back beneath the hat, faint scar across one eyebrow. ${UNIFORM} ${FRAMING}`,
  },
  b: {
    title: 'Quartermaster',
    text: `A stocky veteran sky-pirate quartermaster in his fifties, barrel chest, thick forearms, sun-reddened weathered skin, heavy brow, thick grey-streaked beard, small gold hoop earring. The tricorn hat is wide-brimmed. ${UNIFORM} ${FRAMING}`,
  },
  c: {
    title: 'Navigator',
    text: `A lean athletic female sky-pirate navigator in her late twenties, warm brown skin, dark hair in thick braids falling behind her shoulders beneath a coral-red headscarf, tricorn hat worn over the scarf, sharp confident eyes, small brass stud earrings. ${UNIFORM} ${FRAMING}`,
  },
};

async function generate(id, spec, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: spec.text }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '3:4', imageSize: SIZE } },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) {
    const msg = `${res.status} ${json.error?.status || ''} ${json.error?.message?.slice(0, 200) || ''}`;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      console.error(`[${id}] retry ${attempt}: ${msg}`);
      await new Promise(r => setTimeout(r, 8000 * attempt));
      return generate(id, spec, attempt + 1);
    }
    throw new Error(`[${id}] ${msg}`);
  }
  let text = '';
  for (const c of json.candidates || []) for (const p of c.content?.parts || []) {
    if (p.inlineData?.data) {
      const ext = (p.inlineData.mimeType || 'image/png').split('/')[1].replace('jpeg', 'jpg');
      const file = path.join(OUT, `navigator-${id}-front.${ext}`);
      await writeFile(file, Buffer.from(p.inlineData.data, 'base64'));
      console.log(`[${id}] wrote ${file} (${p.inlineData.mimeType})`);
      return { file, text };
    }
    if (p.text) text += p.text;
  }
  throw new Error(`[${id}] no image (finishReason ${json.candidates?.[0]?.finishReason}) ${text.slice(0, 200)}`);
}

await mkdir(OUT, { recursive: true });
const ids = ONLY.length ? ONLY : Object.keys(CANDIDATES);
await writeFile(path.join(OUT, 'prompts.json'), JSON.stringify({ model: MODEL, imageSize: SIZE, aspectRatio: '3:4', framing: FRAMING, uniform: UNIFORM, candidates: CANDIDATES }, null, 2));
const results = await Promise.allSettled(ids.map(id => generate(id, CANDIDATES[id])));
let failed = 0;
results.forEach((r, i) => { if (r.status === 'rejected') { failed++; console.error(r.reason.message); } });
process.exit(failed ? 1 : 0);
