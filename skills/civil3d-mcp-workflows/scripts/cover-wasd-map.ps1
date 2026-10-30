param([Parameter(Mandatory)][string]$Dwg,[double]$Tx=896671,[double]$Ty=503178)
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d=$null; foreach($x in $app.Documents){ if($x.FullName -ieq $Dwg){$d=$x} }
$d.Activate(); Start-Sleep 1
$new=$d.Layouts.Item('WASD').Block
$del=@(); $vp=$null
for($i=0;$i -lt $new.Count;$i++){ $e=$new.Item($i); $n=$e.ObjectName
  if($n -eq 'AcDbViewport'){ if([math]::Abs($e.CustomScale-1/300) -lt 1e-5){ $vp=$e } }
  elseif($n -eq 'AcDbMText' -and ($e.Layer -in 'TEXT','TXT') -and $e.TextString -like '*\H0.66667x;*'){ $p=$e.InsertionPoint; if($p[0] -gt 12.3 -and $p[0] -lt 22.5 -and $p[1] -gt 7.3 -and $p[1] -lt 15.8 -and $e.TextString -notmatch 'x;N\s*\}'){ $del+=$e } } }
"street labels to delete: " + $del.Count
foreach($e in $del){ try{ $e.Delete() }catch{ "del fail" } }
if(-not $vp){ throw "map viewport not found" }
$d.ActiveLayout=$d.Layouts.Item('WASD'); Start-Sleep 1
$vp.DisplayLocked=$false
$vp.Target=[double[]]@($Tx,$Ty,0)
$vp.TwistAngle=0
$vp.CustomScale=1/300
$vp.DisplayLocked=$true
"vp target=" + ($vp.Target -join ',') + " scale=" + $vp.CustomScale + " locked=" + $vp.DisplayLocked + " layer=" + $vp.Layer
