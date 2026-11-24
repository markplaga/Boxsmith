'use strict';
/* ================= STATE ================= */
const TYPES=Boxsmith.boxes.list();
const DEFAULTS=Boxsmith.boxes.defaults();
let S = Object.assign({}, DEFAULTS);
try{ const saved = JSON.parse(localStorage.getItem('boxsmith-v1')||'null'); if(saved) S = Object.assign({}, DEFAULTS, saved);}catch(e){}
function save(){ if(window.BOX && window.BOX.noSave) return; try{ localStorage.setItem('boxsmith-v1', JSON.stringify(S)); }catch(e){} }

/* ================= GEOMETRY HELPERS ================= */
const PI = Math.PI;
const V = (x,y,z)=>[x,y,z];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const X=[1,0,0], Y=[0,1,0], Z=[0,0,1], nZ=[0,0,-1];
function rect(x,y,w,h){ return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]; }
function arc(cx,cy,r,a0,a1,n){ const p=[]; for(let i=0;i<=n;i++){ const a=a0+(a1-a0)*i/n; p.push([cx+r*Math.cos(a), cy+r*Math.sin(a)]);} return p; }
function stadium(cx,cy,w,h){ // horizontal slot
  const r=h/2, L=Math.max(0,w/2-r);
  return [...arc(cx+L,cy,r,-PI/2,PI/2,10), ...arc(cx-L,cy,r,PI/2,3*PI/2,10)];
}
function roundRect(cx,cy,hw,hh,r,seg=12){
  r=Math.max(0.01,Math.min(r,hw,hh));
  return [...arc(cx+hw-r,cy-hh+r,r,-PI/2,0,seg), ...arc(cx+hw-r,cy+hh-r,r,0,PI/2,seg), ...arc(cx-hw+r,cy+hh-r,r,PI/2,PI,seg), ...arc(cx-hw+r,cy-hh+r,r,PI,1.5*PI,seg)];
}
function rotRect(cx,cy,len,wid,dx,dy){ // rectangle centered at c, long axis along (dx,dy)
  const nx=-dy, ny=dx, a=len/2, b=wid/2;
  return [[cx-dx*a-nx*b,cy-dy*a-ny*b],[cx+dx*a-nx*b,cy+dy*a-ny*b],[cx+dx*a+nx*b,cy+dy*a+ny*b],[cx-dx*a+nx*b,cy-dy*a+ny*b]];
}
function area(p){ let a=0; for(let i=0;i<p.length;i++){ const q=p[i], r=p[(i+1)%p.length]; a+=q[0]*r[1]-r[0]*q[1]; } return a/2; }
function clean(p){
  let o=[];
  for(const q of p){ const l=o[o.length-1]; if(!l || Math.hypot(q[0]-l[0],q[1]-l[1])>1e-6) o.push(q); }
  while(o.length>2 && Math.hypot(o[0][0]-o[o.length-1][0],o[0][1]-o[o.length-1][1])<1e-6) o.pop();
  let changed=true;
  while(changed && o.length>3){ changed=false;
    for(let i=0;i<o.length;i++){ const a=o[(i-1+o.length)%o.length], b=o[i], c=o[(i+1)%o.length];
      const cr=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
      const dt=(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]);
      if(Math.abs(cr)<1e-7 && dt>0){ o.splice(i,1); changed=true; break; }
    } }
  return o;
}
function offsetPoly(p,d){ // d>0 grows the enclosed region
  if(!d) return p.map(q=>[q[0],q[1]]);
  const s=area(p)>0?1:-1, n=p.length, N=[];
  for(let i=0;i<n;i++){ const a=p[i], b=p[(i+1)%n]; const dx=b[0]-a[0], dy=b[1]-a[1], L=Math.hypot(dx,dy)||1; N.push([s*dy/L, -s*dx/L]); }
  return p.map((q,i)=>{ const n1=N[(i-1+n)%n], n2=N[i]; let k=1+n1[0]*n2[0]+n1[1]*n2[1]; if(k<0.1)k=0.1; return [q[0]+(n1[0]+n2[0])*d/k, q[1]+(n1[1]+n2[1])*d/k]; });
}
function bbox(pts){ let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity; for(const p of pts){ if(p[0]<a)a=p[0]; if(p[1]<b)b=p[1]; if(p[0]>c)c=p[0]; if(p[1]>d)d=p[1]; } return {x:a,y:b,w:c-a,h:d-b}; }
function perim(p,closed=true){ let L=0; for(let i=0;i<p.length-(closed?0:1);i++){ const a=p[i], b=p[(i+1)%p.length]; L+=Math.hypot(b[0]-a[0],b[1]-a[1]); } return L; }

/* ================= FINGER JOINT ENGINE ================= */
let G; // geometry context: {t, fw}
function fingerBounds(L){
  const t=G.t, inner=L-2*t;
  if(inner<=G.fw*0.6) return [0,L];
  let n=Math.round(inner/G.fw); if(n<1)n=1;
  if(n%2===0) n += (inner/G.fw>=n)?1:-1;
  if(n<1) n=1;
  const s=inner/n, b=[0]; for(let i=1;i<n;i++) b.push(t+i*s); b.push(L); return b;
}
function edgeProfile(e,L){
  if(!e||e==='plain') return [[0,0],[L,0]];
  if(e==='M'||e==='F'){ const b=fingerBounds(L), p=[], n=b.length-1, T=G.ts, t=G.t;
    const tsIdx = (T && n>=5) ? new Set([2,n-3, ...(n>=11 && ((n-1)/2)%2===0 ? [(n-1)/2] : [])]) : null;
    if(tsIdx) p.circles=[];
    for(let i=0;i<n;i++){ const d=((i%2===0)===(e==='M'))?0:t;
      if(tsIdx && tsIdx.has(i) && b[i+1]-b[i] > T.nw+1){ const c=(b[i]+b[i+1])/2;
        if(e==='M'){ p.push([b[i],d],[b[i+1],d]); p.circles.push([c,t/2,T.d/2]); continue; }
        const Ls=Math.max(T.nt+4, S.screwLen-t+1), a=Math.max(2, Ls-T.nt-2), sd=T.d/2, nw=T.nw/2;
        p.push([b[i],d],[c-sd,d],[c-sd,d+a],[c-nw,d+a],[c-nw,d+a+T.nt],[c-sd,d+a+T.nt],[c-sd,d+Ls],[c+sd,d+Ls],[c+sd,d+a+T.nt],[c+nw,d+a+T.nt],[c+nw,d+a],[c+sd,d+a],[c+sd,d],[b[i+1],d]);
        continue; }
      p.push([b[i],d],[b[i+1],d]); }
    return p; }
  if(e.pts) return e.pts;
  if(e.fe){ // even finger count: tab at one end, gap at the other
    const t=G.t, inner=L-2*t; let n=Math.max(2,Math.round(inner/G.fw)); if(n%2) n+=(inner/G.fw>=n)?1:-1; if(n<2) n=2;
    const sg=inner/n, b=[0]; for(let i=1;i<n;i++) b.push(t+i*sg); b.push(L);
    const p=[]; for(let i=0;i<n;i++){ const d=((i%2===0)===e.tabStart)?0:t; p.push([b[i],d],[b[i+1],d]); } return p; }
  return [[0,0],[L,0]];
}
// edges: [top(y=0), right(x=Lu), bottom(y=Lv), left(x=0)]
function panelOutline(Lu,Lv,edges){
  const E=[{P:[0,0],u:[1,0],n:[0,1],L:Lu},{P:[Lu,0],u:[0,1],n:[-1,0],L:Lv},{P:[Lu,Lv],u:[-1,0],n:[0,-1],L:Lu},{P:[0,Lv],u:[0,-1],n:[1,0],L:Lv}];
  const pr=edges.map((e,i)=>edgeProfile(e,E[i].L)), out=[], circ=[];
  for(let i=0;i<4;i++){
    const prev=pr[(i+3)%4], next=pr[(i+1)%4];
    const sMin=Math.max(0,prev[prev.length-1][1]), sMax=E[i].L-Math.max(0,next[0][1]);
    const {P,u,n}=E[i];
    for(const [s,d] of pr[i]){ const ss=Math.min(Math.max(s,sMin),sMax); out.push([P[0]+u[0]*ss+n[0]*d, P[1]+u[1]*ss+n[1]*d]); }
    if(pr[i].circles) for(const [s,d,r] of pr[i].circles) circ.push({x:P[0]+u[0]*s+n[0]*d, y:P[1]+u[1]*s+n[1]*d, r, ts:true});
  }
  const res=clean(out); res.circles=circ; return res;
}
function tabEdge(L,centers,tw,depth){ // protruding tabs (depth negative = outward)
  const p=[[0,0]];
  for(const c of centers){ p.push([c-tw/2,0],[c-tw/2,depth],[c+tw/2,depth],[c+tw/2,0]); }
  p.push([L,0]); return {pts:p};
}

/* ================= PART MODEL ================= */
function part(name, outline, o={}){
  const p=Object.assign({name, outline, holes:[], circles:[], slits:[], texts:[], marks:[], map:null, solids:null, noKerf:false, th:G.t, mat:G.mat||'main'}, o);
  if(outline && outline.circles && outline.circles.length){ p.circles=p.circles.concat(outline.circles); p.tsHoles=outline.circles.filter(c=>c.ts); }
  return p;
}
const mapOf=(o,u,v,n)=>({o,u,v,n});

/* buildBox: generic finger-jointed box from up to six faces */
function buildBox(P){
  const {W,D,H,f,ox=0,oy=0,oz=0,pre=''}=P, t=G.t, out={};
  const c=P.custom||{}, hl=P.holes||{};
  const pl=(has)=>has?'F':'plain';
  const plateEdges=[pl(f.front),pl(f.right),pl(f.back),pl(f.left)];
  if(f.bottom) out.bottom=part(pre+'Bottom', panelOutline(W,D,plateEdges), {map:mapOf([ox,oy,oz],X,Y,Z), holes:hl.bottom||[], kind:'plate', role:'plate', size:[W,D]});
  if(f.top) out.top=part(pre+'Top', panelOutline(W,D,plateEdges), {map:mapOf([ox,oy,oz+H-t],X,Y,Z), holes:hl.top||[], kind:'plate', top:true, role:'lid', size:[W,D]});
  const pin=S.corners==='edge', dia=S.corners==='pinwheel';
  // diagonal pinwheel: each wall owns one top and one bottom corner, at opposite ends
  // e1 (x=Lu) runs top→bottom, e3 (x=0) runs bottom→top
  const fe=(ownsTop,idx)=>({fe:true,tabStart: idx===1?ownsTop:!ownsTop});
  // pinwheel: front owns front-left, right owns front-right, back owns back-right, left owns back-left
  const fb=(name,key,y)=>{
    const eR= pin ? (key==='front'?'F':'M') : 'M', eL= pin ? (key==='front'?'M':'F') : 'M';
    const dR= key==='front'?fe(false,1):fe(true,1), dL= key==='front'?fe(true,3):fe(false,3);
    const e=[c[key+'_top']||(f.top?'M':'plain'), f.right?(dia?dR:eR):'plain', f.bottom?'M':'plain', f.left?(dia?dL:eL):'plain'];
    out[key]=part(pre+name, panelOutline(W,H,e), {map:mapOf([ox,oy+y,oz+H],X,nZ,Y), holes:hl[key]||[], circles:(P.circles||{})[key]||[], role:'wall', size:[W,H]});
  };
  if(f.front) fb('Front','front',0);
  if(f.back) fb('Back','back',D-t);
  const sd=(name,key,x)=>{
    const eB= pin ? (key==='left'?'M':'F') : 'F', eF= pin ? (key==='right'?'M':'F') : 'F';
    const dB= key==='left'?fe(true,1):fe(false,1), dF= key==='right'?fe(true,3):fe(false,3);
    const e=[c[key+'_top']||(f.top?'M':'plain'), f.back?(dia?dB:eB):'plain', f.bottom?'M':'plain', f.front?(dia?dF:eF):'plain'];
    out[key]=part(pre+name, panelOutline(D,H,e), {map:mapOf([ox+x,oy,oz+H],Y,nZ,X), holes:hl[key]||[], circles:(P.circles||{})[key]||[], role:'wall', size:[D,H]});
  };
  if(f.left) sd('Left side','left',0);
  if(f.right) sd('Right side','right',W-t);
  return out;
}

/* dividers: egg-crate half-lap grid inside an interior space */
function makeDividers(ox,oy,oz,Wi,Di,Hi,cols,rows,pct,pre=''){
  const t=G.t, c=Math.max(0.2,S.clr), parts=[];
  cols=Math.max(1,cols|0); rows=Math.max(1,rows|0);
  if(cols===1&&rows===1) return parts;
  const hd=Math.max(10,Hi*pct/100);
  const cw=(Wi-(cols-1)*t)/cols, rh=(Di-(rows-1)*t)/rows;
  const xs=[], ys=[];
  for(let i=1;i<cols;i++) xs.push(i*cw+(i-1)*t);
  for(let j=1;j<rows;j++) ys.push(j*rh+(j-1)*t);
  const Lfb=Di-c, Llr=Wi-c;
  xs.forEach((x,i)=>{ // front-back dividers, slots from top
    const p=[[0,0]];
    if(rows>1) for(const y of ys){ const a=y-c/2; p.push([a,0],[a,hd/2],[a+t,hd/2],[a+t,0]); }
    p.push([Lfb,0],[Lfb,hd],[0,hd]);
    parts.push(part(pre+'Divider ↕ '+(i+1), clean(p), {map:mapOf([ox+x,oy+c/2,oz+hd],Y,nZ,X), explode:{lift:1.0+(cols>1&&rows>1?0:0)}}));
  });
  ys.forEach((y,j)=>{ // left-right dividers, slots from bottom
    const p=[[0,0],[Llr,0],[Llr,hd]];
    if(cols>1) for(const x of [...xs].reverse()){ const a=x-c/2; p.push([a+t,hd],[a+t,hd/2],[a,hd/2],[a,hd]); }
    p.push([0,hd]);
    parts.push(part(pre+'Divider ↔ '+(j+1), clean(p), {map:mapOf([ox+c/2,oy+y,oz+hd],X,nZ,Y), explode:{lift:cols>1?1.75:1.0}}));
  });
  return parts;
}
function addText(p,w,h,rot180){
  if(!S.text) return;
  p.texts.push({x:w/2,y:h/2,size:S.textSize,text:S.text,rot:rot180?180:0,main:true});
}
function handleHoles(D,H){
  const hw=Math.min(75,D*0.42), hh=Math.min(+S.handleH||22,H*0.3);
  if(D-2*G.t<hw+16 || H<hh+30) return [];
  return [stadium(D/2, Math.max(G.t+hh/2+6, Math.min(16+hh/2,H*0.3)), hw, hh)];
}

function hingeSlits(z0,z1,Hw,pitch,bridge){
  pitch=Math.max(0.8,pitch); const br=Math.max(1,bridge), slits=[];
  const m=Math.max(1,Math.round(Hw/(Math.max(8,Hw/4)+br))), Pd=Hw/m, cut=Pd-br;
  const cnt=Math.floor((z1-z0)/pitch), st=z0+((z1-z0)-cnt*pitch)/2;
  for(let j=0;j<=cnt;j++){ const x=st+j*pitch;
    if(j%2===0){ for(let k=0;k<=m;k++){ const y0=Math.max(0,k*Pd-cut/2), y1=Math.min(Hw,k*Pd+cut/2); if(y1-y0>0.3) slits.push([[x,y0],[x,y1]]); } }
    else for(let k=0;k<m;k++){ const cy=(k+0.5)*Pd; slits.push([[x,cy-cut/2],[x,cy+cut/2]]); } }
  return slits;
}
/* ================= BOX TYPES ================= */
function generate(){
  const t=G.t, warns=[], notes=[]; let parts=[];
  const ins=S.dimMode==='inside';
  let W=S.W, D=S.D, H=S.H;
  const ty=S.type, c=S.clr;
  const hAdd={closed:2*t,open:t,liftoff:t,split:2*t,sliding:t,hinged:2*t,drawer:2*t,pencil:t,card:t,nested:t,puzzle:t}[ty]||0;
  if(ins && hAdd){ W+=2*t; D+= ty==='drawer'? t : 2*t; H+=hAdd; }
  let info={W,D,H};
  const fAll={bottom:1,top:1,front:1,back:1,left:1,right:1};
  const fOpen={bottom:1,front:1,back:1,left:1,right:1};
  if(G.fw<2*t) warns.push('Finger width is under 2× thickness — fingers may snap. Try '+fmt(2.5*t)+' or more.');
  const inner=(h)=>({W:W-2*t,D:D-2*t,H:h});

  if(ty==='closed'){
    const b=buildBox({W,D,H,f:fAll}); addText(b.top,W,D,true); parts=Object.values(b);
    info.inner=inner(H-2*t);
    notes.push('Glue or press-fit the four walls onto the bottom, then press the top on last. For a box that opens, try Lift-off or Hinged.');
  }
  else if(ty==='open'){
    const hl={}, cu={};
    if(S.handles){ hl.left=handleHoles(D,H); hl.right=handleHoles(D,H); }
    if(S.notch){ const rx=Math.min(14,W*0.12), ry=Math.max(2,Math.min(+S.notchH||14,H*0.4)); const U=[]; for(let k=0;k<=16;k++){ const th=PI*k/16; U.push([W/2-rx*Math.cos(th), ry*Math.sin(th)]); } cu.front_top={pts:[[0,0],[W/2-rx,0],...U,[W/2+rx,0],[W,0]]}; }
    const b=buildBox({W,D,H,f:fOpen,holes:hl,custom:cu}); addText(b.front,W,H,false); parts=Object.values(b);
    parts.push(...makeDividers(t,t,t,W-2*t,D-2*t,H-t,S.cols,S.rows,S.divPct));
    info.inner=inner(H-t);
    notes.push('Four walls press onto the base; the front/back panels own the corners.');
  }
  else if(ty==='liftoff'){
    const hl={}, cu={}; if(S.handles){ hl.left=handleHoles(D,H); hl.right=handleHoles(D,H); }
    if(S.notch){ const rx=Math.min(14,W*0.12), ry=Math.max(2,Math.min(+S.notchH||14,H*0.4)); const U=[]; for(let k=0;k<=16;k++){ const th=PI*k/16; U.push([W/2-rx*Math.cos(th), ry*Math.sin(th)]); } cu.front_top={pts:[[0,0],[W/2-rx,0],...U,[W/2+rx,0],[W,0]]}; }
    const b=buildBox({W,D,H,f:fOpen,holes:hl,custom:cu}); parts=Object.values(b);
    const ov=Math.max(0,S.overhang);
    const rw=Math.max(3,S.ringW), Wr=W-2*t-2*c, Dr=D-2*t-2*c;
    const lid=part('Lid', rect(0,0,W+2*ov,D+2*ov), {map:mapOf([-ov,-ov,H],X,Y,Z), kind:'plate', top:true, role:'lid', plainRect:true}); addText(lid,W+2*ov,D+2*ov,true);
    const ring=part('Locator ring', rect(0,0,Wr,Dr), {holes:[rect(rw,rw,Wr-2*rw,Dr-2*rw)], map:mapOf([t+c,t+c,H-t],X,Y,Z)});
    if(Wr-2*rw<5||Dr-2*rw<5) warns.push('Locator ring is wider than the box allows — reduce ring width.');
    parts.push(lid,ring);
    parts.push(...makeDividers(t,t,t,W-2*t,D-2*t,H-2*t,S.cols,S.rows,S.divPct));
    info.H=H+t; info.inner=inner(H-t);
    notes.push('Glue the locator ring centred on the underside of the lid. It drops inside the walls and keeps the lid from sliding off.');
  }
  else if(ty==='split'){
    const hl=Math.min(Math.max(S.lidH,2*t+6),H-2*t-6), Hb=H-hl;
    const hh={}; if(S.handles){ hh.left=handleHoles(D,Hb); hh.right=handleHoles(D,Hb); }
    const b=buildBox({W,D,H:Hb,f:fOpen,holes:hh,pre:'Base '});
    const l=buildBox({W,D,H:hl,f:{top:1,front:1,back:1,left:1,right:1},oz:Hb,pre:'Lid '});
    addText(l.top,W,D,true);
    parts=[...Object.values(b),...Object.values(l)];
    if(S.strips){
      const sh=Math.min(Hb-t-2, 14), pr=Math.min(hl-t-2, 6), Ls=sh+pr;
      parts.push(part('Locator strip F', rect(0,0,W-2*t-c,Ls), {map:mapOf([t+c/2,t,Hb+pr],X,nZ,Y)}));
      parts.push(part('Locator strip B', rect(0,0,W-2*t-c,Ls), {map:mapOf([t+c/2,D-2*t,Hb+pr],X,nZ,Y)}));
      parts.push(part('Locator strip L', rect(0,0,D-4*t-c,Ls), {map:mapOf([t,2*t+c/2,Hb+pr],Y,nZ,X)}));
      parts.push(part('Locator strip R', rect(0,0,D-4*t-c,Ls), {map:mapOf([W-2*t,2*t+c/2,Hb+pr],Y,nZ,X)}));
      notes.push('Glue the locator strips inside the base walls so '+fmt(pr)+' sticks up above the rim. Sand their outer faces lightly if the lid is tight.');
    }
    parts.push(...makeDividers(t,t,t,W-2*t,D-2*t,Hb-t-(S.strips?0:0),S.cols,S.rows,S.divPct,''));
    info.inner=inner(H-2*t);
    notes.push('Build two trays: the base, and the lid (assembled upside-down). The lid sits on the base with a matching seam line.');
  }
  else if(ty==='sliding'){
    const b=buildBox({W,D,H,f:fOpen}); parts=Object.values(b);
    const lip=Math.max(2,S.capLip);
    const U=(name,a,bk,z)=>part(name, [[0,0],[a,0],[a,D-bk],[W-a,D-bk],[W-a,0],[W,0],[W,D],[0,D]], {map:mapOf([0,0,z],X,Y,Z)});
    parts.push(U('Rail spacer (U)',t,t,H));
    parts.push(U('Rail cap (U)',t+lip,t+lip,H+t));
    const lw=W-2*t-2*c, ld=D-t-c;
    const lid=part('Sliding lid', rect(0,0,lw,ld), {map:mapOf([t+c,0,H],X,Y,Z), kind:'plate', top:true, role:'lid', holes:[stadium(lw/2, Math.min(14,ld*0.12), Math.min(36,lw*0.35), 11)]});
    addText(lid,lw,ld,true);
    parts.push(lid);
    parts.push(...makeDividers(t,t,t,W-2*t,D-2*t,H-t,S.cols,S.rows,S.divPct));
    info.H=H+2*t; info.inner=inner(H-t);
    notes.push('Glue the spacer U on top of the walls (open end at the front), then the cap U on top of that. The lid slides into the slot between them and is held down by the '+fmt(lip)+' lip.');
  }
  else if(ty==='hinged'){
    const hl=Math.min(Math.max(S.lidH,t+14),H*0.6), Hb=H-hl;
    const re=(hl-t-2)/2, Yp=D-t-re-1, Zp=Hb+re+1, h=Zp-Hb;
    const pinR=S.pin/2; G.pivot=[Yp,Zp];
    if(pinR>re-1.5) warns.push('Hinge pin is too big for this lid height — raise the lid height or use a thinner pin.');
    const ear={pts:[[0,0],[Yp-re,0],[Yp-re,-h],...arc(Yp,-h,re,PI,2*PI,18).map(([s,d])=>[s,d]),[Yp+re,-h],[D-t,-h],[D,0]]};
    // arc from PI→2PI: s=Yp+re*cos, d=-h+re*sin (negative sin goes "up")
    const b=buildBox({W,D,H:Hb,f:fOpen,custom:{left_top:ear,right_top:ear},
      circles:{left:[{x:Yp,y:-h,r:pinR}], right:[{x:Yp,y:-h,r:pinR}]}});
    const Wl=W+2*t+2*c;
    const l=buildBox({W:Wl,D,H:hl,f:{top:1,front:1,left:1,right:1},ox:-t-c,oz:Hb,pre:'Lid ',
      circles:{left:[{x:Yp,y:Hb+hl-Zp,r:pinR}],right:[{x:Yp,y:Hb+hl-Zp,r:pinR}]}});
    addText(l.top,Wl,D,true);
    parts=[...Object.values(b),...Object.values(l)];
    parts.push(...makeDividers(t,t,t,W-2*t,D-2*t,Hb-t,S.cols,S.rows,S.divPct));
    info.W=Wl; info.inner=inner(H-2*t);
    notes.push('The base side walls grow rounded ears at the back. The lid side walls sit outside the ears.');
    notes.push('Push a '+fmt(S.pin)+' pin (dowel, nail or filament) through each lid side into its ear. Glue the pin to the lid side only, so the ear can turn.');
    notes.push('The lid has no back wall, which lets it swing about 100° open.');
  }
  else if(ty==='drawer'){
    const N=Math.max(1,Math.min(8,S.drawers|0));
    const Hi=H-2*t, bay=(Hi-(N-1)*t)/N;
    if(bay<15) warns.push('Drawers are very short — reduce the count or increase height.');
    const sideHoles=[], shelves=[];
    const tl=Math.min(20,(D-t)/4), yc=[(D-t)*0.25,(D-t)*0.75];
    for(let k=1;k<N;k++){
      const zs=t+k*bay+(k-1)*t;
      for(const y of yc) sideHoles.push(rect(y-tl/2,H-zs-t,tl,t));
      const Wd=W, Dd=D-t, a=t;
      const p=[[a,0],[Wd-a,0]];
      for(const y of yc) p.push([Wd-a,y-tl/2],[Wd,y-tl/2],[Wd,y+tl/2],[Wd-a,y+tl/2]);
      p.push([Wd-a,Dd],[a,Dd]);
      for(const y of [...yc].reverse()) p.push([a,y+tl/2],[0,y+tl/2],[0,y-tl/2],[a,y-tl/2]);
      shelves.push(part('Shelf '+k, clean(p), {map:mapOf([0,0,zs],X,Y,Z)}));
    }
    const sl=buildBox({W,D,H,f:{top:1,bottom:1,back:1,left:1,right:1},holes:{left:sideHoles,right:sideHoles},pre:'Case '});
    addText(sl.top,W,D,true);
    parts=[...Object.values(sl),...shelves];
    const Wd=W-2*t-2*c, Dd=D-t-c, Hd=bay-c;
    const fH=(H-(N-1)*c)/N;
    for(let i=0;i<N;i++){
      const zb=t+i*(bay+t), pre='Drawer '+(N-i)+' ';
      const fz0=i*(fH+c); // false front bottom z
      const slotZ=zb+Hd-Math.min(14,Hd*0.3), knobZ=fz0+fH/2;
      const pullZ=S.pull==='knob'?knobZ:slotZ;
      const holesF={}, circF={};
      if(S.pull==='slot' && Hd>20){ holesF.front=[stadium(Wd/2,Hd-(slotZ-zb),Math.min(44,Wd*0.4),Math.min(+S.pullH||14,Hd*0.3))]; }
      if(S.pull==='knob'&&pullZ<zb+Hd-2&&pullZ>zb+2){ circF.front=[{x:Wd/2,y:Hd-(pullZ-zb),r:2}]; }
      const dr=buildBox({W:Wd,D:Dd,H:Hd,f:fOpen,ox:t+c,oy:0,oz:zb,pre,holes:holesF,circles:circF});
      parts.push(...Object.values(dr));
      const ffW=W-c, ff=part(pre+'false front', rect(0,0,ffW,fH), {map:mapOf([c/2,-t,fz0+fH],X,nZ,Y), role:'wall', size:[ffW,fH], flat:true});
      if(S.pull==='slot' && Hd>20) ff.holes.push(stadium(ffW/2,fz0+fH-slotZ,Math.min(44,Wd*0.4),Math.min(+S.pullH||14,Hd*0.3)));
      if(S.pull==='knob') ff.circles.push({x:ffW/2,y:fH/2,r:2});
      parts.push(ff);
      parts.push(...makeDividers(t+c+t,t,zb+t,Wd-2*t,Dd-2*t,Hd-t,S.cols,S.rows,S.divPct,pre));
    }
    info.inner={W:Wd-2*t,D:Dd-2*t,H:Hd-t,label:'each drawer'};
    info.D=D+t;
    notes.push('Build the case (top, bottom, back, two sides). Shelves slide in through the open front and their tabs click into the side-wall slots — glue them.');
    notes.push('Each drawer is an open tray. Glue its false front on so the bottom edges line up; the false fronts overlap the case edges and act as drawer stops.');
    if(S.pull==='knob') notes.push('Knob holes are 4 mm — fit an M4 or #8 knob bolt through false front and drawer front together.');
  }
  else if(ty==='polygon'){
    const n=Math.max(3,Math.min(16,S.sides|0)), top=S.polyTop;
    const ai= ins? S.W/2 : S.W/2 - t;
    const Hw = ins? S.H : S.H - (top==='none'?t:2*t);
    const w=2*ai*Math.tan(PI/n);
    if(w<12) warns.push('Walls are very narrow — increase the width or reduce the number of sides.');
    const k=w>70?2:1, tw=Math.min(20,w*0.3), cs=k===1?[w/2]:[w/4,3*w/4];
    const ap=ai+t+Math.max(2,S.lip), R0=ap/Math.cos(PI/n);
    const polyPts=(a)=>{ const r=a/Math.cos(PI/n), p=[]; for(let i=0;i<n;i++){ const th=2*PI*i/n-PI/2+PI/n; p.push([R0+r*Math.cos(th),R0+r*Math.sin(th)]);} return p; };
    const slots=[];
    for(let i=0;i<n;i++){ const th=2*PI*i/n-PI/2, N2=[Math.cos(th),Math.sin(th)], T=[-Math.sin(th),Math.cos(th)];
      for(const cc of cs){ const m=ai+t/2, off=cc-w/2; slots.push(rotRect(R0+N2[0]*m+T[0]*off, R0+N2[1]*m+T[1]*off, tw, t, T[0],T[1])); } }
    const topTabs=top==='glued';
    for(let i=0;i<n;i++){
      const th=2*PI*i/n-PI/2, N3=[Math.cos(th),Math.sin(th),0], T3=[-Math.sin(th),Math.cos(th),0];
      const e0=topTabs?tabEdge(w,cs,tw,-t):'plain', e2=tabEdge(w,cs.map(x=>w-x),tw,-t);
      const o=add(add(mul(N3,ai),mul(T3,-w/2)),[0,0,t+Hw]);
      const wp=part('Wall '+(i+1), panelOutline(w,Hw,[e0,'plain',e2,'plain']), {map:mapOf(o,T3,nZ,N3), role:'wall', size:[w,Hw]});
      parts.push(wp);
    }
    parts.push(part('Bottom', polyPts(ap), {holes:slots, map:mapOf([-R0,-R0,0],X,Y,Z)}));
    if(top==='glued'){ const tp=part('Top', polyPts(ap), {holes:slots, map:mapOf([-R0,-R0,t+Hw],X,Y,Z), top:true, role:'lid'}); addText(tp,2*R0,2*R0,false); parts.push(tp); }
    if(top==='lift'){
      const lp=part('Lid', polyPts(ap), {map:mapOf([-R0,-R0,t+Hw],X,Y,Z), top:true, role:'lid'}); addText(lp,2*R0,2*R0,false); parts.push(lp);
      const rw=Math.max(3,S.ringW), ao=ai-c, aI=ao-rw;
      if(aI>3) parts.push(part('Locator ring', polyPts(ao), {holes:[polyPts(aI)], map:mapOf([-R0,-R0,Hw],X,Y,Z)}));
      notes.push('Glue the locator ring centred under the lid; it drops inside the walls.');
    }
    info={W:2*ap, D:2*ap, H:Hw+(top==='none'?t:2*t), inner:{W:2*ai,D:2*ai,H:Hw,label:'across flats'}};
    notes.unshift('Push each wall\'s bottom tabs into the slots in the base. Walls meet at their inner corners, leaving small V-grooves outside — fill with glue or leave as a detail.');
  }
  else if(ty==='rounded'){
    const top=S.polyTop;
    const Wi= ins? S.W : S.W-2*t, Di= ins? S.D : S.D-2*t;
    let Ri= ins? S.radius : S.radius - t;
    const Hw = ins? S.H : S.H - (top==='none'?t:2*t);
    Ri=Math.min(Math.max(Ri,2),Wi/2-0.01,Di/2-0.01);
    if(Ri<4*t) warns.push('Corner radius is tight for a living hinge in this thickness — try '+fmt(5*t+t)+' or more and test-flex first.');
    const Wm=Wi+t, Dm=Di+t, Rm=Ri+t/2, sx=Wi-2*Ri, sy=Di-2*Ri, A=PI/2*Rm;
    const secs=[ ['s',sx/2,[0,-Dm/2],[1,0]], ['a',A,[sx/2,-sy/2],-PI/2], ['s',sy,[Wm/2,-sy/2],[0,1]], ['a',A,[sx/2,sy/2],0],
      ['s',sx,[sx/2,Dm/2],[-1,0]], ['a',A,[-sx/2,sy/2],PI/2], ['s',sy,[-Wm/2,sy/2],[0,-1]], ['a',A,[-sx/2,-sy/2],PI], ['s',sx/2,[-sx/2,-Dm/2],[1,0]] ];
    let acc=0; secs.forEach(s=>{ s.start=acc; acc+=s[1]; }); const P=acc;
    const at=(s)=>{ s=Math.max(0,Math.min(P,s)); for(const q of secs){ if(s<=q.start+q[1]+1e-9){ const l=s-q.start;
        if(q[0]==='s') return {p:[q[2][0]+q[3][0]*l, q[2][1]+q[3][1]*l], d:q[3]};
        const a=q[3]+l/Rm; return {p:[q[2][0]+Rm*Math.cos(a), q[2][1]+Rm*Math.sin(a)], d:[-Math.sin(a),Math.cos(a)]}; } } return at(P-1e-6); };
    const ext=3, tabs=[], zones=[];
    secs.forEach(q=>{ if(q[0]==='a') zones.push([q.start-ext,q.start+q[1]+ext]);
      else { const L=q[1]; const margin=(q===secs[0]||q===secs[8])?6:ext+2; const use=L-margin-ext-2; if(use>12){ const kk=Math.max(1,Math.floor(use/45)), tw=10;
        for(let j=0;j<kk;j++){ const base=(q===secs[0])? q.start+margin : q.start+ext+2; tabs.push({c:base+use*(j+0.5)/kk, tw}); } } } });
    const lip=Math.max(2,S.lip), hwP=Wm/2+t/2+lip, hhP=Dm/2+t/2+lip, rP=Rm+t/2+lip;
    const slots=tabs.map(tb=>{ const a=at(tb.c); return rotRect(a.p[0]+hwP,a.p[1]+hhP,tb.tw,t,a.d[0],a.d[1]); });
    const pitch=Math.max(0.8,S.hPitch), br=Math.max(1,S.hBridge);
    const m=Math.max(1,Math.round(Hw/(Math.max(8,Hw/4)+br))), Pd=Hw/m, cut=Pd-br;
    // split strip if longer than bed
    const maxL=Math.max(S.sheetW,S.sheetH)-2*S.gap;
    const pieces= P>maxL ? [[0,P/2],[P/2,P]] : [[0,P]];
    if(P/pieces.length>maxL) warns.push('Wall strip ('+fmt(P/pieces.length)+') is longer than your bed even when split — make the box smaller.');
    const topTabs=top==='glued';
    pieces.forEach(([s0,s1],pi)=>{
      const L=s1-s0, my=tabs.filter(tb=>tb.c>s0+tb.tw && tb.c<s1-tb.tw).map(tb=>tb.c-s0), tw=tabs[0]?tabs[0].tw:10;
      const e0=topTabs? tabEdge(L,my,tw,-t):'plain', e2=tabEdge(L,my.map(x=>L-x),tw,-t);
      const slits=[];
      zones.forEach(([z0,z1])=>{ const a=Math.max(z0,s0+1), b=Math.min(z1,s1-1); if(b-a<pitch) return;
        const cnt=Math.floor((b-a)/pitch); const st=a+((b-a)-cnt*pitch)/2;
        for(let j=0;j<=cnt;j++){ const x=st+j*pitch-s0; const odd=j%2===1;
          if(!odd){ for(let k=0;k<=m;k++){ const y0=Math.max(0,k*Pd-cut/2), y1=Math.min(Hw,k*Pd+cut/2); if(y1-y0>0.3) slits.push([[x,y0],[x,y1]]); } }
          else { for(let k=0;k<m;k++){ const cy=(k+0.5)*Pd; slits.push([[x,cy-cut/2],[x,cy+cut/2]]); } } } });
      const solids=[];
      const fac=[]; secs.forEach(q=>{ const nseg=q[0]==='a'?6:1; for(let j=0;j<nseg;j++){ const a=q.start+q[1]*j/nseg, b=q.start+q[1]*(j+1)/nseg; if(b>s0+1e-6&&a<s1-1e-6) fac.push([Math.max(a,s0),Math.min(b,s1)]); } });
      fac.forEach(([a,b])=>{ const A2=at(a).p, B2=at(b).p; const dx=B2[0]-A2[0], dy=B2[1]-A2[1], len=Math.hypot(dx,dy); if(len<1e-3) return;
        const u=[dx/len,dy/len,0], nn=[dy/len,-dx/len,0]; const o=add([A2[0],A2[1],t+Hw],mul(nn,-t/2));
        solids.push({pts:rect(0,0,len,Hw),holes:[],map:mapOf(o,u,nZ,nn)}); });
      parts.push(part(pieces.length>1?'Wall strip '+(pi+1):'Wall strip', panelOutline(L,Hw,[e0,'plain',e2,'plain']), {slits, solids, map:mapOf([0,0,0],X,Y,Z)}));
      // seam backer at start of this piece
      const A0=at(s0); const d=A0.d, nn=[d[1],-d[0],0];
      const bo=add(add([A0.p[0],A0.p[1],t+Hw*0.9],mul(nn,-t/2-t)),mul([d[0],d[1],0],-10));
      parts.push(part('Seam backer '+(pi+1), rect(0,0,20,Hw*0.8), {map:mapOf(bo,[d[0],d[1],0],nZ,nn)}));
    });
    const plate=()=>roundRect(hwP,hhP,hwP,hhP,rP,14);
    parts.push(part('Bottom', plate(), {holes:slots, map:mapOf([-hwP,-hhP,0],X,Y,Z)}));
    if(top==='glued'){ const tp=part('Top', plate(), {holes:slots, map:mapOf([-hwP,-hhP,t+Hw],X,Y,Z), top:true, role:'lid'}); addText(tp,2*hwP,2*hhP,true); parts.push(tp); }
    if(top==='lift'){
      const lp=part('Lid', plate(), {map:mapOf([-hwP,-hhP,t+Hw],X,Y,Z), top:true, role:'lid'}); addText(lp,2*hwP,2*hhP,true); parts.push(lp);
      const rw=Math.max(3,S.ringW), hw=Wi/2-c, hh=Di/2-c, rr=Math.max(0.5,Ri-c);
      parts.push(part('Locator ring', roundRect(hw,hh,hw,hh,rr,12), {holes:[roundRect(hw,hh,hw-rw,hh-rw,Math.max(0.5,rr-rw),12)], map:mapOf([-hw,-hh,Hw],X,Y,Z)}));
      notes.push('Glue the locator ring centred under the lid.');
    }
    info={W:2*hwP,D:2*hhP,H:Hw+(top==='none'?t:2*t),inner:{W:Wi,D:Di,H:Hw}};
    notes.unshift('Wrap the wall strip around the base, pressing its tabs into the slots. The seam falls at the middle of the front'+(pieces.length>1?' and back':'')+'; glue a seam backer behind each seam.');
    notes.splice(1,0,'Warm or lightly mist the hinge areas if the wood resists. Bend slowly. Cut the hinge with air assist for clean bridges.');
  }
  else if(ty==='pencil'){
    const rw=Math.max(t+5,S.rimW), pinR=S.pin/2+0.1, px=rw/2, py=rw/2;
    const b=buildBox({W,D,H,f:fOpen}); parts=Object.values(b);
    const rim=part('Rim frame', rect(0,0,W,D), {holes:[rect(rw,rw,W-2*rw,D-2*rw)], circles:[{x:px,y:py,r:pinR}], map:mapOf([0,0,H],X,Y,Z), plainRect:true, cornerMax:rw*0.45});
    const lid=part('Swivel lid', rect(0,0,W,D), {circles:[{x:px,y:py,r:pinR}], map:mapOf([0,0,H+t],X,Y,Z), top:true, role:'lid', plainRect:true, cornerMax:rw*0.45});
    addText(lid,W,D,true); parts.push(rim,lid);
    parts.push(...makeDividers(t,t,t,W-2*t,D-2*t,H-t,S.cols,S.rows,S.divPct));
    G.pivot=[px,py];
    info.H=H+2*t; info.inner=inner(H-t);
    notes.push('Glue the rim frame flat on top of the walls.');
    notes.push('Lay the lid on the rim and push a '+fmt(S.pin)+' pin down through both corner holes. Glue the pin into the rim only — the lid swivels around it.');
  }
  else if(ty==='card'){
    const Hf=Math.min(H-4,Math.max(2*t+10, H*S.frontPct/100));
    const bot=part('Bottom', panelOutline(W,D,['F','F','F','F']), {map:mapOf([0,0,0],X,Y,Z), role:'plate', size:[W,D]});
    const fr=part('Front', panelOutline(W,Hf,['plain','M','M','M']), {map:mapOf([0,0,Hf],X,nZ,Y), role:'wall', size:[W,Hf]});
    const bk=part('Back', panelOutline(W,H,['plain','M','M','M']), {map:mapOf([0,D-t,H],X,nZ,Y), role:'wall', size:[W,H]});
    const fF=edgeProfile('F',Hf);
    const side=(name,x)=>part(name, panelOutline(D,H,[{pts:[[0,H-Hf],[D,0]]},'F','M',{pts:fF}]), {map:mapOf([x,0,H],Y,nZ,X)});
    addText(fr,W,Hf,false);
    parts=[bot,fr,bk,side('Left side',0),side('Right side',W-t)];
    const nd=Math.max(0,Math.min(12,S.cardDivs|0)), Wc=W-2*t-1.5, tabH=12, bodyH=Math.max(10,(Hf+H)/2-t-10);
    for(let i=0;i<nd;i++){ const tw=Wc/3, tx=(i%3)*tw;
      const p=[[0,tabH],[tx,tabH],[tx+2.5,0],[tx+tw-2.5,0],[tx+tw,tabH],[Wc,tabH],[Wc,tabH+bodyH],[0,tabH+bodyH]];
      const y= nd===1 ? D/2 : t+10+i*((D-2*t-20-t)/(nd-1));
      parts.push(part('Index card '+(i+1), clean(p), {map:mapOf([t+0.75,y,t+bodyH+tabH],X,nZ,Y), card:i})); }
    info.inner={W:W-2*t,D:D-2*t,H:H-t,label:'at the back'};
    notes.push('The sides slope from the tall back down to the low front so cards are easy to flip through.');
    notes.push('Index cards have staggered tabs (left, middle, right) — engrave or write the letters on them.');
  }
  else if(ty==='nested'){
    const N=Math.max(2,Math.min(6,S.nestN|0)); let w=W,d=D,h=H, ox=0,oy=0,oz=0;
    for(let k=0;k<N;k++){
      if(w<30||d<30||h<15){ warns.push('Only '+k+' boxes fit — the next one would be too small. Make the outer box bigger or the set smaller.'); break; }
      const b=buildBox({W:w,D:d,H:h,f:fOpen,ox,oy,oz,pre:'Box '+(k+1)+' '}); Object.values(b).forEach(p=>p.nest=k);
      if(k===0) addText(b.front,w,h,false);
      parts.push(...Object.values(b));
      ox+=t+c; oy+=t+c; oz+=t; w-=2*t+2*c; d-=2*t+2*c; h-=t+c;
    }
    info.inner=inner(H-t);
    notes.push('Each box is an open tray sized to drop inside the one before it with '+fmt(c)+' clearance all round.');
  }
  else if(ty==='puzzle'){
    const lip=Math.max(S.capLip, S.pin+6), hr=S.pin/2+0.2;
    const b=buildBox({W,D,H,f:fOpen}); parts=Object.values(b);
    const U=(name,a,bk,z,circ)=>part(name, [[0,0],[a,0],[a,D-bk],[W-a,D-bk],[W-a,0],[W,0],[W,D],[0,D]], {map:mapOf([0,0,z],X,Y,Z), circles:circ||[]});
    const pinX=t+c+(lip-c)/2, yp=Math.round(D*0.55);
    parts.push(U('Rail spacer (U)',t,t,H));
    parts.push(U('Rail cap (U)',t+lip,t+lip,H+t,[{x:pinX,y:yp,r:hr}]));
    const lw=W-2*t-2*c, ld=D-t-c;
    const lid=part('Sliding lid', rect(0,0,lw,ld), {map:mapOf([t+c,0,H],X,Y,Z), top:true, role:'lid', circles:[{x:pinX-(t+c),y:yp,r:hr}]});
    addText(lid,lw,ld,true); parts.push(lid);
    const rv=Math.min(lip+t-1,12)/2;
    const disc=(name,x,z,hole)=>part(name, arc(rv,rv,rv,0,2*PI,36).slice(0,36), {map:mapOf([x-rv,yp-rv,z],X,Y,Z), circles:hole?[{x:rv,y:rv,r:hr}]:[]});
    parts.push(disc('Rivet ring',pinX,H+2*t,true), disc('Rivet cap',pinX,H+3*t,false), disc('Decoy rivet ring',W-pinX,H+2*t,false), disc('Decoy rivet cap',W-pinX,H+3*t,false));
    const bw=lip+c, bd=14;
    parts.push(part('Keeper ring', rect(0,0,bw,bd), {map:mapOf([t,yp-bd/2,H-t],X,Y,Z), circles:[{x:pinX-t,y:bd/2,r:hr}]}));
    parts.push(part('Keeper base', rect(0,0,bw,bd), {map:mapOf([t,yp-bd/2,H-2*t],X,Y,Z)}));
    const pl=1.5*t; parts.push(part('Lock pin', rect(0,0,S.pin,pl), {noCut:true, th:S.pin, map:mapOf([pinX-S.pin/2,yp-S.pin/2,H-t+pl],X,nZ,Y)}));
    info.H=H+4*t; info.inner=inner(H-2*t);
    notes.push('Build it like the sliding-lid box: walls, then the spacer U and cap U on top.');
    notes.push('Glue the keeper ring on the keeper base, then glue that block inside the left wall so its top sits flush with the wall top, right under the cap hole.');
    notes.push('Drop a '+fmt(S.pin)+' × '+fmt(1.5*t)+' pin (cut dowel or nail) into the keeper. Slide the lid in, then glue the rivet ring + cap over the cap-rail hole. Glue the decoy rivet on the other side.');
    notes.push('The secret: upright, the pin falls into the lid and locks it. Turn the box upside-down, the pin drops into the rivet, and the lid slides out.');
  }
  else if(ty==='book'){
    const Wb=S.W, Db=S.D, Hb=Math.max(4*t+12,S.H);
    const Rm=(Hb-t)/2, cx=Rm+t/2, Lb=Wb-cx, sA=Lb, sB=Lb+PI*Rm, P=2*Lb+PI*Rm;
    if(Lb<25) warns.push('The book is too thick for its width — make it wider or thinner.');
    const at=(s)=>{ if(s<=sA) return {p:[Wb-s,t/2], d:[-1,0]}; if(s<=sB){ const a=-PI/2-(s-sA)/Rm; return {p:[cx+Rm*Math.cos(a),Hb/2+Rm*Math.sin(a)], d:[Math.sin(a),-Math.cos(a)]}; } return {p:[cx+(s-sB),Hb-t/2], d:[1,0]}; };
    const slits=hingeSlits(sA-4, sB+4, Db, S.hPitch, S.hBridge);
    const solids=[];
    const facet=(a,b,anim)=>{ const A=at(a).p, B=at(b).p, dx=B[0]-A[0], dz=B[1]-A[1], len=Math.hypot(dx,dz); const u=[dx/len,0,dz/len], nn=[-u[2],0,u[0]];
      solids.push({pts:rect(0,0,len,Db), holes:[], map:mapOf(add([A[0],0,A[1]],mul(nn,-t/2)),u,Y,nn), anim}); };
    facet(0,sA); for(let j=0;j<14;j++) facet(sA+(sB-sA)*j/14, sA+(sB-sA)*(j+1)/14); facet(sB,P,{rot:{p:[cx,0,Hb-t/2],a:-2.0,axis:'y'}});
    const strip=part('Cover strip', rect(0,0,P,Db), {slits, solids, map:mapOf([0,0,0],X,Y,Z), plainRect:true, cornerMax:Db*0.2});
    if(S.text) strip.texts.push({x:sB+Lb/2,y:Db/2,size:S.textSize,text:S.text,rot:0,main:true});
    parts=[strip];
    const Wt=Wb-cx-4, Dt=Db-6, Ht=Hb-2*t-c;
    const tr=buildBox({W:Wt,D:Dt,H:Ht,f:fOpen,ox:cx+1,oy:3,oz:t,pre:'Tray '});
    parts.push(...Object.values(tr));
    info={W:Wb,D:Db,H:Hb,inner:{W:Wt-2*t,D:Dt-2*t,H:Ht-t}};
    notes.push('The cover is one strip: back cover, a living-hinge spine, and front cover. Bend the spine slowly around a can or dowel about '+fmt(Hb)+' across.');
    notes.push('Glue the tray (the "pages") onto the back cover, tucked against the spine. Optional: set two small magnets in the tray front and front cover to keep it shut.');
  }
  else if(ty==='display'){
    const tA=Math.max(1,S.tAcr), tB=t, m=Math.max(3,S.baseM);
    let Wc=W, Dc=D, Hc=H; if(ins){ Wc+=2*tA; Dc+=2*tA; Hc+=tA; }
    const base=part('Base', rect(0,0,Wc+2*m,Dc+2*m), {map:mapOf([-m,-m,0],X,Y,Z), role:'plate', plainRect:true});
    const rw=Math.max(4,S.ringW), Wr=Wc-2*tA-2*c, Dr=Dc-2*tA-2*c;
    const ring=part('Locator frame', rect(0,0,Wr,Dr), {holes:[rect(rw,rw,Wr-2*rw,Dr-2*rw)], map:mapOf([tA+c,tA+c,tB],X,Y,Z)});
    G.t=tA; G.mat='acrylic';
    const cvb=buildBox({W:Wc,D:Dc,H:Hc,f:{top:1,front:1,back:1,left:1,right:1},oz:tB,pre:'Cover '});
    Object.values(cvb).forEach(p=>p.look='clear');
    addText(cvb.top,Wc,Dc,true);
    G.t=tB; G.mat='main';
    parts=[base,ring,...Object.values(cvb)];
    info={W:Wc+2*m,D:Dc+2*m,H:Hc+tB,inner:{W:Wc-2*tA,D:Dc-2*tA,H:Hc-tA}};
    notes.push('Two materials: the base and locator frame cut from your '+fmt(tB)+' sheet, the cover from '+fmt(tA)+' clear acrylic (separate cut sheets).');
    notes.push('Glue the locator frame centred on the base. Assemble the acrylic cover with acrylic cement (Weld-On 4) — peel the film after gluing. The cover lifts straight off the frame.');
  }
  else if(ty==='frame'){
    const top='glued', savedCorners=S.corners, savedTs=G.ts;
    if(ins){ W+=2*t; D+=2*t; H+=(top==='none'||top==='lift'?t:2*t); }
    S.corners='classic';
    const minRing=Math.max(4,t), fwid=Math.max(minRing,S.frameW), ox=t+fwid, oy=t+fwid, Wt=W-2*ox, Dt=D-2*oy;
    if(S.frameW<minRing) warns.push('Ring width raised to '+fmt(minRing)+' — the narrowest that leaves a solid web in the plates for this material.');
    if(Wt<2*t+10||Dt<2*t+10){ warns.push('The ring is too wide for this size — the centre hole has vanished. Reduce the ring width or enlarge the box.'); }
    else {
      const fOut= top==='glued'? fAll : fOpen;
      const hole=(base)=>panelOutline(Wt,Dt,['M','M','M','M']).map(q=>[q[0]+ox,q[1]+oy]);
      const out=buildBox({W,D,H,f:fOut,pre:'Outer ',holes:{bottom:[hole()],top:[hole()]}});
      G.ts=null;
      const tubeF= top==='glued'? {top:1,bottom:1,front:1,back:1,left:1,right:1} : {bottom:1,front:1,back:1,left:1,right:1};
      const tube=buildBox({W:Wt,D:Dt,H,f:tubeF,ox,oy,pre:'Inner '});
      G.ts=savedTs;
      delete tube.top; delete tube.bottom;
      if(out.top){ out.top.texts=[]; addText(out.top,W,D,true); if(out.top.texts[0]){ out.top.texts[0].y=ox/2; } }
      parts=[...Object.values(out),...Object.values(tube)];
      if(top==='lift'){
        const lid=part('Lid', rect(0,0,W,D), {holes:[rect(ox,oy,Wt,Dt)], map:mapOf([0,0,H],X,Y,Z), kind:'plate', top:true, role:'lid', plainRect:true});
        addText(lid,W,D,true); if(lid.texts[0]) lid.texts[0].y=ox/2;
        const Wr=W-2*t-2*c, Dr=D-2*t-2*c, g=fwid-c;
        if(fwid-2*c<4) warns.push('The ring is too narrow for a locator ring — widen the ring or reduce the clearance.');
        parts.push(lid, part('Locator ring', rect(0,0,Wr,Dr), {holes:[rect(g,g,Wt+2*c,Dt+2*c)], map:mapOf([t+c,t+c,H-t],X,Y,Z)}));
        notes.push('Glue the locator ring centred under the lid. It drops into the ring-shaped cavity and keeps the lid from sliding off.');
      }
      info={W,D,H:H+(top==='lift'?t:0), inner:{W:fwid,D:fwid,H:H-(top==='glued'?2*t:t),label:'ring width'}};
      info.hole={W:Wt-2*t,D:Dt-2*t};
      notes.unshift('Build the outer box and the inner tube (the wall around the centre hole) separately, then slot the tube into the base plate. The base and top plates are rings: the centre opening is '+fmt(Wt-2*t)+' × '+fmt(Dt-2*t)+'.');
      if(savedCorners!=='classic') notes.push('Frame boxes always use the classic corner style.');
    }
    S.corners=savedCorners;
  }
  else if(ty==='cubeframe'){
    /* Twelve hollow square beams along the edges of a box: six outer rings plus two inner strips per beam.
       Every seam is finger-jointed; joint types are chosen so each shared corner has exactly one owner. */
    const savedTs=G.ts; G.ts=null;
    const dims=[W,D,H], minW=Math.max(3*t,10), maxW=(Math.min(W,D,H)-10)/2;
    let w=Math.max(minW,+S.beamW||0);
    if((+S.beamW||0)<minW) warns.push('Beam width raised to '+fmt(minW)+' — the narrowest that leaves room for finger joints on both sides of each strip.');
    if(w>maxW){ w=Math.max(minW,maxW); warns.push('The beams are too wide for this size, so the openings would vanish. Beam width reduced to '+fmt(w)+'.'); }
    if(Math.min(W,D,H)-2*w<10){ warns.push('The box is too small for a cube frame in this material — make it bigger.'); G.ts=savedTs; }
    else {
      const Ls=dims.map(d=>d-2*w+2*t);
      const hole=(a,b)=>panelOutline(a,b,['M','M','M','M']).map(q=>[q[0]+w-t,q[1]+w-t]);
      const hx=hole(Ls[0],Ls[2]), hy=hole(Ls[1],Ls[2]), hz=hole(Ls[0],Ls[1]);
      const out=buildBox({W,D,H,f:fAll,pre:'Outer ',holes:{bottom:[hz],top:[hz],front:[hx],back:[hx],left:[hy],right:[hy]}});
      if(out.top && S.text){ addText(out.top,W,D,true); out.top.texts[0].y=w/2; }
      parts=Object.values(out);
      const E=[X,Y,Z], cnt={}, kindName={MM:'A',MF:'B',FM:'C',FF:'D'};
      for(let a=0;a<3;a++){
        const oth=[0,1,2].filter(i=>i!==a);
        for(const h0 of [0,1]) for(const h1 of [0,1]){
          const hi=[0,0,0]; hi[oth[0]]=h0; hi[oth[1]]=h1;
          for(const p of oth){ const q=oth.find(i=>i!==p);
            const sh=a<p?'M':'F', cv=p===oth[0]?'M':'F', k=kindName[sh+cv];
            cnt[k]=(cnt[k]||0)+1;
            const o=[0,0,0]; o[a]=w-t; o[p]=hi[p]?dims[p]-w:w-t; o[q]=hi[q]?dims[q]:0;
            const u=hi[q]?mul(E[q],-1):E[q];
            parts.push(part('Strip '+k+cnt[k], panelOutline(w,Ls[a],[sh,cv,sh,'M']), {map:mapOf(o,u,E[a],E[p]), role:'strip', size:[w,Ls[a]], beam:a}));
          }
        }
      }
      G.ts=savedTs;
      info={W,D,H,inner:{W:w,D:w,H:w,label:'beam'}};
      info.hole={W:W-2*w,D:D-2*w};
      notes.push('Thirty parts: six outer rings (one per side) and 24 inner strips that line the tunnels. Each edge of the cube is a hollow square beam '+fmt(w)+' across.');
      notes.push('Openings: '+fmt(W-2*w)+' × '+fmt(H-2*w)+' front and back, '+fmt(D-2*w)+' × '+fmt(H-2*w)+' on the sides, '+fmt(W-2*w)+' × '+fmt(D-2*w)+' top and bottom.');
      notes.push('Strips come in four kinds (A–D) that differ only in their finger pattern. Build one beam at a time: glue the two inner strips into the bottom ring\'s opening, then add the side rings, then the top ring last.');
      if(ins) notes.push('Cube frame sizes are always outside dimensions.');
      if(S.tslot!=='off') notes.push('Cube frames are glued; screw joints are turned off for this style.');
    }
  }
  else if(ty==='kerftest'){
    const vals=[]; for(let i=-3;i<=3;i++) vals.push(+(S.kerf+i*S.kStep).toFixed(3));
    const pitch=Math.max(14,t+10), Wc=vals.length*pitch+8, Hc=34, depth=14;
    const p=[[0,0]];
    vals.forEach((k,i)=>{ const cx=4+pitch*(i+0.5), sw=t-k; p.push([cx-sw/2,0],[cx-sw/2,depth],[cx+sw/2,depth],[cx+sw/2,0]); });
    p.push([Wc,0],[Wc,Hc],[0,Hc]);
    // comb is pre-compensated: offset outline by each local kerf not possible globally, so slots already narrowed; outer edge grows by kerf/2
    const comb=part('Kerf comb', clean(p), {noKerf:true, map:mapOf([0,0,0],X,Y,Z)});
    vals.forEach((k,i)=>comb.texts.push({x:4+pitch*(i+0.5),y:depth+9,size:4.2,text:k.toFixed(2),rot:0,font:'Helvetica, Arial, sans-serif',align:'center'}));
    comb.texts.push({x:Wc/2,y:Hc-4.5,size:3.6,text:'kerf · t='+t,rot:0,font:'Helvetica, Arial, sans-serif'});
    const Lj=Math.max(50,G.fw*5+2*t);
    const A1=part('Joint test A', panelOutline(Lj,30,['plain','plain','M','plain']), {map:mapOf([0,40,30],X,nZ,Y)});
    const B1=part('Joint test B', panelOutline(Lj,30,['F','plain','plain','plain']), {map:mapOf([0,40,0],X,Y,Z)});
    parts=[comb,A1,B1];
    info={W:Wc,D:70,H:30};
    notes.push('Cut the comb and the joint pair. Push an offcut of the same sheet into each comb slot: the slot that grips without forcing is your kerf. Enter it above.');
    notes.push('Then check the joint pair: fingers should press together by hand and hold. Too tight → lower the kerf by 0.02. Too loose → raise it.');
    notes.push('Kerf varies with material, thickness, power and focus, so test each new sheet type.');
  }
  assignAnims(parts,ty,W,D,H);
  return {parts,warns,notes,info};
}
function assignAnims(parts,ty,W,D,H){
  const t=G.t, up=(z,d=0)=>({tr:[0,0,z],d}); let di=0;
  for(const p of parts){ const n=p.name;
    if(ty==='closed'){
      if(n==='Top') p.anim=up(H*0.7);
      else if(n==='Front') p.anim={tr:[0,-D*0.35,0],d:0.3};
      else if(n==='Back') p.anim={tr:[0,D*0.35,0],d:0.3};
      else if(n==='Left side') p.anim={tr:[-W*0.3,0,0],d:0.3};
      else if(n==='Right side') p.anim={tr:[W*0.3,0,0],d:0.3};
    }
    if(ty==='liftoff' && (n==='Lid'||n==='Locator ring')) p.anim=up(H*0.6);
    if(ty==='split' && n.startsWith('Lid ')) p.anim=up(H*0.55);
    if(ty==='sliding' && n==='Sliding lid') p.anim={tr:[0,-D*0.85,0]};
    if(ty==='hinged' && n.startsWith('Lid ')) p.anim={rot:{p:[0,G.pivot[0],G.pivot[1]],a:-1.78}};
    if(ty==='drawer'){ const m=n.match(/^Drawer (\d+) /); if(m){ const k=+m[1]-1; p.anim={tr:[0,-D*0.62,0],d:Math.min(0.6,k*0.2)}; } }
    if((ty==='polygon'||ty==='rounded') && (n==='Lid'||n==='Locator ring')) p.anim=up(S.H*0.65);
    if(ty==='kerftest' && n==='Joint test A') p.anim=up(28);
    if(ty==='pencil' && n==='Swivel lid') p.anim={rot:{p:[G.pivot[0],G.pivot[1],0],a:1.35,axis:'z'}};
    if(ty==='card' && p.card!==undefined) p.anim=up(H*0.7, Math.min(0.6,p.card*0.12));
    if(ty==='nested' && p.nest>0) p.anim=up(p.nest*H*0.62);
    if(ty==='puzzle' && n==='Lock pin') p.anim={tr:[0,0,2.5*t],e:0.3};
    if(ty==='puzzle' && n==='Sliding lid') p.anim={tr:[0,-D*0.85,0],d:0.38};
    if(ty==='display' && n.startsWith('Cover ')) p.anim=up(H*0.8);
    if(ty==='cubeframe' && n.startsWith('Outer ')){ const dir={'Outer Top':[0,0,1],'Outer Bottom':[0,0,-1],'Outer Front':[0,-1,0],'Outer Back':[0,1,0],'Outer Left side':[-1,0,0],'Outer Right side':[1,0,0]}[n]; if(dir) p.anim={tr:mul(dir,Math.max(W,D,H)*0.55),d:0.15}; }
  }
}

/* ================= DECORATION (text, artwork, patterns, corners) ================= */
function textMarkLoops(t){ return placeLoops(textLoops(t.text, t.font||S.font, t.size, t.align||S.textAlign||'center'), t.x, t.y, t.rot||0); }
function pointIn(pt,poly){ let c=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const a=poly[i], b=poly[j]; if(((a[1]>pt[1])!==(b[1]>pt[1])) && pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0]) c=!c; } return c; }
// Laser engraves the face that is up on the bed. Make that face the OUTSIDE of the box:
// any panel whose bed-up face would point inward is mirrored in the cut file (and its 3D map
// flipped to match), so the assembled box is identical and text/cut-outs read correctly outside.
function orientParts(parts){
  const cen=p=>{ const b=bbox(p.outline), {o,u,v,n}=p.map, cx=b.x+b.w/2, cy=b.y+b.h/2, h=(p.th||G.t)/2; return [0,1,2].map(i=>o[i]+u[i]*cx+v[i]*cy+n[i]*h); };
  const mapped=parts.filter(p=>p.map && !p.solids && !p.noKerf && !p.noCut);
  if(!mapped.length) return;
  const cs=mapped.map(cen), mn=[0,1,2].map(i=>Math.min(...cs.map(c=>c[i]))), mx=[0,1,2].map(i=>Math.max(...cs.map(c=>c[i])));
  const C=[0,1,2].map(i=>(mn[i]+mx[i])/2);
  mapped.forEach((p,k)=>{
    const {u,v}=p.map, eng=[-(u[1]*v[2]-u[2]*v[1]), -(u[2]*v[0]-u[0]*v[2]), -(u[0]*v[1]-u[1]*v[0])], c=cs[k];
    const d=eng[0]*(c[0]-C[0])+eng[1]*(c[1]-C[1])+eng[2]*(c[2]-C[2]);
    if(d>=-1e-6) return;
    const b=bbox(p.outline), X2=2*b.x+b.w, M=q=>[X2-q[0],q[1]];
    p.outline=p.outline.map(M); p.holes=p.holes.map(h=>h.map(M)); p.slits=p.slits.map(l=>l.map(M));
    p.circles.forEach(ci=>{ ci.x=X2-ci.x; }); p.texts.forEach(tx=>{ tx.x=X2-tx.x; });
    p.map={o:add(p.map.o,mul(u,X2)), u:mul(u,-1), v, n:p.map.n};
    p.mirrored=true;
  });
}
function decorate(parts, warns){
  const t=G.t;
  parts.forEach((p,i)=>{ p.idx=i; });
  orientParts(parts);
  for(const p of parts){
    if(p.noCut) continue;
    // rounded / chamfered outer corners on plain rectangular plates
    if(p.plainRect && S.cornerStyle!=='square' && S.cornerR>0){
      const b=bbox(p.outline); let r=Math.min(S.cornerR, b.w/2-0.5, b.h/2-0.5, p.cornerMax||1e9);
      if(r>0.3){ if(S.cornerStyle==='round') p.outline=roundRect(b.x+b.w/2,b.y+b.h/2,b.w/2,b.h/2,r,10);
        else p.outline=[[b.x+r,b.y],[b.x+b.w-r,b.y],[b.x+b.w,b.y+r],[b.x+b.w,b.y+b.h-r],[b.x+b.w-r,b.y+b.h],[b.x+r,b.y+b.h],[b.x,b.y+b.h-r],[b.x,b.y+r]]; }
    }
    // text → outlines
    for(const tx of p.texts){
      const loops=textMarkLoops(tx);
      if(!loops.length) continue;
      if(S.textMode==='cut' && !p.noKerf){ p.holes.push(...loops); }
      else { const vis=p.noKerf?{}:{color:S.textColor, outline:S.textOutlineOn?S.textOutline:null};
        if(S.textMode==='score' && !p.noKerf && S.textFill) p.marks.push(Object.assign({loops, kind:'fill', preview:true}, vis)); // visual only
        p.marks.push(Object.assign({loops, kind: (S.textMode==='score' && !p.noKerf) ? 'score':'fill'}, vis)); }
      if(tx.main && S.frame && S.frame!=='none'){
        const raw=textLoops(tx.text, tx.font||S.font, tx.size, tx.align||S.textAlign||'center'), bb=bbox(raw.flat());
        const gap=Math.max(0,+S.frameGap||0), lw=Math.max(0.2,+S.frameLine||1);
        const W=Math.max(Math.abs(bb.x),Math.abs(bb.x+bb.w))+gap+lw/2, H=Math.max(Math.abs(bb.y),Math.abs(bb.y+bb.h))+gap+lw/2;
        const n=Math.max(1,Math.min(6,(+S.frameCount)|0)), sp=Math.max(0.5,+S.frameSpacing||3);
        const g={C:[],O:[]}, per=[]; for(let k=0;k<n;k++){ const kx=S.frame==='oval'?k*sp/1.36:k*sp, ky=S.frame==='oval'?k*sp/1.42:k*sp; const gk=frameGeom(S.frame,W+kx,H+ky,lw); g.C.push(...gk.C); g.O.push(...gk.O); per.push(gk.C.length? gk.C.reduce((m,l)=>Math.abs(area(l))>Math.abs(area(m))?l:m):null); }
        const P=l=>placeLoops([l],tx.x,tx.y,tx.rot||0)[0];
        if(!p.noKerf) for(let k=0;k+1<per.length;k++){ const col=(S.frameBands||[])[k]; if(col && per[k] && per[k+1]) p.marks.push({kind:'fill', loops:[P(per[k+1]),P(per[k])], color:col, preview:true, band:true}); } // preview-only band fills
        if(S.textMode==='score'){ p.marks.push({kind:'score', loops:g.C.map(P), open:g.O.map(P), color:S.textColor, outline:S.textOutlineOn?S.textOutline:null}); }
        else { const loops=[]; for(const l of g.C){ loops.push(P(offsetPoly(l,lw/2)), P(offsetPoly(l,-lw/2))); } for(const l of g.O){ const r=ribbon(l,lw); if(r) loops.push(P(r)); } p.marks.push({kind:'fill', loops, color:S.textColor, outline:S.textOutlineOn?S.textOutline:null}); }
        const fb=bbox(placeLoops(g.C.concat(g.O),tx.x,tx.y,tx.rot||0).flat()), pb=bbox(p.outline);
        if(fb.x<pb.x+2||fb.y<pb.y+2||fb.x+fb.w>pb.x+pb.w-2||fb.y+fb.h>pb.y+pb.h-2) warns.push('The frame around the text runs off the '+p.name.toLowerCase()+' — shrink the text or the gap.');
      }
    }
    p.texts=[];
  }
  // artwork
  for(const a of (S.art||[])){
    const p=parts.find(q=>q.name===a.panel && !q.noCut);
    if(!p){ warns.push('Artwork “'+a.name+'” is set for a panel this box doesn\'t have — pick a panel for it under Decorate.'); continue; }
    const b=bbox(p.outline), cx=b.x+b.w/2+(+a.dx||0), cy=b.y+b.h/2+(+a.dy||0), w=Math.max(2,+a.size||40);
    if(a.type==='png' && a.mode==='engrave'){ const ar=a.ar||1; p.marks.push({img:a.data, cx, cy, w, h:w*ar, rot:+a.rot||0}); continue; }
    const g = a.type==='svg' ? svgLoops(a.data) : rasterArtLoops(a.data);
    if(!g){ continue; }
    if(g.error){ warns.push('Couldn\'t read artwork “'+a.name+'”.'); continue; }
    const loops=placeLoops(g.loops, cx, cy, +a.rot||0, w), open=placeLoops(g.open, cx, cy, +a.rot||0, w);
    if(a.mode==='cut') p.holes.push(...loops);
    else if(a.mode==='score') p.marks.push({loops, open, kind:'score'});
    else p.marks.push({loops, kind:'fill'});
    if(a.mode==='cut' && open.length) warns.push('Artwork “'+a.name+'” has open lines; only closed shapes are cut through.');
  }
  // corner accents (etched)
  if(S.accent && S.accent!=='none'){
    const g=accentGeom(S.accent);
    for(const p of parts){
      if(p.noCut) continue;
      const inner = /^Drawer \d+ (Front|Back|Left side|Right side|Bottom)$/.test(p.name) || /^Tray /.test(p.name) || (p.nest>0);
      const isTop = p.role==='lid', isSide = p.role==='wall' && !inner;
      if(!(isTop || (S.accentOn==='all' && isSide))) continue;
      let x0,y0,x1,y1, m;
      if(p.size && !p.flat){ m=t+2.5; x0=m; y0=m; x1=p.size[0]-m; y1=p.size[1]-m; }
      else if(p.plainRect || p.size){ const b=bbox(p.outline); m=4+(p.plainRect&&S.cornerStyle!=='square'?S.cornerR*0.35:0); x0=b.x+m; y0=b.y+m; x1=b.x+b.w-m; y1=b.y+b.h-m; }
      else continue;
      const sz=Math.min(S.accentSize, (x1-x0)*0.4, (y1-y0)*0.4); if(sz<4) continue;
      const lw=Math.max(0.2,S.accentLine)/sz, rib=g.L.map(l=>ribbon(l,lw)).filter(Boolean);
      for(const [cx,cy,fx,fy] of [[x0,y0,1,1],[x1,y0,-1,1],[x0,y1,1,-1],[x1,y1,-1,-1]]){
        const T=q=>[cx+fx*q[0]*sz, cy+fy*q[1]*sz];
        if(S.accentMode==='score') p.marks.push({kind:'score', loops:g.F.map(l=>l.map(T)), open:g.L.map(l=>l.map(T))});
        else p.marks.push({kind:'fill', loops:[...rib.map(l=>l.map(T)), ...g.F.map(l=>l.map(T))]});
      }
    }
  }
  // decorative cut-through patterns
  if(S.deco!=='none'){
    for(const p of parts){
      if(p.noCut || !p.role) continue;
      const tgt=S.decoOn; if(!(tgt==='all' || (tgt==='walls' && p.role==='wall') || (tgt==='lid' && p.role==='lid'))) continue;
      const m=t+5;
      const avoid=[...p.holes.map(bbox), ...p.circles.map(c=>({x:c.x-c.r,y:c.y-c.r,w:2*c.r,h:2*c.r})), ...p.marks.map(mk=>mk.img?{x:mk.cx-mk.w/2,y:mk.cy-mk.h/2,w:mk.w,h:mk.h}:bbox([...mk.loops.flat(),...((mk.open||[]).flat())]))].filter(b=>isFinite(b.w));
      let shapes;
      if(p.size){ shapes=decoShapes(S.deco, m, m, p.size[0]-m, p.size[1]-m, S.decoCell, S.decoWeb, S.decoSeed, avoid); }
      else { const b=bbox(p.outline); const inner=offsetPoly(p.outline,-6); shapes=decoShapes(S.deco, b.x+6,b.y+6,b.x+b.w-6,b.y+b.h-6, S.decoCell, S.decoWeb, S.decoSeed, avoid).filter(sp=>sp.every(q=>pointIn(q,inner))); }
      p.holes.push(...shapes);
    }
  }
}

/* ================= KERF + LAYOUT ================= */
const FIT={press:0,snug:0.04,glue:-0.06};
const SCREWS={'M2.5':{d:2.7,nw:5.2,nt:2.2},'M3':{d:3.2,nw:5.7,nt:2.6},'M4':{d:4.3,nw:7.2,nt:3.4}};
function finalize(p){
  const k=p.noKerf?0:Math.max(0,S.kerf+(FIT[S.fit]||0))/2, r=S.bit>0?S.bit/2:0;
  let out=offsetPoly(p.outline,k); if(r) out=dogbone(out,r,false);
  let holes=p.holes.map(h=>p.noKerf?h:offsetPoly(h,-k)); if(r) holes=holes.map(h=>dogbone(h,r,true));
  const circles=p.circles.map(c=>({x:c.x,y:c.y,r:Math.max(0.2,c.r-k)}));
  return {name:p.name, idx:p.idx, mat:p.mat||'main', th:p.th, outline:out, holes, circles, slits:p.slits, marks:p.marks||[], bb:bbox(out)};
}
const QTY_MAX=500;                                    // most boxes one cut run can hold
const qtyOf=()=>Math.max(1,Math.min(QTY_MAX,Math.floor(+S.qty)||1));
function layout(fparts){
  const SW=S.sheetW, SH=S.sheetH, g=S.gap, warns=[], q=qtyOf(), groups=new Map();
  for(const f of fparts) for(let k=0;k<q;k++){
    const ff=q>1?Object.assign({},f,{name:f.name+' #'+(k+1)}):f, key=f.mat+'|'+f.th;
    if(!groups.has(key)) groups.set(key,[]); groups.get(key).push({f:ff,w:f.bb.w,h:f.bb.h});
  }
  const sheets=[];
  for(const [key,items] of groups){ const r=maxRectsPack(items,SW,SH,g,!S.grain);
    r.sheets.forEach(sh=>{ sh.mat=key.split('|')[0]; sh.th=+key.split('|')[1]; sheets.push(sh); });
    r.warns.forEach(it=>warns.push('“'+it.f.name+'” ('+fmt(it.f.bb.w)+' × '+fmt(it.f.bb.h)+') does not fit your '+fmt(SW)+' × '+fmt(SH)+' bed'+(S.grain?' with grain lock on':'')+'.')); }
  return {sheets,warns};
}
function xformPt(it,p){ const bb=it.f.bb; let x=p[0]-bb.x, y=p[1]-bb.y; if(it.rot){ const nx=y, ny=bb.w-x; x=nx; y=ny; } return [x+it.x, y+it.y]; }
function sheetLabel(sh){ return fmt(sh.th)+' '+(sh.mat==='acrylic'?'acrylic':(S.matName||'sheet')); }

/* ================= EXPORT: SVG / DXF / ZIP ================= */
const r3=v=>Math.round(v*1000)/1000;
function pathD(pts,closed=true){ return 'M'+pts.map(p=>r3(p[0])+' '+r3(p[1])).join('L')+(closed?'Z':''); }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
const LAYERS={simple:{outer:'#ff0000',inner:'#ff0000',score:'#0000ff',engrave:'#000000'}, lightburn:{outer:'#00e000',inner:'#ff0000',score:'#0000ff',engrave:'#000000'}};
function partGeom(it,preview){
  const f=it.f, T=p=>xformPt(it,p);
  const gaps=S.holdTabs>0?gapOutline(f.outline,S.holdTabs,Math.max(0.1,S.holdW)):null;
  const g={outer: gaps? gaps.map(l=>({pts:l.map(T),closed:false})) : [{pts:f.outline.map(T),closed:true}],
    inner:[...f.holes.map(h=>({pts:h.map(T),closed:true})), ...f.slits.map(s=>({pts:s.map(T),closed:false}))],
    circles:f.circles.map(c=>{ const q=T([c.x,c.y]); return {x:q[0],y:q[1],r:c.r}; }),
    fills:f.marks.filter(m=>m.kind==='fill'&&!m.preview).map(m=>m.loops.map(l=>l.map(T))),
    scores:f.marks.filter(m=>m.kind==='score').flatMap(m=>[...m.loops.map(l=>({pts:l.map(T),closed:true})), ...(m.open||[]).map(l=>({pts:l.map(T),closed:false}))]),
    imgs:f.marks.filter(m=>m.img)};
  if(S.labels && !preview){ const ls=Math.max(2.5,Math.min(5,f.bb.w/14,f.bb.h/4)); const cy=f.bb.y+f.bb.h/2+(f.marks.length?Math.min(f.bb.h*0.3,S.textSize):0);
    g.fills.push(placeLoops(textLoops(f.name,'Helvetica, Arial, sans-serif',ls),f.bb.x+f.bb.w/2,cy,0).map(l=>l.map(T))); }
  return g;
}
function sheetSVG(sh,opts={}){
  const SW=S.sheetW, SHh=S.sheetH, pv=!!opts.preview, sw=pv?Math.max(0.35,SW/700):S.stroke, Lc=LAYERS[S.layerScheme]||LAYERS.simple;
  let O='',I='',Sc='',E='',Im='',lab='',hit='';
  const pd=o=>'<path d="'+pathD(o.pts,o.closed)+'"/>';
  for(const it of sh.items){ const g=partGeom(it,pv), f=it.f;
    O+=g.outer.map(pd).join('');
    I+=g.inner.map(pd).join('')+g.circles.map(c=>'<circle cx="'+r3(c.x)+'" cy="'+r3(c.y)+'" r="'+r3(c.r)+'"/>').join('');
    Sc+=g.scores.map(pd).join('');
    for(const loops of g.fills) if(loops.length) E+='<path d="'+loops.map(l=>pathD(l,true)).join('')+'"/>';
    for(const m of g.imgs){ const q=xformPt(it,[m.cx,m.cy]), r=m.rot+(it.rot?-90:0);
      Im+='<image href="'+m.img+'" x="'+r3(q[0]-m.w/2)+'" y="'+r3(q[1]-m.h/2)+'" width="'+r3(m.w)+'" height="'+r3(m.h)+'" preserveAspectRatio="none"'+(r?' transform="rotate('+r+' '+r3(q[0])+' '+r3(q[1])+')"':'')+'/>'; }
    if(pv){ const cx=it.x+it.w/2, cy=it.y+it.h/2, ls=Math.max(2.5,Math.min(5,it.w/14,it.h/3));
      lab+='<text x="'+r3(cx)+'" y="'+r3(cy+(f.marks.length?Math.min(it.h*0.3,S.textSize*0.9):0))+'" font-size="'+r3(ls)+'" text-anchor="middle" dominant-baseline="central">'+esc(f.name)+'</text>';
      hit+='<path class="pp" data-pi="'+f.idx+'" d="'+pathD(f.outline.map(p=>xformPt(it,p)))+'"/>'; }
  }
  const lb=S.layerScheme==='lightburn';
  const G_=(id,attrs,body)=>body?'<g id="'+id+'" '+attrs+'>'+body+'</g>':'';
  const st='fill="none" stroke-width="'+sw+'" stroke-linejoin="round" stroke="';
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="'+r3(SW)+'mm" height="'+r3(SHh)+'mm" viewBox="0 0 '+r3(SW)+' '+r3(SHh)+'">'
    +(pv?'<rect x="0" y="0" width="'+SW+'" height="'+SHh+'" fill="#fff" stroke="#cfc7ba" stroke-width="'+sw+'"/>':'')
    +G_(lb?'00-engrave-image':'engrave-image','',Im)
    +G_(lb?'00-engrave':'engrave','fill="'+(pv?'#3b3a8f':Lc.engrave)+'" fill-rule="evenodd" stroke="none"',E)
    +G_(lb?'01-score':'score',st+Lc.score+'"',Sc)
    +G_(lb?'02-cut-inner':'cut-inner',st+Lc.inner+'"',I)
    +G_(lb?'03-cut-outer':'cut-outer',st+Lc.outer+'"',O)
    +(pv?'<g fill="#9a9184" font-family="IBM Plex Sans, sans-serif" style="pointer-events:none">'+lab+'</g><g>'+hit+'</g>':'')
    +'</svg>';
}
function sheetDXF(sh){
  const H=S.sheetH, L=[]; const P=(...a)=>L.push(...a);
  P('0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC','0','SECTION','2','ENTITIES');
  const poly=(pts,closed,layer)=>{ P('0','POLYLINE','8',layer,'66','1','70',closed?'1':'0'); for(const p of pts){ P('0','VERTEX','8',layer,'10',r3(p[0]),'20',r3(H-p[1]),'30','0'); } P('0','SEQEND','8',layer); };
  for(const it of sh.items){ const g=partGeom(it,false);
    g.outer.forEach(o=>poly(o.pts,o.closed,'CUT_OUTER'));
    g.inner.forEach(o=>poly(o.pts,o.closed,'CUT_INNER'));
    for(const c of g.circles) P('0','CIRCLE','8','CUT_INNER','10',r3(c.x),'20',r3(H-c.y),'30','0','40',r3(c.r));
    g.scores.forEach(o=>poly(o.pts,o.closed,'SCORE'));
    g.fills.forEach(loops=>loops.forEach(l=>poly(l,true,'ENGRAVE')));
  }
  P('0','ENDSEC','0','EOF'); return L.join('\r\n');
}
const CRC=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc32(b){ let c=0xFFFFFFFF; for(let i=0;i<b.length;i++) c=CRC[(c^b[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function makeZip(files){ // [{name, data:string}]
  const enc=new TextEncoder(), chunks=[], central=[]; let off=0;
  for(const f of files){ const nm=enc.encode(f.name), d=enc.encode(f.data), crc=crc32(d);
    const h=new DataView(new ArrayBuffer(30)); h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(8,0,true); h.setUint32(14,crc,true); h.setUint32(18,d.length,true); h.setUint32(22,d.length,true); h.setUint16(26,nm.length,true);
    chunks.push(new Uint8Array(h.buffer),nm,d);
    const c=new DataView(new ArrayBuffer(46)); c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint32(16,crc,true); c.setUint32(20,d.length,true); c.setUint32(24,d.length,true); c.setUint16(28,nm.length,true); c.setUint32(42,off,true);
    central.push(new Uint8Array(c.buffer),nm); off+=30+nm.length+d.length; }
  const csz=central.reduce((a,b)=>a+b.length,0);
  const e=new DataView(new ArrayBuffer(22)); e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,csz,true); e.setUint32(16,off,true);
  return new Blob([...chunks,...central,new Uint8Array(e.buffer)],{type:'application/zip'});
}
let dlNS=null;
async function saveFile(filename,data){
  if(dlNS){ try{ await dlNS.save({filename,data}); toast('Saved '+filename); return; }catch(e){ if(e&&e.code==='declined'){ toast('Download cancelled'); return; } } }
  try{ const blob=data instanceof Blob?data:new Blob([data]); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); toast('Downloading '+filename); }
  catch(e){ toast('Download is blocked here — use Copy SVG instead'); }
}
(async()=>{ try{ if(window.claude&&window.claude.use){ dlNS=await window.claude.use('downloads'); } }catch(e){} })();

/* ================= 3D RENDERER ================= */
const MATS={
  birch:{face:[226,196,150],side:[176,138,92],a:1,wood:true}, walnut:{face:[122,82,54],side:[84,54,34],a:1,wood:true}, mdf:{face:[168,124,82],side:[120,84,52],a:1,wood:true},
  clear:{face:[190,225,235],side:[120,170,185],a:0.42}, black:{face:[48,48,52],side:[22,22,24],a:1}, pink:{face:[244,150,180],side:[214,100,140],a:0.85}, card:{face:[196,160,112],side:[150,118,78],a:1}
};
const view={yaw:-0.6,pitch:0.5,zoom:1,explode:0,spin:false,mat:'birch',animT:0,play:0,phase:0,loop:false,hw:true,pan:[0,0,0],stereo:'off',stereoDeg:3.5,projection:'ortho',fov:30};
const EDGE_COLOR_KEY='boxsmith-cut-edge-colors';
const cutEdgeColors={};
const savedEdgeColors=lsGet(EDGE_COLOR_KEY,{});
for(const [material,color] of Object.entries(savedEdgeColors)){
  if(MATS[material]?.wood&&typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color)) cutEdgeColors[material]=color.toLowerCase();
}
function cutEdgeRGB(material,key=view.mat){
  const color=cutEdgeColors[key];
  if(!color) return material.side;
  const hex=Number.parseInt(color.slice(1),16);
  return [hex>>16,(hex>>8)&255,hex&255];
}
const stereoActive=()=>view.stereo==='cross'||view.stereo==='parallel';
let scene=null, selPi=-1;
function circlePts(c){ return arc(c.x,c.y,c.r,0,2*PI,18).slice(0,18); }
function makeScene(parts){
  const solids=[];
  for(const p of parts){
    const hs=[...p.holes, ...p.circles.map(circlePts)];
    const top=hs.filter((h,i)=>!hs.some((o,j)=>j!==i && Math.abs(area(o))>Math.abs(area(h)) && pointIn(h[0],o))); // islands drop out; don't show them as nested holes
    const list=p.solids || (p.map?[{pts:p.outline, holes:top, map:p.map}]:[]);
    for(const s of list){
      const {o,u,v,n}=s.map, t=s.th||p.th||G.t;
      const m2=(q,h)=>[o[0]+u[0]*q[0]+v[0]*q[1]+n[0]*h, o[1]+u[1]*q[0]+v[1]*q[1]+n[1]*h, o[2]+u[2]*q[0]+v[2]*q[1]+n[2]*h];
      const loops=[s.pts,...(s.holes||[])];
      const bot=loops.map(L=>L.map(q=>m2(q,0))), top=loops.map(L=>L.map(q=>m2(q,t)));
      const sides=[];
      loops.forEach((L,li)=>{ const sg=(area(L)>0?1:-1)*(li===0?1:-1);
        for(let i=0;i<L.length;i++){ const a=L[i], b=L[(i+1)%L.length]; const dx=b[0]-a[0], dy=b[1]-a[1], ln=Math.hypot(dx,dy)||1;
          const nx=sg*dy/ln, ny=-sg*dx/ln; const N=[u[0]*nx+v[0]*ny,u[1]*nx+v[1]*ny,u[2]*nx+v[2]*ny];
          sides.push({q:[bot[li][i],bot[li][(i+1)%L.length],top[li][(i+1)%L.length],top[li][i]],N}); } });
      let cx=0,cy=0,cz=0,cnt=0; for(const q of bot[0]){ cx+=q[0];cy+=q[1];cz+=q[2];cnt++; }
      const c=[cx/cnt+n[0]*t/2,cy/cnt+n[1]*t/2,cz/cnt+n[2]*t/2];
      solids.push({c,bot,top,n,sides,anim:s.anim||p.anim||null,pts:s.pts,holes:s.holes||[],map:s.map,th:t,look:p.look||null,pi:p.idx,part:p,decal:!p.solids});
    }
  }
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for(const s of solids) for(const L of [s.bot[0],s.top[0]]) for(const q of L) for(let k=0;k<3;k++){ if(q[k]<mn[k])mn[k]=q[k]; if(q[k]>mx[k])mx[k]=q[k]; }
  const ctr=[(mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2];
  const R=Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])/2||1;
  const divs=solids.filter(x=>x.part&&x.part.explode);
  const divTop=divs.length?Math.max(...divs.map(x=>Math.max(...x.bot[0].map(q=>q[2])))):Infinity, divLift=divs.length?Math.max(...divs.map(x=>x.part.explode.lift)):0;
  return {solids,ctr,R:R*(solids.some(x=>x.anim)?1.28:1),divTop,divLift,hardware:G.ts,screwLen:S.screwLen};
}
function buildScene(parts){
  scene=makeScene(parts);
  if(!layingOut()) buildGL();
}
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
/* ---- WebGL renderer (three.js) with true depth; 2D painter is the fallback ---- */
let GL=null;
const LAMP={on:false,gain:1,color:'#ffd6a0',size:1,off:[0,0,0],yaw:-0.32,pitch:0.16};
try{ const c=localStorage.getItem('boxsmith-lampcolor'); if(c) LAMP.color=c; }catch(e){}
function lampBuild(){
  if(GL.lamp) return;
  const light=new THREE.PointLight(0xffd6a0,1.6,0,0); light.castShadow=true; light.shadow.mapSize.set(2048,2048); light.shadow.bias=-0.0006; light.shadow.normalBias=0.15;
  const wm=new THREE.MeshStandardMaterial({color:0xd9d3c9,roughness:0.95,metalness:0,side:THREE.FrontSide});
  const mk=()=>{ const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1,24,24),wm); m.receiveShadow=true; return m; };
  const walls={back:mk(),left:mk(),right:mk(),floor:mk(),ceil:mk()};
  walls.back.rotation.x=PI/2; walls.left.rotation.y=PI/2; walls.right.rotation.y=-PI/2; walls.ceil.rotation.x=PI;
  const room=new THREE.Group(); Object.values(walls).forEach(w=>room.add(w));
  GL.lamp={light,room,walls};
}
// called every frame: switches the whole scene between normal lighting and lamp mode
// Offscreen renders pass their own model and on/off, and leave the page's .view alone.
function lampFrame(model=scene,forceOn){
  if(!GL||!model) return;
  const on=forceOn===undefined?LAMP.on&&!layingOut():forceOn;
  if(forceOn===undefined){ const viewEl=document.querySelector('.view'); if(viewEl) viewEl.classList.toggle('lamp',on); }
  if(on){
    lampBuild(); const L=GL.lamp, R=model.R, C=model.ctr;
    if(!L.light.parent){ GL.sc.add(L.light); GL.sc.add(L.room); }
    L.light.color.set(LAMP.color); L.light.intensity=0.95*LAMP.gain; L.light.distance=R*9; L.light.decay=1.6; L.light.position.set(C[0],C[1],C[2]);
    L.light.shadow.camera.near=Math.max(0.2,R*0.02); L.light.shadow.camera.far=R*16;
    const D=R*LAMP.size, off=[LAMP.off[0]*D*2, LAMP.off[2]*D*2, LAMP.off[1]*D*2]; // x right, farther(+Y), up(+Z)
    const E=[Math.max(2.3*D,R*1.2+Math.abs(off[0])), Math.max(2.0*D,R*1.2+Math.abs(off[1])), Math.max(1.5*D,R*1.2+Math.abs(off[2]))];
    const W=L.walls, mid=[C[0]+off[0],C[1]+off[1],C[2]+off[2]];
    const wy=Math.max(mid[1]+E[1],C[1]+R*1.15), wxl=Math.min(mid[0]-E[0],C[0]-R*1.15), wxr=Math.max(mid[0]+E[0],C[0]+R*1.15), wzf=Math.min(mid[2]-E[2],C[2]-R*1.15), wzc=Math.max(mid[2]+E[2],C[2]+R*1.15);
    W.back.position.set(mid[0],wy,mid[2]); W.back.scale.set(2*E[0],2*E[2],1);
    W.left.position.set(wxl,mid[1],mid[2]); W.left.scale.set(2*E[2],2*E[1],1);
    W.right.position.set(wxr,mid[1],mid[2]); W.right.scale.set(2*E[2],2*E[1],1);
    W.floor.position.set(mid[0],mid[1],wzf); W.floor.scale.set(2*E[0],2*E[1],1);
    W.ceil.position.set(mid[0],mid[1],wzc); W.ceil.scale.set(2*E[0],2*E[1],1);
    GL.amb.intensity=0.11; GL.dl.intensity=0; GL.dl2.intensity=0;
    const trans=MATS[view.mat].a<1;
    for(const ob of GL.objs){ ob.mesh.castShadow=!(trans||ob.s.look==='clear'); ob.edges.visible=false; if(ob.decal) ob.decal.visible=false; }
    GL._lampOn=true;
  } else if(GL._lampOn){
    if(GL.lamp&&GL.lamp.light.parent){ GL.sc.remove(GL.lamp.light); GL.sc.remove(GL.lamp.room); }
    GL.amb.intensity=0.62; GL.dl.intensity=0.55; GL.dl2.intensity=0.12;
    for(const ob of GL.objs){ ob.mesh.castShadow=false; ob.edges.visible=true; if(ob.decal) ob.decal.visible=true; }
    GL._lampOn=false;
  }
}
// One renderer with its own scene, camera, lights and materials. The page uses one on its canvas; offscreen renders make another.
function makeGLContext(canvas,extra){
  const r=new THREE.WebGLRenderer(Object.assign({canvas,antialias:true,alpha:true},extra));
    const sc=new THREE.Scene(), cam=new THREE.OrthographicCamera(-1,1,1,-1,-100000,100000);
    sc.add(cam); const amb=new THREE.AmbientLight(0xffffff,0.62); sc.add(amb);
    const dl=new THREE.DirectionalLight(0xffffff,0.55); dl.position.set(-0.45,0.7,1); cam.add(dl); cam.add(dl.target); dl.target.position.set(0,0,0);
    const dl2=new THREE.DirectionalLight(0xffffff,0.12); dl2.position.set(0.6,-0.3,0.4); cam.add(dl2); cam.add(dl2.target); r.shadowMap.enabled=true; r.shadowMap.type=THREE.PCFShadowMap;
    const root=new THREE.Group(); sc.add(root);
    const cap=new THREE.MeshLambertMaterial(), side=new THREE.MeshLambertMaterial(), line=new THREE.LineBasicMaterial({transparent:true});
    const cl=(c,o)=>new THREE.MeshLambertMaterial({color:c,transparent:true,opacity:o,depthWrite:false,side:THREE.DoubleSide});
    const hiCap=new THREE.MeshLambertMaterial({color:0xf08a63,emissive:0x5a1a05}), hiSide=new THREE.MeshLambertMaterial({color:0xd0562c,emissive:0x3a1003});
    const eyeCams=[new THREE.OrthographicCamera(),new THREE.OrthographicCamera()];
    // perspective: the same orbit, seen through a lens (view.projection 'perspective', view.fov in degrees)
    const pcam=new THREE.PerspectiveCamera(30,1,1,1e6); sc.add(pcam);
    const eyePCams=[new THREE.PerspectiveCamera(),new THREE.PerspectiveCamera()];
    return {r,sc,cam,eyeCams,pcam,eyePCams,root,amb,dl,dl2,cap,side,line,steel:new THREE.MeshLambertMaterial({color:0xb7bcc2,emissive:0x1a1c1f}),nutMat:new THREE.MeshLambertMaterial({color:0x8c9299,emissive:0x111214}),clearCap:cl(0xc4e4ee,0.32),clearSide:cl(0x8fc3d2,0.6),hiCap,hiSide,objs:[]};
}
function initGL(){
  if(!window.THREE) return;
  try{ GL=makeGLContext(document.getElementById('gl')); }catch(e){ GL=null; }
}
// Painted look for the wood faces and cut edges, cached per paint recipe.
const paintCache=new Map();
function paintMaterials(S0,look=view.mat){
  const m=MATS[look];
  if(!S0||!S0.paint||S0.paint==='none'||!m.wood||!/^#[0-9a-f]{6}$/i.test(S0.paintColor||'')) return null;
  const strength=Math.max(0.1,Math.min(1,(+S0.paintStrength||60)/100));
  const key=[S0.paint,S0.paintColor,strength,look,cutEdgeColors[look]||''].join('|');
  if(paintCache.has(key)) return paintCache.get(key);
  const hex=Number.parseInt(S0.paintColor.slice(1),16), p=[hex>>16,(hex>>8)&255,hex&255];
  const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t), mul=(a,b)=>a.map((v,i)=>v*b[i]/255);
  const edge=cutEdgeRGB(m,look);
  let face,side;
  if(S0.paint==='watercolor'){ // pigment tints the wood: half multiply (keeps the grain's depth), half straight color
    const wash=base=>mix(mul(base,p),mix(base,p,0.7),0.5);
    face=mix(m.face,wash(m.face),Math.min(1,strength*1.15)); side=mix(edge,wash(edge),strength*0.6); }
  else { face=p; side=mul(p,[216,216,216]); }
  const c=a=>new THREE.Color(Math.round(a[0])/255,Math.round(a[1])/255,Math.round(a[2])/255);
  const mats={cap:new THREE.MeshLambertMaterial({color:c(face)}),side:new THREE.MeshLambertMaterial({color:c(side)})};
  paintCache.set(key,mats);
  return mats;
}
// Colour given in Arrange boxes: the part's own colour, else all see-through parts' ('acrylic'), else the whole box's ('*').
function partColor(box,s,clear){ const c=box&&box.settings&&box.settings.colors; return c?(c[s.part&&s.part.name]||(clear&&c.acrylic)||c['*']||null):null; }
// Does this arranged box have see-through (acrylic) parts?
function boxHasAcrylic(box){ return !!(GL&&GL.objs.some(o=>o.s.layoutBox===box&&(o.s.look==='clear'||MATS[boxLook(box.settings)].a<1))); }
// Face and edge materials for a colour; acrylic and other see-through parts stay see-through, just tinted.
function colorMaterials(ctx,hex,clear){
  if(!ctx.colorCache) ctx.colorCache=new Map();
  const key=hex+(clear?'|clear':'');
  if(ctx.colorCache.has(key)) return ctx.colorCache.get(key);
  const col=new THREE.Color(hex), edge=col.clone().multiplyScalar(clear?0.8:0.72);
  const mk=(c,o)=>clear?new THREE.MeshLambertMaterial({color:c,transparent:true,opacity:o,depthWrite:false,side:THREE.DoubleSide}):new THREE.MeshLambertMaterial({color:c});
  const mats={cap:mk(col,0.42),side:mk(edge,0.78)};
  ctx.colorCache.set(key,mats);
  return mats;
}
// The material an arranged box keeps: the look it had when it was added. Boxes made without one follow the preview.
function boxLook(settings){ return settings&&MATS[settings.look]?settings.look:view.mat; }
// Face and edge materials for a look other than the preview's own, cached per renderer.
function lookMaterials(ctx,look){
  if(!ctx.lookCache) ctx.lookCache=new Map();
  const m=MATS[look], key=look+'|'+(cutEdgeColors[look]||'');
  if(ctx.lookCache.has(key)) return ctx.lookCache.get(key);
  const c=a=>new THREE.Color(a[0]/255,a[1]/255,a[2]/255), mats={};
  for(const [k,rgb] of [['cap',m.face],['side',cutEdgeRGB(m,look)]]){
    mats[k]=new THREE.MeshLambertMaterial({color:c(rgb),transparent:m.a<1,opacity:m.a,depthWrite:m.a===1,side:m.a<1?THREE.DoubleSide:THREE.FrontSide});
  }
  ctx.lookCache.set(key,mats);
  return mats;
}
function glColors(){
  const m=MATS[view.mat], c=a=>new THREE.Color(a[0]/255,a[1]/255,a[2]/255);
  GL.cap.color=c(m.face); GL.side.color=c(cutEdgeRGB(m));
  for(const k of ['cap','side']){ GL[k].transparent=m.a<1; GL[k].opacity=m.a; GL[k].depthWrite=m.a===1; GL[k].side=m.a<1?THREE.DoubleSide:THREE.FrontSide; GL[k].needsUpdate=true; }
  GL.line.color=new THREE.Color(view.mat==='black'?0xffffff:0x2a1c10); GL.line.opacity=view.mat==='black'?0.25:0.4;
}
function makeDecal(s){
  const p=s.part; const mk=p.marks||[]; if(!mk.length) return null;
  const b=bbox(p.outline), ppm=Math.min(8, 1400/Math.max(b.w,b.h)), cvs=document.createElement('canvas');
  cvs.width=Math.max(4,Math.ceil(b.w*ppm)); cvs.height=Math.max(4,Math.ceil(b.h*ppm));
  const {u,v,n,o}=s.map; const uv=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const eng=mul(uv,-1), toOut=sub(s.c,s.layoutBox?s.layoutBox.model.ctr:scene?scene.ctr:[0,0,0]); const out = (eng[0]*toOut[0]+eng[1]*toOut[1]+eng[2]*toOut[2])>=0 ? 1 : -1;
  const outDir=mul(eng,out), mirror = out<0, onN = (outDir[0]*n[0]+outDir[1]*n[1]+outDir[2]*n[2])>0;
  const c=cvs.getContext('2d');
  const TX=x=>(mirror? (b.x+b.w-x) : (x-b.x))*ppm, TY=y=>(b.y+b.h-y)*ppm;
  c.fillStyle='rgba(58,34,18,0.82)'; c.strokeStyle='rgba(58,34,18,0.9)'; c.lineWidth=Math.max(1.6,ppm*0.35);
  const hexA=(h,a)=>{ const n=parseInt((h||'#000').slice(1),16); return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')'; };
  for(const m of mk){
    const burnt=!m.color||m.color.toLowerCase()==='#000000';
    c.fillStyle=burnt?'rgba(58,34,18,0.82)':hexA(m.color,0.95);
    c.strokeStyle=m.outline?hexA(m.outline,1):(burnt?'rgba(58,34,18,0.9)':hexA(m.color,1));
    if(m.img){ const im=getImg(m.img,()=>{ if(scene) buildGL(), render(); }); if(im.complete&&im.naturalWidth){ c.save(); c.translate(TX(m.cx),TY(m.cy)); c.scale(mirror?-1:1,-1); c.rotate((m.rot||0)*PI/180); c.globalAlpha=0.85; c.globalCompositeOperation='multiply'; c.drawImage(im,-m.w/2*ppm,-m.h/2*ppm,m.w*ppm,m.h*ppm); c.restore(); } continue; }
    const textLine=s.layoutBox?(s.layoutBox.settings.textLine??DEFAULTS.textLine):S.textLine, tl=+textLine>0?+textLine*ppm:0; c.lineWidth=tl||Math.max(1.6,ppm*0.35);
    c.beginPath(); for(const l of m.loops){ l.forEach((q,i)=>i?c.lineTo(TX(q[0]),TY(q[1])):c.moveTo(TX(q[0]),TY(q[1]))); c.closePath(); }
    if(m.kind==='fill'){ c.fill('evenodd'); if(m.outline && !m.preview){ const lw0=c.lineWidth; c.lineWidth=tl||Math.max(1.4,ppm*0.3); c.stroke(); c.lineWidth=lw0; } } else { c.stroke(); for(const l of (m.open||[])){ c.beginPath(); l.forEach((q,i)=>i?c.lineTo(TX(q[0]),TY(q[1])):c.moveTo(TX(q[0]),TY(q[1]))); c.stroke(); } }
  }
  const tex=new THREE.CanvasTexture(cvs); tex.anisotropy=4;
  const mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,side:THREE.DoubleSide});
  const geo=new THREE.PlaneGeometry(b.w,b.h); geo.translate(b.x+b.w/2,b.y+b.h/2,0);
  const mesh=new THREE.Mesh(geo,mat); mesh.matrixAutoUpdate=false; mesh.userData.dz= onN ? s.th+0.06 : -0.06; mesh.renderOrder=2;
  return mesh;
}
function makeHardware(s,model){
  const p=s.part, T=model.hardware; if(!T || !p.tsHoles || !p.tsHoles.length || !view.hw) return null;
  const t=s.th, n=s.map.n, toC=sub(model.ctr,s.c), inward=(n[0]*toC[0]+n[1]*toC[1]+n[2]*toC[2])>=0;
  const L=model.screwLen, Ls=Math.max(T.nt+4, L-t+1), a=Math.max(2, Ls-T.nt-2), headH=T.d*0.6, headR=T.d*0.9;
  const g=new THREE.Group(); g.matrixAutoUpdate=false;
  const z0=inward?0:t, dir=inward?1:-1;
  for(const h of p.tsHoles){
    const shaft=new THREE.CylinderGeometry(T.d/2*0.94,T.d/2*0.94,L,14); shaft.rotateX(PI/2); shaft.translate(h.x,h.y,z0+dir*L/2);
    const head=new THREE.CylinderGeometry(headR,headR,headH,18); head.rotateX(PI/2); head.translate(h.x,h.y,z0-dir*headH/2);
    const nut=new THREE.CylinderGeometry(T.nw/2/Math.cos(PI/6)*0.97,T.nw/2/Math.cos(PI/6)*0.97,T.nt*0.95,6); nut.rotateX(PI/2); nut.translate(h.x,h.y,z0+dir*(t+a+T.nt/2));
    g.add(new THREE.Mesh(shaft,GL.steel), new THREE.Mesh(head,GL.steel), new THREE.Mesh(nut,GL.nutMat));
  }
  return g;
}
function buildGL(model=layingOut()?boxLayoutScene:scene){
  if(!GL) return;
  for(const o of GL.objs){ o.mesh.geometry.dispose(); o.edges.geometry.dispose(); GL.root.remove(o.mesh); GL.root.remove(o.edges); if(o.hw){ GL.root.remove(o.hw); o.hw.children.forEach(m=>m.geometry.dispose()); } if(o.decal){ GL.root.remove(o.decal); o.decal.geometry.dispose(); o.decal.material.map.dispose(); o.decal.material.dispose(); } }
  GL.objs=[];
  for(const s of model.solids){
    try{
      const V2=q=>new THREE.Vector2(q[0],q[1]);
      const shape=new THREE.Shape(s.pts.map(V2));
      for(const h of s.holes){ const hv=h.map(V2); if(THREE.ShapeUtils.isClockWise(hv)) hv.reverse(); shape.holes.push(new THREE.Path(hv)); }
      const geo=new THREE.ExtrudeGeometry(shape,{depth:s.th,bevelEnabled:false,curveSegments:1,steps:1});
      const {o,u,v,n}=s.map;
      const base=new THREE.Matrix4().set(u[0],v[0],n[0],o[0], u[1],v[1],n[1],o[1], u[2],v[2],n[2],o[2], 0,0,0,1);
      const mesh=new THREE.Mesh(geo,s.look==='clear'?[GL.clearCap,GL.clearSide]:[GL.cap,GL.side]); mesh.matrixAutoUpdate=false; mesh.userData.pi=s.pi; mesh.userData.layoutBox=s.layoutBox; mesh.userData.partName=s.part&&s.part.name;
      const ev=[]; const th=s.th;
      for(const L of [s.pts,...s.holes]){ const n=L.length;
        for(let i=0;i<n;i++){ const p=L[i], q=L[(i+1)%n]; ev.push(p[0],p[1],0,q[0],q[1],0, p[0],p[1],th,q[0],q[1],th);
          const r=L[(i-1+n)%n], d1=[p[0]-r[0],p[1]-r[1]], d2=[q[0]-p[0],q[1]-p[1]]; const c=(d1[0]*d2[0]+d1[1]*d2[1])/((Math.hypot(...d1)*Math.hypot(...d2))||1);
          if(c<0.94) ev.push(p[0],p[1],0,p[0],p[1],th); } }
      const eg=new THREE.BufferGeometry(); eg.setAttribute('position',new THREE.Float32BufferAttribute(ev,3));
      const edges=new THREE.LineSegments(eg,GL.line); edges.matrixAutoUpdate=false;
      GL.root.add(mesh); GL.root.add(edges);
      const decal=s.decal?makeDecal(s):null; if(decal) GL.root.add(decal);
      const hw=makeHardware(s,s.layoutBox?.model||model); if(hw) GL.root.add(hw);
      GL.objs.push({s,mesh,edges,base,decal,hw,dz:decal?decal.userData.dz:0});
    }catch(e){}
  }
}
function explodeOff(s,C,ex){ const e=s.part&&s.part.explode; if(e) return [0,0,e.lift*scene.R*ex*1.15];
  const o=mul(sub(s.c,C),ex);
  if(scene.divLift && s.c[2]>=scene.divTop-0.5) o[2]+=scene.divLift*scene.R*ex*1.15*1.25; // lids etc. clear the lifted dividers
  return o; }
const easeS=x=>x<0?0:x>1?1:x*x*(3-2*x);
function animState(s){ const A=s.anim; if(!A||view.animT<=0) return null; const d=A.d||0, e=A.e||1, k=easeS((view.animT-d)/(e-d)); if(k<=0) return null;
  return {tr:A.tr?mul(A.tr,k):null, rot:A.rot?{p:A.rot.p,a:A.rot.a*k,axis:A.rot.axis||'x'}:null}; }
function rotPt(q,R){ const a=R.a, ca=Math.cos(a), sa=Math.sin(a), P0=R.p, x=q[0]-P0[0], y=q[1]-P0[1], z=q[2]-P0[2];
  if(R.axis==='z') return [P0[0]+x*ca-y*sa, P0[1]+x*sa+y*ca, q[2]];
  if(R.axis==='y') return [P0[0]+x*ca+z*sa, q[1], P0[2]-x*sa+z*ca];
  return [q[0], P0[1]+y*ca-z*sa, P0[2]+y*sa+z*ca]; }
// In lamp mode the room stays put and the model turns inside it: the rotation to apply, and the camera axes.
function lampBasis(lamp,right,up,away,c0){
  const cp0=Math.cos(LAMP.pitch), sp0=Math.sin(LAMP.pitch);
  if(!lamp) return {Rl:null,CAMV:{away,up,right}};
  const r0=[Math.cos(LAMP.yaw),-Math.sin(LAMP.yaw),0], a0=[cp0*Math.sin(LAMP.yaw),cp0*Math.cos(LAMP.yaw),-sp0], u0=[sp0*Math.sin(LAMP.yaw),sp0*Math.cos(LAMP.yaw),cp0];
  const Bm=[[right[0],up[0],away[0]],[right[1],up[1],away[1]],[right[2],up[2],away[2]]], B0=[[r0[0],u0[0],a0[0]],[r0[1],u0[1],a0[1]],[r0[2],u0[2],a0[2]]];
  const Q=[0,1,2].map(i=>[0,1,2].map(j=>B0[i][0]*Bm[j][0]+B0[i][1]*Bm[j][1]+B0[i][2]*Bm[j][2]));
  const Rl=new THREE.Matrix4().set(Q[0][0],Q[0][1],Q[0][2],0, Q[1][0],Q[1][1],Q[1][2],0, Q[2][0],Q[2][1],Q[2][2],0, 0,0,0,1);
  Rl.premultiply(new THREE.Matrix4().makeTranslation(c0[0],c0[1],c0[2])); Rl.multiply(new THREE.Matrix4().makeTranslation(-c0[0],-c0[1],-c0[2]));
  return {Rl,CAMV:{away:a0,up:u0,right:r0}};
}
function renderGL(){
  const w=cv.clientWidth, h=cv.clientHeight; if(!w||!h) return;
  GL.r.setPixelRatio(window.devicePixelRatio||1); GL.r.setSize(w,h,false);
  glColors(); lampFrame();
  const arranging=layingOut(), lamp=LAMP.on&&!arranging;
  const model=arranging?boxLayoutScene:scene;
  const {ctr:center,R:radius}=model;
  const explode=arranging?0:view.explode;
  const up0=!arranging&&scene.divLift? (scene.divLift*1.15*1.25+0.6)*scene.R*view.explode : 0;
  const C=[center[0]+view.pan[0],center[1]+view.pan[1],center[2]+up0*0.45+view.pan[2]], cy=Math.cos(view.yaw), sy=Math.sin(view.yaw), cp=Math.cos(view.pitch), sp=Math.sin(view.pitch), cp0=Math.cos(LAMP.pitch), sp0=Math.sin(LAMP.pitch); let cp_=0;
  const stereo=stereoActive(), vw=stereo?w/2:w;
  const scale=Math.min(vw,h)*(stereo?0.42:0.40)/(radius*(1+explode*0.9)+up0*0.45)*view.zoom;
  const away=[cp*sy,cp*cy,-sp], up=[sp*sy,sp*cy,cp], dist=radius*20, right=[cy,-sy,0];
  const {Rl,CAMV}=lampBasis(lamp,right,up,away,scene.ctr);
  // Perspective keeps the orbit and the framing: at the look-at point it shows exactly what the
  // orthographic view shows at the same zoom, so the camera stands at distance = (visible height) /
  // (2·tan(fov/2)), which is a base distance divided by zoom. A wider fov stands closer (stronger perspective).
  const persp=cameraProjection()==='perspective', cam=persp?GL.pcam:GL.cam, fov=cameraFov();
  const pdist=persp?(h/scale)/(2*Math.tan(fov/2*PI/180)):dist;
  for(const L of [GL.dl,GL.dl2]) if(L.parent!==cam){ cam.add(L); cam.add(L.target); }   // the lights ride with whichever camera draws
  GL.curCam=cam; GL.curEyes=persp?GL.eyePCams:GL.eyeCams;
  const setCam=(eye)=>{ const D=persp?pdist:dist, e=eye*D*Math.tan((view.stereoDeg||3.5)/2*PI/180);
    cam.position.set(C[0]-CAMV.away[0]*D+CAMV.right[0]*e,C[1]-CAMV.away[1]*D+CAMV.right[1]*e,C[2]-CAMV.away[2]*D); cam.up.set(CAMV.up[0],CAMV.up[1],CAMV.up[2]); cam.lookAt(C[0],C[1],C[2]);
    if(persp){ cam.fov=fov; cam.aspect=vw/h; cam.near=Math.max(1,D*0.01); cam.far=D+radius*40+10000; }   // near/far keep the whole stage, floor and room in view
    else { cam.left=-vw/2/scale; cam.right=vw/2/scale; cam.top=h/2/scale; cam.bottom=-h/2/scale; cam.near=0.1; cam.far=dist*4; }
    cam.updateProjectionMatrix(); };
  setCam(0);
  const ex=view.explode*1.1, M=new THREE.Matrix4(), Tm=new THREE.Matrix4();
  for(const ob of GL.objs){ const s=ob.s;
    const off=arranging?[0,0,0]:explodeOff(s,scene.ctr,ex);
    const A=arranging?null:animState(s);
    M.identity();
    let tx=off[0],ty=off[1],tz=off[2]; if(A&&A.tr){ tx+=A.tr[0]; ty+=A.tr[1]; tz+=A.tr[2]; }
    M.makeTranslation(tx,ty,tz);
    if(A&&A.rot){ const p=A.rot.p, ax=A.rot.axis; M.multiply(Tm.makeTranslation(p[0],p[1],p[2])); M.multiply(new THREE.Matrix4()[ax==='z'?'makeRotationZ':ax==='y'?'makeRotationY':'makeRotationX'](A.rot.a)); M.multiply(Tm.makeTranslation(-p[0],-p[1],-p[2])); }
    if(arranging){
      const visible=!s.layoutBox.hidden;
      ob.mesh.visible=ob.edges.visible=visible;
      if(ob.decal) ob.decal.visible=visible;
      if(ob.hw) ob.hw.visible=visible;
      M.multiply(s.layoutBox.pose);
    }
    M.multiply(ob.base); if(Rl) M.premultiply(Rl);
    ob.mesh.matrix.copy(M); ob.edges.matrix.copy(M);
    if(ob.decal){ ob.decal.matrix.copy(M).multiply(Tm.makeTranslation(0,0,ob.dz)); }
    if(ob.hw){ ob.hw.matrix.copy(M); ob.hw.matrixWorldNeedsUpdate=true; }
    const clear=s.look==='clear';
    const look=arranging?boxLook(s.layoutBox.settings):view.mat;
    const seeThrough=clear||MATS[look].a<1;
    const sel=arranging?s.layoutBox===layoutBoxes[layoutSelection]&&(!layoutPart||(layoutPart==='acrylic'?seeThrough:(s.part&&s.part.name)===layoutPart)):s.pi===selPi&&selPi>=0;
    const base=look===view.mat?GL:lookMaterials(GL,look);
    const highlightEdge=!clear&&cutEdgeColors[look]?base.side:GL.hiSide;
    const color=arranging?partColor(s.layoutBox,s,seeThrough):null;
    const tint=color?colorMaterials(GL,color,seeThrough):null;
    const paint=sel||clear||s.hw||tint?null:paintMaterials(arranging?s.layoutBox.settings:S,look);
    if(!GL.hiLine) GL.hiLine=new THREE.LineBasicMaterial({color:0xe2461b});
    ob.edges.material = sel&&tint ? GL.hiLine : GL.line;   // a coloured selection keeps its colour and gets orange outlines
    ob.mesh.material = sel&&!tint ? [GL.hiCap,highlightEdge] : tint?[tint.cap,tint.side]:(clear?[GL.clearCap,GL.clearSide]:paint?[paint.cap,paint.side]:[base.cap,base.side]);
  }
  if(!stereo){ GL.r.setScissorTest(false); GL.r.setViewport(0,0,w,h); GL.r.render(GL.sc,cam); }
  else {
    // cross-eyed: the left picture is what the RIGHT eye sees; parallel: left picture = left eye
    const eyes = view.stereo==='cross' ? [1,-1] : [-1,1];
    GL.r.setScissorTest(true); GL.r.setClearColor(0x000000,0); GL.r.clear();
    eyes.forEach((eye,i)=>{
      setCam(eye);
      GL.r.setViewport(i*vw,0,vw,h);
      GL.r.setScissor(i*vw,0,vw,h);
      GL.r.render(GL.sc,cam);
      GL.curEyes[i].copy(cam,false);
    });
    GL.r.setScissorTest(false); GL.r.setViewport(0,0,w,h); setCam(0);
  }
  // soft ground shadow on the overlay canvas
  const dpr=window.devicePixelRatio||1;
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){ cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); }
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
  if(stereo){ ctx.strokeStyle='rgba(120,100,80,0.25)'; ctx.setLineDash([4,6]); ctx.beginPath(); ctx.moveTo(w/2,10); ctx.lineTo(w/2,h-10); ctx.stroke(); ctx.setLineDash([]); }
}
function render(){
  if(!scene) return;
  if(GL){ renderGL(); return; }
  const dpr=window.devicePixelRatio||1, w=cv.clientWidth, h=cv.clientHeight;
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){ cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); }
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
  if(layingOut()) return;
  const cy=Math.cos(view.yaw), sy=Math.sin(view.yaw), cp=Math.cos(view.pitch), sp=Math.sin(view.pitch);
  const ex=view.explode*1.1, C=scene.ctr;
  const scale=Math.min(w,h)*0.40/(scene.R*(1+view.explode*0.9))*view.zoom;
  const rot=(q)=>{ const x=q[0]-C[0], y=q[1]-C[1], z=q[2]-C[2]; const x1=x*cy-y*sy, y1=x*sy+y*cy; return [x1, y1*cp-z*sp, y1*sp+z*cp]; }; // [sx, depth, up]
  const rn=(N)=>{ const x1=N[0]*cy-N[1]*sy, y1=N[0]*sy+N[1]*cy; return [x1, y1*cp-N[2]*sp, y1*sp+N[2]*cp]; };
  const Ldir=[-0.45,-0.75,0.5]; const Ll=Math.hypot(...Ldir); const Ld=Ldir.map(v=>v/Ll);
  const mat=MATS[view.mat], sidesRGB=cutEdgeRGB(mat);
  const shade=(base,N,amb)=>{ const r=rn(N); const lam=Math.max(0,-(r[0]*Ld[0]+r[1]*Ld[1]-r[2]*Ld[2])*-1); const d=Math.max(0, N[0]*-0.35+N[1]*-0.55+N[2]*0.76); const k=amb+(1-amb)*(0.35+0.65*d); return 'rgba('+Math.round(base[0]*k)+','+Math.round(base[1]*k)+','+Math.round(base[2]*k)+','+mat.a+')'; };
  const ease=x=>x<0?0:x>1?1:x*x*(3-2*x);
  const items=scene.solids.map(s=>{ const off=explodeOff(s,C,ex); let tf=q=>[q[0]+off[0],q[1]+off[1],q[2]+off[2]], tn=N=>N;
    const A=s.anim; if(A && view.animT>0){ const d=A.d||0, k=ease((view.animT-d)/((A.e||1)-d));
      if(k>0){ if(A.tr){ const v=mul(A.tr,k); tf=q=>[q[0]+off[0]+v[0],q[1]+off[1]+v[1],q[2]+off[2]+v[2]]; }
        if(A.rot){ const R={p:A.rot.p,a:A.rot.a*k,axis:A.rot.axis||'x'}, R0={p:[0,0,0],a:R.a,axis:R.axis};
          tf=q=>{ const r=rotPt(q,R); return [r[0]+off[0],r[1]+off[1],r[2]+off[2]]; }; tn=N=>rotPt(N,R0); } } }
    const rc=rot(tf(s.c)); let mn=Infinity; for(const L of [s.bot[0],s.top[0]]) for(const q of L){ const r=rot(tf(q)); if(r[1]<mn) mn=r[1]; } return {s,tf,tn,depth:rc[1]*0.35+mn*0.65}; });
  items.sort((a,b)=>b.depth-a.depth);
  const P=(q,tf)=>{ const r=rot(tf(q)); return [w/2+r[0]*scale, h/2-r[2]*scale, r[1]]; };
  ctx.lineJoin='round';
  // ground shadow
  ctx.save(); ctx.fillStyle='rgba(60,45,30,0.07)'; ctx.beginPath();
  const g0=P([C[0],C[1],C[2]-scene.R*0.75],q=>q); ctx.ellipse(g0[0],g0[1],scene.R*scale*0.8,scene.R*scale*0.8*Math.max(0.12,Math.abs(sp)),0,0,2*PI); ctx.fill(); ctx.restore();
  const edge=view.mat==='black'?'rgba(255,255,255,0.18)':'rgba(40,28,16,0.38)';
  for(const it of items){ const s=it.s, tf=it.tf, tn=it.tn;
    const fs=[];
    for(const sd of s.sides){ const N=tn(sd.N), r=rn(N); if(mat.a===1 && r[1]>=-1e-6) continue; const pts=sd.q.map(q=>P(q,tf)); fs.push({pts,d:(pts[0][2]+pts[1][2]+pts[2][2]+pts[3][2])/4,N}); }
    fs.sort((a,b)=>b.d-a.d);
    ctx.lineWidth=0.6; ctx.strokeStyle=edge;
    for(const f of fs){ ctx.beginPath(); f.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath(); ctx.fillStyle=shade(sidesRGB,f.N,0.55); ctx.fill(); if(mat.a===1) ctx.stroke(); }
    const sn=tn(s.n), rnN=rn(sn); const topVis=rnN[1]<0;
    const caps=mat.a<1?[[s.bot,mul(sn,-1)],[s.top,sn]]:[[topVis?s.top:s.bot, topVis?sn:mul(sn,-1)]];
    for(const [loops,N] of caps){ ctx.beginPath(); for(const L of loops){ L.forEach((q,i)=>{ const p=P(q,tf); i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]); }); ctx.closePath(); }
      ctx.fillStyle=shade(mat.face,N,0.6); ctx.fill('evenodd'); ctx.lineWidth=0.9; ctx.strokeStyle=edge; ctx.stroke(); }
  }
}
// interaction
(function(){
  const ptrs=new Map(); let last=null, pinch0=null, zoom0=1;
  let down=null;
  cv.addEventListener('pointerdown',e=>{ down=[e.clientX,e.clientY]; cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,[e.clientX,e.clientY]); last=[e.clientX,e.clientY]; if(ptrs.size===1&&e.button===0&&layoutDragStart(e)) last=null; if(ptrs.size===2){ layoutDragEnd(); down=null; const [a,b]=[...ptrs.values()]; pinch0=Math.hypot(a[0]-b[0],a[1]-b[1]); zoom0=view.zoom; } });
  cv.addEventListener('pointermove',e=>{ if(!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId,[e.clientX,e.clientY]);
    if(ptrs.size===2&&pinch0){ const [a,b]=[...ptrs.values()]; view.zoom=Math.max(0.3,Math.min(5,zoom0*Math.hypot(a[0]-b[0],a[1]-b[1])/pinch0)); render(); return; }
    if(down && Math.hypot(e.clientX-down[0],e.clientY-down[1])>=6) down=null;
    if(layoutDragMove(e)) return;
    if(last){ view.yaw-=(e.clientX-last[0])*0.01; view.pitch=Math.max(-1.45,Math.min(1.45,view.pitch+(e.clientY-last[1])*0.01)); last=[e.clientX,e.clientY]; render(); } });
  let tap0=null;
  const up=e=>{ layoutDragEnd(); if(e.type==='pointerup' && e.pointerType==='touch' && down && ptrs.size===1 && Math.hypot(e.clientX-down[0],e.clientY-down[1])<8){ const now=performance.now(); if(tap0 && now-tap0.t<350 && Math.hypot(e.clientX-tap0.x,e.clientY-tap0.y)<30 && maximizedView()){ tap0=null; setMax(false); down=null; ptrs.delete(e.pointerId); if(ptrs.size<2) pinch0=null; last=null; return; } tap0={t:now,x:e.clientX,y:e.clientY}; }
    if(e.type==='pointerup' && down && Math.hypot(e.clientX-down[0],e.clientY-down[1])<6 && ptrs.size===1) pick3D(e); down=null; ptrs.delete(e.pointerId); if(ptrs.size<2) pinch0=null; last=ptrs.size?[...ptrs.values()][0]:null; };
  cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
  cv.addEventListener('wheel',e=>{ e.preventDefault(); view.zoom=Math.max(0.3,Math.min(5,view.zoom*Math.exp(-e.deltaY*0.0015))); render(); },{passive:false});
  cv.addEventListener('dblclick',()=>{
    if(maximizedView()){
      setMax(false);
      return;
    }
    view.yaw=-0.6; view.pitch=0.5; view.zoom=1; render();
  });
  let lastT=0; const loop=(ts)=>{ const dt=lastT?Math.min(50,ts-lastT):0; let dirty=false;
    if(view.spin && curView==='3d'){ view.yaw-=dt*0.0004; dirty=true; }
    if(view.play>0){ view.phase+=dt/1000; const T=[1.3,1.0,1.3,0.5], tot=T[0]+T[1]+T[2]+T[3]; let ph=view.phase;
      if(ph>=tot){ view.phase=ph=ph-tot; if(!view.loop) view.play--; }
      view.animT = view.play<=0?0 : ph<T[0]?ph/T[0] : ph<T[0]+T[1]?1 : ph<T[0]+T[1]+T[2]?1-(ph-T[0]-T[1])/T[2] : 0;
      dirty=true; syncPlayBtn(); }
    if(dirty && curView==='3d') render(); lastT=ts; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  new ResizeObserver(()=>render()).observe(cv);
})();

function rayFromEvent(e){
  const r=cv.getBoundingClientRect();
  const x=(e.clientX-r.left)/r.width, y=(e.clientY-r.top)/r.height;
  const stereo=stereoActive(), pane=x<0.5?0:1;
  const ndc=new THREE.Vector2((stereo?x*2-pane:x)*2-1,1-y*2);
  const rc=new THREE.Raycaster();
  rc.setFromCamera(ndc,stereo?(GL.curEyes||GL.eyeCams)[pane]:(GL.curCam||GL.cam));
  GL.root.updateMatrixWorld(true);
  return rc;
}
function pick3D(e){
  if(maximizedView() && window.revealOverlays) window.revealOverlays();
  if(maximizedLayout()) return;
  if(!GL||!scene||(!layingOut()&&(curView!=='3d'||view.stereo!=='off'))) return;
  const rc=rayFromEvent(e);
  const hits=rc.intersectObjects(GL.objs.filter(o=>o.mesh.visible).map(o=>o.mesh),false);
  if(layingOut()){ pickLayoutBox(rc,hits[0]); return; }
  selectPart(hits.length?hits[0].object.userData.pi:-1);
}
function selectPart(pi){
  selPi=(pi===selPi?-1:pi); render(); markSheetSel(); showSel();
}
function markSheetSel(){ $$('#sheets .pp').forEach(el=>el.classList.toggle('sel',+el.dataset.pi===selPi)); }
function showSel(){ const el=$('#selInfo'); if(!el) return; const f=LAST&&LAST.fparts.find(x=>x.idx===selPi);
  if(!f||layingOut()){ el.classList.add('hidden'); return; } el.classList.remove('hidden');
  el.innerHTML='<b>'+esc(f.name)+'</b> · '+fmt(f.bb.w)+' × '+fmt(f.bb.h)+' <span>— also highlighted on the cut sheet</span>'; }
/* ================= UI ================= */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const ICONS={
  closed:'<path d="M5 11l7-5h14l-7 5z" fill="#f2b398"/><rect x="5" y="11" width="14" height="14" fill="#e2461b"/><path d="M19 11l7-5v14l-7 5z" fill="#b3330f"/>',
  open:'<path d="M5 13l7-5h14l-7 5z" fill="#3a2b22"/><rect x="5" y="13" width="14" height="12" fill="#e2461b"/><path d="M19 13l7-5v12l-7 5z" fill="#b3330f"/><path d="M5 13l7-5h14l-7 5z" fill="none" stroke="#e2461b"/>',
  liftoff:'<path d="M4 7l7-4h16l-7 4z" fill="#f2b398"/><rect x="4" y="7" width="16" height="2" fill="#e2461b"/><rect x="5" y="14" width="14" height="12" fill="#e2461b"/><path d="M19 14l7-4v12l-7 4z" fill="#b3330f"/><path d="M5 14l7-4h14" fill="none" stroke="#b3330f"/>',
  split:'<path d="M5 7l7-4h14l-7 4z" fill="#f2b398"/><rect x="5" y="7" width="14" height="6" fill="#e2461b"/><path d="M19 7l7-4v6l-7 4z" fill="#b3330f"/><rect x="5" y="15" width="14" height="11" fill="#e2461b"/><path d="M19 15l7-4v11l-7 4z" fill="#b3330f"/>',
  sliding:'<rect x="5" y="13" width="14" height="13" fill="#e2461b"/><path d="M19 13l7-5v13l-7 5z" fill="#b3330f"/><path d="M1 12l7-5h12l-7 5z" fill="#f2b398"/>',
  hinged:'<rect x="5" y="15" width="14" height="11" fill="#e2461b"/><path d="M19 15l7-5v11l-7 5z" fill="#b3330f"/><path d="M12 10l7-7v10l-7 7z" fill="#f2b398"/><path d="M12 10h7" stroke="#b3330f"/><circle cx="21" cy="12" r="1.6" fill="#3a2b22"/>',
  drawer:'<rect x="5" y="6" width="16" height="20" fill="#b3330f"/><rect x="6" y="7.5" width="14" height="8" fill="#e2461b"/><rect x="2" y="17" width="14" height="8" fill="#f2b398"/><rect x="7" y="20" width="4" height="1.6" rx=".8" fill="#3a2b22"/>',
  polygon:'<path d="M16 3l11 6v14l-11 6-11-6V9z" fill="#e2461b"/><path d="M16 3l11 6-11 6-11-6z" fill="#f2b398"/><path d="M16 15v14" stroke="#b3330f"/>',
  rounded:'<rect x="4" y="10" width="24" height="16" rx="7" fill="#e2461b"/><rect x="4" y="5" width="24" height="10" rx="5" fill="#f2b398"/><path d="M7 18v5M9 18v6M23 18v6M25 18v5" stroke="#fbe6dd" stroke-width=".8"/>',
  pencil:'<rect x="3" y="14" width="26" height="10" fill="#e2461b"/><path d="M3 14l4-4h24l-4 4z" fill="#b3330f"/><path d="M5 10l20-6 4 3-20 6z" fill="#f2b398"/><circle cx="7" cy="11" r="1.4" fill="#3a2b22"/>',
  card:'<path d="M3 14h4l0 12H3z" fill="#b3330f"/><path d="M3 26h22V8L3 16z" fill="#e2461b"/><rect x="9" y="6" width="5" height="4" fill="#f2b398"/><rect x="8" y="9" width="12" height="9" fill="#f2b398"/><rect x="15" y="4" width="5" height="4" fill="#fbe6dd"/>',
  nested:'<rect x="3" y="12" width="20" height="15" fill="#e2461b"/><rect x="8" y="7" width="14" height="10" fill="#f08a63"/><rect x="12" y="3" width="9" height="7" fill="#f2b398"/>',
  puzzle:'<rect x="4" y="13" width="22" height="13" fill="#e2461b"/><path d="M4 13l5-5h22l-5 5z" fill="#f2b398"/><path d="M26 13l5-5v13l-5 5z" fill="#b3330f"/><circle cx="12" cy="10.5" r="2" fill="#3a2b22"/><text x="20" y="22" font-size="9" font-weight="700" fill="#fff" font-family="sans-serif">?</text>',
  book:'<path d="M8 6h20v20H8a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5z" fill="#e2461b"/><rect x="9" y="9" width="17" height="14" fill="#fbe6dd"/><path d="M5 10v12" stroke="#fbe6dd" stroke-dasharray="1 1.4"/>',
  frame:'<path fill-rule="evenodd" d="M3 8h26v18H3zM10 14h12v6H10z" fill="#e2461b"/><path d="M3 8l4-4h22l-0 4z" fill="#f2b398"/><path d="M10 14l3-2h9l-0 2z" fill="#b3330f"/>',
  cubeframe:'<path fill-rule="evenodd" d="M4 11h17v17H4zM9 16h7v7H9z" fill="#e2461b"/><path fill-rule="evenodd" d="M4 11l7-7h17l-7 7zM11.5 8.5l2-2h7l-2 2z" fill="#f2b398"/><path fill-rule="evenodd" d="M21 11l7-7v17l-7 7zM23.5 14.5l2-2v7l-2 2z" fill="#b3330f"/>',
  display:'<rect x="2" y="24" width="28" height="4" fill="#b3330f"/><rect x="6" y="7" width="20" height="17" fill="#c4e4ee" stroke="#5f9fb3"/><circle cx="16" cy="18" r="4" fill="#e2461b"/>',
  kerftest:'<path d="M3 10h4v6h2v-6h4v6h2v-6h4v6h2v-6h8v14H3z" fill="#e2461b"/><rect x="11" y="4" width="2" height="12" fill="#3a2b22"/>'
};
$('#types').innerHTML=TYPES.map(t=>'<button class="type" data-type="'+t.id+'"><svg viewBox="0 0 32 32">'+ICONS[t.ic]+'</svg><div><b>'+t.name+'</b><span>'+t.d+'</span></div></button>').join('');
$('#tcReset').addEventListener('click',()=>{ S.textColor='#000000'; update(); });
$('#frameSel').innerHTML='<option value="none">None</option>'+Object.entries(FRAMES).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('');
$('#accentSel').innerHTML='<option value="none">None</option>'+Object.entries(ACCENTS).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('');
const isLen=k=>!!document.querySelector('[data-k="'+k+'"][data-len]');
function fmt(mm,dec){ if(S.unit==='in'){ return (mm/25.4).toFixed(dec??3).replace(/\.?0+$/,'')+'″'; } return (Math.round(mm*10)/10).toString()+' mm'; }
const PAINT_SWATCHES=[['#d94b3d','Red'],['#ee8a2f','Orange'],['#f2c53d','Yellow'],['#5aa469','Green'],['#3a7bd5','Blue'],['#2f4f9d','Indigo'],['#8a5bb5','Violet'],['#e58db0','Pink'],['#2a2a2e','Black'],['#f4efe6','White']];
function syncInputs(){
  $$('[data-k]').forEach(el=>{ const k=el.dataset.k; let v=S[k];
    if(el.type==='checkbox') el.checked=!!v;
    else if(el.hasAttribute('data-len')){ const inch=S.unit==='in'; el.step = inch ? (['kerf','kStep','t','clr','pin','hPitch','hBridge'].includes(k)?'0.001':'0.0625') : (['kerf','kStep'].includes(k)?'0.01':el.getAttribute('step')||'1'); if(document.activeElement!==el) el.value= inch? +(v/25.4).toFixed(4) : +(+v).toFixed(3); }
    else if(document.activeElement!==el) el.value=v; });
  $$('#types .type').forEach(b=>{ const on=b.dataset.type===S.type; b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); });
  $$('#unitSeg button').forEach(b=>b.classList.toggle('on',b.dataset.u===S.unit));
  $$('#dimSeg button').forEach(b=>b.classList.toggle('on',b.dataset.m===S.dimMode));
  $$('#alignSeg button').forEach(b=>b.classList.toggle('on',b.dataset.al===(S.textAlign||'center')));
  $$('#cornerSeg button').forEach(b=>b.classList.toggle('on',b.dataset.c===S.corners));
  $('#cornerHint').textContent={pinwheel:'Top and bottom have no corners; each wall owns one top corner and the diagonally opposite bottom corner, spiralling around the box. Square boxes get four identical walls.',edge:'Top and bottom have no corners; each wall owns both corners of one vertical edge, rotating around the box.',classic:'Front and back own all eight corners; top, bottom and sides have none.'}[S.corners]||'';
  $$('[data-show]').forEach(el=>el.classList.toggle('hidden',!el.dataset.show.split(' ').includes(S.type)));
  $$('[data-hide]').forEach(el=>el.classList.toggle('hidden',el.dataset.hide.split(' ').includes(S.type)));
  const hc=$('#hwLbl'); if(hc) hc.classList.toggle('hidden', S.tslot==='off');
  const ph=$('#pullHVal'); if(ph) ph.textContent=fmt(+S.pullH||0); const pw=$('#pullHWrap'); if(pw) pw.classList.toggle('hidden',S.pull!=='slot');
  const hh_=$('#handleHVal'); if(hh_) hh_.textContent=fmt(+S.handleH||0); const nh_=$('#notchHVal'); if(nh_) nh_.textContent=fmt(+S.notchH||0);
  { const isArt=String(S.deco).startsWith('art'); $$('.patOnly').forEach(e=>e.classList.toggle('hidden',isArt||S.deco==='none')); $$('.artOnly').forEach(e=>e.classList.toggle('hidden',!isArt||S.deco==='none')); const dv=$('#decoScaleVal'); if(dv) dv.textContent=Math.round(+S.decoScale||100)+'%'; }
  { const ps=$('#paintStrengthWrap'); if(ps) ps.classList.toggle('hidden',S.paint!=='watercolor');
    const pv=$('#paintStrengthVal'); if(pv) pv.textContent=Math.round(+S.paintStrength||0)+'%';
    const ph2=$('#paintHint'); if(ph2) ph2.textContent=S.paint==='watercolor'?'A thin transparent wash: the wood grain and tone show through, and the cut edges soak up some color.':S.paint==='acrylic'?'Opaque coverage: the faces take the exact color and the edges are painted slightly darker.':'';
    const sw=$('#paintSwatches'); if(sw&&!sw.children.length){ for(const c of PAINT_SWATCHES){ const b=document.createElement('button'); b.type='button'; b.className='lc'; b.style.background=c[0]; b.title=c[1]; b.dataset.c=c[0]; b.addEventListener('click',()=>{ S.paintColor=c[0]; update(); }); sw.appendChild(b); } } }
  const fg=$('#frameGapVal'); if(fg) fg.textContent=fmt(+S.frameGap||0);
  const fs=$('#frameSpVal'); if(fs) fs.textContent=fmt(+S.frameSpacing||0); const fsw=$('#frameSpWrap'); if(fsw) fsw.classList.toggle('hidden', S.frame==='none' || (+S.frameCount||1)<2);
  { const nb=S.frame==='none'?0:Math.max(0,Math.min(6,(+S.frameCount||1))-1), box=$('#bandRows'); if(box){ $('#bandWrap').classList.toggle('hidden',nb<1);
    if(box.children.length!==nb){ box.innerHTML=''; for(let k=0;k<nb;k++){ const r=document.createElement('div'); r.style.cssText='display:flex;gap:8px;align-items:center;margin:4px 0'; r.innerHTML='<span style="min-width:120px;font-size:12px">Between '+(k+1)+' and '+(k+2)+'</span><input type="color" class="cpick"><label class="chk" style="padding:0"><input type="checkbox"> None</label>';
      const ci=r.querySelector('input[type=color]'), ni=r.querySelector('input[type=checkbox]'), set=()=>{ S.frameBands=(S.frameBands||[]).slice(); while(S.frameBands.length<nb) S.frameBands.push(''); S.frameBands[k]=ni.checked?'':ci.value; update(); };
      ci.addEventListener('input',()=>{ ni.checked=false; set(); }); ni.addEventListener('change',set); box.appendChild(r); } }
    [...box.children].forEach((r,k)=>{ const c=(S.frameBands||[])[k]||'', ci=r.querySelector('input[type=color]'), ni=r.querySelector('input[type=checkbox]'); ni.checked=!c; if(c&&document.activeElement!==ci) ci.value=c; else if(!c&&document.activeElement!==ci) ci.value='#d9b36c'; }); } }
  $$('[data-show-mode]').forEach(el=>el.classList.toggle('hidden', S.textMode!==el.dataset.showMode));
  $$('[data-showk]').forEach(el=>{ const v=S[el.dataset.showk]; el.classList.toggle('hidden', !v || v==='off' || v==='none' || v==='square'); });
  $('#lblW').textContent=S.type==='polygon'?'Across flats':'Width';
  $('#tPreset').value=['3','3.175','4','5.2','6','6.35','1.5'].find(x=>Math.abs(+x-S.t)<1e-6)||'';
  $('#bedPreset').value=[...$('#bedPreset').options].map(o=>o.value).find(v=>v&&v.split('x').every((n,i)=>Math.abs(+n-(i?S.sheetH:S.sheetW))<0.05))||'';
}
$$('[data-k]').forEach(el=>{
  const ev=(el.type==='checkbox'||el.tagName==='SELECT')?'change':'input';
  el.addEventListener(ev,()=>{ const k=el.dataset.k;
    if(el.type==='checkbox') S[k]=el.checked;
    else if(el.type==='range'){ S[k]=parseFloat(el.value); }
    else if(el.type==='number'){ let v=parseFloat(el.value); if(!isFinite(v)) return; if(el.hasAttribute('data-len')&&S.unit==='in') v*=25.4; S[k]=v; }
    else S[k]=el.value;
    update(); });
});
$('#types').addEventListener('click',e=>{ const b=e.target.closest('.type'); if(!b) return; S.type=b.dataset.type; update(true); if(curView==='3d') playDemo(false); });
function setMeasurementUnit(unit){
  if(S.unit===unit) return;
  S.unit=unit;
  update();
}
$('#unitSeg').addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(button) setMeasurementUnit(button.dataset.u);
});
$('#cornerSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; S.corners=b.dataset.c; update(); if(curView==='3d'){ const keep=S.type; if(keep==='closed'||keep==='open') playDemo(false); } });
$('#alignSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; S.textAlign=b.dataset.al; update(); });
$('#dimSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; S.dimMode=b.dataset.m; update(); });
$('#tPreset').addEventListener('change',e=>{ if(e.target.value){ S.t=+e.target.value; update(); } });
$('#bedPreset').addEventListener('change',e=>{ if(e.target.value){ const [a,b]=e.target.value.split('x'); S.sheetW=+a; S.sheetH=+b; update(); } });
$('#toKerf').addEventListener('click',e=>{ e.preventDefault(); S.type='kerftest'; update(true); });
$('#resetAll').addEventListener('click',e=>{ e.preventDefault(); confirmTwice(e.currentTarget,'Click again to reset',()=>{ S=Object.assign({},DEFAULTS); update(true); toast('Reset to defaults'); }); });
let curView='3d';
$('#tabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; const wasLayout=layingOut(); curView=b.dataset.v;
  if(curView!=='3d'&&!layingOut()&&maximizedView()) setMax(false);
  $$('#tabs button').forEach(x=>{ x.classList.toggle('on',x===b); x.setAttribute('aria-selected',String(x===b)); });
  $('#sheets').classList.toggle('hidden',curView!=='sheets'); $('#guide').classList.toggle('hidden',curView!=='guide'); $('#help').classList.toggle('hidden',curView!=='help');
  $('#v3dctl').classList.toggle('hidden',curView!=='3d'); $('#dims').classList.toggle('hidden',curView!=='3d');
  $('#lampCtl').classList.toggle('hidden',curView!=='3d'||!LAMP.on);
  $('#layoutCtl').classList.toggle('hidden',!layingOut());
  document.body.classList.toggle('layout-view',layingOut());
  if(wasLayout!==layingOut()){
    switchBoxLayoutCamera();
    syncStereoControls();
    buildGL();
  }
  placingBox=false;
  syncBoxLayout();
  showSel();
  if(curView==='3d'||layingOut()) render();
});
$('#help').addEventListener('click',e=>{ const a=e.target.closest('a[href^="#h-"]'); if(!a) return; e.preventDefault(); const t=document.getElementById(a.getAttribute('href').slice(1)); if(t) t.scrollIntoView({behavior:'smooth',block:'start'}); });
$('#explode').addEventListener('input',e=>{ view.explode=e.target.value/100; render(); });
function syncPlayBtn(){ const b=$('#playBtn'); const on=view.play>0&&view.loop; const txt=on?'■ Stop':'▶ Show it work'; if(b.textContent!==txt) b.textContent=txt; }
function playDemo(loop){ view.loop=!!loop; view.play=loop?1:1; view.phase=0; syncPlayBtn(); }
$('#playBtn').addEventListener('click',()=>{ if(view.play>0&&view.loop){ view.play=0; view.loop=false; view.animT=0; render(); syncPlayBtn(); } else playDemo(true); });
// collapsible sub-groups inside a section
(function(){
  const KEY='boxsmith-collapsed-sub'; let shut=[]; try{ shut=JSON.parse(localStorage.getItem(KEY)||'[]'); }catch(e){}
  $$('.subsec').forEach(g=>{ const n=g.dataset.name; if(shut.includes(n)) g.classList.add('collapsed');
    g.querySelector('.subhd').addEventListener('click',()=>{ g.classList.toggle('collapsed'); shut=$$('.subsec.collapsed').map(x=>x.dataset.name); try{ localStorage.setItem(KEY,JSON.stringify(shut)); }catch(e){} }); });
})();
// collapsible sidebar sections with bold headings
(function(){
  const KEY='boxsmith-collapsed'; let shut=[]; try{ shut=JSON.parse(localStorage.getItem(KEY)||'[]'); }catch(e){}
  $$('aside .sec').forEach(sec=>{
    const h=sec.querySelector(':scope > h2'); if(!h) return;
    const first=h.firstChild, name=(first&&first.nodeType===3?first.textContent:h.textContent).trim();
    const lab=document.createElement('span'); lab.className='hl'; lab.innerHTML='<span class="chev">▼</span>';
    lab.appendChild(document.createTextNode(name)); if(first&&first.nodeType===3) first.remove(); else h.textContent='';
    h.insertBefore(lab,h.firstChild); h.setAttribute('role','button'); h.tabIndex=0; h.addEventListener('keydown',e=>{ if((e.key==='Enter'||e.key===' ')&&e.target===h){ e.preventDefault(); h.click(); } }); h.setAttribute('aria-expanded','true'); h.dataset.name=name;
    if(shut.includes(name)){ sec.classList.add('collapsed'); h.setAttribute('aria-expanded','false'); }
    h.addEventListener('click',e=>{ if(e.target.closest('button,select,input,a')) return;
      const c=sec.classList.toggle('collapsed'); h.setAttribute('aria-expanded',String(!c));
      shut=$$('aside .sec.collapsed > h2').map(x=>x.dataset.name); try{ localStorage.setItem(KEY,JSON.stringify(shut)); }catch(err){} });
  });
})();
function maximizedView(){
  return document.body.classList.contains('max3d');
}
function maximizedLayout(){
  return layingOut()&&maximizedView();
}
function setMax(on){
  on=!!on; if(on===maximizedView()) return;
  document.body.classList.toggle('max3d',on);
  $$('[data-maximize-view]').forEach(button=>{ button.textContent=on?'✕ Exit maximize':'⤢ Maximize'; });
  if(on){ if(window.revealOverlays) window.revealOverlays(); const x=$('#previewExitMax'); if(x) x.focus({preventScroll:true}); }
  else { const b=layingOut()?$('#layoutCtl [data-maximize-view]'):$('#maxBtn'); if(b) b.focus({preventScroll:true}); }
  requestAnimationFrame(render); setTimeout(render,120);
}
$$('[data-maximize-view]').forEach(button=>button.addEventListener('click',()=>{
  setMax(!maximizedView());
}));
$('#previewExitMax').addEventListener('click',()=>setMax(false));
(function(){ const KEY='boxsmith-ui';
  const apply=m=>{ document.body.classList.toggle('simple-ui',m==='simple'); $$('#uiModeSeg button').forEach(b=>{ const on=b.dataset.ui===m; b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); }); try{ localStorage.setItem(KEY,m); }catch(e){} };
  let m='all'; try{ m=localStorage.getItem(KEY)||'all'; }catch(e){}
  apply(m==='simple'?'simple':'all');
  $('#uiModeSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) apply(b.dataset.ui); });
})();
addEventListener('keydown',e=>{ if(e.key==='Escape' && maximizedView()){ e.preventDefault(); setMax(false); } });
addEventListener('orientationchange',()=>setTimeout(render,200));
// The projection the 3D view draws with. The 2D fallback painter is orthographic only.
const cameraProjection=()=>view.projection==='perspective'&&GL?'perspective':'ortho';
const cameraFov=()=>Math.max(5,Math.min(120,+view.fov||30));
function syncProjectionControls(){
  $$('[data-projection]').forEach(select=>{ select.disabled=!GL; select.value=cameraProjection(); });
  $$('[data-fov]').forEach(input=>{ input.value=cameraFov(); input.parentElement.classList.toggle('hidden',cameraProjection()!=='perspective'); });
}
$$('[data-projection]').forEach(select=>select.addEventListener('change',()=>{ view.projection=select.value; syncProjectionControls(); render(); }));
$$('[data-fov]').forEach(input=>input.addEventListener('input',()=>{ view.fov=+input.value; render(); }));
function syncStereoControls(){
  document.body.classList.toggle('stereo-on',stereoActive());
  $$('[data-stereo-mode]').forEach(select=>{
    select.disabled=!GL;
    select.value=view.stereo;
  });
  $$('[data-stereo-depth]').forEach(input=>{
    input.value=view.stereoDeg;
    input.parentElement.classList.toggle('hidden',!stereoActive());
  });
}
$$('[data-stereo-mode]').forEach(select=>select.addEventListener('change',()=>{
  view.stereo=select.value;
  syncStereoControls();
  if(stereoActive()) toast(view.stereo==='cross'?'Cross your eyes until the side-by-side views merge':'Look through the screen until the side-by-side views merge');
  render();
}));
$$('[data-stereo-depth]').forEach(input=>input.addEventListener('input',()=>{
  view.stereoDeg=+input.value;
  syncStereoControls();
  render();
}));
$('#hwChk').addEventListener('change',e=>{ view.hw=e.target.checked; buildGL(); render(); });
$('#spin').addEventListener('change',e=>{ view.spin=e.target.checked; });
function defaultCutEdgeHex(){
  return '#'+MATS[view.mat].side.map(value=>value.toString(16).padStart(2,'0')).join('');
}
function syncCutEdgeControls(){
  const custom=cutEdgeColors[view.mat], color=custom||defaultCutEdgeHex();
  $$('[data-edge-controls]').forEach(el=>el.classList.toggle('hidden',!MATS[view.mat].wood));
  $$('[data-edge-color]').forEach(input=>{ if(input.value!==color) input.value=color; });
  $$('[data-edge-reset]').forEach(button=>{ button.disabled=!custom; });
}
function saveCutEdgeColors(){
  if(window.BOX?.noSave) return;
  try{ localStorage.setItem(EDGE_COLOR_KEY,JSON.stringify(cutEdgeColors)); }catch(e){}
}
function setCutEdgeColor(color){
  if(color===defaultCutEdgeHex()) delete cutEdgeColors[view.mat];
  else cutEdgeColors[view.mat]=color;
  syncCutEdgeControls();
  render();
}
function setPreviewMaterial(material){
  view.mat=material;
  $('#matSel').value=material;
  syncCutEdgeControls();
}
$('#matSel').addEventListener('change',e=>{ setPreviewMaterial(e.target.value); render(); });
$$('[data-edge-color]').forEach(input=>{
  input.addEventListener('input',()=>setCutEdgeColor(input.value));
  input.addEventListener('change',()=>{
    if(input.value!==(cutEdgeColors[view.mat]||defaultCutEdgeHex())) setCutEdgeColor(input.value);
    saveCutEdgeColors();
  });
});
$$('[data-edge-reset]').forEach(button=>button.addEventListener('click',()=>{
  setCutEdgeColor(defaultCutEdgeHex());
  saveCutEdgeColors();
}));
syncCutEdgeControls();
$('#resetView').addEventListener('click',()=>{ view.yaw=-0.6; view.pitch=0.5; view.zoom=1; render(); });
$('#dlBtn').addEventListener('click',e=>{ e.stopPropagation(); $('#dlPop').classList.toggle('hidden'); });
document.addEventListener('click',()=>$('#dlPop').classList.add('hidden'));
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2200); }

let LAST=null;
const baseName=()=>{ const ty=TYPES.find(x=>x.id===S.type).name.toLowerCase().replace(/[^a-z0-9]+/g,'-'); return 'boxsmith-'+ty+'-'+Math.round(S.W)+'x'+Math.round(S.D)+'x'+Math.round(S.H); };
$('#dlPop').addEventListener('click',async e=>{ const b=e.target.closest('button'); if(!b||!LAST) return; const k=b.dataset.dl; const sh=LAST.sheets, nm=baseName();
  if(k==='svg'){ if(sh.length===1) await saveFile(nm+'.svg', sheetSVG(sh[0])); else await saveFile(nm+'-svg.zip', makeZip(sh.map((s,i)=>({name:nm+'-sheet'+(i+1)+'.svg',data:sheetSVG(s)})))); }
  if(k==='dxf'){ await saveFile(nm+'-dxf.zip', makeZip(sh.map((s,i)=>({name:nm+'-sheet'+(i+1)+'.dxf',data:sheetDXF(s)})))); }
  if(k==='json'){ await saveFile(nm+'.json', JSON.stringify(S,null,2)); }
});
$$('.openSettings,#layoutFile').forEach(input=>input.addEventListener('change',async()=>{
  const file=input.files[0];
  if(!file) return;
  let openingLayout=input.id==='layoutFile';
  try{
    const data=JSON.parse(await file.text());
    openingLayout=openingLayout||data?.format===Boxsmith.assemblies.format;
    if(openingLayout){
      if(data?.format!==Boxsmith.assemblies.format) throw new Error('Unexpected file format');
      openBoxLayout(data);
    } else {
      S=Object.assign({},DEFAULTS,data);
      update(true);
      toast('Settings loaded');
    }
  }catch(error){
    toast(openingLayout?'That file is not a valid Boxsmith layout':'That file is not a Boxsmith settings file');
  } finally {
    input.value='';
  }
}));
$('#copySvg').addEventListener('click',async()=>{ if(!LAST) return; const txt=LAST.sheets.length===1?sheetSVG(LAST.sheets[0]):LAST.sheets.map(sheetSVG).join('\n\n');
  try{ await navigator.clipboard.writeText(txt); toast(LAST.sheets.length>1?'Copied '+LAST.sheets.length+' sheets of SVG':'SVG copied — paste into LightBurn, Inkscape or a .svg file'); }catch(err){ toast('Clipboard blocked by the browser'); } });

/* ================= LIBRARY: materials + recipes ================= */
const MAT_KEY='boxsmith-materials', REC_KEY='boxsmith-recipes';
const MAT_SEED=[
  {name:'3 mm birch ply',t:3,kerf:0.15,price:6,look:'birch'},
  {name:'1/8" walnut ply',t:3.175,kerf:0.16,price:12,look:'walnut'},
  {name:'1/4" MDF',t:6.35,kerf:0.2,price:8,look:'mdf'},
  {name:'1/8" clear acrylic',t:3.175,kerf:0.12,price:14,look:'clear'},
  {name:'1/8" black acrylic',t:3.175,kerf:0.12,price:14,look:'black'}];
function lsGet(k,d){ try{ const v=JSON.parse(localStorage.getItem(k)||'null'); return v==null?d:v; }catch(e){ return d; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ toast('This browser won\'t let the page save — try the Settings download instead'); return false; } }
function renderLibrary(){
  const mats=lsGet(MAT_KEY,MAT_SEED);
  $('#matLib').innerHTML='<option value="">Choose a saved material…</option>'+mats.map((m,i)=>'<option value="'+i+'"'+(m.name===S.matName?' selected':'')+'>'+esc(m.name)+' · '+fmt(m.t)+' · kerf '+(+m.kerf).toFixed(2)+'</option>').join('');
  const recs=lsGet(REC_KEY,{});
  $('#recSel').innerHTML='<option value="">'+(Object.keys(recs).length?'Choose a recipe…':'No saved recipes yet')+'</option>'+Object.keys(recs).sort().map(n=>'<option>'+esc(n)+'</option>').join('');
}
$('#matLib').addEventListener('change',e=>{ const mats=lsGet(MAT_KEY,MAT_SEED), m=mats[+e.target.value]; if(!m) return;
  S.t=+m.t; S.kerf=+m.kerf; if(m.price!=null) S.sheetPrice=+m.price; S.matName=m.name; if(m.look&&MATS[m.look]) setPreviewMaterial(m.look); update(); toast('Using '+m.name); });
$('#matSave').addEventListener('click',()=>{ const n=$('#matName').value.trim(); if(!n){ toast('Give the material a name first'); return; }
  const mats=lsGet(MAT_KEY,MAT_SEED).filter(m=>m.name!==n); mats.push({name:n,t:S.t,kerf:S.kerf,price:S.sheetPrice,look:view.mat}); if(lsSet(MAT_KEY,mats)){ S.matName=n; $('#matName').value=''; renderLibrary(); update(); toast('Saved material “'+n+'”'); } });
$('#matDel').addEventListener('click',()=>{ const i=$('#matLib').value; if(i===''){ toast('Pick a material to delete'); return; } const mats=lsGet(MAT_KEY,MAT_SEED); if(!mats[+i]) return; confirmTwice($('#matDel'),'Click again to delete',()=>{ const mats2=lsGet(MAT_KEY,MAT_SEED), j=$('#matLib').value; const m=mats2.splice(+j,1)[0]; if(lsSet(MAT_KEY,mats2)){ if(m&&S.matName===m.name) S.matName=''; renderLibrary(); toast('Deleted '+(m?m.name:'material')); } }); });
$('#recSave').addEventListener('click',()=>{ const n=$('#recName').value.trim(); if(!n){ toast('Name the recipe first'); return; } const recs=lsGet(REC_KEY,{}); recs[n]=JSON.parse(JSON.stringify(S)); if(lsSet(REC_KEY,recs)){ $('#recName').value=''; renderLibrary(); $('#recSel').value=n; toast('Saved recipe “'+n+'”'); } });
$('#recLoad').addEventListener('click',()=>{ const n=$('#recSel').value, recs=lsGet(REC_KEY,{}); if(!recs[n]){ toast('Pick a recipe to load'); return; } S=Object.assign({},DEFAULTS,recs[n]); update(true); toast('Loaded “'+n+'”'); });
$('#recDel').addEventListener('click',()=>{ const n=$('#recSel').value, recs=lsGet(REC_KEY,{}); if(!recs[n]){ toast('Pick a recipe to delete'); return; } confirmTwice($('#recDel'),'Click again to delete',()=>{ const recs2=lsGet(REC_KEY,{}); delete recs2[$('#recSel').value]; if(lsSet(REC_KEY,recs2)){ renderLibrary(); toast('Deleted “'+n+'”'); } }); });

/* ================= ARTWORK LIST ================= */
$('#artFile').addEventListener('change',async e=>{ const f=e.target.files[0]; e.target.value=''; if(!f) return;
  const isSvg=/svg/i.test(f.type)||/\.svg$/i.test(f.name);
  const data = isSvg ? await f.text() : await new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(f); });
  const names=(LAST?LAST.res.parts:[]).filter(p=>!p.noCut).map(p=>p.name);
  const panel=names.find(n=>/lid|top/i.test(n))||names.find(n=>/front/i.test(n))||names[0]||'';
  const a={id:Date.now(), name:f.name, type:isSvg?'svg':'png', data, panel, mode:'engrave', size:Math.min(60,(S.W||100)*0.5), dx:0, dy:0, rot:0, ar:1};
  if(!isSvg){ const im=new Image(); im.onload=()=>{ a.ar=im.naturalHeight/im.naturalWidth; update(); }; im.src=data; }
  else { const g=svgLoops(data); a.ar=g.h||1; if(g.error){ toast('That SVG could not be read'); return; } }
  S.art=[...(S.art||[]), a]; artDirty=true; update(); toast('Added '+f.name+' to '+panel);
});
let artDirty=true, artPanelsKey='';
function renderArt(){
  const names=(LAST?LAST.res.parts:[]).filter(p=>!p.noCut).map(p=>p.name), key=names.join('|');
  if(!artDirty && key===artPanelsKey) return;
  if(document.activeElement && document.activeElement.closest && document.activeElement.closest('#artList')) return;
  artDirty=false; artPanelsKey=key;
  const L=S.unit==='in'?25.4:1;
  $('#artList').innerHTML=(S.art||[]).map((a,i)=>'<div class="art" data-i="'+i+'"><div class="hd"><span>'+esc(a.name)+'</span><button class="btn sm" data-del="'+i+'">Remove</button></div><div class="grid3">'
    +'<div class="f full"><label>Panel</label><select data-a="panel">'+names.map(n=>'<option'+(n===a.panel?' selected':'')+'>'+esc(n)+'</option>').join('')+(names.includes(a.panel)?'':'<option selected>'+esc(a.panel)+' (missing)</option>')+'</select></div>'
    +'<div class="f"><label>As</label><select data-a="mode"><option value="engrave"'+(a.mode==='engrave'?' selected':'')+'>Engrave</option><option value="score"'+(a.mode==='score'?' selected':'')+'>Score lines</option><option value="cut"'+(a.mode==='cut'?' selected':'')+'>Cut through</option></select></div>'
    +'<div class="f"><label>Width</label><input type="number" data-a="size" step="1" value="'+(+(a.size/L).toFixed(3))+'"></div>'
    +'<div class="f"><label>Rotate °</label><input type="number" data-a="rot" step="15" value="'+(a.rot||0)+'"></div>'
    +'<div class="f"><label>Move →</label><input type="number" data-a="dx" step="1" value="'+(+((a.dx||0)/L).toFixed(3))+'"></div>'
    +'<div class="f"><label>Move ↓</label><input type="number" data-a="dy" step="1" value="'+(+((a.dy||0)/L).toFixed(3))+'"></div>'
    +'</div></div>').join('');
}
$('#artList').addEventListener('input',e=>{ const el=e.target, box=el.closest('.art'); if(!box||!el.dataset.a) return; const a=S.art[+box.dataset.i]; const k=el.dataset.a;
  if(['size','dx','dy'].includes(k)){ const v=parseFloat(el.value); if(!isFinite(v)) return; a[k]=v*(S.unit==='in'?25.4:1); } else if(k==='rot'){ a.rot=parseFloat(el.value)||0; } else a[k]=el.value.replace(/ \(missing\)$/,''); update(); });
$('#artList').addEventListener('click',e=>{ const b=e.target.closest('[data-del]'); if(!b) return; S.art.splice(+b.dataset.del,1); artDirty=true; update(); });

/* ================= COST ================= */
function costs(fparts,lay,cutLen,area){
  const q=qtyOf(), SA=S.sheetW*S.sheetH;
  const engArea=fparts.reduce((a,f)=>a+f.marks.reduce((b,m)=>{ if(m.img) return b+m.w*m.h*0.5; if(m.kind==='fill'){ const bb=bbox(m.loops.flat()); return b+(isFinite(bb.w)?bb.w*bb.h*0.6:0);} return b; },0),0);
  const cutSec=(cutLen*q)/Math.max(1,S.speed)*1.15, engSec=engArea*q/(0.1*250), sec=cutSec+engSec;
  const matShare=area*q/SA*S.sheetPrice, sheetsCost=lay.sheets.length*S.sheetPrice, machine=sec/3600*S.rate;
  const perBox=(matShare+machine)/q, price=perBox*(1+S.markup/100);
  return {sec,matShare,sheetsCost,machine,perBox,price,q};
}
const mmss=s=>{ s=Math.round(s); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return (h?h+'h ':'')+m+'m '+String(x).padStart(2,'0')+'s'; };
const $$m=v=>'$'+v.toFixed(2);

/* ================= ASSEMBLY CARD ================= */
function snapshot(){ try{ render(); if(GL) return GL.r.domElement.toDataURL('image/png'); return cv.toDataURL('image/png'); }catch(e){ return ''; } }
function cardHTML(noImage){
  if(!LAST) return ''; const {res,fparts}=LAST, ty=TYPES.find(x=>x.id===S.type), I=res.info, img=noImage?'':snapshot();
  const title=S.text||ty.name, cnt=new Map(); fparts.forEach(f=>{ const k=f.name.replace(/ \d+$/,''); cnt.set(f.name,(cnt.get(f.name)||0)+1); });
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+esc(title)+' — assembly</title><style>'
   +'body{font-family:"Times New Roman",Georgia,serif;color:#111;max-width:7.5in;margin:0.5in auto;line-height:1.45}h1{font-size:26pt;margin:0}h2{font-size:14pt;margin:18px 0 6px}'
   +'.sub{color:#555;margin:2px 0 14px}img{width:100%;max-height:4in;object-fit:contain;border:1px solid #ddd;border-radius:6px;background:#f7f4ef}'
   +'table{border-collapse:collapse;width:100%;font-size:11pt}td,th{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left}ol{padding-left:22px}li{margin:4px 0}.foot{margin-top:24px;font-size:9pt;color:#777}@media print{body{margin:0.3in auto}}</style></head><body>'
   +'<h1>'+esc(title)+'</h1><p class="sub">'+esc(ty.name)+' · '+fmt(I.W)+' × '+fmt(I.D)+' × '+fmt(I.H)+' · '+fmt(S.t)+' material</p>'
   +(img?'<img src="'+img+'" alt="Finished box">':'')
   +'<h2>In this kit</h2><table><tr><th>Part</th><th>Size</th></tr>'+fparts.map(f=>'<tr><td>'+esc(f.name)+'</td><td>'+fmt(f.bb.w)+' × '+fmt(f.bb.h)+'</td></tr>').join('')+'</table>'
   +'<h2>Put it together</h2><ol><li>Pop each part out of the sheet. If there are small tabs holding it, snap or sand them off.</li>'+res.notes.map(n=>'<li>'+esc(n)+'</li>').join('')+'<li>Dry-fit everything first. Then glue (wood glue for wood, acrylic cement for acrylic) and hold the corners with tape while it sets.</li></ol>'
   +'<p class="foot">Made with Boxsmith.</p></body></html>';
}

function geometryContext(){
  return {t:Math.max(0.5,S.t), fw:Math.max(1,S.fw), ts:S.tslot!=='off'?SCREWS[S.tslot]:null, mat:'main'};
}
function designWarnings(res){
  if(S.bit>0 && S.kerf>0.05) res.warns.push('CNC mode: dogbones are on. Set kerf to 0 and let your CAM software handle tool compensation.');
  if(S.bit>0 && S.bit>=G.t) res.warns.push('The router bit is as wide as the material — finger slots will be cut oversize. Use a smaller bit.');
  if(G.ts && G.t<G.ts.d+1.2) res.warns.push(S.tslot+' screw holes ('+G.ts.d+' mm) are too big for '+fmt(G.t)+' material — they\'ll break through the edge. Use thicker stock (about '+fmt(G.ts.d+1.5)+'+) or a smaller screw.');
  if(G.ts && G.fw<G.ts.nw+3) res.warns.push('Finger width is too narrow for '+S.tslot+' nuts — raise it to '+fmt(G.ts.nw+4)+' or more.');
  if(S.textMode==='cut' && S.text && !/stencil/i.test(S.font)) res.warns.push('Cut-through text: the middles of letters like O, A and B will fall out. The Stencil font avoids that.');
}
function measureParts(fparts){
  const ar=fparts.reduce((a,f)=>{ let A=Math.abs(area(f.outline)); for(const h of f.holes) A-=Math.abs(area(h)); return a+A; },0);
  const cutLen=fparts.reduce((a,f)=>a+perim(f.outline)+f.holes.reduce((b,h)=>b+perim(h),0)+f.circles.reduce((b,c)=>b+2*PI*c.r,0)+f.slits.reduce((b,s)=>b+perim(s,false),0),0);
  return {ar,cutLen};
}
// confirm() is blocked in the sandboxed artifact frame, so risky buttons ask by changing their label:
// the first click arms the button for a few seconds and the second click does the work.
function confirmTwice(btn,armedText,action){
  if(btn.dataset.armed==='1'){ clearTimeout(btn._armT); btn.dataset.armed=''; btn.textContent=btn.dataset.label; action(); return; }
  btn.dataset.label=btn.textContent; btn.dataset.armed='1'; btn.textContent=armedText;
  btn._armT=setTimeout(()=>{ btn.dataset.armed=''; btn.textContent=btn.dataset.label; },4000);
}
function update(resetView){
  save(); syncInputs(); syncBoxLayout();
  G=geometryContext();
  let res;
  try{ res=generate(); decorate(res.parts,res.warns); }
  catch(err){ console.error(err); $('#warns').innerHTML='<div class="warn">These settings produce impossible geometry — try larger dimensions. ('+esc(err.message)+')</div>'; return; }
  G.t=Math.max(0.5,S.t);
  designWarnings(res);
  const cutParts=res.parts.filter(p=>!p.noCut);
  const fparts=cutParts.map(finalize);
  const lay=layout(fparts);
  LAST={sheets:lay.sheets, res, fparts};
  if(selPi>=res.parts.length) selPi=-1;
  buildScene(res.parts); if(resetView&&!layingOut()){ view.zoom=1; } render(); showSel();
  const I=res.info, inn=I.inner;
  $('#dims').innerHTML='<b>Outside</b><br>'+fmt(I.W)+' × '+fmt(I.D)+' × '+fmt(I.H)+(inn?'<br><b>Inside'+(inn.label?' · '+inn.label:'')+'</b><br>'+fmt(inn.W)+' × '+fmt(inn.D)+' × '+fmt(inn.H):'');
  const {ar,cutLen}=measureParts(fparts);
  $('#sheets').innerHTML=lay.sheets.map((sh,i)=>'<div class="sheet"><div class="cap"><span><b>Sheet '+(i+1)+' of '+lay.sheets.length+'</b> · '+esc(sheetLabel(sh))+' · '+sh.items.length+' parts · '+fmt(S.sheetW)+' × '+fmt(S.sheetH)+'</span><button class="btn" data-sheet="'+i+'" style="padding:4px 10px;font-size:12px">Download this sheet</button></div>'+sheetSVG(sh,{preview:true})+'</div>').join('')
    +'<p style="text-align:center;color:var(--muted);font-size:12.5px">Tap a part to find it in the 3D view.</p>';
  $$('#sheets [data-sheet]').forEach(b=>b.addEventListener('click',()=>{ const i=+b.dataset.sheet; saveFile(baseName()+'-sheet'+(i+1)+'-'+sheetLabel(LAST.sheets[i]).replace(/[^a-z0-9]+/gi,'-')+'.svg', sheetSVG(LAST.sheets[i])); }));
  markSheetSel();
  const rows=fparts.map(f=>'<tr><td>'+esc(f.name)+'</td><td class="m">'+fmt(f.bb.w)+' × '+fmt(f.bb.h)+'</td></tr>').join('');
  const ty=TYPES.find(x=>x.id===S.type);
  $('#guide').innerHTML='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><h3>'+ty.name+' — assembly</h3><p style="color:var(--muted);margin:0 0 8px">'+fparts.length+' parts'+(qtyOf()>1?' per box · '+qtyOf()+' boxes':'')+' · material '+fmt(S.t)+' · kerf '+fmt(S.kerf)+'</p></div><button class="btn primary" id="cardBtn">Download assembly card</button></div><ol>'
    +(S.type!=='kerftest'?'<li>Cut one corner first if this is a new material — fingers should press in by hand and hold. Adjust kerf ±0.02 mm if not.</li>':'')
    +(G.ts?'<li>Screw joints: drop an '+S.tslot+' nut into each T-slot, then drive an '+S.tslot+' × '+fmt(S.screwLen)+' screw through the matching hole.</li>':'')
    +res.notes.map(n=>'<li>'+esc(n)+'</li>').join('')
    +(S.cols>1||S.rows>1?(['open','liftoff','split','sliding','hinged','drawer','pencil'].includes(S.type)?'<li>Dividers slot together egg-crate style: the ↔ pieces drop onto the ↕ pieces. They sit loose so you can lift them out.</li>':''):'')
    +(S.holdTabs>0?'<li>Kit mode: parts are held in the sheet by small tabs. Snap them free and sand the nubs.</li>':'')
    +'<li>Glue: wood glue for ply/MDF, Weld-On or acrylic cement for acrylic. Tape corners while it sets.</li></ol><table><tr><th>Part</th><th>Cut size</th></tr>'+rows+'</table>';
  $('#cardBtn').addEventListener('click',()=>saveFile(baseName()+'-assembly-card.html', cardHTML()));
  const warns=[...res.warns,...lay.warns];
  $('#warns').innerHTML=warns.map(w=>'<div class="warn">'+esc(w)+'</div>').join('');
  const util=lay.sheets.length? ar*qtyOf()/(lay.sheets.length*S.sheetW*S.sheetH)*100:0;
  const C=costs(fparts,lay,cutLen,ar);
  $('#stats').innerHTML='<div class="stat"><span>Parts</span><b>'+fparts.length*qtyOf()+'</b></div><div class="stat"><span>Sheets</span><b>'+lay.sheets.length+'</b></div><div class="stat"><span>Bed use</span><b>'+util.toFixed(0)+'%</b></div><div class="stat"><span>Cut length</span><b>'+(S.unit==='in'?(cutLen*C.q/25.4/12).toFixed(1)+' ft':(cutLen*C.q/1000).toFixed(2)+' m')+'</b></div><div class="stat"><span>Laser time</span><b>'+mmss(C.sec)+'</b></div><div class="stat"><span>Cost/box</span><b>'+$$m(C.perBox)+'</b></div><div class="stat"><span>Price</span><b>'+$$m(C.price)+'</b></div>';
  $('#costBox').innerHTML='Material share <b>'+$$m(C.matShare)+'</b> ('+lay.sheets.length+' sheet'+(lay.sheets.length>1?'s':'')+' = <b>'+$$m(C.sheetsCost)+'</b> if bought whole)<br>Laser time <b>'+mmss(C.sec)+'</b> = <b>'+$$m(C.machine)+'</b><br>Cost per box <b>'+$$m(C.perBox)+'</b> · suggested price <b>'+$$m(C.price)+'</b>'+(C.q>1?' · batch of '+C.q:'');
  renderArt(); renderLibrary();
}
$('#sheets').addEventListener('click',e=>{ const pp=e.target.closest('.pp'); if(!pp) return; selectPart(+pp.dataset.pi); const f=LAST.fparts.find(x=>x.idx===selPi); if(f) toast(f.name+' — '+fmt(f.bb.w)+' × '+fmt(f.bb.h)); });
window.update=update;

/* ---------- lamp mode controls ---------- */
(function(){
  const btn=$('#lampBtn'), ctl=$('#lampCtl'); if(!btn) return;
  let saved=null;
  const sync=()=>{ btn.classList.toggle('on',LAMP.on); ctl.classList.toggle('hidden',!LAMP.on); $('#lampPct').textContent=Math.round(LAMP.gain*100)+'%'; $('#lampColor').value=LAMP.color; };
  btn.addEventListener('click',()=>{
    if(!GL){ toast('Lamp mode needs WebGL, which is not available here.'); return; }
    LAMP.on=!LAMP.on;
    if(LAMP.on){ saved={yaw:view.yaw,pitch:view.pitch,animT:view.animT,play:view.play}; view.yaw=LAMP.yaw; view.pitch=LAMP.pitch; view.zoom=Math.min(view.zoom,1); if(view.stereo!=='off'){ /* stereo still works */ } }
    else if(saved){ view.yaw=saved.yaw; view.pitch=saved.pitch; }
    sync(); render();
  });
  $('#lampGain').addEventListener('input',e=>{ LAMP.gain=e.target.value/100; sync(); render(); });
  const setCol=c=>{ LAMP.color=c; try{ localStorage.setItem('boxsmith-lampcolor',c); }catch(e){} sync(); render(); };
  $('#lampColor').addEventListener('input',e=>setCol(e.target.value));
  ctl.querySelectorAll('.lc').forEach(b=>b.addEventListener('click',()=>setCol(b.dataset.c)));
  $('#lampSize').addEventListener('input',e=>{ LAMP.size=e.target.value/100; render(); });
  ['X','Y','Z'].forEach((k,i)=>$('#lamp'+k).addEventListener('input',e=>{ LAMP.off[i]=e.target.value/100; render(); }));
  $('#lampReset').addEventListener('click',()=>{ LAMP.off=[0,0,0]; LAMP.size=1; ['X','Y','Z'].forEach(k=>{ $('#lamp'+k).value=0; }); $('#lampSize').value=100; render(); });
  $('#resetView').addEventListener('click',()=>{ if(LAMP.on){ view.yaw=LAMP.yaw; view.pitch=LAMP.pitch; render(); } });
  sync();
})();


/* ---------- overlay controls fade out after 10 s; a deliberate tap brings them back ---------- */
(function(){
  const sels=['#v3dctl','#layoutCtl','#lampCtl','#dims','#selInfo'], timers=new Map();
  const reveal=el=>{ el.classList.remove('faded'); clearTimeout(timers.get(el)); timers.set(el,setTimeout(()=>el.classList.add('faded'),10000)); };
  sels.forEach(s=>{ const el=$(s); if(!el) return; el.classList.add('ov');
    el.addEventListener('click',e=>{ if(el.classList.contains('faded')){ e.preventDefault(); e.stopPropagation(); reveal(el); } },true);
    el.addEventListener('focusin',()=>reveal(el));
    ['pointerdown','input','change','wheel'].forEach(ev=>el.addEventListener(ev,()=>{ if(!el.classList.contains('faded')) reveal(el); },true));
    reveal(el); });
  window.revealOverlays=()=>sels.forEach(s=>{ const el=$(s); if(el&&!el.classList.contains('hidden')) reveal(el); });
  // panels that appear because of another control (lamp panel, selection info) start fresh
  new MutationObserver(ms=>ms.forEach(m=>{ const t=m.target; if(t.classList&&t.classList.contains('ov')&&/hidden/.test(m.oldValue||'')&&!t.classList.contains('hidden')) reveal(t); }))
    .observe($('.view'),{attributes:true,subtree:true,attributeFilter:['class'],attributeOldValue:true});
})();

window.BOX={LAMP, get S(){ return S; }, set(o){ Object.assign(S,o); }, reset(){ S=Object.assign({},DEFAULTS); }, update, render, view, playDemo,
  hwPoints(){ if(!GL) return []; const out=[]; for(const o of GL.objs){ if(!o.hw) continue; const kids=o.hw.children; for(let i=2;i<kids.length;i+=3){ const g=kids[i].geometry; g.computeBoundingSphere(); const c=g.boundingSphere.center.clone().applyMatrix4(o.base); const h=kids[i-1].geometry; h.computeBoundingSphere(); const hc=h.boundingSphere.center.clone().applyMatrix4(o.base); out.push({nut:[c.x,c.y,c.z],head:[hc.x,hc.y,hc.z],part:o.s.part.name}); } } return out; },
  ctr(){ return scene?scene.ctr.slice():[0,0,0]; },
  tab(v){ const b=document.querySelector('#tabs [data-v="'+v+'"]'); if(b) b.click(); }, noSave:false };
Boxsmith.browser={
  showBox(settings){
    const design=Boxsmith.assemblies.place(settings).settings;
    makeLayoutBox(design);
    S=Object.assign({},DEFAULTS,design);
    update(true);
    $('#tabs [data-v="3d"]').click();
  },
  getAssembly:currentBoxLayout,
  openAssembly:openBoxLayout,
  saveAssembly:downloadBoxLayout
};
initGL();
syncStereoControls(); syncProjectionControls();
initBoxLayout();
update(true);
if(document.fonts && document.fonts.ready){ const fams=['Bebas Neue','Caveat','Pacifico','Playfair Display','Rye','Stardos Stencil']; Promise.all(fams.map(f=>document.fonts.load('40px "'+f+'"').catch(()=>{}))).then(()=>{ _textCache.clear(); update(); }); }
