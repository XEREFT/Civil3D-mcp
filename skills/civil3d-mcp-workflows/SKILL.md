---
name: civil3d-mcp-workflows
description: Mapa operativo para automatizar Autodesk Civil 3D 2026 vía el MCP Civil3D-mcp (Sacred-G, herramientas mcp__Civil_3D_MCP__civil3d_* y acad_*). Úsala SIEMPRE que la tarea toque Civil 3D / AutoCAD / DWG a través del MCP: water connection plans, water main / pressure network, sewer / pipe network, redlines / QC markup vs Submittal PDF, correcciones en plan sheets, title blocks, tablas de revisión, notas de tapping sleeve, etiquetas de servidumbre (easement), MLeaders, xrefs, capas, alineaciones, perfiles, superficies, grading, cantidades, sheet sets, coordenadas NAD83 Florida East (FL83-EF), símbolos WASD Miami-Dade; también cuando falle la conexión con el plugin ("Failed to connect", "Command timed out", C3DMCPSTATUS, approval token) o cuando haya que agregar un handler C# nuevo al plugin o redesplegarlo. Trigger also on English phrasing: "QC this sheet against the redline", "fix the plan sheet", "add a leader", "Civil 3D isn't responding", "add a new MCP tool".
---

# Civil 3D MCP — flujos de trabajo

Esta skill es el **mapa mental**, no el manual. Los esquemas exactos de cada herramienta
ya están en el propio MCP. Para el detalle fino consulta esas fuentes, no esta skill:

- `list_tool_capabilities` (o `civil3d_docs` action `list_tool_capabilities`) → dominios, acciones, `safeForRetry`, métodos del plugin.
- `civil3d_help` (`search`, `get_topic`, `search_videos`) → ayuda oficial indexada de Autodesk.
- `ToolSearch select:<tool>` → cargar el esquema de una herramienta diferida antes de llamarla.

Repo del plugin: `C:\Users\camil\OneDrive\Documents\Civil3D-mcp` (C# en `Civil3D-MCP-Plugin/`, servidor Node en `src/`).
Scripts de esta skill: `~/.claude/skills/civil3d-mcp-workflows/scripts/` (Node 18 + PowerShell; **no hay Python en esta máquina**).

---

## 0. Pre-flight (siempre, antes de cualquier otra llamada)

1. `civil3d_health` → revisa **todo**, no solo `connected`:
   - `drawingLoaded: false` → no hay documento enfocado.
   - `operationInProgress: true` con `currentOperationDurationMs` > ~30 s → **diálogo modal bloqueando Civil 3D**. Detente y pide al usuario revisar la ventana de Civil 3D. No reintentes en bucle.
   - `queueDepth` cerca de `queueCapacity` → espera; no encoles más.
2. `acad_list_open_documents` → confirma que el DWG correcto está abierto. Si no es el activo: `acad_set_active_document { match: "<substring del nombre/ruta>" }`. **No existe herramienta para abrir un DWG desde disco**: si no está abierto, el usuario debe abrirlo.
3. `get_drawing_info` → anota `unsavedChanges`. Si ya es `true` **antes** de que edites, hay trabajo humano no revisado: al final guarda con Save As en una carpeta fechada, no en sitio (ver §3).
4. Si algo falla → `references/troubleshooting.md` **antes** de reintentar. Diagnóstico rápido desde la shell:
   `powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/skills/civil3d-mcp-workflows/scripts/c3d-health.ps1`

## 1. Árbol de decisión: tipo de tarea → referencia / subagente

| Si la tarea es… | Lee | Delegable a subagente |
|---|---|---|
| Corregir plan sheets contra un PDF redlineado (DG) y un Submittal sellado; notas, callouts, servidumbres, tapping sleeve, tabla de revisiones, MLeaders | `references/redline-qc-workflow.md` | `civil3d-qc-redline` (solo lectura/diff; las escrituras en sesión principal) |
| Identificar un símbolo/abreviatura WASD que no es bloque ni texto | `redline-qc-workflow.md` §Símbolos + `C:\Users\camil\OneDrive\Documents\Civil3D-mcp\docs\reference\wasd-symbol-legend.md` | `wasd-symbol-reference` |
| Armar la hoja C-300 Water & Sewer Plan desde X-TOPO: alineación de calles, cotas de R/W, rótulos, folio/P.B. del Property Appraiser, DVIEW TWist | `references/c300-water-sewer-plan.md` + `scripts/pa-lookup.mjs` + `scripts/dwg-dump.ps1` | — |
| Proyecto nuevo, xrefs (X-ARCH/X-TOPO/X-UTIL), capas, colores, purge/audit, cambiar de documento | `references/drawing-setup-xrefs-layers.md` | `civil3d-new-project` (convenciones de la firma) |
| Alineaciones, estaciones, station/offset ↔ XY, perfiles, PVI, K, profile views | `references/alignments-profiles.md` | — |
| Red a presión (agua) o gravedad (sanitario/pluvial), fittings, appurtenances, cover, hidráulica, separaciones | `references/pipe-networks.md` | — |
| Superficies, volúmenes, grading, feature lines, hidrología, detención | `references/surfaces-grading.md` | — |
| Sheet sets, sheet views, publish PDF, title blocks, numeración "X OF Y" | `references/plan-production-sheets.md` | — |
| Sistema de coordenadas, NAD83 FL East, COGO, puntos, model vs paper space | `references/coordinates-cogo.md` | — |
| QC automático, cantidades, reportes, costos | `references/tool-index.md` (§qc, §quantity) | — |
| "¿Qué herramienta hace X?" | `references/tool-index.md` | — |
| Error de conexión / timeout / token / herramienta que no aparece | `references/troubleshooting.md` | — |
| Agregar un comando/handler nuevo al plugin | `references/plugin-architecture.md` + `scripts/check-new-action.mjs` | `civil3d-deploy` (para desplegar) |

Lee **solo** la referencia que corresponde. Cada una es autosuficiente.

## 2. Reglas de oro (aplican a todo flujo)

1. **Leer antes de escribir.** Toda edición parte de un `acad_list_*` o `get` que devuelve el `handle` y el valor crudo actual. Nunca edites por memoria ni por resumen de una sesión anterior.
2. **Filtros baratos primero.** `acad_list_text_entities { contains: "<subcadena distintiva>" }` antes que listar todo. Usa `layer`, `space`, `nearX/nearY/nearRadius`, `limit`.
3. **Salidas grandes → script, no contexto.** Si la salida se persiste en un archivo (`Output too large … saved to …`), resúmela con
   `node ~/.claude/skills/civil3d-mcp-workflows/scripts/summarize-entities.mjs <archivo> [--by layer|color|type] [--contains TEXTO]`.
4. **Aprobación para mutaciones.** Las acciones que crean/editan/borran/guardan requieren `approvalToken`:
   - `civil3d_request_approval { toolName, action, parameters }` → token.
   - Llama a la herramienta con **exactamente** los mismos parámetros + `approvalToken`.
   - El token es **exacto por parámetros** (byte a byte; un tab real vs `\t` lo invalida), **por estado del dibujo** (hash de `get_drawing_info`: cualquier otra edición intermedia lo invalida) y **vence en 5 min**. → Pide un token nuevo inmediatamente antes de *cada* escritura. Si falla con "does not match", no depures: vuelve a pedir el token con el valor exacto.
   - `civil3d_preview_action` dice si una acción requiere aprobación sin ejecutarla.
5. **Escrituras en la sesión principal, no en subagentes.** El clasificador de auto-mode deniega mutaciones desde subagentes. Si un subagente choca con eso, debe devolver herramienta + parámetros exactos + handles, y la sesión principal ejecuta.
6. **Verificar la verdad, no solo la coincidencia.** Una estación/offset/coordenada/número de hoja en un texto es una afirmación física: corrobórala contra el dibujo (`civil3d_alignment` `station_to_point`, geometría cercana) antes de escribirla. Si los PDFs coinciden pero el dibujo no lo corrobora → avisa al usuario.
7. **Edita la subcadena, preserva el formato.** Toma el `text` crudo (códigos MText `\P`, `\f…;`, `\H…;`, tabs reales) y cambia solo lo necesario. Corrige ortografía/puntuación de lo nuevo; si el PDF fuente tiene un error, señálalo en vez de propagarlo o "arreglarlo" en silencio.
8. **Estaciones casi idénticas.** STA 10+30.52 y 10+35.52 con el mismo offset son objetos distintos. Compara la cadena completa de estación.
9. **Guardar al cerrar cada hoja.** `civil3d_drawing` action `save` (requiere token). Si el dibujo tenía `unsavedChanges` previos → pregunta y usa Save As en carpeta fechada (p. ej. `…\<proyecto>\YYYY-MM-DD_QC\`).
10. **Borrar es decisión del usuario.** `acad_erase_entity` y `acad_purge_unused` solo con confirmación explícita. Duplicados "sospechosos" se reportan, no se borran.
11. **DWG duplicados.** Si `Glob` encuentra más de una copia del archivo, pregunta cuál es la viva.
12. **Pasos sin herramienta = manuales.** Abrir DWG, Batch Plot, Sunshine 811 y la revisión de PDF por el EOR los hace el usuario. Dilo; no inventes workarounds.
13. **Sub-tareas viejas.** Si una sub-tarea dependía de una premisa que resultó falsa, pregunta si sigue vigente.

## 3. Flujos estándar ya validados (resumen; detalle en references)

**A. Redline → plan sheet** (`redline-qc-workflow.md`): pre-flight → localizar el DWG vivo → leer la hoja N del DG y del Submittal con `Read` → tabla de diff (ubicación | DG | Submittal | acción) → confirmar con el usuario → por fila: `acad_list_text_entities contains` → verificar estación → approval → `acad_update_text_content` → siguiente → `save` → reporte con handles.

**B. Setup de proyecto / xrefs** (`drawing-setup-xrefs-layers.md`): `acad_create_or_update_layer XREF` → `acad_attach_xref` (Overlay por defecto, 0,0,0, escala 1) → verificar con `acad_list_block_references` → `acad_audit_drawing` → guardar.

**C. Alineación + perfil** (`alignments-profiles.md`): `civil3d_alignment list/get` → `set_station_equation` si 0+00 debe moverse → `civil3d_profile create_from_surface` → `create_layout` / `add_pvi` / `add_curve` → `check_k_values` → `view_create`.

**D. Red de agua a presión** (`pipe-networks.md`): `civil3d_pipe_catalog` → `civil3d_pressure_network_create` → `assign_parts_list` → `pressure_pipe_add` → `pressure_fitting_add` / `appurtenance_add` → `set_cover` → `validate` → `civil3d_qc_check_pipe_network` → `civil3d_qty_pressure_network_lengths`.

**E. Producción de planos** (`plan-production-sheets.md`): `civil3d_sheet_set_list/get_info` → `sheet_add` / `sheet_view_create` / `set_scale` → title block (texto) → `civil3d_sheet_publish_pdf` o `civil3d_workflow_plan_production_publish`.

**F. QC antes de entregar**: `civil3d_workflow_drawing_readiness_audit` → `civil3d_qc_check_*` (drawing_standards, alignment, profile, pipe_network, labels) → `civil3d_qc_report_generate`. Complementa con el checklist manual de `pipe-networks.md` §Checklist.

Los `civil3d_workflow_*` son orquestaciones del lado del plugin. Úsalos cuando el flujo coincide completo; para pasos sueltos usa las herramientas atómicas.

## 4. Ahorro de tokens: cómo trabajar

- Carga esquemas con `ToolSearch select:a,b,c` en **una** llamada con todas las herramientas previstas.
- Prefiere la herramienta de dominio agregada (`civil3d_pipe` + `action`) cuando vas a usar varias acciones del mismo dominio: es un solo esquema cargado. Los alias (`civil3d_pressure_pipe_add`) son equivalentes.
- No listes el catálogo completo; usa `tool-index.md`.
- Resume salidas grandes con `scripts/summarize-entities.mjs`.
- Cotas y viewports: `acad_list_dimensions` / `acad_create_aligned_dimension` / `acad_list_viewports` / `acad_set_viewport_twist`. Rutas de xref y DWG que no están abiertos: `scripts/dwg-dump.ps1 <dwg>` (Core Console sobre una copia; lee el último estado guardado).
- Datos de propiedad Miami-Dade: `node scripts/pa-lookup.mjs --xy X,Y` (coords del dibujo) — no navegues la web del PA.
- Al final de una sesión de proyecto, deja el estado en memoria del proyecto (hecho / pendiente / handles / gotchas). No lo pongas en esta skill: la skill contiene solo patrones generales.

## 5. Cómo expandir esta skill (cuando el plugin gane una capacidad nueva)

Mecánico, sin reescribir nada:

1. **Implementa y despliega** la capacidad siguiendo `references/plugin-architecture.md` (patrón de 4 archivos) y valida con
   `node ~/.claude/skills/civil3d-mcp-workflows/scripts/check-new-action.mjs <pluginMethod> <action_snake> <tool_name>`,
   luego el subagente `civil3d-deploy` y `scripts/verify-deploy.ps1 <action_snake>`.
2. **Registra la herramienta** en `references/tool-index.md` con la plantilla de su §"Plantilla de entrada" (nombre MCP, dominio, cuándo usarla, payload mínimo, handler C#, fecha), dentro de la sección del dominio.
3. **Si habilita o cambia un flujo**, agrega 1–3 líneas en el paso correspondiente de la referencia de dominio (y en §3 de este archivo solo si es un flujo nuevo completo).
4. **Si descubriste un error nuevo**, agrega una fila a la tabla de síntomas de `references/troubleshooting.md`.
5. **Si aparece un tipo de tarea nuevo**, agrega una fila al árbol de §1 y crea `references/<dominio>.md` (índice al inicio si supera ~300 líneas).
6. **Si la tarea es determinística y ya se repitió 2+ veces**, conviértela en `scripts/<nombre>.mjs|.ps1` (Node 18 o PowerShell, sin dependencias externas) y menciónala en la referencia que la usa.

No copies en la skill descripciones de parámetros que ya da `list_tool_capabilities`; guarda solo el *cuándo* y el *gotcha*.
