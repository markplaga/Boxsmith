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
    const seen=[], me=Math.random().toString(36).slice(2);
    let bc=null, ws=null, closed=false, retry=0, timer=null, relayState='connecting';
    const deliver=msg=>{
      if(!msg||msg.from===role||msg.src===me) return;
      if(msg.id){ if(seen.includes(msg.id)) return; seen.push(msg.id); if(seen.length>300) seen.shift(); }
      onMessage(msg);
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
        const msg=Object.assign({id:me+'.'+(n++),src:me,from:role},obj);
        if(bc) bc.postMessage(msg);
        if(ws&&ws.readyState===1) ws.send(JSON.stringify(msg));
      },
      close(){ closed=true; clearTimeout(timer); if(bc) bc.close(); if(ws) ws.close(); },
      get relay(){ return relayState; }
    };
  }

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
      placing:placingBox,maximized:document.body.classList.contains('max3d'),stereo:stereo?stereo.value:'off',boxCount:layoutBoxes.length,
      boxes:layoutBoxes.map((b,i)=>({label:layoutBoxLabel(b,i),hidden:!!b.hidden,clash:clash.has(i),position:b.position,rotation:b.rotation,colors:b.settings.colors||{}})),
      parts:partNames(box),acrylic:!!box&&boxHasAcrylic(box),
      sides:[...$('#layoutSnapSide').options].map(o=>[o.value,o.textContent]),
      status:$('#layoutStatus').textContent};
  }
  function sendState(){ clearTimeout(stateTimer); stateTimer=setTimeout(()=>{ if(host) host.send(state()); },40); }
  const press=sel=>{ const el=$(sel); if(el&&!el.disabled&&!el.hidden) el.click(); };
  function hostMessage(msg){
    if(msg.t==='peers'){ remotes=msg.remotes; renderHostStatus(); return; }
    if(msg.t==='hello'){ forceDesign=true; localPeer=true; renderHostStatus(); if(curView!=='layout') document.querySelector('#tabs [data-v="layout"]')?.click(); sendState(); return; }
    if(msg.t!=='cmd') return;
    const a=msg.args||{};
    switch(msg.op){
      case 'select': selectLayoutBox(Number.isInteger(a.index)&&layoutBoxes[a.index]?a.index:-1); break;
      case 'part': if(layoutBoxes[layoutSelection]){ layoutPart=a.name||null; syncBoxLayout(); render(); } break;
      case 'set': {
        const input=$(a.rot?'[data-layout-rotation="'+a.k+'"]':'[data-layout-axis="'+a.k+'"]');
        if(input&&!input.disabled&&Number.isFinite(a.value)){ input.value=a.value; input.dispatchEvent(new Event('change')); }
        break;
      }
      case 'turn': press('[data-lay-turn="'+CSS.escape(String(a.kind))+'"]'); break;
      case 'step': press('[data-lay-step="'+CSS.escape(String(a.key))+'"]'); break;
      case 'snap':
        if(layoutBoxes[a.to]){ $('#layoutSnapTarget').value=String(a.to); $('#layoutSnapSide').value=a.side; $('#layoutSnapGap').value=a.gap||0; press('#layoutSnap'); }
        break;
      case 'dup': press(a.inPlace?'#layoutDuplicateInPlace':'#layoutDuplicate'); break;
      case 'hide': press('#layoutHide'); break;
      case 'remove': press('#layoutRemove'); break;
      case 'color': {
        const c=$('#layoutColor');
        if(!c.disabled&&/^#[0-9a-f]{6}$/i.test(a.hex)){ c.value=a.hex; c.dispatchEvent(new Event('input')); if(a.final) c.dispatchEvent(new Event('change')); }
        break;
      }
      case 'nocolor': press('#layoutColorClear'); break;
      case 'fit': press('#layoutFit'); break;
      case 'top': press('#layoutTop'); break;
      case 'place': press('#layoutPlace'); break;
      case 'design': applyDesign(a.index,a.settings); break;
      case 'add': if(a.settings&&typeof a.settings==='object') addLayoutBox({settings:a.settings,rotation:[0,0,0],position:[0,0,0],hidden:false}); break;
      case 'units': if(a.unit==='mm'||a.unit==='in'){ const u=$('#layoutUnits'); u.value=a.unit; u.dispatchEvent(new Event('change')); } break;
      case 'maximize': if(document.body.classList.contains('max3d')) press('#previewExitMax'); else press('#layoutCtl [data-maximize-view]'); break;
      case 'stereo': { const sel=$('#layoutCtl [data-stereo-mode]'); if(sel&&['off','cross','parallel'].includes(a.mode)){ sel.value=a.mode; sel.dispatchEvent(new Event('change')); } break; }
      case 'save': press('#layoutSave'); break;
      case 'open': try{ openBoxLayout(a.json); }catch(err){ toast('That layout file could not be opened.'); host.send({t:'note',text:'That layout file could not be opened: '+err.message}); } break;
      case 'clear': if(layoutBoxes.length){ layoutBoxes=[]; rebuildBoxLayout(); saveBoxLayout(); selectLayoutBox(-1); toast('Layout cleared'); } break;
    }
    sendState();
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
  let link=null, st=null, joinedCode='', helloTimer=null, removeArmed=0, clearArmed=0, tab='place';
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
        '<button type="button" class="btn" data-rm="openfile">Open a layout file from this device</button><input type="file" id="rmFile" accept=".json,application/json" hidden></div>'+
        '<div class="rm-row"><button type="button" class="btn rm-danger" data-rm="clear"'+(st.boxCount?'':' disabled')+'>'+(clearArmed>Date.now()?'Tap again to clear every box':'Clear all boxes')+'</button></div></section>';
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
      if(r==='clear'){ if(clearArmed>Date.now()){ clearArmed=0; cmd('clear',{}); } else { clearArmed=Date.now()+4000; renderRemote(); setTimeout(renderRemote,4100); } return; }
      if(r==='dup') return cmd('dup',{});
      if(r==='dupin') return cmd('dup',{inPlace:true});
      if(r==='hide') return cmd('hide',{});
      if(r==='remove'){ if(removeArmed>Date.now()){ removeArmed=0; cmd('remove',{}); } else { removeArmed=Date.now()+4000; renderRemote(); setTimeout(renderRemote,4100); } return; }
      if(r==='snap') return cmd('snap',{to:+p.querySelector('[data-rm=snapto]').value,side:p.querySelector('[data-rm=snapside]').value,gap:+p.querySelector('[data-rm=snapgap]').value||0});
      if(r==='nocolor') return cmd('nocolor',{});
      if(r==='fit'||r==='top') return cmd(r,{});
      if(b.dataset.rmStep) return cmd('step',{key:b.dataset.rmStep});
      if(b.dataset.rmTurn) return cmd('turn',{kind:b.dataset.rmTurn});
    });
    p.addEventListener('change',e=>{
      const t=e.target;
      if(t.dataset.rm==='select') return cmd('select',{index:+t.value});
      if(t.dataset.rm==='part') return cmd('part',{name:t.value||null});
      if(t.dataset.rm==='color') return cmd('color',{hex:t.value,final:true});
      if(t.dataset.rm==='units') return cmd('units',{unit:t.value});
      if(t.dataset.rm==='stereo') return cmd('stereo',{mode:t.value});
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
  return {init,hostStart,hostStop,remoteMode,get code(){ return hostCode; }};
})();
Remote.init();
