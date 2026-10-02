"""AS-BUILT REVIEW SHEET: one local HTML page to confirm what the OCR read from scanned as-builts, before any value reaches a drawing.

    python asbuilt-review.py --assoc <scan.assoc.json> [--assoc <other.assoc.json> ...] --out <review.html> [--pad 40] [--pad-bottom 150]

For every item of the asbuilt-associate.mjs output that carries data (RIM, INV, N/E, station, pipe, slope, or a keyword: TEE, G.V., C.V., PLUG,
CORP. STOP, CPO#, CLEAN OUT, F.H.) it shows the CROP of the scan (tall enough to include the whole callout: MH callouts print RIM / INV / N / E BELOW the
first line) next to the parsed values, the X-UTIL association (match / near / none, with the suggested X-UTIL N/E for sewer nodes) and the issues.
Every value is an editable field; each row is Confirm / Skip. "Export" downloads asbuilt.confirmed.json with ONLY the confirmed rows (values as edited).

REQUIRED FIELDS (2026-10-02, after the VILLA ONE review lost RIM/INV/IDs because the OCR splits callouts into fragments): a confirmed row must be COMPLETE for
its kind, otherwise its missing fields turn red and "Exportar" is blocked with the list of what is missing:
  MH              Nombre (MH#n), RIM, INV with value + directions, N, E
  PIPE            Tubo (size + material), % pendiente   (Longitud ft is optional but lets the label generator tie the callout to its tramo; the OCR often drops "337'-")
  TEE/GV/CV/PLUG/CORP/CPO/LATERAL/SERVICE   Etiqueta, and a position: N+E or STA+línea base (lateral callouts print only the station)
  FH              N, E
"Unir con fila nº" merges a fragment into another row (the OCR splits one callout in several items: the one with the name, the one with the INV...): on export
the fragment's filled fields complete the target row and the fragment is not exported. The page also lists X-UTIL manholes that nobody confirmed.
Keyword suggestions (kind / label / station text / detail) are pre-filled in blue: they are only a guess from a noisy OCR, check them against the crop.
As-builts are always scans: never use an unconfirmed OCR number. Self-contained (crops embedded as base64 PNG), opens from disk in any browser; nothing is
uploaded. Needs Pillow.
"""
import argparse, base64, html, io, json, os, re
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ap = argparse.ArgumentParser()
ap.add_argument("--assoc", action="append", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--pad", type=int, default=40)
ap.add_argument("--pad-bottom", type=int, default=150, help="extra scan pixels below the OCR box (MH callouts continue with RIM / INV / N / E)")
a = ap.parse_args()

KEYWORDS = re.compile(r"\bTEE\b|G\.?\s?V\b|C\.?\s?V\b|\bPLUG\b|CORP|CPO\s*#|CLEAN\s*OUT|\bF\.?\s?H\b", re.I)
APP_KINDS = ["TEE", "GV", "CV", "PLUG", "CORP", "CPO", "LATERAL", "SERVICE"]
ALL_KINDS = ["MH", "PIPE", "FH"] + APP_KINDS


def flat(text):
    return re.sub(r"\s+", " ", (text or "").replace("|", " ")).strip()


def suggest(it):
    """Keyword guess of kind / label / station text / detail from the OCR text (noisy: shown pre-filled in blue, the user checks it on the crop)."""
    t = flat(it.get("text", ""))
    u = t.upper()
    out = {}
    sta = re.search(r"STA\.?\s*(\d+\s*\+\s*\d+(?:\.\d+)?)\s*([A-C])?", u)
    off = re.search(r"(\d+(?:\.\d+)?)\s*['’]?\s*O/?S\s*\(?\s*([RL])", u)
    station = (f"STA.{sta.group(1).replace(' ', '')}" + (f" {sta.group(2)}" if sta.group(2) else "")) if sta else ""
    if off: station += (", " if station else "") + f"{off.group(1)}' O/S ({off.group(2)})"
    if re.search(r"SEWER\s*LATERAL|CLEAN\s*OUT", u) and re.search(r"6\s*[\"”]\s*PVC", u):
        out = dict(kind="LATERAL", label='6" PVC (SDR-35) SAN. SEWER LATERAL', detail='SLOPE ?"/FT W/ 6" PVC CLEAN OUT (TYP.)' if "CLEAN" in u else "")
    elif (m := re.search(r"(\d+)\s*[\"”]?\s*X\s*(\d+)\s*[\"”]?\s*TEE", u)):
        out = dict(kind="TEE", label=f'{m.group(1)}"x{m.group(2)}" TEE')
    elif "TEE" in u:
        out = dict(kind="TEE", label='?"x?" TEE')
    elif re.search(r"G\.?\s?V\b", u):
        m = re.search(r"(\d+)\s*[\"”]\s*G\.?\s?V", u)
        out = dict(kind="GV", label=f'{m.group(1)}" G.V.' if m else '?" G.V.')
    elif re.search(r"\bC\.?\s?V\b", u):
        m = re.search(r"(\d+)\s*[\"”]\s*C\.?\s?V", u)
        out = dict(kind="CV", label=f'{m.group(1)}" C.V.' if m else '?" C.V.')
    elif "PLUG" in u:
        m = re.search(r"(\d+)\s*[\"”]\s*PLUG", u)
        out = dict(kind="PLUG", label=f'{m.group(1)}" PLUG' if m else '?" PLUG')
    elif "CORP" in u:
        m = re.search(r"(\d+)\s*[\"”]\s*CORP", u)
        out = dict(kind="CORP", label=f'{m.group(1)}" CORP. STOP' if m else '?" CORP. STOP')
    elif (m := re.search(r"CPO\s*#?\s*(\d+)", u)):
        out = dict(kind="CPO", label=f"CPO#{m.group(1)}" + (" FND N&D" if "FND" in u or "N&D" in u else ""))
    elif re.search(r"\bF\.?\s?H\b", u):
        out = dict(kind="FH")
    if out and out.get("kind") in APP_KINDS and station: out["stationText"] = station
    return out


rows = []
for path in a.assoc:
    doc = json.load(open(path, encoding="utf-8"))
    scan = doc["scan"]
    im = Image.open(scan).convert("L")
    for i, it in enumerate(doc["items"]):
        has = (it.get("rim") is not None or it.get("inv") or it.get("N") is not None or it.get("pipe") or it.get("slope") is not None
               or KEYWORDS.search(it.get("text", "") or ""))
        if not has:
            continue
        b = it["box"]
        x0, y0 = max(0, int(b["x"] - a.pad)), max(0, int(b["y"] - a.pad))
        x1, y1 = min(im.width, int(b["x"] + b["w"] + a.pad * 6)), min(im.height, int(b["y"] + b["h"] + a.pad_bottom))
        crop = im.crop((x0, y0, x1, y1))
        if crop.width > 520:
            crop = crop.resize((520, max(1, int(crop.height * 520 / crop.width))))
        buf = io.BytesIO(); crop.save(buf, "PNG")
        rows.append({"scan": os.path.basename(scan), "idx": i, "it": it, "img": base64.b64encode(buf.getvalue()).decode(), "sug": suggest(it)})


def val(v):
    return "" if v is None else html.escape(str(v), quote=True)


def mh_id(text):
    m = re.search(r"MH\s*#\s*(\d+)", text or "", re.I)
    return f"MH#{m.group(1)}" if m else ""


def inv_text(inv):
    return "; ".join(f"{x['value']}" + (f" ({','.join(x['dirs'])})" if x.get("dirs") else "") for x in (inv or []))


# rows that came from the SAME callout (asbuilt-extract.mjs `callout` id): shown together so the user sees which fragments belong to one structure / assembly
by_callout = {}
for n, r in enumerate(rows):
    c = r["it"].get("callout")
    if c is not None: by_callout.setdefault((r["scan"], c), []).append(n + 1)

trs = []
for n, r in enumerate(rows):
    it, sug = r["it"], r["sug"]
    mates = [m for m in by_callout.get((r["scan"], it.get("callout")), []) if m != n + 1]
    callout_html = (f'<br><small class="co">misma callout: fila{"s" if len(mates) > 1 else ""} ' + ", ".join(f'<a href="#r{m - 1}">{m}</a>' for m in mates) + "</small>") if mates else ""
    if it.get("mergedFrom"): callout_html += f'<br><small class="co">{it["mergedFrom"]} fragmentos OCR ya unidos</small>'
    asc = it.get("assoc") or {}
    st = asc.get("status", "-")
    s_ = asc.get("suggested")
    sug_html = (f'<div class="sug">X-UTIL: N {s_["N"]} E {s_["E"]} '
                f'<button type="button" onclick="useSug({n},{s_["N"]},{s_["E"]})">usar</button></div>') if s_ else ""
    issues = "".join(f"<li>{html.escape(s)}</li>" for s in it.get("issues", []))
    kind0 = it.get("kind") or sug.get("kind") or ""
    kind_cls = "" if it.get("kind") else (" sg" if sug.get("kind") else "")

    def sg(key):          # suggested (blue) prefill for a field that has no OCR value
        v = sug.get(key)
        return (val(v), " sg" if v else "")

    lab_v, lab_c = sg("label"); stn_v, stn_c = sg("stationText"); det_v, det_c = sg("detail")
    trs.append(f"""
<tr id="r{n}" class="st-{st}" data-scan="{val(r['scan'])}" data-idx="{r['idx']}">
 <td class="n">{n + 1}<br><small>{val(r['scan'])}</small>{callout_html}</td>
 <td><img src="data:image/png;base64,{r['img']}" alt="crop"></td>
 <td class="f">
  <label>Tipo <input name="kind" list="kinds" class="{kind_cls.strip()}" value="{val(kind0)}" placeholder="MH, PIPE, TEE…"></label>
  <label>Nombre <input name="id" value="{val(mh_id(it.get('text', '')))}" placeholder="MH#5"></label>
  <label>RIM <input name="rim" value="{val(it.get('rim'))}"></label>
  <label>INV <input name="inv" value="{val(inv_text(it.get('inv')))}" placeholder="2.15 (E,W,S)"></label>
  <label>N <input name="N" value="{val(it.get('N'))}"></label>
  <label>E <input name="E" value="{val(it.get('E'))}"></label>
  <label>STA <input name="sta" value="{val(it.get('sta'))}"> <input name="baseline" class="s" value="{val(it.get('baseline'))}"></label>
  <label>O/S <input name="offset" class="s" value="{val(it.get('offset'))}"> <input name="side" class="s" value="{val(it.get('side'))}"></label>
  <label>Tubo <input name="pipe" value="{val(it.get('pipe'))}"> % <input name="slope" class="s" value="{val(it.get('slope'))}"> ft <input name="lengthFt" class="s" value="" placeholder="337"></label>
  <label>Etiqueta <input name="label" class="w{lab_c}" value="{lab_v}" placeholder='8"x6" TEE'></label>
  <label>Estación <input name="stationText" class="w{stn_c}" value="{stn_v}" placeholder="STA.12+44.8 C, 8' O/S (R)"></label>
  <label>Detalle <input name="detail" class="w{det_c}" value="{det_v}" placeholder='SLOPE 1/8"/FT W/ 6" PVC CLEAN OUT (TYP.)'></label>
  <label>Unir con fila nº <input name="mergeInto" class="s" value="" placeholder="12"></label>
  <div class="need" id="need{n}"></div>
 </td>
 <td class="a"><b class="badge">{html.escape(st)}</b> {val(asc.get('feature'))} {val(asc.get('distanceFt'))}{' ft' if asc.get('distanceFt') is not None else ''}
  <div class="src">N/E: {val(it.get('source'))}</div>{sug_html}<ul>{issues}</ul>
  <div class="txt">{html.escape(it.get('text', ''))[:260]}</div></td>
 <td class="c"><label><input type="radio" name="d{n}" value="ok"> Confirmar</label><br><label><input type="radio" name="d{n}" value="skip" checked> Omitir</label></td>
</tr>""")

CSS = """
:root{--bg:#fff;--fg:#1d1d1f;--mut:#666;--line:#ddd;--ok:#e6f4ea;--near:#fff4d6;--none:#fbe9e9;--bad:#d93025;--sg:#1a56db}
@media (prefers-color-scheme:dark){:root{--bg:#151515;--fg:#eee;--mut:#aaa;--line:#333;--ok:#173b24;--near:#3d3215;--none:#3d1a1a;--bad:#ff6b5e;--sg:#7aa7ff}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,Segoe UI,Arial}
h1{font-size:20px;margin:0 0 4px} p{color:var(--mut);margin:0 0 12px}
table{border-collapse:collapse;width:100%} td{border-top:1px solid var(--line);vertical-align:top;padding:8px}
img{max-width:520px;width:100%;background:#fff;border:1px solid var(--line)}
.f label{display:block;margin:2px 0} input{font:inherit;width:9em;background:transparent;color:inherit;border:1px solid var(--line);padding:1px 4px}
input.s{width:4em} input.w{width:22em} input.sg{color:var(--sg);font-style:italic}
.st-match{background:var(--ok)} .st-near{background:var(--near)} .st-none{background:var(--none)}
.badge{text-transform:uppercase} .txt,.src{color:var(--mut);font-size:12px} ul{margin:4px 0;padding-left:18px}
.bar{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);margin-bottom:8px;z-index:2}
button{font:inherit;padding:4px 12px;cursor:pointer}
input.bad{border:2px solid var(--bad);background:rgba(217,48,37,.10)} tr.bad td.f{outline:2px solid var(--bad);outline-offset:-2px}
.co{color:var(--sg)}
.need{color:var(--bad);font-size:12px;font-weight:600;margin-top:4px} .need.okk{color:var(--mut);font-weight:400}
#problems{display:none;color:var(--bad);border:2px solid var(--bad);padding:6px 10px;margin:8px 0;max-height:30vh;overflow:auto} #problems li{cursor:pointer}
#unconf{display:none;color:var(--mut);border:1px dashed var(--line);padding:6px 10px;margin:8px 0}
"""

JS = r"""
const KINDS_APP=['TEE','GV','CV','PLUG','CORP','CPO','LATERAL','SERVICE'];
function useSug(n,N,E){const r=document.getElementById('r'+n);r.querySelector('[name=N]').value=N;r.querySelector('[name=E]').value=E;check();}
function num(v){const x=parseFloat(String(v).replace(',','.'));return Number.isFinite(x)?x:null;}
function inv(v){return String(v||'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>{const m=/(-?[0-9.]+)\s*(?:\(([^)]*)\))?/.exec(s);return m?{value:num(m[1]),dirs:(m[2]||'').split(',').map(d=>d.trim().toUpperCase()).filter(Boolean)}:null}).filter(Boolean);}
const FIELDS=['kind','id','rim','inv','N','E','sta','baseline','offset','side','pipe','slope','lengthFt','label','stationText','detail','mergeInto'];
function rowData(r){const g=k=>r.querySelector('[name='+k+']').value.trim();
 return {n:+r.id.slice(1),scan:r.dataset.scan,item:+r.dataset.idx,kind:g('kind').toUpperCase()||null,id:g('id')||null,rim:num(g('rim')),inv:inv(g('inv')),N:num(g('N')),E:num(g('E')),
  sta:num(g('sta')),baseline:g('baseline').toUpperCase()||null,offset:num(g('offset')),side:g('side').toUpperCase()||null,pipe:g('pipe')||null,slope:num(g('slope')),
  lengthFt:num(g('lengthFt')),label:g('label')||null,stationText:g('stationText')||null,detail:g('detail')||null,merge:num(g('mergeInto'))};}
function merged(rows){ // fragments with "Unir con fila nº" complete their target and disappear
 const by=new Map(rows.map(x=>[x.n,x]));const out=[];
 rows.forEach(x=>{ if(x.merge&&by.has(x.merge-1)&&x.merge-1!==x.n){const t=by.get(x.merge-1);
   for(const k of FIELDS){ if(k==='mergeInto')continue; const v=x[k]; if(v==null||v===''||(Array.isArray(v)&&!v.length))continue; if(t[k]==null||t[k]===''||(Array.isArray(t[k])&&!t[k].length)) t[k]=v; }
   t._from=(t._from||[]).concat([x.n+1]); x._gone=true; }});
 rows.forEach(x=>{ if(!x._gone) out.push(x); }); return out; }
function effKind(x){return x.kind|| (x.rim!=null||x.inv.length ? 'MH' : (x.pipe||x.slope!=null ? 'PIPE' : ''));}
function missing(x){const k=effKind(x),m=[];
 if(k==='MH'){ if(!x.id)m.push('id'); if(x.rim==null)m.push('rim'); if(!x.inv.length||x.inv.some(v=>v.value==null))m.push('inv'); else if(x.inv.some(v=>!v.dirs.length))m.push('inv'); if(x.N==null)m.push('N'); if(x.E==null)m.push('E'); }
 else if(k==='PIPE'){ if(!x.pipe)m.push('pipe'); if(x.slope==null)m.push('slope'); }
 else if(k==='FH'){ if(x.N==null)m.push('N'); if(x.E==null)m.push('E'); }
 else if(KINDS_APP.includes(k)){ if(!x.label||/\?/.test(x.label))m.push('label'); const pos=(x.N!=null&&x.E!=null)||(x.sta!=null&&x.baseline); if(!pos){m.push('N');m.push('E');m.push('sta');m.push('baseline');} }
 return m;}
const NAMES={id:'Nombre',rim:'RIM',inv:'INV (valor + direcciones)',N:'N',E:'E',pipe:'Tubo',slope:'% pendiente',label:'Etiqueta (sin «?»)',sta:'STA',baseline:'línea base'};
function check(){
 const trs=[...document.querySelectorAll('tr[id^=r]')];
 trs.forEach(r=>{r.classList.remove('bad');r.querySelectorAll('input').forEach(i=>i.classList.remove('bad'));document.getElementById('need'+r.id.slice(1)).textContent='';});
 const raw=trs.map(rowData);const bad=[];let okN=0;
 const confirmed=raw.filter(x=>document.querySelector('input[name=d'+x.n+']:checked').value==='ok');
 const rows=merged(confirmed.map(x=>({...x})));
 rows.forEach(x=>{const m=missing(x);okN++;
   const r=document.getElementById('r'+x.n);
   (x._from||[]).forEach(f=>{const rr=document.getElementById('r'+(f-1));if(rr)document.getElementById('need'+(f-1)).textContent='→ se une a la fila '+(x.n+1);});
   if(m.length){bad.push({n:x.n,m});r.classList.add('bad');
     // red inputs: on the row itself, or on its merge target when the fields live there
     m.forEach(k=>{const el=r.querySelector('[name='+({sta:'sta',baseline:'baseline'}[k]||k)+']');if(el&&(x.merge==null))el.classList.add('bad');});
     document.getElementById('need'+x.n).textContent='Faltan: '+[...new Set(m)].map(k=>NAMES[k]||k).join(', ');}
   else if(effKind(x)) document.getElementById('need'+x.n).classList.add('okk'),document.getElementById('need'+x.n).textContent='✔ completo ('+effKind(x)+')'+((x._from||[]).length?' + filas '+x._from.join(','):'');});
 const box=document.getElementById('problems');
 if(bad.length){box.style.display='block';box.innerHTML='<b>Faltan datos obligatorios en '+bad.length+' fila(s) confirmada(s) — no se puede exportar:</b><ul>'+bad.map(b=>'<li onclick="document.getElementById(\'r'+b.n+'\').scrollIntoView({block:\'center\'})">Fila '+(b.n+1)+': '+[...new Set(b.m)].map(k=>NAMES[k]||k).join(', ')+'</li>').join('')+'</ul>';}
 else box.style.display='none';
 // X-UTIL manholes nobody confirmed: rows of kind MH (or with a RIM) that were left on "Omitir"
 const skipped=raw.filter(x=>!confirmed.includes(x)&&(effKind(x)==='MH'));
 const u=document.getElementById('unconf');
 if(skipped.length){u.style.display='block';u.innerHTML='Filas de manhole sin confirmar (Omitir): '+skipped.map(x=>'<a href="#r'+x.n+'">'+(x.n+1)+'</a>').join(', ')+'. Si están dentro de la hoja, confírmalas: el QC da FAIL si un MH visible no tiene RIM e INV.';}
 else u.style.display='none';
 document.getElementById('cnt').textContent=rows.length+' elemento(s) confirmado(s)'+(bad.length?' · '+bad.length+' incompleto(s)':'');
 document.getElementById('exp').disabled=bad.length>0||rows.length===0;
 return {rows,bad};}
function exportJson(){
 const {rows,bad}=check(); if(bad.length||!rows.length)return;
 const out=rows.map(x=>{const o={scan:x.scan,item:x.item,id:x.id,kind:effKind(x)||null,rim:x.rim,inv:x.inv,N:x.N,E:x.E,sta:x.sta,baseline:x.baseline,offset:x.offset,side:x.side,pipe:x.pipe,slope:x.slope};
   if(x.lengthFt!=null)o.lengthFt=x.lengthFt; if(x.label)o.label=x.label; if(x.stationText)o.stationText=x.stationText; if(x.detail)o.detail=x.detail; if(x.kind==='CPO')o.noExist=true; return o;});
 const blob=new Blob([JSON.stringify({confirmedAt:new Date().toISOString(),simulated:false,confirmedBy:'revision-asbuilts.html (usuario)',items:out},null,1)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='asbuilt.confirmed.json';a.click();
 document.getElementById('cnt').textContent=out.length+' confirmado(s) exportado(s)';}
document.addEventListener('input',check);document.addEventListener('change',check);window.addEventListener('load',check);
"""

page = ("<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>Revisión de as-builts</title><style>" + CSS + "</style></head><body>"
        f"<div class=\"bar\"><h1>Revisión de as-builts ({len(rows)} elementos)</h1>"
        "<p>Verde = coincide con el X-UTIL · amarillo = revisar (posible error del OCR) · rojo = no está en el X-UTIL. Azul cursiva = sugerencia automática: compárala con el recorte. "
        "Marca <b>Confirmar</b>: cada fila confirmada debe quedar <b>completa</b> (campos en rojo = obligatorios que faltan; usa «Unir con fila nº» si el dato está en otro fragmento del mismo callout). "
        "Solo lo confirmado y completo se exporta.</p>"
        "<button id=\"exp\" onclick=\"exportJson()\">Exportar confirmados (asbuilt.confirmed.json)</button> <span id=\"cnt\"></span>"
        "<div id=\"problems\"></div><div id=\"unconf\"></div></div>"
        "<datalist id=\"kinds\">" + "".join(f"<option value=\"{k}\">" for k in ALL_KINDS) + "</datalist>"
        "<table>" + "".join(trs) + "</table><script>" + JS + "</script></body></html>")
open(a.out, "w", encoding="utf-8").write(page)
print(f"{len(rows)} row(s) -> {a.out}")
