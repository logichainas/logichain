/* Logichain dashboard effects: 3D background, hero core, KPI count-up, card tilt.
   Pure enhancement — the dashboards work the same if this file or Three.js fails. */
(function(){
  "use strict";
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var T = window.THREE;

  /* --- shared SVG gradient for charts --- */
  var defs = document.createElementNS("http://www.w3.org/2000/svg","svg");
  defs.setAttribute("width","0");defs.setAttribute("height","0");defs.setAttribute("aria-hidden","true");
  defs.style.cssText="position:absolute;width:0;height:0;overflow:hidden";
  defs.innerHTML='<defs><linearGradient id="lcBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset=".55" stop-color="#818cf8"/><stop offset="1" stop-color="#a78bfa" stop-opacity=".55"/></linearGradient></defs>';
  document.body.appendChild(defs);

  /* --- sticky offset for tabs under the top bar --- */
  var tb = document.querySelector(".topbar");
  function setTop(){ if(tb) document.documentElement.style.setProperty("--lc-top", tb.offsetHeight+"px"); }
  setTop(); addEventListener("resize", setTop);
  if (window.ResizeObserver && tb) new ResizeObserver(setTop).observe(tb);

  /* --- KPI count-up --- */
  function animateVal(el){
    if (RM || el.dataset.lcDone === el.textContent) return;
    var txt = el.textContent, m = txt.match(/\d[\d\s .,]*\d|\d/);
    if (!m) return;
    var raw = m[0], digits = raw.replace(/\D/g,""), N = parseInt(digits,10);
    if (!N || digits.length > 12) return;
    var seps = []; for (var i=0;i<raw.length;i++) if (!/\d/.test(raw[i])) seps.push(i);
    var lastSep = seps.length ? seps[seps.length-1] : -1;
    var decAt = lastSep >= 0 && raw.length-1-lastSep !== 3 ? lastSep : -1;
    var pre = txt.slice(0, m.index), post = txt.slice(m.index + raw.length);
    function fmt(k){
      var s = String(k); while (s.length < digits.length) s = "0"+s;
      var out = "", di = 0;
      for (var j=0;j<raw.length;j++) out += /\d/.test(raw[j]) ? s[di++] : raw[j];
      var cut = decAt >= 0 ? decAt-1 : out.length-1, p = 0;
      while (p < cut && (out[p]==="0" || !/\d/.test(out[p]))) p++;
      while (p > 0 && !/\d/.test(out[p])) p++;
      return out.slice(p);
    }
    var t0 = performance.now(), D = 1100;
    (function step(now){
      var t = Math.min(1,(now-t0)/D), e = 1-Math.pow(1-t,4);
      el.textContent = pre + fmt(Math.round(N*e)) + post;
      if (t < 1) requestAnimationFrame(step); else { el.textContent = txt; el.dataset.lcDone = txt; }
    })(t0);
  }
  function scanKpis(root){ (root||document).querySelectorAll(".kpi .val").forEach(animateVal); }
  var mo = new MutationObserver(function(list){
    list.forEach(function(r){ r.addedNodes.forEach(function(n){ if (n.nodeType===1) { if (n.matches && n.matches(".kpi")) scanKpis(n); else if (n.querySelectorAll) scanKpis(n); } }); });
  });
  function watchKpis(){ document.querySelectorAll(".kpis").forEach(function(k){ if(!k.dataset.lcW){ k.dataset.lcW=1; mo.observe(k,{childList:true}); } }); }
  // KPI containers can be created later (detail panels), so watch the whole main for new .kpis too
  var main = document.querySelector("main");
  if (main) new MutationObserver(function(){ watchKpis(); }).observe(main,{childList:true,subtree:true});
  watchKpis();
  setTimeout(function(){ scanKpis(); }, 150);
  // re-run when switching tab so numbers animate on view
  var tabs = document.getElementById("tabs");
  if (tabs) tabs.addEventListener("click", function(){ setTimeout(function(){
    document.querySelectorAll("main>section").forEach(function(s){ if (s.style.display !== "none") s.querySelectorAll(".kpi .val").forEach(function(v){ v.dataset.lcDone=""; animateVal(v); }); });
  }, 30); });

  /* --- 3D tilt on cards --- */
  if (!RM && matchMedia("(hover:hover)").matches) {
    document.addEventListener("pointermove", function(e){
      var c = e.target.closest && e.target.closest(".kpi,.feature");
      document.querySelectorAll(".lc-tilt").forEach(function(o){ if (o!==c){ o.classList.remove("lc-tilt"); o.style.transform=""; } });
      if (!c) return;
      var r = c.getBoundingClientRect(), x = (e.clientX-r.left)/r.width, y = (e.clientY-r.top)/r.height;
      c.classList.add("lc-tilt");
      c.style.transform = "perspective(900px) rotateX("+((0.5-y)*7).toFixed(2)+"deg) rotateY("+((x-0.5)*9).toFixed(2)+"deg) translateZ(4px)";
      c.style.setProperty("--mx",(x*100).toFixed(1)+"%"); c.style.setProperty("--my",(y*100).toFixed(1)+"%");
    }, {passive:true});
  }

  if (!T || RM) return;

  /* --- background: slow 3D data constellation --- */
  (function(){
    var cv = document.createElement("canvas"); cv.id = "lcFx"; document.body.prepend(cv);
    var R;
    try { R = new T.WebGLRenderer({canvas:cv, alpha:true, antialias:true}); } catch(_) { cv.remove(); return; }
    R.setPixelRatio(Math.min(devicePixelRatio,1.5));
    var S = new T.Scene(), C = new T.PerspectiveCamera(60,1,1,2000); C.position.z = 520;
    var G = new T.Group(); S.add(G);
    var n = innerWidth < 800 ? 70 : 140, pos = [], pts = new Float32Array(n*3);
    for (var i=0;i<n;i++){ var v=[(Math.random()-.5)*1300,(Math.random()-.5)*800,(Math.random()-.5)*700]; pos.push(v); pts.set(v,i*3); }
    var pg = new T.BufferGeometry(); pg.setAttribute("position", new T.BufferAttribute(pts,3));
    G.add(new T.Points(pg, new T.PointsMaterial({color:0x9aa6ff,size:3,transparent:true,opacity:.75,sizeAttenuation:true})));
    var seg = [];
    for (var a=0;a<n;a++) for (var b=a+1;b<n;b++){ var dx=pos[a][0]-pos[b][0],dy=pos[a][1]-pos[b][1],dz=pos[a][2]-pos[b][2]; if (dx*dx+dy*dy+dz*dz < 150*150) seg.push(pos[a][0],pos[a][1],pos[a][2],pos[b][0],pos[b][1],pos[b][2]); }
    var lg = new T.BufferGeometry(); lg.setAttribute("position", new T.BufferAttribute(new Float32Array(seg),3));
    G.add(new T.LineSegments(lg, new T.LineBasicMaterial({color:0x22d3ee,transparent:true,opacity:.12})));

    /* ---- extra depth: far stars, nebula glow, floating shapes, holo data panels, pulses, meteors ---- */
    var small = innerWidth < 800;
    function tex(draw,w,h){ var c=document.createElement("canvas"); c.width=w; c.height=h||w; draw(c.getContext("2d"),c.width,c.height); var t=new T.CanvasTexture(c); return t; }
    var dot = tex(function(g,w){ var r=g.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2); r.addColorStop(0,"rgba(255,255,255,1)"); r.addColorStop(.25,"rgba(255,255,255,.55)"); r.addColorStop(1,"rgba(255,255,255,0)"); g.fillStyle=r; g.fillRect(0,0,w,w); },64);
    // far star field with colour variation
    var fs = small?500:1400, fp=new Float32Array(fs*3), fc=new Float32Array(fs*3), pal=[[.6,.65,1],[.4,.85,.95],[.75,.6,1],[1,1,1]];
    for (var i=0;i<fs;i++){ fp[i*3]=(Math.random()-.5)*3600; fp[i*3+1]=(Math.random()-.5)*2200; fp[i*3+2]=-400-Math.random()*900; var c0=pal[i%4]; fc.set(c0,i*3); }
    var fg=new T.BufferGeometry(); fg.setAttribute("position",new T.BufferAttribute(fp,3)); fg.setAttribute("color",new T.BufferAttribute(fc,3));
    var far=new T.Points(fg,new T.PointsMaterial({size:5,map:dot,vertexColors:true,transparent:true,opacity:.7,depthWrite:false,blending:T.AdditiveBlending})); S.add(far);
    // nebula clouds
    var neb = tex(function(g,w){ for(var k=0;k<14;k++){ var x=w*(.25+Math.random()*.5),y=w*(.25+Math.random()*.5),r=w*(.12+Math.random()*.25),q=g.createRadialGradient(x,y,0,x,y,r); q.addColorStop(0,"rgba(255,255,255,.22)"); q.addColorStop(1,"rgba(255,255,255,0)"); g.fillStyle=q; g.fillRect(0,0,w,w);} },256);
    var nebs=[];
    [[-900,260,-700,0x6366f1,1500],[950,-200,-650,0x22d3ee,1300],[-700,-380,-500,0xa78bfa,1100],[800,380,-800,0x818cf8,1400],[0,-520,-900,0x0ea5e9,1700]].forEach(function(o){
      var m=new T.Sprite(new T.SpriteMaterial({map:neb,color:o[3],transparent:true,opacity:.32,depthWrite:false,blending:T.AdditiveBlending}));
      m.position.set(o[0],o[1],o[2]); m.scale.set(o[4],o[4]*.7,1); S.add(m); nebs.push(m);
    });
    // floating wireframe shapes near the edges
    var shapes=[];
    [[new T.IcosahedronGeometry(60,1),0x818cf8,-620,180,-120],[new T.OctahedronGeometry(46,0),0x22d3ee,640,-170,-80],[new T.TorusKnotGeometry(34,8,90,8),0xa78bfa,580,240,-260],
     [new T.DodecahedronGeometry(40,0),0x38bdf8,-560,-250,-200],[new T.TorusGeometry(70,1.2,8,90),0x22d3ee,-700,-60,-300],[new T.IcosahedronGeometry(26,0),0xc4b5fd,720,40,-40]].forEach(function(o,k){
      var m=new T.Mesh(o[0],new T.MeshBasicMaterial({color:o[1],wireframe:true,transparent:true,opacity:.22,depthWrite:false}));
      m.position.set(o[2],o[3],o[4]); m.userData={sp:.2+Math.random()*.4,ph:k*1.7,y:o[3]}; S.add(m); shapes.push(m);
    });
    // holographic data panels (mini charts) floating at the sides
    function panel(kind){
      return tex(function(g,w,h){
        g.strokeStyle="rgba(120,220,255,.55)"; g.lineWidth=2; g.strokeRect(2,2,w-4,h-4);
        g.fillStyle="rgba(34,211,238,.06)"; g.fillRect(2,2,w-4,h-4);
        g.fillStyle="rgba(160,230,255,.85)"; g.font="bold 15px monospace";
        g.fillText(["SPEND · NOK","OTD · %","LEAD TIME","SUPPLIER RISK","PO FLOW","SAVINGS"][kind%6],14,24);
        g.fillRect(14,32,60,2);
        if(kind%3===0){ for(var i=0;i<10;i++){ var bh=20+Math.random()*(h-80); g.fillStyle="rgba("+(i%2?"129,140,248":"34,211,238")+",.7)"; g.fillRect(16+i*((w-32)/10),h-14-bh,(w-32)/10-6,bh);} }
        else if(kind%3===1){ g.beginPath(); for(var j=0;j<=24;j++){ var x=14+j*(w-28)/24,y=h-20-(Math.sin(j*.6+kind)*.3+.5+Math.random()*.15)*(h-70); j?g.lineTo(x,y):g.moveTo(x,y);} g.strokeStyle="rgba(167,139,250,.9)"; g.lineWidth=2.5; g.stroke();
          g.strokeStyle="rgba(120,220,255,.15)"; g.lineWidth=1; for(var k2=1;k2<4;k2++){ g.beginPath(); g.moveTo(14,40+k2*(h-60)/4); g.lineTo(w-14,40+k2*(h-60)/4); g.stroke(); } }
        else { var cx=w*.3,cy=h*.58,r=Math.min(w,h)*.26,acc=0,cols=["rgba(34,211,238,.8)","rgba(129,140,248,.8)","rgba(167,139,250,.8)","rgba(56,189,248,.5)"];
          for(var q=0;q<4;q++){ var part=.15+Math.random()*.3; g.beginPath(); g.arc(cx,cy,r,acc*6.283,(acc+part)*6.283); g.strokeStyle=cols[q]; g.lineWidth=12; g.stroke(); acc+=part; }
          g.font="12px monospace"; g.fillStyle="rgba(160,230,255,.7)"; for(var z=0;z<5;z++) g.fillText((Math.random()*999|0)+" "+["kr","%","d","PO","k"][z],w*.6,h*.4+z*18); }
      },256,160);
    }
    var holos=[];
    if(!small) [[-760,330,-260],[790,330,-320],[-820,-300,-380],[830,-330,-260],[-560,40,-520],[600,-20,-560]].forEach(function(o,k){
      var m=new T.Mesh(new T.PlaneGeometry(200,125),new T.MeshBasicMaterial({map:panel(k),transparent:true,opacity:.42,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending}));
      m.position.set(o[0],o[1],o[2]); m.rotation.y = o[0]<0?.35:-.35; m.userData={ph:k*1.3,y:o[1]}; S.add(m); holos.push(m);
    });
    // pulses travelling along the network lines
    var segN=seg.length/6, pN=Math.min(small?18:40,segN), pp=new Float32Array(pN*3), pulse=[];
    for (var i2=0;i2<pN;i2++) pulse.push({s:Math.floor(Math.random()*segN),t:Math.random(),v:.003+Math.random()*.006});
    var pgm=new T.BufferGeometry(); pgm.setAttribute("position",new T.BufferAttribute(pp,3));
    G.add(new T.Points(pgm,new T.PointsMaterial({color:0x7ef3ff,size:14,map:dot,transparent:true,opacity:.95,depthWrite:false,blending:T.AdditiveBlending})));
    // meteors
    var met=[]; for (var m3=0;m3<3;m3++){ var mg=new T.BufferGeometry(); mg.setAttribute("position",new T.BufferAttribute(new Float32Array(6),3));
      var ml=new T.Line(mg,new T.LineBasicMaterial({color:0xbfefff,transparent:true,opacity:0,blending:T.AdditiveBlending})); S.add(ml); met.push({l:ml,life:0,next:2000+Math.random()*6000}); }
    function fx(t){
      var s=t*0.001;
      far.rotation.z = s*0.004;
      nebs.forEach(function(m,k){ m.material.opacity=.26+Math.sin(s*.25+k)*.07; });
      shapes.forEach(function(m){ var u=m.userData; m.rotation.x=s*u.sp*.6; m.rotation.y=s*u.sp; m.position.y=u.y+Math.sin(s*.4+u.ph)*14; });
      holos.forEach(function(m){ var u=m.userData; m.position.y=u.y+Math.sin(s*.35+u.ph)*10; m.material.opacity=.34+Math.sin(s*.8+u.ph)*.08; });
      if (segN){ var a2=pgm.attributes.position.array; pulse.forEach(function(o,k){ o.t+=o.v; if(o.t>1){ o.t=0; o.s=Math.floor(Math.random()*segN); }
        var b=o.s*6; a2[k*3]=seg[b]+(seg[b+3]-seg[b])*o.t; a2[k*3+1]=seg[b+1]+(seg[b+4]-seg[b+1])*o.t; a2[k*3+2]=seg[b+2]+(seg[b+5]-seg[b+2])*o.t; });
        pgm.attributes.position.needsUpdate=true; }
      met.forEach(function(o){ if(o.life<=0){ if(t>o.next){ o.life=1; o.x=(Math.random()-.2)*1600; o.y=300+Math.random()*400; o.z=-300-Math.random()*300; o.dx=-14-Math.random()*10; o.dy=-6-Math.random()*5; } else return; }
        o.x+=o.dx; o.y+=o.dy; o.life-=0.012; var a3=o.l.geometry.attributes.position.array; a3[0]=o.x; a3[1]=o.y; a3[2]=o.z; a3[3]=o.x-o.dx*9; a3[4]=o.y-o.dy*9; a3[5]=o.z;
        o.l.geometry.attributes.position.needsUpdate=true; o.l.material.opacity=Math.max(0,o.life)*.8; if(o.life<=0){ o.l.material.opacity=0; o.next=t+3000+Math.random()*9000; } });
    }
    var mx=0,my=0; addEventListener("pointermove",function(e){ mx=e.clientX/innerWidth-.5; my=e.clientY/innerHeight-.5; },{passive:true});
    function size(){ R.setSize(innerWidth,innerHeight,false); C.aspect=innerWidth/innerHeight; C.updateProjectionMatrix(); }
    size(); addEventListener("resize",size);
    var sy = 0; addEventListener("scroll",function(){ sy = scrollY; },{passive:true});
    (function loop(t){
      requestAnimationFrame(loop); if (document.hidden) return;
      G.rotation.y = t*0.00004 + mx*0.25; G.rotation.x = my*0.15 + sy*0.00025;
      C.position.x = mx*40; C.position.y = -my*30 - sy*0.05; C.lookAt(0,-sy*0.05,0);
      fx(t);
      R.render(S,C);
    })(0);
  })();

  /* --- hero: rotating "data core" --- */
  function core(host){
    var box = document.createElement("div"); box.className = "lc-core"; host.prepend(box);
    var R; try { R = new T.WebGLRenderer({alpha:true, antialias:true}); } catch(_) { box.remove(); return; }
    R.setPixelRatio(Math.min(devicePixelRatio,2)); box.appendChild(R.domElement);
    var S = new T.Scene(), C = new T.PerspectiveCamera(40,1,1,100); C.position.set(0,0,9.5);
    var G = new T.Group(); S.add(G);
    G.add(new T.Mesh(new T.IcosahedronGeometry(2.1,1), new T.MeshBasicMaterial({color:0x818cf8,wireframe:true,transparent:true,opacity:.35})));
    G.add(new T.Mesh(new T.IcosahedronGeometry(1.25,2), new T.MeshBasicMaterial({color:0x22d3ee,wireframe:true,transparent:true,opacity:.22})));
    var glow = new T.Mesh(new T.SphereGeometry(.7,32,32), new T.MeshBasicMaterial({color:0x8b9cff,transparent:true,opacity:.35})); G.add(glow);
    var vg = new T.IcosahedronGeometry(2.1,1).attributes.position, vp = new Float32Array(vg.count*3);
    for (var i=0;i<vg.count;i++){ vp[i*3]=vg.getX(i); vp[i*3+1]=vg.getY(i); vp[i*3+2]=vg.getZ(i); }
    var pg = new T.BufferGeometry(); pg.setAttribute("position", new T.BufferAttribute(vp,3));
    G.add(new T.Points(pg, new T.PointsMaterial({color:0xc4b5fd,size:.09})));
    var rings = [];
    [[3.0,0x22d3ee,.5],[3.5,0xa78bfa,-.35]].forEach(function(r){
      var ring = new T.Mesh(new T.TorusGeometry(r[0],.008,8,160), new T.MeshBasicMaterial({color:r[1],transparent:true,opacity:.45}));
      ring.rotation.x = Math.PI/2.4; ring.rotation.y = r[2];
      var sat = new T.Mesh(new T.SphereGeometry(.07,16,16), new T.MeshBasicMaterial({color:r[1]}));
      ring.add(sat); G.add(ring); rings.push({ring:ring,sat:sat,r:r[0],sp:r[2]>0?1:-.7});
    });
    var vis = true;
    if (window.IntersectionObserver) new IntersectionObserver(function(es){ vis = es[0].isIntersecting; }).observe(box);
    function size(){ var w=box.clientWidth||300,h=box.clientHeight||200; R.setSize(w,h,false); C.aspect=w/h; C.updateProjectionMatrix(); C.position.x = w/h > 1.6 ? -0.4 : 0; }
    size(); addEventListener("resize",size); if (window.ResizeObserver) new ResizeObserver(size).observe(box);
    (function loop(t){
      requestAnimationFrame(loop); if (!vis || document.hidden || !box.clientWidth) return;
      var s = t*0.001; G.rotation.y = s*0.25; G.rotation.x = Math.sin(s*0.3)*0.25;
      glow.scale.setScalar(1+Math.sin(s*2)*0.08);
      rings.forEach(function(o){ var a = s*o.sp; o.sat.position.set(Math.cos(a)*o.r, Math.sin(a)*o.r, 0); });
      R.render(S,C);
    })(0);
  }
  document.querySelectorAll(".card.hero").forEach(function(h, i){ if (i < 2) core(h); });
})();

/* KPI help tooltips: the (i) icons carry their text in title=""; show it in a styled bubble on hover, click or tap */
(function(){
  const tip=document.createElement("div");tip.className="lc-tip";tip.setAttribute("role","tooltip");document.body.appendChild(tip);
  let cur=null,hoverAt=0;
  const text=el=>{if(el.title){el.dataset.tip=el.title;el.removeAttribute("title");}return el.dataset.tip||"";};
  function show(el){const t=text(el);if(!t)return;if(cur)cur.classList.remove("on");cur=el;el.classList.add("on");tip.textContent=t;tip.classList.add("show");
    const r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
    const x=Math.min(Math.max(8,r.left+r.width/2-w/2),innerWidth-w-8);let y=r.bottom+8;if(y+h>innerHeight-8)y=r.top-h-8;
    tip.style.left=x+"px";tip.style.top=y+"px";}
  function hide(){tip.classList.remove("show");if(cur)cur.classList.remove("on");cur=null;}
  document.addEventListener("mouseover",e=>{const el=e.target.closest&&e.target.closest(".kpi-help");if(el&&el!==cur){hoverAt=Date.now();show(el);}});
  document.addEventListener("mouseout",e=>{const el=e.target.closest&&e.target.closest(".kpi-help");if(el&&!el.contains(e.relatedTarget))hide();});
  document.addEventListener("click",e=>{const el=e.target.closest&&e.target.closest(".kpi-help");if(el){e.stopPropagation();if(cur===el&&tip.classList.contains("show")&&Date.now()-hoverAt>500)hide();else show(el);}else hide();},true);
  addEventListener("scroll",hide,{passive:true});addEventListener("resize",hide);
})();

/* ===== Compact mode: collapsible cards, short tables, click-to-expand actions ===== */
(function(){
  const EN=document.documentElement.lang==="en";
  function setup(){
    document.querySelectorAll("main section").forEach(sec=>{
      let first=true,firstGrid=null;
      sec.querySelectorAll(".card").forEach(card=>{
        if(card.dataset.cc||card.classList.contains("hero"))return;
        const h=card.querySelector(":scope > h3.sect");if(!h)return;
        card.dataset.cc="1";card.classList.add("ccard");
        const body=document.createElement("div");body.className="cbody";
        while(h.nextSibling)body.appendChild(h.nextSibling);
        card.appendChild(body);
        const chev=document.createElement("span");chev.className="cchev";chev.textContent="▾";h.appendChild(chev);
        const hasInput=!!body.querySelector("input,select");
        if(first&&sec.id!=="tab-forside"){firstGrid=card.parentElement.matches(".grid2,.grid3,.grid4")?card.parentElement:card;}
        const inFirst=firstGrid&&(firstGrid===card||firstGrid.contains(card));
        const open=card.hasAttribute("data-open")||hasInput||inFirst;
        first=false;
        if(!open)card.classList.add("collapsed");
        h.addEventListener("click",()=>card.classList.toggle("collapsed"));
      });
    });
    document.querySelectorAll(".disclaimer").forEach(d=>{if(d.dataset.cl)return;d.dataset.cl="1";d.classList.add("lc-clamp");
      d.addEventListener("click",()=>d.classList.toggle("lc-clamp"));});
    document.querySelectorAll("#tab-forside .feature").forEach(f=>{if(f.dataset.cl)return;f.dataset.cl="1";const a=f.querySelector("a[onclick]");
      if(a)f.addEventListener("click",e=>{if(!e.target.closest("a"))a.click();});});
  }
  // long tables: show the first rows, then a "show all" button
  const LIMIT=8;
  function limitTable(t){
    const rows=[...t.querySelectorAll("tr")].filter(r=>!r.querySelector("th"));
    rows.forEach((r,i)=>r.classList.toggle("lc-more",i>=LIMIT));
    let btn=t.parentElement.querySelector(":scope > .lc-showall");
    if(rows.length<=LIMIT){if(btn)btn.remove();return;}
    if(!btn){btn=document.createElement("button");btn.type="button";btn.className="lc-showall";t.parentElement.appendChild(btn);
      btn.addEventListener("click",()=>{t.classList.toggle("lc-all");label();});}
    function label(){btn.textContent=t.classList.contains("lc-all")?(EN?"Show fewer ▴":"Vis færre ▴"):(EN?`Show all ${rows.length} ▾`:`Vis alle ${rows.length} ▾`);}
    label();
  }
  function watchTables(){
    document.querySelectorAll("main table[id]").forEach(t=>{
      if(t.dataset.lw)return;t.dataset.lw="1";limitTable(t);
      new MutationObserver(()=>limitTable(t)).observe(t,{childList:true,subtree:false});
    });
  }
  // actions (tiltak): click the card to see description and evidence
  document.addEventListener("click",e=>{const c=e.target.closest(".tiltak");if(!c||e.target.closest("a,button,select,input"))return;c.classList.toggle("open");});
  function run(){setup();watchTables();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();
  // dashboards that load data later (portal) re-render; re-check a few times
  [800,2500,6000].forEach(ms=>setTimeout(run,ms));
})();
