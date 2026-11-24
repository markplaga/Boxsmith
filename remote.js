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
        if(msg.t==='error'&&msg.code){ onMessage({t:'relayError',code:msg.code,text:msg.msg||msg.code}); return; }   // a message was refused; the link is fine
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
      library:librarySummary(),
      recording:recording?{fps:recording.fps,width:recording.w,height:recording.h,seconds:recording.E?Math.round(recording.slot/recording.fps*10)/10:0}:null,
      view:viewDeg(),camera:typeof cameraInfo==='function'?cameraInfo():null,anim:anim?{playing:anim.playing,t:Math.round(anim.t*1000)/1000,duration:anim.duration,loop:anim.loop,soundtrack:anim.sound?{name:anim.sound.name,state:anim.sound.state,seconds:anim.sound.seconds,error:anim.sound.error}:null}:null,exporting,
      boxes:layoutBoxes.map((b,i)=>({label:layoutBoxLabel(b,i),hidden:!!b.hidden,clash:clash.has(i),position:b.position,rotation:b.rotation,colors:b.settings.colors||{}})),
      parts:partNames(box),acrylic:!!box&&boxHasAcrylic(box),
      sides:[...$('#layoutSnapSide').options].map(o=>[o.value,o.textContent]),
      status:$('#layoutStatus').textContent};
  }
  const librarySummary=()=>library?{title:library.title,current:library.current,animations:library.animations.map((x,index)=>({index,name:x.name,duration:x.duration,boxes:x.boxes})),designs:library.designs.map((x,index)=>({index,name:x.name,boxes:x.boxes}))}:null;
  function sendState(now){ clearTimeout(stateTimer); if(now===true){ if(host) host.send(state()); return; } stateTimer=setTimeout(()=>{ if(host) host.send(state()); },40); }
  const press=sel=>{ const el=$(sel); if(el&&!el.disabled&&!el.hidden) el.click(); };
  function hostMessage(msg){
    if(msg.t==='peers'){ remotes=msg.remotes; renderHostStatus(); return; }
    if(msg.t==='relayError'){ console.warn('Relay:',msg.text); return; }
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
        for(const f of ['yaw','pitch','zoom','fov']) if(a[f]!==undefined&&!finite(a[f])) return f+' must be a finite number.';
        if(a.pan!==undefined&&!(Array.isArray(a.pan)&&a.pan.length===3&&a.pan.every(finite))) return 'pan must be three finite numbers.';
        if(a.projection!==undefined&&a.projection!=='ortho'&&a.projection!=='perspective') return "projection must be 'ortho' or 'perspective'.";
        if(a.fov!==undefined&&(a.fov<5||a.fov>120)) return 'fov must be from 5 to 120 degrees.';
        if(a.projection!==undefined) view.projection=a.projection;
        if(a.fov!==undefined) view.fov=a.fov;
        if(a.projection!==undefined||a.fov!==undefined) syncProjectionControls();
        if(a.yaw!==undefined) view.yaw=a.yaw*PI/180;
        if(a.pitch!==undefined) view.pitch=Math.max(-90,Math.min(90,a.pitch))*PI/180;
        if(a.zoom!==undefined) view.zoom=Math.max(0.05,Math.min(20,a.zoom));
        if(a.pan!==undefined) view.pan=a.pan.slice();
        render(); return;
      }
      case 'frame': {
        let list;
        if(a.boxes===undefined||a.boxes==='all') list=layoutBoxes.filter(b=>!b.hidden);
        else if(Array.isArray(a.boxes)&&a.boxes.length&&a.boxes.every(i=>Number.isInteger(i)&&layoutBoxes[i])) list=a.boxes.map(i=>layoutBoxes[i]);
        else return "boxes must be 'all' or a list of box indexes from 0 to "+(layoutBoxes.length-1)+'.';
        for(const f of ['margin','yaw','pitch']) if(a[f]!==undefined&&!finite(a[f])) return f+' must be a finite number.';
        if(a.margin!==undefined&&(a.margin<0||a.margin>2)) return 'margin must be from 0 to 2.';
        if(!frameLayoutBoxes(list,{margin:a.margin===undefined?0.1:a.margin,yaw:a.yaw,pitch:a.pitch})) return 'Those boxes have nothing to frame.';
        return;
      }
      case 'save': press('#layoutSave'); return;
      case 'open': try{ stopAnim(true); openBoxLayout(a.json); }catch(err){ toast('That layout file could not be opened.'); return 'That layout file could not be opened: '+err.message; } return;
      case 'clear': stopAnim(true); if(layoutBoxes.length){ layoutBoxes=[]; rebuildBoxLayout(); saveBoxLayout(); selectLayoutBox(-1); toast('Layout cleared'); } return;
      case 'state': case 'hello': return;   // nothing to do: every command is answered with a fresh state
      case 'animate': return loadAnim(a);
      case 'play': return playAnim();
      case 'pause': if(!anim) return 'No animation is loaded.'; pauseAnim(); return;
      case 'stop': if(!anim) return 'No animation is loaded.'; stopAnim(false); return;
      case 'seek':
        if(!anim) return 'No animation is loaded.';
        if(!finite(a.t)) return 't must be a finite number of seconds.';
        seekAnim(a.t); return;
      case 'libraryPlay': return libraryOp('animation',a);
      case 'libraryLoadDesign': return libraryOp('design',a);
      case 'library':
        if(a.kind===undefined&&a.index===undefined){   // no arguments: just list what's in it
          if(host) host.send({t:'library',library:librarySummary()});
          return library?undefined:'No library is open. Import a zip of animations on the model screen first.';
        }
        if(a.kind!=='animation'&&a.kind!=='design') return "kind must be 'animation' or 'design'.";
        if(!Number.isInteger(a.index)) return 'index must be a whole number.';
        { const r=playLibrary(a.kind,a.index,true); return typeof r==='string'?r:undefined; }
      case 'capture': return capture(a);
      case 'export': return exportAnim(a);
      case 'record': return startRecording(a);
      case 'recordStop': return stopRecording();
      default: return 'Unknown command.';
    }
  }

  /* ---------- animation playback ---------- */
  const Anim=window.BoxsmithAnim;
  let anim=null;   // {spec, duration, fps, loop, t, playing, raf, wall0, t0, lastFrameT, originals, view0, variants, onFrame, onDone}
  const poseOf=box=>({position:box.position.slice(),rotation:box.rotation.slice(),colors:box.settings.colors?JSON.parse(JSON.stringify(box.settings.colors)):undefined,hidden:!!box.hidden,settings:box.settings});
  const viewDeg=()=>({yaw:view.yaw*180/PI,pitch:view.pitch*180/PI,zoom:view.zoom,pan:view.pan.slice(),projection:view.projection||'ortho',fov:view.fov||30});
  // put back a view saved with viewDeg()
  const setViewDeg=v=>{ view.yaw=v.yaw*PI/180; view.pitch=v.pitch*PI/180; view.zoom=v.zoom; view.pan=v.pan.slice(); view.projection=v.projection; view.fov=v.fov; if(typeof syncProjectionControls==='function') syncProjectionControls(); };
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
  /* ---------- soundtrack ----------
     The animation's audio is decoded once, cut or padded to exactly the animation's length, and
     played by one Web Audio source (looping with the animation when it loops, sample-accurately).
     While it plays, the animation takes its time from the audio clock (less the output latency, so
     what you see matches what you hear), so the two cannot drift apart however many loops go by.
     If the audio clock stalls or the browser suspends audio, the animation carries on by the system
     clock and the sound is started again in step. */
  let actx=null, audioUnlocked=false;
  const audioFor=new WeakMap();   // animate args -> {name, bytes} found in a library or picked with the file
  function audioContext(){
    if(!actx){ const C=window.AudioContext||window.webkitAudioContext; if(C){ try{ actx=new C({latencyHint:'playback'}); }catch(e){ actx=new C(); } } }
    return actx;
  }
  // Browsers only let a page make sound after a tap or key press on it; the first one wakes audio up.
  const unlockAudio=()=>{ if(audioUnlocked) return; const c=audioContext(); if(c&&c.state!=='running') c.resume().catch(()=>{}); if(c) audioUnlocked=true; };
  addEventListener('pointerdown',unlockAudio,true); addEventListener('keydown',unlockAudio,true);
  const latency=c=>(c.outputLatency||0)+(c.baseLatency||0);
  async function soundBytes(name,given){
    if(given&&given.bytes) return given.bytes;
    if(/^(data:audio\/|https?:|blob:)/i.test(name)){ const r=await fetch(name); if(!r.ok) throw new Error('HTTP '+r.status); return new Uint8Array(await r.arrayBuffer()); }
    const inLib=library&&Anim.findSoundtrack(name,library.audios||[]);
    if(inLib) return inLib.bytes;
    throw new Error('no audio file called '+name+' is loaded. Import it together with the animation (or in the same zip).');
  }
  function loadSound(a){
    const given=audioFor.get(a), name=(a.soundtrack)||(given&&given.name);
    if(!name) return;
    const S0=anim.sound={name:/^data:/i.test(name)?'embedded audio':String(name).slice(0,200),state:'loading'}, me=anim;
    const c=audioContext();
    if(!c){ S0.state='error'; S0.error='this browser has no Web Audio'; return; }
    soundBytes(name,given).then(bytes=>c.decodeAudioData(bytes.slice().buffer)).then(buf=>{
      if(anim!==me) return;
      const chans=[]; for(let i=0;i<buf.numberOfChannels;i++) chans.push(buf.getChannelData(i));
      const fitted=Anim.fitAudio(chans,buf.sampleRate,me.duration);
      const out=c.createBuffer(fitted.length,fitted[0].length,buf.sampleRate); fitted.forEach((ch,i)=>out.copyToChannel(ch,i));
      Object.assign(S0,{state:'ready',buf:out,original:buf,seconds:Math.round(buf.duration*1000)/1000});
      if(me.playing) startSound(me.t);
      if(me.pendingPlay){ me.pendingPlay=false; playAnim(); }
      sendState();
    }).catch(err=>{
      if(anim!==me) return;
      S0.state='error'; S0.error=err.message||String(err); note('soundtrack: '+S0.error);
      if(me.pendingPlay){ me.pendingPlay=false; playAnim(); }
      sendState();
    });
  }
  function startSound(t){
    const S0=anim&&anim.sound; if(!S0) return;
    stopSound();
    if(S0.state!=='ready'&&S0.state!=='blocked'&&S0.state!=='playing') return;
    const c=audioContext();
    if(c.state!=='running'){ c.resume().catch(()=>{}); S0.state='blocked'; return; }   // needs a tap on this screen first
    const src=c.createBufferSource(); src.buffer=S0.buf; src.loop=!!anim.loop; src.loopStart=0; src.loopEnd=S0.buf.duration;
    if(!S0.gain){ S0.gain=c.createGain(); S0.gain.connect(c.destination); }
    src.connect(S0.gain);
    const when=c.currentTime+0.03, off=Math.max(0,Math.min(t,S0.buf.duration-1e-6));
    src.start(when,off);
    Object.assign(S0,{src,when,off,state:'playing',stalled:false,lastCtx:c.currentTime,lastPerf:performance.now()});
  }
  function stopSound(){
    const S0=anim&&anim.sound; if(!S0||!S0.src) return;
    try{ S0.src.stop(); }catch(e){} S0.src.disconnect(); S0.src=null;
    if(S0.state==='playing') S0.state='ready';
  }
  // The animation time the listener is hearing now, or null when the sound isn't driving the clock.
  function soundTime(now){
    const S0=anim&&anim.sound; if(!S0||!S0.src||S0.stalled) return null;
    const c=actx; if(!c||c.state!=='running'){ S0.stalled=true; return null; }
    if(c.currentTime===S0.lastCtx){ if(now-S0.lastPerf>250){ S0.stalled=true; return null; } }
    else { S0.lastCtx=c.currentTime; S0.lastPerf=now; }
    const heard=c.currentTime-latency(c)-S0.when;
    if(heard<0) return S0.off;
    const t=S0.off+heard;
    return anim.loop&&anim.duration>0?t%anim.duration:t;
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
    applyFrame(0); syncProjectionControls();
    loadSound(a);
    if(a.autoplay!==false){ if(anim.sound&&anim.sound.state==='loading'){ anim.pendingPlay=true; setTimeout(()=>{ if(anim&&anim.pendingPlay){ anim.pendingPlay=false; playAnim(); } },5000); } else playAnim(); }
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
    view.projection=anim.spec.projection;   // the animation's own projection, put back on stop
    if(s.camera){
      if(finite(s.camera.fov)) view.fov=s.camera.fov;
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
    const st=soundTime(now);                    // while the soundtrack plays, its clock leads
    if(st!==null){
      if(Math.abs(st-t)>0.04&&!(anim.loop&&Math.abs(Math.abs(st-t)-anim.duration)<0.04)) anim.resyncs=(anim.resyncs||0)+1;
      t=st; anim.t0=st; anim.wall0=now;          // keep the system clock in step, for when sound stops
      if(!anim.loop&&t>=anim.duration){ applyFrame(anim.duration); anim.playing=false; stopSound(); finishAnim(); return; }
    } else if(anim.sound&&anim.sound.state==='blocked'&&actx&&actx.state==='running'){
      startSound(Math.min(t,anim.duration));     // a tap woke audio up: join in at the animation's time
    } else if(anim.sound&&anim.sound.src&&anim.sound.stalled){
      startSound(Math.min(t,anim.duration));     // the audio clock stalled: start it again at the animation's time
    }
    if(t>=anim.duration){
      if(anim.loop&&anim.duration>0){ t%=anim.duration; anim.t0=t; anim.wall0=now; }
      else { applyFrame(anim.duration); anim.playing=false; stopSound(); finishAnim(); return; }
    }
    // draw at the requested frame rate, timed by the real clock so slow devices stay on time. With a
    // soundtrack, each frame shows the moment it will be on screen (it is held for 1/fps and appears
    // about one display refresh after it is drawn), so pictures and sound line up rather than trail.
    if(st!==null){ const lead=0.5/anim.fps+1/60, d=anim.duration; t=anim.loop?(t+lead)%d:Math.min(d,t+lead); }
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
    startSound(anim.t);
    applyFrame(anim.t);
    if(host) host.send({t:'anim',state:'playing',time:anim.t,unit:anim.unit});
    enterCinema();
    anim.raf=requestAnimationFrame(tick);
  }
  function pauseAnim(){ if(!anim) return; anim.playing=false; cancelAnimationFrame(anim.raf); stopSound(); settle(); exitCinema(); syncBoxLayout(); renderAnimBar(); }
  function seekAnim(t){
    t=Math.max(0,Math.min(anim.duration,t));
    applyFrame(t);
    if(anim.playing){ anim.t0=t; anim.wall0=performance.now(); startSound(t); }
    else { settle(); syncBoxLayout(); }
  }
  // Stop: put every animated box (and the camera) back as it was before the animation.
  // forget=true also unloads the animation.
  function stopAnim(forget){
    if(!anim) return;
    anim.playing=false; cancelAnimationFrame(anim.raf); stopSound();
    let swapped=false;
    for(const [i,o] of Object.entries(anim.originals)){
      if(layoutBoxes[i]!==o.box&&layoutBoxes[i]&&anim.variants[i]&&Object.values(anim.variants[i]).includes(layoutBoxes[i])){ layoutBoxes[i]=o.box; swapped=true; }
      const box=o.box, p=o.pose; box._animColors=undefined;
      box.position=p.position.slice(); box.rotation=p.rotation.slice(); box.hidden=p.hidden;
      if(p.colors) box.settings.colors=JSON.parse(JSON.stringify(p.colors)); else delete box.settings.colors;
      transformLayoutBox(box);
    }
    if(swapped) relayoutNoFit();
    setViewDeg(anim.view0);
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
      setViewDeg(keepView);
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
    if(recording) return 'A live recording is running. Send recordStop first.';
    if(!glCanvas()) return 'Exporting needs WebGL on the model screen.';
    if(a.format!=='webm'&&a.format!=='gif') return "format must be 'webm' or 'gif'.";
    if(a.audio!==undefined&&typeof a.audio!=='boolean') return 'audio must be true or false.';
    const src=glCanvas(), aspect=src.width/src.height;
    const defW=a.format==='gif'?480:Math.min(1280,src.width), w0=a.width===undefined?defW:a.width;
    const h0=a.height===undefined?Math.round(w0/aspect):a.height;
    if(!finite(w0)||!finite(h0)||w0<16||h0<16||w0>1920||h0>1920) return 'width and height must be from 16 to 1920 pixels.';
    const fps=a.fps===undefined?(a.format==='gif'?15:30):a.fps;
    if(!finite(fps)||fps<1||fps>(a.format==='gif'?50:60)) return 'fps must be from 1 to '+(a.format==='gif'?50:60)+'.';
    const w=Math.round(w0)&~1, h=Math.round(h0)&~1, id=typeof a.id==='string'?a.id.slice(0,80):'exp'+Date.now().toString(36);
    const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d',{willReadFrequently:a.format==='gif'});
    exporting=true;
    const finish=(blob,ext,extra)=>{
      exporting=false;
      const r=new FileReader();
      r.onload=()=>{ sendBig(Object.assign({t:'export',id,format:ext,data:r.result,bytes:blob.size,width:w,height:h,fps,duration:anim?anim.duration:0},extra||{cfr:ext==='gif'})); };
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
    if(typeof VideoEncoder!=='undefined'&&typeof VideoFrame!=='undefined'){ exportCFR(a,c,ctx,w,h,fps,finish); return; }
    // no WebCodecs (older browsers): record playback in real time; the frame rate then follows the device
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
  /* Constant frame rate: render frame k at exactly k/fps, offline (not in real time), and encode it
     with WebCodecs at timestamp k/fps, so the file has n = round(duration·fps) frames, evenly spaced,
     however slow the device is. The live view is posed and put back within each task, so the screen
     doesn't jump. */
  async function pickVideoCodec(w,h,fps){
    for(const [codec,id] of [['vp09.00.10.08','V_VP9'],['vp8','V_VP8']]){
      const cfg={codec,width:w,height:h,framerate:fps,bitrate:Math.round(Math.min(8e6,w*h*fps*0.12)),latencyMode:'quality'};
      try{ const r=await VideoEncoder.isConfigSupported(cfg); if(r&&r.supported) return {cfg,id}; }catch(e){}
    }
    return null;
  }
  // Encodes frames into WebM. addFrame(canvas, k) for frame k; done() resolves to the WebM bytes.
  async function cfrEncoder(w,h,fps,extraChunks){
    const pick=await pickVideoCodec(w,h,fps);
    if(!pick) throw new Error('this browser cannot encode VP9 or VP8 video');
    const chunks=[]; let failed=null;
    const enc=new VideoEncoder({output:ch=>{ const d=new Uint8Array(ch.byteLength); ch.copyTo(d); chunks.push({track:1,us:ch.timestamp,data:d,key:ch.type==='key'}); },error:e=>{ failed=e; }});
    enc.configure(pick.cfg);
    const keyEvery=Math.max(1,Math.round(fps*2));
    return {
      codec:pick.id,
      addFrame(canvas,k){
        if(failed) throw failed;
        const f=new VideoFrame(canvas,{timestamp:Math.round(k*1e6/fps),duration:Math.round(1e6/fps)});
        enc.encode(f,{keyFrame:k%keyEvery===0}); f.close();
      },
      backlog:()=>enc.encodeQueueSize,
      async done(frames,audio){
        await enc.flush(); enc.close(); if(failed) throw failed;
        const all=chunks.concat(audio?audio.chunks:[]);
        return Anim.makeWebM({width:w,height:h,fps,videoCodec:pick.id,audio:audio&&audio.track,chunks:all,durationMs:frames*1000/fps});
      }
    };
  }
  // The soundtrack as an Opus track for the exported WebM, exactly `seconds` long (the video's length).
  async function encodeSoundtrack(seconds){
    const S0=anim&&anim.sound;
    if(!S0||!S0.buf) return null;
    if(typeof AudioEncoder==='undefined'||typeof AudioData==='undefined') throw new Error('this browser cannot encode audio');
    const ch=Math.min(2,S0.buf.numberOfChannels), sr=48000, frames=Math.round(seconds*sr);
    const cfg={codec:'opus',sampleRate:sr,numberOfChannels:ch,bitrate:160000};
    const ok=await AudioEncoder.isConfigSupported(cfg).catch(()=>null);
    if(!ok||!ok.supported) throw new Error('this browser cannot encode Opus audio');
    // resample to 48 kHz (Opus's rate) and cut or pad to the video's length
    const off=new OfflineAudioContext(ch,frames,sr), src=off.createBufferSource(); src.buffer=S0.buf; src.connect(off.destination); src.start(0);
    const pcm=await off.startRendering();
    const chunks=[]; let desc=null, failed=null;
    const enc=new AudioEncoder({output:(c,meta)=>{ const d=new Uint8Array(c.byteLength); c.copyTo(d); chunks.push({track:2,us:c.timestamp,dur:c.duration,data:d,key:true}); if(meta&&meta.decoderConfig&&meta.decoderConfig.description&&!desc) desc=new Uint8Array(meta.decoderConfig.description.buffer||meta.decoderConfig.description); },error:e=>{ failed=e; }});
    enc.configure(cfg);
    const step=sr/50;   // 20 ms blocks
    for(let i=0;i<frames;i+=step){
      const n=Math.min(step,frames-i), data=new Float32Array(n*ch);
      for(let k=0;k<ch;k++) data.set(pcm.getChannelData(k).subarray(i,i+n),k*n);
      const ad=new AudioData({format:'f32-planar',sampleRate:sr,numberOfFrames:n,numberOfChannels:ch,timestamp:Math.round(i*1e6/sr),data});
      enc.encode(ad); ad.close();
    }
    await enc.flush(); enc.close(); if(failed) throw failed;
    const head=desc&&desc.length>=19&&String.fromCharCode(...desc.subarray(0,8))==='OpusHead'?desc:Anim.opusHead(ch,sr);
    const preSkip=head[10]|(head[11]<<8);
    // Opus comes in 20 ms packets: drop what the last one carries past the video's end
    const coded=chunks.reduce((n,c)=>n+Math.round((c.dur||20000)*sr/1e6),0), extra=coded-preSkip-frames;
    if(extra>0&&chunks.length) chunks[chunks.length-1].discardNs=Math.round(extra/sr*1e9);
    return {chunks,track:{codec:'A_OPUS',sampleRate:sr,channels:ch,codecPrivate:head,codecDelayNs:Math.round(preSkip/sr*1e9)}};
  }
  function exportCFR(a,c,ctx,w,h,fps,finish){
    const times=Anim.cfrTimes(anim.duration,fps), id0=anim;
    const busy=document.createElement('div'); busy.className='anim-loading'; busy.innerHTML='<span>Recording video… 0%</span>'; document.body.appendChild(busy);
    const fail=err=>{ busy.remove(); exporting=false; note('export: the video could not be made: '+(err&&err.message||err)); };
    cfrEncoder(w,h,fps).then(E=>{
      let k=0;
      const step=()=>{
        if(anim!==id0) return fail('the animation was changed while recording');
        if(E.backlog()>6) return setTimeout(step,5);              // let the encoder catch up
        const batch=times.slice(k,k+4), k0=k; k+=batch.length;
        try{ atTimes(batch,(j)=>{ drawInto(ctx,0,0,w,h); E.addFrame(c,k0+j); }); }catch(err){ return fail(err); }
        busy.firstChild.textContent='Recording video… '+Math.round(k/times.length*100)+'%';
        if(k<times.length) return setTimeout(step,0);
        // the soundtrack goes in too, unless audio:false, cut to exactly the video's length
        const want=a.audio!==false&&anim.sound&&anim.sound.buf, seconds=times.length/fps;
        (want?encodeSoundtrack(seconds).catch(err=>{ note('export: the video has no sound: '+(err&&err.message||err)); return null; }):Promise.resolve(null))
          .then(audio=>E.done(times.length,audio).then(bytes=>{ busy.remove(); finish(new Blob([bytes],{type:'video/webm'}),'webm',{frames:times.length,cfr:true,codec:E.codec,audio:audio?{codec:'opus',seconds,sampleRate:48000,channels:audio.track.channels}:null}); }))
          .catch(fail);
      };
      step();
    }).catch(fail);
  }
  /* ---------- live recording: whatever the view shows, in real time, at a constant frame rate ----------
     Time is cut into slots of 1/fps on the real clock. Each tick draws the view and encodes it into
     every slot that has started since the last tick, with timestamp slot/fps. A slow device repeats the
     picture rather than dropping slots, so the file's frames are always exactly 1/fps apart and the
     count is elapsed seconds × fps. Manual orbiting, edits and animations started mid-take all land in it. */
  let recording=null;
  const RECORD_MAX_S=600;
  function startRecording(a){
    if(recording) return 'Already recording. Send recordStop to finish.';
    if(exporting) return 'An export is running; record when it has finished.';
    if(!glCanvas()) return 'Recording needs WebGL on the model screen.';
    if(typeof VideoEncoder==='undefined'||typeof VideoFrame==='undefined') return 'This browser cannot record video at a constant frame rate (it needs WebCodecs; try Chrome, Edge or Safari 17+).';
    const fps=a.fps===undefined?30:a.fps, w0=a.width===undefined?1280:a.width, h0=a.height===undefined?800:a.height;
    if(!finite(fps)||fps<1||fps>60) return 'fps must be from 1 to 60.';
    if(!finite(w0)||!finite(h0)||w0<16||h0<16||w0>1920||h0>1920) return 'width and height must be from 16 to 1920 pixels.';
    const w=Math.round(w0)&~1, h=Math.round(h0)&~1, id=typeof a.id==='string'?a.id.slice(0,80):'rec'+Date.now().toString(36);
    const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d');
    const rec=recording={id,fps,w,h,c,ctx,E:null,slot:0,t0:0,timer:0,stopping:false,failed:null};
    renderRecIndicator();
    cfrEncoder(w,h,fps).then(E=>{
      if(recording!==rec) return;
      rec.E=E; rec.t0=performance.now();
      const tick=()=>{
        if(recording!==rec||rec.stopping) return;
        const due=Math.floor((performance.now()-rec.t0)*fps/1000)+1;   // slots started so far
        try{
          if(due>rec.slot&&rec.E.backlog()<30){
            render(); drawInto(ctx,0,0,w,h);                             // the view as it is right now
            while(rec.slot<due){ rec.E.addFrame(c,rec.slot); rec.slot++; }
          }
        }catch(err){ rec.failed=err; return stopRecording(); }
        if(rec.slot/fps>=RECORD_MAX_S){ note('record: stopped at the '+RECORD_MAX_S/60+'-minute limit.'); return stopRecording(); }
        renderRecIndicator();
        rec.timer=setTimeout(tick,Math.max(1,(rec.slot*1000/fps)-(performance.now()-rec.t0)));
      };
      tick();
      sendState(true);
    }).catch(err=>{ if(recording===rec){ recording=null; renderRecIndicator(); note('record: '+(err&&err.message||err)); sendState(true); } });
  }
  function stopRecording(){
    const rec=recording;
    if(!rec) return 'Nothing is being recorded.';
    if(rec.stopping) return;
    rec.stopping=true; clearTimeout(rec.timer);
    const done=(err)=>{ recording=null; renderRecIndicator(); if(err) note('record: the video could not be made: '+(err.message||err)); sendState(true); };
    if(!rec.E){ done(rec.failed); return; }
    // fill the slots up to now, so the take ends where Stop was pressed
    try{ const due=Math.floor((performance.now()-rec.t0)*rec.fps/1000)+1; if(due>rec.slot){ render(); drawInto(rec.ctx,0,0,rec.w,rec.h); while(rec.slot<due){ rec.E.addFrame(rec.c,rec.slot); rec.slot++; } } }catch(e){}
    const frames=rec.slot;
    rec.E.done(frames).then(bytes=>{
      const blob=new Blob([bytes],{type:'video/webm'}), r=new FileReader();
      r.onload=()=>sendBig({t:'export',id:rec.id,format:'webm',live:true,data:r.result,bytes:blob.size,width:rec.w,height:rec.h,fps:rec.fps,frames,duration:frames/rec.fps,cfr:true,codec:rec.E.codec});
      r.readAsDataURL(blob);
      showDownload(blob,'boxsmith-recording.webm');
      done(rec.failed);
    }).catch(done);
  }
  // ● REC in the corner while recording (it is not part of the video), and the Record button's label
  function renderRecIndicator(){
    let el=$('#recIndicator');
    if(!recording){ if(el) el.remove(); }
    else {
      if(!el){ el=document.createElement('button'); el.id='recIndicator'; el.type='button'; el.className='rec-indicator'; el.title='Recording. Click to stop.'; el.addEventListener('click',e=>{ e.stopPropagation(); stopRecording(); }); document.body.appendChild(el); }
      const s=recording.E?Math.floor(recording.slot/recording.fps):0;
      el.textContent='● REC '+Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
    }
    const b=$('#layoutRecord'); if(b){ b.textContent=recording?'■ Stop recording':'● Record'; b.classList.toggle('on',!!recording); }
  }
  // Import animation (host): read the file, warn before replacing the open layout, load with a
  // loading indicator (big files take a few seconds), then play.
  // files: one File, or several picked together (an animation file and its soundtrack).
  function importAnimationFile(files){
    const list=files&&files.length!==undefined&&!(files instanceof Blob)?[...files]:[files].filter(Boolean);
    if(!list.length) return;
    const file=list.find(f=>/\.zip$/i.test(f.name)||/zip/.test(f.type))||list.find(f=>!Anim.isAudioName(f.name))||list[0];
    const audios=list.filter(f=>f!==file&&Anim.isAudioName(f.name));
    if(/\.zip$/i.test(file.name)||/zip/.test(file.type)) return openLibrary(file);
    if(Anim.isAudioName(file.name)) return toast('That is a sound file. Choose it together with the animation file it belongs to.');
    const busy=document.createElement('div'); busy.className='anim-loading'; busy.innerHTML='<span>Loading animation…</span>'; document.body.appendChild(busy);
    const done=msg=>{ busy.remove(); if(msg){ toast(msg); } };
    file.text().then(text=>{
      const found=animationFromFile(text);
      if(found.error) return done(found.error);
      const a=found.args;
      if(a.base&&layoutBoxes.length&&!confirm('This animation comes with its own layout ('+(a.base.boxes?a.base.boxes.length:'?')+' boxes), which will replace the '+layoutBoxes.length+' boxes open now. Save your layout first if you want to keep it.\n\nReplace it and play?')) return done();
      busy.firstChild.textContent='Building '+(a.base&&a.base.boxes?a.base.boxes.length+' boxes':'the animation')+'…';
      const au=a.soundtrack?audios.find(f=>Anim.findSoundtrack(a.soundtrack,[{name:f.name}])):(audios.length===1?audios[0]:null);
      const withAudio=au?au.arrayBuffer().then(b=>audioFor.set(a,{name:au.name,bytes:new Uint8Array(b)})):Promise.resolve();
      if(a.soundtrack&&!au&&!/^(data:|https?:|blob:)/i.test(a.soundtrack)&&!(library&&Anim.findSoundtrack(a.soundtrack,library.audios||[]))) toast('This animation’s soundtrack is '+a.soundtrack+'. Choose that file together with the animation to hear it.');
      withAudio.then(()=>setTimeout(()=>{   // let the indicator paint before the heavy work
        let err; try{ err=runCmd('animate',a); }catch(e){ err=e.message; }
        done(err?'Could not play '+file.name+': '+err:null);
        if(!err&&anim){ anim.name=file.name.replace(/\.json$/i,''); renderAnimBar(); }
        sendState(true);
      },60));
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
      for(const x of lib.animations) if(x.audio) audioFor.set(x.args,{name:x.audio.name,bytes:x.audio.bytes});
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
  // Find a library item by index or by name (case, spaces, dashes and underscores ignored).
  function findLibraryItem(kind,a){
    if(!library) return {error:'No library is open. Import a zip of animations on the model screen first.'};
    const list=kind==='design'?library.designs:library.animations, names=list.map((x,i)=>i+': '+x.name).join(', ');
    if(a.index!==undefined){
      if(!Number.isInteger(a.index)||!list[a.index]) return {error:'There is no '+kind+' '+a.index+'. The library has '+(names||'none')+'.'};
      return {index:a.index};
    }
    if(typeof a.name!=='string') return {error:'Give index (a whole number) or name. The library has '+(names||'none')+'.'};
    const key=v=>String(v).toLowerCase().replace(/[\s_-]+/g,'');
    const index=list.findIndex(x=>key(x.name)===key(a.name));
    return index<0?{error:'No '+kind+' is called "'+a.name+'". The library has '+(names||'none')+'.'}:{index};
  }
  // libraryPlay / libraryLoadDesign: load straight from the zip already open on this screen, so the
  // remote sends a name instead of the whole file. Runs now, so the reply state shows it loaded.
  function libraryOp(kind,a){
    const f=findLibraryItem(kind,a); if(f.error) return f.error;
    if(a.autoplay!==undefined&&typeof a.autoplay!=='boolean') return 'autoplay must be true or false.';
    if(a.loop!==undefined&&typeof a.loop!=='boolean') return 'loop must be true or false.';
    const item=(kind==='design'?library.designs:library.animations)[f.index];
    let err;
    try{
      if(kind==='design'){ stopAnim(true); openBoxLayout(item.json); }
      else {
        const args=Object.assign({},item.args,{autoplay:a.autoplay!==false});
        if(a.loop!==undefined) args.loop=a.loop;
        if(audioFor.has(item.args)) audioFor.set(args,audioFor.get(item.args));
        err=runCmd('animate',args); if(!err&&anim) anim.name=item.name;
      }
    }catch(e){ err=e.message; }
    if(err) return 'Could not load '+item.name+': '+err;
    library.owns=true; library.current=kind+':'+f.index;
    renderLibrary(); renderAnimBar();
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
    if(msg.t==='note'||msg.t==='relayError'){ setRemoteStatus(msg.text); return; }
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
        '<label>Projection <select data-rm="projection">'+[['ortho','Orthographic'],['perspective','Perspective']].map(([v,l])=>'<option value="'+v+'"'+(((st.view&&st.view.projection)||'ortho')===v?' selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
        ((st.view&&st.view.projection)==='perspective'?'<label>Lens <input type="number" data-rm="fov" min="5" max="120" step="1" value="'+Math.round(st.view.fov||30)+'" style="width:4.5em">°</label>':'')+
        '<label>Units <select data-rm="units"><option value="mm"'+(u==='mm'?' selected':'')+'>mm</option><option value="in"'+(u==='in'?' selected':'')+'>in</option></select></label></div></section>'+
        '<section><h4>Layout file</h4><div class="rm-row"><button type="button" class="btn" data-rm="save">Save layout (downloads on the model screen)</button>'+
        '<button type="button" class="btn" data-rm="openfile">Open a layout file from this device</button><input type="file" id="rmFile" accept=".json,application/json" hidden>'+
        '<button type="button" class="btn" data-rm="animfile">Import an animation from this device</button><input type="file" id="rmAnimFile" multiple accept=".json,application/json,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,audio/*" hidden></div>'+
        '<div class="rm-row"><button type="button" class="btn rm-danger" data-rm="clear"'+(st.boxCount?'':' disabled')+'>'+(clearArmed>Date.now()?'Tap again to clear every box':'Clear all boxes')+'</button></div></section>'+
        (st.library?'<section><h4>Library · '+esc(st.library.title)+'</h4>'+
          st.library.animations.map((x,i)=>'<div class="rm-row"><span class="rm-grow"><b>'+esc(x.name)+'</b> <small class="rm-small">'+x.duration.toFixed(1)+' s'+(x.boxes?' · '+x.boxes+' boxes':'')+'</small></span><button type="button" class="btn'+(st.library.current==='animation:'+i?' on':'')+'" data-rm-lib="animation:'+i+'">▶ Play</button></div>').join('')+
          st.library.designs.map((x,i)=>'<div class="rm-row"><span class="rm-grow"><b>'+esc(x.name)+'</b> <small class="rm-small">design · '+x.boxes+' boxes</small></span><button type="button" class="btn'+(st.library.current==='design:'+i?' on':'')+'" data-rm-lib="design:'+i+'">Open</button></div>').join('')+'</section>':'')+
        '<section><h4>Animation</h4>'+(st.anim?'<p class="rm-small">'+(st.anim.playing?'Playing':'Paused')+' at '+st.anim.t.toFixed(2)+' of '+st.anim.duration.toFixed(2)+' s'+(st.exporting?' · recording…':'')+'</p>':'<p class="rm-small">No animation loaded. Animations are sent with the animate command (see the API guide).</p>')+
        '<div class="rm-row"><button type="button" class="btn" data-rm-anim="play"'+(st.anim?'':' disabled')+'>▶ Play</button><button type="button" class="btn" data-rm-anim="pause"'+(st.anim?'':' disabled')+'>❚❚ Pause</button><button type="button" class="btn" data-rm-anim="stop"'+(st.anim?'':' disabled')+'>■ Stop</button></div>'+
        '<div class="rm-row"><button type="button" class="btn" data-rm-cap="still">Capture view</button><button type="button" class="btn" data-rm-cap="sheet"'+(st.anim?'':' disabled')+'>Contact sheet (12 frames)</button>'+
        '<button type="button" class="btn" data-rm-exp="webm"'+(st.anim&&!st.exporting?'':' disabled')+'>Record WebM</button><button type="button" class="btn" data-rm-exp="gif"'+(st.anim&&!st.exporting?'':' disabled')+'>Record GIF</button>'+
        '<button type="button" class="btn'+(st.recording?' on':'')+'" data-rm-live>'+(st.recording?'■ Stop live recording ('+st.recording.seconds+' s)':'● Live record')+'</button></div>'+
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
      if(b.dataset.rmLive!==undefined) return cmd(st&&st.recording?'recordStop':'record',{});
      if(b.dataset.rmTurn) return cmd('turn',{kind:b.dataset.rmTurn});
    });
    p.addEventListener('change',e=>{
      const t=e.target;
      if(t.dataset.rm==='select') return cmd('select',{index:+t.value});
      if(t.dataset.rm==='projection') return cmd('view',{projection:t.value});
      if(t.dataset.rm==='fov'&&+t.value>=5&&+t.value<=120) return cmd('view',{fov:+t.value});
      if(t.dataset.rm==='part') return cmd('part',{name:t.value||null});
      if(t.dataset.rm==='color') return cmd('color',{hex:t.value,final:true});
      if(t.dataset.rm==='units') return cmd('units',{unit:t.value});
      if(t.dataset.rm==='stereo') return cmd('stereo',{mode:t.value});
      if(t.id==='rmAnimFile'&&t.files[0]){
        const all=[...t.files]; t.value='';
        const f=all.find(x=>!Anim.isAudioName(x.name)), au=all.filter(x=>Anim.isAudioName(x.name));
        if(!f) return setRemoteStatus('Choose the animation file too (with its sound file, if it has one).');
        f.text().then(async text=>{
          const found=animationFromFile(text); if(found.error) return setRemoteStatus(found.error);
          const a=found.args, pick=a.soundtrack?au.find(x=>Anim.findSoundtrack(a.soundtrack,[{name:x.name}])):(au.length===1?au[0]:null);
          if(pick) a.soundtrack=await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).replace(/^data:(?!audio\/)[^;,]*/,'data:audio/'+(pick.name.split('.').pop()||'mpeg').toLowerCase())); r.readAsDataURL(pick); });   // the sound travels with it
          setRemoteStatus('Sending '+f.name+(pick?' and '+pick.name:'')+' to the model screen…'); cmd('animate',a);
        }); return;
      }
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
    const recBtn=$('#layoutRecord');
    if(recBtn) recBtn.addEventListener('click',()=>{ const err=recording?stopRecording():startRecording({}); if(err) toast(err); sendState(true); });
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
    $('#animFile').addEventListener('change',e=>{ const f=[...e.target.files]; e.target.value=''; importAnimationFile(f); });
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
  return {record:a=>startRecording(a||{}),recordStop:()=>stopRecording(),get recording(){ return !!recording; },init,hostStart,hostStop,remoteMode,animationFromFile,importAnimationFile,playLibrary,get library(){ return library&&{title:library.title,current:library.current,animations:library.animations.map(x=>x.name),designs:library.designs.map(x=>x.name)}; },run:(op,args)=>{ let e; try{ e=op==='batch'?Anim.runBatch(args&&args.cmds,runCmd).errors.join(' '):runCmd(op,args||{}); }catch(err){ e=err.message; } sendState(true); return e||null; },get anim(){ return anim&&{playing:anim.playing,t:anim.t,duration:anim.duration,soundtrack:anim.sound?{name:anim.sound.name,state:anim.sound.state,error:anim.sound.error,clock:anim.sound.src&&!anim.sound.stalled?'audio':'system'}:null}; },get code(){ return hostCode; }};
})();
Remote.init();
