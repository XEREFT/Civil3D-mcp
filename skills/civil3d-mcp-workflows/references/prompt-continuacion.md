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
| QC automatizado (plot + comparación) | skill `scripts/qc-plot.ps1`, `scripts/qc-compare.py`; SKILL.md flujo H |
| Deploy en 3 capas y diálogo "Unsigned Executable File" | agente `civil3d-deploy` (sección "Scripted shortcuts"), memoria `plugin-deployment-gotcha`, `scripts/install-plugin-dll.ps1`, `verify-deploy.ps1`, `close-civil3d.ps1` |
| Probar plugin sin reiniciar Claude Desktop | skill `scripts/plugin-rpc.mjs` |
| Síntoma → causa → arreglo (etiquetas apiladas, MLeaders sin envolver, `OFF: 0.00'R`, viewport `1" = 1'`, …) | skill `references/troubleshooting.md` |
| Flujo de trabajo del agente de proyectos nuevos | agente `civil3d-new-project` (fases 2–4 + scripts) |
| Respaldo de la skill en el fork | rama `skill/civil3d-mcp-workflows` (3b9cdd8) vía `scripts/sync-skill-to-fork.sh` (solo con tu orden) |
| Estado del proyecto | memoria `villa-one-c300-status` (+ `villa-one-c300-history`) |
