'use strict';

const BOX_LAYOUT_KEY='boxsmith-box-layout-v1';
const BOX_LAYOUT_UNIT_KEY='boxsmith-box-layout-unit';
let layoutUnit;
let layoutBoxes=[], layoutSelection=-1, placingBox=false;
let boxLayoutScene={solids:[],ctr:[0,0,0],R:100};
const layingOut=()=>curView==='layout';
let layoutCamera={yaw:-0.6,pitch:0.6,zoom:1}, boxPreviewCamera;

function switchBoxLayoutCamera(){
  const camera={yaw:view.yaw,pitch:view.pitch,zoom:view.zoom};
  if(layingOut()){
    boxPreviewCamera=camera;
    Object.assign(view,layoutCamera);
  } else {
    layoutCamera=camera;
    Object.assign(view,boxPreviewCamera);
  }
}

function makeLayoutBox(settings, position=[0,0,0], angle=0, hidden=false){
  const previousSettings=S, previousGeometry=G;
  try{
    S=Object.assign({},DEFAULTS,settings);
    G=geometryContext();
    const result=generate();
    decorate(result.parts,result.warns);
    const model=makeScene(result.parts);
    if(!model.solids.length) throw new Error('No box geometry');
    return {settings,position,angle,hidden,model};
  } finally {
    S=previousSettings;
    G=previousGeometry;
  }
}

function transformLayoutBox(box){
  const {min,max,ctr}=box.model;
  box.pose=new THREE.Matrix4().makeRotationZ(box.angle*PI/180)
    .multiply(new THREE.Matrix4().makeTranslation(-ctr[0],-ctr[1],-min[2]));
  box.pose.premultiply(new THREE.Matrix4().makeTranslation(...box.position));
  box.bounds=new THREE.Box3(new THREE.Vector3(...min),new THREE.Vector3(...max)).applyMatrix4(box.pose);
}

function fitBoxLayout(){
  const bounds=new THREE.Box3();
  for(const box of layoutBoxes) bounds.union(box.bounds);
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

function loadBoxLayout(){
  const stored=lsGet(BOX_LAYOUT_KEY,[]);
  if(!Array.isArray(stored)) return;
  for(const entry of stored){
    if(!entry?.settings || !TYPES.some(type=>type.id===entry.settings.type)
      || !Array.isArray(entry.position) || entry.position.length!==3 || !entry.position.every(Number.isFinite)
      || !Number.isFinite(entry.angle)) continue;
    try{ layoutBoxes.push(makeLayoutBox(entry.settings,entry.position,entry.angle,entry.hidden===true)); }
    catch(error){ console.warn('Could not load a box in the layout',error); }
  }
  rebuildBoxLayout();
}

function saveBoxLayout(){
  if(!window.BOX?.noSave) lsSet(BOX_LAYOUT_KEY,layoutBoxes.map(({settings,position,angle,hidden})=>({settings,position,angle,hidden})));
}

function layoutBoxLabel(box,index){
  return (index+1)+'. '+TYPES.find(type=>type.id===box.settings.type).name+(box.hidden?' (hidden)':'');
}

function layoutCoordinateScale(){
  return (layoutUnit||S.unit)==='in'?25.4:1;
}

function syncBoxLayout(){
  const box=layoutBoxes[layoutSelection];
  const type=TYPES.find(type=>type.id===S.type);
  $('#layoutAdd').textContent='Add '+(type?.name||'current box');
  $('#layoutAdd').disabled=!GL;
  $('#layoutObjects').innerHTML='<option value="">Select a box</option>'+layoutBoxes
    .map((item,index)=>'<option value="'+index+'">'+esc(layoutBoxLabel(item,index))+'</option>').join('');
  $('#layoutObjects').value=box?String(layoutSelection):'';
  $('#layoutObjects').disabled=!layoutBoxes.length;
  const unit=layoutUnit||S.unit, scale=layoutCoordinateScale();
  $('#layoutUnits').value=unit;
  $$('.layout-unit').forEach(label=>{ label.textContent=unit; });
  $$('[data-layout-axis]').forEach((input,index)=>{
    input.value=box?(unit==='in'?+(box.position[index]/scale).toFixed(3):box.position[index]):'';
    input.disabled=!box;
  });
  $('#layoutAngle').value=box?box.angle:'';
  for(const id of ['layoutAngle','layoutPlace','layoutDuplicate','layoutHide','layoutRemove']) $('#'+id).disabled=!box;
  $('#layoutHide').textContent=box?.hidden?'Show box':'Hide box';
  $('#layoutTop').disabled=!layoutBoxes.length;
  $('#layoutFit').disabled=!layoutBoxes.length;
  $('#layoutPlace').setAttribute('aria-pressed',String(placingBox));
  cv.classList.toggle('layout-placing',layingOut()&&placingBox);
  $('#layoutStatus').textContent=!GL?'Arranging boxes requires WebGL.':placingBox?'Click where the center of the selected box should go.':
    layoutBoxes.length?'Select a box to move it. X and Y locate its center. Z sets the height of its base.':
    'Choose a box style and size in the sidebar, then add a copy to this layout.';
}

function selectLayoutBox(index){
  layoutSelection=index;
  placingBox=false;
  syncBoxLayout();
  render();
}

function addLayoutBox(source){
  try{
    const settings=JSON.parse(JSON.stringify(source?source.settings:S));
    delete settings.assembly;
    const box=makeLayoutBox(settings,[0,0,0],source?.angle||0);
    transformLayoutBox(box);
    if(layoutBoxes.length){
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
    selectLayoutBox(layoutBoxes.indexOf(hit.object.userData.layoutBox));
  }
}

function initBoxLayout(){
  const savedUnit=lsGet(BOX_LAYOUT_UNIT_KEY,null);
  if(savedUnit==='mm'||savedUnit==='in') layoutUnit=savedUnit;
  if(GL) loadBoxLayout();
  $('#layoutUnits').addEventListener('change',e=>{
    layoutUnit=e.target.value;
    if(!window.BOX?.noSave) lsSet(BOX_LAYOUT_UNIT_KEY,layoutUnit);
    syncBoxLayout();
  });
  $('#layoutAdd').addEventListener('click',()=>addLayoutBox());
  $('#layoutDuplicate').addEventListener('click',()=>addLayoutBox(layoutBoxes[layoutSelection]));
  $('#layoutObjects').addEventListener('change',e=>selectLayoutBox(e.target.value===''?-1:+e.target.value));
  for(const input of $$('[data-layout-axis],#layoutAngle')){
    input.addEventListener('change',()=>{
      const box=layoutBoxes[layoutSelection];
      if(!box) return;
      const isAngle=input.id==='layoutAngle';
      const value=input.valueAsNumber*(isAngle?1:layoutCoordinateScale());
      if(Number.isFinite(value)&&input.validity.valid){
        if(isAngle) box.angle=value;
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
