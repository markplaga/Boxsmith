'use strict';

const BOX_LAYOUT_KEY='boxsmith-box-layout-v1';
/* Groups: boxes that move together in animations, nesting through parent. layoutGroups holds
   {id, origin (mm, the pivot), parent?, noFrame?}; a box names its group in box.group. Box positions
   are where the box sits at rest. While an animation moves a group, layoutGroupPose holds its pose
   {position (where the origin is), rotation (degrees, ZYX), scale}; each member is drawn at
   groupWorld(id) × its own pose, chained through the parents, so the pieces move as one rigid unit. */
let layoutGroups=[];
const layoutGroupPose=new Map();
let groupWorldCache=new Map();
const groupById=id=>layoutGroups.find(g=>g.id===id);
function setGroupPoses(poses){ layoutGroupPose.clear(); for(const [id,p] of Object.entries(poses||{})) layoutGroupPose.set(id,p); groupWorldCache=new Map(); }
// This group's transform from its rest place to where it is now (chained through its parents), or null at rest.
function groupWorld(id){
  if(!layoutGroupPose.size||!id) return null;
  if(groupWorldCache.has(id)) return groupWorldCache.get(id);
  const g=groupById(id); let m=null;
  if(g){
    const p=layoutGroupPose.get(id);
    if(p){
      const o=g.origin, r=p.rotation||[0,0,0], s=p.scale===undefined?1:p.scale, pos=p.position||o;
      m=new THREE.Matrix4().makeTranslation(pos[0],pos[1],pos[2])
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0]*PI/180,r[1]*PI/180,r[2]*PI/180,'ZYX')))
        .multiply(new THREE.Matrix4().makeScale(s,s,s))
        .multiply(new THREE.Matrix4().makeTranslation(-o[0],-o[1],-o[2]));
    }
    const up=g.parent?groupWorld(g.parent):null;
    if(up) m=m?up.clone().multiply(m):up;
  }
  groupWorldCache.set(id,m);
  return m;
}
// Carry a box along with its group (after its own pose is worked out). Nothing happens at rest.
function applyGroupTransform(box){
  const W=box.group&&groupWorld(box.group); if(!W) return;
  box.pose.premultiply(W);
  if(box.bounds&&box.bounds.isBox3) box.bounds.applyMatrix4(W);
  if(box.partBounds) for(const pieces of box.partBounds) for(const b of pieces) if(b&&b.isBox3) b.applyMatrix4(W);
  if(box.opening) box.opening.applyMatrix4(W);
}
// The group a box is in, and every group around that one.
function groupChain(id){ const out=[]; for(let g=groupById(id);g&&!out.includes(g);g=g.parent?groupById(g.parent):null) out.push(g); return out; }
// Every box in this group or in a group inside it.
const groupMembers=id=>layoutBoxes.filter(b=>b.group&&groupChain(b.group).some(g=>g.id===id));
let layoutBoxes=[], layoutSelection=-1, placingBox=false, layoutPart=null;   // layoutPart: name of one part picked inside the selected box
let boxLayoutScene={solids:[],ctr:[0,0,0],R:100};
const layingOut=()=>curView==='layout';
let layoutCamera={yaw:-0.6,pitch:0.6,zoom:1,stereo:'off',stereoDeg:3.5}, boxPreviewCamera;

function switchBoxLayoutCamera(){
  const {yaw,pitch,zoom,stereo,stereoDeg}=view;
  const camera={yaw,pitch,zoom,stereo,stereoDeg};
  if(layingOut()){
    boxPreviewCamera=camera;
    Object.assign(view,layoutCamera);
  } else {
    layoutCamera=camera;
    Object.assign(view,boxPreviewCamera);
  }
}

// `cache` (a Map) lets many boxes with the same settings share one generated set of parts.
function makeLayoutBox(settings, position=[0,0,0], rotation=[0,0,0], hidden=false, cache=null){
  const previousSettings=S, previousGeometry=G;
  try{
    S=Object.assign({},DEFAULTS,settings);
    G=geometryContext();
    const key=cache?JSON.stringify(settings):'';
    let parts=cache&&cache.get(key);
    if(!parts){
      const result=generate();
      decorate(result.parts,result.warns);
      parts=result.parts;
      if(cache) cache.set(key,parts);
    }
    const model=makeScene(parts);
    if(!model.solids.length) throw new Error('No box geometry');
    return {settings,position,rotation,hidden,model};
  } finally {
    S=previousSettings;
    G=previousGeometry;
  }
}

function transformLayoutBox(box){
  const {ctr,solids}=box.model;
  const [rx,ry,rz]=box.rotation.map(degrees=>degrees*PI/180);
  box.pose=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx,ry,rz,'ZYX'))
    .multiply(new THREE.Matrix4().makeTranslation(-ctr[0],-ctr[1],-ctr[2]));

  // Use the lowest point of the rotated geometry as the base height.
  const bounds=new THREE.Box3(), point=new THREE.Vector3();
  const loopBox=loop=>{
    const part=new THREE.Box3();
    for(const vertex of loop) part.expandByPoint(point.fromArray(vertex).applyMatrix4(box.pose));
    return part;
  };
  const parts=solids.map(solid=>{
    const part=loopBox(solid.bot[0]).union(loopBox(solid.top[0]));
    bounds.union(part);
    return ringPieces(part,solid,box.pose);
  });
  const [x,y,z]=box.position;
  const offset=new THREE.Vector3(x,y,z-bounds.min.z);
  box.pose.setPosition(point.setFromMatrixPosition(box.pose).add(offset));
  box.bounds=bounds.translate(offset);
  box.partBounds=parts.map(pieces=>pieces.map(piece=>piece.translate(offset)));
  // opening through a Frame (horizontal plates only), used for snapping boxes inside it
  const open=parts.find(pieces=>pieces.hole&&pieces.hole.getSize(new THREE.Vector3()).z<0.01);
  box.opening=open?open.hole.clone().translate(offset):null;
  applyGroupTransform(box);
}

// A flat plate with a big opening (a Frame's top and bottom) is represented by
// the four strips around the opening, so things sitting in the opening are not
// reported as overlapping it. Other parts stay a single bounding box.
function ringPieces(part,solid,pose){
  if(!solid.bot||solid.bot.length<2) return [part];
  const point=new THREE.Vector3(), size=part.getSize(new THREE.Vector3()).toArray();
  const flat=size.indexOf(Math.min(...size)), [a,b]=[0,1,2].filter(k=>k!==flat);
  const ks=['x','y','z'];
  let hole=null;
  for(const loop of solid.bot.slice(1)){
    const h=new THREE.Box3();
    for(const v of loop) h.expandByPoint(point.fromArray(v).applyMatrix4(pose));
    const area=(h.max[ks[a]]-h.min[ks[a]])*(h.max[ks[b]]-h.min[ks[b]]);
    if(!hole||area>hole.area) hole={box:h,area};
  }
  if(!hole||hole.area<0.3*size[a]*size[b]) return [part];
  const H=hole.box, A=ks[a], B=ks[b];
  const mk=(a0,a1,b0,b1)=>{
    if(a1-a0<=0.01||b1-b0<=0.01) return null;
    const p=part.clone(); p.min[A]=a0; p.max[A]=a1; p.min[B]=b0; p.max[B]=b1; return p;
  };
  const pieces=[
    mk(part.min[A],H.min[A],part.min[B],part.max[B]),
    mk(H.max[A],part.max[A],part.min[B],part.max[B]),
    mk(H.min[A],H.max[A],part.min[B],H.min[B]),
    mk(H.min[A],H.max[A],H.max[B],part.max[B])
  ].filter(Boolean);
  pieces.hole=H;
  return pieces;
}

// Pairs of visible boxes whose individual parts intersect. Parts are compared
// one by one, so a box sitting inside a Frame's opening is not a false alarm.
function layoutOverlaps(list=layoutBoxes){
  const EPS=0.05, pairs=[];
  for(let i=0;i<list.length;i++){
    for(let j=i+1;j<list.length;j++){
      const a=list[i], b=list[j];
      if(a.hidden||b.hidden||!a.bounds||!b.bounds) continue;
      const near=a.bounds.clone().expandByScalar(-EPS);
      if(!near.intersectsBox(b.bounds)) continue;
      const hit=a.partBounds.some(pa=>pa.some(x=>{
        const p=x.clone().expandByScalar(-EPS);
        return b.partBounds.some(pb=>pb.some(y=>p.intersectsBox(y)));
      }));
      if(hit) pairs.push([i,j]);
    }
  }
  return pairs;
}

// Move `box` flush against a face of `target` (world axes), or into a Frame's
// opening with side 'in:c', 'in:-x', 'in:+x', 'in:-y' or 'in:+y' (the wall's own
// thickness is allowed for). Works on plain layout boxes, with no page needed.
// Returns null on success, or a message saying why it could not.
function snapBoxes(box,target,side,gap=0){
  if(!box||!target||box===target) return 'Pick two different boxes.';
  const B=box.bounds, T=target.bounds, bc=B.getCenter(new THREE.Vector3());
  let d;
  if(String(side).startsWith('in:')){
    const O=target.opening, where=side.slice(3);
    if(!O) return 'That box has no opening to snap into. Pick a Frame.';
    if(!['c','-x','+x','-y','+y'].includes(where)) return 'Unknown side: '+side;
    const wall=+target.settings.t||0, oc=O.getCenter(new THREE.Vector3());
    d=[oc.x-bc.x,oc.y-bc.y,T.min.z-B.min.z];
    if(where==='-x') d[0]=O.min.x+wall+gap-B.min.x;
    if(where==='+x') d[0]=O.max.x-wall-gap-B.max.x;
    if(where==='-y') d[1]=O.min.y+wall+gap-B.min.y;
    if(where==='+y') d[1]=O.max.y-wall-gap-B.max.y;
  } else {
    if(!/^[+-][xyz]$/.test(side)) return 'Unknown side: '+side;
    const tc=T.getCenter(new THREE.Vector3());
    d=[tc.x-bc.x,tc.y-bc.y,T.min.z-B.min.z];
    const axis={x:0,y:1,z:2}[side[1]], k=side[1];
    d[axis]=side[0]==='+'?T.max[k]+gap-B.min[k]:T.min[k]-gap-B.max[k];
  }
  for(let i=0;i<3;i++) box.position[i]=Math.round((box.position[i]+d[i])*1000)/1000;
  transformLayoutBox(box);
  return null;
}

// The Arrange tab's Snap button.
function snapLayoutBox(targetIndex,side,gap){
  const box=layoutBoxes[layoutSelection], target=layoutBoxes[targetIndex];
  if(!box||!target||box===target) return false;
  const problem=snapBoxes(box,target,side,gap);
  if(problem){ toast(problem); return false; }
  saveBoxLayout(); render();
  return true;
}

// The camera's framing (centre and radius) comes from every box except those marked
// settings.noFrame (a big ground slab, a backdrop): they still draw, but don't move or shrink the shot.
// If every box is marked, all of them count.
const framesCamera=box=>!box.settings.noFrame&&!(box.group&&groupChain(box.group).some(g=>g.noFrame));
// Mark a box as ground/backdrop (true) or part of the subject (false). Re-frames the layout.
function setLayoutNoFrame(index,on){
  const box=layoutBoxes[index]; if(!box) return false;
  if(on) box.settings.noFrame=true; else delete box.settings.noFrame;
  fitBoxLayout(); saveBoxLayout(); render(); syncBoxLayout();
  return true;
}
function fitBoxLayout(){
  const bounds=new THREE.Box3(), counted=layoutBoxes.some(framesCamera)?layoutBoxes.filter(framesCamera):layoutBoxes;
  for(const box of counted) bounds.union(box.bounds);
  boxLayoutScene.ctr=bounds.getCenter(new THREE.Vector3()).toArray();
  boxLayoutScene.R=Math.max(10,bounds.getSize(new THREE.Vector3()).length()/2||100);
}

function rebuildBoxLayout(){
  boxLayoutScene.solids=layoutBoxes.flatMap(box=>{
    transformLayoutBox(box);
    for(const solid of box.model.solids) solid.layoutBox=box;
    return box.model.solids;
  });
  fitBoxLayout();
  if(layingOut()) buildGL(boxLayoutScene);
}

function restoreLayoutBox(entry,cache){
  const rotation=entry?.rotation??[0,0,entry?.angle];
  const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
  if(!entry?.settings || !(TYPES.some(type=>type.id===entry.settings.type)||customTypeDef(entry.settings.type))
    || !vector(entry.position) || !vector(rotation)) throw new Error('Invalid box in layout');
  return makeLayoutBox(entry.settings,entry.position,rotation,entry.hidden===true,cache);
}

function loadBoxLayout(){
  const raw=lsGet(BOX_LAYOUT_KEY,[]), stored=Array.isArray(raw)?raw:raw&&Array.isArray(raw.boxes)?raw.boxes:null;
  if(!stored) return;
  for(const entry of stored){
    try{
      if(entry?.settings&&!MATS[entry.settings.look]) entry.settings.look=view.mat;
      const box=restoreLayoutBox(entry); if(typeof entry.group==='string') box.group=entry.group;
      layoutBoxes.push(box);
    }
    catch(error){ console.warn('Could not load a box in the layout',error); }
  }
  if(raw&&!Array.isArray(raw)&&Array.isArray(raw.groups)){
    try{ const file=Boxsmith.assemblies.create({boxes:boxLayoutRecords(),groups:raw.groups}); for(const b of layoutBoxes) delete b.group; adoptGroups(file.groups,layoutBoxes); }
    catch(error){ console.warn('Could not load the layout groups',error); for(const b of layoutBoxes) delete b.group; }
  }
  rebuildBoxLayout();
}

function boxLayoutRecords(){
  return layoutBoxes.map(({settings,position,rotation,hidden,group})=>group?{settings,position,rotation,hidden,group}:{settings,position,rotation,hidden});
}
const groupRecords=()=>layoutGroups.map(g=>Object.assign({id:g.id,origin:g.origin.slice()},g.parent?{parent:g.parent}:{},g.noFrame?{noFrame:true}:{}));

function saveBoxLayout(){
  // without groups, stored exactly as before (a list of boxes)
  if(!window.BOX?.noSave) lsSet(BOX_LAYOUT_KEY,layoutGroups.length?{boxes:boxLayoutRecords(),groups:groupRecords()}:boxLayoutRecords());
}

function currentBoxLayout(){
  return Boxsmith.assemblies.create({unit:S.unit,boxes:boxLayoutRecords(),groups:groupRecords()});
}
// Take the groups from a layout file ({groups:[{id, boxes, origin, parent, noFrame}]}) onto these boxes.
function adoptGroups(groups,boxes){
  layoutGroups=(groups||[]).map(g=>Object.assign({id:g.id,origin:g.origin.slice()},g.parent?{parent:g.parent}:{},g.noFrame?{noFrame:true}:{}));
  for(const g of groups||[]) for(const i of g.boxes||[]) if(boxes[i]) boxes[i].group=g.id;
  setGroupPoses(null);
}

function downloadBoxLayout(assembly=currentBoxLayout(),filename='boxsmith-layout.json'){
  return saveFile(filename,Boxsmith.assemblies.serialize(assembly));
}

function openBoxLayout(input){
  if(!GL) throw new Error('Opening a box layout requires WebGL');
  const file=Boxsmith.assemblies.parse(input);
  const boxes=file.boxes.map(entry=>{ if(!MATS[entry.settings.look]) entry.settings.look=view.mat; return restoreLayoutBox(entry); });
  adoptGroups(file.groups,boxes);
  layoutBoxes=boxes;
  layoutSelection=-1;
  placingBox=false;
  rebuildBoxLayout();
  setMeasurementUnit(file.unit);
  if(!layingOut()) $('#tabs [data-v="layout"]').click();
  view.zoom=1;
  selectLayoutBox(-1);
  toast('Layout opened');
  saveBoxLayout();
}

function layoutBoxLabel(box,index){
  return (index+1)+'. '+typeInfo(box.settings.type).name+(box.hidden?' (hidden)':'');
}

function layoutCoordinateScale(){
  return S.unit==='in'?25.4:1;
}

function syncBoxLayout(){
  const box=layoutBoxes[layoutSelection];
  const type=typeInfo(S.type);
  $('#layoutAdd').textContent='Add '+(type?.name||'current box');
  $('#layoutAdd').disabled=!GL;
  $('#layoutSave').disabled=$('#layoutClear').disabled=!layoutBoxes.length;
  $('#layoutOpen').disabled=!GL;
  const overlaps=layoutOverlaps(), clash=new Set(overlaps.flat());
  $('#layoutObjects').innerHTML='<option value="">Select a box</option>'+layoutBoxes
    .map((item,index)=>'<option value="'+index+'">'+(clash.has(index)?'⚠ ':'')+esc(layoutBoxLabel(item,index))+'</option>').join('');
  const snapSel=$('#layoutSnapTarget'), keep=snapSel.value;
  snapSel.innerHTML=layoutBoxes.map((item,index)=>index===layoutSelection?'':'<option value="'+index+'">'+esc(layoutBoxLabel(item,index))+'</option>').join('');
  if([...snapSel.options].some(o=>o.value===keep)) snapSel.value=keep;
  $('#layoutSnap').disabled=!box||snapSel.options.length===0;
  snapSel.disabled=$('#layoutSnapSide').disabled=$('#layoutSnapGap').disabled=$('#layoutSnap').disabled;
  $('#layoutObjects').value=box?String(layoutSelection):'';
  $('#layoutObjects').disabled=!layoutBoxes.length;
  const unit=S.unit, scale=layoutCoordinateScale();
  $('#layoutUnits').value=unit;
  $$('.layout-unit').forEach(label=>{ label.textContent=unit; });
  $$('[data-layout-axis]').forEach((input,index)=>{
    input.value=box?(unit==='in'?+(box.position[index]/scale).toFixed(3):box.position[index]):'';
    input.disabled=!box;
  });
  $$('[data-layout-rotation]').forEach(input=>{
    input.value=box?box.rotation[+input.dataset.layoutRotation]:'';
    input.disabled=!box;
  });
  for(const id of ['layoutPlace','layoutDuplicate','layoutDuplicateInPlace','layoutHide','layoutRemove']) $('#'+id).disabled=!box;
  $$('[data-lay-turn],[data-lay-step]').forEach(b=>{ b.disabled=!box; });
  if(!box) layoutPart=null;
  const colors=box?.settings.colors||{}, key=layoutPart||'*', own=colors[key];
  $('#layoutColorTarget').textContent=!box?'Select a box':layoutPart==='acrylic'?'All acrylic parts':layoutPart?'Part: '+layoutPart:'Whole box';
  const acrylic=!!box&&boxHasAcrylic(box);
  $('#layoutColorAcrylic').hidden=!acrylic;
  $('#layoutColorAcrylic').setAttribute('aria-pressed',String(layoutPart==='acrylic'));
  $('#layoutColor').disabled=!box;
  if(box) $('#layoutColor').value=own||(layoutPart?colors['*']:null)||'#4da3ff';
  $('#layoutColorClear').disabled=!own;
  $('#layoutColorClear').textContent=layoutPart&&(colors['*']||(layoutPart!=='acrylic'&&colors.acrylic))?'Use box color':'No color';
  $('#layoutHide').textContent=box?.hidden?'Show box':'Hide box';
  const nf=$('#layoutNoFrame'); if(nf){ nf.disabled=!box; nf.checked=!!box?.settings.noFrame; }
  $('#layoutTop').disabled=!layoutBoxes.length;
  $('#layoutFit').disabled=!layoutBoxes.length;
  $('#layoutPlace').setAttribute('aria-pressed',String(placingBox));
  cv.classList.toggle('layout-placing',layingOut()&&placingBox);
  const shown=overlaps.slice(0,6).map(([i,j])=>'box '+(i+1)+' and box '+(j+1)).join(', ');   // a heap of boxes can overlap thousands of ways; list a few
  const warn=overlaps.length?'⚠ Possible overlap: '+shown+(overlaps.length>6?', and '+(overlaps.length-6)+' more pairs':'')+'. Move them apart or use Snap.':'';
  const status=$('#layoutStatus');
  status.classList.toggle('warn',!!warn&&!placingBox);
  status.textContent=warn&&!placingBox?warn:!GL?'Arranging boxes requires WebGL.':placingBox?'Click where the center of the selected box should go.':
    layoutPart==='acrylic'?'Coloring every acrylic part of this box. Tap Acrylic again for the whole box.':
    layoutPart?'Coloring '+layoutPart+'. Tap it again for the whole box.':
    box?(acrylic?'Tap Acrylic to tint all its acrylic, or tap the selected box again to pick one part.':'Tap the selected box again to pick one part to color.'):
    layoutBoxes.length?'Select a box to move it. X and Y locate its center. Z sets the height of its base.':
    'Choose a box style and size in the sidebar, then add a copy to this layout.';
}

function selectLayoutBox(index){
  if(index!==layoutSelection) layoutPart=null;
  layoutSelection=index;
  placingBox=false;
  syncBoxLayout();
  render();
}

function addLayoutBox(source,inPlace=false){
  try{
    const settings=JSON.parse(JSON.stringify(source?source.settings:S));
    delete settings.assembly;
    if(!source||!MATS[settings.look]) settings.look=view.mat;
    const box=makeLayoutBox(settings,[0,0,0],source?.rotation.slice());
    if(source&&inPlace){ box.position=source.position.slice(); box.hidden=source.hidden; }
    transformLayoutBox(box);
    if(layoutBoxes.length&&!(source&&inPlace)){
      const right=Math.max(...layoutBoxes.map(item=>item.bounds.max.x));
      box.position=[Math.ceil(right-box.bounds.min.x+10),source?.position[1]||0,source?.position[2]||0];
    }
    layoutBoxes.push(box);
    rebuildBoxLayout();
    view.zoom=1;
    saveBoxLayout();
    selectLayoutBox(layoutBoxes.length-1);
  } catch(error){
    console.error(error);
    toast('This design could not be added to the layout.');
  }
}

function moveLayoutBox(){
  transformLayoutBox(layoutBoxes[layoutSelection]);
  saveBoxLayout();
  render();
}

function pickLayoutBox(raycaster,hit){
  if(placingBox){
    const box=layoutBoxes[layoutSelection];
    const point=raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-box.position[2]),new THREE.Vector3());
    if(point){
      box.position[0]=Math.round(point.x*10)/10;
      box.position[1]=Math.round(point.y*10)/10;
      placingBox=false;
      moveLayoutBox();
      syncBoxLayout();
    }
  } else if(hit){
    const index=layoutBoxes.indexOf(hit.object.userData.layoutBox), name=hit.object.userData.partName;
    if(index===layoutSelection&&name){ layoutPart=layoutPart===name?null:name; syncBoxLayout(); render(); }   // tap a selected box again to pick one part
    else selectLayoutBox(index);
  } else if(layoutPart){ layoutPart=null; syncBoxLayout(); render(); }
}

// Drag a box across the floor plane (its base height) with the mouse or a
// finger. Edges snap to neighbouring boxes when they come within a few mm.
let layoutDrag=null;
function layoutDragStart(e){
  if(!layingOut()||!GL||maximizedLayout()||stereoActive()||placingBox) return false;
  const rc=rayFromEvent(e);
  const hit=rc.intersectObjects(GL.objs.filter(o=>o.mesh.visible).map(o=>o.mesh),false)[0];
  const index=hit?layoutBoxes.indexOf(hit.object.userData.layoutBox):-1;
  if(index<0) return false;
  if(e.pointerType==='touch'&&index!==layoutSelection) return false; // tap selects first
  const box=layoutBoxes[index];
  const point=rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-box.bounds.min.z),new THREE.Vector3());
  if(!point) return false;
  layoutDrag={index,moved:false,dx:box.position[0]-point.x,dy:box.position[1]-point.y,start:box.position.slice(),
    rotate:e.shiftKey,x0:e.clientX,a0:box.rotation[2]};
  return true;
}
function layoutDragMove(e){
  if(!layoutDrag) return false;
  const box=layoutBoxes[layoutDrag.index];
  const rc=rayFromEvent(e);
  const point=rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-box.bounds.min.z),new THREE.Vector3());
  if(!point) return true;
  if(layoutDrag.rotate){
    // Shift + drag: turn the box about its vertical axis (15° steps, Alt = free)
    if(!layoutDrag.moved){ if(Math.abs(e.clientX-layoutDrag.x0)<4) return true; layoutDrag.moved=true; layoutSelection=layoutDrag.index; cv.style.cursor='ew-resize'; }
    let a=layoutDrag.a0+(e.clientX-layoutDrag.x0)*0.6;
    a=e.altKey?Math.round(a*10)/10:Math.round(a/15)*15;
    box.rotation[2]=((a%360)+360)%360;
    transformLayoutBox(box); syncBoxLayout(); render();
    return true;
  }
  let x=point.x+layoutDrag.dx, y=point.y+layoutDrag.dy;
  if(!layoutDrag.moved&&Math.hypot(x-layoutDrag.start[0],y-layoutDrag.start[1])<2) return true;
  if(!layoutDrag.moved){
    layoutDrag.moved=true;
    if(layoutSelection!==layoutDrag.index){ layoutSelection=layoutDrag.index; }
    cv.style.cursor='grabbing';
  }
  // snap edges to other boxes (alt held = free move)
  if(!e.altKey){
    const half=box.bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5), off=box.bounds.getCenter(new THREE.Vector3());
    const cx=off.x-box.position[0], cy=off.y-box.position[1], THR=4;
    const near=(own,edges)=>{ let best=null; for(const t of edges){ const d=t-own; if(Math.abs(d)<THR&&(best===null||Math.abs(d)<Math.abs(best))) best=d; } return best; };
    const xs=[],ys=[];
    layoutBoxes.forEach((o,i)=>{ if(i===layoutDrag.index||o.hidden) return; xs.push(o.bounds.min.x,o.bounds.max.x); ys.push(o.bounds.min.y,o.bounds.max.y); });
    const bx=x+cx, by=y+cy;
    const dxs=[near(bx-half.x,xs),near(bx+half.x,xs)].filter(v=>v!==null).sort((p,q)=>Math.abs(p)-Math.abs(q))[0];
    const dys=[near(by-half.y,ys),near(by+half.y,ys)].filter(v=>v!==null).sort((p,q)=>Math.abs(p)-Math.abs(q))[0];
    if(dxs!==undefined) x+=dxs;
    if(dys!==undefined) y+=dys;
  }
  box.position[0]=Math.round(x*100)/100;
  box.position[1]=Math.round(y*100)/100;
  transformLayoutBox(box);
  syncBoxLayout();
  render();
  return true;
}
function layoutDragEnd(){
  if(!layoutDrag) return;
  const moved=layoutDrag.moved;
  layoutDrag=null;
  cv.style.cursor='';
  if(moved){ saveBoxLayout(); syncBoxLayout(); }
}

function initBoxLayout(){
  if(GL) loadBoxLayout();
  const ctl=$('#layoutCtl');
  const showTab=name=>{
    ctl.dataset.tab=name; ctl.classList.remove('folded'); $('#layoutFold').setAttribute('aria-expanded','true');
    $$('[data-lay-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.layTab===name)));
  };
  $$('[data-lay-tab]').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.layTab===ctl.dataset.tab&&!ctl.classList.contains('folded')) return;
    showTab(b.dataset.layTab);
  }));
  $('#layoutFold').addEventListener('click',()=>{
    const folded=ctl.classList.toggle('folded');
    $('#layoutFold').setAttribute('aria-expanded',String(!folded));
  });
  $$('[data-lay-turn]').forEach(btn=>btn.addEventListener('click',()=>{
    const box=layoutBoxes[layoutSelection];
    if(!box) return;
    if(btn.dataset.layTurn==='reset') box.rotation=[0,0,0];
    else {
      const [axis,deg]=btn.dataset.layTurn.split(':'), k={x:0,y:1,z:2}[axis];
      box.rotation[k]=(((box.rotation[k]+ +deg)%360)+360)%360;
    }
    moveLayoutBox();
    syncBoxLayout();
  }));
  // Step the selected box by its own size (as it sits now, so turned boxes step by their turned size).
  // Colour the selected part, or the whole box. Acrylic stays see-through, just tinted.
  const setLayoutColor=(hex,save)=>{
    const box=layoutBoxes[layoutSelection];
    if(!box) return;
    const colors=Object.assign({},box.settings.colors), key=layoutPart||'*';
    if(hex) colors[key]=hex; else delete colors[key];
    if(Object.keys(colors).length) box.settings.colors=colors; else delete box.settings.colors;
    render();
    if(save){ saveBoxLayout(); syncBoxLayout(); }
  };
  $('#layoutColor').addEventListener('input',e=>setLayoutColor(e.target.value,false));
  $('#layoutColor').addEventListener('change',e=>setLayoutColor(e.target.value,true));
  $('#layoutColorClear').addEventListener('click',()=>setLayoutColor(null,true));
  $('#layoutColorAcrylic').addEventListener('click',()=>{ layoutPart=layoutPart==='acrylic'?null:'acrylic'; syncBoxLayout(); render(); });
  $$('[data-lay-step]').forEach(btn=>btn.addEventListener('click',()=>{
    const box=layoutBoxes[layoutSelection];
    if(!box) return;
    const [axis,sign]=btn.dataset.layStep.split(':').map(Number), key=['x','y','z'][axis];
    const size=box.bounds.max[key]-box.bounds.min[key];
    box.position[axis]=Math.round((box.position[axis]+sign*size)*1000)/1000;
    moveLayoutBox();
    syncBoxLayout();
  }));
  $('#layoutSnap').addEventListener('click',()=>{
    const gap=Math.max(0,+$('#layoutSnapGap').value||0)*layoutCoordinateScale();
    if(snapLayoutBox(+$('#layoutSnapTarget').value,$('#layoutSnapSide').value,gap)){ syncBoxLayout(); toast('Snapped'); }
  });
  $('#layoutSave').addEventListener('click',()=>downloadBoxLayout());
  $('#layoutOpen').addEventListener('click',()=>$('#layoutFile').click());
  // confirm() is blocked inside the sandboxed artifact frame, so confirm in the button itself.
  let clearTimer=null;
  const clearBtn=$('#layoutClear');
  const disarmClear=()=>{ clearTimeout(clearTimer); clearBtn.dataset.armed=''; clearBtn.textContent='Clear all'; };
  clearBtn.addEventListener('click',()=>{
    if(!layoutBoxes.length) return;
    if(clearBtn.dataset.armed!=='1'){
      clearBtn.dataset.armed='1';
      clearBtn.textContent='Click again to clear';
      clearTimer=setTimeout(disarmClear,4000);
      return;
    }
    disarmClear();
    layoutBoxes=[]; layoutGroups=[]; setGroupPoses(null);
    rebuildBoxLayout();
    saveBoxLayout();
    selectLayoutBox(-1);
    toast('Layout cleared');
  });
  $('#layoutUnits').addEventListener('change',e=>setMeasurementUnit(e.target.value));
  $('#layoutAdd').addEventListener('click',()=>addLayoutBox());
  $('#layoutDuplicate').addEventListener('click',()=>addLayoutBox(layoutBoxes[layoutSelection]));
  $('#layoutDuplicateInPlace').addEventListener('click',()=>{
    if(!layoutBoxes[layoutSelection]) return;
    addLayoutBox(layoutBoxes[layoutSelection],true);
    toast('Copy placed on top of the original — move or turn it');
  });
  $('#layoutObjects').addEventListener('change',e=>selectLayoutBox(e.target.value===''?-1:+e.target.value));
  for(const input of $$('[data-layout-axis],[data-layout-rotation]')){
    input.addEventListener('change',()=>{
      const box=layoutBoxes[layoutSelection];
      if(!box) return;
      const rotationAxis=input.dataset.layoutRotation;
      const isAngle=rotationAxis!==undefined;
      const value=input.valueAsNumber*(isAngle?1:layoutCoordinateScale());
      if(Number.isFinite(value)&&input.validity.valid){
        if(isAngle) box.rotation[+rotationAxis]=value;
        else box.position[+input.dataset.layoutAxis]=value;
        moveLayoutBox();
      }
      syncBoxLayout();
    });
  }
  $('#layoutTop').addEventListener('click',()=>{
    placingBox=false;
    view.yaw=0;
    view.pitch=PI/2;
    syncBoxLayout();
    render();
  });
  $('#layoutFit').addEventListener('click',()=>{
    fitBoxLayout();
    view.zoom=1;
    render();
  });
  $('#layoutPlace').addEventListener('click',()=>{
    placingBox=!placingBox;
    if(placingBox){ view.yaw=0; view.pitch=PI/2; }
    syncBoxLayout();
    render();
  });
  $('#layoutNoFrame')?.addEventListener('change',e=>{ setLayoutNoFrame(layoutSelection,e.target.checked); });
  $('#layoutHide').addEventListener('click',()=>{
    const box=layoutBoxes[layoutSelection];
    box.hidden=!box.hidden;
    saveBoxLayout();
    syncBoxLayout();
    render();
  });
  $('#layoutRemove').addEventListener('click',()=>{
    layoutBoxes.splice(layoutSelection,1);
    rebuildBoxLayout();
    saveBoxLayout();
    selectLayoutBox(Math.min(layoutSelection,layoutBoxes.length-1));
  });
}
