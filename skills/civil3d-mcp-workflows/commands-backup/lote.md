---
description: Audita en segundo plano todos los proyectos Fase 1 (sin abrir Civil 3D) y muestra qué le falta a cada uno
argument-hint: "[--only <texto del nombre>] [--reuse-dump]"
---
Trabaja en español. Ejecuta `node ~/.claude/skills/civil3d-mcp-workflows/scripts/fase1-batch.mjs --report $ARGUMENTS` (solo lectura; Core Console sobre copias en %TEMP%; tarda unos minutos por proyecto). Muestra la tabla "proyecto → resultado → qué falta" y, para cada FAIL/WARN, el arreglo exacto (flujo I de la skill: `/fase1`, `fase1-finish.mjs`, congelar `C-TINN-BNDY`, etc.). Lo que el modo sin Civil 3D no cubre (redes, perfiles, estilo de alineación) se audita abriendo el archivo con `civil3d_workflow_fase1_audit`. El reporte queda en `AUTOCAD @XEREFT\\_reports\\`. Una tarea programada ya lo corre de lunes a viernes a las 22:00.
