# Fase 1 - what to request from the client / surveyor / architect

Use at intake (`new-project.mjs`) and whenever `project.json` shows pending data. The BASE sheet is only as complete as what the client sends: every label we print comes from a document, never from an assumption. Send the list below to the person who delivered the files, keeping only the items still missing (check `project.json site.utilitiesPending`, `subject.gpd`, `sources`, and the intake folder first).

## A. Blocks the C-300 existing-utility labels (without these the sheet prints no existing SAN / WM)
1. **WASD Point of Connection (POC)** letter / printout: connection point (structure ID and address), the water and sewer main it connects to, GPD or flow, and the AGR (Agreement) number. Gives `subject.gpd`, the connection point, AGR.
2. **As-built / record drawings of the existing sanitary sewer** in the street(s) serving the lot (WASD drawing numbers, e.g. `ES####-#`): pipe size, material (PVC SDR-35, DIP...), slope, inverts, rim elevations, flow direction, manhole IDs. Scanned TIF/PDF is fine; the whole sheet, not a crop.
3. **As-built / record drawings of the existing water main** (WASD `E#####-#`): size, material, valves, hydrants, services, and the water meter location if any.
4. **Existing water and sewer service locations** for the lot (meter box, cleanout, lateral) if known; otherwise confirm there are none.
5. **Project number** and the engineer's **internal job / permit number** to print in the title block.
6. **GPD calculation or the use data** to compute it: use, number of units, bedrooms, fixture units / meter size requested, and whether it is new, an addition or a change of use.

## B. Survey completeness (ask the surveyor, not the client)
7. The surveyor's **native DWG** at the correct version, with its **fonts** (the FormTech file referenced `dot.shx`, `archstyl.shx`, `engineering.shx`, which were missing and had to be replaced by simplex).
8. Confirmation that the survey shows **all** sanitary and storm structures within the working window, and the **sanitary main in the street** (only manholes appear): pipe run between manholes, direction and size. If the connection manhole is off the survey, a **supplemental survey** to it.
9. **Water features**: valves, meters, hydrants, water main and services were not surveyed (none appear). Ask whether they were located; if not, whether an SUE (utility locate) is available.
10. Signed and sealed **PDF of every sheet** (not only sheet 1) and the survey **date / revision**; vertical datum (NAVD88) and whether the elevations are on it.
11. **Easements**: recorded easements affecting the lot (utility, drainage, access) and the plat/O.R. references. The plat decides; the survey often says "none shown".

## C. Scope and design intent (from the client / architect)
12. **Scope of work in one paragraph**: what is to be built (sewer extension + connection, new water service, fire line...), the intended connection manhole and the route if the client already has one.
13. **Architect's utility information**: site plan with utilities, plumbing riser / fixture count, cleanout and meter locations, any proposed utility easement, building footprint changes. The architect's DWGs supplied here were site + floor only.
14. **Recorded plat** (P.B. / PG) and the **owner's authorization** / agent letter if WASD requires it for the application.
15. **Submittal requirement**: the intake `info.txt` said to highlight the folder that correlates to the SUBMITTAL; ask which submittal (WASD application, building permit, pre-application) and its **due date**, and whether the County wants specific sheet numbering.
16. **Zoning, folio and use** confirmation (the sheet prints RU-1 from the architect and the folio from the Property Appraiser; ask the client to verify).
17. **Fire flow / sprinkler requirement** (fire line size) and whether a **backflow preventer** is planned.

## D. Hygiene on the delivery itself
18. All files in **one folder per project** with the original names; no zipped duplicates; the architect's xrefs (images, fonts, referenced DWGs) included so they open without "missing reference" errors.
19. Any **previous submittals / correction letters** from the County for this site.

## Message template (short, English; adapt the numbers)
> To complete the existing-conditions sheet we still need: (1) the WASD POC with the connection point, GPD/flow and AGR number; (2) the as-built drawings of the existing sanitary sewer and water main serving 7421 SW 53 Ct (full sheets); (3) confirmation from the surveyor of any water features and of the sewer run to the connection manhole, with the DWG fonts; (4) the architect's plumbing/fixture count and service locations; (5) the scope of work and the submittal due date. We will not estimate any of these values; the sheet prints "pending" until they arrive.
