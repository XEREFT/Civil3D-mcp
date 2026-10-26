#!/usr/bin/env node
// Survey-measured structures -> C-300 labels, for a BASE that has no as-built (Seindestein, design audit 2026-10-26).
// Names: MDWASD legend A.7 + code list (MHSS = Storm Sewer Manhole, MHSA = Sanitary Sewer Manhole, CBA = Catch Basin) and A 10.0 abbreviations (EXIST., MH.).
// The firm recipe for an existing manhole is "EXIST. SAN MH", so a storm one is "EXIST. STORM SEWER MH" ("S.S." is spelled out: it also reads as sanitary sewer).
// The designers (Goulds, Villa One) label every structure the survey measured: "EXIST STORM CB RIM: 9.34 (TO REMAIN)", "EXIST. SAN MH / RIM / INV (E) (W)".
// The FormTech survey prints those values in the frozen layer "INVERTS & MANHOLES" (one MText per structure, paired with a LEADER), so the sheet shows the
// block symbol but no text. This script reads that layer from an X-TOPO dump (dwg-dump.ps1), keeps the structures inside the C-300 frame and emits one
// acad_create_entities payload (same MLeader recipe as c300-utility-labels.mjs: C-ANNO, Formtech-1.0, 1.4 ft, gray, wrapped at 26 characters).
//
//   node c300-survey-structures.mjs --dump X-TOPO_dump.txt --center 893305.18,498171.25 --twist 4.6755 [--half 250,230] [--rotation 1.6077]
//        [--place place.json] [--out payload.json]
// --twist  main viewport twist in radians (DXF 51); sheet right = (cos -T, sin -T), sheet up = left-hand normal of that.
// --place  {"<MText handle>": {"right": ft, "up": ft, "wrap": chars (optional)}} text position relative to the arrow, in SHEET axes (default: 12 ft right, 8 ft up). Hand-placed per project
//          after looking at the PDF: leaders must not cross street names / dims and texts sit in the empty pockets between R/W and the pavement edge.
// --rotation  MLeader text rotation (default (2*pi - twist), text horizontal on the sheet).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
if (!args.dump || !args.center || !args.twist) { console.error('usage: node c300-survey-structures.mjs --dump X-TOPO_dump.txt --center x,y --twist rad [--half hw,hh] [--rotation rad] [--place place.json] [--out payload.json]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const std = JSON.parse(fs.readFileSync(args.standard || path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
const EL = std.roles.existingUtilityLeader;
const WRAP = Number(args.wrap ?? EL.wrapChars ?? 26);
const T = Number(args.twist), rotation = Number(args.rotation ?? ((2 * Math.PI - T) % (2 * Math.PI)));
const [cx, cy] = args.center.split(',').map(Number), [hw, hh] = (args.half ?? '250,230').split(',').map(Number);
const u = [Math.cos(-T), Math.sin(-T)], up = [-u[1], u[0]];
const place = args.place ? JSON.parse(fs.readFileSync(args.place, 'utf8')) : {};
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const inFrame = (p) => { const d = [p[0] - cx, p[1] - cy]; return Math.abs(d[0] * u[0] + d[1] * u[1]) <= hw && Math.abs(d[0] * up[0] + d[1] * up[1]) <= hh; };

const rows = fs.readFileSync(args.dump, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('ENT|')).map((l) => {
  const p = l.split('|'), kv = {};
  p.slice(5).forEach((s) => { const i = s.indexOf('='); if (i > 0) kv[s.slice(0, i)] = s.slice(i + 1); });
  return { type: p[1], h: p[2], layer: p[3], x: +kv.x, y: +kv.y, block: kv.block, txt: kv.txt ?? '' };
});
const clean = (t) => t.replace(/\\P/g, '\n').replace(/\\[CcFfHhQqTtWwAap][^;\\\n]*;/g, '').replace(/\\[LlOoKk]/g, '').replace(/[{}]/g, '');
const blocks = rows.filter((r) => r.type === 'INSERT' && /^(basin|mh|SMH)$/i.test(r.block ?? ''));
const hnum = (h) => parseInt(h, 16);
const wrapText = (text, wrap = WRAP) => text.split('\\P').flatMap((line) => {
  const out = []; let cur = '';
  for (const w of line.split(' ')) { if (cur && (cur + ' ' + w).length > wrap) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  out.push(cur); return out;
}).join('\\P');
const el = (v) => Number(v).toFixed(2);

const used = new Set(), entities = [], summary = [];
for (const t of rows.filter((r) => r.layer === 'INVERTS & MANHOLES' && r.type === 'MTEXT')) {
  const txt = clean(t.txt);
  const kind = /CATCH BASIN/i.test(txt) ? 'CB' : /STORM SEWER MANHOLE/i.test(txt) ? 'STORM MH' : /SANITARY SEWER MANHOLE/i.test(txt) ? 'SAN MH' : null;
  const rim = /RIM ELEV\.=\s*(-?[\d.]+)/i.exec(txt);
  if (!kind || !rim) continue;
  // position = block symbol nearest to the paired LEADER (handle just after the text), else to the text itself
  const ld = rows.find((r) => r.type === 'LEADER' && hnum(r.h) > hnum(t.h) && hnum(r.h) - hnum(t.h) <= 3);
  const ref = ld ? [ld.x, ld.y] : [t.x, t.y];
  const b = blocks.filter((q) => !used.has(q.h)).sort((a, c) => Math.hypot(a.x - ref[0], a.y - ref[1]) - Math.hypot(c.x - ref[0], c.y - ref[1]))[0];
  if (!b || Math.hypot(b.x - ref[0], b.y - ref[1]) > 6) { summary.push(`${t.h}: no block symbol within 6 ft of its leader (skipped)`); continue; }
  used.add(b.h);
  const p = [b.x, b.y];
  if (!inFrame(p)) { summary.push(`${t.h} ${kind} RIM ${rim[1]}: outside the C-300 frame`); continue; }
  const inv = [...txt.matchAll(/\(([NSEW]{1,2})\)\s*INV\. ELEV\.=\s*(\(-\))?\s*([\d.]+)/gi)].map((m) => [m[1].toUpperCase(), (m[2] ? -1 : 1) * Number(m[3])]);
  let text;
  if (kind === 'CB') text = `EXIST. STORM C.B. RIM: ${el(rim[1])}'`;   // MDWASD A 10.0: C.B. = Catch Basin (A.7 symbol: square with a cross-hatched grid)
  else text = `EXIST. ${kind === 'SAN MH' ? 'SAN MH' : 'STORM SEWER MH'}\\PRIM: ${el(rim[1])}'${inv.map(([d, v]) => `\\PINV: ${el(v)}' (${d})`).join('')}${kind === 'SAN MH' ? '\\P(PER SURVEY)' : ''}`;
  const o = place[t.h] ?? { right: 12, up: 8 };
  const tp = [p[0] + u[0] * o.right + up[0] * o.up, p[1] + u[1] * o.right + up[1] * o.up];
  entities.push({
    kind: 'mleader', layer: EL.layer, colorIndex: EL.colorIndex, mLeaderStyle: EL.mLeaderStyle, height: EL.height, ...(EL.annotative ? {} : { scale: EL.scale }),
    rotation: r4(rotation), text: o.wrap ? wrapText(text, o.wrap) : wrapText(text), leaderX: r4(p[0]), leaderY: r4(p[1]), x: r4(tp[0]), y: r4(tp[1]),
  });
  summary.push(`${t.h} ${kind} at ${p.map(r4).join(',')} RIM ${rim[1]} INV ${inv.map(([d, v]) => `${d} ${v}`).join(' ') || '-'}${place[t.h] ? '' : '  (default placement)'}`);
}
console.log(summary.join('\n'));
const out = JSON.stringify({ createEntities: { entities } }, null, 1);
if (args.out) { fs.writeFileSync(args.out, out); console.log(`${entities.length} MLeader(s) -> ${args.out}`); } else console.log(out);
