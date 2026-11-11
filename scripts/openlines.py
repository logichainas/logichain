"""Open (not yet delivered) order lines: visible everywhere, kept out of supplier evaluation.
Usage: python3 openlines.py <file> <no|en>"""
import sys, re
f, lang = sys.argv[1], sys.argv[2]
s = open(f).read()
T = {
 'no': dict(nd='Ikke levert', card='Åpne ordrelinjer – ikke levert ennå',
   note='Disse linjene holdes utenfor leverandørevalueringen (OTD, rating, avvik) til de er levert – men du ser dem her og i oppslagene.',
   open='Åpne linjer', value='verdi', overdue='Forfalt', overdueSub='bekreftet leveringsdato passert', soon='Forfaller ≤ 14 dager', later='Senere',
   all='Alle', fOver='Forfalt', fSoon='≤ 14 dager', fLater='Senere',
   po='PO', ln='Linje', sup='Leverandør', mat='Materiale', proj='Prosj.', ordered='Bestilt', prom='Bekreftet leveringsdato', days='Dager', val='Verdi',
   over='over', left='igjen', today='i dag', none='Ingen åpne linjer.', showing='Viser', of='av', more='Vis alle',
   optOpen='Ikke levert (åpne)', supOpen='Åpne linjer hos leverandøren', supOpenNone='Ingen åpne linjer hos denne leverandøren.',
   lines='linjer', kr='kr'),
 'en': dict(nd='Not delivered', card='Open order lines – not delivered yet',
   note='These lines are kept out of supplier evaluation (OTD, rating, deviation) until they are delivered – but you can see them here and in the lookups.',
   open='Open lines', value='value', overdue='Overdue', overdueSub='confirmed delivery date passed', soon='Due ≤ 14 days', later='Later',
   all='All', fOver='Overdue', fSoon='≤ 14 days', fLater='Later',
   po='PO', ln='Line', sup='Supplier', mat='Material', proj='Proj.', ordered='Ordered', prom='Confirmed delivery date', days='Days', val='Value',
   over='late', left='left', today='today', none='No open lines.', showing='Showing', of='of', more='Show all',
   optOpen='Not delivered (open)', supOpen='Open lines with this supplier', supOpenNone='No open lines with this supplier.',
   lines='lines', kr='kr'),
}[lang]

def rep(a, b, cnt=1):
    global s
    n = s.count(a); assert n == cnt, (f, a[:70], n); s = s.replace(a, b)

if 'OPEN_LINES' in s:
    print('already', f); sys.exit()

# 1) real data: keep the open lines before the reporting-window filter drops them
if 'const before=lines.length;lines=lines.filter(l=>l.del&&' in s:
    rep('const before=lines.length;lines=lines.filter(l=>l.del&&',
        'window.__OPEN=lines.filter(l=>!l.del).map(l=>Object.assign({},l,{status:"Ikke levert",dev:0,month:-1}));\n           const before=lines.length;lines=lines.filter(l=>l.del&&')

# 2) the list itself (demo: a few generated open lines so the feature can be shown)
anchor = 'const ALL_LINES=lines;' if 'const ALL_LINES=lines;' in s else 'const ALL_LINES=lines.slice();'
rep(anchor, anchor + '''
/* open (not delivered) lines: shown in lookups, never part of supplier evaluation */
const OPEN_LINES=(function(){
  if(window.__OPEN)return window.__OPEN;
  const out=[],R=(typeof mulberry32==="function")?mulberry32(7331):Math.random,now=new Date();now.setHours(0,0,0,0);
  if(!ALL_LINES.length)return out;
  for(let i=0;i<34;i++){const t=ALL_LINES[Math.floor(R()*ALL_LINES.length)];
    const prom=new Date(now.getTime()+(Math.floor(R()*70)-25)*864e5),order=new Date(prom.getTime()-(20+Math.floor(R()*50))*864e5);
    out.push({po:"PO"+(27000+i*7),line:10*(1+Math.floor(R()*4)),sup:t.sup,mat:t.mat,proj:t.proj,qty:t.qty,order,prom,del:null,dev:0,status:"@nd@",value:t.value,month:-1});}
  return out;})();''')

# 3) PO tab: open-lines card above the PO search
m = re.search(r'\n  <div class="card" style="margin-top:16px">\n    <h3 class="sect">(Søk etter innkjøpsordre / PO-linje|Search purchase orders / PO lines)</h3>', s)
assert m, f
s = s[:m.start()] + '''
  <div class="card" style="margin-top:16px" data-open>
    <h3 class="sect">@card@</h3>
    <p class="note" style="margin:-4px 0 12px">@note@</p>
    <div class="kpis" id="openKpis" style="margin-bottom:12px"></div>
    <div class="openf" id="openFilter" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>
    <div style="overflow-x:auto"><table id="openTable"></table></div>
    <div class="note" id="openCount"></div>
  </div>''' + s[m.start():]

# status filter in the PO search: open lines too
s = re.sub(r'(<select id="poStatus" onchange="renderPO\(\)">\s*<option value="">[^<]*</option>)', lambda m_: m_.group(1) + '<option value="@nd@">@optOpen@</option>', s, count=1)
rep('const rows=lines.filter(l=>(!st||l.status===st)&&(poMonth===null||l.month===poMonth)&&(',
    'const rows=(st==="@nd@"?OPEN_LINES:(st?lines:lines.concat(poMonth===null?OPEN_LINES:[]))).filter(l=>(!st||l.status===st)&&(poMonth===null||l.month===poMonth)&&(')

# 4) lookups find open lines
rep('const l=lines.find(x=>x.po===po&&x.line===line);if(!l)return;',
    'const l=lines.find(x=>x.po===po&&x.line===line)||OPEN_LINES.find(x=>x.po===po&&x.line===line);if(!l)return;')
rep('const seen={};lines.filter(l=>l.po.toLowerCase().includes(q))',
    'const seen={};lines.concat(OPEN_LINES).filter(l=>l.po.toLowerCase().includes(q))')
rep('const src=(typeof ALL_LINES!=="undefined"?ALL_LINES:lines),out=document.getElementById("projOut")',
    'const src=(typeof ALL_LINES!=="undefined"?ALL_LINES:lines).concat(typeof OPEN_LINES!=="undefined"?OPEN_LINES:[]),out=document.getElementById("projOut")')

# 5) supplier detail: open lines with this supplier
m = re.search(r'\n  setCrumbs\(\[\["Logichain","goto\(\'forside\'\)"\],\["[^"]+","goto\(\'lev\'\)"\],\[s\.name\]\]\);', s)
assert m, f
s = s[:m.start()] + '''
  {const op=OPEN_LINES.filter(l=>l.sup.id===id).sort((a,b)=>a.prom-b.prom),now=new Date(),od=op.filter(l=>l.prom<now).length;
   el.insertAdjacentHTML("beforeend",`<h3 class="sect" style="margin-top:16px">@supOpen@ · ${op.length} @lines@${od?` · <span style="color:#ff6b6b">${od} @overdue@</span>`:""}</h3>`+
    (op.length?`<table><tr><th>@po@</th><th>@mat@</th><th>@prom@</th><th>@days@</th><th style="text-align:right">@val@</th></tr>${op.slice(0,10).map(l=>{const d=Math.round((now-l.prom)/864e5);
      return `<tr class="click" onclick="showLine('${l.po}',${l.line})"><td>${l.po}</td><td>${matName(l.mat)}</td><td>${dstr(l.prom)}</td><td style="color:${d>0?"#ff6b6b":"var(--muted)"}">${d>0?d+" @over@":d===0?"@today@":(-d)+" @left@"}</td><td style="text-align:right">${fmt(l.value)}</td></tr>`;}).join("")}</table>`:`<p class="note">@supOpenNone@</p>`));}''' + s[m.start():]

# 6) render the open-lines card
rep('\nrenderPO();\n', '''
renderPO();
/* ================= OPEN LINES (not delivered) ================= */
let OPEN_F="";
window.renderOpen=function(fl){
  if(typeof fl==="string")OPEN_F=fl;
  const now=new Date();now.setHours(0,0,0,0);const soon=new Date(now.getTime()+14*864e5);
  const grp=l=>l.prom<now?"over":l.prom<=soon?"soon":"later";
  const all=OPEN_LINES.slice().sort((a,b)=>a.prom-b.prom),cnt={over:0,soon:0,later:0},val={over:0,soon:0,later:0};
  all.forEach(l=>{const g=grp(l);cnt[g]++;val[g]+=l.value;});
  const tot=all.reduce((a,l)=>a+l.value,0);
  const k=document.getElementById("openKpis");if(!k)return;
  k.innerHTML=kpi("@open@",fmt(all.length),fmt(tot)+" @kr@ @value@")+kpi("@overdue@",fmt(cnt.over),fmt(val.over)+" @kr@ · @overdueSub@",cnt.over?"bad":"good")+kpi("@soon@",fmt(cnt.soon),fmt(val.soon)+" @kr@",cnt.soon?"warn":"")+kpi("@later@",fmt(cnt.later),fmt(val.later)+" @kr@");
  document.getElementById("openFilter").innerHTML=[["","@all@",all.length],["over","@fOver@",cnt.over],["soon","@fSoon@",cnt.soon],["later","@fLater@",cnt.later]]
    .map(([v,t,n])=>`<button type="button" class="mchip${OPEN_F===v?" on":""}" onclick="renderOpen('${v}')">${t} <span style="opacity:.6">${n}</span></button>`).join("");
  const rows=all.filter(l=>!OPEN_F||grp(l)===OPEN_F);
  document.getElementById("openTable").innerHTML=rows.length?`<tr><th>@po@</th><th>@ln@</th><th>@sup@</th><th>@mat@</th><th>@proj@</th><th>@ordered@</th><th>@prom@</th><th>@days@</th><th style="text-align:right">@val@</th></tr>`+
    rows.map(l=>{const d=Math.round((now-l.prom)/864e5);return `<tr class="click" onclick="showLine('${l.po}',${l.line})"><td><b>${l.po}</b></td><td>${l.line}</td><td><a class="cellink" onclick="event.stopPropagation();openSup(${l.sup.id})">${l.sup.name}</a></td><td><a class="cellink" onclick="event.stopPropagation();showMat(${l.mat})">${matName(l.mat)}</a></td><td>${l.proj}</td><td>${dstr(l.order)}</td><td>${dstr(l.prom)}</td><td style="color:${d>0?"#ff6b6b":d>=-14?"#f5b041":"var(--muted)"};font-weight:600">${d>0?d+" @over@":d===0?"@today@":(-d)+" @left@"}</td><td style="text-align:right">${fmt(l.value)}</td></tr>`;}).join("")
    :`<tr><td style="color:var(--muted)">@none@</td></tr>`;
  document.getElementById("openCount").textContent=rows.length?`${fmt(rows.length)} @lines@`:"";
};
renderOpen();
''')
if '.mchip{' not in s:
    rep('</head>', '<style>.mchip{border:1px solid var(--line,#2a3558);background:transparent;color:var(--text,#e6ecff);border-radius:999px;padding:6px 12px;font:600 12px inherit;cursor:pointer}.mchip.on{background:linear-gradient(90deg,#22d3ee,#a78bfa);color:#050816;border-color:transparent}</style>\n</head>')

for k, v in T.items():
    s = s.replace('@' + k + '@', v)
assert not re.search(r'@[a-zA-Z]+@', s), re.findall(r'@[a-zA-Z]+@', s)[:5]
open(f, 'w').write(s)
print('ok', f)
