#!/usr/bin/env node
// MDWASD standards check of an EXISTING (or designed) water/sewer set, from asbuilt.json (same shape for a design) and, optionally, the Property Appraiser
// lot polygons (pa-area.mjs report). Numbers come from references/standards/mdwasd-standards.json (UC-005, GS 0.5, GS 1.5, WS 2.21, UC-250, UC-310).
//   node mdwasd-check.mjs --asbuilt asbuilt.json [--report pa-area.json] [--standards mdwasd-standards.json] [--json out.json]
// Exit 0 always (the findings are WARN/INFO: existing as-built values are never "corrected" from a standard; fase1-qc.py prints them).
// Levels: WARN = the standard is not met / data missing for a required label; INFO = needs the engineer's eye (crossing elevations, easement strip to show).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
if (!args.asbuilt) { console.error('usage: node mdwasd-check.mjs --asbuilt asbuilt.json [--report pa-area.json] [--json out.json]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const S = JSON.parse(fs.readFileSync(args.standards || path.join(here, '../references/standards/mdwasd-standards.json'), 'utf8'));
const ab = JSON.parse(fs.readFileSync(args.asbuilt, 'utf8'));
const report = args.report && fs.existsSync(args.report) ? JSON.parse(fs.readFileSync(args.report, 'utf8')) : null;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]), dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const rows = [];
const seen = new Set();
const add_ = (level, rule, what, detail = '') => { const k = `${level}|${rule}|${what}`; if (!seen.has(k)) { seen.add(k); rows.push({ level, rule, what, detail }); } };

const mh = Object.fromEntries((ab.manholes ?? []).map((m) => [m.id, { ...m, p: [m.x, m.y] }]));
const sewer = (ab.sewerMains ?? []).filter((s) => mh[s.from] && mh[s.to]).map((s) => ({ ...s, a: mh[s.from].p, b: mh[s.to].p }));
const water = (ab.waterMains ?? []).map((w) => ({ ...w }));
const diaIn = (t) => { const m = /(\d+(?:\.\d+)?)\s*(?:"|IN\b|INCH)/i.exec(t ?? ''); return m ? Number(m[1]) : null; };
const MAT = /\b(PVC|DIP|D\.I\.P\.?|DI|VCP|V\.C\.P\.?|HDPE|PE|C-?900|C-?905|CI|C\.I\.|AC|ACP|RCP|CONC(?:RETE)?|STEEL|FRP|COPPER)\b/i;

// ---- segment geometry
function segSeg(p, p2, q, q2) { // min distance between two segments + whether they properly cross
  const d1 = sub(p2, p), d2 = sub(q2, q), den = cross(d1, d2);
  if (Math.abs(den) > 1e-9) {
    const t = cross(sub(q, p), d2) / den, u = cross(sub(q, p), d1) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { dist: 0, crosses: true, at: add(p, mul(d1, t)), angleDeg: (Math.acos(Math.min(1, Math.abs(dot(d1, d2)) / (len(d1) * len(d2)))) * 180) / Math.PI };
  }
  const pd = (x, a, b) => { const ab_ = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(x, a), ab_) / (dot(ab_, ab_) || 1))); return len(sub(x, add(a, mul(ab_, t)))); };
  return { dist: Math.min(pd(p, q, q2), pd(p2, q, q2), pd(q, p, p2), pd(q2, p, p2)), crosses: false };
}

// ---- 1) water <-> sewer horizontal separation / crossings (GS 1.5, F.A.C. 62-555.314)
const sep = S.separation.waterToGravitySewer;
for (const w of water) for (const s of sewer) {
  const r = segSeg(w.a, w.b, s.a, s.b);
  const dW = diaIn(w.text), dS = diaIn(s.text);
  const radii = ((dW ?? 8) + (dS ?? 8)) / 24;           // half of each pipe, ft: centerline distance -> wall-to-wall
  const tag = `${w.text ?? 'WM'} / ${s.from}-${s.to}`;
  if (!r.crosses && r.dist > 60) continue;                // far apart: irrelevant
  if (r.crosses) {
    add_('INFO', 'GS 1.5 crossing', `water main crosses sewer at ${f1(r.at[0])},${f1(r.at[1])} (${f1(r.angleDeg)} deg to each other)`, `needs >= ${S.separation.crossingVerticalMinIn} in vertical (invert of upper to crown of lower), perpendicular if possible; if not, DIP + joints equidistant`);
  } else {
    const wall = r.dist - radii;
    if (wall < sep.horizontalMinFt) add_('WARN', 'GS 1.5 horizontal', `${tag}: ${f1(wall)} ft wall to wall (min ${sep.horizontalMinFt}, preferred ${sep.horizontalPreferredFt})`, 'existing facility: report it, never move the as-built');
    else if (wall < sep.horizontalPreferredFt) add_('INFO', 'GS 1.5 horizontal', `${tag}: ${f1(wall)} ft wall to wall (>= ${sep.horizontalMinFt} min, < ${sep.horizontalPreferredFt} preferred)`, '6 ft is only valid with the water main >= 6 in above the top of the gravity sewer');
  }
}

// ---- 2) manhole spacing (UC-005 C.4)
for (const s of sewer) {
  const L = s.scanLengthFt ?? s.lengthFt ?? len(sub(s.b, s.a));
  if (L > S.sewer.maxManholeSpacingFt) add_('WARN', 'UC-005 C.4', `${s.from} -> ${s.to}: ${f1(L)} ft between manholes (max ${S.sewer.maxManholeSpacingFt})`);
}

// ---- 3) labels: size + material on every existing main (UC-005 A.12), MH data (GS 0.5 4.a/4.c, UC-005 C.3)
for (const s of sewer) if (diaIn(s.text) == null || !MAT.test(s.text ?? '')) add_('WARN', 'UC-005 A.12', `sewer ${s.from}-${s.to}: label lacks ${diaIn(s.text) == null ? 'size' : 'material'}`, s.text ?? '');
for (const w of water) if (diaIn(w.text) == null || !MAT.test(w.text ?? '')) add_('WARN', 'UC-005 A.12', `water main: label lacks ${diaIn(w.text) == null ? 'size' : 'material'} -> generic "${w.text}" (read it from the as-built / ask the user)`, 'only confirmed values: never guess the size');
for (const m of Object.values(mh)) {
  if (m.outsideXUtil) continue;
  if (m.rim == null && !m.rimNA) add_('WARN', 'GS 0.5 4.c', `${m.id}: no RIM and no waiver (N/D) in the review`);
  if (!m.inv?.length) add_('WARN', 'GS 0.5 4.c', `${m.id}: no INV`);
  else if (m.inv.length > 1 && m.inv.some(([d]) => d === 'ND')) add_('WARN', 'GS 0.5 4.c', `${m.id}: several inverts but at least one has no direction (N/S/E/W)`);
}

// ---- 4) cover over gravity sewer (UC-005 C.6/C.7): rim - invert - pipe diameter (needs RIM)
for (const s of sewer) {
  for (const id of [s.from, s.to]) {
    const m = mh[id]; if (!m || m.rim == null || !m.inv?.length) continue;
    const d = (diaIn(s.text) ?? 8) / 12, invMin = Math.min(...m.inv.map(([, v]) => Number(v)));
    const cover = m.rim - invMin - d;
    if (cover < 2.5 && !/\b(DIP|D\.I\.P|DI)\b/i.test(s.text ?? '')) add_('WARN', 'UC-005 C.6/C.7', `${id}: cover ~${f1(cover)} ft over ${s.text ?? 'sewer'} (< 2.5 ft needs DIP + reinforced slab)`, 'rim - invert - diameter, at the manhole');
    else if (cover < 3.5) add_('INFO', 'UC-005 C.7', `${id}: cover ~${f1(cover)} ft (< 3.5 ft under pavement needs DIP or approved C900)`);
  }
}

// ---- 5) hydrant lateral (UC-005 A.28, WS 2.21) and water-service distances are checked only when the as-built gives them
for (const h of ab.hydrants ?? []) {
  const p = [h.x, h.y];
  const dist = water.length ? Math.min(...water.map((w) => { const d = sub(w.b, w.a), t = Math.max(0, Math.min(1, dot(sub(p, w.a), d) / (dot(d, d) || 1))); return len(sub(p, add(w.a, mul(d, t)))); })) : null;
  if (dist != null && dist > S.water.fireHydrantLateral.maxLengthFt) add_('INFO', 'UC-005 A.28', `FH at ${f1(p[0])},${f1(p[1])} is ${f1(dist)} ft from the nearest water main in asbuilt.json (hydrant lateral max ${S.water.fireHydrantLateral.maxLengthFt} ft)`, 'either the lateral is longer than the standard or the main serving it is missing from asbuilt.json: check the scan');
}

// ---- 6) easements: a main inside a Property Appraiser lot (= private property) needs an MDWASD easement (UC-005 A.8, WS 2.21)
const inRing = (p, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const easements = [];
if (report?.lots?.length) {
  const E = S.easements;
  const test = (kind, a, b, label) => {
    const L = len(sub(b, a)), n = Math.max(2, Math.ceil(L / 5));
    let inside = 0, folios = new Set();
    for (let i = 0; i <= n; i++) { const p = add(a, mul(sub(b, a), i / n)); const lot = report.lots.find((l) => l.ring && inRing(p, l.ring)); if (lot) { inside++; folios.add(lot.folio); } }
    const frac = inside / (n + 1);
    if (frac > 0.05) {
      const width = kind === 'water' ? E.waterMainWidthFt : E.sewerMainWidthFt, off = kind === 'water' ? E.waterMainOffsetEachSideFt : E.sewerMainOffsetEachSideFt;
      easements.push({ kind, a, b, widthFt: width, offsetEachSideFt: off, label: E.label[kind], privateFraction: Math.round(frac * 100) / 100, folios: [...folios] });
      add_('INFO', 'UC-005 A.8', `${label}: ${Math.round(frac * 100)}% of it lies on private lots (${[...folios].join(', ')})`, `show "${E.label[kind]}" (${width} ft, ${off} ft each side, dark dashed) or the recorded easement; main centered in it (A.15)`);
    }
  };
  for (const s of sewer) test('sewer', s.a, s.b, `sewer ${s.from}-${s.to}`);
  for (const w of water) test('water', w.a, w.b, 'water main');
  if (!easements.length) add_('OK', 'UC-005 A.8', 'no existing main on private property: no MDWASD easement to show', 'mains are in the public R/W (Miami-Dade Public Works location rules apply)');
} else add_('INFO', 'UC-005 A.8', 'no PA lot polygons (--report): cannot tell if any main is on private property', 'run pa-area.mjs first');

if (!rows.some((r) => r.level === 'WARN')) add_('OK', 'MDWASD', 'no MDWASD check failed');
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ rows, easements }, null, 1));
for (const r of rows) console.log(`${r.level.padEnd(4)} [${r.rule}] ${r.what}${r.detail ? ' -- ' + r.detail : ''}`);
