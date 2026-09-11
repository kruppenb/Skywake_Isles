// Minimal Meshy REST client for the pirate pipeline. Reads MESHY_API_KEY from env, or falls
// back to the key registered for the Meshy MCP server in ~/.claude.json (never printed).
// node meshy.mjs m2m <front.jpg> <back.jpg> <left.jpg> <right.jpg>   -> multi-image-to-3d task id
// node meshy.mjs get <kind> <id>                                        -> print task json (kind: m2m|rig|anim|remesh|retex)
// node meshy.mjs wait <kind> <id>                                       -> poll until done, print json
// node meshy.mjs download <kind> <id> <dir>                             -> save every result url
// node meshy.mjs rig <m2m-task-id> <height_m>                           -> rigging task id
// node meshy.mjs anim <rig-task-id> <action_id>                         -> animation task id
// node meshy.mjs retexture <input-task-id> <front> [back] [left] [right] -> retexture task id (multiview, original UVs)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function resolveKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  try {
    const config = JSON.parse(await readFile(path.join(os.homedir(), '.claude.json'), 'utf8'));
    const fromMcp = config?.mcpServers?.meshy?.env?.MESHY_API_KEY;
    if (fromMcp) return fromMcp;
  } catch { /* fall through to the error below */ }
  return null;
}
const KEY = await resolveKey();
if (!KEY) { console.error('MESHY_API_KEY not set and no Meshy MCP key found'); process.exit(1); }
const BASE = 'https://api.meshy.ai/openapi';
const PATHS = { m2m: 'v1/multi-image-to-3d', rig: 'v1/rigging', anim: 'v1/animations', remesh: 'v1/remesh', i2d: 'v1/image-to-3d', retex: 'v1/retexture' };
const H = { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

async function api(method, p, body) {
  const res = await fetch(`${BASE}/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}
const dataUri = async f => `data:image/${path.extname(f).slice(1).replace('jpg', 'jpeg')};base64,${(await readFile(f)).toString('base64')}`;

const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'm2m') {
  const image_urls = await Promise.all(a.slice(0, 4).map(dataUri));
  const body = {
    image_urls, ai_model: 'meshy-7', ultra_mode: true,
    should_texture: true, texture_resolution: '2k', enable_pbr: false,
    should_remesh: true, topology: 'triangle', target_polycount: 40000, save_pre_remeshed_model: true,
    pose_mode: 'a-pose', auto_size: true, origin_at: 'bottom',
    target_formats: ['glb', 'fbx'], multi_view_thumbnails: true, image_enhancement: true, remove_lighting: true,
  };
  const r = await api('POST', PATHS.m2m, body);
  console.log(r.result);
} else if (cmd === 'get') {
  console.log(JSON.stringify(await api('GET', `${PATHS[a[0]]}/${a[1]}`), null, 2));
} else if (cmd === 'wait') {
  const [kind, id] = a; let last = '';
  for (;;) {
    const t = await api('GET', `${PATHS[kind]}/${id}`);
    const line = `${t.status} ${t.progress}% queue=${t.preceding_tasks ?? '-'}`;
    if (line !== last) { console.error(new Date().toISOString().slice(11, 19), line); last = line; }
    if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(t.status)) { console.log(JSON.stringify(t, null, 2)); process.exit(t.status === 'SUCCEEDED' ? 0 : 2); }
    await new Promise(r => setTimeout(r, 15000));
  }
} else if (cmd === 'download') {
  const [kind, id, dir] = a; await mkdir(dir, { recursive: true });
  const t = await api('GET', `${PATHS[kind]}/${id}`);
  await writeFile(path.join(dir, 'task.json'), JSON.stringify(t, null, 2));
  const urls = [];
  const walk = (o, pre) => { for (const [k, v] of Object.entries(o || {})) { if (typeof v === 'string' && /^https?:/.test(v)) urls.push([pre ? `${pre}.${k}` : k, v]); else if (v && typeof v === 'object') walk(v, pre ? `${pre}.${k}` : k); } };
  walk({ model_urls: t.model_urls, texture_urls: t.texture_urls, thumbnail_url: t.thumbnail_url, thumbnail_urls: t.thumbnail_urls, result: t.result });
  for (const [name, url] of urls) {
    const ext = (new URL(url).pathname.match(/\.[a-z0-9]+$/i) || [''])[0];
    const file = path.join(dir, name.replace(/[^a-z0-9_.-]+/gi, '_') + ext);
    const res = await fetch(url); if (!res.ok) { console.error('skip', name, res.status); continue; }
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log(path.basename(file));
  }
} else if (cmd === 'rig') {
  const r = await api('POST', PATHS.rig, { input_task_id: a[0], height_meters: Number(a[1] || 1.8) });
  console.log(r.result);
} else if (cmd === 'anim') {
  const r = await api('POST', PATHS.anim, { rig_task_id: a[0], action_id: Number(a[1]) });
  console.log(r.result);
} else if (cmd === 'retexture') {
  // Re-paints the input task's mesh from the concept plates on its existing UV layout
  // (10 credits at 2K). The first image must be the front view.
  const multiview_image_urls = await Promise.all(a.slice(1, 5).map(dataUri));
  const body = {
    input_task_id: a[0], multiview_image_urls, ai_model: 'meshy-7',
    enable_original_uv: true, enable_pbr: false, texture_resolution: '2k', remove_lighting: true,
    target_formats: ['glb'],
  };
  const r = await api('POST', PATHS.retex, body);
  console.log(r.result);
} else if (cmd === 'balance') {
  console.log(JSON.stringify(await api('GET', 'v1/balance')));
} else { console.error('unknown command'); process.exit(1); }
