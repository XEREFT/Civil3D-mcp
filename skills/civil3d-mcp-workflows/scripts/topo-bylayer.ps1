# Sets every model-space entity of a survey xref (X-TOPO.dwg) to color ByLayer, so the layer colors/overrides of fase1-xref-style.mjs really apply
# (the surveyor's explicit ACI 7 / green / red entity colors ignore a layer override: SEIDENSTEIN had 518 of 2510, VILLA ONE 9 of 503).
# Works on a %TEMP% copy with the Core Console (never on the OneDrive file), backs the original up first, then copies the result back.
#   powershell -NoProfile -ExecutionPolicy Bypass -File topo-bylayer.ps1 -Topo "<project>\X-TOPO.dwg" [-BackupName X-TOPO_antes_color_bylayer.dwg] [-DryRun]
# Color only: no geometry, layer or text content changes. Close drawings that reference this X-TOPO first (Civil 3D keeps xref files open).
param([Parameter(Mandatory)][string]$Topo, [string]$BackupName = 'X-TOPO_antes_color_bylayer.dwg', [switch]$DryRun,
      [string]$Core = 'C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe', [int]$TimeoutSec = 180)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Topo)) { throw "not found: $Topo" }
$work = Join-Path $env:TEMP ('c3d-topo-bylayer-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $work | Out-Null
$copy = Join-Path $work 'X-TOPO.dwg'
Copy-Item $Topo $copy
$lisp = '(setq ss (ssget "_X" (list (cons 410 "Model"))) n 0 m 0) (if ss (repeat (sslength ss) (setq e (entget (ssname ss n))) (if (and (assoc 62 e) (/= (cdr (assoc 62 e)) 256)) (progn (setq m (1+ m)) (if (not ' + $(if ($DryRun) { 'T' } else { 'nil' }) + ') (entmod (subst (cons 62 256) (assoc 62 e) e))))) (setq n (1+ n)))) (princ (strcat "\nBYLAYER " (itoa m) " of " (itoa n)))'
$scr = if ($DryRun) { @($lisp, 'QUIT') } else { @($lisp, '_.QSAVE', 'QUIT', 'Y') }
Set-Content (Join-Path $work 'b.scr') $scr -Encoding ASCII
$p = Start-Process $Core -ArgumentList "/i `"$copy`" /s `"$work\b.scr`" /l en-US" -PassThru -WindowStyle Hidden -RedirectStandardOutput "$work\b.log" -RedirectStandardError "$work\b.err"
if (-not $p.WaitForExit($TimeoutSec * 1000)) { $p.Kill(); throw 'Core Console timed out' }
$raw = [IO.File]::ReadAllBytes("$work\b.log"); $txt = if ($raw.Length -gt 2 -and $raw[1] -eq 0) { [Text.Encoding]::Unicode.GetString($raw) } else { [Text.Encoding]::UTF8.GetString($raw) }
$line = ($txt -split "`n" | Select-String 'BYLAYER \d+ of \d+' | Select-Object -Last 1)
if (-not $line) { throw "no BYLAYER line in the Core Console log ($work\b.log)" }
Write-Output $line.Line.Trim()
if ($DryRun) { Remove-Item $work -Recurse -Force; return }
$bk = Join-Path (Join-Path (Split-Path $Topo) '_backup') $BackupName
New-Item -ItemType Directory -Force (Split-Path $bk) | Out-Null
if (-not (Test-Path $bk)) { Copy-Item $Topo $bk }
Copy-Item $copy $Topo -Force
Remove-Item $work -Recurse -Force
Write-Output "OK: $Topo (original kept as $bk)"
