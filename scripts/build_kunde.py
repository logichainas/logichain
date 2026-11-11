"""Build kunde-dashboard.html (shared customer portal) from macgregor-dashboard.html.
Each customer only ever sees their own rows: the database (RLS) filters on the signed-in user's kunde_id.
Usage: python3 build_kunde.py <repo>"""
import sys, re
repo = sys.argv[1]
s = open(f"{repo}/macgregor-dashboard.html").read()

def rep(a, b, cnt=1):
    global s
    n = s.count(a)
    assert n == cnt, (a[:80], n)
    s = s.replace(a, b)

# ---------- gate: any customer created by Logichain; admin picks a customer ----------
rep("'<div class=\"mg-top\"><b>MACGREGOR</b><span>×</span>", "'<div class=\"mg-top\">")
rep('''    if(!row||((row.seed+"")!=="4211"&&row.portal!=="macgregor-dashboard.html"&&!row.admin)){await sb.auth.signOut();loginCard("Ingen tilgang for denne brukeren.");return;}
    try{localStorage.setItem("logichain_session",JSON.stringify({id:s.user.id,firma:row.firma,seed:row.seed,portal:row.portal||"macgregor-dashboard.html",src:"supabase"}));}catch(e){}''',
'''    if(!row){await sb.auth.signOut();loginCard("Ingen tilgang for denne brukeren.");return;}
    // customers with their own portal page (e.g. MacGregor) are sent there
    if(!row.admin&&row.portal&&row.portal!=="kunde-dashboard.html"&&/^[a-z0-9-]+\\.html$/.test(row.portal)){location.replace("/"+row.portal);return;}
    try{localStorage.setItem("logichain_session",JSON.stringify({id:s.user.id,firma:row.firma,seed:row.seed,portal:row.portal||"kunde-dashboard.html",src:"supabase"}));}catch(e){}
    if(row.admin&&!/^[0-9a-f-]{36}$/i.test(new URLSearchParams(location.search).get("kunde")||"")){await pickCard();return;}''')
rep('''  function boot(){verify();}''', '''  // admin without ?kunde=: choose which customer to open
  async function pickCard(){
    var q=await sb.from("kunder").select("id,firma,epost,portal").order("firma");
    var e=function(x){return String(x==null?"":x).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});};
    var list=(q.data||[]).filter(function(k){return k.portal!=="admin.html";});
    document.body.innerHTML='<div class="mg-login"><div class="mg-card"><h2>Velg kunde</h2><p class="mg-sub">Du er admin. Åpne dashboardet til en kunde:</p>'+
      (list.length?list.map(function(k){var href=(k.portal==="macgregor-dashboard.html"?"/macgregor-dashboard.html":"")+"?kunde="+encodeURIComponent(k.id);
        return '<a class="mg-pick" href="'+e(href)+'"><b>'+e(k.firma)+'</b><small>'+e(k.epost)+'</small></a>';}).join(""):'<p class="mg-sub">Ingen kunder ennå. Opprett en bruker i Supabase først.</p>')+
      '<a class="mg-back" href="/admin.html">← Tilbake til Jarvis</a></div></div>'+
      '<style>.mg-pick{display:flex;flex-direction:column;gap:2px;padding:12px 14px;margin:8px 0;border:1px solid rgba(148,163,255,.2);border-radius:12px;color:#e6ecff;text-decoration:none}.mg-pick:hover{border-color:#22d3ee;background:rgba(34,211,238,.06)}.mg-pick small{color:#8fa0c0}</style>';
    reveal();
  }
  function boot(){verify();}''')

# ---------- branding ----------
rep('<title>MacGregor Norway · Logichain</title>', '<title>Kundeportal · Logichain</title>')
rep('<body data-fx="crane">', '<body>')
s = re.sub(r'<div class="logo"><span style="color:#ff2d46;letter-spacing:\.06em">MACGREGOR</span> <span class="lc-x">×</span> ', '<div class="logo">', s, count=1)
rep('<div class="topsub">Designed to perform with the sea.</div>', '<div class="topsub">Turn purchasing data into decisions.</div>')
rep('<span class="kunde-chip" id="kundeChip" style="display:inline-block">🏢 MacGregor Norway</span>', '<span class="kunde-chip" id="kundeChip" style="display:none"></span>')
rep('Datakilde: MacGregor Norway – leverandørrapporter (demo)', 'Datakilde: leverandørrapporter')
rep('<div class="mg-brand"><b>MACGREGOR</b> <span>Performance Dashboard</span></div>', '<div class="mg-brand"><b id="heroFirma" style="color:#22d3ee"></b> <span>Performance Dashboard</span></div>')
rep('<div style="font-weight:800;font-size:19px;color:#e2001a">MACGREGOR</div>', '<div style="font-weight:800;font-size:19px;color:#22d3ee" id="upFirma">Logichain</div>')
rep('a.download="macgregor-innrapportering-mal.csv"', 'a.download="logichain-innrapportering-mal.csv"')
rep('encodeURIComponent("Logichain · Ny datainnlevering fra MacGregor Norway")', 'encodeURIComponent("Logichain · Ny datainnlevering fra "+(window.__FIRMA||"kunde"))')
rep('const __KUNDE={firma:"MacGregor Norway",seed:4211};', 'const __KUNDE={firma:"",seed:4211};')
rep('" \\u00b7 Datakilde: MacGregor (ekte data)"', '" \\u00b7 Datakilde: "+(window.__FIRMA||"")+" (ekte data)"')

rep('\\n\\nMed vennlig hilsen\\nMacGregor Norway")', '\\n\\nMed vennlig hilsen\\n"+(window.__FIRMA||""))')

# ---------- which customer's data: own row; admin may open ?kunde=<id> ----------
rep('''        // admin (Logichain): ?kunde=<id> opens that MacGregor department, otherwise MacGregor Arendal (seed 4211)
        const want=new URLSearchParams(location.search).get("kunde")||"";
        if(prof.data.admin&&/^[0-9a-f-]{36}$/i.test(want))kid=want;
        else if(prof.data.admin&&(prof.data.seed+"")!=="4211"){
          const mg=await sb.from("kunder").select("id").eq("seed",4211).limit(1).maybeSingle();
          if(mg&&mg.data)kid=mg.data.id;
        }
        // other MacGregor departments show their own name (Arendal keeps "MacGregor Norway")
        const kf=await sb.from("kunder").select("firma,seed").eq("id",kid).maybeSingle();
        if(kf&&kf.data&&kf.data.firma&&(kf.data.seed+"")!=="4211")__KUNDE.firma=kf.data.firma;
        window.__FIRMA=__KUNDE.firma;''', '''        // admin (Logichain) opens a customer with ?kunde=<id>; customers always get their own row
        const want=new URLSearchParams(location.search).get("kunde")||"";
        if(prof.data.admin&&/^[0-9a-f-]{36}$/i.test(want))kid=want;
        const kr=await sb.from("kunder").select("firma").eq("id",kid).maybeSingle();
        window.__FIRMA=(kr&&kr.data&&kr.data.firma)||prof.data.firma||"";
        __KUNDE.firma=window.__FIRMA;''')
rep('''    {const want=new URLSearchParams(location.search).get("kunde")||"";
     if(me.admin&&/^[0-9a-f-]{36}$/i.test(want))kid=want;
     else if(me.admin&&(me.seed+"")!=="4211"){const mg=(await c.from("kunder").select("id").eq("seed",4211).limit(1).maybeSingle()).data;if(mg)kid=mg.id;}}''',
    '''    {const want=new URLSearchParams(location.search).get("kunde")||"";if(me.admin&&/^[0-9a-f-]{36}$/i.test(want))kid=want;}''')

rep('<b class="firma-name">', '<b class="firma-name" style="color:#22d3ee">')

s = re.sub(r'\n        // department label next to the page title[^\n]*\n        window\.__DEPT=[^\n]*', '', s, count=1)

# kunde chip / title follow the customer
rep('''  if(kc){kc.textContent="🏢 "+__KUNDE.firma;kc.style.display="inline-block";}
  document.title="Logichain – "+__KUNDE.firma;''', '''  if(kc&&__KUNDE.firma){kc.textContent="🏢 "+__KUNDE.firma;kc.style.display="inline-block";}
  if(__KUNDE.firma)document.title=__KUNDE.firma+" · Logichain";
  const hf=document.getElementById("heroFirma");if(hf)hf.textContent=__KUNDE.firma;
  const uf=document.getElementById("upFirma");if(uf&&__KUNDE.firma)uf.textContent=__KUNDE.firma;''')

assert 'MACGREGOR' not in s and '4211"' not in s.replace('seed:4211},', ''), [m.start() for m in re.finditer('MACGREGOR|4211', s)]
s = s.replace('<!-- MacGregor', '<!-- Customer')
open(f"{repo}/kunde-dashboard.html", "w").write(s)
print("ok", len(s))
