# Arquitectura del plugin y cómo agregar un handler nuevo

Repo: `C:\Users\camil\OneDrive\Documents\Civil3D-mcp` (fork local de Sacred-G/Civil3D-mcp). Target: `net10.0-windows`. El Civil 3D instalado en esta máquina es **2027** (los docs dicen 2026).

## Contenido
1. Flujo de una llamada
2. Patrón de 4 archivos (checklist)
3. Plantilla C# (lectura, escritura y comando nativo)
4. Plantilla TypeScript (acción + alias)
5. Tests y build
6. Despliegue (3 capas)
7. Gotchas de la API de AutoCAD ya resueltos

## 1. Flujo de una llamada
```
MCP tool "acad_foo"  →  toolManifest.ts (registerManifestTools)
   →  domains/<dominio>Domain.ts: exposure resolveAction → action "foo"
   →  approval policy (capabilities / safeForRetry / regex de nombre)
   →  execute: withApplicationConnection(c => c.sendCommand("fooBar", params))
   →  TCP localhost:8080, JSON-RPC 2.0 {jsonrpc, id, method:"fooBar", params}
   →  PluginRuntime (cola de host) → CommandDispatcher.DispatchAsync switch
   →  XxxCommands.FooBarAsync(parameters) → CivilExecution.ReadAsync/WriteAsync
   ←  Dictionary<string,object?> serializado → validado con responseSchema Zod
```
Nombres: el método del plugin va en **camelCase** (`createMLeader`), la acción en **snake_case** (`create_mleader`) y el alias en `acad_<acción>` o `civil3d_<dominio>_<acción>`.

## 2. Patrón de 4 archivos (todos juntos, siempre)
1. `Civil3D-MCP-Plugin/<Area>Commands.cs`: el método `public static Task<object?> FooBarAsync(JsonObject? parameters)`. Si el área es nueva, crea un archivo `XxxCommands.cs` (como `LayerXrefCommands.cs` o `PurgeAuditCommands.cs`).
2. `Civil3D-MCP-Plugin/CommandDispatcher.cs`: el `case` `"fooBar" => XxxCommands.FooBarAsync(parameters),`, junto a los de su grupo.
3. `src/tools/domains/<dominio>Domain.ts`:
   a. El esquema Zod `FooBarArgs` con `action: z.literal("foo_bar")`.
   b. La entrada en `actions` (capabilities, requiresActiveDrawing, safeForRetry, pluginMethods, execute).
   c. La acción agregada al `z.enum([...])` del `inputShape` de la herramienta agregada, más sus campos como `.optional()` en ese inputShape.
   d. La exposición alias `{ toolName:"acad_foo_bar", … supportedActions:["foo_bar"], resolveAction }`.
4. Tests: `tests/domain_manifest.test.ts` (`expect(geometry!.operations).toContain("foo_bar")`) y `tests/tool_catalog.test.ts` (agregar `"acad_foo_bar"` a `requiredTools`).

Verificación mecánica:
`node ~/.claude/skills/civil3d-mcp-workflows/scripts/check-new-action.mjs fooBar foo_bar acad_foo_bar`

## 3. Plantilla C#
Helpers de parámetros (`PluginRuntime`): `GetRequiredString`, `GetRequiredDouble`, `GetRequiredInt`, `GetOptionalString`, `GetOptionalDouble`, `GetOptionalInt`, `GetOptionalBool`.
Errores: `throw new JsonRpcDispatchException("CIVIL3D.<CODE>", "mensaje accionable")`. Los códigos son `INVALID_INPUT`, `OBJECT_NOT_FOUND`, `API_ERROR`, `CONFLICT`, etc. El mensaje debe decirle a Claude qué hacer (p. ej. "Use listOpenDocuments to see what's open").
Utilidades: `CivilObjectUtils.GetRequiredObject<T>(tx, id, mode)`, `LookupUtils` (capas, linetypes, sites) y `FileBoundary` (validación de rutas de import/export).

**Parsear parámetros fuera del lambda** (así fallan rápido, sin ocupar la cola).

```csharp
// Escritura con transacción (crear/editar/borrar entidades)
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
    // ... cambios ...
    return new Dictionary<string, object?> { ["handle"] = handleValue, ["updated"] = true };
  });
}
```
- **Lectura:** igual, pero con `CivilExecution.ReadAsync`. Devuelve **un objeto** (`{ "entities": [...] }`), nunca un array suelto, porque Zod lo rechaza.
- **Comando nativo** (AUDIT, NEW y similares, sin transacción): `CivilExecution.ExecuteInCommandContextAsync<object?>(async () => { doc.Editor.Command("_.AUDIT", "_Y"); return ...; })`.
- Espacio destino: en un handler de creación, **no** escribas `blockTable[BlockTableRecord.ModelSpace]` directamente. Usa los helpers de `AcadCommands.cs`:
  ```csharp
  var space = ParseTargetSpace(parameters);                              // fuera del lambda
  var layoutName = PluginRuntime.GetOptionalString(parameters, "layout");
  // dentro de WriteAsync:
  var (targetSpace, targetLayoutName) = ResolveTargetSpace(database, transaction, space, layoutName);
  targetSpace.AppendEntity(entity);
  ```
  Del lado TS: agrega `space: z.enum(["model","paper"]).optional(), layout: z.string().optional()` al esquema, al `execute` y al alias. Hoy lo usan `createText`, `createMText` y `createMLeader`.
- Filtros de listado: acepta `contains`, `layer`, `space`, `limit` (máx. 500) y proximidad `nearX/nearY/nearRadius`, igual que los `list_*` existentes.

## 4. Plantilla TypeScript (en `geometryDomain.ts` o en el dominio correspondiente)
```ts
const FooBarArgs = z.object({ action: z.literal("foo_bar"), handle: z.string().min(1), layer: z.string().optional() });

// dentro de actions:
foo_bar: { action: "foo_bar", inputSchema: FooBarArgs, responseSchema: GenericResponseSchema,
  capabilities: ["edit"], requiresActiveDrawing: true, safeForRetry: false, pluginMethods: ["fooBar"],
  execute: async (args) => await withApplicationConnection(async (appClient) =>
    await appClient.sendCommand("fooBar", { handle: args.handle, layer: args.layer })) },

// en exposures (alias):
{ toolName: "acad_foo_bar", displayName: "AutoCAD Foo Bar",
  description: "<qué hace + cuándo usarlo + qué NO hace>",
  inputShape: { handle: z.string().min(1), layer: z.string().optional() },
  supportedActions: ["foo_bar"],
  resolveAction: (rawArgs) => ({ action: "foo_bar", args: { action: "foo_bar", ...rawArgs } }) },
```
- `capabilities`: `query`/`inspect`/`analyze` son de lectura. `create`/`edit`/`delete`/`manage`/`import`/`export` son mutantes y exigen token de aprobación si `safeForRetry:false`. Los nombres de acción con delete/remove/import/export/save/new/undo/redo/replace/publish/sync/fix siempre exigen token.
- Las lecturas llevan `safeForRetry: true`.
- La `description` es lo que Claude ve en el futuro: incluye el *cuándo* y los límites, porque ahorra tokens de descubrimiento.

## 5. Tests y build
- `npx tsc --noEmit` (o `npm run build`) es la señal fiable. `npm test` falla en esta máquina (Node 18.18 vs vitest).
- `cd Civil3D-MCP-Plugin && dotnet build -c Release /p:Civil3DReferencesPath="..\C_References"`. En Git Bash, anteponer `MSYS_NO_PATHCONV=1`.
- `C_References/` suele **faltar** (está en gitignore). Se reconstruye con 6 DLL de `C:\Program Files\Autodesk\AutoCAD 2027\`: `accoremgd`, `acdbmgd`→`AcDbMgd`, `acmgd` (raíz), `AecBaseMgd` (`ACA\`), `AeccDbMgd` y `AeccPressurePipesMgd` (`C3D\`).
- Si cambiaste el catálogo, ejecuta `npm run docs:generate` para regenerar `docs/tools.generated.md`.

## 6. Despliegue: subagente `civil3d-deploy`
1. DLL → `C:\ProgramData\Autodesk\ApplicationPlugins\Civil3DMcpPlugin.bundle\Contents\`. Civil 3D debe estar cerrado porque el DLL queda bloqueado. **Pregunta antes de cerrar Civil 3D** y guarda antes.
2. `npm run package:claude` y copiar `build/` → la carpeta `server\` de la extensión. Claude Desktop es una app MSIX, así que la ruta real es `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\Claude Extensions\local.mcpb.steven-bouldin.civil3d-mcp\server\`. `%APPDATA%\Claude\…` solo resuelve desde procesos virtualizados, como el Bash de la sesión. Desde la herramienta PowerShell aparece como "no existe". `verify-deploy.ps1` revisa ambas rutas.
3. **El usuario** reinicia Claude Desktop por completo y abre una conversación nueva (un subagente no sirve).
- Si solo cambió la forma de la respuesta de una acción existente, basta con la capa 1 y reiniciar Civil 3D.
- Verificación: `powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/skills/civil3d-mcp-workflows/scripts/verify-deploy.ps1 foo_bar`.
- Después de un rebuild aparece el diálogo "Unsigned Executable File" al abrir Civil 3D. Si el usuario elige "Always Load", no vuelve a salir.

## 7. Gotchas de la API de AutoCAD ya resueltos
- Xrefs: `Database.OverlayXref(path, name)` / `AttachXref(path, name)` y luego un `BlockReference` con el id del xref.
- Importar **un** bloque desde otro DWG: `Database.WblockCloneObjects` con un `ObjectIdCollection` que contenga solo ese bloque, desde una `Database` cargada con `ReadDwgFile`. No usar `Database.Insert`, que trae todo el model space.
- `Database.Audit(AuditInfo)` **no** está disponible en este SDK. Usa `Editor.Command("_.AUDIT", "_Y")` en el contexto de comando.
- PURGE: recolecta los ids de todas las symbol tables, llama a `database.Purge(ids)` y borra lo que quede en la colección.
- MLeader: `new MLeader()` → `SetDatabaseDefaults` → estilo desde `MLeaderStyleDictionaryId` → `MText` → `AddLeaderLine(pt)` + `AddLastVertex`. Mover los vértices del leader requiere APIs de leader aparte (hoy no está soportado).
- Linetypes: `LookupUtils.GetOrLoadLinetypeId` carga desde `acad.lin` o `acadiso.lin`.
- `Solid.GetPointAt(short 0..3)`, `Hatch.PatternName` y `Hatch.NumberOfLoops` existen.
- Cambiar el documento activo: `App.DocumentManager.MdiActiveDocument = doc`, dentro de `ExecuteInCommandContextAsync`.
