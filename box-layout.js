'use strict';

const BOX_LAYOUT_KEY='boxsmith-box-layout-v1';
const BOX_LAYOUT_FORMAT='boxsmith-layout';
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

function makeLayoutBox(settings, position=[0,0,0], rotation=[0,0,0], hidden=false){
  const previousSettings=S, previousGeometry=G;
  try{
    S=Object.assign({},DEFAULTS,settings);
    G=geometryContext();
    const result=generate();
    decorate(result.parts,result.warns);
    const model=makeScene(result.parts);
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
  for(const solid of solids){
    for(const loop of [solid.bot[0],solid.top[0]]){
      for(const vertex of loop) bounds.expandByPoint(point.fromArray(vertex).applyMatrix4(box.pose));
    }
  }
  const [x,y,z]=box.position;
  const offset=new THREE.Vector3(x,y,z-bounds.min.z);
  box.pose.setPosition(point.setFromMatrixPosition(box.pose).add(offset));
  box.bounds=bounds.translate(offset);
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

function restoreLayoutBox(entry){
  const rotation=entry?.rotation??[0,0,entry?.angle];
  const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
  if(!entry?.settings || !TYPES.some(type=>type.id===entry.settings.type)
    || !vector(entry.position) || !vector(rotation)) throw new Error('Invalid box in layout');
  return makeLayoutBox(entry.settings,entry.position,rotation,entry.hidden===true);
}

function loadBoxLayout(){
  const stored=lsGet(BOX_LAYOUT_KEY,[]);
  if(!Array.isArray(stored)) return;
  for(const entry of stored){
    try{ layoutBoxes.push(restoreLayoutBox(entry)); }
    catch(error){ console.warn('Could not load a box in the layout',error); }
  }
  rebuildBoxLayout();
}

function boxLayoutRecords(){
  return layoutBoxes.map(({settings,position,rotation,hidden})=>({settings,position,rotation,hidden}));
}

function saveBoxLayout(){
  if(!window.BOX?.noSave) lsSet(BOX_LAYOUT_KEY,boxLayoutRecords());
}

function downloadBoxLayout(){
  const file={format:BOX_LAYOUT_FORMAT,version:1,unit:S.unit,boxes:boxLayoutRecords()};
  saveFile('boxsmith-layout.json',JSON.stringify(file,null,2));
}

function openBoxLayout(file){
  if(!GL){ toast('Opening a box layout requires WebGL'); return; }
  if(file.version!==1){ toast('This layout file uses an unsupported version'); return; }
  if(!Array.isArray(file.boxes) || (file.unit!=='mm'&&file.unit!=='in')) throw new Error('Invalid layout file');

  const boxes=file.boxes.map(restoreLayoutBox);
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
  return (index+1)+'. '+TYPES.find(type=>type.id===box.settings.type).name+(box.hidden?' (hidden)':'');
}

function layoutCoordinateScale(){
  return S.unit==='in'?25.4:1;
}

function syncBoxLayout(){
  const box=layoutBoxes[layoutSelection];
  const type=TYPES.find(type=>type.id===S.type);
  $('#layoutAdd').textContent='Add '+(type?.name||'current box');
  $('#layoutAdd').disabled=!GL;
  $('#layoutSave').disabled=!layoutBoxes.length;
  $('#layoutOpen').disabled=!GL;
  $('#layoutObjects').innerHTML='<option value="">Select a box</option>'+layoutBoxes
    .map((item,index)=>'<option value="'+index+'">'+esc(layoutBoxLabel(item,index))+'</option>').join('');
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
  for(const id of ['layoutPlace','layoutDuplicate','layoutHide','layoutRemove']) $('#'+id).disabled=!box;
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
    const box=makeLayoutBox(settings,[0,0,0],source?.rotation.slice());
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
  if(GL) loadBoxLayout();
  $('#layoutSave').addEventListener('click',downloadBoxLayout);
  $('#layoutOpen').addEventListener('click',()=>$('#layoutFile').click());
  $('#layoutUnits').addEventListener('change',e=>setMeasurementUnit(e.target.value));
  $('#layoutAdd').addEventListener('click',()=>addLayoutBox());
  $('#layoutDuplicate').addEventListener('click',()=>addLayoutBox(layoutBoxes[layoutSelection]));
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
