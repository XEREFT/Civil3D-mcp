# Redes de tubería: agua a presión y gravedad

**Terminología:** *Pressure Network* se usa para agua (sistemas presurizados). *Pipe Network* se usa para gravedad (sanitario y pluvial). No las mezcles: son APIs y herramientas distintas.

## Red de agua a presión (conexión de agua típica)
Secuencia (nombres de acción del agregado `civil3d_pipe` o sus alias):
1. `civil3d_pipe_catalog` / `catalog_list` → nombres exactos de partes disponibles (no los inventes).
2. `civil3d_pressure_network_create { name, partsList, referenceAlignment?, referenceSurface?, layer? }`.
3. `civil3d_pressure_network_assign_parts_list` si hay que cambiar el parts list.
4. `civil3d_pressure_pipe_add { networkName, partName, startPoint{x,y,z}, endPoint{x,y,z}, diameter? }`. Los puntos salen de `station_to_point` sobre la alineación del main.
5. `civil3d_pressure_fitting_add { networkName, partName, position, rotation? }` para tee, codo, reducción, tapping sleeve.
6. `civil3d_pressure_appurtenance_add { networkName, partName, position, onPipeName? }` para gate valve, hidrante y medidor.
7. `civil3d_pressure_network_set_cover { networkName, minCoverDepth, maxCoverDepth? }`.
8. `civil3d_pressure_network_validate` → `civil3d_qc_check_pipe_network`.
9. Cantidades: `civil3d_qty_pressure_network_lengths` → `civil3d_qty_export_to_csv`.
10. Perfil: `civil3d_pipe_profile_view_automation` o `civil3d_profile_view_create` y luego agregar la red.

Otras acciones:
- Unir dos redes: `civil3d_pressure_network_connect { targetNetwork, sourceNetwork }`.
- Cambiar el diámetro: `civil3d_pressure_pipe_resize`.
- Exportar geometría y propiedades: `civil3d_pressure_network_export`.

**Muchos planos de conexión de agua NO tienen objetos Civil nativos.** Los fittings y el main pueden estar dibujados como polilíneas, bloques o primitivas (y a veces como PDF underlay). Confírmalo antes con `list_civil_object_types` / `civil3d_pressure_network_list`. Si devuelve 0 objetos, trabaja con las herramientas `acad_*`: `redline-qc-workflow.md` §4.

## Red por gravedad (sanitario / pluvial)
1. `civil3d_pipe_network_edit { action:"create", name, partsList, referenceSurface?, referenceAlignment? }`.
2. `add_structure { networkName, x, y, partName, rimElevation?, sumpDepth? }`. Nombra las estructuras en secuencia ("Manhole 01, 02…").
3. `add_pipe { networkName, partName, startStructure|startPoint, endStructure|endPoint, diameter? }`.
4. `civil3d_pipe_network { action:"check_interference", networkName, targetType:"surface"|"pipe_network", targetName }`.
5. Hidráulica: `civil3d_pipe_network_hgl_calculate`, `civil3d_pipe_hydraulic_analysis`, `civil3d_pipe_network_size`. Para SSA: `civil3d_stm export_stm`.
6. Orquestado: `civil3d_workflow_pipe_network_design` o `civil3d_hydrology_runoff_pipe_workflow`.
- Cada tramo por gravedad lleva flecha de flujo; el agua a presión no.
- Sanitario de 8" con pendiente mínima de 0.4 %. Los inverts se calculan tramo a tramo desde el invert inicial.

## Reglas numéricas Miami-Dade / WASD (usadas en proyectos de la firma; confirma la jurisdicción)
- Separación entre agua y alcantarillado: **7 ft centro a centro** (6 ft entre exteriores más margen).
- Cruces entre utilities: **10 ft**, medidos esquina a esquina en el punto más estrecho.
- El tubo que cruza **por encima** en un cruce con separación requerida pasa a **DIP** en unos 20–25 ft. Hay que mostrarlo en el perfil.
- El servicio debe cubrir **todo el frente** del predio sobre la calle.
- El medidor nunca va en un driveway. Se acota 2.5 ft desde el centro del medidor hasta la línea de propiedad.
- Datos de existentes llevan "P.O.D." (verifica en la hoja antes de darlo por norma).
- Callouts WASD: "PER G.S.1.7 (1/1)", "W.S.3.10", Sección 15102 Part 1.05. Consulta la leyenda WASD en `docs/reference/wasd-symbol-legend.md` del repo.
- `civil3d_standards_lookup` devuelve valores de norma genéricos. Para Miami-Dade, las reglas de esta lista prevalecen.

## Checklist de QC de red antes de entregar
1. `civil3d_pressure_network_validate` / `civil3d_qc_check_pipe_network` sin errores.
2. Cada STA/OFFSET de un callout coincide con la geometría (`station_to_point`).
3. Cada cruce del perfil tiene su callout de conflicto.
4. Las separaciones de 7 ft y 10 ft están verificadas.
5. Los cambios de material en cruces aparecen en el perfil.
6. Cada servicio tiene su etiqueta de dirección/dirección postal.
7. Nada se imprime más oscuro de lo esperado (revisar el color de las capas).
