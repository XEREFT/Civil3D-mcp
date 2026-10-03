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

Datos aún por leer (pendiente): CAD manual / plantillas DWT (la descarga falló), GS 3.0 símbolos, A 10 abreviaturas, WS 4.x. Si alguna regla nueva sale de ahí, agrégala a `mdwasd-standards.json` con su sección y a `plugin/src/standards/data/mdwasd_rules.json`.
