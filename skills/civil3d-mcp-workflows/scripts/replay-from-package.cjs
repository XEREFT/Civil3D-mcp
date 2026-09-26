#!/usr/bin/env node
// Rebuild a drawing's annotation the way the engineer's package draws it (package = base file).
// Inputs are mleader-dump.lsp outputs (Core Console) of the package and of the target drawing.
//
//   node replay-from-package.cjs --pkg pkg/full.txt --pkgdump PKG-C-300_dump.txt --target cr/full.txt
//        [--add payload.json ...]   entities appended as-is (e.g. package R/W dims, utility MLeaders, street labels)
//        [--drop payload.json]      target dims at these coordinates are dropped (e.g. dims copied from the survey)
//        [--skip-ml "EXIST ,EXIST. "] target MLeaders whose text starts with these prefixes are dropped
//                                     (they come back through --add)
//        [--plan-y 444000]          unmatched dims above this Y get the plan convention DIMTAD 4 + DIMTXTDIRECTION
//        --out replay.json
// Output: { deleteHandles: {dims, mleaders}, payload: {space, entities} }.
//  - dims: each kept target dim takes the DSTYLE overrides of the package dim at the same points (<=0.05 ft);
//  - MLeaders: matched by text to the package; geometry (arrow = first leader vertex, text location, width,
//    height, attachment side via dogleg) and color/style from the package. Unmatched ones keep their own
//    text location and first vertex.
const fs = require('fs');
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].slice(2);
  (args[k] = args[k] || []).push(process.argv[i + 1]);
}
const one = (k, d) => (args[k] ? args[k][0] : d);
const parse = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
  const parts = l.split('|');
  const rec = { kind: parts[0], handle: parts[1] };
  for (const p of parts.slice(2)) { const k = p.indexOf('='); if (k > 0) rec[p.slice(0, k)] = p.slice(k + 1); }
  return rec;
});
const xy = (s) => s.split(',').map(Number);
const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

const pkg = parse(one('pkg'));
const tgt = parse(one('target'));
const pkgDump = fs.readFileSync(one('pkgdump'), 'utf8').split(/\r?\n/);
const pkgProps = (h) => {
  const l = pkgDump.find((x) => x.startsWith('ENT|MULTILEADER|' + h + '|')) || '';
  const g = (k) => (l.match(new RegExp('\\|' + k + '=([^|]*)')) || [])[1];
  return { layer: l.split('|')[3], color: g('c') ? Number(g('c')) : undefined, style: g('style') };
};
const overrides = (xd) => {
  const o = {};
  if (!xd || xd === 'nil') return o;
  const codes = [...xd.matchAll(/\(1070 \. (-?\d+)\)/g)].map((m) => Number(m[1]));
  for (let i = 0; i + 1 < codes.length; i += 2) {
    if (codes[i] === 77) o.dimTad = codes[i + 1];
    if (codes[i] === 294) o.dimTxtDirection = codes[i + 1] === 1;
  }
  return o;
};

const dropDims = (args.drop || []).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).entities.filter((e) => e.kind === 'aligned_dimension'));
const planY = Number(one('plan-y', 'NaN'));
const skipPrefixes = (one('skip-ml', '') || '').split(',').filter(Boolean);
const entities = [];
const del = { dims: [], mleaders: [] };
const report = [];

for (const d of tgt.filter((r) => r.kind === 'DIM')) {
  del.dims.push(d.handle);
  const p13 = xy(d.p13), p14 = xy(d.p14), p10 = xy(d.p10);
  if (dropDims.some((e) => near([e.x1, e.y1], p13, 0.05) && near([e.x2, e.y2], p14, 0.05))) { report.push(`dim ${d.handle} dropped`); continue; }
  const m = pkg.find((r) => r.kind === 'DIM' && near(xy(r.p13), p13, 0.05) && near(xy(r.p14), p14, 0.05));
  let ovr = m ? overrides(m.xd) : {};
  if (!m && p13[1] > planY) ovr = { dimTad: 4, dimTxtDirection: true };
  const e = { kind: 'aligned_dimension', layer: d.layer, dimStyle: d.style, x1: p13[0], y1: p13[1], x2: p14[0], y2: p14[1], dimLineX: p10[0], dimLineY: p10[1], ...ovr };
  if (d.txt) e.textOverride = d.txt;
  entities.push(e);
  report.push(`dim ${d.handle} ${m ? 'pkg ' + m.handle : 'own'} ${JSON.stringify(ovr)}`);
}

for (const t of tgt.filter((r) => r.kind === 'ML')) {
  del.mleaders.push(t.handle);
  const tv = xy(t.vtx.split(';')[0]);
  // only plan-area leaders are replaced by --add (profile-sheet leaders with the same prefixes stay)
  if (skipPrefixes.some((p) => t.txt.startsWith(p)) && !(tv[1] <= planY)) { report.push(`ml ${t.handle} replaced by --add`); continue; }
  const cands = pkg.filter((r) => r.kind === 'ML' && r.txt === t.txt);
  const m = cands.sort((a, b) => Math.hypot(...xy(a.vtx.split(';')[0]).map((v, i) => v - tv[i])) - Math.hypot(...xy(b.vtx.split(';')[0]).map((v, i) => v - tv[i])))[0];
  const src = m || t;
  const dog = xy(src.dogleg);
  const rotation = Math.abs(dog[0]) > 0.9 ? 0 : 1.5972;
  const arrow = xy(src.vtx.split(';')[0]), txt = xy(src.txtloc);
  const props = m ? pkgProps(m.handle) : {};
  const e = { kind: 'mleader', layer: props.layer || t.layer, mLeaderStyle: props.style || 'Formtech-1.0', height: Number(src.h), rotation,
    text: t.txt, leaderX: arrow[0], leaderY: arrow[1], x: txt[0], y: txt[1] };
  if (Number(src.w) > 0) e.width = Number(src.w);
  if (props.color !== undefined && !Number.isNaN(props.color)) e.colorIndex = props.color;
  entities.push(e);
  report.push(`ml ${t.handle} ${m ? 'pkg ' + m.handle : 'own'}`);
}

for (const f of args.add || []) entities.push(...JSON.parse(fs.readFileSync(f, 'utf8')).entities);
fs.writeFileSync(one('out'), JSON.stringify({ deleteHandles: del, payload: { space: 'model', entities } }, null, 1));
console.log(report.join('\n'));
console.log(`delete dims ${del.dims.length}, mleaders ${del.mleaders.length}; create ${entities.length}`);
