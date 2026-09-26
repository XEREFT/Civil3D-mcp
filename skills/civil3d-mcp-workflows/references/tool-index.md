# Índice de herramientas MCP por dominio

Tabla de *cuándo usar qué*. Para parámetros exactos: `list_tool_capabilities` o cargar el esquema con `ToolSearch select:<tool>`.
Snapshot: plugin 1.2.1 + 15 `acad_*` agregados en julio-agosto 2026 (~220 herramientas, 29 dominios).
`docs/tools.generated.md` del repo está **desactualizado** (no incluye los `acad_*`); confía en `list_tool_capabilities`.

**Convención:** cada dominio tiene una herramienta **agregada** `civil3d_<dominio>` con parámetro `action`, más **alias** de una sola acción (`civil3d_<dominio>_<acción>`). Son equivalentes; el agregado ahorra esquemas si usarás varias acciones.
**Aprobación:** toda acción que crea/edita/borra/importa/exporta/guarda necesita `approvalToken` (ver SKILL.md §2.4). Las de lectura (`list`, `get`, `report`, `check_*`) no.

## Contenido
1. Sistema / diagnóstico / documentos
2. AutoCAD básico (`acad_*`): texto, leaders, bloques, formas, capas, xrefs
3. Alineaciones, intersecciones, peralte
4. Perfiles y profile views
5. Redes de tubería (gravedad) y a presión (agua)
6. Superficies
7. Grading y feature lines
8. Corredores, ensamblajes, secciones
9. Parcelas
10. Puntos, COGO, survey, coordenadas
11. Hidrología, detención, pendientes, distancia de visibilidad
12. Etiquetas, estilos, estándares
13. QC
14. Cantidades y costos
15. Plan production / sheets
16. Proyecto / data shortcuts
17. Workflows y orquestación
18. Plantilla de entrada para herramientas nuevas

---

## 1. Sistema / diagnóstico / documentos
| Herramienta | Cuándo |
|---|---|
| `civil3d_health` | Siempre primero. Revisa `drawingLoaded`, `operationInProgress`, `currentOperationDurationMs` y `queueDepth`. Responde aunque la cola esté bloqueada. |
| `get_drawing_info` | Nombre, ruta, `unsavedChanges` y conteos. El token de aprobación se calcula sobre esta respuesta. |
| `civil3d_drawing` | `info`, `new`, `save`, `undo`, `redo`, `settings`, `selected_objects_info`, `list_object_types`, `list_open_documents`, `set_active_document`. `save` requiere token. Para Save As: `{ action:"save", saveAs:"<ruta .dwg>", overwrite?:false }`. La ruta debe estar dentro de `CIVIL3D_FILE_ROOTS` si esa variable está configurada. |
| `acad_list_open_documents` | Ver qué DWG están abiertos y cuál está activo. |
| `acad_set_active_document` | `{ match: "C-310" }`: enfoca el documento por subcadena del nombre o la ruta. Todas las herramientas actúan sobre el documento activo. |
| `get_selected_civil_objects_info` | Lo que el usuario seleccionó a mano en Civil 3D. Útil para "esto que tengo seleccionado". |
| `list_civil_object_types` | Tipos de objetos Civil del dibujo. |
| `civil3d_job` | `start`, `status`, `cancel`: operaciones largas asíncronas. |
| `civil3d_request_approval` / `civil3d_preview_action` | Obtener el token y saber si una acción lo requiere. |
| `list_tool_capabilities`, `civil3d_docs`, `civil3d_help` | Catálogo, orquestación y ayuda oficial de Autodesk. |
| `civil3d_orchestrate` | Enruta una intención en lenguaje natural hacia un plan de herramientas. Úsalo solo si no sabes por dónde empezar. |

## 2. AutoCAD básico (`acad_*`, dominio geometry)
Todo por **handle** (hex). Rotaciones en **radianes** (API AutoCAD).

| Herramienta | Cuándo | Payload mínimo |
|---|---|---|
| `acad_list_text_entities` | Encontrar DBText/MText/MLeader por contenido. Es el paso 1 de cualquier corrección de nota. | `{ contains: "TAPPING SLEEVE", space: "all" }` |
| `acad_update_text_content` | Cambiar el texto, la posición, la altura o la rotación. En un MLeader solo se pueden cambiar `text` y `height`. | `{ handle: "52D33", text: "<crudo editado>" }` |
| `acad_create_mleader` | Crear un callout nuevo con flecha. `leaderPoint` es la punta de la flecha y `textPoint` la ubicación del texto. Acepta `space`/`layout` (en paper space los puntos están en unidades de hoja). | `{ text, leaderPointX, leaderPointY, textPointX, textPointY, layer?, mLeaderStyle?, textHeight?, space?, layout? }` |
| `acad_create_text` | DBText suelto. En **model space** por defecto; con `space:"paper"` + `layout` escribe en layouts (title blocks, tablas de revisión). Sin `layout`, usa el layout de papel activo. | `{ text, x, y, height?, layer?, space?, layout? }` |
| `acad_create_mtext` | MText (multilínea, `P`). Mismo `space`/`layout` que `create_text`. | `{ text, x, y, width?, textHeight?, layer?, space?, layout? }` |
| `acad_erase_entity` | Borrar por handle. **Solo con confirmación del usuario.** | `{ handle }` |
| `acad_list_polyline_entities` | Polylines/Splines: revision clouds, contornos. Filtra por `layer`/`colorIndex`. | `{ space: "all", colorIndex: 1 }` |
| `acad_list_shape_entities` | Line/Circle/Arc/Ellipse/Solid/Hatch/Point, para símbolos dibujados a mano o PDF underlay. Úsalo siempre con proximidad. | `{ nearX, nearY, nearRadius: 5 }` |
| `acad_list_dimensions` | Cotas (aligned/rotated): medida, override, estilo, puntos de definición. Úsalo para leer anchos de R/W del survey. | `{ layer: "DIM" }` o `{ nearX, nearY, nearRadius }` |
| `acad_create_aligned_dimension` | DIMALIGNED entre 2 puntos (CL → R/W). `dimStyle` debe existir; `textOverride` con `<>` conserva el valor. Estilo anotativo → cota anotativa con UNA escala (CANNOSCALE). `dimTad`/`dimTxtDirection` = overrides DSTYLE (firma: 4 / true en planta girada). | `{ x1,y1,x2,y2, dimStyle:"BCC-1.0", layer:"C-ANNO", offset }` |
| `acad_list_viewports` | Viewports de layouts: escala (`1"=20'`), twist (DVIEW TW), centro en model space, lock. | `{ layout: "C-300" }` |
| `acad_set_viewport_twist` | Gira el viewport para que la calle quede horizontal (twist = 360 − θ). Mantiene el centro salvo `centerX/Y`. No cambia la escala. | `{ layout, streetAngleDegrees }` |
| `acad_create_entities` | **Lote**: line/polyline/text/mtext/mleader/aligned_dimension/block/viewport con capa, color, linetype, ltscale, lineweight y estilos; crea capas faltantes desde `layers`; 1 aprobación; todo-o-nada. Úsalo para aplicar `standards/*.json` o un payload de `replay-from-package.cjs`. mleader: `x/y` = ubicación del texto, `width` (ancho de caja), `rotation` (ángulo de calle); dim: `dimTad`, `dimTxtDirection`. Sin máscara de fondo para mtext (usar `mtext-mask.lsp`). | `{ layers:{...}, entities:[{kind:"mtext",layer,textStyle,height,attachment,rotation,text,x,y}, ...] }` |
| `acad_list_block_references` | INSERTs (con nombre efectivo de bloques dinámicos). También lista xrefs. | `{ contains: "valve", includeAttributes: true }` |
| `acad_update_block_reference` | Cambiar el símbolo (`blockName` ya definido en el dibujo), la posición, la escala o los atributos. | `{ handle, attributes: [{tag, value}] }` |
| `acad_insert_block_reference` | Insertar un bloque. Con `sourceFilePath` importa la definición desde una biblioteca DWG. | `{ blockName, x, y, layer?, sourceFilePath? }` |
| `acad_create_or_update_layer` | Crear o actualizar una capa (color ACI, linetype, lineweight en centésimas de mm, plot, freeze, lock). | `{ name: "XREF", colorIndex: 7 }` |
| `acad_attach_xref` | Adjuntar un xref. **Overlay por defecto.** | `{ filePath, layer: "XREF", x:0, y:0 }` |
| `acad_purge_unused` | PURGE real. Solo en archivos desechables y con confirmación. | `{}` |
| `acad_audit_drawing` | AUDIT real (es seguro). | `{ fixErrors: true }` |
| `acad_create_polyline` / `acad_create_3dpolyline` / `create_line_segment` | Dibujo de líneas y polilíneas. | ver esquema |
| `civil3d_geometry` | Agregado: COGO + todo lo anterior vía `action`. | |

## 3. Alineaciones
| Herramienta | Cuándo |
|---|---|
| `civil3d_alignment` | `list`, `get`, `report`, `create`, `delete`, `add_tangent`, `add_spiral`, `delete_entity`, `offset_create`, `widen_transition`. |
| `…station_to_point` (acción) | **Estación/offset → XY.** `{ name, station: 1030.52, offset: -6.68 }`. Es la dirección que necesitas para ubicar un callout. |
| `…point_to_station` / `civil3d_alignment_get_station_offset` | **XY → estación/offset.** Sirve para verificar lo que dice un texto contra la geometría. |
| `civil3d_alignment_set_station_equation` | Mover 0+00 o ajustar la estación final a un número redondo. |
| `civil3d_intersection`, `civil3d_superelevation*` | Intersecciones y peralte (poco uso en conexiones de agua). |

## 4. Perfiles
`civil3d_profile`: `list`, `get`, `get_elevation`, `sample_elevations`, `create_from_surface` (EG), `create_layout` (diseño), `add_pvi`, `delete_pvi`, `add_curve`, `set_grade`, `check_k_values`, `report`, `view_create`, `view_band_set`. También tiene alias `civil3d_profile_*`.

## 5. Tuberías
| Herramienta | Cuándo |
|---|---|
| `civil3d_pipe_network` / `_edit` | **Gravedad** (sanitario/pluvial): `list`, `get`, `get_pipe`, `get_structure`, `check_interference`, `create`, `add_pipe`, `add_structure`. |
| `civil3d_pipe_catalog` | Partes disponibles. Consúltalo antes de crear. |
| `civil3d_pressure_network_*` | **Agua a presión**: `list`, `get_info`, `create`, `delete`, `assign_parts_list`, `connect`, `set_cover`, `validate`, `export`. |
| `civil3d_pressure_pipe_add` / `_get_properties` / `_resize` | Tubos a presión. |
| `civil3d_pressure_fitting_add` / `_get_properties` | Tees, codos, reducciones. |
| `civil3d_pressure_appurtenance_add` | Válvulas, hidrantes. |
| `civil3d_pipe_hydraulic_analysis`, `civil3d_pipe_network_hgl_calculate`, `civil3d_pipe_network_size` | Hidráulica y dimensionamiento de redes por gravedad. |
| `civil3d_pipe_structure_properties` | Propiedades de estructuras. |
| `civil3d_pipe_profile_view_automation` | Dibujar la red en un profile view. |
| `civil3d_pipe` | Agregado de todo lo anterior. |

## 6. Superficies
`civil3d_surface`: `list`, `get`, `get_elevation`, `get_elevation_along`, `sample_elevations`, `create`, `create_from_dem`, `delete`, `add_points`, `add_breakline`, `add_boundary`, `extract_contours`, `contour_interval_set`, `statistics_get`, `analyze_slope`, `analyze_elevation`, `analyze_directions`, `watershed_add`, `volume_calculate`, `volume_report`, `volume_by_region`, `comparison_workflow`, `drainage_workflow`. `civil3d_surface_edit` es el agregado de edición.

## 7. Grading / feature lines
`civil3d_grading`: `group_list`, `group_get`, `group_create`, `group_delete`, `group_volume`, `group_surface_create`, `list`, `get`, `create`, `delete`, `criteria_list`, `feature_line_*`. `civil3d_feature_line`: `list`, `get`, `export_as_polyline`; `civil3d_feature_line_create` crea feature lines.

## 8. Corredores / ensamblajes / secciones
`civil3d_corridor` (`list`, `get`, `rebuild`, `summary`, `get_surfaces`, `get_feature_lines`, `compute_volumes`, `target_mapping_get`, `target_mapping_set`, `region_add`, `region_delete`) · `civil3d_assembly` (`list`, `get`, `create`, `create_subassembly`, `edit`) · `civil3d_section` (`list_sample_lines`, `create_sample_lines`, `get_section_data`, `view_create`, `view_list`, `view_update_style`, `view_group_create`, `view_export`).

## 9. Parcelas
`civil3d_parcel`: `list_sites`, `list`, `get`, `create`, `edit`, `lot_line_adjust`, `report`.

## 10. Puntos / COGO / survey / coordenadas
`civil3d_point` (`list`, `get`, `create`, `import`, `export`, `delete`, `transform`, `list_groups`, `group_*`) · `create_cogo_point` · `civil3d_cogo_inverse` / `_direction_distance` / `_traverse` / `_curve_solve` · `civil3d_survey` (`database_list`, `figure_list`, `figure_get`, `observation_list`) · `civil3d_coordinate_system` (`info`, `transform`). Ver `coordinates-cogo.md`.

## 11. Hidrología y análisis
`civil3d_hydrology` (flow path, low point, runoff, watershed, catchments, Tc, hidrograma, SSA) · `civil3d_catchment` · `civil3d_time_of_concentration` · `civil3d_stm` (export/import STM, abrir SSA) · `civil3d_detention` (`basin_size_calculate`, `stage_storage`) · `civil3d_slope_analysis` / `civil3d_slope_geometry_calculate` · `civil3d_sight_distance` / `civil3d_stopping_distance_check`. Workflows: `civil3d_hydrology_watershed_runoff_workflow`, `_runoff_pipe_workflow`, `_runoff_detention_workflow`.

## 12. Etiquetas / estilos / estándares
`civil3d_label` (`list`, `add`, `list_styles`; `add` con `objectType:alignment, labelType:label_set, labelStyle:"Major and Minor only"` importa el label set de estaciones — el que usa la firma en C-300) · `civil3d_style` (`list`, `get`) · `civil3d_standards` (`label_*`, `style_*`, `lookup`, `check_labels`, `check_drawing_standards`, `fix_drawing_standards`) · `civil3d_standards_lookup` (valores de norma).

## 13. QC
`civil3d_qc_check_drawing_standards`, `_check_labels`, `_check_alignment`, `_check_profile`, `_check_pipe_network`, `_check_surface`, `_check_corridor`, `civil3d_qc_fix_drawing_standards` (muta el dibujo, requiere token), `civil3d_qc_report_generate`. El agregado es `civil3d_qc`.

## 14. Cantidades y costos
`civil3d_qty_pressure_network_lengths`, `_pipe_network_lengths`, `_alignment_lengths`, `_parcel_areas`, `_surface_volume`, `_earthwork_summary`, `_point_count_by_group`, **`civil3d_qty_export_to_csv`** (exporta a CSV; no hace falta script). El agregado es `civil3d_quantity_takeoff`. Costos: `civil3d_pay_items_export`, `civil3d_material_cost_estimate` (agregado `civil3d_cost_estimation`).

## 15. Plan production / sheets
`civil3d_sheet_set_list`, `_get_info`, `_create`, `_export`, `_title_block`; `civil3d_sheet_add`, `civil3d_sheet_get_properties`, `civil3d_sheet_view_create`, `civil3d_sheet_view_set_scale`, `civil3d_sheet_publish_pdf`, `civil3d_plan_profile_sheet_update_alignment`. El agregado es `civil3d_plan_production`. Ver `plan-production-sheets.md`.

## 16. Proyecto / data shortcuts
`civil3d_project`, `civil3d_data_shortcut` (+ `_create`, `_promote`, `_reference`, `_sync`).

## 17. Workflows (orquestaciones del plugin, más cortas que encadenar a mano)
`civil3d_workflow_project_startup`, `_project_reference_setup`, `_drawing_readiness_audit`, `_pipe_network_design`, `_plan_production_publish`, `_qc_fix_and_verify`, `_corridor_qc_report`, `_surface_comparison_report`, `_grading_surface_volume`, `_feature_line_to_grading`, `_data_shortcut_publish_sync`, `_data_shortcut_reference_sync`. El agregado es `civil3d_workflow`.

---

## 18. Plantilla de entrada para herramientas nuevas

Cuando el plugin gane una herramienta o acción nueva, agrega **una fila** en la tabla del dominio correspondiente. Si el dominio no tiene tabla, crea una con estas columnas. Después agrega el detalle en este bloque de registro, que está en orden cronológico:

```markdown
### <tool_name>  (dominio: <domain>, acción: <action_snake>, plugin: <PluginMethod> en <Archivo>.cs, agregado: YYYY-MM-DD)
- Cuándo: <una frase: qué problema resuelve y cuándo preferirla sobre otra>
- Payload mínimo: `{ ... }`
- Aprobación: sí/no · safeForRetry: sí/no
- Gotcha: <restricciones descubiertas, p. ej. "MLeader solo acepta text/height">
```

### Registro de herramientas agregadas localmente
### acad_list_text_entities / acad_update_text_content (geometry; listTextEntities/updateTextContent en AcadCommands.cs; 2026-07-18)
- Cuándo: es el núcleo de toda corrección de notas y callouts.
- Payload mínimo: `{ contains }` / `{ handle, text }`
- Aprobación: no / sí.
- Gotcha: la salida es `{entities:[…]}`. En un MLeader solo se pueden cambiar `text` y `height`.

### acad_list_polyline_entities (geometry; listPolylineEntities; 2026-07-18)
- Cuándo: buscar revision clouds y polilíneas por capa o color.
- Gotcha: en DWG con PDF underlay devuelve mucho ruido en capas `PDF##_*`. Resume la salida con `summarize-entities.mjs`.

### acad_list_block_references / acad_update_block_reference (geometry; 2026-07-18)
- Cuándo: inspeccionar o cambiar símbolos que sí son bloques.
- Gotcha: los símbolos WASD suelen **no** ser bloques. Si la búsqueda sale vacía, pasa a `acad_list_shape_entities`.

### acad_list_shape_entities (geometry; listShapeEntities; 2026-07-19)
- Cuándo: símbolos dibujados a mano (tee, válvula, codo).
- Payload mínimo: `{ nearX, nearY, nearRadius }`, con el XY obtenido de `station_to_point`.

### acad_create_mleader / acad_erase_entity (geometry; createMLeader/eraseEntity; 2026-07/08)
- Payload mínimo: ver la tabla §2. Los dos requieren aprobación.
- Gotcha: si no das `mLeaderStyle` o no existe, usa "Standard". `textHeight` por defecto es 0.125.

### acad_attach_xref, acad_create_or_update_layer, acad_purge_unused, acad_audit_drawing, acad_insert_block_reference (geometry; LayerXrefCommands.cs, PurgeAuditCommands.cs, AcadCommands.cs; 2026-08-05)
- Gotcha: `attach_xref` puede ser bloqueado por el clasificador de auto-mode. Se resuelve agregando `mcp__Civil_3D_MCP__acad_attach_xref` a `permissions.allow` y `autoMode.allow` en `.claude/settings.local.json`. AUDIT se ejecuta con `Editor.Command`.

### acad_create_text / acad_create_mtext / acad_create_mleader + space/layout  (geometry; plugin: createText/createMText/createMLeader en AcadCommands.cs; agregado: 2026-09-24)
- Cuándo: agregar texto en un layout (una fila de la tabla de revisiones, un campo del title block, una nota de hoja) sin tener que copiar a mano en Civil 3D.
- Payload mínimo: `{ text:"3", x:30.1, y:2.4, height:0.1, layer:"TEXT", space:"paper", layout:"PLAN" }`
- Aprobación: sí · safeForRetry: no
- Gotcha: con `space:"paper"` y sin `layout`, si la pestaña activa es Model devuelve un error con la lista de layouts disponibles. Si pasas `layout` con `space:"model"`, es un error. La respuesta incluye `space` y `layout`. Las tres herramientas usan el mismo helper C# `ResolveTargetSpace`.
- Altura por defecto (`height` en text, `textHeight` en mtext): 2.5 en model space y 0.1 en paper space (fijo en el plugin, no viene del dibujo; commit 4ebc616, 2026-09-25). MLeader: 0.125 en ambos. Antes de 4ebc616 paper space también usaba 2.5. `acad_list_text_entities` no lista layouts vacíos: para descubrir nombres de layout usa el error de `space:"paper"` sin `layout` con la pestaña Model activa.
- Probado en vivo 2026-09-25 (Drawing1.dwg, Layout1): text/mtext/mleader en paper, error con lista de layouts sin `layout`, default a model; entidades verificadas con `list_text_entities space:"all"` y borradas.

### acad_list_open_documents / acad_set_active_document (drawing; listOpenDocuments/setActiveDocument en DrawingCommands.cs; 2026-08-05)
- Cuándo: proyectos con varios DWG abiertos (X-ARCH/X-TOPO/X-UTIL + hoja de diseño).
- Gotcha: no abre archivos desde disco; solo cambia el foco entre los que ya están abiertos.

### acad_list_dimensions / acad_create_aligned_dimension / acad_list_viewports / acad_set_viewport_twist (geometry; DimensionViewportCommands.cs; 2026-09-25)
- Creadas para la hoja C-300 (`c300-water-sewer-plan.md`): medir vías CL→R/W y orientar el viewport con la calle horizontal.
- `set_viewport_twist` fija `ViewTarget` = centro y `ViewCenter` = 0,0 → el centro queda estable aunque cambie el giro.
- Gotcha: `create_aligned_dimension` con `offset` 0 deja la línea de cota sobre los puntos medidos; usa `offset` o `dimLineX/Y` para separarla.

### civil3d_pipe_set_part_properties, add_to_profile_view partNames (NetworkDesignCommands.cs; 2026-09-25)
- `civil3d_pipe_set_part_properties`: Description (lo que imprimen las etiquetas como <[Description]>) y/o renombrar una pieza de red gravedad o presión. Sin aprobación (idempotente).
- `civil3d_pipe_network_add_to_profile_view` acepta `partNames` para dibujar solo esas piezas (p. ej. un tramo existente que cruza otra calle); nombres sin coincidencia salen en `failed`.

### civil3d_profile_view_styles / _annotations / _apply_annotations, acad_move_entities (ProfileViewAnnotationCommands.cs, DraftingBatchCommands.cs; 2026-09-25)
- `view_styles`: estilos de vista, juegos de bandas, marcadores y estilos de etiqueta por tipo (existen en la plantilla de la firma: "EAC-profile grid V:10", "_No Bands", "Exist. Elevation Grade", "MANHOLE", "Prop San Main", "CROSSING LABEL TOP"...).
- `view_annotations` (sin nombre = todas): estilo, bandas, etiquetas (tipo, estilo, **layer**, pieza + featureX/Y en planta, ratio, estación/elevación, arrastrada + labelLocation, overrides por índice) y grupos de etiquetas del perfil. Incluye etiquetas de piezas (no están en GetLabelIds).
- `view_apply_annotations`: aplica estilo, `bandSetStyle` o `clearBands`, `labels` (el mismo formato) y `labelGroups`. Empareja piezas por posición en planta (≤ maxMatchDistance, 1 ft). **Pasar `layer`**: sin ella la etiqueta cae en la capa actual. Re-ejecutar actualiza etiquetas estación/elevación iguales en vez de duplicar. Cada etiqueta devuelve handle o error.
- `acad_move_entities`: mueve por handles (model o paper) con dx/dy.

### civil3d_profile_view_info / civil3d_profile_view_set_location (profile; ProfileEditCommands.cs; 2026-09-25)
- `view_info` sin `profileViewName` lista todas las vistas: `location` (= esquina inferior izquierda de la grilla), `station0Elevation0`, rangos, `xPerStation`, `yPerElevation` (exageración vertical). Con nombre + `points:[{station,elevation}]` devuelve X,Y (y `xyPoints` al revés) → ubicar anotaciones de perfil por estación/elevación.
- `view_set_location`: mueve la vista para que (anchorStation, anchorElevation) caiga en (targetX, targetY); las piezas dibujadas en la vista se mueven con ella.
- Gotcha: cambiar el rango de estaciones después de crear la vista corre la grilla (+80 ft con STA −20); `view_create` ya la re-ancla (en el DLL posterior a 2026-09-25 06:20). Los nombres Civil no aceptan `"` (<>/\":;=|,*?`).

### civil3d_network_catalog / civil3d_pipe_network_add_to_profile_view (pipe; NetworkDesignCommands.cs; 2026-09-25)
- Catálogo tipado: listas de piezas gravedad (familias + tamaños exactos) y presión (descripciones por tipo). Usa esos nombres tal cual en `partName`.
- add_to_profile_view: dibuja todas las piezas de una red (gravedad o presión) en una vista existente, por nombre.
- `add_structure`: `structureName`, `rimElevation` fijo (apaga el ajuste automático a superficie), `sumpDepth` = RIM − sumidero. `add_pipe`: `pipeName`; z de los puntos = eje del tubo.

### acad_create_entities (geometry; DraftingBatchCommands.cs; 2026-09-25)
- kind `viewport` (solo paper): x/y centro en papel, width/height, targetX/targetY (punto de modelo al centro), scale (customScale, 0.05 = 1"=20'), twistDegrees, locked. Cambia al layout destino para poder encenderlo.
- Nace para repetir la hoja C-300 con pocas llamadas: `c300-build-spec.mjs` genera el payload desde el estándar `standards/formtech-c300.json`.
- `rotation` en radianes; `attachment` 1-9 (2 = TopCenter); `colorIndex` 256 = ByLayer.
- Bloques: la definición debe existir; si no, primero `acad_insert_block_reference` con `sourceFilePath`.
- Gotcha: MLeader con estilo anotativo (Formtech-1.0) → no pasar `scale` (eInvalidContext); la escala sale de CANNOSCALE. `rotation` sí: gira el texto y el dogleg.
- Gotcha: en MText el tabulador es un carácter TAB real (en JSON `"\t"`), no la secuencia `\t` literal.
