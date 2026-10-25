# Moves individual survey texts (model space of a survey xref, X-TOPO.dwg) to a hidden-by-profile layer, for annotations that share a layer with texts we keep
# (SEIDENSTEIN: the lot-corner angle labels 89%%D17'00" / 90%%D43'00" sit on TXTBDRY next to P/L 125.00', R/W 100.00': the VILLA ONE / Goulds sheets do not print angles).
# The profile (survey-profiles.json) freezes the new layer through hideXrefLayers. Works on a %TEMP% copy with the Core Console, backs the original up first.
#   powershell -NoProfile -ExecutionPolicy Bypass -File topo-hide-text.ps1 -Topo "<project>\X-TOPO.dwg" -Layer TXTBDRY -Match "*%%D*" [-NewLayer HIDE-ANGLE-LABELS] [-DryRun]
# Color/layer only: no geometry or text content changes. Close drawings that reference this X-TOPO first (Civil 3D keeps xref files open).
param([Parameter(Mandatory)][string]$Topo, [Parameter(Mandatory)][string]$Layer, [Parameter(Mandatory)][string]$Match, [string]$NewLayer = 'HIDE-ANGLE-LABELS',
      [string]$BackupName = 'X-TOPO_antes_ocultar_texto.dwg', [switch]$DryRun,
      [string]$Core = 'C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe', [int]$TimeoutSec = 180)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Topo)) { throw "not found: $Topo" }
$work = Join-Path $env:TEMP ('c3d-topo-hidetext-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $work | Out-Null
$copy = Join-Path $work 'X-TOPO.dwg'
Copy-Item $Topo $copy
$move = if ($DryRun) { '' } else { "(entmod (subst (cons 8 `"$NewLayer`") (assoc 8 e) e))" }
$lisp = "(setq ss (ssget `"_X`" (list (cons 410 `"Model`") (cons 8 `"$Layer`") (cons 0 `"MTEXT,TEXT`"))) n 0 m 0) " +
        "(if ss (progn " + $(if ($DryRun) { '' } else { "(command `"_.-LAYER`" `"_N`" `"$NewLayer`" `"_C`" `"8`" `"$NewLayer`" `"`") " }) +
        "(repeat (sslength ss) (setq e (entget (ssname ss n))) (if (wcmatch (cdr (assoc 1 e)) `"$Match`") (progn (setq m (1+ m)) $move)) (setq n (1+ n))))) " +
        "(princ (strcat `"\nHIDETEXT `" (itoa m) `" of `" (itoa (if ss (sslength ss) 0))))"
$scr = if ($DryRun) { @($lisp, 'QUIT') } else { @($lisp, '_.QSAVE', 'QUIT', 'Y') }
Set-Content (Join-Path $work 'b.scr') $scr -Encoding ASCII
$p = Start-Process $Core -ArgumentList "/i `"$copy`" /s `"$work\b.scr`" /l en-US" -PassThru -WindowStyle Hidden -RedirectStandardOutput "$work\b.log" -RedirectStandardError "$work\b.err"
if (-not $p.WaitForExit($TimeoutSec * 1000)) { $p.Kill(); throw 'Core Console timed out' }
$raw = [IO.File]::ReadAllBytes("$work\b.log"); $txt = if ($raw.Length -gt 2 -and $raw[1] -eq 0) { [Text.Encoding]::Unicode.GetString($raw) } else { [Text.Encoding]::UTF8.GetString($raw) }
$line = ($txt -split "`n" | Select-String 'HIDETEXT \d+ of \d+' | Select-Object -Last 1)
if (-not $line) { throw "no HIDETEXT line in the Core Console log ($work\b.log)" }
Write-Output $line.Line.Trim()
if ($DryRun) { Remove-Item $work -Recurse -Force; return }
$bk = Join-Path (Join-Path (Split-Path $Topo) '_backup') $BackupName
New-Item -ItemType Directory -Force (Split-Path $bk) | Out-Null
if (-not (Test-Path $bk)) { Copy-Item $Topo $bk }
Copy-Item $copy $Topo -Force
Remove-Item $work -Recurse -Force
Write-Output "OK: $Topo (original kept as $bk)"
