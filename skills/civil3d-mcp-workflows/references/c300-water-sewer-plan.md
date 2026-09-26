# C-300 Water & Sewer Plan — receta desde X-TOPO + Property Appraiser

Hoja "WATER AND SEWER PLAN" (C-300) + perfil (C-301) de proyectos residenciales WASD de FormTech.
Reglas derivadas del archivo guía `VILLA ONE @XEREFT\C-300_GUIA_COMO_DEBE_QUEDAR.dwg` (26-04.047)
comparado con su `X-TOPO.dwg` base y con el proyecto Goulds (26-04.046). Estado y decisiones
abiertas del proyecto → memoria `villa-one-c300-status`.

## 0. Entradas y de dónde sale cada dato

| Dato en la hoja | Fuente | Cómo se obtiene |
|---|---|---|
| Geometría de vías, R/W, lotes, manhole, FH, cercas, BM | `X-TOPO.dwg` (survey, p. ej. `2607.0017 - CAD`) | xref; leer con `acad_list_text_entities` / `acad_list_polyline_entities` |
| Anchos de R/W (cotas 25.00' CL→R/W) | cotas del survey en capa `DIM` (estilo `1 IN 20`) | `scripts/dwg-dump.ps1 X-TOPO.dwg` → líneas `DIM|` |
| Folio, P.B./PG, subdivisión, lote/bloque, dueño, área | Property Appraiser Miami-Dade | `node scripts/pa-lookup.mjs --xy X,Y` (punto dentro del lote, coords del dibujo) |
| Casa / huella propuesta | `X-ARCH.dwg` (arquitecto) | xref |
| Redes existentes (WM, SAN, FH, MH) y referencias E#####/ES#### | `X-UTIL.dwg` + as-builts WASD | xref + MLeaders |
| Título, dirección del proyecto, No. proyecto, fecha, dibujante | usuario / propuesta | title block (paper space) |

**Dirección:** lotes vacíos traen dirección tipo `227XX` que el PA **no** geocodifica. Busca siempre por
coordenada (`--xy`); `--address` solo si el lote ya tiene dirección real. El centroide PA está en
coordenadas FL83-EF (EPSG 2236), las mismas del dibujo.

## 1. Estructura de entrega

- Carpeta del proyecto: `C-300.dwg` + subcarpeta `x-ref\` con `X-TOPO.dwg`, `X-ARCH.dwg`, `X-UTIL.dwg`
  (ruta **relativa** `.\x-ref\X-*.dwg`). Goulds final usa las xref en la misma carpeta (`.\X-*.dwg`); ambas valen si la ruta es relativa y resuelve.
- Xrefs: Overlay, inserción 0,0,0, escala 1, rotación 0. En la guía están en capa `C-ANNO`; la convención de la firma
  (`drawing-setup-xrefs-layers.md`) es capa `XREF` → confirmar con el usuario.
- Sistema de coordenadas `FL83-EF`, unidades pies.
- "Limpio": sin contenido de un proyecto anterior en model space, sin layouts `(OLD)`, sin alineaciones/pipe runs ajenos. Verificar con listados por ventana de coordenadas; borrar solo con OK del usuario (regla de oro 10).

## 2. Orientación — DVIEW TWist ("la casa siempre de frente a la calle")

El viewport principal de C-300 se gira para que la **calle del frente quede horizontal** y su rótulo se lea de izquierda a derecha:

```
twist_rad = 2π − θ_calle        (θ_calle = rotación del rótulo de la calle / ángulo del CL en ese sentido)
```

Verificado: VILLA ONE θ(SW 118TH AVE)=1.59715 → twist 4.68603 (268.49°); Goulds θ(SW 232 ST)=0.0155 → twist 6.26765 (359.1°).
Viewport: 25.0 × 23.0 in, `viewht` 460 → **1"=20'**, capa `VPORT`.
- Leer: `acad_list_viewports { layout: "C-300" }` → `twistDegrees`, `scaleLabel`, `modelCenterX/Y`.
- Fijar: `acad_set_viewport_twist { layout: "C-300", streetAngleDegrees: <θ en grados>, centerX, centerY }` (centro = punto medio del lote; requiere token). Equivale a MSPACE → DVIEW → TW.

## 3. Alineaciones

- Una alineación centerline de la calle del frente: **una sola tangente** en la dirección del CL del survey, desde 20 ft más allá de la intersección lejana hasta el final del CL del survey, largo redondeado a 10 ft (guía: 440 ft). Capa `C-ROAD`, nombre `SW 118TH AVE` (formato: `SW <n>TH AVE|ST`). `c300-build-spec.mjs` la calcula.
- `civil3d_alignment create` con los dos extremos del CL; verificar con `station_to_point`.
- Pipe runs de proyectos anteriores (`Pipe Run - (n)`) y alineaciones de otro sitio no deben quedar.

## 4. Medir las vías (cotas)

- Cotas alineadas, estilo **`BCC-1.0`**, capa **`C-ANNO`**: del CL a cada línea de R/W → dos cotas por sección (p. ej. 25.00' + 25.00' = R/W 50').
- Una sección cada ~130 ft por calle dentro del viewport (VILLA: SW 118 Ave en 4 secciones, SW 227/228 St en 2 cada una).
- Replican las cotas del survey (`DIM`, `1 IN 20`) — mismos puntos p13/p14 ±1 ft. Si el survey no trae una cota, medir perpendicular al CL hasta la línea de R/W.
- Servidumbres: cota `5.00'` + MLeader `EXIST 5' U.E.`.
- Opcional (Goulds sí, VILLA no): ancho de pavimento `<>\P(EXIST ASPHALT)`, acera `<>\PPROP SIDEWALK`.
- Leer las del survey: `acad_list_dimensions { layer: "DIM" }` (en X-TOPO abierto) o `dwg-dump.ps1`.
- Crear: `acad_create_aligned_dimension { x1,y1 (CL), x2,y2 (R/W), dimStyle: "BCC-1.0", layer: "C-ANNO", offset }` una por lado (token por cada una). Texto extra: `textOverride: "<>\P(EXIST ASPHALT)"`.

## 5. Rótulos (model space)

| Elemento | Tipo / capa | Formato |
|---|---|---|
| Nombre de calle | MText `TextTopoLabel_ep`, h=3.0, rotación θ_calle | `SW 118TH AVENUE`, `SW 228TH STREET` (sin puntos; el survey dice `S.W. 118TH AVENUE`) — 2 por tramo |
| Símbolo CL | bloque `_cl`, capa `TEXT`, escala 30, rotado con la calle | sobre el CL, cerca del rótulo |
| Símbolo PL | MText `⅊`, capa `TEXT`, fuente ISOCPEUR `\H1.42857x` | en cada línea de R/W / lote |
| Propiedad | MText `TextTopoLabel_ep`, h=2.8, rotación θ_calle | `<DIRECCIÓN> FOLIO NO: <folio>\P{\fArial\|b1;SUBJECT PROPERTY\PPROP ONE (1) <área> SF \PSINGLE FAMILY RESIDENCE\P<GPD> GPD\P}P.B.\t<libro> PG-<página>` |
| Existente | MLeader `C-ANNO` color 8 | `EXIST 8" DIP WATER MAIN \P(PER E14611-2)\P(TO REMAIN)` · `EXIST 8" PVC (SDR-35) SAN MAIN @ 0.39% SLOPE\P(PER ES9467-2)\P(TO REMAIN)` · `EXIST FH\P(PER E14611-2)\P(TO REMAIN)` |
| Manhole existente | MLeader `C-ANNO` color 8 | `EXIST. SAN MH \PRIM: <rim>'\PINV: <inv>' (E)\PINV: <inv>' (W)\P(<ES as-built>)` — una línea INV por tubo |
| Propuesto | MLeader `C-ANNO` ByLayer | `PROP CLF` · `PROP 23 LF OF 6" PVC (C-900) SAN LAT @ 1.04% SLOPE\P(PER SS 1.0 SHT 1 OF 2)` |
| Bloques | `FH` (dinámico) en `C-FH-EXIST`; `EXIST ARROW` en `C-ANNO` | |

Folio / P.B. / lote salen de `pa-lookup.mjs`; **nunca** copiar el folio del proyecto anterior (error real encontrado en la guía, ver memoria).

## 6. Title block (paper space, layouts C-300 y C-301)

Editar con `acad_list_text_entities { space: "paper", contains: … }` + `acad_update_text_content`, preservando códigos MText:
- Título: `WATER MAIN AND SANITARY\PSEWER EXTENSION PLAN\P<NOMBRE PROYECTO>\P<DIRECCIÓN>`
- `UNINCORPORATED\PMIAMI-DADE COUNTY, FL` (o municipio del PA `municipality`)
- Hoja: `C-300` "WATER AND\PSEWER PLAN" escala `1"=20'`, `2 OF 3`; `C-301` "WATER AND\PSEWER PROF" `AS SHOWN`, `3 OF 3`
- Project No. (`26-04.047`), DRAWN BY `JH`, APPROVED BY `CF`, fecha `MM/DD/YY`, `AGR. NO. <n>`; bloques `cformoso seal` (SEAL) y `sna` (TEXT).

## 7. Pipeline automatizado (validado 2026-09-25 con VILLA ONE → `VILLA ONE @XEREFT CREATOR.dwg`)

Propiedades de cada elemento: **`references/standards/formtech-c300.json`** (capas, estilos, alturas, bloques,
reglas). No las escribas a mano: el generador las toma de ahí. ~25 llamadas MCP en total.

| # | Paso | Herramienta | Notas |
|---|---|---|---|
| 1 | Dump del X-TOPO nuevo | `scripts/dwg-dump.ps1 X-TOPO.dwg` | lee el último estado **guardado** |
| 2 | Datos PA | `node scripts/pa-lookup.mjs --xy X,Y` | folio, P.B./PG, centroide del lote (= `lotPoint`) |
| 3 | `project.json` | a mano (plantilla en el encabezado de `c300-build-spec.mjs`) | ventana del sitio, dirección, datos PA, SF/GPD, title block |
| 4 | Spec | `node scripts/c300-build-spec.mjs --topo <dump> --project project.json --out spec.json` | 1 payload `acad_create_entities` + alignment + twist |
| 5 | Plantilla limpia | `scripts/c300-prep-template.ps1 -Source <C-300 anterior> -Out "<carpeta>\<NOMBRE>.dwg"` | vacía model space, quita xrefs, renombra layouts |
| 6 | Abrir | `civil3d_drawing new templatePath=<ese .dwg>` → `save saveAs=<mismo path> overwrite:true` | no hay "open"; así se abre sin el usuario |
| 7 | Xref | `acad_attach_xref` X-TOPO, overlay, capa `XREF`, 0,0,0 | queda con ruta relativa `.\X-TOPO.dwg` si está en la misma carpeta |
| 8 | Alignment | `civil3d_alignment create` con `spec.alignment` | 1 tangente, capa `C-ROAD` |
| 9 | Bloque `_cl` | `acad_insert_block_reference` (1er `_cl` del spec) con `sourceFilePath`=X-TOPO | importa la definición si falta |
| 10 | Todo lo demás | `acad_create_entities` con `spec.createEntities` (sin el `_cl` del paso 9) | 1 aprobación; tab real en `P.B.<TAB>46` |
| 11 | Giro | `acad_set_viewport_twist` con `spec.twist` + `viewportHandle` del viewport grande de C-300 | |
| 11b | Vista de modelo horizontal | `acad_set_viewport_twist` con `layout:"Model"`, `streetAngleDegrees` = ángulo del alineamiento del frente (VILLA 91.5109), centro = punto medio del alineamiento → giro 360−θ, SNAPANG = θ (cursor alineado), el dibujo queda abriendo en Model | igual que el objetivo: VPORT *ACTIVE 51 = 4.686 rad, 50 = 1.597 |
| 12 | Title block | `acad_list_text_entities contains:` `EXTENSION` · `26-04` · `C-30` · `AGR` · `/26` → `acad_update_text_content` ×2 layouts | cambiar solo la subcadena |
| 12b | X-UTIL / X-ARCH propios | copiar los del paquete a la carpeta de entrega y borrar lo de otros sitios (Core Console, entdel por ventana, sin tocar inserts de xref) → `acad_attach_xref` overlay en `XREF` | nunca editar los originales del paquete |
| 12c | Datos de as-built | transcribir `asbuilt.json` desde ES-####-# / E-####-# (TIF → PNG con System.Drawing, recortar y leer): MH N/E, RIM, INV por dirección; tramos (material, pendiente); F.H. ASSY N/E | **verificar pendientes** = ΔINV / distancia entre coordenadas de MH; flujo = sentido de INV decreciente |
| 12d | Etiquetas de utilidades | `node scripts/c300-utility-labels.mjs --asbuilt asbuilt.json --out labels.json` → importar `EXIST ARROW` y `FH` del ejemplo con `acad_insert_block_reference sourceFilePath` → `acad_create_entities` (bloques + MLeaders) | MLeaders con `rotation` = ángulo de la calle; **sin `scale`** (Formtech-1.0 es anotativo) |
| 12e | Símbolos PL | `node scripts/c300-pl-symbols.mjs --frontage <θ> --center <X,Y> --out pl.json` → `acad_create_entities` | lotes del plat del condado (Lot_poly); texto con `\U+214A` |
| 12f | Servidumbres (U.E.) | ancho/lindero del plat grabado (o confirmación del usuario); geometría SIEMPRE desde R/W del survey + dimensiones legales del lote → `acad_create_entities` (2 polilíneas DASHED2 c8, 2 cotas 5.00', MLeader) | el GIS del PA no muestra servidumbres (quedan dentro de los lotes) |
| 14 | Diseño propuesto — agua | `civil3d_network_catalog` (nombres exactos) → `civil3d_pressure_network_create` → tubos/accesorios/válvulas en las coordenadas del paquete del ingeniero (CL elev de diseño, p. ej. 6.17) | la lista "WASD Water" usa descripciones como `8" D.I.P. W.M.` |
| 15 | Diseño propuesto — alcantarillado | `civil3d_pipe_network_edit create` (partsList "Sanitary Sewer", ref EG + alineamiento) → `add_structure` con `structureName` (MH#5, MH-01), `rimElevation` (queda fijo) y `sumpDepth` = RIM − INV → `add_pipe` con `pipeName`, z = INV + radio interior (0.3333 en 8") | verificar largo y pendiente devueltos (VILLA: 375.02 LF @ 0.400%) |
| 16 | Superficie y perfiles EG | superficie EG desde las cotas del X-TOPO; alineamiento corto del FH (tee → FH) → `civil3d_profile create_from_surface` por alineamiento | |
| 17 | Vistas de perfil C-301 | medir las del paquete: abrir copia (new-from-template, **no guardar**) → `civil3d_profile_view_info` sin nombre → en CREATOR `civil3d_profile view_create` (mismo nombre, sin `"` → usar `''`; STA −20..440 / −50..50; elev 0..14) → `civil3d_profile_view_set_location` (anchor = estación inicial, elev 0 → origen del paquete) → `civil3d_pipe_network_add_to_profile_view` | Civil 3D mueve la grilla al cambiar el rango; por eso el anclaje. Sewer y agua: STA 0+00 en el mismo X |
| 18 | Anotaciones C-301 | con la grilla idéntica, copiar 1:1 las anotaciones del paquete en la zona de perfiles: `scripts/c301-profile-annos.cjs` (dump → payload) → `acad_create_entities`; bloque del hidrante con `acad_insert_block_reference` (scaleX −5, sourceFilePath del paquete) | MLeaders h 2.0 en perfil (1.4 en planta); dims BCC-1.0 |
| 18b | Estilo y etiquetas del perfil | copia del paquete → `civil3d_profile_view_annotations` (por vista) → en CREATOR `civil3d_profile_view_apply_annotations` con `style`, `bandSetStyle` ("_No Bands") y `labels` **con `layer`** (StationElevationLabel en C-ROAD-PROF-TEXT; MANHOLE en C-STRM-TEXT; "Prop San Main" en C-ROAD-PROF-VIEW). Cotas de terreno: recalcular con `civil3d_profile get_elevation` sobre NUESTRO EG; cotas de diseño (INV, corona) del paquete | sin `layer` la etiqueta cae en la capa actual (en CREATOR `_NPLT` → no se imprime). Repetir el payload actualiza, no duplica. Etiquetas de cruce del paquete cuelgan de tubos existentes modelados por el ingeniero → modelarlos desde el as-built o omitir |
| 18c | Tubos existentes y cruces | inverts del MH de conexión: **survey** (X-TOPO MLeader "SW.MH. R.E. … I.E. (S)(E)(W)") > as-built. Tramos cortos conectados al MH (W/E hasta el R/W, S hasta el inicio de la vista) con pendiente = ΔINV(survey en el MH, as-built en el MH vecino)/distancia; agua existente como tubo de gravedad (parte 8 inch PVC) en red aparte "EXIST WM CROSSING" desde la tee (CL de diseño). `civil3d_pipe_set_part_properties` → Description = texto del as-built ("EXIST 8\" DIP WATER MAIN", "EXIST 8\" PVC (SDR-35)"), SAN-01 = 8" PVC (C-900). `civil3d_pipe_network_add_to_profile_view` con `partNames` (S en sanitario, W en agua, SAN-01 en FH). Etiquetas CROSSING LABEL TOP / - INV BOTT (C-STRM-PIPE-TEXT) con override índice 0 `<[Description(CP)]>\PTOP. EL.= x'\P(FIELD VERIFY)` / `…\PINV. EL.= x'` | el estilo imprime el invert de INICIO del tubo y la corona con radio interior → override con el valor en el cruce (VILLA: W 2.22, FH 3.40 = 2.22+0.4%·295', top DIP = 6.17+9.05"/2 = 6.55) |
| 19 | Viewports C-301 | `acad_list_viewports` en la copia del **paquete** → `acad_create_entities` kind `viewport` con esos valores (scale 0.05, locked). Si un viewport del paquete encuadra la vista equivocada (VILLA: 1562A mostraba el sanitario), moverlo por el offset entre vistas medido con `civil3d_profile_view_info` → borrar los viewports heredados. Notas MD-WASD: posición del paquete con `acad_move_entities` | nunca copiar números de la guía |
| 20 | QC visual | Core Console `-PLOT` (DWG To PDF.pc3, ARCH full bleed D, monochrome) sobre copias (con xrefs) desde **PowerShell** → leer los PDF y comparar con la guía (solo comparar) | `civil3d_sheet_publish_pdf` está deshabilitado en el plugin |
| 13 | Guardar + verificar | `civil3d_drawing save` → `dwg-dump.ps1` + `extract-standards.mjs --window` contra la guía | mismas recetas = OK |

Resultado VILLA ONE: alignment idéntico a la guía (±0.001 ft, 440 ft), giro 268.489° (guía 268.49°), centro ±0.6 ft,
32 entidades con las mismas propiedades que la guía. Etiquetas de utilidades hechas 2026-09-25 (12 MLeaders + 7 flechas + 2 FH, mismas recetas que la guía). No cubierto aún: U.E. 5' (plat), símbolos PL `⅊` (regla de ubicación), PROP CLF (diseño), perfiles C-301.

## 8. Reglas de fuentes (dictadas por el usuario 2026-09-25)
- **Mandan los archivos base** (survey, as-builts, POC, PA, y el paquete del ingeniero `C-300.dwg` + x-ref). La guía/hoja anterior la hizo una persona y puede tener errores (folio de Goulds, RIM 9.63 vs 9.69, FH 12 ft corrido): verificar, no copiar.
- **PROP CLF (cerca propuesta):** no se dibuja hasta tener fuente base. Pista del usuario: podría salir de la página del PA midiendo distancias entre propiedades — verificar antes de usarla. VILLA: el lindero este del lote (PaParcel/Lot_poly, compartido con el folio vecino) mide 89.50' y la cerca del objetivo cae a 3.56' de él → probable cerca sobre el lindero; confirmado por el usuario 2026-09-25: cerca SOBRE el lindero este del PA (retiro 0, todo el lindero) en capa V-SITE-FNCE (FENCELINE2, lts 0.3 como las cercas del survey) + MLeader "PROP CLF" receta proposedLeader con flecha al punto medio.
- **Etiquetas Civil de planta** ("EXIST R/W", "EOP" = AECC_GENERAL_NOTE_LABEL; "ALIGNMENT START/END" = AECC_STATION_OFFSET_LABEL): el DXF no trae geometría → `civil3d_profile_view_annotations` sin nombre devuelve `planLabels` del paquete (NoteLabel con anchor; StationOffsetLabel con alignmentName + location) → `civil3d_profile_view_apply_annotations` (cualquier vista como profileViewName) las recrea con estilo, capa, override y posición. StationOffsetLabel exige marcador ("_No Markers") y un punto estrictamente dentro del alineamiento (usar station_to_point). Si el estilo de la plantilla difiere del paquete, override índice 0 con el texto que imprime el paquete (p. ej. ALIGNMENT START/END con N/E por campos <[Northing(...)]>/<[Easting(...)]>).
- **La guía es solo el objetivo (usuario 2026-09-25): no se toma NADA de ella** — ni coordenadas, ni tamaños de viewport, ni objetos. `Draft 1.pdf` es un plot de la guía (tiene su RIM 9.63), tampoco es fuente. Auditoría de procedencia: `dwg-dump.ps1` de guía y paquete → diff por handle; lo que solo está en la guía (VILLA: PROP CLF, rótulo MH#7 9.63, rótulo 0.39% MH7-MH8, 2 flechas, arreglo del viewport de agua) no tiene fuente base → derivarlo de datos base con una regla explícita o preguntar.
- POC de WASD (`POC.pdf`): AGR, GPD agua/alcantarillado, descripción (unidades, SF), punto de conexión.
- Página del PA (`gisfs.miamidade.gov/mdarcgis/rest/services/MD_PA_PropertySearch/MapServer/6`, PaParcel, SR 2236 = mismo del dibujo): lotes y ubicación; comparar ángulo de la calle (debe coincidir con el giro) y anchos de R/W. Ojo: el polígono GIS puede diferir de la descripción legal — reportar, no ajustar en silencio.
- Giro: verificar con 3 fuentes independientes (CL del survey, coordenadas de MH del as-built, bordes de lote del PA) — deben coincidir ±0.05°.

## 9. Producción por fases (usuario 2026-09-25)
| Fase | Archivo | Contenido |
|---|---|---|
| 1 | `<NOMBRE> FASE 1.dwg` | **Solo Model + layout C-300**, condiciones existentes: alineamiento, calles/CL/R/W/EOP, utilidades existentes (as-built), MH, FH, U.E., lotes vecinos (LOT/BLK/FOLIO + medidas). **Nada propuesto.** |
| 2 | (siguiente) | Diseño en planta: agua/alcantarillado propuestos, laterales, cerca, etiquetas de diseño. |
| 3 | | C-301: EG, vistas de perfil, redes en perfil, anotaciones. |
| 4 | | QC contra el objetivo (solo comparar), plots, entrega. |

### Receta Fase 1 (validada 2026-09-25 en `VILLA ONE @XEREFT FASE 1.dwg`, ~60 llamadas MCP)
1. Pasos 1–4 del §7 (dump X-TOPO, PA, project.json, spec).
2. Plantilla: `c300-prep-template.ps1 -Source <C-300 anterior> -Out "<carpeta>\<NOMBRE> FASE 1.dwg" -DeleteLayouts 'C-301'`.
3. Abrir (`civil3d_drawing new` + `save saveAs` mismo path) → **verificar documento activo** (la guía puede estar abierta).
4. Xrefs overlay capa XREF: X-TOPO, X-UTIL, X-ARCH (los de la carpeta de entrega).
5. Alineamiento del spec; `_cl` desde X-TOPO; `acad_create_entities` del spec (rótulo del sujeto: SF/GPD/unidades del **POC**, folio del **PA**).
6. Giro viewport C-300 + vista Model (11 y 11b del §7).
7. Title block: textos del **C-300 del paquete del ingeniero** (layout C-300 de una copia abierta con new-from-template, sin guardar): título, proyecto, fecha, dibujó/aprobó, AGR (= POC).
8. Existentes: `c300-utility-labels.mjs` (as-built) + bloques `EXIST ARROW`/`FH` importados del **paquete** (`sourceFilePath`), capa `C-FH-EXIST` definida en `layers` (si no existe, la inserción cae en la capa actual `_NPLT`); cotas existentes del paquete (VILLA: 6.00' WM↔CL 118th, 8.00' WM↔SAN en 228th); U.E. (§8 easementLine). Todo en 1 `acad_create_entities`.
9. EOP / EXIST R/W / ALGN START-END: `planLabels` del paquete (solo NoteLabel + ALGN del alineamiento; SAN LAT/C.O./WATER SERVICE son de diseño → fase 2). `apply_annotations` exige una vista de perfil: crear una vista temporal (`civil3d_profile_view_create`), aplicar, **borrar la vista** (`acad_erase_entity`); las etiquetas de planta no dependen de ella.
10. Lotes vecinos: `node scripts/neighbor-lots.mjs --frontage θ --center X,Y --out lots.json` (Lot_poly + PaParcel + ficha PA por folio; **nunca** propietarios) → `node scripts/lots-vs-survey.cjs` (desvío GIS vs R/W del survey) → configurar `RW`/`ROWS` en `scripts/neighbor-lots-build.cjs` y correrlo → 1 `acad_create_entities` (cotas + rótulos `LOT n BLK n\PFOLIO: …` C-ANNO c8 h2.0 rot θ + notas QC en `_NPLT` que no imprimen) + reubicar los PL (`acad_update_text_content` x/y) sobre los linderos legales.
    - **Regla de medidas**: plats viejos (VILLA: Goulds Ests Sec 1, P.B. 46-94) → GIS del PA desplazado 0.1–13 ft y 4–21 % de área; se reconstruye cada lote con el "LOT SIZE W X D" legal del PA, anclado en la esquina de manzana = intersección de R/W del survey, frente sobre la calle, laterales paralelos a la calle del frente, fondo a D. Validación: manzanas con calle a ambos lados deben cerrar (VILLA BLK 9 y 10: 0.00 ft). Plats nuevos sin medidas en la legal (Southland P.B. 172-14/173-30) → polígono GIS (sobre el R/W del survey ±0.75 ft, área = PA).
    - Cotas: ancho del lote a 14 ft del R/W (libre de las etiquetas EXIST R/W a ~5 ft); fondos en los linderos interiores a 4 ft; no acotar sobre el R/W de la calle del frente (ya lo acota el survey).
    - Rótulo: caja completa dentro del lote visible, libre de textos existentes (muestreados por su extensión real, no solo el punto de inserción); si no cabe (VILLA LOT 6 BLK 3, franja ocupada por "BLOCK 3" del survey) se reporta y no se rotula.
11. Guardar, plot Core Console sobre copia con xrefs, **comprobar alto de texto de cotas en el PDF** (pymupdf `get_text('words')`: las cotas BCC-1.0 deben medir ~0.13"; 0.007" = cota no anotativa).

**Gotcha (encontrado 2026-09-25):** BCC-1.0 es un estilo de cota **anotativo**; el plugin anterior creaba las cotas sin la bandera anotativa → texto de 0.1 ft, invisible en 1"=20' (afectaba también a CREATOR: C-300 y 22 cotas de C-301). Corregido en `DimensionViewportCommands.ApplyStyleAnnotative` (cota anotativa + CANNOSCALE). Cotas ya creadas: borrar con Core Console (`(ssget "X" '((0 . "DIMENSION") (3 . "BCC-1.0")))` sin xdata AcadAnnotative → `entdel`) y recrearlas.
