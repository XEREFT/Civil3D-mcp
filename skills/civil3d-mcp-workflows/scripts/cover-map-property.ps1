# Cover location map, the engineer's way (2026-10-27 recording, reference section 11): ONLY the property is marked - a black filled square pointed by the arrow.
# Any other rectangle on the map (e.g. the long street rectangle) and its paper-space dimensions are removed. The rectangles live in the XREF (X-TOPO.dwg, layer BNDRY),
# so they are edited in the source file (rule: modify X-TOPO directly), then the host reloads the xref.
#   1) find the handles: in the map viewport (MSpace) run (nentselp '(x y 0)) on an edge, or open X-TOPO.dwg and list layer BNDRY lines near the map coordinates
#   2) powershell -NoProfile -ExecutionPolicy Bypass -File cover-map-property.ps1 -Dir "<project folder>" -DeleteHandles 61B4D7,61B4D8 -PropertyLines 61C289,61C28A,61C28B,61C28D -DeleteDims 1E958,1E95D [-HostDoc "Seindestein*"]
# Always back up X-TOPO.dwg, the host DWG and the cover PDF to _backup first. Do NOT use Hatch.AppendOuterLoop through COM (it silently leaves 0 loops): the fill is a 2D SOLID.
param([Parameter(Mandatory)][string]$Dir, [Parameter(Mandatory)][string[]]$DeleteHandles, [Parameter(Mandatory)][string[]]$PropertyLines,
  [string[]]$DeleteDims = @(), [string]$XrefName = 'X-TOPO', [string]$Layer = 'BNDRY', [string]$HostDoc = '*')
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$src = Join-Path $Dir "$XrefName.dwg"
$x = $null; foreach ($k in $app.Documents) { if ($k.FullName -ieq $src) { $x = $k } }
if (-not $x) { $x = $app.Documents.Open($src, $false); Start-Sleep 2 }
foreach ($h in $DeleteHandles) { $e = $x.HandleToObject($h); "delete $h $($e.ObjectName) $($e.Layer)"; $e.Delete() }
$p = @(); foreach ($h in $PropertyLines) { $e = $x.HandleToObject($h); $p += , @($e.StartPoint[0], $e.StartPoint[1]); $p += , @($e.EndPoint[0], $e.EndPoint[1]) }
$u = @(); foreach ($q in $p) { if (-not ($u | Where-Object { [math]::Abs($_[0] - $q[0]) -lt 0.01 -and [math]::Abs($_[1] - $q[1]) -lt 0.01 })) { $u += , $q } }
if ($u.Count -ne 4) { throw "expected 4 distinct corners, got $($u.Count)" }
$cx = ($u | ForEach-Object { $_[0] } | Measure-Object -Average).Average; $cy = ($u | ForEach-Object { $_[1] } | Measure-Object -Average).Average
$u = $u | Sort-Object { [math]::Atan2($_[1] - $cy, $_[0] - $cx) }          # counter-clockwise; SOLID wants 1,2,4,3
$P = { param($a) [double[]]@($a[0], $a[1], 0) }
$s = $x.ModelSpace.AddSolid((& $P $u[0]), (& $P $u[1]), (& $P $u[3]), (& $P $u[2]))
$s.Layer = $Layer; $s.color = 7; "black fill SOLID $($s.Handle) on $Layer"
$x.Save(); $x.Close($true)
$h = $null; foreach ($k in $app.Documents) { if ($k.Name -like $HostDoc -and $k.FullName -ne $src) { $h = $k } }
$h.Activate(); Start-Sleep 1
foreach ($d in $DeleteDims) { try { $h.HandleToObject($d).Delete(); "erased dim $d" } catch { "no dim $d" } }
$h.Blocks.Item($XrefName).Reload(); Start-Sleep 4; $h.Regen(1); $h.Save(); "host saved; replot the cover (qc-plot.ps1 -Layouts C-001) and compare with the engineer's frame"
