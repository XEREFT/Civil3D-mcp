# Builds a project X-ARCH.dwg from the architect's drawings: binds the nested site-plan xref, moves everything from the architect's local inch system into the
# survey coordinates (feet) with scale / rotation / translation, recolors the kept layers ACI 2 (yellow, as the firm's GUIA shows the architecture) and freezes the
# annotation / furniture / tree / hatch layers. Core Console on a %TEMP% copy; the result is copied to -Out (an existing -Out is backed up once to _backup\).
#   powershell -NoProfile -ExecutionPolicy Bypass -File xarch-build.ps1 -Floor "<2620-X-1 First Floor Plan>.dwg" -Out "<project>\X-ARCH.dwg" -Scale 0.0833 -RotDeg -87.29 -Tx 1 -Ty 2
# Usually driven by xarch-georef.mjs (which computes scale/rotation/translation from the architect's property line vs the survey lot).
param([Parameter(Mandatory)][string]$Floor, [Parameter(Mandatory)][string]$Out,
      [Parameter(Mandatory)][double]$Scale, [Parameter(Mandatory)][double]$RotDeg, [Parameter(Mandatory)][double]$Tx, [Parameter(Mandatory)][double]$Ty,
      [string[]]$Companions = @(), [string]$KeepBox = '',
      [string]$Core = 'C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe', [int]$TimeoutSec = 240)
$ErrorActionPreference = 'Stop'
$work = Join-Path $env:TEMP ('c3d-xarch-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $work | Out-Null
$copy = Join-Path $work 'xarch.dwg'
Copy-Item $Floor $copy
# the nested xref (site plan) is looked up next to the floor plan: copy every sibling DWG it may point to
foreach ($c in $Companions) { Copy-Item $c $work -Force }
$f = [Globalization.CultureInfo]::InvariantCulture
# keep only what touches the lot (+ margin): the architect's site plan also draws neighbours, cars and street furniture
$kb = @($KeepBox -split '[,;]' | Where-Object { $_.Trim() } | ForEach-Object { [double]::Parse($_, $f) })
$cropLisp = if ($kb.Count -eq 4) { '(setq keep (ssget "_C" (list ' + $kb[0].ToString('R', $f) + ' ' + $kb[1].ToString('R', $f) + ') (list ' + $kb[2].ToString('R', $f) + ' ' + $kb[3].ToString('R', $f) + '))) (setq all (ssget "_X" (list (cons 410 "Model")))) (if (and all keep) (progn (setq i 0) (repeat (sslength keep) (ssdel (ssname keep i) all) (setq i (1+ i))) (if (> (sslength all) 0) (command "_.ERASE" all "")))) ' } else { '' }
$lisp = @"
(setvar "FILEDIA" 0) (setvar "CMDECHO" 0) (setvar "CLAYER" "0")
(command "_.-LAYER" "_T" "*" "_U" "*" "_ON" "*" "")
(setq xn nil b (tblnext "BLOCK" T)) (while b (if (= 4 (logand 4 (cdr (assoc 70 b)))) (setq xn (cons (cdr (assoc 2 b)) xn))) (setq b (tblnext "BLOCK")))
(command "_.-XREF" "_B" "*")
(foreach n xn (setq s2 (ssget "_X" (list (cons 0 "INSERT") (cons 2 n) (cons 410 "Model")))) (if s2 (command "_.EXPLODE" s2)))
(setq s3 (ssget "_X" (list (cons 0 "DIMENSION,TEXT,MTEXT,MLEADER,LEADER,WIPEOUT,HATCH,IMAGE") (cons 410 "Model")))) (if s3 (command "_.ERASE" s3 ""))
(setq ssi (ssget "_X" (list (cons 0 "INSERT") (cons 410 "Model"))) i 0 big 0) (if ssi (repeat (sslength ssi) (setq en (ssname ssi i) b (tblobjname "BLOCK" (cdr (assoc 2 (entget en)))) e (if b (entnext b)) cnt 0) (while (and e (< cnt 300)) (setq cnt (1+ cnt) e (entnext e))) (if (>= cnt 300) (progn (entdel en) (setq big (1+ big)))) (setq i (1+ i))))
(princ (strcat "\nXARCH heavy art blocks (site-plan tree canopies, >=300 entities) erased: " (itoa big)))
(setq s4 (ssget "_X" (list (cons 0 "INSERT") (cons 8 "0") (cons 410 "Model")))) (if s4 (command "_.ERASE" s4 ""))
(setq ss (ssget "_X" (list (cons 410 "Model"))))
(if ss (progn (command "_.SCALE" ss "" "0,0" $($Scale.ToString('R', $f))) (command "_.ROTATE" ss "" "0,0" $($RotDeg.ToString('R', $f))) (command "_.MOVE" ss "" "0,0" "$($Tx.ToString('R', $f)),$($Ty.ToString('R', $f))")))
(setvar "INSUNITS" 2)
$cropLisp
(setq lay (tblnext "LAYER" T) kept 0 frozen 0)
(while lay (setq nm (cdr (assoc 2 lay)))
  (if (and (/= nm "0") (wcmatch (strcase nm) "*DEFPOINTS*,*ANNO*,*NOTE*,*TEXT*,*DIM*,*TREE*,*PLANT*,*GRASS*,*HATCH*,*COLOR*,*PRES*,*ELEV*,*FURN*,*LEADER*,*WIPEOUT*,*TITLE*,*SHEET*,*VIEWPORT*,*SOLID*"))
    (progn (command "_.-LAYER" "_F" nm "") (setq frozen (1+ frozen)))
    (progn (command "_.-LAYER" "_C" "2" nm "") (setq kept (1+ kept))))
  (setq lay (tblnext "LAYER")))
(princ (strcat "\nXARCH layer-0 blocks erased (site-plan trees): " (itoa (if s4 (sslength s4) 0))))
(princ (strcat "\nXARCH moved " (itoa (if ss (sslength ss) 0)) " entities, " (itoa kept) " layers yellow, " (itoa frozen) " frozen"))
"@
Set-Content (Join-Path $work 'x.scr') (@(($lisp -split "`r?`n" | Where-Object { $_.Trim() }), '_.QSAVE', 'QUIT', 'Y') | ForEach-Object { $_ }) -Encoding ASCII
$p = Start-Process $Core -ArgumentList "/i `"$copy`" /s `"$work\x.scr`" /l en-US" -PassThru -WindowStyle Hidden -RedirectStandardOutput "$work\x.log" -RedirectStandardError "$work\x.err"
if (-not $p.WaitForExit($TimeoutSec * 1000)) { $p.Kill(); throw "Core Console timed out ($work)" }
$raw = [IO.File]::ReadAllBytes("$work\x.log"); $txt = if ($raw.Length -gt 2 -and $raw[1] -eq 0) { [Text.Encoding]::Unicode.GetString($raw) } else { [Text.Encoding]::UTF8.GetString($raw) }
$line = ($txt -split "`n" | Select-String 'XARCH moved' | Select-Object -Last 1)
if (-not $line) { throw "build did not report (see $work\x.log)" }
Write-Output $line.Line.Trim()
if (Test-Path $Out) {
  $bk = Join-Path (Join-Path (Split-Path $Out) '_backup') ('X-ARCH_antes_georef_' + (Get-Date -Format 'yyyyMMdd') + '.dwg')
  New-Item -ItemType Directory -Force (Split-Path $bk) | Out-Null
  if (-not (Test-Path $bk)) { Copy-Item $Out $bk }
}
Copy-Item $copy $Out -Force
Write-Output "OK: $Out"
Remove-Item $work -Recurse -Force
