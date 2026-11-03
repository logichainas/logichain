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
    var mx=0,my=0; addEventListener("pointermove",function(e){ mx=e.clientX/innerWidth-.5; my=e.clientY/innerHeight-.5; },{passive:true});
    function size(){ R.setSize(innerWidth,innerHeight,false); C.aspect=innerWidth/innerHeight; C.updateProjectionMatrix(); }
    size(); addEventListener("resize",size);
    var sy = 0; addEventListener("scroll",function(){ sy = scrollY; },{passive:true});
    (function loop(t){
      requestAnimationFrame(loop); if (document.hidden) return;
      G.rotation.y = t*0.00004 + mx*0.25; G.rotation.x = my*0.15 + sy*0.00025;
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
