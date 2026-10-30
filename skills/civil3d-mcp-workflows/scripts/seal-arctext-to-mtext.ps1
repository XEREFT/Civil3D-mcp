# Replace AcDbArcAlignedText (Express Tools proxy, prints "AcDbArcAlignedText (ATEXT)" in accoreconsole PDFs)
# in a seal block with per-character MText on arcs. Run against the OPEN DWG.
# Usage: .\seal-arctext-to-mtext.ps1 -Doc 'X.dwg' -Block 'cformoso seal' -ArcHandles C21C,C21D,C223,C224 -TemplateMText C222 `
#          -Cx -3.57 -Cy 1.94 -Top 'CARLOS FORMOSO, P.E.' -Bottom 'PROFESSIONAL ENGINEER' -Inner 'FLORIDA'
# Lessons: the block holds several engineers' seals (find the one whose centre matches, others are hidden);
# never delete block MTexts by handle range; PS 5.1 has no [math]::Degrees (use *180/pi); keep own handle list.
param([string]$Doc,[string]$Block,[string[]]$ArcHandles,[string]$TemplateMText,[double]$Cx,[double]$Cy,
      [string]$Top,[string]$Bottom,[string]$Inner,[double]$H=0.09,[double]$RTop=0.715,[double]$RBot=0.80,[double]$RInner=0.52)
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$doc=$null;foreach($x in $app.Documents){ if($x.Name -eq $Doc){$doc=$x} }
function Rt($sb){ for($k=0;$k -lt 10;$k++){ try{ return (& $sb) }catch{ Start-Sleep -Milliseconds 400 } } }
$deg=180/[math]::PI; $tpl=$doc.HandleToObject($TemplateMText); $script:new=@()
function Arc($txt,$r,$top){ if(-not $txt){return}
  $adv=@(); foreach($ch in $txt.ToCharArray()){ $adv+= if($ch -eq ' '){0.45*$H} elseif($ch -in '.',','){0.40*$H} elseif($ch -eq 'I'){0.40*$H} elseif($ch -in 'M','W'){1.05*$H} else {0.85*$H} }
  $tot=($adv|Measure-Object -Sum).Sum; $cum=0; $i=0
  foreach($ch in $txt.ToCharArray()){ $mid=$cum+$adv[$i]/2; $cum+=$adv[$i]; $i++; if($ch -eq ' '){continue}
    $dth=(($tot/2-$mid)/$r)*$deg; if($top){$th=90+$dth;$rot=$th-90}else{$th=270-$dth;$rot=$th+90}
    $px=$Cx+$r*[math]::Cos($th/$deg);$py=$Cy+$r*[math]::Sin($th/$deg)
    $c=Rt{ $tpl.Copy() }
    Rt{ $c.Rotation=0;$c.TextString='{\fArial|b0|i0|c0|p34;'+$ch+'}';$c.Height=$H;$c.Width=0;$c.AttachmentPoint=8;$c.InsertionPoint=[double[]]@($px,$py,0);$c.Rotation=$rot/$deg;1 }|Out-Null
    $script:new+=$c.Handle } }
Arc $Top $RTop $true; Arc $Bottom $RBot $false; Arc $Inner $RInner $false
foreach($h in $ArcHandles){ Rt{ $doc.HandleToObject($h).Delete();1 }|Out-Null }
$doc.Regen(1); for($j=0;$j -lt 5;$j++){ try{$doc.Save();break}catch{Start-Sleep 1} }
"created $($script:new.Count) chars; saved=$($doc.Saved)"
