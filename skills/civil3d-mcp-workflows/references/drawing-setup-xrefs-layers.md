# Setup de dibujos: xrefs, capas, documentos, limpieza

Las convenciones completas de la firma (colores, escalas, texto, flujo de proyecto) están en el subagente `civil3d-new-project`. Delega en él cuando pregunten "¿cómo se hace normalmente X?". Aquí va solo la mecánica de las herramientas y los gotchas.

## Estructura típica de un proyecto de conexión de agua
- Xrefs por disciplina: `X-ARCH`, `X-TOPO`, `X-UTIL` (y a veces `C-WS` como fuente de agua/sanitario). No se diseña dentro de ellos.
- Hoja de diseño (p. ej. `C-300.dwg`) con esos xrefs en **Overlay** sobre la capa `XREF`, en 0,0,0, escala 1 y rotación 0.
- Carpetas por fase y fecha (`YYYY-MM-DD_Design`, `…\xref\`, `YYYY-MM-DD_QC`, `Cierre`). Un mismo proyecto puede tener **varios entregables separados** (p. ej. un permiso de Grading & Drainage frente a una propuesta de water main): no mezcles sus estados.

## Trabajar con varios documentos abiertos
`acad_list_open_documents` → `acad_set_active_document { match }` → operar → volver. Todas las herramientas actúan **solo** sobre el documento activo.

## Xrefs
1. `acad_create_or_update_layer { name:"XREF" }` si la capa no existe.
2. `acad_attach_xref { filePath:"<ruta absoluta>", layer:"XREF", x:0, y:0 }`. Por defecto es `overlay:true`. Usa `overlay:false` (Attach) solo si el usuario lo pide explícitamente, porque Attach hace que los xrefs aniden en cascada.
3. Verifica con `acad_list_block_references { contains:"X-TOPO" }`.
- **Cambiar la capa de un xref existente:** no hay herramienta "set layer". Se hace con attach nuevo en la capa correcta, con la misma ubicación, y luego `acad_erase_entity` de la instancia vieja (con confirmación). Validado en Goulds C-WS.
- Un xref que aparece como bloque en una capa anómala (p. ej. `C-ANNO`) puede ser un duplicado. Repórtalo y no lo borres sin confirmación.
- Rutas absolutas: el xref sigue resolviendo aunque guardes la hoja con Save As en otra carpeta.

## Capas
`acad_create_or_update_layer { name, colorIndex?, linetype?, lineweight?, plot?, frozen?, locked? }`. Si la capa existe, la actualiza.
- Existente = ACI 8, gris y discontinuo. Propuesto = color saturado por disciplina (agua = verde en Goulds).
- En la plot style de la firma, el color funciona como grosor de línea: rojo 0.15, amarillo 0.30, verde 0.35, azul 0.50, color 5 0.70, color 8 ≈ 70–80 % de gris.
- Una capa por disciplina (`C-Watr`, `C-San`, `C-Align`): recolorear la capa recolorea todo lo que está en ella.
- `linetype` se carga automáticamente desde `acad.lin` / `acadiso.lin` si no existe en el dibujo.

## Bloques (fittings, medidores)
`acad_insert_block_reference { blockName, x, y, rotation(rad)?, layer?, sourceFilePath? }`. Con `sourceFilePath` importa **solo esa definición** desde la biblioteca, mediante WblockCloneObjects.
Usa los nombres de parte del condado letra por letra (p. ej. `DualMeterBox`). Nombra los fittings con sus tamaños ("12x6").

## Limpieza
- `acad_audit_drawing { fixErrors:true }`: es seguro y puede usarse como hábito de QC.
- `acad_purge_unused`: hace un PURGE real (borra todo lo que no está referenciado). **Solo en archivos desechables y con confirmación**, porque en archivos de trabajo puede dejar miles de referencias colgantes.
- `civil3d_qc_check_drawing_standards` → `civil3d_qc_fix_drawing_standards` (este último muta el dibujo y requiere token).

## Proyecto nuevo con orquestación
`civil3d_workflow_project_startup` / `civil3d_workflow_project_reference_setup` / `civil3d_workflow_drawing_readiness_audit`. Revisa sus parámetros con `list_tool_capabilities`. `civil3d_drawing { action:"new", templatePath }` crea un DWG desde una plantilla (en el repo hay `templates/Civil_Imperial.dwt`).

## Pasos manuales (no tienen herramienta)
Abrir DWG desde disco, Batch Plot, ticket Sunshine 811 y verificar servicios existentes con imagen satelital.
