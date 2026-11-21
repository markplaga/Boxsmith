'use strict';

/* Picture mosaic: sidebar controls for turning an uploaded picture into a layout of painted boxes.
   The picking of colours and the layout maths live in mosaic-core.js; this file is only the page wiring. */
(function(){
  const core=BoxsmithMosaic, KEY='boxsmith-mosaic', MAX_TILES=4000, BIG=1500, MAX_PREVIEW=20000;
  const DEF={cols:24,colors:6,faces:'sides',paint:'watercolor',strength:75,dither:false,skipAlpha:true,relief:'none',steps:3,frame:false,ring:25.4};
  const MOS=Object.assign({},DEF);
  try{ Object.assign(MOS,JSON.parse(localStorage.getItem(KEY)||'{}')); }catch(e){}
  const body=$('#mosBody'), info=$('#mosInfo'), go=$('#mosGo'), canvas=$('#mosPrev');
  let pic=null, last=null, timer=0;

  const save=()=>{ try{ localStorage.setItem(KEY,JSON.stringify(MOS)); }catch(e){} };
  const ringShown=()=>S.unit==='in'?+(MOS.ring/25.4).toFixed(4):MOS.ring;

  function syncFields(){
    $$('[data-mos]').forEach(el=>{
      const v=MOS[el.dataset.mos];
      if(el.type==='checkbox') el.checked=!!v; else el.value=v;
    });
    $('#mosRing').value=ringShown();
    $('#mosRing').step=S.unit==='in'?'0.0625':'1';
    $('#mosStrVal').textContent=MOS.strength+'%';
    $('#mosStrWrap').classList.toggle('hidden',MOS.paint!=='watercolor');
    $('#mosStepsWrap').classList.toggle('hidden',MOS.relief==='none');
    $('#mosRingWrap').classList.toggle('hidden',!MOS.frame);
  }

  // One tile of the mosaic is a copy of the box in the editor. Measure how much room it takes in each orientation.
  function tileInfo(){
    const settings=JSON.parse(JSON.stringify(S));
    delete settings.assembly;
    if(settings.type==='kerftest') throw new Error('Pick a box style first. The Kerf test cannot be used as a tile.');
    const rotations=MOS.faces==='top'?[[0,0,0]]:MOS.faces==='side'?[[90,0,0]]:[[90,0,0],[0,-90,0]];
    let px=0, py=0, h=0;
    for(const rotation of rotations){
      const box=makeLayoutBox(settings,[0,0,0],rotation);
      transformLayoutBox(box);
      const size=box.bounds.getSize(new THREE.Vector3());
      px=Math.max(px,size.x); py=Math.max(py,size.y); h=Math.max(h,size.z);
    }
    return {settings,px,py,h};
  }

  function say(text,warn){ info.textContent=text; info.style.color=warn?'#a8321a':''; }

  function refresh(){
    syncFields();
    if(!pic) return;
    let t;
    try{ t=tileInfo(); }catch(error){ last=null; go.disabled=true; say(error.message,true); return; }
    const {cols,rows}=core.gridSize(pic.width,pic.height,MOS.cols,t.px,t.py);
    if(cols*rows>MAX_PREVIEW){ last=null; go.disabled=true; say('That is '+cols+' × '+rows+' boxes. Lower "Boxes across".',true); return; }
    const m=core.buildMosaic({rgba:pic.rgba,width:pic.width,height:pic.height,cols,rows,colors:MOS.colors,
      dither:MOS.dither,skipTransparent:MOS.skipAlpha,relief:MOS.relief,steps:MOS.steps});
    last={m,t};

    canvas.width=cols; canvas.height=rows;
    const cx=canvas.getContext('2d'), img=cx.createImageData(cols,rows);
    for(let i=0;i<cols*rows;i++){
      const c=m.index[i];
      if(c<0) continue;
      const rgb=m.palette[c].rgb;
      img.data.set([rgb[0],rgb[1],rgb[2],255],i*4);
    }
    cx.putImageData(img,0,0);
    $('#mosPal').innerHTML=m.palette.map(p=>'<span style="background:'+p.hex+'" title="'+p.hex+' · '+p.count+' boxes" role="img" aria-label="'+p.hex+', '+p.count+' boxes"></span>').join('');

    const tooMany=m.count+(MOS.frame?1:0)>MAX_TILES;
    go.disabled=!m.count||tooMany;
    say(cols+' × '+rows+' = '+m.count+' boxes, '+m.palette.length+' colours, about '+fmt(cols*t.px)+' × '+fmt(rows*t.py)+'.'
      +(tooMany?' That is more than the limit of '+MAX_TILES+' boxes. Lower "Boxes across".':m.count>BIG?' Large: building it may take a little while.':''),tooMany);
  }

  const schedule=()=>{ clearTimeout(timer); timer=setTimeout(refresh,120); };

  /* ---------- loading the picture ---------- */
  async function loadPicture(file){
    let source;
    try{ source=await createImageBitmap(file,{imageOrientation:'from-image'}); }
    catch(error){
      source=await new Promise((resolve,reject)=>{
        const image=new Image(), url=URL.createObjectURL(file);
        image.onload=()=>{ URL.revokeObjectURL(url); resolve(image); };
        image.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('That file could not be read as a picture.')); };
        image.src=url;
      });
    }
    const w0=source.width||source.naturalWidth||0, h0=source.height||source.naturalHeight||0;
    if(!w0||!h0) throw new Error('That picture has no size. Try a PNG or JPG.');
    const scale=Math.min(1,1200/Math.max(w0,h0)), w=Math.max(1,Math.round(w0*scale)), h=Math.max(1,Math.round(h0*scale));
    const work=document.createElement('canvas');
    work.width=w; work.height=h;
    const cx=work.getContext('2d',{willReadFrequently:true});
    cx.imageSmoothingQuality='high';
    cx.drawImage(source,0,0,w,h);
    pic={rgba:cx.getImageData(0,0,w,h).data,width:w,height:h,name:file.name};
  }

  $('#mosFile').addEventListener('change',async event=>{
    const file=event.target.files[0];
    event.target.value='';
    if(!file) return;
    try{
      await loadPicture(file);
      $('#mosName').textContent=pic.name+' ('+pic.width+' × '+pic.height+')';
      body.classList.remove('hidden');
      refresh();
    } catch(error){ toast(error.message||'That picture could not be opened.'); }
  });

  /* ---------- settings ---------- */
  $$('[data-mos]').forEach(el=>{
    const key=el.dataset.mos, apply=()=>{
      let v;
      if(el.type==='checkbox') v=el.checked;
      else if(el.type==='number'||el.type==='range'){
        v=parseFloat(el.value);
        if(!isFinite(v)) return;
        if(el.min!==''&&el.max!=='') v=Math.min(+el.max,Math.max(+el.min,v));
        if(el.step==='1') v=Math.round(v);
      } else v=el.value;
      MOS[key]=v; save(); schedule();
    };
    el.addEventListener(el.type==='range'?'input':'change',apply);
  });
  $('#mosRing').addEventListener('change',()=>{
    let v=parseFloat($('#mosRing').value);
    if(!isFinite(v)) return;
    MOS.ring=Math.max(1,S.unit==='in'?v*25.4:v); save(); schedule();
  });
  $('#unitSeg').addEventListener('click',()=>setTimeout(refresh,0));
  // The tile is the box in the editor, so any change up there changes the mosaic too.
  document.querySelector('aside').addEventListener('input',event=>{ if(pic&&!event.target.closest('#mosaicSec')) schedule(); });
  document.querySelector('aside').addEventListener('click',event=>{ if(pic&&!event.target.closest('#mosaicSec')) schedule(); });

  /* ---------- the frame around the picture ---------- */
  function frameSettings(m,t){
    const s=JSON.parse(JSON.stringify(t.settings)), th=+s.t||3;
    const ring=Math.max(+MOS.ring||25.4,Math.max(4,th)), clr=Math.max(0.2,+s.clr||0.3);
    const top=Math.max(0,...m.palette.map(p=>p.level))*(t.h/2)+t.h;
    Object.assign(s,{
      type:'frame',dimMode:'outside',paint:'none',text:'',deco:'none',accent:'none',frame:'none',art:[],
      frameW:ring,fw:Math.max(+s.fw||0,10),
      W:m.cols*t.px+2*clr+4*th+2*ring,
      D:m.rows*t.py+2*clr+4*th+2*ring,
      H:Math.max(2*th+4,Math.round(top*10)/10)
    });
    return s;
  }

  /* ---------- build the layout ---------- */
  async function build(){
    try{
      refresh();
      if(!last||go.disabled) return;
      const {m,t}=last;
      go.disabled=true; go.textContent='Building '+m.count+' boxes…';
      await new Promise(resolve=>setTimeout(resolve,30));
      const assembly=core.makeAssembly(m,{
        tile:t.settings,pitchX:t.px,pitchY:t.py,faces:MOS.faces,paint:MOS.paint,strength:MOS.strength,
        stepHeight:t.h/2,unit:S.unit,frame:MOS.frame?frameSettings(m,t):null
      });
      openBoxLayout(assembly);
      const top=$('#layoutTop'); if(top) top.click();
      const fit=$('#layoutFit'); if(fit) fit.click();
      toast('Mosaic built: '+assembly.boxes.length+' boxes');
    } catch(error){
      console.error(error);
      toast('The mosaic could not be built: '+(error.message||error));
    } finally {
      go.textContent='Build the layout';
      refresh();
    }
  }
  // confirm() is blocked in the artifact frame, so a big or replacing build asks by relabelling the button
  go.addEventListener('click',()=>{
    if(!pic) return toast('Choose a picture first');
    refresh();
    if(!last||go.disabled) return;
    const big=last.m.count>BIG, replacing=layoutBoxes.length>0;
    if(big||replacing) confirmTwice(go,big&&!replacing?'Click again to build '+last.m.count+' boxes':'Click again to replace the layout',build);
    else build();
  });

  syncFields();
  // for tests and scripts
  window.BoxsmithMosaicUI={get state(){ return {pic:!!pic,last}; },settings:MOS,refresh};
})();
