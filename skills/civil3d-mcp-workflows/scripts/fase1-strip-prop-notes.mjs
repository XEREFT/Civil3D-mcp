#!/usr/bin/env node
// Removes from the C-300 "MD-WASD NOTES" MText every bullet / block whose text says PROP or PROPOSED (Fase 1 = existing conditions only,
// user 2026-09-28). Pure text transform on the RAW MText (as returned by acad_list_text_entities): it does NOT touch the drawing.
// Claude then writes the result back with acad_update_text_content { handle, text } (real TAB characters, exact backslashes).
//
//   node fase1-strip-prop-notes.mjs --in raw.txt --out new.txt      (raw.txt = the `text` field of the MD-WASD notes MText, saved as UTF-8)
//
// Structure it understands (the firm's C-300 template): head + bullets separated by "\P\pi0,l0,tz;\P\pi-3,l3,t3;" + the block
// "THE FOLLOWING ACTIVITIES ON EXISTING WATER SERVICES…" + "PROJECT SPECIFIC NOTES". Bullets that say PROP/PROPOSED are dropped; the
// "THE FOLLOWING ACTIVITIES" block is dropped as a whole when its closing sentence says PROPOSED ("…FOR PROPOSED ACTIVITY"), because
// its header and list have no predicate without it. Any other structure -> exit 2 and nothing written (edit by hand).
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const inPath = flag("in"), outPath = flag("out");
if (!inPath || !outPath) { console.error("usage: node fase1-strip-prop-notes.mjs --in raw.txt --out new.txt"); process.exit(2); }

const raw = readFileSync(inPath, "utf8");
const BS = "\\";
const bulletSep = BS + "P" + BS + "pi0,l0,tz;";           // \P\pi0,l0,tz;
const bulletOpen = BS + "P" + BS + "pi-3,l3,t3;";          // \P\pi-3,l3,t3;
const SEP_RE = /\\P\\pi0,l0,tz;\s*\\P\\pi-3,l3,t3;/;
const FOLLOWING = BS + "P" + BS + "pi0,l0,tz;" + BS + "P" + BS + "fArial|b1|i0|c0|p34;" + BS + "H1.4x;" + BS + "LTHE FOLLOWING ACTIVITIES";
const SPECIFIC = BS + "P" + BS + "P" + BS + "P" + BS + "fArial|b1|i0|c0|p34;" + BS + "H1.39998x;" + BS + "LPROJECT SPECIFIC NOTES";
const plain = (t) => String(t).replace(/\\P/g, " ").replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
const isProp = (t) => /\bPROP\b|\bPROPOSED\b/i.test(plain(t));

const headMark = raw.indexOf(bulletOpen);
const secEnd = raw.indexOf(FOLLOWING);
const specificAt = raw.indexOf(SPECIFIC);
if (headMark < 0 || secEnd < 0 || specificAt < 0 || !(headMark < secEnd && secEnd < specificAt)) {
  console.error("Unrecognized MText structure (expected head, bullets, 'THE FOLLOWING ACTIVITIES', 'PROJECT SPECIFIC NOTES'). Nothing written; edit by hand.");
  process.exit(2);
}

const head = raw.slice(0, headMark + bulletOpen.length);
const bulletsRaw = raw.slice(headMark + bulletOpen.length, secEnd);
const block = raw.slice(secEnd, specificAt);
const tail = raw.slice(specificAt);

const items = bulletsRaw.split(SEP_RE);
const removed = [];
const kept = items.filter((it) => { if (isProp(it)) { removed.push(plain(it)); return false; } return true; });
let out = head + kept.join(bulletSep + bulletOpen);
if (isProp(block)) { removed.push("[block] " + plain(block).slice(0, 110) + "…"); } else { out += block; }
out += tail;

if (isProp(out)) { console.error("Still contains PROP/PROPOSED after the transform (unexpected place):", plain(out).match(/.{0,40}\bPROP(OSED)?\b.{0,40}/i)?.[0]); process.exit(2); }
writeFileSync(outPath, out);
console.log(`kept ${kept.length}/${items.length} bullets; removed ${removed.length} item(s):`);
removed.forEach((r) => console.log(" - " + r.slice(0, 140)));
console.log(`chars ${raw.length} -> ${out.length}; written to ${outPath}`);
