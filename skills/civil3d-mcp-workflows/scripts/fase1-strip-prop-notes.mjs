#!/usr/bin/env node
// Removes from the C-300 "MD-WASD NOTES" MText every bullet / block whose text says PROP or PROPOSED (Fase 1 = existing conditions only,
// user 2026-09-28). Pure text transform on the RAW MText (as returned by acad_list_text_entities): it does NOT touch the drawing.
// Claude then writes the result back with acad_update_text_content { handle, text } (real TAB characters, exact backslashes).
//
//   node fase1-strip-prop-notes.mjs --in raw.txt --out new.txt [--repo C:/Users/camil/OneDrive/Documents/Civil3D-mcp]
//      (raw.txt = the `text` field of the MD-WASD notes MText, saved as UTF-8)
//
// Normally NOT needed any more: civil3d_workflow_fase1_build does this natively (step "Fase 1 notes"), and called with only
// { expectedDocument } it cleans an existing drawing's notes and saves. This script is the manual/offline path.
// The rules live in ONE place, the plugin repo's src/tools/domains/fase1PropNotes.ts (unit-tested against the real template
// text); this script imports its compiled copy from <repo>/build so the two can never drift (integrity-check verifies it).
// Unrecognized structure -> exit 2 and nothing written (edit by hand).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const inPath = flag("in"), outPath = flag("out");
const repo = flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp";
if (!inPath || !outPath) { console.error("usage: node fase1-strip-prop-notes.mjs --in raw.txt --out new.txt [--repo <Civil3D-mcp>]"); process.exit(2); }

const { stripPropNotes } = await import(pathToFileURL(join(repo, "build/tools/domains/fase1PropNotes.js")).href);
const raw = readFileSync(inPath, "utf8");
const result = stripPropNotes(raw);
if (!result.ok) { console.error(`${result.reason}. Nothing written.`); process.exit(2); }
writeFileSync(outPath, result.text);
console.log(`kept ${result.kept}/${result.total} bullets; removed ${result.removed.length} item(s):`);
result.removed.forEach((r) => console.log(" - " + r.slice(0, 140)));
console.log(`chars ${raw.length} -> ${result.text.length}; written to ${outPath}`);
