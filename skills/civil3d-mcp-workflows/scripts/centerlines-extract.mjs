#!/usr/bin/env node
// Street centerlines for the C-300 engine from ANY drawing (survey X-TOPO, the designer's C-300 host, an older cleaned X-TOPO), kept in project.json
// site.centerlines so c300-build-spec.mjs no longer depends on the survey carrying them (design audit 2026-10-25: the client's newest X-TOPO of VILLA ONE
// and Goulds 08-03 has no CENTER_LINE near the lot; the designer draws them in the host). Reads dwg-dump.ps1 output (pipe format). Node 18+, no deps.
//   node centerlines-extract.mjs --dump <dwg-dump.txt> [--dump <another>] --window xmin,ymin,xmax,ymax [--layers CENTER_LINE,CL] [--min 20]
//        [--save "<project folder>"]   (writes site.centerlines, replacing the previous list; prints them otherwise)
// LINE and LWPOLYLINE pieces >= --min ft on the layers (xref prefixes ignored), deduplicated (same ends within 0.5 ft).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const all = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const opt = (n, d) => all(n)[0] ?? d;
const dumps = all("dump");
const win = opt("window", "").split(",").map(Number);
if (!dumps.length || win.length !== 4 || win.some((v) => !Number.isFinite(v))) { console.error("usage: --dump <dump.txt> --window xmin,ymin,xmax,ymax [--layers L1,L2] [--min 20] [--save <dir>]"); process.exit(2); }
const layers = opt("layers", "CENTER_LINE,CL").split(",").map((s) => s.trim().toUpperCase());
const minLen = Number(opt("min", 20));
const inW = ([x, y]) => x >= win[0] && x <= win[2] && y >= win[1] && y <= win[3];
const pt = (s) => { const m = /\(([-\d.e+]+) ([-\d.e+]+)/.exec(s || ""); return m ? [+m[1], +m[2]] : null; };

const segs = [];
const push = (a, b, src) => {
  if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < minLen || (!inW(a) && !inW(b))) return;
  const r = (p) => p.map((v) => Math.round(v * 1000) / 1000);
  const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.5;
  if (segs.some((s) => (same(s.a, a) && same(s.b, b)) || (same(s.a, b) && same(s.b, a)))) return;
  segs.push({ a: r(a), b: r(b), src });
};
for (const f of dumps) {
  for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
    if (!l.startsWith("ENT|")) continue;
    const i = l.indexOf("|txt=");
    const [, type, , layer, ...p] = (i >= 0 ? l.slice(0, i) : l).split("|");
    if (!layers.includes(layer.replace(/^.*\|/, "").toUpperCase())) continue;
    const o = Object.fromEntries(p.map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
    const src = f.replace(/^.*[\\/]/, "");
    if (type === "LINE") push([+o.x, +o.y], pt(o.p2), src);
    if (type === "LWPOLYLINE") { const v = (o.v || "").split(";").filter(Boolean).map((s) => s.split(",").map(Number)); for (let k = 1; k < v.length; k++) push(v[k - 1], v[k], src); }
  }
}
console.log(`${segs.length} centerline piece(s) in the window`);
for (const s of segs) console.log(`  ${s.a.join(",")} -> ${s.b.join(",")}  (${s.src})`);
const dir = opt("save");
if (dir) {
  // project.json is a Hidden file on Windows: a plain writeFileSync fails with EPERM, saveProject handles it
  const ps = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "project-state.mjs")).href);
  const f = ps.projectPath(dir);
  if (!existsSync(f)) { console.error(`no project.json in ${dir}`); process.exit(2); }
  const p = ps.loadProject(dir);
  p.site ??= {};
  p.site.centerlines = segs.map(({ a, b }) => ({ a, b }));
  (p.history ??= []).push({ date: new Date().toISOString().slice(0, 10), event: `site.centerlines: ${segs.length} piece(s) from ${[...new Set(segs.map((s) => s.src))].join(", ")}` });
  ps.saveProject(dir, p);
  console.log(`saved to ${f}`);
}
