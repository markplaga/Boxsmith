'use strict';
/* ===== Boxsmith tools: tracing, text outlines, artwork, dogbones, patterns, nesting ===== */

/* ---------- raster → vector outlines ---------- */
function traceMask(m, w, h){
  const W1 = w + 1, edges = new Map();
  const add = (x0,y0,x1,y1)=>{ const k=y0*W1+x0; let a=edges.get(k); if(!a){a=[];edges.set(k,a);} a.push(x1,y1); };
  const F = (x,y)=> x>=0 && y>=0 && x<w && y<h && m[y*w+x];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(m[y*w+x]){
    if(!F(x,y-1)) add(x,y,x+1,y);
    if(!F(x+1,y)) add(x+1,y,x+1,y+1);
    if(!F(x,y+1)) add(x+1,y+1,x,y+1);
    if(!F(x-1,y)) add(x,y+1,x,y);
  }
  const loops = [];
  for(const k0 of [...edges.keys()]){
    let list = edges.get(k0);
    while(list && list.length){
      const sx = k0 % W1, sy = (k0 - sx) / W1;
      const loop = [[sx,sy]];
      let px = sx, py = sy, nx = list.shift(), ny = list.shift();
      let guard = 0;
      while(!(nx===sx && ny===sy) && guard++ < 4e6){
        loop.push([nx,ny]);
        const l2 = edges.get(ny*W1+nx);
        if(!l2 || !l2.length) break;
        let pick = 0;
        if(l2.length > 2){ // saddle: prefer turning right (keeps diagonal pixels apart)
          const dx = nx-px, dy = ny-py; let best = -9;
          for(let i=0;i<l2.length;i+=2){ const ex=l2[i]-nx, ey=l2[i+1]-ny; const cr = dx*ey - dy*ex; const sc = cr>0?1:cr===0?0:-1; if(sc>best){best=sc;pick=i;} }
        }
        px = nx; py = ny; nx = l2[pick]; ny = l2[pick+1]; l2.splice(pick,2);
      }
      if(loop.length > 3) loops.push(loop);
      list = edges.get(k0);
    }
  }
  return loops;
}
function rdp(pts, eps){
  if(pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1;
  const st=[[0,pts.length-1]];
  while(st.length){ const [a,b]=st.pop(); const A=pts[a], B=pts[b]; const dx=B[0]-A[0], dy=B[1]-A[1], L=Math.hypot(dx,dy)||1e-9; let md=-1, mi=-1;
    for(let i=a+1;i<b;i++){ const d=Math.abs((pts[i][0]-A[0])*dy-(pts[i][1]-A[1])*dx)/L; if(d>md){md=d;mi=i;} }
    if(md>eps){ keep[mi]=1; st.push([a,mi],[mi,b]); } }
  return pts.filter((_,i)=>keep[i]);
}
function rdpClosed(loop, eps){
  if(loop.length < 6) return loop;
  let far=0, fd=-1; for(let i=1;i<loop.length;i++){ const d=Math.hypot(loop[i][0]-loop[0][0], loop[i][1]-loop[0][1]); if(d>fd){fd=d;far=i;} }
  const a = rdp(loop.slice(0,far+1), eps), b = rdp(loop.slice(far).concat([loop[0]]), eps);
  return a.slice(0,-1).concat(b.slice(0,-1));
}
function canvasLoops(cv, test, eps){
  const c = cv.getContext('2d'), {width:w, height:h} = cv, d = c.getImageData(0,0,w,h).data, m = new Uint8Array(w*h);
  for(let i=0;i<w*h;i++) m[i] = test(d[i*4],d[i*4+1],d[i*4+2],d[i*4+3]) ? 1 : 0;
  return traceMask(m,w,h).map(l=>rdpClosed(l,eps)).filter(l=>l.length>=3 && Math.abs(area(l))>2);
}

/* ---------- text → outlines (any font the browser can draw) ---------- */
const _textCache = new Map();
function textLoops(text, font, size, align='center'){
  const key = text+'|'+font+'|'+size+'|'+align;
  if(_textCache.has(key)) return _textCache.get(key);
  let ready = true;
  try{ if(document.fonts && !document.fonts.check('40px '+font)){ ready=false; document.fonts.load('40px '+font).then(f=>{ if(f && f.length){ for(const k of [..._textCache.keys()]) if(k.includes('|'+font+'|')) _textCache.delete(k); if(window.update) window.update(); } }).catch(()=>{}); } }catch(e){}
  const Pz = 150, cv = document.createElement('canvas'), c = cv.getContext('2d');
  const lines = String(text).replace(/\r/g,'').split('\n');
  c.font = Pz+'px '+font;
  const lw = lines.map(l=>c.measureText(l).width), pad = 30, lh = Pz*1.25;
  cv.width = Math.min(8000, Math.ceil(Math.max(1,...lw)) + 2*pad); cv.height = Math.min(8000, Math.ceil(lh*lines.length + Pz*0.5));
  c.font = Pz+'px '+font; c.textBaseline='middle'; c.fillStyle='#000';
  c.textAlign = align==='left'?'left':align==='right'?'right':'center';
  const ax = align==='left'?pad:align==='right'?cv.width-pad:cv.width/2;
  lines.forEach((l,i)=>c.fillText(l, ax, Pz*0.25 + lh*(i+0.5)));
  const sc = size/Pz, ox = cv.width/2, oy = cv.height/2;
  const loops = canvasLoops(cv, (r,g,b,a)=>a>127, 0.7).map(l=>l.map(([x,y])=>[(x-ox)*sc,(y-oy)*sc]));
  if(_textCache.size > 200) _textCache.clear();
  if(ready) _textCache.set(key, loops); return loops;
}
function placeLoops(loops, x, y, rotDeg, scale=1, mirror=false){
  const a = rotDeg*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a);
  return loops.map(l=>l.map(([px,py])=>{ px*=scale*(mirror?-1:1); py*=scale; return [x+px*ca-py*sa, y+px*sa+py*ca]; }));
}

/* ---------- artwork: SVG → loops via the browser's own geometry engine ---------- */
const _artCache = new Map();
function svgLoops(svgText){
  if(_artCache.has(svgText)) return _artCache.get(svgText);
  let res = {loops:[], open:[], w:1, h:1};
  try{
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if(root.nodeName.toLowerCase() !== 'svg') throw new Error('not svg');
    const host = document.createElementNS('http://www.w3.org/2000/svg','svg');
    host.setAttribute('style','position:absolute;left:-99999px;top:0;width:10px;height:10px;visibility:hidden');
    const node = document.importNode(root, true);
    node.querySelectorAll('script,foreignObject').forEach(n=>n.remove());
    host.appendChild(node); document.body.appendChild(host);
    const els = [...node.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line')];
    const hostM = host.getScreenCTM && host.getScreenCTM();
    const inv = hostM ? hostM.inverse() : null;
    const raw = []; let total = 0;
    for(const el of els){ try{ total += el.getTotalLength(); }catch(e){} }
    const step = Math.max(total/24000, 1e-3);
    for(const el of els){
      if(el.closest('defs,clipPath,mask,symbol')) continue;
      let L; try{ L = el.getTotalLength(); }catch(e){ continue; }
      if(!(L>0)) continue;
      let M = el.getScreenCTM(); if(inv && M) M = inv.multiply(M);
      const pt = host.createSVGPoint();
      const n = Math.max(8, Math.ceil(L/step)), pts = [];
      for(let i=0;i<=n;i++){ const p = el.getPointAtLength(L*i/n); pt.x=p.x; pt.y=p.y; const q = M?pt.matrixTransform(M):pt; pts.push([q.x,q.y]); }
      // split where the path jumps (new subpath)
      const segStep = L/n * (M? Math.hypot(M.a,M.b) : 1);
      let cur = [pts[0]];
      for(let i=1;i<pts.length;i++){ const d = Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]); if(d > segStep*3.5){ raw.push(cur); cur=[pts[i]]; } else cur.push(pts[i]); }
      raw.push(cur);
    }
    host.remove();
    let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
    for(const l of raw) for(const [x,y] of l){ if(x<mnx)mnx=x; if(y<mny)mny=y; if(x>mxx)mxx=x; if(y>mxy)mxy=y; }
    const w = mxx-mnx || 1, h = mxy-mny || 1, cx=(mnx+mxx)/2, cy=(mny+mxy)/2;
    const norm = l=>l.map(([x,y])=>[(x-cx)/w,(y-cy)/w]);
    const eps = Math.max(w,h)*0.0008;
    for(const l of raw){ if(l.length<2) continue; const closed = Math.hypot(l[0][0]-l[l.length-1][0], l[0][1]-l[l.length-1][1]) < Math.max(w,h)*0.004;
      if(closed){ const s=rdpClosed(l.slice(0,-1), eps); if(s.length>=3) res.loops.push(norm(s)); }
      else res.open.push(norm(rdp(l, eps))); }
    res.w = 1; res.h = h/w;
  }catch(e){ res.error = e.message; }
  _artCache.set(svgText, res); return res;
}
const _imgCache = new Map();
function getImg(src, onload){
  let im = _imgCache.get(src);
  if(!im){ im = new Image(); im.onload = ()=>onload && onload(); im.src = src; _imgCache.set(src, im); }
  return im;
}
function rasterArtLoops(src){
  const k = 'r|'+src; if(_artCache.has(k)) return _artCache.get(k);
  const im = getImg(src);
  if(!im.complete || !im.naturalWidth) return null;
  const sc = Math.min(1, 700/Math.max(im.naturalWidth, im.naturalHeight));
  const cv = document.createElement('canvas'); cv.width = Math.max(2,Math.round(im.naturalWidth*sc)); cv.height = Math.max(2,Math.round(im.naturalHeight*sc));
  const c = cv.getContext('2d'); c.drawImage(im,0,0,cv.width,cv.height);
  const loops = canvasLoops(cv, (r,g,b,a)=>a>127 && (r*0.3+g*0.59+b*0.11)<128, 0.9);
  const w = cv.width, h = cv.height;
  const res = {loops: loops.map(l=>l.map(([x,y])=>[(x-w/2)/w,(y-h/2)/w])), open:[], w:1, h:h/w};
  _artCache.set(k, res); return res;
}

/* ---------- CNC dogbones ---------- */
function dogbone(p, r, isHole){
  if(!(r>0) || p.length<3) return p;
  const s = area(p)>0?1:-1, n=p.length, out=[], k=r*Math.SQRT2;
  for(let i=0;i<n;i++){
    const A=p[(i-1+n)%n], V=p[i], B=p[(i+1)%n];
    const la=Math.hypot(V[0]-A[0],V[1]-A[1]), lb=Math.hypot(B[0]-V[0],B[1]-V[1]);
    const a=[(V[0]-A[0])/la,(V[1]-A[1])/la], b=[(B[0]-V[0])/lb,(B[1]-V[1])/lb];
    const cr=a[0]*b[1]-a[1]*b[0], dot=a[0]*b[0]+a[1]*b[1];
    const voidCorner = isHole ? cr*s>0 : cr*s<0;
    if(!voidCorner || Math.abs(dot)>0.35 || la<k*1.02 || lb<k*1.02){ out.push(V); continue; }
    const e1=[-a[0],-a[1]], e2=b; let d=[e1[0]+e2[0],e1[1]+e2[1]]; const dl=Math.hypot(d[0],d[1]); d=[d[0]/dl,d[1]/dl];
    const c=[V[0]+d[0]*r, V[1]+d[1]*r], P1=[V[0]+e1[0]*k, V[1]+e1[1]*k], P2=[V[0]+e2[0]*k, V[1]+e2[1]*k];
    const t1=Math.atan2(P1[1]-c[1],P1[0]-c[0]), t2=Math.atan2(P2[1]-c[1],P2[0]-c[0]), tm=Math.atan2(-d[1],-d[0]);
    const TAU=2*Math.PI, md=x=>((x%TAU)+TAU)%TAU;
    let sw=md(t2-t1); if(md(tm-t1) > sw) sw = sw - TAU;
    out.push(P1); const segs=10; for(let j=1;j<segs;j++){ const t=t1+sw*j/segs; out.push([c[0]+r*Math.cos(t), c[1]+r*Math.sin(t)]); } out.push(P2);
  }
  return out;
}

/* ---------- decorative cut-through patterns ---------- */
function rng(seed){ let a = (seed|0) || 1; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function regPoly(cx,cy,r,n,rot){ const p=[]; for(let i=0;i<n;i++){ const a=rot+2*Math.PI*i/n; p.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]); } return p; }
function clipHalf(poly, px,py, nx,ny){ // keep points with (p-P)·n <= 0
  const out=[]; for(let i=0;i<poly.length;i++){ const A=poly[i], B=poly[(i+1)%poly.length];
    const da=(A[0]-px)*nx+(A[1]-py)*ny, db=(B[0]-px)*nx+(B[1]-py)*ny;
    if(da<=0) out.push(A);
    if((da<0&&db>0)||(da>0&&db<0)){ const t=da/(da-db); out.push([A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t]); } }
  return out;
}
function decoShapes(type, x0,y0,x1,y1, cell, web, seed, avoid){
  const W=x1-x0, H=y1-y0, shapes=[]; if(W<cell*0.6||H<cell*0.6) return shapes;
  const R=rng(seed), cx0=(x0+x1)/2, cy0=(y0+y1)/2;
  const grid=(dx,dy,stagger,fn)=>{ const nx=Math.ceil(W/dx)+2, ny=Math.ceil(H/dy)+2;
    for(let j=-ny;j<=ny;j++) for(let i=-nx;i<=nx;i++){ const x=cx0+i*dx+(stagger&&(j&1)?dx/2:0), y=cy0+j*dy; const s=fn(x,y,i,j); if(s) shapes.push(s); } };
  if(type==='hex'){ const r=cell/2; const ri=r-web/(2*Math.cos(Math.PI/6)); if(ri>1) grid(r*Math.sqrt(3), r*1.5, true, (x,y)=>regPoly(x,y,ri,6,Math.PI/6)); }
  else if(type==='lattice'){ const h=cell/2-web*0.71; if(h>1) grid(cell,cell/2,true,(x,y)=>[[x,y-h],[x+h,y],[x,y+h],[x-h,y]]); }
  else if(type==='circles'){ const r=Math.max(1,cell/2-web/2); grid(cell, cell*0.866, true, (x,y)=>regPoly(x,y,r,24,0)); }
  else if(type==='slots'){ const w=Math.max(1.5,cell*0.32), h=cell*1.6; grid(cell*0.75,h+web*1.4,true,(x,y)=>stadiumV(x,y,w,h)); }
  else if(type==='stars'){ const ro=cell*0.46-web/2, ri=ro*0.42; if(ro>2) grid(cell,cell*0.9,true,(x,y)=>{ const p=[]; for(let k=0;k<10;k++){ const a=-Math.PI/2+k*Math.PI/5, r=k%2?ri:ro; p.push([x+r*Math.cos(a),y+r*Math.sin(a)]); } return p; }); }
  else if(type==='leaves'){ const L=cell*0.46-web/2, wd=cell*0.2; if(L>2) grid(cell*0.8,cell*0.75,true,(x,y,i,j)=>{ const a=((i+j)&1?0.6:-0.6)+Math.PI/2, p=[]; for(let k=0;k<=12;k++){ const t=k/12; p.push([L*(2*t-1), wd*Math.sin(Math.PI*t)]); } for(let k=11;k>0;k--){ const t=k/12; p.push([L*(2*t-1), -wd*Math.sin(Math.PI*t)]); } return p.map(([u,v])=>[x+u*Math.cos(a)-v*Math.sin(a), y+u*Math.sin(a)+v*Math.cos(a)]); }); }
  else if(type==='voronoi'){
    const seeds=[]; const nx=Math.max(1,Math.round(W/cell)), ny=Math.max(1,Math.round(H/cell));
    for(let j=0;j<ny;j++) for(let i=0;i<nx;i++) seeds.push([x0+(i+0.15+R()*0.7)*W/nx, y0+(j+0.15+R()*0.7)*H/ny]);
    for(const s of seeds){ let poly=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
      for(const q of seeds){ if(q===s) continue; const mx=(s[0]+q[0])/2, my=(s[1]+q[1])/2; poly=clipHalf(poly,mx,my,q[0]-s[0],q[1]-s[1]); if(poly.length<3) break; }
      if(poly.length<3) continue; const sh=offsetPoly(poly,-web/2); if(Math.abs(area(sh))>web*web*2 && Math.sign(area(sh))===Math.sign(area(poly))) shapes.push(roundPoly(sh,Math.min(web,cell*0.12))); }
    return shapes.filter(sp=>okShape(sp,x0,y0,x1,y1,avoid,web));
  }
  return shapes.filter(sp=>okShape(sp,x0,y0,x1,y1,avoid,web));
}
function stadiumV(cx,cy,w,h){ const r=w/2, L=Math.max(0,h/2-r), p=[]; for(let i=0;i<=8;i++){ const a=Math.PI+Math.PI*i/8; p.push([cx+r*Math.cos(a), cy-L+r*Math.sin(a)]); } for(let i=0;i<=8;i++){ const a=Math.PI*i/8; p.push([cx+r*Math.cos(a), cy+L+r*Math.sin(a)]); } return p; }
function roundPoly(p, r){ // soften corners of a convex polygon
  if(r<=0.2) return p; const out=[], n=p.length;
  for(let i=0;i<n;i++){ const A=p[(i-1+n)%n], V=p[i], B=p[(i+1)%n]; const la=Math.hypot(V[0]-A[0],V[1]-A[1]), lb=Math.hypot(B[0]-V[0],B[1]-V[1]); const rr=Math.min(r,la/2.2,lb/2.2);
    const P1=[V[0]+(A[0]-V[0])/la*rr, V[1]+(A[1]-V[1])/la*rr], P2=[V[0]+(B[0]-V[0])/lb*rr, V[1]+(B[1]-V[1])/lb*rr];
    for(let k=0;k<=4;k++){ const t=k/4, u=1-t; out.push([u*u*P1[0]+2*u*t*V[0]+t*t*P2[0], u*u*P1[1]+2*u*t*V[1]+t*t*P2[1]]); } }
  return out;
}
function okShape(sp,x0,y0,x1,y1,avoid,web){
  for(const [x,y] of sp) if(x<x0||x>x1||y<y0||y>y1) return false;
  const b=bbox(sp);
  for(const a of avoid) if(b.x<a.x+a.w+web && b.x+b.w>a.x-web && b.y<a.y+a.h+web && b.y+b.h>a.y-web) return false;
  return true;
}

/* ---------- hold tabs: break an outline into polylines with small gaps ---------- */
function gapOutline(pts, count, gw){
  if(!(count>0) || pts.length<3) return null;
  const segs=pts.map((p,i)=>{ const q=pts[(i+1)%pts.length]; return {i,len:Math.hypot(q[0]-p[0],q[1]-p[1])}; }).filter(s=>s.len>gw*4+2).sort((a,b)=>b.len-a.len);
  if(!segs.length) return null;
  // spread picks around the part: take longest, then skip neighbours
  const picks=[]; for(const s of segs){ if(picks.length>=count) break; if(picks.every(p=>Math.min(Math.abs(p-s.i), pts.length-Math.abs(p-s.i))>1)) picks.push(s.i); }
  const gapAt=new Map(picks.map(i=>[i,true]));
  const lines=[]; let cur=[];
  const start=(picks[0]+1)%pts.length; // begin right after the first gap segment's start vertex
  // walk from the far end of first gap
  const n=pts.length;
  const first=picks[0], A=pts[first], B=pts[(first+1)%n], L=Math.hypot(B[0]-A[0],B[1]-A[1]);
  const mid=(t)=>[A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t];
  cur=[mid(0.5+gw/2/L)];
  for(let k=1;k<=n;k++){ const i=(first+k)%n; const P=pts[i];
    cur.push(P);
    if(gapAt.has(i)){ const Q=pts[(i+1)%n], l=Math.hypot(Q[0]-P[0],Q[1]-P[1]);
      const m1=[P[0]+(Q[0]-P[0])*(0.5-gw/2/l), P[1]+(Q[1]-P[1])*(0.5-gw/2/l)], m2=[P[0]+(Q[0]-P[0])*(0.5+gw/2/l), P[1]+(Q[1]-P[1])*(0.5+gw/2/l)];
      if(i===first){ cur.pop(); cur.push(P, m1); lines.push(cur); break; }
      cur.push(m1); lines.push(cur); cur=[m2]; }
  }
  return lines;
}

/* ---------- MaxRects nesting with hole filling ---------- */
function maxRectsPack(items, SW, SH, g, allowRot){
  const sheets=[], warns=[];
  const split=(free,u)=>{ const out=[];
    for(const f of free){
      if(u.x>=f.x+f.w||u.x+u.w<=f.x||u.y>=f.y+f.h||u.y+u.h<=f.y){ out.push(f); continue; }
      if(u.x>f.x) out.push({x:f.x,y:f.y,w:u.x-f.x,h:f.h});
      if(u.x+u.w<f.x+f.w) out.push({x:u.x+u.w,y:f.y,w:f.x+f.w-u.x-u.w,h:f.h});
      if(u.y>f.y) out.push({x:f.x,y:f.y,w:f.w,h:u.y-f.y});
      if(u.y+u.h<f.y+f.h) out.push({x:f.x,y:u.y+u.h,w:f.w,h:f.y+f.h-u.y-u.h});
    }
    return out.filter((a,i)=>a.w>0.5&&a.h>0.5&&!out.some((b,j)=>j!==i&&b.x<=a.x+1e-6&&b.y<=a.y+1e-6&&b.x+b.w>=a.x+a.w-1e-6&&b.y+b.h>=a.y+a.h-1e-6&&(j<i||!(a.x===b.x&&a.y===b.y&&a.w===b.w&&a.h===b.h))));
  };
  const newSheet=()=>{ const sh={free:[{x:g,y:g,w:SW-g,h:SH-g}],items:[]}; sheets.push(sh); return sh; };
  items.sort((a,b)=>Math.max(b.w,b.h)*Math.min(b.w,b.h)-Math.max(a.w,a.h)*Math.min(a.w,a.h));
  for(const it of items){
    let best=null;
    const tryIn=(sh,si)=>{ for(const f of sh.free) for(const rot of (allowRot?[false,true]:[false])){
      const w=(rot?it.h:it.w)+g, h=(rot?it.w:it.h)+g; if(w<=f.w+1e-6 && h<=f.h+1e-6){
        const sc=Math.min(f.w-w,f.h-h)+ (si*1e6); if(!best||sc<best.sc) best={sc,sh,f,rot}; } } };
    sheets.forEach(tryIn);
    if(!best){ const sh=newSheet(); tryIn(sh,sheets.length-1);
      if(!best){ warns.push(it); best={sh,f:sh.free[0],rot:allowRot && it.h<it.w===false && it.w<=SW-2*g? false:false}; } }
    const {sh,f,rot}=best; it.x=f.x; it.y=f.y; it.rot=rot; if(rot){ const t=it.w; it.w=it.h; it.h=t; }
    sh.items.push(it);
    sh.free=split(sh.free,{x:it.x,y:it.y,w:it.w+g,h:it.h+g});
    // nest small parts inside big rectangular holes of this part
    for(const hole of it.f.holes||[]){ const hb=bbox(hole); const ar=Math.abs(area(hole));
      if(hb.w>18 && hb.h>18 && ar>0.88*hb.w*hb.h){ const c1=xformPt(it,[hb.x,hb.y]), c2=xformPt(it,[hb.x+hb.w,hb.y+hb.h]);
        const r={x:Math.min(c1[0],c2[0])+g, y:Math.min(c1[1],c2[1])+g, w:Math.abs(c2[0]-c1[0])-g, h:Math.abs(c2[1]-c1[1])-g};
        if(r.w>8&&r.h>8) sh.free.push(r); } }
  }
  return {sheets,warns};
}

/* ---------- corner accents (unit art: corner at 0,0 filling [0,1]²) ---------- */
const ACCENTS={bracket:'Simple bracket',double:'Double line + diamond',deco:'Art Deco steps',fan:'Sunburst fan',filigree:'Filigree scroll',leaf:'Leaf sprig',triangle:'Solid triangle',dots:'Dot cascade',chevron:'Chevrons',star:'Star + rules',scallop:'Scalloped edge'};
function _arc(cx,cy,r,a0,a1,n=18){ const p=[]; for(let i=0;i<=n;i++){ const a=a0+(a1-a0)*i/n; p.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]); } return p; }
function accentGeom(style){
  const L=[], F=[], P2=Math.PI/2;
  const lens=(cx,cy,len,wd,ang)=>{ const p=[]; for(let k=0;k<=10;k++){ const t=k/10; p.push([len*(t-0.5), wd*Math.sin(Math.PI*t)]); } for(let k=9;k>0;k--){ const t=k/10; p.push([len*(t-0.5), -wd*Math.sin(Math.PI*t)]); } return p.map(([u,v])=>[cx+u*Math.cos(ang)-v*Math.sin(ang), cy+u*Math.sin(ang)+v*Math.cos(ang)]); };
  const disc=(cx,cy,r)=>_arc(cx,cy,r,0,2*Math.PI,20).slice(0,20);
  switch(style){
    case 'bracket': L.push([[0,1],[0,0],[1,0]], [[0.2,0.72],[0.2,0.2],[0.72,0.2]]); break;
    case 'double': L.push([[0,1],[0,0],[1,0]], [[0.13,0.95],[0.13,0.13],[0.95,0.13]]); F.push([[0.34,0.22],[0.46,0.34],[0.34,0.46],[0.22,0.34]]); break;
    case 'deco': L.push([[0,1],[0,0],[1,0]], [[0.15,0.8],[0.15,0.15],[0.8,0.15]], [[0.3,0.58],[0.3,0.3],[0.58,0.3]]); F.push([[0.42,0.42],[0.54,0.42],[0.54,0.54],[0.42,0.54]]); break;
    case 'fan': F.push([[0,0],..._arc(0,0,0.22,0,P2,10)]); for(const r of [0.42,0.62,0.84]) L.push(_arc(0,0,r,0,P2,22)); for(let k=1;k<5;k++){ const a=k*P2/5; L.push([[0.3*Math.cos(a),0.3*Math.sin(a)],[0.84*Math.cos(a),0.84*Math.sin(a)]]); } break;
    case 'filigree': { const arm=[]; arm.push([0.98,0.02],[0.6,0.02]); const cx=0.4, cy=0.2; for(let k=0;k<=40;k++){ const t=k/40, a=-P2-t*Math.PI*2.4, r=0.18*(1-t*0.78); arm.push([cx+r*Math.cos(a), cy+0.0+r*Math.sin(a)+0.0]); }
      L.push(arm, arm.map(([x,y])=>[y,x])); F.push(disc(0.11,0.11,0.06)); break; }
    case 'leaf': { const st=[]; for(let k=0;k<=20;k++){ const t=k/20; st.push([0.06+0.78*t, 0.06+0.78*t+0.08*Math.sin(Math.PI*t)]); } L.push(st);
      [[0.3,1],[0.45,-1],[0.6,1],[0.74,-1]].forEach(([t,sd])=>{ const x=0.06+0.78*t, y=0.06+0.78*t+0.08*Math.sin(Math.PI*t); const a=Math.PI/4+sd*0.85; F.push(lens(x+Math.cos(a)*0.09, y+Math.sin(a)*0.09, 0.2, 0.055, a)); });
      F.push(lens(0.88,0.9,0.18,0.05,Math.PI/4)); break; }
    case 'triangle': F.push([[0,0],[0.5,0],[0,0.5]]); L.push([[0.7,0],[0,0.7]]); F.push(disc(0.42,0.42,0.04)); break;
    case 'dots': for(let i=0;i<4;i++) for(let j=0;j<4-i;j++){ const r=0.085*(1-(i+j)*0.2); F.push(disc(0.1+0.24*i, 0.1+0.24*j, r)); } break;
    case 'chevron': for(let k=0;k<3;k++){ const d=0.32+0.25*k; L.push([[d,0],[d*0.42,d*0.42],[0,d]]); } F.push([[0,0],[0.16,0],[0,0.16]]); break;
    case 'star': { const p=[]; for(let k=0;k<16;k++){ const a=k*Math.PI/8, r=k%2?0.085:0.22; p.push([0.3+r*Math.cos(a),0.3+r*Math.sin(a)]); } F.push(p); L.push([[0.6,0.3],[1,0.3]],[[0.3,0.6],[0.3,1]]); break; }
    case 'scallop': { const a=[], b=[]; for(let k=0;k<4;k++){ const c=0.12+0.24*k; a.push(..._arc(c,0,0.12,Math.PI,0,10).map(([x,y])=>[x,-y+0.0]).map(([x,y])=>[x,Math.abs(y)])); }
      L.push(a, a.map(([x,y])=>[y,x])); F.push(disc(0.12,0.12,0.05)); break; }
  }
  return {L,F};
}
function ribbon(pl,w){
  if(pl.length<2) return null; const n=pl.length, left=[], right=[];
  for(let i=0;i<n;i++){
    const a=pl[Math.max(0,i-1)], b=pl[i], c=pl[Math.min(n-1,i+1)];
    let d1=[b[0]-a[0],b[1]-a[1]], d2=[c[0]-b[0],c[1]-b[1]]; const l1=Math.hypot(...d1)||1, l2=Math.hypot(...d2)||1; d1=[d1[0]/l1,d1[1]/l1]; d2=[d2[0]/l2,d2[1]/l2];
    if(i===0) d1=d2; if(i===n-1) d2=d1;
    let nx=-(d1[1]+d2[1]), ny=d1[0]+d2[0]; const nl=Math.hypot(nx,ny)||1; nx/=nl; ny/=nl;
    const cs=Math.max(0.35, nx*(-d2[1])+ny*d2[0]); const k=w/2/cs;
    left.push([b[0]+nx*k,b[1]+ny*k]); right.push([b[0]-nx*k,b[1]-ny*k]);
  }
  return left.concat(right.reverse());
}
