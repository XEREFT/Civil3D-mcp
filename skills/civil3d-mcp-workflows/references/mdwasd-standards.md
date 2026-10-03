# Normas MDWASD (Miami-Dade Water & Sewer) — la ley del condado

Fuente oficial: https://www.miamidade.gov/global/service.page?Mduid_service=ser148156625339722 («Water and Sewer Design & Construction Standards»). Leído 2026-10-02: UC-005 (Project Approval, R-7 2/2015), Standard Details GS 0.5, GS 1.5 (10/1/2017), WS 2.21 hojas 1-3, UC-250, UC-310, UC-075. Datos máquina-legibles: `standards/mdwasd-standards.json` (única fuente de números para scripts). Aplican **tanto a limpieza de datos existentes (Fase 1) como a propuestas de diseño**.

## Servidumbres (UC-005 A.8–A.11, A.15, A.21; WS 2.21)

| Caso | Ancho | Offset desde el eje | Rótulo |
|---|---|---|---|
| Solo agua | 12 ft | 6 ft c/lado | `twelve (12) feet MDWASD easement` |
| Solo alcantarillado | 15 ft | 7.5 ft c/lado | `fifteen (15) feet MDWASD easement` |
| Agua + alcantarillado | ≥ 23.5 ft | 6 ft del agua, 7.5 ft del alcantarillado, 10 ft entre ambas | — |

- Línea oscura discontinua; tubería única **centrada** en la servidumbre.
- Sin estructuras ni árboles dentro (ni en su proyección vertical); líneas aéreas solo con ≥ 25 ft de holgura.
- Medidores, hidrantes y demás accesorios **fuera** de la servidumbre del main, con servidumbre propia (A.11). Medidores en propiedad privada = parte de una servidumbre MDWASD; línea de servicio ≤ 50 ft main→medidor (B.5).
- WS 2.21: servicio 1"–2"/4" y FH → 6 ft a cada lado del main, 6 ft a cada lado de la línea de servicio, +2.5 ft más allá de la caja del medidor, +6 ft más allá del hidrante. Medidor turbina 8"/10": 6 ft del main, 12 ft + 10 ft a lo largo del servicio, 7 ft a cada lado.
- **No confundir** con la U.E. de un plat (p. ej. 5 ft en una línea de lote): esa sigue saliendo del plat + confirmación del usuario (`c300-easement.mjs`).
- Una servidumbre MDWASD **solo se dibuja si la tubería está en propiedad privada** (dentro de un lote del Property Appraiser). En R/W público aplican las reglas de ubicación de Miami-Dade Public Works.
- La servidumbre **registrada** (plat / O.R. Book, confirmada por el usuario) gana sobre la franja estándar (`c300-mdwasd-easement.mjs --recorded-width W --recorded-ref REF`).

## Separaciones (GS 1.5, F.A.C. 62-555.314, UC-005 A.16)

- Agua ↔ alcantarillado sanitario por gravedad / presión / force main: horizontal **10 ft preferido, 6 ft mínimo** (pared a pared; 6 ft solo con el agua ≥ 6 in sobre la corona del alcantarillado).
- Agua ↔ pluvial / reclamada: 3 ft mín (10 ft recomendado pared a pared con pluvial/alcantarillado, nota 2). Vacío: 10 preferido / 3 mín. Tratamiento in situ: 10 ft.
- Cualquier otro servicio/drenaje vs main de agua o alcantarillado fuera de 62-555.314: **5 ft cara a cara**.
- Cruces: **12 in** verticales (invertido de la superior a la corona de la inferior); agua por encima siempre que sea posible. Si no: ambas DIP, juntas equidistantes (≥ 10 ft entre juntas), 6 in mín. Cruzar perpendicular cuando se pueda. Laterales: 12 in, o tramo de 20 ft DIP centrado / C-900 SDR18.

## Alcantarillado / agua (UC-005 B, C, D; UC-250; UC-310)

- MH como máximo cada **400 ft**; rotular número de MH, pendiente, tamaño, material y distancia al siguiente; mostrar INV con dirección de flujo y RIM encima del MH.
- Cobertura sanitario: zonas verdes < 2.5 ft DIP+losa; 2.5–6 DIP/C900 (PVC SDR35 con losa no reforzada si se aprueba); 6–14 PVC; > 14 DIP. Pavimento: < 3.5 ft DIP o C900; < 2.5 ft DIP + losa reforzada.
- Válvulas de compuerta cada **660 ft**; mains ≥ 20" válvula cada ½ milla; lateral de hidrante ≤ **50 ft** y de 6".
- Cobertura agua/force main: ≤ 12": 30 in; 16–24": 36 in; menos → losa de concreto reforzado (GS 1.2).
- Servicios: HDPE 1"/2" azul con alambre trazador (UC-075); servicios ≤ 2" desde mains existentes y corte/tapón de mains MDWASD los hace MDWASD a costo del dueño.
- Lateral: tee con riser (sewer ≥ 7 ft) o wye; tapón; estaca verde de 2x2x2 ft; ubicación medida y registrada antes de tapar (UC-310 3.01).

## Convenciones de plano (UC-005 1.05 A)

Existente = línea discontinua; propuesta = línea oscura continua; ambas con **tamaño + material + tipo**; ≥ 20" doble línea. Edificios identificados como existente/propuesto. Línea base nunca encima del main. Eje/baseline y R/W rotulados en 2 puntos. Escala planta 1" = 10'–40', perfil vertical 1/10. Notas estándar GS 0.5 en todos los planos; otras notas «Not Part of MDWASD Notes nor Approval».

## Record drawing (GS 0.5 hoja 2) — lo que debe traer un as-built

Agua: tamaño, material, offset, deflexiones, estación de servicios/hidrantes/válvulas/fittings, cruces. Alcantarillado: número de MH, tamaño, material, deflexión, pendiente, laterales referidos al MH, cleanouts, **RIM + INV por dirección (N/S/E/W)**, coordenadas State Plane (NAD83 FL East) de **todos** los MH y válvulas + 2 puntos de control. Se elimina toda información «PROPOSED». Esto fija los **campos obligatorios** de `asbuilt-review.py`.

## Cómo se usa en el flujo

| Paso | Qué hace |
|---|---|
| `scripts/mdwasd-check.mjs --asbuilt asbuilt.json --report pa-area.json [--json out]` | separaciones agua–alcantarillado, cruces, MH ≤ 400 ft, etiquetas con tamaño+material, RIM/INV, cobertura, FH ≤ 50 ft, mains en propiedad privada → servidumbre. Niveles WARN/INFO/OK; **nunca** modifica valores. |
| `fase1-qc.py` | llama a `mdwasd-check.mjs` y agrega la fila «MDWASD standards»; los INFO se imprimen aparte. |
| `scripts/c300-mdwasd-easement.mjs --check out.json --spec spec.json` | payload `acad_create_entities` con la franja DASHED2 (C-ANNO) + rótulo estándar para cada main en propiedad privada. |
| Propuesta de diseño | usar los números de arriba al ubicar; correr `mdwasd-check.mjs`; usar `civil3d_standards_lookup topic=mdwasd` para citar la sección. |

## Manual CAD & GIS de WASD (enero 2026) — leído 2026-10-02

Fuente: https://www.miamidade.gov/resources/water/documents/wasd-cad-manual.pdf (92 págs.; CAD Manager Eric Vilaire, 305-878-6051). Todo en `standards/mdwasd-standards.json` → `cadManual`.

- **Georreferencia/unidades:** NAD83 Florida East 901, NGVD29, decimal + US Survey Feet, modelo 1:1, texto Simplex. Pendientes a 0.01 %, elevaciones e inverts a 0.01 ft, estacionado continuo cada 100 ft desde 10+00, coordenadas State Plane en inicio/fin/PI/PC/PT/accesorios. Planta 1"=20' (o 40'), perfil vertical 1"=2'.
- **Capas existentes (US NCS):** agua `C-WATR-PIPE-EXST` (190, HIDDEN 0.006"), `C-WATR-FITT-EXST`, `C-WATR-INST-EXST` (152, válvulas/medidores); sanitario `C-SSWR-PIPE-EXST` (70, HIDDEN), `C-SSWR-FITT-EXST`, `C-SSWR-STRC-EXST` (80); levantamiento `V-WATR*`, `V-SSWR*`, `V-ESMT` (DASHED2), `V-RWAY`, `V-PROP-LINE`, `V-PROP-LOTL`. Capas GIS `*_WASD` solo para as-builts en planta.
- **Callouts (Tabla 3.7.1/3.7.2):** `STA. XX+XX (O/S XX' LT./RT.)` + `PROP. …` + `REST. W/GLANDS`; MH de levantamiento `MHSA / RIM ELEV.=X.XX' / 8" CLAY (E) INV. ELEV.=X.XX' / BOTTOM ELEV.=X.XX'`.
- **Capítulo 7 (as-builts para GIS):** plantilla oficial, líneas simples base-a-base, bloques/COGO en el punto levantado, solo activos verificados en campo (sin árboles, postes, cotas, lotes, EOP, ni info propuesta), atributos del Apéndice C, nombre `E/ES + 6 dígitos + C/D + fase + subfase` (p. ej. `EXXXXXXC01A`).
- **Símbolos GS 3.0:** existente = abierto/gris, propuesto = sólido; válvula de compuerta = moño (bowtie); los exhibits A.1–A.8, B, C, D del 2026 equivalen a la transcripción 2024 de `docs/reference/wasd-symbol-legend.md`.
- **Plantillas DWT:** `WASDTemplate-Survey-Asbuilts.dwt`, `WASDTemplate-Pipeline-Design.dwt`, `WASD-Blocks.dwg` — los enlaces del sitio (`…/donation/part-6/…dwt`) devuelven **HTTP 404** (probado con www/sin www, mayúsculas, cabeceras de navegador, Wayback). Hay que pedirlas al CAD Manager de WASD o usar la copia que ya tenga la firma.

## Verificación de válvulas cada 660 ft (UC-005 B.6) — automatizada

`mdwasd-check.mjs`: toma las válvulas de `asbuilt.json` (`appurtenances` con `G.V.`/gate/butterfly/plug valve **y coordenadas**), las ajusta a las tuberías de agua (≤ 15 ft), arma el grafo de mains y mide la distancia por tubería entre válvulas **adyacentes**: > 660 ft = WARN; el extremo de un main sin válvula es solo INFO (la ventana del as-built termina donde termina el escaneo). Prueba sintética: `node scripts/mdwasd-selftest.mjs` (5 aserciones). VILLA ONE: 3 válvulas ubicadas, OK; Goulds: sin válvulas ubicadas (ventana de 155 ft), INFO.

## Detalles estándar leídos (imagen, 2026-10-02)

- **WS 4.50 hidrante (2013):** lateral de 6" DIP desde tee M.J./tapping sleeve + válvula de compuerta 6" en caja No. 2; cobertura 4 ft (54" al shoe); bloque de empuje 18"x18" (sin restricción mecánica); losa 3'x3'x6"; con acera dentro de 4-7 ft de offset el hidrante va a 1 ft de la cara de la acera en zona de grama, si no decide Bomberos; postes guía 4"x5' (2.5 ft enterrados) en la cara del carro bomba y a 2.5 ft del eje; sin postes en R/W FDOT.
- **WS 4.10 servicio (2006):** caja de medidor con eje a 2.5 ft dentro de la línea de propiedad; sin medidor si la caja cae en superficie de rodaje; tubo de cobre 1", cruce de calle en camisa de acero 1.5" con offset mín 18".
- **SS 1.0 lateral sanitario (2010):** lateral 6" mín, pendiente >= 1/8"/ft (coincide con la nota SLOPE 1/8"/FT de los as-builts), wye + codos 45 grados, matriz mín 8", 3 ft mín al invert, cleanout con tapón roscado en caja de concreto en la línea de propiedad / R/W / servidumbre, tapón hermético al final del lateral.
- Sin texto (solo imagen) y sin dimensiones útiles aún: SS 22.0, WS 1.0, GS 2.0, A 10 hojas 2-3 (abreviaturas, ya transcritas en `docs/reference/wasd-symbol-legend.md`).

