#!/usr/bin/env node
// DESIGN-READY AUDIT (read-only, no live Civil 3D): scores a BASE C-300 against what the design engineer needs, i.e. the gaps found by reverse-engineering
// the designer's finished VILLA ONE / Goulds sheets (design audit 2026-10-25, references/design-ready-baseline.md). Every check has an id (DR-xx) used in
// the baseline doc, the agent and project reports.
//   node design-ready-audit.mjs --dir "<...\<Name> @xereft base>" [--dwg <file.dwg>] [--intake "<client folder>"] [--json] [--refresh]
//   node design-ready-audit.mjs --selftest
// --dwg defaults to project.json deliverables.dwg; --intake to project.json sources.intakeDir. Fingerprints (dwg-fingerprint.ps1, Core Console on copies) are
// cached in %TEMP%\c3d-fingerprint\cache by file hash; --refresh rebuilds them. Exit 1 when any FAIL.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFp } from "./design-gap-diff.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(`--${n}`);

const D2R = Math.PI / 180;
const clean = (t) => String(t ?? "").replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/\\P/g, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const md5 = (f) => createHash("md5").update(readFileSync(f)).digest("hex");
const angDiff180 = (a, b) => { const d = Math.abs((((a - b) % 180) + 180) % 180); return Math.min(d, 180 - d); };

function fingerprint(dwg, refresh) {
  const cache = join(tmpdir(), "c3d-fingerprint", "cache");
  mkdirSync(cache, { recursive: true });
  const out = join(cache, `${md5(dwg)}.tsv`);
  if (refresh || !existsSync(out)) {
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "dwg-fingerprint.ps1"), "-Dwg", dwg, "-Out", out], { encoding: "utf8", timeout: 300000 });
    if (!existsSync(out)) throw new Error(`fingerprint failed for ${dwg}: ${(r.stderr || r.stdout).slice(-300)}`);
  }
  return parseFp(readFileSync(out, "utf8"));
}

// model-space rectangle a viewport shows: centre = target + viewctr turned by -twist; half sizes = w/2, ht/2 at viewht/ht scale
export function viewportFrame(v) {
  const num = (s) => String(s ?? "").replace(/[()]/g, "").trim().split(/\s+/).map(Number);
  const [tx, ty] = num(v.target), [cx, cy] = num(v.viewctr), tw = Number(v.twist) || 0, k = Number(v.viewht) / Number(v.ht);
  const c = Math.cos(-tw), s = Math.sin(-tw);
  const center = [tx + cx * c - cy * s, ty + cx * s + cy * c];
  return { center, twist: tw, halfW: (Number(v.w) * k) / 2, halfH: (Number(v.ht) * k) / 2,
    contains(p, m = 0) { const d = [p[0] - center[0], p[1] - center[1]]; const u = [Math.cos(-tw), Math.sin(-tw)], n = [-u[1], u[0]];
      return Math.abs(d[0] * u[0] + d[1] * u[1]) <= this.halfW - m && Math.abs(d[0] * n[0] + d[1] * n[1]) <= this.halfH - m; } };
}

export function audit({ fp, topo, pj, intakeXrefs = {}, baseXrefs = {}, dwgPath = null }) {
  const R = [];
  const add = (id, level, msg) => R.push({ id, level, msg });
  const model = fp.ents.filter((e) => e.space === "Model");
  const texts = fp.ents.filter((e) => ["TEXT", "MTEXT", "MULTILEADER"].includes(e.type)).map((e) => ({ ...e, t: clean(e.txt) }));
  const allText = texts.map((e) => e.t).join(" | ");
  const mainVp = fp.vports.filter((v) => v.layout === (pj.deliverables?.layout ?? "C-300") && Number(v.viewht) / Number(v.ht) > 5).sort((a, b) => +b.w * +b.ht - +a.w * +a.ht)[0];
  const frame = mainVp ? viewportFrame(mainVp) : null;
  const lot = pj.site?.lotPoint;

  // DR-01 layouts: BASE = Model + C-300 only; never a leftover "(OLD)" / other project's layout
  const lays = fp.layouts.map((l) => l.name).filter((n) => n !== "Model");
  const extra = lays.filter((n) => n !== (pj.deliverables?.layout ?? "C-300"));
  add("DR-01", extra.length ? "FAIL" : "OK", extra.length ? `extra layouts: ${extra.join(", ")} (the designer's VILLA ONE kept Goulds' "C-02 (OLD)"/"C-03 (OLD)")` : `layouts: ${lays.join(", ")}`);

  // DR-02 title block = this project (AGR, project no., name)
  const agr = pj.agrNo ? String(pj.agrNo) : null;
  const agrs = [...allText.matchAll(/AGR\. NO\. (\d+)/g)].map((m) => m[1]);
  const badAgr = agr ? agrs.filter((a) => a !== agr) : [];
  add("DR-02", !agr ? "WARN" /* no POC yet: AGR pending */ : !agrs.includes(agr) || badAgr.length ? "FAIL" : "OK", `AGR NO on the sheet: ${[...new Set(agrs)].join(", ") || "none"} (project ${agr ?? "?"})${pj.projectNo && !allText.includes(pj.projectNo) ? `; project no. ${pj.projectNo} missing` : ""}`);

  // DR-03 no model content of another project (template residue): entities > 1500 ft from the lot
  if (lot) {
    const far = model.filter((e) => Number.isFinite(+e.x) && (Math.abs(+e.x) > 1 || Math.abs(+e.y) > 1) && Math.hypot(+e.x - lot[0], +e.y - lot[1]) > 1500 && !/^AECC_/.test(e.type));
    add("DR-03", far.length > 5 ? "FAIL" : far.length ? "WARN" : "OK", far.length ? `${far.length} model entities > 1500 ft from the lot (e.g. ${far.slice(0, 3).map((e) => `${e.type} ${e.layer}`).join("; ")}): residue of the template project` : "no far-away model content");
  }

  // DR-04 every POC folio printed in the subject label
  const folios = pj.subject?.folios?.length ? pj.subject.folios : pj.sources?.pocData?.folios ?? (pj.subject?.folio ? [pj.subject.folio] : []);
  const subj = texts.find((e) => /SUBJECT PROPERTY/.test(e.t));
  const miss = folios.filter((f) => !subj || !subj.t.includes(f));
  add("DR-04", !subj ? "FAIL" : miss.length ? "FAIL" : "OK", !subj ? "no SUBJECT PROPERTY label" : miss.length ? `subject label misses folio(s) ${miss.join(", ")} (POC lists ${folios.length})` : `subject label carries ${folios.length} folio(s)`);
  if (subj && pj.subject?.folio && /FOLIO NO: ([\d-]+)/.test(subj.t)) { /* the folio number itself is checked by DR-04 */ }

  // DR-05 the POC's governing as-builts are cited; cited as-builts the POC does not name are listed (may be legitimate, often a mis-association)
  const conns = pj.sources?.pocData?.connections ?? [];
  const pocAB = [...new Set(conns.map((c) => c.asBuilt).filter(Boolean).map((s) => s.replace(/\s+/g, "")))];
  const cited = [...new Set([...allText.matchAll(/\(?(?:PER )?(E ?S?\d{3,5}[A-Z0-9]*-\d+)\)?/g)].map((m) => m[1].replace(/\s+/g, "")))];
  // sewer: the governing as-built must be cited; water: the POC lists OPTIONS (12" or 16"), citing one of them is enough
  const waterAB = conns.filter((c) => c.kind === "water").map((c) => (c.asBuilt ?? "").replace(/\s+/g, "")).filter(Boolean);
  const waterOk = !waterAB.length || waterAB.some((a) => cited.includes(a));
  const notCited = pocAB.filter((a) => !cited.includes(a) && !(waterAB.includes(a) && waterOk));
  const foreign = cited.filter((a) => !pocAB.includes(a));
  if (!conns.length) add("DR-05", "WARN", "project.json has no POC connections (rerun poc-extract.mjs --project): as-built authority not checked");
  else {
    const view = conns.filter((c) => notCited.includes((c.asBuilt ?? "").replace(/\s+/g, "")));
    add("DR-05", view.some((c) => c.street) ? "FAIL" : view.length ? "WARN" : "OK",
      `POC as-builts ${pocAB.join(", ")}; cited ${cited.join(", ") || "none"}${notCited.length ? `; NOT cited: ${notCited.join(", ")}` : ""}${foreign.length ? `; cited but not in the POC: ${foreign.join(", ")} (check the association: Goulds BASE cited ES8206-1, a subdivision 530 ft away)` : ""}`);
  }

  // DR-06 north arrow follows the viewport twist
  const arrow = fp.ents.find((e) => e.space !== "Model" && e.type === "INSERT" && /^sna$/i.test(e.block ?? ""));
  if (arrow && frame) {
    const d = Math.abs((((+arrow.rot - frame.twist) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) / D2R;
    add("DR-06", d > 1 ? "FAIL" : "OK", `north arrow ${(+arrow.rot / D2R).toFixed(2)} deg vs viewport twist ${(frame.twist / D2R).toFixed(2)} deg${d > 1 ? " -> c300-north-arrow.mjs" : ""}`);
  } else add("DR-06", "WARN", "north arrow block 'sna' or main viewport not found");

  // DR-07 street labels lie on a street centerline and run parallel to it
  // street axes: project.json centerlines, host CENTER_LINE lines, and the as-built sewer runs (a street sewer lies in its street: ES7843-7 SW 231 ST is the cross street
  // whose centerline the survey does not carry)
  const abFile = join(dirname(dwgPath ?? ""), "_reports", "asbuilt.json");
  const abMains = (() => { try { const ab = JSON.parse(readFileSync(abFile, "utf8")); const mh = Object.fromEntries(ab.manholes.map((m) => [m.id, [m.x, m.y]])); return ab.sewerMains.filter((s) => mh[s.from] && mh[s.to]).map((s) => [mh[s.from], mh[s.to]]); } catch { return []; } })();
  const cls = [...abMains, ...(pj.site?.centerlines ?? []).map((c) => [c.a, c.b]),
    ...model.filter((e) => e.layer === "CENTER_LINE" && e.type === "LINE").map((e) => [[+e.x, +e.y], String(e.p2).replace(/[()]/g, "").trim().split(/\s+/).slice(0, 2).map(Number)])];
  const streetLabels = texts.filter((e) => e.space === "Model" && e.layer === "TextTopoLabel_ep" && /^SW \d+\w* (STREET|AVENUE|ROAD|COURT|TERRACE|PLACE|DRIVE|LANE|AVE|ST|RD)$/.test(e.t));
  if (cls.length && streetLabels.length) {
    const bad = streetLabels.filter((l) => {
      const p = [+l.x, +l.y], rot = (+l.rot || 0) / D2R;
      return !cls.some(([a, b]) => {
        const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...d); if (L < 1) return false;
        const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (L * L);
        const off = Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / L;
        return t > -2 && t < 4 && off < 20 && angDiff180(rot, Math.atan2(d[1], d[0]) / D2R) < 6;
      });
    });
    add("DR-07", bad.length ? "FAIL" : "OK", bad.length ? `${bad.length}/${streetLabels.length} street label(s) not on a parallel centerline: ${bad.map((l) => `${l.t} @${(+l.x).toFixed(0)},${(+l.y).toFixed(0)}`).join("; ")}` : `${streetLabels.length} street labels on their centerlines`);
  } else add("DR-07", "WARN", `street-label check skipped (${cls.length} centerline pieces, ${streetLabels.length} labels): save site.centerlines with centerlines-extract.mjs`);

  // DR-08 POC connection points shown on the sheet
  const poc = (pj.site?.pocPoints ?? []).filter((q) => Array.isArray(q));
  if (poc.length && frame) { const out = poc.filter((q) => !frame.contains(q)); add("DR-08", out.length ? "FAIL" : "OK", out.length ? `${out.length}/${poc.length} POC point(s) outside the viewport` : `${poc.length} POC point(s) inside the viewport`); }
  else add("DR-08", "WARN", "project.json site.pocPoints not set: cannot prove the connection point is on the sheet");

  // DR-09 survey look: X-TOPO layers gray in the host (designer GUIA), hatches off
  const xt = Object.entries(fp.layers).filter(([n]) => n.startsWith("X-TOPO|"));
  if (xt.length) {
    const gray = xt.filter(([, l]) => Math.abs(Number(l.c)) === 8).length / xt.length;
    const hatchOn = xt.filter(([n, l]) => /HATCH_ASPHALT|HATCH_CONC/.test(n) && !(Number(l.fl) & 1) && Number(l.c) > 0);
    const hatchEnts = topo ? topo.ents.filter((e) => e.type === "HATCH" && /HATCH_ASPHALT|HATCH_CONC/.test(e.layer) && (!frame || frame.contains([+e.x, +e.y], -200))).length : 0;
    add("DR-09", gray < 0.8 || (hatchOn.length && hatchEnts) ? "WARN" : "OK", `${Math.round(gray * 100)}% of X-TOPO layers gray (ACI 8)${hatchOn.length && hatchEnts ? `; ${hatchEnts} asphalt/concrete hatch(es) visible (the designer shows none)` : ""}`);
  }

  // DR-10 lot / block identification: every lot in view named (LOT n BLOCK n P.B. x, PG. y)
  if (topo) {
    const lotTexts = topo.ents.filter((e) => ["TEXT", "MTEXT"].includes(e.type) && /LOT\s*\d+/.test(clean(e.txt)) && /BLOCK|BLK/.test(clean(e.txt)) && (!frame || frame.contains([+e.x, +e.y])));
    add("DR-10", lotTexts.length >= 4 ? "OK" : "WARN", `${lotTexts.length} LOT/BLOCK label(s) of the survey inside the viewport (designer: every lot named; the BASE of VILLA ONE had 0 after using an older X-TOPO)`);
  }

  // DR-11 xrefs = the newest client set (hash)
  // a processed BASE xref (gray ByLayer, hidden pavement text) never hashes like the client's copy, so the project DECLARES its set: sources.xrefSet = the intake sub-folder
  // (relative to intakeDir) the xrefs came from; it must be the newest one (after dropping designer folders), else WARN
  const newest = Object.values(intakeXrefs).sort((a, b) => (b.date > a.date ? 1 : -1))[0];
  const declared = pj.sources?.xrefSet;
  if (newest) {
    const declaredDate = declared ? (/(\d{4}-\d{2}-\d{2})/.exec(declared) ?? [])[1] ?? "" : "";
    const stale = Object.keys(baseXrefs).filter((k) => intakeXrefs[k] && baseXrefs[k] === intakeXrefs[k].hash);
    add("DR-11", declared ? (declaredDate >= newest.date ? "OK" : "WARN") : stale.length ? "OK" : "WARN",
      declared ? `xrefs declared from "${declared}" (newest client folder: ${dirname(newest.from)})` : `no sources.xrefSet in project.json (newest client xrefs: ${newest.from})`);
  }

  // DR-12 measured structures: survey R.E./I.E. vs our MH label
  if (topo) {
    const surveyMh = topo.ents.filter((e) => /S\.?W?\.?\s*MH|SAN.*MH|S\.MH/.test(clean(e.txt)) && /R\.E\.|I\.E\./.test(clean(e.txt)) && (!frame || frame.contains([+e.x, +e.y], -20)));
    const labels = texts.filter((e) => e.type === "MULTILEADER" && /EXIST\.? SAN MH/.test(e.t));
    const conflicts = [];
    for (const s of surveyMh) {
      const re = Number((/R\.E\.:?\s*([\d.]+)/.exec(clean(s.txt)) ?? [])[1]);
      const lab = labels.map((l) => ({ l, d: Math.hypot(+l.x - +s.x, +l.y - +s.y) })).sort((a, b) => a.d - b.d)[0];
      if (!lab || lab.d > 15 || !Number.isFinite(re)) continue;
      const rim = Number((/RIM:?\s*([\d.]+)/.exec(lab.l.t) ?? [])[1]);
      if (Number.isFinite(rim) && Math.abs(rim - re) > 0.1 && !/FIELD VERIFY|PER SURVEY/.test(lab.l.t)) conflicts.push(`label RIM ${rim} vs survey R.E. ${re}`);
    }
    add("DR-12", conflicts.length ? "WARN" : "OK", conflicts.length ? `MH label differs from the survey without (FIELD VERIFY): ${conflicts.join("; ")}` : `${surveyMh.length} surveyed MH(s) consistent with the labels`);
  }

  // DR-13 storm structures the survey measures (C.B. R.E.) get an EXIST STORM label
  if (topo) {
    const cbs = topo.ents.filter((e) => /C\.B\.?/.test(clean(e.txt)) && /R\.E\./.test(clean(e.txt)) && (!frame || frame.contains([+e.x, +e.y], -10)));
    const st = texts.filter((e) => /EXIST STORM/.test(e.t)).length;
    add("DR-13", cbs.length && !st ? "WARN" : "OK", `${cbs.length} surveyed catch basin(s) in view, ${st} EXIST STORM label(s)`);
  }
  return R;
}

function newestIntakeXrefs(intake, designerFolders = []) {
  const out = {};
  if (!intake || !existsSync(intake)) return out;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  // designer folders ("2026-08-03_Design", "... DESIGN") hold the design engineer's derived xrefs, not client intake: never the reference for "newest client survey"
  for (const f of walk(intake).filter((f) => /\\X-(TOPO|UTIL|ARCH)\.dwg$/i.test(f) && !/design|\\_backup\\|\\SOURCE FILES\\/i.test(f.slice(intake.length)) && !designerFolders.some((d) => f.slice(intake.length).toLowerCase().includes(String(d).toLowerCase())))) {
    const k = basename(f).toUpperCase();
    // newest = latest dated folder name (YYYY-MM-DD) in the path, then mtime
    const date = (/(\d{4}-\d{2}-\d{2})/.exec(f.slice(intake.length)) ?? [])[1] ?? "0000";
    const cand = { from: f.slice(intake.length + 1), date, mtime: statSync(f).mtimeMs, file: f };
    if (!out[k] || cand.date > out[k].date || (cand.date === out[k].date && cand.mtime > out[k].mtime)) out[k] = cand;
  }
  for (const k of Object.keys(out)) out[k].hash = md5(out[k].file);
  return out;
}

if (has("selftest")) {
  const fp = parseFp([
    "LAYOUT\tC-300\ttab=1", "LAYOUT\tC-02 (OLD)\ttab=2",
    "VPORT\tC-300\th=1\tw=25\tht=23\tviewctr=(0 0 0)\tviewht=460\ttwist=4.686\tstatus=1\ttarget=(1000 1000 0)",
    "ENT\tC-300\tINSERT\t2\tTEXT\tx=29\ty=21\tblock=sna\trot=0\tatts=",
    "ENT\tC-300\tMTEXT\t3\tTXT\tx=1\ty=1\ttxt=AGR. NO. 33808",
    "ENT\tModel\tMTEXT\t4\tTextTopoLabel_ep\tx=1000\ty=1000\trot=0\ttxt=X SW 125 AVE FOLIO NO: 30-6913-011-0825 SUBJECT PROPERTY",
  ].join("\n"));
  const r = audit({ fp, pj: { agrNo: "33809", deliverables: { layout: "C-300" }, site: { lotPoint: [1000, 1000] }, subject: { folios: ["30-6913-011-0825", "30-6913-011-0827"] } } });
  const lv = Object.fromEntries(r.map((x) => [x.id, x.level]));
  const fr = viewportFrame({ target: "(859801.0986 444692.1160 0)", viewctr: "(8.3460 11.5795 0)", twist: 4.686, viewht: 460, ht: 23, w: 25 });
  const ok = lv["DR-01"] === "FAIL" && lv["DR-02"] === "FAIL" && lv["DR-04"] === "FAIL" && lv["DR-06"] === "FAIL" && Math.hypot(fr.center[0] - 859789.19, fr.center[1] - 444700.69) < 1.5;
  console.log(ok ? "selftest OK" : `selftest FAIL ${JSON.stringify(lv)} center ${fr.center}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const dir = opt("dir") ? resolve(opt("dir")) : (console.error('usage: node design-ready-audit.mjs --dir "<base folder>" [--dwg f] [--intake d] [--json] [--refresh] | --selftest'), process.exit(2));
  const pj = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
  const dwg = resolve(dir, opt("dwg") ?? pj.deliverables?.dwg ?? "");
  const fp = fingerprint(dwg, has("refresh"));
  const topoDwg = join(dirname(dwg), "X-TOPO.dwg");
  const topo = existsSync(topoDwg) ? fingerprint(topoDwg, has("refresh")) : null;
  const intakeXrefs = newestIntakeXrefs(opt("intake") ?? pj.sources?.intakeDir, pj.sources?.designerFolders ?? []);   // designerFolders: intake sub-folders that hold the designer's own work (e.g. Goulds "2026-07-31")
  const baseXrefs = Object.fromEntries(["X-TOPO.DWG", "X-UTIL.DWG", "X-ARCH.DWG"].filter((k) => existsSync(join(dirname(dwg), k))).map((k) => [k, md5(join(dirname(dwg), k))]));
  const res = audit({ fp, topo, pj, intakeXrefs, baseXrefs, dwgPath: dwg });
  const n = (l) => res.filter((r) => r.level === l).length;
  if (has("json")) console.log(JSON.stringify({ dwg, results: res, fail: n("FAIL"), warn: n("WARN"), ok: n("OK") }, null, 1));
  else {
    for (const r of res) console.log(`${r.level.padEnd(4)} ${r.id} ${r.msg}`);
    console.log(`DESIGN-READY ${basename(dwg)}: ${n("FAIL")} FAIL, ${n("WARN")} WARN, ${n("OK")} OK  (score ${Math.round((100 * n("OK")) / res.length)}%)`);
  }
  process.exit(n("FAIL") ? 1 : 0);
}
