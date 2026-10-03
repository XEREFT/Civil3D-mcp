#!/usr/bin/env node
// AS-BUILT: add a pipe callout that was READ FROM THE SCAN CROP (asbuilt-find-callouts.py) to the project's review data, and size the water main from it.
//   node asbuilt-add-callout.mjs --dir <project> --scan <ref e.g. E11826-1> --text "419' 8\" DIP WM" --box x,y,w,h --by "<who authorised reading it>" [--kind PIPE] [--dry-run]
// (born 2026-10-02, Goulds 33809: E11826-1's two "8\" DIP WM" callouts were lost by the first OCR pass; doing this by hand took 4 edits)
// 1. appends the line to <dir>\_reports\scan\<ref>.assoc.json items (kind PIPE, note "read from the scan crop")           [backup: _asbuilts\_prev\]
// 2. appends {scan,item,kind,note} + a `confirmed` line to <dir>\_asbuilts\asbuilt.confirmed.json (--by is REQUIRED: it is the audit trail of whose order it was)
// 3. if the text is a water-main callout (N" DIP|PVC|CI|AC ... WM) and <dir>\asbuilt.json exists: every water main whose text is still the generic
//    'EXIST WATER MAIN' becomes `EXIST N" MAT WATER MAIN` and waterRef is set. Sewer callouts are NOT auto-assigned (they need a tramo: use the review page).
// Rules kept: values come only from as-builts; nothing is invented; the decision stays visible in `confirmed` + `notConfirmed` of the JSON.
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (m) => { console.error(m); process.exit(2); };
const dir = flag("dir") ? resolve(flag("dir")) : die('usage: node asbuilt-add-callout.mjs --dir <project> --scan <ref> --text "<callout>" --box x,y,w,h --by "<who authorised>"');
const ref = flag("scan") ?? die("--scan <ref> (e.g. E11826-1)");
const text = flag("text") ?? die("--text is required (what the crop says)");
const by = flag("by") ?? die("--by is required: who authorised reading the callout (it is written into asbuilt.confirmed.json)");
const [bx, by_, bw, bh] = (flag("box") ?? "0,0,0,0").split(",").map(Number);
const kind = flag("kind") ?? "PIPE";
const dry = args.includes("--dry-run");

const assocPath = join(dir, "_reports", "scan", `${ref}.assoc.json`);
const confPath = join(dir, "_asbuilts", "asbuilt.confirmed.json");
const abPath = join(dir, "asbuilt.json");
if (!existsSync(assocPath)) die(`${assocPath} not found`);
if (!existsSync(confPath)) die(`${confPath} not found (confirm the review first)`);
const assoc = JSON.parse(readFileSync(assocPath, "utf8"));
const conf = JSON.parse(readFileSync(confPath, "utf8"));

const existing = assoc.items.findIndex((it) => (it.text ?? "") === text);
const idx = existing >= 0 ? existing : assoc.items.length;
const note = `read from the scan crop (first-pass OCR lost it) — ${by}`;
if (existing < 0) assoc.items.push({ kind, text, sta: null, baseline: null, offset: null, side: null, N: null, E: null, rim: null, inv: [], pipe: null, slope: null, box: { x: bx, y: by_, w: bw, h: bh }, issues: [], note });
const already = conf.items.some((c) => c.scan === `${ref}.tif` && c.item === idx);
if (!already) {
  conf.items.push({ scan: `${ref}.tif`, item: idx, kind, note });
  (conf.confirmed ??= []).push(`callout "${text}" (${ref}) read from the scan; ${by}`);
}

const wm = /(\d{1,2})\s*["”]\s*(DIP|PVC|C\.?I\.?|AC)\b[^|]*W\.?M/i.exec(text);
let ab = null, changed = 0;
if (wm && existsSync(abPath)) {
  ab = JSON.parse(readFileSync(abPath, "utf8"));
  const label = `EXIST ${wm[1]}" ${wm[2].toUpperCase().replace(/\./g, "")} WATER MAIN`;
  for (const w of ab.waterMains ?? []) if (/^EXIST WATER MAIN$/i.test(w.text ?? "")) { w.text = label; changed++; }
  if (changed && !ab.waterRef) ab.waterRef = ref;
}
console.log(`${existing < 0 ? "added" : "found"} assoc item ${idx} of ${ref}: ${text}\n${already ? "already in" : "added to"} asbuilt.confirmed.json\n` + (wm ? `water main callout -> ${changed} generic water main(s) relabeled in asbuilt.json` : "not a water-main callout: asbuilt.json untouched (assign sewer tramos in the review page)"));
if (dry) { console.log("DRY RUN: nothing written"); process.exit(0); }
const prev = join(dir, "_asbuilts", "_prev"); mkdirSync(prev, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const f of [assocPath, confPath, ...(ab ? [abPath] : [])]) copyFileSync(f, join(prev, `${stamp}_${f.split(/[\\/]/).pop()}`));
writeFileSync(assocPath, JSON.stringify(assoc, null, 1)); writeFileSync(confPath, JSON.stringify(conf, null, 1));
if (ab) writeFileSync(abPath, JSON.stringify(ab, null, 2));
console.log(`written (backups in ${prev}). Next: rebuild the sheet (fase1-from-scratch.mjs into a NEW name) and, if READY, fase1-redeliver.mjs.`);
