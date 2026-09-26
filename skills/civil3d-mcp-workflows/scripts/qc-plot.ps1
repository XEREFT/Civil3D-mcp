# Fase 4 plot: plots layouts of a DWG to PDF with the Core Console on a %TEMP% COPY (5-10 s there; the same DWG on a
# OneDrive path hangs 8+ min, so never point accoreconsole at the real file). Xrefs (X-*.dwg next to the DWG) are copied along.
# Nothing in the real drawing is touched. Save the drawing in Civil 3D first (the plot sees the saved file, not the live one).
#   pwsh -NoProfile -File qc-plot.ps1 -Dwg "<dir>\<NAME> FASE 1 v2.dwg" [-Layouts C-300,C-301] [-Tag f9]
# -> %TEMP%\c3d-dwg-dump\plot\<Tag>\c300.pdf, c301.pdf   (then: python qc-compare.py words <pdf>  /  text|visual|crop ...)
param(
  [Parameter(Mandatory)][string]$Dwg,
  [string[]]$Layouts = @('C-300', 'C-301'),
  [string]$Tag = ('q' + (Get-Date -Format 'HHmmss')),
  [string]$Paper = 'ARCH full bleed D (36.00 x 24.00 Inches)',
  [string]$Style = 'monochrome.ctb',
  [string]$Core = 'C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe',
  [int]$TimeoutSec = 240
)
$ErrorActionPreference = 'Stop'
$Layouts = @($Layouts | ForEach-Object { $_ -split ',' } | Where-Object { $_.Trim() })   # `pwsh -File` passes 'A,B' as ONE string
if (-not (Test-Path $Dwg)) { throw "DWG not found: $Dwg" }
if (-not (Test-Path $Core)) { throw "accoreconsole not found: $Core (check C:\Program Files\Autodesk\)" }
$work = Join-Path $env:TEMP "c3d-dwg-dump\plot\$Tag"
New-Item -ItemType Directory -Force $work | Out-Null
Get-ChildItem $work -Filter *.pdf -ErrorAction SilentlyContinue | Remove-Item -Force
$copy = Join-Path $work "$Tag.dwg"
Copy-Item $Dwg $copy -Force
Get-ChildItem (Split-Path $Dwg) -Filter 'X-*.dwg' | Copy-Item -Destination $work -Force

$scr = New-Object System.Collections.Generic.List[string]
$scr.Add('(setvar "FILEDIA" 0)'); $scr.Add('(setvar "CMDDIA" 0)'); $scr.Add('(setvar "BACKGROUNDPLOT" 0)')
$pdfs = @()
foreach ($l in $Layouts) {
  $pdf = Join-Path $work (($l -replace '-', '').ToLower() + '.pdf'); $pdfs += $pdf
  # -PLOT: detailed Y, layout, device, paper, inches, landscape, no upside-down, layout extents, 1:1, offset, styles Y, ctb,
  #        lineweights Y, no hide, no log, no save-changes, file, no more, proceed Y   (validated on VILLA ONE C-300/C-301)
  $scr.AddRange([string[]]@('-PLOT', 'Y', $l, 'DWG To PDF.pc3', $Paper, 'I', 'L', 'N', 'L', '1:1', '0.00,0.00', 'Y', $Style, 'Y', 'N', 'N', 'N', $pdf, 'N', 'Y'))
}
$scr.Add('QUIT'); $scr.Add('Y')
$scrPath = Join-Path $work 'plot.scr'
Set-Content $scrPath $scr -Encoding ASCII

$p = Start-Process $Core -ArgumentList "/i `"$copy`" /s `"$scrPath`" /l en-US" -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $work 'plot.log') -RedirectStandardError (Join-Path $work 'plot.err')
if (-not $p.WaitForExit($TimeoutSec * 1000)) { $p.Kill(); "TIMEOUT after ${TimeoutSec}s - killed accoreconsole (log: $work\plot.log)"; exit 1 }
foreach ($pdf in $pdfs) {
  if (Test-Path $pdf) { $kb = [math]::Round((Get-Item $pdf).Length / 1KB); "{0}  {1} KB{2}" -f $pdf, $kb, $(if ($kb -lt 100) { '  <-- BLANK? (kept sheet viewport? see c300-water-sewer-plan.md 9.8)' } else { '' }) }
  else { "MISSING $pdf (see $work\plot.log)" }
}
