# Automatización: qué ya corre solo y qué sigue (actualizado 2026-09-28)

## Ya automatizado (no volver a preguntar cómo se hace)
| Necesidad | Cómo se dispara | Qué hace | Dónde |
|---|---|---|---|
| Saber si algo se desincronizó (3 capas de despliegue, docs, agentes, memoria, regresiones) | **Hook SessionStart** (silencioso si todo está OK, ~2 s) · `/integridad` · `node scripts/integrity-check.mjs` | 60 bugs conocidos con chequeos + chequeos genéricos | `scripts/integrity-check.mjs`, `references/standards/known-bugs.json` |
| Cerrar un proyecto en Fase 1 | `/fase1` (guía el flujo completo) · `node scripts/fase1-finish.mjs` (cola posterior al guardado, ~9 s) | dump + audit 0 FAIL + plot + revisión del PDF (0 texto < 5 pt, sin PROP/PROPOSED) + copia a `_QC\` conservando el anterior en `_QC\_prev` | `scripts/fase1-audit.mjs`, `fase1-cleanup-plan.mjs`, `fase1-finish.mjs` |
| Desplegar el plugin (3 capas) | `pwsh scripts/deploy-all.ps1` (plan) → `-Go -AllowSave '<dwg>' -Relaunch '<dwg>'` | compila solo si hay .cs más nuevo que el DLL instalado, copia capa 2, cierra Civil 3D con guardas, instala DLL, relanza, espera el 8080, corre integrity-check | `scripts/deploy-all.ps1` (+ agente `civil3d-deploy`) |
| Registrar lo aprendido | regla en SKILL.md §5.4 | fila en `troubleshooting.md` + entrada en `known-bugs.json` (el check falla si divergen) | skill |
| Respaldo (skill + agentes + comandos + hook + memoria) | `bash scripts/sync-skill-to-fork.sh "<msg>" --yes` (solo cuando se pide; sube al fork público) | rama `skill/civil3d-mcp-workflows` + espejo privado de memoria | `scripts/sync-skill-to-fork.sh` |

Pasos que NUNCA se automatizan (decisión de seguridad): aprobar el diálogo "Unsigned Executable File", reiniciar Claude Desktop, cerrar dibujos con cambios ajenos, borrar de forma permanente, publicar/subir al fork sin que lo pidas.

## Estado de las 10 ideas (todas aplicadas el 2026-09-28; el DLL/Node nuevos requieren desplegar: `deploy-all.ps1 -Go` + reinicio de Claude Desktop)
| # | Idea | Estado |
|---|---|---|
| 1 | Lector de capas en el plugin | HECHO: `acad_list_layers` (C# `ListLayersAsync` + TS + pruebas); commit local 8c29f8a |
| 2 | Auditoría Fase 1 nativa | HECHO: `civil3d_workflow_fase1_audit` (`fase1Audit.ts`, 4 pruebas); `fase1-audit.mjs` usa el lector en vivo con respaldo al volcado |
| 3 | Aprobación por plan | HECHO: `civil3d_request_plan_approval` (`approvalPolicy.requestPlan`, 3 pruebas nuevas); atada al documento, en orden, ≤ 40 pasos, ≤ 30 min |
| 4 | `project.json` por proyecto | HECHO: `project-state.mjs` (+ VILLA ONE creado y validado por `integrity-check`) |
| 5 | Auditoría por lote | HECHO: `fase1-batch.mjs` (+ `dwg-dump.ps1` ahora vuelca LAYOUT y texto de paper space) |
| 6 | Tareas programadas | HECHO: `civil3d-integrity-weekly` (lunes 08:30) y `fase1-batch-nightly` (L–V 22:00) — corren con la app abierta |
| 7 | Bootstrap de proyecto nuevo | HECHO: `new-project.mjs` + `/proyecto-nuevo` |
| 8 | PDFs golden | HECHO: en `fase1-finish.mjs` (`_QC\_golden\`, `--approve-golden`) |
| 9 | CI | HECHO: `ci/skill-check.yml` + `scripts/skill-selfcheck.mjs` (lo instala `sync-skill-to-fork.sh` en la rama de la skill); el CI del repo ya corría build/tests/docs |
| 10 | Lector del POC | HECHO: `poc-extract.mjs` (probado con el POC de VILLA ONE: folio, 510 GPD, 1 unidad, 5,200 SF, SFR) |

## Ideas originales, priorizadas (por retorno = veces que se repite × llamadas que ahorra)
1. **Lector de capas en el plugin** (`civil3d_layer list/get`: congelada/apagada/bloqueada, color, tipo de línea) → el audit ya no necesita `dwg-dump.ps1` ni el archivo guardado, y el borde EG se verifica en vivo. Es la única pieza de `fase1-audit` que hoy sale del plugin por el costado (Core Console). Coste: 1 handler C# + dominio TS + tests + deploy (`deploy-all.ps1`).
2. **`civil3d_workflow_fase1_audit` nativo** (TS sobre los métodos que ya usa `fase1-audit.mjs`) → subagentes sin Bash (p. ej. `civil3d-new-project`) pueden auditar; se dispara solo al abrir un proyecto. Depende de la idea 1.
3. **Aprobación por plan**: `civil3d_request_approval` de un plan completo (lista de acciones con hash) → 1 aprobación para los ~10 pasos de la limpieza a Fase 1 en vez de 1 por paso. Requiere cambiar `approvalPolicy.ts` (con pruebas); toca el diseño de seguridad → decidirlo tú.
4. **`project.json` por proyecto** (nombre, AGR/proyecto, fase, entregables, decisiones, rutas de as-builts/POC): hoy el estado vive en prosa de memoria. Con el JSON, los scripts leen/escriben el estado, `integrity-check` puede validar **todos** los proyectos, y la memoria queda solo con lecciones. Con "muchísimos" proyectos en Fase 1 es lo que más escala.
5. **`fase1-batch.mjs`**: recorrer una carpeta de proyectos y, sin abrir Civil 3D (Core Console sobre copias en %TEMP%), auditar capas/xrefs/layouts/texto PROP y plotear; produce una tabla "proyecto → qué le falta". Ideal para una tarea programada nocturna.
6. **Tarea programada** (herramienta `scheduled-tasks`): `integrity-check --with-tests` semanal y `fase1-batch` nocturno, con resumen en `_QC\_reports\`. (No creada: pide tu visto bueno.)
7. **Bootstrap de proyecto nuevo** (`new-project.mjs`): crea `_QC`, `_backup`, copia la plantilla FormTech, adjunta X-TOPO/X-UTIL/X-ARCH, pone capas/escala de anotación, y rellena rótulo y folio con `pa-lookup.mjs` + datos del POC (uso, GPD). Hoy son ~15 llamadas del agente `civil3d-new-project`.
8. **PDFs de referencia ("golden")**: guardar el último `_QC\C-300 FASE 1.pdf` aprobado y hacer `qc-compare.py visual` contra el nuevo en `fase1-finish` → avisa de cambios no intencionales (una etiqueta movida, una capa que reapareció).
9. **CI en el fork** (ya existen `ci.yml` y `civil3d-plugin-ci.yml`): añadir un paso `docs:check` + un job que corra la parte "docs" del integrity-check (no necesita Civil 3D).
10. **Lector de PDF del POC** (uso, GPD, folio) → alimenta el rótulo del sujeto automáticamente; hoy se teclea desde el POC.

## Cómo elegir el siguiente
Empieza por 4 (project.json) y 1–2 (capas + audit nativo): quitan el trabajo manual por proyecto. 5–6 dan tranquilidad a escala. 3 solo si aceptas cambiar el modelo de aprobaciones.
