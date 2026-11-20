'use strict';

/* Picture-to-mosaic algorithm for Boxsmith. No DOM, no network: pure functions that
   turn pixels into a grid of palette colours and then into a box layout.
   Works in the browser (window.BoxsmithMosaic) and in Node (require). */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.BoxsmithMosaic=api;
})(globalThis,function(){
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

  // Small deterministic random generator, so the same picture always gives the same palette.
  function mulberry32(seed){
    let a=seed>>>0;
    return ()=>{
      a=(a+0x6D2B79F5)>>>0;
      let t=a;
      t=Math.imul(t^(t>>>15),t|1);
      t^=t+Math.imul(t^(t>>>7),t|61);
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }

  /* ---------- colour spaces: picking colours in CIELAB matches how the eye sees difference ---------- */
  const toLinear=c=>{ c/=255; return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4); };
  const fromLinear=c=>{ c=clamp(c,0,1); return Math.round(255*(c<=0.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-0.055)); };
  const EPS=216/24389, KAPPA=24389/27;

  function rgbToLab(r,g,b){
    const R=toLinear(r), G=toLinear(g), B=toLinear(b);
    const x=(0.4124564*R+0.3575761*G+0.1804375*B)/0.95047;
    const y=0.2126729*R+0.7151522*G+0.0721750*B;
    const z=(0.0193339*R+0.1191920*G+0.9503041*B)/1.08883;
    const f=t=>t>EPS?Math.cbrt(t):(KAPPA*t+16)/116;
    const fx=f(x), fy=f(y), fz=f(z);
    return [116*fy-16,500*(fx-fy),200*(fy-fz)];
  }

  function labToRgb(L,a,b){
    const fy=(L+16)/116, fx=fy+a/500, fz=fy-b/200;
    const inv=t=>{ const t3=t*t*t; return t3>EPS?t3:(116*t-16)/KAPPA; };
    const x=inv(fx)*0.95047, y=inv(fy), z=inv(fz)*1.08883;
    return [
      fromLinear(3.2404542*x-1.5371385*y-0.4985314*z),
      fromLinear(-0.9692660*x+1.8760108*y+0.0415560*z),
      fromLinear(0.0556434*x-0.2040259*y+1.0572252*z)
    ];
  }

  const toHex=(r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  const dist2=(p,q)=>{ const a=p[0]-q[0], b=p[1]-q[1], c=p[2]-q[2]; return a*a+b*b+c*c; };

  /* ---------- picture -> grid: average every block of source pixels (alpha-weighted) ---------- */
  function resample(rgba,sw,sh,tw,th){
    const n=tw*th, out={r:new Float64Array(n),g:new Float64Array(n),b:new Float64Array(n),a:new Float64Array(n)};
    for(let ty=0;ty<th;ty++){
      const y0=ty*sh/th, y1=(ty+1)*sh/th;
      for(let tx=0;tx<tw;tx++){
        const x0=tx*sw/tw, x1=(tx+1)*sw/tw;
        let sr=0, sg=0, sb=0, sa=0, area=0;
        for(let y=Math.floor(y0);y<Math.ceil(y1)&&y<sh;y++){
          const wy=Math.min(y+1,y1)-Math.max(y,y0);
          for(let x=Math.floor(x0);x<Math.ceil(x1)&&x<sw;x++){
            const w=(Math.min(x+1,x1)-Math.max(x,x0))*wy, i=(y*sw+x)*4, al=rgba[i+3]/255;
            sr+=rgba[i]*al*w; sg+=rgba[i+1]*al*w; sb+=rgba[i+2]*al*w; sa+=al*w; area+=w;
          }
        }
        const k=ty*tw+tx;
        out.a[k]=area>0?sa/area:0;
        if(sa>0){ out.r[k]=sr/sa; out.g[k]=sg/sa; out.b[k]=sb/sa; }
      }
    }
    return out;
  }

  // How many rows keep the picture's proportions when each tile is pitchX wide and pitchY deep.
  function gridSize(width,height,cols,pitchX=1,pitchY=1){
    cols=Math.max(1,Math.round(cols));
    return {cols,rows:Math.max(1,Math.round(cols*pitchX*height/(width*pitchY)))};
  }

  /* ---------- palette picking: k-means++ in Lab ---------- */
  function kmeans(points,k,seed=12345){
    const n=points.length, rnd=mulberry32(seed);
    const cent=[points[Math.floor(rnd()*n)].slice()];
    const d2=new Float64Array(n).fill(Infinity);
    while(cent.length<k){
      const last=cent[cent.length-1];
      let sum=0;
      for(let i=0;i<n;i++){ const d=dist2(points[i],last); if(d<d2[i]) d2[i]=d; sum+=d2[i]; }
      if(sum<=0) break;                                 // fewer distinct colours than k
      let r=rnd()*sum, pick=n-1;
      for(let i=0;i<n;i++){ r-=d2[i]; if(r<=0){ pick=i; break; } }
      cent.push(points[pick].slice());
    }
    const assign=new Int32Array(n), dist=new Float64Array(n);
    for(let iter=0;iter<30;iter++){
      let moved=false;
      for(let i=0;i<n;i++){
        let best=0, bd=Infinity;
        for(let c=0;c<cent.length;c++){ const d=dist2(points[i],cent[c]); if(d<bd){ bd=d; best=c; } }
        if(assign[i]!==best||iter===0){ if(assign[i]!==best) moved=true; assign[i]=best; }
        dist[i]=bd;
      }
      const sums=cent.map(()=>[0,0,0,0]);
      for(let i=0;i<n;i++){ const s=sums[assign[i]], p=points[i]; s[0]+=p[0]; s[1]+=p[1]; s[2]+=p[2]; s[3]++; }
      for(let c=0;c<cent.length;c++){
        if(sums[c][3]===0){                             // empty cluster: restart it at the worst-fitting point
          let far=0; for(let i=1;i<n;i++) if(dist[i]>dist[far]) far=i;
          cent[c]=points[far].slice(); dist[far]=0; moved=true;
        } else cent[c]=[sums[c][0]/sums[c][3],sums[c][1]/sums[c][3],sums[c][2]/sums[c][3]];
      }
      if(!moved&&iter>0) break;
    }
    return cent;
  }

  /* ---------- the main step: pixels in, grid of palette indices out ---------- */
  function buildMosaic(opts){
    const {rgba,width,height}=opts;
    const cols=Math.max(1,Math.round(opts.cols)), rows=Math.max(1,Math.round(opts.rows));
    const k=clamp(Math.round(opts.colors||6),1,64), skipTransparent=opts.skipTransparent!==false;
    const cells=resample(rgba,width,height,cols,rows), n=cols*rows;
    const empty=new Uint8Array(n), lab=new Array(n), live=[];
    for(let i=0;i<n;i++){
      const a=cells.a[i];
      if(skipTransparent&&a<0.5){ empty[i]=1; continue; }
      const al=skipTransparent?1:a;                       // otherwise show transparent areas as white paper
      lab[i]=rgbToLab(cells.r[i]*al+255*(1-al),cells.g[i]*al+255*(1-al),cells.b[i]*al+255*(1-al));
      live.push(i);
    }
    const index=new Int16Array(n).fill(-1);
    if(!live.length) return {cols,rows,index,palette:[],count:0};

    const centroids=kmeans(live.map(i=>lab[i]),Math.min(k,live.length),opts.seed||12345);
    const nearest=p=>{ let best=0, bd=Infinity; for(let c=0;c<centroids.length;c++){ const d=dist2(p,centroids[c]); if(d<bd){ bd=d; best=c; } } return best; };

    if(opts.dither){
      // Floyd-Steinberg error diffusion, snaking left-right then right-left
      const work=lab.map(p=>p?p.slice():null);
      for(let y=0;y<rows;y++){
        const ltr=y%2===0;
        for(let s=0;s<cols;s++){
          const x=ltr?s:cols-1-s, i=y*cols+x;
          if(empty[i]) continue;
          const c=nearest(work[i]); index[i]=c;
          const err=[work[i][0]-centroids[c][0],work[i][1]-centroids[c][1],work[i][2]-centroids[c][2]];
          const spread=(dx,dy,w)=>{
            const xx=x+(ltr?dx:-dx), yy=y+dy;
            if(xx<0||xx>=cols||yy>=rows) return;
            const j=yy*cols+xx; if(empty[j]) return;
            for(let q=0;q<3;q++) work[j][q]+=err[q]*w;
          };
          spread(1,0,7/16); spread(-1,1,3/16); spread(0,1,5/16); spread(1,1,1/16);
        }
      }
    } else for(const i of live) index[i]=nearest(lab[i]);

    // Keep only colours that are used, most-used first, and renumber.
    const used=new Array(centroids.length).fill(0);
    for(const i of live) used[index[i]]++;
    const order=used.map((count,c)=>({c,count})).filter(o=>o.count>0).sort((a,b)=>b.count-a.count);
    const remap=new Int16Array(centroids.length).fill(-1);
    const palette=order.map((o,newIndex)=>{
      remap[o.c]=newIndex;
      const [L,a,b]=centroids[o.c], [r,g,bl]=labToRgb(L,a,b);
      return {hex:toHex(r,g,bl),rgb:[r,g,bl],L,count:o.count,level:0};
    });
    for(const i of live) index[i]=remap[index[i]];

    // Optional relief: lighter or darker colours stand higher, in a few even steps.
    const steps=clamp(Math.round(opts.steps||3),2,8);
    if(opts.relief==='light'||opts.relief==='dark'){
      const lo=Math.min(...palette.map(p=>p.L)), hi=Math.max(...palette.map(p=>p.L));
      for(const p of palette){
        const t=hi>lo?(p.L-lo)/(hi-lo):0;
        p.level=Math.round((opts.relief==='light'?t:1-t)*(steps-1));
      }
    }
    return {cols,rows,index,palette,count:live.length};
  }

  /* ---------- grid -> Boxsmith layout (the same format Open layout reads) ---------- */
  function orientation(faces,x,y){
    if(faces==='top') return [0,0,0];
    if(faces==='side') return [90,0,0];
    return (x+y)%2===0?[90,0,0]:[0,-90,0];               // side faces up, alternating like a checkerboard
  }

  function makeAssembly(m,o){
    const boxes=[];
    if(o.frame) boxes.push({settings:o.frame,position:[0,0,0],rotation:[0,0,0],hidden:false});
    const paints=m.palette.map(p=>Object.assign({},o.tile,{paint:o.paint||'watercolor',paintColor:p.hex,paintStrength:o.paint==='acrylic'?100:clamp(Math.round(o.strength||75),10,100)}));
    for(let y=0;y<m.rows;y++) for(let x=0;x<m.cols;x++){
      const c=m.index[y*m.cols+x];
      if(c<0) continue;
      boxes.push({
        settings:Object.assign({},paints[c]),
        position:[(x-(m.cols-1)/2)*o.pitchX,((m.rows-1)/2-y)*o.pitchY,m.palette[c].level*(o.stepHeight||0)],
        rotation:orientation(o.faces||'sides',x,y),
        hidden:false
      });
    }
    return {format:'boxsmith-layout',version:1,unit:o.unit||'mm',boxes};
  }

  return {gridSize,resample,buildMosaic,makeAssembly,orientation,rgbToLab,labToRgb,toHex};
});
