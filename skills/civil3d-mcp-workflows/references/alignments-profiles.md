# Alineaciones y perfiles

## Estaciones: formato y conversión
- Formato en plano: `10+30.52` equivale a 1030.52 ft. Las herramientas reciben el número (`station: 1030.52`).
- Conversión y comparación de estaciones: `node ~/.claude/skills/civil3d-mcp-workflows/scripts/summarize-entities.mjs --station "10+30.52"` imprime el valor numérico. `--station 1030.52` devuelve el formato `10+30.52`.
- **Estación/offset → XY:** `civil3d_alignment { action:"station_to_point", name, station, offset? }`. Es lo que necesitas para ubicar un callout o buscar geometría cercana.
- **XY → estación/offset:** `civil3d_alignment { action:"point_to_station", name, x, y }` o `civil3d_alignment_get_station_offset`. Sirve para verificar lo que dice un texto.
- LT/RT: confirma la convención de signo del offset con un punto conocido antes de fiarte de ella (normalmente izquierda es negativo).
- Si hay varias alineaciones (main, fire line, servicios), `civil3d_alignment { action:"list" }` primero. En proyectos de agua, cada perfil (Water Main [1], [2], Fire Line) puede tener su propia alineación y su propio 0+00.

## Crear o editar una alineación
1. `civil3d_alignment { action:"create", name, points:[{x,y},…], layer?, style?, labelSet? }`. Para "Alignment from Objects" sobre una línea existente, toma los vértices con `acad_list_polyline_entities`.
2. Curvas: `add_curve { name, passThroughX, passThroughY, radius }`. Espirales: `civil3d_alignment_add_spiral`. Tangentes: `civil3d_alignment_add_tangent`.
3. Ubicar 0+00: `civil3d_alignment_set_station_equation { name, rawStation, nominalStation }`. Se hace a propósito, para que los callouts queden en estaciones limpias.
4. Offsets y ensanches: `civil3d_alignment_offset_create`, `civil3d_alignment_widen_transition`.
5. Etiquetas: la convención de la firma es un tick cada 20 ft y una estación rotulada cada 100 ft. Se hace con `civil3d_label` o con el label set.
6. QC: `civil3d_qc_check_alignment` · reporte: `civil3d_alignment_report`.

## Perfiles
1. EG (terreno existente): `civil3d_profile { action:"create_from_surface", alignmentName, profileName, surfaceName }`.
2. Diseño: `create_layout { alignmentName, profileName }` → `add_pvi { station, elevation }` (uno por PVI) → `add_curve { pviStation, length }` → `set_grade`.
3. Consultas: `get_elevation`, `sample_elevations`, `report`.
4. QC: `civil3d_profile_check_k_values { designSpeed }` (sobre todo para vías) y `civil3d_qc_check_profile`.
5. Profile view: `civil3d_profile_view_create { alignmentName, profileViewName, insertX, insertY, style?, bandSet? }`. Bandas: `civil3d_profile_view_band_set`. Para agregar una red de tubería al perfil: `civil3d_pipe_profile_view_automation`.

## Perfiles de agua (hoja C-3x1): qué revisar
- Callouts de fitting por estación (tapping sleeve, tee en posición vertical, codos de 90°/45°, gate valve). Cruza cada uno con la planta (C-3x0).
- Estaciones casi idénticas (10+30.52 tee y 10+35.52 codo) son fittings distintos.
- Cruces con otras utilities: separación, callout y material DIP en el tubo que pasa por encima.
- Cobertura mínima: `civil3d_pressure_network_set_cover`, revisada contra la superficie EG.
