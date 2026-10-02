#!/usr/bin/env node
// Builds everything the C-300 plan sheet needs from the survey, as data:
//   - one acad_create_entities payload (CL extensions, R/W dims, street labels, _cl symbols, property label)
//   - the frontage-street alignment (civil3d_alignment create)
//   - the viewport twist + center (acad_set_viewport_twist)
// Rules and properties come from references/standards/formtech-c300.json; geometry comes from the
// X-TOPO dump (scripts/dwg-dump.ps1). Node 18, no deps.
//
//   node c300-build-spec.mjs --topo X-TOPO_dump.txt --project "<project folder>/project.json" [--standard formtech-c300.json] --out spec.json
//
// --project accepts the project's own project.json (schema 1, scripts/project-state.mjs: subject.* + site.lotPoint [+ site.window])
// directly, or the flat input below (what `project-state.mjs spec <dir>` prints):
// { "name": "VILLA ONE", "address": "227XX SW 118TH AVENUE",
//   "window": [xmin, ymin, xmax, ymax],        // OPTIONAL survey area of THIS site (X-TOPO may hold other sites); when missing it is
//                                              // derived from the dump: the cluster of survey entities around lotPoint (100 ft grid,
//                                              // gaps up to 1 cell) -> printed so it can be saved with project-state.mjs set site.window
//   "lotPoint": [x, y],                        // REQUIRED, inside the lot (PA centroid, pa-lookup.mjs); property label goes here
//   "pa": { "folio": "30-6913-003-0830", "plat": "P.B. 46 PG-94" },   // from pa-lookup.mjs
//   "property": { "units": "ONE (1)", "sf": "5,200", "use": "SINGLE FAMILY RESIDENCE", "gpd": "510" } }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { c300Input } from './project-state.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const here = path.dirname(fileURLToPath(import.meta.url));
const std = JSON.parse(fs.readFileSync(args.standard || path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
if (!args.topo || !args.project) { console.error('usage: --topo dump --project project.json [--standard json] [--out spec.json]'); process.exit(2); }
const rawProject = JSON.parse(fs.readFileSync(args.project, 'utf8'));
// schema-1 project.json (project-state.mjs) -> the flat input this script works on
const project = rawProject.schema || rawProject.subject ? c300Input(rawProject) : rawProject;
const missing = ['address', 'lotPoint'].filter((k) => !project[k])
  .concat(['pa.folio', 'pa.plat', 'property.use', 'property.gpd'].filter((k) => !k.split('.').reduce((o, x) => o?.[x], project)));
if (missing.length) {
  console.error(`project is missing: ${missing.join(', ')} -- set them with node scripts/project-state.mjs set <dir> site.lotPoint=[x,y] ` +
    '(lotPoint = PA centroid: node scripts/pa-lookup.mjs --xy X,Y)');
  process.exit(2);
}

// ---------- geometry helpers ----------
const D2R = Math.PI / 180;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / len(a));
const angDeg = (v) => ((Math.atan2(v[1], v[0]) / D2R) % 360 + 360) % 360;
const dirOf = (deg) => [Math.cos(deg * D2R), Math.sin(deg * D2R)];
const norm180 = (deg) => ((deg % 180) + 180) % 180; // [0,180)
const P = (p) => ({ x: r4(p[0]), y: r4(p[1]) });
const intersect = (p, u, q, v) => { const den = u[0] * v[1] - u[1] * v[0]; const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den; return add(p, mul(u, t)); };

// ---------- parse survey dump ----------
const pt = (s) => { const m = /\(([-\d.e+]+) ([-\d.e+]+)/.exec(s || ''); return m ? [+m[1], +m[2]] : null; };
const allEnts = fs.readFileSync(args.topo, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('ENT|')).map((l) => {
  const i = l.indexOf('|txt=');
  const [, type, handle, layer, ...p] = (i >= 0 ? l.slice(0, i) : l).split('|');
  const o = Object.fromEntries(p.map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
  return { type, handle, layer, ...o, p: [+o.x, +o.y], txt: i >= 0 ? l.slice(i + 5) : '' };
});

// Survey area of THIS site: X-TOPO often carries other jobs (VILLA ONE: another site 4,000 ft west, stray entities at 0,0).
// Without project.window, take the cluster of entities around lotPoint on a 100 ft grid (8-neighbour flood fill that jumps
// gaps of up to 1 empty cell). Validated on VILLA ONE 2026-09-28: same spec as the hand-picked window.
function deriveWindow(points, lotPoint, cell = 100) {
  const key = (cx, cy) => `${cx},${cy}`;
  const cells = new Map();
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || (Math.abs(x) < 1 && Math.abs(y) < 1)) continue;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    cells.set(key(cx, cy), [cx, cy]);
  }
  let start = [Math.floor(lotPoint[0] / cell), Math.floor(lotPoint[1] / cell)];
  if (!cells.has(key(...start))) {
    const near = [...cells.values()].filter(([cx, cy]) => Math.max(Math.abs(cx - start[0]), Math.abs(cy - start[1])) <= 3);
    if (!near.length) return null;
    const d = (c) => Math.hypot(c[0] - start[0], c[1] - start[1]);
    start = near.sort((a, b) => d(a) - d(b))[0];
  }
  const seen = new Set([key(...start)]);
  const queue = [start];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const k = key(cx + dx, cy + dy);
      if (cells.has(k) && !seen.has(k)) { seen.add(k); queue.push(cells.get(k)); }
    }
  }
  const visited = [...seen].map((k) => cells.get(k));
  const xs = visited.map((c) => c[0]), ys = visited.map((c) => c[1]);
  return [Math.min(...xs) * cell, Math.min(...ys) * cell, (Math.max(...xs) + 1) * cell, (Math.max(...ys) + 1) * cell];
}

let win = project.window;
let windowNote = win ? `window (project): [${win.join(', ')}]` : '';
if (!win) {
  win = deriveWindow(allEnts.map((e) => e.p), project.lotPoint);
  if (!win) throw new Error(`no survey entities within 300 ft of lotPoint ${project.lotPoint}: check site.lotPoint (PA centroid) and the X-TOPO dump`);
  windowNote = `window (auto, cluster around lotPoint): [${win.join(', ')}] -- keep it with: node scripts/project-state.mjs set <dir> site.window=[${win.join(',')}]`;
}
const inWin = (p) => p[0] >= win[0] && p[1] >= win[1] && p[0] <= win[2] && p[1] <= win[3];
const ents = allEnts.filter((e) => inWin(e.p));

// Street centerline segments
const segs = ents.filter((e) => e.type === 'LINE' && e.layer === 'CENTER_LINE').map((e) => {
  const a = e.p, b = pt(e.p2);
  return { a, b, deg: norm180(angDeg(sub(b, a))), len: len(sub(b, a)) };
}).filter((s) => s.len > 1);
if (!segs.length) throw new Error('no CENTER_LINE LINE entities in the window');

// Cluster segments into streets: same direction family (±8°) and same line (perpendicular offset < 15 ft)
const streets = [];
for (const s of segs) {
  const u = dirOf(s.deg);
  const nrm = [-u[1], u[0]];
  let st = streets.find((t) => Math.min(Math.abs(t.deg - s.deg), 180 - Math.abs(t.deg - s.deg)) < 8 && Math.abs(dot(sub(s.a, t.origin), t.nrm)) < 15);
  if (!st) { st = { deg: s.deg, origin: s.a, nrm, segs: [] }; streets.push(st); }
  st.segs.push(s);
}
for (const st of streets) {
  const longest = st.segs.reduce((a, b) => (b.len > a.len ? b : a));
  st.deg = longest.deg;
  st.u = dirOf(st.deg);
  st.origin = longest.a;
  const ss = st.segs.flatMap((s) => [s.a, s.b]).map((p) => dot(sub(p, st.origin), st.u));
  st.sMin = Math.min(...ss); st.sMax = Math.max(...ss);
  st.at = (s) => add(st.origin, mul(st.u, s));
  st.sOf = (p) => dot(sub(p, st.origin), st.u);
}

// Name streets from the survey labels (S.W. 118TH AVENUE -> SW 118TH AVENUE)
const labels = ents.filter((e) => (e.type === 'MTEXT' || e.type === 'TEXT') && /S\.?W\.?\s*\d+\w*\s+(STREET|AVENUE|ROAD|COURT|TERRACE|PLACE|DRIVE|LANE)/i.test(e.txt));
for (const st of streets) {
  let best = null;
  for (const l of labels) {
    const rotDeg = norm180((+l.rot || 0) / D2R);
    const parallel = Math.min(Math.abs(rotDeg - st.deg), 180 - Math.abs(rotDeg - st.deg)) < 10;
    const off = Math.abs(dot(sub(l.p, st.origin), [-st.u[1], st.u[0]]));
    if (parallel && off < 30 && (!best || off < best.off)) best = { off, l };
  }
  const raw = best ? best.l.txt.replace(/\{[^;]*;|[{}]|\\[A-Za-z][^;]*;/g, '').trim() : `STREET ${streets.indexOf(st) + 1}`;
  st.name = raw.replace(/S\.W\.\s*/i, 'SW ').replace(/\s+/g, ' ').toUpperCase();
}

// Frontage street = the one named in the project address
const num = (project.address.match(/SW\s+(\d+\w*)/i) || [])[1];
const front = streets.find((s) => num && s.name.includes(num.toUpperCase()));
if (!front) throw new Error(`frontage street for "${project.address}" not found among ${streets.map((s) => s.name).join(', ')}`);
const lot = project.lotPoint;
// Cross streets = the OTHER streets that really cross the frontage near the site. A street running parallel to it (Goulds 33809: SW 124 AVE next to SW 125 AVE) meets it only
// at infinity (the first version put the alignment start 2,231,804,600 ft away and hung Civil 3D), and an intersection hundreds of feet outside the survey window is not a
// street corner of this sheet: skip both.
const angDiff = (a, b) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b));
const cross = streets.filter((s) => s !== front && angDiff(s.deg, front.deg) >= 30).filter((c) => {
  const p = intersect(front.origin, front.u, c.origin, c.u);
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.hypot(p[0] - lot[0], p[1] - lot[1]) <= 700;
});
if (!cross.length) throw new Error(`no cross street within 700 ft of the lot meets ${front.name} at an angle >= 30 deg (streets in the window: ${streets.map((s) => `${s.name} ${s.deg.toFixed(1)} deg`).join(', ')}): the survey window may need site.window / the X-TOPO centerlines may be incomplete`);

// Orient the frontage direction to [0,180) — the convention both reference sheets follow (91.51°, 0.9°)
const theta = norm180(front.deg);
const u = dirOf(theta);
const twistDeg = (360 - theta) % 360;
const crossRot = (theta + 90) % 360; // cross-street text reads bottom-to-top after the twist

for (const c of cross) {
  c.int = intersect(front.origin, front.u, c.origin, c.u);
  c.sFront = dot(sub(c.int, front.origin), u);
}
const sLot = dot(sub(lot, front.origin), u);
cross.sort((a, b) => Math.abs(a.sFront - sLot) - Math.abs(b.sFront - sLot));
const near = cross[0];
const far = cross[cross.length - 1];
const towardLot = Math.sign(sLot - far.sFront) || 1;
const uLot = mul(u, towardLot);

const S = std.roles;
const entities = [];
const report = [];

// 1) Alignment: one tangent from 20 ft past the far intersection, through the lot frontage, to the end of the survey CL
const alStart = add(far.int, mul(uLot, -S.alignment.startBeforeFarIntersectionFt));
const surveyEnd = Math.max(...front.segs.flatMap((s) => [s.a, s.b]).map((p) => dot(sub(p, alStart), uLot)));
const alLen = Math.ceil(surveyEnd / S.alignment.lengthRoundUpToFt) * S.alignment.lengthRoundUpToFt;
const alEnd = add(alStart, mul(uLot, alLen));
const alName = front.name.replace(/AVENUE$/, 'AVE').replace(/STREET$/, 'ST');
report.push(`alignment ${alName}: ${alLen} ft, ${theta.toFixed(4)}°`);

// 2) CL extensions (250 ft from each intersection on cross streets; frontage beyond the alignment start)
const ext = S.streetCenterlineExtension;
const pushCl = (a, b) => entities.push({ kind: 'polyline', layer: ext.layer, colorIndex: ext.colorIndex, linetypeScale: ext.linetypeScale, points: [P(a), P(b)] });
for (const c of cross) {
  for (const sgn of [1, -1]) {
    const has = c.segs.some((s) => [s.a, s.b].some((p) => dot(sub(p, c.int), c.u) * sgn > 5));
    if (has) pushCl(c.int, add(c.int, mul(c.u, sgn * ext.lengthFromIntersectionFt)));
  }
}
pushCl(alStart, add(far.int, mul(uLot, -ext.lengthFromIntersectionFt)));

// 3) R/W dimensions replicated from the survey DIM layer - ON by default since 2026-10-01 (--no-rw-dims to skip).
//    The survey's own dims (X-TOPO|DIM) are frozen by fase1_build (freezeLayers), so copying them no longer stacks two dims:
//    the sheet gets clean C-ANNO dims in the firm style, measured by the surveyor (no package / guide needed).
//    Text reads upright on the twisted sheet: the two points are ordered so the dim direction, seen on the sheet
//    (model angle + twist), points to the right; dimTad 4 + dimTxtDirection as the approved FASE 1 dims (package DSTYLE).
const dim = S.rowDimension;
const sheetAngle = (p, q) => { let a = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI + twistDeg; a = ((a % 360) + 540) % 360 - 180; return a; };
// Which survey dims are R/W dims is decided by GEOMETRY, not by layer name: surveyors put them on DIM (VILLA ONE) or on _NPLT-TXT (Goulds 33809, where DIM holds 1 dim and
// _NPLT-TXT the 12 that matter). A dim counts when it measures > 1 ft, lies on one of those layers and one of its ends sits on a PROPERTY_LINE segment (<= 0.2 ft) of the window;
// duplicates (same two ends, any layer) are dropped. Without any PROPERTY_LINE segment in the window the layer rule alone decides (as before).
const propSegs = ents.filter((x) => x.type === 'LINE' && x.layer === 'PROPERTY_LINE').map((x) => [x.p, pt(x.p2)]).filter(([a, b]) => a && b);
const onSeg = (q, [a, b]) => { const d = sub(b, a), l2 = dot(d, d) || 1, t = Math.max(0, Math.min(1, dot(sub(q, a), d) / l2)); return len(sub(q, add(a, mul(d, t)))) <= 0.2; };
const seenDims = new Set();
const rwDims = ents.filter((x) => {
  if (args['no-rw-dims'] || x.type !== 'DIMENSION' || !(+x.meas > 1) || !['DIM', '_NPLT-TXT'].includes(x.layer)) return false;
  const q1 = x.p, q2 = pt(x.p2); if (!q2) return false;
  if (propSegs.length && !propSegs.some((sg) => onSeg(q1, sg) || onSeg(q2, sg))) return false;
  const key = [q1, q2].map((q) => q.map((v) => v.toFixed(1)).join(',')).sort().join('|');
  if (seenDims.has(key)) return false; seenDims.add(key); return true;
});
for (const e of rwDims) {
  let p1 = e.p, p2 = pt(e.p2);
  if (!p2) continue;
  const s = sheetAngle(p1, p2);
  if (s > 90 || s <= -90) [p1, p2] = [p2, p1];
  entities.push({ kind: 'aligned_dimension', layer: dim.layer, dimStyle: dim.dimStyle, offset: dim.offset, dimTad: dim.dimTad ?? 4, dimTxtDirection: dim.dimTxtDirection ?? true,
    x1: r4(p1[0]), y1: r4(p1[1]), x2: r4(p2[0]), y2: r4(p2[1]) });
}
report.push(`R/W dims from survey: ${entities.filter((e) => e.kind === 'aligned_dimension').length}`);

// 4) Street labels: 90 ft either side of the near intersection (frontage) / of the frontage (cross streets),
//    text centered on the CL (attachment TopCenter shifted half a text height "up")
const sl = S.streetLabel;
const label = (text, onCl, rotDeg) => {
  const up = dirOf(rotDeg + 90);
  const p = add(onCl, mul(up, sl.height / 2));
  entities.push({ kind: 'mtext', layer: sl.layer, textStyle: sl.textStyle, height: sl.height, attachment: sl.attachment, rotation: r4(rotDeg * D2R), text, x: r4(p[0]), y: r4(p[1]),
    ...(sl.backgroundMask ? { backgroundMask: true, backgroundScale: sl.backgroundScale ?? 1.2 } : {}) });
};
for (const sgn of [1, -1]) label(front.name, add(near.int, mul(u, sgn * sl.distanceFromIntersectionFt)), theta);
for (const c of cross) {
  const cu = dirOf(crossRot);
  for (const sgn of [1, -1]) label(c.name, add(c.int, mul(cu, sgn * sl.distanceFromIntersectionFt)), crossRot);
}

// 5) _cl symbols: survey ones copied, plus one 50 ft out on labelled legs that have none
const cl = S.clSymbol;
const surveyCl = ents.filter((e) => e.type === 'INSERT' && e.block === '_cl');
for (const e of surveyCl) entities.push({ kind: 'block', blockName: cl.blockName, layer: cl.layer, scale: cl.scale, rotation: r4(+e.rot), x: r4(e.p[0]), y: r4(e.p[1]) });
const legs = [
  ...[1, -1].map((sgn) => ({ from: near.int, dir: mul(u, sgn), rotDeg: theta })),
  ...cross.flatMap((c) => [1, -1].map((sgn) => ({ from: c.int, dir: mul(dirOf(crossRot), sgn), rotDeg: crossRot }))),
];
for (const leg of legs) {
  const covered = surveyCl.some((e) => { const d = sub(e.p, leg.from); const along = dot(d, leg.dir); return along > 0 && along < 90 && Math.abs(dot(d, [-leg.dir[1], leg.dir[0]])) < 10; });
  if (covered) continue;
  const same = surveyCl.find((e) => Math.min(Math.abs(norm180(+e.rot / D2R) - norm180(leg.rotDeg)), 180 - Math.abs(norm180(+e.rot / D2R) - norm180(leg.rotDeg))) < 5);
  const p = add(leg.from, mul(leg.dir, 50));
  entities.push({ kind: 'block', blockName: cl.blockName, layer: cl.layer, scale: cl.scale, rotation: r4(same ? +same.rot : norm180(leg.rotDeg) * D2R), x: r4(p[0]), y: r4(p[1]) });
}
report.push(`_cl symbols: ${surveyCl.length} copied from survey + ${entities.filter((e) => e.kind === 'block').length - surveyCl.length} added`);

// 6) Subject property label
const pl = S.propertyLabel;
const [book, page] = (project.pa.plat.match(/P\.?B\.?\s*(\d+)\s*PG[-\s]*(\d+)/i) || []).slice(1);
const propText = pl.textFormat
  .replace('{address}', project.address).replace('{folio}', project.pa.folio)
  .replace('{units}', project.property.units).replace('{sf}', project.property.sf)
  .replace('{use}', project.property.use).replace('{gpd}', project.property.gpd)
  .replace('{book}', book).replace('{page}', page);
entities.push({ kind: 'mtext', layer: pl.layer, textStyle: pl.textStyle, height: pl.height, attachment: pl.attachment, width: pl.width, rotation: r4(theta * D2R), text: propText, x: r4(lot[0]), y: r4(lot[1]),
  ...(pl.backgroundMask ? { backgroundMask: true, backgroundScale: pl.backgroundScale ?? 1.2 } : {}) });

// 7) Viewport: center on the frontage CL midway between the far intersection and the lot (+25 ft)
const sFar = dot(sub(far.int, front.origin), u);
const sCenter = (sFar + sLot + 25 * Math.sign(sLot - sFar)) / 2;
const center = add(front.origin, mul(u, sCenter));

const usedLayers = [...new Set(entities.map((e) => e.layer))];
// SANITY GUARD (2026-10-02): a degenerate survey (parallel streets, a single centerline) once produced an alignment 2,231,804,600 ft long and a viewport centered 1e9 ft away, which
// HUNG Civil 3D for minutes when the build tried to draw it. Never hand such a spec on: everything must lie within a few thousand feet of the lot.
{
  const far = [alStart, alEnd].some((q) => !Number.isFinite(q[0]) || !Number.isFinite(q[1]) || Math.hypot(q[0] - lot[0], q[1] - lot[1]) > 3000);
  if (far || alLen > 3000) throw new Error(`absurd geometry: alignment ${alLen.toFixed(0)} ft from ${alStart.map(Math.round)} to ${alEnd.map(Math.round)} (lot ${lot.map(Math.round)}): the survey centerlines of this site are incomplete or ambiguous -- nothing built`);
}
const spec = {
  project: project.name,
  streets: streets.map((s) => ({ name: s.name, angleDeg: r4(s.deg), frontage: s === front })),
  alignment: { name: alName, layer: S.alignment.layer, style: S.alignment.style, labelSet: S.alignment.labelSet, points: [P(alStart), P(alEnd)], lengthFt: alLen },
  twist: { layout: std.viewport.layout, streetAngleDegrees: r4(theta), centerX: r4(center[0]), centerY: r4(center[1]), resultingTwistDeg: r4(twistDeg) },
  createEntities: { layers: Object.fromEntries(usedLayers.map((n) => [n, std.layers[n]])), entities },
  window: win,
  report: [windowNote, ...report],
};
const out = JSON.stringify(spec, null, 1);
if (args.out) fs.writeFileSync(args.out, out);
console.log(args.out ? `${entities.length} entities -> ${args.out}\n${spec.report.join('\n')}\nstreets: ${spec.streets.map((s) => `${s.name}${s.frontage ? ' (frontage)' : ''} ${s.angleDeg}°`).join(' | ')}\ntwist ${spec.twist.resultingTwistDeg}° center ${spec.twist.centerX}, ${spec.twist.centerY}` : out);
