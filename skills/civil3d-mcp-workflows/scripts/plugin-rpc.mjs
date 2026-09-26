#!/usr/bin/env node
// Direct plugin RPC: calls a plugin method on the live Civil 3D (port 8080) from the repo's build/, WITHOUT the MCP layer.
// Use: right after a C#-only deploy or for a brand-new action, to test it before Claude Desktop restarts (a new action name is not
// visible to the frozen MCP tool registry until layer 3). It skips the MCP approval-token step, so keep it to READ methods and to
// SCRATCH documents (an unsaved copy opened with `civil3d_drawing new templatePath=<sibling.dwg>`), never the user's real drawing.
//   node plugin-rpc.mjs <pluginMethod> '<json params>' [--repo C:/Users/camil/OneDrive/Documents/Civil3D-mcp]
//   node plugin-rpc.mjs listViewports '{"layout":"C-301"}'
//   node plugin-rpc.mjs copyLayout '{"sourceLayoutName":"C-300","newName":"C-301","excludeLayers":["VPORT"],"replaceText":[{"find":"C-300","replace":"C-301"}]}'
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const [method, json] = pos;
if (!method) { console.error("Uso: node plugin-rpc.mjs <pluginMethod> '<json params>' [--repo RUTA]"); process.exit(2); }
const repo = flag("repo") ?? "C:/Users/camil/OneDrive/Documents/Civil3D-mcp";
const params = json ? JSON.parse(json) : {};

const { withApplicationConnection } = await import(pathToFileURL(join(repo, "build/utils/ConnectionManager.js")).href);
try {
  const result = await withApplicationConnection(async (client) => client.sendCommand(method, params));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`plugin-rpc ${method} failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
