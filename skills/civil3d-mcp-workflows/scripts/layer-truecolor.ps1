# Sets the TRUE colour of one layer of the open drawing (default: host layer R-W = 18,135,139, the survey cyan as the xref display fade (XFADECTL=70) shows it, user 2026-10-26).
# An ACI cyan on the host looks like ANOTHER blue next to the faded survey lines; the layer true colour makes the R/W line extensions (c300-rw-extend.mjs, ByLayer polylines) match.
# The AcCmColor must be READ from the layer, changed with SetRGB and assigned back (GetInterfaceObject('AutoCAD.AcCmColor.27') fails with "Problem in loading application").
#   powershell -NoProfile -ExecutionPolicy Bypass -File layer-truecolor.ps1 -Doc "Seindestein*" [-Layer R-W] [-R 18 -G 135 -B 139] [-Save]
param([Parameter(Mandatory)][string]$Doc, [string]$Layer = 'R-W', [int]$R = 18, [int]$G = 135, [int]$B = 139, [switch]$Save)
$ErrorActionPreference = 'Stop'
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d = $null; foreach ($x in $app.Documents) { if ($x.Name -like $Doc) { $d = $x } }
if (-not $d) { throw "no open document matching '$Doc'" }
if ($app.ActiveDocument.Name -ne $d.Name) { $d.Activate(); Start-Sleep 2 }
$l = $d.Layers.Item($Layer)
$c = $l.TrueColor; $c.SetRGB($R, $G, $B); $l.TrueColor = $c
$t = $l.TrueColor
"layer $Layer rgb $($t.Red),$($t.Green),$($t.Blue) method $($t.ColorMethod)"
$d.Regen(1)
if ($Save) { $d.Save(); Start-Sleep 3; 'saved: ' + (Get-Item $d.FullName).LastWriteTime }
