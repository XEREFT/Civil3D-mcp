# NOTE: PointLocation call below is untested as a script; the same replacement was done inline on Goulds with the label coordinates from the build payload.
# Replaces the NATIVE Civil 3D alignment START/END labels (AeccDbStaOffsetLabel) with plain MLeaders so the big orange "i" override glyph can never cover the sheet
# (user 2026-10-26, Goulds: "estos simbolos en amarillo, en I grande ... no permiten visualizar el archivo, quitalos para mi y para quien lo reciba").
# Why: a native label with overridden text shows the glyph on whoever opens the file; LABELOVERRIDEGLYPHS=0 is only a per-machine setting (not stored in the DWG).
#   powershell -NoProfile -ExecutionPolicy Bypass -File align-labels-to-mleader.ps1 -Doc "Goulds*" -Template 10CF5 [-Apply]
# -Template = handle of ANY existing host MLeader of the sheet (Formtech-1.0 style, C-ANNO, already rotated for the viewport twist): it is copied, so style, annotative scale, colour and rotation match.
# Text = ALIGNMENT START|END \P STA: n+nn.nn/OFF: 0.00' \P (ALIGNMENT NAME) \P N: <northing> \P E: <easting> (alignment ends: offset 0, END station = alignment length).
# Dry run lists what it would do. Nothing is saved. Also sets LABELOVERRIDEGLYPHS=0 for this session. Check the layout afterwards (view-capture.ps1) and nudge a clash by eye.
param([Parameter(Mandatory)][string]$Doc, [Parameter(Mandatory)][string]$Template, [switch]$Apply)
$ErrorActionPreference = 'Stop'
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d = $null; foreach ($x in $app.Documents) { if ($x.Name -like $Doc) { $d = $x } }
if (-not $d) { throw "no open document matching '$Doc'" }
if ($app.ActiveDocument.Name -ne $d.Name) { $d.Activate(); Start-Sleep 2 }
if ([int]$d.GetVariable('CMDACTIVE') -ne 0) { throw 'a command is active in the drawing: finish it first' }
$src = $d.HandleToObject($Template); $v = $src.GetLeaderLineVertices(0)
function Sta($s) { '{0}+{1:00.00}' -f [math]::Floor($s / 100), ($s % 100) }
$ms = $d.ModelSpace; $todo = @()
for ($i = 0; $i -lt $ms.Count; $i++) { $e = $ms.Item($i); if ($e.ObjectName -eq 'AeccDbStaOffsetLabel') { $todo += $e } }
foreach ($e in $todo) {
  $al = $e.Alignment; $kind = if ($e.LabelStyle.Name -match 'END') { 'END' } else { 'START' }
  # label anchor = alignment end point (the COM label exposes no position: read it from the alignment geometry)
  $s = if ($kind -eq 'END') { $al.EndingStation } else { $al.StartingStation }
  $pt = $al.PointLocation($s, 0)  # AeccAlignment.PointLocation(station, offset) -> x,y
  $t = "ALIGNMENT $kind\PSTA: $(Sta $s)/OFF: 0.00'\P($($al.Name))\PN: $('{0:F2}' -f $pt[1])\PE: $('{0:F2}' -f $pt[0])"
  "{0} {1} at {2:F2},{3:F2}: {4}" -f $e.Handle, $kind, $pt[0], $pt[1], ($t -replace '\\P', ' | ')
  if ($Apply) { $n = $src.Copy(); $n.TextString = $t; $n.Move([double[]]@($v[0], $v[1], 0), [double[]]@($pt[0], $pt[1], 0)); $e.Delete(); "  -> MLeader $($n.Handle)" }
}
if ($Apply) { try { $d.SendCommand("LABELOVERRIDEGLYPHS 0`n") } catch {}; $d.Regen(1); 'done (not saved): look at the layout, then save' } else { 'dry run: add -Apply' }
