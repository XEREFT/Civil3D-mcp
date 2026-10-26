#!/usr/bin/env node
// Makes the survey's own "R/W" marks (the MTEXT "R/W" + the LEADER arrow that points at the right-of-way line) WHITE in a survey xref (X-TOPO.dwg).
// User rule 2026-10-26 (SEIDENSTEIN): R/W marks print white like the labels we add; the xref layer override keeps everything else on the layer gray, so the colour
// is set explicitly (62 = 7) on the text and on the leaders whose end point is inside the text box (+MARGIN ft). Colour only: no layer, geometry or text change.
//   node topo-white-rw.mjs --topo "<...\X-TOPO.dwg>" [--out <file>] [--margin 1.6] [--dry-run] [--hide]
// --hide: instead of recolouring, move those texts and arrows to the frozen layer HIDE-PAVEMENT-LABELS (user 2026-10-26: the sheet carries our own evenly spaced R/W marks,
//         c300-rw-marks.mjs, so the survey's irregular ones go; nothing is erased, backup X-TOPO_antes_ocultar_rw.dwg)
// Same pairing logic as topo-hide-pavement-labels.mjs. Works on a %TEMP% copy with the Core Console, backs the original up once (_backup\X-TOPO_antes_rw_blanco.dwg);
// with --out the original is left alone (xref loaded in an open drawing: then xref-reload.ps1 -NewFile <out> -Target <topo>).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const topo = flag("topo") ? resolve(flag("topo")) : die('usage: node topo-white-rw.mjs --topo "<...\\X-TOPO.dwg>" [--out f] [--dry-run]');
if (!existsSync(topo)) die(`not found: ${topo}`);
const MARGIN = Number(flag("margin", "1.6"));
const CORE = flag("core", "C:\\Program Files\\Autodesk\\AutoCAD 2027\\accoreconsole.exe");
const work = mkdtempSync(join(tmpdir(), "c3d-whiterw-"));
const copy = join(work, "X-TOPO.dwg"); copyFileSync(topo, copy);
const fwd = (p) => p.replace(/\\/g, "/");
const core = (scr, log) => {
  writeFileSync(join(work, "s.scr"), scr.join("\n") + "\n", "ascii");
  const r = spawnSync(CORE, ["/i", copy, "/s", join(work, "s.scr"), "/l", "en-US"], { timeout: 180000, windowsHide: true, encoding: "latin1" });
  writeFileSync(join(work, log), `${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (r.error) die(`Core Console failed: ${r.error.message}`);
  return `${r.stdout ?? ""}`.replace(/\0/g, "");
};

// ---- 1. dump every MTEXT (frame data) and every LEADER (vertices) ----
const dump = join(work, "dump.txt");
core([
  '(defun g (e k) (cdr (assoc k e)))',
  `(setq f (open "${fwd(dump)}" "w"))`,
  '(setq ss (ssget "_X" (list (cons 410 "Model") (cons 0 "MTEXT"))) n 0)',
  '(if ss (repeat (sslength ss) (setq e (entget (ssname ss n))) (write-line (strcat (g e 5) "|M|" (g e 8) "|" (rtos (car (g e 10)) 2 4) "|" (rtos (cadr (g e 10)) 2 4) "|" (rtos (car (g e 11)) 2 5) "|" (rtos (cadr (g e 11)) 2 5) "|" (rtos (g e 42) 2 3) "|" (rtos (g e 43) 2 3) "|" (itoa (g e 71)) "|" (g e 1)) f) (setq n (1+ n))))',
  '(setq ss (ssget "_X" (list (cons 0 "LEADER"))) n 0)',
  '(if ss (repeat (sslength ss) (setq e (entget (ssname ss n)) s "") (foreach p e (if (= (car p) 10) (setq s (strcat s (rtos (cadr p) 2 3) "," (rtos (caddr p) 2 3) ";")))) (write-line (strcat (g e 5) "|L|" (g e 8) "|" s) f) (setq n (1+ n))))',
  '(close f)', "QUIT", "Y"], "dump.log");
if (!existsSync(dump)) die(`dump failed (no file): see ${join(work, "dump.log")}`);

const clean = (t) => t.replace(/\\[A-Za-z][^;]*;/g, "").replace(/\\P/g, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const texts = [], leaders = [];
for (const l of readFileSync(dump, "latin1").split(/\r?\n/)) {
  if (!l) continue;
  const p = l.split("|");
  if (p[1] === "L") { leaders.push({ h: p[0], pts: p[3].split(";").filter(Boolean).map((s) => s.split(",").map(Number)) }); continue; }
  const [h, , lay, x, y, dx, dy, w, hh, att] = p; const raw = p.slice(10).join("|");
  if (clean(raw) !== "R/W") continue;
  const o = { h, lay, x: +x, y: +y, dx: +dx, dy: +dy, w: +w || 6, hh: +hh || 2.4, att: +att || 1 };
  const nx = o.dy, ny = -o.dx, ux = [0, .5, 1][(o.att - 1) % 3], vy = [0, .5, 1][Math.floor((o.att - 1) / 3)];
  o.ox = o.x - o.dx * ux * o.w - nx * vy * o.hh; o.oy = o.y - o.dy * ux * o.w - ny * vy * o.hh; o.nx = nx; o.ny = ny; texts.push(o);
}
const inBox = (o) => ([px, py]) => { const u = (px - o.ox) * o.dx + (py - o.oy) * o.dy, v = (px - o.ox) * o.nx + (py - o.oy) * o.ny; return u >= -MARGIN && u <= o.w + MARGIN && v >= -MARGIN && v <= o.hh + MARGIN; };
const lead = leaders.filter((ld) => texts.some((t) => [ld.pts[0], ld.pts.at(-1)].filter(Boolean).some(inBox(t))));
console.log(`R/W texts: ${texts.length}, arrows paired: ${lead.length}`);
if (has("dry-run") || !texts.length) { rmSync(work, { recursive: true, force: true }); console.log(has("dry-run") ? "DRY RUN: nothing changed" : "nothing to do"); process.exit(0); }

// ---- 2. colour 7 on those entities ----
const hs = [...texts.map((t) => t.h), ...lead.map((l) => l.h)].map((h) => `"${h}"`).join(" ");
const HIDE = has("hide");
const out = core([
  ...(HIDE ? ['(if (not (tblsearch "LAYER" "HIDE-PAVEMENT-LABELS")) (command "_.-LAYER" "_N" "HIDE-PAVEMENT-LABELS" "_C" "8" "HIDE-PAVEMENT-LABELS" ""))'] : []),
  `(setq k 0) (foreach h (list ${hs}) (setq en (handent h)) (if en (progn (setq e (entget en)) (entmod ${HIDE ? '(subst (cons 8 "HIDE-PAVEMENT-LABELS") (assoc 8 e) e)' : '(if (assoc 62 e) (subst (cons 62 7) (assoc 62 e) e) (append e (list (cons 62 7))))'}) (setq k (1+ k)))))`,
  '(princ (strcat "\\nWHITE " (itoa k)))', "_.QSAVE", "QUIT", "Y"], "apply.log");
const m = /WHITE (\d+)/.exec(out); if (!m) die(`apply failed: see ${join(work, "apply.log")}`);
const bk = join(dirname(topo), "_backup", HIDE ? "X-TOPO_antes_ocultar_rw.dwg" : "X-TOPO_antes_rw_blanco.dwg"); mkdirSync(dirname(bk), { recursive: true });
if (!existsSync(bk)) copyFileSync(topo, bk);
const dest = flag("out") ? resolve(flag("out")) : topo;
copyFileSync(copy, dest); rmSync(work, { recursive: true, force: true });
console.log(`OK: ${m[1]} entities updated in ${dest}${dest !== topo ? ` (next: xref-reload.ps1 -NewFile "${dest}" -Target "${topo}")` : ""}`);
