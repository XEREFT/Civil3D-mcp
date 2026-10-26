#!/usr/bin/env node
// Re-plots the C-300 of a BASE folder's saved working DWG (monochrome, Core Console on a %TEMP% copy) and overwrites "<folder name>.pdf" next to it: run it
// after ANY edit of the BASE DWG (the PDF must never be older than the DWG; package-base.mjs warns otherwise). Save the drawing in Civil 3D first.
//   node base-pdf-refresh.mjs --dir "<...\<Name> @xereft base>" [--layout C-300]
import { copyFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (m) => { console.error(m); process.exit(2); };
const here = dirname(fileURLToPath(import.meta.url));
const dir = flag("dir") ? resolve(flag("dir")) : die('usage: node base-pdf-refresh.mjs --dir "<...\\<Name> @xereft base>" [--layout C-300]');
const stem = basename(dir), layout = flag("layout") ?? "C-300";
const dwg = join(dir, `${stem}.dwg`);
if (!existsSync(dwg)) die(`working DWG not found: ${dwg}`);
const tag = `base-${stem.replace(/[^\w\-]/g, "_")}`;
const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "qc-plot.ps1"), "-Dwg", dwg, "-Layouts", layout, "-Tag", tag], { encoding: "utf8", timeout: 600000 });
const pdf = join(tmpdir(), "c3d-dwg-dump", "plot", tag, `${layout.replace(/-/g, "").toLowerCase()}.pdf`);
if (r.status !== 0 || !existsSync(pdf)) die(`plot failed: ${((r.stdout ?? "") + (r.stderr ?? "")).slice(-400)}`);
copyFileSync(pdf, join(dir, `${stem}.pdf`));
console.log(`PDF refreshed: ${join(dir, `${stem}.pdf`)}`);
