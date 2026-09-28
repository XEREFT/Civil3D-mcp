---
description: Dejar el DWG activo de Civil 3D en Fase 1 pura (solo existente) y entregarlo — audita, limpia, guarda, plotea y copia el PDF a _QC
argument-hint: "[ruta al DWG o nada = documento activo]"
---
Trabaja en español. Ejecuta el flujo I de la skill `civil3d-mcp-workflows` (SKILL.md + `references/c300-water-sewer-plan.md` §9 "Fase 1: definición de terminado") sobre: $ARGUMENTS (si está vacío, el documento activo de Civil 3D; la guía/objetivo solo se LEE, nunca se guarda).

Pasos, sin re-derivar nada (todo está en la skill):
1. `node ~/.claude/skills/civil3d-mcp-workflows/scripts/integrity-check.mjs --skip-live --brief` (0 FAIL) + `civil3d_health` + `acad_list_open_documents`.
2. `node .../scripts/fase1-audit.mjs` para ver qué falta. Si el archivo trae fases 2/3: respaldo del DWG guardado en `_backup_<fecha>_antes_limpieza_PROP\`, `node .../scripts/fase1-cleanup-plan.mjs` y ejecutar el plan (`acad_erase_entities` en UNA lista, `civil3d_pipe_network_delete`, `civil3d_pressure_network_delete`, `acad_layout delete_layout`, `civil3d_alignment delete` del FH1).
3. Estilo `BCC - ALIGNMENT` con `civil3d_alignment set_style` y borde EG oculto (`acad_create_or_update_layer C-TINN-BNDY frozen:true`). SAN/WM existentes = capas X-UTIL tal como llegan. Ninguna palabra PROP/PROPOSED (rótulo del sujeto y notas MD-WASD: `scripts/fase1-strip-prop-notes.mjs`).
4. Guardar (`civil3d_drawing save`, aprobación) y correr `node .../scripts/fase1-finish.mjs` (dump + audit + plot + chequeo del PDF + copia a `_QC\` conservando el anterior en `_QC\_prev`). Debe terminar en READY.
5. Deja TODO registrado sin que lo pida: memoria del proyecto (estado + pendientes), skill/agentes si aprendiste algo, `integrity-check.mjs` (0 FAIL). `sync-skill-to-fork.sh` solo si lo pido.
Recuerda: aprobaciones de herramientas de UNA acción = `action` interna y `parameters` solo con los argumentos (SKILL.md §2.4); una aprobación por vez si el dibujo cambia entre borrados.
