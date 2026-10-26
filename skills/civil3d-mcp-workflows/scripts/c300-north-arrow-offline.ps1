<#
.SYNOPSIS
  Offline twin of c300-north-arrow.mjs (design audit 2026-10-25): rotates the paper-space north arrow block (default "sna") of layout C-300 to the main viewport's
  twist, WITHOUT Civil 3D open on the file. Use it on a delivered BASE that must not be rebuilt (hand-tuned) while Civil 3D holds other drawings.
.DESCRIPTION
  Copies the DWG (+ the folder's xrefs) to %TEMP%, runs AutoCAD Core Console on the COPY (entmod of the INSERT, QSAVE), then copies the saved copy back over the
  target. Refuses when the file is open in Civil 3D (its title appears in a running acad window) or when the arrow already matches (idempotent, exit 0).
  Main viewport = the largest paper-space viewport of the layout whose model height / paper height > 5 (the 1"=20' view; the 1:1 overall viewport is skipped).
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File c300-north-arrow-offline.ps1 -Dwg "...\Seindestein @xereft base.dwg" [-Layout C-300] [-Block sna] [-DryRun]
#>
param([Parameter(Mandatory)][string]$Dwg, [string]$Layout = 'C-300', [string]$Block = 'sna', [switch]$DryRun, [string]$WorkRoot = "$env:TEMP\c3d-north-arrow")

$acc = Get-ChildItem 'C:\Program Files\Autodesk\AutoCAD 20*\accoreconsole.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $acc) { throw 'accoreconsole.exe not found under C:\Program Files\Autodesk' }
$src = (Resolve-Path -LiteralPath $Dwg).Path
$leaf = [IO.Path]::GetFileNameWithoutExtension($src)
if (Get-Process acad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*$leaf*" }) { throw "$leaf is open in Civil 3D: use c300-north-arrow.mjs on the live drawing instead" }

$srcDir = Split-Path $src -Parent
$work = Join-Path $WorkRoot ([guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null
Get-ChildItem -LiteralPath $srcDir -Recurse -File -Include *.dwg | Where-Object { $_.FullName -notmatch '\\SOURCE FILES\\|\\_backup\\' } | ForEach-Object {
  $dst = Join-Path $work $_.FullName.Substring($srcDir.Length).TrimStart('\')
  New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
  Copy-Item -LiteralPath $_.FullName $dst -Force
}
$copy = Join-Path $work (Split-Path $src -Leaf)
$report = Join-Path $work 'na.txt'
$scr = Join-Path $work 'na.scr'
$dry = if ($DryRun) { 'T' } else { 'nil' }
$lisp = @"
(vl-load-com)
(defun c:NAFIX ( / ss i ed best bestA a tw ins n f e0 cur dry)
  (setq f (open (getenv "NA_OUT") "w") dry $dry)
  (setq ss (ssget "X" (list '(0 . "VIEWPORT") (cons 410 "$Layout"))) i 0)
  (while (and ss (< i (sslength ss)))
    (setq ed (entget (ssname ss i)) i (1+ i))
    (if (and (cdr (assoc 41 ed)) (> (cdr (assoc 41 ed)) 0) (> (/ (cdr (assoc 45 ed)) (cdr (assoc 41 ed))) 5))
      (progn (setq a (* (cdr (assoc 40 ed)) (cdr (assoc 41 ed))))
        (if (or (null bestA) (> a bestA)) (setq best ed bestA a)))))
  (if (null best) (progn (write-line "NOVIEWPORT" f) (close f) (exit)))
  (setq tw (cdr (assoc 51 best)))
  (write-line (strcat "TWIST " (rtos tw 2 6)) f)
  (setq ins (ssget "X" (list '(0 . "INSERT") (cons 2 "$Block") (cons 410 "$Layout"))) n 0)
  (if ins (repeat (sslength ins)
    (setq ed (entget (ssname ins n)) n (1+ n) cur (cond ((cdr (assoc 50 ed))) (0.0)))
    (write-line (strcat "ARROW " (cdr (assoc 5 ed)) " " (rtos cur 2 6)) f)
    (if (and (not dry) (> (abs (- (rem (+ (- cur tw) (* 3 pi)) (* 2 pi)) pi)) 1e-4))
      (progn (entmod (subst (cons 50 tw) (assoc 50 ed) ed)) (entupd (cdr (assoc -1 ed))) (write-line "ROTATED" f)))))
  (close f) (princ))
NAFIX
_.QSAVE
"@
Set-Content -Encoding ASCII $scr $lisp
$env:NA_OUT = $report
& $acc.FullName /i $copy /s $scr /l en-US 2>&1 | Out-Null
if (-not (Test-Path $report)) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue; throw 'Core Console produced no report' }
$txt = Get-Content $report
$txt | ForEach-Object { "  $_" }
if ($txt -match 'NOVIEWPORT') { Remove-Item $work -Recurse -Force; throw "no main viewport on $Layout" }
if ($txt -match 'ROTATED' -and -not $DryRun) {
  Copy-Item -LiteralPath $copy -Destination $src -Force
  "north arrow rotated and saved: $src"
} else { "nothing to change" }
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
