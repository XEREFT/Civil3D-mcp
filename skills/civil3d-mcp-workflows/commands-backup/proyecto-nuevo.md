---
description: Prepara un proyecto nuevo (carpetas, xrefs, plantilla, project.json, datos del POC y del Property Appraiser) y lista los pasos que quedan en Civil 3D
argument-hint: "--name \"NOMBRE\" [--project-no ..] [--poc <POC.pdf>] [--topo <X-TOPO.dwg>] [--util ..] [--arch ..] [--template-from <C-300 anterior.dwg>] [--xy x,y]"
---
Trabaja en español. Corre primero `node ~/.claude/skills/civil3d-mcp-workflows/scripts/new-project.mjs $ARGUMENTS --dry-run`, muéstrame el plan y, con mi visto bueno, sin `--dry-run`. Si faltan argumentos (nombre, POC, X-TOPO/X-UTIL/X-ARCH, C-300 anterior como plantilla) pregúntamelos de una vez. Después ejecuta los pasos "NEXT" que imprime el script con la skill `civil3d-mcp-workflows` (receta Fase 1, §9 de references/c300-water-sewer-plan.md) y termina con `/fase1`. Registra las decisiones con `project-state.mjs decide`. Nunca uses datos de la guía; el POC y el Property Appraiser son las fuentes.
