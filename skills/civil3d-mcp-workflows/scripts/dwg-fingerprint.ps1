<#
.SYNOPSIS
  Full read-only fingerprint of a DWG (all spaces) for design audits: sysvars, xrefs, layers,
  linetypes, text/dim/mleader styles, block definitions, every entity in model AND paper space,
  viewports with their frozen layers and scale, and each layout's page setup.
.DESCRIPTION
  Runs AutoCAD Core Console on a COPY. Unlike dwg-dump.ps1 (which copies only the DWG), this copies
  the DWG's whole folder (DWG/BAK only, recursive, SOURCE FILES skipped) so relative xrefs resolve and
  xref-dependent layers / viewport freezes are captured. A .bak input is copied as .dwg.
  Output is TAB-separated (layer names of xrefs contain '|'):
    SYS <name> <value>
    XREF <name> <path> flags=<70> resolved=<0|1>
    LAYER <name> c=<62> lt=<6> fl=<70> lw=<370> plot=<290> tc=<420>
    LTYPE <name> <description>
    TSTYLE <name> font=<3> h=<40> wf=<41> obl=<50>
    DSTYLE <name> scale=<40> asz=<41> txt=<140> gap=<147> dec=<271> tsty=<style name>
    MLSTYLE <name> <raw dxf pairs>
    BLOCK <name> n=<entities> atts=<TAG,TAG>
    ENT <space/layout> <type> <handle> <layer> c= lt= lw= lts= tc= x= y= ...type extras... txt=
    VPORT <layout> h= psctr= w= ht= viewctr= viewht= twist= scale=1:<viewht/ht> status= layer= target= frozen=<L1;L2>
          (model centre = target + viewctr turned by the twist, as in dwg-dump.ps1)
    LAYOUT <name> tab=<71> setup=<1> device=<2> paper=<4> ctb=<7> pw=<44> ph=<45> units=<72> rot=<73> ptype=<74> num=<142> den=<143>
    VIEW <name>
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File dwg-fingerprint.ps1 -Dwg "C:\...\C-300.dwg" -Out "C:\...\c300.fp.tsv"
#>
param([Parameter(Mandatory)][string]$Dwg, [Parameter(Mandatory)][string]$Out, [string]$WorkRoot = "$env:TEMP\c3d-fingerprint")

$acc = Get-ChildItem 'C:\Program Files\Autodesk\AutoCAD 20*\accoreconsole.exe' -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $acc) { throw 'accoreconsole.exe not found under C:\Program Files\Autodesk' }

$src = (Resolve-Path -LiteralPath $Dwg).Path
$srcDir = Split-Path $src -Parent
$work = Join-Path $WorkRoot ([guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null
# replicate the folder's drawings so relative xrefs (x-ref\X-TOPO.dwg, ..\xref\...) resolve
Get-ChildItem -LiteralPath $srcDir -Recurse -File -Include *.dwg |
  Where-Object { $_.FullName -notmatch '\\SOURCE FILES\\' } | ForEach-Object {
    $rel = $_.FullName.Substring($srcDir.Length).TrimStart('\')
    $dst = Join-Path $work $rel
    New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
    Copy-Item -LiteralPath $_.FullName $dst -Force
  }
$name = [IO.Path]::GetFileNameWithoutExtension($src)
$copy = Join-Path $work ("_fp_" + ($name -replace '[^\w\-]', '_') + ".dwg")
Copy-Item -LiteralPath $src $copy -Force
$tmpOut = Join-Path $work 'fp.tsv'

$scr = Join-Path $work 'fp.scr'
$lisp = @'
(vl-load-com)
(setq T_ (chr 9))
(defun _p (x) (cond ((null x) "") ((= (type x) 'REAL) (rtos x 2 4)) ((= (type x) 'ENAME) (vl-princ-to-string (cdr (assoc 5 (entget x))))) ((and (listp x) (vl-every 'numberp x)) (strcat "(" (apply 'strcat (mapcar '(lambda (v) (strcat (rtos v 2 4) " ")) x)) ")")) (T (vl-princ-to-string x))))
(defun _g (k e) (cdr (assoc k e)))
(defun _clean (s) (if s (vl-string-translate "\t\n\r" "   " s) ""))
(defun _w (lst) (write-line (apply 'strcat (cons (car lst) (mapcar '(lambda (x) (strcat T_ x)) (cdr lst)))) f))
(defun c:FPDUMP ( / f b ed e ss i ty pt xtra txt n tags lay fr mls nm d s2 e2 d2 lst)
  (setq f (open (getenv "FP_OUT") "w"))
  (foreach v '("ACADVER" "INSUNITS" "LUNITS" "LUPREC" "AUNITS" "MEASUREMENT" "LTSCALE" "PSLTSCALE" "MSLTSCALE" "CELTSCALE" "CANNOSCALE" "DIMSCALE" "DIMSTYLE" "TEXTSTYLE" "TEXTSIZE" "CMLEADERSTYLE" "CLAYER" "VISRETAIN" "PROJECTNAME" "LWDISPLAY" "ANNOALLVISIBLE" "TILEMODE" "CTAB" "EXTMIN" "EXTMAX" "PSTYLEMODE")
    (_w (list "SYS" v (_p (getvar v)))))
  (setq b (tblnext "BLOCK" T))
  (while b
    (cond
      ((_g 1 b) (_w (list "XREF" (_g 2 b) (_g 1 b) (strcat "flags=" (_p (_g 70 b))) (strcat "resolved=" (if (= 32 (logand 32 (_g 70 b))) "1" "0")))))
      ((and (/= (substr (_g 2 b) 1 1) "*") (= 0 (logand 16 (_g 70 b))))
        (setq n 0 tags "" e (tblobjname "BLOCK" (_g 2 b)))
        (while (setq e (entnext e)) (setq d (entget e)) (setq n (1+ n)) (if (= (_g 0 d) "ATTDEF") (setq tags (strcat tags (_g 2 d) ","))))
        (_w (list "BLOCK" (_g 2 b) (strcat "n=" (itoa n)) (strcat "atts=" tags)))))
    (setq b (tblnext "BLOCK")))
  (setq b (tblnext "LAYER" T))
  (while b
    (setq ed (entget (tblobjname "LAYER" (_g 2 b))))
    (_w (list "LAYER" (_g 2 b) (strcat "c=" (_p (_g 62 b))) (strcat "lt=" (_p (_g 6 b))) (strcat "fl=" (_p (_g 70 b))) (strcat "lw=" (_p (_g 370 ed))) (strcat "plot=" (_p (_g 290 ed))) (strcat "tc=" (_p (_g 420 ed)))))
    (setq b (tblnext "LAYER")))
  (setq b (tblnext "LTYPE" T))
  (while b (_w (list "LTYPE" (_g 2 b) (_clean (_g 3 b)))) (setq b (tblnext "LTYPE")))
  (setq b (tblnext "STYLE" T))
  (while b
    (_w (list "TSTYLE" (_g 2 b) (strcat "font=" (_p (_g 3 b))) (strcat "h=" (_p (_g 40 b))) (strcat "wf=" (_p (_g 41 b))) (strcat "obl=" (_p (_g 50 b)))))
    (setq b (tblnext "STYLE")))
  (setq b (tblnext "DIMSTYLE" T))
  (while b
    (setq ed (entget (tblobjname "DIMSTYLE" (_g 2 b))))
    (_w (list "DSTYLE" (_g 2 b) (strcat "scale=" (_p (_g 40 ed))) (strcat "asz=" (_p (_g 41 ed))) (strcat "txt=" (_p (_g 140 ed))) (strcat "gap=" (_p (_g 147 ed))) (strcat "dec=" (_p (_g 271 ed)))
      (strcat "tsty=" (if (_g 340 ed) (_p (_g 2 (entget (_g 340 ed)))) ""))))
    (setq b (tblnext "DIMSTYLE")))
  (setq nm nil)
  (foreach d (dictsearch (namedobjdict) "ACAD_MLEADERSTYLE")
    (cond ((= (car d) 3) (setq nm (cdr d)))
          ((and (= (car d) 350) nm)
            (setq ed (entget (cdr d)) mls (cons (cons (cdr d) nm) mls))
            (_w (list "MLSTYLE" nm (_clean (vl-princ-to-string (vl-remove-if '(lambda (x) (member (car x) '(-1 5 330 102 360 100))) ed))))))))
  (setq b (tblnext "VIEW" T))
  (while b (_w (list "VIEW" (_g 2 b))) (setq b (tblnext "VIEW")))
  (if (setq ss (ssget "X"))
    (repeat (setq i (sslength ss))
      (setq e (ssname ss (setq i (1- i))) ed (entget e) ty (_g 0 ed) pt (_g 10 ed) xtra nil txt "")
      (cond
        ((= ty "LINE") (setq xtra (list (strcat "p2=" (_p (_g 11 ed))))))
        ((= ty "LWPOLYLINE") (setq xtra (list (strcat "n=" (_p (_g 90 ed))) (strcat "closed=" (_p (logand 1 (_g 70 ed)))) (strcat "cw=" (_p (_g 43 ed)))
          (strcat "v=" (apply 'strcat (mapcar '(lambda (x) (if (= (car x) 10) (strcat (rtos (cadr x) 2 3) "," (rtos (caddr x) 2 3) ";") "")) ed))))))
        ((member ty '("CIRCLE" "ARC")) (setq xtra (list (strcat "r=" (_p (_g 40 ed))) (strcat "a0=" (_p (_g 50 ed))) (strcat "a1=" (_p (_g 51 ed))))))
        ((= ty "TEXT") (setq xtra (list (strcat "style=" (_p (_g 7 ed))) (strcat "h=" (_p (_g 40 ed))) (strcat "rot=" (_p (_g 50 ed))) (strcat "wf=" (_p (_g 41 ed))) (strcat "j=" (_p (_g 72 ed)) "/" (_p (_g 73 ed))) (strcat "p2=" (_p (_g 11 ed)))) txt (_g 1 ed)))
        ((= ty "MTEXT") (setq xtra (list (strcat "style=" (_p (_g 7 ed))) (strcat "h=" (_p (_g 40 ed))) (strcat "att=" (_p (_g 71 ed))) (strcat "w=" (_p (_g 41 ed))) (strcat "rot=" (_p (_g 50 ed))) (strcat "mask=" (_p (_g 90 ed)))) txt (_g 1 ed)))
        ((= ty "MULTILEADER")
          (setq lst nil fl nil)
          (foreach x ed (cond ((and (= (car x) 304) (= (cdr x) "LEADER_LINE{")) (setq fl T)) ((and fl (= (car x) 10)) (setq lst (cons (cdr x) lst) fl nil))))
          (setq xtra (list (strcat "style=" (_p (vl-some '(lambda (x) (if (= (car x) 340) (cdr (assoc (cdr x) mls)))) ed))) (strcat "h=" (_p (_g 41 ed)))
                (strcat "arrows=" (apply 'strcat (mapcar '(lambda (q) (strcat (rtos (car q) 2 3) "," (rtos (cadr q) 2 3) ";")) (reverse lst)))) (strcat "txtpt=" (_p (_g 12 ed))))
                txt (_p (_g 304 ed)) pt (if lst (car (reverse lst)) pt)))
        ((= ty "DIMENSION") (setq pt (_g 13 ed) xtra (list (strcat "style=" (_p (_g 3 ed))) (strcat "dtype=" (_p (_g 70 ed))) (strcat "meas=" (_p (_g 42 ed))) (strcat "p2=" (_p (_g 14 ed))) (strcat "tm=" (_p (_g 11 ed)))) txt (_p (_g 1 ed))))
        ((= ty "INSERT")
          (setq s2 "")
          (if (= 1 (_g 66 ed))
            (progn (setq e2 (entnext e))
              (while (and e2 (= (_g 0 (setq d2 (entget e2))) "ATTRIB"))
                (setq s2 (strcat s2 (_g 2 d2) "=" (_clean (_g 1 d2)) ";") e2 (entnext e2)))))
          (setq xtra (list (strcat "block=" (_p (_g 2 ed))) (strcat "sx=" (_p (_g 41 ed))) (strcat "sy=" (_p (_g 42 ed))) (strcat "rot=" (_p (_g 50 ed))) (strcat "atts=" s2))))
        ((= ty "HATCH") (setq xtra (list (strcat "pattern=" (_p (_g 2 ed))) (strcat "pscale=" (_p (_g 41 ed))) (strcat "solid=" (_p (_g 70 ed))))))
        ((= ty "VIEWPORT")
          (setq fr "")
          (foreach x ed (if (= (car x) 331) (setq fr (strcat fr (_g 2 (entget (cdr x))) ";"))))
          (_w (list "VPORT" (_p (_g 410 ed)) (strcat "h=" (_p (_g 5 ed))) (strcat "psctr=" (_p (_g 10 ed))) (strcat "w=" (_p (_g 40 ed))) (strcat "ht=" (_p (_g 41 ed)))
            (strcat "viewctr=" (_p (_g 12 ed))) (strcat "viewht=" (_p (_g 45 ed))) (strcat "twist=" (_p (_g 51 ed)))
            (strcat "scale=1:" (if (and (_g 41 ed) (> (_g 41 ed) 0)) (rtos (/ (_g 45 ed) (_g 41 ed)) 2 3) "?")) (strcat "status=" (_p (_g 90 ed))) (strcat "layer=" (_p (_g 8 ed))) (strcat "target=" (_p (_g 17 ed))) (strcat "frozen=" fr)))))
      (_w (append (list "ENT" (if (_g 410 ed) (_g 410 ed) "Model") ty (_p (_g 5 ed)) (_p (_g 8 ed)) (strcat "c=" (_p (_g 62 ed))) (strcat "lt=" (_p (_g 6 ed))) (strcat "lw=" (_p (_g 370 ed))) (strcat "lts=" (_p (_g 48 ed))) (strcat "tc=" (_p (_g 420 ed)))
        (strcat "x=" (_p (car pt))) (strcat "y=" (_p (cadr pt)))) xtra (list (strcat "txt=" (_clean txt)))))))
  (foreach d (dictsearch (namedobjdict) "ACAD_LAYOUT")
    (if (= (car d) 350)
      (progn (setq ed (entget (cdr d)))
        (_w (list "LAYOUT" (_p (_g 1 (member '(100 . "AcDbLayout") ed))) (strcat "tab=" (_p (_g 71 ed))) (strcat "setup=" (_p (_g 1 ed))) (strcat "device=" (_p (_g 2 ed))) (strcat "paper=" (_p (_g 4 ed)))
          (strcat "ctb=" (_p (_g 7 ed))) (strcat "pw=" (_p (_g 44 ed))) (strcat "ph=" (_p (_g 45 ed))) (strcat "units=" (_p (_g 72 ed))) (strcat "rot=" (_p (_g 73 ed)))
          (strcat "ptype=" (_p (_g 74 ed))) (strcat "num=" (_p (_g 142 ed))) (strcat "den=" (_p (_g 143 ed))))))))
  (close f)
  (princ))
FPDUMP
'@
Set-Content -Encoding ASCII $scr $lisp
$env:FP_OUT = $tmpOut
& $acc.FullName /i $copy /s $scr /l en-US 2>&1 | Out-Null
if (-not (Test-Path $tmpOut)) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue; throw "Core Console produced no fingerprint for $Dwg" }
New-Item -ItemType Directory -Force (Split-Path $Out -Parent) | Out-Null
Move-Item $tmpOut $Out -Force
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
$Out
