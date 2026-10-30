# Engineer's method (2026-10-27 recording, reference section 10): everything we add for the sanitary laterals that must not print is yellow + no-plot, never deleted
# (his lateral table reads it): C.O. null structures -> structure style "NPLT_Storm Sewer Manhole", lateral pipes -> pipe style "NPLT", SAN LAT alignments -> layer "_NPLT" (style NPLT).
#   powershell -NoProfile -ExecutionPolicy Bypass -File c300-nplt-laterals.ps1 -Doc "Seindestein*" [-StructurePrefix "C.O."] [-PipeNames "Pipe - (14)*"] [-AlignmentPrefix "SAN LAT"] [-WhatIf]
# Uses the COM roots of Civil 3D 2027: AeccXUiLand.AeccApplication.13.9 (objects, HandleToObject) and AeccXUiPipe.AeccPipeApplication.13.9 (StructureStyles / PipeStyles).
# The Land document's Styles.StructureStyles is EMPTY; the plugin has no style setter for pipe parts. Save and replot C-300 afterwards (qc-plot.ps1); the C-300 viewport is never touched.
param([string]$Doc = '*', [string]$StructurePrefix = 'C.O.', [string]$PipeNames = 'Pipe - (14)*', [string]$AlignmentPrefix = 'SAN LAT',
  [string]$StructureStyle = 'NPLT_Storm Sewer Manhole', [string]$PipeStyle = 'NPLT', [string]$NpltLayer = '_NPLT', [switch]$WhatIf)
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d = $null; foreach ($x in $app.Documents) { if ($x.Name -like $Doc) { $d = $x } }
if (-not $d) { throw "no open document matching '$Doc'" }
$land = $app.GetInterfaceObject('AeccXUiLand.AeccApplication.13.9').ActiveDocument
$pipe = $app.GetInterfaceObject('AeccXUiPipe.AeccPipeApplication.13.9').ActiveDocument
$ss = $null; foreach ($s in $pipe.StructureStyles) { if ($s.Name -eq $StructureStyle) { $ss = $s } }
$ps = $null; foreach ($s in $pipe.PipeStyles) { if ($s.Name -eq $PipeStyle) { $ps = $s } }
if (-not $ss) { throw "structure style '$StructureStyle' not in the drawing" }
if (-not $ps) { throw "pipe style '$PipeStyle' not in the drawing" }
$n = @{ s = 0; p = 0; a = 0 }
foreach ($e in $d.ModelSpace) {
  $o = $e.ObjectName
  if ($o -eq 'AeccDbStructure' -and $e.Name -like "$StructurePrefix*") {
    $obj = $land.HandleToObject($e.Handle); "{0} {1}: {2} -> {3}" -f $e.Handle, $obj.Name, $obj.Style.Name, $StructureStyle
    if (-not $WhatIf -and $obj.Style.Name -ne $StructureStyle) { $obj.Style = $ss }; $n.s++
  } elseif ($o -eq 'AeccDbPipe' -and $e.Name -like $PipeNames) {
    $obj = $land.HandleToObject($e.Handle); "{0} {1}: {2} -> {3}" -f $e.Handle, $obj.Name, $obj.Style.Name, $PipeStyle
    if (-not $WhatIf -and $obj.Style.Name -ne $PipeStyle) { $obj.Style = $ps }; $n.p++
  } elseif ($o -eq 'AeccDbAlignment' -and $e.Name -like "$AlignmentPrefix*") {
    "{0} {1}: layer {2} -> {3}" -f $e.Handle, $e.Name, $e.Layer, $NpltLayer
    if (-not $WhatIf) { $e.Layer = $NpltLayer }; $n.a++
  }
}
"structures=$($n.s) pipes=$($n.p) alignments=$($n.a)" + $(if ($WhatIf) { ' (WhatIf: nothing changed)' } else { '' })
if (-not $WhatIf) { $d.Save(); 'saved' }
