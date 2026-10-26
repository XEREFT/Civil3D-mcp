#!/usr/bin/env node
// Roadway labels for the C-300 Fase 1 sheet (etapa 1.9), derived from the survey + the sheet alignment, never from the guide:
//   * "EXIST R/W"  - arrow on the R/W end of each survey R/W dimension (layer DIM: CL -> R/W line, 25 ft), text pushed out of the street
//   * "EOP"        - arrow on each pavement-edge polyline/line of the survey (layer IMPROVEMENTS, within EDGE_MAX ft of a street CL, >= MIN_LEN ft)
//   * "ALIGNMENT START / END" - STA, offset, street name, N and E of the alignment ends
// The delivered sheets draw these as Civil 3D label objects (AECC_GENERAL_NOTE_LABEL / AECC_STATION_OFFSET_LABEL, which the plugin cannot
// create); here they are MLeaders on C-ANNO in the Formtech-1.0 recipe at 2.0 ft text (9.5 pt on the sheet, like the originals), turned like the
// utility labels so they read horizontally after the viewport twist. fase1-qc / the declutter loop move any that clash. Node 18, no deps.
//
//   node c300-road-labels.mjs --topo X-TOPO_dump.txt --spec spec.json [--standard formtech-c300.json] [--out road-labels.json]
//        [--native] [--no-rw] [--no-eop] [--no-align] [--edge-max 16] [--min-len 20] [--push 14]
// --native: instead of MLeaders emit NATIVE Civil 3D labels as `planLabels` (NoteLabel styles EOP / RW on C-ANNO, StationOffsetLabel styles ALGN START / ALGN END on
// C-ROAD-TEXT with the same override text as the delivered sheets; applied by fase1_build through profileViewApplyAnnotations without a profile view). The styles must
// exist in the template. Native text is sized by the label style, and the text sits at labelLocation (default push 8 ft instead of 14).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] == null ? true : arr[i + 1]]]) : a), []));
const here = path.dirname(fileURLToPath(import.meta.url));
if (!args.topo || !args.spec) { console.error('usage: node c300-road-labels.mjs --topo <X-TOPO dump> --spec <spec.json> [--out f.json]'); process.exit(2); }
const std = JSON.parse(fs.readFileSync(args.standard || path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
const spec = JSON.parse(fs.readFileSync(args.spec, 'utf8'));
const NATIVE = !!args.native;
// Label styles, layers, printed text and placement defaults come from the STANDARD (references/standards/formtech-c300.json roles.planLabels):
// the style/label standard is always the same for every project (user, 2026-10-02) - nothing project-specific is hardcoded here.
const PLR = std.roles.planLabels;
const PLC = PLR.placement;
const EDGE_MAX = Number(args['edge-max'] ?? PLC.edgeMaxFt), MIN_LEN = Number(args['min-len'] ?? PLC.minLenFt), PUSH = Number(args.push ?? (NATIVE ? PLC.pushFt : 14));
const TEXT_H = PLC.textHeightFt;

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]), unit = (a) => mul(a, 1 / (len(a) || 1)), dot = (a, b) => a[0] * b[0] + a[1] * b[1], perp = (d) => [-d[1], d[0]];

// ---- viewport frame (sheet +x in model = frontage direction; 25 x 23 in at 1" = 20') ----
const A = spec.twist.streetAngleDegrees * Math.PI / 180;
const ux = [Math.cos(A), Math.sin(A)], uy = perp(ux);
const ctr = [spec.twist.centerX, spec.twist.centerY];
const [vw, vh] = std.viewport.size, scale = 20;
const inView = (p, m = 0) => { const d = sub(p, ctr); return Math.abs(dot(d, ux)) <= vw * scale / 2 - m && Math.abs(dot(d, uy)) <= vh * scale / 2 - m; };

// ---- survey geometry from the dump ----
const kv = (fields) => Object.fromEntries(fields.filter((f) => f.includes('=')).map((f) => [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)]));
const pt = (s) => (s ? s.replace(/[()]/g, '').trim().split(/\s+/).map(Number).slice(0, 2) : null);
// survey layer roles: from the spec (c300-build-spec.mjs picked the profile, references/standards/survey-profiles.json); older specs = the VILLA ONE / Goulds names
const SP = spec.surveyProfile ?? { centerline: ['CENTER_LINE'], propertyLine: ['PROPERTY_LINE'], rwDimLayers: ['DIM', '_NPLT-TXT'], pavementEdge: ['IMPROVEMENTS', 'EOP'] };
const cls = [], dims = [], edges = [], prop = [], obstacles = [], textBoxes = [];
for (const line of fs.readFileSync(args.topo, 'utf8').split(/\r?\n/)) {
  const f = line.split('|'); if (f[0] !== 'ENT') continue;
  const d = kv(f.slice(4)), layer = f[3], type = f[1], p0 = [Number(d.x), Number(d.y)];
  const verts = type === 'LWPOLYLINE' ? (d.v ?? '').split(';').filter(Boolean).map((s) => s.split(',').map(Number))
    : type === 'LINE' ? [p0, pt(d.p2)] : null;
  if ((type === 'MTEXT' || type === 'TEXT') && Number(d.h) > 0 && !/^\s*$/.test(d.txt ?? '')) {                        // survey text is an obstacle too (centred approximation, in feet)
    const n = String(d.txt).replace(/\\[A-Za-z][^;]*;/g, '').replace(/\\P/g, '\n').split('\n'), hh = Number(d.h);
    const w = Math.max(Number(d.w) || 0, Math.max(...n.map((s) => s.length)) * hh * 0.7);
    const L = Math.min(w, 80), Hh = hh * n.length * 1.15, rot = Number(d.rot) || 0, att = Number(d.att) || 1;
    const dir = [Math.cos(rot), Math.sin(rot)], up = [-dir[1], dir[0]], ax = (att - 1) % 3, ay = Math.floor((att - 1) / 3);
    const c = add(add(p0, mul(dir, L * (0.5 - ax * 0.5))), mul(up, Hh * (ay === 0 ? -0.5 : ay === 2 ? 0.5 : 0)));
    const th = rot - A, cs = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
    textBoxes.push({ c, hw: cs * L / 2 + sn * Hh / 2, hh: sn * L / 2 + cs * Hh / 2 });
  }
  if (verts && [...SP.centerline, ...SP.propertyLine, ...SP.pavementEdge, ...(SP.plLines ?? []), ...(SP.rwLines ?? [])].includes(layer)) obstacles.push(verts);   // linework a label text must not sit on
  if (SP.centerline.includes(layer) && verts) for (let i = 0; i + 1 < verts.length; i++) cls.push([verts[i], verts[i + 1]]);
  else if (SP.rwDimLayers.includes(layer) && type === 'DIMENSION') dims.push({ h: f[2], a: p0, b: pt(d.p2) });       // surveyors use DIM (VILLA ONE), _NPLT-TXT (Goulds 33809) or TEXT/DIMLINE (FormTech)
  else if (SP.propertyLine.includes(layer) && type === 'LINE' && verts) prop.push([verts[0], verts[1]]);
  else if (SP.pavementEdge.includes(layer) && verts && verts.length >= 2) edges.push({ h: f[2], v: verts });      // pavement edges: IMPROVEMENTS (VILLA ONE), EOP (Goulds 33809) or PAVEM (FormTech)
}
const segDist = (p, a, b) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1))); const q = add(a, mul(ab, t)); return { d: len(sub(p, q)), q }; };
const nearCl = (p) => cls.map(([a, b]) => segDist(p, a, b)).sort((x, y) => x.d - y.d)[0] ?? { d: Infinity, q: p };
const polyLen = (v) => v.reduce((s, p, i) => s + (i ? len(sub(p, v[i - 1])) : 0), 0);
const along = (v, frac) => { let want = polyLen(v) * frac; for (let i = 1; i < v.length; i++) { const L = len(sub(v[i], v[i - 1])); if (want <= L) return { p: add(v[i - 1], mul(unit(sub(v[i], v[i - 1])), want)), dir: unit(sub(v[i], v[i - 1])) }; want -= L; } return { p: v.at(-1), dir: unit(sub(v.at(-1), v.at(-2))) }; };

// ---- label recipe ----
const R = std.roles.existingUtilityLeader;
const rot = r4(spec.twist.streetAngleDegrees * Math.PI / 180);
const entities = [];
const planLabels = [], fallback = [];
const mleader = (text, arrow, textPt) => ({
  kind: 'mleader', layer: R.layer, colorIndex: R.colorIndex, mLeaderStyle: R.mLeaderStyle, height: TEXT_H,
  ...(R.annotative ? {} : { scale: R.scale }), rotation: rot, text, leaderX: r4(arrow[0]), leaderY: r4(arrow[1]), x: r4(textPt[0]), y: r4(textPt[1]),
});
const leader = (text, arrow, textPt, native) => {
  // native: the label object goes to planLabels and its MLeader stand-in to `fallback` (same index): fase1_build draws the stand-in only for a label
  // the plugin cannot create (template without the style)
  if (NATIVE && native) { planLabels.push({ ...native, labelLocation: { x: r4(textPt[0]), y: r4(textPt[1]) } }); fallback.push(mleader(text, arrow, textPt)); return; }
  entities.push(mleader(text, arrow, textPt));
};
const note = (def, arrow) => ({ type: def.type, style: def.style, layer: def.layer, anchor: { x: r4(arrow[0]), y: r4(arrow[1]) } });
const counts = { rw: 0, eop: 0, align: 0 };
// EOP / EXIST R/W placement = a tidy grid in SHEET axes (user, 2026-10-25: "aligned vertically and horizontally, never overlapped, professional"):
//   * the leader is strictly vertical (street runs along the sheet x) or strictly horizontal (street runs along sheet y) - never slanted;
//   * the text always sits to the RIGHT of a vertical leader (SIDE_FT), so every label attaches on the same side (no left/right flip);
//   * labels of the same kind on the same side of the street share ONE text line: arrows within SNAP_FT of each other along the push axis get
//     the same text coordinate (mean arrow coordinate +/- PUSH), so a row of "EOP" or "EXIST R/W" reads as a straight row/column.
const SIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, "../references/standards/visual-signature.json"), "utf8")); } catch { return {}; } })();   // the shared visual signature
const SIDE_FT = Number(args.side ?? SIG.leaders?.sideFt ?? PLC.sideFt ?? 1.5), SNAP_FT = Number(args.snap ?? SIG.grid?.snapFt ?? PLC.snapFt ?? 6);
const tidy = [], placed = [];
const TEXT_W = TEXT_H * 0.85;                                      // approx. glyph advance (caps) in feet; boxes are only used to pick a side
const boxesOverlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const segHitsBox = (p, q, b) => {                                   // Liang-Barsky segment vs axis-aligned box (sheet axes)
  let t0 = 0, t1 = 1; const d = [q[0] - p[0], q[1] - p[1]];
  for (const [pk, qk] of [[-d[0], p[0] - b[0]], [d[0], b[2] - p[0]], [-d[1], p[1] - b[1]], [d[1], b[3] - p[1]]]) {
    if (pk === 0) { if (qk < 0) return false; } else { const r = qk / pk; if (pk < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } }
  }
  return true;
};
const sheetOf = (p) => { const d = sub(p, ctr); return [dot(d, ux), dot(d, uy)]; };
const modelOf = (s) => add(ctr, add(mul(ux, s[0]), mul(uy, s[1])));
const placeTidy = () => {
  for (const t of tidy) {
    const so = [dot(t.out, ux), dot(t.out, uy)];
    t.vertical = Math.abs(so[1]) >= Math.abs(so[0]);
    t.sgn = Math.sign(t.vertical ? so[1] : so[0]) || 1;
    t.s = sheetOf(t.arrow);
  }
  const groups = new Map();
  for (const t of tidy) { const k = `${t.kind}|${t.vertical ? 'v' : 'h'}|${t.sgn}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(t); }
  for (const g of groups.values()) {
    const ax = g[0].vertical ? 1 : 0;                                   // coordinate along the push axis (sheet y for vertical leaders)
    g.sort((a, b) => a.s[ax] - b.s[ax]);
    for (let i = 0, j = 0; i < g.length; i = j) {
      for (j = i + 1; j < g.length && g[j].s[ax] - g[i].s[ax] <= SNAP_FT; j++);
      const cl = g.slice(i, j), mean = cl.reduce((m, t) => m + t.s[ax], 0) / cl.length;
      const cost = (bx) => obstacles.reduce((n, v) => n + v.slice(1).filter((p, k) => segHitsBox(sheetOf(v[k]), sheetOf(p), bx)).length, 0)
        + textBoxes.filter((tb) => { const sc = sheetOf(tb.c); return boxesOverlap([sc[0] - tb.hw, sc[1] - tb.hh, sc[0] + tb.hw, sc[1] + tb.hh], bx); }).length * 2;
      // the WHOLE row/column moves together: try the push distances in order and keep the one with the least total cost, so a row never breaks apart
      let bestSet = null;
      for (const push of [PUSH, PUSH * 1.75, PUSH * 2.6]) {
        const line = mean + cl[0].sgn * push, taken = [], set = [];
        let total = 0;
        for (const t of cl) {
          // text box in sheet axes: right of a vertical leader by default; the left side only when the right one would sit on survey linework or text
          const w = TEXT_W * t.text.length, h = TEXT_H * 1.2, box = (x0, y0, x1, y1) => [x0, y0, x1, y1];
          const cands = t.vertical
            ? [{ ts: [t.s[0] + SIDE_FT, line], b: box(t.s[0] + SIDE_FT, line - h / 2, t.s[0] + SIDE_FT + w, line + h / 2) },
               { ts: [t.s[0] - SIDE_FT, line], b: box(t.s[0] - SIDE_FT - w, line - h / 2, t.s[0] - SIDE_FT, line + h / 2) }]
            : t.sgn > 0 ? [{ ts: [line, t.s[1]], b: box(line, t.s[1] - h / 2, line + w, t.s[1] + h / 2) }]
                        : [{ ts: [line, t.s[1]], b: box(line - w, t.s[1] - h / 2, line, t.s[1] + h / 2) }];
          const best = cands.map((c) => ({ ...c, c: cost(c.b) + placed.concat(taken).filter((q) => boxesOverlap(q, c.b)).length * 4 })).sort((p, q) => p.c - q.c)[0];   // stable: the right side wins a tie
          taken.push(best.b); total += best.c; set.push({ t, best });
        }
        if (!bestSet || total < bestSet.total) bestSet = { total, set, taken };
        if (total === 0) break;
      }
      for (const { t, best } of bestSet.set) leader(t.text, t.arrow, modelOf(best.ts), t.native);
      placed.push(...bestSet.taken);
    }
  }
};

// 1) EXIST R/W: the dim end that is NOT on a street CL
if (!args['no-rw']) {
  const seen = [];
  const onProp = (q) => prop.some(([a, b]) => segDist(q, a, b).d <= 0.2);
  for (const dm of dims) {
    if (!inView(dm.a) || !inView(dm.b)) continue;
    if (prop.length && !(onProp(dm.a) || onProp(dm.b))) continue;               // an R/W dim has one end on a PROPERTY_LINE
    const [da, db] = [nearCl(dm.a), nearCl(dm.b)];
    const rw = da.d < db.d ? dm.b : dm.a, cl = da.d < db.d ? dm.a : dm.b;
    if (seen.some((s) => len(sub(s, rw)) < 1)) continue; seen.push(rw);
    const out = unit(sub(rw, cl));
    tidy.push({ kind: 'rw', text: PLR.note.rw.printedText, arrow: rw, out, native: note(PLR.note.rw, rw) });
    counts.rw++;
  }
}

// 2) EOP: pavement-edge pieces of the survey
if (!args['no-eop']) {
  for (const e of edges) {
    const v = e.v, closed = len(sub(v[0], v.at(-1))) < 0.5;
    if (closed || polyLen(v) < MIN_LEN || !v.some((p) => inView(p))) continue;
    if (v.some((p) => nearCl(p).d > EDGE_MAX)) continue;
    const { p, dir } = along(v, 0.4);
    if (!inView(p, 6)) continue;
    const n = perp(dir), cl = nearCl(p);
    const away = unit(dot(n, sub(p, cl.q)) >= 0 ? n : mul(n, -1));
    tidy.push({ kind: 'eop', text: PLR.note.eop.printedText, arrow: p, out: away, native: note(PLR.note.eop, p) });
    counts.eop++;
  }
}

placeTidy();

// 3) ALIGNMENT START / END (station-offset note: STA, OFF, street name, N, E)
if (!args['no-align']) {
  const [s0, e0] = spec.alignment.points.map((q) => [q.x, q.y]);
  const dir = unit(sub(e0, s0)), total = len(sub(e0, s0));
  const name = spec.alignment.name.replace(/\|.*$/, '');
  const sta = (d) => `${Math.floor(d / 100)}+${(d % 100).toFixed(2).padStart(5, '0')}`;
  const text = (title, d, p) => `${title}\\PSTA: ${sta(d)}/OFF: 0.00'\\P(${name})\\PN: ${p[1].toFixed(2)}\\PE: ${p[0].toFixed(2)}`;
  // Civil 3D expressions the delivered sheets use in the station-offset label text (format codes of the label style, not project data)
  const SO = PLR.stationOffset;
  const nativeText = (title) => SO.textTemplate.replace('{title}', title).replace('{street}', name);
  const sol = (def, p) => ({ type: SO.type, style: def.style, layer: SO.layer, alignmentName: spec.alignment.name, markerStyle: SO.markerStyle,
    location: { x: r4(p[0]), y: r4(p[1]) }, overrides: [{ index: 0, text: nativeText(def.title) }] });
  const below = mul(uy, -1);                        // the delivered sheets hang both notes under the alignment; START: the alignment start lies under the cross street's asphalt, so the text point goes 28 ft under the CL (the EOP texts of the street-end edges sit ~14 ft under it) and 13 ft back along -dir; with the landing behind the arrow the MLeader text hangs to the left (backwards), i.e. 41..13 ft before the start = the free pocket the delivered sheets use
  leader(text(PLR.stationOffset.start.title, 0, s0), s0, add(add(s0, mul(below, PLC.startNote.belowFt)), mul(dir, PLC.startNote.alongFt)), sol(SO.start, s0));
  leader(text(PLR.stationOffset.end.title, Math.round(total * 100) / 100, e0), e0, add(add(e0, mul(below, PLC.endNote.belowFt)), mul(dir, PLC.endNote.alongFt)), sol(SO.end, e0));
  counts.align = 2;
}

const out = { createEntities: { entities }, ...(NATIVE ? { planLabels, planLabelsFallback: fallback } : {}), summary: counts };
if (args.out && args.out !== true) fs.writeFileSync(args.out, JSON.stringify(out));
console.log(`road labels: ${counts.rw} EXIST R/W, ${counts.eop} EOP, ${counts.align} alignment ends (${NATIVE ? `${planLabels.length} native Civil 3D labels` : `${entities.length} MLeaders on ${R.layer}, text ${TEXT_H} ft`})`);
