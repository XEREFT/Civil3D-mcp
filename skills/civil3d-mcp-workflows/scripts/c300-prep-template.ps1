<#
.SYNOPSIS
  Turns the previous project's C-300.dwg into a clean starting template for a new project:
  erases ALL model-space content (old site, old alignments/pipe networks/profile views, old xref
  inserts), detaches every xref, and renames the layouts (default C-02 -> C-300, C-03 -> C-301).
  Keeps everything the firm reuses: title block + seal in paper space, layers, text/dim/mleader
  styles, block definitions (_cl, EXIST ARROW, FH, ...), Civil 3D styles.
.DESCRIPTION
  Runs AutoCAD Core Console on a COPY; the source file is never touched. The output is meant to be
  opened with civil3d_drawing action "new" templatePath=<output>, then saved with saveAs to the
  project's final name. Civil 3D can have the source open (it reads the last saved state).
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File c300-prep-template.ps1 -Source "...\Goulds\...\C-300.dwg" -Out "$env:TEMP\c300-template.dwg"
#>
param(
  [Parameter(Mandatory)][string]$Source,
  [Parameter(Mandatory)][string]$Out,
  [string]$LayoutRename = 'C-02=C-300,C-03=C-301'
)

$acc = Get-ChildItem 'C:\Program Files\Autodesk\AutoCAD 20*\accoreconsole.exe' -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $acc) { throw 'accoreconsole.exe not found under C:\Program Files\Autodesk' }
if (Test-Path -LiteralPath $Out) { throw "Output '$Out' already exists; choose another path." }

New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
Copy-Item -LiteralPath $Source $Out

$renames = ($LayoutRename -split ',' | Where-Object { $_ -match '=' } | ForEach-Object {
  $from, $to = $_ -split '=', 2
  "(if (dictsearch (cdr (assoc -1 (dictsearch (namedobjdict) `"ACAD_LAYOUT`"))) `"$($from.Trim())`") (command `"_.-LAYOUT`" `"_R`" `"$($from.Trim())`" `"$($to.Trim())`"))"
}) -join "`r`n"

$scr = Join-Path (Split-Path $Out) 'c300-prep.scr'
@"
(setvar "CMDECHO" 0)
(setvar "TILEMODE" 1)
(if (setq ss (ssget "X" '((410 . "Model")))) (command "_.ERASE" ss ""))
(command "_.-XREF" "_D" "*")
$renames
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
