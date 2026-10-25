#!/usr/bin/env node
// Hides survey symbol BLOCKS (moves their INSERTs to the frozen hidden layer) in a survey xref. For blocks whose content carries its own fixed colour,
// so no layer colour override can tame them (FormTech: `ARR-L` = the curved red arrow pointing at a lot corner; it holds a nested block `ARROW` with
// arcs on layer "1", colour 1 by entity). They are the pointers of the lot-corner ANGLE notes (profile `hideXrefText` already hides those notes), so
// without them they are red arrows pointing at a circle with no label. User rule 2026-10-25: arrows with no label are hidden; nothing is erased.
//   node topo-hide-blocks.mjs --topo "<...\X-TOPO.dwg>" [--blocks ARR-L] [--layer HIDE-PAVEMENT-LABELS] [--out <file>] [--dry-run]
// Core Console on a %TEMP% copy, original backed up once in _backup\X-TOPO_antes_ocultar_bloques.dwg; with --out the original is left alone (xref
// loaded in an open drawing: then xref-reload.ps1 -Freeze "X-TOPO|<layer>").
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
const a = process.argv.slice(2); const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const topo = flag("topo") ? resolve(flag("topo")) : (console.error("usage: node topo-hide-blocks.mjs --topo <X-TOPO.dwg> [--blocks ARR-L] [--layer HIDE-PAVEMENT-LABELS] [--out f] [--dry-run]"), process.exit(2));
const blocks = flag("blocks", "ARR-L").split(",").map((s) => s.trim()).filter(Boolean);
const layer = flag("layer", "HIDE-PAVEMENT-LABELS");
const CORE = flag("core", "C:\\Program Files\\Autodesk\\AutoCAD 2027\\accoreconsole.exe");
const dry = a.includes("--dry-run");
const work = mkdtempSync(join(tmpdir(), "c3d-hideblk-")); const copy = join(work, "X-TOPO.dwg"); copyFileSync(topo, copy);
const names = blocks.map((b) => `"${b.toUpperCase()}"`).join(" ");
const lisp = [
  `(if (null (tblsearch "LAYER" "${layer}")) (command "_.-LAYER" "_M" "${layer}" ""))`,
  `(setq ss (ssget "_X" (list (cons 410 "Model") (cons 0 "INSERT"))) n 0 m 0)`,
  `(if ss (repeat (sslength ss) (setq e (entget (ssname ss n))) (if (and (member (strcase (cdr (assoc 2 e))) (list ${names})) (/= (cdr (assoc 8 e)) "${layer}")) (progn (setq m (1+ m))${dry ? "" : ` (entmod (subst (cons 8 "${layer}") (assoc 8 e) e))`})) (setq n (1+ n))))`,
  `(princ (strcat (chr 10) "HIDEBLK " (itoa m)))`, ...(dry ? ["QUIT"] : ["_.QSAVE", "QUIT", "Y"])];
writeFileSync(join(work, "s.scr"), lisp.join("\n") + "\n", "ascii");
const r = spawnSync(CORE, ["/i", copy, "/s", join(work, "s.scr"), "/l", "en-US"], { timeout: 180000, windowsHide: true, encoding: "latin1" });
const m = /HIDEBLK (\d+)/.exec(`${r.stdout}`.replace(/\0/g, "")); if (!m) { console.error(`failed: no result line (${work})`); process.exit(1); }
console.log(`inserts of ${blocks.join(",")} moved to ${layer}: ${m[1]}${dry ? " (dry run)" : ""}`);
if (!dry && Number(m[1])) {
  const bk = join(dirname(topo), "_backup", "X-TOPO_antes_ocultar_bloques.dwg"); mkdirSync(dirname(bk), { recursive: true }); if (!existsSync(bk)) copyFileSync(topo, bk);
  const dest = flag("out") ? resolve(flag("out")) : topo; copyFileSync(copy, dest); console.log(`OK: ${dest}${dest !== topo ? ` (next: xref-reload.ps1 -NewFile "${dest}" -Target "${topo}" -Freeze "X-TOPO|${layer}")` : ""}`);
}
rmSync(work, { recursive: true, force: true });
