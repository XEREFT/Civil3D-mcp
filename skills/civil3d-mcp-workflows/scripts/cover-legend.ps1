# Adds LEGEND + ABBREVIATIONS tables under the INDEX OF SHEETS on the cover layout (C-001) of the open DWG.
# Usage: powershell -File cover-legend.ps1 -DwgName 'X @xereft proposed.dwg' [-X 0.49 -Top 16.5]
# Learned (Seidenstein 2026-10-26): AddTable plots (AddText/AddMText do not); set RowHeight AFTER text height (0.24 / 0.10);
# SetCellAlignment(r,c,4=left | 5=centre) not SetAlignment; widen cells instead of letting text wrap; draw legend symbols at 16.5-0.24*r-0.12.
param([string]$DwgName,[double]$X=0.49,[double]$Top=16.5)
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$doc=$null;foreach($d in $app.Documents){ if($d.Name -eq $DwgName){$doc=$d} }
$ps=$doc.Layouts.Item('C-001').Block
$leg=@('LEGEND','PROP 8" PVC SAN GRAVITY MAIN','PROP 6" PVC SAN LATERAL','EXIST 8" PVC SAN GRAVITY MAIN (TO REMAIN)','PROP SAN MANHOLE','EXIST SAN MANHOLE','PROP 6" CLEAN-OUT AND CAP','PROPERTY LINE (P.L.) / RIGHT-OF-WAY (R/W)')
$t=$ps.AddTable([double[]]@($X,$Top,0),$leg.Count,2,0.24,1.2); $t.SetColumnWidth(0,1.2);$t.SetColumnWidth(1,5.57); $t.VertCellMargin=0.03;$t.HorzCellMargin=0.06
for($r=0;$r -lt $leg.Count;$r++){ $t.SetText($r,$(if($r -eq 0){0}else{1}),$leg[$r]) }
$pairs=@(@('C.O.','CLEAN-OUT'),@('CONC.','CONCRETE'),@('EOP','EDGE OF PAVEMENT'),@('EXIST','EXISTING'),@('INV','INVERT ELEVATION'),@('LF','LINEAR FEET'),@('MD-WASD','MIAMI-DADE WATER & SEWER'),@('MH','MANHOLE'),@('MIN','MINIMUM'),@('N.G.V.D.','NAT''L GEOD. VERT. DATUM'),@('OFF','OFFSET'),@('P.B./PG.','PLAT BOOK / PAGE'),@('P.L.','PROPERTY LINE'),@('PROF','PROFILE'),@('PROP','PROPOSED'),@('PVC','POLYVINYL CHLORIDE'),@('R/W','RIGHT-OF-WAY'),@('SAN','SANITARY'),@('SHT','SHEET'),@('SS','SAN SEWER STD. DETAIL'),@('STA','STATION'),@('TYP','TYPICAL'))
$rows=[math]::Ceiling($pairs.Count/2)+1
$a=$ps.AddTable([double[]]@($X,($Top-2.1),0),$rows,4,0.24,1.0); foreach($i in 0,2){$a.SetColumnWidth($i,1.0);$a.SetColumnWidth($i+1,2.385)}
$a.VertCellMargin=0.03;$a.HorzCellMargin=0.05; $a.SetText(0,0,'ABBREVIATIONS')
for($i=0;$i -lt $pairs.Count;$i++){ $r=1+($i % ($rows-1)); $c=2*[math]::Floor($i/($rows-1)); $a.SetText($r,$c,$pairs[$i][0]); $a.SetText($r,$c+1,$pairs[$i][1]) }
foreach($tb in $t,$a){ $tb.Layer='TEXT'; for($r=0;$r -lt $tb.Rows;$r++){ for($c=0;$c -lt $tb.Columns;$c++){ $tb.SetCellTextHeight($r,$c,$(if($r -eq 0){0.13}else{0.1})); $tb.SetCellAlignment($r,$c,$(if($r -eq 0){5}else{4})) } }; for($r=0;$r -lt $tb.Rows;$r++){ $tb.SetRowHeight($r,0.24) }; $tb.RecomputeTableBlock($true) }
function Ln($x1,$y1,$x2,$y2,$lw,$col){ $l=$ps.AddLine([double[]]@($x1,$y1,0),[double[]]@($x2,$y2,0)); $l.Layer='TEXT'; $l.Lineweight=$lw; if($col){$l.Color=$col} }
function Ci($x,$y,$r,$lw){ $c=$ps.AddCircle([double[]]@($x,$y,0),$r); $c.Layer='TEXT'; $c.Lineweight=$lw }
function Y($r){ $Top-0.24*$r-0.12 }
$xa=$X+0.2;$xb=$X+1.0;$xm=$X+0.6
Ln $xa (Y 1) $xb (Y 1) 70 $null; Ln $xa (Y 2) $xb (Y 2) 25 $null; Ln $xa (Y 3) $xb (Y 3) 35 8
Ci $xm (Y 4) 0.075 35; Ci $xm (Y 5) 0.075 25; Ci $xm (Y 5) 0.035 25; Ci $xm (Y 6) 0.04 25; Ln ($xm+0.04) (Y 6) ($xm+0.2) (Y 6) 25 $null
foreach($k in 0,1,2){ Ln ($xa+$k*0.28) (Y 7) ($xa+$k*0.28+0.18) (Y 7) 25 $null }
for($k=0;$k -lt 8;$k++){ try{$doc.Save()}catch{}; if($doc.Saved){break}; Start-Sleep 2 }
"legend $($t.Handle) abbreviations $($a.Handle) saved=$($doc.Saved)"
