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
    easeIn:u=>u*u*u,
    easeOut:u=>1-Math.pow(1-u,3),
    easeInOut:u=>u<0.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2,
    smoothstep:u=>u*u*(3-2*u)
  };
  const EASE_NAMES="'linear', 'easeIn', 'easeOut', 'easeInOut' or 'smoothstep'";

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
  // displayUnit: the page's display unit ('mm' or 'in'). Positions (and camera pan) in the keyframes are
  // in that unit, the same as the set command, unless args.unit overrides it. They are converted to
  // millimetres here, so tracks and samples are always in mm.
  // groupIds: the ids of the layout's groups (when known), so keys can be checked against them.
  function validateAnimation(args,boxCount,displayUnit='mm',groupIds){
    const bad=error=>({ok:false,error});
    if(!args||typeof args!=='object') return bad('animate needs an object of arguments.');
    const keys=args.keyframes;
    if(!Array.isArray(keys)||!keys.length) return bad('keyframes must be a non-empty list.');
    if(keys.length>MAX_KEYS) return bad('Too many keyframes: '+keys.length+' (the limit is '+MAX_KEYS+').');
    const easing=args.easing===undefined?'easeInOut':args.easing;
    if(!EASE[easing]) return bad('easing must be '+EASE_NAMES+'.');
    const unit=args.unit===undefined?displayUnit:args.unit;
    if(unit!=='mm'&&unit!=='in') return bad("unit must be 'mm' or 'in'.");
    const mm=unit==='in'?25.4:1, toMM=p=>p.map(v=>v*mm);
    const fps=args.fps===undefined?30:args.fps;
    if(!isNum(fps)||fps<1||fps>MAX_FPS) return bad('fps must be a number from 1 to '+MAX_FPS+'.');
    const tracks={}, groupTracks={}, out=[];
    const knownGroup=id=>!groupIds||groupIds.includes(id);
    for(let k=0;k<keys.length;k++){
      const key=keys[k], where='keyframes['+k+']';
      if(!key||typeof key!=='object') return bad(where+' must be an object.');
      if(!isNum(key.t)||key.t<0) return bad(where+'.t must be a number of seconds, 0 or more.');
      if(key.t>MAX_DURATION) return bad(where+'.t is past the '+MAX_DURATION+' s limit.');
      if(key.boxes===undefined&&key.groups===undefined) return bad(where+' needs boxes (keyed by box index) or groups (keyed by group id).');
      if(key.boxes!==undefined&&(!key.boxes||typeof key.boxes!=='object')) return bad(where+'.boxes must be an object keyed by box index.');
      if(key.groups!==undefined&&(!key.groups||typeof key.groups!=='object'||Array.isArray(key.groups))) return bad(where+'.groups must be an object keyed by group id.');
      for(const [id,pose] of Object.entries(key.groups||{})){
        const w=where+'.groups['+id+']';
        if(!knownGroup(id)) return bad(where+': there is no group '+id+'.');
        if(!pose||typeof pose!=='object') return bad(w+' must be an object.');
        if(pose.position!==undefined&&!isTriple(pose.position)) return bad(w+'.position must be three finite numbers.');
        if(pose.rotation!==undefined&&!isTriple(pose.rotation)) return bad(w+'.rotation must be three finite numbers.');
        if(pose.scale!==undefined&&(!isNum(pose.scale)||pose.scale<=0||pose.scale>100)) return bad(w+'.scale must be a number above 0 (up to 100).');
        if(pose.hidden!==undefined&&typeof pose.hidden!=='boolean') return bad(w+'.hidden must be true or false.');
        if(pose.ease!==undefined&&!EASE[pose.ease]) return bad(w+'.ease must be '+EASE_NAMES+'.');
        if(pose.colors!==undefined){
          if(pose.colors===null||typeof pose.colors!=='object') return bad(w+'.colors must be an object.');
          for(const [part,hex] of Object.entries(pose.colors)) if(!HEX.test(hex)) return bad(w+'.colors.'+part+" must be '#rrggbb'.");
        }
        const entry=Object.assign({t:key.t},pose);
        if(pose.position!==undefined) entry.position=toMM(pose.position);
        (groupTracks[id]=groupTracks[id]||[]).push(entry);
      }
      for(const [name,pose] of Object.entries(key.boxes||{})){
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
        if(pose.params!==undefined){   // a box type's own number settings (joint angles…), which glide between keys
          if(pose.params===null||typeof pose.params!=='object'||Array.isArray(pose.params)) return bad(where+'.boxes['+name+'].params must be an object of setting: number.');
          for(const [k,v] of Object.entries(pose.params)) if(!isNum(v)) return bad(where+'.boxes['+name+'].params.'+k+' must be a finite number.');
        }
        if(pose.ease!==undefined&&!EASE[pose.ease]) return bad(where+'.boxes['+name+'].ease must be '+EASE_NAMES+'.');
        const entry=Object.assign({t:key.t},pose);
        if(pose.position!==undefined) entry.position=toMM(pose.position);
        (tracks[i]=tracks[i]||[]).push(entry);
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
        if(c.fov!==undefined&&(!isNum(c.fov)||c.fov<5||c.fov>120)) return bad(where+'.fov must be from 5 to 120 degrees.');
        if(c.pan!==undefined&&!isTriple(c.pan)) return bad(where+'.pan must be three finite numbers.');
        if(c.ease!==undefined&&!EASE[c.ease]) return bad(where+'.ease must be '+EASE_NAMES+'.');
        if(c.target!==undefined){
          const T=c.target;
          if(!T||typeof T!=='object'||typeof T.group!=='string') return bad(where+'.target must be {group, offset?, lag?}.');
          if(!knownGroup(T.group)) return bad(where+'.target: there is no group '+T.group+'.');
          if(T.offset!==undefined&&!isTriple(T.offset)) return bad(where+'.target.offset must be three finite numbers.');
          if(T.lag!==undefined&&(!isNum(T.lag)||T.lag<0||T.lag>10)) return bad(where+'.target.lag must be seconds from 0 to 10.');
          if(c.pan!==undefined) return bad(where+' has both pan and target; use one.');
        }
        const cam=Object.assign({},c); if(c.pan!==undefined) cam.pan=toMM(c.pan);
        if(c.target!==undefined) cam.target={group:c.target.group,offset:toMM(c.target.offset||[0,0,0]),lag:c.target.lag||0};
        camera.push(cam);
      }
      camera.sort((a,b)=>a.t-b.t);
      if(camera.length) duration=Math.max(duration,camera[camera.length-1].t);
    }
    const cameraInterp=args.cameraInterp===undefined?'linear':args.cameraInterp;
    if(cameraInterp!=='linear'&&cameraInterp!=='catmullRom') return bad("cameraInterp must be 'linear' or 'catmullRom'.");
    if(args.soundtrack!==undefined&&args.soundtrack!==null&&(typeof args.soundtrack!=='string'||!args.soundtrack||(args.soundtrack.length>2048&&!/^data:audio\//.test(args.soundtrack)))) return bad('soundtrack must be the name of an audio file (mp3, wav, …), a URL, or a data:audio URL.');
    if(args.freeCamera!==undefined&&typeof args.freeCamera!=='boolean') return bad('freeCamera must be true or false.');
    const freeCamera=args.freeCamera===true;
    // with a free camera the view on screen is kept, its projection too, unless the animation names one
    const projection=args.projection===undefined?(freeCamera?null:'ortho'):args.projection;
    if(projection!==null&&projection!=='ortho'&&projection!=='perspective') return bad("projection must be 'ortho' or 'perspective'.");
    const groupInterp=args.groupInterp===undefined?'linear':args.groupInterp;
    if(groupInterp!=='linear'&&groupInterp!=='catmullRom') return bad("groupInterp must be 'linear' or 'catmullRom'.");
    for(const list of Object.values(tracks)) list.sort((a,b)=>a.t-b.t);
    for(const list of Object.values(groupTracks)) list.sort((a,b)=>a.t-b.t);
    return {ok:true,anim:{tracks,groupTracks,groupInterp,camera,cameraInterp,projection,soundtrack:args.soundtrack||null,duration,fps,easing,loop:!!args.loop,unit,freeCamera}};
  }

  /* ---------- sampling ---------- */
  // One property's value at time t. Keys without the property are skipped. Before the first key that
  // has it, the box's starting value holds (a key at t>0 eases in from the start pose).
  // hasStart: the start pose says something about this field, even "no colors" (undefined).
  function propAt(list,field,t,start,ease,mix,hasStart){
    // the keys that set this field, worked out once per track and kept with it
    const cache=list._by||(Object.defineProperty(list,'_by',{value:{},enumerable:false}),list._by);
    const keys=cache[field]||(cache[field]=list.filter(k=>k[field]!==undefined));
    if(!keys.length) return start;
    const pts=keys[0].t>0&&(hasStart||start!==undefined)?[{t:0,[field]:start}].concat(keys):keys;
    if(t<=pts[0].t) return pts[0][field];
    let lo=1, hi=pts.length-1;                       // first key with t <= key.t (or > for steps)
    while(lo<hi){ const mid=(lo+hi)>>1; if(mix?t<=pts[mid].t:t<pts[mid].t) hi=mid; else lo=mid+1; }
    for(let k=lo;k<pts.length;k++){
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
  /* A box's params: each name runs through the keys that set it, from the box's own value at 0 (start),
     with the key's ease or the animation's easing. → {name: value} or undefined when no key sets any. */
  function paramsAt(list,t,start,global){
    let names=list._pn;
    if(!names){ names=[...new Set(list.flatMap(k=>k.params?Object.keys(k.params):[]))]; Object.defineProperty(list,'_pn',{value:names,enumerable:false}); }
    if(!names.length) return undefined;
    const cache=list._pk||(Object.defineProperty(list,'_pk',{value:{},enumerable:false}),list._pk), out={};
    for(const n of names){
      let pts=cache[n]||(cache[n]=list.filter(k=>k.params&&k.params[n]!==undefined).map(k=>({t:k.t,v:k.params[n],ease:k.ease})));
      const sv=start&&start[n];
      if(pts[0].t>0&&isNum(sv)) pts=[{t:0,v:sv}].concat(pts);
      out[n]=keyedValue(pts,t,global,false,'num');
    }
    return out;
  }
  function sampleAt(anim,t,start={},view){
    const ease=EASE[anim.easing]||EASE.easeInOut, boxes={};
    for(const [i,list] of Object.entries(anim.tracks)){
      const s=start[i]||{};
      boxes[i]={
        position:propAt(list,'position',t,s.position,ease,lerp3),
        rotation:propAt(list,'rotation',t,s.rotation,ease,rotationBetween),
        colors:propAt(list,'colors',t,s.colors,ease,null,'colors' in s),
        hidden:propAt(list,'hidden',t,s.hidden,ease,null,'hidden' in s),
        settings:propAt(list,'settings',t,s.settings,ease,null,'settings' in s),
        params:paramsAt(list,t,s.params,ease)
      };
    }
    const groups=anim.groupTracks?groupsAt(anim,t,(view&&view.groupRest)||{}):{};
    const camera=anim.camera&&anim.camera.length?cameraAt(anim,t,view||{}):null;
    return {boxes,groups,camera};
  }
  /* ---------- groups ----------
     Each group field runs through the keys that set it, with each key's own ease (else the animation's
     easing) and, with groupInterp 'catmullRom', a smooth spline for position and scale. Rotation uses
     the same rule as box turns (slerp when every axis moves 180° or less, else each angle as written).
     colors and hidden hold until the next key's time. rest[id] = {position:origin, rotation, scale}. */
  function keyedValue(pts,t,global,spline,kind){
    if(t<=pts[0].t) return pts[0].v;
    const last=pts[pts.length-1];
    if(t>=last.t) return last.v;
    let lo=1, hi=pts.length-1;
    if(kind==='step'){ while(lo<hi){ const mid=(lo+hi)>>1; if(t<pts[mid].t) hi=mid; else lo=mid+1; } return pts[lo-1].v; }
    while(lo<hi){ const mid=(lo+hi)>>1; if(t<=pts[mid].t) hi=mid; else lo=mid+1; }
    const a=pts[lo-1], b=pts[lo], span=b.t-a.t;
    if(!(span>0)) return b.v;
    if(kind==='rot') return rotationBetween(a.v,b.v,(EASE[a.ease]||global)((t-a.t)/span));
    if(spline){ const m=slopes(pts), u=(EASE[a.ease]||EASE.linear)((t-a.t)/span); return hermite(a.v,b.v,m[lo-1],m[lo],span,u); }
    const u=(EASE[a.ease]||global)((t-a.t)/span);
    return Array.isArray(a.v)?lerp3(a.v,b.v,u):a.v+(b.v-a.v)*u;
  }
  const GROUP_FIELDS=[['position','num'],['rotation','rot'],['scale','num'],['colors','step'],['hidden','step']];
  function groupsAt(anim,t,rest,only){
    const global=EASE[anim.easing]||EASE.easeInOut, spline=anim.groupInterp==='catmullRom', out={};
    for(const [id,list] of Object.entries(anim.groupTracks||{})){
      if(only&&!only.has(id)) continue;
      const r=rest[id]||{}, o={};
      for(const [f,kind] of GROUP_FIELDS){
        const startVal=f==='rotation'?(r.rotation||[0,0,0]):f==='scale'?(r.scale===undefined?1:r.scale):r[f];
        const pts=camKeys(list,f,kind==='step'?undefined:startVal);
        o[f]=!pts.length||(kind==='step'&&t<pts[0].t)?startVal:keyedValue(pts,t,global,spline,kind);
      }
      out[id]=o;
    }
    return out;
  }
  /* ---------- camera ---------- */
  // Each camera field (yaw, pitch, zoom, pan) runs through the keys that set it. The span from one
  // key to the next uses that first key's own ease, else the animation's easing. Before the first
  // key, the view the animation started from holds (and eases in with the animation's easing).
  // Angles are plain numbers: yaw is never wrapped to the shortest way round, so 350 -> 10 turns
  // back through 180 and 0 -> 720 makes two full orbits.
  const CAM_FIELDS=['yaw','pitch','zoom','pan','fov'];
  const same=(a,b)=>Array.isArray(a)?Array.isArray(b)&&a.every((v,i)=>v===b[i]):a===b;
  function camKeys(cam,field,startVal){
    const cache=cam._by||(Object.defineProperty(cam,'_by',{value:{},enumerable:false}),cam._by);
    const keys=cache[field]||(cache[field]=cam.filter(k=>k[field]!==undefined).map(k=>({t:k.t,v:k[field],ease:k.ease})));
    if(!keys.length||!(keys[0].t>0)||startVal===undefined) return keys;
    const sk=field+'@0', hit=cache[sk];                 // with the starting view in front, kept while it stays the same
    if(hit&&same(hit[0].v,startVal)) return hit;
    return (cache[sk]=[{t:0,v:Array.isArray(startVal)?startVal.slice():startVal,implicit:true}].concat(keys));
  }
  // Catmull-Rom through a field's keys, with the key times as the knots, so each key is reached at
  // exactly its time and the speed is the same just before and just after it (a cubic Hermite curve
  // whose slope at each key is the time-weighted average of the slopes on either side). Where two
  // neighbouring keys hold the same value the slope there is 0, so a hold stays still, without
  // overshoot, and the camera still starts and stops smoothly around it.
  function slopes(pts){
    if(pts._m) return pts._m;
    const n=pts.length, d=k=>{ const a=pts[k], b=pts[k+1], dt=b.t-a.t; return dt>0?(Array.isArray(a.v)?a.v.map((v,i)=>(b.v[i]-v)/dt):(b.v-a.v)/dt):null; };
    const zero=v=>Array.isArray(v)?v.map(()=>0):0, m=[];
    for(let k=0;k<n;k++){
      const L=k>0?d(k-1):null, R=k<n-1?d(k):null, v=pts[k].v;
      if((k>0&&same(pts[k-1].v,v))||(k<n-1&&same(pts[k+1].v,v))||(!L&&!R)) { m.push(zero(v)); continue; }
      if(!L||!R){ m.push(L||R); continue; }                       // ends, and keys either side of a jump
      const tl=pts[k].t-pts[k-1].t, tr=pts[k+1].t-pts[k].t, wl=tr/(tl+tr), wr=tl/(tl+tr);
      m.push(Array.isArray(v)?v.map((_,i)=>L[i]*wl+R[i]*wr):L*wl+R*wr);
    }
    Object.defineProperty(pts,'_m',{value:m,enumerable:false});
    return m;
  }
  function hermite(a,b,ma,mb,span,u){
    const u2=u*u, u3=u2*u, h00=2*u3-3*u2+1, h10=u3-2*u2+u, h01=-2*u3+3*u2, h11=u3-u2;
    if(Array.isArray(a)) return a.map((v,i)=>h00*v+h10*span*ma[i]+h01*b[i]+h11*span*mb[i]);
    return h00*a+h10*span*ma+h01*b+h11*span*mb;
  }
  // A key's look-at can follow a group: target {group, offset, lag}. view.resolveTarget(target, t)
  // turns it into the pan that puts the look-at point there at time t; keys with pan and keys with
  // target blend into each other like any two keys.
  function panKeys(cam,startVal,t,resolve){
    const cache=cam._by||(Object.defineProperty(cam,'_by',{value:{},enumerable:false}),cam._by);
    const keys=cache.panT||(cache.panT=cam.filter(k=>k.pan!==undefined||k.target!==undefined).map(k=>({t:k.t,v:k.pan,target:k.target,ease:k.ease})));
    const pts=keys.map(k=>k.target?{t:k.t,ease:k.ease,v:resolve?resolve(k.target,t):(startVal||[0,0,0])}:k);
    return pts.length&&pts[0].t>0&&startVal!==undefined?[{t:0,v:startVal.slice()}].concat(pts):pts;
  }
  function cameraAt(anim,t,view){
    const global=EASE[anim.easing]||EASE.easeInOut, spline=anim.cameraInterp==='catmullRom', out={};
    const following=anim.camera.some(k=>k.target);
    for(const f of CAM_FIELDS){
      const pts=f==='pan'&&following?panKeys(anim.camera,view.pan,t,view.resolveTarget):camKeys(anim.camera,f,view[f]);
      if(!pts.length){ out[f]=view[f]; continue; }
      if(t<=pts[0].t){ out[f]=pts[0].v; continue; }
      const last=pts[pts.length-1];
      if(t>=last.t){ out[f]=last.v; continue; }
      let lo=1, hi=pts.length-1;
      while(lo<hi){ const mid=(lo+hi)>>1; if(t<=pts[mid].t) hi=mid; else lo=mid+1; }
      const a=pts[lo-1], b=pts[lo], span=b.t-a.t;
      if(spline){   // the spline sets the speed; a key's own ease still reshapes its span
        if(!(span>0)){ out[f]=b.v; continue; }
        const m=slopes(pts), u=(EASE[a.ease]||EASE.linear)((t-a.t)/span);
        out[f]=hermite(a.v,b.v,m[lo-1],m[lo],span,u); continue;
      }
      const u=span>0?(EASE[a.ease]||global)((t-a.t)/span):1;
      out[f]=Array.isArray(a.v)?lerp3(a.v,b.v,u):a.v+(b.v-a.v)*u;
    }
    return out;
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
  // chunkId: the id the chunk pieces carry (default: the message's own id), so two copies of one
  // message cut at different sizes don't mix their pieces.
  function splitMessage(msg,limit=LIMIT,chunkId){
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
      groups.forEach((g,k)=>{ for(const m of splitMessage(Object.assign({},msg,{images:g.images,times:g.times,part:k+1,of:groups.length}),limit,chunkId&&chunkId+'.'+(k+1))) out.push(m); });
      return out;
    }
    const id=chunkId||msg.id||('m'+Date.now().toString(36)+Math.random().toString(36).slice(2,6));
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


  /* ---------- a WebM writer (EBML), for constant-frame-rate video from WebCodecs ---------- */
  // makeWebM({width, height, fps, videoCodec:'V_VP9'|'V_VP8', audio?:{codec:'A_OPUS', sampleRate,
  //   channels, codecPrivate:Uint8Array, codecDelayNs}, chunks:[{track:1|2, us, data:Uint8Array, key}],
  //   durationMs}) -> Uint8Array. Track 1 is video, track 2 audio. Every video frame lands on its exact
  //   timestamp and the track says DefaultDuration = 1/fps, so players and ffprobe see a constant rate.
  //   Clusters start on video key frames; Cues let players seek.
  function ebmlId(id){ const b=[]; while(id>0){ b.unshift(id&255); id=Math.floor(id/256); } return b; }
  function vint(n,len){
    if(!len){ len=1; while(n>=Math.pow(2,7*len)-1) len++; }
    const b=new Array(len); let v=n;
    for(let i=len-1;i>=0;i--){ b[i]=v%256; v=Math.floor(v/256); }
    b[0]|=(0x80>>(len-1)); return b;
  }
  const uintBytes=(n,len)=>{ if(!len){ len=1; while(n>=Math.pow(256,len)) len++; } const b=new Array(len); for(let i=len-1;i>=0;i--){ b[i]=n%256; n=Math.floor(n/256); } return b; };
  const strBytes=s=>Array.from(s,c=>c.charCodeAt(0)&255);
  const floatBytes=f=>{ const d=new DataView(new ArrayBuffer(8)); d.setFloat64(0,f); return Array.from(new Uint8Array(d.buffer)); };
  // An element is [id, payload], where payload is a byte array, a Uint8Array or a list of elements.
  function ebmlLen(el){ const p=el[1]; const n=Array.isArray(p)&&p.length&&Array.isArray(p[0])?p.reduce((a,c)=>a+ebmlLen(c),0):p.length; el._n=n; return ebmlId(el[0]).length+(el[2]||vint(n).length)+n; }
  function ebmlWrite(el,out,pos){
    const id=ebmlId(el[0]); out.set(id,pos); pos+=id.length;
    const sz=vint(el._n,el[2]); out.set(sz,pos); pos+=sz.length;
    const p=el[1];
    if(Array.isArray(p)&&p.length&&Array.isArray(p[0])){ for(const c of p) pos=ebmlWrite(c,out,pos); }
    else { out.set(p,pos); pos+=p.length; }
    return pos;
  }
  const U=(id,n,len)=>[id,uintBytes(n,len)], F=(id,f)=>[id,floatBytes(f)], S=(id,s)=>[id,strBytes(s)];
  function makeWebM(o){
    const vTrack=[0xAE,[U(0xD7,1),U(0x73C5,1),U(0x83,1),S(0x86,o.videoCodec||'V_VP9'),U(0x23E383,Math.round(1e9/o.fps)),[0xE0,[U(0xB0,o.width),U(0xBA,o.height)]]]];
    const tracks=[vTrack];
    if(o.audio){
      const a=o.audio, at=[U(0xD7,2),U(0x73C5,2),U(0x83,2),S(0x86,a.codec||'A_OPUS')];
      if(a.codecPrivate) at.push([0x63A2,Array.from(a.codecPrivate)]);
      if(a.codecDelayNs) at.push(U(0x56AA,a.codecDelayNs));
      at.push(U(0x56BB,80000000),[0xE1,[F(0xB5,a.sampleRate),U(0x9F,a.channels)]]);
      tracks.push([0xAE,at]);
    }
    const chunks=o.chunks.slice().sort((x,y)=>x.us-y.us||x.track-y.track);
    // clusters: a new one at each video key frame (and at least every 30 s)
    const clusters=[]; let cur=null;
    for(const c of chunks){
      const ms=Math.round(c.us/1000);
      if(!cur||(c.track===1&&c.key&&ms>cur.t)||ms-cur.t>30000){ cur={t:ms,blocks:[]}; clusters.push(cur); }
      const head=[...vint(c.track),((ms-cur.t)>>8)&255,(ms-cur.t)&255,c.key&&!c.discardNs?0x80:0];
      const blk=new Uint8Array(head.length+c.data.length); blk.set(head,0); blk.set(c.data,head.length);
      // a block with samples to drop at its end (audio padding past the video's length) goes in a BlockGroup
      if(c.discardNs) cur.blocks.push([0xA0,[[0xA1,blk],U(0x75A2,c.discardNs)]]);
      else cur.blocks.push([0xA3,blk]);
    }
    const clusterEls=clusters.map(c=>[0x1F43B675,[U(0xE7,c.t)].concat(c.blocks)]);
    const info=[0x1549A966,[U(0x2AD7B1,1000000),S(0x4D80,'Boxsmith'),S(0x5741,'Boxsmith'),F(0x4489,o.durationMs)]];
    const tracksEl=[0x1654AE6B,tracks];
    // positions inside the segment; SeekHead and cue positions use fixed 8-byte numbers so sizes don't shift
    const seek=(id,pos)=>[0x4DBB,[[0x53AB,ebmlId(id)],U(0x53AC,pos,8)]];
    const seekHead=[0x114D9B74,[seek(0x1549A966,0),seek(0x1654AE6B,0),seek(0x1C53BB6B,0)]];
    const shLen=ebmlLen(seekHead), infoLen=ebmlLen(info), trLen=ebmlLen(tracksEl);
    let pos=shLen+infoLen+trLen; const cuePts=[];
    for(let k=0;k<clusterEls.length;k++){ cuePts.push([0xBB,[U(0xB3,clusters[k].t),[0xB7,[U(0xF7,1),U(0xF1,pos,8)]]]]); pos+=ebmlLen(clusterEls[k]); }
    const cues=[0x1C53BB6B,cuePts.length?cuePts:[]];
    seekHead[1]=[seek(0x1549A966,shLen),seek(0x1654AE6B,shLen+infoLen),seek(0x1C53BB6B,pos)];
    const segment=[0x18538067,[seekHead,info,tracksEl].concat(clusterEls,cuePts.length?[cues]:[])];
    const header=[0x1A45DFA3,[U(0x4286,1),U(0x42F7,1),U(0x42F2,4),U(0x42F3,8),S(0x4282,'webm'),U(0x4287,4),U(0x4285,2)]];
    const total=ebmlLen(header)+ebmlLen(segment), out=new Uint8Array(total);
    ebmlWrite(segment,out,ebmlWrite(header,out,0));
    return out;
  }
  // OpusHead, the CodecPrivate an Opus track needs (RFC 7845).
  function opusHead(channels,sampleRate,preSkip=312){
    const b=new Uint8Array(19), d=new DataView(b.buffer);
    b.set(strBytes('OpusHead'),0); b[8]=1; b[9]=channels; d.setUint16(10,preSkip,true); d.setUint32(12,sampleRate,true); d.setInt16(16,0,true); b[18]=0;
    return b;
  }
  // Frame times for a constant-rate video: frame k at k/fps, n = round(duration·fps) frames (at least 1).
  function cfrTimes(duration,fps){ const n=Math.max(1,Math.round(duration*fps)); return Array.from({length:n},(_,k)=>Math.min(duration,k/fps)); }
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

  /* ---------- animation files ---------- */
  // Import animation reads what a remote would send: [{op:'animate',args}], {t:'cmd',op:'animate',args},
  // {op,args}, or the animate args on their own. Returns {args} or {error}.
  function parseAnimationFile(text){
    let data;
    try{ data=JSON.parse(text); }catch(e){ return {error:'That file is not valid JSON.'}; }
    const list=Array.isArray(data)?data:[data];
    for(const item of list){
      if(item&&item.op==='animate'&&item.args&&typeof item.args==='object') return {args:item.args};
      if(item&&Array.isArray(item.keyframes)) return {args:item};
    }
    if(data&&data.format==='boxsmith-layout') return {error:'That is a layout file. Use Open layout for it; Import animation takes an animation file.'};
    return {error:'No animation found in that file. It should hold an animate command: [{"op":"animate","args":{…}}].'};
  }


  /* ---------- zip files ---------- */
  // Reads a .zip (stored or deflated entries) into [{name, bytes}]. Folders are skipped. Uses the
  // browser's own DecompressionStream, so nothing extra is needed.
  async function readZip(buffer){
    const u8=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer), dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
    let eocd=-1;
    for(let i=u8.length-22;i>=Math.max(0,u8.length-65557);i--) if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; }
    if(eocd<0) throw new Error('That is not a zip file.');
    const count=dv.getUint16(eocd+10,true); let p=dv.getUint32(eocd+16,true);
    if(count===0xffff||p===0xffffffff) throw new Error('Zip64 archives are not supported.');
    const out=[], dec=new TextDecoder();
    for(let k=0;k<count;k++){
      if(dv.getUint32(p,true)!==0x02014b50) throw new Error('The zip file is damaged.');
      const method=dv.getUint16(p+10,true), csize=dv.getUint32(p+20,true), size=dv.getUint32(p+24,true);
      const nlen=dv.getUint16(p+28,true), xlen=dv.getUint16(p+30,true), clen=dv.getUint16(p+32,true), local=dv.getUint32(p+42,true);
      const name=dec.decode(u8.subarray(p+46,p+46+nlen));
      p+=46+nlen+xlen+clen;
      if(name.endsWith('/')||name.startsWith('__MACOSX/')||/(^|\/)\./.test(name)) continue;   // folders, Mac and hidden files
      const start=local+30+dv.getUint16(local+26,true)+dv.getUint16(local+28,true), raw=u8.subarray(start,start+csize);
      let bytes;
      if(method===0) bytes=raw.slice();
      else if(method===8){
        const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        bytes=new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error(name+' uses a compression method Boxsmith cannot read.');
      if(bytes.length!==size) throw new Error(name+' did not unpack to the right size.');
      out.push({name,bytes});
    }
    return out;
  }
  // Turns the files of a zip into a library: animations (with a matching video if there is one) and
  // designs (layout files). Names come from the file names, minus a prefix they all share.
  function buildLibrary(files,zipName){
    const dec=new TextDecoder(), base=n=>n.split('/').pop().replace(/\.[^.]+$/,'');
    const animations=[], designs=[], videos={}, audios=[];
    for(const f of files){
      const ext=(f.name.split('.').pop()||'').toLowerCase();
      if(['mp4','webm','mov','m4v','gif'].includes(ext)){ videos[base(f.name).toLowerCase()]=f; continue; }
      if(AUDIO_EXT.includes(ext)){ audios.push(f); continue; }
      if(ext!=='json') continue;
      const text=dec.decode(f.bytes), found=parseAnimationFile(text);
      if(found.args){
        const a=found.args, dur=Math.max(0,...(a.keyframes||[]).map(k=>+k.t||0),...(a.camera||[]).map(c=>+c.t||0));
        animations.push({kind:'animation',file:f.name,key:base(f.name),args:a,duration:Math.round(dur*100)/100,boxes:a.base&&Array.isArray(a.base.boxes)?a.base.boxes.length:null});
        continue;
      }
      try{ const d=JSON.parse(text); if(d&&d.format==='boxsmith-layout'&&Array.isArray(d.boxes)) designs.push({kind:'design',file:f.name,key:base(f.name),json:text,boxes:d.boxes.length}); }catch(e){}
    }
    const all=animations.concat(designs), keys=all.map(x=>x.key);
    let prefix='';
    if(keys.length>1){ prefix=keys.reduce((p,k)=>{ let i=0; while(i<p.length&&i<k.length&&p[i]===k[i]) i++; return p.slice(0,i); }); prefix=prefix.slice(0,prefix.search(/[-_ ][^-_ ]*$/)+1); }
    const nice=k=>{ let s=k; if(prefix&&s.startsWith(prefix)&&s.length>prefix.length) s=s.slice(prefix.length); s=s.replace(/[-_ ]anim(ation)?$/i,'').replace(/[-_]+/g,' ').trim(); return s.charAt(0).toUpperCase()+s.slice(1); };
    for(const x of all){
      x.name=(x.args&&typeof x.args.name==='string'&&x.args.name)||nice(x.key);
      if(x.kind==='animation'){
        const v=videos[x.key.toLowerCase()]||videos[x.key.toLowerCase().replace(/[-_ ]anim(ation)?$/i,'')]; if(v) x.video=v;
        const au=findSoundtrack(x.args.soundtrack,audios,x.key); if(au) x.audio=au;
      }
    }
    // title: the folder everything sits in, if there is one, else the zip's own name
    const tops=new Set(files.map(f=>f.name.includes('/')?f.name.split('/')[0]:''));
    const folder=tops.size===1?[...tops][0]:'';
    const title=(folder||(zipName||'').replace(/\.zip$/i,'')).replace(/[-_]+/g,' ').trim();
    return {title:title?title.charAt(0).toUpperCase()+title.slice(1):'Animations',animations,designs,audios};
  }

  /* ---------- soundtracks ---------- */
  const AUDIO_EXT=['mp3','wav','ogg','oga','opus','m4a','aac','flac','weba'];
  const isAudioName=n=>AUDIO_EXT.includes((String(n).split('.').pop()||'').toLowerCase());
  // The audio file an animation's soundtrack names, among files [{name, bytes}]: the same file name
  // (folders and case ignored). With no soundtrack named, the one audio file whose name starts with
  // the animation's own (boxbot-reel-loop-anim.json → boxbot-reel-loop-sfx-v1.mp3), if there's just one.
  function findSoundtrack(name,files,animKey){
    const leaf=n=>String(n).split(/[\/\\]/).pop().toLowerCase();
    if(typeof name==='string'&&name&&!/^(data:|https?:|blob:)/i.test(name)) return files.find(f=>leaf(f.name)===leaf(name))||null;
    if(name||!animKey) return null;
    const stem=String(animKey).toLowerCase().replace(/[-_ ]anim(ation)?$/i,'');
    const hits=files.filter(f=>leaf(f.name).replace(/\.[^.]+$/,'').startsWith(stem));
    return hits.length===1?hits[0]:null;
  }
  // A copy of decoded audio channels cut or padded with silence to exactly `seconds`, so a looping
  // player restarts it in step with the animation. channels: Float32Array[]; returns Float32Array[].
  function fitAudio(channels,sampleRate,seconds){
    const n=Math.max(1,Math.round(seconds*sampleRate));
    return channels.map(ch=>{ const out=new Float32Array(n); out.set(ch.length>n?ch.subarray(0,n):ch); return out; });
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

  return {groupsAt,findSoundtrack,fitAudio,isAudioName,AUDIO_EXT,makeWebM,opusHead,cfrTimes,readZip,buildLibrary,parseAnimationFile,runBatch,MAX_KEYS,MAX_DURATION,EASE,validateAnimation,sampleAt,evenTimes,rotationBetween,eulerToQuat,quatToEuler,slerp,splitMessage,joinParts,encodeGIF,LIMIT};
});
