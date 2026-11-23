'use strict';

/* Boxsmith engine: connects the Boxsmith API (boxsmith-api.js) to the geometry in app.js, so a script can do
   everything the page does: build cut sheets, SVG, DXF, parts, costs and assembly cards, measure and snap
   whole-box layouts, keep materials and recipes, turn a picture into a mosaic, and drive the 3D preview.
   Load it after app.js. It works in the browser and, through boxsmith-node.js, in Node.js. */
(function(){
  const API=Boxsmith, clone=value=>JSON.parse(JSON.stringify(value));
  const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

  /* ---------- run the geometry for some settings without touching the page ---------- */
  function withSettings(settings,fn){
    const {type='closed',...rest}=isRecord(settings)?settings:{};
    const design=API.boxes.create(type,rest);              // validates, fills in defaults
    const previous={S,G,LAST};
    try{
      S=Object.assign({},DEFAULTS,design);
      G=geometryContext();
      return fn(design);
    } finally {
      S=previous.S; G=previous.G; LAST=previous.LAST;
    }
  }

  const round=(value,places=3)=>Math.round(value*10**places)/10**places;
  const size=box=>({W:round(box.W),D:round(box.D),H:round(box.H)});

  function computeDesign(settings,options={}){
    const {svg=true,dxf=true,geometry=false,card=true}=options;
    return withSettings(settings,design=>{
      const res=generate();
      decorate(res.parts,res.warns);
      G.t=Math.max(0.5,S.t);
      designWarnings(res);
      const fparts=res.parts.filter(p=>!p.noCut).map(finalize);
      const lay=layout(fparts);
      LAST={sheets:lay.sheets,res,fparts};
      const {ar,cutLen}=measureParts(fparts);
      const C=costs(fparts,lay,cutLen,ar), q=C.q;
      const bed=S.sheetW*S.sheetH;
      const info=res.info, name=baseName();
      const sheets=lay.sheets.map((sheet,i)=>({
        index:i+1,
        material:sheet.mat,
        thickness:sheet.th,
        label:sheetLabel(sheet),
        width:S.sheetW,
        height:S.sheetH,
        parts:sheet.items.map(item=>item.f.name),
        svg:svg?sheetSVG(sheet):undefined,
        dxf:dxf?sheetDXF(sheet):undefined
      }));
      const files=[];
      if(svg) sheets.forEach(sheet=>files.push({name:name+'-sheet'+sheet.index+'.svg',type:'image/svg+xml',data:sheet.svg}));
      if(dxf) sheets.forEach(sheet=>files.push({name:name+'-sheet'+sheet.index+'.dxf',type:'application/dxf',data:sheet.dxf}));
      if(card) files.push({name:name+'-assembly-card.html',type:'text/html',data:cardHTML(true)});
      return {
        type:design.type,
        name:TYPES.find(item=>item.id===design.type).name,
        fileBase:name,
        settings:clone(design),
        outside:size(info),
        inside:info.inner?{...size(info.inner),label:info.inner.label||''}:null,
        warnings:[...res.warns,...lay.warns],
        notes:[...res.notes],
        parts:fparts.map(f=>({
          name:f.name,
          material:f.mat,
          thickness:f.th,
          width:round(f.bb.w),
          height:round(f.bb.h),
          holes:f.holes.length+f.circles.length+f.slits.length,
          ...(geometry?{outline:f.outline.map(p=>p.map(v=>round(v))),holeLoops:f.holes.map(h=>h.map(p=>p.map(v=>round(v)))),circles:clone(f.circles)}:{})
        })),
        sheets,
        stats:{
          parts:fparts.length*q,
          sheets:lay.sheets.length,
          bedUsePercent:round(lay.sheets.length?ar*q/(lay.sheets.length*bed)*100:0,1),
          cutLengthMm:round(cutLen*q,1),
          laserSeconds:Math.round(C.sec)
        },
        cost:{
          quantity:q,
          materialShare:round(C.matShare,2),
          sheetsIfBoughtWhole:round(C.sheetsCost,2),
          machine:round(C.machine,2),
          perBox:round(C.perBox,2),
          suggestedPrice:round(C.price,2)
        },
        files
      };
    });
  }

  API.design={
    /** Cut sheets, SVG, DXF, parts list, dimensions, cost and warnings for one box design. */
    compute:computeDesign,
    /** Just the files, ready to write: sheet SVGs, sheet DXFs and the assembly card. */
    files:(settings,options)=>computeDesign(settings,options).files,
    /** One sheet as an SVG string (1-based index). */
    sheetSVG:(settings,index=1)=>{
      const sheet=computeDesign(settings,{dxf:false,card:false}).sheets[index-1];
      if(!sheet) throw new RangeError('This design has no sheet '+index);
      return sheet.svg;
    },
    /** Printable assembly card (HTML). It has no 3D picture when made outside the page. */
    assemblyCard:settings=>computeDesign(settings,{svg:false,dxf:false}).files.find(file=>file.name.endsWith('.html')).data
  };

  /* ---------- measuring and arranging whole boxes ---------- */
  function placed(assembly){
    const file=API.assemblies.parse(assembly);
    const boxes=file.boxes.map(item=>{
      const box=makeLayoutBox(item.settings,item.position.slice(),item.rotation.slice(),item.hidden);
      transformLayoutBox(box);
      return box;
    });
    return {file,boxes};
  }
  const vec=v=>[round(v.x),round(v.y),round(v.z)];
  const box3=b=>({min:vec(b.min),max:vec(b.max),size:vec(b.getSize(new THREE.Vector3())),center:vec(b.getCenter(new THREE.Vector3()))});

  Object.assign(API.assemblies,{
    /** Where each box really is: bounding box in the layout's world (mm), plus a Frame's opening. */
    measure(assembly){
      const {boxes}=placed(assembly);
      return boxes.map((box,index)=>({index,type:box.settings.type,hidden:box.hidden,bounds:box3(box.bounds),opening:box.opening?box3(box.opening):null}));
    },
    /** Pairs of boxes (by index) whose parts collide. A box sitting in a Frame's opening is not a collision. */
    overlaps(assembly){
      const {boxes}=placed(assembly);
      return layoutOverlaps(boxes);
    },
    /** Move one box flush against a face of another. side is '+x','-x','+y','-y','+z', or for a Frame 'in:c','in:-x','in:+x','in:-y','in:+y'. Returns a new layout. */
    snap(assembly,index,{to,side,gap=0}={}){
      const {file,boxes}=placed(assembly);
      if(!Number.isInteger(index)||!boxes[index]) throw new RangeError('No box at index '+index);
      if(!Number.isInteger(to)||!boxes[to]) throw new RangeError('No target box at index '+to);
      if(!Number.isFinite(gap)||gap<0) throw new RangeError('gap must be 0 or more');
      const problem=snapBoxes(boxes[index],boxes[to],side,gap);
      if(problem) throw new RangeError(problem);
      file.boxes[index].position=boxes[index].position.slice();
      return file;
    },
    /** Lay the boxes out in a row along x or y with a gap between them (starts where the first box is). */
    row(assembly,{axis='x',gap=10}={}){
      if(axis!=='x'&&axis!=='y') throw new RangeError("axis must be 'x' or 'y'");
      const {file,boxes}=placed(assembly);
      const k=axis, other=axis==='x'?'y':'x';
      let cursor=null;
      boxes.forEach((box,index)=>{
        if(box.hidden) return;
        const B=box.bounds, extent=B.max[k]-B.min[k];
        if(cursor===null) cursor=B.min[k];
        const d={x:0,y:0,z:0};
        d[k]=cursor-B.min[k];
        d[other]=boxes.find(b=>!b.hidden).bounds.getCenter(new THREE.Vector3())[other]-B.getCenter(new THREE.Vector3())[other];
        file.boxes[index].position=[round(box.position[0]+d.x),round(box.position[1]+d.y),box.position[2]];
        cursor+=extent+gap;
      });
      return file;
    }
  });

  /* ---------- the picture mosaic ---------- */
  API.mosaic={
    /** Turn {rgba,width,height} into a layout of painted boxes, like the Picture mosaic panel.
        rgba is RGBA bytes (a canvas ImageData.data, or a decoded PNG). Options match the panel. */
    build(picture,options={}){
      const core=BoxsmithMosaic, {rgba,width,height}=picture||{};
      if(!rgba||!width||!height) throw new TypeError('picture needs rgba, width and height');
      const o={cols:24,colors:6,faces:'sides',paint:'watercolor',strength:75,dither:false,skipTransparent:true,relief:'none',steps:3,frame:false,ring:25.4,...options};
      const settings=clone(API.boxes.create(options.type||'closed',options.settings||{}));
      if(settings.type==='kerftest') throw new RangeError('The kerf test cannot be used as a tile');
      const rotations=o.faces==='top'?[[0,0,0]]:o.faces==='side'?[[90,0,0]]:[[90,0,0],[0,-90,0]];
      let px=0,py=0,h=0;
      for(const rotation of rotations){
        const box=makeLayoutBox(settings,[0,0,0],rotation);
        transformLayoutBox(box);
        const bounds=box.bounds.getSize(new THREE.Vector3());
        px=Math.max(px,bounds.x); py=Math.max(py,bounds.y); h=Math.max(h,bounds.z);
      }
      const {cols,rows}=core.gridSize(width,height,o.cols,px,py);
      const m=core.buildMosaic({rgba,width,height,cols,rows,colors:o.colors,dither:o.dither,skipTransparent:o.skipTransparent,relief:o.relief,steps:o.steps});
      let frame=null;
      if(o.frame){
        const th=+settings.t||3, ring=Math.max(+o.ring||25.4,Math.max(4,th)), clr=Math.max(0.2,+settings.clr||0.3);
        const top=Math.max(0,...m.palette.map(p=>p.level))*(h/2)+h;
        frame=Object.assign(clone(settings),{type:'frame',dimMode:'outside',paint:'none',text:'',deco:'none',accent:'none',frame:'none',art:[],
          frameW:ring,fw:Math.max(+settings.fw||0,10),W:cols*px+2*clr+4*th+2*ring,D:rows*py+2*clr+4*th+2*ring,H:Math.max(2*th+4,Math.round(top*10)/10)});
      }
      const assembly=core.makeAssembly(m,{tile:settings,pitchX:px,pitchY:py,faces:o.faces,paint:o.paint,strength:o.strength,stepHeight:h/2,unit:'mm',frame});
      return {assembly:API.assemblies.create(assembly),columns:cols,rows,boxes:assembly.boxes.length,palette:m.palette.map(p=>({hex:p.hex,count:p.count}))};
    }
  };

  /* ---------- saved materials and recipes ---------- */
  const memory=new Map();
  const read=(key,fallback)=>{
    try{ const value=JSON.parse(localStorage.getItem(key)||'null'); if(value!=null) return value; }catch(error){ if(memory.has(key)) return clone(memory.get(key)); }
    return clone(fallback);
  };
  const write=(key,value)=>{
    try{ localStorage.setItem(key,JSON.stringify(value)); }catch(error){ memory.set(key,clone(value)); }
  };
  const refreshLibrary=()=>{ try{ if(typeof renderLibrary==='function'&&document.querySelector('#matLib')) renderLibrary(); }catch(error){} };

  API.library={
    materials:{
      /** Saved materials: {name, t (thickness mm), kerf, price, look}. Starts with the built-in list. */
      list:()=>read(MAT_KEY,MAT_SEED),
      save({name,t,kerf,price,look}={}){
        if(!name||typeof name!=='string') throw new TypeError('A material needs a name');
        if(!Number.isFinite(t)||t<=0) throw new RangeError('t must be a thickness in mm');
        if(!Number.isFinite(kerf)||kerf<0) throw new RangeError('kerf must be 0 or more');
        const entry={name,t,kerf,...(price!=null?{price}:{}),...(look?{look}:{})};
        write(MAT_KEY,[...read(MAT_KEY,MAT_SEED).filter(item=>item.name!==name),entry]);
        refreshLibrary();
        return entry;
      },
      remove(name){ write(MAT_KEY,read(MAT_KEY,MAT_SEED).filter(item=>item.name!==name)); refreshLibrary(); },
      /** Settings for a box with that material's thickness, kerf and sheet price filled in. */
      apply(settings,name){
        const material=read(MAT_KEY,MAT_SEED).find(item=>item.name===name);
        if(!material) throw new RangeError('No saved material called '+name);
        return {...settings,t:+material.t,kerf:+material.kerf,...(material.price!=null?{sheetPrice:+material.price}:{}),matName:material.name};
      },
      presets:()=>clone(MAT_SEED)
    },
    recipes:{
      /** Saved box designs by name. */
      list:()=>Object.keys(read(REC_KEY,{})).sort(),
      save(name,settings){
        if(!name||typeof name!=='string') throw new TypeError('A recipe needs a name');
        const {type='closed',...rest}=settings||{};
        const recipes=read(REC_KEY,{});
        recipes[name]=API.boxes.create(type,rest);
        write(REC_KEY,recipes);
        refreshLibrary();
      },
      load(name){
        const recipes=read(REC_KEY,{});
        if(!recipes[name]) throw new RangeError('No saved recipe called '+name);
        return clone(recipes[name]);
      },
      remove(name){ const recipes=read(REC_KEY,{}); delete recipes[name]; write(REC_KEY,recipes); refreshLibrary(); }
    }
  };

  /* ---------- the preview and the rest of the page ---------- */
  const B=API.browser||(API.browser={});
  const TABS={preview:'3d',sheets:'sheets',arrange:'layout',guide:'guide',help:'help'};
  const requirePage=()=>{ if(typeof document==='undefined'||!document.querySelector('#tabs')) throw new Error('This needs the Boxsmith page'); };

  Object.assign(B,{
    /** Current box settings in the editor (a copy). */
    getSettings:()=>clone(S),
    /** Replace the editor's settings. Anything left out goes back to its default. */
    setSettings(settings){
      requirePage();
      const {type='closed',...rest}=settings||{};
      S=Object.assign({},DEFAULTS,API.boxes.create(type,rest));
      update(true);
    },
    /** Change some editor settings and keep the rest. */
    updateSettings(changes){
      requirePage();
      B.setSettings({...S,...changes});
    },
    /** Switch tab: 'preview', 'sheets', 'arrange', 'guide' or 'help'. */
    showTab(name){
      requirePage();
      const id=TABS[name];
      if(!id) throw new RangeError("tab must be one of: "+Object.keys(TABS).join(', '));
      document.querySelector('#tabs [data-v="'+id+'"]').click();
    },
    /** Read or change the 3D preview. Pass any of: material, explode (0-1), spin, yaw and pitch (degrees; pitch 90 is straight down), zoom, hardware, stereo ('off'|'cross'|'parallel'), stereoDepth, edgeColor, lamp ({on,gain,color}), maximize. */
    view(changes){
      requirePage();
      if(changes){
        if(!isRecord(changes)) throw new TypeError('view changes must be an object');
        if(changes.material!==undefined){
          if(!MATS[changes.material]) throw new RangeError('material must be one of: '+Object.keys(MATS).join(', '));
          setPreviewMaterial(changes.material);
        }
        for(const key of ['explode','yaw','pitch','zoom']) if(changes[key]!==undefined){
          if(!Number.isFinite(changes[key])) throw new TypeError(key+' must be a number');
          if(key==='pitch'&&Math.abs(changes[key])>90) throw new RangeError('pitch must be between -90 and 90 degrees');
          view[key]=(key==='yaw'||key==='pitch')?changes[key]*Math.PI/180:changes[key];   // the page works in radians; the API in degrees
        }
        if(changes.spin!==undefined) view.spin=!!changes.spin;
        if(changes.hardware!==undefined) view.hw=!!changes.hardware;
        if(changes.stereo!==undefined){
          if(!['off','cross','parallel'].includes(changes.stereo)) throw new RangeError("stereo must be 'off', 'cross' or 'parallel'");
          view.stereo=changes.stereo;
          if(typeof syncStereoControls==='function') syncStereoControls();
        }
        if(changes.stereoDepth!==undefined) view.stereoDeg=changes.stereoDepth;
        if(changes.edgeColor!==undefined){
          if(changes.edgeColor!==null&&!/^#[0-9a-f]{6}$/i.test(changes.edgeColor)) throw new RangeError('edgeColor must look like #rrggbb');
          if(changes.edgeColor===null){ delete cutEdgeColors[view.mat]; saveCutEdgeColors(); syncCutEdgeControls(); } else setCutEdgeColor(changes.edgeColor.toLowerCase());
        }
        if(changes.lamp){ Object.assign(LAMP,{on:!!changes.lamp.on,...(changes.lamp.gain!==undefined?{gain:changes.lamp.gain}:{}),...(changes.lamp.color?{color:changes.lamp.color}:{})}); }
        if(changes.maximize!==undefined&&typeof setMax==='function') setMax(!!changes.maximize);
        render();
      }
      return {material:view.mat,explode:view.explode,spin:view.spin,yaw:round(view.yaw*180/Math.PI,2),pitch:round(view.pitch*180/Math.PI,2),zoom:view.zoom,hardware:view.hw,stereo:view.stereo,stereoDepth:view.stereoDeg,
        edgeColor:cutEdgeColors[view.mat]||null,lamp:{on:LAMP.on,gain:LAMP.gain,color:LAMP.color}};
    },
    /** Play the "show it work" animation. */
    play(loop=false){ requirePage(); playDemo(!!loop); },
    /** Preview picture as a PNG data URL. */
    snapshot(){ requirePage(); return snapshot(); },
    /** Turn the layout's Top view on (what the Top view button does). */
    topView(){ requirePage(); B.showTab('arrange'); const button=document.querySelector('#layoutTop'); if(button) button.click(); },
    /** Download something from the page: 'svg', 'dxf', 'settings', 'card' or 'layout'. */
    async download(kind){
      requirePage();
      if(kind==='layout'){ downloadBoxLayout(); return; }
      if(!LAST) throw new Error('Nothing to download yet');
      const name=baseName(), sheets=LAST.sheets;
      if(kind==='svg') return sheets.length===1?saveFile(name+'.svg',sheetSVG(sheets[0])):saveFile(name+'-svg.zip',makeZip(sheets.map((s,i)=>({name:name+'-sheet'+(i+1)+'.svg',data:sheetSVG(s)}))));
      if(kind==='dxf') return saveFile(name+'-dxf.zip',makeZip(sheets.map((s,i)=>({name:name+'-sheet'+(i+1)+'.dxf',data:sheetDXF(s)}))));
      if(kind==='settings') return saveFile(name+'.json',JSON.stringify(S,null,2));
      if(kind==='card') return saveFile(name+'-assembly-card.html',cardHTML());
      throw new RangeError("kind must be 'svg', 'dxf', 'settings', 'card' or 'layout'");
    },
    /** What the page is showing now: cut sheets, parts, costs and warnings for the editor's box. */
    current:()=>computeDesign(S,{card:false})
  });

  /* ---------- render a layout (or one box) to a PNG, offscreen ---------- */
  const RENDER_KEYS=['pitch','yaw','width','height','fit','zoom','material','edgeColor','lamp','background','showHidden'];
  const HEX=/^#[0-9a-f]{6}$/i;
  function renderOptions(options){
    if(options===undefined||options===null) options={};
    if(!isRecord(options)) throw new TypeError('render options must be an object');
    for(const key of Object.keys(options)) if(!RENDER_KEYS.includes(key)) throw new RangeError('Unknown render option: '+key);
    const o={pitch:35,yaw:30,width:1600,height:1200,fit:true,zoom:1,material:'birch',edgeColor:null,lamp:{on:false,gain:1,color:'#ffd6a0'},background:'#ffffff',showHidden:false};
    const num=(key,min,max)=>{
      const v=options[key]; if(v===undefined) return;
      if(typeof v!=='number'||!Number.isFinite(v)) throw new TypeError(key+' must be a number');
      if(v<min||v>max) throw new RangeError(key+' must be between '+min+' and '+max);
      o[key]=v;
    };
    num('pitch',-90,90); num('yaw',-3600,3600); num('zoom',0.01,100);
    for(const key of ['width','height']) if(options[key]!==undefined){
      const v=options[key];
      if(!Number.isInteger(v)) throw new TypeError(key+' must be a whole number of pixels');
      if(v<1||v>8192) throw new RangeError(key+' must be between 1 and 8192 pixels');
      o[key]=v;
    }
    for(const key of ['fit','showHidden']) if(options[key]!==undefined){
      if(typeof options[key]!=='boolean') throw new TypeError(key+' must be true or false');
      o[key]=options[key];
    }
    if(options.material!==undefined){
      if(!MATS[options.material]) throw new RangeError('material must be one of: '+Object.keys(MATS).join(', '));
      o.material=options.material;
    }
    if(options.edgeColor!==undefined&&options.edgeColor!==null){
      if(typeof options.edgeColor!=='string'||!HEX.test(options.edgeColor)) throw new RangeError('edgeColor must look like #rrggbb');
      o.edgeColor=options.edgeColor.toLowerCase();
    }
    if(options.background!==undefined){
      if(options.background!=='transparent'&&!(typeof options.background==='string'&&HEX.test(options.background))) throw new RangeError("background must be '#rrggbb' or 'transparent'");
      o.background=options.background.toLowerCase();
    }
    if(options.lamp!==undefined){
      const lamp=options.lamp;
      if(!isRecord(lamp)) throw new TypeError('lamp must be an object like { on: true }');
      for(const key of Object.keys(lamp)) if(!['on','gain','color'].includes(key)) throw new RangeError('Unknown lamp option: '+key);
      if(lamp.on!==undefined){ if(typeof lamp.on!=='boolean') throw new TypeError('lamp.on must be true or false'); o.lamp.on=lamp.on; }
      if(lamp.gain!==undefined){ if(typeof lamp.gain!=='number'||!Number.isFinite(lamp.gain)) throw new TypeError('lamp.gain must be a number'); if(lamp.gain<0||lamp.gain>10) throw new RangeError('lamp.gain must be between 0 and 10'); o.lamp.gain=lamp.gain; }
      if(lamp.color!==undefined){ if(typeof lamp.color!=='string'||!HEX.test(lamp.color)) throw new RangeError('lamp.color must look like #rrggbb'); o.lamp.color=lamp.color.toLowerCase(); }
    }
    return o;
  }

  // Pictures placed on boxes must be decoded before the geometry is built.
  async function loadArtImages(file){
    const sources=new Set();
    for(const box of file.boxes) for(const art of (box.settings.art||[])) if(art&&art.type==='png'&&typeof art.data==='string') sources.add(art.data);
    await Promise.all([...sources].map(src=>new Promise(resolve=>{
      const image=getImg(src);
      if(image.complete) return resolve();
      image.addEventListener('load',resolve); image.addEventListener('error',resolve);
    })));
  }

  function visibleBoxes(file,o){
    const entries=file.boxes.filter(entry=>o.showHidden||!entry.hidden);
    if(!entries.length) throw new Error('Nothing to render: the layout has no visible boxes (use showHidden: true to draw hidden ones)');
    return entries;
  }
  async function renderFile(file,o){
    if(typeof THREE==='undefined'||typeof document==='undefined') throw new Error('Rendering needs the Boxsmith page (use boxsmith-node.js from Node)');
    const entries=visibleBoxes(file,o);
    await loadArtImages({boxes:entries});
    const cache=new Map(), boxes=entries.map(entry=>{
      const box=restoreLayoutBox(entry,cache);
      box.hidden=false;
      transformLayoutBox(box);
      for(const solid of box.model.solids) solid.layoutBox=box;
      return box;
    });
    const solids=boxes.flatMap(box=>box.model.solids);
    const bounds=new THREE.Box3(); for(const box of boxes) bounds.union(box.bounds);
    const model={solids,ctr:bounds.getCenter(new THREE.Vector3()).toArray(),R:Math.max(10,bounds.getSize(new THREE.Vector3()).length()/2||100)};

    const canvas=document.createElement('canvas'); canvas.width=o.width; canvas.height=o.height;
    let off;
    try{ off=makeGLContext(canvas,{preserveDrawingBuffer:true}); }
    catch(error){ throw new Error('WebGL is not available here, so the layout cannot be rendered ('+error.message+')'); }

    // Borrow the page's globals for the length of the render, then put every one back.
    const saved={GL,mat:view.mat,hw:view.hw,edge:cutEdgeColors[o.material],lamp:{...LAMP,off:[...LAMP.off]}};
    try{
      GL=off; view.mat=o.material; view.hw=true;
      if(o.edgeColor) cutEdgeColors[o.material]=o.edgeColor; else delete cutEdgeColors[o.material];
      Object.assign(LAMP,{on:o.lamp.on,gain:o.lamp.gain,color:o.lamp.color,size:1,off:[0,0,0],yaw:-0.32,pitch:0.16});
      glColors(); buildGL(model);
      const lamp=o.lamp.on;
      lampFrame(model,lamp);

      // camera: the page's own conventions (yaw, pitch in radians; pitch down from horizontal)
      const yaw=o.yaw*Math.PI/180, pitch=o.pitch*Math.PI/180;
      const cy=Math.cos(yaw), sy=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch);
      const away=[cp*sy,cp*cy,-sp], up=[sp*sy,sp*cy,cp], right=[cy,-sy,0], dist=model.R*20;
      const {Rl,CAMV}=lampBasis(lamp,right,up,away,model.ctr);
      const w=o.width, h=o.height, dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
      let C=model.ctr.slice(), scale=Math.min(w,h)*0.40/model.R*o.zoom;
      if(o.fit){
        // frame every drawn corner with a small margin
        const point=new THREE.Vector3(); let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
        for(const box of boxes) for(const solid of box.model.solids) for(const loop of [solid.bot[0],solid.top[0]]) for(const vertex of loop){
          point.fromArray(vertex).applyMatrix4(box.pose); if(Rl) point.applyMatrix4(Rl);
          const x=dot(point.toArray(),CAMV.right), y=dot(point.toArray(),CAMV.up);
          if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
        }
        const margin=0.04, ex=Math.max(x1-x0,1e-3), ey=Math.max(y1-y0,1e-3);
        scale=Math.min(w/(ex*(1+2*margin)),h/(ey*(1+2*margin)));
        const dx=(x0+x1)/2-dot(model.ctr,CAMV.right), dy=(y0+y1)/2-dot(model.ctr,CAMV.up);
        C=model.ctr.map((v,i)=>v+CAMV.right[i]*dx+CAMV.up[i]*dy);
      }
      const cam=off.cam;
      cam.position.set(C[0]-CAMV.away[0]*dist,C[1]-CAMV.away[1]*dist,C[2]-CAMV.away[2]*dist); cam.up.set(...CAMV.up); cam.lookAt(C[0],C[1],C[2]);
      cam.left=-w/2/scale; cam.right=w/2/scale; cam.top=h/2/scale; cam.bottom=-h/2/scale; cam.near=0.1; cam.far=dist*4; cam.updateProjectionMatrix();

      // place and paint every box exactly as Arrange boxes does
      const M=new THREE.Matrix4(), Tm=new THREE.Matrix4();
      for(const ob of off.objs){
        const box=ob.s.layoutBox;
        M.copy(box.pose).multiply(ob.base); if(Rl) M.premultiply(Rl);
        ob.mesh.matrix.copy(M); ob.edges.matrix.copy(M); ob.edges.visible=!lamp;
        if(ob.decal){ ob.decal.matrix.copy(M).multiply(Tm.makeTranslation(0,0,ob.dz)); ob.decal.visible=!lamp; }
        if(ob.hw){ ob.hw.matrix.copy(M); ob.hw.matrixWorldNeedsUpdate=true; }
        const look=boxLook(box.settings), base=look===view.mat?off:lookMaterials(off,look);
        const clear=ob.s.look==='clear', paint=clear?null:paintMaterials(box.settings,look);
        ob.mesh.material=clear?[off.clearCap,off.clearSide]:paint?[paint.cap,paint.side]:[base.cap,base.side];
      }
      off.r.setPixelRatio(1); off.r.setSize(w,h,false); off.r.setViewport(0,0,w,h);
      if(o.background==='transparent') off.r.setClearColor(0x000000,0); else off.r.setClearColor(parseInt(o.background.slice(1),16),1);
      off.r.render(off.sc,cam);
      return {png:canvas.toDataURL('image/png'),width:w,height:h};
    } finally {
      for(const ob of off.objs){
        ob.mesh.geometry.dispose(); ob.edges.geometry.dispose();
        if(ob.decal){ ob.decal.geometry.dispose(); ob.decal.material.map.dispose(); ob.decal.material.dispose(); }
        if(ob.hw) ob.hw.children.forEach(m=>m.geometry.dispose());
      }
      for(const key of ['cap','side','line','steel','nutMat','clearCap','clearSide','hiCap','hiSide']) off[key].dispose();
      off.r.dispose(); try{ off.r.forceContextLoss(); }catch(e){}
      GL=saved.GL; view.mat=saved.mat; view.hw=saved.hw;
      if(saved.edge===undefined) delete cutEdgeColors[o.material]; else cutEdgeColors[o.material]=saved.edge;
      Object.assign(LAMP,saved.lamp);
    }
  }

  /** Render a layout (object or JSON text) to a PNG without touching the page. Resolves { png, width, height }. */
  API.assemblies.render=async function(layout,options){
    const o=renderOptions(options), file=API.assemblies.parse(layout);
    return renderFile(file,o);
  };
  /** Render one box design to a PNG, with the same options. */
  API.design.render=async function(settings,options){
    const o=renderOptions(options), design=API.boxes.create(...(()=>{ const {type='closed',...rest}=isRecord(settings)?settings:{}; return [type,rest]; })());
    return renderFile(API.assemblies.create({boxes:[API.assemblies.place(design)]}),o);
  };
  API._checkRender=(layout,options)=>{ const o=renderOptions(options), file=API.assemblies.parse(layout); visibleBoxes(file,o); return {options:o,layout:file}; };
})();
