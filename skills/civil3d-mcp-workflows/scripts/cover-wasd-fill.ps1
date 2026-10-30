param([Parameter(Mandatory)][string]$Dwg)
$ErrorActionPreference='Continue'
trap { Write-Output ("TRAP: " + $_.Exception.Message + " @ line " + $_.InvocationInfo.ScriptLineNumber); continue }
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d=$null; foreach($x in $app.Documents){ if($x.FullName -ieq $Dwg){$d=$x} }
$d.Activate(); Start-Sleep 1
$old=$d.Layouts.Item('C-001').Block; $new=$d.Layouts.Item('WASD').Block
function Index($blk){ $o=New-Object System.Collections.ArrayList; for($i=0;$i -lt $blk.Count;$i++){ $e=$blk.Item($i); $n=$e.ObjectName; if($n -in 'AcDbMText','AcDbBlockReference','AcDbViewport','AcDbMLeader'){ [void]$o.Add($e) } }; return ,$o }
$oldIdx=Index $old; $newIdx=Index $new; "indexed old=" + $oldIdx.Count + " new=" + $newIdx.Count
$ptCache=@{}
function Near($which,$x,$y,$tol=0.25,$like='*'){ $idx= if($which -eq 'old'){$oldIdx}else{$newIdx}; foreach($e in $idx){ if($e.ObjectName -ne 'AcDbMText'){continue}; $k=$e.Handle; if(-not $ptCache.ContainsKey($k)){ $ptCache[$k]=$e.InsertionPoint }; $p=$ptCache[$k]; if([math]::Abs($p[0]-$x) -lt $tol -and [math]::Abs($p[1]-$y) -lt $tol -and $e.TextString -like $like){ return $e } }; return $null }
function OldText($x,$y,$like='*'){ $e=Near 'old' $x $y 0.1 $like; if(-not $e){ throw "old text not found at $x,$y" }; return $e.TextString }
function SetNew($x,$y,$text,$like='*'){ $e=Near 'new' $x $y 0.25 $like; if(-not $e){ throw "new text not found at $x,$y ($like)" }; $e.TextString=$text; "set ($x,$y)" }
# ---- text from our old cover (same template fields)
SetNew 17.397 22.932 (OldText 17.4 22.93 '*SANITARY SEWER PLANS*')
SetNew 32.89 15.86 (OldText 32.89 15.86 '*SEIDENSTEIN*')
SetNew 34.36 15.86 (OldText 34.4 15.86 '*UNINCORPORATED*')
SetNew 32.69 6.91 (OldText 32.69 6.91 '*N.T.S.*')
SetNew 32.69 8.61 (OldText 32.69 8.61 '*XX-XX*')
SetNew 34.03 8.25 (OldText 34.03 8.25 '*JH*')
SetNew 34.03 7.93 (OldText 34.03 7.93 '*CF*')
SetNew 34.03 7.6  (OldText 34.03 7.6 '*10/26*')
SetNew 13.91 1.29 (OldText -1.27 22.05 '*XX/XX/XXXX*') '*INSERT DATE*'
# location plan: our text with the correct folio
$e=Near 'new' 12.94 6.38 0.05 '*LOCATION PLAN*'; $e.TextString=(OldText 12.94 6.38 '*LOCATION PLAN*'); "set location plan"
# index of sheets
$e=Near 'new' 9.16 1.71 0.05 '*COVER SHEET*'
$e.TextString=$e.TextString.Replace('WATER AND SEWER PLAN','SANITARY SEWER PLAN').Replace('WATER AND SEWER PROF','SANITARY SEWER PROFILES'); "set index"
# AGR, legal, project description
$e=Near 'new' 19.49 16.6 0.05 '*AGR*'; $e.TextString=$e.TextString.Replace('33810','33911'); "set AGR"
$legal='THE SOUTH 100.00 FEET OF THE NORTH 250 FEET OF THE WEST 1/2 OF TRACT 16, REVISED PLAT OF 2ND AMENDED PLAT OF HIGH PINES, ACCORDING TO THE PLAT THEREOF, AS RECORDED IN PLAT BOOK 31, PAGE 57, OF THE PUBLIC RECORDS OF MIAMI-DADE COUNTY, FLORIDA; A/K/A LOTS 20 AND 21, BLOCK 16, OF 2ND AMENDED PLAT OF HIGH PINES, ACCORDING TO THE PLAT THEREOF, AS RECORDED IN PLAT BOOK 10, PAGE 18, OF THE PUBLIC RECORDS OF MIAMI-DADE COUNTY.'
$e=Near 'new' 15.9 4.27 0.05 '*LEGAL DESCRIPTION*'; $e.TextString=$e.TextString -replace '\\H0\.49999x;LOT 12.*\}$', ('\H0.49999x;' + $legal + '}'); "set legal"
$e=Near 'new' 24.51 2.36 0.05 '*PROJECT DESCRIPTION*'; $e.TextString=$e.TextString.Replace('1 UNIT 5,200 SQFT SFR more than 5000 sqft (510 gpd/unit)','1 UNIT SFR - XXXX SQFT (510 gpd/unit)'); "set project description"
# ---- cleanup of Villa-only items
$del=@()
foreach($e in $newIdx){ $n=$e.ObjectName
  if($n -eq 'AcDbMLeader'){ $del+=$e }
  elseif($n -eq 'AcDbBlockReference' -and ($e.Layer -in 'C-FH-EXIST','CIVIL-CG')){ $del+=$e }
  elseif($n -eq 'AcDbViewport' -and [math]::Abs($e.CustomScale-1) -lt 1e-6){ $del+=$e }
  elseif($n -eq 'AcDbMText' -and $e.Layer -eq 'TXT'){ $p=$e.InsertionPoint; if($p[0] -gt 12.3 -and $p[0] -lt 22.3 -and $p[1] -gt 7.3 -and $p[1] -lt 15.7 -and $e.TextString -notmatch 'x;N\s*\}' -and $e.TextString -match 'ST|AVE|RD|CT|TER'){ $del+=$e } } }
"deleting " + $del.Count
foreach($e in $del){ try{ $e.Delete() }catch{ "del fail " + $e.Handle } }
"done edit"
