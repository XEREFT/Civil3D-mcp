# Alignments and profiles

## Stations: format and conversion
- Plan format `10+30.52` = 1030.52 ft; tools take the number (`station: 1030.52`).
- Convert/compare: `node ~/.claude/skills/civil3d-mcp-workflows/scripts/summarize-entities.mjs --station "10+30.52"` prints the number; `--station 1030.52` returns `10+30.52`.
- **Station/offset -> XY:** `civil3d_alignment { action:"station_to_point", name, station, offset? }` (locate a callout, search nearby geometry). **XY -> station/offset:** `point_to_station { name, x, y }` or `civil3d_alignment_get_station_offset` (verify what a text says).
- LT/RT: confirm the offset sign convention with a known point first (usually left = negative).
- Several alignments (main, fire line, services): `civil3d_alignment { action:"list" }` first; each water profile (Water Main [1], [2], Fire Line) may have its own alignment and 0+00.

## Create / edit an alignment
1. `civil3d_alignment { action:"create", name, points:[{x,y},...], layer?, style?, labelSet? }` ("from objects" on an existing line: take vertices with `acad_list_polyline_entities`).
1b. **Firm style:** every C-300 alignment uses `BCC - ALIGNMENT` (dashed yellow with ticks) and label set "Major and Minor only". Pass it in `create`; if the alignment exists with another style (e.g. `Intersection Basic`, solid purple): `set_style { name, style:"BCC - ALIGNMENT" }` (idempotent; the style must exist in the drawing). Values: `standards/formtech-c300.json` -> `roles.alignment`.
2. Curves `add_curve { name, passThroughX, passThroughY, radius }`; spirals `civil3d_alignment_add_spiral`; tangents `civil3d_alignment_add_tangent`.
3. Place 0+00 on purpose with `civil3d_alignment_set_station_equation { name, rawStation, nominalStation }` so callouts land on clean stations.
4. Offsets/widenings: `civil3d_alignment_offset_create`, `civil3d_alignment_widen_transition`.
5. Labels: tick every 20 ft, station labeled every 100 ft (`civil3d_label` or the label set).
6. QC `civil3d_qc_check_alignment`; report `civil3d_alignment_report`.

## Profiles
1. EG: `civil3d_profile { action:"create_from_surface", alignmentName, profileName, surfaceName }`.
2. Design: `create_layout { alignmentName, profileName }` -> `add_pvi { station, elevation }` per PVI -> `add_curve { pviStation, length }` -> `set_grade`.
3. Queries: `get_elevation`, `sample_elevations`, `report`. QC: `civil3d_profile_check_k_values { designSpeed }` (roads) and `civil3d_qc_check_profile`.
4. Profile view: `civil3d_profile_view_create { alignmentName, profileViewName, insertX, insertY, style?, bandSet? }`; bands `civil3d_profile_view_band_set`; pipe network into the view `civil3d_pipe_profile_view_automation`.

## Water profiles (sheet C-3x1): what to check
- Fitting callouts by station (tapping sleeve, tee in vertical position, 90/45 bends, gate valve); cross-check each with the plan (C-3x0).
- Nearly identical stations (10+30.52 tee vs 10+35.52 bend) are different fittings.
- Crossings with other utilities: separation, callout, DIP on the pipe passing over.
- Minimum cover: `civil3d_pressure_network_set_cover`, checked against the EG surface.
