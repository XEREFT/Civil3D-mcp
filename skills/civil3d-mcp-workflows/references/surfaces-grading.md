# Surfaces, grading, volumes, hydrology

## Surfaces
- Inventory `civil3d_surface { action:"list" }` -> `get` / `statistics_get`. Create `action:"create"` then `add_points` / `add_breakline` / `add_boundary`; from DEM `civil3d_surface_create_from_dem`; from COGO points first `civil3d_point list_groups`.
- **Field gotcha (every reviewed project):** survey points often lack elevation or a useful description, so "Create Surface" from point groups fails. Workaround: (1) closed polyline from property/reference lines (`FILLET` radius 0 to close corners); (2) assign each vertex its elevation from the surveyor's shots; (3) add it as breakline/boundary. Check points have Z first (`civil3d_point list`, look at `elevation`).
- Elevations: `get_elevation` (point), `get_elevation_along` / `civil3d_surface_sample_elevations` (along a line). Contours `civil3d_surface_contour_interval_set`, `extract_contours`. Analysis `civil3d_surface_analyze_slope|_elevation|_directions`, `..._watershed_add`, `..._drainage_workflow`. QC `civil3d_qc_check_surface`.

## Volumes
- Two surfaces: `civil3d_surface_volume_calculate` (base + comparison) -> `..._volume_report`; by region `..._volume_by_region`. Full comparison: `civil3d_surface_comparison_workflow` / `civil3d_workflow_surface_comparison_report`. Quantities/CSV: `civil3d_qty_surface_volume`, `civil3d_qty_earthwork_summary` -> `civil3d_qty_export_to_csv`.
- Slow ones can exceed 120 s: use `civil3d_job start` to avoid "Command timed out".

## Grading
1. Feature line `civil3d_feature_line_create` (existing: `civil3d_feature_line list`).
2. `civil3d_grading_criteria_list` -> `civil3d_grading_group_create` -> `civil3d_grading_create`.
3. Group surface `civil3d_grading_group_surface_create`; volume `civil3d_grading_group_volume`.
4. Orchestrated `civil3d_workflow_feature_line_to_grading`, `civil3d_workflow_grading_surface_volume`. Slopes: `civil3d_slope_geometry_calculate`, `civil3d_slope_analysis`.

## Hydrology and detention (summary)
- Catchments `civil3d_hydrology { delineate_watershed | trace_flow_path | find_low_point | calculate_catchment_area }`, `civil3d_catchment *`.
- Tc / hydrograph `civil3d_time_of_concentration { list_tc_methods | calculate_tc | generate_hydrograph }`.
- Runoff to pipe/detention `civil3d_hydrology_runoff_pipe_workflow`, `..._runoff_detention_workflow`, `..._watershed_runoff_workflow`; detention `civil3d_detention_basin_size_calculate`, `civil3d_detention_stage_storage`; SSA `civil3d_stm { export_stm | import_stm | open_storm_sanitary_analysis }`.
Methods/parameters: `civil3d_help search "<topic>"`; never guess.
