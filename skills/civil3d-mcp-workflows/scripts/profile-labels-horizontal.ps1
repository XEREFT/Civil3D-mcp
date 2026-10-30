# Make every profile label read horizontally (C-301). Run against the OPEN DWG, then SAVE and plot.
# 1) all AcDbMLeader in the profile window: TextRotation -> 0 (they were 1.61 rad = vertical)
# 2) vertical aligned dims: ExtLine2.x = ExtLine1.x (remove slant), TextRotation = 0.0001 (0 keeps text aligned to the dim line)
# 3) a rotated NATIVE Civil label (e.g. pipe profile label): set .Visible=$false and copy a horizontal MLeader with the same text
# Never scan .TextString over every ModelSpace entity (Civil objects hang COM): filter by ObjectName first.
param([string]$Doc,[double]$X0=894200,[double]$X1=895000,[double]$Y0=490500,[double]$Y1=492500)
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$doc=$null;foreach($x in $app.Documents){ if($x.Name -eq $Doc){$doc=$x} }
$ms=$doc.ModelSpace;$n=$ms.Count;$k=0;$d=0
for($i=0;$i -lt $n;$i++){ try{ $e=$ms.Item($i);$o=$e.ObjectName
  if($o -eq 'AcDbMLeader'){ $mn=$null;$mx=$null;$e.GetBoundingBox([ref]$mn,[ref]$mx)
     if($mn[0] -gt $X0 -and $mn[0] -lt $X1 -and $mn[1] -gt $Y0 -and $mn[1] -lt $Y1 -and [math]::Abs($e.TextRotation) -gt 0.05){ $e.TextRotation=0;$k++ } }
  elseif($o -eq 'AcDbAlignedDimension'){ $p=$e.ExtLine1Point;$q=$e.ExtLine2Point
     if($p[0] -gt $X0 -and $p[0] -lt $X1 -and $p[1] -gt $Y0 -and $p[1] -lt $Y1 -and [math]::Abs($q[1]-$p[1]) -gt [math]::Abs($q[0]-$p[0])){ $e.ExtLine2Point=[double[]]@($p[0],$q[1],0);$e.TextRotation=0.0001;$d++ } }
 }catch{} }
"mleaders=$k dims=$d"
