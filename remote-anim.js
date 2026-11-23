/* Boxsmith remote animation helpers: pure functions shared by the page (remote.js) and Node tests.
   - validateAnimation(args, boxCount) -> { ok, error, anim }
   - sampleAt(anim, t, startPoses) -> { boxes: { index: {position, rotation, colors, hidden, settings} }, camera }
   - splitMessage(msg, limit) / joinParts(parts) keep relay messages under its size limit
   - encodeGIF(frames, width, height, delayCs) -> Uint8Array (frames are RGBA Uint8ClampedArray)
   Rotations are [x, y, z] degrees applied in Z·Y·X order, as Arrange boxes uses them. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.BoxsmithAnim=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const MAX_KEYS=2000, MAX_DURATION=120, MAX_FPS=60;
  const D2R=Math.PI/180, R2D=180/Math.PI;
  const isNum=v=>typeof v==='number'&&Number.isFinite(v);
  const isTriple=v=>Array.isArray(v)&&v.length===3&&v.every(isNum);
  const HEX=/^#[0-9a-fA-F]{6}$/;

  /* ---------- easing ---------- */
  const EASE={
    linear:u=>u,
    easeInOut:u=>u<0.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2
  };

  /* ---------- rotations: Euler (degrees, Z·Y·X) <-> quaternion ---------- */
  function qmul(a,b){ return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]]; }
  function axisQ(axis,deg){ const h=deg*D2R/2, s=Math.sin(h), q=[0,0,0,Math.cos(h)]; q[axis]=s; return q; }
  function eulerToQuat(e){ return qmul(qmul(axisQ(2,e[2]),axisQ(1,e[1])),axisQ(0,e[0])); }   // R = Rz·Ry·Rx
  function quatToEuler(q){
    const [x,y,z,w]=q;
    const m11=1-2*(y*y+z*z), m12=2*(x*y-z*w), m21=2*(x*y+z*w), m22=1-2*(x*x+z*z), m31=2*(x*z-y*w), m32=2*(y*z+x*w), m33=1-2*(x*x+y*y);
    const ry=Math.asin(Math.max(-1,Math.min(1,-m31)));
    let rx,rz;
    if(Math.abs(m31)<0.9999999){ rx=Math.atan2(m32,m33); rz=Math.atan2(m21,m11); } else { rx=0; rz=Math.atan2(-m12,m22); }
    const r=v=>Math.round(v*R2D*1e6)/1e6+0;
    return [r(rx),r(ry),r(rz)];
  }
  function slerp(a,b,u){
    let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
    if(d<0){ b=b.map(v=>-v); d=-d; }                     // shortest path
    if(d>0.9995){ const q=a.map((v,i)=>v+(b[i]-v)*u), n=Math.hypot(...q); return q.map(v=>v/n); }
    const th=Math.acos(d), s=Math.sin(th), wa=Math.sin((1-u)*th)/s, wb=Math.sin(u*th)/s;
    return a.map((v,i)=>v*wa+b[i]*wb);
  }
  // Turns of up to 180° per axis take the shortest path (slerp). Bigger turns are kept as written
  // (each angle eased on its own), so a key of 360 still spins the box a full turn.
  function rotationBetween(a,b,u){
    if(a.every((v,i)=>Math.abs(b[i]-v)<=180)){
      if(a.every((v,i)=>v===b[i])) return a.slice();
      const e=quatToEuler(slerp(eulerToQuat(a),eulerToQuat(b),u));
      // keep the result near the straight-line angles, so 0→90 reads 45 rather than an equivalent
      return e.map((v,i)=>{ const lin=a[i]+(b[i]-a[i])*u; return v+360*Math.round((lin-v)/360); });
    }
    return a.map((v,i)=>v+(b[i]-v)*u);
  }

  /* ---------- validation ---------- */
  function validateAnimation(args,boxCount){
    const bad=error=>({ok:false,error});
    if(!args||typeof args!=='object') return bad('animate needs an object of arguments.');
    const keys=args.keyframes;
    if(!Array.isArray(keys)||!keys.length) return bad('keyframes must be a non-empty list.');
    if(keys.length>MAX_KEYS) return bad('Too many keyframes: '+keys.length+' (the limit is '+MAX_KEYS+').');
    const easing=args.easing===undefined?'easeInOut':args.easing;
    if(!EASE[easing]) return bad("easing must be 'linear' or 'easeInOut'.");
    const fps=args.fps===undefined?30:args.fps;
    if(!isNum(fps)||fps<1||fps>MAX_FPS) return bad('fps must be a number from 1 to '+MAX_FPS+'.');
    const tracks={}, out=[];
    for(let k=0;k<keys.length;k++){
      const key=keys[k], where='keyframes['+k+']';
      if(!key||typeof key!=='object') return bad(where+' must be an object.');
      if(!isNum(key.t)||key.t<0) return bad(where+'.t must be a number of seconds, 0 or more.');
      if(key.t>MAX_DURATION) return bad(where+'.t is past the '+MAX_DURATION+' s limit.');
      if(!key.boxes||typeof key.boxes!=='object') return bad(where+'.boxes must be an object keyed by box index.');
      for(const [name,pose] of Object.entries(key.boxes)){
        const i=Number(name);
        if(!Number.isInteger(i)||i<0||(boxCount!==undefined&&i>=boxCount)) return bad(where+': there is no box '+name+'.');
        if(!pose||typeof pose!=='object') return bad(where+'.boxes['+name+'] must be an object.');
        if(pose.position!==undefined&&!isTriple(pose.position)) return bad(where+'.boxes['+name+'].position must be three finite numbers.');
        if(pose.rotation!==undefined&&!isTriple(pose.rotation)) return bad(where+'.boxes['+name+'].rotation must be three finite numbers.');
        if(pose.hidden!==undefined&&typeof pose.hidden!=='boolean') return bad(where+'.boxes['+name+'].hidden must be true or false.');
        if(pose.colors!==undefined){
          if(pose.colors===null||typeof pose.colors!=='object') return bad(where+'.boxes['+name+'].colors must be an object.');
          for(const [part,hex] of Object.entries(pose.colors)) if(!HEX.test(hex)) return bad(where+'.boxes['+name+'].colors.'+part+" must be '#rrggbb'.");
        }
        if(pose.settings!==undefined&&(pose.settings===null||typeof pose.settings!=='object')) return bad(where+'.boxes['+name+'].settings must be an object.');
        (tracks[i]=tracks[i]||[]).push(Object.assign({t:key.t},pose));
      }
      out.push(key.t);
    }
    let duration=Math.max(...out);
    let camera=null;
    if(args.camera!==undefined){
      if(!Array.isArray(args.camera)) return bad('camera must be a list of camera keyframes.');
      if(args.camera.length>MAX_KEYS) return bad('Too many camera keyframes.');
      camera=[];
      for(let k=0;k<args.camera.length;k++){
        const c=args.camera[k], where='camera['+k+']';
        if(!c||!isNum(c.t)||c.t<0||c.t>MAX_DURATION) return bad(where+'.t must be seconds from 0 to '+MAX_DURATION+'.');
        for(const f of ['yaw','pitch','zoom']) if(c[f]!==undefined&&!isNum(c[f])) return bad(where+'.'+f+' must be a finite number.');
        if(c.pitch!==undefined&&Math.abs(c.pitch)>90) return bad(where+'.pitch must be between -90 and 90.');
        if(c.zoom!==undefined&&(c.zoom<0.05||c.zoom>20)) return bad(where+'.zoom must be between 0.05 and 20.');
        if(c.pan!==undefined&&!isTriple(c.pan)) return bad(where+'.pan must be three finite numbers.');
        camera.push(Object.assign({},c));
      }
      camera.sort((a,b)=>a.t-b.t);
      if(camera.length) duration=Math.max(duration,camera[camera.length-1].t);
    }
    for(const list of Object.values(tracks)) list.sort((a,b)=>a.t-b.t);
    return {ok:true,anim:{tracks,camera,duration,fps,easing,loop:!!args.loop}};
  }

  /* ---------- sampling ---------- */
  // One property's value at time t. Keys without the property are skipped. Before the first key that
  // has it, the box's starting value holds (a key at t>0 eases in from the start pose).
  // hasStart: the start pose says something about this field, even "no colors" (undefined).
  function propAt(list,field,t,start,ease,mix,hasStart){
    const keys=list.filter(k=>k[field]!==undefined);
    if(!keys.length) return start;
    const pts=keys[0].t>0&&(hasStart||start!==undefined)?[{t:0,[field]:start}].concat(keys):keys;
    if(t<=pts[0].t) return pts[0][field];
    for(let k=1;k<pts.length;k++){
      if(!mix){ if(t<pts[k].t) return pts[k-1][field]; continue; }   // step: hold until the next key's time
      if(t<=pts[k].t){
        const a=pts[k-1], b=pts[k];
        const span=b.t-a.t, u=span>0?ease((t-a.t)/span):1;
        return mix(a[field],b[field],u);
      }
    }
    return pts[pts.length-1][field];
  }
  const lerp3=(a,b,u)=>a.map((v,i)=>v+(b[i]-v)*u);
  function sampleAt(anim,t,start={},view){
    const ease=EASE[anim.easing]||EASE.easeInOut, boxes={};
    for(const [i,list] of Object.entries(anim.tracks)){
      const s=start[i]||{};
      boxes[i]={
        position:propAt(list,'position',t,s.position,ease,lerp3),
        rotation:propAt(list,'rotation',t,s.rotation,ease,rotationBetween),
        colors:propAt(list,'colors',t,s.colors,ease,null,'colors' in s),
        hidden:propAt(list,'hidden',t,s.hidden,ease,null,'hidden' in s),
        settings:propAt(list,'settings',t,s.settings,ease,null,'settings' in s)
      };
    }
    let camera=null;
    if(anim.camera&&anim.camera.length){
      const v=view||{};
      const num=(a,b,u)=>a+(b-a)*u;
      camera={
        yaw:propAt(anim.camera,'yaw',t,v.yaw,ease,num),
        pitch:propAt(anim.camera,'pitch',t,v.pitch,ease,num),
        zoom:propAt(anim.camera,'zoom',t,v.zoom,ease,num),
        pan:propAt(anim.camera,'pan',t,v.pan,ease,lerp3)
      };
    }
    return {boxes,camera};
  }
  // Frame times for N evenly spaced frames across the animation (first and last included).
  function evenTimes(duration,count){
    const n=Math.max(1,Math.min(400,Math.floor(count)||1));
    if(n===1) return [0];
    return Array.from({length:n},(_,k)=>Math.round(duration*k/(n-1)*1000)/1000);
  }

  /* ---------- keeping messages under the relay limit ---------- */
  const LIMIT=7.5*1024*1024;
  const size=s=>s.length;   // JSON text is what the relay counts; capture data is ASCII
  // A capture with several images is split into several capture messages {part, of}. Anything still
  // too big is cut into {t:'chunk', id, part, of, data} pieces that joinParts puts back together.
  function splitMessage(msg,limit=LIMIT){
    const text=JSON.stringify(msg);
    if(size(text)<=limit) return [msg];
    const out=[];
    if(Array.isArray(msg.images)&&msg.images.length>1){
      const groups=[]; let cur={images:[],times:[]}, used=0;
      const base=size(JSON.stringify(Object.assign({},msg,{images:[],times:[]})))+64;
      msg.images.forEach((img,k)=>{
        const add=size(img)+32;
        if(cur.images.length&&base+used+add>limit){ groups.push(cur); cur={images:[],times:[]}; used=0; }
        cur.images.push(img); cur.times.push(msg.times?msg.times[k]:undefined); used+=add;
      });
      groups.push(cur);
      groups.forEach((g,k)=>{ for(const m of splitMessage(Object.assign({},msg,{images:g.images,times:g.times,part:k+1,of:groups.length}),limit)) out.push(m); });
      return out;
    }
    const id=msg.id||('m'+Date.now().toString(36)+Math.random().toString(36).slice(2,6));
    const room=limit-512, n=Math.ceil(size(text)/room);
    for(let k=0;k<n;k++) out.push({t:'chunk',id,kind:msg.t,part:k+1,of:n,data:text.slice(k*room,(k+1)*room)});
    return out;
  }
  // Collects chunk pieces. Returns the whole message once every piece has arrived, else null.
  function joinParts(store,msg){
    if(!msg||msg.t!=='chunk') return msg;
    const slot=store[msg.id]=store[msg.id]||{of:msg.of,parts:[]};
    slot.parts[msg.part-1]=msg.data;
    if(slot.parts.filter(p=>p!==undefined).length<slot.of) return null;
    delete store[msg.id];
    try{ return JSON.parse(slot.parts.join('')); }catch(e){ return null; }
  }

  /* ---------- a small GIF encoder (fixed 6×6×6 colour cube plus greys, LZW) ---------- */
  function palette(){
    const p=[];
    for(let r=0;r<6;r++) for(let g=0;g<6;g++) for(let b=0;b<6;b++) p.push([r*51,g*51,b*51]);
    for(let k=0;k<40;k++){ const v=Math.round(8+k*6); p.push([v,v,v]); }
    return p;   // 256 entries
  }
  const PAL=palette();
  function indexOf(r,g,b){
    const cube=Math.round(r/51)*36+Math.round(g/51)*6+Math.round(b/51);
    const c=PAL[cube], dc=(c[0]-r)**2+(c[1]-g)**2+(c[2]-b)**2;
    const grey=Math.max(0,Math.min(39,Math.round(((r+g+b)/3-8)/6))), q=PAL[216+grey], dg=(q[0]-r)**2+(q[1]-g)**2+(q[2]-b)**2;
    return dg<dc?216+grey:cube;
  }
  function lzw(indices){
    const out=[]; let cur=0, bits=0;
    const emit=(code,size)=>{ cur|=code<<bits; bits+=size; while(bits>=8){ out.push(cur&255); cur>>=8; bits-=8; } };
    const clear=256, eoi=257; let size=9, next=258, dict=new Map();
    emit(clear,size);
    let w=indices[0];
    for(let i=1;i<indices.length;i++){
      const k=indices[i], key=w*512+k;   // w < 4096, k < 256
      if(dict.has(key)){ w=dict.get(key); continue; }
      emit(w,size);
      if(next<4096){ dict.set(key,next++); if(next>(1<<size)&&size<12) size++; }
      else { emit(clear,size); dict=new Map(); size=9; next=258; }
      w=k;
    }
    emit(w,size); emit(eoi,size);
    if(bits>0) out.push(cur&255);
    return out;
  }
  function encodeGIF(frames,width,height,delayCs=4){
    const b=[]; const u16=v=>{ b.push(v&255,(v>>8)&255); };
    for(const c of 'GIF89a') b.push(c.charCodeAt(0));
    u16(width); u16(height); b.push(0xF7,0,0);                       // global palette, 256 colours
    for(const c of PAL) b.push(c[0],c[1],c[2]);
    b.push(0x21,0xFF,0x0B); for(const c of 'NETSCAPE2.0') b.push(c.charCodeAt(0)); b.push(3,1,0,0,0);   // loop forever
    for(const rgba of frames){
      b.push(0x21,0xF9,4,0); u16(delayCs); b.push(0,0);
      b.push(0x2C); u16(0); u16(0); u16(width); u16(height); b.push(0);
      const idx=new Uint8Array(width*height);
      for(let p=0,q=0;p<idx.length;p++,q+=4) idx[p]=indexOf(rgba[q],rgba[q+1],rgba[q+2]);
      b.push(8);
      const data=lzw(idx);
      for(let k=0;k<data.length;k+=255){ const n=Math.min(255,data.length-k); b.push(n); for(let j=0;j<n;j++) b.push(data[k+j]); }
      b.push(0);
    }
    b.push(0x3B);
    return Uint8Array.from(b);
  }

  /* ---------- batches ---------- */
  // Runs each {op, args}; run(op, args) returns an error string or nothing. Never throws.
  function runBatch(cmds,run,max=500){
    if(!Array.isArray(cmds)) return {ran:0,errors:['batch needs cmds: a list of {op, args}.']};
    if(cmds.length>max) return {ran:0,errors:['A batch can hold at most '+max+' commands.']};
    const errors=[]; let ran=0;
    cmds.forEach((c,k)=>{
      if(!c||typeof c.op!=='string'||c.op==='batch'){ errors.push('cmds['+k+'] needs an op (batches cannot be nested).'); return; }
      try{ const e=run(c.op,c.args&&typeof c.args==='object'?c.args:{}); if(e) errors.push('cmds['+k+'] '+c.op+': '+e); else ran++; }
      catch(err){ errors.push('cmds['+k+'] '+c.op+': '+(err&&err.message||err)); }
    });
    return {ran,errors};
  }

  return {runBatch,MAX_KEYS,MAX_DURATION,EASE,validateAnimation,sampleAt,evenTimes,rotationBetween,eulerToQuat,quatToEuler,slerp,splitMessage,joinParts,encodeGIF,LIMIT};
});
