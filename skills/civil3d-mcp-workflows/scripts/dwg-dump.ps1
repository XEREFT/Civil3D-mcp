<#
.SYNOPSIS
  Read-only dump of what the MCP tools can't list yet: xref paths, layout viewports
  (incl. DVIEW TWist angle + scale), DIMENSION entities, and the layer table.
.DESCRIPTION
  Copies the DWG to %TEMP% and runs AutoCAD Core Console on the COPY, so it is safe
  even when the file is open (and unsaved) in Civil 3D. It reads the last SAVED state.
  The LISP is inlined in the .scr because SECURELOAD rejects (load) from temp folders.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File dwg-dump.ps1 "C:\...\C-300.dwg"
  -> prints the path of <name>_dump.txt. Lines: XREF|name|path|flags, LAYER|name|c=|lt=|fl=,
     VPORT|layout|h=|psctr=|w=|ht=|viewctr=|viewht=|twist_rad=|layer=,
     DIM|layout|h=|layer=|style=|type=|meas=|txt=|p13=|p14=|p10=|tm=|rot=
  Viewport scale = ht / viewht (e.g. 23/460 = 1"=20'). Twist in degrees = twist_rad*180/pi.
#>
param([Parameter(Mandatory)][string]$Dwg, [string]$OutDir = "$env:TEMP\c3d-dwg-dump")

$acc = Get-ChildItem 'C:\Program Files\Autodesk\AutoCAD 20*\accoreconsole.exe' -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $acc) { throw 'accoreconsole.exe not found under C:\Program Files\Autodesk' }

New-Item -ItemType Directory -Force $OutDir | Out-Null
$base = [IO.Path]::GetFileNameWithoutExtension($Dwg) -replace '[^\w\-]', '_'
$work = Join-Path $OutDir "work"
New-Item -ItemType Directory -Force $work | Out-Null
$copy = Join-Path $work "$base.dwg"
Copy-Item -LiteralPath $Dwg $copy -Force

$scr = Join-Path $work 'dump.scr'
@'
(vl-load-com)
(defun _p (x) (cond ((null x) "") ((= (type x) 'REAL) (rtos x 2 4)) ((and (listp x) (vl-every 'numberp x)) (strcat "(" (apply 'strcat (mapcar '(lambda (v) (strcat (rtos v 2 4) " ")) x)) ")")) (T (vl-princ-to-string x))))
(defun _g (k e) (cdr (assoc k e)))
(defun c:DUMPINFO ( / f ss i ed b e ty pt pts xtra txt mls nm)
  (setq f (open (strcat (getvar "DWGPREFIX") (vl-filename-base (getvar "DWGNAME")) "_dump.txt") "w"))
  (write-line (strcat "INSUNITS|" (_p (getvar "INSUNITS"))) f)
  (setq b (tblnext "BLOCK" T))
  (while b
    (if (_g 1 b) (write-line (strcat "XREF|" (_g 2 b) "|" (_g 1 b) "|flags=" (_p (_g 70 b))) f))
    (setq b (tblnext "BLOCK")))
  (setq b (tblnext "LAYER" T))
  (while b
    (setq ed (entget (tblobjname "LAYER" (_g 2 b))))
    (write-line (strcat "LAYER|" (_g 2 b) "|c=" (_p (_g 62 b)) "|lt=" (_p (_g 6 b)) "|fl=" (_p (_g 70 b)) "|lw=" (_p (_g 370 ed)) "|plot=" (_p (_g 290 ed))) f)
    (setq b (tblnext "LAYER")))
  (setq b (tblnext "STYLE" T))
  (while b
    (write-line (strcat "TSTYLE|" (_g 2 b) "|font=" (_p (_g 3 b)) "|h=" (_p (_g 40 b)) "|wf=" (_p (_g 41 b))) f)
    (setq b (tblnext "STYLE")))
  (setq b (tblnext "DIMSTYLE" T))
  (while b (write-line (strcat "DSTYLE|" (_g 2 b)) f) (setq b (tblnext "DIMSTYLE")))
  (foreach d (dictsearch (namedobjdict) "ACAD_MLEADERSTYLE")
    (if (= (car d) 3) (write-line (strcat "MLSTYLE|" (cdr d)) f)))
  (setq mls nil)
  (foreach d (dictsearch (namedobjdict) "ACAD_MLEADERSTYLE")
    (cond ((= (car d) 3) (setq nm (cdr d))) ((= (car d) 350) (setq mls (cons (cons (cdr d) nm) mls)))))
  (if (setq ss (ssget "X" '((410 . "Model"))))
    (repeat (setq i (sslength ss))
      (setq e (ssname ss (setq i (1- i))) ed (entget e) ty (_g 0 ed) pt (_g 10 ed) xtra "" txt "")
      (cond
        ((= ty "LINE") (setq xtra (strcat "|p2=" (_p (_g 11 ed)))))
        ((= ty "LWPOLYLINE") (setq xtra (strcat "|n=" (_p (_g 90 ed)) "|closed=" (_p (logand 1 (_g 70 ed))) "|cw=" (_p (_g 43 ed))
          "|v=" (apply 'strcat (mapcar '(lambda (x) (if (= (car x) 10) (strcat (rtos (cadr x) 2 3) "," (rtos (caddr x) 2 3) ";") "")) ed)))))
        ((member ty '("CIRCLE" "ARC")) (setq xtra (strcat "|r=" (_p (_g 40 ed)))))
        ((= ty "TEXT") (setq xtra (strcat "|style=" (_p (_g 7 ed)) "|h=" (_p (_g 40 ed)) "|rot=" (_p (_g 50 ed))) txt (_g 1 ed)))
        ((= ty "MTEXT") (setq xtra (strcat "|style=" (_p (_g 7 ed)) "|h=" (_p (_g 40 ed)) "|att=" (_p (_g 71 ed)) "|w=" (_p (_g 41 ed)) "|rot=" (_p (_g 50 ed))) txt (_g 1 ed)))
        ((= ty "MULTILEADER")
          (setq pts (mapcar 'cdr (vl-remove-if-not '(lambda (x) (and (= (car x) 10) (> (+ (abs (cadr x)) (abs (caddr x))) 2.0))) ed)) pt (last pts))
          (setq xtra (strcat "|style=" (_p (vl-some '(lambda (x) (if (= (car x) 340) (cdr (assoc (cdr x) mls)))) ed)) "|h=" (_p (_g 41 ed)) "|txtpt=" (_p (_g 12 ed)))
                txt (_p (_g 304 ed))))
        ((= ty "DIMENSION") (setq pt (_g 13 ed) xtra (strcat "|style=" (_p (_g 3 ed)) "|meas=" (_p (_g 42 ed)) "|p2=" (_p (_g 14 ed))) txt (_p (_g 1 ed))))
        ((= ty "INSERT") (setq xtra (strcat "|block=" (_p (_g 2 ed)) "|sx=" (_p (_g 41 ed)) "|rot=" (_p (_g 50 ed)))))
        ((= ty "HATCH") (setq xtra (strcat "|pattern=" (_p (_g 2 ed)) "|pscale=" (_p (_g 41 ed))))))
      (write-line (strcat "ENT|" ty "|" (_p (_g 5 ed)) "|" (_p (_g 8 ed)) "|c=" (_p (_g 62 ed)) "|lt=" (_p (_g 6 ed)) "|lw=" (_p (_g 370 ed)) "|lts=" (_p (_g 48 ed))
        "|x=" (_p (car pt)) "|y=" (_p (cadr pt)) xtra "|txt=" (vl-string-translate "\n\r" "  " txt)) f)))
  (if (setq ss (ssget "X" '((0 . "VIEWPORT"))))
    (repeat (setq i (sslength ss))
      (setq ed (entget (ssname ss (setq i (1- i)))))
      (write-line (strcat "VPORT|" (_p (_g 410 ed)) "|h=" (_p (_g 5 ed)) "|psctr=" (_p (_g 10 ed)) "|w=" (_p (_g 40 ed)) "|ht=" (_p (_g 41 ed))
        "|viewctr=" (_p (_g 12 ed)) "|viewht=" (_p (_g 45 ed)) "|twist_rad=" (_p (_g 51 ed)) "|layer=" (_p (_g 8 ed))) f)))
  (if (setq ss (ssget "X" '((0 . "DIMENSION"))))
    (repeat (setq i (sslength ss))
      (setq ed (entget (ssname ss (setq i (1- i)))))
      (write-line (strcat "DIM|" (_p (_g 410 ed)) "|h=" (_p (_g 5 ed)) "|layer=" (_p (_g 8 ed)) "|style=" (_p (_g 3 ed)) "|type=" (_p (_g 70 ed))
        "|meas=" (_p (_g 42 ed)) "|txt=" (_p (_g 1 ed)) "|p13=" (_p (_g 13 ed)) "|p14=" (_p (_g 14 ed)) "|p10=" (_p (_g 10 ed)) "|tm=" (_p (_g 11 ed)) "|rot=" (_p (_g 50 ed))) f)))
  (close f)
  (princ))
DUMPINFO
'@ | Set-Content -Encoding ASCII $scr

& $acc.FullName /i $copy /s $scr /l en-US 2>&1 | Out-Null
$workOut = Join-Path $work "${base}_dump.txt"
if (-not (Test-Path $workOut)) { throw "Core Console produced no dump for $Dwg" }
$out = Join-Path $OutDir "${base}_dump.txt"
Move-Item $workOut $out -Force
Remove-Item $copy -Force
$out
