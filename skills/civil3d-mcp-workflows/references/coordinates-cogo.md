# Coordinates, COGO, points, survey

## Coordinate system
- `civil3d_coordinate_system { action:"info" }` returns code (`name`), zone, datum, units.
- South Florida (Miami-Dade, Doral) = **NAD83 Florida State Plane East, US survey feet**; Civil 3D code **`FL83-EF`**.
- Many DWGs (design sheets, derived xrefs) have **no system assigned** even when the coordinates are FL East (C-WS.dwg had none; X-UTIL.dwg had FL83-EF). If `info` returns `name: null` no transform is possible: tell the user (assignment is in Drawing Settings; no tool does it).
- `transform { fromSystem:"drawing"|"geographic", toSystem, x, y }` converts drawing coordinates <-> lat/long; needs an assigned system and the service exposed (else an explicit error). In geographic, x = longitude, y = latitude; verify with a known point.
- Reference magnitudes in FL East (Miami-Dade): Easting ~800,000-950,000 ft, Northing ~400,000-600,000 ft. Other orders = local coordinates or paper space (T25-06.212 uses shifted local ~316,000 / 16,300). **Find out the project scale before assuming it.**

## Model vs paper space (frequent gotcha)
- All design geometry (alignments, pipes, plan callouts) is in **model space** with project coordinates; title blocks, revision tables, general notes and some sheet notes are in **paper space** (layouts, inches, x ~ -5...36, y ~ 0...24).
- `acad_list_*` returns `space` per entity; never mix paper XY with model proximity searches. `acad_create_text/mtext/mleader` accept `space:"paper"` + `layout` (X/Y = sheet coordinates); default is model space.

## COGO
`civil3d_cogo_inverse` (2 points -> bearing/distance), `civil3d_cogo_direction_distance`, `civil3d_cogo_traverse`, `civil3d_cogo_curve_solve`: pure calculations, safe. Use them to verify dimensions (STA/OFFSET or a dimensioned distance vs geometry) before correcting a text.

## Points
`civil3d_point { list|get|create|import|export|delete|transform }`, `create_cogo_point`, groups `civil3d_point_group_create/update/delete`. Import/export paths must be inside `CIVIL3D_IMPORT_ROOTS` / `CIVIL3D_EXPORT_ROOTS`. Count by group: `civil3d_qty_point_count_by_group`. Check points have Z before building a surface (`surfaces-grading.md`).

## Survey
`civil3d_survey { database_list|figure_list|figure_get|observation_list }` is read-only. **Never modify the surveyor's geometry in X-TOPO**: only visual cleanup (layer colors/visibility, ByLayer, moving annotation text) is allowed.
