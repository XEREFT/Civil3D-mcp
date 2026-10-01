# Automatización: qué ya corre solo y qué sigue (actualizado 2026-09-28 noche)

## Auditoría 2026-09-28 (noche): cómo llegar a "Villa One Fase 1" con menos recursos en cada proyecto nuevo
Disparada por: un bug real de cotas encontrado a mano (comparando VILLA ONE contra su guía) que un chequeo automático
debería haber visto solo. Diagnóstico: **sí existía** el chequeo (script `fase1-audit.mjs`), pero **no** en la
herramienta nativa `civil3d_workflow_fase1_audit` (la que usan los subagentes sin Bash) — las dos rutas se habían
desincronizado sin que nada lo avisara. Cerrado esta sesión:
- Chequeo #6 (texto de cota desprendido de su línea) portado a `fase1Audit.ts` (antes solo en el script) — commit local `dcfb89e`. Necesita desplegar capa Node + reiniciar Claude Desktop para que la herramienta nativa lo traiga en vivo (el script ya lo tiene).
- **Nuevo meta-chequeo en `integrity-check.mjs`** ("`fase1-audit.mjs == fase1Audit.ts checks`"): compara los nombres de chequeo literales entre el script y la herramienta nativa; FAIL/WARN si alguno tiene uno que el otro no. Así esta clase de bug (un chequeo agregado a una sola de las dos rutas) no vuelve a pasar desapercibida.

### Medidas propuestas — estado tras la construcción de A (2026-09-28 noche)
| # | Propuesta | Impacto | Esfuerzo | Estado |
|---|---|---|---|---|
| A | **`civil3d_workflow_fase1_build` nativo** | Muy alto | Alto | **CONSTRUIDO y VALIDADO en vivo 2026-09-28**; sus 5 brechas + 2 más **arregladas y automatizadas** la misma noche (`/fase1-build`). Ver detalle abajo. |
| B | **`civil3d_workflow_project_qc` nativo**: fusionar `fase1_audit` + los 4 `civil3d_qc_check_*` + `drawing_readiness_audit` en una sola llamada de QC. | Medio (ahorra ~5 llamadas en la fase 4) | Medio | Sin construir. Solo tiene sentido una vez que fase 2-4 se retomen en otro proyecto real. |
| C | **Ampliar el meta-chequeo de deriva** a otros pares script/nativo que puedan existir a futuro. | Bajo esfuerzo, protección genérica | Bajo | Sin construir. Solo aplica cuando aparezca un segundo caso real. |
| D | **`project.json` con un campo `dimensionStyle`/`shortDimensionFix` explícito** por proyecto (escala de hoja distinta de 1:20). | Bajo | Muy bajo | Sin construir. Ningún proyecto real lo ha necesitado aún. |

### A — `civil3d_workflow_fase1_build` (CONSTRUIDO y VALIDADO en vivo 2026-09-28)
- Consolida en **1 llamada** los pasos 6-13 del §7 (`c300-water-sewer-plan.md`): abrir plantilla, guardar-como, adjuntar xrefs (Overlay), crear el alineamiento (con estilo/labelSet), importar la definición del bloque `_cl` y colocar el resto del lote de entidades, girar el viewport C-300 y la pestaña Model, editar texto del cuadro de título por subcadena, guardar.
- Sin código C# nuevo: orquesta RPC ya existentes (`newDrawing`, `saveDrawing`, `attachXref`, `createAlignment`, `insertBlockReference`, `createEntities`, `setViewportTwist`, `listTextEntities`, `updateTextContent`) — igual patrón que `fase1_audit` (TS puro, `src/tools/domains/fase1Build.ts`, probado con cliente falso en `tests/fase1_build.test.ts`, 7 pruebas nuevas, 446 en total).
- Se detiene en el primer paso que falla; los siguientes quedan `skipped`; nada de lo ya hecho se deshace o reintenta solo.
- A propósito NO lee X-TOPO/PA/as-builts — eso lo sigue haciendo `c300-build-spec.mjs`/`pa-lookup.mjs`/`poc-extract.mjs` (Node, fuera del plugin); este tool solo dibuja el `spec.json` que le pasen.
- Deploy: capa Node (`server/`) ya copiada; falta el reinicio de Claude Desktop (nombre de tool nuevo — no se puede invocar en la sesión que lo construyó, ni un subagente lo ve).
- **Validado 2026-09-28** sobre una copia de descarte (`VILLA ONE @XEREFT FASE1-BUILD-TEST.dwg`, luego a la Papelera) con el `spec.json` de VILLA ONE regenerado: **9/9 pasos OK en 1 llamada** (3 xrefs, alineamiento, `_cl`, 18 entidades, giro C-300 + Model, save). Comparado contra `FASE 1.dwg` real (dump de solo lectura): alineamiento 440.00 ft `BCC - ALIGNMENT`, `CDF1` 268.4891° mismo centro/escala, Model 268.4891°, xrefs relativos overlay, CL y `_cl` idénticos a 0.01 ft; rótulos con mismo texto/estilo/altura/rotación (la real los tiene en la posición del replay del paquete). Receta y gotchas en `tool-index.md`.
- **Brechas encontradas en la validación → ARREGLADAS 2026-09-28 noche** (usuario: "arreglas todo de una vez y lo dejas automatizado"):
  1. Spec + `project.json` schema 1 → `c300-build-spec.mjs` lo lee directo; `site.window` es opcional (se deriva del grupo de entidades del X-TOPO alrededor de `site.lotPoint`; VILLA ONE da el mismo spec); VILLA ONE ya tiene `site.lotPoint`/`site.window` guardados.
  2. Notas PROP de la plantilla → paso nativo **"Fase 1 notes"** del tool (default `stripPropNotes:true`): borra las notas PROP fuera de la hoja, reescribe la nota MD-WASD de la hoja y **sube los glifos huérfanos** "(NOT PART OF M-WASD NOTES…)" midiendo la nota antes/después (C# nuevo, solo lectura: `listTextEntities` devuelve `minX/minY/maxX/maxY`). Regla única en `src/tools/domains/fase1PropNotes.ts` (el script `fase1-strip-prop-notes.mjs` la importa de `build/`; la auditoría también). Llamado solo con `{ expectedDocument }` = arreglo en 1 llamada del FAIL de notas de `fase1_audit`.
  3. Documento activo → `expectedDocument` (o `saveAs`) obligatorio; guardias antes de escribir, antes de guardar y tras `newDrawing` (el "save as" no renombra otro documento).
  4. Plantilla fuera de las raíces → `c300-prep-template.ps1` y `fase1-build-payload.mjs` la rechazan antes; `new-project.mjs` crea `<proyecto>\_template.dwg` con `-DeleteLayouts C-301`.
  5. Detalle del giro → "viewport CDF1: twist 359.11° -> 268.4891°, center …, scale …".
  6. (extra) `titleBlock` ignoraba el layout (`listTextEntities` no filtra por layout) → filtrado en TS + FAIL si el fragmento es ambiguo.
  7. (extra) Armar el payload a mano (con el tropiezo de las barras invertidas) → **`scripts/fase1-build-payload.mjs --dir <carpeta>`** + comando **`/fase1-build`**; se niega a construir sobre un archivo existente sin `--overwrite`.
  Tests: 461 en el repo (+15: guardias, layout, notas con el texto real de la plantilla como fixture, huérfanos, giro). 6 entradas nuevas en `known-bugs.json` con chequeos. Desplegado (DLL + Node).
- **Guardias + notas VALIDADAS en vivo 2026-10-01** (copia `FASE1-BUILD-TEST2.dwg`, se conserva en la carpeta de VILLA ONE): 15/15 OK, glifos subidos 45 entidades +7.621, `fase1_audit` 0 FAIL, plot de las notas idéntico al entregado. Las corridas destaparon 2 bugs, ya arreglados con test: campos del esquema que el MCP borraba (`1ec99e2`) y caja falsa del MText que dejaba los glifos abajo sin avisar (`6f8d4c4`). 476 tests.
- **Sin créditos (2026-10-01, SIN PROBAR):** `scripts/fase1-build-run.mjs` corre el mismo código compilado del tool + la auditoría nativa directo contra el plugin, desde la terminal del usuario (plan en seco por defecto; `--build` pide escribir el nombre del destino en una terminal interactiva; `--finish` encadena `fase1-finish.mjs`). El modo automático de Claude no lo deja correr (es la versión sin token de aprobación); la primera corrida la hace el usuario.
- Detalle de payload: `references/tool-index.md` (sección `civil3d_workflow_fase1_build`).

## Ya automatizado (no volver a preguntar cómo se hace)
| Necesidad | Cómo se dispara | Qué hace | Dónde |
|---|---|---|---|
| Saber si algo se desincronizó (3 capas de despliegue, docs, agentes, memoria, regresiones) | **Hook SessionStart** (silencioso si todo está OK, ~2 s) · `/integridad` · `node scripts/integrity-check.mjs` | 60 bugs conocidos con chequeos + chequeos genéricos | `scripts/integrity-check.mjs`, `references/standards/known-bugs.json` |
| Cerrar un proyecto en Fase 1 | `/fase1` (guía el flujo completo) · `node scripts/fase1-finish.mjs` (cola posterior al guardado, ~9 s) | dump + audit 0 FAIL + plot + revisión del PDF (0 texto < 5 pt, sin PROP/PROPOSED) + copia a `_QC\` conservando el anterior en `_QC\_prev` | `scripts/fase1-audit.mjs`, `fase1-cleanup-plan.mjs`, `fase1-finish.mjs` |
| Dibujar el C-300 Fase 1 de un proyecto nuevo | **`/fase1-build <carpeta>`** · `node scripts/fase1-build-payload.mjs --dir <carpeta>` + 1 aprobación + `civil3d_workflow_fase1_build` | dump X-TOPO → spec (window automático) → payload → plantilla, guardias de documento, xrefs, alineamiento BCC, `_cl`, entidades, giros, notas sin PROP (+ glifos huérfanos), guardado | `scripts/fase1-build-payload.mjs`, `c300-build-spec.mjs`, `src/tools/domains/fase1Build.ts` |
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
