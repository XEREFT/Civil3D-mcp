#!/usr/bin/env node
// MDWASD easement strips (UC-005 A.8 / WS 2.21) for the existing -- or designed -- mains that sit on PRIVATE property, as one acad_create_entities payload:
// two dark dashed polylines (C-ANNO, DASHED2) at +/- the standard offset from the main (12 ft water: 6 each side; 15 ft sewer: 7.5; both: 23.5 ft min with
// the water/sewer 10 ft apart), the main centered in it (A.15), and the standard label ("twelve (12) feet MDWASD easement" / "fifteen (15) feet ...").
// Input = mdwasd-check.mjs --json output (its `easements` list: only mains on PA lots). A RECORDED easement (plat / O.R. book, user-confirmed) always wins over
// this standard strip: pass --recorded-width to override and the label becomes "EXIST <w>' MDWASD EASEMENT (PER <ref>)".
//   node c300-mdwasd-easement.mjs --check mdwasd-check.json --spec spec.json [--standard formtech-c300.json] [--out mdwasd-ue.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
if (!args.check || !args.spec) { console.error('usage: node c300-mdwasd-easement.mjs --check mdwasd-check.json --spec spec.json [--out file]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const std = JSON.parse(fs.readFileSync(args.standard || path.join(here, '../references/standards/formtech-c300.json'), 'utf8'));
const chk = JSON.parse(fs.readFileSync(args.check, 'utf8'));
const spec = JSON.parse(fs.readFileSync(args.spec, 'utf8'));
const ES = std.roles.easementLine, LD = std.roles.existingUtilityLeader;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]), unit = (a) => mul(a, 1 / (len(a) || 1));

const entities = [];
for (const e of chk.easements ?? []) {
  const off = args['recorded-width'] ? Number(args['recorded-width']) / 2 : e.offsetEachSideFt;
  const u = unit(sub(e.b, e.a)), n = [-u[1], u[0]];
  for (const side of [1, -1]) {
    const p = [add(e.a, mul(n, off * side)), add(e.b, mul(n, off * side))];
    entities.push({ kind: 'polyline', layer: ES.layer, colorIndex: ES.colorIndex, linetype: ES.linetype, points: p.map((q) => ({ x: r4(q[0]), y: r4(q[1]) })) });
  }
  const mid = add(e.a, mul(sub(e.b, e.a), 0.4)), textPt = add(add(mid, mul(n, off + 14)), mul(u, 6));
  const text = args['recorded-width'] ? `EXIST ${args['recorded-width']}' MDWASD EASEMENT${args['recorded-ref'] ? `\\P(PER ${args['recorded-ref']})` : ''}` : e.label.toUpperCase();
  entities.push({ kind: 'mleader', layer: LD.layer, colorIndex: LD.colorIndex, mLeaderStyle: LD.mLeaderStyle, height: LD.height, ...(LD.annotative ? {} : { scale: LD.scale }),
    rotation: r4((spec.twist.streetAngleDegrees * Math.PI) / 180), text, leaderX: r4(mid[0]), leaderY: r4(mid[1]), x: r4(textPt[0]), y: r4(textPt[1]) });
}
const out = { createEntities: { entities }, summary: { easements: (chk.easements ?? []).length } };
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out));
console.log(entities.length ? `${(chk.easements ?? []).length} MDWASD easement(s): ${entities.length} entities${args.out ? ' -> ' + args.out : ''}` : 'no main on private property: no MDWASD easement drawn');
