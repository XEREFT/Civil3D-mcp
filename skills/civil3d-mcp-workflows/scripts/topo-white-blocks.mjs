#!/usr/bin/env node
// Makes survey symbol BLOCKS white (explicit color 7 on the INSERTs) in a survey xref: for symbols that share a layer with things that must stay gray
// (SEIDENSTEIN: the sanitary-manhole symbol "S in a circle" is block `SMH` on layer NOTES, together with leaders). Symbols that own their layer are whitened
// through the survey profile instead (`whiteXrefLayers`: U UKNOWN MANHOLE, U CATCH BASIN). User rule 2026-10-25: manhole (MH circle), sanitary (S circle) and
// catch-basin grate symbols print in the same tone as the other projects' sheets (white on screen).
//   node topo-white-blocks.mjs --topo "<...\X-TOPO.dwg>" [--blocks SMH,mh,basin] [--circles SYMBOLS[:maxRadius]] [--out <file>] [--dry-run]
// --circles <layer>[:r]: also colours white (explicit 62=7) the CIRCLEs of that layer up to radius r (default 1.5 ft): manhole circles drawn as plain CIRCLEs (Villa one / Goulds survey, layer SYMBOLS)
// Core Console on a %TEMP% copy, original backed up once in _backup\X-TOPO_antes_blancos.dwg; with --out the original is left alone (xref loaded in an open drawing: then xref-reload.ps1).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
const a = process.argv.slice(2); const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const topo = flag("topo") ? resolve(flag("topo")) : (console.error("usage: node topo-white-blocks.mjs --topo <X-TOPO.dwg> [--blocks SMH] [--out f] [--dry-run]"), process.exit(2));
const blocks = flag("blocks", "SMH").split(",").map((s) => s.trim()).filter(Boolean);
const CORE = flag("core", "C:\\Program Files\\Autodesk\\AutoCAD 2027\\accoreconsole.exe");
const work = mkdtempSync(join(tmpdir(), "c3d-whiteblk-")); const copy = join(work, "X-TOPO.dwg"); copyFileSync(topo, copy);
const names = blocks.map((b) => `"${b.toUpperCase()}"`).join(" ");
const dry = a.includes("--dry-run");
const [circLayer, circR = "1.5"] = (flag("circles") ?? "").split(":");
const lisp = [`(setq ss (ssget "_X" (list (cons 410 "Model") (cons 0 "INSERT"))) n 0 m 0)`,
  `(if ss (repeat (sslength ss) (setq e (entget (ssname ss n))) (if (member (strcase (cdr (assoc 2 e))) (list ${names})) (progn (setq m (1+ m))${dry ? "" : ` (if (assoc 62 e) (entmod (subst (cons 62 7) (assoc 62 e) e)) (entmod (append e (list (cons 62 7)))))`})) (setq n (1+ n))))`,
  // the S circle (SMH) is drawn with ByLayer entities on layer 0 inside the definition: an explicit colour on the INSERT does not reach them and the host's gray layer
  // override wins (SEIDENSTEIN 2026-10-26: the symbol stayed gray), so the definition's own entities get colour 7 too
  ...(dry ? [] : [`(foreach b (list ${names}) (setq en (cdr (assoc -2 (tblsearch "BLOCK" b)))) (while en (setq e (entget en)) (if (assoc 62 e) (entmod (subst (cons 62 7) (assoc 62 e) e)) (entmod (append e (list (cons 62 7))))) (setq en (entnext en))))`]),
  ...(circLayer ? [`(setq cc (ssget "_X" (list (cons 0 "CIRCLE") (cons 8 "${circLayer}") (cons 410 "Model"))) n 0 q 0)`, `(if cc (repeat (sslength cc) (setq e (entget (ssname cc n))) (if (<= (cdr (assoc 40 e)) ${Number(circR)}) (progn ${dry ? "" : "(if (assoc 62 e) (entmod (subst (cons 62 7) (assoc 62 e) e)) (entmod (append e (list (cons 62 7)))))"} (setq q (1+ q)))) (setq n (1+ n))))`, `(princ (strcat (chr 10) "WHITECIRC " (itoa q)))`] : []),
  `(princ (strcat (chr 10) "WHITEBLK " (itoa m)))`, ...(dry ? ["QUIT"] : ["_.QSAVE", "QUIT", "Y"])];
writeFileSync(join(work, "s.scr"), lisp.join("\n") + "\n", "ascii");
const r = spawnSync(CORE, ["/i", copy, "/s", join(work, "s.scr"), "/l", "en-US"], { timeout: 180000, windowsHide: true, encoding: "latin1" });
const m = /WHITEBLK (\d+)/.exec(`${r.stdout}`.replace(/\0/g, "")); if (!m) { console.error(`failed: no result line (${work})`); process.exit(1); }
console.log(`inserts of ${blocks.join(",")}: ${m[1]}${dry ? " (dry run)" : ""}`);
const mc = /WHITECIRC (\d+)/.exec(`${r.stdout}`.replace(/\0/g, "")); if (circLayer) console.log(`circles on ${circLayer} (r <= ${circR}): ${mc ? mc[1] : "?"}`);
if (!dry && (Number(m[1]) || Number(mc?.[1] ?? 0))) {
  const bk = join(dirname(topo), "_backup", "X-TOPO_antes_blancos.dwg"); mkdirSync(dirname(bk), { recursive: true }); if (!existsSync(bk)) copyFileSync(topo, bk);
  const dest = flag("out") ? resolve(flag("out")) : topo; copyFileSync(copy, dest); console.log(`OK: ${dest}${dest !== topo ? ` (next: xref-reload.ps1 -NewFile "${dest}" -Target "${topo}")` : ""}`);
}
rmSync(work, { recursive: true, force: true });
