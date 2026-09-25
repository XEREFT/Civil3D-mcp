# Producción de planos: sheets, title blocks, publicación

## Herramientas
| Tarea | Herramienta |
|---|---|
| Ver sheet sets | `civil3d_sheet_set_list`, `civil3d_sheet_set_get_info` |
| Crear un sheet set o agregar una hoja | `civil3d_sheet_set_create { name }`, `civil3d_sheet_add { sheetSetName, sheetName, sheetNumber?, layoutName? }` |
| Asignar un title block | `civil3d_sheet_set_title_block { sheetSetName, sheetName, titleBlockPath }` |
| Crear una hoja plan/profile por alineación | `civil3d_plan_production { action:"plan_profile_sheet_create", sheetSetName, alignmentName, … }` · actualizar: `civil3d_plan_profile_sheet_update_alignment` |
| Viewport | `civil3d_sheet_view_create { layoutName, centerX?, centerY?, width?, height?, scale? }`, `civil3d_sheet_view_set_scale` |
| Propiedades | `civil3d_sheet_get_properties` |
| Publicar un PDF | `civil3d_sheet_publish_pdf { layoutNames:[…], outputPath, overwrite?, plotStyleTable?, paperSize? }` |
| Exportar un sheet set | `civil3d_sheet_set_export` |
| Todo orquestado | `civil3d_workflow_plan_production_publish` |

Publicar requiere token de aprobación (exporta). La ruta de salida debe estar dentro de `CIVIL3D_EXPORT_ROOTS` / `CIVIL3D_FILE_ROOTS` si esas variables existen.
Estándar de la firma: 24"x36", escala típica 1"=20', y la plot style que mapea color a grosor de línea (ver `drawing-setup-xrefs-layers.md`). **Batch Plot de todo el set es manual.** Si `sheet_publish_pdf` no basta, pide al usuario que lo haga desde Civil 3D.

## Title blocks (lo que más se edita en QC)
Casi siempre son DBText o MText sueltos en el **layout** (paper space), no atributos. Algunas plantillas usan bloques con atributos: si `acad_list_text_entities { space:"paper" }` no encuentra el campo, prueba `acad_list_block_references { space:"paper", includeAttributes:true }` y edítalo con `acad_update_block_reference { handle, attributes:[{tag,value}] }`.

Campos típicos: número de hoja (`C-301`), título (`WATER PLAN`), conteo (`2⇥OF⇥3`, **con tab real**), fecha, proyecto (`YY-MM.XXX`), sello y tabla de revisiones.

Procedimiento:
1. Lista los textos de cada layout: `acad_list_text_entities { space:"paper" }`, y resume con `summarize-entities.mjs --by layer`.
2. Construye una tabla con layout → número / título / conteo de cada hoja. **Verifica la consistencia del set completo** (números correlativos, conteo "N OF total" coherente, sin dos hojas con el mismo número). Un estado a medio editar de una sesión previa es común (Goulds C-300: C-02 decía "C-300, 2 OF 3" y C-03 decía "C-301, 1 OF 3").
3. Si un número de hoja ya pertenece a otro DWG real del proyecto (compruébalo con `Glob` en las carpetas del proyecto), el texto es un placeholder heredado, no un número válido.
4. Confirma los valores finales con el usuario y edita solo la subcadena. En el conteo con tab, cambia solo el dígito.
5. Un DWG que actúa como fuente de xref (p. ej. C-WS) puede no necesitar número de hoja. En ese caso, un placeholder (`C-XXX` / `TBD` / `X OF X`) es un estado final válido.

## Tabla de revisiones
Normalmente son textos sueltos por celda en paper space (No. · fecha · descripción · iniciales). Edita por handle. Para agregar filas: `acad_create_text` con `space:"paper"` y `layout` (el procedimiento está en `redline-qc-workflow.md` §3).

## Plantillas escondidas
Algunos covers (`Cover_C-001.dwg`) guardan una copia en blanco del title block y un índice maestro de hojas fuera del área imprimible (X negativo). Es intencional. No lo toques ni lo reportes como defecto.

## Carpeta de cierre
Al terminar una sesión o fase, el usuario copia los DWG editados a una subcarpeta con fecha (`YYYY-MM-DD_QC`, `Cierre`, `08.03`). Si guardaste con Save As, usa la misma convención.
