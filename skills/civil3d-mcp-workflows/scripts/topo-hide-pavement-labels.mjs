#!/usr/bin/env node
// Hides the survey's pavement/landscape callouts + site-feature callouts (fence, gate, column) (SOD, PAVERS APPROACH / WALK, CONC. WALK, CONCRETE APPROACH, PARKWAY, ASPHALT, ASPHALT APPROACH) AND their arrows
// in a survey xref (X-TOPO.dwg). User rule 2026-10-25 (SEIDENSTEIN): they are visual noise on the Fase 1 sheet. First asked "only the ones on the property side of the
// street, hide everything past the middle of the street" (--mode property), then "hide absolutely all of them" (--mode all, the default).
//
// The survey arrows are loose LEADER entities (no link to the text), so each hidden text is PAIRED with its leaders by geometry: a LEADER end point inside the
// text box (+1.6 ft). A leader that also touches a text we keep is left alone and reported; leaders on the manhole/invert layer are never touched
// (lesson: hiding by text pattern alone removed a manhole name and left floating arrows). Texts and leaders only change LAYER (to HIDE-PAVEMENT-LABELS), nothing is erased.
// The profile (survey-profiles.json hideXrefLayers) freezes that layer, so rebuilds keep it hidden; in an open drawing run xref-reload.ps1 after this.
//
//   node topo-hide-pavement-labels.mjs --topo "<...\X-TOPO.dwg>" [--mode all|property] [--dry-run]
//        property mode keeps the labels with centre X > --keep-x and Y in [--keep-y0, --keep-y1] (SEIDENSTEIN: 893307, 498000..498140 = property side of the street, in front of the lot)
//        [--layer TEXTM] [--new-layer HIDE-PAVEMENT-LABELS] [--leader-skip "INVERTS & MANHOLES"] [--backup-name X-TOPO_antes_ocultar_etiquetas_pavimento_v2.dwg] [--margin 1.6] [--out <file>] [--groups pavement,site]
// Works on a %TEMP% copy with the Core Console, backs the original up in _backup\ first (once), then copies the result over --topo. Close/unload the xref in Civil 3D before (xref-reload.ps1 -Swap does it).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const die = (m) => { console.error(m); process.exit(2); };
const topo = flag("topo") ? resolve(flag("topo")) : die('usage: node topo-hide-pavement-labels.mjs --topo "<...\\X-TOPO.dwg>" [--mode all|property] [--dry-run]');
if (!existsSync(topo)) die(`not found: ${topo}`);
const mode = flag("mode", "all"); if (!["all", "property"].includes(mode)) die("--mode all|property");
const LAYER = flag("layer", "TEXTM"), NEW = flag("new-layer", "HIDE-PAVEMENT-LABELS"), MARGIN = Number(flag("margin", "1.6"));
const SKIP = (flag("leader-skip", "INVERTS & MANHOLES")).split(",").map((s) => s.trim().toUpperCase());
const KEEP = { x: Number(flag("keep-x", "893307")), y0: Number(flag("keep-y0", "498000")), y1: Number(flag("keep-y1", "498140")) };
const CORE = flag("core", "C:\\Program Files\\Autodesk\\AutoCAD 2027\\accoreconsole.exe");
const backupName = flag("backup-name", "X-TOPO_antes_ocultar_etiquetas_pavimento_v2.dwg");

// what is hidden (cleaned, upper-cased text must match exactly; "18' ASPHALT PAVEMENT", "ASPHALT WALKWAY", street names, EOP... are NOT in the list)
// groups: "pavement" = the five classes below; "site" = fence / gate / column callouts (user 2026-10-25: site features that are not used to design the water/sewer
// installations; the yellow architecture and the survey linework stay). Default --groups pavement,site.
const GROUPS = flag("groups", "pavement,site").split(",").map((s) => s.trim());
const CLASSES = [
  ["pavement", "SOD", /^SOD$/],
  ["pavement", "PAVERS", /^(\d+'\s*)?PAVERS?\s+(APPROACH|WALK)$/],
  ["pavement", "CONCRETE", /^(\d+'\s*)?(CONC\.?|CONCRETE)\s+(APPROACH|WALK)$/],
  ["pavement", "PARKWAY", /^(\d+'\s*)?PARKWAY$/],
  ["pavement", "ASPHALT", /^(\d+'\s*)?ASPHALT(\s+APPROACH)?$/],
  ["site", "FENCE-GATE", /^(\d+'\s*)?(METAL |WOOD |CHAIN[- ]LINK |WROUGHT IRON |ALUM(INUM)? )?(GATE|FENCE)$/],
  ["site", "COLUMN", /^[\d.']+X[\d.']+\s+COL(UMN)?(\s*\(TYP\))?$/],
].filter(([g]) => GROUPS.includes(g));
const clean = (t) => t.replace(/\\[A-Za-z][^;]*;/g, "").replace(/\\P/g, " ").replace(/[{}]/g, "").replace(/%%[A-Za-z]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const klass = (t) => CLASSES.find(([, , rx]) => rx.test(clean(t)))?.[1];

const work = mkdtempSync(join(tmpdir(), "c3d-pavlabels-"));
const copy = join(work, "X-TOPO.dwg"); copyFileSync(topo, copy);
const fwd = (p) => p.replace(/\\/g, "/");
const core = (scr, log) => {
  writeFileSync(join(work, "s.scr"), scr.join("\n") + "\n", "ascii");
  const r = spawnSync(CORE, ["/i", copy, "/s", join(work, "s.scr"), "/l", "en-US"], { timeout: 180000, windowsHide: true, encoding: "latin1" });
  writeFileSync(join(work, log), `${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (r.error) die(`Core Console failed: ${r.error.message}`);
  return `${r.stdout ?? ""}`.replace(/\0/g, "");
};

// ---- 1. dump texts (layer LAYER) and every LEADER ----
const dump = join(work, "dump.txt");
core([
  '(defun g (e k) (cdr (assoc k e)))',
  `(setq f (open "${fwd(dump)}" "w"))`,
  `(setq ss (ssget "_X" (list (cons 410 "Model") (cons 8 "${LAYER}") (cons 0 "MTEXT,TEXT"))) n 0)`,
  '(if ss (repeat (sslength ss) (setq e (entget (ssname ss n))) (if (= (g e 0) "MTEXT") (write-line (strcat (g e 5) "|M|" (rtos (car (g e 10)) 2 4) "|" (rtos (cadr (g e 10)) 2 4) "|" (rtos (car (g e 11)) 2 5) "|" (rtos (cadr (g e 11)) 2 5) "|" (rtos (g e 42) 2 3) "|" (rtos (g e 43) 2 3) "|" (itoa (g e 71)) "|" (g e 1)) f) (write-line (strcat (g e 5) "|T|" (rtos (car (g e 10)) 2 4) "|" (rtos (cadr (g e 10)) 2 4) "|" (rtos (cos (g e 50)) 2 5) "|" (rtos (sin (g e 50)) 2 5) "|" (rtos (* 0.8 (g e 40) (strlen (g e 1))) 2 3) "|" (rtos (g e 40) 2 3) "|1|" (g e 1)) f)) (setq n (1+ n))))',
  '(setq ss (ssget "_X" (list (cons 0 "LEADER"))) n 0)',
  '(if ss (repeat (sslength ss) (setq e (entget (ssname ss n)) s "") (foreach p e (if (= (car p) 10) (setq s (strcat s (rtos (cadr p) 2 3) "," (rtos (caddr p) 2 3) ";")))) (write-line (strcat (g e 5) "|L|" (g e 8) "|" s) f) (setq n (1+ n))))',
  '(close f)', "QUIT", "Y"], "dump.log");
if (!existsSync(dump)) die(`dump failed (no file): see ${join(work, "dump.log")}`);

const texts = [], leaders = [];
for (const l of readFileSync(dump, "latin1").split(/\r?\n/)) {
  if (!l) continue;
  const p = l.split("|");
  if (p[1] === "L") { const pts = p[3].split(";").filter(Boolean).map((s) => s.split(",").map(Number)); leaders.push({ h: p[0], layer: p[2], pts }); continue; }
  const [h, t, x, y, dx, dy, w, hh, att] = p; const raw = p.slice(9).join("|");
  const o = { h, x: +x, y: +y, dx: +dx, dy: +dy, w: +w, hh: +hh, att: +att || 1, raw };
  const nx = o.dy, ny = -o.dx;                                   // "down" of the text frame
  const ux = [0, .5, 1][(o.att - 1) % 3], vy = [0, .5, 1][Math.floor((o.att - 1) / 3)];
  o.ox = o.x - o.dx * ux * o.w - nx * vy * o.hh; o.oy = o.y - o.dy * ux * o.w - ny * vy * o.hh;   // top-left corner
  o.nx = nx; o.ny = ny; o.cx = o.ox + o.dx * o.w / 2 + nx * o.hh / 2; o.cy = o.oy + o.dy * o.w / 2 + ny * o.hh / 2;
  o.class = klass(raw); texts.push(o);
}
const inBox = (o, m) => ([px, py]) => { const u = (px - o.ox) * o.dx + (py - o.oy) * o.dy, v = (px - o.ox) * o.nx + (py - o.oy) * o.ny; return u >= -m && u <= o.w + m && v >= -m && v <= o.hh + m; };

// ---- 2. decide ----
const targets = texts.filter((t) => t.class);
const keepNear = (t) => mode === "property" && t.cx > KEEP.x && t.cy >= KEEP.y0 && t.cy <= KEEP.y1;
const hideTexts = targets.filter((t) => !keepNear(t));
const keptTexts = texts.filter((t) => !hideTexts.includes(t));
const hideSet = new Set(hideTexts.map((t) => t.h));
const hideLeaders = [], ambiguous = [];
for (const ld of leaders) {
  if (SKIP.includes(ld.layer.toUpperCase())) continue;
  const ends = [ld.pts[0], ld.pts[ld.pts.length - 1]].filter(Boolean);
  const touchesHidden = hideTexts.some((t) => ends.some(inBox(t, MARGIN)));
  if (!touchesHidden) continue;
  const touchesKept = keptTexts.some((t) => ends.some(inBox(t, MARGIN)));
  (touchesKept ? ambiguous : hideLeaders).push(ld);
}
const byClass = {}; for (const t of hideTexts) byClass[t.class] = (byClass[t.class] ?? 0) + 1;
console.log(`mode=${mode}  texts on ${LAYER}: ${texts.length}  matching classes: ${targets.length}  hide: ${hideTexts.length} ${JSON.stringify(byClass)}  keep (matching, near property): ${targets.length - hideTexts.length}`);
console.log(`leaders: ${leaders.length} total, hide ${hideLeaders.length}${ambiguous.length ? `, AMBIGUOUS (touch a kept text, not hidden): ${ambiguous.map((l) => l.h).join(" ")}` : ""}`);
if (has("dry-run") || (!hideTexts.length && !hideLeaders.length)) { rmSync(work, { recursive: true, force: true }); console.log(has("dry-run") ? "DRY RUN: nothing changed" : "nothing to hide"); process.exit(0); }

// ---- 3. apply (layer change only) on the temp copy, then back up + copy over ----
const hs = [...hideSet, ...hideLeaders.map((l) => l.h)].map((h) => `"${h}"`).join(" ");
const out = core([
  `(if (not (tblsearch "LAYER" "${NEW}")) (command "_.-LAYER" "_N" "${NEW}" "_C" "8" "${NEW}" ""))`,
  `(setq k 0) (foreach h (list ${hs}) (setq en (handent h)) (if en (progn (setq e (entget en)) (entmod (subst (cons 8 "${NEW}") (assoc 8 e) e)) (setq k (1+ k)))))`,
  '(princ (strcat "\\nHIDDEN " (itoa k)))', "_.QSAVE", "QUIT", "Y"], "apply.log");
const m = /HIDDEN (\d+)/.exec(out); if (!m) die(`apply failed: see ${join(work, "apply.log")}`);
const bk = join(dirname(topo), "_backup", backupName); mkdirSync(dirname(bk), { recursive: true });
if (!existsSync(bk)) copyFileSync(topo, bk);
const dest = flag("out") ? resolve(flag("out")) : topo;   // --out: leave --topo untouched (it is loaded as an xref in an open drawing) and write the result here; then xref-reload.ps1 -NewFile <out> -Target <topo>
copyFileSync(copy, dest); rmSync(work, { recursive: true, force: true });
console.log(dest !== topo ? `OK: result written to ${dest} (original ${topo} untouched, backup ${bk}). Next: xref-reload.ps1 -NewFile "${dest}" -Target "${topo}"` : `OK: ${m[1]} entities moved to layer ${NEW} in ${topo} (original kept as ${bk}). Freeze X-TOPO|${NEW} in the drawing (profile hideXrefLayers does it on rebuild; open drawing: xref-reload.ps1).`);
