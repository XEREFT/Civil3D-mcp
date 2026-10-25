# Pipe networks: pressure (water) and gravity

**Terminology:** *Pressure Network* = water (pressurized). *Pipe Network* = gravity (sanitary, storm). Different APIs and tools: never mix them.

## Pressure network (typical water connection)
Actions of the `civil3d_pipe` aggregate (or aliases):
1. `civil3d_pipe_catalog` / `catalog_list` -> exact part names (never invent them).
2. `civil3d_pressure_network_create { name, partsList, referenceAlignment?, referenceSurface?, layer? }`; `..._assign_parts_list` to change the parts list.
3. `civil3d_pressure_pipe_add { networkName, partName, startPoint{x,y,z}, endPoint{x,y,z}, diameter? }` (points from `station_to_point` on the main alignment).
4. `civil3d_pressure_fitting_add { networkName, partName, position, rotation? }` (tee, bend, reducer, tapping sleeve); `civil3d_pressure_appurtenance_add { ..., onPipeName? }` (gate valve, hydrant, meter).
5. `civil3d_pressure_network_set_cover { networkName, minCoverDepth, maxCoverDepth? }`.
6. `civil3d_pressure_network_validate` -> `civil3d_qc_check_pipe_network`.
7. Quantities: `civil3d_qty_pressure_network_lengths` -> `civil3d_qty_export_to_csv`. Profile: `civil3d_pipe_profile_view_automation` or `civil3d_profile_view_create` + add the network.
Others: join networks `..._network_connect { targetNetwork, sourceNetwork }`; resize `civil3d_pressure_pipe_resize`; export `civil3d_pressure_network_export`.

**Many water-connection plans have NO native Civil objects.** Fittings and main may be polylines, blocks, primitives (or a PDF underlay). Confirm with `list_civil_object_types` / `civil3d_pressure_network_list`; if 0 objects, work with `acad_*` tools (`redline-qc-workflow.md` §4).

## Gravity network (sanitary / storm)
1. `civil3d_pipe_network_edit { action:"create", name, partsList, referenceSurface?, referenceAlignment? }`.
2. `add_structure { networkName, x, y, partName, rimElevation?, sumpDepth? }` (name in sequence "Manhole 01, 02...").
3. `add_pipe { networkName, partName, startStructure|startPoint, endStructure|endPoint, diameter? }`.
4. `civil3d_pipe_network { action:"check_interference", networkName, targetType:"surface"|"pipe_network", targetName }`.
5. Hydraulics: `civil3d_pipe_network_hgl_calculate`, `civil3d_pipe_hydraulic_analysis`, `civil3d_pipe_network_size`; SSA: `civil3d_stm export_stm`. Orchestrated: `civil3d_workflow_pipe_network_design`, `civil3d_hydrology_runoff_pipe_workflow`.
- Every gravity run has a flow arrow; pressure pipes do not. 8" sanitary: minimum slope 0.4 %; inverts computed run by run from the starting invert.

## Miami-Dade / WASD numeric rules (used on firm projects; confirm jurisdiction)
- Water-to-sewer separation: **7 ft center to center** (6 ft between outsides plus margin). Utility crossings: **10 ft** corner to corner at the narrowest point.
- Pipe crossing **over** where separation is required becomes **DIP** for ~20-25 ft; show it in the profile.
- Service must cover the **full frontage** on the street. Meter never in a driveway; dimension 2.5 ft from meter center to property line.
- Existing data carries "P.O.D." (verify on the sheet before treating it as a rule).
- WASD callouts: "PER G.S.1.7 (1/1)", "W.S.3.10", Section 15102 Part 1.05; symbol legend in the repo `docs/reference/wasd-symbol-legend.md`. `civil3d_standards_lookup` returns generic values; for Miami-Dade these rules (and `mdwasd-standards.md`) prevail.

## Network QC checklist before delivery
1. `..._network_validate` / `civil3d_qc_check_pipe_network` clean.
2. Every callout STA/OFFSET matches geometry (`station_to_point`).
3. Every profile crossing has its conflict callout; 7 ft and 10 ft separations verified; material changes at crossings shown in the profile.
4. Every service has its address label.
5. Nothing plots darker than expected (check layer colors).
