/* Boxsmith Remote: edit an Arrange boxes layout from a second screen.
   The host screen shows the model and owns the layout. A remote screen joins with a 6-digit code,
   shows the controls for whatever is selected, and sends each edit back as a command. The host
   applies it with its own controls, so a remote edit behaves exactly like a click on the host.
   Two windows in the same browser talk directly (BroadcastChannel). Other devices go through the
   relay Space (relay/ in the repo), set with ?relay=wss://.../ws or localStorage boxsmith-relay. */
const Remote=(()=>{
  const DEFAULT_RELAY='wss://marktheartist-boxsmith-relay.hf.space/ws';
  const relayURL=()=>{
    const q=new URLSearchParams(location.search).get('relay');
    if(q){ try{ localStorage.setItem('boxsmith-relay',q); }catch(e){} return q; }
    try{ return localStorage.getItem('boxsmith-relay')||DEFAULT_RELAY; }catch(e){ return DEFAULT_RELAY; }
  };
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtCode=c=>c.slice(0,3)+' '+c.slice(3);
  // JSON with sorted keys, so two copies of the same design compare equal
  const stable=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o,key)=>(o[key]=x[key],o),{}):x);
  const full=s=>stable(Object.assign({},DEFAULTS,s));

  /* ---------- the link: BroadcastChannel + relay WebSocket, messages de-duplicated ---------- */
  function Link(room,role,onMessage,onStatus){
    const seen=[], me=Math.random().toString(36).slice(2), pieces={};
    let bc=null, ws=null, closed=false, retry=0, timer=null, relayState='connecting';
    const deliver=msg=>{
      if(!msg||msg.from===role||msg.src===me) return;
      if(msg.mid){ if(seen.includes(msg.mid)) return; seen.push(msg.mid); if(seen.length>500) seen.shift(); }   // same packet by both routes
      const whole=window.BoxsmithAnim?BoxsmithAnim.joinParts(pieces,msg):msg;                                     // big messages arrive in chunks
      if(whole) onMessage(whole);
    };
    try{ bc=new BroadcastChannel('boxsmith-remote-'+room); bc.onmessage=e=>deliver(e.data); }catch(e){}
    const status=s=>{ relayState=s; onStatus(s); };
    const open=()=>{
      if(closed) return;
      let sock;
      try{ sock=new WebSocket(relayURL()); }catch(e){ status('offline'); return; }
      ws=sock;
      sock.onopen=()=>{ retry=0; sock.send(JSON.stringify({t:'join',room,role})); };
      sock.onmessage=e=>{
        let msg; try{ msg=JSON.parse(e.data); }catch(err){ return; }
        if(msg.t==='joined'){ status('relay'); if(role==='host') onMessage({t:'peers',remotes:msg.remotes}); return; }
        if(msg.t==='nohost'){ status('nohost'); return; }
        if(msg.t==='error'){ status('error:'+msg.msg); closed=role==='host'; return; }
        if(msg.t==='hostgone'||msg.t==='hostback'||msg.t==='peers'){ onMessage(msg); return; }
        deliver(msg);
      };
      sock.onclose=()=>{
        if(ws===sock) ws=null;
        if(closed) return;
        if(relayState!=='nohost') status('offline');
        clearTimeout(timer);
        timer=setTimeout(open,Math.min(15000,1500*2**retry++));   // the free Space may be waking up
      };
      sock.onerror=()=>{};
    };
    open();
    let n=0;
    return {
      send(obj){
        const packets=window.BoxsmithAnim?BoxsmithAnim.splitMessage(obj):[obj];
        for(const p of packets){
          const msg=Object.assign({},p,{mid:me+'.'+(n++),src:me,from:role});
          if(bc) bc.postMessage(msg);
          if(ws&&ws.readyState===1) ws.send(JSON.stringify(msg));
        }
      },
      close(){ closed=true; clearTimeout(timer); if(bc) bc.close(); if(ws) ws.close(); },
      get relay(){ return relayState; }
    };
  }

  /* ---------- animation files ---------- */
  // Accepts what a remote would send: [{op:'animate',args}], {t:'cmd',op:'animate',args}, {op,args},
  // or the animate args on their own. Returns {args} or {error}.
  const animationFromFile=text=>window.BoxsmithAnim.parseAnimationFile(text);

  /* ---------- host: the screen with the model ---------- */
  let host=null, hostCode='', remotes=0, localPeer=false, stateTimer=null;
  function hash(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))|0; return (h>>>0).toString(36); }
  // A design edited on the remote replaces that box's design; place, turn, look and colors stay.
  function applyDesign(index,settings){
    const box=layoutBoxes[index];
    if(!box||!settings||typeof settings!=='object') return;
    try{
      const s=JSON.parse(JSON.stringify(settings)); delete s.assembly;
      s.look=box.settings.look; if(box.settings.colors) s.colors=box.settings.colors; else delete s.colors;
      const next=makeLayoutBox(s,box.position.slice(),box.rotation.slice(),box.hidden);
      layoutBoxes[index]=next;
      rebuildBoxLayout(); saveBoxLayout(); syncBoxLayout(); render();
    }catch(err){ console.error(err); toast('Those settings make impossible geometry; the box was not changed.'); if(host) host.send({t:'note',text:'Those settings make impossible geometry, so the box was not changed.'}); }
  }
  function newCode(){ return String(100000+Math.floor(Math.random()*900000)); }
  function hostStart(){
    hostStop();
    hostCode=newCode(); remotes=0; localPeer=false;
    host=Link(hostCode,'host',hostMessage,()=>renderHostStatus());
    if(typeof curView!=='undefined'&&curView!=='layout') document.querySelector('#tabs [data-v="layout"]')?.click();
    renderDialog();
  }
  function hostStop(){ if(host){ host.send({t:'bye'}); host.close(); } host=null; hostCode=''; renderDialog(); }
  function partNames(box){
    if(!box||typeof GL==='undefined'||!GL) return [];
    return [...new Set(GL.objs.filter(o=>o.s.layoutBox===box&&o.s.part).map(o=>o.s.part.name))];
  }
  let sentDesign='', forceDesign=false;
  function state(){
    const box=layoutBoxes[layoutSelection];
    const clash=new Set(layoutOverlaps().flat());
    const design=box?JSON.stringify(box.settings):'';
    const withDesign=design&&(design!==sentDesign||forceDesign);
    if(withDesign){ sentDesign=design; forceDesign=false; }
    const stereo=$('#layoutCtl [data-stereo-mode]');
    return {t:'state',unit:S.unit,scale:layoutCoordinateScale(),sel:box?layoutSelection:-1,part:layoutPart,
      design:withDesign?box.settings:undefined,designKey:design.length+':'+hash(design),
      placing:placingBox,maximized:document.body.classList.contains('max3d'),stereo:stereo?stereo.value:view.stereo,boxCount:layoutBoxes.length,
      library:library?{title:library.title,current:library.current,animations:library.animations.map(x=>({name:x.name,duration:x.duration,boxes:x.boxes})),designs:library.designs.map(x=>({name:x.name,boxes:x.boxes}))}:null,
      view:viewDeg(),anim:anim?{playing:anim.playing,t:Math.round(anim.t*1000)/1000,duration:anim.duration,loop:anim.loop}:null,exporting,
      boxes:layoutBoxes.map((b,i)=>({label:layoutBoxLabel(b,i),hidden:!!b.hidden,clash:clash.has(i),position:b.position,rotation:b.rotation,colors:b.settings.colors||{}})),
      parts:partNames(box),acrylic:!!box&&boxHasAcrylic(box),
      sides:[...$('#layoutSnapSide').options].map(o=>[o.value,o.textContent]),
      status:$('#layoutStatus').textContent};
  }
  function sendState(now){ clearTimeout(stateTimer); if(now===true){ if(host) host.send(state()); return; } stateTimer=setTimeout(()=>{ if(host) host.send(state()); },40); }
  const press=sel=>{ const el=$(sel); if(el&&!el.disabled&&!el.hidden) el.click(); };
  function hostMessage(msg){
    if(msg.t==='peers'){ remotes=msg.remotes; renderHostStatus(); return; }
    if(msg.t==='hello'){ forceDesign=true; localPeer=true; renderHostStatus(); if(curView!=='layout') document.querySelector('#tabs [data-v="layout"]')?.click(); sendState(true); return; }
    if(msg.t!=='cmd') return;
    const args=msg.args&&typeof msg.args==='object'?msg.args:{};
    if(msg.op==='batch'){
      const r=Anim.runBatch(args.cmds,runCmd);
      if(r.errors.length) note('Batch: '+r.ran+' of '+(Array.isArray(args.cmds)?args.cmds.length:0)+' commands ran. '+r.errors.slice(0,5).join(' '));
    } else {
      let err; try{ err=runCmd(msg.op,args); }catch(e){ err=e&&e.message||String(e); }
      if(err) note(msg.op+': '+err);
    }
    sendState(true);   // one fresh state after every command (or batch)
  }
  const note=text=>{ if(host) host.send({t:'note',text:String(text).slice(0,2000)}); };
  const sendBig=msg=>{ if(host) host.send(msg); };   // Link.send splits anything over the relay limit
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const needBox=()=>layoutBoxes[layoutSelection]?'':'Select a box first.';
  // Runs one command. Returns an error message, or nothing when it worked. Never throws on bad input.
  function runCmd(op,a){
    switch(op){
      case 'select':
        if(a.index===-1){ selectLayoutBox(-1); return; }
        if(!Number.isInteger(a.index)||!layoutBoxes[a.index]) return 'There is no box '+a.index+'. Boxes are numbered from 0 to '+(layoutBoxes.length-1)+'.';
        selectLayoutBox(a.index); return;
      case 'part': {
        if(needBox()) return needBox();
        if(a.name!==null&&a.name!==undefined&&typeof a.name!=='string') return 'name must be a part name, "acrylic" or null.';
        layoutPart=a.name||null; syncBoxLayout(); render(); return;
      }
      case 'set': {
        if(needBox()) return needBox();
        if(![0,1,2].includes(a.k)) return 'k must be 0, 1 or 2 (x, y or z).';
        if(!finite(a.value)) return 'value must be a finite number.';
        const input=$(a.rot?'[data-layout-rotation="'+a.k+'"]':'[data-layout-axis="'+a.k+'"]');
        input.value=a.value; input.dispatchEvent(new Event('change')); return;
      }
      case 'turn':
        if(needBox()) return needBox();
        if(!['z:-90','z:90','x:90','y:90','reset'].includes(a.kind)) return "kind must be 'z:-90', 'z:90', 'x:90', 'y:90' or 'reset'.";
        press('[data-lay-turn="'+a.kind+'"]'); return;
      case 'step':
        if(needBox()) return needBox();
        if(!['0:-1','0:1','1:-1','1:1','2:-1','2:1'].includes(a.key)) return "key must be '0:-1', '0:1', '1:-1', '1:1', '2:-1' or '2:1'.";
        press('[data-lay-step="'+a.key+'"]'); return;
      case 'snap': {
        if(needBox()) return needBox();
        if(!Number.isInteger(a.to)||!layoutBoxes[a.to]||a.to===layoutSelection) return 'to must be the index of another box.';
        if(![...$('#layoutSnapSide').options].some(o=>o.value===a.side)) return 'side must be one of: '+[...$('#layoutSnapSide').options].map(o=>o.value).join(', ')+'.';
        if(a.gap!==undefined&&!(finite(a.gap)&&a.gap>=0)) return 'gap must be 0 or more.';
        $('#layoutSnapTarget').value=String(a.to); $('#layoutSnapSide').value=a.side; $('#layoutSnapGap').value=a.gap||0; press('#layoutSnap'); return;
      }
      case 'dup': if(needBox()) return needBox(); press(a.inPlace?'#layoutDuplicateInPlace':'#layoutDuplicate'); return;
      case 'hide': if(needBox()) return needBox(); press('#layoutHide'); return;
      case 'remove': if(needBox()) return needBox(); press('#layoutRemove'); return;
      case 'color': {
        if(needBox()) return needBox();
        if(!/^#[0-9a-f]{6}$/i.test(a.hex)) return "hex must be a color like '#3a7bd5'.";
        const c=$('#layoutColor'); c.value=a.hex; c.dispatchEvent(new Event('input')); if(a.final!==false) c.dispatchEvent(new Event('change')); return;
      }
      case 'nocolor': if(needBox()) return needBox(); press('#layoutColorClear'); return;
      case 'fit': press('#layoutFit'); return;
      case 'top': press('#layoutTop'); return;
      case 'place': if(needBox()) return needBox(); press('#layoutPlace'); return;
      case 'design':
        if(!Number.isInteger(a.index)||!layoutBoxes[a.index]) return 'There is no box '+a.index+'.';
        if(!a.settings||typeof a.settings!=='object') return 'settings must be an object.';
        applyDesign(a.index,a.settings); return;
      case 'add':
        if(!a.settings||typeof a.settings!=='object') return 'settings must be an object.';
        addLayoutBox({settings:a.settings,rotation:[0,0,0],position:[0,0,0],hidden:false}); return;
      case 'units': {
        if(a.unit!=='mm'&&a.unit!=='in') return "unit must be 'mm' or 'in'.";
        const u=$('#layoutUnits'); u.value=a.unit; u.dispatchEvent(new Event('change')); return;
      }
      case 'maximize': if(document.body.classList.contains('max3d')) press('#previewExitMax'); else press('#layoutCtl [data-maximize-view]'); return;
      case 'stereo': {
        const sel=$('#layoutCtl [data-stereo-mode]');
        if(!['off','cross','parallel'].includes(a.mode)) return "mode must be 'off', 'cross' or 'parallel'.";
        sel.value=a.mode; sel.dispatchEvent(new Event('change')); return;
      }
      case 'view': {
        for(const f of ['yaw','pitch','zoom']) if(a[f]!==undefined&&!finite(a[f])) return f+' must be a finite number.';
        if(a.pan!==undefined&&!(Array.isArray(a.pan)&&a.pan.length===3&&a.pan.every(finite))) return 'pan must be three finite numbers.';
        if(a.yaw!==undefined) view.yaw=a.yaw*PI/180;
        if(a.pitch!==undefined) view.pitch=Math.max(-90,Math.min(90,a.pitch))*PI/180;
        if(a.zoom!==undefined) view.zoom=Math.max(0.05,Math.min(20,a.zoom));
        if(a.pan!==undefined) view.pan=a.pan.slice();
        render(); return;
      }
      case 'save': press('#layoutSave'); return;
      case 'open': try{ stopAnim(true); openBoxLayout(a.json); }catch(err){ toast('That layout file could not be opened.'); return 'That layout file could not be opened: '+err.message; } return;
      case 'clear': stopAnim(true); if(layoutBoxes.length){ layoutBoxes=[]; rebuildBoxLayout(); saveBoxLayout(); selectLayoutBox(-1); toast('Layout cleared'); } return;
      case 'animate': return loadAnim(a);
      case 'play': return playAnim();
      case 'pause': if(!anim) return 'No animation is loaded.'; pauseAnim(); return;
      case 'stop': if(!anim) return 'No animation is loaded.'; stopAnim(false); return;
      case 'seek':
        if(!anim) return 'No animation is loaded.';
        if(!finite(a.t)) return 't must be a finite number of seconds.';
        seekAnim(a.t); return;
      case 'library':
        if(a.kind!=='animation'&&a.kind!=='design') return "kind must be 'animation' or 'design'.";
        if(!Number.isInteger(a.index)) return 'index must be a whole number.';
        { const r=playLibrary(a.kind,a.index,true); return typeof r==='string'?r:undefined; }
      case 'capture': return capture(a);
      case 'export': return exportAnim(a);
      default: return 'Unknown command.';
    }
  }

  /* ---------- animation playback ---------- */
  const Anim=window.BoxsmithAnim;
  let anim=null;   // {spec, duration, fps, loop, t, playing, raf, wall0, t0, lastFrameT, originals, view0, variants, onFrame, onDone}
  const poseOf=box=>({position:box.position.slice(),rotation:box.rotation.slice(),colors:box.settings.colors?JSON.parse(JSON.stringify(box.settings.colors)):undefined,hidden:!!box.hidden,settings:box.settings});
  const viewDeg=()=>({yaw:view.yaw*180/PI,pitch:view.pitch*180/PI,zoom:view.zoom,pan:view.pan.slice()});
  /* Fast, exact pose for playback. A box's lowest point (and its bounds) can only be at a corner of
     the convex outline of one of its panels, so each panel's outline is reduced once to its convex
     hull (a finger-jointed panel goes from hundreds of points to a handful). The result is the same
     pose transformLayoutBox gives; the slower overlap data is refreshed when playback stops. */
  function hull2D(loop){
    const n=loop.length; if(n<4) return loop.slice();
    const p0=loop[0]; let far=loop[1], fd=0;
    for(const p of loop){ const d=(p[0]-p0[0])**2+(p[1]-p0[1])**2+(p[2]-p0[2])**2; if(d>fd){ fd=d; far=p; } }
    let nx=0,ny=0,nz=0;   // Newell normal
    for(let i=0;i<n;i++){ const a=loop[i], b=loop[(i+1)%n]; nx+=(a[1]-b[1])*(a[2]+b[2]); ny+=(a[2]-b[2])*(a[0]+b[0]); nz+=(a[0]-b[0])*(a[1]+b[1]); }
    const ul=Math.sqrt(fd)||1, u=[(far[0]-p0[0])/ul,(far[1]-p0[1])/ul,(far[2]-p0[2])/ul];
    const v=[ny*u[2]-nz*u[1], nz*u[0]-nx*u[2], nx*u[1]-ny*u[0]];
    const pts=loop.map((p,i)=>{ const d=[p[0]-p0[0],p[1]-p0[1],p[2]-p0[2]]; return [d[0]*u[0]+d[1]*u[1]+d[2]*u[2], d[0]*v[0]+d[1]*v[1]+d[2]*v[2], i]; }).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
    const lower=[], upper=[];
    for(const p of pts){ while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0) lower.pop(); lower.push(p); }
    for(let i=pts.length-1;i>=0;i--){ const p=pts[i]; while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0) upper.pop(); upper.push(p); }
    const hull=lower.slice(0,-1).concat(upper.slice(0,-1));
    return hull.length>=3?hull.map(h=>loop[h[2]]):loop.slice();
  }
  const fastE=new THREE.Euler(), fastT=new THREE.Matrix4(), fastV=new THREE.Vector3();
  function fastTransform(box){
    const model=box.model;
    if(!model._hull) model._hull=model.solids.flatMap(s=>hull2D(s.bot[0]).concat(hull2D(s.top[0])));
    const r=box.rotation, ctr=model.ctr;
    const m=(box.pose&&box.pose.isMatrix4)?box.pose:(box.pose=new THREE.Matrix4());
    m.makeRotationFromEuler(fastE.set(r[0]*PI/180,r[1]*PI/180,r[2]*PI/180,'ZYX')).multiply(fastT.makeTranslation(-ctr[0],-ctr[1],-ctr[2]));
    let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity;
    for(const p of model._hull){
      fastV.fromArray(p).applyMatrix4(m);
      if(fastV.x<x0)x0=fastV.x; if(fastV.x>x1)x1=fastV.x; if(fastV.y<y0)y0=fastV.y; if(fastV.y>y1)y1=fastV.y; if(fastV.z<z0)z0=fastV.z; if(fastV.z>z1)z1=fastV.z;
    }
    const ox=box.position[0], oy=box.position[1], oz=box.position[2]-z0;
    m.elements[12]+=ox; m.elements[13]+=oy; m.elements[14]+=oz;
    if(box.bounds&&box.bounds.isBox3){ box.bounds.min.set(x0+ox,y0+oy,z0+oz); box.bounds.max.set(x1+ox,y1+oy,z1+oz); }
  }
  function relayoutNoFit(){
    boxLayoutScene.solids=layoutBoxes.flatMap(box=>{ transformLayoutBox(box); for(const solid of box.model.solids) solid.layoutBox=box; return box.model.solids; });
    if(layingOut()) buildGL(boxLayoutScene);
  }
  function loadAnim(a){
    if(a.base!==undefined){
      try{ stopAnim(true); openBoxLayout(a.base); }catch(err){ return 'The base layout could not be opened: '+err.message; }
    }
    if(!layoutBoxes.length) return 'There are no boxes to animate. Add boxes or send a base layout.';
    const v=Anim.validateAnimation(a,layoutBoxes.length,S.unit==='in'?'in':'mm');   // positions in the display unit, like set
    if(!v.ok) return v.error;
    stopAnim(true);
    const spec=v.anim, originals={}, variants={};
    for(const i of Object.keys(spec.tracks)){
      const box=layoutBoxes[i]; box._animColors=undefined;
      originals[i]={box,pose:poseOf(box)};
      // build each new design once now, so playback only swaps meshes when a key changes settings
      for(const key of spec.tracks[i]) if(key.settings){
        const s=Object.assign({},JSON.parse(JSON.stringify(key.settings)));
        s.look=box.settings.look; delete s.assembly;
        const id=JSON.stringify(s);
        if(variants[i]&&variants[i][id]) { key.settings=variants[i][id].settings; continue; }
        try{ const built=makeLayoutBox(s,box.position.slice(),box.rotation.slice(),box.hidden); (variants[i]=variants[i]||{})[id]=built; key.settings=built.settings; }
        catch(err){ return 'keyframe at '+key.t+' s: those settings for box '+i+' make impossible geometry.'; }
      }
    }
    const start={}; for(const i of Object.keys(originals)) start[i]=originals[i].pose;
    anim={spec,unit:spec.unit,start,duration:spec.duration,fps:spec.fps,loop:spec.loop,t:0,playing:false,raf:0,originals,variants,view0:viewDeg(),lastFrameT:-1};
    if(curView!=='layout') document.querySelector('#tabs [data-v="layout"]')?.click();
    applyFrame(0);
    if(a.autoplay!==false) playAnim();
  }
  // Pose every animated box (and the camera) for time t, then draw. Transforms only: meshes are
  // rebuilt only when a key swaps in a different design.
  function applyFrame(t,draw=true){
    if(!anim) return;
    const s=Anim.sampleAt(anim.spec,t,anim.start,anim.view0);
    let swapped=false;
    for(const [i,p] of Object.entries(s.boxes)){
      let box=layoutBoxes[i]; if(!box) continue;
      const want=p.settings||anim.originals[i].pose.settings;
      if(box.settings!==want){
        const next=want===anim.originals[i].pose.settings?anim.originals[i].box:Object.values(anim.variants[i]||{}).find(b=>b.settings===want);
        if(next&&next!==box){ layoutBoxes[i]=next; box=next; swapped=true; }
      }
      box.position=p.position.slice(); box.rotation=p.rotation.slice(); box.hidden=!!p.hidden;
      if(p.colors!==box._animColors){   // colors only change at their keys, so most frames skip this
        box._animColors=p.colors;
        if(p.colors) box.settings.colors=JSON.parse(JSON.stringify(p.colors)); else delete box.settings.colors;
      }
      if(!swapped) fastTransform(box);
    }
    if(swapped) relayoutNoFit();
    if(s.camera){
      if(finite(s.camera.yaw)) view.yaw=s.camera.yaw*PI/180;
      if(finite(s.camera.pitch)) view.pitch=s.camera.pitch*PI/180;
      if(finite(s.camera.zoom)) view.zoom=s.camera.zoom;
      if(Array.isArray(s.camera.pan)) view.pan=s.camera.pan.slice();
    }
    anim.t=t; anim.lastFrameT=t;
    if(draw) render();
    if(!barRaf) barRaf=requestAnimationFrame(()=>{ barRaf=0; renderAnimBar(); });
    if(anim.onFrame) anim.onFrame(t);
  }
  function tick(now){
    if(!anim||!anim.playing) return;
    let t=anim.t0+(now-anim.wall0)/1000;
    if(t>=anim.duration){
      if(anim.loop&&anim.duration>0){ t%=anim.duration; anim.t0=t; anim.wall0=now; }
      else { applyFrame(anim.duration); anim.playing=false; finishAnim(); return; }
    }
    // draw at the requested frame rate, timed by the real clock so slow devices stay on time
    if(t-anim.lastFrameT>=1/anim.fps-1e-4||t<anim.lastFrameT) applyFrame(t);
    anim.raf=requestAnimationFrame(tick);
  }
  const settle=()=>{ if(anim) for(const i of Object.keys(anim.originals)) if(layoutBoxes[i]) transformLayoutBox(layoutBoxes[i]); };
  function finishAnim(){
    settle(); exitCinema(); renderAnimBar();
    if(host) host.send({t:'anim',state:'done',time:anim.duration});
    syncBoxLayout(); sendState(true);
    const done=anim.onDone; anim.onDone=null; if(done) done();
  }
  /* ---------- cinema: everything hidden while an animation plays ---------- */
  // The 3D view fills the screen (true fullscreen when the browser allows it: a click or tap just
  // before is needed for that), and every control is hidden. A tap, click, Esc or Space stops it.
  // When playback ends, pauses or stops, the interface comes back as it was.
  let cinema=null, fsByUs=false;
  const fsElement=()=>document.fullscreenElement||document.webkitFullscreenElement;
  function goFullscreen(){
    if(fsElement()) return;
    const el=document.documentElement, f=el.requestFullscreen||el.webkitRequestFullscreen;
    if(!f) return;
    try{ const p=f.call(el); fsByUs=true; if(p&&p.catch) p.catch(()=>{ fsByUs=false; }); }catch(e){ fsByUs=false; }
  }
  function enterCinema(){
    if(cinema||exporting||typeof setMax!=='function') return;   // recordings play without it, so a tap can't cut them short
    cinema={wasMax:maximizedView()};
    goFullscreen();                       // works when this follows a click or tap
    setMax(true);
    document.body.classList.add('cinema');
    if(document.activeElement&&document.activeElement.blur) document.activeElement.blur();
    requestAnimationFrame(render);
  }
  function exitCinema(){
    if(!cinema) return;
    const was=cinema.wasMax; cinema=null;
    document.body.classList.remove('cinema');
    if(!was) setMax(false);
    if(fsByUs&&fsElement()){ const x=document.exitFullscreen||document.webkitExitFullscreen; try{ const p=x&&x.call(document); if(p&&p.catch) p.catch(()=>{}); }catch(e){} }
    fsByUs=false;
    renderAnimBar(); renderLibrary(); requestAnimationFrame(render);
  }
  let swallowClicksUntil=0;
  function stopFromCinema(e){
    if(!cinema) return;
    if(e){ e.preventDefault(); e.stopPropagation(); }
    swallowClicksUntil=performance.now()+700;   // the stopping tap must not also press whatever reappears under it
    pauseAnim(); sendState(true);
  }
  function playAnim(){
    if(!anim) return 'No animation is loaded. Send animate first.';
    if(anim.t>=anim.duration) anim.t=0;
    cancelAnimationFrame(anim.raf);
    anim.playing=true; anim.t0=anim.t; anim.wall0=performance.now(); anim.lastFrameT=-1;
    applyFrame(anim.t);
    if(host) host.send({t:'anim',state:'playing',time:anim.t,unit:anim.unit});
    enterCinema();
    anim.raf=requestAnimationFrame(tick);
  }
  function pauseAnim(){ if(!anim) return; anim.playing=false; cancelAnimationFrame(anim.raf); settle(); exitCinema(); syncBoxLayout(); renderAnimBar(); }
  function seekAnim(t){
    t=Math.max(0,Math.min(anim.duration,t));
    applyFrame(t);
    if(anim.playing){ anim.t0=t; anim.wall0=performance.now(); }
    else { settle(); syncBoxLayout(); }
  }
  // Stop: put every animated box (and the camera) back as it was before the animation.
  // forget=true also unloads the animation.
  function stopAnim(forget){
    if(!anim) return;
    anim.playing=false; cancelAnimationFrame(anim.raf);
    let swapped=false;
    for(const [i,o] of Object.entries(anim.originals)){
      if(layoutBoxes[i]!==o.box&&layoutBoxes[i]&&anim.variants[i]&&Object.values(anim.variants[i]).includes(layoutBoxes[i])){ layoutBoxes[i]=o.box; swapped=true; }
      const box=o.box, p=o.pose; box._animColors=undefined;
      box.position=p.position.slice(); box.rotation=p.rotation.slice(); box.hidden=p.hidden;
      if(p.colors) box.settings.colors=JSON.parse(JSON.stringify(p.colors)); else delete box.settings.colors;
      transformLayoutBox(box);
    }
    if(swapped) relayoutNoFit();
    const v=anim.view0; view.yaw=v.yaw*PI/180; view.pitch=v.pitch*PI/180; view.zoom=v.zoom; view.pan=v.pan.slice();
    if(forget) anim=null; else { anim.t=0; anim.lastFrameT=-1; }
    exitCinema(); render(); syncBoxLayout(); renderAnimBar();
  }

  /* ---------- capture ---------- */
  const glCanvas=()=>GL&&GL.r&&GL.r.domElement;
  // Draw the live WebGL canvas into a 2D canvas, letterboxed on white. Called right after a render,
  // in the same task, so the drawing buffer still holds the frame.
  function drawInto(ctx,x,y,w,h){
    const src=glCanvas(), sw=src.width, sh=src.height, s=Math.min(w/sw,h/sh), dw=sw*s, dh=sh*s;
    ctx.fillStyle='#ffffff'; ctx.fillRect(x,y,w,h);
    ctx.drawImage(src,0,0,sw,sh,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
  }
  const mime=f=>f==='jpeg'?'image/jpeg':'image/png';
  function captureArgs(a,defW,defH){
    const w=a.width===undefined?defW:a.width, h=a.height===undefined?defH:a.height;
    if(!finite(w)||!finite(h)||w<16||h<16||w>4096||h>4096) return {error:'width and height must be from 16 to 4096 pixels.'};
    if(a.format!==undefined&&a.format!=='png'&&a.format!=='jpeg') return {error:"format must be 'png' or 'jpeg'."};
    const q=a.quality===undefined?0.85:a.quality;
    if(!finite(q)||q<0.1||q>1) return {error:'quality must be from 0.1 to 1.'};
    return {w:Math.round(w),h:Math.round(h),format:a.format||'png',q};
  }
  function frameTimes(a){
    if(!anim) return {error:'Frames need an animation. Send animate first.'};
    if(a.at!==undefined){
      if(!Array.isArray(a.at)||!a.at.length||a.at.length>400||!a.at.every(finite)) return {error:'at must be a list of up to 400 times in seconds.'};
      return {times:a.at.map(t=>Math.max(0,Math.min(anim.duration,t)))};
    }
    const n=a.count===undefined?12:a.count;
    if(!Number.isInteger(n)||n<1||n>400) return {error:'count must be a whole number from 1 to 400.'};
    return {times:Anim.evenTimes(anim.duration,n)};
  }
  // Render each time and hand the frame to use(); the live pose and camera are put back afterward,
  // all in one task, so the person never sees the jumps.
  function atTimes(times,use){
    const keepT=anim.t, keepView=viewDeg(), onFrame=anim.onFrame; anim.onFrame=null;
    try{ times.forEach((t,k)=>{ applyFrame(t); use(k,t); }); }
    finally{
      applyFrame(keepT,false);
      view.yaw=keepView.yaw*PI/180; view.pitch=keepView.pitch*PI/180; view.zoom=keepView.zoom; view.pan=keepView.pan;
      anim.onFrame=onFrame; render();
    }
  }
  function capture(a){
    if(!glCanvas()) return 'Capturing needs WebGL on the model screen.';
    if(!['still','frames','sheet'].includes(a.mode)) return "mode must be 'still', 'frames' or 'sheet'.";
    const id=typeof a.id==='string'?a.id.slice(0,80):'cap'+Date.now().toString(36);
    if(a.mode==='still'){
      const o=captureArgs(a,640,400); if(o.error) return o.error;
      const c=document.createElement('canvas'); c.width=o.w; c.height=o.h;
      render(); drawInto(c.getContext('2d'),0,0,o.w,o.h);
      sendBig({t:'capture',id,mode:'still',images:[c.toDataURL(mime(o.format),o.q)],times:[anim?anim.t:0],width:o.w,height:o.h});
      return;
    }
    const ft=frameTimes(a); if(ft.error) return ft.error;
    if(a.mode==='frames'){
      const o=captureArgs(a,640,400); if(o.error) return o.error;
      const c=document.createElement('canvas'); c.width=o.w; c.height=o.h; const ctx=c.getContext('2d'), images=[];
      atTimes(ft.times,()=>{ drawInto(ctx,0,0,o.w,o.h); images.push(c.toDataURL(mime(o.format),o.q)); });
      sendBig({t:'capture',id,mode:'frames',images,times:ft.times,width:o.w,height:o.h});
      return;
    }
    // sheet: a grid of frames, each labelled with its time; width/height set each cell
    const o=captureArgs(a,320,200); if(o.error) return o.error;
    const n=ft.times.length, cols=Math.min(n,Math.max(1,Math.ceil(Math.sqrt(n)*1.25))), rows=Math.ceil(n/cols);
    let cw=o.w, ch=o.h;
    const shrink=Math.min(1,Math.sqrt(16e6/(cols*cw*rows*ch)));   // keep the sheet a sensible size
    cw=Math.max(64,Math.floor(cw*shrink)); ch=Math.max(40,Math.floor(ch*shrink));
    const c=document.createElement('canvas'); c.width=cols*cw; c.height=rows*ch; const ctx=c.getContext('2d');
    ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,c.width,c.height);
    atTimes(ft.times,(k,t)=>{
      const x=(k%cols)*cw, y=Math.floor(k/cols)*ch;
      drawInto(ctx,x,y,cw,ch);
      const label='#'+(k+1)+'  t = '+t.toFixed(2)+' s', fs=Math.max(11,Math.round(ch*0.075));
      ctx.font='600 '+fs+'px system-ui, sans-serif'; const tw=ctx.measureText(label).width;
      ctx.fillStyle='rgba(255,253,249,0.9)'; ctx.fillRect(x+4,y+4,tw+12,fs+8);
      ctx.fillStyle='#1f1d1a'; ctx.fillText(label,x+10,y+fs+6);
      ctx.strokeStyle='#d9d0c3'; ctx.lineWidth=1; ctx.strokeRect(x+0.5,y+0.5,cw-1,ch-1);
    });
    const send=q=>c.toDataURL(o.format==='jpeg'?'image/jpeg':'image/png',q);
    let img=send(o.q);
    if(img.length>Anim.LIMIT&&o.format==='png') img=c.toDataURL('image/jpeg',0.8);   // too big: fall back to JPEG
    sendBig({t:'capture',id,mode:'sheet',images:[img],times:ft.times,width:c.width,height:c.height,columns:cols,rows});
  }

  /* ---------- export: webm through MediaRecorder, or GIF from offscreen frames ---------- */
  let exporting=false;
  function exportAnim(a){
    if(!anim) return 'Exporting needs an animation. Send animate first.';
    if(exporting) return 'An export is already running.';
    if(!glCanvas()) return 'Exporting needs WebGL on the model screen.';
    if(a.format!=='webm'&&a.format!=='gif') return "format must be 'webm' or 'gif'.";
    const src=glCanvas(), aspect=src.width/src.height;
    const defW=a.format==='gif'?480:Math.min(1280,src.width), w0=a.width===undefined?defW:a.width;
    const h0=a.height===undefined?Math.round(w0/aspect):a.height;
    if(!finite(w0)||!finite(h0)||w0<16||h0<16||w0>1920||h0>1920) return 'width and height must be from 16 to 1920 pixels.';
    const fps=a.fps===undefined?(a.format==='gif'?15:30):a.fps;
    if(!finite(fps)||fps<1||fps>(a.format==='gif'?50:60)) return 'fps must be from 1 to '+(a.format==='gif'?50:60)+'.';
    const w=Math.round(w0)&~1, h=Math.round(h0)&~1, id=typeof a.id==='string'?a.id.slice(0,80):'exp'+Date.now().toString(36);
    const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d',{willReadFrequently:a.format==='gif'});
    exporting=true;
    const finish=(blob,ext)=>{
      exporting=false;
      const r=new FileReader();
      r.onload=()=>{ sendBig({t:'export',id,format:ext,data:r.result,bytes:blob.size,width:w,height:h,fps,duration:anim?anim.duration:0}); };
      r.readAsDataURL(blob);
      showDownload(blob,'boxsmith-animation.'+ext);
    };
    if(a.format==='gif'){
      const times=[]; for(let t=0;t<=anim.duration+1e-9&&times.length<900;t+=1/fps) times.push(t);
      const frames=[]; let k=0;
      const step=()=>{   // a few frames per task, so the page stays responsive
        const batch=times.slice(k,k+8); k+=batch.length;
        atTimes(batch,()=>{ drawInto(ctx,0,0,w,h); frames.push(ctx.getImageData(0,0,w,h).data); });
        if(k<times.length) return setTimeout(step,0);
        try{ finish(new Blob([Anim.encodeGIF(frames,w,h,Math.max(2,Math.round(100/fps)))],{type:'image/gif'}),'gif'); }
        catch(err){ exporting=false; note('export: the GIF could not be made: '+err.message); }
      };
      setTimeout(step,0);
      return;
    }
    if(typeof MediaRecorder==='undefined'||!c.captureStream){ exporting=false; return 'This browser cannot record video. Try format "gif".'; }
    const type=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!type){ exporting=false; return 'This browser cannot record WebM. Try format "gif".'; }
    const rec=new MediaRecorder(c.captureStream(fps),{mimeType:type,videoBitsPerSecond:4e6}), chunks=[];
    rec.ondataavailable=e=>{ if(e.data&&e.data.size) chunks.push(e.data); };
    rec.onstop=()=>{ anim&&(anim.onFrame=null); finish(new Blob(chunks,{type:'video/webm'}),'webm'); };
    const keepLoop=anim.loop; anim.loop=false;
    anim.onFrame=()=>drawInto(ctx,0,0,w,h);       // every played frame is copied into the recording
    anim.onDone=()=>{ anim.loop=keepLoop; setTimeout(()=>rec.stop(),Math.max(120,2000/fps)); };
    anim.t=0; rec.start(250); playAnim();
  }
  // Import animation (host): read the file, warn before replacing the open layout, load with a
  // loading indicator (big files take a few seconds), then play.
  function importAnimationFile(file){
    if(!file) return;
    if(/\.zip$/i.test(file.name)||/zip/.test(file.type)) return openLibrary(file);
    const busy=document.createElement('div'); busy.className='anim-loading'; busy.innerHTML='<span>Loading animation…</span>'; document.body.appendChild(busy);
    const done=msg=>{ busy.remove(); if(msg){ toast(msg); } };
    file.text().then(text=>{
      const found=animationFromFile(text);
      if(found.error) return done(found.error);
      const a=found.args;
      if(a.base&&layoutBoxes.length&&!confirm('This animation comes with its own layout ('+(a.base.boxes?a.base.boxes.length:'?')+' boxes), which will replace the '+layoutBoxes.length+' boxes open now. Save your layout first if you want to keep it.\n\nReplace it and play?')) return done();
      busy.firstChild.textContent='Building '+(a.base&&a.base.boxes?a.base.boxes.length+' boxes':'the animation')+'…';
      setTimeout(()=>{   // let the indicator paint before the heavy work
        let err; try{ err=runCmd('animate',a); }catch(e){ err=e.message; }
        done(err?'Could not play '+file.name+': '+err:null);
        if(!err&&anim){ anim.name=file.name.replace(/\.json$/i,''); renderAnimBar(); }
        sendState(true);
      },60);
    }).catch(err=>done('Could not read that file: '+err.message));
  }
  /* ---------- animation library (a zip of animations, designs and videos) ---------- */
  let library=null;   // {title, animations, designs, current, owns}
  function openLibrary(file){
    const busy=document.createElement('div'); busy.className='anim-loading'; busy.innerHTML='<span>Opening '+esc(file.name)+'…</span>'; document.body.appendChild(busy);
    file.arrayBuffer().then(buf=>Anim.readZip(buf)).then(files=>{
      const lib=Anim.buildLibrary(files,file.name);
      busy.remove();
      if(!lib.animations.length&&!lib.designs.length){ toast('No animations or designs found in '+file.name+'.'); return; }
      lib.animations.sort((a,b)=>a.name.localeCompare(b.name)); lib.designs.sort((a,b)=>a.name.localeCompare(b.name));
      for(const x of lib.animations) if(x.video) x.videoURL=URL.createObjectURL(new Blob([x.video.bytes],{type:/\.webm$/i.test(x.video.name)?'video/webm':/\.gif$/i.test(x.video.name)?'image/gif':'video/mp4'}));
      if(library) for(const x of library.animations) if(x.videoURL) URL.revokeObjectURL(x.videoURL);
      library=Object.assign(lib,{current:null,owns:false,hidden:false});
      renderLibrary(); sendState(true);
      toast(lib.animations.length+' animation'+(lib.animations.length===1?'':'s')+(lib.designs.length?' and '+lib.designs.length+' design'+(lib.designs.length===1?'':'s'):'')+' ready to play');
    }).catch(err=>{ busy.remove(); toast('Could not open '+file.name+': '+err.message); });
  }
  // Ask once before a library item replaces a layout the library did not load.
  function libraryMayReplace(count){
    if(library.owns||!layoutBoxes.length) return true;
    return confirm('Playing from the library replaces the '+layoutBoxes.length+' boxes open now with '+(count?count+' boxes':'its own layout')+'. Save your layout first if you want to keep it.\n\nGo ahead?');
  }
  // kind: 'animation' or 'design'. fromRemote skips the question (the model screen's owner already has the library open).
  function playLibrary(kind,index,fromRemote){
    if(!library) return 'No library is open. Import a zip of animations first.';
    const list=kind==='design'?library.designs:library.animations, item=list[index];
    if(!item) return 'There is no '+kind+' '+index+' in the library.';
    if(!fromRemote&&!libraryMayReplace(item.boxes)) return;
    const busy=document.createElement('div'); busy.className='anim-loading'; busy.innerHTML='<span>Loading '+esc(item.name)+'…</span>'; document.body.appendChild(busy);
    return new Promise(done=>setTimeout(()=>{
      let err=null;
      try{
        if(kind==='design'){ stopAnim(true); openBoxLayout(item.json); }
        else { err=runCmd('animate',item.args); if(!err&&anim) anim.name=item.name; }
      }catch(e){ err=e.message; }
      busy.remove();
      if(err) toast('Could not play '+item.name+': '+err); else { library.owns=true; library.current=kind+':'+index; }
      renderLibrary(); renderAnimBar(); sendState(true); done(err);
    },60));
  }
  function showLibraryVideo(index){
    const item=library&&library.animations[index]; if(!item||!item.videoURL) return;
    const m=document.createElement('div'); m.className='lib-video';
    m.innerHTML='<div>'+(/\.gif$/i.test(item.video.name)?'<img src="'+item.videoURL+'" alt="" style="max-width:100%;max-height:78vh">':'<video src="'+item.videoURL+'" controls autoplay playsinline></video>')+'<p><span>'+esc(item.name)+' · video</span><button type="button" class="btn">Close</button></p></div>';
    const close=()=>m.remove();
    m.addEventListener('click',e=>{ if(e.target===m||e.target.closest('button')) close(); });
    document.body.appendChild(m);
  }
  function renderLibrary(){
    let p=$('#animLib');
    const btn=$('#animLibBtn'); if(btn) btn.hidden=!library;
    if(!library||library.hidden){ if(p) p.remove(); return; }
    if(!p){
      p=document.createElement('div'); p.id='animLib'; p.className='anim-lib'; document.body.appendChild(p);
      p.addEventListener('click',e=>{
        const b=e.target.closest('button'); if(!b) return;
        if(b.dataset.lib==='close'){ library.hidden=true; renderLibrary(); return; }
        if(b.dataset.play!==undefined){ if(library.owns||!layoutBoxes.length) goFullscreen(); playLibrary('animation',+b.dataset.play); }
        if(b.dataset.open!==undefined) playLibrary('design',+b.dataset.open);
        if(b.dataset.video!==undefined) showLibraryVideo(+b.dataset.video);
      });
    }
    const meta=x=>[x.duration!==undefined?x.duration.toFixed(1)+' s':'',x.boxes?x.boxes+' boxes':''].filter(Boolean).join(' · ');
    const playing=k=>library.current===k&&anim&&anim.playing;
    p.innerHTML='<header><b>📚 '+esc(library.title)+'</b><button type="button" class="btn" data-lib="close" aria-label="Hide the library">✕</button></header>'+
      (library.animations.length?'<h5>Animations</h5>'+library.animations.map((x,i)=>'<div class="lib-row'+(library.current==='animation:'+i?' on':'')+'"><span class="lib-name"><b>'+esc(x.name)+'</b><small>'+esc(meta(x))+'</small></span>'+
        '<button type="button" class="btn primary" data-play="'+i+'">'+(playing('animation:'+i)?'↻ Restart':'▶ Play')+'</button>'+(x.videoURL?'<button type="button" class="btn" data-video="'+i+'" title="Watch the recorded video">🎬</button>':'')+'</div>').join(''):'')+
      (library.designs.length?'<h5>Designs</h5>'+library.designs.map((x,i)=>'<div class="lib-row'+(library.current==='design:'+i?' on':'')+'"><span class="lib-name"><b>'+esc(x.name)+'</b><small>'+esc(x.boxes+' boxes')+'</small></span><button type="button" class="btn" data-open="'+i+'">Open</button></div>').join(''):'');
  }

  // Playback bar on the model screen, shown while an animation is loaded.
  let barRaf=0;
  function renderAnimBar(){
    if(library&&!library.hidden&&$('#animLib')){ const k=library.current, on=!!(anim&&anim.playing); if(renderAnimBar._k!==k+on){ renderAnimBar._k=k+on; renderLibrary(); } }
    let bar=$('#animBar');
    if(!anim){ if(bar) bar.remove(); return; }
    if(!bar){
      bar=document.createElement('div'); bar.id='animBar'; bar.className='anim-bar';
      bar.innerHTML='<span class="anim-name"></span><button type="button" class="btn" data-ab="play"></button><button type="button" class="btn" data-ab="stop" title="Back to the start">■</button>'+
        '<input type="range" min="0" step="0.01" aria-label="Animation time"><span class="anim-time"></span><button type="button" class="btn" data-ab="close" aria-label="Close animation" title="Stop and close">✕</button>';
      document.body.appendChild(bar);
      bar.addEventListener('click',e=>{
        const b=e.target.closest('[data-ab]'); if(!b||!anim) return;
        if(b.dataset.ab==='play'){ if(anim.playing) pauseAnim(); else { goFullscreen(); playAnim(); } }
        else if(b.dataset.ab==='stop') stopAnim(false);
        else if(b.dataset.ab==='close') stopAnim(true);
        sendState(true); renderAnimBar();
      });
      bar.querySelector('input').addEventListener('input',e=>{ if(anim){ seekAnim(+e.target.value); renderAnimBar(); } });
    }
    bar.querySelector('.anim-name').textContent=anim.name||'Animation';
    bar.querySelector('[data-ab=play]').textContent=anim.playing?'❚❚ Pause':'▶ Play';
    const r=bar.querySelector('input'); r.max=anim.duration; if(document.activeElement!==r) r.value=anim.t;
    bar.querySelector('.anim-time').textContent=anim.t.toFixed(2)+' / '+anim.duration.toFixed(2)+' s';
  }
  function showDownload(blob,name){
    let bar=$('#remoteDownload');
    if(!bar){ bar=document.createElement('div'); bar.id='remoteDownload'; bar.className='remote-download'; document.body.appendChild(bar); }
    const url=URL.createObjectURL(blob);
    bar.innerHTML='<span>Animation ready ('+esc(name.split('.').pop().toUpperCase())+', '+(blob.size/1048576).toFixed(1)+' MB)</span><a class="btn primary" download="'+esc(name)+'" href="'+url+'">Download</a><button type="button" class="btn" aria-label="Close">✕</button>';
    bar.querySelector('button').onclick=()=>{ bar.remove(); URL.revokeObjectURL(url); };
  }
  function renderHostStatus(){
    const el=$('#remoteHostStatus'); if(!el||!host) return;
    const r=host.relay, linked=remotes>0||localPeer;
    el.textContent=linked?'Remote connected. Tap boxes here; edit them there.':
      r==='relay'?'Waiting for the remote…':r.startsWith('error:')?r.slice(6):
      'Waiting for the remote… (other devices need the relay, which may take a few seconds to wake)';
    $('#remoteBtn')?.classList.toggle('on',linked);
  }

  /* ---------- dialog on a normal screen: show a code, or become a remote ---------- */
  function renderDialog(){
    const d=$('#remoteDialog'); if(!d) return;
    const link=location.origin+location.pathname+'?remote='+hostCode;
    d.innerHTML=host?
      '<h3>Remote is on</h3><p>On the other screen, open Boxsmith, go to <b>Arrange boxes</b>, tap <b>📱 Remote</b> then <b>Use this screen as the remote</b>, and enter</p>'+
      '<div class="remote-code">'+fmtCode(hostCode)+'</div><p class="remote-small">or open <a href="'+esc(link)+'" target="_blank" rel="noopener">'+esc(link)+'</a></p>'+
      '<p id="remoteHostStatus" class="remote-small"></p><div class="remote-row"><button type="button" class="btn" data-r="stop">Stop remote</button><button type="button" class="btn primary" data-r="close">Done</button></div>':
      '<h3>Two-screen editing</h3><p>Show the model on this screen and edit it from another screen, such as an iPad: placement, color, every box setting and the layout.</p>'+
      '<div class="remote-row"><button type="button" class="btn primary" data-r="host">Show a code here</button><button type="button" class="btn" data-r="join">Use this screen as the remote</button></div>'+
      '<div class="remote-row"><button type="button" class="btn" data-r="close">Cancel</button></div>';
    renderHostStatus();
  }
  function openDialog(){ $('#remoteDialog').hidden=false; renderDialog(); }
  function closeDialog(){ $('#remoteDialog').hidden=true; }

  /* ---------- remote: the control screen ---------- */
  let link=null, st=null, joinedCode='', helloTimer=null, removeArmed=0, clearArmed=0, tab='place', shots=[];
  // Box design editing uses this page's own sidebar: the selected box's design is loaded into S,
  // and every change is sent back. The remote's own saved design is put back on exit.
  let ownS=null, designFor=-1, designKey='', applying=false, lastSent='', sendTimer=null;
  function loadDesign(settings){
    applying=true;
    try{ S=Object.assign({},DEFAULTS,JSON.parse(JSON.stringify(settings))); update(true); }
    finally{ applying=false; }
    lastSent=full(S);
  }
  function designChanged(){
    if(applying||!link||!st||st.sel<0||designFor!==st.sel) return;
    const j=full(S);
    if(j===lastSent) return;
    lastSent=j;
    const index=st.sel, copy=JSON.parse(JSON.stringify(S));
    clearTimeout(sendTimer);
    sendTimer=setTimeout(()=>cmd('design',{index,settings:copy}),250);
  }
  function remoteMode(code){
    if(!ownS){ ownS=JSON.parse(JSON.stringify(S)); window.BOX=Object.assign({},window.BOX,{noSave:true}); }
    const panel=$('#remotePanel'); document.body.insertBefore(panel,document.body.firstChild);
    document.body.classList.add('remote-mode');
    closeDialog();
    $('#remotePanel').hidden=false;
    renderRemote();
    if(code) remoteJoin(code);
  }
  function remoteJoin(code){
    code=String(code).replace(/\D/g,'');
    if(code.length!==6){ setRemoteStatus('Enter the 6-digit code shown on the model screen.'); return; }
    if(link) link.close();
    joinedCode=code; st=null;
    setRemoteStatus('Connecting…');
    link=Link(code,'remote',remoteMessage,s=>{
      if(st) return;
      setRemoteStatus(s==='nohost'?'No model screen is using that code. Check the code, or ask for a new one.':
        s.startsWith('error:')?s.slice(6):s==='relay'?'Connected. Waiting for the model screen…':'Connecting… (the relay can take a few seconds to wake)');
    });
    clearInterval(helloTimer);
    const hello=()=>{ if(!st) link.send({t:'hello'}); else clearInterval(helloTimer); };
    hello(); helloTimer=setInterval(hello,1500);
    renderRemote();
  }
  function remoteLeave(){ if(link) link.close(); link=null; st=null; joinedCode=''; designFor=-1; designKey=''; clearInterval(helloTimer); document.body.classList.remove('rm-design'); renderRemote(); }
  function remoteMessage(msg){
    if(msg.t==='state'){
      const prev=st; st=msg;
      if(msg.design&&(msg.sel!==designFor||msg.designKey!==designKey)){ designFor=msg.sel; designKey=msg.designKey; if(full(msg.design)!==lastSent) loadDesign(msg.design); }
      else if(msg.sel!==designFor&&msg.sel>=0&&!msg.design&&link){ link.send({t:'hello'}); }   // ask again for this box's design
      if(msg.sel<0) designFor=-1;
      if(prev&&prev.boxCount!==msg.boxCount) clearArmed=0;
      renderRemote(); return;
    }
    if(msg.t==='note'){ setRemoteStatus(msg.text); return; }
    if(msg.t==='anim'){ setRemoteStatus(msg.state==='playing'?'Animation playing…':'Animation finished.'); return; }
    if(msg.t==='capture'){ shots.unshift(...msg.images.map((src,k)=>({src,label:(msg.mode==='sheet'?'Contact sheet':msg.mode==='still'?'View':'t = '+(+msg.times[k]).toFixed(2)+' s')+(msg.of>1?' ('+msg.part+'/'+msg.of+')':''),name:'boxsmith-'+msg.mode+'-'+(k+1)+(src.startsWith('data:image/jpeg')?'.jpg':'.png')}))); shots=shots.slice(0,24); renderRemote(); setRemoteStatus('Capture received.'); return; }
    if(msg.t==='export'){ shots.unshift({src:msg.data,label:'Recording ('+msg.format.toUpperCase()+', '+(msg.bytes/1048576).toFixed(1)+' MB)',name:'boxsmith-animation.'+msg.format,video:msg.format==='webm'}); renderRemote(); setRemoteStatus('Recording received.'); return; }
    if(msg.t==='hostgone'||msg.t==='bye'){ st=null; renderRemote(); setRemoteStatus('The model screen stopped the session.'); return; }
    if(msg.t==='hostback'&&link){ link.send({t:'hello'}); }
  }
  const cmd=(op,args)=>{ if(link) link.send({t:'cmd',op,args}); };
  function setRemoteStatus(text){ const el=$('#remoteStatus'); if(el) el.textContent=text; }

  const STEPS=[['0:-1','← Left'],['0:1','Right →'],['2:1','↑ Up'],['2:-1','↓ Down'],['1:1','In ↗'],['1:-1','↙ Out']];
  const TURNS=[['z:-90','⟲ 90°'],['z:90','⟳ 90°'],['x:90','Tip X'],['y:90','Tip Y'],['reset','Reset']];
  function renderRemote(){
    const p=$('#remotePanel'); if(!p) return;
    const head='<header class="rm-head"><b>Boxsmith remote</b>'+(joinedCode?'<span class="rm-code">'+fmtCode(joinedCode)+'</span>':'')+
      '<span class="rm-sp"></span>'+(link?'<button type="button" class="btn" data-rm="leave">Disconnect</button>':'')+
      '<button type="button" class="btn" data-rm="exit">Back to Boxsmith</button></header><p id="remoteStatus" class="rm-status"></p>';
    if(!st){
      p.innerHTML=head+'<section class="rm-join"><label for="rmCode">Code from the model screen</label>'+
        '<input id="rmCode" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="123 456" value="'+(joinedCode?fmtCode(joinedCode):'')+'">'+
        '<button type="button" class="btn primary" data-rm="join">Connect</button></section>';
      if(!link) setRemoteStatus('On the screen showing the model, open Arrange boxes and tap 📱 Remote → Show a code here.');
      return;
    }
    const tabs='<nav class="rm-tabs">'+[['place','Place & color'],['design','Box design'],['layout','Layout & view']].map(([k,l])=>'<button type="button" class="btn'+(tab===k?' on':'')+'" data-rm-tab="'+k+'">'+l+'</button>').join('')+'</nav>';
    document.body.classList.toggle('rm-design',tab==='design');
    const box=st.boxes[st.sel], u=st.unit, sc=st.scale||1, dis=box?'':' disabled';
    const boxPick='<div class="rm-row"><select data-rm="select" class="rm-grow">'+'<option value="-1"'+(st.sel<0?' selected':'')+'>Select a box</option>'+
      st.boxes.map((b,i)=>'<option value="'+i+'"'+(i===st.sel?' selected':'')+'>'+esc((b.clash?'⚠ ':'')+(b.hidden?'(hidden) ':'')+b.label)+'</option>').join('')+'</select></div>';
    if(tab==='design'){
      p.innerHTML=head+tabs+'<section><h4>Box to design</h4>'+boxPick+
        '<p class="rm-small">'+(box&&designFor===st.sel?'Every change below updates '+esc(box.label)+' on the model screen. Its place, turn, material and colors stay as they are.':box?'Loading this box’s design…':'Select a box to change its design, or set up a design below and add it as a new box.')+'</p>'+
        '<div class="rm-row"><button type="button" class="btn" data-rm="adddesign">Add this design as a new box</button></div></section>';
      setRemoteStatus(st.status||''); return;
    }
    if(tab==='layout'){
      p.innerHTML=head+tabs+
        '<section><h4>View</h4><div class="rm-row"><button type="button" class="btn" data-rm="fit">Fit layout</button><button type="button" class="btn" data-rm="top">Top view</button>'+
        '<button type="button" class="btn'+(st.placing?' on':'')+'" data-rm="place"'+dis+'>'+(st.placing?'Placing: tap the model screen…':'Place in top view')+'</button>'+
        '<button type="button" class="btn'+(st.maximized?' on':'')+'" data-rm="max">'+(st.maximized?'✕ Exit maximize':'⤢ Maximize')+'</button></div>'+
        '<div class="rm-row"><label>Viewing <select data-rm="stereo">'+[['off','Normal view'],['cross','Stereo · cross-eyed'],['parallel','Stereo · parallel']].map(([v,l])=>'<option value="'+v+'"'+(st.stereo===v?' selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
        '<label>Units <select data-rm="units"><option value="mm"'+(u==='mm'?' selected':'')+'>mm</option><option value="in"'+(u==='in'?' selected':'')+'>in</option></select></label></div></section>'+
        '<section><h4>Layout file</h4><div class="rm-row"><button type="button" class="btn" data-rm="save">Save layout (downloads on the model screen)</button>'+
        '<button type="button" class="btn" data-rm="openfile">Open a layout file from this device</button><input type="file" id="rmFile" accept=".json,application/json" hidden>'+
        '<button type="button" class="btn" data-rm="animfile">Import an animation from this device</button><input type="file" id="rmAnimFile" accept=".json,application/json" hidden></div>'+
        '<div class="rm-row"><button type="button" class="btn rm-danger" data-rm="clear"'+(st.boxCount?'':' disabled')+'>'+(clearArmed>Date.now()?'Tap again to clear every box':'Clear all boxes')+'</button></div></section>'+
        (st.library?'<section><h4>Library · '+esc(st.library.title)+'</h4>'+
          st.library.animations.map((x,i)=>'<div class="rm-row"><span class="rm-grow"><b>'+esc(x.name)+'</b> <small class="rm-small">'+x.duration.toFixed(1)+' s'+(x.boxes?' · '+x.boxes+' boxes':'')+'</small></span><button type="button" class="btn'+(st.library.current==='animation:'+i?' on':'')+'" data-rm-lib="animation:'+i+'">▶ Play</button></div>').join('')+
          st.library.designs.map((x,i)=>'<div class="rm-row"><span class="rm-grow"><b>'+esc(x.name)+'</b> <small class="rm-small">design · '+x.boxes+' boxes</small></span><button type="button" class="btn'+(st.library.current==='design:'+i?' on':'')+'" data-rm-lib="design:'+i+'">Open</button></div>').join('')+'</section>':'')+
        '<section><h4>Animation</h4>'+(st.anim?'<p class="rm-small">'+(st.anim.playing?'Playing':'Paused')+' at '+st.anim.t.toFixed(2)+' of '+st.anim.duration.toFixed(2)+' s'+(st.exporting?' · recording…':'')+'</p>':'<p class="rm-small">No animation loaded. Animations are sent with the animate command (see the API guide).</p>')+
        '<div class="rm-row"><button type="button" class="btn" data-rm-anim="play"'+(st.anim?'':' disabled')+'>▶ Play</button><button type="button" class="btn" data-rm-anim="pause"'+(st.anim?'':' disabled')+'>❚❚ Pause</button><button type="button" class="btn" data-rm-anim="stop"'+(st.anim?'':' disabled')+'>■ Stop</button></div>'+
        '<div class="rm-row"><button type="button" class="btn" data-rm-cap="still">Capture view</button><button type="button" class="btn" data-rm-cap="sheet"'+(st.anim?'':' disabled')+'>Contact sheet (12 frames)</button>'+
        '<button type="button" class="btn" data-rm-exp="webm"'+(st.anim&&!st.exporting?'':' disabled')+'>Record WebM</button><button type="button" class="btn" data-rm-exp="gif"'+(st.anim&&!st.exporting?'':' disabled')+'>Record GIF</button></div>'+
        (shots.length?'<div class="rm-shots">'+shots.map(x=>'<figure>'+(x.video?'<video src="'+x.src+'" controls muted playsinline style="width:100%"></video>':'<img src="'+x.src+'" alt="">')+'<figcaption>'+esc(x.label)+' · <a download="'+esc(x.name)+'" href="'+x.src+'">Save</a></figcaption></figure>').join('')+'</div>':'')+'</section>';
      setRemoteStatus(st.status||''); return;
    }
    const num=(v,isAngle)=>isAngle?+(+v).toFixed(2):+(v/sc).toFixed(u==='in'?3:1);
    const opt=(v,l,on)=>'<option value="'+esc(v)+'"'+(on?' selected':'')+'>'+esc(l)+'</option>';
    const key=st.part||'*', colors=box?box.colors:{}, own=colors[key];
    const shown=own||(st.part&&st.part!=='acrylic'?colors.acrylic||colors['*']:colors['*'])||'#4da3ff';
    p.innerHTML=head+tabs+
      '<section><h4>Box</h4>'+boxPick+
        '<div class="rm-row"><button type="button" class="btn" data-rm="dup"'+dis+'>Duplicate</button><button type="button" class="btn" data-rm="dupin"'+dis+'>Duplicate in place</button>'+
        '<button type="button" class="btn" data-rm="hide"'+dis+'>'+(box&&box.hidden?'Show box':'Hide box')+'</button>'+
        '<button type="button" class="btn rm-danger" data-rm="remove"'+dis+'>'+(removeArmed>Date.now()?'Tap again to remove':'Remove')+'</button></div></section>'+
      '<section><h4>Position <small>('+esc(u)+')</small></h4><div class="rm-row">'+['X','Y','Z'].map((a,k)=>'<label>'+a+' <input type="number" step="any" data-rm-set="'+k+'" value="'+(box?num(box.position[k]):'')+'"'+dis+'></label>').join('')+'</div>'+
        '<h4>Step one box</h4><div class="rm-row rm-grid3">'+STEPS.map(([k,l])=>'<button type="button" class="btn" data-rm-step="'+k+'"'+dis+'>'+l+'</button>').join('')+'</div></section>'+
      '<section><h4>Turn <small>(°)</small></h4><div class="rm-row">'+['X','Y','Z'].map((a,k)=>'<label>'+a+' <input type="number" step="any" data-rm-rot="'+k+'" value="'+(box?num(box.rotation[k],true):'')+'"'+dis+'></label>').join('')+'</div>'+
        '<div class="rm-row">'+TURNS.map(([k,l])=>'<button type="button" class="btn" data-rm-turn="'+k+'"'+dis+'>'+l+'</button>').join('')+'</div></section>'+
      '<section><h4>Snap to</h4><div class="rm-row"><select data-rm="snapto" class="rm-grow"'+dis+'>'+st.boxes.map((b,i)=>i===st.sel?'':opt(i,b.label,false)).join('')+'</select>'+
        '<select data-rm="snapside"'+dis+'>'+st.sides.map(([v,l])=>opt(v,l,false)).join('')+'</select>'+
        '<label>gap <input type="number" step="any" min="0" value="0" data-rm="snapgap"'+dis+'></label><button type="button" class="btn primary" data-rm="snap"'+dis+'>Snap</button></div></section>'+
      '<section><h4>Color</h4><div class="rm-row"><select data-rm="part" class="rm-grow"'+dis+'>'+opt('','Whole box',!st.part)+(st.acrylic?opt('acrylic','All acrylic parts',st.part==='acrylic'):'')+
        st.parts.map(n=>opt(n,'Part: '+n,st.part===n)).join('')+'</select>'+
        '<input type="color" data-rm="color" class="rm-color" value="'+esc(shown)+'"'+dis+'>'+
        '<button type="button" class="btn" data-rm="nocolor"'+(own?'':' disabled')+'>No color</button></div>'+
        '<p class="rm-small">Tap a box on the model screen to select it; tap it again to pick one part.</p></section>'+
      '<section><h4>View</h4><div class="rm-row"><button type="button" class="btn" data-rm="fit">Fit</button><button type="button" class="btn" data-rm="top">Top view</button></div></section>';
    setRemoteStatus(st.status||'');
  }
  function remoteEvents(){
    const p=$('#remotePanel');
    p.addEventListener('click',e=>{
      const b=e.target.closest('button'); if(!b||b.disabled) return;
      const r=b.dataset.rm;
      if(r==='join') return remoteJoin($('#rmCode').value);
      if(r==='leave') return remoteLeave();
      if(r==='exit'){ remoteLeave(); document.body.classList.remove('remote-mode','rm-design'); p.hidden=true; history.replaceState(null,'',location.pathname);
        if(ownS){ if(window.BOX) window.BOX.noSave=false; S=ownS; ownS=null; designFor=-1; update(true); } return; }
      if(b.dataset.rmTab){ tab=b.dataset.rmTab; renderRemote(); return; }
      if(r==='adddesign') return cmd('add',{settings:JSON.parse(JSON.stringify(S))});
      if(r==='place') return cmd('place',{});
      if(r==='max') return cmd('maximize',{});
      if(r==='save') return cmd('save',{});
      if(r==='openfile') return p.querySelector('#rmFile').click();
      if(r==='animfile') return p.querySelector('#rmAnimFile').click();
      if(r==='clear'){ if(clearArmed>Date.now()){ clearArmed=0; cmd('clear',{}); } else { clearArmed=Date.now()+4000; renderRemote(); setTimeout(renderRemote,4100); } return; }
      if(r==='dup') return cmd('dup',{});
      if(r==='dupin') return cmd('dup',{inPlace:true});
      if(r==='hide') return cmd('hide',{});
      if(r==='remove'){ if(removeArmed>Date.now()){ removeArmed=0; cmd('remove',{}); } else { removeArmed=Date.now()+4000; renderRemote(); setTimeout(renderRemote,4100); } return; }
      if(r==='snap') return cmd('snap',{to:+p.querySelector('[data-rm=snapto]').value,side:p.querySelector('[data-rm=snapside]').value,gap:+p.querySelector('[data-rm=snapgap]').value||0});
      if(r==='nocolor') return cmd('nocolor',{});
      if(r==='fit'||r==='top') return cmd(r,{});
      if(b.dataset.rmStep) return cmd('step',{key:b.dataset.rmStep});
      if(b.dataset.rmAnim) return cmd(b.dataset.rmAnim,{});
      if(b.dataset.rmLib){ const [kind,i]=b.dataset.rmLib.split(':'); return cmd('library',{kind,index:+i}); }
      if(b.dataset.rmCap) return cmd('capture',b.dataset.rmCap==='sheet'?{mode:'sheet',count:12}:{mode:'still'});
      if(b.dataset.rmExp) return cmd('export',{format:b.dataset.rmExp});
      if(b.dataset.rmTurn) return cmd('turn',{kind:b.dataset.rmTurn});
    });
    p.addEventListener('change',e=>{
      const t=e.target;
      if(t.dataset.rm==='select') return cmd('select',{index:+t.value});
      if(t.dataset.rm==='part') return cmd('part',{name:t.value||null});
      if(t.dataset.rm==='color') return cmd('color',{hex:t.value,final:true});
      if(t.dataset.rm==='units') return cmd('units',{unit:t.value});
      if(t.dataset.rm==='stereo') return cmd('stereo',{mode:t.value});
      if(t.id==='rmAnimFile'&&t.files[0]){ const f=t.files[0]; t.value=''; f.text().then(text=>{ const found=animationFromFile(text); if(found.error) return setRemoteStatus(found.error); setRemoteStatus('Sending '+f.name+' to the model screen…'); cmd('animate',found.args); }); return; }
      if(t.id==='rmFile'&&t.files[0]){ const f=t.files[0]; f.text().then(json=>{ cmd('open',{json}); setRemoteStatus('Sent '+f.name+' to the model screen.'); }); t.value=''; return; }
      if(t.dataset.rmSet!==undefined&&t.value!=='') return cmd('set',{k:+t.dataset.rmSet,value:+t.value});
      if(t.dataset.rmRot!==undefined&&t.value!=='') return cmd('set',{rot:true,k:+t.dataset.rmRot,value:+t.value});
    });
    let live=0;
    p.addEventListener('input',e=>{ if(e.target.dataset.rm==='color'){ const now=Date.now(); if(now-live>60){ live=now; cmd('color',{hex:e.target.value,final:false}); } } });
    p.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.id==='rmCode') remoteJoin(e.target.value); });
  }
  // keep what the user is typing: re-rendering is skipped while a field on the remote has focus
  const baseRender=renderRemote;
  renderRemote=function(){
    const a=document.activeElement, p=$('#remotePanel');
    if(st&&p&&a&&p.contains(a)&&a.matches('input[type=number],input:not([type]),select')&&a.dataset.rm!=='select'){ setTimeout(renderRemote,400); return; }
    baseRender();
  };

  function init(){
    if(!$('#remoteBtn')) return;
    $('#remoteBtn').addEventListener('click',()=>{ const d=$('#remoteDialog'); if(d.hidden) openDialog(); else closeDialog(); });
    $('#remoteDialog').addEventListener('click',e=>{
      const r=e.target.closest('[data-r]')?.dataset.r;
      if(r==='host') hostStart();
      else if(r==='stop') hostStop();
      else if(r==='close') closeDialog();
      else if(r==='join') remoteMode('');
    });
    remoteEvents();
    $('#animImport').addEventListener('click',()=>$('#animFile').click());
    for(const type of ['pointerdown','touchstart']) window.addEventListener(type,e=>{ if(cinema) stopFromCinema(e); },{capture:true,passive:false});
    for(const type of ['click','pointerup','mouseup','touchend']) window.addEventListener(type,e=>{ if(performance.now()<swallowClicksUntil){ e.preventDefault(); e.stopPropagation(); } },{capture:true,passive:false});
    window.addEventListener('keydown',e=>{ if(cinema&&(e.key==='Escape'||e.key===' '||e.key==='Spacebar')) stopFromCinema(e); },true);
    for(const type of ['fullscreenchange','webkitfullscreenchange']) document.addEventListener(type,()=>{ if(cinema&&fsByUs&&!fsElement()){ fsByUs=false; stopFromCinema(); } });
    $('#animLibBtn').addEventListener('click',()=>{ if(library){ library.hidden=!library.hidden; renderLibrary(); } });
    $('#animFile').addEventListener('change',e=>{ const f=e.target.files[0]; e.target.value=''; importAnimationFile(f); });
    // design edits on a remote's sidebar go to the model screen
    const upd=update;
    update=function(){ const out=upd.apply(this,arguments); if(document.body.classList.contains('remote-mode')) designChanged(); return out; };
    // every change on the host goes to the remote
    const sync=syncBoxLayout;
    syncBoxLayout=function(){ const out=sync.apply(this,arguments); if(host) sendState(); return out; };
    const q=new URLSearchParams(location.search);
    if(q.has('remote')) remoteMode(q.get('remote'));
    window.addEventListener('pagehide',()=>{ if(host) host.send({t:'bye'}); });
  }
  return {init,hostStart,hostStop,remoteMode,animationFromFile,importAnimationFile,playLibrary,get library(){ return library&&{title:library.title,current:library.current,animations:library.animations.map(x=>x.name),designs:library.designs.map(x=>x.name)}; },run:(op,args)=>{ let e; try{ e=op==='batch'?Anim.runBatch(args&&args.cmds,runCmd).errors.join(' '):runCmd(op,args||{}); }catch(err){ e=err.message; } sendState(true); return e||null; },get anim(){ return anim&&{playing:anim.playing,t:anim.t,duration:anim.duration}; },get code(){ return hostCode; }};
})();
Remote.init();
