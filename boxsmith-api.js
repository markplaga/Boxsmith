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
    qty:1, holdTabs:0, holdW:0.4, layerScheme:'simple', grain:false, sheetPrice:8, rate:30, speed:18, markup:150, matName:''
  };

  const FORMAT='boxsmith-layout';
  const VERSION=1;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

  function requireType(type){
    if(!TYPES.some(box=>box.id===type)) throw new RangeError('Unknown box type: '+type);
  }

  function createBox(type,parameters={}){
    requireType(type);
    if(!isRecord(parameters)) throw new TypeError('Box parameters must be an object');
    for(const [key,value] of Object.entries(parameters)){
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
    return {settings:clone(settings),position:triple(position,'position'),rotation:triple(rotation,'rotation'),hidden};
  }

  function createAssembly({boxes=[],unit='mm'}={}){
    if(!Array.isArray(boxes)) throw new TypeError('boxes must be an array');
    if(unit!=='mm'&&unit!=='in') throw new RangeError('unit must be mm or in');
    const placed=boxes.map(box=>{
      if(!isRecord(box)) throw new TypeError('Each placement must be an object');
      const rotation=box.rotation??[0,0,box.angle??0];
      return placeBox(box.settings,{...box,rotation});
    });
    return {format:FORMAT,version:VERSION,unit,boxes:placed};
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
    return file;
  }
  function duplicateInAssembly(assembly,index,{offset=[0,0,0]}={}){
    const file=asFile(assembly); needIndex(file,index);
    const source=file.boxes[index], shift=triple(offset,'offset');
    file.boxes.splice(index+1,0,placeBox(source.settings,{...source,position:source.position.map((v,i)=>v+shift[i])}));
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
    boxes:{list:()=>clone(TYPES),defaults:(type='closed')=>createBox(type),create:createBox},
    assemblies:{
      format:FORMAT,
      place:placeBox,
      create:createAssembly,
      add:addToAssembly,
      remove:removeFromAssembly,
      duplicate:duplicateInAssembly,
      update:updateInAssembly,
      parse:parseAssembly,
      serialize:assembly=>JSON.stringify(parseAssembly(assembly),null,2)
    }
  };
});
