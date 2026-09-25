# Superficies, grading, volúmenes, hidrología

## Superficies
- Inventario: `civil3d_surface { action:"list" }` → `get` / `statistics_get`.
- Crear: `civil3d_surface { action:"create" }` y luego `add_points` / `add_breakline` / `add_boundary`. Desde un DEM: `civil3d_surface_create_from_dem`. Desde puntos COGO: primero `civil3d_point list_groups`.
- **Gotcha de campo (pasó en todos los proyectos revisados):** los puntos del survey suelen venir sin elevación o descripción útil, así que `Create Surface` desde point groups no sirve. Workaround:
  1. Arma una polilínea cerrada con las líneas de propiedad o referencia (en Civil 3D, `FILLET` con radio 0 para cerrar esquinas).
  2. Asigna la elevación a cada vértice con los shots del surveyor.
  3. Agrégala como breakline o boundary.
  Verifica siempre si los puntos tienen Z antes de proponer este workaround (`civil3d_point list` y mirar `elevation`).
- Consultar elevaciones: `get_elevation` (un punto), `get_elevation_along` / `civil3d_surface_sample_elevations` (a lo largo de una línea).
- Curvas de nivel: `civil3d_surface_contour_interval_set`, `extract_contours`.
- Análisis: `civil3d_surface_analyze_slope`, `_analyze_elevation`, `_analyze_directions`, `civil3d_surface_watershed_add`, `civil3d_surface_drainage_workflow`.
- QC: `civil3d_qc_check_surface`.

## Volúmenes
- Entre dos superficies: `civil3d_surface_volume_calculate` (base y comparación) → `civil3d_surface_volume_report`. Por región: `civil3d_surface_volume_by_region`.
- Comparación completa con reporte: `civil3d_surface_comparison_workflow` o `civil3d_workflow_surface_comparison_report`.
- Cantidades y CSV: `civil3d_qty_surface_volume`, `civil3d_qty_earthwork_summary` → `civil3d_qty_export_to_csv`.
- Si son lentos, pueden tardar más de 120 s: usa `civil3d_job start` para no provocar "Command timed out".

## Grading
1. Feature line: `civil3d_feature_line_create`. Para ver las existentes: `civil3d_feature_line list`.
2. `civil3d_grading_criteria_list` → `civil3d_grading_group_create` → `civil3d_grading_create`.
3. Superficie del grupo: `civil3d_grading_group_surface_create`. Volumen: `civil3d_grading_group_volume`.
4. Orquestado: `civil3d_workflow_feature_line_to_grading` y `civil3d_workflow_grading_surface_volume`.
- Talud y geometría de pendiente: `civil3d_slope_geometry_calculate`, `civil3d_slope_analysis`.

## Hidrología y detención (resumen)
- Cuencas: `civil3d_hydrology { delineate_watershed | trace_flow_path | find_low_point | calculate_catchment_area }`, `civil3d_catchment *`.
- Tc e hidrograma: `civil3d_time_of_concentration { list_tc_methods | calculate_tc | generate_hydrograph }`.
- Escorrentía → tubería / detención: `civil3d_hydrology_runoff_pipe_workflow`, `civil3d_hydrology_runoff_detention_workflow`, `civil3d_hydrology_watershed_runoff_workflow`.
- Detención: `civil3d_detention_basin_size_calculate`, `civil3d_detention_stage_storage`.
- SSA: `civil3d_stm { export_stm | import_stm | open_storm_sanitary_analysis }`.
Para métodos y parámetros usa `civil3d_help search "<tema>"`. No los adivines.
