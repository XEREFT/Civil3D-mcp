param([Parameter(Mandatory)][string]$Dwg,[Parameter(Mandatory)][string]$SrcLike)
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
function Wait-Idle($d,$max=120){ for($i=0;$i -lt $max;$i++){ Start-Sleep 1; try{ if([int]$d.GetVariable('CMDACTIVE') -eq 0){ return $true } }catch{} }; return $false }
$dT=$null;$dS=$null; foreach($x in $app.Documents){ if($x.FullName -ieq $Dwg){$dT=$x}; if($x.FullName -like $SrcLike){$dS=$x} }
if(-not $dT -or -not $dS){ throw "doc not found" }
try{ $dT.Layouts.Item('WASD').Delete(); Start-Sleep 1 }catch{}
$lay=$dT.Layouts.Add('WASD'); try{ $lay.CopyFrom($dT.Layouts.Item('C-001')) }catch{}
$dS.Activate(); Start-Sleep 2
$dS.ActiveLayout=$dS.Layouts.Item('C-001'); Start-Sleep 2
$dS.SendCommand("_.COPYBASE 0,0,0 _ALL `n")
"copybase idle: " + (Wait-Idle $dS)
$dT.Activate(); Start-Sleep 2
$dT.ActiveLayout=$dT.Layouts.Item('WASD'); Start-Sleep 2
$dT.SendCommand("_.PASTECLIP 0,0,0 `n")
"paste idle: " + (Wait-Idle $dT 240)
"dest count = " + $dT.Layouts.Item('WASD').Block.Count
