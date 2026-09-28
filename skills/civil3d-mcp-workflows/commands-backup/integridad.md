---
description: Corre la prueba de integridad (despliegue en 3 capas, docs, agentes, memoria, registro de bugs, plugin en vivo) y explica cada FAIL/WARN
argument-hint: "[--with-tests | --skip-live | --offline]"
---
Trabaja en español. Ejecuta `node ~/.claude/skills/civil3d-mcp-workflows/scripts/integrity-check.mjs $ARGUMENTS` (solo lectura). Resume: cuántos FAIL/WARN/OK, y para cada FAIL/WARN la causa y el arreglo exacto (SKILL.md flujo J y `references/troubleshooting.md`). Arregla lo que sea seguro (docs, memoria, espejo de memoria, registro); para lo destructivo o que publica (cerrar Civil 3D, reiniciar Claude Desktop, `sync-skill-to-fork.sh`) pide confirmación. Termina con la línea de resumen del script.
