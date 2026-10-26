#!/usr/bin/env node
// Street centerlines (red CENTER_LINE), street-name labels and CL symbols for streets of the C-300 plan that the first build did not cover (user 2026-10-26,
// SEIDENSTEIN: after the sheet was extended south, SW 53RD COURT south of the alignment end and SW 76TH STREET had no red line / name like the north part).
// The build (c300-build-spec.mjs) draws red extensions 250 ft from the near intersection and two names 90 ft either side of it, and the alignment covers the main street;
// this script adds the same style (layer CENTER_LINE, labels MText TextTopoLabel_ep BCC-1.0 3 ft with background mask, `_cl` block scale 30) wherever a street leg has none.
//
//   node c300-street-names.mjs --config streets.json --dump X-TOPO_dump.txt --host host_texts.json [--out payload.json] [--report r.json]
// streets.json = [{ "name": "SW 76TH STREET", "rot": 0.0494,                       // label rotation in radians (CL direction, reads upright on the sheet)
//                   "lines": [[[x,y],[x,y]], ...],                                 // CENTER_LINE polylines to add (model coordinates)
//                   "labels": [[x,y], ...],                                        // wanted label centres ON the centerline (the nearest free spot within --search ft along it is used)
//                   "symbols": [[x,y], ...] }]                                     // `_cl` symbols (placed exactly)
// A label is a 3 ft MText centred on the CL (shifted half a height up, like the build), ~0.85*h*chars long; it must not touch any visible survey text, host label or `_cl` symbol.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
if (!args.config || !args.dump || !args.host) { console.error('usage: node c300-street-names.mjs --config streets.json --dump X-TOPO_dump.txt --host host_texts.json [--out payload.json]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const std = JSON.parse(fs.readFileSync(path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
const SL = std.roles.streetLabel, EXT = std.roles.streetCenterlineExtension, CLS = std.roles.clSymbol;
const SEARCH = Number(args.search ?? 80), STEP = 5, MIN_APART = Number(args['min-apart'] ?? 110);   // labels of one street keep >= MIN_APART ft between centres
const dot = (a, b) => a[0] * b[0] + a[1] * b[1], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]), unit = (a) => mul(a, 1 / len(a)), r4 = (v) => Math.round(v * 1e4) / 1e4;

const rows = fs.readFileSync(args.dump, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('ENT|')).map((l) => {
  const p = l.split('|'), kv = {};
  p.slice(5).forEach((s) => { const i = s.indexOf('='); if (i > 0) kv[s.slice(0, i)] = s.slice(i + 1); });
  return { type: p[1], layer: p[3], x: +kv.x, y: +kv.y, h: +kv.h || 1.6, w: +kv.w, att: +kv.att || 1, rot: +kv.rot || 0, txt: kv.txt ?? '' };
});
const FROZEN = new Set(['ELV', 'TREES', 'INVERTS & MANHOLES', 'HIDE-ANGLE-LABELS', 'HIDE-PAVEMENT-LABELS']);
const clean = (t) => t.replace(/\\[A-Za-z][^;]*;/g, '').replace(/\\P/g, '\n').replace(/[{}]/g, '').trim();
const quad = (o, d, w, h) => { const n = [-d[1], d[0]]; return [o, add(o, mul(d, w)), add(add(o, mul(d, w)), mul(n, h)), add(o, mul(n, h))]; };
const axes = (q) => [0, 1].map((i) => { const e = sub(q[i + 1], q[i]); return unit([-e[1], e[0]]); });
const proj = (q, a) => { const v = q.map((p) => dot(p, a)); return [Math.min(...v), Math.max(...v)]; };
const hit = (a, b, m = 0) => [...axes(a), ...axes(b)].every((ax) => { const [a0, a1] = proj(a, ax), [b0, b1] = proj(b, ax); return a1 + m >= b0 && b1 + m >= a0; });

const obstacles = [];
for (const r of rows) {
  if (FROZEN.has(r.layer) || !(r.type === 'TEXT' || r.type === 'MTEXT')) continue;
  const t = clean(r.txt), ls = t.split('\n'), h = r.h, w = Math.max(...ls.map((s) => s.length)) * 0.85 * h, d = [Math.cos(r.rot), Math.sin(r.rot)];
  if (r.type === 'MTEXT') {
    const ux = [0, .5, 1][(r.att - 1) % 3], vy = [0, .5, 1][Math.floor((r.att - 1) / 3)], H = ls.length * h * 1.4, down = [d[1], -d[0]];
    const tl = sub(sub([r.x, r.y], mul(d, ux * w)), mul(down, vy * H));
    obstacles.push(quad(add(tl, mul(down, H)), d, w, H));
  } else obstacles.push(quad([r.x, r.y], d, w, h));
}
for (const r of rows) if (r.type === 'DIMENSION' && !FROZEN.has(r.layer)) obstacles.push(quad([r.x - 6, r.y - 3], [1, 0], 12, 6));
for (const e of JSON.parse(fs.readFileSync(args.host, 'utf8')).entities ?? []) if (e.minX !== undefined) obstacles.push([[e.minX - 1, e.minY - 1], [e.maxX + 1, e.minY - 1], [e.maxX + 1, e.maxY + 1], [e.minX - 1, e.maxY + 1]]);

const centres = [];
const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
for (const e of JSON.parse(fs.readFileSync(args.host, 'utf8')).entities ?? []) if (e.layer === SL.layer) centres.push({ name: e.text, c: [e.x, e.y] });   // names already on the drawing count for the spacing
const entities = [], report = [];
const placed = [];
for (const st of config) {
  for (const pts of st.lines ?? []) entities.push({ kind: 'polyline', layer: EXT.layer, colorIndex: EXT.colorIndex, linetypeScale: EXT.linetypeScale, points: pts.map((p) => ({ x: r4(p[0]), y: r4(p[1]) })) });
  const d = [Math.cos(st.rot), Math.sin(st.rot)], n = [-d[1], d[0]];
  const w = st.name.length * 0.85 * SL.height + 2;
  for (const want of st.labels ?? []) {
    let best = null;
    for (let k = 0; k <= SEARCH / STEP && !best; k++) for (const sgn of k ? [1, -1] : [1]) {
      const c = add(want, mul(d, sgn * k * STEP));                           // centre on the CL, text runs along d
      const box = quad(add(sub(c, mul(d, w / 2)), mul(n, -SL.height)), d, w, SL.height * 2);
      if (!obstacles.some((ob) => hit(box, ob, Number(args.clear ?? 4))) && !placed.some((q) => hit(box, q, 1)) && !centres.some((q) => q.name === st.name && len(sub(q.c, c)) < MIN_APART)) { best = { c, box, shift: sgn * k * STEP }; break; }
    }
    if (!best) { report.push(`${st.name}: NO free spot within ${SEARCH} ft of ${want.map(r4)}`); continue; }
    placed.push(best.box); centres.push({ name: st.name, c: best.c });
    const p = add(best.c, mul(n, SL.height / 2));                            // build rule: TopCenter attachment shifted half a text height up
    entities.push({ kind: 'mtext', layer: SL.layer, textStyle: SL.textStyle, height: SL.height, attachment: SL.attachment, rotation: r4(st.rot), text: st.name, x: r4(p[0]), y: r4(p[1]),
      ...(SL.backgroundMask ? { backgroundMask: true, backgroundScale: SL.backgroundScale ?? 1.2 } : {}) });
    report.push(`${st.name}: label at ${best.c.map(r4)} (shift ${best.shift} ft from ${want.map(r4)})`);
  }
  for (const s of st.symbols ?? []) { entities.push({ kind: 'block', blockName: CLS.blockName, layer: CLS.layer, scale: CLS.scale, rotation: r4(st.rot), x: r4(s[0]), y: r4(s[1]) }); report.push(`${st.name}: _cl symbol at ${s.map(r4)}`); }
}
console.log(report.join('\n'));
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ entities }));
console.log(`${entities.length} entit(ies)`);
