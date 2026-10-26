# Makes every label WE draw print white on screen in the open drawing (user rule 2026-10-26): layer C-ANNO colour 7, every MLeader's entity colour 7 and its TEXT colour white.
# The MLeader text colour is stored apart from the entity colour (DXF 90 / 92 in the context data: -1023410168 = ACI 8, -1023410169 = ACI 7) and is NOT reachable over COM, so the codes are
# changed with entmod through SendCommand. Colour only: no geometry, text or layer change; the monochrome plot prints black anyway.
#   powershell -NoProfile -ExecutionPolicy Bypass -File labels-white.ps1 -Doc "Villa one*" [-Save]
param([Parameter(Mandatory)][string]$Doc, [switch]$Save)
$ErrorActionPreference = 'Stop'
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d = $null; foreach ($x in $app.Documents) { if ($x.Name -like $Doc) { $d = $x } }
if (-not $d) { throw "no open document matching '$Doc'" }
if ($app.ActiveDocument.Name -ne $d.Name) { $d.Activate(); Start-Sleep 2 }
if ([int]$d.GetVariable('CMDACTIVE') -ne 0) { throw 'a command is active in the drawing: finish it first' }
try { $d.Layers.Item('C-ANNO').Color = 7 } catch { 'layer C-ANNO not found' }
$n = 0; $ms = $d.ModelSpace
for ($i = 0; $i -lt $ms.Count; $i++) { $e = $ms.Item($i); if ($e.ObjectName -eq 'AcDbMLeader' -and $e.Color -ne 7) { $e.Color = 7; $n++ } }
"entity colour set to 7 on $n MLeaders"
$lsp = '(progn (setq ss (ssget "_X" (list (cons 0 "MULTILEADER"))) n 0 k 0) (if ss (repeat (sslength ss) (setq e (entget (ssname ss n))) (if (or (member (cons 90 -1023410168) e) (member (cons 92 -1023410168) e)) (progn (setq e (subst (cons 90 -1023410169) (cons 90 -1023410168) e) e (subst (cons 92 -1023410169) (cons 92 -1023410168) e)) (if (entmod e) (setq k (1+ k))))) (setq n (1+ n)))) (princ (strcat "WHITEML " (itoa k))))'
$d.SendCommand($lsp + "`n")
Start-Sleep 5
$d.Regen(1)
if ($Save) { $d.Save(); Start-Sleep 5; 'saved: ' + (Get-Item $d.FullName).LastWriteTime }
'done (check: MLeader text colour is only visible on screen / in a saved copy read with the Core Console)'
