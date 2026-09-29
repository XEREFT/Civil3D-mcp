<#
.SYNOPSIS
  Turns the previous project's C-300.dwg into a clean starting template for a new project:
  erases ALL model-space content (old site, old alignments/pipe networks/profile views, old xref
  inserts), detaches every xref, and renames the layouts (default C-02 -> C-300, C-03 -> C-301).
  Keeps everything the firm reuses: title block + seal in paper space, layers, text/dim/mleader
  styles, block definitions (_cl, EXIST ARROW, FH, ...), Civil 3D styles.
.DESCRIPTION
  Runs AutoCAD Core Console on a COPY; the source file is never touched. The output is meant to be
  opened with civil3d_drawing action "new" templatePath=<output> (or civil3d_workflow_fase1_build templatePath),
  then saved with saveAs to the project's final name. Civil 3D can have the source open (it reads the last saved state).
  -Out must be inside the plugin's file roots (CIVIL3D_IMPORT_ROOTS / CIVIL3D_FILE_ROOTS, default Documents):
  a template in %TEMP% is refused by civil3d_drawing new ("outside the configured roots", VILLA ONE 2026-09-28).
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File c300-prep-template.ps1 -Source "...\Goulds\...\C-300.dwg" -Out "<project folder>\_template.dwg" -DeleteLayouts 'C-301'
#>
param(
  [Parameter(Mandatory)][string]$Source,
  [Parameter(Mandatory)][string]$Out,
  [string]$LayoutRename = 'C-02=C-300,C-03=C-301',
  # Layouts to delete after renaming, e.g. 'C-301' for a phase-1 (existing conditions) file with only model + C-300.
  [string]$DeleteLayouts = '',
  # Only for a template that Civil 3D will never open through the plugin (e.g. a Core Console experiment).
  [switch]$AllowOutsideRoots
)

$acc = Get-ChildItem 'C:\Program Files\Autodesk\AutoCAD 20*\accoreconsole.exe' -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $acc) { throw 'accoreconsole.exe not found under C:\Program Files\Autodesk' }
if (Test-Path -LiteralPath $Out) { throw "Output '$Out' already exists; choose another path." }

# Same rule as the plugin (FileBoundary.cs): CIVIL3D_IMPORT_ROOTS, else CIVIL3D_FILE_ROOTS, else MyDocuments.
$rootsVar = if ($env:CIVIL3D_IMPORT_ROOTS) { $env:CIVIL3D_IMPORT_ROOTS } elseif ($env:CIVIL3D_FILE_ROOTS) { $env:CIVIL3D_FILE_ROOTS } else { [Environment]::GetFolderPath('MyDocuments') }
$roots = $rootsVar -split '[;|]' | Where-Object { $_.Trim() } | ForEach-Object { [IO.Path]::GetFullPath($_.Trim()).TrimEnd('\') + '\' }
$outFull = [IO.Path]::GetFullPath($Out)
if (-not $AllowOutsideRoots -and -not ($roots | Where-Object { $outFull.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) {
  throw "Output '$outFull' is outside the plugin's file roots ($($roots -join '; ')): civil3d_drawing new would refuse it. Put the template in the project folder (e.g. <project>\_template.dwg), or pass -AllowOutsideRoots if the plugin will never open it."
}

New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
Copy-Item -LiteralPath $Source $Out

$renames = ($LayoutRename -split ',' | Where-Object { $_ -match '=' } | ForEach-Object {
  $from, $to = $_ -split '=', 2
  "(if (dictsearch (cdr (assoc -1 (dictsearch (namedobjdict) `"ACAD_LAYOUT`"))) `"$($from.Trim())`") (command `"_.-LAYOUT`" `"_R`" `"$($from.Trim())`" `"$($to.Trim())`"))"
}) -join "`r`n"

$deletes = ($DeleteLayouts -split ',' | Where-Object { $_.Trim() } | ForEach-Object {
  "(if (dictsearch (cdr (assoc -1 (dictsearch (namedobjdict) `"ACAD_LAYOUT`"))) `"$($_.Trim())`") (command `"_.-LAYOUT`" `"_D`" `"$($_.Trim())`"))"
}) -join "`r`n"

$scr = Join-Path (Split-Path $Out) 'c300-prep.scr'
@"
(setvar "CMDECHO" 0)
(setvar "TILEMODE" 1)
(if (setq ss (ssget "X" '((410 . "Model")))) (command "_.ERASE" ss ""))
(command "_.-XREF" "_D" "*")
$renames
$deletes
(setq ss (ssget "X" '((410 . "Model"))))
(setq f (open (strcat (getvar "DWGPREFIX") (vl-filename-base (getvar "DWGNAME")) "_prep.txt") "w"))
(write-line (strcat "MODEL_LEFT|" (if ss (itoa (sslength ss)) "0")) f)
(foreach d (dictsearch (namedobjdict) "ACAD_LAYOUT") (if (= (car d) 3) (write-line (strcat "LAYOUT|" (cdr d)) f)))
(setq b (tblnext "BLOCK" T))
(while b (if (_g1 b) (write-line (strcat "XREF_LEFT|" (cdr (assoc 2 b))) f)) (setq b (tblnext "BLOCK")))
(close f)
(command "_.QSAVE")
"@ -replace '\(_g1 b\)', '(cdr (assoc 1 b))' | Set-Content -Encoding ASCII $scr

& $acc.FullName /i $Out /s $scr /l en-US 2>&1 | Out-Null
Remove-Item $scr -Force
$report = Join-Path (Split-Path $Out) (([IO.Path]::GetFileNameWithoutExtension($Out)) + '_prep.txt')
if (-not (Test-Path $report)) { throw "Core Console did not finish the prep for $Out" }
Get-Content $report
Remove-Item $report -Force
$Out
