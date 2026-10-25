#!/usr/bin/env node
// Moves survey MTEXT/TEXT/INSERT by handle inside a survey xref (insertion point = DXF group 10) to explicit model coordinates: the way to tidy overlapping
// survey notes (neighbour lot descriptions, legal text) that the host cannot edit because they live in the xref. Core Console on a %TEMP% copy; the original is
// backed up once in _backup\X-TOPO_antes_mover_textos.dwg. With --out the original is left alone (xref loaded in an open drawing: then xref-reload.ps1).
//   node topo-move-text.mjs --topo "<...\X-TOPO.dwg>" --set 56FE9C=893484.5,498045.5 --set 56B98B=893485.85,498083 [--out <file>] [--dry-run]
// Tidy rules used for the neighbour lot descriptions (user, 2026-10-25): each note sits CENTRED in its lot (attachment middle-centre / top-centre, centre
// between the two lot lines at that X), notes of one row share the same X so they line up, and a note never overlaps another: a row below starts at
// (row X + half of the tallest note height + ~4 ft). Lot-line Y at a given X: interpolate the LOTLINE LINE endpoints (they are not parallel to the axes).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
const a = process.argv.slice(2); const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const topo = flag("topo") ? resolve(flag("topo")) : (console.error("usage: node topo-move-text.mjs --topo <X-TOPO.dwg> --set <handle>=<x>,<y> [--set ...] [--out f] [--dry-run]"), process.exit(2));
const sets = a.map((v, i) => (a[i - 1] === "--set" ? v : null)).filter(Boolean).map((s) => { const m = /^([0-9A-Fa-f]+)=(-?[\d.]+),(-?[\d.]+)(?:,([1-9]))?$/.exec(s); if (!m) { console.error(`bad --set ${s} (handle=x,y[,attachment 1-9])`); process.exit(2); } return { h: m[1].toUpperCase(), x: Number(m[2]), y: Number(m[3]), att: m[4] ? Number(m[4]) : 0 }; });
if (!sets.length) { console.error("no --set given"); process.exit(2); }
const CORE = flag("core", "C:\\Program Files\\Autodesk\\AutoCAD 2027\\accoreconsole.exe"); const dry = a.includes("--dry-run");
const work = mkdtempSync(join(tmpdir(), "c3d-movetxt-")); const copy = join(work, "X-TOPO.dwg"); copyFileSync(topo, copy);
const lisp = [`(setq m 0)`];
for (const s of sets) lisp.push(`(setq en (handent "${s.h}")) (if en (progn (setq e (entget en) o (assoc 10 e)) (princ (strcat (chr 10) "MOVE ${s.h} from " (rtos (cadr o) 2 2) "," (rtos (caddr o) 2 2) " to ${s.x},${s.y}"))${dry ? "" : ` (entmod (subst (list 10 ${s.x} ${s.y} (if (cadddr o) (cadddr o) 0.0)) o e))${s.att ? ` (setq e (entget en)) (entmod (subst (cons 71 ${s.att}) (assoc 71 e) e))` : ""}`} (setq m (1+ m))) (princ (strcat (chr 10) "MOVE ${s.h} NOT FOUND")))`);
lisp.push(`(princ (strcat (chr 10) "MOVED " (itoa m)))`, ...(dry ? ["QUIT"] : ["_.QSAVE", "QUIT", "Y"]));
writeFileSync(join(work, "s.scr"), lisp.join("\n") + "\n", "ascii");
const r = spawnSync(CORE, ["/i", copy, "/s", join(work, "s.scr"), "/l", "en-US"], { timeout: 180000, windowsHide: true, encoding: "latin1" });
const txt = `${r.stdout}`.replace(/\0/g, ""); const mm = /MOVED (\d+)/.exec(txt);
console.log(txt.split("\n").map((l) => l.trim()).filter((l) => /^MOVE /.test(l)).join("\n"));
if (!mm) { console.error(`failed: no result line (${work})`); process.exit(1); }
if (Number(mm[1]) !== sets.length) { console.error(`only ${mm[1]} of ${sets.length} handles found: nothing written`); process.exit(1); }
if (!dry) {
  const bk = join(dirname(topo), "_backup", "X-TOPO_antes_mover_textos.dwg"); mkdirSync(dirname(bk), { recursive: true }); if (!existsSync(bk)) copyFileSync(topo, bk);
  const dest = flag("out") ? resolve(flag("out")) : topo; copyFileSync(copy, dest); console.log(`OK: ${dest}${dest !== topo ? ` (next: xref-reload.ps1 -NewFile "${dest}" -Target "${topo}" -Freeze "X-TOPO|HIDE-PAVEMENT-LABELS")` : ""}`);
}
rmSync(work, { recursive: true, force: true });
