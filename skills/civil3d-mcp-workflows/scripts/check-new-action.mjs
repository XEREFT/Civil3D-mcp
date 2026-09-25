#!/usr/bin/env node
// Verifica el patrón de 4 archivos para una acción nueva del plugin Civil3D-mcp.
// Uso: node check-new-action.mjs <pluginMethod camelCase> <action_snake> [toolName alias] [--repo RUTA] [--domain geometry]
// Ej.: node check-new-action.mjs createMLeader create_mleader acad_create_mleader
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const [method, action, toolName] = pos;
if (!method || !action) { console.error("Uso: node check-new-action.mjs <pluginMethod> <action_snake> [toolName] [--repo RUTA]"); process.exit(2); }

const repo = flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp";
const plugin = join(repo, "Civil3D-MCP-Plugin");
const domains = join(repo, "src/tools/domains");
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const pascal = method[0].toUpperCase() + method.slice(1);
let ok = true;
const check = (label, cond, hint) => { console.log(`${cond ? "OK  " : "FALTA"} ${label}${cond ? "" : `\n      → ${hint}`}`); if (!cond) ok = false; };

// 1. Handler C#
const csFiles = readdirSync(plugin).filter((f) => f.endsWith(".cs"));
const handlerFile = csFiles.find((f) => new RegExp(`static\\s+Task<object\\?>\\s+${pascal}Async\\s*\\(`).test(read(join(plugin, f))));
check(`C# handler ${pascal}Async`, !!handlerFile, `Agregar 'public static Task<object?> ${pascal}Async(JsonObject? parameters)' en <Area>Commands.cs`);
if (handlerFile) console.log(`      en ${handlerFile}`);

// 2. Dispatcher
const disp = read(join(plugin, "CommandDispatcher.cs"));
check(`CommandDispatcher case "${method}"`, new RegExp(`"${method}"\\s*=>\\s*\\w+\\.${pascal}Async`).test(disp),
  `Agregar  "${method}" => <Area>Commands.${pascal}Async(parameters),  en CommandDispatcher.cs`);

// 3. Dominio TS
const domainFiles = readdirSync(domains).filter((f) => f.endsWith(".ts"));
const domFile = flag("domain") ? `${flag("domain")}Domain.ts` : domainFiles.find((f) => read(join(domains, f)).includes(`z.literal("${action}")`));
const dom = domFile ? read(join(domains, domFile)) : "";
check(`Zod schema z.literal("${action}")`, dom.includes(`z.literal("${action}")`), "Crear const XxxArgs = z.object({ action: z.literal(...) , ...})");
if (domFile) console.log(`      en src/tools/domains/${domFile}`);
check(`actions entry '${action}:'`, new RegExp(`\\b${action}:\\s*\\{\\s*action:\\s*"${action}"`).test(dom), "Agregar la entrada en actions { … pluginMethods, execute }");
check(`pluginMethods ["${method}"] + sendCommand("${method}")`, dom.includes(`"${method}"`) && dom.includes(`sendCommand("${method}"`), "execute debe llamar appClient.sendCommand(método exacto)");
const enumHit = [...dom.matchAll(/action:\s*z\.enum\(\[([^\]]*)\]\)/g)].some((m) => m[1].includes(`"${action}"`));
check(`acción en z.enum del tool agregado`, enumHit, "Agregar la acción al z.enum([...]) del inputShape del tool civil3d_<dominio> (y sus campos como .optional())");
if (toolName) check(`alias toolName "${toolName}"`, dom.includes(`toolName: "${toolName}"`), "Agregar exposure { toolName, inputShape, supportedActions, resolveAction }");

// 4. Tests
const t1 = read(join(repo, "tests/domain_manifest.test.ts"));
const t2 = read(join(repo, "tests/tool_catalog.test.ts"));
check(`tests/domain_manifest.test.ts contiene "${action}"`, t1.includes(`"${action}"`), `expect(<dominio>!.operations).toContain("${action}");`);
if (toolName) check(`tests/tool_catalog.test.ts contiene "${toolName}"`, t2.includes(`"${toolName}"`), `Agregar "${toolName}" a requiredTools`);

console.log(ok ? "\nPatrón completo. Siguiente: npx tsc --noEmit · dotnet build -c Release · subagente civil3d-deploy · verify-deploy.ps1" : "\nPatrón incompleto.");
process.exit(ok ? 0 : 1);
