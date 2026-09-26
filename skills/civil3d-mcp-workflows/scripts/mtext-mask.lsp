;; Background mask on MTEXT by handle (the plugin has no mask option yet), as the package's street and
;; property labels have it: DXF 90=3 (fill + drawing background colour), 63=256, 45=border offset factor.
;; Core Console cannot (load) from untrusted folders (SECURELOAD): inline this text in the .scr, preceded by
;;   (setq *mask-list* '(("12C4E" 1.2) ("12C54" 1.0)) *mask-out* "C:/path/mask.txt")
;; and followed by  (command "_.QSAVE")  QUIT
(setq _f (open *mask-out* "w") _m 0)
(foreach _pair *mask-list*
  (setq _e (handent (car _pair)))
  (if (and _e (= (cdr (assoc 0 (entget _e))) "MTEXT"))
    (progn
      (setq _d (vl-remove-if '(lambda (p) (member (car p) '(90 63 45 441))) (entget _e)))
      (entmod (append _d (list (cons 90 3) (cons 63 256) (cons 45 (cadr _pair)) (cons 441 0))))
      (setq _m (1+ _m)))
    (write-line (strcat "SKIP " (car _pair)) _f)))
(write-line (strcat "MASKED " (itoa _m)) _f)
(close _f)
