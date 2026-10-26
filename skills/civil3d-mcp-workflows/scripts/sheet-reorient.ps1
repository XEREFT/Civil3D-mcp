# Re-orients a C-300 sheet to a new view twist (user 2026-10-26, Goulds: "girar a la izquierda 90 grados ... etiquetas legibles desde esta perspectiva") and re-lays OUR labels so they read on the new sheet.
# Everything is a rotation of the plan view; no data changes. Run on the OPEN drawing, look at the layout, then save (nothing is saved here).
#   powershell -NoProfile -ExecutionPolicy Bypass -File sheet-reorient.ps1 -Doc "Goulds*" -DeltaDeg 90 [-Layout C-300] [-Apply]
# Without -Apply it only lists what it would change. Steps (the rotation rule: a text reads horizontal on the sheet when rotation = -twist; sheet angle = model rotation + twist):
#  1. layout viewport (twisted one): TwistAngle += Delta (the model target/centre does not move)
#  2. north arrow block `sna` in the layout: Rotation = new twist
#  3. host MText with width 0 on layer TextTopoLabel_ep (street names, follow the street): flip 180 deg if the sheet angle would be upside-down; box centre preserved
#  4. host MText with width > 0 on that layer (subject property label): rotate -Delta about its centre so it reads horizontal again
#  5. host MLeaders (utility callouts, SAN MH, CB): Entity.Rotate(-Delta) about the arrow tip = same look relative to the tip on the new sheet
# NOT touched on purpose: the PL symbol glyph MText (follows the lot line), `_cl` blocks, EXIST ARROW blocks (pipe direction), xref survey text, native Civil 3D labels (plan readable).
# Known leftover to check by eye: a native ALIGNMENT START/END label can land on a dimension (Goulds: the 25.00' R/W dim at the south end).
param([Parameter(Mandatory)][string]$Doc, [double]$DeltaDeg = 90, [string]$Layout = 'C-300', [string]$TextLayer = 'TextTopoLabel_ep', [switch]$Apply)
$ErrorActionPreference = 'Stop'
$PI = [math]::PI; $delta = $DeltaDeg * $PI / 180
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d = $null; foreach ($x in $app.Documents) { if ($x.Name -like $Doc) { $d = $x } }
if (-not $d) { throw "no open document matching '$Doc'" }
if ($app.ActiveDocument.Name -ne $d.Name) { $d.Activate(); Start-Sleep 2 }
if ([int]$d.GetVariable('CMDACTIVE') -ne 0) { throw 'a command is active in the drawing: finish it first' }
$pb = $d.Layouts.Item($Layout).Block; $ms = $d.ModelSpace
$vp = $null; foreach ($e in $pb) { if ($e.ObjectName -eq 'AcDbViewport' -and [math]::Abs($e.TwistAngle) -gt 0.01) { $vp = $e } }
if (-not $vp) { throw "no twisted viewport in layout $Layout" }
$oldT = $vp.TwistAngle; $newT = ($oldT + $delta) % (2 * $PI); if ($newT -lt 0) { $newT += 2 * $PI }
"viewport twist {0:N3} -> {1:N3} deg" -f ($oldT * 180 / $PI), ($newT * 180 / $PI)
function Center($e) { $mn = $null; $mx = $null; $e.GetBoundingBox([ref]$mn, [ref]$mx); @((($mn[0] + $mx[0]) / 2), (($mn[1] + $mx[1]) / 2), 0.0) }
if ($Apply) {
  $wasLocked = $vp.DisplayLocked
  if ($wasLocked) { $vp.DisplayLocked = $false }
  $vp.TwistAngle = $newT
  foreach ($e in $pb) { if ($e.ObjectName -eq 'AcDbBlockReference' -and $e.Name -eq 'sna') { $e.Rotation = $newT; "north arrow rotation -> {0:N2}" -f ($e.Rotation * 180 / $PI) } }
}
for ($i = 0; $i -lt $ms.Count; $i++) {
  $e = $ms.Item($i)
  if ($e.ObjectName -eq 'AcDbMText' -and $e.Layer -eq $TextLayer -and $e.Width -ge 0) {
    if ($e.StyleName -and $e.TextString -match 'U\+214A') { continue }              # PL symbol glyph: follows the lot line
    $r0 = $e.Rotation
    if ($e.Width -gt 0.5 -and $e.AttachmentPoint -eq 2) { $r1 = $r0 - $delta; $kind = 'block label (rigid)' }
    elseif ($e.Width -lt 0.5 -and $e.AttachmentPoint -eq 2) { $a = ($r0 + $newT) % (2 * $PI); $r1 = $(if ($a -gt $PI / 2 + 0.01 -and $a -le 3 * $PI / 2 + 0.01) { $r0 + $PI } else { $r0 }); $kind = 'street name' }
    else { continue }
    if ([math]::Abs($r1 - $r0) -lt 1e-6) { "{0} {1} unchanged" -f $e.Handle, $kind; continue }
    "{0} {1} rot {2:N2} -> {3:N2}  {4}" -f $e.Handle, $kind, ($r0 * 180 / $PI), (($r1 % (2 * $PI)) * 180 / $PI), ($e.TextString -replace '\\P', ' ')
    if ($Apply) { $c0 = Center $e; $e.Rotation = ($r1 % (2 * $PI)); if ($e.Rotation -lt 0) { $e.Rotation += 2 * $PI }; $c1 = Center $e; $e.Move([double[]]@($c1[0], $c1[1], 0), [double[]]@($c0[0], $c0[1], 0)) }
  } elseif ($e.ObjectName -eq 'AcDbMLeader') {
    $v = $e.GetLeaderLineVertices(0); "{0} MLeader rotate -{1} about tip {2:N1},{3:N1}" -f $e.Handle, $DeltaDeg, $v[0], $v[1]
    if ($Apply) { $e.Rotate([double[]]@($v[0], $v[1], 0), -$delta) }
  }
}
if ($Apply) { if ($wasLocked) { $vp.DisplayLocked = $true }; $d.Regen(1); 'done: look at the layout, then save if it is right (nothing saved here)' } else { 'dry run: add -Apply' }
