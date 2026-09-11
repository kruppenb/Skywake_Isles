// Print the glTF JSON structure of a GLB: nodes (with parents), meshes, skins, materials, animations.
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
const jsonLen = buf.readUInt32LE(12);
const g = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const parent = new Map();
(g.nodes || []).forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
const acc = i => g.accessors[i];
console.log('asset', JSON.stringify(g.asset), 'extensionsUsed', g.extensionsUsed || [], 'bytes', buf.length);
console.log('scenes', JSON.stringify(g.scenes));
(g.nodes || []).forEach((n, i) => {
  const t = n.translation ? n.translation.map(v => +v.toFixed(4)) : null, s = n.scale ? n.scale.map(v => +v.toFixed(4)) : null, r = n.rotation ? n.rotation.map(v => +v.toFixed(4)) : null;
  console.log(`node ${i} "${n.name}" parent=${parent.has(i) ? parent.get(i) : '-'} mesh=${n.mesh ?? '-'} skin=${n.skin ?? '-'}${t ? ' t=' + JSON.stringify(t) : ''}${r ? ' r=' + JSON.stringify(r) : ''}${s ? ' s=' + JSON.stringify(s) : ''}`);
});
(g.meshes || []).forEach((m, i) => console.log(`mesh ${i} "${m.name}"`, m.primitives.map(p => `mode=${p.mode ?? 4} tris=${acc(p.indices).count / 3} attrs=${Object.keys(p.attributes).join('/')} mat=${p.material}`).join(' | ')));
(g.skins || []).forEach((s, i) => console.log(`skin ${i} joints=${s.joints.length} skeleton=${s.skeleton ?? '-'} names=${s.joints.map(j => g.nodes[j].name).join(',')}`));
(g.materials || []).forEach((m, i) => console.log(`material ${i} "${m.name}" pbr=${JSON.stringify(m.pbrMetallicRoughness)} emissive=${JSON.stringify(m.emissiveFactor)} emissiveTex=${m.emissiveTexture ? 'yes' : 'no'} alphaMode=${m.alphaMode || 'OPAQUE'} doubleSided=${!!m.doubleSided}`));
(g.images || []).forEach((im, i) => console.log(`image ${i} mime=${im.mimeType} bytes=${g.bufferViews[im.bufferView].byteLength}`));
(g.animations || []).forEach((a, i) => {
  let dur = 0; for (const s of a.samplers) dur = Math.max(dur, acc(s.input).max[0]);
  const targets = new Set(a.channels.map(c => g.nodes[c.target.node].name));
  console.log(`animation ${i} "${a.name}" duration=${dur.toFixed(3)}s channels=${a.channels.length} paths=${[...new Set(a.channels.map(c => c.target.path))].join(',')} nodes=${targets.size}`);
});
