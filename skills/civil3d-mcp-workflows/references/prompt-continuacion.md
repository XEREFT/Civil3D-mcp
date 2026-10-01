# Prompt de continuación VIGENTE (2026-10-01, noche — motor "Fase 1 desde cero": lo que queda tras el orquestador) — pegar tal cual en un chat nuevo
Antes de pegarlo (usuario): salir del todo de Claude Desktop (bandeja → Salir) y abrir un chat nuevo; Civil 3D abierto (de preferencia sin dibujos).

```
Seguimos con el motor "Fase 1 desde cero" (sin guía: X-TOPO + X-UTIL + X-ARCH + escaneos + Property Appraiser). Responde en español.

Contexto grabado (no lo rederives): skill civil3d-mcp-workflows `references/automation-backlog.md` §B (bloques «1.5 + etapa 3 COMPLETOS» y «1.7 COMPLETO + orquestador»); memorias `fase1-from-scratch-engine`, `fase1-use-runner`, `fase1-titleblock-source`, `asbuilts-always-scanned`, `github-publishing`.

Decisiones ya tomadas (no preguntar): title block = plantilla de Goulds + valores del proyecto (nombre, dirección, proyecto, AGR DEL POC = 33810 en VILLA ONE, hoja, fecha, JH; aprobó CF fijo); «la página» = Property Appraiser; el plat P.B. 46 PG 94 NO existe en AUTOCAD @XEREFT y el usuario no lo tiene.

Hecho y validado (VILLA ONE, copias TEST7–TEST9): TODO el camino en UN comando — `node scripts/fase1-from-scratch.mjs --dir <carpeta> --dwg "<destino nuevo>.dwg" --template <t.dwg> --asbuilt <asbuilt.json> --blocks-from <C-300 del paquete>` (payload con PL + cotas R/W + etiquetas de utilidades + title block desde project.json → runner sin créditos → plot + fase1-qc.py → lazo de despeje de MLeaders): QC 0 FAIL / 0 WARN / 16 OK, sin datos de Goulds en el plot. Plugin a2e52a5 y skill en el fork (PR #16).

Pasos sugeridos (elige con el usuario):
1. Hook de integridad sin FAIL; `node scripts/integrity-check.mjs --only deploy` = 0 FAIL. ToolSearch `select:mcp__Civil_3D_MCP__civil3d_workflow_fase1_build`: el esquema debe traer `blockImports` y `freezeLayers` (chat nuevo tras el reinicio).
2. 1.9 etiquetas Civil 3D «general note» que FASE 1 trae y el motor no: ~30 EOP / EXIST R/W + 2 «ALIGNMENT START» (derivarlas del survey y la alineación, solo como examen contra FASE 1; sin datos de la guía).
3. Punto ciego del QC: texto SHX del survey (SIGNAL, W.P.) que cruza un rótulo nuestro (sale como trazos en el PDF): detectar por tinta ajena dentro de la caja del rótulo.
4. 1.4 U.E.: bloqueada hasta tener el PDF del plat del Clerk (P.B. 46 PG 94 NO está en AUTOCAD @XEREFT); cuando exista: OCR + ubicación con Lot_poly y meterla en la lista de evitar de los PL.
5. Etapa 2 "Fase 1 Studio" (app local en el navegador: arrastrar los 3 DWG + escaneos → revisar → 1 botón, usando fase1-from-scratch.mjs) y etapa 3 (tablero de proyectos).
6. Probar el camino completo en un proyecto NUEVO distinto de VILLA ONE (p. ej. 12300 SW 232 ST → pa-site.mjs) para validar el title block con otra dirección.

Reglas que ya rigen: nunca datos de la guía; construir con el runner / fase1-from-scratch.mjs (regla en .claude/settings.local.json); FASE 1, TEST2, TEST3 y la carpeta Propuesta no se tocan sin su OK; confirma antes de guardar/borrar archivos reales; respaldo antes de tocar un archivo real; push al fork / sync de la skill solo si lo pide. Copias de descarte en la carpeta de VILLA ONE: _template-BUILD-TEST.dwg, FASE1-BUILD-TEST7/8/9.dwg (no borrar sin preguntar).
```

---
# (anterior, 2026-10-01 — YA EJECUTADO: pasos 1.5 despeje, etiquetas en el build y prueba TEST7–TEST9)
Antes de pegarlo (usuario): salir del todo de Claude Desktop (bandeja → Salir) y abrir un chat nuevo; Civil 3D abierto sin dibujos.

```
Seguimos con el motor "Fase 1 desde cero" (sin guía: X-TOPO + X-UTIL + X-ARCH + escaneos + Property Appraiser). Responde en español.

Contexto grabado (no lo rederives): skill civil3d-mcp-workflows `references/automation-backlog.md` §B (diseño, estado y valores de prueba); memorias `fase1-from-scratch-engine`, `fase1-use-runner`, `asbuilts-always-scanned`, `villa-one-c300-status`, `github-publishing`.

Hecho y validado en VILLA ONE: 1.1 as-builts escaneados (scan-ocr.ps1 → asbuilt-extract → asbuilt-associate → asbuilt-review.py → asbuilt-build → c300-utility-labels; rótulos idénticos a FASE 1), 1.2 pa-site.mjs (también dentro de new-project.mjs), 1.3 cotas de R/W del survey en el payload, 1.6 símbolos PL en el payload (15 = FASE 1), 1.8 fase1-qc.py (QC sin guía, dentro de fase1-finish; FASE 1 = 0 FAIL 0 WARN 14 OK), 1.5 parcial (máscaras en rótulos de calle/lote; PL que esquivan anotaciones con --avoid). Build con el runner sin créditos (freezeLayers X-TOPO|DIM, chequeo 7 de la auditoría). Plugin debddec (PR #16), skill 99afb9f en el fork.

Pasos:
1. Hook de integridad sin FAIL; `node scripts/integrity-check.mjs --only deploy` = 0 FAIL. ToolSearch `select:mcp__Civil_3D_MCP__civil3d_workflow_fase1_build`: su esquema debe traer `freezeLayers` (si no, el reinicio no llegó — avísame).
2. 1.5 despeje general de MLeaders: usar los choques que reporta fase1-qc.py (posición en modelo + handle) para proponer movimientos de texto de MLeader (acad_update_text_content {handle, x, y}) que eviten cotas, símbolos PL y otros rótulos; primero en una copia en %TEMP% (patrón try-move: Core Console + qc-plot + fase1-qc), nunca en el archivo real sin mi OK.
3. Integrar en el build las etiquetas de utilidades de la cadena de as-builts (c300-utility-labels → mismo lote de entidades) y que pasen el QC.
4. Prueba completa desde cero en una copia de descarte de VILLA ONE (FASE1-BUILD-TEST7…): payload → runner --build --confirm → etiquetas → fase1-qc; comparar con FASE 1 solo como examen.
Pendientes míos: PDF del plat P.B. 46 PG 94 (1.4 U.E.) y qué datos del title block cambian por proyecto (1.7) — pregúntamelos si llegas ahí.

Reglas que ya rigen: nunca datos de la guía; construir con el runner (`node C:/Users/camil/.claude/skills/civil3d-mcp-workflows/scripts/fase1-build-run.mjs …`, regla en .claude/settings.local.json); FASE 1, TEST2, TEST3 y la carpeta Propuesta no se tocan sin mi OK; confirma conmigo antes de guardar/borrar archivos reales; respaldo antes de tocar un archivo real; push al fork / sync de la skill solo si lo pido.
```

---
# (anterior, 2026-10-01 — motor "Fase 1 desde cero", etapa 1; YA EJECUTADO hasta 1.8)
Antes de pegarlo (usuario): si no lo hiciste, salir del todo de Claude Desktop y abrir un chat nuevo (el tool MCP `civil3d_workflow_fase1_build` gana `freezeLayers`; el runner ya lo usa sin reinicio).

```
Seguimos con la etapa 1 del motor "Fase 1 desde cero" (sin guía: 3 DWG + escaneos + Property Appraiser). Responde en español.

Contexto grabado (no lo rederives): skill `references/automation-backlog.md` §B (diseño, estado de cada paso, valores de prueba de VILLA ONE); memorias `fase1-from-scratch-engine`, `fase1-use-runner`, `asbuilts-always-scanned`, `villa-one-c300-status`. Hecho: 1.1 as-builts escaneados de punta a punta (scan-ocr.ps1 → asbuilt-extract → asbuilt-associate → asbuilt-review.py → asbuilt-build → c300-utility-labels; VILLA ONE = rótulos idénticos a FASE 1), 1.2 pa-site.mjs, build/auditoría con freezeLayers X-TOPO|DIM + chequeo 7 (commit debddec, PR #16), runner sin créditos por defecto.

Siguiente, en este orden (cada uno con prueba en una copia de descarte de VILLA ONE — FASE 1, TEST2 y TEST3 no se tocan):
1. 1.6 símbolos PL dentro del build (c300-pl-symbols.mjs ya existe, desde las líneas de lote del PA): que fase1-build-payload.mjs los agregue a `entities`.
2. 1.3 cotas de R/W calculadas del survey (líneas de R/W del X-TOPO), comparadas con las 16 cotas C-ANNO de FASE 1.
3. 1.5 motor de colocación de rótulos (dentro del viewport, sin choques; validar con el plot).
4. 1.8 QC sin guía (lista "¿está todo?" + reglas + datos cruzados).
5. Que new-project.mjs use pa-site.mjs.
Pendientes del usuario: PDF del plat P.B. 46 PG 94 (para 1.4 U.E.) y qué datos del title block cambian por proyecto (1.7).

Reglas que ya rigen: nunca datos de la guía; construir con el runner (`node C:/Users/camil/.claude/skills/civil3d-mcp-workflows/scripts/fase1-build-run.mjs …`, regla de permiso en .claude/settings.local.json); confirma conmigo antes de guardar/borrar archivos reales; push al fork / sync de la skill solo si lo pido.
```

---
# (anterior, 2026-09-28 tarde noche — primera corrida en vivo de fase1_build endurecido; YA EJECUTADO: pasó 2026-10-01)
Antes de pegarlo (pasos del usuario): cerrar Civil 3D uno mismo (la guía está abierta; Claude nunca la cierra) → que Claude corra `pwsh scripts/deploy-all.ps1 -Go` (instala el DLL con la extensión de textos) → aprobar el diálogo "Unsigned Executable File" → salir del todo de Claude Desktop y abrir un chat nuevo.

```
Retomamos civil3d_workflow_fase1_build tras endurecerlo (commit 0e85bd8, branch local/deploy-acad-plus-schema-fix, ya subido al fork: PR #16; skill sincronizada con la rama skill/civil3d-mcp-workflows): guardias de documento activo (expectedDocument), paso nativo de notas PROP con glifos huérfanos, spec con project.json schema 1 + window automático, script fase1-build-payload.mjs y comando /fase1-build. Ya desplegué el DLL y reinicié Claude Desktop. Responde en español.

Contexto grabado (no lo rederives): memoria `fase1-build-tool-status`; skill `references/tool-index.md` (entrada civil3d_workflow_fase1_build) y `references/automation-backlog.md` §A.

Pasos:
1. Hook de integridad sin FAIL; `node scripts/integrity-check.mjs --only deploy` = 0 FAIL. ToolSearch `select:mcp__Civil_3D_MCP__civil3d_workflow_fase1_build`: su esquema debe traer `expectedDocument`, `stripPropNotes` y `sheet` (si no, el reinicio no llegó — avísame).
2. Primera corrida en vivo sobre una COPIA de descarte de VILLA ONE: plantilla con `c300-prep-template.ps1 -Source <Goulds C-300> -Out "<carpeta VILLA ONE>\_template-BUILD-TEST.dwg" -DeleteLayouts C-301`, luego `node scripts/fase1-build-payload.mjs --dir "<carpeta VILLA ONE>" --template "<esa plantilla>" --dwg "VILLA ONE @XEREFT FASE1-BUILD-TEST.dwg"` (dilo antes de crear archivos; nunca sobre FASE 1.dwg real).
3. Aprobación + `civil3d_workflow_fase1_build` con el payload idéntico. Esperado: check new drawing is active → save as → check active document → 9 pasos como la validación → "Fase 1 notes" = borra CF57/CF6E/CF75, reescribe CF80 y "moved N entit(ies) … up ~7.6" → check before save → save. Luego `civil3d_workflow_fase1_audit` = 0 FAIL.
4. Plot de la copia (`qc-plot.ps1`) y compara el recorte de las notas con `_QC\C-300 FASE 1.pdf` (los glifos "(NOT PART OF M-WASD NOTES…)" deben quedar bajo "PROJECT SPECIFIC NOTES").
5. Si algo falla: paso exacto y detalle; no reintentes el payload a ciegas. Si todo sale bien: archivos de prueba a la Papelera (la pestaña la cierro yo) y marca en `fase1-build-tool-status` que la corrida en vivo pasó.

Reglas que ya rigen: nunca guardes ni cierres la guía; T25-06.212 fuera de alcance; confirma conmigo antes de guardar/borrar archivos reales; push al fork / sync de la skill solo si lo pido.
```

---
# (anterior, 2026-09-28 noche — validar civil3d_workflow_fase1_build; YA EJECUTADO: 9/9 OK)

```
Retomamos la validación de `civil3d_workflow_fase1_build`, el tool nativo que se construyó en la sesión anterior (commit local `36e6c6a`, branch `local/deploy-acad-plus-schema-fix`, sin pushear) para dibujar un C-300 Fase 1 completo en una sola llamada. Reinicié Claude Desktop, así que debería aparecer ya en ToolSearch. Responde en español.

Contexto ya grabado (no lo rederives): memoria `villa-one-c300-status` (última sección, "2026-09-28 noche, propuesta A construida"), skill `references/automation-backlog.md` (sección "A — construido") y `references/tool-index.md` (entrada `civil3d_workflow_fase1_build`). Código: `src/tools/domains/fase1Build.ts` + `tests/fase1_build.test.ts` (7 pruebas con cliente falso, ya pasan; 446 pruebas totales en el repo).

Pasos:
1. Confirma que el hook de integridad al arrancar no muestra FAIL. Con `ToolSearch` (`select:mcp__Civil_3D_MCP__civil3d_workflow_fase1_build`), confirma que el tool nuevo carga (si no aparece, el reinicio no llegó a tiempo — avísame, no insistas).
2. Genera el spec de VILLA ONE de nuevo, para tener un caso con respuesta ya conocida: `dwg-dump.ps1` sobre `X-TOPO.dwg` de `C:\Users\camil\OneDrive\Documents\AUTOCAD @XEREFT\VILLA ONE @XEREFT\`, luego `c300-build-spec.mjs --topo <dump> --project "...\VILLA ONE @XEREFT\project.json" --out spec.json` (usa el scratchpad de la sesión, no la carpeta del proyecto).
3. Prepara una plantilla de descarte con `c300-prep-template.ps1` y ábrela con `civil3d_drawing new` en una ruta de PRUEBA, nunca sobre `VILLA ONE @XEREFT FASE 1.dwg` ni sus archivos reales — usa un nombre tipo `VILLA ONE @XEREFT FASE1-BUILD-TEST.dwg` y dilo explícitamente antes de crear el archivo.
4. Llama `civil3d_workflow_fase1_build` con los xrefs (X-TOPO/X-UTIL/X-ARCH), `spec.alignment`, `spec.twist` (y el giro de Model, §7.11b de `c300-water-sewer-plan.md`), `spec.createEntities` como `entities`/`layers`, y `clImport` para el bloque `_cl` (blockName `_cl`, sourceFilePath = X-TOPO.dwg). Sin `titleBlock` en esta primera prueba. `save:true`.
5. Compara el resultado (`outputs.steps[]`) contra los datos ya conocidos de VILLA ONE en la memoria (alineamiento 440 ft, giro 268.49°, etc.) y, si quieres, contra el propio `VILLA ONE @XEREFT FASE 1.dwg` real (solo lectura).
6. Si algo falla: reporta el paso exacto, no reintentes el payload completo a ciegas — decide conmigo si es un bug del tool nuevo o un dato mal armado en el spec.
7. Si todo sale bien: borra el archivo de prueba (a la Papelera, nunca borrado permanente) y actualiza `villa-one-c300-status` + `automation-backlog.md` marcando la propuesta A como validada.

Reglas que ya rigen, no las repitas ni las preguntes: nunca guardes ni cierres `C-300_GUIA_COMO_DEBE_QUEDAR.dwg` (guía, solo comparación); T25-06.212 sigue fuera de alcance salvo que yo lo pida explícitamente; confirma conmigo antes de guardar/borrar sobre archivos reales del proyecto.
```

---
# (anterior, 2026-09-28 sesión 2 — Fase 1 de VILLA ONE CERRADA)
```
Continuamos VILLA ONE (26-04.047), entregable "VILLA ONE @XEREFT FASE 1.dwg" (carpeta C:\Users\camil\OneDrive\Documents\AUTOCAD @XEREFT\VILLA ONE @XEREFT\). Responde en español.
Estado (2026-09-28, tarde): Fase 1 pura TERMINADA, guardada y con PDF _QC\C-300 FASE 1.pdf regenerado: alineación SW 118TH AVE = BCC - ALIGNMENT, cascarones PROP SAN SEWER y EXIST WM CROSSING borrados, fase1-audit.mjs con --dump = 0 FAIL, 0 palabras PROP/PROPOSED (solo "SUBJECT PROPERTY", legítimo).
Decidido: las líneas "SINGLE FAMILY RESIDENCE" y "510 GPD" SE QUEDAN. No queda nada pendiente en este archivo; si no te doy tarea nueva, pregúntame cuál sigue.
Lee antes: memoria `villa-one-c300-status`, `fase1-standard`, `guide-is-target-only`, `integrity-second-brain` y corre `node scripts/integrity-check.mjs` (0 FAIL esperado; el WARN de la rama del fork es normal hasta que pida sync); skill civil3d-mcp-workflows (SKILL.md flujo I y §2.4 sobre aprobaciones de herramientas de una acción).
PENDIENTE AUTORIZADO: en cuanto veas las herramientas nuevas (prueba de que reinicié Claude Desktop), haz el push del commit 8c29f8a del plugin al fork (rama local/deploy-acad-plus-schema-fix, PR #16) y corre sync-skill-to-fork.sh --yes, sin volver a preguntarme; detalle en la memoria `pending-push-after-restart`.
Automatización disponible (2026-09-28, léela en references/automation-backlog.md): comandos /fase1, /lote, /proyecto-nuevo, /integridad; project.json por proyecto (scripts/project-state.mjs); herramientas nuevas civil3d_workflow_fase1_audit, acad_list_layers y civil3d_request_plan_approval (visibles solo tras reiniciar Claude Desktop; si no aparecen: pwsh scripts/verify-deploy.ps1 list_layers); el hook de arranque ya corre integrity-check en silencio.
Reglas fijas: la guía es solo objetivo/comparación; SAN/WM existentes = X-UTIL amarillo tal como llegan; toda alineación de C-300 = BCC - ALIGNMENT. Al terminar deja TODO registrado sin que lo pida: memoria, skill, agentes y repo (sync-skill-to-fork.sh solo si lo pido).
```

---
# (anterior, 2026-09-28 mañana — ya ejecutado)
```
Continuamos VILLA ONE (26-04.047), entregable "VILLA ONE @XEREFT FASE 1.dwg" (carpeta C:\Users\camil\OneDrive\Documents\AUTOCAD @XEREFT\VILLA ONE @XEREFT\). Responde en español.
Estado: el 2026-09-28 se dejó en Fase 1 pura (sin C-301, sin redes/perfiles/etiquetas propuestas, borde EG oculto con la capa C-TINN-BNDY congelada), guardado, y el PDF _QC\C-300 FASE 1.pdf regenerado; respaldo previo en _backup_2026-09-28_antes_limpieza_PROP\. El plugin ya tiene 3 acciones nuevas desplegadas (DLL + servidor): civil3d_alignment set_style, acad_erase_entities (borrado masivo, 1 aprobación) y civil3d_pipe_network_delete.
Haz ahora, en orden:
1. Lee la memoria `villa-one-c300-status` (sección 2026-09-28), `guide-is-target-only`, `plugin-deployment-gotcha`, `github-publishing` y la skill `civil3d-mcp-workflows` (SKILL.md flujo I, references/c300-water-sewer-plan.md §9 "Fase 1: definición de terminado").
2. Comprobación de arranque: ToolSearch "select:mcp__Civil_3D_MCP__civil3d_alignment_set_style,mcp__Civil_3D_MCP__acad_erase_entities,mcp__Civil_3D_MCP__civil3d_pipe_network_delete" (deben existir; si no, Claude Desktop no se reinició: `pwsh scripts/verify-deploy.ps1 set_style`). civil3d_health + acad_list_open_documents (FASE 1 debe estar abierto; la guía solo se LEE).
3. Aplica el estilo de la firma a la alineación: civil3d_alignment set_style {name:"SW 118TH AVE", style:"BCC - ALIGNMENT"} (aprobación fresca). Comprueba que las etiquetas de estación siguen siendo el label set "Major and Minor only" (si el color sigue rojo, revisa el label set con civil3d_label). Borra los cascarones vacíos de gravedad con civil3d_pipe_network_delete {name:"PROP SAN SEWER"} y {name:"EXIST WM CROSSING"}.
4. node scripts/fase1-audit.mjs (--dump de dwg-dump.ps1 del archivo guardado; sale FAIL solo por el estilo de la alineación hasta el paso 3) hasta 0 FAIL. Ya decidido y aplicado el 2026-09-28: en Fase 1 no queda NINGUNA palabra PROP/PROPOSED (línea "PROP ONE (1) 5,200 SF" quitada del rótulo del sujeto; notas MD-WASD con PROP/PROPOSED quitadas, incluido el bloque "THE FOLLOWING ACTIVITIES…"; ya guardado y con el PDF regenerado). Pregunta solo esto: ¿también deben salir del rótulo las líneas "SINGLE FAMILY RESIDENCE" y "510 GPD"? Guarda (aprobación), qc-plot.ps1 -Layouts C-300 y copia el PDF a _QC\C-300 FASE 1.pdf.
Reglas fijas: la guía es solo objetivo/comparación (nunca guardarla ni tocarla); SAN/WM existentes = capas X-UTIL (amarillo, SANITARY_LINE/WM) tal como llegan; toda alineación de C-300 = BCC - ALIGNMENT. Al terminar deja TODO registrado sin que lo pida: memoria, skill, agentes y repo (sync-skill-to-fork.sh solo si lo pido).
```

---
# (anterior, 2026-09-26)
# Prompt de continuación (VILLA ONE / Civil3D-MCP) — pegar tal cual en un chat nuevo tras reiniciar Claude Desktop

```
Continuamos el proyecto VILLA ONE (26-04.047), planos C-300/C-301 de agua y alcantarillado WASD con Civil3D-MCP. Responde en español.
Estado al cierre de la sesión anterior (2026-09-26): fases 1–4 TERMINADAS. Entregable = "VILLA ONE @XEREFT FASE 1.dwg" (Model + C-300 + C-301; único archivo de Fase 1, ya renombrado desde el antiguo "v2"; versiones viejas en la Papelera) con PDFs finales en _QC\ ("C-300 FASE 1.pdf", "C-301 FASE 1.pdf"). El plugin ganó herramientas nuevas (commit 75c00a5 en la rama local/deploy-acad-plus-schema-fix, ya subido al fork: PR #16 abierto, head 75c00a5); DLL y capa Node ya desplegados.

Antes de tocar nada, sin re-derivar lo ya hecho:
1. Lee la memoria `villa-one-c300-status` (estado + qué se arregló + handles), `guide-is-target-only`, `plugin-deployment-gotcha` y `github-publishing`.
2. Usa la skill `civil3d-mcp-workflows`: SKILL.md (flujos G "replay" y H "Fase 4 QC"), references/c300-water-sewer-plan.md §9 (Recetas Fase 1, 2, 3, 4), references/tool-index.md (últimos bloques "Cambios de plugin 2026-09-26") y references/troubleshooting.md. Scripts en scripts/: qc-plot.ps1, qc-compare.py, plugin-rpc.mjs, close-civil3d.ps1 (-AllowSave/-Discard), install-plugin-dll.ps1, verify-deploy.ps1, sync-skill-to-fork.sh, replay-from-package.cjs, c301-profile-annos.cjs, vp-annoscale-fix.scr.txt.
3. Comprobación de arranque (1 vez): ToolSearch "select:mcp__Civil_3D_MCP__acad_layout" y confirma que el enum trae `set_viewport_scale` (si no: Claude Desktop no se reinició o la capa 2 no se copió → `pwsh scripts/verify-deploy.ps1 set_viewport_scale`). Luego abre Civil 3D con `Start-Process "<ruta>\VILLA ONE @XEREFT FASE 1.dwg"` (yo apruebo el diálogo "Unsigned Executable File"; tú nunca lo clickeas), espera el puerto 8080 (si `Start-Process` se lanzó antes de que Civil 3D terminara de cargar, abre `Drawing1.dwg`: relánzalo cuando el puerto esté arriba) y corre civil3d_health + acad_list_open_documents + acad_layout list_layouts (isCurrent) + acad_list_viewports (annotationScale debe ser `1" = 20'` en cada viewport de planta/perfil).

Reglas fijas: la guía C-300_GUIA_COMO_DEBE_QUEDAR.dwg y Draft 1.pdf son SOLO objetivo para comparar, nunca fuente de datos (fuentes: survey X-TOPO, as-builts ES9467-2/E14611-2, POC.pdf, PA, paquete del ingeniero — nunca guardar la copia del paquete). No hagas commit ni push salvo que yo lo pida (remoto "fork", gh por ruta completa). No clickees diálogos de seguridad de Civil 3D. Verifica el documento activo antes de modificar; no cierres ni guardes la guía si está abierta. Cambios en el DWG real: Save As con nombre nuevo (p. ej. "FASE 1 v2.dwg"; el clasificador bloquea sobrescribir FASE 1.dwg); al terminar y cerrar Civil 3D, mando FASE 1.dwg/.bak viejos a la Papelera (nunca borrado permanente) y renombro el nuevo a "FASE 1.dwg" para dejar UN solo archivo — solo cuando yo lo apruebe. Lo mismo con los PDFs de _QC\.

Ahorro de tokens: usa las recetas y scripts (no rehagas a mano lo que ya está automatizado): C-301 = acad_layout copy_layout con excludeLayers/excludeBlockNames/excludeWindow/replaceText + 1 acad_create_entities; corregir escala de anotación = acad_layout set_viewport_scale; mover texto/flecha de un MLeader = acad_update_text_content (x,y,rotation,leaderX,leaderY); etiquetas Civil = civil3d_profile_view_apply_annotations (idempotente, con dragged/labelLocation); máscara de MText = backgroundMask; QC = qc-plot.ps1 + qc-compare.py. Pide varias aprobaciones a la vez (civil3d_request_approval en paralelo) y carga esquemas con un solo ToolSearch. Prueba métodos nuevos del plugin con scripts/plugin-rpc.mjs sobre un documento scratch.

Pendientes: ninguno de archivos (ya queda un solo FASE 1.dwg). Si no te doy una tarea nueva en este mensaje, pregúntame cuál sigue. (El commit del plugin y la rama de la skill ya están subidos al fork; para volver a respaldar la skill: `bash scripts/sync-skill-to-fork.sh "<mensaje>" --yes`, solo si yo lo pido.)

Al terminar cualquier trabajo deja TODO registrado sin que yo lo pida: memoria del proyecto (hecho/pendiente/handles/gotchas), skill (receta + tool-index + troubleshooting si se aprendió algo), agentes (.claude/agents/civil3d-new-project.md y civil3d-deploy.md si cambió un proceso), plugin (las 4 capas: C# + dispatcher + TS domain + tests, luego deploy con el agente civil3d-deploy) y una línea en MEMORY.md.
```

## Dónde quedó registrado cada aprendizaje (2026-09-26)
| Qué | Dónde |
|---|---|
| Fases 1–4 de C-300/C-301, recetas paso a paso | skill `references/c300-water-sewer-plan.md` §9 |
| Herramientas nuevas del plugin (idempotencia, escala de anotación, filtros de `copy_layout`, `set_viewport_scale`, mover MLeader, máscara MText) | repo, commit `75c00a5` (subido al fork, PR #16) (C# + `CommandDispatcher.cs` + `geometryDomain.ts`/`profileDomain.ts` + tests + `docs/tools.generated.md`); skill `references/tool-index.md` |
| Variables de sistema (ícono naranja "i" de override = `LABELOVERRIDEGLYPHS`), lista de permitidos | repo (sin commit aún): `SystemVariableCommands.cs` + `drawingRuntimeDomain.ts` + tests; skill `tool-index.md` (`acad_get/set_system_variable`) y `troubleshooting.md`; memoria `sysvar-tool-pending` |
| QC automatizado (plot + comparación) | skill `scripts/qc-plot.ps1`, `scripts/qc-compare.py`; SKILL.md flujo H |
| Deploy en 3 capas y diálogo "Unsigned Executable File" | agente `civil3d-deploy` (sección "Scripted shortcuts"), memoria `plugin-deployment-gotcha`, `scripts/install-plugin-dll.ps1`, `verify-deploy.ps1`, `close-civil3d.ps1` |
| Probar plugin sin reiniciar Claude Desktop | skill `scripts/plugin-rpc.mjs` |
| Síntoma → causa → arreglo (etiquetas apiladas, MLeaders sin envolver, `OFF: 0.00'R`, viewport `1" = 1'`, …) | skill `references/troubleshooting.md` |
| Flujo de trabajo del agente de proyectos nuevos | agente `civil3d-new-project` (fases 2–4 + scripts) |
| Respaldo de la skill en el fork | rama `skill/civil3d-mcp-workflows` (3b9cdd8) vía `scripts/sync-skill-to-fork.sh` (solo con tu orden) |
| Estado del proyecto | memoria `villa-one-c300-status` (+ `villa-one-c300-history`) |
