"""AS-BUILT REVIEW SHEET: one local HTML page to confirm what the OCR read from scanned as-builts, before any value reaches a drawing.

    python asbuilt-review.py --assoc <scan.assoc.json> [--assoc <other.assoc.json> ...] --out <review.html> [--pad 40]

For every item of the asbuilt-associate.mjs output that carries data (RIM, INV, N/E, station, pipe, slope) it shows the CROP of the
scan next to the parsed values, the X-UTIL association (match / near / none, with the suggested X-UTIL N/E for sewer nodes) and the
issues. Every value is an editable field; each row is Confirm / Skip. "Export" downloads asbuilt.confirmed.json with ONLY the confirmed
rows (values as edited) - the file that the label generator consumes. As-builts are always scans: never use an unconfirmed OCR number.
Self-contained (crops embedded as base64 PNG), opens from disk in any browser; nothing is uploaded. Needs Pillow.
"""
import argparse, base64, html, io, json, os
from datetime import date
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ap = argparse.ArgumentParser()
ap.add_argument("--assoc", action="append", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--pad", type=int, default=40)
a = ap.parse_args()

rows = []
for path in a.assoc:
    doc = json.load(open(path, encoding="utf-8"))
    scan = doc["scan"]
    im = Image.open(scan).convert("L")
    for i, it in enumerate(doc["items"]):
        has = it.get("rim") is not None or it.get("inv") or it.get("N") is not None or it.get("pipe") or it.get("slope") is not None
        if not has:
            continue
        b = it["box"]
        x0, y0 = max(0, int(b["x"] - a.pad)), max(0, int(b["y"] - a.pad))
        x1, y1 = min(im.width, int(b["x"] + b["w"] + a.pad * 6)), min(im.height, int(b["y"] + b["h"] + a.pad))
        crop = im.crop((x0, y0, x1, y1))
        if crop.width > 520:
            crop = crop.resize((520, max(1, int(crop.height * 520 / crop.width))))
        buf = io.BytesIO(); crop.save(buf, "PNG")
        rows.append({"scan": os.path.basename(scan), "idx": i, "it": it, "img": base64.b64encode(buf.getvalue()).decode()})

def val(v):
    return "" if v is None else html.escape(str(v), quote=True)

def mh_id(text):
    import re
    m = re.search(r"MH\s*#\s*(\d+)", text or "", re.I)
    return f"MH#{m.group(1)}" if m else ""

def inv_text(inv):
    return "; ".join(f"{x['value']}" + (f" ({','.join(x['dirs'])})" if x.get("dirs") else "") for x in (inv or []))

trs = []
for n, r in enumerate(rows):
    it = r["it"]; asc = it.get("assoc") or {}
    st = asc.get("status", "-")
    sug = asc.get("suggested")
    sug_html = f'<div class="sug">X-UTIL: N {sug["N"]} E {sug["E"]} <button type="button" onclick="useSug({n},{sug["N"]},{sug["E"]})">usar</button></div>' if sug else ""
    issues = "".join(f"<li>{html.escape(s)}</li>" for s in it.get("issues", []))
    trs.append(f"""
<tr id="r{n}" class="st-{st}" data-scan="{val(r['scan'])}" data-idx="{r['idx']}">
 <td class="n">{n + 1}<br><small>{val(r['scan'])}</small></td>
 <td><img src="data:image/png;base64,{r['img']}" alt="crop"></td>
 <td class="f">
  <label>Nombre <input name="id" value="{val(mh_id(it.get('text', '')))}" placeholder="MH#5"></label>
  <label>Tipo <input name="kind" value="{val(it.get('kind'))}"></label>
  <label>RIM <input name="rim" value="{val(it.get('rim'))}"></label>
  <label>INV <input name="inv" value="{val(inv_text(it.get('inv')))}" placeholder="2.15 (E,W,S)"></label>
  <label>N <input name="N" value="{val(it.get('N'))}"></label>
  <label>E <input name="E" value="{val(it.get('E'))}"></label>
  <label>STA <input name="sta" value="{val(it.get('sta'))}"> <input name="baseline" class="s" value="{val(it.get('baseline'))}"></label>
  <label>O/S <input name="offset" class="s" value="{val(it.get('offset'))}"> <input name="side" class="s" value="{val(it.get('side'))}"></label>
  <label>Tubo <input name="pipe" value="{val(it.get('pipe'))}"> % <input name="slope" class="s" value="{val(it.get('slope'))}"></label>
 </td>
 <td class="a"><b class="badge">{html.escape(st)}</b> {val(asc.get('feature'))} {val(asc.get('distanceFt'))}{' ft' if asc.get('distanceFt') is not None else ''}
  <div class="src">N/E: {val(it.get('source'))}</div>{sug_html}<ul>{issues}</ul>
  <div class="txt">{html.escape(it.get('text', ''))[:220]}</div></td>
 <td class="c"><label><input type="radio" name="d{n}" value="ok"> Confirmar</label><br><label><input type="radio" name="d{n}" value="skip" checked> Omitir</label></td>
</tr>""")

page = f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revisión de as-builts</title>
<style>
:root{{--bg:#fff;--fg:#1d1d1f;--mut:#666;--line:#ddd;--ok:#e6f4ea;--near:#fff4d6;--none:#fbe9e9}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151515;--fg:#eee;--mut:#aaa;--line:#333;--ok:#173b24;--near:#3d3215;--none:#3d1a1a}}}}
body{{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,Segoe UI,Arial}}
h1{{font-size:20px;margin:0 0 4px}} p{{color:var(--mut);margin:0 0 12px}}
table{{border-collapse:collapse;width:100%}} td{{border-top:1px solid var(--line);vertical-align:top;padding:8px}}
img{{max-width:520px;width:100%;background:#fff;border:1px solid var(--line)}}
.f label{{display:block;margin:2px 0}} input{{font:inherit;width:9em;background:transparent;color:inherit;border:1px solid var(--line);padding:1px 4px}}
input.s{{width:4em}} .st-match{{background:var(--ok)}} .st-near{{background:var(--near)}} .st-none{{background:var(--none)}}
.badge{{text-transform:uppercase}} .txt,.src{{color:var(--mut);font-size:12px}} ul{{margin:4px 0;padding-left:18px}}
.bar{{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);margin-bottom:8px;z-index:1}}
button{{font:inherit;padding:4px 12px;cursor:pointer}}
</style></head><body>
<div class="bar"><h1>Revisión de as-builts ({len(rows)} elementos)</h1>
<p>Verde = coincide con el X-UTIL · amarillo = revisar (posible error del OCR) · rojo = no está en el X-UTIL. Corrige lo que haga falta,
marca <b>Confirmar</b> y exporta. Solo lo confirmado se usa para las etiquetas.</p>
<button onclick="exportJson()">Exportar confirmados (asbuilt.confirmed.json)</button> <span id="cnt"></span></div>
<table>{''.join(trs)}</table>
<script>
function useSug(n,N,E){{const r=document.getElementById('r'+n);r.querySelector('[name=N]').value=N;r.querySelector('[name=E]').value=E;}}
function num(v){{const x=parseFloat(String(v).replace(',','.'));return Number.isFinite(x)?x:null;}}
function inv(v){{return String(v||'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>{{const m=/(-?[0-9.]+)\\s*(?:\\(([^)]*)\\))?/.exec(s);return m?{{value:num(m[1]),dirs:(m[2]||'').split(',').map(d=>d.trim()).filter(Boolean)}}:null}}).filter(Boolean);}}
function exportJson(){{
 const out=[];document.querySelectorAll('tr[id^=r]').forEach(r=>{{const n=r.id.slice(1);if(!r.querySelector('input[name=d'+n+']:checked')||r.querySelector('input[name=d'+n+']:checked').value!=='ok')return;
  const g=k=>r.querySelector('[name='+k+']').value.trim();
  out.push({{scan:r.dataset.scan,item:+r.dataset.idx,id:g('id')||null,kind:g('kind')||null,rim:num(g('rim')),inv:inv(g('inv')),N:num(g('N')),E:num(g('E')),
   sta:num(g('sta')),baseline:g('baseline')||null,offset:num(g('offset')),side:g('side')||null,pipe:g('pipe')||null,slope:num(g('slope'))}});}});
 const blob=new Blob([JSON.stringify({{confirmedAt:new Date().toISOString(),items:out}},null,1)],{{type:'application/json'}});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='asbuilt.confirmed.json';a.click();
 document.getElementById('cnt').textContent=out.length+' confirmado(s) exportado(s)';}}
</script></body></html>"""
open(a.out, "w", encoding="utf-8").write(page)
print(f"{len(rows)} row(s) -> {a.out}")
