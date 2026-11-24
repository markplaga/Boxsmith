'use strict';
/* ================= TYPE LAB: make, open, check and keep box type files =================
   - The sidebar's "Style settings" section shows a custom type's own params.
   - The Type lab panel (right side) takes a type file (paste, open, or an example), checks it in 3D,
     tries it on the page, and saves it to My types (kept in this browser). */

/* ---------- a custom type's settings in the sidebar ---------- */
let typeParamsSig='';
const isStdKey=k=>Object.prototype.hasOwnProperty.call(DEFAULTS,k);
function typeParamValue(def,p){
  if(isStdKey(p.key)) return S[p.key];
  const v=((S.typeParams||{})[def.id]||{})[p.key];
  return v===undefined?p.default:v;
}
function setTypeParam(def,key,value){
  if(isStdKey(key)){ S[key]=value; }
  else { const all=Object.assign({},S.typeParams||{}); all[def.id]=Object.assign({},all[def.id]||{},{[key]:value}); S.typeParams=all; }
  update();
}
// the names a showIf formula can use: the standard ones and every param
function typeParamEnv(def){
  const env={W:S.W,D:S.D,H:S.H,t:S.t,fw:S.fw,clr:S.clr,inside:S.dimMode==='inside',text:S.text||'',tslot:S.tslot,corners:S.corners,tAcr:S.tAcr};
  for(const p of def.params||[]) env[p.key]=typeParamValue(def,p);
  return env;
}
function syncTypeParams(){
  const sec=$('#typeParamsSec'); if(!sec) return;
  const def=customTypeDef(S.type);
  sec.classList.toggle('hidden',!def);
  if(!def){ typeParamsSig=''; return; }
  const box=$('#typeParams'), sig=def.id+'|'+JSON.stringify(def.params||[])+'|'+S.unit;
  if(sig!==typeParamsSig){
    typeParamsSig=sig;
    $('#typeParamsAbout').textContent=[def.description,def.author?'by '+def.author:'',def.typeVersion?'version '+def.typeVersion:''].filter(Boolean).join(' · ');
    box.innerHTML=(def.params||[]).map((p,i)=>{
      const id='tp-'+i, help=p.help?'<span class="hint">'+esc(p.help)+'</span>':'';
      if(p.kind==='bool') return '<label class="chk full" data-p="'+esc(p.key)+'"><input type="checkbox" id="'+id+'"> '+esc(p.label)+'</label>';
      let input;
      if(p.kind==='choice') input='<select id="'+id+'">'+p.choices.map(c=>{ const v=c.value??c; return '<option value="'+esc(v)+'">'+esc(c.label??v)+'</option>'; }).join('')+'</select>';
      else if(p.kind==='color') input='<input type="color" id="'+id+'">';
      else if(p.kind==='text') input='<input type="text" id="'+id+'">';
      else input='<input type="number" id="'+id+'">';
      return '<div class="f'+(p.kind==='text'?' full':'')+'" data-p="'+esc(p.key)+'"><label for="'+id+'">'+esc(p.label)+(p.kind==='length'?' ('+(S.unit==='in'?'in':'mm')+')':'')+'</label>'+input+help+'</div>';
    }).join('')||'<p class="hint" style="margin:0">This style has no settings of its own.</p>';
    (def.params||[]).forEach((p,i)=>{
      const el=$('#tp-'+i); if(!el) return;
      const read=()=>{
        if(p.kind==='bool') return el.checked;
        if(['length','number','integer'].includes(p.kind)){
          let v=parseFloat(el.value); if(!isFinite(v)) return undefined;
          if(p.kind==='length'&&S.unit==='in') v*=25.4;
          if(p.kind==='integer') v=Math.round(v);
          if(p.min!==undefined) v=Math.max(p.min,v); if(p.max!==undefined) v=Math.min(p.max,v);
          return v;
        }
        return el.value;
      };
      el.addEventListener(p.kind==='bool'||p.kind==='choice'?'change':'input',()=>{ const v=read(); if(v!==undefined) setTypeParam(def,p.key,v); });
      if(['length','number','integer'].includes(p.kind)){
        const k=p.kind==='length'&&S.unit==='in'?1/25.4:1;
        if(p.min!==undefined) el.min=+(p.min*k).toFixed(4); if(p.max!==undefined) el.max=+(p.max*k).toFixed(4);
        el.step=p.step!==undefined?+(p.step*k).toFixed(4):p.kind==='integer'?1:p.kind==='length'&&S.unit==='in'?0.0625:'any';
      }
    });
  }
  // values and showIf, every time
  const env=typeParamEnv(def);
  (def.params||[]).forEach((p,i)=>{
    const el=$('#tp-'+i); if(!el) return;
    const v=typeParamValue(def,p);
    if(p.kind==='bool') el.checked=!!v;
    else if(document.activeElement!==el) el.value=p.kind==='length'&&S.unit==='in'?+(v/25.4).toFixed(4):v;
    let show=true;
    if(p.showIf!==undefined){ try{ show=!!BoxTypes.formula(String(p.showIf),env,{}); }catch(e){ show=true; } }
    el.closest('[data-p]').classList.toggle('hidden',!show);
  });
}

/* ---------- the Type lab panel ---------- */
const LAB_EXAMPLES=[['closed-box','Closed box'],['open-tray','Open tray'],['cube-frame','Cube frame'],['box-with-shelf','Box with a shelf']];
const LAB_STARTER={format:'boxsmith-type',version:1,id:'my-box',name:'My box',description:'',
  inside:{W:'2*t',D:'2*t',H:'2*t'},
  params:[],
  parts:[{box:{size:['W','D','H']}}],
  notes:['Glue the four walls onto the bottom, then press the top on.']};
let labLast=null;   // the last report, for "Copy problems"

function labEl(){
  let el=$('#typeLab'); if(el) return el;
  el=document.createElement('aside'); el.id='typeLab'; el.className='typeLab hidden'; el.setAttribute('aria-label','Type lab');
  el.innerHTML='<div class="labHd"><b>Type lab</b><button class="btn sm" id="labClose" type="button" aria-label="Close the Type lab">✕</button></div>'
   +'<p class="hint">A box type file describes a new box style in JSON: its parts, their sizes and where they go, with formulas but no code. Paste one, open a file, or start from an example. <a href="https://github.com/markplaga/Boxsmith/blob/main/BOX-TYPES.md" target="_blank" rel="noopener">The format</a></p>'
   +'<div class="labRow"><label class="btn sm">Open file…<input type="file" class="hidden" id="labFile" accept=".json,application/json"></label>'
   +'<select id="labExample" aria-label="Start from"><option value="">Start from…</option><option value="starter">A plain box</option>'+LAB_EXAMPLES.map(([f,n])=>'<option value="'+f+'">'+n+'</option>').join('')+'</select></div>'
   +'<details class="labAi" id="labAi"><summary>Have an AI write one</summary>'
   +'<p class="hint">Describe the box. Boxsmith copies a prompt with the whole format, an example and your description; paste it into any chat AI (Claude, ChatGPT, Gemini…), then paste its answer below.</p>'
   +'<textarea id="labAsk" rows="3" placeholder="A tray with a sloped front and three compartments, and a lid that slides in from the back"></textarea>'
   +'<div class="labRow"><button class="btn sm primary" id="labPrompt" type="button">Copy AI prompt</button><label class="chk" style="font-size:12px"><input type="checkbox" id="labAskEdit"> Change the file below instead</label></div></details>'
   +'<textarea id="labText" spellcheck="false" aria-label="Type file"></textarea>'
   +'<div class="labRow"><button class="btn sm" id="labCheck" type="button">Check</button><button class="btn sm" id="labTry" type="button">Try it</button><button class="btn sm primary" id="labSave" type="button">Save to My types</button></div>'
   +'<div id="labReport" aria-live="polite"></div>'
   +'<div class="labRow"><button class="btn sm hidden" id="labCopy" type="button">Copy problems for an AI</button><button class="btn sm" id="labDownload" type="button">Download file</button></div>'
   +'<h3>My types</h3><div id="labMine"></div>';
  document.body.appendChild(el);
  $('#labClose').addEventListener('click',closeTypeLab);
  $('#labFile').addEventListener('change',async e=>{ const f=e.target.files[0]; if(!f) return; $('#labText').value=await f.text(); e.target.value=''; labCheck(); });
  $('#labExample').addEventListener('change',async e=>{
    const v=e.target.value; e.target.value=''; if(!v) return;
    let def;
    if(v==='starter') def=JSON.parse(JSON.stringify(LAB_STARTER));
    else { try{ def=await (await fetch('types/'+v+'.json')).json(); }catch(err){ toast('Couldn\'t load that example'); return; }
      def.id='my-'+def.id; def.name=def.name.replace(/ \(type file\)$/,'')+' copy'; def.author=''; }
    $('#labText').value=JSON.stringify(def,null,2); labCheck();
  });
  $('#labPrompt').addEventListener('click',async()=>{
    const ask=$('#labAsk').value.trim(); if(!ask){ toast('Describe the box first'); $('#labAsk').focus(); return; }
    let text; try{ text=await typePrompt(ask,$('#labAskEdit').checked?$('#labText').value:''); }catch(e){ toast('Couldn\'t read the format reference — are you offline?'); return; }
    try{ await navigator.clipboard.writeText(text); toast('Prompt copied ('+Math.round(text.length/1000)+'k characters) — paste it into a chat AI'); }
    catch(e){ $('#labText').value=text; toast('Clipboard blocked: the prompt is in the box below; copy it from there'); } });
  $('#labText').addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){ e.preventDefault(); labCheck(); } });
  $('#labCheck').addEventListener('click',()=>labCheck());
  $('#labTry').addEventListener('click',()=>{ const def=labCheck(); if(!def) return; Boxsmith.types.register(def); renderTypeList(); renderLabMine(); S.type=def.id; update(true); toast('Showing '+def.name+' (not saved yet)'); });
  $('#labSave').addEventListener('click',()=>{ const def=labCheck(); if(!def) return;
    if(!labLast||labLast.stage==='format'){ toast('Fix the problems in the file first'); return; }
    if(!keepType(def)){ toast('This browser won\'t let the page save — download the file instead'); return; }
    S.type=def.id; update(true);
    toast(labLast.ok?'Saved '+def.name+' to My types':'Saved '+def.name+', but its parts don\'t fit together yet'); });
  $('#labCopy').addEventListener('click',async()=>{ if(!labLast) return;
    const txt='Boxsmith found these problems in the type file (each line starts with its place in the file). Fix them and send the whole file again.\n\n'+Boxsmith.types.explain(labLast.errors.concat(labLast.warnings||[]));
    try{ await navigator.clipboard.writeText(txt); toast('Copied — paste it to the AI that wrote the file'); }catch(e){ toast('Clipboard blocked by the browser'); } });
  $('#labDownload').addEventListener('click',async()=>{ const def=labParse(); if(!def) return; await saveFile((def.id||'box-type')+'.json',JSON.stringify(def,null,2)); });
  $('#labMine').addEventListener('click',e=>{
    const b=e.target.closest('button[data-act]'); if(!b) return; const id=b.dataset.id, def=Boxsmith.types.get(id); if(!def) return;
    if(b.dataset.act==='use'){ S.type=id; update(true); }
    if(b.dataset.act==='edit'){ $('#labText').value=JSON.stringify(def,null,2); labCheck(); $('#labText').focus(); }
    if(b.dataset.act==='dl') saveFile(id+'.json',JSON.stringify(def,null,2));
    if(b.dataset.act==='rm'){
      const used=(typeof layoutBoxes!=='undefined'?layoutBoxes:[]).filter(x=>x.settings.type===id).length;
      confirmTwice(b,used?'Used by '+used+' box'+(used>1?'es':'')+' in Arrange — click again':'Click again to remove',()=>{
        forgetType(id); toast('Removed '+def.name); });
    }
  });
  return el;
}
// a prompt any chat AI can answer with a type file: the format, one worked example, the user's words
let typeRefText='';
async function typePrompt(ask,current){
  if(!typeRefText) typeRefText=await (await fetch('BOX-TYPES.md')).text();
  const [example,example2]=await Promise.all(['types/open-tray.json','types/box-with-shelf.json'].map(async u=>(await fetch(u)).text()));
  const std=Object.keys(DEFAULTS).filter(k=>!['type','typeParams','assembly'].includes(k));
  const size=fmt(S.W)+' × '+fmt(S.D)+' × '+fmt(S.H)+(S.dimMode==='inside'?' inside':' outside')+', '+fmt(S.t)+' material';
  return [
    'You are writing a box type file for Boxsmith, a laser-cut box generator. The format is described below in full. A type file is JSON only: no code, no comments.',
    '',
    current?'Change this type file as I describe. Keep its "id" unless I ask otherwise.\n\n```json\n'+current.trim()+'\n```':'Write a new type file for this box:',
    '',
    ask,
    '',
    'Rules:',
    '- Reply with the complete JSON file in one ```json block, then at most three short sentences about what you assumed.',
    '- Use "box" parts where the shape allows (Boxsmith then handles fingers, corners and screws), and "panel" parts with "f"/"F" edges for anything else. Panels that join must overlap by one thickness t along the joint, one edge "f" and the other "F".',
    '- Every size should follow from W, D, H, t and your params, so the box works at any size, not just one.',
    '- Give the user settings (params) for what they would want to change. Reuse a standard setting key when it means the same thing.',
    '- Pick a new lower-case "id" with dashes. Don\'t use a built-in style id ('+TYPES.map(t=>t.id).join(', ')+').',
    '- Boxsmith will check the file and build it in 3D. If I paste back problems, each starts with its place in the file (like parts[2].panel.edges[1]); fix them and send the whole file again.',
    '',
    'The user is currently working at '+size+'.',
    'Standard setting keys a param can reuse: '+std.join(', ')+'.',
    '',
    'Two example type files. The built-in Open tray, re-expressed (params, a shaped edge, dividers):',
    '',
    '```json',example.trim(),'```',
    '',
    'A box with a shelf: a "panel" whose finger tabs go through slots ("fingers" holes) in the side walls:',
    '',
    '```json',example2.trim(),'```',
    '',
    '=== The Boxsmith box type format (BOX-TYPES.md) ===',
    '',
    typeRefText.trim()
  ].join('\n');
}
// register a type and keep it in My types; false if the browser won't store it (it stays loaded anyway)
function keepType(def){
  Boxsmith.types.register(def);
  const list=myTypes().filter(d=>d.id!==def.id); list.push(def);
  const ok=saveMyTypes(list);
  renderTypeList(); if($('#labMine')) renderLabMine();
  return ok;
}
function forgetType(id){
  saveMyTypes(myTypes().filter(d=>d.id!==id)); Boxsmith.types.unregister(id);
  if(S.type===id) S.type='closed';
  renderTypeList(); if($('#labMine')) renderLabMine(); update(true);
}
function renderLabMine(){
  const list=Boxsmith.types.list(), saved=new Set(myTypes().map(d=>d.id));
  $('#labMine').innerHTML=list.length?list.map(t=>'<div class="labMine"><div><b>'+esc(t.name)+'</b><span>'+esc(t.id)+(saved.has(t.id)?'':' · not saved')+'</span></div>'
    +'<button class="btn sm" data-act="use" data-id="'+esc(t.id)+'" type="button">Use</button><button class="btn sm" data-act="edit" data-id="'+esc(t.id)+'" type="button">Edit</button>'
    +'<button class="btn sm" data-act="dl" data-id="'+esc(t.id)+'" type="button" aria-label="Download '+esc(t.name)+'">↓</button>'
    +(saved.has(t.id)?'<button class="btn sm" data-act="rm" data-id="'+esc(t.id)+'" type="button">Remove</button>':'')+'</div>').join('')
    :'<p class="hint">None yet. Types you save here stay in this browser; download a file to keep a copy or share it.</p>';
}
// where JSON text first goes wrong (browsers don't all say), or -1
function jsonErrorAt(s){
  let i=0;
  const ws=()=>{ while(i<s.length&&' \t\n\r'.includes(s[i])) i++; };
  const fail=()=>{ throw i; };
  const str=()=>{ i++; while(i<s.length){ const c=s[i]; if(c==='\\') i+=2; else if(c==='"'){ i++; return; } else if(c<' ') fail(); else i++; } fail(); };
  const value=()=>{
    ws(); const c=s[i];
    if(c==='{'||c==='['){ const close=c==='{'?'}':']'; i++; ws(); if(s[i]===close){ i++; return; }
      for(;;){ ws(); if(close==='}'){ if(s[i]!=='"') fail(); str(); ws(); if(s[i]!==':') fail(); i++; } value(); ws(); if(s[i]===','){ i++; continue; } if(s[i]===close){ i++; return; } fail(); } }
    if(c==='"'){ str(); return; }
    for(const w of ['true','false','null']) if(s.startsWith(w,i)){ i+=w.length; return; }
    const m=/-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y; m.lastIndex=i; if(m.exec(s)&&m.lastIndex>i){ i=m.lastIndex; return; }
    fail();
  };
  try{ value(); ws(); if(i<s.length) fail(); return -1; }catch(at){ return typeof at==='number'?at:-1; }
}
// the text as JSON, with the line and column of a syntax error
function labParse(){
  const txt=$('#labText').value;
  if(!txt.trim()){ labShow({stage:'format',errors:[{path:'',message:'Paste a type file, open one, or start from an example.'}],warnings:[]}); return null; }
  try{ return JSON.parse(txt); }
  catch(e){
    const at=jsonErrorAt(txt); let where='';
    if(at>=0){ const before=txt.slice(0,at).split('\n'), line=txt.split('\n')[before.length-1]||'';
      where=' at line '+before.length+', column '+(before[before.length-1].length+1)+': '+(at>=txt.length?'the text ends too soon (a missing } or ]?)':'“'+line.trim().slice(0,60)+'”'); }
    labShow({stage:'format',errors:[{path:'',message:'This isn\'t valid JSON'+(where||' ('+e.message+')')+'. Check for a missing comma or quote, or a comma after the last item.'}],warnings:[]});
    return null;
  }
}
function labCheck(){
  const def=labParse(); if(!def) return null;
  const settings=Object.assign({},S); delete settings.type;
  // only this type's own settings, and only ones the file still has
  const keys=new Set((Array.isArray(def.params)?def.params:[]).map(p=>p&&p.key));
  const own=((S.typeParams||{})[def.id])||{}; settings.typeParams={[def.id]:Object.fromEntries(Object.entries(own).filter(([k])=>keys.has(k)))};
  let r; try{ r=Boxsmith.types.check(def,settings); }catch(e){ r={stage:'build',errors:[{path:'',message:e.message}],warnings:[]}; }
  labShow(r);
  return def;
}
function labShow(r){
  labLast=r;
  const stageText={format:'The file has problems',build:'It doesn\'t build at this size',fit:'The parts don\'t fit together',done:'Fits'};
  const li=x=>'<li>'+(x.path?'<code>'+esc(x.path)+'</code> ':'')+esc(x.message)+'</li>';
  const ok=r.ok&&r.stage==='done';
  $('#labReport').innerHTML='<div class="labStatus '+(ok?'ok':'bad')+'">'+(ok?'✓ ':'')+stageText[r.stage||'format']
     +(ok&&r.parts?' — '+r.parts+' parts, '+fmt(r.size.W)+' × '+fmt(r.size.D)+' × '+fmt(r.size.H):'')+'</div>'
     +(r.errors&&r.errors.length?'<ul class="labErr">'+r.errors.slice(0,30).map(li).join('')+(r.errors.length>30?'<li>…and '+(r.errors.length-30)+' more</li>':'')+'</ul>':'')
     +(r.warnings&&r.warnings.length?'<ul class="labWarn">'+r.warnings.slice(0,10).map(li).join('')+'</ul>':'')
     +(ok?'<p class="hint">Checked at the size and material in the sidebar. Try a few other sizes and settings too.</p>':'');
  $('#labCopy').classList.toggle('hidden',!(r.errors&&r.errors.length)&&!(r.warnings&&r.warnings.length));
}
function openTypeLab(){
  const el=labEl(); el.classList.remove('hidden'); document.body.classList.add('lab-open'); renderLabMine();
  const def=customTypeDef(S.type);
  if(!$('#labText').value.trim()) $('#labText').value=JSON.stringify(def||LAB_STARTER,null,2);
  labCheck();
}
function closeTypeLab(){ const el=$('#typeLab'); if(el) el.classList.add('hidden'); document.body.classList.remove('lab-open'); }

$('#typeParamsEdit').addEventListener('click',()=>{ const def=customTypeDef(S.type); openTypeLab(); if(def){ $('#labText').value=JSON.stringify(def,null,2); labCheck(); } });
syncTypeParams();
