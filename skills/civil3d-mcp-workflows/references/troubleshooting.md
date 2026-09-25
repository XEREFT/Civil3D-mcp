# Diagnóstico y troubleshooting

Regla: **diagnostica antes de reintentar.** Reintentar a ciegas un comando que se colgó solo agranda la cola del plugin.

## Arquitectura (para saber dónde falla)
```
Claude ──MCP stdio──> servidor Node (extensión Claude Desktop .mcpb)
        ──TCP JSON-RPC localhost:8080──> plugin C# dentro de acad.exe
        ──cola de host (1 operación a la vez)──> API Civil 3D, en el hilo de documento
```
- Timeout de conexión: `CIVIL3D_CONNECT_TIMEOUT` = 5000 ms. Timeout por comando: `CIVIL3D_COMMAND_TIMEOUT` = 120000 ms. Puerto: `CIVIL3D_PORT` = 8080.
- Log del plugin: `%LOCALAPPDATA%\Civil3DMcpPlugin\plugin.log` (o la ruta de `CIVIL3D_MCP_LOG_DIR`). Cada request queda registrado como `-> method [id]` / `<- method … durationMs=`.
- Comandos en la línea de comandos de Civil 3D (los escribe el usuario):
  - `C3DMCPSTATUS` → `listener running: True/False; pending: N; active: True/False; current: <método>`
  - `C3DMCPSTART` / `C3DMCPSTOP` → iniciar o detener el listener TCP sin reiniciar Civil 3D.

## Diagnóstico automático
```
powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/skills/civil3d-mcp-workflows/scripts/c3d-health.ps1
```
Revisa `acad.exe` (vivo y Responding), el puerto 8080, el final de `plugin.log`, envía `getCivil3DHealth` directo por TCP (sin pasar por MCP) y compara la hora de arranque de Claude.exe con la del despliegue.
- Si el TCP directo **responde** pero la herramienta MCP falla, el problema está en el servidor Node o en la extensión.
- Si el TCP directo **no responde**, el problema está en el plugin o en Civil 3D.

## Tabla de síntomas

| Síntoma / mensaje | Significa | Verifica | Acción |
|---|---|---|---|
| `acad_insert_block_reference` / `acad_create_text` / `acad_create_mtext` / `acad_create_mleader` devuelve `layer` distinto al pedido (p. ej. `_NPLT`) | La capa pedida no existe y `LookupUtils.GetLayerId` cae **en silencio** a la capa actual. | Compara `layer` de la respuesta con el pedido. | Borra la entidad y créala con `acad_create_entities` pasando la capa en `layers` (la crea con las propiedades del estándar), o crea antes la capa con `acad_create_or_update_layer`. |
| `The active drawing changed after approval` justo después de otra escritura, o un token nuevo trae el `drawingFingerprint` de **otro** documento | El documento activo cambió (el usuario hizo clic en otra pestaña de Civil 3D, o el fingerprint se tomó antes de que la edición anterior terminara). | `get_drawing_info` → ¿`fileName` es el que esperas? | **No ejecutes** con el token nuevo hasta confirmar el documento: una acción con `layout: "Layout1"` caería en el archivo equivocado. Si cambió → `acad_set_active_document` y pedir token otra vez. |
| `Failed to connect to Civil 3D plugin at localhost:8080` → `CIVIL3D.UNAVAILABLE` | Nadie escucha en 8080. Civil 3D está cerrado, el plugin no cargó o el listener está detenido. | `c3d-health.ps1`: ¿acad.exe corre? ¿el puerto 8080 está en LISTEN? ¿hay un init reciente en `plugin.log`? | Civil 3D cerrado → pedir que lo abra con un dibujo. Abierto sin listener → pedir `C3DMCPSTATUS` y luego `C3DMCPSTART`. Plugin no cargado → revisar el bundle (abajo). |
| `Connection to Civil 3D plugin timed out after 5000ms` | El puerto existe pero no acepta: acad.exe está saturado o en arranque. | ¿Civil 3D está terminando de abrir? ¿aparece "No responde"? | Esperar a que cargue y reintentar **una** vez. |
| `Command timed out after 120000ms: <método>` → `CIVIL3D.TIMEOUT` | El comando **sí llegó**, pero Civil 3D no respondió a tiempo. Puede seguir ejecutándose. | `civil3d_health`: `operationInProgress`, `currentOperation`, `currentOperationDurationMs`. | **No reintentar.** Casi siempre es un diálogo modal (ver abajo). Si es un comando pesado legítimo (volúmenes, rebuild), usar `civil3d_job start` o esperar. |
| `civil3d_health` OK pero una operación lleva más de 30 s | Diálogo modal bloqueando el hilo. | Pedir al usuario que mire la ventana de Civil 3D y el Administrador de tareas ("No responde"). | Que cierre el diálogo. Si no hay diálogo visible: clic dentro de Civil 3D o esperar una regeneración pesada. |
| `CIVIL3D.HOST_BUSY` "host queue is full" | Hay demasiadas operaciones encoladas. | `queueDepth` / `queueCapacity`. | Esperar a que termine la operación actual. No encolar más. |
| `CIVIL3D.NO_DRAWING` / `drawingLoaded:false` | No hay documento activo. | `acad_list_open_documents`. | `acad_set_active_document`, o pedir que abra el DWG. |
| `Tool '<x>' has an invalid outputSchema: JSON Schema declares an unsupported dialect ("$schema": "…draft-07…")` en **todas** las herramientas | El cliente MCP de la app Claude valida los schemas solo con JSON Schema 2020-12 y el SDK del servidor los marca como draft-07. Civil 3D no tiene nada que ver. | `c3d-health.ps1` §3: si el plugin responde por JSON-RPC, la falla es solo del cliente. El texto "unsupported dialect" no existe en `node_modules` (lo lanza el host). | Servidor sin el fix de `src/utils/schemaDialect.ts` (quita `$schema` en `tools/list`) → aplicarlo o actualizar, redesplegar con `civil3d-deploy` y reiniciar la app Claude. No es un problema de reintentar. (2026-09-25) |
| "The active drawing changed … while the operation was queued" | El usuario cambió de pestaña mientras la operación esperaba. No se aplicó nada. | — | Reenfocar con `acad_set_active_document` y repetir. |
| `CIVIL3D.OBJECT_NOT_FOUND` | Handle, nombre de alineación o estilo inexistente, **o estás en otro documento**. | `acad_list_open_documents` → ¿es el documento correcto? Relistar. | Buscar de nuevo con `list_*`. Los handles cambian entre copias del DWG. |
| `CIVIL3D.INVALID_INPUT` | Parámetro inválido (handle no hex, Z en MLeader, etc.). | Cargar el esquema con `ToolSearch`. | Corregir el payload. |
| `CIVIL3D.PATH_NOT_ALLOWED` / `FILE_TYPE_NOT_ALLOWED` | La ruta está fuera de `CIVIL3D_FILE_ROOTS` / `_IMPORT_ROOTS` / `_EXPORT_ROOTS`. | Variables de entorno del proceso acad.exe. | Usar una ruta permitida o pedir al usuario que amplíe la variable. |
| `Approval required` | Acción mutante sin token. | — | `civil3d_request_approval { toolName, action, parameters }`. |
| `Approval token does not match` | Los parámetros no son byte-idénticos (tab real vs `\t`, espacios, orden no importa), el dibujo cambió desde que se emitió o pasaron más de 5 min. | — | Pedir un token nuevo **inmediatamente antes** de reintentar, con el valor exacto. |
| "Blocked by classifier" / denegado en auto-mode | El clasificador de Claude Code bloqueó la llamada: pasa con mutaciones desde un subagente o con herramientas como `attach_xref`. | ¿La llamada viene de un subagente? | Desde un subagente: devolver los parámetros a la sesión principal. Desde la sesión principal: agregar la herramienta a `permissions.allow` y `autoMode.allow` en `.claude/settings.local.json`. Si Claude no puede editar ese archivo, lo hace el usuario. |
| Response inválida: "expected object, received array" | El handler C# devuelve una forma distinta del `responseSchema` Zod. | Comparar el return del C# con el esquema TS. | Arreglar el C#, redesplegar solo la capa 1 y reiniciar Civil 3D (no hace falta un chat nuevo). |
| `CIVIL3D.METHOD_NOT_FOUND` "Plugin method 'x' is not implemented yet" | El TS conoce la acción, pero el DLL cargado es viejo o falta el `case` en `CommandDispatcher.cs`. | `verify-deploy.ps1 <acción>`. | Redesplegar la capa 1 (subagente `civil3d-deploy`). |
| Herramienta nueva ausente en `ToolSearch` | Falta alguna de las 3 capas de despliegue. | `verify-deploy.ps1 <acción>`: repo, build, extensión instalada, DLL de ProgramData y hora de arranque de Claude.exe. | Capa 2: copiar `build/` a la extensión. Capa 3: **el usuario** cierra Claude Desktop por completo y abre una conversación nueva de nivel superior (un subagente no sirve). |
| Civil 3D arranca pero el plugin no carga | Bundle mal nombrado (ya pasó con `PackageContents.xml.txt`), DLL bloqueado o diálogo "Unsigned Executable File". | `C:\ProgramData\Autodesk\ApplicationPlugins\Civil3DMcpPlugin.bundle\PackageContents.xml`. | Renombrar. En el diálogo de seguridad, el usuario elige "Always Load" (el build es propio). |
| `[Warn] [RpcTcpServer] Closed a client that did not send a complete request within 30 seconds` en `plugin.log` | Hay un socket abierto que no envió nada (conexión ociosa del servidor MCP o un sondeo de puerto). | — | Es inofensivo. No indica una falla. |
| `npm test` falla con `styleText` | Node 18.18 es incompatible con vitest. No es un problema de tu cambio. | `node -v`. | Usar `npx tsc --noEmit` / `npm run build` como señal. |

## Diálogos modales conocidos que bloquean
"Unsigned Executable File" (tras cada rebuild del DLL), notificación de xref no encontrado, "Save changes?", pantalla de inicio, proxy objects, "Missing SHX", recuperación de dibujo.

## Códigos de error (`CIVIL3D.*` → JSON-RPC)
`UNAVAILABLE` -32001 · `OBJECT_NOT_FOUND` -32004 · `TIMEOUT` -32008 · `CONFLICT` -32009 · `CANCELLED` -32010 · `INVALID_INPUT` -32602 · `METHOD_NOT_FOUND` -32601 · resto -32000 (`API_ERROR`, `TRANSACTION_FAILED`, `HOST_BUSY`, `NO_DRAWING`, `PATH_NOT_ALLOWED`, `FILE_IO_ERROR`, `COMMAND_FAILED`, `QC_ERROR`, `INTERNAL_ERROR`).
Del lado Node, los mensajes se clasifican por regex: /timed out/ → TIMEOUT; /failed to connect|connection closed/ → UNAVAILABLE; /not found/ → OBJECT_NOT_FOUND.

## Protocolo ante un fallo (en orden)
1. Leer el mensaje exacto y ubicarlo en la tabla.
2. Ejecutar `civil3d_health` (o `c3d-health.ps1` si MCP no responde).
3. Si hay operación colgada o sin conexión, explicar al usuario **qué revisar en su pantalla** y detenerse.
4. Reintentar como máximo una vez, y solo después de un cambio de condición (diálogo cerrado, Civil 3D abierto, token nuevo).
