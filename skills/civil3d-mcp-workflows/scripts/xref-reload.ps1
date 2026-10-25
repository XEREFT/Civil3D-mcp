# Replaces an xref's file while its host drawing is OPEN in Civil 3D (COM, no UI): unload -> copy the new file over -> reload -> freeze xref layers -> regen -> (optional) save.
# Used after topo-hide-pavement-labels.mjs / topo-hide-text.ps1 / any X-TOPO.dwg edit done offline with the Core Console.
#   powershell -NoProfile -ExecutionPolicy Bypass -File xref-reload.ps1 -Doc "SEIDENSTEIN*" -Xref X-TOPO -NewFile "<edited copy>.dwg" -Target "<...\X-TOPO.dwg>" [-Freeze "X-TOPO|HIDE-PAVEMENT-LABELS"] [-Save]
#   without -NewFile it only unloads + reloads (the file on disk was already replaced while the xref was unloaded)
# Known: reloading with only /R does not pick up NEW layers/changes reliably: the unload (_U) first is required. Never kills Civil 3D; the document must be idle (CMDACTIVE=0).
param([Parameter(Mandatory)][string]$Doc, [string]$Xref = 'X-TOPO', [string]$NewFile, [string]$Target, [string[]]$Freeze = @(), [switch]$Save)
$ErrorActionPreference = 'Stop'
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d = $null; foreach ($x in $app.Documents) { if ($x.Name -like $Doc) { $d = $x } }
if (-not $d) { throw "no open document matching '$Doc'" }
if ($app.ActiveDocument.Name -ne $d.Name) { $d.Activate(); Start-Sleep 2 }
if ([int]$d.GetVariable('CMDACTIVE') -ne 0) { throw 'a command is active in the drawing: finish it first' }
$d.SendCommand("_.-XREF`n_U`n$Xref`n"); Start-Sleep 4
if ($NewFile) { if (-not $Target) { throw '-NewFile needs -Target' }; Copy-Item $NewFile $Target -Force }
$d.SendCommand("_.-XREF`n_R`n$Xref`n"); Start-Sleep 6
foreach ($l in $Freeze) { $d.SendCommand("_.-LAYER`n_F`n$l`n`n"); Start-Sleep 3 }
$d.Regen(1); Start-Sleep 3
foreach ($l in $Freeze) { try { "{0} frozen={1}" -f $l, $d.Layers.Item($l).Freeze } catch { "{0}: layer not found (the xref has no such layer)" -f $l } }
if ($Save) { $d.Save(); Start-Sleep 5; "saved: " + (Get-Item $d.FullName).LastWriteTime }
