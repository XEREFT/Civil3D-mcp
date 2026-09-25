# Flujo: redline (DG / QC markup) → correcciones en plan sheets

Validado en el proyecto T25-06.212 (Westport, C-310) y en Goulds C-300 y C-WS. Este archivo contiene el patrón general; el estado de cada proyecto va en su memoria.
Subagente: `civil3d-qc-redline` puede hacer las partes de lectura y diff. **Las escrituras las ejecuta la sesión principal.**

## Contenido
1. Insumos
2. Pasos (0–8)
3. Patrones de corrección típicos (servidumbres, tapping sleeve, tablas de revisión, MLeaders, title blocks)
4. Identificación de símbolos dibujados a mano
5. Reporte final

## 1. Insumos
- **DG / markup PDF**: correcciones en rojo (texto tachado, texto agregado, nubes).
- **Submittal / sealed PDF**: el estado final. Lo que el DWG debe decir.
- **DWG vivo**, abierto en Civil 3D.
- Si solo hay un PDF (solo markup), el markup define el cambio. Pregunta al usuario cuando algo sea ambiguo.

## 2. Pasos

**0. Pre-flight** (SKILL.md §0).

**1. Localizar el DWG correcto.** Busca el nombre con `Glob` en la carpeta del proyecto. Si hay más de una copia (p. ej. `…\` y `…\Camilo Results\`), **pregunta cuál es la viva**. Luego `acad_list_open_documents` y `acad_set_active_document`.

**2. Leer los PDFs, hoja por hoja.** Usa `Read` con `pages` sobre ambos PDFs, una hoja a la vez, y vuelve a leerlos en cada sesión (no te fíes de resúmenes previos). La extracción de texto de un plano CAD pierde la asociación espacial entre notas y líderes. Ancla cada nota por su estación/offset o por texto distintivo, no por su posición en la extracción.

**3. Tabla de diff** (muéstrala al usuario antes de escribir):

| # | Ubicación (STA/OFFSET u objeto) | DG (antes / rojo) | Submittal (final) | Acción |
|---|---|---|---|---|
| 1 | Sleeve STA 09+76.67 | `…TAPPED TO TAPPING VALVE…` | `…TIED TO TAPPING VALVE…` | Reemplazar subcadena |
| 2 | Clean-out STA 10+79.38 56.12' RT | `(TO REMAIN, PRIVATE)` | `(TO REMAIN)` | Eliminar `, PRIVATE` |

Acciones posibles: reemplazar subcadena · eliminar texto · eliminar nota completa (erase) · agregar nota o MLeader · consolidar dos notas en una · sin cambio (el DWG ya coincide; pasa a menudo).

**4. Encontrar cada entidad.** `acad_list_text_entities { contains: "<subcadena distintiva y corta>", space: "all" }`.
- Usa fragmentos que no dependan de saltos de línea: MText contiene `\P` y códigos de formato, así que "TAPPING SLEEVE" encuentra más que la frase completa.
- Si hay varios resultados, desambigua por posición y estación.
- Si sale vacío, puede que el texto sea geometría de PDF underlay (capas `PDF##_*`). En ese caso no es editable como texto: repórtalo.

**5. Verificar la verdad antes de escribir** (SKILL.md §2.6):
- Cualquier STA/OFFSET del texto se comprueba con `civil3d_alignment { action:"station_to_point", name, station, offset }`: debe haber algo en ese XY (ancla de leader, extremo de tubo, fitting).
- Offset LT/RT: ajusta el signo según la convención (normalmente LT es negativo) y confírmalo con `point_to_station` sobre un punto conocido.
- Coordenadas: la geometría de plan vive en model space con coordenadas reales (p. ej. 316000/16300 en NAD83 FL East). Las coordenadas pequeñas (x≈-5, y≈32) son de paper space. Ver `coordinates-cogo.md`.
- Una etiqueta duplicada en la misma estación con otro offset y sin leader propio es un **defecto que se reporta**, no se borra por iniciativa propia.

**6. Redactar y aplicar.** Toma el `text` crudo, cambia solo la subcadena, proofread del texto nuevo y luego:
`civil3d_request_approval { toolName:"acad_update_text_content", action:"update_text_content", parameters:{handle, text} }` → `acad_update_text_content { handle, text, approvalToken }`.
- Pide un token nuevo por cada edición: el token depende del estado del dibujo.
- Tabs reales en MText (p. ej. "2⇥OF⇥3") deben ir como carácter tab real, igual en la aprobación y en la llamada.
- Para eliminar una nota completa: `acad_erase_entity`, solo si el usuario confirmó esa fila.

**7. Guardar** al terminar la hoja: `civil3d_drawing { action:"save" }` (con token). Si `unsavedChanges` ya era true antes de empezar → `saveAs` en `…\<proyecto>\YYYY-MM-DD_QC\<archivo>.dwg` después de preguntar.

**8. Siguiente hoja.** Repite desde el paso 2. El plano de planta (C-3x0) y el de perfil (C-3x1) se revisan por separado: el perfil tiene sus propios callouts de fittings.

## 3. Patrones de corrección típicos (WASD / Miami-Dade)
- **Servidumbres (easement):** textos del tipo `PROP. 15' WASD GRANT OF EASEMENT`. El markup suele quitar calificativos (`NON EXCLUSIVE`, `NON-`, `(BY OTHERS)`). Verifica primero si el DWG ya coincide con el Submittal: en T25-06.212 ya coincidía y no hubo que tocarlo.
- **Tapping sleeve / tapping valve:** callout típico `PROP. 12"X10" D.I. TAPPING SLEEVE WITH 10" TAPPING VALVE AND 10"X12" INCREASER TIED TO TAPPING VALVE PER G.S.1.7 (1/1)`. Cambios frecuentes:
  - `TAPPED TO` → `TIED TO`.
  - Agregar la referencia `(REFER TO WASD DESIGN AND CONSTRUCTION STANDARDS SECTION 15102, PART 1.05. UTILITY CONTRACTOR MUST COORDINATE WITH WASD FIELD INSPECTOR AND MD-WASD WATER DISTRIBUTION TO AVOID ANY WATER INTERRUPTION TO THE NEIGHBORING PROPERTIES.)` y borrar la nota corta "NOTE: UTILITY CONTRACTOR TO COORDINATE…".
  - Consolidar la nota del sleeve y la de la válvula en una sola.
  - Suele repetirse en cada sleeve (izquierdo y derecho): aplica el mismo cambio en todos y verifica cada estación.
- **Fittings:** "GATE VALVE … VALVE BOX & LID" → "TEE IN VERTICAL POSITION" cuando el Submittal cambia el tipo de fitting. Cruza con el perfil (C-3x1), que suele nombrar el fitting completo (`PROP. 12"X6" D.I. TEE IN VERTICAL POSITION PER G.S.1.7`). El símbolo gráfico también puede tener que cambiar: ver §4.
- **Paréntesis y calificativos eliminados:** `(PER MD-WASD FIELD VERIFICATION)`, `, PRIVATE`, `- PER W.S.3.10 (1/1)`. Elimina solo esa subcadena y cuida que no queden espacios dobles ni comas colgando.
- **Notas duplicadas:** quita la duplicada solo si el Submittal no la tiene y el usuario lo confirma.
- **Tabla de revisiones:** en el layout (paper space) suele ser DBText/MText suelto por celda (No., fecha, descripción), no una tabla AutoCAD. Localízala con `acad_list_text_entities { space:"paper", contains:"CPR" }` o por la fecha. Para **editar** una fila: `acad_update_text_content` por handle. Para **agregar** una fila, usa `acad_create_text { text, x, y, height, layer, space:"paper", layout:"<layout de la fila anterior>" }`, una llamada por celda:
  - Copia `layout`, `layer`, `height` y la X de cada celda de la fila anterior (salen en la respuesta de `acad_list_text_entities`).
  - Calcula la Y restando el paso entre filas (Y de la fila N-1 menos Y de la fila N-2).
  - Si las celdas de la tabla son MText, usa `acad_create_mtext` con los mismos `space`/`layout`, para mantener el mismo tipo de entidad.
  - Alternativa: si ya hay celdas vacías o placeholder, reutilízalas con `update_text_content`.
- **Revision clouds:** son polilíneas o splines. `acad_list_polyline_entities { space:"all", colorIndex }`, agrupado con `summarize-entities.mjs --by layer`. Si solo aparece ruido de PDF underlay, puede que no existan: confírmalo visualmente con el usuario antes de borrar nada.
- **MLeaders nuevos:** `acad_create_mleader` con la punta en el XY del objeto (de `station_to_point`) y el texto desplazado a una zona libre. Usa la capa y el estilo de los callouts existentes: mira la capa de un MLeader existente con `acad_list_text_entities { entityTypes:["MLeader"] }`.
- **Title blocks / numeración de hojas:** ver `plan-production-sheets.md`.

## 4. Identificar símbolos dibujados a mano (tee / válvula / codo)
1. `acad_list_block_references { contains }` y `acad_list_text_entities` primero, porque son baratos.
2. Si no aparece: STA/OFFSET → XY con `station_to_point`.
3. `acad_list_shape_entities { nearX, nearY, nearRadius: 3–10 }` (o filtrado por la capa `PDF##_*`).
4. Compara la composición con `C:\Users\camil\OneDrive\Documents\Civil3D-mcp\docs\reference\wasd-symbol-legend.md` (o usa el subagente `wasd-symbol-reference`). Gris = existente; negro sólido = propuesto.
5. Indica la coincidencia y tu nivel de confianza. No existe la operación "swap block" para primitivas: redibujar (erase + insert block) es decisión del usuario.
6. Si encuentras un símbolo o una abreviatura nuevos, agrégalos al archivo de la leyenda con su proyecto y hoja de origen.

## 5. Reporte final (siempre)
```
Hoja: C-310 · DWG: <ruta> · Guardado: sí (save | saveAs <ruta>)
Aplicado: #1 handle 52FBA (TAPPED→TIED) · #2 handle 4D1CC (quitado ", PRIVATE") …
Sin cambio (ya coincidía): #5 servidumbres
Pendiente / requiere decisión: símbolo en STA 10+30.52 (primitivas, parece válvula) · duplicado 4FB02 8.23' LT
Gotchas nuevos: …
```
Guarda este estado en la memoria del proyecto (no en la skill).
