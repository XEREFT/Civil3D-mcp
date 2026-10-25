#!/usr/bin/env node
// Puts the architect's drawings on the survey: finds the architect's property line in the site plan (units are usually inches, local origin), matches its street-side edge
// to the survey's lot edge on the right-of-way (same length, same side of the street), computes scale + rotation + translation and builds <project>\X-ARCH.dwg with
// xarch-build.ps1 (yellow linework like the firm's GUIA, annotation/furniture/trees frozen). Never mirrors: of the two ways to pair the edge ends, the one that leaves the
// lot interior on the side away from the street is used.
//   node xarch-georef.mjs --dir "<project folder>" --site "<2620-X-0 Site Plan>.dwg" --floor "<2620-X-1 First Floor Plan>.dwg" [--out <dir>\X-ARCH.dwg] [--dry-run]
// Needs <dir>\project.json (site.lotPoint, sources.surveyProfile optional) and <dir>\X-TOPO.dwg. SEIDENSTEIN (2026-10-25): inches -> feet 1/12, rotation -87.29 deg.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadProfiles, profileByName } from "./lib/survey-profile.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const here = dirname(fileURLToPath(import.meta.url));
const dir = flag("dir") ? resolve(flag("dir")) : die('usage: node xarch-georef.mjs --dir "<project folder>" --site "<site plan>.dwg" --floor "<floor plan>.dwg" [--out X-ARCH.dwg] [--dry-run]');
const siteDwg = flag("site") ?? die("--site <architect's site plan .dwg> is required");
const floorDwg = flag("floor") ?? siteDwg;
const out = flag("out") ?? join(dir, "X-ARCH.dwg");
const ps = (script, a) => spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, script), ...a], { encoding: "utf8", maxBuffer: 64e6, timeout: 600000 });
const dump = (dwg) => { const r = ps("dwg-dump.ps1", [dwg, "-OutDir", join(tmpdir(), "c3d-dwg-dump")]); const p = String(r.stdout).trim().split("\n").pop().trim(); if (!existsSync(p)) die(`dump failed for ${dwg}: ${r.stderr || r.stdout}`); return p; };
const readEnts = (file) => readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("ENT|")).map((l) => {
  const p = l.trimEnd().split("|"); const d = Object.fromEntries(p.slice(4).filter((x) => x.includes("=")).map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
  const p2 = (d.p2 ?? "").match(/-?[\d.]+/g)?.map(Number);
  const v = d.v ? d.v.split(";").filter(Boolean).map((s) => s.split(",").map(Number)) : null;
  return { type: p[1], layer: p[3], x: Number(d.x), y: Number(d.y), p2: p2 && p2.length >= 2 ? [p2[0], p2[1]] : null, v, closed: d.closed === "1" };
});
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len = (a) => Math.hypot(a[0], a[1]), dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const segDist = (p, a, b) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1))); return len(sub(p, [a[0] + t * ab[0], a[1] + t * ab[1]])); };

// ---- architect: property polygon + street centerline (site plan) ----
const arch = readEnts(dump(siteDwg));
const polys = arch.filter((e) => e.type === "LWPOLYLINE" && e.v && /PROPER|BOUNDARY/i.test(e.layer)).map((e) => {
  let v = e.v.slice(); if (v.length > 1 && len(sub(v[0], v[v.length - 1])) < 1e-3) v = v.slice(0, -1); return { layer: e.layer, v };
}).filter((p) => p.v.length === 4);
if (!polys.length) die("no 4-corner property polyline on a PROPERTY/BOUNDARY layer in the site plan: pick the edge by hand (see references/automation-backlog.md, X-ARCH)");
const area = (v) => Math.abs(v.reduce((s, p, i) => s + cross(p, v[(i + 1) % v.length]), 0) / 2);
const prop = polys.sort((a, b) => area(b.v) - area(a.v))[0];
const cl = arch.filter((e) => e.type === "LINE" && e.p2 && /CENTER|CENTRE|STREET|R\.?O\.?W/i.test(e.layer)).map((e) => [[e.x, e.y], e.p2]);
if (!cl.length) die("no street centerline LINE (layer CENTER/STREET) in the site plan: the architect's street side cannot be told");
const edges = prop.v.map((a, i) => [a, prop.v[(i + 1) % 4]]);
const dToCl = (e) => { const m = [(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2]; return Math.min(...cl.map(([a, b]) => segDist(m, a, b))); };
const aFront = edges.slice().sort((a, b) => dToCl(a) - dToCl(b))[0];
const aLen = len(sub(aFront[1], aFront[0]));
const centroid = (v) => [v.reduce((s, p) => s + p[0], 0) / v.length, v.reduce((s, p) => s + p[1], 0) / v.length];
const aCen = centroid(prop.v);

// ---- survey: the lot edge on the R/W (same length, closest to the street centerline) ----
const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
const lotPoint = project.site?.lotPoint ?? project.lotPoint ?? die("project.json has no site.lotPoint");
const forced = project.sources?.surveyProfile;
const profiles = loadProfiles();
let profile = forced ? profileByName(forced) : null;
const topoDump = dump(join(dir, "X-TOPO.dwg"));
const ents = readEnts(topoDump).filter((e) => Number.isFinite(e.x) && Math.hypot(e.x - lotPoint[0], e.y - lotPoint[1]) < 400);
if (!profile) { const hit = Object.entries(profiles).find(([, p]) => ents.some((e) => e.type === "LINE" && p.centerline.includes(e.layer))); profile = hit ? { name: hit[0], ...hit[1] } : die("no survey profile matches this X-TOPO"); }
const sCl = ents.filter((e) => e.type === "LINE" && e.p2 && profile.centerline.includes(e.layer)).map((e) => [[e.x, e.y], e.p2]);
const rwPts = ents.filter((e) => e.type === "LINE" && e.p2 && (profile.rwLines ?? []).includes(e.layer)).flatMap((e) => [[e.x, e.y], e.p2]);
const plLayers = new Set([...(profile.plLines ?? []), ...(profile.propertyLine ?? [])]);
let scale = null, sFront = null, best = 1e9;
for (const unit of [1 / 12, 1, 1 / 304.8, 3.28084]) {   // drawing units: inches, feet, millimetres, metres -> feet
  const want = aLen * unit;
  for (const e of ents.filter((x) => x.type === "LINE" && x.p2 && plLayers.has(x.layer))) {
    const L = len(sub(e.p2, [e.x, e.y]));
    if (Math.abs(L - want) / want > 0.02) continue;
    const m = [(e.x + e.p2[0]) / 2, (e.y + e.p2[1]) / 2];
    // frontage = the lot line that meets the right-of-way line (FormTech: BNDRY ends where R-W ends); otherwise the one nearest the street centerline
    const touchesRw = rwPts.some((q) => len(sub(q, [e.x, e.y])) < 0.5 || len(sub(q, e.p2)) < 0.5);
    const d = (rwPts.length ? (touchesRw ? 0 : 1e6) : 0) + (sCl.length ? Math.min(...sCl.map(([a, b]) => segDist(m, a, b))) : 0) + len(sub(m, lotPoint)) * 1e-3;
    if (d < best) { best = d; sFront = [[e.x, e.y], e.p2]; scale = L / aLen; }
  }
  if (sFront) break;
}
if (!sFront) die(`no survey lot line of the right length (${(aLen / 12).toFixed(2)} ft if inches) near lotPoint on ${[...plLayers].join("/")}`);

// ---- pairing without mirroring: the lot interior must end up on the side away from the street ----
const fit = (a0, a1, s0, s1) => {
  const ang = Math.atan2(...[s1[1] - s0[1], s1[0] - s0[0]]) - Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
  const c = Math.cos(ang), sn = Math.sin(ang);
  const map = (p) => [scale * (c * p[0] - sn * p[1]) + (s0[0] - scale * (c * a0[0] - sn * a0[1])), scale * (sn * p[0] + c * p[1]) + (s0[1] - scale * (sn * a0[0] + c * a0[1]))];
  return { ang, map, T: [s0[0] - scale * (c * a0[0] - sn * a0[1]), s0[1] - scale * (sn * a0[0] + c * a0[1])] };
};
// street side = where the nearest survey centerline segment lies (a far cross-street centerline would flip the answer)
const fMid = [(sFront[0][0] + sFront[1][0]) / 2, (sFront[0][1] + sFront[1][1]) / 2];
const nearPt = (p, a, b) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1))); return [a[0] + t * ab[0], a[1] + t * ab[1]]; };
const clMid = sCl.length ? sCl.map(([a, b]) => nearPt(fMid, a, b)).sort((p, q) => len(sub(p, fMid)) - len(sub(q, fMid)))[0] : lotPoint;
const side = (a, b, p) => Math.sign(cross(sub(b, a), sub(p, a)));
const cand = [fit(aFront[0], aFront[1], sFront[0], sFront[1]), fit(aFront[0], aFront[1], sFront[1], sFront[0])];
const good = cand.find((f) => side(sFront[0], sFront[1], f.map(aCen)) !== side(sFront[0], sFront[1], clMid)) ?? die("could not pair the street edge without mirroring (check the property line / centerline layers)");
const deg = (good.ang * 180) / Math.PI;
const mapped = prop.v.map(good.map);
const survPts = ents.filter((e) => e.type === "LINE" && e.p2 && plLayers.has(e.layer)).flatMap((e) => [[e.x, e.y], e.p2]);
const MARGIN = Number(flag("margin") ?? 15);   // ft around the lot kept from the architect's site plan
const keepBox = [Math.min(...mapped.map((p) => p[0])) - MARGIN, Math.min(...mapped.map((p) => p[1])) - MARGIN, Math.max(...mapped.map((p) => p[0])) + MARGIN, Math.max(...mapped.map((p) => p[1])) + MARGIN].map((n) => n.toFixed(3)).join(",");
const hits = mapped.filter((m) => survPts.some((s) => len(sub(s, m)) < 1.0)).length;
console.log(`architect lot ${aLen.toFixed(1)} units on "${prop.layer}", scale ${scale.toFixed(6)}, rotation ${deg.toFixed(3)} deg, translation ${good.T.map((n) => n.toFixed(3)).join(", ")}`);
console.log(`check: ${hits}/4 mapped lot corners land within 1 ft of a survey lot-line end${hits < 2 ? "  <-- LOW: look at the result before using it" : ""}`);
if (has("dry-run")) process.exit(0);
const b = ps("xarch-build.ps1", ["-Floor", floorDwg, "-Out", out, "-Scale", String(scale), "-RotDeg", String(deg), "-Tx", String(good.T[0]), "-Ty", String(good.T[1]), "-KeepBox", keepBox, ...(floorDwg !== siteDwg && existsSync(siteDwg) ? ["-Companions", siteDwg] : [])]);
console.log(String(b.stdout).trim().split("\n").slice(-2).join("\n"));
if (b.status !== 0) die(`xarch-build failed: ${b.stderr || b.stdout}`);
console.log(`next: attach/refresh X-ARCH in the build (fase1-from-scratch.mjs --rebuild), then plot to check it. File: ${basename(out)}`);
