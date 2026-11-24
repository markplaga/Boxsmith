'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.Boxsmith=api;
})(globalThis,function(){
  const TYPES = [
    {id:'closed', name:'Closed box', d:'All six sides', ic:'closed'},
    {id:'open', name:'Open tray', d:'No top', ic:'open'},
    {id:'liftoff', name:'Lift-off lid', d:'Lid + locator ring', ic:'liftoff'},
    {id:'split', name:'Split lid', d:'Deep cap lid', ic:'split'},
    {id:'sliding', name:'Sliding lid', d:'Lid slides in rails', ic:'sliding'},
    {id:'hinged', name:'Hinged lid', d:'Pin hinge, opens back', ic:'hinged'},
    {id:'drawer', name:'Drawer cabinet', d:'1–8 drawers + sleeve', ic:'drawer'},
    {id:'polygon', name:'Polygon box', d:'Hex, octagon, any n', ic:'polygon'},
    {id:'rounded', name:'Rounded box', d:'Living-hinge corners', ic:'rounded'},
    {id:'pencil', name:'Pencil box', d:'Swivel lid on a pin', ic:'pencil'},
    {id:'card', name:'Card file box', d:'Sloped sides + index cards', ic:'card'},
    {id:'nested', name:'Nested set', d:'Boxes inside boxes', ic:'nested'},
    {id:'puzzle', name:'Puzzle box', d:'Hidden gravity lock', ic:'puzzle'},
    {id:'book', name:'Book box', d:'Living-hinge spine', ic:'book'},
    {id:'display', name:'Display case', d:'Acrylic cover, wood base', ic:'display'},
    {id:'frame', name:'Frame (torus)', d:'Ring box with a hole through it', ic:'frame'},
    {id:'cubeframe', name:'Cube frame', d:'Hollow cube, open through every side', ic:'cubeframe'},
    {id:'kerftest', name:'Kerf test', d:'Dial in your fit', ic:'kerftest'},
  ];
  const DEFAULTS = {
    type:'closed', corners:'classic', unit:'mm', dimMode:'outside', W:120, D:90, H:70, sides:6,
    t:3, kerf:0.15, fw:10, clr:0.3, lidH:22, overhang:0, ringW:6, pin:3, capLip:5,
    polyTop:'lift', frameW:24, beamW:22, paint:'none', paintColor:'#3a7bd5', paintStrength:60, lip:4, strips:true, drawers:2, pull:'slot', pullH:14, handleH:22, notchH:14, decoScale:100, radius:22, hPitch:2, hBridge:4,
    cols:1, rows:1, divPct:85, handles:false, notch:false, text:'', textSize:9, font:'Georgia, serif',
    kStep:0.03, sheetW:600, sheetH:400, gap:4, stroke:'0.1', labels:false,
    fit:'press', tslot:'off', screwLen:12, bit:0, rimW:9, frontPct:55, cardDivs:3, nestN:3, tAcr:3, baseM:10,
    textMode:'engrave', textAlign:'center', textColor:'#000000', textFill:false, textOutlineOn:false, textOutline:'#1b1b1b', textLine:0, frame:'none', frameGap:4, frameLine:1, frameCount:1, frameSpacing:3, frameBands:[], accent:'none', accentOn:'top', accentSize:14, accentLine:0.8, accentMode:'fill', deco:'none', decoOn:'walls', decoCell:16, decoWeb:3, decoSeed:7, cornerStyle:'square', cornerR:6, art:[],
    qty:1, holdTabs:0, holdW:0.4, layerScheme:'simple', grain:false, sheetPrice:8, rate:30, speed:18, markup:150, matName:'',
    typeParams:{}   // custom box types' own settings: {typeId: {key: value}}
  };
  /* Custom box types (box-types.js format), by id. They list, build and save like the built-in styles. */
  const BoxTypes=typeof module==='object'&&module.exports&&typeof require==='function'?require('./box-types.js'):globalThis.BoxTypes;
  const CUSTOM=new Map();
  const typeEntry=def=>({id:def.id,name:def.name,d:def.description||'',ic:def.icon||'closed',custom:true});
  const allTypes=()=>TYPES.concat([...CUSTOM.values()].map(typeEntry));
  // the shape and formulas, plus: a param that adopts one of Boxsmith's own settings must match its kind
  function validateTypeDef(def){
    if(!BoxTypes) throw new Error('box-types.js is not loaded');
    const res=BoxTypes.validateType(def,{standardKeys:Object.keys(DEFAULTS),builtInIds:TYPES.map(x=>x.id)});
    if(res.ok) for(const [i,p] of (def.params||[]).entries()) if(Object.hasOwn(DEFAULTS,p.key)){
      const d=DEFAULTS[p.key], ok=typeof d==='number'?['length','number','integer'].includes(p.kind):typeof d==='boolean'?p.kind==='bool':typeof d==='string'?['text','choice','color'].includes(p.kind):false;
      if(!ok||p.key==='typeParams'||p.key==='type'){ res.errors.push({path:'params['+i+'].kind',message:'"'+p.key+'" is one of Boxsmith\'s own settings, which is '+(typeof d==='number'?'a number':typeof d==='boolean'?'true/false':'text')+'; use a matching kind, or another key.'}); res.ok=false; }
    }
    return res;
  }

  /** Material looks a box can keep in a layout (the 3D preview's material list). */
  const LOOKS=['birch','walnut','mdf','clear','black','pink','card'];
  const checkLook=look=>{ if(look!==undefined&&!LOOKS.includes(look)) throw new RangeError('look must be one of: '+LOOKS.join(', ')); };
  const HEX=/^#[0-9a-fA-F]{6}$/;
  /** colors: {'*': whole box, 'Part name': that part} → '#rrggbb'. */
  const checkColors=colors=>{
    if(colors===undefined) return;
    if(!isRecord(colors)) throw new TypeError("colors must be an object like {'*':'#3a7bd5','Cover top':'#ff4080'}");
    for(const [part,hex] of Object.entries(colors)) if(typeof hex!=='string'||!HEX.test(hex)) throw new TypeError('color for '+part+" must be '#rrggbb'");
  };

  const FORMAT='boxsmith-layout';
  const VERSION=1;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

  function requireType(type){
    if(!TYPES.some(box=>box.id===type)&&!CUSTOM.has(type)) throw new RangeError('Unknown box type: '+type);
  }
  // a custom type's own settings: known keys, the right kind, inside min and max
  function checkTypeParams(tp){
    if(!isRecord(tp)) throw new TypeError('typeParams must be an object like {"my-type": {"lip": 8}}');
    for(const [id,values] of Object.entries(tp)){
      const def=CUSTOM.get(id);
      if(!isRecord(values)) throw new TypeError('typeParams.'+id+' must be an object');
      if(!def) continue;   // settings for a type not loaded right now are kept as they are
      for(const [k,v] of Object.entries(values)){
        const p=(def.params||[]).find(x=>x.key===k&&!Object.hasOwn(DEFAULTS,x.key));
        if(!p) throw new RangeError(id+' has no setting called '+k);
        const isNum=['length','number','integer'].includes(p.kind);
        if(isNum&&!Number.isFinite(v)) throw new TypeError(id+'.'+k+' must be a number');
        if(p.kind==='integer'&&!Number.isInteger(v)) throw new TypeError(id+'.'+k+' must be a whole number');
        if(isNum&&((p.min!==undefined&&v<p.min)||(p.max!==undefined&&v>p.max))) throw new RangeError(id+'.'+k+' must be from '+(p.min??'-∞')+' to '+(p.max??'∞'));
        if(p.kind==='bool'&&typeof v!=='boolean') throw new TypeError(id+'.'+k+' must be true or false');
        if(['text','choice','color'].includes(p.kind)&&typeof v!=='string') throw new TypeError(id+'.'+k+' must be text');
        if(p.kind==='choice'&&!p.choices.some(c=>(c.value??c)===v)) throw new RangeError(id+'.'+k+' must be one of '+p.choices.map(c=>c.value??c).join(', '));
        if(p.kind==='color'&&!/^#[0-9a-f]{6}$/i.test(v)) throw new TypeError(id+'.'+k+" must look like '#3a7bd5'");
      }
    }
  }

  function createBox(type,parameters={}){
    requireType(type);
    if(!isRecord(parameters)) throw new TypeError('Box parameters must be an object');
    checkLook(parameters.look); checkColors(parameters.colors);
    if(parameters.typeParams!==undefined) checkTypeParams(parameters.typeParams);
    for(const [key,value] of Object.entries(parameters)){
      if(key==='look'||key==='colors'||key==='typeParams') continue;
      if(key==='type'||!Object.hasOwn(DEFAULTS,key)) throw new RangeError('Unknown box parameter: '+key);
      const expected=DEFAULTS[key];
      const valid=Array.isArray(expected)?Array.isArray(value):
        typeof expected==='number'?Number.isFinite(value):typeof value===typeof expected;
      if(!valid) throw new TypeError('Invalid value for box parameter: '+key);
    }
    if(parameters.paint!==undefined&&!['none','watercolor','acrylic'].includes(parameters.paint)) throw new RangeError('paint must be none, watercolor or acrylic');
    if(parameters.paintColor!==undefined&&!/^#[0-9a-f]{6}$/i.test(parameters.paintColor)) throw new RangeError('paintColor must look like #rrggbb');
    if(parameters.paintStrength!==undefined&&(parameters.paintStrength<10||parameters.paintStrength>100)) throw new RangeError('paintStrength must be between 10 and 100');
    if(parameters.unit!==undefined&&parameters.unit!=='mm'&&parameters.unit!=='in') throw new RangeError('unit must be mm or in');
    return clone({...DEFAULTS,...parameters,type});
  }

  function triple(value,name){
    if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite)){
      throw new TypeError(name+' must contain three finite numbers');
    }
    return value.slice();
  }

  function placeBox(settings,{position=[0,0,0],rotation=[0,0,0],hidden=false}={}){
    if(!isRecord(settings)) throw new TypeError('Box settings must be an object');
    requireType(settings.type);
    if(typeof hidden!=='boolean') throw new TypeError('hidden must be a boolean');
    checkLook(settings.look); checkColors(settings.colors);
    return {settings:clone(settings),position:triple(position,'position'),rotation:triple(rotation,'rotation'),hidden};
  }

  /* Groups: boxes that move as one unit in animations. [{id, boxes:[index,…], origin:[x,y,z] (mm, the
     pivot), parent?:id, noFrame?:true}]. A box belongs to at most one group (its innermost); groups
     nest through parent. Membership can also be given as box.group = id. Returned with each group's
     direct members in boxes, sorted; files without groups have no groups key. */
  function normalizeGroups(groups,boxes){
    if(groups===undefined||groups===null) groups=[];
    if(!Array.isArray(groups)) throw new TypeError('groups must be an array');
    const byId=new Map(), owner=new Array(boxes.length).fill(null);
    for(const g of groups){
      if(!isRecord(g)) throw new TypeError('Each group must be an object');
      if(typeof g.id!=='string'||!/^[\w.:-]{1,64}$/.test(g.id)) throw new TypeError('group id must be 1-64 letters, digits, _ . : or -');
      if(byId.has(g.id)) throw new RangeError('Two groups are called '+g.id);
      if(g.parent!==undefined&&g.parent!==null&&typeof g.parent!=='string') throw new TypeError('group '+g.id+': parent must be a group id');
      if(g.noFrame!==undefined&&typeof g.noFrame!=='boolean') throw new TypeError('group '+g.id+': noFrame must be true or false');
      byId.set(g.id,{id:g.id,origin:triple(g.origin??[0,0,0],'group '+g.id+' origin'),...(g.parent?{parent:g.parent}:{}),...(g.noFrame?{noFrame:true}:{}),boxes:[]});
      for(const i of g.boxes??[]){
        if(!Number.isInteger(i)||i<0||i>=boxes.length) throw new RangeError('group '+g.id+': there is no box '+i);
        if(owner[i]!==null&&owner[i]!==g.id) throw new RangeError('box '+i+' is in two groups ('+owner[i]+' and '+g.id+')');
        owner[i]=g.id;
      }
    }
    boxes.forEach((b,i)=>{ if(b&&typeof b.group==='string'){
      if(!byId.has(b.group)) throw new RangeError('box '+i+': there is no group '+b.group);
      if(owner[i]!==null&&owner[i]!==b.group) throw new RangeError('box '+i+' is in two groups ('+owner[i]+' and '+b.group+')');
      owner[i]=b.group; } });
    for(const g of byId.values()){
      if(g.parent!==undefined&&!byId.has(g.parent)) throw new RangeError('group '+g.id+': there is no parent group '+g.parent);
      const seen=new Set([g.id]); for(let p=g.parent;p!==undefined;p=byId.get(p).parent){ if(seen.has(p)) throw new RangeError('groups '+[...seen].join(', ')+' are their own parents'); seen.add(p); }
    }
    owner.forEach((id,i)=>{ if(id!==null) byId.get(id).boxes.push(i); });
    return [...byId.values()];
  }

  function createAssembly({boxes=[],unit='mm',groups}={}){
    if(!Array.isArray(boxes)) throw new TypeError('boxes must be an array');
    if(unit!=='mm'&&unit!=='in') throw new RangeError('unit must be mm or in');
    const placed=boxes.map(box=>{
      if(!isRecord(box)) throw new TypeError('Each placement must be an object');
      const rotation=box.rotation??[0,0,box.angle??0];
      return placeBox(box.settings,{...box,rotation});
    });
    const grouped=normalizeGroups(groups,boxes);
    const file={format:FORMAT,version:VERSION,unit,boxes:placed};
    if(grouped.length) file.groups=grouped;
    return file;
  }

  const asFile=input=>createAssembly(typeof input==='string'?JSON.parse(input):input);
  const needIndex=(file,index)=>{ if(!Number.isInteger(index)||index<0||index>=file.boxes.length) throw new RangeError('No box at index '+index); };

  /** Edit helpers: each returns a new layout and leaves the one you passed in alone. */
  function addToAssembly(assembly,placement){
    const file=asFile(assembly);
    const item=isRecord(placement)&&placement.settings?placement:placeBox(placement);
    file.boxes.push(placeBox(item.settings,item));
    return file;
  }
  function removeFromAssembly(assembly,index){
    const file=asFile(assembly); needIndex(file,index);
    file.boxes.splice(index,1);
    for(const g of file.groups||[]) g.boxes=g.boxes.filter(i=>i!==index).map(i=>i>index?i-1:i);
    return file;
  }
  function duplicateInAssembly(assembly,index,{offset=[0,0,0]}={}){
    const file=asFile(assembly); needIndex(file,index);
    const source=file.boxes[index], shift=triple(offset,'offset');
    file.boxes.splice(index+1,0,placeBox(source.settings,{...source,position:source.position.map((v,i)=>v+shift[i])}));
    for(const g of file.groups||[]) g.boxes=g.boxes.map(i=>i>index?i+1:i);   // the copy is in no group
    return file;
  }
  /** Colour one part of a box (by its part name), or the whole box with part '*' (the default). color null removes it. */
  function colorInAssembly(assembly,index,{part='*',color}={}){
    const file=asFile(assembly); needIndex(file,index);
    if(typeof part!=='string'||!part) throw new TypeError('part must be a part name or *');
    if(color!==null&&(typeof color!=='string'||!HEX.test(color))) throw new TypeError("color must be '#rrggbb' or null");
    const settings=clone(file.boxes[index].settings), colors=Object.assign({},settings.colors);
    if(color===null) delete colors[part]; else colors[part]=color;
    if(Object.keys(colors).length) settings.colors=colors; else delete settings.colors;
    file.boxes[index]=placeBox(settings,file.boxes[index]);
    return file;
  }
  function updateInAssembly(assembly,index,changes={}){
    const file=asFile(assembly); needIndex(file,index);
    const source=file.boxes[index];
    file.boxes[index]=placeBox(changes.settings??source.settings,{
      position:changes.position??source.position,rotation:changes.rotation??source.rotation,hidden:changes.hidden??source.hidden});
    return file;
  }

  function parseAssembly(input){
    const file=typeof input==='string'?JSON.parse(input):input;
    if(file?.format!==FORMAT) throw new TypeError('Not a Boxsmith layout file');
    if(file.version!==VERSION) throw new RangeError('This layout file uses an unsupported version');
    if(!Array.isArray(file.boxes)||file.unit==null) throw new TypeError('Invalid Boxsmith layout file');
    return createAssembly(file);
  }

  return {
    version:VERSION,
    looks:LOOKS.slice(),
    boxes:{list:()=>clone(allTypes()),defaults:(type='closed')=>createBox(type),create:createBox},
    /** Box type files: validate(def) → {ok, errors, warnings}; register(def) adds it (replacing one with
        the same id) so it lists, builds and saves like a built-in style; get(id), list(), unregister(id).
        The engine adds check(def, settings), which also builds it and tests that the parts fit. */
    types:{
      format:BoxTypes?BoxTypes.FORMAT:'boxsmith-type',
      validate:def=>clone(validateTypeDef(def)),
      register(def){
        const res=validateTypeDef(def);
        if(!res.ok){ const e=new TypeError('This box type has problems:\n'+BoxTypes.explain(res.errors)); e.errors=res.errors; throw e; }
        CUSTOM.set(def.id,clone(def));
        return typeEntry(def);
      },
      unregister:id=>CUSTOM.delete(id),
      get:id=>CUSTOM.has(id)?clone(CUSTOM.get(id)):null,
      list:()=>[...CUSTOM.values()].map(typeEntry),
      explain:list=>BoxTypes.explain(list),
      /** The formula language on its own: formula('2*t + W/2', {t:3, W:100}) → 56; template('Strip {k}', {k:'A'}) → 'Strip A'. */
      formula:(src,env={})=>clone(BoxTypes.formula(String(src),Object.assign({},env),{})),
      template:(text,env={})=>BoxTypes.template(String(text),Object.assign({},env),{},{})
    },
    assemblies:{
      format:FORMAT,
      place:placeBox,
      create:createAssembly,
      add:addToAssembly,
      remove:removeFromAssembly,
      duplicate:duplicateInAssembly,
      update:updateInAssembly,
      color:colorInAssembly,
      parse:parseAssembly,
      serialize:assembly=>JSON.stringify(parseAssembly(assembly),null,2)
    }
  };
});
