#!/usr/bin/env node
// INTEGRITY CHECK (READ-ONLY on the user's drawings): the "second brain" test-runner. Runs the known-bugs registry
// (references/standards/known-bugs.json) plus generic consistency checks, and prints OK / WARN / FAIL / SKIP per line.
//   node integrity-check.mjs [--only deploy,docs,agents,memory,bugs,live] [--skip-live] [--offline] [--with-tests] [--json] [--brief]
//                            [--repo C:/Users/camil/OneDrive/Documents/Civil3D-mcp]
// Groups:
//   deploy  repo build fresh? build == installed extension server/ (layer 2)? ProgramData DLL == bin/Release, has every dispatcher
//           method (layer 1)? Claude Desktop / Civil 3D started after their layer was updated (layer 3)?
//   projects project.json of every project under the AUTOCAD @XEREFT root valid; latest fase1-batch report not older than 8 days
//   docs    plugin tools added by our commits are in tool-index.md; tool-index headings still exist in src; troubleshooting.md rows
//           <-> registry entries (both ways); every references/… scripts/… path named in SKILL.md exists.
//   agents  repo .claude/agents == skill subagents-backup; skill folder == fork branch skill/civil3d-mcp-workflows (drift).
//   memory  MEMORY.md index <-> files, private OneDrive mirror identical, "PR head" claims == fork, deliverable PDF newer than DWG.
//   bugs    every registry check (repo-grep / skill-grep / file-exists / vitest / node-version / rpc).
//   live    plugin health, open documents, fase1-audit on the active FASE 1 file. rpc checks only send BOGUS inputs or reads
//           (they skip the MCP approval step, so nothing here may touch a real object).
//   --with-tests also runs `tsc --noEmit`, `vitest run`, `npm run docs:check` in the repo (slow: ~1-2 min).
//   --brief prints ONLY FAIL/WARN lines + the summary (used by the SessionStart hook, ~3 s with --skip-live --offline).
// Exit code 1 if any FAIL. Nothing is written except a `git fetch fork <skill branch>` (read) unless --offline.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve, dirname, isAbsolute } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);
const repo = (flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp").replace(/\\/g, "/");
const skill = resolve(dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/");
const memDir = flag("mem") ?? `${homedir().replace(/\\/g, "/")}/.claude/projects/C--Users-camil-OneDrive-Documents-Civil3D-mcp/memory`;
const memMirror = flag("mem-mirror") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-MCP-backup/memory";
const only = flag("only")?.split(",");
const want = (g) => !only || only.includes(g);
const skipLive = has("skip-live") || (only && !only.includes("live") && !only.includes("bugs"));
const forkBranch = "skill/civil3d-mcp-workflows";

const rows = [];
const add = (group, level, what, detail = "") => rows.push({ group, level, what, detail });
const read = (p) => readFileSync(p, "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const shaNorm = (p) => createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n")).digest("hex");
const mtime = (p) => statSync(p).mtimeMs;
function walk(dir, filter = () => true, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(p, filter, out); }
    else if (filter(p)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}
function ps(cmd) {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8", timeout: 30000 });
  return (r.stdout ?? "").trim();
}
function git(...a) {
  return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}
const short = (arr, n = 5) => arr.slice(0, n).join(", ") + (arr.length > n ? ` … (+${arr.length - n})` : "");

// ------------------------------------------------------------------ deploy
function deploy() {
  const g = "deploy";
  const src = walk(join(repo, "src"), (p) => p.endsWith(".ts"));
  const build = walk(join(repo, "build"), (p) => p.endsWith(".js"));
  if (!build.length) { add(g, "FAIL", "repo build", "build/ is empty: run `npm run build` in the repo"); return; }
  const newestSrc = Math.max(...src.map(mtime)), newestBuild = Math.max(...build.map(mtime));
  add(g, newestSrc > newestBuild + 2000 ? "WARN" : "OK", "build fresh vs src", newestSrc > newestBuild + 2000 ? "src/ has TS newer than build/: run `npm run build`" : "build/ is newer than every src/*.ts");

  // layer 2: installed extension server/ mirrors build/
  const ext = [
    ...(existsSync(join(process.env.LOCALAPPDATA ?? "", "Packages")) ? readdirSync(join(process.env.LOCALAPPDATA, "Packages")).filter((d) => d.startsWith("Claude_")).map((d) => join(process.env.LOCALAPPDATA, "Packages", d, "LocalCache/Roaming/Claude/Claude Extensions/local.mcpb.steven-bouldin.civil3d-mcp/server")) : []),
    join(process.env.APPDATA ?? "", "Claude/Claude Extensions/local.mcpb.steven-bouldin.civil3d-mcp/server"),
  ].find((p) => existsSync(p));
  let extNewest = 0;
  if (!ext) add(g, "WARN", "extension mirror", "installed extension server/ not found (checked MSIX LocalCache and %APPDATA%)");
  else {
    const missing = [], differ = [];
    for (const f of build) {
      const rel = relative(join(repo, "build"), f).replace(/\\/g, "/");
      const target = join(ext, rel);
      if (!existsSync(target)) missing.push(rel);
      else { extNewest = Math.max(extNewest, mtime(target)); if (shaNorm(f) !== shaNorm(target)) differ.push(rel); }
    }
    if (missing.length || differ.length) add(g, "FAIL", "extension mirror (layer 2)", `installed server/ != build/ — missing ${missing.length} [${short(missing, 3)}], differ ${differ.length} [${short(differ, 3)}]; copy build/ into ${ext}`);
    else add(g, "OK", "extension mirror (layer 2)", `server/ == build/ (${build.length} files)`);
  }

  // layer 1: DLL
  const binDll = join(repo, "Civil3D-MCP-Plugin/bin/Release/net10.0-windows/Civil3DMcpPlugin.dll");
  const bundleDll = "C:/ProgramData/Autodesk/ApplicationPlugins/Civil3DMcpPlugin.bundle/Contents/Civil3DMcpPlugin.dll";
  if (!existsSync(bundleDll)) { add(g, "FAIL", "ProgramData DLL (layer 1)", "missing"); }
  else {
    const buf = readFileSync(bundleDll);
    const disp = read(join(repo, "Civil3D-MCP-Plugin/CommandDispatcher.cs"));
    const methods = [...new Set([...disp.matchAll(/^\s*"([A-Za-z0-9_]+)"\s*=>/gm)].map((m) => m[1]))];
    const absent = methods.filter((m) => buf.indexOf(Buffer.from(m, "utf16le")) < 0 && buf.indexOf(Buffer.from(m, "utf8")) < 0);
    add(g, absent.length ? "FAIL" : "OK", "DLL has every dispatcher method (layer 1)", absent.length ? `${absent.length}/${methods.length} dispatcher methods absent from the ProgramData DLL: ${short(absent)} -> rebuild + install-plugin-dll.ps1` : `${methods.length} methods present`);
    if (existsSync(binDll)) {
      // NOTE: builds are not byte-deterministic (a rebuild of unchanged source gives a different hash), so hashes prove nothing here;
      // the real staleness test is source mtime vs the build time of the installed DLL (Copy-Item keeps the source's mtime).
      const cs = walk(join(repo, "Civil3D-MCP-Plugin"), (p) => p.endsWith(".cs") && !/[\\/](obj|bin)[\\/]/.test(p));
      const newestCs = Math.max(...cs.map(mtime));
      add(g, newestCs > mtime(bundleDll) + 2000 ? "FAIL" : "OK", "installed DLL built after last C# edit (layer 1)", newestCs > mtime(bundleDll) + 2000 ? "a .cs file is newer than the ProgramData DLL: run deploy-all.ps1 (or dotnet build + install-plugin-dll.ps1 with Civil 3D closed)" : "no .cs newer than the installed DLL");
      add(g, "INFO", "bin/Release vs ProgramData DLL", sha(binDll) === sha(bundleDll) ? "identical" : "bytes differ (normal after a rebuild of unchanged source; not a defect)");
    }
    // layer 3 (+ Civil 3D running a stale DLL)
    const claudeStart = ps("(Get-Process claude -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1).StartTime.ToString('o')");
    if (claudeStart && extNewest) {
      const t = Date.parse(claudeStart);
      add(g, t < extNewest ? "WARN" : "OK", "Claude Desktop started after layer 2 (layer 3)", t < extNewest ? `Claude Desktop (${claudeStart}) started BEFORE the extension server/ was updated: new tools/fields invisible until the USER quits it fully and opens a new chat` : "restarted after the last server/ update");
    } else add(g, "SKIP", "Claude Desktop restart (layer 3)", "process or extension not found");
    const acadStart = ps("(Get-Process acad -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1).StartTime.ToString('o')");
    if (acadStart) {
      const t = Date.parse(acadStart);
      add(g, t < mtime(bundleDll) ? "WARN" : "OK", "Civil 3D started after the DLL install", t < mtime(bundleDll) ? "acad.exe is running a DLL older than the one on disk: restart Civil 3D (save first)" : "running the installed DLL");
    } else add(g, "SKIP", "Civil 3D vs DLL", "acad.exe not running");
  }
}

// ------------------------------------------------------------------ docs
function docs(registry) {
  const g = "docs";
  const toolIndex = read(join(skill, "references/tool-index.md"));
  const names = (text) => [...text.matchAll(/toolName: "([a-z0-9_]+)"/g)].map((m) => m[1]);
  const srcNames = new Set(walk(join(repo, "src/tools/domains"), (p) => p.endsWith(".ts")).flatMap((p) => names(read(p))));
  let baseNames = new Set();
  try { baseNames = new Set(names(git("grep", "-h", "toolName: \"", "origin/main", "--", "src/tools/domains"))); } catch { /* offline/no origin/main */ }
  if (baseNames.size) {
    const ours = [...srcNames].filter((n) => !baseNames.has(n));
    const undocumented = ours.filter((n) => !toolIndex.includes(n));
    add(g, undocumented.length ? "WARN" : "OK", "our tools are in tool-index.md", undocumented.length ? `${undocumented.length} of ${ours.length} tools added by our commits are not in tool-index.md: ${short(undocumented, 8)}` : `${ours.length} locally-added tools documented`);
  } else add(g, "SKIP", "our tools in tool-index.md", "origin/main not available");
  const headings = [...toolIndex.matchAll(/^### ([a-z][a-z0-9_]+)\b/gm)].map((m) => m[1]).filter((n) => /^(civil3d|acad)_/.test(n));
  const stale = headings.filter((n) => !srcNames.has(n) && !walk(join(repo, "src"), (p) => p.endsWith(".ts")).some((p) => read(p).includes(`"${n}"`)));
  add(g, stale.length ? "WARN" : "OK", "tool-index headings still exist in src", stale.length ? `stale docs: ${stale.join(", ")}` : `${headings.length} headings checked`);

  // troubleshooting <-> registry
  const trouble = read(join(skill, "references/troubleshooting.md"));
  const noMatch = registry.bugs.filter((b) => !trouble.includes(b.match));
  add(g, noMatch.length ? "FAIL" : "OK", "registry -> troubleshooting.md", noMatch.length ? `registry entries whose row text is gone/renamed: ${noMatch.map((b) => b.id).join(", ")}` : `${registry.bugs.length} entries all found in the table`);
  const tableRows = trouble.split("\n").filter((l) => /^\| /.test(l) && !/^\|[-| ]+\|$/.test(l) && !/^\| (Síntoma|Síntoma \/ mensaje)/.test(l));
  const orphan = tableRows.filter((l) => !registry.bugs.some((b) => l.includes(b.match)));
  add(g, orphan.length ? "WARN" : "OK", "troubleshooting.md -> registry", orphan.length ? `${orphan.length} table rows have no registry entry (add one to known-bugs.json): ${short(orphan.map((l) => l.slice(0, 60)), 4)}` : `${tableRows.length} rows covered`);

  // scripts syntax (skill-selfcheck.mjs does the same in CI)
  const badScripts = walk(join(skill, "scripts"), (p) => /\.(mjs|cjs)$/.test(p) && !/ErrorReports/.test(p)).filter((p) => spawnSync(process.execPath, ["--check", p], { encoding: "utf8" }).status !== 0);
  add(g, badScripts.length ? "FAIL" : "OK", "skill scripts pass node --check", badScripts.length ? badScripts.map((p) => relative(skill, p)).join(", ") : "all scripts parse");

  // fase1-audit.mjs (script) <-> fase1Audit.ts (native tool) must check the same things -- found 2026-09-28
  // when a 6th check (dimension text position) was added to only one of the two paths (the standalone
  // script used by /fase1, and the native civil3d_workflow_fase1_audit tool subagents call directly).
  const literalWhats = (text) => new Set([...text.matchAll(/\badd\(\s*(?:g,\s*)?"(?:OK|WARN|FAIL|INFO)",\s*"([^"]+)"/g)].map((m) => m[1]));
  const scriptChecks = literalWhats(read(join(skill, "scripts/fase1-audit.mjs")));
  const nativeChecks = literalWhats(read(join(repo, "src/tools/domains/fase1Audit.ts")));
  const onlyScript = [...scriptChecks].filter((w) => !nativeChecks.has(w));
  const onlyNative = [...nativeChecks].filter((w) => !scriptChecks.has(w));
  const driftMsg = [
    onlyScript.length ? `only in fase1-audit.mjs: ${onlyScript.join(", ")}` : null,
    onlyNative.length ? `only in fase1Audit.ts: ${onlyNative.join(", ")}` : null,
  ].filter(Boolean).join("; ");
  add(g, driftMsg ? "WARN" : "OK", "fase1-audit.mjs == fase1Audit.ts checks", driftMsg || `${scriptChecks.size} checks match in both (script + native tool)`);

  // SKILL.md paths
  const skillMd = read(join(skill, "SKILL.md"));
  const paths = [...new Set([...skillMd.matchAll(/\b((?:references|scripts)\/[\w./-]+\.(?:md|mjs|ps1|py|cjs|json|sh|txt))/g)].map((m) => m[1]))];
  const gone = paths.filter((p) => !existsSync(join(skill, p)));
  add(g, gone.length ? "WARN" : "OK", "SKILL.md paths exist", gone.length ? `missing: ${gone.join(", ")}` : `${paths.length} referenced paths exist`);
}

// ------------------------------------------------------------------ projects (project.json of every project) + batch report
async function projects() {
  const g = "projects";
  const ps = await import(pathToFileURL(join(skill, "scripts/project-state.mjs")).href);
  const root = flag("projects-root") ?? ps.DEFAULT_ROOT;
  if (!existsSync(root)) { add(g, "SKIP", "projects", `root not found: ${root}`); return; }
  const found = ps.discoverProjects(root);
  if (!found.length) { add(g, "INFO", "projects", "no projects found"); return; }
  for (const f of found) {
    const issues = ps.validateProject(f.dir);
    const name = ps.loadProject(f.dir)?.name ?? f.dir.split("/").pop();
    if (!issues.length) add(g, "OK", `project ${name}`, "project.json valid, deliverables consistent");
    for (const i of issues) add(g, i.level === "ERROR" ? "FAIL" : "WARN", `project ${name}`, i.msg);
  }
  const reports = join(root, "_reports");
  const latest = existsSync(reports) ? readdirSync(reports).filter((f) => /^fase1-batch_.*\.md$/.test(f)).sort().at(-1) : undefined;
  if (!latest) add(g, "WARN", "fase1-batch report", "no batch report yet: node scripts/fase1-batch.mjs --report (the scheduled task does it nightly)");
  else {
    const ageDays = (Date.now() - mtime(join(reports, latest))) / 86400000;
    add(g, ageDays > 8 ? "WARN" : "OK", "fase1-batch report", `${latest} (${ageDays.toFixed(1)} days old)${ageDays > 8 ? ": the scheduled batch is not running" : ""}`);
    const text = read(join(reports, latest));
    const bad = (text.match(/\| (?:FAIL) \|/g) ?? []).length;
    add(g, bad ? "WARN" : "OK", "fase1-batch result", bad ? `${bad} project(s) with FAIL in ${latest}` : "no FAIL in the last batch");
  }
}

// ------------------------------------------------------------------ agents (+ skill drift vs fork)
function agents() {
  const g = "agents";
  const src = join(repo, ".claude/agents");
  const bak = join(skill, "subagents-backup");
  if (existsSync(src)) {
    const files = readdirSync(src).filter((f) => f.endsWith(".md"));
    const bad = files.filter((f) => !existsSync(join(bak, f)) || shaNorm(join(src, f)) !== shaNorm(join(bak, f)));
    add(g, bad.length ? "WARN" : "OK", "repo .claude/agents == skill subagents-backup", bad.length ? `differ/missing: ${bad.join(", ")} (repo .claude is gitignored: the backup is the only copy that reaches the fork)` : `${files.length} agent files identical`);
  } else add(g, "SKIP", "agents", ".claude/agents not found");
  // slash commands + SessionStart hook live outside the skill: their backup copies must match the live ones
  const cmdLive = join(homedir(), ".claude/commands"), cmdBak = join(skill, "commands-backup");
  if (existsSync(cmdBak)) {
    const cmds = readdirSync(cmdBak).filter((f) => f.endsWith(".md") && f !== "README.md");
    const badCmd = cmds.filter((f) => !existsSync(join(cmdLive, f)) || shaNorm(join(cmdLive, f)) !== shaNorm(join(cmdBak, f)));
    add(g, badCmd.length ? "WARN" : "OK", "slash commands == commands-backup", badCmd.length ? `differ/missing in ~/.claude/commands: ${badCmd.join(", ")}` : `${cmds.length} commands identical (/${cmds.map((c) => c.replace(".md", "")).join(", /")})`);
    const settings = join(repo, ".claude/settings.json");
    const hookOk = existsSync(settings) && /integrity-check\.mjs/.test(read(settings)) && /SessionStart/.test(read(settings));
    add(g, hookOk ? "OK" : "WARN", "SessionStart hook installed", hookOk ? "integrity-check runs at session start" : "merge commands-backup/SessionStart-hook.settings.json into <repo>/.claude/settings.json");
  }
  if (has("offline")) { add(g, "SKIP", "skill vs fork branch", "--offline"); return; }
  try {
    git("fetch", "fork", forkBranch, "--quiet");
    const tree = git("ls-tree", "-r", `fork/${forkBranch}`, "--", "skills/civil3d-mcp-workflows").split("\n").filter(Boolean).map((l) => {
      const [meta, path] = l.split("\t"); return { blob: meta.split(" ")[2], path: path.replace("skills/civil3d-mcp-workflows/", "") };
    });
    const junk = /^scripts\/(ErrorReports\/|plot\.log$)/;   // Core Console runtime output, excluded by sync-skill-to-fork.sh too
    const local = walk(skill).map((p) => relative(skill, p).replace(/\\/g, "/")).filter((p) => !junk.test(p));
    const localHash = new Map();
    const out = execFileSync("git", ["-C", repo, "hash-object", "--stdin-paths"], { input: local.map((p) => join(skill, p)).join("\n"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n");
    local.forEach((p, i) => localHash.set(p, out[i]));
    const forkMap = new Map(tree.map((t) => [t.path, t.blob]));
    const differ = local.filter((p) => forkMap.has(p) && forkMap.get(p) !== localHash.get(p));
    const onlyLocal = local.filter((p) => !forkMap.has(p));
    const onlyFork = tree.map((t) => t.path).filter((p) => !localHash.has(p));
    const drift = differ.length + onlyLocal.length + onlyFork.length;
    add(g, drift ? "WARN" : "OK", "skill folder == fork branch", drift ? `${drift} files differ from fork/${forkBranch} (changed ${differ.length} [${short(differ, 4)}], new ${onlyLocal.length}, gone ${onlyFork.length}); run sync-skill-to-fork.sh ONLY when the user asks` : "skill (incl. subagents-backup) identical to the fork backup");
  } catch (e) { add(g, "SKIP", "skill vs fork branch", `git fetch/ls-tree failed: ${String(e.message).split("\n")[0]}`); }
}

// ------------------------------------------------------------------ memory
function memory() {
  const g = "memory";
  if (!existsSync(memDir)) { add(g, "SKIP", "memory", `${memDir} not found`); return; }
  const files = readdirSync(memDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  const index = read(join(memDir, "MEMORY.md"));
  const linked = [...index.matchAll(/\(([\w.-]+\.md)\)/g)].map((m) => m[1]);
  const unindexed = files.filter((f) => !linked.includes(f)), dangling = linked.filter((f) => !files.includes(f));
  add(g, unindexed.length || dangling.length ? "WARN" : "OK", "MEMORY.md index <-> files", unindexed.length || dangling.length ? `not indexed: ${unindexed.join(", ") || "-"}; dangling: ${dangling.join(", ") || "-"}` : `${files.length} memory files, all indexed`);
  const noFront = files.filter((f) => !/^---\nname: /m.test(read(join(memDir, f)).replace(/\r\n/g, "\n")));
  add(g, noFront.length ? "WARN" : "OK", "memory frontmatter", noFront.length ? `missing name: frontmatter: ${noFront.join(", ")}` : "all files have frontmatter");
  if (existsSync(memMirror)) {
    const stale = [...files, "MEMORY.md"].filter((f) => !existsSync(join(memMirror, f)) || shaNorm(join(memDir, f)) !== shaNorm(join(memMirror, f)));
    add(g, stale.length ? "WARN" : "OK", "memory mirror (private OneDrive) identical", stale.length ? `stale in ${memMirror}: ${short(stale)} -> copy *.md there` : "mirror up to date");
  } else add(g, "WARN", "memory mirror", `${memMirror} missing`);
  // "PR #16 head now <sha>" claims vs fork
  const pub = join(memDir, "github_publishing.md");
  if (existsSync(pub) && !has("offline")) {
    try {
      const claims = [...read(pub).matchAll(/PR #16 head now (?:[^`\n]*?)([0-9a-f]{7})/g)].map((m) => m[1]);
      const claim = claims.at(-1);
      const head = git("rev-parse", "--short=7", "fork/local/deploy-acad-plus-schema-fix").trim();
      add(g, claim && claim === head ? "OK" : "WARN", "memory PR #16 head == fork branch", claim ? (claim === head ? `both ${head}` : `memory says ${claim}, fork branch is ${head} (update github_publishing.md)`) : "no 'PR #16 head now' claim found");
    } catch { add(g, "SKIP", "PR head claim", "fork ref not available (git fetch fork)"); }
  }
  // memory files that still say "pending" and were not touched for 3+ days: candidates to close or delete
  const stalePending = files.filter((f) => {
    const t = read(join(memDir, f));
    const name = /^name:\s*(.+)$/m.exec(t)?.[1] ?? "";
    // by file/name only: project-status files legitimately mention "pending" items inside
    return /pending|pendiente/i.test(f + " " + name) && Date.now() - mtime(join(memDir, f)) > 3 * 86400000;
  });
  add(g, stalePending.length ? "WARN" : "OK", "memory 'pending' files still current", stalePending.length ? `file/name says pending but not touched for 3+ days: ${stalePending.join(", ")} — verify, then close/rename them` : "no stale pending memories");
  // exact head markers kept by hand in github_publishing.md:  PLUGIN_BRANCH_HEAD: <sha7>  /  SKILL_BRANCH_HEAD: <sha7>
  if (existsSync(pub) && !has("offline")) {
    const txt = read(pub);
    for (const [marker, ref] of [["PLUGIN_BRANCH_HEAD", "fork/local/deploy-acad-plus-schema-fix"], ["SKILL_BRANCH_HEAD", `fork/${forkBranch}`]]) {
      const claim = new RegExp(`${marker}:\\s*([0-9a-f]{7})`).exec(txt)?.[1];
      try {
        const head = git("rev-parse", "--short=7", ref).trim();
        add(g, !claim ? "WARN" : claim === head ? "OK" : "WARN", `memory ${marker} == ${ref}`, !claim ? `add a "${marker}: <sha7>" line to github_publishing.md` : claim === head ? `both ${head}` : `memory says ${claim}, remote is ${head}: update github_publishing.md`);
      } catch { add(g, "SKIP", marker, `${ref} not available`); }
    }
  }
  // deliverable freshness
  const dir = "C:/Users/camil/OneDrive/Documents/AUTOCAD @XEREFT/VILLA ONE @XEREFT";
  const dwg = `${dir}/VILLA ONE @XEREFT FASE 1.dwg`, pdf = `${dir}/_QC/C-300 FASE 1.pdf`;
  if (existsSync(dwg) && existsSync(pdf)) add(g, mtime(pdf) + 2000 >= mtime(dwg) ? "OK" : "WARN", "VILLA ONE PDF newer than DWG", mtime(pdf) + 2000 >= mtime(dwg) ? "PDF was plotted after the last save" : "DWG saved after the PDF: re-run qc-plot.ps1 -Layouts C-300 and copy");
  else add(g, "SKIP", "VILLA ONE deliverables", "DWG or PDF not found");
}

// ------------------------------------------------------------------ bugs (registry) + live
async function bugs(registry) {
  const g = "bugs";
  let manual = 0, auto = 0;
  const rpcQueue = [];
  for (const b of registry.bugs) {
    if (!b.checks.length) { manual++; continue; }
    for (const c of b.checks) {
      const id = `${b.id}:${c.type}`;
      try {
        if (c.type === "repo-grep" || c.type === "skill-grep") {
          const base = c.type === "repo-grep" ? repo : skill;
          const p = join(base, c.file);
          if (!existsSync(p)) { add(g, "FAIL", id, `${c.file} not found`); continue; }
          const ok = new RegExp(c.pattern).test(read(p));
          add(g, ok ? "OK" : "FAIL", id, ok ? `${c.file} ~ /${c.pattern}/` : `regression: /${c.pattern}/ no longer in ${c.file} — the fix for "${b.id}" may be gone`);
        } else if (c.type === "file-exists") {
          const p = isAbsolute(c.path) ? c.path : join(skill, c.path); // relative paths are skill-relative, never cwd-relative
          const ok = existsSync(p); add(g, ok ? "OK" : "FAIL", id, ok ? c.path : `missing ${c.path}`);
        } else if (c.type === "node-version") {
          const major = Number(process.versions.node.split(".")[0]); add(g, major >= c.min ? "OK" : "FAIL", id, `node ${process.versions.node} (need >= ${c.min})`);
        } else if (c.type === "vitest") {
          if (!has("with-tests")) { add(g, "SKIP", id, `${c.file} (run with --with-tests)`); continue; }
          const r = spawnSync("npx", ["vitest", "run", c.file], { cwd: repo, encoding: "utf8", shell: true, timeout: 240000 });
          add(g, r.status === 0 ? "OK" : "FAIL", id, r.status === 0 ? c.file : (r.stdout + r.stderr).split("\n").slice(-12).join(" | ").slice(0, 400));
        } else if (c.type === "rpc") { rpcQueue.push({ b, c, id }); continue; }
        else { add(g, "WARN", id, `unknown check type ${c.type}`); continue; }
        auto++;
      } catch (e) { add(g, "FAIL", id, String(e.message).slice(0, 300)); }
    }
  }
  add(g, "INFO", "registry coverage", `${registry.bugs.length} entries: ${registry.bugs.length - manual} with automated checks, ${manual} documented-only (manual/process)`);
  return rpcQueue;
}

async function live(rpcQueue) {
  const g = "live";
  if (skipLive) { add(g, "SKIP", "live checks", "--skip-live"); return; }
  let client;
  let withConn;
  try { ({ withApplicationConnection: withConn } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href)); }
  catch (e) { add(g, "SKIP", "live checks", `build/utils/ConnectionManager.js not loadable (${e.message.split("\n")[0]})`); return; }
  const call = async (method, params) => {
    try { return { ok: true, value: await withConn(async (cl) => cl.sendCommand(method, params)) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  };
  const health = await call("getCivil3DHealth", {});
  if (!health.ok) { add(g, "WARN", "plugin health", `no plugin at :8080 (${health.error.split("\n")[0]}) — live/rpc checks skipped`); return; }
  const h = health.value;
  add(g, h.drawingLoaded && !h.operationInProgress ? "OK" : "WARN", "plugin health", `connected, drawingLoaded=${h.drawingLoaded}, busy=${h.operationInProgress}, queue=${h.queueDepth}`);
  const docsR = await call("listOpenDocuments", {});
  const list = docsR.ok ? (docsR.value.documents ?? []) : [];
  const active = list.find((d) => d.isActive);
  add(g, "INFO", "open documents", list.map((d) => `${d.isActive ? "*" : " "}${(d.name ?? "").split(/[\\/]/).pop()}`).join("; ") || "none");
  if (active && /FASE 1/i.test(active.name ?? "")) {
    const r = spawnSync("node", [join(skill, "scripts/fase1-audit.mjs")], { encoding: "utf8", timeout: 120000 });
    const lines = (r.stdout ?? "").split("\n").filter((l) => /^(OK|WARN|FAIL|FASE 1)/.test(l));
    add(g, r.status === 0 ? "OK" : "FAIL", "fase1-audit on active FASE 1 file", lines.filter((l) => !l.startsWith("OK")).join(" | ") || `${lines.length} lines OK`);
  } else add(g, "SKIP", "fase1-audit", "active document is not a FASE 1 file");
  for (const { b, c, id } of rpcQueue) {
    const r = await call(c.method, c.params);
    const noDoc = !r.ok && /no active|NO_DRAWING|no drawing/i.test(r.error);
    if (c.expectError) {
      if (r.ok) add("bugs", "FAIL", id, `${c.method} should have failed with /${c.expectError}/ but succeeded — "${b.id}" regressed`);
      else if (noDoc) add("bugs", "SKIP", id, "no active drawing");
      else add("bugs", new RegExp(c.expectError, "i").test(r.error) ? "OK" : "FAIL", id, new RegExp(c.expectError, "i").test(r.error) ? `${c.method} rejected: ${r.error.slice(0, 90)}` : `${c.method} failed differently: ${r.error.slice(0, 160)}`);
    } else {
      if (!r.ok) { add("bugs", noDoc || c.skipIfError ? "SKIP" : "FAIL", id, `${c.method}: ${r.error.slice(0, 160)}`); continue; }
      const text = JSON.stringify(r.value, null, 2);
      const miss = (c.contains ?? []).filter((s) => !text.includes(s));
      const warn = (c.warnIfContains ?? []).filter((s) => text.includes(s));
      add("bugs", miss.length ? "FAIL" : warn.length ? "WARN" : "OK", id, miss.length ? `${c.method} response lacks ${miss.join(", ")}` : warn.length ? `${c.method} returned ${warn.join(", ")} (documented bug condition is active)` : `${c.method} ok`);
    }
  }
}

// ------------------------------------------------------------------ extra: tests
function tests() {
  if (!has("with-tests")) return;
  const g = "tests";
  for (const [name, cmd, a] of [["tsc --noEmit", "npx", ["tsc", "--noEmit"]], ["vitest run", "npx", ["vitest", "run"]], ["docs:check", "npm", ["run", "docs:check"]]]) {
    const r = spawnSync(cmd, a, { cwd: repo, encoding: "utf8", shell: true, timeout: 420000 });
    const tail = (r.stdout + r.stderr).trim().split("\n").filter((l) => /Tests|passed|failed|error|Error|drift|out of date/i.test(l)).slice(-3).join(" | ");
    add(g, r.status === 0 ? "OK" : "FAIL", name, tail.slice(0, 300));
  }
}

// ------------------------------------------------------------------ main
const registry = JSON.parse(read(join(skill, "references/standards/known-bugs.json")));
if (want("deploy")) deploy();
if (want("docs")) docs(registry);
if (want("projects")) await projects();
if (want("agents")) agents();
if (want("memory")) memory();
let queue = [];
if (want("bugs") || want("live")) queue = want("bugs") ? await bugs(registry) : [];
if (want("live")) await live(queue);
else if (want("bugs") && queue.length) add("bugs", "SKIP", "rpc checks", `${queue.length} live rpc checks skipped (--only without live)`);
tests();

const groupOrder = ["deploy", "docs", "projects", "agents", "memory", "bugs", "live", "tests"];
rows.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group));   // Array.sort is stable: keeps insertion order inside a group
if (has("json")) console.log(JSON.stringify(rows, null, 2));
else if (has("hook")) {
  const bad = rows.filter((x) => x.level === "FAIL" || x.level === "WARN");
  if (bad.length) console.log(`[integrity-check, session start] ${bad.length} item(s) need a look before working (details: node ~/.claude/skills/civil3d-mcp-workflows/scripts/integrity-check.mjs):\n` + bad.map((r) => `- ${r.level} ${r.what}: ${r.detail}`).join("\n"));
} else {
  let lastGroup = "";
  for (const r of rows.filter((x) => !has("brief") || x.level === "FAIL" || x.level === "WARN")) {
    if (r.group !== lastGroup) { console.log(`\n== ${r.group}`); lastGroup = r.group; }
    console.log(`${r.level.padEnd(5)} ${r.what}${r.detail ? "  —  " + r.detail : ""}`);
  }
  const count = (l) => rows.filter((r) => r.level === l).length;
  console.log(`\nINTEGRITY: ${count("FAIL")} FAIL, ${count("WARN")} WARN, ${count("OK")} OK, ${count("SKIP")} SKIP`);
}
// --hook: for a Claude Code SessionStart hook: always exit 0 (a non-zero exit would hide stdout) and stay silent when everything is OK
if (has("hook")) process.exit(0);
process.exit(rows.some((r) => r.level === "FAIL") ? 1 : 0);
