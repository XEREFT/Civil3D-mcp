param([Parameter(Mandatory)][string]$Dwg)
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
function Wait-Idle($d,$max=120){ for($i=0;$i -lt $max;$i++){ Start-Sleep 1; try{ if([int]$d.GetVariable('CMDACTIVE') -eq 0){ return $true } }catch{} }; return $false }
$dT=$null;$dV=$null; foreach($x in $app.Documents){ if($x.FullName -ieq $Dwg){$dT=$x}; if($x.FullName -like '*vcov*Cover_V.dwg'){$dV=$x} }
try{ $dT.Layouts.Item('WASD').Delete(); Start-Sleep 1 }catch{}
$lay=$dT.Layouts.Add('WASD'); try{ $lay.CopyFrom($dT.Layouts.Item('C-001')) }catch{}
$dV.Activate(); Start-Sleep 2
$dV.ActiveLayout=$dV.Layouts.Item('WASD'); Start-Sleep 2
$dV.SendCommand("_.COPYBASE 0,0,0 _ALL `n"); 
"copybase idle: " + (Wait-Idle $dV)
$dT.Activate(); Start-Sleep 2
$dT.ActiveLayout=$dT.Layouts.Item('WASD'); Start-Sleep 2
$dT.SendCommand("_.PASTECLIP 0,0,0 `n")
"paste idle: " + (Wait-Idle $dT 240)
"dest count = " + $dT.Layouts.Item('WASD').Block.Count
