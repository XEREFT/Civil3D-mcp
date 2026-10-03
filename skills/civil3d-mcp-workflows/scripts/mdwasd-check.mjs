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

// ---- 3b) drop connection (SS 9.0 / UC-310 3.01): an influent whose invert is 2 ft or more above the lowest invert of the manhole needs a drop connection.
// Only inverts with a direction can be told apart (INV list of the manhole); a 2 ft+ spread is an INFO for the engineer (the as-built may already show the drop).
for (const m of Object.values(mh)) {
  const vs = (m.inv ?? []).map(([, v]) => Number(v)).filter(Number.isFinite);
  if (vs.length > 1 && Math.max(...vs) - Math.min(...vs) >= 2) add_('INFO', 'SS 9.0', `${m.id}: inverts differ by ${f1(Math.max(...vs) - Math.min(...vs))} ft (>= 2 ft): a drop connection is required (SS 9.0)`, 'check that the as-built shows the drop (cast-in-place, >= 3 ft)');
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

// ---- 5b) as-built water fittings beyond the X-UTIL WAT lines (asbuilt-build.mjs -> waterFittingsOffXUtil): the main continues in the as-built but not in the survey
const offX = ab.waterFittingsOffXUtil ?? [];
if (offX.length) {
  const far = Math.max(...offX.map((f) => f.distFt));
  add_('INFO', 'UC-005 B.6', `${offX.length} as-built water fitting(s) (${[...new Set(offX.map((f) => f.kind))].join(", ")}) lie up to ${f1(far)} ft beyond the X-UTIL WAT lines`, 'the as-built main continues past the end of the survey line: nothing is drawn or moved (survey is the base); tell the user, who decides whether the X-UTIL gap is reported or the main is drawn from the printed N/E');
}

// ---- 5a) sewer laterals (SS 1.0 / UC-310): 6 in minimum, slope >= 1/8 in per ft, when the as-built prints them
for (const a of ab.appurtenances ?? []) {
  if (a.ref !== 'sewer' || !/LAT/i.test(a.label ?? '')) continue;
  const sz = diaIn(a.label), sl = /SLOPE\s+(\d+)\s*\/\s*(\d+)\s*"?\s*\/\s*FT/i.exec(a.detail ?? '');
  if (sz != null && sz < S.sewer.lateralMinSizeIn) add_('WARN', 'SS 1.0', `sewer lateral ${a.stationText ?? ''}: ${sz} in (min ${S.sewer.lateralMinSizeIn} in)`);
  if (sl && Number(sl[1]) / Number(sl[2]) < S.sewer.lateralMinSlopeInPerFt) add_('WARN', 'SS 1.0', `sewer lateral ${a.stationText ?? ''}: slope ${sl[1]}/${sl[2]} in per ft (min 1/8)`);
}

// ---- 5b) water valve spacing (UC-005 B.6: resilient-seat gate valves every 660 ft). Valves = water appurtenances whose label says G.V./gate/butterfly valve and that have
// coordinates; they are snapped to the water mains (<= 15 ft), the mains form a graph, and the pipe distance between ADJACENT valves (no other valve between them on the
// shortest path) must be <= 660 ft. Only valve-to-valve gaps are judged: the as-built window ends where the scan ends, so a main end with no valve is only an INFO.
{
  const maxFt = S.water.valveSpacingFt, VALVE = /\b(G\.?V\.?|GATE\s+VALVE|B\.?F\.?V\.?|BUTTERFLY|PLUG\s+VALVE)\b/i;
  const valves = (ab.appurtenances ?? []).filter((a) => a.ref === 'water' && VALVE.test(a.label ?? '') && Number.isFinite(a.x) && Number.isFinite(a.y) && !/TAPPING/i.test(a.label));
  const nodes = [], idOf = (q) => { let i = nodes.findIndex((n) => len(sub(n, q)) < 1); if (i < 0) { nodes.push(q); i = nodes.length - 1; } return i; };
  const edges = [];                                       // [i, j, length]; valve nodes are inserted into the segment they sit on
  const wsegs = water.map((w) => ({ a: w.a, b: w.b, pts: [] }));
  const vnode = [];
  for (const [vi, v] of valves.entries()) {
    const p = [v.x, v.y]; let best = null;
    wsegs.forEach((w, wi) => { const d = sub(w.b, w.a), t = Math.max(0, Math.min(1, dot(sub(p, w.a), d) / (dot(d, d) || 1))); const dist = len(sub(p, add(w.a, mul(d, t)))); if (!best || dist < best.dist) best = { wi, t, dist }; });
    if (best && best.dist <= 15) { wsegs[best.wi].pts.push({ t: best.t, vi }); vnode[vi] = null; } else add_('INFO', 'UC-005 B.6', `valve "${v.label}" ${v.stationText ?? ''} is ${best ? f1(best.dist) : '?'} ft from any water main in asbuilt.json: not used for the spacing check`);
  }
  const vId = {};
  for (const w of wsegs) {
    const L = len(sub(w.b, w.a)); const seq = [{ t: 0, n: idOf(w.a) }, ...w.pts.sort((p, q) => p.t - q.t).map((q) => { const id = nodes.length; nodes.push(add(w.a, mul(sub(w.b, w.a), q.t))); vId[q.vi] = id; return { t: q.t, n: id }; }), { t: 1, n: idOf(w.b) }];
    for (let i = 0; i + 1 < seq.length; i++) edges.push([seq[i].n, seq[i + 1].n, (seq[i + 1].t - seq[i].t) * L]);
  }
  const inGraph = Object.keys(vId).map(Number);
  if (inGraph.length >= 2) {
    const dist = (src) => { const D = new Array(nodes.length).fill(Infinity); D[src] = 0; for (let k = 0; k < nodes.length; k++) for (const [i, j, l] of edges) { if (D[i] + l < D[j]) D[j] = D[i] + l; if (D[j] + l < D[i]) D[i] = D[j] + l; } return D; };
    const DD = Object.fromEntries(inGraph.map((vi) => [vi, dist(vId[vi])]));
    const lab = (vi) => `${valves[vi].label}${valves[vi].stationText ? ' ' + valves[vi].stationText : ''}`;
    for (const a of inGraph) for (const b of inGraph) {
      if (b <= a) continue;
      const d = DD[a][vId[b]]; if (!Number.isFinite(d)) continue;
      const between = inGraph.some((c) => c !== a && c !== b && Math.abs(DD[a][vId[c]] + DD[c][vId[b]] - d) < 1);
      if (!between && d > maxFt) add_('WARN', 'UC-005 B.6', `valves ${lab(a)} and ${lab(b)} are ${f1(d)} ft apart along the main (max ${maxFt} ft)`, 'existing: report it; a design must add a valve');
    }
    if (!rows.some((r) => r.rule === 'UC-005 B.6' && r.level === 'WARN')) add_('OK', 'UC-005 B.6', `${inGraph.length} water valves located: adjacent valves are <= ${maxFt} ft apart`);
  } else {
    const total = water.reduce((n, w) => n + len(sub(w.b, w.a)), 0);
    add_('INFO', 'UC-005 B.6', `${inGraph.length} located water valve(s) on ${f1(total)} ft of water main in asbuilt.json: valve spacing (${maxFt} ft) cannot be judged`, total > maxFt ? 'main longer than 660 ft with < 2 valves located: check the scan for valves outside the window / missing symbols' : 'window shorter than the spacing: nothing to judge');
  }
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
