# Offline preview of a Fase 1 working DWG WITHOUT Civil 3D: plots a %TEMP% copy (Core Console) after applying the project's xref look
# (survey-profiles.json: heavyXrefLayers/heavyOnly/whiteXrefLayers/hideXrefLayers, same rule as fase1-xref-style.mjs) and writes
# "C-300 PREVIEW.pdf" (monochrome = what the delivered PDF looks like) and "C-300 PREVIEW (color).pdf" next to the DWG. The DWG itself is not modified.
#   powershell -NoProfile -ExecutionPolicy Bypass -File fase1-preview.ps1 -Dwg "<dir>\<NAME> FASE1-BUILD.dwg" [-Profile formtech]
param([Parameter(Mandatory)][string]$Dwg, [string]$Profile = 'formtech', [string]$Layout = 'C-300')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$prof = (Get-Content (Join-Path $here '..\references\standards\survey-profiles.json') -Raw | ConvertFrom-Json).profiles.$Profile
if (-not $prof) { throw "unknown profile $Profile" }
$q = { param($a) '(list ' + (($a | ForEach-Object { '"' + $_.ToUpper() + '"' }) -join ' ') + ')' }
$hide = & $q @($prof.hideXrefLayers); $heavy = & $q @($prof.heavyXrefLayers); $white = & $q @($prof.whiteXrefLayers)
$lisp = @"
(setq names nil lay (tblnext "LAYER" T)) (while lay (setq names (cons (cons (cdr (assoc 2 lay)) (abs (cdr (assoc 62 lay)))) names) lay (tblnext "LAYER")))
(foreach e names (setq nm (car e) c (cdr e)) (if (wcmatch (strcase nm) "X-TOPO|*") (progn (setq short (substr (strcase nm) 8))
  (cond ((member short $hide) (command "_.-LAYER" "_F" nm ""))
        ((member short $heavy) (command "_.-LAYER" "_C" "4" nm ""))
        ((member short $white) (command "_.-LAYER" "_C" "7" nm ""))
        ((and (= c 4) $(if ($prof.heavyOnly) { 'T' } else { 'nil' })) (command "_.-LAYER" "_C" "8" nm ""))
        ((and (/= c 4) (/= c 8)) (command "_.-LAYER" "_C" "8" nm ""))))))
"@ -split "`r?`n" | Where-Object { $_.Trim() }
$qc = Join-Path $here 'qc-plot.ps1'; $dir = Split-Path $Dwg
$m = & $qc -Dwg $Dwg -Layouts $Layout -Tag 'prev-mono' -PreLisp $lisp | Select-Object -Last 1
$c = & $qc -Dwg $Dwg -Layouts $Layout -Tag 'prev-color' -Style 'acad.ctb' -PreLisp $lisp | Select-Object -Last 1
$pm = ($m -split '\s{2}')[0]; $pc = ($c -split '\s{2}')[0]
Copy-Item $pm (Join-Path $dir 'C-300 PREVIEW.pdf') -Force; Copy-Item $pc (Join-Path $dir 'C-300 PREVIEW (color).pdf') -Force
"preview: $dir\C-300 PREVIEW.pdf (+ color)"
