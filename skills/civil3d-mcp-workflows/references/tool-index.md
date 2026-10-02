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
| `acad_layout` | Crear/copiar/renombrar/borrar/listar **layouts** (pestañas de hoja). `copy_layout` clona todas las entidades de paper space de un layout existente (título, borde, tabla de revisión) a uno nuevo, en las mismas coordenadas — la forma de duplicar C-300→C-301 sin Core Console (ver gotcha abajo). `setCurrent` (default `true`) deja la hoja nueva como activa. | `{ action:"copy_layout", sourceLayoutName:"C-300", newName:"C-301" }` |
| `civil3d_geometry` | Agregado: COGO + todo lo anterior vía `action`. | |

## 3. Alineaciones
| Herramienta | Cuándo |
|---|---|
| `civil3d_alignment` | `list`, `get`, `report`, `create`, `delete`, `add_tangent`, `add_spiral`, `delete_entity`, `set_style`, `offset_create`, `widen_transition`. |
| `acad_erase_entities` (geometry) | **Borrado masivo por handles**: 1 llamada, 1 transacción, **1 aprobación** (máx. 500). Para limpiezas tipo "volver a Fase 1" en vez de 100+ `acad_erase_entity`. |
| `civil3d_pipe_network_delete` (pipe) | Borra una red de **gravedad** completa o su cascarón vacío (`PROP SAN SEWER`). Agua a presión: `civil3d_pressure_network_delete`. |
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
### civil3d_alignment_set_style  (dominio: alignment, acción: set_style, plugin: alignmentSetStyle en AlignmentEditCommands.cs, agregado: 2026-09-28)
- Cuándo: cambiar el estilo de una alineación YA creada (create solo lo fija al crear). Estándar de la firma: `BCC - ALIGNMENT` (amarillo discontinuo con ticks); ver `standards/formtech-c300.json` → `roles.alignment.style`.
- Payload mínimo: `{ action:"set_style", name:"SW 118TH AVE", style:"BCC - ALIGNMENT" }` (alias: `civil3d_alignment_set_style { alignmentName, style }`)
- Aprobación: sí · safeForRetry: no (idempotente: `changed:false` si ya lo tiene)
- Gotcha: el estilo debe existir en el dibujo (`civil3d_style list objectType:alignment`); un nombre desconocido da error, nunca cae al primer estilo. No toca label set (usa `civil3d_label add label_set`), geometría, perfiles ni etiquetas. Necesita DLL desplegado + reinicio de Claude Desktop para verse en el registro MCP (probarlo antes con `scripts/plugin-rpc.mjs alignmentSetStyle` solo en un documento scratch).

### acad_erase_entities  (dominio: geometry, acción: erase_entities, plugin: eraseEntities en AcadCommands.cs, agregado: 2026-09-28)
- Cuándo: limpiezas masivas (Fase 1 pura, quitar un perfil completo). Reemplaza N x (`request_approval` + `acad_erase_entity`).
- Payload mínimo: `{ handles:["12C0D","12C1A",…], ignoreMissing?:true }` (máx. 500). Aprobación: sí (el token cubre la lista exacta) · safeForRetry: no.
- Gotcha: el orden importa en piezas Civil (tubos antes que estructuras); un handle ya borrado por cascada sale en `skipped`, no aborta (usa `ignoreMissing:false` para abortar). Lee los handles ANTES (`acad_list_*`, `civil3d_profile_view_info`, `civil3d_profile_view_annotations` para las StationOffsetLabel).

### civil3d_pipe_network_delete  (dominio: pipe, acción: delete_pipe_network, plugin: deletePipeNetwork en PipeNetworkCommands.cs, agregado: 2026-09-28)
- Cuándo: quitar una red de gravedad (sanitario/pluvial) o el cascarón vacío que queda tras borrar sus piezas.
- Payload mínimo: `{ name:"PROP SAN SEWER" }`. Aprobación: sí — `civil3d_request_approval { toolName:"civil3d_pipe_network_delete", action:"delete_pipe_network", parameters:{name} }` (sin `action` dentro de `parameters`). Probado en vivo 2026-09-28 sobre los dos cascarones vacíos de VILLA ONE (`{deleted:true}`), uno por uno.
- Gotcha: `civil3d_pipe list/get` pueden fallar con "Retrieve attribute failed" en redes recién creadas o vacías; el nombre de la red se obtiene con `get_structure`/`get_pipe` (`connectedPipes`) o de la receta Fase 2.

### acad_list_layers  (dominio: geometry, acción: list_layers, plugin: listLayers en LayerXrefCommands.cs, agregado: 2026-09-28)
- Cuándo: leer el estado de capas EN VIVO (congelada/apagada/bloqueada, color, tipo de línea, si viene de un xref) — antes solo se veía en el guardado con `dwg-dump.ps1`.
- Payload mínimo: `{ name?:"C-TINN-BNDY", namePattern?:"X-UTIL|*", includeXref?:false, limit?:2000 }` (comodines `*` y `?`). Aprobación: no.
- Gotcha: necesita el DLL nuevo (si no: METHOD_NOT_FOUND). Las capas de xref aparecen como `XREF|CAPA` con `isXrefDependent:true`.

### civil3d_workflow_fase1_audit  (dominio: workflow, acción: fase1_audit; TS sobre listLayouts/listTextEntities/listPressureNetworks/profileViewInfo/listPipeNetworks/listAlignments/getAlignment/listSurfaces/listLayers/listDimensions; agregado: 2026-09-28)
- Cuándo: al abrir un proyecto y antes de entregar; lo puede usar un subagente sin Bash. Solo lectura. Es la versión nativa de `scripts/fase1-audit.mjs` — las dos rutas deben tener SIEMPRE los mismos chequeos (lo verifica `integrity-check.mjs`, check "fase1-audit.mjs == fase1Audit.ts checks"); si agregas un chequeo, agrégalo en ambos archivos.
- Payload mínimo: `{}` (opcionales `alignmentStyle` = "BCC - ALIGNMENT", `boundaryLayer` = "C-TINN-BNDY", `allowedLayouts` = ["Model","C-300"]). Devuelve `outputs.checks[]` con OK/WARN/FAIL y la llamada exacta que arregla cada FAIL. Incluye el chequeo de cotas cortas con el texto desprendido de su línea (2026-09-28) y el **7 "survey dimensions hidden"** (2026-10-01, `debddec`): WARN si una capa `*|DIM` de un xref está visible mientras la hoja tiene cotas `C-ANNO` propias (se imprimen dobles; VILLA ONE y la guía lo tenían) → `acad_create_or_update_layer {name:"X-TOPO|DIM", frozen:true}`.
- Gotcha: sin el DLL nuevo la comprobación del borde EG sale WARN (lector de capas no disponible). Lógica en `src/tools/domains/fase1Audit.ts` (con pruebas `tests/fase1_audit.test.ts`).

### civil3d_workflow_fase1_build  (dominio: workflow, acción: fase1_build; TS sobre newDrawing/saveDrawing/listOpenDocuments/attachXref/createAlignment/insertBlockReference/createEntities/setViewportTwist/listTextEntities/updateTextContent/eraseEntities/listPolylineEntities/listShapeEntities/moveEntities; agregado: 2026-09-28, guardias + notas 2026-09-28 noche)
- Cuándo: levantar un C-300 Fase 1 (solo existente) en **una sola llamada** en vez de las ~20 del §7 de `c300-water-sewer-plan.md`. El payload lo arma **`node scripts/fase1-build-payload.mjs --dir <carpeta>`** (dump X-TOPO → `c300-build-spec.mjs` → payload; comando `/fase1-build`). Lado de escritura de `fase1_audit` (`src/tools/domains/fase1Build.ts`, reglas de notas en `fase1PropNotes.ts`, tests `tests/fase1_build.test.ts` + `tests/fase1_prop_notes.test.ts`).
- Payload: `{ templatePath?, saveAs?, overwrite?, expectedDocument?, xrefs?:[{filePath,layer?,overlay?}], alignment?:{name,points,style?,labelSet?,layer?}, clImport?:{blockName,sourceFilePath}, entities?:[...] (formato de `acad_create_entities`), layers?, freezeLayers?:string[] (capas de xref a congelar justo después de los xrefs; `fase1-build-payload.mjs` pone `["X-TOPO|DIM"]` desde `roles.fase1.freezeXrefLayers`; si el survey no la tiene = "nothing to hide", no es error; 2026-10-01 commit `debddec`), entitySpace?, entityLayout?, twists?:[{layout,viewportHandle?,streetAngleDegrees,centerX,centerY}] (C-300 sin handle = viewport más grande; Model con centro = punto medio del alineamiento), titleBlock?:[{layout,contains,find,replace}], stripPropNotes? (default true), sheet?:{minX,minY,maxX,maxY} (default ARCH D 36x24), save? (default true) }`.
- Orden: open template → **check new drawing is active** → save as → **check active document** (= `expectedDocument` o `saveAs`; sin ninguno de los dos se niega a escribir) → xrefs → **freeze `freezeLayers`** → alineamiento → `_cl` → entidades → giros → title block (filtrado por layout del lado TS; si el fragmento coincide con >1 texto → FAIL) → **Fase 1 notes** (borra notas PROP fuera de la hoja, reescribe la nota MD-WASD de la hoja con `fase1PropNotes.ts`, mide la nota antes/después y sube con `moveEntities` lo que quedó en la franja vaciada — los glifos "(NOT PART OF M-WASD NOTES…)"; cualquier otro texto PROP en la hoja → FAIL sin tocar nada) → **check active document before save** → save.
- `expectedDocument`: nombre del archivo (se compara SOLO contra el nombre, nunca contra la carpeta: "VILLA ONE" no coincide con la guía que vive en la carpeta VILLA ONE) o ruta completa. Llamado solo con `{ expectedDocument }` = limpia las notas PROP de ese dibujo y guarda (el arreglo en 1 llamada del FAIL "PROP/PROPOSED in paper space" de `fase1_audit`).
- Se detiene en el primer FAIL; lo siguiente queda `skipped` y nada se deshace ni se duplica solo — revisa `outputs.steps[]`, no reintentes el payload completo a ciegas.
- Aprobación: `toolName:"civil3d_workflow_fase1_build"`, `action:"fase1_build"`, `parameters` = el payload sin `action`, idéntico byte a byte en las dos llamadas (léelo del `payload.json`).
- **Validado en vivo 2026-09-28** (copia de descarte de VILLA ONE): 9/9 OK en 1 llamada, idéntico a `FASE 1.dwg` real en lo que cubre el spec (440.00 ft `BCC - ALIGNMENT`, `CDF1` 268.4891° `1" = 20'`, Model 268.4891°/SNAPANG 91.5109, xrefs `.\X-*.dwg` overlay, CL y `_cl` a 0.01 ft). **Guardias + notas validadas en vivo 2026-10-01** (copia `VILLA ONE @XEREFT FASE1-BUILD-TEST2.dwg`, se conserva como referencia en la carpeta del proyecto): 15/15 OK — `erased 3 off-sheet (CF57, CF6E, CF75); rewrote CF80 (-8 item(s)); moved 45 entit(ies) left under CF80 up 7.621` (a mano fueron 43 polilíneas + 2 arcos, +7.6222), `fase1_audit` 0 FAIL, recorte del plot idéntico a `_QC\C-300 FASE 1.pdf`. Dos bugs que salieron en esas corridas (commits `1ec99e2`, `6f8d4c4`): (1) la exposición dedicada no listaba `expectedDocument`/`stripPropNotes`/`sheet` y el MCP los borraba (test `tests/workflow_exposure_shape.test.ts`); (2) `MText.GeometricExtents` daba a CF80 una caja de 0.46" para una nota de ~10" → dy≈0 → los glifos no se movían y el paso callaba; ahora la caja del MText sale de `ActualWidth/ActualHeight` + punto de inserción + rotación, y si el fondo no sube el paso lo dice ("bottom did not move up"). El desplazamiento necesita ese DLL; sin extensiones el paso lo dice ("orphan shift NOT computed") y queda `fase1-notes-shift.py`.
- Si devuelve "Request timed out": NO reintentes. Mira `plugin.log` (qué paso quedó `cancelled`) y la hora del destino; manda el destino a medio hacer a la Papelera y repite con Civil 3D sin otro dibujo abierto (una vez se colgó 55 s en `attachXref` con otra copia que referenciaba el mismo X-TOPO abierta).
- Sin Claude (sin créditos): `scripts/fase1-build-run.mjs` corre el mismo código compilado (`build/tools/domains/fase1Build.js` + `fase1Audit.js`) directo contra el plugin; sin `--build` = plan en seco, con `--build` pide escribir el nombre del destino en una terminal interactiva o `--confirm "<nombre>"`; `--finish` encadena `fase1-finish.mjs`; se niega si el destino ya existe; deja `result.json` junto al payload. **Validado en vivo 2026-10-01** (`FASE1-BUILD-TEST3.dwg`, se conserva junto a TEST2 en la carpeta de VILLA ONE como copia de referencia): 15/15 + auditoría 9 OK en 10 s, mismos 45 glifos +7.621, plot idéntico al de TEST2 (0 píxeles distintos, mismo texto). Claude solo puede correrlo porque el usuario lo permitió en `.claude/settings.local.json` (reglas `Bash(node …/fase1-build-run.mjs *)` + `Edit(…/fase1-build-run.mjs)` + nota en `autoMode.allow`; Claude no puede agregarse esas reglas él mismo — "Self-Modification").
- Desde 2026-10-01 el payload SÍ trae: símbolos PL (`c300-pl-symbols.mjs`, `--no-pl`), cotas de R/W del survey como `C-ANNO` (`c300-build-spec.mjs`, `--no-rw-dims`) y rótulos de calle/lote con máscara. Desde 2026-10-01 (noche) también trae: **etiquetas de utilidades** (`c300-utility-labels.mjs` sobre el `asbuilt.json` de la cadena de as-builts; `--asbuilt`, `--no-labels`; líneas partidas a 26 caracteres) con sus bloques `EXIST ARROW`/`FH` por **`blockImports:[{blockName,sourceFilePath}]`** (junto a `clImport`; crea antes la capa del bloque si el payload la describe; `--blocks-from <C-300 del paquete>`, nunca la guía; tool MCP: requiere el servidor desplegado, commit `a2e52a5`) y el **title block** (`c300-titleblock.mjs`: nombre, dirección, proyecto, AGR del POC, hoja, fecha, iniciales JH, contra los valores de la plantilla de Goulds; `project.json titleBlockFields/titleBlockFind` o un array `titleBlock` explícito; `--no-titleblock`). Lo que todavía NO trae: U.E. (plat), etiquetas Civil 3D «general note» (EOP / EXIST R/W / ALIGNMENT START: 30 + 2 en FASE 1), posiciones del replay del paquete (solo si existe paquete). **Un solo comando de punta a punta: `node scripts/fase1-from-scratch.mjs --dir <carpeta> --dwg "<destino nuevo>.dwg" --template <t.dwg> [--asbuilt …] [--blocks-from …]` (payload → build → plot + QC → lazo de despeje → informe).**

### civil3d_request_plan_approval  (aprobación; `src/tools/approvalTool.ts`, agregado: 2026-09-28)
- Cuándo: una secuencia conocida de pasos con aprobación (p. ej. la limpieza a Fase 1: `delete_layout`, `erase_entities`, `delete_pipe_network` ×n, `set_style`, capa congelada, `save`). Una llamada, un token POR PASO.
- Payload: `{ steps:[{toolName, action, parameters}, …] (1..40), ttlSeconds?:60..1800 (def. 900) }` → `steps[i].approvalToken`. Cada paso lleva su `toolName`/`action`/`parameters` exactos (misma regla que `civil3d_request_approval`: una acción → `action` interna y `parameters` sin `action`; multi-acción → `action` dentro de `parameters`).
- Reglas: se ejecutan EN ORDEN; el plan queda atado al DOCUMENTO activo (no a su contenido, que cambia con cada paso); otro documento, parámetros distintos, paso saltado o vencimiento → rechazo y hay que pedir un plan nuevo. Todo paso debe requerir aprobación (los de solo lectura se ejecutan directos).
- Necesita Node desplegado + reinicio de Claude Desktop (herramienta nueva).

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
- `view_apply_annotations`: aplica estilo, `bandSetStyle` o `clearBands`, `labels` (el mismo formato) y `labelGroups`. Empareja piezas por posición en planta (≤ maxMatchDistance, 1 ft). **Pasar `layer`**: sin ella la etiqueta cae en la capa actual. **Idempotente (2026-09-26, build 16:14)**: re-ejecutar actualiza en sitio (`reused:true`) las etiquetas que ya existen — estación/elevación por station+elevation, `NoteLabel`/`StationOffsetLabel` por ancla (`anchor`/`location`) + estilo, etiquetas de pieza por pieza+estilo(+`ratio`) — aplicando `labelLocation`, `layer` y `overrides`; así corregir una posición o un texto es 1 llamada, sin borrar. Un `labelLocation` distinto del ancla cuenta como arrastrada aunque falte `dragged:true` (antes se ignoraba en silencio y las etiquetas SAN LAT/C.O./WATER SERVICE quedaban apiladas sobre la calle). Cada etiqueta devuelve handle o error. Para las etiquetas de planta no hace falta una vista de perfil real: cualquier `profileViewName` sirve.
- `acad_move_entities`: mueve por handles (model o paper) con dx/dy.
- `acad_select_entities` (DraftingBatchCommands.cs `selectEntities`, 2026-10-02): deja entidades SELECCIONADAS por handle (selección implícita = lo que el usuario ve resaltado) y hace zoom de la vista Model (`zoom` default true, `zoomMargin` default 1.5; respeta la torsión; cambia a la pestaña Model). Solo lectura. Úsala para enseñarle una propuesta al usuario y pedir confirmación (p. ej. la línea de U.E.).

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

### acad_layout (geometry; LayoutCommands.cs; 2026-09-26)
- Nace de VILLA ONE fase 3: no había forma de crear el layout C-301 sin Core Console, y Core Console (LAYOUT COPY / LAYOUT TEMPLATE vía `.scr`) se cuelga o tarda 6-8+ min en cuanto el dibujo tiene varios objetos Civil3D (superficie + perfiles + redes) — el regen sin GPU de esos objetos en modo headless es demasiado lento. `acad_layout` corre en la sesión viva (`LayoutManager` + `Database.DeepCloneObjects`), sin Core Console, en menos de 1 s.
- `copy_layout`: clona toda la paper space de `sourceLayoutName` (título, borde, tabla de revisión — **incluye sus viewports**, hay que borrarlos/reemplazarlos después) a un layout nuevo `newName`, en las mismas coordenadas de papel. Copia el page setup (tamaño, plotter) con `Layout.CopyFrom` — best effort, nunca bloquea el copy si falla (un `-PLOT` explícito puede fijarlo después). `setCurrent` (default `true`) cambia la pestaña activa a la hoja nueva.
- `new_layout`: layout en blanco (sin título). `rename_layout` / `delete_layout` (rechaza borrar "Model"). `list_layouts`: nombre, `tabOrder`, `isModelSpace`, handle.
- Gotcha: layout de origen o destino que no existe → `CIVIL3D.OBJECT_NOT_FOUND` / `CIVIL3D.CONFLICT` con la lista de layouts disponibles en el mensaje.
- Gotcha (validado 2026-09-26): el clon **incluye el viewport de la hoja** (capa `0`, escala 1:1; `acad_list_viewports` lo devuelve con `isPaperSpaceViewport:false`). **No lo borres**: sin él, los viewports que crees después toman el número 1 y el plot sale en blanco. Borra solo los viewports de capa `VPORT` heredados.
- Gotcha: `copy_layout` también clona lo específico de la hoja de origen (flecha norte `sna`, escala gráfica, glifos `PDF_Geometry`, notas largas): límpialos (ver receta Fase 3, paso 8 de `c300-water-sewer-plan.md`). Mejora pendiente: filtros de exclusión + reemplazo de textos dentro de `copy_layout`.
- Gotcha: los viewports que crea `acad_create_entities` no traen escala de anotación → las cotas anotativas no se ven en el plot; ver `scripts/vp-annoscale-fix.scr.txt`.

### Cambios de plugin 2026-09-26 (build 16:38; C#-only, sin reinicio de Claude Desktop)
- `acad_list_viewports` devuelve `annotationScale` (nombre): `"1\" = 20'"` = bien; `"1\" = 1'"` (el default de un viewport hecho por API) = las cotas/MLeaders anotativos **no se ven** en él → corregir; `null` = viewport de la hoja (capa 0), correcto.
- `acad_layout list_layouts` devuelve `isCurrent` (pestaña activa). Antes no había forma de saber si la pestaña activa era Model.
- `acad_create_entities`: (1) un `viewport` nuevo recibe la escala de anotación que corresponde a su `scale` (busca el nombre estándar `1" = 20'` con espacios; si el dibujo tiene además una escala suelta `1"=20'` sin espacios, prefiere la estándar); (2) con `space:"model"` y algún `mleader`/`aligned_dimension`, cambia a la pestaña Model antes de crear (una pestaña de layout activa dejaba los anotativos en `1" = 1'`); (3) `mleader` sin `rotation` ya no sale antes de `OrientMLeader`: elige el lado de anclaje (TopRight si el texto queda a la izquierda de la flecha) con rotación 0. Probado en vivo (copia de CREATOR, que tiene la escala suelta `1"=20'`): viewport nuevo → `annotationScale:"1\" = 20'"` (la primera versión había tomado la suelta; corregida y reprobada).
- `civil3d_profile_view_apply_annotations`: idempotente (ver arriba). Etiquetas de pieza reutilizadas por pieza+estilo+`ratio`; probado en vivo con 4 etiquetas → 4 `reused:true`, 0 duplicados.

### Cambios de plugin 2026-09-26 (build 16:48; requieren Node `server/` + reinicio de Claude Desktop porque agregan una acción y campos)
- `acad_layout copy_layout` acepta `excludeLayers[]`, `excludeBlockNames[]`, `excludeTextContaining[]`, `excludeWindow{x1,y1,x2,y2}` (unidades de papel, centro de la entidad), `replaceText[{find,replace}]` (DBText, MText, atributos de bloque; subcadena exacta, las TABs/`\P` van tal cual). Nunca borra un viewport de capa 0. Devuelve `cleanup`. Con esto C-301 = `copy_layout` + 1 `create_entities`.
- `acad_layout set_viewport_scale {layout?, viewportHandle?}` (acción nueva, `setViewportAnnotationScale`): fija la escala de anotación de cada viewport de planta/perfil desde su `customScale` (`1" = 20'`), saltando el viewport de la hoja (capa 0); reemplaza el script de Core Console `vp-annoscale-fix` sección A. Devuelve `changed[]` (before/after) y `unchanged`.
- `acad_update_text_content` sobre un **MLeader** ahora acepta `x`/`y` (texto), `rotation`, `leaderX`/`leaderY` (punta de flecha), además de `text`/`height`.
- `acad_create_mtext`, `acad_update_text_content` (MText) y los ítems `mtext` de `acad_create_entities` aceptan `backgroundMask:true` (+ `backgroundScale`, 1.2 calles / 1.0 sujeto): la máscara del paquete (MTEXT 90=3, 45=escala) sin Core Console. Probado en el plot: el texto tapa el asfalto del X-TOPO. Sin `layer` el texto cae en la capa actual (puede ser `_NPLT`, no plotea): pasar siempre `layer`.
- `scripts/plugin-rpc.mjs <método> '<json>'`: llama al plugin directo (sin MCP) para probar métodos nuevos justo después del deploy, sin esperar el reinicio de Claude Desktop. Sin aprobación de token → solo lecturas o documentos scratch (`civil3d_drawing new templatePath=<hermano.dwg>`). Ojo: `saveDrawing saveAs` solo acepta rutas dentro de las raíces configuradas (OneDrive\Documents…), no %TEMP%.

### acad_get_system_variable / acad_set_system_variable (drawing; getSystemVariable/setSystemVariable en SystemVariableCommands.cs; 2026-09-26, build 19:48; requieren DLL + Node `server/` + reinicio de Claude Desktop)
- `civil3d_drawing` acciones `get_system_variable {name}` (lee CUALQUIER variable: valor, tipo, `writable`) y `set_system_variable {name, value, regen?}` (número/cadena/booleano; devuelve `previousValue` y `value`; `regen:true` regenera). Cambia la **sesión de Civil 3D, no el DWG**; requiere token de aprobación.
- **Lista de permitidos (no una lista de bloqueo)** para escribir: `LABELOVERRIDEGLYPHS`, `ANNOALLVISIBLE`, `ANNOAUTOSCALE`, `CANNOSCALE`, `LWDISPLAY`, `PDMODE`, `PDSIZE`, `LTSCALE`, `PSLTSCALE`, `MSLTSCALE`, `SELECTIONPREVIEW`, `HIGHLIGHT`. Cualquier otra se rechaza con la lista en el mensaje. Variables de seguridad/rutas (`SECURELOAD`, `TRUSTEDPATHS`…) **nunca** entran: el clasificador de auto-mode bloqueó tanto una versión genérica con lista de bloqueo como recortarla; si hace falta agregar una variable, agregarla a `WritableNames` en `SystemVariableCommands.cs` solo si es puramente de pantalla/dibujo.
- Ícono naranja "i" sobre etiquetas con override (Model): `set_system_variable LABELOVERRIDEGLYPHS 0 regen:true` (1 = mostrar). Nombre real extraído de `AeccCoreBase.crx`/`AeccUiLand.arx`; hay comandos `AeccShowLabelOverrideGlyphs`/`AeccHideLabelOverrideGlyphs`.
- Cómo se descubrió el nombre (reutilizable para otras variables/comandos de Civil): buscar cadenas UTF-16 en `C:\Program Files\Autodesk\AutoCAD 2027\C3D\*.crx|*.arx` con Python (`re` sobre bytes con `\x00` intercalados).
