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
import { pickProfile, profileByName } from './lib/survey-profile.mjs';

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

// Survey layer roles (centerline / property line / R/W dims / pavement edge): each surveyor names them differently ->
// references/standards/survey-profiles.json, picked by the layers found in the window (project.json sources.surveyProfile forces one)
// project.json site.centerlines [{a:[x,y], b:[x,y]}] (centerlines-extract.mjs --save): street centerlines kept OUTSIDE the survey. The client's newest X-TOPO often has none
// near the lot (VILLA ONE 09-21, Goulds 08-03: the designer draws CENTER_LINE in the C-300 host instead), which used to force us onto an older, worse X-TOPO.
const siteCl = (rawProject.site?.centerlines ?? []).filter((c) => Array.isArray(c.a) && Array.isArray(c.b)).map((c) => ({ a: c.a.map(Number), b: c.b.map(Number) }));
let SP;
try { SP = pickProfile(ents, rawProject.sources?.surveyProfile); }
catch (e) { if (!siteCl.length) throw e; SP = profileByName('default'); }

// Street centerline segments (survey LINEs + LWPOLYLINE pieces + site.centerlines)
const segOf = (a, b) => ({ a, b, deg: norm180(angDeg(sub(b, a))), len: len(sub(b, a)) });
const polyPts = (v) => (v || '').split(';').filter(Boolean).map((s) => s.split(',').map(Number));
const segs = [
  ...ents.filter((e) => e.type === 'LINE' && SP.centerline.includes(e.layer)).map((e) => segOf(e.p, pt(e.p2))),
  ...ents.filter((e) => e.type === 'LWPOLYLINE' && SP.centerline.includes(e.layer)).flatMap((e) => { const v = polyPts(e.v); return v.slice(1).map((q, i) => segOf(v[i], q)); }),
  ...siteCl.map((c) => segOf(c.a, c.b)),
].filter((s) => s.len > 1);
if (!segs.length) throw new Error(`no ${SP.centerline.join('/')} LINE entities in the window`);

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
    if (parallel && off < 40 && (!best || off < best.off)) best = { off, l };
  }
  // A street the survey leaves unlabelled can be named in project.json sources.streetNames [{ "x", "y", "name" }] (the point must lie within 40 ft of that centerline);
  // the decision and its evidence go to project.json decisions. Survey labels always win.
  const given = best ? null : (rawProject.sources?.streetNames ?? []).find((n) => Math.abs(dot(sub([n.x, n.y], st.origin), [-st.u[1], st.u[0]])) < 40);
  const raw = best ? best.l.txt.replace(/\{[^;]*;|[{}]|\\[A-Za-z][^;]*;/g, '').trim() : given ? given.name : `STREET ${streets.indexOf(st) + 1}`;
  st.name = raw.replace(/S\.W\.\s*/i, 'SW ').replace(/\s+/g, ' ').toUpperCase();
}

// Frontage street = the one named in the project address
const num = (project.address.match(/SW\s+(\d+\w*)/i) || [])[1];
// Several streets can share the number (FormTech topo of SEIDENSTEIN: SW 53RD COURT / PLACE / AVENUE all in one window): the full street name of the
// address wins (suffix abbreviations expanded), the number alone only breaks the tie when exactly one street carries it
const fullName = project.address.toUpperCase().replace(/^[\dX/]+\s+/, '').replace(/\bCT\b\.?/, 'COURT').replace(/\bAVE\b\.?/, 'AVENUE').replace(/\bST\b\.?/, 'STREET').replace(/\bPL\b\.?/, 'PLACE').replace(/\bRD\b\.?/, 'ROAD').replace(/\s+/g, ' ').trim();
const byNum = streets.filter((s) => num && s.name.includes(num.toUpperCase()));
const front = streets.find((s) => s.name === fullName) ?? (byNum.length === 1 ? byNum[0] : byNum.find((s) => fullName.includes(s.name.replace(/^SW\s+/, ''))) ?? byNum[0]);
if (!front) throw new Error(`frontage street for "${project.address}" not found among ${streets.map((s) => s.name).join(', ')}`);
const lot = project.lotPoint;
// Subject label anchor (top-centre of the MTEXT). Default = lotPoint; project.json sources.subjectLabelAt [x,y] moves it when the survey prints its own text there
// (SEIDENSTEIN: the FormTech legal-description MTEXT and "RESIDENCE No. 7421" sit on the PA centroid).
const subjectAt = Array.isArray(rawProject.sources?.subjectLabelAt) && rawProject.sources.subjectLabelAt.length === 2 ? rawProject.sources.subjectLabelAt.map(Number) : lot;
// Cross streets = the OTHER streets that really cross the frontage near the site. A street running parallel to it (Goulds 33809: SW 124 AVE next to SW 125 AVE) meets it only
// at infinity (the first version put the alignment start 2,231,804,600 ft away and hung Civil 3D), and an intersection hundreds of feet outside the survey window is not a
// street corner of this sheet: skip both.
const angDiff = (a, b) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b));
let cross = streets.filter((s) => s !== front && angDiff(s.deg, front.deg) >= 30).filter((c) => {
  const p = intersect(front.origin, front.u, c.origin, c.u);
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.hypot(p[0] - lot[0], p[1] - lot[1]) <= 700;
});
if (!cross.length) throw new Error(`no cross street within 700 ft of the lot meets ${front.name} at an angle >= 30 deg (streets in the window: ${streets.map((s) => `${s.name} ${s.deg.toFixed(1)} deg`).join(', ')}): the survey window may need site.window / the X-TOPO centerlines may be incomplete`);

// Orient the frontage direction to [0,180) — the convention both reference sheets follow (91.51°, 0.9°)
const theta = norm180(front.deg);
const u = dirOf(theta);
// VIEW ANGLE (design audit 2026-10-25): the street that reads horizontal on the sheet. Default = the frontage (VILLA ONE: the main runs along SW 118TH AVE).
// When the POC connection points (project.json site.pocPoints, the existing main/MH the POC names) do not fit the frontage-aligned viewport together with the lot,
// the designer turns the sheet to the street grid instead (Goulds 08-03: twist 359.1 deg, north up, SW 232ND ST horizontal, so SW 231ST ST -> SW 125TH AVE -> SW 232ND ST
// all show). site.viewport {twistDeg, center:[x,y]} forces both.
const vpForce = rawProject.site?.viewport;
const pocPts = (rawProject.site?.pocPoints ?? []).filter((q) => Array.isArray(q) && q.length === 2).map((q) => q.map(Number));
let viewTheta = theta, viewCenterForce = null, viewNote = null;
{
  const VH = std.viewport.size[0] * 20 / 2, VV = std.viewport.size[1] * 20 / 2;
  const fits = (ang, c, pts) => { const a = dirOf(ang), n = [-a[1], a[0]]; return pts.every((q) => Math.abs(dot(sub(q, c), a)) <= VH - 15 && Math.abs(dot(sub(q, c), n)) <= VV - 15); };
  if (vpForce && Number.isFinite(+vpForce.twistDeg)) {
    viewTheta = ((360 - +vpForce.twistDeg) % 360 + 360) % 360;
    if (Array.isArray(vpForce.center)) viewCenterForce = vpForce.center.map(Number);
    viewNote = `viewport forced by project.json site.viewport: twist ${(+vpForce.twistDeg).toFixed(4)} deg`;
  } else if (pocPts.length) {
    const pts = [lot, ...pocPts];
    const bb = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
    const mid = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    // grid street = the window street closest to east-west (Miami-Dade grid), else the frontage turned 90 deg
    const grid = streets.reduce((a, s) => (Math.min(s.deg, 180 - s.deg) < Math.min(a.deg, 180 - a.deg) ? s : a), streets[0]);
    const gridTheta = norm180(grid.deg);
    if (!fits(theta, mid, pts) && fits(gridTheta, mid, pts)) {
      viewTheta = gridTheta; viewCenterForce = mid;
      viewNote = `POC point(s) do not fit the frontage-aligned sheet with the lot: sheet turned to the street grid (${grid.name} horizontal, twist ${((360 - gridTheta) % 360).toFixed(2)} deg), centered on lot + POC`;
    } else if (!fits(theta, mid, pts)) viewNote = 'WARN: the lot and the POC point(s) do not fit one 1"=20\' viewport in any orientation: the sheet keeps the frontage view, POC outside';
  }
}
const twistDeg = (360 - viewTheta) % 360;
// rotation that keeps a text parallel to a street of angle `deg` and readable on the twisted sheet (left-to-right, or bottom-to-top when vertical)
const readable = (deg) => { const s = (((deg + twistDeg) % 360) + 360) % 360; const sheet = s > 90.5 && s <= 270.5 ? s - 180 : s; return (((sheet - twistDeg) % 360) + 360) % 360; };
const crossRot = (theta + 90) % 360; // kept for streets that really are perpendicular; diagonal cross streets use readable(c.deg) (Goulds: labels used to land inside the lots)

for (const c of cross) {
  c.int = intersect(front.origin, front.u, c.origin, c.u);
  c.sFront = dot(sub(c.int, front.origin), u);
}
const sLot = dot(sub(lot, front.origin), u);
cross.sort((a, b) => Math.abs(a.sFront - sLot) - Math.abs(b.sFront - sLot));
const near = cross[0];
// The sheet shows the lot and the cross street at the far end of the block: viewport = std.viewport.size (inches) at 1"=20'. When the block is longer than the viewport
// (FormTech SEIDENSTEIN: cross streets 650 ft apart, lot 436 ft from the far one) the far street + the whole lot lose the fit, so the nearest cross street closes the sheet instead
// (the alignment starts there and the far street stays out of the viewport). Reference sheets (VILLA ONE 200 ft, Goulds 33809) fit: unchanged.
const VIEW_HALF = std.viewport.size[0] * 20 / 2;
let far = cross[cross.length - 1];
const fitsView = (c) => Math.abs(c.sFront - sLot) <= 2 * (VIEW_HALF - 60) + 25;
const farNote = cross.length > 1 && !fitsView(far) ? `far cross street ${far.name} is ${Math.round(Math.abs(far.sFront - sLot))} ft from the lot: does not fit the ${VIEW_HALF * 2} ft viewport with the lot -> sheet closes at ${near.name} (${Math.round(Math.abs(near.sFront - sLot))} ft)` : null;
if (farNote) { cross = cross.filter((c) => fitsView(c)); far = cross[cross.length - 1] ?? near; }
const towardLot = Math.sign(sLot - far.sFront) || 1;
const uLot = mul(u, towardLot);

const S = std.roles;
const entities = [];
const report = [];

// 1) Alignment: one tangent from 20 ft past the far intersection, through the lot frontage, to the end of the survey CL
const alStart = add(far.int, mul(uLot, -S.alignment.startBeforeFarIntersectionFt));
const surveyEnd = Math.max(...front.segs.flatMap((s) => [s.a, s.b]).map((p) => dot(sub(p, alStart), uLot)));
// The alignment ends where the survey CL ends, but never beyond the viewport (a CL that runs on for 800 ft would put the ALIGNMENT END note outside the sheet)
const sCenterPre = (dot(sub(far.int, front.origin), u) + sLot + 25 * Math.sign(sLot - dot(sub(far.int, front.origin), u))) / 2;
const viewEnd = dot(sub(add(front.origin, mul(u, sCenterPre)), alStart), uLot) + VIEW_HALF;
const alReach = surveyEnd > viewEnd + 50 ? viewEnd : surveyEnd;       // 50 ft of slack: the reference sheets end at the viewport edge +- a few ft
const alLen = Math.ceil(alReach / S.alignment.lengthRoundUpToFt) * S.alignment.lengthRoundUpToFt;
const alEnd = add(alStart, mul(uLot, alLen));
const alName = front.name.replace(/AVENUE$/, 'AVE').replace(/STREET$/, 'ST').replace(/COURT$/, 'CT').replace(/PLACE$/, 'PL').replace(/ROAD$/, 'RD');
if (farNote) report.push(farNote);
if (alLen < surveyEnd) report.push(`alignment cut at the viewport end (survey CL runs ${Math.round(surveyEnd)} ft from its start)`);
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
const propSegs = ents.filter((x) => x.type === 'LINE' && SP.propertyLine.includes(x.layer)).map((x) => [x.p, pt(x.p2)]).filter(([a, b]) => a && b);
const onSeg = (q, [a, b]) => { const d = sub(b, a), l2 = dot(d, d) || 1, t = Math.max(0, Math.min(1, dot(sub(q, a), d) / l2)); return len(sub(q, add(a, mul(d, t)))) <= 0.2; };
const vCenter = add(front.origin, mul(u, sCenterPre));
const inSheet = (p, m = 0) => Math.abs(dot(sub(p, vCenter), u)) <= VIEW_HALF + m && Math.abs(dot(sub(p, vCenter), [-u[1], u[0]])) <= std.viewport.size[1] * 20 / 2 + m;
const seenDims = new Set();
const rwDims = ents.filter((x) => {
  if (args['no-rw-dims'] || x.type !== 'DIMENSION' || !(+x.meas > 1) || !SP.rwDimLayers.includes(x.layer)) return false;
  const q1 = x.p, q2 = pt(x.p2); if (!q2) return false;
  if (propSegs.length && !propSegs.some((sg) => onSeg(q1, sg) || onSeg(q2, sg))) return false;
  if (!inSheet(q1, 30) && !inSheet(q2, 30)) return false;               // survey dims of a far corner (outside the viewport) are not copied

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
for (const sgn of [1, -1]) label(front.name, add(near.int, mul(u, sgn * sl.distanceFromIntersectionFt)), readable(theta));
for (const c of cross) {
  // along the cross street's OWN centerline, only on the legs the survey draws (a T intersection has one leg)
  for (const sgn of [1, -1]) {
    if (!c.segs.some((s) => [s.a, s.b].some((p) => dot(sub(p, c.int), c.u) * sgn > 5))) continue;
    label(c.name, add(c.int, mul(c.u, sgn * sl.distanceFromIntersectionFt)), readable(c.deg));
  }
}

// 5) _cl symbols: survey ones copied, plus one 50 ft out on labelled legs that have none
const cl = S.clSymbol;
const surveyCl = ents.filter((e) => e.type === 'INSERT' && e.block === '_cl');
for (const e of surveyCl) entities.push({ kind: 'block', blockName: cl.blockName, layer: cl.layer, scale: cl.scale, rotation: r4(+e.rot), x: r4(e.p[0]), y: r4(e.p[1]) });
const legs = [
  ...[1, -1].map((sgn) => ({ from: near.int, dir: mul(u, sgn), rotDeg: readable(theta) })),
  ...cross.flatMap((c) => [1, -1].filter((sgn) => c.segs.some((s) => [s.a, s.b].some((p) => dot(sub(p, c.int), c.u) * sgn > 5)))
    .map((sgn) => ({ from: c.int, dir: mul(c.u, sgn), rotDeg: readable(c.deg) }))),
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
  // every folio the POC lists (subject.folios, poc-extract.mjs): Goulds = 2 lots, the designer prints both, the BASE used to print one
  .replace('{address}', project.address).replace('{folio}', (rawProject.subject?.folios?.length > 1 ? rawProject.subject.folios.join(', ') : project.pa.folio))
  .replace('{units}', project.property.units).replace('{sf}', project.property.sf)
  .replace('{use}', project.property.use).replace('{gpd}', project.property.gpd)
  .replace('{book}', book).replace('{page}', page);
entities.push({ kind: 'mtext', layer: pl.layer, textStyle: pl.textStyle, height: pl.height, attachment: pl.attachment, width: pl.width, rotation: r4(viewTheta * D2R), text: propText, x: r4(subjectAt[0]), y: r4(subjectAt[1]),
  ...(pl.backgroundMask ? { backgroundMask: true, backgroundScale: pl.backgroundScale ?? 1.2 } : {}) });

// 7) Viewport: center on the frontage CL midway between the far intersection and the lot (+25 ft)
const sFar = dot(sub(far.int, front.origin), u);
const sCenter = (sFar + sLot + 25 * Math.sign(sLot - sFar)) / 2;
const center = viewCenterForce ?? add(front.origin, mul(u, sCenter));
if (viewNote) report.push(viewNote);

// 8) Lot lines for the PL symbols when the profile says the county plat lots cannot give them (survey profile plLines): straight survey lot lines of the window that do not run
//    along an R/W line (the frontage), >= 50 ft, in the viewport -> c300-pl-symbols.mjs --survey-lines
let plSurveyLines;
if (SP.plLines) {
  const rws = ents.filter((x) => x.type === 'LINE' && (SP.rwLines ?? []).includes(x.layer)).map((x) => [x.p, pt(x.p2)]).filter(([a, b]) => a && b);
  const onRw = (a, b) => { const m = mul(add(a, b), 0.5), d = unit(sub(b, a)); return rws.some(([c, e]) => { const w = unit(sub(e, c)); return Math.abs(d[0] * w[1] - d[1] * w[0]) < 0.05 && Math.abs((m[0] - c[0]) * w[1] - (m[1] - c[1]) * w[0]) < 3; }); };
  plSurveyLines = ents.filter((x) => x.type === 'LINE' && SP.plLines.includes(x.layer)).map((x) => [x.p, pt(x.p2)])
    .filter(([a, b]) => a && b && len(sub(b, a)) >= 50 && !onRw(a, b))
    .filter(([a, b]) => inSheet(mul(add(a, b), 0.5)))
    .map(([a, b]) => [[r4(a[0]), r4(a[1])], [r4(b[0]), r4(b[1])]]);
  report.push(`PL lot lines from the survey (${SP.plLines.join('/')}): ${plSurveyLines.length} in the viewport`);
}

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
  twist: { layout: std.viewport.layout, streetAngleDegrees: r4(viewTheta), centerX: r4(center[0]), centerY: r4(center[1]), resultingTwistDeg: r4(twistDeg) },
  createEntities: { layers: Object.fromEntries(usedLayers.map((n) => [n, std.layers[n]])), entities },
  window: win,
  ...(plSurveyLines ? { plSurveyLines } : {}),
  surveyProfile: { name: SP.name, centerline: SP.centerline, propertyLine: SP.propertyLine, rwDimLayers: SP.rwDimLayers, pavementEdge: SP.pavementEdge, freezeXrefLayers: SP.freezeXrefLayers },
  report: [windowNote, `survey profile: ${SP.name} (${SP.label})`, ...report],
};
const out = JSON.stringify(spec, null, 1);
if (args.out) fs.writeFileSync(args.out, out);
console.log(args.out ? `${entities.length} entities -> ${args.out}\n${spec.report.join('\n')}\nstreets: ${spec.streets.map((s) => `${s.name}${s.frontage ? ' (frontage)' : ''} ${s.angleDeg}°`).join(' | ')}\ntwist ${spec.twist.resultingTwistDeg}° center ${spec.twist.centerX}, ${spec.twist.centerY}` : out);
