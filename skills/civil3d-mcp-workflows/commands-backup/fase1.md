---
description: Dejar el DWG activo de Civil 3D en Fase 1 pura (solo existente) y entregarlo — audita, limpia con UNA aprobación de plan, guarda, plotea y copia el PDF a _QC
argument-hint: "[ruta al DWG o nada = documento activo]"
---
Trabaja en español. Ejecuta el flujo I de la skill `civil3d-mcp-workflows` (SKILL.md + `references/c300-water-sewer-plan.md` §9 "Fase 1: definición de terminado") sobre: $ARGUMENTS (si está vacío, el documento activo de Civil 3D; la guía/objetivo solo se LEE, nunca se guarda).

Pasos, sin re-derivar nada (todo está en la skill):
1. Arranque: `node ~/.claude/skills/civil3d-mcp-workflows/scripts/integrity-check.mjs --skip-live --brief` (0 FAIL) + `civil3d_health` + `acad_list_open_documents`. Estado del proyecto: `node .../scripts/project-state.mjs show <carpeta>` (si no hay project.json: `init` y `poc-extract.mjs <POC.pdf> --project <carpeta>`).
2. Auditar: `civil3d_workflow_fase1_audit` (nativo, en vivo; si la herramienta aún no existe: `node .../scripts/fase1-audit.mjs`). Cada FAIL trae la llamada que lo arregla.
3. Si trae fases 2/3: respaldo del DWG guardado en `_backup_<fecha>_antes_limpieza_PROP\`, `node .../scripts/fase1-cleanup-plan.mjs` y ejecutar el plan con **una sola** `civil3d_request_plan_approval` (todos los pasos con aprobación, en orden: `delete_layout`, `delete_pressure_network`, `erase_entities` en UNA lista, `delete_pipe_network` por cascarón, `delete` del FH1, `set_style`, capa `C-TINN-BNDY` congelada) y luego cada paso con su token (SKILL.md §2.4 para el formato de `parameters`).
4. Estilo `BCC - ALIGNMENT`, borde EG oculto, SAN/WM existentes = capas X-UTIL tal como llegan, ninguna palabra PROP/PROPOSED (notas MD-WASD: `civil3d_workflow_fase1_build { expectedDocument: "<este DWG>" }` las limpia en una llamada — reescribe la nota de la hoja, borra las de fuera de la hoja, sube lo que quedó debajo y guarda; a mano: `scripts/fase1-strip-prop-notes.mjs` + `fase1-notes-shift.py`; rótulo del sujeto: `project.json`). Vuelve a auditar hasta 0 FAIL.
5. Guardar (`civil3d_drawing save`, aprobación) y correr `node .../scripts/fase1-finish.mjs` (dump + audit + plot + revisión del PDF + comparación con el PDF aprobado + copia a `_QC\` conservando el anterior + actualiza project.json). Debe terminar en READY.
6. Deja TODO registrado sin que lo pida: `project-state.mjs decide/log`, memoria, skill/agentes si aprendiste algo, `integrity-check.mjs` (0 FAIL). `sync-skill-to-fork.sh` solo si lo pido.
