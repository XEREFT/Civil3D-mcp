#!/usr/bin/env node
// FASE 1 FINISH (never touches the live drawing): the whole "after save" tail of a Fase 1 delivery in ONE command.
//   node fase1-finish.mjs [--dwg "<...\<NAME> FASE 1.dwg>"] [--layouts C-300] [--pdf-name "C-300 FASE 1.pdf"] [--no-copy]
// 1. resolves the DWG (default: the ACTIVE document in Civil 3D) — SAVE IT FIRST (the plot/dump read the saved file)
// 2. dwg-dump.ps1 of the saved file -> fase1-audit.mjs --dump   (layers/xrefs; FAIL if C-TINN-BNDY is not frozen, PROP, networks, style…)
// 3. qc-plot.ps1 -Layouts <layouts> on a %TEMP% copy (Core Console; never on the OneDrive path)
// 4. PDF checks with pymupdf: 0 words < 5 pt, no PROP/PROPOSED words (SUBJECT PROPERTY is fine), page is not blank
// 5. copies the PDF to <dwg folder>\_QC\<pdf-name>; an existing PDF is MOVED to _QC\_prev\<name>_<timestamp>.pdf (never deleted)
// Exit 1 if the audit FAILs or the PDF checks fail (the PDF is then NOT copied). Prints a READY / NOT READY verdict.
import { existsSync, mkdirSync, copyFileSync, renameSync, statSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const here = dirname(fileURLToPath(import.meta.url));
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp").replace(/\\/g, "/");
const layouts = (flag("layouts") ?? "C-300").split(",").map((s) => s.trim()).filter(Boolean);
const log = (m) => console.log(m);
let bad = 0;
const verdict = (level, what, detail = "") => { if (level === "FAIL") bad++; log(`${level.padEnd(4)} ${what}${detail ? "  —  " + detail : ""}`); };

// 1. DWG
let dwg = flag("dwg");
if (!dwg) {
  const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
  try {
    const docs = await withApplicationConnection((c) => c.sendCommand("listOpenDocuments", {}));
    dwg = (docs.documents ?? []).find((d) => d.isActive)?.filePath;
  } catch (e) { verdict("FAIL", "active document", `plugin not reachable (${String(e.message).split("\n")[0]}); pass --dwg`); process.exit(1); }
}
if (!dwg || !existsSync(dwg)) { verdict("FAIL", "dwg", `not found: ${dwg}`); process.exit(1); }
const ageMin = Math.round((Date.now() - statSync(dwg).mtimeMs) / 60000);
verdict(ageMin > 360 ? "WARN" : "OK", "dwg", `${basename(dwg)} (saved ${ageMin} min ago — Civil 3D's unsavedChanges flag is unreliable, so make sure you saved after the last edit)`);
if (!/FASE 1/i.test(basename(dwg))) verdict("WARN", "name", "file name does not contain 'FASE 1'; continuing anyway");

const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { encoding: "utf8", timeout: 600000, ...opts });
const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "1"]).status === 0 ? "pwsh" : "powershell";

// 2. dump + audit
const d = run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "dwg-dump.ps1"), dwg]);
const dumpPath = (d.stdout ?? "").trim().split("\n").pop()?.trim();
if (!dumpPath || !existsSync(dumpPath)) verdict("FAIL", "dwg-dump", (d.stderr || d.stdout || "no output").slice(0, 300));
else {
  const a = run("node", [join(here, "fase1-audit.mjs"), "--dump", dumpPath, "--repo", repo]);
  const lines = (a.stdout ?? "").split("\n").filter((l) => /^(FAIL|WARN|OK|FASE 1)/.test(l));
  for (const l of lines.filter((x) => /^(FAIL|WARN)/.test(x))) log(l);
  verdict(a.status === 0 ? "OK" : "FAIL", "fase1-audit", a.status === 0 ? `${lines.filter((l) => l.startsWith("OK")).length} checks OK` : "see FAIL lines above (fix, save, run again)");
}

// 3. plot
const tag = `fin${Date.now().toString(36)}`;
const p = run(pwsh, ["-NoProfile", "-File", join(here, "qc-plot.ps1"), "-Dwg", dwg, "-Layouts", layouts.join(","), "-Tag", tag]);
const pdfLines = (p.stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => /\.pdf/i.test(l));
const results = [];
for (const layout of layouts) {
  const line = pdfLines.find((l) => l.toLowerCase().includes(layout.replace(/-/g, "").toLowerCase() + ".pdf"));
  const pdf = line?.split(/\s{2,}/)[0];
  if (!pdf || /^MISSING/.test(line) || !existsSync(pdf)) { verdict("FAIL", `plot ${layout}`, (line ?? p.stdout ?? p.stderr ?? "no output").slice(0, 300)); continue; }
  // 4. PDF checks
  const py = run("python", ["-c", `
import sys, re, json, pymupdf
d = pymupdf.open(sys.argv[1]); words = d[0].get_text("words")
tiny = 0
for b in d[0].get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        for s in l["spans"]:
            if s["text"].strip() and s["size"] < 5: tiny += 1
txt = d[0].get_text()
prop = [l for l in txt.splitlines() if re.search(r"\\bPROP\\b|\\bPROPOSED\\b", l, re.I)]
print(json.dumps({"n": len(words), "tiny": tiny, "prop": prop}))
`, pdf], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (py.status !== 0) { verdict("FAIL", `pdf ${layout}`, (py.stderr || "python/pymupdf failed").slice(-200)); continue; }
  const { n, tiny, prop } = JSON.parse(py.stdout.trim().split("\n").pop());
  verdict(Number(n) < 50 ? "FAIL" : "OK", `pdf ${layout} words`, `${n} words${Number(n) < 50 ? " — looks BLANK (sheet viewport lost? see c300 §9.8)" : ""}`);
  verdict(Number(tiny) > 0 ? "FAIL" : "OK", `pdf ${layout} tiny text`, `${tiny} spans < 5 pt`);
  verdict(prop.length ? "FAIL" : "OK", `pdf ${layout} PROP/PROPOSED`, prop.length ? prop.join(" | ").slice(0, 200) : "none");
  results.push({ layout, pdf });
}

// 5. copy to _QC (keep the previous one)
if (!has("no-copy") && !bad && results.length) {
  const qc = join(dirname(dwg), "_QC");
  mkdirSync(join(qc, "_prev"), { recursive: true });
  for (const { layout, pdf } of results) {
    const name = layouts.length === 1 && flag("pdf-name") ? flag("pdf-name") : `${layout} FASE 1.pdf`;
    const dest = join(qc, name);
    if (existsSync(dest)) {
      const stamp = new Date(statSync(dest).mtimeMs).toISOString().replace(/[-:T]/g, "").slice(0, 12);
      renameSync(dest, join(qc, "_prev", name.replace(/\.pdf$/i, `_${stamp}.pdf`)));
    }
    copyFileSync(pdf, dest);
    verdict("OK", "delivered", dest);
  }
} else if (!has("no-copy")) log("SKIP copy to _QC (fix the FAIL lines first)");

log(bad ? `\nNOT READY: ${bad} FAIL` : has("no-copy") ? "\nREADY (dry run: nothing copied to _QC)" : "\nREADY: Fase 1 delivered (dwg saved + audit 0 FAIL + PDF clean in _QC). Now update memory (status file) and the paste-ready prompt.");
process.exit(bad ? 1 : 0);
