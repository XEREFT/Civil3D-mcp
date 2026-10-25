# Plugin architecture and adding a new handler

Repo: `C:\Users\camil\OneDrive\Documents\Civil3D-mcp\Civil3D-mcp` (local fork of Sacred-G/Civil3D-mcp). Target `net10.0-windows`. Installed Civil 3D is **2027** (docs say 2026).

## 1. Call flow
```
MCP tool "acad_foo" -> toolManifest.ts (registerManifestTools)
 -> domains/<domain>Domain.ts: exposure resolveAction -> action "foo"
 -> approval policy (capabilities / safeForRetry / name regex)
 -> execute: withApplicationConnection(c => c.sendCommand("fooBar", params))
 -> TCP localhost:8080, JSON-RPC 2.0 {jsonrpc,id,method:"fooBar",params}
 -> PluginRuntime (host queue) -> CommandDispatcher.DispatchAsync switch
 -> XxxCommands.FooBarAsync(parameters) -> CivilExecution.ReadAsync/WriteAsync
 <- Dictionary<string,object?> serialized -> validated by Zod responseSchema
```
Naming: plugin method **camelCase** (`createMLeader`), action **snake_case** (`create_mleader`), alias `acad_<action>` or `civil3d_<domain>_<action>`.

## 2. Four-file pattern (always all together)
1. `Civil3D-MCP-Plugin/<Area>Commands.cs`: `public static Task<object?> FooBarAsync(JsonObject? parameters)` (new area -> new `XxxCommands.cs`, like `LayerXrefCommands.cs`, `PurgeAuditCommands.cs`).
2. `Civil3D-MCP-Plugin/CommandDispatcher.cs`: `case "fooBar" => XxxCommands.FooBarAsync(parameters),` next to its group.
3. `src/tools/domains/<domain>Domain.ts`: (a) Zod `FooBarArgs` with `action: z.literal("foo_bar")`; (b) entry in `actions` (capabilities, requiresActiveDrawing, safeForRetry, pluginMethods, execute); (c) action added to the aggregate tool's `z.enum([...])` in `inputShape`, fields `.optional()` there; (d) alias exposure `{ toolName:"acad_foo_bar", ..., supportedActions:["foo_bar"], resolveAction }`.
4. Tests: `tests/domain_manifest.test.ts` (`expect(geometry!.operations).toContain("foo_bar")`) and `tests/tool_catalog.test.ts` (add `"acad_foo_bar"` to `requiredTools`).
Mechanical check: `node ~/.claude/skills/civil3d-mcp-workflows/scripts/check-new-action.mjs fooBar foo_bar acad_foo_bar`.

## 3. C# template
Parameter helpers (`PluginRuntime`): `GetRequiredString|Double|Int`, `GetOptionalString|Double|Int|Bool`. Errors: `throw new JsonRpcDispatchException("CIVIL3D.<CODE>", "actionable message")` (`INVALID_INPUT`, `OBJECT_NOT_FOUND`, `API_ERROR`, `CONFLICT`...); the message must tell Claude what to do ("Use listOpenDocuments to see what's open"). Utilities: `CivilObjectUtils.GetRequiredObject<T>(tx, id, mode)`, `LookupUtils` (layers, linetypes, sites), `FileBoundary` (import/export path validation). **Parse parameters outside the lambda** (fail fast, do not occupy the queue).

```csharp
public static Task<object?> FooBarAsync(JsonObject? parameters)
{
  var handleValue = PluginRuntime.GetRequiredString(parameters, "handle");
  var layerName = PluginRuntime.GetOptionalString(parameters, "layer");
  return CivilExecution.WriteAsync<object?>((doc, civilDoc, database, transaction) =>
  {
    var id = database.GetObjectId(false, new Handle(Convert.ToInt64(handleValue, 16)), 0);
    if (id.IsNull)
      throw new JsonRpcDispatchException("CIVIL3D.OBJECT_NOT_FOUND", $"Entity with handle '{handleValue}' was not found.");
    var entity = CivilObjectUtils.GetRequiredObject<Entity>(transaction, id, OpenMode.ForWrite);
    // ... changes ...
    return new Dictionary<string, object?> { ["handle"] = handleValue, ["updated"] = true };
  });
}
```
- **Reads:** same with `CivilExecution.ReadAsync`; return **one object** (`{ "entities": [...] }`), never a bare array (Zod rejects it).
- **Native command** (AUDIT, NEW; no transaction): `CivilExecution.ExecuteInCommandContextAsync<object?>(async () => { doc.Editor.Command("_.AUDIT", "_Y"); return ...; })`.
- **Target space in create handlers:** never write `blockTable[BlockTableRecord.ModelSpace]` directly; use `AcadCommands.cs` helpers: `var space = ParseTargetSpace(parameters);` and `PluginRuntime.GetOptionalString(parameters,"layout")` outside the lambda, `var (targetSpace, targetLayoutName) = ResolveTargetSpace(database, transaction, space, layoutName); targetSpace.AppendEntity(entity);` inside. TS side: add `space: z.enum(["model","paper"]).optional(), layout: z.string().optional()` to schema, execute and alias (used by `createText`, `createMText`, `createMLeader`).
- List filters: `contains`, `layer`, `space`, `limit` (max 500), proximity `nearX/nearY/nearRadius`, like existing `list_*`.

## 4. TypeScript template
```ts
const FooBarArgs = z.object({ action: z.literal("foo_bar"), handle: z.string().min(1), layer: z.string().optional() });
// in actions:
foo_bar: { action:"foo_bar", inputSchema:FooBarArgs, responseSchema:GenericResponseSchema,
  capabilities:["edit"], requiresActiveDrawing:true, safeForRetry:false, pluginMethods:["fooBar"],
  execute: async (args) => await withApplicationConnection(async (appClient) =>
    await appClient.sendCommand("fooBar", { handle: args.handle, layer: args.layer })) },
// in exposures (alias):
{ toolName:"acad_foo_bar", displayName:"AutoCAD Foo Bar",
  description:"<what it does + when to use it + what it does NOT do>",
  inputShape:{ handle:z.string().min(1), layer:z.string().optional() },
  supportedActions:["foo_bar"],
  resolveAction:(rawArgs)=>({ action:"foo_bar", args:{ action:"foo_bar", ...rawArgs } }) },
```
- `capabilities`: `query|inspect|analyze` = read; `create|edit|delete|manage|import|export` = mutating, need an approval token when `safeForRetry:false`. Action names with delete/remove/import/export/save/new/undo/redo/replace/publish/sync/fix always need a token. Reads: `safeForRetry:true`.
- `description` is what Claude sees later: include the *when* and the limits (saves discovery tokens).

## 5. Tests and build
- `npx tsc --noEmit` (or `npm run build`) is the reliable signal; `npm test` fails here (Node 18.18 vs vitest).
- `cd Civil3D-MCP-Plugin && dotnet build -c Release /p:Civil3DReferencesPath="..\C_References"` (Git Bash: prefix `MSYS_NO_PATHCONV=1`). `C_References/` is gitignored and often missing: rebuild it with 6 DLLs from `C:\Program Files\Autodesk\AutoCAD 2027\`: `accoremgd`, `acdbmgd`->`AcDbMgd`, `acmgd` (root), `AecBaseMgd` (`ACA\`), `AeccDbMgd` and `AeccPressurePipesMgd` (`C3D\`).
- Catalog changed -> `npm run docs:generate` (regenerates `docs/tools.generated.md`).

## 6. Deploy (subagent `civil3d-deploy`)
1. DLL -> `C:\ProgramData\Autodesk\ApplicationPlugins\Civil3DMcpPlugin.bundle\Contents\`; Civil 3D must be closed (DLL locked): **ask before closing it** and save first.
2. `npm run package:claude`, copy `build/` -> the extension's `server\` folder. Claude Desktop is an MSIX app: real path `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\Claude Extensions\local.mcpb.steven-bouldin.civil3d-mcp\server\`; `%APPDATA%\Claude\...` only resolves from virtualized processes (the session's Bash), and PowerShell reports "does not exist". `verify-deploy.ps1` checks both.
3. **The user** fully restarts Claude Desktop and opens a new conversation (a subagent cannot).
- Only the response shape of an existing action changed: layer 1 + restart Civil 3D is enough.
- Verify: `powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/skills/civil3d-mcp-workflows/scripts/verify-deploy.ps1 foo_bar`. After a rebuild Civil 3D shows "Unsigned Executable File"; "Always Load" stops it.

## 7. AutoCAD API gotchas already solved
- Xrefs: `Database.OverlayXref(path,name)` / `AttachXref(path,name)` then a `BlockReference` with the xref id.
- Import **one** block from another DWG: `Database.WblockCloneObjects` with an `ObjectIdCollection` holding only that block, from a `Database` loaded with `ReadDwgFile`. Not `Database.Insert` (brings the whole model space).
- `Database.Audit(AuditInfo)` is NOT available in this SDK: use `Editor.Command("_.AUDIT","_Y")` in command context.
- PURGE: collect ids of all symbol tables, call `database.Purge(ids)`, delete what remains in the collection.
- MLeader: `new MLeader()` -> `SetDatabaseDefaults` -> style from `MLeaderStyleDictionaryId` -> `MText` -> `AddLeaderLine(pt)` + `AddLastVertex`; moving leader vertices needs separate leader APIs (unsupported).
- Linetypes: `LookupUtils.GetOrLoadLinetypeId` loads from `acad.lin`/`acadiso.lin`. `Solid.GetPointAt(short 0..3)`, `Hatch.PatternName`, `Hatch.NumberOfLoops` exist.
- Switch active document: `App.DocumentManager.MdiActiveDocument = doc` inside `ExecuteInCommandContextAsync`.
