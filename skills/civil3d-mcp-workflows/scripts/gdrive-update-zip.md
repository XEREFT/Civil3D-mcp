# Update a delivery zip in the shared Google Drive folder

The folder `@XEREFT AutoCAD` (one subfolder per project, one zip per subfolder with a FIXED name, no date) is shared with the design
engineer. The folder link, sub-folder IDs and access mode live in the private memory `project-backup-sharing`, never in this skill
(the skill is synced to a public fork). Rule: updates are new VERSIONS of the same file, so the link never changes.

## Ground rules
- English names. One zip at a time, one browser tab (Claude in Chrome, the user's own Google session; if Drive asks to sign in, stop and tell the user, never type a password).
- Ask the user before replacing a zip that is already shared. Never share with edit permission; never switch the folder to "anyone with the link" unless the user asks.
- The zip name is always `<Project> @xereft base.zip` (e.g. `Villa one @xereft base.zip`).

## Steps
0. Save every open drawing (`plugin-rpc.mjs setActiveDocument {"match":"<Name>"}` + `saveDrawing`) and refresh the PDF (`base-pdf-refresh.mjs --dir`). A zip without the working DWG is a FAILED delivery (2026-10-26 incident).
1. Regenerate the zip (deliverables only: no DWL, no `_backup`, no `_reports`, no `project.json`):
   `node scripts\package-base.mjs --dir "<...>\Proyectos\<Name>\<Name> @xereft base" --zip` -> `%TEMP%\<Name> @xereft base.zip`. Report its size. The script stages a copy (an open DWG is locked: `Compress-Archive` skipped it silently) and exits 1 with `ZIP INCOMPLETE` if a deliverable is missing; then open the zip and compare the top-level entries and sizes with the folder BEFORE uploading.
2. Start the loopback server for that zip (the browser upload tool is limited to 10 MB):
   `node scripts\gdrive-serve-zip.mjs <token> 8799 "<Name> @xereft base.zip"` (run in background). Chrome may ask once for local-network access: that is the user's prompt.
3. In Chrome open the project's Drive subfolder (URL from memory). Check the name of the existing file and its modified time.
4. Ask the user "replace <name> (size, date) with the new zip (size)?" and wait for a yes.
5. In the Drive tab run (javascript_tool) a fetch of `http://127.0.0.1:8799/<token>/<encoded name>`, wrap the blob in a `File` with the SAME name and dispatch `dragenter`, `dragover`, `drop`, `dragleave` (with a `DataTransfer` holding the file) on `document.elementFromPoint(800, 300)`. The file input does not exist in the DOM until a native picker opens, and the native picker cannot be driven, so the synthetic drop is the way in.
6. When Drive shows the duplicate-name dialog choose **Replace existing file / Upload new version** (NEVER "Keep both"). Dialog wording is Spanish in the user's account: "Reemplazar el archivo existente" / "Subir nueva versión". Tested 2026-10-26: the dialog "Opciones de carga" preselects "Reemplazar archivo existente" (other option "Conservar ambos archivos"); click "Subir" (about x881,y351 on a 1568x598 view) and Drive reports "Versión 2". If the dialog ever differs, stop and look at it before choosing.
7. Verify (get_page_text of the folder): exactly ONE file with that name, new modified time and size. If "Keep both" slipped in (`name (1).zip`), tell the user; do not delete without asking.
7b. Delete the OLD versions so the Drive does not pile up history (user rule 2026-10-26): select the file > ⋮ (More actions, about x1520,y112) > "Información del archivo" > "Administrar versiones"; for each old version open its ⋮ (about x883,y348), choose "Borrar" (about x775,y329) and confirm "Borrar definitivamente" (about x824,y328; the dialog names the version: never delete "Versión actual"). Do one step at a time and zoom to check each menu: clicks sent too quickly are swallowed. End state: only "Versión actual".
8. Confirm the folder link still opens the same folder (the URL does not change on a version upload) and that the general access is still the mode recorded in memory.
9. Stop the server by the PID that owns port 8799 (`Get-NetTCPConnection -LocalPort 8799 -State Listen`), never by process name.
10. Update the memory `project-backup-sharing` (date of the update) and run `node scripts\project-backup.mjs --release` so the private repo matches: it REPLACES the zip in the one release per folder (tag `<project>-base` / `<project>-proposed`, no dates). Never create dated or lettered copies, anywhere (user rule 2026-10-26).

## First upload (2026-10-25)
Folders created with Drive "New > New folder" (focus the name field before typing: the first keystrokes otherwise go to the page), the three zips dropped with steps 2-5, sizes verified in Drive.
