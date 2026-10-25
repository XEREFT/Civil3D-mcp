#!/usr/bin/env node
// Builds the `acad_create_entities` payload that labels every sanitary manhole of a survey xref from the SURVEY's own callout, in the firm's
// "EXIST. SAN MH" format (Goulds / Villa One): arrow on the manhole symbol, text above it, left-aligned, near-vertical leader.
// Used when there are NO as-builts: the reference line says (PER <surveyor> SURVEY) instead of the as-built number; replace it when as-builts arrive.
//   node topo-san-mh-labels.mjs --topo "<...\X-TOPO.dwg>" [--block SMH] [--ref "(PER FORMTECH SURVEY)"] [--rot 1.5708] [--up -40] [--right 2] [--out labels.json]
// Source data (read-only, Core Console on a %TEMP% copy): INSERTs of the sanitary-manhole block (default SMH: layer NOTES, "S in a circle") and the MTEXT
// callouts "SANITARY SEWER MANHOLE \P RIM ELEV.=9.51' \P 10" PVC PIPE (E) INV. ELEV.=(-)4.19' ..." (layer INVERTS & MANHOLES). Each insert is paired with the
// nearest callout (<= --max 120 ft, one to one). Values are copied verbatim; "(-)4.19'" prints as "-4.19'". Nothing is invented: an insert without callout
// is reported and not labelled.
// Placement is in MODEL coordinates: --up is the model-X offset of the text anchor (paper up = model -X on the C-300 twist, so -40 = 40 ft up), --right the
// model-Y offset (paper right = +Y). Keep --right small (2 ft) so the leader drops almost vertical; a text to the LEFT of the arrow attaches on its right
// side and comes out right-aligned with a slanted leader. --rot is RADIANS (create_entities mleader takes radians: 90 is read as 117 deg and the text
// comes out diagonal); 1.5708 = text reads along model +Y = horizontal on the sheet.
// Output: JSON { entities: [...] } to --out (or stdout). Apply it with acad_create_entities (one approval, exact same parameters, no idempotencyKey).
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const a = process.argv.slice(2); const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const topo = flag("topo") ? resolve(flag("topo")) : (console.error('usage: node topo-san-mh-labels.mjs --topo <X-TOPO.dwg> [--block SMH] [--ref "(PER FORMTECH SURVEY)"] [--rot 1.5708] [--up -40] [--right 2] [--out f]'), process.exit(2));
const block = flag("block", "SMH").toUpperCase(); const ref = flag("ref", "(PER FORMTECH SURVEY)");
const rot = Number(flag("rot", "1.5708")); const up = Number(flag("up", "-40")); const right = Number(flag("right", "2")); const maxD = Number(flag("max", "120"));
const CORE = flag("core", "C:\\Program Files\\Autodesk\\AutoCAD 2027\\accoreconsole.exe");
const work = mkdtempSync(join(tmpdir(), "c3d-sanmh-")); const copy = join(work, "X-TOPO.dwg"); copyFileSync(topo, copy);
const lisp = [
  `(setq ss (ssget "_X" (list (cons 410 "Model") (cons 0 "INSERT"))) n 0)`,
  `(if ss (repeat (sslength ss) (setq e (entget (ssname ss n))) (if (= (strcase (cdr (assoc 2 e))) "${block}") (princ (strcat (chr 10) "SANINS|" (cdr (assoc 5 e)) "|" (rtos (car (cdr (assoc 10 e))) 2 3) "|" (rtos (cadr (cdr (assoc 10 e))) 2 3)))) (setq n (1+ n))))`,
  `(setq ss (ssget "_X" (list (cons 410 "Model") (cons 0 "MTEXT") (cons 1 "*SANITARY SEWER MANHOLE*"))) n 0)`,
  `(if ss (repeat (sslength ss) (setq e (entget (ssname ss n)) tx "") (foreach it e (if (= (car it) 3) (setq tx (strcat tx (cdr it))))) (setq tx (strcat tx (cdr (assoc 1 e)))) (princ (strcat (chr 10) "SANTXT|" (cdr (assoc 5 e)) "|" (rtos (car (cdr (assoc 10 e))) 2 3) "|" (rtos (cadr (cdr (assoc 10 e))) 2 3) "|" tx)) (setq n (1+ n))))`,
  `(princ (strcat (chr 10) "SANDONE"))`, "QUIT", "Y"];
writeFileSync(join(work, "s.scr"), lisp.join("\n") + "\n", "ascii");
const r = spawnSync(CORE, ["/i", copy, "/s", join(work, "s.scr"), "/l", "en-US"], { timeout: 180000, windowsHide: true, encoding: "latin1" });
const out = `${r.stdout}`.replace(/\0/g, "").split("\n").map((l) => l.trim());
rmSync(work, { recursive: true, force: true });
if (!out.some((l) => l.startsWith("SANDONE"))) { console.error("failed: Core Console gave no result"); process.exit(1); }
const ins = out.filter((l) => l.startsWith("SANINS|")).map((l) => { const [, h, x, y] = l.split("|"); return { h, p: [Number(x), Number(y)] }; });
const txt = out.filter((l) => l.startsWith("SANTXT|")).map((l) => { const [, h, x, y, ...t] = l.split("|"); return { h, p: [Number(x), Number(y)], raw: t.join("|") }; });
const clean = (s) => s.replace(/\\[pP]/g, "\n").replace(/\\[pxqlc]+[^;]*;/gi, "").replace(/\\[A-Za-z][^;]*;/g, "").replace(/[{}]/g, "").split("\n").map((s) => s.trim()).filter(Boolean);
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const pairs = []; const usedT = new Set();
for (const m of [...ins].sort((x, y) => x.p[1] - y.p[1])) {
  const c = txt.filter((t) => !usedT.has(t.h)).map((t) => ({ t, d: dist(m.p, t.p) })).sort((x, y) => x.d - y.d)[0];
  if (c && c.d <= maxD) { usedT.add(c.t.h); pairs.push({ m, t: c.t, d: c.d }); } else console.error(`WARN: ${block} ${m.h} has no SANITARY SEWER MANHOLE callout within ${maxD} ft: not labelled`);
}
const entities = [];
for (const { m, t, d } of pairs) {
  const lines = clean(t.raw);
  const rim = lines.map((l) => /RIM ELEV\.?\s*=\s*(\(-\))?\s*([\d.]+)/i.exec(l)).find(Boolean);
  const invs = lines.map((l) => /\((N|NE|E|SE|S|SW|W|NW)\)\s*INV\.?\s*ELEV\.?\s*=\s*(\(-\))?\s*([\d.]+)/i.exec(l)).filter(Boolean);
  if (!rim && !invs.length) { console.error(`WARN: callout ${t.h} has no RIM/INV: not labelled`); continue; }
  const text = ["EXIST. SAN MH ", rim ? `RIM: ${rim[1] ? "-" : ""}${rim[2]}'` : null, ...invs.map((v) => `INV: ${v[2] ? "-" : ""}${v[3]}' (${v[1].toUpperCase()})`), ref].filter(Boolean).join("\\P");
  const r4 = (v) => Math.round(v * 1e3) / 1e3;
  entities.push({ kind: "mleader", layer: "C-ANNO", colorIndex: 8, mLeaderStyle: "Formtech-1.0", height: 1.4, rotation: rot, text,
    leaderX: r4(m.p[0]), leaderY: r4(m.p[1]), x: r4(m.p[0] + up), y: r4(m.p[1] + right) });
  console.error(`${block} ${m.h} @ ${m.p.join(",")} <- callout ${t.h} (${d.toFixed(0)} ft): ${text.replace(/\\P/g, " | ")}`);
}
const json = JSON.stringify({ action: "create_entities", entities }, null, 1);
if (flag("out")) { writeFileSync(resolve(flag("out")), json); console.error(`payload: ${resolve(flag("out"))} (${entities.length} labels)`); } else console.log(json);
