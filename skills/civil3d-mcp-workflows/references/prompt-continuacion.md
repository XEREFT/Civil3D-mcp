# Prompt de continuación VIGENTE (2026-10-02, noche — normas MDWASD integradas) — pegar tal cual en un chat nuevo
Antes de pegarlo (usuario): cerrar Claude Desktop por completo y abrir un chat nuevo (para que el MCP cargue las 38 reglas MDWASD de `civil3d_standards_lookup`); Civil 3D abierto si se va a trabajar un DWG.

```
Seguimos con la automatización de las hojas C-300 Fase 1 de Civil 3D (WASD Miami-Dade). Responde en español y sé económico con tokens (usa scripts y recetas ya hechas, no rehagas a mano lo automatizado). Tienes autorización permanente para: mandar archivos a la Papelera sin preguntar (nunca borrado permanente), cerrar Civil 3D/pestañas con scripts/close-civil3d.ps1, y hacer commit+push del plugin al fork XEREFT/Civil3D-mcp, sincronizar la skill (bash scripts/sync-skill-to-fork.sh "<msg>" --yes), actualizar memoria (y su espejo en OneDrive), agentes, scripts, tests y registro, sin esperar a que lo pida.

Contexto grabado (no lo rederives, léelo de memoria/skill): memorias `mdwasd-standards`, `standing-authorizations`, `fase1-existing-networks-rule`, `continuous-improvement-rule`, `github-publishing`, `goulds-33809-new-project-test`, `fase1-from-scratch-engine`; skill civil3d-mcp-workflows (SKILL.md regla 14, `references/mdwasd-standards.md`, `references/mdwasd-details.md`, `references/standards/mdwasd-standards.json` + `mdwasd-thrust-restraint.json` + `mdwasd-abbreviations.json`, `references/automation-backlog.md`). Estado al cerrar: plugin c9cccdf y skill 4a3b9d1 en el fork (PR #16), integridad 0 FAIL (único WARN = reinicio de Claude Desktop), 484 tests pasan.

Reglas que no cambian: nunca tomar datos de proyecto de la guía C-300; valores reales solo de los archivos base + as-builts confirmados por mí; las redes existentes y las notas que las rigen no se quitan; Fase 1 = solo existente (sin diseño PROP); la ley del condado son las normas MDWASD (servidumbres 12/15/23.5 ft, separación agua–alcantarillado 10 ft preferido/6 mín, cruce 12 in, MH ≤ 400 ft, válvulas ≤ 660 ft, etc.): en lo existente solo rotular y verificar (`scripts/mdwasd-check.mjs`, corre dentro de `fase1-qc.py`), nunca mover un valor del as-built; en una propuesta, diseñar para cumplirlas. La servidumbre registrada (plat/O.R. confirmada por mí) gana a la estándar; la U.E. del plat no es servidumbre MDWASD. No toques FASE 1 / TEST2 / TEST3 / Propuesta de VILLA ONE ni el proyecto T25-06.212 sin orden nueva.

Primero (rápido): 1) prueba `civil3d_standards_lookup` con topic "mdwasd" y query "drop connection manhole" (debe traer SS 9.0) para confirmar que el servidor cargó las reglas nuevas; 2) corre `node scripts/integrity-check.mjs --skip-live` y dime el resultado en una línea.

Pendientes (en este orden, hazlos tú solo salvo lo marcado «necesito de ti»):
A. Plantillas DWT del condado (WASDTemplate-Survey-Asbuilts.dwt, WASDTemplate-Pipeline-Design.dwt, WASD-Blocks.dwg): los enlaces del sitio dan 404. NECESITO DE TI: la copia de mi firma en C:\Users\camil\OneDrive\Documents\AUTOCAD @XEREFT\_wasd_templates\ (o pedirlas a Eric Vilaire, 305-878-6051). Si ya están ahí: léelas (capas, estilos, bloques) y verifica las capas de X-UTIL contra C-WATR-PIPE-EXST / C-SSWR-PIPE-EXST.
B. GOULDS 33809: el main de agua sigue sin tamaño (rótulo genérico «EXIST WATER MAIN», WARN UC-005 A.12): léelo del as-built escaneado o pídemelo; válvulas/hidrantes sin símbolo en el levantamiento.
C. VILLA ONE: un hidrante a 511 ft del main de agua registrado en asbuilt.json (INFO UC-005 A.28): revisa el escaneo por si falta ese main; WM–SAN a 5.3 ft en 2 tramos (existente, solo reportado).
D. Declutter: el rótulo «EXIST R/W» del borde del viewport rebota (WARN en fase1-declutter).
E. Una cota dudosa de SS 2.0 (2.5 ft del doble lateral) marcada en mdwasd-details.md: confírmala en el PDF antes de usarla.
F. No leídos (solo si aparece una estación de bombeo): DW_PS_*, Submersible_PS_*, sewer-meter-*, escalera del drywell en la página de estándares.
G. Probar el motor completo con un proyecto NUEVO real (node scripts/fase1-from-scratch.mjs; project.json, PA siempre, as-builts escaneados → OCR → mi confirmación → build → QC → entrega) y confirmar que mdwasd-check y la servidumbre MDWASD salen en el resumen.

Al terminar cada bloque: tests/integridad, commit+push, sync de skill, memoria + espejo, y dime en pocas líneas qué quedó y qué falta.
```
