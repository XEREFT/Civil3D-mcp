# Coordenadas, COGO, puntos, survey

## Sistema de coordenadas
- `civil3d_coordinate_system { action:"info" }` devuelve el código (`name`), la zona, el datum y las unidades.
- Los proyectos del sur de Florida (Miami-Dade, Doral) usan **NAD83 Florida State Plane East, US survey feet**. El código de Civil 3D es **`FL83-EF`**.
- Muchos DWG (sobre todo hojas de diseño o xrefs derivados) **no tienen sistema asignado** aunque sus coordenadas estén en FL East. Ejemplo: C-WS.dwg no tenía sistema y X-UTIL.dwg sí tenía FL83-EF. Si `info` devuelve `name: null`, no hay transformación posible. Avisa al usuario y, si hace falta, que lo asigne en Drawing Settings (no hay herramienta para asignarlo).
- `civil3d_coordinate_system { action:"transform", fromSystem:"drawing"|"geographic", toSystem, x, y }` convierte entre coordenadas del dibujo y lat/long. Solo funciona si el dibujo tiene sistema asignado y si la instalación expone el servicio (si no, devuelve un error explícito). En geographic, trata `x` como longitud e `y` como latitud y verifica el resultado con un punto conocido.
- Magnitudes de referencia en FL East (Miami-Dade): Easting de unos 800 000–950 000 ft y Northing de unos 400 000–600 000 ft. Si ves valores de otro orden, puede tratarse de coordenadas locales o de paper space. Algunos proyectos usan coordenadas locales desplazadas (T25-06.212: unos 316 000 / 16 300). **Averigua la escala del proyecto antes de suponerla.**

## Model space vs paper space (gotcha frecuente)
- Toda la geometría de diseño (alineaciones, tubos, callouts de planta) está en **model space** con coordenadas del proyecto.
- Los title blocks, las tablas de revisión, las notas generales y algunas notas de hoja están en **paper space** (layouts) con coordenadas de hoja en pulgadas (x≈-5…36, y≈0…24).
- `acad_list_*` devuelve `space` para cada entidad. No mezcles XY de paper space con búsquedas de proximidad en model space.
- `acad_create_text`, `acad_create_mtext` y `acad_create_mleader` aceptan `space:"paper"` + `layout`. En ese caso X/Y son coordenadas de la hoja. Por defecto escriben en model space.

## COGO
- `civil3d_cogo_inverse` (dos puntos → rumbo y distancia), `civil3d_cogo_direction_distance` (punto + rumbo + distancia → punto), `civil3d_cogo_traverse` (poligonal), `civil3d_cogo_curve_solve` (resolver una curva a partir de 2 datos). No crean nada: son cálculos puros y seguros.
- Úsalos para verificar acotados del plano (p. ej. que un STA/OFFSET o una distancia acotada coincidan con la geometría) antes de corregir un texto.

## Puntos
- `civil3d_point { list | get | create | import | export | delete | transform }`, `create_cogo_point`, grupos con `civil3d_point_group_create/update/delete`.
- Importar o exportar archivos requiere que la ruta esté dentro de `CIVIL3D_IMPORT_ROOTS` / `CIVIL3D_EXPORT_ROOTS`.
- Conteo por grupo: `civil3d_qty_point_count_by_group`.
- Antes de crear una superficie desde puntos, revisa que tengan Z (ver `surfaces-grading.md`).

## Survey
`civil3d_survey { database_list | figure_list | figure_get | observation_list }` es de solo lectura. Úsalo para ver figuras y observaciones del surveyor. **Nunca modifiques la geometría del surveyor en X-TOPO**: solo se permite limpieza visual.
