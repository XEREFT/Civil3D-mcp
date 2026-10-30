param([Parameter(Mandatory)][string]$Dwg)
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d=$null; foreach($x in $app.Documents){ if($x.FullName -ieq $Dwg){$d=$x} }
$d.Activate(); Start-Sleep 1
$d.ActiveLayout=$d.Layouts.Item('C-300'); Start-Sleep 1
$d.Layouts.Item('C-001').Delete(); Start-Sleep 1
$l=$d.Layouts.Item('WASD'); $l.Name='C-001'; $l.TabOrder=1
$d.ActiveLayout=$l
$d.SetVariable('FILEDIA',1)
$d.Save()
"layouts: " + (($d.Layouts | Sort-Object TabOrder | % Name) -join ', ')
